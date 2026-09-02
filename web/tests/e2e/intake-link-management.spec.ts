import { test, expect } from "@playwright/test";
import { anonClient, signInAs } from "./helpers/testClient";
import {
  AUTOTEST_LINK_PREFIX,
  assertIntakeReady,
  cleanupIntakeTestData,
  demoFormVersionId,
  runTag,
} from "./helpers/intake";

// ADM-24 — staff can create and revoke a school registration link from
// /admin/submissions, instead of it being a SQL-editor-only operation.
//
// The link is created through the real page, then its behaviour is verified
// against the database with an anon `get_form` call — "the link works" / "the
// link is dead" are claims about the token, not about a green banner.
//
// Everything this suite creates is labelled `AutoTest LinkMgmt <tag>` (links it
// makes through the UI) or tokened with AUTOTEST_LINK_PREFIX (the RLS probe),
// and both are swept in afterAll. Nothing here submits a form, so no
// form_submissions or families are produced.

const LABEL_PREFIX = "AutoTest LinkMgmt";

test.describe("staff registration-link management (ADM-24)", () => {
  test.beforeAll(async () => {
    await assertIntakeReady();
  });

  test.afterAll(async () => {
    const admin = await signInAs("admin");
    // Links this suite made through the UI carry a random token, so they are
    // keyed on their label instead of the AUTOTEST_LINK_PREFIX the shared
    // cleanup sweeps.
    const { error } = await admin.from("form_links").delete().like("label", `${LABEL_PREFIX}%`);
    if (error) throw new Error(`link-management cleanup failed: ${error.message}`);
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

    await panel.getByLabel("School").selectOption({ label: "Demo Elementary North" });
    await panel.getByLabel(/^Label/i).fill(label);
    await panel.getByLabel("Expires").fill("2030-01-01");
    await panel.getByRole("button", { name: "Create link" }).click();

    await expect(panel.getByText("Registration link created.")).toBeVisible();

    const myItem = panel.locator("li").filter({ hasText: label });
    await expect(myItem).toHaveCount(1);

    const linkPath = await myItem.getByRole("textbox").inputValue();
    expect(linkPath).toMatch(/^\/form\/.+/);
    const token = linkPath.replace("/form/", "");

    // The token actually resolves to a live form for anon.
    const anon = anonClient();
    const created = await anon.rpc("get_form", { p_token: token });
    expect(created.error).toBeNull();
    expect((created.data as { ok: boolean }).ok).toBe(true);
    expect((created.data as { school_name: string }).school_name).toBe("Demo Elementary North");

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
    const volunteer = await signInAs("volunteer");
    const { versionId, driveId, driveSchoolId } = await demoFormVersionId(await signInAs("admin"));

    const { error } = await volunteer.from("form_links").insert({
      drive_id: driveId,
      drive_school_id: driveSchoolId,
      form_version_id: versionId,
      token: `${AUTOTEST_LINK_PREFIX}${runTag()}-vol`,
      channel: "family",
    });

    // RLS "admin insert form_links" requires is_admin(); a volunteer is refused.
    expect(error, "a volunteer was allowed to create a registration link").not.toBeNull();
  });
});
