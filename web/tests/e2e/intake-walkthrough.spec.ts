import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { signInAs, loginAsInBrowser } from "./helpers/testClient";
import {
  DEMO_FORM_TOKEN,
  DEMO_REVIEW_TOKEN,
  assertIntakeReady,
  autotestChildName,
  autotestGuardian,
  cleanupIntakeTestData,
  fillAndSubmitFamilyForm,
  findSubmissionByGuardian,
  runTag,
  waitForRosterCard,
} from "./helpers/intake";

// US-24 acceptance criterion 1 — the whole 9/9 walkthrough, through the real
// pages, in one test:
//
//   anonymous submit at /form/[token]
//     -> the submission appears on /review/[token]
//     -> the counselor corrects one child's first name and approves
//     -> an admin sees it as Verified at /admin/submissions
//     -> Import
//     -> family + children exist, with source_submission_id set and the
//        correction applied.
//
// Everything asserted at the end is read back from the database with an admin
// client, not from the screen: "the family exists with the correction applied"
// is a data claim, and a green page is not evidence of one.
//
// Every card, row and link is located by the synthetic name THIS run generated.
// The dev project is shared and the roster is season-long, so "the first
// pending card" is whatever someone else left behind — a positional selector
// here would quietly edit a stranger's registration instead of failing.

/**
 * A family or a counselor must never read a Postgres string. `unknown` reasons
 * are dropped rather than filtered in PublicShell.tsx — this is the assertion
 * that keeps that true.
 */
async function expectNoRawError(page: Page): Promise<void> {
  const body = await page.locator("body").innerText();
  for (const leak of ["PGRST", "42883", "permission denied", "search_path", "pg_catalog"]) {
    expect(body, `a raw database string ("${leak}") reached a public page`).not.toContain(leak);
  }
}

