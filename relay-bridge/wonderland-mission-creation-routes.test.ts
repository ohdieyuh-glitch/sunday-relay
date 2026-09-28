import { describe, expect, it } from 'vitest';

import { createBrowserSessionStore, NATIVE_WORLD_AUDIENCE } from './browser-session/grants';
import type { BrowserSessionStore } from './browser-session/grants';
import type { JuliusMissionRoutePorts } from './julius-mission-routes';
import {
  handleWonderlandMissionCreation,
  wonderlandMissionSuffix,
} from './wonderland-mission-creation-routes';
import type { WonderlandMissionCreationDeps, WonderlandMissionCreationRequest } from './wonderland-mission-creation-routes';
import { handleExecutionProfileRoute } from './wonderland-execution-profile-routes';
import type {
  PlayerMissionContractRecord,
  PlayerMissionContractStore,
  WonderlandExecutionProfileStore,
} from './wonderland-execution-profile-routes';
import type { WonderlandProjectMembershipSource } from './wonderland-julius-routes';

/**
 * POST /wonderland/julius/missions -- A PLAYER CREATES A MISSION, AND AUTHORS
 * NOTHING BUT ITS WORDS (founder decision 4).
 *
 * The real session store; fakes for membership, the profile, the contract
 * record and Julius's bootstrap -- the last one records what it was handed, so
 * each test can show what reached Julius. Every refusal also shows that NOTHING
 * was recorded and NOTHING reached the bootstrap.
 */

const NOW = 1_790_000_000_000;
const WEB = 'https://sunday-relay.vercel.app';
const PLAYER = 'ghu-424242';
const PROJECT = 'prj-alpha';
const KEY = 'task-7f3a9c21-0001';

const PROFILE = {
  schemaVersion: 'relay-wonderland-execution-profile.v1', projectId: PROJECT,
  tenantId: 'tenant-alpha', enabled: true, markerNamespacePrefix: 'wl-alpha',
  workspacePath: '/srv/julius/workspaces/alpha', testCommand: 'npm test',
  limits: { spendUsd: 2.5, repairCycles: 1, architectMaxOutputTokens: 4000 }, research: null,
};
const OPERATOR_FIELDS = ['tenantId', 'enabled', 'markerNamespacePrefix', 'workspacePath', 'testCommand', 'limits', 'research'] as const;
const operatorBody = (over: Record<string, unknown> = {}) =>
  Object.fromEntries(OPERATOR_FIELDS.map((key) => [key, { ...PROFILE, ...over }[key]]));

const MISSION = {
  objective: 'Add a dark mode toggle to the settings page.',
  requirements: ['The toggle persists across reloads.'],
  constraints: ['Do not change the colour tokens.'],
  acceptanceCriteria: [{ id: 'toggle-works', text: 'Toggling switches the theme.', blocking: true }],
};

function signedIn(store: BrowserSessionStore): string {
  const minted = store.mintIdentitySession({ origin: WEB, now: NOW, participantId: PLAYER, scope: 'browser_control' });
  if (!minted.ok) throw new Error('fixture');
  return minted.session.token;
}

function nativeFor(store: BrowserSessionStore, projectId: string): string {
  const grant = store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId: PLAYER, projectId });
  const redeemed = store.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: NATIVE_WORLD_AUDIENCE, now: NOW });
  if (!redeemed.ok) throw new Error('fixture');
  return redeemed.session.token;
}

const members = (rows: Record<string, string>): WonderlandProjectMembershipSource => ({
  lookup: async ({ playerId, projectId }) => {
    const role = rows[`${playerId}|${projectId}`];
    return role === undefined ? null : { playerId, projectId, role };
  },
});

