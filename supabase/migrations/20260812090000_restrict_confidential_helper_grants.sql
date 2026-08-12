-- Follow-up to 20260811120000_fix_confidential_rls_subquery_leak.sql, per
-- reach-reviewer: the four new security-definer helpers there
-- (family_is_confidential, family_created_by, child_family_id,
-- next_confidential_family_number) got no explicit grant/revoke. Each one
-- takes a target id and answers a confidentiality-relevant question about an
-- arbitrary row (bypassing RLS by design, since that's the whole point of
-- them existing), so being callable by anyone holding just the anon key — no
-- login required — defeats the fix that migration was making.
-- family_created_by() is the sharpest case: it hands back the creating staff
-- member's profiles.id for a confidential family to anyone who knows that
-- family's uuid, with zero authentication.
--
-- First attempt at this fix (same file, since it never actually applied)
-- revoked from `public`, on the assumption these functions fell back to
-- Postgres' EXECUTE-to-PUBLIC default. Checked pg_proc.proacl directly
-- against dev and found that's wrong: this project's public schema has
-- Supabase's platform-level default privileges configured, which
-- auto-grants EXECUTE to anon/authenticated/service_role on every new
-- function at CREATE time, regardless of what the migration itself grants.
-- That's an explicit per-role grant, not an inherited PUBLIC one, so
-- `revoke ... from public` was a no-op — confirmed live: it changed nothing.
-- Revoking from `anon` directly is the actual fix.
--
-- Restricting to `authenticated` (not `anon`) closes the no-login angle,
-- which is the actual gap — this app's whole client surface for anon is the
-- public sponsor pages, none of which have any legitimate reason to call
-- these. It does not fully close probing by a signed-in, non-cleared
-- volunteer who already holds a specific uuid, because PostgREST exposes any
-- role's function EXECUTE grant as a directly-callable RPC — there's no
-- "usable inside RLS policies only" grant in Postgres. That residual is the
-- same "uuids aren't guessable" reasoning already relied on elsewhere in this
-- schema (e.g. the open INSERT policies since 20260708140000); unlike the
-- anon case, it requires already holding a real staff login. service_role is
-- untouched — it bypasses RLS entirely regardless of function grants, so
-- restricting its EXECUTE here would be meaningless.

revoke execute on function public.family_is_confidential(uuid) from public, anon;
revoke execute on function public.family_created_by(uuid) from public, anon;
revoke execute on function public.child_family_id(uuid) from public, anon;
revoke execute on function public.next_confidential_family_number(uuid) from public, anon;

grant execute on function public.family_is_confidential(uuid) to authenticated;
grant execute on function public.family_created_by(uuid) to authenticated;
grant execute on function public.child_family_id(uuid) to authenticated;
grant execute on function public.next_confidential_family_number(uuid) to authenticated;
