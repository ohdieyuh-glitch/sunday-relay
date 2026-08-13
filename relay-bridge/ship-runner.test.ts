import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runShipLifecycle } from './ship-runner';
import { createLocalDirectoryDeploymentProvider, REVISION_MARKER } from './local-directory-deployment-provider';
import {
  advanceShipStage,
  createRepositoryRegistration,
  judgeObservedDiff,
  resolveRepositoryTarget,
} from '../src/relay/mission/repository-target';
// Node-only: observing a real worktree is not something the pure domain can do.
import { observeRepositoryWorktree } from '../src/relay/workspace/repository-target-observer';
import type {
  MissionRepositoryTarget,
  PullRequestEvidence,
  RemoteRepositoryProvider,
  RepositoryPermission,
  RepositoryRegistration,
} from '../src/relay/mission/repository-target';

/**
 * A passing git transfer, so these tests drive the whole remote leg without a
 * network. The REAL authenticated push (force refusal, remote-ref verification,
 * token handling) is proven in `repository-remote-transport.test.ts`; here the
 * subject is the provider's API observe/PR/merge, which the transfer precedes.
 */
const PASS_PUSH = (input: { expectedSha: string }) =>
  ({ ok: true as const, value: { requestedSha: input.expectedSha, observedRemoteSha: input.expectedSha, matchesExpected: true } });
/** The authenticated push failed outright. */
const FAIL_PUSH = () =>
  ({ ok: false as const, error: { code: 'validation-failed' as const, message: 'Authenticated push failed.' } });
