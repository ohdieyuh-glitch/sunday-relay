import { describe, expect, it } from 'vitest';

import { planShipDryRun } from './ship-dry-run';
import {
  createRepositoryRegistration,
  resolveRepositoryTarget,
} from '../src/relay/mission/repository-target';
import type {
  MissionRepositoryTarget,
  PullRequestEvidence,
  RepositoryPermission,
  RepositoryRegistration,
} from '../src/relay/mission/repository-target';

/**
 * A PLAN IS READ BY SOMEONE DECIDING WHETHER TO AUTHORIZE THE MISSION.
 *
 * Nothing is performed, so an over-generous plan does no immediate damage — it
 * does the damage later, when a founder authorizes on the strength of it. These
 * hold the property that makes it safe: the plan is rendered from the LIVE
 * permission set, not the one captured when the target was resolved.
 */

const NOW = '2026-08-11T12:00:00.000Z';
const FULL: readonly RepositoryPermission[] = [
  'read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr',
];

const EVIDENCE: PullRequestEvidence = {
  missionId: 'mission-1',
  objective: 'Bump the version',
  artifactDigest: 'sha256:aaa',
  reviewedArtifactDigest: 'sha256:aaa',
  reviewerVerdict: 'approved',
  reviewerFindings: [],
  relayVerification: ['npm test passed'],
  attestations: [],
  baselineSha: 'b'.repeat(40),
};

function registration(permissions: readonly RepositoryPermission[] = FULL): RepositoryRegistration {
  const result = createRepositoryRegistration({
    draft: {
      identity: { provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' },
      location: { kind: 'local_path', path: '/tmp/does-not-need-to-exist' },
      scope: { read: ['**'], write: ['src/**'] },
      grants: permissions.map((permission) => ({
        permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
      })),
      ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
      /**
       * A registration granting remote operations MUST name where the
       * credential comes from — the domain refuses otherwise, which is why
       * this fixture carries it. The NAME travels; the value never does.
       */
      credential: {
        envVarName: 'GITHUB_TOKEN',
        handedToAgent: false,
        permittedUses: ['push_feature_branch', 'create_pr'],
      },
      registeredBy: 'founder',
    },
    now: NOW,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function target(reg: RepositoryRegistration, permissions: readonly RepositoryPermission[] = FULL): MissionRepositoryTarget {
  const resolved = resolveRepositoryTarget({
    registration: reg,
    request: {
      repositoryKey: reg.key, selectedBy: 'founder', selectedAt: NOW,
      workingBranch: 'relay/mission-1', permissions: [...permissions],
    },
    now: NOW,
  });
  if (!resolved.ok) throw new Error(resolved.error.message);
  return resolved.target;
}

describe('a dry run plans from the LIVE permissions', () => {
  it('plans a pull request when create_pr is held, and performs nothing', () => {
    const reg = registration();
    const result = planShipDryRun({
      target: target(reg), readRegistration: () => reg,
      judgement: null, evidence: EVIDENCE, now: () => NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.performed).toBe(false);
    expect(result.plan.pullRequestBody).not.toBe('');
    // A plan never predicts a ship: shipping is decided from live evidence.
    expect(result.plan.furthestAuthorizedStage).not.toBe('shipped');
  });

  it('does NOT promise an operation whose grant was revoked after resolution', () => {
    /**
     * The defect this exists for. The target still carries `create_pr` from the
     * moment it was resolved; the registration no longer grants it. A plan
     * rendered from the captured set would tell a founder Relay will open a
     * pull request it is no longer allowed to open.
     */
    const full = registration();
    const captured = target(full);
    const narrowed: RepositoryRegistration = {
      ...full, grants: full.grants.filter((g) => g.permission !== 'create_pr'),
    };
    const result = planShipDryRun({
      target: captured, readRegistration: () => narrowed,
      judgement: null, evidence: EVIDENCE, now: () => NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The PR body is empty when create_pr is not held, and the refusal is named.
    expect(result.plan.pullRequestBody).toBe('');
    expect(result.plan.refusals.length).toBeGreaterThan(0);
  });

  it('REFUSES rather than returning an empty plan when the repository is gone', () => {
    /**
     * An empty plan reads as "this Mission would do nothing" — a much less
     * alarming statement than "this repository is no longer registered".
     */
    const reg = registration();
    const result = planShipDryRun({
      target: target(reg), readRegistration: () => null,
      judgement: null, evidence: EVIDENCE, now: () => NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no longer registered');
  });
});
