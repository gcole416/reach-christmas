import { test, expect } from "@playwright/test";
import { signInAs, getOpenDriveId } from "./helpers/testClient";
import { createTestFamily } from "./helpers/factories";
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