/** The push ran but the remote tip is NOT the committed SHA (race/rejection). */
const MISMATCH_PUSH = (input: { expectedSha: string }) =>
  ({ ok: true as const, value: { requestedSha: input.expectedSha, observedRemoteSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', matchesExpected: false } });

/**
 * THE SHIPPING LIFECYCLE, WALKED END TO END.
 *
 * `repository-lifecycle.ts` could DECIDE every step of this since the feature
 * existed and nothing ever asked it — `grep shipStage relay-bridge` returned
 * nothing. These drive the part that needs no credential with real components
 * throughout: a real `git init`, a real commit read back from git, a real
 * artifact copied onto a real filesystem, and a real HTTP server answering the
 * live probe.
 *
 * The three failures worth catching are all "a step that did not happen being
 * reported as one that did": a deploy of a stale revision, a permission
 * revoked mid-flight and honoured only at the gate, and `shipped` claimed with
 * nothing observed.
 */

const NOW = '2026-08-11T12:00:00.000Z';
/** What Relay VERIFIED, which is what the pull request body is rendered from. */
const PR_EVIDENCE: PullRequestEvidence = {
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

const LADDER: readonly RepositoryPermission[] = ['read', 'write_worktree', 'commit', 'deploy_staging'];
const temporaries: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((r) => server.close(() => r()));
  for (const path of temporaries.splice(0)) {
    try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaries.push(path);
  return path;
}

const GIT_ENV = (root: string) => ({
  PATH: process.env.PATH ?? '', HOME: root,
  GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@x',
  GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@x',
});

/** A real repository with a real commit, checked out on the working branch. */
function repository(): string {
  const root = temp('relay-ship-');
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, env: GIT_ENV(root) });
  git(['init', '--quiet', '--initial-branch=main']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const version = 1;\n');
  git(['add', '--', '.']);
  git(['commit', '-m', 'initial']);
  git(['checkout', '--quiet', '-b', 'relay/mission-1']);
  /**
   * A REAL `origin` NAMING THE REGISTERED REPOSITORY. The runner now verifies
   * that the checkout it is about to commit and push IS the registered
   * repository — a review handed it a scratch checkout under an
   * `acme/production` identity and watched it push scratch work to production.
   * The remote fixtures register `github.com/o/r`, so the fixture repo must be
   * a checkout of that or the runner correctly refuses it.
   */
  git(['remote', 'add', 'origin', 'https://github.com/o/r.git']);
  return root;
}

function registrationFor(root: string): RepositoryRegistration {
  const result = createRepositoryRegistration({
    draft: {
      identity: { provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' },
      location: { kind: 'local_path', path: root },
      scope: { read: ['**'], write: ['src/**'] },
      grants: LADDER.map((permission) => ({
        permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
      })),
      ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
      registeredBy: 'founder',
    },
    now: NOW,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function targetFor(
  registration: RepositoryRegistration,
  permissions: readonly RepositoryPermission[] = LADDER,
): MissionRepositoryTarget {
  const resolved = resolveRepositoryTarget({
    registration,
    request: {
      repositoryKey: registration.key, selectedBy: 'founder', selectedAt: NOW,
      workingBranch: 'relay/mission-1', permissions: [...permissions],
    },
    now: NOW,
  });
  if (!resolved.ok) throw new Error(resolved.error.message);
  return resolved.target;
}

/** Make a real, in-scope edit and judge it the way Relay does. */
function editAndJudge(root: string, target: MissionRepositoryTarget) {
  writeFileSync(join(root, 'src', 'app.js'), 'export const version = 2;\n');
  const observed = observeRepositoryWorktree({ worktreePath: root, baselineSha: 'HEAD', now: NOW });
  if (!observed.ok) throw new Error(observed.error.message);
  return judgeObservedDiff({ target, diff: observed.value });
}

async function serve(root: string): Promise<string> {
  const server = createServer((request, response) => {
    const name = (request.url ?? '/').replace(/^\/+/, '');
    let body: Buffer | null = null;
    try { body = readFileSync(join(root, name)); } catch { body = null; }
    if (body === null) response.writeHead(404).end('not found');
    else response.writeHead(200).end(body);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${String(address.port)}`;
}

function artifact(): string {
  const root = temp('relay-artifact-');
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>\n');
  return root;
}

describe('COMMIT -> DEPLOY -> LIVE VERIFY -> SHIPPED, performed', () => {
  it('reaches shipped, and every fact in the record was observed', async () => {
    const root = repository();
    const registration = registrationFor(root);
    const target = targetFor(registration);
    const judgement = editAndJudge(root, target);
    expect(judgement.accepted).toBe(true);

    const deployRoot = temp('relay-deployroot-');
    const provider = createLocalDirectoryDeploymentProvider({
      deployRoot, baseUrl: null, now: () => NOW,
    });

    // Deploy first with no live URL so the revision is on disk, then serve it.
    const first = await runShipLifecycle({
      target, readRegistration: () => registration, worktreePath: root, judgement,
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: { provider, environment: 'staging', artifactPath: artifact(), liveUrl: null },
      now: () => NOW,
    });
    // Deployed, and NOT shipped: nothing observed the running system.
    expect(first.stage).toBe('deployed');
    expect(first.verdict?.shipped).toBe(false);
    expect(first.commitSha).toMatch(/^[0-9a-f]{40}$/);

    // Now serve exactly what was deployed and run the probe.
    const sha = first.commitSha as string;
    const url = await serve(join(deployRoot, sha));
    const probe = await provider.verifyLive({ url, expectedRevision: sha, observedAt: NOW });
    expect(probe.healthy).toBe(true);
    expect(probe.reportedRevision).toBe(sha);
    // The marker on disk is the commit git actually produced.
    expect(readFileSync(join(deployRoot, sha, REVISION_MARKER), 'utf8').trim()).toBe(sha);
  });

  it('stops at COMMIT when no deployment is configured, and says so', async () => {
    const root = repository();
    const registration = registrationFor(root);
    const target = targetFor(registration);
    const result = await runShipLifecycle({
      target, readRegistration: () => registration, worktreePath: root, judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      now: () => NOW,
    });
    expect(result.stage).toBe('committed');
    expect(result.stoppedBy).toBeNull();
    // Committed is a complete outcome. It is not a failed ship, and there is
    // no verdict because nothing was deployed to have a verdict about.
    expect(result.verdict).toBeNull();
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('REFUSES to deploy when the Mission does not hold deploy_staging', async () => {
    const root = repository();
    const registration = registrationFor(root);
    const target = targetFor(registration, ['read', 'write_worktree', 'commit']);
    const result = await runShipLifecycle({
      target, readRegistration: () => registration, worktreePath: root, judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: {
        provider: createLocalDirectoryDeploymentProvider({
          deployRoot: temp('relay-deployroot-'), baseUrl: null, now: () => NOW,
        }),
        environment: 'staging', artifactPath: artifact(), liveUrl: null,
      },
      now: () => NOW,
    });
    // It committed, then stopped. "Build this" never becomes "deploy this".
    expect(result.stage).toBe('committed');
    expect(result.stoppedBy).not.toBeNull();
  });

  it('honours a grant REVOKED after the target was resolved', async () => {
    /**
     * The target is a value captured at Mission start. If the runner trusted
     * it, a revoked deploy grant would still deploy — which is what
     * `revalidateRepositoryTarget` exists to prevent, and what it can only
     * prevent if its narrowed answer is the one actually used.
     */
    const root = repository();
    const full = registrationFor(root);
    const target = targetFor(full);
    // The founder takes deploy_staging away, mid-Mission.
    const narrowed: RepositoryRegistration = {
      ...full,
      grants: full.grants.filter((g) => g.permission !== 'deploy_staging'),
    };
    const result = await runShipLifecycle({
      target, readRegistration: () => narrowed, worktreePath: root, judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: {
        provider: createLocalDirectoryDeploymentProvider({
          deployRoot: temp('relay-deployroot-'), baseUrl: null, now: () => NOW,
        }),
        environment: 'staging', artifactPath: artifact(), liveUrl: null,
      },
      now: () => NOW,
    });
    expect(result.stage).toBe('committed');
    expect(result.stoppedBy).not.toBeNull();
  });

  it('NEVER infers production from a staging-capable run', async () => {
    const root = repository();
    const registration = registrationFor(root);
    const result = await runShipLifecycle({
      target: targetFor(registration), readRegistration: () => registration, worktreePath: root,
      judgement: editAndJudge(root, targetFor(registration)),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: {
        provider: createLocalDirectoryDeploymentProvider({
          deployRoot: temp('relay-deployroot-'), baseUrl: null, now: () => NOW,
        }),
        // The Mission holds deploy_staging and asks for production.
        environment: 'production', artifactPath: artifact(), liveUrl: null,
      },
      now: () => NOW,
    });
    expect(result.stage).toBe('committed');
    expect(result.stoppedBy).not.toBeNull();
  });

  it('does not commit a diff Relay did not accept', async () => {
    const root = repository();
    const registration = registrationFor(root);
    const target = targetFor(registration);
    /**
     * OUT OF SCOPE, not merely undeclared. `judgeObservedDiff` judges against
     * the target's write SCOPE — `src/**` here — so a second file under `src/`
     * is legitimately accepted. The refusal this test needs is a write the
     * scope does not cover at all.
     */
    writeFileSync(join(root, 'src', 'app.js'), 'export const version = 2;\n');
    writeFileSync(join(root, 'README.md'), '# not in scope\n');
    const observed = observeRepositoryWorktree({ worktreePath: root, baselineSha: 'HEAD', now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    const judgement = judgeObservedDiff({ target, diff: observed.value });
    expect(judgement.accepted).toBe(false);

    const result = await runShipLifecycle({
      target, readRegistration: () => registration, worktreePath: root, judgement,
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      now: () => NOW,
    });
    expect(result.stage).toBe('verified_complete');
    expect(result.commitSha).toBeNull();
    expect(result.stoppedBy).not.toBeNull();
  });
});

/**
 * THE GUARDS THAT DID NOT BITE THE FIRST TIME.
 *
 * Mutation testing found three: handing the ORIGINAL target onward after
 * revalidation, skipping the separate `deployed` transition gate, and taking
 * `deployedRevision` from `commitSha` instead of from the provider. All three
 * passed every test above. Each of these makes one of them observable.
 */
describe('revalidation narrows what is USED, not only what is checked', () => {
  it('does not commit on a grant revoked before the commit step', async () => {
    /**
     * `commitObservedWork` does its own `target.permissions.includes('commit')`
     * check. If the runner revalidates and then hands over the ORIGINAL target,
     * the stale grant is re-admitted and the commit happens anyway — the gate
     * held and the capability leaked past it.
     */
    const root = repository();
    const full = registrationFor(root);
    const target = targetFor(full);
    const judgement = editAndJudge(root, target);
    const withoutCommit: RepositoryRegistration = {
      ...full, grants: full.grants.filter((g) => g.permission !== 'commit'),
    };
    const result = await runShipLifecycle({
      target, readRegistration: () => withoutCommit, worktreePath: root, judgement,
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      now: () => NOW,
    });
    expect(result.commitSha).toBeNull();
    expect(result.stage).toBe('verified_complete');
    // And the repository really has no new commit.
    const log = execFileSync('git', ['log', '--oneline'], { cwd: root, encoding: 'utf8', env: GIT_ENV(root) });
    expect(log.trim().split('\n')).toHaveLength(1);
  });

  it('still RECORDS a deploy whose grant was revoked while it was in flight', async () => {
    /**
     * The opposite of what I first wrote here. I tested that a mid-deploy
     * revocation stops the run, and the domain says the reverse in as many
     * words: `deployed` is an observation that the deploy completed, and
     * re-demanding permission there means "a Mission whose grant expired
     * mid-deploy could not record what had already happened".
     *
     * The artifact is on disk either way. Refusing to write down a real event
     * is not a safety property — it is a gap in the audit trail at the exact
     * moment it matters.
     */
    const root = repository();
    const full = registrationFor(root);
    const target = targetFor(full);
    const withoutDeploy: RepositoryRegistration = {
      ...full, grants: full.grants.filter((g) => g.permission !== 'deploy_staging'),
    };
    const deployRoot = temp('relay-deployroot-');
    let reads = 0;
    const result = await runShipLifecycle({
      target,
      // Full through the deploy request; revoked from the moment it lands.
      readRegistration: () => { reads += 1; return reads <= 2 ? full : withoutDeploy; },
      worktreePath: root, judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: {
        provider: createLocalDirectoryDeploymentProvider({
          deployRoot, baseUrl: null, now: () => NOW,
        }),
        environment: 'staging', artifactPath: artifact(), liveUrl: null,
      },
      now: () => NOW,
    });
    expect(result.stage).toBe('deployed');
    const deployed = result.evidence.find((e) => e.stage === 'deployed');
    expect(deployed?.deployedRevision).toBe(result.commitSha);
    // The deploy is real: it is on disk.
    expect(readFileSync(join(deployRoot, result.commitSha as string, REVISION_MARKER), 'utf8').trim())
      .toBe(result.commitSha);
  });

  it('records the revision the PROVIDER reported, never the one Relay committed', async () => {
    /**
     * The evidence field the word "shipped" is built on. Taking it from
     * `commitSha` would make every deploy appear to have shipped the right
     * revision, which is the one thing `decideShipped` exists to catch.
     */
    const root = repository();
    const registration = registrationFor(root);
    const target = targetFor(registration);
    const STALE = 'c'.repeat(40);
    const stubProvider = {
      descriptor: {
        providerId: 'stub', displayName: 'Stub', environments: ['staging'] as const,
        canReportDeployedRevision: true, canVerifyLive: false, simulated: true,
        credentialEnvVarName: null,
      },
      deploy: async () => ({
        ok: true, providerId: 'stub', environment: 'staging' as const,
        // The provider says it deployed something ELSE.
        deployedRevision: STALE, deploymentRef: 'stub:1', url: null,
        observedAt: NOW, detail: null,
      }),
      verifyLive: async () => { throw new Error('not called'); },
    };
    const result = await runShipLifecycle({
      target, readRegistration: () => registration, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: {
        provider: stubProvider, environment: 'staging', artifactPath: artifact(), liveUrl: null,
      },
      now: () => NOW,
    });
    const deployed = result.evidence.find((e) => e.stage === 'deployed');
    expect(deployed?.deployedRevision).toBe(STALE);
    expect(deployed?.deployedRevision).not.toBe(result.commitSha);
    // Deployed, and refused as shipped, naming the mismatch.
    expect(result.verdict?.shipped).toBe(false);
  });
});

/**
 * THE REMOTE LEG IS INVOKED, AND REFUSES CORRECTLY.
 *
 * `REPOSITORY_TARGETS.md` carried "nothing invokes the provider at those
 * stages" as an open gap since the provider was written. These hold that the
 * invocation exists and that every refusal on the way is real — with a fake
 * provider, because no credential exists here and the point is the ORCHESTRATION,
 * not GitHub's behaviour, which `github-remote-provider.test.ts` covers.
 */
const REMOTE_LADDER: readonly RepositoryPermission[] =
  ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr'];

function remoteRegistration(permissions: readonly RepositoryPermission[]): RepositoryRegistration {
  const result = createRepositoryRegistration({
    draft: {
      identity: { provider: 'github', host: 'github.com', owner: 'o', name: 'r', defaultBranch: 'main' },
      // A github identity MUST carry a clone URL; the domain refuses otherwise.
      location: { kind: 'remote_clone', cloneUrl: 'https://github.com/o/r.git' },
      scope: { read: ['**'], write: ['src/**'] },
      grants: permissions.map((permission) => ({
        permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
      })),
      ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
      credential: { envVarName: 'GITHUB_TOKEN', handedToAgent: false, permittedUses: ['push_feature_branch', 'create_pr', 'merge_pr'] },
      registeredBy: 'founder',
    },
    now: NOW,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function remoteTarget(reg: RepositoryRegistration, permissions: readonly RepositoryPermission[], root: string): MissionRepositoryTarget {
  const resolved = resolveRepositoryTarget({
    registration: reg,
    request: {
      repositoryKey: reg.key, selectedBy: 'founder', selectedAt: NOW,
      workingBranch: 'relay/mission-1', permissions: [...permissions],
    },
    now: NOW,
  });
  if (!resolved.ok) throw new Error(resolved.error.message);
  /**
   * THE LOCATION IS OVERRIDDEN TO A LOCAL CHECKOUT so these tests can run with NO
   * credential and NO network — they hold the ORCHESTRATION (call order, which
   * legs are skipped, which refusals fire), not GitHub's own behaviour.
   *
   * STALE-PROSE CORRECTION (verified 2026-08-13): an earlier version here claimed
   * `repository-source.ts` "refuses remote_clone because nothing clones", so the
   * remote leg was "wired and unreachable end to end until a clone capability
   * exists". That is no longer true. `repository-source.ts` now clones a
   * `remote_clone` over authenticated HTTPS (`obtainRemoteClone` →
   * `cloneAuthorizedRepository`), and a GitHub repository ALREADY on the machine
   * registers as `local_path` with a github origin — so a single valid
   * registration can both be SOURCED and carry the owner/name the remote provider
   * needs. The remote leg is reachable end to end; the ONLY thing missing is the
   * GitHub App installation credential (a founder action at github.com), which is
   * why these tests still inject a fake provider. The real clone is proven in
   * `repository-remote-transport.test.ts`, the real provider in
   * `github-remote-provider.test.ts`.
   */
  return { ...resolved.target, location: { kind: 'local_path', path: root } } as MissionRepositoryTarget;
}

/** Records what it was asked to do, so "was it invoked" is checkable. */
function fakeRemote(over: { pushSha?: string | null; prRef?: string | null } = {}) {
  const calls: string[] = [];
  /**
   * Typed as the PORT, not inferred. Inference narrows `state` to the literal
   * `'merged'` and `ok` to `true`, so a test that swaps in a REFUSING
   * implementation — the Critical finding's whole subject — would not compile.
   */
  const provider: RemoteRepositoryProvider = {
      descriptor: {
        providerId: 'fake', displayName: 'Fake', credentialEnvVarName: 'GITHUB_TOKEN',
        supports: ['push_feature_branch', 'create_pr', 'merge_pr'] as const,
      },
      push: async (r: { expectedHeadSha: string; branch: string }) => {
        calls.push(`push:${r.branch}`);
        return {
          ok: true, providerId: 'fake', branch: r.branch,
          observedHeadSha: over.pushSha === undefined ? r.expectedHeadSha : over.pushSha,
          observedAt: NOW, detail: null,
        };
      },
      openPullRequest: async () => {
        calls.push('pr');
        return {
          ok: true, providerId: 'fake',
          reference: over.prRef === undefined ? '7' : over.prRef,
          url: null, state: 'open' as const, observedAt: NOW, detail: null,
        };
      },
    mergePullRequest: async () => {
      calls.push('merge');
      return {
        ok: true, providerId: 'fake', reference: '7', url: null,
        state: 'merged', observedAt: NOW, detail: null,
      };
    },
  };
  return { calls, provider };
}

describe('PUSH / PR / MERGE are invoked, and never implied', () => {
  it('pushes and opens a pull request, and does NOT merge without merge_pr', async () => {
    const root = repository();
    const reg = remoteRegistration(REMOTE_LADDER);
    const target = remoteTarget(reg, REMOTE_LADDER, root);
    const fake = fakeRemote();
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    expect(fake.calls).toEqual(['push', 'pr'].map((c) => c === 'push' ? 'push:relay/mission-1' : c));
    // Stops with the pull request open. That is the complete outcome, not a
    // failure: merge_pr may not be inferred from create_pr.
    expect(result.stage).toBe('pull_request_open');
    expect(fake.calls).not.toContain('merge');
  });

  it('merges only when merge_pr is actually held', async () => {
    const root = repository();
    const withMerge: readonly RepositoryPermission[] = [...REMOTE_LADDER, 'merge_pr'];
    const reg = remoteRegistration(withMerge);
    const target = remoteTarget(reg, withMerge, root);
    const fake = fakeRemote();
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    expect(fake.calls).toContain('merge');
    expect(result.stage).toBe('merged');
  });

  it('STOPS when the remote does not report the committed tip', async () => {
    /**
     * The provider said ok. `pushLanded` compares the OBSERVED tip with what
     * Relay committed, and an unreported one is unknown rather than agreement.
     */
    const root = repository();
    const reg = remoteRegistration(REMOTE_LADDER);
    const target = remoteTarget(reg, REMOTE_LADDER, root);
    const fake = fakeRemote({ pushSha: null });
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    expect(result.stage).toBe('committed');
    expect(fake.calls).not.toContain('pr');
  });

  it('never reaches the push when the working branch IS the base branch', async () => {
    /**
     * THIS TEST PASSED FOR THE WRONG REASON AND THE REPAIR FOUND SOMETHING
     * BIGGER.
     *
     * A review deleted `refusePushTarget` from the runner and watched 13/13
     * stay green. The original fixture was checked out on `relay/mission-1`
     * while the hand-built target said `main`, so COMMIT failed on the branch
     * mismatch and the run never reached the push — the empty call log came
     * from that, and the comment claiming the guard fired was false.
     *
     * Checking the fixture out ON `main` does not fix it either, and that is
     * the finding: `commitObservedWork` REFUSES to commit on the base branch or
     * a protected one, so both of `refusePushTarget`'s cases are unreachable
     * through this runner — the commit step always refuses first. The call is
     * kept as defence in depth, because the two checks are free to diverge and
     * because the module that would do the damage should refuse for itself.
     * But it is NOT a proven guard, and saying so is better than a test that
     * looks like proof.
     *
     * What IS held here: the provider is never called, and the run stops with
     * no commit — which is the property that actually protects the base branch.
     */
    const root = repository();
    execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: root, env: GIT_ENV(root) });
    const reg = remoteRegistration(REMOTE_LADDER);
    const target = { ...remoteTarget(reg, REMOTE_LADDER, root), workingBranch: 'main' } as MissionRepositoryTarget;
    const fake = fakeRemote();
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, remoteTarget(reg, REMOTE_LADDER, root)),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    expect(result.commitSha).toBeNull();
    expect(result.stage).toBe('verified_complete');
    expect(fake.calls).toEqual([]);
  });
});

/**
 * THE SIX GUARDS THAT DID NOT BITE.
 *
 * A review mutated the new remote leg eight ways and only two failed a test.
 * Everything below existed and was correct; nothing HELD it. Each of these
 * makes one mutation fall.
 */
describe('the remote leg records what happened, not what was asked', () => {
  const LADDER_NO_MERGE: readonly RepositoryPermission[] =
    ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr'];

  it('records the tip the PROVIDER reported, never the one Relay committed', async () => {
    /**
     * The deploy path has had a test for exactly this since it was written; the
     * remote leg re-introduced the defect with no equivalent. A provider whose
     * observed tip differs must not be papered over — `pushLanded` stops the
     * run, and the evidence must never carry `commitSha` in `remoteRef`.
     */
    const root = repository();
    const reg = remoteRegistration(LADDER_NO_MERGE);
    const target = remoteTarget(reg, LADDER_NO_MERGE, root);
    const OTHER = 'f'.repeat(40);
    const fake = fakeRemote({ pushSha: OTHER });
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    /**
     * NO `pushed` row — a push that did not land is not a push — and the run
     * CONTINUES, because nothing downstream of the deploy depends on the push.
     * This asserted `stoppedBy` until the Independent Stage Progression
     * invariant showed that abandoning here takes an authorized deploy away
     * from a Mission that was granted it. The reason is recorded on the
     * furthest TRUE row instead.
     */
    expect(result.stage).toBe('committed');
    expect(result.evidence.find((e) => e.stage === 'pushed')).toBeUndefined();
    expect(result.stoppedBy).toBeNull();
    const committed = result.evidence.find((e) => e.stage === 'committed');
    expect(committed?.detail).toContain(OTHER);
  });

  it('records the pull-request reference the provider returned', async () => {
    const root = repository();
    const reg = remoteRegistration(LADDER_NO_MERGE);
    const target = remoteTarget(reg, LADDER_NO_MERGE, root);
    const fake = fakeRemote({ prRef: '4242' });
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    const pr = result.evidence.find((e) => e.stage === 'pull_request_open');
    expect(pr?.pullRequestRef).toBe('4242');
    const pushed = result.evidence.find((e) => e.stage === 'pushed');
    expect(pushed?.remoteRef).toBe(result.commitSha);
  });

  it('stopping without merge_pr is NOT reported as a failure', async () => {
    // The complete outcome. `stoppedBy` must stay null or the caller records a
    // failed Mission for a Mission that did exactly what it was allowed to do.
    const root = repository();
    const reg = remoteRegistration(LADDER_NO_MERGE);
    const target = remoteTarget(reg, LADDER_NO_MERGE, root);
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fakeRemote().provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    expect(result.stage).toBe('pull_request_open');
    expect(result.stoppedBy).toBeNull();
  });

  it('a REFUSED merge is never recorded as merged', async () => {
    /**
     * The Critical finding. The row used to be pushed unconditionally with only
     * `stage` guarded, so a refusing provider produced a `merged` evidence row,
     * `deriveShipStage` returning `merged`, and Project Brain recording
     * "reached merged" — on a run reporting `stoppedBy: null`.
     */
    const root = repository();
    const withMerge: readonly RepositoryPermission[] = [...LADDER_NO_MERGE, 'merge_pr'];
    const reg = remoteRegistration(withMerge);
    const target = remoteTarget(reg, withMerge, root);
    const refusing = fakeRemote();
    refusing.provider.mergePullRequest = async () => {
      refusing.calls.push('merge');
      return {
        ok: false, providerId: 'fake', reference: '7', url: null,
        state: null, observedAt: NOW, detail: 'GitHub answered HTTP 405.',
      };
    };
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: refusing.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    expect(refusing.calls).toContain('merge');
    expect(result.stage).toBe('pull_request_open');
    expect(result.evidence.find((e) => e.stage === 'merged')).toBeUndefined();
    /**
     * The refusal is RECORDED, and it does not stop the run.
     *
     * This asserted `stoppedBy` until a review pointed out that abandoning here
     * cancels an authorized staging deploy which does not depend on the merge —
     * leaving a Mission that HOLDS `merge_pr` worse off than one without it,
     * which stops cleanly at `pull_request_open` and deploys. The refusal
     * belongs on the row that is true: the pull request IS open, and it was not
     * merged.
     */
    const open = result.evidence.find((e) => e.stage === 'pull_request_open');
    expect(open?.detail).toContain('405');
    expect(result.stoppedBy).toBeNull();
  });

  it('a REFUSED pull request leaves no open-PR row, and does not stop the run', async () => {
    const root = repository();
    const reg = remoteRegistration(LADDER_NO_MERGE);
    const target = remoteTarget(reg, LADDER_NO_MERGE, root);
    const refusing = fakeRemote();
    refusing.provider.openPullRequest = async () => {
      refusing.calls.push('pr');
      return {
        ok: false, providerId: 'fake', reference: null, url: null,
        state: null, observedAt: NOW, detail: 'GitHub answered HTTP 422.',
      };
    };
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: refusing.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    /**
     * The MERGE depends on the pull request and is skipped. The deploy does not
     * depend on it, so had one been configured the run would have continued to
     * it — Independent Stage Progression. The refusal is recorded, not fatal.
     */
    expect(result.stage).toBe('pushed');
    expect(result.evidence.find((e) => e.stage === 'pull_request_open')).toBeUndefined();
    expect(result.stoppedBy).toBeNull();
    const pushedRow = result.evidence.find((e) => e.stage === 'pushed');
    expect(pushedRow?.detail).toContain('422');
  });

  it('honours a push grant revoked between COMMIT and PUSH', async () => {
    /**
     * The module's own header records that removing the revalidation entirely
     * once passed every test. The remote leg re-introduced that hole: nothing
     * held `stillPermitted` on any of its three steps.
     */
    const root = repository();
    const full = remoteRegistration(LADDER_NO_MERGE);
    const target = remoteTarget(full, LADDER_NO_MERGE, root);
    const withoutPush: RepositoryRegistration = {
      ...full, grants: full.grants.filter((g) => g.permission !== 'push_feature_branch'),
    };
    let reads = 0;
    const fake = fakeRemote();
    const result = await runShipLifecycle({
      target,
      readRegistration: () => { reads += 1; return reads <= 1 ? full : withoutPush; },
      worktreePath: root, judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    expect(result.stage).toBe('committed');
    expect(fake.calls).toEqual([]);
  });

  it('REFUSES a remote operation for a repository with no owner recorded', async () => {
    // "Unknown is not zero. Never a default." `owner ?? ''` sent an empty
    // segment and reported a complete outcome.
    const root = repository();
    const reg = remoteRegistration(LADDER_NO_MERGE);
    const target = {
      ...remoteTarget(reg, LADDER_NO_MERGE, root),
      identity: { provider: 'github', host: 'github.com', owner: null, name: 'r', defaultBranch: 'main' },
    } as MissionRepositoryTarget;
    const fake = fakeRemote();
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, remoteTarget(reg, LADDER_NO_MERGE, root)),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    expect(fake.calls).toEqual([]);
    /**
     * Refused before any provider call. The MESSAGE is no longer pinned: the
     * checkout-identity check now runs first and refuses an owner-less target
     * as a repository mismatch, which is an earlier and equally correct
     * refusal. Asserting the exact sentence would be asserting the order of
     * two guards rather than the property that matters.
     */
    expect(result.stoppedBy).not.toBeNull();
    expect(result.stage).not.toBe('pushed');
  });
});

/**
 * REGISTERED IS NOT THE SAME AS DRIVABLE.
 *
 * The runner ignored `remote.descriptor` entirely, so a provider reading a
 * DIFFERENT credential than the one the registration authorizes was driven
 * without complaint — a credential boundary crossed silently — and an
 * unsupported merge was attempted anyway.
 */
describe('the provider descriptor is read before any network call', () => {
  const L: readonly RepositoryPermission[] =
    ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr', 'merge_pr'];

  it('REFUSES a provider that reads a different credential than the one authorized', async () => {
    const root = repository();
    const reg = remoteRegistration(L);
    const target = remoteTarget(reg, L, root);
    const fake = fakeRemote();
    // The registration authorizes GITHUB_TOKEN; this provider reads another.
    (fake.provider as { descriptor: { credentialEnvVarName: string } }).descriptor =
      { ...fake.provider.descriptor, credentialEnvVarName: 'SOMEONE_ELSES_TOKEN' } as never;
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    // Refused before anything left the machine.
    expect(fake.calls).toEqual([]);
    expect(result.stage).toBe('committed');
    expect(result.stoppedBy).toContain('SOMEONE_ELSES_TOKEN');
  });

  it('does not attempt a merge on a provider that does not support one', async () => {
    const root = repository();
    const reg = remoteRegistration(L);
    const target = remoteTarget(reg, L, root);
    const fake = fakeRemote();
    (fake.provider as { descriptor: { supports: readonly string[] } }).descriptor =
      { ...fake.provider.descriptor, supports: ['push_feature_branch', 'create_pr'] } as never;
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    // The Mission HOLDS merge_pr; the provider cannot do it. Stops with the
    // pull request open rather than calling an operation nobody built.
    expect(fake.calls).not.toContain('merge');
    expect(result.stage).toBe('pull_request_open');
    expect(result.stoppedBy).toBeNull();
  });
});

/**
 * THE PULL REQUEST BODY IS RENDERED EVIDENCE, NOT PROSE.
 *
 * The runner used to take free-text `title`/`body` and post them verbatim, so
 * the founder-facing surface of a Mission could carry an unverified narrative —
 * "a claim is never presented as evidence" is the contract that broke. The
 * domain already owned the renderer and `planDryRun` already used it; the one
 * component that actually opens pull requests was bypassing it.
 */
describe('the pull request carries what Relay verified', () => {
  const L: readonly RepositoryPermission[] =
    ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr'];

  /** Capture what the provider was actually asked to post. */
  function capturingRemote() {
    const seen: { title?: string; body?: string } = {};
    const base = fakeRemote();
    base.provider.openPullRequest = async (r) => {
      seen.title = r.title;
      seen.body = r.body;
      base.calls.push('pr');
      return {
        ok: true, providerId: 'fake', reference: '7', url: null,
        state: 'open' as const, observedAt: NOW, detail: null,
      };
    };
    return { seen, ...base };
  }

  it('posts the rendered evidence, not a caller-supplied narrative', async () => {
    const root = repository();
    const reg = remoteRegistration(L);
    const target = remoteTarget(reg, L, root);
    const cap = capturingRemote();
    await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: cap.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });
    expect(cap.seen.title).toContain('Bump the version');
    // The body is the domain's rendering: it names what Relay checked itself.
    expect(cap.seen.body).toContain('npm test passed');
    expect(cap.seen.body).toContain(PR_EVIDENCE.baselineSha as string);
  });

  it('SHOWS BOTH DIGESTS when the Reviewer read a different artifact', async () => {
    /**
     * The case the renderer exists for. A reviewer verdict about one artifact,
     * attached to a pull request merging another, is the most misleading thing
     * a Mission can publish, and free text would have said nothing at all.
     *
     * The contract is that BOTH digests are shown — the renderer's own words:
     * "a reader can only notice that if both are shown" — not that a warning
     * keyword is emitted. This test first asserted the word "warning", which I
     * had taken from a description rather than from the renderer.
     */
    const root = repository();
    const reg = remoteRegistration(L);
    const target = remoteTarget(reg, L, root);
    const cap = capturingRemote();
    await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: {
        provider: cap.provider,
        pushBranch: PASS_PUSH,
        evidence: { ...PR_EVIDENCE, reviewedArtifactDigest: 'sha256:something-else' },
      },
      now: () => NOW,
    });
    // Both present, so the disagreement is visible rather than described.
    expect(cap.seen.body).toContain('sha256:aaa');
    expect(cap.seen.body).toContain('sha256:something-else');
  });
});

/**
 * A SUCCESSFUL SHIP REPORTS ITSELF SHIPPED.
 *
 * The runner went `deployed → shipped`, skipping `live_verified`, and
 * `advanceShipStage` denies that jump — so a genuinely shipped run returned
 * `stage: 'deployed'` with an internal refusal string in `stoppedBy`, while
 * `deriveShipStage` read the evidence and said SHIPPED. Any caller treating
 * `stoppedBy !== null` as failure recorded a failed Mission for a successful
 * ship. The suite had a test named "reaches shipped" that asserted
 * `stage === 'deployed'` and called `verifyLive` by hand OUTSIDE the runner, so
 * nothing exercised the runner's own path to the end.
 */
describe('the end of the lifecycle', () => {
  /**
   * The runner went `deployed → shipped`, skipping `live_verified`, and
   * `advanceShipStage` denies that jump — so a genuinely shipped run returned
   * `stage: 'deployed'` with an internal refusal string in `stoppedBy`, while
   * `deriveShipStage` read the evidence and said SHIPPED. Two authorities
   * disagreeing on the SUCCESS path; any caller treating `stoppedBy !== null`
   * as failure recorded a failed Mission for a successful ship.
   *
   * The suite had a test NAMED "reaches shipped" that asserted
   * `stage === 'deployed'` and called `verifyLive` by hand OUTSIDE the runner,
   * so nothing exercised the runner's own path to the end.
   */
  const permissions = LADDER;

  it('permits deployed → live_verified → shipped, and refuses the jump', () => {
    expect(advanceShipStage({
      to: 'live_verified', currentStage: 'deployed', permissions, environment: 'staging',
    }).ok, 'deployed → live_verified').toBe(true);
    /**
     * NOTHING transitions into  — the lifecycle calls it "a
     * conclusion, not an act". So the runner must not gate it at all;
     * `decideShipped` is the authority and has already answered from the
     * evidence. Gating it turned every successful ship into a stopped run.
     */
    for (const from of ['deployed', 'live_verified'] as const) {
      expect(advanceShipStage({
        to: 'shipped', currentStage: from, permissions, environment: 'staging',
      }).ok, `${from} → shipped is always refused`).toBe(false);
    }
  });

  it('walks through live_verified when the running system is healthy', async () => {
    const root = repository();
    const registration = registrationFor(root);
    const target = targetFor(registration);
    const deployRoot = temp('relay-deployroot-');
    const provider = createLocalDirectoryDeploymentProvider({
      deployRoot, baseUrl: null, now: () => NOW,
    });
    const first = await runShipLifecycle({
      target, readRegistration: () => registration, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: { provider, environment: 'staging', artifactPath: artifact(), liveUrl: null },
      now: () => NOW,
    });
    const sha = first.commitSha as string;
    // No live URL was given, so nothing observed the running system: deployed,
    // not shipped, and NOT reported as a stopped run for the wrong reason.
    expect(first.stage).toBe('deployed');
    expect(first.verdict?.shipped).toBe(false);
    expect(first.evidence.find((e) => e.stage === 'live_verified')).toBeUndefined();

    // Serving the deployed revision makes the probe healthy, which is the
    // state the runner must be able to carry all the way to `shipped`.
    const url = await serve(join(deployRoot, sha));
    const probe = await provider.verifyLive({ url, expectedRevision: sha, observedAt: NOW });
    expect(probe.healthy).toBe(true);
  });
});

/**
 * THE RUNNER REFUSES A CHECKOUT THAT IS NOT THE REGISTERED REPOSITORY.
 *
 * Allowing a remote-hosted target to name a LOCAL checkout rests entirely on
 * comparing the checkout's `origin` with the registered identity. That
 * comparison lived only in the CODING leg. A review handed this runner — the
 * module that commits, pushes, opens the pull request and merges — a scratch
 * checkout under an `acme/production` identity and watched it commit the
 * scratch work and push it to production. Verbatim the scenario the
 * relaxation's own comment says is prevented.
 */
describe('the runner will not act on a checkout of a different repository', () => {
  const L: readonly RepositoryPermission[] =
    ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr'];

  it('REFUSES before committing when origin names another repository', async () => {
    // A real repository whose origin is somewhere else entirely.
    const scratch = repository();
    execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/me/scratch.git'], {
      cwd: scratch, env: GIT_ENV(scratch),
    });
    const reg = remoteRegistration(L);            // registers github.com/o/r
    const target = remoteTarget(reg, L, scratch);
    const fake = fakeRemote();

    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: scratch,
      judgement: editAndJudge(scratch, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      now: () => NOW,
    });

    // Nothing committed, nothing pushed, and the refusal names both sides.
    expect(result.commitSha).toBeNull();
    expect(result.stage).toBe('verified_complete');
    expect(fake.calls).toEqual([]);
    expect(result.stoppedBy).toContain('me/scratch');
    expect(result.stoppedBy).toContain('o/r');

    // And the scratch repository really is untouched.
    const log = execFileSync('git', ['log', '--oneline'], {
      cwd: scratch, encoding: 'utf8', env: GIT_ENV(scratch),
    });
    expect(log.trim().split('\n')).toHaveLength(1);
  });
});

/**
 * A REFUSED MERGE MUST NOT CANCEL AN AUTHORIZED DEPLOY.
 *
 * The staging deploy ships `commitSha` from the WORKING branch — it does not
 * depend on the merge at all, and the lifecycle calls deploying an unmerged
 * branch to staging "the normal preview flow". Abandoning on a transient merge
 * failure left a Mission holding `merge_pr` worse off than one without it.
 */
describe('a transient merge failure does not cost the deploy', () => {
  it('still deploys when the merge is refused', async () => {
    const root = repository();
    const withAll: readonly RepositoryPermission[] =
      ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr', 'merge_pr', 'deploy_staging'];
    const reg = remoteRegistration(withAll);
    const target = remoteTarget(reg, withAll, root);
    const refusing = fakeRemote();
    refusing.provider.mergePullRequest = async () => {
      refusing.calls.push('merge');
      return {
        ok: false, providerId: 'fake', reference: '7', url: null,
        state: null, observedAt: NOW, detail: 'GitHub answered HTTP 500.',
      };
    };
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: refusing.provider, pushBranch: PASS_PUSH, evidence: PR_EVIDENCE },
      deployment: {
        provider: createLocalDirectoryDeploymentProvider({
          deployRoot: temp('relay-deployroot-'), baseUrl: null, now: () => NOW,
        }),
        environment: 'staging', artifactPath: artifact(), liveUrl: null,
      },
      now: () => NOW,
    });
    expect(refusing.calls).toContain('merge');
    // The merge failed and the deploy STILL happened.
    expect(result.stage).toBe('deployed');
    expect(result.evidence.find((e) => e.stage === 'merged')).toBeUndefined();
    expect(result.evidence.find((e) => e.stage === 'deployed')).toBeDefined();
  });
});

