// Postgres uses snake_case, the app uses camelCase — these functions are the
// one place that boundary gets crossed, so every other file can stay in
// terms of DataBundle / types.ts (see SCHEMA.md for the source-of-truth
// column names).
import type {
  AppRole,
  Assignment,
  AssignmentStatus,
  AuditAction,
  AuditLogEntry,
  CardRecord,
  Child,
  DistributionMethod,
  Drive,
  DriveSchool,
  DriveStatus,
  Family,
  Profile,
  School,
  Sponsor,
  WishlistItem,
} from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function mapDrive(row: any): Drive {
  return {
    id: row.id,
    year: row.year,
    name: row.name,
    status: row.status as DriveStatus,
    referralWindowStart: row.referral_window_start,
    referralWindowEnd: row.referral_window_end,
    defaultDistributionMethod: row.default_distribution_method as DistributionMethod | null,
  };
}

export function mapSchool(row: any): School {
  return { id: row.id, name: row.name };
}

export function mapDriveSchool(row: any): DriveSchool {
  return {
    id: row.id,
    driveId: row.drive_id,
    schoolId: row.school_id,
    code: row.code,
    liaisonName: row.liaison_name,
    liaisonPhone: row.liaison_phone,
    liaisonEmail: row.liaison_email,
    distributionMethod: row.distribution_method as DistributionMethod | null,
  };
}

export function mapFamily(row: any): Family {
  return {
    id: row.id,
    driveId: row.drive_id,
    driveSchoolId: row.drive_school_id,
    familyNumber: row.family_number,
    isConfidential: row.is_confidential,
    sortTag: row.sort_tag,
    internalNotes: row.internal_notes,
    distributionMethodOverride: row.distribution_method_override as DistributionMethod | null,
    scheduledPickupAt: row.scheduled_pickup_at,
    checkedInAt: row.checked_in_at,
    checkedInBy: row.checked_in_by,
    createdBy: row.created_by,
    // Copied through verbatim on purpose — this is the row version used by
    // saveFamilyEdit's concurrency guard, and any reformatting here (e.g.
    // `new Date(...).toISOString()`, which drops microseconds) would break
    // the `.eq("updated_at", ...)` match. See Family.updatedAt in types.ts.
    updatedAt: row.updated_at,
  };
}

export function mapChild(row: any): Child {
  return {
    id: row.id,
    familyId: row.family_id,
    childIndex: row.child_index,
    firstName: row.first_name,
    grade: row.grade,
    age: row.age,
    sex: row.sex,
    specificNeeds: row.specific_needs,
    pantSize: row.pant_size,
    shirtSize: row.shirt_size,
    shoeSize: row.shoe_size,
    otherNotes: row.other_notes,
    targetCardCount: row.target_card_count,
    // Verbatim, same reasoning as mapFamily's updatedAt above.
    updatedAt: row.updated_at,
  };
}

export function mapWishlistItem(row: any): WishlistItem {
  return { id: row.id, childId: row.child_id, position: row.position, description: row.description };
}

export function mapProfile(row: any): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role as AppRole,
    canViewConfidential: row.can_view_confidential,
    createdAt: row.created_at,
  };
}

export function mapSponsor(row: any): Sponsor {
  return { id: row.id, name: row.name, phone: row.phone, email: row.email };
}

export function mapCard(row: any): CardRecord {
  return {
    id: row.id,
    childId: row.child_id,
    copyNumber: row.copy_number,
    totalCopies: row.total_copies,
    printedAt: row.printed_at,
  };
}

export function mapAuditLogEntry(row: any): AuditLogEntry {
  return {
    id: row.id,
    tableName: row.table_name,
    recordId: row.record_id,
    action: row.action as AuditAction,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
    diff: row.diff,
  };
}

export function mapAssignment(row: any): Assignment {
  return {
    id: row.id,
    cardId: row.card_id,
    sponsorId: row.sponsor_id,
    status: row.status as AssignmentStatus,
    claimedAt: row.claimed_at,
    purchasedAt: row.purchased_at,
    receivedAtChurchAt: row.received_at_church_at,
    verifiedAt: row.verified_at,
    deliveredAt: row.delivered_at,
    volunteerNotes: row.volunteer_notes,
  };
}
