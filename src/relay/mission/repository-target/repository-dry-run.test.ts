import { describe, expect, it } from 'vitest';

import {
  createRepositoryRegistration,
  planDryRun,
  renderPullRequestBody,
  resolveRepositoryTarget,
} from './index';
import type {
  DiffJudgement,
  MissionRepositoryTarget,
  PullRequestEvidence,
  RepositoryPermission,
  RepositoryRegistrationDraft,
} from './index';

/**
 * THE DRY RUN, which the design document requires before any of this is used.
 *
 * *"A dry-run mode exists: produce the branch and the PR body, push nothing. The
 * first real repository Mission should be observable before it is
 * consequential."*
 *
 * The property that makes it worth having is that it shows the REFUSALS. A live
 * run reveals those after the money is spent; this shows them before anything
 * starts. And it must never predict a ship — a plan has no live evidence, and a
 * plan that asserted the outcome it exists to preview would be worthless.
 */

const NOW = '2026-08-11T12:00:00.000Z';
const LADDER: readonly RepositoryPermission[] = [
  'read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr', 'merge_pr',
];

const draft = (over: Partial<RepositoryRegistrationDraft> = {}): RepositoryRegistrationDraft => ({
  identity: { provider: 'github', host: 'github.com', owner: 'ohdieyuh-glitch', name: 'sunday-relay', defaultBranch: 'main' },
  location: { kind: 'remote_clone', cloneUrl: 'https://github.com/ohdieyuh-glitch/sunday-relay.git' },
  scope: { read: ['**'], write: ['src/**'] },
  grants: LADDER.map((permission) => ({ permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null })),
  ceilings: { maxFilesChanged: 25, maxLinesRemoved: 2000, allowDeletions: false },
  credential: { envVarName: 'RELAY_GITHUB_TOKEN' },
  registeredBy: 'founder',
  ...over,
});

function target(over: Partial<RepositoryRegistrationDraft> = {}): MissionRepositoryTarget {
  const registration = createRepositoryRegistration({ draft: draft(over), now: NOW });
  if (!registration.ok) throw new Error(`fixture refused: ${registration.error.message}`);
  const resolution = resolveRepositoryTarget({
    registration: registration.value,
    request: {
      repositoryKey: 'github:github.com/ohdieyuh-glitch/sunday-relay',
      selectedBy: 'founder', selectedAt: NOW,
      workingBranch: 'relay/mission-1',
      permissions: draft(over).grants.map((g) => g.permission),
    },
    now: NOW,
  });
  if (!resolution.ok) throw new Error(`fixture resolution refused: ${resolution.error.message}`);
  return resolution.target;
}

const judgement: DiffJudgement = {
  accepted: true,
  problems: [],
  scope: { allowed: ['src/a.ts', 'src/b.ts'], protectedHits: [], outOfScope: [], invalid: [] },
  ceilings: { within: true, problems: [], filesChanged: 2, linesRemoved: 4, deletedPaths: [] },
  committablePaths: ['src/a.ts', 'src/b.ts'],
};

const evidence = (over: Partial<PullRequestEvidence> = {}): PullRequestEvidence => ({
  missionId: 'msn-1',
  objective: 'Add the migration guard',
  artifactDigest: 'sha256:aaaa',
  reviewedArtifactDigest: 'sha256:aaaa',
  reviewerVerdict: 'approved',
  reviewerFindings: [],
  relayVerification: ['Required tests passed under Relay verification.'],
  attestations: [{
    role: 'reviewer', requestedActor: 'Hermes', actualActor: 'Hermes',
    requestedModel: 'grok-4', servedModel: 'grok-4-0709',
    completionVerified: true, fallbackOccurred: false,
  }],
  baselineSha: 'a1b2c3d4',
  ...over,
});

const plan = (over: { permissions?: readonly RepositoryPermission[]; deploy?: 'staging' | 'production' | null } = {}) =>
  planDryRun({
    target: target(),
    permissions: over.permissions ?? LADDER,
    deployEnvironment: over.deploy ?? null,
    judgement,
    evidence: evidence(),
  });

