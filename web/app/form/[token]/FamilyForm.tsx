"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  emptyAnswers,
  resolveHelpText,
  submitForm,
  type IntakeAnswers,
  type IntakeFieldError,
  type IntakeFormDefinition,
  type IntakeFormSection,
} from "@/lib/intake";
import { friendlyMessage } from "@/components/intake/format";
import {
  PublicCard,
  PublicMasthead,
  PublicPage,
  QuietNote,
} from "@/components/intake/PublicShell";
import { FieldError, IntakeField, fieldDomId, isWideField } from "./fields";
import { validateAnswers } from "./validate";

// The public family intake form (US-21).
//
// Unauthenticated by construction: it lives outside app/admin, so AdminGate
// never sees it, and its only data calls are getForm/submitForm from
// lib/intake.ts. There is no table access anywhere in this file.
//
// `answers` is kept in the snake_case shape the definition describes and is
// handed to submitForm untouched — it is stored byte-for-byte as the record of
// what the family typed, so nothing is renamed, trimmed, or "cleaned up" on
// the way out.

const GENERIC_SUBMIT_ERROR =
  "We couldn't save your registration just now. Please check your answers and try again.";

// A hard gate the questionnaire definition doesn't carry: the person has to
// affirm that everyone they listed lives in their home before the form will
// send. It's a nudge, not a stored answer — nothing is written for it — so it
// lives here as page state rather than as a definition field (US-30). The
// synthetic path lets the error summary list and link to it like any real
// field error.
const LIVES_TOGETHER_FIELD = "everyone_lives_here";
const LIVES_TOGETHER_LABEL = "Everyone I've listed lives in my home";
const LIVES_TOGETHER_ERROR =
  "Please confirm that everyone you've listed lives in your home.";

type SectionValues = Record<string, unknown>;

