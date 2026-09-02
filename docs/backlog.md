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

Status: Backlog
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

Status: Backlog — **must land before 2026-10-01**
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
- [ ] The six tables (`forms`, `form_versions`, `form_links`, `form_submissions`, `review_tokens`, `submission_events`) are documented in SCHEMA.md in the same style as the existing eleven, including the `review_tokens_hash_is_bcrypt` constraint and why review tokens are hashed while form-link tokens are plaintext.
- [ ] The two new enums and the ~14 new columns on `families`/`children`/`wishlist_items` (§5.7) are folded into those tables' existing sections rather than bolted on as an appendix.
- [ ] The ten new functions are covered wherever SCHEMA.md documents `claim_card`/`create_family` today, including which are `security definer` and who holds `execute`.
- [ ] SCHEMA.md's "Row Level Security — who sees what" table gains rows for the six new tables, matching INTAKE_FORMS.md §9.
- [ ] The warning banner added at the top of SCHEMA.md on 2026-09-01 is removed as part of this, and INTAKE_FORMS.md's "not yet merged into DESIGN.md or SCHEMA.md" status line is updated.
- [ ] SCHEMA.md's own draft disclaimer ("nothing has been run against a real database yet") is corrected — that has been false since the first migration was applied.

Status: Backlog
Owner: unassigned (database-engineer when picked up)

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
