"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapProfile } from "@/lib/supabase/mappers";
import type { AppRole, Profile } from "@/lib/types";
import { SearchInput } from "@/components/SearchInput";
import { AdminPageHeader } from "../AdminPageHeader";

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  volunteer: "Volunteer",
};

export default function StaffPage() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | AppRole>("all");

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const [{ data: userData }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("profiles").select("*").order("created_at", { ascending: true }),
    ]);
    setCurrentUserId(userData.user?.id ?? null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setProfiles((data ?? []).map(mapProfile));
  }, []);

  useEffect(() => {
    // Fetching from Supabase on mount — the sanctioned "sync from an external
    // system" exception to the no-setState-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function updateRole(id: string, role: AppRole) {
    setSavingId(id);
    setRowError(null);
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    setSavingId(null);
    if (error) {
      setRowError({ id, message: error.message });
      return;
    }
    await load();
  }

  async function updateConfidentialAccess(id: string, canViewConfidential: boolean) {
    setSavingId(id);
    setRowError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ can_view_confidential: canViewConfidential })
      .eq("id", id);
    setSavingId(null);
    if (error) {
      setRowError({ id, message: error.message });
      return;
    }
    await load();
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="rounded-lg bg-status-critical/10 px-4 py-3 text-sm text-ink-primary">
          Couldn&apos;t load staff accounts: {loadError}
        </div>
      </div>
    );
  }

  if (!profiles) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <p className="text-ink-secondary">Loading…</p>
      </div>
    );
  }

  const isViewerAdmin = profiles.some((p) => p.id === currentUserId && p.role === "admin");
  const q = search.trim().toLowerCase();
  const filteredProfiles = profiles.filter((p) => {
    const roleMatches = roleFilter === "all" || p.role === roleFilter;
    const searchMatches = !q || [p.fullName, p.email ?? ""].join(" ").toLowerCase().includes(q);
    return roleMatches && searchMatches;
  });

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <AdminPageHeader
        title="Staff & permissions"
        description="Who can access this app, and what they can see. Accounts themselves are still created in the Supabase dashboard (Authentication → Add user). This page only manages role and confidential access for accounts that already exist."
      />

      {!isViewerAdmin ? (
        <div className="mb-6 rounded-lg bg-status-warning/15 px-4 py-3 text-sm text-ink-primary">
          You&apos;re signed in as a volunteer, so you can only see your own account here. Only an admin
          can view or change everyone else&apos;s role and access.
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email…" />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as "all" | AppRole)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary"
        >
          <option value="all">All roles</option>
          {(Object.keys(ROLE_LABELS) as AppRole[]).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        <p className="ml-auto text-sm text-ink-muted">
          {filteredProfiles.length} of {profiles.length}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Confidential access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredProfiles.map((p) => {
              const isSelf = p.id === currentUserId;
              const disabled = !isViewerAdmin || isSelf || savingId === p.id;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3 text-ink-primary">
                    {p.fullName}
                    {isSelf ? <span className="ml-1.5 text-xs text-ink-muted">(you)</span> : null}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">{p.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <select
                      value={p.role}
                      disabled={disabled}
                      onChange={(e) => updateRole(p.id, e.target.value as AppRole)}
                      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {(Object.keys(ROLE_LABELS) as AppRole[]).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 text-ink-secondary">
                      <input
                        type="checkbox"
                        checked={p.canViewConfidential}
                        disabled={disabled}
                        onChange={(e) => updateConfidentialAccess(p.id, e.target.checked)}
                        className="h-4 w-4 rounded border-border disabled:cursor-not-allowed"
                      />
                      Confidential households
                    </label>
                  </td>
                </tr>
              );
            })}
            {filteredProfiles.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-secondary">
                  No accounts match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {rowError ? (
        <div className="mt-4 rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">
          {rowError.message}
        </div>
      ) : null}

      <p className="mt-4 text-xs text-ink-muted">
        Admins always have confidential access regardless of this checkbox; it only matters for
        volunteers who need to see confidential households without being made a full admin. You
        can&apos;t change your own role or access here (so you can&apos;t accidentally lock yourself
        out), so ask another admin, or use the SQL editor directly if you&apos;re the only one.
      </p>
    </div>
  );
}
