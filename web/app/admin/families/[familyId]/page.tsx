"use client";

import { use, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { FormField } from "@/components/FormField";
import { TextAreaField } from "@/components/TextAreaField";
import { ChildFormFields, emptyChild, type ChildFormState } from "@/components/ChildFormFields";
import type { DataBundle } from "@/lib/types";
import { AdminNav } from "../../AdminNav";

// The exact sentence the data layer already appends to the errors it raises
// after a write has landed. Kept here as a constant so the banner can add it to
// the partial-save paths that don't carry it (the conflict-mid-write case) and
// not print it twice on the ones that do.
const PARTIAL_SAVE_NOTICE = "Other changes on this page may already be saved.";

const SAVED_NOTICE = "Changes saved.";

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
      // Captured once, here, and carried in form state from now on — see
      // baselineUpdatedAt below for why it must not be re-read at submit time.
      updatedAt: c.updatedAt,
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

// What a rejected save leaves on screen. `conflict` picks the banner (someone
// else's edit, which the user has to make a decision about) over the plain
// error banner; `partialSave` is the only thing that licenses the "other
// changes may already be saved" sentence.
interface SaveFailure {
  message: string;
  conflict: boolean;
  partialSave: boolean;
}

export default function FamilyEditPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params);
  const [formVersion, setFormVersion] = useState(0);
  // Lives on the parent so it survives the deliberate remount below — the
  // inner form is thrown away and rebuilt on save, so a success message set on
  // that instance would never render.
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Bumping the key remounts the form, which re-seeds every field AND the
  // updated_at baseline from freshly refreshed data. Keep this: without it a
  // second save in the same mount would be checked against the row version from
  // before the first save, and would conflict with itself.
  function reseed(notice: string | null) {
    setSavedNotice(notice);
    setFormVersion((v) => v + 1);
  }

  return (
    <FamilyEditForm
      key={`${familyId}-${formVersion}`}
      familyId={familyId}
      initialSuccessMessage={savedNotice}
      onSaved={() => reseed(SAVED_NOTICE)}
      onReloaded={() => reseed(null)}
    />
  );
}

