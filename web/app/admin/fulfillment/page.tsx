"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import {
  displayFirstName,
  FULFILLMENT_COLUMNS,
  getFulfillmentBoard,
  NEXT_STATUS,
  type FulfillmentColumn,
} from "@/lib/queries";
import { STATUS_OPTIONS, OverdueBadge } from "@/components/StatusBadge";
import { SearchInput } from "@/components/SearchInput";
import { AdminPageHeader } from "../AdminPageHeader";

const COLUMN_DOT: Record<FulfillmentColumn, string> = {
  unassigned: "bg-ink-muted",
  pledged: "bg-cat-blue",
  purchased: "bg-cat-violet",
  received_at_church: "bg-cat-aqua",
  verified: "bg-cat-yellow",
  delivered: "bg-status-good",
};

// Notes only make sense once a gift has actually arrived — see
// NOTES_VISIBLE_FROM's twin in lib/queries.ts, which already nulls out
// volunteerNotes for earlier columns. This just controls whether the
// add/edit affordance is offered at all.
const NOTES_EDITABLE_COLUMNS: FulfillmentColumn[] = ["received_at_church", "verified"];

function nextStatusLabel(column: FulfillmentColumn): string | null {
  const next = NEXT_STATUS[column as keyof typeof NEXT_STATUS];
  if (!next) return null;
  return STATUS_OPTIONS.find((o) => o.value === next)?.label ?? next;
}

