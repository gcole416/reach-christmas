"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import {
  displayFirstName,
  getHighSchoolers,
  getSchoolsForDrive,
  NEXT_SHOP_DAY_STATUS,
  SHOP_DAY_STATUS_LABELS,
  SHOP_DAY_STATUS_ORDER,
  type HighSchoolerRow,
} from "@/lib/queries";
import type { ShopDayStatus } from "@/lib/types";
import { SearchInput } from "@/components/SearchInput";
import { AdminPageHeader } from "../AdminPageHeader";

// US-35: the self-shopping high schooler roster + shop-day board. Grades 9-12
// don't get a sponsor - they're invited to a store shopping day - so they need
// their own place to be counted, organised by school, and worked through the
// invited -> confirmed -> attended pipeline as the date approaches.
//
// Two views on the same data:
//   Roster - one row per teen, contact info, inline status + notes, CSV copy
//   Board  - columns per shop-day stage, "Mark [next]" to advance (mirrors
//            /admin/fulfillment). No-shows are handled offline (Grant,
//            2026-09-08); the board just shows who didn't reach "Attended".

const COLUMN_DOT: Record<ShopDayStatus, string> = {
  not_contacted: "bg-ink-muted",
  invited: "bg-cat-blue",
  confirmed: "bg-cat-violet",
  attended: "bg-status-good",
};

type View = "roster" | "board";

