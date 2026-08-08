-- Family numbers move from "the volunteer picks one, checked client-side" to
-- "the database assigns one atomically" — two problems with the old way:
--   1. Multiple volunteers can be entering families at the same time on
--      different iPads/browsers. A client-side "suggest the next number,
--      check it's free" is a real race: two people could both see the same
--      suggestion and both submit, one of them getting a raw unique-
--      violation error instead of a family being saved.
--   2. It was editable at all, which the number never needed to be — it
--      exists for print tags and tracking, not something a volunteer should
--      be choosing or able to get wrong.
-- create_family() below closes the race with a per-scope advisory lock (so
-- concurrent inserts for the *same* school serialize, but different schools
-- never block each other) and does the number computation and the insert in
-- one atomic call — no separate "check, then insert" round trip for a
-- network race to land in.

-- Fixes a latent gap found alongside this: the per-school unique index
-- didn't actually enforce uniqueness for direct-referral families (no
-- school), because Postgres unique indexes treat NULL as distinct from NULL
-- — two direct-referral families could silently share a number. Collapsing
-- the null case to a fixed sentinel value makes the index mean what it always
-- was supposed to.
drop index families_number_per_school;
create unique index families_number_per_school
  on families (drive_id, coalesce(drive_school_id, '00000000-0000-0000-0000-000000000000'::uuid), family_number)
  where not is_confidential;

create or replace function public.create_family(
  p_drive_id uuid,
  p_drive_school_id uuid,
  p_is_confidential boolean,
  p_sort_tag text default null,
  p_internal_notes text default null
)
returns families
language plpgsql
security invoker
as $$
declare
  v_lock_key bigint;
  v_next_number int;
  v_family families;
begin
  v_lock_key := hashtextextended(
    coalesce(p_drive_school_id::text, 'confidential:' || p_is_confidential::text) || ':' || p_drive_id::text,
    0
  );
  -- Held for the rest of this transaction (i.e. this single RPC call) —
  -- a concurrent call for the same scope blocks here until this one commits,
  -- so the two calls can never compute the same "next" number.
  perform pg_advisory_xact_lock(v_lock_key);

  if p_is_confidential then
    select coalesce(max(family_number), 0) + 1 into v_next_number
    from families
    where drive_id = p_drive_id and is_confidential;
  else
    select coalesce(max(family_number), 0) + 1 into v_next_number
    from families
    where drive_id = p_drive_id
      and drive_school_id is not distinct from p_drive_school_id
      and not is_confidential;
  end if;

  insert into families (drive_id, drive_school_id, family_number, is_confidential, sort_tag, internal_notes, created_by)
  values (p_drive_id, p_drive_school_id, v_next_number, p_is_confidential, p_sort_tag, p_internal_notes, auth.uid())
  returning * into v_family;

  return v_family;
end;
$$;

grant execute on function public.create_family(uuid, uuid, boolean, text, text) to authenticated;
