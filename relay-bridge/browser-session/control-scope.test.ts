import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridgeServer } from '../server';
import { loadBridgeConfig } from '../config';
import { betaWaveZeroState } from '../beta-routes';
import { createBetaEnrolmentStore } from '../../src/relay/persistence';
import { browserSessionMayCall, createBrowserSessionStore } from './grants';

/**
 * THE CONTROL SCOPE — the founder's decision that the website is a real
 * control surface, tested as the security boundary it changes.
 *
 * The rule that must survive: the operator credential never reaches a
 * browser, and a browser never decides what it may do or who it is. A control
 * session is minted only by the operator's CLI, inherits its scope and its
 * participant AT MINT, and the mission routes use the session's identity —
 * never the request body's.
 *
 * These run against the REAL bridge server over real HTTP, with the
 * controlled beta ON and a real enrolment store on disk, because the property
 * under test is precisely the interaction between pairing, admission and the
 * mission family. A unit test of the allowlist alone would have proven the
 * pattern while the server discarded the decision — which is exactly what the
 * pre-change server did.
 */

const OPERATOR = 'operator-secret-for-tests-0123456789abcdef';
const ORIGIN = 'https://sunday-relay.vercel.app';

const servers: Array<{ close: (cb: () => void) => void }> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/** The started mission the stubbed registry reports. What matters is WHO got here. */
const started: Array<{ missionId: string }> = [];

