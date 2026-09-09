// The canonical Phase 1 registration questionnaire.
//
// This is the SAME definition as supabase/publish_intake_form.sql and
// supabase/intake_demo_seed.sql — byte-for-byte, deliberately. `import_submission`
// (supabase/migrations/20260830120000_intake_forms.sql) hard-codes almost every
// field id it reads out of `answers` (see the long "PART OF THE IMPORT CONTRACT"
// note in intake_demo_seed.sql). If you change the ids or structure here, change
// them in both SQL files in the same commit, or a real family imports with the
// affected columns silently NULL.
//
// Keys are snake_case because this object is written straight into
// `form_versions.definition` (jsonb) and read back by the server functions
// (get_form / submit_form) exactly as stored. web/lib/intake.ts's
// normalizeDefinition() is what turns it into the camelCase app type for
// rendering — nothing downstream of that sees this shape.

export const INTAKE_FORM_SLUG = "family-intake";
export const INTAKE_FORM_NAME = "Household Gift Registration";
export const INTAKE_FORM_DESCRIPTION =
  "Phase 1 English intake questionnaire. Source: docs/INTAKE_FORM_DRAFT.md";

/**
 * The store and date for the high schooler shopping day (US-32/US-33).
 * PLACEHOLDER pending Grant's confirmation of the 2026 store/date — one string,
 * one place, so swapping in the real values is a one-line edit. Shown to a
 * family only when they set a child's grade to 9-12; not part of the immutable
 * form definition, so changing it needs no new form version.
 */
export const SHOP_DAY_STORE = "[placeholder store]";
export const SHOP_DAY_DATE = "[placeholder date]";

