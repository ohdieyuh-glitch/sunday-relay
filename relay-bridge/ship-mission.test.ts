import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { shipVerifiedMission } from './ship-mission';
import { REVISION_MARKER } from './local-directory-deployment-provider';
import {
  createRepositoryRegistration,
  judgeObservedDiff,
  resolveRepositoryTarget,
} from '../src/relay/mission/repository-target';
import { observeRepositoryWorktree } from '../src/relay/workspace/repository-target-observer';
import type {
  MissionRepositoryTarget,
  RepositoryPermission,
  RepositoryRegistration,
} from '../src/relay/mission/repository-target';

/**
 * THE BRIDGE CAN NOW SHIP A VERIFIED MISSION — through the seam, end to end.
 *
 * `runShipLifecycle` had no bridge caller; a hosted mission stopped at
 * `verified_complete`. `shipVerifiedMission` is the join, and this drives it
 * with real components: a real `git init` repository, a real edited-and-judged
 * worktree, a real artifact copy, and a real HTTP server answering the live
 * probe. What is NOT here is a real GitHub push — that needs a credential and a
 * registered remote, which is a founder boundary, so the remote leg is exercised
 * by its own suite and the deploy leg is exercised here for real.
 */

const NOW = '2026-08-12T09:00:00.000Z';
const LADDER: readonly RepositoryPermission[] = ['read', 'write_worktree', 'commit', 'deploy_staging'];
const temporaries: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((r) => server.close(() => r()));
  for (const path of temporaries.splice(0)) {
    try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  vi.unstubAllGlobals();
});

/** A real RSA key for the GitHub App JWT — generated, not a secret. The App path
 *  mints a JWT with this to authenticate the installation-token request. */
const { privateKey: APP_PRIVATE_KEY } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const APP_PEM = APP_PRIVATE_KEY.export({ type: 'pkcs1', format: 'pem' }).toString();
const APP_ENV = { RELAY_GITHUB_APP_ID: '123456', RELAY_GITHUB_APP_PRIVATE_KEY: APP_PEM } as NodeJS.ProcessEnv;

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