async function boot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'relay-control-scope-'));
  roots.push(root);
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_HERMES_EXECUTABLE', '/nonexistent/relay-hermes-probe');
  vi.stubEnv('RELAY_DATA_DIR', root);
  vi.stubEnv('RELAY_BETA_ENABLED', '1');
  vi.stubEnv('RELAY_BETA_WAVE_0_OPEN', '1');
  const config = loadBridgeConfig(process.env);
  /**
   * The beta store and its wave are POSITIONAL PARAMETERS of the server, not
   * derived from config inside it — the first draft of this harness assumed
   * they were and every beta-dependent test answered `beta_not_ready`. Wired
   * here exactly as the production boot at the bottom of server.ts wires them.
   */
  const server = createBridgeServer(
    config,
    {
      start: (input: { missionId: string }) => {
        started.push({ missionId: input.missionId });
        return { state: 'ready' } as never;
      },
      get: () => ({ state: 'ready' }) as never,
      cancel: () => undefined,
      retry: () => undefined,
    } as never,
    null, null, null, null,
    () => false,
    createBetaEnrolmentStore({ root }),
    [{ wave: 'wave_0', state: betaWaveZeroState(process.env), seats: 100 }],
  );
  servers.push(server as never);
  await new Promise<void>((r) => (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
  const address = (server as never as { address: () => { port: number } | null }).address();
  return `http://127.0.0.1:${address === null ? 0 : address.port}`;
}

const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

async function enrol(base: string, participantId: string): Promise<void> {
  const req = await post(base, '/beta/request', { participantId });
  if (req.status !== 200) throw new Error(`beta/request ${req.status}: ${await req.text()}`);
  const access = await post(base, '/beta/access', { participantId }, {
    Authorization: `Bearer ${OPERATOR}`,
  });
  expect(((await access.json()) as { data: { admitted: boolean } }).data.admitted).toBe(true);
}

async function pairWith(
  base: string,
  body: Record<string, unknown>,
): Promise<{ token: string; scope: string; participantId: unknown }> {
  const minted = await post(base, '/relay-api/browser/pair', { origin: ORIGIN, ...body }, {
    Authorization: `Bearer ${OPERATOR}`,
  });
  expect(minted.status).toBe(200);
  const grant = ((await minted.json()) as { data: { grantId: string; grantSecret: string } }).data;
  const exchanged = await post(base, '/relay-api/browser/session', grant, { Origin: ORIGIN });
  expect(exchanged.status).toBe(200);
  const session = ((await exchanged.json()) as {
    data: { sessionToken: string; scope: string; participantId: unknown };
  }).data;
  return { token: session.sessionToken, scope: session.scope, participantId: session.participantId };
}

describe('minting decides everything, and only the operator mints', () => {
  it('a control grant requires the participant it acts as, well-formed', async () => {
    const base = await boot();
    const noWho = await post(base, '/relay-api/browser/pair', { origin: ORIGIN, scope: 'control' }, {
      Authorization: `Bearer ${OPERATOR}` });
    expect(noWho.status).toBe(422);
    const badWho = await post(base, '/relay-api/browser/pair',
      { origin: ORIGIN, scope: 'control', participantId: 'no spaces allowed' },
      { Authorization: `Bearer ${OPERATOR}` });
    expect(badWho.status).toBe(422);
  }, 30_000);

  it('a misspelled scope is refused, never downgraded to read-only', async () => {
    // An operator who typed 'contrl' must find out HERE, not as a 403 in the
    // founder's browser twenty minutes later.
    const base = await boot();
    const typo = await post(base, '/relay-api/browser/pair',
      { origin: ORIGIN, scope: 'contrl', participantId: 'founder' },
      { Authorization: `Bearer ${OPERATOR}` });
    expect(typo.status).toBe(422);
  }, 30_000);

  it('a participant on a read-only grant is refused as the dormant claim it is', async () => {
    const base = await boot();
    const res = await post(base, '/relay-api/browser/pair',
      { origin: ORIGIN, participantId: 'founder' },
      { Authorization: `Bearer ${OPERATOR}` });
    expect(res.status).toBe(422);
  }, 30_000);

  it('the redeemed session reports the scope and identity that were minted', async () => {
    const base = await boot();
    await enrol(base, 'founder');
    const session = await pairWith(base, { scope: 'control', participantId: 'founder' });
    expect(session.scope).toBe('browser_control');
    expect(session.participantId).toBe('founder');
  }, 30_000);
});

describe('what each scope may do against the real mission routes', () => {
  it('a READ-ONLY session cannot start a mission, with the reason named', async () => {
    const base = await boot();
    await enrol(base, 'founder');
    const session = await pairWith(base, {});
    const res = await post(base, '/relay-api/mission/start',
      { missionId: 'm-read-only-start', objective: 'x' },
      { Authorization: `Relay-Session ${session.token}`, Origin: ORIGIN });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('read-only');
    expect(started.some((s) => s.missionId === 'm-read-only-start')).toBe(false);
  }, 30_000);

  it('a CONTROL session starts a mission as the participant bound at mint', async () => {
    const base = await boot();
    await enrol(base, 'founder');
    const session = await pairWith(base, { scope: 'control', participantId: 'founder' });
    const res = await post(base, '/relay-api/mission/start',
      { missionId: 'm-control-start', objective: 'x' },
      { Authorization: `Relay-Session ${session.token}`, Origin: ORIGIN });
    expect(res.status).toBe(200);
    expect(started.some((s) => s.missionId === 'm-control-start')).toBe(true);
  }, 30_000);

  it('the BODY cannot make a browser someone else', async () => {
    /**
     * The core of the design. The session was minted for `founder`; the page
     * claims to be `somebody-unenrolled`, who holds no seat. If the body were
     * believed this would be refused (unenrolled) — and worse, the mirror
     * case would let a page act as any enrolled participant. It starts,
     * because the SESSION's identity is the only one consulted.
     */
    const base = await boot();
    await enrol(base, 'founder');
    const session = await pairWith(base, { scope: 'control', participantId: 'founder' });
    const res = await post(base, '/relay-api/mission/start',
      { missionId: 'm-body-liar', objective: 'x', participantId: 'somebody-unenrolled' },
      { Authorization: `Relay-Session ${session.token}`, Origin: ORIGIN });
    expect(res.status).toBe(200);
    expect(started.some((s) => s.missionId === 'm-body-liar')).toBe(true);
  }, 30_000);

  it('a control session bound to an UNENROLLED participant is refused by the gate', async () => {
    // Pairing is not admission. The beta gate still decides, against the
    // session's identity — a control session is a voice, not a seat.
    const base = await boot();
    const session = await pairWith(base, { scope: 'control', participantId: 'nobody-enrolled' });
    const res = await post(base, '/relay-api/mission/start',
      { missionId: 'm-no-seat', objective: 'x' },
      { Authorization: `Relay-Session ${session.token}`, Origin: ORIGIN });
    expect(res.status).toBe(403);
    expect(started.some((s) => s.missionId === 'm-no-seat')).toBe(false);
  }, 30_000);

  it('a control session cannot reach any spending route outside the mission family', async () => {
    const base = await boot();
    await enrol(base, 'founder');
    const session = await pairWith(base, { scope: 'control', participantId: 'founder' });
    // The paid probe, and the self-copying key: both must stay operator-only.
    for (const path of ['/relay-api/reviewer/test-connection', '/relay-api/browser/pair']) {
      const res = await post(base, path, { origin: ORIGIN },
        { Authorization: `Relay-Session ${session.token}`, Origin: ORIGIN });
      expect([401, 403]).toContain(res.status);
    }
  }, 30_000);

  it('operators are unchanged: body participant, any route', async () => {
    const base = await boot();
    await enrol(base, 'founder');
    const res = await post(base, '/relay-api/mission/start',
      { missionId: 'm-operator', objective: 'x', participantId: 'founder' },
      { Authorization: `Bearer ${OPERATOR}` });
    expect(res.status).toBe(200);
    expect(started.some((s) => s.missionId === 'm-operator')).toBe(true);
  }, 30_000);
});

describe('the allowlist itself, at the unit seam', () => {
  it('control adds exactly the mission spending verbs, nothing else', () => {
    expect(browserSessionMayCall('POST', '/mission/start', 'browser_control')).toBe(true);
    expect(browserSessionMayCall('POST', '/mission/m-1/cancel', 'browser_control')).toBe(true);
    expect(browserSessionMayCall('POST', '/mission/m-1/retry', 'browser_control')).toBe(true);
    for (const path of ['/reviewer/test-connection', '/reviewer/start', '/browser/pair',
      '/hosted-coding/start', '/beta/access', '/mission/start/extra']) {
      expect(browserSessionMayCall('POST', path, 'browser_control')).toBe(false);
    }
    // Read-only gains nothing from the new tier.
    expect(browserSessionMayCall('POST', '/mission/start', 'browser_read_only')).toBe(false);
    // And both scopes still read.
    expect(browserSessionMayCall('GET', '/mission/m-1', 'browser_control')).toBe(true);
    expect(browserSessionMayCall('GET', '/mission/m-1', 'browser_read_only')).toBe(true);
  });

  it('the exchange can never widen what was minted', () => {
    const store = createBrowserSessionStore();
    const grant = store.createGrant({ origin: ORIGIN, now: 1000 });
    const result = store.consumeGrant({
      grantId: grant.grantId, secret: grant.secret, origin: ORIGIN, now: 2000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.scope).toBe('browser_read_only');
      expect(result.session.participantId).toBeNull();
    }
  });

  it('the store refuses a control grant that acts as nobody', () => {
    const store = createBrowserSessionStore();
    expect(() => store.createGrant({ origin: ORIGIN, now: 1000, scope: 'browser_control' }))
      .toThrow(/participant/);
  });
});
