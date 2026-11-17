import type { ChurchCenterSnapshot } from "./sponsorCsv";

// Mirrors SCHEMA.md — the TypeScript shape of the database. Row shapes
// arriving from Supabase (snake_case) get converted to these (camelCase) at
// the boundary in lib/supabase/mappers.ts.

export type DriveStatus = "draft" | "open" | "closed" | "archived";
export type DistributionMethod = "school_dropoff" | "church_pickup";
export type AssignmentStatus =
  | "pledged"
  | "purchased"
  | "received_at_church"
  | "verified"
  | "delivered"
  | "cancelled";
export type AppRole = "admin" | "volunteer";

// High schoolers (grades 9-12) shop for their own gifts at a store shopping
// day (docs/backlog.md US-32/US-35). This is where staff track that.
export type ShopDayStatus = "not_contacted" | "invited" | "confirmed" | "attended";

export interface Drive {
  id: string;
  year: number;
  name: string;
  status: DriveStatus;
  referralWindowStart: string | null;
  referralWindowEnd: string | null;
  defaultDistributionMethod: DistributionMethod | null;
}

// Liaison contact lives on the school itself (ADM-2 answer, 2026-08-18: "the
// school liaison should be inherited from a school"), not re-entered per
// drive — see supabase/migrations/20260818150000_school_liaison_on_schools.sql.
export interface School {
  id: string;
  name: string;
  liaisonName: string | null;
  liaisonPhone: string | null;
  liaisonEmail: string | null;
}

export interface DriveSchool {
  id: string;
  driveId: string;
  schoolId: string;
  code: string;
  distributionMethod: DistributionMethod | null;
  /** US-42: skip this school in the daily counselor review digest, even when
   *  households are pending. Per-drive, not per-school — a school might want
   *  digests one season and not the next. */
  digestPaused: boolean;
}

export interface Family {
  id: string;
  driveId: string;
  driveSchoolId: string | null;
  familyNumber: number;
  isConfidential: boolean;
  internalNotes: string | null;
  // --- intake-form provenance and contact (US-20) -------------------------
  // All added by supabase/migrations/20260830120000_intake_forms.sql and
  // populated ONLY by import_submission(). A family a volunteer typed in by
  // hand has sourceSubmissionId === null and null contact fields — that
  // difference is exactly what distinguishes the two, so don't assume these
  // are present.
  //
  // Set when this family came in through the intake form: the id of the
  // form_submissions row it was imported from.
  sourceSubmissionId: string | null;
  // The guardian's own words from the form. `families` had no contact info of
  // its own before this (see OPEN_QUESTIONS DB-19); the church-pickup workflow
  // needs a phone number.
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  // 'en' | 'es' in practice; free text in the column because the option list
  // lives in the form definition, not the schema. Defaults to 'en'.
  preferredLanguage: string;
  // Stamped from the form's consent checkbox at import; null for a
  // hand-entered family, which never collected one.
  consentGivenAt: string | null;
  // INTAKE_FORM_DRAFT.md §3.1 — "Yes" | "No" | "Not sure", free text for the
  // same reason as preferredLanguage.
  canReachChurchPickup: string | null;
  // INTAKE_FORMS.md §7 — errors found after the counselor verified are fixed
  // on the working record and flagged here, not by reopening the submission.
  needsFollowup: boolean;
  followupNote: string | null;
  distributionMethodOverride: DistributionMethod | null;
  scheduledPickupAt: string | null;
  checkedInAt: string | null;
  checkedInBy: string | null;
  createdBy: string | null;
  // `families.updated_at`, maintained by the set_updated_at BEFORE UPDATE
  // trigger (supabase/migrations/20260708120000_init.sql). Used as the row
  // version for concurrent-edit detection in store.tsx's saveFamilyEdit —
  // treat it as an OPAQUE STRING. Pass it back exactly as it arrived; do not
  // reformat it or round-trip it through `new Date(...)`/`.toISOString()`,
  // which truncates Postgres's microseconds to milliseconds and would make
  // every save look like a conflict.
  updatedAt: string;
}