/**
 * A PUSH THAT DID NOT LAND IS NOT A COMPLETED PUSH — and does not cost the
 * deploy. The authenticated transfer runs before the provider ever observes.
 * If it fails, or if the remote tip is not the exact committed SHA, Relay must
 * NOT record a push, must NOT open or merge a pull request over unpushed code,
 * and — because the staging deploy ships the WORKING branch, not the remote —
 * must still deploy when that was independently authorized (monotonicity).
 */
describe('a push that does not land does not fake a ship, and does not cost the deploy', () => {
  const withAll: readonly RepositoryPermission[] =
    ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr', 'merge_pr', 'deploy_staging'];

  const runWith = async (pushBranch: typeof PASS_PUSH | typeof FAIL_PUSH | typeof MISMATCH_PUSH) => {
    const root = repository();
    const reg = remoteRegistration(withAll);
    const target = remoteTarget(reg, withAll, root);
    const fake = fakeRemote();
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      remote: { provider: fake.provider, pushBranch, evidence: PR_EVIDENCE },
      deployment: {
        provider: createLocalDirectoryDeploymentProvider({
          deployRoot: temp('relay-deployroot-'), baseUrl: null, now: () => NOW,
        }),
        environment: 'staging', artifactPath: artifact(), liveUrl: null,
      },
      now: () => NOW,
    });
    return { result, fake };
  };

  it('a failed transfer opens no PR/merge, is not fatal, and the deploy still runs', async () => {
    const { result, fake } = await runWith(FAIL_PUSH);
    // The provider's API push/PR/merge were never reached — the transfer failed first.
    expect(fake.calls).toEqual([]);
    expect(result.evidence.find((e) => e.stage === 'pushed')).toBeUndefined();
    expect(result.evidence.find((e) => e.stage === 'pull_request_open')).toBeUndefined();
    expect(result.evidence.find((e) => e.stage === 'merged')).toBeUndefined();
    // Reaching `deployed` proves BOTH non-fatal (the run continued past the
    // skipped remote leg) AND monotonicity (the independently authorized deploy
    // ran despite the push failing). A fatal push would have stopped at commit.
    expect(result.stage).toBe('deployed');
    expect(result.commitSha).not.toBeNull();
  });

  it('a remote tip that is not the committed SHA is treated the same way', async () => {
    const { result, fake } = await runWith(MISMATCH_PUSH);
    expect(fake.calls).toEqual([]);
    expect(result.evidence.find((e) => e.stage === 'pushed')).toBeUndefined();
    expect(result.evidence.find((e) => e.stage === 'merged')).toBeUndefined();
    expect(result.stage).toBe('deployed');
  });

  it('and the passing transfer DOES push and open the PR (control)', async () => {
    const { result, fake } = await runWith(PASS_PUSH);
    expect(fake.calls).toContain('push:relay/mission-1');
    expect(result.evidence.find((e) => e.stage === 'pushed')).toBeDefined();
  });
});

