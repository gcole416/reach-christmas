import { test, expect } from "@playwright/test";
import { signInAs, loginAsInBrowser, getOpenDriveId } from "./helpers/testClient";
import { createTestFamily, createTestChild, createTestCard } from "./helpers/factories";
import { cleanupAutoTestData } from "./helpers/cleanup";

test.describe("public claim flow", () => {
  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupAutoTestData(admin);
  });

  // SPN-3 replaced the old one-step claim modal (name + email + "Confirm
  // claim" -> claimed immediately) with a two-step, email-verified flow:
  // "Send code" -> the sponsor types the 6-digit code they were emailed ->
  // "Confirm". Dev has no Resend API key configured in Supabase Vault yet
  // (see supabase/migrations/20260818160000_email_verified_claims.sql's
  // header comment and SPN-4 in docs/OPEN_QUESTIONS.md), so
  // request_claim_code currently always fails at the "send the email" step
  // with a specific, expected error — there is no code to retrieve and
  // therefore no way to drive this UI past the details step today. This test
  // covers everything that IS reachable: the two-step UI renders, the
  // details step really calls request_claim_code, and a failure there
  // surfaces to the sponsor and leaves the card untouched (still visible,
  // still claimable) rather than silently consuming it.
  test("requesting a claim code wires up to request_claim_code; the card stays available while Resend isn't configured in dev", async ({ page }) => {
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
    await page.getByRole("button", { name: /send code/i }).click();

    // Stays on the details step (never advances to the code step) and shows
    // the server's error, since request_claim_code raised rather than
    // returning ok.
    await expect(page.getByText(/email delivery is not configured yet/i)).toBeVisible();
    await expect(page.getByLabel(/6-digit code/i)).toHaveCount(0);

    // Nothing was written (request_claim_code fetches the Vault secret and
    // raises BEFORE its insert — see the migration comment on that ordering
    // fix), so the card is still unclaimed after closing the modal.
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await page.reload();
    await page.getByPlaceholder(/search/i).fill("Zzautotestclaimable");
    await expect(page.getByText("Zzautotestclaimable")).toBeVisible();
  });

  // Not executable today: reaching this requires a real 6-digit code, which
  // only exists once Grant provides a Resend API key
  // (`select vault.create_secret('re_xxx', 'resend_api_key', ...)` in the dev
  // project's SQL editor per the migration) and someone reads it out of an
  // actually-received email — there's no other sanctioned way to obtain or
  // insert one (card_claim_verifications has zero RLS policies and revokes
  // all anon/authenticated grants). See SPN-4 in docs/OPEN_QUESTIONS.md.
  test.fixme(
    "full flow: entering the emailed code completes the claim, removes the card from /sponsor, and staff can cancel it to bring the card back",
    async ({ page, browser }) => {
      // Once a Resend key exists in dev Vault:
      //  1. Fill details, click "Send code".
      //  2. Retrieve the real code from the received email.
      //  3. Fill the "6-digit code" field, click "Confirm".
      //  4. Expect "thank you for sponsoring" and the card gone from /sponsor.
      //  5. As staff on /admin/fulfillment, cancel the pledge.
      //  6. Reload /sponsor and expect the card visible again.
      void page;
      void browser;
    }
  );
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
