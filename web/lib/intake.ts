"use client";

// Data layer for the counselor-vetted intake forms (US-20 .. US-24).
//
// Everything in this file is a thin, typed wrapper over the Postgres functions
// in supabase/migrations/20260830120000_intake_forms.sql. Import from here —
// no page should ever call `supabase.rpc("submit_form", ...)` directly, or
// need to know an RPC name, an argument order, or a snake_case answer key.
//
// Every page in this app is a client component using the anon key, so these
// are browser-side calls, same as store.tsx's requestClaimCode/claimCardWithCode.
//
// ---------------------------------------------------------------------------
// Who can call what, and why it is safe
// ---------------------------------------------------------------------------
// The six functions are `security definer` and are the ONLY door into the six
// intake tables — `anon` has no policy and no table grant on any of them. So:
//
//   getForm / submitForm / getReviewRoster / verifySubmission /
//   rejectSubmission     — callable with no login (a family on their phone, a
//                          counselor with a link). The database decides what
//                          each one may see or write, from the token alone.
//   importSubmission     — authenticated only, and additionally checks
//                          is_admin() (plus can_view_confidential() for a
//                          confidential-channel submission) inside its own
//                          body. A signed-in volunteer calling it gets a
//                          refusal, not a family.
//
//   listSubmissions / getSubmission / listFormLinks — plain table reads for
//                          the staff screens, gated by RLS rather than by a
//                          function. A volunteer without confidential
//                          clearance gets ZERO ROWS for a confidential-channel
//                          submission AND for the confidential-channel form
//                          link — the row is missing, not hidden by the UI.
//                          Don't "fix" an empty result with a client-side
//                          fallback.
//
// ---------------------------------------------------------------------------
// Error handling convention
// ---------------------------------------------------------------------------
// Every wrapper returns a discriminated union and never throws. Two different
// failure sources are flattened into the same `{ ok: false, error }` shape:
//
//   * a value the function deliberately RETURNED — an expired link, a
//     validation failure, "already confirmed". Safe to show to the user as-is;
//     the strings are written in plain language for exactly that.
//   * a genuine Postgres error the function RAISED — an out-of-scope
//     correction payload, a permission denial. Also safe to show, but these
//     read more like an error than a message.
//
// `reason` (where present) is the machine-readable discriminator; `error` is
// the human sentence. Prefer branching on `reason`.

import { createClient } from "./supabase/client";
import {
  INTAKE_FORM_DESCRIPTION,
  INTAKE_FORM_NAME,
  INTAKE_FORM_SLUG,
  PHASE_1_FORM_DEFINITION,
} from "./intakeFormDefinition";
import type {
  ChildCorrection,
  CorrectionFieldDef,
  CorrectionFields,
  FormLinkRecord,
  IntakeAnswers,
  IntakeChildAnswer,
  IntakeFieldError,
  IntakeFormDefinition,
  IntakeFormField,
  IntakeFormOption,
  IntakeFormSection,
  RosterSubmission,
  SubmissionChannel,
  SubmissionCorrections,
  SubmissionRecord,
  SubmissionStatus,
} from "./types";

