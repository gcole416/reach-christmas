# Prod launch checklist (fresh project, email off)

Written 2026-10-20 for Grant (US-51). Plan decided the same day:

- **A fresh Supabase project for prod.** Nothing is copied from dev: no test
  households, demo schools, test accounts or AutoTest leftovers. Prod is built
  from the code (the 34 migrations) and then filled with real setup data in the
  app.
- **Email off at launch.** The sending domain isn't verified yet, so no email
  would reach a real counselor or sponsor. Staff send links and cards by hand
  until section 8 is done.

Work top to bottom. Each step says who does it. Steps marked **SQL** are pasted
into the Supabase SQL Editor of the **new prod project**: before every paste,
check the project name in the dashboard's top bar. Stop at any error and don't
skip ahead; ask Claude to look at the error first.

---

## 0. Before you start

- [ ] **0.1 The review has cleared prod** (your standing rule: prod moves only
  after a major review). Items to close or consciously accept in it:
  - US-48 "fix before launch" data-safety bugs (wish list save can lose the
    old list on failure; two people adding siblings at once can half-save;
    Fulfillment can crash on a card it can't see; a failed refresh wipes typed
    input).
  - Z1 numbering: confidential and direct-referral households share the "Z"
    prefix, so two different households can both be Z1. Decide before real
    cards are numbered.
  - Spanish form text not yet reviewed by a fluent speaker.
  - Stories still waiting on a reviewer pass (US-27, US-28 and the other
    "In review" items in docs/backlog.md).
- [ ] **0.2** `dev` is pulled and pushed, and the full e2e suite is green
  against dev (ask Claude to run it).
- [ ] **0.3 Have these ready:**
  - every school: name, a 1 to 3 letter card code, and liaison
    name / email / phone;
  - your staff list (name, email, who needs confidential access);
  - the Church Center sponsor sign-up link;
  - the sponsor roster as a CSV with `name, email, phone, capacity`.
    **Include capacity**: Suggest matches treats a missing one as room for 1.

## 1. Create the prod project (you, Supabase dashboard)

- [ ] **1.1** New project, same organization and region as dev. Save the
  database password somewhere safe.
- [ ] **1.2** Settings → API: note the **Project URL** and the **anon public**
  key. Never the `service_role` / `sb_secret_` key; this app never needs it.
- [ ] **1.3 Turn off public sign-ups: the most important setting on this
  page.** Authentication → Sign In / Providers → turn **off** "Allow new users
  to sign up". Why: every new login automatically becomes a `volunteer`, and
  volunteers can read every non-confidential child's name, sizes and wish
  list. The public key ships inside the website, so with sign-ups on, anyone
  could create an account and read that. Staff accounts are still created from
  the dashboard (step 3), which works with sign-ups off. *(Worth checking the
  same setting on dev too.)*
- [ ] **1.4** Database → Backups: confirm what backups this plan includes
  (DOC-3).

## 2. Build the database (you paste; Claude can watch the results)

- [ ] **2.1** SQL Editor of the **new** project. Confirm the project name.
- [ ] **2.2 SQL** Apply all 34 migrations from `supabase/migrations/`, **one
  file per run, in the order listed in
  [MIGRATION_LEDGER.md](MIGRATION_LEDGER.md)**. After each: no error, then
  the next. A failure means stop.
- [ ] **2.3** Tell Claude when done so the ledger's prod column gets filled in.
- [ ] **2.4 SQL** Edit the two values at the top of
  [`supabase/prod_setup.sql`](../supabase/prod_setup.sql) (the prod website
  address from Vercel → Domains, and the Church Center link), then run it.
  Every check at the bottom should read `ok = true`. It also removes the daily
  counselor digest schedule (email off).

## 3. Staff accounts (you, dashboard + SQL)

- [ ] **3.1** Authentication → Users → **Add user** for yourself, with
  "Auto confirm" on.
- [ ] **3.2 SQL** Make yourself admin:
  ```sql
  update profiles set role = 'admin' where email = 'you@example.com';
  select email, role from profiles;
  ```
