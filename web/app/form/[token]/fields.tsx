"use client";

import type { IntakeFormField } from "@/lib/intake";

// The controls the public family form is built from (US-21).
//
// Every one of them is `<label htmlFor>` + a separate control. Nothing here
// wraps a <select> inside its <label> — that pattern is what made the
// control's accessible name the concatenation of all 27 shoe sizes and broke
// the suite in US-18.
//
// Sizing is deliberately bigger than the admin forms: 16px text (below that,
// iOS Safari zooms the whole page when the field takes focus) and ~48px tall
// controls, because this form is filled one-handed on a phone.
//
// ---------------------------------------------------------------------------
// No `maxLength` on any control, deliberately
// ---------------------------------------------------------------------------
// The definition's `max_length` is a REJECTION rule here, never a truncation
// one. `maxLength` on an <input> silently drops the tail of a pasted value:
// a 95-character name becomes an 84-character one with no keystroke refused,
// no message, and nothing on screen that looks wrong. This is the form where a
// child's name is first written down — everything downstream (the counselor's
// roster, the imported family, the printed card) inherits whatever it records.
// Quietly shortening that name corrupts the record at the source, before any
// human review can catch it, which is a worse failure than refusing the value.
//
// So the value is accepted exactly as typed, and the cap is surfaced twice:
//   * live, by LengthNotice, while the person is still looking at the field;
//   * at submit, by validateAnswers() in validate.ts, as a field-addressed
//     error that the page's error summary lists and links to — the same path
//     shape submit_form returns, so the client and server messages render
//     through one code path.

const CONTROL_BASE =
  "w-full rounded-lg border bg-surface px-3 py-3 text-base text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-cat-blue";

function controlClass(hasError: boolean, extra = ""): string {
  return `${CONTROL_BASE} ${hasError ? "border-status-critical" : "border-border"} ${extra}`.trim();
}

/**
 * A stable DOM id for an answer path — "children[0].wishlist[0]" becomes
 * "f-children-0-wishlist-0". Server validation errors come back addressed by
 * that same path, so the error summary can focus the exact input that failed
 * without the page keeping a second index of its own.
 */
export function fieldDomId(path: string): string {
  return `f-${path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "")}`;
}

/** Fields that want the full width of the section grid rather than half. */
export function isWideField(field: IntakeFormField): boolean {
  return field.type === "textarea" || field.type === "text_list" || field.type === "checkbox";
}

/**
 * The answer path of a select's "Other (describe)" companion input:
 * "children[0].shirt_size" -> "children[0].shirt_size_other". Exported because
 * the page has to clear the error on that path too when the select moves off
 * "Other".
 */
export function otherFieldPath(path: string, otherField: string): string {
  return path.replace(/[^.\]]+$/, otherField);
}

function RequiredMark({ required, label }: { required: boolean; label: string }) {
  if (required) {
    // The control carries `aria-required`, so this is a visual cue only and is
    // hidden from screen readers rather than read as "star" on every field.
    return (
      <span aria-hidden="true" className="ml-0.5 text-status-critical">
        *
      </span>
    );
  }
  // Some definitions already say "(optional)" in the label itself
  // ("Email address (optional)"), which is the wording the family sees and the
  // wording the server validates against — so don't print it twice.
  if (/\(optional\)\s*$/i.test(label)) return null;
  return <span className="ml-1.5 text-sm font-normal text-ink-muted">(optional)</span>;
}

export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p
      id={id}
      className="mt-2 rounded-md bg-status-critical/10 px-2.5 py-1.5 text-sm font-medium text-ink-primary"
    >
      {message}
    </p>
  );
}

/** The id LengthNotice renders under, so a control can point `aria-describedby` at it. */
function lengthNoticeId(domId: string): string {
  return `${domId}-length`;
}

/** The value's length when it's over the definition's cap, else null. */
function overLength(value: string, maxLength: number | undefined): number | null {
  if (!maxLength) return null;
  const length = value.trim().length;
  return length > maxLength ? length : null;
}

