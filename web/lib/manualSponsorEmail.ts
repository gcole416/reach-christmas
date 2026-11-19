"use client";

// Manual card emails (email is off, so staff send cards from their own
// mailbox). Two halves:
//   * buildSponsorCardEmail: the same email text send-sponsor-emails would
//     send (supabase/functions/send-sponsor-emails/index.ts buildEmail), ready
//     to paste into Gmail/Outlook.
//   * markCardsEmailed / unmarkCardsEmailed: set or clear
//     assignments.card_emailed_at, the same column the automatic email sets,
//     so the roster's "not emailed yet" count and "Email all assigned" both
//     treat a hand-sent card as sent. Staff already have update rights on
//     assignments ("staff update assignments", init.sql) and every change is
//     in audit_log, so no new database function is needed.
//   * getCardEmailTally: does every child in the sponsor pool end up either
//     emailed or explicitly still outstanding? The buckets add up to the pool.

import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";
import { describeDbError } from "./permissions";
import { getActiveAssignment, getPrintableCardLabel, getSponsorPoolCards } from "./queries";
import type { Assignment, DataBundle } from "./types";

export interface DropoffInfo {
  location: string | null;
  days: string | null;
  deadline: string | null;
}

// Drop-off details for the email and the card PDFs. Starts from
// app_settings (admin-only, so a volunteer starts blank, and the seeded
// "[... not set yet ...]" placeholders count as blank), then whatever this
// browser last typed into the modal wins, so it's entered once, not per
// sponsor. Church info, not family data, so localStorage is fine.
const DROPOFF_STORAGE_KEY = "reach.manualEmail.dropoff";

function readSavedDropoff(): Partial<DropoffInfo> {
  try {
    const raw = window.localStorage.getItem(DROPOFF_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<DropoffInfo>) : {};
  } catch {
    return {};
  }
}

export function useDropoffDetails(): {
  dropoff: DropoffInfo;
  setField: (field: keyof DropoffInfo, value: string) => void;
  loaded: boolean;
} {
  const [dropoff, setDropoff] = useState<DropoffInfo>({ location: null, days: null, deadline: null });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const clean = (v: unknown) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s && !s.startsWith("[") ? s : null;
    };
    createClient()
      .from("app_settings")
      .select("dropoff_location, dropoff_days, dropoff_deadline")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const saved = readSavedDropoff();
        const pick = (k: keyof DropoffInfo, fromDb: unknown) => (saved[k]?.trim() ? saved[k]!.trim() : clean(fromDb));
        setDropoff({
          location: pick("location", data?.dropoff_location),
          days: pick("days", data?.dropoff_days),
          deadline: pick("deadline", data?.dropoff_deadline),
        });
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  function setField(field: keyof DropoffInfo, value: string) {
    setDropoff((prev) => {
      const next = { ...prev, [field]: value.trim() ? value : null };
      try {
        window.localStorage.setItem(DROPOFF_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private window etc.: the value still applies for this visit.
      }
      return next;
    });
  }
  return { dropoff, setField, loaded };
}

export interface SponsorEmailCard {
  assignmentId: string;
  cardNumber: string;
  firstName: string;
  grade: string | null;
  emailedAt: string | null;
  isConfidential: boolean;
  /** "M" or "F" only. "Prefer not to say", blank, or anything else staff typed stays off the card. */
  sexLabel: "M" | "F" | null;
  pantSize: string | null;
  shirtSize: string | null;
  shoeSize: string | null;
  wishlist: string[];
  specificNeeds: string | null;
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
      const sexLabel: SponsorEmailCard["sexLabel"] = sex === "M" || sex === "F" ? sex : null;
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
          sexLabel,
          pantSize: child.pantSize,
          shirtSize: child.shirtSize,
          shoeSize: child.shoeSize,
          wishlist,
          specificNeeds: child.specificNeeds,
          text,
        },
      ];
    })
    .sort((x, y) => x.cardNumber.localeCompare(y.cardNumber, undefined, { numeric: true }));
}

const DROPOFF_PLACEHOLDER = "[add drop-off details]";

export function buildSponsorCardEmail(
  sponsorName: string,
  cards: SponsorEmailCard[],
  dropoff: DropoffInfo | null,
  withPdfs = true,
): { subject: string; body: string } {
  const many = cards.length > 1;
  const numbers = cards.map((c) => c.cardNumber).join(", ");
  // Card numbers in the subject so the Sent folder can be searched by card.
  const subject = many
    ? `Your Reach Christmas sponsor cards (${numbers})`
    : `Your Reach Christmas sponsor card for ${cards[0]?.firstName ?? ""} (${numbers})`;
  const body =
    `Hi ${sponsorName},\n\n` +
    `Thank you for sponsoring this Christmas! Here ${many ? `are the ${cards.length} children` : "is the child"} ` +
    `you're shopping for.` +
    (withPdfs
      ? ` ${many ? "Each card is" : "The card is"} attached as a PDF, so you can print it or bring it with you shopping.`
      : "") +
    `\n\n` +
    cards.map((c) => c.text).join("\n") +
    `\nDrop-off:\n` +
    `Location: ${dropoff?.location ?? DROPOFF_PLACEHOLDER}\n` +
    `When: ${dropoff?.days ?? DROPOFF_PLACEHOLDER}\n` +
    `Deadline: ${dropoff?.deadline ?? DROPOFF_PLACEHOLDER}\n\n` +
    `Thank you for partnering with us this season.`;
  return { subject, body };
}

export function dropoffIsComplete(d: DropoffInfo | null): boolean {
  return !!(d?.location && d.days && d.deadline);
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
