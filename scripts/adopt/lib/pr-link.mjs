/** Parse closing keywords from a PR body. */
export function closingRefsFromBody(body = '') {
  return [...String(body || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi)].map((match) =>
    Number(match[1]),
  );
}

/**
 * True when the PR closes the issue either through GitHub's linked-issue field or its body.
 * The body fallback covers merged PRs whose issue was already closed before the backfill.
 */
export function pullClosesIssue(pull = {}, issueNumber) {
  const linked = (pull.closingIssuesReferences || []).map((entry) => Number(entry.number ?? entry));
  return linked.includes(Number(issueNumber)) || closingRefsFromBody(pull.body).includes(Number(issueNumber));
}
