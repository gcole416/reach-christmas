-- SPN-3 (docs/OPEN_QUESTIONS.md): claiming a card must not count as
-- `pledged` until the sponsor has proven they control the email address they
-- typed in. Grant's answer (2026-08-18): a 6-digit code typed on the same
-- claiming page, sent via Resend.
--
-- Written and NOT applied to any live database (same pending-apply note as
-- 20260818140000/20260818150000) — this agent does not have, and did not use,
-- live database access. See the accompanying report for what that means for
-- the pg_net/Vault feasibility check below.
--
-- =============================================================================
-- Extensions
-- =============================================================================
--
-- pg_net (async outbound HTTP from SQL) and Supabase Vault (encrypted secret
-- storage, `vault.decrypted_secrets`) are both documented as standard on
-- every Supabase Cloud tier, including free. `supabase/config.toml`'s
-- commented-out `[db.vault]` block (present since project scaffolding)
-- independently corroborates Vault being a first-class, expected-available
-- feature of this stack, not an add-on. That said: this was NOT verified
-- against the actual project (no live DB access — see report). If either
-- extension is genuinely unavailable here, this migration fails loudly at
-- `create extension` time rather than silently degrading — confirm both show
-- as enabled under Database -> Extensions in the dashboard, and if either
-- errors out, stop and report back rather than working around it.
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- pg_net persists every submitted request (and its response) in its own
-- tables under the `net` schema, since http_post is async/fire-and-forget
-- and queues the request rather than returning a response inline -- that's
-- inherent to how the extension works, not something this migration
-- controls. Those requests, for request_claim_code() below, contain the
-- Resend API key (in the Authorization header) and the sponsor's email plus
-- raw 6-digit code (in the body). OPEN_QUESTIONS.md DB-2 already found,
-- empirically, against this exact dev project, that Supabase auto-grants
-- `anon`/`authenticated` SELECT on new tables regardless of what a
-- migration's own grant statements say -- the same platform-default-grant
-- risk almost certainly applies to pg_net's tables too, and the blast radius
-- there is worse than card_claim_verifications: the org's Resend key plus
-- every unexpired sponsor's plaintext code. Defensive revoke, applied
-- proactively on that DB-2 precedent -- like the pg_net/Vault availability
-- itself, this has NOT been empirically verified live (no live DB access).
-- `all tables in schema net` (rather than naming specific tables) is
-- deliberate: pg_net's internal table names have changed across versions,
-- and this stays correct regardless of which version this project has.
revoke all on all tables in schema net from anon, authenticated;

-- Before this works end to end, store the Resend API key in Vault once, run
-- directly in the SQL editor (never committed anywhere, never the
-- service_role key -- this is Resend's own key):
--   select vault.create_secret('re_xxxxxxxx', 'resend_api_key', 'Resend API key for claim verification emails');
-- request_claim_code() below reads it back by that same name at send time.

-- =============================================================================
-- card_claim_verifications
-- Holds a pending, unconfirmed claim: the stashed sponsor details plus a
-- hashed one-time code. One row per card (a new code request replaces any
-- prior unconfirmed one for that card) -- see request_claim_code() below.
-- Real sponsor PII (name/email/phone) lives here temporarily, so this gets
-- the same "anon has zero direct access, only through a security definer
-- function" treatment as sponsors/assignments already have (see the comment
-- above those policies in 20260708120000_init.sql).
-- =============================================================================

