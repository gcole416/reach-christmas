import { test, expect } from "@playwright/test";
import { anonClient, loginAsInBrowser } from "./helpers/testClient";
import {
  sharedAdmin,
  DEMO_FORM_TOKEN,
  DEMO_REVIEW_TOKEN,
  autotestChildName,
  autotestGuardian,
  buildAnswers,
  cleanupIntakeTestData,
  findSubmissionByGuardian,
  rpcImportSubmission,
  rpcSubmitForm,
  rpcVerifySubmission,
  runTag,
  assertIntakeReady,
} from "./helpers/intake";

// Cross-school household hint (decided 2026-09-08, Grant). A household with
// kids at more than one school registers once per school and imports as one
// record per school -- the split is by design (DESIGN.md §8). The staff queue
// flags the connection so nobody's surprised at distribution. Matched on
// guardian phone. This test uses the single demo school (the match is
// phone-based, not school-based) to prove the hint renders.

type Json = Record<string, unknown>;

test.describe("cross-school household hint", () => {
  test.beforeAll(async () => {
    await assertIntakeReady();
  });

  test.afterAll(async () => {
    const admin = await sharedAdmin();
    await cleanupIntakeTestData(admin);
  });

  test("an imported household surfaces as a 'possibly the same household' hint on another registration with the same phone", async ({
    page,
  }) => {
    const tag = runTag();
    // 13 digits, unique per run, and never the buildAnswers default (555-0100).
    const phone = `5559${String(Date.now()).slice(-9)}`;
    const guardianA = autotestGuardian(`${tag}A`);
    const guardianB = autotestGuardian(`${tag}B`);
    const anon = anonClient();
    const admin = await sharedAdmin();

    // Household A: submit -> verify -> import.
    const subA = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: guardianA,
        guardianPhone: phone,
        children: [{ first_name: autotestChildName(tag, "A"), age: 7, grade: "2" }],
      }),
    });
    expect((subA.data as Json).ok).toBe(true);
    const rowA = await findSubmissionByGuardian(admin, guardianA);
    await rpcVerifySubmission(anon, {
      reviewToken: DEMO_REVIEW_TOKEN,
      submissionId: rowA!.id,
      verifierName: `AutoTest Counselor ${tag}`,
    });
    const importA = await rpcImportSubmission(admin, rowA!.id);
    expect((importA.data as Json).ok).toBe(true);

    // Household B: same phone, different guardian name, left in the queue.
    const subB = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: buildAnswers({
        guardianName: guardianB,
        guardianPhone: phone,
        children: [{ first_name: autotestChildName(tag, "B"), age: 15, grade: "10" }],
      }),
    });
    expect((subB.data as Json).ok).toBe(true);
    const rowB = await findSubmissionByGuardian(admin, guardianB);

    const importedFamilyId = (importA.data as Json).family_id as string;
    const { data: fam } = await admin
      .from("families")
      .select("family_number, drive_school_id")
      .eq("id", importedFamilyId)
      .single();
    // Household tag = school code + family_number; the demo school's code is 'N'.
    const tagLabel = `Household N${(fam as Json).family_number}`;

    await loginAsInBrowser(page, "admin");

    // The queue shows the hint (on both rows, since it's bidirectional).
    await page.goto("/admin/submissions");
    await expect(page.getByText(/possibly the same household/i).first()).toBeVisible();

    // B's detail page names A's imported household specifically.
    await page.goto(`/admin/submissions/${rowB!.id}`);
    const banner = page
      .locator("p", { hasText: /possibly the same household/i })
      .first();
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: tagLabel })).toBeVisible();
  });
});
