-- Kill a counselor review link and issue its replacement, in one step
-- (2026-10-19, Grant).
--
-- Why: the counselor handout tells counselors to contact OneLife Church right
-- away if their review link is shared by mistake, or when they change roles.
-- Until now nothing in the app could act on that. issue_review_token() is
-- idempotent per school (it hands back the existing live link), and the staff
-- panel had no revoke for review links, so shutting a leaked one off meant raw
-- SQL. A review link reads the school's whole-season roster of children's first
-- names, ages and grades, so this needs to be quick for staff.
--
-- Decision (Grant, 2026-10-19): one action that kills the old link and replaces
-- it with a new one, a couple of deliberate clicks in the UI, not easy to do by
-- accident. The UI side (web/app/admin/submissions/FormLinkPanel.tsx) is a
-- "Replace link" button that opens a confirm box with an acknowledgement
-- checkbox before the final button enables.
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  APPLIED 2026-10-20.
--   PROD: NOT APPLIED, and must not be until a Software Acceptance Review, same
--         as every intake migration.
--
-- Re-runnable: `create or replace function`, grants re-issued.
--
-- =============================================================================
-- replace_review_token(review_token_id, issued_to_email?)
-- =============================================================================
-- Caller: an authenticated admin (checked in-body, same as issue_review_token).
-- Volunteers can't see review_tokens at all (admin-only SELECT policy), and this
-- function refuses them too.
--
-- All or nothing, in one transaction:
--   1. Lock the link the admin is looking at (FOR UPDATE). If it's already
--      revoked, someone else replaced it first (or this is a double-click):
--      return 'already_replaced' and change nothing, so two clicks can never
--      chain into two replacements.
--   2. Revoke EVERY live review link for that school, not just this one, so the
--      "one live link per school" invariant issue_review_token relies on holds
--      even if a stray second row ever existed.
--   3. Mint a new token exactly the way issue_review_token does (32 random
--      bytes, url-safe, plaintext + bcrypt hash) and insert it.
-- If step 3 fails, step 2 rolls back with it: a school never ends up with its
-- old link dead and no new one.
--
-- Effect on the counselor: get_review_roster / verify_submission /
-- reject_submission all filter `revoked_at is null`, so the old link stops
-- working on the very next request and shows the existing "link no longer
-- works" page. Confirmations already made through it are kept (they live on
-- form_submissions, not here). The counselor-email and digest functions pick
-- the newest live token per school, so they send the new link from now on.
--
-- p_issued_to_email: optional. Blank keeps the old link's email. NOTE (from the
-- reach-reviewer gate): issued_to_email is informational only. Every send
-- (send_counselor_review_link, the daily digest) goes to schools.liaison_email,
-- so the staff UI deliberately doesn't pass a new address here, and the confirm
-- box tells staff where the new link will actually be emailed. Expiry carries
-- over from the old link if it's still in the future, else the same default
-- issue_review_token uses.
--
-- Shape:
--   { "ok": true,  "token": "...", "review_path": "/review/...",
--     "expires_at": "...", "issued_to_email": "...", "revoked_count": n }
--   { "ok": false, "error": "<text>", "reason":
--       "forbidden"|"not_found"|"confidential"|"already_replaced" }
create or replace function public.replace_review_token(
  p_review_token_id uuid,
  p_issued_to_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old review_tokens%rowtype;
  v_year int;
  v_email text;
  v_token text;
  v_expires timestamptz;
  v_revoked int;
begin
  if not is_admin() then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only an administrator can replace a counselor review link.',
      'reason', 'forbidden'
    );
  end if;

  select * into v_old
  from review_tokens
  where id = p_review_token_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'That review link no longer exists. Refresh the page.',
      'reason', 'not_found'
    );
  end if;

  -- Same rule as issue_review_token: school links only. A null-school token is
  -- the confidential/staff queue, which the staff panel never shows as a
  -- counselor link and get_review_roster refuses to serve.
  if v_old.drive_school_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only a school''s counselor review link can be replaced here.',
      'reason', 'confidential'
    );
  end if;

  if v_old.revoked_at is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'This link was already replaced. Refresh the page to see the current one.',
      'reason', 'already_replaced'
    );
  end if;

  v_email := coalesce(nullif(btrim(coalesce(p_issued_to_email, '')), ''), v_old.issued_to_email);

  select d.year into v_year
  from drive_schools ds
  join drives d on d.id = ds.drive_id
  where ds.id = v_old.drive_school_id;

  v_expires := case
    when v_old.expires_at > now() + interval '1 day' then v_old.expires_at
    else greatest(
      make_timestamptz(coalesce(v_year, extract(year from now())::int), 12, 31, 23, 59, 59),
      now() + interval '30 days'
    )
  end;

  update review_tokens
  set revoked_at = now()
  where drive_school_id = v_old.drive_school_id
    and revoked_at is null;
  get diagnostics v_revoked = row_count;

  v_token := rtrim(
    replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'),
    '='
  );

  insert into review_tokens (
    drive_id, drive_school_id, token, token_hash,
    issued_to_email, issued_by, expires_at, is_test_data
  )
  values (
    v_old.drive_id, v_old.drive_school_id, v_token,
    extensions.crypt(v_token, extensions.gen_salt('bf')),
    v_email, auth.uid(), v_expires, v_old.is_test_data
  );

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'review_path', '/review/' || v_token,
    'expires_at', v_expires,
    'issued_to_email', v_email,
    'revoked_count', v_revoked
  );
end;
$$;

revoke execute on function public.replace_review_token(uuid, text) from public, anon;
grant execute on function public.replace_review_token(uuid, text) to authenticated;
