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
- [x] A child appears in this report if either: fewer physical card copies have been generated than their `target_card_count`, **or** at least one generated card has no `printed_at` timestamp.
- [x] Shown as a table on the staff dashboard under "Cards to print": child name + card number, target count, generated count, not-yet-printed count.
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

## Open questions

**Moved to [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)** — one page for every open
question across the project (68 as of 2026-08-12), organized by area, with the
matching GitLab issue where one exists. That file is now the place to answer
them; this section is just the forwarding address for the five that used to
live here:

1. Is a real school-liaison contact coming, or do `drive_schools.liaison_*` stay null? → **ADM-3**
2. What is `families.sort_tag` (the legacy "Color" field) actually for? → **ADM-1** (now also a live-data concern — the guess is baked into two intake forms, and the e2e suite uses the same column as a deletion marker)
3. Is the school list fixed year to year, or does it need an "inactive school" flag? → **DB-24** (DESIGN.md §8 treats this as resolved; confirm and strike)
4. Should granting `can_view_confidential` be logged with who and why, not just an unaudited boolean? → **DB-22** (the "who decides confidential" half is resolved — see **DB-26**)
5. Can a referral split siblings across schools/confidential status? → **DB-23** (DESIGN.md §8 treats this as resolved; confirm and strike)
