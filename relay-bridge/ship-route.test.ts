import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { handleShipRoute } from './ship-route';
import {
  createRepositoryRegistration,
  resolveRepositoryTarget,
} from '../src/relay/mission/repository-target';
import { createRepositoryRegistrationStore } from '../src/relay/persistence';
import type {
  MissionRepositoryTarget,
  RepositoryPermission,
  RepositoryRegistration,
} from '../src/relay/mission/repository-target';

/**
 * SHIPPING A VERIFIED MISSION, THROUGH THE ROUTE, END TO END.
 *
 * The last join. An operator posts to `/mission/:id/ship`; the route reads the
 * retained worktree, re-judges it, and runs the ship tail against a real local
 * git repository and a real local deploy. The GitHub push is not here — it needs
 * a credential — but COMMIT → DEPLOY is real.
 */

const NOW = '2026-08-12T10:00:00.000Z';
const TOKEN = 'operator-token-0123456789abcdef';
const LADDER: readonly RepositoryPermission[] = ['read', 'write_worktree', 'commit', 'deploy_staging'];
const temporaries: string[] = [];

afterEach(() => {
  for (const p of temporaries.splice(0)) {
    try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function temp(prefix: string): string {
  const p = mkdtempSync(join(tmpdir(), prefix));
  temporaries.push(p);
  return p;
}

const GIT_ENV = (root: string) => ({
  PATH: process.env.PATH ?? '', HOME: root,
  GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@x',
  GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@x',
});

/**
 * A real repository, plus a "retained worktree" — a git worktree with an
 * in-scope edit already made, exactly the state the coding leg leaves for a
 * verified real-target mission.
 */
function verifiedMission(): {
  target: MissionRepositoryTarget;
  reg: RepositoryRegistration;
  worktreePath: string;
} {
  const root = temp('relay-shiproute-src-');
  const git = (a: string[], cwd = root) => execFileSync('git', a, { cwd, env: GIT_ENV(root) });
  git(['init', '--quiet', '--initial-branch=main']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const v = 1;\n');
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>\n');
  git(['add', '--', '.']);
  git(['commit', '-m', 'initial']);

  // The retained worktree: a git worktree on the working branch with the edit.
  const worktreePath = temp('relay-shiproute-wt-');
  rmSync(worktreePath, { recursive: true, force: true }); // git worktree add needs a non-existent path
  git(['worktree', 'add', '-b', 'relay/mission-1', worktreePath, 'main']);
  writeFileSync(join(worktreePath, 'src', 'app.js'), 'export const v = 2;\n');

  const built = createRepositoryRegistration({
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
  if (!built.ok) throw new Error(built.error.message);
  const resolved = resolveRepositoryTarget({
    registration: built.value,
    request: {
      repositoryKey: built.value.key, selectedBy: 'operator', selectedAt: NOW,
      workingBranch: 'relay/mission-1', permissions: [...LADDER],
    },
    now: NOW,
  });
  if (!resolved.ok) throw new Error(resolved.error.message);
  return { target: resolved.target, reg: built.value, worktreePath };
}

function storeWith(reg: RepositoryRegistration) {
  const s = createRepositoryRegistrationStore({ root: temp('relay-shiproute-store-') });
  s.save(reg);
  return s;
}

const env = { RELAY_BRIDGE_API_TOKEN: TOKEN } as NodeJS.ProcessEnv;
const opAuth = `Bearer ${TOKEN}`;

describe('POST /mission/:id/ship', () => {
  it('is operator-only', async () => {
    const m = verifiedMission();
    const r = await handleShipRoute(
      { method: 'POST', path: '/mission/m1/ship', authorization: undefined, body: {}, env, now: () => NOW },
      { shipContext: () => ({ target: m.target, worktreePath: m.worktreePath }), recordShipOutcome: () => {}, store: storeWith(m.reg) },
    );
    expect(r?.status).toBe(401);
  });

  it('refuses a mission that is not shippable', async () => {
    const m = verifiedMission();
    const r = await handleShipRoute(
      { method: 'POST', path: '/mission/m1/ship', authorization: opAuth, body: {}, env, now: () => NOW },
      { shipContext: () => null, recordShipOutcome: () => {}, store: storeWith(m.reg) },
    );
    expect(r?.status).toBe(409);
    expect((r?.body as { error: { kind: string } }).error.kind).toBe('mission_not_shippable');
  });

  it('COMMITS the retained worktree when no deploy is authorized', async () => {
    const m = verifiedMission();
    const r = await handleShipRoute(
      { method: 'POST', path: '/mission/m1/ship', authorization: opAuth, body: {}, env, now: () => NOW },
      { shipContext: () => ({ target: m.target, worktreePath: m.worktreePath }), recordShipOutcome: () => {}, store: storeWith(m.reg) },
    );
    expect(r?.status).toBe(200);
    const data = (r?.body as { data: { stage: string } }).data;
    expect(data.stage).toBe('committed');
    // The retained worktree is disposed after the ship.
    expect(existsSync(m.worktreePath)).toBe(false);
  });

  it('COMMITS then DEPLOYS the verified change, for real', async () => {
    const m = verifiedMission();
    const deployRoot = temp('relay-shiproute-deploy-');
    const r = await handleShipRoute(
      {
        method: 'POST', path: '/mission/m1/ship', authorization: opAuth,
        body: { deploy: { environment: 'staging', deployRoot, baseUrl: null } },
        env, now: () => NOW,
      },
      { shipContext: () => ({ target: m.target, worktreePath: m.worktreePath }), recordShipOutcome: () => {}, store: storeWith(m.reg) },
    );
    expect(r?.status).toBe(200);
    const data = (r?.body as { data: { stage: string; shipped: boolean } }).data;
    // deployed (staging), not shipped — nothing observed the running system.
    expect(data.stage).toBe('deployed');
    // The commit landed on the WORKING branch (relay/mission-1), which the
    // reaching-deployed stage already proves — a deploy requires a commit.
    const onBranch = execFileSync('git', ['log', '--oneline', 'relay/mission-1'], {
      cwd: (m.target.location as { path: string }).path, encoding: 'utf8', env: GIT_ENV((m.target.location as { path: string }).path),
    });
    expect(onBranch).toContain('Relay mission');
    // The retained worktree is disposed after the ship.
    expect(existsSync(m.worktreePath)).toBe(false);
  });

  it('does not leave the worktree behind even when the ship refuses, and records the attempt', async () => {
    const m = verifiedMission();
    const recorded: Array<{ id: string; shipped: boolean }> = [];
    const r = await handleShipRoute(
      {
        method: 'POST', path: '/mission/m1/ship', authorization: opAuth,
        // A remote authorization that names no credential → the seam refuses.
        body: { remote: { provider: 'github', credentialEnvVarName: '  ', pullRequestTitle: 't', pullRequestBody: { missionId: 'm', objective: 'o', artifactDigest: null, reviewedArtifactDigest: null, reviewerVerdict: null, reviewerFindings: [], relayVerification: [], attestations: [], baselineSha: null } } },
        env, now: () => NOW,
      },
      {
        shipContext: () => ({ target: m.target, worktreePath: m.worktreePath }),
        recordShipOutcome: (id, o) => recorded.push({ id, shipped: o.shipped }),
        store: storeWith(m.reg),
      },
    );
    expect(r?.status).toBe(422);
    expect(existsSync(m.worktreePath)).toBe(false);
    // The finally records the attempt even on a refusal — the worktree it would
    // re-ship is gone, so the mission must stop presenting as shippable.
    expect(recorded).toEqual([{ id: 'm1', shipped: false }]);
  });

  it('refuses when the targeted repository is no longer registered', async () => {
    const m = verifiedMission();
    const emptyStore = createRepositoryRegistrationStore({ root: temp('relay-shiproute-empty-') });
    const r = await handleShipRoute(
      { method: 'POST', path: '/mission/m1/ship', authorization: opAuth, body: {}, env, now: () => NOW },
      { shipContext: () => ({ target: m.target, worktreePath: m.worktreePath }), recordShipOutcome: () => {}, store: emptyStore },
    );
    expect(r?.status).toBe(404);
    expect((r?.body as { error: { kind: string } }).error.kind).toBe('repository_not_registered');
  });

  it('refuses with 422 baseline_unresolved when the target base branch does not resolve', async () => {
    const m = verifiedMission();
    // The target names a base branch absent from the retained worktree, so
    // `git rev-parse` cannot resolve it — the only failure path of the ship
    // route's `resolveBaselineSha` gate.
    const brokenTarget = { ...m.target, baseBranch: 'refs/heads/nonexistent-base' };
    const r = await handleShipRoute(
      { method: 'POST', path: '/mission/m1/ship', authorization: opAuth, body: {}, env, now: () => NOW },
      { shipContext: () => ({ target: brokenTarget, worktreePath: m.worktreePath }), recordShipOutcome: () => {}, store: storeWith(m.reg) },
    );
    expect(r?.status).toBe(422);
    expect((r?.body as { error: { kind: string } }).error.kind).toBe('baseline_unresolved');
    // A pre-flight refusal is RETRYABLE, so the retained worktree is deliberately
    // KEPT — the operator can fix the base branch and ship again.
    expect(existsSync(m.worktreePath)).toBe(true);
  });

  it('records a successful ship (keyed by mission id) so it stops being shippable', async () => {
    const m = verifiedMission();
    const recorded: Array<{ id: string; shipped: boolean }> = [];
    const r = await handleShipRoute(
      { method: 'POST', path: '/mission/m1/ship', authorization: opAuth, body: {}, env, now: () => NOW },
      {
        shipContext: () => ({ target: m.target, worktreePath: m.worktreePath }),
        recordShipOutcome: (id, o) => recorded.push({ id, shipped: o.shipped }),
        store: storeWith(m.reg),
      },
    );
    expect(r?.status).toBe(200);
    // A commit-only ship is `committed`, not live-verified, so shipped:false —
    // but the attempt IS recorded, which is what makes shipContext null out.
    expect(recorded).toEqual([{ id: 'm1', shipped: false }]);
  });
});
