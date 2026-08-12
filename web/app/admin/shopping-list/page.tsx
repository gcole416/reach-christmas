"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { displayFirstName, getShoppingList } from "@/lib/queries";
import { StatusBadge } from "@/components/StatusBadge";
import { AdminNav } from "../AdminNav";

// What the admin team still needs to shop for: every open (unverified)
// volunteer note, consolidated across all cards. Marking a row verified here
// is the same action as the checkbox on the fulfillment board — see
// setAssignmentVerified in lib/store.tsx — so it drops off both places at
// once.
export default function ShoppingListPage() {
  const { data, viewerRole, setAssignmentVerified } = useData();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  if (!data) return null;

  const isAdmin = viewerRole === "admin";
  const rows = getShoppingList(data).map((row) => ({
    ...row,
    displayName: displayFirstName(row.childFirstName, row.isConfidential, isAdmin),
  }));

  async function handleMarkVerified(assignmentId: string) {
    setBusyId(assignmentId);
    setRowError(null);
    const result = await setAssignmentVerified(assignmentId, true);
    setBusyId(null);
    if (!result.ok) setRowError({ id: assignmentId, message: result.error });
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="print:hidden">
        <h1 className="text-3xl font-semibold text-ink-primary">Shopping list</h1>
        <p className="mt-2 text-ink-secondary">
          Every open volunteer note — what to check against the wishlist and pick up at the store. Mark a
          row verified once it&apos;s been checked or topped up; it drops off this list.
        </p>

        <AdminNav />

        <div className="mb-6 flex items-center gap-3">
          <p className="text-sm text-ink-muted">{rows.length} open note{rows.length === 1 ? "" : "s"}</p>
          {rows.length > 0 ? (
            <button
              onClick={() => window.print()}
              className="ml-auto rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Print this page
            </button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-ink-secondary print:hidden">
          Nothing to shop for right now.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const busy = busyId === row.assignmentId;
            return (
              <li
                key={row.assignmentId}
                className="rounded-xl border border-border bg-surface p-4 text-sm print:border-2 print:border-black print:rounded-none print:break-inside-avoid"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink-primary print:text-black">
                    {row.displayName} <span className="font-normal text-ink-muted print:text-black">({row.cardNumber})</span>
                  </span>
                  <StatusBadge status={row.status} />
                </div>
                <p className="mt-2 text-ink-secondary print:text-black">{row.notes}</p>
                <p className="mt-2 text-xs text-ink-muted print:text-black">
                  Sponsor: {row.sponsorName} · claimed {row.daysSinceClaimed}d ago
                </p>
                {rowError?.id === row.assignmentId ? (
                  <p className="mt-2 text-xs text-status-critical">{rowError.message}</p>
                ) : null}
                <button
                  onClick={() => handleMarkVerified(row.assignmentId)}
                  disabled={busy}
                  className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary disabled:opacity-50 print:hidden"
                >
                  {busy ? "Saving…" : "Mark verified"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