test.describe("intake walkthrough (US-24 AC1)", () => {
  test.beforeAll(async () => {
    await assertIntakeReady();
  });

  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupIntakeTestData(admin);
  });

  test("family submits, counselor corrects and approves, staff imports", async ({ page }) => {
    test.setTimeout(180_000);

    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const typoName = autotestChildName(tag, "Tpyo");
    const fixedName = autotestChildName(tag, "Fixed");
    const admin = await signInAs("admin");

    // --- 1. The family, with no login ---------------------------------------
    await page.goto(`/form/${DEMO_FORM_TOKEN}`);
    await expect(page.getByRole("heading", { name: /family gift registration/i })).toBeVisible();
    // The link already knows the school; the page shows it back (US-21).
    await expect(page.getByText("Demo Elementary North").first()).toBeVisible();

    await fillAndSubmitFamilyForm(page, {
      guardianName: guardian,
      guardianPhone: "555-0101",
      children: [
        {
          first_name: typoName,
          age: 8,
          grade: "3",
          sex: "M",
          wishlist: ["a red bicycle", "art supplies"],
        },
      ],
    });

    await expect(page.getByRole("heading", { name: /thank you/i })).toBeVisible();
    // No submission id, no PII echoed back, no way to reopen it (US-21).
    await expect(page.getByRole("link", { name: /edit|view your registration/i })).toHaveCount(0);

    const submission = await findSubmissionByGuardian(admin, guardian);
    expect(submission, "submit_form wrote no form_submissions row").not.toBeNull();
    expect(submission!.status).toBe("submitted");
    expect(submission!.channel).toBe("family");
    expect(submission!.drive_school_id).not.toBeNull();

    // --- 2. The counselor, with no login ------------------------------------
    await page.goto(`/review/${DEMO_REVIEW_TOKEN}`);
    await expect(page.getByRole("heading", { name: /confirm your families/i })).toBeVisible();

    // Our card, by name — never "the first one".
    const card = await waitForRosterCard(page, typoName);
    const firstName = card.getByLabel("First name");
    await expect(firstName).toHaveValue(typoName);

    // The three correction controls take their rules from the form definition
    // (US-22), not from constants in the page. correction_fields says
    // age.min = 0 / age.max = 19 and grade is a select over the definition's
    // option list — assert the page actually wired those through.
    const age = card.getByLabel("Age");
    await expect(age).toHaveAttribute("min", "0");
    await expect(age).toHaveAttribute("max", "19");
    const grade = card.getByLabel("Grade");
    await expect(grade).toHaveJSProperty("tagName", "SELECT");
    // ...and over the definition's list, in the definition's order — not a list
    // built from whatever grades happen to be on this roster.
    const gradeValues = await grade.locator("option").evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLOptionElement).value)
    );
    expect(gradeValues.slice(0, 3)).toEqual(["Not in school yet", "Pre-K", "K"]);
    expect(gradeValues).toContain("12");

    // Nothing outside first name / age / grade is on this page at all.
    await expect(card.getByText("a red bicycle")).toHaveCount(0);
    await expect(card.getByText("Youth M")).toHaveCount(0);
    await expect(page.getByText(guardian)).toHaveCount(0);

    // REGRESSION, the one that silently threw away a counselor's approve click
    // until this week: an 81-character corrected first name. The definition caps
    // it at 80 and verify_submission RAISES, so the page has to catch it before
    // the call — and say so, rather than appearing to succeed. (The cap is not
    // an input maxLength on purpose: clamping a pasted name without telling
    // anyone is worse. What matters is that the click isn't lost.)
    await firstName.fill("Q".repeat(81));
    await card.getByRole("button", { name: /confirm this family/i }).click();
    await card.getByLabel(/your name/i).fill(`AutoTest Counselor ${tag}`);
    await card.getByRole("button", { name: /^confirm$/i }).click();
    await expect(card.getByRole("alert")).toContainText(/81 characters|80 or fewer/i);
    // Still pending, still on this card, and nothing was written.
    await expect(card.getByRole("button", { name: /^confirm$/i })).toBeVisible();
    const stillPending = await findSubmissionByGuardian(admin, guardian);
    expect(stillPending!.status, "an 81-character name was accepted").toBe("submitted");

    // The real fix, and the approve.
    await firstName.fill(fixedName);
    await card.getByRole("button", { name: /^confirm$/i }).click();

    // The row moves to Verified in place.
    await expect(page.getByText(new RegExp(`confirmed by autotest counselor ${tag}`, "i")))
      .toBeVisible();

    const afterVerify = await findSubmissionByGuardian(admin, guardian);
    expect(afterVerify!.status).toBe("verified");
    // The correction is stored separately, keyed by 1-based child position —
    // `answers` is never rewritten (asserted at the end of this test).
    expect(afterVerify!.corrections).toEqual({ "1": { first_name: fixedName } });

    // --- 3. Staff --------------------------------------------------------------
    await loginAsInBrowser(page, "admin");
    await page.goto("/admin/submissions");

    const verifiedGroup = page.getByRole("region", { name: /ready to import/i });
    await expect(verifiedGroup.getByText(guardian)).toBeVisible();

    await page.getByRole("link", { name: new RegExp(guardian, "i") }).click();
    await page.waitForURL(`**/admin/submissions/${submission!.id}`);

    // The counselor's fix reads as a fix, not as the family's own words.
    await expect(page.getByText(typoName).first()).toBeVisible();
    await expect(page.getByText(fixedName).first()).toBeVisible();
    await expect(page.getByText(/counselor fix/i).first()).toBeVisible();

    await page.getByRole("button", { name: /import this family/i }).click();
    await page.getByRole("button", { name: /import now/i }).click();
    await expect(page.getByRole("heading", { name: /^imported$/i })).toBeVisible();

    // --- 4. What actually landed in the database -------------------------------
    const { data: families, error: familyError } = await admin
      .from("families")
      .select(
        "id, family_number, drive_id, drive_school_id, is_confidential, guardian_name, guardian_phone, source_submission_id, preferred_language, can_reach_church_pickup, consent_given_at"
      )
      .eq("source_submission_id", submission!.id);
    expect(familyError).toBeNull();
    expect(families, "import created exactly one family").toHaveLength(1);

    const family = families![0] as Record<string, unknown>;
    expect(family.source_submission_id).toBe(submission!.id);
    expect(family.guardian_name).toBe(guardian);
    expect(family.is_confidential).toBe(false);
    expect(family.drive_school_id).toBe(submission!.drive_school_id);
    expect(family.can_reach_church_pickup).toBe("Yes");
    expect(family.consent_given_at).not.toBeNull();
    // reach-reviewer runtime check 2: `select * into v_family from
    // create_family(...)` is a composite-return assignment in the same migration
    // that adds nine columns to `families`. If it mis-bound, family_number would
    // not be a sane positive integer here.
    expect(typeof family.family_number).toBe("number");
    expect(family.family_number as number).toBeGreaterThan(0);

    const { data: children, error: childError } = await admin
      .from("children")
      .select(
        "id, child_index, first_name, age, grade, sex, shirt_size, pant_size, shoe_size, source_submission_id"
      )
      .eq("family_id", family.id as string)
      .order("child_index");
    expect(childError).toBeNull();
    expect(children).toHaveLength(1);

    const child = children![0] as Record<string, unknown>;
    // The correction is applied, and `answers` was never rewritten to get there.
    expect(child.first_name).toBe(fixedName);
    expect(child.age).toBe(8);
    expect(child.grade).toBe("3");
    expect(child.source_submission_id).toBe(submission!.id);

    const { data: wishes } = await admin
      .from("wishlist_items")
      .select("position, description")
      .eq("child_id", child.id as string)
      .order("position");
    expect(wishes?.map((w) => (w as { description: string }).description)).toEqual([
      "a red bicycle",
      "art supplies",
    ]);

    const { count: cardCount } = await admin
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("child_id", child.id as string);
    expect(cardCount, "exactly one card per child (ADM-2)").toBe(1);

    // The family's own words survive untouched in the provenance record.
    const { data: raw } = await admin
      .from("form_submissions")
      .select("answers, status, imported_family_id")
      .eq("id", submission!.id)
      .single();
    const answers = (raw as { answers: { children: Array<{ first_name: string }> } }).answers;
    expect(answers.children[0].first_name).toBe(typoName);
    expect((raw as { status: string }).status).toBe("imported");
    expect((raw as { imported_family_id: string }).imported_family_id).toBe(family.id);

    // ...and it appears in the normal admin family views like any hand-entered
    // family. This is the last leg of AC1, and the only one a data assertion
    // can't cover: the Families Explorer has to actually list it.
    await page.goto(`/admin/families/${family.id as string}`);
    await expect(page.getByText(fixedName).first()).toBeVisible();
  });

  test("the public form works one-handed at 360px with no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/form/${DEMO_FORM_TOKEN}`);
    await expect(page.getByRole("heading", { name: /family gift registration/i })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, "the form overflows horizontally at 360px").toBeLessThanOrEqual(1);

    // Every control the family has to reach is a real <label for> association —
    // the wrapping-label pattern is what broke the suite in US-18.
    await expect(page.getByLabel(/parent or guardian name/i)).toBeVisible();
    await expect(page.getByLabel(/phone number/i)).toBeVisible();
    await expect(page.getByLabel(/child's first name/i)).toBeVisible();

    // The honeypot is present, off-screen, and out of the tab order.
    const honeypot = page.locator("#intake-hp");
    await expect(honeypot).toHaveCount(1);
    await expect(honeypot).toHaveAttribute("tabindex", "-1");

    // And there is no home-address question anywhere on the form (DESIGN §5).
    // ("Email address (optional)" is a real label, so this can't just look for
    // the word "address".)
    await expect(
      page.getByText(/street address|home address|mailing address|zip code|apartment/i)
    ).toHaveCount(0);
  });

  test("the counselor roster is readable at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/review/${DEMO_REVIEW_TOKEN}`);
    await expect(page.getByRole("heading", { name: /confirm your families/i })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, "the roster overflows horizontally at 360px").toBeLessThanOrEqual(1);
  });

  test("a dead review link shows a friendly page, never a partial roster", async ({ page }) => {
    await page.goto("/review/autotest-definitely-not-a-real-review-token");
    await expect(
      page.getByRole("heading", { name: /no longer active/i })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /confirm this family/i })).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expectNoRawError(page);
  });

  test("a dead form link shows a friendly page, not an error dump", async ({ page }) => {
    await page.goto("/form/autotest-definitely-not-a-real-form-token");
    await expect(
      page.getByRole("heading", { name: /registration link is.{0,3}t active/i })
    ).toBeVisible();
    await expect(page.getByText(/current link/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /submit registration/i })).toHaveCount(0);
    await expectNoRawError(page);
  });
});
