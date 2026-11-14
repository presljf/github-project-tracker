# Broker control-plane store

`scripts/adopt/lib/broker-store.mjs` and its siblings implement the P0.1 authority store: the one
durable place that records grants, leases, approvals, plans, idempotency keys, revocations, mutation
intent, and the call log. It is not a GitHub client; nothing here mutates the board.

## Location and permissions

- Default path: `~/.tracker-broker/broker.db` (`TRACKER_BROKER_STORE` overrides it).
- Directory `0700`, database `0600`, WAL journal, `busy_timeout = 5000`, single writer.
- The store refuses a path inside the repository, so an agent cannot write it through the checkout.
- Migrations run in one transaction; a failed migration or a schema newer than this code refuses
  startup instead of running against a partial store.

## Schema

| Table | Holds |
|---|---|
| `grants` | Human-approved tier/repo/project, tool allowlist, task scope, limits, expiry |
| `approvals` | Who approved, channel, plan link, expiry |
| `plans` | Plan JSON bound to a tool and args hash |
| `leases` | Grant-derived capability bound to one tool, task, and args hash, with uses/expiry |
| `idempotency` | Key → first recorded result |
| `revocations` | Grant/lease revocations with reason |
| `call_log` | Hash-chained call entries (`prev_hash`/`hash`) |
| `outbox` | Mutation intent written before the GitHub call |

## Policy

`broker-policy.mjs` validates a policy with `tier`, `repo`, `project`, `tools`, `tasks`, `limits`,
`paths`, `approval`, and `ttl`. Unknown top-level or nested fields are rejected so a typo fails
closed. The tool allowlist and path rules are fail-closed: an empty allowlist admits nothing, deny
prefixes win, and `assertToolAllowed` throws for anything unlisted.

## Grants, leases, and approvals

- `issueGrant` requires a recorded, unexpired approval; a grant without an approval is refused.
- `issueLease` requires an active grant (not revoked/expired), a tool inside the grant allowlist,
  a task inside the grant's task scope when one is declared, and an args hash. A lease may not
  outlive its grant.
- `useLease` re-checks revocation, expiry, tool, args hash, and the use budget inside one write
  transaction on **every apply**, then increments uses. Any mismatch throws; nothing is best-effort.
- `revokeSubject` records a revocation and stamps the grant/lease; revocation is idempotent.

## Outbox and reconcile

`recordIntent` writes an intent row before a mutation. After a crash, `reconcileOutbox` asks a
caller-provided checker what happened and marks the row `applied`, `failed`, or `unknown`. Without a
checker, only stale `pending` rows become `unknown`; unknown rows are never retried automatically
because the mutation may not be idempotent.

## Call log and audit copy

`appendCall` appends a row whose hash chains from the previous row:
`sha256(prevHash, at, tool, argsHash, outcome, canonical(detail))`. `verifyCallLog` recomputes the
whole chain, so an edit, deletion, or reorder is detected. Each entry is also appended to a sibling
`audit.jsonl` (0600); `readAuditCopy` returns it. `queryCalls` is the read-only query API.

## No secrets

Every writer calls `assertNoSecrets`, which refuses token-like values (`ghp_`, `github_pat_`,
OAuth/SSH key markers, Slack tokens, `sk-` keys) before an INSERT. No table has a token column, and
tests assert both properties.

## Same-user limitation (accepted)

Until the m2/separate identity, the store runs under the operator's macOS user. File modes stop other
users, **not** a process running as the operator; a same-user process can open the database. This is
operational separation only. The P0 gate must report this control as failed, and no documentation may
claim a hard boundary while it holds.

## Example

```js
import { openStore } from './broker-store.mjs';
import { createApproval, issueGrant, issueLease, useLease } from './broker-authority.mjs';
import { appendCall } from './broker-ledger.mjs';
import { recordIntent, reconcileOutbox } from './broker-outbox.mjs';

const store = openStore();
const approval = createApproval(store, { approvedBy: 'owner', channel: 'chat' });
const grant = issueGrant(store, {
  tier: 'proposal',
  repo: 'owner/repo',
  project: 2,
  tools: ['tracker_proposal_create'],
  tasks: [188],
  approvalId: approval.id,
  issuedBy: 'owner',
  ttlMinutes: 60,
});
const lease = issueLease(store, {
  grantId: grant.id,
  tool: 'tracker_proposal_create',
  task: 188,
  argsHash: 'a'.repeat(64),
  ttlMinutes: 10,
  maxUses: 1,
});
useLease(store, { leaseId: lease.id, tool: 'tracker_proposal_create', argsHash: 'a'.repeat(64) });
const intent = recordIntent(store, { tool: 'tracker_proposal_create', argsHash: 'a'.repeat(64) });
appendCall(store, { tool: 'tracker_proposal_create', argsHash: 'a'.repeat(64), outcome: 'applied' });
await reconcileOutbox(store, { check: () => ({ outcome: 'applied' }) });
```
