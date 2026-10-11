/**
 * WONDERFS — canonical JSON and the commit hash chain (§9.2, INV-6).
 *
 * `commitHash = sha256(canonical JSON of the commit without commitHash)`, and every commit names the previous commit's hash,
 * so editing any stored commit (its ops, its author, its resulting states) is detectable by re-hashing the chain
 * (`verifyWfsChain`). Canonical = object keys sorted by code unit, no whitespace, `undefined` members omitted, numbers only
 * if finite. The sha256 itself is injected (the domain has no hashing library).
 */

import type { WfsCommit } from './wonderfs-contracts';

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalJson: a number must be finite');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: cannot encode a ${typeof value}`);
  }
}

/**
 * r1.2 §19.M7: `main`'s genesis anchor = sha256 of the JCS of {project_id, genesis: "wonderfs.v1"}. A branch's first commit
 * links to its parent's commit hash at the fork (or to this anchor when the parent had no commit yet), so every chain is
 * anchored to `main`. `canonicalJson` is RFC 8785 for the values a commit holds: keys sorted by UTF-16 code units (the
 * default sort), ECMAScript string escaping (non-ASCII raw), finite numbers only, no whitespace.
 */
export function wfsGenesisHash(projectId: string, sha256Hex: (text: string) => string): string {
  return sha256Hex(canonicalJson({ project_id: projectId, genesis: 'wonderfs.v1' }));
}

/** What a commit's hash covers: every field but the hash itself. */
export function wfsCommitHashInput(commit: Omit<WfsCommit, 'commitHash'> | WfsCommit): string {
  const { commitHash: _omitted, ...body } = commit as WfsCommit;
  return canonicalJson(body);
}

export interface WfsChainBreak {
  readonly rev: number;
  readonly reason: 'hash' | 'link' | 'rev';
}

/**
 * Re-hash a branch's commits in order. Returns the FIRST break, or `null` when every commit re-hashes to its stored hash,
 * links to its predecessor, and holds the next revision. `anchor` is what the FIRST commit must link to (r1.2 §19.M7):
 * `main`'s genesis hash, or the parent's commit hash at the fork.
 */
export function verifyWfsChain(commits: readonly WfsCommit[], sha256Hex: (text: string) => string, anchor: string): WfsChainBreak | null {
  let prev: string | null = anchor;
  for (let i = 0; i < commits.length; i += 1) {
    const c = commits[i];
    if (c.rev !== i + 1) return { rev: c.rev, reason: 'rev' };
    if (c.prevCommitHash !== prev) return { rev: c.rev, reason: 'link' };
    if (sha256Hex(wfsCommitHashInput(c)) !== c.commitHash) return { rev: c.rev, reason: 'hash' };
    prev = c.commitHash;
  }
  return null;
}
