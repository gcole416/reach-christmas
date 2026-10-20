-- Staff-controlled sponsor emails (2026-10-19, Grant).
--
-- Decisions (Grant, 2026-10-19):
--   * Assigning a card no longer emails anyone. Emails go out only when staff
--     click "Email all assigned" or "Remind all assigned" on the sponsor
--     roster (/admin/sponsors).
--   * One email per sponsor household, listing every child assigned to them,
--     with one PDF card attached per child.
--   * "Email all assigned" only sends cards not yet emailed, so it is safe to
--     click again; a sponsor who later gets one more child receives just the
--     new card.
--   * "Remind all assigned" goes only to sponsors with at least one gift not
--     yet received at church (status pledged or purchased), listing just
--     those children. A 20-hour cooldown per card stops a double click from
--     sending two reminders.
--
-- How sending works: the browser calls the send-sponsor-emails Edge Function
-- with the signed-in staff member's own session. That function calls
-- get_sponsor_email_batch() below WITH THAT SAME SESSION (no service key,
-- ever), sends each sponsor's email through Resend one at a time (spaced to
-- stay under Resend's rate limit), and after each successful send calls
-- record_sponsor_emails_sent(). Because the function waits for Resend's
-- answer, a card is only marked emailed once Resend actually accepted it,
-- unlike the old fire-and-forget pg_net path.
--
-- What this adds:
--   * sponsor_email_kind gains 'card_assignment' and 'reminder'.
--   * assignments.card_emailed_at: when this card was emailed to its sponsor.
--     Null = not yet. Self-serve claims still email on their own path via
--     claim_card_with_code (unchanged here) and never set this column.
--   * assignments.email_lease_until: a short claim on a card while a send is
--     in flight. get_sponsor_email_batch stamps it (10 minutes) on every card
--     it hands out, and skips cards with a live lease, so two staff clicking
--     at once, or a retry while a slow send is still running, can't email
--     the same sponsor twice. A failed send keeps its lease, which also moves
--     the next batch past it instead of retrying it over and over; it
--     becomes eligible again once the lease runs out.
--   * assign_card_to_sponsor_family: same as 20261015170000, email block
--     removed.
--   * get_sponsor_email_batch(kind, limit) and
--     record_sponsor_emails_sent(kind, assignment_ids, sent_to): security
--     definer, authenticated only, same "any signed-in staff" rule as the
--     rest of the roster (public sign-up is disabled, so authenticated =
--     staff). Definer, not invoker, because sponsor_emails is admin-read-only
--     and the reminder cooldown has to see it for volunteers too. Both apply
--     the same gates as assign_card_to_sponsor_family: no confidential
--     households, nothing on hold, no high schoolers, no inactive roster
--     entries, staff-assigned cards only.
--
-- Applying: the enum values can't be removed once added. Otherwise the file
-- is safe to re-run. Once applied, assigning a card sends nothing until the
-- send-sponsor-emails Edge Function is deployed to that project and the new
-- web build is live, so ship all three together.
--
-- =============================================================================
-- APPLY STATUS
-- =============================================================================
--   DEV:  NOT YET APPLIED.
--   PROD: NOT APPLIED. Waits for a Software Acceptance Review.
--
-- reach-reviewer gate REQUIRED: new definer functions returning child card
-- data (first name, grade, sizes, wish list, needs: the same whitelist the
-- card PDF already uses) to authenticated callers, and a new email path.

-- New enum values. When the whole file is pasted into the SQL editor these
-- end up inside the same transaction as everything below, which Postgres
-- 12+ allows as long as nothing in that transaction uses the new values.
-- Nothing does: function bodies aren't checked at create time, and the
-- backfill only compares against 'thank_you'.
alter type sponsor_email_kind add value if not exists 'card_assignment';
alter type sponsor_email_kind add value if not exists 'reminder';

begin;

alter table assignments add column if not exists card_emailed_at timestamptz;
alter table assignments add column if not exists email_lease_until timestamptz;

comment on column assignments.email_lease_until is
  'Set by get_sponsor_email_batch while a roster email for this card is in '
  'flight; left to expire after 10 minutes. A live lease keeps a second, '
  'overlapping send from picking the card up.';

comment on column assignments.card_emailed_at is
  'When this card was emailed to its (staff-assigned) sponsor via the roster''s '
  '"Email all assigned". Null = not emailed yet. Set only by '
  'record_sponsor_emails_sent() after Resend accepts the email.';

