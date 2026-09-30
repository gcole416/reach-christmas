import { test, expect } from "@playwright/test";
import { anonClient } from "./helpers/testClient";
import {
  sharedAdmin,
  sharedVolunteer,
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

// US-38 (docs/backlog.md) — "put a child on hold for duplicate review".
//
// PENDING A LIVE MIGRATION: these run only once
// supabase/migrations/20260909120000_child_on_hold.sql is applied to dev
// (thvyntrxmahygesltgft). Until then set_child_hold / release_child_hold don't
// exist and every test here fails at the first rpc call — that's the intended
// loud signal, same convention as the intake suite's assertIntakeReady().
//
// Boundary under test is the DATABASE, not a screen: "a held child's card
// leaves the sponsor pool and the print run" is a claim about
// public_available_cards (the whole anon boundary — AGENTS.md) and
// printable_cards, and "only an admin can hold" is a claim about the function's
// own is_admin() check. The /admin/on-hold page, the explorer badge and the
// per-child control are a frontend follow-up; a page-level assertion is added
// with them.

type Json = Record<string, unknown>;

const GUARDIAN_FIELDS = {
  guardian_name: "",
  guardian_phone: "555-0100",
  guardian_email: "autotest@demo.example.com", // required as of form v3 (US-39)
  preferred_language: "en",
};

function household(guardian: string, children: Json[]) {
  return {
    family: { ...GUARDIAN_FIELDS, guardian_name: guardian },
    children,
    pickup_consent: { consent: true },
  };
}

function sponsoredChild(tag: string, suffix: string, grade = "3"): Json {
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

/** Submit + counselor-verify a household, returning the submission row. */
async function verifiedSubmission(guardian: string, answers: unknown) {
  const anon = anonClient();
  const submitted = await rpcSubmitForm(anon, { token: DEMO_FORM_TOKEN, answers });
  expect(submitted.error, `submit_form raised: ${submitted.error?.message}`).toBeNull();
  expect((submitted.data as Json).ok, `submit_form refused: ${JSON.stringify(submitted.data)}`).toBe(true);

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

/** Import one sponsored child and return its ids. */
async function importedSponsoredChild(tag: string, suffix: string) {
  const guardian = autotestGuardian(tag);
  const admin = await sharedAdmin();

  const submission = await verifiedSubmission(
    guardian,
    household(guardian, [sponsoredChild(tag, suffix)]),
  );
  const imported = await rpcImportSubmission(admin, submission.id);
  expect(imported.error).toBeNull();
  expect((imported.data as Json).ok, JSON.stringify(imported.data)).toBe(true);
  const familyId = (imported.data as Json).family_id as string;

  const { data: child, error } = await admin
    .from("children")
    .select("id, first_name")
    .eq("family_id", familyId)
    .single();
  expect(error).toBeNull();

  const { data: card } = await admin
    .from("cards")
    .select("id")
    .eq("child_id", (child as Json).id as string)
    .single();

  return {
    familyId,
    childId: (child as Json).id as string,
    firstName: (child as Json).first_name as string,
    cardId: (card as Json).id as string,
  };
}

async function anonPoolNames(tag: string): Promise<string[]> {
  const anon = anonClient();
  const { data, error } = await anon
    .from("public_available_cards")
    .select("card_id, first_name")
    .ilike("first_name", `Zzautotest${tag}%`);
  expect(error).toBeNull();
  return (data ?? []).map((r) => (r as Json).first_name as string);
}

test.describe("child on hold for duplicate review (US-38)", () => {
  test.beforeAll(async () => {
    await assertIntakeReady();
  });

  test.afterAll(async () => {
    const admin = await sharedAdmin();
    await cleanupIntakeTestData(admin);
  });

  test("hold removes the card from the sponsor pool and print run; release restores it", async () => {
    const tag = runTag();
    const admin = await sharedAdmin();
    const { childId, firstName, cardId } = await importedSponsoredChild(tag, "Hold");

    // Baseline: visible to anon, and in the print run.
    expect(await anonPoolNames(tag), "sponsored child missing from the pool before hold").toContain(firstName);
    {
      const { data } = await admin.from("printable_cards").select("card_id").eq("card_id", cardId);
      expect((data ?? []).length, "card missing from printable_cards before hold").toBe(1);
    }

    // Hold it.
    const held = await admin.rpc("set_child_hold", { p_child_id: childId, p_reason: `dup of OL9 (${tag})` });
    expect(held.error, `set_child_hold raised: ${held.error?.message}`).toBeNull();

    // Gone from public_available_cards — by first_name AND by card_id.
    {
      const anon = anonClient();
      const { data: byId } = await anon.from("public_available_cards").select("card_id").eq("card_id", cardId);
      expect((byId ?? []).length, "held card still in the anon pool by card_id").toBe(0);
      expect(await anonPoolNames(tag), "held child still in the anon pool by first_name").not.toContain(firstName);
    }
    // Gone from printable_cards.
    {
      const { data } = await admin.from("printable_cards").select("card_id").eq("card_id", cardId);
      expect((data ?? []).length, "held card still in printable_cards").toBe(0);
    }
    // Present in the /admin/on-hold data source (children where held_at is set).
    {
      const { data } = await admin
        .from("children")
        .select("id, held_at, held_by, hold_reason")
        .eq("id", childId)
        .single();
      expect((data as Json).held_at, "held_at not stamped").not.toBeNull();
      expect((data as Json).held_by, "held_by not stamped with the acting admin").not.toBeNull();
      expect((data as Json).hold_reason).toBe(`dup of OL9 (${tag})`);
    }

    // Release it.
    const released = await admin.rpc("release_child_hold", { p_child_id: childId });
    expect(released.error, `release_child_hold raised: ${released.error?.message}`).toBeNull();

    expect(await anonPoolNames(tag), "released child not back in the anon pool").toContain(firstName);
    {
      const { data } = await admin.from("printable_cards").select("card_id").eq("card_id", cardId);
      expect((data ?? []).length, "released card not back in printable_cards").toBe(1);
    }
    {
      const { data } = await admin.from("children").select("held_at, hold_reason").eq("id", childId).single();
      expect((data as Json).held_at, "held_at not cleared on release").toBeNull();
      expect((data as Json).hold_reason, "hold_reason not cleared on release").toBeNull();
    }
  });

  test("a non-admin cannot call set_child_hold", async () => {
    const tag = runTag();
    const { childId } = await importedSponsoredChild(tag, "VolBlocked");

    const volunteer = await sharedVolunteer();
    const attempt = await volunteer.rpc("set_child_hold", { p_child_id: childId, p_reason: "should fail" });
    expect(attempt.error, "set_child_hold did NOT refuse a volunteer").not.toBeNull();
    expect(attempt.error?.message ?? "").toMatch(/administrator/i);

    // And the child is untouched.
    const admin = await sharedAdmin();
    const { data } = await admin.from("children").select("held_at").eq("id", childId).single();
    expect((data as Json).held_at, "a volunteer's blocked call still stamped held_at").toBeNull();
  });

  test("set_child_hold refuses, naming the sponsor, when the card is still claimed", async () => {
    const tag = runTag();
    const admin = await sharedAdmin();
    const { childId, cardId } = await importedSponsoredChild(tag, "Claimed");

    const { data: sponsor } = await admin
      .from("sponsors")
      .insert({ name: `AutoTest Sponsor ${tag}` })
      .select("id")
      .single();
    await admin.from("assignments").insert({
      card_id: cardId,
      sponsor_id: (sponsor as Json).id as string,
      status: "pledged",
      claimed_at: new Date().toISOString(),
    });

    const attempt = await admin.rpc("set_child_hold", { p_child_id: childId, p_reason: "x" });
    expect(attempt.error, "set_child_hold succeeded on a claimed card").not.toBeNull();
    expect(attempt.error?.message ?? "").toMatch(new RegExp(`claimed by AutoTest Sponsor ${tag}`, "i"));

    // Cleanup: cancel + drop the assignment and sponsor so afterAll's
    // family delete cascade isn't blocked.
    await admin.from("assignments").delete().eq("card_id", cardId);
    await admin.from("sponsors").delete().eq("id", (sponsor as Json).id as string);
  });
});
