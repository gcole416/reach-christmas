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
  Family,
  SponsorFamily,
} from "./types";

export const OVERDUE_WARNING_DAYS = 10;
export const OVERDUE_CRITICAL_DAYS = 21;

/**
 * Grades that put a child in the self-shopping high schooler bucket (US-32).
 * Mirrors `public.is_high_school_grade()` in
 * supabase/migrations/20260908130000_high_schooler_bucket.sql — keep the two
 * lists in sync. Used for the manual-intake / family-edit UI default; the
 * database trigger is what actually sets `children.is_high_schooler`.
 */
export const HIGH_SCHOOL_GRADES = ["9", "10", "11", "12"] as const;

export function isHighSchoolGrade(grade: string | null | undefined): boolean {
  return HIGH_SCHOOL_GRADES.includes((grade ?? "").trim() as (typeof HIGH_SCHOOL_GRADES)[number]);
}

/**
 * A child put "on hold" for duplicate review (US-38). Mirrors the
 * `and ch.held_at is null` predicate that
 * supabase/migrations/20260909120000_child_on_hold.sql adds to
 * public_available_cards / printable_cards / cards_needing_print — a held
 * child's card is out of the sponsor pool, the print run, and every count and
 * board below until an admin releases the hold. The one place a held child is
 * still surfaced is the families/household explorer (getAdminFamilies), which
 * exposes `heldAt` on the row so it can be badged and filtered.
 */
export function isChildOnHold(child: Child): boolean {
  return child.heldAt != null;
}

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

/**
 * The school-letter prefix used in a household's identifiers — the drive
 * school's `code`, falling back to "Z" for confidential / direct-referral
 * households with no school. Kept as one function so the household tag and the
 * card number can't disagree about it.
 */
export function getFamilySchoolCode(data: DataBundle, family: Family): string {
  return getDriveSchool(data, family.driveSchoolId)?.code ?? "Z";
}

/**
 * A household's app-wide tag: school code + family number, e.g. "OL1". The
 * `family_number` alone repeats across schools (each school counts from 1), so
 * this is the identifier staff should see. It is also exactly the prefix of
 * every card number under the household ("OL1.3"), so the two line up.
 */
export function getHouseholdTag(data: DataBundle, family: Family): string {
  return `${getFamilySchoolCode(data, family)}${family.familyNumber}`;
}

/** Mirrors the `child_card_numbers` view: base identifier like "OL1.2". */
export function getChildCardNumber(data: DataBundle, child: Child): string {
  const family = getFamily(data, child.familyId);
  return `${getHouseholdTag(data, family)}.${child.childIndex}`;
}

/**
 * Mirrors `printable_cards`: the print-room label for a card. As of ADM-2
 * (2026-08-18, one card per child, always) this is just the base card
 * number — the old "(1/2)" copy-count suffix no longer applies, since there's
 * nothing left to count. Kept as its own function (rather than inlined at
 * the one call site) so print-layout code has a single, stable name to call
 * regardless of how the label is computed.
 */
