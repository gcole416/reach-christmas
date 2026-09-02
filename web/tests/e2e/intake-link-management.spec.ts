import { test, expect, type Locator } from "@playwright/test";
import { anonClient, getOpenDriveId, signInAs } from "./helpers/testClient";
import {
  AUTOTEST_LINK_PREFIX,
  assertIntakeReady,
  cleanupIntakeTestData,
  runTag,
} from "./helpers/intake";

// US-27 — staff can create and revoke a school registration link from
// /admin/submissions, instead of it being a SQL-editor-only operation.
//
// The link is created through the real page, then its behaviour is verified
// against the database with an anon `get_form` call — "the link works" / "the
// link is dead" are claims about the token, not about a green banner.
//
// Seed-independent: creating the first link on a drive publishes the standard
// questionnaire automatically (ensureDriveFormVersion), so this suite only needs
// the intake FUNCTIONS present, not intake_demo_seed.sql. It targets whichever
// school is first in the drive, reads its name off the page, and asserts
// get_form reports that same name back.
//
// Cleanup: links this suite makes carry a random token, so they're swept by
// their `AutoTest LinkMgmt` label. The forms / form_versions row that the first
// run auto-publishes is left in place — it's the real drive questionnaire,
// carries no PII, and is exactly what the app would create on first use anyway.

const LABEL_PREFIX = "AutoTest LinkMgmt";
const REVIEW_EMAIL_PREFIX = "autotest-linkmgmt";

/** Each school's controls live inside a collapsed <details> dropdown (US-27
 *  tweak). Force it open before interacting with anything inside. */
async function openSchoolGroup(group: Locator): Promise<void> {
  await group.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
}

