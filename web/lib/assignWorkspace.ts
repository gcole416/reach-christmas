// The Assign sponsors workspace (US-62): pure data shaping for the
// sponsor-first matching page and its "Suggest matches" draft.
//
// Built for the real season size (~200 children, ~150 roster entries), so it
// indexes the bundle into Maps once per render instead of the repeated
// `.find()` scans getSponsorFamilies / getAssignableCards do, which go
// quadratic at that size.
//
// The pool is exactly getAssignableCards' pool: sponsor-pool cards
// (no high schoolers, nobody on hold) with no active assignment, in
// non-confidential households. assign_card_to_sponsor_family refuses a
// confidential card, so this never offers one.

import type { DataBundle } from "@/lib/types";
import { getChildCardNumber, getHouseholdTag, getSponsorPoolCards } from "@/lib/queries";

export interface WaitingChild {
  cardId: string;
  cardNumber: string;
  firstName: string;
  childIndex: number;
  grade: string | null;
  age: number | null;
  sex: string | null;
  shirtSize: string | null;
}

export interface AssignedSibling {
  firstName: string;
  sponsorFamilyId: string | null;
  sponsorFamilyName: string | null;
}

export interface WaitingHousehold {
  familyId: string;
  familyNumber: number;
  householdTag: string;
  schoolName: string | null;
  driveSchoolId: string | null;
  children: WaitingChild[];
  /** Siblings in this household who already have a sponsor. */
  assignedSiblings: AssignedSibling[];
}

export interface RosterEntry {
  id: string;
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  capacity: number | null;
  createdAt: string;
  assignedCount: number;
  /** capacity - assigned (can go negative when over); null when no capacity is set. */
  open: number | null;
  assignedChildren: { firstName: string; cardNumber: string }[];
}

export interface AssignSummary {
  /** Non-confidential sponsor-pool cards: the ones this page can ever assign. */
  poolTotal: number;
  assigned: number;
  waiting: number;
  /** Sum of open room across active entries that have a capacity. */
  openSlots: number;
  /** Active entries with no capacity set (their room is unknown). */
  noCapacityCount: number;
  /** Unassigned children in confidential households: matched outside this page. */
  confidentialWaiting: number;
}

export interface AssignWorkspace {
  households: WaitingHousehold[];
  /** Active roster entries only (inactive = "not taking more"). */
  roster: RosterEntry[];
  summary: AssignSummary;
}

// "Not in school yet" < Pre-K < K < 1 … 12, for sorting and the grade filter.
const GRADE_ORDER = ["Not in school yet", "Pre-K", "K", ...Array.from({ length: 12 }, (_, i) => String(i + 1))];
export function gradeRank(grade: string | null): number {
  const i = grade ? GRADE_ORDER.indexOf(grade) : -1;
  return i === -1 ? 99 : i;
}

