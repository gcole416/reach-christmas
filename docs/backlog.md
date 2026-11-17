# Reach Christmas — Backlog

Status legend: Backlog | In progress | In review | Done

Stories below marked **Done** were backfilled from the existing codebase (not
written before the feature was built) by reading the shipped code and writing
acceptance criteria to match. Those criteria describe exactly what the code
does today, cited to file/line, so you can hand this to your team as
documentation of decisions already made.

For the doc map (which file to read for what) see [START_HERE.md](../START_HERE.md);
for how the agent team itself is set up and driven, see
[AGENT-TEAM-SETUP.md](../agent_coding_help/AGENT-TEAM-SETUP.md). Anything
waiting on an owner decision lives in
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) — one page, answer inline.

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
- [x] ~~A child appears in this report if either: fewer physical card copies have been generated than their `target_card_count`, **or** at least one generated card has no `printed_at` timestamp.~~ **Superseded 2026-08-18 (ADM-2):** one card per child, always, now — `target_card_count`/`copy_number`/`total_copies` are gone from the schema entirely, so there's no generated-vs-target comparison left to make. `getCardsNeedingPrint` (`web/lib/queries.ts`) now surfaces a child if their one card has no `printed_at` timestamp, and the dashboard table (`web/app/admin/page.tsx`) has been adapted to match — Child + Card, no more target/generated/not-yet-printed counts. See [SCHEMA.md §7](../SCHEMA.md#7-cards--the-physical-claimable-gift-slot-for-a-child).
- [x] ~~Shown as a table on the staff dashboard under "Cards to print": child name + card number, target count, generated count, not-yet-printed count.~~ **Superseded 2026-08-18:** see the note above — target/generated/not-yet-printed counts no longer exist to show.
- [x] If nothing needs printing, shows "Everything is printed and up to date." instead of an empty table.
- [x] ~~There is no "mark as printed" action in the UI yet — this report is read-only.~~ **Corrected 2026-08-12:** a per-card "Mark printed / Mark not printed" toggle has since shipped on `/admin/print` ([web/app/admin/print/page.tsx:119-125](../web/app/admin/print/page.tsx), `updateCardPrinted` in [web/lib/store.tsx:819-828](../web/lib/store.tsx)). The dashboard report itself is still read-only. (Instance of the drift tracked as GitLab #5 / OPEN_QUESTIONS DOC-5.)

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
Owner: (pre-existing — see [web/app/admin/families/FamiliesExplorer.tsx](../web/app/admin/families/FamiliesExplorer.tsx))

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
- [x] `/admin/staff` lists every profile (name, role, confidential access, created date); an admin can change role (admin/volunteer) and toggle confidential access inline per row.
- [x] Changes apply optimistically and roll back with an inline error if the server rejects them.
- [x] **Enforced at the database layer, not just the UI**: a new `BEFORE UPDATE` trigger on `profiles` blocks anyone but an admin from changing `role` or `can_view_confidential` — including a volunteer calling the update directly, bypassing this page entirely. This closes a real gap found during this work: the existing RLS policy allowed a volunteer to update their own profile row, but had no column-level restriction, so a volunteer could previously have self-promoted to admin via a direct API call.
- [x] Scoped to editing existing accounts only — creating a brand-new login still happens via the Supabase dashboard (would require a server-side admin API route to do in-app; deferred, not started).

Status: Done
Owner: database-engineer (schema/RLS/data layer), frontend-designer (UI) — see [supabase/migrations/20260708130000_profiles_staff_management.sql](../supabase/migrations/20260708130000_profiles_staff_management.sql) (defines `prevent_role_self_escalation()`), [supabase/migrations/20260808130000_fix_role_escalation_guard_null_auth.sql](../supabase/migrations/20260808130000_fix_role_escalation_guard_null_auth.sql) (later fix), [web/app/admin/staff/page.tsx](../web/app/admin/staff/page.tsx)

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
- [x] `updated_at` is fetched and mapped for `families` and `children` into the client data bundle.
- [x] `saveFamilyEdit()` sends the `updated_at` it loaded and the update is rejected if the row changed since (`.eq("updated_at", loadedValue)` or a guarded RPC).
- [x] On rejection the edit form shows a plain-language warning ("Someone else changed this family while you were editing") and does not silently discard the user's typed input.
- [x] The user can reload fresh values and re-apply their change.
- [x] Existing "other changes on this page may already be saved" messaging stays accurate — i.e. it appears only when writes actually did land before the conflict was detected, and not when the save was rejected before writing anything.

**No migration was made or needed** — `families`/`children` already had `updated_at` + `set_updated_at` triggers. database-engineer ran **no SQL against any project**, dev or prod.

How it works: `saveFamilyEdit()` does a **pre-flight** re-read of `updated_at` for the family and every existing child and rejects **before writing anything** on a mismatch — that's what keeps the "may already be saved" sentence a rare case rather than the normal one. Each UPDATE additionally carries `.eq("updated_at", <the caller's baseline>)` with `.select()`, because supabase-js does *not* error on a zero-row update; the empty-array check is the actual conflict signal.

Out of scope (deliberate, not oversights):
- Field-level merge / showing a diff of what the other person changed. The user gets "reload theirs" or "keep mine" — not a three-way merge.
- Conflict detection on the other family write paths (`updateFamilyDistribution`, `checkInFamily`, `undoCheckInFamily`). Those are single-field, idempotent-ish actions where last-write-wins is defensible; this story is scoped to the full-record edit form. **Note for distribution day:** these write to `families` and fire the trigger, so a check-in during someone's open edit *will* raise a genuine "Someone else changed this family" warning. That's correct behaviour, not a bug — and a force-save only writes `sort_tag`/`internal_notes`, so `checked_in_at` survives it.
- "Save my version anyway" has no time bound — a banner left open for an hour will still overwrite changes made after the conflict the user was shown. Consistent with the no-merge decision above.
- Wishlist edits don't bump `children.updated_at`, so the wholesale delete+replace of wishlist rows is unversioned. Safe only because every UI path that edits a wishlist also writes the child row through this same function — see the warning in SCHEMA.md before building a wishlist-only editor.
- Any schema change. If one turns out to be genuinely required, it stops and comes back to the owner first.

Status: **Done** — verified live against dev 2026-08-12. The earlier "blocked on
owner" note is resolved: US-15 confirmed the dev accounts and reseeded the
database, and qa-tester ran the five committed tests against real Postgres —
**5/5 pass**, twice, including the `updated_at` microsecond-precision
round-trip through PostgREST's `.eq()` filter. code-reviewer had already passed
with no critical issues, and no SQL was run against any project by anyone.

One caveat that belongs to the test suite, not to this story: the tests only
pass deterministically with `--workers=1`. At the config's default
`fullyParallel: true`, two of the five fail because a sibling test's `afterAll`
deletes every `AutoTest`-tagged row project-wide — including the family a
slower UI test is still using. Tracked as OPEN_QUESTIONS **TST-1**; it affects
the whole suite, not this feature.

Owner: database-engineer (data layer), frontend-designer (edit-form UI), qa-tester (verification), code-reviewer (gate)

---

## US-14: Don't discard typed input when a background refresh fails

As a staff member, I want the admin page to keep what I've typed when a
background data refresh fails, so that a network blip doesn't cost me my work.

Found by qa-tester during US-13 and confirmed reproducible; deliberately
deferred rather than widening US-13's scope. Pre-existing behaviour, not a
regression from US-13.

`AdminGate.tsx`'s `if (error)` branch runs after the loading branch and swaps
the **entire page** for a bare error string whenever `error` is set — including
after a good initial load, when `data` is perfectly valid. US-13 fixed the
sibling case (`if (loading)` → `if (loading && !data)`, which was unmounting
the page on every refresh); this is the same class of bug one branch down.

Repro: open a family, type into Internal notes, cause the child write to fail
so `saveFamilyEdit` calls `refresh()`, and make that refresh fail. The page
renders only the error string; everything typed is gone.

Acceptance criteria:
- [ ] A failed refresh after a successful initial load shows the error without unmounting the page or discarding form state.
- [ ] A failed *initial* load (no `data` yet) still shows the full-page error as it does today.
- [ ] `refresh()` can tell its caller whether it succeeded, so "Reload the latest version" on the family edit form can't silently not-reload.

Status: Backlog — **fix before launch** (Grant, 2026-09-29), bundled with the
other data-safety fixes in US-48. Still present in `AdminGate.tsx` as of
2026-09-29 (`if (error)` has no `&& !data`).
Owner: unassigned

---

## US-15: Confirm dev test accounts and reseed the dev database

As the team, we want the dev Supabase project usable for automated testing, so
that stories can be verified against a real database instead of a stub.

Discovered while trying to verify US-13. This is the reason US-13 is sitting in
review rather than Done, and it blocks the *entire* existing e2e suite
(`security.spec.ts` and `ui-flows.spec.ts` fail at `signInAs` too), not just
the new tests.

Acceptance criteria:
- [ ] Both dev test accounts (`testadmin@test.account`, `testuser@test.account`) can sign in — they currently fail with `email_not_confirmed`. The stored passwords are correct; only the confirmation flag is missing. Fix in Supabase dashboard → Authentication → Users → confirm each, or turn off "Confirm email" on the dev project (`mailer_autoconfirm` is currently `false`).
- [ ] The dev database is seeded — `reset_dev_sql` then `demo_seed` (see [memory.md](../memory.md)). It is currently empty.
- [ ] `npx playwright test concurrency.spec.ts --grep "US-13"` passes, in particular the `updated_at` precision round-trip test.

Requires dashboard access — cannot be done by an agent, and explicitly must not
be worked around with the service_role key.

Status: Done
Owner: Grant (owner action) — confirmed both accounts and reseeded 2026-08-11

---

## US-16: Fix confidential-family RLS leak on children/cards/wishlist_items

As a family in the drive, I want my confidential status to actually keep my
children's records private from non-cleared volunteers, so that marking a
family confidential means what it says.

Found while verifying US-13, unrelated to it. `children`/`cards`/`wishlist_items`
gated confidentiality with a subquery back to `families` (e.g. `not exists
(select 1 from families f where f.id = family_id and f.is_confidential)`).
That subquery is itself subject to `families`' own RLS, so for a caller who
can't see a confidential family, the subquery finds nothing and the check
incorrectly passes — the family stays hidden, but its children/cards/wishlist
items leak through regardless of role. Same root cause also broke
`create_family()`'s confidential-numbering count, causing real unique-constraint
collisions for any caller who couldn't see an existing confidential family in
the same drive.

Acceptance criteria:
- [x] All six affected policies (`children`/`cards`/`wishlist_items` × read/update) replaced the raw `families` subquery with `security definer` helper functions (`family_is_confidential`, `family_created_by`, `child_family_id`) that resolve confidentiality independent of the caller's own RLS visibility.
- [x] `create_family()`'s confidential branch uses a matching helper (`next_confidential_family_number`) instead of a caller-RLS-subject read; its advisory-lock concurrency guarantee (from US-2-era `atomic_family_numbers.sql`) is untouched.
- [x] Reproduced live against dev before the fix (3 new tests in `security.spec.ts`, confirmed red), then confirmed green after the migration was applied.
- [x] Full existing e2e suite re-run afterward — no regressions from this change (2 unrelated pre-existing failures found and filed separately as US-17/US-18).
- [x] reach-reviewer's one finding (new helper functions callable as anon RPCs with no login, since Supabase's platform default privileges grant them EXECUTE regardless of migration-level grants) fixed in a follow-up migration and verified live — anon now gets a real permission-denied error, staff sessions unaffected.
- [ ] Applied to prod.

Status: In review
Owner: database-engineer — see [supabase/migrations/20260811120000_fix_confidential_rls_subquery_leak.sql](../supabase/migrations/20260811120000_fix_confidential_rls_subquery_leak.sql), [supabase/migrations/20260812090000_restrict_confidential_helper_grants.sql](../supabase/migrations/20260812090000_restrict_confidential_helper_grants.sql)

---

## US-17: Public sponsor page returns zero cards for real anonymous visitors

As a sponsor, I want to actually see and claim available kids on `/sponsor`
without an account, so that I can participate in the drive at all.

Found while regression-testing US-16, unrelated to it — `public_available_cards`
is untouched by that fix. Querying the view as a genuinely anonymous client
returns 0 rows; querying the identical view as an authenticated admin returns
15 rows (5 legitimately available cards with wishlist items).

**Root-caused 2026-08-12** — reached independently by database-engineer and
reach-reviewer, same conclusion. `public_available_cards` is correctly *not*
`security_invoker`, so its own base-table access runs as the view owner. But it
inner-joins another view, `child_card_numbers`, which **is**
`security_invoker = true`
([supabase/migrations/20260708120000_init.sql:175-176](../supabase/migrations/20260708120000_init.sql),
joined at [:232](../supabase/migrations/20260708120000_init.sql)). Postgres
applies each view's own `security_invoker` setting to its own base relations —
the outer view's setting is not inherited by an inner view. So for an anonymous
caller, the `children`/`families`/`drive_schools` reads *inside*
`child_card_numbers` are checked against `anon`, which has no grants and no
policies on those tables, and the inner join collapses the whole result to
nothing. An authenticated admin passes those same policies, which is exactly why
the symptom splits by caller. No other hypothesis explains 0-vs-15 — a view-owner
or BYPASSRLS problem would return 0 rows for *both* callers.

This is almost certainly **not dev-only**: both views were created in the very
first migration, so prod has the same bug, and `/sponsor` has likely never
worked for a real anonymous visitor there either.

Acceptance criteria:
- [x] Confirmed live first with two read-only queries (`set local role anon; select count(*) from public_available_cards;` then the same against `child_card_numbers` in isolation), so the fix targets a verified cause rather than the leading theory.
- [x] `public_available_cards` no longer depends on any `security_invoker` view: the `child_card_numbers` join is replaced by a direct `left join drive_schools` and the card number is inlined (`coalesce(ds.code,'Z') || f.family_number || '.' || ch.child_index`).
- [x] The column whitelist is unchanged, the `not f.is_confidential` predicate stays an **inner** join condition, and the not-already-claimed filter is unchanged. No `select *` anywhere in the view.
- [x] `grant select on public_available_cards to anon` is re-issued if the view is dropped rather than replaced (`drop view` discards grants — a granted-but-missing view looks exactly like this bug).
- [x] Verified as a genuinely signed-out client, not an admin session: available cards appear, a confidential family's child does not, and a claimed card does not.
- [x] `web/tests/e2e/ui-flows.spec.ts:12` (the existing, currently-red anonymous `/sponsor` test) passes.
- [x] `claim_card()`'s anonymous path smoke-tested end to end once cards are visible again — it rests on the same RLS-bypass assumption and has plausibly never run live (OPEN_QUESTIONS **SPN-4**).
- [x] SPN-1's open-drive filter (`join drives ... status = 'open'`): live-proven 2026-08-18 — a temporary `draft`-status drive/family/child/card was created in dev, confirmed invisible to an anonymous `public_available_cards` query (both by `card_id` and by a distinctive `first_name`), then deleted; the cascade delete (`drives` → `families` → `children` → `cards`) was confirmed to leave zero trace.
- [ ] Applied to prod.

**Guardrails — do not "fix" it any of these ways** (from reach-reviewer, stated
before any code is written, because several are one-liners that look right):
- **Never remove `security_invoker` from `child_card_numbers`.** It's the tempting one-line fix and it's the worst option: `authenticated` holds a direct grant on that view, so any logged-in volunteer could then read card numbers and family ids for confidential families they have no clearance for. That is US-16's leak reopened one join further out.
- **Never grant `anon` SELECT on `families`/`children`/`cards`/`wishlist_items`/`drive_schools`.** It doesn't even work (RLS with no anon policies still returns nothing) and leaves the tables one permissive policy away from a full PII dump.
- **Never add an anon RLS policy to a base table.** This is the catastrophic one — it converts "sponsors see a hand-picked column whitelist" into "sponsors see whatever the `using` clause allows, on every column, including confidential families." See OPEN_QUESTIONS **DB-2**: `anon` may already hold table-level SELECT via this project's platform defaults, in which case RLS-with-no-anon-policies is the *only* thing holding the line.
- **Never make `public_available_cards` itself `security_invoker`** — that's the previous item with extra steps.
- **Don't use `family_is_confidential()` inside the anon view** — `anon` has no EXECUTE on it post-US-16, and function ACLs are checked against the caller. Keep the literal `not f.is_confidential` inline.

**Two decisions needed from the owner before the fix is written** — see
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) **SPN-1** (should the view be limited to
the *open* drive? today it has no `drives.status` filter at all, so fixing this
would publish draft and archived drives' children to the public page) and
**SPN-2** (the card number sponsors see embeds the school's letter code).

Status: Fixed and fully verified live on dev 2026-08-18 — every acceptance criterion is met except "Applied to prod." Confirmed live against dev: anon caller now gets real rows (was 0, now 15, matching the authenticated-admin count); a confidential family's card and an already-claimed card are both confirmed excluded from the anon result set; a temporary non-open (`draft`) drive's card was confirmed excluded too, then cleanly deleted with no trace, proving the open-drive filter (SPN-1) for real rather than by code inspection alone; `web/tests/e2e/ui-flows.spec.ts:12` (the anonymous `/sponsor` claim/cancel flow) is green for the first time ever; `claim_card()`'s anonymous path (SPN-4) confirmed working live via both the e2e suite and a direct no-auth-header REST call. reach-reviewer's gate passed with no issues on the anon-boundary migration itself (a separate, unrelated finding on the companion ADM-1 migration was fixed the same day — see that migration's header comment).
Owner: database-engineer (fix — done), reach-reviewer (mandatory gate — done, no issues), qa-tester (anon-context verification — done)

---

## US-18: Confidential-redaction e2e test times out despite correct rendering

As the team, we want e2e coverage of confidential-name redaction to actually
run, so regressions there get caught automatically.

Found while regression-testing US-16, unrelated to it. The "confidential name
redaction" test in `ui-flows.spec.ts` times out waiting for a locator that,
per the saved page snapshot at failure time, is present and the page is
rendering correctly (redaction itself works — "Z." shown to the volunteer,
full name to the admin). Ruled out: flakiness (fails identically on repeat),
timeout length (still fails at 60s), and stale dev-server state (still fails
after a clean restart).

**Root-caused 2026-08-12** — reached independently by both qa-tester passes,
with a DOM dump confirming it. This is a **test bug, not a redaction bug**.
`FamiliesExplorer.tsx:118-134` wraps the `<select>` *inside* its `<label>`,
along with all six `<option>` elements. A `<label>` wrapping a form control
derives its accessible name from **all** descendant text, so the control's name
computes as:

```
"SchoolAll schoolsDemo ElementaryDemo Middle SchoolDemo High SchoolDirect referral (no school)Confidential"
```

The test uses an *anchored* regex, `getByLabel(/^school$/i)`, which therefore
matches **zero** elements — not two, which would throw a strict-mode violation
immediately. Playwright's auto-waiting locator just polls silently until the
test times out. That is exactly the reported symptom: the element is genuinely
present and visible in the snapshot; its computed *name* simply never equals the
anchored pattern. Corroborated by the intake form's analogous
`getByLabel(/referral source/i)` (unanchored) passing in the same run, and by
`getByRole("combobox", { name: /^school$/i })` finding the element in one call.

Acceptance criteria:
- [ ] The two anchored locators at `ui-flows.spec.ts:68` and `:79` are changed to something accessible-name-aware (`getByRole("combobox", { name: ... })`) or de-anchored.
- [ ] The confidential-redaction test passes against dev, and still genuinely asserts redaction (shows "Z." to a volunteer, full name to an admin) rather than being weakened to pass.
- [ ] The same anchored-`getByLabel`-against-a-`<select>` pattern is checked for elsewhere in the suite (these two are currently the only instances).

Open question for the owner — **TST-4** in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md):
fix the test only, or also clean up the underlying markup? The same DOM pattern
means a screen reader today announces "School All schools Demo Elementary Demo
Middle School…" for that filter, which is a real if minor accessibility rough
edge independent of the test.

Status: Backlog — root-caused and scoped, ready to pick up (2-line fix)
Owner: qa-tester (test fix); frontend-designer only if TST-4 is answered "also fix the markup"

---

## US-19: Admin verification stage + shopping list for fulfillment

As an admin, I want to check a gift against the child's wishlist once it
reaches church and shop locally for anything a volunteer missed, so that
every kid actually gets what they asked for before their gift goes out.

Requested directly by the owner (not a GitLab issue). Two things were needed:
a way for staff to flag what's short on a card, and a way for the admin team
to see all of those flags in one place to go shopping against. First pass put
"verified" as a boolean checkbox alongside the existing pledged/purchased/
received-at-church/delivered status; the owner's feedback (after trying it
live) was that staff think of this as a genuine pipeline stage, not a
side flag, so it was reworked into a real `assignment_status` value.

Acceptance criteria:
- [x] `assignment_status` gets a new `verified` value between `received_at_church` and `delivered`; `assignments.verified_at` is stamped the same way `purchased_at`/`received_at_church_at`/`delivered_at` already are. No dedicated "verified by" column — `audit_log.changed_by` on that status-change row already answers who, matching every other stage transition.
- [x] The fulfillment board (`/admin/fulfillment`) shows "Verified" as its own column; advancing into it uses the same "Mark [next status]" button as every other stage, not a separate control.
- [x] Volunteers can attach a free-text note (`assignments.volunteer_notes`) to a card once — and only once — it reaches "Received at church"; the add/edit control isn't offered before that, since there's nothing to check against the wishlist yet. Notes stay editable through "Verified"; once "Delivered" they're still shown but read-only.
- [x] New `/admin/shopping-list` page consolidates every card sitting at "Received at church" with a non-empty note — what the admin team still needs to check/buy for. Marking a row verified there advances that assignment's status directly, dropping it off the shopping list.
- [x] Confirmed sponsors have no path to volunteer notes: `public_available_cards` (the only anon-facing view) excludes any card with an active assignment entirely, and the claim flow never reads assignment data back — no code change was needed to satisfy this, just verification.
- [x] Manually verified end-to-end by the owner against the dev project: claim → advance to received at church → add a note → note appears on the shopping list → mark verified (from either page) → drops off the shopping list and shows as the new stage on the fulfillment board.
- [x] `reach-reviewer` pass on the schema/RLS approach — one low-severity note (documented, not a bug): `assignments` has no RLS confidentiality gate of its own, relying entirely on `claim_card()` being the sole insert path and refusing confidential cards. `volunteer_notes` raises the stakes of that invariant (a volunteer could type identifying detail into it); documented explicitly in the migration and in `getShoppingList`'s comments so a future second insert path into `assignments` doesn't silently break it.
- [ ] Applied to prod (dev-only so far, by design — owner wanted to try it live before shipping to the real drive's data).

Status: In review
Owner: built this session (schema, data layer, and UI) — see [supabase/migrations/20260812100000_assignment_notes_and_verification.sql](../supabase/migrations/20260812100000_assignment_notes_and_verification.sql), [supabase/migrations/20260812110000_verified_pipeline_stage.sql](../supabase/migrations/20260812110000_verified_pipeline_stage.sql), [web/lib/queries.ts](../web/lib/queries.ts), [web/app/admin/fulfillment/page.tsx](../web/app/admin/fulfillment/page.tsx), [web/app/admin/shopping-list/page.tsx](../web/app/admin/shopping-list/page.tsx)

---

# Epic: Counselor-vetted intake forms — Phase 1 (US-20 … US-24)

Decided in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) **ADM-18** (2026-08-30);
designed in [INTAKE_FORMS.md](INTAKE_FORMS.md) (system) and
[INTAKE_FORM_DRAFT.md](INTAKE_FORM_DRAFT.md) (the questionnaire itself).

**Phase 1 = the 2026-09-09 walkthrough demo.** English only, one school, one
hand-authored form definition, a manually-seeded link and review token. The
whole point is that the lifecycle is *clickable end to end*:

```
staff has a form link → family submits (no login) → counselor opens their
roster link (no login), fixes a name typo, approves → staff clicks Import →
the family + children appear in the normal admin family list
```

**Explicitly Phase 2 (target 2026-10-01), not in these stories:** Spanish
translation and the translation round-trip ([INTAKE_FORMS.md §4](INTAKE_FORMS.md#4-spanish--the-translation-round-trip)),
digest/notification email and deliverability testing ([§11](INTAKE_FORMS.md#11-operational-risks)),
duplicate hints in the import queue, the `needs_followup` report, and any
polished staff UI for creating/copying/revoking links.

**Not blocking Phase 1:** **ADM-19** (whether high-school-age kids are
collected at all) — use elementary/middle test data in the demo and leave the
grade list as-is. The per-child budget figure in INTAKE_FORM_DRAFT.md §2.8 help
text is a **placeholder ($50) pending Grant's confirmation**, flagged in the
form definition, not a blocker.

---

## US-20: Intake form data model, RLS, and server functions

As the team, we want the intake-form tables, policies, and server functions in
place, so that a family, a counselor, and staff can each do exactly their own
step through a `security definer` function and nothing more.

Schema is [INTAKE_FORMS.md §5](INTAKE_FORMS.md#5-schema-additions), functions
are [§6](INTAKE_FORMS.md#6-server-functions), RLS is
[§9](INTAKE_FORMS.md#9-row-level-security). Everything anonymous or
token-bearing goes through functions — **no new table is reachable by `anon`**.

Acceptance criteria:
- [x] One additive migration creates the two enums (`submission_status`, `submission_channel`) and the six tables (`forms`, `form_versions`, `form_links`, `form_submissions`, `review_tokens`, `submission_events`) per §5.1–§5.6, with the indexes listed there.
- [x] The `families` / `children` / `wishlist_items` column additions from §5.7 are applied, including `source_submission_id` on both `families` and `children` (nullable on `children` on purpose — it's what distinguishes a form kid from a hand-entered one), the guardian contact columns, `preferred_language`, `consent_given_at`, `needs_followup`/`followup_note`, and the `*_source` columns.
- [x] `families.can_reach_church_pickup text` is added too (INTAKE_FORM_DRAFT.md §3.1 — the one field the draft flags as "not yet proposed anywhere"; cheap now, impossible to backfill in December).
- [x] A trigger rejects `update` of `form_versions.definition` once `published_at` is set (§5.2 — schema alone can't express it).
- [x] **`answers` stays byte-for-byte what the family submitted.** Counselor typo-fixes land in a separate `form_submissions.corrections jsonb` column and are overlaid at import — this is a deliberate reconciliation of §5.4 ("never modified") with §3's scoped-correction decision, and it keeps the provenance record honest. Documented in the migration header.
- [x] RLS is enabled on all six new tables, with policies per §9: volunteers read non-confidential submissions in their drive; admins read/write; `anon` has **no** policy and no table grant on any of them (`revoke all ... from anon, authenticated` where the platform default would otherwise grant it — see **DB-2**).
- [x] **Confidential-channel submissions (`drive_school_id is null`) are gated with the existing `can_view_confidential()` helper, never a hand-written `role = 'admin'` check** ([§8](INTAKE_FORMS.md#8-confidential-channel)). Volunteers without clearance get zero rows, not an error.
- [x] `review_tokens.token_hash` is a hash, never a plaintext token, hashed with **schema-qualified** pgcrypto (`extensions.crypt`/`extensions.digest`) — the exact bug fixed in [20260818170000_fix_pgcrypto_schema_qualification.sql](../supabase/migrations/20260818170000_fix_pgcrypto_schema_qualification.sql). No function ever returns a token or a hash.
- [x] `get_form(token)` returns the pinned version's definition plus the school's display name and nothing else — no counselor contact, no drive internals, no prior submissions, no family or child data of any kind. Returns a clean "this link isn't active" error for revoked / expired / not-yet-open / over-`max_submissions` links.
- [x] `submit_form(token, answers, contact)` validates **server-side against the pinned `form_versions.definition`** (required fields, at least one child, age 0–19, grade in the allowed list, 1–3 wishlist items with the first required) — client validation is a convenience, not the control. It increments `submission_count`, writes a `submitted` row in `submission_events`, and auto-verifies `counselor`/`staff` channel links.
- [x] `submit_form` accepts a **honeypot** field: when non-empty, the call returns the same success shape a real submission gets, but no `form_submissions` row is written and `submission_count` is not incremented.
- [x] `get_review_roster(review_token)` returns the whole season's submissions **for that token's school only**, and only `first_name` / `age` / `grade` per child plus submission status and date. It never returns wishlist items, sizes, specific needs, other notes, guardian name/phone/email, or any confidential-channel submission. It stamps `first_viewed_at` on first read.
- [x] `verify_submission(review_token, submission_id, verifier_name, corrections)` sets `verified`, stamps `verified_at` / `verified_by_label` / `verified_via_review_token`, and writes a `verified` event. `corrections` is optional and accepts **only** `first_name`, `age`, `grade`, keyed per child — any other key **raises an error** rather than being silently dropped, so a client bug can't quietly widen what a counselor can write.
- [x] `reject_submission(review_token, submission_id, reason)` sets `rejected` (or `duplicate`), records the reason, and writes an event.
- [x] `import_submission(id)` is **admin-gated** (`is_admin()`, plus `can_view_confidential()` for a confidential-channel submission) and creates `families` + `children` + `cards` + `wishlist_items` from `answers` with `corrections` overlaid, sets `source_submission_id` on the family and every child, copies the family's own words into the `*_source` columns, and stamps `imported` / `imported_at` / `imported_by` / `imported_family_id`.
- [x] **`import_submission` is idempotent.** A second call (double-click, retry, two admins at once) returns the already-created family and creates nothing new — proven with a real concurrent/repeat call, not by reading the code. It reuses `create_family()`'s advisory-lock numbering rather than inventing a second family-numbering path.
- [x] Every new function is `security definer` with an explicit `search_path`, has `execute` **revoked from `public`**, and is then granted deliberately: `get_form`/`submit_form`/`get_review_roster`/`verify_submission`/`reject_submission` to `anon` + `authenticated`; `import_submission` to `authenticated` only.
- [x] A dev-only seed file creates the demo drive-school form, one published `form_versions` row holding the hand-authored English definition from INTAKE_FORM_DRAFT.md, one `form_links` row with a known token, and one `review_tokens` row whose plaintext is documented in the seed file. Synthetic data only, tagged like the rest of the demo seed. **Never run against prod.**
- [x] Applied to the **dev** project only, and the migration's apply-target is stated explicitly when the story is reported. Prod is untouched (no Software Acceptance Review yet).

Status: **Done** — applied to **dev** (`thvyntrxmahygesltgft`) by Grant on 2026-08-31, plus the follow-up `20260901120000` on 2026-09-01. **Prod untouched** — no Software Acceptance Review has happened, and the main migration's header now says so explicitly. Verified live by qa-tester: 17 of the 26 VERIFY checks driven from real sessions (including 13 and 21, which had to run as a signed-in volunteer because the SQL editor runs as `postgres` and bypasses RLS entirely, so run there they'd prove nothing), all five of reach-reviewer's runtime-only items discharged, 50 intake tests green. Final reach-reviewer gate: *"demo on 2026-09-09: yes, ship it."*

**Every migration in this story was written without any SQL being executed by an agent** — there is no psql, DB password, or migration runner in the agent environment, only the anon key. Grant pasted each file. Stated here because the review gate requires it on the record.

Audit history — reach-reviewer's first pass came back "safe to apply to dev as-is" with one High, two contract defects, five Mediums and four Lows. **All of High/contract/Medium are fixed in place** (the file has never run anywhere, so there was no deployed state to preserve and no follow-up migration was needed); L2/L3/L4 are documented in-code, and L1 is fixed by writing `ip_hash` as `null`.

**Not yet applied to any database.** database-engineer executed **no SQL against any project** (dev or prod), in either round — there is no psql, DB password, or migration runner in the agent environment, only the anon key. Applying is a one-paste step for Grant in the **dev** SQL Editor (`thvyntrxmahygesltgft` — confirm the tab, since `.env.local` points at prod). The migration ends with a commented `-- VERIFY (run after applying, dev only):` block, now 25 read-only checks.

What the audit round changed, for the record:
- **H1 (High), fixed:** `intake_validate_field` only inspected an "Other" size field inside the branch where the select *equalled* Other — so `{"shirt_size":"Youth M","shirt_size_other":"<99KB>"}` validated clean, and `import_submission` wrote it to `children.shirt_size` untruncated, which `public_available_cards` publishes to **anon** and the printed card. Validator now checks the `_other` field whenever it's present and rejects it beside a non-Other select; every text column written at import is `left(...)`-truncated rather than relying on one JSON blob happening to set `max_length`.
- **H1 turned out to be a class, not an instance.** Hunting for the same shape found three more: a non-string `text_list` element skipped validation and landed as raw JSON text in `wishlist_items.description` (also sponsor-visible), and `verify_submission` + `intake_apply_corrections` hard-coded the `children` section id in ways the audit hadn't named.
- **Contract:** `import_submission(p_submission_id uuid, p_is_confidential boolean default null)` — staff can now set confidential tier *in the import click*. Without it, the only path was import-then-edit, which briefly exposes a child's name in a row every volunteer can read. `get_form` no longer reports `revoked` (a revoked link reports `not_found`, matching `submit_form`; `"revoked"` removed from the TS union).
- **M1–M5, fixed:** unique index `families_one_per_submission` + `unique_violation` handling, so a hand-reset status can't double-import; `form_links` channel-gated on **read and write** (an `UPDATE ... RETURNING token` walked around a SELECT-only gate); bcrypt format check on `review_tokens.token_hash`; audit triggers on `form_links`/`review_tokens`; repeating-section id resolved from the definition everywhere.

**Second round (2026-08-31), from building the counselor roster rather than reading the spec.** `get_review_roster` returned no field rules, so US-22's edit controls restated them in JSX — and diverged. `correction_fields` now carries the three correctable field definitions (`first_name`/`age`/`grade`: label, type, required, max_length, min, max, options) straight from the pinned `form_versions.definition`, resolved dynamically and merged strictest-wins across mixed versions. This closed one **live** bug: the roster's name input allowed 120 characters while the definition caps at 80, so an 81–120 character correction passed the browser and then raised server-side, throwing away the counselor's entire approve click. The per-child projection is untouched and still whitelisted to first name / age / grade, with two VERIFY checks standing guard over it (including one asserting no submitted name appears anywhere in the field-definition blob). Same class of bug found four times total across US-20/US-22 — three closed, the fourth (`SubmissionDetail`'s hard-coded labels) deferred as **ADM-22** because Phase 1 ships one form version and it degrades gracefully.
Owner: database-engineer (migration + `web/lib` data layer), reach-reviewer (mandatory gate) — see [supabase/migrations/20260830120000_intake_forms.sql](../supabase/migrations/20260830120000_intake_forms.sql), [supabase/intake_demo_seed.sql](../supabase/intake_demo_seed.sql), [web/lib/intake.ts](../web/lib/intake.ts)

---

## US-21: Public family intake form

As a parent or guardian, I want to fill out one short form on my phone for my
children, so that I can register them for the drive without an account and
without retyping anything for a volunteer.

The questionnaire is [INTAKE_FORM_DRAFT.md](INTAKE_FORM_DRAFT.md) — English
only for Phase 1.

Acceptance criteria:
- [x] `/form/[token]` renders the form from `get_form(token)` — the definition drives the fields; the page does not hard-code the questionnaire.
- [x] Section 1 collects guardian name (required), phone (required), email (optional), and preferred contact language. **No address field exists anywhere on the form**, per DESIGN §5.
- [x] Section 2 is a repeating child block with "Add another child" / remove, collecting first name, age, grade, boy/girl/prefer-not-to-say, the three sizes as selects with an "Other (describe)" escape hatch, up to 3 wishlist ideas (first required), specific needs, and other notes. At least one child is required.
- [x] Section 3 collects the church-pickup transport answer and a required consent checkbox.
- [x] There is **no school question** — the link already knows the school, and the page shows that school's name back to the family for reassurance.
- [x] A hidden honeypot field is present and is submitted to `submit_form`; a bot that fills it gets the same confirmation screen a real family does.
- [x] Submit calls `submit_form` only — never a table insert — and shows a plain-language confirmation ("Your registration is with your school counselor now") with no submission ID, no PII echoed, and no way to view or edit the submission afterwards.
- [x] Server-side validation errors surface as readable field-level messages, not a raw Postgres error string.
- [x] Mobile-first: usable one-handed at 360px with no horizontal scroll; labels are real `<label for>` associations (and **not** the wrapping-label pattern that broke the tests in US-18).
- [x] An inactive/expired/revoked/unknown token shows a friendly "this link isn't open" page, not an error dump or a blank screen.
- [x] The per-child budget line uses the **$50 placeholder** and is written so one string change updates it once Grant confirms the real figure.

Status: **Done** — 2026-09-01. Verified live against dev by qa-tester (50 intake tests green, full suite 70 passed / 1 failed / 1 skipped, the single failure being the pre-existing unrelated Defect 2). reach-reviewer's final gate: *"demo on 2026-09-09: yes, ship it."*
Owner: frontend-designer

---

## US-22: Counselor review roster

As a school counselor, I want to open one link and confirm the families from my
school that have registered, so that Reach knows these are real kids I referred
without me needing an account or a password.

[INTAKE_FORMS.md §3](INTAKE_FORMS.md#3-verification--what-the-counselor-is-actually-doing).
The counselor is doing a **plausibility check on family composition** — not a
data-quality audit, and not a review of what anyone asked for.

Acceptance criteria:
- [x] `/review/[token]` loads with no login, from `get_review_roster(token)` only.
- [x] Shows a season-long roster for that counselor's school: one card/row per submission, with its **submitted date** and status, and a compact child table of **first name, age, grade — nothing else**. **Clarified 2026-08-31:** the original wording said "the guardian's submitted date", which was read as possibly meaning the guardian's *name*. It means the date. Guardian name/phone/email stay out of `get_review_roster` entirely — INTAKE_FORMS §3 scopes this screen to family composition, and adding guardian identity would widen what a forwarded or leaked review link exposes from "a season of children's first names" to "children's names plus who their parent is." Whether first names alone are enough for a counselor to recognize a family goes to the counselor conversation INTAKE_FORMS §12 already requires — see **ADM-21**.
- [x] The three editable controls take their rules from the pinned form definition (`correctionFields`), not from constants in the page — grade is a real `<select>` over the definition's options, age is bounded by its `min`/`max`, and first name is capped at its `max_length`. A field the definition doesn't define renders read-only, never as a free-text box.
- [x] Wishlist items, sizes, specific needs, other notes, and guardian phone/email are **not rendered anywhere on this page and are not present in the network response** (verified in the response payload, not just the DOM).
- [x] Approve asks for the counselor's typed name and calls `verify_submission`; the row moves to Verified in place.
- [x] Reject asks for a short reason and calls `reject_submission`.
- [x] A pending submission allows inline editing of **exactly** first name, age, and grade per child, sent as the `corrections` payload on approve. No other field is editable, and the edit affordance disappears once the submission is verified.
- [x] Already-verified, rejected, and imported submissions are visible read-only with their status, so the counselor can see who has come in at a glance.
- [x] Expired, revoked, or unknown token shows a "this link is no longer active — ask Reach for a new one" page, never a partial roster.
- [x] Works on a phone (a counselor checking between classes) and prints/reads cleanly on a laptop.

Status: **Done** — 2026-09-01. Verified live against dev by qa-tester (50 intake tests green, full suite 70 passed / 1 failed / 1 skipped, the single failure being the pre-existing unrelated Defect 2). reach-reviewer's final gate: *"demo on 2026-09-09: yes, ship it."*
Owner: frontend-designer

---

## US-23: Staff submission queue and one-click Import

As a staff member, I want to see every counselor-verified submission and import
it with one click, so that a family becomes a real record in the drive without
anyone retyping it.

Staff-gated, but per ADM-18 a **rubber stamp, not a review** — no data-fixing or
duplicate-resolving is expected on this screen in Phase 1.

Acceptance criteria:
- [x] `/admin/submissions` lists submissions for the open drive grouped by status, with school, submitted date, guardian name, and child count. **Amended 2026-08-30** (frontend-designer's call, accepted): the actionable group — Verified / ready to import — comes **first**, ahead of Waiting on counselor, then Imported, then Rejected. The original criterion listed them in lifecycle order; a queue should lead with the thing the reader can act on.
- [x] Opening one shows the full submitted detail (this is staff, so wishlist/sizes/needs are visible here) with any counselor correction shown as a correction, not silently merged into the display.
- [x] A single **Import** button on a verified submission calls `import_submission` and nothing else; it is disabled while in flight and after success.
- [x] Double-clicking Import, or two admins importing the same submission, results in **one** family — the UI shows the same "already imported" result rather than an error or a second row.
- [x] After import the row moves to Imported and links straight to the new family in the Families Explorer, where it appears exactly like any hand-entered family (with `source_submission_id` set).
- [x] Import is offered only on `verified` submissions; a submission still awaiting the counselor shows why it can't be imported yet.
- [x] A volunteer without confidential clearance never sees a confidential-channel submission on this screen — because the query returns nothing, not because the UI hides it.
- [x] The staff-visible **form link for the demo school is displayed somewhere copyable** (the manual-fallback requirement in [§11](INTAKE_FORMS.md#11-operational-risks)) — a plain read-only panel is enough for Phase 1. **Amended 2026-08-30:** the *review* link deliberately cannot be shown here — review tokens are bcrypt-hashed and shown once at issue time ([§2](INTAKE_FORMS.md#2-the-link-model)), so the panel says so and points at the issue-time output instead of pretending to have it. Re-issuing a review link is Phase 2's link-management screen.
- [x] Reachable from the admin nav.

Status: **Done** — 2026-09-01. Verified live against dev by qa-tester (50 intake tests green, full suite 70 passed / 1 failed / 1 skipped, the single failure being the pre-existing unrelated Defect 2). reach-reviewer's final gate: *"demo on 2026-09-09: yes, ship it."*
Owner: frontend-designer

---

## US-24: End-to-end test for the intake walkthrough

As the team, we want the whole family → counselor → staff chain covered by a
test, so that the 9/9 demo can't be broken silently between now and then.

Acceptance criteria:
- [x] One spec walks the full happy path: anonymous submit at `/form/[token]` → submission appears on `/review/[token]` → counselor corrects one child's name and approves → admin sees it as verified at `/admin/submissions` → Import → family and children exist with `source_submission_id` set and the correction applied.
- [x] A rejection path test: counselor rejects, and the submission is never importable.
- [x] A honeypot test: a filled honeypot returns success to the caller but creates no `form_submissions` row.
- [x] An idempotency test: `import_submission` called twice for the same submission yields exactly one family.
- [x] A privacy test: the `get_review_roster` response payload contains no wishlist/sizes/needs/notes/guardian-contact values, asserted against the response body.
- [x] A confidentiality test: a confidential-channel submission is invisible to an uncleared volunteer session.
- [x] All test data is synthetic and cleaned up; no real PII, and the suite still passes serially per **TST-1**. **Amended 2026-09-01:** the original wording said "by the existing `is_autotest_data` mechanism", which turned out to be impossible for this feature and is now satisfied a different way. `import_submission` deliberately does *not* set `is_autotest_data` (so an e2e run can't delete a family imported during a stakeholder demo), so the existing sweep never reaches imported families. Worse, `families.source_submission_id` and `form_submissions.imported_family_id` reference each other with no `ON DELETE`, so deleting either side first fails — imported test families would have silently accumulated on dev in front of the demo. Cleanup now nulls `imported_family_id` first, sweeps via `source_submission_id` joined back to the test's own link, and **verifies the sweep emptied**, throwing if not.

Status: **Done** — 2026-09-01. Verified live against dev by qa-tester (50 intake tests green, full suite 70 passed / 1 failed / 1 skipped, the single failure being the pre-existing unrelated Defect 2). reach-reviewer's final gate: *"demo on 2026-09-09: yes, ship it."*
Owner: qa-tester

---

## US-26: Make "counselor-vetted" a checkable claim, not just a workflow convention

As a staff member looking at an imported family, I want to know whether a
counselor actually attested to it or whether staff marked it verified
themselves, so that the feature's central claim can be audited after the fact.

Found by reach-reviewer in the final Phase 1 pass. **Must land before the 10/1
counselor launch** — not a Phase 1 blocker, and not a new security hole.

An admin can set `status = 'verified'` directly (RLS allows it — and that path is
*required* for the confidential channel, which has no counselor link by design),
then click Import. Afterwards nothing distinguishes that family from a
counselor-vetted one: `form_submissions` deliberately carries no audit trigger
(the generic one would copy the `answers` PII blob into a table §10's purge never
reaches), `submission_events` rows are written only by the definer functions, and
`verified_by_label` is a hand-typed string. The one column that *does* tell them
apart, `verified_via_review_token`, is selected by neither staff read, so
`SubmissionDetail` renders "Confirmed {date} by {label}" identically either way.

The gap is **attribution, not authorization** — an admin can already create a
family by hand. But the entire premise of this feature is that a counselor
vouched for each family, and right now that claim can't be checked after import.

Acceptance criteria:
- [ ] `verified_via_review_token` is selected by both staff reads in `web/lib/intake.ts`.
- [ ] The staff submission detail distinguishes "Confirmed by counselor" from "Confirmed by staff (no counselor link)" — visibly, not in a tooltip.
- [ ] `import_submission`'s `imported` event detail records `via_review_token`, so the event trail answers it too and not just the UI.
- [ ] The confidential channel still works — staff verifying a confidential submission themselves is legitimate and must not be presented as an error or an anomaly.

Status: Backlog — ~~must land before 2026-10-01~~ **gap accepted for the 2026
season** (Grant, 2026-09-29). Import works; the audit trail just can't tell a
counselor's confirmation from a staff one. Revisit after the season.
Owner: unassigned (database-engineer for the select + event detail, frontend-designer for the display)

---

## US-25: Merge the intake schema into SCHEMA.md

As an agent or developer about to change the database, I want SCHEMA.md to
describe the whole schema, so that I don't design against a version of it that's
missing a third of the tables.

Doc drift with teeth, not tidiness. [START_HERE.md](../START_HERE.md) routes
*every* schema/RLS/migration task to SCHEMA.md and explicitly tells the reader
not to bother re-reading DESIGN.md — so a file that silently omits six live
tables is a trap, not just an omission. The next agent to design a feature
touching `families`/`children` would be told those tables and columns don't
exist. A warning banner now points at INTAKE_FORMS.md §5/§6/§9 as the interim
authority, which closes the immediate danger but not the underlying drift.

Deliberately **not** blocked on for the 9/9 demo — it's a docs task, and
INTAKE_FORMS.md already documents all of it accurately.

Acceptance criteria:
- [x] The six tables (`forms`, `form_versions`, `form_links`, `form_submissions`, `review_tokens`, `submission_events`) are documented in SCHEMA.md §12 in the same style as the existing eleven, including the `review_tokens_hash_is_bcrypt` constraint and why review tokens are hashed while form-link tokens are plaintext.
- [x] The new enums (`submission_status`, `submission_channel`, plus `shop_day_status` from the high-schooler work) and the new columns on `families`/`children`/`wishlist_items` are folded into those tables' existing DDL blocks (§5, §6, §8), not an appendix. `families_one_per_submission` documented in §5.
- [x] All the intake functions covered in §12.2 as a table (caller + grant + what it does), plus the internal-helper list and which are `security definer`. `issue_review_token` (US-28) included.
- [x] The RLS "who sees what" table gains five rows for the intake tables, with the `drive_school_id is not null or can_view_confidential()` gate spelled out and the US-28 `review_tokens` plaintext/admin-read change noted.
- [x] Warning banner removed; replaced with a short migration-ledger pointer. INTAKE_FORMS.md status line updated to "BUILT (Phase 1), merged into SCHEMA.md §12".
- [x] Draft disclaimer corrected to "LIVE" with the dev/prod split stated.
- [x] Also folded in (beyond the original scope, since the schema moved on): the high-schooler feature (`20260908130000` — §6.1, view changes in §7/§9), `20260903120000` (`review_tokens.token` + `issue_review_token`), and corrected the stale SPN-3 "not yet applied to any live database" note.

Status: **Done** — 2026-09-09. Docs-only, no code/DB change. SCHEMA.md is now
current with dev. Resolves DB-23 and ADM-19 in the "Open schema questions"
section too.
Owner: (this session)

---

## US-27: Staff-managed registration links

As a staff member, I want to create, view, and revoke registration links from
the app — grouped by school — so that standing up a link for a new school
doesn't mean hand-writing an `INSERT` in the SQL editor.

Pulls forward the "polished staff UI for creating/copying/revoking links" that
the US-20…US-24 epic intro parks in Phase 2. Prompted by a real gap: a school
added through Admin → Schools had no link and no way to get one, and the
existing panel is display-only so it showed nothing at all for that school
rather than "no link yet."

Acceptance criteria:
- [x] The "Registration links" panel on `/admin/submissions` lists links **grouped by school**, and shows every school in the drive — including ones with no link yet, as an explicit "No registration link yet" row with a create affordance.
- [x] "New registration link" / per-school "New link" opens an inline form: school, questionnaire picker (shown only when the drive has more than one published version), optional label, optional opens date, **required** expiry date (prefilled from the drive's referral-window end — "expires_at always set" is a Phase 1 spam control, INTAKE_FORMS §11), optional max submissions. Submitting calls a `createFormLink` wrapper in `web/lib/intake.ts` — a direct RLS-gated `form_links` insert, **no migration**, token generated client-side with 32 bytes of entropy.
- [x] **The questionnaire is auto-published on first use.** A drive with no `forms`/`form_versions` row needs no SQL step: `createFormLink` calls `ensureDriveFormVersion`, which publishes the canonical Phase 1 definition (`web/lib/intakeFormDefinition.ts` — byte-identical to `intake_demo_seed.sql` / `publish_intake_form.sql`, sharing `import_submission`'s hard-coded field contract). Admin-only (RLS `is_admin()` on `forms`/`form_versions` insert), idempotent, concurrency-safe.
- [x] Links are only ever created with `channel = 'family'` and a non-null `drive_school_id`. Counselor/staff-channel links (ADM-20) and the confidential channel stay out of this UI.
- [x] Each live link has a **Revoke** button (confirm dialog); `revokeFormLink` sets `revoked_at` idempotently, and a revoked link then reads as Revoked in place. A family opening a revoked link gets the same "ask your counselor for a current link" page a bad token gets — unchanged `get_form`/`submit_form` behaviour.
- [x] A volunteer cannot create or revoke a link — enforced by the existing `is_admin()` RLS policies on `form_links`, covered by a test that asserts the volunteer insert is refused.
- [x] e2e (`web/tests/e2e/intake-link-management.spec.ts`, seed-independent): an admin creates a school link through the page — which auto-publishes the questionnaire — an anon `get_form` confirms it resolves with the right school name, the admin revokes it, and `get_form` then reports it dead; plus a volunteer-cannot-insert RLS probe. Verified green against the live dev DB.
- [x] `supabase/publish_intake_form.sql` retained as the manual equivalent of the auto-publish, for pre-provisioning a drive / prod / re-publishing a v2. Definition JSON byte-identical to `web/lib/intakeFormDefinition.ts` and the demo seed.

Status: **In review** — built on `dev` branch, committed & pushed. `tsc`, `eslint`, `next build` clean; both e2e tests green against live dev; create flow (incl. first-use auto-publish) and revoke verified end-to-end on dev. Needs the **reach-reviewer** gate (touches the `form_links` / `form_versions` security boundary — client-side publish of an immutable form version is new) before it's Done or promoted.
Owner: (built this session) — frontend-designer for the panel, database-engineer for the `web/lib` wrappers + `publish_intake_form.sql`, reach-reviewer mandatory gate. Files: [web/app/admin/submissions/FormLinkPanel.tsx](../web/app/admin/submissions/FormLinkPanel.tsx), [web/app/admin/submissions/SubmissionsQueue.tsx](../web/app/admin/submissions/SubmissionsQueue.tsx), [web/lib/intake.ts](../web/lib/intake.ts), [web/lib/intakeFormDefinition.ts](../web/lib/intakeFormDefinition.ts), [supabase/publish_intake_form.sql](../supabase/publish_intake_form.sql), [web/tests/e2e/intake-link-management.spec.ts](../web/tests/e2e/intake-link-management.spec.ts)

---

## US-28: Re-copyable counselor review link

As a staff member, I want the counselor review link visible and copyable on the
staff dashboard, so that I can re-send it to the counselor whenever they need it
without re-issuing it.

Follows US-27. Prompted by a real workflow gap: US-22 shipped review tokens as
bcrypt-only and unrecoverable ("shown once at issue time"), which means "the
counselor lost their link" had no answer short of minting a new one, and there
was no issuance UI at all — the demo seed made the only token, in SQL.

**Security posture change, decided by Grant (owner) on 2026-09-03 and needing the
reach-reviewer gate:** the review token is now stored as plaintext alongside the
hash, and `review_tokens` gets an admin-only SELECT policy. The migration header
([20260903120000_review_link_recopy.sql](../supabase/migrations/20260903120000_review_link_recopy.sql))
carries the full trade-off: a DB leak now exposes review links → a season's
roster of first name / age / grade per school (no last names, no addresses, no
confidential families; roughly the tier `public_available_cards` already serves
anon). Accepted deliberately for the operational win.

Acceptance criteria:
- [x] Migration `20260903120000_review_link_recopy.sql`: `review_tokens.token text` (plaintext, unique); `admin read review_tokens` SELECT policy (`is_admin()` + the same confidential gate as `form_links`/`form_submissions`); `issue_review_token(drive_school_id, issued_to_email, expires_at?)` — `security definer`, admin-checked in body, mints ≥32 bytes server-side, **idempotent per school** (one live link; a second call returns the existing token, `reused:true`), writes BOTH `token` and `token_hash`. The three counselor functions are left untouched — they still match on `token_hash`.
- [x] Default expiry = end of the drive's year (INTAKE_FORMS §3), never issued already-expired.
- [x] Only school links: `issue_review_token` refuses a null `drive_school_id` (the confidential/staff queue isn't a counselor roster — `get_review_roster` already rejects it).
- [x] Registration links panel: each school shows its **counselor review link** below the family link — copyable, with issued-to email / expiry / last-opened — or a one-field "Create counselor link" form (email prefilled from the school's liaison) when none exists.
- [x] "Waiting on counselor" group in the queue shows a **Copy** shortcut for each relevant school's review link (or a pointer to create one).
- [x] A volunteer cannot issue a link (`reason: "forbidden"`) — covered by a test.
- [x] e2e in `intake-link-management.spec.ts`: admin issues a link through the page, an anon `get_review_roster` opens the roster with it, and `issue_review_token` is proven admin-only + idempotent.
- [x] Applied to **dev** only; **prod untouched** (no Software Acceptance Review).

Status: **In review** — code committed & pushed on `dev`; migration **applied to dev** by Grant 2026-09-03. `tsc`/`eslint`/`next build` clean; all 4 `intake-link-management` e2e tests green against live dev (issue-through-the-page, roster opens with the token, admin-only + idempotent). **Prod untouched.** Still needs the **reach-reviewer** gate — this reverses the "no function ever returns a token" invariant from 20260830120000 and changes what a DB leak exposes.
Owner: (built this session) — database-engineer (migration + `web/lib/intake.ts` wrappers), frontend-designer (panel + queue shortcut), **reach-reviewer mandatory gate**. Files: [supabase/migrations/20260903120000_review_link_recopy.sql](../supabase/migrations/20260903120000_review_link_recopy.sql), [web/lib/intake.ts](../web/lib/intake.ts), [web/app/admin/submissions/FormLinkPanel.tsx](../web/app/admin/submissions/FormLinkPanel.tsx), [web/app/admin/submissions/SubmissionsQueue.tsx](../web/app/admin/submissions/SubmissionsQueue.tsx), [web/app/admin/submissions/CopyLinkButton.tsx](../web/app/admin/submissions/CopyLinkButton.tsx), [web/tests/e2e/intake-link-management.spec.ts](../web/tests/e2e/intake-link-management.spec.ts)

---

## US-29: "Household" terminology + school-prefixed household tag

As staff, a volunteer, or a counselor, I want every "family" in the app to read
as "Household" and to be identified by a school-prefixed tag (e.g. "Household
OL1") that matches its card numbers, so that a household is unambiguous across
the whole drive and the label lines up with the printed cards.

Prompted by Grant (2026-09-02): the "Family N" label increments only within a
school, so OneLife and Clear Creek both have a "Family 1" and the number reads
non-unique. The intent behind the rename is also to signal to registering
households that they list only children who **live with them** — US-30 is the
form-side half of that.

Context:
- `families.family_number` is a per-school integer (per-drive for confidential families), assigned atomically by `create_family()`. Bare, it repeats across schools.
- Card base IDs are **already** school-prefixed and derived, never stored: `{drive_schools.code | 'Z'}{family_number}.{child_index}` → `OL1.3` — see `child_card_numbers` (SCHEMA §6), `public_available_cards` (§9), and `getChildCardNumber` in [web/lib/queries.ts](../web/lib/queries.ts).
- So the gap is the *label*, not the number. Showing the school-code prefix as part of the identifier ("Household OL1") makes it read unique and aligns it with the card number — **no renumber, no migration**.
- Decision (Grant, 2026-09-02): prefixed tag, **not** a global 1–200 renumber. Rename is **user-visible text only** — `family_number` / `familyNumber` / `create_family` / the `families` table / view + column names all stay.

Acceptance criteria:
- [x] One shared helper in `web/lib/queries.ts` — `getHouseholdTag(data, family)` → `${getFamilySchoolCode()}${familyNumber}` with the same `'Z'` fallback the card number uses. `getChildCardNumber` now derives from it (`${tag}.${childIndex}`) so the tag and the card number can't drift.
- [x] `web/app/admin/families/FamiliesExplorer.tsx`: row label "Household OL1" (was "Family 1"); column header "Household"; search box placeholder + match string updated. `householdTag` threaded through `AdminFamilyRow` (and `DistributionRow`).
- [x] Intake success banner (`web/app/admin/intake/page.tsx`) reads "Saved as Household OL1 with N child(ren)" — school code resolved client-side from the picked school, `'Z'` for direct/confidential.
- [x] Family detail page `web/app/admin/families/[familyId]/page.tsx` — heading + body copy + conflict/partial-save banners use "Household" + the tag.
- [x] Staff submission detail (`SubmissionDetail.tsx`) + queue empty state say "household". **Counselor review roster (`web/app/review/**`) deliberately NOT changed** — "the families you referred" reads as natural English there; flagged for Grant.
- [x] Public sponsor pages unchanged; `public_available_cards` not touched.
- [x] Staff-surface "family/families" copy → "household(s)": families pages, intake, distribution, schools household-count column, `AdminNav` ("Household Admin"), `store.tsx` error messages. **Public form / `web/components/intake/**` left for US-30** (same immutable-definition surface).
- [x] No migration; no rename of `family_number` / `familyNumber` / `create_family` / `families` / `child_card_numbers` / `AddFamilyResult.familyNumber` / the `answers.family` data key.
- [x] `tsc` / `eslint` / `next build` clean. e2e specs updated (`ui-flows`, `volunteer-intake`, `concurrency`). `volunteer-intake` (3) + the confidential-redaction + intake-validation tests green against live dev; the full `intake-walkthrough` run is blocked on `supabase/intake_demo_seed.sql` not being present on dev (pre-existing env gap, not this change).
- [x] Confidential households show "Household Z1" — Grant confirmed `Z` is fine (2026-09-02).

Status: **In review** — built on `dev`, committed & pushed. `tsc`/`eslint`/`next build` clean; targeted e2e green against live dev. No migration / no RLS / no view change, so no reach-reviewer gate required; a code-reviewer pass before Done is enough.
Owner: (built this session) — frontend-designer surface. Files: [web/lib/queries.ts](../web/lib/queries.ts), [web/lib/store.tsx](../web/lib/store.tsx), [web/app/admin/families/FamiliesExplorer.tsx](../web/app/admin/families/FamiliesExplorer.tsx), [web/app/admin/families/page.tsx](../web/app/admin/families/page.tsx), [web/app/admin/families/[familyId]/page.tsx](../web/app/admin/families/[familyId]/page.tsx), [web/app/admin/intake/page.tsx](../web/app/admin/intake/page.tsx), [web/app/admin/distribution/page.tsx](../web/app/admin/distribution/page.tsx), [web/app/admin/schools/page.tsx](../web/app/admin/schools/page.tsx), [web/app/admin/AdminNav.tsx](../web/app/admin/AdminNav.tsx), [web/app/admin/submissions/SubmissionsQueue.tsx](../web/app/admin/submissions/SubmissionsQueue.tsx), [web/app/admin/submissions/[submissionId]/SubmissionDetail.tsx](../web/app/admin/submissions/[submissionId]/SubmissionDetail.tsx)

---

## US-30: "Everyone lives in my home" affirmation on the family intake form

As the drive, I want a household filling out gift registration to affirm that
every child listed lives in their home, so that we register children who live
with the household — not extended family who visit.

The form-side half of US-29's intent. Decision (Grant, 2026-09-02): **one
household-level affirmation** near submit, plus reworded intro/help — not a
per-child checkbox.

Context:
- The public form `web/app/form/[token]/FamilyForm.tsx` is fully definition-driven: intro, section help, submit label all come from the **immutable** published form version (`web/lib/intakeFormDefinition.ts` + the SQL seeds + `import_submission`'s hard-coded field contract). Wording changes touch the definition (a v2). A required checkbox can instead be hardcoded UI in `FamilyForm.tsx` (like the honeypot and the "you won't be able to change this" note), gated in `handleSubmit` before `submitForm`, with no persistence and no version bump — the lighter path, matching the decision.

Acceptance criteria:
- [x] A required checkbox in the submit card of `web/app/form/[token]/FamilyForm.tsx`: "Everyone I've listed lives in my home." Submit blocked until checked; the miss is pushed into `localErrors` in `handleSubmit` with a synthetic field path, so it lists in `ErrorSummary`, links/focuses like any field error, and clears when the box is ticked. `FieldError` also renders inline next to the checkbox.
- [x] Per-child help text below the checkbox: "Only register children who live with you. Please don't list a relative's child or someone who only visits."
- [x] **Not persisted** — it's a hardcoded page gate, no definition field, no version bump, `import_submission`'s contract untouched. The main form intro/section help (definition-driven, immutable) were **left as-is**; reword them in a definition v2 later if wanted. Flagged for Grant.
- [x] Counselor review step unaffected (nothing persisted).
- [x] e2e: new test in `intake-walkthrough.spec.ts` — fill the form, leave the box unchecked, submit → error summary + no `form_submissions` row; check it, resubmit → "Thank you" + row written. `fillAndSubmitFamilyForm` helper ticks the box by default (`everyoneLivesHere?: boolean` to opt out).
- [x] `tsc` / `eslint` / `next build` clean. The new e2e can't run here — its `describe` block's `beforeAll` needs `supabase/intake_demo_seed.sql` on dev, which isn't seeded (pre-existing; blocks the whole walkthrough file). Grant to run it after the seed.
- [x] **dev** only; **prod untouched**.
- [x] No migration, no definition-contract change → no reach-reviewer gate. code-reviewer pass before Done.

Status: **In review** — built on `dev`, committed & pushed. `tsc`/`eslint`/`next build` clean. New e2e written; run blocked on the dev intake seed (not this change).
Owner: (built this session) — frontend-designer surface. Files: [web/app/form/[token]/FamilyForm.tsx](../web/app/form/[token]/FamilyForm.tsx), [web/tests/e2e/helpers/intake.ts](../web/tests/e2e/helpers/intake.ts), [web/tests/e2e/intake-walkthrough.spec.ts](../web/tests/e2e/intake-walkthrough.spec.ts)

---

## US-31: Pre-demo copy + admin layout polish

As the team about to demo this, I want the admin pages to feel consistent and
the wording to be finished, so the demo doesn't get derailed by rough edges.

Decisions (Grant, 2026-09-07):
- **"Household" everywhere a person reads it** — this now includes the counselor
  review pages (`web/app/review/**`), which US-29 had deliberately left as
  "families". Backend identifiers (`families` table, `family_number`,
  `create_family`, the `answers.family` JSON key, `familyId` in TS) stay
  "family". Convention recorded in the auto-memory; **AGENTS.md / SCHEMA.md not
  changed** (they describe the schema, which keeps the old names).
- **No em-dashes in user-facing copy** — reworded, not just swapped. Scope: every
  string a user could see, app-wide. Out of scope and left as-is: code comments,
  the `"—"` empty-value placeholder in tables/detail views (a deliberate
  convention — flag for Grant if he wants those swapped too), the
  `SENTENCE_SHAPED` allowlist regex in `web/components/intake/format.ts`, and
  test files.
- **Admin header/nav spacing** — new `web/app/admin/AdminPageHeader.tsx`: one
  component for the title + description + optional action + nav band, so the nav
  sits in the same place on every page. Description capped at `max-w-2xl`; nav is
  now a non-wrapping horizontal scroller (`AdminNav.tsx`) so it's always one row.
  Nav labels shortened ("Household Admin" → "Households", "Audit log" → "Audit").

Acceptance criteria:
- [x] Counselor review pages, submissions queue/detail, `shared.ts` status
  groups, schools/staff/audit/dashboard intros, landing page → "household(s)".
  "Confidential families" on the staff account page also switched (Grant: all of
  it).
- [x] Intake questionnaire copy (B4–B8): section "About your family" → "About
  your household"; "Each child" → "Children in your home"; consent "my family's
  information" → "my household's information"; intro reworded (once-per-household
  framing, reinforces the US-30 "lives with you" intent, no em-dash); privacy
  note corrected — it claimed sponsors see "only first name, grade, and wish
  list" but they also see sizes and specific needs, so it now lists those and
  states "never your last name or address". Same fix applied to the `/sponsor`
  page intro, which had the identical inaccuracy.
- [x] Form definition change is in all three synced copies:
  `web/lib/intakeFormDefinition.ts`, `supabase/publish_intake_form.sql`,
  `supabase/intake_demo_seed.sql`. Field **ids** untouched, so
  `import_submission`'s contract is unchanged. `INTAKE_FORM_NAME` /
  `forms.name` → "Household Gift Registration".
- [x] **dev publish:** `supabase/publish_intake_form.sql` run on dev by Grant
  2026-09-07 — form-version **v2** cut. Existing registration links stay pinned
  to v1 until new ones are created; for the demo, create a fresh link (or re-run
  `intake_demo_seed.sql`) so the link shows the new wording.
- [x] `AdminPageHeader` adopted by all 13 `/admin` pages; `AdminNav` no-wrap
  scroller; labels shortened.
- [x] Em-dash sweep: `web/app/**`, `web/components/**`, `web/lib/store.tsx`,
  `web/components/intake/PublicShell.tsx`, the form definition ×3.
- [x] `tsc` / `eslint` / `next build` clean.
- [ ] **dev** only; **prod untouched**. No migration, no RLS/view/function change
  → no reach-reviewer gate; code-reviewer pass before Done.

Status: **In review** — built on `dev` this session, committed & pushed.
`tsc`/`eslint`/`next build` clean; verified running against dev (admin login,
screenshots). dev form-v2 published by Grant. Outstanding: create a fresh demo
registration link (or re-seed) so it shows v2, and a code-reviewer pass before
Done.
Owner: (built this session) — frontend-designer surface + the two intake SQL
files. Key files: [web/app/admin/AdminPageHeader.tsx](../web/app/admin/AdminPageHeader.tsx), [web/app/admin/AdminNav.tsx](../web/app/admin/AdminNav.tsx), all `web/app/admin/*/page.tsx`, [web/app/review/[token]/](../web/app/review/[token]/), [web/lib/intakeFormDefinition.ts](../web/lib/intakeFormDefinition.ts), [supabase/publish_intake_form.sql](../supabase/publish_intake_form.sql), [supabase/intake_demo_seed.sql](../supabase/intake_demo_seed.sql).

---

# Epic: High schoolers as a self-shopping bucket (US-32 … US-36)

Requested by Grant, 2026-09-08. Resolves [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)
**ADM-19**.

GitLab: US-32 → [#24](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/24),
US-33 → [#25](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/25),
US-34 → [#26](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/26),
US-35 → [#27](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/27),
US-36 → [#28](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/28).
US-33/34/35/36 are linked as blocked by #24; #28 also blocked by #25.

**The change.** High schoolers (grades 9–12) are invited to a shopping day at a
local store to pick their own gifts (Target, 12/19, last year) instead of being
sponsored. They still belong to a household and still need to be *counted and
organised*, but they must never enter the sponsor pool, the card-printing run, or
the "cards claimed / gifts delivered" dashboard math. Every child grade 8 and
below (down to babies) is unchanged — normal card, normal wishlist, normal
sponsor flow.

**Owner decisions (Grant, 2026-09-08):**

1. **Staff household view** — a high schooler *is* shown in the Families Explorer
   and family detail, still one row per child, and still gets a `cards` row so no
   code path that assumes "every child has a card" breaks. That card is flagged
   as a self-shopper card: excluded from `public_available_cards`, from
   `/admin/print`, and from the claimed/delivered counts. In the household view
   the teen shows a "High schooler — shop day" badge where a claim status would
   normally be.
2. **Classification** — a child is a high schooler when `grade` is `9`, `10`,
   `11`, or `12`, set automatically at both write paths (public form import and
   manual `/admin/intake`). Staff can override it either way on the family edit
   screen for edge cases (held back a year, early grad, blank grade).
3. **Public form** — when a family picks grade 9–12 for a child, that child's
   wishlist, three sizes, specific-needs and other-notes fields disappear and are
   replaced by a short panel explaining the teen shopping day. The child is still
   submitted (first name, age, grade), the counselor still vets them, and import
   still creates the household with the teen in it — just flagged and card-muted.
4. **Tracking surface** — a dedicated high schooler view with: a count + a roster
   filterable by school (first name, grade, guardian contact); a per-teen
   shop-day status (invited / confirmed / attended) with a notes field; and an
   exportable / printable roster for the store.

**Timeline.** The counselor form goes out **10/1**, so US-32 and US-33 (data
model + form) must be on dev and through the `reach-reviewer` gate before then.
US-34–US-36 (staff UI, tracking page, tests) can follow after 10/1 but want to be
done well before **11/1** (OneLife needs names) and the **12/19** shop day.

**Cross-cutting constraints:**
- `public_available_cards` is the whole sponsor security boundary — the exclusion
  is a predicate *in the view*, at the DB layer, never a UI filter. Touching it
  means the mandatory `reach-reviewer` gate and dev-only until a review clears it
  (SCHEMA.md / [AGENTS.md](../AGENTS.md)).
- The public form definition is **immutable and versioned**, synced byte-for-byte
  across [web/lib/intakeFormDefinition.ts](../web/lib/intakeFormDefinition.ts),
  [supabase/publish_intake_form.sql](../supabase/publish_intake_form.sql), and
  [supabase/intake_demo_seed.sql](../supabase/intake_demo_seed.sql). Field *ids*
  are the `import_submission` contract — see US-20. This epic cuts a **v3**.
- `submit_form` validates server-side against the pinned definition (age 0–19,
  grade in list, 1–3 wishlist with first required, sizes required). That
  validation has to *relax per child* for grades 9–12 — client hiding is a
  convenience, not the control.
- The store/date for the shop day is **not confirmed for 2026** (Target / 12/19
  was last year). Decision (Grant, 2026-09-08): ship the literal placeholder text
  `[placeholder store]` and `[placeholder date]` in the form copy for now. Keep it
  a single configurable string / definition field, not hard-coded literals in
  three places, so swapping in the real values later is a one-line change.

---

## US-32: High schooler data model + sponsor-pool exclusion

As the drive, I want a child in grades 9–12 to be recorded as a self-shopping
high schooler, so that they are counted as part of their household but never
enter the sponsor pool, the print run, or the fulfilment math.

Owner decision 1 & 2 above. **Must be on dev + through `reach-reviewer` before
2026-10-01.**

Acceptance criteria:
- [ ] One additive migration adds `children.is_high_schooler boolean not null default false` (name TBD by database-engineer; must read cleanly in RLS/views). No rename of existing columns.
- [ ] `import_submission()` sets `is_high_schooler = true` when the imported child's `grade` is in `('9','10','11','12')`, and skips wishlist insertion for those children (there will be none from the v3 form, but the guard is explicit). A card row is **still** created — the one-card-per-child invariant is unchanged.
- [ ] The manual intake write path (`web/lib/store.tsx` `addFamily` / child insert) sets the same flag from the same grade rule.
- [ ] `public_available_cards` gains `and not ch.is_high_schooler` as an **inner** predicate in the view definition. A high schooler's card is confirmed absent from the anon result set (verified as a genuinely signed-out client, per the US-17 guardrails — do not add anon policies or grants to base tables).
- [ ] `/admin/print` (`printable_cards` / `getCardsNeedingPrint`) excludes high schooler cards — they are not printed.
- [ ] Dashboard math (`web/lib/queries.ts`): "Cards claimed / total", "Gifts delivered", overdue-sponsors, and cards-to-print all exclude high schooler cards from both numerator and denominator.
- [ ] A high schooler can still be marked confidential (the flag is orthogonal to `families.is_confidential`); confidential + high schooler behaves as both.
- [ ] `reach-reviewer` gate passed (touches `public_available_cards` + `import_submission`).
- [ ] Applied to **dev** only; **prod untouched** until a Software Acceptance Review clears it.

Status: **In review** — built this session on `dev`.
[supabase/migrations/20260908130000_high_schooler_bucket.sql](../supabase/migrations/20260908130000_high_schooler_bucket.sql)
+ data layer ([web/lib/types.ts](../web/lib/types.ts), `mappers.ts`, `queries.ts`,
`store.tsx`). `tsc` / `eslint` / `next build` clean.
**Implementation note:** `import_submission()` and `submit_form()` were left
*unchanged* — the flag is set by a `children` BEFORE INSERT trigger (covers both
write paths for free), a `wishlist_items` BEFORE INSERT trigger drops any
wishlist row for a high schooler, and the sponsor-pool exclusion is a predicate
added to the three views. Smaller, more auditable surface for the gate.
`is_high_schooler` is orthogonal to `is_confidential` (no code couples them).
**Migration applied to dev by Grant 2026-09-08.** Live-verified via US-36:
`public_available_cards` as a genuine anon client excludes a grade-10 card and
keeps the grade-3 one; the INSERT trigger classifies a hand-inserted grade-11
child; the wishlist trigger drops rows for a high schooler.

**reach-reviewer gate: PASSED 2026-09-08 — "clean, no high or critical findings,
safe to promote to prod."** All ten invariants checked; `intake_validate_field`
confirmed byte-equivalent to the original apart from the SELF-SHOPPER early
return; `public_available_cards` confirmed character-identical to
`20260818120000` plus the one inner predicate. Three informational notes, none
blockers:
1. **SAR note:** the SELF-SHOPPER validation skip is coupled to
   `is_high_schooler` tracking grade. If staff *manually clear* the flag on a
   grade 9–12 child, that card re-enters `public_available_cards` with gift
   fields that were never server-validated at submit. Bounded by
   `import_submission`'s `left()` truncation (sizes ≤ ~80, notes ≤ 500 — not the
   unbounded H1 class) and requires a deliberate staff action that contradicts
   the grade. Documented, not fixed.
2. `wishlist_items_skip_high_schooler` is `security definer` where `invoker`
   would do — not exploitable (trigger return type, no data-out path). Optional
   least-privilege downgrade; left as-is.
3. The backfill `UPDATE` fires `set_updated_at` + `audit_children` for every
   reclassified row at apply time. Expected, harmless.

**Outstanding: prod untouched (needs SAR).**
Owner: database-engineer (migration, view, data layer — built this session), reach-reviewer (gate — PASSED)

---

## US-33: Public form — teen block replaces wishlist with shop-day info

As a parent registering a household with both younger children and a high
schooler, I want the form to accept my teen without asking for a wishlist or
sizes, so that I can register everyone in one submission and my teen gets pointed
to the shopping day.

Owner decision 3 above. **Must be on dev before 2026-10-01.**

Acceptance criteria:
- [ ] Form definition **v3** (all three synced copies): the child section carries conditional-visibility metadata so that when `grade` ∈ {9,10,11,12}, the `wishlist`, `shirt_size`, `pant_size`, `shoe_size`, `specific_needs`, and `other_notes` fields are hidden and a static shop-day info panel is shown instead. Field **ids** unchanged — `import_submission`'s contract is untouched.
- [ ] `FamilyForm.tsx` renders the conditional block: picking a 9–12 grade for a child live-hides that child's gift fields and shows the shop-day panel; changing the grade back restores the fields with no data loss for the other children.
- [ ] `submit_form` server validation relaxes per child: for a grade 9–12 child, wishlist/sizes/needs/notes are **not required** and any values sent for them are ignored (not written). Age 0–19 and grade-in-list still enforced for every child. At-least-one-child still enforced.
- [ ] The honeypot, consent, and "everyone lives in my home" (US-30) gates are unchanged and still apply to the whole submission.
- [ ] The shop-day panel ships the literal placeholder text `[placeholder store]` and `[placeholder date]` (Grant, 2026-09-08 — 2026 store/date not confirmed). The store and date each come from **one** place (a definition field or a single constant), so swapping in real values is a one-line change and does not require another form version if kept as a non-pinned constant.
- [ ] `get_review_roster` / counselor view still shows the teen (first name, age, grade) — a counselor vets a high schooler exactly like any other child. No wishlist/size data exists to leak for them.
- [ ] Mobile-first, real `<label for>` associations, inactive/expired token page unchanged.
- [ ] dev publish: v3 cut on dev by Grant; a fresh demo registration link (or re-seed) so the demo shows v3. Existing links stay pinned to their version.
- [ ] `tsc` / `eslint` / `next build` clean.

Status: **In review** — built this session on `dev`. `tsc` / `eslint` / `next build` clean.
Approach differs slightly from the story text: rather than "conditional-visibility
metadata", the six gift fields carry `self_shopper_hidden: true` in the definition
(all 3 synced copies + the TS `IntakeFormField` type + `normalizeDefinition`).
`submit_form` needed **no change** — the skip lives in the shared
`intake_validate_field` (migration 20260908130000 §6): a `self_shopper_hidden`
field whose child's grade is 9–12 returns clean. `FamilyForm.tsx` filters those
fields and shows a hardcoded `<ShopDayNote>`; store/date are
`SHOP_DAY_STORE` / `SHOP_DAY_DATE` constants in `intakeFormDefinition.ts` (literal
`[placeholder store]` / `[placeholder date]`), not pinned in the definition, so
swapping real values needs no new form version. `validate.ts` mirrors the skip.
**Form definition v3 published on dev by Grant 2026-09-08** (re-ran
`intake_demo_seed.sql`, demo link `demo-north-family-2026` repointed to v3).
Live-verified via US-36: `submit_form` accepts a grade-9–12 child with no gift
fields and still rejects a grade-8 child with no wishlist; the public form
hides/restores the gift fields on grade change. **Outstanding: prod
(re-publish there after SAR).**
Owner: frontend-designer (renderer + definition), database-engineer (validator + the 3-way sync) — built this session

**Update 2026-09-29:** the shop-day panel no longer names a specific store or
date at all — `SHOP_DAY_STORE`/`SHOP_DAY_DATE` were removed from
`intakeFormDefinition.ts`. Grant decided the counselor tells each high-school
family those details directly, closer to Christmas, rather than the family
form. The panel now just says the counselor will reach out with the shopping
day details. Same change made in both `PHASE_1_FORM_DEFINITION` and
`PHASE_1_FORM_DEFINITION_ES`.

---

## US-34: Staff intake + household view — high schooler badge and override

As a staff member or volunteer, I want to see which children in a household are
high schoolers and correct the classification when it's wrong, so that the split
between sponsored kids and shop-day teens is trustworthy.

Owner decisions 1 & 2 above.

Acceptance criteria:
- [ ] `web/app/admin/intake` (manual hand-entry): entering grade 9–12 for a child flags them as a high schooler, and the intake success/summary copy reflects it (e.g. "Household OL1 — 2 children, 1 high schooler").
- [ ] Family edit screen (`web/app/admin/families/[familyId]`): a per-child "High schooler (shops their own gifts)" toggle, defaulted from the grade rule, that staff can force on or off. Covered by the US-13 concurrent-edit conflict check like any other child field.
- [ ] Families Explorer: a high schooler row shows a "High schooler — shop day" badge in place of the claim-status badge; its card number still displays. The school/status filters still work; consider a "High schoolers" quick filter (see US-35).
- [ ] Family detail: high schooler children are visually distinguished from sponsored children, and their (empty) wishlist/size area is replaced with a short "handled via shop day" note rather than empty fields.
- [ ] Nothing on these screens lets a high schooler's card be claimed, printed, or advanced through fulfilment.
- [ ] `tsc` / `eslint` / `next build` clean; e2e specs updated.

Status: **In review** — built this session on `dev`. `tsc` / `eslint` / `next build` clean.
Intake success copy now reads "…with N children (1 high schooler, tracked on the
High schoolers page)." Family-edit toggle lives in `ChildFormFields.tsx`
(`isHighSchooler` threaded through `ChildFormState` / `EditableChildInput`,
`saveFamilyEdit` sends `is_high_schooler` — authoritative for existing children,
the INSERT trigger still wins for brand-new grade-9–12 children so an unchecked
box there sticks only on the next save; documented in `store.tsx`). Typing a 9–12
grade auto-checks the box; it never auto-unchecks. Families Explorer shows a
"High schooler · shop day" badge in the status column and "—" for sponsor.
**Family-detail "handled via shop day" note is NOT done** — the edit form still
shows the wishlist/size inputs for a high schooler (staff may want to keep sizes
for the store roster; left deliberately). Flag for Grant.
Owner: frontend-designer — built this session

---

## US-35: High schooler roster, dashboard tile, and shop-day tracking

As a staff member, I want one place to see how many high schoolers have signed
up, organise them by school, and track the shopping day, so that the 12/19 event
can actually be run from this app.

Owner decision 4 above.

Acceptance criteria:
- [ ] Dashboard: a "High schoolers registered" stat tile for the open drive, separate from "Children registered" (which now counts sponsored kids only, or shows both figures — frontend-designer's call, stated in the story when built).
- [ ] New `/admin/high-schoolers` page in the admin nav: one row per high schooler for the open drive — first name, household tag, school, grade, age, guardian name/phone/email — filterable by school and by shop-day status. Confidential households obey the existing `can_view_confidential()` gate (a volunteer without clearance sees no confidential teens, because the query returns none).
- [ ] Per-teen shop-day status: `invited` / `confirmed` / `attended` (plus an implicit `not_contacted` default) and a free-text notes field. Where this lives (columns on `children` vs. a small `shop_day_status` table) is database-engineer's call; if it's a new table it needs RLS mirroring `children` before it ships (AGENTS.md guardrail).
- [ ] Status is editable inline from the roster; changes are audited (the existing `audit_log` trigger pattern).
- [ ] An export / print view of the roster (CSV or a clean print layout) for taking to the store — first name, grade, size info if available, count. No last names beyond what staff already see; this is a staff-only artefact, never anon-reachable.
- [ ] Counts reconcile: roster count == dashboard tile == `children` where `is_high_schooler` for the open drive.
- [ ] `tsc` / `eslint` / `next build` clean.

Status: **In review** — built this session on `dev`. `tsc` / `eslint` / `next build` clean.
Storage: **columns on `children`** (`shop_day_status` enum `not_contacted`/`invited`/
`confirmed`/`attended`, `shop_day_notes text`) in migration 20260908130000 — no new
table, so the existing `children` RLS + audit trigger cover it. New
[web/app/admin/high-schoolers/page.tsx](../web/app/admin/high-schoolers/page.tsx)
with **two views** (toggle):
- **Roster** — one row per teen, contact info, inline status select + notes,
  "Copy roster (CSV)" to clipboard, school + status + search filters.
- **Board** (added 2026-09-08 on Grant's ask — a card sitting at "unclaimed" with
  no pipeline was the gap): columns per shop-day stage, one card per teen, a
  "Mark [next]" / "Back" button pair, mirrors `/admin/fulfillment`. Stages are
  the four above; **no-shows are handled offline** (Grant, 2026-09-08) — the
  board just shows who didn't reach Attended.

Both write through `setShopDayTracking` in `store.tsx`. Dashboard gains a
"High schoolers" tile; "Children registered" now counts sponsored kids only
(`getDashboardStats` reworked). `AdminNav` gains the tab. Shared constants
(`SHOP_DAY_STATUS_ORDER` / `_LABELS` / `NEXT_SHOP_DAY_STATUS`) in `queries.ts`.
**Export is copy-to-clipboard CSV, not a file download** — enough for Phase 1.
e2e: `high-schoolers.spec.ts` covers the board advancing a teen through the
pipeline (7/7 green on dev).
Owner: frontend-designer (page, tile, board, export), database-engineer (columns + `setShopDayTracking`) — built this session

---

## US-36: End-to-end coverage for the high schooler split

As the team, we want the sponsored-kid / high-schooler split covered by tests, so
that a future change can't silently put a teen back in the sponsor pool.

Acceptance criteria:
- [ ] A spec submits a household with one grade-3 child and one grade-10 child through `/form/[token]`: the form hides the teen's gift fields, the submission succeeds, the counselor roster shows both, import creates one household with both children, the teen has `is_high_schooler = true` and no wishlist rows, the grade-3 child is unchanged.
- [ ] A `public_available_cards` assertion (as a genuinely anonymous client): the grade-10 child's card never appears; the grade-3 child's does.
- [ ] A dashboard-math assertion: the high schooler is not in "cards claimed / total" or "gifts delivered", and appears in the high schooler count.
- [ ] A staff-override test: flipping the family-edit toggle moves a child in/out of the sponsor pool (card appears/disappears from the anon view accordingly).
- [ ] `submit_form` server-side: a grade-10 child submitted *with* wishlist/size values still imports with those columns null; a grade-8 child submitted without a wishlist is still rejected.
- [ ] All synthetic data, cleaned up, suite still green serially (TST-1).

Status: **In review** — spec written this session:
[web/tests/e2e/high-schoolers.spec.ts](../web/tests/e2e/high-schoolers.spec.ts)
(6 tests: mixed-household import + flag + no-wishlist, anon `public_available_cards`
exclusion, `submit_form` skip vs. grade-8 still-required, hidden-field junk dropped
at import, INSERT-trigger auto-classify, and a `/form/[token]` browser test that the
gift fields hide/restore on grade change). `tsc` / `eslint` clean.
**6/6 green against dev 2026-09-08** (`--workers=1`). Full e2e suite: 79 passed,
1 skipped, 3 failed — all 3 failures pre-existing and unrelated
(`ui-flows.spec.ts:89` SPN-3 wrong-code lockout; `intake-link-management.spec.ts:162`
and `intake-runtime-checks.spec.ts:269` — the latter provably stale, it asserts
`authenticated` can't SELECT `review_tokens` which US-28's `20260903120000`
migration deliberately changed; belongs to US-28's cleanup). Also fixed a
pre-existing locator bug in US-30's walkthrough test (`getByRole("alert")` matched
Next's route announcer). The dashboard-math assertion is covered indirectly via
the anon-view exclusion; the staff-override toggle path is not yet a test.
Owner: qa-tester — spec drafted + run this session

---

## US-37: Cross-school household hint in the staff queue

As a staff member importing registrations, I want to be told when a
registration is probably the same household as one I've already imported (at a
different school), so that I'm not surprised at distribution and can note the
connection.

Prompted by Grant during the US-32 work (2026-09-08). A household with kids at
more than one school fills out one form per school (per-school links stay — each
counselor vouches only for their own kids) and imports as **one record per
school**. That split is by design ([DESIGN.md §8](../DESIGN.md), OPEN_QUESTIONS
DB-23) — `Family` is a distribution-day grouping, not a household model, and
merging would break per-school card/household numbering. Decision (Grant,
2026-09-08): **hint only, no merge, no "household group" model.**

Acceptance criteria:
- [x] `findHouseholdMatches` in [web/app/admin/submissions/shared.ts](../web/app/admin/submissions/shared.ts): matches a submission against already-imported `families` and other pending submissions **on normalized guardian phone** (last 10 digits — the one field a guardian re-types identically on both forms). Name is not used (too loose). A phone under 10 digits yields no match.
- [x] The staff queue (`SubmissionsQueue.tsx`) shows, under any non-rejected row with a match: "Possibly the same household (same guardian phone) as Household N3 (different school). They import as separate records on purpose; note the link if it matters at distribution." The household tag / other registration is a link.
- [x] The submission detail page (`SubmissionDetail.tsx`) shows the same hint as a banner above the Import panel — matched against imported households only (it doesn't load the full queue).
- [x] It is **never a blocker** — Import still works exactly as before. Nothing is auto-linked or auto-rejected.
- [x] Confidential-channel submissions obey the existing gate: `data.families` and `listSubmissions` already exclude confidential rows for uncleared staff, so an uncleared volunteer's hint can't reveal a confidential household.
- [x] e2e: [web/tests/e2e/submissions-dedup.spec.ts](../web/tests/e2e/submissions-dedup.spec.ts) — import household A, submit household B with the same phone, assert the hint appears on B's queue row and names A's household on B's detail page. Green on dev.
- [x] `tsc` / `eslint` / `next build` clean.

Not done (deliberate): a "link these two households" action that groups them on
the distribution page. Left as a possible follow-up if cross-school households
turn out to be common enough to matter operationally — revisit in November.

Status: **In review** — built this session on `dev`. No migration (pure
client-side derivation over data staff already load). Covered by the
2026-09-08 reach-reviewer pass on the epic: "cannot surface a household the
viewer can't already see; both links target RLS-gated routes; non-blocking."
code-reviewer pass before Done.
Owner: frontend-designer — built this session

---

## US-38: Put a child "on hold" (duplicate review)

As an admin who has spotted a probable duplicate child (the US-37 hint, or just
noticing two households are the same), I want to put that child on hold so their
card leaves the sponsor pool, the print run, and every count until I've sorted
it out — without deleting anything.

Prompted by Grant (2026-09-09), reviewing the Rivera / Rivera 2 test data. US-37
tells staff two households are probably the same; it gives them nowhere to act
on it. The prior decisions stand — **no merge, no household-group model, the
counselor's word is final** ([US-37](#us-37-cross-school-household-hint-in-the-staff-queue),
OPEN_QUESTIONS DB-23) — and **deletion stays out of the app** (still SQL-editor
only, [families/[familyId]/page.tsx](../web/app/admin/families/[familyId]/page.tsx)).
"On hold" is the middle path: reversible, no data loss, admin-only.

Decisions (Grant, 2026-09-09):
- **Admin-only.** Volunteers see held children and the badge; they can't hold or
  release.
- **Its own page**, in the Intake menu — not just a filter.
- **Claimed-card conflict is out of scope** — process puts every child in and
  sorted *before* sponsor claiming opens, so it shouldn't arise. Handle it
  defensively anyway (criterion below), don't build UI around it.

Acceptance criteria:
- [x] Migration (dev only, **reach-reviewer gate** — touches `public_available_cards`):
  `children` gains `held_at timestamptz`, `held_by uuid`, `hold_reason text`.
  `children` already has the RLS policies and the audit trigger this needs — no
  new table, same as the US-32/US-35 columns. → [supabase/migrations/20260909120000_child_on_hold.sql](../supabase/migrations/20260909120000_child_on_hold.sql), **written, not yet pasted to dev**.
- [x] `set_child_hold(p_child_id, p_reason)` and `release_child_hold(p_child_id)`
  server functions: `is_admin()` only (plus `can_view_confidential()` when the
  child's household is confidential). `set_child_hold` **raises** if the child's
  card has a non-cancelled `assignment` — message names the sponsor and says to
  cancel that claim first. Both write through so the audit trigger fires.
- [x] `public_available_cards` gains one inner predicate `and ch.held_at is null`,
  in the same spot as `and not ch.is_high_schooler`, character-for-character
  minimal — no other change to the view, no `security_invoker`.
- [x] `printable_cards` / `cards_needing_print` gain the same predicate — no card
  is printed for a child under review.
- [x] Held children are excluded from: the dashboard stats (`Children registered`,
  the cards-claimed denominator, `still need a sponsor`, `Sponsors overdue`), the
  Fulfillment board, the Shopping list, the Distribution list, and the high
  schooler roster / shop-day board. The `web/lib/queries.ts` derivations mirror
  the SQL, same as `isHighSchoolGrade` (`isChildOnHold`). Store methods
  `setChildHold` / `releaseChildHold` on the `useData()` context.
- [x] New page `/admin/on-hold` ("On hold" in the Intake menu): one row per held
  child — first name + household tag, hold reason, who/when, the US-37
  suspected-duplicate link where there is one, a link to the household edit page,
  and a **Release hold** button (admin only). Empty state when nothing is held.
- [x] `/admin/families` explorer: an "On hold" badge on held rows and an "On hold"
  value in the status filter. Held children stay listed here so they're findable.
- [x] Family edit page: an admin-only **Put this child on hold** control on each
  child block (prompts for a reason); a held child renders flagged with a
  **Release hold** action. Non-admins see the flag, not the buttons.
  → [ChildHoldControl.tsx](../web/app/admin/families/[familyId]/ChildHoldControl.tsx).
- [x] Confidential households: a held confidential child is only visible to
  `can_view_confidential()` staff — the existing row RLS already does this;
  `getChildrenOnHold` only returns rows already in the viewer's bundle, and the
  page redacts the first name for non-admins the same way the explorer does.
- [x] Dashboard: an "On hold" stat (count) linking to `/admin/on-hold`, shown
  only when the count is above zero.
- [x] e2e: hold a child → assert gone from `public_available_cards` (by card_id
  and first_name), gone from `printable_cards`; `held_at`/`held_by`/`hold_reason`
  stamped; release → back. A non-admin `set_child_hold` is refused; a claimed
  card is refused by sponsor name.
  → [web/tests/e2e/child-on-hold.spec.ts](../web/tests/e2e/child-on-hold.spec.ts),
  3/3 green on dev 2026-09-09 (migration applied). The `/admin/on-hold` page-level
  assertion is done at the data-source level (children where `held_at` is set).
- [x] `tsc` / `eslint` / `next build` clean.

Not done (deliberate):
- **Household-level hold.** Hold each child individually for now. If whole
  accidental-duplicate households turn out common, revisit.
- **Sponsor notification** on a hold — there's no email flow yet (INTAKE_FORMS
  §11). The claimed-card case is blocked at the function instead.
- **Any merge or auto-link** — unchanged from US-37.
- **Delete.** Still SQL-editor only. Hold is not a soft-delete; a held child is
  retained, audited, and reversible.

Status: **In review.** Built this session on `dev` across two commits:
`6b4b66a` (migration + data layer) and `fa89354` (the `/admin/on-hold` page,
explorer badge + filter, per-child control, dashboard tile). Migration
`20260909120000` **applied to dev** 2026-09-09; `child-on-hold.spec.ts` 3/3
green; `tsc` / `eslint` / `next build` clean. Still to do: (1) **reach-reviewer
gate** — mandatory, touches `public_available_cards`; (2) code-reviewer before
Done. Prod untouched until a Software Acceptance Review (same rule as every
intake migration).

Note: a pre-existing, unrelated e2e failure surfaced during the regression run —
`ui-flows.spec.ts` "five wrong code guesses lock the session" fails on `dev`
without any US-38 change (claim-code lockout path; see OPEN_QUESTIONS SPN-4).
Not introduced here.

Owner: database-engineer (migration + `web/lib` — done), frontend-designer (the
page, badges, and per-child controls — done), reach-reviewer (mandatory gate)

---

## US-39: Form V2 — require a contact email + confirmation-screen rewording

As the drive, I want every registration to carry an email we can send updates
to, and I want the confirmation screen to tell the family what happens next and
how they'll hear from us, so nobody registers and then hears nothing.

Requested by Grant, 2026-09-09. Cuts a new form version (**v3**).

Decisions (Grant, 2026-09-09):
- **One required email field**, not a separate counselor-email field. The
  existing `guardian_email` field becomes `required: true`; help text tells a
  family with no email of their own to have the counselor enter one (or a
  trusted contact's). No new field ids, so `import_submission`'s contract is
  untouched. The counselor can still add/fix the email at the review step.
- **"OneLife Church" everywhere in the form definition**, replacing "Reach
  Church" (consent checkbox, confirmation). App-wide "Reach Church" usage
  (`web/components/intake/PublicShell.tsx`, `web/app/review/[token]/RosterView.tsx`,
  and anywhere else) is **flagged for a follow-up**, not done here.
- **Confirmation body reworded**, heading kept ("Thank you. Your registration
  is in."). New body: "Your registration is with your school counselor now.
  They'll confirm it and pass it along to OneLife Church. You will receive
  further information via the email you provided. If you do not have an email,
  your counselor will relay further information."

Acceptance criteria:
- [x] Definition change in all three synced copies —
  [web/lib/intakeFormDefinition.ts](../web/lib/intakeFormDefinition.ts),
  [supabase/publish_intake_form.sql](../supabase/publish_intake_form.sql),
  [supabase/intake_demo_seed.sql](../supabase/intake_demo_seed.sql): `guardian_email`
  → `label: "Email address"`, `required: true`, new `help` string; consent label
  → "OneLife Church"; `confirmation.body` → the new text. Field **ids** untouched.
- [x] `FamilyForm.tsx` hardcoded confirmation fallback string kept in sync.
- [x] `validate.ts` email message: "...or leave it blank" only when the field is
  optional; a required email that is malformed says "Please enter a valid email
  address." (blank still hits the generic "Email address is required.")
- [x] Server enforcement needs **no migration** — `intake_validate_field` reads
  `required` from the pinned definition, same path US-30/US-31 relied on. Known
  cosmetic nit: the SQL function's own email-format message still ends "...or
  leave it blank"; it only surfaces if client JS is bypassed AND a malformed
  address is sent, so it's left for the next intake migration rather than opening
  a reach-reviewer gate now.
- [x] e2e helper `web/tests/e2e/helpers/intake.ts` now fills `guardian_email`
  (defaults to `family@demo.example.com`) so the walkthrough specs still pass.
- [x] `tsc` / `eslint` / `next build` clean.
- [ ] **dev publish:** Grant runs `supabase/publish_intake_form.sql` on dev to
  cut **form-version v3**. Existing registration links stay pinned to v2 until
  new ones are created; re-run `intake_demo_seed.sql` (or make a fresh link) to
  demo the new wording.
- [ ] **dev only; prod untouched.** No migration, no RLS/view/function change →
  no reach-reviewer gate; code-reviewer pass before Done.
- [ ] Spanish: the new email help text and confirmation body need a fluent
  translation before an ES form version ships (tracked in INTAKE_FORM_DRAFT.md).

Status: **Built on `dev` this session** (not yet committed at time of writing).
`tsc` / `eslint` / `next build` clean; both SQL definition blobs re-parsed and
verified byte-consistent with the TS copy. Outstanding: commit + push, dev
publish by Grant, code-reviewer pass, and the app-wide "Reach Church" follow-up.

**Update 2026-09-29:** the "Reach Church" follow-up is done for everything a
counselor sees: `RosterCard.tsx` (4 strings), `RosterView.tsx`, and
`PublicShell.tsx`'s dead-review-link page now say "OneLife Church". Two
leftovers, both out of that scope: one staff-only sentence in
`SubmissionDetail.tsx` ("Reach doesn't create a household…"), and the server's
own copy of the reject-reason message in `reject_submission`
(20260830120000), which only shows if the page's check is bypassed and needs a
migration to change. The Spanish checkbox above is covered by US-45's draft
translation, pending native-speaker review.
Owner: (built this session) — frontend-designer surface + the two intake SQL
files. Files: [web/lib/intakeFormDefinition.ts](../web/lib/intakeFormDefinition.ts),
[web/app/form/[token]/FamilyForm.tsx](../web/app/form/[token]/FamilyForm.tsx),
[web/app/form/[token]/validate.ts](../web/app/form/[token]/validate.ts),
[supabase/publish_intake_form.sql](../supabase/publish_intake_form.sql),
[supabase/intake_demo_seed.sql](../supabase/intake_demo_seed.sql),
[web/tests/e2e/helpers/intake.ts](../web/tests/e2e/helpers/intake.ts).

---

## US-40: Shopping list shows child sizes, not the sponsor

As the shopping team buying gifts (including clothes) off the volunteer notes, I
want each row on the shopping list to show the child's age, gender, and sizes,
and I don't need the sponsor's name there.

Requested by Grant, 2026-09-09.

Acceptance criteria:
- [x] `/admin/shopping-list` rows keep first name + card ID and add a line: age,
  gender ("M"/"F" rendered "Boy"/"Girl" via `displayChildGender`; other values
  pass through), shirt / pant / shoe size. Missing values are omitted, not shown
  blank.
- [x] Sponsor name removed from the row. `ShoppingListRow.sponsorName` dropped
  from `getShoppingList` (nothing else read it); the "claimed Nd ago" line stays.
- [x] Staff/admin surface only — no change to `public_available_cards` or any
  anon path. Confidential children never reach this list (`claim_card` refuses
  confidential cards), and the first-name redaction that was already here is
  untouched.
- [x] `tsc` / `eslint` / `next build` clean. No shopping-list e2e exists to update.
- [ ] **dev only; prod untouched.** No migration / RLS / view change → code-reviewer
  pass before Done, no reach-reviewer gate.

Status: **Built on `dev` this session** (not yet committed at time of writing).
Owner: (built this session) — frontend-designer surface. Files:
[web/app/admin/shopping-list/page.tsx](../web/app/admin/shopping-list/page.tsx),
[web/lib/queries.ts](../web/lib/queries.ts).

---

# Epic: Automated counselor email (US-41 … US-43)

Today every link reaches a counselor by hand: a staff member opens
[FormLinkPanel](../web/app/admin/submissions/FormLinkPanel.tsx), clicks Copy,
and pastes into their own mail client. That works and **must keep working** —
[INTAKE_FORMS §11](INTAKE_FORMS.md#11-operational-risks) says to build the
manual fallback on day one and assume you'll need it. This epic adds sending
*from the app* alongside it, so a 12-school drive isn't two dozen hand-written
emails, and so "did they ever open it" is answerable without asking.

The infrastructure already exists and is proven: `request_claim_code()` sends
the sponsor's verification code through **pg_net → Resend** with the API key in
**Supabase Vault**
([20260818160000](../supabase/migrations/20260818160000_email_verified_claims.sql)).
Three more facts make this small rather than large:

- `schools.liaison_email` exists and is captured on the Add School form.
- `review_tokens.token` is stored in plaintext as of US-28 and is admin-readable,
  so a database function can read the link itself — the token never passes
  through the browser.
- `review_tokens.last_used_at` already records whether the counselor opened it.

Planned 2026-09-23 with Grant. Phasing: US-41 (send on demand) and US-42 (daily
digest) this season; US-43 (sponsor lifecycle) is the separate, larger piece
that shares the same plumbing.

### Prerequisite for all three: a verified sending domain · **Grant, ops**

Every send today goes out as `Reach Christmas <onboarding@resend.dev>` — Resend's
shared sandbox sender, carrying a `TODO(Grant)` since
[20260818160000](../supabase/migrations/20260818160000_email_verified_claims.sql).
It limps along for sponsor codes to consumer inboxes. It will **not** survive a
school district's mail filter, and §11 names that as the single biggest practical
threat: a review link in quarantine is indistinguishable from a counselor
ignoring you.

Decision (Grant, 2026-09-23): **verify a real OneLife domain in Resend** — SPF,
DKIM and DMARC on the church domain or a `mail.` subdomain. Needs DNS access.
This is an ops task, not code, and it fixes sponsor claim emails at the same
time. US-41/US-42 can be built and tested on dev against the sandbox sender, but
neither is *usable for real counselors* until this lands. The swap is one string
in one migration.

Update (2026-10-19): still no domain. The roster's "Email all assigned" /
"Remind all assigned" (send-sponsor-emails Edge Function) read their sender
from the function's `EMAIL_FROM` secret instead of a hard-coded string, so for
those it's `supabase secrets set EMAIL_FROM="Reach Christmas <...@domain>"`,
per project, with no migration. The older plpgsql senders (claim code,
counselor emails) and send-sponsor-card-email still hard-code
`onboarding@resend.dev` and need the one-string swap. Until the domain is
verified, Resend's sandbox sender delivers only to the Resend account owner's
own address, so sponsor emails can be tested on dev but won't reach real
sponsors.

Also on the onboarding list from §11: have counselors allowlist the sending
address before the drive opens.

---

## US-41: Email a school's links to its counselor from the app

As staff setting up a school, I want to send that school's counselor their
registration link(s) and their review link from the links page, and then see
what was sent and when, so that link distribution isn't two dozen hand-written
emails and silent failures aren't invisible.

Requested by Grant, 2026-09-23.

Decisions (Grant, 2026-09-23):
- **Three independent buttons, not two.** Registration splits by locale —
  "Email English link" and "Email Spanish link" are separate sends, each
  including every live `family`-channel link for that school in that locale.
  A school might have only one language live, and a counselor who only handles
  one shouldn't get both bundled into a single message. Review stays a single
  button — `review_tokens` carries no locale of its own (the counselor roster
  is a staff-side confirmation view, not a translated family-facing form), so
  there is only ever one thing to send.
- **Recipient is `schools.liaison_email` only** — never a free-text address box.
  An admin-only function that cannot be pointed at an arbitrary inbox closes the
  abuse hole OPEN_QUESTIONS **SPN-4** flags on `request_claim_code` (unbounded
  sends to any address a caller names). A wrong address is fixed by editing the
  school record.
- **The copy buttons stay.** The manual fallback is a requirement, not a leftover.

Acceptance criteria:
- [x] Migration (dev only, **reach-reviewer gate required** — new functions read
      `review_tokens`/`form_links`, new table, new outbound path):
      [20260923120000_counselor_email_links.sql](../supabase/migrations/20260923120000_counselor_email_links.sql).
  - `app_settings` — a one-row config table holding `site_url`. Nothing in the
    database knew the site's own origin before this; `formPath()`/`reviewPath()`
    return relative paths built client-side. Chose a plain admin-RLS'd table over
    a Vault secret since this isn't a secret, just per-environment config. **No
    admin UI yet** — set once via SQL, same as the Resend Vault key:
    `update app_settings set site_url = '...';`. **Grant still needs to run this
    on dev before any send will work.**
  - `counselor_emails` log table: `drive_school_id`, `kind`
    (`registration_link` | `review_link` | `review_digest`), `locale`, `sent_to`,
    `sent_by`, `created_at`, and which link(s) were included (`form_link_ids` /
    `review_token_id` — a reference, not a second copy of the plaintext token).
    One row per send, not a timestamp column on `review_tokens`/`form_links` —
    staff need "sent three times," and US-42 writes to the same table with kind
    `review_digest`. RLS mirrors `review_tokens` (`is_admin()`, plus
    `can_view_confidential()` for a null-school row, though this feature never
    produces one); audited like every other table here.
- [x] `send_counselor_registration_link(p_drive_school_id, p_locale)` and
      `send_counselor_review_link(p_drive_school_id)` — security definer,
      `is_admin()` re-checked in the body, explicit `search_path`, execute revoked
      from `public`/`anon` and granted to `authenticated` only (SCHEMA.md §12.2).
      Each reads the school, its liaison email, and its own live link(s); composes
      the body; fires `net.http_post` to Resend exactly as `request_claim_code`
      does; writes the log row. The Vault key is fetched **before** any write —
      that ordering bug is already fixed once in 20260818160000, because an
      uncaught raise rolls back the whole invocation.
- [x] Refuses, with a message naming what is missing, when: the school has no
      `liaison_email`; there is no live link of that locale/kind; `site_url` is
      not configured; or the same kind+locale went to the same school in the
      last 60 seconds (double-click guard, same shape as the claim-code cooldown).
- [x] **No child data in either email.** School name, the link(s), what each is
      for, and who to reply to. Nothing else. A counselor's review link is already
      a key to that school's roster; the email must not add to it.
- [x] `sendCounselorRegistrationLink(driveSchoolId, locale)` /
      `sendCounselorReviewLink(driveSchoolId)` / `listCounselorEmails(driveId)` in
      [web/lib/intake.ts](../web/lib/intake.ts).
- [x] [FormLinkPanel.tsx](../web/app/admin/submissions/FormLinkPanel.tsx): a
      "Counselor email" block per school — "Email English link" / "Email Spanish
      link" / "Email review link", each disabled with an explanatory line when
      there's nothing live to send or no liaison email (linking to
      [/admin/schools](../web/app/admin/schools/page.tsx) to add one).
- [x] The status line, not the button, is the point: **"Emailed Sept 24 to
      counselor@school.org."** For the **review** link only, also **"· opened"**
      or **"· not opened yet"**, from `review_tokens.last_used_at` — the one link
      that column actually exists on. `form_links` has no equivalent "opened"
      signal (a family visiting `/form/[token]` never touches the row, only an
      actual submission does), so the registration-link status line stays
      honestly limited to "sent," not "opened."
- [x] e2e: a non-admin is refused; a school with no liaison email is refused; a
      successful send writes exactly one log row with the right kind/locale and
      recipient; sending the same kind twice within 60s is refused. Delivery
      itself is not assertable — `pg_net` is fire-and-forget (below), so the test
      stops at "the request was queued and logged."
      → [web/tests/e2e/counselor-email.spec.ts](../web/tests/e2e/counselor-email.spec.ts).
      **Green against dev, 2026-09-23** (6/6 for this story — individually
      confirmed; the review-link-send test and its own cooldown re-fire if run
      twice inside 60s of each other, which is the guard working as designed,
      not a flake). Rewritten to not depend on `intake_demo_seed.sql` at
      all — Grant had real, non-test work
      sitting on dev (two real schools, three real families) and didn't want
      to touch it to re-seed, and the suite's own dependency on the demo seed
      turned out to be incidental, not load-bearing. It now creates its own
      throwaway fixture schools (deleted in `afterAll`) for the registration-
      link cases, plus one small **persistent** fixture school — "AutoTest
      CounselorEmail ReviewFixture", clearly labeled, never deleted — for the
      review-link case, because `review_tokens` rows can never be deleted once
      issued (SCHEMA.md) so a fresh one every run would strand a new orphaned
      school each time. That fixture will sit in the schools dropdown from now
      on; harmless, and named so nobody mistakes it for a real one.
- [x] `tsc` / `eslint` / `next build` clean.
- [x] **Migration applied to dev** (Grant, 2026-09-23).
- [ ] **dev only; prod untouched** until a Software Acceptance Review, the same
      rule as every intake migration.

Two caveats written into the migration header so reach-reviewer isn't surprised:

- **`pg_net` is fire-and-forget.** It queues the request and returns a request id,
  not the HTTP response. Nothing here knows whether Resend accepted the mail, let
  alone whether the district delivered it. The sent/opened line is the cheap 80%
  answer. Real bounce handling needs a Resend webhook endpoint, and the Next app
  has **zero route handlers and no server actions** today — that is a genuinely
  new surface and it is deliberately out of scope.
- **`pg_net` persists request bodies** in its own `net` schema tables, so a
  review-link send's request body carries that token in plaintext alongside the
  Resend key. That is the same exposure class US-28 accepted deliberately when it
  started storing the token in plaintext for re-copying — consistent rather than
  new, but stated here rather than left for review to find.

Not done (deliberate):
- **No free-text recipient**, no cc field. See the decision above.
- **No bounce or delivery webhook.** Out of scope; needs a server route.
- **No unsubscribe.** These are transactional messages to a partner the church
  already has a relationship with. US-42's recurring digest is where an opt-out
  becomes a fair question.
- **No admin settings UI for `site_url`.** One-time SQL for now (see above).

Status: **Migration applied to dev, `site_url` set, e2e green — 2026-09-23.**
`tsc`/`eslint`/`next build` clean. Dev IS deployed —
`https://reach-christmas.vercel.app` (Vercel's Production Branch is
deliberately `dev`, confirmed with Grant 2026-09-23; verified independently by
finding `thvyntrxmahygesltgft.supabase.co` — the dev project id — baked into
that deployment's JS bundle). Grant ran
`update app_settings set site_url = 'https://reach-christmas.vercel.app';`.
6/6 e2e green live against dev (see the checkbox above — the suite no longer
needs `intake_demo_seed.sql`). Still to do before Done: **reach-reviewer
gate** (mandatory — new function reads `review_tokens`), code-reviewer pass,
and Grant's sending-domain work before any send is relied on for a real
counselor.

