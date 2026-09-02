# Start Here

A map of this repo's docs and agents, so a new session reads only what the
current task needs instead of everyone re-pasting everything every time.

**Always loaded automatically:** [AGENTS.md](AGENTS.md), via the `@AGENTS.md`
import in [CLAUDE.md](CLAUDE.md). It's kept deliberately short — the role
model and privacy guardrails apply to every task, so that's the one doc
that's never optional. Everything else below is read on demand.

## Where to look

| Task | Read | Don't bother re-reading |
|---|---|---|
| Any task at all — role model, who sees what | [AGENTS.md](AGENTS.md) | (already loaded) |
| Starting/continuing a user story | [docs/backlog.md](docs/backlog.md) — status source of truth (GitLab issues track the same open work; syncing is manual — see memory.md) | DESIGN.md, unless you need the *why* behind scope |
| "Why does this feature work this way" / phasing | [DESIGN.md](DESIGN.md) | SCHEMA.md, unless the question is about table shape |
| Blocked on a decision, or about to guess at one | [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) — every open question in one place, by area; add to it rather than inventing an answer | DESIGN.md §8 / SCHEMA.md's open-questions section (both folded in there) |
| Schema, RLS policies, DB functions, migrations | [SCHEMA.md](SCHEMA.md) | DESIGN.md §1-3 (background/workflow, not schema) |
| Deploying to Vercel, or checking prod's DB is ready to | [docs/DEPLOY.md](docs/DEPLOY.md) — full runbook, written for an agent with no prior context | — |
| Running a live-notes doc for a team meeting | [docs/templates/live-meeting-notes-template.html](docs/templates/live-meeting-notes-template.html) — copy, fill in the agenda, publish as an Artifact with the `artifact` capability so notes autosave and are shareable | — |
| Resetting dev data, GitLab issue conventions | [memory.md](memory.md) | — |
| Spawning or understanding a specialist agent | the matching file in [.claude/agents/](.claude/agents/) | the other five agents' files |
| Setting up or troubleshooting the agent team itself | [agent_coding_help/AGENT-TEAM-SETUP.md](agent_coding_help/AGENT-TEAM-SETUP.md) | — |

## The agents

Six role files live in [.claude/agents/](.claude/agents/) — that directory is
the single canonical copy (git-tracked, so it travels with the repo; no other
copy should exist anywhere else in the tree):

- **product-manager** — team lead; writes/tracks stories in `docs/backlog.md`, spawns and coordinates the four specialists below.
- **frontend-designer** — UI (`web/app/**`, `web/components/**`).
- **database-engineer** — schema/migrations/RLS (`supabase/migrations/**`, `web/lib/**`).
- **qa-tester** — verifies acceptance criteria, owns `web/tests/`.
- **code-reviewer** — read-only review gate before a story is marked Done.
- **reach-reviewer** — targeted safety-invariant check (RLS gating, concurrency, `security definer` usage) for changes touching migrations/RLS/`public_available_cards`; also good for a general pre-push review. Not part of the PM's per-story spawn loop — invoke it directly.

Each agent's own file already links to `AGENTS.md`/`SCHEMA.md`/`DESIGN.md`
rather than restating them — if you're editing a role file and find yourself
copying guardrail text into it, that's a sign to link instead.

## Starting a new task

1. New feature, bug, or change of any real size → start with **product-manager**
   (`claude --agent product-manager`) so it lands in `docs/backlog.md` with
   acceptance criteria before code moves.
2. One-off tiny fix → go straight to the owning specialist by file path (see
   table above); no need to spin up the whole team.
3. Anything touching `families`/`children`/`sponsors`/RLS → database-engineer
   first, then **reach-reviewer** before it ships, regardless of team size.
