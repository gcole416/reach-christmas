import type {
  IntakeAnswers,
  IntakeFieldError,
  IntakeFormDefinition,
  IntakeFormField,
} from "@/lib/intake";
import { isHighSchoolGrade } from "@/lib/queries";

// A client-side mirror of `submit_form`'s validation, kept deliberately thin.
//
// This is a CONVENIENCE, not a control: the server re-runs every one of these
// rules against the pinned definition regardless of what happens here (US-20),
// and its `fieldErrors` come back addressed by the same paths this produces
// ("family.guardian_phone", "children[0].age", "children[0].wishlist[0]"), so
// the page renders both through one code path.
//
// It exists because the alternative — a round trip before a parent learns they
// left the phone number blank — is a bad experience on a phone, and because
// the definition already carries everything needed to check it locally.
//
// Where the two could ever disagree, the server wins and its message is what
// gets shown. Nothing here is allowed to BLOCK a submission the server would
// have accepted, so every rule below is a strict subset of the SQL in
// intake_validate_field().

export function validateAnswers(
  definition: IntakeFormDefinition,
  answers: IntakeAnswers
): IntakeFieldError[] {
  const errors: IntakeFieldError[] = [];

  for (const section of definition.sections) {
    if (section.repeating) {
      const items = (answers as Record<string, unknown>)[section.id];
      const children = Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
      const minItems = section.minItems ?? 1;
      const maxItems = section.maxItems ?? 10;

      if (children.length < minItems) {
        errors.push({ field: section.id, message: "Please add at least one child." });
        continue;
      }
      if (children.length > maxItems) {
        errors.push({
          field: section.id,
          message: `Please register no more than ${maxItems} children on one form.`,
        });
        continue;
      }
      children.forEach((child, index) => {
        // A grade-9-12 child self-shops: the gift fields aren't shown or
        // collected, and submit_form skips validating them (US-32). Mirror
        // that here so the client doesn't block a submission the server takes.
        const selfShopper = isHighSchoolGrade(
          typeof (child as Record<string, unknown>)?.grade === "string"
            ? ((child as Record<string, unknown>).grade as string)
            : undefined,
        );
        for (const field of section.fields) {
          if (selfShopper && field.selfShopperHidden) continue;
          validateField(field, child ?? {}, `${section.id}[${index}].`, errors);
        }
      });
    } else {
      const raw = (answers as Record<string, unknown>)[section.id];
      const values = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      for (const field of section.fields) {
        validateField(field, values, `${section.id}.`, errors);
      }
    }
  }

  return errors;
}

function validateField(
  field: IntakeFormField,
  values: Record<string, unknown>,
  prefix: string,
  errors: IntakeFieldError[]
): void {
  const path = `${prefix}${field.id}`;
  const raw = values[field.id];
  const label = field.label || field.id;

  if (field.type === "checkbox") {
    if (field.required && raw !== true) {
      errors.push({ field: path, message: "Please check this box to continue." });
    }
    return;
  }

  if (field.type === "text_list") {
    const minItems = field.minItems ?? (field.required ? 1 : 0);
    const maxItems = field.maxItems ?? 3;
    const list = Array.isArray(raw) ? raw : [];
    const strings = list.map((item) => (typeof item === "string" ? item.trim() : ""));

    if (list.length > maxItems) {
      errors.push({ field: path, message: `Please list no more than ${maxItems} ideas.` });
      return;
    }
    strings.forEach((item, index) => {
      if (item && field.maxLength && item.length > field.maxLength) {
        errors.push({
          field: `${path}[${index}]`,
          message: `Please keep each idea under ${field.maxLength} characters.`,
        });
      }
    });
    const filled = strings.filter(Boolean).length;
    if (filled < minItems) {
      errors.push({ field: `${path}[0]`, message: "Please add at least one idea." });
    } else if (field.firstRequired && !strings[0]) {
      errors.push({
        field: `${path}[0]`,
        message: "Please fill in the first idea before adding others.",
      });
    }
    return;
  }

  const text = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();

  // The "Other (describe)" companion, checked before the empty-value return so
  // a stale value can't slip through on a blank select. The form clears it on
  // every select change (see fields.tsx), so this should never fire — it is
  // here so that if it ever does, the family sees a sentence rather than the
  // server's rejection of a field that is no longer on screen.
  if (field.otherField) {
    const otherValue = field.otherValue ?? "Other";
    const otherRaw = values[field.otherField];
    const otherText = typeof otherRaw === "string" ? otherRaw.trim() : "";
    const otherPath = `${prefix}${field.otherField}`;
    const maxOther = field.maxLength ?? 80;
    if (text === otherValue) {
      if (!otherText) {
        errors.push({ field: otherPath, message: `Please describe the ${label.toLowerCase()}.` });
      } else if (otherText.length > maxOther) {
        errors.push({
          field: otherPath,
          message: `Please keep that under ${maxOther} characters.`,
        });
      }
    } else if (otherText) {
      errors.push({
        field: otherPath,
        message: `Choose "${otherValue}" for ${label.toLowerCase()} to describe it, or clear this box.`,
      });
    }
  }

  if (!text) {
    if (field.required) {
      errors.push({ field: path, message: `${label} is required.` });
    }
    return;
  }

  if (field.maxLength && text.length > field.maxLength) {
    errors.push({
      field: path,
      message: `Please keep ${label} under ${field.maxLength} characters.`,
    });
    return;
  }

  if (field.type === "number") {
    if (!/^-?\d{1,9}$/.test(text)) {
      errors.push({ field: path, message: `${label} must be a whole number.` });
      return;
    }
    const value = Number(text);
    const min = field.min;
    const max = field.max;
    if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
      errors.push({
        field: path,
        message: `${label} must be between ${min ?? "?"} and ${max ?? "?"}.`,
      });
    }
    return;
  }

  if (field.type === "select" && field.options) {
    if (!field.options.some((option) => option.value === text)) {
      errors.push({ field: path, message: `Please choose one of the listed options for ${label}.` });
    }
    return;
  }

  if (field.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) {
    errors.push({
      field: path,
      message: "Please enter a valid email address, or leave it blank.",
    });
  }
}
