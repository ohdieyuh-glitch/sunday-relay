#!/usr/bin/env node
/**
 * WONDERLAND R16 — THE THREE-PARTY PRIVACY SCENARIO, OVER HTTP, AGAINST A REAL BACKEND.
 *
 * The privacy wall is proven in the domain (`wonderland-social-privacy.test.ts`)
 * and on PostgreSQL (`wonderland-social.real-postgres.test.ts`). Final R16 asks
 * a different question: does a RUNNING backend — the real server composition,
 * its sessions, its routes, its database — keep every rule for three real
 * players talking to it over HTTPS, and does what they did survive a restart?
 * This harness asks it, the same way against a local bridge, a CI bridge or the
 * hosted one:
 *
 *   node scripts/wonderland-r16-harness.mjs --bridge <url> --origin <allowed origin> [--state <file>] [--expect-commit <sha>] [--final]
 *   node scripts/wonderland-r16-harness.mjs --bridge <url> --origin <allowed origin> --phase verify --state <file> [--expect-commit <sha>] [--final]
 *
 * WHO THE THREE PLAYERS ARE. Either
 *   - scripted: `RELAY_BRIDGE_TOKEN` (operator, from the environment only, never
 *     printed) pairs three control sessions for three fresh player ids through
 *     the bridge's own `/browser/pair` and `/browser/session`; or
 *   - real: `WONDERLAND_R16_SESSIONS` holds three signed-in players' session
 *     tokens as JSON `{"<playerId>": "<token>", ...}` and `--players a,b,c` names
 *     them in order. This is the FINAL R16 form: three real identities. The
 *     harness changes their social state (friendship, blocks, a party, a server,
 *     messages); every block it makes it lifts again.
 * NATIVE (`--native`): the shipped RC is a native client. It sends no Origin,
 * and its players' sessions are `native_world` sessions their signed-in owners
 * paired (`pairR16NativeSessions` does exactly that in tests). With `--native`
 * the harness speaks as that client, with the native tokens given in
 * `WONDERLAND_R16_SESSIONS`. A bridge whose social routes do not admit native
 * sessions (`allowNative`, a reviewed decision) is reported as such, BLOCKED,
 * never as a broken wall.
 * In either form, `RELAY_BRIDGE_TOKEN` is also what reads the backend's own
 * report (its commit, store and boot), so the restart check and a HOSTED_FINAL
 * venue need it even when the players are real.
 *
 * WHAT IT CHECKS, by name (`R16_CHECKS`), each PASS or FAIL with what it saw:
 * P1 (hidden from strangers: no Dog, name, population or lookup, and a
 * stranger's view with the player present IDENTICAL to the view with them
 * absent), P2 (Recent Players filtered at read time), P3 (no "appear in Recent
 * Players" switch, and one sent is refused), P4/P5 (owner blocks member: member
 * removed, owner stays; member blocks owner: member leaves), the party rules,
 * blocked DMs hidden from both and refused, and no inference between a blocked
 * pair in either direction. A run that skipped a check FAILS: the list is
 * closed, and the summary says how many of it ran.
 *
 * PRESENCE IS A LEASE (docs/relay/WONDERLAND_SOCIAL.md decision 6): a presence
 * not refreshed for 120 s is absent everywhere. So the harness keeps the
 * client's half, refreshing every player standing in the instance every
 * `R16_HEARTBEAT_MS`. Otherwise a slow backend could let a lease lapse
 * mid-scenario, and a player who is not there makes privacy checks pass for the
 * wrong reason. The LEASE check fails on any refused refresh, and on anyone who
 * is not still standing in the instance at the end.
 *
 * RESTART. `--state` records every player's views after the scenario: no
 * token, only what the players were shown. After the backend restarts — which
 * revokes every browser session, by design — `--phase verify` signs the same
 * players in again and checks three things in order:
 *   - DURABLE: what was STORED is shown exactly as before, read before anything
 *     is sent: friends, requests, blocks, the party, servers, the inbox,
 *     conversations, Recent Players, names and settings.
 *   - RECONNECT: each player who stood in the instance does what a client does.
 *     It refreshes its presence: HELD if the lease outlived the restart. On
 *     NOT_IN_INSTANCE it enters again: REENTERED.
 *   - PRESENCE: what the lease derives is shown exactly as before: the roster,
 *     the population, every presence lookup, and a friend's or party-mate's presence.
 * Before all three, RESTART: the backend's boot id (read from its own report,
 * operator only) must differ from the one the scenario recorded. Otherwise a
 * verify phase run against a backend that never restarted would read its own
 * unchanged memory and pass for the wrong reason.
 *
 * THE VENUE, judged apart from the checks (`judgeR16Venue`): HOSTED_FINAL only
 * when the bridge is HTTPS on a public host, three signed-in players are each
 * named by a verified sign-in, the backend's own report shows a production
 * process on a connected, fully migrated store, the commit its platform attests
 * is `--expect-commit`, and (verify) the backend restarted on the same build
 * against the same bridge as a HOSTED_FINAL scenario. Anything less is a
 * REHEARSAL, every reason named; `--final` makes a REHEARSAL exit 1.
 *
 * WHAT IT DOES NOT DO: voice. Voice needs EOS identities on a configured EOS
 * product; the harness reports whether the backend serves voice configuration
 * and nothing more (CORE's final R16 step, with the founder's EOS product).
 *
 * Exit: 0 every check passed (and, with `--final`, the venue is HOSTED_FINAL);
 * 1 a check failed, the backend could not be reached, or `--final` met a
 * REHEARSAL; 2 usage.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

export const R16_VERSION = 'wonderland-r16-harness.v1';

/** How often the harness refreshes a standing player's presence: inside the contract's 30 s, with room for a slow round trip. */
export const R16_HEARTBEAT_MS = 20_000;

/** THE CLOSED LIST. A check not run is a check failed. */
export const R16_CHECKS = Object.freeze([
  'SESSIONS: each session acts as exactly its player',
  'P3: settings are exactly {visibility}; no Recent Players switch exists',
  'P3: a request carrying appearInRecentPlayers is refused and changes nothing',
  'FRIENDS: a request accepted is a friendship on both sides, and nobody else\'s',
  'P1: by default a stranger sees everyone in the instance, Dog and name included',
  'P2: an encounter between visible players is recorded on both sides',
  'P1: hidden from strangers removes the player from a stranger\'s roster and population',
  'P1: a stranger\'s lookup of a hidden player is the answer for a player who does not exist',
  'P1: a stranger\'s message to a hidden player is refused exactly as to a player who does not exist',
  'P1: a stranger\'s view with the hidden player present IS the view with them absent',
  'P2: Recent Players drops a now-hidden player at read time',
  'P1: a friend still sees the hidden player, and finds them by lookup',
  'PARTY: a party-mate sees a hidden leader',
  'PARTY: a non-leader who blocks a member leaves; the party stays',
  'NO INFERENCE: a blocked pair sees no roster entry, presence or count of each other, either way',
  'NO INFERENCE: a blocked player\'s view with the other present IS the view with them absent',
  'PARTY: a leader who blocks a member removes them; the leader stays',
  'SERVER: an invited player joins as a member',
  'P4: an owner who blocks a member removes them; the owner stays',
  'P5: a member who blocks the owner leaves; the owner and the server stay',
  'DM: a message between friends is delivered and listed',
  'DM: a block hides the conversation from both sides and refuses a new message',
  'DM: lifting the block shows the conversation again, with nothing written during the block',
  'LEASE: every player kept their presence alive by heartbeat, as a client must, and is still in the instance at the end',
]);

