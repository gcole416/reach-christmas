-- US-42 follow-up (docs/backlog.md) — a per-school cooldown on the review
-- digest. Found while writing counselor-email.spec.ts (2026-09-23):
-- send_counselor_digests()/send_counselor_digests_now() had no rate limit at
-- all, unlike send_counselor_registration_link/send_counselor_review_link in
-- 20260923120000, which both refuse a repeat within 60 seconds. A school with
-- pending submissions got re-digested every single time either function ran —
-- the daily pg_cron schedule alone is fine, but nothing stopped
-- send_counselor_digests_now() being clicked twice by staff, or called again
-- while testing during a real season, from mailing the same counselor twice.
--
-- Requested by Grant, 2026-09-23: 5 minutes minimum.
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  APPLIED (verified 2026-10-20; docs/MIGRATION_LEDGER.md is the record).
--   PROD: NOT APPLIED, and must not be until a Software Acceptance Review,
--         same as every other intake migration.
--
-- =============================================================================
-- What this changes
-- =============================================================================
-- `create or replace function public.send_counselor_digests()` — identical to
-- 20260923130000's version with ONE added guard, inside the per-school loop,
-- right after the "0 pending -> skip" check and before composing the email:
-- skip (continue) if a `review_digest` row for this drive_school_id already
-- exists in counselor_emails within the last 5 minutes. Same shape as the
-- cooldown on the other two send functions, just a longer window since this
-- one can fire unattended on a schedule rather than only from a deliberate
-- staff click.
--
-- send_counselor_digests_now() is UNCHANGED and needs no edit: it only ever
-- calls send_counselor_digests(), so the cooldown protects both the cron path
-- and the manual path automatically, from one place.
--
-- No new column, no new table -- this reads the same counselor_emails log
-- 20260923120000 already writes to (kind = 'review_digest' rows, which only
-- this function ever inserts).
--
-- reach-reviewer gate REQUIRED: this is a `create or replace` on a function
-- the mandatory US-42 gate already covers, touching the same security-shaped
-- code (still no is_admin() check, still no caller-supplied recipient) --
-- worth a second look specifically on whether the added subquery changes that
-- shape. It doesn't: the guard only reads counselor_emails, which nothing here
-- newly exposes.

begin;

create or replace function public.send_counselor_digests()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_url text;
  v_api_key  text;
  v_row      record;
  v_count    int;
  v_oldest   timestamptz;
begin
  select site_url into v_site_url from app_settings limit 1;
  if v_site_url is null or btrim(v_site_url) = '' then
    return; -- not configured; nothing to do, no partial sends
  end if;

  select decrypted_secret into v_api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key'
  limit 1;

  if v_api_key is null then
    return;
  end if;

  for v_row in
    select
      ds.id as drive_school_id,
      ds.drive_id,
      s.name as school_name,
      s.liaison_email,
      rt.token as review_token
    from drive_schools ds
    join schools s on s.id = ds.school_id
    join drives d on d.id = ds.drive_id
    join lateral (
      select token
      from review_tokens rt2
      where rt2.drive_school_id = ds.id
        and rt2.revoked_at is null
        and rt2.expires_at > now()
        and rt2.token is not null
      order by rt2.created_at desc
      limit 1
    ) rt on true
    where d.status = 'open'
      and not ds.digest_paused
      and s.liaison_email is not null
      and btrim(s.liaison_email) <> ''
  loop
    select count(*), min(coalesce(submitted_at, created_at))
      into v_count, v_oldest
    from form_submissions
    where drive_school_id = v_row.drive_school_id
      and status in ('submitted', 'under_review');

    -- Never send a "0 waiting" email.
    continue when v_count = 0;

    -- 5-minute-minimum per-school cooldown (this migration). Covers both the
    -- daily cron call and send_counselor_digests_now() -- whichever ran most
    -- recently for this school blocks the other for 5 minutes, not just
    -- itself.
    continue when exists (
      select 1 from counselor_emails
      where drive_school_id = v_row.drive_school_id
        and kind = 'review_digest'
        and created_at > now() - interval '5 minutes'
    );

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_api_key
      ),
      body := jsonb_build_object(
        'from', 'Reach Christmas <onboarding@resend.dev>',
        'to', jsonb_build_array(btrim(v_row.liaison_email)),
        'subject',
          v_count || ' household' || (case when v_count = 1 then '' else 's' end) ||
          ' waiting for your review -- ' || v_row.school_name,
        'text',
          v_count || ' household' || (case when v_count = 1 then ' is' else 's are' end) ||
          ' waiting for your confirmation at ' || v_row.school_name ||
          ', the oldest since ' || to_char(v_oldest, 'FMMonth DD') || '.' || E'\n\n' ||
          'Review them here: ' || rtrim(v_site_url, '/') || '/review/' || v_row.review_token ||
          E'\n\n' || 'Thank you for partnering with us this season.'
      )
    );

    insert into counselor_emails (drive_id, drive_school_id, kind, sent_to, sent_by)
    values (v_row.drive_id, v_row.drive_school_id, 'review_digest', v_row.liaison_email, null);
  end loop;
end;
$$;

-- `create or replace function` keeps the existing grants (there are none to
-- reissue here -- 20260923130000 revoked execute from public/anon/authenticated
-- and never granted it back; that's untouched by this migration).

commit;

-- VERIFY (run after applying, dev only):
--
-- 1. As a signed-in ADMIN session, on a school with >=1 submission in
--    'submitted'/'under_review', a live review link, and a liaison email:
--    select send_counselor_digests_now();
--    select * from counselor_emails where kind = 'review_digest'
--      order by created_at desc limit 3;   -- one new row
--
-- 2. Immediately run it again:
--    select send_counselor_digests_now();
--    select count(*) from counselor_emails where kind = 'review_digest'
--      and created_at > now() - interval '1 minute';
--    -- still just the ONE row from step 1 -- no second send.
--
-- 3. Everything else (paused school, no liaison email, non-admin refusal,
--    the not-directly-callable check on send_counselor_digests() itself) is
--    unchanged from 20260923130000's own VERIFY block -- still holds.
