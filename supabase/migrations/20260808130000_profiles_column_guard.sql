-- Reach Christmas gift drive — close a privilege-escalation gap on profiles
--
-- "update own or admin profile" (20260708120000_init.sql) is row-level only:
-- it lets id = auth.uid() through with no restriction on *which* columns
-- change. That means a plain authenticated volunteer can currently update
-- their own `role` or `can_view_confidential` via a direct Supabase client
-- call (self-promote to admin, or self-grant confidential access) — the
-- policy never inspects the columns, only whose row it is.
--
-- Fix: a BEFORE UPDATE trigger that raises if role or can_view_confidential
-- are changing and the actor isn't an admin. This is a second, independent
-- layer on top of the existing RLS policy (defense in depth) rather than a
-- replacement for it — the row-level policy still governs which rows can be
-- touched at all.
--
-- Scoped to `auth.uid() is not null`: a null auth.uid() means the statement
-- is running outside a user JWT context (e.g. the service_role key used by
-- server-side seed/reset scripts per memory.md), which already bypasses RLS
-- entirely and is trusted. Admins (is_admin()) are always allowed through
-- regardless.

create or replace function public.guard_profile_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role, new.can_view_confidential) is distinct from (old.role, old.can_view_confidential)
     and auth.uid() is not null
     and not is_admin() then
    raise exception 'Only an admin can change role or can_view_confidential.';
  end if;

  return new;
end;
$$;

create trigger guard_profile_privilege_columns
  before update on profiles
  for each row execute function public.guard_profile_privilege_columns();
