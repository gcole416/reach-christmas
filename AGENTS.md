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

## Two sites: prod is real, dev is the practice copy

| | Prod | Dev (practice site) |
|---|---|---|
| Site | `reach-christmas.vercel.app` (branch `main`) | `reach-christmas-git-dev-reach-christmas.vercel.app` (branch `dev`) |
| Supabase | `mpiueduyrmplrueviupl` | `thvyntrxmahygesltgft` |
| Data | The real drive | A copy of prod taken 2026-11-14, plus whatever the team has practiced since |
| Logins | Staff accounts | The same accounts and passwords as prod, as of the copy |
| Email | Off | Off: no Resend key, digest disabled, no Edge Functions |

- **Dev holds real names.** Since the 2026-11-14 copy, dev contains real households, children and counselors. Treat dev rows as PII: nothing from dev goes into commits, fixtures, logs or chat, same as prod.
- **Prod is read-only for tooling.** Never write to prod from a script or an agent. Schema changes reach prod only through the promotion steps in [docs/PROD_LAUNCH_CHECKLIST.md](docs/PROD_LAUNCH_CHECKLIST.md) and [docs/MIGRATION_LEDGER.md](docs/MIGRATION_LEDGER.md), with Grant's go-ahead each time.
- **Keep dev email off** while it holds real addresses. Do not restore the Resend key, the digest schedule or the Edge Functions on dev without Grant deciding it.
- **Telling them apart:** every site not wired to prod shows an amber "PRACTICE SITE" strip ([web/components/PracticeSiteBanner.tsx](web/components/PracticeSiteBanner.tsx)).
- **How code gets to each site:** only through GitHub (`gcole416/reach-christmas`). Push to the `dev` branch and Vercel builds the practice site from it; `main` builds prod, and only moves when Grant promotes it. Never deploy from a local machine (no `vercel deploy`, no uploading files to Vercel). If Vercel shows a deployment as "Blocked" or failed, the fix is on Vercel's side (the deployment page says why, and has Redeploy), not a different way of pushing.
- **No co-author lines on commits.** Do not end commit messages with `Co-Authored-By:` (for an AI assistant or anyone else). Vercel's Hobby plan treats a co-author as a second contributor and blocks the deployment ("commit author did not have contributing access"), as happened on 2026-11-14.
- **Prod has no Supabase backups** (free plan). Back it up with [web/scripts/backup-prod.mjs](web/scripts/backup-prod.mjs) (read-only; writes outside the repo) before any prod migration or risky step; every run is logged in [docs/BACKUP_LOG.md](docs/BACKUP_LOG.md). Check that log's last row before promoting anything to prod.
- **Refreshing dev from prod:** [web/scripts/copy-prod-to-dev.mjs](web/scripts/copy-prod-to-dev.mjs) (details in [web/README.md](web/README.md)). It replaces all dev data and logins, and can only read prod.

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
- No real family/sponsor PII in commits, fixtures, or logs. Dev now holds a copy of real data (see the table above), so this covers anything read from dev too. Fake data for fixtures comes from the `demo_seed` scripts or [docs/training/practice-sponsors.csv](docs/training/practice-sponsors.csv), never the legacy spreadsheet.
- The `reset_dev_*` and `demo_seed*` scripts and the e2e suite still run against dev, but they now wipe or mix into the practice copy. Check with Grant before running them; re-run the copy script afterwards to get back to prod's state.
