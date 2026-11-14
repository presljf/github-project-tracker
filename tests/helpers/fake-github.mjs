/**
 * In-memory GitHub adapter for bootstrap tests. Mirrors the subset of GitHubCli
 * used by bootstrap; no network, no filesystem.
 */
let seq = 0;
const next = (prefix) => `${prefix}_${++seq}`;

export class FakeGitHub {
  constructor({ projects = [], fields = [], milestones = [], labels = [], issues = [], items = [] } = {}) {
    this.projects = structuredClone(projects);
    this.fields = structuredClone(fields);
    this.milestones = structuredClone(milestones);
    this.labels = structuredClone(labels);
    this.issues = structuredClone(issues);
    this.items = structuredClone(items);
    this.subIssues = new Map();
    this.mutations = [];
    this.calls = [];
  }

  async listProjects(owner) {
    this.calls.push(['listProjects', owner]);
    return structuredClone(this.projects);
  }

  async createProject(owner, title) {
    this.mutations.push(['createProject', title]);
    const project = { id: next('PVT'), number: this.projects.length + 1, title, owner };
    this.projects.push(project);
    return project;
  }

  async linkProject(owner, number, repo) {
    this.calls.push(['linkProject', owner, number, repo]);
    return {};
  }

  async listFields(owner, number) {
    this.calls.push(['listFields', owner, number]);
    return structuredClone(this.fields);
  }

  async createField(owner, number, name, options) {
    this.mutations.push(['createField', name, options]);
    const field = {
      id: next('FIELD'),
      name,
      dataType: 'SINGLE_SELECT',
      options: options.map((option) => ({ id: next('OPT'), name: option, color: 'BLUE' })),
    };
    this.fields.push(field);
    return structuredClone(field);
  }

  async updateFieldOptions(fieldId, optionNames) {
    this.mutations.push(['updateFieldOptions', fieldId, optionNames]);
    const field = this.fields.find((item) => item.id === fieldId);
    if (!field) throw new Error(`unknown field ${fieldId}`);
    const existing = new Map(field.options.map((option) => [option.name, option]));
    field.options = optionNames.map((entry) => {
      const spec = typeof entry === 'string' ? { name: entry } : entry;
      const current = existing.get(spec.name);
      if (current) {
        return {
          ...current,
          color: spec.color || current.color,
          description: spec.description ?? current.description,
        };
      }
      return {
        id: spec.id || next('OPT'),
        name: spec.name,
        color: spec.color || 'BLUE',
        description: spec.description || '',
      };
    });
    return structuredClone(field);
  }

  async listMilestones(owner, repo) {
    this.calls.push(['listMilestones', owner, repo]);
    return structuredClone(this.milestones);
  }

  async createMilestone(owner, repo, title, description) {
    this.mutations.push(['createMilestone', title]);
    const milestone = { number: this.milestones.length + 1, title, description, state: 'open' };
    this.milestones.push(milestone);
    return milestone;
  }

  async listLabels(owner, repo) {
    this.calls.push(['listLabels', owner, repo]);
    return structuredClone(this.labels);
  }

  async createLabel(owner, repo, name, color, description) {
    this.mutations.push(['createLabel', name]);
    const label = { name, color, description };
    this.labels.push(label);
    return label;
  }

  async findIssue(owner, repo, title) {
    this.calls.push(['findIssue', title]);
    const matches = this.issues.filter((issue) => issue.title === title);
    return structuredClone(matches.find((issue) => issue.state === 'OPEN') || matches[0] || null);
  }

  async createIssue(owner, repo, { title, body, milestone }) {
    this.mutations.push(['createIssue', title]);
    const issue = {
      number: this.issues.length + 1,
      title,
      body,
      milestone: milestone || null,
      state: 'OPEN',
      url: `https://github.com/${owner}/${repo}/issues/${this.issues.length + 1}`,
    };
    this.issues.push(issue);
    return structuredClone(issue);
  }

  async setIssueType(owner, repo, number, type) {
    this.mutations.push(['setIssueType', number, type]);
    const issue = this.issues.find((item) => item.number === number);
    if (issue) issue.type = type;
    return issue;
  }

