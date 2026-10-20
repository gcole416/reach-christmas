-- US-59 (docs/backlog.md) -- backend half of replacing the public /sponsor
-- page with a link to the Church Center sign-up page. Lives on
-- feature/staff-assigned-sponsors only.
--
-- app_settings is admin-read/write-only (20260923120000) -- nothing on it
-- is anon-readable today, and this doesn't change that for the table as a
-- whole. /sponsor is an unauthenticated page and needs exactly one value
-- off it, so this adds a narrow, single-purpose security definer function
-- instead of widening app_settings' own RLS -- same "deliberate whitelist,
-- not a wider grant" rule this project already applies to
-- public_available_cards (see AGENTS.md).
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  NOT YET APPLIED.
--   PROD: NOT APPLIED.
--
-- reach-reviewer gate: low-risk (one text column, one function returning
-- that one column to anon), but touches the anon-facing surface, so still
-- worth a look alongside the rest of this epic.

begin;

alter table app_settings add column if not exists church_center_signup_url text;

comment on column app_settings.church_center_signup_url is
  'US-59: where /sponsor sends visitors now that sponsoring is staff-'
  'assigned from a Church Center sign-up list, not self-serve in this app. '
  'NULL until Grant sets it -- the page shows an honest "not set up yet" '
  'message instead of a dead link when empty. Set with a plain update, no '
  'migration needed: update app_settings set church_center_signup_url = ''https://...'';';

create or replace function public.get_church_center_signup_url()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select church_center_signup_url from app_settings limit 1;
$$;

comment on function public.get_church_center_signup_url() is
  'The ONLY thing /sponsor (anon) may read off app_settings. Returns just '
  'this one column, never the row -- do not widen this to return a record '
  'or add columns without checking what else app_settings holds first.';

grant execute on function public.get_church_center_signup_url() to anon, authenticated;

commit;

-- VERIFY (run after applying, dev only):
--
-- 1. update app_settings set church_center_signup_url = 'https://example.churchcenter.com/registrations/events/123';
--
-- 2. As anon (signed out): select get_church_center_signup_url(); -- expect
--    the URL back, and confirm a plain `select * from app_settings` as anon
--    still fails (this function is the only crack in that door, not a
--    general opening).
--
-- 3. select get_church_center_signup_url(); with the column cleared back to
--    NULL -- expect NULL back, not an error; confirm /sponsor's "not set up
--    yet" copy renders for that case once US-59's page is built.
