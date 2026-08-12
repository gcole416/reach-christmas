-- Fulfillment: volunteer notes + "verified by team".
--
-- Once a sponsor's gift reaches church, the admin team checks it against the
-- child's wishlist and shops for anything a volunteer missed. These columns
-- support that: volunteers leave a note on what's short, admins clear it once
-- they've verified/topped up the gift. Both travel with the specific sponsor
-- assignment (not the card) so a cancelled + reclaimed card doesn't inherit a
-- stale note or verification from a previous sponsor.
--
-- No RLS or grant changes: "staff update assignments" (init.sql) is already
-- `using (true) with check (true)`, and the table-wide
-- `grant ... on assignments to authenticated` covers new columns
-- automatically. The generic audit_log_change() trigger uses
-- to_jsonb(old/new), so these columns are captured in the audit trail with no
-- trigger changes either.
--
-- The pre-existing, unused `assignments.notes` column is left as-is — its
-- purpose predates and is unrelated to this feature.
--
-- Confidentiality note: unlike cards/children/wishlist_items, the
-- "staff read/update assignments" policies (init.sql) carry NO
-- not-is_confidential-or-can_view_confidential() gate — every authenticated
-- staff member can read/write every assignments row, full stop. That's safe
-- today only because claim_card() (init.sql) is the ONE insert path into
-- assignments and it explicitly refuses to claim a card belonging to a
-- confidential family — so no assignments row can ever reference one. This
-- new volunteer_notes column raises the stakes of that invariant, since a
-- volunteer could type identifying detail about a child/family into it: if
-- a future change ever adds a second way to insert into assignments (e.g. a
-- "record a walk-in sponsor" flow), it MUST repeat claim_card's confidential
-- check, or a volunteer without can_view_confidential() will be able to read
-- confidential families' notes straight off this table.

alter table assignments
  add column volunteer_notes text,
  add column verified_by_team boolean not null default false,
  add column verified_at timestamptz,
  add column verified_by uuid references profiles(id);
