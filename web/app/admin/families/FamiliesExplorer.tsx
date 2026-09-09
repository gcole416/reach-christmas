"use client";

import { useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { displayFirstName, getAdminFamilies, getSchoolsForDrive } from "@/lib/queries";
import { StatusBadge, STATUS_OPTIONS } from "@/components/StatusBadge";
import { SearchInput } from "@/components/SearchInput";

interface ViewFilters {
  schoolFilter: string; // "all" | driveSchoolId | "confidential"
  statusFilter: string; // "all" | AssignmentStatus | "unclaimed"
}

const ALL_VIEW = { id: "__all", name: "All", schoolFilter: "all", statusFilter: "all" } as const;

export function FamiliesExplorer() {
  const { data, viewerRole, savedViews, addSavedView, deleteSavedView } = useData();
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [newViewName, setNewViewName] = useState("");
  const [search, setSearch] = useState("");

  if (!data) return null;

  const isAdmin = viewerRole === "admin";
  const families = getAdminFamilies(data);
  const schools = getSchoolsForDrive(data);

  const rows = families.flatMap((family) =>
    family.children.flatMap((child) =>
      child.cards.map((card) => ({
        key: card.cardId,
        familyId: family.familyId,
        driveSchoolId: family.driveSchoolId,
        school: family.schoolName ?? "Confidential / direct referral",
        familyLabel: `Household ${family.householdTag}`,
        isConfidential: family.isConfidential,
        childName: displayFirstName(child.firstName, family.isConfidential, isAdmin),
        grade: child.grade,
        cardNumber: card.cardNumber,
        status: card.status,
        isHighSchooler: child.isHighSchooler,
        sponsorName: card.sponsorName,
      }))
    )
  );

  const q = search.trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    const schoolMatches =
      schoolFilter === "all"
        ? true
        : schoolFilter === "confidential"
          ? row.isConfidential
          : schoolFilter === "direct"
            ? !row.isConfidential && row.driveSchoolId === null
            : row.driveSchoolId === schoolFilter;
    const statusMatches = statusFilter === "all" || row.status === statusFilter;
    const searchMatches =
      !q ||
      [
        row.school,
        row.familyLabel,
        row.childName,
        row.cardNumber,
        row.sponsorName ?? "",
        row.isHighSchooler ? "high schooler shop day" : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return schoolMatches && statusMatches && searchMatches;
  });

  function applyView(view: ViewFilters) {
    setSchoolFilter(view.schoolFilter);
    setStatusFilter(view.statusFilter);
  }

  function handleSaveView() {
    const name = newViewName.trim();
    if (!name) return;
    addSavedView({ name, schoolFilter, statusFilter });
    setNewViewName("");
  }

  const allViews = [ALL_VIEW, ...savedViews];

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        {allViews.map((view) => {
          const active = schoolFilter === view.schoolFilter && statusFilter === view.statusFilter;
          return (
            <div key={view.id} className="group relative">
              <button
                onClick={() => applyView(view)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  active
                    ? "border-cat-blue bg-cat-blue/10 text-ink-primary"
                    : "border-border text-ink-secondary hover:border-cat-blue"
                }`}
              >
                {view.name}
              </button>
              {view.id !== ALL_VIEW.id ? (
                <button
                  onClick={() => deleteSavedView(view.id)}
                  aria-label={`Delete view ${view.name}`}
                  className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-ink-muted text-[10px] leading-none text-surface group-hover:flex"
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-ink-secondary">Search</span>
          <SearchInput value={search} onChange={setSearch} placeholder="Child, household, card, sponsor…" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-secondary">School</span>
          <select
            value={schoolFilter}
            onChange={(e) => setSchoolFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary"
          >
            <option value="all">All schools</option>
            {schools.map((s) => (
              <option key={s.driveSchoolId} value={s.driveSchoolId}>
                {s.name}
              </option>
            ))}
            <option value="direct">Direct referral (no school)</option>
            <option value="confidential">Confidential</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-secondary">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary"
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-ink-secondary">Save this view as…</span>
            <input
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              placeholder="e.g. Lincoln overdue"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
            />
          </label>
          <button
            onClick={handleSaveView}
            disabled={!newViewName.trim()}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save view
          </button>
        </div>

        <p className="ml-auto text-sm text-ink-muted">
          {filteredRows.length} of {rows.length} rows
        </p>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">School</th>
              <th className="px-4 py-3 font-medium">Household</th>
              <th className="px-4 py-3 font-medium">Child</th>
              <th className="px-4 py-3 font-medium">Grade</th>
              <th className="px-4 py-3 font-medium">Card</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Sponsor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredRows.map((row) => (
              <tr key={row.key}>
                <td className="px-4 py-3 text-ink-secondary">
                  {row.isConfidential ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-status-serious/15 px-2.5 py-1 text-xs font-medium text-ink-primary">
                      Confidential
                    </span>
                  ) : (
                    row.school
                  )}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/admin/families/${row.familyId}`} className="text-cat-blue hover:underline">
                    {row.familyLabel}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-primary">{row.childName}</td>
                <td className="px-4 py-3 text-ink-secondary">{row.grade ?? "—"}</td>
                <td className="px-4 py-3 text-ink-secondary">{row.cardNumber}</td>
                <td className="px-4 py-3">
                  {row.isHighSchooler ? (
                    <span className="inline-flex items-center rounded-full bg-cat-blue/10 px-2.5 py-1 text-xs font-medium text-cat-blue">
                      High schooler · shop day
                    </span>
                  ) : (
                    <StatusBadge status={row.status} />
                  )}
                </td>
                <td className="px-4 py-3 text-ink-secondary">
                  {row.isHighSchooler ? "—" : row.sponsorName ?? "—"}
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-secondary">
                  No rows match this view.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
