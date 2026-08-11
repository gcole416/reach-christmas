# AGENTS.md — Reach Christmas

Kids gift drive app: staff/volunteers do intake on families and kids, sponsors
claim kids to buy gifts for. Full background: [DESIGN.md](DESIGN.md). Full
schema: [SCHEMA.md](SCHEMA.md). This file is the fast-context version, focused
on the role model, since that's where a change is most likely to leak a
child's PII if it's made without understanding who's supposed to see what.

## Who uses it

| Role | What they do | Access |
|---|---|---|
| **Staff/Admin** | Create each year's drive, oversee all families/kids/sponsors/schools, run reports, manage volunteer accounts, resolve confidential cases | Full read/write, including confidential families |
| **Volunteers/Coordinators** | Enter/verify family & kid intake, mark gifts received, help at distribution | Full read/write on non-confidential families; confidential families only if individually granted |
| **Sponsors/Donors** | Browse available kids and claim ones to buy for | Public, unauthenticated. Sees only first name, grade, sizes, specific needs, and wishlist for *non-confidential, unclaimed* cards — never last name, school, or address |
| **School partner/counselor** | Refers families | Not an app user in Phase 1 — informal/offline channel only |

## How that maps to the code

- **`app_role` enum** (`admin` \| `volunteer`) on `profiles`, set in [supabase/migrations/20260708120000_init.sql](supabase/migrations/20260708120000_init.sql). Sponsors and school partners are not `profiles` rows at all — they never authenticate.
- **`is_admin()`** and **`can_view_confidential()`** — SQL helper functions used inside every RLS policy. A volunteer only clears `can_view_confidential()` if that flag is explicitly set on their `profiles` row; `role = 'admin'` always clears it.
- **Confidential families** (`families.is_confidential`) — the RLS-enforced floor beneath the "least privilege by role" rule in DESIGN.md §5. Any new query, view, or policy touching `families`/`children`/`wishlist_items` must keep confidential rows out of a volunteer's results unless they have `can_view_confidential`.
- **`public_available_cards`** view — the *entire* security boundary for the anon/sponsor-facing pages ([web/app/sponsor](web/app/sponsor)). It's a hand-picked column whitelist (first name, grade, sizes, needs, wishlist — no last name, no school, no confidential families, no already-claimed cards) and does **not** use `security_invoker`, unlike every staff-facing view. If a sponsor-facing feature needs a new field, add it to this view's select list deliberately — don't widen it by querying base tables directly from anon context.
- **`web/app/admin`** — staff/volunteer surface, gated by [web/app/admin/AdminGate.tsx](web/app/admin/AdminGate.tsx) + Supabase auth. `web/app/admin/login` is the only route that renders without a loaded session.

## Guardrails when changing this code

- Enforce access at the database layer (RLS/views), not just in UI conditionals — a client-side check is not a security boundary here.
- Never add a column to `public_available_cards` (or any future anon-facing view) without checking it against the "sponsors never see: last name, school, address" rule in DESIGN.md §5.
- Any new table holding family/child data needs RLS enabled and policies mirroring the existing `is_admin()`/`can_view_confidential()` pattern before it ships — not as a follow-up.
- No real family/sponsor PII in commits, fixtures, or logs. Test/demo data comes from the `reset_dev_sql` + `demo_seed` queries (see [memory.md](memory.md)), never the legacy spreadsheet.
