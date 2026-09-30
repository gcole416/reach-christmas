import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenDriveId } from "./helpers/testClient";
import {
  DEMO_FORM_TOKEN,
  AUTOTEST_LINK_PREFIX,
  AUTOTEST_SUBMITTER_PREFIX,
  assertIntakeReady,
  autotestGuardian,
  cleanupIntakeTestData,
  rpcSubmitForm,
  runTag,
  sharedAdmin,
  sharedVolunteer,
} from "./helpers/intake";

// US-41 / US-42 (docs/backlog.md) — counselor email, on-demand and digest.
//
// PENDING LIVE MIGRATIONS: these run only once
// supabase/migrations/20260923120000_counselor_email_links.sql and
// 20260923130000_counselor_email_digest.sql are applied to dev
// (thvyntrxmahygesltgft), AND app_settings.site_url is set (see the first
// migration's header) — until then every send_counselor_* rpc call fails, and
// send_counselor_registration_link specifically fails on the "site address is
// not configured" branch first. That's the intended loud signal, same
// convention as child-on-hold.spec.ts.
//
// Boundary under test is the DATABASE (the four security-definer functions and
// the counselor_emails log), not a screen — same split as every other spec in
// this directory. FormLinkPanel's buttons/status lines are a thin wrapper
// verified by hand against these same functions (see each migration's VERIFY
// block).
//
// ---------------------------------------------------------------------------
// Deliberately NOT dependent on intake_demo_seed.sql
// ---------------------------------------------------------------------------
// Earlier drafts of this suite used demoFormVersionId()/DEMO_FORM_TOKEN /
// DEMO_REVIEW_TOKEN for everything, the same as the rest of this directory.
// On dev right now (2026-09-23) that seed isn't current, and Grant has real,
// non-test work sitting on dev he doesn't want touched to re-run it (two real
// schools, three real families, one review link already opened by his own
// inbox). So this suite creates its OWN fixtures from scratch and never reads
// or writes anything belonging to an existing non-AutoTest school.
//
// Fixture A / Fixture B (below): throwaway, deleted in afterAll.
//
// The review-link and digest tests need a school with a LIVE review token,
// and review_tokens rows are PERMANENT once issued (`authenticated` has no
// DELETE grant on that table by design — SCHEMA.md; the LinkMgmt suite only
// NEUTRALIZES them in place for the same reason). Rather than leaving behind
// a fresh, ever-growing pile of undeletable schools, resolveReviewFixture()
// below finds-or-creates exactly ONE persistent school —
// "AutoTest CounselorEmail ReviewFixture" — and reuses it across every future
// run, the same "fixed synthetic identifier, safe to re-run" idea
// intake_demo_seed.sql itself uses for its two demo tokens. It is never
// deleted and is expected to sit in the schools list permanently; the name
// says exactly what it is.
//
// Fixture A: liaison_email set, one live English form_links row. Used for the
//            registration-link success/cooldown/locale-missing cases, and the
//            review-link "nothing live yet" refusal.
// Fixture B: liaison_email left null. Used only for the "no liaison email"
//            refusal message, on both send functions.

type Json = Record<string, unknown>;

interface SchoolFixture {
  schoolId: string;
  driveSchoolId: string;
}

/**
 * A form_version_id valid for the currently open drive, with no dependency on
 * the intake demo seed. Prefers the demo token's version when it happens to
 * exist (so behavior doesn't change once Grant does re-seed it), otherwise
 * falls back to whatever an already-published, real family-channel link on
 * this drive points at — dev always has at least one of those once intake is
 * in use at all (confirmed 2026-09-23: two real schools, each with a live
 * link). Read-only either way; never mutates anything of Grant's.
 */
