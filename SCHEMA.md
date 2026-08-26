# Database Schema (draft v1)

*Status: DRAFT — nothing has been run against a real database yet, so this costs nothing to change.
Once we scaffold Supabase and real data exists, changes become "migrations" (normal, incremental,
still very doable) rather than free edits. See [DESIGN.md](DESIGN.md) for the higher-level brainstorm
this is built from.*

Written for Postgres on Supabase (per [DESIGN.md §6](DESIGN.md#6-tech-stack--recommendation)).

## Conventions

- Every table has a `uuid` primary key (`gen_random_uuid()`), matching Supabase norms.
- `created_at` / `updated_at` are `timestamptz`, defaulting to `now()`.
- `families.updated_at` and `children.updated_at` (maintained by the `set_updated_at` BEFORE UPDATE
  triggers) double as **row versions**: the family edit form in the app reads them, sends them back, and
  its UPDATEs carry `.eq("updated_at", <value loaded>)` so a second person's save can't silently
  overwrite the first's (US-13 / GitLab issue #2). Don't drop those triggers, don't add a precision
  modifier to the columns (`timestamptz(3)` would round microseconds away and break the match), and
  don't let app code reformat the value — it has to round-trip byte-for-byte.
  **Gap to know about:** editing `wishlist_items` does *not* bump the parent `children.updated_at`, so
  wishlist rows are not covered by that check. It's safe today only because every UI path that edits a
  wishlist also writes the child row through the same `saveFamilyEdit()` call. If you ever build a
  wishlist-only editor, it needs its own conflict story first.
- Enums are used for small fixed sets of statuses; free text is used wherever the old spreadsheet
  showed messy real-world values (e.g. sizes like `"32-34"` or `"Girls 6"`) that don't fit a clean type.
- `profiles` is the staff/volunteer accounts table — named to match Supabase's common convention of
  pairing a `profiles` table with its built-in `auth.users`.
- A **child** is a person; a **card** is a printable, claimable gift-slot for that child. Every child has
  exactly **one** card, always — a `unique (child_id)` constraint on `cards` enforces this, not just app
  convention. (Prior to [supabase/migrations/20260818140000_one_card_per_child.sql](supabase/migrations/20260818140000_one_card_per_child.sql),
  a child could have several cards to split gifts across multiple sponsors; answered and removed per
  [OPEN_QUESTIONS.md ADM-2](docs/OPEN_QUESTIONS.md) — "there is no longer a need to have more than one
  family sign up for one card. There will only ever be one sponsor per child." `cards` and `children`
  remain separate tables anyway, since a card is still a distinct claimable/printable thing with its own
  lifecycle (`printed_at`) from the child it belongs to.)

```sql
create extension if not exists pgcrypto;

create type drive_status as enum ('draft', 'open', 'closed', 'archived');
create type distribution_method as enum ('school_dropoff', 'church_pickup');
create type assignment_status as enum ('pledged', 'purchased', 'received_at_church', 'verified', 'delivered', 'cancelled');
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
  email text,                                 -- synced copy, see below
  role app_role not null default 'volunteer',
  can_view_confidential boolean not null default false,
  created_at timestamptz not null default now()
);
```

## 3. `schools` — reusable year over year

Kept separate from any one drive, since a school might participate in multiple years and its identity
(name) shouldn't be re-entered each time. Answers the open question "is the school list fixed year to
year" by not forcing an answer — schools can be added anytime, and each drive picks who's in via `drive_schools`.

The liaison contact (`liaison_name`/`liaison_phone`/`liaison_email`) lives here too, not on
`drive_schools` — see the "Open question... resolved" note below §4 for why.

```sql
create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,                     -- e.g. "Clear Creek High School"
  notes text,
  liaison_name text,                      -- school contact/counselor for referrals — see below
  liaison_phone text,
  liaison_email text,
  created_at timestamptz not null default now()
);
```

## 4. `drive_schools` — a school's participation in one specific drive

This is where the single-letter card code (`C`, `T`, etc.) and that year's distribution method live —
because either could change year to year even if the school itself doesn't. The referral liaison contact
does **not** live here (moved to `schools` in
[supabase/migrations/20260818150000_school_liaison_on_schools.sql](supabase/migrations/20260818150000_school_liaison_on_schools.sql)
— see the resolved open question just below).

```sql
create table drive_schools (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  school_id uuid not null references schools(id),
  code text not null,                                -- e.g. 'C' — used in that year's card numbers
  distribution_method distribution_method,           -- overrides drives.default_distribution_method
  unique (drive_id, school_id),
  unique (drive_id, code)
);
```

**Open question carried over from [DESIGN.md §8](DESIGN.md#8-open-questions), now resolved** (ADM-3,
2026-08-18): is `liaison_*` actually tracked anywhere, or does that relationship happen informally? A real
liaison workflow is confirmed wanted — schools are the church's sole go-between for confidential/
direct-referral-less families, since `families` itself carries no phone/email of its own (see DB-19). And
per Grant's answer, "the school liaison should be inherited from a school" — i.e. it's a property of the
school, not something re-typed every year that school participates, which is why the columns above moved
from `drive_schools` to `schools`. Note this is a pure data-model relocation for now: `web/lib/store.tsx`'s
`addSchool` still always creates a brand-new `schools` row alongside the `drive_schools` row every time —
there's no "add an existing school (with its already-known liaison) to this drive" picker yet. That picker,
if built, is what will actually make "inherited" visible day to day; it's out of scope here (ADM-4
territory).

## 5. `families` — the referral unit (may be confidential, may have no school)

```sql
create table families (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid not null references drives(id) on delete cascade,
  drive_school_id uuid references drive_schools(id),   -- null if confidential / direct referral
  family_number int not null,
  is_confidential boolean not null default false,
  is_test_data boolean not null default false, -- test-infrastructure only, see below — never a UI field
  is_autotest_data boolean not null default false, -- narrower than is_test_data, see below — never a UI field
  internal_notes text,
  distribution_method_override distribution_method,    -- rare case: differs from the school's default
  scheduled_pickup_at timestamptz,
  checked_in_at timestamptz,
  checked_in_by uuid references profiles(id),
  created_by uuid references profiles(id),    -- who submitted this referral, see confidential-access note below
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- family_number is scoped per school, except confidential families which are
-- scoped per drive instead. The coalesce collapses "no school" (direct
-- referral) down to a fixed sentinel so two direct-referral families can't
-- silently share a number — a plain (drive_id, drive_school_id, family_number)
-- index wouldn't catch that, since Postgres unique indexes treat NULL as
-- distinct from NULL.
create unique index families_number_per_school
  on families (drive_id, coalesce(drive_school_id, '00000000-0000-0000-0000-000000000000'::uuid), family_number)
  where not is_confidential;

create unique index families_number_confidential
  on families (drive_id, family_number)
  where is_confidential;

create index families_drive_id_idx on families (drive_id);
```

**`family_number` is assigned by the database, never chosen by whoever's filling out the intake form.**
Early versions let a volunteer see a "suggested next number" and override it — but multiple volunteers can
be entering families at the same time on different iPads/browsers, and that's a real race: two people could
see the same suggestion and both submit, with one getting a raw unique-violation error instead of a saved
family. The number still exists and still matters (it's what goes on a printed tag, and it's how staff refer
to a family verbally) — it's just never client-supplied. See `create_family()` below.

```sql
create or replace function public.create_family(
  p_drive_id uuid,
  p_drive_school_id uuid,
  p_is_confidential boolean,
  p_is_test_data boolean default false,
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
  -- Held for the rest of this transaction (this one RPC call) — a concurrent
  -- call for the same scope blocks here until this one commits, so two calls
  -- can never compute the same "next" number.
  perform pg_advisory_xact_lock(v_lock_key);

  if p_is_confidential then
    v_next_number := public.next_confidential_family_number(p_drive_id);
  else
    select coalesce(max(family_number), 0) + 1 into v_next_number
    from families
    where drive_id = p_drive_id
      and drive_school_id is not distinct from p_drive_school_id
      and not is_confidential;
  end if;

  insert into families (drive_id, drive_school_id, family_number, is_confidential, is_test_data, is_autotest_data, internal_notes, created_by)
  values (p_drive_id, p_drive_school_id, v_next_number, p_is_confidential, p_is_test_data, p_is_test_data, p_internal_notes, auth.uid())
  returning * into v_family;

  return v_family;
end;
$$;
```

**`p_is_test_data`/`is_test_data`/`is_autotest_data`** (added in
[supabase/migrations/20260818130000_replace_sort_tag_with_is_test_data.sql](supabase/migrations/20260818130000_replace_sort_tag_with_is_test_data.sql),
replacing the old `p_sort_tag`/`sort_tag`): two-tier marker, split this way
after reach-reviewer caught a collision in the first draft. `is_test_data` is
the broad "not real production data" flag — set by `create_family()` whenever
`p_is_test_data` is true, and set directly by the dev-only
`demo_seed.sql`/`demo_seed_bulk.sql` scripts too. `is_autotest_data` is
narrower: `create_family()` sets it to the same value as `p_is_test_data`, but
since the demo-seed scripts insert directly and never set it, it's `true` only
on rows the e2e suite created. That's the one
[web/tests/e2e/helpers/cleanup.ts](web/tests/e2e/helpers/cleanup.ts) deletes
on after each run — keying cleanup off the narrower flag is what lets a demo
you just seeded for a walkthrough survive an e2e run against the same dev
database. **Neither is a user-facing field** — deliberately absent from both
the intake form and the family-edit form, unlike `sort_tag` before it,
specifically so a real volunteer's data entry can never collide with the
test-cleanup marker. Note the confidential branch above also no longer inlines
its own `select max(...)`
— see "The same root cause also reached `create_family()`'s confidential-
numbering read" below for why it's routed through
`next_confidential_family_number()` instead; this doc block reflects the
function as it stands after both fixes, not as originally written.

Why an advisory lock rather than just "select max, add one, insert" as two separate statements from the
client: that's exactly the race described above — nothing stops two concurrent calls from both reading the
same `max` before either has inserted. Doing the read, compute, and insert inside one function call, guarded
by a lock scoped to (drive, school-or-confidential-pool), means a second concurrent call for the *same*
scope simply waits its turn instead of racing; a call for a *different* school isn't blocked at all. This
function is `security invoker`, not `security definer` — unlike `claim_card` (which exists specifically so
an anonymous sponsor can act despite having zero table access), any authenticated staff member already has
full insert rights on `families` directly, so there's nothing to bypass and no reason to run with elevated
privileges.

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, child_index)
);

