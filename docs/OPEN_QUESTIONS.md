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

### ~~SPN-1 — Should the public sponsor page only show cards from the **open** drive?~~ · Resolved

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

Answer: There should be a filter to only show "Open" drives on the main page.

Implemented, applied to dev, and fully proven live 2026-08-18 (supabase/migrations/20260818120000_fix_public_available_cards_anon_bug.sql — `join drives d on d.id = f.drive_id and d.status = 'open'`). A temporary `draft`-status drive/family/child/card was created in dev, confirmed invisible to an anonymous `public_available_cards` query, then deleted with the cascade delete confirmed to leave zero trace.

### ~~SPN-2 — Is it OK that the card number sponsors see embeds the school's letter code?~~ · Resolved

Answer: The card number is ok to have on the main page, but should definitely be visible on the staff side. Fine to leave the IDs with a single letter identifier.

Implemented in the US-17 fix (supabase/migrations/20260818120000_fix_public_available_cards_anon_bug.sql) — the inlined card-number expression is unchanged from what `child_card_numbers` already produced.

- Code: [supabase/migrations/20260708120000_init.sql:223](../supabase/migrations/20260708120000_init.sql#L223), [DESIGN.md:52](../DESIGN.md#L52)
- Raised by: reach-reviewer
- GitLab: none yet — belongs on [#20](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/20)

### ~~SPN-3 — Should claiming a card require confirming an email before it counts as `pledged`?~~ · Resolved, implemented

Answer (2026-08-18): Yes, emails should be verified before a claim counts. Method
picked after discussion: a 6-digit code typed on the same claiming page (not a
confirmation link, not skipped). Sending provider: Resend, chosen over the
church's own email since there's no Google Workspace/Microsoft 365 account to
send through — just a plain personal Gmail address, which isn't a good fit for
programmatic sending.

Implemented 2026-08-18, not yet applied to any live database (same pending-apply
note as ADM-2/ADM-3 above), and not yet fully testable end to end — Grant still
needs to create a free Resend account and hand over an API key, which gets
stored in Supabase Vault (never in this repo, never the app itself), one time,
via the SQL editor. `claim_card()` is no longer callable by anon/authenticated
(grant revoked) — it's replaced by two new functions,
`request_claim_code()` (sends the code) and `claim_card_with_code()` (verifies
it and only then creates the sponsor + assignment, same as `claim_card()` used
to do in one step). Two real bugs were caught and fixed in review before this
shipped: the wrong-code attempt counter wasn't actually persisting (a Postgres
transaction-rollback quirk, would have let someone brute-force all 1,000,000
possible codes unimpeded), and a NULL code input could skip verification
entirely. Both fixed — see the migration's comments for the detail.
`web/app/sponsor/SponsorBrowser.tsx`'s claim modal is now a two-step wizard
(send code → enter code → confirm) rather than one form. Two more issues
surfaced in reach-reviewer's pass and were fixed the same day: `pg_net`'s own
internal tables could have exposed the Resend API key and every pending
plaintext code to any signed-in volunteer (same DB-2 platform-grant risk,
closed with an explicit revoke), and a second code request for the same card
could silently orphan an earlier one (closed with a per-request session token —
see the migration's comments). One low-priority gap left deliberately unfixed:
there's no per-email/per-caller throttle on `request_claim_code`, only a
per-card one — a script could request codes for many different cards addressed
to the same arbitrary email, which could spam a stranger's inbox or burn the
Resend sending quota. Low risk at this app's scale; worth a look if abuse shows
up in practice.

- Code: [supabase/migrations/20260818160000_email_verified_claims.sql](../supabase/migrations/20260818160000_email_verified_claims.sql), [web/app/sponsor/SponsorBrowser.tsx](../web/app/sponsor/SponsorBrowser.tsx), [SCHEMA.md](../SCHEMA.md)
- GitLab: [issue #12](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/12) — worth closing once applied and confirmed live

### SPN-4 — Has the anonymous claim path ever actually run against live Postgres? · **Blocking**

Originally about `claim_card()`; that function is superseded by
`request_claim_code()`/`claim_card_with_code()` as of SPN-3 (2026-08-18), so the
question now applies to those two instead. Still open, and now worse: qa-tester
tried to answer it today (2026-08-18) and hit a harder blocker than the
Vault/Resend-key gap SPN-3 already knew about — **both Supabase projects (dev
`thvyntrxmahygesltgft` and prod `mpiueduyrmplrueviupl`) are currently
unreachable.** Independently confirmed via two public DNS resolvers: both
project hostnames return NXDOMAIN, while `supabase.co` itself resolves fine —
this is specific to Grant's two projects, not a general Supabase outage.
Every single e2e test failed identically at sign-in today, not just
claim-related ones. **Grant needs to check the Supabase dashboard** — paused
project, billing issue, or a deleted/recreated project are the likely causes.
Nothing can be applied, tested, or demoed against either database until this is
resolved, which makes this more urgent than "Soon."

Once dev is reachable again: `request_claim_code()`/`claim_card_with_code()`
still can't be smoke-tested past the "not configured yet" error until Grant
also provides a Resend API key (see SPN-3 above) and it's stored in Supabase
Vault.

- Code: [supabase/migrations/20260818160000_email_verified_claims.sql](../supabase/migrations/20260818160000_email_verified_claims.sql)
- Raised by: database-engineer; DNS outage found by qa-tester

### SPN-5 — Is `/sponsor` expected to work well on a phone? · Soon

It's the one page real, non-technical members of the public will use, and most
of them will open it from a phone. There is currently no mobile-viewport
testing of any kind (`playwright.config.ts` defines no device projects).

- Code: [web/app/sponsor/SponsorBrowser.tsx](../web/app/sponsor/SponsorBrowser.tsx), [web/playwright.config.ts](../web/playwright.config.ts)
- Raised by: qa-tester

Answer: Absolutely this should be optimized for phone usage. 

### SPN-6 — Do sponsors get anything after claiming — a confirmation email, a receipt, a reminder? · Soon

Today the only follow-up mechanism is the "Sponsors running late" table on the
staff dashboard, which a human has to read and act on manually. Notifications
are listed as Phase 2, but "sponsor claims a card in October and hears nothing
until a volunteer phones them in December" is a real experience question for
this season.

- Code: [web/app/admin/page.tsx:44-86](../web/app/admin/page.tsx#L44), [DESIGN.md:97](../DESIGN.md#L97)

Answer: I need to help define an email workflow. Right now I'm imagining a flow like 1. Thanks for signing up, here's who you volunteered to buy for 2. Reminder 1 week until due 3. Reminder 1 day out 4. if overdue, emails should go out again. but I don't know the best way to do this, and am open to suggestions. 

### ~~SPN-7 — Should sponsor contact details be visible to every volunteer, or only to admins?~~ · Resolved

Answer: This is ok. Most sponsors are within our church organization, so little PII protection is needed for them. Their details should remain editable by any staff as needed. No RLS change needed — current `using (true)` policy is the intended behavior, not an oversight.

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

Answer: I have no idea, I haven't done a good job keeping up with what is in prod. I assume everything has been on dev only. I'm kind of waiting for a prod push before my demo next week to sync things up. 

### ~~DB-2 — Does `anon` already hold table-level SELECT on the base tables via Supabase's platform default privileges?~~ · Resolved (confirmed real, hardening optional)

Plain-language version: your family/kid data is protected by two layers in theory —
(1) "can this anonymous website visitor even query this table at all" and (2)
"if so, which rows does RLS let them see." We only ever verified layer 2. This
question was "is layer 1 actually there, or is RLS silently doing 100% of the
work alone?"

Checked live against **dev** 2026-08-18 (database-engineer, read-only, anon key
only): layer 1 is **not** there. Supabase's platform auto-grants `anon` SELECT on
every base table — `children`, `families`, `assignments`, `cards`,
`wishlist_items` — regardless of what the `init` migration's grant lines say.
Today this is **not an active leak**: those tables have no anon-permissive RLS
policy, so anon queries against them correctly return zero rows. But it does mean
RLS is the *sole* barrier, exactly as feared — if anyone ever adds a permissive
anon policy to one of these tables without realizing the table-level grant is
already silently present, the leak is instant and full-table, not scoped. Same
platform behavior already confirmed for functions in the US-16 follow-up
migration.

Optional hardening available if wanted: an explicit `revoke select on children,
families, assignments, cards, wishlist_items from anon;` migration would restore
the two-layer model with zero functional change (RLS already blocks anon on
these tables today). Not applied — flag if you want it done.

- Code: [supabase/config.toml:19-24](../supabase/config.toml#L19), [supabase/migrations/20260812090000_restrict_confidential_helper_grants.sql:13-22](../supabase/migrations/20260812090000_restrict_confidential_helper_grants.sql#L13), [supabase/migrations/20260708120000_init.sql:423-432](../supabase/migrations/20260708120000_init.sql#L423)
- Raised by: reach-reviewer, database-engineer (independently)

### ~~DB-3 — Should `assignments` get the same confidentiality gate the other child tables have?~~ · Resolved

Plain-language version: any logged-in staff/volunteer account could technically
attach a sponsor-assignment or a note to a confidential family's gift card by
going around the normal "claim a card" button (e.g. a bug, or a bad API call) —
the database itself doesn't block this today, only the app's normal click-path
does.

Answer (2026-08-18): No DB-level lock needed — current app-level protection is
fine.

- Code: [supabase/migrations/20260708120000_init.sql:399-402](../supabase/migrations/20260708120000_init.sql#L399), [supabase/migrations/20260812100000_assignment_notes_and_verification.sql:20-32](../supabase/migrations/20260812100000_assignment_notes_and_verification.sql#L20)
- Raised by: reach-reviewer, database-engineer (independently)

### ~~DB-4 — Should a `before insert` trigger on `assignments` enforce "no assignments against confidential cards"?~~ · Moot

Was the concrete implementation of DB-3's lock. DB-3 was answered "no DB-level
lock needed" (2026-08-18), so there's nothing to build here.

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

### ~~DB-9 — Same question for `cards.copy_number`, where the count comes from the browser's cached bundle~~ · Moot

`reconcileCardsForChild` (the function this race lived in) and `copy_number`
itself are both gone as of ADM-2 (2026-08-18) — every child gets exactly one
card, created once, never reconciled against a count. Nothing left to race on.

- Code: [supabase/migrations/20260818140000_one_card_per_child.sql](../supabase/migrations/20260818140000_one_card_per_child.sql)
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

### ~~DB-14 — `SCHEMA.md` documents `child_card_numbers` *without* `security_invoker`; the migration has it~~ · Resolved

Fixed 2026-08-18 — and the drift was worse than scoped: `cards_needing_print` and `printable_cards` had
the same `security_invoker` omission in SCHEMA.md (migration has it on both; a diff against
`20260708120000_init.sql` found all three). All three SCHEMA.md code blocks now match the migration, with
a note on `child_card_numbers` explaining why `public_available_cards` can't join it.

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

### ~~ADM-1 — What is `sort_tag` (the legacy "Color" field) actually for?~~ · Resolved

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

Answer: Sort tag was supposed to be a way to color coordinate/sort bags for students out but I don't think this is needed anymore. Clean up the tag from database and UI where needed.

Implemented and applied to dev 2026-08-18 (supabase/migrations/20260818130000_replace_sort_tag_with_is_test_data.sql) — drops `sort_tag`, and (since it doubled as the e2e cleanup marker, the hazard described above) replaces it with two non-UI-exposed booleans set only via `create_family()`'s `p_is_test_data` param: `is_test_data` (broad "not real data" flag, shared with `demo_seed*.sql`) and `is_autotest_data` (narrower — true only on e2e-created rows). reach-reviewer caught that a first draft pointed both the e2e suite and `demo_seed*.sql` at the same flag, which would have made an e2e run silently delete a demo you'd just seeded for a walkthrough; cleanup.ts was repointed at `is_autotest_data` before this ever went live. UI fields removed from the intake and family-edit forms; `npm run lint`/`tsc --noEmit` clean. **Verified end to end against dev**: full e2e suite run confirms `cleanupAutoTestData()` runs with no errors against the new column and leaves zero `is_autotest_data`/`@autotest.example.com` rows behind afterward, with demo-seeded data (if any) untouched since it only ever carries `is_test_data`.

### ~~ADM-2 — Who sets `target_card_count`, and when?~~ · Resolved, implemented

Answer (2026-08-18): there is no longer a need to have more than one family sign up
for one card. There will only ever be one sponsor per child.

Implemented 2026-08-18, not yet applied to any live database — the migration
below is written and waiting for the usual manual apply-to-dev-then-prod step
(see [web/README.md](../web/README.md#database-changes)).
`children.target_card_count`, `cards.copy_number`, and `cards.total_copies` are
gone; `cards` now has `unique (child_id)` instead of `unique (child_id,
copy_number)` — one card per child is a database guarantee, not a UI convention.
`cards_needing_print` is now just "children whose one card isn't printed yet";
`printable_cards.display_label` dropped the "(1 of 2)"-style suffix. The
"Sponsor slots" input is gone from the intake/edit child form, and the "Cards to
print" dashboard table dropped its Target/Generated columns down to just Child +
Card. This also makes DB-9 and the "raising sponsor slots" half of TST-6 moot —
struck below.

- Code: [supabase/migrations/20260818140000_one_card_per_child.sql](../supabase/migrations/20260818140000_one_card_per_child.sql), [SCHEMA.md](../SCHEMA.md)
- GitLab: [issue #11](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/11) — worth closing

### ~~ADM-3 — Is there a real school referral liaison contact, or is it informal?~~ · Resolved, implemented

Answer (2026-08-18): There isn't a real liaison workflow yet, but the church
definitely wants this data stored — the school is the church's sole go-between
for referred families, since families themselves generally aren't contacted
directly. The school liaison should be inherited from a school.

Implemented 2026-08-18, not yet applied to any live database (same pending-apply
note as ADM-2 above). `liaison_name`/`liaison_phone`/`liaison_email` moved from
`drive_schools` (the per-drive membership row) to `schools` (the school itself),
with existing data backfilled. This is a data-model correction, not a new UI —
"Add School" still always creates a brand-new `schools` row today (there's no
"reuse an existing school in a new drive" picker yet), so the liaison doesn't
yet visibly carry across years in practice. That picker is ADM-4 territory; this
just makes sure the data is sitting in the right place for when it ships.

One pre-prod check flagged by reach-reviewer: the migration's backfill (copying
`liaison_*` from `drive_schools` to `schools`) picks an arbitrary row when a
school has more than one `drive_schools` row with non-null liaison info (e.g.
participated in multiple past drives with different contacts) — silent, not an
error. Fine on dev; before pasting into prod, run
`select school_id, count(*) from drive_schools where liaison_name is not null group by school_id having count(*) > 1;`
first and manually check any school it flags.

- Code: [supabase/migrations/20260818150000_school_liaison_on_schools.sql](../supabase/migrations/20260818150000_school_liaison_on_schools.sql), [SCHEMA.md](../SCHEMA.md)
- From: [backlog.md](backlog.md) DESIGN.md §8 carryover #1
- GitLab: [issue #9](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/9) — worth closing

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

Answer (2026-08-18): Not sure yet — hold off on distribution-day responsive work until this is confirmed.

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

Answer: Yes we will be deploying soon, but I'm keeping things local until I'm ready to test with the team in one week.

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

Answer: I'm not sure how to do this but we should do it soon.

Steps to check (2026-08-18, written up per Grant's request — do this when you have
five minutes, for **both** the dev and prod projects since they're separate
Supabase projects with independent settings):

1. Log into [supabase.com/dashboard](https://supabase.com/dashboard) and select the project (see [web/README.md](../web/README.md)'s "Two Supabase projects" section for which project is which).
2. Left sidebar → **Database** → **Backups**.
3. That page shows whether backups are currently running, on what schedule, and how long they're retained. Note it down here or in a follow-up commit once checked.
4. If it says backups aren't enabled (common on free-tier projects — daily backups are typically a paid-plan feature), the options are: upgrade the plan, or stand up an external backup (e.g. a scheduled `pg_dump` of the prod project via a GitHub Action or cron job, stored somewhere outside Supabase).
5. Either way, write the answer here (what's enabled, what plan, retention window) so this stops being a guess — this table holds real children's PII and is the only record of a live drive once it starts.

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

### ~~TST-1 — Should the e2e suite be forced to `workers: 1`?~~ · Resolved

Implemented 2026-08-18 — `web/playwright.config.ts` now sets `fullyParallel: false` and
`workers: 1`, with a comment pointing back to this entry. No user decision needed; the fix
was the one already recommended here.

- Code: [web/playwright.config.ts:12-17](../web/playwright.config.ts#L12), [web/tests/e2e/helpers/cleanup.ts:12-18](../web/tests/e2e/helpers/cleanup.ts#L12), [web/README.md:76](../web/README.md#L76)
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
notes" field (not `sort_tag`, adding a child, or wishlist edits); US-19's whole
verification and shopping-list feature has no automated coverage at all, only
your one manual pass; and there is no mobile-viewport project anywhere. (The
"raising sponsor slots" gap this originally listed is gone along with the
feature itself — see ADM-2, resolved 2026-08-18. Checked: no existing e2e test
covered that race, so nothing needs updating there, just one fewer gap to close.)

- Code: [web/tests/e2e/concurrency.spec.ts:143-191](../web/tests/e2e/concurrency.spec.ts#L143), [web/lib/store.tsx:131-170](../web/lib/store.tsx#L131), [web/app/admin/families/[familyId]/page.tsx](../web/app/admin/families/%5BfamilyId%5D/page.tsx)
- Raised by: qa-tester
- GitLab: [issue #6](https://gitlab.com/reach-christmas-group/reach-christmas-project/-/issues/6)