export function r16Players(nonce) {
  return Object.freeze({ a: `r16a${nonce}`, b: `r16b${nonce}`, c: `r16c${nonce}`, nobody: `r16nobody${nonce}` });
}

const ok = (body) => (body !== null && typeof body === 'object' && 'data' in body ? body.data : body);

/**
 * One HTTP call as one player. A network failure is a result, never an exception the scenario cannot report.
 * `origin: null` speaks as the NATIVE client does: it sends no Origin at all.
 */
function client({ bridge, origin, fetch }) {
  return async (token, method, path, body) => {
    try {
      const response = await fetch(`${bridge}${path}`, {
        method,
        headers: {
          authorization: `Relay-Session ${token}`,
          ...(origin === null || origin === undefined ? {} : { origin }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let json = null;
      try { json = await response.json(); } catch { json = null; }
      return { status: response.status, body: json };
    } catch (error) {
      return { status: 0, body: { error: { kind: 'network', message: error instanceof Error ? error.message : 'unreachable' } } };
    }
  };
}

/**
 * THREE SCRIPTED PLAYERS, signed in through the bridge's own pairing: the
 * operator mints a control grant naming the player, and the browser half
 * redeems it from the allowed origin. Returns the tokens, which stay in memory.
 */
export async function pairR16Sessions({ bridge, origin, operatorToken, playerIds, fetch }) {
  const sessions = {};
  for (const playerId of playerIds) {
    let grant;
    try {
      const response = await fetch(`${bridge}/browser/pair`, {
        method: 'POST',
        headers: { authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ origin, scope: 'control', participantId: playerId }),
      });
      grant = { status: response.status, body: ok(await response.json().catch(() => null)) };
    } catch {
      return { ok: false, reason: 'pairing_unreachable' };
    }
    if (grant.status !== 200 || typeof grant.body?.grantId !== 'string' || typeof grant.body?.grantSecret !== 'string') {
      return { ok: false, reason: `pairing_refused_${String(grant.status)}` };
    }
    let session;
    try {
      const response = await fetch(`${bridge}/browser/session`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ grantId: grant.body.grantId, grantSecret: grant.body.grantSecret }),
      });
      session = { status: response.status, body: ok(await response.json().catch(() => null)) };
    } catch {
      return { ok: false, reason: 'session_unreachable' };
    }
    if (session.status !== 200 || typeof session.body?.sessionToken !== 'string' || session.body?.participantId !== playerId) {
      return { ok: false, reason: `session_refused_${String(session.status)}` };
    }
    sessions[playerId] = session.body.sessionToken;
  }
  return { ok: true, sessions };
}

/**
 * THREE NATIVE CLIENTS, paired exactly the way the shipped RC pairs: each player
 * is signed in on the website (a control session, as above), mints a code for
 * their own desktop client for a project they belong to
 * (`/wonderland/native/pair`, from the allowed origin), and the client redeems
 * it with no Origin at all (`/wonderland/native/session`). Returns the native
 * sessions' tokens, which stay in memory. The players must already be members
 * of `projectId`: membership is the bridge's to decide, never the harness's.
 */
