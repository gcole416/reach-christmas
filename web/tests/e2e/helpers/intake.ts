import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient, signInAs } from "./testClient";

// Shared fixtures and cleanup for the counselor-vetted intake suite
// (US-21 .. US-24). Everything here is SYNTHETIC — no real family, child or
// sponsor value appears in any string in this file, and nothing touches prod
// (playwright.config.ts loads .env.development.local over .env.local, so the
// suite talks to the dev project thvyntrxmahygesltgft).
//
// ---------------------------------------------------------------------------
// Cleanup, and the one gap worth knowing about
// ---------------------------------------------------------------------------
// The existing sweep in cleanup.ts deletes `families where is_autotest_data`.
// That does NOT reach a family created by import_submission: the migration
// deliberately copies only the BROAD `is_test_data` flag from the link and
// leaves `is_autotest_data` false, so an e2e run can't delete a family that was
// imported during a stakeholder demo (see the comment at import_submission's
// families UPDATE). So this file cleans its own imports by walking
// `families.source_submission_id` back to the submissions THIS suite created,
// which are identified by their synthetic submitter_name prefix.
//
// Order matters: families/children point at form_submissions via
// source_submission_id with no ON DELETE clause, so families go first.

export const DEMO_FORM_TOKEN = "demo-north-family-2026";
export const DEMO_REVIEW_TOKEN = "demo-north-review-2026";

/** Every submission this suite creates carries this in submitter_name. */
export const AUTOTEST_SUBMITTER_PREFIX = "AutoTest Intake";
/** Every form_link this suite creates starts with this (>= 16 chars total). */
export const AUTOTEST_LINK_PREFIX = "autotest-intake-link-";
/** issued_to_email on every review_tokens row this suite creates (M3 probe). */
export const AUTOTEST_REVIEW_EMAIL = "autotest-m3-probe@autotest.example.com";

/** Short, collision-resistant suffix so parallel-ish reruns don't read each other's rows. */
export function runTag(): string {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

// ---------------------------------------------------------------------------
// Signed-in clients, memoized per worker.
//
// TST-1: the two shared test accounts hit Supabase Auth's rate limit when the
// suite signs in over and over. These specs need an admin in nearly every test,
// so the session is established once and reused. `signInAs` is still used
// directly where a test genuinely needs a SECOND, independent session (the
// concurrent-import race).
// ---------------------------------------------------------------------------

let adminClientPromise: Promise<SupabaseClient> | null = null;
let volunteerClientPromise: Promise<SupabaseClient> | null = null;

export function sharedAdmin(): Promise<SupabaseClient> {
  adminClientPromise ??= signInAs("admin");
  return adminClientPromise;
}

export function sharedVolunteer(): Promise<SupabaseClient> {
  volunteerClientPromise ??= signInAs("volunteer");
  return volunteerClientPromise;
}

// ---------------------------------------------------------------------------
// Preflight: is the migration (and the demo seed) actually on this database?
//
// APPLIED 2026-09-01 to dev (thvyntrxmahygesltgft). Before that, these specs
// SKIPPED themselves when the functions were missing, so that fifteen identical
// "function does not exist" failures couldn't bury a real defect.
//
// That behaviour is GONE on purpose. Now that the migration is on dev, a
// skipped intake test is a false green: it reports "nothing to see here" for
// exactly the feature we are trying to prove. `assertIntakeReady()` throws
// instead, so a missing migration, a missing seed, or a revoked demo link all
// surface as a loud red failure with the reason attached.
// ---------------------------------------------------------------------------

export interface IntakeStatus {
  functionsPresent: boolean;
  seedPresent: boolean;
  detail: string;
}

let statusPromise: Promise<IntakeStatus> | null = null;

function looksLikeMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // PGRST202 = PostgREST couldn't find the function in its schema cache.
  // 42883    = Postgres "function ... does not exist".
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function/i.test(error.message ?? "") ||
    /does not exist/i.test(error.message ?? "")
  );
}

