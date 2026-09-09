-- Intake-form demo seed — DEV PROJECT ONLY, NEVER PROD.
--
-- Creates the one hand-authored English form definition, one published
-- form_versions row, one shareable form link, and one counselor review token,
-- all attached to the demo school that supabase/demo_seed.sql already creates.
-- This is the Phase 1 substitute for the staff "create/copy/revoke links" UI
-- (deliberately out of scope — see docs/backlog.md, the US-20..US-24 epic).
--
-- Requires, in this order:
--   1. supabase/migrations/20260830120000_intake_forms.sql applied
--   2. an `open` drive (Drives page)
--   3. supabase/demo_seed.sql run, so "Demo Elementary North" exists
--
-- Re-runnable. Running it twice changes nothing: the form is upserted, the
-- link is upserted on its token, the review token is only inserted if that
-- exact plaintext isn't already stored, and a published form_versions row is
-- never edited (the immutability trigger forbids it) — if you change the
-- definition below and re-run, it publishes the NEXT version number and
-- repoints the link at it, which is exactly the intended way to iterate.
--
-- Everything created here is `is_test_data = true`, the same broad marker
-- demo_seed.sql uses, so the cleanup block at the bottom can find it. Note
-- `is_autotest_data` is deliberately NOT involved (see 20260818130000): an e2e
-- run must never delete a demo someone seeded for a walkthrough.
--
-- =============================================================================
-- THE TWO TOKENS (dev demo only — synthetic, no real PII behind either)
-- =============================================================================
--
--   FAMILY FORM LINK   /form/demo-north-family-2026
--                      token: demo-north-family-2026
--
--   COUNSELOR REVIEW   /review/demo-north-review-2026
--                      token: demo-north-review-2026
--
-- The review token is stored HASHED (bcrypt) and cannot be read back out of
-- the database — this comment is the only record of the plaintext, which is
-- why it lives here. That is by design (INTAKE_FORMS §2): a review link reads
-- children's names and ages, so a database leak must not hand over a working
-- key. In production a counselor who loses theirs gets a NEW one issued; there
-- is no "look up my link" path, for anyone.
--
-- These two strings are readable on purpose so they can be typed at a
-- walkthrough. A real link is 32+ bytes of entropy.
-- =============================================================================

do $seed$
declare
  v_drive_id     uuid;
  v_ds_id        uuid;
  v_form_id      uuid;
  v_version_id   uuid;
  v_version_no   int;
  v_link_id      uuid;
  v_rt_id        uuid;
  v_definition   jsonb;
  v_school_name  constant text := 'Demo Elementary North';
  v_form_token   constant text := 'demo-north-family-2026';
  v_review_token constant text := 'demo-north-review-2026';
  -- Long window so a seeded demo doesn't quietly expire between the build and
  -- the walkthrough. A real link expires at drive close (INTAKE_FORMS §3).
  v_expires      constant timestamptz := now() + interval '180 days';
