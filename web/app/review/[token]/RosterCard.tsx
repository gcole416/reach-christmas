"use client";

import { useId, useState } from "react";
import {
  rejectSubmission,
  verifySubmission,
  type CorrectionFieldDef,
  type CorrectionFields,
  type RosterChild,
  type RosterSubmission,
  type SubmissionCorrections,
} from "@/lib/intake";
import { formatDate, friendlyMessage } from "@/components/intake/format";
import { PublicCard } from "@/components/intake/PublicShell";
import { SubmissionStatusBadge } from "@/components/intake/SubmissionStatusBadge";
import { isPending } from "./RosterView";

// One registration on the counselor's roster.
//
// Editable ONLY while the submission is pending, and only ever first name,
// age, and grade — the three fields verify_submission accepts. Everything else
// about the family is neither shown here nor present in the response.
//
// Every rule those three controls obey (the grade list, the age range, the
// name length) comes from `correctionFields`, i.e. from the form definition
// each submission pinned. None of it is restated here: a limit typed into JSX
// drifts from the one verify_submission enforces, and when it drifts loose the
// counselor loses their whole approve click to a server-side rejection.
//
// Every one of those rules is checked on the Confirm click and answered with a
// visible message. None of them is enforced with a truncating attribute:
// `maxLength` on the name input would quietly delete the tail of a pasted
// name, the counselor would approve a card that looked fine, and a child would
// end up printed under a chopped name that nobody was ever told about. A
// refused click costs a sentence; a silent edit costs the name.

const GENERIC_ERROR = "We couldn't save that. Please try again.";

/**
 * Caps that come from verify_submission / reject_submission rather than from
 * the form definition, and which the SQL applies with `left()` — i.e. it
 * TRUNCATES silently rather than returning an error.
 *
 * They're restated here (the one place this file restates a server rule) so
 * the counselor is told before the round trip. The verifier name is the
 * attestation of who confirmed a family; the reason is the record of why one
 * was turned away. Filing a shortened version of either, with nobody told,
 * is the failure this page is meant to avoid.
 */
const VERIFIER_NAME_MAX = 200; // verify_submission: left(v_name, 200)
const REJECT_REASON_MAX = 1000; // reject_submission: left(v_reason, 1000)

/**
 * The visible label for each control, deliberately fixed rather than taken
 * from `def.label`. These are the accessible names the review flow's tests and
 * every screen reader user navigate by, and they shouldn't change out from
 * under either one when a future definition renames a question. The *rules*
 * still come from the definition; only the wording is ours.
 */
const FIELD_LABELS = {
  firstName: "First name",
  age: "Age",
  grade: "Grade",
} as const;

const CONTROL_CLASS =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-ink-primary focus:ring-2 focus:ring-cat-blue focus:outline-none";

const READONLY_CONTROL_CLASS =
  "mt-1 w-full cursor-default rounded-lg border border-gridline bg-background px-3 py-2.5 text-base text-ink-secondary placeholder:text-ink-muted focus:ring-2 focus:ring-cat-blue focus:outline-none";

type ChildDraft = { firstName: string; age: string; grade: string };

/**
 * Whether this field can be corrected at all.
 *
 * `null` means no form version on this roster defines the field — render it
 * read-only, never as a free-text box, because verify_submission has no rule
 * to accept whatever gets typed in. A picker with an empty option list is the
 * same situation wearing a different hat: there is no value it could produce
 * that the server would take, so it's read-only too.
 */
function isEditable(def: CorrectionFieldDef | null): def is CorrectionFieldDef {
  if (!def) return false;
  if (def.type === "select" && def.options.length === 0) return false;
  return true;
}

/** "between 5 and 18" / "5 or higher" / "18 or lower" / null for unbounded. */
function describeRange(def: CorrectionFieldDef): string | null {
  // Null check, not a falsy one: 0 is a real lower bound.
  const hasMin = def.min !== null;
  const hasMax = def.max !== null;
  if (hasMin && hasMax) return `between ${def.min} and ${def.max}`;
  if (hasMin) return `${def.min} or higher`;
  if (hasMax) return `${def.max} or lower`;
  return null;
}

/** ["first name", "age", "grade"] -> "first name, age, or grade". */
function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}

function seedDrafts(children: RosterChild[]): ChildDraft[] {
  return children.map((child) => ({
    firstName: child.firstName ?? "",
    age: child.age === null ? "" : String(child.age),
    grade: child.grade ?? "",
  }));
}

