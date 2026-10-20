import { test, expect } from "@playwright/test";
import { anonClient } from "./helpers/testClient";
import {
  AUTOTEST_REVIEW_EMAIL,
  DEMO_FORM_TOKEN,
  DEMO_REVIEW_TOKEN,
  autotestChildName,
  autotestGuardian,
  buildAnswers,
  cleanupIntakeTestData,
  demoFormVersionId,
  findSubmissionByGuardian,
  rpcImportSubmission,
  rpcSubmitForm,
  rpcVerifySubmission,
  runTag,
  sharedAdmin,
  sharedVolunteer,
  assertIntakeReady,
} from "./helpers/intake";

// reach-reviewer's runtime-only checks for the intake migration. Every one of
// these can only be answered by EXECUTION — reading the SQL cannot settle any
// of them, which is the whole reason this file exists.
//
//   1. schema-qualified pgcrypto        -> intake-preflight.spec.ts
//   2. `select * into v_family from create_family(...)` composite binding
//   3. M3 — one malformed review_tokens.token_hash breaks EVERY school
//   4. M1 — non-concurrent double import after a hand-reset status
//   5. VERIFY 13 / 21 from a real volunteer session -> intake-confidential.spec.ts

type Json = Record<string, unknown>;

/** Submits, gets the counselor to approve it, and hands back the verified row. */
async function submitAndVerify(tag: string, childSuffix: string) {
  const anon = anonClient();
  const admin = await sharedAdmin();
  const guardian = autotestGuardian(tag);

  const submitted = await rpcSubmitForm(anon, {
    token: DEMO_FORM_TOKEN,
    answers: buildAnswers({
      guardianName: guardian,
      children: [{ first_name: autotestChildName(tag, childSuffix), age: 9, grade: "4" }],
    }),
  });
  expect(submitted.error).toBeNull();
  expect((submitted.data as Json).ok, JSON.stringify(submitted.data)).toBe(true);

  const row = await findSubmissionByGuardian(admin, guardian);
  expect(row).not.toBeNull();

  const verified = await rpcVerifySubmission(anon, {
    reviewToken: DEMO_REVIEW_TOKEN,
    submissionId: row!.id,
    verifierName: `AutoTest Counselor ${tag}`,
  });
  expect(verified.error).toBeNull();
  expect((verified.data as Json).ok).toBe(true);
  return row!;
}

