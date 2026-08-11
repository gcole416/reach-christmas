"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const TABS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/schools", label: "Schools" },
  { href: "/admin/volunteers", label: "Volunteers" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className="mb-8 flex items-center justify-between border-b border-border">
      <div className="flex gap-1">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                active
                  ? "border-cat-blue text-ink-primary"
                  : "border-transparent text-ink-secondary hover:text-ink-primary"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <button onClick={handleSignOut} className="mb-2 text-sm font-medium text-ink-secondary hover:text-ink-primary">
        Sign out
      </button>
    </div>
  );
}
