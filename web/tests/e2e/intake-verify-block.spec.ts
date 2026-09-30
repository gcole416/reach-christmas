import { test, expect } from "@playwright/test";
import { anonClient } from "./helpers/testClient";
import {
  AUTOTEST_LINK_PREFIX,
  DEMO_FORM_TOKEN,
  DEMO_REVIEW_TOKEN,
  assertIntakeReady,
  autotestChildName,
  autotestGuardian,
  buildAnswers,
  cleanupIntakeTestData,
  demoFormVersionId,
  rpcGetReviewRoster,
  rpcSubmitForm,
  runTag,
  sharedAdmin,
} from "./helpers/intake";

// The VERIFY block at the foot of
// supabase/migrations/20260830120000_intake_forms.sql, for the checks that can
// be driven from a client rather than pasted into the SQL editor.
//
// WHY THESE ARE HERE AND NOT IN THE EDITOR: several of them prove nothing when
// run as `postgres`. The SQL editor is the table owner and bypasses RLS
// entirely, so "check 13 returned zero rows" in the editor means only that
// there were no rows — not that a volunteer is blocked. Anything that depends
// on a role runs over the anon key here instead, as a real session.
//
// WHAT IS DELIBERATELY NOT HERE: checks 1-4, 6, 7, 17, 21(first half), 23 and
// 24 read pg_catalog / information_schema, and 26(a)-(c) call
// intake_repeating_field_def and friends, whose EXECUTE is revoked from anon
// AND authenticated (owner only — asserted below). None of them is reachable
// over PostgREST with the anon key, and reaching them would need the service
// key, which is permanently off-limits on this project. They stay Grant's
// paste-into-the-editor step. Where a client-visible equivalent exists, it is
// asserted here instead and says so.
//
// Coverage map, migration check number -> where:
//   5  (partially)  this file, as a callability matrix
//   8  ...........  intake-confidential.spec.ts
//   9  ...........  intake-runtime-checks.spec.ts
//   10 ...........  intake-functions.spec.ts
//   11 ...........  intake-functions.spec.ts
//   12 ...........  intake-runtime-checks.spec.ts
//   13 ...........  intake-confidential.spec.ts   (volunteer session)
//   14 ...........  this file
//   15 ...........  this file
//   16 ...........  intake-runtime-checks.spec.ts
//   18 ...........  intake-runtime-checks.spec.ts
//   19 ...........  intake-confidential.spec.ts
//   20 ...........  this file
//   21 (2nd half)   intake-confidential.spec.ts   (volunteer session)
//   22 ...........  intake-runtime-checks.spec.ts
//   25 ...........  intake-preflight.spec.ts
//   26 (d)(d2)(e)   intake-functions.spec.ts
//   26 (f) ........  this file

type Json = Record<string, unknown>;

