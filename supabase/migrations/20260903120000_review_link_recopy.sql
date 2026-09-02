-- US-28 — let admins re-copy a counselor review link from the staff UI.
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  NOT YET APPLIED. Paste into the dev SQL editor (project
--         thvyntrxmahygesltgft — confirm the tab, .env.local points at prod).
--   PROD: NOT APPLIED, and must not be until a Software Acceptance Review, same
--         as 20260830120000_intake_forms.sql. Prod has no intake data at all.
--
-- Written to be re-runnable: `add column if not exists`, `create index if not
-- exists`, `drop policy if exists` before create, `create or replace function`.
--
-- =============================================================================
-- What this changes, and the trade-off it accepts
-- =============================================================================
-- 20260830120000_intake_forms.sql stores review tokens as a bcrypt hash ONLY,
-- with no select policy, so the plaintext is unrecoverable after issue time.
-- The reason is in that file at the review_tokens policy: a review token is the
-- key to a school's whole-season roster of children's first names, ages and
-- grades, and "a database leak must not hand over a working key."
--
-- Product decision (2026-09-03, Grant, owner): staff need to re-send that link
-- to a counselor throughout the season without re-issuing it, so it must be
-- visible and copyable from the admin dashboard. That means storing the
-- plaintext. The exposure if the database leaks: someone with a token could
-- open /review/<token> and see first name + age + grade for that school's
-- registered kids -- no last names, no addresses, no confidential families, and
-- roughly the tier of data public_available_cards already serves the open
-- internet. Bounded, and accepted deliberately.
--
-- The three counselor-facing functions (get_review_roster / verify_submission /
-- reject_submission) are LEFT UNTOUCHED. They still match on token_hash, and
-- issue_review_token below writes BOTH columns for every new row. Keeping the
-- hash match means this migration doesn't reopen those three audited functions
-- just to change a WHERE clause -- the new surface for review is small.

-- ---------------------------------------------------------------------------
-- 1. The plaintext column
-- ---------------------------------------------------------------------------
alter table review_tokens add column if not exists token text;

comment on column review_tokens.token is
  'Plaintext review token, url-safe. Present on rows issued via issue_review_token() '
  '(20260903120000). Null on any legacy hash-only row. token_hash is still written '
  'and is still what the counselor functions match on.';

-- Unique, but many nulls are fine (legacy rows, and the column is nullable).
create unique index if not exists review_tokens_token_key on review_tokens (token);

-- ---------------------------------------------------------------------------
-- 2. Staff can now READ review_tokens (the whole point)
-- ---------------------------------------------------------------------------
-- Same confidential gate as form_links / form_submissions: an uncleared
-- volunteer never sees a confidential-channel (null-school) row, and in fact a
-- volunteer sees nothing here at all -- the policy requires is_admin().
drop policy if exists "admin read review_tokens" on review_tokens;
create policy "admin read review_tokens" on review_tokens for select to authenticated
  using (is_admin() and (drive_school_id is not null or can_view_confidential()));

