# Reach Christmas — Open Questions

One place to answer everything that's waiting on you. This is not a bug list or
a task board — those live in [backlog.md](backlog.md) and in
[GitLab](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues).
This file is the questions where **the code is guessing, stalled, or holding an
assumption nobody has confirmed**.

**How to use it:** answer inline under any question — a sentence is plenty.
Answered items get folded back into DESIGN.md / SCHEMA.md / backlog.md by
whoever picks the work up next, and the entry here gets struck through with
`~~...~~` rather than deleted, so the reasoning stays visible.

Compiled 2026-08-12 from DESIGN.md §8, SCHEMA.md's open-schema section,
backlog.md, the 21 open GitLab issues, and a full sweep of the code by
database-engineer, frontend-designer, qa-tester and reach-reviewer. **68
questions.** Most are small; 11 are marked **Blocking**. If you only answer a
handful, make it **SPN-1**, **SPN-2** (both gate the US-17 fix), **DOC-1**
(deployment, the one with a real deadline) and **DOC-3** (backups).

Organized by the GitLab `area::` label scheme.

| Area | Count | Jump |
|---|---|---|
| Sponsor-facing | 7 | [↓](#sponsor-facing) |
| Database & data integrity | 26 | [↓](#database--data-integrity) |
| Admin / staff UI | 17 | [↓](#admin--staff-ui) |
| Docs, deploy & ops | 12 | [↓](#docs-deploy--ops) |
| Testing | 6 | [↓](#testing) |

Priority legend:
**Blocking** — someone is stopped, or code is shipping on a guess, right now ·
**Soon** — will bite before the drive goes live this season ·
**Whenever** — no code depends on it.

---

## Sponsor-facing

Everything an anonymous member of the public can reach. Per
[AGENTS.md](../AGENTS.md), `public_available_cards` is the *entire* security
boundary here, so questions in this section are higher-stakes than their size
suggests.

### SPN-1 — Should the public sponsor page only show cards from the **open** drive? · **Blocking**

`public_available_cards` has no filter on `drives.status` at all. It's invisible
today only because the view returns nothing to anonymous visitors (SPN-2). The
moment that's fixed, **every card in the database becomes publicly listed and
claimable** — including next year's `draft` drive the instant a volunteer starts
typing intake, and last year's `closed`/`archived` drives. Cards are created at
intake-save time, not at drive-open time.

This is the highest-consequence side effect of fixing US-17 and needs an answer
*before* that fix is written.

- Code: [supabase/migrations/20260708120000_init.sql:220-236](../supabase/migrations/20260708120000_init.sql#L220), [web/lib/store.tsx:472-477](../web/lib/store.tsx#L472)
- Raised by: reach-reviewer
- GitLab: none yet — belongs on [#20](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/20)

### SPN-2 — Is it OK that the card number sponsors see embeds the school's letter code? · **Blocking**

`card_number` renders as e.g. `C1.3`, where `C` is `drive_schools.code`.
[DESIGN.md §5](../DESIGN.md#5-privacy--security-important--this-holds-kids-names-ages-schools-and-sponsor-contact-info--no-home-addresses-are-collected)
says sponsors never see a school. It's probably fine (the code is printed on the
physical card anyway, and a single letter isn't a school name), but whoever
fixes US-17 will be inlining that exact expression, so decide now rather than
inherit it.

- Code: [supabase/migrations/20260708120000_init.sql:223](../supabase/migrations/20260708120000_init.sql#L223), [DESIGN.md:52](../DESIGN.md#L52)
- Raised by: reach-reviewer
- GitLab: none yet — belongs on [#20](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/20)

### SPN-3 — Should claiming a card require confirming an email before it counts as `pledged`? · Soon

Would cut down accidental and prank claims, at the cost of a confirmation step
on a page designed to be frictionless. Changes `claim_card()`'s shape if yes, so
it's cheaper to decide before the season than after.

- Code: [supabase/migrations/20260708120000_init.sql:537-589](../supabase/migrations/20260708120000_init.sql#L537), [web/app/sponsor/SponsorBrowser.tsx:208-278](../web/app/sponsor/SponsorBrowser.tsx#L208)
- GitLab: [issue #12](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/12)

### SPN-4 — Has `claim_card()`'s anonymous path ever actually run against live Postgres? · Soon

It relies on the same "security definer bypasses RLS" assumption that
`public_available_cards` relies on — and that assumption just turned out not to
hold there. Since no anonymous visitor has ever been able to *see* a card to
click "Sponsor this gift", it's plausible the anon claim path has never been
exercised end to end. Needs a deliberate live smoke test once US-17 is fixed,
not an assumption that it's fine by association.

- Code: [supabase/migrations/20260708120000_init.sql:537-589](../supabase/migrations/20260708120000_init.sql#L537)
- Raised by: database-engineer

### SPN-5 — Is `/sponsor` expected to work well on a phone? · Soon

It's the one page real, non-technical members of the public will use, and most
of them will open it from a phone. There is currently no mobile-viewport
testing of any kind (`playwright.config.ts` defines no device projects).

- Code: [web/app/sponsor/SponsorBrowser.tsx](../web/app/sponsor/SponsorBrowser.tsx), [web/playwright.config.ts](../web/playwright.config.ts)
- Raised by: qa-tester

### SPN-6 — Do sponsors get anything after claiming — a confirmation email, a receipt, a reminder? · Soon

Today the only follow-up mechanism is the "Sponsors running late" table on the
staff dashboard, which a human has to read and act on manually. Notifications
are listed as Phase 2, but "sponsor claims a card in October and hears nothing
until a volunteer phones them in December" is a real experience question for
this season.

- Code: [web/app/admin/page.tsx:44-86](../web/app/admin/page.tsx#L44), [DESIGN.md:97](../DESIGN.md#L97)

### SPN-7 — Should sponsor contact details be visible to every volunteer, or only to admins? · Whenever

`sponsors` (name/phone/email of outside members of the public) is readable *and*
writable by every authenticated staff account with `using (true)` — no policy
predicate at all. It's the one table of non-staff PII with no gate, and it has
never been explicitly signed off.

- Code: [supabase/migrations/20260708120000_init.sql:394-396](../supabase/migrations/20260708120000_init.sql#L394)
- Raised by: reach-reviewer

---

## Database & data integrity

### DB-1 — Which migrations does the **prod** database actually have? · **Blocking**

There is no migration runner and no ledger. The only record is the "Applied to
prod" checkbox on individual backlog stories. Two migration pairs are queued for
prod right now (US-16, US-19) and both drop and recreate objects by name; US-16
silently assumes `families.created_by` already exists. Nobody can currently
state prod's schema version with confidence.

Related: should we add a `schema_migrations` table, or at minimum a checked-in
`APPLIED.md` ledger, before the next prod push?

- Code: [web/README.md:34-38](../web/README.md#L34), [docs/backlog.md:347](backlog.md#L347), [supabase/migrations/20260708140000_confidential_referral_access.sql:18](../supabase/migrations/20260708140000_confidential_referral_access.sql#L18)
- Raised by: reach-reviewer, database-engineer

### DB-2 — Does `anon` already hold table-level SELECT on the base tables via Supabase's platform default privileges? · **Blocking**

Two sources in this repo directly contradict each other.
[config.toml](../supabase/config.toml) documents the modern cloud default (new
objects are *not* auto-exposed); the US-16 follow-up migration records that the
team checked `pg_proc.proacl` live and found the **opposite** for this project —
Supabase auto-grants EXECUTE to `anon`/`authenticated` on every new function at
`CREATE` time regardless of what the migration says.

If that also applies to tables, then RLS-with-no-anon-policies is the *only*
thing standing between an anonymous visitor and `children.other_notes` /
`families.internal_notes` — not the belt-and-braces the schema doc implies. It
also means any future permissive anon policy is instantly a full-table leak, not
a scoped one. Needs checking in the Supabase dashboard (Database → API
settings), not from the CLI config file.

- Code: [supabase/config.toml:19-24](../supabase/config.toml#L19), [supabase/migrations/20260812090000_restrict_confidential_helper_grants.sql:13-22](../supabase/migrations/20260812090000_restrict_confidential_helper_grants.sql#L13), [supabase/migrations/20260708120000_init.sql:423-432](../supabase/migrations/20260708120000_init.sql#L423)
- Raised by: reach-reviewer, database-engineer (independently)

### DB-3 — Should `assignments` get the same confidentiality gate the other child tables have? · **Blocking**

`assignments` is the only table hanging off `families` with no confidentiality
predicate — `using (true)` for read *and* update. Safe today only because
`claim_card()` is the sole insert path and it refuses confidential cards. But
that invariant is held by convention, not by the database: `staff insert
assignments ... with check (true)` plus a table-wide insert grant means any
authenticated staff session can POST an assignment row for any card, including a
confidential family's, without going near `claim_card()`.

`volunteer_notes` (new in US-19) raises the stakes — it's free text a volunteer
could type identifying detail into, readable by every volunteer.

- Code: [supabase/migrations/20260708120000_init.sql:399-402](../supabase/migrations/20260708120000_init.sql#L399), [supabase/migrations/20260812100000_assignment_notes_and_verification.sql:20-32](../supabase/migrations/20260812100000_assignment_notes_and_verification.sql#L20)
- Raised by: reach-reviewer, database-engineer (independently)

### DB-4 — Should a `before insert` trigger on `assignments` enforce "no assignments against confidential cards"? · Soon

DB-3 stated as a constraint. A partial unique index can't express it, but a
trigger calling the existing confidential helper could — turning today's
convention into an actual guarantee.

- Code: [supabase/migrations/20260708120000_init.sql:565-572](../supabase/migrations/20260708120000_init.sql#L565)
- Raised by: reach-reviewer

### DB-5 — Are fulfillment stage transitions a real rule, or just a UI affordance? · Soon

`NEXT_STATUS` is a client-side map. RLS on `assignments` is `using (true) with
check (true)`, so any authenticated user can set any status to any other — jump
`pledged` straight to `delivered`, or walk `delivered` backwards — and the
`*_at` timestamps are written by the browser, not a trigger.

Fine if the ordering is just a convenience. **Not** fine if anyone treats
"verified" as an audit-grade claim that a human actually checked the gift
against the wishlist, which is exactly what US-19 built it for.

- Code: [web/lib/queries.ts:272-277](../web/lib/queries.ts#L272), [web/lib/store.tsx:785-798](../web/lib/store.tsx#L785), [supabase/migrations/20260708120000_init.sql:401](../supabase/migrations/20260708120000_init.sql#L401)
- Raised by: reach-reviewer, database-engineer (independently)

### DB-6 — Should `volunteer_notes` writes be restricted at the database layer to assignments that have reached "received at church"? · Soon

`updateAssignmentNotes` writes the column unconditionally; the
received-at-church-onward rule is a UI convention (`NOTES_VISIBLE_FROM`) with no
database constraint behind it. Combined with DB-3, anything other than the
intended UI path could attach a note to a freshly-pledged or even cancelled
assignment.

- Code: [web/lib/store.tsx:808-817](../web/lib/store.tsx#L808), [web/lib/queries.ts:302](../web/lib/queries.ts#L302)
- Raised by: database-engineer

### DB-7 — Should the volunteer-notes field carry guidance steering people to gift-only notes? · Soon

A volunteer typing "call mom, Sarah W., 555-0134, back door only" puts
identifying detail into the one table with no confidentiality gate — and it's
copied verbatim into `audit_log.diff` forever, with no retention policy behind
it (DB-17). Placeholder/helper text is a cheap mitigation if you want one.

- Code: [supabase/migrations/20260812100000_assignment_notes_and_verification.sql:35](../supabase/migrations/20260812100000_assignment_notes_and_verification.sql#L35), [web/lib/store.tsx:808-817](../web/lib/store.tsx#L808)
- Raised by: reach-reviewer

### DB-8 — Should `child_index` be assigned by an advisory-lock RPC like `create_family()` is? · Soon

Adding a child does `Math.max(...child_index) + 1` from a pre-flight SELECT and
then a separate INSERT — the exact check-then-insert race `create_family()` was
written to eliminate, one table over. Two volunteers adding a sibling to the same
family at once: one gets a raw duplicate-key error mid-save, *after* the family
row has already been written (a partial save). The code comment at that spot
claims it's collision-proof; it only handles staleness, not concurrency.

- Code: [web/lib/store.tsx:651-652](../web/lib/store.tsx#L651), [web/lib/store.tsx:716](../web/lib/store.tsx#L716)
- Raised by: reach-reviewer

### DB-9 — Same question for `cards.copy_number`, where the count comes from the browser's cached bundle · Soon

`reconcileCardsForChild` computes copy numbers from `data.cards.filter(...)` off
the in-memory bundle — not even a fresh read. Two staff raising
`target_card_count` for the same child, or one staff member with a stale tab,
collide on `unique (child_id, copy_number)`.

- Code: [web/lib/store.tsx:196-205](../web/lib/store.tsx#L196), [web/lib/store.tsx:769](../web/lib/store.tsx#L769)
- Raised by: reach-reviewer

### DB-10 — Is it acceptable that saving a wishlist deletes every item before inserting the replacements, in two separate transactions? · Soon

If the insert fails — RLS, network, one bad row — the child's wishlist is
already gone and there is no rollback. The user sees an error and the data is
destroyed. Should be one RPC.

- Code: [web/lib/store.tsx:745-767](../web/lib/store.tsx#L745)
- Raised by: reach-reviewer

### DB-11 — `family_is_confidential()` fails **open** for an unknown family id, and its own comment claims the opposite · Soon

It returns `coalesce(..., false)`, so `not family_is_confidential(<unknown id>)`
is TRUE and the policy grants access. The comment above it says a dangling
reference "never accidentally grants access." Unreachable today only because
`children.family_id` is NOT NULL with a cascading FK — but if anyone ever
relaxes those FKs or adds a soft-delete, this flips to a leak silently. Should
it be changed to fail closed?

- Code: [supabase/migrations/20260811120000_fix_confidential_rls_subquery_leak.sql:71-78](../supabase/migrations/20260811120000_fix_confidential_rls_subquery_leak.sql#L71), [:95-100](../supabase/migrations/20260811120000_fix_confidential_rls_subquery_leak.sql#L95)
- Raised by: reach-reviewer

### DB-12 — Should confidential first-name redaction be a display convention or a real boundary — and which predicate should it key on? · Soon

The UI redacts to "Z." for anyone who isn't `is_admin`, but RLS releases the
real first name to anyone who passes `can_view_confidential()`. So a cleared
volunteer receives the true name over the wire and the browser hides it — a
client-side check standing exactly where [AGENTS.md](../AGENTS.md) says a
database boundary belongs, *and* keyed on a different predicate than the
database uses.

- Code: [web/lib/queries.ts:73-74](../web/lib/queries.ts#L73), [supabase/migrations/20260708120000_init.sql:249-257](../supabase/migrations/20260708120000_init.sql#L249)
- Raised by: reach-reviewer

### DB-13 — Should non-cleared volunteers be able to learn how many confidential families exist? · Whenever

`next_confidential_family_number(p_drive_id)` is callable by any authenticated
user, and its only argument is the open drive's id — which every staff member
already loads on every page. So any volunteer can call it and get the count. The
migration's stated rationale for leaving the helpers `authenticated`-callable
("uuids aren't guessable") genuinely covers the other three helpers but not this
one. A count, not PII — but it should be a decision, not an inheritance.

- Code: [supabase/migrations/20260812090000_restrict_confidential_helper_grants.sql:28-35](../supabase/migrations/20260812090000_restrict_confidential_helper_grants.sql#L28), [:45](../supabase/migrations/20260812090000_restrict_confidential_helper_grants.sql#L45)
- Raised by: reach-reviewer

### DB-14 — `SCHEMA.md` documents `child_card_numbers` *without* `security_invoker`; the migration has it · **Blocking**

The canonical schema doc and the actual database disagree at precisely the line
that causes US-17. Anyone reasoning from the doc will mis-diagnose the bug — or
"fix" it in the dangerous direction (see the guardrails in
[backlog.md](backlog.md)'s US-17 entry). The doc needs correcting either way;
the question is only whether anything else in SCHEMA.md has drifted the same
way.

- Code: [SCHEMA.md:246](../SCHEMA.md#L246), [supabase/migrations/20260708120000_init.sql:175-176](../supabase/migrations/20260708120000_init.sql#L175)
- Raised by: reach-reviewer

### DB-15 — Can the admin pages hard-crash if an assignment's card isn't visible to the viewer? · Soon

`getShoppingList` and `getFulfillmentBoard` do `data.cards.find(...)!` /
`data.children.find(...)!` — a non-null assertion on the assumption that every
assignment's card is visible to whoever is looking. That holds today only
because of DB-3. If it ever stops holding, the failure mode isn't a blank row,
it's a TypeError that white-screens the shopping list and the overdue report for
non-cleared volunteers.

- Code: [web/lib/queries.ts:407-414](../web/lib/queries.ts#L407), [web/lib/queries.ts:334-336](../web/lib/queries.ts#L334)
- Raised by: reach-reviewer

### DB-16 — Is the legacy `assignments.notes` column safe to drop? · Whenever

Two overlapping "notes" columns on the same row, one used (`volunteer_notes`)
and one dead. Confirmed unmapped in the client — nothing in `web/` reads or
writes it. The risk isn't the column, it's a future editor typing into the wrong
one. Anything outside this codebase (an old export, a spreadsheet macro) still
depend on it?

- Code: [supabase/migrations/20260708120000_init.sql:148](../supabase/migrations/20260708120000_init.sql#L148), [supabase/migrations/20260812100000_assignment_notes_and_verification.sql:17-18](../supabase/migrations/20260812100000_assignment_notes_and_verification.sql#L17), [web/lib/types.ts:119-134](../web/lib/types.ts#L119)
- Raised by: database-engineer

### DB-17 — PII retention: keep indefinitely, or archive/anonymize after N years? · Soon

Currently decided as "keep indefinitely, revisit later." `audit_log` keeps a
full jsonb copy of every insert/update forever with no cascade from the source
record, so this covers more data than the live tables do. A concrete
archive/anonymize proposal is already written up in SCHEMA.md waiting for a
decision.

- Code: [SCHEMA.md:573-580](../SCHEMA.md#L573)
- GitLab: [issue #16](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/16)

### DB-18 — Is one `scheduled_pickup_at` per family enough? · Soon

If distribution needs multiple distinct events (different pickup days per
school), this wants a `distribution_events` table rather than a single timestamp
on `families`. Low cost to add later, but it's tied to DOC-2 — answer that first.

- Code: [SCHEMA.md:566-568](../SCHEMA.md#L566)
- GitLab: [issue #13](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/13)

### DB-19 — How does staff actually reach a family to arrange a pickup? · Soon

`families` has no phone, email, or contact column of any kind — yet the app
tracks `scheduled_pickup_at`. Either that coordination happens entirely off-app
through the school liaison, or this is a genuinely missing field, especially for
confidential/direct-referral families who have no school liaison in the loop at
all.

- Code: [supabase/migrations/20260708120000_init.sql:63-76](../supabase/migrations/20260708120000_init.sql#L63)
- Raised by: database-engineer

### DB-20 — Should wishlist items be pinnable to a specific card copy? · Whenever

Phase 2. Not urgent until a child has multiple cards with different sponsors,
where today two sponsors could buy the same gift.

- Code: [SCHEMA.md](../SCHEMA.md#8-wishlist_items--was-3-fixed-columns-opened-up)
- GitLab: [issue #8](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/8)

### DB-21 — Is `sponsors.notes` coming, or should it be dropped? · Whenever

Exists in the schema, never read, shown, or written anywhere in the app — not
even a field on the `Sponsor` type. If it's meant for staff to jot "hard to
reach" or "brought gifts early", it needs a UI; if not, it's dead weight like
DB-16.

- Code: [supabase/migrations/20260708120000_init.sql:130-136](../supabase/migrations/20260708120000_init.sql#L130), [web/lib/types.ts:104-109](../web/lib/types.ts#L104)
- Raised by: database-engineer

### DB-22 — Should granting a volunteer `can_view_confidential` be logged with who and why, not just flipped as a boolean? · Soon

Carried over from DESIGN.md §8. The *mechanism* is resolved (any staff member
can create a confidential referral; only admins/cleared staff keep viewing it),
but the decision trail is not — today it's an unaudited boolean toggle on the
staff page. `audit_log` does capture the `profiles` update, so the "who/when"
exists; the open part is "why", and whether that's worth a required note.

- Code: [web/app/admin/staff/page.tsx](../web/app/admin/staff/page.tsx), [supabase/migrations/20260708130000_profiles_staff_management.sql](../supabase/migrations/20260708130000_profiles_staff_management.sql)
- From: [backlog.md](backlog.md) DESIGN.md §8 carryover #4

### DB-23 — Can a referral ever split siblings across schools or confidential status? · Whenever

DESIGN.md §8 treats this as **resolved** — a cross-school household becomes two
separate `Family` records, one per school, because `Family` is a
distribution-day grouping convenience and not a household model. It's restated
here only because backlog.md still carries it as open. Confirm the resolution
holds and it can be struck.

- Code: [DESIGN.md:121-129](../DESIGN.md#L121), [SCHEMA.md:569-572](../SCHEMA.md#L569)
- From: [backlog.md](backlog.md) DESIGN.md §8 carryover #5

### DB-24 — Is the school list fixed year to year, or does it need an "inactive school" flag? · Whenever

DESIGN.md §8 treats this as **resolved** — schools change year to year and it's
fine to rebuild the list per drive via "Add school", since `schools` and
`drive_schools` already separate "the school exists" from "the school is in this
year's drive." Restated here because backlog.md still carries it as open, and
because it's the thing that decides whether ADM-4 (edit a school) needs a schema
change or is UI-only.

- Code: [DESIGN.md:119](../DESIGN.md#L119), [SCHEMA.md:76](../SCHEMA.md#L76)
- From: [backlog.md](backlog.md) DESIGN.md §8 carryover #3

### DB-25 — Should there be a `schema_migrations`-style ledger, or is "paste both files, dev first" fine forever? · Soon

The narrower, actionable half of DB-1. The README's current instruction is
manual, forward-only, and has no verification step. With two migration pairs
queued for prod right now, the cost of getting this wrong is currently at its
highest.

- Code: [web/README.md:34-39](../web/README.md#L34)

### DB-26 — Should confidential-family *creation* stay open to every staff member? · Whenever

Resolved in DESIGN.md §8 (yes — whoever's entering it already knows the details
firsthand, so it isn't new exposure), and implemented that way in RLS. Listed
only so it's on the record in one place alongside DB-22, which is the unresolved
half of the same topic.

- Code: [supabase/migrations/20260708140000_confidential_referral_access.sql](../supabase/migrations/20260708140000_confidential_referral_access.sql)

---

## Admin / staff UI

### ADM-1 — What is `sort_tag` (the legacy "Color" field) actually for? · **Blocking**

The long-standing guess is "a per-family wrapping-paper or bin color used to
sort physical gifts back together at distribution." That guess is no longer
confined to a doc footnote — **it is live placeholder text in two forms that
volunteers use for real data entry**, reading `e.g. wrapping color`. If "Color"
meant something else in the legacy sheet, staff will have populated the field
wrong before anyone finds out.

Second, sharper wrinkle nobody has raised before: **the e2e test suite uses this
same column as its cleanup marker**, tagging everything it creates with
`sort_tag = 'AutoTest'` and then deleting every row that carries that value. A
user-facing free-text field doubling as a test-infrastructure key is a genuine
hazard — a volunteer who types "AutoTest" into that box has their family deleted
by the next test run.

- Code: [web/app/admin/intake/page.tsx:143](../web/app/admin/intake/page.tsx#L143), [web/app/admin/families/[familyId]/page.tsx:280](../web/app/admin/families/%5BfamilyId%5D/page.tsx#L280), [web/tests/e2e/helpers/cleanup.ts:12-18](../web/tests/e2e/helpers/cleanup.ts#L12), [SCHEMA.md:560-562](../SCHEMA.md#L560), [DESIGN.md:118](../DESIGN.md#L118)
- Raised by: frontend-designer (the live placeholder), qa-tester (the AutoTest collision)
- GitLab: [issue #10](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/10)

### ADM-2 — Who sets `target_card_count`, and when? · Soon

Is it obvious at intake time ("this family always gets 2 cards per teenager"),
or something staff adjust later as wishlists come in? Affects whether the intake
form should ask for it at all, and it silently generates real card rows when
raised.

- Code: [SCHEMA.md:558-559](../SCHEMA.md#L558), [web/lib/store.tsx:196-205](../web/lib/store.tsx#L196)
- GitLab: [issue #11](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/11)

### ADM-3 — Is there a real school referral liaison contact, or is it informal? · Soon

`drive_schools.liaison_name/phone/email` are captured by the Add School form and
displayed in the schools table, and that's it — nothing uses them. Either a real
liaison workflow is coming (in which case they need more than plain text), or
they stay decorative indefinitely (in which case say so, and stop asking
volunteers to fill them in). Worth answering before ADM-4, since an "edit
school" feature would want to know.

- Code: [web/app/admin/schools/page.tsx:102-104](../web/app/admin/schools/page.tsx#L102), [:136-138](../web/app/admin/schools/page.tsx#L136), [SCHEMA.md:109](../SCHEMA.md#L109), [DESIGN.md:117](../DESIGN.md#L117)
- From: [backlog.md](backlog.md) DESIGN.md §8 carryover #1
- GitLab: [issue #9](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/9)

### ADM-4 — Edit a school, or also deactivate it? · Soon

Schools admin is add-only by design. When a liaison's phone changes or a school
name has a typo, there's no in-app path — raw SQL only. Question: is *edit* on
its own enough, or does "deactivate" need to be a real state (hidden from the
intake picker, historical data kept)? That distinction decides whether this is
UI-only or needs a schema flag. Per DB-24, deactivation within a single drive is
probably unnecessary. Note there's a ready template — the drives page already
has a working Edit modal for a near-identical list.

- Code: [web/app/admin/schools/page.tsx:66-79](../web/app/admin/schools/page.tsx#L66), [web/app/admin/drives/page.tsx:279-395](../web/app/admin/drives/page.tsx#L279)
- Raised by: frontend-designer
- GitLab: [issue #7](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/7)

### ADM-5 — What label sheet will actually be used for nametag stickers? · Soon

Blocked purely on the physical product — brand, size, and per-sheet layout (e.g.
an Avery number). Nothing can be designed until this lands; the current print
page is an index-card grid for plain paper.

- Code: [web/app/admin/print/page.tsx:9-12](../web/app/admin/print/page.tsx#L9), [DESIGN.md:88-92](../DESIGN.md#L88)
- GitLab: [issue #4](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/4)

### ADM-6 — How should staff accounts get created in-app, given the service_role key is permanently off-limits? · Soon

Creating a login still means going into the Supabase dashboard. Doing it in-app
normally requires a server-side admin API route holding the service_role key —
which is banned on this project. So this needs an *approved pattern* before it
can be scoped: an invite-link flow, Supabase's built-in invite email, or accept
that dashboard-only is fine forever.

- Code: [web/README.md:56-62](../web/README.md#L56), [web/app/admin/staff/page.tsx](../web/app/admin/staff/page.tsx)
- GitLab: [issue #3](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/3)

### ADM-7 — What device will staff be holding at the distribution event? · **Blocking** (for any distribution-day UI work)

The check-in table is `min-w-[920px]` and scrolls horizontally below that. This
is the screen most likely to be used *live, in front of families*, checking them
in as they arrive. If that's a phone or a small tablet rather than a laptop on a
table, it needs a one-row-per-family card layout, not a wide table. This is the
single most consequential responsive question in the app.

- Code: [web/app/admin/distribution/page.tsx:128](../web/app/admin/distribution/page.tsx#L128)
- Raised by: frontend-designer

### ADM-8 — Is the fulfillment board ever worked from a phone? · Soon

It's a horizontally-scrolling Kanban of fixed-width columns — a fine desktop
pattern, awkward one-handed on a ~360px screen with six columns. If volunteers
update status from a phone (e.g. while shopping, or at church intake), the
existing "Overdue only" flat list is probably the better default on narrow
screens.

- Code: [web/app/admin/fulfillment/page.tsx:144-149](../web/app/admin/fulfillment/page.tsx#L144)
- Raised by: frontend-designer

### ADM-9 — Is dark mode a deliberately supported mode, or inherited starter boilerplate? · Whenever

`globals.css` has a `prefers-color-scheme: dark` block that overrides the
background, ink, and category accent tokens — but **not** the four
`--color-status-*` tokens, so light-mode-tuned status colors are what a
dark-mode user actually sees, unaudited. No known contrast failure today (they're
low-opacity tints), but it's automatic and untested. Either commit to it and
give it a real visual pass, or drop the media query and ship one calm theme.

- Code: [web/app/globals.css:14-17](../web/app/globals.css#L14), [:46-63](../web/app/globals.css#L46), [web/components/StatusBadge.tsx:23](../web/components/StatusBadge.tsx#L23)
- Raised by: frontend-designer

### ADM-10 — Should saved filter views be shared across staff instead of per-browser? · Whenever

They live in `localStorage`, so they're per-device, invisible to teammates, and
lost if browser storage clears. Deliberate and documented — but if two
coordinators both want "Lincoln overdue", they each have to build it, and nobody
knows the other has it.

- Code: [web/lib/store.tsx:18-25](../web/lib/store.tsx#L18), [:90-97](../web/lib/store.tsx#L90), [:172-178](../web/lib/store.tsx#L172)

### ADM-11 — Is manual follow-up on overdue sponsors acceptable this season? · Soon

The "Sponsors running late" report exists on the dashboard, but there is no
email or text to staff or to the sponsor — someone has to open the page, read
it, and pick up a phone. Thresholds are currently 10 days (warning) and 21 days
(critical); are those the right numbers for this drive's calendar?

- Code: [web/app/admin/page.tsx:44-86](../web/app/admin/page.tsx#L44), [web/lib/queries.ts:104-126](../web/lib/queries.ts#L104)

### ADM-12 — Is a drive picker needed, or is "the one open drive" always right? · Whenever

Every dashboard stat is scoped to the single drive with `status = 'open'`, with
no picker. The one-open-drive constraint makes that safe, but it also means
there is no way to look at last year's numbers in the app at all.

- Code: [web/app/admin/page.tsx:33-42](../web/app/admin/page.tsx#L33), [web/lib/queries.ts:203-215](../web/lib/queries.ts#L203)

### ADM-13 — Should the audit log be exportable? · Whenever

Deliberately has no export or copy affordance because it's a PII-bearing view.
If an actual investigation ever needs the data out of the browser, there's
currently no supported path — confirm that's the intent.

- Code: [web/app/admin/audit/page.tsx](../web/app/admin/audit/page.tsx)

### ADM-14 — Who else needs an admin account this season? · Soon

DESIGN.md §8 records "just you for now; others TBD once contact info is
available." With the drive approaching and volunteer intake being the main use,
this probably needs a real answer — and it feeds ADM-6.

- Code: [DESIGN.md:112](../DESIGN.md#L112)

### ADM-15 — Should confidential families be visibly flagged differently anywhere else in the admin UI? · Whenever

Today the Families Explorer swaps the school name for a "Confidential" badge.
Every other surface (fulfillment board, shopping list, print, distribution)
treats them like any other row. Is that right, or should they be visually
distinct wherever they appear so a volunteer doesn't discuss one out loud?

- Code: [web/app/admin/families/FamiliesExplorer.tsx](../web/app/admin/families/FamiliesExplorer.tsx)

### ADM-16 — Does the app need a "why was this family marked confidential" field? · Whenever

Related to DB-22. `is_confidential` is a bare boolean with no reason attached,
so nobody downstream knows whether it's a safety situation, a staff family, or a
privacy preference — which matters for how carefully to handle it.

- Code: [supabase/migrations/20260708120000_init.sql:63-76](../supabase/migrations/20260708120000_init.sql#L63)

### ADM-17 — Should intake warn when a child's wishlist is empty? · Whenever

An empty wishlist card still appears to sponsors with nothing to buy, which is a
poor sponsor experience and probably a data-entry miss rather than a real
"nothing needed."

- Code: [web/app/admin/intake/page.tsx](../web/app/admin/intake/page.tsx), [web/app/sponsor/SponsorBrowser.tsx](../web/app/sponsor/SponsorBrowser.tsx)

---

## Docs, deploy & ops

### DOC-1 — Deploy to Vercel, or keep running locally? · **Blocking**

The one with a real deadline. If sponsors are meant to reach `/sponsor` this
season, the app has to be on the public internet, and nothing about hosting,
domain, or HTTPS has been set up. Deferred at your request previously; it can't
stay deferred much longer.

- Code: [DESIGN.md:137-138](../DESIGN.md#L137), [web/README.md:46-54](../web/README.md#L46)
- GitLab: [issue #15](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/15)

### DOC-2 — How does distribution actually run this year — church pickup, school drop-offs, or a mix? · Soon

Confirmed genuinely undecided as of 2026-07. No code depends on it (the
distribution page supports any combination per family), but DB-18 is waiting on
it, and so is any printing/logistics planning.

- Code: [DESIGN.md:134-136](../DESIGN.md#L134), [web/app/admin/distribution/page.tsx](../web/app/admin/distribution/page.tsx)
- GitLab: [issue #14](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/14)

### DOC-3 — Are database backups actually configured? · **Blocking**

DESIGN.md §5 lists "regular backups of the database" as a requirement. Nothing in
the repo confirms this was ever set up on either project, and there's no restore
procedure written down. This holds children's PII and is about to be the sole
record of a live drive — worth five minutes in the Supabase dashboard to confirm
what the retention actually is on the current plan.

- Code: [DESIGN.md:55](../DESIGN.md#L55)

### DOC-4 — Should GitLab issue #17 be closed? · Whenever

It tracks "confirm dev test accounts and reseed the dev database" — which
backlog.md records as **Done, confirmed 2026-08-11**, and which qa-tester
independently verified today by signing in as both accounts and running the
suite against a seeded dev database. The issue looks stale rather than open.

- Code: [docs/backlog.md](backlog.md) US-15
- GitLab: [issue #17](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/17)

### DOC-5 — How should backlog.md drift be prevented, not just periodically repaired? · Soon

Known problem with a concrete example found today: US-4's acceptance criteria
state "There is no 'mark as printed' action in the UI yet", but that button has
shipped and works. Since backlog.md is the declared source of truth for status,
stale criteria actively mislead — someone could re-scope shipped work as new.

- Code: [docs/backlog.md:79](backlog.md#L79) vs [web/app/admin/print/page.tsx:119-125](../web/app/admin/print/page.tsx#L119)
- Raised by: frontend-designer
- GitLab: [issue #5](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/5)

### DOC-6 — Should there be CI, even if only manually triggered? · Soon

No `.github/workflows`, no `.gitlab-ci.yml`. The 18 e2e tests only run when a
human or an agent remembers to invoke them. Full auto-on-push isn't obviously
right (the suite needs a seeded dev database and named test accounts, and it
writes real rows), but a manually-triggered job would stop verification from
depending on someone remembering.

- Raised by: qa-tester

### DOC-7 — Who keeps GitLab and backlog.md in sync, and how often? · Soon

They're deliberately two systems (GitLab for issue tracking, backlog.md for
stories) with a manual sync step, and the product-manager agent has no GitLab
access at all. Today's round found one stale issue (DOC-4) and several open
questions with no issue. Is the manual sync working, or should one of the two
become the single list?

- Code: [memory.md:5-11](../memory.md#L5)

### DOC-8 — Should the repo keep the legacy spreadsheet at all? · Whenever

`Source Information/Reach Christmas Master List 2021_Unsorted.xlsx` holds real
family PII. It is correctly gitignored and has never entered git history — that
part is clean. The question is whether it should live inside the repo folder at
all, versus somewhere outside the working tree, given how easy a
`git add -f` or a rule change makes it to leak.

- Code: [.gitignore](../.gitignore) (the `/Source Information/` rule)

### DOC-9 — Can the stray zero-byte `asdf` file be deleted? · Whenever

Committed by accident in the initial commit and tracked ever since. Zero bytes,
no references. Trivial, just needs a yes.

- Code: [asdf](../asdf)

### DOC-10 — Should `web/README.md` warn against running the test suite during manual dev QA? · Whenever

The suite signs in as the same two named accounts a human uses for manual
testing, with no session isolation, and its cleanup deletes every
`AutoTest`-tagged row project-wide. Fine at this project's size, but it's an
easy footgun to document.

- Code: [web/tests/e2e/helpers/testClient.ts:24-40](../web/tests/e2e/helpers/testClient.ts#L24), [web/README.md:64-83](../web/README.md#L64)
- Raised by: qa-tester

### DOC-11 — Is Planning Center integration still wanted eventually? · Whenever

Deferred to Phase 2 pending admin access to Church Center. Listed so it doesn't
get silently dropped.

- Code: [DESIGN.md:100](../DESIGN.md#L100)

### DOC-12 — Are sponsor accounts and email/text notifications still Phase 2, or does this season need them? · Whenever

Both are on the Phase 2 list. SPN-6 and ADM-11 are the concrete places where
their absence shows up this season.

- Code: [DESIGN.md:96-98](../DESIGN.md#L96)

---

## Testing

### TST-1 — Should the e2e suite be forced to `workers: 1`? · **Blocking**

The suite is unsafe at its own documented default parallelism, for two
independently confirmed reasons: Supabase Auth rate-limits the two shared test
accounts when several workers sign in at once, and every `describe`'s `afterAll`
calls a blanket "delete everything tagged AutoTest" that wipes rows still in use
by a *different worker's* test.

Measured today: default settings gave 3/5 then 13/18 failures; `--workers=1`
gave a clean, repeatable 5/5 and 16/18 (the two remaining failures being US-17
and US-18 only). This matters beyond tidiness — a contributor following the
README literally would conclude most of the app is broken when only two stories
actually are. Simplest fix is `workers: 1` in the config (the suite runs in
under a minute serially); the alternative is per-run unique tags plus serialized
describes.

- Code: [web/playwright.config.ts:14](../web/playwright.config.ts#L14), [web/tests/e2e/helpers/cleanup.ts:12-18](../web/tests/e2e/helpers/cleanup.ts#L12), [web/README.md:76](../web/README.md#L76)
- Raised by: qa-tester (both passes, independently)

### TST-2 — Raise the dev project's auth rate limit, or switch the tests to a cached session? · Soon

`signInAs()` does a fresh `signInWithPassword` in *every single test*, times the
number of parallel workers. The failure mode is nasty: rate-limit errors surface
as "element not found" timeouts, which look like app bugs. Either raise the
limit in the dashboard or move the helpers to Playwright's `storageState`.

- Code: [web/tests/e2e/helpers/testClient.ts:24-40](../web/tests/e2e/helpers/testClient.ts#L24)
- Raised by: qa-tester

### TST-3 — Is anything else running Playwright against the dev project? · Soon

qa-tester found a leftover `AutoTest`-tagged family and a `.last-run.json`
showing a passed run nobody in this session triggered. If a second machine, a
scheduled job, or another agent is hitting the same dev database with the same
two accounts, that compounds TST-1 and TST-2 and could explain earlier
"unexplained" flakiness.

- Code: `web/test-results/` (Playwright's scratch output — gitignored, so check it on the machine that ran the suite), [web/tests/e2e/helpers/cleanup.ts:12-18](../web/tests/e2e/helpers/cleanup.ts#L12)
- Raised by: qa-tester

### TST-4 — For US-18: fix the test only, or also the underlying accessibility issue? · Soon

The test bug is fully root-caused — an anchored `getByLabel(/^school$/i)` can
never match, because the `<label>` wraps the `<select>` and so its accessible
name concatenates every `<option>`'s text. Two-line fix in the spec. But the same
DOM pattern means a screen reader announces "School All schools Demo Elementary
Demo Middle School…" for that filter, which is a real if minor a11y rough edge.
Fix the test and move on, or open a small frontend ticket too?

- Code: [web/tests/e2e/ui-flows.spec.ts:68](../web/tests/e2e/ui-flows.spec.ts#L68), [:79](../web/tests/e2e/ui-flows.spec.ts#L79), [web/app/admin/families/FamiliesExplorer.tsx:118-134](../web/app/admin/families/FamiliesExplorer.tsx#L118)
- Raised by: qa-tester
- GitLab: [issue #21](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/21)

### TST-5 — Should there be a negative test asserting the anonymous boundary holds? · Soon

Nothing asserts that a signed-out client gets **zero** rows from `children`,
`families`, or `assignments`, or that a confidential child never appears in
`public_available_cards`. US-17 is proof the anon path was barely exercised at
all — and any fix to it without these tests is a fix nobody can prove.

- Code: [web/tests/e2e/security.spec.ts](../web/tests/e2e/security.spec.ts), [web/tests/e2e/helpers/testClient.ts:17-19](../web/tests/e2e/helpers/testClient.ts#L17)
- Raised by: reach-reviewer

### TST-6 — What else must be covered before this goes live to real sponsors? · Soon

Known gaps, all confirmed by grep today: the school duplicate-code race has
**zero** coverage; the family edit flow is exercised only through the "Internal
notes" field (not `sort_tag`, adding a child, wishlist edits, or raising sponsor
slots — which silently generates real cards); US-19's whole verification and
shopping-list feature has no automated coverage at all, only your one manual
pass; and there is no mobile-viewport project anywhere.

- Code: [web/tests/e2e/concurrency.spec.ts:143-191](../web/tests/e2e/concurrency.spec.ts#L143), [web/lib/store.tsx:131-170](../web/lib/store.tsx#L131), [web/app/admin/families/[familyId]/page.tsx](../web/app/admin/families/%5BfamilyId%5D/page.tsx)
- Raised by: qa-tester
- GitLab: [issue #6](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/6)
