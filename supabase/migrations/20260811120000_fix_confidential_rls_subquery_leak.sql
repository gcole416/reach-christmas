-- Fixes GitLab issue #19: the confidentiality gate on children/cards/
-- wishlist_items was implemented as a subquery/join back to `families`
-- inside each policy's own `using`/`with check` clause, e.g. (children,
-- as of 20260708140000_confidential_referral_access.sql):
--
--   not exists (select 1 from families f where f.id = family_id and f.is_confidential)
--   or can_view_confidential()
--   or exists (select 1 from families f where f.id = family_id and f.created_by = auth.uid())
--
-- That subquery is itself executed as the querying user, so it is subject to
-- `families`' OWN RLS policy ("staff read families"). For a volunteer who is
-- not cleared for confidential families and didn't create this one, the
-- confidential family's row is invisible to them inside that subquery too —
-- `not exists(...)` then evaluates to TRUE, and the policy incorrectly grants
-- read (and, for the update policies, write) access to that family's
-- children/cards/wishlist_items. The family row itself stays correctly
-- hidden; its children/cards/wishlist_items leak through regardless of role.
--
-- Confirmed live against the dev project: a signed-in volunteer test account
-- (no can_view_confidential, not the creator) can select a child row that
-- belongs to a confidential family created by someone else.
--
-- Fix: never let the confidentiality check depend on the querying user's own
-- visibility into `families`. Two new `security definer` helpers (same
-- pattern as is_admin()/can_view_confidential() below in the init migration)
-- resolve confidentiality and ownership by reading `families` with the
-- function owner's privileges, bypassing RLS entirely rather than being
-- subject to it — so the answer is correct regardless of whether the calling
-- user could see that families row directly.
--
-- `families` itself is NOT affected — its own policies check
-- `is_confidential`/`created_by` directly on the row being evaluated, with no
-- subquery back to itself, so there's nothing here to bypass. The INSERT
-- policies on children/cards/wishlist_items are also unaffected: since
-- 20260708140000 they're unconditional (`with check (true)`), with no
-- confidentiality subquery left to be wrong. `sponsors`/`assignments` have no
-- confidentiality gate at all by design (see SCHEMA.md's RLS table) and
-- `public_available_cards` doesn't use RLS at all (documented exception,
-- filters `is_confidential` inline as its own boundary) — neither is in
-- scope for this fix.
--
-- Second finding, same root cause, different function: `create_family()`
-- (supabase/migrations/20260708160000_atomic_family_numbers.sql) is
-- `security invoker`, and its confidential-numbering branch —
--   select coalesce(max(family_number), 0) + 1 into v_next_number
--   from families where drive_id = p_drive_id and is_confidential;
-- — is a permission-sensitive count subject to the SAME caller RLS on
-- `families`. A caller who can't see an existing confidential family in this
-- drive (not cleared, not its creator) computes a "next" number that's
-- already taken by a confidential family they can't see, and the INSERT
-- fails with a `families_number_confidential` unique-constraint violation
-- instead of a clean permission error — confirmed live: any confidential
-- family created by a session other than the one calling create_family (and
-- lacking can_view_confidential) collides with an existing lower-numbered
-- confidential family it can't see. Fixed the same way: the confidential
-- branch's count now goes through a `security definer` helper
-- (next_confidential_family_number) instead of a caller-RLS-subject SELECT.
-- create_family() itself stays `security invoker` — per its own original
-- rationale (SCHEMA.md §5), the INSERT doesn't need elevated privilege, only
-- this one read does. The non-confidential branch is untouched: a
-- non-confidential family's row is always visible under `families`' own
-- policy regardless of caller, so there's nothing to bypass there.

-- =============================================================================
-- Helper functions
-- =============================================================================

-- True if the given family is confidential. Resolves directly against
-- `families` as the function owner (security definer), independent of the
-- calling user's own RLS visibility into that row. False (not true) for an
-- unknown/deleted family id, so a dangling reference never accidentally
-- grants access.
create or replace function public.family_is_confidential(p_family_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_confidential from families where id = p_family_id), false);
$$;

