import { test, expect } from "@playwright/test";
import { signInAs, getOpenDriveId, anonClient } from "./helpers/testClient";
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
