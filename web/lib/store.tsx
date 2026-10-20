"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "./supabase/client";
import {
  mapAssignment,
  mapAuditLogEntry,
  mapCard,
  mapChild,
  mapDrive,
  mapDriveSchool,
  mapFamily,
  mapProfile,
  mapSchool,
  mapSponsor,
  mapSponsorFamily,
  mapWishlistItem,
} from "./supabase/mappers";
import type {
  AppRole,
  AssignmentStatus,
  AuditLogEntry,
  DataBundle,
  DistributionMethod,
  ShopDayStatus,
} from "./types";
import { isHighSchoolGrade } from "./queries";

const SAVED_VIEWS_KEY = "reach-ol-saved-views-v1";

export interface SavedView {
  id: string;
  name: string;
  schoolFilter: string; // "all" | driveSchoolId | "confidential"
  statusFilter: string; // "all" | AssignmentStatus | "unclaimed"
}

export interface AddSchoolInput {
  name: string;
  code: string;
  liaisonName: string;
  liaisonPhone: string;
  liaisonEmail: string;
  distributionMethod: DistributionMethod | "inherit";
}

export type ReferralType = "school" | "direct" | "confidential";

export interface IntakeChildInput {
  firstName: string;
  grade: string;
  age: string;
  sex: string;
  specificNeeds: string;
  pantSize: string;
  shirtSize: string;
  shoeSize: string;
  otherNotes: string;
  wishlistItems: string[];
  // US-32: grades 9-12 self-shop at the store shopping day and stay out of the
  // sponsor pool. A database trigger sets `children.is_high_schooler` from
  // `grade` on INSERT regardless, so this is optional on the create path; the
  // family-edit form makes it a real toggle (EditableChildInput).
  isHighSchooler?: boolean;
}

export interface AddFamilyInput {
  referralType: ReferralType;
  driveSchoolId: string | null;
  internalNotes: string;
  children: IntakeChildInput[];
}

// Family number is assigned by the database (create_family() RPC), never
// chosen client-side — see the migration that introduced it for why. The
// caller still needs it back to show staff what got assigned, for tags.
export type AddFamilyResult = { ok: true; familyNumber: number } | { ok: false; error: string };

// Same shape as IntakeChildInput, plus which row it maps to and which version
// of that row the form was populated from.
export interface EditableChildInput extends IntakeChildInput {
  // The "High schooler (shops their own gifts)" toggle on the edit form.
  // Seeded from `Child.isHighSchooler`, sent on every save. On an existing
  // child this is authoritative (the classify trigger only fires on INSERT);
  // on a brand-new grade-9-12 child the INSERT trigger still forces it true,
  // and staff can then clear it on the next save.
  isHighSchooler: boolean;
  // null means "not saved yet" (insert), a uuid means "existing child"
  // (update in place).
  id: string | null;
  // The `Child.updatedAt` this block's fields were loaded from — null when
  // the child block hasn't been saved yet (i.e. whenever `id` is null).
  // Opaque string: pass it straight through from Child.updatedAt, never
  // through `new Date(...)`/`.toISOString()` (that truncates microseconds and
  // would make every save look like a conflict).
  updatedAt: string | null;
}

// saveFamilyEdit's result. The two optional flags drive UI messaging:
//   conflict    — the family/child changed underneath the user. Show the
//                 "someone else changed this" warning and offer reload vs.
//                 save-anyway (which re-calls with { force: true }).
//   partialSave — some writes had already landed before the failure was
//                 detected, so the page is now half-saved. Kept accurate: it
//                 is false whenever nothing at all was written, which is the
//                 normal case for a conflict (see the pre-flight check in
//                 saveFamilyEdit).
export type SaveFamilyEditResult =
  | { ok: true }
  | { ok: false; error: string; conflict?: boolean; partialSave?: boolean };

export interface UpdateFamilyDetailsInput {
  internalNotes: string;
}

// US-55/56/57/58 (feature/staff-assigned-sponsors) ---------------------------

export interface CreateSponsorFamilyInput {
  displayName: string;
  contactEmail?: string;
  contactPhone?: string;
  capacity?: number;
  notes?: string;
}

/**
 * `created` is how many rows were in the import payload after dropping blank
 * display names — this is a SINGLE insert statement (not a per-row loop), so
 * it is all-or-nothing: either every valid row lands and `created` is their
 * count, or the whole batch fails together as `{ ok: false, error }` (e.g. a
 * malformed row) and nothing is written. There is no partial-success count to
 * report for this RPC-free path.
 */
export type BulkImportSponsorFamiliesResult = { ok: true; created: number } | { ok: false; error: string };

export interface UpdateSponsorFamilyPatch {
  displayName?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  capacity?: number | null;
  notes?: string | null;
  isActive?: boolean;
}

// Raw shape of assign_card_to_sponsor_family's jsonb return — see
// supabase/migrations/20261015150000_assign_card_to_sponsor_family.sql.
interface AssignCardToSponsorFamilyResponse {
  ok: boolean;
  sponsor_id?: string;
  assignment_id?: string;
  error?: string;
}

export type AssignCardToSponsorFamilyResult =
  | { ok: true; sponsorId: string; assignmentId: string }
  | { ok: false; error: string };

// The roster's "Email all assigned" / "Remind all assigned" — see
// supabase/functions/send-sponsor-emails and 20261019120000.
export type SponsorEmailKind = "card_assignment" | "reminder";

export interface SendSponsorEmailsResult {
  ok: boolean;
  sent: number;
  failed: { sponsorName: string; reason: string }[];
  error?: string;
}

export interface FamilyDistributionInput {
  scheduledPickupAt: string | null;
  distributionMethodOverride: DistributionMethod | "inherit";
}

type Result = { ok: true } | { ok: false; error: string };

