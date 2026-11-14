#!/usr/bin/env node
/**
 * Tracker audit: read-only invariant checks against a configured GitHub tracker.
 *
 * Default is advisory (exit 0 with violations printed). --strict exits 1 on violations,
 * intended for release gates once the tracker is stable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-config.mjs';
import { createGitHub } from '../lib/github.mjs';
import { parseArgs, UsageError } from '../lib/cli.mjs';
import { pullClosesIssue } from '../lib/pr-link.mjs';
import {
  missingProposalSections,
  PROPOSAL_DEFERRED_STATUS,
  PROPOSAL_LABEL,
  PROPOSAL_STATUS,
} from '../lib/proposal.mjs';
import {
  closedEvidenceRules,
  fieldMissingCode,
  getWorkProfileAdapter,
  requiredItemFields,
  requiresMilestone,
  taskAncestryRequirements,
} from '../lib/work-profile.mjs';

export function issueKind(title) {
  if (/^\[Proposal\]\s+/i.test(title)) return 'proposal';
  if (/^\[(Program|Roadmap)\]/i.test(title)) return 'roadmap';
  if (/^\[Stream\]/i.test(title)) return 'stream';
  if (/^\[Release\]/i.test(title) || /^\[v?\d+\.\d+\.\d+\]\s*Release\b/i.test(title)) return 'release';
  if (/^\[Sprint\]/i.test(title) || /^\[\d+\.\d+\.\d+\.\d+\]\s*Sprint\b/i.test(title)) return 'sprint';
  return 'task';
}

function normalizeIssue(issue) {
  return {
    number: issue.number,
    title: issue.title || '',
    state: String(issue.state || '').toUpperCase(),
    type: issue.issueType?.name || issue.type || null,
    assignees: (issue.assignees || []).map((entry) => entry.login || entry),
    labels: (issue.labels || []).map((entry) => entry.name || entry),
    milestone: issue.milestone?.title || issue.milestone || null,
    url: issue.url || null,
    body: issue.body || '',
  };
}

function normalizeItems(items) {
  const map = new Map();
  for (const item of items || []) {
    const number = item.content?.number;
    if (!number) continue;
    map.set(number, {
      id: item.id || null,
      repository: item.content?.repository || item.repository || null,
      status: item.status || '',
      release: item.release || '',
      sprint: item.sprint || '',
      stream: item.stream || '',
      area: item.area || '',
      kind: item.kind || '',
      estimate: item.estimate || '',
      source: item.source || '',
    });
  }
  return map;
}

function normalizeComments(comments) {
  const map = new Map();
  for (const [number, list] of Object.entries(comments || {})) {
    map.set(
      Number(number),
      (list || []).map((comment) => (typeof comment === 'string' ? comment : comment.body || '')),
    );
  }
  return map;
}

/** Extract the PR recorded in a task's check-out comment. */
export function checkoutPrFromComments(comments = []) {
  const list = (comments || []).map((comment) => (typeof comment === 'string' ? comment : comment.body || ''));
  for (const body of list) {
    const match = /- \*\*PR:\*\*\s*https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/i.exec(body);
    if (match) return { number: Number(match[1]), url: match[0].replace(/^- \*\*PR:\*\*\s*/i, '') };
  }
  return null;
}

function normalizePrLinks(prLinks) {
  if (!prLinks) return null;
  if (prLinks instanceof Map) return prLinks;
  return new Map(Object.entries(prLinks).map(([number, link]) => [Number(number), link]));
}

function normalizeSubIssues(subIssues) {
  const map = new Map();
  for (const [parent, list] of Object.entries(subIssues || {})) {
    map.set(
      Number(parent),
      (list || []).map((child) => child.number || child),
    );
  }
  return map;
}

function normalizeDependencies(dependencies) {
  const map = new Map();
  for (const [number, summary] of Object.entries(dependencies || {})) {
    map.set(Number(number), Number(summary?.blocked_by ?? summary?.blockedBy ?? 0));
  }
  return map;
}

