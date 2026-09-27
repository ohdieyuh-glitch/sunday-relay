import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMissionRegistry, missionVisibleTo } from './mission';
import type { MissionOwnershipScope } from './mission';
import { authorizeReviewerCall } from './browser-session/routes';
import { browserSessionMayCall, createBrowserSessionStore } from './browser-session/grants';

/**
 * A MISSION BELONGS TO WHOEVER STARTED IT, AND TO NOBODY ELSE.
 *
 * The mission-family gate proved a caller held *a* session. It did not prove the
 * mission named in the path was THEIRS. Mission ids are caller-chosen — they
 * arrive as `missionId` in the start body — so they are guessable, and
 * `listForParticipant` was the only ownership-aware read in the registry. Every
 * other verb took an id and answered.
 *
 * What that cost, before this file existed:
 *
 *   GET  /relay-api/mission/m-owned         200 with another participant's objective,
 *                                           events and repository target
 *   POST /relay-api/mission/m-owned/cancel  200, their mission cancelled
 *   POST /relay-api/mission/m-owned/retry   200, their mission re-driven — and retry
 *                                           re-drives the pipeline, so it SPENDS
 *   POST /relay-api/mission/start           200 with their view, via the idempotent branch
 *
 * The reach was not limited to participants. `/mission/:id` is in
 * BROWSER_READABLE, so a `browser_read_only` session — the weakest credential the
 * bridge issues — could read any mission by id, including every operator-started
 * paid mission.
 *
 * THE PROPERTY THESE PROOFS HOLD, in four clauses:
 *
 *   1. An anonymous caller with NO valid pairing grant sees no operator mission.
 *      (Sections G/29–31: the route gate refuses before the registry is reached.)
 *   2. An anonymous caller WITH a valid pairing grant may read only the
 *      mission scope explicitly granted to that paired watch — which today is
 *      the empty set, because no grant can name a mission. So: nothing.
 *      (Sections A/6–9, B/12–13, G/32–33.)
 *   3. A paired grant confers no cancel, no retry, no mutation, no spend, no
 *      ownership and no broader enumeration. (Sections C/18, D/22–23, E/25,
 *      G/34–37.)
 *   4. An authenticated participant reaches only missions that participant
 *      owns. (Sections A/3–5, B/10–11, C/17, D/21, E/24.)
 *
 * THE NULL TRAP, which is why this is a repair and not a replay of the original
 * #143 change. A read-only session carries `participantId: null`, and an
 * operator-started mission carries `startedByParticipant: null`. Express the
 * scope as one `string | null` and those two nulls are the same value: "an
 * anonymous browser is asking" becomes indistinguishable from "the operator is
 * asking". `MissionOwnershipScope` makes the two different TYPES — absent versus
 * present-with-a-null-participant — so the collapse cannot be written. Proof 9
 * is that trap, held open.
 */

const OWNER = 'alice';
const OTHER = 'mallory';
const ORIGIN = 'https://sunday-relay.vercel.app';
const NOW = 1_757_600_000_000;

/** Provider-free: no architect is configured, so a mission is refused at
    preflight. These assert the OWNERSHIP decision, never a completed run, so
    nothing here contacts anything or spends anything. */
const registry = () => createMissionRegistry({
  fusionBaseUrl: null,
  sundayMode: 'fast',
  claudeMode: 'fake',
  confirmLive: true,
  architectEnv: {},
  hermesEnv: {},
  now: () => '2026-09-11T12:00:00.000Z',
});

const operator: undefined = undefined;
const asParticipant = (participantId: string): MissionOwnershipScope => ({ participantId });
const anonymous: MissionOwnershipScope = { participantId: null };

/** Start a mission owned by `startedBy`, as that same caller. */
const startOwned = (reg: ReturnType<typeof registry>, missionId: string, startedBy: string | null) => {
  const view = reg.start({
    missionId,
    objective: 'Add the guard.',
    startedBy,
    scope: startedBy === null ? operator : asParticipant(startedBy),
  });
  if (view === null) throw new Error(`fixture could not start ${missionId}`);
  return view;
};