export type {
  ChildCorrection,
  CorrectionFieldDef,
  CorrectionFields,
  FormLinkRecord,
  IntakeAnswers,
  IntakeChildAnswer,
  IntakeFieldError,
  IntakeFormDefinition,
  IntakeFormField,
  IntakeFormOption,
  IntakeFormSection,
  RosterChild,
  RosterSubmission,
  SubmissionChannel,
  SubmissionCorrections,
  SubmissionRecord,
  SubmissionStatus,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const GENERIC_ERROR = "Something went wrong. Please try again.";

// ---------------------------------------------------------------------------
// Why a link or token was refused.
//
// There is no "revoked" member, deliberately. `not_found` covers both "no such
// token" and "this link was revoked": get_form and submit_form both answer
// `not_found` for either, with the same user-facing message, so an
// unauthenticated caller can't use `reason` to confirm that a given token was
// ever real. A dead link has nothing useful to say either way — the family's
// next step is "ask your counselor for a current link" in both cases.
//
// The rest stay distinct because each one has a genuinely different message to
// show ("not open yet" vs. "registration has closed" vs. "this school is
// full"). Keep this union identical to the `reason` list documented above
// get_form in supabase/migrations/20260830120000_intake_forms.sql.
// ---------------------------------------------------------------------------
export type FormLinkProblem =
  | "not_found"
  | "expired"
  | "not_yet_open"
  | "full"
  | "unpublished"
  | "drive_closed"
  | "unknown";

export type ReviewTokenProblem = "not_found" | "unsupported" | "unknown";

// =============================================================================
// Shapes returned by each wrapper
// =============================================================================

export type GetFormResult =
  | {
      ok: true;
      definition: IntakeFormDefinition;
      /** The school the link belongs to, to show back to the family. Null on a
       *  confidential/direct link. This is the ONLY thing get_form returns
       *  beyond the definition — there is no counselor contact in the payload. */
      schoolName: string | null;
      locale: string;
    }
  | { ok: false; error: string; reason: FormLinkProblem };

export interface SubmitFormInput {
  token: string;
  answers: IntakeAnswers;
  /** Optional. Omit it and the server falls back to answers.family.guardian_*. */
  contact?: { name?: string; phone?: string; email?: string };
  /**
   * Whatever was typed into the hidden honeypot input named by
   * `definition.honeypotField`. Always send it (empty string is fine) — a
   * filled honeypot returns an ordinary success and writes nothing, so the
   * calling page needs no special case.
   */
  honeypot?: string;
}

export type SubmitFormResult =
  | { ok: true; status: "submitted" | "verified" }
  | {
      ok: false;
      error: string;
      /** Field-addressed validation failures, e.g. "children[0].age". Empty
       *  when the failure wasn't about the answers (a closed link, say). */
      fieldErrors: IntakeFieldError[];
      reason?: FormLinkProblem;
    };

export type ReviewRosterResult =
  | {
      ok: true;
      schoolName: string | null;
      expiresAt: string | null;
      /**
       * The pinned definition's rule for each of the three fields a counselor
       * may correct. Build the roster's inline edit controls from this and
       * restate none of it in the page — see CorrectionFields.
       *
       * Concretely, what it replaces in the roster JSX:
       *   grade      — a picker over `grade.options` instead of a text input
       *                or a datalist. A grade that isn't in the list comes back
       *                as a rejected correction.
       *   age        — `age.min` / `age.max` instead of a hard-coded 0 / 19.
       *   firstName  — `firstName.maxLength` instead of a hard-coded 120. The
       *                definition says 80, so 120 let a counselor type a name
       *                the browser accepted and `verifySubmission` then refused
       *                with "Correction rejected: Please keep First name under
       *                80 characters", losing the whole approve click.
       *
       * A `null` value means no form version on this roster defines that field
       * (including an empty roster). Render that control READ-ONLY; never fall
       * back to a free-text box.
       *
       * This is definition data (the blank questionnaire, which `getForm`
       * already hands to any visitor with a link), not submission data, so it
       * discloses nothing about any family. The per-child payload is still
       * first name / age / grade and nothing else.
       */
      correctionFields: CorrectionFields;
      submissions: RosterSubmission[];
    }
  | { ok: false; error: string; reason: ReviewTokenProblem };

export interface VerifySubmissionInput {
  reviewToken: string;
  submissionId: string;
  /** The counselor's typed name. Required — it's the attestation. */
  verifierName: string;
  /**
   * Optional typo fixes, keyed by 1-based child position. ONLY firstName /
   * age / grade are accepted; the database RAISES on anything else rather than
   * dropping it, so don't send a wider object "just in case".
   */
  corrections?: SubmissionCorrections;
}

export type VerifySubmissionResult =
  | { ok: true; status: "verified" }
  | { ok: false; error: string; reason?: string };

export interface RejectSubmissionInput {
  reviewToken: string;
  submissionId: string;
  reason: string;
  /** Marks it `duplicate` instead of `rejected`. */
  asDuplicate?: boolean;
}

export type RejectSubmissionResult =
  | { ok: true; status: "rejected" | "duplicate" }
  | { ok: false; error: string; reason?: string };

export interface ImportSubmissionOptions {
  /**
   * The confidential tier for the family this creates.
   *
   * Omit it (the default) and the family inherits the channel: a
   * confidential-channel submission becomes a confidential family, a school
   * submission an ordinary one. Pass `true` or `false` to override.
   *
   * This is the ONLY correct place to set it. Importing first and then editing
   * the family's confidential flag leaves a real child's name and school
   * readable by every volunteer in between — set it here and the row is
   * confidential from the instant it exists.
   */
  isConfidential?: boolean;
}

export type ImportSubmissionResult =
  | {
      ok: true;
      familyId: string;
      familyNumber: number | null;
      childrenCreated: number;
      /**
       * True when this call found the submission already imported and returned
       * the family that already exists. A double-click, a retry, and two admins
       * clicking at once all land here — treat it as success and navigate to
       * `familyId`, not as an error.
       */
      alreadyImported: boolean;
      /**
       * The tier the family actually ended up with. Worth showing back on the
       * confirmation ("Imported as a confidential family"), because on an
       * `alreadyImported: true` response this is what the FIRST import chose —
       * a different `isConfidential` on a repeat call is ignored rather than
       * silently re-tiering an existing family.
       */
      isConfidential: boolean;
    }
  | { ok: false; error: string; reason?: "not_found" | "forbidden" | "not_verified" | "unknown" };

// =============================================================================
// getForm — the public form page
// =============================================================================

/**
 * Loads the questionnaire for a form link. Render from `definition`; do not
 * hard-code the questions (US-21) — the definition is the pinned, published
 * version the family's answers will be validated against, so a page that
 * renders anything else is rendering a form the server will reject.
 *
 * Show `error` verbatim on `ok: false`; the strings are written for families,
 * not developers.
 */
export async function getForm(token: string): Promise<GetFormResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_form", { p_token: token });
  if (error) return { ok: false, error: error.message, reason: "unknown" };

  const res = data as any;
  if (!res?.ok) {
    return {
      ok: false,
      error: res?.error ?? GENERIC_ERROR,
      reason: (res?.reason as FormLinkProblem) ?? "unknown",
    };
  }
  return {
    ok: true,
    definition: normalizeDefinition(res.definition),
    schoolName: res.school_name ?? null,
    locale: res.locale ?? "en",
  };
}

// =============================================================================
// submitForm — the only write path for a family
// =============================================================================

