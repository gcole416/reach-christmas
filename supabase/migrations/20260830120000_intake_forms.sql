-- US-20 — Counselor-vetted intake forms, Phase 1: data model, RLS, and the six
-- server functions. Implements docs/INTAKE_FORMS.md §5 (schema), §6 (server
-- functions), §8 (confidential channel) and §9 (RLS); the questionnaire this
-- is built to carry is docs/INTAKE_FORM_DRAFT.md (English only for Phase 1).
--
-- =============================================================================
-- APPLY STATUS — as of 2026-09-01
-- =============================================================================
--   DEV:  APPLIED (2026-08-31, by Grant, via the Supabase SQL editor; re-applied
--         after the review fixes). This file is written to be re-runnable, so a
--         re-paste to dev is a no-op except where noted below.
--   PROD: NOT APPLIED, and must not be. Prod has had no Software Acceptance
--         Review for this feature. Prod's exact state is not reliably known —
--         see docs/DEPLOY.md Phase 0.
--
-- The agent that wrote this file has no SQL execution path at all (anon key over
-- PostgREST only, no psql, no DB password, no migration runner) — see the VERIFY
-- block at the bottom for the read-only checks to run in the Supabase SQL editor
-- after pasting this in, which is how it gets applied (docs/DEPLOY.md).
--
-- DESTRUCTIVE STATEMENTS — TWO, CALLED OUT FOR WHOEVER IS PASTING:
--   * `drop function if exists public.intake_apply_corrections(jsonb, jsonb)`
--     (the 2-argument form — see the note at its site)
--   * `drop function if exists public.import_submission(uuid)`
--     (the 1-argument form — see the note at its site)
-- Both are correct and idempotent, and both are a harmless no-op on a database
-- that has never seen those signatures. But this file was drafted, reviewed and
-- revised before it was applied, so on ANY database that received an EARLIER
-- DRAFT of it, these two statements REPLACE LIVE FUNCTIONS rather than doing
-- nothing. That is intended (each drop exists precisely so a stale overload
-- can't be picked up by an old client or a stale PostgREST schema cache), but it
-- is a live change, not an inert line, and the older comments at those two sites
-- that describe them as "never ran anywhere" are true only of a database that
-- never saw a draft. Nothing else in this file drops or alters existing objects.
--
-- =============================================================================
-- Why this migration is written to be safely re-runnable
-- =============================================================================
-- Every other migration in this project is applied by a human pasting it into
-- the SQL editor. This one is long, and if it ever fails partway (or the
-- editor doesn't wrap it in a transaction), a re-run must not fail with
-- "already exists" noise that hides the real error. So: enum creation is
-- guarded by a do-block, tables use `create table if not exists`, columns use
-- `add column if not exists`, indexes use `create index if not exists`,
-- policies and triggers are dropped-if-exists before being created, and every
-- function is `create or replace`. Re-running this file is a no-op.
--
-- =============================================================================
-- `answers` vs `corrections` — the one reconciliation decision in here
-- =============================================================================
-- INTAKE_FORMS §5.4 says `form_submissions.answers` is "exactly as submitted,
-- never modified". INTAKE_FORMS §3 (amended 2026-08-30) says a counselor may
-- fix first_name/age/grade typos. Both are true at once here because a
-- correction is NEVER written into `answers`. It lands in a separate
-- `form_submissions.corrections jsonb` column, keyed by 1-based child position,
-- and is overlaid onto `answers` only at read time:
--
--     effective = intake_apply_corrections(coalesce(answers_en, answers),
--                                          corrections,
--                                          <repeating section id, resolved from
--                                           the pinned definition>)
--
-- `get_review_roster` and `import_submission` both read through that overlay;
-- nothing anywhere updates `answers`. The provenance record therefore still
-- shows exactly what the family typed, the counselor's attestation is recorded
-- as a distinct, attributable edit (`submission_events` gets a `verified` row
-- carrying the correction payload), and the staff import queue can show "the
-- family said X, the counselor corrected it to Y" rather than silently
-- displaying Y.
--
-- Corrections are scoped to first_name / age / grade per child, enforced in
-- `verify_submission` by RAISING on any other key — never by silently dropping
-- it, so a client bug can't quietly widen what a counselor can write.
--
-- =============================================================================
-- Phase 1 is English only
-- =============================================================================
-- `answers_en` / `translated_at` / `translation_engine` exist per §5.4 so the
-- Phase 2 translation round-trip (§4) has somewhere to land, but there is NO
-- translation logic in this migration. `import_submission` reads
-- `coalesce(answers_en, answers)`, which is exactly `answers` today, and still
-- copies the family's own words into the `*_source` columns — §10 depends on
-- that copy surviving the drive-close purge of submissions.
--
-- =============================================================================
-- Confidentiality model
-- =============================================================================
-- Confidential-channel submissions are the ones whose link had no school
-- (`drive_school_id is null`, per §5.3's "null = confidential/direct"). They
-- are gated with the EXISTING `can_view_confidential()` helper, never a
-- hand-written `role = 'admin'` check (§8). Note for the record: that helper
-- today returns true for every admin (`role = 'admin' or can_view_confidential`),
-- which is exactly how confidential `families` already behave. This migration
-- deliberately does NOT fork a stricter helper — one confidentiality model in
-- this database, not two. If §8's "two named staff, not all admins" is meant
-- to be tighter than "any admin", that is a change to `can_view_confidential()`
-- itself, affecting confidential families too, and belongs in its own story.
--
-- Importing a confidential-channel submission creates a CONFIDENTIAL family
-- (`is_confidential = true`) BY DEFAULT, not a plain direct-referral one.
-- Erring toward more protection is the safe direction, and it keeps the
-- submission's gate and the resulting family's gate identical.
--
-- The importing admin can override that in either direction:
-- `import_submission(id, p_is_confidential => true|false)`. §3 calls the import
-- click "the natural place to set confidential tier", and it is the ONLY safe
-- place: importing a school-channel submission and then editing
-- `families.is_confidential` afterwards would leave the child's name readable
-- by every volunteer for the seconds in between. Creating a confidential family
-- stays open to any admin — that is the resolved position in OPEN_QUESTIONS
-- **DB-26** (whoever is entering it already knows the details firsthand) — and
-- an admin who does not clear `can_view_confidential()` cannot see a
-- confidential-channel submission to import in the first place, so no extra
-- gate is needed on the parameter itself.
--
-- =============================================================================
-- What is deliberately NOT here
-- =============================================================================
-- * No audit_log trigger on `form_submissions` or `submission_events`.
--   `submission_events` (§5.6) is this feature's trail and can represent its
--   non-`profiles` actors (anonymous families, token-bearing counselors) which
--   `audit_log.changed_by uuid references profiles(id)` cannot. Wiring the
--   generic audit trigger onto those two would also copy the whole `answers`
--   blob — every child's name, age, sizes and wishlist — into `audit_log`,
--   which SCHEMA.md's retention note says is kept forever with no cascade,
--   directly defeating §10's "purge unfulfilled submissions at drive close".
--
--   That reasoning does NOT extend to the admin-only-write tables. `form_links`
--   and `review_tokens` ARE audited (see the trigger section below): their
--   actors are always real `profiles` rows, they hold no child PII, and
--   `review_tokens` in particular decides who can read a school's whole-season
--   roster of children's first names — "who issued or revoked that, and when"
--   is exactly the question an audit log exists to answer.
-- * No email/notification. Phase 2 (§11).
-- * No per-IP rate limiting in `submit_form` — and, since the US-20 review, no
--   per-IP identifier stored at all: `ip_hash` is written as NULL (see that
--   column's comment). `max_submissions` per link, the honeypot, and
--   `expires_at` are the Phase 1 controls; a fixed per-IP cap would also
--   throttle the e2e suite, which submits repeatedly from one address.
-- * No staff UI for issuing links/tokens. Phase 1 seeds them
--   (supabase/intake_demo_seed.sql).

-- =============================================================================
-- Enums (§5)
-- =============================================================================

-- `under_review` is currently a DEAD state: nothing in this file ever sets it
-- (a family submission goes 'submitted' -> 'verified' in one counselor click).
-- It is kept because it is part of §3's documented lifecycle diagram, and
-- verify_submission/reject_submission already accept it as a valid starting
-- point, so a future "counselor opened this and hasn't finished" step needs no
-- enum change. Leaving an unused label costs nothing; removing one from a
-- shipped enum is a rewrite.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'submission_status') then
    create type submission_status as enum
      ('draft','submitted','under_review','verified','imported','rejected','duplicate');
  end if;
  if not exists (select 1 from pg_type where typname = 'submission_channel') then
    create type submission_channel as enum ('family','counselor','staff');
  end if;
end $$;

-- =============================================================================
-- Tables (§5.1 – §5.6)
--
-- Creation order is forced by one forward reference: form_submissions
-- .verified_via_review_token points at review_tokens, so review_tokens has to
-- exist first.
--
-- `is_test_data` on forms / form_links / review_tokens / form_submissions
-- mirrors families.is_test_data (20260818130000): the broad "not real
-- production data" marker, set by the dev-only seed scripts, never exposed as
-- a UI field. It is what makes supabase/intake_demo_seed.sql's cleanup block
-- able to find its own rows. Note the narrower families.is_autotest_data flag
-- is deliberately NOT propagated here — see import_submission for how an
-- imported family inherits the broad flag only, so an e2e run can't delete a
-- demo that was seeded for a walkthrough.
-- =============================================================================

-- §5.1 — one form per drive (drive_id null = a reusable template).
create table if not exists forms (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid references drives(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  is_test_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- NULL drive_id (template) rows are not deduplicated by this, since Postgres
  -- treats NULLs as distinct in a unique index. Acceptable: there are no
  -- template rows in Phase 1.
  unique (drive_id, slug)
);

-- §5.2 — immutable published definitions. The immutability rule itself is a
-- trigger further down; schema alone can't express "only after published_at
-- is set".
create table if not exists form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id) on delete cascade,
  version int not null,
  definition jsonb not null,
  published_at timestamptz,                 -- null = still editable
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (form_id, version)
);

-- §5.3 — a link is scoped to a drive_school, never to a family.
create table if not exists form_links (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  drive_school_id uuid references drive_schools(id),   -- null = confidential/direct
  form_version_id uuid not null references form_versions(id),
  -- Plaintext on purpose (§2 "Token handling"): a form-link token permits only
  -- WRITING a submission and exposes no PII, and staff have to be able to
  -- re-copy it. Contrast review_tokens below, which permit READING children's
  -- names and are therefore hash-only.
  token text not null unique,
  label text,
  locale text not null default 'en',
  channel submission_channel not null default 'family',
  opens_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  max_submissions int,
  submission_count int not null default 0,
  is_test_data boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  -- §5.3 asks for ">= 32 bytes entropy". A length floor is all the database
  -- can actually check; it at least stops a one-word token being pasted in by
  -- hand during a hurried demo setup.
  constraint form_links_token_length check (char_length(token) >= 16)
);

create index if not exists form_links_drive_school_idx on form_links (drive_school_id);

-- §5.5 — review tokens are stored HASHED ONLY. These read a season-long roster
-- of children's first names and ages, so a database leak must not hand over a
-- working key. bcrypt via schema-qualified pgcrypto, exactly as
-- 20260818170000_fix_pgcrypto_schema_qualification.sql established
-- (`extensions.crypt` / `extensions.gen_salt`, never bare `crypt`, because
-- `set search_path = public` does not reach the schema pgcrypto lives in on
-- Supabase Cloud). No function in this file ever returns a token or a hash.
create table if not exists review_tokens (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  drive_school_id uuid references drive_schools(id),
  token_hash text not null unique,
  issued_to_email text not null,
  issued_by uuid references profiles(id),
  expires_at timestamptz not null,                     -- drive close, not 7 days (§3)
  last_used_at timestamptz,
  revoked_at timestamptz,
  is_test_data boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists review_tokens_school_idx on review_tokens (drive_school_id);

-- token_hash must LOOK like a bcrypt hash, or nothing works for anybody.
--
-- The three token-bearing functions find a token by scanning live rows and
-- calling extensions.crypt(candidate, rt.token_hash) on each. crypt() RAISES on
-- a hash it can't parse, and that raise aborts the whole scan — so ONE
-- malformed row (a hand-inserted plaintext, a truncated paste, an empty string)
-- would break every counselor at every school, not just the school that owns
-- the bad row. This constraint makes that row impossible to insert instead.
--
-- Matches the `$2a$NN$` / `$2b$NN$` / `$2y$NN$` prefix extensions.gen_salt('bf')
-- produces. Guarded so this file stays re-runnable.
do $rt$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'review_tokens_hash_is_bcrypt'
      and conrelid = 'public.review_tokens'::regclass
  ) then
    alter table review_tokens add constraint review_tokens_hash_is_bcrypt
      check (token_hash ~ '^\$2[abxy]?\$[0-9]{2}\$');
  end if;
end $rt$;

-- §5.4 — the immutable provenance record.
create table if not exists form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_link_id uuid not null references form_links(id),
  form_version_id uuid not null references form_versions(id),
  drive_id uuid not null references drives(id) on delete cascade,
  -- Denormalized from the link at submit time on purpose (§5.4): if a link is
  -- revoked or retargeted, the submission must still remember which school it
  -- came from. Also the confidential-channel discriminator: null = the
  -- confidential/direct channel (§8).
  drive_school_id uuid references drive_schools(id),
  channel submission_channel not null default 'family',
  status submission_status not null default 'draft',

  source_locale text not null default 'en',
  -- NEVER updated after insert. See the header.
  answers jsonb not null default '{}'::jsonb,
  answers_en jsonb,                        -- Phase 2 machine translation; null when source is 'en'
  translated_at timestamptz,
  translation_engine text,
  -- Counselor typo-fixes, keyed by 1-based child position:
  --   {"1": {"first_name": "Maya"}, "2": {"age": 7, "grade": "1"}}
  -- Only first_name / age / grade are ever accepted (verify_submission raises
  -- on anything else). Overlaid onto answers at read time, never merged into it.
  corrections jsonb not null default '{}'::jsonb,

  submitter_name text,
  submitter_phone text,
  submitter_email text,

  submitted_at timestamptz,
  first_viewed_at timestamptz,
  verified_at timestamptz,
  verified_by_label text,                  -- counselor's typed name; they have no profile row
  verified_via_review_token uuid references review_tokens(id),
  imported_at timestamptz,
  imported_by uuid references profiles(id),
  imported_family_id uuid references families(id),
  resolution_note text,

  -- ALWAYS NULL as of the US-20 review. See the comment on this column below.
  ip_hash text,
  user_agent text,
  is_test_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists form_submissions_queue_idx on form_submissions (drive_school_id, status);
create index if not exists form_submissions_drive_status_idx on form_submissions (drive_id, status);

comment on column form_submissions.ip_hash is
  'ALWAYS NULL in Phase 1 — submit_form deliberately writes nothing here. '
  'The original implementation stored an unsalted sha256 of the client IP; for '
  'IPv4 that is a 32-bit keyspace, brute-forcible in seconds, so it was a '
  'reversible identifier for the person who filled in the form sitting next to '
  'their children''s names — stored PII wearing a hash costume — and nothing '
  'read it (there is no per-IP rate limiting in Phase 1). The column is kept so '
  'a real per-IP control can be added without a schema change. BEFORE ANYTHING '
  'WRITES TO IT AGAIN it must be an HMAC (extensions.hmac) keyed with a secret '
  'held in Supabase Vault, never a bare digest, and it must be covered by the '
  '§10 drive-close purge.';

-- §5.6 — separate from audit_log because most actors here are NOT profiles
-- rows (anonymous families, token-bearing counselors).
create table if not exists submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references form_submissions(id) on delete cascade,
  event text not null,               -- 'submitted' | 'viewed' | 'verified' | 'rejected' | 'imported'
  actor_kind text not null,          -- 'family' | 'counselor' | 'staff' | 'system'
  actor_profile_id uuid references profiles(id),
  actor_label text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists submission_events_submission_idx
  on submission_events (submission_id, created_at);

-- =============================================================================
-- §5.7 — additive columns on existing tables
--
-- All additive; no existing column is altered or dropped. RLS on
-- families/children/wishlist_items is row-level (Postgres has no column-level
-- equivalent), so these are covered by the existing policies automatically,
-- exactly as internal_notes and is_test_data already are — no policy changes
-- needed. The `set_updated_at` row-version triggers are untouched, so the
-- concurrent-edit guard in store.tsx's saveFamilyEdit keeps working unchanged.
-- =============================================================================

-- provenance
alter table families add column if not exists source_submission_id uuid references form_submissions(id);

-- ONE family per submission, enforced by the database rather than by
-- import_submission's own bookkeeping.
--
-- import_submission's advisory lock + status re-read already serializes
-- concurrent double-clicks correctly, but both of those rest on
-- `form_submissions.status`, which an admin can UPDATE back to 'verified' by
-- hand (RLS allows it). This index is the belt-and-braces floor underneath
-- that: a second import of the same submission cannot create a second family
-- no matter what the status column says. import_submission catches the
-- unique_violation and returns the family that already exists as
-- `already_imported: true` — the same shape a double-click gets, and the same
-- pattern claim_card uses for its own race.
--
-- Partial (`where ... is not null`) so the hundreds of hand-entered families
-- with a NULL source_submission_id are unaffected; Postgres would treat those
-- NULLs as distinct anyway, but saying it explicitly keeps the index small.
create unique index if not exists families_one_per_submission
  on families (source_submission_id) where source_submission_id is not null;

-- Nullable on children ON PURPOSE (§5.7): it is what distinguishes a kid who
-- came in through a form from one a volunteer typed in by hand. Deliberately
-- NOT unique — a submission produces many children.
alter table children add column if not exists source_submission_id uuid references form_submissions(id);

-- contact info the pickup workflow implies but the schema never had
alter table families add column if not exists guardian_name text;
alter table families add column if not exists guardian_phone text;
alter table families add column if not exists guardian_email text;
alter table families add column if not exists preferred_language text not null default 'en';
alter table families add column if not exists consent_given_at timestamptz;

-- INTAKE_FORM_DRAFT.md §3.1 — the one field the draft flags as "not yet
-- proposed anywhere". Cheap now, impossible to backfill from 400 families in
-- December. Free text rather than an enum: DESIGN §7 says the distribution
-- method isn't settled year to year, so the answer set may change.
alter table families add column if not exists can_reach_church_pickup text;

-- post-verification error handling (§7)
alter table families add column if not exists needs_followup boolean not null default false;
alter table families add column if not exists followup_note text;

-- the family's own words, preserved next to the English working values (§4.2).
-- Populated at import even in Phase 1 (where they're identical to the English),
-- because §10 purges submissions at drive close — if the original only lived
-- on the submission, the purge would destroy the record of what the family
-- actually asked for.
alter table wishlist_items add column if not exists description_source text;
alter table wishlist_items add column if not exists source_locale text;
alter table children add column if not exists specific_needs_source text;
alter table children add column if not exists other_notes_source text;

-- =============================================================================
-- Triggers
-- =============================================================================

-- updated_at maintenance, same helper the init migration uses.
drop trigger if exists set_updated_at on forms;
create trigger set_updated_at before update on forms
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on form_submissions;
create trigger set_updated_at before update on form_submissions
  for each row execute function public.set_updated_at();

-- --- audit_log coverage (§5, and the header's "what is deliberately NOT here")
--
-- The generic audit trigger goes on the two ADMIN-ONLY-WRITE tables, and only
-- those two. Both are written exclusively by signed-in staff, so
-- `audit_log.changed_by uuid references profiles(id)` can always represent the
-- actor; neither holds a child's name, age, wishlist or sizes, so auditing them
-- does not smuggle family PII into a table §10's drive-close purge never
-- touches.
--
--   review_tokens  — the important one. A review token is the key to a school's
--                    whole-season roster of children's first names and ages.
--                    Without this trigger there is no record anywhere of who
--                    issued one, to which address, or who revoked it.
--   form_links     — who created, retargeted, or revoked a link, and when.
--
-- Two things to know before reading the resulting rows:
--   * form_links.token is plaintext by design (§2), so it lands in audit_log's
--     `diff`. audit_log is `select` for is_admin() only, and a link token
--     permits only WRITING a submission, so this exposes nothing to a
--     volunteer that the form_links policy below doesn't already withhold.
--     review_tokens contributes only its bcrypt hash — the plaintext exists
--     nowhere in the database, including here.
--   * submit_form increments form_links.submission_count, so a normal family
--     submission writes one audit_log row per submission. That is expected
--     noise, not a bug, and it is bounded by max_submissions.
--
-- forms / form_versions stay UNAUDITED on purpose: `form_versions` is already
-- append-only (a published definition cannot be edited — see the immutability
-- trigger below — so the version rows ARE their own history, and each one
-- carries created_by/created_at), and `forms` holds nothing but a drive id,
-- slug, and display name. Auditing either would add rows that duplicate what
-- the tables already say.
drop trigger if exists audit_form_links on form_links;
create trigger audit_form_links after insert or update or delete on form_links
  for each row execute function public.audit_log_change();

drop trigger if exists audit_review_tokens on review_tokens;
create trigger audit_review_tokens after insert or update or delete on review_tokens
  for each row execute function public.audit_log_change();

-- §5.2 — "Enforce immutability with a trigger rejecting update on definition
-- once published_at is set. Schema alone can't express it, and it's exactly the
-- rule that gets broken by accident."
--
-- Also refuses to un-publish or re-date a published version: letting
-- published_at be cleared would be a trivial two-step bypass of the definition
-- lock. A published version is append-only — to change the questionnaire, add
-- a NEW version row and repoint the link at it (which is what
-- intake_demo_seed.sql does).
create or replace function public.prevent_published_form_version_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.published_at is not null then
    if new.definition is distinct from old.definition then
      raise exception
        'form_versions.definition is immutable once published (form %, version %). Publish a new version instead.',
        old.form_id, old.version;
    end if;
    if new.published_at is distinct from old.published_at then
      raise exception
        'form_versions.published_at cannot be changed or cleared once set (form %, version %).',
        old.form_id, old.version;
    end if;
  end if;
  return new;
end;
$$;

-- Not `security definer`: this is a guard that must run with no elevated
-- privilege of its own, and a `returns trigger` function is not callable
-- through PostgREST or directly in SQL, so it has no RPC surface to lock down.
-- Revoked from public/anon anyway for hygiene; `authenticated` is left alone
-- deliberately, since that is the role whose UPDATEs must still be able to
-- fire it.
revoke execute on function public.prevent_published_form_version_edit() from public, anon;

drop trigger if exists form_versions_immutable_once_published on form_versions;
create trigger form_versions_immutable_once_published
  before update on form_versions
  for each row execute function public.prevent_published_form_version_edit();

-- =============================================================================
-- Helper functions
--
-- These seven are PRIVATE: execute is revoked from public, anon AND
-- authenticated. They are only ever called from inside the security definer
-- functions below, where permission is checked against the function owner
-- (who retains execute), not the caller — same reasoning as any other
-- internal helper. The one exception is
-- submission_is_confidential_channel(), which is evaluated inside an RLS
-- policy and therefore genuinely needs `authenticated` to hold execute.
--
-- Six of the seven are deliberately NOT `security definer`, unlike every
-- callable function in this file: intake_apply_corrections(),
-- intake_validate_field(), intake_repeating_section_id(),
-- intake_correctable_field_ids(), intake_repeating_field_options() and
-- intake_repeating_field_def() are pure jsonb/constant
-- transformations that read no table and hold no privilege worth elevating, so
-- marking them definer would add privilege for no reason. They still carry an
-- explicit `set search_path` and an explicit revoke. Only
-- submission_is_confidential_channel() reads a table, and it is definer
-- precisely because it has to see rows the calling volunteer cannot.
-- =============================================================================

-- Confidentiality resolver for submission_events' RLS policy.
--
-- This exists rather than an inline subquery for the reason
-- 20260811120000_fix_confidential_rls_subquery_leak.sql documents at length: a
-- subquery inside a policy runs as the CALLING user and is therefore subject
-- to the referenced table's own RLS, which is how the original
-- children/cards/wishlist_items policies leaked. Resolving it through a
-- security definer helper reads form_submissions with the owner's privileges
-- and gives the same answer to every caller.
--
-- Fails CLOSED: an unknown submission id answers "confidential".
create or replace function public.submission_is_confidential_channel(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.drive_school_id is null from form_submissions s where s.id = p_submission_id),
    true
  );
$$;

revoke execute on function public.submission_is_confidential_channel(uuid) from public, anon;
grant execute on function public.submission_is_confidential_channel(uuid) to authenticated;

-- Which section of a definition is the repeating (per-child) one, by id.
--
-- Everything that walks a submission's children has to agree with what
-- submit_form validated, and submit_form finds the child block by its
-- `repeating: true` flag rather than by name. Reading the id from the pinned
-- definition here is what keeps get_review_roster and import_submission honest
-- if a future version names that section something other than "children" — the
-- alternative (hard-coding the key) fails SILENTLY, importing a family with
-- zero children, which is the worst possible way for this to break.
--
-- Returns NULL when the definition has no repeating section. Every caller
-- treats that as a loud error, never as "no children".
--
-- First match wins: a definition with two repeating sections is not a shape
-- anything in this feature supports, and submit_form would validate both.
create or replace function public.intake_repeating_section_id(p_definition jsonb)
returns text
language sql
stable
set search_path = public
as $$
  select nullif(s.sec ->> 'id', '')
  from jsonb_array_elements(coalesce(p_definition -> 'sections', '[]'::jsonb)) as s(sec)
  where coalesce((s.sec ->> 'repeating')::boolean, false)
    and nullif(s.sec ->> 'id', '') is not null
  limit 1;
$$;

revoke execute on function public.intake_repeating_section_id(jsonb) from public, anon, authenticated;

-- The three per-child fields a counselor is allowed to correct (§3), as ONE
-- list, in ONE place.
--
-- This is the only hard-coded field-id list in this feature, and it is
-- deliberately hard-coded: it is a policy decision about what a counselor may
-- write into a child's record, not something a form definition gets to widen.
-- Everything ELSE about these fields (their labels, types, bounds and options)
-- is read from the pinned definition — see intake_repeating_field_def().
--
-- It exists as a function rather than as two copies of `array['first_name',
-- 'age','grade']` because two consumers have to agree exactly:
--   verify_submission()  — raises on any correction key outside this list.
--   get_review_roster()  — returns a `correction_fields` entry for each id in
--                          it, which is what the counselor's page renders an
--                          editable control from.
-- If those two lists ever drifted, the roster would offer a control whose
-- value the server refuses (or silently withhold one it would have accepted).
create or replace function public.intake_correctable_field_ids()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['first_name', 'age', 'grade']::text[];
$$;

revoke execute on function public.intake_correctable_field_ids() from public, anon, authenticated;

-- The `options` list of ONE field inside the repeating (per-child) section of a
-- definition, normalized to [{"value": ..., "label": ...}, ...].
--
-- Why this exists: a counselor may correct grade (§3), and verify_submission
-- validates that correction against the SAME pinned definition the family's
-- original answer was validated against — so a roster that offers a free-text
-- grade box is offering values the server will reject. get_review_roster hands
-- the real option list to the page instead, inside the `options` slot of its
-- `correction_fields` payload, which is what lets the roster render a picker
-- rather than a text input. It is
-- deliberately parameterized by field id rather than hard-coding 'grade', and
-- it finds the section through intake_repeating_section_id() rather than
-- assuming 'children', for the same reason every other caller does.
--
-- Nothing outside intake_repeating_field_def() calls this any more; it stays a
-- function of its own so option normalization (drop blank values, fall back
-- label -> value, preserve definition order) has exactly one implementation.
--
-- NOT a privacy widening. Everything this reads lives in
-- `form_versions.definition` — the BLANK questionnaire, which anon already
-- receives in full from get_form() for any live link. It contains no submission
-- data, no family, and no child.
--
-- Returns '[]' for: a null definition, no repeating section, no such field,
-- a field with no `options`, or options that aren't an array. Never raises —
-- unlike intake_repeating_section_id's callers, a missing grade field is a
-- legitimate shape (a form version that doesn't collect grade), and the roster
-- must still render for it. Options with a null/blank `value` are dropped,
-- because a picker entry that can't be submitted is worse than one that isn't
-- offered; `label` falls back to `value`.
create or replace function public.intake_repeating_field_options(
  p_definition jsonb,
  p_field_id text
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with field as (
    -- First field with this id inside the repeating section. `limit 1` because
    -- a definition with two fields sharing an id is malformed, and submit_form
    -- would validate against the first one too.
    select f.fld as fld
    -- Every jsonb_array_elements() call in here is guarded by a jsonb_typeof
    -- check rather than a bare coalesce: that function RAISES on an object, and
    -- this one is documented never to raise. A malformed definition yields an
    -- empty picker, not a broken roster. (Guarding also means
    -- intake_repeating_section_id() below is never reached for such a
    -- definition, so its own unguarded call can't raise here either.)
    from jsonb_array_elements(
           case when jsonb_typeof(p_definition -> 'sections') = 'array'
                then p_definition -> 'sections' else '[]'::jsonb end
         ) as s(sec)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(s.sec -> 'fields') = 'array'
           then s.sec -> 'fields' else '[]'::jsonb end
    ) as f(fld)
    where nullif(s.sec ->> 'id', '') = public.intake_repeating_section_id(p_definition)
      and f.fld ->> 'id' = p_field_id
    limit 1
  )
  select coalesce(
    (
      select jsonb_agg(
               jsonb_build_object(
                 'value', o.opt ->> 'value',
                 'label', coalesce(nullif(o.opt ->> 'label', ''), o.opt ->> 'value')
               )
               -- Definition order is meaningful (Pre-K, K, 1, 2 ...), so it is
               -- preserved explicitly rather than left to the aggregate.
               order by o.ord
             )
      from jsonb_array_elements(
             coalesce(
               (select case when jsonb_typeof(field.fld -> 'options') = 'array'
                            then field.fld -> 'options' end
                from field),
               '[]'::jsonb
             )
           ) with ordinality as o(opt, ord)
      where jsonb_typeof(o.opt) = 'object'
        and nullif(o.opt ->> 'value', '') is not null
    ),
    '[]'::jsonb
  );
$$;

revoke execute on function public.intake_repeating_field_options(jsonb, text) from public, anon, authenticated;

-- The WHOLE definition of ONE field inside the repeating (per-child) section,
-- normalized to the fixed shape the counselor's roster renders a control from:
--
--   {"id","label","type","required","max_length","min","max","options"}
--
-- Returns SQL NULL when the field is absent — from a null/malformed definition,
-- a definition with no repeating section, or a version that simply doesn't
-- collect that field. NULL means "this control has no rule behind it", and
-- get_review_roster passes it through as JSON null so the page renders that
-- field READ-ONLY. It must never fall back to a free-text box: a control with
-- no definition behind it is exactly the drift this function exists to remove.
--
-- Why the whole field and not just its options: the counselor's roster needs
-- every rule verify_submission will hold the correction to, not one of them.
-- The three gaps this closes, all found by building the screen rather than
-- reading the spec:
--   * grade      — `options`, so the control is a picker over the same list
--                  the family's original answer was validated against.
--   * age        — `min`/`max`, which were hard-coded 0/19 in the JSX and had
--                  no way to stay in step with the definition.
--   * first_name — `max_length`. The roster input allowed 120 characters while
--                  the definition says 80, so an 81-120 character corrected
--                  name passed the browser and then RAISED
--                  "Correction rejected: Please keep First name under 80
--                  characters", losing the counselor's whole approve click.
--                  That one was already reachable in the shipped roster.
--
-- NOT a privacy widening. Everything this reads lives in
-- `form_versions.definition` — the BLANK questionnaire, which anon already
-- receives in full from get_form() for any live link. It contains no submission
-- data, no family, and no child.
--
-- NEVER RAISES, for any input. Every read is either a `->>` (which is
-- null-safe) or guarded by a jsonb_typeof check, and the three numeric
-- properties are matched against an integer regex on their TEXT form before any
-- cast. That regex accepts both a JSON number (80) and a numeric string ("80"),
-- which is exactly what intake_validate_field's own `::int` / `::bigint` casts
-- tolerate — so a bound reported here is a bound the validator will actually
-- apply. Anything else (a float, a word, an object) reports NULL rather than
-- aborting the roster.
--
-- `required` is read only when it is a genuine JSON boolean; a string "yes"
-- reports false rather than raising on the cast.
create or replace function public.intake_repeating_field_def(
  p_definition jsonb,
  p_field_id text
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with field as (
    -- Same walk, same guards, same "first match wins" rule as
    -- intake_repeating_field_options: sections and fields are only iterated
    -- when they really are arrays, because jsonb_array_elements RAISES on an
    -- object and this function is documented never to raise.
    select f.fld as fld
    from jsonb_array_elements(
           case when jsonb_typeof(p_definition -> 'sections') = 'array'
                then p_definition -> 'sections' else '[]'::jsonb end
         ) as s(sec)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(s.sec -> 'fields') = 'array'
           then s.sec -> 'fields' else '[]'::jsonb end
    ) as f(fld)
    where nullif(s.sec ->> 'id', '') = public.intake_repeating_section_id(p_definition)
      and f.fld ->> 'id' = p_field_id
    limit 1
  )
  select jsonb_build_object(
           'id',    coalesce(nullif(field.fld ->> 'id', ''), p_field_id),
           -- Same label fallback intake_validate_field uses for its messages,
           -- so the control's caption and the server's error name one thing.
           'label', coalesce(nullif(field.fld ->> 'label', ''), field.fld ->> 'id', p_field_id),
           -- Same default intake_validate_field applies to a typeless field.
           'type',  coalesce(nullif(field.fld ->> 'type', ''), 'text'),
           'required', case when jsonb_typeof(field.fld -> 'required') = 'boolean'
                            then (field.fld ->> 'required')::boolean else false end,
           'max_length', case when coalesce(field.fld ->> 'max_length', '') ~ '^-?[0-9]{1,9}$'
                              then (field.fld ->> 'max_length')::int end,
           'min',        case when coalesce(field.fld ->> 'min', '') ~ '^-?[0-9]{1,9}$'
                              then (field.fld ->> 'min')::int end,
           'max',        case when coalesce(field.fld ->> 'max', '') ~ '^-?[0-9]{1,9}$'
                              then (field.fld ->> 'max')::int end,
           -- Always an array, never null: an empty picker list and "no options
           -- key at all" are the same thing to the page.
           'options', public.intake_repeating_field_options(p_definition, p_field_id)
         )
  from field;
$$;

revoke execute on function public.intake_repeating_field_def(jsonb, text) from public, anon, authenticated;

-- Overlays a validated corrections payload onto an answers blob. Pure; never
-- writes. `answers` itself is never modified anywhere in this file — this is
-- how a corrected value reaches the counselor's roster and the import without
-- touching the provenance record.
--
-- Corrections are keyed by 1-BASED child position, matching children.child_index
-- (which is also 1-based), specifically so nobody has to remember an off-by-one
-- between the JSON array and the imported rows.
--
-- `p_section_id` is the repeating section's id, resolved by the caller from the
-- pinned definition via intake_repeating_section_id(). It has NO default on
-- purpose: a default of 'children' is exactly the silent hard-coding this
-- parameter exists to remove.
--
-- DESTRUCTIVE (see the APPLY STATUS callout at the top of this file). The
-- 2-argument form is dropped rather than left as an overload — an overload would
-- let a future caller pick up the hard-coded key by accident. On a database that
-- never saw a draft of this file, the 2-argument form does not exist and this is
-- a no-op; on one that DID receive an earlier draft, this drops a live function.
-- Either way the 3-argument form below is the only one that survives, which is
-- the point.
drop function if exists public.intake_apply_corrections(jsonb, jsonb);

create or replace function public.intake_apply_corrections(
  p_answers jsonb,
  p_corrections jsonb,
  p_section_id text
)
returns jsonb
language plpgsql
-- `stable`, not `immutable`: it is in fact pure, but nothing here is used in
-- an index or a generated column, and `stable` costs nothing while removing
-- any chance of the planner constant-folding something it shouldn't.
stable
set search_path = public
as $$
declare
  v_children jsonb;
  v_out jsonb;
  v_i int;
  v_fix jsonb;
begin
  if p_answers is null then
    return p_answers;
  end if;
  if p_corrections is null or p_corrections = '{}'::jsonb or jsonb_typeof(p_corrections) <> 'object' then
    return p_answers;
  end if;
  if p_section_id is null or p_section_id = '' then
    raise exception
      'intake_apply_corrections: no repeating section id given — the caller must resolve it from the pinned definition.';
  end if;

  v_children := p_answers -> p_section_id;
  if v_children is null or jsonb_typeof(v_children) <> 'array' then
    return p_answers;
  end if;

  v_out := v_children;
  for v_i in 0 .. jsonb_array_length(v_children) - 1 loop
    v_fix := p_corrections -> ((v_i + 1)::text);
    if v_fix is not null and jsonb_typeof(v_fix) = 'object' then
      -- Shallow merge, correction wins. Only ever the three allowed keys —
      -- verify_submission raises before anything else can get in here.
      v_out := jsonb_set(v_out, array[v_i::text], (v_out -> v_i) || v_fix);
    end if;
  end loop;

  return jsonb_set(p_answers, array[p_section_id], v_out);
end;
$$;

revoke execute on function public.intake_apply_corrections(jsonb, jsonb, text) from public, anon, authenticated;

-- Validates ONE field of a submitted answer object against ONE field
-- definition from the pinned form_versions.definition, and returns a jsonb
-- ARRAY of {field, message} errors (empty array = valid).
--
-- Everything the story's acceptance criteria list as a server-side rule —
-- required fields, age 0-19, grade in the allowed list, 1-3 wishlist items
-- with the first required — is expressed as a property of the field in the
-- definition, not hard-coded here. That is what makes "validates server-side
-- against the pinned version" literally true: change the definition, publish a
-- new version, and the server's rules move with it.
--
-- Field properties understood:
--   id, label, type, required
--   type 'text' | 'phone' | 'email' | 'number' | 'select' | 'checkbox' | 'text_list'
--   max_length            (text-ish and each text_list entry)
--   min / max             (number)
--   options[{value,label}](select — membership is the "grade in the allowed list" rule)
--   other_field / other_value
--                         (select — "Other (describe)" escape hatch: choosing
--                          other_value makes other_field required, and NOT
--                          choosing it makes other_field forbidden — see the
--                          block marked H1 below, which is the one rule in here
--                          protecting a free-text value that reaches the public
--                          sponsor page)
--   min_items / max_items / first_required
--                         (text_list — the wishlist rule)
--
-- The invariant this function has to hold, and the one it broke: EVERY key of
-- the answer object that import_submission will later read must be reached by a
-- validation rule on every code path. A rule that is only reachable inside an
-- `if` on some other field's value is not a rule — it is a rule a hostile
-- payload gets to opt out of by setting that other field.
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

  -- text_list (the wishlist) ------------------------------------------------
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
        -- Same class of bug as H1 below: a non-string element used to be
        -- silently skipped here (not counted, not length-checked), so
        -- ["a real idea", {...20KB of junk...}] passed validation whole —
        -- min_items was satisfied by element 0 — and import_submission then
        -- wrote `->> 1`, the JSON text of that object, into wishlist_items
        -- .description, which the sponsor page and the printed card show.
        -- Truncation at import bounds it; this rejects it.
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

  -- scalar types ------------------------------------------------------------
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

  -- H1 — the "Other (describe)" escape hatch --------------------------------
  --
  -- Evaluated HERE, immediately after the value is readable, and NOT inside the
  -- select branch far below, because every branch between here and there can
  -- `return` first. That is the whole bug: the old code only looked at
  -- `other_field` when the select's own value equaled `other_value`, so
  --
  --     {"shirt_size": "Youth M", "shirt_size_other": "<99KB of anything>"}
  --
  -- validated clean — every NAMED field is fine, and the only bound left was
  -- submit_form's 100KB body cap. import_submission prefers the `_other` text
  -- over the select value, so that string became children.shirt_size, which
  -- public_available_cards publishes to `anon` and the printed card renders.
  -- A missing, blank, or not-in-the-options select value had the same effect,
  -- since those paths return above this point too.
  --
  -- Rules, in order:
  --   * `_other` present and non-blank while the select is NOT other_value
  --     (including absent/blank/invalid) -> REJECT. A client that moves the
  --     select off "Other" must clear the text box; a leftover value is a bug,
  --     and silently accepting it is how the free-text string got through.
  --   * select IS other_value, `_other` blank    -> required.
  --   * select IS other_value, `_other` too long -> the field's own max_length,
  --     defaulting to 80 when the definition doesn't set one.
  -- A blank or absent `_other` next to a normal select is normal and says
  -- nothing.
  --
  -- Errors are ACCUMULATED into v_errors rather than returned, so every
  -- `return v_errors ...` below carries them out.
  v_other_field := nullif(p_field->>'other_field', '');
  if v_other_field is not null then
    v_other_value := coalesce(p_field->>'other_value', 'Other');
    -- `->>` on a non-string (object/array/number) yields its text form, which
    -- is non-empty, so a structured payload lands in the reject branch instead
    -- of slipping past as "absent".
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
      -- Explicit column alias list, not a bare table alias: a bare alias on a
      -- set-returning function renames the output column, which would make a
      -- `value`-named reference here resolve to the row instead of the jsonb.
      select 1 from jsonb_array_elements(p_field->'options') as opt(item)
      where item ->> 'value' = v_text
    ) then
      return v_errors || jsonb_build_object(
        'field', v_path,
        'message', format('Please choose one of the listed options for %s.', v_label)
      );
    end if;

    -- The `other_field` rules used to live here, reachable only when the select
    -- had already passed the options check AND equaled other_value. They now
    -- run unconditionally, further up — see the block marked H1.
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

-- =============================================================================
-- Row Level Security (§9)
--
--                    | Anonymous | Counselor  | Volunteer | Admin      | Confidential-cleared
--  forms/versions    | none      | none       | read      | read/write | read/write
--  form_links        | none      | none       | read      | read/write | read/write
--  submissions (sch) | none      | via fn     | read      | read/write | read/write
--  submissions (conf)| none      | none       | NONE      | NONE       | read/write
--  review_tokens     | none      | none       | none      | write-only | write-only
--  submission_events | none      | none       | read      | read       | read
--
-- "Anonymous: none" is literal. anon gets NO policy and NO table grant on any
-- of the six tables — every anonymous path in this feature runs through a
-- security definer function instead. Because OPEN_QUESTIONS **DB-2** confirmed
-- (live, against this dev project) that Supabase's platform default privileges
-- auto-grant anon SELECT on new base tables regardless of what a migration's
-- own grant lines say, the revoke below is issued EXPLICITLY rather than
-- relying on simply not granting.
-- =============================================================================

alter table forms enable row level security;
alter table form_versions enable row level security;
alter table form_links enable row level security;
alter table review_tokens enable row level security;
alter table form_submissions enable row level security;
alter table submission_events enable row level security;

-- forms / form_versions / form_links: staff read, admin write ---------------
--
-- Checked while fixing form_links' select policy below: do `forms` and
-- `form_versions` need the same confidential gate? NO, and the reason is
-- structural, not a judgement call — neither table has a `drive_school_id`,
-- and neither carries anything that differs between the school and
-- confidential channels. `forms` is a drive id, a slug and a display name;
-- `form_versions` is the blank questionnaire, which is the same document the
-- anon `get_form` hands to any visitor holding a link. There is no
-- confidential-channel fact in either one to leak: the channel lives entirely
-- in `form_links.drive_school_id` (and is denormalized onto
-- `form_submissions`), and both of those are gated. Leaving these two readable
-- by any signed-in volunteer is also what lets a staff screen render a
-- submission against the version it pinned.
drop policy if exists "staff read forms" on forms;
create policy "staff read forms" on forms for select to authenticated using (true);
drop policy if exists "admin insert forms" on forms;
create policy "admin insert forms" on forms for insert to authenticated with check (is_admin());
drop policy if exists "admin update forms" on forms;
create policy "admin update forms" on forms for update to authenticated
  using (is_admin()) with check (is_admin());
drop policy if exists "admin delete forms" on forms;
create policy "admin delete forms" on forms for delete to authenticated using (is_admin());

drop policy if exists "staff read form_versions" on form_versions;
create policy "staff read form_versions" on form_versions for select to authenticated using (true);
drop policy if exists "admin insert form_versions" on form_versions;
create policy "admin insert form_versions" on form_versions for insert to authenticated with check (is_admin());
-- Update is admin-gated AND additionally constrained by the immutability
-- trigger above, which no policy can express.
drop policy if exists "admin update form_versions" on form_versions;
create policy "admin update form_versions" on form_versions for update to authenticated
  using (is_admin()) with check (is_admin());
drop policy if exists "admin delete form_versions" on form_versions;
create policy "admin delete form_versions" on form_versions for delete to authenticated using (is_admin());

-- form_links holds the plaintext form token, which is fine for staff to read
-- for a SCHOOL link: it permits only writing a submission, and any volunteer
-- can already create a family directly. This read is also what satisfies §11's
-- "build the manual fallback on day one" — a staff screen that shows the link
-- so it can be sent by hand.
--
-- The confidential channel is a different matter, and this policy was `using
-- (true)`. A confidential-channel link is the row with `drive_school_id is
-- null`, so an uncleared volunteer could read (a) that the confidential channel
-- exists at all, (b) `submission_count` — a running tally of how many
-- confidential registrations have come in this season, which is itself a fact
-- about identifiable families in a small town — and (c) the plaintext token,
-- letting them file submissions into a queue they are not allowed to read.
-- Same gate as form_submissions, for the same reason.
drop policy if exists "staff read form_links" on form_links;
create policy "staff read form_links" on form_links for select to authenticated
  using (drive_school_id is not null or can_view_confidential());
-- The writes carry the same gate as the read, so the select gate above can't be
-- walked around with `update ... returning token` (PostgREST appends RETURNING
-- to every write, and an UPDATE's `using` clause is a read). Redundant today —
-- can_view_confidential() clears every admin — and deliberately not so if that
-- helper is ever tightened to §8's "two named staff".
drop policy if exists "admin insert form_links" on form_links;
create policy "admin insert form_links" on form_links for insert to authenticated
  with check (is_admin() and (drive_school_id is not null or can_view_confidential()));
drop policy if exists "admin update form_links" on form_links;
create policy "admin update form_links" on form_links for update to authenticated
  using (is_admin() and (drive_school_id is not null or can_view_confidential()))
  with check (is_admin() and (drive_school_id is not null or can_view_confidential()));
drop policy if exists "admin delete form_links" on form_links;
create policy "admin delete form_links" on form_links for delete to authenticated
  using (is_admin() and (drive_school_id is not null or can_view_confidential()));

-- form_submissions ----------------------------------------------------------
--
-- The confidential gate is `drive_school_id is not null or
-- can_view_confidential()`. A volunteer without clearance gets ZERO ROWS for a
-- confidential-channel submission — not an error, exactly like a confidential
-- family already behaves — so the staff queue screen shows nothing rather than
-- hiding something client-side.
--
-- `can_view_confidential()`, never `role = 'admin'` (§8). See the header for
-- the note that the helper currently clears every admin.
--
-- No per-volunteer drive scoping: this schema has no notion of a staff member
-- belonging to a drive (every authenticated user can already read every
-- `drives` row), so §9's "read own drive" is a UI filter, not a policy.

drop policy if exists "staff read form_submissions" on form_submissions;
create policy "staff read form_submissions" on form_submissions for select to authenticated
  using (drive_school_id is not null or can_view_confidential());

drop policy if exists "admin insert form_submissions" on form_submissions;
create policy "admin insert form_submissions" on form_submissions for insert to authenticated
  with check (is_admin() and (drive_school_id is not null or can_view_confidential()));

drop policy if exists "admin update form_submissions" on form_submissions;
create policy "admin update form_submissions" on form_submissions for update to authenticated
  using (is_admin() and (drive_school_id is not null or can_view_confidential()))
  with check (is_admin() and (drive_school_id is not null or can_view_confidential()));

drop policy if exists "admin delete form_submissions" on form_submissions;
create policy "admin delete form_submissions" on form_submissions for delete to authenticated
  using (is_admin() and (drive_school_id is not null or can_view_confidential()));

-- review_tokens -------------------------------------------------------------
--
-- WRITE-ONLY, per §9. Deliberately NO select policy at all — not even for
-- admins. The only thing in this table worth reading is the bcrypt hash, and
-- nothing legitimate needs it: the plaintext is shown once at issue time and a
-- counselor who loses theirs gets a new one (§2).
--
-- Consequence worth knowing before building a staff "issue a review link" UI:
-- PostgREST appends RETURNING to every insert, so an insert from the client
-- will fail on the missing select policy unless it sends
-- `Prefer: return=minimal`. Phase 1 seeds tokens in SQL
-- (supabase/intake_demo_seed.sql), so nothing hits this yet. If a token
-- management screen is ever wanted, add a VIEW over the non-secret columns
-- (school, issued_to_email, expires_at, revoked_at) rather than opening a
-- select policy on the table itself.
drop policy if exists "admin issue review_tokens" on review_tokens;
create policy "admin issue review_tokens" on review_tokens for insert to authenticated
  with check (is_admin() and (drive_school_id is not null or can_view_confidential()));

drop policy if exists "admin revoke review_tokens" on review_tokens;
create policy "admin revoke review_tokens" on review_tokens for update to authenticated
  using (is_admin() and (drive_school_id is not null or can_view_confidential()))
  with check (is_admin() and (drive_school_id is not null or can_view_confidential()));

-- submission_events ---------------------------------------------------------
--
-- Read-only for staff, and gated on the parent submission's channel through
-- the security definer helper (NOT an inline subquery — see that function's
-- comment). detail can carry a correction payload with children's first names,
-- so it inherits the submission's confidentiality rather than being open.
-- No insert/update/delete policy at all: events are written only by the
-- security definer functions below.
drop policy if exists "staff read submission_events" on submission_events;
create policy "staff read submission_events" on submission_events for select to authenticated
  using (not submission_is_confidential_channel(submission_id) or can_view_confidential());

-- =============================================================================
-- Grants
-- (RLS decides *which rows*; these decide whether a role may attempt the
-- operation on the table at all. Revoke first — closing DB-2's platform
-- default — then grant deliberately.)
-- =============================================================================

-- `public` is included alongside the two named roles so this holds whether the
-- platform's default privilege is a per-role grant (which DB-2 found it to be)
-- or an inherited PUBLIC one. Table owner and service_role are unaffected.
revoke all on forms             from public, anon, authenticated;
revoke all on form_versions     from public, anon, authenticated;
revoke all on form_links        from public, anon, authenticated;
revoke all on review_tokens     from public, anon, authenticated;
revoke all on form_submissions  from public, anon, authenticated;
revoke all on submission_events from public, anon, authenticated;

-- Nothing is granted to anon on any of these, ever. The anon surface for this
-- feature is exactly five function grants, further down.
grant select, insert, update, delete on forms, form_versions, form_links to authenticated;
grant select, insert, update, delete on form_submissions to authenticated;
grant select on submission_events to authenticated;
grant insert, update on review_tokens to authenticated;   -- no select: see the policy note above

-- =============================================================================
-- get_form(token)
--
-- Caller: anon (a family opening the link on their phone).
-- Returns: the pinned version's definition + the link's own school display
-- name, and NOTHING else. No counselor contact, no liaison email, no drive
-- internals, no prior submissions, no family or child data of any kind. The
-- select list below is the whole story — it reads exactly three tables
-- (form_links, form_versions, and drive_schools -> schools for the display
-- name) and returns three keys.
--
-- Shape:
--   { "ok": true,  "definition": {...}, "school_name": "Demo Elementary North"|null,
--     "locale": "en" }
--   { "ok": false, "error": "<friendly text>", "reason":
--       "not_found"|"expired"|"not_yet_open"|"full"|"unpublished"|"drive_closed" }
--
-- There is NO "revoked" reason, and that is deliberate: a revoked token and a
-- token that never existed both answer `not_found`, with the same user-facing
-- message, exactly as submit_form already does. `reason` is machine-readable
-- and reaches the browser, so a distinct "revoked" would confirm to an
-- unauthenticated caller that a given token was real — which is the one thing
-- an anon-callable lookup should not do. A dead link also has nothing useful to
-- say to the family either way: the message is the same "ask your counselor for
-- a current link" in both cases.
--
-- The other five reasons stay distinct because each one has a genuinely
-- different family-facing message ("not open yet" vs. "registration closed" vs.
-- "this school is full"), and none of them reveals anything the holder of the
-- link doesn't already know.
--
-- Keep this list identical to FormLinkProblem in web/lib/intake.ts.
-- =============================================================================

create or replace function public.get_form(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link record;
  v_definition jsonb;
  v_school_name text;
  v_inactive_msg constant text :=
    'This form link isn''t open right now. Please check with your school counselor for a current link.';
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_found');
  end if;

  select l.*, d.status as drive_status
    into v_link
  from form_links l
  join drives d on d.id = l.drive_id
  where l.token = btrim(p_token)
  limit 1;

  -- `not found` rather than `v_link is null`: v_link is an untyped `record`,
  -- and FOUND is the unambiguous "the select returned no row" test for one.
  if not found then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_found');
  end if;

  -- 'not_found', NOT 'revoked' — see the header. Same answer submit_form gives.
  if v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_found');
  end if;
  if v_link.opens_at is not null and v_link.opens_at > now() then
    return jsonb_build_object(
      'ok', false,
      'error', 'This form isn''t open yet. Please check back once registration opens.',
      'reason', 'not_yet_open'
    );
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    return jsonb_build_object(
      'ok', false,
      'error', 'Registration has closed for this school. Please contact your school counselor.',
      'reason', 'expired'
    );
  end if;
  if v_link.max_submissions is not null and v_link.submission_count >= v_link.max_submissions then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'full');
  end if;
  -- A closed or archived drive must not keep taking registrations. Same class
  -- of gap SPN-1 found in public_available_cards, closed here up front.
  if v_link.drive_status not in ('draft', 'open') then
    return jsonb_build_object(
      'ok', false,
      'error', 'Registration has closed for this year. Please contact your school counselor.',
      'reason', 'drive_closed'
    );
  end if;

  select v.definition into v_definition
  from form_versions v
  where v.id = v_link.form_version_id and v.published_at is not null;

  if v_definition is null then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'unpublished');
  end if;

  -- The school's display NAME only. Never schools.liaison_* (that's the
  -- counselor's own contact info), never drive_schools.code, never notes.
  select s.name into v_school_name
  from drive_schools ds
  join schools s on s.id = ds.school_id
  where ds.id = v_link.drive_school_id;

  return jsonb_build_object(
    'ok', true,
    'definition', v_definition,
    'school_name', v_school_name,
    'locale', v_link.locale
  );
end;
$$;

revoke execute on function public.get_form(text) from public;
grant execute on function public.get_form(text) to anon, authenticated;

-- =============================================================================
-- submit_form(token, answers, contact, honeypot)
--
-- Caller: anon (a family, or a counselor/staff member using a direct-entry
-- link).
--
-- `p_answers` is stored BYTE-FOR-BYTE as submitted, in `answers`. This function
-- reads it to validate, and never rewrites it.
--
-- Validation is SERVER-SIDE against the pinned form_versions.definition —
-- client validation is a convenience, not a control. Every rule the story
-- lists (required fields, at least one child, age 0-19, grade in the allowed
-- list, 1-3 wishlist items with the first required) comes out of the
-- definition via intake_validate_field, so it cannot drift from what the form
-- actually rendered.
--
-- HONEYPOT: if `p_honeypot` is non-empty, this returns the SAME success shape a
-- real submission returns, writes no row, and does not increment
-- submission_count. The check runs before validation and before the counter
-- update on purpose — a bot must never be able to tell the difference, not
-- even from a validation error.
--
-- Shape:
--   { "ok": true,  "status": "submitted"|"verified" }
--   { "ok": false, "error": "<summary>", "errors": [{"field":"...","message":"..."}] }
--   { "ok": false, "error": "<friendly>", "reason": "not_found"|... }   (link problems)
--
-- Nothing about the submission is echoed back: no id, no PII (US-21 requires
-- the confirmation screen to show neither).
-- =============================================================================

create or replace function public.submit_form(
  p_token text,
  p_answers jsonb,
  p_contact jsonb default null,
  p_honeypot text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_definition jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_section record;
  v_field record;
  v_items jsonb;
  v_i int;
  v_min_children int;
  v_max_children int;
  v_status submission_status;
  v_actor_kind text;
  v_submission_id uuid;
  v_headers jsonb := '{}'::jsonb;
  v_user_agent text;
  v_contact jsonb := coalesce(p_contact, '{}'::jsonb);
  v_name text;
  v_phone text;
  v_email text;
  v_new_count int;
  v_inactive_msg constant text :=
    'This form link isn''t open right now. Please check with your school counselor for a current link.';
begin
  -- 1. Resolve the link. ----------------------------------------------------
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_found');
  end if;

  select l.*, d.status as drive_status
    into v_link
  from form_links l
  join drives d on d.id = l.drive_id
  where l.token = btrim(p_token)
  limit 1;

  -- FOUND, not `v_link is null` — see the same note in get_form.
  if not found then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_found');
  end if;
  if v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_found');
  end if;
  if v_link.opens_at is not null and v_link.opens_at > now() then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_yet_open');
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'expired');
  end if;
  if v_link.drive_status not in ('draft', 'open') then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'drive_closed');
  end if;

  select v.definition into v_definition
  from form_versions v
  where v.id = v_link.form_version_id and v.published_at is not null;

  if v_definition is null then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'unpublished');
  end if;

  -- Channels 'counselor' and 'staff' jump straight to verified (§3): the
  -- person filling the form in IS the verifier.
  --
  -- KNOWN LIMITATION, Phase 2 (raised in the US-20 review as L3). Auto-verify
  -- trusts the link, and a link's token is plaintext and readable by any
  -- authenticated user (see the form_links select policy — the gate there is
  -- confidentiality, not channel). So a signed-in volunteer who copies a
  -- `counselor`- or `staff`-channel token can file submissions that arrive
  -- already verified, bypassing the counselor step that §11 calls "by far the
  -- strongest control". It is INERT in Phase 1: intake_demo_seed.sql creates
  -- exactly one link and it is `channel = 'family'`, and there is no UI for
  -- creating any other kind, so no such token exists to copy. Before the first
  -- counselor/staff-channel link is issued, this needs either a per-channel
  -- read gate on form_links.token or an authenticated caller identity on
  -- submit_form. Do not create one of those links in the meantime.
  if v_link.channel in ('counselor', 'staff') then
    v_status := 'verified';
  else
    v_status := 'submitted';
  end if;

  -- 2. Honeypot — before validation, before the counter. --------------------
  -- Same success shape a real submission gets; no row, no increment, no event.
  if p_honeypot is not null and btrim(p_honeypot) <> '' then
    return jsonb_build_object('ok', true, 'status', v_status::text);
  end if;

  -- 3. Shape and size guards. -----------------------------------------------
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object(
      'ok', false,
      'error', 'We couldn''t read that submission. Please try again.',
      'errors', '[]'::jsonb
    );
  end if;
  -- Cheap ceiling on a hostile payload. ~100KB is far above any real family's
  -- answers (a 10-child submission is a couple of KB).
  if pg_column_size(p_answers) > 100000 then
    return jsonb_build_object(
      'ok', false,
      'error', 'That submission is too large. Please shorten your answers and try again.',
      'errors', '[]'::jsonb
    );
  end if;

  -- 4. Validate every section against the PINNED definition. ----------------
  for v_section in
    select value as sec from jsonb_array_elements(coalesce(v_definition->'sections', '[]'::jsonb))
  loop
    if coalesce((v_section.sec->>'repeating')::boolean, false) then
      -- The repeating child block.
      v_min_children := coalesce(nullif(v_section.sec->>'min_items','')::int, 1);
      v_max_children := coalesce(nullif(v_section.sec->>'max_items','')::int, 10);
      v_items := p_answers -> (v_section.sec->>'id');

      -- Nested rather than one OR chain on purpose: jsonb_array_length() raises
      -- on a non-array, and SQL does not guarantee left-to-right short-circuit
      -- evaluation, so the type check has to be its own branch.
      if v_items is null or jsonb_typeof(v_items) <> 'array' then
        v_errors := v_errors || jsonb_build_object(
          'field', v_section.sec->>'id',
          'message', 'Please add at least one child.'
        );
      elsif jsonb_array_length(v_items) < v_min_children then
        v_errors := v_errors || jsonb_build_object(
          'field', v_section.sec->>'id',
          'message', 'Please add at least one child.'
        );
      elsif jsonb_array_length(v_items) > v_max_children then
        v_errors := v_errors || jsonb_build_object(
          'field', v_section.sec->>'id',
          'message', format('Please register no more than %s children on one form.', v_max_children)
        );
      else
        for v_i in 0 .. jsonb_array_length(v_items) - 1 loop
          if jsonb_typeof(v_items -> v_i) <> 'object' then
            v_errors := v_errors || jsonb_build_object(
              'field', format('%s[%s]', v_section.sec->>'id', v_i),
              'message', 'We couldn''t read that child''s answers. Please re-enter them.'
            );
          else
            for v_field in
              select value as fld from jsonb_array_elements(coalesce(v_section.sec->'fields', '[]'::jsonb))
            loop
              v_errors := v_errors || public.intake_validate_field(
                v_items -> v_i,
                v_field.fld,
                format('%s[%s].', v_section.sec->>'id', v_i)
              );
            end loop;
          end if;
        end loop;
      end if;
    else
      for v_field in
        select value as fld from jsonb_array_elements(coalesce(v_section.sec->'fields', '[]'::jsonb))
      loop
        -- Coerce a missing/malformed section to an empty object rather than
        -- handing a scalar or array to the field validator: the missing
        -- required fields then report themselves normally instead of the whole
        -- call failing on a type error.
        v_errors := v_errors || public.intake_validate_field(
          case when jsonb_typeof(p_answers -> (v_section.sec->>'id')) = 'object'
               then p_answers -> (v_section.sec->>'id')
               else '{}'::jsonb end,
          v_field.fld,
          (v_section.sec->>'id') || '.'
        );
      end loop;
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Please fix the highlighted answers and submit again.',
      'errors', v_errors
    );
  end if;

  -- 5. Claim a slot on the link. --------------------------------------------
  -- Atomic: the WHERE clause enforces max_submissions under the row lock, so
  -- two families submitting simultaneously can't both take the last slot.
  update form_links
  set submission_count = submission_count + 1
  where id = v_link.id
    and (max_submissions is null or submission_count < max_submissions)
  returning submission_count into v_new_count;

  if not found then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'full');
  end if;

  -- 6. Request metadata, read from the request itself — never from the
  -- client's own arguments, which a bot controls. ---------------------------
  --
  -- The client IP is deliberately NOT read, hashed, or stored (L1 in the US-20
  -- review; see the comment on form_submissions.ip_hash). The previous version
  -- wrote encode(digest(ip,'sha256')) — an unsalted hash over a 32-bit IPv4
  -- keyspace, which is reversible by exhaustive search in seconds, so it was an
  -- identifier for the person who filled in the form, kept next to their
  -- children's names, read by nothing. `ip_hash` is written as NULL below;
  -- reinstating it means an HMAC with a Vault-held secret, not a digest.
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;
  v_user_agent := left(nullif(btrim(coalesce(v_headers->>'user-agent', '')), ''), 400);

  -- 7. Contact denormalization for the staff queue. The explicit p_contact
  -- wins; otherwise fall back to the guardian answers so a client doesn't have
  -- to send the same values twice.
  v_name  := nullif(btrim(coalesce(v_contact->>'name',
                    p_answers #>> '{family,guardian_name}', '')), '');
  v_phone := nullif(btrim(coalesce(v_contact->>'phone',
                    p_answers #>> '{family,guardian_phone}', '')), '');
  v_email := nullif(btrim(coalesce(v_contact->>'email',
                    p_answers #>> '{family,guardian_email}', '')), '');

  -- 8. Write the provenance record. -----------------------------------------
  insert into form_submissions (
    form_link_id, form_version_id, drive_id, drive_school_id, channel, status,
    source_locale, answers, corrections,
    submitter_name, submitter_phone, submitter_email,
    submitted_at, verified_at, verified_by_label,
    ip_hash, user_agent, is_test_data
  )
  values (
    v_link.id, v_link.form_version_id, v_link.drive_id, v_link.drive_school_id,
    v_link.channel, v_status,
    v_link.locale, p_answers, '{}'::jsonb,
    left(v_name, 200), left(v_phone, 60), left(v_email, 200),
    now(),
    case when v_status = 'verified' then now() end,
    case when v_status = 'verified' then left(coalesce(v_name, 'Direct entry'), 200) end,
    null,                                  -- ip_hash: never populated (L1)
    v_user_agent, v_link.is_test_data
  )
  returning id into v_submission_id;

  v_actor_kind := case when v_link.channel = 'family' then 'family' else v_link.channel::text end;

  insert into submission_events (submission_id, event, actor_kind, actor_label, detail)
  values (
    v_submission_id, 'submitted', v_actor_kind, null,
    jsonb_build_object('channel', v_link.channel::text, 'locale', v_link.locale)
  );

  if v_status = 'verified' then
    insert into submission_events (submission_id, event, actor_kind, actor_label, detail)
    values (
      v_submission_id, 'verified', 'system', null,
      jsonb_build_object('reason', 'auto-verified: ' || v_link.channel::text || ' channel link')
    );
  end if;

  return jsonb_build_object('ok', true, 'status', v_status::text);
end;
$$;

revoke execute on function public.submit_form(text, jsonb, jsonb, text) from public;
grant execute on function public.submit_form(text, jsonb, jsonb, text) to anon, authenticated;

-- =============================================================================
-- get_review_roster(review_token)
--
-- Caller: a school counselor holding a review link. No login.
--
-- Returns the whole season's submissions FOR THAT TOKEN'S SCHOOL ONLY, and per
-- child only first_name / age / grade, plus each submission's status and
-- dates. It never returns wishlist items, sizes, specific needs, other notes,
-- or guardian name/phone/email — the counselor is doing a plausibility check on
-- family composition (§3), not reviewing what anyone asked for. That is
-- enforced by BUILDING each child object field by field below, never by
-- passing an answers blob through and trusting the UI to hide the rest.
--
-- A confidential-channel submission (drive_school_id is null) is never
-- returned, and a review token that is itself school-less is refused outright:
-- confidential cases are reviewed by cleared staff inside the app, not through
-- an anonymous token link.
--
-- Stamps first_viewed_at on each submission the first time it is read, and
-- last_used_at on the token.
--
-- Shape:
--   { "ok": true, "school_name": "...", "expires_at": "...",
--     "correction_fields": {
--       "first_name": {"id":"first_name","label":"Child's first name","type":"text",
--                      "required":true,"max_length":80,"min":null,"max":null,"options":[]},
--       "age":        {"id":"age","label":"Age","type":"number",
--                      "required":true,"max_length":null,"min":0,"max":19,"options":[]},
--       "grade":      {"id":"grade","label":"Grade","type":"select",
--                      "required":true,"max_length":null,"min":null,"max":null,
--                      "options":[{"value":"K","label":"Kindergarten"}, ...]}
--     },
--     "submissions": [ { "id": uuid, "status": "...", "submitted_at": "...",
--                        "verified_at": ..., "verified_by_label": ...,
--                        "resolution_note": ..., "has_corrections": bool,
--                        "children": [ {"index":1,"first_name":"...","age":8,"grade":"3"} ] } ] }
--   { "ok": false, "error": "...", "reason": "not_found"|"unsupported" }
--
-- `correction_fields` is the DEFINITION behind each of the three controls §3
-- lets a counselor edit, read straight out of the PINNED form version — the
-- same document submit_form validated the family's original answer against and
-- the same one verify_submission holds the counselor's correction to. Its keys
-- are exactly intake_correctable_field_ids(), always all three, always present.
--
-- It is here because a roster that renders those controls from rules typed into
-- the page instead is a roster whose rules silently drift from the server's.
-- All three had already drifted or were about to:
--   * grade      — without `options` the page can only offer a free-text box,
--                  which lets a counselor type a grade the original submission
--                  could never have contained (verify_submission then rejects
--                  the whole correction) and re-opens the "shoe size: medium"
--                  free-text mess the select-with-escape-hatch design exists to
--                  prevent.
--   * age        — `min`/`max` were hard-coded 0/19 in the JSX with nothing
--                  tying them to what verify_submission actually enforces.
--   * first_name — `max_length`. The roster input allowed 120 characters
--                  against a definition that says 80, so an 81-120 character
--                  corrected name passed the browser and then RAISED
--                  "Correction rejected: Please keep First name under 80
--                  characters", losing the counselor's approve click entirely.
--                  Already reachable; this is the live bug of the three.
--
-- It is NOT a widening of what this function discloses. It comes from
-- `form_versions.definition` — the blank questionnaire, which anon already gets
-- in full from get_form() for any live link — and carries no submission, family
-- or child data. The per-child projection below is unchanged: first_name, age,
-- grade, and nothing else.
--
-- A key is JSON `null` when no form version on this roster defines that field —
-- a version that doesn't collect grade is legitimate, and so is an empty
-- roster. `null` means the page renders that field READ-ONLY. It must NOT fall
-- back to a free-text box: an unconstrained box is worse than no box, because
-- verify_submission will reject whatever is typed into it.
--
-- Two reasons only, matching ReviewTokenProblem in web/lib/intake.ts. Unknown,
-- revoked and expired review tokens are ALL `not_found` — the scan below can't
-- tell them apart without confirming to an anonymous caller that a token
-- existed, and a counselor's fix is the same in all three cases: ask Reach for
-- a new link. `unsupported` is the one genuinely different case (a valid token
-- that has no school, i.e. the confidential queue, which is not reachable from
-- an anonymous link at all).
-- =============================================================================

create or replace function public.get_review_roster(p_review_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
  v_school_name text;
  v_submissions jsonb := '[]'::jsonb;
  v_row record;
  v_effective jsonb;
  v_children jsonb;
  v_correction_fields jsonb := '{}'::jsonb;
  v_inactive_msg constant text :=
    'This review link is no longer active — ask Reach for a new one.';
begin
  if p_review_token is null or btrim(p_review_token) = '' then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_found');
  end if;

  -- Review tokens are bcrypt-hashed, which is salted per row, so there is no
  -- indexed lookup — candidates have to be compared one at a time. Bounded by
  -- filtering to live tokens first; at one token per participating school per
  -- season this is a handful of comparisons. (If the school list ever grows
  -- into the hundreds, add an indexed non-secret prefix column rather than
  -- weakening the hash.) A malformed hash cannot break this scan for everyone —
  -- that is what the review_tokens_hash_is_bcrypt constraint is for.
  --
  -- PHASE 2, named so it isn't mistaken for an oversight (L2 in the US-20
  -- review): there is no attempt cap and no entropy floor on guessing a review
  -- token. Nothing here counts failures, and unlike form_links.token there is
  -- no `char_length >= 16` check, because a hash is stored rather than the
  -- token — the length rule has to be enforced by whatever ISSUES the token,
  -- and in Phase 1 that is one line in intake_demo_seed.sql. Accepted for now
  -- because bcrypt makes each guess expensive and the live-token set is a
  -- single-digit number of rows for one school. Before this is issued at scale
  -- it wants: tokens minted server-side at >= 32 bytes of entropy (never typed
  -- by a human), and a failed-attempt counter with a lockout, the same shape
  -- card_claim_verifications already uses for claim codes.
  select rt.* into v_token
  from review_tokens rt
  where rt.revoked_at is null
    and rt.expires_at > now()
    and rt.token_hash = extensions.crypt(btrim(p_review_token), rt.token_hash)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_found');
  end if;

  -- A school-less review token would be the confidential/staff queue. That
  -- queue is not reachable from an anonymous link by design (§8): it is read
  -- inside the app by staff who clear can_view_confidential().
  if v_token.drive_school_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'This review link isn''t set up for a school roster. Please contact Reach.',
      'reason', 'unsupported'
    );
  end if;

  select s.name into v_school_name
  from drive_schools ds
  join schools s on s.id = ds.school_id
  where ds.id = v_token.drive_school_id;

  update review_tokens set last_used_at = now() where id = v_token.id;

  -- First read of a submission stamps first_viewed_at and logs a 'viewed'
  -- event. Done before the select so the roster reflects the stamp.
  insert into submission_events (submission_id, event, actor_kind, actor_label, detail)
  select fs.id, 'viewed'::text, 'counselor'::text, null::text, jsonb_build_object('via', 'review_token')
  from form_submissions fs
  where fs.drive_id = v_token.drive_id
    and fs.drive_school_id = v_token.drive_school_id
    and fs.first_viewed_at is null
    and fs.status <> 'draft';

  update form_submissions fs
  set first_viewed_at = now()
  where fs.drive_id = v_token.drive_id
    and fs.drive_school_id = v_token.drive_school_id
    and fs.first_viewed_at is null
    and fs.status <> 'draft';

  for v_row in
    select fs.id, fs.status, fs.submitted_at, fs.verified_at, fs.verified_by_label,
           fs.resolution_note, fs.answers, fs.answers_en, fs.corrections,
           fs.form_version_id,
           -- The repeating section's id comes from the version THIS submission
           -- pinned, never a hard-coded 'children' (see
           -- intake_repeating_section_id). Two submissions in one roster can
           -- legitimately sit on different form versions.
           public.intake_repeating_section_id(fv.definition) as child_key
    from form_submissions fs
    join form_versions fv on fv.id = fs.form_version_id
    where fs.drive_id = v_token.drive_id
      -- The token's own school, and never the confidential channel. The second
      -- condition is implied by the first (drive_school_id is not null here),
      -- and is written out anyway so it survives a future edit to this WHERE.
      and fs.drive_school_id = v_token.drive_school_id
      and fs.drive_school_id is not null
      and fs.status <> 'draft'
    order by fs.submitted_at desc nulls last, fs.id
  loop
    -- Loud, not silent. A definition with no repeating section cannot produce a
    -- meaningful roster, and showing a submission with an empty child list
    -- would invite a counselor to approve a family whose children they were
    -- never shown. Raising is a staff-visible configuration error; an empty
    -- roster row is a data-integrity one.
    if v_row.child_key is null then
      raise exception
        'Form version % (submission %) has no repeating child section; its roster cannot be built.',
        v_row.form_version_id, v_row.id;
    end if;

    v_effective := public.intake_apply_corrections(
      coalesce(v_row.answers_en, v_row.answers),
      v_row.corrections,
      v_row.child_key
    );

    -- Whitelist, not a passthrough: first name, age, grade. Nothing else in a
    -- child's answers is ever put on the wire here.
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'index', ord,
                 'first_name', c.value ->> 'first_name',
                 'age', case when (c.value ->> 'age') ~ '^[0-9]{1,3}$'
                             then (c.value ->> 'age')::int end,
                 'grade', c.value ->> 'grade'
               ) order by ord
             ),
             '[]'::jsonb
           )
      into v_children
    from jsonb_array_elements(
           case when jsonb_typeof(v_effective -> v_row.child_key) = 'array'
                then v_effective -> v_row.child_key
                else '[]'::jsonb end
         ) with ordinality as c(value, ord);

    v_submissions := v_submissions || jsonb_build_object(
      'id', v_row.id,
      'status', v_row.status::text,
      'submitted_at', v_row.submitted_at,
      'verified_at', v_row.verified_at,
      'verified_by_label', v_row.verified_by_label,
      'resolution_note', v_row.resolution_note,
      'has_corrections', coalesce(v_row.corrections, '{}'::jsonb) <> '{}'::jsonb,
      'children', coalesce(v_children, '[]'::jsonb)
    );
  end loop;

  -- The definitions behind the three correctable controls, from the form
  -- versions this roster's submissions actually pinned — never rules typed into
  -- the page, and never inferred from the values already on the roster (which
  -- are only ever a subset of what is allowed, and are absent on an empty
  -- roster).
  --
  -- `roster_versions`' predicates are the same ones the roster loop uses, so a
  -- version can only contribute a rule if a submission on it is visible above.
  --
  -- The field id list is intake_correctable_field_ids() — the SAME list
  -- verify_submission refuses to write outside of. Everything else about each
  -- field comes from the definition.
  --
  -- MERGING ACROSS VERSIONS. Two submissions in one roster can legitimately sit
  -- on different form versions (the loop above says so), and the counselor gets
  -- ONE set of controls, not one per version. verify_submission validates a
  -- correction against the SUBMISSION's own pinned version, so the merge has to
  -- pick, for each rule, the answer that cannot cause a correction to be
  -- accepted by the page and then refused by the server:
  --   max_length -> the SMALLEST across versions
  --   min        -> the LARGEST
  --   max        -> the SMALLEST
  --   required   -> true if required by ANY version
  -- i.e. strictest wins. The counselor may be held to a slightly tighter rule
  -- than one version alone would impose; nobody loses an approve click to a
  -- value the page invited them to type. That asymmetry is deliberate — this
  -- whole payload exists because the loose direction had already bitten
  -- first_name.
  --
  -- id / label / type / options come from the EARLIEST version that defines the
  -- field (options unioned across versions, deduplicated by `value`, first
  -- occurrence winning a differing label). The honest limit of the options
  -- union is unchanged and worth restating: on a genuinely mixed-version roster
  -- the picker can offer a grade some rows will refuse. That surfaces as a
  -- clean, specific rejection ("Please choose one of the listed options for
  -- Grade"), never as a bad write, and it is still strictly better than the
  -- free-text box this replaces.
  --
  -- A field no roster version defines gets JSON `null`, not an empty object:
  -- "there is no rule here, render it read-only". Same for an empty roster,
  -- where there is nothing to correct in the first place.
  with roster_versions as (
    select fv.id, fv.definition, fv.created_at
    from (
      select distinct fs.form_version_id
      from form_submissions fs
      where fs.drive_id = v_token.drive_id
        and fs.drive_school_id = v_token.drive_school_id
        and fs.drive_school_id is not null
        and fs.status <> 'draft'
    ) rv
    join form_versions fv on fv.id = rv.form_version_id
  ),
  ids as (
    -- Written as a FROM-clause unnest rather than a set-returning call in the
    -- target list: same three ids, no dependence on how a given Postgres
    -- version expands an SRF in a select list.
    select u.field_id
    from unnest(public.intake_correctable_field_ids()) as u(field_id)
  ),
  defs as (
    -- One row per (correctable field, version that actually defines it).
    -- `version_rank` is the "earliest version" tiebreak used below; `fv.id`
    -- breaks a created_at tie so the result is deterministic.
    select ids.field_id,
           d.def,
           row_number() over (partition by ids.field_id
                              order by rvs.created_at, rvs.id) as version_rank
    from ids
    cross join roster_versions rvs
    cross join lateral (
      select public.intake_repeating_field_def(rvs.definition, ids.field_id) as def
    ) d
    where d.def is not null
  ),
  first_opts as (
    select distinct on (d.field_id, o.opt ->> 'value')
           d.field_id, o.opt as opt, d.version_rank, o.ord
    from defs d
    cross join lateral jsonb_array_elements(d.def -> 'options')
      with ordinality as o(opt, ord)
    order by d.field_id, o.opt ->> 'value', d.version_rank, o.ord
  ),
  merged_opts as (
    select fo.field_id, jsonb_agg(fo.opt order by fo.version_rank, fo.ord) as options
    from first_opts fo
    group by fo.field_id
  ),
  merged as (
    select d.field_id,
           -- Earliest-defining version wins for the non-numeric properties.
           (array_agg(d.def order by d.version_rank))[1] as first_def,
           bool_or(coalesce((d.def ->> 'required')::boolean, false)) as required,
           -- Strictest wins. These casts are safe: intake_repeating_field_def
           -- has already reduced each one to a JSON integer or null.
           min((d.def ->> 'max_length')::int) as max_length,
           max((d.def ->> 'min')::int)        as min,
           min((d.def ->> 'max')::int)        as max
    from defs d
    group by d.field_id
  )
  select coalesce(
           jsonb_object_agg(
             k.field_id,
             case
               when m.field_id is null then 'null'::jsonb
               else jsonb_build_object(
                      'id',         m.first_def ->> 'id',
                      'label',      m.first_def ->> 'label',
                      'type',       m.first_def ->> 'type',
                      'required',   m.required,
                      'max_length', m.max_length,
                      'min',        m.min,
                      'max',        m.max,
                      'options',    coalesce(mo.options, '[]'::jsonb)
                    )
             end
           ),
           '{}'::jsonb
         )
    into v_correction_fields
  from ids k
  left join merged m on m.field_id = k.field_id
  left join merged_opts mo on mo.field_id = k.field_id;

  return jsonb_build_object(
    'ok', true,
    'school_name', v_school_name,
    'expires_at', v_token.expires_at,
    -- Definition data (the blank questionnaire's rules for the three
    -- correctable fields), not submission data. See this function's header.
    'correction_fields', coalesce(v_correction_fields, '{}'::jsonb),
    'submissions', v_submissions
  );
end;
$$;

revoke execute on function public.get_review_roster(text) from public;
grant execute on function public.get_review_roster(text) to anon, authenticated;

-- =============================================================================
-- verify_submission(review_token, submission_id, verifier_name, corrections)
--
-- Caller: the counselor, from the roster above.
--
-- `p_corrections` is optional and accepts ONLY first_name / age / grade, keyed
-- by 1-based child position. Any other key RAISES — it is never silently
-- dropped, so a client bug can't quietly widen what a counselor can write into
-- someone's record. Values are validated against the SAME pinned definition
-- fields the family's original answers were validated against, so a corrected
-- grade still has to be in the allowed list and a corrected age still has to be
-- 0-19.
--
-- The correction lands in form_submissions.corrections. `answers` is not
-- touched.
--
-- Shape:
--   { "ok": true,  "status": "verified" }
--   { "ok": false, "error": "...", "reason":
--       "missing_name"|"not_found"|"already_verified"|"not_pending" }
--   raises          on a malformed/out-of-scope corrections payload
-- =============================================================================

create or replace function public.verify_submission(
  p_review_token text,
  p_submission_id uuid,
  p_verifier_name text,
  p_corrections jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
  v_sub record;
  v_definition jsonb;
  v_child_fields jsonb := '[]'::jsonb;
  v_child_key text;
  v_section record;
  v_field record;
  v_corrections jsonb := '{}'::jsonb;
  v_key text;
  v_fix jsonb;
  v_inner text;
  v_idx int;
  v_child_count int;
  v_errors jsonb := '[]'::jsonb;
  v_name text := nullif(btrim(coalesce(p_verifier_name, '')), '');
  -- The SAME list get_review_roster builds its `correction_fields` payload
  -- from, so the roster can never offer a control this function refuses (or
  -- withhold one it would have accepted). Not two copies of the same array.
  v_allowed constant text[] := public.intake_correctable_field_ids();
  v_inactive_msg constant text :=
    'This review link is no longer active — ask Reach for a new one.';
begin
  if v_name is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Please type your name before confirming.',
      'reason', 'missing_name'
    );
  end if;

  select rt.* into v_token
  from review_tokens rt
  where rt.revoked_at is null
    and rt.expires_at > now()
    and rt.token_hash = extensions.crypt(btrim(coalesce(p_review_token, '')), rt.token_hash)
  limit 1;

  if not found or v_token.drive_school_id is null then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_found');
  end if;

  -- Scoped to the token's own school. A counselor cannot verify another
  -- school's submission, or a confidential-channel one, even with a valid id.
  select fs.* into v_sub
  from form_submissions fs
  where fs.id = p_submission_id
    and fs.drive_id = v_token.drive_id
    and fs.drive_school_id = v_token.drive_school_id
    and fs.drive_school_id is not null
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'We couldn''t find that registration on your roster. Reload the page and try again.',
      'reason', 'not_found'
    );
  end if;

  if v_sub.status = 'verified' then
    return jsonb_build_object(
      'ok', false, 'error', 'This family has already been confirmed.', 'reason', 'already_verified'
    );
  end if;
  if v_sub.status not in ('submitted', 'under_review') then
    return jsonb_build_object(
      'ok', false,
      'error', format('This registration is %s and can no longer be confirmed here.', v_sub.status),
      'reason', 'not_pending'
    );
  end if;

  -- --- corrections: scope, then validate -----------------------------------
  if p_corrections is not null and p_corrections <> '{}'::jsonb then
    if jsonb_typeof(p_corrections) <> 'object' then
      raise exception 'corrections must be an object keyed by child number.';
    end if;

    -- The field definitions this submission's version pinned, so a corrected
    -- value is held to the same rules the original answer was — and the id of
    -- the repeating section, so the child count and the error paths below read
    -- the same key submit_form validated rather than a hard-coded 'children'.
    select v.definition into v_definition from form_versions v where v.id = v_sub.form_version_id;
    v_child_key := public.intake_repeating_section_id(v_definition);
    if v_child_key is null then
      raise exception
        'Form version % has no repeating child section; corrections cannot be checked against it.',
        v_sub.form_version_id;
    end if;

    for v_section in
      select value as sec from jsonb_array_elements(coalesce(v_definition->'sections', '[]'::jsonb))
    loop
      if coalesce((v_section.sec->>'repeating')::boolean, false) then
        v_child_fields := coalesce(v_section.sec->'fields', '[]'::jsonb);
      end if;
    end loop;

    v_child_count := case
      when jsonb_typeof(v_sub.answers -> v_child_key) = 'array'
      then jsonb_array_length(v_sub.answers -> v_child_key) else 0 end;

    for v_key in select jsonb_object_keys(p_corrections) loop
      if v_key !~ '^[0-9]{1,3}$' then
        raise exception
          'corrections must be keyed by child number (1, 2, 3 ...); got %.', v_key;
      end if;
      v_idx := v_key::int;
      if v_idx < 1 or v_idx > v_child_count then
        raise exception
          'correction for child % does not match this registration (it has % children).',
          v_idx, v_child_count;
      end if;

      v_fix := p_corrections -> v_key;
      if jsonb_typeof(v_fix) <> 'object' then
        raise exception 'correction for child % must be an object.', v_idx;
      end if;

      -- The whole point of this loop: anything outside first_name/age/grade is
      -- an ERROR, never a silent drop.
      for v_inner in select jsonb_object_keys(v_fix) loop
        if not (v_inner = any (v_allowed)) then
          raise exception
            'A counselor may only correct first_name, age, or grade — "%" is not allowed (child %).',
            v_inner, v_idx;
        end if;
      end loop;

      -- Validate the corrected values against the pinned definition. Only the
      -- keys actually present are checked; a correction is a partial update.
      for v_field in select value as fld from jsonb_array_elements(v_child_fields) loop
        if (v_field.fld->>'id') = any (v_allowed) and v_fix ? (v_field.fld->>'id') then
          v_errors := v_errors || public.intake_validate_field(
            v_fix,
            -- Force required: a correction that blanks a name is a mistake,
            -- not an edit.
            v_field.fld || jsonb_build_object('required', true),
            format('%s[%s].', v_child_key, v_idx - 1)
          );
        end if;
      end loop;
    end loop;

    if jsonb_array_length(v_errors) > 0 then
      raise exception 'Correction rejected: %', (v_errors -> 0 ->> 'message');
    end if;

    v_corrections := p_corrections;
  end if;

  update form_submissions
  set status = 'verified',
      corrections = v_corrections,
      verified_at = now(),
      verified_by_label = left(v_name, 200),
      verified_via_review_token = v_token.id
  where id = v_sub.id;

  insert into submission_events (submission_id, event, actor_kind, actor_label, detail)
  values (
    v_sub.id, 'verified', 'counselor', left(v_name, 200),
    -- v_corrections is '{}' when the counselor changed nothing, so this is
    -- always a well-typed jsonb value (never a bare NULL, which
    -- jsonb_build_object cannot infer a type for).
    jsonb_build_object('corrections', v_corrections)
  );

  update review_tokens set last_used_at = now() where id = v_token.id;

  return jsonb_build_object('ok', true, 'status', 'verified');
end;
$$;

revoke execute on function public.verify_submission(text, uuid, text, jsonb) from public;
grant execute on function public.verify_submission(text, uuid, text, jsonb) to anon, authenticated;

-- =============================================================================
-- reject_submission(review_token, submission_id, reason, as_duplicate)
--
-- Caller: the counselor. Sets 'rejected' (or 'duplicate'), records the reason
-- in resolution_note, writes an event. Same school scoping as
-- verify_submission.
--
-- Shape:
--   { "ok": true,  "status": "rejected"|"duplicate" }
--   { "ok": false, "error": "...", "reason": "not_found"|"not_pending"|"missing_reason" }
-- =============================================================================

create or replace function public.reject_submission(
  p_review_token text,
  p_submission_id uuid,
  p_reason text,
  p_as_duplicate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
  v_sub record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_status submission_status;
  v_inactive_msg constant text :=
    'This review link is no longer active — ask Reach for a new one.';
begin
  if v_reason is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Please add a short reason so Reach knows what happened.',
      'reason', 'missing_reason'
    );
  end if;

  select rt.* into v_token
  from review_tokens rt
  where rt.revoked_at is null
    and rt.expires_at > now()
    and rt.token_hash = extensions.crypt(btrim(coalesce(p_review_token, '')), rt.token_hash)
  limit 1;

  if not found or v_token.drive_school_id is null then
    return jsonb_build_object('ok', false, 'error', v_inactive_msg, 'reason', 'not_found');
  end if;

  select fs.* into v_sub
  from form_submissions fs
  where fs.id = p_submission_id
    and fs.drive_id = v_token.drive_id
    and fs.drive_school_id = v_token.drive_school_id
    and fs.drive_school_id is not null
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'We couldn''t find that registration on your roster. Reload the page and try again.',
      'reason', 'not_found'
    );
  end if;

  -- An imported submission is already a real family; undoing that is a staff
  -- job on the working record (§7), not a counselor action here.
  if v_sub.status not in ('submitted', 'under_review', 'verified') then
    return jsonb_build_object(
      'ok', false,
      'error', format('This registration is %s and can no longer be changed here.', v_sub.status),
      'reason', 'not_pending'
    );
  end if;

  v_status := case when coalesce(p_as_duplicate, false) then 'duplicate' else 'rejected' end;

  update form_submissions
  set status = v_status,
      resolution_note = left(v_reason, 1000)
  where id = v_sub.id;

  insert into submission_events (submission_id, event, actor_kind, actor_label, detail)
  values (
    v_sub.id, 'rejected', 'counselor', null,
    jsonb_build_object('status', v_status::text, 'reason', left(v_reason, 1000))
  );

  update review_tokens set last_used_at = now() where id = v_token.id;

  return jsonb_build_object('ok', true, 'status', v_status::text);
end;
$$;

revoke execute on function public.reject_submission(text, uuid, text, boolean) from public;
grant execute on function public.reject_submission(text, uuid, text, boolean) to anon, authenticated;

-- =============================================================================
-- import_submission(submission_id, is_confidential)
--
-- Caller: staff, authenticated. `authenticated` is the ONLY grant (no anon),
-- and is_admin() is enforced inside the body as well — a grant is not an
-- authorization check. A confidential-channel submission additionally requires
-- can_view_confidential() (§8).
--
-- p_is_confidential — the confidential tier of the family this creates:
--   null (default) : inherit from the channel. Confidential-channel submission
--                    (drive_school_id is null) -> confidential family;
--                    school-channel -> ordinary family. This is exactly the
--                    behavior the 1-argument version had.
--   true / false   : explicit override, in either direction.
--
-- §3 calls the import click "the natural place to set confidential tier", and
-- it is the only safe place. The alternative — import, then UPDATE
-- families.is_confidential — leaves a real child's first name, grade and
-- school in a row every volunteer can read for however long it takes the second
-- click to happen. Passing the flag into the create is atomic: the row is
-- confidential from the instant it exists.
--
-- No extra permission gate on the parameter itself, deliberately. Creating a
-- confidential family is open to any admin (OPEN_QUESTIONS **DB-26** — whoever
-- is doing intake already knows the details firsthand), which is how the
-- existing admin family form behaves; and an admin who does not clear
-- can_view_confidential() can't reach a confidential-channel submission to
-- import it in the first place (see the gate below). The choice is recorded on
-- the `imported` submission_events row and, because `families` carries the
-- generic audit trigger, in audit_log as well.
--
-- Creates families + children + cards + wishlist_items from
-- coalesce(answers_en, answers) with corrections overlaid, sets
-- source_submission_id on the family AND on every child, copies the family's
-- own words into the *_source columns (§4.2/§10), and stamps
-- imported / imported_at / imported_by / imported_family_id.
--
-- IDEMPOTENT, at three depths. A double-click, a retry, two admins clicking at
-- the same moment, or an import repeated after someone hand-edited the status
-- back to 'verified' all yield exactly ONE family:
--   * a transaction-scoped advisory lock keyed on the submission id serializes
--     concurrent calls for the same submission (a call for a DIFFERENT
--     submission is never blocked),
--   * the status is re-read INSIDE that lock, so the second caller sees the
--     first caller's committed 'imported' status and returns the family it
--     already created rather than making a second one,
--   * and underneath both of those, the `families_one_per_submission` unique
--     index makes a second family for the same submission impossible at the
--     storage layer. The two checks above rest on `form_submissions.status`,
--     which an admin can UPDATE by hand; the index does not. The
--     unique_violation is caught and answered with the family that already
--     exists — same shape a double-click gets, same pattern claim_card uses.
--
-- Family numbering goes through create_family() — the existing advisory-lock
-- numbering path (20260708160000 / 20260818130000) — never a second
-- hand-rolled "select max + 1". create_family() is `security invoker`; called
-- from inside this `security definer` function it runs with the owner's
-- privileges (so RLS doesn't hide already-numbered families from the count),
-- while auth.uid() still resolves to the real admin, so families.created_by is
-- correct.
--
-- Exactly one `cards` row per child (unique (child_id), ADM-2 / 20260818140000).
--
-- ---------------------------------------------------------------------------
-- IMPORT CONTRACT — the section and field ids below are HARD-CODED here.
-- ---------------------------------------------------------------------------
-- Only the REPEATING (per-child) section's id is resolved dynamically, from the
-- pinned definition, via intake_repeating_section_id(). Everything else is a
-- literal in the SQL below:
--
--   sections : 'family', 'pickup_consent'
--   fields   : family.{guardian_name,guardian_phone,guardian_email,
--              preferred_language}, pickup_consent.{consent,
--              can_reach_church_pickup}, and every per-child field
--              (first_name, age, grade, sex, specific_needs, other_notes,
--              pant_size/shirt_size/shoe_size + their *_other variants,
--              wishlist).
--
-- Rename any of those in a future form definition and this function writes the
-- affected columns as NULL with NO error and NO warning — the same silent
-- failure the repeating-section lookup exists to prevent (see
-- intake_repeating_section_id's note), one section over. Not a Phase 1 defect:
-- there is one definition and published versions are immutable. It IS a
-- constraint on authoring version 2 — a version 2 may add ids freely, but
-- renaming or removing one of the above is a change to THIS FUNCTION as well.
-- The canonical list lives with the definition, in supabase/intake_demo_seed.sql
-- (see the "part of the import contract" callout there); keep the two in sync.
-- ---------------------------------------------------------------------------
--
-- Shape:
--   { "ok": true, "family_id": uuid, "family_number": int, "children_created": int,
--     "already_imported": false, "is_confidential": bool }
--   { "ok": true, ... , "already_imported": true }      (second call)
--   { "ok": false, "error": "...", "reason": "not_found"|"forbidden"|"not_verified" }
-- =============================================================================

-- DESTRUCTIVE (see the APPLY STATUS callout at the top of this file). The
-- 1-argument version is REPLACED, not overloaded: dropping it removes the stale
-- function and every grant attached to it in one step, and leaves no
-- `import_submission(uuid)` for a stale client or an old PostgREST schema cache
-- to bind to. Harmless no-op on a database that has never seen that signature;
-- on a database that received an earlier draft of this file, it drops a live
-- function — intended, but a live change, not an inert line.
drop function if exists public.import_submission(uuid);

create or replace function public.import_submission(
  p_submission_id uuid,
  p_is_confidential boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub record;
  v_family families%rowtype;
  v_is_confidential boolean;
  v_existing_id uuid;
  v_existing_number int;
  v_definition jsonb;
  v_child_key text;
  v_answers_src jsonb;
  v_effective jsonb;
  v_children jsonb;
  v_child jsonb;
  v_child_src jsonb;
  v_child_id uuid;
  v_i int;
  v_count int := 0;
  v_wish jsonb;
  v_wish_src jsonb;
  v_w int;
  v_desc text;
  v_desc_src text;
  v_pos int;
  v_age int;
  v_consent boolean;
  -- Truncation caps for every text column this function writes.
  --
  -- H1: these are NOT belt-and-braces, they are the actual bound. The values in
  -- `answers` are only as short as intake_validate_field made them, and until
  -- the H1 fix above, a field the validator never reached (a stale `_other`
  -- text) arrived here unbounded and went straight onto children.shirt_size —
  -- which public_available_cards publishes to `anon` and the printed card
  -- renders. Even with that fix, "the definition happens to set max_length on
  -- every field" is a property of one JSON blob a future admin can edit, not a
  -- property of this code. first_name and wishlist description already did
  -- this; everything else now matches them.
  --
  -- Sized to sit at or above the seeded definition's own max_length so a
  -- legitimate answer is never clipped: 80 there for sizes, 120 for guardian
  -- name, 500 for the two note fields.
  c_len_grade  constant int := 40;
  c_len_sex    constant int := 40;
  c_len_size   constant int := 80;
  c_len_notes  constant int := 500;
  c_len_name   constant int := 200;
  c_len_phone  constant int := 60;
  c_len_email  constant int := 200;
  c_len_lang   constant int := 40;
  c_len_pickup constant int := 80;
begin
  if not is_admin() then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only an administrator can import a registration.',
      'reason', 'forbidden'
    );
  end if;

  -- Serialize concurrent imports of the SAME submission. Held to the end of
  -- this transaction (this one RPC call); a call for another submission takes
  -- a different key and never waits. Same technique as create_family().
  perform pg_advisory_xact_lock(
    hashtextextended('import_submission:' || p_submission_id::text, 0)
  );

  -- Re-read INSIDE the lock — this is what makes the second caller see the
  -- first caller's committed result instead of racing it.
  select * into v_sub from form_submissions where id = p_submission_id for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'error', 'That registration no longer exists.', 'reason', 'not_found'
    );
  end if;

  -- Confidential channel: cleared staff only, using the existing helper (§8) —
  -- never a hand-written role check.
  if v_sub.drive_school_id is null and not can_view_confidential() then
    return jsonb_build_object(
      'ok', false,
      'error', 'That registration no longer exists.',   -- deliberately indistinguishable from not_found
      'reason', 'not_found'
    );
  end if;

  if v_sub.status = 'imported' then
    -- Second click / retry. The tier is whatever the FIRST import set; a
    -- different p_is_confidential on a repeat call is ignored rather than
    -- silently re-tiering a family that already exists (changing an existing
    -- family's tier is an edit to the working record, not an import).
    select f.family_number, f.is_confidential
      into v_existing_number, v_is_confidential
    from families f where f.id = v_sub.imported_family_id;

    return jsonb_build_object(
      'ok', true,
      'already_imported', true,
      'family_id', v_sub.imported_family_id,
      'family_number', v_existing_number,
      'children_created', 0,
      'is_confidential', coalesce(v_is_confidential, false)
    );
  end if;

  if v_sub.status <> 'verified' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only a counselor-verified registration can be imported.',
      'reason', 'not_verified'
    );
  end if;

  -- Confidential tier. The default (p_is_confidential null) is the channel's
  -- own answer: a confidential-channel submission becomes a CONFIDENTIAL
  -- family, so the gate on the submission and the gate on the resulting record
  -- match. An explicit true/false from the importing admin wins — including
  -- `false` on a confidential-channel submission, which only a cleared admin
  -- can even reach, and `true` on an ordinary school submission, which is the
  -- case §3 actually cares about (staff learn at import that this family should
  -- not be visible to every volunteer).
  v_is_confidential := coalesce(p_is_confidential, v_sub.drive_school_id is null);

  -- Which answers key holds the children, per the version THIS submission
  -- pinned. Never the literal 'children': a definition whose repeating section
  -- is named something else would otherwise import a family with ZERO children
  -- and report success, which is the failure mode most likely to go unnoticed
  -- until a real family shows up at distribution with no gifts.
  select v.definition into v_definition
  from form_versions v where v.id = v_sub.form_version_id;

  v_child_key := public.intake_repeating_section_id(v_definition);
  if v_child_key is null then
    raise exception
      'Form version % has no repeating child section; refusing to import submission % (it would create a family with no children).',
      v_sub.form_version_id, v_sub.id;
  end if;

  v_answers_src := coalesce(v_sub.answers, '{}'::jsonb);
  v_effective := public.intake_apply_corrections(
    coalesce(v_sub.answers_en, v_sub.answers, '{}'::jsonb),
    v_sub.corrections,
    v_child_key
  );

  v_consent := coalesce((v_effective #>> '{pickup_consent,consent}') = 'true', false);

  -- Family creation and its provenance stamp are ONE unit of work, so the
  -- families_one_per_submission violation rolls back the create_family() insert
  -- with it. Without this block the losing caller would leave a numbered,
  -- childless orphan family behind.
  begin
    -- Family numbering through the one existing atomic path.
    select * into v_family from public.create_family(
      v_sub.drive_id,
      v_sub.drive_school_id,
      v_is_confidential,
      false,                     -- p_is_test_data: see the is_test_data note below
      format('Imported from the family intake form on %s.', to_char(now(), 'Mon DD, YYYY'))
    );

    update families
    set source_submission_id = v_sub.id,
        guardian_name  = left(nullif(btrim(coalesce(v_effective #>> '{family,guardian_name}', '')), ''), c_len_name),
        guardian_phone = left(nullif(btrim(coalesce(v_effective #>> '{family,guardian_phone}', '')), ''), c_len_phone),
        guardian_email = left(nullif(btrim(coalesce(v_effective #>> '{family,guardian_email}', '')), ''), c_len_email),
        preferred_language = left(coalesce(
          nullif(btrim(coalesce(v_effective #>> '{family,preferred_language}', '')), ''),
          v_sub.source_locale, 'en'
        ), c_len_lang),
        consent_given_at = case when v_consent then coalesce(v_sub.submitted_at, now()) end,
        can_reach_church_pickup =
          left(nullif(btrim(coalesce(v_effective #>> '{pickup_consent,can_reach_church_pickup}', '')), ''), c_len_pickup),
        -- The narrow is_autotest_data flag is deliberately NOT set here: it
        -- belongs only to rows the e2e suite created through create_family()
        -- (20260818130000), and setting it would let an e2e cleanup run delete a
        -- family imported during a stakeholder demo. The broad is_test_data flag
        -- is inherited from the link instead, so seeded/demo imports are still
        -- findable for cleanup.
        is_test_data = v_sub.is_test_data
    where id = v_family.id;
  exception when unique_violation then
    -- families_one_per_submission fired: this submission already has a family,
    -- even though its `status` said otherwise (a hand-reset status, or a race
    -- that got past the advisory lock). Answer with the family that exists.
    --
    -- v_family still holds the row create_family() built before the rollback,
    -- so it is NOT reused here — the answer is re-read from the table.
    select f.id, f.family_number, f.is_confidential
      into v_existing_id, v_existing_number, v_is_confidential
    from families f where f.source_submission_id = v_sub.id;

    if v_existing_id is null then
      -- Some OTHER unique constraint failed (family numbering, say). Never
      -- swallow that as "already imported".
      raise;
    end if;

    return jsonb_build_object(
      'ok', true,
      'already_imported', true,
      'family_id', v_existing_id,
      'family_number', v_existing_number,
      'children_created', 0,
      'is_confidential', coalesce(v_is_confidential, false)
    );
  end;

  v_children := case when jsonb_typeof(v_effective -> v_child_key) = 'array'
                     then v_effective -> v_child_key else '[]'::jsonb end;

  for v_i in 0 .. greatest(jsonb_array_length(v_children) - 1, -1) loop
    v_child := v_children -> v_i;
    -- The family's ORIGINAL words for the same child, for the *_source columns.
    -- Identical to v_child in Phase 1 (English only, no translation yet).
    v_child_src := case when jsonb_typeof(v_answers_src -> v_child_key) = 'array'
                        then (v_answers_src -> v_child_key) -> v_i end;

    v_age := case when (v_child ->> 'age') ~ '^[0-9]{1,3}$' then (v_child ->> 'age')::int end;

    insert into children (
      family_id, child_index, first_name, grade, age, sex,
      specific_needs, specific_needs_source,
      pant_size, shirt_size, shoe_size,
      other_notes, other_notes_source,
      source_submission_id
    )
    values (
      v_family.id,
      v_i + 1,
      left(coalesce(nullif(btrim(coalesce(v_child ->> 'first_name', '')), ''), 'Child'), 100),
      left(nullif(btrim(coalesce(v_child ->> 'grade', '')), ''), c_len_grade),
      v_age,
      left(nullif(btrim(coalesce(v_child ->> 'sex', '')), ''), c_len_sex),
      left(nullif(btrim(coalesce(v_child ->> 'specific_needs', '')), ''), c_len_notes),
      left(nullif(btrim(coalesce(v_child_src ->> 'specific_needs', '')), ''), c_len_notes),
      -- "Other (describe)" wins over the select value when present, so a
      -- purchaser sees "girls 6, runs small" rather than the literal "Other".
      -- These three are the columns H1's exploit landed in — every one of them
      -- is republished by public_available_cards to `anon` — so the truncation
      -- here is load-bearing, not cosmetic.
      left(coalesce(
        nullif(btrim(coalesce(v_child ->> 'pant_size_other', '')), ''),
        nullif(btrim(coalesce(v_child ->> 'pant_size', '')), '')
      ), c_len_size),
      left(coalesce(
        nullif(btrim(coalesce(v_child ->> 'shirt_size_other', '')), ''),
        nullif(btrim(coalesce(v_child ->> 'shirt_size', '')), '')
      ), c_len_size),
      left(coalesce(
        nullif(btrim(coalesce(v_child ->> 'shoe_size_other', '')), ''),
        nullif(btrim(coalesce(v_child ->> 'shoe_size', '')), '')
      ), c_len_size),
      left(nullif(btrim(coalesce(v_child ->> 'other_notes', '')), ''), c_len_notes),
      left(nullif(btrim(coalesce(v_child_src ->> 'other_notes', '')), ''), c_len_notes),
      v_sub.id
    )
    returning id into v_child_id;

    -- Exactly one card per child, always.
    insert into cards (child_id) values (v_child_id);

    v_wish := case when jsonb_typeof(v_child -> 'wishlist') = 'array'
                   then v_child -> 'wishlist' else '[]'::jsonb end;
    v_wish_src := case when jsonb_typeof(v_child_src -> 'wishlist') = 'array'
                       then v_child_src -> 'wishlist' else '[]'::jsonb end;
    v_pos := 0;
    for v_w in 0 .. greatest(jsonb_array_length(v_wish) - 1, -1) loop
      v_desc := nullif(btrim(coalesce(v_wish ->> v_w, '')), '');
      if v_desc is not null then
        v_pos := v_pos + 1;
        v_desc_src := nullif(btrim(coalesce(v_wish_src ->> v_w, '')), '');
        insert into wishlist_items (child_id, position, description, description_source, source_locale)
        values (v_child_id, v_pos, left(v_desc, 500), left(coalesce(v_desc_src, v_desc), 500), v_sub.source_locale);
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  update form_submissions
  set status = 'imported',
      imported_at = now(),
      imported_by = auth.uid(),
      imported_family_id = v_family.id
  where id = v_sub.id;

  insert into submission_events (submission_id, event, actor_kind, actor_profile_id, detail)
  values (
    v_sub.id, 'imported', 'staff', auth.uid(),
    jsonb_build_object(
      'family_id', v_family.id,
      'children', v_count,
      -- Both the tier and whether it was chosen or inherited, so "who made this
      -- family confidential, and did they mean to?" is answerable from the
      -- event trail alone.
      'is_confidential', v_is_confidential,
      'confidential_source', case when p_is_confidential is null then 'channel' else 'explicit' end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_imported', false,
    'family_id', v_family.id,
    'family_number', v_family.family_number,
    'children_created', v_count,
    'is_confidential', v_is_confidential
  );
end;
$$;

-- authenticated ONLY. anon must not even be able to attempt this, and the
-- platform's default EXECUTE grant (see 20260812090000's note: Supabase
-- auto-grants execute to anon/authenticated on every new function) is revoked
-- explicitly rather than assumed absent.
--
-- Both lines name the NEW two-argument signature. The old one-argument function
-- was dropped above, which took its grants with it — there is no
-- `import_submission(uuid)` left to revoke, and naming one here would make this
-- file fail to re-run.
revoke execute on function public.import_submission(uuid, boolean) from public, anon;
grant execute on function public.import_submission(uuid, boolean) to authenticated;

-- =============================================================================
-- VERIFY (run after applying, dev only)
--
-- All read-only except the three explicitly-rolled-back `set local role`
-- probes, which write nothing. Paste these one block at a time in the Supabase
-- SQL editor for the DEV project and compare against the expectations noted.
-- =============================================================================
--
-- -- 1. The six tables exist and RLS is ON for every one of them.
-- --    Expect 6 rows, relrowsecurity = true on all 6.
-- select c.relname, c.relrowsecurity
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in ('forms','form_versions','form_links','review_tokens',
--                     'form_submissions','submission_events')
-- order by c.relname;
--
-- -- 2. Both enums exist with the right labels.
-- select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder)
-- from pg_type t join pg_enum e on e.enumtypid = t.oid
-- where t.typname in ('submission_status','submission_channel')
-- group by t.typname;
--
-- -- 3. Policies. Expect: forms 4, form_versions 4, form_links 4,
-- --    form_submissions 4, review_tokens 2 (insert + update, NO select),
-- --    submission_events 1 (select only). Every `roles` value = {authenticated}
-- --    — if 'anon' or 'public' appears anywhere here, STOP.
-- select tablename, policyname, roles, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('forms','form_versions','form_links','review_tokens',
--                     'form_submissions','submission_events')
-- order by tablename, cmd, policyname;
--
-- -- 4. Table grants. Expect ZERO rows for grantee = 'anon' (this is the DB-2
-- --    hardening — the platform default would otherwise have handed anon
-- --    SELECT on all six).
-- select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('forms','form_versions','form_links','review_tokens',
--                      'form_submissions','submission_events')
--   and grantee in ('anon','authenticated','public')
-- group by table_name, grantee
-- order by table_name, grantee;
-- --    Expected 'authenticated' rows:
-- --      forms/form_versions/form_links/form_submissions -> DELETE,INSERT,SELECT,UPDATE
-- --      review_tokens                                   -> INSERT,UPDATE   (no SELECT)
-- --      submission_events                               -> SELECT
--
-- -- 5. Function security. Expect prosecdef = true and proconfig containing
-- --    search_path=public for the six callable ones. Check proacl:
-- --      get_form / submit_form / get_review_roster / verify_submission /
-- --      reject_submission        -> anon AND authenticated have X
-- --      import_submission        -> authenticated only, NO anon
-- --      submission_is_confidential_channel -> authenticated only
-- --      intake_validate_field / intake_apply_corrections /
-- --      intake_repeating_section_id / intake_correctable_field_ids /
-- --      intake_repeating_field_options / intake_repeating_field_def
-- --                                         -> owner only
-- --    Also check `args`: import_submission must be exactly ONE row reading
-- --    `p_submission_id uuid, p_is_confidential boolean`. If a second row with
-- --    just `p_submission_id uuid` is present, the old 1-arg version survived
-- --    the drop — STOP, because a stale client would silently bind to it and
-- --    lose the confidential-tier argument. Same for intake_apply_corrections:
-- --    exactly one row, three arguments.
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--        p.prosecdef, p.proconfig, p.proacl
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('get_form','submit_form','get_review_roster','verify_submission',
--                     'reject_submission','import_submission',
--                     'submission_is_confidential_channel','intake_validate_field',
--                     'intake_apply_corrections','intake_repeating_section_id',
--                     'intake_correctable_field_ids',
--                     'intake_repeating_field_options','intake_repeating_field_def',
--                     'prevent_published_form_version_edit')
-- order by p.proname, args;
--
-- -- 6. The §5.7 columns landed. Expect 14 rows.
-- select table_name, column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and (
--       (table_name = 'families' and column_name in ('source_submission_id','guardian_name',
--         'guardian_phone','guardian_email','preferred_language','consent_given_at',
--         'can_reach_church_pickup','needs_followup','followup_note'))
--    or (table_name = 'children' and column_name in ('source_submission_id',
--         'specific_needs_source','other_notes_source'))
--    or (table_name = 'wishlist_items' and column_name in ('description_source','source_locale')))
-- order by table_name, column_name;
--
-- -- 7. Triggers. Expect:
-- --      forms             -> set_updated_at
-- --      form_submissions  -> set_updated_at
-- --      form_versions     -> form_versions_immutable_once_published
-- --      form_links        -> audit_form_links          (M4)
-- --      review_tokens     -> audit_review_tokens       (M4)
-- --    and NO audit trigger on form_submissions or submission_events — an
-- --    audit_form_submissions row here would mean the answers blob is being
-- --    copied into the never-purged audit_log. That is a STOP.
-- select tgname, tgrelid::regclass, tgenabled
-- from pg_trigger
-- where not tgisinternal
--   and tgrelid::regclass::text in ('form_versions','forms','form_submissions',
--                                   'form_links','review_tokens','submission_events')
-- order by tgrelid::regclass::text, tgname;
--
-- -- 8. anon really cannot touch the new tables. Each block should ERROR with
-- --    "permission denied for table ..." — that error is the PASS. Run them one
-- --    at a time; the rollback resets the aborted transaction.
-- begin; set local role anon; select count(*) from form_submissions; rollback;
-- begin; set local role anon; select count(*) from review_tokens;    rollback;
-- begin; set local role anon; select count(*) from form_links;       rollback;
--
-- -- 9. anon cannot call the staff-only import. Should ERROR with
-- --    "permission denied for function import_submission".
-- begin; set local role anon;
--   select public.import_submission('00000000-0000-0000-0000-000000000000');
-- rollback;
--
-- -- 10. anon CAN call get_form, and an unknown token gets a clean refusal
-- --     (ok:false), not an exception and not a row.
-- begin; set local role anon;
--   select public.get_form('definitely-not-a-real-token-000');
-- rollback;
--
-- -- 11. After running supabase/intake_demo_seed.sql: the seeded link resolves
-- --     and returns ONLY definition / school_name / locale — no counselor
-- --     email, no drive internals, no submissions.
-- begin; set local role anon;
--   select jsonb_object_keys(public.get_form('demo-north-family-2026'));
-- rollback;
--
-- -- 12. The published version cannot be edited. Expect ERROR
-- --     "form_versions.definition is immutable once published".
-- begin;
--   update form_versions set definition = definition || '{"tampered":true}'::jsonb
--   where published_at is not null;
-- rollback;
--
-- -- 13. Confidential gating, as a PLAIN VOLUNTEER (not as admin). Run this
-- --     from the app / an anon-key session signed in as the volunteer test
-- --     account, not here: select id from form_submissions where
-- --     drive_school_id is null  ->  must return ZERO rows, not an error.
--
-- =============================================================================
-- VERIFY, part 2 — the fixes from the US-20 review (H1, M1-M5, L1, contract
-- changes). Same rules: dev only, read-only except where a rollback is shown.
-- =============================================================================
--
-- -- 14. H1 — an "Other" text box next to a NORMAL select value is now
-- --     rejected, and this is the exploit that reached the public sponsor
-- --     page. Both calls must come back ok = false with an error addressed to
-- --     children[0].shirt_size_other. Before the fix, both were ok = true and
-- --     the 99KB string landed on children.shirt_size.
-- --     (Run after intake_demo_seed.sql. These are REAL submit attempts — they
-- --     are inside a rollback, so nothing is kept, and a rejected submission
-- --     writes no row anyway.)
-- begin;
--   select public.submit_form(
--     'demo-north-family-2026',
--     jsonb_build_object(
--       'family', jsonb_build_object('guardian_name','Verify Case','guardian_phone','555-0100',
--                                    'preferred_language','en'),
--       'children', jsonb_build_array(jsonb_build_object(
--          'first_name','Test','age',8,'grade','3','sex','M',
--          'shirt_size','Youth M', 'shirt_size_other', repeat('x', 5000),
--          'pant_size','Youth 10','shoe_size','Youth 3',
--          'wishlist', jsonb_build_array('a bike'))),
--       'pickup_consent', jsonb_build_object('can_reach_church_pickup','Yes','consent',true)
--     )
--   );
-- rollback;
-- --     ...and the same payload with shirt_size omitted entirely (the old code
-- --     returned before ever looking at shirt_size_other):
-- begin;
--   select public.submit_form(
--     'demo-north-family-2026',
--     jsonb_build_object(
--       'family', jsonb_build_object('guardian_name','Verify Case','guardian_phone','555-0100',
--                                    'preferred_language','en'),
--       'children', jsonb_build_array(jsonb_build_object(
--          'first_name','Test','age',8,'grade','3','sex','M',
--          'shirt_size_other', repeat('x', 5000),
--          'pant_size','Youth 10','shoe_size','Youth 3',
--          'wishlist', jsonb_build_array('a bike'))),
--       'pickup_consent', jsonb_build_object('can_reach_church_pickup','Yes','consent',true)
--     )
--   );
-- rollback;
-- --     Still-accepted control case: shirt_size = 'Other' WITH a short
-- --     description must validate (expect ok = true, status 'submitted').
-- --     Keep this one rolled back too.
--
-- -- 15. H1 (second instance, found while fixing the first) — a non-string
-- --     wishlist entry is rejected instead of silently skipped. Expect
-- --     ok = false naming children[0].wishlist[1].
-- begin;
--   select public.submit_form(
--     'demo-north-family-2026',
--     jsonb_build_object(
--       'family', jsonb_build_object('guardian_name','Verify Case','guardian_phone','555-0100',
--                                    'preferred_language','en'),
--       'children', jsonb_build_array(jsonb_build_object(
--          'first_name','Test','age',8,'grade','3','sex','M',
--          'shirt_size','Youth M','pant_size','Youth 10','shoe_size','Youth 3',
--          'wishlist', jsonb_build_array('a bike', jsonb_build_object('junk', repeat('y', 3000))))),
--       'pickup_consent', jsonb_build_object('can_reach_church_pickup','Yes','consent',true)
--     )
--   );
-- rollback;
--
-- -- 16. H1 — nothing already in the database exceeds the import caps. After a
-- --     real end-to-end import, expect ZERO rows. (Also worth running against
-- --     existing hand-entered data, where a long value would be a pre-existing
-- --     data-entry issue rather than this migration's doing.)
-- select id, child_index,
--        char_length(grade) as grade_len, char_length(sex) as sex_len,
--        char_length(shirt_size) as shirt_len, char_length(pant_size) as pant_len,
--        char_length(shoe_size) as shoe_len,
--        char_length(specific_needs) as needs_len, char_length(other_notes) as notes_len
-- from children
-- where source_submission_id is not null
--   and (char_length(grade) > 40 or char_length(sex) > 40
--     or char_length(shirt_size) > 80 or char_length(pant_size) > 80
--     or char_length(shoe_size) > 80
--     or char_length(specific_needs) > 500 or char_length(other_notes) > 500);
--
-- -- 17. M1 — the one-family-per-submission index exists and is partial.
-- --     Expect exactly one row, indexdef containing
-- --     "WHERE (source_submission_id IS NOT NULL)".
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and indexname = 'families_one_per_submission';
--
-- -- 18. M1 — the idempotency floor actually holds. Take an IMPORTED demo
-- --     submission, hand-reset its status the way an admin could, and import
-- --     again: the second call must return already_imported = true with the
-- --     SAME family_id, and families must not gain a row. Rolled back.
-- --
-- --     NOTE for 18 and 19: import_submission checks is_admin(), which reads
-- --     auth.uid(). In the SQL editor auth.uid() is NULL, so a bare call
-- --     returns reason = 'forbidden' and proves nothing. Either run these from
-- --     the app signed in as an admin, or impersonate one inside the
-- --     transaction first:
-- --       set local role authenticated;
-- --       set local request.jwt.claims =
-- --         '{"sub":"<an admin profiles.id>","role":"authenticated"}';
-- begin;
--   with s as (select id from form_submissions where is_test_data and status = 'imported' limit 1)
--   update form_submissions set status = 'verified' where id in (select id from s);
--   select count(*) as families_before from families;
--   select public.import_submission(
--     (select id from form_submissions where is_test_data and status = 'verified' limit 1)
--   );
--   select count(*) as families_after from families;   -- must equal families_before
-- rollback;
--
-- -- 19. Contract — import_submission's confidential override. As an ADMIN, on
-- --     a verified school-channel demo submission: the created family must
-- --     come back is_confidential = true. Rolled back, so no demo family is
-- --     left tiered.
-- begin;
--   select public.import_submission(
--     (select id from form_submissions where is_test_data and status = 'verified' limit 1),
--     true
--   );
--   select f.id, f.family_number, f.is_confidential, f.source_submission_id
--   from families f where f.source_submission_id is not null
--   order by f.created_at desc limit 1;      -- expect is_confidential = t
-- rollback;
-- --     And the default: the same call with no second argument must produce
-- --     is_confidential = false for a school-channel submission.
--
-- -- 20. Contract — get_form no longer distinguishes a revoked link from an
-- --     unknown one. Expect BOTH to return reason = 'not_found'. (The revoke
-- --     is rolled back.)
-- begin;
--   update form_links set revoked_at = now() where token = 'demo-north-family-2026';
--   select public.get_form('demo-north-family-2026') ->> 'reason' as revoked_reason,
--          public.get_form('no-such-token-at-all-000') ->> 'reason' as unknown_reason;
-- rollback;
-- --     Expect: revoked_reason = not_found, unknown_reason = not_found.
-- --     If 'revoked' appears, web/lib/intake.ts's FormLinkProblem union no
-- --     longer covers what the database returns.
--
-- -- 21. M2 — form_links' select policy is gated, not `using (true)`. Expect the
-- --     qual to read: (drive_school_id IS NOT NULL) OR can_view_confidential()
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'form_links'
-- order by cmd, policyname;
-- --     Then the real test, which CANNOT be run here as the owner: signed in
-- --     as the plain volunteer test account through the app, with a
-- --     confidential-channel link seeded (drive_school_id is null),
-- --     `select id, token from form_links` must return ZERO rows for it — no
-- --     token, no submission_count. Run it as a volunteer, not as admin: an
-- --     admin clears can_view_confidential() and will see the row correctly.
--
-- -- 22. M3 — a non-bcrypt token_hash cannot be inserted. Expect ERROR
-- --     'new row ... violates check constraint "review_tokens_hash_is_bcrypt"'.
-- --     That error is the PASS.
-- begin;
--   insert into review_tokens (drive_id, drive_school_id, token_hash, issued_to_email, expires_at)
--   values ((select id from drives order by year desc limit 1), null,
--           'plaintext-not-a-hash', 'verify@demo.example.com', now() + interval '1 day');
-- rollback;
--
-- -- 23. M4 — the two admin-write tables are audited and the two PII tables are
-- --     not. Expect exactly 2 rows: form_links, review_tokens.
-- select tgrelid::regclass::text as table_name, tgname
-- from pg_trigger
-- where not tgisinternal
--   and tgfoid = 'public.audit_log_change()'::regprocedure
--   and tgrelid::regclass::text in ('forms','form_versions','form_links',
--                                   'review_tokens','form_submissions','submission_events')
-- order by 1;
-- --     And confirm no child PII went into audit_log from them (expect 0):
-- select count(*) from audit_log
-- where table_name in ('form_links','review_tokens')
--   and (diff::text ilike '%first_name%' or diff::text ilike '%wishlist%');
--
-- -- 24. M5 — the repeating section id is resolved, not assumed. Expect
-- --     'children' for the seeded definition, and null for a definition with
-- --     no repeating section (which every caller turns into a raised error).
-- select public.intake_repeating_section_id(v.definition) as child_key
-- from form_versions v
-- where v.published_at is not null
-- order by v.created_at desc limit 1;
-- select public.intake_repeating_section_id('{"sections":[{"id":"family"}]}'::jsonb) is null
--        as no_repeating_section_is_null;   -- expect t
--
-- -- 25. L1 — ip_hash is never populated. Expect 0, now and after any number of
-- --     real submissions.
-- select count(*) as rows_with_ip_hash from form_submissions where ip_hash is not null;
--
-- -- 26. get_review_roster returns `correction_fields` — the pinned definition's
-- --     rules for the three fields a counselor may correct (US-22 gap) — and
-- --     returning them did NOT widen the per-child projection.
-- --
-- --     There is NO `grade_options` key any more. It carried an overlapping
-- --     slice of this same definition data and was removed rather than kept
-- --     alongside; if it reappears in any of the checks below, two keys are
-- --     drifting apart again.
-- --
-- --     (a) Each field resolves from the pinned definition, whole. Expect ONE
-- --         row with three columns, each a {id,label,type,required,max_length,
-- --         min,max,options} object:
-- --           first_name -> type text,   required t, max_length 80,
-- --                         min/max null, options []
-- --           age        -> type number, required t, max_length null,
-- --                         min 0, max 19, options []
-- --           grade      -> type select, required t, options in DEFINITION
-- --                         order, starting 'Not in school yet', 'Pre-K', 'K'
-- --                         — NOT a list built from the grades that happen to
-- --                         be on the roster.
-- --
-- --         first_name.max_length is the live bug this closes: the roster input
-- --         allowed 120 while the definition says 80, so an 81-120 character
-- --         corrected name passed the browser and then RAISED "Correction
-- --         rejected: Please keep First name under 80 characters". If the value
-- --         here is not 80, the page and verify_submission disagree again.
-- select public.intake_repeating_field_def(v.definition, 'first_name') as first_name_def,
--        public.intake_repeating_field_def(v.definition, 'age')        as age_def,
--        public.intake_repeating_field_def(v.definition, 'grade')      as grade_def
-- from form_versions v
-- where v.published_at is not null
-- order by v.created_at desc limit 1;
--
-- --     (a2) Those bounds are the ones verify_submission will actually apply.
-- --          Cross-check the two numeric ones against the definition directly
-- --          rather than trusting (a) by eye. Expect t, t.
-- select (public.intake_repeating_field_def(v.definition, 'age') ->> 'min')::int
--          = (v.definition #>> '{sections,1,fields,1,min}')::int          as age_min_agrees,
--        (public.intake_repeating_field_def(v.definition, 'first_name') ->> 'max_length')::int
--          = (v.definition #>> '{sections,1,fields,0,max_length}')::int   as name_len_agrees
-- from form_versions v
-- where v.published_at is not null
-- order by v.created_at desc limit 1;
-- --     (the #>> paths assume the seeded definition's section/field order; if
-- --      that changes, re-point them rather than deleting the check.)
--
-- --     (b) Absent/odd shapes return NULL (never an object, never an error) — a
-- --         form version that doesn't collect grade must still produce a roster,
-- --         with that control rendered READ-ONLY rather than as a free-text box.
-- --         Expect t for all five columns.
-- select public.intake_repeating_field_def(null, 'grade') is null                 as null_def_null,
--        public.intake_repeating_field_def(
--          '{"sections":[{"id":"family","fields":[{"id":"grade","options":[{"value":"1"}]}]}]}'::jsonb,
--          'grade') is null                                                       as non_repeating_ignored,
--        public.intake_repeating_field_def(
--          '{"sections":[{"id":"children","repeating":true,"fields":[{"id":"age"}]}]}'::jsonb,
--          'grade') is null                                                       as no_grade_field_null,
--        public.intake_repeating_field_def(
--          '{"sections":[{"id":"kids","repeating":true,"fields":[{"id":"grade","options":"nope"}]}]}'::jsonb,
--          'grade') -> 'options' = '[]'::jsonb                                    as bad_options_empty,
--        public.intake_repeating_field_def(
--          '{"sections":{"id":"children","repeating":true}}'::jsonb,
--          'grade') is null                                                       as bad_sections_null;
-- --     (the last one must return t, and above all must not ERROR with
-- --      "cannot extract elements from an object" — that error would mean a
-- --      malformed definition takes the whole roster down, not just the picker.)
--
-- --     (b2) A malformed PROPERTY degrades to null instead of raising on a
-- --          cast, and a non-boolean `required` reads false. Expect one row:
-- --          max_length null, min null, max null, required f.
-- select public.intake_repeating_field_def(
--          '{"sections":[{"id":"children","repeating":true,"fields":[
--             {"id":"age","type":"number","required":"yes",
--              "max_length":"eighty","min":1.5,"max":{"a":1}}]}]}'::jsonb,
--          'age');
--
-- --     (c) The section id is resolved, not assumed: a repeating section named
-- --         something other than 'children' still yields its grade field, and a
-- --         blank-valued option is dropped while label falls back to value.
-- --         Expect options exactly [{"value":"K","label":"Kindergarten"},
-- --                                 {"value":"1","label":"1"}].
-- select public.intake_repeating_field_def(
--          '{"sections":[{"id":"kids","repeating":true,"fields":[
--             {"id":"grade","type":"select","options":[{"value":"K","label":"Kindergarten"},
--                                                      {"value":"1"},
--                                                      {"value":"","label":"blank dropped"}]}]}]}'::jsonb,
--          'grade');
--
-- --     (c2) The correctable list is one list, shared. Expect t — if this is f,
-- --          the roster is offering a control verify_submission will refuse, or
-- --          withholding one it would have accepted.
-- select public.intake_correctable_field_ids()
--          = array['first_name','age','grade']::text[] as correctable_ids_match;
--
-- --     (d) End to end, as ANON, with the demo review token (after
-- --         intake_demo_seed.sql). Expect exactly these top-level keys:
-- --         correction_fields, expires_at, ok, school_name, submissions — and
-- --         nothing else. `grade_options` must NOT be among them. A new key
-- --         here that isn't in ReviewRosterResult in web/lib/intake.ts means the
-- --         contract drifted.
-- begin; set local role anon;
--   select jsonb_object_keys(public.get_review_roster('<demo review token>'));
-- rollback;
--
-- --     (d2) ...and correction_fields itself carries exactly the three
-- --          correctable ids, always all three, even on an empty roster (where
-- --          each is JSON null). Expect: age, first_name, grade.
-- begin; set local role anon;
--   select jsonb_object_keys(
--            public.get_review_roster('<demo review token>') -> 'correction_fields'
--          ) order by 1;
-- rollback;
--
-- --     (e) THE PRIVACY CHECK for this addition — the per-child projection is
-- --         still first_name / age / grade only. Expect exactly four keys:
-- --         age, first_name, grade, index. If 'wishlist', 'shirt_size',
-- --         'specific_needs' or anything else appears, STOP: correction_fields
-- --         was added by widening the child whitelist instead of reading the
-- --         blank definition.
-- begin; set local role anon;
--   select distinct jsonb_object_keys(child)
--   from jsonb_array_elements(
--          public.get_review_roster('<demo review token>') -> 'submissions'
--        ) as s(sub)
--   cross join lateral jsonb_array_elements(sub -> 'children') as c(child)
--   order by 1;
-- rollback;
--
-- --     (f) ...and correction_fields carries no submission data either. It is
-- --         built from form_versions.definition only, so no child's name may
-- --         appear in it. Expect 0. (Run this one as the SQL-editor owner, NOT
-- --         `set local role anon` — anon has no grant on form_submissions at
-- --         all, which check 8 already proves; here we need to read the names
-- --         in order to look for them.)
--   select count(*)
--   from form_submissions fs
--   cross join lateral jsonb_array_elements(
--     case when jsonb_typeof(fs.answers -> 'children') = 'array'
--          then fs.answers -> 'children' else '[]'::jsonb end
--   ) as c(child)
--   where coalesce(c.child ->> 'first_name', '') <> ''
--     and (public.get_review_roster('<demo review token>')
--            -> 'correction_fields')::text ilike '%' || (c.child ->> 'first_name') || '%';