describe('A · 1–9 · the rule itself, over every combination of owner and asker', () => {
  it('1 · the operator sees a participant’s mission', () => {
    expect(missionVisibleTo(OWNER, operator)).toBe(true);
  });

  it('2 · the operator sees an operator-started mission', () => {
    expect(missionVisibleTo(null, operator)).toBe(true);
  });

  it('3 · a participant sees their own', () => {
    expect(missionVisibleTo(OWNER, asParticipant(OWNER))).toBe(true);
  });

  it('4 · a participant does NOT see another participant’s', () => {
    expect(missionVisibleTo(OWNER, asParticipant(OTHER))).toBe(false);
  });

  it('5 · a participant does NOT see an operator-started mission', () => {
    // A signed-in participant is not an operator and does not inherit the
    // operator's missions by being signed in.
    expect(missionVisibleTo(null, asParticipant(OWNER))).toBe(false);
  });

  it('6 · an anonymous read-only session does NOT see an operator-started mission', () => {
    // THE CLAUSE THAT MUST NOT BE SOFTENED. A read-only session is the weakest
    // credential the bridge issues, and operator-started missions are the paid
    // ones. "It holds a valid grant" is not "it was granted this mission":
    // grants carry no mission field at all (proofs 32–33), so the scope a
    // paired watch was granted is empty and it reads nothing. Widening this to
    // `startedByParticipant === null` would make every paid operator mission
    // readable by any redeemed grant — generic unauthenticated mission
    // readability wearing a pairing credential.
    expect(missionVisibleTo(null, anonymous)).toBe(false);
  });

  it('7 · an anonymous read-only session does NOT see a participant’s mission', () => {
    expect(missionVisibleTo(OWNER, anonymous)).toBe(false);
  });

  it('8 · an anonymous read-only session sees NOTHING, over every owner shape', () => {
    // Swept rather than sampled: whatever a mission's owner turns out to be —
    // absent, this participant, another, a GitHub-derived id, or the empty
    // string a sloppy caller might store — the answer is the same one.
    for (const owner of [null, OWNER, OTHER, 'ghu-225496319', '']) {
      expect(missionVisibleTo(owner, anonymous), `owner=${JSON.stringify(owner)}`).toBe(false);
    }
  });

  it('9 · the operator and an anonymous session get OPPOSITE answers on the SAME mission', () => {
    // THE NULL TRAP, held open. Both callers present a null participant — one by
    // being unscoped, one by being read-only. If the scope were a single
    // `string | null`, this assertion could not be written at all, because the
    // two callers would be the same argument. That indistinguishability IS the
    // vulnerability, so the proof is that the two answers differ.
    expect(missionVisibleTo(null, operator)).toBe(true);
    expect(missionVisibleTo(null, anonymous)).toBe(false);
  });
});

describe('B · 10–16 · reading a mission', () => {
  it('10 · the owner reads their own', () => {
    const reg = registry();
    startOwned(reg, 'm-read-own', OWNER);
    expect(reg.get('m-read-own', asParticipant(OWNER))).not.toBeNull();
  });

  it('11 · another participant cannot read it', () => {
    const reg = registry();
    startOwned(reg, 'm-read-foreign', OWNER);
    expect(reg.get('m-read-foreign', asParticipant(OTHER))).toBeNull();
  });

  it('12 · an anonymous read-only session cannot read a participant’s mission', () => {
    const reg = registry();
    startOwned(reg, 'm-read-anon', OWNER);
    expect(reg.get('m-read-anon', anonymous)).toBeNull();
  });

  it('13 · an anonymous read-only session cannot read an OPERATOR’s mission either', () => {
    // The paid missions. This is proof 6 exercised through the real registry
    // rather than the rule in isolation, because the rule being right is worth
    // nothing if `get` consults it with the wrong owner.
    const reg = registry();
    startOwned(reg, 'm-read-operator-anon', null);
    expect(reg.get('m-read-operator-anon', anonymous)).toBeNull();
  });

  it('14 · the operator still reads it — unchanged', () => {
    const reg = registry();
    startOwned(reg, 'm-read-operator', OWNER);
    expect(reg.get('m-read-operator', operator)).not.toBeNull();
  });

  it('15 · a foreign id and an id that does not exist are the SAME answer', () => {
    // NON-PROBEABILITY. If "someone else's" and "no such mission" differed by so
    // much as a status code, a caller could enumerate which ids are taken.
    const reg = registry();
    startOwned(reg, 'm-exists', OWNER);
    expect(reg.get('m-exists', asParticipant(OTHER)))
      .toEqual(reg.get('m-no-such-mission-at-all', asParticipant(OTHER)));
  });

  it('16 · an anonymous session cannot tell a real operator mission from a fictional one', () => {
    // Non-probeability for the weakest credential too: a paired browser must not
    // be able to discover WHICH mission ids the operator is currently running.
    const reg = registry();
    startOwned(reg, 'm-operator-real', null);
    expect(reg.get('m-operator-real', anonymous))
      .toEqual(reg.get('m-operator-imaginary', anonymous));
  });
});

