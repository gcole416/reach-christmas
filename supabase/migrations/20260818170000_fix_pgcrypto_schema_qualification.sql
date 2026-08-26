-- Fixes a live bug found by qa-tester's first real end-to-end run of SPN-3
-- against dev (Grant applied 20260818160000_email_verified_claims.sql and
-- stored a real Resend key; this was the first time this code path ever
-- actually executed against real Supabase Cloud Postgres). request_claim_code()
-- failed with `42883: function gen_salt(unknown) does not exist`.
--
-- pgcrypto is installed on this project, but request_claim_code()'s and
-- claim_card_with_code()'s `set search_path = public` doesn't include
-- whatever schema pgcrypto's functions actually live in. ASSUMPTION, not
-- empirically verified before writing this (same "no live DB access" caveat
-- as every migration written this session): Supabase's documented convention
-- is that extensions install into a schema called `extensions` on hosted
-- projects, not `public` -- which lines up with this exact symptom. qa-tester
-- has live access and will verify the actual schema name and confirm this
-- fix works before Grant applies it; if `extensions` turns out to be wrong,
-- expect a follow-up migration correcting the schema name.
--
-- Fix is schema-qualifying every pgcrypto call site explicitly
-- (`extensions.crypt(...)`, `extensions.gen_salt(...)`) rather than widening
-- search_path to include a guessed schema name -- explicit qualification
-- doesn't depend on guessing right about what's actually on the path, and is
-- also just clearer at each call site about which extension a function comes
-- from. Bodies are otherwise byte-for-byte identical to
-- 20260818160000_email_verified_claims.sql (an already-applied migration --
-- not edited in place, per this project's additive-only convention) -- diff
-- is exactly the schema qualification on the three pgcrypto call sites (one
-- `gen_salt` inside a `crypt` call in request_claim_code, one `crypt` call in
-- each of the two functions).

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
    extensions.crypt(v_code, extensions.gen_salt('bf')),
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

  if v_verification.code_hash <> extensions.crypt(btrim(p_code), v_verification.code_hash) then
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
