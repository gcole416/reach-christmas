"use client";

import { usePathname } from "next/navigation";
import { useData } from "@/lib/store";

// Centralizes the "data hasn't loaded / failed to load" states so individual
// admin pages can assume `data` is present. The login page has nothing to do
// with this data, so it renders through regardless of load state.
export function AdminGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, loading, error } = useData();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  if (loading) {
    return <div className="mx-auto max-w-6xl px-6 py-10 text-ink-secondary">Loading…</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-lg bg-status-critical/10 px-4 py-3 text-sm text-ink-primary">{error}</div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return <>{children}</>;
}
