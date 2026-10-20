-- Prod setup, run ONCE on the fresh prod project, after all 34 migrations.
-- Step 2.4 of docs/PROD_LAUNCH_CHECKLIST.md. Written 2026-10-20.
--
-- What it does:
--   1. Points app_settings at prod's own website (site_url) and the real
--      Church Center sign-up page. Edit the two values in the block below.
--   2. Email-off launch (Grant, 2026-10-20): removes the daily counselor
--      digest schedule that 20260923130000 created. Nothing else on prod sends
--      email on its own: the Vault key isn't stored and the Edge Functions
--      aren't deployed until the "turn email on" section of the checklist.
--   3. Read-only checks that prod is clean and complete.
--
-- What it never does: create schools, households, sponsors, or test data.
-- Those are entered in the app (checklist step 4). Nothing from dev comes here.
--
-- Prod only after the review clears it (your standing rule). Re-runnable.

do $prod_setup$
declare
  -- ▼▼▼ EDIT THESE TWO ▼▼▼
  v_site_url text := 'https://REPLACE-WITH-PROD-URL.vercel.app';
  v_church_center_url text := 'https://REPLACE-WITH-CHURCH-CENTER-SIGNUP-LINK';
  -- ▲▲▲
begin
  if v_site_url like '%REPLACE%' or v_church_center_url like '%REPLACE%' then
    raise exception 'Edit v_site_url and v_church_center_url at the top of this script first.';
  end if;

  update app_settings
  set site_url = rtrim(v_site_url, '/'),
      church_center_signup_url = v_church_center_url;
  raise notice 'app_settings: site_url and church_center_signup_url set.';

  if exists (select 1 from cron.job where jobname = 'counselor-review-digest') then
    perform cron.unschedule('counselor-review-digest');
    raise notice 'Daily counselor digest unscheduled (email-off launch).';
  else
    raise notice 'Daily counselor digest was not scheduled; nothing to remove.';
  end if;
end $prod_setup$;

-- ---------------------------------------------------------------------------
-- Checks. Every row should read ok = true.
-- ---------------------------------------------------------------------------
select check_name, ok, detail from (
  select 1 as n, 'site_url set to prod' as check_name,
         (select site_url from app_settings) not like '%localhost%'
           and (select site_url from app_settings) <> '' as ok,
         (select site_url from app_settings) as detail
  union all
  select 2, 'Church Center link set',
         coalesce((select church_center_signup_url from app_settings), '') <> '',
         (select church_center_signup_url from app_settings)
  union all
  select 3, 'digest not scheduled (email off)',
         not exists (select 1 from cron.job where jobname = 'counselor-review-digest'),
         null
  union all
  select 4, 'no Resend key in Vault yet (email off)',
         not exists (select 1 from vault.secrets where name = 'resend_api_key'),
         null
  union all
  select 5, 'extensions present: pgcrypto, pg_net, pg_cron, supabase_vault',
         (select count(*) from pg_extension
            where extname in ('pgcrypto', 'pg_net', 'pg_cron', 'supabase_vault')) = 4,
         (select string_agg(extname, ', ') from pg_extension
            where extname in ('pgcrypto', 'pg_net', 'pg_cron', 'supabase_vault'))
  union all
  select 6, 'newest migration present (replace_review_token)',
         exists (select 1 from pg_proc where proname = 'replace_review_token'),
         null
  union all
  select 7, 'no test or demo data anywhere',
         not exists (select 1 from families where is_test_data or is_autotest_data)
           and not exists (select 1 from form_links where is_test_data)
           and not exists (select 1 from review_tokens where is_test_data),
         null
  union all
  select 8, 'no households, cards or sponsors yet (fresh project)',
         not exists (select 1 from families) and not exists (select 1 from cards)
           and not exists (select 1 from sponsors) and not exists (select 1 from sponsor_families),
         null
) checks order by n;
