-- ADM-2: one sponsor per child — drop the multi-card-per-child mechanism.
-- Answered in docs/OPEN_QUESTIONS.md ADM-2 (2026-08-18): "there is no longer
-- a need to have more than one family sign up for one card. There will only
-- ever be one sponsor per child." This removes children.target_card_count
-- and cards.copy_number/total_copies entirely and makes "exactly one card
-- per child" a database constraint, not an app convention that could drift.
-- See SCHEMA.md §6/§7 for the full before/after.
--
-- No RPC changes: create_family() never referenced these columns (cards are
-- created by plain app-side inserts, not through an RPC) — confirmed by grep
-- across supabase/migrations/ before writing this file.

-- =============================================================================
-- Views first: both cards_needing_print and printable_cards read the columns
-- being dropped below, so they have to go before the ALTERs, not after.
-- =============================================================================

drop view if exists cards_needing_print;
drop view if exists printable_cards;

-- =============================================================================
-- children: drop the input side of the old "how many cards" mechanism.
-- =============================================================================

alter table children drop column target_card_count;

-- =============================================================================
-- cards: drop the output side (copy_number/total_copies), and replace the
-- old (child_id, copy_number) unique constraint with a straight
-- unique(child_id) — exactly one card per child, enforced by the database.
-- cards_child_id_idx (a separate, non-unique lookup index) becomes fully
-- redundant once child_id itself is unique, so it's dropped too rather than
-- left as dead weight.
-- =============================================================================

alter table cards drop constraint if exists cards_child_id_copy_number_key;
drop index if exists cards_child_id_idx;

alter table cards
  drop column copy_number,
  drop column total_copies,
  add constraint cards_child_id_key unique (child_id);

-- =============================================================================
-- Recreate the two views without the count-vs-target / copy-count logic.
-- =============================================================================

-- A child either has its one card printed or it doesn't — no more
-- generated-count-vs-target comparison, since there's nothing left to count.
create view cards_needing_print
  with (security_invoker = true) as
select
  ch.id as child_id,
  ch.first_name,
  crd.id as card_id
from children ch
join cards crd on crd.child_id = ch.id
where crd.printed_at is null;

-- display_label is just the base card number now — the "(1/2)" print-room
-- notation this view existed to add is gone along with copy_number/total_copies.
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
join children ch on ch.id = crd.child_id
join families f on f.id = ch.family_id
join child_card_numbers ccn on ccn.child_id = ch.id;

-- Dropping a view drops its grants with it — reissue for the two we recreated.
grant select on cards_needing_print, printable_cards to authenticated;