export interface Child {
  id: string;
  familyId: string;
  childIndex: number;
  firstName: string;
  grade: string | null;
  age: number | null;
  sex: string | null;
  specificNeeds: string | null;
  pantSize: string | null;
  shirtSize: string | null;
  shoeSize: string | null;
  otherNotes: string | null;
  // --- high schooler self-shopping bucket (US-32) --------------------------
  // Grades 9-12 shop for their own gifts. Auto-set from `grade` on INSERT by a
  // database trigger; staff override it on the family edit screen. A high
  // schooler still has a `cards` row (so nothing assuming one card per child
  // breaks) but that card is excluded from `public_available_cards`, the print
  // run, and the claimed/delivered dashboard math.
  isHighSchooler: boolean;
  // US-35 shop-day tracking. Only meaningful when isHighSchooler.
  shopDayStatus: ShopDayStatus;
  shopDayNotes: string | null;
  // --- on hold for duplicate review (US-38) --------------------------------
  // heldAt NOT NULL means this child is under duplicate review: their card is
  // pulled from the sponsor pool, the print run, and every dashboard/board
  // count until an admin releases the hold. The child row itself stays fully
  // present in the families explorer so staff can still find them. Set and
  // cleared ONLY through setChildHold / releaseChildHold (RPCs backed by
  // set_child_hold() / release_child_hold()) — never a direct column write.
  // Mirrored in queries.ts as isChildOnHold, matching the `and ch.held_at is
  // null` predicate in public_available_cards / printable_cards /
  // cards_needing_print.
  heldAt: string | null;
  // profiles.id of the admin who placed the hold; null when not held. Resolve
  // to a name via data.profiles the same way audit_log.changedBy is.
  heldBy: string | null;
  holdReason: string | null;
  // --- intake-form provenance (US-20) --------------------------------------
  // Nullable ON PURPOSE (INTAKE_FORMS §5.7): null means a volunteer added this
  // child by hand, a uuid means they came in through a form submission.
  sourceSubmissionId: string | null;
  // The family's own words, preserved next to the English working values
  // (INTAKE_FORMS §4.2). Identical to specificNeeds/otherNotes in Phase 1,
  // since Phase 1 is English-only and nothing is translated yet — they exist
  // so the §10 drive-close purge of submissions can't destroy the record of
  // what a family actually asked for.
  specificNeedsSource: string | null;
  otherNotesSource: string | null;
  // `children.updated_at` — same trigger, same row-version role, and the same
  // "opaque string, pass it back untouched" rule as Family.updatedAt above.
  updatedAt: string;
}

// Staff/volunteer account. RLS on `profiles` means a non-admin fetching this
// only ever gets their own row back (see supabase/migrations/20260708120000_init.sql
// "read own or admin profile") — admins get every row, which is what the
// volunteer-management admin page is built on.
export interface Profile {
  id: string;
  fullName: string;
  email: string | null;
  role: AppRole;
  canViewConfidential: boolean;
  createdAt: string;
}

export interface WishlistItem {
  id: string;
  childId: string;
  position: number;
  // Always the English working value — what sponsors see on the public card
  // and what purchasers buy from (INTAKE_FORMS §4.2 rule 3).
  description: string;
  // The family's original wording, when this item came from a form import.
  // Same as `description` in Phase 1 (English only). Null for a hand-entered
  // wishlist item.
  descriptionSource: string | null;
  sourceLocale: string | null;
}

export interface Sponsor {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  // US-55/58 (supabase/migrations/20261015140000_sponsor_families.sql): set
  // only when this sponsor record was created by
  // assign_card_to_sponsor_family() from a `sponsor_families` roster entry.
  // Null for every self-serve claim (claim_card_with_code never sets it) —
  // that nullness is exactly what distinguishes a staff-assigned pledge from
  // a sponsor's own self-serve claim everywhere else in this app.
  sponsorFamilyId: string | null;
}

// US-55 (supabase/migrations/20261015140000_sponsor_families.sql) — the
// sponsor sign-up roster for staff-assigned sponsoring. One row per sponsor
// sign-up staff imported from Church Center or added by hand; "the
// congregation" in the product ask IS this table, there's no separate
// grouping table.
export interface SponsorFamily {
  id: string;
  driveId: string;
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  // Advisory only — assign_card_to_sponsor_family() does not enforce it; the
  // assignment UI just flags an entry that's at or over it.
  capacity: number | null;
  notes: string | null;
  // Staff can retire a roster entry (fully booked, no longer available)
  // without deleting it and losing the assignment history through it.
  isActive: boolean;
  createdAt: string;
  // US-76: the Church Center "Registration ID" (how a re-import recognises
  // this entry; null when added by hand), its "Submitted" time (Suggest
  // matches fills earliest sign-ups first), and the sponsor_imports row that
  // added it (for the "New" badge).
  churchCenterRegistrationId: string | null;
  signedUpAt: string | null;
  addedByImportId: string | null;
  // What Church Center said at the last import; a re-import only proposes
  // changes Church Center made since then (see lib/sponsorCsv.ts).
  churchCenterSnapshot: ChurchCenterSnapshot | null;
  // Computed: the count of non-cancelled assignments reached through
  // `sponsors.sponsorFamilyId` pointing at this roster entry — i.e. how many
  // cards this entry has actually taken so far, not a counter column kept in
  // sync. NOT meaningful on `DataBundle.sponsorFamilies` directly (mapped
  // from a single raw row, with no visibility into assignments) — it is
  // always 0 there. Read it from `getSponsorFamilies(data)` in queries.ts,
  // which is what actually computes it.
  assignedCount: number;
  // Computed the same way: active assignments whose card hasn't been emailed
  // yet, and emailed assignments whose gift isn't at church yet (pledged or
  // purchased), i.e. who "Email all assigned" / "Remind all assigned" reach.
  unemailedCount: number;
  awaitingGiftCount: number;
}

