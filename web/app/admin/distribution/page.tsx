"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { getDistributionRows, getSchoolsForDrive } from "@/lib/queries";
import type { DistributionMethod } from "@/lib/types";
import { SearchInput } from "@/components/SearchInput";
import { AdminNav } from "../AdminNav";

const DISTRIBUTION_LABELS: Record<DistributionMethod, string> = {
  school_dropoff: "School drop-off",
  church_pickup: "Church pickup",
};

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export default function DistributionPage() {
  const { data, updateFamilyDistribution, checkInFamily, undoCheckInFamily } = useData();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [search, setSearch] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [checkInFilter, setCheckInFilter] = useState<"all" | "checked_in" | "not_checked_in">("all");

  if (!data) return null;

  const schools = getSchoolsForDrive(data);
  const allRows = getDistributionRows(data);
  const q = search.trim().toLowerCase();
  const rows = allRows.filter((row) => {
    const schoolMatches =
      schoolFilter === "all"
        ? true
        : schoolFilter === "confidential"
          ? row.isConfidential
          : schoolFilter === "direct"
            ? !row.isConfidential && row.driveSchoolId === null
            : row.driveSchoolId === schoolFilter;
    const checkInMatches =
      checkInFilter === "all" ||
      (checkInFilter === "checked_in" ? !!row.checkedInAt : !row.checkedInAt);
    const searchMatches =
      !q ||
      [row.schoolName ?? "", `household ${row.householdTag}`, `family ${row.familyNumber}`]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return schoolMatches && checkInMatches && searchMatches;
  });

  async function handleScheduleChange(familyId: string, value: string, override: DistributionMethod | null) {
    setBusyId(familyId);
    setRowError(null);
    const result = await updateFamilyDistribution(familyId, {
      scheduledPickupAt: fromDatetimeLocalValue(value),
      distributionMethodOverride: override ?? "inherit",
    });
    setBusyId(null);
    if (!result.ok) setRowError({ id: familyId, message: result.error });
  }

  async function handleMethodChange(familyId: string, scheduledPickupAt: string | null, value: string) {
    setBusyId(familyId);
    setRowError(null);
    const result = await updateFamilyDistribution(familyId, {
      scheduledPickupAt,
      distributionMethodOverride: value === "inherit" ? "inherit" : (value as DistributionMethod),
    });
    setBusyId(null);
    if (!result.ok) setRowError({ id: familyId, message: result.error });
  }

  async function handleToggleCheckIn(familyId: string, isCheckedIn: boolean) {
    setBusyId(familyId);
    setRowError(null);
    const result = isCheckedIn ? await undoCheckInFamily(familyId) : await checkInFamily(familyId);
    setBusyId(null);
    if (!result.ok) setRowError({ id: familyId, message: result.error });
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-ink-primary">Distribution</h1>
      <p className="mt-2 text-ink-secondary">
        One row per household. Set a distribution method or pickup time, and check a household in as they
        actually come through — however this year&apos;s drive ends up running (school drop-off, a single
        pickup event, or a mix), it&apos;s tracked here per household rather than assumed drive-wide.
      </p>

      <AdminNav />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by household or school…" />
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
        <select
          value={checkInFilter}
          onChange={(e) => setCheckInFilter(e.target.value as "all" | "checked_in" | "not_checked_in")}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary"
        >
          <option value="all">All households</option>
          <option value="checked_in">Checked in</option>
          <option value="not_checked_in">Not checked in</option>
        </select>
        <p className="ml-auto text-sm text-ink-muted">
          {rows.length} of {allRows.length}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Household</th>
              <th className="px-4 py-3 font-medium">Method</th>
              <th className="px-4 py-3 font-medium">Scheduled pickup</th>
              <th className="px-4 py-3 font-medium">Progress</th>
              <th className="px-4 py-3 font-medium">Checked in</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const busy = busyId === row.familyId;
              const isCheckedIn = !!row.checkedInAt;
              return (
                <tr key={row.familyId}>
                  <td className="px-4 py-3 text-ink-primary">
                    {row.isConfidential ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-status-serious/15 px-2.5 py-1 text-xs font-medium text-ink-primary">
                        Confidential
                      </span>
                    ) : (
                      <>
                        {row.schoolName ?? "Direct referral"} <span className="text-ink-muted">· Household {row.householdTag}</span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={row.distributionMethodOverride ?? "inherit"}
                      disabled={busy}
                      onChange={(e) => handleMethodChange(row.familyId, row.scheduledPickupAt, e.target.value)}
                      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink-primary disabled:opacity-60"
                    >
                      <option value="inherit">
                        Inherit{row.distributionMethod ? ` (${DISTRIBUTION_LABELS[row.distributionMethod]})` : ""}
                      </option>
                      <option value="school_dropoff">School drop-off</option>
                      <option value="church_pickup">Church pickup</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="datetime-local"
                      value={toDatetimeLocalValue(row.scheduledPickupAt)}
                      disabled={busy}
                      onChange={(e) =>
                        handleScheduleChange(row.familyId, e.target.value, row.distributionMethodOverride)
                      }
                      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink-primary disabled:opacity-60"
                    />
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {row.deliveredCards} / {row.totalCards} delivered
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleCheckIn(row.familyId, isCheckedIn)}
                      disabled={busy}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        isCheckedIn
                          ? "bg-status-good/15 text-ink-primary hover:bg-status-good/25"
                          : "bg-cat-blue text-white hover:opacity-90"
                      }`}
                    >
                      {busy ? "Saving…" : isCheckedIn ? `Checked in ✓` : "Check in"}
                    </button>
                    {rowError?.id === row.familyId ? (
                      <p className="mt-1 text-xs text-status-critical">{rowError.message}</p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-secondary">
                  {allRows.length === 0 ? "No households registered yet." : "No rows match this filter."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