export function intakeStatus(): Promise<IntakeStatus> {
  if (statusPromise) return statusPromise;
  statusPromise = (async (): Promise<IntakeStatus> => {
    const anon = anonClient();
    const probe = await anon.rpc("get_form", { p_token: "autotest-probe-no-such-token" });
    if (looksLikeMissingFunction(probe.error)) {
      return {
        functionsPresent: false,
        seedPresent: false,
        detail: `get_form is not on this database: ${probe.error?.code} ${probe.error?.message}`,
      };
    }
    if (probe.error) {
      return {
        functionsPresent: true,
        seedPresent: false,
        detail: `get_form exists but errored on an unknown token: ${probe.error.code} ${probe.error.message}`,
      };
    }

    const seed = await anon.rpc("get_form", { p_token: DEMO_FORM_TOKEN });
    const ok = Boolean((seed.data as { ok?: boolean } | null)?.ok);
    return {
      functionsPresent: true,
      seedPresent: ok,
      detail: ok
        ? "intake migration and demo seed both present"
        : `intake migration present, but the demo form link is not seeded: ${JSON.stringify(seed.data)}`,
    };
  })();
  return statusPromise;
}

/**
 * Call from `beforeAll`. THROWS — never skips — when the intake feature isn't
 * on this database. See the note above: a skipped intake test now reads as a
 * pass, and this suite exists to make failures loud.
 */
export async function assertIntakeReady(opts: { needsSeed?: boolean } = {}): Promise<void> {
  const status = await intakeStatus();
  if (!status.functionsPresent) {
    throw new Error(
      "supabase/migrations/20260830120000_intake_forms.sql is not on the database this " +
        "suite is pointed at. Check that .env.development.local names the dev project " +
        `(thvyntrxmahygesltgft), then re-run. Probe said: ${status.detail}`
    );
  }
  if (opts.needsSeed !== false && !status.seedPresent) {
    throw new Error(
      "supabase/intake_demo_seed.sql has not been run on this database, so " +
        `/form/${DEMO_FORM_TOKEN} and /review/${DEMO_REVIEW_TOKEN} have nothing behind ` +
        `them. Probe said: ${status.detail}`
    );
  }
}

// ---------------------------------------------------------------------------
// Synthetic answers
// ---------------------------------------------------------------------------

export interface TestChildAnswer {
  first_name: string;
  age: number | string;
  grade: string;
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
}

export interface TestAnswersInput {
  guardianName: string;
  guardianPhone?: string;
  guardianEmail?: string;
  preferredLanguage?: "en" | "es";
  children: TestChildAnswer[];
  canReachChurchPickup?: string;
  consent?: boolean;
  /** US-30 "everyone lives in my home" gate. Defaults to checked; set false to leave it unchecked. */
  everyoneLivesHere?: boolean;
}

/**
 * The exact snake_case shape the seeded definition describes. `answers` is
 * stored byte-for-byte as the provenance record, so nothing here is renamed on
 * the way out — same rule the real form page follows.
 */
export function buildAnswers(input: TestAnswersInput): Record<string, unknown> {
  return {
    family: {
      guardian_name: input.guardianName,
      guardian_phone: input.guardianPhone ?? "555-0100",
      ...(input.guardianEmail ? { guardian_email: input.guardianEmail } : {}),
      preferred_language: input.preferredLanguage ?? "en",
    },
    children: input.children.map((child) => ({
      first_name: child.first_name,
      age: child.age,
      grade: child.grade,
      sex: child.sex ?? "Prefer not to say",
      shirt_size: child.shirt_size ?? "Youth M",
      ...(child.shirt_size_other ? { shirt_size_other: child.shirt_size_other } : {}),
      pant_size: child.pant_size ?? "Youth 10",
      ...(child.pant_size_other ? { pant_size_other: child.pant_size_other } : {}),
      shoe_size: child.shoe_size ?? "Youth 3",
      ...(child.shoe_size_other ? { shoe_size_other: child.shoe_size_other } : {}),
      wishlist: child.wishlist ?? ["a soccer ball"],
      ...(child.specific_needs ? { specific_needs: child.specific_needs } : {}),
      ...(child.other_notes ? { other_notes: child.other_notes } : {}),
    })),
    pickup_consent: {
      can_reach_church_pickup: input.canReachChurchPickup ?? "Yes",
      consent: input.consent ?? true,
    },
  };
}

