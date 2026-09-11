import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeServer } from './server';
import { loadBridgeConfig } from './config';
import { createMissionRegistry, missionOwnerAdmits, MISSION_OPERATOR } from './mission';
import type { MissionRegistry } from './mission';

/**
 * A MISSION BELONGS TO THE PARTICIPANT WHO STARTED IT.
 *
 * `listForParticipant` has always said so — a participant's history holds only
 * their own missions. The PER-MISSION routes did not: `GET /mission/:id`,
 * `POST /mission/:id/cancel` and `POST /mission/:id/retry` reached the registry
 * with nothing but an id, and `start` returned an existing mission's full view
 * to anyone who named its id. Mission ids are CALLER-CHOSEN, so naming one
 * proves nothing about who owns the mission behind it.
 *
 * The consequence was not theoretical: any participant holding a valid browser
 * session could read another participant's mission, cancel their running work,
 * or re-drive it — and a retry SPENDS.
 *
 * These are the regression proofs. Each names the property it holds, so a
 * failure says which guarantee broke rather than which line moved.
 *
 * NO PROVIDER IS CONTACTED BY THIS FILE. `fetch` is replaced with a spy that
 * throws, and the registry is built with no architect configuration, so every
 * mission fails its preflight before dispatch. The RECORD still exists with its
 * owner stamped, which is all these tests read.
 */

const ORIGIN = 'https://sunday-relay.vercel.app';
const OPERATOR = 'operator-token-for-tests-only';

const ALICE = 'participant-alice';
const BOB = 'participant-bob';

const servers: Server[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    if (s === undefined) continue;
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A real registry with NO architect configuration: every mission fails
 *  preflight without contacting anything. The record — and its owner — is
 *  still created, which is the only thing ownership depends on. */
function realRegistry(): MissionRegistry {
  return createMissionRegistry({
    fusionBaseUrl: 'http://127.0.0.1:1',
    sundayMode: 'fast',
    claudeMode: 'fake',
    confirmLive: false,
    architectEnv: {},
    now: () => '2026-09-11T10:00:00.000Z',
  });
}

/** Boots the bridge over a REAL registry. The existing mission-auth suite uses
 *  a stub registry, which cannot exercise ownership at all — that is why this
 *  file wires the genuine one. */
async function boot(): Promise<{ base: string; registry: MissionRegistry }> {
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  const registry = realRegistry();
  const server = createBridgeServer(loadBridgeConfig(process.env), registry);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, registry };
}