/* ================================================================ plan */

describe('the plan describes what would happen and performs none of it', () => {
  it('states that it performed nothing, rather than leaving it to be inferred', () => {
    // `performed: false` is a literal type. There is no value of this field that
    // says otherwise, and no function here that could set one.
    expect(plan().performed).toBe(false);
  });

  it('lists the operations in the order they would occur', () => {
    expect(plan().operations.map((o) => o.stage)).toEqual(['committed', 'pushed', 'pull_request_open', 'merged']);
  });

  it('includes the deploy steps only when an environment is named', () => {
    expect(plan().operations.map((o) => o.stage)).not.toContain('deployed');
    const staged = plan({ permissions: [...LADDER, 'deploy_staging'], deploy: 'staging' });
    expect(staged.operations.map((o) => o.stage)).toEqual([
      'committed', 'pushed', 'pull_request_open', 'merged', 'deployed', 'live_verified',
    ]);
  });

  it('asks for the permission the ENVIRONMENT needs, never the stage table\'s', () => {
    // A staging grant must not preview a production deploy.
    const production = planDryRun({
      target: target(), permissions: [...LADDER, 'deploy_staging'],
      deployEnvironment: 'production', judgement, evidence: evidence(),
    });
    const deploy = production.operations.find((o) => o.stage === 'deployed');
    expect(deploy?.permission).toBe('deploy_production');
    expect(deploy?.authorized).toBe(false);
  });

  it('shows the refusals a live run would only reveal after the money was spent', () => {
    const limited = plan({ permissions: ['read', 'write_worktree', 'commit'] });
    expect(limited.operations.find((o) => o.stage === 'committed')?.authorized).toBe(true);
    expect(limited.operations.find((o) => o.stage === 'pushed')?.authorized).toBe(false);
    expect(limited.refusals.map((r) => r.message).join(' ')).toContain('push_feature_branch');
    // Every refusal together, not one per attempt.
    expect(limited.refusals).toHaveLength(3);
  });

  it('stops the furthest stage at the FIRST refusal, not the last authorization', () => {
    /**
     * A Mission that may commit and deploy but may not push cannot reach the
     * deploy, because the deploy follows the push. Reporting the last authorized
     * entry would name a stage the Mission cannot arrive at.
     */
    const gapped = planDryRun({
      target: target(),
      permissions: ['read', 'write_worktree', 'commit', 'deploy_staging'],
      deployEnvironment: 'staging',
      judgement,
      evidence: evidence(),
    });
    expect(gapped.operations.find((o) => o.stage === 'deployed')?.authorized).toBe(true);
    expect(gapped.furthestAuthorizedStage).toBe('committed');
  });

  it('never predicts a ship', () => {
    // A plan has no live evidence. `decideShipped` reads a probe; this reads
    // permissions.
    for (const p of [plan(), plan({ permissions: [...LADDER, 'deploy_staging', 'deploy_production'], deploy: 'production' })]) {
      expect(p.furthestAuthorizedStage).not.toBe('shipped');
      expect(p.operations.map((o) => o.stage)).not.toContain('shipped');
    }
  });

  it('reports the exact files it would commit', () => {
    expect(plan().operations[0]?.description).toContain('src/a.ts, src/b.ts');
  });

  it('says the file list is not known when no diff has been judged', () => {
    const unjudged = planDryRun({
      target: target(), permissions: LADDER, deployEnvironment: null, judgement: null, evidence: evidence(),
    });
    // Not "0 files", which would read as a diff that changed nothing.
    expect(unjudged.operations[0]?.description).toContain('No diff has been judged yet');
  });

  it('renders no pull-request body when the Mission could not open one', () => {
    const limited = plan({ permissions: ['read', 'write_worktree', 'commit'] });
    // A body for a pull request that cannot be opened reads as a plan to open it.
    expect(limited.pullRequestBody).toBe('');
    expect(limited.pullRequestTitle).toBe('');
    expect(plan().pullRequestBody.length).toBeGreaterThan(0);
  });
});