create index children_family_id_idx on children (family_id);
```

**`target_card_count` — removed** in
[supabase/migrations/20260818140000_one_card_per_child.sql](supabase/migrations/20260818140000_one_card_per_child.sql)
(ADM-2, 2026-08-18). It used to be the input side of a "recommend cards for printing" workflow where staff
bumped it up (e.g. to 2) to split a child's wishlist across two sponsors. Answered directly: "there is no
longer a need to have more than one family sign up for one card. There will only ever be one sponsor per
child." Do not re-add a column like this without re-opening that decision — see §7 below for the
replacement "one card, always" model.

A card's base identifier (`C1.3`) is never stored — it's derived (school code + family number + child
index), so it can't drift out of sync if a school's code ever changes. A view for that base identifier:

```sql
create view child_card_numbers
  with (security_invoker = true) as
select
  c.id as child_id,
  coalesce(ds.code, 'Z') || f.family_number || '.' || c.child_index as card_number,
  f.id as family_id,
  f.drive_id
from children c
join families f on f.id = c.family_id
left join drive_schools ds on ds.id = f.drive_school_id;
```

`security_invoker = true` matters here: this view respects the *querying* user's own RLS, same as
every other staff-facing view (see §9's RLS table). It is deliberately **not** used by
`public_available_cards` (§9) — that anon-facing view inlines this same expression directly instead of
joining this view, precisely because a `security_invoker` view's own base-table reads run as the
*calling* role, and `anon` has no policies on `children`/`families`/`drive_schools` at all. Joining this
view from an anon-facing one silently collapses to zero rows (this was US-17); do not reintroduce that
dependency.

## 7. `cards` — the physical, claimable gift-slot for a child

**One card per child, always** — enforced by `unique (child_id)` below, not just app convention. Answered
(ADM-2, 2026-08-18): "there is no longer a need to have more than one family sign up for one card. There
will only ever be one sponsor per child." **Claiming/assignments attach to a card, not directly to a
child** (see §9) — that indirection stays even with a 1:1 relationship, since a card is still a distinct
claimable/printable thing with its own lifecycle (`printed_at`) from the child it belongs to.

*Prior to [supabase/migrations/20260818140000_one_card_per_child.sql](supabase/migrations/20260818140000_one_card_per_child.sql),
a child could have several card **copies** — e.g. "Emma C1.3 (1 of 2)" and "Emma C1.3 (2 of 2)" — to split
gifts across multiple sponsors, tracked via `copy_number`/`total_copies` and a `children.target_card_count`
input. All of that is gone now; don't re-add it without re-opening ADM-2.*

```sql
create table cards (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children(id) on delete cascade,
  printed_at timestamptz,             -- set once someone has actually printed this card
  created_at timestamptz not null default now(),
  unique (child_id)
);
```

The "recommend for printing" report is just a query, not a stored recommendation — now simply "which
children's one card isn't printed yet," with no generated-vs-target comparison to make:

```sql
create view cards_needing_print
  with (security_invoker = true) as