- [ ] **3.3** Everyone else: Add user in the dashboard, or
  `web/scripts/bulk-create-volunteers.mjs` from a CSV (you run it; its header
  explains the one-time key handling). New accounts are volunteers.
- [ ] **3.4** Authentication → URL Configuration: set **Site URL** to the prod
  website address.

## 4. Ship the code (you, GitHub + Vercel)

Do this **after** step 2: the new code needs the new database.

- [ ] **4.1** Vercel → Project Settings → Environment Variables: replace the
  **Production** values of `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` with the new project's (from 1.2). Leave the
  **Preview** values on dev.
- [ ] **4.2** Vercel → Settings → Git: Production Branch is `main`.
- [ ] **4.3** GitHub: open a pull request from `dev` into `main` and merge it.
  Vercel builds production from `main`.
- [ ] **4.4** Update `web/.env.local` on your machines to the new prod values
  (`.env.local` is prod, `.env.development.local` is dev).

## 5. Set up the season in the app (you, on the prod site, as admin)

- [ ] **5.1** Setup → Drives: create "Reach Christmas 2026" and open it.
- [ ] **5.2** Setup → Schools: add each school with its code and liaison.
- [ ] **5.3 SQL** Run
  [`supabase/set_distribution_school_dropoff.sql`](../supabase/set_distribution_school_dropoff.sql).
  Every row should read `school_dropoff`.
- [ ] **5.4** Setup → Staff & permissions: give confidential access to the
  staff who need it.
- [ ] **5.5** Intake → Registrations → Registration links: for each school,
  create the household link and the counselor review link. (The first link
  publishes the English form automatically. The Spanish toggle works without
  any extra step.)
- [ ] **5.6** Sponsors → Sponsor roster → Import CSV.

## 6. Smoke test on prod (you; ask Claude to walk through it with you)

- [ ] **6.1** Signed out, `/admin` goes to the login page and `/sponsor` shows
  the Church Center link.
- [ ] **6.2** Make one extra household link for any school labeled `SMOKE
  TEST`. In a private window, register a household through it with the
  parent/guardian name `SMOKE TEST`. Open that school's review link: the registration is there. Click
  **This isn't right**, reason "smoke test". Nothing gets imported, so no
  household is created.
- [ ] **6.3** Revoke the `SMOKE TEST` link, then clean up:
  ```sql
  delete from form_submissions where answers->'family'->>'guardian_name' = 'SMOKE TEST';
  ```
  Dashboard counts should be back to zero.
- [ ] **6.4** Phone check: open the dashboard and Assign sponsors on a phone.

## 7. Running with email off

- Counselor links: copy them from Registration links and send from your own
  email.
- Sponsor cards: use Print cards, or send details by hand. "Email all
  assigned" and the counselor Email buttons will show an error (no key stored
  yet). That's expected.

## 8. Later: turning email on

1. Verify the church domain in Resend (SPF, DKIM, DMARC). Needs DNS access.
2. Claude writes a migration swapping the sender off `onboarding@resend.dev`
   in the database email functions (it's hard-coded in several).
3. **SQL**: store the key:
   `select vault.create_secret('re_...', 'resend_api_key', 'Resend API key');`
   and set `app_settings.edge_functions_url` to the prod project's functions
   address.
4. You, with the Supabase CLI linked to prod: deploy `send-sponsor-emails`
   and `send-sponsor-card-email`, then
   `supabase secrets set RESEND_API_KEY=... EMAIL_FROM="Reach Christmas <...>"`.
5. **SQL**: turn the daily digest back on:
   ```sql
   select cron.schedule('counselor-review-digest', '0 13 * * *',
     $$select public.send_counselor_digests();$$);
   ```
6. Ask counselors to allowlist the sending address.

## 9. After launch

- [ ] Once prod is verified, retire the old prod project
  (`mpiueduyrmplrueviupl`): pause, then delete it after a last look that
  nothing in it is needed.
- Dev stays as the test copy, with its test data. Nothing ever moves from dev
  to prod except code and migrations.