describe('C · 17–20 · cancelling a mission', () => {
  it('17 · another participant cannot cancel it, and it is left untouched', () => {
    const reg = registry();
    const before = startOwned(reg, 'm-cancel-foreign', OWNER);
    expect(reg.cancel('m-cancel-foreign', asParticipant(OTHER))).toBeNull();
    // The refusal is BEFORE any state change: the owner's mission must not be
    // able to tell it was targeted.
    const after = reg.get('m-cancel-foreign', asParticipant(OWNER));
    expect(after?.state).toBe(before.state);
  });

  it('18 · a paired read-only session cannot cancel an operator’s mission', () => {
    // "The paired grant must not confer cancel." Cancelling is not a read with a
    // side effect — it terminates a paid run mid-flight.
    const reg = registry();
    const before = startOwned(reg, 'm-cancel-anon', null);
    expect(reg.cancel('m-cancel-anon', anonymous)).toBeNull();
    expect(reg.get('m-cancel-anon', operator)?.state).toBe(before.state);
  });

  it('19 · the owner can cancel their own', () => {
    const reg = registry();
    startOwned(reg, 'm-cancel-own', OWNER);
    expect(reg.cancel('m-cancel-own', asParticipant(OWNER))).not.toBeNull();
  });

  it('20 · the operator can still cancel it — unchanged', () => {
    const reg = registry();
    startOwned(reg, 'm-cancel-operator', OWNER);
    expect(reg.cancel('m-cancel-operator', operator)).not.toBeNull();
  });
});

describe('D · 21–23 · retrying a mission, which is where money is spent', () => {
  it('21 · another participant cannot retry it', () => {
    const reg = registry();
    startOwned(reg, 'm-retry-foreign', OWNER);
    expect(reg.retry('m-retry-foreign', asParticipant(OTHER))).toBeNull();
  });

  it('22 · a paired read-only session cannot retry a participant’s mission', () => {
    const reg = registry();
    startOwned(reg, 'm-retry-anon', OWNER);
    expect(reg.retry('m-retry-anon', anonymous)).toBeNull();
  });

  it('23 · a paired read-only session cannot retry an OPERATOR’s mission — the spend vector', () => {
    // Retry re-drives the three-role pipeline, so a successful call here would
    // buy architect, coder and reviewer time on the founder's credentials from a
    // credential that is supposed to watch. Two independent refusals stand
    // between a browser and this: the route table (proof 35) and the registry
    // (here). This asserts the second one, so the first is not load-bearing
    // alone.
    const reg = registry();
    startOwned(reg, 'm-retry-operator-anon', null);
    expect(reg.retry('m-retry-operator-anon', anonymous)).toBeNull();
  });
});

