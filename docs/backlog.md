# Reach Christmas — Backlog

Status legend: Backlog | In progress | In review | Done

Stories below marked **Done** were backfilled from the existing codebase (not
written before the feature was built) — see [AGENT-TEAM-SETUP.md](../agent_coding_help/AGENT-TEAM-SETUP.md)
for how the team audited the app to produce these. Acceptance criteria
describe exactly what the code does today, cited to file/line, so you can
hand this to your team as documentation of decisions already made.

---

## US-1: Staff sign-in

As a staff member or volunteer, I want to sign in with email and password, so
that I can access the admin dashboard.

Acceptance criteria:
- [x] `/admin/login` shows an email + password form; both fields are required (HTML `required`).
- [x] There is no public sign-up — accounts are created by an admin (page copy states this explicitly).
- [x] On submit, authenticates via Supabase Auth (`signInWithPassword`); on success, redirects to `/admin`.
- [x] On failure, shows the Supabase auth error message verbatim in a red banner (no custom copy).
- [x] The submit button reads "Signing in…" and is disabled while the request is in flight.

Status: Done
Owner: (pre-existing — see [web/app/admin/login/page.tsx](../web/app/admin/login/page.tsx))

---

## US-2: Staff dashboard stats

As a staff member, I want a top-line view of drive progress, so that I can
gauge how the drive is going at a glance.

Acceptance criteria:
- [x] Shows **Children registered** — total count of children rows for the open drive.
- [x] Shows **Cards claimed** as "`claimed` / `total`", with a hint of how many still need a sponsor. A card counts as claimed if it has an active (non-`cancelled`) assignment.
- [x] Shows **Gifts delivered** — count of assignments with status `delivered`.
- [x] Shows **Sponsors overdue** — count from the overdue-sponsors rule in US-3.
- [x] Data is scoped to the single drive with `status = 'open'`; there is currently no drive picker if more than one drive exists.

Status: Done
Owner: (pre-existing — see [web/app/admin/page.tsx:33-42](../web/app/admin/page.tsx), [web/lib/queries.ts:203-215](../web/lib/queries.ts))

---

## US-3: "Sponsors running late" report

As a staff member, I want to see which sponsors haven't followed through on a
claim, so that I can follow up with them before the drive deadline.

Acceptance criteria:
- [x] A card's assignment is **overdue** if its status is `pledged` or `purchased` (i.e. not yet `received_at_church` or `delivered`) **and** at least **10 days** have passed since `claimed_at` (`OVERDUE_WARNING_DAYS = 10`).
- [x] Overdue rows are marked **critical** severity once **21+ days** have passed (`OVERDUE_CRITICAL_DAYS = 21`); otherwise **warning** severity.
- [x] Shown as a table on the staff dashboard (`/admin`) under "Sponsors running late", one row per overdue assignment, sorted by days overdue descending (most overdue first).
- [x] Each row shows: child's first name + card number, sponsor name, sponsor email/phone, current status badge, and a days-overdue badge colored by severity.
- [x] If there are no overdue sponsors, the section shows "No overdue sponsors right now." instead of an empty table.
- [x] This is the *only* place in the app this report appears — there's no email/text notification to staff or the sponsor themselves (that's a manual follow-up staff has to initiate outside the app today).

Status: Done
Owner: (pre-existing — see [web/app/admin/page.tsx:44-86](../web/app/admin/page.tsx), [web/lib/queries.ts:104-126](../web/lib/queries.ts))

---

## US-4: "Cards to print" report

As a staff member, I want to see which physical cards still need to be
generated or printed, so that I know what to prep before an event or
school drop-off.

Acceptance criteria:
- [x] A child appears in this report if either: fewer physical card copies have been generated than their `target_card_count`, **or** at least one generated card has no `printed_at` timestamp.
- [x] Shown as a table on the staff dashboard under "Cards to print": child name + card number, target count, generated count, not-yet-printed count.
- [x] If nothing needs printing, shows "Everything is printed and up to date." instead of an empty table.
- [x] There is no "mark as printed" action in the UI yet — this report is read-only; printing/marking-printed happens outside the app today.

Status: Done
Owner: (pre-existing — see [web/app/admin/page.tsx:88-122](../web/app/admin/page.tsx), [web/lib/queries.ts:72-87](../web/lib/queries.ts))

---

## US-5: Browse and filter all families ("Families Explorer")

