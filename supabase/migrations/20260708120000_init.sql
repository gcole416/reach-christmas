-- Reach Christmas gift drive — initial schema
-- Direct translation of SCHEMA.md. See that file for the "why" behind each
-- decision; this file is the "what," made runnable against Postgres/Supabase.

-- =============================================================================
-- Extensions & enums
-- =============================================================================

create extension if not exists pgcrypto;

create type drive_status as enum ('draft', 'open', 'closed', 'archived');
create type distribution_method as enum ('school_dropoff', 'church_pickup');
create type assignment_status as enum ('pledged', 'purchased', 'received_at_church', 'delivered', 'cancelled');
create type app_role as enum ('admin', 'volunteer');

-- =============================================================================
-- Tables
-- =============================================================================

create table drives (
  id uuid primary key default gen_random_uuid(),
  year int not null unique,
  name text not null,
  status drive_status not null default 'draft',
  referral_window_start date,
  referral_window_end date,
  default_distribution_method distribution_method,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mirrors auth.users; this is where app-specific fields (role, confidential
-- access) live. A row is created automatically on signup (see handle_new_user
-- below).
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role app_role not null default 'volunteer',
  can_view_confidential boolean not null default false,
  created_at timestamptz not null default now()
);

create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table drive_schools (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  school_id uuid not null references schools(id),
  code text not null,
  liaison_name text,
  liaison_phone text,
  liaison_email text,
  distribution_method distribution_method,
  unique (drive_id, school_id),
  unique (drive_id, code)
);

create table families (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  drive_school_id uuid references drive_schools(id),
  family_number int not null,
  is_confidential boolean not null default false,
  sort_tag text,
  internal_notes text,
  distribution_method_override distribution_method,
  scheduled_pickup_at timestamptz,
  checked_in_at timestamptz,
  checked_in_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index families_number_per_school
  on families (drive_id, drive_school_id, family_number)
  where not is_confidential;

create unique index families_number_confidential
  on families (drive_id, family_number)
  where is_confidential;

create index families_drive_id_idx on families (drive_id);

create table children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  child_index int not null,
  first_name text not null,
  grade text,
  age int,
  sex text,
  specific_needs text,
  pant_size text,
  shirt_size text,
  shoe_size text,
  other_notes text,
  target_card_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, child_index)
);

create index children_family_id_idx on children (family_id);

create table cards (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children(id) on delete cascade,
  copy_number int not null,
  total_copies int not null,
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (child_id, copy_number)
);

create index cards_child_id_idx on cards (child_id);

create table wishlist_items (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children(id) on delete cascade,
  position int not null,
  description text not null,
  unique (child_id, position)
);

create table sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  sponsor_id uuid not null references sponsors(id),
  status assignment_status not null default 'pledged',
  claimed_at timestamptz not null default now(),
  purchased_at timestamptz,
  received_at_church_at timestamptz,
  delivered_at timestamptz,
  notes text
);

create unique index one_active_assignment_per_card
  on assignments (card_id)
  where status <> 'cancelled';

create index assignments_sponsor_id_idx on assignments (sponsor_id);
create index assignments_status_idx on assignments (status);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now(),
  diff jsonb
);

-- =============================================================================
-- Views
-- =============================================================================

-- Staff-facing views use security_invoker so they respect the *querying*
-- user's own RLS (a volunteer without confidential clearance sees the same
-- rows through these views as they would querying the tables directly).
create view child_card_numbers
  with (security_invoker = true) as
select
  c.id as child_id,
  coalesce(ds.code, 'Z') || f.family_number || '.' || c.child_index as card_number,
  f.id as family_id,
  f.drive_id
from children c
join families f on f.id = c.family_id
left join drive_schools ds on ds.id = f.drive_school_id;

create view cards_needing_print
  with (security_invoker = true) as
select
  ch.id as child_id,
  ch.first_name,
  ch.target_card_count,
  count(crd.id) as cards_generated,
  count(crd.id) filter (where crd.printed_at is null) as cards_not_yet_printed
from children ch
left join cards crd on crd.child_id = ch.id
group by ch.id, ch.first_name, ch.target_card_count
having count(crd.id) < ch.target_card_count
    or count(crd.id) filter (where crd.printed_at is null) > 0;

create view printable_cards
  with (security_invoker = true) as
select
  crd.id as card_id,
  ccn.card_number || ' (' || crd.copy_number || '/' || crd.total_copies || ')' as display_label,
  ch.first_name,
  ch.grade,
  crd.printed_at,
  f.drive_id
from cards crd
join children ch on ch.id = crd.child_id
join families f on f.id = ch.family_id
join child_card_numbers ccn on ccn.child_id = ch.id;

