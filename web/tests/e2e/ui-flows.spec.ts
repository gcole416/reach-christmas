import { test, expect } from "@playwright/test";
import { signInAs, loginAsInBrowser, getOpenDriveId } from "./helpers/testClient";
import { createTestFamily, createTestChild, createTestCard } from "./helpers/factories";
import { cleanupAutoTestData } from "./helpers/cleanup";

test.describe("public claim flow", () => {
  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupAutoTestData(admin);
  });

  // KNOWN BUG as of 2026-08-25, found by this suite, not yet fixed: with a
  // real Resend key now in Vault, request_claim_code() no longer fails at
  // "email delivery is not configured" — it fails one step later, at
  // `crypt(v_code, gen_salt('bf'))`, with Postgres error 42883 "function
  // gen_salt(unknown) does not exist". Reproduced directly via
  // `supabase.rpc("request_claim_code", ...)`, bypassing the UI entirely, so
  // this is a database-layer bug, not a test/selector problem. pgcrypto IS
  // installed (`create extension if not exists pgcrypto;` in
  // 20260708120000_init.sql), but request_claim_code's `set search_path =
  // public` likely doesn't include whatever schema this Supabase Cloud
  // project actually put pgcrypto in (commonly `extensions`, not `public`,
  // on Supabase Cloud — see supabase/config.toml's own
  // `extra_search_path = ["public", "extensions"]`). claim_card_with_code
  // has the same `set search_path = public` plus its own crypt() call and is
  // almost certainly affected the same way, though it can't be reached to
  // confirm until this is fixed. Suspected fix: schema-qualify the calls
  // (`extensions.gen_salt('bf')` / `extensions.crypt(...)`) or widen
  // `set search_path` on both functions — a database-engineer, not
  // qa-tester, change (out of this file's scope). The two tests below are
  // written for the CORRECT/intended behavior and will keep failing until
  // that's fixed — that's deliberate, not a flaky/broken test.

  // SPN-3 replaced the old one-step claim modal (name + email + "Confirm
  // claim" -> claimed immediately) with a two-step, email-verified flow:
  // "Send code" -> the sponsor types the 6-digit code they were emailed ->
  // "Confirm". As of 2026-08-25 Grant has stored a real Resend API key in
  // the dev project's Vault
  // (`select vault.create_secret('re_...', 'resend_api_key', ...)`), so
  // request_claim_code() now actually succeeds and advances to the code
  // step. This test covers everything reachable WITHOUT reading a real
  // inbox: the two-step UI renders, request_claim_code really succeeds
  // (email delivery configured, no error), a wrong code is rejected without
  // consuming the card, and the card is still visible/claimable afterward.
  test("requesting a claim code succeeds now that Resend is configured; a wrong code is rejected without claiming the card", async ({ page }) => {
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
    // @autotest.example.com is RFC 2606 reserved (example.com) — Resend can
    // be asked to send here without any risk of a real inbox actually
    // receiving mail, same convention the rest of this suite uses for real
    // network calls.
    await page.getByLabel(/^email$/i).fill(`claim-${Date.now()}@autotest.example.com`);
    await page.getByRole("button", { name: /send code/i }).click();

    // Advances to the code step and shows no error — proves
    // request_claim_code found the Vault secret and returned a
    // session_token instead of raising "Email delivery is not configured
    // yet."
    await expect(page.getByText(/email delivery is not configured yet/i)).toHaveCount(0);
    await expect(page.getByLabel(/6-digit code/i)).toBeVisible();

    // We cannot read the real code (see the fixme below for why), but we CAN
    // prove a wrong guess is rejected server-side by claim_card_with_code
    // without touching the card.
    await page.getByLabel(/6-digit code/i).fill("000000");
    await page.getByRole("button", { name: /^confirm$/i }).click();
    await expect(page.getByText(/that code doesn.t match/i)).toBeVisible();

    await page.getByRole("button", { name: /^cancel$/i }).click();
    await page.reload();
    await page.getByPlaceholder(/search/i).fill("Zzautotestclaimable");
    await expect(page.getByText("Zzautotestclaimable")).toBeVisible();
  });

  // Same abuse-guard coverage as claim_card_with_code's 5-attempt cap: five
  // wrong guesses in a row should lock the session (not raise, not crash),
  // require a fresh code, and — like the single-wrong-guess case above —
  // never touch the card.
  test("five wrong code guesses lock the session and require a fresh code, without claiming the card", async ({ page }) => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    const child = await createTestChild(admin, family.id, { first_name: "Zzautotestlockout" });
    await createTestCard(admin, child.id);

    await page.goto("/sponsor");
    await page.getByPlaceholder(/search/i).fill("Zzautotestlockout");
    await page.getByRole("button", { name: /sponsor this gift/i }).click();
    await page.getByLabel(/your name/i).fill("AutoTest Lockout Sponsor");
    await page.getByLabel(/^email$/i).fill(`lockout-${Date.now()}@autotest.example.com`);
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.getByLabel(/6-digit code/i)).toBeVisible();

    for (let i = 0; i < 4; i++) {
      await page.getByLabel(/6-digit code/i).fill("111111");
      await page.getByRole("button", { name: /^confirm$/i }).click();
      await expect(page.getByText(/that code doesn.t match/i)).toBeVisible();
    }
    // 5th wrong guess trips the cap — the form itself is replaced by an
    // "Edit info" / "Send a new code" pair (ClaimModal's sessionDead branch).
    await page.getByLabel(/6-digit code/i).fill("222222");
    await page.getByRole("button", { name: /^confirm$/i }).click();
    await expect(page.getByText(/too many attempts/i)).toBeVisible();
    await expect(page.getByLabel(/6-digit code/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /send a new code/i })).toBeVisible();

    // No explicit close/cancel button in this branch of the modal — dismiss
    // by clicking the overlay, matching how ClaimModal wires onClose.
    await page.mouse.click(5, 5);
    await page.reload();
    await page.getByPlaceholder(/search/i).fill("Zzautotestlockout");
    await expect(page.getByText("Zzautotestlockout")).toBeVisible();
  });

  // Still not executable, and for a different reason than before: reaching
  // this requires a real 6-digit code read out of an actually-received
  // email. Checked on 2026-08-25 whether either "sanctioned peek" idea in
  // the task briefing holds up, empirically, against dev, signed in as the
  // admin test account (the same privilege the app itself has — no
  // service_role used):
  //   - card_claim_verifications: `select * from card_claim_verifications`
  //     via the JS client returns Postgres error 42501 "permission denied
  //     for table card_claim_verifications" — the migration's
  //     `revoke all ... from anon, authenticated` really does block this
  //     table for every role this app can authenticate as, admin included.
  //   - net.http_response (to check Resend's actual HTTP response, per
  //     DB-27's "still worth a careful look"): querying `.schema("net")`
  //     returns PostgREST error PGRST106 "Invalid schema: net" — this
  //     project's `supabase/config.toml` only exposes `public` and
  //     `graphql_public` to the Data API, so the `net` schema is
  //     unreachable over REST regardless of table grants.
  // Both doors are genuinely closed, not just RLS-empty. The best
  // automatable signal is the test above (request_claim_code returns a
  // session_token instead of raising) — completing an actual claim by
  // typing in the real code is a human-in-the-loop step: a QA engineer
  // needs a real, checkable inbox to read the code and paste it back in
  // manually. If the team wants this automated, that needs a dedicated
  // sanctioned test mailbox (e.g. a real address on a domain the team
  // controls, checked via an inbox API) as its own follow-up — worth raising
  // with the PM as a backlog item rather than improvising one here.
  test.fixme(
    "full flow: entering the emailed code completes the claim, removes the card from /sponsor, and staff can cancel it to bring the card back",
    async ({ page, browser }) => {
      //  1. Fill details, click "Send code".
      //  2. Retrieve the real code from the received email (manual step).
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
