# ACTIONS CATALOG

## 2. Workflow catalog

| Workflow | Notes |
|---|---|
| `demo.yml` | internal runner |
| `release.yml` | runnable release caller |
| `reusable-demo.yml` | reusable contract |

## 7. Reusable workflow and composite action contracts

| Item | Convention |
|---|---|
| Composite action | `.github/actions/<name>/action.yml` |

### 7.1 reusable-demo contract

Demo `reusable-demo.yml` contract.

### 7.8 Composite action interfaces

Dashboards for `action.yml` composite actions.

## 8. Hybrid D adoption model

**Shipped vs contract-only:** shipped: `demo.yml`/`reusable-demo.yml`, `release.yml` (the only runnable caller), composite actions. Contract-only: `setup-node-cache` (cache setup is inlined in `reusable-demo.yml`).
