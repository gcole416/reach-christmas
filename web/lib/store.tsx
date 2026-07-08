"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "./supabase/client";
import {
  mapAssignment,
  mapCard,
  mapChild,
  mapDrive,
  mapDriveSchool,
  mapFamily,
  mapSchool,
  mapSponsor,
  mapWishlistItem,
} from "./supabase/mappers";
import type { DataBundle, DistributionMethod } from "./types";

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

type Result = { ok: true } | { ok: false; error: string };

interface DataContextValue {
  data: DataBundle | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addSchool: (input: AddSchoolInput) => Promise<Result>;
  savedViews: SavedView[];
  addSavedView: (view: Omit<SavedView, "id">) => void;
  deleteSavedView: (id: string) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

async function fetchDataBundle(): Promise<DataBundle> {
  const supabase = createClient();

  const [drive, schools, driveSchools, families, children, wishlistItems, sponsors, cards, assignments] =
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
    ]);

  for (const res of [drive, schools, driveSchools, families, children, wishlistItems, sponsors, cards, assignments]) {
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
  };
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
      return { ok: false, error: driveSchoolError.message };
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
      value={{ data, loading, error, refresh, addSchool, savedViews, addSavedView, deleteSavedView }}
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