describe('E · 24–27 · starting, where a read-only caller must reach nothing at all', () => {
  it('24 · a foreign collision yields null, and the owner’s mission is untouched', () => {
    const reg = registry();
    const before = startOwned(reg, 'm-start-collide', OWNER);
    const collided = reg.start({
      missionId: 'm-start-collide',
      objective: 'Something else entirely.',
      startedBy: OTHER,
      scope: asParticipant(OTHER),
    });
    expect(collided).toBeNull();
    // Not merely refused — the owner's mission must not have adopted the
    // colliding caller's objective, which is what a second dispatch would do.
    const after = reg.get('m-start-collide', asParticipant(OWNER));
    expect(after?.missionRevision).toBe(before.missionRevision);
    expect(JSON.stringify(after)).not.toContain('Something else entirely');
  });

  it('25 · a read-only session starts NOTHING — not a free id, not a taken one', () => {
    // "The paired grant must not confer mutation, spend or ownership." A fresh
    // id is the interesting half: refusing only the collision would let a watch
    // CREATE a mission (and run the pipeline) merely by picking an unused id.
    const reg = registry();
    startOwned(reg, 'm-start-taken', null);
    expect(reg.start({ missionId: 'm-start-free', objective: 'Spend on me.', scope: anonymous }))
      .toBeNull();
    expect(reg.start({ missionId: 'm-start-taken', objective: 'Spend on me.', scope: anonymous }))
      .toBeNull();
    // And the refusal left no record behind: nothing was created, so the
    // operator — who can see everything — finds nothing at that id.
    expect(reg.get('m-start-free', operator)).toBeNull();
  });

  it('26 · the owner restarting their own id still gets their own view — idempotency survives', () => {
    const reg = registry();
    const first = startOwned(reg, 'm-start-own', OWNER);
    const again = reg.start({
      missionId: 'm-start-own',
      objective: 'A different objective.',
      startedBy: OWNER,
      scope: asParticipant(OWNER),
    });
    expect(again).not.toBeNull();
    expect(again?.missionRevision).toBe(first.missionRevision);
  });

  it('27 · the operator colliding still gets the existing view — unchanged', () => {
    const reg = registry();
    const first = startOwned(reg, 'm-start-operator', OWNER);
    const again = reg.start({
      missionId: 'm-start-operator',
      objective: 'Operator reconnecting.',
      startedBy: null,
      scope: operator,
    });
    expect(again).not.toBeNull();
    expect(again?.missionRevision).toBe(first.missionRevision);
  });
});

describe('F · 28 · the operator credential is byte-for-byte unchanged', () => {
  it('28 · every verb answers for the operator exactly as it did with no scope at all', () => {
    // The regression that would matter most: a security repair that quietly
    // narrowed the operator. An unscoped call is the operator, and it must reach
    // a participant's mission and an operator's alike, on every verb.
    const reg = registry();
    startOwned(reg, 'm-op-participant', OWNER);
    startOwned(reg, 'm-op-own', null);
    for (const id of ['m-op-participant', 'm-op-own']) {
      expect(reg.get(id, operator), `${id}: operator read`).not.toBeNull();
      expect(reg.retry(id, operator), `${id}: operator retry`).not.toBeNull();
      expect(reg.cancel(id, operator), `${id}: operator cancel`).not.toBeNull();
    }
  });
});

/**
 * G · 29–37 · WHAT A PAIRING GRANT ACTUALLY CONFERS.
 *
 * Clause 2 of the property turns on a claim about the credential, not about the
 * registry: that a pairing grant cannot name a mission, so the scope it was
 * granted is empty. That claim is asserted here against the REAL store and the
 * REAL authorisation gate — mint, redeem, present — rather than assumed, because
 * if a grant ever did carry a mission scope, proof 6 would be wrong and this
 * file should stop compiling until someone says what the new rule is.
 */
