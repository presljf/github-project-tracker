import test from 'node:test';
import assert from 'node:assert/strict';
import {
  digestComments,
  digestMarker,
  isDigestComment,
  latestDigest,
  parseDigestMarker,
} from '../scripts/adopt/lib/comment-review.mjs';

test('digest is stable and marker comments are excluded', () => {
  const comments = [
    { id: 1, updated_at: '2026-01-01T00:00:00Z', body: 'one' },
    { id: 2, updated_at: '2026-01-02T00:00:00Z', body: 'two' },
  ];
  const first = digestComments(comments);
  assert.equal(first.count, 2);
  const marked = [...comments, { id: 3, updated_at: '', body: `### Check-in\n${digestMarker(first)}` }];
  assert.equal(isDigestComment(marked[2].body), true);
  assert.deepEqual(digestComments(marked), first);
  assert.deepEqual(latestDigest(marked), { count: first.count, latestId: first.latestId, hash: first.hash });
});

test('edited and deleted comments change the digest', () => {
  const base = [
    { id: 1, updated_at: '2026-01-01', body: 'one' },
    { id: 2, updated_at: '2026-01-02', body: 'two' },
  ];
  const hash = digestComments(base).hash;
  assert.notEqual(digestComments([{ ...base[0], body: 'edited' }, base[1]]).hash, hash);
  assert.notEqual(digestComments([base[0]]).hash, hash);
});

test('parses a digest marker', () => {
  const digest = { count: 2, latestId: 7, hash: 'a'.repeat(64) };
  const marker = digestMarker(digest);
  assert.deepEqual(parseDigestMarker(marker), digest);
  assert.equal(parseDigestMarker('no marker'), null);
});
