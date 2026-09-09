"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useData } from "@/lib/store";

type MenuEntry =
  | { href: string; label: string; adminOnly?: boolean }
  | { action: () => void; label: string };
type NavItem =
  | { href: string; label: string }
  | { label: string; items: MenuEntry[] };

// The admin nav, grouped by phase of the drive so it fits on one line without a
// horizontal scrollbar. Every destination that used to be a flat tab still
// exists and still points at the same route - the group menus are the only
// change. "Add a household" is surfaced here too; it also has its own button on
// the Households page.
//
// `adminOnly` entries drop out of the menu for volunteers. Those pages already
// enforce admin-only writes at the database layer (and Staff degrades to
// read-only) - this just stops showing volunteers config they can't act on. A
// group whose every entry is filtered out is hidden entirely.
const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard" },
  {
    label: "Intake",
    items: [
      { href: "/admin/submissions", label: "Registrations" },
      { href: "/admin/families", label: "Households" },
      { href: "/admin/high-schoolers", label: "High schoolers" },
      { href: "/admin/intake", label: "Add a household" },
    ],
  },
  {
    label: "Gifts",
    items: [
      { href: "/admin/fulfillment", label: "Fulfillment" },
      { href: "/admin/shopping-list", label: "Shopping list" },
      { href: "/admin/print", label: "Print cards" },
    ],
  },
  { href: "/admin/distribution", label: "Distribution" },
  {
    label: "Setup",
    items: [
      { href: "/admin/schools", label: "Schools" },
      { href: "/admin/drives", label: "Drives", adminOnly: true },
      { href: "/admin/staff", label: "Staff & permissions", adminOnly: true },
      { href: "/admin/audit", label: "Audit log", adminOnly: true },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

const LINK_BASE =
  "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue";

function Chevron() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="h-3 w-3 text-ink-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavMenu({
  label,
  items,
  align = "left",
  active,
}: {
  label: string;
  items: MenuEntry[];
  align?: "left" | "right";
  active: boolean;
}) {
  const pathname = usePathname();
  // Store the route the menu was opened on rather than a bare boolean: when the
  // pathname changes (a link was followed) the menu falls closed on its own,
  // with no setState-in-effect.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close on click-outside and Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenedAt(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenedAt(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const itemClass = (highlighted: boolean) =>
    `block w-full px-3 py-2 text-left text-sm ${
      highlighted
        ? "font-medium text-ink-primary"
        : "text-ink-secondary hover:bg-background hover:text-ink-primary"
    }`;

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        className={`${LINK_BASE} inline-flex items-center gap-1 ${
          active || open
            ? "border-cat-blue text-ink-primary"
            : "border-transparent text-ink-secondary hover:text-ink-primary"
        }`}
      >
        {label}
        <Chevron />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className={`absolute top-full z-20 mt-1 min-w-[12rem] rounded-lg border border-border bg-surface py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) =>
            "href" in item ? (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                className={itemClass(isActive(pathname, item.href))}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.action();
                }}
                className={itemClass(false)}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { viewerRole } = useData();
  const isAdmin = viewerRole === "admin";

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className="mt-6 mb-8 flex flex-wrap items-stretch gap-y-1 border-b border-border">
      <div className="flex min-w-0 flex-1 flex-wrap items-stretch gap-1">
        {NAV.map((item) => {
          if ("href" in item) {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${LINK_BASE} ${
                  active
                    ? "border-cat-blue text-ink-primary"
                    : "border-transparent text-ink-secondary hover:text-ink-primary"
                }`}
              >
                {item.label}
              </Link>
            );
          }
          const visibleItems = item.items.filter(
            (sub) => !("adminOnly" in sub && sub.adminOnly) || isAdmin,
          );
          if (visibleItems.length === 0) return null;
          const groupActive = visibleItems.some(
            (sub) => "href" in sub && isActive(pathname, sub.href),
          );
          return (
            <NavMenu key={item.label} label={item.label} items={visibleItems} active={groupActive} />
          );
        })}
      </div>
      <NavMenu
        label="Account"
        align="right"
        active={false}
        items={[{ action: handleSignOut, label: "Sign out" }]}
      />
    </div>
  );
}