create table card_claim_verifications (
  card_id uuid primary key references cards(id) on delete cascade,
  code_hash text not null,
  -- Opaque per-request token, returned to the caller by request_claim_code()
  -- and required back from claim_card_with_code(). card_id alone is public
  -- (it's on the /sponsor page), so without this, a second request_claim_code
  -- call for the same card -- anyone's, including the original sponsor's own
  -- resend from a second tab -- silently overwrites this row (see the
  -- on-conflict upsert below) and orphans whoever was already holding a
  -- valid, correct code: they'd get a confusing "wrong code" instead of a
  -- clear "someone requested a new code" message. See claim_card_with_code
  -- below for how the mismatch is reported.
  session_token uuid not null default gen_random_uuid(),
  sponsor_name text not null,
  sponsor_email text not null,
  sponsor_phone text,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

alter table card_claim_verifications enable row level security;
-- Deliberately NO policies at all -- not even a staff-read one. Nothing
-- outside the two security definer functions below has any business reading
-- unconfirmed codes or the sponsor details stashed alongside them. Also
-- explicitly revoke table-level grants rather than relying on RLS alone:
-- OPEN_QUESTIONS.md DB-2 found Supabase's platform silently auto-grants
-- `anon` (and, per the same default-privilege mechanism, potentially
-- `authenticated`) SELECT on new base tables regardless of this file's own
-- grant statements. This table never gets a `grant ... to authenticated`
-- line below, and this revoke closes that platform-default door explicitly
-- rather than assuming RLS is the only layer, since this table (unlike most)
-- holds raw sponsor PII with no confidentiality gate of its own.
revoke all on card_claim_verifications from anon, authenticated;

-- =============================================================================
-- request_claim_code
-- Re-runs claim_card's existing pre-checks (card not already claimed, family
-- not confidential, name required) so a sponsor can't get a code sent for an
-- invalid claim attempt, then generates + hashes a 6-digit code, stashes the
-- claim details, and fires the email via pg_net (fire-and-forget -- pg_net is
-- async by design; if delivery fails the sponsor just doesn't get an email
-- and can retry, same as any other email failure).
--
-- Returns the new row's session_token (uuid) -- the caller must hold onto it
-- and pass it back to claim_card_with_code(). This request always wins:
-- calling this again for the same card (whether it's the original sponsor
-- retrying/editing from another tab, or someone else entirely) always
-- generates a fresh token and invalidates any token issued by a prior call,
-- by design -- see the session_token column comment above and
-- claim_card_with_code below for how a stale token is reported.
-- =============================================================================

create or replace function public.request_claim_code(
  p_card_id uuid,
  p_sponsor_name text,
  p_sponsor_email text,
  p_sponsor_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already_claimed uuid;
  v_last_requested_at timestamptz;
  v_code text;
  v_api_key text;
  v_session_token uuid := gen_random_uuid();
begin
  if p_sponsor_name is null or btrim(p_sponsor_name) = '' then
    raise exception 'Sponsor name is required.';
  end if;

  -- Unlike claim_card's optional email, verification is the whole point here
  -- -- there is nothing to prove control of without one. DESIGN.md previously
  -- noted email was "required in the form, not the schema"; this function is
  -- the schema-level enforcement that note anticipated.
  if p_sponsor_email is null or btrim(p_sponsor_email) = '' then
    raise exception 'Sponsor email is required.';
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

  -- Abuse guard: refuse a second send within 60 seconds of the last one for
  -- this card, so the send button can't be hammered. Raises rather than
  -- silently no-opping so the caller gets feedback instead of a false
  -- "nothing happened" success.
  select created_at into v_last_requested_at
  from card_claim_verifications
  where card_id = p_card_id;

  if v_last_requested_at is not null and v_last_requested_at > now() - interval '60 seconds' then
    raise exception 'A code was just sent -- check your email (it can take a minute to arrive) before requesting another.';
  end if;

  -- Fetch (and fail on, if missing) the Vault secret BEFORE writing anything.
  -- This used to run after the insert/upsert below with a comment claiming
  -- "the row above is still written, so a retry works" -- that was wrong: an
  -- uncaught `raise exception` rolls back the entire function invocation,
  -- including writes earlier in the same call, so the row was never actually
  -- surviving that raise. Checking first avoids writing a row at all when
  -- there's nothing to send it with, rather than writing-then-discarding one.
  select decrypted_secret into v_api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key'
  limit 1;

  if v_api_key is null then
    raise exception 'Email delivery is not configured yet. Please contact staff.';
  end if;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  -- A new request supersedes any old unconfirmed one for this card: replace
  -- the code/details/expiry/session_token and reset attempts back to 0.
  insert into card_claim_verifications
    (card_id, code_hash, session_token, sponsor_name, sponsor_email, sponsor_phone, expires_at, attempts, created_at)
  values (
    p_card_id,
    crypt(v_code, gen_salt('bf')),
    v_session_token,
    btrim(p_sponsor_name),
    btrim(p_sponsor_email),
    nullif(btrim(coalesce(p_sponsor_phone, '')), ''),
    now() + interval '15 minutes',
    0,
    now()
  )
  on conflict (card_id) do update set
    code_hash = excluded.code_hash,
    session_token = excluded.session_token,
    sponsor_name = excluded.sponsor_name,
    sponsor_email = excluded.sponsor_email,
    sponsor_phone = excluded.sponsor_phone,
    expires_at = excluded.expires_at,
    attempts = 0,
    created_at = excluded.created_at;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_api_key
    ),
    body := jsonb_build_object(
      -- TODO(Grant): swap this for a real verified sending domain once one is
      -- set up in Resend. onboarding@resend.dev is Resend's own shared
      -- sandbox sender -- fine to get this working end to end, not meant to
      -- stay.
      'from', 'Reach Christmas <onboarding@resend.dev>',
      'to', jsonb_build_array(btrim(p_sponsor_email)),
      'subject', 'Confirm your gift claim',
      'text', 'Your verification code is: ' || v_code || E'\n\nEnter this code on the claiming page to confirm you want to sponsor this gift. It expires in 15 minutes.'
    )
  );
  -- pg_net.http_post is fire-and-forget: it queues the request and returns a
  -- request id immediately, not the HTTP response. Deliberately not awaited
  -- or checked here -- see SCHEMA.md for why that's fine.

  return v_session_token;
