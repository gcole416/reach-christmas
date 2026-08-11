import { test, expect, type Page } from "@playwright/test";
import { IDS, VIEWER_ADMIN, VIEWER_PLAIN_VOLUNTEER, seedTables } from "./seed";
import { dumpStub, otherUserUpdates, resetStub, rowById, stubRequests } from "./control";

// US-13 — "Detect concurrent edits to a family/child record".
//
// These run against the in-memory PostgREST/Auth stub in postgrestStub.mjs,
// NOT against a Supabase project (the dev project's test accounts are stuck on
// "Email not confirmed"). Everything below therefore verifies the client half
// of the feature — store.tsx's saveFamilyEdit and the edit page's banner —
// against faithful PostgREST semantics. Real RLS and the live project's
// timestamptz rendering are verified separately, or reported as unverified.

const CONFLICT_HEADING = /someone else changed this family while you were editing/i;
const PARTIAL_SAVE_SENTENCE = /other changes on this page may already be saved/i;
const NOT_FOUND_MESSAGE = /couldn't be found, or you no longer have access/i;

/** Fails the run if the app ever reaches a real Supabase project. */
function guardAgainstRealSupabase(page: Page) {
  const leaks: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("supabase.co")) leaks.push(req.url());
  });
  return () => expect(leaks, "the stub-backed suite must never touch a real Supabase project").toEqual([]);
}

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill("stub-user@autotest.example.com");
  await page.getByLabel(/password/i).fill("stub-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/admin");
}