// One card per child, always (ADM-2 answer, 2026-08-18: "there is no longer
// a need to have more than one family sign up for one card"), enforced by a
// unique(child_id) constraint on `cards` — see
// supabase/migrations/20260818140000_one_card_per_child.sql.
export interface CardRecord {
  id: string;
  childId: string;
  printedAt: string | null;
}

export interface Assignment {
  id: string;
  cardId: string;
  sponsorId: string;
  status: AssignmentStatus;
  claimedAt: string;
  purchasedAt: string | null;
  receivedAtChurchAt: string | null;
  // Set when status moves to 'verified' — the admin team has checked the
  // gift against the wishlist and shopped for anything short. Same shape as
  // purchasedAt/receivedAtChurchAt/deliveredAt; who did it is answered by
  // audit_log's changed_by, not a dedicated column here.
  verifiedAt: string | null;
  deliveredAt: string | null;
  // Free-text note a volunteer leaves on this pledge once the gift is at
  // church — e.g. what's missing from the wishlist. Feeds the shopping list
  // (see queries.ts's getShoppingList) until the assignment reaches
  // 'verified'.
  volunteerNotes: string | null;
  // When this card was emailed to its staff-assigned sponsor from the
  // roster's "Email all assigned" (20261019120000). Null = not emailed yet.
  cardEmailedAt: string | null;
}

export type AuditAction = "insert" | "update" | "delete";

// Row shape of `audit_log` (see SCHEMA.md §11). Admin-only, RLS-restricted to
// is_admin(); fetched on demand via lib/store.tsx's fetchAuditLog, never as
// part of the full-bundle fetch — see that function's docstring for why.
export interface AuditLogEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: AuditAction;
  // profiles.id of the user who made the change, or null if the change was
  // made without an authenticated session (auth.uid() was null at write
  // time — e.g. a service-role/system operation). Not a user-facing name;
  // see the fetchAuditLog docstring in lib/store.tsx for how to resolve it.
  changedBy: string | null;
  changedAt: string;
  // Shape varies by tableName/action: insert/delete store the full row
  // (to_jsonb(old|new)); update stores { old: {...}, new: {...} }. Typed
  // loosely on purpose — narrow it at the call site once you know the
  // action/tableName.
  diff: Record<string, unknown> | null;
}

// Everything the admin UI needs, fetched from Supabase in one shot by
// lib/store.tsx — one bundle so the derivation functions in lib/queries.ts
// can take a single argument.
export interface DataBundle {
  drive: Drive;
  schools: School[];
  driveSchools: DriveSchool[];
  families: Family[];
  children: Child[];
  wishlistItems: WishlistItem[];
  sponsors: Sponsor[];
  cards: CardRecord[];
  assignments: Assignment[];
  // Own row only for a non-admin, every profile for an admin — see the
  // `Profile` doc comment above. Powers the admin volunteer-management page.
  profiles: Profile[];
  // US-55: fetched UNFILTERED by drive, same as families/children/etc. above
  // — filter to the current drive at the query layer, not here. See
  // getSponsorFamilies in queries.ts, which is also where `assignedCount`
  // actually gets computed; treat the rows here as raw plumbing.
  sponsorFamilies: SponsorFamily[];
}

// =============================================================================
// Counselor-vetted intake forms (US-20)
//
// Mirrors supabase/migrations/20260830120000_intake_forms.sql. The functions
// that produce and consume these live in lib/intake.ts — import from there,
// not from a raw supabase call, so nothing outside that file has to know an
// RPC name or argument order.
// =============================================================================