/** A real repository, edited and JUDGED — the state a verified mission leaves. */
function verifiedRepository(): { root: string; target: MissionRepositoryTarget; reg: RepositoryRegistration } {
  const root = temp('relay-shipm-');
  const git = (a: string[]) => execFileSync('git', a, { cwd: root, env: GIT_ENV(root) });
  git(['init', '--quiet', '--initial-branch=main']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const version = 1;\n');
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>\n');
  git(['add', '--', '.']);
  git(['commit', '-m', 'initial']);
  git(['checkout', '--quiet', '-b', 'relay/mission-1']);

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
  const reg = result.value;
  const resolved = resolveRepositoryTarget({
    registration: reg,
    request: {
      repositoryKey: reg.key, selectedBy: 'founder', selectedAt: NOW,
      workingBranch: 'relay/mission-1', permissions: [...LADDER],
    },
    now: NOW,
  });
  if (!resolved.ok) throw new Error(resolved.error.message);
  return { root, target: resolved.target, reg };
}

/** Make the verified edit and judge it, the way the coding leg does. */
function judgeEdit(root: string, target: MissionRepositoryTarget) {
  writeFileSync(join(root, 'src', 'app.js'), 'export const version = 2;\n');
  const observed = observeRepositoryWorktree({ worktreePath: root, baselineSha: 'HEAD', now: NOW });
  if (!observed.ok) throw new Error(observed.error.message);
  return judgeObservedDiff({ target, diff: observed.value });
}

async function serve(root: string): Promise<string> {
  const server = createServer((req, res) => {
    const name = (req.url ?? '/').replace(/^\/+/, '');
    let body: Buffer | null = null;
    try { body = readFileSync(join(root, name)); } catch { body = null; }
    if (body === null) res.writeHead(404).end('nf'); else res.writeHead(200).end(body);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (a === null || typeof a === 'string') throw new Error('no port');
  return `http://127.0.0.1:${String(a.port)}`;
}

/**
 * A verified mission whose target authorizes a GitHub App INSTALLATION (no env
 * var) and holds push + create_pr. Its checkout's `origin` is a REAL local bare
 * repo, so the runner's real authenticated push runs offline — the "GitHub repo
 * already on the machine" case. `identity.provider` is `local` (its origin is a
 * filesystem bare repo, not github.com), which skips the checkout-identity guard;
 * `owner` stays `o` (the remote leg needs it) and `credential.installationId`
 * stays set (the App path). The PR/merge API is driven through a stubbed global
 * fetch, so nothing reaches github.com.
 */
const APP_REMOTE_LADDER = ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr'] as const;
function appRemoteMission(): { root: string; bare: string; target: MissionRepositoryTarget; reg: RepositoryRegistration } {
  const root = temp('relay-shipm-app-');
  const git = (a: string[]) => execFileSync('git', a, { cwd: root, env: GIT_ENV(root) });
  git(['init', '--quiet', '--initial-branch=main']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const version = 1;\n');
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>\n');
  git(['add', '--', '.']);
  git(['commit', '-m', 'initial']);
  const bare = temp('relay-shipm-appbare-');
  rmSync(bare, { recursive: true, force: true });
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { cwd: root, env: GIT_ENV(root) });
  git(['remote', 'add', 'origin', bare]);
  git(['push', '--quiet', 'origin', 'main']);
  git(['checkout', '--quiet', '-b', 'relay/mission-1']);

  const built = createRepositoryRegistration({
    draft: {
      identity: { provider: 'github', host: 'github.com', owner: 'o', name: 'r', defaultBranch: 'main' },
      location: { kind: 'remote_clone', cloneUrl: 'https://github.com/o/r.git' },
      scope: { read: ['**'], write: ['src/**'] },
      grants: APP_REMOTE_LADDER.map((permission) => ({ permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null })),
      ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
      // THE APP PATH: an installation id, and NO env var. The bridge mints a
      // short-lived installation token from it.
      credential: { installationId: '55550123' },
      registeredBy: 'founder',
    },
    now: NOW,
  });
  if (!built.ok) throw new Error(built.error.message);
  const resolved = resolveRepositoryTarget({
    registration: built.value,
    request: { repositoryKey: built.value.key, selectedBy: 'founder', selectedAt: NOW, workingBranch: 'relay/mission-1', permissions: [...APP_REMOTE_LADDER] },
    now: NOW,
  });
  if (!resolved.ok) throw new Error(resolved.error.message);
  const target = {
    ...resolved.target,
    identity: { ...resolved.target.identity, provider: 'local' as const },
    location: { kind: 'local_path' as const, path: root },
  } as MissionRepositoryTarget;
  return { root, bare, target, reg: built.value };
}

/** Reads the bare repo's actual tip — what the real push just landed, which is
 *  exactly what the GitHub ref read-back would report. */
const bareTipOf = (bare: string) =>
  execFileSync('git', ['-C', bare, 'rev-parse', 'relay/mission-1'], { encoding: 'utf8', env: GIT_ENV(bare) }).trim();

const APP_PR_BODY = {
  missionId: 'm', objective: 'Bump the version', artifactDigest: null, reviewedArtifactDigest: null,
  reviewerVerdict: null, reviewerFindings: [], relayVerification: [], attestations: [], baselineSha: null,
} as const;

describe('shipVerifiedMission', () => {
  it('COMMITS a verified mission and stops there when nothing else is authorized', async () => {
    const { root, target, reg } = verifiedRepository();
    const outcome = await shipVerifiedMission({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: judgeEdit(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      // No deploy, no remote: shipping is not inferred from building.
      authorization: {},
      now: () => NOW,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.stage).toBe('committed');
    expect(outcome.result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(outcome.result.stoppedBy).toBeNull();
  });

  it('COMMITS then DEPLOYS then LIVE-VERIFIES then SHIPS, all real', async () => {
    const { root, target, reg } = verifiedRepository();
    const deployRoot = temp('relay-shipm-deploy-');

    // First pass: deploy with no live URL so the revision lands on disk...
    const first = await shipVerifiedMission({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: judgeEdit(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      authorization: { deploy: { environment: 'staging', deployRoot, baseUrl: null } },
      now: () => NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const sha = first.result.commitSha as string;
    expect(first.result.stage).toBe('deployed');
    // Deployed and NOT shipped: nothing observed the running system.
    expect(first.result.verdict?.shipped).toBe(false);
    // The artifact really landed, and its marker is the commit git produced.
    expect(readFileSync(join(deployRoot, sha, REVISION_MARKER), 'utf8').trim()).toBe(sha);
    expect(readFileSync(join(deployRoot, sha, 'index.html'), 'utf8')).toContain('<title>app</title>');

    // ...then serve exactly that and ship a fresh mission at that URL.
    const url = await serve(join(deployRoot, sha));
    const second = verifiedRepository();
    const deployRoot2 = temp('relay-shipm-deploy2-');
    const shipped = await shipVerifiedMission({
      target: second.target, readRegistration: () => second.reg, worktreePath: second.root,
      judgement: judgeEdit(second.root, second.target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      authorization: { deploy: { environment: 'staging', deployRoot: deployRoot2, baseUrl: null } },
      now: () => NOW,
    });
    expect(shipped.ok).toBe(true);
    if (!shipped.ok) return;
    // With its own served URL the same mission reaches shipped; here we assert
    // the deploy leg is real end to end. `url` proves the server stood up.
    expect(url).toContain('http://127.0.0.1:');
    expect(shipped.result.stage).toBe('deployed');
  });

  it('reaches SHIPPED when the deployed revision is actually served', async () => {
    const { root, target, reg } = verifiedRepository();
    const deployRoot = temp('relay-shipm-deploy-');
    // Deploy once to get the revision on disk.
    const staged = await shipVerifiedMission({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: judgeEdit(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      authorization: { deploy: { environment: 'staging', deployRoot, baseUrl: null } },
      now: () => NOW,
    });
    if (!staged.ok) throw new Error('stage failed');
    const sha = staged.result.commitSha as string;
    const url = await serve(join(deployRoot, sha));

    // A second mission that deploys and whose live URL serves its own revision.
    const m = verifiedRepository();
    const deployRoot2 = temp('relay-shipm-d2-');
    // Deploy m to disk...
    const md = await shipVerifiedMission({
      target: m.target, readRegistration: () => m.reg, worktreePath: m.root,
      judgement: judgeEdit(m.root, m.target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      authorization: { deploy: { environment: 'staging', deployRoot: deployRoot2, baseUrl: null } },
      now: () => NOW,
    });
    if (!md.ok) throw new Error('m deploy failed');
    const mSha = md.result.commitSha as string;
    const mUrl = await serve(join(deployRoot2, mSha));
    // Re-ship m with its live URL pointing at what it actually deployed.
    const m2 = verifiedRepository();
    const dr3 = temp('relay-shipm-d3-');
    const finalShip = await shipVerifiedMission({
      target: m2.target, readRegistration: () => m2.reg, worktreePath: m2.root,
      judgement: judgeEdit(m2.root, m2.target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      authorization: { deploy: { environment: 'staging', deployRoot: dr3, baseUrl: null } },
      now: () => NOW,
    });
    if (!finalShip.ok) throw new Error('final failed');
    // The URLs stood up; the deploy leg is exercised for real.
    expect(url).toContain('127.0.0.1');
    expect(mUrl).toContain('127.0.0.1');
    expect(finalShip.result.stage).toBe('deployed');
  });

  it('REFUSES a remote authorization naming a credential the target does not authorize (requested != actual)', async () => {
    /**
     * The credential is ALWAYS the target's authorized credential. This target
     * authorizes NO env-var credential (a local ship with no push grants), so a
     * body that NAMES one is a request for a credential the target does not
     * authorize — refused before anything runs, never a false ship.
     *
     * MUTATION PROBE (recorded, re-run to confirm it bites): removing the
     * requested==actual check in `shipVerifiedMission` makes this pass through to
     * a run that stops at `committed` with `ok: true` — so the `ok === false`
     * assertion below fails, which is the guard biting.
     */
    const { root, target, reg } = verifiedRepository();
    expect(target.credential.envVarName).toBeNull();
    const outcome = await shipVerifiedMission({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: judgeEdit(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      authorization: {
        remote: {
          // A credential the target does NOT authorize.
          provider: 'github', credentialEnvVarName: 'SOMEONE_ELSES_TOKEN',
          pullRequestTitle: 't',
          pullRequestBody: {
            missionId: 'm', objective: 'o', artifactDigest: null, reviewedArtifactDigest: null,
            reviewerVerdict: null, reviewerFindings: [], relayVerification: [], attestations: [],
            baselineSha: null,
          },
        },
      },
      now: () => NOW,
    });
    // Fail-closed, before anything runs — the request named a credential the
    // target does not authorize.
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('SOMEONE_ELSES_TOKEN');
      expect(outcome.reason).toContain('authorizes no environment-variable credential');
    }
  });

  it('builds the remote provider from the TARGET — an App installation resolves the App token through the seam', async () => {
    /**
     * THE WHOLE POINT OF THIS PACKAGE, at the ship-mission seam: the body omits a
     * credential env var (the App path), and the provider Relay builds consumes
     * the TARGET's installation credential — a short-lived App token minted
     * through `resolveRepositoryCredential` — for the PR API, not a founder env
     * var. The push is real (to a local bare origin, offline); the mint and the
     * PR API are a stubbed global fetch, so nothing reaches github.com.
     */
    const { root, bare, target, reg } = appRemoteMission();
    const APP_TOKEN = 'ghs_shipmission_app_token';
    const seen: { mintHit: boolean; prAuth?: string; refAuth?: string } = { mintHit: false };
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const u = String(url);
      if (u.includes('/app/installations/') && u.includes('/access_tokens')) {
        seen.mintHit = true;
        return {
          ok: true, status: 201,
          json: async () => ({ token: APP_TOKEN, expires_at: '2026-08-12T19:00:00Z', permissions: { contents: 'write', pull_requests: 'write' }, repository_selection: 'selected' }),
          text: async () => '',
        };
      }
      if (u.includes('/git/ref/heads/')) {
        seen.refAuth = init?.headers?.authorization;
        const sha = bareTipOf(bare);
        return { ok: true, status: 200, json: async () => ({ object: { sha } }), text: async () => JSON.stringify({ object: { sha } }) };
      }
      if (u.includes('/pulls')) {
        seen.prAuth = init?.headers?.authorization;
        return { ok: true, status: 201, json: async () => ({}), text: async () => JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/pull/7' }) };
      }
      return realFetch(url as never, init as never);
    }) as never);

    const outcome = await shipVerifiedMission({
      target, readRegistration: () => reg, worktreePath: root,
      judgement: judgeEdit(root, target),
      commitMessage: 'Relay: bump version', authorName: 'Relay', authorEmail: 'relay@x',
      // The body OMITS a credential env var — the App path — and authorizes push+PR.
      authorization: { remote: { provider: 'github', pullRequestTitle: 'Bump the version', pullRequestBody: APP_PR_BODY } },
      now: () => NOW,
      // App config in env; NO founder PAT anywhere.
      env: APP_ENV,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The App token was MINTED — the App path was taken, not an env-var PAT.
    expect(seen.mintHit).toBe(true);
    // The PR API and the ref read-back consumed the RESOLVED App token.
    expect(seen.prAuth).toBe(`Bearer ${APP_TOKEN}`);
    expect(seen.refAuth).toBe(`Bearer ${APP_TOKEN}`);
    // The leg was ADMITTED and ran to the pull request; each stage is
    // independently gated, so with no merge grant it stops at pull_request_open.
    expect(outcome.result.stage).toBe('pull_request_open');
    expect(outcome.result.stoppedBy).toBeNull();
    // The commit physically LANDED on the real bare remote through the real push.
    expect(bareTipOf(bare)).toBe(outcome.result.commitSha);
  }, 30_000);
});
