// Staff-side read functions over a DataBundle, shaped like the equivalent SQL
// views in SCHEMA.md (child_card_numbers, cards_needing_print,
// printable_cards). The DataBundle itself comes from lib/store.tsx, which
// fetches the base tables from Supabase — these functions just do the same
// derivation client-side rather than re-querying per view. The public,
// anonymous sponsor page does NOT use this file; it queries the
// public_available_cards view directly (see app/sponsor/SponsorBrowser.tsx),
// since that view enforces its own security boundary independent of RLS.
import type {
  Assignment,
  AssignmentStatus,
  CardRecord,
  Child,
  DataBundle,
  DistributionMethod,
} from "./types";

export const OVERDUE_WARNING_DAYS = 10;
export const OVERDUE_CRITICAL_DAYS = 21;

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function getFamily(data: DataBundle, familyId: string) {
  const family = data.families.find((f) => f.id === familyId);
  if (!family) throw new Error(`Unknown family ${familyId}`);
  return family;
}

function getDriveSchool(data: DataBundle, driveSchoolId: string | null) {
  if (!driveSchoolId) return null;
  return data.driveSchools.find((ds) => ds.id === driveSchoolId) ?? null;
}

/** Mirrors the `child_card_numbers` view: base identifier like "B1.2" — no copy count. */
export function getChildCardNumber(data: DataBundle, child: Child): string {
  const family = getFamily(data, child.familyId);
  const driveSchool = getDriveSchool(data, family.driveSchoolId);
  const code = driveSchool?.code ?? "Z";
  return `${code}${family.familyNumber}.${child.childIndex}`;
}

/**
 * Mirrors `printable_cards`: the full label including copy count, e.g. "B1.2 (1/2)".
 * Print-room use only — this is deliberately NOT used on the sponsor page or
 * the general admin views. See SCHEMA.md's "Public (sponsor-facing) access"
 * section for why: sponsors and most admin views have no use for which
 * physical copy a card is, and showing it there is confusing, not helpful.
 */
export function getPrintableCardLabel(data: DataBundle, card: CardRecord, child: Child): string {
  const base = getChildCardNumber(data, child);
  return card.totalCopies > 1 ? `${base} (${card.copyNumber}/${card.totalCopies})` : base;
}

/** The one active (non-cancelled) assignment for a card, if any. */
export function getActiveAssignment(data: DataBundle, cardId: string): Assignment | undefined {
  return data.assignments.find((a) => a.cardId === cardId && a.status !== "cancelled");
}

/**
 * Confidential children only ever show a first initial to non-admin staff —
 * admins still see the full name. This is a presentation-layer redaction on
 * top of (not instead of) RLS: RLS already decides whether a non-cleared
 * volunteer can see the row exists at all; this just limits how much a
 * cleared volunteer sees of it in shared/glanceable views (tables, printed
 * cards). The dedicated family edit form deliberately does NOT use this —
 * whoever can reach that page for a confidential family already has
 * legitimate access to the real name, and needs it to actually edit the
 * record correctly.
 */
export function displayFirstName(firstName: string, isConfidential: boolean, viewerIsAdmin: boolean): string {
  if (!isConfidential || viewerIsAdmin) return firstName;
  const initial = firstName.trim().charAt(0);
  return initial ? `${initial}.` : "";
}

export interface CardsNeedingPrintRow {
  childId: string;
  firstName: string;
  isConfidential: boolean;
  cardNumber: string;
  targetCardCount: number;
  cardsGenerated: number;
  cardsNotYetPrinted: number;
}

/** Mirrors `cards_needing_print`: the "recommend cards to print" report. */
export function getCardsNeedingPrint(data: DataBundle): CardsNeedingPrintRow[] {
  return data.children
    .map((child) => {
      const childCards = data.cards.filter((c) => c.childId === child.id);
      const cardsNotYetPrinted = childCards.filter((c) => !c.printedAt).length;
      return {
        childId: child.id,
        firstName: child.firstName,
        isConfidential: getFamily(data, child.familyId).isConfidential,
        cardNumber: getChildCardNumber(data, child),
        targetCardCount: child.targetCardCount,
        cardsGenerated: childCards.length,
        cardsNotYetPrinted,
      };
    })
    .filter((row) => row.cardsGenerated < row.targetCardCount || row.cardsNotYetPrinted > 0);
}

