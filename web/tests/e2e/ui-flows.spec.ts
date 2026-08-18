import { test, expect } from "@playwright/test";
import { signInAs, loginAsInBrowser, getOpenDriveId } from "./helpers/testClient";
import { createTestFamily, createTestChild, createTestCard } from "./helpers/factories";
import { cleanupAutoTestData } from "./helpers/cleanup";

test.describe("public claim flow", () => {
  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupAutoTestData(admin);
  });

  test("claiming a card removes it from /sponsor; cancelling brings it back", async ({ page, browser }) => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    const child = await createTestChild(admin, family.id, { first_name: "Zzautotestclaimable" });
    await createTestCard(admin, child.id);

    await page.goto("/sponsor");
    await page.getByPlaceholder(/search/i).fill("Zzautotestclaimable");
    await expect(page.getByText("Zzautotestclaimable")).toBeVisible();

    await page.getByRole("button", { name: /sponsor this gift/i }).click();
    await page.getByLabel(/your name/i).fill("AutoTest Claim Sponsor");
    await page.getByLabel(/^email$/i).fill(`claim-${Date.now()}@autotest.example.com`);
    await page.getByRole("button", { name: /confirm claim/i }).click();
    await expect(page.getByText(/thank you for sponsoring/i)).toBeVisible();

    // gone from the public page once claimed
    await page.reload();
    await page.getByPlaceholder(/search/i).fill("Zzautotestclaimable");
    await expect(page.getByText(/no children match|check back soon/i)).toBeVisible();

    // staff cancels the pledge on the Fulfillment board
    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    await loginAsInBrowser(staffPage, "admin");
    await staffPage.goto("/admin/fulfillment");
    await staffPage.getByPlaceholder(/search/i).fill("Zzautotestclaimable");
    staffPage.once("dialog", (dialog) => dialog.accept());
    await staffPage.getByRole("button", { name: /^cancel$/i }).click();
    // cancelAssignment() is an async Supabase call fired from the click
    // handler; closing the context immediately after click() (which only
    // waits for the click/confirm-dialog itself, not the request it kicks
    // off) races the in-flight PATCH and can tear the context down before it
    // lands. Wait for the board to actually reflect the cancellation — the
    // card drops back to "unassigned" with no active assignment, so its
    // Cancel button disappears — before closing this context.
    await expect(staffPage.getByRole("button", { name: /^cancel$/i })).toHaveCount(0);
    await staffContext.close();

    // back on the public page once cancelled
    await page.reload();
    await page.getByPlaceholder(/search/i).fill("Zzautotestclaimable");
    await expect(page.getByText("Zzautotestclaimable")).toBeVisible();
  });
});

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
    await volunteerPage.getByLabel(/^school$/i).selectOption("confidential");
    const volunteerRow = volunteerPage.getByRole("row", { name: new RegExp(`Family ${family.family_number}(?!\\d)`) });
    await expect(volunteerRow).toBeVisible();
    await expect(volunteerRow).not.toContainText("Zconfidentialautotest");
    await expect(volunteerRow).toContainText("Z.");
    await volunteerContext.close();

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsInBrowser(adminPage, "admin");
    await adminPage.goto("/admin/families");
    await adminPage.getByLabel(/^school$/i).selectOption("confidential");
    const adminRow = adminPage.getByRole("row", { name: new RegExp(`Family ${family.family_number}(?!\\d)`) });
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
    await page.getByRole("button", { name: /save family/i }).click();

    await expect(page.getByText(/add at least one child with a first name/i)).toBeVisible();
  });
});
