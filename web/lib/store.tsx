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
import type { AppRole, AuditLogEntry, DataBundle, DistributionMethod } from "./types";

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

export interface VolunteerAccessChanges {
  role?: AppRole;
  canViewConfidential?: boolean;
}

type Result = { ok: true } | { ok: false; error: string };

interface DataContextValue {
  data: DataBundle | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addSchool: (input: AddSchoolInput) => Promise<Result>;
  updateVolunteerAccess: (profileId: string, changes: VolunteerAccessChanges) => Promise<Result>;
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading saved views is a one-time read from an external system (localStorage) on mount
    setSavedViews(loadSavedViews());
    setHydrated(true);
    refresh();
  }, [refresh]);

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

  // Admin-only in practice: any non-admin caller (including a volunteer
  // trying to self-promote or self-grant confidential access) is blocked by
  // the guard_profile_privilege_columns trigger
  // (supabase/migrations/20260808130000_profiles_column_guard.sql), which
  // raises a Postgres exception rather than silently no-op'ing. That
  // exception surfaces here as `.error`, same as any other Supabase error —
  // there's nothing UI-side enforcing "only admins can call this," so don't
  // treat a resolved `Result` as proof the caller was authorized; the trigger
  // is the actual boundary.
  async function updateVolunteerAccess(profileId: string, changes: VolunteerAccessChanges): Promise<Result> {
    if (changes.role === undefined && changes.canViewConfidential === undefined) {
      return { ok: false, error: "No changes to apply." };
    }

    const supabase = createClient();

    const patch: { role?: AppRole; can_view_confidential?: boolean } = {};
    if (changes.role !== undefined) patch.role = changes.role;
    if (changes.canViewConfidential !== undefined) patch.can_view_confidential = changes.canViewConfidential;

    const { data: updated, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", profileId)
      .select()
      .maybeSingle();
    if (error) {
      return { ok: false, error: error.message };
    }
    if (!updated) {
      return { ok: false, error: "No matching profile, or you don't have permission to change it." };
    }

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
        addSchool,
        updateVolunteerAccess,
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
