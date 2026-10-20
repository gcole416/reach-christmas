import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInAs, getOpenDriveId } from "./helpers/testClient";
import { AUTOTEST_EMAIL_DOMAIN, createTestCard, createTestChild, createTestFamily } from "./helpers/factories";
import { cleanupAutoTestData } from "./helpers/cleanup";

// US-62: the sponsor-first Assign sponsors workspace. Self-contained on shared
// dev: it creates its own two-child household (is_autotest_data) and its own
// roster entry, and never assigns or saves anything else. The "Suggest
// matches" check only opens and discards the draft; saving a draft would
// assign real dev cards.

const TAG = `${Date.now().toString(36)}`;
const SPONSOR_NAME = `AutoTest Assign Sponsor ${TAG}`;
const KID_A = `AutoTestA${TAG}`;
const KID_B = `AutoTestB${TAG}`;

let admin: SupabaseClient;
let sponsorFamilyId: string;
let cardIds: string[] = [];

async function activeAssignments(cardId: string) {
  const { data, error } = await admin
    .from("assignments")
    .select("id, status, sponsors!inner(sponsor_family_id)")
    .eq("card_id", cardId)
    .neq("status", "cancelled");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as { id: string; sponsors: { sponsor_family_id: string } }[];
}

test.describe("assign sponsors workspace (US-62)", () => {
  test.beforeAll(async () => {
    admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const { data: ds } = await admin.from("drive_schools").select("id").eq("drive_id", driveId).limit(1).single();
    const family = await createTestFamily(admin, { driveId, driveSchoolId: (ds as { id: string }).id });
    for (const [i, name] of [KID_A, KID_B].entries()) {
      const child = await createTestChild(admin, family.id, {
        child_index: i + 1,
        first_name: name,
        grade: "3",
        sex: "F",
      });
      const card = await createTestCard(admin, child.id);
      cardIds.push(card.id);
    }
    const { data: sf, error } = await admin
      .from("sponsor_families")
      .insert({
        drive_id: driveId,
        display_name: SPONSOR_NAME,
        contact_email: `assign-${TAG}@${AUTOTEST_EMAIL_DOMAIN}`,
        capacity: 3,
        notes: "AutoTest note: girls please",
      })
      .select("id")
      .single();
    if (error || !sf) throw new Error(error?.message ?? "no sponsor_families row");
    sponsorFamilyId = (sf as { id: string }).id;
  });

  test.afterAll(async () => {
    // Households first (cascades to cards/assignments), then the sponsors rows
    // by test email domain, then the roster entry they pointed at.
    await cleanupAutoTestData(admin);
    if (sponsorFamilyId) await admin.from("sponsor_families").delete().eq("id", sponsorFamilyId);
    cardIds = [];
  });

  test("pick a sponsor, assign a household in one click, undo it, then assign one child", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/admin");
    await page.goto("/admin/assign");

    // Nothing is assignable until a sponsor is picked.
    await page.getByPlaceholder("Child, card, or household…").fill(TAG);
    const household = page.getByRole("listitem").filter({ hasText: KID_A }).filter({ hasText: "Assign all 2" });
    await expect(household.getByRole("button", { name: "Assign all 2" })).toBeDisabled();

    await page.getByPlaceholder("Search sponsors or notes…").fill(TAG);
    await page.getByRole("button", { name: new RegExp(SPONSOR_NAME) }).click();
    await expect(page.getByText(`Assigning to`)).toBeVisible();
    await expect(page.getByText("Note: AutoTest note: girls please")).toBeVisible();

    // One click assigns both siblings.
    await household.getByRole("button", { name: "Assign all 2" }).click();
    const toast = page.getByRole("status").filter({ hasText: SPONSOR_NAME });
    await expect(toast).toContainText(`${KID_A} and ${KID_B}`);
    for (const id of cardIds) {
      const active = await activeAssignments(id);
      expect(active, "card not assigned to the picked sponsor").toHaveLength(1);
      expect(active[0].sponsors.sponsor_family_id).toBe(sponsorFamilyId);
    }
    await expect(page.getByText("2 of 3 · 1 open").first()).toBeVisible();

    // Undo puts both back.
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toHaveCount(0);
    for (const id of cardIds) expect(await activeAssignments(id)).toHaveLength(0);
    await expect(household.getByRole("button", { name: "Assign all 2" })).toBeEnabled();

    // A single child.
    const rowA = household.getByRole("listitem").filter({ hasText: KID_A });
    await rowA.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByRole("status").filter({ hasText: SPONSOR_NAME })).toContainText(KID_A);
    expect(await activeAssignments(cardIds[0])).toHaveLength(1);
    expect(await activeAssignments(cardIds[1])).toHaveLength(0);
  });

  test("Suggest matches opens a draft and Discard writes nothing", async ({ page }) => {
    test.setTimeout(120_000);
    // Start from a clean slate for the test household.
    for (const id of cardIds) {
      for (const a of await activeAssignments(id)) await admin.from("assignments").update({ status: "cancelled" }).eq("id", a.id);
    }
    const before = await admin.from("assignments").select("id", { count: "exact", head: true }).neq("status", "cancelled");

    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/admin");
    await page.goto("/admin/assign");

    await page.getByRole("button", { name: "Suggest matches…" }).click();
    await expect(page.getByRole("heading", { name: "Suggested matches" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save \d+ assignments$/ })).toBeVisible();
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByRole("heading", { name: "Assign sponsors" })).toBeVisible();

    const after = await admin.from("assignments").select("id", { count: "exact", head: true }).neq("status", "cancelled");
    expect(after.count, "discarding a draft wrote assignments").toBe(before.count);
  });
});