export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "verified"
  | "imported"
  | "rejected"
  | "duplicate";

export type SubmissionChannel = "family" | "counselor" | "staff";

/** One choice in a `select` field. `value` is what gets stored. */
export interface IntakeFormOption {
  value: string;
  label: string;
}

/**
 * One question. `type` drives both the control the form renders AND the
 * server-side validation in `submit_form` — the two are the same definition,
 * which is the point: the server does not trust the client, and the client
 * does not hard-code the questionnaire.
 *
 *  text | phone | email | textarea — plain string answers
 *  number                          — integer, bounded by min/max
 *  select                          — value must be one of `options`
 *  checkbox                        — boolean; `required` means "must be true"
 *  text_list                       — string[]; the wishlist
 */
export interface IntakeFormField {
  id: string;
  label: string;
  help?: string;
  type: "text" | "phone" | "email" | "textarea" | "number" | "select" | "checkbox" | "text_list";
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: IntakeFormOption[];
  /**
   * "Other (describe)" escape hatch. When the chosen value equals
   * `otherValue` (default "Other"), the answer object must also carry a
   * non-empty `otherField` key — the server enforces this, so render the
   * extra text input whenever that option is selected.
   */
  otherField?: string;
  otherValue?: string;
  /** text_list only. */
  minItems?: number;
  maxItems?: number;
  firstRequired?: boolean;
  itemLabels?: string[];
  /**
   * Not shown, and not collected, for a child whose grade is 9-12 (US-32):
   * high schoolers self-shop at the store shopping day, so they're asked only
   * for first name, age, and grade. `submit_form` enforces the same skip
   * server-side (intake_validate_field), so this is a rendering hint, not the
   * control. See HIGH_SCHOOL_GRADES in web/lib/queries.ts.
   */
  selfShopperHidden?: boolean;
}

export interface IntakeFormSection {
  id: string;
  title: string;
  help?: string;
  /** True for the child block: render N copies with add/remove. */
  repeating?: boolean;
  minItems?: number;
  maxItems?: number;
  itemLabel?: string;
  addLabel?: string;
  removeLabel?: string;
  fields: IntakeFormField[];
}

export interface IntakeFormDefinition {
  schemaVersion: number;
  locale: string;
  title: string;
  intro: string;
  helpFooter?: string;
  privacyNote?: string;
  submitLabel?: string;
  confirmation?: { heading: string; body: string };
  /**
   * The per-child gift budget, as a display string ("$50"). Substitute it for
   * the literal `{budget}` token wherever it appears in a field's `help`.
   * PLACEHOLDER pending Grant's confirmation — one string, one place, so
   * changing it is a one-line edit to the form definition.
   */
  budgetPerChild?: string;
  /**
   * Name of the hidden honeypot input to render. Whatever the visitor types
   * into it goes back as `honeypot` on submitForm; a real person never sees
   * or fills it, and a bot that does gets an ordinary-looking success with no
   * row written.
   */
  honeypotField?: string;
  sections: IntakeFormSection[];
}

/** One child's answers. Keys are field ids from the repeating section. */
export interface IntakeChildAnswer {
  first_name?: string;
  age?: number | string;
  grade?: string;
  sex?: string;
  shirt_size?: string;
  shirt_size_other?: string;
  pant_size?: string;
  pant_size_other?: string;
  shoe_size?: string;
  shoe_size_other?: string;
  wishlist?: string[];
  specific_needs?: string;
  other_notes?: string;
  [key: string]: unknown;
}

/**
 * The whole submitted payload. Deliberately snake_cased: this object is stored
 * BYTE-FOR-BYTE in `form_submissions.answers` as the provenance record of what
 * the family typed, and `import_submission` reads these exact keys, so it is
 * not a camelCase app type and must not be renamed at the boundary.
 */
