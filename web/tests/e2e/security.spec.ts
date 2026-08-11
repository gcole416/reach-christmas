import { test, expect } from "@playwright/test";
import { signInAs, getOpenDriveId } from "./helpers/testClient";
import { createTestFamily, createTestChild, createTestCard } from "./helpers/factories";
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
