/**
 * Proposal/backlog contract for TrackerOS.
 *
 * A proposal is not a delivery task: it is board-managed intake that becomes a task only when
 * accepted. Proposals use a [Proposal] title, the Feature issue type, the status:proposed label,
 * and the Proposed board status. They are exempt from Release/Sprint/Stream, milestone, task
 * sections, and task hierarchy, but must be on the project with Area/Kind/Estimate/Source.
 */

export const PROPOSAL_PREFIX = '[Proposal] ';
export const PROPOSAL_LABEL = 'status:proposed';
export const PROPOSAL_STATUS = 'Proposed';
export const PROPOSAL_DEFERRED_STATUS = 'Deferred';
export const PROPOSAL_DEFERRED_LABEL = 'status:deferred';
export const PROPOSAL_TYPE = 'Feature';

export const PROPOSAL_SECTIONS = [
  'problem / context',
  'proposal',
  'value',
  'scope',
  'non-goals',
  'dependencies / blockers',
  'decision needed',
  'acceptance when accepted',
];

/** True when a title is in the proposal namespace. */
export function isProposalTitle(title = '') {
  return /^\[Proposal\]\s+/i.test(String(title || ''));
}

/** Idempotently add the proposal title prefix. */
export function toProposalTitle(title = '') {
  const text = String(title || '').trim();
  if (isProposalTitle(text)) return text;
  return `${PROPOSAL_PREFIX}${text}`;
}

/** Headings present in the body, normalized for matching. */
/** Extract one proposal section body. */
export function proposalSection(body = '', name = '') {
  const wanted = String(name || '')
    .trim()
    .toLowerCase();
  const match = new RegExp(
    `^##\\s*${wanted.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=^##\\s|\\Z)`,
    'im',
  ).exec(String(body || ''));
  return match ? match[1].trim() : '';
}

export function proposalHeadings(body = '') {
  return [...String(body || '').matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim().toLowerCase());
}

/** Proposal sections missing from the body. Empty means valid. */
export function missingProposalSections(body = '') {
  const headings = proposalHeadings(body);
  return PROPOSAL_SECTIONS.filter(
    (section) => !headings.some((heading) => heading === section || heading.startsWith(section)),
  );
}

/** Standard proposal body. Keep this in sync with docs/proposal-template.md. */
export function proposalTemplate() {
  return `## Problem / context

## Proposal

## Value

## Scope

## Non-goals

## Dependencies / blockers

## Decision needed

## Acceptance when accepted
`;
}
