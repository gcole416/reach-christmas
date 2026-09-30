-- US-43 (docs/backlog.md) -- sponsor thank-you email, sent the moment a
-- claim is confirmed. Scoped by Grant 2026-09-29 to one email only this
-- season: who they're buying for, the wish list and sizes, and drop-off
-- instructions. Reminder emails (1-week / 1-day / overdue) are explicitly
-- out of scope for 2026 -- staff follow up late sponsors by phone
-- (OPEN_QUESTIONS ADM-11).
--
-- Drop-off details from Grant, 2026-09-30: location is fixed (OneLife
-- Church, at the Reach Christmas table); the specific days and deadline are
-- not decided yet ("any service on X or X days" / "by Y time"). Rather than
-- bake a `[placeholder]` into this function's text -- the exact mistake the
-- high-schooler shop-day panel made and then had to remove (backlog.md
-- US-46, 2026-09-29 update) -- the three strings live in `app_settings`,
-- the same "ordinary per-environment config" table `site_url` already lives
-- in (20260923120000). Grant sets the real values with one UPDATE once he
-- has them; no new migration needed.
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  Applied by Grant, 2026-09-30.
--   PROD: NOT APPLIED, and must not be until a Software Acceptance Review,
--         same as every other intake/claim migration.
--
-- Written to be re-runnable: `alter table ... add column if not exists`,
-- `create table if not exists`, `create or replace function`, guarded
-- `create type`.
--
-- =============================================================================
-- What this adds
-- =============================================================================
--   * app_settings gains three columns: dropoff_location, dropoff_days,
--     dropoff_deadline -- all text, all with an honest placeholder default
--     (says outright it isn't set yet) so the email still sends rather than
--     silently failing before Grant sets real values.
--   * sponsor_emails -- one row per sponsor-facing email actually sent (or
--     queued via pg_net), mirroring counselor_emails' shape (US-41,
--     20260923120000): a `kind` enum so future reminder kinds slot in later
--     without a new table, a nullable subject reference (assignment_id here,
--     not drive_school_id -- a sponsor email is per-claim, not per-school),
--     sent_to, created_at. Deliberately its own table rather than reusing
--     counselor_emails: that table's RLS and shape are counselor-send
--     specific, and naming a sponsor-facing send "counselor_emails" would
--     mislead whoever reads it next.
--   * claim_card_with_code (20260818160000) gains one more step after the
--     assignment insert succeeds: pull the SAME column whitelist
--     public_available_cards already uses -- first_name, grade, sizes,
--     specific_needs, wishlist (see that view's comment, 20260909120000, for
--     why this whitelist exists and what must never join it: last name,
--     school, address) -- fire the thank-you email via the same Resend/
--     Vault/pg_net path request_claim_code already uses, and log it.
--
--     Best-effort, deliberately: if this step raises for ANY reason, the
--     claim itself must still succeed -- a sponsor who successfully claimed
--     a card must never be told the claim failed just because the email step
--     hiccuped. It's wrapped in its own begin/exception block, which in
--     plpgsql opens a subtransaction (savepoint) -- an exception caught
--     there only unwinds work done inside that block, not the assignment/
--     sponsor rows already committed above it. A missing Vault key or
--     app_settings row is handled the same way: skipped, not raised.
--
-- =============================================================================
-- Caveats worth reading before the reach-reviewer gate
-- =============================================================================
--   * Same fire-and-forget caveat as every pg_net call in this codebase
--     (20260818160000, 20260923120000): a queued request id, not Resend's
--     response. A failed send has no visible signal beyond an absent
--     sponsor_emails row -- no retry, no admin alert. Acceptable for the
--     2026 scope (one best-effort email); revisit if that's not good enough.
--   * dropoff_days / dropoff_deadline ship with placeholder text that SAYS
--     it's a placeholder, rather than a plausible-looking guess -- so a real
--     sponsor who claims before Grant sets the real values sees an honest
--     "not set yet" instead of a wrong day/deadline that reads as real.
--   * No sending domain is verified yet (still onboarding@resend.dev, same
--     TODO(Grant) as the other two email migrations).
--   * A high schooler's card is excluded from public_available_cards
--     entirely (20260908130000), so this path shouldn't be reachable for
--     one in normal use; the wishlist/sizes text degrades gracefully
--     (coalesced to empty) if it ever is, rather than erroring.
--
-- reach-reviewer gate REQUIRED: edits claim_card_with_code (the sole public
-- claim path), new outbound email carrying a child's first name/grade/
-- sizes/wishlist, new table.

begin;

-- =============================================================================
-- 1. app_settings -- drop-off details.
-- =============================================================================
alter table app_settings add column if not exists dropoff_location text not null
  default 'OneLife Church, at the Reach Christmas table';
