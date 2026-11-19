"use client";

// Manual card emails (email is off, so staff send cards from their own
// mailbox). Two halves:
//   * buildSponsorCardEmail: the email text, ready to paste into
//     Gmail/Outlook. Child details match send-sponsor-emails' buildEmail;
//     the drop-off part is this season's fixed DROPOFF_INSTRUCTIONS.
//   * markCardsEmailed / unmarkCardsEmailed: set or clear
//     assignments.card_emailed_at, the same column the automatic email sets,
//     so the roster's "not emailed yet" count and "Email all assigned" both
//     treat a hand-sent card as sent. Staff already have update rights on
//     assignments ("staff update assignments", init.sql) and every change is
//     in audit_log, so no new database function is needed.
//   * getCardEmailTally: does every child in the sponsor pool end up either
//     emailed or explicitly still outstanding? The buckets add up to the pool.

import { createClient } from "./supabase/client";
import { describeDbError } from "./permissions";
import { getActiveAssignment, getPrintableCardLabel, getSponsorPoolCards } from "./queries";
import type { Assignment, DataBundle } from "./types";

// This season's drop-off instructions (Grant, 2026-11-18). Fixed text, not
// app_settings: the days/deadline columns there were never filled in, and
// there's no screen to edit them. Update these for next season.
export const DROPOFF_INSTRUCTIONS = [
  "Bring your gifts to the Reach Christmas table at OneLife Church.",
  "You can drop them off starting November 21. All gifts are due by December 6.",
  "Bring the gifts in a bag. Please DO NOT WRAP them.",
  "You don't need to print out the card or bring any IDs.",
];

export interface SponsorEmailCard {
  assignmentId: string;
  cardNumber: string;
  firstName: string;
  grade: string | null;
  emailedAt: string | null;
  isConfidential: boolean;
  /** This card's block in the plain-text email. */
  text: string;
}

/** Active cards assigned to one roster entry, sorted by card number. */
export function getSponsorEmailCards(data: DataBundle, sponsorFamilyId: string): SponsorEmailCard[] {
  const sponsorIds = new Set(data.sponsors.filter((s) => s.sponsorFamilyId === sponsorFamilyId).map((s) => s.id));
  return data.assignments
    .filter((a) => a.status !== "cancelled" && sponsorIds.has(a.sponsorId))
    .flatMap((a) => {
      const card = data.cards.find((c) => c.id === a.cardId);
      const child = card && data.children.find((c) => c.id === card.childId);
      if (!card || !child) return [];
      const family = data.families.find((f) => f.id === child.familyId);
      const cardNumber = getPrintableCardLabel(data, card, child);
      const wishlist = data.wishlistItems
        .filter((w) => w.childId === child.id)
        .sort((x, y) => x.position - y.position)
        .map((w) => w.description);
      // Sponsors get M/F but not age (Grant, 2026-11-18).
      const sex = (child.sex ?? "").trim().toUpperCase();
      // Only "M" or "F"; "Prefer not to say", blank, or free text stays off.
      const sexLabel = sex === "M" || sex === "F" ? sex : null;
      const about = [child.grade ? `grade ${child.grade}` : null, sexLabel].filter(Boolean).join(", ");
      const text =
        `${child.firstName}${about ? ` (${about})` : ""}, card ${cardNumber}\n` +
        `  Sizes: pants ${child.pantSize ?? "n/a"}, shirt ${child.shirtSize ?? "n/a"}, shoes ${child.shoeSize ?? "n/a"}\n` +
        (wishlist.length ? `  Wish list:\n${wishlist.map((w) => `    - ${w}`).join("\n")}\n` : "") +
        (child.specificNeeds ? `  Notes: ${child.specificNeeds}\n` : "");
      return [
        {
          assignmentId: a.id,
          cardNumber,
          firstName: child.firstName,
          grade: child.grade,
          emailedAt: a.cardEmailedAt,
          isConfidential: family?.isConfidential ?? false,
          text,
        },
      ];
    })
    .sort((x, y) => x.cardNumber.localeCompare(y.cardNumber, undefined, { numeric: true }));
}

