import Link from "next/link";

export function StatTile({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  /** When set, the whole tile becomes a link with a hover/focus affordance. */
  href?: string;
}) {
  const inner = (
    <>
      <div className="text-sm text-ink-secondary">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-ink-primary">{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-muted">{hint}</div> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-cat-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
      >
        {inner}
      </Link>
    );
  }

  return <div className="rounded-xl border border-border bg-surface p-4">{inner}</div>;
}
