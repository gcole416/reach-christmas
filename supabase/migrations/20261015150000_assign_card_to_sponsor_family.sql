-- US-58 (docs/backlog.md) -- the staff-assignment write path. Lives on
-- feature/staff-assigned-sponsors only; does not touch claim_card_with_code,
-- request_claim_code, or public_available_cards, all of which stay exactly
-- as they are (self-serve claiming is unused on this branch, not removed --
-- see US-59).
--
-- Same shape as claim_card_with_code's assignment-creation half (refuse an
-- already-claimed or confidential card, insert sponsors then assignments,
-- best-effort thank-you + card-PDF email), minus the code-verification
-- step, because the caller here is an authenticated staff member, not an
-- anonymous sponsor typing in a code.
--
-- security definer, not security invoker, even though `sponsors` and
-- `assignments` already grant authenticated users direct insert/update via
-- RLS (`with check (true)` -- see 20260708120000): the thank-you email step
-- needs to read a Vault secret and call pg_net, and neither is grantable to
-- `authenticated` without widening access well beyond this one function.
-- security definer confines that elevated access to exactly this code path,
-- same reasoning that already applies to claim_card_with_code and
-- request_claim_code.
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  NOT YET APPLIED. Depends on 20261015140000 (sponsor_families).
--   PROD: NOT APPLIED. Waits for a Software Acceptance Review, same as every
--         other claim-path change.
--
-- reach-reviewer gate REQUIRED: new write path onto assignments/sponsors;
-- reuses the existing best-effort email step against a new data source.

begin;

create or replace function public.assign_card_to_sponsor_family(
  p_card_id uuid,
  p_sponsor_family_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sponsor_family sponsor_families%rowtype;
  v_card_drive_id uuid;
  v_already_claimed uuid;
  v_sponsor_id uuid;
  v_assignment_id uuid;
  -- Thank-you email step only (best-effort -- see 20261015130000's header,
  -- this reuses the exact same shape and the exact same Edge Function).
  v_card_number text;
  v_first_name text;
  v_grade text;
  v_pant_size text;
  v_shirt_size text;
  v_shoe_size text;
  v_specific_needs text;
  v_wishlist_lines text;
  v_dropoff_location text;
  v_dropoff_days text;
  v_dropoff_deadline text;
  v_edge_functions_url text;
  v_webhook_secret text;
begin
  select * into v_sponsor_family from sponsor_families where id = p_sponsor_family_id;
  if v_sponsor_family is null then
    return jsonb_build_object('ok', false, 'error', 'That sponsor roster entry no longer exists.');
  end if;
  if not v_sponsor_family.is_active then
    return jsonb_build_object('ok', false, 'error', 'That sponsor roster entry is marked inactive.');
  end if;

  select a.id into v_already_claimed
  from assignments a
  where a.card_id = p_card_id and a.status <> 'cancelled'
  limit 1;

  if v_already_claimed is not null then
    return jsonb_build_object('ok', false, 'error', 'This card has already been claimed or assigned.');
  end if;

  select f.drive_id into v_card_drive_id
  from cards crd
  join children ch on ch.id = crd.child_id
  join families f on f.id = ch.family_id
  where crd.id = p_card_id
    and not f.is_confidential
    -- On hold for duplicate review, and high-schoolers (self-shop, never in
    -- the sponsor pool) -- same two gates getAssignableCards already applies
    -- at the query layer (mirrors public_available_cards' own three-way
    -- filter, see 20260909120000_child_on_hold.sql). Added here too so this
    -- function refuses both on its own, not just because the UI pool
    -- already excludes them. Deliberately NOT left as a known gap the way
    -- OPEN_QUESTIONS DB-29 accepts for claim_card_with_code -- this is a
    -- brand-new function, so there's no reason to carry that gap into it.
    and ch.held_at is null
    and not ch.is_high_schooler;

  if v_card_drive_id is null then
    -- Card doesn't exist, belongs to a confidential household, is on hold,
    -- or is a high schooler's -- same refusal either way, same message
    -- claim_card_with_code gives the public claim path, reworded for staff.
    return jsonb_build_object('ok', false, 'error', 'This card is not available for assignment (missing, confidential, on hold, or a high schooler).');
  end if;

  if v_card_drive_id is distinct from v_sponsor_family.drive_id then
    return jsonb_build_object('ok', false, 'error', 'This sponsor roster entry is from a different drive than this card.');
  end if;

  insert into sponsors (name, email, phone, sponsor_family_id)
  values (v_sponsor_family.display_name, v_sponsor_family.contact_email, v_sponsor_family.contact_phone, v_sponsor_family.id)
  returning id into v_sponsor_id;

  begin
    insert into assignments (card_id, sponsor_id, status, claimed_at)
    values (p_card_id, v_sponsor_id, 'pledged', now())
    returning id into v_assignment_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'This card was just assigned to someone else -- refresh and try another.');
  end;

  -- Thank-you + card-PDF email -- best-effort, identical shape to
  -- claim_card_with_code's own version (20261015130000). Skipped silently
  -- if the roster entry has no email on file, same "degrade, don't fail"
  -- rule every email step in this codebase follows.
  begin
    select
      coalesce(ds.code, 'Z') || f.family_number || '.' || ch.child_index,
      ch.first_name, ch.grade, ch.pant_size, ch.shirt_size, ch.shoe_size,
      ch.specific_needs
    into v_card_number, v_first_name, v_grade, v_pant_size, v_shirt_size,
      v_shoe_size, v_specific_needs
    from cards crd
    join children ch on ch.id = crd.child_id
    join families f on f.id = ch.family_id
    left join drive_schools ds on ds.id = f.drive_school_id
    where crd.id = p_card_id;

    select string_agg('- ' || wi.description, E'\n' order by wi.position)
    into v_wishlist_lines
    from wishlist_items wi
    where wi.child_id = (select child_id from cards where id = p_card_id);

    select dropoff_location, dropoff_days, dropoff_deadline, edge_functions_url
    into v_dropoff_location, v_dropoff_days, v_dropoff_deadline, v_edge_functions_url
    from app_settings limit 1;

    select decrypted_secret into v_webhook_secret
    from vault.decrypted_secrets
    where name = 'internal_webhook_secret'
    limit 1;

    if v_webhook_secret is not null and v_edge_functions_url is not null
      and v_sponsor_family.contact_email is not null and btrim(v_sponsor_family.contact_email) <> ''
    then
      perform net.http_post(
        url := rtrim(v_edge_functions_url, '/') || '/send-sponsor-card-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-secret', v_webhook_secret
        ),
        body := jsonb_build_object(
          'sponsor_name', v_sponsor_family.display_name,
          'sponsor_email', btrim(v_sponsor_family.contact_email),
          'card_number', v_card_number,
          'first_name', v_first_name,
          'grade', v_grade,
          'pant_size', v_pant_size,
          'shirt_size', v_shirt_size,
          'shoe_size', v_shoe_size,
          'specific_needs', v_specific_needs,
          'wishlist_lines', v_wishlist_lines,
          'dropoff_location', v_dropoff_location,
          'dropoff_days', v_dropoff_days,
          'dropoff_deadline', v_dropoff_deadline
        )
      );

      insert into sponsor_emails (drive_id, assignment_id, kind, sent_to)
      values (v_card_drive_id, v_assignment_id, 'thank_you', btrim(v_sponsor_family.contact_email));
    end if;
  exception when others then
    -- Best-effort: a missing Vault secret, a missing edge_functions_url, no
    -- email on file, anything -- never let the email step turn a successful
    -- assignment into a failure.
    null;
  end;

  return jsonb_build_object('ok', true, 'sponsor_id', v_sponsor_id, 'assignment_id', v_assignment_id);
