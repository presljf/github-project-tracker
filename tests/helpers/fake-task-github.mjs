import { FakeGitHub } from './fake-github.mjs';

/** Test adapter for task.mjs lifecycle commands. */
export class FakeTaskGitHub extends FakeGitHub {
  constructor(options = {}) {
    super(options);
    this.commentsByIssue = options.issueComments || {};
    this.issueDeps = options.issueDeps || {};
    this.pullRequests = options.pullRequests || {};
  }

  async getIssueView(owner, repo, number) {
    const issue = this.issues.find((entry) => entry.number === number);
    if (!issue) throw new Error(`unknown issue ${number}`);
    return {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      assignees: issue.assignees || [],
      milestone: issue.milestone ? { title: issue.milestone } : null,
      issueType: issue.type ? { name: issue.type } : null,
      body: issue.body || '',
      url: issue.url,
      labels: issue.labels || [],
    };
  }

  async issueComments(owner, repo, number) {
    return this.commentsByIssue[number] || [];
  }

  async addAssignee(owner, repo, number, login) {
    this.mutations.push(['addAssignee', number, login]);
    const issue = this.issues.find((entry) => entry.number === number);
    if (issue) issue.assignees = [...(issue.assignees || []), { login }];
    return {};
  }

  async addComment(owner, repo, number, body) {
    this.mutations.push(['addComment', number]);
    this.commentsByIssue[number] = [...(this.commentsByIssue[number] || []), body];
    return {};
  }

  async closeIssue(owner, repo, number) {
    this.mutations.push(['closeIssue', number]);
    const issue = this.issues.find((entry) => entry.number === number);
    if (issue) issue.state = 'CLOSED';
    return {};
  }

  async getPullRequest(owner, repo, number) {
    return structuredClone(this.pullRequests[number] || null);
  }

  async addBlockedBy(owner, repo, number, url) {
    this.mutations.push(['addBlockedBy', number, url]);
    return {};
  }

  async listIssues(owner, repo, state = 'all') {
    if (state === 'all') return structuredClone(this.issues);
    return structuredClone(this.issues.filter((issue) => issue.state === state.toUpperCase()));
  }

  async issueDependencies(owner, repo, number) {
    return this.issueDeps[number] || { blocked_by: 0 };
  }
}