/**
 * A syntactically valid, unguessable bcrypt string. Used to make an autotest
 * review_tokens row inert: crypt() can parse it, and nothing will ever match it.
 */
export function inertBcryptHash(): string {
  const alphabet = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let body = "";
  for (let i = 0; i < 53; i += 1) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  // $2a$06$ + 22-char salt + 31-char digest is the shape extensions.crypt parses.
  return `$2a$06$${body}`;
}

/**
 * Rewrites every autotest review token to a parseable, revoked, expired row.
 *
 * There is no DELETE grant on review_tokens for `authenticated` (§9 — the table
 * is write-only by design), so this is the strongest cleanup available and the
 * reason the M3 probe is safe to run against the shared dev project at all.
 */
export async function neutralizeAutotestReviewTokens(admin: SupabaseClient): Promise<void> {
  await admin
    .from("review_tokens")
    .update({
      token_hash: inertBcryptHash(),
      revoked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .eq("issued_to_email", AUTOTEST_REVIEW_EMAIL);
}

/** A guardian name that cleanup can find. */
export function autotestGuardian(tag: string): string {
  return `${AUTOTEST_SUBMITTER_PREFIX} ${tag}`;
}

/** A child first name that is unmistakably ours and sorts to the end of any list. */
export function autotestChildName(tag: string, suffix = ""): string {
  return `Zzautotest${tag}${suffix}`;
}

// ---------------------------------------------------------------------------
// Thin RPC wrappers used where the test needs the RAW response body
// (the privacy assertion) or a client other than lib/intake.ts's singleton.
// Everywhere else the tests use web/lib/intake.ts, per the story.
// ---------------------------------------------------------------------------

export async function rpcSubmitForm(
  client: SupabaseClient,
  args: { token: string; answers: unknown; contact?: unknown; honeypot?: string | null }
) {
  return client.rpc("submit_form", {
    p_token: args.token,
    p_answers: args.answers,
    p_contact: args.contact ?? null,
    p_honeypot: args.honeypot ?? null,
  });
}

export async function rpcGetReviewRoster(client: SupabaseClient, reviewToken: string) {
  return client.rpc("get_review_roster", { p_review_token: reviewToken });
}

export async function rpcVerifySubmission(
  client: SupabaseClient,
  args: {
    reviewToken: string;
    submissionId: string;
    verifierName: string;
    corrections?: unknown;
  }
) {
  return client.rpc("verify_submission", {
    p_review_token: args.reviewToken,
    p_submission_id: args.submissionId,
    p_verifier_name: args.verifierName,
    p_corrections: args.corrections ?? null,
  });
}

export async function rpcRejectSubmission(
  client: SupabaseClient,
  args: { reviewToken: string; submissionId: string; reason: string; asDuplicate?: boolean }
) {
  return client.rpc("reject_submission", {
    p_review_token: args.reviewToken,
    p_submission_id: args.submissionId,
    p_reason: args.reason,
    p_as_duplicate: args.asDuplicate ?? false,
  });
}

export async function rpcImportSubmission(
  client: SupabaseClient,
  submissionId: string,
  isConfidential: boolean | null = null
) {
  return client.rpc("import_submission", {
    p_submission_id: submissionId,
    p_is_confidential: isConfidential,
  });
}

/**
 * The literal HTTP response body of get_review_roster, as text.
 *
 * US-24's privacy criterion is asserted against the RESPONSE BODY, not the
 * rendered page and not a mapped object — frontend-designer's point is that the
 * roster UI cannot prove this by construction, because it was simply never
 * handed the fields. This is the only assertion that can.
 */
export async function fetchReviewRosterBody(reviewToken: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY for the raw roster fetch.");

  const response = await fetch(`${url}/rest/v1/rpc/get_review_roster`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_review_token: reviewToken }),
  });
  return response.text();
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface SubmissionRow {
  id: string;
  status: string;
  drive_school_id: string | null;
  channel: string;
  form_link_id: string;
  imported_family_id: string | null;
  submitter_name: string | null;
  corrections: Record<string, unknown>;
}

