import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runShipLifecycle } from './ship-runner';
import {
  SHIP_STAGES,
  createRepositoryRegistration,
  judgeObservedDiff,
  resolveRepositoryTarget,
} from '../src/relay/mission/repository-target';
import { observeRepositoryWorktree } from '../src/relay/workspace/repository-target-observer';
import type {
  MissionRepositoryTarget,
  RemoteRepositoryProvider,
  RepositoryPermission,
  RepositoryRegistration,
  ShipStage,
} from '../src/relay/mission/repository-target';

/**
 * TWO INVARIANTS, NAMED BY THE FOUNDER AFTER THE SAME DEFECT APPEARED THREE
 * TIMES IN ONE BRANCH.
 *
 * Each instance was repaired individually and the next one arrived one stage
 * later. These hold the CLASS instead:
 *
 *   PERMISSION MONOTONICITY — granting an additional capability must never
 *   leave a Mission less capable than the otherwise-identical Mission WITHOUT
 *   that capability.
 *
 *   INDEPENDENT STAGE PROGRESSION — failure of an optional lifecycle stage
 *   blocks only the stages that genuinely depend on its success.
 *
 * The observed instances, all of the same shape:
 *   - `merge_pr` held + `deploying.from` missing `pull_request_open` → the
 *     Mission parked at an open pull request and could not deploy, while the
 *     Mission WITHOUT `merge_pr` deployed and shipped.
 *   - a provider-refused merge → the run abandoned an authorized staging
 *     deploy that does not depend on the merge at all.
 *   - a provider that cannot push → same, one stage earlier.
 *
 * A staging deploy ships the COMMIT from the working branch. It has no
 * dependency on push, pull request or merge succeeding, which is exactly why
 * the lifecycle calls deploying an unmerged branch "the normal preview flow".
 */

const NOW = '2026-08-11T12:00:00.000Z';
const temporaries: string[] = [];

afterEach(() => {
  for (const p of temporaries.splice(0)) {
    try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const GIT_ENV = (root: string) => ({
  PATH: process.env.PATH ?? '', HOME: root,
  GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@x',
  GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@x',
});

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'relay-inv-'));
  temporaries.push(root);
  const git = (a: string[]) => execFileSync('git', a, { cwd: root, env: GIT_ENV(root) });
  git(['init', '--quiet', '--initial-branch=main']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const version = 1;\n');
  git(['add', '--', '.']);
  git(['commit', '-m', 'initial']);
  git(['checkout', '--quiet', '-b', 'relay/mission-1']);
  git(['remote', 'add', 'origin', 'https://github.com/o/r.git']);
  return root;
}

/**
 * HOW FAR ALONG THE LIFECYCLE A STAGE IS — over a curated PROGRESSION, never
 * over `SHIP_STAGES.indexOf`.
 *
 * The first version ranked by array position, and `deployment_failed` sits at
 * index 10 while `deployed` sits at 7 — so the invariant "a refusal at
 * push/PR/merge still reaches deployed" was SATISFIED BY THE DEPLOY FAILING.
 * A fifth review proved it: a mutation that poisons the deploy whenever the
 * remote leg skipped passed 1135/1135 tests including both named invariants.
 * The domain's own comment warned about exactly this: "the later fact is the
 * true one, and array order is not a ranking."
 *
 * Terminal failures are not positions on the road; asking for their rank is a
 * category error and throws, so a future stage added to SHIP_STAGES cannot
 * silently join the ordering either.
 */
const PROGRESSION: readonly ShipStage[] = [
  'verified_complete', 'ready_to_ship', 'committed', 'pushed',
  'pull_request_open', 'merged', 'deploying', 'deployed', 'live_verified', 'shipped',
];
const rank = (stage: ShipStage): number => {
  const index = PROGRESSION.indexOf(stage);
  if (index < 0) throw new Error(`"${stage}" is a terminal failure, not a position on the progression`);
  return index;
};
// The curated list must stay a strict subset of the real one.
for (const stage of PROGRESSION) {
  if (!SHIP_STAGES.includes(stage)) throw new Error(`progression names unknown stage "${stage}"`);
}

function artifactDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'relay-inv-art-'));
  temporaries.push(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html>\n');
  return root;
}