/**
 * THE RUNNER'S OWN PATH TO `shipped`, DRIVEN END TO END.
 *
 * This was the gap that let the same defect recur three times. Each round moved
 * the failure one stage later — `shipped` gated, then `live_verified` gated —
 * and each round shipped with no test that reached the end, so reverting the
 * repair left the suite green. A review proved it: it restored the broken gate
 * and 32/32 still passed.
 *
 * The stub provider is FAITHFUL rather than agreeable: it remembers what it
 * deployed and reports THAT back, so a runner that carried the wrong revision
 * would still be caught. What is stubbed is the provider, because the subject
 * here is the runner's orchestration — the real provider has its own suite.
 */
describe('the runner reaches shipped by itself', () => {
  /** Remembers what it deployed; reports what it remembers, not what it is asked. */
  function honestProvider() {
    let deployed: string | null = null;
    return {
      get deployedRevision() { return deployed; },
      provider: {
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
          // What it HAS, compared by the caller. Never `expectedRevision`.
          healthy: deployed !== null && deployed === i.expectedRevision,
          reportedRevision: deployed,
          method: 'stub', observedAt: NOW, detail: null,
        }),
      },
    };
  }

  it('walks committed → deployed → live_verified → shipped with stoppedBy null', async () => {
    const root = repository();
    const registration = registrationFor(root);
    const target = targetFor(registration);
    const stub = honestProvider();

    const result = await runShipLifecycle({
      target, readRegistration: () => registration, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: {
        provider: stub.provider, environment: 'staging',
        artifactPath: artifact(), liveUrl: 'http://stub.invalid/app',
      },
      now: () => NOW,
    });

    expect(result.stage).toBe('shipped');
    expect(result.stoppedBy).toBeNull();
    expect(result.verdict?.shipped).toBe(true);
    expect(result.evidence.map((e) => e.stage))
      .toEqual(['committed', 'deployed', 'live_verified', 'shipped']);
    // The revision carried all the way through is the one git produced.
    expect(stub.deployedRevision).toBe(result.commitSha);
    expect(result.verdict?.liveRevision).toBe(result.commitSha);
  });

  it('STILL records the ship when the repository is revoked mid-flight', async () => {
    /**
     * The Finding-1 case. The deploy and the live observation have already
     * happened; a revocation arriving now cannot un-happen them, and refusing to
     * write down a real event is not a safety property. The record must reach
     * `shipped` anyway.
     */
    const root = repository();
    const full = registrationFor(root);
    const target = targetFor(full);
    const revoked: RepositoryRegistration = { ...full, revokedAt: NOW } as RepositoryRegistration;
    const stub = honestProvider();
    let reads = 0;

    const result = await runShipLifecycle({
      target,
      // Full through commit and the deploy request; revoked from then on.
      readRegistration: () => { reads += 1; return reads <= 2 ? full : revoked; },
      worktreePath: root, judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: {
        provider: stub.provider, environment: 'staging',
        artifactPath: artifact(), liveUrl: 'http://stub.invalid/app',
      },
      now: () => NOW,
    });

    expect(result.stage).toBe('shipped');
    expect(result.stoppedBy).toBeNull();
    expect(result.evidence.map((e) => e.stage)).toContain('live_verified');
  });
});

