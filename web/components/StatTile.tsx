export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-sm text-ink-secondary">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-ink-primary">{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-muted">{hint}</div> : null}
    </div>
  );
}
