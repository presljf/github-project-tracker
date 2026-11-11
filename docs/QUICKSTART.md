# Quickstart — first tracker in ~10 minutes

**Docs version:** v1.0.0-docs.1 · Full handbook: [HOW TO USE](./HOW_TO_USE.md) · Reference: [REFERENCE](./REFERENCE.md)

> Automation note: `bootstrap.mjs` is available now and defaults to dry-run. This quickstart uses the GitHub UI and `gh` commands so every step is visible; use bootstrap as a shortcut once you have a config.

## 0. Prerequisites

- GitHub account with permission to create a repo/project.
- GitHub CLI `gh` installed (v2.40+ recommended):
  ```bash
  gh --version
  # gh version 2.x.x (...)
  ```
- Project scope for `gh`:
  ```bash
  gh auth status
  # ✓ Logged in to github.com account <you> (...)
  # - Token scopes: 'repo', 'project', ...
  ```
  If `project` is missing:
  ```bash
  gh auth refresh -s project
  ```
- Node >=22 is required for the CLI/automation path (`package.json` engines); it is optional only for the pure UI/`gh` manual path.
- A scratch repository for your first practice run (recommended).

macOS/Linux: use bash/zsh. Windows: use Git Bash or WSL; PowerShell equivalents are noted in [Reference](./REFERENCE.md).

## 1. Create or choose a repo

New repo:
```bash
gh repo create OWNER/REPO --private --add-readme --clone
cd REPO
```
Expected: repo created/cloned; `git status` shows a clean `main`.

Existing repo:
```bash
cd /path/to/repo
git checkout main && git pull
```

Enable Issues and Projects in repo **Settings**. UI: **Settings → General → Features → Issues / Projects**.

## 2. Create the release milestone

UI: **Issues → Milestones → New milestone** (`v0.1.0`).

CLI alternative:
```bash
gh api repos/OWNER/REPO/milestones -f title="v0.1.0" -f description="First release"
# {"number":1,"title":"v0.1.0",...}
```

## 3. Create the project

UI: **Projects → New project → Table**, name it `Project Tracker`; link it to the repo.

CLI alternative:
```bash
gh project create --owner @me --title "Project Tracker"
# https://github.com/users/OWNER/projects/1
gh project link PROJECT_NUMBER --owner @me --repo OWNER/REPO
```

## 4. Add the minimum fields

UI: project **Settings → Custom fields**:

| Field | Type | Options |
|---|---|---|
| Status | single select | Todo, In Progress, In Review, Blocked, Done |
| Release | single select | v0.1.0 |
| Sprint | single select | 0.1.0.1 |
| Area | single select | docs, code, ci |
| Kind | single select | feature, fix, ux, spike, test, infra |
| Estimate | single select | S, M, L |
| Source | single select | Internal, Downstream |

Add views: **In flight**, **Current sprint**, **Roadmap**, **Blocked** (see [HOW TO USE](./HOW_TO_USE.md#6-read-the-board)).

## 5. Create the first sprint + task

Sprint issue:
```bash
gh issue create --repo OWNER/REPO --title "[Sprint] 0.1.0.1 — First tracker task" \
  --body "Release: v0.1.0\nGoal: prove the tracker lifecycle end-to-end."
# https://github.com/OWNER/REPO/issues/1
```

Task issue:
```bash
gh issue create --repo OWNER/REPO --title "[Task] Create tracker config" \
  --body "Acceptance: config file exists and validates."
# https://github.com/OWNER/REPO/issues/2
```

Set project fields (UI: open item → fields; CLI below discovers IDs first):
```bash
gh project field-list PROJECT_NUMBER --owner @me --format json > /tmp/fields.json
# inspect IDs/options, then:
gh project item-list PROJECT_NUMBER --owner @me --format json > /tmp/items.json
gh project item-edit --id ITEM_ID --project-id PROJECT_ID \
  --field-id STATUS_FIELD_ID --single-select-option-id TODO_OPTION_ID
```

Link the task as a sub-issue of the sprint (UI: task → **Sub-issues** → add parent; or API):
```bash
CHILD_ID=$(gh api repos/OWNER/REPO/issues/2 --jq .id)
gh api repos/OWNER/REPO/issues/1/sub_issues -X POST -F sub_issue_id="$CHILD_ID"
```

## 6. Do the task through the lifecycle

1. Assign yourself; Status **In Progress**.
2. Post check-in using [`docs/comment-templates/check-in.md`](./comment-templates/check-in.md).
3. Create branch:
   ```bash
   git checkout -b task/2-tracker-config
   ```
4. Make the change; commit:
   ```bash
   git add tracker.config.json
   git commit -m "task(#2): add tracker config"
   git push -u origin task/2-tracker-config
   ```
5. Open PR:
   ```bash
   gh pr create --fill --body "Closes #2"
   # PR URL
   ```
6. Status **In Review**; attach evidence.
7. Merge, set **Done**, post check-out template, close issue.

## 7. Verify

- Board shows the task Done and sprint progress.
- Issue has check-in/check-out comments with evidence.
- PR body contains `Closes #2` and the issue is closed.

That's the minimum viable tracker. Next:

- Read [HOW TO USE](./HOW_TO_USE.md) for fields/views, blockers, sprint/release closes, roles, and worked examples.
- Adopt properly with [ADOPTION](./ADOPTION.md).
- Use the [playbook](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md) for the model and audit rules.
- For failures, see [TROUBLESHOOTING](./TROUBLESHOOTING.md).
