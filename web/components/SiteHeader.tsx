"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteHeader() {
  const pathname = usePathname();
  // Inside the staff area the AdminNav already carries a Dashboard tab, so the
  // top-level "Staff dashboard" link here is just noise.
  const inAdmin = pathname.startsWith("/admin");

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold text-ink-primary">
          Reach Christmas
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-ink-secondary">
          <Link href="/sponsor" className="hover:text-ink-primary">
            Sponsor a child
          </Link>
          {!inAdmin ? (
            <Link href="/admin" className="hover:text-ink-primary">
              Staff dashboard
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