/** Finds the submission this suite just wrote, by its synthetic guardian name. Admin client. */
export async function findSubmissionByGuardian(
  admin: SupabaseClient,
  guardianName: string
): Promise<SubmissionRow | null> {
  const { data, error } = await admin
    .from("form_submissions")
    .select(
      "id, status, drive_school_id, channel, form_link_id, imported_family_id, submitter_name, corrections"
    )
    .eq("submitter_name", guardianName)
    .maybeSingle();
  if (error) throw new Error(`findSubmissionByGuardian failed: ${error.message}`);
  return (data as SubmissionRow | null) ?? null;
}

/** The published form_version the demo link is pinned to — needed to build a second link. */
export async function demoFormVersionId(admin: SupabaseClient): Promise<{ versionId: string; driveId: string; driveSchoolId: string | null }> {
  const { data, error } = await admin
    .from("form_links")
    .select("form_version_id, drive_id, drive_school_id")
    .eq("token", DEMO_FORM_TOKEN)
    .maybeSingle();
  if (error) throw new Error(`Could not read the demo form link: ${error.message}`);
  if (!data) throw new Error(`The demo form link '${DEMO_FORM_TOKEN}' is not seeded on this project.`);
  return {
    versionId: (data as Record<string, string>).form_version_id,
    driveId: (data as Record<string, string>).drive_id,
    driveSchoolId: (data as Record<string, string | null>).drive_school_id,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Removes everything the intake suite created, in FK order:
 *   1. breaks the families <-> form_submissions FK CYCLE (see below),
 *   2. families imported from our submissions (children/cards/wishlist cascade),
 *   3. the submissions themselves (submission_events cascade),
 *   4. any form_links this suite created,
 *   5. re-syncs form_links.submission_count so the demo link's staff panel
 *      doesn't show a running total of test registrations at the walkthrough.
 *
 * Deliberately keyed on our own submitter_name prefix / link token prefix —
 * never on the broad `is_test_data` flag, which the demo seed also sets.
 *
 * THE CYCLE, because it is not obvious and it cost a red run to find:
 * `families.source_submission_id -> form_submissions.id` and
 * `form_submissions.imported_family_id -> families.id` point at each other,
 * neither with an ON DELETE clause. So deleting the family first fails on
 * form_submissions_imported_family_id_fkey, and deleting the submission first
 * fails on the families side. `imported_family_id` has to be nulled before
 * either delete can proceed.
 */
export async function cleanupIntakeTestData(admin: SupabaseClient): Promise<void> {
  // afterAll still runs when a describe failed in beforeAll, and there is
  // nothing to clean up (or even to query) if the feature isn't on the database.
  const status = await intakeStatus();
  if (!status.functionsPresent) return;

  // Belt and braces for the M3 blast-radius probe (intake-runtime-checks): a
  // review_tokens row whose token_hash passes the constraint's regex but that
  // bcrypt cannot parse makes crypt() RAISE for every counselor at every
  // school. `authenticated` has no DELETE grant on review_tokens by design, so
  // such a row is neutralized in place — rewritten to a parseable hash, revoked
  // and expired. This runs unconditionally, so an interrupted probe can't
  // outlive the run that created it and break the 9/9 demo link.
  await neutralizeAutotestReviewTokens(admin);

  const { data: subs, error: findError } = await admin
    .from("form_submissions")
    .select("id, form_link_id")
    .like("submitter_name", `${AUTOTEST_SUBMITTER_PREFIX}%`);
  if (findError) throw new Error(`Intake cleanup failed listing submissions: ${findError.message}`);

  const ids = (subs ?? []).map((row) => (row as { id: string }).id);
  const linkIds = Array.from(new Set((subs ?? []).map((row) => (row as { form_link_id: string }).form_link_id)));

  if (ids.length > 0) {
    // Break the cycle first. Without this the family delete below fails with
    // "violates foreign key constraint form_submissions_imported_family_id_fkey".
    const { error: unlinkError } = await admin
      .from("form_submissions")
      .update({ imported_family_id: null })
      .in("id", ids)
      .not("imported_family_id", "is", null);
    if (unlinkError) {
      throw new Error(`Intake cleanup failed unlinking imported families: ${unlinkError.message}`);
    }

    const { error: familyError } = await admin.from("families").delete().in("source_submission_id", ids);
    if (familyError) throw new Error(`Intake cleanup failed deleting imported families: ${familyError.message}`);

    const { error: subError } = await admin.from("form_submissions").delete().in("id", ids);
    if (subError) throw new Error(`Intake cleanup failed deleting submissions: ${subError.message}`);

    // The sweep is only worth trusting if it emptied. A silently-failing
    // cleanup is how a stale AutoTest family ends up in the 9/9 walkthrough.
    const { count: leftover } = await admin
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .like("submitter_name", `${AUTOTEST_SUBMITTER_PREFIX}%`);
    if ((leftover ?? 0) > 0) {
      throw new Error(
        `Intake cleanup left ${leftover} AutoTest submission(s) behind — check for an ` +
          "imported family still referencing one."
      );
    }
  }

  const { error: linkError } = await admin
    .from("form_links")
    .delete()
    .like("token", `${AUTOTEST_LINK_PREFIX}%`);
  if (linkError) throw new Error(`Intake cleanup failed deleting form links: ${linkError.message}`);

  // Put each touched link's counter back to the number of submissions that
  // actually still exist on it. submit_form increments it on every call, so
  // without this the demo link's staff panel drifts upward with every run.
  for (const linkId of linkIds) {
    const { count, error: countError } = await admin
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("form_link_id", linkId);
    if (countError) continue;
    await admin.from("form_links").update({ submission_count: count ?? 0 }).eq("id", linkId);
  }
}

// ---------------------------------------------------------------------------
// Browser helpers for the public form page
// ---------------------------------------------------------------------------

/**
 * Mirrors fieldDomId() in web/app/form/[token]/fields.tsx:
 * "children[0].first_name" -> "f-children-0-first-name".
 *
 * Copied rather than imported on purpose — importing a "use client" .tsx into
 * the Node-side test would drag the whole app module graph in, and this is a
 * two-line pure function that the page exports as a stable contract.
 */
export function formFieldId(path: string): string {
  return `f-${path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "")}`;
}

// ---------------------------------------------------------------------------
// Browser helpers for the counselor roster page
// ---------------------------------------------------------------------------

/**
 * The ONE roster card whose first child is `childName`.
 *
 * Deliberately not "the first card in Waiting on you". The dev project is
 * shared, the roster is season-long, and get_review_roster orders by
 * submitted_at — so "first" is whatever anyone else left behind, and a test
 * that assumes otherwise silently edits a stranger's registration instead of
 * failing. Scoping by the synthetic child name this run generated is the only
 * stable handle the page offers.
 *
 * Returns the RosterCard's outermost container, so `.getByLabel("Age")`,
 * `.getByRole("button", ...)` and the card's `role="alert"` all resolve within
 * this registration and no other.
 */
/** Values here are generated tags, but quote them properly anyway. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/** React's useId() emits «r3»-style ids, so an XPath literal needs real quoting. */
function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.split("'").join(`', "'", '`)}')`;
}