async function resolveOpenFormVersionId(admin: SupabaseClient, driveId: string): Promise<string> {
  const demo = await admin
    .from("form_links")
    .select("form_version_id")
    .eq("token", DEMO_FORM_TOKEN)
    .maybeSingle();
  const demoVersionId = (demo.data as Json | null)?.form_version_id as string | undefined;
  if (demoVersionId) return demoVersionId;

  const { data, error } = await admin
    .from("form_links")
    .select("form_version_id")
    .eq("drive_id", driveId)
    .eq("channel", "family")
    .not("form_version_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      "No published form_version found for the open drive — the demo seed isn't present AND " +
        "no real registration link exists yet to fall back to. Create at least one link on " +
        "/admin/submissions first, or run supabase/intake_demo_seed.sql."
    );
  }
  return (data as Json).form_version_id as string;
}

async function makeSchoolFixture(
  admin: SupabaseClient,
  driveId: string,
  opts: { tag: string; label: string; liaisonEmail: string | null; withEnglishLink: boolean }
): Promise<SchoolFixture> {
  const { data: school, error: schoolError } = await admin
    .from("schools")
    .insert({ name: `AutoTest CounselorEmail ${opts.label} ${opts.tag}`, liaison_email: opts.liaisonEmail })
    .select("id")
    .single();
  if (schoolError || !school) throw new Error(`fixture school insert failed: ${schoolError?.message}`);
  const schoolId = (school as Json).id as string;

  const { data: ds, error: dsError } = await admin
    .from("drive_schools")
    .insert({ drive_id: driveId, school_id: schoolId, code: `Z${opts.tag.slice(0, 3).toUpperCase()}` })
    .select("id")
    .single();
  if (dsError || !ds) throw new Error(`fixture drive_schools insert failed: ${dsError?.message}`);
  const driveSchoolId = (ds as Json).id as string;

  if (opts.withEnglishLink) {
    const versionId = await resolveOpenFormVersionId(admin, driveId);
    // Shares the token prefix cleanupIntakeTestData already sweeps
    // (`form_links where token like 'autotest-intake-link-%'`) — no separate
    // form_links cleanup needed here.
    const { error: linkError } = await admin.from("form_links").insert({
      drive_id: driveId,
      drive_school_id: driveSchoolId,
      form_version_id: versionId,
      token: `${AUTOTEST_LINK_PREFIX}${opts.tag}`,
      locale: "en",
      channel: "family",
    });
    if (linkError) throw new Error(`fixture form_links insert failed: ${linkError.message}`);
  }

  return { schoolId, driveSchoolId };
}

/** drive_schools first (blocked only by form_links, which cleanupIntakeTestData
 *  already swept by the shared AUTOTEST_LINK_PREFIX), then the school itself. */
async function teardownSchoolFixture(admin: SupabaseClient, fixture: SchoolFixture): Promise<void> {
  const { error: dsError } = await admin.from("drive_schools").delete().eq("id", fixture.driveSchoolId);
  if (dsError) throw new Error(`fixture drive_schools cleanup failed: ${dsError.message}`);
  const { error: schoolError } = await admin.from("schools").delete().eq("id", fixture.schoolId);
  if (schoolError) throw new Error(`fixture school cleanup failed: ${schoolError.message}`);
}

// ---------------------------------------------------------------------------
// The one PERSISTENT fixture — never torn down. See the file header for why.
// ---------------------------------------------------------------------------

const REVIEW_FIXTURE_SCHOOL_NAME = "AutoTest CounselorEmail ReviewFixture";
const REVIEW_FIXTURE_LIAISON_EMAIL = "autotest-counselor-review-fixture@autotest.example.com";
// Deliberately NOT under AUTOTEST_LINK_PREFIX — that prefix is swept by
// cleanupIntakeTestData on every run of every intake spec, and this token is
// meant to survive forever, the same as intake_demo_seed.sql's fixed tokens.
const REVIEW_FIXTURE_LINK_TOKEN = "autotest-counselor-review-fixture-persistent-link";
const REVIEW_FIXTURE_CODE_CANDIDATES = ["AT", "AF", "AZ"];

interface ReviewFixture {
  driveSchoolId: string;
  liaisonEmail: string;
  formToken: string;
}

/**
 * Finds, or creates once, the single persistent school this suite's
 * review-link and digest tests run against. Safe to call every run — every
 * lookup is by a fixed name/token, so a second run reuses the same rows
 * instead of creating new ones. Never deletes anything.
 */
