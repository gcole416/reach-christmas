-- Meeting ask, 2026-10 cleanup pass: "automate sending sponsors their
-- cards" -- scoped by Grant to mean attaching the actual printable card
-- (same content as /admin/print: card number, name, grade, sizes, wish
-- list, specific needs) as a PDF on the existing sponsor thank-you email
-- (US-43, 20260930120000), rather than a second email or a new workflow.
--
-- Builds on 20261015120000 (the crypt() regression fix) -- this migration's
-- copy of claim_card_with_code starts from THAT corrected body, not the
-- buggy 20260930120000 one, so the pgcrypto fix isn't lost a second time.
--
-- =============================================================================
-- What this adds
-- =============================================================================
--   * app_settings gains one column: edge_functions_url -- this project's
--     Supabase Edge Functions base URL (e.g.
--     https://<project-ref>.supabase.co/functions/v1), the same
--     "ordinary per-environment config" pattern dropoff_location/days/
--     deadline already used (20260930120000) and site_url before that
--     (20260923120000). NULL by default -- deliberately, not a placeholder
--     string, because the best-effort block below treats NULL as "feature
--     not wired up yet" and skips it the same way a missing Resend key
--     already does, rather than sending a broken request.
--   * claim_card_with_code's thank-you step now calls a new Edge Function,
--     send-sponsor-card-email (supabase/functions/send-sponsor-card-email),
--     instead of Resend directly. That function renders the PDF (Postgres
--     can't) and makes the actual Resend call itself, attachment included.
--     See that function's header for the full why/how, including the
--     deploy steps Grant still needs to run by hand.
--   * The call is authenticated with a shared secret rather than a
--     Supabase JWT (pg_net has no end-user session to forward) -- a new
--     Vault secret, internal_webhook_secret, sent as the x-internal-secret
--     header. Set it the same way resend_api_key was set (20260818160000's
--     header):
--       select vault.create_secret('<openssl rand -hex 32 output>', 'internal_webhook_secret', 'Shared secret claim_card_with_code sends to send-sponsor-card-email so only we can trigger it.');
--     Then set the SAME value as that Edge Function's own
--     INTERNAL_WEBHOOK_SECRET secret (`supabase secrets set
--     INTERNAL_WEBHOOK_SECRET=...`) -- two copies of one value, one per
--     side, because Postgres reads Vault and Edge Functions read Deno.env;
--     there's no single store both sides share.
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  APPLIED 2026-10-19. Also requires manual setup beyond this file --
--         see send-sponsor-card-email's header and the VERIFY section below.
--   PROD: NOT APPLIED, and must not be until a Software Acceptance Review,
--         same as every other intake/claim migration.
--
-- Caveats (same shape as 20260930120000's):
--   * Best-effort, same as the rest of this step: if the Edge Function call
--     fails or isn't configured, the claim still succeeds; the sponsor just
--     doesn't get a card PDF (or, if edge_functions_url/the Vault secret
--     aren't set, doesn't get the thank-you step attempted at all).
--   * sponsor_emails still logs a 'thank_you' row on every attempt, same as
--     before -- it means "we asked for one to be sent," not "Resend
--     confirmed delivery," same caveat as always.
--   * No retry, no admin alert on failure -- check the Edge Function's logs
--     in the Supabase dashboard if a sponsor says they never got a card.
--
-- reach-reviewer gate REQUIRED: edits claim_card_with_code (the sole public
-- claim path); new outbound call carrying a child's first name/grade/
-- sizes/wishlist to a new destination (our own Edge Function, which then
-- forwards it to Resend as before -- same data, same privacy whitelist,
-- new hop).

begin;

alter table app_settings add column if not exists edge_functions_url text;

comment on column app_settings.edge_functions_url is
  'This project''s Supabase Edge Functions base URL, e.g. '
  'https://<project-ref>.supabase.co/functions/v1. NULL until Grant sets it '
  '-- claim_card_with_code treats NULL as "not wired up yet" and skips the '
  'PDF-card email step silently, same as a missing Resend key always did.';

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
  -- Thank-you email step only (best-effort -- see this migration's header).
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
  v_edge_functions_url text;
  v_webhook_secret text;
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

  -- Schema-qualified per 20260818170000 / re-fixed 20261015120000 -- do not
  -- drop the extensions. prefix here again.
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

  -- Thank-you email, now with the card PDF attached -- best-effort, see this
  -- migration's header. Nothing in this block may prevent the function from
  -- reaching the success return below.
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

    select dropoff_location, dropoff_days, dropoff_deadline, edge_functions_url
    into v_dropoff_location, v_dropoff_days, v_dropoff_deadline, v_edge_functions_url
    from app_settings limit 1;

    select decrypted_secret into v_webhook_secret
    from vault.decrypted_secrets
    where name = 'internal_webhook_secret'
    limit 1;

    if v_webhook_secret is not null and v_edge_functions_url is not null and v_drive_id is not null then
      perform net.http_post(
        -- rtrim guards a trailing slash on the operator-set URL (an easy
        -- copy-paste mistake from the dashboard) -- without it a trailing
        -- slash produces a double slash that 404s. Caught by this block's
        -- exception handler either way (fails safe, not silent corruption),
        -- but this avoids the failure mode entirely rather than just
        -- tolerating it.
        url := rtrim(v_edge_functions_url, '/') || '/send-sponsor-card-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-secret', v_webhook_secret
        ),
        body := jsonb_build_object(
          'sponsor_name', v_verification.sponsor_name,
          'sponsor_email', btrim(v_verification.sponsor_email),
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
      values (v_drive_id, v_assignment_id, 'thank_you', v_verification.sponsor_email);
    end if;
  exception when others then
    -- Best-effort: a missing Vault secret, a missing edge_functions_url, an
    -- app_settings hiccup, anything -- never let the email step turn a
    -- successful claim into a failure.
    null;
  end;

  return jsonb_build_object('ok', true, 'sponsor_id', v_sponsor_id);
end;
$$;

grant execute on function public.claim_card_with_code(uuid, text, uuid) to anon, authenticated;

commit;

-- VERIFY (run after applying AND after completing the manual setup in
-- send-sponsor-card-email's header -- deploy the function, set its two
-- secrets, create the Vault secret, and set app_settings.edge_functions_url):
--
-- 1. Set the Edge Functions base URL once (find it under Settings -> API in
--    the Supabase dashboard). No trailing slash needed either way (the
--    function now strips one if pasted in), but set it without one:
--    update app_settings set edge_functions_url = 'https://<project-ref>.supabase.co/functions/v1';
--
-- 2. As a genuinely signed-out client (see US-17 guardrails), claim a
--    non-confidential, non-high-schooler card end to end with a real inbox:
--    request_claim_code(...) then claim_card_with_code(...) with the code
--    from the verification email. Confirm the thank-you email arrives WITH
--    a PDF attachment named card-<number>.pdf, and that the PDF shows the
--    same first name/grade/sizes/wishlist/specific needs the text body
--    does -- nothing more (no last name, no school, no address).
--
-- 3. select * from sponsor_emails order by created_at desc limit 1; -- one
--    row for that claim, kind = 'thank_you', same as before.
--
-- 4. Confirm the claim still succeeds with edge_functions_url temporarily
--    cleared (simulates "not deployed yet"): expect {"ok": true, ...} and
--    no sponsor_emails row for that claim -- the email step must degrade
--    silently, not block the claim, same as every other best-effort step
--    in this function.
--
-- 5. Confirm a request to the Edge Function with a wrong or missing
--    x-internal-secret header is rejected (401) -- e.g. curl it directly
--    without the header and confirm it does NOT send an email.