end;
$$;

-- authenticated only -- unlike claim_card_with_code, anon has no business
-- calling this at all.
grant execute on function public.assign_card_to_sponsor_family(uuid, uuid) to authenticated;
revoke all on function public.assign_card_to_sponsor_family(uuid, uuid) from anon, public;

commit;

-- VERIFY (run after applying, dev only):
--
-- 1. As an authenticated staff/volunteer test account, pick a real,
--    unclaimed, non-confidential card id and a sponsor_families row you
--    created in 20261015140000's VERIFY step:
--    select assign_card_to_sponsor_family('<card id>', '<sponsor_families id>');
--    Expect {"ok": true, "sponsor_id": "...", "assignment_id": "..."}.
--
-- 2. select * from assignments where id = '<assignment_id from step 1>'; --
--    confirm status = 'pledged', claimed_at just set.
--    select sponsor_family_id from sponsors where id = '<sponsor_id>'; --
--    confirm it matches the sponsor_families row used.
--
-- 3. Call it again with the SAME card id: expect
--    {"ok": false, "error": "This card has already been claimed or assigned."}.
--
-- 4. Try it against a confidential household's card: expect
--    {"ok": false, "error": "...confidential..."}.
--
-- 5. As anon (signed out): confirm the call is refused outright (permission
--    denied / function not found for role), not just an application-level
--    {"ok": false}.
--
-- 6. With the sponsor_families row's contact_email set and edge_functions_url/
--    the internal_webhook_secret Vault secret both configured (see
--    20261015130000's and send-sponsor-card-email's headers), confirm the
--    thank-you email with the card PDF actually arrives, same as a
--    self-serve claim's does.