/**
 * Submits a family's answers. There is no table insert anywhere in this flow;
 * this RPC is the whole write path.
 *
 * `answers` is stored byte-for-byte as the provenance record of what the
 * family typed, so send it exactly as collected — snake_case keys matching the
 * definition's field ids, nothing renamed or "cleaned up" on the way out.
 *
 * Validation is re-run server-side against the pinned definition regardless of
 * what the page checked, and comes back as `fieldErrors` addressed by path
 * ("family.guardian_phone", "children[0].age", "children[1].wishlist[0]") so
 * they can be rendered next to the input rather than as one banner.
 *
 * On success show a plain confirmation. Deliberately nothing is returned to
 * echo: no submission id, no PII, and there is no way to re-open a submission
 * afterwards.
 */
export async function submitForm(input: SubmitFormInput): Promise<SubmitFormResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("submit_form", {
    p_token: input.token,
    p_answers: input.answers,
    p_contact: input.contact
      ? {
          name: input.contact.name ?? null,
          phone: input.contact.phone ?? null,
          email: input.contact.email ?? null,
        }
      : null,
    p_honeypot: input.honeypot ?? null,
  });
  if (error) return { ok: false, error: error.message, fieldErrors: [] };

  const res = data as any;
  if (!res?.ok) {
    return {
      ok: false,
      error: res?.error ?? GENERIC_ERROR,
      fieldErrors: Array.isArray(res?.errors) ? (res.errors as IntakeFieldError[]) : [],
      reason: res?.reason as FormLinkProblem | undefined,
    };
  }
  return { ok: true, status: res.status === "verified" ? "verified" : "submitted" };
}

// =============================================================================
// getReviewRoster — the counselor's page
// =============================================================================

/**
 * The season's roster for the school this review token belongs to.
 *
 * The response contains first name, age and grade per child and nothing else —
 * no wishlist, sizes, specific needs, other notes, or guardian contact — and a
 * confidential-channel submission is never in it. That's enforced in the
 * database, so there is nothing to filter here and nothing to accidentally
 * render.
 *
 * `correctionFields` comes back alongside the submissions: the pinned form
 * version's own rule — type, bounds, options — for each of the three fields a
 * counselor may correct, so every inline edit control is built from the same
 * definition `verifySubmission` validates against instead of from constants
 * typed into the page. It is definition data, not anyone's answers — see
 * ReviewRosterResult.
 *
 * Calling this stamps `first_viewed_at` on any submission being seen for the
 * first time, so treat it as a real action, not a free poll.
 */
export async function getReviewRoster(reviewToken: string): Promise<ReviewRosterResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_review_roster", {
    p_review_token: reviewToken,
  });
  if (error) return { ok: false, error: error.message, reason: "unknown" };

  const res = data as any;
  if (!res?.ok) {
    return {
      ok: false,
      error: res?.error ?? GENERIC_ERROR,
      reason: (res?.reason as ReviewTokenProblem) ?? "unknown",
    };
  }
  return {
    ok: true,
    schoolName: res.school_name ?? null,
    expiresAt: res.expires_at ?? null,
    correctionFields: normalizeCorrectionFields(res.correction_fields),
    submissions: (Array.isArray(res.submissions) ? res.submissions : []).map(mapRosterSubmission),
  };
}

/**
 * Approves a submission, optionally with typo fixes.
 *
 * The corrections payload is converted to the database's shape here, so the
 * caller passes `{ 1: { firstName: "Maya" } }` and never has to know about
 * `first_name` or string keys.
 *
 * A key other than firstName/age/grade cannot be sent at all through this
 * signature, which is the point — and if one somehow reaches the database it
 * is rejected with an error rather than silently ignored.
 */
export async function verifySubmission(
  input: VerifySubmissionInput
): Promise<VerifySubmissionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("verify_submission", {
    p_review_token: input.reviewToken,
    p_submission_id: input.submissionId,
    p_verifier_name: input.verifierName,
    p_corrections: toDbCorrections(input.corrections),
  });
  if (error) return { ok: false, error: error.message };

  const res = data as any;
  if (!res?.ok) {
    return { ok: false, error: res?.error ?? GENERIC_ERROR, reason: res?.reason };
  }
  return { ok: true, status: "verified" };
}

/** Rejects a submission (or marks it a duplicate) with a short reason. */
export async function rejectSubmission(
  input: RejectSubmissionInput
): Promise<RejectSubmissionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("reject_submission", {
    p_review_token: input.reviewToken,
    p_submission_id: input.submissionId,
    p_reason: input.reason,
    p_as_duplicate: input.asDuplicate ?? false,
  });
  if (error) return { ok: false, error: error.message };

  const res = data as any;
  if (!res?.ok) {
    return { ok: false, error: res?.error ?? GENERIC_ERROR, reason: res?.reason };
  }
  return { ok: true, status: res.status === "duplicate" ? "duplicate" : "rejected" };
}

// =============================================================================
// importSubmission — the staff one-click import
// =============================================================================

