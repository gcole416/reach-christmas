"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAuditLog, useData } from "@/lib/store";
import type { AuditAction, AuditLogEntry } from "@/lib/types";
import { AdminNav } from "../AdminNav";

// Matches the tables covered by the audit_log triggers (see SCHEMA.md §11).
const AUDITED_TABLES: { value: string; label: string }[] = [
  { value: "drives", label: "Drives" },
  { value: "schools", label: "Schools" },
  { value: "drive_schools", label: "Drive schools" },
  { value: "families", label: "Families" },
  { value: "children", label: "Children" },
  { value: "cards", label: "Cards" },
  { value: "wishlist_items", label: "Wishlist items" },
  { value: "sponsors", label: "Sponsors" },
  { value: "assignments", label: "Assignments" },
  { value: "profiles", label: "Profiles" },
];

const ACTION_CONFIG: Record<AuditAction, { label: string; dot: string; bg: string }> = {
  insert: { label: "Insert", dot: "bg-status-good", bg: "bg-status-good/10" },
  update: { label: "Update", dot: "bg-cat-blue", bg: "bg-cat-blue/10" },
  delete: { label: "Delete", dot: "bg-status-critical", bg: "bg-status-critical/10" },
};

function ActionBadge({ action }: { action: AuditAction }) {
  const config = ACTION_CONFIG[action];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium text-ink-primary ${config.bg}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${config.dot}`} aria-hidden="true" />
      {config.label}
    </span>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function resolveChangedBy(changedBy: string | null, profiles: { id: string; fullName: string }[]) {
  if (!changedBy) return "System";
  const profile = profiles.find((p) => p.id === changedBy);
  return profile?.fullName ?? changedBy;
}

// Short, non-exhaustive human summary of a diff — the raw JSON is still
// available in the expandable details below for anyone who needs the full
// picture. Doesn't render field values here, just field names/counts, to
// keep the default (unexpanded) view lighter on PII.
function summarizeDiff(entry: AuditLogEntry): string {
  if (!entry.diff) return "No details recorded.";

  if (entry.action === "update") {
    const { old: oldRow, new: newRow } = entry.diff as { old?: Record<string, unknown>; new?: Record<string, unknown> };
    if (!oldRow || !newRow) return "Fields changed.";
    const keys = new Set([...Object.keys(oldRow), ...Object.keys(newRow)]);
    const changed = [...keys].filter((k) => JSON.stringify(oldRow[k]) !== JSON.stringify(newRow[k]));
    if (changed.length === 0) return "No field values changed.";
    if (changed.length <= 3) return `Changed: ${changed.join(", ")}`;
    return `${changed.length} fields changed`;
  }

  const fieldCount = Object.keys(entry.diff).length;
  return entry.action === "insert" ? `Row created (${fieldCount} fields)` : `Row deleted (${fieldCount} fields)`;
}

export default function AuditLogPage() {
  const { data } = useData();
  const [tableName, setTableName] = useState<string>("all");
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(
    async (cancelledRef: { current: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchAuditLog(tableName === "all" ? undefined : { tableName });
        if (!cancelledRef.current) setEntries(result);
      } catch (err) {
        if (!cancelledRef.current) setError(err instanceof Error ? err.message : "Failed to load the audit log.");
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    },
    [tableName]
  );

  useEffect(() => {
    const cancelledRef = { current: false };
    // Fetching from Supabase on filter change — the sanctioned "sync from an
    // external system" exception to the no-setState-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEntries(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [loadEntries]);

  const profiles = data?.profiles ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-ink-primary">Audit log</h1>
      <p className="mt-2 text-ink-secondary">
        Every insert, update, and delete across the drive&apos;s data, most recent first. Entries for
        families and children can include real PII — this page is admin-only and nothing here should be
        exported or copied elsewhere.
      </p>

      <AdminNav />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-ink-secondary">Table</span>
          <select
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-cat-blue"
          >
            <option value="all">All tables</option>
            {AUDITED_TABLES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-ink-muted">
          {loading ? "Loading…" : `${entries.length} entries`}
        </p>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg bg-status-critical/10 px-4 py-3 text-sm text-ink-primary">{error}</div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Table</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Changed by</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading
              ? null
              : entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-secondary">{formatDateTime(entry.changedAt)}</td>
                    <td className="px-4 py-3 text-ink-primary">{entry.tableName}</td>
                    <td className="px-4 py-3">
                      <ActionBadge action={entry.action} />
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{resolveChangedBy(entry.changedBy, profiles)}</td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {entry.diff ? (
                        <details>
                          <summary className="cursor-pointer text-ink-primary hover:underline">
                            {summarizeDiff(entry)}
                          </summary>
                          <pre className="mt-2 max-w-xl overflow-x-auto rounded-lg bg-ink-muted/5 p-3 text-xs text-ink-secondary">
                            {JSON.stringify(entry.diff, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        "No details recorded."
                      )}
                    </td>
                  </tr>
                ))}
            {!loading && entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-secondary">
                  No rows match this view.
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-secondary">
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