export type OverdueSeverity = "warning" | "critical";

export interface OverdueAssignmentRow {
  assignmentId: string;
  cardNumber: string;
  childFirstName: string;
  isConfidential: boolean;
  sponsorName: string;
  sponsorPhone: string | null;
  sponsorEmail: string | null;
  status: AssignmentStatus;
  daysSinceClaimed: number;
  severity: OverdueSeverity;
}

/** Sponsors who claimed a card but haven't gotten it to the church yet. */
export function getOverdueAssignments(data: DataBundle): OverdueAssignmentRow[] {
  return data.assignments
    .filter((a) => a.status === "pledged" || a.status === "purchased")
    .map((a) => ({ assignment: a, days: daysSince(a.claimedAt) }))
    .filter(({ days }) => days >= OVERDUE_WARNING_DAYS)
    .map(({ assignment: a, days }) => {
      const card = data.cards.find((c) => c.id === a.cardId)!;
      const child = data.children.find((c) => c.id === card.childId)!;
      const sponsor = data.sponsors.find((s) => s.id === a.sponsorId)!;
      return {
        assignmentId: a.id,
        cardNumber: getChildCardNumber(data, child),
        childFirstName: child.firstName,
        isConfidential: getFamily(data, child.familyId).isConfidential,
        sponsorName: sponsor.name,
        sponsorPhone: sponsor.phone,
        sponsorEmail: sponsor.email,
        status: a.status,
        daysSinceClaimed: days,
        severity: (days >= OVERDUE_CRITICAL_DAYS ? "critical" : "warning") as OverdueSeverity,
      };
    })
    .sort((a, b) => b.daysSinceClaimed - a.daysSinceClaimed);
}

export interface AdminCardRow {
  cardId: string;
  cardNumber: string;
  status: AssignmentStatus | "unclaimed";
  sponsorName: string | null;
  daysSinceClaimed: number | null;
  printedAt: string | null;
}

export interface AdminChildRow {
  childId: string;
  firstName: string;
  grade: string | null;
  cardNumber: string;
  cards: AdminCardRow[];
}

export interface AdminFamilyRow {
  familyId: string;
  driveSchoolId: string | null;
  schoolName: string | null;
  familyNumber: number;
  isConfidential: boolean;
  sortTag: string | null;
  children: AdminChildRow[];
}

/** Everything staff need to see, confidential families included (see SCHEMA.md RLS notes — in the real app this query only runs for authenticated staff). */
export function getAdminFamilies(data: DataBundle): AdminFamilyRow[] {
  return data.families.map((family) => {
    const driveSchool = getDriveSchool(data, family.driveSchoolId);
    const school = driveSchool ? data.schools.find((s) => s.id === driveSchool.schoolId) : null;
    const familyChildren = data.children.filter((c) => c.familyId === family.id);

    return {
      familyId: family.id,
      driveSchoolId: family.driveSchoolId,
      schoolName: school?.name ?? null,
      familyNumber: family.familyNumber,
      isConfidential: family.isConfidential,
      sortTag: family.sortTag,
      children: familyChildren.map((child) => {
        const childCards = data.cards.filter((c) => c.childId === child.id);
        return {
          childId: child.id,
          firstName: child.firstName,
          grade: child.grade,
          cardNumber: getChildCardNumber(data, child),
          cards: childCards.map((card) => {
            const active = getActiveAssignment(data, card.id);
            const sponsor = active ? data.sponsors.find((s) => s.id === active.sponsorId) ?? null : null;
            return {
              cardId: card.id,
              cardNumber: getChildCardNumber(data, child),
              status: active?.status ?? "unclaimed",
              sponsorName: sponsor?.name ?? null,
              daysSinceClaimed: active ? daysSince(active.claimedAt) : null,
              printedAt: card.printedAt,
            };
          }),
        };
      }),
    };
  });
}

