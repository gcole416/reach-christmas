import { test, expect } from "@playwright/test";
import { anonClient, signInAs } from "./helpers/testClient";
import {
  sharedAdmin,
  DEMO_FORM_TOKEN,
  DEMO_REVIEW_TOKEN,
  autotestChildName,
  autotestGuardian,
  buildAnswers,
  cleanupIntakeTestData,
  fetchReviewRosterBody,
  findSubmissionByGuardian,
  rpcGetReviewRoster,
  rpcImportSubmission,
  rpcRejectSubmission,
  rpcSubmitForm,
  rpcVerifySubmission,
  runTag,
  assertIntakeReady,
} from "./helpers/intake";

// US-24 acceptance criteria 2-5, plus the correction-scope and 81-character
// regressions, exercised at the function boundary.
//
// These go through the RPCs rather than the pages on purpose: every one of them
// is a claim about what the DATABASE does, and a client-side check is not the
// boundary here (AGENTS.md). The walkthrough spec covers the same lifecycle
// through the real screens.

type Json = Record<string, unknown>;

/** Submits as a true anonymous caller and returns the row it created. */
async function submitAndFind(guardian: string, answers: unknown) {
  const anon = anonClient();
  const result = await rpcSubmitForm(anon, { token: DEMO_FORM_TOKEN, answers });
  expect(result.error, `submit_form raised: ${result.error?.message}`).toBeNull();
  expect((result.data as Json).ok, `submit_form refused: ${JSON.stringify(result.data)}`).toBe(true);
  const admin = await sharedAdmin();
  const row = await findSubmissionByGuardian(admin, guardian);
  expect(row, "submit_form reported success but wrote no row").not.toBeNull();
  return row!;
}

