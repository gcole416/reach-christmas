-- Follow-up to the 2026-10-19 reach-reviewer pass on the staff-assigned-
-- sponsors epic (20261015120000-160000).
--
-- 1. DB-30 (docs/OPEN_QUESTIONS.md): revoke EXECUTE on every function in the
--    `net` schema (pg_net: net.http_post / net.http_get) from anon,
--    authenticated and public. 20260818160000 already revoked the `net`
--    TABLES for the same reason (Supabase's default privileges there are
--    broad); nothing ever revoked the functions themselves. Not reachable
--    today (`net` isn't in PostgREST's exposed schemas), but this project's
--    DB-2/DB-27 lesson is not to rely on a default staying that way.
--    The security definer functions that call net.http_post (owned by
--    postgres) are unaffected: they run as their owner, not as the caller.
--
-- 2. assign_card_to_sponsor_family: fix an orphan `sponsors` row when two
--    staff assign the same card at once (the loser's sponsors insert was
--    committed even though its assignment insert failed). Body is
--    20261015150000's, with the sponsors insert moved into the same
--    exception block as the assignments insert.
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  NOT YET APPLIED.
--   PROD: NOT APPLIED. Waits for a Software Acceptance Review.

begin;

revoke execute on all functions in schema net from anon, authenticated, public;

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

  -- The sponsors insert lives INSIDE this block (20261015170000) so the
  -- unique_violation handler below rolls it back along with the failed
  -- assignment insert. A plain `return` from a handler does not undo earlier
  -- statements in the function, which used to leave an orphan sponsors row
  -- when two staff assigned the same card at once.
  begin
    insert into sponsors (name, email, phone, sponsor_family_id)
    values (v_sponsor_family.display_name, v_sponsor_family.contact_email, v_sponsor_family.contact_phone, v_sponsor_family.id)
    returning id into v_sponsor_id;

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
grant execute on function public.assign_card_to_sponsor_family(uuid, uuid) to authenticated;

commit;

-- VERIFY (dev, after applying):
--
-- 1. Expect false for both roles (run BEFORE as well; expect true there if
--    the grant was standing):
--    select has_function_privilege('authenticated', 'net.http_post(text, jsonb, jsonb, jsonb, integer)'::regprocedure, 'execute'),
--           has_function_privilege('anon',          'net.http_post(text, jsonb, jsonb, jsonb, integer)'::regprocedure, 'execute');
--
-- 2. THEN confirm email still works, since the definer functions call
--    net.http_post: assign a test card to a sponsor_families row that has an
--    email, and confirm a new sponsor_emails row (and the email, if the Edge
--    Function is set up). If the email step stops working, the revoke hit
--    the definer owner role too -- run:
--    grant execute on all functions in schema net to postgres;
--    and tell Claude.
