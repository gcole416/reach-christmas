import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTOTEST_EMAIL_DOMAIN, AUTOTEST_SORT_TAG } from "./factories";

/**
 * Removes everything the suite created — must be called with an admin
 * client, since deleting families is admin-only (see the RLS policies).
 * Deleting families cascades to children/wishlist_items/cards/assignments
 * automatically; sponsors don't cascade from assignments, so they're cleaned
 * up separately by their distinctive @autotest.example.com email domain.
 * Only ever touches AutoTest-tagged rows — never 'Demo' data, never real data.
 */
export async function cleanupAutoTestData(adminClient: SupabaseClient): Promise<void> {
  const { error: familiesError } = await adminClient.from("families").delete().eq("sort_tag", AUTOTEST_SORT_TAG);
  if (familiesError) throw new Error(`Cleanup failed deleting families: ${familiesError.message}`);

  const { error: sponsorsError } = await adminClient.from("sponsors").delete().like("email", `%@${AUTOTEST_EMAIL_DOMAIN}`);
  if (sponsorsError) throw new Error(`Cleanup failed deleting sponsors: ${sponsorsError.message}`);
}