**Season decision (Grant, 2026-09-29):** counselor links go out **by hand** this
season (copied from the Registration links panel). The sending-domain work is
deferred, so nothing relies on the app's counselor emails; the church's own filter
already blocked Supabase invite emails the same day. US-42's digest is paused for
every school to match.
Owner: database-engineer (migration + functions + `web/lib`), frontend-designer
(the panel controls and status line), reach-reviewer (mandatory gate), Grant
(the sending domain, the `site_url` value — done: applying the migration).

---

## US-42: Daily "households waiting for your review" digest

As a counselor in November with a day job, I want one email a day telling me how
many households are waiting on me and linking straight to my review page, so that
confirming registrations doesn't depend on someone at the church chasing me.

Requested by Grant, 2026-09-23. [INTAKE_FORMS §11](INTAKE_FORMS.md#11-operational-risks)
specifies this shape directly: a **daily digest**, never one email per submission
— "one email per submission means forty emails to a counselor with forty
families." §11 also calls counselor follow-up a first-class workflow and asks for
the "N families waiting since [date]" report early.

Depends on US-41 (the send path, the log table, `site_url`, the verified domain).

Acceptance criteria:
- [x] Migration (dev only, **reach-reviewer gate required**):
      [20260923130000_counselor_email_digest.sql](../supabase/migrations/20260923130000_counselor_email_digest.sql).
  - `pg_cron` enabled. Supabase supports it; **nothing else in this repo uses
    it**, so this is a new operational dependency — the migration fails loudly
    at `create extension` time rather than degrading silently, the same way
    20260818160000 did for `pg_net` and Vault.
  - `send_counselor_digests()` — one run, iterating schools.
- [x] **The security shape is the hard part and needs calling out.** `pg_cron`
      invokes as a privileged role with no `auth.uid()`, so this function cannot
      be `is_admin()`-gated the way US-41's are. It takes **no caller-supplied
      parameter that chooses a recipient**, has execute revoked from `public`,
      `anon` **and** `authenticated`, and derives every address from
      `schools.liaison_email`. Its blast radius if it ever became callable is
      then "sends the digest it was going to send anyway." Built the
      admin-triggered variant too — `send_counselor_digests_now()`, is_admin()-
      gated, no recipient parameter either, just runs the identical school loop
      on demand — so staff and tests don't have to wait on the clock.
- [x] Digest content per school: the count of submissions in `submitted` or
      `under_review` for that `drive_school_id` (the two states the counselor
      owns — `verified` they have already confirmed, `imported` is staff's, see
      [shared.ts](../web/app/admin/submissions/shared.ts)), the date of the
      oldest one still waiting, and their review link. **Counts and dates
      only — no child names**, unlike the roster the link itself opens.
- [x] **Sends nothing when nothing is pending.** No "0 waiting" mail, ever
      (`continue when v_count = 0`). Skips schools with no liaison email, no
      live review link, a paused school, or a drive that is not open. Writes a
      `counselor_emails` row with kind `review_digest` per send.
- [x] A per-school **`digest_paused`** column on `drive_schools` (per-drive, not
      per-school — same reasoning as `distribution_method` already living
      there), surfaced as a checkbox in the links panel next to each school's
      counselor-email block. `setSchoolDigestPaused()` in
      [store.tsx](../web/lib/store.tsx) — a plain RLS-gated table write, no new
      function needed; this isn't a security boundary, just a preference the
      digest reads.
- [x] Staff-side view of the same numbers — "N household(s) waiting since
      [date]" per school in the links panel, next to the US-41 send controls.
      Computed client-side in
      [SubmissionsQueue.tsx](../web/app/admin/submissions/SubmissionsQueue.tsx)
      from the `submissions` list it already loads — no extra query. §11 asks
      for this report in its own right, and it is how staff know whether the
      digest is working.
- [x] e2e: `send_counselor_digests()` itself is refused for every authenticated
      caller, admin included (proves the security shape above, not just
      documents it); `send_counselor_digests_now()` refuses a non-admin; an
      admin-triggered run emails a school with a pending submission and stamps
      `sent_by null` (the cron-shaped signature); a paused school is skipped
      even with a pending submission. A "0 pending → no send" case is covered
      implicitly (fixture schools that never receive a submission never appear
      in a digest run) rather than asserted directly.
      → [web/tests/e2e/counselor-email.spec.ts](../web/tests/e2e/counselor-email.spec.ts).
      **Green against dev, 2026-09-23** (4/4 for this story). One thing this
      run surfaced worth flagging rather than fixing here: because
      `send_counselor_digests_now()` runs the real, global loop — every school
      in the drive, not just a fixture — calling it from a test is only safe
      *because* neither of Grant's two real schools currently has a submission
      in `submitted`/`under_review`. If one ever does while these tests run,
      it WOULD also get a real digest. Noted in the spec's own comment; not a
      reason to change the function, since "digest whoever is actually
      pending" is exactly what it's supposed to do.
- [x] **5-minute-minimum per-school cooldown on `send_counselor_digests()`**
      (Grant, 2026-09-23, found while writing the e2e above — not in the
      original acceptance criteria). Same idea as the 60s guard on the two
      US-41 send functions, longer window since this one can fire unattended:
      skip (not raise — this loop has no caller to report an error to) a
      school whose most recent `review_digest` row is under 5 minutes old,
      checked per school inside the loop so one school's cooldown never blocks
      another's. Lives entirely in `send_counselor_digests()`, so it covers
      both the daily cron call and `send_counselor_digests_now()` from one
      place — no change needed to the admin-triggered wrapper.
      → [supabase/migrations/20260923140000_digest_cooldown.sql](../supabase/migrations/20260923140000_digest_cooldown.sql).
      **Written, not yet applied to dev.**
- [x] `tsc` / `eslint` / `next build` clean.
- [x] **Migration applied to dev** (Grant, 2026-09-23) — the original
      `20260923130000`; the cooldown follow-up (`20260923140000`) above is
      still pending.
- [ ] **dev only; prod untouched.**

~~Open — needs an answer before this is relied on:~~
- ~~**What hour, in what timezone?**~~ **Resolved** (Grant, 2026-09-23): Central
  US. `13:00 UTC` (already the value in the migration) lands at 7:00 AM CST
  Nov-Mar — the bulk of the season this digest actually matters for — or
  8:00 AM CDT the rest of the year. Good enough either way; not adjusted twice
  a year for one hour of drift.
- **Deadline reminder.** §11 pairs the digest with "immediate sends reserved for
  their first submission and the deadline reminder." The deadline reminder is a
  natural third `kind` on the same table — in this story or the next one?
- ~~**No per-school cooldown on `send_counselor_digests()`/`_now()`**~~
  **Resolved** (Grant, 2026-09-23) — see the acceptance criterion above.

Status: **`20260923130000` applied to dev, e2e green — 2026-09-23.** The
`20260923140000` cooldown follow-up is **written but not yet applied** — the
e2e run below confirms it isn't live yet (its cooldown assertion currently
fails, exactly as expected against the un-patched function; will re-verify
once applied). `tsc`/`eslint`/`next build` clean. 9/10 e2e green live against
dev (the 10th is the pending-cooldown assertion above).