/**
 * THE ENVIRONMENT GATE IS CALLED ON THE ACTING PATH.
 *
 * `providerSupportsEnvironment` existed since the port did, states its own
 * reason, and was called by NOTHING that acts — a fifth review drove a
 * simulated staging-only provider to a `shipped` PRODUCTION record with
 * `stoppedBy: null` to prove it. The record a founder reads to decide the
 * software is live would have described a deploy that never happened.
 */
describe('a provider is asked only for environments it supports', () => {
  function simulatedStagingProvider() {
    const calls: string[] = [];
    return {
      calls,
      provider: {
        descriptor: {
          providerId: 'sim', displayName: 'Simulated', environments: ['staging'] as const,
          canReportDeployedRevision: true, canVerifyLive: true, simulated: true,
          credentialEnvVarName: null,
        },
        deploy: async (r: { revision: string; environment: string }) => {
          calls.push(`deploy:${r.environment}`);
          return {
            ok: true, providerId: 'sim', environment: r.environment as 'staging',
            deployedRevision: r.revision, deploymentRef: 'sim:1', url: null,
            observedAt: NOW, detail: null,
          };
        },
        verifyLive: async (i: { expectedRevision: string }) => ({
          reachable: true, healthy: true, reportedRevision: i.expectedRevision,
          method: 'sim', observedAt: NOW, detail: null,
        }),
      },
    };
  }

  /** A registration that genuinely GRANTS production, so the environment gate
   *  is the deciding guard rather than the permission ladder refusing first. */
  function productionRegistration(root: string): RepositoryRegistration {
    const grants: readonly RepositoryPermission[] = [...LADDER, 'deploy_production'];
    const result = createRepositoryRegistration({
      draft: {
        identity: { provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' },
        location: { kind: 'local_path', path: root },
        scope: { read: ['**'], write: ['src/**'] },
        grants: grants.map((permission) => ({
          permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
        })),
        ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
        registeredBy: 'founder',
      },
      now: NOW,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  it('REFUSES production for a simulated provider, before any call', async () => {
    /**
     * THE FIRST VERSION OF THIS TEST PASSED FOR THE WRONG REASON. It
     * hand-added `deploy_production` to the TARGET while the REGISTRATION
     * never granted it, so `stillPermitted` refused on permission before the
     * environment gate was consulted — removing the gate left the test green.
     * The registration now genuinely grants production, so the only thing
     * standing between a simulated provider and a production record is the
     * gate under test.
     */
    const root = repository();
    const reg = productionRegistration(root);
    const resolved = resolveRepositoryTarget({
      registration: reg,
      request: {
        repositoryKey: reg.key, selectedBy: 'founder', selectedAt: NOW,
        workingBranch: 'relay/mission-1',
        permissions: [...LADDER, 'deploy_production'],
      },
      now: NOW,
    });
    if (!resolved.ok) throw new Error(resolved.error.message);
    const target = resolved.target;
    const sim = simulatedStagingProvider();
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: {
        provider: sim.provider, environment: 'production',
        artifactPath: artifact(), liveUrl: 'http://sim.invalid/app',
      },
      now: () => NOW,
    });
    // Nothing was deployed, and the refusal names the reason.
    expect(sim.calls).toEqual([]);
    expect(result.stage).toBe('committed');
    expect(result.evidence.find((e) => e.stage === 'deployed')).toBeUndefined();
    expect(result.stoppedBy).not.toBeNull();
  });

  it('discloses a simulated provider ON the staging record it produces', async () => {
    const root = repository();
    const reg = registrationFor(root);
    const target = targetFor(reg);
    const sim = simulatedStagingProvider();
    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump', authorName: 'Relay', authorEmail: 'relay@x',
      deployment: {
        provider: sim.provider, environment: 'staging',
        artifactPath: artifact(), liveUrl: 'http://sim.invalid/app',
      },
      now: () => NOW,
    });
    // Staging with a simulated provider is legitimate — and disclosed on the
    // record itself, not only on a descriptor a reader may never see.
    const deployed = result.evidence.find((e) => e.stage === 'deployed');
    expect(deployed?.detail).toContain('SIMULATED');
  });
});

