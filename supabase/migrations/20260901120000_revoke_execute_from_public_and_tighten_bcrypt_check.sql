-- =============================================================================
-- 20260901120000 — Two fixes found by qa-tester's live run against dev.
--
--   Fix 1 (SECURITY, live hole): claim_card() is still callable by anon.
--          Root cause of OPEN_QUESTIONS DB-27, open since 2026-08-19.
--   Fix 2 (M3, correctness): review_tokens_hash_is_bcrypt is a prefix check
--          that accepts an impossible cost (e.g. $2a$99$). Tighten to a full
--          format check so the question of "does crypt() raise on that?"
--          stops mattering.
--
-- Additive and re-runnable. No data is read, written, or deleted by this file.
--
-- =============================================================================
-- SAFE TO PASTE INTO EITHER PROJECT (dev or prod). READ THIS BEFORE EDITING.
-- =============================================================================
-- FIX 1 is the only file in this repo that closes DB-27, a LIVE sponsor-facing
-- hole. FIX 2 touches `public.review_tokens`, which only exists once
-- 20260830120000_intake_forms.sql has been applied — and that file is DEV-ONLY
-- (gated behind the SAR; prod's exact state is not reliably known, see
-- docs/DEPLOY.md Phase 0).
--
-- The Supabase SQL editor runs a pasted script as ONE transaction. So if FIX 2
-- raised `relation "public.review_tokens" does not exist` on a database without
-- the intake tables, the whole script would roll back and FIX 1 WOULD NEVER
-- COMMIT — while the error message named review_tokens, making it read like the
-- bcrypt half failed rather than like the security fix silently didn't land.
--
-- FIX 2 is therefore wrapped in a `to_regclass('public.review_tokens') is null`
-- guard that SKIPS it with a notice instead of raising. Consequences, stated
-- plainly for whoever is pasting:
--
--   * ON A DATABASE WITHOUT review_tokens (e.g. prod today): FIX 1, FIX 1b and
--     the PostgREST reload all apply and commit normally. FIX 2 is skipped and
--     prints `skipping FIX 2`. That is the EXPECTED, CORRECT outcome — not a
--     failure, and nothing needs to be re-run. When 20260830120000 is later
--     applied to that database, re-paste THIS file afterwards to pick up the
--     tightened constraint (re-running it is a no-op for everything else).
--   * ON A DATABASE WITH review_tokens (dev today): unchanged behaviour. The
--     pre-flight, the drop-if-exists and the add all run exactly as before.
--
-- INVARIANT — do not break it: pasting this file into a database that lacks the
-- intake tables must still close DB-27. Any future edit to FIX 2 stays inside
-- the guard, and no statement outside the guard may reference review_tokens.
-- =============================================================================


