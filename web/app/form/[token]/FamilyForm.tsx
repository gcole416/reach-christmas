"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  emptyAnswers,
  normalizeDefinition,
  resolveHelpText,
  submitForm,
  type IntakeAnswers,
  type IntakeFieldError,
  type IntakeFormDefinition,
  type IntakeFormSection,
} from "@/lib/intake";
import { friendlyMessage } from "@/components/intake/format";
import { isHighSchoolGrade } from "@/lib/queries";
import { PHASE_1_FORM_DEFINITION, PHASE_1_FORM_DEFINITION_ES } from "@/lib/intakeFormDefinition";
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

/** Small EN/ES string swap for the UI chrome that isn't sourced from the
 *  questionnaire definition (buttons, gates, summary headings). Content that
 *  IS in the definition (labels, help, options) is never handled here — it
 *  already carries its own translation per locale. */
function t(locale: string, en: string, es: string): string {
  return locale === "es" ? es : en;
}

function genericSubmitError(locale: string): string {
  return t(
    locale,
    "We couldn't save your registration just now. Please check your answers and try again.",
    "No pudimos guardar su registro en este momento. Por favor revise sus respuestas e intente de nuevo."
  );
}

// A hard gate the questionnaire definition doesn't carry: the person has to
// affirm that everyone they listed lives in their home before the form will
// send. It's a nudge, not a stored answer — nothing is written for it — so it
// lives here as page state rather than as a definition field (US-30). The
// synthetic path lets the error summary list and link to it like any real
// field error.
const LIVES_TOGETHER_FIELD = "everyone_lives_here";
function livesTogetherLabel(locale: string): string {
  return t(locale, "Everyone I've listed lives in my home", "Todos los que he mencionado viven en mi hogar");
}
function livesTogetherError(locale: string): string {
  return t(
    locale,
    "Please confirm that everyone you've listed lives in your home.",
    "Por favor confirme que todos los que mencionó viven en su hogar."
  );
}
function livesTogetherHelp(locale: string): string {
  return t(
    locale,
    "Only register children who live with you. Please don't list a relative's child or someone who only visits.",
    "Registre únicamente a los niños que viven con usted. Por favor no incluya al hijo de un familiar ni a alguien que solo visita."
  );
}

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

  // The language TOGGLE (top of page) is independent of which locale's
  // form_version this link happens to be pinned to server-side. The English
  // and Spanish definitions share identical field ids/types/options/required
  // rules (see the "byte-for-byte" note in intakeFormDefinition.ts) — only the
  // displayed text differs — so swapping which one renders is safe: it never
  // changes what gets validated or what submit_form receives.
  const [displayLocale, setDisplayLocale] = useState(definition.locale);
  const [languageFieldTouched, setLanguageFieldTouched] = useState(false);
  const alternateDefinition = useMemo(
    () => normalizeDefinition(definition.locale === "es" ? PHASE_1_FORM_DEFINITION : PHASE_1_FORM_DEFINITION_ES),
    [definition.locale]
  );
  const activeDefinition = displayLocale === definition.locale ? definition : alternateDefinition;

  /** Flips the whole page's language. Also pre-fills the "what language should
   *  we contact you in" field to match, unless the family already chose one
   *  themselves — that field is its own question and stays editable. */
  function handleLanguageToggle(locale: string) {
    setDisplayLocale(locale);
    if (!languageFieldTouched) {
      setAnswers((prev) => {
        const current = (prev as Record<string, unknown>).family;
        const base = current && typeof current === "object" ? (current as SectionValues) : {};
        return { ...prev, family: { ...base, preferred_language: locale } };
      });
    }
  }

  const errorMap = new Map(errors.map((e) => [e.field, e.message]));
  const repeating = activeDefinition.sections.find((s) => s.repeating);

  function clearErrors(paths: string[]) {
    if (paths.length === 0) return;
    setErrors((prev) => prev.filter((e) => !paths.includes(e.field)));
  }

  /** Writes into a plain (non-repeating) section. */
  function patchSection(sectionId: string, patch: SectionValues) {
    if (sectionId === "family" && "preferred_language" in patch) {
      setLanguageFieldTouched(true);
    }
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
      // A grade change can hide or reveal this child's gift fields (US-32), so
      // drop every error under this child — the next submit re-derives them
      // against the fields that are actually shown.
      ...("grade" in patch
        ? errors.map((e) => e.field).filter((field) => field.startsWith(`${sectionId}[${index}].`))
        : []),
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
    const localErrors = validateAnswers(activeDefinition, answers);
    if (!livesTogetherConfirmed) {
      localErrors.push({ field: LIVES_TOGETHER_FIELD, message: livesTogetherError(activeDefinition.locale) });
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
    setBanner(friendlyMessage(result.error, genericSubmitError(activeDefinition.locale)));
    focusSummary();
  }

  if (submitted) {
    return <Confirmation definition={activeDefinition} schoolName={schoolName} />;
  }

  return (
    <PublicPage>
      <LanguageToggle active={displayLocale} onChange={handleLanguageToggle} />

      <PublicMasthead title={activeDefinition.title} schoolName={schoolName}>
        {activeDefinition.intro.split("\n\n").map((paragraph, index) => (
          <p key={index} className={index > 0 ? "mt-3" : undefined}>
            {paragraph}
          </p>
        ))}
      </PublicMasthead>

      {activeDefinition.privacyNote ? <QuietNote>{activeDefinition.privacyNote}</QuietNote> : null}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-6">
        <ErrorSummary
          ref={summaryRef}
          banner={banner}
          errors={errors}
          definition={activeDefinition}
          onJump={focusField}
        />

        {activeDefinition.sections.map((section) =>
          section.repeating ? (
            <RepeatingSection
              key={section.id}
              definition={activeDefinition}
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
              definition={activeDefinition}
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
        {activeDefinition.honeypotField ? (
          <div aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
            <label htmlFor="intake-hp">Leave this field empty</label>
            <input
              id="intake-hp"
              name={activeDefinition.honeypotField}
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
                {livesTogetherLabel(activeDefinition.locale)}.
              </label>
              <p className="mt-1 text-sm text-ink-secondary">{livesTogetherHelp(activeDefinition.locale)}</p>
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
            {submitting
              ? t(activeDefinition.locale, "Sending…", "Enviando…")
              : (activeDefinition.submitLabel ??
                 t(activeDefinition.locale, "Submit registration", "Enviar registro"))}
          </button>
          <p className="mt-3 text-sm text-ink-secondary">
            {t(
              activeDefinition.locale,
              "You won't be able to change this after you send it, so take a moment to look it over.",
              "No podrá cambiar esto después de enviarlo, así que tómese un momento para revisarlo."
            )}
          </p>
          {activeDefinition.helpFooter ? (
            <p className="mt-4 border-t border-border pt-4 text-sm text-ink-muted">
              {activeDefinition.helpFooter}
            </p>
          ) : null}
        </PublicCard>
      </form>

      {repeating ? null : (
        // Defensive: a definition with no repeating section can't collect a
        // child, and the server would reject the submission. Better to say so
        // than to render a form that cannot succeed.
        <p className="mt-4 text-sm text-status-critical">
          {t(
            activeDefinition.locale,
            "This form is missing its children section. Please ask your school counselor for a current link.",
            "A este formulario le falta la sección de niños. Por favor pídale a su consejero escolar un enlace actualizado."
          )}
        </p>
      )}
    </PublicPage>
  );
}

// ---------------------------------------------------------------------------

/**
 * The whole-page language switch (top of the form, above the title). Swaps
 * every string on the page — the English and Spanish questionnaires are
 * otherwise identical (same field ids, same validation), so this is a pure
 * display choice, not a different link or a page reload.
 */
function LanguageToggle({ active, onChange }: { active: string; onChange: (locale: string) => void }) {
  const optionClass = (locale: string) =>
    `rounded-full px-3 py-1 text-sm font-medium transition ${
      active === locale
        ? "bg-cat-blue text-white"
        : "text-ink-secondary hover:text-ink-primary"
    }`;
  return (
    <div className="mb-4 flex justify-end">
      <div
        role="group"
        aria-label="Language / Idioma"
        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface p-1"
      >
        <button type="button" onClick={() => onChange("en")} className={optionClass("en")}>
          English
        </button>
        <button type="button" onClick={() => onChange("es")} className={optionClass("es")}>
          Español
        </button>
      </div>
    </div>
  );
}

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
  const itemLabel = section.itemLabel ?? t(definition.locale, "Child", "Niño o niña");

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
                  {section.removeLabel ?? t(definition.locale, "Remove", "Eliminar")}
                </button>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {section.fields
                .filter((field) => !(childIsSelfShopper(child) && field.selfShopperHidden))
                .map((field) => (
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

            {childIsSelfShopper(child) ? <ShopDayNote locale={definition.locale} /> : null}
          </div>
        ))}
      </div>

      {children.length < maxItems ? (
        <button
          type="button"
          onClick={onAdd}
          className="mt-5 w-full rounded-xl border border-dashed border-cat-blue/60 px-4 py-3 text-base font-medium text-cat-blue hover:bg-cat-blue/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue sm:w-auto"
        >
          + {section.addLabel ?? t(definition.locale, "Add another child", "Agregar otro niño o niña")}
        </button>
      ) : null}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------

/** Grade 9-12 -> this child shops for their own gifts at the store shopping day. */
function childIsSelfShopper(child: SectionValues | undefined): boolean {
  const grade = child && typeof child.grade === "string" ? child.grade : undefined;
  return isHighSchoolGrade(grade);
}

/**
 * Shown in place of the wishlist/sizes fields for a grade-9-12 child. No
 * store/date here on purpose — the counselor tells each family those details
 * directly, closer to Christmas, rather than the form naming a specific store
 * and date that could change or go stale on an old link.
 */
function ShopDayNote({ locale }: { locale: string }) {
  if (locale === "es") {
    return (
      <div className="mt-4 rounded-xl border border-cat-blue/30 bg-cat-blue/5 p-4 text-sm text-ink-secondary">
        <p className="font-semibold text-ink-primary">Este niño o niña compra sus propios regalos.</p>
        <p className="mt-1">
          Los estudiantes de preparatoria eligen sus propios regalos en un día de compras en una
          tienda, así que no necesitamos una lista de deseos ni tallas para ellos aquí. El
          consejero de su escuela se pondrá en contacto con los detalles del día de compras más
          cerca de la Navidad.
        </p>
        <p className="mt-1">Solo necesitamos su primer nombre, edad y grado, como arriba.</p>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-cat-blue/30 bg-cat-blue/5 p-4 text-sm text-ink-secondary">
      <p className="font-semibold text-ink-primary">This child shops for their own gifts.</p>
      <p className="mt-1">
        High schoolers pick out their own gifts at a store shopping day, so we don&apos;t need a
        wish list or sizes for them here. Your school counselor will reach out with the shopping
        day details closer to Christmas.
      </p>
      <p className="mt-1">Just their first name, age, and grade above is all we need.</p>
    </div>
  );
}

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
            ? t(definition.locale, "There's one answer to fix", "Hay una respuesta que corregir")
            : t(
                definition.locale,
                `There are ${errors.length} answers to fix`,
                `Hay ${errors.length} respuestas que corregir`
              )
          : t(definition.locale, "We couldn't send your registration", "No pudimos enviar su registro")}
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
 * "children[1].age" -> "Child 2: Age". Turns a machine-addressed error path
 * into the words on the family's screen, so the summary says where to look
 * without the page keeping a second map of the questionnaire.
 */
function describeFieldPath(definition: IntakeFormDefinition, path: string): string {
  if (path === LIVES_TOGETHER_FIELD) return livesTogetherLabel(definition.locale);

  const match = /^([a-z0-9_]+)(?:\[(\d+)\])?(?:\.([a-z0-9_]+))?(?:\[(\d+)\])?$/i.exec(path);
  if (!match) return t(definition.locale, "This form", "Este formulario");
  const [, sectionId, itemIndex, fieldId, listIndex] = match;

  const section = definition.sections.find((s) => s.id === sectionId);
  if (!section) return t(definition.locale, "This form", "Este formulario");

  const prefix =
    itemIndex !== undefined
      ? `${section.itemLabel ?? t(definition.locale, "Child", "Niño o niña")} ${Number(itemIndex) + 1}`
      : section.title;

  if (!fieldId) return prefix;

  const field =
    section.fields.find((f) => f.id === fieldId) ??
    section.fields.find((f) => f.otherField === fieldId);
  const fieldLabel = field
    ? field.id === fieldId
      ? field.label
      : `${field.label} (${t(definition.locale, "description", "descripción")})`
    : fieldId;

  const suffix =
    listIndex !== undefined && field?.itemLabels
      ? // "Idea" is spelled the same in English and Spanish, so no t() needed.
        `, ${field.itemLabels[Number(listIndex)] ?? `Idea ${Number(listIndex) + 1}`}`
      : "";

  return `${prefix}: ${fieldLabel}${suffix}`;
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
  const heading =
    definition.confirmation?.heading ??
    t(definition.locale, "Thank you. Your registration is in.", "Gracias. Su registro ha sido recibido.");
  const body =
    definition.confirmation?.body ??
    t(
      definition.locale,
      "Your registration is with your school counselor now. They'll confirm it and pass it along to OneLife Church. You will receive further information via the email you provided. If you do not have an email, your counselor will relay further information.",
      "Su registro ya está con el consejero de su escuela. Él o ella lo confirmará y lo enviará a OneLife Church. Recibirá más información por el correo electrónico que proporcionó. Si no tiene correo electrónico, su consejero le compartirá la información."
    );

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
            {t(
              definition.locale,
              `Your counselor at ${schoolName} will confirm it.`,
              `El consejero de ${schoolName} lo confirmará.`
            )}
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
