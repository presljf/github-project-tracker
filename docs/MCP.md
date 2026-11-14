# TrackerOS MCP facade

`scripts/adopt/mcp/server.mjs` is a narrow MCP server over stdio. It exposes TrackerOS operations,
not a generic GitHub API, so an agent cannot use it as a raw GraphQL/project mutation surface.

## Write surface lock (v1.5.0-T10, #186)

The default surface is **read/plan plus validated proposal intake**. Proposal transitions
(`accept`, `defer`, `reject`) are **locked out of MCP** until the P2.2 gate:

- scoped broker credential/transport boundary (#170, #180);
- leased grant + approval for proposal transitions (P2.2; #182 re-enable);
- immutable classification and proposal-state guards (P0.5a, P0.5e);
- P0/P1 gates green, with tests proving each bypass fails.

Until then the CLI keeps the lifecycle for trusted, human-run use:

```bash
npm run proposal -- accept --issue N --title "..." --stream N
npm run proposal -- defer --issue N --reason "..."
npm run proposal -- reject --issue N --reason "..."
```

The lock is enforced in code, not only in docs: `assertWriteSurfaceLocked()` runs at server startup
and fails closed on a locked transition tool, a duplicate registration, or an unclassified tool.
`tests/mcp-server.test.mjs` pins the exact tool list and the locked set, so re-adding a transition
write fails the suite and the server unless the gate is deliberately removed in review.

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

### Locked tools

| Tool | Status | Trusted path |
|---|---|---|
| `tracker_proposal_accept` | locked until P2.2 | `npm run proposal -- accept` |
| `tracker_proposal_defer` | locked until P2.2 | `npm run proposal -- defer` |
| `tracker_proposal_reject` | locked until P2.2 | `npm run proposal -- reject` |

There is deliberately no `graphql`, `project_item_edit`, `create_issue`, or generic GitHub
passthrough tool.

## Security

- The server should run with the **TrackerOS write token** and, when added, the writable SSH key.
- The raw agent should have only a read-only token and no writable SSH key.
- Same-user operation prevents accidents, not a determined agent; use a separate OS user/container
  for a real boundary.
- The MCP facade is the intended operation surface, but it is not a guard by itself: the credential
  boundary and the `task done` / PR-link checks must also hold.
- The locked transition writes are not a boundary either: the CLI still requires a trusted caller.
  Re-enable them on MCP only after the P2.2 gate, never by widening the token scope.

## Examples

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tracker_proposal_list","arguments":{}}}
```

## Current scope

This slice is read/plan plus validated `[Proposal]` intake. Task mutation tools, proposal
transitions, merge, and credential/runner isolation are follow-ups; delivery stays off this surface
until the P2 gate.