interface DataContextValue {
  data: DataBundle | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // The current signed-in user's own role — null until it's loaded. Used to
  // redact confidential children's names down to a first initial for
  // non-admin staff (see queries.ts's displayFirstName).
  viewerRole: AppRole | null;
  addSchool: (input: AddSchoolInput) => Promise<Result>;
  addFamily: (input: AddFamilyInput) => Promise<AddFamilyResult>;
  // `expectedFamilyUpdatedAt` is the Family.updatedAt the form was loaded
  // from; pass `{ force: true }` only after the user has seen the conflict
  // warning and explicitly chose to overwrite. See saveFamilyEdit below.
  saveFamilyEdit: (
    familyId: string,
    details: UpdateFamilyDetailsInput,
    children: EditableChildInput[],
    expectedFamilyUpdatedAt: string | null,
    options?: { force?: boolean }
  ) => Promise<SaveFamilyEditResult>;
  updateAssignmentStatus: (assignmentId: string, status: AssignmentStatus) => Promise<Result>;
  cancelAssignment: (assignmentId: string) => Promise<Result>;
  updateAssignmentNotes: (assignmentId: string, notes: string) => Promise<Result>;
  updateCardPrinted: (cardId: string, printed: boolean) => Promise<Result>;
  // US-35: the shop-day status/notes for one high schooler. Plain
  // last-write-wins — a single-field staff action, same as updateAssignmentNotes.
  setShopDayTracking: (
    childId: string,
    input: { status: ShopDayStatus; notes: string },
  ) => Promise<Result>;
  // US-38: put a child on hold for duplicate review / release the hold. Admin
  // only (enforced in set_child_hold() / release_child_hold(), not here — a
  // volunteer calling either gets a raised Postgres error, which surfaces as
  // `{ ok: false, error }`). setChildHold also refuses, naming the sponsor, if
  // the child's card is still claimed. Both refresh the bundle on success so
  // the held child drops out of the pool/print/board derivations immediately.
  setChildHold: (childId: string, reason: string) => Promise<Result>;
  releaseChildHold: (childId: string) => Promise<Result>;
  // US-42: pause/resume a school's daily counselor review digest.
  setSchoolDigestPaused: (driveSchoolId: string, paused: boolean) => Promise<Result>;
  updateFamilyDistribution: (familyId: string, input: FamilyDistributionInput) => Promise<Result>;
  checkInFamily: (familyId: string) => Promise<Result>;
  undoCheckInFamily: (familyId: string) => Promise<Result>;
  // US-55/56/57/58: the sponsor roster (sponsor_families) and the staff
  // assignment write path (assign_card_to_sponsor_family). See
  // lib/queries.ts's getSponsorFamilies/getAssignableCards for the read side.
  createSponsorFamily: (input: CreateSponsorFamilyInput) => Promise<Result>;
  bulkImportSponsorFamilies: (
    rows: { displayName: string; contactEmail?: string; contactPhone?: string; capacity?: number }[]
  ) => Promise<BulkImportSponsorFamiliesResult>;
  updateSponsorFamily: (id: string, patch: UpdateSponsorFamilyPatch) => Promise<Result>;
  assignCardToSponsorFamily: (cardId: string, sponsorFamilyId: string) => Promise<AssignCardToSponsorFamilyResult>;
  sendSponsorEmails: (kind: SponsorEmailKind) => Promise<SendSponsorEmailsResult>;
  savedViews: SavedView[];
  addSavedView: (view: Omit<SavedView, "id">) => void;
  deleteSavedView: (id: string) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

async function fetchDataBundle(): Promise<DataBundle> {
  const supabase = createClient();

  const [
    drive,
    schools,
    driveSchools,
    families,
    children,
    wishlistItems,
    sponsors,
    cards,
    assignments,
    profiles,
    sponsorFamilies,
  ] = await Promise.all([
    supabase.from("drives").select("*").eq("status", "open").order("year", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("schools").select("*"),
    supabase.from("drive_schools").select("*"),
    supabase.from("families").select("*"),
    supabase.from("children").select("*"),
    supabase.from("wishlist_items").select("*"),
    supabase.from("sponsors").select("*"),
    supabase.from("cards").select("*"),
    supabase.from("assignments").select("*"),
    // RLS ("read own or admin profile", 20260708120000_init.sql) means a
    // non-admin gets back only their own row here, not the full roster —
    // that's expected, not a bug. The admin volunteer-management page is
    // the only consumer that needs every row, and it only renders for admins.
    supabase.from("profiles").select("*"),
    // US-55 — fetched unfiltered, same as families/children/etc. above;
    // lib/queries.ts's getSponsorFamilies is what scopes this to the current
    // drive (same pattern getSchoolsForDrive already uses for driveSchools).
    supabase.from("sponsor_families").select("*"),
  ]);

  for (const res of [
    drive,
    schools,
    driveSchools,
    families,
    children,
    wishlistItems,
    sponsors,
    cards,
    assignments,
    profiles,
    sponsorFamilies,
  ]) {
    if (res.error) throw new Error(res.error.message);
  }

  if (!drive.data) {
    throw new Error(
      "No drive with status 'open' was found. Create one from the SQL editor (see supabase/migrations) before using the dashboard."
    );
  }

  return {
    drive: mapDrive(drive.data),
    schools: (schools.data ?? []).map(mapSchool),
    driveSchools: (driveSchools.data ?? []).map(mapDriveSchool),
    families: (families.data ?? []).map(mapFamily),
    children: (children.data ?? []).map(mapChild),
    wishlistItems: (wishlistItems.data ?? []).map(mapWishlistItem),
    sponsors: (sponsors.data ?? []).map(mapSponsor),
    cards: (cards.data ?? []).map(mapCard),
    assignments: (assignments.data ?? []).map(mapAssignment),
    profiles: (profiles.data ?? []).map(mapProfile),
    sponsorFamilies: (sponsorFamilies.data ?? []).map(mapSponsorFamily),
  };
}

// Deliberately NOT part of fetchDataBundle / DataContext: audit_log can grow
// large (a row per insert/update/delete across 10 tables) and its `diff`
// column carries full row contents for families/children, i.e. real kids'
// PII. Loading it on every admin page load would mean pulling that PII into
// memory even for admins who never open the audit viewer. Call this only
// from the audit-log page itself, on demand.
//
// RLS already restricts SELECT on audit_log to is_admin() (see "admin read
// audit_log" policy in supabase/migrations/20260708120000_init.sql), so a
// volunteer calling this gets an empty result / RLS error, not a leak — but
// the UI should still only expose the entry point to admins.
//
// NOTE for whoever builds the viewer: `changed_by` is a profiles.id (uuid),
// not a name. `data.profiles` (fetched as part of the main DataBundle, see
// fetchDataBundle above) now exists and can be joined against by id to show
// a name — but remember a non-admin's `data.profiles` only ever contains
// their own row (RLS), so that join will only resolve to a name for entries
// they themselves made unless the viewer is admin-gated.
export async function fetchAuditLog(options?: {
  tableName?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const supabase = createClient();

  let query = supabase
    .from("audit_log")
    .select("*")
    .order("changed_at", { ascending: false })
    .limit(options?.limit ?? 200);

  if (options?.tableName) {
    query = query.eq("table_name", options.tableName);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map(mapAuditLogEntry);
}

// ---------------------------------------------------------------------------
// Email-verified claiming (SPN-3, supabase/migrations/20260818160000_email_verified_claims.sql)
//
// Deliberately standalone exports, like fetchAuditLog above, rather than
// DataContext methods: the anonymous /sponsor page (web/app/sponsor) has no
// DataProvider wrapping it and no DataBundle to act on — these two just wrap
// their one RPC call each, same shape as the RPCs themselves.
//
// claim_card (the old one-shot claim) is no longer callable by anon/
// authenticated as of that migration — claimCardWithCode below is now the
// only way a sponsor pledge actually gets created. The flow is:
//   1. requestClaimCode() — sends a 6-digit code to the sponsor's email, and
//      returns a sessionToken the caller must hold onto (in memory only —
//      it does not need to survive a page reload; a reload is an acceptable
//      "start over" case).
//   2. claimCardWithCode() — the sponsor types the code back in; called with
//      that same sessionToken, this is what actually creates the sponsor +
//      assignment rows (what claim_card used to do in one step).
//
// The sessionToken exists because the card id alone is public: without it, a
// second requestClaimCode() call for the same card (anyone's — including the
// same sponsor re-requesting from another tab) would silently invalidate an
// already-issued, still-correct code with no way for the holder to tell why.
// A stale token comes back from claimCardWithCode as its own distinct error,
// not a generic "wrong code" — see ClaimCardWithCodeResponse below.
// ---------------------------------------------------------------------------

export interface RequestClaimCodeInput {
  cardId: string;
  sponsorName: string;
  sponsorEmail: string;
  sponsorPhone?: string;
}

export type RequestClaimCodeResult = { ok: true; sessionToken: string } | { ok: false; error: string };

/**
 * Sends a 6-digit verification code to `sponsorEmail` for this card. Re-runs
 * the same "not already claimed" / "not confidential" checks claim_card
 * always did, server-side, so a bad card id can't get a code sent for
 * nothing. Calling this again for the same card within ~60 seconds returns
 * `ok: false` (the database's abuse guard, not a client-side debounce) —
 * show that message as-is rather than retrying automatically.
 *
 * On success, `sessionToken` MUST be passed to claimCardWithCode below — hold
 * it in component state between the two calls. Calling this again (e.g. a
 * "resend code" button) returns a NEW sessionToken and silently invalidates
 * any previous one for this card; always use the token from the most recent
 * requestClaimCode call.
 */
export async function requestClaimCode(input: RequestClaimCodeInput): Promise<RequestClaimCodeResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("request_claim_code", {
    p_card_id: input.cardId,
    p_sponsor_name: input.sponsorName,
    p_sponsor_email: input.sponsorEmail,
    p_sponsor_phone: input.sponsorPhone?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, sessionToken: data as string };
}

export type ClaimCardWithCodeResult = { ok: true; sponsorId: string } | { ok: false; error: string };

// Raw shape of claim_card_with_code's jsonb return value — see the migration
// and SCHEMA.md for why it's jsonb rather than a bare uuid.
interface ClaimCardWithCodeResponse {
  ok: boolean;
  sponsor_id?: string;
  error?: string;
}

/**
 * Confirms the code sent by requestClaimCode and, on a match, creates the
 * sponsor + assignment rows — same net result (a new sponsor id) as the old
 * one-shot claim_card RPC, but two distinct failure shapes to handle, both
 * safe to show to the sponsor as-is:
 *  - A genuine Postgres error (`error` below) for the race-condition paths
 *    claim_card_with_code still `raise`s on — already claimed, confidential,
 *    lost the insert race.
 *  - A normal `{ ok: false, error }` payload in `data` for the expected/
 *    retryable failures (no pending verification, expired code, too many
 *    attempts, wrong code, or `sessionToken` no longer matching — that last
 *    one means a newer requestClaimCode call replaced this one, e.g. a
 *    resend from another tab, and should prompt the sponsor to request a
 *    fresh code rather than retry the same one) — those `return` instead of
 *    `raise` on purpose, so the wrong-code path's attempt-count increment
 *    actually commits instead of rolling back with the rest of the
 *    transaction.
 *
 * `sessionToken` is whatever requestClaimCode most recently returned for this
 * card — see that function's docstring.
 */
export async function claimCardWithCode(
  cardId: string,
  code: string,
  sessionToken: string
): Promise<ClaimCardWithCodeResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("claim_card_with_code", {
    p_card_id: cardId,
    p_code: code,
    p_session_token: sessionToken,
  });
  if (error) return { ok: false, error: error.message };

  const result = data as ClaimCardWithCodeResponse | null;
  if (!result?.ok || !result.sponsor_id) {
    return {
      ok: false,
      error: result?.error ?? "Something went wrong confirming that code. Please try again.",
    };
  }
  return { ok: true, sponsorId: result.sponsor_id };
}

// ---------------------------------------------------------------------------
// Church Center sign-up link (US-59,
// supabase/migrations/20261015160000_church_center_signup_link.sql)
//
// Deliberately standalone, same reasoning as requestClaimCode/claimCardWithCode
// above: the anonymous /sponsor page has no DataProvider wrapping it and no
// DataBundle to act on. `get_church_center_signup_url()` is a narrow
// security-definer function granted to anon specifically so this one value
// off `app_settings` (an otherwise admin-only table) is reachable without
// widening that table's RLS — see the migration and AGENTS.md.
// ---------------------------------------------------------------------------

/**
 * The Church Center URL /sponsor sends visitors to, or null when Grant hasn't
 * set one yet (the page should show an honest "not set up yet" message, not
 * a dead link) — `church_center_signup_url` is null until then, and the RPC
 * returns that null straight through rather than erroring.
 */
export async function getChurchCenterSignupUrl(): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_church_center_signup_url");
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

// Sane plain-language defaults. The edit page owns the final wording of the
// conflict banner (US-13) — these are what it gets if it just renders
// `result.error`.
const CONFLICT_MESSAGE =
  "Someone else changed this household while you were editing it. Reload to see their version, or save your version anyway to replace theirs.";

// Deliberately the SAME message for "the row does not exist" and "row level
// security hid it from you". A volunteer without can_view_confidential() gets
// zero rows back for a confidential family exactly like they would for a
// deleted one (see the "staff read families" policy in
// supabase/migrations/20260708140000_confidential_referral_access.sql), and
// answering that with "someone else changed this" would confirm the row
// exists. Generic not-found is the only safe answer on that path.
const NOT_FOUND_MESSAGE =
  "This household couldn't be found, or you no longer have access to it. Reload the page.";

// Shown when the caller had no row version to check against, so we can't tell
// whether anyone else has edited in the meantime. Refusing is the safe
// direction: the whole point of US-13 is not to blind-overwrite.
const UNVERIFIABLE_MESSAGE =
  "Couldn't check whether anyone else has changed this household. Reload the page and make your edit again.";

// Shape of the pre-flight version reads. Untyped supabase client, so these are
// asserted rather than inferred.
interface VersionRow {
  id: string;
  updated_at: string;
}
interface ChildVersionRow extends VersionRow {
  child_index: number;
}

function loadSavedViews(): SavedView[] {
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DataBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [viewerRole, setViewerRole] = useState<AppRole | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bundle = await fetchDataBundle();
      setData(bundle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadViewerRole = useCallback(async () => {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).single();
    setViewerRole((profile?.role as AppRole) ?? null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading saved views is a one-time read from an external system (localStorage) on mount
    setSavedViews(loadSavedViews());
    setHydrated(true);
    refresh();
    loadViewerRole();
  }, [refresh, loadViewerRole]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews));
  }, [savedViews, hydrated]);

  async function addSchool(input: AddSchoolInput): Promise<Result> {
    if (!data) return { ok: false, error: "Data hasn't finished loading yet." };

    const trimmedName = input.name.trim();
    const trimmedCode = input.code.trim().toUpperCase();
    if (!trimmedName) return { ok: false, error: "School name is required." };
    if (!trimmedCode) return { ok: false, error: "Card code is required." };

    const codeTaken = data.driveSchools.some((ds) => ds.code.toUpperCase() === trimmedCode);
    if (codeTaken) {
      return { ok: false, error: `Code "${trimmedCode}" is already used by another school this drive.` };
    }

    const supabase = createClient();

    // Liaison contact is a property of the school itself (ADM-3, 2026-08-18:
    // "the school liaison should be inherited from a school"), not the
    // per-drive membership — see
    // supabase/migrations/20260818150000_school_liaison_on_schools.sql. Note
    // this always creates a brand-new `schools` row alongside the
    // `drive_schools` row — there's no "add an existing school to this
    // drive" flow yet, so a liaison typed here can't yet be inherited from a
    // prior year in practice; that's a future reuse-across-years picker
    // (ADM-4 territory), not something this change builds.
    const { data: schoolRow, error: schoolError } = await supabase
      .from("schools")
      .insert({
        name: trimmedName,
        liaison_name: input.liaisonName.trim() || null,
        liaison_phone: input.liaisonPhone.trim() || null,
        liaison_email: input.liaisonEmail.trim() || null,
      })
      .select()
      .single();
    if (schoolError || !schoolRow) {
      return { ok: false, error: schoolError?.message ?? "Could not create the school." };
    }

    const { error: driveSchoolError } = await supabase.from("drive_schools").insert({
      drive_id: data.drive.id,
      school_id: schoolRow.id,
      code: trimmedCode,
      distribution_method: input.distributionMethod === "inherit" ? null : input.distributionMethod,
    });
    if (driveSchoolError) {
      // The client-side codeTaken check above isn't atomic — two admins
      // submitting the same new code at nearly the same instant can both
      // pass it, since neither has the other's in-flight insert in their
      // locally-loaded `data` yet. The real guarantee is the
      // `unique (drive_id, code)` constraint on drive_schools (see
      // supabase/migrations/20260708120000_init.sql), which surfaces here as
      // a Postgres unique-violation (code 23505). Translate that specific
      // case back into the same friendly message the pre-check uses instead
      // of leaking the raw constraint name; fall through to the raw message
      // for any other error (e.g. RLS denial, network failure) so we don't
      // swallow genuinely useful info.
      if (driveSchoolError.code === "23505" && driveSchoolError.message.includes("drive_schools_drive_id_code_key")) {
        return {
          ok: false,
          error: `Code "${trimmedCode}" was just taken by another school this drive.`,
        };
      }
      return { ok: false, error: driveSchoolError.message };
    }

    await refresh();
    return { ok: true };
  }

  async function addFamily(input: AddFamilyInput): Promise<AddFamilyResult> {
    if (!data) return { ok: false, error: "Data hasn't finished loading yet." };

    const isConfidential = input.referralType === "confidential";
    const driveSchoolId = input.referralType === "school" ? input.driveSchoolId : null;

    if (input.referralType === "school" && !driveSchoolId) {
      return { ok: false, error: "Choose a school, or switch to direct referral / confidential." };
    }

    const validChildren = input.children.filter((c) => c.firstName.trim());
    if (validChildren.length === 0) {
      return { ok: false, error: "Add at least one child with a first name." };
    }

    const supabase = createClient();

    // Family number is assigned inside this call, not chosen here — see
    // create_family() in the migrations for why (concurrent volunteers on
    // different devices could otherwise race on the same number).
    const { data: familyRow, error: familyError } = await supabase.rpc("create_family", {
      p_drive_id: data.drive.id,
      p_drive_school_id: driveSchoolId,
      p_is_confidential: isConfidential,
      p_internal_notes: input.internalNotes.trim() || null,
    });
    if (familyError || !familyRow) {
      return { ok: false, error: familyError?.message ?? "Could not create the household." };
    }

    for (let i = 0; i < validChildren.length; i++) {
      const child = validChildren[i];

      const { data: childRow, error: childError } = await supabase
        .from("children")
        .insert({
          family_id: familyRow.id,
          child_index: i + 1,
          first_name: child.firstName.trim(),
          grade: child.grade.trim() || null,
          age: child.age.trim() ? Number(child.age) : null,
          sex: child.sex.trim() || null,
          specific_needs: child.specificNeeds.trim() || null,
          pant_size: child.pantSize.trim() || null,
          shirt_size: child.shirtSize.trim() || null,
          shoe_size: child.shoeSize.trim() || null,
          other_notes: child.otherNotes.trim() || null,
          // The DB trigger also derives this from grade on INSERT; sending it
          // explicitly lets a staff "high schooler" call for an off-list grade
          // (e.g. "9th") still land. See queries.ts isHighSchoolGrade / US-32.
          is_high_schooler: child.isHighSchooler ?? isHighSchoolGrade(child.grade),
        })
        .select()
        .single();
      if (childError || !childRow) {
        await refresh();
        return {
          ok: false,
          error: `Household saved, but couldn't add ${child.firstName || "a child"}: ${
            childError?.message ?? "unknown error"
          }. What was saved so far is already in the household list, so check there before retrying.`,
        };
      }

      const wishlistRows = child.wishlistItems
        .map((description, idx) => ({ child_id: childRow.id, position: idx + 1, description: description.trim() }))
        .filter((row) => row.description);
      if (wishlistRows.length > 0) {
        const { error: wishlistError } = await supabase.from("wishlist_items").insert(wishlistRows);
        if (wishlistError) {
          await refresh();
          return {
            ok: false,
            error: `${child.firstName}'s wishlist items failed to save: ${wishlistError.message}. Everything else was saved.`,
          };
        }
      }

      // Exactly one card per child, created once here and never touched
      // again (ADM-2, 2026-08-18: "there is no longer a need to have more
      // than one family sign up for one card").
      const { error: cardError } = await supabase.from("cards").insert({ child_id: childRow.id });
      if (cardError) {
        await refresh();
        return {
          ok: false,
          error: `Couldn't generate a claimable card for ${child.firstName}: ${cardError.message}. Everything else was saved, so use "Cards to print" to retry.`,
        };
      }
    }

    await refresh();
    return { ok: true, familyNumber: familyRow.family_number };
  }

  // Concurrent-edit safe (US-13). Two layers, both needed:
  //
  //  1. A PRE-FLIGHT pass that re-reads the current `updated_at` of the family
  //     and of every child of that family before writing anything, and bails
  //     out with partialSave:false if any of them moved. Without this, a
  //     conflict on child #3 would leave the family row and children #1-2
  //     already mutated, and "other changes may already be saved" would be the
  //     normal outcome of a conflict instead of a rare one.
  //  2. A PER-ROW `.eq("updated_at", ...)` guard on each UPDATE, for the small
  //     window between the pre-flight read and the write. Note the `.select()`
  //     on every guarded update: PostgREST answers an UPDATE that matched zero
  //     rows with 204/no body and supabase-js reports NO error for it, so
  //     without asking for the affected rows back a blocked update is
  //     indistinguishable from a successful one and the guard would silently
  //     do nothing.
  //
  // `force: true` skips both comparisons (not the reads — those still resolve
  // the child indexes and confirm access): the user has already been shown the
  // conflict warning and chosen to overwrite.
  //
  // Deliberately does NOT call refresh() on the paths that wrote nothing, so a
  // rejected save can't clobber whatever the user has typed into the form. The
  // page decides when to pull fresh values (i.e. when the user picks "reload
  // theirs").
  async function saveFamilyEdit(
    familyId: string,
    details: UpdateFamilyDetailsInput,
    children: EditableChildInput[],
    expectedFamilyUpdatedAt: string | null,
    options?: { force?: boolean }
  ): Promise<SaveFamilyEditResult> {
    if (!data) return { ok: false, error: "Data hasn't finished loading yet.", partialSave: false };

    const force = options?.force === true;

    const validChildren = children.filter((c) => c.firstName.trim());
    if (validChildren.length === 0) {
      return { ok: false, error: "A household needs at least one child with a first name.", partialSave: false };
    }

    if (!force && !expectedFamilyUpdatedAt) {
      return { ok: false, error: UNVERIFIABLE_MESSAGE, partialSave: false };
    }

    const supabase = createClient();

    // ---- Pre-flight: read current versions, write nothing ------------------

    const { data: familyRowData, error: familyCheckError } = await supabase
      .from("families")
      .select("id, updated_at")
      .eq("id", familyId)
      .maybeSingle();
    if (familyCheckError) {
      return { ok: false, error: familyCheckError.message, partialSave: false };
    }
    if (!familyRowData) {
      // Missing row and RLS-hidden row are the same observation here — see
      // NOT_FOUND_MESSAGE.
      return { ok: false, error: NOT_FOUND_MESSAGE, partialSave: false };
    }
    const familyRow = familyRowData as VersionRow;

    // Every child of the family, not just the ones being written: this both
    // version-checks the blocks the form is holding and notices a child
    // someone else added since the form was opened.
    const { data: childRowData, error: childCheckError } = await supabase
      .from("children")
      .select("id, child_index, updated_at")
      .eq("family_id", familyId);
    if (childCheckError) {
      return { ok: false, error: childCheckError.message, partialSave: false };
    }
    const currentChildren = (childRowData ?? []) as ChildVersionRow[];
    const currentChildById = new Map(currentChildren.map((row) => [row.id, row]));

    // Existing blocks are taken from the FULL children array, not
    // validChildren: an existing child whose name the user blanked out is
    // skipped for writing (as it always has been) but is still a row this form
    // is holding a version of, and still counts as "known" so it isn't
    // mistaken for someone else's new child below.
    const loadedChildren = children.filter((c): c is EditableChildInput & { id: string } => Boolean(c.id));

    for (const child of loadedChildren) {
      if (!currentChildById.has(child.id)) {
        // Deleted, or never visible to this user. Same reasoning as the
        // family case: do not answer this with the conflict message.
        return { ok: false, error: NOT_FOUND_MESSAGE, partialSave: false };
      }
      if (!force && !child.updatedAt) {
        // An existing row with no version to check against.
        return { ok: false, error: UNVERIFIABLE_MESSAGE, partialSave: false };
      }
    }

    if (!force) {
      // Exact string comparison. Both sides are the same PostgREST rendering
      // of the same timestamptz column, so they are byte-identical when the
      // row hasn't moved. No Date parsing on either side — that would truncate
      // microseconds and could call two distinct versions equal.
      const familyMoved = familyRow.updated_at !== expectedFamilyUpdatedAt;
      const childMoved = loadedChildren.some((c) => currentChildById.get(c.id)?.updated_at !== c.updatedAt);

      if (familyMoved || childMoved) {
        return { ok: false, error: CONFLICT_MESSAGE, conflict: true, partialSave: false };
      }
    }

    // Deliberately NOT treated as a conflict: a child row that exists in the
    // database but isn't in `children` at all. That would catch someone else
    // inserting a sibling while this form was open — but it would also fire
    // every time a user removes an existing child's block from the form (a
    // supported action that has always been a silent no-op for the saved row),
    // turning a normal edit into a bogus "someone else changed this". The
    // trade is safe in the direction that matters: a concurrent INSERT can't
    // lose anyone's work, because this function never writes to a child it
    // wasn't given, and nextChildIndex below is computed from the pre-flight
    // read rather than the stale bundle so the new sibling can't collide. A
    // concurrent EDIT to a child, which *can* lose work, is still caught by
    // the version comparison above.

    // ---- Writes ------------------------------------------------------------

    // Tracks whether anything has actually hit the database yet, so
    // `partialSave` is accurate rather than assumed.
    let wroteSomething = false;

    let familyUpdate = supabase
      .from("families")
      .update({
        internal_notes: details.internalNotes.trim() || null,
      })
      .eq("id", familyId);
    if (!force) {
      // Guard with the caller's baseline, not the value the pre-flight just
      // read. The two are identical here (we just compared them and returned
      // otherwise), so this changes no behaviour today — but it makes the
      // database an independent second check of the version the user actually
      // edited, so a future bug in the string comparison above fails closed
      // instead of writing unguarded. Still closes the pre-flight-to-write
      // window either way.
      familyUpdate = familyUpdate.eq("updated_at", expectedFamilyUpdatedAt);
    }
    const { data: familyUpdated, error: familyError } = await familyUpdate.select("id");
    if (familyError) {
      return { ok: false, error: familyError.message, partialSave: false };
    }
    if ((familyUpdated ?? []).length === 0) {
      // Zero rows affected, no error: either the guard blocked it, or the row
      // isn't visible/updatable for this user (only possible on the forced
      // path, since the pre-flight already read it).
      if (force) return { ok: false, error: NOT_FOUND_MESSAGE, partialSave: false };
      return { ok: false, error: CONFLICT_MESSAGE, conflict: true, partialSave: false };
    }
    wroteSomething = true;

    // Fresh from the pre-flight read, not from the possibly-stale bundle, so a
    // child added by someone else can't cause a (family_id, child_index)
    // unique violation on the forced path.
    let nextChildIndex =
      currentChildren.length > 0 ? Math.max(...currentChildren.map((row) => row.child_index)) + 1 : 1;

    for (const child of validChildren) {
      let childId = child.id;

      const childFields = {
        first_name: child.firstName.trim(),
        grade: child.grade.trim() || null,
        age: child.age.trim() ? Number(child.age) : null,
        sex: child.sex.trim() || null,
        specific_needs: child.specificNeeds.trim() || null,
        pant_size: child.pantSize.trim() || null,
        shirt_size: child.shirtSize.trim() || null,
        shoe_size: child.shoeSize.trim() || null,
        other_notes: child.otherNotes.trim() || null,
        // Authoritative for an existing child (the classify trigger is
        // INSERT-only), so a staff toggle sticks. US-32.
        is_high_schooler: child.isHighSchooler,
      };

      if (childId) {
        let childUpdate = supabase.from("children").update(childFields).eq("id", childId);
        // Present for every id-bearing block — the pre-flight loop above
        // returned NOT_FOUND for any that weren't.
        const knownVersion = currentChildById.get(childId);
        if (!force) {
          if (!knownVersion || !child.updatedAt) {
            // Unreachable via the pre-flight loop, which already rejected an
            // id-bearing block that's missing from the map (NOT_FOUND) or has
            // no version to check (UNVERIFIABLE). If that invariant ever
            // drifts, fail closed here rather than issuing an unguarded
            // update. Generic not-found, and deliberately no `conflict` flag:
            // same privacy rule as the pre-flight: never confirm to a
            // volunteer that a row they can't see exists.
            await refresh();
            return { ok: false, error: NOT_FOUND_MESSAGE, partialSave: wroteSomething };
          }
          // Same reasoning as the family guard above: guard on the caller's
          // baseline for this row, and .select() so a zero-row result is
          // observable.
          childUpdate = childUpdate.eq("updated_at", child.updatedAt);
        }
        const { data: childUpdated, error: updateError } = await childUpdate.select("id");
        if (updateError) {
          await refresh();
          return {
            ok: false,
            error: `Couldn't update ${child.firstName}: ${updateError.message}. Other changes on this page may already be saved.`,
            partialSave: wroteSomething,
          };
        }
        if ((childUpdated ?? []).length === 0) {
          // Changed inside the pre-flight-to-write window. The family row (and
          // possibly earlier children) already went through, so this really is
          // a partial save.
          await refresh();
          if (force) {
            return { ok: false, error: NOT_FOUND_MESSAGE, partialSave: wroteSomething };
          }
          return { ok: false, error: CONFLICT_MESSAGE, conflict: true, partialSave: wroteSomething };
        }
        wroteSomething = true;
      } else {
        const { data: childRow, error: insertError } = await supabase
          .from("children")
          .insert({ family_id: familyId, child_index: nextChildIndex, ...childFields })
          .select()
          .single();
        if (insertError || !childRow) {
          await refresh();
          return {
            ok: false,
            error: `Couldn't add ${child.firstName}: ${
              insertError?.message ?? "unknown error"
            }. Other changes on this page may already be saved.`,
            partialSave: wroteSomething,
          };
        }
        childId = childRow.id;
        nextChildIndex += 1;
        wroteSomething = true;

        // Exactly one card per child, created once here and never touched
        // again (ADM-2, 2026-08-18: "there is no longer a need to have more
        // than one family sign up for one card"). Existing children (the
        // `if (childId)` branch above) never hit this — their card was
        // already created when they were, and there's nothing left to
        // reconcile now that a child can only ever have one.
        const { error: cardError } = await supabase.from("cards").insert({ child_id: childId });
        if (cardError) {
          await refresh();
          return {
            ok: false,
            error: `Couldn't generate a claimable card for ${child.firstName}: ${cardError.message}. Other changes on this page may already be saved.`,
            partialSave: wroteSomething,
          };
        }
      }

      if (!childId) {
        await refresh();
        return {
          ok: false,
          error: `Internal error saving ${child.firstName}: no child id was resolved.`,
          partialSave: wroteSomething,
        };
      }

      // Wishlist rows have no other references pointing at them, so a
      // wholesale replace is simpler and just as safe as diffing.
      const { error: deleteError } = await supabase.from("wishlist_items").delete().eq("child_id", childId);
      if (deleteError) {
        await refresh();
        return {
          ok: false,
          error: `Couldn't update ${child.firstName}'s wishlist: ${deleteError.message}.`,
          partialSave: wroteSomething,
        };
      }
      const wishlistRows = child.wishlistItems
        .map((description, idx) => ({ child_id: childId, position: idx + 1, description: description.trim() }))
        .filter((row) => row.description);
      if (wishlistRows.length > 0) {
        const { error: wishlistError } = await supabase.from("wishlist_items").insert(wishlistRows);
        if (wishlistError) {
          await refresh();
          return {
            ok: false,
            error: `Couldn't save ${child.firstName}'s wishlist: ${wishlistError.message}.`,
            partialSave: wroteSomething,
          };
        }
      }
    }

    await refresh();
    return { ok: true };
  }

  async function updateAssignmentStatus(assignmentId: string, status: AssignmentStatus): Promise<Result> {
    const supabase = createClient();
    const now = new Date().toISOString();
    const patch: Record<string, string> = { status };
    if (status === "purchased") patch.purchased_at = now;
    if (status === "received_at_church") patch.received_at_church_at = now;
    if (status === "verified") patch.verified_at = now;
    if (status === "delivered") patch.delivered_at = now;

    const { error } = await supabase.from("assignments").update(patch).eq("id", assignmentId);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  async function cancelAssignment(assignmentId: string): Promise<Result> {
    const supabase = createClient();
    const { error } = await supabase.from("assignments").update({ status: "cancelled" }).eq("id", assignmentId);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  async function updateAssignmentNotes(assignmentId: string, notes: string): Promise<Result> {
    const supabase = createClient();
    const { error } = await supabase
      .from("assignments")
      .update({ volunteer_notes: notes.trim() || null })
      .eq("id", assignmentId);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  async function updateCardPrinted(cardId: string, printed: boolean): Promise<Result> {
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .update({ printed_at: printed ? new Date().toISOString() : null })
      .eq("id", cardId);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  async function setShopDayTracking(
    childId: string,
    input: { status: ShopDayStatus; notes: string },
  ): Promise<Result> {
    const supabase = createClient();
    const { error } = await supabase
      .from("children")
      .update({ shop_day_status: input.status, shop_day_notes: input.notes.trim() || null })
      .eq("id", childId);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  async function setChildHold(childId: string, reason: string): Promise<Result> {
    const supabase = createClient();
    const { error } = await supabase.rpc("set_child_hold", {
      p_child_id: childId,
      p_reason: reason.trim() || null,
    });
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  async function releaseChildHold(childId: string): Promise<Result> {
    const supabase = createClient();
    const { error } = await supabase.rpc("release_child_hold", { p_child_id: childId });
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  // US-42: pause/resume this school's daily counselor review digest. Plain
  // RLS-gated table write (the existing "admin update drive_schools" policy
  // already requires is_admin()) — no server function needed, this isn't a
  // security boundary, just a preference send_counselor_digests() reads.
  async function setSchoolDigestPaused(driveSchoolId: string, paused: boolean): Promise<Result> {
    const supabase = createClient();
    const { error } = await supabase
      .from("drive_schools")
      .update({ digest_paused: paused })
      .eq("id", driveSchoolId);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  async function updateFamilyDistribution(familyId: string, input: FamilyDistributionInput): Promise<Result> {
    const supabase = createClient();
    const { error } = await supabase
      .from("families")
      .update({
        scheduled_pickup_at: input.scheduledPickupAt,
        distribution_method_override:
          input.distributionMethodOverride === "inherit" ? null : input.distributionMethodOverride,
      })
      .eq("id", familyId);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  async function checkInFamily(familyId: string): Promise<Result> {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("families")
      .update({ checked_in_at: new Date().toISOString(), checked_in_by: userData.user?.id ?? null })
      .eq("id", familyId);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  async function undoCheckInFamily(familyId: string): Promise<Result> {
    const supabase = createClient();
    const { error } = await supabase
      .from("families")
      .update({ checked_in_at: null, checked_in_by: null })
      .eq("id", familyId);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  // US-55/56: plain insert, same authority level as entering a family by
  // hand — RLS on sponsor_families ("staff insert sponsor_families",
  // supabase/migrations/20261015140000_sponsor_families.sql) permits any
  // authenticated user, so no RPC is needed here.
  async function createSponsorFamily(input: CreateSponsorFamilyInput): Promise<Result> {
    if (!data) return { ok: false, error: "Data hasn't finished loading yet." };

    const trimmedName = input.displayName.trim();
    if (!trimmedName) return { ok: false, error: "A display name is required." };

    const supabase = createClient();
    const { error } = await supabase.from("sponsor_families").insert({
      drive_id: data.drive.id,
      display_name: trimmedName,
      contact_email: input.contactEmail?.trim() || null,
      contact_phone: input.contactPhone?.trim() || null,
      capacity: input.capacity ?? null,
      notes: input.notes?.trim() || null,
    });
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  // US-56: the Church Center roster CSV import. One insert statement for the
  // whole batch — see BulkImportSponsorFamiliesResult's doc comment for why
  // `created` has no partial-success story to tell.
  async function bulkImportSponsorFamilies(
    rows: { displayName: string; contactEmail?: string; contactPhone?: string; capacity?: number }[]
  ): Promise<BulkImportSponsorFamiliesResult> {
    if (!data) return { ok: false, error: "Data hasn't finished loading yet." };

    const validRows = rows
      .map((r) => ({ ...r, displayName: r.displayName.trim() }))
      .filter((r) => r.displayName.length > 0);
    if (validRows.length === 0) {
      return { ok: false, error: "No rows with a display name to import." };
    }

    const supabase = createClient();
    const { data: inserted, error } = await supabase
      .from("sponsor_families")
      .insert(
        validRows.map((r) => ({
          drive_id: data.drive.id,
          display_name: r.displayName,
          contact_email: r.contactEmail?.trim() || null,
          contact_phone: r.contactPhone?.trim() || null,
          capacity: r.capacity ?? null,
        }))
      )
      .select("id");
    if (error) return { ok: false, error: error.message };

    await refresh();
    return { ok: true, created: (inserted ?? []).length };
  }

  // US-57: edit a roster entry in place (contact info, capacity, notes) or
  // retire it (isActive: false) without losing the assignment history
  // through it.
  async function updateSponsorFamily(id: string, patch: UpdateSponsorFamilyPatch): Promise<Result> {
    const supabase = createClient();
    const dbPatch: Record<string, unknown> = {};
    if (patch.displayName !== undefined) {
      // Same non-blank guard createSponsorFamily applies on insert — without
      // it, editing a name down to whitespace passes both the DB's `not
      // null` constraint and the form's HTML5 `required` (which doesn't
      // block whitespace-only input), leaving a roster entry with an empty
      // display name.
      const trimmedName = patch.displayName.trim();
      if (!trimmedName) return { ok: false, error: "A display name is required." };
      dbPatch.display_name = trimmedName;
    }
    if (patch.contactEmail !== undefined) dbPatch.contact_email = patch.contactEmail?.trim() || null;
    if (patch.contactPhone !== undefined) dbPatch.contact_phone = patch.contactPhone?.trim() || null;
    if (patch.capacity !== undefined) dbPatch.capacity = patch.capacity;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes?.trim() || null;
    if (patch.isActive !== undefined) dbPatch.is_active = patch.isActive;

    const { error } = await supabase.from("sponsor_families").update(dbPatch).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }

  // US-58: the staff-assignment write path. Calls
  // assign_card_to_sponsor_family (security definer — see the migration for
  // why), which refuses an already-claimed, confidential, or cross-drive
  // card/roster-entry pairing and returns `{ ok: false, error }` for every one
  // of those rather than raising, same shape as claimCardWithCode above.
  async function assignCardToSponsorFamily(
    cardId: string,
    sponsorFamilyId: string
  ): Promise<AssignCardToSponsorFamilyResult> {
    const supabase = createClient();
    const { data: rpcData, error } = await supabase.rpc("assign_card_to_sponsor_family", {
      p_card_id: cardId,
      p_sponsor_family_id: sponsorFamilyId,
    });
    if (error) return { ok: false, error: error.message };

    const result = rpcData as AssignCardToSponsorFamilyResponse | null;
    if (!result?.ok || !result.sponsor_id || !result.assignment_id) {
      return {
        ok: false,
        error: result?.error ?? "Something went wrong assigning this card. Please try again.",
      };
    }
    await refresh();
    return { ok: true, sponsorId: result.sponsor_id, assignmentId: result.assignment_id };
  }

  // Calls the send-sponsor-emails Edge Function with this staff member's own
  // session. Each call sends one batch; keep calling until nothing is left,
  // so one click works through the whole roster.
  async function sendSponsorEmails(kind: SponsorEmailKind): Promise<SendSponsorEmailsResult> {
    const supabase = createClient();
    let sent = 0;
    const failedByName = new Map<string, string>();
    let error: string | undefined;

    for (let round = 0; round < 50; round++) {
      const { data: body, error: invokeError } = await supabase.functions.invoke("send-sponsor-emails", {
        body: { kind },
      });
      if (invokeError || !body) {
        // A non-2xx reply comes back as an error whose `context` is the raw
        // Response; the function's own { error } message is in its body.
        let detail: string | undefined;
        try {
          const ctx = (invokeError as { context?: Response } | null)?.context;
          detail = ctx ? (await ctx.json())?.error : undefined;
        } catch {
          detail = undefined;
        }
        error = detail ?? invokeError?.message ?? "Couldn't reach the email service.";
        break;
      }
      sent += body.sent ?? 0;
      for (const f of body.failed ?? []) failedByName.set(f.sponsorName, f.reason);
      if (!body.ok) {
        error = body.error ?? "Sending stopped part-way. Check the list below, then try again.";
        break;
      }
      // Failed sponsors stay leased for 10 minutes, so each round moves on to
      // new households; an empty batch means there's nobody left to try.
      if ((body.remaining ?? 0) === 0 || (body.batchSize ?? 0) === 0) break;
    }

    await refresh();
    const failed = [...failedByName].map(([sponsorName, reason]) => ({ sponsorName, reason }));
    return { ok: !error && failed.length === 0, sent, failed, error };
  }

  function addSavedView(view: Omit<SavedView, "id">) {
    setSavedViews((prev) => [...prev, { ...view, id: crypto.randomUUID() }]);
  }

  function deleteSavedView(id: string) {
    setSavedViews((prev) => prev.filter((v) => v.id !== id));
  }

  return (
    <DataContext.Provider
      value={{
        data,
        loading,
        error,
        refresh,
        viewerRole,
        addSchool,
        addFamily,
        saveFamilyEdit,
        updateAssignmentStatus,
        cancelAssignment,
        updateAssignmentNotes,
        updateCardPrinted,
        setShopDayTracking,
        setChildHold,
        releaseChildHold,
        setSchoolDigestPaused,
        updateFamilyDistribution,
        checkInFamily,
        undoCheckInFamily,
        createSponsorFamily,
        bulkImportSponsorFamilies,
        updateSponsorFamily,
        assignCardToSponsorFamily,
        sendSponsorEmails,
        savedViews,
        addSavedView,
        deleteSavedView,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within a DataProvider");
  return ctx;
}