/**
 * Live "this is too long" notice, shown the moment a value goes over the
 * definition's cap and read out once by assistive tech when it appears.
 *
 * It exists because nothing truncates any more (see the header): without it,
 * someone could paste 600 characters into a 500-character box and not find out
 * until they pressed Submit and got bounced to the summary. Amber, not red —
 * it's a "you'll need to shorten this", not yet a failed submit — but on an
 * ink-primary foreground, so it still clears AA.
 *
 * The wrapper renders unconditionally: a live region has to be in the DOM
 * before its content changes or the change isn't announced.
 */
function LengthNotice({
  domId,
  value,
  maxLength,
}: {
  domId: string;
  value: string;
  maxLength?: number;
}) {
  const length = overLength(value, maxLength);
  return (
    <div aria-live="polite">
      {length !== null ? (
        <p
          id={lengthNoticeId(domId)}
          className="mt-2 rounded-md bg-status-warning/20 px-2.5 py-1.5 text-sm font-medium text-ink-primary"
        >
          That&apos;s {length} characters. Please shorten it to {maxLength} or fewer.
        </p>
      ) : null}
    </div>
  );
}

function FieldShell({
  domId,
  label,
  help,
  required,
  error,
  children,
}: {
  domId: string;
  label: string;
  help?: string;
  required: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={domId} className="block text-base font-medium text-ink-primary">
        {label}
        <RequiredMark required={required} label={label} />
      </label>
      {help ? (
        <p id={`${domId}-help`} className="mt-1 text-sm text-ink-secondary">
          {help}
        </p>
      ) : null}
      <div className="mt-2">{children}</div>
      {error ? <FieldError id={`${domId}-error`} message={error} /> : null}
    </div>
  );
}

