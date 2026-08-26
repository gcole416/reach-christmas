-- Fixes an off-by-one in claim_card_with_code's wrong-code attempt cap, found
-- by qa-tester's e2e suite once the pgcrypto fix (20260818170000) made the
-- code-comparison path reachable for the first time.
--
-- The cap check (`attempts >= 5`) ran BEFORE the wrong-code increment, so the
-- 5th wrong guess still incremented attempts to 5 and returned the plain
-- "doesn't match" message -- lockout only showed up on a 6th submission. The
-- intent everywhere else this feature is described (SCHEMA.md, the migration
-- comments, the e2e test title "five wrong guesses locks session") is that
-- five wrong guesses IS the lockout, not six.
--
-- Fix: after incrementing on a wrong guess, check whether the new count has
-- reached the cap and report "too many attempts" on that same call instead of
-- "doesn't match" if so. Only claim_card_with_code changes; request_claim_code
-- is untouched, not reissued here.

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

    -- This guess is the one that pushed attempts to the cap: report the
    -- lockout now rather than waiting for a 6th submission to notice.
    if v_verification.attempts + 1 >= 5 then
      return jsonb_build_object('ok', false, 'error', 'Too many attempts. Request a new code.');
    end if;

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
