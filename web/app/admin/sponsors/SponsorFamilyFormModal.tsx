"use client";

import { useState, type FormEvent } from "react";
import { useData } from "@/lib/store";
import { FormField } from "@/components/FormField";
import { TextAreaField } from "@/components/TextAreaField";
import type { SponsorFamily } from "@/lib/types";

// US-56: one form for both "Add a sponsor" (stragglers after the CSV import)
// and "Edit" (fix a typo, bump capacity) — same fields either way, just a
// different call underneath. `isActive` is deliberately NOT here: that's a
// one-click toggle on the roster row itself, not something bundled into this
// form.
export function SponsorFamilyFormModal({
  sponsorFamily,
  onClose,
}: {
  /** null = add mode; a row = edit mode, pre-filled from it. */
  sponsorFamily: SponsorFamily | null;
  onClose: () => void;
}) {
  const { createSponsorFamily, updateSponsorFamily } = useData();
  const isEdit = sponsorFamily !== null;

  const [displayName, setDisplayName] = useState(sponsorFamily?.displayName ?? "");
  const [contactEmail, setContactEmail] = useState(sponsorFamily?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(sponsorFamily?.contactPhone ?? "");
  const [capacity, setCapacity] = useState(
    sponsorFamily?.capacity != null ? String(sponsorFamily.capacity) : "",
  );
  const [notes, setNotes] = useState(sponsorFamily?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedCapacity = capacity.trim();
    let parsedCapacity: number | undefined;
    if (trimmedCapacity) {
      const n = Number.parseInt(trimmedCapacity, 10);
      if (!Number.isFinite(n) || n < 0 || String(n) !== trimmedCapacity) {
        setError("Capacity must be a whole number (0 or more), or left blank.");
        return;
      }
      parsedCapacity = n;
    }

    setSubmitting(true);
    const result = isEdit
      ? await updateSponsorFamily(sponsorFamily.id, {
          displayName,
          contactEmail: contactEmail.trim() || null,
          contactPhone: contactPhone.trim() || null,
          capacity: parsedCapacity ?? null,
          notes: notes.trim() || null,
        })
      : await createSponsorFamily({
          displayName,
          contactEmail,
          contactPhone,
          capacity: parsedCapacity,
          notes,
        });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-primary">{isEdit ? "Edit sponsor" : "Add a sponsor"}</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          {isEdit
            ? "Update contact info or capacity for this roster entry."
            : "For a sponsor who signed up after the CSV import, or needs adding by hand."}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <FormField label="Name" value={displayName} onChange={setDisplayName} required autoFocus />
          <FormField label="Email (optional)" type="email" value={contactEmail} onChange={setContactEmail} />
          <FormField label="Phone (optional)" type="tel" value={contactPhone} onChange={setContactPhone} />
          <FormField
            label="Capacity (optional)"
            type="number"
            inputMode="numeric"
            value={capacity}
            onChange={setCapacity}
            placeholder="e.g. 2"
          />
          <TextAreaField label="Notes (optional, staff only)" value={notes} onChange={setNotes} />
          {error ? (
            <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-ink-muted/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Add sponsor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
