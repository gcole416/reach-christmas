# Self-Hosted Intake Forms — Design & Schema

*Status: DRAFT v2 — open questions from v1 resolved. Not yet merged into [DESIGN.md](DESIGN.md) or
[SCHEMA.md](SCHEMA.md). Nothing here has been run against a database.*

Replaces the Google Forms + volunteer-transcription step in [DESIGN.md §3](DESIGN.md#3-core-workflow)
with forms we host, version, and import from directly.

See [INTAKE_FORM_DRAFT.md](INTAKE_FORM_DRAFT.md) for the actual proposed questionnaire.

---

## 1. What this changes

Today's workflow (DESIGN §3) is **Referral → Intake → Match → Fulfill → Distribute**, where "Intake"
means a volunteer retypes a counselor's referral into the app. This feature collapses referral and
intake into one chain with no retyping:

```
Staff publishes form
  → counselor gets a school-scoped link
    → counselor forwards it to families
      → family fills it out and submits
        → counselor reviews the roster and verifies
          → staff imports the verified submission into the drive
```

**This closes an open question.** DESIGN §8 asks whether a school referral liaison is tracked anywhere
or handled informally. This feature requires it: `drive_schools.liaison_email` becomes load-bearing,
because it is the address the review link goes to. Those columns can no longer be null for a
participating school.

---

## 2. The link model

**A link is scoped to a `drive_school`, never to a family.** One link per school per drive. The counselor
forwards it to as many families as they like; every submission carries the school it came from, so we
know which counselor to notify — while the link identifies nobody in advance and can be shared freely.

**Decided: no per-family invite tokens.** Links go out blind. The trade-off — we cannot report on who
*hasn't* responded — is accepted. Counselors instead see a running roster of who **has**, which is the
practically useful half anyway since they know their own referral list.

*This is worth re-confirming with a counselor before build, but the design assumes it.*

### Link flavors

| Flavor | `drive_school_id` | Channel | Verification |
|---|---|---|---|
| **School link** | set | `family` | counselor verifies |
| **Counselor direct link** | set | `counselor` | **auto-verified at submit** |
| **Confidential/direct link** | null | `family` | cleared staff verify |
| **Staff transcription** | set | `staff` | auto-verified at submit |

The **counselor direct link** is the required backup path: a counselor can fill out a family card
themselves for families without email, or over the phone. Since the counselor *is* the verifier, these
skip review and land straight in the staff import queue.

### Token handling

- **Form link tokens** (`form_links.token`) — plaintext. They permit only *writing* a submission and
  expose no PII. Staff need to re-copy them, so they must be readable.
- **Review tokens** (`review_tokens.token_hash`) — **hashed only**. These permit *reading* children's
  names and ages, and now live for most of a season (see §3), so a database leak must not hand over a
  working key. Shown once at send time; a counselor who loses theirs requests a new one.

---

## 3. Verification — what the counselor is actually doing

The counselor is performing a **plausibility check on family composition**, not a data-quality audit.
They confirm: these are real children of a family I referred, the number of kids is right, and the ages
look correct — no aunts, uncles, or dogs added to the list.

**Decided (amended 2026-08-30): counselors may correct `first_name`/`age`/`grade` typos only — nothing
else.** They are confirming family composition, not vetting gift requests, so their screen never shows
and they never touch wishlist items, sizes, specific needs, or notes (unchanged from "What their screen
shows," below). `verify_submission()` takes an optional correction payload scoped to exactly those three
per-child fields; every other part of `answers` stays a single immutable blob, and a correction is
recorded in `submission_events` same as any other action.

**Decided: the counselor's word is final.** Occasional duplicates or an extra child are acceptable
outcomes. Duplicate detection is therefore a *soft hint* in the staff import queue, not a blocker, and
not a priority for year one.

### What their screen shows

Compact and scannable — first name, age, grade, one row per child. **Not** wishlists, sizes, or notes;
those aren't what's being checked and only slow the review down. Their view is a roster of the whole
season for their school, with status, so they can see at a glance who has come in.

Because that view is a season-long roster of children's names, the review token should expire at drive
close rather than in 7 days, and reissue must be self-service.

### Lifecycle

```
draft ──► submitted ──► under_review ──┬─► verified ──► imported
                                       └─► rejected / duplicate
```

`changes_requested` is **dropped** — with no counselor editing and no family-correction loop in year
one, nothing produces it. Errors found later are handled on the working record (§7).

Channels `counselor` and `staff` jump straight to `verified` at submit.

### "Source of truth" — clarification

The submission is the immutable **provenance record**: evidence of what the family said and what the
counselor attested to. The `families`/`children` rows are the **working records**, created from it and
linked back. Staff will need to fix a typo in October, and the drive data has to stay editable — so
divergence is expected, visible, and fine.

### Verify → import: staff-gated

**Decided: staff-gated for year one — and, per the 2026-08-30 counselor-trust decision, a rubber stamp,
not a review.** Verified submissions land in an admin queue rather than auto-creating rows, but staff are
not expected to resolve duplicates or clean up messy data there anymore (the counselor's typo-fix pass in
§3 covers the realistic cases). A staff member still opens each one and clicks Import — that click writes
`families`, `children`, and `wishlist_items` — because it's the only point where one person sees every
family before it becomes real, and the natural place to set confidential tier. Easy to relax later; much
harder to tighten after something bad has been imported.

---

## 4. Spanish — the translation round-trip

**Decided: Spanish is required for year one, in both directions.** Forms go out in Spanish; answers must
come back readable in English for volunteers, admins, and purchasing.

These are two separate problems:

### 4.1 Static labels — easy

Field labels, help text, select options, and validation messages live as locale objects in the form
definition. The link carries a `locale`, so a counselor hands out the Spanish link to Spanish-speaking
families. Solved by design, no runtime work.

### 4.2 Free-text answers — the real work

A family types *"una bicicleta rosa y una muñeca"*. Purchasing needs to read it in English. Affected
fields are exactly the free-text ones: **wishlist items, specific needs, other notes** — and "Other"
size values.

**Design rules:**

1. **Translate once, at import — never at display.** A printed card must say the same thing every time
   anyone looks at it. Per-view translation is nondeterministic, costs per read, and can change between
   the card a sponsor claimed and the card they were handed.
2. **Store both. Never overwrite the original.** The family's own words are the record of what they
   asked for, and staff need them when a translation reads oddly.
3. **English is what the working records hold.** `wishlist_items.description`, `children.specific_needs`,
   and `children.other_notes` are always English — that's what sponsors see on the public card and what
   purchasers buy from. The original goes in a parallel `*_source` column.
4. **Flag translated text in staff UI** so a purchaser knows they're reading machine output and can
   check the original.
5. **Staff can edit the English at import.** It's a working record, not the attestation — correcting an
   awkward translation is expected and shouldn't require touching the submission.

At ~400 families a season the API cost is negligible whichever engine you pick.

### 4.3 Reduce the translation surface

Every field that can be a select instead of free text is a field nobody has to translate. Grade, age,
and gender are already structured. **Sizes should become selects with an "Other" escape hatch** — a
dropdown value maps to a known English string, and only the rare "Other" text needs translating. This
also fixes the "shoe size: medium" problem. The `text` column type in SCHEMA.md still works fine.

Wishlist and specific-needs are irreducibly free text. That's the whole translation load.

### 4.3b Two Phase 1 decisions that will bite the Spanish work

Both found during the Phase 1 build (2026-09-01) and recorded here rather than in
a ticket, because this section is what the person doing Spanish will read first.

1. **The family-facing error filter is ASCII-shaped.** `friendlyMessage()` in
   `web/components/intake/format.ts` decides whether a server message is safe to
   show a family by testing whether it looks like a *sentence* rather than a
   Postgres error code. That classifier's character class was built and verified
   against an English-only definition. `¿`, `á`, `ñ` and friends fall **outside**
   it, so Spanish user-facing messages would be wrongly suppressed and replaced
   with a generic line. Re-verify the classifier against the Spanish message set
   before shipping it — the failure is silent and looks like "the form just says
   something generic now."
2. **One status message interpolates an enum value.** `'This registration is %s
   and can no longer be confirmed here.'` only stays readable because
   `under_review` — the single `submission_status` value containing an
   underscore — is excluded from the set that reaches it. Adding a new
   underscore-bearing status (`needs_info`, say), or letting `under_review`
   through, silently degrades that message to the generic fallback via the same
   classifier.

Neither is a Phase 1 defect: Phase 1 is English-only by design, and the
classifier is a deliberate improvement over the blocklist it replaced (which
failed *open*, leaking raw Postgres strings to families).

### 4.4 Get the Spanish reviewed

The draft translations in [INTAKE_FORM_DRAFT.md](INTAKE_FORM_DRAFT.md) need a native or fluent speaker
on staff to read before they go to families. Form wording carries tone — a stiff or clinical translation
reads as bureaucratic to a family already uneasy about asking for help.

---

## 5. Schema additions

Conventions follow [SCHEMA.md](SCHEMA.md): uuid PKs, `timestamptz` audit columns, enums for small fixed
status sets.

```sql
create type submission_status  as enum ('draft','submitted','under_review','verified','imported','rejected','duplicate');
create type submission_channel as enum ('family','counselor','staff');
```

### 5.1 `forms`

```sql
create table forms (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid references drives(id) on delete cascade,  -- null = reusable template
  slug text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (drive_id, slug)
);
```

### 5.2 `form_versions` — immutable published definitions

```sql
create table form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id) on delete cascade,
  version int not null,
  definition jsonb not null,
  published_at timestamptz,                 -- null = still editable
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (form_id, version)
);
```

Enforce immutability with a trigger rejecting `update` on `definition` once `published_at` is set.
Schema alone can't express it, and it's exactly the rule that gets broken by accident.

### 5.3 `form_links`

```sql
create table form_links (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  drive_school_id uuid references drive_schools(id),   -- null = confidential/direct
  form_version_id uuid not null references form_versions(id),
  token text not null unique,                          -- url-safe, >=32 bytes entropy
  label text,                                          -- "CCHS — Spanish — 2026"
  locale text not null default 'en',
  channel submission_channel not null default 'family',
  opens_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  max_submissions int,
  submission_count int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index form_links_drive_school_idx on form_links (drive_school_id);
```

Multiple links per school is the point: each counselor needs an English link, a Spanish link, and their
own direct-entry link.

### 5.4 `form_submissions`

```sql
create table form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_link_id uuid not null references form_links(id),
  form_version_id uuid not null references form_versions(id),
  drive_id uuid not null references drives(id) on delete cascade,
  drive_school_id uuid references drive_schools(id),   -- denormalized from the link at submit time
  channel submission_channel not null default 'family',
  status submission_status not null default 'draft',

  source_locale text not null default 'en',
  answers jsonb not null default '{}'::jsonb,          -- exactly as submitted, never modified
  answers_en jsonb,                                    -- machine translation; null when source is 'en'
  translated_at timestamptz,
  translation_engine text,

  submitter_name text,
  submitter_phone text,
  submitter_email text,

  submitted_at timestamptz,
  first_viewed_at timestamptz,
  verified_at timestamptz,
  verified_by_label text,                              -- counselor's typed name; they have no profile row
  verified_via_review_token uuid references review_tokens(id),
  imported_at timestamptz,
  imported_by uuid references profiles(id),
  imported_family_id uuid references families(id),
  resolution_note text,

  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index form_submissions_queue_idx on form_submissions (drive_school_id, status);
create index form_submissions_drive_status_idx on form_submissions (drive_id, status);
```

`drive_school_id` is denormalized deliberately: if a link is revoked or retargeted, the submission must
still remember which school it came from.

### 5.5 `review_tokens`

```sql
create table review_tokens (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  drive_school_id uuid references drive_schools(id),   -- null = confidential/staff queue
  token_hash text not null unique,
  issued_to_email text not null,
  issued_by uuid references profiles(id),
  expires_at timestamptz not null,                     -- drive close, not 7 days (see §3)
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
```

### 5.6 `submission_events`

```sql
create table submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references form_submissions(id) on delete cascade,
  event text not null,               -- 'submitted' | 'viewed' | 'verified' | 'rejected' | 'imported'
  actor_kind text not null,          -- 'family' | 'counselor' | 'staff' | 'system'
  actor_profile_id uuid references profiles(id),
  actor_label text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index submission_events_submission_idx on submission_events (submission_id, created_at);
```

Separate from `audit_log` because most actors here are **not** `profiles` rows — anonymous families and
token-bearing counselors, which `audit_log.changed_by uuid references profiles(id)` can't represent.

### 5.7 Changes to existing tables

```sql
-- provenance
alter table families add column source_submission_id uuid references form_submissions(id);
alter table children add column source_submission_id uuid references form_submissions(id);

-- contact info the pickup workflow implies but the schema never had
alter table families add column guardian_name text;
alter table families add column guardian_phone text;
alter table families add column guardian_email text;
alter table families add column preferred_language text not null default 'en';
alter table families add column consent_given_at timestamptz;

-- post-verification error handling (§7)
alter table families add column needs_followup boolean not null default false;
alter table families add column followup_note text;

-- the family's own words, preserved next to the English working values (§4.2)
alter table wishlist_items add column description_source text;
alter table wishlist_items add column source_locale text;
alter table children add column specific_needs_source text;
alter table children add column other_notes_source text;
```

`children.source_submission_id` is nullable on purpose — it distinguishes kids who came through a form
from kids staff added by hand.

---

## 6. Server functions

Anonymous and token-bearing users get **no direct table access**. Everything runs through
`security definer` functions, consistent with the `claim_card()` approach in SCHEMA.md.

| Function | Caller | Does |
|---|---|---|
| `get_form(token)` | anon | Returns the definition in the link's locale + school display name, if live. **No PII.** |
| `submit_form(token, answers, contact)` | anon | Validates server-side against the pinned version, inserts, increments count, queues notification. Auto-verifies for `counselor`/`staff` channels. |
| `get_review_roster(review_token)` | counselor | Whole-season roster for their school: names, ages, grades, status. Marks `first_viewed_at`. Also returns `correction_fields` — the *pinned definition's* full rule for each of the three fields §3 lets a counselor correct (`first_name`, `age`, `grade`), as `{id, label, type, required, max_length, min, max, options}`. Blank-questionnaire data, not submission data. It is what the roster's edit controls are built from, so grade is a picker over the same option list `verify_submission` validates against, age's bounds are the definition's rather than hard-coded, and a corrected name can't exceed a limit the server will reject. A field no roster version defines comes back `null`, meaning render it read-only — never a free-text box. |
| `verify_submission(review_token, id, verifier_name, corrections?)` | counselor | Sets `verified`, records the attestation. `corrections` is optional and scoped to `first_name`/`age`/`grade` per child only — nothing else in `answers` is writable. |
| `reject_submission(review_token, id, reason)` | counselor | Sets `rejected` or `duplicate`. |
| `import_submission(id)` | staff | Creates `families` + `children` + `wishlist_items` from `answers_en` (falling back to `answers`), copies originals into `*_source`, sets `imported`. **Idempotent.** |

Two rules for the code review checklist:

1. **`submit_form` validates server-side against `form_version.definition`.** Client-side validation is
   a convenience, not a control.
2. **`import_submission` is idempotent.** A double-click must not create two families.

Verification confirms *"these are real children with these names and ages."* It does not confirm the data
is well-formed. Age range, grade membership, at-least-one-child, and wishlist counts belong in
`submit_form`, before a human sees it.

---

## 7. Post-verification errors

**Decided: errors found after verification are fixed on the working record, not by re-opening the
submission.** `families.needs_followup` plus a "families needing counselor follow-up" report covers it.

The realistic cases, and why none of them want the submission re-opened:

| What happens | Where it's caught | Fix |
|---|---|---|
| First name misspelled | Card printing | Edit `children.first_name` |
| Age and grade contradict | Import review | Edit at import |
| Same family submitted twice | Import queue duplicate hint | Mark one `duplicate`, don't import |
| Shoe size entered as "medium" | Import or purchasing | Edit; select-with-Other prevents most (§4.3) |
| Wishlist item not feasible ("a puppy") | Purchasing | Flag follow-up, counselor conversation |
| Family moves districts in November | Counselor or no-show | Flag follow-up, possibly withdraw |

The last two are the ones that need the counselor's help, which is exactly what the flag and report are
for.

---

## 8. Confidential channel

**Decided: two named staff, not all admins.** The existing `profiles.can_view_confidential boolean` in
SCHEMA.md already models this correctly — it's deliberately separate from `role`.

**Implementation note worth stating explicitly:** the confidential review queue and confidential
submissions filter on `can_view_confidential = true`, **never** on `role = 'admin'`. Writing the admin
check is the natural mistake and it silently widens access to every admin.

Confidential-channel submissions (`drive_school_id is null`) must be invisible to volunteers *and* to
uncleared admins, matching how confidential `families` already work.

---

## 9. Row Level Security

Extends [SCHEMA.md](SCHEMA.md#row-level-security--who-sees-what):

| Table | Anonymous | Counselor (review token) | Volunteer | Admin | Confidential-cleared |
|---|---|---|---|---|---|
| `forms`, `form_versions` | none (via `get_form`) | none | read | read/write | read/write |
| `form_links` | none | none | read | read/write | read/write |
| `form_submissions` (school) | none (functions only) | own school, via function | read own drive | read/write | read/write |
| `form_submissions` (confidential) | none | none | **none** | **none** | read/write |
| `review_tokens` | none | none | none | write-only (issue) | write-only |
| `submission_events` | none | none | read | read | read |

Submissions hold children's names and ages *before* anyone has vetted them. They deserve the same
protection as `children`, not a lower bar because they're "just form data."

---

## 10. Retention

**Decided: purge unfulfilled submissions at drive close.**

- `rejected`, `duplicate`, and never-imported submissions — **hard delete at drive close.** They hold
  children's PII with no corresponding drive record and no reason to persist.
- `imported` submissions — retained through the drive year as provenance, then `answers`/`answers_en`
  stripped at archive, leaving the event trail.

**Dependency worth noting:** this is *why* the family's original Spanish wording is copied onto
`wishlist_items.description_source` and friends at import (§5.7). If it only lived on the submission,
purging would destroy the record of what the family actually asked for.

---

## 11. Operational risks

**Email deliverability to school districts.** The biggest practical threat. District mail filters are
aggressive with unfamiliar sending domains, and a review link that lands in quarantine looks exactly
like a counselor ignoring you.

- Verified sending domain with SPF, DKIM, and DMARC configured.
- An established transactional provider (Resend, Postmark, SES) — never SMTP from the app server.
- **Build the manual fallback on day one:** a staff screen showing the review link so it can be sent by
  hand or read over the phone. Assume you'll need it.
- Have counselors allowlist the sending address during onboarding, before the drive opens.

**Notification volume.** One email per submission means forty emails to a counselor with forty families.
Use a **daily digest** — "6 new families are waiting for your review" — with immediate sends reserved for
their first submission and the deadline reminder.

**Spam and prank submissions.** The public link is open to the internet by design. In order of value:
nothing reaches the real tables without human verification (by far the strongest control), plus a
honeypot field, per-IP rate limiting in `submit_form`, `max_submissions` per link, and `expires_at`
always set.

> **Correction (2026-08-30, from reach-reviewer's US-20 audit).** Two claims in the paragraph above
> are not true of the built system, and both matter before the 10/1 launch:
>
> - *"Nothing reaches the real tables without human verification"* holds only for `family`-channel
>   links. `counselor` and `staff` channel links auto-verify at submit by design (§2), and
>   `form_links.token` is plaintext and readable by **every authenticated user** — so any volunteer
>   could read a counselor-direct token and submit entries that skip review entirely. Inert in Phase 1
>   because no such link exists; tracked as **ADM-20** and must be closed before the first
>   counselor-direct link is issued.
> - **There is no per-IP rate limiting.** It was deliberately left out of Phase 1 (it would throttle a
>   serial test suite), and the `form_submissions.ip_hash` column is now written as `null` — an
>   unsalted SHA-256 of an IPv4 address is a 32-bit keyspace, i.e. reversible, which is stored PII
>   wearing a hash costume and it sat next to children's names. Before anything writes to that column
>   again it must be an HMAC with a Vault-held secret. The Phase 1 controls are the honeypot,
>   `max_submissions`, and `expires_at`.

**Counselors are busy in November.** Verification depends on someone who doesn't work for you and has a
day job. Build the "N families waiting since [date]" staff report early and treat counselor follow-up as
a first-class workflow.

---

## 12. Remaining open questions

- [ ] Confirm with a counselor that a "who has responded" roster is enough, and nobody needs "who
      hasn't." (§2 — the design assumes yes.)
- [ ] Which translation engine, and does staff want a review step on low-confidence translations or just
      the ability to edit at import? (§4.2 — design assumes edit-at-import only.)
- [ ] Field-level sign-off on [INTAKE_FORM_DRAFT.md](INTAKE_FORM_DRAFT.md), especially the questions
      whose answers have nowhere to live in the current schema.
- [ ] Does the church need a written consent line from the guardian, and has anyone checked what the
      church's existing policy says about collecting minors' data? Worth one conversation before launch.

---

## 13. Build order

**Phased against two real dates (added 2026-08-30): steps 1–4, English-only, one school, target the 9/9
walkthrough demo. Steps 5–6 target the 10/1 counselor launch.** See `docs/backlog.md` for the story
breakdown.

1. `forms` / `form_versions` / `form_links` + a hand-authored definition JSON. No builder UI.
2. Public form renderer — repeating child section, mobile-first, EN/ES, honeypot — plus `get_form` and
   `submit_form`.
3. Staff screens: create/copy/revoke links, view the submission queue.
4. `review_tokens` + counselor roster + `verify_submission`. **Test the email path against a real
   district address here** — if deliverability fails, the design changes.
5. Translation at import + `import_submission` + staff import queue with duplicate hints.
6. Digest notifications, follow-up flag, and the "waiting on you" reports.
7. Only then, if still wanted: a staff-facing editor for labels and optional questions.

Steps 1–5 are the whole feature. Everything after is polish that can land mid-drive.
