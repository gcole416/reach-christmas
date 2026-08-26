// Mirrors SCHEMA.md — the TypeScript shape of the database. Row shapes
// arriving from Supabase (snake_case) get converted to these (camelCase) at
// the boundary in lib/supabase/mappers.ts.

export type DriveStatus = "draft" | "open" | "closed" | "archived";
export type DistributionMethod = "school_dropoff" | "church_pickup";
export type AssignmentStatus =
  | "pledged"
  | "purchased"
  | "received_at_church"
  | "verified"
  | "delivered"
  | "cancelled";
export type AppRole = "admin" | "volunteer";

export interface Drive {
  id: string;
  year: number;
  name: string;
  status: DriveStatus;
  referralWindowStart: string | null;
  referralWindowEnd: string | null;
  defaultDistributionMethod: DistributionMethod | null;
}

// Liaison contact lives on the school itself (ADM-2 answer, 2026-08-18: "the
// school liaison should be inherited from a school"), not re-entered per
// drive — see supabase/migrations/20260818150000_school_liaison_on_schools.sql.
export interface School {
  id: string;
  name: string;
  liaisonName: string | null;
  liaisonPhone: string | null;
  liaisonEmail: string | null;
}

export interface DriveSchool {
  id: string;
  driveId: string;
  schoolId: string;
  code: string;
  distributionMethod: DistributionMethod | null;
}

export interface Family {
  id: string;
  driveId: string;
  driveSchoolId: string | null;
  familyNumber: number;
  isConfidential: boolean;
  internalNotes: string | null;
  distributionMethodOverride: DistributionMethod | null;
  scheduledPickupAt: string | null;
  checkedInAt: string | null;
  checkedInBy: string | null;
  createdBy: string | null;
  // `families.updated_at`, maintained by the set_updated_at BEFORE UPDATE
  // trigger (supabase/migrations/20260708120000_init.sql). Used as the row
  // version for concurrent-edit detection in store.tsx's saveFamilyEdit —
  // treat it as an OPAQUE STRING. Pass it back exactly as it arrived; do not
  // reformat it or round-trip it through `new Date(...)`/`.toISOString()`,
  // which truncates Postgres's microseconds to milliseconds and would make
  // every save look like a conflict.
  updatedAt: string;
}

export interface Child {
  id: string;
  familyId: string;
  childIndex: number;
  firstName: string;
  grade: string | null;
  age: number | null;
  sex: string | null;
  specificNeeds: string | null;
  pantSize: string | null;
  shirtSize: string | null;
  shoeSize: string | null;
  otherNotes: string | null;
  // `children.updated_at` — same trigger, same row-version role, and the same
  // "opaque string, pass it back untouched" rule as Family.updatedAt above.
  updatedAt: string;
}

// Staff/volunteer account. RLS on `profiles` means a non-admin fetching this
// only ever gets their own row back (see supabase/migrations/20260708120000_init.sql
// "read own or admin profile") — admins get every row, which is what the
// volunteer-management admin page is built on.
export interface Profile {
  id: string;
  fullName: string;
  email: string | null;
  role: AppRole;
  canViewConfidential: boolean;
  createdAt: string;
}

export interface WishlistItem {
  id: string;
  childId: string;
  position: number;
  description: string;
}

export interface Sponsor {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

// One card per child, always (ADM-2 answer, 2026-08-18: "there is no longer
// a need to have more than one family sign up for one card"), enforced by a
// unique(child_id) constraint on `cards` — see
// supabase/migrations/20260818140000_one_card_per_child.sql.
export interface CardRecord {
  id: string;
  childId: string;
  printedAt: string | null;
}

export interface Assignment {
  id: string;
  cardId: string;
  sponsorId: string;
  status: AssignmentStatus;
  claimedAt: string;
  purchasedAt: string | null;
  receivedAtChurchAt: string | null;
  // Set when status moves to 'verified' — the admin team has checked the
  // gift against the wishlist and shopped for anything short. Same shape as
  // purchasedAt/receivedAtChurchAt/deliveredAt; who did it is answered by
  // audit_log's changed_by, not a dedicated column here.
  verifiedAt: string | null;
  deliveredAt: string | null;
  // Free-text note a volunteer leaves on this pledge once the gift is at
  // church — e.g. what's missing from the wishlist. Feeds the shopping list
  // (see queries.ts's getShoppingList) until the assignment reaches
  // 'verified'.
  volunteerNotes: string | null;
}

export type AuditAction = "insert" | "update" | "delete";

// Row shape of `audit_log` (see SCHEMA.md §11). Admin-only, RLS-restricted to
// is_admin(); fetched on demand via lib/store.tsx's fetchAuditLog, never as
// part of the full-bundle fetch — see that function's docstring for why.
export interface AuditLogEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: AuditAction;
  // profiles.id of the user who made the change, or null if the change was
  // made without an authenticated session (auth.uid() was null at write
  // time — e.g. a service-role/system operation). Not a user-facing name;
  // see the fetchAuditLog docstring in lib/store.tsx for how to resolve it.
  changedBy: string | null;
  changedAt: string;
  // Shape varies by tableName/action: insert/delete store the full row
  // (to_jsonb(old|new)); update stores { old: {...}, new: {...} }. Typed
  // loosely on purpose — narrow it at the call site once you know the
  // action/tableName.
  diff: Record<string, unknown> | null;
}

// Everything the admin UI needs, fetched from Supabase in one shot by
// lib/store.tsx — one bundle so the derivation functions in lib/queries.ts
// can take a single argument.
export interface DataBundle {
  drive: Drive;
  schools: School[];
  driveSchools: DriveSchool[];
  families: Family[];
  children: Child[];
  wishlistItems: WishlistItem[];
  sponsors: Sponsor[];
  cards: CardRecord[];
  assignments: Assignment[];
  // Own row only for a non-admin, every profile for an admin — see the
  // `Profile` doc comment above. Powers the admin volunteer-management page.
  profiles: Profile[];
}