**Cron infrastructure confirmed live** (Grant, 2026-09-23): `pg_extension`
shows `pg_cron` version 1.6.4 genuinely enabled (not just the extension's SQL
objects present with the background worker never loaded — a real risk on
Supabase specifically, since `create extension pg_cron` via raw SQL doesn't
always imply the worker is running the way toggling it on in the dashboard
does), and the `counselor-review-digest` job is registered in `cron.job`.
Neither is checkable from this session — PostgREST only exposes the `public`
schema, so `cron.*` is invisible to any client-side/test-account query; both
had to be confirmed by Grant directly in the SQL Editor / dashboard.

Still to do before Done: apply `20260923140000`, re-verify that test goes
green, **reach-reviewer gate** (mandatory — new always-on scheduled job with
database-wide reach, and the cooldown migration is a second
`create or replace` on that same function worth a second look), code-reviewer
pass.
Owner: database-engineer (cron + function + `web/lib` — done, live-verified
except the cooldown migration), frontend-designer (pause toggle, waiting-count
line — done), reach-reviewer (mandatory gate).

**Season decision (Grant, 2026-09-29):** paused for every school
(`update drive_schools set digest_paused = true where drive_id = <open drive>`),
since it sends from the same unverified address as US-41. Turn it back on per
school from the Registration links panel once the church email domain is set up.

