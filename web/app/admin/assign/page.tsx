"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import {
  buildAssignWorkspace,
  gradeRank,
  sortRosterByRoom,
  suggestMatches,
  type MatchDraft,
  type RosterEntry,
  type WaitingChild,
  type WaitingHousehold,
} from "@/lib/assignWorkspace";
import { SearchInput } from "@/components/SearchInput";
import { AdminPageHeader } from "../AdminPageHeader";
import { DraftReview } from "./DraftReview";

// US-62: sponsor-first matching. Pick a roster entry with room on the left,
// click children (or a whole household) on the right; each click is one
// assignment through assign_card_to_sponsor_family, no popup. Built for
// ~200 children and ~150 roster entries (Grant, 2026-10-20). Capacity warns,
// never blocks (US-57). "Suggest matches" drafts a whole pass for review;
// nothing is written until staff save it.

const SEX_LABEL: Record<string, string> = { M: "Boy", F: "Girl" };

function childLine(c: WaitingChild): string {
  return [
    c.grade ? (/^\d+$/.test(c.grade) ? `Grade ${c.grade}` : c.grade) : null,
    c.age != null ? `age ${c.age}` : null,
    c.sex ? SEX_LABEL[c.sex] ?? c.sex : null,
    c.shirtSize ? `shirt ${c.shirtSize}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function names(list: string[]): string {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function RoomDots({ entry }: { entry: RosterEntry }) {
  const capacity = entry.capacity;
  if (capacity == null) return null;
  const total = Math.max(capacity, entry.assignedCount);
  if (total > 8) return null;
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${
            i < entry.assignedCount
              ? i >= capacity
                ? "bg-status-warning"
                : "bg-cat-blue"
              : "border border-ink-muted/50"
          }`}
        />
      ))}
    </span>
  );
}

function roomLabel(entry: RosterEntry): string {
  if (entry.capacity == null) return `${entry.assignedCount} taken · no limit set`;
  if (entry.open! < 0) return `${entry.assignedCount} of ${entry.capacity} · ${-entry.open!} over`;
  if (entry.open === 0) return `${entry.assignedCount} of ${entry.capacity} · full`;
  return `${entry.assignedCount} of ${entry.capacity} · ${entry.open} open`;
}

interface LastAction {
  message: string;
  assignmentIds: string[];
}

