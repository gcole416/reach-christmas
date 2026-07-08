import { createBrowserClient } from "@supabase/ssr";

// For use in Client Components. Safe to call repeatedly — createBrowserClient
// reuses the same underlying connection.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