As a staff member or volunteer, I want to browse every referral in the drive
and filter by school and status, so that I can find a specific family or work
a specific slice (e.g. one school, or everyone still unclaimed).

Acceptance criteria:
- [x] Shows one row per **card** (not per family/child) — a child with 2 cards appears as 2 rows.
- [x] Filterable by school (a specific school, "All schools", or "Confidential / direct referral"), and by assignment status (a specific status, "unclaimed", or "All statuses").
- [x] Confidential families show a "Confidential" badge in place of the school name in this list.
- [x] Shows a live count: "`N` of `M` rows" for the current filter.
- [x] Empty filter result shows "No rows match this view." instead of an empty table.
- [x] Columns: school, family label ("Family `N`"), child first name, grade, card number, status badge, sponsor name (or "—" if unclaimed).

Status: Done
Owner: (pre-existing — see [web/app/admin/FamiliesExplorer.tsx](../web/app/admin/FamiliesExplorer.tsx))

**Note:** this screen is currently **read-only** — there is no way to create, edit, or mark-confidential a family/child/wishlist item from the app. See the intake/edit UI discovery questions below; that's intentionally not scoped as a story yet pending your user-base meeting.

---

## US-6: Saved filter views

As a staff member or volunteer, I want to save a school+status filter
combination with a name, so that I can quickly return to a view I use often
(e.g. "Lincoln overdue") without re-selecting filters every time.

Acceptance criteria:
- [x] Any current school+status filter combination can be saved under a name typed into "Save this view as…".
- [x] Saved views appear as pill buttons above the filters, alongside a permanent "All" view; clicking one applies its filters.
- [x] A saved view can be deleted via a small "×" that appears on hover.
- [x] **Saved views are stored in the browser's `localStorage`** (`reach-ol-saved-views-v1`), not in the database — they're per-device/per-browser, not shared across staff or synced across devices, and are lost if browser storage is cleared.

Status: Done
Owner: (pre-existing — see [web/lib/store.tsx:18-25,90-97,172-178](../web/lib/store.tsx))

---

## US-7: Add a partner school

As a staff member, I want to add a new partner school to the current drive,
so that families referred from that school can be entered under it.

Acceptance criteria:
- [x] "Add school" opens a modal with: school name (required), card code (required, max 3 characters, auto-uppercased), liaison name/phone/email (all optional), and a distribution method select (School drop-off / Church pickup / "Inherit drive default").
- [x] Before submitting, the form checks the card code isn't already used by another school in this drive and shows "Code "`X`" is already used by another school this drive." if so.
- [x] **That pre-check is a client-side check against already-loaded data, not a guaranteed-atomic check** — the database also enforces a `unique (drive_id, code)` constraint, but if two admins submitted the same new code at the same instant, the loser would currently see a raw Postgres error message rather than the friendly one above (flagged as a gap below, not yet fixed).
- [x] On success, the school appears immediately in the schools table (full data refresh, not optimistic UI).
- [x] Submit button reads "Adding…" and is disabled while in flight.
- [x] There is no "edit school" or "delete school" action — schools admin is add-only today.

Status: Done
Owner: (pre-existing — see [web/app/admin/schools/page.tsx](../web/app/admin/schools/page.tsx), [web/lib/store.tsx:131-170](../web/lib/store.tsx))

---

## US-8: Sponsor browses available kids

As a sponsor (public, no account), I want to browse kids who still need a
sponsor, so that I can pick one to buy gifts for.

Acceptance criteria:
- [x] `/sponsor` loads cards from the `public_available_cards` view only — already-claimed cards and cards belonging to confidential families never appear (enforced at the database view level, not just client-side filtering).
- [x] Each card shows: card number, first name, grade, pant/shirt/shoe size, wishlist items (bulleted), and specific needs (italicized) — no last name, no school, no address (matches the DESIGN.md §5 / [AGENTS.md](../AGENTS.md) privacy rule).
- [x] A search box filters cards client-side by substring match against first name, grade, and wishlist text combined.
- [x] Result count shown as "`N` of `M` still need a sponsor".
- [x] Empty states: "No children are listed yet — check back soon." (nothing loaded) vs. "No children match that search right now." (search filtered everything out).

Status: Done
Owner: (pre-existing — see [web/app/sponsor/SponsorBrowser.tsx](../web/app/sponsor/SponsorBrowser.tsx))

---

## US-9: Sponsor claims a card

As a sponsor, I want to claim a specific kid's card, so that I commit to
buying for them and staff know who's responsible.

