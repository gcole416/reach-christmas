-- Turn "verified by team" into a real fulfillment-pipeline stage instead of
-- a side flag on top of it — per product feedback, staff think of this as
-- "received at church -> verified -> delivered," not a checkbox that can be
-- ticked at any point in a card's lifecycle. The admin team checks a gift
-- against the wishlist and shops for anything missing between it arriving
-- at church and it going out to the family, so that's genuinely a sequential
-- step, the same shape as purchased/received_at_church/delivered already are.
--
-- Supersedes part of 20260812100000_assignment_notes_and_verification.sql:
-- volunteer_notes stays as-is, but verified_by_team/verified_by are dropped
-- in favor of the new 'verified' status value plus a verified_at timestamp —
-- matching the existing purchased_at/received_at_church_at/delivered_at
-- pattern exactly (no dedicated "verified_by" column, same as those: the
-- audit_log's changed_by, captured automatically by the generic
-- audit_log_change() trigger, already answers "who").

alter type assignment_status add value 'verified' after 'received_at_church';

alter table assignments
  add column verified_at timestamptz,
  drop column verified_by_team,
  drop column verified_by;