---

## US-43: Sponsor lifecycle emails (placeholder — not yet scoped)

The answer Grant already gave to OPEN_QUESTIONS **SPN-6**: "1. Thanks for signing
up, here's who you volunteered to buy for 2. Reminder 1 week until due 3. Reminder
1 day out 4. if overdue, emails should go out again."

Same Resend/Vault/pg_net path, the same `pg_cron` dependency as US-42, and the
same verified-domain prerequisite — which is the argument for designing US-41's
`counselor_emails` table as a reusable outbound log (a `kind` column, a nullable
subject reference) rather than something counselor-shaped that has to be rebuilt.
Today the only follow-up mechanism is the "Sponsors running late" table on the
dashboard, which a human has to read and act on.

Not scoped here. Written down so US-41's schema is chosen with it in mind.

**Scoped for 2026 (Grant, 2026-09-29): one thank-you email only.** Sent when a
claim is confirmed: who they're buying for (first name, grade), the wish list and
sizes, and drop-off instructions. The 1-week, 1-day and overdue reminders wait
until after the season; staff follow up late sponsors by phone (OPEN_QUESTIONS
ADM-11). It rides the same email path as the claim-code email, which already
reaches sponsors on dev.

Acceptance criteria (2026 scope):
- [x] Drop-off location, hours and deadline from Grant. Location is real
  (Grant, 2026-09-30): "OneLife Church, at the Reach Christmas table." Days and
  deadline aren't decided yet ("any service on X or X days" / "by Y time") — per
  the US-46 shop-day-panel lesson, these are NOT baked into the migration as
  `[placeholder]` text in the email copy. They're two `app_settings` columns
  (`dropoff_days`, `dropoff_deadline`, alongside the existing `site_url`) with an
  honest "not set yet" default; Grant sets the real values with one `UPDATE`, no
  new migration needed.
