-- US-76 (docs/backlog.md): import AND update the sponsor roster from the
-- Church Center export, in the same window (Grant, 2026-11-16).
--
-- Staff will drop a fresh Church Center CSV in several times a season. Each
-- time, the app has to recognise who is already on the roster, keep every
-- assignment, add only the new people, and apply what changed in Church
-- Center. Before this, the roster had no stable key for a Church Center
-- sign-up, so a second import duplicated everyone (US-74).
--
-- =============================================================================
-- APPLY STATUS (docs/MIGRATION_LEDGER.md wins if this disagrees)
-- =============================================================================
--   DEV:  applied 2026-11-16 (Grant, SQL Editor).
--   PROD: NOT APPLIED. Promote only through PROD_LAUNCH_CHECKLIST /
--         MIGRATION_LEDGER with Grant's go-ahead.
--
-- =============================================================================
-- What this adds
-- =============================================================================
--   * sponsor_families.church_center_registration_id: the export's
--     "Registration ID". Unique per drive, so a re-import matches exactly
--     even when someone fixes their name or email in Church Center. Null for
--     hand-added entries; the app links one by email the first time it shows
--     up in a CSV.
--   * sponsor_families.signed_up_at: the export's "Submitted" time. Suggest
--     matches fills the earliest sign-ups first; without this, "earliest" was
--     the order rows happened to be imported.
--   * sponsor_families.church_center_snapshot: what Church Center said about
--     this person at the last import (name, emails, phone digits, count). A
--     re-import proposes a change only when Church Center's value moved since
--     then, so a fix staff made by hand on the roster isn't undone every time.
--   * sponsor_families.added_by_import_id: which import added the entry, so
--     the roster and Assign pages can badge the newest additions.
--   * sponsor_imports: one row per import (who, when, counts). Feeds the
--     "Last updated from Church Center" line. No contact details, no child
--     data: counts, a file name, and the importer's display name.
--   * apply_sponsor_import(): saves one import (new entries + changed fields
--     + the log row) in one transaction, so it all lands or none of it does.
--
-- What the import never touches: assignments, sponsors, notes on an existing
-- entry, is_active. Updating a roster entry in place keeps its assignments
-- because they hang off sponsors.sponsor_family_id, which doesn't change.
--
-- Updates are partial: each p_updates item carries only the fields that
-- changed (key absent = leave the column alone), so an edit someone makes
-- between preview and confirm isn't overwritten with preview-time values.
--
-- Capacity rule (Grant, 2026-11-16): a changed Church Center count updates
-- the entry's capacity, but never below the children already assigned to it.
-- The client shows that case in the preview; this function enforces it again
-- so a child assigned between preview and confirm can't be stranded.
--
-- Security: SECURITY INVOKER, so the existing sponsor_families RLS (staff and
-- volunteers read/write, anon nothing) applies exactly as it does to today's
-- one-statement import. No child or family table is read except to count a
-- roster entry's active assignments, which RLS already lets staff read.
-- sponsor_imports is append-only from the app (select + insert policies, no
-- update/delete), and a BEFORE INSERT trigger stamps who imported it from the
-- caller's own login, so the "by <name>" line can't be supplied by the client.
-- reach-reviewer: reviewed 2026-11-16 (no blockers; findings fixed in this
-- file before it was applied anywhere).

begin;

set local lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- Import log
-- -----------------------------------------------------------------------------

create table if not exists sponsor_imports (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  imported_at timestamptz not null default now(),
  imported_by uuid references profiles(id) default auth.uid(),
  -- Snapshot of profiles.full_name, so every staff member can read "by Katie"
  -- without needing read access to other people's profile rows. Set by the
  -- trigger below, never by the caller.
  imported_by_name text,
  file_name text,
  added_count int not null default 0,
  updated_count int not null default 0,
  unchanged_count int not null default 0,
  skipped_count int not null default 0,
  flagged_count int not null default 0
);

create index if not exists sponsor_imports_drive_idx on sponsor_imports (drive_id, imported_at desc);

comment on table sponsor_imports is
  'US-76: one row per Church Center roster import or update, written by '
  'apply_sponsor_import(). Counts only, no contact details. Append-only.';

create or replace function public.sponsor_imports_stamp_importer()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.imported_by := auth.uid();
  new.imported_by_name := (select full_name from profiles where id = auth.uid());
  new.imported_at := now();
  return new;
end;
$$;

revoke all on function public.sponsor_imports_stamp_importer() from anon, public;

drop trigger if exists stamp_sponsor_imports on sponsor_imports;
create trigger stamp_sponsor_imports before insert on sponsor_imports
  for each row execute function public.sponsor_imports_stamp_importer();

alter table sponsor_imports enable row level security;

drop policy if exists "staff read sponsor_imports" on sponsor_imports;
create policy "staff read sponsor_imports" on sponsor_imports
  for select to authenticated using (true);