export function RosterCard({
  reviewToken,
  submission,
  correctionFields,
  verifierName,
  onVerifierNameChange,
  onUpdated,
}: {
  reviewToken: string;
  submission: RosterSubmission;
  /** The pinned definition's rule for each correctable field. */
  correctionFields: CorrectionFields;
  verifierName: string;
  onVerifierNameChange: (name: string) => void;
  onUpdated: (updated: RosterSubmission) => void;
}) {
  const baseId = useId();
  const pending = isPending(submission);
  const [drafts, setDrafts] = useState<ChildDraft[]>(() => seedDrafts(submission.children));
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [reason, setReason] = useState("");
  const [asDuplicate, setAsDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing on this card is correctable, so there's nothing to edit — show the
  // plain table and let the counselor confirm or reject as-is.
  const anyEditable =
    isEditable(correctionFields.firstName) ||
    isEditable(correctionFields.age) ||
    isEditable(correctionFields.grade);

  function updateDraft(index: number, patch: Partial<ChildDraft>) {
    setError(null);
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  /**
   * Diffs the drafts against what the family submitted. Only changed fields go
   * in the payload — a correction is a partial update, and sending an
   * unchanged value would record a "fix" that never happened. A field with no
   * definition behind it is skipped entirely: its control is read-only, so it
   * cannot have changed, and the server has no rule to validate it against.
   */
  function buildCorrections(): { corrections: SubmissionCorrections; error?: string } {
    const corrections: SubmissionCorrections = {};
    const nameDef = correctionFields.firstName;
    const ageDef = correctionFields.age;
    const gradeDef = correctionFields.grade;

    for (let i = 0; i < submission.children.length; i += 1) {
      const original = submission.children[i];
      const draft = drafts[i];
      if (!draft) continue;

      const fix: SubmissionCorrections[number] = {};

      if (isEditable(nameDef)) {
        const name = draft.firstName.trim();
        if (name !== (original.firstName ?? "").trim()) {
          if (!name) {
            return {
              corrections: {},
              error: `Child ${i + 1} needs a first name. Use "This isn't right" if the child shouldn't be on the list.`,
            };
          }
          // The definition's cap, checked here rather than clamped on the
          // input. A `maxLength` attribute would hand verify_submission a name
          // the counselor never typed; this hands them a sentence instead.
          if (nameDef.maxLength !== null && name.length > nameDef.maxLength) {
            return {
              corrections: {},
              error: `Child ${i + 1}'s first name is ${name.length} characters. Please shorten it to ${nameDef.maxLength} or fewer.`,
            };
          }
          fix.firstName = name;
        }
      }

      if (isEditable(ageDef)) {
        const ageText = draft.age.trim();
        const originalAge = original.age === null ? "" : String(original.age);
        if (ageText !== originalAge && ageText !== "") {
          // A number input still accepts an out-of-range typed value, so the
          // definition's bounds are re-checked here rather than left to the
          // server — an inline message costs a keystroke, a rejected verify
          // costs the whole approve click.
          if (!/^\d+$/.test(ageText)) {
            return { corrections: {}, error: `Child ${i + 1}'s age must be a whole number.` };
          }
          const age = Number(ageText);
          const outOfRange =
            (ageDef.min !== null && age < ageDef.min) || (ageDef.max !== null && age > ageDef.max);
          if (outOfRange) {
            const range = describeRange(ageDef);
            return {
              corrections: {},
              error: `Child ${i + 1}'s age must be ${range ?? "a whole number"}.`,
            };
          }
          fix.age = age;
        }
      }

      if (isEditable(gradeDef)) {
        const grade = draft.grade.trim();
        if (grade && grade !== (original.grade ?? "").trim()) {
          fix.grade = grade;
        }
      }

      if (Object.keys(fix).length > 0) corrections[i + 1] = fix;
    }

    return { corrections };
  }

  async function handleApprove() {
    const name = verifierName.trim();
    if (!name) {
      setError("Please type your name, so OneLife Church knows who confirmed this.");
      return;
    }
    if (name.length > VERIFIER_NAME_MAX) {
      setError(
        `That name is ${name.length} characters. Please shorten it to ${VERIFIER_NAME_MAX} or fewer.`
      );
      return;
    }

    const { corrections, error: correctionError } = buildCorrections();
    if (correctionError) {
      setError(correctionError);
      return;
    }

    setBusy(true);
    setError(null);
    const result = await verifySubmission({
      reviewToken,
      submissionId: submission.id,
      verifierName: name,
      corrections: Object.keys(corrections).length > 0 ? corrections : undefined,
    });
    setBusy(false);

    if (!result.ok) {
      setError(friendlyMessage(result.error, GENERIC_ERROR));
      return;
    }

    // Moved in place, with the corrections applied to what's on screen so the
    // counselor sees the names they just fixed.
    setMode("idle");
    onUpdated({
      ...submission,
      status: "verified",
      verifiedAt: new Date().toISOString(),
      verifiedByLabel: name,
      hasCorrections: Object.keys(corrections).length > 0,
      children: submission.children.map((child, i) => {
        const fix = corrections[i + 1];
        if (!fix) return child;
        return {
          ...child,
          firstName: fix.firstName ?? child.firstName,
          age: fix.age ?? child.age,
          grade: fix.grade ?? child.grade,
        };
      }),
    });
  }

  async function handleReject() {
    const text = reason.trim();
    if (!text) {
      setError("Please add a short reason so OneLife Church knows what happened.");
      return;
    }
    if (text.length > REJECT_REASON_MAX) {
      setError(
        `That note is ${text.length} characters. Please shorten it to ${REJECT_REASON_MAX} or fewer.`
      );
      return;
    }

    setBusy(true);
    setError(null);
    const result = await rejectSubmission({
      reviewToken,
      submissionId: submission.id,
      reason: text,
      asDuplicate,
    });
    setBusy(false);

    if (!result.ok) {
      setError(friendlyMessage(result.error, GENERIC_ERROR));
      return;
    }

    setMode("idle");
    onUpdated({
      ...submission,
      status: result.status,
      resolutionNote: text,
    });
  }

  return (
    <PublicCard className="print:break-inside-avoid">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-secondary">
          Registered {formatDate(submission.submittedAt)} ·{" "}
          {submission.children.length === 1 ? "1 child" : `${submission.children.length} children`}
        </p>
        <SubmissionStatusBadge status={submission.status} audience="counselor" />
      </div>

      <div className="mt-4">
        {pending && anyEditable ? (
          <EditableChildren
            baseId={baseId}
            drafts={drafts}
            fields={correctionFields}
            onChange={updateDraft}
          />
        ) : (
          <>
            <ReadOnlyChildren rows={submission.children} />
            {pending ? (
              <p className="mt-3 text-sm text-ink-secondary">
                These details can&apos;t be corrected here. Confirm the household if it looks right,
                or use &ldquo;This isn&apos;t right&rdquo; and tell us what to fix.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Outcome, for anything the counselor has already handled. */}
      {submission.status === "verified" || submission.status === "imported" ? (
        <p className="mt-4 text-sm text-ink-secondary">
          Confirmed{submission.verifiedByLabel ? ` by ${submission.verifiedByLabel}` : ""}
          {submission.verifiedAt ? ` on ${formatDate(submission.verifiedAt)}` : ""}
          {submission.hasCorrections ? " · you corrected a detail" : ""}
          {submission.status === "imported" ? " · OneLife Church has added this household to the drive" : ""}
        </p>
      ) : null}

      {submission.status === "rejected" || submission.status === "duplicate" ? (
        <p className="mt-4 text-sm text-ink-secondary">
          {submission.status === "duplicate" ? "Marked a duplicate" : "Not approved"}
          {submission.resolutionNote ? `: ${submission.resolutionNote}` : ""}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-status-critical/10 px-3 py-2 text-sm font-medium text-ink-primary"
        >
          {error}
        </p>
      ) : null}

      {pending ? (
        <div className="mt-5 border-t border-border pt-4 print:hidden">
          {mode === "idle" ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode("approve");
                }}
                className="rounded-xl bg-cat-blue px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Confirm this household
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode("reject");
                }}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-ink-secondary hover:border-status-critical hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
              >
                This isn&apos;t right
              </button>
            </div>
          ) : null}

          {mode === "approve" ? (
            <div className="rounded-xl bg-cat-blue/5 p-4">
              <label
                htmlFor={`${baseId}-verifier`}
                className="block text-sm font-medium text-ink-primary"
              >
                Your name
              </label>
              <p id={`${baseId}-verifier-help`} className="mt-1 text-sm text-ink-secondary">
                OneLife Church records who confirmed each household.
                {anyEditable ? " Fix anything wrong in the details above before you confirm." : ""}
              </p>
              <input
                id={`${baseId}-verifier`}
                type="text"
                value={verifierName}
                autoComplete="name"
                aria-describedby={`${baseId}-verifier-help`}
                onChange={(e) => {
                  setError(null);
                  onVerifierNameChange(e.target.value);
                }}
                className="mt-2 w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-ink-primary focus:ring-2 focus:ring-cat-blue focus:outline-none"
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleApprove}
                  className="rounded-xl bg-cat-blue px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Confirming…" : "Confirm"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMode("idle")}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-ink-secondary underline underline-offset-4 hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {mode === "reject" ? (
            <div className="rounded-xl bg-status-critical/5 p-4">
              <label
                htmlFor={`${baseId}-reason`}
                className="block text-sm font-medium text-ink-primary"
              >
                What&apos;s wrong with this one?
              </label>
              <p id={`${baseId}-reason-help`} className="mt-1 text-sm text-ink-secondary">
                A short note is enough, like &ldquo;not a household from our school&rdquo; or
                &ldquo;they registered twice&rdquo;.
              </p>
              <textarea
                id={`${baseId}-reason`}
                rows={3}
                value={reason}
                aria-describedby={`${baseId}-reason-help`}
                onChange={(e) => {
                  setError(null);
                  setReason(e.target.value);
                }}
                className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-ink-primary focus:ring-2 focus:ring-cat-blue focus:outline-none"
              />
              <div className="mt-3 flex items-start gap-2.5">
                <input
                  id={`${baseId}-duplicate`}
                  type="checkbox"
                  checked={asDuplicate}
                  onChange={(e) => setAsDuplicate(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border border-border accent-cat-blue focus:ring-2 focus:ring-cat-blue focus:outline-none"
                />
                <label htmlFor={`${baseId}-duplicate`} className="text-sm text-ink-primary">
                  This household already registered; it&apos;s a duplicate
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleReject}
                  className="rounded-xl bg-status-critical px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-critical focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Saving…" : asDuplicate ? "Mark as duplicate" : "Don't approve"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMode("idle")}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-ink-secondary underline underline-offset-4 hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </PublicCard>
  );
}

// ---------------------------------------------------------------------------

function ReadOnlyChildren({ rows }: { rows: RosterChild[] }) {
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Children on this registration</caption>
      <thead>
        <tr className="text-xs tracking-wide text-ink-muted uppercase">
          <th scope="col" className="pb-1 font-medium">
            First name
          </th>
          <th scope="col" className="pb-1 font-medium">
            Age
          </th>
          <th scope="col" className="pb-1 font-medium">
            Grade
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gridline">
        {rows.map((child) => (
          <tr key={child.index}>
            <td className="py-2 font-medium text-ink-primary">{child.firstName ?? "—"}</td>
            <td className="py-2 text-ink-secondary">{child.age ?? "—"}</td>
            <td className="py-2 text-ink-secondary">{child.grade ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The only editable thing on this page: first name, age, grade.
 *
 * Each child is a labelled group, and every control is `<label htmlFor>` +
 * a separate control — never a control nested inside its label, which is what
 * made a size picker's accessible name the concatenation of all 27 options in
 * US-18.
 *
 * Which control each field gets, and every limit it enforces, is read from
 * `fields` — the rule the pinned definition states and verify_submission
 * enforces. Nothing here hard-codes a grade list, an age range, or a name
 * length.
 */
function EditableChildren({
  baseId,
  drafts,
  fields,
  onChange,
}: {
  baseId: string;
  drafts: ChildDraft[];
  fields: CorrectionFields;
  onChange: (index: number, patch: Partial<ChildDraft>) => void;
}) {
  const noteId = `${baseId}-readonly-note`;
  const keys = ["firstName", "age", "grade"] as const;
  const editable = keys.filter((key) => isEditable(fields[key]));
  const hasReadOnly = editable.length < keys.length;

  // The age range is stated once, in the intro, rather than as a hint under a
  // ~6rem-wide column where it would wrap to three lines on every child. Each
  // age input points at it, so a screen reader hears the rule on focus.
  const ageRange = isEditable(fields.age) ? describeRange(fields.age) : null;
  const ageRuleId = ageRange ? `${baseId}-age-rule` : undefined;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Fix the {joinLabels(editable.map((key) => FIELD_LABELS[key].toLowerCase()))} if
        something&apos;s wrong. Nothing else about the household can be changed here.
        {ageRange ? <span id={ageRuleId}> Ages must be {ageRange}.</span> : null}
      </p>
      {drafts.map((draft, index) => (
        <div
          key={index}
          role="group"
          aria-labelledby={`${baseId}-child-${index}`}
          className="rounded-xl border border-gridline bg-background/60 p-3"
        >
          <p id={`${baseId}-child-${index}`} className="text-sm font-semibold text-ink-primary">
            Child {index + 1}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_6rem_minmax(0,1.5fr)]">
            <Field id={`${baseId}-name-${index}`} label={FIELD_LABELS.firstName}>
              {isEditable(fields.firstName) ? (
                <CorrectionControl
                  id={`${baseId}-name-${index}`}
                  def={fields.firstName}
                  value={draft.firstName}
                  onChange={(value) => onChange(index, { firstName: value })}
                />
              ) : (
                <ReadOnlyControl
                  id={`${baseId}-name-${index}`}
                  value={draft.firstName}
                  noteId={noteId}
                />
              )}
            </Field>

            <Field id={`${baseId}-age-${index}`} label={FIELD_LABELS.age}>
              {isEditable(fields.age) ? (
                <CorrectionControl
                  id={`${baseId}-age-${index}`}
                  def={fields.age}
                  value={draft.age}
                  describedBy={ageRuleId}
                  onChange={(value) => onChange(index, { age: value })}
                />
              ) : (
                <ReadOnlyControl id={`${baseId}-age-${index}`} value={draft.age} noteId={noteId} />
              )}
            </Field>

            <Field id={`${baseId}-grade-${index}`} label={FIELD_LABELS.grade}>
              {isEditable(fields.grade) ? (
                <CorrectionControl
                  id={`${baseId}-grade-${index}`}
                  def={fields.grade}
                  value={draft.grade}
                  onChange={(value) => onChange(index, { grade: value })}
                />
              ) : (
                <ReadOnlyControl
                  id={`${baseId}-grade-${index}`}
                  value={draft.grade}
                  noteId={noteId}
                />
              )}
            </Field>
          </div>
        </div>
      ))}
      {hasReadOnly ? (
        <p id={noteId} className="text-sm text-ink-secondary">
          Greyed-out details can&apos;t be corrected here, because the registration form these
          households filled out didn&apos;t ask for them. If one is wrong, use &ldquo;This
          isn&apos;t right&rdquo; and say what to fix.
        </p>
      ) : null}
    </div>
  );
}

/** Label + control, always as siblings — the control is never nested inside. */
function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A field the definition doesn't describe. Shown, not editable — deliberately
 * not a free-text box, since there is no rule behind it for the server to
 * accept a typed value against.
 */
function ReadOnlyControl({ id, value, noteId }: { id: string; value: string; noteId: string }) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      readOnly
      placeholder="Not provided"
      aria-describedby={noteId}
      className={READONLY_CONTROL_CLASS}
    />
  );
}

/**
 * The control for one correctable field, CHOSEN BY `def.type` rather than by
 * which field it happens to be.
 *
 * This is the other half of what `correction_fields` exists for. The rules
 * (the grade list, the age bounds, the name cap) already came from the pinned
 * definition, but the control type used to be a constant in the page: grade was
 * always a `<select>`, age was always `<input type="number">`. A version that
 * defines grade as free text then rendered as a picker whose only option was
 * "Choose one…" plus the child's own value tagged "(not on this year's list)" —
 * a correction the counselor could not make and was not told about.
 *
 *   select -> a picker over `def.options` (empty options never reach here;
 *             isEditable has already made that case read-only)
 *   number -> a number input bounded by def.min / def.max
 *   else   -> a text input
 *
 * Deliberately no `maxLength` on the text input. The definition's cap is
 * checked on Confirm (buildCorrections) and answered with a message; clamping
 * it here would silently shorten a pasted name.
 */
function CorrectionControl({
  id,
  def,
  value,
  describedBy,
  onChange,
}: {
  id: string;
  def: CorrectionFieldDef;
  value: string;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  if (def.type === "select") {
    return (
      <OptionSelect id={id} def={def} value={value} describedBy={describedBy} onChange={onChange} />
    );
  }

  if (def.type === "number") {
    return (
      <input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        // `?? undefined` and not `|| undefined`: 0 is a real bound.
        min={def.min ?? undefined}
        max={def.max ?? undefined}
        value={value}
        required={def.required}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className={CONTROL_CLASS}
      />
    );
  }

  return (
    <input
      id={id}
      type="text"
      value={value}
      required={def.required}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
      className={CONTROL_CLASS}
    />
  );
}

/** A real picker over the definition's option list — no typing, no datalist. */
function OptionSelect({
  id,
  def,
  value,
  describedBy,
  onChange,
}: {
  id: string;
  def: CorrectionFieldDef;
  value: string;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  const known = def.options.some((option) => option.value === value);
  return (
    <select
      id={id}
      value={value}
      required={def.required}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
      className={CONTROL_CLASS}
    >
      {value === "" ? <option value="">Choose one…</option> : null}
      {/* A value this year's list no longer contains still has to display as
          itself. Dropping it would silently re-label a real child to whichever
          option happens to sort first. */}
      {value !== "" && !known ? (
        <option value={value}>{`${value} (not on this year's list)`}</option>
      ) : null}
      {def.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