/* ============================================================= PR body */

describe('the pull-request body carries the evidence Relay saw', () => {
  const body = (over: Partial<PullRequestEvidence> = {}, permissions: readonly RepositoryPermission[] = LADDER) =>
    renderPullRequestBody({ target: target(), permissions, evidence: evidence(over), judgement });

  it('carries the verdict, the digests, the attestations and what Relay checked itself', () => {
    const text = body();
    expect(text).toContain('Verdict: approved');
    expect(text).toContain('sha256:aaaa');
    expect(text).toContain('Required tests passed under Relay verification.');
    expect(text).toContain('| reviewer | Hermes | Hermes |');
    expect(text).toContain('a1b2c3d4');
  });

  it('keeps requested and served models separate on this surface too', () => {
    // This is the exact founder-facing surface defect 3 was about.
    const text = body();
    expect(text).toContain('grok-4-0709');
    expect(text).toContain('Model requested | Model served');
    const unreported = body({
      attestations: [{
        role: 'reviewer', requestedActor: 'Hermes', actualActor: 'Hermes',
        requestedModel: 'grok-4', servedModel: null, completionVerified: true, fallbackOccurred: false,
      }],
    });
    expect(unreported).toContain('_not reported_');
  });

  it('says a review did not happen, rather than omitting the section', () => {
    const text = body({ reviewerVerdict: null, reviewedArtifactDigest: null });
    /**
     * A body with no "Independent review" heading reads as a body from before
     * reviews existed. A body whose review section says none cannot be misread.
     */
    expect(text).toContain('### Independent review');
    expect(text).toContain('**No independent review was performed.**');
    expect(text).toContain('_no review ran_');
  });

  it('says Relay verified nothing, rather than showing an empty list', () => {
    const text = body({ relayVerification: [] });
    expect(text).toContain('Relay recorded no verification evidence for this mission.');
  });

  it('states outright when the reviewer read a different artifact than the one being merged', () => {
    const text = body({ artifactDigest: 'sha256:aaaa', reviewedArtifactDigest: 'sha256:bbbb' });
    // Left for a reader to spot by comparing two hex strings, nobody spots it.
    expect(text).toContain('**The reviewer read a different artifact than the one being merged.**');
    // And it does NOT say that when they agree.
    expect(body()).not.toContain('different artifact');
  });

  it('marks a fallback in the attestation table', () => {
    const text = body({
      attestations: [{
        role: 'coding_agent', requestedActor: 'Claude Code', actualActor: 'Something Else',
        requestedModel: null, servedModel: null, completionVerified: true, fallbackOccurred: true,
      }],
    });
    expect(text).toContain('Something Else **(fallback)**');
  });

  it('says the findings when the verdict is not an approval', () => {
    const text = body({
      reviewerVerdict: 'changes_required',
      reviewerFindings: [{ severity: 'blocking', requirement: 'Refuse unknown schema versions.' }],
    });
    expect(text).toContain('Verdict: changes_required');
    expect(text).toContain('`blocking` — Refuse unknown schema versions.');
  });

  it('states the scope and the protected paths the Mission was bound to', () => {
    const text = body();
    expect(text).toContain('`src/**`');
    expect(text).toContain('`.git`');
    expect(text).toContain('`.github`');
    expect(text).toContain('read, write_worktree, commit, push_feature_branch, create_pr, merge_pr');
  });

  it('tells the human reviewer that Relay\'s approval is not theirs', () => {
    /**
     * A pull request listing three attestations and a passing review reads as an
     * endorsement. The one thing the human on the far side needs to know is that
     * Relay can prove what it did, not that it was the right thing to do — and
     * holding `merge_pr` does not change that.
     */
    for (const permissions of [LADDER, ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr'] as const]) {
      expect(body({}, permissions)).toContain('not a substitute for');
    }
  });
});