- [x] Email sent once per confirmed claim, from the same function that confirms
  the code (`claim_card_with_code`), containing only what the sponsor already saw
  on the card.
- [x] Nothing a sponsor never sees (last name, school, address) goes in it —
  pulls the exact same column whitelist `public_available_cards` uses.
- [x] reach-reviewer gate (new outbound email carrying child details). **PASSED,
  2026-09-30** — no blocking findings. One follow-up opened: OPEN_QUESTIONS
  **DB-29** (`claim_card_with_code` doesn't re-check `is_high_schooler`/`held_at`
  the way `public_available_cards` does — pre-existing, not introduced here, made
  slightly more consequential by the new PII-bearing email on that path). One nit
  fixed inline (a header comment overstated "byte-for-byte unchanged" for the
  untouched portion of the function; reworded).

Status: **In review** — built this session on `dev`.
[supabase/migrations/20260930120000_sponsor_thank_you_email.sql](../supabase/migrations/20260930120000_sponsor_thank_you_email.sql).
Best-effort by design: the email step is wrapped in its own exception handler so
a Vault/`app_settings`/pg_net hiccup can never turn a successful claim into a
failure — see the migration's header comment. Also updates
[web/app/sponsor/SponsorBrowser.tsx](../web/app/sponsor/SponsorBrowser.tsx)'s
post-claim banner, which previously said "in the real app you'd get a
confirmation email" — that was a leftover placeholder; it now reflects that the
email is real. `tsc` / `eslint` clean.
**Applied to dev by Grant, 2026-09-30. Not applied to prod** (waits on a
Software Acceptance Review, same as every other intake/claim migration). Still
outstanding: set the real `dropoff_days`/`dropoff_deadline` via `UPDATE
app_settings` once Grant has them (currently the honest "not set yet"
placeholder), and run the migration's own VERIFY section end to end — claim a
real card as a genuinely signed-out client, confirm the thank-you email arrives
with only sponsor-visible fields, confirm `sponsor_emails` gets a row, confirm a
claim still succeeds if the Vault key is temporarily missing.
Owner: built in a Claude session; reach-reviewer gate PASSED.