function world(over: {
  profile?: Record<string, unknown> | null; membership?: WonderlandProjectMembershipSource;
  contracts?: PlayerMissionContractStore | null; roleCapabilities?: WonderlandMissionCreationDeps['roleCapabilities'];
} = {}) {
  const store = createBrowserSessionStore();
  const submitted: Array<{ executionId: string; tenantId: string; request: unknown }> = [];
  const recorded: PlayerMissionContractRecord[] = [];
  const attached: Array<[string, string]> = [];
  // THE STORED SHAPE -- what the operator route writes (schemaVersion and projectId included), not the operator's input.
  const profile = over.profile === undefined ? { ...PROFILE } : over.profile;
  const profiles: WonderlandExecutionProfileStore = {
    current: async () => (profile === null ? null : { version: 3, body: profile, writtenBy: 'operator:ops', writtenAt: 'x' }),
    append: async () => ({ ok: true, version: 1 }),
  };
  const contracts: PlayerMissionContractStore = over.contracts !== undefined && over.contracts !== null ? over.contracts : {
    record: async (input) => { if (!recorded.some((row) => row.missionId === input.missionId)) recorded.push({ ...input, runId: null, createdAt: 'x' }); },
    attachRun: async (missionId, runId) => { attached.push([missionId, runId]); },
    get: async (missionId) => recorded.find((row) => row.missionId === missionId) ?? null,
  };
  const missions: JuliusMissionRoutePorts = {
    bootstrap: (executionId, tenantId) => ({
      submit: async (request: unknown) => {
        submitted.push({ executionId, tenantId, request });
        return { accepted: true, runId: 'run:0001', acceptedAt: 'x', state: 'READY', resumed: submitted.length > 1 };
      },
    }) as never,
    missingConfig: [],
    reviewerProvider: 'hermes-test',
    cardRevision: 'card:v1',
  };
  const deps: WonderlandMissionCreationDeps = {
    sessions: store,
    membership: over.membership ?? members({ [`${PLAYER}|${PROJECT}`]: 'OWNER', [`${PLAYER}|prj-beta`]: 'OWNER' }),
    profiles,
    contracts: over.contracts === null ? null : contracts,
    missions,
    ...(over.roleCapabilities === undefined ? {} : { roleCapabilities: over.roleCapabilities }),
  };
  return { store, deps, submitted, recorded, attached };
}

const post = (token: string | null, over: Partial<WonderlandMissionCreationRequest> = {}): WonderlandMissionCreationRequest => ({
  method: 'POST',
  path: '/wonderland/julius/missions',
  url: `/wonderland/julius/missions?projectId=${PROJECT}`,
  authorization: token === null ? undefined : `Relay-Session ${token}`,
  origin: WEB,
  idempotencyKey: KEY,
  body: MISSION,
  now: NOW,
  ...over,
});

const kindOf = (result: { body: unknown } | null) => (result?.body as { error?: { kind: string } }).error?.kind;
const dataOf = (result: { body: unknown } | null) => (result?.body as { data: Record<string, unknown> }).data;

