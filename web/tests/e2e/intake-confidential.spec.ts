import { test, expect } from "@playwright/test";
import { anonClient } from "./helpers/testClient";
import {
  AUTOTEST_LINK_PREFIX,
  DEMO_FORM_TOKEN,
  DEMO_REVIEW_TOKEN,
  autotestChildName,
  autotestGuardian,
  buildAnswers,
  cleanupIntakeTestData,
  demoFormVersionId,
  findSubmissionByGuardian,
  rpcGetReviewRoster,
  rpcImportSubmission,
  rpcSubmitForm,
  runTag,
  sharedAdmin,
  sharedVolunteer,
  assertIntakeReady,
} from "./helpers/intake";

// US-24 acceptance criterion 6 — a confidential-channel submission is invisible
// to an uncleared volunteer session.
//
// This also discharges reach-reviewer's runtime check 5: VERIFY block checks 13
// and 21 CANNOT be run in the Supabase SQL editor, because the editor runs as
// `postgres` and bypasses RLS entirely — run there they prove nothing. They
// have to come from a real signed-in volunteer session over the anon key, which
// is exactly what sharedVolunteer() gives.
//
// The confidential channel is a form_link with `drive_school_id is null`. The
// demo seed deliberately does NOT create one (see its header), so this spec
// creates one as an admin, uses it, and deletes it again.

type Json = Record<string, unknown>;

