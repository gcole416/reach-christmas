"use client";

import { usePathname } from "next/navigation";
import { useData } from "@/lib/store";
import { AdminNav } from "./AdminNav";

// Centralizes the "data hasn't loaded / failed to load" states so individual
// admin pages can assume `data` is present. The login page has nothing to do
// with this data, so it renders through regardless of load state.
export function AdminGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, loading, error } = useData();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  // Only take the page over while there is genuinely nothing to show. Every
  // mutation in the store ends with a refresh(), which flips `loading` back on
  // — swapping the page out for this placeholder each time would unmount
  // whatever form the user is standing in and silently discard everything they
  // had typed, which is exactly what the family edit page (US-13) must not do.
  // Pages can still assume `data` is present: the !data guard below stands.
  if (loading && !data) {
    return <div className="mx-auto max-w-7xl px-6 py-10 text-ink-secondary">Loading…</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="rounded-lg bg-status-critical/10 px-4 py-3 text-sm text-ink-primary">{error}</div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  // The nav renders here, once, directly under the site header, so it's in the
  // same place on every page instead of wherever each page's header ends.
  return (
    <>
      <div className="mx-auto max-w-7xl px-6 pt-3">
        <AdminNav />
      </div>
      {children}
    </>
  );
}
