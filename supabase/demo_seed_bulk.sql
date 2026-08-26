-- Bulk demo data — DEV PROJECT ONLY, NEVER PROD.
-- Adds ~100 more kids across randomly generated families, with a realistic
-- spread of statuses (unassigned/pledged/purchased/received/delivered/
-- cancelled) and claim ages (some overdue, some not) — meant to make the
-- Fulfillment board, Distribution page, and Print page worth looking at with
-- real volume instead of a handful of hand-picked examples.
--
-- Elementary-only, matching demo_seed.sql: grades are K-5 and both schools
-- are elementary. Reuses the same "Demo Elementary North/South" schools from
-- demo_seed.sql if they already exist (creates them if not), and tags every
-- family with is_test_data = true — so the cleanup lines at the bottom of
-- demo_seed.sql remove this data too. Safe to run whether or not
-- demo_seed.sql has been run first.
--
-- One card per child, always (ADM-2, 2026-08-18) — every kid below gets
-- exactly one `cards` row, no copy_number/total_copies/multi-card spread.

do $$
declare
  v_drive_id uuid;
  v_school_names text[] := array['Demo Elementary North', 'Demo Elementary South'];
  v_school_codes text[] := array['N', 'S'];
  v_ds_ids uuid[] := array[]::uuid[];
  v_school_id uuid;
  v_ds_id uuid;
  i int;

  v_first_names text[] := array[
    'Emma','Noah','Olivia','Liam','Ava','Mason','Sofia','Ethan','Isabella','Lucas',
    'Mia','Jacob','Charlotte','Elijah','Amelia','James','Harper','Benjamin','Evelyn','Michael',
    'Abigail','Alexander','Emily','Daniel','Elizabeth','Matthew','Layla','Henry','Avery','Jackson',
    'Ella','Sebastian','Scarlett','Aiden','Grace','Owen','Chloe','Samuel','Victoria','Wyatt',
    'Riley','John','Aria','David','Lily','Carter','Zoey','Luke','Penelope','Isaac'
  ];
  v_grades text[] := array['K','1','2','3','4','5'];
  v_wishlist text[] := array[
    'Bicycle','Art supplies','Board game','Dinosaur toys','Puzzle','Winter coat',
    'Headphones','Sketchbook','Sneakers','Basketball','Video game','Hoodie','Play jewelry kit','Journal',
    'Earbuds','Remote control car','Legos','Winter gloves','Craft kit','Coloring book','Jump rope',
    'Doll house','Crayons','Rain boots','Stuffed animal','Picture books',
    'Pajamas','Soccer ball','Skateboard','Backpack','Building blocks','Action figures'
  ];

  v_family_id uuid;
  v_child_id uuid;
  v_card_id uuid;
  v_sponsor_id uuid;

  v_target_kids int := 100;
  v_kids_created int := 0;
  v_family_num int;
  v_kids_in_family int;
  v_referral_roll numeric;
  v_status_roll numeric;
  v_days_ago int;
