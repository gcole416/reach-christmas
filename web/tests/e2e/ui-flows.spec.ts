import { test, expect } from "@playwright/test";
import { signInAs, loginAsInBrowser, getOpenDriveId } from "./helpers/testClient";
import { createTestFamily, createTestChild, createTestCard } from "./helpers/factories";
import { cleanupAutoTestData } from "./helpers/cleanup";

// The "public claim flow" UI tests that used to open this file drove the
// self-serve /sponsor page (search, claim code, wrong-code lockout). That page
// is now a link to the Church Center sign-up (US-59, 2026-10-19), so they were
// removed on 2026-10-20. The claim RPCs themselves (request_claim_code,
// claim_card_with_code) are still covered at the database level by the
// "SPN-3" tests in security.spec.ts.

test.describe("confidential name redaction", () => {
  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupAutoTestData(admin);
  });

  test("shows a first-initial only to a non-admin volunteer, full name to an admin", async ({ browser }) => {
    const volunteerApi = await signInAs("volunteer");
    const driveId = await getOpenDriveId(volunteerApi);
    const family = await createTestFamily(volunteerApi, { driveId, isConfidential: true });
    const child = await createTestChild(volunteerApi, family.id, { first_name: "Zconfidentialautotest" });
    await createTestCard(volunteerApi, child.id);

    const volunteerContext = await browser.newContext();
    const volunteerPage = await volunteerContext.newPage();
    await loginAsInBrowser(volunteerPage, "volunteer");
    await volunteerPage.goto("/admin/families");
    // getByLabel(/^school$/i) (anchored regex) never resolves here — found
    // 2026-08-25 while debugging a full-timeout hang on this line: the
    // <select> is only implicitly labelled (a <span>School</span> sibling
    // inside the wrapping <label>, no htmlFor/aria-label), so its computed
    // accessible name is name-from-content and includes the select's own
    // rendered value/option text after "School", not just the word "School"
    // alone — confirmed empirically (getByLabel(/^school$/i).count() === 0,
    // getByLabel("School").count() === 1). A plain string is a
    // case-insensitive SUBSTRING match by default (unlike a regex, which is
    // tested against the full computed name), so it still resolves to
    // exactly this one control without ambiguity against "Status" or
    // "Search" nearby. See FamiliesExplorer.tsx's filter markup.
    await volunteerPage.getByLabel("School").selectOption("confidential");
    const volunteerRow = volunteerPage.getByRole("row", { name: new RegExp(`Household Z${family.family_number}(?!\\d)`) });
    await expect(volunteerRow).toBeVisible();
    await expect(volunteerRow).not.toContainText("Zconfidentialautotest");
    await expect(volunteerRow).toContainText("Z.");
    await volunteerContext.close();

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsInBrowser(adminPage, "admin");
    await adminPage.goto("/admin/families");
    await adminPage.getByLabel("School").selectOption("confidential");
    const adminRow = adminPage.getByRole("row", { name: new RegExp(`Household Z${family.family_number}(?!\\d)`) });
    await expect(adminRow).toContainText("Zconfidentialautotest");
    await adminContext.close();
  });
});

test.describe("intake form validation", () => {
  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupAutoTestData(admin);
  });

  test("rejects a whitespace-only child name with a friendly error, not a crash", async ({ page }) => {
    await loginAsInBrowser(page, "admin");
    await page.goto("/admin/intake");

    await page.getByLabel(/referral source/i).selectOption("__direct");
    await page.getByLabel(/first name/i).fill(" ");
    await page.getByRole("button", { name: /save household/i }).click();

    await expect(page.getByText(/add at least one child with a first name/i)).toBeVisible();
  });
});