grant select on review_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- 3. issue_review_token(drive_school_id, issued_to_email, expires_at?)
-- ---------------------------------------------------------------------------
-- Caller: an authenticated admin (checked in-body, like import_submission).
--
-- IDEMPOTENT per school: if a live (not revoked, not expired) token already
-- exists for the school, it is RETURNED rather than a second one minted. So the
-- staff UI calls this both to "create" and to "get the existing link", and a
-- double-click can't scatter tokens.
--
-- The token is minted here, server-side, at 32 bytes of entropy -- never typed
-- by a human -- which is the entropy floor get_review_roster's L2 note asks for
-- before review links are issued at scale.
--
-- Shape:
--   { "ok": true,  "token": "...", "review_path": "/review/...",
--     "expires_at": "...", "reused": true|false }
--   { "ok": false, "error": "<text>", "reason":
--       "forbidden"|"unknown_school"|"email_required"|"confidential" }
create or replace function public.issue_review_token(
  p_drive_school_id uuid,
  p_issued_to_email text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drive_id uuid;
  v_year int;
  v_email text := nullif(btrim(coalesce(p_issued_to_email, '')), '');
  v_existing record;
  v_token text;
  v_expires timestamptz;
begin
  if not is_admin() then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only an administrator can issue a counselor review link.',
      'reason', 'forbidden'
    );
  end if;

  -- School links only. A null-school token is the confidential/staff queue,
  -- which get_review_roster deliberately refuses to serve as a counselor
  -- roster -- issuing one here would be a dead link.
  if p_drive_school_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'A counselor review link needs a school.',
      'reason', 'confidential'
    );
  end if;

  select ds.drive_id, d.year
    into v_drive_id, v_year
  from drive_schools ds
  join drives d on d.id = ds.drive_id
  where ds.id = p_drive_school_id;

  if v_drive_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'That school is not part of a drive.',
      'reason', 'unknown_school'
    );
  end if;

  if v_email is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'An email address for the counselor is required.',
      'reason', 'email_required'
    );
  end if;

  -- Reuse a live token if the school already has one.
  select rt.* into v_existing
  from review_tokens rt
  where rt.drive_school_id = p_drive_school_id
    and rt.token is not null
    and rt.revoked_at is null
    and rt.expires_at > now()
  order by rt.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'token', v_existing.token,
      'review_path', '/review/' || v_existing.token,
      'expires_at', v_existing.expires_at,
      'reused', true
    );
  end if;

  -- 32 bytes -> url-safe base64, no padding. ~43 chars, comfortably over the
  -- 16-char floor form_links.token carries.
  v_token := rtrim(
    replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'),
    '='
  );

  -- Default: end of the drive's year (INTAKE_FORMS §3 -- "expire at drive close,
  -- not 7 days"). Never issue an already-expired link: if the drive year is
  -- somehow in the past, fall back to 30 days out.
  v_expires := coalesce(
    p_expires_at,
    greatest(
      make_timestamptz(v_year, 12, 31, 23, 59, 59),
      now() + interval '30 days'
    )
  );

  insert into review_tokens (
    drive_id, drive_school_id, token, token_hash,
    issued_to_email, issued_by, expires_at
  )
  values (
    v_drive_id, p_drive_school_id, v_token,
    extensions.crypt(v_token, extensions.gen_salt('bf')),
    v_email, auth.uid(), v_expires
  );

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'review_path', '/review/' || v_token,
    'expires_at', v_expires,
    'reused', false
  );
end;
$$;

revoke execute on function public.issue_review_token(uuid, text, timestamptz) from public, anon;
grant execute on function public.issue_review_token(uuid, text, timestamptz) to authenticated;

-- =============================================================================
-- VERIFY (run after applying, dev only)
-- =============================================================================
-- 1. Column + index exist.
--   select column_name from information_schema.columns
--   where table_name = 'review_tokens' and column_name = 'token';
--   -- expect: token
--
-- 2. The select policy is admin-gated (2 policies expected: insert + update
--    from the first migration, plus this select).
--   select policyname, cmd from pg_policies where tablename = 'review_tokens' order by cmd;
--   -- expect: SELECT (admin read review_tokens), INSERT, UPDATE
--
-- 3. issue is admin-only. As a signed-in VOLUNTEER session (not the SQL editor,
--    which runs as postgres and bypasses everything):
--   select public.issue_review_token(
--     (select id from drive_schools limit 1), 'x@example.com');
--   -- expect: {"ok": false, "reason": "forbidden", ...}
--
-- 4. As a signed-in ADMIN session, twice for the same school:
--   select public.issue_review_token(
--     (select id from drive_schools where drive_school_id is not null limit 1),
--     'counselor@example.com');
--   -- expect first call reused:false, second call reused:true, SAME token.
--
-- 5. The issued token actually works as a roster key:
--   select public.get_review_roster('<token from step 4>');
--   -- expect: {"ok": true, "school_name": "...", ...}
--
-- 6. grants: issue_review_token executable by authenticated, not anon.
--   select p.proname, r.rolname
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   cross join lateral aclexplode(p.proacl) a
--   join pg_roles r on r.oid = a.grantee
--   where n.nspname = 'public' and p.proname = 'issue_review_token';
--   -- expect: authenticated (EXECUTE). NOT anon, NOT public.