export function buildSponsorCardEmail(sponsorName: string, cards: SponsorEmailCard[]): { subject: string; body: string } {
  const many = cards.length > 1;
  const numbers = cards.map((c) => c.cardNumber).join(", ");
  // Card numbers in the subject so the Sent folder can be searched by card.
  const subject = many
    ? `Reach Christmas: the children you're sponsoring (${numbers})`
    : `Reach Christmas: the child you're sponsoring, ${cards[0]?.firstName ?? ""} (${numbers})`;
  const body =
    `Hi ${sponsorName},\n\n` +
    `Thank you for sponsoring this Christmas! Here ${many ? `are the ${cards.length} children` : "is the child"} ` +
    `you're shopping for.\n\n` +
    cards.map((c) => c.text).join("\n") +
    `\nDropping off your gifts:\n` +
    DROPOFF_INSTRUCTIONS.map((line) => `- ${line}`).join("\n") +
    `\n\nThank you for partnering with us this season.`;
  return { subject, body };
}

type Result = { ok: true } | { ok: false; error: string };

/** Stamps card_emailed_at on the given assignments. Already-stamped ones keep their first date. */
export async function markCardsEmailed(assignmentIds: string[]): Promise<Result> {
  if (assignmentIds.length === 0) return { ok: true };
  const { error } = await createClient()
    .from("assignments")
    .update({ card_emailed_at: new Date().toISOString() })
    .in("id", assignmentIds)
    .is("card_emailed_at", null);
  return error ? { ok: false, error: describeDbError(error) } : { ok: true };
}

/** Undo for a mis-click: puts the cards back to "not emailed yet". */
export async function unmarkCardsEmailed(assignmentIds: string[]): Promise<Result> {
  if (assignmentIds.length === 0) return { ok: true };
  const { error } = await createClient()
    .from("assignments")
    .update({ card_emailed_at: null })
    .in("id", assignmentIds);
  return error ? { ok: false, error: describeDbError(error) } : { ok: true };
}

export interface CardEmailTally {
  /** Every card in the sponsor pool (same pool as the Dashboard). The five buckets below add up to this. */
  poolTotal: number;
  emailed: number;
  notEmailed: number;
  /** Roster sponsors who still have at least one not-emailed card. */
  sponsorsToEmail: number;
  /** Claimed on the public sponsor page, not through the roster. */
  claimedOnline: number;
  /** No active assignment, not confidential: still on the Assign page. */
  noSponsor: number;
  /** No active assignment and confidential: matched outside the app today (US-65). */
  confidentialUnmatched: number;
}

export function getCardEmailTally(data: DataBundle): CardEmailTally {
  const tally: CardEmailTally = {
    poolTotal: 0,
    emailed: 0,
    notEmailed: 0,
    sponsorsToEmail: 0,
    claimedOnline: 0,
    noSponsor: 0,
    confidentialUnmatched: 0,
  };
  const familiesToEmail = new Set<string>();
  for (const { card, child } of getSponsorPoolCards(data)) {
    tally.poolTotal++;
    const a: Assignment | undefined = getActiveAssignment(data, card.id);
    if (!a) {
      const confidential = data.families.find((f) => f.id === child.familyId)?.isConfidential ?? false;
      if (confidential) tally.confidentialUnmatched++;
      else tally.noSponsor++;
      continue;
    }
    const sponsor = data.sponsors.find((s) => s.id === a.sponsorId);
    if (!sponsor?.sponsorFamilyId) {
      tally.claimedOnline++;
    } else if (a.cardEmailedAt) {
      tally.emailed++;
    } else {
      tally.notEmailed++;
      familiesToEmail.add(sponsor.sponsorFamilyId);
    }
  }
  tally.sponsorsToEmail = familiesToEmail.size;
  return tally;
}

/** navigator.clipboard needs a secure context; fall back to a hidden textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