export interface DashboardStats {
  totalChildren: number;
  totalCards: number;
  cardsClaimed: number;
  cardsAvailable: number;
  cardsDelivered: number;
  overdueCount: number;
}

export function getDashboardStats(data: DataBundle): DashboardStats {
  const cardsClaimed = data.cards.filter((c) => getActiveAssignment(data, c.id)).length;
  const cardsDelivered = data.assignments.filter((a) => a.status === "delivered").length;

  return {
    totalChildren: data.children.length,
    totalCards: data.cards.length,
    cardsClaimed,
    cardsAvailable: data.cards.length - cardsClaimed,
    cardsDelivered,
    overdueCount: getOverdueAssignments(data).length,
  };
}

export interface SchoolRow {
  driveSchoolId: string;
  schoolId: string;
  name: string;
  code: string;
  liaisonName: string | null;
  liaisonPhone: string | null;
  liaisonEmail: string | null;
  distributionMethod: DistributionMethod | null;
  familyCount: number;
}

/** Schools participating in the current drive, with a family count for context. */
export function getSchoolsForDrive(data: DataBundle): SchoolRow[] {
  return data.driveSchools
    .filter((ds) => ds.driveId === data.drive.id)
    .map((ds) => {
      const school = data.schools.find((s) => s.id === ds.schoolId)!;
      const familyCount = data.families.filter((f) => f.driveSchoolId === ds.id).length;
      return {
        driveSchoolId: ds.id,
        schoolId: school.id,
        name: school.name,
        code: ds.code,
        liaisonName: ds.liaisonName,
        liaisonPhone: ds.liaisonPhone,
        liaisonEmail: ds.liaisonEmail,
        distributionMethod: ds.distributionMethod,
        familyCount,
      };
    });
}

/** Which status an assignment moves to next when staff click "advance" (fulfillment page). */
export const NEXT_STATUS: Partial<Record<AssignmentStatus, AssignmentStatus>> = {
  pledged: "purchased",
  purchased: "received_at_church",
  received_at_church: "delivered",
};

// The fulfillment board's columns, left to right. "unassigned" isn't a real
// assignment_status — it's a card with no active (non-cancelled) assignment
// at all, whether never claimed or claimed-then-cancelled.
export type FulfillmentColumn = "unassigned" | "pledged" | "purchased" | "received_at_church" | "delivered";

export const FULFILLMENT_COLUMNS: { value: FulfillmentColumn; label: string }[] = [
  { value: "unassigned", label: "Unassigned" },
  { value: "pledged", label: "Pledged" },
  { value: "purchased", label: "Purchased" },
  { value: "received_at_church", label: "Received at church" },
  { value: "delivered", label: "Delivered" },
];

export interface FulfillmentCard {
  cardId: string;
  cardNumber: string;
  childFirstName: string;
  isConfidential: boolean;
  column: FulfillmentColumn;
  assignmentId: string | null;
  sponsorName: string | null;
  sponsorPhone: string | null;
  sponsorEmail: string | null;
  daysSinceClaimed: number | null;
  overdueSeverity: OverdueSeverity | null;
}

/**
 * Every card, grouped into the same five buckets staff think in — including
 * cards nobody has claimed at all, which the old assignment-only view had no
 * way to show. Delivered cards stay on the board (as their own column) rather
 * than disappearing once fulfilled, so the board reflects the whole season,
 * not just what's still outstanding.
 */
