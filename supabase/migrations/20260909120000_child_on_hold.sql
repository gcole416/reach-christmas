-- US-38 (docs/backlog.md) — put a child "on hold" for duplicate
-- review. Prompted by Grant reviewing the Rivera / Rivera 2 test data: US-37
-- tells staff two households are probably the same, but gives them nowhere to
-- act on it. "On hold" is the reversible middle path — no delete, no merge, no
-- household-group model, admin-only.
--
-- WHAT THIS DOES
-- A child on hold has their card pulled from the sponsor pool, the print run,
-- and every count/board until an admin releases it. Nothing is deleted; the
-- child row stays fully present in the families explorer so staff can still
-- find them.
--
--   * children.held_at / held_by / hold_reason — all nullable. held_at IS NULL
--     means "not on hold". Set and cleared ONLY through set_child_hold() /
--     release_child_hold() — never a direct column UPDATE from the app.
--   * set_child_hold(child_id, reason) / release_child_hold(child_id) —
--     security definer, is_admin() only (plus can_view_confidential() when the
--     child's household is confidential, mirroring import_submission's §8 gate
--     even though every admin already clears the helper — belt and braces, and
--     it documents intent). set_child_hold RAISES, naming the sponsor, if the
--     child's card still has a non-cancelled assignment: the process holds
--     children before sponsor claiming opens, so this shouldn't arise, but it
--     is blocked defensively rather than silently succeeding. Both functions
--     write through `children`, so the existing `audit_children` trigger fires
--     and auth.uid() still resolves to the acting admin.
--   * public_available_cards / printable_cards / cards_needing_print all gain
--     one added inner predicate `and ch.held_at is null`, in the exact spot
--     `and not ch.is_high_schooler` sits. The sponsor-facing exclusion is a
--     predicate IN THE VIEW, at the database layer, per AGENTS.md — the anon
--     column whitelist, the literal `not f.is_confidential` inner join, the
--     open-drive join and the not-already-claimed filter are all unchanged, and
--     no view in the chain is security_invoker.
--
-- No new table: `children` already has the RLS policies (20260811120000) and
-- the audit trigger (20260708120000) this needs — same as the US-32 / US-35
-- columns. import_submission() / submit_form() are UNCHANGED.
--
-- The web/lib data layer mirrors the `held_at is null` predicate the same way
-- isHighSchoolGrade mirrors is_high_school_grade: held children are dropped
-- from the dashboard stats, the fulfilment board, the shopping list, the
-- distribution list, and the high-schooler roster / shop-day board. The
-- families/household explorer keeps them (with heldAt exposed for a badge).
--
-- APPLY TARGET: dev only (thvyntrxmahygesltgft). Prod is untouched until a
-- Software Acceptance Review clears it (same rule as every intake migration).
-- No SQL was executed by an agent — Grant pastes this file.
--
-- reach-reviewer gate REQUIRED: touches public_available_cards (the anon
-- boundary).

begin;

-- =============================================================================
-- 1. Columns.
-- =============================================================================
alter table children add column if not exists held_at timestamptz;
alter table children add column if not exists held_by uuid references profiles(id);
alter table children add column if not exists hold_reason text;

comment on column children.held_at is
  'US-38: when this child was put on hold for duplicate review. NOT NULL = on hold '
  '(card out of the sponsor pool, print run and every count). Set/cleared only via '
  'set_child_hold() / release_child_hold().';

-- Partial index for the /admin/on-hold page and the dashboard tile — the held
-- slice is read on its own page and reconciled against a stat, same reasoning
-- as children_high_schooler_idx.
create index if not exists children_on_hold_idx
  on children (family_id) where held_at is not null;

-- =============================================================================
-- 2. set_child_hold / release_child_hold.
-- =============================================================================
-- Grant/security-definer conventions per SCHEMA.md §12.2: security definer,
-- explicit search_path, execute revoked from public + anon, then granted to
-- `authenticated` only. is_admin() is re-checked in the body — a grant is not
-- an authorization check.

