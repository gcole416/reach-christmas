-- Publish the Spanish Phase 1 registration questionnaire for the open drive.
--
-- Sibling of supabase/publish_intake_form.sql (see that file for the general
-- rationale — this is the same script, same requirements, same re-run
-- semantics, just for the Spanish definition instead of the English one).
--
-- This is a SEPARATE `forms` row (slug 'family-intake-es'), not a second
-- version of the English form: the two are independent questionnaires a link
-- can be pinned to, distinguished by `form_versions.definition.locale`. Once
-- this has been run once for a drive, "New registration link" in
-- Admin -> Registrations offers a Questionnaire choice between the English
-- and Spanish published versions, and the "Email Spanish registration link"
-- button lights up once a live Spanish link exists for a school.
--
-- Run it in the Supabase SQL editor, on whichever project the drive lives on
-- (dev freely; prod only after a Software Acceptance Review, same as every
-- intake migration).
--
-- Requires: supabase/migrations/20260830120000_intake_forms.sql applied, and an
-- `open` drive (Drives page). Independent of publish_intake_form.sql — run
-- either or both, in either order.
--
-- Re-runnable. Running it again is a no-op while the definition below is
-- unchanged; edit and re-run to publish the next version and repoint future
-- links (a published form_versions row is immutable — the trigger forbids
-- editing it — existing links keep pointing at the version they were created
-- with).
--
-- DRAFT TRANSLATION: per DESIGN.md/docs/INTAKE_FORMS.md §4.4, this needs a
-- native or fluent Spanish speaker on staff to read before it goes to a real
-- family. Field ids and option values are untouched from the English
-- definition on purpose (see the "byte-for-byte" note in
-- web/lib/intakeFormDefinition.ts) — only labels/help/title/intro text changed.
--
-- The definition JSON is intentionally byte-identical to
-- web/lib/intakeFormDefinition.ts's PHASE_1_FORM_DEFINITION_ES and to the
-- Spanish block of intake_demo_seed.sql. Change one, change all three.

do $publish$
declare
  v_drive_id   uuid;
  v_form_id    uuid;
  v_version_id uuid;
  v_version_no int;
  v_definition jsonb;