-- Backfill: a staff-assigned card that already got the old automatic email
-- (a 'thank_you' row in sponsor_emails) counts as emailed, so "Email all
-- assigned" doesn't send it a second time. That old row meant "queued", not
-- "delivered", so a card whose old send silently failed is marked emailed
-- here too. That path only ever ran on dev (2026-10-15 to 10-19), so this
-- touches dev test data only; prod never ran it.
update assignments a
set card_emailed_at = se.created_at
from sponsor_emails se, sponsors s
where se.assignment_id = a.id
  and s.id = a.sponsor_id
  and s.sponsor_family_id is not null
  and se.kind::text = 'thank_you'
  and a.card_emailed_at is null;

create or replace function public.assign_card_to_sponsor_family(
  p_card_id uuid,
  p_sponsor_family_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sponsor_family sponsor_families%rowtype;
  v_card_drive_id uuid;
  v_already_claimed uuid;
  v_sponsor_id uuid;
  v_assignment_id uuid;
begin
  select * into v_sponsor_family from sponsor_families where id = p_sponsor_family_id;
  if v_sponsor_family is null then
    return jsonb_build_object('ok', false, 'error', 'That sponsor roster entry no longer exists.');
  end if;
  if not v_sponsor_family.is_active then
    return jsonb_build_object('ok', false, 'error', 'That sponsor roster entry is marked inactive.');
  end if;

  select a.id into v_already_claimed
  from assignments a
  where a.card_id = p_card_id and a.status <> 'cancelled'
  limit 1;

  if v_already_claimed is not null then
    return jsonb_build_object('ok', false, 'error', 'This card has already been claimed or assigned.');
  end if;

  select f.drive_id into v_card_drive_id
  from cards crd
  join children ch on ch.id = crd.child_id
  join families f on f.id = ch.family_id
  where crd.id = p_card_id
    and not f.is_confidential
    -- On hold for duplicate review, and high-schoolers (self-shop, never in
    -- the sponsor pool) -- same two gates getAssignableCards already applies
    -- at the query layer (mirrors public_available_cards' own three-way
    -- filter, see 20260909120000_child_on_hold.sql). Added here too so this
    -- function refuses both on its own, not just because the UI pool
    -- already excludes them. Deliberately NOT left as a known gap the way
    -- OPEN_QUESTIONS DB-29 accepts for claim_card_with_code -- this is a
    -- brand-new function, so there's no reason to carry that gap into it.
    and ch.held_at is null
    and not ch.is_high_schooler;

  if v_card_drive_id is null then
    -- Card doesn't exist, belongs to a confidential household, is on hold,
    -- or is a high schooler's -- same refusal either way, same message
    -- claim_card_with_code gives the public claim path, reworded for staff.
    return jsonb_build_object('ok', false, 'error', 'This card is not available for assignment (missing, confidential, on hold, or a high schooler).');
  end if;

  if v_card_drive_id is distinct from v_sponsor_family.drive_id then
    return jsonb_build_object('ok', false, 'error', 'This sponsor roster entry is from a different drive than this card.');
  end if;

  -- The sponsors insert lives INSIDE this block (20261015170000) so the
  -- unique_violation handler below rolls it back along with the failed
  -- assignment insert. A plain `return` from a handler does not undo earlier
  -- statements in the function, which used to leave an orphan sponsors row
  -- when two staff assigned the same card at once.
  begin
    insert into sponsors (name, email, phone, sponsor_family_id)
    values (v_sponsor_family.display_name, v_sponsor_family.contact_email, v_sponsor_family.contact_phone, v_sponsor_family.id)
    returning id into v_sponsor_id;

    insert into assignments (card_id, sponsor_id, status, claimed_at)
    values (p_card_id, v_sponsor_id, 'pledged', now())
    returning id into v_assignment_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'This card was just assigned to someone else -- refresh and try another.');
  end;

  -- No email here any more (20261019120000). Staff send card emails in bulk
  -- from the sponsor roster ("Email all assigned"), which picks up every
  -- assignment whose card_emailed_at is still null.

  return jsonb_build_object('ok', true, 'sponsor_id', v_sponsor_id, 'assignment_id', v_assignment_id);
end;
$$;

revoke all on function public.assign_card_to_sponsor_family(uuid, uuid) from anon, public;
grant execute on function public.assign_card_to_sponsor_family(uuid, uuid) to authenticated;

