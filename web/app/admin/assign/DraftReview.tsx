"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import type { MatchDraft, RosterEntry } from "@/lib/assignWorkspace";

// US-62 "Suggest matches": review a drafted pass before anything is saved.
// The draft keeps households whole and fills sponsors in sign-up order, but
// it can't read the roster's free-text notes, so entries with notes are
// flagged for a human look. Staff remove anything that's wrong, then save;
// each saved line is one assign_card_to_sponsor_family call, same as a click
// on the workspace.

export function DraftReview({
  draft,
  roster,
  onChange,
  onClose,
}: {
  draft: MatchDraft;
  roster: RosterEntry[];
  onChange: (draft: MatchDraft) => void;
  onClose: () => void;
}) {
  const { assignCardToSponsorFamily, refresh } = useData();
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ saved: number; failed: string[] } | null>(null);

  const byId = new Map(roster.map((r) => [r.id, r]));
  const assumed = new Set(draft.assumedCapacityIds);
  const totalChildren = draft.matches.reduce(
    (n, m) => n + m.households.reduce((k, hh) => k + hh.children.length, 0),
    0,
  );

  function removeHousehold(sponsorFamilyId: string, familyId: string) {
    onChange({
      ...draft,
      matches: draft.matches
        .map((m) =>
          m.sponsorFamilyId === sponsorFamilyId
            ? { ...m, households: m.households.filter((hh) => hh.familyId !== familyId) }
            : m,
        )
        .filter((m) => m.households.length > 0),
    });
  }

  async function save() {
    const jobs = draft.matches.flatMap((m) =>
      m.households.flatMap((hh) => hh.children.map((c) => ({ sfId: m.sponsorFamilyId, child: c }))),
    );
    setSaving({ done: 0, total: jobs.length });
    const failed: string[] = [];
    let saved = 0;
    for (const [i, job] of jobs.entries()) {
      const res = await assignCardToSponsorFamily(job.child.cardId, job.sfId, { refresh: false });
      if (res.ok) saved++;
      else failed.push(`${job.child.firstName} (${job.child.cardNumber}): ${res.error}`);
      setSaving({ done: i + 1, total: jobs.length });
    }
    await refresh();
    setSaving(null);
    setResult({ saved, failed });
  }

  if (result) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold text-ink-primary">Suggested matches saved</h1>
        <p className="mt-3 rounded-lg bg-status-good/10 px-4 py-3 text-ink-primary">
          {result.saved} {result.saved === 1 ? "child was" : "children were"} assigned.
        </p>
        {result.failed.length > 0 ? (
          <div className="mt-3 rounded-lg bg-status-critical/10 px-4 py-3 text-sm text-ink-primary">
            <p className="font-medium">{result.failed.length} could not be saved:</p>
            <ul className="mt-1 list-disc pl-5">
              {result.failed.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="mt-6 rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Back to Assign sponsors
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold text-ink-primary">Suggested matches</h1>
          <p className="mt-2 text-ink-secondary">
            A draft: nothing is saved yet. Households are kept together and sponsors are filled in
            sign-up order; a household too big for any one sponsor is split and marked. It can&apos;t read
            sponsor notes, so check the flagged ones, remove anything
            that&apos;s wrong, then save.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving != null}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:text-ink-primary disabled:opacity-50"
          >
            Discard draft
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving != null || totalChildren === 0}
            className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? `Saving ${saving.done} of ${saving.total}…` : `Save ${totalChildren} assignments`}
          </button>
        </div>
      </div>

      {saving ? (
        <div className="mb-6 h-2 overflow-hidden rounded-full bg-ink-muted/15">
          <div
            className="h-full rounded-full bg-cat-blue transition-all"
            style={{ width: `${Math.round((saving.done / Math.max(1, saving.total)) * 100)}%` }}
          />
        </div>
      ) : null}

      {draft.matches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-ink-secondary">
          Nothing in this draft. Every waiting household was removed or nothing fit.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {draft.matches.map((m) => {
            const r = byId.get(m.sponsorFamilyId);
            const adding = m.households.reduce((n, hh) => n + hh.children.length, 0);
            return (
              <li key={m.sponsorFamilyId} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ink-primary">{r?.displayName ?? "Sponsor"}</p>
                  <p className="text-xs text-ink-muted">
                    {r ? `${r.assignedCount} now · +${adding}` : `+${adding}`}
                    {r?.capacity != null ? ` · limit ${r.capacity}` : ""}
                  </p>
                </div>
                {r && assumed.has(r.id) ? (
                  <p className="mt-1 text-xs text-status-warning">No limit set, so the draft gave them 1.</p>
                ) : null}
                {r?.notes ? (
                  <p className="mt-1 rounded-md bg-cat-yellow/10 px-2 py-1 text-xs text-ink-primary">
                    Check the note: &ldquo;{r.notes}&rdquo;
                  </p>
                ) : null}
                <ul className="mt-2 space-y-1.5">
                  {m.households.map((hh) => (
                    <li key={hh.familyId} className="flex items-start justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <span className="text-ink-secondary">Household {hh.householdTag}: </span>
                        <span className="text-ink-primary">
                          {hh.children
                            .map((c) => `${c.firstName} (${[c.grade, c.sex].filter(Boolean).join(", ")})`)
                            .join(", ")}
                        </span>
                        {hh.splitAcross ? (
                          <span className="block text-xs text-status-warning">
                            Household split across {hh.splitAcross} sponsors (too big for one)
                          </span>
                        ) : null}
                        {hh.assignedSiblings.length > 0 ? (
                          <span className="block text-xs text-ink-muted">
                            Keeps them with {hh.assignedSiblings.map((s) => s.firstName).join(", ")}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeHousehold(m.sponsorFamilyId, hh.familyId)}
                        disabled={saving != null}
                        aria-label={`Remove household ${hh.householdTag} from this draft`}
                        className="shrink-0 rounded px-1.5 text-ink-muted hover:bg-status-critical/10 hover:text-status-critical disabled:opacity-40"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {draft.unplaced.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink-primary">Not placed by the draft ({draft.unplaced.length})</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            These stay waiting. Assign them by hand after saving, or add sponsors to the roster.
          </p>
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
            {draft.unplaced.map(({ household, reason }) => (
              <li key={household.familyId} className="flex flex-wrap justify-between gap-2 px-4 py-2 text-sm">
                <span className="text-ink-primary">
                  Household {household.householdTag}: {household.children.map((c) => c.firstName).join(", ")}
                </span>
                <span className="text-xs text-ink-muted">{reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
