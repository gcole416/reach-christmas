-- Supports the staff/permissions management page:
--   1. profiles.email — auth.users isn't queryable through the client API at
--      all (no grant exists for it), so without a synced copy here, an admin
--      viewing the staff list would have no way to tell accounts apart beyond
--      full_name (which itself falls back to email today via handle_new_user's
--      coalesce, but only by accident). Same denormalization pattern as
--      cards.total_copies — a deliberate synced copy, not a live source. It
--      can go stale if someone changes their email through Supabase Auth;
--      acceptable for a handful of staff accounts, not worth a sync trigger.
--   2. prevent_role_self_escalation — RLS is row-level, not column-level.
--      "update own or admin profile" (see init migration) correctly lets
--      anyone edit their own row so they can update full_name, but as written
--      it also lets a plain volunteer set their OWN role to 'admin' via a
--      direct table update, since the policy only checks "is this my row,"
--      never "which columns changed." This trigger closes that gap: a non-admin
--      can still update their own row, just not its role or confidential
--      access, no matter how the request reaches the database.

alter table profiles add column email text;

update profiles p
set email = au.email
from auth.users au
where au.id = p.id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email);
  return new;
end;
$$;

create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    if new.role is distinct from old.role or new.can_view_confidential is distinct from old.can_view_confidential then
      raise exception 'Only an admin can change role or confidential access.';
    end if;
  end if;
  return new;
end;
$$;

create trigger prevent_role_self_escalation
  before update on profiles
  for each row execute function public.prevent_role_self_escalation();