export function FamilyForm({
  token,
  definition,
  schoolName,
}: {
  token: string;
  definition: IntakeFormDefinition;
  schoolName: string | null;
}) {
  const [answers, setAnswers] = useState<IntakeAnswers>(() => emptyAnswers(definition));
  const [livesTogetherConfirmed, setLivesTogetherConfirmed] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<IntakeFieldError[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  const errorMap = new Map(errors.map((e) => [e.field, e.message]));
  const repeating = definition.sections.find((s) => s.repeating);

  function clearErrors(paths: string[]) {
    if (paths.length === 0) return;
    setErrors((prev) => prev.filter((e) => !paths.includes(e.field)));
  }

  /** Writes into a plain (non-repeating) section. */
  function patchSection(sectionId: string, patch: SectionValues) {
    setAnswers((prev) => {
      const current = (prev as Record<string, unknown>)[sectionId];
      const base = current && typeof current === "object" ? (current as SectionValues) : {};
      return { ...prev, [sectionId]: { ...base, ...patch } };
    });
    clearErrors(Object.keys(patch).map((key) => `${sectionId}.${key}`));
  }

  /** Writes into one child of the repeating section. */
  function patchChild(sectionId: string, index: number, patch: SectionValues) {
    setAnswers((prev) => {
      const list = (prev as Record<string, unknown>)[sectionId];
      const children = Array.isArray(list) ? [...(list as SectionValues[])] : [];
      children[index] = { ...(children[index] ?? {}), ...patch };
      return { ...prev, [sectionId]: children };
    });
    clearErrors([
      sectionId,
      ...Object.keys(patch).flatMap((key) => [
        `${sectionId}[${index}].${key}`,
        // A wishlist patch replaces the whole array, so clear the per-idea
        // errors under it as well.
        ...errors
          .map((e) => e.field)
          .filter((field) => field.startsWith(`${sectionId}[${index}].${key}[`)),
      ]),
    ]);
  }

  function addChild(section: IntakeFormSection) {
    setAnswers((prev) => {
      const list = (prev as Record<string, unknown>)[section.id];
      const children = Array.isArray(list) ? (list as SectionValues[]) : [];
      return { ...prev, [section.id]: [...children, {}] };
    });
    clearErrors([section.id]);
  }

  function removeChild(section: IntakeFormSection, index: number) {
    setAnswers((prev) => {
      const list = (prev as Record<string, unknown>)[section.id];
      const children = Array.isArray(list) ? (list as SectionValues[]) : [];
      if (children.length <= (section.minItems ?? 1)) return prev;
      return { ...prev, [section.id]: children.filter((_, i) => i !== index) };
    });
    // Error paths are positional, so removing a child invalidates every index
    // after it. Dropping them all is honest: the next submit re-derives them.
    setErrors((prev) => prev.filter((e) => !e.field.startsWith(`${section.id}[`)));
  }

  function focusSummary() {
    // After the state update has painted. Focusing the summary rather than the
    // first bad input is deliberate: the family gets the count and the list of
    // what to fix, and can jump to any one of them.
    window.setTimeout(() => {
      summaryRef.current?.focus();
      summaryRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 0);
  }

  function focusField(path: string) {
    const el = document.getElementById(fieldDomId(path));
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      (el as HTMLElement).focus({ preventScroll: true });
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setBanner(null);
    const localErrors = validateAnswers(definition, answers);
    if (!livesTogetherConfirmed) {
      localErrors.push({ field: LIVES_TOGETHER_FIELD, message: LIVES_TOGETHER_ERROR });
    }
    if (localErrors.length > 0) {
      setErrors(localErrors);
      focusSummary();
      return;
    }
    setErrors([]);
    setSubmitting(true);

    // `contact` is deliberately omitted: the server falls back to
    // answers.family.guardian_*, so sending a second copy would only create a
    // way for the two to disagree.
    const result = await submitForm({ token, answers, honeypot });
    setSubmitting(false);

    if (result.ok) {
      // A filled honeypot lands here too, with nothing written. That is the
      // point — a bot gets exactly what a family gets.
      setSubmitted(true);
      window.scrollTo({ top: 0 });
      return;
    }

    setErrors(result.fieldErrors);
    setBanner(friendlyMessage(result.error, GENERIC_SUBMIT_ERROR));
    focusSummary();
  }

  if (submitted) {
    return <Confirmation definition={definition} schoolName={schoolName} />;
  }

  return (
    <PublicPage>
      <PublicMasthead title={definition.title} schoolName={schoolName}>
        {definition.intro.split("\n\n").map((paragraph, index) => (
          <p key={index} className={index > 0 ? "mt-3" : undefined}>
            {paragraph}
          </p>
        ))}
      </PublicMasthead>

      {definition.privacyNote ? <QuietNote>{definition.privacyNote}</QuietNote> : null}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-6">
        <ErrorSummary
          ref={summaryRef}
          banner={banner}
          errors={errors}
          definition={definition}
          onJump={focusField}
        />

        {definition.sections.map((section) =>
          section.repeating ? (
            <RepeatingSection
              key={section.id}
              definition={definition}
              section={section}
              answers={answers}
              errors={errorMap}
              onPatchChild={patchChild}
              onAdd={() => addChild(section)}
              onRemove={(index) => removeChild(section, index)}
            />
          ) : (
            <PlainSection
              key={section.id}
              definition={definition}
              section={section}
              answers={answers}
              errors={errorMap}
              onPatch={(patch) => patchSection(section.id, patch)}
            />
          )
        )}

        {/* The honeypot. Off-screen rather than display:none (which many bots
            skip), never in the tab order, and hidden from assistive tech so a
            screen-reader user is never asked to fill it. Whatever lands in it
            is always sent; the server answers a filled one with an ordinary
            success and writes nothing. */}
        {definition.honeypotField ? (
          <div aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
            <label htmlFor="intake-hp">Leave this field empty</label>
            <input
              id="intake-hp"
              name={definition.honeypotField}
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>
        ) : null}

        <PublicCard>
          <div className="mb-5 flex items-start gap-3">
            <input
              id={fieldDomId(LIVES_TOGETHER_FIELD)}
              type="checkbox"
              checked={livesTogetherConfirmed}
              onChange={(e) => {
                setLivesTogetherConfirmed(e.target.checked);
                if (e.target.checked) clearErrors([LIVES_TOGETHER_FIELD]);
              }}
              aria-describedby={
                errorMap.has(LIVES_TOGETHER_FIELD) ? `${fieldDomId(LIVES_TOGETHER_FIELD)}-error` : undefined
              }
              className="mt-0.5 h-5 w-5 shrink-0 rounded border border-border accent-cat-blue focus:outline-none focus:ring-2 focus:ring-cat-blue"
            />
            <div>
              <label htmlFor={fieldDomId(LIVES_TOGETHER_FIELD)} className="text-base text-ink-primary">
                {LIVES_TOGETHER_LABEL}.
              </label>
              <p className="mt-1 text-sm text-ink-secondary">
                Only register children who live with you. Please don&apos;t list a relative&apos;s
                child or someone who only visits.
              </p>
              {errorMap.has(LIVES_TOGETHER_FIELD) ? (
                <FieldError
                  id={`${fieldDomId(LIVES_TOGETHER_FIELD)}-error`}
                  message={errorMap.get(LIVES_TOGETHER_FIELD) as string}
                />
              ) : null}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-cat-blue px-5 py-3.5 text-base font-semibold text-white transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {submitting ? "Sending…" : (definition.submitLabel ?? "Submit registration")}
          </button>
          <p className="mt-3 text-sm text-ink-secondary">
            You won&apos;t be able to change this after you send it, so take a moment to look it
            over.
          </p>
          {definition.helpFooter ? (
            <p className="mt-4 border-t border-border pt-4 text-sm text-ink-muted">
              {definition.helpFooter}
            </p>
          ) : null}
        </PublicCard>
      </form>

      {repeating ? null : (
        // Defensive: a definition with no repeating section can't collect a
        // child, and the server would reject the submission. Better to say so
        // than to render a form that cannot succeed.
        <p className="mt-4 text-sm text-status-critical">
          This form is missing its children section. Please ask your school counselor for a current
          link.
        </p>
      )}
    </PublicPage>
  );
}

// ---------------------------------------------------------------------------

function SectionCard({
  section,
  children,
}: {
  section: IntakeFormSection;
  children: React.ReactNode;
}) {
  const headingId = `section-${section.id}`;
  return (
    <PublicCard>
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="text-lg font-semibold text-ink-primary">
          {section.title}
        </h2>
        {section.help ? <p className="mt-1 text-sm text-ink-secondary">{section.help}</p> : null}
        <div className="mt-5">{children}</div>
      </section>
    </PublicCard>
  );
}

function PlainSection({
  definition,
  section,
  answers,
  errors,
  onPatch,
}: {
  definition: IntakeFormDefinition;
  section: IntakeFormSection;
  answers: IntakeAnswers;
  errors: Map<string, string>;
  onPatch: (patch: SectionValues) => void;
}) {
  const raw = (answers as Record<string, unknown>)[section.id];
  const values = raw && typeof raw === "object" ? (raw as SectionValues) : {};

  return (
    <SectionCard section={section}>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {section.fields.map((field) => (
          <div key={field.id} className={isWideField(field) ? "sm:col-span-2" : undefined}>
            <IntakeField
              field={field}
              path={`${section.id}.${field.id}`}
              values={values}
              errors={errors}
              help={resolveHelpText(definition, field)}
              onPatch={onPatch}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function RepeatingSection({
  definition,
  section,
  answers,
  errors,
  onPatchChild,
  onAdd,
  onRemove,
}: {
  definition: IntakeFormDefinition;
  section: IntakeFormSection;
  answers: IntakeAnswers;
  errors: Map<string, string>;
  onPatchChild: (sectionId: string, index: number, patch: SectionValues) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const list = (answers as Record<string, unknown>)[section.id];
  const children = Array.isArray(list) ? (list as SectionValues[]) : [];
  const minItems = section.minItems ?? 1;
  const maxItems = section.maxItems ?? 10;
  const sectionError = errors.get(section.id);
  const itemLabel = section.itemLabel ?? "Child";

  return (
    <SectionCard section={section}>
      {sectionError ? <FieldError id={`${section.id}-error`} message={sectionError} /> : null}

      <div className="space-y-5">
        {children.map((child, index) => (
          // role="group" + aria-labelledby rather than fieldset/legend: a
          // legend has to be the fieldset's first child, which fights the
          // "heading on the left, Remove on the right" row, and browsers style
          // legends inconsistently inside a bordered box. The grouping and the
          // accessible name are identical.
          <div
            key={index}
            role="group"
            aria-labelledby={`${section.id}-${index}-heading`}
            className="rounded-xl border border-gridline bg-background/60 p-4 sm:p-5"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3
                id={`${section.id}-${index}-heading`}
                className="text-base font-semibold text-ink-primary"
              >
                {itemLabel} {index + 1}
              </h3>
              {children.length > minItems ? (
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="ml-auto rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-secondary underline underline-offset-4 hover:text-status-critical focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
                >
                  {section.removeLabel ?? "Remove"}
                </button>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {section.fields.map((field) => (
                <div key={field.id} className={isWideField(field) ? "sm:col-span-2" : undefined}>
                  <IntakeField
                    field={field}
                    path={`${section.id}[${index}].${field.id}`}
                    values={child ?? {}}
                    errors={errors}
                    help={resolveHelpText(definition, field)}
                    onPatch={(patch) => onPatchChild(section.id, index, patch)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {children.length < maxItems ? (
        <button
          type="button"
          onClick={onAdd}
          className="mt-5 w-full rounded-xl border border-dashed border-cat-blue/60 px-4 py-3 text-base font-medium text-cat-blue hover:bg-cat-blue/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue sm:w-auto"
        >
          + {section.addLabel ?? "Add another child"}
        </button>
      ) : null}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------

function ErrorSummary({
  ref,
  banner,
  errors,
  definition,
  onJump,
}: {
  ref: React.Ref<HTMLDivElement>;
  banner: string | null;
  errors: IntakeFieldError[];
  definition: IntakeFormDefinition;
  onJump: (path: string) => void;
}) {
  if (errors.length === 0 && !banner) return null;

  // `focus:`, not `focus-visible:` — this is focused programmatically after a
  // failed submit, and several browsers don't count that as "visible" focus.
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rounded-2xl border border-status-critical/40 bg-status-critical/10 p-5 focus:ring-2 focus:ring-status-critical focus:outline-none"
    >
      <h2 className="text-base font-semibold text-ink-primary">
        {errors.length > 0
          ? errors.length === 1
            ? "There's one answer to fix"
            : `There are ${errors.length} answers to fix`
          : "We couldn't send your registration"}
      </h2>
      {banner ? <p className="mt-2 text-sm text-ink-secondary">{banner}</p> : null}
      {errors.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {errors.map((error) => (
            <li key={`${error.field}-${error.message}`}>
              <button
                type="button"
                onClick={() => onJump(error.field)}
                className="text-left text-sm font-medium text-ink-primary underline underline-offset-4 hover:text-cat-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
              >
                {describeFieldPath(definition, error.field)}: {error.message}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * "children[1].age" -> "Child 2 — Age". Turns a machine-addressed error path
 * into the words on the family's screen, so the summary says where to look
 * without the page keeping a second map of the questionnaire.
 */
function describeFieldPath(definition: IntakeFormDefinition, path: string): string {
  if (path === LIVES_TOGETHER_FIELD) return LIVES_TOGETHER_LABEL;

  const match = /^([a-z0-9_]+)(?:\[(\d+)\])?(?:\.([a-z0-9_]+))?(?:\[(\d+)\])?$/i.exec(path);
  if (!match) return "This form";
  const [, sectionId, itemIndex, fieldId, listIndex] = match;

  const section = definition.sections.find((s) => s.id === sectionId);
  if (!section) return "This form";

  const prefix =
    itemIndex !== undefined
      ? `${section.itemLabel ?? "Child"} ${Number(itemIndex) + 1}`
      : section.title;

  if (!fieldId) return prefix;

  const field =
    section.fields.find((f) => f.id === fieldId) ??
    section.fields.find((f) => f.otherField === fieldId);
  const fieldLabel = field
    ? field.id === fieldId
      ? field.label
      : `${field.label} (description)`
    : fieldId;

  const suffix =
    listIndex !== undefined && field?.itemLabels
      ? ` — ${field.itemLabels[Number(listIndex)] ?? `Idea ${Number(listIndex) + 1}`}`
      : "";

  return `${prefix} — ${fieldLabel}${suffix}`;
}

// ---------------------------------------------------------------------------

/**
 * The end of the road, deliberately.
 *
 * No submission id, no echo of what was typed, and no link back into the form:
 * submit_form returns none of those and there is no way to reopen a
 * submission, so the page must not imply there is (US-21).
 */
function Confirmation({
  definition,
  schoolName,
}: {
  definition: IntakeFormDefinition;
  schoolName: string | null;
}) {
  const heading = definition.confirmation?.heading ?? "Thank you — your registration is in.";
  const body =
    definition.confirmation?.body ??
    "Your registration is with your school counselor now. They'll confirm it with Reach Church. There's nothing else you need to do.";

  return (
    <PublicPage>
      <PublicCard>
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-status-good/15 text-2xl text-status-good"
        >
          ✓
        </div>
        <h1
          tabIndex={-1}
          ref={(el) => {
            // The form is gone from the DOM by now, so focus has nowhere to
            // land and a screen reader would announce nothing. Moving it to
            // the confirmation heading is what makes the success audible.
            el?.focus();
          }}
          className="mt-4 text-2xl font-semibold tracking-tight text-ink-primary outline-none sm:text-3xl"
        >
          {heading}
        </h1>
        <p className="mt-3 text-ink-secondary">{body}</p>
        {schoolName ? (
          <p className="mt-4 rounded-xl bg-cat-yellow/10 px-4 py-3 text-sm text-ink-secondary">
            Your counselor at {schoolName} will confirm it.
          </p>
        ) : null}
        {definition.helpFooter ? (
          <p className="mt-6 border-t border-border pt-4 text-sm text-ink-muted">
            {definition.helpFooter}
          </p>
        ) : null}
      </PublicCard>
    </PublicPage>
  );
}
