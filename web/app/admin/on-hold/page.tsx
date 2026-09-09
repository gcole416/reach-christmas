"use client";

import { useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { displayFirstName, getChildrenOnHold, getHouseholdTag } from "@/lib/queries";
import { AdminPageHeader } from "../AdminPageHeader";

// US-38: the roster of children paused for duplicate review. A held child's
// card is out of the sponsor pool, the print run, and every count and board
// (see the `held_at is null` predicates mirrored in lib/queries.ts) — nothing
// is deleted, and an admin can release the hold from here or the household
// edit page. getChildrenOnHold() only returns rows this viewer can already
// see; RLS keeps confidential households out for staff without clearance.

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Last 10 digits — the same join key US-37 uses (findHouseholdMatches in
// submissions/shared.ts). A local match on the bundle we already have; not
// worth a new lib export for one page.
function normPhone(value: string): string {
  return value.replace(/\D/g, "").slice(-10);
}

function resolvePlacedBy(heldBy: string | null, profiles: { id: string; fullName: string }[]) {
  if (!heldBy) return "System";
  return profiles.find((p) => p.id === heldBy)?.fullName ?? heldBy;
}

export default function OnHoldPage() {
  const { data, viewerRole, releaseChildHold } = useData();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  if (!data) return null;

  const isAdmin = viewerRole === "admin";
  const rows = getChildrenOnHold(data);
  const { profiles } = data;

  async function handleRelease(childId: string) {
    setBusyId(childId);
    setRowError(null);
    const result = await releaseChildHold(childId);
    setBusyId(null);
    if (!result.ok) setRowError({ id: childId, message: result.error });
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <AdminPageHeader
        title="On hold"
        description="Children paused for duplicate review. While a child is on hold their card is out of the sponsor pool, the print run, and every count. Nothing is deleted. Release the hold once you have sorted out whether it is a duplicate."
      />

      <p className="mb-6 text-sm text-ink-muted">
        {rows.length} {rows.length === 1 ? "child" : "children"} on hold
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-ink-secondary">
          No households on hold.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const duplicates = row.guardianPhoneKey
              ? data.families
                  .filter(
                    (f) =>
                      f.id !== row.familyId &&
                      normPhone(f.guardianPhone ?? "") === row.guardianPhoneKey,
                  )
                  .map((f) => ({ familyId: f.id, tag: getHouseholdTag(data, f) }))
              : [];
            const busy = busyId === row.childId;

            return (
              <li
                key={row.childId}
                className="rounded-xl border border-border bg-surface p-4 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink-primary">
                    {displayFirstName(row.firstName, row.isConfidential, isAdmin)}{" "}
                    <Link
                      href={`/admin/families/${row.familyId}`}
                      className="font-normal text-cat-blue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
                    >
                      Household {row.householdTag}
                    </Link>
                    {row.grade ? (
                      <span className="font-normal text-ink-muted"> · grade {row.grade}</span>
                    ) : null}
                  </span>
                  {row.isConfidential ? (
                    <span className="inline-flex items-center rounded-full bg-status-serious/15 px-2.5 py-1 text-xs font-medium text-ink-primary">
                      Confidential
                    </span>
                  ) : row.schoolName ? (
                    <span className="text-xs text-ink-muted">{row.schoolName}</span>
                  ) : null}
                </div>

                <p className="mt-2 text-ink-secondary">
                  {row.holdReason ? (
                    row.holdReason
                  ) : (
                    <span className="italic text-ink-muted">No reason recorded.</span>
                  )}
                </p>

                <p className="mt-2 text-xs text-ink-muted">
                  Placed by {resolvePlacedBy(row.heldBy, profiles)} · {formatDateTime(row.heldAt)}
                </p>

                {duplicates.length > 0 ? (
                  <p className="mt-2 text-xs text-ink-secondary">
                    {duplicates.map((d, i) => (
                      <span key={d.familyId}>
                        {i > 0 ? " · " : null}
                        <Link
                          href={`/admin/families/${d.familyId}`}
                          className="font-medium text-cat-blue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
                        >
                          Possibly the same household as {d.tag}
                        </Link>
                      </span>
                    ))}
                  </p>
                ) : null}

                {rowError?.id === row.childId ? (
                  <p className="mt-2 text-xs text-status-critical">{rowError.message}</p>
                ) : null}

                {isAdmin ? (
                  <button
                    onClick={() => handleRelease(row.childId)}
                    disabled={busy}
                    className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary disabled:opacity-50"
                  >
                    {busy ? "Releasing…" : "Release hold"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