export function getPrintableCardLabel(data: DataBundle, card: CardRecord, child: Child): string {
  return getChildCardNumber(data, child);
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

/**
 * The intake form stores its "Boy or girl" answer as the raw option value
 * ("M" / "F" / "Prefer not to say"); staff edits can put free text in the same
 * column. Render "M"/"F" as "Boy"/"Girl" for the shopping team, pass anything
 * else through untouched.
 */
export function displayChildGender(sex: string | null): string | null {
  const t = (sex ?? "").trim();
  if (!t) return null;
  if (t === "M") return "Boy";
  if (t === "F") return "Girl";
  return t;
}

export interface CardsNeedingPrintRow {
  childId: string;
  firstName: string;
  isConfidential: boolean;
  cardNumber: string;
}

/**
 * Mirrors `cards_needing_print`: the "recommend cards to print" report. As of
 * ADM-2 (2026-08-18, one card per child, always) this is just "children whose
 * one card isn't printed yet" — there's no generated-vs-target comparison
 * left to make.
 */
export function getCardsNeedingPrint(data: DataBundle): CardsNeedingPrintRow[] {
  return data.children
    .filter((child) => {
      // High schoolers self-shop — their card is never printed (mirrors the
      // `and not ch.is_high_schooler` in the cards_needing_print view).
      if (child.isHighSchooler) return false;
      // On hold for duplicate review — mirrors `and ch.held_at is null`.
      if (isChildOnHold(child)) return false;
      const card = data.cards.find((c) => c.childId === child.id);
      return card ? !card.printedAt : false;
    })
    .map((child) => ({
      childId: child.id,
      firstName: child.firstName,
      isConfidential: getFamily(data, child.familyId).isConfidential,
      cardNumber: getChildCardNumber(data, child),
    }));
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
    // Held-for-duplicate-review children drop off "Sponsors overdue" too —
    // there's nothing to chase a sponsor about while the card is under review
    // (mirrors `and ch.held_at is null`).
    .filter(({ assignment: a }) => {
      const card = data.cards.find((c) => c.id === a.cardId);
      const child = card ? data.children.find((c) => c.id === card.childId) : undefined;
      return child ? !isChildOnHold(child) : true;
    })
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
  /** Grades 9-12: self-shops at the store shopping day, not in the sponsor pool. */
  isHighSchooler: boolean;
  /**
   * US-38: non-null when this child is on hold for duplicate review. Held
   * children stay in this list (they must stay findable) — this field is what
   * the explorer badges and filters on. `heldBy` is a profiles.id; resolve it
   * against data.profiles.
   */
  heldAt: string | null;
  heldBy: string | null;
  holdReason: string | null;
  cards: AdminCardRow[];
}

export interface AdminFamilyRow {
  familyId: string;
  driveSchoolId: string | null;
  schoolName: string | null;
  familyNumber: number;
  /** App-wide household tag, e.g. "OL1" — school code + familyNumber. */
  householdTag: string;
  isConfidential: boolean;
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
      householdTag: getHouseholdTag(data, family),
      isConfidential: family.isConfidential,
      children: familyChildren.map((child) => {
        const childCards = data.cards.filter((c) => c.childId === child.id);
        return {
          childId: child.id,
          firstName: child.firstName,
          grade: child.grade,
          cardNumber: getChildCardNumber(data, child),
          isHighSchooler: child.isHighSchooler,
          heldAt: child.heldAt,
          heldBy: child.heldBy,
          holdReason: child.holdReason,
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
  /** Children in the sponsor pool — i.e. NOT high schoolers, NOT on hold. */
  totalChildren: number;
  /** Grades 9-12: shop for their own gifts, tracked separately (US-35). Excludes held. */
  totalHighSchoolers: number;
  /** US-38: children on hold for duplicate review. Links to /admin/on-hold. */
  onHoldCount: number;
  totalCards: number;
  cardsClaimed: number;
  cardsAvailable: number;
  cardsDelivered: number;
  overdueCount: number;
}

export function getDashboardStats(data: DataBundle): DashboardStats {
  // High schoolers keep a `cards` row for schema simplicity, but it's not a
  // claimable sponsor card — every count below is over sponsored cards only,
  // matching the `not ch.is_high_schooler` filter in public_available_cards
  // and printable_cards.
  //
  // Held-for-duplicate-review children (US-38) drop out of every count here the
  // same way — `and ch.held_at is null` in those same views — and are surfaced
  // only as their own `onHoldCount` tile.
  const activeChildren = data.children.filter((c) => !isChildOnHold(c));
  const sponsoredChildIds = new Set(
    activeChildren.filter((c) => !c.isHighSchooler).map((c) => c.id),
  );
  const sponsoredCards = data.cards.filter((c) => sponsoredChildIds.has(c.childId));
  const sponsoredCardIds = new Set(sponsoredCards.map((c) => c.id));

  const cardsClaimed = sponsoredCards.filter((c) => getActiveAssignment(data, c.id)).length;
  const cardsDelivered = data.assignments.filter(
    (a) => a.status === "delivered" && sponsoredCardIds.has(a.cardId),
  ).length;

  return {
    totalChildren: sponsoredChildIds.size,
    totalHighSchoolers: activeChildren.filter((c) => c.isHighSchooler).length,
    onHoldCount: data.children.length - activeChildren.length,
    totalCards: sponsoredCards.length,
    cardsClaimed,
    cardsAvailable: sponsoredCards.length - cardsClaimed,
    cardsDelivered,
    overdueCount: getOverdueAssignments(data).length,
  };
}

/** The shop-day pipeline (US-35), lowest to highest. `attended` is the end. */
export const SHOP_DAY_STATUS_ORDER = [
  "not_contacted",
  "invited",
  "confirmed",
  "attended",
] as const satisfies readonly Child["shopDayStatus"][];

export const SHOP_DAY_STATUS_LABELS: Record<Child["shopDayStatus"], string> = {
  not_contacted: "Not contacted",
  invited: "Invited",
  confirmed: "Confirmed",
  attended: "Attended",
};

/** Which status "Mark next" moves a teen to on the shop-day board. No entry = end of the line. */
export const NEXT_SHOP_DAY_STATUS: Partial<
  Record<Child["shopDayStatus"], Child["shopDayStatus"]>
> = {
  not_contacted: "invited",
  invited: "confirmed",
  confirmed: "attended",
};

export interface HighSchoolerRow {
  childId: string;
  familyId: string;
  firstName: string;
  householdTag: string;
  schoolName: string | null;
  driveSchoolId: string | null;
  isConfidential: boolean;
  grade: string | null;
  age: number | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  shopDayStatus: Child["shopDayStatus"];
  shopDayNotes: string | null;
}

/**
 * The self-shopping high schoolers for the drive — the roster behind
 * /admin/high-schoolers and the dashboard count (US-35). One row per
 * grade-9-12 child. Confidential households are included here for cleared
 * staff exactly as they are in the families explorer; RLS is what actually
 * decides whether a given `data.children` row is present at all.
 */
export function getHighSchoolers(data: DataBundle): HighSchoolerRow[] {
  return data.children
    // On hold for duplicate review — off the roster and the shop-day board
    // until released (mirrors `and ch.held_at is null`). Still findable in the
    // families explorer.
    .filter((child) => child.isHighSchooler && !isChildOnHold(child))
    .map((child) => {
      const family = getFamily(data, child.familyId);
      const driveSchool = getDriveSchool(data, family.driveSchoolId);
      const school = driveSchool
        ? data.schools.find((s) => s.id === driveSchool.schoolId) ?? null
        : null;
      return {
        childId: child.id,
        familyId: family.id,
        firstName: child.firstName,
        householdTag: getHouseholdTag(data, family),
        schoolName: school?.name ?? null,
        driveSchoolId: family.driveSchoolId,
        isConfidential: family.isConfidential,
        grade: child.grade,
        age: child.age,
        guardianName: family.guardianName,
        guardianPhone: family.guardianPhone,
        guardianEmail: family.guardianEmail,
        shopDayStatus: child.shopDayStatus,
        shopDayNotes: child.shopDayNotes,
      };
    })
    .sort((a, b) => a.householdTag.localeCompare(b.householdTag, undefined, { numeric: true }));
}

export interface ChildOnHoldRow {
  childId: string;
  familyId: string;
  firstName: string;
  /** App-wide household tag, e.g. "OL1". */
  householdTag: string;
  schoolName: string | null;
  driveSchoolId: string | null;
  isConfidential: boolean;
  grade: string | null;
  /** Free-text reason the admin typed when placing the hold. */
  holdReason: string | null;
  heldAt: string;
  /** profiles.id of the admin who placed the hold — resolve via data.profiles. */
  heldBy: string | null;
  /**
   * The guardian phone (digits only, last 10) this child's household shares, so
   * the page can surface a US-37-style "suspected duplicate" link to another
   * household with the same number. Null when there's no phone on file.
   */
  guardianPhoneKey: string | null;
}

/**
 * The children currently on hold for duplicate review (US-38) — the roster
 * behind /admin/on-hold and the dashboard "On hold" tile. One row per held
 * child, newest hold first.
 *
 * Confidential households are included here for cleared staff exactly as they
 * are in the families explorer; RLS on `children` (20260811120000, via
 * `family_is_confidential()`) is what actually decides whether a given
 * `data.children` row is present at all, and `set_child_hold` /
 * `release_child_hold` re-check `can_view_confidential()` server-side — this
 * derivation does not route around either.
 */
export function getChildrenOnHold(data: DataBundle): ChildOnHoldRow[] {
  return data.children
    .filter(isChildOnHold)
    .map((child) => {
      const family = getFamily(data, child.familyId);
      const driveSchool = getDriveSchool(data, family.driveSchoolId);
      const school = driveSchool
        ? data.schools.find((s) => s.id === driveSchool.schoolId) ?? null
        : null;
      const phoneDigits = (family.guardianPhone ?? "").replace(/\D/g, "").slice(-10);
      return {
        childId: child.id,
        familyId: family.id,
        firstName: child.firstName,
        householdTag: getHouseholdTag(data, family),
        schoolName: school?.name ?? null,
        driveSchoolId: family.driveSchoolId,
        isConfidential: family.isConfidential,
        grade: child.grade,
        holdReason: child.holdReason,
        heldAt: child.heldAt as string,
        heldBy: child.heldBy,
        guardianPhoneKey: phoneDigits.length === 10 ? phoneDigits : null,
      };
    })
    .sort((a, b) => b.heldAt.localeCompare(a.heldAt));
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
  /** US-42: true when this school is skipped by the daily counselor digest. */
  digestPaused: boolean;
}

/**
 * Schools participating in the current drive, with a family count for
 * context. Liaison contact info is sourced from the `schools` row, not
 * `drive_schools` (ADM-3, 2026-08-18: the liaison belongs to the school and
 * is inherited across drives, not re-entered per year — see
 * supabase/migrations/20260818150000_school_liaison_on_schools.sql).
 */
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
        liaisonName: school.liaisonName,
        liaisonPhone: school.liaisonPhone,
        liaisonEmail: school.liaisonEmail,
        distributionMethod: ds.distributionMethod,
        familyCount,
        digestPaused: ds.digestPaused,
      };
    });
}