-- Public (anon) view is the one deliberate exception: it does NOT use
-- security_invoker, because anon has zero policies on the base tables at all.
-- This view's own join/where clauses (excluding confidential families and
-- already-claimed cards, and only selecting whitelisted columns) ARE the
-- entire security boundary for sponsors. See SCHEMA.md "Public (sponsor-facing)
-- access" for the reasoning.
create view public_available_cards as
select
  crd.id as card_id,
  ccn.card_number as card_number,
  ch.first_name,
  ch.grade,
  ch.pant_size, ch.shirt_size, ch.shoe_size,
  ch.specific_needs,
  wi.description as wishlist_description
from cards crd
join children ch on ch.id = crd.child_id
join families f on f.id = ch.family_id and not f.is_confidential
join child_card_numbers ccn on ccn.child_id = ch.id
left join wishlist_items wi on wi.child_id = ch.id
where not exists (
  select 1 from assignments a where a.card_id = crd.id and a.status <> 'cancelled'
);

-- =============================================================================
-- Helper functions (used inside RLS policies)
-- =============================================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.can_view_confidential()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and (role = 'admin' or can_view_confidential)
  );
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table drives enable row level security;
alter table profiles enable row level security;
alter table schools enable row level security;
alter table drive_schools enable row level security;
alter table families enable row level security;
alter table children enable row level security;
alter table cards enable row level security;
alter table wishlist_items enable row level security;
alter table sponsors enable row level security;
alter table assignments enable row level security;
alter table audit_log enable row level security;

-- drives / schools / drive_schools: staff read, admin write
create policy "staff read drives" on drives for select to authenticated using (true);
create policy "admin write drives" on drives for insert to authenticated with check (is_admin());
create policy "admin update drives" on drives for update to authenticated using (is_admin()) with check (is_admin());
create policy "admin delete drives" on drives for delete to authenticated using (is_admin());

create policy "staff read schools" on schools for select to authenticated using (true);
create policy "admin write schools" on schools for insert to authenticated with check (is_admin());
create policy "admin update schools" on schools for update to authenticated using (is_admin()) with check (is_admin());
create policy "admin delete schools" on schools for delete to authenticated using (is_admin());

create policy "staff read drive_schools" on drive_schools for select to authenticated using (true);
create policy "admin write drive_schools" on drive_schools for insert to authenticated with check (is_admin());
create policy "admin update drive_schools" on drive_schools for update to authenticated using (is_admin()) with check (is_admin());
create policy "admin delete drive_schools" on drive_schools for delete to authenticated using (is_admin());

-- families: confidential-gated read/write for staff
create policy "staff read families" on families for select to authenticated
  using (not is_confidential or can_view_confidential());
create policy "staff insert families" on families for insert to authenticated
  with check (not is_confidential or can_view_confidential());
create policy "staff update families" on families for update to authenticated
  using (not is_confidential or can_view_confidential())
  with check (not is_confidential or can_view_confidential());
create policy "admin delete families" on families for delete to authenticated using (is_admin());

-- children: same confidential gate, via family_id
create policy "staff read children" on children for select to authenticated
  using (
    not exists (select 1 from families f where f.id = family_id and f.is_confidential)
    or can_view_confidential()
  );
create policy "staff insert children" on children for insert to authenticated
  with check (
    not exists (select 1 from families f where f.id = family_id and f.is_confidential)
    or can_view_confidential()
  );
create policy "staff update children" on children for update to authenticated
  using (
    not exists (select 1 from families f where f.id = family_id and f.is_confidential)
    or can_view_confidential()
  )
  with check (
    not exists (select 1 from families f where f.id = family_id and f.is_confidential)
    or can_view_confidential()
  );
create policy "admin delete children" on children for delete to authenticated using (is_admin());

-- cards: same confidential gate, via child_id -> family
create policy "staff read cards" on cards for select to authenticated
  using (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
  );
create policy "staff insert cards" on cards for insert to authenticated
  with check (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
  );
create policy "staff update cards" on cards for update to authenticated
  using (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
  )
  with check (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
  );
create policy "admin delete cards" on cards for delete to authenticated using (is_admin());

-- wishlist_items: same confidential gate, via child_id -> family
create policy "staff read wishlist_items" on wishlist_items for select to authenticated
  using (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
  );
create policy "staff insert wishlist_items" on wishlist_items for insert to authenticated
  with check (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
  );
create policy "staff update wishlist_items" on wishlist_items for update to authenticated
  using (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
  )
  with check (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
  );
create policy "admin delete wishlist_items" on wishlist_items for delete to authenticated using (is_admin());

-- sponsors / assignments: staff read/write; anon gets NO direct access at all
-- (public claiming goes through claim_card() below, which bypasses RLS via
-- security definer — this is the only door in).
create policy "staff read sponsors" on sponsors for select to authenticated using (true);
create policy "staff insert sponsors" on sponsors for insert to authenticated with check (true);
create policy "staff update sponsors" on sponsors for update to authenticated using (true) with check (true);
create policy "admin delete sponsors" on sponsors for delete to authenticated using (is_admin());

