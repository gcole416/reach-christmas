"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { requestClaimCode, claimCardWithCode } from "@/lib/store";
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

  // Called once claimCardWithCode actually confirms the code and creates the
  // sponsor + assignment — the point at which the claim is real. Everything
  // before this (requesting a code, typing it in) can fail or be abandoned
  // with nothing to clean up.
  async function handleVerified(card: PublicCard) {
    setActiveCard(null);
    setJustClaimedName(card.firstName);
    await loadCards();
  }

  // A code-entry failure sometimes means someone else claimed the card while
  // this sponsor was mid-flow (claim_card_with_code's race-condition checks).
  // Refresh the grid quietly in the background so the now-stale card
  // disappears; the modal stays open showing the error either way.
  function handleCodeStepError() {
    void loadCards();
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
            ? "No children are listed yet. Check back soon."
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
          onVerified={() => handleVerified(activeCard)}
          onCodeStepError={handleCodeStepError}
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
          {card.wishlist.map((item, idx) => (
            <li key={idx}>{item}</li>
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

// The server's copy for these failure reasons all contain "request a new
// code" somewhere in the sentence — expired, missing, or too many wrong
// attempts end in "Request a new code.", and the stale-sessionToken case
// (someone requested a newer code for this card, e.g. a resend from another
// tab) reads "...Please request a new code and try again." Case-insensitive
// so that last one still matches. That's the signal the pending verification
// is dead and a fresh code is the only way forward, as opposed to "that code
// doesn't match", which just means try again.
function needsFreshCode(message: string): boolean {
  return message.toLowerCase().includes("request a new code");
}

const RESEND_COOLDOWN_SECONDS = 30;

function ClaimModal({
  card,
  onClose,
  onVerified,
  onCodeStepError,
}: {
  card: PublicCard;
  onClose: () => void;
  onVerified: () => void;
  onCodeStepError: () => void;
}) {
  const [step, setStep] = useState<"details" | "code">("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  // Set by every successful sendCode() call (initial send and resend alike)
  // and passed to claimCardWithCode below — each new call supersedes the
  // last, since a resend invalidates the prior token server-side too.
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function sendCode(): Promise<boolean> {
    setSubmitting(true);
    setError(null);
    const result = await requestClaimCode({
      cardId: card.cardId,
      sponsorName: name,
      sponsorEmail: email,
      sponsorPhone: phone || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setSessionToken(result.sessionToken);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    return true;
  }

  async function handleDetailsSubmit(e: FormEvent) {
    e.preventDefault();
    setCode("");
    if (await sendCode()) setStep("code");
  }

  async function handleResend() {
    setCode("");
    await sendCode();
  }

  async function handleCodeSubmit(e: FormEvent) {
    e.preventDefault();
    // step === "code" is only reachable after a successful sendCode(), which
    // always sets sessionToken — this guard is just for TS narrowing.
    if (!sessionToken) return;
    setSubmitting(true);
    setError(null);
    const result = await claimCardWithCode(card.cardId, code, sessionToken);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      onCodeStepError();
      return;
    }
    onVerified();
  }

  const sessionDead = step === "code" && error !== null && needsFreshCode(error);

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

        {step === "details" ? (
          <>
            <p className="mt-1 text-sm text-ink-secondary">
              Leave your contact info so our team can follow up about drop-off.
            </p>
            <form onSubmit={handleDetailsSubmit} className="mt-4 space-y-3">
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
                  {submitting ? "Sending…" : "Send code"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-secondary">
              We sent a code to <span className="font-medium text-ink-primary">{email}</span>. Enter it
              below to confirm.
            </p>
            {sessionDead ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setStep("details");
                    }}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-ink-muted/10"
                  >
                    Edit info
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={submitting}
                    className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {submitting ? "Sending…" : "Send a new code"}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCodeSubmit} className="mt-4 space-y-3">
                <FormField
                  label="6-digit code"
                  value={code}
                  onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  required
                  autoFocus
                />
                {error ? (
                  <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setStep("details");
                    }}
                    className="text-sm font-medium text-ink-secondary hover:text-ink-primary hover:underline"
                  >
                    Wrong email? Edit info
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={submitting || resendCooldown > 0}
                    className="text-sm font-medium text-cat-blue hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
                  >
                    {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
                  </button>
                </div>
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
                    disabled={submitting || code.length !== 6}
                    className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {submitting ? "Confirming…" : "Confirm"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
