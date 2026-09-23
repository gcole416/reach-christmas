-- US-42 (docs/backlog.md) — a daily "N households waiting for your review"
-- digest per school, instead of chasing counselors by hand. Prompted by Grant,
-- 2026-09-23. INTAKE_FORMS.md §11 specifies this shape directly: a daily
-- digest, never one email per submission.
--
-- Depends on 20260923120000 (US-41) for app_settings, counselor_emails, and
-- the Resend/Vault send path this reuses.
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  NOT YET APPLIED. Paste into the dev SQL editor (project
--         thvyntrxmahygesltgft — confirm the tab, .env.local points at prod).
--   PROD: NOT APPLIED, and must not be until a Software Acceptance Review.
--
-- =============================================================================
-- The security shape — read this before the reach-reviewer gate
-- =============================================================================
-- Every other security-definer function in this codebase is invoked by an
-- authenticated caller and checks is_admin() in its own body. pg_cron doesn't
-- work that way: the scheduled job runs as the database's own privileged role,
-- with no auth.uid() and nobody to check is_admin() against. is_admin() would
-- simply return false for every cron run and the digest would silently never
-- send -- that's not a security fix, it's a bug wearing one.
--
-- The actual guarantee has to come from a different direction: this function
-- takes NO caller-supplied parameter that selects a recipient, and its EXECUTE
-- grant is revoked from `public`, `anon`, AND `authenticated` -- nobody who can
-- merely sign in (or not) can call it as an RPC at all. The only path to it is
-- the cron job at the bottom of this file, invoked by the role pg_cron uses,
-- which bypasses grants entirely the same way the SQL editor's `postgres` role
-- does. Every recipient address inside the function body comes from
-- `schools.liaison_email`, the same source US-41 already restricted its own
-- send functions to. So the blast radius if this function were somehow ever
-- reachable is "it sends the exact digest it was already going to send" --
-- there's no parameter to redirect it anywhere else.
--
-- send_counselor_digests_now() below is the one exception, and it's the
-- opposite shape on purpose: is_admin()-gated, callable by an authenticated
-- admin, and it exists ONLY so staff (and e2e tests) can trigger a send
-- without waiting for the clock or faking cron. It does not take a recipient
-- parameter either -- it just runs the same school loop immediately.
--
-- =============================================================================
-- Other caveats (see 20260923120000's header for the ones this inherits)
-- =============================================================================
--   * pg_cron is a NEW operational dependency -- nothing else in this repo
--     uses it. `create extension if not exists pg_cron` fails loudly if it's
--     genuinely unavailable on this project, rather than silently not
--     scheduling anything -- same "fail loud, don't degrade quiet" call
--     20260818160000 made for pg_net/Vault.
--   * Same fire-and-forget pg_net limits as US-41: this function queues the
--     request and logs the send; it does not confirm delivery.
--   * pg_cron schedules in UTC and does not itself track daylight saving.
--     Church timezone confirmed (Grant, 2026-09-23): Central US. 13:00 UTC is
--     7:00 AM CST (Nov 1 - Mar 14, which covers essentially the whole season
--     this digest matters for -- registrations open 10/1, DST ends 11/1) or
--     8:00 AM CDT the rest of the year. Both are "early morning, before the
--     school day," so one fixed UTC hour is deliberately not adjusted twice a
--     year for this -- revisit only if the actual send time drifts somewhere
--     unreasonable.
--
-- reach-reviewer gate REQUIRED: new always-on scheduled job with database-wide
-- reach, touches review_tokens and form_submissions.

begin;

-- =============================================================================
-- 1. pg_cron.
-- =============================================================================
create extension if not exists pg_cron;

-- =============================================================================
-- 2. Per-school pause toggle.
-- =============================================================================
-- On drive_schools, not schools: this is a per-DRIVE setting, same reasoning
-- as distribution_method already on this table -- a school might want digests
-- one season and not the next, and schools rows carry over year to year while
-- drive_schools is the per-drive membership row.
alter table drive_schools add column if not exists digest_paused boolean not null default false;

comment on column drive_schools.digest_paused is
  'US-42: when true, send_counselor_digests() skips this school entirely, '
  'even if it has pending submissions. A daily recurring email to someone who '
  'does not work for the church needs an off switch that does not require '
  'revoking their review link.';

-- =============================================================================
-- 3. send_counselor_digests() -- the scheduled body. See the header above for
--    why this is NOT is_admin()-gated and is not meant to be callable as an
--    RPC at all.
-- =============================================================================
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

-- Nobody gets to call this as an RPC -- not anon, not a signed-in volunteer,
-- not a signed-in admin. See the header. The cron job below invokes it as the
-- role pg_cron runs jobs as, which bypasses grants the same way `postgres`
-- does in the SQL editor.
revoke execute on function public.send_counselor_digests() from public, anon, authenticated;

-- =============================================================================
-- 4. send_counselor_digests_now() -- admin-triggered manual run.
--    Opposite shape from #3 on purpose: is_admin()-gated, so staff (and e2e
--    tests) can fire a digest immediately without waiting on the clock or
--    faking cron. Takes no recipient parameter either -- it runs the exact
--    same school loop send_counselor_digests() does, just on demand.
-- =============================================================================
create or replace function public.send_counselor_digests_now()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only an administrator can send the review digest.';
  end if;
  perform public.send_counselor_digests();
end;
$$;

revoke execute on function public.send_counselor_digests_now() from public, anon;
grant execute on function public.send_counselor_digests_now() to authenticated;

-- =============================================================================
-- 5. Schedule.
-- =============================================================================
-- 13:00 UTC = 7:00 AM Central Standard Time (Nov-Mar, the bulk of this
-- digest's actual season) / 8:00 AM Central Daylight Time otherwise -- see
-- this file's header for the DST reasoning. Confirmed with Grant, 2026-09-23.
select cron.schedule(
  'counselor-review-digest',
  '0 13 * * *',
  $$select public.send_counselor_digests();$$
);

commit;

-- VERIFY (run after applying, dev only):
--
-- 1. select * from cron.job where jobname = 'counselor-review-digest';
--
-- 2. As a signed-in ADMIN session, on a school with >=1 submission in
--    'submitted'/'under_review', a live review link, and a liaison email you
--    can check:
--    select send_counselor_digests_now();
--    select * from counselor_emails where kind = 'review_digest'
--      order by created_at desc limit 5;   -- one new row, sent_by null
--
-- 3. As a VOLUNTEER session: select send_counselor_digests_now();
--    -> raises 'Only an administrator can send the review digest.'
--
-- 4. As an anon/no-auth client, or via `set local role authenticated;`:
--    select send_counselor_digests();
--    -> permission denied for function send_counselor_digests (no EXECUTE grant)
--
-- 5. A school with 0 pending submissions, or digest_paused = true, or no
--    liaison_email, gets no row after step 2's run.
--
-- 6. To pause a school: update drive_schools set digest_paused = true where id = '<id>';