end;
$$;

grant execute on function public.request_claim_code(uuid, text, text, text) to anon, authenticated;

-- =============================================================================
-- claim_card_with_code
-- The sole path left to actually pledge a card (see the claim_card grant
-- change below). Verifies the code against the pending
-- card_claim_verifications row, then does exactly what claim_card used to do
-- directly: race-guard re-check, insert sponsor, insert assignment.
--
-- Returns jsonb, not uuid, deliberately: `{"ok": true, "sponsor_id": "..."}`
-- on success, `{"ok": false, "error": "..."}` on the four EXPECTED,
-- retryable failure modes (no pending verification, expired, too many
-- attempts, wrong code). Those four `return` a value instead of raising,
-- because a `raise exception` aborts the entire calling transaction --
-- including any write earlier in the *same* function call -- and the
-- wrong-code path specifically needs its `attempts = attempts + 1` write to
-- actually commit (an earlier version of this function raised there, which
-- silently discarded every attempt-count increment and meant the 5-attempt
-- cap never engaged -- a full brute-force bypass of this whole feature).
-- The remaining failure modes (already-claimed, confidential-card, the
-- unique_violation catch) still `raise`, matching claim_card's original
-- behavior -- those are genuine race conditions with no bookkeeping write
-- that needs to survive a rollback, so raising is fine there.
--
-- p_session_token must match card_claim_verifications.session_token for this
-- card (see that column's comment above). card_id alone is public, so
-- without this, a second request_claim_code() call for the same card --
-- anyone's, including the original sponsor's own resend from a second tab --
-- would silently invalidate whoever was already holding a valid, correct
-- code with no way to tell why. A mismatch is reported as its own distinct
-- "no longer active" error, NOT counted against the 5-attempt cap -- it
-- isn't a wrong-code guess, it's a stale session, and the caller's fix is
-- "request a new code," not "try again."
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
begin
  -- Guard against a NULL/blank code BEFORE the crypt() comparison below.
  -- crypt(NULL, ...) returns NULL, `code_hash <> NULL` evaluates to NULL, and
  -- `if NULL then` is treated as false in PL/pgSQL -- so without this check a
  -- NULL code would fall straight through the wrong-code branch and reach
  -- the success path having never actually been checked against anything.
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
    -- Someone (possibly the same sponsor, from another tab) requested a
    -- newer code for this card since this token was issued. Not a wrong
    -- guess -- don't touch `attempts`.
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

  -- From here on the code has been confirmed correct. The remaining checks
  -- are genuine race conditions (someone else claimed this card, or it
  -- became confidential, in the moments between requesting and confirming
  -- the code) -- these keep raising, same as claim_card always did, since
  -- there's no attempt-counter or other bookkeeping that needs to survive a
  -- rollback on these paths.
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
    values (p_card_id, v_sponsor_id, 'pledged', now());
  exception when unique_violation then
    raise exception 'This card was just claimed by someone else -- please pick another.';
  end;

  delete from card_claim_verifications where card_id = p_card_id;

  return jsonb_build_object('ok', true, 'sponsor_id', v_sponsor_id);
end;
$$;

grant execute on function public.claim_card_with_code(uuid, text, uuid) to anon, authenticated;

-- =============================================================================
-- claim_card: no longer directly callable by anon/authenticated.
-- Leaving this grant in place would let anyone skip verification entirely by
-- calling the old function directly, defeating the whole point of SPN-3. The
-- function itself is left defined (harmless, unreachable) rather than
-- dropped, since 20260708120000_init.sql is an already-applied migration and
-- this project's convention is additive-only migrations, never edits to one
-- already shipped.
-- =============================================================================

revoke execute on function public.claim_card(uuid, text, text, text) from anon, authenticated;