describe('G · 29–37 · the pairing credential’s actual reach', () => {
  const store = createBrowserSessionStore();
  const envWithOperatorToken = { RELAY_BRIDGE_API_TOKEN: 'operator-token-never-presented-below' };

  /** Mint a read-only grant and redeem it exactly as a paired browser does. */
  const pairedReadOnlySession = () => {
    const grant = store.createGrant({ origin: ORIGIN, now: NOW });
    const redeemed = store.consumeGrant({
      grantId: grant.grantId, secret: grant.secret, origin: ORIGIN, now: NOW,
    });
    if (!redeemed.ok) throw new Error(`fixture could not redeem a grant: ${redeemed.reason}`);
    return { grant, session: redeemed.session };
  };

  it('29 · with NO credential at all, the mission family is refused before the registry', () => {
    const decision = authorizeReviewerCall({
      method: 'GET', path: '/mission/m-operator', authorization: undefined,
      origin: ORIGIN, env: envWithOperatorToken, now: NOW, store,
    });
    expect(decision.kind).toBe('rejected');
    expect(decision.kind === 'rejected' && decision.status).toBe(401);
  });

  it('30 · an invented session token is refused the same way', () => {
    const decision = authorizeReviewerCall({
      method: 'GET', path: '/mission/m-operator',
      authorization: 'Relay-Session not-a-real-token',
      origin: ORIGIN, env: envWithOperatorToken, now: NOW, store,
    });
    expect(decision.kind).toBe('rejected');
    expect(decision.kind === 'rejected' && decision.status).toBe(401);
  });

  it('31 · a paired session presented from another origin is refused', () => {
    const { session } = pairedReadOnlySession();
    const decision = authorizeReviewerCall({
      method: 'GET', path: '/mission/m-operator',
      authorization: `Relay-Session ${session.token}`,
      origin: 'https://not-the-paired-site.example', env: envWithOperatorToken, now: NOW, store,
    });
    expect(decision.kind).toBe('rejected');
  });

  it('32 · a grant names an origin and a scope — and no mission, run or resource', () => {
    // THE LOAD-BEARING FACT UNDER PROOF 6. Pinned as an exact key set so that
    // teaching a grant to carry a mission scope cannot happen quietly: it breaks
    // here first, and whoever adds the field must then decide, deliberately,
    // what `missionVisibleTo` should do with it.
    const { grant } = pairedReadOnlySession();
    expect(Object.keys(grant).sort())
      .toEqual(['expiresAt', 'grantId', 'origin', 'scope', 'secret']);
  });

  it('33 · and neither does the session it is redeemed for', () => {
    const { session } = pairedReadOnlySession();
    expect(Object.keys(session).sort())
      .toEqual(['expiresAt', 'origin', 'participantId', 'scope', 'sessionId', 'token']);
    // Read-only is bound at mint, and read-only means acting as nobody.
    expect(session.scope).toBe('browser_read_only');
    expect(session.participantId).toBeNull();
  });

  it('34 · a valid, correctly-redeemed grant is ADMITTED at the route and still reads nothing', () => {
    // END TO END, and the point of the whole section. The gate does not refuse
    // this caller — `/mission/:id` is deliberately in BROWSER_READABLE, so the
    // decision is `browser` — and the participant it carries is null. Feeding
    // exactly that decision through the same derivation `server.ts` uses yields
    // a scope that sees neither an operator's mission nor a participant's.
    // A route-level allow is therefore NOT an ownership decision, which is
    // precisely the confusion that produced the original hole.
    const { session } = pairedReadOnlySession();
    const decision = authorizeReviewerCall({
      method: 'GET', path: '/mission/m-operator',
      authorization: `Relay-Session ${session.token}`,
      origin: ORIGIN, env: envWithOperatorToken, now: NOW, store,
    });
    expect(decision.kind).toBe('browser');
    if (decision.kind !== 'browser') return;
    expect(decision.participantId).toBeNull();

    const scope: MissionOwnershipScope = { participantId: decision.participantId };
    const reg = registry();
    startOwned(reg, 'm-operator-paid', null);
    startOwned(reg, 'm-participant-owned', OWNER);
    expect(reg.get('m-operator-paid', scope), 'an operator mission').toBeNull();
    expect(reg.get('m-participant-owned', scope), 'a participant mission').toBeNull();
  });

  it('35 · a read-only session may not reach start, cancel or retry at the route either', () => {
    // "The paired grant must not confer cancel, retry, mutation or spend." The
    // registry refuses these anyway (18, 22, 23, 25); this is the other,
    // independent refusal, so neither layer is load-bearing alone.
    for (const path of ['/mission/start', '/mission/m-1/cancel', '/mission/m-1/retry']) {
      expect(browserSessionMayCall('POST', path, 'browser_read_only'), path).toBe(false);
    }
  });

  it('36 · no broader enumeration: a read-only session’s mission list is empty by construction', () => {
    // `/relay-api/missions` is the only enumerating route a browser may call,
    // and the server lists ONLY `listForParticipant(participantId)` and only
    // when that participant is non-null — which a read-only session never is
    // (proof 33). So the enumeration a paired watch can perform is the empty
    // list, and there is no route that returns "all missions" to a browser.
    const src = readFileSync(join(process.cwd(), 'relay-bridge/server.ts'), 'utf8');
    expect(src).toMatch(
      /missionCaller\?\.kind === 'browser' && missionCaller\.participantId !== null\s*\n\s*\? registry\.listForParticipant\(missionCaller\.participantId\)\s*\n\s*: \[\];/u,
    );
    // And the registry's own list verb takes a participant id, not a scope, so
    // there is no shape in which a null participant could be passed to it.
    const reg = registry();
    startOwned(reg, 'm-list-operator', null);
    startOwned(reg, 'm-list-participant', OWNER);
    expect(reg.listForParticipant(OTHER)).toEqual([]);
  });

  it('37 · read-only means acting as NOBODY, even when a participant is offered', () => {
    // "The paired grant must not confer ownership." The pairing ROUTE already
    // refuses `{scope: read_only, participantId: …}` outright (422, proven in
    // control-scope.test.ts). This is the store beneath it, called directly:
    // offered an identity on a read-only grant, it drops it rather than
    // carrying it. That drop is load-bearing HERE and nowhere else, because a
    // read-only session that kept a participant would — under the ownership
    // rule this file exists to enforce — read that participant's missions.
    const offered = store.createGrant({
      origin: ORIGIN, now: NOW, scope: 'browser_read_only', participantId: OWNER,
    });
    const redeemed = store.consumeGrant({
      grantId: offered.grantId, secret: offered.secret, origin: ORIGIN, now: NOW,
    });
    expect(redeemed.ok).toBe(true);
    if (!redeemed.ok) return;
    expect(redeemed.session.participantId, 'the offered identity must not survive').toBeNull();

    // And the consequence, stated rather than left to inference.
    const reg = registry();
    startOwned(reg, 'm-offered-identity', OWNER);
    expect(reg.get('m-offered-identity', { participantId: redeemed.session.participantId }))
      .toBeNull();
  });
});

