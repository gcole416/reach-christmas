# Database Schema (draft v1)

*Status: DRAFT — nothing has been run against a real database yet, so this costs nothing to change.
Once we scaffold Supabase and real data exists, changes become "migrations" (normal, incremental,
still very doable) rather than free edits. See [DESIGN.md](DESIGN.md) for the higher-level brainstorm
this is built from.*

Written for Postgres on Supabase (per [DESIGN.md §6](DESIGN.md#6-tech-stack--recommendation)).

## Conventions

- Every table has a `uuid` primary key (`gen_random_uuid()`), matching Supabase norms.
- `created_at` / `updated_at` are `timestamptz`, defaulting to `now()`.
- Enums are used for small fixed sets of statuses; free text is used wherever the old spreadsheet
  showed messy real-world values (e.g. sizes like `"32-34"` or `"Girls 6"`) that don't fit a clean type.
- `profiles` is the staff/volunteer accounts table — named to match Supabase's common convention of
  pairing a `profiles` table with its built-in `auth.users`.
- A **child** is a person; a **card** is a printable, claimable gift-slot for that child. Most children
  have exactly one card, but a child can have several when it's easier to split their gifts across
  multiple sponsors (see §7) — this is the one place the schema deliberately separates "who" from
  "what gets claimed."

```sql
create extension if not exists pgcrypto;

create type drive_status as enum ('draft', 'open', 'closed', 'archived');
create type distribution_method as enum ('school_dropoff', 'church_pickup');
create type assignment_status as enum ('pledged', 'purchased', 'received_at_church', 'delivered', 'cancelled');
create type app_role as enum ('admin', 'volunteer');
```

## 1. `drives` — one row per year's gift drive

```sql
create table drives (
  id uuid primary key default gen_random_uuid(),
  year int not null unique,
  name text not null,                                -- e.g. "Reach Christmas 2026"
  status drive_status not null default 'draft',
  referral_window_start date,
  referral_window_end date,
  default_distribution_method distribution_method,   -- fallback if a school doesn't set its own
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 2. `profiles` — staff/volunteer accounts

Mirrors Supabase's built-in `auth.users`; this table adds the app-specific fields (role, confidential access).

```sql
create table profiles (
  id uuid primary key references auth.users(id),
  full_name text not null,
  role app_role not null default 'volunteer',
  can_view_confidential boolean not null default false,
  created_at timestamptz not null default now()
);
```

## 3. `schools` — reusable year over year

Kept separate from any one drive, since a school might participate in multiple years and its identity
(name) shouldn't be re-entered each time. Answers the open question "is the school list fixed year to
year" by not forcing an answer — schools can be added anytime, and each drive picks who's in via `drive_schools`.

```sql
create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,                     -- e.g. "Clear Creek High School"
  notes text,
  created_at timestamptz not null default now()
);
```

## 4. `drive_schools` — a school's participation in one specific drive

This is where the single-letter card code (`C`, `T`, etc.), that year's referral liaison contact, and
that year's distribution method all live — because any of these could change year to year even if the
school itself doesn't.

```sql
create table drive_schools (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  school_id uuid not null references schools(id),
  code text not null,                                -- e.g. 'C' — used in that year's card numbers
  liaison_name text,                                 -- school contact/counselor for referrals
  liaison_phone text,
  liaison_email text,
  distribution_method distribution_method,           -- overrides drives.default_distribution_method
  unique (drive_id, school_id),
  unique (drive_id, code)
);
```

*Open question carried over from [DESIGN.md §8](DESIGN.md#8-open-questions): is `liaison_*` actually
tracked anywhere today, or does that relationship happen informally? If it's informal, these columns
just stay null — no harm either way.*

## 5. `families` — the referral unit (may be confidential, may have no school)

```sql
create table families (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  drive_school_id uuid references drive_schools(id),   -- null if confidential / direct referral
  family_number int not null,
  is_confidential boolean not null default false,
  sort_tag text,                              -- was "Color" in the old sheet — purpose unconfirmed, see below
  internal_notes text,
  distribution_method_override distribution_method,    -- rare case: differs from the school's default
  scheduled_pickup_at timestamptz,
  checked_in_at timestamptz,
  checked_in_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- family_number is scoped per school, except confidential families which are scoped per drive instead
create unique index families_number_per_school
  on families (drive_id, drive_school_id, family_number)
  where not is_confidential;

create unique index families_number_confidential
  on families (drive_id, family_number)
  where is_confidential;

create index families_drive_id_idx on families (drive_id);
```

## 6. `children` — one referral record per kid

```sql
create table children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  child_index int not null,                   -- the ".1" / ".2" part of a card number
  first_name text not null,
  grade text,                                 -- kept as text: real data includes "K", "1", ..., "12"
  age int,
  sex text,
  specific_needs text,
  pant_size text,
  shirt_size text,
  shoe_size text,
  other_notes text,
  target_card_count int not null default 1,   -- how many printable cards this child should have — see §7
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, child_index)
);