/** Which status an assignment moves to next when staff click "advance" (fulfillment page). */
export const NEXT_STATUS: Partial<Record<AssignmentStatus, AssignmentStatus>> = {
  pledged: "purchased",
  purchased: "received_at_church",
  received_at_church: "verified",
  verified: "delivered",
};

// The fulfillment board's columns, left to right. "unassigned" isn't a real
// assignment_status — it's a card with no active (non-cancelled) assignment
// at all, whether never claimed or claimed-then-cancelled.
export type FulfillmentColumn =
  | "unassigned"
  | "pledged"
  | "purchased"
  | "received_at_church"
  | "verified"
  | "delivered";

export const FULFILLMENT_COLUMNS: { value: FulfillmentColumn; label: string }[] = [
  { value: "unassigned", label: "Unassigned" },
  { value: "pledged", label: "Pledged" },
  { value: "purchased", label: "Purchased" },
  { value: "received_at_church", label: "Received at church" },
  { value: "verified", label: "Verified" },
  { value: "delivered", label: "Delivered" },
];

// Volunteer notes only make sense once a gift has physically arrived —
// before that there's nothing to check against the wishlist yet. Also keeps
// notes out of sight of anything upstream of church intake.
const NOTES_VISIBLE_FROM: FulfillmentColumn[] = ["received_at_church", "verified", "delivered"];

