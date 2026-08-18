-- Fixes US-17 (docs/backlog.md): public_available_cards returned 0 rows to a
-- genuinely anonymous caller (15 rows to an authenticated admin querying the
-- identical view). Confirmed live against the dev project before writing
-- this migration:
--   set local role anon; select count(*) from public_available_cards;  -> 0
--   set local role anon; select count(*) from child_card_numbers;      -> 0
-- (both returned zero rows with no permission error, which also confirms
-- OPEN_QUESTIONS.md DB-2's finding for this project: anon apparently does
-- hold an implicit SELECT on the view objects themselves via platform
-- defaults, despite no explicit `grant ... to anon` on child_card_numbers --
-- it's RLS-with-no-anon-policies on the *underlying* tables doing the
-- blocking, not a missing object-level grant.)
--
-- Root cause: public_available_cards is correctly NOT security_invoker --
-- its own families/children/cards/wishlist_items reads run as the view
-- owner, which is deliberate (see SCHEMA.md "Public (sponsor-facing)
-- access"). But it joined child_card_numbers, a *different* view that IS
-- `security_invoker = true` (20260708120000_init.sql:175-176 -- relied on by
-- staff-facing views/RLS; do NOT remove it there, see backlog.md US-17
-- guardrails). Postgres applies a view's own security_invoker setting only
-- to that view's own base-table reads, not to whatever called it, so
-- child_card_numbers' children/families/drive_schools reads ran as the
-- *original calling role* -- anon, for a sponsor -- which has zero RLS
-- policies on those tables, and the inner join collapsed to nothing. An
-- authenticated admin passes those same policies, which is exactly why the
-- symptom only showed up for real anonymous callers and not for staff
-- testing the same view while logged in.
--
-- Fix: public_available_cards no longer references child_card_numbers at
-- all. It joins drive_schools directly and inlines the identical
-- card-number expression child_card_numbers uses
-- (coalesce(ds.code, 'Z') || f.family_number || '.' || ch.child_index), so
-- there is no security_invoker view left anywhere in its dependency chain --
-- every base-table read this anon-facing view performs now runs as the view
-- owner, same as originally intended.
--
-- Also resolves OPEN_QUESTIONS.md SPN-1 (answered by the owner: only cards
-- from the *open* drive should be publicly listed) by joining drives and
-- filtering on status = 'open'. Without this, fixing the security_invoker
-- bug alone would have published every draft/closed/archived drive's
-- children the moment this migration ran -- next year's drive the instant a
-- volunteer starts intake, and every past year's roster forever.
--
-- SPN-2 (also answered: it's fine for the publicly-visible card number to
-- embed the school's single-letter code, as it already does on the printed
-- card) requires no change to the expression itself -- the inlined version
-- below is character-for-character what child_card_numbers already produced.
--
-- Unchanged, per the US-17 acceptance criteria: the column whitelist stays
-- exactly what it was, `not f.is_confidential` stays a literal **inner** join
-- condition (not routed through family_is_confidential() -- anon has no
-- EXECUTE on that function post-US-16, see backlog.md guardrails), and the
-- not-already-claimed `where not exists (... assignments ...)` filter is
-- unchanged. No `select *` anywhere. child_card_numbers' own
-- `security_invoker = true` setting is untouched by this migration.
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
join children ch on ch.id = crd.child_id
join families f on f.id = ch.family_id and not f.is_confidential
join drives d on d.id = f.drive_id and d.status = 'open'
left join drive_schools ds on ds.id = f.drive_school_id
left join wishlist_items wi on wi.child_id = ch.id
where not exists (
  select 1 from assignments a where a.card_id = crd.id and a.status <> 'cancelled'
);

-- `drop view` discards any previously-granted privileges on the view, so the
-- grant has to be re-issued -- a granted-but-missing view looks exactly like
-- this bug from the client's perspective. Matches 20260708120000_init.sql:432
-- exactly (anon and authenticated both had select on the old view).
grant select on public_available_cards to anon, authenticated;