function describedBy(
  domId: string,
  help: boolean,
  error: boolean,
  tooLong = false
): string | undefined {
  const ids = [
    help ? `${domId}-help` : null,
    error ? `${domId}-error` : null,
    tooLong ? lengthNoticeId(domId) : null,
  ].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export interface IntakeFieldProps {
  field: IntakeFormField;
  /** Answer path for this field, e.g. "family.guardian_phone". */
  path: string;
  /** The answer object this field lives in (the section, or one child). */
  values: Record<string, unknown>;
  /**
   * Writes one or more keys of that object at once. Keys stay snake_case —
   * see lib/intake.ts; `answers` is the stored provenance record and must not
   * be renamed at the boundary.
   *
   * It takes a whole patch rather than a single key because of the "Other"
   * rule: moving a size select OFF "Other" has to write the select AND blank
   * the companion `_other` value in the same update, or the server rejects the
   * submission on a field the family can no longer see.
   */
  onPatch: (patch: Record<string, unknown>) => void;
  /** Validation messages by answer path, from the client pass or the server. */
  errors: Map<string, string>;
  /** `field.help` with {budget} already resolved by the caller. */
  help?: string;
}

export function IntakeField(props: IntakeFieldProps) {
  const { field, path, values, onPatch, errors, help } = props;
  const domId = fieldDomId(path);
  const error = errors.get(path);
  const required = Boolean(field.required);
  const raw = values[field.id];
  const text = typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw);

  if (field.type === "checkbox") {
    return (
      <div>
        <div className="flex items-start gap-3">
          <input
            id={domId}
            type="checkbox"
            checked={raw === true}
            aria-required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(domId, Boolean(help), Boolean(error))}
            onChange={(e) => onPatch({ [field.id]: e.target.checked })}
            className={`mt-0.5 h-6 w-6 shrink-0 rounded border ${
              error ? "border-status-critical" : "border-border"
            } accent-cat-blue focus:outline-none focus:ring-2 focus:ring-cat-blue`}
          />
          <label htmlFor={domId} className="text-base text-ink-primary">
            {field.label}
            {required ? (
              <span aria-hidden="true" className="ml-0.5 text-status-critical">
                *
              </span>
            ) : null}
          </label>
        </div>
        {help ? (
          <p id={`${domId}-help`} className="mt-1 pl-9 text-sm text-ink-secondary">
            {help}
          </p>
        ) : null}
        {error ? (
          <div className="pl-9">
            <FieldError id={`${domId}-error`} message={error} />
          </div>
        ) : null}
      </div>
    );
  }

  if (field.type === "text_list") {
    return <TextListField {...props} />;
  }

  if (field.type === "select") {
    const otherValue = field.otherValue ?? "Other";
    const otherSelected = Boolean(field.otherField) && text !== "" && text === otherValue;
    const otherPath = field.otherField ? otherFieldPath(path, field.otherField) : "";
    const otherDomId = otherPath ? fieldDomId(otherPath) : "";
    const otherError = otherPath ? errors.get(otherPath) : undefined;
    const otherRaw = field.otherField ? values[field.otherField] : "";

    // Moving OFF "Other" blanks the companion input in the same patch.
    //
    // This is not tidiness. submit_form rejects a non-blank `_other` sitting
    // next to a select whose value is not the "Other" option — it was an
    // injection path onto the public sponsor card — so a leftover value here
    // would come back as a validation error on an input the family can no
    // longer see, with no way to fix it.
    function handleSelect(next: string) {
      if (field.otherField && next !== otherValue) {
        onPatch({ [field.id]: next, [field.otherField]: "" });
      } else {
        onPatch({ [field.id]: next });
      }
    }

    return (
      <div>
        <FieldShell domId={domId} label={field.label} help={help} required={required} error={error}>
          <select
            id={domId}
            value={text}
            aria-required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(domId, Boolean(help), Boolean(error))}
            onChange={(e) => handleSelect(e.target.value)}
            className={controlClass(Boolean(error))}
          >
            <option value="">Choose one…</option>
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldShell>

        {otherSelected && field.otherField ? (
          <OtherDescribeField
            domId={otherDomId}
            label={field.label}
            // 80 is validate.ts's and intake_validate_field()'s shared fallback
            // for a companion field the definition gives no cap of its own.
            maxLength={field.maxLength ?? 80}
            value={typeof otherRaw === "string" ? otherRaw : ""}
            error={otherError}
            onChange={(next) => onPatch({ [field.otherField!]: next })}
          />
        ) : null}
      </div>
    );
  }

  if (field.type === "textarea") {
    const tooLong = overLength(text, field.maxLength) !== null;
    return (
      <FieldShell domId={domId} label={field.label} help={help} required={required} error={error}>
        <textarea
          id={domId}
          rows={3}
          value={text}
          aria-required={required}
          aria-invalid={error || tooLong ? true : undefined}
          aria-describedby={describedBy(domId, Boolean(help), Boolean(error), tooLong)}
          onChange={(e) => onPatch({ [field.id]: e.target.value })}
          className={controlClass(Boolean(error))}
        />
        <LengthNotice domId={domId} value={text} maxLength={field.maxLength} />
      </FieldShell>
    );
  }

  if (field.type === "number") {
    return (
      <FieldShell domId={domId} label={field.label} help={help} required={required} error={error}>
        <input
          id={domId}
          type="number"
          inputMode="numeric"
          step={1}
          min={field.min}
          max={field.max}
          value={text}
          aria-required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(domId, Boolean(help), Boolean(error))}
          onChange={(e) => onPatch({ [field.id]: e.target.value })}
          className={controlClass(Boolean(error), "max-w-[10rem]")}
        />
      </FieldShell>
    );
  }

  // text | phone | email
  const inputType = field.type === "phone" ? "tel" : field.type === "email" ? "email" : "text";
  const autoComplete =
    field.type === "phone" ? "tel" : field.type === "email" ? "email" : autoCompleteFor(field.id);
  const tooLong = overLength(text, field.maxLength) !== null;

  return (
    <FieldShell domId={domId} label={field.label} help={help} required={required} error={error}>
      <input
        id={domId}
        type={inputType}
        inputMode={field.type === "phone" ? "tel" : undefined}
        autoComplete={autoComplete}
        value={text}
        aria-required={required}
        aria-invalid={error || tooLong ? true : undefined}
        aria-describedby={describedBy(domId, Boolean(help), Boolean(error), tooLong)}
        onChange={(e) => onPatch({ [field.id]: e.target.value })}
        className={controlClass(Boolean(error))}
      />
      <LengthNotice domId={domId} value={text} maxLength={field.maxLength} />
    </FieldShell>
  );
}