export interface FulfillmentCard {
  cardId: string;
  cardNumber: string;
  childFirstName: string;
  isConfidential: boolean;
  driveSchoolId: string | null;
  schoolName: string | null;
  column: FulfillmentColumn;
  assignmentId: string | null;
  sponsorName: string | null;
  sponsorPhone: string | null;
  sponsorEmail: string | null;
  daysSinceClaimed: number | null;
  overdueSeverity: OverdueSeverity | null;
  // null until the card has reached the church (see NOTES_VISIBLE_FROM) —
  // there's nothing to check against the wishlist before then.
  volunteerNotes: string | null;
}

/** One card, paired with the child it belongs to. */
export interface SponsorPoolCard {
  card: CardRecord;
  child: Child;
}

/**
 * Every card currently in the sponsor-pool universe — i.e. not a high
 * schooler's (self-shops, never sponsored) and not on hold for duplicate
 * review (mirrors `and not ch.is_high_schooler` / `and ch.held_at is null`,
 * the same two predicates `public_available_cards`, `printable_cards`, and
 * `cards_needing_print` all carry). Claimed AND unclaimed cards both come
 * back here — this is the shared base `getFulfillmentBoard` builds its whole
 * board from and `getAssignableCards` (US-58) filters further down to just
 * the unassigned, non-confidential ones. Factored out so both stay in sync
 * with this filter rather than each re-stating it.
 */