/**
 * Turns a counselor-verified submission into a real family + children + cards
 * + wishlist items, and stamps the submission as imported.
 *
 * IDEMPOTENT by design. Calling it twice — a double-click, a retry, or two
 * admins at the same moment — creates ONE family; the later call comes back
 * `ok: true` with `alreadyImported: true` and the same `familyId`. So the UI
 * does not need to guarantee single-firing to be correct (still disable the
 * button while in flight, for the user's sake, not for the data's).
 *
 * Admin-only, checked in the database. A volunteer gets
 * `reason: "forbidden"`. A volunteer without confidential clearance asking for
 * a confidential-channel submission gets `reason: "not_found"` — deliberately
 * the same answer as a submission that doesn't exist.
 *
 * `opts.isConfidential` sets the new family's confidential tier as part of the
 * same write (see ImportSubmissionOptions). Any admin may set it — creating a
 * confidential family is deliberately not a separate privilege — and the choice
 * is recorded in the submission's event trail and in `audit_log`.
 */
export async function importSubmission(
  submissionId: string,
  opts?: ImportSubmissionOptions
): Promise<ImportSubmissionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("import_submission", {
    p_submission_id: submissionId,
    // Explicit null, not omitted: null is the documented "inherit from the
    // channel" value, and sending it keeps one argument list for every call.
    p_is_confidential: opts?.isConfidential ?? null,
  });
  if (error) return { ok: false, error: error.message, reason: "unknown" };

  const res = data as any;
  if (!res?.ok) {
    return { ok: false, error: res?.error ?? GENERIC_ERROR, reason: res?.reason ?? "unknown" };
  }
  return {
    ok: true,
    familyId: res.family_id,
    familyNumber: res.family_number ?? null,
    childrenCreated: res.children_created ?? 0,
    alreadyImported: Boolean(res.already_imported),
    isConfidential: Boolean(res.is_confidential),
  };
}

// =============================================================================
// Staff reads (RLS-gated table selects, not RPCs)
// =============================================================================

export type ListResult<T> = { ok: true; items: T[] } | { ok: false; error: string };

/**
 * Every submission in a drive, for the staff queue.
 *
 * RLS does the confidentiality work: a volunteer without
 * `can_view_confidential` simply does not get confidential-channel rows back.
 * That is the mechanism US-23 asks for — the query returns nothing, rather
 * than the UI hiding something.
 *
 * Resolve `driveSchoolId` to a school name through the existing DataBundle
 * (`driveSchools` + `schools` in lib/store.tsx); this deliberately doesn't
 * embed the join, so there's one place that maps schools.
 */
export async function listSubmissions(driveId: string): Promise<ListResult<SubmissionRecord>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("form_submissions")
    .select(
      "id, drive_id, drive_school_id, channel, status, source_locale, submitter_name, " +
        "submitter_phone, submitter_email, submitted_at, first_viewed_at, verified_at, " +
        "verified_by_label, imported_at, imported_family_id, resolution_note, answers, corrections"
    )
    .eq("drive_id", driveId)
    .neq("status", "draft")
    .order("submitted_at", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, items: (data ?? []).map(mapSubmissionRecord) };
}

/** One submission in full, for the staff detail view. */
export async function getSubmission(
  submissionId: string
): Promise<{ ok: true; submission: SubmissionRecord } | { ok: false; error: string }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("form_submissions")
    .select(
      "id, drive_id, drive_school_id, channel, status, source_locale, submitter_name, " +
        "submitter_phone, submitter_email, submitted_at, first_viewed_at, verified_at, " +
        "verified_by_label, imported_at, imported_family_id, resolution_note, answers, corrections"
    )
    .eq("id", submissionId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) {
    // Same message for "deleted" and "RLS hid it from you" — answering
    // differently would confirm a confidential submission exists. Same
    // reasoning as NOT_FOUND_MESSAGE in store.tsx.
    return { ok: false, error: "That registration couldn't be found, or you don't have access to it." };
  }
  return { ok: true, submission: mapSubmissionRecord(data) };
}

/**
 * The form links for a drive, so staff can copy one and send it by hand — the
 * manual fallback INTAKE_FORMS §11 says to build on day one.
 *
 * Confidentiality applies here too, as of the US-20 review: the
 * confidential-channel link (the one with `driveSchoolId === null`) is only
 * returned to a caller who clears `can_view_confidential()`. A volunteer
 * without clearance gets the school links and nothing else — not the
 * confidential link's token, and not its `submissionCount`, which is a running
 * count of confidential registrations. Render whatever comes back; there is no
 * client-side filtering to do and none to add.
 *
 * There is NO equivalent for review links. Review tokens are stored hashed and
 * the plaintext cannot be recovered from the database by anyone, deliberately
 * (§2): a leak of the database must not hand over a working key to a roster of
 * children's names. For the Phase 1 demo the review token's plaintext is
 * documented in supabase/intake_demo_seed.sql; in production, a counselor who
 * loses theirs is issued a new one.
 */
export async function listFormLinks(driveId: string): Promise<ListResult<FormLinkRecord>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("form_links")
    .select(
      "id, drive_id, drive_school_id, token, label, locale, channel, opens_at, expires_at, " +
        "revoked_at, max_submissions, submission_count"
    )
    .eq("drive_id", driveId)
    .order("created_at", { ascending: true });

  if (error) return { ok: false, error: error.message };
  return { ok: true, items: (data ?? []).map(mapFormLinkRow) };
}