/**
 * Pins the ONE roster card whose first child is `childName`, and returns a
 * locator that stays valid while the counselor edits that card.
 *
 * Two traps this walks around, both found the hard way:
 *
 *  1. NOT "the first card in Waiting on you". The dev project is shared and the
 *     roster is season-long, so "first" is whatever another run left behind — a
 *     positional selector silently edits a stranger's registration instead of
 *     failing.
 *
 *  2. NOT `input[value="..."]` either, which is the obvious fix for (1) and is
 *     wrong: React keeps a controlled input's `value` ATTRIBUTE in sync with
 *     its state, so the selector stops matching the moment the test types into
 *     the field — and every later step in the card times out somewhere
 *     unrelated. The value is only used to find the input ONCE; from there the
 *     card is pinned by the input's `id`, which RosterCard derives from
 *     `useId()` and never changes.
 *
 * The card itself is the nearest ancestor <div> that contains a button, i.e.
 * PublicCard's wrapper (the label/grid/group wrappers between them contain
 * none). That's structural, so it survives restyling in a way a Tailwind class
 * selector would not.
 */
export async function waitForRosterCard(page: Page, childName: string): Promise<Locator> {
  const nameInput = page.locator(`input[value="${cssEscape(childName)}"]`);
  await expect(
    nameInput,
    `the roster never showed an editable card for "${childName}" — either ` +
      "get_review_roster didn't return this submission, or its correction controls " +
      "rendered read-only"
  ).toHaveCount(1);

  const inputId = await nameInput.getAttribute("id");
  if (!inputId) {
    throw new Error(
      "the roster's first-name input has no id — RosterCard's useId() wiring changed, and " +
        "these tests pin a card by it"
    );
  }

  const card = page.locator(
    `xpath=//input[@id=${xpathLiteral(inputId)}]/ancestor::div[.//button][1]`
  );
  await expect(card, "could not isolate a single roster card for this submission").toHaveCount(1);
  return card;
}