-- =============================================================================
-- get_sponsor_email_batch: claim the next batch to email, and return it.
-- =============================================================================
-- Picks up to p_limit (capped at 25) sponsor households that have cards
-- waiting, stamps a 10-minute lease on those cards (the claim that stops an
-- overlapping send from taking them too), and returns them with the
-- drop-off details from app_settings. total_sponsors is how many households
-- were waiting and unleased before this batch, this batch included.
--
-- The lease is taken with UPDATE ... RETURNING, and only cards that UPDATE
-- actually returns go into the batch. Two overlapping calls block on the
-- same rows; the second one re-checks the lease once the first commits and
-- skips those cards.
create or replace function public.get_sponsor_email_batch(
  p_kind text,
  p_limit integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_drive_id uuid;
  v_dropoff_location text;
  v_dropoff_days text;
  v_dropoff_deadline text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 25));
  v_total integer;
  v_family_ids uuid[];
  v_claimed uuid[];
  v_sponsors jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if p_kind is null or p_kind not in ('card_assignment', 'reminder') then
    raise exception 'Unknown email kind: %', p_kind;
  end if;

  select id into v_drive_id from drives where status = 'open' order by year desc limit 1;
  if v_drive_id is null then
    return jsonb_build_object('ok', false, 'error', 'There is no open drive.');
  end if;

  select dropoff_location, dropoff_days, dropoff_deadline
  into v_dropoff_location, v_dropoff_days, v_dropoff_deadline
  from app_settings limit 1;

  create temporary table if not exists pg_temp.sponsor_email_eligible (
    sponsor_family_id uuid,
    display_name text,
    assignment_id uuid
  ) on commit drop;
  truncate pg_temp.sponsor_email_eligible;

  insert into pg_temp.sponsor_email_eligible
  select sf.id, sf.display_name, a.id
  from sponsor_families sf
  join sponsors s on s.sponsor_family_id = sf.id
  join assignments a on a.sponsor_id = s.id
  join cards crd on crd.id = a.card_id
  join children ch on ch.id = crd.child_id
  join families f on f.id = ch.family_id
  where sf.drive_id = v_drive_id
    and sf.is_active
    and sf.contact_email is not null and btrim(sf.contact_email) <> ''
    and not f.is_confidential
    and ch.held_at is null
    and not ch.is_high_schooler
    and a.status <> 'cancelled'
    and (a.email_lease_until is null or a.email_lease_until < now())
    and (
      (p_kind = 'card_assignment' and a.card_emailed_at is null)
      or
      (p_kind = 'reminder'
        and a.status in ('pledged', 'purchased')
        -- Not within 20 hours of the card email itself, nor of an earlier
        -- reminder: stops "Email all" then "Remind all" (or a double click)
        -- from sending twice in a row.
        and a.card_emailed_at is not null
        and a.card_emailed_at < now() - interval '20 hours'
        and not exists (
          select 1 from sponsor_emails se
          where se.assignment_id = a.id
            and se.kind::text = 'reminder'
            and se.created_at > now() - interval '20 hours'
        ))
    );

  select count(distinct sponsor_family_id) into v_total from pg_temp.sponsor_email_eligible;

  select array_agg(sponsor_family_id) into v_family_ids
  from (
    select sponsor_family_id, min(display_name) as display_name
    from pg_temp.sponsor_email_eligible
    group by sponsor_family_id
    order by min(display_name), sponsor_family_id
    limit v_limit
  ) picked;

  if v_family_ids is null then
    return jsonb_build_object(
      'ok', true, 'sponsors', '[]'::jsonb, 'total_sponsors', 0,
      'dropoff_location', v_dropoff_location,
      'dropoff_days', v_dropoff_days,
      'dropoff_deadline', v_dropoff_deadline
    );
  end if;

  -- The claim. The lease re-check here is what a concurrent call that was
  -- blocked on these rows sees after the first one commits.
  with leased as (
    update assignments a
    set email_lease_until = now() + interval '10 minutes'
    from pg_temp.sponsor_email_eligible e
    where e.assignment_id = a.id
      and e.sponsor_family_id = any(v_family_ids)
      and (a.email_lease_until is null or a.email_lease_until < now())
    returning a.id
  )
  select array_agg(id) into v_claimed from leased;

  select coalesce(jsonb_agg(sponsor_row order by sort_name, sort_id), '[]'::jsonb)
  into v_sponsors
  from (
    select
      sf.display_name as sort_name,
      sf.id as sort_id,
      jsonb_build_object(
        'sponsor_family_id', sf.id,
        'sponsor_name', sf.display_name,
        'sponsor_email', btrim(sf.contact_email),
        'cards', jsonb_agg(
          jsonb_build_object(
            'assignment_id', a.id,
            'card_number', coalesce(ds.code, 'Z') || f.family_number || '.' || ch.child_index,
            'first_name', ch.first_name,
            'grade', ch.grade,
            'pant_size', ch.pant_size,
            'shirt_size', ch.shirt_size,
            'shoe_size', ch.shoe_size,
            'specific_needs', ch.specific_needs,
            'wishlist_lines', (
              select string_agg('- ' || wi.description, E'\n' order by wi.position)
              from wishlist_items wi where wi.child_id = ch.id
            )
          )
          order by f.family_number, ch.child_index
        )
      ) as sponsor_row
    from assignments a
    join sponsors s on s.id = a.sponsor_id
    join sponsor_families sf on sf.id = s.sponsor_family_id
    join cards crd on crd.id = a.card_id
    join children ch on ch.id = crd.child_id
    join families f on f.id = ch.family_id
    left join drive_schools ds on ds.id = f.drive_school_id
    where a.id = any(coalesce(v_claimed, '{}'::uuid[]))
    group by sf.id, sf.display_name, sf.contact_email
  ) rows;

  return jsonb_build_object(
    'ok', true,
    'sponsors', v_sponsors,
    'total_sponsors', v_total,
    'dropoff_location', v_dropoff_location,
    'dropoff_days', v_dropoff_days,
    'dropoff_deadline', v_dropoff_deadline
  );