export function getSponsorPoolCards(data: DataBundle): SponsorPoolCard[] {
  return data.cards
    .map((card) => ({ card, child: data.children.find((c) => c.id === card.childId)! }))
    .filter(({ child }) => !child.isHighSchooler && !isChildOnHold(child));
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

  for (const { card, child } of getSponsorPoolCards(data)) {
    const active = getActiveAssignment(data, card.id);
    const cardNumber = getChildCardNumber(data, child);
    const family = getFamily(data, child.familyId);
    const isConfidential = family.isConfidential;
    const driveSchool = getDriveSchool(data, family.driveSchoolId);
    const schoolName = driveSchool
      ? data.schools.find((s) => s.id === driveSchool.schoolId)?.name ?? null
      : null;

    if (!active) {
      board.push({
        cardId: card.id,
        cardNumber,
        childFirstName: child.firstName,
        isConfidential,
        driveSchoolId: family.driveSchoolId,
        schoolName,
        column: "unassigned",
        assignmentId: null,
        sponsorName: null,
        sponsorPhone: null,
        sponsorEmail: null,
        daysSinceClaimed: null,
        overdueSeverity: null,
        volunteerNotes: null,
      });
      continue;
    }

    const sponsor = data.sponsors.find((s) => s.id === active.sponsorId)!;
    const days = daysSince(active.claimedAt);
    const column = active.status as FulfillmentColumn;
    const isDelivered = active.status === "delivered";
    board.push({
      cardId: card.id,
      cardNumber,
      childFirstName: child.firstName,
      isConfidential,
      driveSchoolId: family.driveSchoolId,
      schoolName,
      column,
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
      volunteerNotes: NOTES_VISIBLE_FROM.includes(column) ? active.volunteerNotes : null,
    });
  }

  return board.sort((a, b) => (b.daysSinceClaimed ?? -1) - (a.daysSinceClaimed ?? -1));
}

export interface ShoppingListRow {
  assignmentId: string;
  cardNumber: string;
  childFirstName: string;
  isConfidential: boolean;
  driveSchoolId: string | null;
  schoolName: string | null;
  status: AssignmentStatus;
  notes: string;
  // Shown so the shopping team can buy clothes without opening the card.
  age: number | null;
  sex: string | null;
  shirtSize: string | null;
  pantSize: string | null;
  shoeSize: string | null;
  daysSinceClaimed: number;
}