begin
  select id into v_drive_id from drives where status = 'open' order by year desc limit 1;
  if v_drive_id is null then
    raise exception 'No open drive found — open one on the Drives page first.';
  end if;

  select ds.id into v_ds_id
  from drive_schools ds
  join schools s on s.id = ds.school_id
  where ds.drive_id = v_drive_id
    and s.name = v_school_name
  order by s.created_at asc
  limit 1;

  if v_ds_id is null then
    raise exception
      'Demo school "%" is not in the open drive — run supabase/demo_seed.sql first.', v_school_name;
  end if;

  -- ===========================================================================
  -- The hand-authored English form definition (docs/INTAKE_FORM_DRAFT.md).
  --
  -- This JSON is the contract for three things at once, so read it as one:
  --   * what /form/[token] renders (US-21 — the page must not hard-code the
  --     questionnaire; every field, label, help string and option comes from
  --     here),
  --   * what submit_form validates SERVER-SIDE (required, min/max, options
  --     membership, min_items/max_items/first_required) — client validation is
  --     a convenience, this is the control,
  --   * what import_submission maps onto children/wishlist_items (field `id`
  --     values are the keys it reads out of `answers`).
  --
  -- Spanish is Phase 2 (INTAKE_FORMS §4). Labels here are English-only on
  -- purpose; the locale-object structure lands with the Spanish link, not now.
  --
  -- Field ids match the columns they end up in, which is what keeps
  -- import_submission readable: family.guardian_* -> families.guardian_*,
  -- children[].first_name/age/grade/sex/*_size/specific_needs/other_notes ->
  -- children.*, children[].wishlist -> wishlist_items,
  -- pickup_consent.can_reach_church_pickup -> families.can_reach_church_pickup,
  -- pickup_consent.consent -> families.consent_given_at.
  --
  -- ===========================================================================
  -- THESE IDS ARE PART OF THE IMPORT CONTRACT. DO NOT RENAME THEM.
  --
  -- Read before authoring a version 2 of this definition. `import_submission`
  -- (20260830120000_intake_forms.sql) resolves ONLY the repeating section's id
  -- dynamically, from the pinned definition, via intake_repeating_section_id().
  -- EVERYTHING ELSE it reads is hard-coded in SQL:
  --
  --   section ids   : `family`, `pickup_consent`
  --   family fields : guardian_name, guardian_phone, guardian_email,
  --                   preferred_language
  --   consent fields: consent, can_reach_church_pickup
  --   child fields  : first_name, age, grade, sex, specific_needs, other_notes,
  --                   pant_size, shirt_size, shoe_size, and the three
  --                   *_size_other variants, plus `wishlist`
  --
  -- Rename any of those in a version 2 and NOTHING COMPLAINS: submit_form still
  -- validates (it validates against the definition, whatever it says), the
  -- counselor roster still renders, and the import still reports ok:true — it
  -- just writes the affected columns as NULL. No error, no warning, a real
  -- family silently imported without a guardian phone number. This is exactly
  -- the silent-failure mode the repeating-section-id lookup was added to remove,
  -- one section over; it simply isn't a Phase 1 defect, because there is one
  -- definition and published versions are immutable.
  --
  -- So: a version 2 may ADD sections and fields freely, but renaming or removing
  -- any id listed above is a change to `import_submission`, not to this file
  -- alone. Change both together, or don't change them.
  -- ===========================================================================
  --
  -- `{budget}` in the wishlist help text is substituted by the renderer from
  -- the top-level `budget_per_child` below — so the dollar figure is ONE
  -- string in ONE place when Grant confirms it, not a sentence to re-edit.
  -- ===========================================================================
  v_definition := $json$
{
  "schema_version": 1,
  "locale": "en",
  "title": "Reach Christmas Gift Registration",
  "intro": "We're glad you're here. Fill this out once for your household, adding each child who lives with you. Your school counselor will confirm it with us.\n\nThis takes about five minutes. We only ask for the children's first names, and we never ask for your address.",
  "help_footer": "Questions? Contact your school counselor.",
  "privacy_note": "Sponsors who provide gifts see your child's first name, grade, sizes, wish list, and any specific needs. They never see your last name or address.",
  "submit_label": "Submit registration",
  "confirmation": {
    "heading": "Thank you. Your registration is in.",
    "body": "Your registration is with your school counselor now. They'll confirm it with Reach Church. There's nothing else you need to do."
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
          "label": "Email address (optional)",
          "type": "email",
          "required": false,
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
      "title": "Pickup and consent",
      "fields": [
        {
          "id": "can_reach_church_pickup",
          "label": "If gifts are distributed at the church, can you get there?",
          "type": "select",
          "required": true,
          "options": [
            { "value": "Yes", "label": "Yes" },
            { "value": "No", "label": "No" },
            { "value": "Not sure", "label": "Not sure" }
          ]
        },
        {
          "id": "consent",
          "label": "I understand my household's information will be shared with Reach Church and its volunteers.",
          "type": "checkbox",
          "required": true
        }
      ]
    }
  ]
}
$json$::jsonb;

  -- PLACEHOLDER: Grant to confirm the per-child gift budget before this form
  -- goes to a real family. "$50" above is a guess carried over from
  -- INTAKE_FORM_DRAFT.md §2.8, which flags it explicitly: "Confirm the dollar
  -- figure before this ships." Setting the expectation in the help text is the
  -- single best defense against "a PS5" and "a puppy" answers — but only if
  -- the number is right. It is one value (`budget_per_child`) in one place, so
  -- confirming it is a one-line edit here plus a re-run of this seed (which
  -- publishes a new version and repoints the link automatically).

  -- ===========================================================================
  -- forms — one per drive
  -- ===========================================================================
  insert into forms (drive_id, slug, name, description, is_test_data)
  values (
    v_drive_id,
    'family-intake',
    'Household Gift Registration',
    'Phase 1 English intake form (demo seed). Questionnaire: docs/INTAKE_FORM_DRAFT.md',
    true
  )
  on conflict (drive_id, slug) do update
    set name = excluded.name,
        description = excluded.description,
        is_test_data = true
  returning id into v_form_id;

  -- ===========================================================================
  -- form_versions — published and therefore immutable
  --
  -- If a published version with this exact definition already exists, reuse
  -- it. Otherwise publish the next version number. Never UPDATE a published
  -- row: the form_versions_immutable_once_published trigger rejects it, and
  -- that rejection is the feature (a submission pins the version it was
  -- answered against, so editing one retroactively would rewrite what a family
  -- was asked).
  -- ===========================================================================
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

    raise notice 'Published form definition version %.', v_version_no;
  end if;

  -- ===========================================================================
  -- form_links — the shareable family link
  --
  -- channel 'family' => submissions land as `submitted` and wait for the
  -- counselor. (A 'counselor' or 'staff' channel link would auto-verify at
  -- submit; not seeded — and, since the US-20 review, deliberately not to be
  -- seeded: an auto-verifying link's plaintext token is readable by any
  -- signed-in staff user, so issuing one lets a volunteer file submissions that
  -- skip the counselor entirely. See the note at submit_form's channel
  -- handling. The walkthrough is meant to show the counselor step actually
  -- happening anyway.)
  --
  -- drive_school_id is set, so this is a SCHOOL link. A link with a null
  -- drive_school_id would be the confidential channel, and as of the US-20
  -- review it is readable only by staff who clear can_view_confidential() —
  -- so a plain volunteer would not see it in listFormLinks(). Not seeded.
  -- ===========================================================================
  insert into form_links (
    drive_id, drive_school_id, form_version_id, token, label,
    locale, channel, opens_at, expires_at, max_submissions, is_test_data
  )
  values (
    v_drive_id, v_ds_id, v_version_id, v_form_token,
    'Demo Elementary North — English — DEMO',
    'en', 'family', null, v_expires, null, true
  )
  on conflict (token) do update
    set drive_id = excluded.drive_id,
        drive_school_id = excluded.drive_school_id,
        form_version_id = excluded.form_version_id,
        label = excluded.label,
        locale = excluded.locale,
        channel = excluded.channel,
        expires_at = excluded.expires_at,
        revoked_at = null,
        is_test_data = true
  returning id into v_link_id;

  -- ===========================================================================
  -- review_tokens — the counselor's roster link
  --
  -- bcrypt is salted per row, so there is no way to look one up by hash
  -- equality; the existing row has to be found by comparing the candidate
  -- plaintext against each stored hash. Scoped to this school's test-flagged
  -- tokens, so this touches nothing else. No DELETE anywhere in this file.
  --
  -- extensions.crypt(..., gen_salt('bf')) is also what satisfies the
  -- review_tokens_hash_is_bcrypt constraint the migration adds. Do not
  -- hand-insert a token_hash here — the constraint exists because ONE
  -- non-bcrypt row makes crypt() raise for every counselor at every school,
  -- not just this one.
  --
  -- Both this insert and the form_links upsert above now fire the generic
  -- audit trigger, so a seed run leaves rows in audit_log. Expected: those two
  -- tables are audited on purpose (who issued or revoked a roster key), and
  -- neither carries child PII into that never-purged table.
  --
  -- issued_to_email matches the demo school's liaison in demo_seed.sql. It is
  -- a @demo.example.com address — nothing is ever sent to it (there is no
  -- email path in Phase 1 at all).
  -- ===========================================================================
  select id into v_rt_id
  from review_tokens
  where drive_id = v_drive_id
    and drive_school_id = v_ds_id
    and is_test_data
    and token_hash = extensions.crypt(v_review_token, token_hash)
  limit 1;

  if v_rt_id is null then
    insert into review_tokens (
      drive_id, drive_school_id, token_hash, issued_to_email, expires_at, is_test_data
    )
    values (
      v_drive_id, v_ds_id,
      extensions.crypt(v_review_token, extensions.gen_salt('bf')),
      'privera@demo.example.com',
      v_expires,
      true
    )
    returning id into v_rt_id;
    raise notice 'Issued a new demo review token (plaintext is in this file''s header).';
  else
    update review_tokens
    set expires_at = v_expires, revoked_at = null
    where id = v_rt_id;
    raise notice 'Reused the existing demo review token.';
  end if;

  raise notice 'Intake demo seed complete.';
  raise notice '  Family form:      /form/%', v_form_token;
  raise notice '  Counselor review: /review/%', v_review_token;
end $seed$;

-- ============================================================================
-- Sanity check — run after seeding. Expect one row each, and get_form to come
-- back ok = true with only definition / school_name / locale in it.
-- ============================================================================
select 'forms'         as t, count(*) from forms where is_test_data
union all select 'form_versions', count(*) from form_versions
  where form_id in (select id from forms where is_test_data)
union all select 'form_links', count(*) from form_links where is_test_data
union all select 'review_tokens', count(*) from review_tokens where is_test_data;

-- Expect: ok = true, school_name = 'Demo Elementary North', locale = 'en',
-- keys_returned = 'definition, locale, ok, school_name' (and NOTHING else —
-- no counselor email, no drive internals, no submissions), sections = 3.
with r as (select public.get_form('demo-north-family-2026') as f)
select r.f ->> 'ok'          as ok,
       r.f ->> 'school_name' as school_name,
       r.f ->> 'locale'      as locale,
       (select string_agg(t.k, ', ' order by t.k) from jsonb_object_keys(r.f) as t(k)) as keys_returned,
       jsonb_array_length(r.f -> 'definition' -> 'sections') as sections
from r;

-- ============================================================================
-- CLEANUP — run only when you're done demoing. DEV ONLY.
--
-- Scoped to is_test_data rows, same convention as demo_seed.sql's own cleanup
-- block. The two UPDATEs come first: families/children point BACK at
-- form_submissions via source_submission_id with no ON DELETE clause, so
-- deleting a submission that has been imported would otherwise fail on that
-- foreign key. Nulling the pointer leaves the imported family intact (it's a
-- working record now; deleting it is demo_seed.sql's cleanup block's job, not
-- this one's).
--
-- Note supabase/reset_dev_data.sql's `truncate ... cascade` already removes
-- form_links / form_submissions / submission_events / review_tokens
-- automatically (they hang off drive_schools and families), but leaves `forms`
-- and `form_versions` standing, since those hang off `drives`. That's harmless
-- — re-running this seed on top of them is a no-op.
-- ============================================================================
-- update children set source_submission_id = null
--   where source_submission_id in (select id from form_submissions where is_test_data);
-- update families set source_submission_id = null
--   where source_submission_id in (select id from form_submissions where is_test_data);
-- delete from submission_events
--   where submission_id in (select id from form_submissions where is_test_data);
-- delete from form_submissions where is_test_data;
-- delete from review_tokens where is_test_data;
-- delete from form_links where is_test_data;
-- delete from form_versions where form_id in (select id from forms where is_test_data);
-- delete from forms where is_test_data;
