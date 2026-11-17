"use client";

import { formatImportTime, type SponsorImportLog } from "@/lib/sponsorImport";

// US-76: "Last updated from Church Center ..." on the roster and Assign pages,
// so whoever is assigning can tell whether the list is current.
export function LastImportLine({ latest }: { latest: SponsorImportLog | null | undefined }) {
  if (latest === undefined) return null;
  if (latest === null) {
    return <p className="text-sm text-ink-muted">Not updated from Church Center yet.</p>;
  }
  const parts = [`${latest.addedCount} new`, `${latest.updatedCount} changed`];
  return (
    <p className="text-sm text-ink-muted">
      Last updated from Church Center:{" "}
      <span className="font-medium text-ink-secondary">{formatImportTime(latest.importedAt)}</span>
      {latest.importedByName ? ` by ${latest.importedByName}` : ""} ({parts.join(", ")})
    </p>
  );
}

/** Marks a roster entry added by the most recent import. */
export function NewBadge() {
  return (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-status-good/15 px-2 py-0.5 text-[11px] font-medium text-ink-primary">
      New
    </span>
  );
}