/**
 * Consolidates volunteer notes into what the admin team still needs to shop
 * for: every assignment sitting at 'received_at_church' with a note attached
 * — i.e. arrived, not yet checked against the wishlist. Advancing it to
 * 'verified' (fulfillment page or the shopping-list page itself) is what
 * drops it off this list.
 */
export function getShoppingList(data: DataBundle): ShoppingListRow[] {
  return data.assignments
    .filter((a) => {
      if (a.status !== "received_at_church" || !(a.volunteerNotes ?? "").trim()) return false;
      // On hold for duplicate review — off the shopping list until released
      // (mirrors `and ch.held_at is null`).
      const card = data.cards.find((c) => c.id === a.cardId);
      const child = card ? data.children.find((c) => c.id === card.childId) : undefined;
      return child ? !isChildOnHold(child) : true;
    })
    .map((a) => {
      // Non-null assertion relies on the same invariant getOverdueAssignments
      // above does: every assignments row's card is visible under the
      // viewer's own `data.cards` RLS filter, because claim_card() (the only
      // insert path into assignments) refuses confidential cards. See the
      // "Confidentiality note" in 20260812100000_assignment_notes_and_verification.sql
      // if that ever changes.
      const card = data.cards.find((c) => c.id === a.cardId)!;
      const child = data.children.find((c) => c.id === card.childId)!;
      const family = getFamily(data, child.familyId);
      const driveSchool = getDriveSchool(data, family.driveSchoolId);
      const schoolName = driveSchool
        ? data.schools.find((s) => s.id === driveSchool.schoolId)?.name ?? null
        : null;
      return {
        assignmentId: a.id,
        cardNumber: getChildCardNumber(data, child),
        childFirstName: child.firstName,
        isConfidential: family.isConfidential,
        driveSchoolId: family.driveSchoolId,
        schoolName,
        status: a.status,
        notes: (a.volunteerNotes ?? "").trim(),
        age: child.age,
        sex: child.sex,
        shirtSize: child.shirtSize,
        pantSize: child.pantSize,
        shoeSize: child.shoeSize,
        daysSinceClaimed: daysSince(a.claimedAt),
      };
    })
    .sort((a, b) => b.daysSinceClaimed - a.daysSinceClaimed);
}