create policy "staff read assignments" on assignments for select to authenticated using (true);
create policy "staff insert assignments" on assignments for insert to authenticated with check (true);
create policy "staff update assignments" on assignments for update to authenticated using (true) with check (true);
create policy "admin delete assignments" on assignments for delete to authenticated using (is_admin());

-- profiles: everyone can read/update their own row; admins can read/update all
create policy "read own or admin profile" on profiles for select to authenticated
  using (id = auth.uid() or is_admin());
create policy "update own or admin profile" on profiles for update to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());
create policy "admin insert profiles" on profiles for insert to authenticated with check (is_admin());
create policy "admin delete profiles" on profiles for delete to authenticated using (is_admin());

-- audit_log: admin read-only; nothing else writes to it except the trigger
-- function below (which runs as security definer, bypassing these policies)
create policy "admin read audit_log" on audit_log for select to authenticated using (is_admin());

-- =============================================================================
-- Grants
-- (RLS decides *which rows*; these grants decide whether a role may attempt
-- the operation on the table at all.)
-- =============================================================================

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on drives, schools, drive_schools,
  families, children, cards, wishlist_items, sponsors, assignments
  to authenticated;
grant select, update on profiles to authenticated;
grant select on audit_log to authenticated;

grant select on child_card_numbers, cards_needing_print, printable_cards to authenticated;
grant select on public_available_cards to anon, authenticated;

-- =============================================================================
-- Triggers
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on drives
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on families
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on children
  for each row execute function public.set_updated_at();

-- Creates a profile row automatically whenever someone signs up through
-- Supabase Auth. Runs as security definer so it can insert into `profiles`
-- regardless of the new user's own (not-yet-existing) permissions.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Generic audit trigger: logs every insert/update/delete on the tables below
-- so no code path can accidentally skip logging (see SCHEMA.md §11).
create or replace function public.audit_log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id uuid;
  v_diff jsonb;
begin
  if tg_op = 'DELETE' then
    v_record_id := old.id;
    v_diff := to_jsonb(old);
  else
    v_record_id := new.id;
    if tg_op = 'UPDATE' then
      v_diff := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
    else
      v_diff := to_jsonb(new);
    end if;
  end if;

  insert into audit_log (table_name, record_id, action, changed_by, diff)
  values (tg_table_name, v_record_id, lower(tg_op), auth.uid(), v_diff);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger audit_drives after insert or update or delete on drives
  for each row execute function public.audit_log_change();
create trigger audit_schools after insert or update or delete on schools
  for each row execute function public.audit_log_change();
create trigger audit_drive_schools after insert or update or delete on drive_schools
  for each row execute function public.audit_log_change();
create trigger audit_families after insert or update or delete on families
  for each row execute function public.audit_log_change();
create trigger audit_children after insert or update or delete on children
  for each row execute function public.audit_log_change();
create trigger audit_cards after insert or update or delete on cards
  for each row execute function public.audit_log_change();
create trigger audit_wishlist_items after insert or update or delete on wishlist_items
  for each row execute function public.audit_log_change();
create trigger audit_sponsors after insert or update or delete on sponsors
  for each row execute function public.audit_log_change();
create trigger audit_assignments after insert or update or delete on assignments
  for each row execute function public.audit_log_change();
create trigger audit_profiles after insert or update or delete on profiles
  for each row execute function public.audit_log_change();

-- =============================================================================
-- Public claim function
-- The only way an anonymous sponsor can write anything. Race-safe: the
-- unique partial index one_active_assignment_per_card is the real guarantee
-- (the SELECT below is just for a friendlier error message).
-- =============================================================================

create or replace function public.claim_card(
  p_card_id uuid,
  p_sponsor_name text,
  p_sponsor_email text default null,
  p_sponsor_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sponsor_id uuid;
  v_already_claimed uuid;
begin
  if p_sponsor_name is null or btrim(p_sponsor_name) = '' then
    raise exception 'Sponsor name is required.';
  end if;

  select a.id into v_already_claimed
  from assignments a
  where a.card_id = p_card_id and a.status <> 'cancelled'
  limit 1;

  if v_already_claimed is not null then
    raise exception 'This card has already been claimed.';
  end if;

  if exists (
    select 1 from cards crd
    join children ch on ch.id = crd.child_id
    join families f on f.id = ch.family_id
    where crd.id = p_card_id and f.is_confidential
  ) then
    raise exception 'This card is not available for public claiming.';
  end if;

  insert into sponsors (name, email, phone)
  values (btrim(p_sponsor_name), nullif(btrim(coalesce(p_sponsor_email, '')), ''), nullif(btrim(coalesce(p_sponsor_phone, '')), ''))
  returning id into v_sponsor_id;

  begin
    insert into assignments (card_id, sponsor_id, status, claimed_at)
    values (p_card_id, v_sponsor_id, 'pledged', now());
  exception when unique_violation then
    raise exception 'This card was just claimed by someone else — please pick another.';
  end;

  return v_sponsor_id;
end;
$$;

grant execute on function public.claim_card(uuid, text, text, text) to anon, authenticated;
