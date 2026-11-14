# Reach Christmas — gift drive app

A Next.js + Supabase app replacing the spreadsheet used to run the church's annual kids Christmas gift
drive. See [`../DESIGN.md`](../DESIGN.md) for the project brief and [`../SCHEMA.md`](../SCHEMA.md) for the
database schema and reasoning behind it.

## Stack

Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS v4, Supabase (Postgres + Auth +
Row Level Security). Every page is a client component — there's no server-side data fetching — so all
reads/writes go through the Supabase anon key in the browser, secured entirely by RLS policies (see
`../supabase/migrations/`).

## Two Supabase projects, not one

This app is wired to use a **dev/test project** and a **production project** at the same time, and picks
the right one automatically via Next.js's built-in env file precedence — no manual swapping:

| File | Project | When it's used |
|---|---|---|
| `.env.local` | production | fallback, used by `npm run build`/`npm start` |
| `.env.development.local` | dev/test | wins during `npm run dev` |

Copy `.env.local.example` to whichever of the two you're setting up and fill in that Supabase project's
Settings → API values (the `sb_publishable_*` anon key — never the `sb_secret_*`/`service_role` key, which
bypasses RLS entirely and must never be used in this app). Neither real env file is committed.

### Dev is a practice copy of prod

Since 2026-11-14 the dev project holds a copy of prod's data and logins, so the team can practice on
realistic records. That makes dev data **real PII**: handle it like prod. Dev's email is switched off
(no Resend key in Vault, digest job disabled, no Edge Functions deployed) so practice can never email a
real counselor or sponsor. Any site not wired to prod shows an amber "PRACTICE SITE" strip.

To refresh dev from prod again (replaces ALL dev data and logins; prod is only read):

```bash
node scripts/copy-prod-to-dev.mjs         # dry run: compares both, changes nothing
node scripts/copy-prod-to-dev.mjs --go    # backs up dev to ../supabase/.temp/, then copies
```

It needs a git-ignored `web/.env.copy.local` with two Supabase access tokens (dashboard → Account →
Access Tokens): `SUPABASE_ACCESS_TOKEN` (read-only; the only token ever sent to prod) and
`SUPABASE_WRITE_TOKEN` (write; only ever sent to dev). Revoke both and delete the file afterwards.
The script keeps dev's own `site_url`/`edge_functions_url`, leaves the schema alone (both projects must
already have identical tables or it stops), and turns the dev digest job off.

After a copy, the e2e test accounts in `.env.test.local` no longer exist on dev; re-create them before
running the suite. `docs/training/practice-sponsors.csv` is a fake 150-sponsor roster for practicing the
Sponsors import.

## Working from more than one machine

The repo lives on GitHub; clone it anywhere. Env files are gitignored (see the table above), so on
each new machine copy `.env.local.example` to `.env.local` and/or `.env.development.local` again
and fill in the same project values from the Supabase dashboard — nothing else is machine-specific.

## Database changes

Every schema change is a file in `../supabase/migrations/`, in order. There's no migration runner wired up
yet — apply a new migration by pasting its contents into the target Supabase project's SQL editor (do
this for **both** the dev and prod projects, dev first). `../SCHEMA.md` explains the reasoning behind the
schema; the migration files are the literal SQL.

`../supabase/demo_seed.sql` is not a migration — it's fake demo data (fictional schools/families/sponsors,
all tagged for easy cleanup) for demoing the app. **Dev project only, never prod.** `../supabase/demo_seed_bulk.sql`
adds ~100 more randomly generated kids on top, for testing at realistic volume — same tags, same cleanup.
`../supabase/reset_dev_data.sql` clears all of it back out (keeps drives and staff accounts).

## Running locally

```bash
npm install
npm run dev
```

Opens on [http://localhost:3000](http://localhost:3000), using the dev Supabase project per the table
above. `npm run lint` and `npx tsc --noEmit` should both be clean before committing.

## Accounts

There's no public sign-up. A staff/volunteer account is created directly in the Supabase dashboard
(Authentication → Add user) — new accounts default to the `volunteer` role and must be promoted to
`admin` by an existing admin, either through the in-app Staff page (`/admin/staff`) or, for the very first
admin on a fresh project, directly via SQL (see the comment in
`../supabase/migrations/20260708130000_profiles_staff_management.sql`).

## Automated tests

`tests/e2e/` is a Playwright suite that runs against the **dev** Supabase project — real writes, real RLS,
no mocking. It covers the things that are easy to silently break: the `create_family` concurrency
guarantee, the `claim_card` race, confidential-family RLS (who can create vs. who can go on seeing one),
role-escalation prevention, the one-open-drive constraint, the public claim flow, and confidential-name
redaction in the UI.

Needs two dedicated test accounts in the dev project (never real staff accounts) — copy
`.env.test.local.example` to `.env.test.local` and follow the setup steps in that file. Then:

```bash
npm run test:e2e        # headless, terminal output
npm run test:e2e:ui     # Playwright's interactive UI mode, useful while writing new tests
```

Everything the suite creates is tagged `is_autotest_data = true` on `families` (children/cards/sponsors
namespaced under `@autotest.example.com`) and deleted again after each file runs — it shares the dev
project with your own manual testing and `demo_seed.sql` data, but never touches either. `demo_seed.sql`
rows are tagged `is_test_data = true` but *not* `is_autotest_data`, which is what keeps the two from
colliding: cleanup deletes on `is_autotest_data`, so a demo you just seeded for a walkthrough survives an
e2e run against the same dev database. It does need a drive with `status = 'open'` to exist first, same as
the seed scripts.