select
  ch.id as child_id,
  ch.first_name,
  crd.id as card_id
from children ch
join cards crd on crd.child_id = ch.id
where crd.printed_at is null;
```

And the printable label — just the base card number now; the "(1/2)" copy-count suffix this view used to
add is gone along with `copy_number`/`total_copies`:

```sql
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

Wishlist items stay attached to the **child**, not to an individual card — with exactly one card per
child (§7), that's simply the correct model, not a simplification. *Moot as of ADM-2 (2026-08-18): this
section used to flag a Phase-2 gap where two sponsors could unknowingly buy the same item for a
multi-card child, with a proposed fix of letting a card pin to specific `wishlist_items`. There is no
longer any such thing as a multi-card child, so that gap and its proposed fix no longer apply — not
re-solved, just no longer a real scenario.*

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
  verified_at timestamptz,
  delivered_at timestamptz,
  notes text,             -- unused/legacy, predates volunteer_notes below
  volunteer_notes text
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

**`verified` stage (added post-launch, see docs/backlog.md US-19):** sits between `received_at_church`
and `delivered`. The admin team checks a gift against the child's wishlist and shops for anything a
volunteer missed before it goes out — that's a genuinely sequential step, so it's a real
`assignment_status` value (with its own `verified_at`, same shape as `purchased_at` etc.) rather than a
side flag. There's no dedicated `verified_by` column; `audit_log.changed_by` on that status-change row
already answers "who," matching every other stage transition. `volunteer_notes` is a free-text note a
volunteer can leave once a card reaches `received_at_church` — e.g. what's missing from the wishlist —
that feeds a consolidated "shopping list" admin view (every `received_at_church` assignment with a
non-empty note) until it's advanced to `verified`. Notes are never offered before `received_at_church`
(nothing to check against the wishlist yet) and are structurally unreachable by sponsors: the anon-facing
`public_available_cards` view (below) excludes any card with an active assignment at all, and the claim
flow never reads assignment data back.

