-- Fixes a regression of the exact bug 20260818170000_fix_pgcrypto_schema_qualification.sql
-- already fixed once. 20260930120000_sponsor_thank_you_email.sql re-created
-- claim_card_with_code (to add the thank-you email step) by copying the
-- OLDER, pre-fix body from 20260818160000_email_verified_claims.sql instead of
-- the corrected one from 20260818170000 -- so its code-check line went back to
-- bare `crypt(...)` instead of `extensions.crypt(...)`. Since `create or
-- replace function` makes each later migration fully replace the function
-- body (not patch it), 20260930120000's copy is what's actually live today,
-- and it has the schema-qualification bug back in it.
--
-- Symptom (same as the original bug report): a sponsor who types a real,
-- correct 6-digit code from the verification email gets back a Postgres
-- error instead of a confirmed claim -- `42883: function crypt(text, text)
-- does not exist` -- because this function's `set search_path = public`
-- doesn't include whatever schema pgcrypto's functions live in (`extensions`
-- on this project, per 20260818170000's finding). Reported from a live
-- meeting as a sponsor-claim code-entry failure ("crypt text failure on
-- signup").
--
-- Fix is the same one as last time: schema-qualify the one call site
-- (`extensions.crypt(...)`). Body is otherwise byte-for-byte identical to
-- 20260930120000_sponsor_thank_you_email.sql's claim_card_with_code -- this
-- migration does not touch request_claim_code (its crypt call was already
-- correctly qualified and has never been touched since the original fix).
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  APPLIED 2026-10-19.
--   PROD: NOT APPLIED, and must not be until a Software Acceptance Review,
--         same as every other intake/claim migration.
--
-- reach-reviewer gate REQUIRED: edits claim_card_with_code (the sole public
-- claim path).

begin;

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
  -- Thank-you email step only (best-effort -- see 20260930120000's header).
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

  -- THE FIX: extensions.crypt, not crypt. See header comment.
  if v_verification.code_hash <> extensions.crypt(btrim(p_code), v_verification.code_hash) then
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

  -- Thank-you email -- best-effort, see 20260930120000's header. Nothing in
  -- this block may prevent the function from reaching the success return
  -- below.
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
          -- TODO(Grant): swap for a verified sending domain -- see
          -- 20260930120000's header and the epic header in docs/backlog.md.
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
-- 1. As a genuinely signed-out client (see US-17 guardrails -- do not test
--    this from an authenticated session), claim a non-confidential,
--    non-high-schooler card end to end with a real inbox you can check:
--    request_claim_code(...), then claim_card_with_code(...) with the
--    correct code from the verification email. Expect {"ok": true, ...} --
--    NOT a 42883 "function crypt(text, text) does not exist" error.
--
-- 2. Same flow with a deliberately WRONG code: expect the ordinary
--    "That code doesn't match" response, not a Postgres error, and confirm
--    `attempts` incremented on card_claim_verifications.
--
-- 3. select prosrc from pg_proc where proname = 'claim_card_with_code'; --
--    confirm the body contains `extensions.crypt`, not a bare `crypt(`.
