# PROJECT — tracker

This project is tracked on a GitHub Project board using Project Tracker OS.

- **Board:** https://github.com/users/OWNER/projects/NUMBER (replace with the real link)
- **Tracker config:** [`tracker.config.json`](../tracker.config.json) (owner, project number, fields, pinned template version)
- **Guards:** [`.github/workflows/tracker.yml`](../.github/workflows/tracker.yml) runs the PR close guard and the advisory audit
- **Issue forms:** [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/)

## Lifecycle

1. An issue is created from the Task (or Bug) form. The form's required fields are the Definition
   of Ready; the board item is added to the project with Status/Area/Kind/Estimate.
2. Work starts by linking the issue to a `task/` branch and opening a PR that references it.
3. The PR close guard checks that the closing PR belongs to the task and that evidence exists.
4. The task moves to Done only when the linked PR is merged, checks are green, and evidence is
   recorded on the issue.
5. A weekly advisory audit reports drift: items missing fields, stale In Progress work, and
   closures without a linked PR.

## Rules

- One board per project; do not create a second tracker for the same work.
- Required checks live in the repository ruleset, not in the workflow: the caller only has to be
  present and pinned (see [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md)).
- Upgrade the tracker by bumping the pinned tag in the workflow and
  `automation.templateVersion` in the config together.
