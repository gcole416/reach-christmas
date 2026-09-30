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

/** Written verbatim into `form_versions.definition`. */
export const PHASE_1_FORM_DEFINITION = {
  schema_version: 1,
  locale: "en",
  title: "Reach Christmas Gift Registration",
  intro:
    "We're glad you're here. Fill this out once for your household, adding each child who lives with you. Your school counselor will confirm it with us.\n\nIf your children attend different schools and you receive this link from more than one counselor, please fill out only one form for your whole household.\n\nThis takes about five minutes. We only ask for the children's first names, and we never ask for your address.",
  help_footer: "Questions? Contact your school counselor.",
  privacy_note:
    "Sponsors who provide gifts see your child's first name, grade, sizes, wish list, and any specific needs. They never see your last name, address, or contact information, and they have no way to contact you. Only your school counselor follows up about your registration.",
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
      title: "Delivery and consent",
      help: "We'll deliver your child's gift(s) directly to your school before Christmas. Your school counselor will coordinate with your family on how you'll receive them.",
      fields: [
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

/**
 * The Spanish sibling of PHASE_1_FORM_DEFINITION — same field `id`s and option
 * `value`s throughout (those feed submit_form's validation and
 * import_submission's column mapping and must stay language-agnostic; only
 * `label`/`help`/`title`/`intro`/etc. text is translated). Draft translation —
 * per DESIGN.md/INTAKE_FORMS.md §4.4 this needs a native or fluent Spanish
 * speaker on staff to review before it goes to a real family.
 *
 * Two ways this reaches a family:
 *   1. The English/Español toggle web/app/form/[token]/FamilyForm.tsx renders
 *      at the top of every form — the primary path. One link, either locale;
 *      the family swaps live. Safe because the two definitions are
 *      structurally identical, so the swap never changes what gets validated.
 *   2. A Spanish-pinned form_version a school link can point to directly
 *      (published via supabase/publish_intake_form_es.sql), for a counselor
 *      who wants to hand out a Spanish-only link. Not required for #1 to work.
 *
 * Mirrored byte-for-byte in supabase/publish_intake_form_es.sql and the
 * Spanish block of supabase/intake_demo_seed.sql, same as the English
 * definition above — change one, change all three.
 */
export const PHASE_1_FORM_DEFINITION_ES = {
  schema_version: 1,
  locale: "es",
  title: "Registro de Regalos de Reach Christmas",
  intro:
    "Nos alegra que esté aquí. Complete este formulario una vez por su hogar, agregando a cada niño o niña que vive con usted. El consejero de su escuela lo confirmará con nosotros.\n\nSi sus hijos asisten a escuelas diferentes y recibe este enlace de más de un consejero, por favor complete un solo formulario para todo su hogar.\n\nEsto toma unos cinco minutos. Solo pedimos los primeros nombres de los niños y nunca pedimos su dirección.",
  help_footer: "¿Preguntas? Comuníquese con el consejero de su escuela.",
  privacy_note:
    "Los patrocinadores que donan los regalos ven el primer nombre de su hijo o hija, el grado, las tallas, la lista de deseos y cualquier necesidad específica. Nunca ven su apellido, dirección ni información de contacto, y no tienen ninguna forma de comunicarse con usted. Solo el consejero de su escuela le dará seguimiento a su registro.",
  submit_label: "Enviar registro",
  confirmation: {
    heading: "Gracias. Su registro ha sido recibido.",
    body: "Su registro ya está con el consejero de su escuela. Él o ella lo confirmará y lo enviará a OneLife Church. Recibirá más información por el correo electrónico que proporcionó. Si no tiene correo electrónico, su consejero le compartirá la información.",
  },
  budget_per_child: "$50",
  honeypot_field: "favorite_color",
  sections: [
    {
      id: "family",
      title: "Sobre su hogar",
      fields: [
        {
          id: "guardian_name",
          label: "Nombre del padre, madre o tutor",
          help: "Basta con un nombre. La persona por quien debemos preguntar al momento de la entrega.",
          type: "text",
          required: true,
          max_length: 120,
        },
        {
          id: "guardian_phone",
          label: "Número de teléfono",
          help: "Para poder comunicarnos con usted sobre la entrega en diciembre.",
          type: "phone",
          required: true,
          max_length: 40,
        },
        {
          id: "guardian_email",
          label: "Correo electrónico",
          help: "Enviamos las actualizaciones de su registro a este correo. Si no tiene uno, pídale a su consejero escolar que agregue el suyo para que podamos comunicarnos con usted.",
          type: "email",
          required: true,
          max_length: 200,
        },
        {
          id: "preferred_language",
          label: "¿En qué idioma preferiría que nos comuniquemos con usted?",
          type: "select",
          required: true,
          options: [
            { value: "en", label: "Inglés" },
            { value: "es", label: "Español" },
          ],
        },
      ],
    },
    {
      id: "children",
      title: "Niños en su hogar",
      repeating: true,
      min_items: 1,
      max_items: 10,
      item_label: "Niño o niña",
      add_label: "Agregar otro niño o niña",
      remove_label: "Eliminar este niño o niña",
      fields: [
        {
          id: "first_name",
          label: "Nombre del niño o niña",
          type: "text",
          required: true,
          max_length: 80,
        },
        {
          id: "age",
          label: "Edad",
          type: "number",
          required: true,
          min: 0,
          max: 19,
        },
        {
          id: "grade",
          label: "Grado escolar",
          type: "select",
          required: true,
          options: [
            { value: "Not in school yet", label: "Aún no va a la escuela" },
            { value: "Pre-K", label: "Pre-Kínder" },
            { value: "K", label: "Kínder" },
            { value: "1", label: "1er grado" },
            { value: "2", label: "2do grado" },
            { value: "3", label: "3er grado" },
            { value: "4", label: "4to grado" },
            { value: "5", label: "5to grado" },
            { value: "6", label: "6to grado" },
            { value: "7", label: "7mo grado" },
            { value: "8", label: "8vo grado" },
            { value: "9", label: "9no grado" },
            { value: "10", label: "10mo grado" },
            { value: "11", label: "11mo grado" },
            { value: "12", label: "12mo grado" },
          ],
        },
        {
          id: "sex",
          label: "Niño o niña",
          type: "select",
          required: true,
          self_shopper_hidden: true,
          options: [
            { value: "M", label: "Niño" },
            { value: "F", label: "Niña" },
            { value: "Prefer not to say", label: "Prefiero no decir" },
          ],
        },
        {
          id: "shirt_size",
          label: "Talla de camisa",
          type: "select",
          required: true,
          self_shopper_hidden: true,
          other_field: "shirt_size_other",
          other_value: "Other",
          max_length: 80,
          options: [
            { value: "Youth XS", label: "Juvenil XS" },
            { value: "Youth S", label: "Juvenil S" },
            { value: "Youth M", label: "Juvenil M" },
            { value: "Youth L", label: "Juvenil L" },
            { value: "Youth XL", label: "Juvenil XL" },
            { value: "Adult XS", label: "Adulto XS" },
            { value: "Adult S", label: "Adulto S" },
            { value: "Adult M", label: "Adulto M" },
            { value: "Adult L", label: "Adulto L" },
            { value: "Adult XL", label: "Adulto XL" },
            { value: "Adult XXL", label: "Adulto XXL" },
            { value: "Other", label: "Otro (describa)" },
          ],
        },
        {
          id: "pant_size",
          label: "Talla de pantalón",
          type: "select",
          required: true,
          self_shopper_hidden: true,
          other_field: "pant_size_other",
          other_value: "Other",
          max_length: 80,
          options: [
            { value: "Youth 4", label: "Juvenil 4" },
            { value: "Youth 6", label: "Juvenil 6" },
            { value: "Youth 8", label: "Juvenil 8" },
            { value: "Youth 10", label: "Juvenil 10" },
            { value: "Youth 12", label: "Juvenil 12" },
            { value: "Youth 14", label: "Juvenil 14" },
            { value: "Youth 16", label: "Juvenil 16" },
            { value: "Youth 18", label: "Juvenil 18" },
            { value: "Youth 20", label: "Juvenil 20" },
            { value: "Adult waist 28", label: "Adulto cintura 28" },
            { value: "Adult waist 30", label: "Adulto cintura 30" },
            { value: "Adult waist 32", label: "Adulto cintura 32" },
            { value: "Adult waist 34", label: "Adulto cintura 34" },
            { value: "Adult waist 36", label: "Adulto cintura 36" },
            { value: "Adult waist 38", label: "Adulto cintura 38" },
            { value: "Adult waist 40", label: "Adulto cintura 40" },
            { value: "Adult waist 42", label: "Adulto cintura 42" },
            { value: "Adult waist 44", label: "Adulto cintura 44" },
            { value: "Other", label: "Otro (describa)" },
          ],
        },
        {
          id: "shoe_size",
          label: "Talla de zapato",
          type: "select",
          required: true,
          self_shopper_hidden: true,
          other_field: "shoe_size_other",
          other_value: "Other",
          max_length: 80,
          options: [
            { value: "Toddler 5", label: "Infantil 5" },
            { value: "Toddler 6", label: "Infantil 6" },
            { value: "Toddler 7", label: "Infantil 7" },
            { value: "Toddler 8", label: "Infantil 8" },
            { value: "Toddler 9", label: "Infantil 9" },
            { value: "Toddler 10", label: "Infantil 10" },
            { value: "Toddler 11", label: "Infantil 11" },
            { value: "Toddler 12", label: "Infantil 12" },
            { value: "Toddler 13", label: "Infantil 13" },
            { value: "Youth 1", label: "Juvenil 1" },
            { value: "Youth 2", label: "Juvenil 2" },
            { value: "Youth 3", label: "Juvenil 3" },
            { value: "Youth 4", label: "Juvenil 4" },
            { value: "Youth 5", label: "Juvenil 5" },
            { value: "Youth 6", label: "Juvenil 6" },
            { value: "Youth 7", label: "Juvenil 7" },
            { value: "Adult 5", label: "Adulto 5" },
            { value: "Adult 6", label: "Adulto 6" },
            { value: "Adult 7", label: "Adulto 7" },
            { value: "Adult 8", label: "Adulto 8" },
            { value: "Adult 9", label: "Adulto 9" },
            { value: "Adult 10", label: "Adulto 10" },
            { value: "Adult 11", label: "Adulto 11" },
            { value: "Adult 12", label: "Adulto 12" },
            { value: "Adult 13", label: "Adulto 13" },
            { value: "Adult 14", label: "Adulto 14" },
            { value: "Other", label: "Otro (describa)" },
          ],
        },
        {
          id: "wishlist",
          label: "¿Qué le gustaría recibir en Navidad?",
          help: "Hasta 3 ideas. Sea lo más específico posible: la marca, el color o la talla ayudan mucho. Los regalos suelen costar alrededor de {budget} por niño.",
          type: "text_list",
          required: true,
          self_shopper_hidden: true,
          min_items: 1,
          max_items: 3,
          first_required: true,
          max_length: 200,
          item_labels: [
            "Primera idea",
            "Segunda idea (opcional)",
            "Tercera idea (opcional)",
          ],
        },
        {
          id: "specific_needs",
          label: "¿Hay algo que necesiten especialmente?",
          type: "textarea",
          required: false,
          self_shopper_hidden: true,
          max_length: 500,
        },
        {
          id: "other_notes",
          label: "¿Algo más que debamos saber?",
          type: "textarea",
          required: false,
          self_shopper_hidden: true,
          max_length: 500,
        },
      ],
    },
    {
      id: "pickup_consent",
      title: "Entrega y consentimiento",
      help: "Entregaremos el regalo o los regalos de su hijo o hija directamente a su escuela antes de Navidad. El consejero de su escuela coordinará con su familia cómo los recibirán.",
      fields: [
        {
          id: "consent",
          label:
            "Entiendo que la información de mi hogar será compartida con OneLife Church y sus voluntarios.",
          type: "checkbox",
          required: true,
        },
      ],
    },
  ],
} as const;
