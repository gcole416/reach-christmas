import { test, expect } from "@playwright/test";
import { anonClient } from "./helpers/testClient";
import {
  sharedAdmin,
  DEMO_FORM_TOKEN,
  DEMO_REVIEW_TOKEN,
  autotestChildName,
  autotestGuardian,
  cleanupIntakeTestData,
  findSubmissionByGuardian,
  rpcImportSubmission,
  rpcSubmitForm,
  rpcVerifySubmission,
  runTag,
  assertIntakeReady,
} from "./helpers/intake";

// US-36 (docs/backlog.md) — the sponsored-kid / high-schooler split.
//
// These run at the function / view boundary on purpose: "a high schooler never
// enters the sponsor pool" is a claim about the DATABASE (public_available_cards
// is the whole anon boundary — AGENTS.md), not about a screen.
//
// Requires the v3 form definition on dev: `self_shopper_hidden` on the gift
// fields is what lets submit_form skip validating them for a grade-9-12 child.
// Re-run supabase/intake_demo_seed.sql (or publish_intake_form.sql) after
// applying 20260908130000_high_schooler_bucket.sql.

type Json = Record<string, unknown>;

const GUARDIAN_FIELDS = {
  guardian_name: "", // filled per test
  guardian_phone: "555-0100",
  preferred_language: "en",
};

function household(guardian: string, children: Json[]) {
  return {
    family: { ...GUARDIAN_FIELDS, guardian_name: guardian },
    children,
    pickup_consent: { can_reach_church_pickup: "Yes", consent: true },
  };
}

/** A full sponsored (grade <= 8) child answer. */
function sponsoredChild(tag: string, suffix: string, grade: string): Json {
  return {
    first_name: autotestChildName(tag, suffix),
    age: 8,
    grade,
    sex: "Prefer not to say",
    shirt_size: "Youth M",
    pant_size: "Youth 10",
    shoe_size: "Youth 3",
    wishlist: ["a soccer ball"],
  };
}

/** A high schooler answer: first name, age, grade only (what the v3 form collects). */
function highSchoolerChild(tag: string, suffix: string, grade = "10", extra: Json = {}): Json {
  return {
    first_name: autotestChildName(tag, suffix),
    age: 16,
    grade,
    ...extra,
  };
}

async function verifiedSubmission(guardian: string, answers: unknown) {
  const anon = anonClient();
  const submitted = await rpcSubmitForm(anon, { token: DEMO_FORM_TOKEN, answers });
  expect(submitted.error, `submit_form raised: ${submitted.error?.message}`).toBeNull();
  expect(
    (submitted.data as Json).ok,
    `submit_form refused: ${JSON.stringify(submitted.data)}`,
  ).toBe(true);
  const admin = await sharedAdmin();
  const row = await findSubmissionByGuardian(admin, guardian);
  expect(row, "submit_form reported success but wrote no row").not.toBeNull();
  const verified = await rpcVerifySubmission(anon, {
    reviewToken: DEMO_REVIEW_TOKEN,
    submissionId: row!.id,
    verifierName: `AutoTest Counselor ${row!.id.slice(0, 6)}`,
  });
  expect((verified.data as Json).ok, `verify refused: ${JSON.stringify(verified.data)}`).toBe(true);
  return row!;
}

