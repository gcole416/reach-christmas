"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import {
  displayFirstName,
  getHighSchoolers,
  getSchoolsForDrive,
  type HighSchoolerRow,
} from "@/lib/queries";
import type { ShopDayStatus } from "@/lib/types";
import { SearchInput } from "@/components/SearchInput";
import { AdminPageHeader } from "../AdminPageHeader";

// US-35: the self-shopping high schooler roster. Grades 9-12 don't get a
// sponsor - they're invited to a store shopping day - so they need their own
// place to be counted, organised by school, and worked as the date approaches.

const STATUS_LABELS: Record<ShopDayStatus, string> = {
  not_contacted: "Not contacted",
  invited: "Invited",
  confirmed: "Confirmed",
  attended: "Attended",
};

const STATUS_ORDER: ShopDayStatus[] = ["not_contacted", "invited", "confirmed", "attended"];

export default function HighSchoolersPage() {
  const { data, viewerRole } = useData();
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  const isAdmin = viewerRole === "admin";

  const roster = useMemo(() => (data ? getHighSchoolers(data) : []), [data]);
  const schools = useMemo(() => (data ? getSchoolsForDrive(data) : []), [data]);

  if (!data) return null;

  const q = search.trim().toLowerCase();
  const filtered = roster.filter((row) => {
    const schoolMatches =
      schoolFilter === "all"
        ? true
        : schoolFilter === "confidential"
          ? row.isConfidential
          : schoolFilter === "direct"
            ? !row.isConfidential && row.driveSchoolId === null
            : row.driveSchoolId === schoolFilter;
    const statusMatches = statusFilter === "all" || row.shopDayStatus === statusFilter;
    const name = displayFirstName(row.firstName, row.isConfidential, isAdmin);
    const searchMatches =
      !q ||
      [name, row.householdTag, row.schoolName ?? "", row.grade ?? "", row.guardianName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return schoolMatches && statusMatches && searchMatches;
  });

  const counts = STATUS_ORDER.map((s) => ({
    status: s,
    n: roster.filter((r) => r.shopDayStatus === s).length,
  }));

  async function copyRoster() {
    const header = ["First name", "Household", "School", "Grade", "Age", "Guardian", "Phone", "Shop-day status"];
    const lines = filtered.map((row) =>
      [
        displayFirstName(row.firstName, row.isConfidential, isAdmin),
        row.householdTag,
        row.isConfidential ? "Confidential" : row.schoolName ?? "Direct referral",
        row.grade ?? "",
        row.age ?? "",
        row.guardianName ?? "",
        row.guardianPhone ?? "",
        STATUS_LABELS[row.shopDayStatus],
      ]
        .map((cell) => {
          const s = String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    );
    try {
      await navigator.clipboard.writeText([header.join(","), ...lines].join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <AdminPageHeader
        title="High schoolers"
        description={
          <>
            {roster.length} high schooler{roster.length === 1 ? "" : "s"} registered in{" "}
            {data.drive.name}. Grades 9 to 12 shop for their own gifts at the store shopping day, so
            they stay out of the sponsor pool and the print run. Track invites and attendance here.
          </>
        }
        action={
          <button
            onClick={copyRoster}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary"
          >
            {copied ? "Copied" : "Copy roster (CSV)"}
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map(({ status, n }) => (
          <button
            key={status}
            onClick={() => setStatusFilter((prev) => (prev === status ? "all" : status))}
            className={`rounded-xl border px-4 py-3 text-left ${
              statusFilter === status ? "border-cat-blue bg-cat-blue/5" : "border-border"
            }`}
          >
            <div className="text-2xl font-semibold text-ink-primary">{n}</div>
            <div className="text-xs text-ink-secondary">{STATUS_LABELS[status]}</div>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-ink-secondary">Search</span>
          <SearchInput value={search} onChange={setSearch} placeholder="Name, household, guardian…" />
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
          <span className="mb-1 block text-ink-secondary">Shop-day status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary"
          >
            <option value="all">All</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <p className="ml-auto text-sm text-ink-muted">
          {filtered.length} of {roster.length}
        </p>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Child</th>
              <th className="px-4 py-3 font-medium">Household</th>
              <th className="px-4 py-3 font-medium">School</th>
              <th className="px-4 py-3 font-medium">Grade / age</th>
              <th className="px-4 py-3 font-medium">Guardian</th>
              <th className="px-4 py-3 font-medium">Shop day</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((row) => (
              <TrackingRow key={row.childId} row={row} isAdmin={isAdmin} />
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-secondary">
                  {roster.length === 0
                    ? "No high schoolers registered yet."
                    : "No high schoolers match this view."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TrackingRow({ row, isAdmin }: { row: HighSchoolerRow; isAdmin: boolean }) {
  const { setShopDayTracking } = useData();
  const [status, setStatus] = useState<ShopDayStatus>(row.shopDayStatus);
  const [notes, setNotes] = useState(row.shopDayNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = status !== row.shopDayStatus || notes.trim() !== (row.shopDayNotes ?? "").trim();

  async function save(next: { status: ShopDayStatus; notes: string }) {
    setSaving(true);
    setError(null);
    const result = await setShopDayTracking(row.childId, next);
    setSaving(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <tr>
      <td className="px-4 py-3 text-ink-primary">
        {displayFirstName(row.firstName, row.isConfidential, isAdmin)}
      </td>
      <td className="px-4 py-3">
        <Link href={`/admin/families/${row.familyId}`} className="text-cat-blue hover:underline">
          {row.householdTag}
        </Link>
      </td>
      <td className="px-4 py-3 text-ink-secondary">
        {row.isConfidential ? "Confidential" : row.schoolName ?? "Direct referral"}
      </td>
      <td className="px-4 py-3 text-ink-secondary">
        {row.grade ?? "—"}
        {row.age !== null ? ` · ${row.age}` : ""}
      </td>
      <td className="px-4 py-3 text-ink-secondary">
        {row.guardianName ?? "—"}
        {row.guardianPhone ? (
          <span className="block text-xs text-ink-muted">{row.guardianPhone}</span>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5">
          <select
            value={status}
            onChange={(e) => {
              const next = e.target.value as ShopDayStatus;
              setStatus(next);
              void save({ status: next, notes });
            }}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink-primary"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes.trim() !== (row.shopDayNotes ?? "").trim()) void save({ status, notes });
            }}
            placeholder="Notes"
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
          />
          {saving ? <span className="text-xs text-ink-muted">Saving…</span> : null}
          {dirty && !saving ? <span className="text-xs text-ink-muted">Unsaved</span> : null}
          {error ? <span className="text-xs text-status-critical">{error}</span> : null}
        </div>
      </td>
    </tr>
  );
}
