"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { FormField } from "@/components/FormField";

export interface PublicCard {
  cardId: string;
  cardNumber: string;
  firstName: string;
  grade: string | null;
  pantSize: string | null;
  shirtSize: string | null;
  shoeSize: string | null;
  specificNeeds: string | null;
  wishlist: string[];
}

// The public_available_cards view has one row per wishlist item (from its
// left join), so a card with 3 wishlist items arrives as 3 rows sharing the
// same card_id — this groups them back into one PublicCard each.
function groupIntoCards(
  rows: {
    card_id: string;
    card_number: string;
    first_name: string;
    grade: string | null;
    pant_size: string | null;
    shirt_size: string | null;
    shoe_size: string | null;
    specific_needs: string | null;
    wishlist_description: string | null;
  }[]
): PublicCard[] {
  const byId = new Map<string, PublicCard>();
  for (const row of rows) {
    let card = byId.get(row.card_id);
    if (!card) {
      card = {
        cardId: row.card_id,
        cardNumber: row.card_number,
        firstName: row.first_name,
        grade: row.grade,
        pantSize: row.pant_size,
        shirtSize: row.shirt_size,
        shoeSize: row.shoe_size,
        specificNeeds: row.specific_needs,
        wishlist: [],
      };
      byId.set(row.card_id, card);
    }
    if (row.wishlist_description) card.wishlist.push(row.wishlist_description);
  }
  return Array.from(byId.values());
}

export function SponsorBrowser() {
  const [cards, setCards] = useState<PublicCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<PublicCard | null>(null);
  const [search, setSearch] = useState("");
  const [justClaimedName, setJustClaimedName] = useState<string | null>(null);

  const loadCards = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.from("public_available_cards").select("*");
    if (error) {
      setLoadError(error.message);
      return;
    }
    setCards(groupIntoCards(data ?? []));
  }, []);

  useEffect(() => {
    // Fetching from Supabase on mount — the sanctioned "sync from an external
    // system" exception to the no-setState-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCards();
  }, [loadCards]);

  const filtered = useMemo(() => {
    if (!cards) return [];
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      [c.firstName, c.grade ?? "", ...c.wishlist].join(" ").toLowerCase().includes(q)
    );
  }, [cards, search]);

  async function handleClaimed(card: PublicCard, sponsor: { name: string; email: string; phone: string }) {
    const supabase = createClient();
    const { error } = await supabase.rpc("claim_card", {
      p_card_id: card.cardId,
      p_sponsor_name: sponsor.name,
      p_sponsor_email: sponsor.email || null,
      p_sponsor_phone: sponsor.phone || null,
    });
    if (error) {
      // The claim failed (e.g. someone else just claimed this card first).
      // Refresh the grid so the now-stale card disappears, but keep the
      // modal open by re-throwing — ClaimModal's handleSubmit catches this
      // to show the error message to the sponsor.
      await loadCards();
      throw new Error(error.message);
    }
    setActiveCard(null);
    setJustClaimedName(card.firstName);
    await loadCards();
  }

  if (loadError) {
    return (
      <div className="mt-8 rounded-lg bg-status-critical/10 px-4 py-3 text-sm text-ink-primary">
        Couldn&apos;t load available children: {loadError}
      </div>
    );
  }

  if (!cards) {
    return <div className="mt-8 text-ink-secondary">Loading…</div>;
  }

  return (
    <div className="mt-8">
      {justClaimedName ? (
        <div className="mb-6 rounded-lg border border-status-good/30 bg-status-good/10 px-4 py-3 text-sm text-ink-primary">
          Thank you for sponsoring {justClaimedName}! In the real app you&apos;d get a confirmation email
          with drop-off details next.
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <input
          type="text"
          placeholder="Search by grade or wishlist item…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-cat-blue"
        />
        <p className="shrink-0 text-sm text-ink-muted">
          {filtered.length} of {cards.length} still need a sponsor
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-ink-secondary">
          {cards.length === 0
            ? "No children are listed yet — check back soon."
            : "No children match that search right now."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((card) => (
            <ChildCard key={card.cardId} card={card} onSponsor={() => setActiveCard(card)} />
          ))}
        </div>
      )}

      {activeCard ? (
        <ClaimModal
          card={activeCard}
          onClose={() => setActiveCard(null)}
          onClaimed={(sponsor) => handleClaimed(activeCard, sponsor)}
        />
      ) : null}
    </div>
  );
}

function ChildCard({ card, onSponsor }: { card: PublicCard; onSponsor: () => void }) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{card.cardNumber}</span>
      <h3 className="mt-1 text-lg font-semibold text-ink-primary">
        {card.firstName}
        {card.grade ? ` · Grade ${card.grade}` : ""}
      </h3>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-ink-secondary">
        <div>
          <dt className="text-ink-muted">Pants</dt>
          <dd>{card.pantSize ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Shirt</dt>
          <dd>{card.shirtSize ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Shoes</dt>
          <dd>{card.shoeSize ?? "—"}</dd>
        </div>
      </dl>
      {card.wishlist.length > 0 ? (
        <ul className="mt-4 flex-1 list-disc space-y-1 pl-4 text-sm text-ink-secondary">
          {card.wishlist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <div className="flex-1" />
      )}
      {card.specificNeeds ? <p className="mt-3 text-xs italic text-ink-muted">{card.specificNeeds}</p> : null}
      <button
        onClick={onSponsor}
        className="mt-5 rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
      >
        Sponsor this gift
      </button>
    </div>
  );
}

function ClaimModal({
  card,
  onClose,
  onClaimed,
}: {
  card: PublicCard;
  onClose: () => void;
  onClaimed: (sponsor: { name: string; email: string; phone: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onClaimed({ name, email, phone });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-primary">
          Sponsor {card.firstName} ({card.cardNumber})
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Leave your contact info so our team can follow up about drop-off.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <FormField label="Your name" value={name} onChange={setName} required />
          <FormField label="Email" type="email" value={email} onChange={setEmail} required />
          <FormField label="Phone (optional)" type="tel" value={phone} onChange={setPhone} />
          {error ? (
            <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-ink-muted/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Claiming…" : "Confirm claim"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
