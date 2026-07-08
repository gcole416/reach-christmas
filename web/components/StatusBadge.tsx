import type { AssignmentStatus } from "@/lib/types";

export type Status = AssignmentStatus | "unclaimed";

const STATUS_CONFIG: Record<Status, { label: string; dot: string; bg: string }> = {
  unclaimed: { label: "Needs a sponsor", dot: "bg-ink-muted", bg: "bg-ink-muted/10" },
  pledged: { label: "Pledged", dot: "bg-cat-blue", bg: "bg-cat-blue/10" },
  purchased: { label: "Purchased", dot: "bg-cat-violet", bg: "bg-cat-violet/10" },
  received_at_church: { label: "Received at church", dot: "bg-cat-aqua", bg: "bg-cat-aqua/10" },
  delivered: { label: "Delivered", dot: "bg-status-good", bg: "bg-status-good/10" },
  cancelled: { label: "Cancelled", dot: "bg-ink-muted", bg: "bg-ink-muted/10" },
};

export const STATUS_OPTIONS: { value: Status; label: string }[] = (
  Object.keys(STATUS_CONFIG) as Status[]
).map((value) => ({ value, label: STATUS_CONFIG[value].label }));

export function StatusBadge({ status }: { status: Status }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium text-ink-primary ${config.bg}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${config.dot}`} aria-hidden="true" />
      {config.label}
    </span>
  );
}

export function OverdueBadge({ severity, days }: { severity: "warning" | "critical"; days: number }) {
  const isCritical = severity === "critical";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium text-ink-primary ${
        isCritical ? "bg-status-critical/15" : "bg-status-warning/20"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${isCritical ? "bg-status-critical" : "bg-status-warning"}`}
        aria-hidden="true"
      />
      {isCritical ? "Critically overdue" : "Overdue"} · {days}d
    </span>
  );
}
