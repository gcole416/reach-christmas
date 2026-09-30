-- Set this year's distribution method to "School drop-off" everywhere.
--
-- Context (2026-09-29 decision, see DESIGN.md §8): the church collects gifts
-- from sponsors as usual, then delivers each family's gifts to their school
-- counselor at the school. No family comes to the church building for an
-- elementary child's gift. The DistributionMethod mechanism
-- (drives.default_distribution_method -> drive_schools.distribution_method ->
-- families.distribution_method_override, most specific wins) already fully
-- supports "school_dropoff" — this script just sets it, no code change needed.
--
-- Run it in the Supabase SQL editor, on whichever project the drive lives on
-- (dev freely; prod only after a Software Acceptance Review, same as every
-- intake migration/script here).
--
-- Sets:
--   * drives.default_distribution_method       — the open drive's fallback
--   * drive_schools.distribution_method         — every school in that drive,
--                                                  explicitly, so no school is
--                                                  left on a stale
--                                                  'church_pickup' override
--                                                  that would otherwise beat
--                                                  the new drive default
--
-- Does NOT touch families.distribution_method_override (per-family
-- exceptions) — uncomment the block at the bottom if you also want to clear
-- those back to "inherit" for every family in the drive.
--
-- Re-runnable — it's a plain UPDATE, not a publish/version step.

do $set_dropoff$
declare
  v_drive_id uuid;
  v_schools_updated int;
begin
  select id into v_drive_id from drives where status = 'open' order by year desc limit 1;
  if v_drive_id is null then
    raise exception 'No open drive found. Open one on the Drives page first.';
  end if;

  update drives
  set default_distribution_method = 'school_dropoff'
  where id = v_drive_id;

  update drive_schools
  set distribution_method = 'school_dropoff'
  where drive_id = v_drive_id;
  get diagnostics v_schools_updated = row_count;

  raise notice 'Drive default set to school_dropoff. % school row(s) set to school_dropoff.', v_schools_updated;
end $set_dropoff$;

-- Sanity check — expect every row below to read 'school_dropoff'.
select 'drive default' as what, default_distribution_method::text as method
from drives where status = 'open'
union all
select 'school: ' || s.name, ds.distribution_method::text
from drive_schools ds
join schools s on s.id = ds.school_id
where ds.drive_id = (select id from drives where status = 'open' order by year desc limit 1)
order by 1;

-- Optional — uncomment to also clear per-family overrides back to "inherit
-- the school/drive default" for every family in the open drive. Leave
-- commented if you want to review family-level overrides individually first
-- (e.g. on /admin/distribution) rather than blanket-clearing them.
-- update families
-- set distribution_method_override = null
-- where drive_id = (select id from drives where status = 'open' order by year desc limit 1);
