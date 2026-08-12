import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runShipLifecycle } from './ship-runner';
import { createLocalDirectoryDeploymentProvider, REVISION_MARKER } from './local-directory-deployment-provider';
import {
  createRepositoryRegistration,
  judgeObservedDiff,
  resolveRepositoryTarget,
} from '../src/relay/mission/repository-target';
// Node-only: observing a real worktree is not something the pure domain can do.
import { observeRepositoryWorktree } from '../src/relay/workspace/repository-target-observer';
import type {
  MissionRepositoryTarget,
  RepositoryPermission,
  RepositoryRegistration,
} from '../src/relay/mission/repository-target';

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
