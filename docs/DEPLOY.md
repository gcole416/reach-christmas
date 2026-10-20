# Deploy to Vercel — runbook

> **Updated 2026-10-20.** For the 2026 go-live, follow
> [PROD_LAUNCH_CHECKLIST.md](PROD_LAUNCH_CHECKLIST.md) end to end: prod is a
> **fresh Supabase project** built from all 34 migrations
> ([MIGRATION_LEDGER.md](MIGRATION_LEDGER.md)), launched with email off. That
> replaces Phase 0 and Phase 5 below. Phases 1 to 4 (the Vercel project, its
> two environment variables, and the `main` = Production branch mapping) still
> describe the hosting side accurately.

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

## Phase 0 — Prod's database (superseded 2026-10-20)

The audit-and-patch approach that used to live here assumed prod could be
brought current in place. Read-only probing on 2026-10-20 showed the old prod
project had only part of the July schema and no record of what was applied,
so Grant decided to start prod as a **fresh project** instead. Follow
[PROD_LAUNCH_CHECKLIST.md](PROD_LAUNCH_CHECKLIST.md) sections 1 to 3, using
[MIGRATION_LEDGER.md](MIGRATION_LEDGER.md) for the migration order. The rule
that mattered here still holds: one migration per run, check each result, and
never deploy new code against a database that hasn't been brought up to date
first.

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

## Phase 5 — Post-deploy smoke test (superseded 2026-10-20)

The old checks here tested the self-serve `/sponsor` claim page, which is now
just a link to the Church Center sign-up (US-59). Use section 6 of
[PROD_LAUNCH_CHECKLIST.md](PROD_LAUNCH_CHECKLIST.md) instead: signed-out
redirects, a throwaway registration through a `SMOKE TEST` link that the
counselor page rejects (so no household is ever created), and cleanup.

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