export async function pairR16NativeSessions({ bridge, origin, operatorToken, playerIds, projectId, fetch }) {
  const browser = await pairR16Sessions({ bridge, origin, operatorToken, playerIds, fetch });
  if (!browser.ok) return browser;
  const sessions = {};
  for (const playerId of playerIds) {
    let code;
    try {
      const response = await fetch(`${bridge}/wonderland/native/pair`, {
        method: 'POST',
        headers: { authorization: `Relay-Session ${browser.sessions[playerId]}`, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      code = { status: response.status, body: ok(await response.json().catch(() => null)) };
    } catch {
      return { ok: false, reason: 'native_pairing_unreachable' };
    }
    if (code.status !== 200 || typeof code.body?.code !== 'string' || code.body?.participantId !== playerId) {
      return { ok: false, reason: `native_pairing_refused_${String(code.status)}` };
    }
    let session;
    try {
      const response = await fetch(`${bridge}/wonderland/native/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.body.code }),
      });
      session = { status: response.status, body: ok(await response.json().catch(() => null)) };
    } catch {
      return { ok: false, reason: 'native_session_unreachable' };
    }
    if (session.status !== 200 || typeof session.body?.token !== 'string' || session.body?.participantId !== playerId) {
      return { ok: false, reason: `native_session_refused_${String(session.status)}` };
    }
    sessions[playerId] = session.body.token;
  }
  return { ok: true, sessions };
}

const instanceOf = (nonce) => `public:r16-${nonce}`;
const sorted = (values) => [...values].sort();
const ids = (list) => sorted((Array.isArray(list) ? list : []).map((item) => item?.playerId));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/**
 * WHAT ONE PLAYER IS SHOWN: everything the scenario asserts on, and everything
 * the restart check compares. Deterministic — no token, no request time.
 */
export async function readR16ViewsOf({ call, token, players, nonce }) {
  const instance = instanceOf(nonce);
  const others = [players.a, players.b, players.c, players.nobody];
  const me = ok((await call(token, 'GET', '/wonderland/social/me')).body);
  const roster = ok((await call(token, 'GET', '/wonderland/social/roster')).body);
  const listing = ok((await call(token, 'GET', `/wonderland/social/instances?ids=${encodeURIComponent(instance)}`)).body);
  const presence = {};
  const conversations = {};
  for (const other of others) {
    presence[other] = ok((await call(token, 'GET', `/wonderland/social/presence/${encodeURIComponent(other)}`)).body);
    conversations[other] = ok((await call(token, 'GET', `/wonderland/social/conversations/${encodeURIComponent(other)}`)).body);
  }
  const server = ok((await call(token, 'GET', `/wonderland/social/servers/${encodeURIComponent(`srv-${nonce}`)}`)).body);
  return { me, roster, listing, presence, conversations, server };
}

export async function readR16Views({ bridge, origin, sessions, players, nonce, fetch }) {
  const call = client({ bridge, origin, fetch });
  const views = {};
  for (const player of [players.a, players.b, players.c]) views[player] = await readR16ViewsOf({ call, token: sessions[player], players, nonce });
  return views;
}

/** Every path at which two view trees differ. Empty means identical. */
export function compareR16Views(before, after, path = '') {
  if (same(before, after)) return [];
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) {
    return [path || '(root)'];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].sort().flatMap((key) => compareR16Views(before[key], after[key], `${path}/${key}`));
}

/**
 * THE SCENARIO. Three players: A will hide from strangers, B is A's friend, C is
 * a stranger to both. Every step is a real command through the real route; every
 * assertion is on a real response. Failures are collected, never thrown, so one
 * broken rule cannot hide the others.
 */
export async function runR16Scenario({ bridge, origin, sessions, players, nonce, fetch, clock = Date.now }) {
  const call = client({ bridge, origin, fetch });
  const results = [];
  const check = (name, passed, detail) => {
    if (!R16_CHECKS.includes(name)) throw new Error(`r16_check_unregistered: ${name}`);
    results.push({ name, result: passed ? 'PASS' : 'FAIL', detail: passed ? '' : detail });
  };
  const { a, b, c, nobody } = players;
  const instance = instanceOf(nonce);
  const token = (player) => sessions[player];
  let commands = 0;
  const send = async (player, cmd) => {
    commands += 1;
    const response = await call(token(player), 'POST', '/wonderland/social/commands', { commandId: `r16-${nonce}-${String(commands)}`, command: cmd });
    return { status: response.status, code: ok(response.body)?.code ?? null };
  };
  // The client's half of the presence lease: every standing player is refreshed before any request once it is due.
  const leases = new Map();
  const lapsed = [];
  let heartbeats = 0;
  const keepAlive = async () => {
    for (const [player, lease] of leases) {
      if (clock() - lease.at < R16_HEARTBEAT_MS) continue;
      lease.at = clock();
      heartbeats += 1;
      const beat = await send(player, { kind: 'UPDATE_PRESENCE', location: lease.location, activity: lease.activity });
      if (!(beat.status === 200 && beat.code === 'DONE')) lapsed.push({ player, ...beat });
    }
  };
  const command = async (player, cmd) => {
    await keepAlive();
    const outcome = await send(player, cmd);
    if (cmd.kind === 'ENTER_INSTANCE' && outcome.status === 200 && outcome.code === 'DONE') {
      leases.set(player, { at: clock(), location: cmd.location, activity: cmd.activity });
    }
    if (cmd.kind === 'LEAVE_INSTANCE' && outcome.status === 200) leases.delete(player);
    return outcome;
  };
  const done = (outcome) => outcome.status === 200 && (outcome.code === 'DONE' || outcome.code === 'NO_CHANGE');
  const get = async (player, path) => {
    await keepAlive();
    return ok((await call(token(player), 'GET', path)).body);
  };
  const me = (player) => get(player, '/wonderland/social/me');
  const roster = (player) => get(player, '/wonderland/social/roster');
  const listing = async (player) => (await get(player, `/wonderland/social/instances?ids=${encodeURIComponent(instance)}`))?.find?.((row) => row.instanceId === instance) ?? null;
  const presenceOf = (player, subject) => get(player, `/wonderland/social/presence/${encodeURIComponent(subject)}`);
  const conversation = (player, other) => get(player, `/wonderland/social/conversations/${encodeURIComponent(other)}`);
  const strangerView = async (viewer, subject) => ({
    roster: await roster(viewer), listing: await listing(viewer), lookup: await presenceOf(viewer, subject), recent: (await me(viewer))?.recentPlayers ?? null,
  });
  const enter = (player, dogId) => command(player, {
    kind: 'ENTER_INSTANCE', instanceId: instance, location: { zone: 'harbour', x: 10, y: 0, z: 4 }, activity: 'EXPLORING', dogId,
  });
  const dogs = { [a]: 'corgi', [b]: 'beagle', [c]: 'husky' };

  // SESSIONS — each one is its player, and only its player. Their first request also makes them exist socially.
  const identities = [];
  for (const player of [a, b, c]) identities.push((await me(player))?.playerId ?? null);
  check(R16_CHECKS[0], same(identities, [a, b, c]), `the sessions answered as ${JSON.stringify(identities)}`);

  // P3
  const settings = (await me(a))?.settings ?? null;
  check(R16_CHECKS[1], settings !== null && same(Object.keys(settings), ['visibility']) && settings.visibility === 'EVERYONE',
    `settings were ${JSON.stringify(settings)}`);
  const smuggled = await command(a, { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS', appearInRecentPlayers: true } });
  const afterSmuggle = (await me(a))?.settings ?? null;
  check(R16_CHECKS[2], smuggled.status === 400 && smuggled.code === 'INVALID' && afterSmuggle?.visibility === 'EVERYONE',
    `the request answered ${String(smuggled.status)}/${String(smuggled.code)} and left ${JSON.stringify(afterSmuggle)}`);

  // FRIENDS: A and B.
  const requested = await command(a, { kind: 'FRIEND_REQUEST', toId: b });
  const accepted = await command(b, { kind: 'FRIEND_ACCEPT', fromId: a });
  const friendsOf = async (player) => ids((await me(player))?.friends);
  const friends = { a: await friendsOf(a), b: await friendsOf(b), c: await friendsOf(c) };
  check(R16_CHECKS[3], done(requested) && done(accepted) && same(friends, { a: [b], b: [a], c: [] }), `friends were ${JSON.stringify(friends)}`);

  // Everyone enters one public instance, visible by default.
  const entered = [await enter(a, dogs[a]), await enter(b, dogs[b]), await enter(c, dogs[c])];
  const cRoster = await roster(c);
  // WHO THE BACKEND SAYS EACH PLAYER IS, while all three are visible to all: the name it recorded from a verified sign-in, or null. The venue judges it.
  const names = Object.fromEntries([a, b, c].map((player) => [player, cRoster?.players?.find?.((entry) => entry.playerId === player)?.displayName ?? null]));
  const strangerA = cRoster?.players?.find?.((entry) => entry.playerId === a);
  const cListing = await listing(c);
  check(R16_CHECKS[4],
    entered.every(done) && same(ids(cRoster?.players), sorted([a, b, c])) && strangerA?.dogId === dogs[a] && strangerA?.relation === 'STRANGER'
      && cRoster?.population === 3 && cListing?.population === 3,
    `entered ${JSON.stringify(entered)}; C's roster ${JSON.stringify(ids(cRoster?.players))}, population ${String(cRoster?.population)}/${String(cListing?.population)}, A as ${JSON.stringify(strangerA ?? null)}`);
  const recent = { a: ids((await me(a))?.recentPlayers), c: ids((await me(c))?.recentPlayers) };
  check(R16_CHECKS[5], recent.c.includes(a) && recent.c.includes(b) && recent.a.includes(b) && recent.a.includes(c),
    `Recent Players were ${JSON.stringify(recent)}`);

  // A hides from strangers.
  const hidden = await command(a, { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
  const hiddenRoster = await roster(c);
  const hiddenListing = await listing(c);
  check(R16_CHECKS[6],
    done(hidden) && same(ids(hiddenRoster?.players), sorted([b, c])) && hiddenRoster?.population === 2 && hiddenListing?.population === 2
      && !JSON.stringify(hiddenRoster).includes(dogs[a]),
    `C's roster ${JSON.stringify(ids(hiddenRoster?.players))}, population ${String(hiddenRoster?.population)}/${String(hiddenListing?.population)}`);
  const lookups = { hidden: await presenceOf(c, a), nobody: await presenceOf(c, nobody) };
  check(R16_CHECKS[7], same(lookups.hidden, { status: 'UNAVAILABLE' }) && same(lookups.hidden, lookups.nobody), `lookups were ${JSON.stringify(lookups)}`);
  const toHidden = await command(c, { kind: 'SEND_MESSAGE', messageId: `r16-${nonce}-to-hidden`, toId: a, body: 'hello?' });
  const toNobody = await command(c, { kind: 'SEND_MESSAGE', messageId: `r16-${nonce}-to-nobody`, toId: nobody, body: 'hello?' });
  check(R16_CHECKS[8], toHidden.code === 'UNAVAILABLE' && same(toHidden, toNobody), `to the hidden player ${JSON.stringify(toHidden)}, to nobody ${JSON.stringify(toNobody)}`);
  const present = await strangerView(c, a);
  const left = await command(a, { kind: 'LEAVE_INSTANCE' });
  const absent = await strangerView(c, a);
  const back = await enter(a, dogs[a]);
  check(R16_CHECKS[9], done(left) && done(back) && same(present, absent),
    `the views differ at ${JSON.stringify(compareR16Views(present, absent))}`);
  const recentHidden = ids((await me(c))?.recentPlayers);
  check(R16_CHECKS[10], !recentHidden.includes(a) && recentHidden.includes(b), `C's Recent Players ${JSON.stringify(recentHidden)}`);
  const bRoster = await roster(b);
  const bLookup = await presenceOf(b, a);
  check(R16_CHECKS[11],
    bRoster?.players?.find?.((entry) => entry.playerId === a)?.relation === 'FRIEND' && bLookup?.status === 'AVAILABLE' && bLookup?.instanceId === instance,
    `B's roster ${JSON.stringify(bRoster?.players ?? null)}, lookup ${JSON.stringify(bLookup)}`);

  // PARTY: A leads; C and B join.
  const party = `party-${nonce}`;
  const partySteps = [
    await command(a, { kind: 'PARTY_CREATE', partyId: party }),
    await command(a, { kind: 'PARTY_INVITE', inviteeId: c }),
    await command(c, { kind: 'PARTY_JOIN', partyId: party }),
    await command(a, { kind: 'PARTY_INVITE', inviteeId: b }),
    await command(b, { kind: 'PARTY_JOIN', partyId: party }),
  ];
  const mateView = await roster(c);
  check(R16_CHECKS[12], partySteps.every(done) && mateView?.players?.find?.((entry) => entry.playerId === a)?.relation === 'PARTY',
    `party steps ${JSON.stringify(partySteps)}; C's roster ${JSON.stringify(mateView?.players ?? null)}`);
  const cBlocksB = await command(c, { kind: 'BLOCK', targetId: b });
  const partyAfter = { a: await me(a), c: await me(c) };
  check(R16_CHECKS[13],
    done(cBlocksB) && partyAfter.c?.party?.inParty === false && partyAfter.a?.party?.leaderId === a && same(ids(partyAfter.a?.party?.members), sorted([a, b])),
    `after C blocked B: C ${JSON.stringify(partyAfter.c?.party ?? null)}, A ${JSON.stringify(partyAfter.a?.party ?? null)}`);
  // NO INFERENCE between the blocked pair, in both directions.
  const pair = {
    cRoster: ids((await roster(c))?.players), bRoster: ids((await roster(b))?.players),
    cLookup: await presenceOf(c, b), bLookup: await presenceOf(b, c),
    cCount: (await listing(c))?.population ?? null,
  };
  check(R16_CHECKS[14],
    !pair.cRoster.includes(b) && !pair.bRoster.includes(c) && same(pair.cLookup, { status: 'UNAVAILABLE' }) && same(pair.bLookup, { status: 'UNAVAILABLE' })
      && pair.cCount === pair.cRoster.length,
    `the blocked pair saw ${JSON.stringify(pair)}`);
  const withB = await strangerView(c, b);
  const bLeft = await command(b, { kind: 'LEAVE_INSTANCE' });
  const withoutB = await strangerView(c, b);
  const bBack = await enter(b, dogs[b]);
  check(R16_CHECKS[15], done(bLeft) && done(bBack) && same(withB, withoutB), `C's views differ at ${JSON.stringify(compareR16Views(withB, withoutB))}`);
  await command(c, { kind: 'UNBLOCK', targetId: b });
  const rejoin = [await command(a, { kind: 'PARTY_INVITE', inviteeId: c }), await command(c, { kind: 'PARTY_JOIN', partyId: party })];
  const aBlocksC = await command(a, { kind: 'BLOCK', targetId: c });
  const leaderAfter = { a: (await me(a))?.party ?? null, c: (await me(c))?.party ?? null };
  check(R16_CHECKS[16],
    rejoin.every(done) && done(aBlocksC) && leaderAfter.c?.inParty === false && leaderAfter.a?.leaderId === a && same(ids(leaderAfter.a?.members), sorted([a, b])),
    `rejoin ${JSON.stringify(rejoin)}; after A blocked C: A ${JSON.stringify(leaderAfter.a)}, C ${JSON.stringify(leaderAfter.c)}`);
  await command(a, { kind: 'UNBLOCK', targetId: c });

  // PRIVATE SERVER: A owns it.
  const server = `srv-${nonce}`;
  const serverPath = `/wonderland/social/servers/${encodeURIComponent(server)}`;
  const serverSteps = [
    await command(a, { kind: 'SERVER_CREATE', serverId: server, name: 'R16 Harbour' }),
    await command(a, { kind: 'SERVER_INVITE', serverId: server, inviteeId: c }),
    await command(c, { kind: 'SERVER_JOIN', serverId: server }),
  ];
  const joined = await get(c, serverPath);
  check(R16_CHECKS[17], serverSteps.every(done) && joined?.available === true && joined?.viewerRole === 'MEMBER',
    `server steps ${JSON.stringify(serverSteps)}; C sees ${JSON.stringify(joined)}`);
  const p4 = await command(a, { kind: 'BLOCK', targetId: c });
  const p4View = { a: await get(a, serverPath), c: await get(c, serverPath) };
  check(R16_CHECKS[18],
    done(p4) && same(p4View.c, { available: false }) && p4View.a?.viewerRole === 'OWNER' && same(ids(p4View.a?.members), [a]),
    `after A blocked C: A ${JSON.stringify(p4View.a)}, C ${JSON.stringify(p4View.c)}`);
  await command(a, { kind: 'UNBLOCK', targetId: c });
  const rejoinServer = [await command(a, { kind: 'SERVER_INVITE', serverId: server, inviteeId: c }), await command(c, { kind: 'SERVER_JOIN', serverId: server })];
  const p5 = await command(c, { kind: 'BLOCK', targetId: a });
  const p5View = { a: await get(a, serverPath), c: await get(c, serverPath) };
  check(R16_CHECKS[19],
    rejoinServer.every(done) && done(p5) && same(p5View.c, { available: false }) && p5View.a?.viewerRole === 'OWNER' && same(ids(p5View.a?.members), [a]),
    `rejoin ${JSON.stringify(rejoinServer)}; after C blocked A: A ${JSON.stringify(p5View.a)}, C ${JSON.stringify(p5View.c)}`);
  await command(c, { kind: 'UNBLOCK', targetId: a });

  // DIRECT MESSAGES between the friends A and B.
  const sent = await command(a, { kind: 'SEND_MESSAGE', messageId: `r16-${nonce}-m1`, toId: b, body: 'Meet at the harbour.' });
  const delivered = { b: await conversation(b, a), inbox: (await me(b))?.inbox ?? null };
  check(R16_CHECKS[20],
    done(sent) && delivered.b?.length === 1 && delivered.b?.[0]?.body === 'Meet at the harbour.' && delivered.inbox?.some?.((row) => row.otherId === a),
    `B was shown ${JSON.stringify(delivered)}`);
  const blocked = await command(b, { kind: 'BLOCK', targetId: a });
  const duringBlock = {
    a: await conversation(a, b), b: await conversation(b, a),
    aInbox: ((await me(a))?.inbox ?? []).map((row) => row.otherId), bInbox: ((await me(b))?.inbox ?? []).map((row) => row.otherId),
    refused: await command(a, { kind: 'SEND_MESSAGE', messageId: `r16-${nonce}-m2`, toId: b, body: 'Are you there?' }),
  };
  check(R16_CHECKS[21],
    done(blocked) && same(duringBlock.a, []) && same(duringBlock.b, []) && !duringBlock.aInbox.includes(b) && !duringBlock.bInbox.includes(a)
      && duringBlock.refused.code === 'UNAVAILABLE',
    `during the block: ${JSON.stringify(duringBlock)}`);
  const lifted = await command(b, { kind: 'UNBLOCK', targetId: a });
  const afterBlock = await conversation(b, a);
  check(R16_CHECKS[22], done(lifted) && afterBlock?.length === 1 && afterBlock?.[0]?.messageId === `r16-${nonce}-m1`,
    `after the block B was shown ${JSON.stringify(afterBlock)}`);

  // LEASE: nobody was lost on the way, so no check above passed because a player was simply not there.
  const own = {};
  for (const player of [a, b, c]) own[player] = await presenceOf(player, player);
  check(R16_CHECKS[23],
    lapsed.length === 0 && [a, b, c].every((player) => own[player]?.status === 'AVAILABLE' && own[player]?.instanceId === instance),
    `refreshes refused ${JSON.stringify(lapsed)}; each player's own presence ${JSON.stringify(own)}`);

  return Object.freeze({ results: Object.freeze(results), commands, heartbeats, names: Object.freeze(names) });
}

/**
 * WHAT A VIEW HOLDS, IN TWO PARTS. What is STORED survives any restart. What
 * the presence LEASE derives lasts only while the player keeps it alive, so a
 * restart that outlasts the lease ends it, as a disconnection does.
 */
export function splitR16View(view) {
  const withoutPresence = (rows) => (Array.isArray(rows) ? rows.map(({ presence: _presence, ...rest }) => rest) : rows ?? null);
  const presenceOnly = (rows) => (Array.isArray(rows) ? rows.map((row) => ({ playerId: row?.playerId, presence: row?.presence })) : rows ?? null);
  const me = view?.me ?? null;
  const party = me?.party ?? null;
  const inParty = party?.inParty === true;
  return {
    stored: {
      me: me === null ? null : { ...me, friends: withoutPresence(me.friends), party: inParty ? { ...party, members: withoutPresence(party.members) } : party },
      conversations: view?.conversations ?? null,
      server: view?.server ?? null,
    },
    lease: {
      roster: view?.roster ?? null,
      listing: view?.listing ?? null,
      presence: view?.presence ?? null,
      friends: presenceOnly(me?.friends),
      party: inParty ? presenceOnly(party.members) : null,
    },
  };
}

/**
 * THE CLIENT'S HALF ON RECONNECT. A player who stood in an instance before the
 * restart refreshes their presence with what they last sent: HELD when the
 * lease outlived the restart. When the backend answers NOT_IN_INSTANCE, the
 * lease ran out while it was down, so the player enters again: REENTERED. A
 * player who stood nowhere sends nothing: ABSENT. Anything else is REFUSED.
 */
export async function reconnectR16Presence({ bridge, origin, sessions, players, nonce, recorded, fetch }) {
  const call = client({ bridge, origin, fetch });
  const tag = randomBytes(3).toString('hex');
  const outcome = {};
  let sent = 0;
  for (const player of [players.a, players.b, players.c]) {
    const own = recorded?.views?.[player]?.presence?.[player];
    if (own?.status !== 'AVAILABLE') { outcome[player] = 'ABSENT'; continue; }
    const self = recorded.views[player].roster?.players?.find?.((entry) => entry.playerId === player) ?? null;
    const send = async (command) => {
      sent += 1;
      const response = await call(sessions[player], 'POST', '/wonderland/social/commands', { commandId: `r16-${nonce}-reconnect-${tag}-${String(sent)}`, command });
      return { status: response.status, code: ok(response.body)?.code ?? null };
    };
    const beat = await send({ kind: 'UPDATE_PRESENCE', location: own.location, activity: own.activity });
    if (beat.status === 200 && beat.code === 'DONE') { outcome[player] = 'HELD'; continue; }
    if (beat.code !== 'NOT_IN_INSTANCE') { outcome[player] = `REFUSED_${String(beat.status)}_${String(beat.code)}`; continue; }
    const entered = await send({ kind: 'ENTER_INSTANCE', instanceId: own.instanceId, location: own.location, activity: own.activity, dogId: self?.dogId ?? null });
    outcome[player] = entered.status === 200 && entered.code === 'DONE' ? 'REENTERED' : `REFUSED_${String(entered.status)}_${String(entered.code)}`;
  }
  return outcome;
}

/**
 * THE RESTART CHECK. DURABLE is read before anything is sent, so the stored
 * state is judged as it was stored. Then each player reconnects as a client
 * does, and PRESENCE judges what the lease derives.
 */
export async function verifyR16Restart({ bridge, origin, sessions, players, nonce, recorded, fetch }) {
  const results = [];
  const everyone = [players.a, players.b, players.c];
  const asStored = await readR16Views({ bridge, origin, sessions, players, nonce, fetch });
  for (const player of everyone) {
    const differences = compareR16Views(splitR16View(recorded?.views?.[player]).stored, splitR16View(asStored[player]).stored);
    results.push({
      name: `DURABLE: ${player} is shown after the restart exactly what was stored before`,
      result: differences.length === 0 ? 'PASS' : 'FAIL',
      detail: differences.length === 0 ? '' : `differs at ${differences.join(' ')}`,
    });
  }
  const reconnect = await reconnectR16Presence({ bridge, origin, sessions, players, nonce, recorded, fetch });
  const reconnected = await readR16Views({ bridge, origin, sessions, players, nonce, fetch });
  for (const player of everyone) {
    const differences = compareR16Views(splitR16View(recorded?.views?.[player]).lease, splitR16View(reconnected[player]).lease);
    const refused = String(reconnect[player]).startsWith('REFUSED');
    results.push({
      name: `PRESENCE: ${player} reconnected (${String(reconnect[player])}) and is shown the same world as before`,
      result: differences.length === 0 && !refused ? 'PASS' : 'FAIL',
      detail: refused ? `the reconnect was ${String(reconnect[player])}` : differences.length === 0 ? '' : `differs at ${differences.join(' ')}`,
    });
  }
  return Object.freeze({ results: Object.freeze(results), reconnect: Object.freeze(reconnect), views: reconnected });
}

/** Whether the backend serves voice configuration: reported, never a check (voice is CORE's live step). */
export async function probeR16Voice({ bridge, origin, token, fetch }) {
  const response = await client({ bridge, origin, fetch })(token, 'GET', '/wonderland/eos/client-config');
  return response.status === 200 ? 'CONFIGURED' : response.status === 404 ? 'NOT_MOUNTED' : `NOT_CONFIGURED_${String(response.status)}`;
}

export function summarizeR16(results) {
  const ran = new Set(results.map((row) => row.name));
  const missing = R16_CHECKS.filter((name) => !ran.has(name));
  const failed = results.filter((row) => row.result === 'FAIL').length + missing.length;
  return Object.freeze({ passed: results.filter((row) => row.result === 'PASS').length, failed, missing, of: R16_CHECKS.length });
}

/* ------------------------------------------------------------------- VENUE --- */

/**
 * WHERE THE RUN HAPPENED, JUDGED APART FROM WHAT IT FOUND.
 *
 * The checks say whether a backend kept the privacy wall. They do not say
 * whether it was the backend final R16 is about. A laptop, a CI bridge or a
 * stale deployment can pass every check and prove nothing about the hosted
 * backend players will meet. So every run is also judged for its VENUE, from
 * facts the run reads for itself:
 *   - the bridge's URL, and where its name resolves;
 *   - who the backend says the players are (the name it recorded from a
 *     verified sign-in), and whether they were signed in or paired by the
 *     operator;
 *   - the backend's own report (`GET /relay-api/wonderland/readiness`,
 *     operator only): its store, the commit its platform attests, whether it
 *     takes the production branch of its gates, and which start of it this is.
 *
 * HOSTED_FINAL needs every one of them. Anything less is a REHEARSAL, with every
 * reason named. A rehearsal is evidence about the code, never about the
 * deployment. With `--final`, a run that is not HOSTED_FINAL exits 1, whatever
 * its checks found. HOSTED_FINAL is the backend's half of final R16: the
 * shipped RC and EOS voice are CORE's half, on the same package.
 */
export const R16_VENUE_REASONS = Object.freeze({
  NOT_HTTPS: 'the bridge is not reached over HTTPS',
  HOST_NOT_PUBLIC: 'the bridge\'s host is a loopback, private, link-local or local name: a machine, not a hosted backend',
  HOST_RESOLVES_PRIVATE: 'the bridge\'s name resolves to a loopback, private or link-local address',
  HOST_UNRESOLVED: 'the bridge\'s name did not resolve here, so it is not shown to be public',
  SCRIPTED_PLAYERS: 'the players were paired by the operator, not three signed-in accounts',
  PLAYERS_NOT_VERIFIED: 'the backend knows a player by no verified sign-in, or two players by the same one',
  READINESS_UNREAD: 'the backend\'s own report could not be read (it needs the operator token)',
  NOT_PRODUCTION: 'the backend does not take the production branch of its gates',
  STORE_NOT_CONNECTED: 'the backend\'s database is not connected',
  STORE_NOT_CURRENT: 'the backend\'s ledger has a gap, a pending stamp, or a stamp this build does not know',
  SOCIAL_NOT_READY: 'the backend\'s social store is not ready',
  COMMIT_UNKNOWN: 'no platform attested the commit the backend runs',
  NO_EXPECTED_COMMIT: 'no --expect-commit was given, so "on accepted main" was not checked',
  COMMIT_NOT_EXPECTED: 'the commit the platform attests is not the --expect-commit given',
  SCENARIO_NOT_FINAL: 'the scenario this verifies was not HOSTED_FINAL',
  NOT_RESTARTED: 'the backend has the boot the scenario recorded: it did not restart',
  RESTART_UNPROVEN: 'a boot id could not be read on one side, so the restart is not shown',
  BUILD_CHANGED: 'the backend runs a different commit after the restart: two builds\' evidence in one package',
  BACKEND_CHANGED: 'the verify phase ran against a different bridge than the scenario',
});

/** How a host NAMES itself, before any lookup. Only `NAME` needs resolving; only `PUBLIC_ADDRESS` and a publicly resolving `NAME` are hosted. */
export function classifyR16Host(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[(.*)\]$/u, '$1').replace(/\.$/u, '');
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 127) return 'LOOPBACK';
    if (a === 0) return 'UNSPECIFIED';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return 'PRIVATE';
    if (a === 169 && b === 254) return 'LINK_LOCAL';
    return 'PUBLIC_ADDRESS';
  }
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(host);
    if (mapped) return classifyR16Host(mapped[1]);
    if (host === '::1') return 'LOOPBACK';
    if (host === '::') return 'UNSPECIFIED';
    if (/^f[cd]/u.test(host)) return 'PRIVATE';
    if (/^fe[89ab]/u.test(host)) return 'LINK_LOCAL';
    return 'PUBLIC_ADDRESS';
  }
  if (host === 'localhost' || !host.includes('.') || /\.(localhost|local|internal|lan|home\.arpa|test|example|invalid)$/u.test(host)) return 'LOCAL_NAME';
  return 'NAME';
}

/** The bridge URL's facts: scheme, how its host names itself, and where a name resolves (`resolve` is injected; the CLI uses DNS). */
export async function inspectR16Host(bridge, resolve) {
  const url = new URL(bridge);
  const https = url.protocol === 'https:';
  const kind = classifyR16Host(url.hostname);
  if (kind !== 'NAME') return Object.freeze({ https, kind, resolves: kind === 'PUBLIC_ADDRESS' ? 'PUBLIC' : 'NOT_PUBLIC' });
  let addresses;
  try { addresses = await resolve(url.hostname); } catch { addresses = null; }
  if (!Array.isArray(addresses) || addresses.length === 0) return Object.freeze({ https, kind, resolves: 'UNRESOLVED' });
  return Object.freeze({ https, kind, resolves: addresses.every((address) => classifyR16Host(address) === 'PUBLIC_ADDRESS') ? 'PUBLIC' : 'NOT_PUBLIC' });
}

export const resolveR16Host = async (hostname) => (await lookup(hostname, { all: true })).map((row) => row.address);

/**
 * THE BACKEND'S OWN REPORT, as the operator reads it. Kept to what the venue
 * judges; no driver text, no URL. Unreadable is a reason, never a guess.
 */
export async function readR16Backend({ bridge, operatorToken, fetch }) {
  if (!operatorToken) return Object.freeze({ readable: false, reason: 'NO_OPERATOR_TOKEN' });
  let response;
  try {
    response = await fetch(`${bridge}/wonderland/readiness`, { headers: { authorization: `Bearer ${operatorToken}` } });
  } catch {
    return Object.freeze({ readable: false, reason: 'UNREACHABLE' });
  }
  if (response.status !== 200) return Object.freeze({ readable: false, reason: `REFUSED_${String(response.status)}` });
  const data = ok(await response.json().catch(() => null));
  const identity = data?.bridge;
  if (identity === null || typeof identity !== 'object' || typeof identity.bootId !== 'string') return Object.freeze({ readable: false, reason: 'NO_BRIDGE_IDENTITY' });
  return Object.freeze({
    readable: true,
    commit: typeof identity.commit === 'string' ? identity.commit : null,
    attestedBy: typeof identity.attestedBy === 'string' ? identity.attestedBy : null,
    production: identity.production === true,
    bootId: identity.bootId,
    startedAt: typeof identity.startedAt === 'string' ? identity.startedAt : null,
    database: typeof data?.database?.state === 'string' ? data.database.state : 'UNKNOWN',
    ledger: data?.ledger === null || typeof data?.ledger !== 'object'
      ? null
      : { through: data.ledger.through ?? null, pending: [...(data.ledger.pending ?? [])], gapFree: data.ledger.gapFree === true, unknown: [...(data.ledger.unknown ?? [])] },
    social: typeof data?.surfaces?.social === 'string' ? data.surfaces.social : 'UNKNOWN',
  });
}

/**
 * THE VENUE, JUDGED. Pure: every fact is an input, and every reason is named
 * from the closed list above. The verify phase also judges the restart against
 * what its scenario recorded, so the two phases are one package or not one.
 */
export function judgeR16Venue({ phase, bridge, host, identities, backend, expectCommit, recorded = null }) {
  const reasons = [];
  const add = (code) => {
    if (!Object.prototype.hasOwnProperty.call(R16_VENUE_REASONS, code)) throw new Error(`r16_venue_reason_unregistered: ${code}`);
    if (!reasons.includes(code)) reasons.push(code);
  };
  if (!host.https) add('NOT_HTTPS');
  if (host.kind !== 'NAME' && host.kind !== 'PUBLIC_ADDRESS') add('HOST_NOT_PUBLIC');
  else if (host.resolves === 'UNRESOLVED') add('HOST_UNRESOLVED');
  else if (host.resolves !== 'PUBLIC') add('HOST_RESOLVES_PRIVATE');
  if (identities.source !== 'SIGNED_IN') add('SCRIPTED_PLAYERS');
  if (phase === 'scenario') {
    const names = Object.values(identities.names ?? {});
    const named = names.length === 3 && names.every((name) => typeof name === 'string' && name.trim() !== '');
    if (!named || new Set(names).size !== 3) add('PLAYERS_NOT_VERIFIED');
  }
  if (!backend.readable) {
    add('READINESS_UNREAD');
  } else {
    if (!backend.production) add('NOT_PRODUCTION');
    if (backend.database !== 'CONNECTED') add('STORE_NOT_CONNECTED');
    else if (backend.ledger === null || !backend.ledger.gapFree || backend.ledger.pending.length > 0 || backend.ledger.unknown.length > 0) add('STORE_NOT_CURRENT');
    if (backend.social !== 'READY') add('SOCIAL_NOT_READY');
    if (backend.commit === null) add('COMMIT_UNKNOWN');
    else if (expectCommit && backend.commit !== expectCommit) add('COMMIT_NOT_EXPECTED');
  }
  if (!expectCommit) add('NO_EXPECTED_COMMIT');
  if (phase === 'verify') {
    if (recorded?.venue?.venue !== 'HOSTED_FINAL') add('SCENARIO_NOT_FINAL');
    const before = recorded?.backend ?? null;
    if (typeof before?.bootId !== 'string' || !backend.readable) add('RESTART_UNPROVEN');
    else if (before.bootId === backend.bootId) add('NOT_RESTARTED');
    if (backend.readable && typeof before?.commit === 'string' && backend.commit !== null && before.commit !== backend.commit) add('BUILD_CHANGED');
    if (typeof recorded?.bridge !== 'string' || new URL(recorded.bridge).origin !== new URL(bridge).origin) add('BACKEND_CHANGED');
  }
  return Object.freeze({ venue: reasons.length === 0 ? 'HOSTED_FINAL' : 'REHEARSAL', reasons: Object.freeze(reasons) });
}

/**
 * THE RESTART, AS A CHECK OF THE VERIFY PHASE. Without it, a verify phase run
 * against a backend that never restarted reads its own unchanged memory and
 * passes DURABLE and PRESENCE for the wrong reason. The boot id is drawn when
 * the server is created, so a new id is a new start.
 */
export const R16_RESTART_CHECK = 'RESTART: the backend that answers is a new start, not the one the scenario ran against';

export function r16RestartCheck(before, after) {
  const was = typeof before?.bootId === 'string' ? before.bootId : null;
  const now = after?.readable === true ? after.bootId : null;
  if (was === null || now === null) {
    return Object.freeze({ name: R16_RESTART_CHECK, result: 'FAIL', detail: `a boot id could not be read (${was === null ? 'the scenario recorded none' : `the backend's report: ${String(after?.reason ?? 'unreadable')}`}): the restart is not shown` });
  }
  return was === now
    ? Object.freeze({ name: R16_RESTART_CHECK, result: 'FAIL', detail: `the boot id is still ${was.slice(0, 12)}: this backend did not restart` })
    : Object.freeze({ name: R16_RESTART_CHECK, result: 'PASS', detail: '' });
}

const describeBackend = (backend) => (backend.readable
  ? `commit=${backend.commit ?? 'UNKNOWN'} attested_by=${backend.attestedBy ?? 'none'} production=${String(backend.production)} boot=${backend.bootId.slice(0, 12)} `
    + `store=${backend.database} through=${backend.ledger?.through ?? 'none'} pending=${String(backend.ledger?.pending.length ?? 'UNKNOWN')} social=${backend.social}`
  : `UNREAD ${backend.reason}`);

/* --------------------------------------------------------------------- CLI --- */

const option = (argv, name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};

async function main(argv, env) {
  const bridge = option(argv, 'bridge')?.replace(/\/+$/u, '');
  const origin = option(argv, 'origin');
  const phase = option(argv, 'phase') ?? 'scenario';
  const statePath = option(argv, 'state');
  const expectCommit = option(argv, 'expect-commit')?.trim().toLowerCase() ?? null;
  const final = argv.includes('--final');
  // THE NATIVE CLIENT, as the shipped RC speaks: no Origin on any request, and native sessions only.
  const native = argv.includes('--native');
  const as = native ? null : origin;
  const out = (line) => process.stdout.write(`${line}\n`);
  if (!bridge || !/^https?:\/\/[^\s]+$/u.test(bridge) || (!native && !origin) || !['scenario', 'verify'].includes(phase) || (phase === 'verify' && !statePath)
    || (expectCommit !== null && !/^[0-9a-f]{40}$/u.test(expectCommit))) {
    process.stderr.write('usage: wonderland-r16-harness.mjs --bridge <url> (--origin <allowed origin> | --native) [--phase scenario|verify] [--state <file>] [--nonce <n>] [--players <a,b,c>] [--expect-commit <40-hex sha>] [--final]\n');
    return 2;
  }
  if (native && !env.WONDERLAND_R16_SESSIONS) {
    out('R16 BLOCKED — --native speaks as the RC\'s own clients: give each player\'s NATIVE session token in WONDERLAND_R16_SESSIONS (a native client is paired by its signed-in player, never by the operator).');
    return 2;
  }
  const recorded = phase === 'verify' ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  const nonce = recorded?.nonce ?? option(argv, 'nonce') ?? randomBytes(4).toString('hex');
  const named = option(argv, 'players')?.split(',') ?? null;
  const players = recorded?.players ?? (named === null ? r16Players(nonce) : { a: named[0], b: named[1], c: named[2], nobody: `r16nobody${nonce}` });

  let sessions;
  const source = env.WONDERLAND_R16_SESSIONS ? 'SIGNED_IN' : 'SCRIPTED';
  if (env.WONDERLAND_R16_SESSIONS) {
    try { sessions = JSON.parse(env.WONDERLAND_R16_SESSIONS); } catch { sessions = null; }
    if (sessions === null || [players.a, players.b, players.c].some((id) => typeof sessions[id] !== 'string')) {
      out('R16 BLOCKED — WONDERLAND_R16_SESSIONS must hold a session token for each of the three --players.');
      return 2;
    }
  } else if (env.RELAY_BRIDGE_TOKEN) {
    const paired = await pairR16Sessions({ bridge, origin, operatorToken: env.RELAY_BRIDGE_TOKEN, playerIds: [players.a, players.b, players.c], fetch });
    if (!paired.ok) { out(`R16 BLOCKED — the three players could not be signed in (${paired.reason}).`); return 1; }
    sessions = paired.sessions;
  } else {
    out('R16 BLOCKED — set RELAY_BRIDGE_TOKEN (scripted players) or WONDERLAND_R16_SESSIONS (three real players).');
    return 2;
  }

  const probe = await client({ bridge, origin: as, fetch })(sessions[players.a], 'GET', '/wonderland/social/me');
  if (probe.status === 503) { out('R16 BLOCKED — the backend has no social database (social_store_unavailable): migration 033 is not applied there.'); return 1; }
  if (probe.status === 0) { out('R16 BLOCKED — the backend could not be reached.'); return 1; }
  if (probe.status === 403 && probe.body?.error?.kind === 'native_social_not_enabled') {
    out('R16 BLOCKED — this bridge does not let a native client reach social (native_social_not_enabled). Widening the native scope is a reviewed decision for SECOND Wonderland and the founder, not a failure of the wall.');
    return 1;
  }
  out(`R16 ${R16_VERSION} phase=${phase} backend=${new URL(bridge).host} players=${players.a},${players.b},${players.c}`);
  out(`R16 CLIENT ${native ? 'NATIVE (no Origin, native sessions)' : `BROWSER origin=${origin}`}`);
  out(`R16 VOICE ${await probeR16Voice({ bridge, origin: as, token: sessions[players.a], fetch })} (reported, not checked: voice is CORE's live EOS step)`);
  const backend = await readR16Backend({ bridge, operatorToken: env.RELAY_BRIDGE_TOKEN, fetch });
  out(`R16 BACKEND ${describeBackend(backend)}`);
  const host = await inspectR16Host(bridge, resolveR16Host);
  const judgeVenue = (names) => judgeR16Venue({ phase, bridge, host, identities: { source, names }, backend, expectCommit, recorded });
  const reportVenue = (venue) => {
    out(`R16 VENUE ${venue.venue}${venue.reasons.length === 0 ? '' : ` reasons=${venue.reasons.join(',')}`}`);
    for (const reason of venue.reasons) out(`R16 VENUE REASON ${reason} — ${R16_VENUE_REASONS[reason]}`);
    if (final && venue.venue !== 'HOSTED_FINAL') out(`R16 FINAL REFUSED — --final was asked for, and this run is a ${venue.venue}`);
  };

  if (phase === 'verify') {
    const restart = r16RestartCheck(recorded?.backend, backend);
    const verified = await verifyR16Restart({ bridge, origin: as, sessions, players, nonce, recorded, fetch });
    out(`R16 RECONNECT ${[players.a, players.b, players.c].map((player) => `${player}=${verified.reconnect[player]}`).join(' ')}`);
    const results = [restart, ...verified.results];
    for (const row of results) out(`R16 ${row.result} ${row.name}${row.result === 'FAIL' ? ` — ${row.detail}` : ''}`);
    const failed = results.filter((row) => row.result === 'FAIL').length;
    const venue = judgeVenue(null);
    reportVenue(venue);
    out(`R16 SUMMARY phase=verify passed=${String(results.length - failed)} failed=${String(failed)} of=${String(results.length)} venue=${venue.venue}`);
    return failed === 0 && (!final || venue.venue === 'HOSTED_FINAL') ? 0 : 1;
  }

  const outcome = await runR16Scenario({ bridge, origin: as, sessions, players, nonce, fetch });
  for (const row of outcome.results) out(`R16 ${row.result} ${row.name}${row.result === 'FAIL' ? ` — ${row.detail}` : ''}`);
  const summary = summarizeR16(outcome.results);
  for (const name of summary.missing) out(`R16 FAIL ${name} — not run`);
  const venue = judgeVenue(outcome.names);
  reportVenue(venue);
  if (statePath) {
    const views = await readR16Views({ bridge, origin: as, sessions, players, nonce, fetch });
    const record = { version: R16_VERSION, nonce, players, views, bridge: new URL(bridge).origin, backend, venue, identities: { source, names: outcome.names }, client: native ? 'NATIVE' : 'BROWSER' };
    writeFileSync(statePath, `${JSON.stringify(record, null, 2)}\n`);
    out(`R16 STATE recorded for the restart check: ${statePath}`);
  }
  out(`R16 SUMMARY phase=scenario passed=${String(summary.passed)} failed=${String(summary.failed)} of=${String(summary.of)} venue=${venue.venue}`);
  return summary.failed === 0 && (!final || venue.venue === 'HOSTED_FINAL') ? 0 : 1;
}

const entry = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entry === import.meta.url) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; });
}