-- The `created_by` of the given family, or null if unknown/deleted. Same
-- RLS-bypass rationale as family_is_confidential() above — lets a policy ask
-- "did I create this confidential family" without needing to already be able
-- to see the family row through `families`' own policy.
create or replace function public.family_created_by(p_family_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select created_by from families where id = p_family_id;
$$;

-- Resolves a child's family_id as the function owner, so cards/wishlist_items
-- policies (which only carry child_id) can chain into family_is_confidential()
-- / family_created_by() without going through `children`'s own RLS either —
-- the same class of bug could otherwise recur one join further out.
create or replace function public.child_family_id(p_child_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select family_id from children where id = p_child_id;
$$;

-- =============================================================================
-- children: read/update policies rewritten to use the helpers above
-- =============================================================================

drop policy "staff read children" on children;
create policy "staff read children" on children for select to authenticated
  using (
    not family_is_confidential(family_id)
    or can_view_confidential()
    or family_created_by(family_id) = auth.uid()
  );

drop policy "staff update children" on children;
create policy "staff update children" on children for update to authenticated
  using (
    not family_is_confidential(family_id)
    or can_view_confidential()
    or family_created_by(family_id) = auth.uid()
  )
  with check (
    not family_is_confidential(family_id)
    or can_view_confidential()
    or family_created_by(family_id) = auth.uid()
  );

-- =============================================================================
-- cards: read/update policies rewritten to use the helpers above
-- =============================================================================

drop policy "staff read cards" on cards;
create policy "staff read cards" on cards for select to authenticated
  using (
    not family_is_confidential(child_family_id(child_id))
    or can_view_confidential()
    or family_created_by(child_family_id(child_id)) = auth.uid()
  );

drop policy "staff update cards" on cards;
create policy "staff update cards" on cards for update to authenticated
  using (
    not family_is_confidential(child_family_id(child_id))
    or can_view_confidential()
    or family_created_by(child_family_id(child_id)) = auth.uid()
  )
  with check (
    not family_is_confidential(child_family_id(child_id))
    or can_view_confidential()
    or family_created_by(child_family_id(child_id)) = auth.uid()
  );

-- =============================================================================
-- wishlist_items: read/update policies rewritten to use the helpers above
-- =============================================================================

drop policy "staff read wishlist_items" on wishlist_items;
create policy "staff read wishlist_items" on wishlist_items for select to authenticated
  using (
    not family_is_confidential(child_family_id(child_id))
    or can_view_confidential()
    or family_created_by(child_family_id(child_id)) = auth.uid()
  );

drop policy "staff update wishlist_items" on wishlist_items;
create policy "staff update wishlist_items" on wishlist_items for update to authenticated
  using (
    not family_is_confidential(child_family_id(child_id))
    or can_view_confidential()
    or family_created_by(child_family_id(child_id)) = auth.uid()
  )
  with check (
    not family_is_confidential(child_family_id(child_id))
    or can_view_confidential()
    or family_created_by(child_family_id(child_id)) = auth.uid()
  );

-- =============================================================================
-- create_family(): fix the same class of bug in its confidential-numbering
-- read (see header comment above)
-- =============================================================================

-- Counts existing confidential families for a drive as the function owner,
-- bypassing the caller's own RLS on `families` — so the number a caller gets
-- back is correct regardless of which confidential families (if any) they
-- personally have visibility into.
create or replace function public.next_confidential_family_number(p_drive_id uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(max(family_number), 0) + 1
  from families
  where drive_id = p_drive_id and is_confidential;
$$;

-- Same signature/behavior/lock strategy as
-- 20260708160000_atomic_family_numbers.sql's create_family() — only the
-- confidential branch's number computation changes, from an inline SELECT
-- subject to caller RLS to the security-definer helper above. Still
-- `security invoker` overall: the INSERT itself needs no elevated privilege
-- (any authenticated staff member already has insert rights on `families`),
-- only the confidential-count read did.
create or replace function public.create_family(
  p_drive_id uuid,
  p_drive_school_id uuid,
  p_is_confidential boolean,
  p_sort_tag text default null,
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

  insert into families (drive_id, drive_school_id, family_number, is_confidential, sort_tag, internal_notes, created_by)
  values (p_drive_id, p_drive_school_id, v_next_number, p_is_confidential, p_sort_tag, p_internal_notes, auth.uid())
  returning * into v_family;

  return v_family;
end;
$$;

grant execute on function public.create_family(uuid, uuid, boolean, text, text) to authenticated;
