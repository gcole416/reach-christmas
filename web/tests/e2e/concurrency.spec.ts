import { test, expect } from "@playwright/test";
import { signInAs, getOpenDriveId, anonClient, loginAsInBrowser } from "./helpers/testClient";
import { createTestFamily, createTestChild, createTestCard, AUTOTEST_EMAIL_DOMAIN } from "./helpers/factories";
import { cleanupAutoTestData } from "./helpers/cleanup";

// The two race conditions this app deliberately guards against: two
// volunteers on different devices creating a family at the same instant
// (create_family's advisory lock), and two sponsors clicking "claim" on the
// same card at the same instant (the unique partial index on assignments).
test.describe("concurrency safety", () => {
  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupAutoTestData(admin);
  });

  test("create_family never hands out the same number to two concurrent callers", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);

    const [a, b] = await Promise.all([
      createTestFamily(admin, { driveId }),
      createTestFamily(admin, { driveId }),
    ]);

    expect(a.family_number).not.toBe(b.family_number);
  });

  test("claiming the same card twice at once lets exactly one sponsor through", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    const child = await createTestChild(admin, family.id);
    const card = await createTestCard(admin, child.id);

    const claim = () =>
      anonClient().rpc("claim_card", {
        p_card_id: card.id,
        p_sponsor_name: "AutoTest Race Sponsor",
        p_sponsor_email: `race-${Date.now()}@${AUTOTEST_EMAIL_DOMAIN}`,
      });

    const results = await Promise.all([claim(), claim()]);
    const succeeded = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].error?.message ?? "").toMatch(/claimed/i);
  });
});

// US-13: two staff members editing the same family. These run against the dev
// project and answer what only a live database can — the precision `updated_at`
// comes back with, whether that value round-trips through a PostgREST `eq`
// filter, and whether RLS really hides a confidential family from a plain
// volunteer. Requires the two dev test accounts to be email-confirmed and the
// dev data seeded (`reset_dev_sql` + `demo_seed`, see memory.md).
test.describe("US-13: concurrent edits to a family record", () => {
  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupAutoTestData(admin);
  });

  // The single highest-value live check. If the value the client reads back is
  // ever coarser than what's stored, `.eq("updated_at", ...)` matches nothing
  // and EVERY save in the app looks like a conflict.
  test("updated_at round-trips through a PostgREST eq filter without losing precision", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });

    const { data: loaded } = await admin.from("families").select("id, updated_at").eq("id", family.id).single();
    const version = loaded!.updated_at as string;
    // Not asserted as exactly six digits: Postgres trims trailing zeros, so a
    // timestamp that legitimately lands on a whole millisecond has fewer. What
    // must hold is that it is an ISO timestamptz the server will accept back.
    expect(version).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/);
    console.log(`[US-13] live families.updated_at rendering: ${version}`);

    // The exact shape store.tsx's guarded UPDATE uses.
    const { data: hit } = await admin
      .from("families")
      .update({ internal_notes: "US-13 round-trip probe" })
      .eq("id", family.id)
      .eq("updated_at", version)
      .select("id, updated_at");
    expect(hit, "a guarded update with the CURRENT version must affect exactly one row").toHaveLength(1);

    // And the now-stale version must match nothing — no error, zero rows,
    // which is why store.tsx asks for the rows back with `.select()`.
    const { data: miss, error: missError } = await admin
      .from("families")
      .update({ internal_notes: "US-13 stale probe — must not land" })
      .eq("id", family.id)
      .eq("updated_at", version)
      .select("id");
    expect(missError).toBeNull();
    expect(miss, "a guarded update with a STALE version must affect zero rows").toHaveLength(0);

    const { data: after } = await admin.from("families").select("internal_notes").eq("id", family.id).single();
    expect(after!.internal_notes).toBe("US-13 round-trip probe");
  });

  test("children.updated_at moves on every update, so a sibling's edit is detectable", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    const child = await createTestChild(admin, family.id);

    const before = child.updated_at as string;
    const { data: updated } = await admin
      .from("children")
      .update({ shirt_size: "L" })
      .eq("id", child.id)
      .eq("updated_at", before)
      .select("updated_at");
    expect(updated).toHaveLength(1);
    expect(updated![0].updated_at).not.toBe(before);
  });

  test("a plain volunteer gets zero rows — not an error — for a confidential family they can't see", async () => {
    const admin = await signInAs("admin");
    const volunteer = await signInAs("volunteer");
    const driveId = await getOpenDriveId(admin);
    // Created by the ADMIN, so the "creator keeps access" exception in the RLS
    // policies doesn't hand it back to the volunteer.
    const family = await createTestFamily(admin, { driveId, isConfidential: true });

    const { data, error } = await volunteer.from("families").select("id, updated_at").eq("id", family.id).maybeSingle();
    expect(error, "RLS must hide the row, not raise").toBeNull();
    expect(data, "a confidential family must be invisible to a volunteer without clearance").toBeNull();

    // ...which is exactly the observation saveFamilyEdit turns into the generic
    // not-found message rather than "someone else changed this".
    const { data: blocked } = await volunteer
      .from("families")
      .update({ internal_notes: "volunteer should not be able to write this" })
      .eq("id", family.id)
      .select("id");
    expect(blocked).toHaveLength(0);
  });

  test("UI: a second staff member's save makes the edit form reject and keep what was typed", async ({ page }) => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    await createTestChild(admin, family.id, { first_name: "AutoTest Concurrent" });

    await loginAsInBrowser(page, "admin");
    await page.goto(`/admin/families/${family.id}`);
    await expect(page.getByLabel(/internal notes/i)).toBeVisible();
    await page.getByLabel(/internal notes/i).fill("Typed by the first volunteer");

    // The second staff member saves first, straight through the data layer.
    await admin.from("families").update({ internal_notes: "Saved by the second volunteer" }).eq("id", family.id);

    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByRole("heading", { name: /someone else changed this family/i })).toBeVisible();
    await expect(page.getByLabel(/internal notes/i)).toHaveValue("Typed by the first volunteer");

    const { data: row } = await admin.from("families").select("internal_notes").eq("id", family.id).single();
    expect(row!.internal_notes, "the rejected save must not have written").toBe("Saved by the second volunteer");

    // Reload theirs, re-apply on top, and the next save must go through.
    await page.getByRole("button", { name: /reload the latest version/i }).click();
    await expect(page.getByLabel(/internal notes/i)).toHaveValue("Saved by the second volunteer");
    await page.getByLabel(/internal notes/i).fill("Saved by the second volunteer + first volunteer's addition");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/changes saved/i)).toBeVisible();
  });

  test("UI: a plain save with nobody else editing succeeds, twice in a row", async ({ page }) => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    await createTestChild(admin, family.id, { first_name: "AutoTest Sequential" });

    await loginAsInBrowser(page, "admin");
    await page.goto(`/admin/families/${family.id}`);

    for (const note of ["first save", "second save"]) {
      await page.getByLabel(/internal notes/i).fill(note);
      await page.getByRole("button", { name: /save changes/i }).click();
      await expect(page.getByText(/changes saved/i)).toBeVisible();
      await expect(page.getByRole("heading", { name: /someone else changed this family/i })).toHaveCount(0);
    }

    const { data: row } = await admin.from("families").select("internal_notes").eq("id", family.id).single();
    expect(row!.internal_notes).toBe("second save");
  });
});