-- Insert only as yourself. No update or delete policy: append-only.
drop policy if exists "staff insert own sponsor_imports" on sponsor_imports;
create policy "staff insert own sponsor_imports" on sponsor_imports
  for insert to authenticated with check (imported_by = auth.uid());

revoke all on sponsor_imports from anon, authenticated;
grant select, insert on sponsor_imports to authenticated;

drop trigger if exists audit_sponsor_imports on sponsor_imports;
create trigger audit_sponsor_imports after insert or update or delete on sponsor_imports
  for each row execute function public.audit_log_change();

-- -----------------------------------------------------------------------------
-- New roster columns
-- -----------------------------------------------------------------------------

alter table sponsor_families add column if not exists church_center_registration_id text;
alter table sponsor_families add column if not exists signed_up_at timestamptz;
alter table sponsor_families add column if not exists church_center_snapshot jsonb;
alter table sponsor_families add column if not exists added_by_import_id uuid
  references sponsor_imports(id) on delete set null;

-- Unique per drive. Existing rows are all null, and nulls never collide, so
-- this can't fail on current data.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sponsor_families_drive_cc_registration_key'
  ) then
    alter table sponsor_families
      add constraint sponsor_families_drive_cc_registration_key
      unique (drive_id, church_center_registration_id);
  end if;
end $$;

comment on column sponsor_families.church_center_registration_id is
  'US-76: Church Center "Registration ID". Unique per drive; how a re-import '
  'recognises someone already on the roster. Null for hand-added entries.';
comment on column sponsor_families.signed_up_at is
  'US-76: Church Center "Submitted" time. Suggest matches fills earliest '
  'sign-ups first (falls back to created_at when null).';
comment on column sponsor_families.church_center_snapshot is
  'US-76: Church Center''s values at the last import ({name, emails, phone, '
  'count}). A re-import only proposes changes Church Center made since then, '
  'so hand edits on the roster stick.';
comment on column sponsor_families.added_by_import_id is
  'US-76: the sponsor_imports row that added this entry; null when added by '
  'hand or before US-76.';

-- -----------------------------------------------------------------------------
-- apply_sponsor_import
-- -----------------------------------------------------------------------------
--
-- p_new:     [{display_name, contact_email, contact_phone, capacity, notes,
--              church_center_registration_id, signed_up_at,
--              church_center_snapshot}]
-- p_updates: [{id, <only the keys to change>}]. Allowed keys: display_name,
--            contact_email, contact_phone, capacity,
--            church_center_registration_id and signed_up_at (both only fill
--            a blank, never overwrite), church_center_snapshot.
--            An item with only church_center_snapshot / signed_up_at is a
--            silent bookkeeping write (e.g. staff unticked a proposed change)
--            and isn't counted as "changed".
-- p_counts:  {unchanged, skipped, flagged} for the log line.
--
-- Returns {ok, import_id, added, updated, capacity_kept: [names]} or raises.
-- Raising rolls the whole import back, log row included.