alter table app_settings add column if not exists dropoff_days text not null
  default '[drop-off days not set yet -- staff: update app_settings.dropoff_days]';
alter table app_settings add column if not exists dropoff_deadline text not null
  default '[drop-off deadline not set yet -- staff: update app_settings.dropoff_deadline]';

comment on column app_settings.dropoff_location is
  'Where a sponsor drops off a purchased gift. Set by Grant, 2026-09-30.';
comment on column app_settings.dropoff_days is
  'Which day(s)/services gifts can be dropped off. Placeholder until Grant '
  'confirms -- update in place with UPDATE app_settings, no migration needed.';
comment on column app_settings.dropoff_deadline is
  'Last day/time gifts can be dropped off. Placeholder until Grant confirms '
  '-- update in place with UPDATE app_settings, no migration needed.';

-- =============================================================================
-- 2. sponsor_emails -- the send log.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sponsor_email_kind') then
    create type sponsor_email_kind as enum ('thank_you');
  end if;
end $$;

create table if not exists sponsor_emails (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  assignment_id uuid references assignments(id) on delete cascade,
  kind sponsor_email_kind not null,
  sent_to text not null,
  created_at timestamptz not null default now()
);

comment on table sponsor_emails is
  'US-43: one row per sponsor-facing email actually sent (or queued via '
  'pg_net) -- the claim thank-you today, future reminder kinds later. '
  'Mirrors counselor_emails'' shape (20260923120000) but kept separate: '
  'this is per-claim, not per-school, with its own RLS.';

create index if not exists sponsor_emails_assignment_idx on sponsor_emails (assignment_id);

alter table sponsor_emails enable row level security;

drop policy if exists "admin read sponsor_emails" on sponsor_emails;
create policy "admin read sponsor_emails" on sponsor_emails for select to authenticated
  using (is_admin());

grant select on sponsor_emails to authenticated;
revoke all on sponsor_emails from anon;
-- No insert/update/delete grant for authenticated -- every row is written by
-- claim_card_with_code below (security definer, inserts as the function
-- owner), same pattern as card_claim_verifications and counselor_emails.

drop trigger if exists audit_sponsor_emails on sponsor_emails;
create trigger audit_sponsor_emails after insert or update or delete on sponsor_emails
  for each row execute function public.audit_log_change();

