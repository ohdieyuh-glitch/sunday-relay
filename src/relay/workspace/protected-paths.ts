import { normalizeRepoPath } from '../coordination/claims';
import type { ProtectedPathPolicy, WorkspacePolicyInput } from './contracts';

/**
 * Protected-path and file-claim evaluation (Prompt 7) — PURE string logic,
 * no filesystem access. Matching is segment-safe (a rule for `secrets`
 * covers `secrets/prod.env` but never `secrets-archive.txt`); hostile
 * shapes (absolute, traversal, null bytes, backslash tricks) are rejected
 * by the same normalizer the claim system uses. Symlink resolution happens
 * in the Node inspection layer — this module classifies already-normalized
 * repository-relative paths.
 */

const segmentMatch = (rulePath: string, candidate: string): boolean =>
  candidate === rulePath || candidate.startsWith(`${rulePath}/`);

export interface NormalizedPathPolicy {
  forbidden: string[];
  readOnly: string[];
  claimedWritePaths: string[];
}

/** Normalize every policy path; invalid rule paths are a policy error. */
export function normalizePolicy(input: WorkspacePolicyInput): { ok: true; policy: NormalizedPathPolicy } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const normalizeAll = (paths: string[], label: string): string[] => {
    const out: string[] = [];
    for (const raw of paths) {
      const normalized = normalizeRepoPath(raw);
      if (!normalized.ok) errors.push(`${label} path "${raw}": ${normalized.error.message}`);
      else out.push(normalized.value);
    }
    return out;
  };
  const policy: NormalizedPathPolicy = {
    forbidden: normalizeAll(input.protectedPaths.forbidden, 'forbidden'),
    readOnly: normalizeAll(input.protectedPaths.readOnly, 'read-only'),
    claimedWritePaths: normalizeAll(input.claimedWritePaths, 'claimed'),
  };
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, policy };
}

export type PathClassification = 'protected' | 'claimed' | 'unclaimed' | 'invalid';

/** Classify one changed repository-relative path against the policy.
 * Protection wins over claims — a claim NEVER grants a protected write,
 * and claims are never expanded automatically. */
export function classifyChangedPath(raw: string, policy: NormalizedPathPolicy): { path: string; classification: PathClassification } {
  const normalized = normalizeRepoPath(raw);
  if (!normalized.ok) return { path: raw, classification: 'invalid' };
  const path = normalized.value;
  if (policy.forbidden.some((rule) => segmentMatch(rule, path))) return { path, classification: 'protected' };
  if (policy.readOnly.some((rule) => segmentMatch(rule, path))) return { path, classification: 'protected' };
  if (policy.claimedWritePaths.some((rule) => segmentMatch(rule, path))) return { path, classification: 'claimed' };
  return { path, classification: 'unclaimed' };
}

/** Baseline protection every Relay workspace enforces regardless of the
 * repository-specific policy input. */
export const BASELINE_FORBIDDEN_PATHS = ['.git'] as const;

export const withBaselineProtection = (policy: ProtectedPathPolicy): ProtectedPathPolicy => ({
  forbidden: [...new Set([...BASELINE_FORBIDDEN_PATHS, ...policy.forbidden])],
  readOnly: [...policy.readOnly],
});
