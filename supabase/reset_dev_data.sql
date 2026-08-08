-- Resets dev test/demo data back to a clean slate — DEV PROJECT ONLY, NEVER PROD.
-- Clears everything a test/demo cycle creates: schools, families (and
-- everything under them — children, wishlist_items, cards, assignments),
-- and sponsors. Also clears audit_log so old test rows don't pile up.
--
-- Deliberately NOT touched:
--   - drives   — whichever drive is open stays open, so you can reseed
--                immediately without recreating/reopening one.
--   - profiles — your staff/admin accounts. Wiping this would mean
--                re-promoting yourself to admin via SQL every time.
--
-- CASCADE also truncates children, wishlist_items, cards, and assignments
-- automatically, since each has a foreign key pointing at one of the tables
-- listed below — no need to list them separately.

truncate table families, drive_schools, schools, sponsors, audit_log cascade;

-- Optional: also wipe drives, if you want a fully blank slate. You'd need to
-- create + open a new one afterward (Drives page, or an insert like earlier
-- in this project) before the app will load again.
-- truncate table drives cascade;

-- Sanity check — everything below should read 0 except the last two.
select 'families' as table_name, count(*) from families
union all select 'children', count(*) from children
union all select 'wishlist_items', count(*) from wishlist_items
union all select 'cards', count(*) from cards
union all select 'assignments', count(*) from assignments
union all select 'sponsors', count(*) from sponsors
union all select 'schools', count(*) from schools
union all select 'drive_schools', count(*) from drive_schools
union all select 'audit_log', count(*) from audit_log
union all select 'drives (should be > 0)', count(*) from drives
union all select 'profiles (should be > 0)', count(*) from profiles;