---

## US-44: Family form copy from the counselor review (no-contact reassurance, one form per household)

As a parent, I want to know sponsors can't contact me and that I only fill out
one form even if my kids go to different schools, so registering feels safe and
I don't register twice.

Requested by Grant, 2026-09-29, from Brittany Stuessy's review of the form PDFs
(email thread 2026-09-23).

Acceptance criteria:
- [x] `privacy_note` adds that sponsors never see contact information, have no
  way to contact the family, and only the school counselor follows up.
- [x] `intro` gains a paragraph: a household whose children attend different
  schools and receive the link from more than one counselor fills out only one
  form.
- [x] Same text in all synced copies (`web/lib/intakeFormDefinition.ts`,
  `supabase/publish_intake_form.sql`, `supabase/intake_demo_seed.sql`) and in
  Spanish (US-45). Field ids untouched.
- [ ] dev publish: re-run `intake_demo_seed.sql` so the demo link shows it.
- [ ] code-reviewer pass.

Status: **In review** — commit `4634f0f` on `dev`, live on the dev site. No
migration, no RLS/view/function change, so no reach-reviewer gate.
Owner: built in a Claude session (form definition + the synced SQL copies).

---

## US-45: Spanish family form with a live English/Español toggle

As a Spanish-speaking parent, I want to read and fill out the whole registration
form in Spanish from the same link my counselor sends, so I don't need a
separate link or help from someone who reads English.

Requested by Grant, 2026-09-29. Replaces INTAKE_FORMS.md §4.1's
locale-objects-per-field design with a sibling definition plus a toggle; see
that section's note.

Decisions (Grant, 2026-09-29):
- **One link, a toggle at the top of the page**, not a separate Spanish link.
  The "what language should we contact you in" field is pre-filled to match the
  toggle but stays editable.
- **Separate Spanish-link creation is hidden**, not removed:
  `SPANISH_LINK_CREATION_ENABLED = false` in `FormLinkPanel.tsx` hides the
  Spanish questionnaire choice and "Email Spanish registration link", so
  volunteers can't send a Spanish-only link by accident.
- **Inline validation messages and the "(optional)" badge stay English** for
  now (`validate.ts`, `fields.tsx`).
- **Every future form-copy change lands in both languages** (four synced
  copies: two definitions × TS + SQL).

Acceptance criteria:
- [x] `PHASE_1_FORM_DEFINITION_ES`: full Spanish translation, same field ids and
  option values as English, mirrored byte-for-byte in
  `supabase/publish_intake_form_es.sql` and the Spanish block of
  `supabase/intake_demo_seed.sql`.
- [x] `FamilyForm.tsx` toggle swaps every definition-driven string plus the page's
  own text (lives-together gate, buttons, error summary headings, confirmation,
  shop-day note).
- [x] The toggle re-words the link's own pinned version (`translateDefinition`
  in `web/lib/intake.ts`, 2026-09-29): structure always comes from the pinned
  version, so a link created before a later form change can't show a question
  set that differs from what `submit_form` validates. Checked against a
  simulated pre-change link (pickup question still required, stays in English).
- [x] `generate-form-pdfs.mjs` produces a Spanish PDF set via the toggle.
- [x] `publish_intake_form_es.sql` run on dev by Grant 2026-09-29.
- [ ] Native or fluent speaker review of the Spanish (Seth Saldivar or
  Stephanie Williams) before any real family sees it (INTAKE_FORMS §4.4).
- [x] Free-text answers (wish list, needs, notes) arrive in Spanish. Decided
  (Grant, 2026-09-29): the office retypes them in English on the household page
  after import, before the cards reach sponsors. Translate-at-import
  (INTAKE_FORMS §4.2) stays unbuilt this season.
- [ ] Server-side validation messages (`intake_validate_field`) are English only.
- [ ] code-reviewer pass.

Status: **In review** — commit `4634f0f` (translation, toggle, hidden Spanish-link
UI) plus the 2026-09-29 toggle fix, on `dev`. No migration, no RLS/view/function
change.
Owner: built in a Claude session (form definition, `FamilyForm.tsx`,
`FormLinkPanel.tsx`, the synced SQL copies, the PDF script).

---

## US-46: School drop-off distribution — the form tells families how gifts reach them

As the drive, I want the form to match how gifts actually get to families this
year, so nobody plans a trip to the church that isn't needed.

Decided by Grant, 2026-09-29 (resolves DESIGN.md §8's distribution question and
OPEN_QUESTIONS DOC-2): the church collects gifts from sponsors as usual, then
delivers each family's gifts to their school counselor at the school. The
counselor coordinates with each family on how they receive them. No family
comes to the church for an elementary child's gift.

Acceptance criteria:
- [x] The "If gifts are distributed at the church, can you get there?" question
  (`can_reach_church_pickup`) is removed from both languages and all synced
  copies. The section id `pickup_consent` is unchanged; its title becomes
  "Delivery and consent" / "Entrega y consentimiento" with a line that the
  counselor coordinates how each family receives the gifts.
- [x] `families.can_reach_church_pickup` stays in the schema, unused, rather than
  migrated away; new imports write NULL (noted in `intake_demo_seed.sql`'s
  import-contract comment; `intake-walkthrough.spec.ts` now asserts NULL).
- [x] Shop-day note names no store or date: the counselor reaches out with the
  details closer to Christmas. `SHOP_DAY_STORE` / `SHOP_DAY_DATE` removed.
- [x] `supabase/set_distribution_school_dropoff.sql` sets the drive and every
  school to `school_dropoff`; run on dev by Grant 2026-09-29.
- [x] Six e2e specs/helpers updated for the removed field.
- [x] Run the e2e suite: intake/counselor/security specs 56/56 green on dev, 2026-10-19.
- [x] dev publish (2026-10-19): ran `publish_intake_form.sql` (EN v4) and
  `publish_intake_form_es.sql` (ES v2), then the new
  `supabase/repoint_form_links_to_latest.sql` to move all 5 live links off
  the Sept 9 v3 (which still asked the church-pickup question). Links keep
  their URLs. On prod, run the same three in that order.
- [x] Recording deliveries, decided (Grant, 2026-09-29): existing screens, no code
  change. Mark each gift Delivered on the Fulfillment board, and use Check in on
  the Distribution page to mean "handed to the counselor".
- [ ] code-reviewer pass.

Status: **In review** — commit `810619c` on `dev`, live on the dev site. No
migration, no RLS/view/function change.
Owner: built in a Claude session (form definition, `FamilyForm.tsx`, the synced
SQL copies, e2e helpers).

---

## US-47: Counselor-entered registrations go through the counselor's own review

As a counselor entering a family over the phone, I want my entry to show up on my
own review list for a confirm click, so nothing reaches the church unreviewed and
no volunteer can post a registration that skips review.

Decided by Grant, 2026-09-29 (OPEN_QUESTIONS ADM-20, the third option). Today a
`counselor`/`staff` channel link auto-verifies at submit, and any signed-in user
can read its token. The staff screen already can't create one (US-27).

Acceptance criteria:
- [ ] Counselor/staff channel submissions no longer auto-verify; they land as
  submitted, like a family's.
- [ ] They appear on that school's review list, marked as entered by the
  counselor, for the same confirm or "This isn't right" step.
- [ ] Staff can create a counselor-direct link in the Registration links panel
  only once the above ships.
