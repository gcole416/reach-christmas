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

export interface CardsNeedingPrintRow {
  childId: string;
  firstName: string;
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
