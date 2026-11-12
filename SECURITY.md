# Security Policy

**Publication status:** this repository is a **public template repository**; the current publication and security settings are recorded in [docs/PUBLICATION.md](./docs/PUBLICATION.md).

## Supported versions

The template/Project Tracker OS is supported at the latest released `v1.0.x` line. Downstream projects are responsible for their own product security policies and dependency updates.

| Version | Supported |
|---|---|
| `v1.0.x` (latest patch, currently `v1.2.0`) | :white_check_mark: |
| earlier/untagged snapshots | :x: |

## Reporting a vulnerability

**Do not open a public issue, discussion, or PR containing vulnerability details, secrets, or exploit steps.**

**GitHub private vulnerability reporting is enabled on this repository.** Use it as the primary channel:

1. Open the **Security** tab → **Report a vulnerability**, or go directly to <https://github.com/presljf/github-project-tracker/security/advisories/new>.
2. If GitHub private reporting is unavailable to you, contact the maintainer through the private channel established for the project — do not fall back to a public issue.

Include affected version/commit, environment, reproduction steps, impact, and any suggested mitigation. Do not include live secrets or personal data. Reports and advisories stay private until coordinated disclosure.

## What to expect

Best-effort acknowledgement and triage; no SLA. Accepted reports are fixed on a supported line with coordinated disclosure as appropriate. Reports about a downstream product's vulnerabilities should go to that product's own security policy, not this tracker template.

## Scope

This policy covers the tracker template, reusable workflows/actions, scripts, config schema, and documentation in this repository. It does not cover third-party services or downstream project code.

## Related

- [Publication and security checklist](./docs/PUBLICATION.md)
- [Downstream feedback](./docs/DOWNSTREAM_FEEDBACK.md)
- [Support](./SUPPORT.md)
