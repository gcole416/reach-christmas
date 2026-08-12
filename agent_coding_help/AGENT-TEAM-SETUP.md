# Reach Christmas — Agent Team Setup

A Claude Code agent team for the Reach Christmas gift-drive site. Five roles
spawn and message each other as a team (agent teams), sharing a task list:

- **product-manager** — your main session; writes/manages user stories, spawns and
  coordinates the team, runs the review gate.
- **frontend-designer** — implements and improves the UI (owns `web/app/**`,
  `web/components/**`).
- **database-engineer** — owns schema migrations, RLS policies, and the data
  layer (`supabase/migrations/**`, `web/lib/**`). Gates any destructive or
  seed SQL behind explicit dev-vs-prod confirmation.
- **qa-tester** — verifies functionality, writes/runs tests (owns `web/tests/`).
- **code-reviewer** — read-only review before a story is marked Done.

A sixth role, **reach-reviewer**, isn't part of that spawn loop — it's a
targeted safety-invariant check (RLS gating, concurrency, `security definer`
usage) invoked directly for a pre-push review or after any change touching
migrations/RLS, rather than something the PM routinely spawns per story.

All six role files already live in [.claude/agents/](../.claude/agents/) in
this repo — see [START_HERE.md](../START_HERE.md) for the full doc map.

This app handles real children's names, ages, and confidential family
records, so the split isn't arbitrary: database-engineer exists specifically
so the RLS/privacy-sensitive layer has one clear owner instead of being
whoever happened to touch it. See [../AGENTS.md](../AGENTS.md) for the full
role/privacy model this team is built around.

---

## 0. Important: run this on the machine that has the code

An agent team is scoped to **one session on one machine**, and teammates edit files
on the local filesystem. Set this up in the Claude Code session on the **desktop**
where the Christmas-drive repo lives. You can still monitor/steer it remotely from
the Claude app, but execution happens on the desktop.

## 1. Role files — already installed

The six role files are git-tracked at [.claude/agents/](../.claude/agents/),
so cloning this repo already gives you all of them; there's nothing to copy.
This step only matters if you're bootstrapping a brand-new repo from scratch —
in that case, create `<repo>/.claude/agents/<role>.md` for each role and
restart Claude Code once so the new directory gets picked up.

## 2. Enable agent teams

Agent teams are experimental and **off by default**. Turn them on in
`~/.claude/settings.json` (or the repo's `.claude/settings.json`):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Optional, for watching all five agents at once in separate panes (macOS-friendly;
needs tmux or iTerm2 — in-process mode works in any terminal without this):

```json
{
  "teammateMode": "auto"
}
```

## 3. Start the session as the PM

From the repo root on the desktop:

```bash
claude --agent product-manager
```

Your main session now *is* the PM and team lead.

## 4. Drive it with natural language

Write stories first:

```
Let's plan the gift-request form. Draft user stories for it in docs/backlog.md,
then let's review them together before building anything.
```

Then execute a story as a team:

```
For US-1, spawn the frontend-designer, database-engineer, qa-tester, and
code-reviewer as teammates. Have database-engineer add the new field/query
first, the designer build the form UI against it, qa-tester write tests
against the acceptance criteria, and code-reviewer review before we mark it
Done. Assign file ownership so nobody edits the same files.
```

A story that's pure UI/copy doesn't need database-engineer — spawn only the
teammates the story actually touches.

Talk to any teammate directly: select its row in the panel and press Enter
(in-process), or click its pane (split panes).

---

## Things to know

- **Cost**: each teammate is a full Claude instance, so a team uses noticeably more
  tokens than one session. Spawn only the teammates a story actually needs (often
  2-3, not all 4); scale up only when it clearly helps.
- **Avoid file collisions**: the biggest failure mode is two agents editing the same
  file. The role files assign ownership (designer → `web/app`/`web/components`,
  database-engineer → `supabase/`/`web/lib`, tester → `web/tests`), and the PM
  should reinforce it per story.
- **Best fit**: review, testing, and independent UI/data work parallelize well.
  Tightly sequential edits to one file are better done in a single session — e.g.
  don't have frontend-designer and database-engineer both mid-edit on a query
  contract at once; let database-engineer land the field first.
- **Session resumption is limited**: `/resume` doesn't restore in-process teammates.
  If you reopen a session, ask the PM to re-spawn the team.
- **The root `CLAUDE.md`/`AGENTS.md` are already set up** and read by every
  teammate automatically — the role/privacy model lives there, not duplicated
  in each role file. If the domain model changes, update `AGENTS.md` once.
  [START_HERE.md](../START_HERE.md) maps every other doc; link to it instead
  of re-explaining what's in DESIGN.md/SCHEMA.md/backlog.md inside a role file.
- **Destructive SQL needs a live human, every time**: database-engineer's role
  file requires it to state the target project and get explicit confirmation
  before running `reset_dev_sql`/`demo_seed`/any drop or truncate — don't
  pre-approve this in a story description, confirm it in the moment.
