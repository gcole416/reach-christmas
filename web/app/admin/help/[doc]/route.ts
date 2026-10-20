import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Staff-only helper documents, linked from the header's "i" menu
// (AdminHelpMenu in AdminNav.tsx). The files live in web/help-docs/, outside
// public/, so the only way to reach them is through this route. proxy.ts
// already sends signed-out visitors on /admin/* to the login page; this
// handler checks the session again so the docs stay gated even if the proxy
// is skipped. Only the names listed here can be served (no path from the URL
// ever reaches the filesystem).
const DOCS: Record<string, string> = {
  "counselor-steps": "counselor-steps.pdf",
  "counselor-big-picture": "counselor-big-picture.pdf",
};

export async function GET(_request: Request, { params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const file = Object.hasOwn(DOCS, doc) ? DOCS[doc] : undefined;
  if (!file) return new Response("Not found", { status: 404 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return new Response("Not found", { status: 404 });

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      // Session refresh is the proxy's job; nothing to write back here.
      setAll: () => {},
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in required", { status: 401 });

  const body = await readFile(path.join(process.cwd(), "help-docs", file));
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file}"`,
      // Signed-in staff only: never let a shared cache keep a copy.
      "Cache-Control": "private, no-store",
    },
  });
}