begin
  select id into v_drive_id from drives where status = 'open' order by year desc limit 1;
  if v_drive_id is null then
    raise exception 'No open drive found. Open one on the Drives page first.';
  end if;

  v_definition := $json$
{
  "schema_version": 1,
  "locale": "es",
  "title": "Registro de Regalos de Reach Christmas",
  "intro": "Nos alegra que esté aquí. Complete este formulario una vez por su hogar, agregando a cada niño o niña que vive con usted. El consejero de su escuela lo confirmará con nosotros.\n\nSi sus hijos asisten a escuelas diferentes y recibe este enlace de más de un consejero, por favor complete un solo formulario para todo su hogar.\n\nEsto toma unos cinco minutos. Solo pedimos los primeros nombres de los niños y nunca pedimos su dirección.",
  "help_footer": "¿Preguntas? Comuníquese con el consejero de su escuela.",
  "privacy_note": "Los patrocinadores que donan los regalos ven el primer nombre de su hijo o hija, el grado, las tallas, la lista de deseos y cualquier necesidad específica. Nunca ven su apellido, dirección ni información de contacto, y no tienen ninguna forma de comunicarse con usted. Solo el consejero de su escuela le dará seguimiento a su registro.",
  "submit_label": "Enviar registro",
  "confirmation": {
    "heading": "Gracias. Su registro ha sido recibido.",
    "body": "Su registro ya está con el consejero de su escuela. Él o ella lo confirmará y lo enviará a OneLife Church. Recibirá más información por el correo electrónico que proporcionó. Si no tiene correo electrónico, su consejero le compartirá la información."
  },
  "budget_per_child": "$50",
  "honeypot_field": "favorite_color",
  "sections": [
    {
      "id": "family",
      "title": "Sobre su hogar",
      "fields": [
        {
          "id": "guardian_name",
          "label": "Nombre del padre, madre o tutor",
          "help": "Basta con un nombre. La persona por quien debemos preguntar al momento de la entrega.",
          "type": "text",
          "required": true,
          "max_length": 120
        },
        {
          "id": "guardian_phone",
          "label": "Número de teléfono",
          "help": "Para poder comunicarnos con usted sobre la entrega en diciembre.",
          "type": "phone",
          "required": true,
          "max_length": 40
        },
        {
          "id": "guardian_email",
          "label": "Correo electrónico",
          "help": "Enviamos las actualizaciones de su registro a este correo. Si no tiene uno, pídale a su consejero escolar que agregue el suyo para que podamos comunicarnos con usted.",
          "type": "email",
          "required": true,
          "max_length": 200
        },
        {
          "id": "preferred_language",
          "label": "¿En qué idioma preferiría que nos comuniquemos con usted?",
          "type": "select",
          "required": true,
          "options": [
            { "value": "en", "label": "Inglés" },
            { "value": "es", "label": "Español" }
          ]
        }
      ]
    },
    {
      "id": "children",
      "title": "Niños en su hogar",
      "repeating": true,
      "min_items": 1,
      "max_items": 10,
      "item_label": "Niño o niña",
      "add_label": "Agregar otro niño o niña",
      "remove_label": "Eliminar este niño o niña",
      "fields": [
        {
          "id": "first_name",
          "label": "Nombre del niño o niña",
          "type": "text",
          "required": true,
          "max_length": 80
        },
        {
          "id": "age",
          "label": "Edad",
          "type": "number",
          "required": true,
          "min": 0,
          "max": 19
        },
        {
          "id": "grade",
          "label": "Grado escolar",
          "type": "select",
          "required": true,
          "options": [
            { "value": "Not in school yet", "label": "Aún no va a la escuela" },
            { "value": "Pre-K", "label": "Pre-Kínder" },
            { "value": "K", "label": "Kínder" },
            { "value": "1", "label": "1er grado" },
            { "value": "2", "label": "2do grado" },
            { "value": "3", "label": "3er grado" },
            { "value": "4", "label": "4to grado" },
            { "value": "5", "label": "5to grado" },
            { "value": "6", "label": "6to grado" },
            { "value": "7", "label": "7mo grado" },
            { "value": "8", "label": "8vo grado" },
            { "value": "9", "label": "9no grado" },
            { "value": "10", "label": "10mo grado" },
            { "value": "11", "label": "11mo grado" },
            { "value": "12", "label": "12mo grado" }
          ]
        },
        {
          "id": "sex",
          "label": "Niño o niña",
          "type": "select",
          "required": true,
          "self_shopper_hidden": true,
          "options": [
            { "value": "M", "label": "Niño" },
            { "value": "F", "label": "Niña" },
            { "value": "Prefer not to say", "label": "Prefiero no decir" }
          ]
        },
        {
          "id": "shirt_size",
          "label": "Talla de camisa",
          "type": "select",
          "required": true,
          "self_shopper_hidden": true,
          "other_field": "shirt_size_other",
          "other_value": "Other",
          "max_length": 80,
          "options": [
            { "value": "Youth XS", "label": "Juvenil XS" },
            { "value": "Youth S", "label": "Juvenil S" },
            { "value": "Youth M", "label": "Juvenil M" },
            { "value": "Youth L", "label": "Juvenil L" },
            { "value": "Youth XL", "label": "Juvenil XL" },
            { "value": "Adult XS", "label": "Adulto XS" },
            { "value": "Adult S", "label": "Adulto S" },
            { "value": "Adult M", "label": "Adulto M" },
            { "value": "Adult L", "label": "Adulto L" },
            { "value": "Adult XL", "label": "Adulto XL" },
            { "value": "Adult XXL", "label": "Adulto XXL" },
            { "value": "Other", "label": "Otro (describa)" }
          ]
        },
        {
          "id": "pant_size",
          "label": "Talla de pantalón",
          "type": "select",
          "required": true,
          "self_shopper_hidden": true,
          "other_field": "pant_size_other",
          "other_value": "Other",
          "max_length": 80,
          "options": [
            { "value": "Youth 4", "label": "Juvenil 4" },
            { "value": "Youth 6", "label": "Juvenil 6" },
            { "value": "Youth 8", "label": "Juvenil 8" },
            { "value": "Youth 10", "label": "Juvenil 10" },
            { "value": "Youth 12", "label": "Juvenil 12" },
            { "value": "Youth 14", "label": "Juvenil 14" },
            { "value": "Youth 16", "label": "Juvenil 16" },
            { "value": "Youth 18", "label": "Juvenil 18" },
            { "value": "Youth 20", "label": "Juvenil 20" },
            { "value": "Adult waist 28", "label": "Adulto cintura 28" },
            { "value": "Adult waist 30", "label": "Adulto cintura 30" },
            { "value": "Adult waist 32", "label": "Adulto cintura 32" },
            { "value": "Adult waist 34", "label": "Adulto cintura 34" },
            { "value": "Adult waist 36", "label": "Adulto cintura 36" },
            { "value": "Adult waist 38", "label": "Adulto cintura 38" },
            { "value": "Adult waist 40", "label": "Adulto cintura 40" },
            { "value": "Adult waist 42", "label": "Adulto cintura 42" },
            { "value": "Adult waist 44", "label": "Adulto cintura 44" },
            { "value": "Other", "label": "Otro (describa)" }
          ]
        },
        {
          "id": "shoe_size",
          "label": "Talla de zapato",
          "type": "select",
          "required": true,
          "self_shopper_hidden": true,
          "other_field": "shoe_size_other",
          "other_value": "Other",
          "max_length": 80,
          "options": [
            { "value": "Toddler 5", "label": "Infantil 5" },
            { "value": "Toddler 6", "label": "Infantil 6" },
            { "value": "Toddler 7", "label": "Infantil 7" },
            { "value": "Toddler 8", "label": "Infantil 8" },
            { "value": "Toddler 9", "label": "Infantil 9" },
            { "value": "Toddler 10", "label": "Infantil 10" },
            { "value": "Toddler 11", "label": "Infantil 11" },
            { "value": "Toddler 12", "label": "Infantil 12" },
            { "value": "Toddler 13", "label": "Infantil 13" },
            { "value": "Youth 1", "label": "Juvenil 1" },
            { "value": "Youth 2", "label": "Juvenil 2" },
            { "value": "Youth 3", "label": "Juvenil 3" },
            { "value": "Youth 4", "label": "Juvenil 4" },
            { "value": "Youth 5", "label": "Juvenil 5" },
            { "value": "Youth 6", "label": "Juvenil 6" },
            { "value": "Youth 7", "label": "Juvenil 7" },
            { "value": "Adult 5", "label": "Adulto 5" },
            { "value": "Adult 6", "label": "Adulto 6" },
            { "value": "Adult 7", "label": "Adulto 7" },
            { "value": "Adult 8", "label": "Adulto 8" },
            { "value": "Adult 9", "label": "Adulto 9" },
            { "value": "Adult 10", "label": "Adulto 10" },
            { "value": "Adult 11", "label": "Adulto 11" },
            { "value": "Adult 12", "label": "Adulto 12" },
            { "value": "Adult 13", "label": "Adulto 13" },
            { "value": "Adult 14", "label": "Adulto 14" },
            { "value": "Other", "label": "Otro (describa)" }
          ]
        },
        {
          "id": "wishlist",
          "label": "¿Qué le gustaría recibir en Navidad?",
          "help": "Hasta 3 ideas. Sea lo más específico posible: la marca, el color o la talla ayudan mucho. Los regalos suelen costar alrededor de {budget} por niño.",
          "type": "text_list",
          "required": true,
          "self_shopper_hidden": true,
          "min_items": 1,
          "max_items": 3,
          "first_required": true,
          "max_length": 200,
          "item_labels": ["Primera idea", "Segunda idea (opcional)", "Tercera idea (opcional)"]
        },
        {
          "id": "specific_needs",
          "label": "¿Hay algo que necesiten especialmente?",
          "type": "textarea",
          "required": false,
          "self_shopper_hidden": true,
          "max_length": 500
        },
        {
          "id": "other_notes",
          "label": "¿Algo más que debamos saber?",
          "type": "textarea",
          "required": false,
          "self_shopper_hidden": true,
          "max_length": 500
        }
      ]
    },
    {
      "id": "pickup_consent",
      "title": "Entrega y consentimiento",
      "help": "Entregaremos el regalo o los regalos de su hijo o hija directamente a su escuela antes de Navidad. El consejero de su escuela coordinará con su familia cómo los recibirán.",
      "fields": [
        {
          "id": "consent",
          "label": "Entiendo que la información de mi hogar será compartida con OneLife Church y sus voluntarios.",
          "type": "checkbox",
          "required": true
        }
      ]
    }
  ]
}
$json$::jsonb;

  -- forms — one per drive, keyed on (drive_id, slug). A separate slug from the
  -- English form ('family-intake') — this is a distinct questionnaire pinned
  -- to independently, not a version of the same one.
  insert into forms (drive_id, slug, name, description)
  values (
    v_drive_id,
    'family-intake-es',
    'Registro de Regalos para el Hogar',
    'Phase 1 Spanish intake questionnaire (draft translation, needs native-speaker review). Source: docs/INTAKE_FORM_DRAFT.md'
  )
  on conflict (drive_id, slug) do update
    set name = excluded.name,
        description = excluded.description
  returning id into v_form_id;

  -- form_versions — publish the definition if it isn't already published as-is.
  select id into v_version_id
  from form_versions
  where form_id = v_form_id
    and published_at is not null
    and definition = v_definition
  order by version desc
  limit 1;

  if v_version_id is null then
    select coalesce(max(version), 0) + 1 into v_version_no
    from form_versions where form_id = v_form_id;

    insert into form_versions (form_id, version, definition, published_at)
    values (v_form_id, v_version_no, v_definition, now())
    returning id into v_version_id;

    raise notice 'Published Spanish questionnaire version % (form_version_id %).', v_version_no, v_version_id;
  else
    raise notice 'Spanish questionnaire already published and unchanged (form_version_id %).', v_version_id;
  end if;

  raise notice 'Done. Create Spanish registration links in the app: Admin -> Registrations -> New registration link -> Questionnaire (es).';
end $publish$;

-- Sanity check — expect one Spanish form and at least one published version.
select 'forms' as table, count(*) from forms
  where drive_id = (select id from drives where status = 'open' order by year desc limit 1)
    and slug = 'family-intake-es'
union all
select 'published form_versions', count(*) from form_versions fv
  join forms f on f.id = fv.form_id
  where f.drive_id = (select id from drives where status = 'open' order by year desc limit 1)
    and f.slug = 'family-intake-es'
    and fv.published_at is not null;