/** Reports what it deployed, never what it is asked. */
function deployProvider() {
  let deployed: string | null = null;
  return {
    descriptor: {
      providerId: 'stub', displayName: 'Stub', environments: ['staging'] as const,
      canReportDeployedRevision: true, canVerifyLive: true, simulated: true,
      credentialEnvVarName: null,
    },
    deploy: async (r: { revision: string }) => {
      deployed = r.revision;
      return {
        ok: true, providerId: 'stub', environment: 'staging' as const,
        deployedRevision: deployed, deploymentRef: 'stub:1',
        url: 'http://stub.invalid/app', observedAt: NOW, detail: null,
      };
    },
    verifyLive: async (i: { expectedRevision: string }) => ({
      reachable: true,
      healthy: deployed !== null && deployed === i.expectedRevision,
      reportedRevision: deployed,
      method: 'stub', observedAt: NOW, detail: null,
    }),
  };
}

/** A remote provider whose named operation refuses; everything else succeeds. */
function remoteProvider(
  refuse: 'none' | 'push' | 'pr' | 'merge',
  /**
   * WHAT THE PROVIDER SAYS IT CAN DO, separately from whether a call succeeds.
   *
   * The first version of this stub always declared all three, so the
   * CAPABILITY-GAP path was never exercised — and a mutation making an
   * unsupported push fatal passed all four invariants. "Registered is not the
   * same as drivable" has its own branch in the runner and needs its own case
   * here: a provider that cannot do something is not the same as one that tried
   * and was refused.
   */
  supports: readonly RepositoryPermission[] = ['push_feature_branch', 'create_pr', 'merge_pr'],
): RemoteRepositoryProvider {
  return {
    descriptor: {
      providerId: 'stub-remote', displayName: 'Stub remote',
      credentialEnvVarName: 'GITHUB_TOKEN',
      supports,
    },
    push: async (r) => ({
      ok: refuse !== 'push', providerId: 'stub-remote', branch: r.branch,
      observedHeadSha: refuse === 'push' ? null : r.expectedHeadSha,
      observedAt: NOW, detail: refuse === 'push' ? 'refused' : null,
    }),
    openPullRequest: async () => ({
      ok: refuse !== 'pr', providerId: 'stub-remote',
      reference: refuse === 'pr' ? null : '7', url: null,
      state: refuse === 'pr' ? null : 'open', observedAt: NOW,
      detail: refuse === 'pr' ? 'refused' : null,
    }),
    mergePullRequest: async () => ({
      ok: refuse !== 'merge', providerId: 'stub-remote', reference: '7', url: null,
      state: refuse === 'merge' ? null : 'merged', observedAt: NOW,
      detail: refuse === 'merge' ? 'GitHub answered HTTP 500.' : null,
    }),
  };
}