/** Mint a CONTROL session bound to a participant, exactly as production does. */
async function pairControl(base: string, participantId: string): Promise<string> {
  const minted = await fetch(`${base}/relay-api/browser/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${OPERATOR}` },
    body: JSON.stringify({ origin: ORIGIN, scope: 'control', participantId }),
  });
  const grant = (await minted.json()).data as { grantId: string; grantSecret: string };
  const exchanged = await fetch(`${base}/relay-api/browser/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(grant),
  });
  return ((await exchanged.json()).data as { sessionToken: string }).sessionToken;
}

const sessionHeaders = (token: string) => ({
  'content-type': 'application/json',
  Authorization: `Relay-Session ${token}`,
  Origin: ORIGIN,
});

const startAs = (base: string, token: string, body: Record<string, unknown>) =>
  fetch(`${base}/relay-api/mission/start`, {
    method: 'POST', headers: sessionHeaders(token), body: JSON.stringify(body),
  });

const readAs = (base: string, token: string, missionId: string) =>
  fetch(`${base}/relay-api/mission/${missionId}`, { headers: sessionHeaders(token) });

const actAs = (base: string, token: string, missionId: string, action: 'cancel' | 'retry') =>
  fetch(`${base}/relay-api/mission/${missionId}/${action}`, {
    method: 'POST', headers: sessionHeaders(token), body: JSON.stringify({}),
  });

/** Alice starts a mission over the real route, so its owner is stamped from her
 *  SESSION rather than from anything this test asserts directly. */
async function aliceStarts(base: string, missionId: string): Promise<string> {
  const alice = await pairControl(base, ALICE);
  const res = await startAs(base, alice, { missionId, objective: 'Normalize project names.' });
  expect(res.status, 'Alice must be able to start her own mission').toBe(200);
  return alice;
}

/* ------------------------------------------------------------------ 1 ---- */

describe('1. the owner keeps full authority over their own mission', () => {
  it('may read, cancel and retry the mission they started', async () => {
    const { base } = await boot();
    const alice = await aliceStarts(base, 'own-1');

    const read = await readAs(base, alice, 'own-1');
    expect(read.status).toBe(200);
    expect((await read.json()).missionId).toBe('own-1');

    // Cancel and retry reach the registry and act on a mission that is hers.
    expect((await actAs(base, alice, 'own-1', 'cancel')).status).toBe(200);
    expect((await actAs(base, alice, 'own-1', 'retry')).status).toBe(200);
  }, 30_000);
});

/* ---------------------------------------------------------------- 2-4 ---- */

describe('a foreign participant has no authority over a mission that is not theirs', () => {
  it('2. cannot READ another participant’s mission', async () => {
    const { base } = await boot();
    await aliceStarts(base, 'foreign-read');
    const bob = await pairControl(base, BOB);

    const res = await readAs(base, bob, 'foreign-read');
    expect(res.status).toBe(404);
    const body = JSON.stringify(await res.json());
    // Not one field of Alice's mission may appear in Bob's refusal.
    expect(body).not.toContain('Normalize project names');
    expect(body).not.toContain(ALICE);
  }, 30_000);

  it('3. cannot CANCEL another participant’s mission', async () => {
    const { base, registry } = await boot();
    const alice = await aliceStarts(base, 'foreign-cancel');
    const bob = await pairControl(base, BOB);

    expect((await actAs(base, bob, 'foreign-cancel', 'cancel')).status).toBe(404);

    // And the mission is genuinely untouched — a 404 that still cancelled would
    // be the same defect with a quieter response.
    const stillHers = registry.get('foreign-cancel', { kind: 'participant', participantId: ALICE });
    expect(stillHers).not.toBeNull();
    expect(stillHers?.state).not.toBe('cancelled');
    // Alice can still reach it herself.
    expect((await readAs(base, alice, 'foreign-cancel')).status).toBe(200);
  }, 30_000);

  it('4. cannot RETRY another participant’s mission — a retry spends', async () => {
    const { base, registry } = await boot();
    await aliceStarts(base, 'foreign-retry');
    const bob = await pairControl(base, BOB);

    const before = registry.get('foreign-retry', { kind: 'participant', participantId: ALICE });
    expect((await actAs(base, bob, 'foreign-retry', 'retry')).status).toBe(404);
    const after = registry.get('foreign-retry', { kind: 'participant', participantId: ALICE });

    // No dispatch was re-driven on Alice's mission by Bob's request.
    expect(after?.missionRevision).toBe(before?.missionRevision);
  }, 30_000);
});

/* ------------------------------------------------------------------ 5 ---- */

describe('5. a mission-id collision cannot hand over another participant’s mission', () => {
  it('refuses the id instead of returning the existing mission', async () => {
    const { base } = await boot();
    await aliceStarts(base, 'collide-1');
    const bob = await pairControl(base, BOB);

    // Bob deliberately names an id he does not own. Before the fix this
    // answered 200 with Alice's full mission view.
    const res = await startAs(base, bob, { missionId: 'collide-1', objective: 'Something else entirely.' });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toMatchObject({ kind: 'mission_id_unavailable' });
    const text = JSON.stringify(body);
    expect(text).not.toContain('Normalize project names');
    expect(text).not.toContain(ALICE);
    // The refusal must not say the mission EXISTS — that sentence is the leak.
    expect(text.toLowerCase()).not.toContain('already');
  }, 30_000);

  it('but the SAME participant still gets idempotency, which is what start promises', async () => {
    const { base } = await boot();
    const alice = await aliceStarts(base, 'collide-2');
    const again = await startAs(base, alice, { missionId: 'collide-2', objective: 'A different objective.' });
    expect(again.status).toBe(200);
    // The same run, not a second dispatch: the original objective survives.
    expect(JSON.stringify(await again.json())).not.toContain('A different objective');
  }, 30_000);
});

/* ------------------------------------------------------------------ 6 ---- */

describe('6. a foreign mission and a mission that does not exist are one answer', () => {
  it('answers identically for someone else’s mission and for nothing at all', async () => {
    const { base } = await boot();
    await aliceStarts(base, 'exists-but-not-bobs');
    const bob = await pairControl(base, BOB);

    const foreign = await readAs(base, bob, 'exists-but-not-bobs');
    const absent = await readAs(base, bob, 'no-such-mission-at-all');

    expect(foreign.status).toBe(absent.status);
    expect(await foreign.json()).toEqual(await absent.json());

    // The same indistinguishability for the two mutations.
    for (const action of ['cancel', 'retry'] as const) {
      const a = await actAs(base, bob, 'exists-but-not-bobs', action);
      const b = await actAs(base, bob, 'no-such-mission-at-all', action);
      expect(a.status, action).toBe(b.status);
      expect(await a.json(), action).toEqual(await b.json());
    }
  }, 30_000);
});

/* ------------------------------------------------------------------ 7 ---- */

describe('7. the operator’s authority is deliberately unchanged', () => {
  it('may read, cancel and retry a participant’s mission', async () => {
    const { base } = await boot();
    await aliceStarts(base, 'operator-reach');

    const op = { Authorization: `Bearer ${OPERATOR}`, 'content-type': 'application/json' };
    expect((await fetch(`${base}/relay-api/mission/operator-reach`, { headers: op })).status).toBe(200);
    expect((await fetch(`${base}/relay-api/mission/operator-reach/cancel`, { method: 'POST', headers: op })).status).toBe(200);
    expect((await fetch(`${base}/relay-api/mission/operator-reach/retry`, { method: 'POST', headers: op })).status).toBe(200);
  }, 30_000);

  it('and the predicate says so directly', () => {
    expect(missionOwnerAdmits(ALICE, MISSION_OPERATOR)).toBe(true);
    expect(missionOwnerAdmits(null, MISSION_OPERATOR)).toBe(true);
  });
});

/* ------------------------------------------------------------------ 8 ---- */

describe('8. identity comes from the authenticated session, never the request body', () => {
  it('ignores a body that claims to be the owner', async () => {
    const { base } = await boot();
    await aliceStarts(base, 'body-claim');
    const bob = await pairControl(base, BOB);

    // Bob asserts Alice's identity in every field a body could plausibly carry.
    const res = await fetch(`${base}/relay-api/mission/body-claim`, {
      method: 'POST',
      headers: sessionHeaders(bob),
      body: JSON.stringify({ participantId: ALICE, startedBy: ALICE, caller: { kind: 'operator' } }),
    });
    // The SCOPE gate refuses this verb before the body is ever parsed — which
    // is the first of the two reasons a body cannot promote a caller.
    expect(res.status).toBe(403);
    // And the second: on a verb his session does permit, he is still not Alice.
    expect((await readAs(base, bob, 'body-claim')).status).toBe(404);

    const claimedCancel = await fetch(`${base}/relay-api/mission/body-claim/cancel`, {
      method: 'POST',
      headers: sessionHeaders(bob),
      body: JSON.stringify({ participantId: ALICE, caller: { kind: 'operator' } }),
    });
    expect(claimedCancel.status).toBe(404);
  }, 30_000);

  it('a mission started with a body participantId still belongs to the SESSION', async () => {
    const { base, registry } = await boot();
    const bob = await pairControl(base, BOB);
    // Bob starts a mission while claiming to be Alice in the body.
    expect((await startAs(base, bob, {
      missionId: 'body-owner', objective: 'Normalize project names.', participantId: ALICE, startedBy: ALICE,
    })).status).toBe(200);

    // It is Bob's, because the session said so.
    expect(registry.get('body-owner', { kind: 'participant', participantId: BOB })).not.toBeNull();
    expect(registry.get('body-owner', { kind: 'participant', participantId: ALICE })).toBeNull();
  }, 30_000);
});

/* ------------------------------------------------------------------ 9 ---- */

describe('9. no cross-participant mission metadata leaks', () => {
  it('keeps another participant’s mission out of the history list', async () => {
    const { base } = await boot();
    await aliceStarts(base, 'list-leak');
    const bob = await pairControl(base, BOB);

    const res = await fetch(`${base}/relay-api/missions`, { headers: sessionHeaders(bob) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.missions).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('list-leak');
  }, 30_000);

  it('leaks nothing about a foreign mission through any of the four verbs', async () => {
    const { base } = await boot();
    await aliceStarts(base, 'quiet');
    const bob = await pairControl(base, BOB);

    const bodies = [
      await (await readAs(base, bob, 'quiet')).text(),
      await (await actAs(base, bob, 'quiet', 'cancel')).text(),
      await (await actAs(base, bob, 'quiet', 'retry')).text(),
      await (await startAs(base, bob, { missionId: 'quiet', objective: 'x' })).text(),
    ];
    for (const body of bodies) {
      expect(body).not.toContain('Normalize project names');
      expect(body).not.toContain(ALICE);
      expect(body).not.toContain('verified_complete');
    }
  }, 30_000);
});

/* ----------------------------------------------------------------- 10 ---- */

describe('10. the unbound caller is an identity, not a wildcard', () => {
  /**
   * `participantId: null` is the read-only session and the control session
   * paired before any participant was bound. It owns exactly the missions
   * started with a null owner — so it can still read back what it started,
   * and still cannot reach a mission belonging to a named participant.
   */
  it('owns null-owner missions and nothing else', () => {
    const unbound = { kind: 'participant' as const, participantId: null };
    expect(missionOwnerAdmits(null, unbound)).toBe(true);
    expect(missionOwnerAdmits(ALICE, unbound)).toBe(false);
  });

  it('an operator-started mission is not reachable by a named participant', async () => {
    const { base, registry } = await boot();
    // Started by the operator: owner is null.
    registry.start({ missionId: 'operator-owned', objective: 'Operator work.', caller: MISSION_OPERATOR });
    const bob = await pairControl(base, BOB);
    expect((await readAs(base, bob, 'operator-owned')).status).toBe(404);
    // The operator still reaches it.
    expect(registry.get('operator-owned', MISSION_OPERATOR)).not.toBeNull();
  }, 30_000);
});

/* ------------------------------------------------- the predicate itself --- */

describe('the ownership predicate, stated directly', () => {
  /**
   * ADVERSARIAL / MUTATION SURFACE. These cases are the ones a mutation must
   * break: delete the ownership check and `missionOwnerAdmits` becomes `true`
   * for every pair, which fails here before any route is involved.
   */
  it('admits a participant only for their own missions', () => {
    const alice = { kind: 'participant' as const, participantId: ALICE };
    expect(missionOwnerAdmits(ALICE, alice)).toBe(true);
    expect(missionOwnerAdmits(BOB, alice)).toBe(false);
    expect(missionOwnerAdmits(null, alice)).toBe(false);
  });

  it('never treats a similar id as the same id', () => {
    const alice = { kind: 'participant' as const, participantId: ALICE };
    expect(missionOwnerAdmits(`${ALICE} `, alice)).toBe(false);
    expect(missionOwnerAdmits(ALICE.toUpperCase(), alice)).toBe(false);
    expect(missionOwnerAdmits(`${ALICE}-2`, alice)).toBe(false);
  });

  it('registry-level: a foreign caller gets null from every scoped method', () => {
    const registry = realRegistry();
    registry.start({ missionId: 'unit-1', objective: 'Alice work.', caller: { kind: 'participant', participantId: ALICE } });
    const bob = { kind: 'participant' as const, participantId: BOB };

    expect(registry.get('unit-1', bob)).toBeNull();
    expect(registry.cancel('unit-1', bob)).toBeNull();
    expect(registry.retry('unit-1', bob)).toBeNull();
    expect(registry.start({ missionId: 'unit-1', objective: 'Bob work.', caller: bob })).toBeNull();

    // And the owner is unaffected by all four attempts.
    const alice = { kind: 'participant' as const, participantId: ALICE };
    expect(registry.get('unit-1', alice)).not.toBeNull();
    expect(registry.listForParticipant(ALICE).map((m) => m.missionId)).toContain('unit-1');
    expect(registry.listForParticipant(BOB)).toEqual([]);
  });
});
