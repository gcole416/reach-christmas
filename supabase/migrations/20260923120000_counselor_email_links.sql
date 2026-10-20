-- US-41 (docs/backlog.md) — email a school's links to its counselor from the
-- app, instead of only copy/paste. Prompted by Grant, 2026-09-23: link
-- distribution across a dozen-plus schools is currently all by hand.
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  APPLIED (verified 2026-10-20; docs/MIGRATION_LEDGER.md is the record).
--   PROD: NOT APPLIED, and must not be until a Software Acceptance Review,
--         same as every other intake migration.
--
-- Written to be re-runnable: `create table if not exists`, `create or replace
-- function`, `drop policy if exists` before create, guarded `create type`.
--
-- =============================================================================
-- What this adds
-- =============================================================================
--   * app_settings — a one-row config table holding `site_url`. Nothing in the
--     database knows the site's own origin today (form_links/review_tokens
--     store only a token; formPath()/reviewPath() in web/lib/intake.ts return a
--     RELATIVE path, composed with window.location client-side). An email is
--     sent from inside the database with no browser present, so it needs an
--     absolute URL from somewhere. Chose a plain table over a Vault secret
--     because this isn't a secret — it's ordinary per-environment config, and a
--     table can later grow a small admin settings screen without another
--     migration. RLS restricts it to admin read/write like everything else
--     here; the security-definer functions below read it regardless (same as
--     they already read `families`/`schools` past their own RLS).
--     ONE-TIME SETUP (per environment, same shape as the Resend Vault secret in
--     20260818160000): `update app_settings set site_url = 'https://...';`
--
--   * counselor_emails — one row per counselor-facing send, family/registration
--     links, the review link (this migration), or a future digest
--     (20260923130000, US-42). A log table, not a timestamp column on
--     form_links/review_tokens, because staff need "sent three times, still not
--     opened," not just "sent once." `sent_by` is null for a cron-driven send
--     (US-42) — nobody was signed in. RLS mirrors review_tokens' admin-only
--     read; audited like every other table here.
--
--   * send_counselor_registration_link(drive_school_id, locale) — emails every
--     live `family`-channel form_links row for that school AND that locale.
--   * send_counselor_review_link(drive_school_id) — emails the school's one
--     live review_tokens row.
--
--   Both: security definer, is_admin() re-checked in the body (SCHEMA.md
--   §12.2), fire the email via pg_net -> Resend exactly like
--   request_claim_code() in 20260818160000 (same Vault secret, same
--   fire-and-forget call), then write a counselor_emails row. Recipient is
--   ALWAYS schools.liaison_email — never a caller-supplied address. That's
--   deliberate: request_claim_code accepting an arbitrary address is exactly
--   what OPEN_QUESTIONS SPN-4 flags as an open abuse hole, and this feature
--   doesn't repeat it. A wrong address is fixed by editing the school record,
--   not by typing over it at send time.
--
--   English vs Spanish are two independent buttons/functions, not one email
--   with both links (Grant, 2026-09-23) — a school might only have one locale
--   live, and a counselor who only handles English families doesn't need a
--   Spanish link mixed into the same message. The review link has no locale of
--   its own (review_tokens carries none — the counselor roster is a staff-side
--   view, not a translated family-facing form) and stays a single button.
--
-- =============================================================================
-- Caveats worth reading before the reach-reviewer gate
-- =============================================================================
--   * pg_net is fire-and-forget: `net.http_post` queues the request and
--     returns a request id immediately, not Resend's response. Nothing here
--     confirms Resend accepted the mail, let alone that the district delivered
--     it. The `counselor_emails` row plus review_tokens.last_used_at is the
--     honest signal this migration can offer: "sent" and, for the review link
--     only, "opened." Real bounce/delivery tracking needs a Resend webhook,
--     which needs a Next.js route handler — this app has ZERO of those today,
--     so that's out of scope here, same conclusion 20260818160000 reached.
--   * pg_net persists every request body (Resend API key included) in its own
--     `net` schema tables. Both functions' request bodies carry a working
--     token — a form_links token (low sensitivity, write-only) or a
--     review_tokens token (reads a school's whole-season roster of children's
--     first names/ages/grades). The review case is the SAME exposure class
--     US-28 (20260903120000) already accepted deliberately when it started
--     storing that token in plaintext for re-copying — consistent with that
--     decision, not a new one, but stated here rather than left for review to
--     find.
--   * No sending domain is verified yet (still onboarding@resend.dev, the
--     TODO(Grant) at 20260818160000). This migration works end to end on dev
--     against the sandbox sender; it is not yet safe to rely on for real
--     school-district delivery. See the epic header in docs/backlog.md.
--
-- reach-reviewer gate REQUIRED: new function reads review_tokens (the
-- school-roster boundary) and form_links, new outbound-email path, new table.

