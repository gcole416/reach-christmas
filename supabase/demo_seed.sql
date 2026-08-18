-- Demo seed data for Reach Christmas — DEV PROJECT ONLY.
-- Requires an 'open' drive to already exist (Drives page, or the earlier
-- `insert into drives (...) values (..., 'open')` you ran).
-- Everything created here is tagged for easy cleanup — see the cleanup
-- script at the bottom (run it only when you're done demoing).
--
-- Elementary-only by design: two elementary schools (K-5), so school-based
-- features (card letter codes, per-school filtering, liaison contacts) still
-- have two real school records to differentiate between, but every kid and
-- every school is elementary-level. No middle/high grades or schools appear
-- anywhere in this file or in demo_seed_bulk.sql.

do $$
declare
  v_drive_id uuid;
  v_school_a_id uuid; v_ds_a_id uuid;
  v_school_b_id uuid; v_ds_b_id uuid;
  v_family_id uuid;
  v_child_id uuid;
  v_card_id uuid;
  v_sponsor_id uuid;
begin
  select id into v_drive_id from drives where status = 'open' order by year desc limit 1;
  if v_drive_id is null then
    raise exception 'No open drive found — open one on the Drives page first.';
  end if;

  -- Schools (obviously-fake names, safe to find/delete later) ---------------
  insert into schools (name) values ('Demo Elementary North') returning id into v_school_a_id;
  insert into drive_schools (drive_id, school_id, code, liaison_name, liaison_phone, liaison_email, distribution_method)
    values (v_drive_id, v_school_a_id, 'N', 'Pat Rivera', '555-0101', 'privera@demo.example.com', 'school_dropoff')
    returning id into v_ds_a_id;

  insert into schools (name) values ('Demo Elementary South') returning id into v_school_b_id;
  insert into drive_schools (drive_id, school_id, code, liaison_name, liaison_phone, liaison_email, distribution_method)
    values (v_drive_id, v_school_b_id, 'S', 'Jamie Chen', '555-0102', 'jchen@demo.example.com', 'church_pickup')
    returning id into v_ds_b_id;

  -- Family 1 — Demo Elementary North, 2 kids: one delivered, one still unclaimed --
  insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data, checked_in_at)
    values (v_drive_id, v_ds_a_id, 1, false, true, now() - interval '4 days') returning id into v_family_id;

  insert into children (family_id, child_index, first_name, grade, age, sex, pant_size, shirt_size, shoe_size, target_card_count)
    values (v_family_id, 1, 'Emma', '3', 8, 'F', '8', 'M', '2', 1) returning id into v_child_id;
  insert into wishlist_items (child_id, position, description) values
    (v_child_id, 1, 'Bicycle'), (v_child_id, 2, 'Art supplies'), (v_child_id, 3, 'Board game');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 1, 1) returning id into v_card_id;
  insert into sponsors (name, email, phone) values ('Karen Whitfield', 'karen.w@demo.example.com', '555-0201') returning id into v_sponsor_id;
  insert into assignments (card_id, sponsor_id, status, claimed_at, purchased_at, received_at_church_at, delivered_at)
    values (v_card_id, v_sponsor_id, 'delivered', now() - interval '20 days', now() - interval '18 days', now() - interval '10 days', now() - interval '5 days');

  insert into children (family_id, child_index, first_name, grade, age, sex, pant_size, shirt_size, shoe_size, target_card_count)
    values (v_family_id, 2, 'Noah', 'K', 5, 'M', '5', 'S', '11', 1) returning id into v_child_id;
  insert into wishlist_items (child_id, position, description) values
    (v_child_id, 1, 'Dinosaur toys'), (v_child_id, 2, 'Puzzle'), (v_child_id, 3, 'Winter coat');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 1, 1); -- unclaimed

  -- Family 2 — Demo Elementary North, 1 kid, critically overdue pledge -----
  insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data)
    values (v_drive_id, v_ds_a_id, 2, false, true) returning id into v_family_id;
  insert into children (family_id, child_index, first_name, grade, age, sex, target_card_count)
    values (v_family_id, 1, 'Sofia', '5', 10, 'F', 1) returning id into v_child_id;
  insert into wishlist_items (child_id, position, description) values
    (v_child_id, 1, 'Headphones'), (v_child_id, 2, 'Sketchbook'), (v_child_id, 3, 'Sneakers, size 3');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 1, 1) returning id into v_card_id;
  insert into sponsors (name, email, phone) values ('Mark Delgado', 'mark.d@demo.example.com', null) returning id into v_sponsor_id;
  insert into assignments (card_id, sponsor_id, status, claimed_at)
    values (v_card_id, v_sponsor_id, 'pledged', now() - interval '25 days'); -- critical overdue

  -- Family 3 — Demo Elementary North, 1 kid, received at church (mid-fulfillment) --
  insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data)
    values (v_drive_id, v_ds_a_id, 3, false, true) returning id into v_family_id;
  insert into children (family_id, child_index, first_name, grade, age, sex, target_card_count)
    values (v_family_id, 1, 'Ethan', '1', 6, 'M', 1) returning id into v_child_id;
  insert into wishlist_items (child_id, position, description) values
    (v_child_id, 1, 'Building blocks'), (v_child_id, 2, 'Picture books'), (v_child_id, 3, 'Winter coat, size 6');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 1, 1) returning id into v_card_id;
  insert into sponsors (name, email, phone) values ('Downtown Rotary Club', 'contact@demo.example.com', '555-0303') returning id into v_sponsor_id;
  insert into assignments (card_id, sponsor_id, status, claimed_at, purchased_at, received_at_church_at)
    values (v_card_id, v_sponsor_id, 'received_at_church', now() - interval '12 days', now() - interval '9 days', now() - interval '3 days');

  -- Family 4 — Demo Elementary South, 1 kid needing 2 cards (multi-sponsor demo) --
  insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data, scheduled_pickup_at)
    values (v_drive_id, v_ds_b_id, 1, false, true, now() + interval '5 days') returning id into v_family_id;
  insert into children (family_id, child_index, first_name, grade, age, sex, target_card_count)
    values (v_family_id, 1, 'Liam', '4', 9, 'M', 2) returning id into v_child_id;
  insert into wishlist_items (child_id, position, description) values
    (v_child_id, 1, 'Basketball'), (v_child_id, 2, 'Video game'), (v_child_id, 3, 'Hoodie, size M');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 1, 2) returning id into v_card_id;
  insert into sponsors (name, email, phone) values ('Priya Anand', 'priya.a@demo.example.com', '555-0202') returning id into v_sponsor_id;
  insert into assignments (card_id, sponsor_id, status, claimed_at, purchased_at)
    values (v_card_id, v_sponsor_id, 'purchased', now() - interval '6 days', now() - interval '2 days');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 2, 2); -- 2nd copy still unclaimed

  -- Family 5 — Demo Elementary South, 2 siblings; one card was cancelled and
  -- is back on the market, demonstrating that flow ---------------------------
  insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data)
    values (v_drive_id, v_ds_b_id, 2, false, true) returning id into v_family_id;
  insert into children (family_id, child_index, first_name, grade, age, sex, target_card_count)
    values (v_family_id, 1, 'Ava', '2', 7, 'F', 1) returning id into v_child_id;
  insert into wishlist_items (child_id, position, description) values
    (v_child_id, 1, 'Play jewelry kit'), (v_child_id, 2, 'Sticker book'), (v_child_id, 3, 'Stuffed animal');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 1, 1) returning id into v_card_id;
  insert into sponsors (name, email, phone) values ('Early Bird', 'earlybird@demo.example.com', null) returning id into v_sponsor_id;
  insert into assignments (card_id, sponsor_id, status, claimed_at) values (v_card_id, v_sponsor_id, 'cancelled', now() - interval '25 days');
  -- ^ cancelled, so this card is unclaimed again on the sponsor page

  insert into children (family_id, child_index, first_name, grade, age, sex, target_card_count)
    values (v_family_id, 2, 'Mason', '4', 9, 'M', 1) returning id into v_child_id;
  insert into wishlist_items (child_id, position, description) values
    (v_child_id, 1, 'Remote control car'), (v_child_id, 2, 'Legos'), (v_child_id, 3, 'Winter gloves');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 1, 1); -- unclaimed

  -- Family 6 — Demo Elementary South, 1 kid, pledged a week ago (not yet overdue) --
  insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data)
    values (v_drive_id, v_ds_b_id, 3, false, true) returning id into v_family_id;
  insert into children (family_id, child_index, first_name, grade, age, sex, target_card_count)
    values (v_family_id, 1, 'Isabella', '3', 8, 'F', 1) returning id into v_child_id;
  insert into wishlist_items (child_id, position, description) values
    (v_child_id, 1, 'Craft kit'), (v_child_id, 2, 'Board game'), (v_child_id, 3, 'Sneakers, size 1');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 1, 1) returning id into v_card_id;
  insert into sponsors (name, email, phone) values ('Sam Okafor', 'sam.o@demo.example.com', '555-0304') returning id into v_sponsor_id;
  insert into assignments (card_id, sponsor_id, status, claimed_at) values (v_card_id, v_sponsor_id, 'pledged', now() - interval '3 days');

  -- Family 7 — direct referral, no school -----------------------------------
  insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data, internal_notes)
    values (v_drive_id, null, 1, false, true, 'Referred directly by a church member') returning id into v_family_id;
  insert into children (family_id, child_index, first_name, grade, age, sex, target_card_count)
    values (v_family_id, 1, 'Grace', '2', 7, 'F', 1) returning id into v_child_id;
  insert into wishlist_items (child_id, position, description) values
    (v_child_id, 1, 'Doll house'), (v_child_id, 2, 'Crayons'), (v_child_id, 3, 'Rain boots, size 1');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 1, 1); -- unclaimed

  -- Family 8 — confidential ---------------------------------------------------
  insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data, internal_notes)
    values (v_drive_id, null, 1, true, true, 'Demo confidential case — shows the first-initial redaction for non-admins') returning id into v_family_id;
  insert into children (family_id, child_index, first_name, grade, age, sex, target_card_count)
    values (v_family_id, 1, 'Chloe', '1', 6, 'F', 1) returning id into v_child_id;
  insert into wishlist_items (child_id, position, description) values
    (v_child_id, 1, 'Stuffed animal'), (v_child_id, 2, 'Picture books'), (v_child_id, 3, 'Pajamas, size 6');
  insert into cards (child_id, copy_number, total_copies) values (v_child_id, 1, 1); -- unclaimed, hidden from the public sponsor page

end $$;

-- ============================================================================
-- CLEANUP — run this only when you're done with the demo. Safe: it only
-- touches rows tagged is_test_data = true / the fake schools/sponsor emails
-- above, so it won't touch any real families or other test data you've
-- entered in dev. Note this also matches rows created by the e2e suite
-- (web/tests/e2e/helpers/factories.ts sets is_test_data via create_family()'s
-- p_is_test_data) — fine here since this is a manual, deliberately-run dev
-- script, not something that runs unattended.
-- ============================================================================
-- delete from families where is_test_data = true;
-- delete from sponsors where email like '%@demo.example.com';
-- delete from drive_schools where school_id in (select id from schools where name like 'Demo %');
-- delete from schools where name like 'Demo %';