// The columns every form_links read/write in this file projects. Kept in one
// place so listFormLinks and createFormLink can't drift apart.
const FORM_LINK_COLUMNS =
  "id, drive_id, drive_school_id, token, label, locale, channel, opens_at, expires_at, " +
  "revoked_at, max_submissions, submission_count";

// =============================================================================
// Staff link management — create / revoke (ADM-24)
// =============================================================================
//
// Ordinary RLS-gated table writes, exactly like the staff family CRUD in
// store.tsx. `authenticated` holds insert/update on form_links, and the
// "admin insert/update form_links" policies additionally require is_admin() —
// a volunteer calling these gets a Postgres RLS error, not a link.
//
// Two things are deliberately NOT reachable from this UI, both from the US-20
// review:
//   * channel is always 'family'. A 'counselor'/'staff' link auto-verifies at
//     submit and its plaintext token is readable by every signed-in user, so
//     issuing one lets a volunteer file submissions that skip the counselor
//     entirely (ADM-20). Not creatable here.
//   * drive_school_id is always set — school links only. The confidential
//     channel (null school) stays SQL-only: creating one is rare, and its RLS
//     insert policy already gates on can_view_confidential().

/** A published questionnaire a new link can be pinned to. */
export interface DriveFormVersionRecord {
  formVersionId: string;
  formName: string;
  version: number;
  /** The definition's own locale — the link inherits it. */
  locale: string;
  publishedAt: string | null;
}

/**
 * The published form versions for a drive, newest first. A link must pin one
 * (`form_links.form_version_id` is NOT NULL), and a drive with no published
 * version can't have links created for it through the UI — the questionnaire
 * has to be published first (SQL, for Phase 1).
 */
export async function listDriveFormVersions(
  driveId: string
): Promise<ListResult<DriveFormVersionRecord>> {
  const supabase = createClient();

  const { data: forms, error: formsError } = await supabase
    .from("forms")
    .select("id, name")
    .eq("drive_id", driveId);
  if (formsError) return { ok: false, error: formsError.message };

  const formNames = new Map<string, string>(
    (forms ?? []).map((f: any) => [f.id as string, (f.name as string) ?? "Registration form"])
  );
  if (formNames.size === 0) return { ok: true, items: [] };

  const { data, error } = await supabase
    .from("form_versions")
    .select("id, form_id, version, published_at, definition")
    .in("form_id", Array.from(formNames.keys()))
    .not("published_at", "is", null)
    .order("version", { ascending: false });
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    items: (data ?? []).map((row: any) => ({
      formVersionId: row.id,
      formName: formNames.get(row.form_id) ?? "Registration form",
      version: row.version,
      locale:
        typeof row.definition?.locale === "string" && row.definition.locale.trim()
          ? row.definition.locale
          : "en",
      publishedAt: row.published_at ?? null,
    })),
  };
}

function definitionLocale(definition: any): string {
  return typeof definition?.locale === "string" && definition.locale.trim()
    ? definition.locale
    : "en";
}

/**
 * The published questionnaire for a drive's standard intake form, creating it on
 * first use.
 *
 * A `form_links` row must pin a `form_version_id`, and a drive that has never
 * had a link made has no `forms` row and no `form_versions` row. Rather than
 * making staff run supabase/publish_intake_form.sql by hand, the first link
 * created for a drive publishes the canonical Phase 1 definition
 * (web/lib/intakeFormDefinition.ts) — the exact same JSON that SQL script and
 * the demo seed use.
 *
 * Admin-only: the `admin insert forms` / `admin insert form_versions` policies
 * gate on `is_admin()`. Idempotent — a second caller (or a concurrent one)
 * reuses the published version rather than publishing a duplicate.
 */
export async function ensureDriveFormVersion(
  driveId: string
): Promise<{ ok: true; formVersionId: string; locale: string } | { ok: false; error: string }> {
  const supabase = createClient();

  const { data: formRow, error: formError } = await supabase
    .from("forms")
    .upsert(
      {
        drive_id: driveId,
        slug: INTAKE_FORM_SLUG,
        name: INTAKE_FORM_NAME,
        description: INTAKE_FORM_DESCRIPTION,
      },
      { onConflict: "drive_id,slug" }
    )
    .select("id")
    .single();
  if (formError || !formRow) return { ok: false, error: formError?.message ?? GENERIC_ERROR };
  const formId = formRow.id as string;

  const readLatestPublished = () =>
    supabase
      .from("form_versions")
      .select("id, version, definition")
      .eq("form_id", formId)
      .not("published_at", "is", null)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

  const existing = await readLatestPublished();
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data) {
    return {
      ok: true,
      formVersionId: existing.data.id as string,
      locale: definitionLocale(existing.data.definition),
    };
  }

  const { data: userData } = await supabase.auth.getUser();

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: maxRow } = await supabase
      .from("form_versions")
      .select("version")
      .eq("form_id", formId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((maxRow?.version as number | undefined) ?? 0) + 1;

    const { data: inserted, error: insertError } = await supabase
      .from("form_versions")
      .insert({
        form_id: formId,
        version: nextVersion,
        definition: PHASE_1_FORM_DEFINITION,
        published_at: new Date().toISOString(),
        created_by: userData.user?.id ?? null,
      })
      .select("id")
      .single();

    if (!insertError && inserted) {
      return {
        ok: true,
        formVersionId: inserted.id as string,
        locale: PHASE_1_FORM_DEFINITION.locale,
      };
    }
    // Someone published a version between our read and our write — take theirs.
    if (insertError?.code === "23505" && attempt < 2) {
      const raced = await readLatestPublished();
      if (raced.data) {
        return {
          ok: true,
          formVersionId: raced.data.id as string,
          locale: definitionLocale(raced.data.definition),
        };
      }
      continue;
    }
    return { ok: false, error: insertError?.message ?? GENERIC_ERROR };
  }
  return { ok: false, error: GENERIC_ERROR };
}