test.describe("high schooler split (US-36)", () => {
  test.beforeAll(async () => {
    await assertIntakeReady();
  });

  test.afterAll(async () => {
    const admin = await sharedAdmin();
    await cleanupIntakeTestData(admin);
  });

  test("mixed household imports one family; the teen is flagged and card-muted", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const admin = await sharedAdmin();

    const submission = await verifiedSubmission(
      guardian,
      household(guardian, [
        sponsoredChild(tag, "Kid", "3"),
        highSchoolerChild(tag, "Teen", "10"),
      ]),
    );

    const imported = await rpcImportSubmission(admin, submission.id);
    expect(imported.error).toBeNull();
    expect((imported.data as Json).ok, JSON.stringify(imported.data)).toBe(true);
    expect((imported.data as Json).children_created).toBe(2);
    const familyId = (imported.data as Json).family_id as string;

    const { data: kids } = await admin
      .from("children")
      .select("id, first_name, grade, is_high_schooler, shirt_size")
      .eq("family_id", familyId)
      .order("child_index");
    expect(kids).toHaveLength(2);

    const teen = (kids as Json[]).find((k) => (k.grade as string) === "10")!;
    const kid = (kids as Json[]).find((k) => (k.grade as string) === "3")!;

    expect(teen.is_high_schooler, "grade-10 child not flagged").toBe(true);
    expect(kid.is_high_schooler, "grade-3 child wrongly flagged").toBe(false);

    // The teen has a card row (schema simplicity) but no wishlist.
    const { count: teenWishlist } = await admin
      .from("wishlist_items")
      .select("id", { count: "exact", head: true })
      .eq("child_id", teen.id as string);
    expect(teenWishlist, "a high schooler was given wishlist rows").toBe(0);

    const { count: kidWishlist } = await admin
      .from("wishlist_items")
      .select("id", { count: "exact", head: true })
      .eq("child_id", kid.id as string);
    expect(kidWishlist, "the sponsored child lost their wishlist").toBeGreaterThan(0);
  });

  test("public_available_cards (as anon) excludes the teen, keeps the sponsored child", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const admin = await sharedAdmin();

    const submission = await verifiedSubmission(
      guardian,
      household(guardian, [
        sponsoredChild(tag, "Pool", "4"),
        highSchoolerChild(tag, "NotPool", "11"),
      ]),
    );
    const imported = await rpcImportSubmission(admin, submission.id);
    expect((imported.data as Json).ok).toBe(true);

    // NOTE: only visible on /sponsor if the drive is `open`. The demo seed's
    // drive is open; if this ever fails with 0 rows for BOTH names, check that.
    const anon = anonClient();
    const { data: cards, error } = await anon
      .from("public_available_cards")
      .select("first_name, grade")
      .ilike("first_name", `Zzautotest${tag}%`);
    expect(error).toBeNull();

    const names = (cards ?? []).map((c) => (c as Json).first_name as string);
    expect(names.some((n) => n.includes("Pool") && !n.includes("NotPool")), "sponsored child missing from the pool").toBe(true);
    expect(names.some((n) => n.includes("NotPool")), "high schooler leaked into the sponsor pool").toBe(false);
  });

  test("submit_form does not require gift fields for a grade-9-12 child", async () => {
    const tag = runTag();
    const anon = anonClient();

    // grade-10 child with NO wishlist / sizes / sex -> accepted
    const ok = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: household(autotestGuardian(`${tag}a`), [highSchoolerChild(tag, "Bare", "10")]),
    });
    expect(ok.error).toBeNull();
    expect((ok.data as Json).ok, `grade-10 bare submission refused: ${JSON.stringify(ok.data)}`).toBe(true);

    // grade-8 child with NO wishlist -> still rejected
    const rejected = await rpcSubmitForm(anon, {
      token: DEMO_FORM_TOKEN,
      answers: household(autotestGuardian(`${tag}b`), [
        {
          first_name: autotestChildName(tag, "MiddleNoWish"),
          age: 13,
          grade: "8",
          sex: "Prefer not to say",
          shirt_size: "Youth M",
          pant_size: "Youth 10",
          shoe_size: "Youth 3",
        },
      ]),
    });
    expect(rejected.error).toBeNull();
    expect((rejected.data as Json).ok, "grade-8 child with no wishlist was accepted").toBe(false);
    expect(JSON.stringify((rejected.data as Json).errors)).toMatch(/wishlist|idea/i);
  });

  test("junk in a hidden field for a grade-9-12 child validates, then is dropped at import", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const admin = await sharedAdmin();

    const submission = await verifiedSubmission(
      guardian,
      household(guardian, [
        // wishlist present but the child self-shops; server must ignore it
        highSchoolerChild(tag, "Junk", "12", { wishlist: ["x".repeat(900)], shirt_size: "Adult XXL" }),
      ]),
    );

    const imported = await rpcImportSubmission(admin, submission.id);
    expect((imported.data as Json).ok, JSON.stringify(imported.data)).toBe(true);
    const familyId = (imported.data as Json).family_id as string;

    const { data: kids } = await admin
      .from("children")
      .select("id, is_high_schooler")
      .eq("family_id", familyId);
    expect(kids).toHaveLength(1);
    const teen = (kids as Json[])[0];
    expect(teen.is_high_schooler).toBe(true);

    const { count } = await admin
      .from("wishlist_items")
      .select("id", { count: "exact", head: true })
      .eq("child_id", teen.id as string);
    expect(count, "a hidden-field wishlist survived import for a high schooler").toBe(0);
  });

  test("the public form hides the gift fields when a child's grade is 9-12", async ({ page }) => {
    await page.goto(`/form/${DEMO_FORM_TOKEN}`);
    await expect(
      page.getByRole("heading", { name: /reach christmas gift registration/i }),
    ).toBeVisible();

    const child = page.getByRole("group", { name: /child 1/i });
    // The wishlist renders as a <fieldset><legend>; the sizes as <label> + <select>.
    await expect(child.getByText(/what would they like for christmas/i)).toBeVisible();
    await expect(child.getByLabel("Shirt size")).toBeVisible();

    await child.getByLabel("Grade").selectOption("10");

    await expect(child.getByText(/what would they like for christmas/i)).toHaveCount(0);
    await expect(child.getByLabel("Shirt size")).toHaveCount(0);
    await expect(child.getByText(/shops for their own gifts/i)).toBeVisible();

    // Switching back restores the fields.
    await child.getByLabel("Grade").selectOption("3");
    await expect(child.getByText(/what would they like for christmas/i)).toBeVisible();
    await expect(child.getByLabel("Shirt size")).toBeVisible();
  });

  test("a hand-inserted grade-11 child is auto-classified by the trigger", async () => {
    const tag = runTag();
    const guardian = autotestGuardian(tag);
    const admin = await sharedAdmin();

    // Reuse the intake path: import a sponsored child so we have a family,
    // then insert a grade-11 child directly and check the trigger fired.
    const submission = await verifiedSubmission(
      guardian,
      household(guardian, [sponsoredChild(tag, "Base", "5")]),
    );
    const imported = await rpcImportSubmission(admin, submission.id);
    const familyId = (imported.data as Json).family_id as string;

    const { data: inserted, error } = await admin
      .from("children")
      .insert({
        family_id: familyId,
        child_index: 99,
        first_name: autotestChildName(tag, "HandTeen"),
        grade: "11",
        age: 17,
        // deliberately NOT sending is_high_schooler
      })
      .select("id, is_high_schooler")
      .single();
    expect(error).toBeNull();
    expect((inserted as Json).is_high_schooler, "INSERT trigger did not classify a grade-11 child").toBe(true);

    await admin.from("children").delete().eq("id", (inserted as Json).id as string);
  });
});
