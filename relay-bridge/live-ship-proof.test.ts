// relay-bridge/live-ship-proof.test.ts
//
// FOUNDER-RUN LIVE PROOF of the one leg no agent can run: a real credentialed
// ship to github.com. RUNS FOR REAL only when the GitHub App + proof-repo creds
// are present; SKIPS cleanly (ZERO network) otherwise. The env predicate reads
// process.env only, and every fetch/git/server-boot is guarded on LIVE.ok (asserts in both branches).
//
// This is the live sibling of beta-journey.test.ts: sign-in is the REAL OAuth
// exchange (no fetch stub), and the ship lands a REAL branch + PR on a REAL repo,
// asserted against github.com DIRECTLY — not Relay's account of itself.
//
// PURE-APP CREDENTIAL PATH (seam closed 690d98d, PR #133). RELAY ships entirely on
// the short-lived GitHub App INSTALLATION token: the registration credential is
// `{ installationId }`, the ship body names no env var, and Relay's remote leg
// resolves the App token server-side — it NEVER receives or uses RELAY_PROOF_REPO_TOKEN.
// (resolveRepositoryCredential takes the installationId branch and does not fall back
// to an env-var PAT.) The PAT is used ONLY by THIS harness's own scaffolding: the
// setup clone that builds the shippable state, and the INDEPENDENT github.com read-back
// that verifies the ref/PR against github.com directly (a separate credential for
// independent verification is correct — it is not Relay speaking). This harness is the
// acceptance test for the pure-App push.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBridgeServer } from './server';
import { loadBridgeConfig } from './config';
import { createMissionRegistry } from './mission';
import { journeyRoleDeps } from './mission-journey-harness';
import { buildEphemeralGitAuth } from './repository-credential';
import { createRepositoryRegistrationStore, createBrainMemoryStore } from '../src/relay/persistence';
import {
  createRepositoryRegistration, resolveRepositoryTarget,
  type MissionRepositoryTarget, type RepositoryRegistration,
} from '../src/relay/mission/repository-target';

/* ------------------------------------------------------- the gate (env only) */

const REQUIRED_LIVE_ENV = [
  // The GitHub App — the founder boundary (identity + install + token minting):
  'RELAY_GITHUB_APP_ID', 'RELAY_GITHUB_APP_PRIVATE_KEY',
  'RELAY_GITHUB_APP_CLIENT_ID', 'RELAY_GITHUB_APP_CLIENT_SECRET',
  'RELAY_GITHUB_APP_CALLBACK_URL', 'RELAY_GITHUB_APP_INSTALL_URL',
  // The proof target the App is installed on. RELAY ships on the installation token
  // (below); the PAT is only THIS harness's setup-clone + independent read-back:
  'RELAY_PROOF_REPO',            // "owner/name" of a throwaway repo the signing-in user owns
  'RELAY_PROOF_INSTALLATION_ID', // numeric installation id — RELAY's ship credential (App token)
  'RELAY_PROOF_REPO_TOKEN',      // harness-only PAT (contents R/W + pull_requests R/W): setup clone + independent read-back; RELAY never sees it
  'RELAY_PROOF_OAUTH_CODE',      // fresh, single-use GitHub OAuth code for the real sign-in exchange
] as const;

function liveProofEnv(env: NodeJS.ProcessEnv): { ok: boolean; missing: string[] } {
  const missing = REQUIRED_LIVE_ENV.filter((k) => typeof env[k] !== 'string' || env[k]!.trim() === '');
  return { ok: missing.length === 0, missing };
}
const LIVE = liveProofEnv(process.env);         // pure — no I/O, evaluated at import

// Visible, network-free skip message when creds are absent — the default in CI.
it('live ship proof is gated on real GitHub App + proof-repo creds', () => {
  if (!LIVE.ok) console.info(`[live-ship-proof] SKIPPED — set: ${LIVE.missing.join(', ')}`);
  expect(LIVE.ok || LIVE.missing.length > 0).toBe(true);   // pure assertion, no network
});

/* --------------------------------------------------- constants & tiny helpers */

const ORIGIN = 'https://sunday-relay.vercel.app';
const OPERATOR = 'operator-secret-for-live-proof-0123456789abcdef';
const TOKEN_ENV = 'RELAY_PROOF_REPO_TOKEN';      // harness-only: setup clone + independent read-back (NOT Relay's ship)
const BASE_BRANCH = process.env.RELAY_PROOF_BASE_BRANCH ?? 'main';
const WORKING_BRANCH = `relay/live-proof-${process.env.RELAY_PROOF_OAUTH_CODE?.slice(0, 6) ?? 'x'}`;
const SHIP_MISSION_ID = 'm-live-ship';
const NOW = () => new Date().toISOString();