const DONE_STATUS = 'Done';

const REQUIRED_TASK_SECTIONS = [
  'why / context',
  'current behavior',
  'goal',
  'non-goals',
  'acceptance criteria',
  'test plan',
  'verification evidence',
  'dependencies / blockers',
  'risks / rollback',
];

function missingTaskSections(body) {
  const headings = [...String(body || '').matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase());
  return REQUIRED_TASK_SECTIONS.filter(
    (section) => !headings.some((heading) => heading === section || heading.startsWith(section)),
  );
}

/**
 * Reverse parent index + ancestor-kind lookup shared by the audit and the Project-status
 * reconciliation plan (`projectStatusDrift`), so the read-only rule and the repair command cannot
 * disagree about the hierarchy they walk.
 */
function ancestryLookup({ issues, subIssues }) {
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const parentOf = new Map();
  for (const [parent, children] of subIssues) for (const child of children) parentOf.set(child, parent);
  const ancestorKindsCache = new Map();
  const ancestorKindsFor = (number) => {
    if (ancestorKindsCache.has(number)) return ancestorKindsCache.get(number);
    const kinds = new Set();
    let current = number;
    const seen = new Set();
    while (parentOf.has(current) && !seen.has(current)) {
      seen.add(current);
      current = parentOf.get(current);
      const parent = issueByNumber.get(current);
      if (parent) kinds.add(issueKind(parent.title));
    }
    ancestorKindsCache.set(number, kinds);
    return kinds;
  };
  return { parentOf, ancestorKindsFor };
}