begin
  select id into v_drive_id from drives where status = 'open' order by year desc limit 1;
  if v_drive_id is null then
    raise exception 'No open drive found — open one on the Drives page first.';
  end if;

  -- Picks up wherever the last test-data batch left off (starting at 1000 if
  -- this is the first run) so re-running this script — or running it after
  -- demo_seed.sql — can never collide on family_number.
  select coalesce(max(family_number), 999) + 1 into v_family_num from families where is_test_data = true;

  for i in 1..2 loop
    select id into v_school_id from schools where name = v_school_names[i];
    if v_school_id is null then
      insert into schools (name) values (v_school_names[i]) returning id into v_school_id;
    end if;

    select id into v_ds_id from drive_schools where drive_id = v_drive_id and school_id = v_school_id;
    if v_ds_id is null then
      insert into drive_schools (drive_id, school_id, code) values (v_drive_id, v_school_id, v_school_codes[i])
        returning id into v_ds_id;
    end if;

    v_ds_ids := array_append(v_ds_ids, v_ds_id);
  end loop;

  while v_kids_created < v_target_kids loop
    v_kids_in_family := 1 + floor(random() * 3)::int; -- 1-3 kids per family
    if v_kids_created + v_kids_in_family > v_target_kids then
      v_kids_in_family := v_target_kids - v_kids_created;
    end if;

    v_referral_roll := random();
    if v_referral_roll < 0.85 then
      insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data)
        values (v_drive_id, v_ds_ids[1 + floor(random() * 2)::int], v_family_num, false, true)
        returning id into v_family_id;
    elsif v_referral_roll < 0.95 then
      insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data)
        values (v_drive_id, null, v_family_num, false, true)
        returning id into v_family_id;
    else
      insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data)
        values (v_drive_id, null, v_family_num, true, true)
        returning id into v_family_id;
    end if;

    for i in 1..v_kids_in_family loop
      insert into children (family_id, child_index, first_name, grade, age, sex)
        values (
          v_family_id, i,
          v_first_names[1 + floor(random() * array_length(v_first_names, 1))::int],
          v_grades[1 + floor(random() * array_length(v_grades, 1))::int],
          5 + floor(random() * 7)::int, -- elementary-appropriate spread, ~5-11
          case when random() < 0.5 then 'F' else 'M' end
        )
        returning id into v_child_id;

      insert into wishlist_items (child_id, position, description) values
        (v_child_id, 1, v_wishlist[1 + floor(random() * array_length(v_wishlist, 1))::int]),
        (v_child_id, 2, v_wishlist[1 + floor(random() * array_length(v_wishlist, 1))::int]),
        (v_child_id, 3, v_wishlist[1 + floor(random() * array_length(v_wishlist, 1))::int]);

      -- One card per child, always (ADM-2) — no more copy-count loop.
      insert into cards (child_id) values (v_child_id) returning id into v_card_id;

      v_status_roll := random();
      if v_status_roll >= 0.35 then
        insert into sponsors (name, email, phone) values (
          'Demo Sponsor ' || floor(random() * 10000)::text,
          'sponsor' || floor(random() * 1000000)::text || '@demo.example.com',
          null
        ) returning id into v_sponsor_id;

        if v_status_roll < 0.55 then
          v_days_ago := 1 + floor(random() * 30)::int;
          insert into assignments (card_id, sponsor_id, status, claimed_at)
            values (v_card_id, v_sponsor_id, 'pledged', now() - (v_days_ago || ' days')::interval);
        elsif v_status_roll < 0.70 then
          v_days_ago := 1 + floor(random() * 20)::int;
          insert into assignments (card_id, sponsor_id, status, claimed_at, purchased_at)
            values (
              v_card_id, v_sponsor_id, 'purchased',
              now() - ((v_days_ago + 3) || ' days')::interval,
              now() - (v_days_ago || ' days')::interval
            );
        elsif v_status_roll < 0.85 then
          v_days_ago := 1 + floor(random() * 15)::int;
          insert into assignments (card_id, sponsor_id, status, claimed_at, purchased_at, received_at_church_at)
            values (
              v_card_id, v_sponsor_id, 'received_at_church',
              now() - ((v_days_ago + 8) || ' days')::interval,
              now() - ((v_days_ago + 4) || ' days')::interval,
              now() - (v_days_ago || ' days')::interval
            );
        elsif v_status_roll < 0.95 then
          v_days_ago := 1 + floor(random() * 10)::int;
          insert into assignments (card_id, sponsor_id, status, claimed_at, purchased_at, received_at_church_at, delivered_at)
            values (
              v_card_id, v_sponsor_id, 'delivered',
              now() - ((v_days_ago + 15) || ' days')::interval,
              now() - ((v_days_ago + 10) || ' days')::interval,
              now() - ((v_days_ago + 5) || ' days')::interval,
              now() - (v_days_ago || ' days')::interval
            );
        else
          v_days_ago := 1 + floor(random() * 20)::int;
          insert into assignments (card_id, sponsor_id, status, claimed_at)
            values (v_card_id, v_sponsor_id, 'cancelled', now() - (v_days_ago || ' days')::interval);
        end if;
      end if;
      -- v_status_roll < 0.35: no assignment at all — card stays unassigned
    end loop;

    v_kids_created := v_kids_created + v_kids_in_family;
    v_family_num := v_family_num + 1;
  end loop;

  raise notice 'Created % demo kids across % families', v_kids_created, v_family_num - 1000;
end $$;