create index children_family_id_idx on children (family_id);
```

`target_card_count` is the input side of the "recommend cards for printing" workflow: staff bump it up
(e.g. to 2) when a child's wishlist is big or varied enough that splitting it across two sponsors makes
sense. `cards` (below) is the output side — the actual rows that get printed and claimed.

A card's base identifier (`C1.3`) is never stored — it's derived (school code + family number + child
index), so it can't drift out of sync if a school's code ever changes. A view for that base identifier:

```sql
create view child_card_numbers as
select
  c.id as child_id,
  coalesce(ds.code, 'Z') || f.family_number || '.' || c.child_index as card_number,
  f.id as family_id,
  f.drive_id
from children c
join families f on f.id = c.family_id
left join drive_schools ds on ds.id = f.drive_school_id;
```

## 7. `cards` — the physical, claimable gift-slots for a child

This is the table your note added. A child normally has one card, but when it's easier to split their
gifts across multiple sponsors, a child gets multiple card *copies* — e.g. "Emma C1.3 (1 of 2)" and
"Emma C1.3 (2 of 2)" — each independently printable and independently claimable. **Claiming/assignments
attach to a card, not directly to a child** (see §9), which is what actually allows two different
sponsors to each take one gift for the same kid.

```sql
create table cards (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children(id) on delete cascade,
  copy_number int not null,           -- 1-based, e.g. 1 of 2
  total_copies int not null,          -- copy of children.target_card_count at the time this row was made
  printed_at timestamptz,             -- set once someone has actually printed this card
  created_at timestamptz not null default now(),
  unique (child_id, copy_number)
);

create index cards_child_id_idx on cards (child_id);
```

`total_copies` is a small, deliberate denormalization: it's copied from `children.target_card_count`
when cards are generated so the UI can show "1 of 2" without a join back to `children` every time. If
staff raise `target_card_count` after the fact, generating the new card row(s) also updates
`total_copies` on the existing sibling rows — that reconciliation is app logic, not something enforced
by the schema itself.

The "recommend for printing" report is just a query, not a stored recommendation:

```sql
create view cards_needing_print as
select
  ch.id as child_id,
  ch.first_name,
  ch.target_card_count,
  count(crd.id) as cards_generated,
  count(crd.id) filter (where crd.printed_at is null) as cards_not_yet_printed
from children ch
left join cards crd on crd.child_id = ch.id
group by ch.id, ch.first_name, ch.target_card_count
having count(crd.id) < ch.target_card_count            -- fewer cards exist than the target
    or count(crd.id) filter (where crd.printed_at is null) > 0;  -- or some exist but aren't printed yet
```

And the full printable label, combining the base card number with the copy count:

```sql
create view printable_cards as
select
  crd.id as card_id,
  ccn.card_number || ' (' || crd.copy_number || '/' || crd.total_copies || ')' as display_label,
  ch.first_name,
  ch.grade,
  crd.printed_at,
  f.drive_id
from cards crd
join children ch on ch.id = crd.child_id
join families f on f.id = ch.family_id
join child_card_numbers ccn on ccn.child_id = ch.id;
```

## 8. `wishlist_items` — was 3 fixed columns, opened up

```sql
create table wishlist_items (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children(id) on delete cascade,
  position int not null,
  description text not null,
  unique (child_id, position)
);
```

Wishlist items stay attached to the **child**, not to an individual card — for now, every copy of a
child's card shows the same full wishlist. **Known gap, committed for Phase 2 (see [DESIGN.md §7](DESIGN.md#7-phased-scope)):**
this means two sponsors could unknowingly buy the same item for a multi-card child. The fix is to let a
card optionally pin to specific `wishlist_items` (e.g. an `assigned_card_id` column on `wishlist_items`,
nullable for "any card can cover this"), so each copy can show only its share of the list. Not solved now
because it's not needed until a child actually has multiple cards in practice — but it should not be
forgotten once that starts happening.

## 9. `sponsors`

```sql
create table sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now()
);
```

No login/account for sponsors in Phase 1 — this row is just created at claim time. Later, if we build
sponsor accounts (Phase 2), this table is what an account would attach to.

## 10. `assignments` — a sponsor claiming a card

```sql
create table assignments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  sponsor_id uuid not null references sponsors(id),
  status assignment_status not null default 'pledged',
  claimed_at timestamptz not null default now(),
  purchased_at timestamptz,
  received_at_church_at timestamptz,
  delivered_at timestamptz,
  notes text
);

-- a card can have historical/cancelled assignments, but only one *active* one at a time
create unique index one_active_assignment_per_card
  on assignments (card_id)
  where status <> 'cancelled';

