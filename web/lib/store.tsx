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
  mapWishlistItem,
} from "./supabase/mappers";
import type { AppRole, AssignmentStatus, AuditLogEntry, DataBundle, DistributionMethod } from "./types";

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
  targetCardCount: string;
  wishlistItems: string[];
}

export interface AddFamilyInput {
  referralType: ReferralType;
  driveSchoolId: string | null;
  sortTag: string;
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
  sortTag: string;
  internalNotes: string;
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
  updateCardPrinted: (cardId: string, printed: boolean) => Promise<Result>;
  updateFamilyDistribution: (familyId: string, input: FamilyDistributionInput) => Promise<Result>;
  checkInFamily: (familyId: string) => Promise<Result>;
  undoCheckInFamily: (familyId: string) => Promise<Result>;
  savedViews: SavedView[];
  addSavedView: (view: Omit<SavedView, "id">) => void;
  deleteSavedView: (id: string) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

async function fetchDataBundle(): Promise<DataBundle> {
  const supabase = createClient();

  const [drive, schools, driveSchools, families, children, wishlistItems, sponsors, cards, assignments, profiles] =
    await Promise.all([
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
    ]);

  for (const res of [drive, schools, driveSchools, families, children, wishlistItems, sponsors, cards, assignments, profiles]) {
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
  };
}

// Only handles the "raise target_card_count" direction (see SCHEMA.md §7) —
// generates the missing card row(s) and syncs total_copies on every sibling
// card for that child. Lowering the count is deliberately a no-op: a card
// that's already been claimed can't be safely un-generated from here, so
// shrinking stays a manual/admin decision rather than something a save
// button does silently.
async function reconcileCardsForChild(
  supabase: ReturnType<typeof createClient>,
  childId: string,
  targetCardCount: number,
  existingCardCount: number
): Promise<{ error: string | null }> {
  if (targetCardCount <= existingCardCount) return { error: null };

  const newRows = Array.from({ length: targetCardCount - existingCardCount }, (_, i) => ({
    child_id: childId,
    copy_number: existingCardCount + i + 1,
    total_copies: targetCardCount,
  }));
  const { error: insertError } = await supabase.from("cards").insert(newRows);
  if (insertError) return { error: insertError.message };

  const { error: updateError } = await supabase.from("cards").update({ total_copies: targetCardCount }).eq("child_id", childId);
  if (updateError) return { error: updateError.message };

  return { error: null };
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

// Sane plain-language defaults. The edit page owns the final wording of the
// conflict banner (US-13) — these are what it gets if it just renders
// `result.error`.
const CONFLICT_MESSAGE =
  "Someone else changed this family while you were editing it. Reload to see their version, or save your version anyway to replace theirs.";

// Deliberately the SAME message for "the row does not exist" and "row level
// security hid it from you". A volunteer without can_view_confidential() gets
// zero rows back for a confidential family exactly like they would for a
// deleted one (see the "staff read families" policy in
// supabase/migrations/20260708140000_confidential_referral_access.sql), and
// answering that with "someone else changed this" would confirm the row
// exists. Generic not-found is the only safe answer on that path.
const NOT_FOUND_MESSAGE =
  "This family couldn't be found, or you no longer have access to it. Reload the page.";

// Shown when the caller had no row version to check against, so we can't tell
// whether anyone else has edited in the meantime. Refusing is the safe
// direction: the whole point of US-13 is not to blind-overwrite.
const UNVERIFIABLE_MESSAGE =
  "Couldn't check whether anyone else has changed this family. Reload the page and make your edit again.";

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

    const { data: schoolRow, error: schoolError } = await supabase
      .from("schools")
      .insert({ name: trimmedName })
      .select()
      .single();
    if (schoolError || !schoolRow) {
      return { ok: false, error: schoolError?.message ?? "Could not create the school." };
    }

    const { error: driveSchoolError } = await supabase.from("drive_schools").insert({
      drive_id: data.drive.id,
      school_id: schoolRow.id,
      code: trimmedCode,
      liaison_name: input.liaisonName.trim() || null,
      liaison_phone: input.liaisonPhone.trim() || null,
      liaison_email: input.liaisonEmail.trim() || null,
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
      p_sort_tag: input.sortTag.trim() || null,
      p_internal_notes: input.internalNotes.trim() || null,
    });
    if (familyError || !familyRow) {
      return { ok: false, error: familyError?.message ?? "Could not create the family." };
    }

    for (let i = 0; i < validChildren.length; i++) {
      const child = validChildren[i];
      const targetCardCount = Math.max(1, Number(child.targetCardCount) || 1);

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
          target_card_count: targetCardCount,
        })
        .select()
        .single();
      if (childError || !childRow) {
        await refresh();
        return {
          ok: false,
          error: `Family saved, but couldn't add ${child.firstName || "a child"}: ${
            childError?.message ?? "unknown error"
          }. What was saved so far is already in "All families" — check there before retrying.`,
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

      const cardRows = Array.from({ length: targetCardCount }, (_, idx) => ({
        child_id: childRow.id,
        copy_number: idx + 1,
        total_copies: targetCardCount,
      }));
      const { error: cardError } = await supabase.from("cards").insert(cardRows);
      if (cardError) {
        await refresh();
        return {
          ok: false,
          error: `Couldn't generate a claimable card for ${child.firstName}: ${cardError.message}. Everything else was saved — use "Cards to print" to retry.`,
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
      return { ok: false, error: "A family needs at least one child with a first name.", partialSave: false };
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
        sort_tag: details.sortTag.trim() || null,
        internal_notes: details.internalNotes.trim() || null,
      })
      .eq("id", familyId);
    if (!force) {
      // Guard with the value the pre-flight just read rather than the one the
      // caller passed: identical at this point (we just compared them), but
      // guaranteed to be PostgREST's own rendering, un-round-tripped through
      // form state. Still closes the pre-flight-to-write window.
      familyUpdate = familyUpdate.eq("updated_at", familyRow.updated_at);
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
      const targetCardCount = Math.max(1, Number(child.targetCardCount) || 1);
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
        target_card_count: targetCardCount,
      };

      if (childId) {
        let childUpdate = supabase.from("children").update(childFields).eq("id", childId);
        // Present for every id-bearing block — the pre-flight loop above
        // returned NOT_FOUND for any that weren't.
        const knownVersion = currentChildById.get(childId);
        if (!force && knownVersion) {
          // Same reasoning as the family guard above: use the pre-flight
          // reading of this row's version, and .select() so a zero-row result
          // is observable.
          childUpdate = childUpdate.eq("updated_at", knownVersion.updated_at);
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
      }

      if (!childId) {
        await refresh();
        return {
          ok: false,
          error: `Internal error saving ${child.firstName} — no child id was resolved.`,
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

      const existingCardCount = data.cards.filter((c) => c.childId === child.id).length;
      const { error: cardError } = await reconcileCardsForChild(supabase, childId, targetCardCount, existingCardCount);
      if (cardError) {
        await refresh();
        return {
          ok: false,
          error: `Couldn't generate cards for ${child.firstName}: ${cardError}.`,
          partialSave: wroteSomething,
        };
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
        updateCardPrinted,
        updateFamilyDistribution,
        checkInFamily,
        undoCheckInFamily,
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