## `card_claim_verifications` — pending email verification for a claim

Added in [supabase/migrations/20260818160000_email_verified_claims.sql](supabase/migrations/20260818160000_email_verified_claims.sql)
for SPN-3 (docs/OPEN_QUESTIONS.md): a sponsor must prove they control the
email address they typed in before a claim counts as `pledged`. One row per
card holds the pending, *unconfirmed* claim — the sponsor details stashed at
request time plus a hashed one-time code — so the confirm step doesn't need
to re-collect anything.

```sql
create table card_claim_verifications (
  card_id uuid primary key references cards(id) on delete cascade,
  code_hash text not null,                    -- crypt()/gen_salt('bf'), never the raw code
  session_token uuid not null default gen_random_uuid(),  -- see below
  sponsor_name text not null,
  sponsor_email text not null,
  sponsor_phone text,
  expires_at timestamptz not null,            -- ~15 minutes from request
  attempts int not null default 0,            -- locked out at 5 wrong guesses
  created_at timestamptz not null default now()
);
```

`card_id` is the primary key, not a separate `id` — there is at most one
pending verification per card by design: a new code request replaces
(`on conflict (card_id) do update`) any prior unconfirmed one for that card,
resetting `attempts` back to `0`. Nothing outside the two functions below
ever reads or writes this table directly: RLS is enabled with **zero**
policies (not even a staff-read one — this holds raw, unconfirmed sponsor
PII with no confidentiality gate of its own), and table-level grants to
`anon`/`authenticated` are explicitly revoked rather than just omitted, per
the hardening [OPEN_QUESTIONS.md DB-2](docs/OPEN_QUESTIONS.md) flagged as
optional for the base tables — applied here proactively since this table has
no other protection layer. The same DB-2-precedent revoke is also applied to
pg_net's own internal tables (`revoke all on all tables in schema net from
anon, authenticated;`) — `net.http_post` (below) persists every submitted
request, including the Resend API key and each sponsor's plaintext code, in
those tables, and DB-2 already found Supabase auto-grants `anon`/
`authenticated` SELECT on new tables regardless of a migration's own grants.

**`session_token`** exists because `card_id` alone is public (it's on the
`/sponsor` page): without it, a second `request_claim_code()` call for the
same card — anyone's, including the original sponsor's own resend from a
second tab — would silently overwrite the pending row (the upsert above) and
orphan whoever was already holding a valid, correct code, who'd then get a
confusing "wrong code" error instead of a clear explanation. Each
`request_claim_code()` call returns a fresh token; `claim_card_with_code()`
requires it back and treats a mismatch as its own distinct, non-attempt-
counting error. A fresh request always wins — see below.

```sql
create or replace function public.request_claim_code(
  p_card_id uuid,
  p_sponsor_name text,
  p_sponsor_email text,
  p_sponsor_phone text default null
)
returns uuid  -- the new row's session_token
language plpgsql
security definer
set search_path = public
as $$ ... $$;