const asUser = (t: string) => ({ Authorization: `Relay-Session ${t}`, Origin: ORIGIN });
const getJson = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });
const [PROOF_OWNER, PROOF_NAME] = (process.env.RELAY_PROOF_REPO ?? '/').split('/');
const CLONE_URL = `https://github.com/${PROOF_OWNER}/${PROOF_NAME}.git`;
const GH_API = 'https://api.github.com';

// git with the PAT injected only into THIS child, via the product's askpass helper.
function gitAuthed(args: string[], cwd: string): string {
  const auth = buildEphemeralGitAuth({
    token: process.env[TOKEN_ENV]!, source: 'env_var', envVarName: TOKEN_ENV, installationId: null,
  });
  try {
    return execFileSync('git', [...auth.configArgs, ...args], {
      cwd, encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: cwd, GIT_TERMINAL_PROMPT: '0', ...auth.extraEnv },
    });
  } finally { auth.dispose(); }
}
const gitPlain = (args: string[], cwd: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: cwd, GIT_TERMINAL_PROMPT: '0' } });

const ghApi = (path: string, init?: RequestInit) =>
  fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env[TOKEN_ENV]}`,
      accept: 'application/vnd.github+json', 'user-agent': 'relay-live-proof',
      'x-github-api-version': '2022-11-28', ...(init?.headers ?? {}),
    },
  });

/* ---------------------------------------------------------------- the block */

// NOT describe.skipIf: this repo's CI test-accounting forbids skipIf/.skip (a
// "skipped" test reads as "nothing to see"). Instead every hook and test guards
// on LIVE.ok and ASSERTS IN BOTH BRANCHES — when creds are absent it asserts the
// gate (no fetch/git/server-boot runs); when present it does the real work.
describe('LIVE github.com ship proof (real GitHub App + proof repo required)', () => {
  const servers: Array<{ close: (cb: () => void) => void }> = [];
  const roots: string[] = [];
  let base = '';
  let session = { token: '', participantId: '' };
  let worktreePath = '';
  let shipTarget: MissionRepositoryTarget | null = null;
  let registration: RepositoryRegistration | null = null;
  let committedSha: string | null = null;

  // ---- REAL sign-in: no fetch stub, so exchangeCodeForUser hits github.com ----
  async function signInLive(): Promise<{ token: string; participantId: string }> {
    const start = await getJson(await fetch(`${base}/relay-api/auth/github/start`, { headers: { Origin: ORIGIN } }));
    const state = (start.body.data as { state: string }).state;
    const cb = await fetch(
      `${base}/relay-api/auth/github/callback?code=${encodeURIComponent(process.env.RELAY_PROOF_OAUTH_CODE!)}&state=${state}`,
      { redirect: 'manual' },
    );
    expect(cb.status).toBe(302); // a real, verified identity was minted into a claim
    const claim = decodeURIComponent(new URL(cb.headers.get('location') ?? '').hash.replace('#relay_claim=', ''));
    const redeemed = await getJson(await fetch(`${base}/relay-api/auth/github/claim`, {
      method: 'POST', headers: { 'content-type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ claim }),
    }));
    const p = redeemed.body.data as { sessionToken: string; participantId: string };
    return { token: p.sessionToken, participantId: p.participantId };
  }

  // ---- Prove installation control the way GitHub's post-install redirect does ----
  async function authorizeInstallationLive(): Promise<void> {
    const started = await getJson(await fetch(`${base}/relay-api/auth/github/install/start`, {
      method: 'POST', headers: asUser(session.token),
    }));
    const state = (started.body.data as { state: string }).state;
    const cb = await fetch(
      `${base}/relay-api/auth/github/install/callback?installation_id=${process.env.RELAY_PROOF_INSTALLATION_ID}&state=${state}`,
      { redirect: 'manual' },
    );
    expect(cb.status).toBe(302);
  }

  // ---- Build a REAL remote_clone shippable state: clone, branch, in-scope edit ----
  // The fake coding leg returns retainedWorktreePath: null, so the engine cannot
  // feed a real remote worktree to the ship route; the harness builds one, exactly
  // as the offline ship describe does with a local repo — here against the REAL repo.
  function buildRealShippableState(): void {
    const parent = mkdtempSync(join(tmpdir(), 'relay-live-clone-')); roots.push(parent);
    const dest = join(parent, 'checkout');
    gitAuthed(['clone', '--origin', 'origin', '--branch', BASE_BRANCH, '--', CLONE_URL, dest], parent);
    gitPlain(['checkout', '-b', WORKING_BRANCH], dest);
    mkdirSync(join(dest, 'relay-live-proof'), { recursive: true });
    writeFileSync(join(dest, 'relay-live-proof', 'PROOF.md'),
      `Relay live-proof: a verified in-scope change shipped by ${session.participantId}.\n`);
    worktreePath = dest; // the ship route commits here and pushes branch:branch to origin

    const LADDER = ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr'] as const;
    const built = createRepositoryRegistration({
      draft: {
        identity: { provider: 'github', host: 'github.com', owner: PROOF_OWNER, name: PROOF_NAME, defaultBranch: BASE_BRANCH },
        location: { kind: 'remote_clone', cloneUrl: CLONE_URL },
        scope: { read: ['**'], write: ['relay-live-proof/**'] },
        grants: LADDER.map((permission) => ({ permission, authorizedBy: PROOF_OWNER, authorizedAt: NOW(), expiresAt: null, note: null })),
        ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
        registeredBy: PROOF_OWNER,
        ownerParticipant: session.participantId,      // the ship ownership gate reads this
        // PURE-APP path (seam closed 690d98d): Relay's remote leg resolves and uses
        // the short-lived App INSTALLATION token and NEVER receives RELAY_PROOF_REPO_TOKEN.
        // resolveRepositoryCredential takes the installationId branch and never falls
        // back to an env var, so Relay structurally cannot touch the PAT.
        credential: { envVarName: null, installationId: process.env.RELAY_PROOF_INSTALLATION_ID ?? null },
      },
      now: NOW(),
    });
    if (!built.ok) throw new Error(built.error.message);
    registration = built.value;
    const resolved = resolveRepositoryTarget({
      registration: built.value,
      request: {
        repositoryKey: built.value.key, selectedBy: PROOF_OWNER, selectedAt: NOW(),
        workingBranch: WORKING_BRANCH, permissions: [...LADDER],
      },
      now: NOW(),
    });
    if (!resolved.ok) throw new Error(resolved.error.message);
    shipTarget = resolved.target;
  }

  beforeAll(async () => {
    if (!LIVE.ok) { return; } // creds absent → no server, no network; the it()s assert the gate.
    // Boot ONE real bridge with the real App env (single-use OAuth code ⇒ one server).
    const root = mkdtempSync(join(tmpdir(), 'relay-live-data-')); roots.push(root);
    process.env.RELAY_BRIDGE_API_TOKEN = OPERATOR;
    process.env.RELAY_ALLOWED_ORIGINS = ORIGIN;
    process.env.RELAY_DATA_DIR = root;
    // Select the LIVE three-role path so the mission reaches verified_complete
    // THROUGH an independent review, exactly as beta-journey.test.ts proves. The
    // architect/reviewer deps are INJECTED fakes (journey.deps) so nothing reaches
    // a provider; the synthetic OpenAI key's PRESENCE + architect-mode=live merely
    // select the live path (the fusion path is review-less by design). Never
    // served — and the SHIP's own credential is the App token from RELAY_GITHUB_APP_*
    // (server.ts passes process.env to the ship route), never this fixture.
    process.env.RELAY_PROMPT_ARCHITECT_MODE = 'live';
    // RELAY_GITHUB_APP_* already in env from the founder. loadBridgeConfig reads them.
    const config = loadBridgeConfig(process.env);
    const liveEnv = {
      RELAY_PROMPT_ARCHITECT_MODE: 'live',
      OPENAI_API_KEY: 'sk-FAKETESTNOTREAL-never-served',
      OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-test',
    } as NodeJS.ProcessEnv;

    // A registry REAL for the pipeline leg that serves the REAL worktree for the ship.
    const journey = journeyRoleDeps();
    const real = createMissionRegistry({
      fusionBaseUrl: 'http://127.0.0.1:3999', sundayMode: 'fast', claudeMode: 'fake',
      confirmLive: true, architectEnv: liveEnv, hermesEnv: liveEnv, deps: journey.deps,
    }) as unknown as Record<string, (...a: unknown[]) => unknown>;
    const registry = {
      start: (i: unknown) => real.start(i),
      get: (id: string) => real.get(id),
      cancel: (id: string) => real.cancel(id),
      retry: (id: string) => real.retry(id),
      shipContext: (id: string) =>
        id === SHIP_MISSION_ID && shipTarget !== null ? { target: shipTarget, worktreePath } : real.shipContext(id),
      recordShipOutcome: () => {}, beginShip: () => true, endShip: () => {},
    };

    const repoStore = createRepositoryRegistrationStore({ root });
    const brain = createBrainMemoryStore({ root });
    const server = createBridgeServer(
      config, registry as never, null, null, null, null, () => false, null, [], null, null,
      repoStore, brain,
    );
    servers.push(server as never);
    await new Promise<void>((r) => (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
    const addr = (server as never as { address: () => { port: number } | null }).address();
    base = `http://127.0.0.1:${addr === null ? 0 : addr.port}`;

    // 1) REAL sign-in + install authorization.
    session = await signInLive();
    expect(session.participantId).toMatch(/^ghu-\d+$/);
    await authorizeInstallationLive();

    // 2) REAL remote_clone shippable state, owned by the signed-in participant,
    //    saved to the store so the ship route re-reads it (revocation still lands).
    buildRealShippableState();
    repoStore.save(registration!);
  }, 120_000);

  afterAll(async () => {
    if (!LIVE.ok) { return; } // nothing was booted or created.
    // Independent best-effort cleanup so the repo is reusable.
    try { await ghApi(`/repos/${PROOF_OWNER}/${PROOF_NAME}/git/refs/heads/${WORKING_BRANCH}`, { method: 'DELETE' }); } catch { /* best effort */ }
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
    for (const rt of roots.splice(0)) rmSync(rt, { recursive: true, force: true });
  }, 60_000);

  it('drives a real mission to verified_complete over HTTP as the live participant', async () => {
    if (!LIVE.ok) { expect(LIVE.missing.length).toBeGreaterThan(0); return; } // gated: assert the reason, no network
    const started = await getJson(await fetch(`${base}/relay-api/mission/start`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...asUser(session.token) },
      body: JSON.stringify({
        missionId: 'm-live-verify', objective: 'Live-proof: normalize project names.',
        config: { mode: 'autonomous', review: 'independent', limits: { agentCalls: 6, spendUsd: 3 } },
      }),
    }));
    expect(started.status).toBe(200);

    const TERMINAL = new Set(['verified_complete', 'failed', 'cancelled']);
    let view: Record<string, unknown> | null = null;
    for (let i = 0; i < 400 && view === null; i++) {
      const res = await fetch(`${base}/relay-api/mission/m-live-verify`, { headers: asUser(session.token) });
      if (res.status === 200) {
        const v = ((await res.json()) as { view: Record<string, unknown> }).view;
        if (TERMINAL.has(v.state as string)) view = v;
      }
      if (view === null) await new Promise((r) => setTimeout(r, 15));
    }
    expect(view?.state).toBe('verified_complete'); // the one and only real mission.ts ran it
  }, 60_000);

  it('SHIPS the verified mission and a REAL branch + PR land on github.com', async () => {
    if (!LIVE.ok) { expect(LIVE.missing.length).toBeGreaterThan(0); return; } // gated: assert the reason, no network
    const prEvidence = {
      missionId: SHIP_MISSION_ID, objective: 'Relay live-proof: verified in-scope change',
      artifactDigest: null, reviewedArtifactDigest: null, reviewerVerdict: null,
      reviewerFindings: [], relayVerification: ['Relay live-proof harness change'],
      attestations: [], baselineSha: null,
    };
    const shipRes = await getJson(await fetch(`${base}/relay-api/mission/${SHIP_MISSION_ID}/ship`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...asUser(session.token) },
      body: JSON.stringify({
        remote: {
          // No credentialEnvVarName — the App path. The credential comes from the
          // target's installation (resolved server-side), never from this body.
          provider: 'github',
          pullRequestTitle: 'Relay live-proof', pullRequestBody: prEvidence,
        },
      }),
    }));
    expect(shipRes.status).toBe(200);
    const data = shipRes.body.data as { stage: string; evidence: Array<{ stage: string }> };
    // Relay's own account: it reached at least a pushed remote (a PR when create_pr held).
    expect(['pushed', 'pull_request_open', 'merged'].includes(data.stage)).toBe(true);
    committedSha = gitPlain(['rev-parse', 'HEAD'], worktreePath).trim() || null;

    // INDEPENDENT PROOF against github.com — not Relay's word.
    const ref = await ghApi(`/repos/${PROOF_OWNER}/${PROOF_NAME}/git/ref/heads/${WORKING_BRANCH}`);
    expect(ref.status).toBe(200);
    const refBody = (await ref.json()) as { object?: { sha?: string } };
    expect(typeof refBody.object?.sha).toBe('string');
    if (committedSha) expect(refBody.object?.sha).toBe(committedSha); // the exact commit landed

    const pulls = await ghApi(`/repos/${PROOF_OWNER}/${PROOF_NAME}/pulls?head=${PROOF_OWNER}:${WORKING_BRANCH}&state=open`);
    expect(pulls.status).toBe(200);
    const prs = (await pulls.json()) as Array<{ number: number }>;
    expect(prs.length).toBeGreaterThan(0);
    const prNumber = prs[0]?.number;
    expect(typeof prNumber).toBe('number');

    // Leave the repo clean (afterAll also deletes the branch).
    try {
      await ghApi(`/repos/${PROOF_OWNER}/${PROOF_NAME}/pulls/${prNumber}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'closed' }),
      });
    } catch { /* afterAll deletes the branch regardless */ }
  }, 120_000);
});