export interface DistributionRow {
  familyId: string;
  driveSchoolId: string | null;
  schoolName: string | null;
  isConfidential: boolean;
  familyNumber: number;
  /** App-wide household tag, e.g. "OL1" — school code + familyNumber. */
  householdTag: string;
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
    // Held-for-duplicate-review children (US-38) are excluded from the
    // distribution rollup — no gift bag goes out while the card is under
    // review (mirrors `and ch.held_at is null`). The family still appears if it
    // has other children.
    const familyChildren = data.children.filter(
      (c) => c.familyId === family.id && !isChildOnHold(c),
    );
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
      householdTag: getHouseholdTag(data, family),
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
  return data.cards
    .filter((card) => {
      // Mirrors `printable_cards`'s `and not ch.is_high_schooler and
      // ch.held_at is null`.
      const child = data.children.find((c) => c.id === card.childId);
      return child ? !child.isHighSchooler && !isChildOnHold(child) : false;
    })
    .map((card) => {
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

// =============================================================================
// Staff-assigned sponsors (US-55..US-58,
// supabase/migrations/20261015140000_sponsor_families.sql /
// 20261015150000_assign_card_to_sponsor_family.sql)
// =============================================================================

/**
 * The sponsor sign-up roster for the current drive — mirrors
 * `data.sponsorFamilies`, which is fetched UNFILTERED by drive (same pattern
 * as families/children in lib/store.tsx's fetchDataBundle), filtered here the
 * same way `getSchoolsForDrive` filters `data.driveSchools`.
 *
 * `assignedCount` is computed fresh here — the count of non-cancelled
 * `assignments` reached through `sponsors.sponsorFamilyId === sponsorFamily.id`
 * — rather than read off the raw bundle row, which always carries the mapper's
 * placeholder `0` (see mapSponsorFamily). Because
 * `assign_card_to_sponsor_family` inserts a brand-new `sponsors` row on every
 * call (never reuses one for a repeat assignment to the same roster entry),
 * counting through `sponsors` first and then assignments would double-count
 * nothing and miss nothing either way — but counting `assignments` directly
 * is what actually answers "how many cards has this entry taken," so that's
 * what this does.
 */
export function getSponsorFamilies(data: DataBundle): SponsorFamily[] {
  return data.sponsorFamilies
    .filter((sf) => sf.driveId === data.drive.id)
    .map((sf) => {
      const active = data.assignments.filter((a) => {
        if (a.status === "cancelled") return false;
        const sponsor = data.sponsors.find((s) => s.id === a.sponsorId);
        return sponsor?.sponsorFamilyId === sf.id;
      });
      return {
        ...sf,
        assignedCount: active.length,
        unemailedCount: active.filter((a) => a.cardEmailedAt == null).length,
        awaitingGiftCount: active.filter(
          (a) => a.cardEmailedAt != null && (a.status === "pledged" || a.status === "purchased"),
        ).length,
      };
    });
}

/** One sibling in the same household who already has an active assignment. */
export interface AssignableCardSibling {
  childFirstName: string;
  /**
   * The sponsor_families entry this sibling's sponsor came from, or null when
   * the sibling was claimed self-serve (sponsors.sponsorFamilyId is null) or
   * that roster entry no longer exists.
   */
  sponsorFamilyDisplayName: string | null;
}

export interface AssignableCard {
  cardId: string;
  cardNumber: string;
  childFirstName: string;
  schoolName: string | null;
  grade: string | null;
  sex: string | null;
  /** The OTHER children in this card's household who already have an active assignment. */
  siblingAssignments: AssignableCardSibling[];
}

/**
 * The pool staff can assign a sponsor_families entry onto (US-57's picker) —
 * `getSponsorPoolCards` (same non-high-schooler, non-held filter
 * `getFulfillmentBoard`'s whole board is built from) narrowed to cards with
 * no active assignment at all, same as that board's "unassigned" column,
 * further narrowed to non-confidential households — mirroring the refusal
 * `assign_card_to_sponsor_family` itself gives for a confidential card
 * ("missing or confidential"), so this pool never offers a card the RPC
 * would just reject.
 */
export function getAssignableCards(data: DataBundle): AssignableCard[] {
  return getSponsorPoolCards(data)
    .filter(({ card, child }) => !getActiveAssignment(data, card.id) && !getFamily(data, child.familyId).isConfidential)
    .map(({ card, child }) => {
      const family = getFamily(data, child.familyId);
      const driveSchool = getDriveSchool(data, family.driveSchoolId);
      const schoolName = driveSchool
        ? data.schools.find((s) => s.id === driveSchool.schoolId)?.name ?? null
        : null;

      const siblingAssignments: AssignableCardSibling[] = data.children
        .filter((sibling) => sibling.familyId === family.id && sibling.id !== child.id)
        .flatMap((sibling) => {
          const siblingCard = data.cards.find((c) => c.childId === sibling.id);
          const active = siblingCard ? getActiveAssignment(data, siblingCard.id) : undefined;
          if (!active) return [];
          const sponsor = data.sponsors.find((s) => s.id === active.sponsorId);
          const sponsorFamily = sponsor?.sponsorFamilyId
            ? data.sponsorFamilies.find((sf) => sf.id === sponsor.sponsorFamilyId) ?? null
            : null;
          return [
            {
              childFirstName: sibling.firstName,
              sponsorFamilyDisplayName: sponsorFamily?.displayName ?? null,
            },
          ];
        });

      return {
        cardId: card.id,
        cardNumber: getChildCardNumber(data, child),
        childFirstName: child.firstName,
        schoolName,
        grade: child.grade,
        sex: child.sex,
        siblingAssignments,
      };
    });
}
