import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// For use in Server Components, Server Actions, and Route Handlers. Reads
// the current request's cookies to know who's logged in; can only set
// cookies from a Server Action or Route Handler (not a Server Component —
// the proxy below handles session refresh in the general case).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component with no writable response —
            // fine as long as the proxy (proxy.ts) is refreshing sessions.
          }
        },
      },
    }
  );
}
