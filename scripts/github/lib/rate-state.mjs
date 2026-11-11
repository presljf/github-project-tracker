import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultRateStatePath() {
  return process.env.TRACKER_RATE_STATE || path.join(os.homedir(), '.cache', 'tracker-os', 'rate-limit.json');
}

export class RateState {
  constructor({ path: statePath = defaultRateStatePath(), now = Date.now, historyLimit = 100 } = {}) {
    this.path = statePath;
    this.now = now;
    this.historyLimit = historyLimit;
  }

  read() {
    try {
      const state = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      return { version: 1, resources: {}, history: [], ...state };
    } catch {
      return { version: 1, resources: {}, history: [] };
    }
  }

  write(state) {
    fs.mkdirSync(path.dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.path);
  }

  record({ resource = 'graphql', limit, remaining, used, resetEpoch, resetAt, cost = 1, command = 'unknown' } = {}) {
    const state = this.read();
    const previous = state.resources[resource];
    const sameWindow = previous && resetEpoch && previous.resetEpoch === resetEpoch;
    state.resources[resource] = {
      resource,
      limit: Number(limit ?? previous?.limit ?? 0),
      remaining: sameWindow ? Math.min(Number(previous.remaining), Number(remaining)) : Number(remaining ?? previous?.remaining ?? 0),
      used: Number(used ?? previous?.used ?? 0),
      resetEpoch: Number(resetEpoch ?? previous?.resetEpoch ?? 0),
      resetAt: resetAt || previous?.resetAt || null,
      updatedAt: new Date(this.now()).toISOString(),
    };
    state.history = [...(state.history || []), { at: new Date(this.now()).toISOString(), resource, cost, command }].slice(-this.historyLimit);
    this.write(state);
    return state;
  }

  consume(cost = 1, command = 'unknown', resource = 'graphql') {
    const state = this.read();
    const current = state.resources[resource];
    if (!current) return state;
    current.remaining = Math.max(0, Number(current.remaining) - Number(cost));
    current.updatedAt = new Date(this.now()).toISOString();
    state.history = [...(state.history || []), { at: new Date(this.now()).toISOString(), resource, cost: Number(cost), command }].slice(-this.historyLimit);
    this.write(state);
    return state;
  }

  waitMs(resource = 'graphql') {
    const current = this.read().resources[resource];
    if (!current?.resetEpoch) return 0;
    return Math.max(0, current.resetEpoch * 1000 - this.now());
  }

  report() {
    const state = this.read();
    const byCommand = {};
    for (const entry of state.history || []) byCommand[entry.command] = (byCommand[entry.command] || 0) + Number(entry.cost || 0);
    return {
      path: this.path,
      resources: state.resources,
      topCommands: Object.entries(byCommand).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([command, cost]) => ({ command, cost })),
    };
  }
}