- [ ] reach-reviewer gate (changes `submit_form`'s channel handling).

Status: **Backlog** — decided, not started.
Owner: database-engineer (`submit_form`), frontend-designer (roster marker, link
creation).

---

## US-48: Data-safety fixes before launch

Four bugs the reviewer found, all confirmed still in the code on 2026-09-29.
Grant decided to fix all four before launch.

Acceptance criteria:
- [ ] **DB-10:** saving a wish list is one database call that replaces the items
  in a single transaction, so a failed save leaves the old list intact.
- [ ] **DB-8:** adding a child assigns `child_index` inside the database under a
  lock, like `create_family()`, so two people adding siblings at once can't
  half-save.
- [ ] **DB-15:** the Fulfillment board and Shopping list skip an assignment whose
  card or child isn't visible instead of crashing the page.
- [ ] **US-14:** its three acceptance criteria (a failed background refresh keeps
  what the volunteer typed).
- [ ] reach-reviewer gate for the two new database functions; e2e green.

Status: **Backlog** — decided, fix before launch.
Owner: database-engineer (DB-8, DB-10), frontend-designer (DB-15, US-14).

---

## US-49: Edit a school in the app

As staff, I want to fix a school's name or liaison details on the Schools page,
so a changed phone number doesn't need raw SQL.

Decided by Grant, 2026-09-29 (OPEN_QUESTIONS ADM-4): edit only, no deactivate.

Acceptance criteria:
- [ ] An Edit action on the Schools page, modeled on the Drives page's Edit
  modal: name, liaison name, phone and email, and distribution method.
- [ ] The one-letter card code stays read-only once the school has households,
  since card numbers embed it.
- [ ] No schema change; e2e covers an edit.
- [ ] Added 2026-10-20 (staff handouts review): the replace-review-link dialog
  already tells staff to "correct the school's liaison email before you email the
  new link" (`FormLinkPanel.tsx:307-308`), which is impossible until this ships.
  Once Edit exists, make that sentence point at it ("Edit the school on Setup →
  Schools"). Then update the admin handout (`docs/handouts/admin-guide.html`, A3
  and the "Can't be undone" box) and re-render its PDF.

Status: **Backlog** — decided.
Owner: frontend-designer.

---

## US-50: Phone-size and signed-out privacy tests before launch

Decided by Grant, 2026-09-29 (OPEN_QUESTIONS SPN-5, TST-5, and the phone half of
TST-6). The rest of TST-6 waits until after the season.

Acceptance criteria:
- [ ] A Playwright phone-size project (for example 390px wide) that loads
  `/sponsor` and the family form: no horizontal scroll, and claiming and submitting
  are reachable one-handed.
- [ ] Anything that check finds on `/sponsor` is fixed (SPN-5: "absolutely this
  should be optimized for phone usage").
- [ ] A signed-out client gets zero rows from `children`, `families`,
  `assignments` and `wishlist_items`, and a confidential child never appears in
  `public_available_cards` (check `security.spec.ts` for what already exists
  first).

Status: **Backlog** — decided, before launch.
Owner: qa-tester (tests), frontend-designer (any phone fixes).

---

## US-51: Prod go-live checklist and applied-migrations ledger

Nothing has ever been applied to prod, and there's no record of what prod has
(OPEN_QUESTIONS DB-1, DB-25, DOC-1, DOC-3). Decided by Grant, 2026-09-29: after
the 2026-09-30 review passes, Claude writes the checklist and ledger and Grant
applies it.

Acceptance criteria:
- [x] A ledger file listing every migration with its dev and prod apply dates,
  built from backlog records. The headers of `20260903120000`,
  `20260923120000` and `20260923130000` still say "DEV: NOT YET APPLIED" though
  the backlog records them applied, so the ledger becomes the source of truth.
- [x] `20260923140000_digest_cooldown.sql` applied to dev first.
- [x] An ordered prod checklist: DEPLOY.md's Phase 0 audit, every migration in
  order (with ADM-3's backfill pre-check), the email key in Vault and `site_url`,
  publishing both form definitions, `set_distribution_school_dropoff.sql`, the
  digest paused, and the Vercel production branch and env vars.
- [ ] Grant confirms prod backups in Supabase → Database → Backups (DOC-3).

Status: **Docs done 2026-10-20; launch waits on the review.** Grant decided a
**fresh prod project** (the old one held only part of the July schema, found by
read-only probing) and an **email-off launch**. Written: docs/MIGRATION_LEDGER.md
(all 34 verified applied on dev; five stale headers corrected),
docs/PROD_LAUNCH_CHECKLIST.md, supabase/prod_setup.sql, DEPLOY.md Phase 0/5
pointed at the checklist. Found while writing it: a fresh project allows public
sign-ups and every new login is a volunteer, so the checklist turns sign-ups
off before any data (step 1.3). Backups (DOC-3) are checklist step 1.4.
Owner: Claude (checklist + ledger), Grant (applying it, backups).

---

## US-53: Counselor button to mark a gift has left the school

As a school counselor, I want a simple way to tell the team a family's gift
has left my building, so staff know distribution is actually done without
having to ask around or go on a phone update.

From the same 2026-10 meeting. **This reverses a decision Grant already
made on 2026-09-29** (OPEN_QUESTIONS ADM-7, backlog US-46): that distribution
tracking stays entirely staff-side — "Delivered" on the Fulfillment board,
"Check in" on the Distribution page meaning "handed to the counselor" — with
counselors getting no write access to any status at all. Today a counselor's
only touchpoint with this app is `/review/[token]` (confirming/rejecting
intake submissions); there's no token-scoped page or permission for anything
distribution-related. Confirm this reversal is intended before scoping
further — if so, this needs its own token type (mirroring `review_tokens`'
shape: hashed, scoped to one school, time-limited) and a new RLS-gated,
narrow write path (something like "mark household N's gift(s) left the
building" → sets a timestamp staff can already see on the Distribution page),
not a login.

Acceptance criteria:
- [ ] Decision confirmed with Grant: counselors get a new, narrow write
  capability (not just read), scoped to their own school only.
- [ ] A new token type (or a reuse of `review_tokens` with a new scope) and
  a `/distribution/[token]`-style page, unauthenticated like `/review`.
- [ ] One action: mark a household's gift(s) as left the building, writing
  to whatever field the Distribution page's "Check in" already reads (not a
  second, competing timestamp).
- [ ] RLS/function-level check that the token can only affect its own
  school's households.
- [ ] reach-reviewer gate (new unauthenticated write path touching
  distribution state).

Status: **Parked (maybe)** — Grant 2026-10-19: still a maybe, hold on to it.
Reverses a 2026-09-29 decision; needs explicit sign-off before starting.
Owner: database-engineer (token + RLS), frontend-designer (the page).

---

## US-54: Shopping list — mobile layout polish

As someone shopping at a store with the list open on my phone, I want the
page to be easy to use one-handed in the aisle, so I'm not fighting the
layout while holding a cart.

From the same 2026-10 meeting. `/admin/shopping-list` (`web/app/admin/
shopping-list/page.tsx`) is already a single-column card list rather than a
wide table, so it's not starting from zero — but nobody has actually opened
it on a phone and used it hands-on to confirm tap targets, text size, and
spacing hold up. (Note: a school filter is being added to this same page
separately, in parallel with this cleanup pass — see `getShoppingList` in
`web/lib/queries.ts` — so don't duplicate that part here.)

Acceptance criteria:
- [ ] Open `/admin/shopping-list` on an actual phone-width viewport and note
  concretely what's wrong today (small tap targets? cramped spacing? the
  "Mark verified" button too close to other text?) before changing anything.
- [ ] Fix whatever that review finds — likely larger touch targets and
  tighter vertical rhythm, not a structural rewrite.
- [ ] Re-test on the same viewport after the fix.

Status: **Deferred** — Grant 2026-10-19: wanted, but can wait. Needs an actual
hands-on-a-phone pass to know what specifically to fix.
Owner: frontend-designer.

---

## Epic: Staff-assigned sponsors (US-55–US-59)

Decided by Grant, 2026-10-15 (OPEN_QUESTIONS ADM-24, revised same day).
Lives on its own branch, **`feature/staff-assigned-sponsors`**, off `dev` —
`dev` keeps today's self-serve `/sponsor` page and claim flow exactly as-is
until/unless this branch merges. On this branch: no sponsor fills out a form
or provides their own email. Sign-ups happen in Church Center, entirely
outside this app; staff get that list out of Church Center and import it
here once. "The congregation" is simply that list — names, emails, phone
numbers for the volunteer sponsors who signed up — not a separate
campus/group category, so there's no `congregations` table in this version
(an earlier draft of this epic had one; dropped per Grant, 2026-10-15). The
existing self-serve RPCs (`request_claim_code`, `claim_card_with_code`,
`public_available_cards`) stay in the schema, just unused on this branch —
see US-59. These five stories are the scoped plan; none are started.

**Update (2026-10-19):** all five were built and landed directly on `dev`
(`d0ce0cb`), not on the feature branch, so `dev`'s `/sponsor` now shows the
Church Center link rather than the self-serve claim page.

## US-55: Sponsor roster data model — `sponsor_families`

As staff, I want the app to hold our own list of sponsor sign-ups (name,
email, phone), so children can be assigned against a real roster instead of
sponsors signing anything up themselves.

Acceptance criteria:
- [ ] New `sponsor_families` table, scoped per drive like `families`/
  `children`: id, drive_id, display_name, contact_email (nullable),
  contact_phone (nullable), capacity (nullable int — how many cards this
  entry expects to take), notes (staff-only free text), created_at,
  is_test_data. No congregation field or lookup table — the whole table
  *is* "the congregation" (one list, no sub-grouping).
- [ ] `sponsors` gains a nullable `sponsor_family_id` FK, set only when an
  assignment came from the roster (US-58) — today's self-serve claims leave
  it null. A roster entry's "assigned so far" is just a count of non-
  cancelled assignments through this link — no new counter column to keep
  in sync.
- [ ] RLS: staff/volunteer read-write, same shape as `schools`/
  `drive_schools` — this is sponsor contact info, not a child's, so no
  confidentiality gate applies. Audit trigger, same as every other table in
  this schema.

Status: **In review** — built and committed on `dev` in `d0ce0cb` (2026-10-19); its migration(s) applied to dev 2026-10-19. Prod untouched.
Owner: database-engineer.

---

## US-56: Admin sponsor roster page — import and manage

As staff, I want to bring our sponsor list into the app once, and keep
adding to it as more Church Center sign-ups come in, so the assignment
screen (US-57) has real entries to assign against.

Acceptance criteria:
- [ ] New admin page (e.g. `/admin/sponsors`) listing every `sponsor_families`
  row for the current drive: name, contact info, capacity, assigned-so-far
  vs. capacity.
- [ ] CSV import — columns: name, email, phone, capacity. Whatever export
  Church Center produces for staff gets reshaped to this by hand or by
  Katie's side of the process before upload; this story doesn't integrate
  with Church Center directly. Unlike `bulk-create-volunteers.mjs`, this is
  a plain in-app feature, not a terminal script — it never touches Supabase
  Auth or the service_role key, just an ordinary insert through RLS, so
  there's no reason to keep it out of the app the way account creation is.
- [ ] "Add one" form for stragglers who sign up after the bulk import, same
  pattern as "Add a household" on the family side.
- [ ] Edit an entry (fix a typo'd email, bump capacity) and mark one
  inactive without deleting it (keeps assignment history intact).

Status: **In review** — built and committed on `dev` in `d0ce0cb` (2026-10-19); its migration(s) applied to dev 2026-10-19. Prod untouched.
Owner: frontend-designer (page), database-engineer (import validation).

---

## US-57: Admin assignment screen

As staff, I want to pick a child and a sponsor-roster entry and assign them
to each other directly, so I control every match instead of a sponsor
picking themselves.

Acceptance criteria:
- [ ] New admin screen showing unassigned cards (the same pool as the
  Fulfillment board's "Unassigned" column) alongside the sponsor roster.
  Each card shows its household's school, grade, sex, and whether any
  siblings from the same household are already assigned and to whom — so
  staff can choose to keep a household with the same sponsor themselves,
  without the app forcing a matching algorithm on them in this first
  version.
- [ ] Pick a card, pick a roster entry, confirm — calls US-58.
- [ ] A roster entry at or over its stated capacity is visibly flagged, not
  hard-blocked — staff can still choose to go over on purpose.
- [ ] Confidential cards are excluded from this screen's query entirely
  (not just hidden in the UI), same guarantee `claim_card_with_code` already
  gives the public claim path.

Status: **In review** — built and committed on `dev` in `d0ce0cb` (2026-10-19); its migration(s) applied to dev 2026-10-19. Prod untouched.
Owner: frontend-designer.

---

## US-58: `assign_card_to_sponsor_family` — the staff-assignment write path

As the system, I need a staff-only way to create an assignment from a
roster entry instead of a sponsor's own claim code, so the existing
fulfillment board, shopping list, and thank-you email keep working
unchanged for a staff-assigned card.

Acceptance criteria:
- [ ] New `security definer` function, callable by staff/volunteers (same
  role check as other staff writes), taking a card id and a
  `sponsor_families` id. Refuses an already-claimed card and a confidential
  card, same checks `claim_card_with_code` already makes.
- [ ] Creates a `sponsors` row from the roster entry's info (tagged
  `sponsor_family_id`), then an `assignments` row exactly like today's claim
  path (`status = 'pledged'`, `claimed_at = now()`) — the fulfillment board,
  shopping list, and dashboard need zero changes; to them this is just
  another assignment.
- [ ] Fires the same best-effort thank-you + card-PDF email already built
  (`supabase/functions/send-sponsor-card-email`, wired in
  `20261015130000_sponsor_card_pdf_email.sql`) — reused as-is, not
  duplicated. Skipped silently if the roster entry has no email on file,
  same "degrade, don't fail" shape every email step here already follows.
- [ ] Audit-logged the same way `create_family` is.
- [ ] reach-reviewer gate (new write path onto `assignments`/`sponsors`;
  reuses the existing email step against a new data source).

Status: **In review** — built and committed on `dev` in `d0ce0cb` (2026-10-19); its migration(s) applied to dev 2026-10-19. Prod untouched.
Owner: database-engineer.

---

## US-59: Replace `/sponsor` with a link to the Church Center sign-up page

As a visitor who'd have landed on the old sponsor-browsing page, I want to
be sent to where sign-ups actually happen now, so I'm not looking at a
browse grid that no longer reflects how sponsoring works this season.

**Decided (Grant, 2026-10-15):** on this branch, `/sponsor` stops being the
self-serve browse/claim grid and becomes a simple page with a short
explanation and a link out to the Church Center sign-up page. `dev` is
unaffected — this only happens on `feature/staff-assigned-sponsors`, and
only takes effect app-wide if/when this branch merges.

Acceptance criteria:
- [ ] `/sponsor` (`web/app/sponsor/page.tsx`) replaced with a short static
  page: brief explanation that sponsoring is handled through Church Center
  this year, and a link/button out to the sign-up page.
- [ ] The Church Center URL is operator-set config, not hard-coded — a new
  `app_settings.church_center_signup_url` column (nullable, same "ordinary
  per-environment config" pattern as `site_url`/`dropoff_location`), with an
  honest "link not set yet" fallback shown instead of a dead/placeholder
  link if it's empty. Grant sets the real URL once with a plain `update`,
  no migration needed after the column exists.
- [ ] The old browse grid, its data-fetching (`SponsorBrowser.tsx` and
  friends), `public_available_cards`, `request_claim_code`, and
  `claim_card_with_code` are **not deleted** — just no longer linked to from
  anywhere. Confirmed nothing else in the app still links to the old
  claim flow from this new page.
- [ ] Confirm a card assigned via US-58 is excluded from
  `public_available_cards` the same way any claimed card already is (should
  be automatic — that view already excludes any card with an active
  assignment regardless of how it was created — but worth one explicit
  check, since this is the first time an assignment is ever created by a
  path other than `claim_card_with_code`).

Status: **In review** — built and committed on `dev` in `d0ce0cb` (2026-10-19); its migration applied to dev 2026-10-19. Prod untouched.
Owner: frontend-designer (page), database-engineer (`app_settings` column).

---

## US-60: Kill and replace a counselor review link

As staff, I want to shut off a counselor review link that was shared by mistake
and issue a new one, without raw SQL, so a leaked link stops exposing the
school's roster right away.

Decided by Grant, 2026-10-19: one action that kills the old link and replaces it,
a couple of deliberate clicks, hard to do by accident. Prompted by the counselor
handout (docs/handouts/), which tells counselors to contact us if a review link
gets out; before this, nothing in the app could act on that.

Acceptance criteria:
- [x] `replace_review_token(review_token_id)`: admin-only, security definer;
  locks the row, refuses an already-revoked link (`already_replaced`, so a double
  click can't kill twice), revokes every live link for the school, and mints the
  new one in the same transaction.
- [x] "Replace this link…" on the live review-link row opens a red confirm box;
  "Kill old link and create new one" stays disabled until "I understand the
  current link will stop working right away" is ticked. Closes and resets on any
  failure, and if the row's link changes underneath it.
- [x] The box says where the new link is emailed (the school's liaison email,
  which is what "Email review link" and the digest use), not a typed address.
- [x] reach-reviewer gate: migration safe for dev; its High (email field
  misleading) and Medium (box re-armed after `already_replaced`) findings fixed
  and re-checked.
- [x] `20261019130000_replace_review_token.sql` applied to dev by Grant, 2026-10-20.
- [x] e2e green (`intake-link-management.spec.ts`, runs only on the test-owned
  "AutoTest CounselorEmail ReviewFixture" school, never a real one).

Known gap: when the counselor changes, the school's liaison email must be
corrected before emailing the new link, and the app can't edit a school yet
(US-49).

Status: **In review** — built on `dev` 2026-10-19. Prod untouched until a
Software Acceptance Review.
Owner: built in a Claude session.

---

## US-61: Staff UI usability pass (fulfillment steps, nav, dashboard, distribution)

Requested by Grant, 2026-10-20, after a screenshot review of all 16 admin pages
at laptop and phone width.

Acceptance criteria:
- [x] Fulfillment: no "Purchased" step; Assigned goes straight to Received at
  church. "Pledged" reads "Assigned" everywhere. UI-only: the enum keeps both
  values, and a legacy purchased row shows, filters and advances as Assigned.
  Overdue badges only on Assigned cards; five columns fit a laptop screen.
- [x] Nav ordered by how the season runs, with a new Sponsors menu: Intake
  (Registrations, On hold, Households, High schoolers, Add a household),
  Sponsors (Sponsor roster, Assign sponsors, Print cards), Gifts (Fulfillment,
  Shopping list, Distribution), Setup (Drives, Schools, Staff & permissions,
  Audit log). Print cards stays (Grant, 2026-10-20).
- [x] Nav renders once in the admin shell, directly under the site header, so
  it's in the same place on every page; every admin page shares one width.
  Account moved to the site header; the public "Sponsor a child" link is gone
  from staff pages. Phone: nav fits one line ("Home" at phone width).
- [x] Dashboard: "Needs your attention" row (Ready to import, Waiting on
  counselor, On hold, Need a sponsor, each a link); "Cards claimed" is now
  "Sponsors assigned".
- [x] Distribution: copy matches school drop-off; "Mark handed to counselor" /
  "Handed to counselor" for drop-off households, "Check in" kept for church
  pickup; pickup time only where it applies.
- [x] Copy: "Households" title, "Over capacity" on the roster, no em-dash on
  Assign, Add a household no longer mentions the retired sponsor page.
- [x] Stale tests: the self-serve /sponsor UI tests removed (RPCs still covered
  in security.spec.ts); the M3(b) review_tokens check updated for US-28's
  admin SELECT (volunteer still reads nothing, nobody can delete).

Open (needs Grant): households with no school are numbered in two sequences
(confidential, direct referral) that share the "Z" prefix, so dev has two
different households both tagged Z1 and two cards both numbered Z1.1. Needs a
distinct prefix or one shared sequence before cards are printed.

Status: **In review** — built on `dev` 2026-10-20. No migration, no RLS change.

---

## US-62: Sponsor-first Assign workspace + "Suggest matches" draft

Replaces US-57's one-child-at-a-time popup. Season size is ~200 children and
~150 roster entries (Grant, 2026-10-20), where a popup per child is ~1,000
clicks with no overview.

Decided by Grant, 2026-10-20: sponsor-first layout; ship the draft in the same
build; sponsor preferences stay free text in the roster's Notes.

Acceptance criteria:
- [x] Header shows supply vs demand: children with a sponsor, waiting, open
  sponsor spots, how many more are needed, entries with no limit set, and how
  many confidential children are matched elsewhere.
- [x] Left: active roster sorted by open room (most first; no limit set next;
  full ones folded under "Full (n)"), searchable by name, email or notes,
  each showing room as dots plus notes.
- [x] Right: waiting children grouped by household, with "Assign all n" and
  per-child Assign, filters for school, boy/girl and grade, and search. Each
  click saves immediately; capacity warns ("2 over") but never blocks (US-57).
- [x] Selected-sponsor bar: room, notes, the children they already have, and
  "Next with room" once they're full.
- [x] 10-second Undo toast after every assign.
- [x] "Suggest matches" drafts a whole pass without writing anything: keeps a
  household with a sibling's existing sponsor, then places households whole,
  biggest first, to the earliest sign-up with room; splits only a household
  too big for any one sponsor (marked). Never over capacity; no limit set
  counts as 1. Review screen flags notes, lets staff remove any household,
  and saves with a progress count and a list of anything that failed.
- [x] Simulated at 200 children / 150 sponsors: all placed when room exists,
  no sponsor over capacity, no child twice, ~10 ms.
- [x] e2e (`assign-workspace.spec.ts`): household assign, undo, single assign,
  and draft discard writes nothing. Self-contained test household and roster
  entry; never saves a draft on shared dev.

No migration, no RLS change (same assign_card_to_sponsor_family and cancel
paths; the store's assign/cancel just gained a skip-refresh option for batches).

Status: **In review** — built on `dev` 2026-10-20.

---

# Found while writing the staff handouts (US-63 … US-75)

Grant asked for first-time-user handouts for volunteers and admins (2026-10-20;
drafts in [docs/handouts/](handouts/), not yet committed). Three agents
inventoried every staff screen from the code, and a fact-check agent verified
each handout claim against it. Those passes surfaced the problems below. The
handouts currently tell staff how to work around each one. **Every story's
last criterion is to update the handout that describes the workaround**, so
the docs don't keep warning about something that's been fixed.

US-63 is a confidential-data leak and is **fix before launch**. Grant asked for
the rest as stories to schedule ("I'll fix them soon"). Two related problems
were folded into existing stories instead of duplicated: school editing
(**US-49**, criterion added) and the wish-list save (**US-70** depends on
**US-48** DB-10).

---

## US-63: Hide registrations imported as confidential from uncleared volunteers

As an admin who imports a school registration as a confidential household, I
want its original registration hidden from volunteers without confidential
access, so ticking "Create this as a confidential household" actually protects
that household.

**The leak (verified 2026-10-20).** `form_submissions`' read policy is
`drive_school_id is not null or can_view_confidential()`
([20260830120000_intake_forms.sql:1304-1306](../supabase/migrations/20260830120000_intake_forms.sql#L1304)),
and no later migration overrides it. It only hides *confidential-channel*
registrations. A registration that came in through a **school** link and was
imported with the confidential box ticked keeps `drive_school_id` set. Any
signed-in volunteer can therefore still read it on Intake → Registrations under
"Imported" (`listSubmissions`, [web/lib/intake.ts:525-536](../web/lib/intake.ts#L525),
has no confidential filter). That includes the guardian's name, phone, and
email, every child's first name, sizes, wish list, and notes, and counselor
corrections. The household itself is hidden correctly; only its source
registration leaks. The same happens if a household is flipped to confidential
later in SQL.

This contradicts the AGENTS.md guardrail ("any new query, view, or policy
touching families/children must keep confidential rows out of a volunteer's
results unless they have `can_view_confidential`").

Acceptance criteria:
- [ ] `form_submissions` read policy also excludes a row whose
  `imported_family_id` is a confidential family unless `can_view_confidential()`.
  It checks through the existing `security definer` helper
  `family_is_confidential(imported_family_id)` (from
  [20260811120000](../supabase/migrations/20260811120000_fix_confidential_rls_subquery_leak.sql#L73)),
  **not** a raw `exists (select … from families …)` subquery. A raw subquery
  runs under the caller's RLS, sees no row for a confidential family, and
  silently re-opens the leak (the US-16 bug class).
- [ ] Because the check runs at read time, it covers registrations imported
  before this fix and households flipped to confidential later. No backfill.
- [ ] The admin update and insert policies keep working for cleared staff:
  import, counselor-corrected import, and the idempotent re-import path
  (`import_submission`).
- [ ] Anything else that reads `form_submissions` as the caller (the
  Dashboard's "Ready to import" and "Waiting on counselor" counts, the
  cross-school phone-match hint in `shared.ts`, the counselor digest counts) is
  checked. It must neither show a hidden row nor crash on a missing one.
- [ ] `security definer` functions that return submission data
  (`get_review_roster`, digest and email functions) are reviewed and listed in
  the migration header: which still return a confidential-imported
  registration, and why that's acceptable (e.g. the counselor's own roster of
  first name, age, and grade for a household they referred).
- [ ] UI copy: the "Imported" group blurb no longer says "Already in the drive
  as ordinary households" (`shared.ts:136-139`). The import box's warning ("A
  household imported normally and edited later is readable by every volunteer
  in between") stays accurate.
- [ ] Verified **as a signed-in volunteer without confidential access**, not in
  the SQL editor, which bypasses RLS: a school registration imported as
  confidential is absent from Registrations and from a direct
  `/admin/submissions/{id}` visit ("couldn't be found"). A cleared volunteer and
  an admin still see it. Repeat for a household flipped to confidential after
  an ordinary import. Add an e2e test that does the same.
- [ ] Migration applied to dev and recorded in
  [docs/MIGRATION_LEDGER.md](MIGRATION_LEDGER.md), and folded into
  `prod_bootstrap.sql` or listed as a post-bootstrap step, whichever the prod
  launch plan calls for at the time.
- [ ] **reach-reviewer gate** (RLS change on a table holding child PII).
- [ ] Handouts: remove the "The original registration stays visible" bullet from
  `docs/handouts/admin-guide.html` (Confidential households section) and
  re-render the PDF.

Status: **Backlog** — fix before launch.
Owner: database-engineer, then reach-reviewer.

---

## US-64: Marking a sponsor inactive releases their children

As sponsor staff, when a sponsor drops out I want "Mark inactive" to deal with
the children already assigned to them, so those children don't sit with a
sponsor who's gone.

Today "Mark inactive" only sets `sponsor_families.is_active`
([web/lib/store.tsx:1288-1311](../web/lib/store.tsx#L1288)). The children stay
assigned. They're missing from Assign sponsors, and they show on the Dashboard
as "Sponsors running late" ten days later.

Acceptance criteria:
- [ ] Clicking "Mark inactive" on an entry that has active assignments opens a
  confirm step listing those children by first name and card number, with the
  stage each is at.
- [ ] Confirming cancels every assignment still at "Assigned" (through the
  existing cancel path, so the audit log records it) and marks the entry
  inactive. Those children reappear on Assign sponsors.
- [ ] A gift already "Received at church" or later is **not** cancelled. The
  sponsor delivered, so their gift stays. The confirm step says so.
- [ ] An entry with no active assignments is marked inactive in one click, as
  today.
- [ ] e2e covers a sponsor with one assigned and one received child.
- [ ] Handouts: simplify "A sponsor drops out" in `area-sponsors.html` and A8
  step 2 in `admin-guide.html`. Re-render the PDFs.

Status: **Backlog**.
Owner: frontend-designer (no schema change expected).

---

## US-65: Match and track sponsors for confidential children

As an admin, I want to give a confidential child a sponsor and follow their gift
in the app, so confidential households aren't run from a paper list.

Today the database refuses to assign a confidential card, by design from US-58
(`assign_card_to_sponsor_family`, [20261019120000:136-150](../supabase/migrations/20261019120000_staff_sponsor_emails.sql#L136)).
The Assign page says these children are "matched separately"
([assign/page.tsx:228-232](../web/app/admin/assign/page.tsx#L228)), but nothing
does that. Their cards stay in Unassigned on Fulfillment with no buttons. They
inflate the Dashboard's "Need a sponsor" count, and their households never reach
"all delivered" on Distribution.

**Decision needed (Grant):** who may match a confidential child, and does the
sponsor get the normal card? Recommended: admins and cleared volunteers
(`can_view_confidential()`) can assign. The sponsor gets the same card fields as
anyone else (first name, grade, sizes, wish list, needs). The card number's
school code needs US-71 first, so the card doesn't hint at the school.

Acceptance criteria (assuming the recommendation):
- [ ] The assign function accepts a confidential card when the caller passes
  `can_view_confidential()`, and still refuses everyone else.
- [ ] Assign sponsors shows confidential children only to cleared staff, in their
  own clearly marked group. The Suggest-matches draft never includes them.
- [ ] Once assigned, a confidential card moves through Fulfillment like any
  other. Uncleared volunteers still get no rows for it.
- [ ] Sponsor emails (`send-sponsor-emails`) decide explicitly whether to include
  confidential cards; today they're skipped.
- [ ] **reach-reviewer gate** (changes a confidential-refusal invariant).
- [ ] Handouts: remove the "matched by hand / off-app" text in
  `admin-guide.html` (Confidential section and A6), `area-sponsors.html`,
  `area-gifts.html`, and the "Sponsor pool" glossary row in
  `volunteer-guide.html`.

Status: **Backlog** — needs Grant's decision.
Owner: database-engineer, frontend-designer.

---

## US-66: Never leave the app with no open drive

As an admin switching seasons, I want the app to stop me from leaving no drive
open, so the staff site can't lock everyone out.

Today, if no drive has status Open, every staff page, Drives included, shows
only "No drive with status 'open' was found. Create one from the SQL editor…"
([web/lib/store.tsx:298-301](../web/lib/store.tsx#L298)). Only someone with SQL
access can recover. Two easy ways in: set this year's drive to Closed at season
end, or close the old drive and reload before opening the new one. Separately,
"Create drive" pre-fills next year (`getFullYear() + 1`,
[drives/page.tsx:197](../web/app/admin/drives/page.tsx#L197)), which is wrong
when creating the current season's drive in the fall.

Acceptance criteria:
- [ ] The Drives page shows an "Make this the open drive" action that closes the
  current Open drive and opens the chosen one in **one** database call. The
  one-open-drive rule still holds, and the app is never left with zero.
- [ ] Choosing "Closed" or "Archived" on the only Open drive is refused with a
  plain message ("Open another drive first, or this drive stays open").
- [ ] With no Open drive, an admin can still reach Drives and open one. The
  no-drive screen links there for admins, and tells volunteers to contact an
  admin instead of mentioning the SQL editor.
- [ ] "Create drive" pre-fills the current year if no drive for it exists yet,
  otherwise next year.
- [ ] e2e covers the switch and the refusal.
- [ ] Handouts: simplify A1 and A12 in `admin-guide.html` and the no-drive line
  in `volunteer-guide.html`.

Status: **Backlog**.
Owner: database-engineer (switch function), frontend-designer.

---

## US-67: Staff account lifecycle in the app (invite, reset, deactivate)

As an admin, I want to add a volunteer, reset a forgotten password, and turn off
someone's access without the Supabase dashboard.

Today all three need the dashboard or `web/scripts/bulk-create-volunteers.mjs`.
There's no forgot-password link, the Staff page only edits role and confidential
access, and removing someone means deleting their auth user. ADM-6 (Grant,
2026-09-29) decided in-app invites come **next season**, after the email-domain
work, since the church's filter blocked invite emails. The service_role key is
permanently off-limits, so the design can't use a server route holding it.

Acceptance criteria:
- [ ] An approved pattern for invites and resets that doesn't use service_role
  (ADM-6's options: invite link, Supabase's built-in invite or recovery email
  once the domain works, or another flow). Recorded in OPEN_QUESTIONS ADM-6
  before building.
- [ ] Admins can deactivate a staff member in-app. A deactivated account signs in
  to a "Your access has been turned off" page and gets no rows from any
  staff-data policy. Likely a `profiles.is_active` flag checked by a shared
  `is_staff()` helper in every staff policy, reviewed as an RLS change.
- [ ] Reactivation works. Deactivation and reactivation are audited.
- [ ] **reach-reviewer gate** for the deactivation policy change.
- [ ] Handouts: update A2 and A10 in `admin-guide.html` and the sign-in steps in
  `volunteer-guide.html`.

Status: **Backlog** — next season per ADM-6. The deactivate half could come
sooner if Grant wants it this season. Until then, A10 in the admin handout
documents the interim steps.
Owner: database-engineer, frontend-designer.

---

## US-68: Safer Fulfillment: guard Cancel and allow one step back

As Gifts staff, I want a wrong click on Fulfillment to be fixable, and "Cancel"
to be hard to hit by accident once a gift is in, so a misclick doesn't take a
child's sponsor away.

Today any volunteer can Cancel an assignment at every stage except Delivered,
including after the gift is at church, guarded only by a browser confirm
([fulfillment/page.tsx:82-91, 246-264](../web/app/admin/fulfillment/page.tsx#L82)).
And there's no way to move a card back a step after a wrong "Mark received",
"Mark verified", or "Mark delivered".

**Decision needed (Grant):** who can step back? Recommended: anyone can undo the
step they just took (an Undo toast, like Assign sponsors), and admins can step
any card back one stage.

Acceptance criteria (assuming the recommendation):
- [ ] After each "Mark …" click, a 10-second Undo toast reverts it.
- [ ] Admins get a "Move back one step" action on any card past Assigned. It
  clears the timestamp for that step and is audited.
- [ ] "Cancel" on a card at "Received at church" or "Verified" is admin-only. The
  database enforces this, not just the button. Its confirm text names the
  sponsor and says the gift is already at church.
- [ ] e2e covers undo, step-back, and the volunteer refusal.
- [ ] **reach-reviewer gate** if the admin-only rule is enforced in RLS or a
  function.
- [ ] Handouts: rewrite the "Clicked the wrong card?" box in `area-gifts.html`
  and the A8 note in `admin-guide.html`.

Status: **Backlog** — needs Grant's decision.
Owner: frontend-designer, database-engineer (admin-only rule).

---

## US-69: "Remove" on a saved child does nothing

As intake staff, I don't want a Remove button that looks like it worked but
didn't.

On a household's edit page, "Remove" on an existing child's block drops it from
the form, but saving never deletes the child. The child comes back on reload.
It's a deliberate no-op ([web/lib/store.tsx:855-866](../web/lib/store.tsx#L855)),
because deleting a child stays a rare SQL-only action (household page footer).
The button doesn't say so.

Acceptance criteria:
- [ ] On the household edit page, "Remove" shows only on child blocks that
  haven't been saved yet.
- [ ] Saved children show a short note instead: "To remove a saved child, ask an
  admin." Admins see the same note until an in-app removal exists.
- [ ] Add a household (`/admin/intake`) is unchanged; Remove works there.
- [ ] e2e: a saved child block has no Remove button.
- [ ] Handouts: no change needed. `area-intake.html` already says you can't
  delete a saved child.

Status: **Backlog**.
Owner: frontend-designer.

---

## US-70: Volunteers can add to a child's saved wish list

As an intake volunteer, I want to add or fix a wish-list item on a child who
already has a saved list, since that's ordinary intake work.

Today any change to a child with a saved wish list deletes and re-inserts the
whole list. Delete is admin-only
([init.sql:389](../supabase/migrations/20260708120000_init.sql#L389)), so a
volunteer gets "Couldn't update {name}'s wishlist. Only an admin can change or
remove wishlist items…" as a partial save
([web/lib/store.tsx:1065-1073](../web/lib/store.tsx#L1065)). That's true even
when they only *add* a fourth item.

**Depends on US-48 DB-10**, which replaces the list in one transactional
function. **Decision needed (Grant):** should volunteers be able to edit saved
wish lists at all? Recommended: yes, through that function, for any child the
caller can see (same confidential gate).

Acceptance criteria (assuming yes):
- [ ] DB-10's replace function lets a volunteer replace the list for a child
  they can see. It keeps refusing a confidential child for an uncleared caller.
  Direct table DELETE stays admin-only.
- [ ] A volunteer can add, edit, and remove wish-list items on a saved child, and
  the save is all-or-nothing.
- [ ] **reach-reviewer gate** (new `security definer` path writing child data).
- [ ] Handouts: remove the "needs an admin" wish-list lines from
  `volunteer-guide.html`, `area-intake.html`, and `admin-guide.html`.

If the answer is no: hide the wish-list edit controls from volunteers on saved
children, with a note to ask an admin, so the partial-save error can't happen.

Status: **Backlog** — after US-48 DB-10; needs Grant's decision.
Owner: database-engineer.

---

## US-71: Household tags can repeat

As staff, I need every household tag and card number to be unique within a
drive, since gifts are labeled and found by card number.

Confidential households take their number from their own drive-wide sequence
(`next_confidential_family_number`), but the tag's prefix comes from the school
code, or `Z` with no school
([web/lib/queries.ts:66-90](../web/lib/queries.ts#L66)). So a confidential
household entered by hand and a direct referral can both be `Z1`. A school
registration imported as confidential can repeat an existing school tag like
`OL1`. It also carries the school's code on a confidential child's card number,
which hints at the school.

**Decision needed (Grant):** the confidential prefix. Recommended: one reserved
prefix for every confidential household, regardless of school (for example
`X`). The Schools form refuses that code for a school.

Acceptance criteria (assuming the recommendation):
- [ ] Confidential households tag as `{reserved prefix}{confidential number}`
  everywhere: Households, Fulfillment, Print cards, Distribution, sponsor PDFs,
  and search.
- [ ] Adding a school with the reserved code is refused.
- [ ] A check confirms no two households in the current dev drive share a tag;
  any existing duplicates are listed for Grant before the change.
- [ ] Handouts: remove the "now and then two households share a tag" sentence
  from `area-intake.html`.

Status: **Backlog** — needs Grant's decision.
Owner: frontend-designer (tag display), database-engineer (school-code check).

---

## US-72: Admin settings screen for drop-off details

As an admin, I want to set the gift drop-off place, days, and deadline in the
app, so sponsor emails never go out with placeholder text.

`app_settings.dropoff_location`, `dropoff_days`, and `dropoff_deadline` feed the
sponsor card PDFs and emails. Days and deadline still hold "not set yet"
placeholder text, and the only way to change them is a SQL `UPDATE` (US-43).
The Church Center sign-up URL is also SQL-only (US-59). `app_settings` already
has an admin-only update policy
([20260923120000:117-118](../supabase/migrations/20260923120000_counselor_email_links.sql#L117)),
so no RLS change is needed.

Acceptance criteria:
- [ ] A Setup → Settings page (admin-only in the nav) edits drop-off location,
  days, deadline, and the Church Center sign-up link, each with a one-line
  explanation of where it appears.
- [ ] "Email all assigned" and "Remind all assigned" refuse to send while days
  or deadline still hold the placeholder, with a message that links to
  Settings.
- [ ] Volunteers who open the page by URL see the values read-only, with the
  usual volunteer notice.
- [ ] e2e covers an edit and the send refusal.
- [ ] Handouts: A7 in `admin-guide.html` points to Settings instead of the
  database contact.

Status: **Backlog** — before email is turned on.
Owner: frontend-designer.

---

## US-73: Distribution progress counts only sponsored children

As Gifts staff, I want a household's "delivered" progress to reach its full
count once every sponsored child's gift is delivered.

Distribution's Progress ("2 / 3 delivered") counts every card except children
on hold ([web/lib/queries.ts:778-812](../web/lib/queries.ts#L778)). High
schoolers' cards never move on Fulfillment, so a household with a teenager never
reads complete. Unassigned confidential cards have the same effect until US-65
lands.

Acceptance criteria:
- [ ] Progress counts only sponsor-pool cards: not high schoolers, not on hold.
- [ ] A household with high schoolers shows them separately (for example "+1 high
  schooler"), so the hand-off still accounts for every child.
- [ ] A household of only high schoolers doesn't show "0 / 0".
- [ ] Handouts: remove the Progress caveat from "Hand gifts off to a school" in
  `area-gifts.html`.

Status: **Backlog**.
Owner: frontend-designer.

---

## US-74: Sponsor CSV import flags people already on the roster

As sponsor staff, I want the import preview to flag rows already on the roster,
so importing the Church Center list twice (or a corrected list) doesn't
duplicate everyone.

Today the import has no duplicate check, and `sponsor_families` has no unique
constraint ([ImportSponsorsModal.tsx](../web/app/admin/sponsors/ImportSponsorsModal.tsx)).

Acceptance criteria:
- [ ] The preview marks a row "Already on the roster" when its email matches an
  existing entry in this drive (case-insensitive), or it has no email and both
  name and phone match.
- [ ] Marked rows are skipped by default. A per-row checkbox lets staff import
  one anyway (two people sharing an email).
- [ ] The summary line counts new, already-on-roster, and no-name rows separately.
- [ ] "+ Add sponsor" warns, without blocking, when the email is already on the
  roster.
- [ ] Handouts: soften "Import only once" in `area-sponsors.html` and A6 in
  `admin-guide.html`.

Status: **Superseded by US-76** (2026-11-16), which builds this duplicate check into the Church Center import/update.
Owner: frontend-designer.

---

## US-75: Staff copy and small UI fixes from the handouts review

Small mismatches the handout fact-check found. Each is a copy change or a tiny
UI fix.

Acceptance criteria:
- [ ] **Registrations, "Waiting on counselor":** volunteers always see "{school}:
  no counselor link yet. Set one up in Registration links below."
  ([SubmissionsQueue.tsx:76](../web/app/admin/submissions/SubmissionsQueue.tsx#L76)),
  even when a link exists. Review links are admin-readable only, and volunteers
  can't set one up. For volunteers, show nothing or "Ask an admin for this
  school's counselor link".
- [ ] **Households status filter:** remove "Cancelled". It can never match,
  because cancelled assignments show as "Needs a sponsor"
  ([queries.ts:286-293](../web/lib/queries.ts#L286);
  [StatusBadge.tsx:13](../web/components/StatusBadge.tsx#L13)).
- [ ] **On hold empty state:** "No households on hold." → "No children on hold."
  ([on-hold/page.tsx:72](../web/app/admin/on-hold/page.tsx#L72)).
- [ ] **Print cards:** the page title "Printable cards"
  ([print/page.tsx:41](../web/app/admin/print/page.tsx#L41)) matches the nav
  label "Print cards".
- [ ] **Shopping list:** "Claimed {n}d ago"
  ([shopping-list/page.tsx:120](../web/app/admin/shopping-list/page.tsx#L120)) →
  "Assigned {n}d ago". It's the assignment date; claiming is gone.
- [ ] **No-drive error:** covered by US-66.
- [ ] Handouts: re-check quoted labels in `docs/handouts/*.html` against the new
  copy and re-render any changed PDF.

Status: **Backlog**.
Owner: frontend-designer.

---

## US-76: Import and update the sponsor roster from the Church Center export

As sponsor staff, I want to drop the latest Church Center registrations export
into the same Import window as often as I like, so new sign-ups are added and
ready to assign while everyone already on the roster keeps their children.

Decided by Grant, 2026-11-16: read the Church Center file as exported (no
reshaping); a changed count updates the limit but never below children already
assigned; cancelled or missing people are flagged only, never changed; also
save each person's Church Center sign-up time for first-come matching, and show
when the roster was last updated. Supersedes **US-74**.

Acceptance criteria:
- [x] The importer recognises the Church Center export (Registration ID, first
  and last name, phone, home/work/other email, Count, Status, Submitted) and
  still accepts `name, email, phone, capacity`. Addresses are never read into
  the app.
- [x] Rows with two emails (`a@x;b@y`) keep the first as the contact email and
  put the rest in the new entry's Notes.
- [x] Matching: Church Center Registration ID first; a hand-added entry is
  linked by email the first time it appears; the simple format matches by
  email, or name and phone when there's no email.
- [x] Preview groups: New (added), Changed (name/email/phone/count, per-row
  untick), Needs a look (cancelled in Church Center, missing from the file,
  count went below children assigned), Possible duplicates (same email, second
  registration; skipped unless ticked), Already on the roster, Skipped.
- [x] An import never touches assignments, notes or active/inactive status. A
  changed count never drops below children already assigned, enforced in the
  database as well as the preview.
- [x] One all-or-nothing save (`apply_sponsor_import`, security invoker, so
  the existing roster RLS applies). A concurrent import of the same people or
  a roster entry deleted mid-preview rolls everything back with a plain
  message.
- [x] `sponsor_families.signed_up_at` from Church Center's Submitted time;
  Suggest matches and the roster's room sort fill earliest sign-ups first.
- [x] "Last updated from Church Center: <time> by <name> (n new, n changed)"
  on the roster and Assign pages, from a new staff-only `sponsor_imports` log.
  Entries added by the latest import get a "New" badge on both pages.
- [x] Roster gains "Sort: sign-up order" and shows each entry's sign-up date.
- [x] Hand edits stick: each entry keeps what Church Center said at the last
  import (`church_center_snapshot`), and a re-import only proposes a change
  Church Center made since then. Unticking a proposed change is remembered,
  so it isn't asked again. Updates send only the changed fields, so an edit
  made between preview and confirm isn't overwritten.
- [x] `sponsor-csv.spec.ts`: parsing and plan tests with made-up data (no
  browser, no database). Dry run on the real 2026-11-16 export, locally, counts
  only: 69 rows, 68 new, 1 possible duplicate, 123 spots, 10 two-email rows
  split, no address in the save; re-importing the same file adds nobody.
- [x] Handouts: `area-sponsors.html` and A6 in `admin-guide.html` updated.
  Both PDFs re-rendered and copied to `web/help-docs/` (the in-app help menu).
- [x] Migration `20261116120000_church_center_roster_sync.sql` applied to dev 2026-11-16 and verified (columns, triggers, grants, policies, anon has nothing).
- [x] reach-reviewer 2026-11-16: no blockers. Fixed before the final apply:
  the log's counts (an UPDATE that RLS silently skipped), re-imports undoing
  hand edits, stale overwrites, importer name now stamped by the database,
  table privileges narrowed to select/insert, negative counts refused on
  updates, a Registration ID can't match one entry twice, and the New badge
  follows the last import that added people.
- [x] `copy-prod-to-dev.mjs` works again: promoting US-76 made the dev and
  prod structures match.
- [x] Promoted to prod 2026-11-16 (Grant's go-ahead): local backup first,
  migration via SQL Editor, verified read-only, then `main` moved to `dev`.

Status: **Done**, on dev and prod 2026-11-16.
Owner: frontend-designer (modal, pages), database-engineer (migration).

---

## Open questions

**Moved to [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)** — one page for every open
question across the project (68 as of 2026-08-12), organized by area, with the
matching GitLab issue where one exists. That file is now the place to answer
them; this section is just the forwarding address for the five that used to
live here:

1. ~~Is a real school-liaison contact coming, or do `drive_schools.liaison_*` stay null?~~ → **ADM-3**,
   answered 2026-08-18: yes, and the liaison belongs to the school, not the per-drive membership —
   `liaison_*` moved from `drive_schools` to `schools` accordingly.
2. What is `families.sort_tag` (the legacy "Color" field) actually for? → **ADM-1** (now also a live-data concern — the guess is baked into two intake forms, and the e2e suite uses the same column as a deletion marker)
3. Is the school list fixed year to year, or does it need an "inactive school" flag? → **DB-24** (DESIGN.md §8 treats this as resolved; confirm and strike)
4. Should granting `can_view_confidential` be logged with who and why, not just an unaudited boolean? → **DB-22** (the "who decides confidential" half is resolved — see **DB-26**)
5. Can a referral split siblings across schools/confidential status? → **DB-23** (DESIGN.md §8 treats this as resolved; confirm and strike)