test.describe("staff registration-link management (US-27)", () => {
  test.beforeAll(async () => {
    await assertIntakeReady({ needsSeed: false });
  });

  test.afterAll(async () => {
    const admin = await signInAs("admin");
    const { error } = await admin.from("form_links").delete().like("label", `${LABEL_PREFIX}%`);
    if (error) throw new Error(`link-management cleanup failed: ${error.message}`);
    // `authenticated` has no DELETE on review_tokens (insert + update only), so
    // this suite's tokens are neutralised in place: revoked and their plaintext
    // wiped, matching how neutralizeAutotestReviewTokens handles the M3 probe.
    await admin
      .from("review_tokens")
      .update({ revoked_at: new Date().toISOString(), token: null })
      .like("issued_to_email", `${REVIEW_EMAIL_PREFIX}%`);
    await cleanupIntakeTestData(admin);
  });

  test("admin creates a school link, it works, then revokes it and it dies", async ({ page }) => {
    test.setTimeout(120_000);
    const tag = runTag();
    const label = `${LABEL_PREFIX} ${tag}`;

    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/admin");

    await page.goto("/admin/submissions");
    const panel = page.getByRole("region", { name: /registration links/i });
    await expect(panel).toBeVisible();

    // --- create ------------------------------------------------------------
    await panel.getByRole("button", { name: "New registration link" }).click();

    const schoolSelect = panel.getByLabel("School");
    const schoolName = (await schoolSelect.locator("option").first().textContent())?.trim() ?? "";
    expect(schoolName, "the drive has no schools to link").not.toBe("");
    await schoolSelect.selectOption({ index: 0 });

    await panel.getByLabel(/^Label/i).fill(label);
    await panel.getByLabel("Expires").fill("2030-01-01");
    await panel.getByRole("button", { name: "Create link" }).click();

    await expect(panel.getByText("Registration link created.")).toBeVisible();

    // The new link lives inside the school's (collapsed) dropdown.
    const group = panel.locator("[data-school-group]").filter({ hasText: schoolName });
    await openSchoolGroup(group);

    const myItem = group.locator("li").filter({ hasText: label });
    await expect(myItem).toHaveCount(1);

    const linkPath = await myItem.getByRole("textbox").inputValue();
    expect(linkPath).toMatch(/^\/form\/.+/);
    const token = linkPath.replace("/form/", "");

    // The token resolves to a live form for anon, scoped to the chosen school.
    const anon = anonClient();
    const created = await anon.rpc("get_form", { p_token: token });
    expect(created.error).toBeNull();
    expect((created.data as { ok: boolean }).ok).toBe(true);
    expect((created.data as { school_name: string }).school_name).toBe(schoolName);

    // --- revoke ----------------------------------------------------------------
    page.once("dialog", (dialog) => dialog.accept());
    await myItem.getByRole("button", { name: "Revoke" }).click();

    await expect(panel.getByText("Link revoked.")).toBeVisible();
    await expect(myItem.getByText("Revoked")).toBeVisible();
    await expect(myItem.getByRole("button", { name: "Revoke" })).toHaveCount(0);

    // A revoked link answers `not_found`, same as a token that never existed.
    const afterRevoke = await anon.rpc("get_form", { p_token: token });
    expect(afterRevoke.error).toBeNull();
    expect((afterRevoke.data as { ok: boolean }).ok).toBe(false);
  });

  test("a volunteer cannot insert a form_links row", async () => {
    // Runs after the create test, which has published the drive's questionnaire —
    // so there's a real form_version to reference and the insert can only fail
    // on RLS, not on a missing FK.
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);

    const { data: ds } = await admin
      .from("drive_schools")
      .select("id")
      .eq("drive_id", driveId)
      .limit(1)
      .single();
    const { data: form } = await admin
      .from("forms")
      .select("id")
      .eq("drive_id", driveId)
      .eq("slug", "family-intake")
      .single();
    const { data: fv } = await admin
      .from("form_versions")
      .select("id")
      .eq("form_id", (form as { id: string }).id)
      .not("published_at", "is", null)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    const volunteer = await signInAs("volunteer");
    const { error } = await volunteer.from("form_links").insert({
      drive_id: driveId,
      drive_school_id: (ds as { id: string }).id,
      form_version_id: (fv as { id: string }).id,
      token: `${AUTOTEST_LINK_PREFIX}${runTag()}-vol`,
      channel: "family",
    });

    // RLS "admin insert form_links" requires is_admin(); a volunteer is refused.
    expect(error, "a volunteer was allowed to create a registration link").not.toBeNull();
  });

  // --- US-28: counselor review link, re-copyable from the dashboard ----------

  test("admin issues a counselor review link and it opens a roster", async ({ page }) => {
    test.setTimeout(120_000);
    const tag = runTag();
    const email = `${REVIEW_EMAIL_PREFIX}-${tag}@example.com`;

    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/admin");
    await page.goto("/admin/submissions");

    const panel = page.getByRole("region", { name: /registration links/i });
    const group = panel
      .locator("[data-school-group]")
      .filter({ hasText: "OneLife Elementary" });
    await openSchoolGroup(group);

    // The review-link section is either "None yet" (issue it) or already live
    // (a prior run) — handle both so the suite is idempotent on shared dev.
    const emailField = group.getByLabel("Counselor email");
    if (await emailField.isVisible().catch(() => false)) {
      await emailField.fill(email);
      await group.getByRole("button", { name: "Create counselor link" }).click();
    }

    const reviewInput = group.getByLabel("Counselor review link");
    await expect(reviewInput).toBeVisible();
    const reviewPath = await reviewInput.inputValue();
    expect(reviewPath).toMatch(/^\/review\/.+/);
    const reviewToken = reviewPath.replace("/review/", "");

    // The token is a working roster key.
    const anon = anonClient();
    const roster = await anon.rpc("get_review_roster", { p_review_token: reviewToken });
    expect(roster.error).toBeNull();
    expect((roster.data as { ok: boolean }).ok).toBe(true);
    expect((roster.data as { school_name: string }).school_name).toBe("OneLife Elementary");
  });

  test("issue_review_token is admin-only and idempotent per school", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const { data: ds } = await admin
      .from("drive_schools")
      .select("id")
      .eq("drive_id", driveId)
      .limit(1)
      .single();
    const driveSchoolId = (ds as { id: string }).id;
    const email = `${REVIEW_EMAIL_PREFIX}-idem-${runTag()}@example.com`;

    // Volunteer: refused.
    const volunteer = await signInAs("volunteer");
    const { data: vRes } = await volunteer.rpc("issue_review_token", {
      p_drive_school_id: driveSchoolId,
      p_issued_to_email: email,
    });
    expect((vRes as { ok: boolean; reason?: string })?.ok).toBe(false);
    expect((vRes as { reason?: string })?.reason).toBe("forbidden");

    // Admin: two calls for the same school return the SAME token (one live link
    // per school). The earlier UI test may already have issued OneLife's, so
    // `first` can itself be a reuse — what matters is the two agree and the
    // second is flagged reused.
    const first = await admin.rpc("issue_review_token", {
      p_drive_school_id: driveSchoolId,
      p_issued_to_email: email,
    });
    expect(first.error).toBeNull();
    expect((first.data as { ok: boolean }).ok).toBe(true);

    const second = await admin.rpc("issue_review_token", {
      p_drive_school_id: driveSchoolId,
      p_issued_to_email: `${email}.other`,
    });
    expect((second.data as { reused: boolean }).reused).toBe(true);
    expect((second.data as { token: string }).token).toBe((first.data as { token: string }).token);
  });
});
