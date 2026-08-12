-- Turn "verified by team" into a real fulfillment-pipeline stage instead of
-- a side flag on top of it — per product feedback, staff think of this as
-- "received at church -> verified -> delivered," not a checkbox that can be
-- ticked at any point in a card's lifecycle. The admin team checks a gift
-- against the wishlist and shops for anything missing between it arriving
-- at church and it going out to the family, so that's genuinely a sequential
-- step, the same shape as purchased/received_at_church/delivered already are.
--
-- Supersedes part of 20260812100000_assignment_notes_and_verification.sql:
-- volunteer_notes AND verified_at both stay exactly as that migration added
-- them (verified_at already matches the purchased_at/received_at_church_at/
-- delivered_at pattern this stage now uses); only verified_by_team/
-- verified_by are dropped, since a boolean flag is redundant now that
-- 'verified' is a real status value, and "who" is answered by audit_log's
-- changed_by (captured automatically by the generic audit_log_change()
-- trigger), not a dedicated column.

alter type assignment_status add value if not exists 'verified' after 'received_at_church';

alter table assignments
  drop column if exists verified_by_team,
  drop column if exists verified_by;
