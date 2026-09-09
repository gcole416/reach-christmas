-- Epic: High schoolers as a self-shopping bucket (docs/backlog.md US-32 / US-35,
-- GitLab #24 / #27). Resolves OPEN_QUESTIONS ADM-19.
--
-- WHAT THIS DOES
-- High schoolers (grades 9-12) are invited to a store shopping day to pick
-- their own gifts. They still belong to a household and still need to be
-- counted and organised, but their card must never enter the sponsor pool,
-- the print run, or the fulfilment math.
--
--   * children.is_high_schooler  — the flag. Auto-set on INSERT from grade
--     (9-12) by a trigger, so BOTH write paths (import_submission and the
--     hand-entry addFamily/saveFamilyEdit in web/lib/store.tsx) get it for
--     free. Staff can override it either way on the family edit screen — the
--     trigger only fires on INSERT, so an UPDATE that sets the flag by hand is
--     never clobbered.
--   * wishlist_items INSERT trigger drops any wishlist row for a high schooler
--     — they self-shop, there is nothing to buy from a list. Covers
--     import_submission and the hand-entry paths without touching either
--     function.
--   * public_available_cards / printable_cards / cards_needing_print all gain
--     `and not ch.is_high_schooler`. The sponsor-facing exclusion is a
--     predicate IN THE VIEW, at the database layer, per AGENTS.md.
--   * submit_form's server-side validation (via intake_validate_field) stops
--     requiring the gift fields for a grade-9-12 child, so the v3 form can hide
--     them. Client hiding is a convenience; this is the control.
--   * children.shop_day_status / shop_day_notes — the US-35 tracking columns.
--     No new table: children already has the RLS + audit trigger this needs.
--
-- import_submission() and submit_form() themselves are UNCHANGED — every
-- behaviour above is a trigger, a view, or the shared validator, which is why
-- this migration is small.
--
-- APPLY TARGET: dev only (thvyntrxmahygesltgft). Prod is untouched until a
-- Software Acceptance Review clears it (same rule as every intake migration).
-- No SQL was executed by an agent — Grant pastes this file.
--
-- reach-reviewer gate REQUIRED: touches public_available_cards (the anon
-- boundary) and the intake server-side validator.

begin;

-- =============================================================================
-- 1. The grade rule, in one place.
-- =============================================================================
-- Grades are stored as free text ('K', '1' .. '12'); the form constrains the
-- select to these exact strings and hand-entry is expected to match. A grade
-- that doesn't (e.g. "9th", "Grade 9") just isn't auto-classified — staff fix
-- it with the family-edit override. The TS side mirrors this list in
-- web/lib/queries.ts (isHighSchoolGrade) — keep the two in sync.
create or replace function public.is_high_school_grade(p_grade text)
returns boolean
language sql
immutable
as $$
  select btrim(coalesce(p_grade, '')) in ('9', '10', '11', '12')
$$;

-- =============================================================================
-- 2. Columns.
-- =============================================================================
alter table children add column if not exists is_high_schooler boolean not null default false;

do $$ begin
  create type shop_day_status as enum ('not_contacted', 'invited', 'confirmed', 'attended');
exception when duplicate_object then null;
end $$;

alter table children add column if not exists shop_day_status shop_day_status not null default 'not_contacted';
alter table children add column if not exists shop_day_notes text;

-- Backfill existing rows from the grade they already carry.
update children
set is_high_schooler = true
where not is_high_schooler
  and public.is_high_school_grade(grade);

-- A partial index for the roster / dashboard count query (US-35). Small table,
-- but the high-schooler slice is read on its own page and reconciled against a
-- dashboard tile, so it earns an index.
create index if not exists children_high_schooler_idx
  on children (family_id) where is_high_schooler;

-- =============================================================================
-- 3. children: auto-classify on INSERT.
-- =============================================================================
-- BEFORE INSERT only, on purpose:
--   * INSERT (import_submission, addFamily, saveFamilyEdit's new-child branch)
--     -> classify from grade. Neither function needs to know this exists.
--   * UPDATE (the family-edit "High schooler" toggle, or a grade change)
--     -> left alone, so a deliberate staff override survives. If staff change
--        a child's grade into/out of 9-12 they flip the toggle in the same
--        form; we do not silently re-decide it under them.
-- If the caller already passed is_high_schooler = true (nothing does today,
-- but a future path might), that stands.
create or replace function public.children_classify_high_schooler()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not new.is_high_schooler and public.is_high_school_grade(new.grade) then
    new.is_high_schooler := true;
  end if;
  return new;
end;
$$;

drop trigger if exists children_classify_high_schooler on children;
create trigger children_classify_high_schooler
  before insert on children
  for each row execute function public.children_classify_high_schooler();

-- =============================================================================
-- 4. wishlist_items: a high schooler has no wishlist.
-- =============================================================================
-- The v3 form doesn't collect a wishlist for a grade-9-12 child and
-- submit_form no longer requires one (section 6 below). This is the
-- backstop for every other path: import_submission of an older/hostile
-- payload, a hand-entry mistake, a future editor. Returning NULL from a
-- BEFORE INSERT trigger skips the row silently — which is the right outcome
-- here (there is genuinely nothing to store), not an error the caller has to
-- handle.
--
-- security definer so the child lookup isn't subject to the inserting role's
-- RLS view of `children` (an admin importing is fine either way; this just
-- removes the edge case).
create or replace function public.wishlist_items_skip_high_schooler()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from children c
    where c.id = new.child_id and c.is_high_schooler
  ) then
    return null;  -- high schoolers self-shop; drop the row, no error
  end if;
  return new;
end;
$$;

drop trigger if exists wishlist_items_skip_high_schooler on wishlist_items;
create trigger wishlist_items_skip_high_schooler
  before insert on wishlist_items
  for each row execute function public.wishlist_items_skip_high_schooler();

-- =============================================================================
-- 5. Views: keep high schoolers out of the sponsor pool and the print run.
-- =============================================================================

-- public_available_cards — the ENTIRE anon/sponsor security boundary. This is
-- character-for-character 20260818120000_fix_public_available_cards_anon_bug.sql
-- with one added inner predicate: `and not ch.is_high_schooler`. Everything
-- else is unchanged — the column whitelist, `not f.is_confidential` as a
-- literal inner join condition (NOT routed through a helper — anon has no
-- EXECUTE), the open-drive join, the not-already-claimed filter, no security_
-- invoker view anywhere in the chain, no `select *`.
drop view if exists public_available_cards;

create view public_available_cards as
select
  crd.id as card_id,
  coalesce(ds.code, 'Z') || f.family_number || '.' || ch.child_index as card_number,
  ch.first_name,
  ch.grade,
  ch.pant_size, ch.shirt_size, ch.shoe_size,
  ch.specific_needs,
  wi.description as wishlist_description
from cards crd
join children ch on ch.id = crd.child_id and not ch.is_high_schooler
join families f on f.id = ch.family_id and not f.is_confidential
join drives d on d.id = f.drive_id and d.status = 'open'
left join drive_schools ds on ds.id = f.drive_school_id
left join wishlist_items wi on wi.child_id = ch.id
where not exists (
  select 1 from assignments a where a.card_id = crd.id and a.status <> 'cancelled'
);

-- `drop view` discards grants — reissue, exactly as 20260818120000 did.
grant select on public_available_cards to anon, authenticated;

-- printable_cards / cards_needing_print — 20260818140000_one_card_per_child.sql
-- verbatim, plus `and not ch.is_high_schooler`. A high schooler's card is
-- never printed: no sponsor claims it, and the teen isn't handed a gift bag.
drop view if exists cards_needing_print;
drop view if exists printable_cards;

create view cards_needing_print
  with (security_invoker = true) as
select
  ch.id as child_id,
  ch.first_name,
  crd.id as card_id
from children ch
join cards crd on crd.child_id = ch.id
where crd.printed_at is null
  and not ch.is_high_schooler;

create view printable_cards
  with (security_invoker = true) as
select
  crd.id as card_id,
  ccn.card_number as display_label,
  ch.first_name,
  ch.grade,
  crd.printed_at,
  f.drive_id
from cards crd
join children ch on ch.id = crd.child_id and not ch.is_high_schooler
join families f on f.id = ch.family_id
join child_card_numbers ccn on ccn.child_id = ch.id;

grant select on cards_needing_print, printable_cards to authenticated;

-- =============================================================================
-- 6. Intake server-side validation: don't require the gift fields for a
--    grade-9-12 child.
-- =============================================================================
-- submit_form validates every child field against the pinned form definition
-- via intake_validate_field. The v3 definition marks the gift fields (sex,
-- the three sizes, wishlist, specific_needs, other_notes) with
-- "self_shopper_hidden": true. When the child's grade is 9-12, those fields
-- are neither shown nor collected, so the validator returns clean for them.
--
-- This is the whole reason the change is server-side: the renderer hiding a
-- field is a convenience; a payload that omits (or, hostile, includes junk
-- in) a hidden field must validate exactly as the form intends. A junk value
-- in a hidden field still can't reach a sponsor — public_available_cards
-- excludes the whole card (section 5) — and import_submission's left(...)
-- truncation still bounds anything written.
--
-- This is a full CREATE OR REPLACE of 20260830120000_intake_forms.sql's
-- intake_validate_field with ONE added early-return block (marked
-- "SELF-SHOPPER" below). Nothing else in the function body changed.
create or replace function public.intake_validate_field(
  p_value jsonb,
  p_field jsonb,
  p_path_prefix text
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_id          text := p_field->>'id';
  v_type        text := coalesce(p_field->>'type', 'text');
  v_required    boolean := coalesce((p_field->>'required')::boolean, false);
  v_label       text := coalesce(p_field->>'label', p_field->>'id');
  v_path        text;
  v_raw         jsonb;
  v_text        text;
  v_errors      jsonb := '[]'::jsonb;
  v_idx         int;
  v_count       int := 0;
  v_first       text := null;
  v_elem        jsonb;
  v_min_items   int;
  v_max_items   int;
  v_max_length  int;
  v_other_field text;
  v_other_value text;
  v_other_text  text;
  v_num         bigint;
begin
  if v_id is null then
    return v_errors;
  end if;

  -- SELF-SHOPPER (high school) --------------------------------------------
  -- A grade-9-12 child is asked only for first name, age and grade. Fields
  -- flagged self_shopper_hidden in the pinned definition are not rendered
  -- and not collected for them, so there is nothing to validate. Mirrors
  -- public.is_high_school_grade() and the children.is_high_schooler trigger.
  if coalesce((p_field->>'self_shopper_hidden')::boolean, false)
     and public.is_high_school_grade(p_value ->> 'grade') then
    return v_errors;
  end if;

  v_path := coalesce(p_path_prefix, '') || v_id;
  v_raw := p_value -> v_id;
  v_max_length := nullif(p_field->>'max_length', '')::int;

  -- checkbox (consent) ------------------------------------------------------
  if v_type = 'checkbox' then
    if v_required and coalesce(v_raw, 'false'::jsonb) is distinct from 'true'::jsonb then
      v_errors := v_errors || jsonb_build_object(
        'field', v_path,
        'message', 'Please check this box to continue.'
      );
    end if;
    return v_errors;
  end if;

  -- text_list (the wishlist) ----------------------------------------------
  if v_type = 'text_list' then
    v_min_items := coalesce(nullif(p_field->>'min_items','')::int, case when v_required then 1 else 0 end);
    v_max_items := coalesce(nullif(p_field->>'max_items','')::int, 3);

    if v_raw is null or jsonb_typeof(v_raw) <> 'array' then
      if v_min_items > 0 then
        v_errors := v_errors || jsonb_build_object(
          'field', v_path || '[0]',
          'message', 'Please add at least one idea.'
        );
      end if;
      return v_errors;
    end if;

    if jsonb_array_length(v_raw) > v_max_items then
      return v_errors || jsonb_build_object(
        'field', v_path,
        'message', format('Please list no more than %s ideas.', v_max_items)
      );
    end if;

    for v_idx in 0 .. greatest(jsonb_array_length(v_raw) - 1, -1) loop
      v_elem := v_raw -> v_idx;
      if jsonb_typeof(v_elem) = 'string' then
        v_text := btrim(v_elem #>> '{}');
      else
        v_text := null;
        if jsonb_typeof(v_elem) <> 'null' then
          v_errors := v_errors || jsonb_build_object(
            'field', v_path || '[' || v_idx || ']',
            'message', 'We couldn''t read that idea. Please re-type it.'
          );
        end if;
      end if;
      if v_idx = 0 then
        v_first := v_text;
      end if;
      if v_text is not null and v_text <> '' then
        v_count := v_count + 1;
        if v_max_length is not null and char_length(v_text) > v_max_length then
          v_errors := v_errors || jsonb_build_object(
            'field', v_path || '[' || v_idx || ']',
            'message', format('Please keep each idea under %s characters.', v_max_length)
          );
        end if;
      end if;
    end loop;

    if v_count < v_min_items then
      v_errors := v_errors || jsonb_build_object(
        'field', v_path || '[0]',
        'message', 'Please add at least one idea.'
      );
    elsif coalesce((p_field->>'first_required')::boolean, false) and coalesce(v_first, '') = '' then
      v_errors := v_errors || jsonb_build_object(
        'field', v_path || '[0]',
        'message', 'Please fill in the first idea before adding others.'
      );
    end if;

    return v_errors;
  end if;

  -- scalar types --------------------------------------------------------
  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    v_text := null;
  elsif jsonb_typeof(v_raw) = 'string' then
    v_text := btrim(v_raw #>> '{}');
  elsif jsonb_typeof(v_raw) in ('number', 'boolean') then
    v_text := v_raw #>> '{}';
  else
    return v_errors || jsonb_build_object(
      'field', v_path,
      'message', format('%s could not be read. Please re-enter it.', v_label)
    );
  end if;

  -- H1 — the "Other (describe)" escape hatch ---------------------------
  v_other_field := nullif(p_field->>'other_field', '');
  if v_other_field is not null then
    v_other_value := coalesce(p_field->>'other_value', 'Other');
    v_other_text := btrim(coalesce(p_value ->> v_other_field, ''));

    if coalesce(v_text, '') = v_other_value then
      if v_other_text = '' then
        v_errors := v_errors || jsonb_build_object(
          'field', coalesce(p_path_prefix, '') || v_other_field,
          'message', format('Please describe the %s.', lower(v_label))
        );
      elsif char_length(v_other_text) > coalesce(v_max_length, 80) then
        v_errors := v_errors || jsonb_build_object(
          'field', coalesce(p_path_prefix, '') || v_other_field,
          'message', format('Please keep that under %s characters.', coalesce(v_max_length, 80))
        );
      end if;
    elsif v_other_text <> '' then
      v_errors := v_errors || jsonb_build_object(
        'field', coalesce(p_path_prefix, '') || v_other_field,
        'message', format(
          'Choose "%s" for %s, or clear the description box.',
          v_other_value, lower(v_label)
        )
      );
    end if;
  end if;

  if v_text is null or v_text = '' then
    if v_required then
      v_errors := v_errors || jsonb_build_object(
        'field', v_path,
        'message', format('%s is required.', v_label)
      );
    end if;
    return v_errors;
  end if;

  if v_max_length is not null and char_length(v_text) > v_max_length then
    return v_errors || jsonb_build_object(
      'field', v_path,
      'message', format('Please keep %s under %s characters.', v_label, v_max_length)
    );
  end if;

  if v_type = 'number' then
    if v_text !~ '^-?[0-9]{1,9}$' then
      return v_errors || jsonb_build_object(
        'field', v_path,
        'message', format('%s must be a whole number.', v_label)
      );
    end if;
    v_num := v_text::bigint;
    if p_field ? 'min' and v_num < (p_field->>'min')::bigint then
      v_errors := v_errors || jsonb_build_object(
        'field', v_path,
        'message', format('%s must be between %s and %s.', v_label, p_field->>'min', coalesce(p_field->>'max','?'))
      );
    elsif p_field ? 'max' and v_num > (p_field->>'max')::bigint then
      v_errors := v_errors || jsonb_build_object(
        'field', v_path,
        'message', format('%s must be between %s and %s.', v_label, coalesce(p_field->>'min','?'), p_field->>'max')
      );
    end if;
    return v_errors;
  end if;

  if v_type = 'select' and p_field ? 'options' then
    if not exists (
      select 1 from jsonb_array_elements(p_field->'options') as opt(item)
      where item ->> 'value' = v_text
    ) then
      return v_errors || jsonb_build_object(
        'field', v_path,
        'message', format('Please choose one of the listed options for %s.', v_label)
      );
    end if;
    return v_errors;
  end if;

  if v_type = 'email' and v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    v_errors := v_errors || jsonb_build_object(
      'field', v_path,
      'message', 'Please enter a valid email address, or leave it blank.'
    );
  end if;

  return v_errors;
end;
$$;

revoke execute on function public.intake_validate_field(jsonb, jsonb, text) from public, anon, authenticated;

commit;

-- VERIFY (run after applying, dev only):
--
-- 1. Column + backfill
--    select is_high_schooler, count(*) from children group by 1;
--    select count(*) from children where is_high_schooler and not public.is_high_school_grade(grade);
--      -> second query: only rows a staff override put there (0 right after apply)
--
-- 2. Sponsor boundary — as a genuinely anonymous client, not the SQL editor:
--    set local role anon;
--    select count(*) from public_available_cards;               -- unchanged for non-HS
--    -- create a temp grade-10 child + card in a scratch open drive, confirm it
--    -- does NOT appear here by card_id or first_name, then delete it.
--    reset role;
--
-- 3. Wishlist trigger
--    -- insert a grade-11 child via import or by hand, add wishlist rows,
--    -- select count(*) from wishlist_items where child_id = <that child> -> 0
--
-- 4. submit_form — against a v3 link:
--    -- submit a household with a grade-3 child (full gift fields) and a
--    -- grade-10 child (name/age/grade only): expect ok:true.
--    -- submit the grade-10 child WITH a 900-char wishlist string: still ok:true,
--    -- and after import that child has no wishlist_items rows.
--    -- submit a grade-8 child with no wishlist: expect ok:false (still required).
--
-- 5. Print run
--    select count(*) from printable_cards;        -- excludes HS
--    select count(*) from cards_needing_print;    -- excludes HS