create or replace function public.apply_sponsor_import(
  p_drive_id uuid,
  p_file_name text,
  p_new jsonb,
  p_updates jsonb,
  p_counts jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new jsonb := coalesce(p_new, '[]'::jsonb);
  v_updates jsonb := coalesce(p_updates, '[]'::jsonb);
  v_import_id uuid;
  v_added int;
  v_updated int;
  v_touched int := 0;
  v_capacity_kept text[] := '{}';
  v_row record;
  v_item jsonb;
  v_id uuid;
  v_capacity int;
  v_assigned int;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if not exists (select 1 from drives where id = p_drive_id and status = 'open') then
    raise exception 'This drive is not open, so its roster can''t be imported into.';
  end if;

  if jsonb_typeof(v_new) <> 'array' or jsonb_typeof(v_updates) <> 'array' then
    raise exception 'Import data is malformed.';
  end if;

  -- Both counts are exact up front: every new row is inserted or the whole
  -- call raises, and every update must land (checked below) or it raises.
  v_added := jsonb_array_length(v_new);
  select count(*) into v_updated
  from jsonb_array_elements(v_updates) e
  where e ?| array['display_name', 'contact_email', 'contact_phone', 'capacity', 'church_center_registration_id'];

  insert into sponsor_imports (
    drive_id, file_name, added_count, updated_count,
    unchanged_count, skipped_count, flagged_count
  )
  values (
    p_drive_id, nullif(btrim(coalesce(p_file_name, '')), ''), v_added, v_updated,
    coalesce((p_counts->>'unchanged')::int, 0),
    coalesce((p_counts->>'skipped')::int, 0),
    coalesce((p_counts->>'flagged')::int, 0)
  )
  returning id into v_import_id;

  begin
    -- New entries ------------------------------------------------------------
    for v_row in
      select * from jsonb_to_recordset(v_new) as x(
        display_name text, contact_email text, contact_phone text, capacity int,
        notes text, church_center_registration_id text, signed_up_at timestamptz,
        church_center_snapshot jsonb
      )
    loop
      if nullif(btrim(coalesce(v_row.display_name, '')), '') is null then
        raise exception 'Every new sponsor needs a name.';
      end if;
      if v_row.capacity is not null and v_row.capacity < 0 then
        raise exception 'A sponsor''s number of children can''t be negative.';
      end if;

      insert into sponsor_families (
        drive_id, display_name, contact_email, contact_phone, capacity, notes,
        church_center_registration_id, signed_up_at, church_center_snapshot,
        added_by_import_id, created_by
      )
      values (
        p_drive_id,
        btrim(v_row.display_name),
        nullif(btrim(coalesce(v_row.contact_email, '')), ''),
        nullif(btrim(coalesce(v_row.contact_phone, '')), ''),
        v_row.capacity,
        nullif(btrim(coalesce(v_row.notes, '')), ''),
        nullif(btrim(coalesce(v_row.church_center_registration_id, '')), ''),
        v_row.signed_up_at,
        v_row.church_center_snapshot,
        v_import_id,
        auth.uid()
      );
    end loop;

    -- Changes to existing entries (only the keys present) -------------------
    for v_item in select * from jsonb_array_elements(v_updates)
    loop
      v_id := (v_item->>'id')::uuid;
      v_capacity := case when v_item ? 'capacity' then (v_item->>'capacity')::int end;
      if v_capacity is not null and v_capacity < 0 then
        raise exception 'A sponsor''s number of children can''t be negative.';
      end if;

      select count(*) into v_assigned
      from assignments a
      join sponsors s on s.id = a.sponsor_id
      where s.sponsor_family_id = v_id and a.status <> 'cancelled';

      update sponsor_families sf set
        display_name = case when v_item ? 'display_name'
          then coalesce(nullif(btrim(coalesce(v_item->>'display_name', '')), ''), sf.display_name)
          else sf.display_name end,
        contact_email = case when v_item ? 'contact_email'
          then nullif(btrim(coalesce(v_item->>'contact_email', '')), '')
          else sf.contact_email end,
        contact_phone = case when v_item ? 'contact_phone'
          then nullif(btrim(coalesce(v_item->>'contact_phone', '')), '')
          else sf.contact_phone end,
        capacity = case when v_capacity is not null
          then greatest(v_capacity, v_assigned)
          else sf.capacity end,
        church_center_registration_id = coalesce(
          sf.church_center_registration_id,
          nullif(btrim(coalesce(v_item->>'church_center_registration_id', '')), '')
        ),
        signed_up_at = coalesce(sf.signed_up_at, (v_item->>'signed_up_at')::timestamptz),
        church_center_snapshot = case when v_item ? 'church_center_snapshot'
          then v_item->'church_center_snapshot'
          else sf.church_center_snapshot end
      where sf.id = v_id and sf.drive_id = p_drive_id
      returning sf.display_name into v_name;

      if found then
        v_touched := v_touched + 1;
        if v_capacity is not null and v_capacity < v_assigned then
          v_capacity_kept := v_capacity_kept || v_name;
        end if;
      end if;
    end loop;

    if v_touched <> jsonb_array_length(v_updates) then
      raise exception 'The roster changed since this preview (someone removed an entry). Close this, reopen Import, and preview again.';
    end if;
  exception when unique_violation then
    raise exception 'Some of these people were just added by someone else. Close this, reopen Import, and preview again.';
  end;

  return jsonb_build_object(
    'ok', true,
    'import_id', v_import_id,
    'added', v_added,
    'updated', v_updated,
    'capacity_kept', to_jsonb(v_capacity_kept)
  );
end;
$$;

revoke all on function public.apply_sponsor_import(uuid, text, jsonb, jsonb, jsonb) from anon, public;
grant execute on function public.apply_sponsor_import(uuid, text, jsonb, jsonb, jsonb) to authenticated;

commit;

-- VERIFY (dev only, inside a transaction that is rolled back):
--   1. As an authenticated staff user: call with one new row and no updates;
--      expect added=1, a sponsor_imports row with added_count=1 and your own
--      name, the entry tagged with its id.
--   2. Call again with the same church_center_registration_id in p_new;
--      expect the friendly "just added by someone else" error, nothing saved.
--   3. Update an entry that has 2 active assignments with capacity 1; expect
--      capacity 2 and its name in capacity_kept.
--   4. An update item with only {id, church_center_snapshot} changes only
--      the snapshot and isn't counted in updated_count.
--   5. As anon: select from sponsor_imports returns nothing; calling the
--      function is permission denied.
--
-- ROLLBACK (if ever needed):
--   drop function if exists public.apply_sponsor_import(uuid, text, jsonb, jsonb, jsonb);
--   alter table sponsor_families drop constraint if exists sponsor_families_drive_cc_registration_key;
--   alter table sponsor_families drop column if exists added_by_import_id;
--   alter table sponsor_families drop column if exists church_center_snapshot;
--   alter table sponsor_families drop column if exists signed_up_at;
--   alter table sponsor_families drop column if exists church_center_registration_id;
--   drop table if exists sponsor_imports;
--   drop function if exists public.sponsor_imports_stamp_importer();