/**
 * H · 38–41 · THE WIRING, which the proofs above cannot see.
 *
 * Everything to this point drives the registry and the session store directly.
 * That is where the rules live, but it is not where they are APPLIED: if
 * `server.ts` stopped passing the scope, every proof above would still pass and
 * the hole would be wide open again. These read the route source, the way the
 * evidence-dump cases read the dump script, because the alternative is a guard
 * proven in isolation and unreachable in production.
 */
describe('H · 38–41 · the mission routes actually pass the scope', () => {
  const server = () => readFileSync(join(process.cwd(), 'relay-bridge/server.ts'), 'utf8');

  it('38 · derives the scope from the kept auth decision, never from the body', () => {
    const src = server();
    // Present-with-a-participant for a browser, absent for the operator. Read
    // off `missionCaller`, which is the VERIFIED session.
    expect(src).toMatch(
      /const missionScope: MissionOwnershipScope \| undefined = missionCaller\?\.kind === 'browser'\s*\n\s*\? \{ participantId: missionCaller\.participantId \}\s*\n\s*: undefined;/u,
    );
  });

  it('39 · every ownership-bearing registry call receives it', () => {
    const src = server();
    for (const call of [
      'registry.get(id, missionScope)',
      'registry.cancel(id, missionScope)',
      'registry.retry(id, missionScope)',
    ]) {
      expect(src, `${call} must carry the scope`).toContain(call);
    }
    // And start, which carries it as a named field rather than a positional arg.
    expect(src, 'start must carry the scope').toMatch(/registry\.start\(\{[\s\S]*?scope: missionScope,[\s\S]*?\}\)/u);
  });

  it('40 · no ownership-bearing call is left unscoped', () => {
    const src = server();
    // The mutation this kills: dropping the second argument on any one verb.
    for (const bare of ['registry.get(id)', 'registry.cancel(id)', 'registry.retry(id)']) {
      expect(src, `${bare} would read past the owner`).not.toContain(bare);
    }
  });

  it('41 · a foreign id collision answers 409 and names nobody', () => {
    const src = server();
    expect(src).toContain('mission_id_unavailable');
    // The message must not leak whose it is — no participant is interpolated.
    const message = /kind: 'mission_id_unavailable', message: '([^']*)'/u.exec(src)?.[1] ?? '';
    expect(message, 'a 409 that named the owner would be the leak wearing a refusal').not.toMatch(/\$\{/u);
    expect(message.length, 'the refusal must say something').toBeGreaterThan(0);
  });
});