/**
 * The companion input for a select's "Other" option.
 *
 * A component rather than inline JSX so it can carry a LengthNotice of its own
 * — its cap is the one place on this form where the bound isn't the field's
 * own `max_length` but the 80-character fallback both validators apply.
 */
function OtherDescribeField({
  domId,
  label,
  maxLength,
  value,
  error,
  onChange,
}: {
  domId: string;
  label: string;
  maxLength: number;
  value: string;
  error?: string;
  onChange: (next: string) => void;
}) {
  const tooLong = overLength(value, maxLength) !== null;
  return (
    <div className="mt-3">
      <label htmlFor={domId} className="block text-base font-medium text-ink-primary">
        {label} — please describe
      </label>
      <input
        id={domId}
        type="text"
        value={value}
        aria-invalid={error || tooLong ? true : undefined}
        aria-describedby={describedBy(domId, false, Boolean(error), tooLong)}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-2 ${controlClass(Boolean(error))}`}
      />
      {error ? <FieldError id={`${domId}-error`} message={error} /> : null}
      <LengthNotice domId={domId} value={value} maxLength={maxLength} />
    </div>
  );
}

// Only the guardian's own name is autofillable — a child's first name is not
// the phone owner's name, so it deliberately gets no autocomplete hint.
function autoCompleteFor(fieldId: string): string | undefined {
  return fieldId === "guardian_name" ? "name" : undefined;
}

/**
 * The wishlist: up to `maxItems` short text inputs, the first required.
 *
 * Only the first box shows initially — three stacked inputs per child is a lot
 * of scrolling on a phone for two optional answers — with an explicit "add
 * another" up to the definition's maximum.
 */
function TextListField({ field, path, values, onPatch, errors, help }: IntakeFieldProps) {
  const maxItems = field.maxItems ?? 3;
  const stored = Array.isArray(values[field.id]) ? (values[field.id] as unknown[]) : [];
  const items = stored.map((item) => (typeof item === "string" ? item : ""));
  const visible = items.length > 0 ? items : [""];
  const labels = field.itemLabels ?? [];
  const groupError = errors.get(path);

  function setItem(index: number, value: string) {
    const next = [...visible];
    next[index] = value;
    onPatch({ [field.id]: next });
  }

  return (
    <fieldset>
      <legend className="text-base font-medium text-ink-primary">
        {field.label}
        <RequiredMark required={Boolean(field.required)} label={field.label} />
      </legend>
      {help ? <p className="mt-1 text-sm text-ink-secondary">{help}</p> : null}

      <div className="mt-2 space-y-3">
        {visible.map((item, index) => {
          const itemPath = `${path}[${index}]`;
          const itemDomId = fieldDomId(itemPath);
          const itemError = errors.get(itemPath);
          const tooLong = overLength(item, field.maxLength) !== null;
          return (
            <div key={index}>
              <label htmlFor={itemDomId} className="block text-sm text-ink-secondary">
                {labels[index] ?? `Idea ${index + 1}`}
              </label>
              <input
                id={itemDomId}
                type="text"
                value={item}
                aria-invalid={itemError || tooLong ? true : undefined}
                aria-describedby={describedBy(itemDomId, false, Boolean(itemError), tooLong)}
                onChange={(e) => setItem(index, e.target.value)}
                className={`mt-1 ${controlClass(Boolean(itemError))}`}
              />
              {itemError ? <FieldError id={`${itemDomId}-error`} message={itemError} /> : null}
              <LengthNotice domId={itemDomId} value={item} maxLength={field.maxLength} />
            </div>
          );
        })}
      </div>

      {groupError ? <FieldError id={`${fieldDomId(path)}-error`} message={groupError} /> : null}

      {visible.length < maxItems ? (
        <button
          type="button"
          onClick={() => onPatch({ [field.id]: [...visible, ""] })}
          className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary focus:outline-none focus:ring-2 focus:ring-cat-blue"
        >
          + Add another idea
        </button>
      ) : null}
    </fieldset>
  );
}