/** Written verbatim into `form_versions.definition`. */
export const PHASE_1_FORM_DEFINITION = {
  schema_version: 1,
  locale: "en",
  title: "Reach Christmas Gift Registration",
  intro:
    "We're glad you're here. Fill this out once for your household, adding each child who lives with you. Your school counselor will confirm it with us.\n\nThis takes about five minutes. We only ask for the children's first names, and we never ask for your address.",
  help_footer: "Questions? Contact your school counselor.",
  privacy_note:
    "Sponsors who provide gifts see your child's first name, grade, sizes, wish list, and any specific needs. They never see your last name or address.",
  submit_label: "Submit registration",
  confirmation: {
    heading: "Thank you. Your registration is in.",
    body: "Your registration is with your school counselor now. They'll confirm it and pass it along to OneLife Church. You will receive further information via the email you provided. If you do not have an email, your counselor will relay further information.",
  },
  budget_per_child: "$50",
  honeypot_field: "favorite_color",
  sections: [
    {
      id: "family",
      title: "About your household",
      fields: [
        {
          id: "guardian_name",
          label: "Parent or guardian name",
          help: "One name is fine. Whoever we should ask for at pickup.",
          type: "text",
          required: true,
          max_length: 120,
        },
        {
          id: "guardian_phone",
          label: "Phone number",
          help: "So we can reach you about pickup in December.",
          type: "phone",
          required: true,
          max_length: 40,
        },
        {
          id: "guardian_email",
          label: "Email address",
          help: "We send registration updates to this email. If you do not have one, ask your school counselor to add theirs so we can reach you.",
          type: "email",
          required: true,
          max_length: 200,
        },
        {
          id: "preferred_language",
          label: "What language should we use to contact you?",
          type: "select",
          required: true,
          options: [
            { value: "en", label: "English" },
            { value: "es", label: "Español" },
          ],
        },
      ],
    },
    {
      id: "children",
      title: "Children in your home",
      repeating: true,
      min_items: 1,
      max_items: 10,
      item_label: "Child",
      add_label: "Add another child",
      remove_label: "Remove this child",
      fields: [
        {
          id: "first_name",
          label: "Child's first name",
          type: "text",
          required: true,
          max_length: 80,
        },
        {
          id: "age",
          label: "Age",
          type: "number",
          required: true,
          min: 0,
          max: 19,
        },
        {
          id: "grade",
          label: "Grade",
          type: "select",
          required: true,
          options: [
            { value: "Not in school yet", label: "Not in school yet" },
            { value: "Pre-K", label: "Pre-K" },
            { value: "K", label: "Kindergarten" },
            { value: "1", label: "1st grade" },
            { value: "2", label: "2nd grade" },
            { value: "3", label: "3rd grade" },
            { value: "4", label: "4th grade" },
            { value: "5", label: "5th grade" },
            { value: "6", label: "6th grade" },
            { value: "7", label: "7th grade" },
            { value: "8", label: "8th grade" },
            { value: "9", label: "9th grade" },
            { value: "10", label: "10th grade" },
            { value: "11", label: "11th grade" },
            { value: "12", label: "12th grade" },
          ],
        },
        {
          id: "sex",
          label: "Boy or girl",
          type: "select",
          required: true,
          self_shopper_hidden: true,
          options: [
            { value: "M", label: "Boy" },
            { value: "F", label: "Girl" },
            { value: "Prefer not to say", label: "Prefer not to say" },
          ],
        },
        {
          id: "shirt_size",
          label: "Shirt size",
          type: "select",
          required: true,
          self_shopper_hidden: true,
          other_field: "shirt_size_other",
          other_value: "Other",
          max_length: 80,
          options: [
            { value: "Youth XS", label: "Youth XS" },
            { value: "Youth S", label: "Youth S" },
            { value: "Youth M", label: "Youth M" },
            { value: "Youth L", label: "Youth L" },
            { value: "Youth XL", label: "Youth XL" },
            { value: "Adult XS", label: "Adult XS" },
            { value: "Adult S", label: "Adult S" },
            { value: "Adult M", label: "Adult M" },
            { value: "Adult L", label: "Adult L" },
            { value: "Adult XL", label: "Adult XL" },
            { value: "Adult XXL", label: "Adult XXL" },
            { value: "Other", label: "Other (describe)" },
          ],
        },
        {
          id: "pant_size",
          label: "Pant size",
          type: "select",
          required: true,
          self_shopper_hidden: true,
          other_field: "pant_size_other",
          other_value: "Other",
          max_length: 80,
          options: [
            { value: "Youth 4", label: "Youth 4" },
            { value: "Youth 6", label: "Youth 6" },
            { value: "Youth 8", label: "Youth 8" },
            { value: "Youth 10", label: "Youth 10" },
            { value: "Youth 12", label: "Youth 12" },
            { value: "Youth 14", label: "Youth 14" },
            { value: "Youth 16", label: "Youth 16" },
            { value: "Youth 18", label: "Youth 18" },
            { value: "Youth 20", label: "Youth 20" },
            { value: "Adult waist 28", label: "Adult waist 28" },
            { value: "Adult waist 30", label: "Adult waist 30" },
            { value: "Adult waist 32", label: "Adult waist 32" },
            { value: "Adult waist 34", label: "Adult waist 34" },
            { value: "Adult waist 36", label: "Adult waist 36" },
            { value: "Adult waist 38", label: "Adult waist 38" },
            { value: "Adult waist 40", label: "Adult waist 40" },
            { value: "Adult waist 42", label: "Adult waist 42" },
            { value: "Adult waist 44", label: "Adult waist 44" },
            { value: "Other", label: "Other (describe)" },
          ],
        },
        {
          id: "shoe_size",
          label: "Shoe size",
          type: "select",
          required: true,
          self_shopper_hidden: true,
          other_field: "shoe_size_other",
          other_value: "Other",
          max_length: 80,
          options: [
            { value: "Toddler 5", label: "Toddler 5" },
            { value: "Toddler 6", label: "Toddler 6" },
            { value: "Toddler 7", label: "Toddler 7" },
            { value: "Toddler 8", label: "Toddler 8" },
            { value: "Toddler 9", label: "Toddler 9" },
            { value: "Toddler 10", label: "Toddler 10" },
            { value: "Toddler 11", label: "Toddler 11" },
            { value: "Toddler 12", label: "Toddler 12" },
            { value: "Toddler 13", label: "Toddler 13" },
            { value: "Youth 1", label: "Youth 1" },
            { value: "Youth 2", label: "Youth 2" },
            { value: "Youth 3", label: "Youth 3" },
            { value: "Youth 4", label: "Youth 4" },
            { value: "Youth 5", label: "Youth 5" },
            { value: "Youth 6", label: "Youth 6" },
            { value: "Youth 7", label: "Youth 7" },
            { value: "Adult 5", label: "Adult 5" },
            { value: "Adult 6", label: "Adult 6" },
            { value: "Adult 7", label: "Adult 7" },
            { value: "Adult 8", label: "Adult 8" },
            { value: "Adult 9", label: "Adult 9" },
            { value: "Adult 10", label: "Adult 10" },
            { value: "Adult 11", label: "Adult 11" },
            { value: "Adult 12", label: "Adult 12" },
            { value: "Adult 13", label: "Adult 13" },
            { value: "Adult 14", label: "Adult 14" },
            { value: "Other", label: "Other (describe)" },
          ],
        },
        {
          id: "wishlist",
          label: "What would they like for Christmas?",
          help: "Up to 3 ideas. Be as specific as you can: brand, color, or size helps a lot. Gifts are usually around {budget} per child.",
          type: "text_list",
          required: true,
          self_shopper_hidden: true,
          min_items: 1,
          max_items: 3,
          first_required: true,
          max_length: 200,
          item_labels: [
            "First idea",
            "Second idea (optional)",
            "Third idea (optional)",
          ],
        },
        {
          id: "specific_needs",
          label: "Is there anything they especially need?",
          type: "textarea",
          required: false,
          self_shopper_hidden: true,
          max_length: 500,
        },
        {
          id: "other_notes",
          label: "Anything else we should know?",
          type: "textarea",
          required: false,
          self_shopper_hidden: true,
          max_length: 500,
        },
      ],
    },
    {
      id: "pickup_consent",
      title: "Pickup and consent",
      fields: [
        {
          id: "can_reach_church_pickup",
          label: "If gifts are distributed at the church, can you get there?",
          type: "select",
          required: true,
          options: [
            { value: "Yes", label: "Yes" },
            { value: "No", label: "No" },
            { value: "Not sure", label: "Not sure" },
          ],
        },
        {
          id: "consent",
          label:
            "I understand my household's information will be shared with OneLife Church and its volunteers.",
          type: "checkbox",
          required: true,
        },
      ],
    },
  ],
} as const;
