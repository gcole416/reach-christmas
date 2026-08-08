// Mirrors SCHEMA.md — the TypeScript shape of the database. Row shapes
// arriving from Supabase (snake_case) get converted to these (camelCase) at
// the boundary in lib/supabase/mappers.ts.

export type DriveStatus = "draft" | "open" | "closed" | "archived";
export type DistributionMethod = "school_dropoff" | "church_pickup";
export type AssignmentStatus =
  | "pledged"
  | "purchased"
  | "received_at_church"
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

export interface School {
  id: string;
  name: string;
}

export interface DriveSchool {
  id: string;
  driveId: string;
  schoolId: string;
  code: string;
  liaisonName: string | null;
  liaisonPhone: string | null;
  liaisonEmail: string | null;
  distributionMethod: DistributionMethod | null;
}

export interface Family {
  id: string;
  driveId: string;
  driveSchoolId: string | null;
  familyNumber: number;
  isConfidential: boolean;
  sortTag: string | null;
  internalNotes: string | null;
  distributionMethodOverride: DistributionMethod | null;
  scheduledPickupAt: string | null;
  checkedInAt: string | null;
  checkedInBy: string | null;
  createdBy: string | null;
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
  targetCardCount: number;
}

export interface WishlistItem {
  id: string;
  childId: string;
  position: number;
  description: string;
}

export interface Profile {
  id: string;
  fullName: string;
  email: string | null;
  role: AppRole;
  canViewConfidential: boolean;
  createdAt: string;
}

export interface Sponsor {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface CardRecord {
  id: string;
  childId: string;
  copyNumber: number;
  totalCopies: number;
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
  deliveredAt: string | null;
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
}
