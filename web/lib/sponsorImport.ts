"use client";

// US-76: the write and read side of the Church Center roster import. The
// parsing/matching is in lib/sponsorCsv.ts (pure); this file is the only
// place that knows the apply_sponsor_import RPC name or the sponsor_imports
// table (supabase/migrations/20261116120000_church_center_roster_sync.sql).

import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";
import { describeDbError } from "./permissions";
import type { ImportPayload } from "./sponsorCsv";

export type ApplySponsorImportResult =
  | { ok: true; importId: string; added: number; updated: number; capacityKept: string[] }
  | { ok: false; error: string };

export async function applySponsorImport(
  driveId: string,
  fileName: string | null,
  payload: ImportPayload,
): Promise<ApplySponsorImportResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("apply_sponsor_import", {
    p_drive_id: driveId,
    p_file_name: fileName,
    p_new: payload.p_new,
    p_updates: payload.p_updates,
    p_counts: payload.p_counts,
  });
  if (error) return { ok: false, error: describeDbError(error) };
  const body = data as { ok?: boolean; import_id?: string; added?: number; updated?: number; capacity_kept?: string[] };
  if (!body?.ok || !body.import_id) return { ok: false, error: "The import didn't report back. Refresh to check what saved." };
  return {
    ok: true,
    importId: body.import_id,
    added: body.added ?? 0,
    updated: body.updated ?? 0,
    capacityKept: body.capacity_kept ?? [],
  };
}

export interface SponsorImportLog {
  id: string;
  importedAt: string;
  importedByName: string | null;
  fileName: string | null;
  addedCount: number;
  updatedCount: number;
}

/**
 * The newest import for this drive (for the "Last updated" line), plus the
 * newest one that actually added people (whose entries get the "New" badge,
 * so a no-change import doesn't clear the badges). Re-read whenever
 * `reloadKey` changes (pass the data bundle, a new object after every
 * refresh()). `latest` is `undefined` while loading, `null` when nothing has
 * been imported yet.
 */
export function useLatestSponsorImport(driveId: string | undefined, reloadKey: unknown) {
  const [state, setState] = useState<{ latest: SponsorImportLog | null | undefined; badgeImportId: string | null }>({
    latest: undefined,
    badgeImportId: null,
  });

  useEffect(() => {
    if (!driveId) return;
    let cancelled = false;
    const supabase = createClient();
    const base = () =>
      supabase
        .from("sponsor_imports")
        .select("id, imported_at, imported_by_name, file_name, added_count, updated_count")
        .eq("drive_id", driveId)
        .order("imported_at", { ascending: false })
        .limit(1);
    Promise.all([base().maybeSingle(), base().gt("added_count", 0).maybeSingle()]).then(([last, withAdds]) => {
      if (cancelled) return;
      const data = last.error ? null : last.data;
      setState({
        latest: data
          ? {
              id: data.id,
              importedAt: data.imported_at,
              importedByName: data.imported_by_name ?? null,
              fileName: data.file_name ?? null,
              addedCount: data.added_count ?? 0,
              updatedCount: data.updated_count ?? 0,
            }
          : null,
        badgeImportId: withAdds.error ? null : (withAdds.data?.id ?? null),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [driveId, reloadKey]);

  return state;
}

export function formatImportTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatSignUpDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