-- =============================================================================
-- 3. claim_card_with_code -- send the thank-you email after a successful claim.
-- Identical to 20260818160000's version except: the assignment insert now
-- captures its id, and one best-effort block is added between that insert
-- and the final return. Every check above the assignment insert has
-- unchanged logic (a few inline comments were trimmed for length, not
-- reworded or removed for meaning).
-- =============================================================================
create or replace function public.claim_card_with_code(
  p_card_id uuid,
  p_code text,
  p_session_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verification card_claim_verifications%rowtype;
  v_already_claimed uuid;
  v_sponsor_id uuid;
  v_assignment_id uuid;
  -- Thank-you email step only (best-effort -- see header comment).
  v_drive_id uuid;
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
  v_api_key text;
begin
  if p_code is null or btrim(p_code) = '' then
    return jsonb_build_object('ok', false, 'error', 'That code doesn''t match -- check your email and try again.');
  end if;

  select * into v_verification
  from card_claim_verifications
  where card_id = p_card_id
  for update;

  if v_verification is null then
    return jsonb_build_object('ok', false, 'error', 'No pending verification for this card. Request a new code.');
  end if;

  if p_session_token is null or v_verification.session_token is distinct from p_session_token then
    return jsonb_build_object(
      'ok', false,
      'error', 'This code request is no longer active -- a new code was requested for this card. Please request a new code and try again.'
    );
  end if;

  if v_verification.expires_at < now() then
    delete from card_claim_verifications where card_id = p_card_id;
    return jsonb_build_object('ok', false, 'error', 'That code has expired. Request a new code.');
  end if;

  if v_verification.attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Too many attempts. Request a new code.');
  end if;

  if v_verification.code_hash <> crypt(btrim(p_code), v_verification.code_hash) then
    update card_claim_verifications
    set attempts = attempts + 1
    where card_id = p_card_id;
    return jsonb_build_object('ok', false, 'error', 'That code doesn''t match -- check your email and try again.');
  end if;

  select a.id into v_already_claimed
  from assignments a
  where a.card_id = p_card_id and a.status <> 'cancelled'
  limit 1;

  if v_already_claimed is not null then
    raise exception 'This card has already been claimed.';
  end if;

  if exists (
    select 1 from cards crd
    join children ch on ch.id = crd.child_id
    join families f on f.id = ch.family_id
    where crd.id = p_card_id and f.is_confidential
  ) then
    raise exception 'This card is not available for public claiming.';
  end if;

  insert into sponsors (name, email, phone)
  values (v_verification.sponsor_name, v_verification.sponsor_email, v_verification.sponsor_phone)
  returning id into v_sponsor_id;

  begin
    insert into assignments (card_id, sponsor_id, status, claimed_at)
    values (p_card_id, v_sponsor_id, 'pledged', now())
    returning id into v_assignment_id;
  exception when unique_violation then
    raise exception 'This card was just claimed by someone else -- please pick another.';
  end;

  delete from card_claim_verifications where card_id = p_card_id;

  -- Thank-you email -- best-effort, see header comment. Nothing in this
  -- block may prevent the function from reaching the success return below.
  begin
    select
      coalesce(ds.code, 'Z') || f.family_number || '.' || ch.child_index,
      ch.first_name, ch.grade, ch.pant_size, ch.shirt_size, ch.shoe_size,
      ch.specific_needs, f.drive_id
    into v_card_number, v_first_name, v_grade, v_pant_size, v_shirt_size,
      v_shoe_size, v_specific_needs, v_drive_id
    from cards crd
    join children ch on ch.id = crd.child_id
    join families f on f.id = ch.family_id
    left join drive_schools ds on ds.id = f.drive_school_id
    where crd.id = p_card_id;

    select string_agg('- ' || wi.description, E'\n' order by wi.position)
    into v_wishlist_lines
    from wishlist_items wi
    where wi.child_id = (select child_id from cards where id = p_card_id);

    select dropoff_location, dropoff_days, dropoff_deadline
    into v_dropoff_location, v_dropoff_days, v_dropoff_deadline
    from app_settings limit 1;

    select decrypted_secret into v_api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key'
    limit 1;

    if v_api_key is not null and v_drive_id is not null then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_api_key
        ),
        body := jsonb_build_object(
          -- TODO(Grant): swap for a verified sending domain -- see this
          -- migration's header and the epic header in docs/backlog.md.
          'from', 'Reach Christmas <onboarding@resend.dev>',
          'to', jsonb_build_array(btrim(v_verification.sponsor_email)),
          'subject', 'Thank you for sponsoring ' || v_first_name || '!',
          'text',
            'Hi ' || v_verification.sponsor_name || ',' || E'\n\n' ||
            'Thank you for sponsoring ' || v_first_name ||
            coalesce(' (grade ' || v_grade || ')', '') || ' this Christmas! Card ' || v_card_number || '.' ||
            E'\n\n' ||
            coalesce('Wish list:' || E'\n' || v_wishlist_lines || E'\n\n', '') ||
            'Sizes -- Pants: ' || coalesce(v_pant_size, 'n/a') ||
            ', Shirt: ' || coalesce(v_shirt_size, 'n/a') ||
            ', Shoes: ' || coalesce(v_shoe_size, 'n/a') || E'\n' ||
            coalesce(v_specific_needs || E'\n', '') ||
            E'\n' || 'Drop-off:' || E'\n' ||
            'Location: ' || v_dropoff_location || E'\n' ||
            'When: ' || v_dropoff_days || E'\n' ||
            'Deadline: ' || v_dropoff_deadline || E'\n\n' ||
            'Thank you for partnering with us this season.'
        )
      );

      insert into sponsor_emails (drive_id, assignment_id, kind, sent_to)
      values (v_drive_id, v_assignment_id, 'thank_you', v_verification.sponsor_email);
    end if;
  exception when others then
    -- Best-effort: a missing Vault key, an app_settings hiccup, anything --
    -- never let the email step turn a successful claim into a failure.
    null;
  end;

  return jsonb_build_object('ok', true, 'sponsor_id', v_sponsor_id);
end;
$$;

grant execute on function public.claim_card_with_code(uuid, text, uuid) to anon, authenticated;

commit;

-- VERIFY (run after applying, dev only):
--
-- 1. Set the real drop-off details once known:
--    update app_settings set dropoff_days = '...', dropoff_deadline = '...';
--
-- 2. As a genuinely signed-out client (see US-17 guardrails -- do not test
--    this from an authenticated session), claim a non-confidential,
--    non-high-schooler card end to end with a real inbox you can check:
--    request_claim_code(...) then claim_card_with_code(...) with the code
--    from the verification email. Confirm a SECOND email arrives -- the
--    thank-you -- containing the same first name/grade/sizes/wishlist the
--    card showed and nothing else (no last name, no school, no address).
--
-- 3. select * from sponsor_emails order by created_at desc; -- one row for
--    that claim, kind = 'thank_you'.
--
-- 4. Confirm the claim still succeeds even with the Vault secret temporarily
--    renamed/missing (simulates a misconfigured environment): claim a
--    different card, expect {"ok": true, ...} back and no sponsor_emails row
--    for it -- the email step must degrade silently, not block the claim.
