-- =============================================================================
-- reset_dev_full.sql — wipe ALL data from the dev database back to a blank slate.
-- DEV SUPABASE PROJECT ONLY. NEVER RUN THIS AGAINST PROD.
-- =============================================================================
--
-- This is the bigger hammer next to supabase/reset_dev_data.sql. That script
-- clears families / schools / sponsors / audit_log but leaves `forms` and
-- `form_versions` standing (they hang off `drives`, not off anything it
-- truncates). After a session that created intake forms in the Registrations
-- tab, those two tables — plus form_links / review_tokens / form_submissions /
-- submission_events — are what's left behind. This script clears every one of
-- them, in one statement, along with all the family/sponsor/school data.
--
-- KEPT (not touched):
--   * profiles — your staff/admin accounts. Wiping this locks you out and
--                means re-promoting yourself to admin via SQL.
--   * drives   — whichever drive is open stays open, so you can immediately
--                re-run demo_seed.sql / intake_demo_seed.sql without
--                recreating and re-opening a drive first. Flip DROP_DRIVES to
--                true in the guard block below for a truly empty database.
--
-- WIPED (everything else):
--   schools, drive_schools, families, children, cards, wishlist_items,
--   sponsors, assignments, audit_log, card_claim_verifications,
--   forms, form_versions, form_links, review_tokens, form_submissions,
--   submission_events
--
-- HOW TO RUN: paste into the Supabase SQL editor for the DEV project, set
-- I_AM_ON_DEV to true in the DO block (safety catch against pasting into the
-- wrong window), then run. See memory.md / docs/DEPLOY.md for which project is
-- which.
-- =============================================================================

do $guard$
declare
  -- ---- FLIP THIS TO true TO ARM THE SCRIPT --------------------------------
  I_AM_ON_DEV  constant boolean := false;
  -- ---- optional: also wipe `drives` (you'll need to create + open a new
  --      one before the app will load again) --------------------------------
  DROP_DRIVES  constant boolean := false;
  -- -----------------------------------------------------------------------
  v_families   bigint;
begin
  if not I_AM_ON_DEV then
    raise exception
      'reset_dev_full.sql is not armed. Confirm you are on the DEV project, then set I_AM_ON_DEV := true.';
  end if;

  -- Soft sanity check: prod carries hundreds of real, non-test families.
  -- Dev should be all test/demo data. Abort loudly if that's not what we see.
  select count(*) into v_families from families where not coalesce(is_test_data, false);
  if v_families > 25 then
    raise exception
      'Aborting: found % families not marked is_test_data. This does not look like the dev database.', v_families;
  end if;

  if DROP_DRIVES then
    truncate table
      drives, schools, drive_schools, families, children, cards, wishlist_items,
      sponsors, assignments, audit_log, card_claim_verifications,
      forms, form_versions, form_links, review_tokens, form_submissions,
      submission_events
    cascade;
    raise notice 'Full wipe complete, INCLUDING drives. Create + open a new drive before loading the app.';
  else
    truncate table
      schools, drive_schools, families, children, cards, wishlist_items,
      sponsors, assignments, audit_log, card_claim_verifications,
      forms, form_versions, form_links, review_tokens, form_submissions,
      submission_events
    cascade;
    raise notice 'Full wipe complete. drives and profiles kept.';
  end if;
end $guard$;

-- =============================================================================
-- Sanity check — every count below should read 0 except the last two
-- (drives is 0 too if you set DROP_DRIVES := true).
-- =============================================================================
select 'families'                as table_name, count(*) from families
union all select 'children',                    count(*) from children
union all select 'wishlist_items',              count(*) from wishlist_items
union all select 'cards',                       count(*) from cards
union all select 'assignments',                 count(*) from assignments
union all select 'card_claim_verifications',    count(*) from card_claim_verifications
union all select 'sponsors',                    count(*) from sponsors
union all select 'schools',                     count(*) from schools
union all select 'drive_schools',               count(*) from drive_schools
union all select 'audit_log',                   count(*) from audit_log
union all select 'forms',                       count(*) from forms
union all select 'form_versions',               count(*) from form_versions
union all select 'form_links',                  count(*) from form_links
union all select 'review_tokens',               count(*) from review_tokens
union all select 'form_submissions',            count(*) from form_submissions
union all select 'submission_events',           count(*) from submission_events
union all select 'drives   (>0 unless DROP_DRIVES)', count(*) from drives
union all select 'profiles (should be > 0)',    count(*) from profiles;
