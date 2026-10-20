"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { getSponsorFamilies } from "@/lib/queries";
import type { SponsorFamily } from "@/lib/types";
import { SearchInput } from "@/components/SearchInput";
import { AdminPageHeader } from "../AdminPageHeader";
import { SponsorFamilyFormModal } from "./SponsorFamilyFormModal";
import { ImportSponsorsModal } from "./ImportSponsorsModal";

// US-56: the sponsor sign-up roster staff import from Church Center (plus any
// stragglers added by hand). This page only lists/edits `sponsor_families`
// rows for the current drive — picking a card to put against one of them is
// a separate screen (/admin/assign, US-57), same split as Schools vs. the
// intake form.

type StatusFilter = "active" | "inactive" | "all";

export default function SponsorsAdminPage() {
  const { data, updateSponsorFamily } = useData();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editTarget, setEditTarget] = useState<SponsorFamily | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  if (!data) return null;

  const allSponsorFamilies = getSponsorFamilies(data);
  const q = search.trim().toLowerCase();
  const sponsorFamilies = allSponsorFamilies.filter((sf) => {
    const statusMatches =
      statusFilter === "all" ? true : statusFilter === "active" ? sf.isActive : !sf.isActive;
    const searchMatches =
      !q || [sf.displayName, sf.contactEmail ?? "", sf.contactPhone ?? ""].join(" ").toLowerCase().includes(q);
    return statusMatches && searchMatches;
  });

  async function handleToggleActive(sf: SponsorFamily) {
    setBusyId(sf.id);
    setRowError(null);
    const result = await updateSponsorFamily(sf.id, { isActive: !sf.isActive });
    setBusyId(null);
    if (!result.ok) setRowError({ id: sf.id, message: result.error });
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <AdminPageHeader
        title="Sponsor roster"
        description={
          <>
            Everyone signed up to sponsor through Church Center this year. Import the list once, add
            stragglers by hand as they sign up, and keep capacity current as entries fill. Assigning a
            card to one of these entries happens on the{" "}
            <span className="font-medium text-ink-primary">Assign sponsors</span> page.
          </>
        }
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary"
            >
              Import CSV
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              + Add sponsor
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name, email, or phone…" />
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
          <p className="text-sm text-ink-muted">
            {sponsorFamilies.length} of {allSponsorFamilies.length}
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Assigned</th>
              <th className="px-4 py-3 font-medium">Notes</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sponsorFamilies.map((sf) => {
              const atCapacity = sf.capacity != null && sf.assignedCount >= sf.capacity;
              const busy = busyId === sf.id;
              return (
                <tr key={sf.id} className={sf.isActive ? "" : "opacity-60"}>
                  <td className="px-4 py-3 text-ink-primary">
                    {sf.displayName}
                    {!sf.isActive ? (
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-ink-muted/15 px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
                        Inactive
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {sf.contactEmail ? <div>{sf.contactEmail}</div> : null}
                    {sf.contactPhone ? <div>{sf.contactPhone}</div> : null}
                    {!sf.contactEmail && !sf.contactPhone ? "—" : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={atCapacity ? "font-medium text-status-warning" : "text-ink-secondary"}>
                      {sf.assignedCount}
                      {sf.capacity != null ? ` / ${sf.capacity}` : ""}
                    </span>
                    {atCapacity ? <div className="text-xs text-status-warning">At capacity</div> : null}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-ink-secondary">
                    {sf.notes ? <span className="line-clamp-2">{sf.notes}</span> : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setEditTarget(sf)}
                        className="text-xs font-medium text-cat-blue hover:opacity-80"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleActive(sf)}
                        disabled={busy}
                        className="text-xs font-medium text-ink-secondary hover:text-ink-primary disabled:opacity-50"
                      >
                        {busy ? "Saving…" : sf.isActive ? "Mark inactive" : "Reactivate"}
                      </button>
                    </div>
                    {rowError?.id === sf.id ? (
                      <p className="mt-1 text-xs text-status-critical">{rowError.message}</p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {sponsorFamilies.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-secondary">
                  {allSponsorFamilies.length === 0
                    ? "No sponsors yet. Import a CSV from Church Center or add one by hand."
                    : "No sponsors match this view."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {showAddForm ? (
        <SponsorFamilyFormModal sponsorFamily={null} onClose={() => setShowAddForm(false)} />
      ) : null}
      {editTarget ? (
        <SponsorFamilyFormModal sponsorFamily={editTarget} onClose={() => setEditTarget(null)} />
      ) : null}
      {showImport ? <ImportSponsorsModal onClose={() => setShowImport(false)} /> : null}
    </div>
  );
}
