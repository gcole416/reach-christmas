import { test, expect } from "@playwright/test";
import { signInAs, loginAsInBrowser } from "./helpers/testClient";

// Regression cover for FIX 1b of
// supabase/migrations/20260901120000_revoke_execute_from_public_and_tighten_bcrypt_check.sql.
//
// That migration revokes EXECUTE on create_family(uuid,uuid,boolean,boolean,text)
// from `public, anon` and then re-grants it to `authenticated`. Staff intake is
// the ONLY caller of create_family (web/lib/store.tsx addFamily()), so if that
// re-grant is ever wrong — dropped, aimed at the wrong signature, or shadowed by
// a later lockdown migration copying the `from public, anon` pattern without the
// matching grant — ordinary volunteers lose the ability to enter a referral and
// the failure surfaces as "permission denied for function create_family" in the
// intake form's red error box.
//
// Deliberately driven through the real browser session rather than a direct
// .rpc() call: an RPC probe with a service/admin client proves the function
// exists, not that a plain volunteer's JWT (role `authenticated`, no
// can_view_confidential) can reach it through the app the way staff actually
// use it. The two can and did diverge — DB-27 was exactly a case of the
// privilege story on paper not matching the privilege story live.
//
// Everything created here is deleted in afterEach. Note that the intake UI does
// NOT tag its rows is_test_data/is_autotest_data — store.tsx calls create_family
// without p_is_test_data, so these families look like real ones to
// cleanupAutoTestData() and it will not remove them. Cleanup here is therefore
// by the unique child first name this spec generates, not by the autotest flag.
test.describe("volunteer intake through the real UI (create_family grant)", () => {
  // Unique per run so cleanup can never touch demo-seeded or real data.
  let childName = "";

  test.beforeEach(() => {
    childName = `Zzvolintake${Date.now()}`;
  });

  test.afterEach(async () => {
    const admin = await signInAs("admin");
    const { data: kids } = await admin.from("children").select("family_id").eq("first_name", childName);
    const familyIds = [...new Set((kids ?? []).map((k) => k.family_id as string))];
    if (familyIds.length > 0) {
      // Deleting the family cascades to children/wishlist_items/cards.
      const { error } = await admin.from("families").delete().in("id", familyIds);
      if (error) throw new Error(`Cleanup failed deleting families ${familyIds.join(",")}: ${error.message}`);
    }
    const { data: left } = await admin.from("children").select("id").eq("first_name", childName);
    expect(left ?? [], "cleanup must leave nothing behind on the dev project").toHaveLength(0);
  });

  test("a plain volunteer can save a direct-referral family and gets a family number back", async ({ page }) => {
    await loginAsInBrowser(page, "volunteer");

    await page.goto("/admin/intake");
    await expect(page.getByRole("heading", { name: /add a family/i })).toBeVisible();

    await page.getByLabel(/referral source/i).selectOption({ label: "Direct referral (no school)" });
    await page.getByLabel(/first name/i).fill(childName);
    await page.getByLabel(/^grade$/i).fill("3");
    await page.getByLabel(/shirt size/i).fill("YM");

    await page.getByRole("button", { name: /save family/i }).click();

    // The success banner is the UI's own proof that create_family returned a
    // row: store.tsx interpolates result.familyNumber straight into it.
    const banner = page.getByText(/saved as family \d+ with 1 child\./i);
    await expect(banner).toBeVisible();
    // A permission failure would render the red error box instead.
    await expect(page.getByText(/permission denied/i)).toHaveCount(0);

    const bannerText = (await banner.textContent()) ?? "";
    const familyNumber = Number(/saved as family (\d+)/i.exec(bannerText)?.[1]);
    expect(Number.isInteger(familyNumber) && familyNumber > 0).toBe(true);

    // And confirm it landed in the database, with the card the copy on that
    // page promises ("Each child gets a claimable card ... as soon as you save").
    const admin = await signInAs("admin");
    const { data: kids } = await admin
      .from("children")
      .select("id, family_id, first_name, grade, families!inner(family_number, is_confidential, drive_school_id)")
      .eq("first_name", childName);
    expect(kids ?? [], "exactly one child row should exist for this run").toHaveLength(1);
    const saved = kids![0] as unknown as {
      id: string;
      grade: string | null;
      families: { family_number: number; is_confidential: boolean; drive_school_id: string | null };
    };
    expect(saved.families.family_number).toBe(familyNumber);
    expect(saved.families.is_confidential).toBe(false);
    expect(saved.families.drive_school_id).toBeNull();
    expect(saved.grade).toBe("3");

    const { data: cards } = await admin.from("cards").select("id").eq("child_id", saved.id);
    expect(cards ?? [], "one card per child").toHaveLength(1);
  });

  test("double-clicking Save family creates one family, not two", async ({ page }) => {
    await loginAsInBrowser(page, "volunteer");
    await page.goto("/admin/intake");

    await page.getByLabel(/referral source/i).selectOption({ label: "Direct referral (no school)" });
    await page.getByLabel(/first name/i).fill(childName);

    // Two clicks as fast as Playwright will issue them. The guard is the
    // button's own `disabled={submitting}`; this test exists so that if that
    // ever regresses, the duplicate family number it would burn shows up here
    // rather than at a distribution table in December.
    const save = page.getByRole("button", { name: /save family/i });
    await save.dblclick();

    await expect(page.getByText(/saved as family \d+ with 1 child\./i)).toBeVisible();

    const admin = await signInAs("admin");
    const { data: kids } = await admin.from("children").select("id, family_id").eq("first_name", childName);
    expect(kids ?? [], "a double-click must not create a second family").toHaveLength(1);
  });

  test("the intake form is usable at a 360px phone viewport with no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await loginAsInBrowser(page, "volunteer");
    await page.goto("/admin/intake");

    await expect(page.getByRole("heading", { name: /add a family/i })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflows, "intake form must not scroll sideways on a phone").toBe(false);

    // The controls a volunteer has to hit are reachable and tappable at 360px.
    await expect(page.getByLabel(/referral source/i)).toBeVisible();
    await page.getByLabel(/referral source/i).selectOption({ label: "Direct referral (no school)" });
    await page.getByLabel(/first name/i).fill(childName);
    const save = page.getByRole("button", { name: /save family/i });
    await save.scrollIntoViewIfNeeded();
    const box = await save.boundingBox();
    expect(box, "Save family button must be laid out").not.toBeNull();
    expect(box!.height, "tap target should be at least ~40px tall").toBeGreaterThanOrEqual(36);
    expect(box!.x + box!.width, "Save family button must sit inside the viewport").toBeLessThanOrEqual(360);
  });
});
