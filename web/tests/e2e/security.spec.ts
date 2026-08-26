import { test, expect } from "@playwright/test";
import { signInAs, getOpenDriveId, anonClient } from "./helpers/testClient";
import { createTestFamily, createTestChild, createTestCard, AUTOTEST_EMAIL_DOMAIN } from "./helpers/factories";
import { cleanupAutoTestData } from "./helpers/cleanup";

// These exercise the actual RLS policies and triggers directly (not just
// what the UI happens to show/hide) — the same boundary a bug in the
// frontend could never bypass, per DESIGN.md's "enforce at the database
// layer" principle.
test.describe("security & RLS boundaries", () => {
  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupAutoTestData(admin);
  });

  test("a volunteer can create a confidential family and still see their own submission", async () => {
    const volunteer = await signInAs("volunteer");
    const driveId = await getOpenDriveId(volunteer);

    const family = await createTestFamily(volunteer, { driveId, isConfidential: true });
    const { data, error } = await volunteer.from("families").select("id").eq("id", family.id).maybeSingle();

    expect(error).toBeNull();
    expect(data?.id).toBe(family.id);
  });

  test("a volunteer cannot see a confidential family created by someone else", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId, isConfidential: true });

    const volunteer = await signInAs("volunteer");
    const { data, error } = await volunteer.from("families").select("id").eq("id", family.id).maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull(); // RLS excludes the row silently, not an error
  });

  // GitLab issue #19: "staff read children"/"staff read cards" gated
  // confidentiality via a subquery back to `families`, which is itself
  // subject to `families`' own RLS — so for a family the volunteer can't see
  // directly, the subquery found nothing, `not exists(...)` evaluated to
  // true, and the child/card leaked through anyway. The family row itself
  // stayed correctly hidden (covered by the test above); only its
  // children/cards did not. Fixed by 20260811120000_fix_confidential_rls_subquery_leak.sql,
  // which resolves confidentiality via security-definer helpers instead of a
  // subquery subject to the caller's own RLS. These two assertions describe
  // the CORRECT (secure) behavior, so until that migration is applied to
  // this project they are expected to fail red, proving the leak is real —
  // they should pass green once it's applied.
  test("a volunteer cannot see a child belonging to a confidential family created by someone else (issue #19)", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId, isConfidential: true });
    const child = await createTestChild(admin, family.id);

    const volunteer = await signInAs("volunteer");
    const { data, error } = await volunteer.from("children").select("id").eq("id", child.id).maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull(); // RLS should exclude the confidential family's children too, not just the family row
  });

  test("a volunteer cannot see a card belonging to a confidential family created by someone else (issue #19)", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId, isConfidential: true });
    const child = await createTestChild(admin, family.id);
    const card = await createTestCard(admin, child.id);

    const volunteer = await signInAs("volunteer");
    const { data, error } = await volunteer.from("cards").select("id").eq("id", card.id).maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull(); // same bug, one join further out via child_id -> family_id
  });

  // Same root cause as issue #19, found while chasing why the two tests above
  // were failing in the dev project even in isolation: create_family()'s
  // confidential-numbering branch did `select coalesce(max(family_number), 0)
  // + 1 from families where ... and is_confidential`, subject to the CALLER's
  // own RLS on `families` (create_family is security invoker). A caller who
  // can't see an already-existing confidential family in this drive (not
  // cleared, not its creator) computed a number that family already has, and
  // the insert failed with a families_number_confidential unique-constraint
  // violation instead of succeeding with the next real number. Fixed
  // alongside the read/update policies above by routing that one count
  // through a security-definer helper (next_confidential_family_number)
  // instead of a caller-RLS-subject SELECT — create_family() itself stays
  // security invoker, only that read bypasses RLS.
  test("create_family gives a volunteer the correct next confidential number even when they can't see an earlier one (issue #19, same root cause)", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    // Created by admin — the volunteer below has no clearance and didn't
    // create this one, so it's invisible to them under `families`' own RLS.
    const invisibleToVolunteer = await createTestFamily(admin, { driveId, isConfidential: true });

    const volunteer = await signInAs("volunteer");
    const ownFamily = await createTestFamily(volunteer, { driveId, isConfidential: true });

    expect(ownFamily.family_number).not.toBe(invisibleToVolunteer.family_number);
  });

  test("a volunteer cannot promote themselves to admin", async () => {
    const volunteer = await signInAs("volunteer");
    const { data: userData, error: userError } = await volunteer.auth.getUser();
    expect(userError).toBeNull();

    const { error } = await volunteer.from("profiles").update({ role: "admin" }).eq("id", userData.user!.id);

    expect(error).not.toBeNull();
  });

  test("a volunteer cannot create a drive", async () => {
    const volunteer = await signInAs("volunteer");
    const { error } = await volunteer
      .from("drives")
      .insert({ year: 2999, name: "AutoTest rejected drive", status: "draft" });

    expect(error).not.toBeNull();
  });

  test("only one drive can be open at a time", async () => {
    const admin = await signInAs("admin");
    let createdId: string | null = null;

    try {
      const { data: created, error: createError } = await admin
        .from("drives")
        .insert({ year: 2998, name: "AutoTest second drive", status: "draft" })
        .select("id")
        .single();
      expect(createError).toBeNull();
      createdId = created!.id;

      const { error: openError } = await admin.from("drives").update({ status: "open" }).eq("id", createdId);
      expect(openError).not.toBeNull();
    } finally {
      if (createdId) {
        await admin.from("drives").delete().eq("id", createdId);
      }
    }
  });
});

