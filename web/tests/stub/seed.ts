// Fabricated fixture data for the stub-backed US-13 tests. Entirely invented —
// no real family, child, school or sponsor information appears here, and none
// of it is ever written to a Supabase project (the stub is in-memory only).

export const VIEWER_ADMIN = {
  id: "00000000-0000-4000-8000-00000000a001",
  email: "stub-admin@autotest.example.com",
  role: "admin",
  canViewConfidential: true,
};

export const VIEWER_PLAIN_VOLUNTEER = {
  id: "00000000-0000-4000-8000-00000000a002",
  email: "stub-volunteer@autotest.example.com",
  role: "volunteer",
  canViewConfidential: false,
};

export const IDS = {
  drive: "00000000-0000-4000-8000-0000000000d1",
  school: "00000000-0000-4000-8000-0000000000s1",
  driveSchool: "00000000-0000-4000-8000-000000000ds1",
  family: "00000000-0000-4000-8000-0000000000f1",
  confidentialFamily: "00000000-0000-4000-8000-0000000000f2",
  childA: "00000000-0000-4000-8000-0000000000c1",
  childB: "00000000-0000-4000-8000-0000000000c2",
  confidentialChild: "00000000-0000-4000-8000-0000000000c3",
  cardA: "00000000-0000-4000-8000-00000000ca01",
  cardB: "00000000-0000-4000-8000-00000000ca02",
  sponsor: "00000000-0000-4000-8000-00000000sp01",
  assignment: "00000000-0000-4000-8000-00000000as01",
};

// A deliberately awkward version string: full six fractional digits and a
// `+00:00` offset, i.e. exactly what Postgres emits and exactly what breaks if
// anything on the client re-formats it or fails to URL-encode the `+`.
const T0 = "2026-08-10T18:22:41.512347+00:00";

export function seedTables() {
  return {
    drives: [
      {
        id: IDS.drive,
        year: 2026,
        name: "Stub Drive 2026",
        status: "open",
        referral_window_start: null,
        referral_window_end: null,
        default_distribution_method: "church_pickup",
        created_at: T0,
        updated_at: T0,
      },
    ],
    schools: [{ id: IDS.school, name: "Stub Elementary", notes: null, created_at: T0 }],
    drive_schools: [
      {
        id: IDS.driveSchool,
        drive_id: IDS.drive,
        school_id: IDS.school,
        code: "STB",
        liaison_name: null,
        liaison_phone: null,
        liaison_email: null,
        distribution_method: null,
      },
    ],
    families: [
      {
        id: IDS.family,
        drive_id: IDS.drive,
        drive_school_id: IDS.driveSchool,
        family_number: 1,
        is_confidential: false,
        sort_tag: "Blue",
        internal_notes: "Original notes from the first volunteer.",
        distribution_method_override: null,
        scheduled_pickup_at: null,
        checked_in_at: null,
        checked_in_by: null,
        created_by: VIEWER_ADMIN.id,
        created_at: T0,
        updated_at: T0,
      },
      {
        id: IDS.confidentialFamily,
        drive_id: IDS.drive,
        drive_school_id: null,
        family_number: 2,
        is_confidential: true,
        sort_tag: "Green",
        internal_notes: "Confidential referral.",
        distribution_method_override: null,
        scheduled_pickup_at: null,
        checked_in_at: null,
        checked_in_by: null,
        // Created by the admin, so the "creator can still see their own"
        // exception in the RLS policies does NOT hand it to the plain volunteer.
        created_by: VIEWER_ADMIN.id,
        created_at: T0,
        updated_at: T0,
      },
    ],
    children: [
      child(IDS.childA, IDS.family, 1, "Alpha"),
      child(IDS.childB, IDS.family, 2, "Bravo"),
      child(IDS.confidentialChild, IDS.confidentialFamily, 1, "Charlie"),
    ],
    wishlist_items: [
      { id: "00000000-0000-4000-8000-00000000w001", child_id: IDS.childA, position: 1, description: "Soccer ball" },
      { id: "00000000-0000-4000-8000-00000000w002", child_id: IDS.childB, position: 1, description: "Art set" },
    ],
    sponsors: [
      { id: IDS.sponsor, name: "Stub Sponsor", phone: null, email: "stub-sponsor@autotest.example.com", created_at: T0 },
    ],
    cards: [
      { id: IDS.cardA, child_id: IDS.childA, copy_number: 1, total_copies: 1, printed_at: T0, created_at: T0 },
      { id: IDS.cardB, child_id: IDS.childB, copy_number: 1, total_copies: 1, printed_at: T0, created_at: T0 },
    ],
    assignments: [
      {
        id: IDS.assignment,
        card_id: IDS.cardA,
        sponsor_id: IDS.sponsor,
        status: "pledged",
        claimed_at: "2026-08-01T12:00:00+00:00",
        purchased_at: null,
        received_at_church_at: null,
        delivered_at: null,
        created_at: T0,
      },
    ],
    profiles: [
      {
        id: VIEWER_ADMIN.id,
        full_name: "Stub Admin",
        email: VIEWER_ADMIN.email,
        role: "admin",
        can_view_confidential: true,
        created_at: T0,
      },
      {
        id: VIEWER_PLAIN_VOLUNTEER.id,
        full_name: "Stub Volunteer",
        email: VIEWER_PLAIN_VOLUNTEER.email,
        role: "volunteer",
        can_view_confidential: false,
        created_at: T0,
      },
    ],
  };
}

function child(id: string, familyId: string, index: number, firstName: string) {
  return {
    id,
    family_id: familyId,
    child_index: index,
    first_name: firstName,
    grade: "3",
    age: 8,
    sex: "F",
    specific_needs: null,
    pant_size: "8",
    shirt_size: "M",
    shoe_size: "2",
    other_notes: null,
    target_card_count: 1,
    created_at: T0,
    updated_at: T0,
  };
}