export interface CreateFormLinkInput {
  driveId: string;
  /** School links only — never null through this path (see the note above). */
  driveSchoolId: string;
  /** Omit to publish/reuse the drive's standard questionnaire (the common case);
   *  pass one only when a drive has multiple published versions and staff picked. */
  formVersionId?: string | null;
  /** Omit and it's taken from the resolved version's definition. */
  locale?: string | null;
  label?: string | null;
  /** ISO strings, or null for "no bound". `expiresAt` should always be set
   *  (INTAKE_FORMS §11) — the UI makes it a required field. */
  opensAt?: string | null;
  expiresAt?: string | null;
  maxSubmissions?: number | null;
}

export type CreateFormLinkResult =
  | { ok: true; link: FormLinkRecord }
  | { ok: false; error: string };

/**
 * A url-safe token with 32 bytes of entropy (INTAKE_FORMS §5.3 asks for
 * ">= 32 bytes"; the DB check only enforces >= 16 chars). base64url, unpadded.
 */
function newLinkToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Creates a school registration link. Admin-only (enforced by RLS, not here).
 *
 * When `input.formVersionId` is omitted, the drive's standard questionnaire is
 * published (first time) or reused — see ensureDriveFormVersion — so a brand new
 * drive needs no SQL step before its first link.
 *
 * The token is generated client-side and never shown until the row comes back —
 * a collision on the unique index is a ~2^-256 event, and the retry only exists
 * so that if it somehow happened the staff member would see a fresh link rather
 * than a raw `23505`.
 */
export async function createFormLink(input: CreateFormLinkInput): Promise<CreateFormLinkResult> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();

  let formVersionId = input.formVersionId ?? null;
  let locale = input.locale ?? null;
  if (!formVersionId) {
    const ensured = await ensureDriveFormVersion(input.driveId);
    if (!ensured.ok) return { ok: false, error: ensured.error };
    formVersionId = ensured.formVersionId;
    locale = locale ?? ensured.locale;
  }

  const maxSubmissions =
    typeof input.maxSubmissions === "number" && Number.isFinite(input.maxSubmissions)
      ? input.maxSubmissions
      : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from("form_links")
      .insert({
        drive_id: input.driveId,
        drive_school_id: input.driveSchoolId,
        form_version_id: formVersionId,
        token: newLinkToken(),
        label: input.label?.trim() || null,
        locale: locale || "en",
        channel: "family",
        opens_at: input.opensAt ?? null,
        expires_at: input.expiresAt ?? null,
        max_submissions: maxSubmissions,
        created_by: userData.user?.id ?? null,
      })
      .select(FORM_LINK_COLUMNS)
      .single();

    if (!error && data) return { ok: true, link: mapFormLinkRow(data) };
    if (error?.code === "23505" && attempt < 2) continue;
    return { ok: false, error: error?.message ?? GENERIC_ERROR };
  }
  return { ok: false, error: GENERIC_ERROR };
}

/**
 * Revokes a link — families opening it afterwards get the same "ask your
 * counselor for a current link" page a nonexistent token gets (get_form and
 * submit_form both answer `not_found` for a revoked link, by design).
 *
 * Idempotent: the `is("revoked_at", null)` guard means re-revoking is a no-op
 * rather than moving the timestamp.
 */
