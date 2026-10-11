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
 * links to its predecessor, and holds the next revision.
 */
export function verifyWfsChain(commits: readonly WfsCommit[], sha256Hex: (text: string) => string): WfsChainBreak | null {
  let prev: string | null = null;
  for (let i = 0; i < commits.length; i += 1) {
    const c = commits[i];
    if (c.rev !== i + 1) return { rev: c.rev, reason: 'rev' };
    if (c.prevCommitHash !== prev) return { rev: c.rev, reason: 'link' };
    if (sha256Hex(wfsCommitHashInput(c)) !== c.commitHash) return { rev: c.rev, reason: 'hash' };
    prev = c.commitHash;
  }
  return null;
}
