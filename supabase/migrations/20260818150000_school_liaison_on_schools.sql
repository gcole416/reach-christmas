-- ADM-3: school liaison contact belongs to the school, not the per-drive
-- membership. Answered in docs/OPEN_QUESTIONS.md ADM-3 (2026-08-18): a real
-- liaison workflow is wanted (schools are the church's sole go-between for
-- confidential/direct-referral-less families), and "the school liaison
-- should be inherited from a school" — i.e. the contact is a property of the
-- school itself, not something re-typed every year it participates in a
-- drive. See SCHEMA.md §3/§4 for the full before/after.
--
-- schools' existing RLS policies ("staff read schools" using(true), "admin
-- write/update/delete schools" using/with check(is_admin())) are all
-- column-agnostic — confirmed by reading them in
-- supabase/migrations/20260708120000_init.sql before writing this file — so
-- no policy change is needed for the three new columns to be readable/
-- writable exactly like every other column on this table.

alter table schools
  add column liaison_name text,
  add column liaison_phone text,
  add column liaison_email text;

-- Backfill from drive_schools for any existing rows. Dev-only data, so
-- last-write-wins across multiple drive_schools rows for the same school
-- (no explicit ordering) is acceptable here.
update schools s
set liaison_name = ds.liaison_name,
    liaison_phone = ds.liaison_phone,
    liaison_email = ds.liaison_email
from drive_schools ds
where ds.school_id = s.id
  and ds.liaison_name is not null;

alter table drive_schools
  drop column liaison_name,
  drop column liaison_phone,
  drop column liaison_email;
