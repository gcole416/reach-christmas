-- Fixes a latent bug in prevent_role_self_escalation()
-- (20260708130000_profiles_staff_management.sql): is_admin() returns false
-- whenever auth.uid() is null (no logged-in user), so "not is_admin()" was
-- true for any statement running outside a user JWT context too — e.g. the
-- service_role-driven demo/reset scripts (supabase/demo_seed.sql,
-- supabase/reset_dev_data.sql) or a fix applied directly via the SQL editor.
-- Any of those touching role or can_view_confidential would incorrectly hit
-- "Only an admin can change role or confidential access," even though
-- service_role already bypasses RLS entirely and is trusted. Scope the check
-- to actual logged-in, non-admin callers only.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not is_admin() then
    if new.role is distinct from old.role or new.can_view_confidential is distinct from old.can_view_confidential then
      raise exception 'Only an admin can change role or confidential access.';
    end if;
  end if;
  return new;
end;
$$;
