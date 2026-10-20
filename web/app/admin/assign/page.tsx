"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { getAssignableCards, type AssignableCard } from "@/lib/queries";
import { SearchInput } from "@/components/SearchInput";
import { AdminPageHeader } from "../AdminPageHeader";
import { AssignCardModal } from "./AssignCardModal";

// US-57: pick a card, pick a roster entry, confirm. getAssignableCards(data)
// already excludes confidential, high-schooler, on-hold, and already-claimed
// cards — this page only adds search/display on top, never re-filters any of
// that itself.
export default function AssignSponsorsPage() {
  const { data } = useData();
  const [search, setSearch] = useState("");
  // Holds a snapshot of the card the modal is working on, not a live
  // lookup by id: once assignCardToSponsorFamily succeeds the data bundle
  // refreshes and this card drops out of getAssignableCards, so re-deriving
  // it from the list on every render would yank the modal away mid
  // "assigned!" message. onClose (after the staff member dismisses that
  // message) is what actually clears it.
  const [activeCard, setActiveCard] = useState<AssignableCard | null>(null);

  if (!data) return null;

  const allCards = getAssignableCards(data);
  const q = search.trim().toLowerCase();
  const cards = q
    ? allCards.filter((c) =>
        [c.childFirstName, c.cardNumber, c.schoolName ?? "", c.grade ?? "", c.sex ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : allCards;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <AdminPageHeader
        title="Assign sponsors"
        description="Cards with no sponsor yet. Pick one, then choose who from the roster is taking it. Siblings already assigned are flagged below so you can keep a household with the same sponsor on purpose — nothing here does that matching for you."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by child, card number, school, or grade…"
        />
        <p className="text-sm text-ink-muted">
          {cards.length} of {allCards.length} unassigned
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-ink-secondary">
          {allCards.length === 0
            ? "Every eligible card already has a sponsor."
            : "No cards match this search."}
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {cards.map((card) => (
            <li
              key={card.cardId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink-primary">
                  {card.childFirstName} <span className="font-normal text-ink-muted">({card.cardNumber})</span>
                </p>
                <p className="mt-0.5 text-sm text-ink-secondary">
                  {[card.schoolName, card.grade ? `Grade ${card.grade}` : null, card.sex]
                    .filter(Boolean)
                    .join(" · ") || "No school on file"}
                </p>
                {card.siblingAssignments.map((sib, i) => (
                  <p
                    key={i}
                    className="mt-1.5 inline-block rounded-lg bg-cat-blue/5 px-2.5 py-1 text-xs text-ink-secondary"
                  >
                    Sibling {sib.childFirstName} already assigned to{" "}
                    {sib.sponsorFamilyDisplayName ?? "a self-serve sponsor"}
                  </p>
                ))}
              </div>
              <button
                onClick={() => setActiveCard(card)}
                className="shrink-0 rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Assign
              </button>
            </li>
          ))}
        </ul>
      )}

      {activeCard ? <AssignCardModal card={activeCard} onClose={() => setActiveCard(null)} /> : null}
    </div>
  );
}
