# Kids Gift Drive App — Design Doc

*Status: DRAFT — brainstorming, will change as we go. Last updated 2026-07-08.*

*Scale: ~400 families reached through Reach Christmas per year — comfortably within free-tier limits for the recommended stack (see §6).*

## 1. Purpose

Replace the spreadsheet-based process for the church's annual kids gift drive with
a small, low-maintenance web app that safely stores family/child data, lets
sponsors claim kids or wishlist items, and tracks the drive from intake through
distribution.

## 2. Who uses it

| Role | What they do |
|---|---|
| **Staff/Admin** | Create each year's drive, oversee all families/kids/sponsors/schools, run reports, manage volunteer accounts, resolve confidential/sensitive cases |
| **Volunteers/Coordinators** | Enter or verify family & kid intake data (usually transcribed from a school counselor's referral), mark gifts received, help at distribution |
| **Sponsors/Donors** | Browse available kids (first name + grade + wishlist only) and claim ones to buy for — self-service, no login required |
| **School partner / counselor** | Not a full app user in Phase 1 — refers families at their school. How this actually reaches the spreadsheet/app (does the org have a designated liaison whose contact info is tracked, or is it handled informally?) is still an open question — see §8. |

*Correction from earlier read of the spreadsheet:* the `Name`/`Phone Number`/`Email` columns are **the sponsor's** contact info (confirmed by you), not a school counselor's as I'd guessed from the pattern of one name recurring across many families at a school — that pattern is actually one generous sponsor claiming many kids across several families at once, which the data model already supports (see §4). This means intake vs. referral-liaison-tracking is still an open question, but sponsor tracking is not new — it already existed, just as a flat name/phone/email per card rather than a proper status-tracked record.

## 3. Core workflow

**Referral → Intake → Match → Fulfill → Distribute**

1. **Referral** — A partner school (via its counselor/contact) or a direct/confidential channel identifies a family in need.
2. **Intake** — A volunteer/staff member enters the family's kids, wishlist, sizes, and needs (or, if we build it later, the school contact enters it directly).
3. **Match** — A sponsor claims a child (a "card") to buy for.
4. **Fulfill** — Sponsor buys the gift(s) and drops them at the church; status tracked (pledged → purchased → received at church). Once at church, the admin team checks the gift against the wishlist and shops locally for anything a volunteer missed (→ verified), before it's cleared to go out.
5. **Distribute** — Gifts get to the child either via the partner school or a church pickup event, depending on how that year/school is run (see §7 open question on this — it's varied by year).

## 4. Data model (draft)

Grounded in the 2021 master spreadsheet structure, which had ~407 children across 12 partner schools plus a confidential tier:

- **Drive / Season** — year, referral/registration window, distribution date(s), status (open/closed/archived)
- **School (referral partner)** — name, single-letter code (used in card numbers, e.g. `C` = CCHS), contact person name/phone/email, default distribution method for that school (see below)
- **Family** — belongs to a School (or flagged **Confidential** with no school), a per-school family number (assigned automatically, not chosen by whoever's entering it — see SCHEMA.md's `create_family()`), privacy tier (normal / confidential), a family-level sort tag (see "Color" question below). `Family` is a distribution-day convenience for grouping siblings, not a strict household model — a real household with kids at different schools becomes multiple `Family` records, one per school (see §8).
- **Child** — belongs to a Family; card number (`{SchoolLetter}{FamilyNumber}.{ChildIndex}`, e.g. `C1.3`), first name, grade, age, sex, wishlist items (up to 3), specific needs, pant/shirt/shoe size, other notes. Only first name + grade are ever shown publicly (see §5).
- **Sponsor** — name, phone, email. The legacy sheet already captured this per child/card (one sponsor can claim multiple kids across multiple families — confirmed in the data, e.g. one CCHS sponsor claimed 7 different families' kids). We should model Sponsor as its own entity (not just free text per card) so the same person/group is recognizable across kids and across years.
- **Match/Assignment** — links a Sponsor to a Child (their "card"), status: pledged → purchased → received at church → verified → delivered. The legacy sheet only had two checkboxes (`Received`, `Delivered`); the app should track the fuller lifecycle so staff can see *who hasn't purchased yet*, not just who hasn't been delivered to. A volunteer can attach a free-text note once a card reaches "received at church" (e.g. what's missing from the wishlist); those notes consolidate into a shopping-list view for the admin team until the card is marked verified.
- **Distribution record** — per child/family: method (school delivery vs. church pickup — configurable per drive and possibly per school, since this has changed year to year), received/delivered checkboxes (mirrors the legacy `Received`/`Delivered` columns)
- **User account** — staff/volunteer login, role, which drive-year(s) they can access
- **Audit log** — who created/edited each record and when (important given this is children's PII)

## 5. Privacy & security (important — this holds kids' names, ages, schools, and sponsor contact info — no home addresses are collected)

- **Confidential tier**: some families (the legacy "Confidential" tab) need a higher privacy bar than a normal referral — no school shown, and (built) no first name shown even to volunteers with clearance, only a first initial — full name is only ever shown to admins, or on the one form where a cleared volunteer is actively editing that specific record. Only a small circle of staff should see full confidential records at all. See `displayFirstName()` in `lib/queries.ts`.
- **Least privilege by role**: only staff/volunteers see full family/child details (school, notes, sizes) and the referring contact's info. Sponsors see only a first name, grade, and wishlist — e.g. "Emma, 3rd grade, wants a bike" — never a school name, last name, or any address (none is collected anyway).
- **Enforce access rules at the database layer** (not just in app code) so a bug in the UI can't leak PII — e.g. Postgres Row Level Security if we use Supabase.
- **Data retention**: decide how long to keep past years' child/school-contact PII — likely archive or anonymize after each season rather than keep it all indefinitely.
- HTTPS everywhere, no secrets committed to the repo, regular backups of the database.

## 6. Tech stack — recommendation

Given: free/near-free budget, non-developer owner long-term, needs to be low-maintenance, and you want it ready before this year's drive.

**Recommended: Next.js (frontend) + Supabase (Postgres + Auth) + Vercel hosting.**

Why:
- Both Vercel and Supabase have free tiers that comfortably cover a nonprofit's scale (hundreds of families, not millions).
- Supabase gives you a real Postgres database, built-in authentication, and Row Level Security for the role-based access described above — without you having to run or patch a server yourself.
- This is a very common, well-documented stack, which matters for a project one person will maintain long after the initial build.
- Deployment is push-to-deploy (Vercel), so updates each year are low-effort.

Alternative considered: self-hosting on church infrastructure — more control, but someone has to keep the server patched and backed up year-round for a system that's only critical for ~2 months a year. Not recommended unless the church already has IT support committed to it.

**Planning Center Church Center**: the church already uses this, but you're not an admin there yet and wiring up an integration (e.g. SSO, or pulling family data from it) would take real setup work. Recommendation: build Phase 1 with our own lightweight auth (Supabase Auth) so we're not blocked on Church Center access, and revisit a Church Center integration in a later phase once/if admin access is sorted out and there's a clear reason to sync data (e.g. avoiding double data-entry for church-member families).

## 7. Phased scope

**Phase 1 — MVP (target: ready before this year's drive)**
- [x] Staff/volunteer intake of schools, families & kids (this alone replaces the spreadsheet) — `/admin/intake`, plus `/admin/families/[id]` for corrections and adding a sibling later
- [x] Confidential-tier flag with restricted visibility — any staff member can *create* a confidential referral now (see SCHEMA.md's RLS section), only cleared staff/admins can keep viewing it afterward
- [x] Public sponsor-facing page to browse and claim kids/wishlist items (no sponsor login required) — `/sponsor`
- [x] **Sponsor assignment tracking** — who claimed which card, and a real status lifecycle (pledged/purchased/received/verified/delivered), not just the old sheet's single received/delivered checkbox — `/admin/fulfillment`
- [x] **Admin verification + shopping list** — once a gift reaches church, staff can flag what's missing from the wishlist (a note on the card); the admin team checks/tops it up and marks it verified before it moves to delivery. Open notes consolidate into a printable shopping list — `/admin/fulfillment`, `/admin/shopping-list` (see docs/backlog.md US-19)
- [x] Distribution tracking flexible enough to handle either school delivery or church pickup, decided per drive/school — `/admin/distribution`
- [x] Printable cards — `/admin/print`. (Originally had a "(1 of 2)" copy notation for children with
  multiple sponsor slots; removed along with that whole mechanism per ADM-2, 2026-08-18 — one card per
  child, always, so there's nothing left to number.)
- [x] Drive (year) management — create/open/close a drive, exactly one `open` at a time — `/admin/drives`
- [x] Staff/permission management — promote/demote role, toggle confidential access — `/admin/staff`
- [x] Basic reporting: how many kids registered, how many matched, how many fulfilled, which sponsors are overdue — dashboard stat tiles

**Known follow-ups (not Phase 2 — near-term, already scoped)**
- [ ] Printable cards need a real nametag-sticker layout (`/admin/print`). The current layout is a plain
  index-card-style grid meant for regular paper — still needs a version sized/spaced to print directly onto
  adhesive nametag sticker sheets (e.g. Avery-style label sheets) for easy application, so cards can go
  straight from printer to being stuck on/attached to the physical gift or tree tag. Needs to know the actual
  label sheet product/dimensions being used before building the CSS grid for it.

**Phase 2**
- ~~Pin wishlist items to a specific card copy so multi-sponsor children can't have the same gift bought
  twice~~ — moot as of ADM-2 (2026-08-18): there is no longer any such thing as a multi-sponsor child, one
  card per child, always. See [SCHEMA.md §8](SCHEMA.md#8-wishlist_items--was-3-fixed-columns-opened-up).
- Sponsor accounts (so returning sponsors can see their history across years)
- Email/text notifications (reminders to sponsors, confirmation to school contacts)
- Dashboards for staff (progress toward goals, unmatched kids alerts)
- Possible school-contact self-service portal, if school counselors want to submit referrals directly instead of a volunteer transcribing them
- Possible Planning Center Church Center integration, once admin access is available and there's a clear syncing need

**Phase 3 (later, if useful)**
- Physical inventory/warehouse tracking of donated items
- Support for multiple sites/campuses under one drive
- Year-over-year reporting and trends

## 8. Open questions

- [x] ~~Roughly how many families/kids does the drive serve per year?~~ → ~400 families/year (Reach Christmas) — matches the ~407 kids found in the 2021 spreadsheet
- [x] ~~Old spreadsheet review~~ → done, see §4/§6 findings below and the summary at the top of this session
- [x] ~~What should sponsors see about a child?~~ → first name + grade only. No address, no school. *Updated 2026-11-18 (Grant):* the card a staff-assigned sponsor is emailed (US-77) also carries sizes, wish list, specific needs and M/F. Age stays off ("school year is close enough"). The public sponsor page (`public_available_cards`) is unchanged.
- [x] ~~Who else needs an admin account?~~ → Just you for now; others TBD once contact info is available. App should make it easy to add admins later without a rebuild.
- [x] ~~Existing church login system?~~ → Church Center exists but you're not an admin there yet; integration deferred to Phase 2 (see §6, §7)
- [x] ~~Should the sponsor-facing claim page require login?~~ → No login for sponsors. But admins need visibility into which sponsor is assigned to which child, plus status, so they can follow up on late sponsors — this is now a Phase 1 feature (§7).
- [x] ~~Is distribution one event day or scheduled pickups?~~ → Varies by year — some years drop gifts off at schools, some years have families/kids come to the church. Not decided yet for this year. **Design decision**: build distribution method as a per-drive (possibly per-school) setting rather than hardcoding one flow, so this doesn't force a redesign whichever way it goes this year.
- [x] ~~Do sponsors capture a name/email when they claim a card?~~ → Yes — confirmed the legacy sheet's `Name`/`Phone Number`/`Email` columns are the **sponsor's** contact info (I'd initially misread this as a school counselor's — corrected in §2). Sponsor tracking already existed in spirit; it just needs a proper status lifecycle instead of one checkbox.
- [x] ~~Now that `Name`/`Phone`/`Email` = sponsor, is there any separate contact tracked for the **school
  referral liaison** (e.g. a counselor who submits the family list to the church), or is that relationship
  handled informally/outside the spreadsheet entirely?~~ → **Resolved** (OPEN_QUESTIONS.md ADM-3,
  2026-08-18): a real liaison workflow is confirmed wanted — schools are the church's sole go-between for
  confidential/direct-referral-less families — and "the school liaison should be inherited from a school."
  The `liaison_*` columns moved from `drive_schools` to `schools` accordingly; see
  [SCHEMA.md §3/§4](SCHEMA.md#3-schools--reusable-year-over-year).
- [ ] What is the **"Color"** field in the old spreadsheet actually for? Best guess: a per-family wrapping-paper/bin color code used to sort physical gifts back together at distribution. Worth confirming since it may or may not be relevant to a digital-first version.
- [x] ~~Is the school list fixed year to year, or does it change each drive?~~ → Changes year to year, though some schools may repeat. Confirmed OK to just rebuild the school list from scratch each drive via "Add school" — no import/carry-forward needed, matching how `schools`/`drive_schools` already separates "the school exists" from "the school is in this year's drive."
- [x] ~~For "Confidential" families — who decides a family goes in that tier, and who specifically should be allowed to view them?~~ → Resolved during the fresh-eyes review: any staff member can *create* a confidential referral (they already know the details firsthand — that's not new exposure), but only admins/cleared staff can go on *viewing* it afterward, plus the original creator for their own submission. See SCHEMA.md's RLS section for the mechanism.
- [x] ~~Does a referral ever cover just one child from a family, or always the whole sibling group at once?~~ →
  Yes, a family can be just one child (other kids in the household may not get gifts at all) — already
  supported, no change needed. The harder real-world case: `Family` is modeled as belonging to exactly one
  school, but a real household's siblings sometimes attend different schools (elementary/middle/high).
  **Decision: leave this split.** A cross-school household becomes two-or-more separate `Family` records
  (one per school) rather than one record spanning schools. `Family` exists purely as a distribution-day
  convenience for volunteers (so siblings' gifts can be grouped/sorted together) — not as a strict
  household model — so this is an accepted, known limitation rather than something the schema needs to
  solve.
- [x] ~~Should sponsor email be optional or required when claiming a card?~~ → Keep it required (confirmed,
  no change) — it's the reliable way staff follow up on overdue pledges. The old `claim_card` function
  still accepts email as an optional parameter at the database level, but it's no longer the path a
  sponsor's claim goes through (see SPN-3 below) — `request_claim_code()`, the function that now starts a
  claim, requires it: there's nothing to send a verification code to without one.
- [x] ~~SPN-3: should claiming a card require confirming an email before it counts as `pledged`?~~ → Yes, via
  a 6-digit code typed back on the same claiming page (Grant, 2026-08-18). Implemented end to end —
  migration in
  [supabase/migrations/20260818160000_email_verified_claims.sql](supabase/migrations/20260818160000_email_verified_claims.sql)
  (see SCHEMA.md's `card_claim_verifications` section) and the two-step send-code/enter-code UI in
  [web/app/sponsor/SponsorBrowser.tsx](web/app/sponsor/SponsorBrowser.tsx). Applied to dev and confirmed
  working live 2026-08-19 (a Resend key is stored in dev's Supabase Vault; two follow-up migrations fixed
  bugs only reachable once real email-sending was exercised — see
  [supabase/migrations/20260818170000_fix_pgcrypto_schema_qualification.sql](supabase/migrations/20260818170000_fix_pgcrypto_schema_qualification.sql)
  and
  [supabase/migrations/20260818180000_fix_attempt_cap_off_by_one.sql](supabase/migrations/20260818180000_fix_attempt_cap_off_by_one.sql)).
  Not yet applied to prod.
- [x] ~~How will distribution actually run this year (one church pickup event, school drop-offs, or a mix)?~~
  → Decided 2026-09-29: school drop-off for elementary kids. The church collects gifts from sponsors as
  usual, then delivers each family's gifts to their school counselor at the school — no family comes to the
  church building for an elementary child's gift. Set the drive's (and/or each school's) distribution
  method to "School drop-off" on `/admin/drives` / `/admin/schools`; the mechanism already fully supports
  this, no code change needed there. The intake form's "can you get to church pickup" question is now moot
  and was removed (both languages) in favor of a plain delivery-and-consent statement — see
  `web/lib/intakeFormDefinition.ts`'s `pickup_consent` section. `families.can_reach_church_pickup` stays in
  the schema, unused, rather than migrated away (nothing downstream read it even before this).
- [x] ~~Deployment (Vercel now vs. staying local)~~ → Grant asked for a deploy guide 2026-08-19 — see
  [docs/DEPLOY.md](docs/DEPLOY.md). Not yet executed; that doc is the runbook for whenever it happens.

## 9. Next steps

- [x] Confirm/adjust this doc together
- [x] Sketch the database schema in more detail → see [SCHEMA.md](SCHEMA.md)
- [ ] Scaffold the Next.js + Supabase project
- [ ] Build Phase 1 features
