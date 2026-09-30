-- Publish the Phase 1 registration questionnaire for the open drive.
--
-- USUALLY YOU DO NOT NEED THIS. As of US-27 the app publishes this same
-- questionnaire automatically the first time a staff member creates a
-- registration link for a drive (web/lib/intake.ts ensureDriveFormVersion,
-- from web/lib/intakeFormDefinition.ts). This script is the manual equivalent —
-- keep it for pre-provisioning a drive, for prod (where you may want the
-- questionnaire in place before opening link creation), or for re-publishing a
-- v2 after editing the definition below.
--
-- Run it in the Supabase SQL editor, on whichever project the drive lives on
-- (dev freely; prod only after a Software Acceptance Review, same as every
-- intake migration).
--
-- This is the narrow sibling of supabase/intake_demo_seed.sql. The demo seed
-- ALSO creates a fake "Demo Elementary North" school, a known-plaintext form
-- link, and a counselor review token, and tags all of it is_test_data — good
-- for the 9/9 walkthrough, noise for a real drive. This file creates only the
-- two rows a real drive genuinely needs:
--
--   * forms          — one row, slug 'family-intake', for the open drive
--   * form_versions  — one PUBLISHED (immutable) row holding the questionnaire
--
-- Nothing here is is_test_data. Nothing here touches schools, links, review
-- tokens, families, or children.
--
-- Requires: supabase/migrations/20260830120000_intake_forms.sql applied, and an
-- `open` drive (Drives page).
--
-- Re-runnable. Running it again is a no-op while the definition below is
-- unchanged. Edit the definition and re-run and it publishes the NEXT version
-- number (a published form_versions row is immutable — the trigger forbids
-- editing it); existing links keep pointing at the version they were created
-- with until staff make new ones.
--
-- The definition JSON is intentionally byte-identical to the one in
-- intake_demo_seed.sql. `import_submission` hard-codes almost every field id it
-- reads (see the long "PART OF THE IMPORT CONTRACT" note in that file) — the two
-- files must not drift. If you change one, change both.

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
  "locale": "en",
  "title": "Reach Christmas Gift Registration",
  "intro": "We're glad you're here. Fill this out once for your household, adding each child who lives with you. Your school counselor will confirm it with us.\n\nIf your children attend different schools and you receive this link from more than one counselor, please fill out only one form for your whole household.\n\nThis takes about five minutes. We only ask for the children's first names, and we never ask for your address.",
  "help_footer": "Questions? Contact your school counselor.",
  "privacy_note": "Sponsors who provide gifts see your child's first name, grade, sizes, wish list, and any specific needs. They never see your last name, address, or contact information, and they have no way to contact you. Only your school counselor follows up about your registration.",
  "submit_label": "Submit registration",
  "confirmation": {
    "heading": "Thank you. Your registration is in.",
    "body": "Your registration is with your school counselor now. They'll confirm it and pass it along to OneLife Church. You will receive further information via the email you provided. If you do not have an email, your counselor will relay further information."
  },
  "budget_per_child": "$50",
  "honeypot_field": "favorite_color",
  "sections": [
    {
      "id": "family",
      "title": "About your household",
      "fields": [
        {
          "id": "guardian_name",
          "label": "Parent or guardian name",
          "help": "One name is fine. Whoever we should ask for at pickup.",
          "type": "text",
          "required": true,
          "max_length": 120
        },
        {
          "id": "guardian_phone",
          "label": "Phone number",
          "help": "So we can reach you about pickup in December.",
          "type": "phone",
          "required": true,
          "max_length": 40
        },
        {
          "id": "guardian_email",
          "label": "Email address",
          "help": "We send registration updates to this email. If you do not have one, ask your school counselor to add theirs so we can reach you.",
          "type": "email",
          "required": true,
          "max_length": 200
        },
        {
          "id": "preferred_language",
          "label": "What language should we use to contact you?",
          "type": "select",
          "required": true,
          "options": [
            { "value": "en", "label": "English" },
            { "value": "es", "label": "Español" }
          ]
        }
      ]
    },
    {
      "id": "children",
      "title": "Children in your home",
      "repeating": true,
      "min_items": 1,
      "max_items": 10,
      "item_label": "Child",
      "add_label": "Add another child",
      "remove_label": "Remove this child",
      "fields": [
        {
          "id": "first_name",
          "label": "Child's first name",
          "type": "text",
          "required": true,
          "max_length": 80
        },
        {
          "id": "age",
          "label": "Age",
          "type": "number",
          "required": true,
          "min": 0,
          "max": 19
        },
        {
          "id": "grade",
          "label": "Grade",
          "type": "select",
          "required": true,
          "options": [
            { "value": "Not in school yet", "label": "Not in school yet" },
            { "value": "Pre-K", "label": "Pre-K" },
            { "value": "K", "label": "Kindergarten" },
            { "value": "1", "label": "1st grade" },
            { "value": "2", "label": "2nd grade" },
            { "value": "3", "label": "3rd grade" },
            { "value": "4", "label": "4th grade" },
            { "value": "5", "label": "5th grade" },
            { "value": "6", "label": "6th grade" },
            { "value": "7", "label": "7th grade" },
            { "value": "8", "label": "8th grade" },
            { "value": "9", "label": "9th grade" },
            { "value": "10", "label": "10th grade" },
            { "value": "11", "label": "11th grade" },
            { "value": "12", "label": "12th grade" }
          ]
        },
        {
          "id": "sex",
          "label": "Boy or girl",
          "type": "select",
          "required": true,
          "self_shopper_hidden": true,
          "options": [
            { "value": "M", "label": "Boy" },
            { "value": "F", "label": "Girl" },
            { "value": "Prefer not to say", "label": "Prefer not to say" }
          ]
        },
        {
          "id": "shirt_size",
          "label": "Shirt size",
          "type": "select",
          "required": true,
          "self_shopper_hidden": true,
          "other_field": "shirt_size_other",
          "other_value": "Other",
          "max_length": 80,
          "options": [
            { "value": "Youth XS", "label": "Youth XS" },
            { "value": "Youth S", "label": "Youth S" },
            { "value": "Youth M", "label": "Youth M" },
            { "value": "Youth L", "label": "Youth L" },
            { "value": "Youth XL", "label": "Youth XL" },
            { "value": "Adult XS", "label": "Adult XS" },
            { "value": "Adult S", "label": "Adult S" },
            { "value": "Adult M", "label": "Adult M" },
            { "value": "Adult L", "label": "Adult L" },
            { "value": "Adult XL", "label": "Adult XL" },
            { "value": "Adult XXL", "label": "Adult XXL" },
            { "value": "Other", "label": "Other (describe)" }
          ]
        },
        {
          "id": "pant_size",
          "label": "Pant size",
          "type": "select",
          "required": true,
          "self_shopper_hidden": true,
          "other_field": "pant_size_other",
          "other_value": "Other",
          "max_length": 80,
          "options": [
            { "value": "Youth 4", "label": "Youth 4" },
            { "value": "Youth 6", "label": "Youth 6" },
            { "value": "Youth 8", "label": "Youth 8" },
            { "value": "Youth 10", "label": "Youth 10" },
            { "value": "Youth 12", "label": "Youth 12" },
            { "value": "Youth 14", "label": "Youth 14" },
            { "value": "Youth 16", "label": "Youth 16" },
            { "value": "Youth 18", "label": "Youth 18" },
            { "value": "Youth 20", "label": "Youth 20" },
            { "value": "Adult waist 28", "label": "Adult waist 28" },
            { "value": "Adult waist 30", "label": "Adult waist 30" },
            { "value": "Adult waist 32", "label": "Adult waist 32" },
            { "value": "Adult waist 34", "label": "Adult waist 34" },
            { "value": "Adult waist 36", "label": "Adult waist 36" },
            { "value": "Adult waist 38", "label": "Adult waist 38" },
            { "value": "Adult waist 40", "label": "Adult waist 40" },
            { "value": "Adult waist 42", "label": "Adult waist 42" },
            { "value": "Adult waist 44", "label": "Adult waist 44" },
            { "value": "Other", "label": "Other (describe)" }
          ]
        },
        {
          "id": "shoe_size",
          "label": "Shoe size",
          "type": "select",
          "required": true,
          "self_shopper_hidden": true,
          "other_field": "shoe_size_other",
          "other_value": "Other",
          "max_length": 80,
          "options": [
            { "value": "Toddler 5", "label": "Toddler 5" },
            { "value": "Toddler 6", "label": "Toddler 6" },
            { "value": "Toddler 7", "label": "Toddler 7" },
            { "value": "Toddler 8", "label": "Toddler 8" },
            { "value": "Toddler 9", "label": "Toddler 9" },
            { "value": "Toddler 10", "label": "Toddler 10" },
            { "value": "Toddler 11", "label": "Toddler 11" },
            { "value": "Toddler 12", "label": "Toddler 12" },
            { "value": "Toddler 13", "label": "Toddler 13" },
            { "value": "Youth 1", "label": "Youth 1" },
            { "value": "Youth 2", "label": "Youth 2" },
            { "value": "Youth 3", "label": "Youth 3" },
            { "value": "Youth 4", "label": "Youth 4" },
            { "value": "Youth 5", "label": "Youth 5" },
            { "value": "Youth 6", "label": "Youth 6" },
            { "value": "Youth 7", "label": "Youth 7" },
            { "value": "Adult 5", "label": "Adult 5" },
            { "value": "Adult 6", "label": "Adult 6" },
            { "value": "Adult 7", "label": "Adult 7" },
            { "value": "Adult 8", "label": "Adult 8" },
            { "value": "Adult 9", "label": "Adult 9" },
            { "value": "Adult 10", "label": "Adult 10" },
            { "value": "Adult 11", "label": "Adult 11" },
            { "value": "Adult 12", "label": "Adult 12" },
            { "value": "Adult 13", "label": "Adult 13" },
            { "value": "Adult 14", "label": "Adult 14" },
            { "value": "Other", "label": "Other (describe)" }
          ]
        },
        {
          "id": "wishlist",
          "label": "What would they like for Christmas?",
          "help": "Up to 3 ideas. Be as specific as you can: brand, color, or size helps a lot. Gifts are usually around {budget} per child.",
          "type": "text_list",
          "required": true,
          "self_shopper_hidden": true,
          "min_items": 1,
          "max_items": 3,
          "first_required": true,
          "max_length": 200,
          "item_labels": ["First idea", "Second idea (optional)", "Third idea (optional)"]
        },
        {
          "id": "specific_needs",
          "label": "Is there anything they especially need?",
          "type": "textarea",
          "required": false,
          "self_shopper_hidden": true,
          "max_length": 500
        },
        {
          "id": "other_notes",
          "label": "Anything else we should know?",
          "type": "textarea",
          "required": false,
          "self_shopper_hidden": true,
          "max_length": 500
        }
      ]
    },
    {
      "id": "pickup_consent",
      "title": "Delivery and consent",
      "help": "We'll deliver your child's gift(s) directly to your school before Christmas. Your school counselor will coordinate with your family on how you'll receive them.",
      "fields": [
        {
          "id": "consent",
          "label": "I understand my household's information will be shared with OneLife Church and its volunteers.",
          "type": "checkbox",
          "required": true
        }
      ]
    }
  ]
}
$json$::jsonb;

  -- forms — one per drive, keyed on (drive_id, slug)
  insert into forms (drive_id, slug, name, description)
  values (
    v_drive_id,
    'family-intake',
    'Household Gift Registration',
    'Phase 1 English intake questionnaire. Source: docs/INTAKE_FORM_DRAFT.md'
  )
  on conflict (drive_id, slug) do update
    set name = excluded.name,
        description = excluded.description
  returning id into v_form_id;

  -- form_versions — publish the definition if it isn't already published as-is.
  -- Never UPDATE a published row: the form_versions_immutable_once_published
  -- trigger rejects it, and that rejection is the feature (a submission pins the
  -- version it was answered against).
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

    raise notice 'Published questionnaire version % (form_version_id %).', v_version_no, v_version_id;
  else
    raise notice 'Questionnaire already published and unchanged (form_version_id %).', v_version_id;
  end if;

  raise notice 'Done. Create registration links in the app: Admin -> Registrations -> Registration links.';
end $publish$;

-- Sanity check — expect one form and at least one published version.
select 'forms' as table, count(*) from forms
  where drive_id = (select id from drives where status = 'open' order by year desc limit 1)
union all
select 'published form_versions', count(*) from form_versions fv
  join forms f on f.id = fv.form_id
  where f.drive_id = (select id from drives where status = 'open' order by year desc limit 1)
    and fv.published_at is not null;
