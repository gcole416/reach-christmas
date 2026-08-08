"use client";

import { use, useState, type FormEvent } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { FormField } from "@/components/FormField";
import { TextAreaField } from "@/components/TextAreaField";
import { ChildFormFields, emptyChild, type ChildFormState } from "@/components/ChildFormFields";
import type { DataBundle } from "@/lib/types";
import { AdminNav } from "../../AdminNav";

function seedChildren(data: DataBundle, familyId: string): ChildFormState[] {
  const familyChildren = data.children
    .filter((c) => c.familyId === familyId)
    .sort((a, b) => a.childIndex - b.childIndex);

  const seeded: ChildFormState[] = familyChildren.map((c) => {
    const wishlist = data.wishlistItems
      .filter((w) => w.childId === c.id)
      .sort((a, b) => a.position - b.position)
      .map((w) => w.description);
    return {
      key: c.id,
      id: c.id,
      firstName: c.firstName,
      grade: c.grade ?? "",
      age: c.age !== null ? String(c.age) : "",
      sex: c.sex ?? "",
      specificNeeds: c.specificNeeds ?? "",
      pantSize: c.pantSize ?? "",
      shirtSize: c.shirtSize ?? "",
      shoeSize: c.shoeSize ?? "",
      otherNotes: c.otherNotes ?? "",
      targetCardCount: String(c.targetCardCount),
      wishlistItems: wishlist.length > 0 ? wishlist : ["", "", ""],
    };
  });

  return seeded.length > 0 ? seeded : [emptyChild()];
}

export default function FamilyEditPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params);
  const [saveVersion, setSaveVersion] = useState(0);

  return <FamilyEditForm key={`${familyId}-${saveVersion}`} familyId={familyId} onSaved={() => setSaveVersion((v) => v + 1)} />;
}

function FamilyEditForm({ familyId, onSaved }: { familyId: string; onSaved: () => void }) {
  const { data, saveFamilyEdit } = useData();

  const family = data?.families.find((f) => f.id === familyId) ?? null;
  const [sortTag, setSortTag] = useState(() => family?.sortTag ?? "");
  const [internalNotes, setInternalNotes] = useState(() => family?.internalNotes ?? "");
  const [children, setChildren] = useState<ChildFormState[]>(() => (data ? seedChildren(data, familyId) : [emptyChild()]));
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!data) return null;

  if (!family) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <AdminNav />
        <p className="text-ink-secondary">
          Family not found — either it doesn&apos;t exist, or it&apos;s confidential and you don&apos;t
          have clearance to view it.
        </p>
      </div>
    );
  }

  const driveSchool = family.driveSchoolId ? data.driveSchools.find((ds) => ds.id === family.driveSchoolId) : null;
  const school = driveSchool ? data.schools.find((s) => s.id === driveSchool.schoolId) : null;
  const referralLabel = family.isConfidential
    ? "Confidential"
    : (school?.name ?? "Direct referral (no school)");

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
    setSubmitting(true);
    const result = await saveFamilyEdit(familyId, { sortTag, internalNotes }, children);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccessMessage("Saved.");
    onSaved();
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-ink-primary">
        Family {family.familyNumber}
        {family.isConfidential ? (
          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-status-serious/15 px-2.5 py-1 align-middle text-xs font-medium text-ink-primary">
            Confidential
          </span>
        ) : null}
      </h1>
      <p className="mt-2 text-ink-secondary">
        Referred by: {referralLabel}. Referral source and family number can&apos;t be changed here — that
        affects card numbering, so it&apos;s a SQL-editor-only edit if it&apos;s ever genuinely wrong.
      </p>

      <AdminNav />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold text-ink-primary">Family details</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              label="Sort tag"
              value={sortTag}
              onChange={setSortTag}
              placeholder="e.g. wrapping color"
            />
          </div>
          <div className="mt-3">
            <TextAreaField
              label="Internal notes (staff only)"
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
        <p className="text-xs text-ink-muted">
          Raising a child&apos;s sponsor slots here generates the new card(s) immediately. Lowering it is a
          no-op — a card that might already be claimed is never auto-removed; that stays a deliberate,
          separate decision.
        </p>

        {error ? (
          <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
        ) : null}
        {successMessage ? (
          <div className="flex items-center justify-between rounded-lg bg-status-good/10 px-3 py-2 text-sm text-ink-primary">
            <span>{successMessage}</span>
            <Link href="/admin" className="font-medium text-cat-blue hover:opacity-80">
              Back to dashboard →
            </Link>
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-cat-blue px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <p className="mt-6 text-xs text-ink-muted">
        There&apos;s no way to delete a family or a child from here — that&apos;s a rare, higher-stakes
        action better done deliberately via the SQL editor for now.
      </p>
    </div>
  );
}