/** Fills the seeded English form for a single-child submission and submits it. */
export async function fillAndSubmitFamilyForm(
  page: Page,
  input: TestAnswersInput
): Promise<void> {
  const sel = (path: string) => page.locator(`#${formFieldId(path)}`);

  await sel("family.guardian_name").fill(input.guardianName);
  await sel("family.guardian_phone").fill(input.guardianPhone ?? "555-0100");
  if (input.guardianEmail) await sel("family.guardian_email").fill(input.guardianEmail);
  await sel("family.preferred_language").selectOption(input.preferredLanguage ?? "en");

  for (let i = 0; i < input.children.length; i += 1) {
    if (i > 0) await page.getByRole("button", { name: /add another child/i }).click();
    const child = input.children[i];
    await sel(`children[${i}].first_name`).fill(child.first_name);
    await sel(`children[${i}].age`).fill(String(child.age));
    await sel(`children[${i}].grade`).selectOption(child.grade);
    await sel(`children[${i}].sex`).selectOption(child.sex ?? "Prefer not to say");
    await sel(`children[${i}].shirt_size`).selectOption(child.shirt_size ?? "Youth M");
    if (child.shirt_size_other) {
      await sel(`children[${i}].shirt_size_other`).fill(child.shirt_size_other);
    }
    await sel(`children[${i}].pant_size`).selectOption(child.pant_size ?? "Youth 10");
    if (child.pant_size_other) {
      await sel(`children[${i}].pant_size_other`).fill(child.pant_size_other);
    }
    await sel(`children[${i}].shoe_size`).selectOption(child.shoe_size ?? "Youth 3");
    if (child.shoe_size_other) {
      await sel(`children[${i}].shoe_size_other`).fill(child.shoe_size_other);
    }
    const wishes = child.wishlist ?? ["a soccer ball"];
    for (let w = 0; w < wishes.length; w += 1) {
      if (w > 0) await page.getByRole("button", { name: /add another idea/i }).last().click();
      await sel(`children[${i}].wishlist[${w}]`).fill(wishes[w]);
    }
    if (child.specific_needs) await sel(`children[${i}].specific_needs`).fill(child.specific_needs);
    if (child.other_notes) await sel(`children[${i}].other_notes`).fill(child.other_notes);
  }

  await sel("pickup_consent.can_reach_church_pickup").selectOption(
    input.canReachChurchPickup ?? "Yes"
  );
  if (input.consent !== false) await sel("pickup_consent.consent").check();

  // Hardcoded gate on the form (US-30), not a definition field: the person must
  // affirm everyone listed lives in their home before it will send.
  if (input.everyoneLivesHere !== false) await sel("everyone_lives_here").check();

  await page.getByRole("button", { name: /submit registration/i }).click();
}
