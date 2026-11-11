#!/usr/bin/env node
/** Print the current GitHub GraphQL budget from response headers. */
import { GitHubCli } from './lib/github.mjs';
try {
  const gh = new GitHubCli();
  const status = gh.rateLimitStatus();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(status, null, 2) + '\n');
  } else {
    console.log(`GitHub ${status.resource} budget: ${status.remaining}/${status.limit} remaining, ${status.used} used; resets ${status.resetAt}`);
    if (status.remaining <= 0) console.error('Budget exhausted; wait for reset before mutating.');
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
