# Memory / Reminders

- When spinning up the SQL server for testing, run the `reset_dev_sql` query and then the `demo_seed` query to remove and repopulate data on the dev site.

## GitLab issue tracking

- Open work is tracked as GitLab issues at `reach-christmas-group/reach-christmas-project` (https://gitlab.com/reach-christmas-group/reach-christmas-project) — issue tracking only; no code is mirrored there. GitHub (`gcole416/reach-christmas`) remains the sole code host.
- Labels: `type::feature|bug|tech-debt|question`, `area::admin|sponsor|database|docs`, `workflow::backlog|in-progress|in-review` (closed = Done).
- The project's default issue board exists automatically, but the three `workflow::*` label lists were added manually in the GitLab UI (Issues → Boards → Create list) — the GitLab MCP server has no board-management API, so redo that step by hand if the board is ever recreated.
- `docs/backlog.md` stays the source of truth for user stories, maintained by the product-manager agent (which has no GitLab access). GitLab issues cover the same open work plus standalone decisions/tech-debt that don't fit the user-story format. Keeping the two in sync is a manual step for whoever has GitLab access.
