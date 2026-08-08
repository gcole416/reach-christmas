import type { SupabaseClient } from "@supabase/supabase-js";

// Every row created through these helpers is tagged so cleanup.ts can find
// and remove it without ever touching real data or 'Demo'-tagged seed data.
export const AUTOTEST_SORT_TAG = "AutoTest";
export const AUTOTEST_EMAIL_DOMAIN = "autotest.example.com";

export interface TestFamily {
  id: string;
  family_number: number;
}

/** Goes through the real create_family() RPC — the same path the intake form uses, including its concurrency guarantee. */
export async function createTestFamily(
  client: SupabaseClient,
  opts: { driveId: string; driveSchoolId?: string | null; isConfidential?: boolean }
): Promise<TestFamily> {
  const { data, error } = await client
    .rpc("create_family", {
      p_drive_id: opts.driveId,
      p_drive_school_id: opts.driveSchoolId ?? null,
      p_is_confidential: opts.isConfidential ?? false,
      p_sort_tag: AUTOTEST_SORT_TAG,
      p_internal_notes: null,
    })
    .single();
  if (error || !data) throw new Error(error?.message ?? "create_family returned no row");
  return data as TestFamily;
}

export async function createTestChild(
  client: SupabaseClient,
  familyId: string,
  overrides: Record<string, unknown> = {}
) {
  const { data, error } = await client
    .from("children")
    .insert({
      family_id: familyId,
      child_index: 1,
      first_name: "AutoTest Child",
      target_card_count: 1,
      ...overrides,
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert into children returned no row");
  return data;
}

export async function createTestCard(client: SupabaseClient, childId: string, copyNumber = 1, totalCopies = 1) {
  const { data, error } = await client
    .from("cards")
    .insert({ child_id: childId, copy_number: copyNumber, total_copies: totalCopies })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert into cards returned no row");
  return data;
}