create or replace function public.set_child_hold(p_child_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_sponsor   text;
begin
  if not is_admin() then
    raise exception 'Only an administrator can put a child on hold.';
  end if;

  select family_id into v_family_id from children where id = p_child_id;
  if v_family_id is null then
    raise exception 'That child could not be found.';
  end if;

  -- Confidential floor: resolved through the security-definer helper the RLS
  -- policies use, independent of the caller's own visibility (the US-16
  -- pattern). Every admin already clears can_view_confidential(); this stays
  -- for intent and in case that helper's logic ever changes.
  if family_is_confidential(v_family_id) and not can_view_confidential() then
    raise exception 'That child could not be found.';  -- indistinguishable from not-found on purpose
  end if;

  -- Defensive (US-38 scope note: holds happen before claiming opens, so this
  -- shouldn't arise). If the card is claimed, name the sponsor and stop.
  select s.name into v_sponsor
  from cards crd
  join assignments a on a.card_id = crd.id and a.status <> 'cancelled'
  join sponsors s on s.id = a.sponsor_id
  where crd.child_id = p_child_id
  limit 1;

  if v_sponsor is not null then
    raise exception
      'This child''s card is claimed by %. Cancel that sponsor''s claim before putting the child on hold.',
      v_sponsor;
  end if;

  update children
  set held_at     = now(),
      held_by     = auth.uid(),
      hold_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_child_id;
end;
$$;

revoke execute on function public.set_child_hold(uuid, text) from public, anon;
grant execute on function public.set_child_hold(uuid, text) to authenticated;

create or replace function public.release_child_hold(p_child_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if not is_admin() then
    raise exception 'Only an administrator can release a hold.';
  end if;

  select family_id into v_family_id from children where id = p_child_id;
  if v_family_id is null then
    raise exception 'That child could not be found.';
  end if;

  if family_is_confidential(v_family_id) and not can_view_confidential() then
    raise exception 'That child could not be found.';
  end if;

  update children
  set held_at     = null,
      held_by     = null,
      hold_reason = null
  where id = p_child_id;
end;
$$;

revoke execute on function public.release_child_hold(uuid) from public, anon;
grant execute on function public.release_child_hold(uuid) to authenticated;

-- =============================================================================
-- 3. Views: keep a held child's card out of the sponsor pool and the print run.
-- =============================================================================

-- public_available_cards — the ENTIRE anon/sponsor security boundary. This is
-- character-for-character 20260908130000_high_schooler_bucket.sql's definition
-- with ONE added inner predicate: `and ch.held_at is null`, right beside
-- `and not ch.is_high_schooler`. Everything else is unchanged — the column
-- whitelist, `not f.is_confidential` as a literal inner join condition (NOT a
-- helper — anon has no EXECUTE), the open-drive join, the not-already-claimed
-- filter, no security_invoker view anywhere in the chain, no `select *`.
drop view if exists public_available_cards;

create view public_available_cards as
select
  crd.id as card_id,
  coalesce(ds.code, 'Z') || f.family_number || '.' || ch.child_index as card_number,
  ch.first_name,
  ch.grade,
  ch.pant_size, ch.shirt_size, ch.shoe_size,
  ch.specific_needs,
  wi.description as wishlist_description
from cards crd
join children ch on ch.id = crd.child_id and not ch.is_high_schooler and ch.held_at is null
join families f on f.id = ch.family_id and not f.is_confidential
join drives d on d.id = f.drive_id and d.status = 'open'
left join drive_schools ds on ds.id = f.drive_school_id
left join wishlist_items wi on wi.child_id = ch.id
where not exists (
  select 1 from assignments a where a.card_id = crd.id and a.status <> 'cancelled'
);

-- `drop view` discards grants — reissue, exactly as the prior migrations did.
grant select on public_available_cards to anon, authenticated;

-- printable_cards / cards_needing_print — 20260908130000 verbatim, plus
-- `and ch.held_at is null`. A child under duplicate review isn't printed.
drop view if exists cards_needing_print;
drop view if exists printable_cards;

create view cards_needing_print
  with (security_invoker = true) as
select
  ch.id as child_id,
  ch.first_name,
  crd.id as card_id
from children ch
join cards crd on crd.child_id = ch.id
where crd.printed_at is null
  and not ch.is_high_schooler
  and ch.held_at is null;

create view printable_cards
  with (security_invoker = true) as
select
  crd.id as card_id,
  ccn.card_number as display_label,
  ch.first_name,
  ch.grade,
  crd.printed_at,
  f.drive_id
from cards crd
join children ch on ch.id = crd.child_id and not ch.is_high_schooler and ch.held_at is null
join families f on f.id = ch.family_id
join child_card_numbers ccn on ccn.child_id = ch.id;

grant select on cards_needing_print, printable_cards to authenticated;

commit;

-- VERIFY (run after applying, dev only):
--
-- 1. Columns
--    select held_at, held_by, hold_reason from children limit 1;   -- all null
--
-- 2. Functions — as a signed-in ADMIN session (not the SQL editor, which runs
--    as postgres and bypasses is_admin()):
--    select set_child_hold('<child_id>', 'possible dup of OL3');
--    select held_at, held_by, hold_reason from children where id = '<child_id>';
--    select release_child_hold('<child_id>');   -- held_at back to null
--
--    As a VOLUNTEER session: select set_child_hold('<child_id>', 'x');
--      -> raises 'Only an administrator can put a child on hold.'
--
--    On a child whose card has a non-cancelled assignment:
--      select set_child_hold('<that_child_id>', 'x');
--      -> raises 'This child''s card is claimed by <sponsor>. Cancel ...'
--
-- 3. Sponsor boundary — as a genuinely anonymous client, not the SQL editor:
--    set local role anon;
--    select count(*) from public_available_cards;   -- unchanged for non-held
--    -- put a scratch open-drive child on hold, confirm its card_id and
--    -- first_name drop out of public_available_cards, then release it.
--    reset role;
--
-- 4. Print run
--    select count(*) from printable_cards;       -- excludes held
--    select count(*) from cards_needing_print;   -- excludes held