-- =============================================================================
-- BACKGROUND — why `revoke ... from anon, authenticated` was a no-op.
--
-- READ THIS BEFORE WRITING ANOTHER REVOKE. This is the SECOND time this
-- project has been bitten by Postgres/Supabase default privileges (the first
-- was DB-2, on table-level SELECT). The mechanism is not obvious and it does
-- not announce itself: the revoke succeeds, returns no error, and changes
-- nothing that matters.
--
-- On this database, a newly created function ends up with TWO INDEPENDENT
-- sources of EXECUTE, and you have to remove both:
--
--   (1) THE POSTGRES BUILT-IN DEFAULT.  Postgres grants EXECUTE on every new
--       function to the pseudo-role `PUBLIC` — that is, to every role in the
--       cluster, including `anon`, `authenticated`, and any role added later.
--       This is core Postgres behaviour, not a Supabase choice, and it is
--       invisible in `\df+` until someone issues the first GRANT or REVOKE on
--       the function (before that, pg_proc.proacl is NULL, meaning "the
--       default", which INCLUDES the PUBLIC grant). You remove it with
--       `revoke execute ... from public`.
--
--   (2) SUPABASE'S PLATFORM DEFAULT PRIVILEGES.  This project's `public`
--       schema has `alter default privileges ... grant all on functions to
--       anon, authenticated, service_role` configured at the platform level,
--       so each new function ALSO gets an explicit per-role EXECUTE grant at
--       CREATE time, regardless of what the migration itself says. This is the
--       one 20260812090000 documented (and DB-2 found the table-level
--       equivalent of). You remove it with `revoke execute ... from anon`
--       (and/or `authenticated`).
--
-- REVOKING ONE LEAVES THE OTHER. Naming only `anon, authenticated` leaves the
-- PUBLIC grant, which `anon` still inherits — the door stays open. Naming only
-- `public` leaves the explicit per-role grant — the door also stays open.
-- Every lockdown revoke in this repo must name BOTH:
--
--     revoke execute on function public.f(...) from public, anon;            -- ok
--     revoke execute on function public.f(...) from public, anon, authenticated; -- ok
--     revoke execute on function public.f(...) from anon, authenticated;     -- NO-OP
--     revoke execute on function public.f(...) from public;                  -- NO-OP
--
-- Note that 20260812090000's header describes `revoke ... from public` as
-- "a no-op — confirmed live: it changed nothing." That observation was correct
-- IN ISOLATION (it removed source 1 while source 2 was still standing) but the
-- conclusion drawn from it — that `public` is irrelevant here — is wrong. That
-- migration's actual SQL is fine, because it happened to name `public, anon`
-- together. 20260818160000:394 named only `anon, authenticated`, and that is
-- the bug this file fixes.
--
-- HOW TO SPOT IT: `select proname, proacl from pg_proc where proname = '...'`.
-- An entry with an EMPTY grantee (`=X/postgres`) is the PUBLIC grant. An entry
-- like `anon=X/postgres` is the per-role grant. Both must be gone.
-- =============================================================================


-- =============================================================================
-- FIX 1 — claim_card() must not be reachable by an anonymous caller.
--
-- OPEN_QUESTIONS DB-27. 20260818160000 (SPN-3) revoked claim_card from
-- `anon, authenticated` so the unverified one-shot claim path would be closed
-- and claim_card_with_code() would be the only way to pledge a card. Per the
-- background above, that revoke removed the per-role grant and left the PUBLIC
-- grant, so anon kept EXECUTE the whole time.
--
-- qa-tester reproduced this live on dev rather than inferring it: an anonymous
-- claim_card call reaches a foreign-key error (assignments_card_id_fkey), which
-- can only happen if the function BODY ran. Impact while it stood: a sponsor
-- could claim any card without ever receiving or entering a verification code,
-- defeating the entire point of SPN-3. web/tests/e2e/security.spec.ts was
-- correct all along and was catching a real bug.
--
-- claim_card is still left DEFINED rather than dropped, unchanged from
-- 20260818160000's reasoning: 20260708120000_init.sql is already applied and
-- this project never edits an applied migration in place. Unreachable is
-- enough; dropping it would also make this file non-re-runnable.
--
-- `authenticated` is named too. It has no legitimate use for this function
-- either (staff never claim on a sponsor's behalf through this path — see
-- web/lib/store.tsx, which only calls request_claim_code/claim_card_with_code),
-- and re-naming it costs nothing and makes the intent unambiguous.
-- =============================================================================

revoke execute on function public.claim_card(uuid, text, text, text) from public, anon, authenticated;


-- =============================================================================
-- FIX 1b — create_family(), found by the audit this fix triggered.
--
-- Not the same no-op: this one was never revoked from ANYTHING. 20260818130000
-- dropped the old (uuid,uuid,boolean,text,text) signature and created the
-- current (uuid,uuid,boolean,boolean,text) one, then granted it to
-- `authenticated`. A grant to `authenticated` does not remove anyone else's
-- access, so the fresh function carried both default grants above and `anon`
-- has held EXECUTE on it ever since.
--
-- NOT currently exploitable, and this is a defence-in-depth fix, not a second
-- live hole: create_family is `security invoker`, so an anon caller gets no
-- elevated privilege from it. Its non-confidential branch reads `families`
-- under anon's own (nonexistent) RLS, computes family_number = 1, and then
-- fails the insert on families' RLS; its confidential branch calls
-- next_confidential_family_number(), which 20260812090000 correctly revoked
-- from `public, anon`, so that errors first. Either way anon gets an error and
-- writes nothing. It is closed anyway because the only thing standing between
-- anon and a families INSERT is one future permissive policy nobody remembers
-- is load-bearing — exactly the DB-2 argument.
--
-- The grant is re-issued (idempotent) so this file cannot leave the staff
-- intake path broken if it is ever run out of order against a fresh database.
-- `web/lib/store.tsx`'s addFamily() is the only caller and it always runs in an
-- authenticated staff session.
-- =============================================================================

revoke execute on function public.create_family(uuid, uuid, boolean, boolean, text) from public, anon;
grant  execute on function public.create_family(uuid, uuid, boolean, boolean, text) to authenticated;


-- =============================================================================
-- AUDIT RESULT — every other lockdown revoke in the repo was checked.
--
-- Correct already (they name `public` explicitly, so they are real, not
-- no-ops). Listed so nobody has to redo this audit:
--
--   20260812090000_restrict_confidential_helper_grants.sql
--     family_is_confidential / family_created_by / child_family_id /
--     next_confidential_family_number  -> `from public, anon`  ✓
--     US-16's fix is genuinely in force; anon cannot reach the confidential
--     helpers. (Its HEADER's explanation is misleading — see BACKGROUND — but
--     its SQL is right.)
--
--   20260830120000_intake_forms.sql — all thirteen of its functions:
--     prevent_published_form_version_edit / submission_is_confidential_channel
--     / import_submission                      -> `from public, anon`  ✓
--     intake_repeating_section_id / intake_correctable_field_ids /
--     intake_repeating_field_options / intake_repeating_field_def /
--     intake_apply_corrections / intake_validate_field
--                                              -> `from public, anon, authenticated`  ✓
--     get_form / submit_form / get_review_roster / verify_submission /
--     reject_submission -> `from public` then re-granted to anon by design  ✓
--
-- Deliberately anon-callable, no revoke wanted: request_claim_code,
-- claim_card_with_code (SPN-3's actual verified path).
--
-- Over-granted by platform default but NOT reachable and NOT changed here:
--   is_admin(), can_view_confidential() — never revoked from anything, so anon
--     holds EXECUTE and PostgREST does expose them as RPC. Both take no
--     arguments and read only `profiles where id = auth.uid()`; for anon
--     auth.uid() is null, so both return `false` and disclose nothing about any
--     row. Left alone in this file on purpose: every policy that calls them is
--     scoped `to authenticated` (see 20260708120000:276-411), so revoking is
--     safe, but it is unrelated hardening and this migration has to be pasted
--     before a demo. Flagged to the PM as a separate hygiene item.
--   handle_new_user(), prevent_role_self_escalation(), set_updated_at(),
--     audit_log_change() — trigger functions. PostgREST does not expose
--     functions that return `trigger` as RPC, so there is no call path at all.
--     Not touched: revoking EXECUTE on a live trigger function has a
--     non-zero chance of interacting with trigger firing, and there is no
--     security gain to buy with that risk.
--
-- TABLE-LEVEL REVOKES — checked for the same PUBLIC-default no-op, and they
-- are CORRECT AS WRITTEN. Recorded here so nobody re-derives it:
--
--   20260818160000_email_verified_claims.sql:47
--     revoke all on all tables in schema net from anon, authenticated;
--   20260818160000_email_verified_claims.sql:99
--     revoke all on card_claim_verifications from anon, authenticated;
--
-- Both name only `anon, authenticated` — the shape that WAS a no-op on
-- functions — but the BACKGROUND mechanism does not apply to them, because it
-- is specific to functions. Postgres grants PUBLIC a default privilege on new
-- FUNCTIONS (EXECUTE) and on new types/domains/languages, but it grants PUBLIC
-- NO privileges on new tables: a fresh table's owner-only ACL means there is no
-- source-(1) grant to leave behind. Only Supabase's platform default privileges
-- (source 2) put `anon`/`authenticated` on a table, and naming those two roles
-- removes exactly that. Adding `public` to these two lines would revoke nothing
-- that was ever granted.
--
-- Conclusion: claim_card was the ONLY function whose intended lockdown was a
-- live no-op. create_family (1b) is a missing revoke, not a no-op revoke. No
-- other PUBLIC-default no-op exists anywhere in this repo.
-- =============================================================================


-- =============================================================================
-- FIX 2 — review_tokens_hash_is_bcrypt: make it a format check, not a prefix.
--
-- 20260830120000:262 shipped `^\$2[abxy]?\$[0-9]{2}\$`. That anchors only the
-- prefix, so it accepts `$2a$99$` (cost 99 — bcrypt's valid range is 04-31)
-- and it accepts a correct prefix followed by anything at all, including
-- nothing. Whether extensions.crypt() RAISES or merely returns non-matching
-- garbage on such a value decides whether M3 is actually closed, and that is a
-- question this migration removes rather than answers.
--
-- Why it matters: get_review_roster / verify_submission / reject_submission all
-- find a token by SCANNING live review_tokens rows and calling
-- extensions.crypt(candidate, rt.token_hash) on each. There is no per-school
-- filter on that scan (it cannot have one — the school is only known after the
-- token matches). crypt() raising on a single malformed hash aborts the whole
-- scan, so ONE bad row breaks the counselor path for EVERY school, not just the
-- school that owns the bad row. The constraint exists to make that row
-- impossible; a prefix check leaves a shape that can slip through.
--
-- The tightened pattern:
--     ^\$2[abxy]?\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$
--   - `$2` + optional variant letter, as before (pgcrypto emits `$2a$`)
--   - cost restricted to 04-31, bcrypt's real range
--   - exactly 53 trailing characters from bcrypt's base64 alphabet:
--     22 salt + 31 digest. Total literal length 60, and the `$` anchor means
--     nothing can be appended.
--
-- SEEDED DEMO TOKEN — CHECKED BEFORE WRITING THIS, because a failure here
-- fails the migration and takes Grant's demo review link with it.
-- supabase/intake_demo_seed.sql:499 hashes with
-- `extensions.crypt(v_review_token, extensions.gen_salt('bf'))`. pgcrypto's
-- one-argument gen_salt('bf') uses its built-in default cost of 6, emitting a
-- `$2a$06$` prefix, and crypt() then returns a 60-character `$2a$06$` + 22-char
-- salt + 31-char digest string. Cost 06 is inside `0[4-9]`; the tail is 53
-- characters from `./A-Za-z0-9`. The seeded row passes. The pre-flight block
-- below proves it against the actual table rather than trusting this paragraph.
--
-- card_claim_verifications.code_hash uses the same gen_salt('bf') and has no
-- such constraint. Deliberately not adding one: that table is looked up by its
-- card_id primary key, never scanned, so a malformed row there can only break
-- its own card's claim — it has none of the blast radius that motivates M3.
--
-- The constraint is already applied to dev, so this is drop-then-add rather
-- than a bare add. `drop constraint if exists` keeps the file re-runnable.
--
-- DEPENDENCY GUARD (see the header). `review_tokens` ships in
-- 20260830120000_intake_forms.sql, which is dev-only. Everything below —
-- pre-flight AND both `alter table` statements — lives inside one do-block that
-- returns early when the table is absent, so a database without the intake
-- feature skips FIX 2 with a notice and still commits FIX 1. The two DDL
-- statements are issued via `execute` so that the table name is never resolved
-- on the skip path, under any plpgsql parse-time behaviour.
-- =============================================================================

do $rtpre$
declare
  v_bad_count int;
  v_bad_ids   text;
  c_pattern constant text := '^\$2[abxy]?\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$';
begin
  -- Not an error. A database that has never had 20260830120000 applied has no
  -- counselor-review feature to protect, so there is nothing for M3 to fix
  -- here. Skipping keeps FIX 1 (DB-27, a live hole) committing on that
  -- database, which is the entire point of this guard.
  if to_regclass('public.review_tokens') is null then
    raise notice
      'review_tokens not present (20260830120000_intake_forms.sql has not been applied to this database) '
      '-- skipping FIX 2. This is expected on prod. FIX 1/1b DID apply. Re-run this file after the intake '
      'migration is ever applied here, to pick up the tightened bcrypt constraint.';
    return;
  end if;

  -- Pre-flight. Runs BEFORE the drop, so a database with a nonconforming row
  -- keeps its existing (weaker) constraint instead of ending up with none.
  -- Reports ids and a count only — never a token_hash, which is the secret.
  select count(*), coalesce(string_agg(id::text, ', ' order by id), '(none)')
    into v_bad_count, v_bad_ids
  from public.review_tokens
  where token_hash !~ c_pattern;

  if v_bad_count > 0 then
    raise exception
      'review_tokens has % row(s) whose token_hash does not match the tightened bcrypt format; ids: %. '
      'Not dropping the existing constraint. These rows predate the stricter check. '
      'A review token cannot be repaired (the plaintext is not recoverable from a hash) -- the row must be '
      'revoked and a fresh token issued to that counselor, which is an admin action, not a migration. '
      'Re-run this migration once review_tokens contains no such row.',
      v_bad_count, v_bad_ids;
  end if;

  raise notice 'Pre-flight OK: all % review_tokens row(s) satisfy the tightened bcrypt format.',
    (select count(*) from public.review_tokens);

  -- Idempotent: on dev, where this already succeeded once, the drop removes the
  -- constraint installed by the previous run and the add reinstalls the
  -- identical definition. Net effect of a re-run is nothing.
  execute 'alter table public.review_tokens drop constraint if exists review_tokens_hash_is_bcrypt';
  execute format(
    'alter table public.review_tokens add constraint review_tokens_hash_is_bcrypt check (token_hash ~ %L)',
    c_pattern
  );

  raise notice 'FIX 2 applied: review_tokens_hash_is_bcrypt is now a full-format check.';
end $rtpre$;


-- =============================================================================
-- PostgREST schema cache.
--
-- PostgREST decides which functions to expose from its cached schema snapshot,
-- including their privileges. Without this, /rpc/claim_card can keep answering
-- from the stale snapshot for a while after the revoke lands. DB-27's original
-- writeup already ruled a stale cache out as the CAUSE; this is here so it
-- cannot become a confusing symptom of the FIX.
-- =============================================================================

notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY (run after applying, dev only)
--
-- Read-only except check 6, which is wrapped in an explicit rollback and
-- writes nothing. Each check is marked [postgres] (paste into the Supabase SQL
-- editor for the DEV project, which runs as a superuser-equivalent) or
-- [session] (qa-tester can drive it from the app / an anon-key client, no SQL
-- editor needed).
--
-- Checks 1-4 and 9-11 apply to ANY database this file was pasted into.
-- Checks 5-8 are about FIX 2 and only apply where `review_tokens` exists. If
-- the apply printed `skipping FIX 2`, skip 5-8 too — they will error with
-- `relation "review_tokens" does not exist`, which is the expected state there,
-- not a problem.
-- =============================================================================
--
-- -- 1. [postgres] FIX 1, the direct answer to DB-27. Expect all three FALSE.
-- --    Before this migration, anon_can and public_can were TRUE -- and note
-- --    that anon_can is the one that matters: it already accounts for the
-- --    PUBLIC grant, which is exactly why the original revoke looked like it
-- --    should have worked and didn't.
-- --    ('public' is the PUBLIC pseudo-role, accepted here by documented
-- --    special case. If your server rejects it, drop that third column --
-- --    check 2 below answers the same question from the raw ACL.)
-- select has_function_privilege('anon',          'public.claim_card(uuid,text,text,text)', 'execute') as anon_can,
--        has_function_privilege('authenticated', 'public.claim_card(uuid,text,text,text)', 'execute') as auth_can,
--        has_function_privilege('public',        'public.claim_card(uuid,text,text,text)', 'execute') as public_can;
--
-- -- 2. [postgres] The ACL itself, which is what the BACKGROUND section is
-- --    about. Expect proacl to contain NO empty-grantee entry (`=X/postgres`,
-- --    the PUBLIC grant) and no `anon=X/` or `authenticated=X/` entry for
-- --    claim_card or create_family. It should be postgres/service_role only,
-- --    plus `authenticated=X/` on create_family.
-- select p.proname,
--        pg_get_function_identity_arguments(p.oid) as args,
--        coalesce(p.proacl::text, '(NULL = postgres defaults, PUBLIC HAS EXECUTE)') as acl
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('claim_card', 'create_family', 'claim_card_with_code', 'request_claim_code')
-- order by p.proname;
--
-- -- 3. [postgres] Regression sweep — the whole point of the audit. Every
-- --    function that is supposed to be locked away from anon, in one query.
-- --    Expect anon_can = FALSE on EVERY row. Any TRUE is a new DB-27.
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute') as anon_can
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in (
--     'claim_card', 'create_family',
--     'family_is_confidential', 'family_created_by', 'child_family_id',
--     'next_confidential_family_number',
--     'submission_is_confidential_channel', 'import_submission',
--     'intake_repeating_section_id', 'intake_correctable_field_ids',
--     'intake_repeating_field_options', 'intake_repeating_field_def',
--     'intake_apply_corrections', 'intake_validate_field'
--   )
-- order by anon_can desc, p.proname;
--
-- -- 4. [postgres] The four functions anon IS supposed to reach are untouched.
-- --    Expect anon_can = TRUE on all of these, or the sponsor and intake pages
-- --    are now broken.
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('request_claim_code','claim_card_with_code','get_form',
--                     'submit_form','get_review_roster','verify_submission',
--                     'reject_submission')
-- order by p.proname;
--
-- -- 5. [postgres] FIX 2 is installed. Expect the cost alternation and the
-- --    {53} tail to appear in the definition.
-- select conname, pg_get_constraintdef(oid) as def
-- from pg_constraint
-- where conrelid = 'public.review_tokens'::regclass
--   and conname = 'review_tokens_hash_is_bcrypt';
--
-- -- 6. [postgres] FIX 2 actually bites. All three inserts must ERROR with
-- --    'violates check constraint "review_tokens_hash_is_bcrypt"'. THE ERROR IS
-- --    THE PASS. Run them ONE AT A TIME -- the first failure aborts the
-- --    transaction, so a later statement in the same block would report
-- --    "current transaction is aborted" instead of the constraint error and
-- --    look like a false pass. Rollback either way; nothing is written.
-- --    (a) is the old M3 case and already failed before this migration.
-- --    (b) and (c) are the ones the prefix-only check LET THROUGH.
-- begin;
--   -- (a) plaintext
--   insert into review_tokens (drive_id, drive_school_id, token_hash, issued_to_email, expires_at)
--   values ((select id from drives order by year desc limit 1), null,
--           'plaintext-not-a-hash', 'verify@demo.example.com', now() + interval '1 day');
-- rollback;
-- begin;
--   -- (b) impossible cost, valid-looking body
--   insert into review_tokens (drive_id, drive_school_id, token_hash, issued_to_email, expires_at)
--   values ((select id from drives order by year desc limit 1), null,
--           '$2a$99$' || repeat('a', 53), 'verify@demo.example.com', now() + interval '1 day');
-- rollback;
-- begin;
--   -- (c) correct prefix, truncated body
--   insert into review_tokens (drive_id, drive_school_id, token_hash, issued_to_email, expires_at)
--   values ((select id from drives order by year desc limit 1), null,
--           '$2a$06$', 'verify@demo.example.com', now() + interval '1 day');
-- rollback;
--
-- -- 7. [postgres] A genuine bcrypt hash is still accepted, i.e. the constraint
-- --    did not overshoot and lock out the real issuing path. Expect ok = true
-- --    and cost = '06' (pgcrypto gen_salt('bf') default). Reads nothing from
-- --    review_tokens.
-- select extensions.crypt('any-plaintext', extensions.gen_salt('bf'))
--          ~ '^\$2[abxy]?\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$' as ok,
--        substring(extensions.crypt('x', extensions.gen_salt('bf')) from 5 for 2) as cost,
--        length(extensions.crypt('x', extensions.gen_salt('bf'))) as len;   -- expect true, 06, 60
--
-- -- 8. [postgres] The seeded demo review token survived. Expect zero bad rows,
-- --    and every prefix '$2a$06$' at length 60. (The pre-flight block already
-- --    raised if this were false, but confirm post-apply too.) Prefix only --
-- --    never select a full token_hash.
-- select count(*) filter (
--          where token_hash !~ '^\$2[abxy]?\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$'
--        ) as bad_rows,
--        count(*) as total_rows,
--        min(length(token_hash)) as min_len,
--        max(length(token_hash)) as max_len,
--        string_agg(distinct substring(token_hash from 1 for 7), ', ') as prefixes
-- from review_tokens;
--
-- -- 9. [session] qa-tester, anon key, NO login. The DB-27 repro, re-run.
-- --    Previously this got past permissions into the function body and
-- --    returned a foreign-key error (assignments_card_id_fkey) -- proof the
-- --    body executed. Now expect a PERMISSION/NOT-FOUND failure instead:
-- --    PostgREST 404 with code PGRST202 ("Could not find the function"), or
-- --    42501 permission denied if the cache has not turned over yet. Anything
-- --    mentioning assignments_card_id_fkey means the fix did not take.
-- --      await anonClient.rpc('claim_card', {
-- --        p_card_id: '<any real card id from /sponsor>',
-- --        p_sponsor_name: 'DB-27 probe', p_sponsor_email: 'probe@demo.example.com'
-- --      })
-- --    Then confirm no row was created (run as postgres):
-- --      select count(*) from sponsors where name = 'DB-27 probe';   -- expect 0
--
-- -- 10. [session] qa-tester, anon key, NO login. The supported path still
-- --     works end to end and SPN-3 is now the only way in: request_claim_code
-- --     -> read the emailed 6-digit code -> claim_card_with_code -> the card
-- --     leaves public_available_cards. This is the check that proves Fix 1
-- --     closed the bypass without closing the front door.
--
-- -- 11. [session] qa-tester, signed in as a PLAIN VOLUNTEER (not admin).
-- --     Fix 1b re-granted create_family to `authenticated`; confirm staff
-- --     intake still saves. Add a family through the intake form and confirm it
-- --     gets a family_number. A "permission denied for function create_family"
-- --     here means the grant did not re-issue.
-- =============================================================================