export interface IntakeAnswers {
  family?: {
    guardian_name?: string;
    guardian_phone?: string;
    guardian_email?: string;
    preferred_language?: string;
    [key: string]: unknown;
  };
  children?: IntakeChildAnswer[];
  pickup_consent?: {
    can_reach_church_pickup?: string;
    consent?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** A server-side validation failure, addressed to one field. */
export interface IntakeFieldError {
  /** e.g. "family.guardian_phone", "children[0].age", "children[1].wishlist[0]". */
  field: string;
  message: string;
}

/**
 * A counselor's typo fix for one child. These three fields are the ENTIRE
 * scope of what a counselor may change (INTAKE_FORMS §3) — the database
 * rejects any other key with an error rather than dropping it silently, so
 * don't try to send one.
 */
export interface ChildCorrection {
  firstName?: string;
  age?: number;
  grade?: string;
}

/**
 * Corrections keyed by 1-BASED child position — the same numbering as
 * `children.child_index`, so child 1 in the roster is key 1 here.
 */
export type SubmissionCorrections = Record<number, ChildCorrection>;

/** One child as the counselor's roster sees them. Nothing else is returned. */
export interface RosterChild {
  index: number;
  firstName: string | null;
  age: number | null;
  grade: string | null;
}

/**
 * One correctable field's rule, exactly as the pinned form version states it.
 *
 * This is a projection of `IntakeFormField` — the same properties, off the same
 * `form_versions.definition` — narrowed to what a counselor's inline edit
 * control needs and with every optional property made explicitly nullable, so
 * "the definition doesn't set a maximum" is a value rather than an absence.
 *
 * Build the control FROM this. Do not restate any of it in the page: a rule
 * typed into JSX is a rule that drifts from what `verifySubmission` enforces,
 * and when it drifts loose the counselor loses their whole approve click to a
 * server-side rejection.
 *
 *   type "select" + non-empty `options` -> a picker over `options`
 *   type "number"                       -> a number input bounded by min/max
 *   anything else                       -> a text input capped at `maxLength`
 *
 * `options` is always an array (empty, never null); `maxLength`/`min`/`max` are
 * null when the definition sets no such bound.
 */
export interface CorrectionFieldDef {
  id: string;
  label: string;
  type: IntakeFormField["type"];
  required: boolean;
  maxLength: number | null;
  min: number | null;
  max: number | null;
  options: IntakeFormOption[];
}

/**
 * The rules behind the three fields a counselor may correct (INTAKE_FORMS §3),
 * keyed to match `ChildCorrection` — so the control that edits
 * `corrections[n].grade` reads its rule from `correctionFields.grade`.
 *
 * All three keys are ALWAYS present. A `null` value means no form version on
 * this roster defines that field: render the control READ-ONLY. Do not fall
 * back to a free-text box — an unconstrained box is worse than no box, because
 * the server has no rule to accept whatever gets typed into it.
 */
export interface CorrectionFields {
  firstName: CorrectionFieldDef | null;
  age: CorrectionFieldDef | null;
  grade: CorrectionFieldDef | null;
}

/**
 * One submission on the counselor roster. Note what is NOT here, and is not in
 * the network response either: wishlist, sizes, specific needs, other notes,
 * and the guardian's name/phone/email. The counselor is confirming family
 * composition, not reviewing gift requests.
 */
export interface RosterSubmission {
  id: string;
  status: SubmissionStatus;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedByLabel: string | null;
  resolutionNote: string | null;
  hasCorrections: boolean;
  children: RosterChild[];
}

/**
 * A submission as STAFF see it (the admin queue). This one does carry the full
 * answers — that surface is behind AdminGate and RLS, and staff need the
 * wishlist and sizes to sanity-check an import.
 *
 * `answers` is what the family submitted, unmodified. `corrections` is what
 * the counselor changed. They are kept separate on purpose so the UI can show
 * a correction AS a correction (US-23) instead of silently merging it.
 */
export interface SubmissionRecord {
  id: string;
  driveId: string;
  driveSchoolId: string | null;
  channel: SubmissionChannel;
  status: SubmissionStatus;
  sourceLocale: string;
  submitterName: string | null;
  submitterPhone: string | null;
  submitterEmail: string | null;
  submittedAt: string | null;
  firstViewedAt: string | null;
  verifiedAt: string | null;
  verifiedByLabel: string | null;
  importedAt: string | null;
  importedFamilyId: string | null;
  resolutionNote: string | null;
  answers: IntakeAnswers;
  corrections: SubmissionCorrections;
  /** Derived from answers.children — convenience for the list view. */
  childCount: number;
}

/**
 * A shareable form link, as the staff link panel shows it. `token` is
 * plaintext by design (INTAKE_FORMS §2) — it only permits WRITING a
 * submission and exposes no PII.
 *
 * There is no equivalent type for review tokens: those are stored hashed and
 * the plaintext is unrecoverable from the database, on purpose.
 */
export interface FormLinkRecord {
  id: string;
  driveId: string;
  driveSchoolId: string | null;
  token: string;
  label: string | null;
  locale: string;
  channel: SubmissionChannel;
  opensAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  maxSubmissions: number | null;
  submissionCount: number;
}