end;
$$;

revoke all on function public.get_sponsor_email_batch(text, integer) from anon, public;
grant execute on function public.get_sponsor_email_batch(text, integer) to authenticated;

-- =============================================================================
-- record_sponsor_emails_sent: called once per successful send.
-- =============================================================================
-- Only acts on staff-assigned, non-cancelled, non-confidential cards in the
-- open drive, whatever ids it's given.
create or replace function public.record_sponsor_emails_sent(
  p_kind text,
  p_assignment_ids uuid[],
  p_sent_to text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if p_kind is null or p_kind not in ('card_assignment', 'reminder') then
    raise exception 'Unknown email kind: %', p_kind;
  end if;
  if p_assignment_ids is null or cardinality(p_assignment_ids) = 0 then
    return;
  end if;

  select array_agg(a.id) into v_ids
  from assignments a
  join sponsors s on s.id = a.sponsor_id
  join cards crd on crd.id = a.card_id
  join children ch on ch.id = crd.child_id
  join families f on f.id = ch.family_id
  join drives d on d.id = f.drive_id
  where a.id = any(p_assignment_ids)
    and s.sponsor_family_id is not null
    and a.status <> 'cancelled'
    and not f.is_confidential
    and d.status = 'open';

  if v_ids is null then
    return;
  end if;

  insert into sponsor_emails (drive_id, assignment_id, kind, sent_to)
  select f.drive_id, a.id, p_kind::sponsor_email_kind, btrim(coalesce(p_sent_to, ''))
  from assignments a
  join cards crd on crd.id = a.card_id
  join children ch on ch.id = crd.child_id
  join families f on f.id = ch.family_id
  where a.id = any(v_ids);

  -- The lease is left to run out rather than cleared: clearing it would let
  -- a call that read the eligible list just before this one leased the
  -- cards claim them again. card_emailed_at (and the 20-hour reminder
  -- cooldown) keep them out of later batches anyway.
  if p_kind = 'card_assignment' then
    update assignments
    set card_emailed_at = coalesce(card_emailed_at, now())
    where id = any(v_ids);
  end if;
end;
$$;

revoke all on function public.record_sponsor_emails_sent(text, uuid[], text) from anon, public;
grant execute on function public.record_sponsor_emails_sent(text, uuid[], text) to authenticated;

commit;

-- VERIFY (dev, after applying):
--
-- 1. Assign a test child on /admin/assign. Expect NO new sponsor_emails row:
--    select * from sponsor_emails order by created_at desc limit 3;
-- 2. Signed in as staff, in the app (not the SQL editor, which has no
--    auth.uid()): the roster's "Email all assigned" dialog should count that
--    sponsor. Send it, then:
--    select id, card_emailed_at from assignments order by claimed_at desc limit 3;
--    -- card_emailed_at set; plus one sponsor_emails row, kind card_assignment.
-- 3. Click "Email all assigned" again: nothing to send.
-- 4. "Remind all assigned" right away sends nothing: reminders wait 20
--    hours after the card email and after the last reminder. To test it on
--    dev, backdate the card email first:
--    update assignments set card_emailed_at = now() - interval '1 day' where id = '<id>';
-- 5. Two tabs, both clicking "Email all assigned" at the same moment: each
--    sponsor gets one email, not two.