export async function revokeFormLink(
  linkId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("form_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .is("revoked_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// =============================================================================
// Pure helpers
// =============================================================================

/** The public path a family opens. */
export function formPath(token: string): string {
  return `/form/${encodeURIComponent(token)}`;
}

/** The path a counselor opens. */
export function reviewPath(reviewToken: string): string {
  return `/review/${encodeURIComponent(reviewToken)}`;
}

/**
 * Substitutes `{budget}` in a field's help text with the definition's
 * `budgetPerChild`. Keeps the dollar figure a single value in a single place
 * (US-21) instead of a sentence someone has to re-edit when it's confirmed.
 */
export function resolveHelpText(
  definition: IntakeFormDefinition,
  field: IntakeFormField
): string | undefined {
  if (!field.help) return undefined;
  return field.help.replace(/\{budget\}/g, definition.budgetPerChild ?? "");
}

/**
 * An empty answers object for a definition — one blank child, every section
 * present. Use this to seed form state so the page never has to know which
 * section ids exist.
 */
export function emptyAnswers(definition: IntakeFormDefinition): IntakeAnswers {
  const answers: IntakeAnswers = {};
  for (const section of definition.sections) {
    if (section.repeating) {
      (answers as Record<string, unknown>)[section.id] = [{}];
    } else {
      (answers as Record<string, unknown>)[section.id] = {};
    }
  }
  return answers;
}

/**
 * Mirrors the database's `intake_apply_corrections` overlay so the staff
 * detail view can show "what the record will become" alongside the family's
 * original words.
 *
 * Do NOT use this to build the payload you send anywhere — `answers` on the
 * server is never rewritten, and the separation between the family's words and
 * the counselor's fix is the provenance record. Show them as two things.
 */
export function applyCorrections(
  answers: IntakeAnswers,
  corrections: SubmissionCorrections,
  /**
   * The definition's repeating section id. Defaults to "children", which is
   * what every Phase 1 definition uses. Pass `definition.sections.find(s =>
   * s.repeating)?.id` if you have the definition in hand — the database
   * resolves this key from the pinned version rather than assuming it, and this
   * mirror should agree with it.
   */
  sectionId: string = "children"
): IntakeAnswers {
  const children = (answers as Record<string, unknown>)[sectionId] as
    | IntakeChildAnswer[]
    | undefined;
  if (!Array.isArray(children) || !corrections || Object.keys(corrections).length === 0) {
    return answers;
  }
  return {
    ...answers,
    [sectionId]: children.map((child, idx) => {
      const fix = corrections[idx + 1];
      if (!fix) return child;
      const merged: IntakeChildAnswer = { ...child };
      if (fix.firstName !== undefined) merged.first_name = fix.firstName;
      if (fix.age !== undefined) merged.age = fix.age;
      if (fix.grade !== undefined) merged.grade = fix.grade;
      return merged;
    }),
  };
}

/**
 * The size a purchaser should actually read: the "Other" text wins if present.
 *
 * Safe to trust now because the server enforces the matching rule — a `_other`
 * value can only exist alongside a select whose value IS the "Other" option;
 * submit_form rejects a leftover `_other` next to a normal size. The form page
 * must therefore CLEAR the `_other` input when the select moves off "Other",
 * or the submission comes back with a validation error on that field.
 */
export function effectiveSize(
  child: IntakeChildAnswer,
  which: "shirt_size" | "pant_size" | "shoe_size"
): string | null {
  const other = child[`${which}_other` as keyof IntakeChildAnswer];
  if (typeof other === "string" && other.trim()) return other.trim();
  const value = child[which];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// =============================================================================
// Boundary mapping (snake_case wire shapes -> the app's camelCase types)
// =============================================================================

/**
 * The definition is authored as JSON in SQL (snake_case, to stay readable
 * beside the columns it maps to). This is the one place it becomes a
 * camelCase app type, so nothing downstream deals with both spellings.
 */
function normalizeDefinition(raw: any): IntakeFormDefinition {
  return {
    schemaVersion: raw?.schema_version ?? 1,
    locale: raw?.locale ?? "en",
    title: raw?.title ?? "",
    intro: raw?.intro ?? "",
    helpFooter: raw?.help_footer ?? undefined,
    privacyNote: raw?.privacy_note ?? undefined,
    submitLabel: raw?.submit_label ?? undefined,
    confirmation: raw?.confirmation ?? undefined,
    budgetPerChild: raw?.budget_per_child ?? undefined,
    honeypotField: raw?.honeypot_field ?? undefined,
    sections: (Array.isArray(raw?.sections) ? raw.sections : []).map(normalizeSection),
  };
}

function normalizeSection(raw: any): IntakeFormSection {
  return {
    id: raw?.id ?? "",
    title: raw?.title ?? "",
    help: raw?.help ?? undefined,
    repeating: Boolean(raw?.repeating),
    minItems: raw?.min_items ?? undefined,
    maxItems: raw?.max_items ?? undefined,
    itemLabel: raw?.item_label ?? undefined,
    addLabel: raw?.add_label ?? undefined,
    removeLabel: raw?.remove_label ?? undefined,
    fields: (Array.isArray(raw?.fields) ? raw.fields : []).map(normalizeField),
  };
}

function normalizeField(raw: any): IntakeFormField {
  return {
    id: raw?.id ?? "",
    label: raw?.label ?? raw?.id ?? "",
    help: raw?.help ?? undefined,
    type: (raw?.type ?? "text") as IntakeFormField["type"],
    required: Boolean(raw?.required),
    maxLength: raw?.max_length ?? undefined,
    min: raw?.min ?? undefined,
    max: raw?.max ?? undefined,
    options: Array.isArray(raw?.options) ? raw.options : undefined,
    otherField: raw?.other_field ?? undefined,
    otherValue: raw?.other_value ?? undefined,
    minItems: raw?.min_items ?? undefined,
    maxItems: raw?.max_items ?? undefined,
    firstRequired: Boolean(raw?.first_required),
    itemLabels: Array.isArray(raw?.item_labels) ? raw.item_labels : undefined,
  };
}

/**
 * `[{value,label}, ...]` off the wire, defensively. The database already
 * normalizes this (blank values dropped, label defaulted to value), so this is
 * a type boundary rather than a second implementation of the rule — but it
 * keeps a malformed definition from putting an option with no `value` into a
 * picker, where choosing it would silently send an empty grade.
 */
function normalizeOptions(raw: any): IntakeFormOption[] {
  if (!Array.isArray(raw)) return [];
  const out: IntakeFormOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = typeof item.value === "string" ? item.value.trim() : "";
    if (!value) continue;
    const label = typeof item.label === "string" && item.label.trim() ? item.label : value;
    out.push({ value, label });
  }
  return out;
}

/**
 * `correction_fields` off the wire -> CorrectionFields.
 *
 * The wire keys are the definition's own field ids (snake_case: `first_name`);
 * the app type keys match ChildCorrection (`firstName`), so the control that
 * edits a correction and the rule it obeys are looked up the same way. This is
 * the one place those two spellings meet, exactly as toDbCorrections is for the
 * write direction.
 *
 * Everything is defensive and falls to `null`, which the UI renders READ-ONLY.
 * That is the deliberately safe direction: a control with no rule behind it
 * must not become a free-text box, because verify_submission has no rule to
 * accept what gets typed into it. A missing key, an unexpected shape, and a
 * form version that genuinely doesn't collect the field all land in the same
 * place.
 */
function normalizeCorrectionFields(raw: any): CorrectionFields {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    firstName: normalizeCorrectionField(src.first_name),
    age: normalizeCorrectionField(src.age),
    grade: normalizeCorrectionField(src.grade),
  };
}

function normalizeCorrectionField(raw: any): CorrectionFieldDef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;
  return {
    id,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label : id,
    type: (typeof raw.type === "string" && raw.type
      ? raw.type
      : "text") as CorrectionFieldDef["type"],
    required: Boolean(raw.required),
    maxLength: finiteOrNull(raw.max_length),
    min: finiteOrNull(raw.min),
    max: finiteOrNull(raw.max),
    options: normalizeOptions(raw.options),
  };
}

