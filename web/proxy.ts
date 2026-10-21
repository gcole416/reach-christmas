import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-next";

// Next.js 16 renamed `middleware.ts`/`middleware()` to `proxy.ts`/`proxy()`.
// This refreshes the Supabase auth session cookie on every request and gates
// /admin/* behind a real login (any signed-in staff account — admin-vs-
// volunteer distinctions are enforced by RLS, not here).
export async function proxy(request: NextRequest) {
  // No-op if Supabase credentials aren't configured (see .env.local.example)
  // — avoids every request 500ing on a fresh clone before .env.local exists.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAdminRoute = pathname.startsWith("/admin");
  const isLoginRoute = pathname === "/admin/login";

  if (isAdminRoute && !isLoginRoute && !user) {
    // Remember where they were going (e.g. a help-document link from an
    // email) so the login page can send them there after signing in.
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    const next = safeNextPath(pathname + request.nextUrl.search);
    if (next) url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  if (isLoginRoute && user) {
    const next = safeNextPath(request.nextUrl.searchParams.get("next")) ?? "/admin";
    return NextResponse.redirect(new URL(next, request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
