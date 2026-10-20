"use client";

import type { ReactNode } from "react";
import { useData } from "@/lib/store";

/**
 * The "you're signed in as a volunteer, so only an admin can ..." banner for
 * pages a volunteer can open but where some actions are admin-only. Pair it
 * with hiding those controls (`viewerRole === "admin"`): a refused admin-only
 * update or delete is silently zero rows in RLS, so a visible button would
 * look like it worked. See lib/permissions.ts.
 *
 * Renders nothing for admins, and nothing until the viewer's role has loaded,
 * so an admin never sees it flash.
 */
export function VolunteerNotice({ children, className = "mb-6" }: { children: ReactNode; className?: string }) {
  const { viewerRole } = useData();
  if (viewerRole !== "volunteer") return null;
  return (
    <div role="note" className={`${className} rounded-lg bg-status-warning/15 px-4 py-3 text-sm text-ink-primary`}>
      {children}
    </div>
  );
}