describe('the OWNER creates a mission, and authors only its words', () => {
  it('201 READY, never dispatched -- the operator\'s profile supplies everything execution-sensitive', async () => {
    const w = world();
    const answer = await handleWonderlandMissionCreation(post(signedIn(w.store)), w.deps);
    expect(answer?.status).toBe(201);
    const suffix = wonderlandMissionSuffix(PROJECT, PLAYER, KEY);
    expect(dataOf(answer)).toMatchObject({ runId: 'run:0001', state: 'READY', dispatched: false, missionId: `mission:wl-${suffix}` });
    // What reached Julius: the profile's tenant, the server's identity.
    expect(w.submitted).toHaveLength(1);
    expect(w.submitted[0]).toMatchObject({ executionId: `execution:julius-live:mission:wl-${suffix}`, tenantId: 'tenant-alpha' });
    // What was recorded, BEFORE the run: who, from which profile version, as what contract.
    expect(w.recorded).toHaveLength(1);
    expect(w.recorded[0]).toMatchObject({ missionId: `mission:wl-${suffix}`, projectId: PROJECT, playerId: PLAYER, profileVersion: 3 });
    expect(w.recorded[0].contract).toMatchObject({
      workspacePath: PROFILE.workspacePath, testCommand: 'npm test', markerNamespace: `wl-alpha-${suffix}`,
      limits: PROFILE.limits, objective: MISSION.objective,
    });
    expect(w.attached).toEqual([[`mission:wl-${suffix}`, 'run:0001']]);
  });

  it('the answer tells the player nothing about WHERE or HOW it will run', async () => {
    const w = world();
    const text = JSON.stringify((await handleWonderlandMissionCreation(post(signedIn(w.store)), w.deps))?.body);
    for (const secret of [PROFILE.workspacePath, 'npm test', 'tenant-alpha', 'wl-alpha', '2.5']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('ROUND TRIP: a profile the OPERATOR ROUTE wrote is one the creation route can read -- the defect the wire drill caught', async () => {
    // The first version stored the validated profile (schemaVersion and projectId included) and re-read it with the
    // operator-INPUT parser, which refuses those keys: every stored profile read as invalid. A fake holding the input
    // shape could not see it; this writes through the real operator route instead.
    const rows: Array<{ projectId: string; version: number; body: unknown }> = [];
    const store: WonderlandExecutionProfileStore = {
      current: async (projectId) => {
        const mine = rows.filter((row) => row.projectId === projectId);
        const last = mine[mine.length - 1];
        return last === undefined ? null : { version: last.version, body: last.body, writtenBy: 'operator:ops', writtenAt: 'x' };
      },
      append: async ({ projectId, body }) => {
        rows.push({ projectId, version: rows.length + 1, body });
        return { ok: true, version: rows.length };
      },
    };
    const written = await handleExecutionProfileRoute({
      method: 'PUT', path: `/julius/projects/${PROJECT}/execution-profile`, operator: true, actor: 'ops',
      body: JSON.stringify(operatorBody()),
    }, store);
    expect(written?.status).toBe(200);
    const w = world();
    const answer = await handleWonderlandMissionCreation(post(signedIn(w.store)), { ...w.deps, profiles: store });
    expect(answer?.status, JSON.stringify(answer?.body)).toBe(201);
  });

  it('A RETRY IS THE SAME MISSION: the same key twice reaches Julius as one mission id -- a new key, a new mission', async () => {
    const w = world();
    const token = signedIn(w.store);
    await handleWonderlandMissionCreation(post(token), w.deps);
    await handleWonderlandMissionCreation(post(token), w.deps);
    await handleWonderlandMissionCreation(post(token, { idempotencyKey: 'task-7f3a9c21-0002' }), w.deps);
    const ids = w.submitted.map((one) => one.executionId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(w.recorded).toHaveLength(2);
  });

  it('the native client, paired for THIS project, creates from inside Wonderland; paired for another, it cannot', async () => {
    const w = world();
    const own = await handleWonderlandMissionCreation(post(nativeFor(w.store, PROJECT), { origin: undefined }), w.deps);
    expect(own?.status).toBe(201);
    const other = await handleWonderlandMissionCreation(post(nativeFor(w.store, 'prj-beta'), { origin: undefined }), w.deps);
    expect(other?.status).toBe(403);
    expect(w.submitted).toHaveLength(1);
  });
});

describe('what a player may NOT do -- and nothing is recorded, nothing reaches Julius', () => {
  const nothingHappened = (w: ReturnType<typeof world>) => {
    expect(w.submitted, 'reached Julius').toHaveLength(0);
    expect(w.recorded, 'was recorded').toHaveLength(0);
  };

  it('smuggle an execution field: refused, and every smuggled field named', async () => {
    const w = world();
    const answer = await handleWonderlandMissionCreation(post(signedIn(w.store), {
      body: { ...MISSION, workspacePath: '/', testCommand: 'curl evil', limits: { spendUsd: 9999 }, missionId: 'mission:mine' },
    }), w.deps);
    expect(answer?.status).toBe(400);
    expect(kindOf(answer)).toBe('forbidden_field');
    expect([...((answer?.body as { error: { forbidden: string[] } }).error.forbidden)].sort())
      .toEqual(['limits', 'missionId', 'testCommand', 'workspacePath']);
    nothingHappened(w);
  });

  it('a member without create_mission is refused; TODAY a MEMBER row is refused by the canonical table', async () => {
    const decided = world({
      membership: members({ [`${PLAYER}|${PROJECT}`]: 'MEMBER' }),
      roleCapabilities: Object.freeze({ MEMBER: Object.freeze(['read_world_state', 'read_mission_result'] as const) }),
    });
    expect((await handleWonderlandMissionCreation(post(signedIn(decided.store)), decided.deps))?.status).toBe(403);
    nothingHappened(decided);
    const today = world({ membership: members({ [`${PLAYER}|${PROJECT}`]: 'MEMBER' }) });
    expect((await handleWonderlandMissionCreation(post(signedIn(today.store)), today.deps))?.status).toBe(403);
    nothingHappened(today);
  });

  it('each refusal of the CALLER has its own word: session_invalid (401), not_authorized (403)', async () => {
    const w = world({ membership: members({ [`${PLAYER}|${PROJECT}`]: 'MEMBER' }) });
    const noSession = await handleWonderlandMissionCreation(post(null), w.deps);
    expect(noSession?.status).toBe(401);
    expect(kindOf(noSession)).toBe('session_invalid');
    const member = await handleWonderlandMissionCreation(post(signedIn(w.store)), w.deps);
    expect(member?.status).toBe(403);
    expect(kindOf(member)).toBe('not_authorized');
    // A REVOKED native session is the same 401 as none at all.
    const token = nativeFor(w.store, PROJECT);
    w.store.revokeSession({ token, now: NOW });
    const revoked = await handleWonderlandMissionCreation(post(token, { origin: undefined }), w.deps);
    expect(revoked?.status).toBe(401);
    expect(kindOf(revoked)).toBe('session_invalid');
    nothingHappened(w);
  });

  it('no session is 401; no idempotency key is 400', async () => {
    const w = world();
    expect((await handleWonderlandMissionCreation(post(null), w.deps))?.status).toBe(401);
    expect(kindOf(await handleWonderlandMissionCreation(post(signedIn(w.store), { idempotencyKey: undefined }), w.deps)))
      .toBe('idempotency_key_required');
    nothingHappened(w);
  });

  it('no profile: 409 execution_not_configured -- the operator has not said where missions may run', async () => {
    const w = world({ profile: null });
    expect(kindOf(await handleWonderlandMissionCreation(post(signedIn(w.store)), w.deps))).toBe('execution_not_configured');
    nothingHappened(w);
  });

  it('a profile switched off: 403 execution_disabled', async () => {
    const w = world({ profile: { ...PROFILE, enabled: false } });
    expect(kindOf(await handleWonderlandMissionCreation(post(signedIn(w.store)), w.deps))).toBe('execution_disabled');
    nothingHappened(w);
  });

  it('a stored profile that no longer validates: 503, and the operator\'s to fix', async () => {
    const w = world({ profile: { ...PROFILE, spendUSD: 1 } });
    expect(kindOf(await handleWonderlandMissionCreation(post(signedIn(w.store)), w.deps))).toBe('execution_profile_invalid');
    nothingHappened(w);
  });

  it('FAIL CLOSED: if who-asked-for-what cannot be recorded, nothing is created', async () => {
    const failing = world({ contracts: { record: async () => { throw new Error('db down'); }, attachRun: async () => undefined, get: async () => null } });
    expect(kindOf(await handleWonderlandMissionCreation(post(signedIn(failing.store)), failing.deps))).toBe('mission_contract_store_unavailable');
    expect(failing.submitted).toHaveLength(0);
    const absent = world({ contracts: null });
    expect((await handleWonderlandMissionCreation(post(signedIn(absent.store)), absent.deps))?.status).toBe(503);
    expect(absent.submitted).toHaveLength(0);
  });
});
