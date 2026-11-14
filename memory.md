# Memory / Reminders

- Since 2026-11-14 the dev site is a **practice copy of prod** (real names, prod logins, email off). See "Two sites" in [AGENTS.md](AGENTS.md). To reset dev back to prod's current state, run `node scripts/copy-prod-to-dev.mjs --go` from `web/`.
- The older way to get test data (run the `reset_dev_sql` query, then `demo_seed`) still works but wipes the practice copy and replaces it with fake demo data. Only do that if Grant asks for it.

## GitLab issue tracking

- Open work is tracked as GitLab issues at `reach-christmas-group/reach-christmas-project` (https://gitlab.com/reach-christmas-group/reach-christmas-project) — issue tracking only; no code is mirrored there. GitHub (`gcole416/reach-christmas`) remains the sole code host.
- Labels: `type::feature|bug|tech-debt|question`, `area::admin|sponsor|database|docs`, `workflow::backlog|in-progress|in-review` (closed = Done).
- The project's default issue board exists automatically, but the three `workflow::*` label lists were added manually in the GitLab UI (Issues → Boards → Create list) — the GitLab MCP server has no board-management API, so redo that step by hand if the board is ever recreated.
- `docs/backlog.md` stays the source of truth for user stories, maintained by the product-manager agent (which has no GitLab access). GitLab issues cover the same open work plus standalone decisions/tech-debt that don't fit the user-story format. Keeping the two in sync is a manual step for whoever has GitLab access.