export default function AssignSponsorsPage() {
  const { data, assignCardToSponsorFamily, cancelAssignment, refresh } = useData();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sponsorSearch, setSponsorSearch] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [childSearch, setChildSearch] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [sexFilter, setSexFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [busyCardIds, setBusyCardIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [draft, setDraft] = useState<MatchDraft | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workspace = useMemo(() => (data ? buildAssignWorkspace(data) : null), [data]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  if (!data || !workspace) return null;
  const { households, roster, summary } = workspace;

  const sorted = sortRosterByRoom(roster);
  const sq = sponsorSearch.trim().toLowerCase();
  const matchesSponsorSearch = (r: RosterEntry) =>
    !sq || [r.displayName, r.contactEmail ?? "", r.notes ?? ""].join(" ").toLowerCase().includes(sq);
  const withRoom = sorted.filter((r) => (r.open == null || r.open > 0) && matchesSponsorSearch(r));
  const full = sorted.filter((r) => r.open != null && r.open <= 0 && matchesSponsorSearch(r));
  const selected = roster.find((r) => r.id === selectedId) ?? null;
  const nextWithRoom = sorted.find((r) => r.id !== selectedId && (r.open == null || r.open > 0)) ?? null;

  // Child-side filters. A household shows if ANY of its waiting children match;
  // non-matching siblings stay visible (dimmed) so the family reads as a unit.
  const cq = childSearch.trim().toLowerCase();
  const childMatches = (hh: WaitingHousehold, c: WaitingChild) =>
    (schoolFilter === "all" || hh.driveSchoolId === schoolFilter) &&
    (sexFilter === "all" || c.sex === sexFilter) &&
    (gradeFilter === "all" || c.grade === gradeFilter) &&
    (!cq || [c.firstName, c.cardNumber, hh.householdTag, hh.schoolName ?? ""].join(" ").toLowerCase().includes(cq));
  const visibleHouseholds = households.filter((hh) => hh.children.some((c) => childMatches(hh, c)));
  const visibleChildCount = visibleHouseholds.reduce(
    (n, hh) => n + hh.children.filter((c) => childMatches(hh, c)).length,
    0,
  );

  const schoolOptions = [...new Map(households.map((hh) => [hh.driveSchoolId ?? "", hh.schoolName])).entries()]
    .filter(([id]) => id)
    .sort((a, b) => (a[1] ?? "").localeCompare(b[1] ?? ""));
  const gradeOptions = [...new Set(households.flatMap((hh) => hh.children.map((c) => c.grade ?? "")))]
    .filter(Boolean)
    .sort((a, b) => gradeRank(a) - gradeRank(b));

  function showToast(action: LastAction) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setLastAction(action);
    toastTimer.current = setTimeout(() => setLastAction(null), 10_000);
  }

  async function assign(children: WaitingChild[]) {
    if (!selected || children.length === 0) return;
    setError(null);
    setBusyCardIds(new Set(children.map((c) => c.cardId)));
    const done: { name: string; assignmentId: string }[] = [];
    const failed: string[] = [];
    for (const c of children) {
      const res = await assignCardToSponsorFamily(c.cardId, selected.id, { refresh: false });
      if (res.ok) done.push({ name: c.firstName, assignmentId: res.assignmentId });
      else failed.push(`${c.firstName}: ${res.error}`);
    }
    await refresh();
    setBusyCardIds(new Set());
    if (done.length > 0) {
      showToast({
        message: `${names(done.map((d) => d.name))} → ${selected.displayName}`,
        assignmentIds: done.map((d) => d.assignmentId),
      });
    }
    if (failed.length > 0) setError(`Not assigned: ${failed.join("; ")}`);
  }

  async function undo() {
    if (!lastAction) return;
    setUndoing(true);
    const failed: string[] = [];
    for (const id of lastAction.assignmentIds) {
      const res = await cancelAssignment(id, { refresh: false });
      if (!res.ok) failed.push(res.error);
    }
    await refresh();
    setUndoing(false);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setLastAction(null);
    if (failed.length > 0) setError(`Undo didn't fully work: ${failed.join("; ")}`);
  }

  if (draft) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <DraftReview
          draft={draft}
          roster={roster}
          onChange={setDraft}
          onClose={() => setDraft(null)}
        />
      </div>
    );
  }

  const pct = summary.poolTotal > 0 ? Math.round((summary.assigned / summary.poolTotal) * 100) : 0;
  const short = summary.waiting - summary.openSlots;

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <AdminPageHeader
        title="Assign sponsors"
        description="Pick a sponsor with room on the left, then click children on the right. Each click saves right away, with Undo. Brothers and sisters are grouped so a household can go to one sponsor together."
        action={
          <button
            type="button"
            onClick={() => setDraft(suggestMatches(households, roster))}
            disabled={summary.waiting === 0 || roster.length === 0}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary disabled:opacity-50"
          >
            Suggest matches…
          </button>
        }
      />

      {/* Supply and demand */}
      <div className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
          <p className="text-ink-primary">
            <span className="text-lg font-semibold">{summary.assigned}</span> of {summary.poolTotal} children
            have a sponsor · <span className="font-medium">{summary.waiting} waiting</span>
          </p>
          <p className={short > 0 ? "font-medium text-status-warning" : "text-ink-secondary"}>
            {summary.openSlots} open sponsor {summary.openSlots === 1 ? "spot" : "spots"}
            {short > 0 ? ` · ${short} more needed` : ""}
            {summary.noCapacityCount > 0 ? ` · ${summary.noCapacityCount} with no limit set` : ""}
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-muted/15">
          <div className="h-full rounded-full bg-cat-blue" style={{ width: `${pct}%` }} />
        </div>
        {summary.confidentialWaiting > 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            {summary.confidentialWaiting} confidential {summary.confidentialWaiting === 1 ? "child isn't" : "children aren't"}{" "}
            listed here; confidential households are matched separately.
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        {/* ---------------- Sponsors ---------------- */}
        <section aria-label="Sponsors" className="min-w-0">
          <SearchInput value={sponsorSearch} onChange={setSponsorSearch} placeholder="Search sponsors or notes…" />
          <div className="mt-3 max-h-[24rem] space-y-1.5 overflow-y-auto pr-1 lg:max-h-[calc(100vh-14rem)]">
            {roster.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-ink-secondary">
                No sponsors on the roster yet. Import them on the{" "}
                <Link href="/admin/sponsors" className="font-medium text-cat-blue hover:underline">
                  Sponsor roster
                </Link>{" "}
                page.
              </p>
            ) : null}
            {withRoom.map((r) => (
              <SponsorRow key={r.id} entry={r} selected={r.id === selectedId} onSelect={() => setSelectedId(r.id)} />
            ))}
            {full.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowFull((v) => !v)}
                  className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-ink-muted hover:text-ink-primary"
                  aria-expanded={showFull}
                >
                  {showFull ? "▾" : "▸"} Full ({full.length})
                </button>
                {showFull
                  ? full.map((r) => (
                      <SponsorRow key={r.id} entry={r} selected={r.id === selectedId} onSelect={() => setSelectedId(r.id)} />
                    ))
                  : null}
              </>
            ) : null}
          </div>
        </section>

        {/* ---------------- Children ---------------- */}
        <section aria-label="Children waiting for a sponsor" className="min-w-0">
          <div className="sticky top-0 z-10 -mx-1 mb-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink-secondary">
                    Assigning to{" "}
                    <span className="font-semibold text-ink-primary">{selected.displayName}</span>
                  </p>
                  <span
                    className={`flex items-center gap-2 text-xs ${
                      selected.open != null && selected.open <= 0 ? "font-medium text-status-warning" : "text-ink-muted"
                    }`}
                  >
                    <RoomDots entry={selected} />
                    {roomLabel(selected)}
                  </span>
                </div>
                {selected.notes ? (
                  <p className="mt-1 rounded-md bg-cat-yellow/10 px-2 py-1 text-xs text-ink-primary">
                    Note: {selected.notes}
                  </p>
                ) : null}
                {selected.assignedChildren.length > 0 ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    Has: {selected.assignedChildren.map((c) => `${c.firstName} (${c.cardNumber})`).join(", ")}
                  </p>
                ) : null}
                {selected.open != null && selected.open <= 0 && nextWithRoom ? (
                  <p className="mt-2 text-xs text-ink-secondary">
                    {selected.displayName} is full.{" "}
                    <button
                      type="button"
                      onClick={() => setSelectedId(nextWithRoom.id)}
                      className="font-medium text-cat-blue hover:underline"
                    >
                      Next with room: {nextWithRoom.displayName} →
                    </button>
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-ink-secondary">
                Pick a sponsor on the left to start assigning.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={childSearch} onChange={setChildSearch} placeholder="Child, card, or household…" />
            <select
              value={schoolFilter}
              onChange={(e) => setSchoolFilter(e.target.value)}
              aria-label="School"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary"
            >
              <option value="all">All schools</option>
              {schoolOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={sexFilter}
              onChange={(e) => setSexFilter(e.target.value)}
              aria-label="Boy or girl"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary"
            >
              <option value="all">Boys and girls</option>
              <option value="F">Girls</option>
              <option value="M">Boys</option>
            </select>
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              aria-label="Grade"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary"
            >
              <option value="all">All grades</option>
              {gradeOptions.map((g) => (
                <option key={g} value={g}>
                  {/^\d+$/.test(g) ? `Grade ${g}` : g}
                </option>
              ))}
            </select>
            <p className="ml-auto text-sm text-ink-muted">
              {visibleChildCount} of {summary.waiting} waiting
            </p>
          </div>

          {error ? (
            <div role="alert" className="mt-3 rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">
              {error}
            </div>
          ) : null}

          {summary.waiting === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border p-10 text-center text-ink-secondary">
              Every child in the sponsor pool has a sponsor. Next step: send the cards from the{" "}
              <Link href="/admin/sponsors" className="font-medium text-cat-blue hover:underline">
                Sponsor roster
              </Link>{" "}
              (&ldquo;Email all assigned&rdquo;).
            </div>
          ) : visibleHouseholds.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border p-10 text-center text-ink-secondary">
              No waiting children match these filters.
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {visibleHouseholds.map((hh) => (
                <HouseholdRow
                  key={hh.familyId}
                  household={hh}
                  selected={selected}
                  busyCardIds={busyCardIds}
                  matches={(c) => childMatches(hh, c)}
                  onAssign={assign}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {lastAction ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-4 rounded-xl bg-ink-primary px-4 py-3 text-sm text-surface shadow-lg"
        >
          <span className="min-w-0 truncate">✓ {lastAction.message}</span>
          <button
            type="button"
            onClick={undo}
            disabled={undoing}
            className="shrink-0 font-semibold text-cat-blue hover:underline disabled:opacity-60"
          >
            {undoing ? "Undoing…" : "Undo"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SponsorRow({ entry, selected, onSelect }: { entry: RosterEntry; selected: boolean; onSelect: () => void }) {
  const fullOrOver = entry.open != null && entry.open <= 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue ${
        selected ? "border-cat-blue bg-cat-blue/10" : "border-border bg-surface hover:border-cat-blue"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink-primary">{entry.displayName}</span>
        <RoomDots entry={entry} />
      </div>
      <p className={`mt-0.5 text-xs ${fullOrOver ? "text-status-warning" : "text-ink-muted"}`}>{roomLabel(entry)}</p>
      {entry.notes ? <p className="mt-0.5 truncate text-xs italic text-ink-secondary">“{entry.notes}”</p> : null}
    </button>
  );
}

function HouseholdRow({
  household,
  selected,
  busyCardIds,
  matches,
  onAssign,
}: {
  household: WaitingHousehold;
  selected: RosterEntry | null;
  busyCardIds: Set<string>;
  matches: (c: WaitingChild) => boolean;
  onAssign: (children: WaitingChild[]) => void;
}) {
  const busy = household.children.some((c) => busyCardIds.has(c.cardId));
  const n = household.children.length;
  const open = selected?.open ?? null;
  const overBy = open == null ? 0 : n - Math.max(0, open);
  const singleOver = open != null && open <= 0;

  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-secondary">
          <span className="font-medium text-ink-primary">Household {household.householdTag}</span>
          {household.schoolName ? ` · ${household.schoolName}` : ""}
        </p>
        {n > 1 ? (
          <button
            type="button"
            onClick={() => onAssign(household.children)}
            disabled={!selected || busy}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
              overBy > 0
                ? "border border-status-warning text-ink-primary hover:bg-status-warning/10"
                : "bg-cat-blue text-white hover:opacity-90"
            }`}
          >
            {busy ? "Assigning…" : `Assign all ${n}${overBy > 0 ? ` (${overBy} over)` : ""}`}
          </button>
        ) : null}
      </div>
      {household.assignedSiblings.length > 0 ? (
        <p className="mt-1 text-xs text-ink-muted">
          {household.assignedSiblings
            .map((s) => `${s.firstName} already with ${s.sponsorFamilyName ?? "a sponsor"}`)
            .join(" · ")}
        </p>
      ) : null}
      <ul className="mt-2 divide-y divide-border">
        {household.children.map((c) => (
          <li
            key={c.cardId}
            className={`flex flex-wrap items-center justify-between gap-2 py-1.5 ${matches(c) ? "" : "opacity-50"}`}
          >
            <div className="min-w-0">
              <span className="text-sm font-medium text-ink-primary">{c.firstName}</span>{" "}
              <span className="text-xs text-ink-muted">({c.cardNumber})</span>
              <p className="text-xs text-ink-secondary">{childLine(c)}</p>
            </div>
            <button
              type="button"
              onClick={() => onAssign([c])}
              disabled={!selected || busy}
              title={selected ? undefined : "Pick a sponsor first"}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
                singleOver
                  ? "border border-status-warning text-ink-primary hover:bg-status-warning/10"
                  : n > 1
                    ? "border border-border text-ink-secondary hover:border-cat-blue hover:text-ink-primary"
                    : "bg-cat-blue text-white hover:opacity-90"
              }`}
            >
              {busyCardIds.has(c.cardId) ? "Assigning…" : singleOver ? "Assign (over)" : "Assign"}
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}