function FamilyEditForm({
  familyId,
  initialSuccessMessage,
  onSaved,
  onReloaded,
}: {
  familyId: string;
  initialSuccessMessage: string | null;
  onSaved: () => void;
  onReloaded: () => void;
}) {
  const { data, refresh, saveFamilyEdit } = useData();

  const family = data?.families.find((f) => f.id === familyId) ?? null;
  const [sortTag, setSortTag] = useState(() => family?.sortTag ?? "");
  const [internalNotes, setInternalNotes] = useState(() => family?.internalNotes ?? "");
  const [children, setChildren] = useState<ChildFormState[]>(() => (data ? seedChildren(data, familyId) : [emptyChild()]));
  // The row version this form was SEEDED from, captured once at mount and
  // never refreshed in place. Reading `family.updatedAt` at submit time instead
  // would compare the live row against itself and wave every concurrent edit
  // straight through — that is the entire bug US-13 exists to fix.
  const [baselineUpdatedAt] = useState<string | null>(() => family?.updatedAt ?? null);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(initialSuccessMessage);
  const [pendingAction, setPendingAction] = useState<"save" | "force" | "reload" | null>(null);
  const conflictRef = useRef<HTMLDivElement>(null);

  // role="alert" gets the banner announced; this gets the user to it. It renders
  // above the Save button that triggered it, so without moving focus a keyboard
  // user would have to shift-tab backwards to find the two choices — and on a
  // long family the banner may be off-screen entirely for everyone else.
  useEffect(() => {
    if (failure?.conflict) conflictRef.current?.focus();
  }, [failure]);

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

  const busy = pendingAction !== null;

  // Any edit invalidates the "Changes saved." banner — leaving it up next to
  // unsaved typing is a small lie that costs the form its credibility. The
  // conflict banner deliberately survives editing: it holds the two choices,
  // and the user may well tweak a field before picking one.
  function markDirty() {
    setSuccessMessage(null);
  }

  function updateChild(key: string, patch: Partial<ChildFormState>) {
    markDirty();
    setChildren((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function addChildBlock() {
    markDirty();
    setChildren((prev) => [...prev, emptyChild()]);
  }

  function removeChildBlock(key: string) {
    markDirty();
    setChildren((prev) => (prev.length > 1 ? prev.filter((c) => c.key !== key) : prev));
  }

  function updateWishlistItem(key: string, idx: number, value: string) {
    markDirty();
    setChildren((prev) =>
      prev.map((c) =>
        c.key === key ? { ...c, wishlistItems: c.wishlistItems.map((w, i) => (i === idx ? value : w)) } : c
      )
    );
  }

  function addWishlistItem(key: string) {
    markDirty();
    setChildren((prev) => prev.map((c) => (c.key === key ? { ...c, wishlistItems: [...c.wishlistItems, ""] } : c)));
  }

  function removeWishlistItem(key: string, idx: number) {
    markDirty();
    setChildren((prev) =>
      prev.map((c) => (c.key === key ? { ...c, wishlistItems: c.wishlistItems.filter((_, i) => i !== idx) } : c))
    );
  }

  // `force` is only ever true from the "Save my version anyway" button in the
  // conflict banner: same arguments, same form state, one flag saying the user
  // has been told what they're about to overwrite. Nothing here touches the
  // form fields, so a rejected save leaves every keystroke exactly as typed.
  async function runSave(force: boolean) {
    setFailure(null);
    setSuccessMessage(null);
    setPendingAction(force ? "force" : "save");
    const result = await saveFamilyEdit(
      familyId,
      { sortTag, internalNotes },
      children,
      baselineUpdatedAt,
      force ? { force: true } : undefined
    );
    setPendingAction(null);

    if (!result.ok) {
      setFailure({
        message: result.error,
        conflict: result.conflict === true,
        partialSave: result.partialSave === true,
      });
      return;
    }

    onSaved();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await runSave(false);
  }

  // The one path that is allowed to replace what the user typed — and only
  // because they clicked a button that says so in as many words.
  async function handleReloadTheirs() {
    setPendingAction("reload");
    await refresh();
    onReloaded();
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
              onChange={(v) => {
                markDirty();
                setSortTag(v);
              }}
              placeholder="e.g. wrapping color"
            />
          </div>
          <div className="mt-3">
            <TextAreaField
              label="Internal notes (staff only)"
              value={internalNotes}
              onChange={(v) => {
                markDirty();
                setInternalNotes(v);
              }}
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
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-blue"
        >
          + Add another child
        </button>
        <p className="text-xs text-ink-muted">
          Raising a child&apos;s sponsor slots here generates the new card(s) immediately. Lowering it is a
          no-op — a card that might already be claimed is never auto-removed; that stays a deliberate,
          separate decision.
        </p>

        {failure?.conflict ? (
          <div
            ref={conflictRef}
            role="alert"
            tabIndex={-1}
            aria-labelledby="conflict-heading"
            className="rounded-xl border border-status-serious/40 bg-status-serious/10 p-4 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-blue"
          >
            <h2 id="conflict-heading" className="text-sm font-semibold text-ink-primary">
              Someone else changed this family while you were editing
            </h2>
            <p className="mt-1.5 text-sm text-ink-secondary">
              Your edits were not saved, but nothing you typed has been lost — it&apos;s all still on this
              page. Choose how to sort it out:
            </p>
            {failure.partialSave ? (
              <p className="mt-2 text-sm font-medium text-ink-primary">
                Part of this save had already gone through. {PARTIAL_SAVE_NOTICE}
              </p>
            ) : null}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <button
                  type="button"
                  onClick={handleReloadTheirs}
                  disabled={busy}
                  aria-describedby="conflict-reload-help"
                  className="w-full rounded-lg bg-cat-blue px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-blue disabled:opacity-50"
                >
                  {pendingAction === "reload" ? "Reloading…" : "Reload the latest version"}
                </button>
                <p id="conflict-reload-help" className="mt-1.5 text-xs text-ink-secondary">
                  Replaces what you typed with the details the other person saved.
                </p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => runSave(true)}
                  disabled={busy}
                  aria-describedby="conflict-force-help"
                  className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-ink-primary hover:border-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-blue disabled:opacity-50"
                >
                  {pendingAction === "force" ? "Saving…" : "Save my version anyway"}
                </button>
                <p id="conflict-force-help" className="mt-1.5 text-xs text-ink-secondary">
                  Keeps what you typed and overwrites the other person&apos;s changes.
                </p>
              </div>
            </div>

            {/* ink-muted would drop this under AA on the tinted background —
                the rest of the page's small print gets away with it on the
                plain page background, this doesn't. */}
            <p className="mt-3 text-xs text-ink-secondary">
              If you&apos;re not sure, reload — then make your change again on top of theirs.
            </p>
          </div>
        ) : null}

        {failure && !failure.conflict ? (
          <div
            role="alert"
            className="rounded-lg border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-sm text-ink-primary"
          >
            <p>{failure.message}</p>
            {/* Only ever shown when writes actually landed — and not a second
                time on the paths where the data layer's own message already
                ends with this sentence. */}
            {failure.partialSave && !failure.message.includes(PARTIAL_SAVE_NOTICE) ? (
              <p className="mt-1">{PARTIAL_SAVE_NOTICE}</p>
            ) : null}
          </div>
        ) : null}

        {successMessage ? (
          <div
            role="status"
            className="flex items-center justify-between rounded-lg bg-status-good/10 px-3 py-2 text-sm text-ink-primary"
          >
            <span>{successMessage}</span>
            <Link
              href="/admin"
              className="font-medium text-cat-blue hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-blue"
            >
              Back to dashboard →
            </Link>
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-cat-blue px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-blue disabled:opacity-50"
          >
            {pendingAction === "save" ? "Saving…" : "Save changes"}
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