export function auditTracker({ config, data, strict = false }) {
  const violations = [];
  const warnings = [];
  const add = (code, issue, message) =>
    violations.push({ code, issue: issue?.number ?? null, title: issue?.title || null, message });
  const profile = getWorkProfileAdapter(config);
  const issues = (data.issues || []).map(normalizeIssue);
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const items = normalizeItems(data.projectItems);
  const comments = normalizeComments(data.comments);
  const prLinks = normalizePrLinks(data.prLinks);
  const subIssues = normalizeSubIssues(data.subIssues);
  const dependencies = normalizeDependencies(data.dependencies);
  const { ancestorKindsFor } = ancestryLookup({ issues, subIssues });
  const evidenceRules = closedEvidenceRules(profile);
  const ancestryRequirements = taskAncestryRequirements(profile);
  const prLinkExceptions = new Set(
    (config.guard?.taskPrLinkExceptions || []).map((entry) => Number(entry.issue ?? entry)),
  );

  const hasCheckIn = (number) =>
    (comments.get(number) || []).some((body) => /###\s*Check-in|Status\s*→\s*In Progress/i.test(body));
  const hasBlockerNote = (number) => (comments.get(number) || []).some((body) => /###\s*Blocker/i.test(body));
  const hasEvidence = (number, pattern) => (comments.get(number) || []).some((body) => pattern.test(body));

  if (!config.automation?.templateVersion)
    add('TEMPLATE_VERSION_MISSING', null, 'config.automation.templateVersion is required');

  const openTasksInProgress = [];
  for (const issue of issues) {
    const kind = issueKind(issue.title);
    if (issue.state !== 'OPEN') {
      for (const rule of evidenceRules) {
        if (!rule.kinds.includes(kind)) continue;
        if (rule.requiresStreamAncestry && !ancestorKindsFor(issue.number).has('stream')) continue;
        if (!hasEvidence(issue.number, rule.pattern)) add(rule.code, issue, rule.message);
      }
      if (prLinks && kind === 'task' && !prLinkExceptions.has(issue.number)) {
        const recorded = checkoutPrFromComments(comments.get(issue.number));
        if (recorded) {
          const link = prLinks.get(issue.number);
          if (!link) add('TASK_PR_UNVERIFIED', issue, `recorded PR #${recorded.number} was not fetched for audit`);
          else if (String(link.state || '').toUpperCase() !== 'MERGED')
            add('TASK_PR_NOT_MERGED', issue, `recorded PR #${recorded.number} is not merged`);
          else {
            if (!pullClosesIssue(link, issue.number))
              add(
                'TASK_PR_LINK_MISSING',
                issue,
                `recorded PR #${recorded.number} does not close #${issue.number} (add Closes #${issue.number})`,
              );
          }
        }
      }
      continue;
    }
    if (!issue.type) add('TYPE_MISSING', issue, 'open issue has no native type');
    if (requiresMilestone(profile, kind) && !issue.milestone)
      add('MILESTONE_MISSING', issue, 'open release/sprint/task has no milestone');
    if (kind === 'task') {
      for (const section of missingTaskSections(issue.body)) {
        add('TASK_SECTION_MISSING', issue, `task body is missing required section: ## ${section}`);
      }
      const ancestorKinds = ancestorKindsFor(issue.number);
      for (const requirement of ancestryRequirements) {
        if (!ancestorKinds.has(requirement.kind))
          add(requirement.code, issue, `open task has no ${requirement.noun} tracker ancestor`);
      }
    }
    if (kind === 'proposal') {
      if (!issue.labels.includes(PROPOSAL_LABEL))
        add('PROPOSAL_LABEL_MISSING', issue, `proposal is missing label ${PROPOSAL_LABEL}`);
      for (const section of missingProposalSections(issue.body)) {
        add('PROPOSAL_SECTION_MISSING', issue, `proposal body is missing required section: ## ${section}`);
      }
    }
    // Hierarchy integrity: an open product sprint must sit under a [Release] ancestor. Its child
    // tasks can carry a sprint ancestor while the sprint itself is orphaned (the #137 incident);
    // closed/historical sprints are exempt and the tooling profile has no release container.
    if (!profile.isTooling && kind === 'sprint' && !ancestorKindsFor(issue.number).has('release')) {
      add('SPRINT_HIERARCHY_MISSING_RELEASE', issue, 'open sprint has no release tracker ancestor');
    }
    if (issue.labels.some((name) => /^(area|release|sprint|type):/i.test(name))) {
      add('DUPLICATE_DIMENSION_LABEL', issue, 'dimension is represented by a field/type/milestone and a label');
    }
    const item = items.get(issue.number);
    if (!item) {
      add('PROJECT_ITEM_MISSING', issue, 'open issue is not on the configured project');
    } else {
      for (const field of requiredItemFields(profile, kind)) {
        if (!item[field.toLowerCase()]) add(fieldMissingCode(profile, field), issue, `project field ${field} is empty`);
      }
      if (kind === 'proposal' && ![PROPOSAL_STATUS, PROPOSAL_DEFERRED_STATUS].includes(item.status))
        add(
          'PROPOSAL_STATUS_MISSING',
          issue,
          `proposal project status is ${JSON.stringify(item.status || '')}; expected ${PROPOSAL_STATUS} or ${PROPOSAL_DEFERRED_STATUS}`,
        );
      if (issue.labels.includes('source:downstream') && !item.source)
        add('FIELD_SOURCE_MISSING', issue, 'downstream issue has no Source field');
      if (item.status === 'Blocked') {
        const blockedBy = dependencies.get(issue.number) || 0;
        if (!blockedBy && !hasBlockerNote(issue.number))
          add('BLOCKED_WITHOUT_DEPENDENCY', issue, 'Blocked item has no dependency or blocker comment');
      }
    }
    if (kind === 'task' && item?.status === 'In Progress') {
      openTasksInProgress.push(issue);
      if (!issue.assignees.length) add('IN_PROGRESS_NO_ASSIGNEE', issue, 'In Progress task has no assignee');
      if (!hasCheckIn(issue.number)) add('IN_PROGRESS_NO_CHECKIN', issue, 'In Progress task has no check-in comment');
    }
  }

  // Parent Done with open children.
  for (const issue of issues) {
    if (issue.state !== 'CLOSED') continue;
    const children = subIssues.get(issue.number) || [];
    const openChildren = children.filter((number) => issueByNumber.get(number)?.state === 'OPEN');
    if (openChildren.length)
      add('PARENT_DONE_OPEN_CHILDREN', issue, `closed parent has open children: ${openChildren.join(', ')}`);
  }

  // WIP limit.
  const byOwner = new Map();
  for (const issue of openTasksInProgress) {
    const owner = issue.assignees[0] || '(unassigned)';
    byOwner.set(owner, [...(byOwner.get(owner) || []), issue]);
  }
  for (const [owner, list] of byOwner) {
    if (list.length > 1)
      violations.push({
        code: 'WIP_LIMIT_EXCEEDED',
        issue: null,
        title: null,
        message: `${owner} has ${list.length} In Progress tasks: ${list.map((issue) => `#${issue.number}`).join(', ')}`,
      });
  }

  // Advisory (non-blocking): closed project items left in a non-Done status. The Project Status
  // field is per-item metadata and is NOT updated when a `Closes #N` keyword closes the issue at
  // merge time, so the closing session must reconcile it. Warnings never affect `ok`/`--strict`
  // exit behaviour; `reconcile-status.mjs` reuses this same plan to repair the drift.
  warnings.push(...projectStatusDrift({ config, data }));

  const result = {
    ok: violations.length === 0,
    strict: Boolean(strict),
    workProfile: profile.name,
    checked: { issues: issues.length, projectItems: items.size },
    violations,
    warnings,
    templateVersion: config.automation?.templateVersion || null,
    repository: config.repository,
  };
  return result;
}

/**
 * Closed project items whose Project Status is not `Done` — the drift left behind when a completion
 * PR closes an issue with `Closes #N` before the `task.mjs done` path can run (that path refuses
 * closed issues). Advisory: `auditTracker` surfaces these as `warnings` (never blocking, even under
 * `--strict`); `reconcile-status.mjs` reuses the same plan to repair them.
 *
 * Scope: items that are on the configured project. There is no profile gate and no historical
 * record exemption here — unlike delivery evidence (see the T06 `requiresStreamAncestry`
 * precedent), Project Status is current-state board metadata, not a historical record, so any
 * closed on-project item left in a non-Done status is drift (including the #116 product-era task
 * that motivated this rule). Closed items that were never added to the project are out of scope.
 */
export function projectStatusDrift({ config, data }) {
  const issues = (data.issues || []).map(normalizeIssue);
  const items = normalizeItems(data.projectItems);
  const expectedRepository = config.repository || null;
  const fix = 'npm run reconcile:status -- --config tracker.config.json --apply';
  const drift = [];
  for (const issue of issues) {
    if (issue.state !== 'CLOSED') continue;
    const item = items.get(issue.number);
    if (!item || item.status === DONE_STATUS) continue;
    // A project can host items from several repositories; never warn about or mutate another
    // repository's item (same issue number) on a shared project.
    if (expectedRepository && item.repository && item.repository !== expectedRepository) continue;
    const status = item.status || null;
    drift.push({
      code: 'PROJECT_STATUS_STALE',
      issue: issue.number,
      title: issue.title,
      status,
      itemId: item.id,
      fix,
      message: status
        ? `closed issue has Project status ${status} (expected Done)`
        : 'closed issue has no Project status (expected Done)',
    });
  }
  return drift.sort((a, b) => a.issue - b.issue);
}

export async function collectAuditData(github, config) {
  if (!config.project?.number) throw new Error('config.project.number is required for audit');
  const [repoOwner, repoName] = config.repository.split('/');
  const owner = config.project.owner || repoOwner;
  const issues = await github.listIssues(repoOwner, repoName, 'all');
  const projectItems = await github.listProjectItems(owner, config.project.number, { limit: 1000 });
  const comments = {};
  const subIssues = {};
  const dependencies = {};
  const numbers = issues.map((issue) => issue.number);
  const activity =
    typeof github.batchIssueActivity === 'function'
      ? await github.batchIssueActivity(repoOwner, repoName, numbers)
      : null;
  const dependencyBatch =
    typeof github.batchIssueDependencies === 'function'
      ? await github.batchIssueDependencies(repoOwner, repoName, numbers)
      : null;
  for (const raw of issues) {
    const issue = normalizeIssue(raw);
    comments[issue.number] =
      activity?.comments?.[issue.number] ?? (await github.issueComments(repoOwner, repoName, issue.number));
    subIssues[issue.number] =
      activity?.subIssues?.[issue.number] ?? (await github.listSubIssues(repoOwner, repoName, issue.number));
    if (issue.state === 'OPEN') {
      dependencies[issue.number] =
        dependencyBatch?.[issue.number] ?? (await github.issueDependencies(repoOwner, repoName, issue.number));
    }
  }
  const prLinks = {};
  if (typeof github.getPullRequest === 'function') {
    for (const raw of issues) {
      const issue = normalizeIssue(raw);
      if (issue.state === 'OPEN' || issueKind(issue.title) !== 'task') continue;
      const recorded = checkoutPrFromComments(comments[issue.number]);
      if (!recorded) continue;
      try {
        const pull = await github.getPullRequest(repoOwner, repoName, recorded.number);
        if (pull) prLinks[issue.number] = pull;
      } catch (error) {
        prLinks[issue.number] = { error: error?.message || String(error) };
      }
    }
  }
  return { issues, projectItems, comments, subIssues, dependencies, prLinks };
}

function usage() {
  return [
    'Usage: node scripts/adopt/cli/audit.mjs --config tracker.config.json [--advisory|--strict] [--json]',
    '',
    'Default: advisory (exit 0, violations printed).',
    'Warnings (e.g. PROJECT_STATUS_STALE) are always advisory and never change the exit code.',
    'Invariants follow config.workProfile: "product" (default; Release → Sprint → Task) or',
    '"tooling" ([Stream] → Task; Stream field and stream close evidence).',
    '  --strict    Exit 1 when any violation is found (release-gate mode)',
    '  --advisory  Explicit advisory mode (default)',
    '  --json      Machine-readable result',
    '  --help      Show this help',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    try {
      const args = parseArgs(process.argv.slice(2), {
        flags: ['strict', 'advisory', 'json', 'help'],
        options: ['config'],
      });
      if (args.help) {
        console.log(usage());
        return;
      }
      if (args.strict && args.advisory) throw new UsageError('use either --strict or --advisory, not both');
      const configPath = path.resolve(args.config || 'tracker.config.json');
      if (!fs.existsSync(configPath)) throw new UsageError(`config not found: ${configPath}`);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const errors = validateConfig(config);
      if (errors.length) throw new UsageError(`invalid config:\n- ${errors.join('\n- ')}`);
      const data = await collectAuditData(createGitHub(), config);
      const result = auditTracker({ config, data, strict: Boolean(args.strict) });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        console.log(`Tracker audit — ${result.repository} (${result.strict ? 'strict' : 'advisory'})`);
        console.log(
          `Checked ${result.checked.issues} issues / ${result.checked.projectItems} project items; template ${result.templateVersion || 'MISSING'}.`,
        );
        if (result.violations.length) {
          console.log(`Violations (${result.violations.length}):`);
          for (const violation of result.violations)
            console.log(`- [${violation.code}] ${violation.issue ? `#${violation.issue} ` : ''}${violation.message}`);
        } else {
          console.log('No violations.');
        }
        for (const warning of result.warnings) {
          if (typeof warning === 'string') console.log(`warning: ${warning}`);
          else
            console.log(
              `warning: [${warning.code || 'ADVISORY'}] ${warning.issue ? `#${warning.issue} ` : ''}${warning.message || ''}${warning.fix ? ` — fix: ${warning.fix}` : ''}`,
            );
        }
      }
      if (args.strict && !result.ok) process.exitCode = 1;
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