test.describe("intake runtime-only checks", () => {
  test.beforeAll(async () => {
    await assertIntakeReady();
  });

  test.afterAll(async () => {
    const admin = await sharedAdmin();
    await cleanupIntakeTestData(admin);
  });

  // --- runtime check 2 ------------------------------------------------------
  test("create_family()'s composite return binds correctly on a real import", async () => {
    const tag = runTag();
    const admin = await sharedAdmin();
    const submission = await submitAndVerify(tag, "Composite");

    const imported = await rpcImportSubmission(admin, submission.id);
    expect(imported.error, `import_submission raised: ${imported.error?.message}`).toBeNull();
    expect((imported.data as Json).ok, JSON.stringify(imported.data)).toBe(true);

    const familyId = (imported.data as Json).family_id as string;
    const familyNumber = (imported.data as Json).family_number;

    // `select * into v_family from create_family(...)` assigns a composite
    // return into a families%rowtype in the same migration that adds NINE new
    // columns to `families`. A mis-bind would show up here as a null/garbage
    // family_number, a family_id that doesn't resolve, or a row whose scoping
    // columns don't match the submission it came from.
    expect(typeof familyNumber, "family_number did not bind to an integer column").toBe("number");
    expect(familyNumber as number).toBeGreaterThan(0);

    const { data: family, error } = await admin
      .from("families")
      .select("id, family_number, drive_id, drive_school_id, is_confidential, is_test_data, is_autotest_data, source_submission_id, guardian_name, created_by")
      .eq("id", familyId)
      .single();
    expect(error, "import_submission returned a family_id that resolves to nothing").toBeNull();

    const row = family as Record<string, unknown>;
    expect(row.family_number).toBe(familyNumber);
    expect(row.source_submission_id).toBe(submission.id);
    expect(row.drive_school_id).toBe(submission.drive_school_id);
    expect(row.is_confidential).toBe(false);
    // The link is is_test_data, so the imported family inherits the BROAD flag
    // and deliberately not the narrow autotest one — see the note in
    // helpers/intake.ts about why this suite cleans up by source_submission_id.
    expect(row.is_test_data).toBe(true);
    expect(row.is_autotest_data).toBe(false);
    // create_family() is security invoker, so auth.uid() still resolves to the
    // real admin even though import_submission is security definer.
    expect(row.created_by, "families.created_by was not stamped with the importing admin").not.toBeNull();

    // Family numbering is unique within its scope — the advisory-lock path was
    // reused, not re-implemented.
    const { data: sameScope } = await admin
      .from("families")
      .select("id")
      .eq("drive_id", row.drive_id as string)
      .eq("drive_school_id", row.drive_school_id as string)
      .eq("family_number", familyNumber as number)
      .eq("is_confidential", false);
    expect(sameScope, "two families share a family_number in the same scope").toHaveLength(1);
  });

  // --- runtime check 4 ------------------------------------------------------
  test("M1: importing again after a hand-reset status returns already_imported and adds no family", async () => {
    const tag = runTag();
    const admin = await sharedAdmin();
    const submission = await submitAndVerify(tag, "Handreset");

    const first = await rpcImportSubmission(admin, submission.id);
    expect((first.data as Json).ok).toBe(true);
    expect((first.data as Json).already_imported).toBe(false);
    const familyId = (first.data as Json).family_id as string;

    const { count: before } = await admin
      .from("families")
      .select("id", { count: "exact", head: true });

    // Exactly what an admin can do by hand in the SQL editor, and what the two
    // status-based idempotency checks rest on. Only the
    // families_one_per_submission unique index survives this.
    const { error: resetError } = await admin
      .from("form_submissions")
      .update({ status: "verified" })
      .eq("id", submission.id);
    expect(resetError).toBeNull();

    const second = await rpcImportSubmission(admin, submission.id);
    expect(second.error, `the second import raised: ${second.error?.message}`).toBeNull();
    expect((second.data as Json).ok, JSON.stringify(second.data)).toBe(true);
    expect(
      (second.data as Json).already_imported,
      "a hand-reset status let import_submission create a second family"
    ).toBe(true);
    expect((second.data as Json).family_id).toBe(familyId);
    expect((second.data as Json).children_created).toBe(0);

    const { count: after } = await admin
      .from("families")
      .select("id", { count: "exact", head: true });
    expect(after, "the families table grew on a repeat import").toBe(before);

    const { data: mine } = await admin
      .from("families")
      .select("id")
      .eq("source_submission_id", submission.id);
    expect(mine).toHaveLength(1);

    // And no orphan: the losing path must roll back create_family()'s insert,
    // not leave a numbered, childless family behind.
    const { data: childless } = await admin
      .from("families")
      .select("id, internal_notes")
      .is("source_submission_id", null)
      .like("internal_notes", "Imported from the family intake form%");
    expect(childless ?? [], "an orphan numbered family was left behind by the rolled-back import").toHaveLength(0);
  });

  // --- runtime check 3 ------------------------------------------------------
  //
  // M3's claim is that ONE malformed review_tokens.token_hash breaks the
  // counselor path for EVERY school, not just the school that owns the bad row.
  // That half of the claim is settled by reading the migration and needs no
  // probe: all three token-bearing functions (get_review_roster,
  // verify_submission, reject_submission) locate a token with
  //
  //   where rt.revoked_at is null and rt.expires_at > now()
  //     and rt.token_hash = extensions.crypt(<candidate>, rt.token_hash)
  //
  // and NOTHING in that predicate is scoped to a school. Every live row is a
  // crypt() call, so a raise on any one row aborts the scan for every
  // counselor at every school. The blast radius is global by construction.
  //
  // WHAT IS NOT SETTLED, and why this suite does not settle it:
  // `review_tokens_hash_is_bcrypt` is `token_hash ~ '^\$2[abxy]?\$[0-9]{2}\$'`
  // — a PREFIX check. A row can satisfy it and still be unparseable by bcrypt:
  // `$2a$99$…` (cost 99 is outside bcrypt's 04..31 range), or a valid prefix
  // followed by a short/garbage body. Whether extensions.crypt RAISES or merely
  // returns a non-matching value on such input decides whether the constraint
  // actually closes M3, and that can only be answered by executing it.
  //
  // It CANNOT be answered from this suite, and the reason is itself a security
  // property worth asserting — see the next test. `authenticated` has INSERT
  // and UPDATE on review_tokens but no SELECT and no DELETE (§9: the table is
  // write-only by design). So a probe row could be inserted and then never
  // removed, and never even repaired: an UPDATE needs SELECT privilege on the
  // column in its WHERE clause, and the only WHERE-less UPDATE would rewrite
  // the demo counselor's own token. Running the probe here would mean
  // inserting, into the shared dev project eight days before the walkthrough, a
  // row that might break every counselor link and that this suite has no way to
  // take back. That is not a test, it is a gamble with the demo.
  //
  // It belongs in the SQL editor, as the owner, inside a transaction that can
  // actually roll back:
  //
  //   begin;
  //     insert into review_tokens (drive_id, drive_school_id, token_hash,
  //                                issued_to_email, expires_at)
  //     values ((select id from drives where status = 'open' order by year desc limit 1),
  //             (select drive_school_id from form_links
  //               where token = 'demo-north-family-2026'),
  //             '$2a$99$' || rpad('VerifyProbeSalt', 22, 'z'),
  //             'verify@demo.example.com', now() + interval '5 minutes');
  //     select public.get_review_roster('demo-north-review-2026') -> 'ok';
  //   rollback;   -- <- the only reliable cleanup, and it is owner-only
  //
  // If that SELECT raises instead of returning true, the constraint does not
  // close M3 and needs to become a full-format check
  // (^\$2[abxy]?\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$) rather than a
  // prefix one. Reported as a finding either way.
  test("M3(a): review_tokens refuses every malformed token_hash the constraint is meant to stop", async () => {
    const admin = await sharedAdmin();
    const { driveId, driveSchoolId } = await demoFormVersionId(admin);

    const badRow = (token_hash: string) => ({
      drive_id: driveId,
      drive_school_id: driveSchoolId,
      token_hash,
      issued_to_email: AUTOTEST_REVIEW_EMAIL,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      is_test_data: true,
    });

    // VERIFY check 22 — the plaintext token the constraint exists to stop. The
    // ERROR is the pass, and a rejected insert writes nothing, so this leaves
    // no row behind to clean up.
    const plaintext = await admin.from("review_tokens").insert(badRow("plaintext-not-a-hash"));
    expect(plaintext.error, "a plaintext token_hash was accepted into review_tokens").not.toBeNull();
    expect(plaintext.error!.message).toMatch(/review_tokens_hash_is_bcrypt|check constraint/i);

    // ...and every other realistic way a hand-issued token gets mangled: an
    // empty value, a bare prefix, an unknown algorithm letter, a one-digit
    // cost, and a paste that lost its leading $.
    for (const bad of ["", "$2a$", "$2z$10$abcdefghijklmnopqrstuv", "$2b$1$short", "2a$10$nodollar"]) {
      const attempt = await admin.from("review_tokens").insert(badRow(bad));
      expect(
        attempt.error,
        `review_tokens accepted the malformed hash ${JSON.stringify(bad)}`
      ).not.toBeNull();
      expect(attempt.error!.message).toMatch(/review_tokens_hash_is_bcrypt|check constraint/i);
    }
  });

  // The §9 property behind M3(b), asserted rather than assumed. Updated
  // 2026-10-20: US-28 (20260903120000) deliberately gave ADMINS a SELECT policy
  // so staff can re-copy a counselor's review link, so "no SELECT for anyone"
  // stopped being the rule on 2026-09-03. What still must hold: a volunteer
  // reads nothing, and nobody can DELETE.
  test("M3(b) precondition: review_tokens is admin-read-only for authenticated, never deletable", async () => {
    const admin = await sharedAdmin();
    const volunteer = await sharedVolunteer();

    const adminRead = await admin.from("review_tokens").select("id").limit(1);
    expect(adminRead.error, "an admin can no longer read review links (US-28 regression)").toBeNull();

    const volunteerRead = await volunteer.from("review_tokens").select("id").limit(1);
    expect(volunteerRead.error).toBeNull();
    expect(volunteerRead.data, "a volunteer can read review_tokens rows").toEqual([]);

    // No DELETE grant at all: denied even for an admin.
    const del = await admin.from("review_tokens").delete().eq("issued_to_email", AUTOTEST_REVIEW_EMAIL);
    expect(del.error, "authenticated can DELETE from review_tokens").not.toBeNull();

    // Therefore: nothing this suite inserts into review_tokens can ever be
    // removed by it. Any future test that inserts here is a permanent write to
    // the shared dev project.
  });

  test("import_submission is admin-only and anon cannot call it at all", async () => {
    const anon = anonClient();
    const result = await rpcImportSubmission(anon, "00000000-0000-0000-0000-000000000000");
    // No grant to anon: this must be a permission error from PostgREST, not a
    // polite ok:false, and certainly not a family.
    expect(result.error, "anon can call import_submission").not.toBeNull();
    expect(result.data).toBeNull();
  });

  test("a published form version cannot be edited, even by an admin", async () => {
    const admin = await sharedAdmin();
    const { versionId } = await demoFormVersionId(admin);

    const { error } = await admin
      .from("form_versions")
      .update({ definition: { tampered: true } })
      .eq("id", versionId);

    expect(error, "a published form_versions.definition was editable").not.toBeNull();
    expect(error!.message).toMatch(/immutable once published/i);

    // ...and it really is unchanged.
    const { data } = await admin
      .from("form_versions")
      .select("definition")
      .eq("id", versionId)
      .single();
    const definition = (data as { definition: Record<string, unknown> }).definition;
    expect(definition.tampered).toBeUndefined();
    expect(Array.isArray(definition.sections)).toBe(true);
  });

  test("nothing imported from a submission exceeds the H1 truncation caps", async () => {
    const admin = await sharedAdmin();
    // VERIFY check 16, as an assertion. Every one of these columns is
    // republished to anon through public_available_cards or printed on a card.
    const { data, error } = await admin
      .from("children")
      .select("id, first_name, grade, sex, shirt_size, pant_size, shoe_size, specific_needs, other_notes")
      .not("source_submission_id", "is", null);
    expect(error).toBeNull();

    const caps: Record<string, number> = {
      first_name: 100,
      grade: 40,
      sex: 40,
      shirt_size: 80,
      pant_size: 80,
      shoe_size: 80,
      specific_needs: 500,
      other_notes: 500,
    };
    for (const child of (data ?? []) as Array<Record<string, string | null>>) {
      for (const [column, cap] of Object.entries(caps)) {
        const value = child[column];
        if (typeof value === "string") {
          expect(value.length, `children.${column} exceeded its import cap on ${child.id}`).toBeLessThanOrEqual(cap);
        }
      }
    }
  });
});