test.describe("VERIFY block, client-drivable checks", () => {
  test.beforeAll(async () => {
    await assertIntakeReady();
  });

  test.afterAll(async () => {
    const admin = await sharedAdmin();
    await cleanupIntakeTestData(admin);
  });

  // --- check 5, behaviourally ------------------------------------------------
  //
  // proacl can't be read without catalog access, but what proacl is FOR can be:
  // who can call what. A grant that drifted would show up here as a call that
  // succeeds where it should be denied.
  test("5: the callable surface is exactly the six functions, and the helpers are owner-only", async () => {
    const anon = anonClient();

    // The five anon-callable ones reach their own logic (a refusal is a pass —
    // what matters is that it is NOT "permission denied for function").
    const reachable = [
      anon.rpc("get_form", { p_token: "autotest-nope" }),
      anon.rpc("submit_form", { p_token: "autotest-nope", p_answers: {}, p_contact: null, p_honeypot: null }),
      anon.rpc("get_review_roster", { p_review_token: "autotest-nope" }),
      anon.rpc("verify_submission", {
        p_review_token: "autotest-nope",
        p_submission_id: "00000000-0000-0000-0000-000000000000",
        p_verifier_name: "AutoTest",
        p_corrections: null,
      }),
      anon.rpc("reject_submission", {
        p_review_token: "autotest-nope",
        p_submission_id: "00000000-0000-0000-0000-000000000000",
        p_reason: "AutoTest",
        p_as_duplicate: false,
      }),
    ];
    for (const call of reachable) {
      const { error } = await call;
      expect(error?.code, `an anon-granted function is not callable by anon: ${error?.message}`).not.toBe("42501");
    }

    // import_submission: authenticated only, never anon (check 9).
    const imported = await anon.rpc("import_submission", {
      p_submission_id: "00000000-0000-0000-0000-000000000000",
      p_is_confidential: null,
    });
    expect(imported.error?.code, "anon can call import_submission").toBe("42501");

    // The internals stay internal — none of these is granted to anon or
    // authenticated, so a UI could never build its own view of the definition
    // by calling them directly.
    const admin = await sharedAdmin();
    for (const fn of [
      "intake_repeating_section_id",
      "intake_correctable_field_ids",
      "intake_repeating_field_options",
      "intake_repeating_field_def",
      "intake_apply_corrections",
      "intake_validate_field",
    ]) {
      const asAnon = await anon.rpc(fn, {});
      const asAuthed = await admin.rpc(fn, {});
      // PGRST202 (not exposed in the schema cache) or 42501 (revoked) both mean
      // "not callable from a client"; 42883 would mean it isn't there at all.
      for (const [who, result] of [["anon", asAnon], ["authenticated", asAuthed]] as const) {
        expect(
          ["42501", "PGRST202"],
          `${fn} is callable by ${who} — its EXECUTE grant drifted (got ${result.error?.code} ${result.error?.message})`
        ).toContain(result.error?.code);
      }
    }
  });

  // --- check 14 --------------------------------------------------------------
  //
  // H1, the bug that reached the public sponsor page: an "Other (describe)"
  // free-text box sitting next to a NORMAL select value validated clean, and
  // import_submission wrote it to children.shirt_size untruncated — which
  // public_available_cards republishes to anon and the printed card prints.
  test("14: an Other-description beside a normal size is rejected, both ways round", async () => {
    const anon = anonClient();
    const tag = runTag();
    const admin = await sharedAdmin();

    // (a) shirt_size is a normal value, shirt_size_other is a 5000-char string.
    const withSelect = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: autotestGuardian(`${tag}a`),
        children: [
          {
            first_name: autotestChildName(tag, "H1a"),
            age: 8,
            grade: "3",
            shirt_size: "Youth M",
            shirt_size_other: "x".repeat(5000),
          },
        ],
      }),
    });
    expect(withSelect.error).toBeNull();
    expect((withSelect.data as Json).ok, "H1(a): a stale _other beside a normal size was accepted").toBe(false);
    expect(
      ((withSelect.data as { errors: Array<{ field: string }> }).errors ?? []).map((e) => e.field)
    ).toContain("children[0].shirt_size_other");

    // (b) shirt_size omitted ENTIRELY — the pre-fix code returned before it
    // ever looked at shirt_size_other, so this is the shape that got through.
    const noSelect = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: {
        family: {
          guardian_name: autotestGuardian(`${tag}b`),
          guardian_phone: "555-0100",
          preferred_language: "en",
        },
        children: [
          {
            first_name: autotestChildName(tag, "H1b"),
            age: 8,
            grade: "3",
            sex: "M",
            shirt_size_other: "x".repeat(5000),
            pant_size: "Youth 10",
            shoe_size: "Youth 3",
            wishlist: ["a bike"],
          },
        ],
        pickup_consent: { consent: true },
      },
    });
    expect(noSelect.error).toBeNull();
    expect((noSelect.data as Json).ok, "H1(b): _other with the select omitted was accepted").toBe(false);
    expect(
      ((noSelect.data as { errors: Array<{ field: string }> }).errors ?? []).map((e) => e.field)
    ).toContain("children[0].shirt_size_other");

    // (c) The control case: "Other" WITH a short description still validates.
    // Without this, a validator that rejected everything would pass (a) and (b).
    const okGuardian = autotestGuardian(`${tag}c`);
    const control = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: okGuardian,
        children: [
          {
            first_name: autotestChildName(tag, "H1c"),
            age: 8,
            grade: "3",
            shirt_size: "Other",
            shirt_size_other: "runs small",
          },
        ],
      }),
    });
    expect(control.error).toBeNull();
    expect(
      (control.data as Json).ok,
      `the legitimate Other case was refused: ${JSON.stringify(control.data)}`
    ).toBe(true);
    expect((control.data as Json).status).toBe("submitted");

    // Neither rejection wrote a row; the accepted one did.
    const { data: rows } = await admin
      .from("form_submissions")
      .select("submitter_name")
      .like("submitter_name", `%${tag}%`);
    expect((rows ?? []).map((r) => (r as { submitter_name: string }).submitter_name)).toEqual([
      okGuardian,
    ]);
  });

  // --- check 15 --------------------------------------------------------------
  test("15: a non-string wishlist entry is rejected, not silently skipped", async () => {
    const anon = anonClient();
    const tag = runTag();

    const result = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: {
        family: {
          guardian_name: autotestGuardian(tag),
          guardian_phone: "555-0100",
          preferred_language: "en",
        },
        children: [
          {
            first_name: autotestChildName(tag, "Json"),
            age: 8,
            grade: "3",
            sex: "M",
            shirt_size: "Youth M",
            pant_size: "Youth 10",
            shoe_size: "Youth 3",
            // A raw object where a string belongs. Pre-fix this skipped
            // validation and landed as JSON text in wishlist_items.description,
            // which is sponsor-visible.
            wishlist: ["a bike", { junk: "y".repeat(3000) }],
          },
        ],
        pickup_consent: { consent: true },
      },
    });

    expect(result.error).toBeNull();
    expect((result.data as Json).ok, "a non-string wishlist entry was accepted").toBe(false);
    expect(
      ((result.data as { errors: Array<{ field: string }> }).errors ?? []).map((e) => e.field)
    ).toContain("children[0].wishlist[1]");
  });

  // --- check 20 --------------------------------------------------------------
  //
  // Run against a link this test creates and revokes. The demo link is NOT
  // borrowed: revoking it, even inside a rollback that doesn't exist over
  // PostgREST, is exactly how the 9/9 walkthrough gets broken.
  test("20: a revoked link is indistinguishable from an unknown one", async () => {
    const admin = await sharedAdmin();
    const anon = anonClient();
    const tag = runTag();
    const { versionId, driveId, driveSchoolId } = await demoFormVersionId(admin);
    const token = `${AUTOTEST_LINK_PREFIX}revoke-${tag}`;

    const { error: insertError } = await admin.from("form_links").insert({
      drive_id: driveId,
      drive_school_id: driveSchoolId,
      form_version_id: versionId,
      token,
      label: "AutoTest revocation probe",
      locale: "en",
      channel: "family",
      is_test_data: true,
    });
    expect(insertError, `could not create the probe link: ${insertError?.message}`).toBeNull();

    // Live first, so the revocation below is the thing that changed.
    const live = await anon.rpc("get_form", { p_token: token });
    expect((live.data as Json).ok, "the probe link didn't resolve before revocation").toBe(true);

    const { error: revokeError } = await admin
      .from("form_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token", token);
    expect(revokeError).toBeNull();

    const revoked = await anon.rpc("get_form", { p_token: token });
    const unknown = await anon.rpc("get_form", { p_token: "autotest-no-such-token-at-all" });

    expect((revoked.data as Json).ok).toBe(false);
    expect((unknown.data as Json).ok).toBe(false);
    // No "revoked" reason exists — a revoked link reports not_found, matching
    // submit_form. If this changes, FormLinkProblem in web/lib/intake.ts no
    // longer covers what the database returns.
    expect((revoked.data as Json).reason, "get_form distinguishes revoked from unknown again").toBe(
      "not_found"
    );
    expect((unknown.data as Json).reason).toBe("not_found");
    expect((revoked.data as Json).error).toBe((unknown.data as Json).error);

    // ...and submit_form agrees, so the two doors give the same answer.
    const submitted = await rpcSubmitForm(anon, {
      token,
      answers: buildAnswers({
        guardianName: autotestGuardian(tag),
        children: [{ first_name: autotestChildName(tag, "Revoked"), age: 8, grade: "3" }],
      }),
    });
    expect((submitted.data as Json).ok, "a revoked link still accepted a submission").toBe(false);

    await admin.from("form_links").delete().eq("token", token);
  });

  // --- check 26(f) -----------------------------------------------------------
  //
  // correction_fields is built from form_versions.definition only, so no
  // child's submitted name may appear in it. Reading the names to look for them
  // needs the admin session; anon has no grant on form_submissions at all
  // (check 8), which is why the migration says to run this one as the owner.
  test("26(f): no submitted child name appears anywhere in correction_fields", async () => {
    const admin = await sharedAdmin();
    const anon = anonClient();
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const childName = autotestChildName(tag, "Blob");

    const submitted = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: guardian,
        children: [{ first_name: childName, age: 8, grade: "3" }],
      }),
    });
    expect((submitted.data as Json).ok, JSON.stringify(submitted.data)).toBe(true);

    const roster = await rpcGetReviewRoster(anon, DEMO_REVIEW_TOKEN);
    expect(roster.error).toBeNull();
    const fieldsText = JSON.stringify((roster.data as Json).correction_fields);

    // Our own child, first — this is the one we know is on the roster.
    expect(fieldsText, "the submitted child's name leaked into correction_fields").not.toContain(
      childName
    );

    // ...then every other name on the roster's school, from the base table.
    const { data: subs } = await admin
      .from("form_submissions")
      .select("id, answers")
      .not("answers", "is", null);
    const names = new Set<string>();
    for (const row of (subs ?? []) as Array<{ answers: { children?: unknown } }>) {
      const children = Array.isArray(row.answers?.children) ? row.answers.children : [];
      for (const child of children as Array<Record<string, unknown>>) {
        const name = typeof child.first_name === "string" ? child.first_name.trim() : "";
        if (name.length >= 3) names.add(name);
      }
    }
    for (const name of names) {
      expect(fieldsText, `a submitted child name ("${name}") appears in correction_fields`).not.toContain(
        name
      );
    }
  });
});