grant execute on function public.request_claim_code(uuid, text, text, text) to anon, authenticated;
```

Re-runs `claim_card`'s original pre-checks (card not already claimed, family
not confidential, name required) so a sponsor can't get a code sent for an
invalid claim attempt, plus a new one: email is *required* here (unlike
`claim_card`'s optional email param — see the note under §9/DESIGN.md), since
there's nothing to verify control of without one. Generates a random 6-digit
code, hashes it, upserts the pending row (with a freshly generated
`session_token`, returned to the caller), and sends the email via
[pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
(`net.http_post` to `https://api.resend.com/emails`, `Authorization: Bearer
<key>`, `from: onboarding@resend.dev` — a placeholder sender, swap once a
real domain is verified in Resend). The API key is pulled from
[Supabase Vault](https://supabase.com/docs/guides/database/vault)
(`vault.decrypted_secrets`, secret named `resend_api_key`), never hardcoded
or passed from the client. `pg_net.http_post` is fire-and-forget by design —
it queues the request and returns immediately, not the HTTP response — so if
Resend delivery fails, the sponsor just doesn't get an email and can retry;
nothing here waits on or checks the outcome. A repeat request for the same
card within 60 seconds of the last one raises a friendly error rather than
silently no-opping or sending a second email — a basic abuse guard against
hammering the send button. The Vault-secret check runs *before* the
upsert — an earlier draft checked it after, so a missing key rolled the
insert back anyway (a `raise exception` aborts the whole function call,
undoing any write earlier in that same call); checking first avoids writing
a row at all when there's nothing to send it with.

```sql
create or replace function public.claim_card_with_code(
  p_card_id uuid,
  p_code text,
  p_session_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$ ... $$;

grant execute on function public.claim_card_with_code(uuid, text, uuid) to anon, authenticated;
```

The confirm step, and now the *only* way a sponsor pledge actually gets
created. Looks up the pending row for `p_card_id`, checks it exists, checks
`p_session_token` matches the row's current `session_token`, hasn't expired,
and the hashed code matches (`crypt(p_code, code_hash) = code_hash`) before
the attempt cap (5) is reached.

**`p_session_token` must match the row's `session_token`.** If it doesn't
(including `p_session_token is null`), that means a newer `request_claim_code()`
call for this same card issued a different token — the pending verification
this token was for is no longer the active one, regardless of whether
`p_code` itself is correct. This returns its own distinct `{"ok": false,
"error": "This code request is no longer active..."}` message and does
**not** increment `attempts` — a stale session isn't a wrong-code guess, and
counting it against the cap would burn a sponsor's attempt for something
that was never actually wrong on their end.

**Returns `jsonb`, not a bare `uuid`** — `{"ok": true, "sponsor_id": "..."}`
on success, `{"ok": false, "error": "..."}` on any of four *expected,
retryable* failure modes: no pending verification, expired code, attempt cap
reached, or wrong code. Those four `return` a value rather than `raise`,
because a `raise exception` aborts the entire calling transaction —
including any write earlier in that same function call. The wrong-code path
specifically needs its `attempts = attempts + 1` write to survive: an
earlier draft of this function raised there instead, which silently
discarded every attempt-count increment (the row's `attempts` stayed `0`
forever) and meant the 5-attempt cap never actually engaged — a full
brute-force bypass of every possible 6-digit code within a code's 15-minute
window, caught in review before this shipped. A second bug fixed in the same
pass: the wrong-code comparison had no guard against `p_code` being SQL
`NULL` — `crypt(NULL, code_hash)` evaluates to `NULL`, `code_hash <> NULL` is
`NULL`, and `if NULL then` is false in PL/pgSQL, so a `NULL` code fell
straight through the mismatch check to the success path unverified. Fixed
with an explicit `p_code is null or btrim(p_code) = ''` guard at the top of
the function, before anything else runs.

The remaining failure modes — already-claimed (the real guarantee is still
the `one_active_assignment_per_card` unique index; this is just for a
friendlier message), confidential-card, and the `unique_violation` catch
around the `assignments` insert — still `raise`, matching what `claim_card`
always did: these are genuine race conditions with no attempt-counter or
other bookkeeping that needs to outlive a rollback, so raising (and letting
the earlier `sponsors` insert roll back with it, avoiding an orphaned
sponsor row for a claim that didn't actually succeed) is correct there. On
a verified code with no race lost, it does exactly what `claim_card` used to
do in one step — insert `sponsors` from the stashed name/email/phone, insert
`assignments` with `status = 'pledged'` — then deletes the verification row
and returns `{"ok": true, "sponsor_id": <the new sponsor's id>}`.

**`claim_card` itself is no longer callable by `anon`/`authenticated`** —
`revoke execute on function public.claim_card(uuid, text, text, text) from
anon, authenticated;` in the same migration. Leaving that grant in place
would let anyone skip verification entirely by calling the old one-shot
function directly, defeating the point of this feature. The function is left
defined (harmless, unreachable) rather than dropped, since
`20260708120000_init.sql` is an already-applied migration this project never
edits in place.

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
| *(no equivalent — new)* | `cards` — the printable, claimable slot for each child (one per child, always — see §7) |
| `First Name`, `Grade`, `Age`, `Sex` | `children` columns |
| `Wish List #1-3` | `wishlist_items` rows |
| `Specific Needs`, `Pant/Shirt/Shoe Size`, `Other Notes` | `children` columns |
| `Name` / `Phone Number` / `Email` (sponsor) | `sponsors` columns |
| `Recieved` / `Delivered` checkboxes | `assignments.status` (with three more stages: pledged, purchased, verified) |
| *(no equivalent — new)* | `assignments.volunteer_notes` — what a volunteer flags as missing at church intake, feeding the shopping-list view |
| "Confidential" tab | `families.is_confidential = true`, `drive_school_id = null` |
| `Color` | *(retired — see [OPEN_QUESTIONS.md ADM-1](docs/OPEN_QUESTIONS.md); was `families.sort_tag`, dropped in [20260818130000_replace_sort_tag_with_is_test_data.sql](supabase/migrations/20260818130000_replace_sort_tag_with_is_test_data.sql))* |

The old sheet assumed one card per child. This schema briefly diverged from that (a child could have
multiple card *copies* to split gifts across sponsors), but ADM-2 (2026-08-18) confirmed the old
assumption was right after all — "there will only ever be one sponsor per child" — so `cards` is back to
a straight one-per-child port; see §7 above.

## Public (sponsor-facing) access — concept

Sponsors never get a login, and the app must not simply expose the underlying tables to them. The plan
is a locked-down public view, listing individual **cards** (not children — a child with two cards should
appear as two separate claimable listings), plus a controlled claim action rather than raw table access:

```sql
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
join children ch on ch.id = crd.child_id
join families f on f.id = ch.family_id and not f.is_confidential
join drives d on d.id = f.drive_id and d.status = 'open'
left join drive_schools ds on ds.id = f.drive_school_id
left join wishlist_items wi on wi.child_id = ch.id
where not exists (
  select 1 from assignments a where a.card_id = crd.id and a.status <> 'cancelled'
);
```

**Correction:** the copy count (`crd.copy_number`/`crd.total_copies`, the "1 of 2" notation) was
deliberately left out of this view. It was print-room information — it told staff which physical card to
grab off the printer — and sponsors had no use for it and shouldn't see it; showing it here read as
confusing/unnecessary rather than helpful. `printable_cards` (above) was the *only* place that notation
appeared, since that view existed specifically to drive the print run. **Now moot rather than just
correct:** `copy_number`/`total_copies` were dropped from `cards` entirely in
[supabase/migrations/20260818140000_one_card_per_child.sql](supabase/migrations/20260818140000_one_card_per_child.sql)
(ADM-2) — every child has exactly one card, so there's no copy count left to leave out of anything.

**Second correction (US-19 / docs/backlog.md, fixed in
[supabase/migrations/20260818120000_fix_public_available_cards_anon_bug.sql](supabase/migrations/20260818120000_fix_public_available_cards_anon_bug.sql)):**
the version above originally joined `child_card_numbers` for the card-number
expression instead of inlining it. That view is `security_invoker = true`
(see §6 above), and Postgres applies a view's own `security_invoker` setting
only to *that view's* base-table reads — not to whatever called it — so for a
genuinely anonymous caller, `child_card_numbers`' internal
`children`/`families`/`drive_schools` reads ran as `anon`, which has no RLS
policies on those tables, and the join silently collapsed to zero rows.
`public_available_cards` itself was (correctly) never `security_invoker`, so
this was invisible when tested from an authenticated staff session — only a
real anonymous caller hit it. Fixed by inlining the identical expression
(`coalesce(ds.code,'Z') || f.family_number || '.' || ch.child_index`) via a
direct `left join drive_schools`, so no `security_invoker` view remains
anywhere in this view's dependency chain. The same migration also adds the
`join drives ... and d.status = 'open'` filter (OPEN_QUESTIONS.md SPN-1) —
before this, the view had no drive-status filter at all, so every
draft/closed/archived drive's children were one bug-fix away from becoming
publicly listed and claimable. **Never** route `child_card_numbers` back out
of `security_invoker` to work around this — `authenticated` holds a direct
grant on it, so that would let any logged-in volunteer read card numbers and
family ids for confidential families they have no clearance for (US-16's leak
reopened one join further out). See docs/backlog.md US-17 for the full
root-cause writeup and guardrails.

Notably absent: `families.*` contact info, `schools.liaison_*`, `children.other_notes`, and anything
from a confidential family. Claiming a card goes through `security definer` Postgres functions instead of
a raw insert policy, so "not already claimed" and basic validation live in one controlled place rather
than relying on RLS alone to prevent race conditions or abuse.

**Claiming is now two steps, not one (SPN-3, 2026-08-18).** The original single `claim_card(card_id,
sponsor_name, sponsor_phone, sponsor_email)` function still exists but is no longer callable by
`anon`/`authenticated` — see the `card_claim_verifications` section above. A sponsor now calls
`request_claim_code()` (sends a 6-digit code to the email they typed in) and then `claim_card_with_code()`
(confirms the code and only then does what `claim_card` used to do in one shot: insert `sponsors`, insert
`assignments` with `status = 'pledged'`).

## Row Level Security — who sees what

| Table | Anonymous (public) | Volunteer | Admin / confidential-cleared |
|---|---|---|---|
| `drives`, `schools`, `drive_schools` | no direct access | read | read/write |
| `families`, `children`, `cards` (non-confidential) | no direct access (only via `public_available_cards`) | read/write | read/write |
| `families`, `children`, `cards` (confidential) | no access | **create only** (see below); read/edit own submission | read/write |
| `sponsors`, `assignments` | write only via `claim_card_with_code()` (see `card_claim_verifications` above) | read/write | read/write |
| `card_claim_verifications` | no access at all (not even the two functions' own callers — everything routes through `security definer`) | no access at all | no access at all |
| `profiles` | no access | own row only | read/write |
| `audit_log` | no access | no access | read |

This is enforced with Postgres Row Level Security policies (not just app-code checks), so a bug in the
frontend can't leak a confidential family or someone's home info. A `cards` row inherits its
confidentiality from its child's family (via a join), rather than carrying its own flag — one source of
truth for "is this confidential," not two that could disagree.

**`profiles.email` is a synced copy, not a live source.** `auth.users` (where the real email lives) has no
grant at all for the client API — not even for admins — so without a copy here, the staff management page
would have no way to identify accounts beyond `full_name`. Populated once at signup by `handle_new_user()`
and backfilled for existing rows in the migration that added it; if someone changes their email through
Supabase Auth later, this copy goes stale until manually refreshed. Acceptable for a handful of staff
accounts — not worth a sync trigger on `auth.users` for this scale.

**A trigger, not just RLS, protects `role` and `can_view_confidential`.** The "own row" update policy above
is necessarily row-level (Postgres RLS has no column-level equivalent) — it can't tell "editing your own
`full_name`" apart from "editing your own `role`." Left alone, that policy would let any volunteer promote
themselves to admin with a direct table update. `prevent_role_self_escalation()` (a `before update` trigger
on `profiles`) closes that: a non-admin can still update their own row, just not those two columns, no
matter what path the request takes to the database. Scoped to `auth.uid() is not null` (fixed in
[supabase/migrations/20260808130000_fix_role_escalation_guard_null_auth.sql](supabase/migrations/20260808130000_fix_role_escalation_guard_null_auth.sql))
so it doesn't also block service-role/system contexts — e.g. the demo/reset scripts — which already bypass
RLS entirely and are trusted.

**Any staff member can *create* a confidential referral; only cleared staff can keep seeing it.** The
original design gated INSERT the same way as SELECT — requiring `can_view_confidential()` just to create a
confidential family/child/card/wishlist_item — which meant an ordinary volunteer flagging a sensitive case
during intake would hit a bare RLS error and couldn't submit at all. That's resolved now: insert is open to
any authenticated staff member (`with check (true)`; the row's `family_id`/`child_id` still has to be a
real, known uuid, so this isn't a meaningful new exposure). The read/update gate is unchanged for
`can_view_confidential()`/admin, and extended to also cover `families.created_by = auth.uid()` — the
volunteer who personally entered a confidential case can still see and fix their own submission, but gains
no visibility into confidential families anyone else created.

**Confidentiality checks on `children`/`cards`/`wishlist_items` must not depend on the caller's own
visibility into `families`.** The original read/update policies on those three tables gated confidentiality
with an inline `not exists (select 1 from families f where ... and f.is_confidential)` subquery. That
subquery runs as the querying user, so it's itself subject to `families`' own RLS policy — for a volunteer
without `can_view_confidential()` who didn't create the family, the confidential family's row is invisible
to them *inside that subquery too*, `not exists(...)` evaluates to true, and the child/card/wishlist item
leaks through even though the family record itself stays correctly hidden (GitLab issue #19; fixed by
[supabase/migrations/20260811120000_fix_confidential_rls_subquery_leak.sql](supabase/migrations/20260811120000_fix_confidential_rls_subquery_leak.sql)).
Fixed by resolving confidentiality/ownership through `security definer` helper functions
(`family_is_confidential(family_id)`, `family_created_by(family_id)`, `child_family_id(child_id)`) that read
`families`/`children` with the function owner's privileges — same pattern as `is_admin()`/
`can_view_confidential()` — rather than a subquery subject to the caller's own RLS. `families`' own policies
were never affected (they check `is_confidential`/`created_by` directly on the row being evaluated, no
subquery back to itself); neither were the INSERT policies on children/cards/wishlist_items, which have been
unconditional (`with check (true)`) since the confidential-referral-access change above. Any future table
that needs a confidentiality gate reached via a join back to `families` should use these helpers, not a raw
subquery.

**The same root cause also reached `create_family()`'s confidential-numbering read.** `create_family()` (§5
above) is `security invoker`, and its confidential branch —
`select coalesce(max(family_number), 0) + 1 from families where drive_id = ... and is_confidential` — is a
permission-sensitive count subject to that same caller RLS on `families`. A caller who can't see an
already-existing confidential family in a drive (not cleared, not its creator) computes a "next" number that
family already holds, and the insert fails on the `families_number_confidential` unique index instead of
succeeding with the real next number — same bug class as above, just surfacing as a confusing constraint
violation instead of a data leak. Fixed in the same migration by routing that one count through
`next_confidential_family_number(drive_id)`, a `security definer` helper; `create_family()` itself stays
`security invoker` (the insert needs no elevated privilege, only that read did) and the non-confidential
branch is untouched, since a non-confidential family is always visible under `families`' own policy
regardless of caller.

**At most one `open` drive at a time.** `create unique index one_open_drive on drives (status) where
status = 'open';` — nothing previously stopped two drives from both being `open` simultaneously (e.g.
forgetting to close last year's before opening this year's); the app would have just silently picked the
newer year. Now the database rejects it outright.

## Open schema questions

- ~~Who decides `target_card_count` and when — is it obvious at intake time (e.g. "this family always gets
  2 cards per teenager"), or something staff adjust later as wishlists come in?~~ → **Resolved**
  (OPEN_QUESTIONS.md ADM-2, 2026-08-18): "there is no longer a need to have more than one family sign up
  for one card. There will only ever be one sponsor per child." The whole `target_card_count` mechanism —
  the column, `cards.copy_number`/`total_copies`, and the app-side "raise the count" reconciliation logic —
  is removed, not just re-decided; see §7 above and
  [supabase/migrations/20260818140000_one_card_per_child.sql](supabase/migrations/20260818140000_one_card_per_child.sql).
  Don't re-add any of it without re-opening this decision.
- ~~What is `sort_tag` (the old `Color` field) actually for?~~ → **Resolved** (OPEN_QUESTIONS.md ADM-1): it
  was meant for color-coordinating/sorting gift bags at distribution and is no longer needed. Dropped from
  `families` entirely — see the `is_test_data` note under §5 above for its replacement as the e2e/demo-seed
  cleanup marker, which is the one thing it also happened to be doing.
- ~~Should claiming a card on the public page require confirming an email before it counts as
  `pledged`?~~ → **Resolved** (OPEN_QUESTIONS.md SPN-3, 2026-08-18): yes, via a 6-digit code typed back on
  the same claiming page. Implemented in
  [supabase/migrations/20260818160000_email_verified_claims.sql](supabase/migrations/20260818160000_email_verified_claims.sql)
  — see the `card_claim_verifications` section above. Not yet applied to any live database (written and
  waiting for the usual manual apply step); the sponsor-page UI to actually collect/submit the code is
  frontend-designer's follow-up, not built as part of this change.
- Is one `scheduled_pickup_at` per family enough, or do we need multiple distinct distribution events
  (e.g. different pickup days per school)? If the latter, we'll want a `distribution_events` table rather
  than a single timestamp on `families`. Low cost to add later if it turns out to be needed.
- ~~Does a referral ever split siblings across two different `drive_school_id`s?~~ → **Resolved** (see
  DESIGN.md §8): yes, in practice, and the answer is to let it split — a cross-school household becomes
  multiple `Family` records, one per school, rather than changing the model. `Family` was never meant to be
  a strict household grouping, just a distribution-day convenience.
- **PII retention — decided (for now): keep indefinitely, revisit later.** Asked directly; the answer as of
  2026-07 is not to build any automatic purge/anonymization yet. `audit_log` keeps a full jsonb copy of
  every insert/update forever (see §11), with no cascade tied to the source record, so this applies there
  too. The proposal below is still here for whenever this gets revisited, but nothing should be built
  against it until that happens: archive a drive (already supported — see the `drives` page) at season's
  end, then anonymize `children`/`families`/`sponsors` for drives archived more than N years ago (redact
  names/contact info, keep grade/counts/statuses for year-over-year reporting), and separately purge or
  redact `audit_log` rows referencing those same records.