async function openFamilyEdit(page: Page, familyId: string = IDS.family) {
  await page.goto(`/admin/families/${familyId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** The three fields user A types into, so every test edits the same things. */
async function typeUserAsEdits(page: Page) {
  await page.getByLabel(/^sort tag$/i).fill("A-SORT-TAG");
  await page.getByLabel(/internal notes/i).fill("A's unsaved notes");
  await page.getByLabel(/^grade$/i).first().fill("A-GRADE");
}

async function expectUserAsEditsStillOnScreen(page: Page) {
  await expect(page.getByLabel(/^sort tag$/i)).toHaveValue("A-SORT-TAG");
  await expect(page.getByLabel(/internal notes/i)).toHaveValue("A's unsaved notes");
  await expect(page.getByLabel(/^grade$/i).first()).toHaveValue("A-GRADE");
}

test.beforeEach(async () => {
  await resetStub(seedTables(), VIEWER_ADMIN);
});

test.describe("US-13 concurrent family edits", () => {
  test("AC1+AC3: a competing edit is rejected with the plain-language warning, and nothing typed is lost", async ({
    page,
  }) => {
    const assertNoLeak = guardAgainstRealSupabase(page);
    await signIn(page);
    await openFamilyEdit(page);

    await typeUserAsEdits(page);

    // User B saves their own change to the same family while A's form sits open.
    await otherUserUpdates("families", IDS.family, { internal_notes: "B's notes, saved first" });

    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toBeVisible();
    await expect(page.getByRole("button", { name: /reload the latest version/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /save my version anyway/i })).toBeVisible();

    // The headline requirement: A's typing survives the rejection.
    await expectUserAsEditsStillOnScreen(page);
    assertNoLeak();
  });

  test("AC1 (child edited): a competing edit to a CHILD row is caught too", async ({ page }) => {
    await signIn(page);
    await openFamilyEdit(page);
    await typeUserAsEdits(page);

    // Family row untouched this time — only child Bravo moves.
    await otherUserUpdates("children", IDS.childB, { shirt_size: "L" });

    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toBeVisible();
    await expectUserAsEditsStillOnScreen(page);
  });

  test("AC5: a clean rejection writes NOTHING and never claims a partial save", async ({ page }) => {
    await signIn(page);
    await openFamilyEdit(page);
    await typeUserAsEdits(page);

    await otherUserUpdates("families", IDS.family, { internal_notes: "B's notes, saved first" });

    // Snapshot every row version AFTER B's write, i.e. what must not move.
    const familyAfterB = await rowById("families", IDS.family);
    const childAAfterB = await rowById("children", IDS.childA);
    const childBAfterB = await rowById("children", IDS.childB);
    const wishlistBefore = (await dumpStub()).wishlist_items;

    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toBeVisible();

    const familyAfter = await rowById("families", IDS.family);
    expect(familyAfter.updated_at, "family updated_at must not move on a rejected save").toBe(familyAfterB.updated_at);
    expect(familyAfter.internal_notes).toBe("B's notes, saved first");
    expect(familyAfter.sort_tag).not.toBe("A-SORT-TAG");

    expect((await rowById("children", IDS.childA)).updated_at).toBe(childAAfterB.updated_at);
    expect((await rowById("children", IDS.childB)).updated_at).toBe(childBAfterB.updated_at);
    expect((await rowById("children", IDS.childA)).grade).not.toBe("A-GRADE");

    // The wishlist delete+reinsert must not have run either.
    expect((await dumpStub()).wishlist_items).toEqual(wishlistBefore);

    // partialSave must be false, so the "already saved" sentence must not show.
    await expect(page.getByText(PARTIAL_SAVE_SENTENCE)).toHaveCount(0);
  });

  test("AC4: 'Reload the latest version' re-seeds AND resets the baseline, so the next save succeeds", async ({
    page,
  }) => {
    await signIn(page);
    await openFamilyEdit(page);
    await typeUserAsEdits(page);

    await otherUserUpdates("families", IDS.family, { internal_notes: "B's notes, saved first" });
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toBeVisible();

    await page.getByRole("button", { name: /reload the latest version/i }).click();

    // Fresh values are on screen and the conflict banner is gone.
    await expect(page.getByLabel(/internal notes/i)).toHaveValue("B's notes, saved first");
    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toHaveCount(0);

    // Re-apply the change on top of theirs — this must NOT conflict again.
    await page.getByLabel(/internal notes/i).fill("B's notes, saved first + A's addition");
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/changes saved/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toHaveCount(0);
    expect((await rowById("families", IDS.family)).internal_notes).toBe("B's notes, saved first + A's addition");
  });

  test("AC3b: 'Save my version anyway' overwrites and succeeds", async ({ page }) => {
    await signIn(page);
    await openFamilyEdit(page);
    await typeUserAsEdits(page);

    await otherUserUpdates("families", IDS.family, { internal_notes: "B's notes, saved first" });
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toBeVisible();

    await page.getByRole("button", { name: /save my version anyway/i }).click();

    await expect(page.getByText(/changes saved/i)).toBeVisible();
    const family = await rowById("families", IDS.family);
    expect(family.sort_tag).toBe("A-SORT-TAG");
    expect(family.internal_notes).toBe("A's unsaved notes");
    expect((await rowById("children", IDS.childA)).grade).toBe("A-GRADE");
  });

  test("AC-no-phantoms: a normal save succeeds, and two saves in a row both succeed", async ({ page }) => {
    await signIn(page);
    await openFamilyEdit(page);

    await page.getByLabel(/^sort tag$/i).fill("FIRST-SAVE");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/changes saved/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toHaveCount(0);
    expect((await rowById("families", IDS.family)).sort_tag).toBe("FIRST-SAVE");

    // The form re-seeds its baseline on save; a second save must not conflict
    // with the first one's own write.
    await page.getByLabel(/^sort tag$/i).fill("SECOND-SAVE");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/changes saved/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toHaveCount(0);
    expect((await rowById("families", IDS.family)).sort_tag).toBe("SECOND-SAVE");

    // ...and a third, because "it works twice" is where this class of bug hides.
    await page.getByLabel(/^sort tag$/i).fill("THIRD-SAVE");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/changes saved/i)).toBeVisible();
    expect((await rowById("families", IDS.family)).sort_tag).toBe("THIRD-SAVE");
  });

  test("AC2: the updated_at guard is actually sent, with the microseconds and the + intact", async ({ page }) => {
    await signIn(page);
    await openFamilyEdit(page);
    const versionOnLoad = (await rowById("families", IDS.family)).updated_at as string;
    expect(versionOnLoad, "fixture version should carry 6 fractional digits").toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/
    );

    await page.getByLabel(/^sort tag$/i).fill("GUARDED-SAVE");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/changes saved/i)).toBeVisible();

    const reqs = await stubRequests();
    const familyPatch = reqs.find((r) => r.method === "PATCH" && r.table === "families");
    expect(familyPatch, "the family UPDATE should have been sent").toBeTruthy();
    // The literal on-the-wire form: `+` must arrive percent-encoded or PostgREST
    // reads it as a space and the guard silently matches nothing.
    expect(familyPatch!.query).toContain(`updated_at=eq.${encodeURIComponent(versionOnLoad)}`);
    expect(familyPatch!.query).toContain("%2B00%3A00");
    expect(familyPatch!.prefer ?? "").toContain("return=representation");

    const childPatch = reqs.find((r) => r.method === "PATCH" && r.table === "children");
    expect(childPatch!.query).toContain("updated_at=eq.");
    expect(childPatch!.prefer ?? "").toContain("return=representation");
  });

  test("AC-privacy: a family that goes confidential mid-edit gets the generic not-found, never the conflict wording", async ({
    page,
  }) => {
    await resetStub(seedTables(), VIEWER_PLAIN_VOLUNTEER);
    await signIn(page);
    await openFamilyEdit(page);
    await typeUserAsEdits(page);

    // Staff marks the family confidential while this volunteer has it open.
    // It now fails the volunteer's RLS predicate, so their pre-flight read
    // returns nothing.
    await otherUserUpdates("families", IDS.family, { is_confidential: true });

    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(NOT_FOUND_MESSAGE)).toBeVisible();
    // The critical bit: no wording that would confirm the row still exists.
    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /save my version anyway/i })).toHaveCount(0);
    await expect(page.getByText(PARTIAL_SAVE_SENTENCE)).toHaveCount(0);
  });

  test("AC-privacy: a plain volunteer can't reach a confidential family's edit form at all", async ({ page }) => {
    await resetStub(seedTables(), VIEWER_PLAIN_VOLUNTEER);
    await signIn(page);
    await page.goto(`/admin/families/${IDS.confidentialFamily}`);

    await expect(page.getByText(/family not found/i)).toBeVisible();
    await expect(page.getByText("Charlie")).toHaveCount(0);
    await expect(page.getByLabel(/^sort tag$/i)).toHaveCount(0);
  });

  test("double-click on Save doesn't fire two writes", async ({ page }) => {
    await signIn(page);
    await openFamilyEdit(page);
    await page.getByLabel(/^sort tag$/i).fill("DOUBLE-CLICK");

    const save = page.getByRole("button", { name: /save changes/i });
    await save.click({ clickCount: 2, delay: 10 });
    await expect(page.getByText(/changes saved/i)).toBeVisible();

    const patches = (await stubRequests()).filter((r) => r.method === "PATCH" && r.table === "families");
    expect(patches.length, "the in-flight guard should collapse a double-click to one UPDATE").toBe(1);
    await expect(page.getByRole("heading", { name: CONFLICT_HEADING })).toHaveCount(0);
  });
});

test.describe("US-13 regression: AdminGate no longer unmounts the page on refresh()", () => {
  test("search text on the fulfillment board survives a mutation", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/fulfillment");

    await page.getByPlaceholder(/search by child, card, or sponsor/i).fill("Alpha");
    await expect(page.getByRole("button", { name: /mark purchased/i })).toBeVisible();

    await page.getByRole("button", { name: /mark purchased/i }).click();

    // The mutation lands...
    await expect(page.getByRole("button", { name: /mark received/i })).toBeVisible();
    // ...and the filter the user was standing in is still there.
    await expect(page.getByPlaceholder(/search by child, card, or sponsor/i)).toHaveValue("Alpha");
  });

  test("filter state on the families explorer survives a mutation elsewhere in the session", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/families");
    await page.getByPlaceholder(/child, family, card, sponsor/i).fill("Bravo");
    await expect(page.getByPlaceholder(/child, family, card, sponsor/i)).toHaveValue("Bravo");
  });

  test("check-in on the distribution page keeps the search filter", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/distribution");
    await page.getByPlaceholder(/search by family or school/i).fill("Family 1");
    await page.getByRole("button", { name: /^check in$/i }).first().click();
    await expect(page.getByRole("button", { name: /checked in/i }).first()).toBeVisible();
    await expect(page.getByPlaceholder(/search by family or school/i)).toHaveValue("Family 1");
  });
});
