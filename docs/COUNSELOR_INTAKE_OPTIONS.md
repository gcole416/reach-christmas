# Counselor intake: form or app?

Discussion prep for the 2026-08-26 team meeting, written in response to a note in
[Notes_8.10.txt](Notes_8.10.txt): *"Contacts are only counselors, we can't get
last names — find ways to improve what they give."* That's really two
questions — **what** we ask counselors for, and **how** their answers reach
this app. This doc is a framework for the second question; the first depends
on the actual current Google Form, which gets reviewed live in the meeting.

A nicely formatted version of this same content is also published as an
artifact for screen-sharing in the meeting — ask Grant for the link if it's
needed.

## Where this stands today

Counselors are not users of this app — by design, they're an informal,
offline channel (see the role table in [AGENTS.md](../AGENTS.md)). The
referral has always reached OneLife as a Google Form, consolidated by hand
into a spreadsheet (the legacy file behind
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) DOC-8), which church staff then re-key
into the app's own intake form ([web/app/admin/intake](../web/app/admin/intake)).
Two systems, one manual bridge between them.

The question underneath the meeting note: is the fix a better form, a better
bridge, or replacing the bridge entirely?

## Three paths

### A — Keep the Google Form, add an import

**Smallest lift.** Counselors keep filling out the same form they already
know. Church staff get an "Import referrals" screen in the admin app that
reads the form's spreadsheet export, maps its columns to family/child
records, and shows a preview — flagging anything that doesn't cleanly match
(unrecognized school, ambiguous referral type) for a human to resolve before
it commits.

- **In favor:** zero change for counselors — no new tool, no new account.
  Form questions can change in minutes if the meeting adds new ones (e.g. a
  sibling-at-another-school flag). Counselors never touch the app, so today's
  privacy boundary is untouched.
- **Trade-offs:** two schemas to keep in sync — a form edit can silently
  break the import mapping. Validation only happens at import time, in a
  batch, not as the counselor types. Staff still do a manual review pass
  before anything commits.

### B — Build an internal counselor form

**Largest lift.** Counselors get a link into the app itself — a scoped
submission form, no Google Form, no spreadsheet, no re-keying. Referrals land
as real rows from the moment they're typed, validated against the actual
current drive (a real school picker, structured fields) rather than free
text.

- **In favor:** one system, one source of truth — nothing to import or
  reconcile. Real-time validation (can't reference a school that isn't in
  this year's drive). Sets up the "has this school finished sending
  referrals" progress view for free.
- **Trade-offs:** new development — a counselor-facing form, a new access
  model, a new UI surface. Counselors go from zero access to entering real
  children's data into a live system. Meaningfully more work than A or C.
- **Worth naming out loud:** [AGENTS.md](../AGENTS.md) currently states
  counselors are "not an app user in Phase 1." This option reverses that on
  purpose — it needs its own access and privacy design (who can see what a
  counselor submits, whether confidential referrals work the same way), not
  just a new page.

### C — Form stays, bridge gets automated

**Middle ground.** Counselors keep the Google Form (familiar, zero new
access model). Instead of a hand-maintained spreadsheet in between, the form
writes to a Sheet the app reads directly — an admin-triggered sync that still
previews before committing, same as Option A, but without a human ever
copy-pasting between spreadsheet and app.

- **In favor:** removes the specific pain of hand-consolidating a
  spreadsheet. No new counselor-facing tool, no access-model change. Smaller
  build than B — a sync job, not a new form plus a validation layer.
- **Trade-offs:** still two schemas (form questions vs. app fields) — same
  drift risk as A. Still batch validation, not real-time, at the sync step.

## Questions worth resolving in the room

- **What does the current form actually ask?** A field-by-field diff against
  what the app's intake form captures is the fastest way to see if this is a
  data problem, a process problem, or both.
- **What's the real volume?** A handful of schools sending a few dozen
  referrals a season argues for A or C. Dozens of schools and hundreds of
  referrals starts to justify B's cost.
- **Data-incomplete vs. hard-to-track** — Grant's answer going in was "both."
  Which one hurts more in practice: forms coming back thin, or just not
  knowing who's sent what?
- **Does this need to ship before counselors get the form on 10/1?** That's
  about five weeks out from today. A or C are buildable in that window; B
  likely is not, this season.
- **If B is ever on the table:** does a counselor-facing form need the same
  confidential-referral handling families get today, or a simpler version?

## The season, for context

| When | What |
|---|---|
| 8/10 | Reach team meeting — source of the notes this doc responds to |
| 8/26 | Today |
| **9/21** | Software Acceptance Review — team deep-dives the **prod** deployment for real-content readiness |
| **10/1** | Referral form goes out to counselors — this decision needs to be live by here |
| 11/1 | OneLife needs names in the system |
| 11/14 | Sponsor sign-ups open on the names |
| 12/5–6 | Gifts due from sponsors |
| 12/7–14 | Shopping window (gaps sponsors missed) |
| 12/14–16 | Gifts sent |
| 12/19 | High school shop date |
| 12/20 | OneLife church family pickup |

## Sources

[AGENTS.md](../AGENTS.md) (role model and Phase-1 access boundary),
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) DOC-8 (legacy spreadsheet),
[Notes_8.10.txt](Notes_8.10.txt) (the meeting notes this doc responds to).