Acceptance criteria:
- [x] "Sponsor this gift" opens a modal asking for name (required) and email (required), phone (optional).
- [x] On submit, calls the `claim_card` database function directly (not a generic table insert) with the card ID and sponsor info.
- [x] **This is already race-safe at the database level**: a partial unique index (`one_active_assignment_per_card`) guarantees only one active assignment can ever exist per card, even under simultaneous claims. If two sponsors submit for the same card at nearly the same instant, the database — not application code — decides the winner; the loser's transaction is fully rolled back (no orphaned sponsor record left behind).
- [x] The loser sees the message "This card was just claimed by someone else — please pick another." (raised by the database function).
- [x] On success: modal closes, a "Thank you for sponsoring `Name`!" confirmation banner shows, and the card list reloads (so the claimed card disappears).
- [x] Submit button reads "Claiming…" and is disabled while in flight.

Status: Done
Owner: (pre-existing — see [web/app/sponsor/SponsorBrowser.tsx:91-105,208-278](../web/app/sponsor/SponsorBrowser.tsx), `public.claim_card()` in [supabase/migrations/20260708120000_init.sql:537-587](../supabase/migrations/20260708120000_init.sql))

**Known gap (tracked separately below):** on a failed claim (e.g. the "just claimed by someone else" case), the card list does *not* reload — the sponsor sees the stale, already-claimed card still sitting in the grid and could retry it again. Fix is in progress; see the race-condition section below.

---

## US-10: Admin manages volunteer access

As an admin, I want to change a volunteer's role and confidential-family
access, so that I can grant/revoke clearance without going into the Supabase
dashboard.

Acceptance criteria:
- [x] `/admin/volunteers` lists every profile (name, role, confidential access, created date); an admin can change role (admin/volunteer) and toggle confidential access inline per row.
- [x] Changes apply optimistically and roll back with an inline error if the server rejects them.
- [x] **Enforced at the database layer, not just the UI**: a new `BEFORE UPDATE` trigger on `profiles` blocks anyone but an admin from changing `role` or `can_view_confidential` — including a volunteer calling the update directly, bypassing this page entirely. This closes a real gap found during this work: the existing RLS policy allowed a volunteer to update their own profile row, but had no column-level restriction, so a volunteer could previously have self-promoted to admin via a direct API call.
- [x] Scoped to editing existing accounts only — creating a brand-new login still happens via the Supabase dashboard (would require a server-side admin API route to do in-app; deferred, not started).

Status: Done
Owner: database-engineer (schema/RLS/data layer), frontend-designer (UI) — see [supabase/migrations/20260808130000_profiles_column_guard.sql](../supabase/migrations/20260808130000_profiles_column_guard.sql), [web/app/admin/volunteers/page.tsx](../web/app/admin/volunteers/page.tsx)

---

## US-11: Admin views the audit log

As an admin, I want to see who changed what and when, so that I can
investigate a data problem or confirm a change was made correctly.

Acceptance criteria:
- [x] `/admin/audit` shows a table of every insert/update/delete across drives, schools, drive_schools, families, children, cards, wishlist_items, sponsors, assignments, and profiles — this logging was already fully wired up at the database level before this story; this story just added a way to see it.
- [x] Each row shows: timestamp, table, action (insert/update/delete badge), who made the change (resolved to a name, or "System" for a service-role write), and a short diff summary (e.g. "Changed: firstName, grade"), with the full raw diff available behind an expandable disclosure, never inline.
- [x] Filterable by table.
- [x] Gated by the existing `is_admin()`-only RLS policy on `audit_log` — a non-admin sees an empty list, not an error or leaked data.
- [x] Deliberately fetched on-demand only when this page is opened, not as part of the app's normal data load (this table can hold PII-bearing diffs and doesn't need to be in memory for every page view).
- [x] No export/copy affordance was added, on purpose — this is a PII-bearing view.

Status: Done
Owner: database-engineer (query layer), frontend-designer (UI) — see [web/app/admin/audit/page.tsx](../web/app/admin/audit/page.tsx), `fetchAuditLog()` in [web/lib/store.tsx](../web/lib/store.tsx)

---

## US-12: Race-condition fixes

As a sponsor or admin, I want the app to behave predictably when two people
act on the same thing at nearly the same time.

