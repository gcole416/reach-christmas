"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminAccountMenu, AdminHelpMenu } from "@/app/admin/AdminNav";

export function SiteHeader() {
  const pathname = usePathname();
  const inAdmin = pathname.startsWith("/admin");
  const signedInAdmin = inAdmin && pathname !== "/admin/login";

  // Staff pages: the header is just the name, the help-documents ("i") menu
  // and the Account menu, at the admin shell's width so it lines up with the
  // nav below it. The public
  // "Sponsor a child" link is for sponsors, not staff, so it's left off here.
  return (
    <header className="border-b border-border bg-surface">
      <div
        className={`mx-auto flex items-center justify-between px-6 py-4 ${
          inAdmin ? "max-w-7xl" : "max-w-6xl"
        }`}
      >
        <Link href={inAdmin ? "/admin" : "/"} className="text-lg font-semibold text-ink-primary">
          Reach Christmas
        </Link>
        {signedInAdmin ? (
          <div className="flex items-center gap-4">
            <AdminHelpMenu />
            <AdminAccountMenu />
          </div>
        ) : inAdmin ? null : (
          <nav className="flex items-center gap-6 text-sm font-medium text-ink-secondary">
            <Link href="/sponsor" className="hover:text-ink-primary">
              Sponsor a child
            </Link>
            <Link href="/admin" className="hover:text-ink-primary">
              Staff dashboard
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