// SPN-3 (docs/OPEN_QUESTIONS.md): claim_card's anon/authenticated execute
// grant was revoked in supabase/migrations/20260818160000_email_verified_claims.sql
// and replaced by request_claim_code + claim_card_with_code. These tests
// exercise as much of that boundary as is reachable WITHOUT a Resend API key
// configured in dev Vault (see that migration's header comment) — everything
// that happens before request_claim_code's vault lookup is fully testable
// today; everything that requires a real emailed code is not (there is no
// sanctioned way to read/insert into card_claim_verifications directly — see
// concurrency.spec.ts's comment on the same limitation).
test.describe("SPN-3: email-verified claim RPC boundary", () => {
  test.afterAll(async () => {
    const admin = await signInAs("admin");
    await cleanupAutoTestData(admin);
  });

  test("the legacy claim_card RPC is no longer directly callable by an anonymous visitor", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    const child = await createTestChild(admin, family.id);
    const card = await createTestCard(admin, child.id);

    const { error } = await anonClient().rpc("claim_card", {
      p_card_id: card.id,
      p_sponsor_name: "AutoTest Direct Claim",
      p_sponsor_email: `direct-${Date.now()}@${AUTOTEST_EMAIL_DOMAIN}`,
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/permission denied/i);
  });

  test("request_claim_code still enforces the already-claimed guard, without needing email delivery configured", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    const child = await createTestChild(admin, family.id);
    const card = await createTestCard(admin, child.id);
    // Claim it directly at the data layer (bypassing the anon RPC boundary,
    // same as claim_card_with_code would have done) so this test doesn't
    // itself depend on the code-confirmation step being reachable.
    const { data: sponsor } = await admin
      .from("sponsors")
      .insert({ name: "AutoTest Already Claimed", email: `already-${Date.now()}@${AUTOTEST_EMAIL_DOMAIN}` })
      .select("id")
      .single();
    await admin.from("assignments").insert({ card_id: card.id, sponsor_id: sponsor!.id, status: "pledged" });

    const { error } = await anonClient().rpc("request_claim_code", {
      p_card_id: card.id,
      p_sponsor_name: "AutoTest Second Sponsor",
      p_sponsor_email: `second-${Date.now()}@${AUTOTEST_EMAIL_DOMAIN}`,
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/already been claimed/i);
  });

  test("request_claim_code still enforces the confidential-family guard, without needing email delivery configured", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId, isConfidential: true });
    const child = await createTestChild(admin, family.id);
    const card = await createTestCard(admin, child.id);

    const { error } = await anonClient().rpc("request_claim_code", {
      p_card_id: card.id,
      p_sponsor_name: "AutoTest Confidential Attempt",
      p_sponsor_email: `confidential-${Date.now()}@${AUTOTEST_EMAIL_DOMAIN}`,
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/not available for public claiming/i);
  });

  test("request_claim_code requires a non-blank sponsor name and email", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    const child = await createTestChild(admin, family.id);
    const card = await createTestCard(admin, child.id);

    const { error: noName } = await anonClient().rpc("request_claim_code", {
      p_card_id: card.id,
      p_sponsor_name: "   ",
      p_sponsor_email: `blank-name-${Date.now()}@${AUTOTEST_EMAIL_DOMAIN}`,
    });
    expect(noName).not.toBeNull();
    expect(noName?.message ?? "").toMatch(/name is required/i);

    const { error: noEmail } = await anonClient().rpc("request_claim_code", {
      p_card_id: card.id,
      p_sponsor_name: "AutoTest No Email",
      p_sponsor_email: "  ",
    });
    expect(noEmail).not.toBeNull();
    expect(noEmail?.message ?? "").toMatch(/email is required/i);
  });

  // Reachable today WITHOUT the Resend key: this checks claim_card_with_code
  // against a card that has no pending card_claim_verifications row at all
  // (nobody ever successfully requested a code for it), which is a normal
  // `{ ok: false, error }` jsonb payload, not a thrown Postgres error.
  test("claim_card_with_code returns a normal ok:false payload, not a thrown error, when there's no pending verification", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    const child = await createTestChild(admin, family.id);
    const card = await createTestCard(admin, child.id);

    const { data, error } = await anonClient().rpc("claim_card_with_code", {
      p_card_id: card.id,
      p_code: "123456",
    });

    expect(error, "the four expected/retryable failure reasons must not raise").toBeNull();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/no pending verification/i);
  });

  // Regression test for the NULL-code bypass bug described in the migration:
  // crypt(NULL, ...) is NULL, `code_hash <> NULL` is NULL, and `if NULL` is
  // falsy in PL/pgSQL, so without the explicit guard a blank/NULL code fell
  // through the wrong-code branch untested and could reach the success path.
  test("claim_card_with_code rejects a blank code rather than treating it as a match", async () => {
    const admin = await signInAs("admin");
    const driveId = await getOpenDriveId(admin);
    const family = await createTestFamily(admin, { driveId });
    const child = await createTestChild(admin, family.id);
    const card = await createTestCard(admin, child.id);

    const { data, error } = await anonClient().rpc("claim_card_with_code", {
      p_card_id: card.id,
      p_code: "",
    });

    expect(error).toBeNull();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/doesn't match|no pending verification/i);
  });
});
