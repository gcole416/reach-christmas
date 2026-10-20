"use client";

import { useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { getSponsorFamilies, type AssignableCard } from "@/lib/queries";
import { SearchInput } from "@/components/SearchInput";

/**
 * The sponsor-roster picker for one card. Two-step on purpose (select a
 * roster entry, then a separate "Confirm assignment"): a capacity warning
 * needs somewhere to show before the write happens, and a one-click list
 * would either hide that warning or have to block on it — US-57 says never
 * block.
 */
export function AssignCardModal({ card, onClose }: { card: AssignableCard; onClose: () => void }) {
  const { data, assignCardToSponsorFamily } = useData();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);

  if (!data) return null;

  // Retired roster entries aren't offered here — "mark inactive" on the
  // roster page is staff saying this entry isn't taking more cards.
  const activeSponsorFamilies = getSponsorFamilies(data).filter((sf) => sf.isActive);
  const q = search.trim().toLowerCase();
  const sponsorFamilies = q
    ? activeSponsorFamilies.filter((sf) =>
        [sf.displayName, sf.contactEmail ?? "", sf.contactPhone ?? ""].join(" ").toLowerCase().includes(q),
      )
    : activeSponsorFamilies;

  const selected = selectedId ? activeSponsorFamilies.find((sf) => sf.id === selectedId) ?? null : null;
  const atCapacity = selected != null && selected.capacity != null && selected.assignedCount >= selected.capacity;

  async function handleConfirm() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    const result = await assignCardToSponsorFamily(card.cardId, selected.id);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccessName(selected.displayName);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 pb-0">
          <h2 className="text-lg font-semibold text-ink-primary">
            Assign {card.childFirstName}&apos;s card{" "}
            <span className="font-normal text-ink-muted">({card.cardNumber})</span>
          </h2>
          {card.siblingAssignments.length > 0 ? (
            <div className="mt-2 space-y-1">
              {card.siblingAssignments.map((sib, i) => (
                <p key={i} className="rounded-lg bg-cat-blue/5 px-2.5 py-1.5 text-xs text-ink-secondary">
                  Sibling {sib.childFirstName} is already assigned to{" "}
                  {sib.sponsorFamilyDisplayName ?? "a self-serve sponsor"}.
                </p>
              ))}
            </div>
          ) : null}
        </div>

        {successName ? (
          <div className="p-6">
            <div className="rounded-lg bg-status-good/10 px-3 py-2 text-sm text-ink-primary">
              Assigned {card.childFirstName}&apos;s card to {successName}.
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 pt-4">
              <SearchInput value={search} onChange={setSearch} placeholder="Search sponsors by name, email, or phone…" />
            </div>
            <div className="mt-3 flex-1 overflow-y-auto px-6">
              {sponsorFamilies.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-secondary">
                  {activeSponsorFamilies.length === 0 ? (
                    <>
                      No active sponsors yet. Add or import some on the{" "}
                      <Link href="/admin/sponsors" className="font-medium text-cat-blue hover:underline">
                        Sponsor roster
                      </Link>{" "}
                      page.
                    </>
                  ) : (
                    "No sponsors match this search."
                  )}
                </p>
              ) : (
                <ul className="space-y-2 pb-2">
                  {sponsorFamilies.map((sf) => {
                    const isSelected = selectedId === sf.id;
                    const full = sf.capacity != null && sf.assignedCount >= sf.capacity;
                    return (
                      <li key={sf.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(sf.id);
                            setError(null);
                          }}
                          aria-pressed={isSelected}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue ${
                            isSelected ? "border-cat-blue bg-cat-blue/10" : "border-border hover:border-cat-blue"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-ink-primary">{sf.displayName}</span>
                            <span className={full ? "text-xs font-medium text-status-warning" : "text-xs text-ink-muted"}>
                              {sf.assignedCount}
                              {sf.capacity != null ? ` / ${sf.capacity}` : ""}
                              {full ? " · at capacity" : ""}
                            </span>
                          </div>
                          {sf.contactEmail || sf.contactPhone ? (
                            <p className="mt-0.5 text-xs text-ink-secondary">
                              {[sf.contactEmail, sf.contactPhone].filter(Boolean).join(" · ")}
                            </p>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-border p-6">
              {atCapacity && selected ? (
                <p className="mb-3 text-sm text-status-warning">
                  {selected.displayName} is already at capacity ({selected.assignedCount}/{selected.capacity}).
                  You can still assign this card to them.
                </p>
              ) : null}
              {error ? (
                <div className="mb-3 rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
              ) : null}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-ink-muted/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!selected || submitting}
                  className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? "Assigning…" : "Confirm assignment"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
