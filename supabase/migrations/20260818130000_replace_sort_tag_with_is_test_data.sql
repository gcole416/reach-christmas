-- Implements docs/OPEN_QUESTIONS.md ADM-1. The owner's answer: sort_tag ("was
-- supposed to be a way to color coordinate/sort bags for students out") is no
-- longer needed as a feature — "Clean up the tag from database and UI where
-- needed."
--
-- Second, sharper problem the owner's answer didn't know about: sort_tag
-- doubled as the e2e test suite's cleanup marker (web/tests/e2e/helpers/
-- factories.ts sets p_sort_tag: 'AutoTest' on every family it creates;
-- web/tests/e2e/helpers/cleanup.ts deletes every family with
-- sort_tag = 'AutoTest' after each run). That's a genuine hazard on its own,
-- independent of whether the wrapping-color feature is wanted: a volunteer
-- who typed "AutoTest" into that free-text field would have their family
-- silently deleted by the next test run. So this migration can't just drop
-- the column — it has to give the test suite a real replacement marker
-- first, in the same migration, so nothing is left without a cleanup
-- mechanism even for one commit.
--
-- families.is_test_data is that replacement: a boolean, not a free-text
-- field, and deliberately not exposed in any UI form (frontend-designer is
-- removing the sort_tag inputs from web/app/admin/intake/page.tsx and
-- web/app/admin/families/[familyId]/page.tsx in the same pass) — so there is
-- no text box a real volunteer could type a colliding value into.
--
-- Third problem, caught by reach-reviewer on this migration before it was
-- ever applied: supabase/demo_seed.sql and demo_seed_bulk.sql *also* needed
-- repointing off the dropped sort_tag = 'Demo' marker, and the first draft of
-- this migration pointed both the e2e suite and the demo seed scripts at the
-- same is_test_data flag. That reintroduces exactly the hazard this migration
-- exists to remove, just between different actors: cleanup.ts's own comment
-- says it "never touches Demo data", but a shared is_test_data = true would
-- make every demo-seeded family indistinguishable from an e2e-created one —
-- running the e2e suite against a database someone just demo-seeded for a
-- stakeholder walkthrough would silently delete the demo data.
--
-- Fix: is_test_data stays the broad "not real production data" flag (set by
-- both demo_seed*.sql directly and by create_family() for e2e), but a second,
-- narrower is_autotest_data flag is added — set ONLY when the e2e suite calls
-- create_family() with p_is_test_data = true (the only caller that ever
-- passes true; the real intake form never does). demo_seed*.sql never sets
-- it, so it stays false on every demo-seeded row. cleanup.ts now deletes on
-- is_autotest_data = true instead, so the two marker spaces can't collide
-- again even though they share the broader is_test_data flag.

alter table families
  add column is_test_data boolean not null default false;

alter table families
  add column is_autotest_data boolean not null default false;

-- sort_tag was live, staff-facing free text ("e.g. wrapping color") — before
-- pasting this into a project's SQL editor, confirm nothing real is about to
-- be discarded, e.g.:
--   select id, sort_tag from families
--   where sort_tag is not null and sort_tag not in ('AutoTest', 'Demo');
-- Dev is expected to be empty or e2e/demo rows only; prod (whenever this is
-- applied there) needs an actual eyeball on the result before running this.
alter table families
  drop column sort_tag;

-- create_family() is the single insert path for families (both the real
-- intake form and the e2e test factory go through it — see
-- web/lib/store.tsx's addFamily and web/tests/e2e/helpers/factories.ts), so
-- it's the only place that needs to know about the new column.
--
-- This changes the parameter list (a text param removed, a boolean param
-- added in its place), not just the body, so `create or replace function`
-- alone would not replace the old (uuid, uuid, boolean, text, text)
-- overload — it would leave it in place and create a second, overloaded
-- function. Drop the old signature explicitly first.
drop function if exists public.create_family(uuid, uuid, boolean, text, text);

-- Same signature/behavior/lock strategy as the create_family() defined in
-- 20260811120000_fix_confidential_rls_subquery_leak.sql (the most recent
-- prior definition — 20260708160000_atomic_family_numbers.sql's version was
-- superseded by it) — only p_sort_tag/sort_tag is replaced by
-- p_is_test_data/is_test_data, in the same parameter position. Still
-- `security invoker`: the insert itself needs no elevated privilege, and the
-- confidential-count read still goes through next_confidential_family_number()
-- (security definer) rather than a raw subquery, unchanged from before.
create or replace function public.create_family(
  p_drive_id uuid,
  p_drive_school_id uuid,
  p_is_confidential boolean,
  p_is_test_data boolean default false,
  p_internal_notes text default null
)
returns families
language plpgsql
security invoker
as $$
declare
  v_lock_key bigint;
  v_next_number int;
  v_family families;
begin
  v_lock_key := hashtextextended(
    coalesce(p_drive_school_id::text, 'confidential:' || p_is_confidential::text) || ':' || p_drive_id::text,
    0
  );
  -- Held for the rest of this transaction (this one RPC call) — a concurrent
  -- call for the same scope blocks here until this one commits, so two calls
  -- can never compute the same "next" number.
  perform pg_advisory_xact_lock(v_lock_key);

  if p_is_confidential then
    v_next_number := public.next_confidential_family_number(p_drive_id);
  else
    select coalesce(max(family_number), 0) + 1 into v_next_number
    from families
    where drive_id = p_drive_id
      and drive_school_id is not distinct from p_drive_school_id
      and not is_confidential;
  end if;

  -- p_is_test_data drives both columns: is_test_data (the broad "not real
  -- data" flag, shared with demo_seed*.sql) and is_autotest_data (the narrow
  -- flag only this RPC ever sets, which is what cleanup.ts keys deletion on —
  -- see the migration header for why these can't be the same column).
  insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data, is_autotest_data, internal_notes, created_by)
  values (p_drive_id, p_drive_school_id, v_next_number, p_is_confidential, p_is_test_data, p_is_test_data, p_internal_notes, auth.uid())
  returning * into v_family;

  return v_family;
end;
$$;

-- `drop function` discards any previously-granted privileges (same reasoning
-- as the anon/authenticated grant re-issue in
-- 20260818120000_fix_public_available_cards_anon_bug.sql) — re-grant on the
-- new signature. Matches 20260811120000's grant exactly except for the
-- changed parameter type list.
grant execute on function public.create_family(uuid, uuid, boolean, boolean, text) to authenticated;

-- No RLS/policy changes needed: families' existing row-level policies gate on
-- is_confidential/created_by, not on individual columns, and Postgres RLS has
-- no column-level equivalent to begin with — is_test_data and is_autotest_data
-- are covered by the same policies sort_tag was, automatically, same as
-- internal_notes already is.
