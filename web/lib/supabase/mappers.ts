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
  return {
    id: row.id,
    name: row.name,
    liaisonName: row.liaison_name,
    liaisonPhone: row.liaison_phone,
    liaisonEmail: row.liaison_email,
  };
}

export function mapDriveSchool(row: any): DriveSchool {
  return {
    id: row.id,
    driveId: row.drive_id,
    schoolId: row.school_id,
    code: row.code,
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
    internalNotes: row.internal_notes,
    distributionMethodOverride: row.distribution_method_override as DistributionMethod | null,
    scheduledPickupAt: row.scheduled_pickup_at,
    checkedInAt: row.checked_in_at,
    checkedInBy: row.checked_in_by,
    createdBy: row.created_by,
    // Intake-form provenance/contact (20260830120000_intake_forms.sql).
    // Populated only by import_submission(); null on a hand-entered family.
    sourceSubmissionId: row.source_submission_id ?? null,
    guardianName: row.guardian_name ?? null,
    guardianPhone: row.guardian_phone ?? null,
    guardianEmail: row.guardian_email ?? null,
    preferredLanguage: row.preferred_language ?? "en",
    consentGivenAt: row.consent_given_at ?? null,
    canReachChurchPickup: row.can_reach_church_pickup ?? null,
    needsFollowup: row.needs_followup ?? false,
    followupNote: row.followup_note ?? null,
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
    // Null means "a volunteer typed this child in by hand"; a uuid means the
    // child arrived through an intake-form submission (INTAKE_FORMS §5.7).
    sourceSubmissionId: row.source_submission_id ?? null,
    specificNeedsSource: row.specific_needs_source ?? null,
    otherNotesSource: row.other_notes_source ?? null,
    // Verbatim, same reasoning as mapFamily's updatedAt above.
    updatedAt: row.updated_at,
  };
}

export function mapWishlistItem(row: any): WishlistItem {
  return {
    id: row.id,
    childId: row.child_id,
    position: row.position,
    description: row.description,
    // The family's own words, kept beside the English working value
    // (INTAKE_FORMS §4.2). Identical to `description` in Phase 1.
    descriptionSource: row.description_source ?? null,
    sourceLocale: row.source_locale ?? null,
  };
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
