# Deploy to Vercel — runbook

Written 2026-08-19 for whoever (human or agent) actually executes this deploy —
it assumes no prior context beyond this repo. If that's you: read the whole
thing before running anything, especially **Phase 0**, which is the part most
likely to go wrong silently.

## What this app is, in the two sentences that matter for deployment

A Next.js 16 app that lives in [`web/`](../web) (not the repo root), where
**every page is a client component** — there's no server-side data fetching,
so the deployed site just needs to serve static/client-rendered pages and talk
directly to Supabase from the browser. That means deploying this is mostly
"point Vercel at the right folder and give it the right two environment
variables" — the hard part isn't the hosting, it's making sure the **database**
the deployed site talks to is actually ready. See [`AGENTS.md`](../AGENTS.md)
for the privacy/RLS model this whole app depends on before touching anything
here.

## Prerequisites checklist

Confirm every one of these before starting Phase 1. If any box can't be
checked, stop and resolve it first — don't work around it.

- [ ] You (or whoever's running this) have a GitHub account with access to
  `https://github.com/gcole416/reach-christmas` (confirm: `git remote -v` in
  this repo).
- [ ] You have — or are about to create — a Vercel account. Free tier is
  sufficient (see [DESIGN.md](../DESIGN.md) §3).
- [ ] You have access to **both** Supabase project dashboards (dev
  `thvyntrxmahygesltgft` and prod `mpiueduyrmplrueviupl` — see
  [`web/README.md`](../web/README.md)'s "Two Supabase projects" section for
  which is which and why there are two).
- [ ] **Phase 0 below is complete.** Do not skip ahead to Phase 1 until it is —
  deploying working frontend code against a stale prod database schema will
  break the live site immediately, in front of real sponsors.
- [ ] You are NOT holding the `service_role`/`sb_secret_*` key for either
  project, and have no intention of putting one anywhere in Vercel. This app
  never needs it — see the warning in
  [`web/.env.local.example`](../web/.env.local.example) and the "Never use the
  secret key" rule this project has enforced everywhere else.

## Phase 0 — Confirm prod's database schema is actually current

**This is the part that actually matters. Do not rush it.**

As of 2026-08-18, prod's exact migration state was unknown — Grant's own
words, answering DB-1 in [`docs/OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md): *"I
have no idea, I haven't done a good job keeping up with what is in prod. I
assume everything has been on dev only."* There is no migration ledger (see
DB-1/DB-25 in that same doc) — the only way to know what prod actually has is
to check it directly, table by table, against what the code expects.

**Do this like the dev migration session earlier today: one file at a time,
verify the result, then move to the next. Never batch-paste the whole
`supabase/migrations/` folder at once, and never do this without a human
(Grant) present reviewing each result** — a `drop column`/`drop constraint`
statement isn't safely re-runnable if something's already partially applied,
and this is the database a real church drive may come to depend on.

### Step 1: find out where prod actually stands

Run this in the **prod** project's SQL Editor (read-only, safe):

```sql
-- Does prod have today's three newest features? (fastest signal of how far behind it is)
select
  exists (select 1 from information_schema.columns where table_name = 'schools' and column_name = 'liaison_name') as has_adm3_school_liaison,
  exists (select 1 from information_schema.columns where table_name = 'cards' and column_name = 'copy_number') as still_has_old_adm2_copy_number,
  exists (select 1 from information_schema.tables where table_name = 'card_claim_verifications') as has_spn3_table,
  exists (select 1 from information_schema.columns where table_name = 'families' and column_name = 'is_test_data') as has_is_test_data,
  exists (select 1 from information_schema.columns where table_name = 'assignments' and column_name = 'verified_at') as has_verified_pipeline_stage,
  exists (select 1 from information_schema.tables where table_name = 'profiles') as has_init_schema_at_all;
```

- If `has_init_schema_at_all` is `false`: prod has **no schema at all** — apply
  every single file in [`supabase/migrations/`](../supabase/migrations/) in
  filename order (they're timestamp-prefixed, so alphabetical = chronological),
  starting from `20260708120000_init.sql`. This is the simplest case: nothing
  to reconcile, just run them all in order.
- If `has_init_schema_at_all` is `true` but the later flags are a mix of
  `true`/`false`: prod has *some* history. List every file in
  `supabase/migrations/` (`ls supabase/migrations/` or the equivalent), and
  for each one — oldest first — check whether its effect is already present
  (a quick read of the file tells you what to check for) before running it.
  Skip ones already applied; run ones that aren't, in order, verifying after
  each (same pattern as the dev walkthrough in this session's history — run
  one, check for an error, sanity-query the result, then move to the next).
- If every flag comes back `true`: prod is already current as of today's work.
  Skip to Phase 1.

### Step 2: apply what's missing

For each migration file that Step 1 determined isn't applied yet, in
chronological (filename) order:

1. Open the file, copy its full contents.
2. Paste into the **prod** SQL Editor, run it.
3. Confirm no error. If there IS an error, **stop, do not proceed to the next
   file**, and figure out why before continuing — the same way dev's ADM-2
   migration was blocked by leftover duplicate-card data earlier today; prod
   may have its own real-data equivalent of that problem, and real prod data
   deserves more care than dev's disposable test data did.
4. If a migration comment mentions a backfill or data-shape assumption (e.g.
   `20260818150000_school_liaison_on_schools.sql`'s liaison backfill,
   documented in `docs/OPEN_QUESTIONS.md`'s ADM-3 entry), run whatever
   pre-check query that migration's comments or the linked OPEN_QUESTIONS.md
   entry recommends, on **prod's real data**, before running it — a check
   that was "fine on dev" isn't automatically fine on prod.

### Step 3: confirm the Resend key is set for prod too

`request_claim_code()` needs its own Vault secret per project — the one Grant
stored in **dev**'s Vault does not carry over to prod. Once
`20260818160000_email_verified_claims.sql` is applied to prod, run in the
**prod** SQL Editor:

```sql
select vault.create_secret('re_xxxxxxxx', 'resend_api_key', 'Resend API key for claim verification emails');
```

(A second Resend API key, or the same one reused — either is fine; that's
Grant's call, not a technical constraint.)

### Step 4: re-run Step 1's query against prod

All six flags should now read `true`/`true where expected` (note
`still_has_old_adm2_copy_number` should be **`false`** — that one's inverted,
it's checking for something that should be *gone*). If anything's still off,
do not proceed to Phase 1.

## Phase 1 — Create the Vercel project

1. Go to [vercel.com](https://vercel.com), sign in (GitHub OAuth is the
   easiest path given the repo's already on GitHub).
2. **Add New → Project**, import `gcole416/reach-christmas` from GitHub.
3. **Before clicking Deploy**, set these in the import screen (or in Project
   Settings afterward if the import already ran):
   - **Root Directory**: `web` — this is the single most important
     non-obvious setting. The repo root has no `package.json`; the actual
     Next.js app is one level down. Skipping this makes the build fail
     immediately.
   - **Framework Preset**: Vercel should auto-detect "Next.js" once the root
     directory is set correctly. Confirm it did.
   - **Build Command** / **Output Directory** / **Install Command**: leave on
     their Next.js defaults (`next build`, `.next`, `npm install`) — nothing
     in [`web/package.json`](../web/package.json) or
     [`web/next.config.ts`](../web/next.config.ts) needs a custom override.

Don't click the final Deploy button yet — Phase 2 needs to happen first, or
the first build will succeed but the deployed site will have no working
Supabase connection.

## Phase 2 — Environment variables

Only two variables exist for this app (see
[`web/.env.local.example`](../web/.env.local.example)):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Both are safe to expose client-side — they're public by design, and RLS is
the actual security boundary (see `AGENTS.md`). **Never** add a
`service_role`/`sb_secret_*` value to Vercel, for either project, under any
variable name.

**Set each one twice, scoped to different Vercel environments**, mirroring
this repo's existing dev/prod split so a preview deployment can never touch
real prod data:

| Vercel environment | Value source | Vercel env-var scope |
|---|---|---|
| Production | **prod** Supabase project (`mpiueduyrmplrueviupl`) → Settings → API | check "Production" only |
| Preview | **dev** Supabase project (`thvyntrxmahygesltgft`) → Settings → API | check "Preview" only |

In Vercel: **Project Settings → Environment Variables**, add
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` once with the
prod values (Production checkbox only), then add both again with the dev
values (Preview checkbox only). Pull the actual values from each Supabase
project's own dashboard (Settings → API → Project URL / anon public key) —
don't copy them out of a local `.env.local`/`.env.development.local` file if
you can avoid it, since those aren't committed anywhere and may not be present
on whatever machine runs this deploy.

## Phase 3 — Branch-to-environment mapping

This repo has `main` and `dev` (confirm: `git branch -a`). Recommended default
— confirm with Grant before applying if anything here doesn't match his
actual intent, since it's a policy choice, not just a technical one:

- **Production Branch** (Project Settings → Git): `main`. Only a merge to
  `main` triggers a Production deploy against real prod data.
- Every other branch (`dev` included) gets a Preview deployment automatically
  on push, using the dev Supabase project per Phase 2's scoping — safe to push
  freely, nothing there can touch prod.

This means: today's session's work (already pushed to `dev`) will NOT go live
to real sponsors just by existing on Vercel — it needs a PR from `dev` into
`main` first. That's almost certainly the intended gate here, not an
oversight, given how carefully this project treats prod everywhere else — but
it's worth Grant explicitly confirming rather than assuming.

## Phase 4 — First deploy

1. Click Deploy (or, if the import already ran without env vars, go to
   **Deployments → Redeploy** after Phase 2's variables are saved — the first
   build won't have had them).
2. Watch the build log. A failure here is almost always one of: wrong Root
   Directory (Phase 1), or a missing/misnamed env var (Phase 2). It is very
   unlikely to be a code problem — `npm run lint` and `npx tsc --noEmit` are
   clean in this repo as of 2026-08-19.
3. Once it succeeds, Vercel gives you a `*.vercel.app` URL. That's enough to
   go live on — no custom domain is required to start (see Phase 6 for that,
   optional).

## Phase 5 — Post-deploy smoke test

Don't consider this done until these pass **against the live deployed URL**,
not just locally:

- [ ] `/sponsor` loads and shows real (non-test) cards from **prod** — if it
  shows dev's demo data (fake names like "Ella", schools like "Demo Elementary
  North"), the env vars are pointed at the wrong project. Fix Phase 2, not the
  code.
- [ ] `/admin/login` loads and an actual staff account can sign in.
- [ ] Open the deployed `/sponsor` page in a private/incognito window (no
  staff session) and confirm: no confidential family ever appears, and the
  card count matches what you'd expect for real open, unclaimed, non-test
  cards — this is the live version of the anon-boundary check `AGENTS.md`
  cares about most. If anything confidential-looking shows up, treat it as a
  Sev1 and pull the deployment (Vercel → Deployments → ⋯ → "Instant Rollback"
  to the previous one) before investigating further.
- [ ] Try an actual sponsor claim end to end with a real email address you
  control: request a code, confirm it arrives, enter it, confirm the claim
  completes. This is the one thing dev testing couldn't fully prove either
  (see SPN-3/SPN-4 in `docs/OPEN_QUESTIONS.md`) — prod is a good place to
  finally close that loop, carefully, with a card you don't mind having
  "claimed" as a test (clean it up afterward via the admin UI — cancel the
  assignment — since prod has no `is_test_data` cleanup script the way dev
  does).

## Phase 6 — Custom domain (optional, not required to demo)

Not scoped in detail here since no domain has been chosen yet (see DESIGN.md
§3/§8) — Vercel's own "Domains" project setting is where this goes whenever
one exists. A `*.vercel.app` URL is a completely fine way to run the actual
demo and even the live season if nobody minds the URL.

## What this doc deliberately does NOT cover

- **Database backups** — DOC-3 in `docs/OPEN_QUESTIONS.md` is still open as of
  2026-08-18. Deploying to Vercel doesn't create a backup strategy for you;
  that's a separate Supabase dashboard setting, still unconfirmed for either
  project.
- **A migration ledger / automated migration runner** — DB-1/DB-25 are still
  open. This doc's Phase 0 is a manual workaround for not having one, not a
  fix for the underlying gap.
- **Sponsor notifications (SPN-6), CI (DOC-6)** — unrelated to hosting,
  tracked separately.

If you hit something this doc didn't anticipate, add it here rather than
solving it silently and letting the next person rediscover the same gap.