export function getFulfillmentBoard(data: DataBundle): FulfillmentCard[] {
  const board: FulfillmentCard[] = [];

  for (const card of data.cards) {
    const active = getActiveAssignment(data, card.id);

    const child = data.children.find((c) => c.id === card.childId)!;
    const cardNumber = getChildCardNumber(data, child);
    const isConfidential = getFamily(data, child.familyId).isConfidential;

    if (!active) {
      board.push({
        cardId: card.id,
        cardNumber,
        childFirstName: child.firstName,
        isConfidential,
        column: "unassigned",
        assignmentId: null,
        sponsorName: null,
        sponsorPhone: null,
        sponsorEmail: null,
        daysSinceClaimed: null,
        overdueSeverity: null,
      });
      continue;
    }

    const sponsor = data.sponsors.find((s) => s.id === active.sponsorId)!;
    const days = daysSince(active.claimedAt);
    const isDelivered = active.status === "delivered";
    board.push({
      cardId: card.id,
      cardNumber,
      childFirstName: child.firstName,
      isConfidential,
      column: active.status as FulfillmentColumn,
      assignmentId: active.id,
      sponsorName: sponsor.name,
      sponsorPhone: sponsor.phone,
      sponsorEmail: sponsor.email,
      daysSinceClaimed: days,
      overdueSeverity: isDelivered
        ? null
        : days >= OVERDUE_WARNING_DAYS
          ? days >= OVERDUE_CRITICAL_DAYS
            ? "critical"
            : "warning"
          : null,
    });
  }

  return board.sort((a, b) => (b.daysSinceClaimed ?? -1) - (a.daysSinceClaimed ?? -1));
}

export interface DistributionRow {
  familyId: string;
  driveSchoolId: string | null;
  schoolName: string | null;
  isConfidential: boolean;
  familyNumber: number;
  /** Resolved: this family's override, else the school's, else the drive default — what will actually happen. */
  distributionMethod: DistributionMethod | null;
  /** Raw per-family override, or null if this family just inherits — lets the edit UI distinguish "set to X" from "not set." */
  distributionMethodOverride: DistributionMethod | null;
  scheduledPickupAt: string | null;
  checkedInAt: string | null;
  totalChildren: number;
  totalCards: number;
  deliveredCards: number;
}

/** One row per family — resolves distribution method (family override > school override > drive default) and rolls up how many of the family's cards have actually reached "delivered." */
export function getDistributionRows(data: DataBundle): DistributionRow[] {
  return data.families.map((family) => {
    const driveSchool = getDriveSchool(data, family.driveSchoolId);
    const school = driveSchool ? data.schools.find((s) => s.id === driveSchool.schoolId) : null;
    const familyChildren = data.children.filter((c) => c.familyId === family.id);
    const childIds = new Set(familyChildren.map((c) => c.id));
    const familyCards = data.cards.filter((c) => childIds.has(c.childId));
    const deliveredCards = familyCards.filter((c) => getActiveAssignment(data, c.id)?.status === "delivered").length;

    const distributionMethod =
      family.distributionMethodOverride ?? driveSchool?.distributionMethod ?? data.drive.defaultDistributionMethod;

    return {
      familyId: family.id,
      driveSchoolId: family.driveSchoolId,
      schoolName: school?.name ?? null,
      isConfidential: family.isConfidential,
      familyNumber: family.familyNumber,
      distributionMethod,
      distributionMethodOverride: family.distributionMethodOverride,
      scheduledPickupAt: family.scheduledPickupAt,
      checkedInAt: family.checkedInAt,
      totalChildren: familyChildren.length,
      totalCards: familyCards.length,
      deliveredCards,
    };
  });
}

export interface PrintableCardRow {
  cardId: string;
  displayLabel: string;
  firstName: string;
  isConfidential: boolean;
  grade: string | null;
  wishlist: string[];
  pantSize: string | null;
  shirtSize: string | null;
  shoeSize: string | null;
  specificNeeds: string | null;
  printedAt: string | null;
}

/** Mirrors `printable_cards`, grouping each card's wishlist items (the view is one-row-per-item; this is one-row-per-card for a print layout). */
export function getPrintableCards(data: DataBundle): PrintableCardRow[] {
  return data.cards.map((card) => {
    const child = data.children.find((c) => c.id === card.childId)!;
    const wishlist = data.wishlistItems
      .filter((w) => w.childId === child.id)
      .sort((a, b) => a.position - b.position)
      .map((w) => w.description);
    return {
      cardId: card.id,
      displayLabel: getPrintableCardLabel(data, card, child),
      firstName: child.firstName,
      isConfidential: getFamily(data, child.familyId).isConfidential,
      grade: child.grade,
      wishlist,
      pantSize: child.pantSize,
      shirtSize: child.shirtSize,
      shoeSize: child.shoeSize,
      specificNeeds: child.specificNeeds,
      printedAt: card.printedAt,
    };
  });
}
