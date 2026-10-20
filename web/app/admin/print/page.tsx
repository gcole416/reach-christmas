"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { displayFirstName, getPrintableCards } from "@/lib/queries";
import { SearchInput } from "@/components/SearchInput";
import { AdminPageHeader } from "../AdminPageHeader";

// TODO(nametag stickers): this grid is laid out for plain paper. Still needs
// a layout sized/spaced for adhesive nametag sticker sheets so cards can go
// straight from printer to being stuck on the gift — see DESIGN.md's "Known
// follow-ups." Needs the actual label sheet product/dimensions first.
export default function PrintPage() {
  const { data, viewerRole, updateCardPrinted } = useData();
  const [showPrinted, setShowPrinted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  if (!data) return null;

  const isAdmin = viewerRole === "admin";
  const allCards = getPrintableCards(data).map((c) => ({
    ...c,
    displayName: displayFirstName(c.firstName, c.isConfidential, isAdmin),
  }));
  const q = search.trim().toLowerCase();
  const cards = allCards
    .filter((c) => showPrinted || !c.printedAt)
    .filter((c) => !q || [c.displayName, c.displayLabel, ...c.wishlist].join(" ").toLowerCase().includes(q));

  async function handleTogglePrinted(cardId: string, printed: boolean) {
    setBusyId(cardId);
    await updateCardPrinted(cardId, printed);
    setBusyId(null);
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="print:hidden">
        <AdminPageHeader
          title="Printable cards"
          description="The physical card for each child. Mark a card printed once it's off the printer so it drops out of this list."
        />

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name, card, or wishlist item…" />
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={showPrinted}
              onChange={(e) => setShowPrinted(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Show already-printed cards too
          </label>
          <p className="text-sm text-ink-muted">
            {cards.length} of {allCards.length}
          </p>
          <button
            onClick={() => window.print()}
            className="ml-auto rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Print this page
          </button>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-ink-secondary print:hidden">
          {allCards.length === 0
            ? "No cards generated yet."
            : q
              ? "No cards match this search."
              : "Everything is printed. Nothing left to show."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-4">
          {cards.map((card) => (
            <div
              key={card.cardId}
              className="break-inside-avoid rounded-xl border border-border bg-surface p-5 print:border-2 print:border-black print:rounded-none"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-ink-muted print:text-black">
                {card.displayLabel}
              </span>
              <h3 className="mt-1 text-lg font-semibold text-ink-primary print:text-black">
                {card.displayName}
                {card.grade ? ` · Grade ${card.grade}` : ""}
              </h3>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-ink-secondary print:text-black">
                <div>
                  <dt className="text-ink-muted print:text-black">Pants</dt>
                  <dd>{card.pantSize ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted print:text-black">Shirt</dt>
                  <dd>{card.shirtSize ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted print:text-black">Shoes</dt>
                  <dd>{card.shoeSize ?? "—"}</dd>
                </div>
              </dl>
              {card.wishlist.length > 0 ? (
                <ul className="mt-4 list-disc space-y-1 pl-4 text-sm text-ink-secondary print:text-black">
                  {card.wishlist.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {card.specificNeeds ? (
                <p className="mt-3 text-xs italic text-ink-muted print:text-black">{card.specificNeeds}</p>
              ) : null}

              <button
                onClick={() => handleTogglePrinted(card.cardId, !card.printedAt)}
                disabled={busyId === card.cardId}
                className="mt-5 w-full rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary disabled:opacity-50 print:hidden"
              >
                {busyId === card.cardId ? "Saving…" : card.printedAt ? "Mark not printed" : "Mark printed"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
