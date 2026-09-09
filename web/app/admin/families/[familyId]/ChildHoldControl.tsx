"use client";

import { useState } from "react";
import { useData } from "@/lib/store";

// US-38: the per-child "on hold" control on the household edit page. Admin-only
// for the actions (the real gate is set_child_hold() / release_child_hold(),
// which raise for non-admins — we surface that message if it comes back).
// Non-admins still see the flagged state, read-only.
//
// This reads the live child row from the bundle rather than the edit form's
// draft state: hold status isn't a form field, and the store refreshes the
// bundle after a hold/release. The parent triggers a reseed via onChanged so
// the form picks up the child row's new updated_at baseline (the hold write
// bumps it, same as any other write to the row).
export function ChildHoldControl({
  childId,
  onChanged,
}: {
  childId: string;
  onChanged: () => void;
}) {
  const { data, viewerRole, setChildHold, releaseChildHold } = useData();
  const isAdmin = viewerRole === "admin";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [reason, setReason] = useState("");

  const child = data?.children.find((c) => c.id === childId) ?? null;
  const held = child?.heldAt != null;
  const placedBy =
    child?.heldBy != null
      ? data?.profiles.find((p) => p.id === child.heldBy)?.fullName ?? null
      : null;

  async function handleHold() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Add a short reason so the next person knows why this child is on hold.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await setChildHold(childId, trimmed);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setComposing(false);
    setReason("");
    onChanged();
  }

  async function handleRelease() {
    setBusy(true);
    setError(null);
    const result = await releaseChildHold(childId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  if (held) {
    return (
      <div className="mt-3 rounded-lg border border-status-serious/40 bg-status-serious/10 p-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-status-serious/15 px-2.5 py-1 text-xs font-medium text-ink-primary">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-serious" aria-hidden="true" />
          On hold for duplicate review
        </span>
        {child?.holdReason ? (
          <p className="mt-2 text-sm text-ink-secondary">{child.holdReason}</p>
        ) : null}
        {placedBy ? <p className="mt-1 text-xs text-ink-muted">Placed by {placedBy}</p> : null}
        <p className="mt-2 text-xs text-ink-muted">
          This child&apos;s card is out of the sponsor pool, the print run, and every count until the
          hold is released. Nothing has been deleted.
        </p>
        {error ? <p className="mt-2 text-xs text-status-critical">{error}</p> : null}
        {isAdmin ? (
          <button
            type="button"
            onClick={handleRelease}
            disabled={busy}
            className="mt-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-primary hover:border-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-blue disabled:opacity-50"
          >
            {busy ? "Releasing…" : "Release hold"}
          </button>
        ) : null}
      </div>
    );
  }

  if (!isAdmin) return null;

  if (!composing) {
    return (
      <button
        type="button"
        onClick={() => {
          setComposing(true);
          setError(null);
        }}
        className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-blue"
      >
        Put this child on hold
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <label
        htmlFor={`hold-reason-${childId}`}
        className="block text-xs font-medium text-ink-secondary"
      >
        Why is this child on hold? For example: duplicate of another household, waiting on counselor
        confirmation.
      </label>
      <textarea
        id={`hold-reason-${childId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-cat-blue"
      />
      {error ? <p className="mt-2 text-xs text-status-critical">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={handleHold}
          disabled={busy}
          className="rounded-lg bg-cat-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-blue disabled:opacity-50"
        >
          {busy ? "Saving…" : "Put on hold"}
        </button>
        <button
          type="button"
          onClick={() => {
            setComposing(false);
            setReason("");
            setError(null);
          }}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-blue"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