create index assignments_sponsor_id_idx on assignments (sponsor_id);
create index assignments_status_idx on assignments (status);
```

Attaching to `card_id` rather than `child_id` is what makes multi-sponsor children work: a child with
two cards can have two different active assignments (one per card), while each individual card is still
only claimable by one sponsor at a time. The `cancelled` status matters in practice too: a sponsor backs
out, their card needs to go back on the public claim page, and the old spreadsheet's single
`Received`/`Delivered` checkboxes had no way to represent that. `assignments_status_idx` is what powers a
"which sponsors are overdue" report.

## 11. `audit_log` — who changed what

```sql
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null,                       -- 'insert' | 'update' | 'delete'
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now(),
  diff jsonb
);
```

Populated by Postgres triggers on the tables above rather than app code, so no code path can
accidentally skip logging. We'll write the actual trigger function when we scaffold the project.

## How this maps to the 2021 spreadsheet

| Old spreadsheet | New schema |
|---|---|
| School tab name | `schools.name` |
| `School Letter` | `drive_schools.code` |
| `Family Number` | `families.family_number` |
| Card Number (`C1.3`) | derived via `child_card_numbers` view, not stored |
| *(no equivalent — new)* | `cards` — printable copies per child, so gifts can split across sponsors |
| `First Name`, `Grade`, `Age`, `Sex` | `children` columns |
| `Wish List #1-3` | `wishlist_items` rows |
| `Specific Needs`, `Pant/Shirt/Shoe Size`, `Other Notes` | `children` columns |
| `Name` / `Phone Number` / `Email` (sponsor) | `sponsors` columns |
| `Recieved` / `Delivered` checkboxes | `assignments.status` (with two more stages: pledged, purchased) |
| "Confidential" tab | `families.is_confidential = true`, `drive_school_id = null` |
| `Color` | `families.sort_tag` (purpose unconfirmed — see below) |

The old sheet assumed one card per child; that assumption is the one thing in this schema that isn't a
straight port, since it wouldn't support your printing workflow.

## Public (sponsor-facing) access — concept

Sponsors never get a login, and the app must not simply expose the underlying tables to them. The plan
is a locked-down public view, listing individual **cards** (not children — a child with two cards should
appear as two separate claimable listings), plus a controlled claim action rather than raw table access:

```sql
create view public_available_cards as
select
  crd.id as card_id,
  ccn.card_number as card_number,   -- base identifier only, e.g. "L1.1" — no copy count
  ch.first_name,
  ch.grade,
  ch.pant_size, ch.shirt_size, ch.shoe_size,
  ch.specific_needs,
  wi.description as wishlist_description
from cards crd
join children ch on ch.id = crd.child_id
join families f on f.id = ch.family_id and not f.is_confidential
join child_card_numbers ccn on ccn.child_id = ch.id
left join wishlist_items wi on wi.child_id = ch.id
where not exists (
  select 1 from assignments a where a.card_id = crd.id and a.status <> 'cancelled'
);
```

**Correction:** the copy count (`crd.copy_number`/`crd.total_copies`, the "1 of 2" notation) is
deliberately left out of this view. It's print-room information — it tells staff which physical card to
grab off the printer — and sponsors have no use for it and shouldn't see it; showing it here read as
confusing/unnecessary rather than helpful. `printable_cards` (above) is the *only* place that notation
should appear, since that view exists specifically to drive the print run.

Notably absent: `families.*` contact info, `drive_schools.liaison_*`, `children.other_notes`, and anything
from a confidential family. Claiming a card should go through a `security definer` Postgres function
(e.g. `claim_card(card_id, sponsor_name, sponsor_phone, sponsor_email)`) instead of a raw insert policy,
so we can enforce "not already claimed" and basic validation in one controlled place rather than relying
on RLS alone to prevent race conditions or abuse.

## Row Level Security — who sees what

| Table | Anonymous (public) | Volunteer | Admin / confidential-cleared |
|---|---|---|---|
| `drives`, `schools`, `drive_schools` | no direct access | read | read/write |
| `families`, `children`, `cards` (non-confidential) | no direct access (only via `public_available_cards`) | read/write | read/write |
| `families`, `children`, `cards` (confidential) | no access | **no access** | read/write |
| `sponsors`, `assignments` | write only via claim function | read/write | read/write |
| `profiles` | no access | own row only | read/write |
| `audit_log` | no access | no access | read |

This is enforced with Postgres Row Level Security policies (not just app-code checks), so a bug in the
frontend can't leak a confidential family or someone's home info. A `cards` row inherits its
confidentiality from its child's family (via a join), rather than carrying its own flag — one source of
truth for "is this confidential," not two that could disagree.

## Open schema questions

- Who decides `target_card_count` and when — is it obvious at intake time (e.g. "this family always gets
  2 cards per teenager"), or something staff adjust later as wishlists come in?
- What is `sort_tag` (the old `Color` field) actually for? If it's a wrapping-paper/bin color used for
  physical sorting at distribution, a free-text column is enough. If it means something else, this may
  need to change shape.
- Should claiming a card on the public page require confirming an email (e.g. a confirmation link) before
  it counts as `pledged`, to cut down on accidental or prank claims? Doesn't block Phase 1 but affects the
  claim function above.
- Is one `scheduled_pickup_at` per family enough, or do we need multiple distinct distribution events
  (e.g. different pickup days per school)? If the latter, we'll want a `distribution_events` table rather
  than a single timestamp on `families`. Low cost to add later if it turns out to be needed.
- Does a referral ever split siblings across two different `drive_school_id`s? Current design assumes one
  family belongs to exactly one school (or is fully confidential) — if a family can be genuinely split,
  the model needs a rethink.