export default function FulfillmentPage() {
  const { data, viewerRole, updateAssignmentStatus, cancelAssignment, updateAssignmentNotes } = useData();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [focusedColumn, setFocusedColumn] = useState<FulfillmentColumn | null>(null);
  const [openNotesId, setOpenNotesId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  if (!data) return null;

  const isAdmin = viewerRole === "admin";
  const allCards = getFulfillmentBoard(data).map((card) => ({
    ...card,
    displayName: displayFirstName(card.childFirstName, card.isConfidential, isAdmin),
  }));

  const q = search.trim().toLowerCase();
  const visibleCards = allCards.filter((card) => {
    const overdueMatches = !overdueOnly || card.overdueSeverity !== null;
    const searchMatches =
      !q ||
      [card.displayName, card.cardNumber, card.sponsorName ?? "", card.sponsorEmail ?? "", card.sponsorPhone ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return overdueMatches && searchMatches;
  });

  const columns = focusedColumn ? FULFILLMENT_COLUMNS.filter((c) => c.value === focusedColumn) : FULFILLMENT_COLUMNS;

  async function handleAdvance(assignmentId: string, column: FulfillmentColumn) {
    const next = NEXT_STATUS[column as keyof typeof NEXT_STATUS];
    if (!next) return;
    setBusyId(assignmentId);
    setRowError(null);
    const result = await updateAssignmentStatus(assignmentId, next);
    setBusyId(null);
    if (!result.ok) setRowError({ id: assignmentId, message: result.error });
  }

  async function handleCancel(assignmentId: string, childName: string) {
    if (!window.confirm(`Cancel this pledge for ${childName}? Their card goes back on the public sponsor page.`)) {
      return;
    }
    setBusyId(assignmentId);
    setRowError(null);
    const result = await cancelAssignment(assignmentId);
    setBusyId(null);
    if (!result.ok) setRowError({ id: assignmentId, message: result.error });
  }

  function handleToggleNotes(assignmentId: string, currentNotes: string | null) {
    if (openNotesId === assignmentId) {
      setOpenNotesId(null);
      return;
    }
    setNoteDrafts((prev) => ({ ...prev, [assignmentId]: prev[assignmentId] ?? currentNotes ?? "" }));
    setOpenNotesId(assignmentId);
  }

  async function handleSaveNotes(assignmentId: string) {
    setBusyId(assignmentId);
    setRowError(null);
    const result = await updateAssignmentNotes(assignmentId, noteDrafts[assignmentId] ?? "");
    setBusyId(null);
    if (!result.ok) {
      setRowError({ id: assignmentId, message: result.error });
      return;
    }
    setOpenNotesId(null);
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <AdminPageHeader
        title="Fulfillment"
        description="Every card, grouped by where it stands. Click a column title to focus on just that status."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by child, card, or sponsor…" />
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Overdue only
        </label>
        {focusedColumn ? (
          <button
            onClick={() => setFocusedColumn(null)}
            className="text-sm font-medium text-cat-blue hover:opacity-80"
          >
            Show all columns
          </button>
        ) : null}
        <p className="ml-auto text-sm text-ink-muted">
          {visibleCards.length} of {allCards.length}
        </p>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((col) => {
          const cardsInColumn = visibleCards.filter((c) => c.column === col.value);
          const isFocused = focusedColumn === col.value;
          return (
            <div key={col.value} className={focusedColumn ? "w-full max-w-2xl shrink-0" : "w-72 shrink-0"}>
              <button
                onClick={() => setFocusedColumn(isFocused ? null : col.value)}
                className={`flex w-full items-center justify-between rounded-t-lg border border-b-0 px-3 py-2 text-left ${
                  isFocused ? "border-cat-blue bg-cat-blue/10" : "border-border bg-ink-muted/5 hover:bg-ink-muted/10"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${COLUMN_DOT[col.value]}`} aria-hidden="true" />
                  {col.label}
                </span>
                <span className="rounded-full bg-ink-muted/15 px-2 py-0.5 text-xs font-medium text-ink-secondary">
                  {cardsInColumn.length}
                </span>
              </button>
              <div className="min-h-[100px] space-y-2 rounded-b-lg border border-border bg-ink-muted/[0.02] p-2">
                {cardsInColumn.length === 0 ? (
                  <p className="p-3 text-center text-xs text-ink-muted">Nothing here.</p>
                ) : (
                  cardsInColumn.map((card) => {
                    const busy = busyId === card.assignmentId;
                    const label = nextStatusLabel(card.column);
                    const assignmentId = card.assignmentId;
                    return (
                      <div key={card.cardId} className="rounded-lg border border-border bg-surface p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-ink-primary">
                            {card.displayName}{" "}
                            <span className="font-normal text-ink-muted">({card.cardNumber})</span>
                          </span>
                          {card.overdueSeverity ? (
                            <OverdueBadge severity={card.overdueSeverity} days={card.daysSinceClaimed ?? 0} />
                          ) : null}
                        </div>
                        {card.sponsorName ? (
                          <p className="mt-1 text-xs text-ink-secondary">
                            {card.sponsorName}
                            {card.sponsorEmail ? ` · ${card.sponsorEmail}` : ""}
                            {card.sponsorPhone ? ` · ${card.sponsorPhone}` : ""}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-ink-muted">Needs a sponsor</p>
                        )}
                        {assignmentId && NOTES_EDITABLE_COLUMNS.includes(card.column) ? (
                          <div className="mt-2">
                            <button
                              onClick={() => handleToggleNotes(assignmentId, card.volunteerNotes)}
                              className="text-xs font-medium text-cat-blue hover:opacity-80"
                            >
                              {card.volunteerNotes ? "Edit note" : "Add note"}
                              {card.volunteerNotes && openNotesId !== assignmentId ? " ●" : ""}
                            </button>
                          </div>
                        ) : null}
                        {assignmentId && openNotesId === assignmentId && NOTES_EDITABLE_COLUMNS.includes(card.column) ? (
                          <div className="mt-2">
                            <textarea
                              value={noteDrafts[assignmentId] ?? ""}
                              onChange={(e) =>
                                setNoteDrafts((prev) => ({ ...prev, [assignmentId]: e.target.value }))
                              }
                              placeholder="e.g. missing shoes, only 1 of 2 wishlist items…"
                              rows={2}
                              className="w-full rounded-lg border border-border bg-surface p-2 text-xs text-ink-primary"
                            />
                            <div className="mt-1 flex items-center gap-3">
                              <button
                                onClick={() => handleSaveNotes(assignmentId)}
                                disabled={busy}
                                className="rounded-lg bg-cat-blue px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                              >
                                {busy ? "Saving…" : "Save note"}
                              </button>
                              <button
                                onClick={() => setOpenNotesId(null)}
                                className="text-xs font-medium text-ink-secondary hover:text-ink-primary"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : card.volunteerNotes && openNotesId !== assignmentId ? (
                          <p className="mt-1 text-xs italic text-ink-muted">{card.volunteerNotes}</p>
                        ) : null}
                        {assignmentId && card.column !== "delivered" ? (
                          <div className="mt-2 flex items-center gap-3">
                            {label ? (
                              <button
                                onClick={() => handleAdvance(assignmentId, card.column)}
                                disabled={busy}
                                className="rounded-lg bg-cat-blue px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                              >
                                {busy ? "Saving…" : `Mark ${label.toLowerCase()}`}
                              </button>
                            ) : null}
                            <button
                              onClick={() => handleCancel(assignmentId, card.displayName)}
                              disabled={busy}
                              className="text-xs font-medium text-ink-secondary hover:text-status-critical disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : null}
                        {rowError?.id === card.assignmentId ? (
                          <p className="mt-1 text-xs text-status-critical">{rowError.message}</p>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
