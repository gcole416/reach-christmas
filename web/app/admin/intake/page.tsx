"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import type { ReferralType } from "@/lib/store";
import { getSchoolsForDrive } from "@/lib/queries";
import { TextAreaField } from "@/components/TextAreaField";
import { ChildFormFields, emptyChild, type ChildFormState } from "@/components/ChildFormFields";
import { AdminPageHeader } from "../AdminPageHeader";

export default function IntakePage() {
  const { data, addFamily } = useData();
  const [referralChoice, setReferralChoice] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [children, setChildren] = useState<ChildFormState[]>(() => [emptyChild()]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!data) return null;

  const schools = getSchoolsForDrive(data);
  const referralType: ReferralType | null =
    referralChoice === ""
      ? null
      : referralChoice === "__direct"
        ? "direct"
        : referralChoice === "__confidential"
          ? "confidential"
          : "school";
  const driveSchoolId = referralType === "school" ? referralChoice : null;

  function updateChild(key: string, patch: Partial<ChildFormState>) {
    setChildren((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function addChildBlock() {
    setChildren((prev) => [...prev, emptyChild()]);
  }

  function removeChildBlock(key: string) {
    setChildren((prev) => (prev.length > 1 ? prev.filter((c) => c.key !== key) : prev));
  }

  function updateWishlistItem(key: string, idx: number, value: string) {
    setChildren((prev) =>
      prev.map((c) =>
        c.key === key ? { ...c, wishlistItems: c.wishlistItems.map((w, i) => (i === idx ? value : w)) } : c
      )
    );
  }

  function addWishlistItem(key: string) {
    setChildren((prev) => prev.map((c) => (c.key === key ? { ...c, wishlistItems: [...c.wishlistItems, ""] } : c)));
  }

  function removeWishlistItem(key: string, idx: number) {
    setChildren((prev) =>
      prev.map((c) => (c.key === key ? { ...c, wishlistItems: c.wishlistItems.filter((_, i) => i !== idx) } : c))
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!referralType) {
      setError("Choose a referral source.");
      return;
    }

    setSubmitting(true);
    const result = await addFamily({
      referralType,
      driveSchoolId,
      internalNotes,
      children,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const savedChildren = children.filter((c) => c.firstName.trim());
    const savedChildCount = savedChildren.length;
    const highSchoolerCount = savedChildren.filter((c) => c.isHighSchooler).length;
    // Matches getHouseholdTag / the card-number prefix: the school's code, or
    // "Z" for a direct referral or confidential household with no school.
    const schoolCode =
      referralType === "school"
        ? (schools.find((s) => s.driveSchoolId === driveSchoolId)?.code ?? "Z")
        : "Z";
    setSuccessMessage(
      `Saved as Household ${schoolCode}${result.familyNumber} with ${savedChildCount} ${savedChildCount === 1 ? "child" : "children"}` +
        (highSchoolerCount > 0
          ? ` (${highSchoolerCount} high schooler${highSchoolerCount === 1 ? "" : "s"}, tracked on the High schoolers page).`
          : ".")
    );
    setInternalNotes("");
    setChildren([emptyChild()]);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <AdminPageHeader
        title="Add a household"
        description={
          <>
            Enter a referral into {data.drive.name}. This replaces a row (or several) in the old
            spreadsheet, and each child gets a claimable card on the sponsor page as soon as you save.
          </>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold text-ink-primary">Household</h2>
          <div className="mt-3">
            <label className="block text-sm sm:max-w-xs">
              <span className="text-ink-secondary">Referral source</span>
              <select
                value={referralChoice}
                onChange={(e) => setReferralChoice(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink-primary focus:outline-none focus:ring-2 focus:ring-cat-blue"
              >
                <option value="" disabled>
                  Select…
                </option>
                {schools.length > 0 ? (
                  <optgroup label="Partner schools">
                    {schools.map((s) => (
                      <option key={s.driveSchoolId} value={s.driveSchoolId}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <option value="__direct">Direct referral (no school)</option>
                <option value="__confidential">Confidential</option>
              </select>
            </label>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            The household number is assigned automatically once you save. It shows up here and on
            every card and tag, but isn&apos;t something you pick.
          </p>

          {referralType === "confidential" ? (
            <div className="mt-3 rounded-lg bg-status-serious/10 px-3 py-2 text-sm text-ink-primary">
              Confidential households are hidden from volunteers without clearance. Use this only when the
              referral needs that extra privacy.
            </div>
          ) : null}

          <div className="mt-3">
            <TextAreaField
              label="Internal notes (optional, staff only)"
              value={internalNotes}
              onChange={setInternalNotes}
            />
          </div>
        </div>

        <div className="space-y-4">
          {children.map((child, idx) => (
            <ChildFormFields
              key={child.key}
              child={child}
              index={idx}
              canRemove={children.length > 1}
              onChange={(patch) => updateChild(child.key, patch)}
              onRemove={() => removeChildBlock(child.key)}
              onWishlistChange={(wIdx, value) => updateWishlistItem(child.key, wIdx, value)}
              onAddWishlistItem={() => addWishlistItem(child.key)}
              onRemoveWishlistItem={(wIdx) => removeWishlistItem(child.key, wIdx)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={addChildBlock}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary"
        >
          + Add another child
        </button>

        {error ? (
          <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
        ) : null}
        {successMessage ? (
          <div className="flex items-center justify-between rounded-lg bg-status-good/10 px-3 py-2 text-sm text-ink-primary">
            <span>{successMessage}</span>
            <Link href="/admin" className="font-medium text-cat-blue hover:opacity-80">
              View in dashboard →
            </Link>
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-cat-blue px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save household"}
          </button>
        </div>
      </form>
    </div>
  );
}