export function buildAssignWorkspace(data: DataBundle): AssignWorkspace {
  const activeByCard = new Map<string, DataBundle["assignments"][number]>();
  for (const a of data.assignments) if (a.status !== "cancelled") activeByCard.set(a.cardId, a);
  const sponsorById = new Map(data.sponsors.map((s) => [s.id, s]));
  const sfById = new Map(data.sponsorFamilies.map((sf) => [sf.id, sf]));
  const familyById = new Map(data.families.map((f) => [f.id, f]));
  const cardByChild = new Map(data.cards.map((c) => [c.childId, c]));
  const cardById = new Map(data.cards.map((c) => [c.id, c]));
  const childById = new Map(data.children.map((c) => [c.id, c]));
  const schoolNameByDriveSchool = new Map(
    data.driveSchools.map((ds) => [ds.id, data.schools.find((s) => s.id === ds.schoolId)?.name ?? null]),
  );

  const sponsorFamilyIdOf = (assignment: DataBundle["assignments"][number] | undefined) =>
    assignment ? sponsorById.get(assignment.sponsorId)?.sponsorFamilyId ?? null : null;

  // --- the pool --------------------------------------------------------------
  const pool = getSponsorPoolCards(data).filter(
    ({ child }) => !familyById.get(child.familyId)?.isConfidential,
  );
  let confidentialWaiting = 0;
  for (const { card, child } of getSponsorPoolCards(data)) {
    if (familyById.get(child.familyId)?.isConfidential && !activeByCard.has(card.id)) confidentialWaiting++;
  }

  const byFamily = new Map<string, WaitingHousehold>();
  for (const { card, child } of pool) {
    if (activeByCard.has(card.id)) continue;
    const family = familyById.get(child.familyId)!;
    let hh = byFamily.get(family.id);
    if (!hh) {
      hh = {
        familyId: family.id,
        familyNumber: family.familyNumber,
        householdTag: getHouseholdTag(data, family),
        schoolName: family.driveSchoolId ? schoolNameByDriveSchool.get(family.driveSchoolId) ?? null : null,
        driveSchoolId: family.driveSchoolId,
        children: [],
        assignedSiblings: [],
      };
      byFamily.set(family.id, hh);
    }
    hh.children.push({
      cardId: card.id,
      cardNumber: getChildCardNumber(data, child),
      firstName: child.firstName,
      childIndex: child.childIndex,
      grade: child.grade,
      age: child.age,
      sex: child.sex,
      shirtSize: child.shirtSize,
    });
  }

  // Siblings who already have a sponsor (only for households still waiting).
  for (const child of data.children) {
    const hh = byFamily.get(child.familyId);
    if (!hh || hh.children.some((c) => cardByChild.get(child.id)?.id === c.cardId)) continue;
    const card = cardByChild.get(child.id);
    const active = card ? activeByCard.get(card.id) : undefined;
    if (!active) continue;
    const sfId = sponsorFamilyIdOf(active);
    hh.assignedSiblings.push({
      firstName: child.firstName,
      sponsorFamilyId: sfId,
      sponsorFamilyName: sfId ? sfById.get(sfId)?.displayName ?? null : null,
    });
  }

  const households = [...byFamily.values()];
  for (const hh of households) hh.children.sort((a, b) => a.childIndex - b.childIndex);
  households.sort(
    (a, b) =>
      (a.schoolName ?? "￿").localeCompare(b.schoolName ?? "￿") || a.familyNumber - b.familyNumber,
  );

  // --- the roster ------------------------------------------------------------
  const assignedBySf = new Map<string, { firstName: string; cardNumber: string }[]>();
  for (const a of activeByCard.values()) {
    const sfId = sponsorFamilyIdOf(a);
    if (!sfId) continue;
    const card = cardById.get(a.cardId);
    const child = card ? childById.get(card.childId) : undefined;
    const list = assignedBySf.get(sfId) ?? [];
    list.push(child ? { firstName: child.firstName, cardNumber: getChildCardNumber(data, child) } : { firstName: "?", cardNumber: "" });
    assignedBySf.set(sfId, list);
  }

  const roster: RosterEntry[] = data.sponsorFamilies
    .filter((sf) => sf.driveId === data.drive.id && sf.isActive)
    .map((sf) => {
      const assignedChildren = assignedBySf.get(sf.id) ?? [];
      return {
        id: sf.id,
        displayName: sf.displayName,
        contactEmail: sf.contactEmail,
        contactPhone: sf.contactPhone,
        notes: sf.notes,
        capacity: sf.capacity,
        createdAt: sf.createdAt,
        assignedCount: assignedChildren.length,
        open: sf.capacity == null ? null : sf.capacity - assignedChildren.length,
        assignedChildren,
      };
    });

  // --- summary ---------------------------------------------------------------
  const waiting = households.reduce((n, hh) => n + hh.children.length, 0);
  const summary: AssignSummary = {
    poolTotal: pool.length,
    assigned: pool.length - waiting,
    waiting,
    openSlots: roster.reduce((n, r) => n + Math.max(0, r.open ?? 0), 0),
    noCapacityCount: roster.filter((r) => r.capacity == null).length,
    confidentialWaiting,
  };

  return { households, roster, summary };
}

/** Most open room first; entries with no capacity set after those with room;
 *  full ones last. Ties keep sign-up order. */
