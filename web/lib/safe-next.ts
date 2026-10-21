// Where to send someone after they sign in, from the ?next= the proxy adds
// when it bounces a signed-out visitor to /admin/login (e.g. a help-document
// link in an email). Only same-site staff paths are allowed, so ?next= can't
// be used to send someone to another website after they sign in.
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/admin/") || next.startsWith("//") || next.includes("\\")) return null;
  if (next === "/admin/login" || next.startsWith("/admin/login?")) return null;
  return next;
}