test.describe("intake server functions (US-24 AC2-AC5)", () => {
  test.beforeAll(async () => {
    await assertIntakeReady();
  });

  test.afterAll(async () => {
    const admin = await sharedAdmin();
    await cleanupIntakeTestData(admin);
  });

  // --- AC3: honeypot -------------------------------------------------------
  test("a filled honeypot returns success to the caller but writes no submission", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const anon = anonClient();
    const admin = await sharedAdmin();

    const { data: linkBefore } = await admin
      .from("form_links")
      .select("submission_count")
      .eq("token", DEMO_FORM_TOKEN)
      .single();

    const result = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: guardian,
        children: [{ first_name: autotestChildName(tag, "Bot"), age: 9, grade: "4" }],
      }),
      honeypot: "i-am-a-bot",
    });

    // A bot gets exactly what a family gets.
    expect(result.error).toBeNull();
    expect((result.data as Json).ok).toBe(true);
    expect((result.data as Json).status).toBe("submitted");

    // ...and nothing was written.
    const row = await findSubmissionByGuardian(admin, guardian);
    expect(row, "a filled honeypot created a form_submissions row").toBeNull();

    const { data: linkAfter } = await admin
      .from("form_links")
      .select("submission_count")
      .eq("token", DEMO_FORM_TOKEN)
      .single();
    expect(
      (linkAfter as { submission_count: number }).submission_count,
      "a filled honeypot incremented form_links.submission_count"
    ).toBe((linkBefore as { submission_count: number }).submission_count);
  });

  // --- AC2: rejection ------------------------------------------------------
  test("a rejected submission can never be imported", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const anon = anonClient();
    const admin = await sharedAdmin();

    const submission = await submitAndFind(
      guardian,
      buildAnswers({
        guardianName: guardian,
        children: [{ first_name: autotestChildName(tag, "Rejected"), age: 10, grade: "5" }],
      })
    );

    const rejected = await rpcRejectSubmission(anon, {
      reviewToken: DEMO_REVIEW_TOKEN,
      submissionId: submission.id,
      reason: "AutoTest — not a family from our school",
    });
    expect(rejected.error).toBeNull();
    expect((rejected.data as Json).ok).toBe(true);
    expect((rejected.data as Json).status).toBe("rejected");

    // Import refuses it, as an admin, by status — not by anything the UI does.
    const imported = await rpcImportSubmission(admin, submission.id);
    expect(imported.error).toBeNull();
    expect((imported.data as Json).ok).toBe(false);
    expect((imported.data as Json).reason).toBe("not_verified");

    // And no family was created behind it.
    const { data: families } = await admin
      .from("families")
      .select("id")
      .eq("source_submission_id", submission.id);
    expect(families ?? []).toHaveLength(0);

    // A rejected submission also cannot be talked back into `verified` through
    // the counselor door, which is the other way it could become importable.
    const reVerify = await rpcVerifySubmission(anon, {
      reviewToken: DEMO_REVIEW_TOKEN,
      submissionId: submission.id,
      verifierName: `AutoTest Counselor ${tag}`,
    });
    expect(reVerify.error).toBeNull();
    expect((reVerify.data as Json).ok).toBe(false);
    expect((reVerify.data as Json).reason).toBe("not_pending");

    const { data: after } = await admin
      .from("form_submissions")
      .select("status, resolution_note")
      .eq("id", submission.id)
      .single();
    expect((after as { status: string }).status).toBe("rejected");
    expect((after as { resolution_note: string }).resolution_note).toContain("AutoTest");
  });

  test("a duplicate rejection lands as `duplicate`, and is equally unimportable", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const anon = anonClient();
    const admin = await sharedAdmin();

    const submission = await submitAndFind(
      guardian,
      buildAnswers({
        guardianName: guardian,
        children: [{ first_name: autotestChildName(tag, "Dupe"), age: 6, grade: "1" }],
      })
    );

    const rejected = await rpcRejectSubmission(anon, {
      reviewToken: DEMO_REVIEW_TOKEN,
      submissionId: submission.id,
      reason: "AutoTest — they registered twice",
      asDuplicate: true,
    });
    expect(rejected.error).toBeNull();
    expect((rejected.data as Json).status).toBe("duplicate");

    const imported = await rpcImportSubmission(admin, submission.id);
    expect((imported.data as Json).ok).toBe(false);
    expect((imported.data as Json).reason).toBe("not_verified");
  });

  // --- AC4: idempotent import ---------------------------------------------
  test("import_submission called twice yields exactly one family", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const anon = anonClient();
    const admin = await sharedAdmin();

    const submission = await submitAndFind(
      guardian,
      buildAnswers({
        guardianName: guardian,
        children: [
          { first_name: autotestChildName(tag, "One"), age: 7, grade: "2" },
          { first_name: autotestChildName(tag, "Two"), age: 11, grade: "6" },
        ],
      })
    );

    const verified = await rpcVerifySubmission(anon, {
      reviewToken: DEMO_REVIEW_TOKEN,
      submissionId: submission.id,
      verifierName: `AutoTest Counselor ${tag}`,
    });
    expect((verified.data as Json).ok).toBe(true);

    const first = await rpcImportSubmission(admin, submission.id);
    expect(first.error).toBeNull();
    expect((first.data as Json).ok).toBe(true);
    expect((first.data as Json).already_imported).toBe(false);
    expect((first.data as Json).children_created).toBe(2);

    const second = await rpcImportSubmission(admin, submission.id);
    expect(second.error).toBeNull();
    expect((second.data as Json).ok, "a second import must be a success, not an error").toBe(true);
    expect((second.data as Json).already_imported).toBe(true);
    expect((second.data as Json).family_id).toBe((first.data as Json).family_id);
    expect((second.data as Json).children_created).toBe(0);

    const { data: families } = await admin
      .from("families")
      .select("id")
      .eq("source_submission_id", submission.id);
    expect(families, "two imports created two families").toHaveLength(1);

    const { count: childCount } = await admin
      .from("children")
      .select("id", { count: "exact", head: true })
      .eq("family_id", (first.data as Json).family_id as string);
    expect(childCount, "the second import duplicated the children").toBe(2);
  });

  test("two admins importing the same submission at the same moment yield one family", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const anon = anonClient();
    const admin = await sharedAdmin();
    // A genuinely independent second session — the point of this test is two
    // callers, not one client used twice.
    const admin2 = await signInAs("admin");

    const submission = await submitAndFind(
      guardian,
      buildAnswers({
        guardianName: guardian,
        children: [{ first_name: autotestChildName(tag, "Race"), age: 5, grade: "K" }],
      })
    );
    await rpcVerifySubmission(anon, {
      reviewToken: DEMO_REVIEW_TOKEN,
      submissionId: submission.id,
      verifierName: `AutoTest Counselor ${tag}`,
    });

    const [a, b] = await Promise.all([
      rpcImportSubmission(admin, submission.id),
      rpcImportSubmission(admin2, submission.id),
    ]);

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect((a.data as Json).ok).toBe(true);
    expect((b.data as Json).ok).toBe(true);
    expect((a.data as Json).family_id).toBe((b.data as Json).family_id);
    // Exactly one of them did the work.
    const createdFresh = [a, b].filter((r) => (r.data as Json).already_imported === false);
    expect(createdFresh, "both callers believed they created the family").toHaveLength(1);

    const { data: families } = await admin
      .from("families")
      .select("id")
      .eq("source_submission_id", submission.id);
    expect(families).toHaveLength(1);
  });

  // --- AC5: the payload-level privacy assertion ---------------------------
  //
  // Called out specifically in US-24 because the roster UI cannot prove this by
  // construction — it was never handed these fields, so a screen read shows
  // nothing whether or not the payload carries them. This submits a child with
  // a distinctive sentinel in EVERY field the counselor must not see, then
  // asserts none of them appears anywhere in the serialized response body of
  // get_review_roster.
  test("get_review_roster's response body contains no wishlist, sizes, needs, notes or guardian contact", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const admin = await sharedAdmin();
    const anon = anonClient();

    const sentinels = {
      guardianName: guardian,
      guardianPhone: `555SENTINELPHONE${tag}`,
      guardianEmail: `sentinelmail${tag}@autotest.example.com`,
      wishlist1: `SENTINELWISHONE${tag}`,
      wishlist2: `SENTINELWISHTWO${tag}`,
      shirt: `SENTINELSHIRT${tag}`,
      pant: `SENTINELPANT${tag}`,
      shoe: `SENTINELSHOE${tag}`,
      needs: `SENTINELNEEDS${tag}`,
      notes: `SENTINELNOTES${tag}`,
    };
    const childName = autotestChildName(tag, "Privacy");

    const submission = await submitAndFind(
      guardian,
      buildAnswers({
        guardianName: sentinels.guardianName,
        guardianPhone: sentinels.guardianPhone,
        guardianEmail: sentinels.guardianEmail,
        children: [
          {
            first_name: childName,
            age: 12,
            grade: "7",
            sex: "F",
            // The "Other (describe)" escape hatch is the only way to get a
            // free-text size into `answers`, and it is exactly the field H1
            // exploited — so it is the right thing to sentinel.
            shirt_size: "Other",
            shirt_size_other: sentinels.shirt,
            pant_size: "Other",
            pant_size_other: sentinels.pant,
            shoe_size: "Other",
            shoe_size_other: sentinels.shoe,
            wishlist: [sentinels.wishlist1, sentinels.wishlist2],
            specific_needs: sentinels.needs,
            other_notes: sentinels.notes,
          },
        ],
      })
    );

    // Sanity check: the sentinels really are stored, so a green assertion below
    // means "filtered out", not "never submitted".
    const { data: stored } = await admin
      .from("form_submissions")
      .select("answers, submitter_phone, submitter_email")
      .eq("id", submission.id)
      .single();
    const storedText = JSON.stringify(stored);
    for (const [name, value] of Object.entries(sentinels)) {
      expect(storedText, `${name} never reached form_submissions — the test proves nothing`).toContain(value);
    }

    // The literal HTTP response body an anonymous counselor receives.
    const body = await fetchReviewRosterBody(DEMO_REVIEW_TOKEN);
    expect(body, "the roster did not include this submission at all").toContain(childName);

    for (const [name, value] of Object.entries(sentinels)) {
      expect(body, `get_review_roster leaked ${name} into its response body`).not.toContain(value);
    }
    // Field names too — an empty-but-present key would still be a widened
    // contract, and would be the first sign of a passthrough replacing the
    // whitelist.
    for (const key of [
      "wishlist",
      "shirt_size",
      "pant_size",
      "shoe_size",
      "specific_needs",
      "other_notes",
      "submitter_name",
      "submitter_phone",
      "submitter_email",
      "guardian_name",
      "guardian_phone",
      "guardian_email",
    ]) {
      expect(body, `get_review_roster's payload carries a "${key}" key`).not.toContain(`"${key}"`);
    }

    // The same claim asserted structurally: exactly four keys per child.
    const roster = await rpcGetReviewRoster(anon, DEMO_REVIEW_TOKEN);
    expect(roster.error).toBeNull();
    const payload = roster.data as {
      ok: boolean;
      submissions: Array<{ id: string; children: Array<Record<string, unknown>> }>;
    };
    expect(payload.ok).toBe(true);
    expect(Object.keys(payload).sort()).toEqual([
      "correction_fields",
      "expires_at",
      "ok",
      "school_name",
      "submissions",
    ]);
    const mine = payload.submissions.find((s) => s.id === submission.id);
    expect(mine, "the sentinel submission is missing from the roster").toBeTruthy();
    for (const child of mine!.children) {
      expect(Object.keys(child).sort()).toEqual(["age", "first_name", "grade", "index"]);
    }
  });

  // --- the three correctable controls, and the 81-character regression -----
  test("correction_fields carries the definition's own rules for exactly the three correctable fields", async () => {
    const anon = anonClient();
    const tag = runTag();
    const guardian = autotestGuardian(tag);

    // correction_fields is resolved from the form versions the roster's
    // SUBMISSIONS are pinned to, merged strictest-wins — so on an empty roster
    // all three values are JSON null (verified against dev: the keys are
    // always present, the values are not). This test has to put something on
    // the roster first or it asserts against an empty definition set.
    await submitAndFind(
      guardian,
      buildAnswers({
        guardianName: guardian,
        children: [{ first_name: autotestChildName(tag, "Fields"), age: 9, grade: "4" }],
      })
    );

    const roster = await rpcGetReviewRoster(anon, DEMO_REVIEW_TOKEN);
    expect(roster.error).toBeNull();

    const fields = (roster.data as { correction_fields: Record<string, Json> }).correction_fields;
    // Always all three keys — VERIFY 26(d2) — and `grade_options` never among
    // them. It carried an overlapping slice of this same data and was removed;
    // if it reappears, two keys are drifting apart again.
    expect(Object.keys(fields).sort()).toEqual(["age", "first_name", "grade"]);
    expect(Object.keys(roster.data as Json)).not.toContain("grade_options");
    for (const key of ["age", "first_name", "grade"]) {
      expect(fields[key], `correction_fields.${key} is null with a submission on the roster`).not.toBeNull();
    }

    // 80, not 120. This exact disagreement between the page and
    // verify_submission is what silently threw away a counselor's approve click.
    expect(fields.first_name.max_length).toBe(80);
    expect(fields.first_name.type).toBe("text");
    expect(fields.first_name.required).toBe(true);

    expect(fields.age.type).toBe("number");
    expect(fields.age.min).toBe(0);
    expect(fields.age.max).toBe(19);

    expect(fields.grade.type).toBe("select");
    const options = (fields.grade.options as Array<{ value: string }>).map((o) => o.value);
    // Definition order, not "the grades that happen to be on the roster".
    expect(options.slice(0, 3)).toEqual(["Not in school yet", "Pre-K", "K"]);
    expect(options).toContain("12");
  });

  test("an 81-character corrected first name is refused and the approve click is not silently lost", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const anon = anonClient();
    const admin = await sharedAdmin();

    const submission = await submitAndFind(
      guardian,
      buildAnswers({
        guardianName: guardian,
        children: [{ first_name: autotestChildName(tag, "Long"), age: 9, grade: "4" }],
      })
    );

    const tooLong = "A".repeat(81);
    const refused = await rpcVerifySubmission(anon, {
      reviewToken: DEMO_REVIEW_TOKEN,
      submissionId: submission.id,
      verifierName: `AutoTest Counselor ${tag}`,
      corrections: { "1": { first_name: tooLong } },
    });

    // The server RAISES (it does not return ok:false) — so the caller sees a
    // Postgres error, and the wrapper in lib/intake.ts flattens it to
    // { ok: false, error }. Either way the approve did NOT happen.
    const raised = refused.error !== null;
    const refusedInBody = !raised && (refused.data as Json).ok === false;
    expect(raised || refusedInBody, "an 81-character first name was accepted").toBe(true);
    if (raised) {
      expect(refused.error!.message).toMatch(/80 characters/i);
    }

    const { data: after } = await admin
      .from("form_submissions")
      .select("status, corrections")
      .eq("id", submission.id)
      .single();
    expect((after as { status: string }).status, "the submission was verified anyway").toBe("submitted");
    expect((after as { corrections: Json }).corrections).toEqual({});

    // 80 exactly is accepted, so the bound is off-by-one correct.
    const okName = "B".repeat(80);
    const accepted = await rpcVerifySubmission(anon, {
      reviewToken: DEMO_REVIEW_TOKEN,
      submissionId: submission.id,
      verifierName: `AutoTest Counselor ${tag}`,
      corrections: { "1": { first_name: okName } },
    });
    expect(accepted.error).toBeNull();
    expect((accepted.data as Json).ok).toBe(true);
  });

  test("a correction outside first_name/age/grade raises rather than being silently dropped", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const anon = anonClient();
    const admin = await sharedAdmin();

    const submission = await submitAndFind(
      guardian,
      buildAnswers({
        guardianName: guardian,
        children: [{ first_name: autotestChildName(tag, "Scope"), age: 9, grade: "4" }],
      })
    );

    // Deliberately a RAW rpc: the typed wrapper in lib/intake.ts cannot express
    // this, which is the point — the database has to refuse it anyway, in case
    // a future client can.
    const result = await rpcVerifySubmission(anon, {
      reviewToken: DEMO_REVIEW_TOKEN,
      submissionId: submission.id,
      verifierName: `AutoTest Counselor ${tag}`,
      corrections: { "1": { first_name: "Fine", shirt_size: "Adult XXL" } },
    });

    expect(result.error, "an out-of-scope correction key was accepted").not.toBeNull();
    expect(result.error!.message).toMatch(/only correct first_name, age, or grade/i);

    const { data: after } = await admin
      .from("form_submissions")
      .select("status, corrections")
      .eq("id", submission.id)
      .single();
    expect((after as { status: string }).status).toBe("submitted");
    expect((after as { corrections: Json }).corrections).toEqual({});
  });

  // --- boundary and malformed input on the family form --------------------
  test("server-side validation refuses empty, out-of-range and unlisted answers", async () => {
    const anon = anonClient();
    const tag = runTag();

    // Empty everything.
    const empty = await rpcSubmitForm(anon, { token: DEMO_FORM_TOKEN, answers: {} });
    expect(empty.error).toBeNull();
    expect((empty.data as Json).ok).toBe(false);
    const emptyFields = ((empty.data as { errors: Array<{ field: string }> }).errors ?? []).map(
      (e) => e.field
    );
    expect(emptyFields).toContain("family.guardian_name");
    expect(emptyFields).toContain("family.guardian_phone");
    expect(emptyFields).toContain("children");
    expect(emptyFields).toContain("pickup_consent.consent");

    // Age 20 (the definition's max is 19), an unlisted grade, and no wishlist.
    const bad = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: autotestGuardian(tag),
        children: [
          {
            first_name: autotestChildName(tag, "Bad"),
            age: 20,
            grade: "13th grade",
            wishlist: [""],
          },
        ],
      }),
    });
    expect(bad.error).toBeNull();
    expect((bad.data as Json).ok).toBe(false);
    const badFields = ((bad.data as { errors: Array<{ field: string }> }).errors ?? []).map(
      (e) => e.field
    );
    expect(badFields).toContain("children[0].age");
    expect(badFields).toContain("children[0].grade");
    expect(badFields).toContain("children[0].wishlist[0]");

    // H1: a leftover "Other" description beside a normal size is rejected. This
    // was an untruncated free-text path onto children.shirt_size, which
    // public_available_cards republishes to anon.
    const h1 = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: autotestGuardian(tag),
        children: [
          {
            first_name: autotestChildName(tag, "H1"),
            age: 9,
            grade: "4",
            shirt_size: "Youth M",
            shirt_size_other: "x".repeat(500),
          },
        ],
      }),
    });
    expect((h1.data as Json).ok, "H1: a stale _other value beside a normal size was accepted").toBe(
      false
    );
    expect(
      ((h1.data as { errors: Array<{ field: string }> }).errors ?? []).map((e) => e.field)
    ).toContain("children[0].shirt_size_other");

    // None of the three wrote anything.
    const admin = await sharedAdmin();
    const { count } = await admin
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("submitter_name", autotestGuardian(tag));
    expect(count ?? 0, "a rejected submission still wrote a row").toBe(0);
  });

  test("get_form refuses an unknown token the same way it refuses a revoked one", async () => {
    const anon = anonClient();
    const unknown = await anon.rpc("get_form", { p_token: "autotest-no-such-form-token" });
    expect(unknown.error).toBeNull();
    expect((unknown.data as Json).ok).toBe(false);
    // There is deliberately no "revoked" reason — see FormLinkProblem in
    // web/lib/intake.ts. If this ever comes back "revoked", the TS union and the
    // database have drifted apart.
    expect((unknown.data as Json).reason).toBe("not_found");
  });

  test("get_form returns only the definition, the school name and the locale", async () => {
    const anon = anonClient();
    const result = await anon.rpc("get_form", { p_token: DEMO_FORM_TOKEN });
    expect(result.error).toBeNull();
    expect(Object.keys(result.data as Json).sort()).toEqual([
      "definition",
      "locale",
      "ok",
      "school_name",
    ]);
    expect((result.data as Json).school_name).toBe("Demo Elementary North");

    // No counselor contact anywhere in the blank questionnaire either.
    const body = JSON.stringify(result.data);
    expect(body).not.toContain("@demo.example.com");
    expect(body).not.toContain("liaison");
  });
});
