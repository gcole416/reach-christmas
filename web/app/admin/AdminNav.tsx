"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useData } from "@/lib/store";

type MenuEntry =
  | { href: string; label: string; adminOnly?: boolean; newTab?: boolean }
  | { action: () => void; label: string };
type NavItem =
  | { href: string; label: string }
  | { label: string; items: MenuEntry[] };

// The admin nav, grouped by phase of the drive and ordered the way the season
// runs, left to right and top to bottom within each menu (Grant, 2026-10-20):
// households come in (Intake), get sponsors (Sponsors), gifts come back and go
// out (Gifts). To-do queues sit next to each other (Registrations, On hold);
// "Add a household" is an action, so it's last. Drives leads Setup because
// everything else hangs off the drive.
//
// It renders once, in the admin shell (AdminGate) directly under the site
// header, so it sits in the same place on every page. Account lives in the
// site header (AdminAccountMenu), which keeps this row to five items and on
// one line at phone width.
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
      { href: "/admin/on-hold", label: "On hold" },
      { href: "/admin/families", label: "Households" },
      { href: "/admin/high-schoolers", label: "High schoolers" },
      { href: "/admin/intake", label: "Add a household" },
    ],
  },
  {
    label: "Sponsors",
    items: [
      { href: "/admin/sponsors", label: "Sponsor roster" },
      { href: "/admin/assign", label: "Assign sponsors" },
      { href: "/admin/print", label: "Print cards" },
    ],
  },
  {
    label: "Gifts",
    items: [
      { href: "/admin/fulfillment", label: "Fulfillment" },
      { href: "/admin/shopping-list", label: "Shopping list" },
      { href: "/admin/distribution", label: "Distribution" },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/admin/drives", label: "Drives", adminOnly: true },
      { href: "/admin/schools", label: "Schools" },
      { href: "/admin/staff", label: "Staff & permissions", adminOnly: true },
      { href: "/admin/audit", label: "Audit log", adminOnly: true },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

const LINK_BASE =
  "-mb-px shrink-0 border-b-2 px-1.5 py-2 text-sm font-medium sm:px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue";

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
  ariaLabel,
  items,
  align = "left",
  active,
  flat = false,
  chevron = true,
}: {
  label: ReactNode;
  /** Required when `label` isn't text (e.g. an icon). */
  ariaLabel?: string;
  items: MenuEntry[];
  align?: "left" | "right";
  active: boolean;
  /** Header style: no tab underline. */
  flat?: boolean;
  chevron?: boolean;
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
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
        className={
          flat
            ? `inline-flex items-center gap-1 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue ${
                active || open ? "text-ink-primary" : "text-ink-secondary hover:text-ink-primary"
              }`
            : `${LINK_BASE} inline-flex items-center gap-1 ${
                active || open
                  ? "border-cat-blue text-ink-primary"
                  : "border-transparent text-ink-secondary hover:text-ink-primary"
              }`
        }
      >
        {label}
        {chevron ? <Chevron /> : null}
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
            "href" in item && item.newTab ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                onClick={() => setOpen(false)}
                className={itemClass(false)}
              >
                {item.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : "href" in item ? (
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
  const { viewerRole } = useData();
  const isAdmin = viewerRole === "admin";

  return (
    <div className="flex flex-wrap items-stretch border-b border-border">
      <div className="flex min-w-0 flex-1 flex-wrap items-stretch sm:gap-1">
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
                {item.href === "/admin" ? (
                  // "Home" at phone width keeps all five items on one line.
                  <>
                    <span className="sm:hidden">Home</span>
                    <span className="hidden sm:inline">{item.label}</span>
                  </>
                ) : (
                  item.label
                )}
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
    </div>
  );
}

/** Account menu for the site header on /admin pages (see SiteHeader). Needs no
 *  admin data, so it works outside the DataProvider. */
export function AdminAccountMenu() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <NavMenu
      label="Account"
      align="right"
      flat
      active={isActive(pathname, "/admin/account")}
      items={[
        { href: "/admin/account", label: "Change password" },
        { action: handleSignOut, label: "Sign out" },
      ]}
    />
  );
}

// Helper documents for staff, each opening in a new tab. They're staff-only:
// the files live in web/help-docs/ (not public/) and are served by
// app/admin/help/[doc]/route.ts behind the login. To add one, drop the file in
// web/help-docs/, register it in that route's DOCS map, and list it here. The
// counselor PDFs are rendered from docs/handouts/ (see the comment at the top
// of each .html source); copy the PDF over after re-rendering.
const HELP_DOCS: MenuEntry[] = [
  { href: "/admin/help/counselor-steps", label: "Counselor steps", newTab: true },
  { href: "/admin/help/counselor-big-picture", label: "Counselor big picture", newTab: true },
];

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="10" cy="10" r="8" />
      <path d="M10 9v5" strokeLinecap="round" />
      <circle cx="10" cy="6.25" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Help-documents menu ("i" icon) for the site header, beside Account. */
export function AdminHelpMenu() {
  return (
    <NavMenu
      label={<InfoIcon />}
      ariaLabel="Help documents"
      align="right"
      flat
      chevron={false}
      active={false}
      items={HELP_DOCS}
    />
  );
}
