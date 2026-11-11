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
import { GitHubCli } from './lib/github.mjs';
import { parseArgs, UsageError } from './lib/cli.mjs';

export function issueKind(title) {
  if (/^\[(Program|Roadmap)\]/i.test(title)) return 'roadmap';
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
      status: item.status || '',
      release: item.release || '',
      sprint: item.sprint || '',
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
    map.set(Number(number), (list || []).map((comment) => (typeof comment === 'string' ? comment : comment.body || '')));
  }
  return map;
}

function normalizeSubIssues(subIssues) {
  const map = new Map();
  for (const [parent, list] of Object.entries(subIssues || {})) {
    map.set(Number(parent), (list || []).map((child) => child.number || child));
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

const REQUIRED_TASK_SECTIONS = [
  'why / context', 'current behavior', 'goal', 'non-goals', 'acceptance criteria',
  'test plan', 'verification evidence', 'dependencies / blockers', 'risks / rollback',
];

function missingTaskSections(body) {
  const headings = [...String(body || '').matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase());
  return REQUIRED_TASK_SECTIONS.filter((section) => !headings.some((heading) => heading === section || heading.startsWith(section)));
}

export function auditTracker({ config, data, strict = false }) {
  const violations = [];
  const warnings = [];
  const add = (code, issue, message) => violations.push({ code, issue: issue?.number ?? null, title: issue?.title || null, message });
  const issues = (data.issues || []).map(normalizeIssue);
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const items = normalizeItems(data.projectItems);
  const comments = normalizeComments(data.comments);
  const subIssues = normalizeSubIssues(data.subIssues);
  const dependencies = normalizeDependencies(data.dependencies);
  const parentOf = new Map();
  for (const [parent, children] of subIssues) for (const child of children) parentOf.set(child, parent);

  const hasCheckIn = (number) => (comments.get(number) || []).some((body) => /###\s*Check-in|Status\s*→\s*In Progress/i.test(body));
  const hasBlockerNote = (number) => (comments.get(number) || []).some((body) => /###\s*Blocker/i.test(body));
  const hasSprintExit = (number) => (comments.get(number) || []).some((body) => /###\s*Sprint (demo|close)|Status\s*→\s*Done/i.test(body));
  const hasReleaseExit = (number) => (comments.get(number) || []).some((body) => /###\s*Release close/i.test(body));

  if (!config.automation?.templateVersion) add('TEMPLATE_VERSION_MISSING', null, 'config.automation.templateVersion is required');

  const openTasksInProgress = [];
  for (const issue of issues) {
    const kind = issueKind(issue.title);
    if (issue.state !== 'OPEN') {
      if (kind === 'sprint' && !hasSprintExit(issue.number)) add('SPRINT_EXIT_EVIDENCE_MISSING', issue, 'closed sprint has no demo/exit evidence comment');
      if (kind === 'release' && !hasReleaseExit(issue.number)) add('RELEASE_EXIT_EVIDENCE_MISSING', issue, 'closed release has no close evidence comment');
      continue;
    }
    if (!issue.type) add('TYPE_MISSING', issue, 'open issue has no native type');
    if (kind !== 'roadmap' && !issue.milestone) add('MILESTONE_MISSING', issue, 'open release/sprint/task has no milestone');
    if (kind === 'task') {
      for (const section of missingTaskSections(issue.body)) {
        add('TASK_SECTION_MISSING', issue, `task body is missing required section: ## ${section}`);
      }
      let current = issue.number;
      const seen = new Set();
      let hasRelease = false;
      let hasSprint = false;
      while (parentOf.has(current) && !seen.has(current)) {
        seen.add(current);
        current = parentOf.get(current);
        const parent = issueByNumber.get(current);
        if (!parent) continue;
        const parentKind = issueKind(parent.title);
        if (parentKind === 'release') hasRelease = true;
        if (parentKind === 'sprint') hasSprint = true;
      }
      if (!hasRelease) add('TASK_HIERARCHY_MISSING_RELEASE', issue, 'open task has no release tracker ancestor');
      if (!hasSprint) add('TASK_HIERARCHY_MISSING_SPRINT', issue, 'open task has no sprint tracker ancestor');
    }
    if (issue.labels.some((name) => /^(area|release|sprint|type):/i.test(name))) {
      add('DUPLICATE_DIMENSION_LABEL', issue, 'dimension is represented by a field/type/milestone and a label');
    }
    const item = items.get(issue.number);
    if (!item) {
      add('PROJECT_ITEM_MISSING', issue, 'open issue is not on the configured project');
    } else {
      for (const field of ['Area', 'Kind', 'Estimate']) {
        if (!item[field.toLowerCase()]) add(`FIELD_${field.toUpperCase()}_MISSING`, issue, `project field ${field} is empty`);
      }
      if (kind !== 'roadmap' && !item.release) add('FIELD_RELEASE_MISSING', issue, 'release field is empty');
      if ((kind === 'sprint' || kind === 'task') && !item.sprint) add('FIELD_SPRINT_MISSING', issue, 'sprint field is empty');
      if (issue.labels.includes('source:downstream') && !item.source) add('FIELD_SOURCE_MISSING', issue, 'downstream issue has no Source field');
      if (item.status === 'Blocked') {
        const blockedBy = dependencies.get(issue.number) || 0;
        if (!blockedBy && !hasBlockerNote(issue.number)) add('BLOCKED_WITHOUT_DEPENDENCY', issue, 'Blocked item has no dependency or blocker comment');
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
    if (openChildren.length) add('PARENT_DONE_OPEN_CHILDREN', issue, `closed parent has open children: ${openChildren.join(', ')}`);
  }

  // WIP limit.
  const byOwner = new Map();
  for (const issue of openTasksInProgress) {
    const owner = issue.assignees[0] || '(unassigned)';
    byOwner.set(owner, [...(byOwner.get(owner) || []), issue]);
  }
  for (const [owner, list] of byOwner) {
    if (list.length > 1) violations.push({ code: 'WIP_LIMIT_EXCEEDED', issue: null, title: null, message: `${owner} has ${list.length} In Progress tasks: ${list.map((issue) => `#${issue.number}`).join(', ')}` });
  }

  const result = {
    ok: violations.length === 0,
    strict: Boolean(strict),
    checked: { issues: issues.length, projectItems: items.size },
    violations,
    warnings,
    templateVersion: config.automation?.templateVersion || null,
    repository: config.repository,
  };
  return result;
}

export async function collectAuditData(github, config) {
  if (!config.project?.number) throw new Error('config.project.number is required for audit');
  const [repoOwner, repoName] = config.repository.split('/');
  const owner = config.project.owner || repoOwner;
  const issues = await github.listIssues(repoOwner, repoName, 'all');
  const projectItems = await github.listProjectItems(owner, config.project.number);
  const comments = {};
  const subIssues = {};
  const dependencies = {};
  const numbers = issues.map((issue) => issue.number);
  const activity = typeof github.batchIssueActivity === 'function'
    ? await github.batchIssueActivity(repoOwner, repoName, numbers)
    : null;
  for (const raw of issues) {
    const issue = normalizeIssue(raw);
    comments[issue.number] = activity?.comments?.[issue.number] ?? await github.issueComments(repoOwner, repoName, issue.number);
    subIssues[issue.number] = activity?.subIssues?.[issue.number] ?? await github.listSubIssues(repoOwner, repoName, issue.number);
    if (issue.state === 'OPEN') dependencies[issue.number] = await github.issueDependencies(repoOwner, repoName, issue.number);
  }
  return { issues, projectItems, comments, subIssues, dependencies };
}

function usage() {
  return [
    'Usage: node scripts/github/audit.mjs --config tracker.config.json [--advisory|--strict] [--json]',
    '',
    'Default: advisory (exit 0, violations printed).',
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
      const data = await collectAuditData(new GitHubCli(), config);
      const result = auditTracker({ config, data, strict: Boolean(args.strict) });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        console.log(`Tracker audit — ${result.repository} (${result.strict ? 'strict' : 'advisory'})`);
        console.log(`Checked ${result.checked.issues} issues / ${result.checked.projectItems} project items; template ${result.templateVersion || 'MISSING'}.`);
        if (result.violations.length) {
          console.log(`Violations (${result.violations.length}):`);
          for (const violation of result.violations) console.log(`- [${violation.code}] ${violation.issue ? `#${violation.issue} ` : ''}${violation.message}`);
        } else {
          console.log('No violations.');
        }
        for (const warning of result.warnings) console.log(`warning: ${warning}`);
      }
      if (args.strict && !result.ok) process.exitCode = 1;
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