  async getIssueView(owner, repo, number) {
    this.calls.push(['getIssueView', owner, repo, number]);
    const issue = this.issues.find((entry) => entry.number === number);
    if (!issue) return null;
    return {
      ...structuredClone(issue),
      url: issue.url || `https://github.com/${owner}/${repo}/issues/${number}`,
      state: issue.state || 'OPEN',
      labels: issue.labels || [],
      issueType: issue.issueType || (issue.type ? { name: issue.type } : null),
      body: issue.body || '',
    };
  }

  async updateIssueTitle(owner, repo, number, title) {
    this.mutations.push(['updateIssueTitle', number, title]);
    const issue = this.issues.find((entry) => entry.number === number);
    if (issue) issue.title = title;
    return issue;
  }

  async updateIssueBody(owner, repo, number, body) {
    this.mutations.push(['updateIssueBody', number, body]);
    const issue = this.issues.find((entry) => entry.number === number);
    if (issue) issue.body = body;
    return issue;
  }

  async removeLabels(owner, repo, number, labels = []) {
    this.mutations.push(['removeLabels', number, labels]);
    const issue = this.issues.find((entry) => entry.number === number);
    if (!issue) return null;
    issue.labels = (issue.labels || []).filter(
      (entry) => !labels.includes(typeof entry === 'string' ? entry : entry.name),
    );
    return issue;
  }

  async setIssueMilestone(owner, repo, number, milestone) {
    this.mutations.push(['setIssueMilestone', number, milestone]);
    const issue = this.issues.find((entry) => entry.number === number);
    if (issue) issue.milestone = { title: milestone };
    return issue;
  }

  async closeIssue(owner, repo, number, reason = 'not_planned') {
    this.mutations.push(['closeIssue', number, reason]);
    const issue = this.issues.find((entry) => entry.number === number);
    if (issue) issue.state = 'CLOSED';
    return issue;
  }

  async addComment(owner, repo, number, body) {
    this.mutations.push(['addComment', number, body]);
    this.comments = this.comments || {};
    this.comments[number] = this.comments[number] || [];
    this.comments[number].push(body);
    return { number };
  }

  async addLabels(owner, repo, number, labels = []) {
    this.mutations.push(['addLabels', number, labels]);
    const issue = this.issues.find((entry) => entry.number === number);
    if (!issue) return null;
    issue.labels = issue.labels || [];
    for (const label of labels) {
      if (!issue.labels.some((entry) => (entry.name || entry) === label)) issue.labels.push(label);
    }
    return issue;
  }

  async listIssues(owner, repo, options = 'all') {
    this.calls.push(['listIssues', owner, repo, options]);
    const state = typeof options === 'string' ? options : options.state || 'all';
    return structuredClone(
      this.issues.filter((issue) => state === 'all' || (issue.state || 'OPEN').toLowerCase() === state.toLowerCase()),
    );
  }

  async listSubIssues(owner, repo, parent) {
    this.calls.push(['listSubIssues', parent]);
    const children = this.subIssues.get(parent) || [];
    return children.map((number) => {
      const issue = this.issues.find((entry) => entry.number === number);
      return { number, state: issue?.state || 'OPEN' };
    });
  }

  async addSubIssue(owner, repo, parent, child) {
    this.mutations.push(['addSubIssue', parent, child]);
    const children = this.subIssues.get(parent) || [];
    if (!children.includes(child)) children.push(child);
    this.subIssues.set(parent, children);
    return { subIssue: { number: child } };
  }

  async listProjectItems(owner, number, options = {}) {
    this.calls.push(['listProjectItems', owner, number, options]);
    return structuredClone(this.items);
  }

  async addProjectItem(owner, number, url) {
    this.mutations.push(['addProjectItem', url]);
    const issueNumber = Number(String(url).split('/').pop());
    const issue = this.issues.find((item) => item.number === issueNumber);
    const item = {
      id: next('ITEM'),
      content: { number: issueNumber, title: issue?.title, url },
    };
    this.items.push(item);
    return structuredClone(item);
  }

  async setProjectItemField(projectId, itemId, fieldId, optionId) {
    this.mutations.push(['setProjectItemField', itemId, fieldId, optionId]);
    const item = this.items.find((entry) => entry.id === itemId);
    const field = this.fields.find((entry) => entry.id === fieldId);
    if (!item || !field) throw new Error('unknown item/field');
    const option = field.options.find((entry) => entry.id === optionId);
    if (!option) throw new Error('unknown option');
    item[field.name.toLowerCase()] = option.name;
    return item;
  }
}