/**
 * A bound is a number or it is absent. `0` is a real bound (`age.min`), so this
 * cannot be written as a falsy check — that bug would silently drop the lower
 * end of the age range.
 */
function finiteOrNull(value: any): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapRosterSubmission(raw: any): RosterSubmission {
  return {
    id: raw.id,
    status: raw.status as SubmissionStatus,
    submittedAt: raw.submitted_at ?? null,
    verifiedAt: raw.verified_at ?? null,
    verifiedByLabel: raw.verified_by_label ?? null,
    resolutionNote: raw.resolution_note ?? null,
    hasCorrections: Boolean(raw.has_corrections),
    children: (Array.isArray(raw.children) ? raw.children : []).map((c: any) => ({
      index: c.index ?? 0,
      firstName: c.first_name ?? null,
      age: typeof c.age === "number" ? c.age : null,
      grade: c.grade ?? null,
    })),
  };
}

function mapFormLinkRow(row: any): FormLinkRecord {
  return {
    id: row.id,
    driveId: row.drive_id,
    driveSchoolId: row.drive_school_id ?? null,
    token: row.token,
    label: row.label ?? null,
    locale: row.locale ?? "en",
    channel: row.channel as SubmissionChannel,
    opensAt: row.opens_at ?? null,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
    maxSubmissions: row.max_submissions ?? null,
    submissionCount: row.submission_count ?? 0,
  };
}

function mapSubmissionRecord(row: any): SubmissionRecord {
  const answers = (row.answers ?? {}) as IntakeAnswers;
  return {
    id: row.id,
    driveId: row.drive_id,
    driveSchoolId: row.drive_school_id ?? null,
    channel: row.channel as SubmissionChannel,
    status: row.status as SubmissionStatus,
    sourceLocale: row.source_locale ?? "en",
    submitterName: row.submitter_name ?? null,
    submitterPhone: row.submitter_phone ?? null,
    submitterEmail: row.submitter_email ?? null,
    submittedAt: row.submitted_at ?? null,
    firstViewedAt: row.first_viewed_at ?? null,
    verifiedAt: row.verified_at ?? null,
    verifiedByLabel: row.verified_by_label ?? null,
    importedAt: row.imported_at ?? null,
    importedFamilyId: row.imported_family_id ?? null,
    resolutionNote: row.resolution_note ?? null,
    answers,
    corrections: fromDbCorrections(row.corrections),
    childCount: Array.isArray(answers.children) ? answers.children.length : 0,
  };
}

/**
 * `{ 1: { firstName: "Maya" } }` -> `{ "1": { "first_name": "Maya" } }`.
 *
 * Only the three permitted keys are ever emitted. Undefined values are dropped
 * rather than sent as null, so "I didn't touch the grade" and "clear the
 * grade" can't be confused — the database treats a correction as a partial
 * update and rejects a blank name outright.
 */
function toDbCorrections(corrections?: SubmissionCorrections): Record<string, unknown> | null {
  if (!corrections) return null;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, fix] of Object.entries(corrections)) {
    if (!fix) continue;
    const child: Record<string, unknown> = {};
    if (fix.firstName !== undefined) child.first_name = fix.firstName;
    if (fix.age !== undefined) child.age = fix.age;
    if (fix.grade !== undefined) child.grade = fix.grade;
    if (Object.keys(child).length > 0) out[String(key)] = child;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function fromDbCorrections(raw: any): SubmissionCorrections {
  const out: SubmissionCorrections = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, any>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || !value || typeof value !== "object") continue;
    const fix: ChildCorrection = {};
    if (typeof value.first_name === "string") fix.firstName = value.first_name;
    if (typeof value.age === "number") fix.age = value.age;
    else if (typeof value.age === "string" && value.age.trim() !== "") fix.age = Number(value.age);
    if (typeof value.grade === "string") fix.grade = value.grade;
    out[index] = fix;
  }
  return out;
}
