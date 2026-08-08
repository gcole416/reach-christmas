-- Resolves the confidential-referral gap found during review: as originally
-- written, only a can_view_confidential()/admin user could INSERT a
-- confidential family/child/card/wishlist_item at all (the insert policies
-- carried the same gate as read/update). That meant an ordinary volunteer
-- selecting "Confidential" on the intake form would hit a raw RLS error and
-- couldn't submit — exactly backwards, since the volunteer taking down a
-- sensitive referral is usually the one who needs to be able to flag it.
--
-- Fix: insert is opened up to any authenticated staff member (with check
-- (true)) — the family_id/child_id a row references still has to be known
-- ahead of time, and UUIDs aren't guessable, so this isn't a meaningful new
-- exposure. The real protection stays at SELECT/UPDATE: unchanged for
-- can_view_confidential()/admin, and now also extended to the ORIGINAL
-- creator (via the new families.created_by column), so the volunteer who
-- entered a confidential case can still see and fix their own submission
-- without gaining visibility into confidential families anyone else created.

alter table families add column created_by uuid references profiles(id);

-- families ----------------------------------------------------------------

drop policy "staff insert families" on families;
create policy "staff insert families" on families for insert to authenticated
  with check (true);

drop policy "staff read families" on families;
create policy "staff read families" on families for select to authenticated
  using (not is_confidential or can_view_confidential() or created_by = auth.uid());

drop policy "staff update families" on families;
create policy "staff update families" on families for update to authenticated
  using (not is_confidential or can_view_confidential() or created_by = auth.uid())
  with check (not is_confidential or can_view_confidential() or created_by = auth.uid());

-- children ------------------------------------------------------------------

drop policy "staff insert children" on children;
create policy "staff insert children" on children for insert to authenticated
  with check (true);

drop policy "staff read children" on children;
create policy "staff read children" on children for select to authenticated
  using (
    not exists (select 1 from families f where f.id = family_id and f.is_confidential)
    or can_view_confidential()
    or exists (select 1 from families f where f.id = family_id and f.created_by = auth.uid())
  );

drop policy "staff update children" on children;
create policy "staff update children" on children for update to authenticated
  using (
    not exists (select 1 from families f where f.id = family_id and f.is_confidential)
    or can_view_confidential()
    or exists (select 1 from families f where f.id = family_id and f.created_by = auth.uid())
  )
  with check (
    not exists (select 1 from families f where f.id = family_id and f.is_confidential)
    or can_view_confidential()
    or exists (select 1 from families f where f.id = family_id and f.created_by = auth.uid())
  );

-- cards -----------------------------------------------------------------------

drop policy "staff insert cards" on cards;
create policy "staff insert cards" on cards for insert to authenticated
  with check (true);

drop policy "staff read cards" on cards;
create policy "staff read cards" on cards for select to authenticated
  using (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
    or exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.created_by = auth.uid()
    )
  );

drop policy "staff update cards" on cards;
create policy "staff update cards" on cards for update to authenticated
  using (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
    or exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.created_by = auth.uid()
    )
  )
  with check (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
    or exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.created_by = auth.uid()
    )
  );

-- wishlist_items ------------------------------------------------------------

drop policy "staff insert wishlist_items" on wishlist_items;
create policy "staff insert wishlist_items" on wishlist_items for insert to authenticated
  with check (true);

drop policy "staff read wishlist_items" on wishlist_items;
create policy "staff read wishlist_items" on wishlist_items for select to authenticated
  using (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
    or exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.created_by = auth.uid()
    )
  );

drop policy "staff update wishlist_items" on wishlist_items;
create policy "staff update wishlist_items" on wishlist_items for update to authenticated
  using (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
    or exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.created_by = auth.uid()
    )
  )
  with check (
    not exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.is_confidential
    )
    or can_view_confidential()
    or exists (
      select 1 from children c join families f on f.id = c.family_id
      where c.id = child_id and f.created_by = auth.uid()
    )
  );
