import { test, expect } from "@playwright/test";
import { signInAs, loginAsInBrowser, getOpenDriveId } from "./helpers/testClient";
import { createTestFamily, createTestChild } from "./helpers/factories";
import { cleanupAutoTestData } from "./helpers/cleanup";
import { describeDbError } from "../../lib/permissions";

// Admin-only actions should be easy to diagnose (2026-10-20, after a demo
// "Add school" save failed with a raw "new row violates row-level security
// policy for table schools"). Volunteers don't get the button, see a plain
// "you're signed in as a volunteer" notice, and any permission refusal that
// still reaches the data layer comes back in plain English. See
// lib/permissions.ts and components/VolunteerNotice.tsx.

test.describe("admin-only actions are clear to a volunteer", () => {
  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupAutoTestData(admin);
  });

  test("a real RLS refusal is translated into a plain admin-only message", async () => {
    const volunteer = await signInAs("volunteer");
    const { error } = await volunteer.from("schools").insert({ name: "AutoTest volunteer school" });
    expect(error, "a volunteer must not be able to add a school").not.toBeNull();
    expect(describeDbError(error, { adminAction: "add a school" })).toMatch(
      /^Only an admin can add a school\. You're signed in as a volunteer\./
    );
    // Without an action, still plain English, with the raw text kept for diagnosis.
    const generic = describeDbError(error);
    expect(generic).toMatch(/isn't allowed to make this change/);
    expect(generic).toContain("row-level security");
  });

  test("Schools: volunteer sees a notice instead of Add school; admin sees the button", async ({ browser }) => {
    const volunteerContext = await browser.newContext();
    const volunteerPage = await volunteerContext.newPage();
    await loginAsInBrowser(volunteerPage, "volunteer");
    await volunteerPage.goto("/admin/schools");
    await expect(volunteerPage.getByText(/only an admin can add a school/i)).toBeVisible();
    await expect(volunteerPage.getByRole("button", { name: "Add school" })).toHaveCount(0);
    await volunteerContext.close();

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsInBrowser(adminPage, "admin");
    await adminPage.goto("/admin/schools");
    await expect(adminPage.getByRole("button", { name: "Add school" })).toBeVisible();
    await expect(adminPage.getByText(/signed in as a volunteer/i)).toHaveCount(0);
    await adminContext.close();
  });

  test("Registration links: volunteer gets the read-only view and a notice", async ({ page }) => {
    await loginAsInBrowser(page, "volunteer");
    await page.goto("/admin/submissions");
    const panel = page.locator("section", { has: page.getByRole("heading", { name: "Registration links" }) });
    await expect(panel.getByText(/only an admin can\s+create or revoke links/i)).toBeVisible();
    await expect(panel.getByRole("button", { name: "New registration link" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Revoke" })).toHaveCount(0);
    await expect(panel.getByRole("checkbox", { name: /pause daily digest/i })).toHaveCount(0);
  });

  test("a volunteer can save an edit to a child with a wishlist, and gets a clear message if they change it", async ({
    page,
  }) => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    const child = await createTestChild(admin, family.id, { first_name: "AutoTest Wishlist" });
    const { error: wishlistError } = await admin.from("wishlist_items").insert([
      { child_id: child.id, position: 1, description: "a soccer ball" },
      { child_id: child.id, position: 2, description: "a puzzle" },
    ]);
    expect(wishlistError).toBeNull();

    await loginAsInBrowser(page, "volunteer");
    await page.goto(`/admin/families/${family.id}`);
    await expect(page.getByLabel(/internal notes/i)).toBeVisible();

    // Wishlist untouched: the save must go through. Before the fix, every save
    // rewrote the wishlist, the admin-only delete silently did nothing, and the
    // re-insert failed with "duplicate key".
    await page.getByLabel(/internal notes/i).fill("Volunteer edit, wishlist untouched");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/changes saved/i)).toBeVisible();

    // Wishlist changed: still admin-only, but now it says so.
    await page.getByPlaceholder("Wishlist item 1").fill("a basketball");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(
      page.getByText(/only an admin can change or remove wishlist items that are already saved/i)
    ).toBeVisible();

    const { data: rows } = await admin
      .from("wishlist_items")
      .select("position, description")
      .eq("child_id", child.id)
      .order("position");
    expect(rows).toEqual([
      { position: 1, description: "a soccer ball" },
      { position: 2, description: "a puzzle" },
    ]);
    const { data: fam } = await admin.from("families").select("internal_notes").eq("id", family.id).single();
    expect(fam!.internal_notes).toBe("Volunteer edit, wishlist untouched");
  });
});