export function sortRosterByRoom(roster: RosterEntry[]): RosterEntry[] {
  const bucket = (r: RosterEntry) => (r.open == null ? 1 : r.open > 0 ? 0 : 2);
  return [...roster].sort(
    (a, b) =>
      bucket(a) - bucket(b) ||
      (b.open ?? 0) - (a.open ?? 0) ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

// =============================================================================
// Suggest matches: a draft, never a write. Staff review it and save.
// =============================================================================

/** A household (or, when split, the part of it) going to one sponsor. */
export interface DraftHousehold extends WaitingHousehold {
  /** Set when the household was too big for any one sponsor: how many sponsors share it. */
  splitAcross?: number;
}

export interface DraftMatch {
  sponsorFamilyId: string;
  households: DraftHousehold[];
}

export interface DraftUnplaced {
  household: WaitingHousehold;
  reason: string;
}

export interface MatchDraft {
  matches: DraftMatch[];
  unplaced: DraftUnplaced[];
  /** Entries with no capacity set, treated as room for 1 in this draft. */
  assumedCapacityIds: string[];
}

/**
 * Fills sponsors in sign-up order with WHOLE households, never splitting one:
 *   1. A household whose already-assigned siblings all share one sponsor goes
 *      to that sponsor if it has room (keeps the family together).
 *   2. Then households, biggest first, each go whole to the earliest sign-up
 *      with room for all of them. One too big for any single sponsor is split
 *      across as few sponsors as possible (most room first), while the roomy
 *      sponsors are still free, and marked `splitAcross` for staff to see.
 *      Only when room runs out entirely does a household stay unplaced.
 * Never puts a sponsor over its capacity. An entry with no capacity set counts
 * as room for 1. Free-text notes are NOT read, which is why this is a draft
 * for staff to review.
 */
export function suggestMatches(households: WaitingHousehold[], roster: RosterEntry[]): MatchDraft {
  const remaining = new Map<string, number>();
  const assumedCapacityIds: string[] = [];
  for (const r of roster) {
    if (r.capacity == null) {
      assumedCapacityIds.push(r.id);
      remaining.set(r.id, Math.max(0, 1 - r.assignedCount));
    } else {
      remaining.set(r.id, Math.max(0, r.capacity - r.assignedCount));
    }
  }
  const bySponsor = new Map<string, DraftHousehold[]>();
  const place = (sfId: string, hh: DraftHousehold) => {
    bySponsor.set(sfId, [...(bySponsor.get(sfId) ?? []), hh]);
    remaining.set(sfId, (remaining.get(sfId) ?? 0) - hh.children.length);
  };
  const placed = new Set<string>();

  // 1. Sibling continuity.
  for (const hh of households) {
    const ids = new Set(hh.assignedSiblings.map((s) => s.sponsorFamilyId));
    if (ids.size !== 1) continue;
    const [sfId] = [...ids];
    if (sfId && (remaining.get(sfId) ?? 0) >= hh.children.length) {
      place(sfId, hh);
      placed.add(hh.familyId);
    }
  }

  // 2. Biggest households first. Each goes whole to the earliest sign-up with
  //    room for all of them; a household too big for any one sponsor is split
  //    right then, while the roomiest sponsors are still free, across as few
  //    sponsors as possible (most room first) and marked `splitAcross`.
  const signUpOrder = [...roster].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Households that can never fit one sponsor (bigger than the roomiest
  // sponsor's room) go last, so they don't use up room a whole household
  // needs; everything else goes whole, biggest first.
  const maxRoomAtStart = Math.max(0, ...remaining.values());
  const bySize = households
    .filter((hh) => !placed.has(hh.familyId))
    .sort(
      (a, b) =>
        Number(a.children.length > maxRoomAtStart) - Number(b.children.length > maxRoomAtStart) ||
        b.children.length - a.children.length,
    );
  const unplaced: DraftUnplaced[] = [];
  for (const hh of bySize) {
    const fit = signUpOrder.find((r) => (remaining.get(r.id) ?? 0) >= hh.children.length);
    if (fit) {
      place(fit.id, hh);
      continue;
    }
    const totalRoom = [...remaining.values()].reduce((n, v) => n + Math.max(0, v), 0);
    if (totalRoom < hh.children.length) {
      unplaced.push({
        household: hh,
        reason:
          totalRoom === 0
            ? "No sponsor room left"
            : `Only ${totalRoom} sponsor ${totalRoom === 1 ? "spot" : "spots"} left for ${hh.children.length} children`,
      });
      continue;
    }
    const parts: { sfId: string; children: WaitingChild[] }[] = [];
    let rest = [...hh.children];
    while (rest.length > 0) {
      let bestId = signUpOrder[0].id;
      for (const r of signUpOrder) {
        if ((remaining.get(r.id) ?? 0) > (remaining.get(bestId) ?? 0)) bestId = r.id;
      }
      const room = remaining.get(bestId) ?? 0;
      parts.push({ sfId: bestId, children: rest.slice(0, room) });
      remaining.set(bestId, room - Math.min(room, rest.length));
      rest = rest.slice(room);
    }
    for (const part of parts) {
      bySponsor.set(part.sfId, [
        ...(bySponsor.get(part.sfId) ?? []),
        { ...hh, children: part.children, splitAcross: parts.length },
      ]);
    }
  }

  const matches: DraftMatch[] = signUpOrder
    .filter((r) => bySponsor.has(r.id))
    .map((r) => ({ sponsorFamilyId: r.id, households: bySponsor.get(r.id)! }));

  return { matches, unplaced, assumedCapacityIds };
}