Acceptance criteria:
- [x] **Two sponsors claiming the same card**: already race-safe at the database level before this story (a unique constraint guarantees one winner, atomically). Fixed in this story: on a losing/failed claim, the sponsor's card grid now refreshes so the already-claimed card disappears immediately, instead of staying visible and re-clickable.
- [x] **Duplicate/double-submit on claim**: covered by the same database constraint — a genuine double-submit on the same card is treated identically to two different sponsors racing (one wins, the loser gets a clean error, no orphaned data).
- [x] **Two admins adding a school with the same code**: the database already had a `unique (drive_id, code)` constraint; this story added friendly error handling for it, so a losing admin now sees "Code "X" was just taken by another school this drive." instead of a raw Postgres error.
- [x] **Two admins editing the same family/child record**: explicitly deferred — there is no edit UI for families/children yet (that's the intake/edit UI project, on hold pending the owner's user-base meeting). `families`/`children` already have `updated_at` columns to build a "changed since you loaded it" warning on, once that UI exists.

Status: Done (claim + schools-form pieces); the admin-edit-conflict piece is **unblocked and split out as US-13** — the intake/edit UI it was waiting on now exists
Owner: frontend-designer ([web/app/sponsor/SponsorBrowser.tsx](../web/app/sponsor/SponsorBrowser.tsx)), database-engineer ([web/lib/store.tsx](../web/lib/store.tsx) `addSchool`)

---

## US-13: Detect concurrent edits to a family/child record

As a staff member or volunteer editing a family, I want to be told when
someone else has changed that family since I opened it, so that I don't
silently overwrite their work (and they don't silently overwrite mine).

Origin: GitLab issue #2 (`reach-christmas-group/reach-christmas-project`). This
is the deferred fourth bullet of US-12, unblocked now that the family edit UI
([web/app/admin/families/[familyId]/page.tsx](../web/app/admin/families/%5BfamilyId%5D/page.tsx)) exists.

Today `saveFamilyEdit()` issues a bare `.update(...).eq("id", familyId)` with
no version check: a volunteer who loaded the form five minutes ago overwrites
everything a second volunteer saved in the meantime, with no warning to
either. The database side is already in place — `families` and `children` both
have `updated_at` with `set_updated_at` triggers
([supabase/migrations/20260708120000_init.sql:448-453](../supabase/migrations/20260708120000_init.sql)) —
so **no migration is required**. The missing piece is that `updated_at` is
never selected or mapped into the client.

Acceptance criteria:
- [ ] `updated_at` is fetched and mapped for `families` and `children` into the client data bundle.
- [ ] `saveFamilyEdit()` sends the `updated_at` it loaded and the update is rejected if the row changed since (`.eq("updated_at", loadedValue)` or a guarded RPC).
- [ ] On rejection the edit form shows a plain-language warning ("Someone else changed this family while you were editing") and does not silently discard the user's typed input.
- [ ] The user can reload fresh values and re-apply their change.
- [ ] Existing "other changes on this page may already be saved" messaging stays accurate — i.e. it appears only when writes actually did land before the conflict was detected, and not when the save was rejected before writing anything.

Out of scope (deliberate, not oversights):
- Field-level merge / showing a diff of what the other person changed. The user gets "reload theirs" or "keep mine" — not a three-way merge.
- Conflict detection on the other family write paths (`updateFamilyDistribution`, `checkInFamily`, `undoCheckInFamily`). Those are single-field, idempotent-ish actions where last-write-wins is defensible; this story is scoped to the full-record edit form.
- Any schema change. If one turns out to be genuinely required, it stops and comes back to the owner first.

Status: In progress
Owner: database-engineer (data layer), frontend-designer (edit-form UI), qa-tester (verification), code-reviewer (gate)

---

## Open questions carried over from DESIGN.md §8

These aren't new — they're the unanswered items from DESIGN.md, restated here
as concrete decisions now that we know exactly what the schema does and
doesn't support for each:

1. `drive_schools.liaison_name/phone/email` exists in the schema but is unused by any current feature — is a real school-liaison contact coming, or does it stay null indefinitely?
2. `families.sort_tag` (the legacy "Color" field) exists in the schema — what is it actually for?
3. Is the school list fixed year to year, or does it change enough to need an "inactive school" flag?
4. Who decides a family is confidential, and who can grant `can_view_confidential` to a volunteer — should that decision be logged (who/why), not just an unaudited boolean? *(Being addressed now — see the volunteer-management story being built.)*
5. Can a referral ever split siblings across schools/confidential status, or is one referral always the whole family? Schema currently hard-codes per-family.
