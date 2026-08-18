import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTOTEST_EMAIL_DOMAIN } from "./factories";

/**
 * Removes everything the suite created — must be called with an admin
 * client, since deleting families is admin-only (see the RLS policies).
 * Deleting families cascades to children/wishlist_items/cards/assignments
 * automatically; sponsors don't cascade from assignments, so they're cleaned
 * up separately by their distinctive @autotest.example.com email domain.
 * Only ever touches is_autotest_data rows — never demo-seeded (is_test_data
 * but not is_autotest_data) or real data.
 */
export async function cleanupAutoTestData(adminClient: SupabaseClient): Promise<void> {
  const { error: familiesError } = await adminClient.from("families").delete().eq("is_autotest_data", true);
  if (familiesError) throw new Error(`Cleanup failed deleting families: ${familiesError.message}`);

  const { error: sponsorsError } = await adminClient.from("sponsors").delete().like("email", `%@${AUTOTEST_EMAIL_DOMAIN}`);
  if (sponsorsError) throw new Error(`Cleanup failed deleting sponsors: ${sponsorsError.message}`);
}