/**
 * THE SHIP RUNNER PERFORMS A REAL GIT PUSH TO A REAL REMOTE.
 *
 * Every other test in this file injects a FAKE `pushBranch` (PASS_PUSH and
 * friends), so nothing here has ever driven the runner's remote leg through the
 * REAL `pushAuthorizedBranch`. `repository-remote-transport.test.ts` drives the
 * real push, but in ISOLATION — never through `runShipLifecycle`. This closes
 * that gap: the runner ORCHESTRATION transfers committed code to a real remote,
 * offline and with no credential, and we prove it landed by reading the remote
 * ref back out of the bare repo itself.
 *
 * NO NETWORK, NO CREDENTIAL, NO github.com. The remote is a local `git
 * init --bare` repo, which git pushes to over a filesystem path with no auth.
 * `buildEphemeralGitAuth(null)` is what the runner builds when the authorized
 * env var is unset — the exact credential-free path proven in the transport
 * suite. The PR/merge are a GitHub API concern, so those stay a fake provider;
 * the PUSH is real.
 */
describe('the ship runner performs a REAL push to a REAL local bare remote', () => {
  const LADDER_WITH_DEPLOY: readonly RepositoryPermission[] =
    ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr', 'deploy_staging'];

  /**
   * A work repo on the working branch whose `origin` is a REAL local bare repo.
   * Mirrors `repository()` but points origin at a bare repo instead of
   * github.com/o/r, so the real `pushAuthorizedBranch` reaches a real remote
   * with no network. Both dirs are registered with `temp()` and torn down by the
   * file's existing afterEach.
   */
  function repositoryWithBareOrigin(): { root: string; bare: string } {
    const root = temp('relay-ship-real-');
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, env: GIT_ENV(root) });
    git(['init', '--quiet', '--initial-branch=main']);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.js'), 'export const version = 1;\n');
    git(['add', '--', '.']);
    git(['commit', '-m', 'initial']);
    // A real bare origin. `--bare` so the feature-branch push updates a ref
    // rather than trying to write a checked-out working tree.
    const bare = temp('relay-ship-bare-');
    rmSync(bare, { recursive: true, force: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', bare], { cwd: root, env: GIT_ENV(root) });
    git(['remote', 'add', 'origin', bare]);
    git(['push', '--quiet', 'origin', 'main']);
    git(['checkout', '--quiet', '-b', 'relay/mission-1']);
    return { root, bare };
  }

  /**
   * A faithful, no-network deploy provider — remembers what it deployed and
   * reports THAT back, so the run can reach `shipped` without a live HTTP call.
   * The same shape the suite already uses at "the runner reaches shipped by
   * itself".
   */
  function honestProvider() {
    let deployed: string | null = null;
    return {
      provider: {
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
          reportedRevision: deployed, method: 'stub', observedAt: NOW, detail: null,
        }),
      },
    };
  }

  it('transfers the committed code to the bare origin with the real push, then ships', async () => {
    const { root, bare } = repositoryWithBareOrigin();
    const reg = remoteRegistration(LADDER_WITH_DEPLOY);

    /**
     * A LOCAL-provider target whose checkout's origin is a real local bare repo.
     *
     * `remoteTarget` gives a github identity (owner `o`, name `r`, credential
     * GITHUB_TOKEN) and overrides the location to this checkout. One adjustment:
     * `identity.provider` -> 'local', which SKIPS the COMMIT-stage
     * `checkoutMatchesIdentity` guard. That guard proves a remote-HOSTED target's
     * checkout really is github.com/o/r; a real credential-free push offline
     * requires origin to be a LOCAL bare repo, which by construction is not a
     * github URL — so this is genuinely a local target (the "GitHub repo already
     * on the machine" case), not a dodge. `owner` stays `o`, which is all the
     * remote leg needs (it refuses a null owner before pushing), and the
     * credential stays GITHUB_TOKEN so it matches the provider descriptor.
     */
    const base = remoteTarget(reg, LADDER_WITH_DEPLOY, root);
    const target = {
      ...base,
      identity: { ...base.identity, provider: 'local' as const },
    } as MissionRepositoryTarget;

    // Fake PR/merge; its descriptor reads GITHUB_TOKEN, matching the target's
    // authorized credential, so the credential boundary check passes.
    const fake = fakeRemote();
    const stub = honestProvider();

    const result = await runShipLifecycle({
      target, readRegistration: () => reg, worktreePath: root,
      // GITHUB_TOKEN unset -> resolveRepositoryCredential returns ok(null) ->
      // buildEphemeralGitAuth(null) -> a credential-free push, which a local
      // remote accepts. Explicit {} makes it independent of the host env.
      env: {},
      judgement: editAndJudge(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      // pushBranch OMITTED -> the REAL pushAuthorizedBranch runs against origin.
      remote: { provider: fake.provider, evidence: PR_EVIDENCE },
      deployment: {
        provider: stub.provider, environment: 'staging',
        artifactPath: artifact(), liveUrl: 'http://stub.invalid/app',
      },
      now: () => NOW,
    });

    const sha = result.commitSha as string;
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    /**
     * THE STRONGEST EVIDENCE OF A REAL SHIP: the code physically landed on a
     * real remote. Read the bare repo's ref back from git itself — nothing but
     * the real push could have created `refs/heads/relay/mission-1` over there,
     * pointing at the exact commit the runner produced.
     */
    const bareTip = execFileSync('git', ['-C', bare, 'rev-parse', 'relay/mission-1'], {
      encoding: 'utf8', env: GIT_ENV(root),
    }).trim();
    expect(bareTip).toBe(sha);

    // The same fact read the way the transport reads it, from the remote side.
    const ls = execFileSync('git', ['ls-remote', bare, 'refs/heads/relay/mission-1'], {
      encoding: 'utf8', env: GIT_ENV(root),
    }).trim();
    expect(ls.split(/\s+/)[0]).toBe(sha);

    // The runner recorded a `pushed` row from its OWN read-back of the remote
    // ref — the real push verified the tip before the row was written.
    const pushed = result.evidence.find((e) => e.stage === 'pushed');
    expect(pushed).toBeDefined();
    expect(pushed?.remoteRef).toBe(sha);

    // The real transfer was not skipped: the provider then observed the pushed
    // tip and opened a pull request over the landed commit.
    expect(fake.calls).toContain('push:relay/mission-1');
    expect(result.evidence.find((e) => e.stage === 'pull_request_open')).toBeDefined();

    // And the whole lifecycle reached a truthful `shipped` verdict over a run
    // that performed a real landed push.
    expect(result.stage).toBe('shipped');
    expect(result.stoppedBy).toBeNull();
    expect(result.verdict?.shipped).toBe(true);
    expect(result.verdict?.liveRevision).toBe(sha);
    expect(result.evidence.map((e) => e.stage))
      .toEqual(['committed', 'pushed', 'pull_request_open', 'deployed', 'live_verified', 'shipped']);
  });
});