function registrationFor(root: string, permissions: readonly RepositoryPermission[]): RepositoryRegistration {
  const result = createRepositoryRegistration({
    draft: {
      identity: { provider: 'github', host: 'github.com', owner: 'o', name: 'r', defaultBranch: 'main' },
      location: { kind: 'local_path', path: root },
      scope: { read: ['**'], write: ['src/**'] },
      grants: permissions.map((permission) => ({
        permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
      })),
      ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
      credential: {
        envVarName: 'GITHUB_TOKEN', handedToAgent: false,
        permittedUses: ['push_feature_branch', 'create_pr', 'merge_pr'],
      },
      registeredBy: 'founder',
    },
    now: NOW,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function targetFor(reg: RepositoryRegistration, permissions: readonly RepositoryPermission[]): MissionRepositoryTarget {
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

/** Run the lifecycle with a given permission set, against a fresh repository. */
async function runWith(
  permissions: readonly RepositoryPermission[],
  refuse: 'none' | 'push' | 'pr' | 'merge' = 'none',
  supports?: readonly RepositoryPermission[],
): Promise<{ stage: ShipStage; stoppedBy: string | null }> {
  const root = repository();
  const reg = registrationFor(root, permissions);
  const target = targetFor(reg, permissions);
  writeFileSync(join(root, 'src', 'app.js'), 'export const version = 2;\n');
  const observed = observeRepositoryWorktree({ worktreePath: root, baselineSha: 'HEAD', now: NOW });
  if (!observed.ok) throw new Error(observed.error.message);
  const judgement = judgeObservedDiff({ target, diff: observed.value });

  const wantsRemote = permissions.includes('push_feature_branch');
  const wantsDeploy = permissions.includes('deploy_staging');
  const result = await runShipLifecycle({
    target, readRegistration: () => reg, worktreePath: root, judgement,
    commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
    ...(wantsRemote
      ? {
        remote: {
          provider: remoteProvider(refuse, supports),
          evidence: {
            missionId: 'm1', objective: 'Bump the version',
            artifactDigest: 'sha256:a', reviewedArtifactDigest: 'sha256:a',
            reviewerVerdict: 'approved' as const, reviewerFindings: [],
            relayVerification: ['npm test passed'], attestations: [],
            baselineSha: 'b'.repeat(40),
          },
        },
      }
      : {}),
    ...(wantsDeploy
      ? {
        deployment: {
          provider: deployProvider(), environment: 'staging' as const,
          artifactPath: artifactDir(), liveUrl: 'http://stub.invalid/app',
        },
      }
      : {}),
    now: () => NOW,
  });
  return { stage: result.stage, stoppedBy: result.stoppedBy };
}

const BASE: readonly RepositoryPermission[] = ['read', 'write_worktree', 'commit', 'deploy_staging'];
const WITH_PUSH: readonly RepositoryPermission[] = [...BASE, 'push_feature_branch'];
const WITH_PR: readonly RepositoryPermission[] = [...WITH_PUSH, 'create_pr'];
const WITH_MERGE: readonly RepositoryPermission[] = [...WITH_PR, 'merge_pr'];

describe('PERMISSION MONOTONICITY', () => {
  it('more permission never reaches a lesser stage', async () => {
    /**
     * The ladder, each rung a strict superset of the one below. Every rung must
     * reach a stage at least as far as the rung beneath it — the property that
     * three separate defects violated, each time by making an extra grant open
     * a path that could then fail and abandon the rest of the run.
     */
    const ladder: readonly { name: string; permissions: readonly RepositoryPermission[] }[] = [
      { name: 'base (commit + deploy)', permissions: BASE },
      { name: '+ push', permissions: WITH_PUSH },
      { name: '+ create_pr', permissions: WITH_PR },
      { name: '+ merge_pr', permissions: WITH_MERGE },
    ];
    const reached: { name: string; stage: ShipStage }[] = [];
    for (const rung of ladder) {
      const { stage } = await runWith(rung.permissions);
      reached.push({ name: rung.name, stage });
    }
    for (let i = 1; i < reached.length; i += 1) {
      const prev = reached[i - 1];
      const here = reached[i];
      expect(
        rank(here.stage),
        `"${here.name}" reached ${here.stage} but "${prev.name}" reached ${prev.stage} — `
        + 'granting a capability made the Mission LESS capable',
      ).toBeGreaterThanOrEqual(rank(prev.stage));
    }
    // And the fullest set still ships, so the property is not satisfied by
    // everything failing equally.
    expect(reached[reached.length - 1].stage).toBe('shipped');
  }, 60_000);
});

describe('INDEPENDENT STAGE PROGRESSION', () => {
  /**
   * A staging deploy ships the COMMIT from the working branch. It does not
   * depend on push, pull request or merge succeeding. So a refusal in any of
   * those must not cost the deploy.
   */
  it.each([
    ['a refused merge', 'merge' as const],
    ['a refused pull request', 'pr' as const],
  ])('%s does not cancel the authorized deploy', async (_label, refuse) => {
    const { stage } = await runWith(WITH_MERGE, refuse);
    expect(
      rank(stage),
      `the run stopped at ${stage}; a staging deploy does not depend on that stage`,
    ).toBeGreaterThanOrEqual(rank('deployed'));
  }, 60_000);

  it.each([
    ['cannot push', [] as readonly RepositoryPermission[]],
    ['cannot open a pull request', ['push_feature_branch'] as readonly RepositoryPermission[]],
    ['cannot merge', ['push_feature_branch', 'create_pr'] as readonly RepositoryPermission[]],
  ])('a provider that %s does not cancel the authorized deploy', async (_l, supports) => {
    /**
     * A CAPABILITY GAP IS NOT A FAILED STAGE, and it must not be fatal either.
     * "Registered is not the same as drivable" — a provider that cannot do
     * something is a configuration fact, and the deploy does not depend on it.
     * A mutation making the unsupported-push case fatal passed every invariant
     * until this case existed.
     */
    const { stage } = await runWith(WITH_MERGE, 'none', supports);
    expect(rank(stage), `the run stopped at ${stage}`).toBeGreaterThanOrEqual(rank('deployed'));
  }, 60_000);

  it('a refused PUSH does not cancel the authorized deploy either', async () => {
    /**
     * Kept separate because it is the weakest case and the one still open when
     * these invariants were written: a push that does not land means there is no
     * remote branch, but the DEPLOY takes its artifact from the local commit, so
     * it is still independent.
     */
    const { stage } = await runWith(WITH_MERGE, 'push');
    expect(rank(stage), `the run stopped at ${stage}`).toBeGreaterThanOrEqual(rank('deployed'));
  }, 60_000);
});