begin;

-- =============================================================================
-- 1. app_settings — one-row config table.
-- =============================================================================
create table if not exists app_settings (
  -- Single-row table: a boolean primary key defaulting to true, checked true,
  -- makes a second row a constraint violation rather than a bug to notice
  -- later.
  id boolean primary key default true,
  site_url text not null default '',
  constraint app_settings_singleton check (id)
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

comment on table app_settings is
  'Single-row per-environment config. site_url: this deployment''s own absolute '
  'origin (e.g. https://reach-christmas.vercel.app), used to build links inside '
  'emails sent from the database (US-41). Set once via SQL; no admin UI yet.';

alter table app_settings enable row level security;

drop policy if exists "admin read app_settings" on app_settings;
create policy "admin read app_settings" on app_settings for select to authenticated
  using (is_admin());

drop policy if exists "admin write app_settings" on app_settings;
create policy "admin write app_settings" on app_settings for update to authenticated
  using (is_admin()) with check (is_admin());

grant select, update on app_settings to authenticated;

-- =============================================================================
-- 2. counselor_emails — the send log.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'counselor_email_kind') then
    create type counselor_email_kind as enum
      ('registration_link', 'review_link', 'review_digest');
  end if;
end $$;

create table if not exists counselor_emails (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  -- Always set in practice — every kind this feature sends is school-scoped
  -- (there is no counselor for the confidential/direct channel). Nullable
  -- anyway to mirror review_tokens/form_links' own shape rather than assert a
  -- constraint a future channel might need to relax.
  drive_school_id uuid references drive_schools(id) on delete cascade,
  kind counselor_email_kind not null,
  -- Meaningful for 'registration_link' only ('en' / 'es' today); null for
  -- 'review_link' and 'review_digest', which have no locale of their own.
  locale text,
  sent_to text not null,
  -- Null for a cron-driven send (US-42's review_digest) — nobody was signed in.
  sent_by uuid references profiles(id),
  -- Which link(s) this send actually included, for "what exactly did we send
  -- them" — not the plaintext token itself, which already lives on
  -- form_links/review_tokens; no reason to duplicate a secret a third time.
  form_link_ids uuid[] not null default '{}',
  review_token_id uuid references review_tokens(id),
  created_at timestamptz not null default now()
);

comment on table counselor_emails is
  'US-41/US-42: one row per counselor-facing email actually sent (or queued via '
  'pg_net) — registration link, review link, or the review_digest cron send. '
  'Not a timestamp column on form_links/review_tokens because staff need '
  '"sent three times, still not opened," not just a single last-sent date.';

create index if not exists counselor_emails_school_idx
  on counselor_emails (drive_school_id, kind, created_at desc);

alter table counselor_emails enable row level security;

-- Same shape as "admin read review_tokens" (20260903120000): is_admin(), plus
-- can_view_confidential() for a null-school row, which this feature never
-- actually produces today but the policy stays symmetrical rather than assert
-- a constraint a future confidential-channel counselor use wouldn't fit.
drop policy if exists "admin read counselor_emails" on counselor_emails;
create policy "admin read counselor_emails" on counselor_emails for select to authenticated
  using (is_admin() and (drive_school_id is not null or can_view_confidential()));

grant select on counselor_emails to authenticated;
-- No insert/update/delete grant or policy for `authenticated` — every row is
-- written by the security-definer functions below (or, in 20260923130000, by
-- the cron function), which insert as the function owner and so don't need
-- one. Same pattern as audit_log, which has no write policy either.

drop trigger if exists audit_counselor_emails on counselor_emails;
create trigger audit_counselor_emails after insert or update or delete on counselor_emails
  for each row execute function public.audit_log_change();

-- =============================================================================
-- 3. send_counselor_registration_link(drive_school_id, locale)
-- =============================================================================
create or replace function public.send_counselor_registration_link(
  p_drive_school_id uuid,
  p_locale text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_name  text;
  v_liaison      text;
  v_drive_id     uuid;
  v_site_url     text;
  v_api_key      text;
  v_link         record;
  v_link_ids     uuid[] := '{}';
  v_link_lines   text := '';
  v_count        int := 0;
  v_locale_label text;
begin
  if not is_admin() then
    raise exception 'Only an administrator can send counselor email.';
  end if;

  if p_locale is null or btrim(p_locale) = '' then
    raise exception 'A locale is required.';
  end if;

  select ds.drive_id, s.name, s.liaison_email
    into v_drive_id, v_school_name, v_liaison
  from drive_schools ds
  join schools s on s.id = ds.school_id
  where ds.id = p_drive_school_id;

  if v_drive_id is null then
    raise exception 'That school could not be found.';
  end if;

  if v_liaison is null or btrim(v_liaison) = '' then
    raise exception 'This school has no liaison email on file. Add one on the school record first.';
  end if;

  -- Double-click / repeat-click guard, same shape as request_claim_code's
  -- 60-second cooldown.
  if exists (
    select 1 from counselor_emails
    where drive_school_id = p_drive_school_id
      and kind = 'registration_link'
      and locale = p_locale
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'A registration link email was just sent for this school -- wait a bit before sending again.';
  end if;

  select site_url into v_site_url from app_settings limit 1;
  if v_site_url is null or btrim(v_site_url) = '' then
    raise exception 'The site address is not configured yet. Contact an administrator.';
  end if;

  v_locale_label := case p_locale when 'en' then 'English' when 'es' then 'Spanish' else p_locale end;

  for v_link in
    select id, token
    from form_links
    where drive_school_id = p_drive_school_id
      and channel = 'family'
      and locale = p_locale
      and revoked_at is null
      and (expires_at is null or expires_at > now())
      and (opens_at is null or opens_at <= now())
      and (max_submissions is null or submission_count < max_submissions)
    order by created_at desc
  loop
    v_link_ids := v_link_ids || v_link.id;
    v_link_lines := v_link_lines || rtrim(v_site_url, '/') || '/form/' || v_link.token || E'\n';
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'There is no live % registration link for this school yet.', v_locale_label;
  end if;

  select decrypted_secret into v_api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key'
  limit 1;

  if v_api_key is null then
    raise exception 'Email delivery is not configured yet. Please contact staff.';
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_api_key
    ),
    body := jsonb_build_object(
      -- TODO(Grant): swap for a verified sending domain — see this
      -- migration's header and the epic header in docs/backlog.md.
      'from', 'Reach Christmas <onboarding@resend.dev>',
      'to', jsonb_build_array(btrim(v_liaison)),
      'subject', v_school_name || ' -- ' || v_locale_label || ' family registration link',
      'text',
        'Hi,' || E'\n\n' ||
        'Please share this link with families at ' || v_school_name ||
        ' you''d like to refer to the Reach Christmas gift drive (' || v_locale_label || '):' ||
        E'\n\n' || v_link_lines || E'\n' ||
        'Thank you for partnering with us this season.'
    )
  );
  -- Fire-and-forget -- see this migration's header for what that does and
  -- doesn't tell us.

  insert into counselor_emails
    (drive_id, drive_school_id, kind, locale, sent_to, sent_by, form_link_ids)
  values
    (v_drive_id, p_drive_school_id, 'registration_link', p_locale, v_liaison, auth.uid(), v_link_ids);
end;
$$;

revoke execute on function public.send_counselor_registration_link(uuid, text) from public, anon;
grant execute on function public.send_counselor_registration_link(uuid, text) to authenticated;

-- =============================================================================
-- 4. send_counselor_review_link(drive_school_id)
-- =============================================================================
create or replace function public.send_counselor_review_link(p_drive_school_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_name text;
  v_liaison     text;
  v_drive_id    uuid;
  v_site_url    text;
  v_api_key     text;
  v_token_id    uuid;
  v_token       text;
begin
  if not is_admin() then
    raise exception 'Only an administrator can send counselor email.';
  end if;

  select ds.drive_id, s.name, s.liaison_email
    into v_drive_id, v_school_name, v_liaison
  from drive_schools ds
  join schools s on s.id = ds.school_id
  where ds.id = p_drive_school_id;

  if v_drive_id is null then
    raise exception 'That school could not be found.';
  end if;

  if v_liaison is null or btrim(v_liaison) = '' then
    raise exception 'This school has no liaison email on file. Add one on the school record first.';
  end if;

  if exists (
    select 1 from counselor_emails
    where drive_school_id = p_drive_school_id
      and kind = 'review_link'
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'A review link email was just sent for this school -- wait a bit before sending again.';
  end if;

  select site_url into v_site_url from app_settings limit 1;
  if v_site_url is null or btrim(v_site_url) = '' then
    raise exception 'The site address is not configured yet. Contact an administrator.';
  end if;

  -- issue_review_token() is idempotent per school (one live token at a time),
  -- so this is a lookup, not a choice among several. order/limit is belt and
  -- braces if that invariant is ever loosened.
  select id, token into v_token_id, v_token
  from review_tokens
  where drive_school_id = p_drive_school_id
    and revoked_at is null
    and expires_at > now()
    and token is not null
  order by created_at desc
  limit 1;

  if v_token_id is null then
    raise exception 'There is no live review link for this school yet. Create one first.';
  end if;

  select decrypted_secret into v_api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key'
  limit 1;

  if v_api_key is null then
    raise exception 'Email delivery is not configured yet. Please contact staff.';
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_api_key
    ),
    body := jsonb_build_object(
      'from', 'Reach Christmas <onboarding@resend.dev>',
      'to', jsonb_build_array(btrim(v_liaison)),
      'subject', v_school_name || ' -- your Reach Christmas review link',
      'text',
        'Hi,' || E'\n\n' ||
        'Here is your link to confirm the households referred from ' || v_school_name ||
        ' this season:' || E'\n\n' ||
        rtrim(v_site_url, '/') || '/review/' || v_token || E'\n\n' ||
        'It stays valid for the rest of the season -- please don''t forward it beyond your own use.' ||
        E'\n\n' || 'Thank you for partnering with us.'
    )
  );

  insert into counselor_emails
    (drive_id, drive_school_id, kind, sent_to, sent_by, review_token_id)
  values
    (v_drive_id, p_drive_school_id, 'review_link', v_liaison, auth.uid(), v_token_id);
end;
$$;

revoke execute on function public.send_counselor_review_link(uuid) from public, anon;
grant execute on function public.send_counselor_review_link(uuid) to authenticated;

commit;

-- VERIFY (run after applying, dev only):
--
-- 1. Config
--    update app_settings set site_url = 'http://localhost:3000';  -- or the dev Vercel URL
--    select * from app_settings;
--
-- 2. As a signed-in ADMIN session (not the SQL editor, which runs as postgres
--    and bypasses is_admin()), on a school with a live English family link and
--    a live review link, liaison_email set to an inbox you can check:
--    select send_counselor_registration_link('<drive_school_id>', 'en');
--    select send_counselor_review_link('<drive_school_id>');
--    select * from counselor_emails where drive_school_id = '<drive_school_id>'
--      order by created_at desc;   -- two rows
--
-- 3. Refusals:
--    -- no liaison email:
--    select send_counselor_review_link('<school_with_no_liaison_email>');
--      -> 'This school has no liaison email on file...'
--    -- no live link:
--    select send_counselor_registration_link('<drive_school_id>', 'es');
--      -> 'There is no live Spanish registration link for this school yet.'
--    -- as a VOLUNTEER session:
--    select send_counselor_review_link('<drive_school_id>');
--      -> 'Only an administrator can send counselor email.'
--    -- repeat within 60s:
--    select send_counselor_review_link('<drive_school_id>');  -- again, immediately
--      -> 'A review link email was just sent for this school...'
--
-- 4. review_tokens.last_used_at still only moves when the counselor actually
--    opens /review/<token> — unaffected by this migration; that's the "opened"
--    half of the FormLinkPanel status line.
