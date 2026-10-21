import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInMemorySocialStore } from '../src/relay/social/social-store';
import { handleSocialRoute, type SocialRouteDeps, type SocialSessionFacts } from './wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from './wonderland-social-scope';

/*
 * TODAY'S WORLD ANSWERS, BYTE FOR BYTE (transport ring prototype, r16reh18; WONDERLAND_DEV, 2026-10-21).
 *
 * This file was written and its fixture recorded on 2528ac5c (origin/main), BEFORE any transport-ring change, so the fixture is
 * today's answer. A request that does not carry `sinceMs` must keep getting exactly these bytes once the ring exists: every
 * status, every header and every body of a deterministic world scenario -- joins, the 100 ms store floor, a stale figure, a
 * player who appears offline, a presence audience of FRIENDS, a block and its removal, a friendship, a private server, an
 * invitation, a leave and a sign-out-shaped leave -- through the real routes and the real in-memory store.
 *
 * The fixture is never regenerated on a branch that changes the world layer: regenerating it there would prove nothing.
 */

const T0 = Date.parse('2026-10-21T12:00:00.000Z');

const SESSIONS: Record<string, SocialSessionFacts> = {
  'tok-kai': { sessionId: 'g1', participantId: 'usr_kai', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  'tok-nova': { sessionId: 'g2', participantId: 'usr_nova', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  'tok-vega': { sessionId: 'g3', participantId: 'usr_vega', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  'tok-rhea': { sessionId: 'g4', participantId: 'usr_rhea', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
};

export type GoldenCall = readonly [token: string, method: 'GET' | 'POST', path: string, body: unknown, atMs: number];

const pos = (x: number, y: number, z: number, motion = 'RUN', speed = 600) => ({ x, y, z, yaw: 90, speed, motion, skinId: 'shadow_flame' });

/** The scenario: every call, in order, at its own clock. No call carries `sinceMs`. */
export const GOLDEN_CALLS: readonly GoldenCall[] = [
  ['tok-kai', 'POST', '/world/join', { target: 'PUBLIC' }, 0],
  ['tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 10],
  ['tok-vega', 'POST', '/world/join', { target: 'PUBLIC' }, 20],
  ['tok-kai', 'POST', '/world/state', pos(0, 0, 10), 100],
  ['tok-nova', 'POST', '/world/state', pos(500, 0, 12), 110],
  ['tok-vega', 'POST', '/world/state', pos(900, 0, 14), 120],
  ['tok-kai', 'POST', '/world/state', pos(10, 0, 10), 150],   // inside the 100 ms floor: not stored, answered
  ['tok-kai', 'POST', '/world/state', pos(20, 0, 11), 250],
  ['tok-nova', 'POST', '/world/state', pos(520, 0, 13, 'JUMP'), 260],
  ['tok-nova', 'POST', '/world/state', pos(540, 0, 30, 'FALL'), 360],
  ['tok-kai', 'POST', '/world/state', pos(30, 0, 12), 370],
  ['tok-kai', 'GET', '/world', null, 380],
  // Nova appears offline: gone from every world view, her reports still stored
  ['tok-nova', 'POST', '/presence', { availability: 'APPEAR_OFFLINE' }, 400],
  ['tok-nova', 'POST', '/world/state', pos(560, 0, 13), 500],
  ['tok-kai', 'POST', '/world/state', pos(40, 0, 12), 510],
  ['tok-nova', 'POST', '/presence', { availability: 'AVAILABLE' }, 600],
  ['tok-kai', 'POST', '/world/state', pos(50, 0, 12), 700],
  // Vega shows her presence to friends only: Kai, a stranger, no longer sees her; a friendship brings her back
  ['tok-vega', 'POST', '/privacy', { presenceVisibility: 'FRIENDS' }, 800],
  ['tok-vega', 'POST', '/world/state', pos(910, 0, 14), 810],
  ['tok-kai', 'POST', '/world/state', pos(60, 0, 12), 820],
  ['tok-kai', 'POST', '/requests', { toUserId: 'usr_vega' }, 900],
  ['tok-vega', 'GET', '/requests', null, 910],
  ['tok-vega', 'POST', '/requests/freq_1/accept', {}, 920],
  ['tok-vega', 'POST', '/world/state', pos(920, 0, 14), 930],
  ['tok-kai', 'POST', '/world/state', pos(65, 0, 12), 940],
  // Kai blocks Nova, then removes the block
  ['tok-kai', 'POST', '/blocks', { targetId: 'usr_nova' }, 1000],
  ['tok-nova', 'POST', '/world/state', pos(580, 0, 13), 1010],
  ['tok-kai', 'POST', '/world/state', pos(70, 0, 12), 1020],
  ['tok-nova', 'POST', '/world/state', pos(600, 0, 13), 1110],
  ['tok-kai', 'POST', '/blocks/usr_nova/remove', {}, 1200],
  ['tok-kai', 'POST', '/world/state', pos(80, 0, 12), 1210],
  // a stale figure: Vega stops reporting for longer than the stale window
  ['tok-kai', 'POST', '/world/state', pos(90, 0, 12), 20_000],
  ['tok-nova', 'POST', '/world/state', pos(620, 0, 13), 20_010],
  ['tok-kai', 'GET', '/world', null, 20_020],
  // Rhea opens a private server and invites nobody; Nova leaves the public world for it by invitation from Rhea
  ['tok-rhea', 'POST', '/world/join', { target: 'PRIVATE', name: 'Lab' }, 20_100],
  ['tok-rhea', 'POST', '/world/state', pos(1, 2, 3, 'IDLE', 0), 20_200],
  ['tok-rhea', 'POST', '/world/invites', { toUserId: 'usr_nova' }, 20_300],   // not friends: refused
  ['tok-rhea', 'POST', '/requests', { toUserId: 'usr_nova' }, 20_301],
  ['tok-nova', 'POST', '/requests/freq_2/accept', {}, 20_302],
  ['tok-rhea', 'POST', '/world/invites', { toUserId: 'usr_nova' }, 20_303],
  ['tok-nova', 'GET', '/world', null, 20_310],
  ['tok-nova', 'POST', '/world/join', { target: 'INVITE', inviteId: 'winv_1' }, 20_320],
  ['tok-nova', 'POST', '/world/state', pos(5, 5, 5, 'WALK', 150), 20_330],
  ['tok-rhea', 'POST', '/world/state', pos(2, 2, 3, 'IDLE', 0), 20_340],
  ['tok-nova', 'POST', '/world/leave', {}, 20_350],
  ['tok-nova', 'POST', '/world/join', { target: 'PUBLIC' }, 20_360],
  ['tok-kai', 'POST', '/world/state', pos(100, 0, 12), 20_400],
  ['tok-nova', 'POST', '/world/leave', {}, 20_500],
  ['tok-kai', 'POST', '/world/state', pos(110, 0, 12), 20_600],
  ['tok-nova', 'POST', '/world/state', pos(1, 1, 1), 20_700],   // outside a world: 404
  ['tok-kai', 'POST', '/world/state', { ...pos(120, 0, 12), motion: 'TELEPORT' }, 20_800],   // 400
  ['tok-kai', 'POST', '/world/leave', {}, 20_900],
];

/** Run the scenario through the real routes and the real in-memory store; one line per answer: status, headers, body. */
export async function runGoldenScenario(calls: readonly GoldenCall[] = GOLDEN_CALLS): Promise<string[]> {
  const store = createInMemorySocialStore();
  const deps: SocialRouteDeps = {
    verifySession: (token) => SESSIONS[token] ?? null,
    sessionIssuedAt: null,
    identify: async (participantId) => ({ userId: participantId, displayName: participantId.replace('usr_', '').replace(/^./, (c) => c.toUpperCase()), handle: `@${participantId.replace('usr_', '')}` }),
    store,
  };
  const lines: string[] = [];
  for (const [token, method, path, body, atMs] of calls) {
    const result = await handleSocialRoute({ method, path: `/wonderland/social${path}`, authorization: `Relay-Session ${token}`, origin: undefined, body, now: T0 + atMs }, deps);
    if (result === null) throw new Error(`not a social route: ${path}`);
    lines.push(JSON.stringify([result.status, result.headers ?? null, result.body]));
  }
  return lines;
}

const FIXTURE = join(__dirname, 'wonderland-social-world-golden.fixture.txt');

describe("today's world answers, byte for byte (recorded on 2528ac5c before the transport ring)", () => {
  it('every answer of the scenario is exactly the recorded bytes', async () => {
    const recorded = readFileSync(FIXTURE, 'utf8').split('\n').filter((line) => line.length > 0);
    const now = await runGoldenScenario();
    expect(now.length).toBe(recorded.length);
    for (let i = 0; i < now.length; i += 1) expect(`${i}: ${now[i]}`).toBe(`${i}: ${recorded[i]}`);
    expect(createHash('sha256').update(now.join('\n')).digest('hex')).toBe(createHash('sha256').update(recorded.join('\n')).digest('hex'));
  });
});
