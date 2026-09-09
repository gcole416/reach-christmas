"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const TABS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/families", label: "Households" },
  { href: "/admin/high-schoolers", label: "High schoolers" },
  { href: "/admin/submissions", label: "Registrations" },
  { href: "/admin/fulfillment", label: "Fulfillment" },
  { href: "/admin/shopping-list", label: "Shopping list" },
  { href: "/admin/print", label: "Print" },
  { href: "/admin/distribution", label: "Distribution" },
  { href: "/admin/schools", label: "Schools" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/drives", label: "Drives" },
  { href: "/admin/audit", label: "Audit" },
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
    <div className="mt-6 mb-8 flex items-stretch border-b border-border">
      <div className="flex min-w-0 flex-1 flex-nowrap gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const active = tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
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
      <button
        onClick={handleSignOut}
        className="-mb-px shrink-0 border-b-2 border-l border-b-transparent border-l-border py-2 pl-4 text-sm font-medium text-ink-secondary hover:text-ink-primary"
      >
        Sign out
      </button>
    </div>
  );
}