export default function HighSchoolersPage() {
  const { data, viewerRole } = useData();
  const [view, setView] = useState<View>("roster");
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  const isAdmin = viewerRole === "admin";

  const roster = useMemo(() => (data ? getHighSchoolers(data) : []), [data]);
  const schools = useMemo(() => (data ? getSchoolsForDrive(data) : []), [data]);

  if (!data) return null;

  const q = search.trim().toLowerCase();

  function matchesSchoolAndSearch(row: HighSchoolerRow): boolean {
    const schoolMatches =
      schoolFilter === "all"
        ? true
        : schoolFilter === "confidential"
          ? row.isConfidential
          : schoolFilter === "direct"
            ? !row.isConfidential && row.driveSchoolId === null
            : row.driveSchoolId === schoolFilter;
    const name = displayFirstName(row.firstName, row.isConfidential, isAdmin);
    const searchMatches =
      !q ||
      [name, row.householdTag, row.schoolName ?? "", row.grade ?? "", row.guardianName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return schoolMatches && searchMatches;
  }

  const scoped = roster.filter(matchesSchoolAndSearch);
  const rosterRows = scoped.filter(
    (row) => statusFilter === "all" || row.shopDayStatus === statusFilter,
  );

  const counts = SHOP_DAY_STATUS_ORDER.map((s) => ({
    status: s,
    n: roster.filter((r) => r.shopDayStatus === s).length,
  }));

  async function copyRoster() {
    const header = [
      "First name",
      "Household",
      "School",
      "Grade",
      "Age",
      "Guardian",
      "Phone",
      "Shop-day status",
    ];
    const lines = rosterRows.map((row) =>
      [
        displayFirstName(row.firstName, row.isConfidential, isAdmin),
        row.householdTag,
        row.isConfidential ? "Confidential" : row.schoolName ?? "Direct referral",
        row.grade ?? "",
        row.age ?? "",
        row.guardianName ?? "",
        row.guardianPhone ?? "",
        SHOP_DAY_STATUS_LABELS[row.shopDayStatus],
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
    <div className="mx-auto max-w-7xl px-6 py-10">
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
          view === "roster" ? (
            <button
              onClick={copyRoster}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary"
            >
              {copied ? "Copied" : "Copy roster (CSV)"}
            </button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map(({ status, n }) => (
          <button
            key={status}
            onClick={() => {
              setView("roster");
              setStatusFilter((prev) => (prev === status ? "all" : status));
            }}
            className={`rounded-xl border px-4 py-3 text-left ${
              view === "roster" && statusFilter === status
                ? "border-cat-blue bg-cat-blue/5"
                : "border-border"
            }`}
          >
            <div className="text-2xl font-semibold text-ink-primary">{n}</div>
            <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <span className={`h-2 w-2 rounded-full ${COLUMN_DOT[status]}`} aria-hidden="true" />
              {SHOP_DAY_STATUS_LABELS[status]}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg border border-border p-0.5 text-sm">
          {(["roster", "board"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 font-medium capitalize ${
                view === v ? "bg-cat-blue text-white" : "text-ink-secondary hover:text-ink-primary"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
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
        {view === "roster" ? (
          <label className="text-sm">
            <span className="mb-1 block text-ink-secondary">Shop-day status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary"
            >
              <option value="all">All</option>
              {SHOP_DAY_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SHOP_DAY_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="ml-auto text-sm text-ink-muted">
          {view === "roster" ? rosterRows.length : scoped.length} of {roster.length}
        </p>
      </div>

      {view === "roster" ? (
        <RosterTable rows={rosterRows} isAdmin={isAdmin} totalRegistered={roster.length} />
      ) : (
        <ShopDayBoard rows={scoped} isAdmin={isAdmin} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RosterTable({
  rows,
  isAdmin,
  totalRegistered,
}: {
  rows: HighSchoolerRow[];
  isAdmin: boolean;
  totalRegistered: number;
}) {
  return (
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
          {rows.map((row) => (
            <TrackingRow key={row.childId} row={row} isAdmin={isAdmin} />
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-ink-secondary">
                {totalRegistered === 0
                  ? "No high schoolers registered yet."
                  : "No high schoolers match this view."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
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
            {SHOP_DAY_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {SHOP_DAY_STATUS_LABELS[s]}
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

// ---------------------------------------------------------------------------

function ShopDayBoard({ rows, isAdmin }: { rows: HighSchoolerRow[]; isAdmin: boolean }) {
  return (
    <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
      {SHOP_DAY_STATUS_ORDER.map((col) => {
        const inColumn = rows.filter((r) => r.shopDayStatus === col);
        return (
          <div key={col} className="w-72 shrink-0">
            <div className="flex w-full items-center justify-between rounded-t-lg border border-b-0 border-border bg-ink-muted/5 px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
                <span className={`h-2 w-2 shrink-0 rounded-full ${COLUMN_DOT[col]}`} aria-hidden="true" />
                {SHOP_DAY_STATUS_LABELS[col]}
              </span>
              <span className="rounded-full bg-ink-muted/15 px-2 py-0.5 text-xs font-medium text-ink-secondary">
                {inColumn.length}
              </span>
            </div>
            <div className="min-h-[100px] space-y-2 rounded-b-lg border border-border bg-ink-muted/[0.02] p-2">
              {inColumn.length === 0 ? (
                <p className="p-3 text-center text-xs text-ink-muted">Nobody here.</p>
              ) : (
                inColumn.map((row) => <BoardCard key={row.childId} row={row} isAdmin={isAdmin} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({ row, isAdmin }: { row: HighSchoolerRow; isAdmin: boolean }) {
  const { setShopDayTracking } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = NEXT_SHOP_DAY_STATUS[row.shopDayStatus];
  const prevIndex = SHOP_DAY_STATUS_ORDER.indexOf(row.shopDayStatus) - 1;
  const prev = prevIndex >= 0 ? SHOP_DAY_STATUS_ORDER[prevIndex] : undefined;

  async function move(to: ShopDayStatus) {
    setBusy(true);
    setError(null);
    const result = await setShopDayTracking(row.childId, { status: to, notes: row.shopDayNotes ?? "" });
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="font-medium text-ink-primary">
        {displayFirstName(row.firstName, row.isConfidential, isAdmin)}{" "}
        <Link
          href={`/admin/families/${row.familyId}`}
          className="font-normal text-cat-blue hover:underline"
        >
          ({row.householdTag})
        </Link>
      </div>
      <p className="mt-1 text-xs text-ink-secondary">
        {row.isConfidential ? "Confidential" : row.schoolName ?? "Direct referral"}
        {row.grade ? ` · grade ${row.grade}` : ""}
      </p>
      {row.guardianName || row.guardianPhone ? (
        <p className="mt-0.5 text-xs text-ink-muted">
          {row.guardianName ?? ""}
          {row.guardianName && row.guardianPhone ? " · " : ""}
          {row.guardianPhone ?? ""}
        </p>
      ) : null}
      {row.shopDayNotes ? (
        <p className="mt-1 text-xs italic text-ink-muted">{row.shopDayNotes}</p>
      ) : null}
      <div className="mt-2 flex items-center gap-3">
        {next ? (
          <button
            onClick={() => move(next)}
            disabled={busy}
            className="rounded-lg bg-cat-blue px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : `Mark ${SHOP_DAY_STATUS_LABELS[next].toLowerCase()}`}
          </button>
        ) : null}
        {prev ? (
          <button
            onClick={() => move(prev)}
            disabled={busy}
            className="text-xs font-medium text-ink-secondary hover:text-ink-primary disabled:opacity-50"
          >
            Back
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-xs text-status-critical">{error}</p> : null}
    </div>
  );
}
