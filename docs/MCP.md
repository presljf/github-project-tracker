# TrackerOS MCP facade

`scripts/adopt/mcp/server.mjs` is a narrow MCP server over stdio. It exposes TrackerOS operations,
not a generic GitHub API, so an agent cannot use it as a raw GraphQL/project mutation surface.

## Run

```bash
GH_TOKEN="$(op read 'op://Programmatic/GitHub-PAT-TRACKER_TOKEN/credential')" \
  node scripts/adopt/mcp/server.mjs --config tracker.config.json
```

The process speaks newline-delimited JSON-RPC 2.0 on stdin/stdout. Logs go to stderr.

## Tools

| Tool | Mode | Purpose |
|---|---|---|
| `tracker_proposal_list` | read | Open proposals + board status |
| `tracker_proposal_create` | write | Create a validated `[Proposal]` issue |
| `tracker_issue_context` | read | Issue body, comments, labels, project item |
| `tracker_task_status` | read | Task status, assignees, delivery fields |
| `tracker_audit` | read | TrackerOS violations and warnings |

There is deliberately no `graphql`, `project_item_edit`, `create_issue`, or generic GitHub
passthrough tool.

## Security

- The server should run with the **TrackerOS write token** and, when added, the writable SSH key.
- The raw agent should have only a read-only token and no writable SSH key.
- Same-user operation prevents accidents, not a determined agent; use a separate OS user/container
  for a real boundary.
- The MCP facade is the intended operation surface, but it is not a guard by itself: the credential
  boundary and the `task done` / PR-link checks must also hold.

## Examples

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tracker_proposal_list","arguments":{}}}
```

## Current scope

This slice is proposal intake plus read-only context/task/audit tools. Task mutation tools and
credential/runner isolation are follow-ups.