test.describe("confidential-channel intake (US-24 AC6)", () => {
  let confidentialSubmissionId = "";
  let confidentialToken = "";
  let confidentialChildName = "";
  let schoolSubmissionId = "";

  test.beforeAll(async () => {
    await assertIntakeReady();

    const admin = await sharedAdmin();
    const anon = anonClient();
    const tag = runTag();
    const { versionId, driveId } = await demoFormVersionId(admin);

    // --- the confidential-channel link (drive_school_id: null) ---
    confidentialToken = `${AUTOTEST_LINK_PREFIX}conf-${tag}`;
    const { error: linkError } = await admin.from("form_links").insert({
      drive_id: driveId,
      drive_school_id: null,
      form_version_id: versionId,
      token: confidentialToken,
      label: "AutoTest confidential channel",
      locale: "en",
      channel: "family",
      is_test_data: true,
    });
    if (linkError) {
      throw new Error(
        `Could not create the confidential-channel form link as an admin: ${linkError.message}`
      );
    }

    const confidentialGuardian = autotestGuardian(`${tag}-conf`);
    confidentialChildName = autotestChildName(tag, "Conf");
    const conf = await rpcSubmitForm(anon, {
      token: confidentialToken,
      answers: buildAnswers({
        guardianName: confidentialGuardian,
        children: [{ first_name: confidentialChildName, age: 9, grade: "4" }],
      }),
    });
    expect(conf.error).toBeNull();
    expect((conf.data as Json).ok, JSON.stringify(conf.data)).toBe(true);
    const confRow = await findSubmissionByGuardian(admin, confidentialGuardian);
    expect(confRow).not.toBeNull();
    expect(confRow!.drive_school_id, "the confidential submission is not on the confidential channel").toBeNull();
    confidentialSubmissionId = confRow!.id;

    // --- an ordinary school-channel submission, as the control ---
    const schoolGuardian = autotestGuardian(`${tag}-school`);
    const school = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: schoolGuardian,
        children: [{ first_name: autotestChildName(tag, "School"), age: 9, grade: "4" }],
      }),
    });
    expect((school.data as Json).ok).toBe(true);
    const schoolRow = await findSubmissionByGuardian(admin, schoolGuardian);
    schoolSubmissionId = schoolRow!.id;
  });

  test.afterAll(async () => {
    const admin = await sharedAdmin();
    await cleanupIntakeTestData(admin);
  });

  test("the test volunteer account really is uncleared (precondition)", async () => {
    const volunteer = await sharedVolunteer();
    const { data: session } = await volunteer.auth.getUser();
    const userId = session.user?.id;
    expect(userId, "the volunteer test account has no session").toBeTruthy();

    const { data: profile, error } = await volunteer
      .from("profiles")
      .select("role, can_view_confidential")
      .eq("id", userId!)
      .maybeSingle();

    // If the profile isn't self-readable that's fine — the behavioural tests
    // below are the real proof. But if it IS readable and says "cleared", every
    // assertion in this file would be vacuous, so say so loudly.
    if (!error && profile) {
      expect((profile as { role: string }).role).toBe("volunteer");
      expect(
        (profile as { can_view_confidential: boolean }).can_view_confidential,
        "TEST_VOLUNTEER_EMAIL has can_view_confidential — this spec would pass vacuously"
      ).toBe(false);
    }
  });

  // VERIFY check 13, from a real volunteer session rather than the SQL editor.
  test("an uncleared volunteer gets ZERO confidential-channel submissions, not an error", async () => {
    const volunteer = await sharedVolunteer();

    const direct = await volunteer
      .from("form_submissions")
      .select("id")
      .eq("id", confidentialSubmissionId)
      .maybeSingle();
    expect(direct.error, "RLS raised instead of returning no row").toBeNull();
    expect(direct.data, "a volunteer can read a confidential-channel submission").toBeNull();

    const scan = await volunteer.from("form_submissions").select("id").is("drive_school_id", null);
    expect(scan.error).toBeNull();
    expect(scan.data ?? [], "VERIFY 13: a volunteer sees confidential-channel submissions").toHaveLength(0);

    // The control: the ordinary school submission IS visible, so the empty
    // result above is confidentiality, not a broken query.
    const control = await volunteer
      .from("form_submissions")
      .select("id")
      .eq("id", schoolSubmissionId)
      .maybeSingle();
    expect(control.error).toBeNull();
    expect(control.data, "a volunteer cannot see an ordinary school submission either").not.toBeNull();
  });

  // VERIFY check 21, same reason — this is the M2 fix, and it can only be
  // observed as a non-owner.
  test("an uncleared volunteer never sees the confidential-channel form link, token or count", async () => {
    const volunteer = await sharedVolunteer();

    const { data, error } = await volunteer
      .from("form_links")
      .select("id, token, submission_count, drive_school_id");
    expect(error).toBeNull();

    const rows = (data ?? []) as Array<{ id: string; token: string; drive_school_id: string | null }>;
    expect(
      rows.filter((r) => r.drive_school_id === null),
      "VERIFY 21: a volunteer can read the confidential-channel link"
    ).toHaveLength(0);
    expect(
      rows.some((r) => r.token === confidentialToken),
      "the confidential link's plaintext token is readable by a plain volunteer"
    ).toBe(false);

    // The school link is still readable — the manual fallback in §11 depends on
    // it — so this is a gate, not a blanket denial.
    expect(rows.some((r) => r.drive_school_id !== null)).toBe(true);
  });

  test("an uncleared volunteer sees no submission_events for a confidential submission", async () => {
    const volunteer = await sharedVolunteer();
    const { data, error } = await volunteer
      .from("submission_events")
      .select("id")
      .eq("submission_id", confidentialSubmissionId);
    expect(error).toBeNull();
    expect(data ?? [], "a volunteer can read a confidential submission's event trail").toHaveLength(0);
  });

  test("a volunteer cannot import anything, confidential or not", async () => {
    const volunteer = await sharedVolunteer();

    const conf = await rpcImportSubmission(volunteer, confidentialSubmissionId);
    expect(conf.error).toBeNull();
    expect((conf.data as Json).ok, "a volunteer imported a confidential submission").toBe(false);

    const school = await rpcImportSubmission(volunteer, schoolSubmissionId);
    expect(school.error).toBeNull();
    expect((school.data as Json).ok, "a volunteer imported a school submission").toBe(false);
    expect((school.data as Json).reason).toBe("forbidden");
  });

  test("a confidential-channel submission is not on any counselor's roster", async () => {
    const anon = anonClient();
    const roster = await rpcGetReviewRoster(anon, DEMO_REVIEW_TOKEN);
    expect(roster.error).toBeNull();

    const payload = roster.data as { ok: boolean; submissions: Array<{ id: string }> };
    expect(payload.ok).toBe(true);
    expect(
      payload.submissions.some((s) => s.id === confidentialSubmissionId),
      "a confidential-channel submission appeared on the school roster"
    ).toBe(false);
    // ...and the control is there, so the roster isn't simply empty.
    expect(payload.submissions.some((s) => s.id === schoolSubmissionId)).toBe(true);
  });

  test("an admin CAN see and import the confidential submission, and the family is confidential", async () => {
    const admin = await sharedAdmin();
    const anon = anonClient();

    const visible = await admin
      .from("form_submissions")
      .select("id, drive_school_id, channel")
      .eq("id", confidentialSubmissionId)
      .maybeSingle();
    expect(visible.error).toBeNull();
    expect(visible.data, "an admin cannot see the confidential submission either").not.toBeNull();

    // It has no school, so no counselor can verify it — staff verify it via the
    // staff/confidential path. Set it verified as the admin, which is the only
    // door §8 leaves open for this channel in Phase 1.
    const { error: updateError } = await admin
      .from("form_submissions")
      .update({ status: "verified", verified_at: new Date().toISOString(), verified_by_label: "AutoTest Staff" })
      .eq("id", confidentialSubmissionId);
    expect(updateError, "an admin cannot verify a confidential submission").toBeNull();

    const imported = await rpcImportSubmission(admin, confidentialSubmissionId);
    expect(imported.error).toBeNull();
    expect((imported.data as Json).ok, JSON.stringify(imported.data)).toBe(true);
    // The default (null) inherits the channel: a confidential-channel
    // submission becomes a CONFIDENTIAL family, in the same write that creates
    // it — never import-then-edit.
    expect(
      (imported.data as Json).is_confidential,
      "a confidential-channel submission imported as an ordinary family"
    ).toBe(true);

    const familyId = (imported.data as Json).family_id as string;
    const { data: family } = await admin
      .from("families")
      .select("id, is_confidential, drive_school_id, source_submission_id")
      .eq("id", familyId)
      .single();
    expect((family as { is_confidential: boolean }).is_confidential).toBe(true);
    expect((family as { drive_school_id: string | null }).drive_school_id).toBeNull();

    // And the imported family is invisible to the volunteer, exactly like the
    // submission it came from.
    const volunteer = await sharedVolunteer();
    const hidden = await volunteer.from("families").select("id").eq("id", familyId).maybeSingle();
    expect(hidden.error).toBeNull();
    expect(hidden.data, "the imported confidential family is readable by a volunteer").toBeNull();

    // A sponsor never sees it either — public_available_cards is the whole
    // anon-facing boundary (AGENTS.md).
    const { data: cards, error: cardError } = await anon
      .from("public_available_cards")
      .select("*")
      .limit(1000);
    expect(cardError).toBeNull();
    const cardText = JSON.stringify(cards ?? []);
    expect(cardText, "a confidential child reached the public sponsor view").not.toContain(
      confidentialChildName
    );
    expect(cardText).not.toContain(familyId);
  });

  test("an admin can also mark an ordinary school submission confidential at import", async () => {
    const admin = await sharedAdmin();
    const anon = anonClient();
    const tag = runTag();
    const guardian = autotestGuardian(`${tag}-tier`);

    const submitted = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: guardian,
        children: [{ first_name: autotestChildName(tag, "Tier"), age: 9, grade: "4" }],
      }),
    });
    expect((submitted.data as Json).ok).toBe(true);
    const row = await findSubmissionByGuardian(admin, guardian);

    await admin
      .from("form_submissions")
      .update({ status: "verified", verified_at: new Date().toISOString(), verified_by_label: "AutoTest Staff" })
      .eq("id", row!.id);

    const imported = await rpcImportSubmission(admin, row!.id, true);
    expect(imported.error).toBeNull();
    expect((imported.data as Json).ok).toBe(true);
    expect(
      (imported.data as Json).is_confidential,
      "the confidential-tier override at import was ignored"
    ).toBe(true);

    const volunteer = await sharedVolunteer();
    const hidden = await volunteer
      .from("families")
      .select("id")
      .eq("id", (imported.data as Json).family_id as string)
      .maybeSingle();
    expect(hidden.data, "a family tiered confidential at import is still volunteer-readable").toBeNull();
  });

  // The sponsor-side half of the privacy boundary (AGENTS.md): an imported
  // family is a NEW way for a child's details to reach the anonymous sponsor
  // pages, and this is the only assertion that checks what actually arrives
  // there. Every value here came in through the intake form, so if
  // import_submission ever wrote a guardian's words into a published column,
  // this is where it shows up.
  test("a family imported from the form reaches /sponsor with ONLY the whitelisted columns", async () => {
    const admin = await sharedAdmin();
    const anon = anonClient();
    const tag = runTag();
    const guardian = autotestGuardian(`${tag}-pub`);
    const childName = autotestChildName(tag, "Public");
    const secrets = {
      guardianPhone: `555PUBSENTINEL${tag}`,
      guardianEmail: `pubsentinel${tag}@autotest.example.com`,
      notes: `PUBSENTINELNOTES${tag}`,
    };

    const submitted = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: guardian,
        guardianPhone: secrets.guardianPhone,
        guardianEmail: secrets.guardianEmail,
        children: [
          {
            first_name: childName,
            age: 9,
            grade: "4",
            wishlist: ["a kite"],
            other_notes: secrets.notes,
          },
        ],
      }),
    });
    expect((submitted.data as Json).ok, JSON.stringify(submitted.data)).toBe(true);
    const row = await findSubmissionByGuardian(admin, guardian);

    await admin
      .from("form_submissions")
      .update({
        status: "verified",
        verified_at: new Date().toISOString(),
        verified_by_label: "AutoTest Staff",
      })
      .eq("id", row!.id);
    const imported = await rpcImportSubmission(admin, row!.id);
    expect((imported.data as Json).ok, JSON.stringify(imported.data)).toBe(true);

    const { data: cards, error } = await anon
      .from("public_available_cards")
      .select("*")
      .limit(2000);
    expect(error).toBeNull();

    // The card really is published, so the assertions below mean "filtered",
    // not "the row never got here".
    const mine = (cards ?? []).filter(
      (c) => (c as { first_name?: string }).first_name === childName
    );
    expect(mine, "the imported child never reached the public sponsor view").toHaveLength(1);

    // The column whitelist itself. A new key here is a widened anon-facing
    // view, which AGENTS.md says must be a deliberate, reviewed change — so a
    // silent one fails this test rather than shipping.
    expect(Object.keys(mine[0] as object).sort()).toEqual([
      "card_id",
      "card_number",
      "first_name",
      "grade",
      "pant_size",
      "shirt_size",
      "shoe_size",
      "specific_needs",
      "wishlist_description",
    ]);

    // ...and nothing a sponsor must never see is anywhere in the payload:
    // no last name (the form never collects one), no school, no guardian.
    const payload = JSON.stringify(cards ?? []);
    for (const [label, value] of [
      ["guardian phone", secrets.guardianPhone],
      ["guardian email", secrets.guardianEmail],
      ["other notes", secrets.notes],
      ["guardian name", guardian],
      ["the school name", "Demo Elementary North"],
    ] as const) {
      expect(payload, `${label} reached the public sponsor view`).not.toContain(value);
    }
  });

  test("anon has no table access to any of the six intake tables", async () => {
    const anon = anonClient();
    for (const table of [
      "forms",
      "form_versions",
      "form_links",
      "review_tokens",
      "form_submissions",
      "submission_events",
    ]) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      // DB-2: the platform default would have granted anon SELECT here, so this
      // must be a permission error, not an empty result.
      expect(error, `anon can select from ${table}`).not.toBeNull();
      expect(data).toBeNull();
    }
  });
});
