import Link from "next/link";
import type { ReactNode } from "react";

// The standard header band for every /admin page: an optional back link, the
// title, one block of description text, and an optional action on the right.
// The nav is NOT here: it renders once in the admin shell (AdminGate), above
// every page, so it never moves with the length of a page's description.
export function AdminPageHeader({
  title,
  description,
  action,
  backLink,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  backLink?: { href: string; label: string };
}) {
  return (
    <div className="mb-8">
      {backLink ? (
        <Link
          href={backLink.href}
          className="text-sm font-medium text-ink-secondary hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
        >
          ← {backLink.label}
        </Link>
      ) : null}
      <div
        className={`flex flex-wrap items-start justify-between gap-x-6 gap-y-3 ${
          backLink ? "mt-2" : ""
        }`}
      >
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold text-ink-primary">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-ink-secondary">{description}</p>
          ) : null}
        </div>
        {action ? <div className="max-w-full">{action}</div> : null}
      </div>
    </div>
  );
}
