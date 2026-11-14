/** Comment-review digest: record that all task comments were fetched and reviewed. */
import crypto from 'node:crypto';

export const COMMENT_DIGEST_PREFIX = '<!-- tracker-comment-digest ';

export function isDigestComment(body = '') {
  return String(body || '').includes(COMMENT_DIGEST_PREFIX);
}

/** Stable digest over non-marker comments. Id/updated_at/body changes all change the digest. */
export function digestComments(comments = []) {
  const reviewed = (comments || [])
    .map((comment, index) =>
      typeof comment === 'string'
        ? { id: index + 1, updatedAt: '', body: comment }
        : {
            id: Number(comment.id ?? 0),
            updatedAt: String(comment.updated_at ?? comment.updatedAt ?? ''),
            body: String(comment.body ?? ''),
          },
    )
    .filter((comment) => !isDigestComment(comment.body))
    .sort((a, b) => a.id - b.id);
  const material = reviewed.map((comment) => `${comment.id}\0${comment.updatedAt}\0${comment.body}`).join('\n');
  return {
    count: reviewed.length,
    latestId: reviewed.length ? reviewed[reviewed.length - 1].id : 0,
    latestUpdatedAt: reviewed.length ? reviewed[reviewed.length - 1].updatedAt : '',
    hash: crypto.createHash('sha256').update(material).digest('hex'),
  };
}

export function digestMarker(digest) {
  return `${COMMENT_DIGEST_PREFIX}count=${digest.count} latest=${digest.latestId} hash=${digest.hash} -->`;
}

export function parseDigestMarker(body = '') {
  const text = String(body || '');
  const start = text.indexOf(COMMENT_DIGEST_PREFIX);
  if (start < 0) return null;
  const end = text.indexOf('-->', start);
  const value = end < 0 ? text.slice(start) : text.slice(start, end);
  const count = Number(/count=(\d+)/.exec(value)?.[1] || 0);
  const latest = Number(/latest=(\d+)/.exec(value)?.[1] || 0);
  const hash = /hash=([a-f0-9]{64})/i.exec(value)?.[1] || null;
  return hash ? { count, latestId: latest, hash } : null;
}

export function latestDigest(comments = []) {
  let found = null;
  for (const comment of comments || []) {
    const body = typeof comment === 'string' ? comment : comment?.body;
    found = parseDigestMarker(body) || found;
  }
  return found;
}
