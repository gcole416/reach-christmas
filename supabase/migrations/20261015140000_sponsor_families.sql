-- US-55 (docs/backlog.md, "Epic: Staff-assigned sponsors") -- the sponsor
-- roster table. Lives on feature/staff-assigned-sponsors only.
--
-- Per Grant (2026-10-15, OPEN_QUESTIONS ADM-24): no sponsor ever fills out a
-- form or gives this app their own email. Sign-ups happen in Church Center,
-- entirely outside this app; staff get that list out of Church Center and
-- import it here (US-56). "The congregation" is just this list -- names,
-- emails, phone numbers -- not a separate campus/group category, so there's
-- deliberately no `congregations` lookup table (an earlier draft of this
-- epic had one).
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  APPLIED 2026-10-19.
--   PROD: NOT APPLIED. This whole epic ships on `dev` only if/when
--         feature/staff-assigned-sponsors merges, and even then waits for a
--         Software Acceptance Review like every other claim-path change.
--
-- =============================================================================
-- What this adds
-- =============================================================================
--   * sponsor_families -- one row per sponsor sign-up staff imports (US-56)
--     or adds by hand. Scoped per drive like families/children, so last
--     year's roster doesn't bleed into this year's.
--   * sponsors.sponsor_family_id -- nullable FK, set only when an assignment
--     came from the roster (US-58's assign_card_to_sponsor_family). Today's
--     self-serve claims (claim_card_with_code, still live and unchanged)
--     leave it null. This is how "how many cards has this roster entry
--     taken so far" gets computed -- a count through this link, not a
--     counter column to keep in sync.
--   * No is_test_data column here, deliberately matching `sponsors` itself
--     (which has never had one) rather than `families`/the intake tables
--     (which do) -- sponsor_families is a lightweight contact list, not one
--     of the per-drive counted entities the e2e suite's cleanup targets by
--     that flag.
--
-- RLS mirrors `sponsors`, not `schools`: staff AND volunteers can read/write
-- (schools' write is admin-only because a partner school is a bigger
-- structural decision; a sponsor roster entry is routine data entry, same
-- authority level as entering a family by hand). No confidentiality gate --
-- this is a sponsor's own contact info, not a child's.
--
-- reach-reviewer gate REQUIRED: new table holding real people's contact
-- info; new FK off `sponsors`, a table the public claim path also writes to.

begin;

create table if not exists sponsor_families (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  display_name text not null,
  contact_email text,
  contact_phone text,
  capacity int,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create index if not exists sponsor_families_drive_id_idx on sponsor_families (drive_id);

comment on table sponsor_families is
  'US-55: the sponsor sign-up roster for staff-assigned sponsoring '
  '(feature/staff-assigned-sponsors). One row per sponsor sign-up, imported '
  'from Church Center or added by hand -- see US-56. "Congregation" in the '
  'original meeting ask IS this table; there is no separate grouping '
  'column.';
comment on column sponsor_families.capacity is
  'How many cards this entry expects to take. Advisory only -- '
  'assign_card_to_sponsor_family does not enforce it; the assignment screen '
  '(US-57) just flags an entry that''s at or over it.';
comment on column sponsor_families.is_active is
  'Staff can retire a roster entry (fully booked, no longer available) '
  'without deleting it and losing the assignment history through it.';

alter table sponsor_families enable row level security;

drop policy if exists "staff read sponsor_families" on sponsor_families;
create policy "staff read sponsor_families" on sponsor_families for select to authenticated using (true);

drop policy if exists "staff insert sponsor_families" on sponsor_families;
create policy "staff insert sponsor_families" on sponsor_families for insert to authenticated with check (true);

drop policy if exists "staff update sponsor_families" on sponsor_families;
create policy "staff update sponsor_families" on sponsor_families for update to authenticated using (true) with check (true);

drop policy if exists "admin delete sponsor_families" on sponsor_families;
create policy "admin delete sponsor_families" on sponsor_families for delete to authenticated using (is_admin());

grant select, insert, update on sponsor_families to authenticated;
grant delete on sponsor_families to authenticated;
revoke all on sponsor_families from anon;

drop trigger if exists audit_sponsor_families on sponsor_families;
create trigger audit_sponsor_families after insert or update or delete on sponsor_families
  for each row execute function public.audit_log_change();

-- -----------------------------------------------------------------------------

alter table sponsors add column if not exists sponsor_family_id uuid references sponsor_families(id) on delete set null;

comment on column sponsors.sponsor_family_id is
  'US-55/58: set only when this sponsor record was created by '
  'assign_card_to_sponsor_family from a sponsor_families roster entry. Null '
  'for every self-serve claim (claim_card_with_code never sets it). '
  'Existing RLS/grants on sponsors already cover this new column -- no '
  'policy change needed, same as every other column added to this table.';

commit;

-- VERIFY (run after applying, dev only):
--
-- 1. As an authenticated staff/volunteer test account, insert a row:
--    insert into sponsor_families (drive_id, display_name, contact_email, capacity)
--    values ('<a real drive id>', 'Test Sponsor', 'test@example.com', 2)
--    returning *;
--    Expect it to succeed for BOTH an admin and a plain volunteer account.
--
-- 2. As anon (signed out), confirm both of these fail:
--    select * from sponsor_families limit 1;   -- expect 0 rows / RLS-empty, not an error
--    insert into sponsor_families (drive_id, display_name) values ('<id>', 'x');  -- expect permission denied
--
-- 3. select sponsor_family_id from sponsors limit 1; -- confirm the column
--    exists and existing rows have it NULL.