async function resolveReviewFixture(admin: SupabaseClient, driveId: string): Promise<ReviewFixture> {
  let schoolId: string;
  let liaisonEmail: string;
  const existingSchool = await admin
    .from("schools")
    .select("id, liaison_email")
    .eq("name", REVIEW_FIXTURE_SCHOOL_NAME)
    .maybeSingle();
  if (existingSchool.data) {
    schoolId = (existingSchool.data as Json).id as string;
    liaisonEmail = ((existingSchool.data as Json).liaison_email as string | null) ?? REVIEW_FIXTURE_LIAISON_EMAIL;
  } else {
    const created = await admin
      .from("schools")
      .insert({ name: REVIEW_FIXTURE_SCHOOL_NAME, liaison_email: REVIEW_FIXTURE_LIAISON_EMAIL })
      .select("id, liaison_email")
      .single();
    if (created.error || !created.data) throw new Error(`review fixture school insert failed: ${created.error?.message}`);
    schoolId = (created.data as Json).id as string;
    liaisonEmail = REVIEW_FIXTURE_LIAISON_EMAIL;
  }

  let driveSchoolId: string;
  const existingDs = await admin
    .from("drive_schools")
    .select("id")
    .eq("drive_id", driveId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (existingDs.data) {
    driveSchoolId = (existingDs.data as Json).id as string;
  } else {
    let created: { data: Json | null; error: { message: string; code?: string } | null } | null = null;
    for (const code of REVIEW_FIXTURE_CODE_CANDIDATES) {
      const attempt = await admin
        .from("drive_schools")
        .insert({ drive_id: driveId, school_id: schoolId, code })
        .select("id")
        .single();
      if (!attempt.error) {
        created = { data: attempt.data as Json, error: null };
        break;
      }
      if (attempt.error.code !== "23505") {
        throw new Error(`review fixture drive_schools insert failed: ${attempt.error.message}`);
      }
      // code taken on this drive — try the next candidate
    }
    if (!created?.data) {
      throw new Error(
        `review fixture drive_schools insert failed: all of ${REVIEW_FIXTURE_CODE_CANDIDATES.join(", ")} are taken on this drive.`
      );
    }
    driveSchoolId = created.data.id as string;
  }

  const existingLink = await admin
    .from("form_links")
    .select("id")
    .eq("token", REVIEW_FIXTURE_LINK_TOKEN)
    .maybeSingle();
  if (!existingLink.data) {
    const versionId = await resolveOpenFormVersionId(admin, driveId);
    const { error: linkError } = await admin.from("form_links").insert({
      drive_id: driveId,
      drive_school_id: driveSchoolId,
      form_version_id: versionId,
      token: REVIEW_FIXTURE_LINK_TOKEN,
      locale: "en",
      channel: "family",
    });
    if (linkError) throw new Error(`review fixture form_links insert failed: ${linkError.message}`);
  }

  // issue_review_token is idempotent per school (reuses a live token if one
  // already exists) — the real RPC, not a raw insert, so this exercises the
  // actual issuing path too.
  const issued = await admin.rpc("issue_review_token", {
    p_drive_school_id: driveSchoolId,
    p_issued_to_email: liaisonEmail,
  });
  if (issued.error) throw new Error(`issue_review_token failed for the review fixture: ${issued.error.message}`);

  return { driveSchoolId, liaisonEmail, formToken: REVIEW_FIXTURE_LINK_TOKEN };
}

async function latestCounselorEmail(
  admin: SupabaseClient,
  driveSchoolId: string,
  kind: string,
  locale: string | null
) {
  let q = admin
    .from("counselor_emails")
    .select("id, kind, locale, sent_to, sent_by, created_at")
    .eq("drive_school_id", driveSchoolId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1);
  q = locale === null ? q.is("locale", null) : q.eq("locale", locale);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return data as Json | null;
}

test.describe("counselor email — on-demand sends (US-41)", () => {
  let admin: SupabaseClient;
  let driveId: string;
  let fixtureA: SchoolFixture; // liaison email + live English link, no review token
  let fixtureB: SchoolFixture; // no liaison email

  test.beforeAll(async () => {
    await assertIntakeReady({ needsSeed: false });
    admin = await sharedAdmin();
    driveId = await getOpenDriveId(admin);
    const tagA = runTag();
    const tagB = runTag();
    fixtureA = await makeSchoolFixture(admin, driveId, {
      tag: tagA,
      label: "FixtureA",
      liaisonEmail: `autotest-counselor-email-${tagA}@autotest.example.com`,
      withEnglishLink: true,
    });
    fixtureB = await makeSchoolFixture(admin, driveId, {
      tag: tagB,
      label: "FixtureB-NoLiaison",
      liaisonEmail: null,
      withEnglishLink: false,
    });
  });

  test.afterAll(async () => {
    // Fetched fresh (not the describe-scoped `admin`) so a beforeAll failure
    // before that assignment (e.g. assertIntakeReady rejecting) doesn't also
    // crash cleanup on `admin` being undefined and mask the real error — same
    // reason child-on-hold.spec.ts's afterAll does this instead of closing
    // over a shared variable. sharedAdmin() is memoized, so this is free once
    // beforeAll already signed in.
    const cleanupAdmin = await sharedAdmin();
    await cleanupIntakeTestData(cleanupAdmin); // sweeps fixtureA's form_links row
    if (fixtureA) await teardownSchoolFixture(cleanupAdmin, fixtureA);
    if (fixtureB) await teardownSchoolFixture(cleanupAdmin, fixtureB);
  });

  test("sends the English registration link and logs it; a repeat within 60s is refused", async () => {
    const sent = await admin.rpc("send_counselor_registration_link", {
      p_drive_school_id: fixtureA.driveSchoolId,
      p_locale: "en",
    });
    expect(sent.error, `send_counselor_registration_link raised: ${sent.error?.message}`).toBeNull();

    const row = await latestCounselorEmail(admin, fixtureA.driveSchoolId, "registration_link", "en");
    expect(row, "no counselor_emails row written for the successful send").not.toBeNull();
    expect(row!.sent_to).toContain("@autotest.example.com");
    expect(row!.sent_by, "sent_by not stamped with the acting admin").not.toBeNull();

    const again = await admin.rpc("send_counselor_registration_link", {
      p_drive_school_id: fixtureA.driveSchoolId,
      p_locale: "en",
    });
    expect(again.error, "the 60s cooldown did not refuse a repeat send").not.toBeNull();
    expect(again.error?.message ?? "").toMatch(/just sent/i);
  });

  test("refuses when there is no live link for that locale", async () => {
    const attempt = await admin.rpc("send_counselor_registration_link", {
      p_drive_school_id: fixtureA.driveSchoolId,
      p_locale: "es",
    });
    expect(attempt.error, "sent a Spanish link that doesn't exist").not.toBeNull();
    expect(attempt.error?.message ?? "").toMatch(/no live spanish registration link/i);
  });

  test("refuses when the school has no liaison email on file", async () => {
    const registration = await admin.rpc("send_counselor_registration_link", {
      p_drive_school_id: fixtureB.driveSchoolId,
      p_locale: "en",
    });
    expect(registration.error).not.toBeNull();
    expect(registration.error?.message ?? "").toMatch(/no liaison email/i);

    const review = await admin.rpc("send_counselor_review_link", {
      p_drive_school_id: fixtureB.driveSchoolId,
    });
    expect(review.error).not.toBeNull();
    expect(review.error?.message ?? "").toMatch(/no liaison email/i);
  });

  test("refuses to send a review link when the school has none live yet", async () => {
    const attempt = await admin.rpc("send_counselor_review_link", {
      p_drive_school_id: fixtureA.driveSchoolId,
    });
    expect(attempt.error, "sent a review link that doesn't exist").not.toBeNull();
    expect(attempt.error?.message ?? "").toMatch(/no live review link/i);
  });

  test("sends the review link for a school that already has one, and logs it", async () => {
    // Uses the persistent review fixture (see the file header) — issuing its
    // review token here is idempotent, so this is safe to run repeatedly.
    // NOTE: the send itself is NOT idempotent (60s cooldown, same as fixture
    // A's cooldown test) — re-running this whole suite twice inside a minute
    // will hit that cooldown here. That's the real, intended behavior, not a
    // test bug; wait a minute and re-run if it happens.
    const { driveSchoolId, liaisonEmail } = await resolveReviewFixture(admin, driveId);

    const sent = await admin.rpc("send_counselor_review_link", { p_drive_school_id: driveSchoolId });
    expect(sent.error, `send_counselor_review_link raised: ${sent.error?.message}`).toBeNull();

    const row = await latestCounselorEmail(admin, driveSchoolId, "review_link", null);
    expect(row, "no counselor_emails row written for the review-link send").not.toBeNull();
    expect(row!.sent_to).toBe(liaisonEmail);
  });

  test("a non-admin cannot send counselor email", async () => {
    const volunteer = await sharedVolunteer();
    for (const attempt of [
      volunteer.rpc("send_counselor_registration_link", {
        p_drive_school_id: fixtureA.driveSchoolId,
        p_locale: "en",
      }),
      volunteer.rpc("send_counselor_review_link", { p_drive_school_id: fixtureA.driveSchoolId }),
    ]) {
      const result = await attempt;
      expect(result.error, "a volunteer was NOT refused").not.toBeNull();
      expect(result.error?.message ?? "").toMatch(/administrator/i);
    }
  });
});

test.describe("counselor review digest (US-42)", () => {
  let admin: SupabaseClient;
  // The persistent review fixture (see the file header) — reused, never
  // deleted. formToken is what these tests submit AutoTest registrations
  // against, so they land as real 'submitted' pending counts for this school.
  let reviewFixtureDriveSchoolId: string;
  let reviewFixtureFormToken: string;

  test.beforeAll(async () => {
    await assertIntakeReady({ needsSeed: false });
    admin = await sharedAdmin();
    const driveId = await getOpenDriveId(admin);
    const fixture = await resolveReviewFixture(admin, driveId);
    reviewFixtureDriveSchoolId = fixture.driveSchoolId;
    reviewFixtureFormToken = fixture.formToken;
  });

  test.afterAll(async () => {
    // Fetched fresh — see the other describe's afterAll for why.
    const cleanupAdmin = await sharedAdmin();
    await cleanupIntakeTestData(cleanupAdmin);
    // Belt and braces: make sure no test here left the fixture paused.
    // Guarded on the fixture actually having resolved — a beforeAll failure
    // before that point leaves nothing to restore.
    if (reviewFixtureDriveSchoolId) {
      await cleanupAdmin
        .from("drive_schools")
        .update({ digest_paused: false })
        .eq("id", reviewFixtureDriveSchoolId);
    }
  });

  test("send_counselor_digests() cannot be called directly by any authenticated caller", async () => {
    const volunteer = await sharedVolunteer();
    for (const client of [admin, volunteer]) {
      const result = await client.rpc("send_counselor_digests");
      expect(
        result.error,
        "send_counselor_digests was callable directly — it must only run via the cron job"
      ).not.toBeNull();
      expect(result.error?.message ?? "").toMatch(/permission denied/i);
    }
  });

  test("a non-admin cannot trigger the digest manually", async () => {
    const volunteer = await sharedVolunteer();
    const result = await volunteer.rpc("send_counselor_digests_now");
    expect(result.error).not.toBeNull();
    expect(result.error?.message ?? "").toMatch(/administrator/i);
  });

  // send_counselor_digests_now() runs the REAL global digest loop — every
  // school in the open drive with a live review token, a liaison email, and
  // an unpaused digest, not just this suite's fixture. Confirmed safe against
  // dev as of 2026-09-23: neither of Grant's two real schools currently has
  // any submission in 'submitted'/'under_review' (both are 'verified' /
  // 'imported'), so a run today reaches only the review fixture below. If
  // that ever changes — a real registration sitting unconfirmed while these
  // tests run — this WOULD also (re-)email that school's real liaison.
  //
  // Order matters here: "paused" runs FIRST, before the fixture has ever been
  // digested, so its "no send" outcome is unambiguously about the pause flag —
  // not the 20260923140000 cooldown (which the very next test deliberately
  // exercises, and which would otherwise also explain a no-send here).

  test("a paused school is skipped even with a pending registration", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const submitted = await rpcSubmitForm(admin, {
      token: reviewFixtureFormToken,
      answers: {
        family: {
          guardian_name: guardian,
          guardian_phone: "555-0100",
          guardian_email: "autotest@demo.example.com",
          preferred_language: "en",
        },
        children: [
          {
            first_name: `${AUTOTEST_SUBMITTER_PREFIX}DigestPaused${tag}`,
            age: 9,
            grade: "4",
            sex: "Prefer not to say",
            shirt_size: "Youth M",
            pant_size: "Youth 10",
            shoe_size: "Youth 3",
            wishlist: ["a soccer ball"],
          },
        ],
        pickup_consent: { consent: true },
      },
    });
    expect(submitted.error).toBeNull();
    expect((submitted.data as Json).ok).toBe(true);

    await admin.from("drive_schools").update({ digest_paused: true }).eq("id", reviewFixtureDriveSchoolId);
    try {
      const before = await latestCounselorEmail(admin, reviewFixtureDriveSchoolId, "review_digest", null);
      const ran = await admin.rpc("send_counselor_digests_now");
      expect(ran.error).toBeNull();
      const after = await latestCounselorEmail(admin, reviewFixtureDriveSchoolId, "review_digest", null);
      expect(after?.id ?? null, "a paused school still got a digest").toBe(before?.id ?? null);
    } finally {
      await admin.from("drive_schools").update({ digest_paused: false }).eq("id", reviewFixtureDriveSchoolId);
    }
  });

  test("an admin-triggered digest emails a school with a pending registration, and a repeat within 5 minutes is skipped", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const submitted = await rpcSubmitForm(admin, {
      token: reviewFixtureFormToken,
      answers: {
        family: {
          guardian_name: guardian,
          guardian_phone: "555-0100",
          guardian_email: "autotest@demo.example.com",
          preferred_language: "en",
        },
        children: [
          {
            first_name: `${AUTOTEST_SUBMITTER_PREFIX}Digest${tag}`,
            age: 9,
            grade: "4",
            sex: "Prefer not to say",
            shirt_size: "Youth M",
            pant_size: "Youth 10",
            shoe_size: "Youth 3",
            wishlist: ["a soccer ball"],
          },
        ],
        pickup_consent: { consent: true },
      },
    });
    expect(submitted.error, `submit_form raised: ${submitted.error?.message}`).toBeNull();
    expect((submitted.data as Json).ok, `submit_form refused: ${JSON.stringify(submitted.data)}`).toBe(true);
    // Left in 'submitted' status on purpose — that's one of the two states
    // send_counselor_digests() counts as "waiting on the counselor".

    await admin.from("drive_schools").update({ digest_paused: false }).eq("id", reviewFixtureDriveSchoolId);
    const before = await latestCounselorEmail(admin, reviewFixtureDriveSchoolId, "review_digest", null);

    const ran = await admin.rpc("send_counselor_digests_now");
    expect(ran.error, `send_counselor_digests_now raised: ${ran.error?.message}`).toBeNull();

    const after = await latestCounselorEmail(admin, reviewFixtureDriveSchoolId, "review_digest", null);
    expect(after, "no review_digest row after a run with a pending submission").not.toBeNull();
    if (before) expect(after!.id).not.toBe(before.id);
    expect(after!.sent_by, "a cron-shaped send should have no sent_by").toBeNull();

    // 20260923140000: 5-minute-minimum per-school cooldown, same school still
    // pending. An immediate second run must not write a second row.
    const ranAgain = await admin.rpc("send_counselor_digests_now");
    expect(ranAgain.error).toBeNull();
    const stillAfter = await latestCounselorEmail(admin, reviewFixtureDriveSchoolId, "review_digest", null);
    expect(stillAfter?.id, "the digest cooldown did not stop an immediate repeat send").toBe(after!.id);
  });
});
