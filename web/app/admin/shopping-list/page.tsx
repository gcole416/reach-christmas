"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { displayChildGender, displayFirstName, getShoppingList } from "@/lib/queries";
import { StatusBadge } from "@/components/StatusBadge";
import { AdminPageHeader } from "../AdminPageHeader";

// What the admin team still needs to shop for: every card that's reached
// church with a volunteer note attached and hasn't advanced to 'verified'
// yet. Marking a row verified here advances that assignment's status the
// same way the fulfillment board's "Mark verified" button does, so it drops
// off both places at once.
export default function ShoppingListPage() {
  const { data, viewerRole, updateAssignmentStatus } = useData();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  if (!data) return null;

  const isAdmin = viewerRole === "admin";
  const rows = getShoppingList(data).map((row) => {
    const specs = [
      row.age !== null ? `Age ${row.age}` : null,
      displayChildGender(row.sex),
      row.shirtSize ? `Shirt ${row.shirtSize}` : null,
      row.pantSize ? `Pants ${row.pantSize}` : null,
      row.shoeSize ? `Shoes ${row.shoeSize}` : null,
    ].filter(Boolean) as string[];
    return {
      ...row,
      displayName: displayFirstName(row.childFirstName, row.isConfidential, isAdmin),
      specs,
    };
  });

  async function handleMarkVerified(assignmentId: string) {
    setBusyId(assignmentId);
    setRowError(null);
    const result = await updateAssignmentStatus(assignmentId, "verified");
    setBusyId(null);
    if (!result.ok) setRowError({ id: assignmentId, message: result.error });
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="print:hidden">
        <AdminPageHeader
          title="Shopping list"
          description="Every open volunteer note: what to check against the wishlist and pick up at the store. Mark a row verified once it's been checked or topped up, and it drops off this list."
        />

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
                {row.specs.length > 0 ? (
                  <p className="mt-1 text-xs text-ink-secondary print:text-black">
                    {row.specs.join(" · ")}
                  </p>
                ) : null}
                <p className="mt-2 text-ink-secondary print:text-black">{row.notes}</p>
                <p className="mt-2 text-xs text-ink-muted print:text-black">
                  Claimed {row.daysSinceClaimed}d ago
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
