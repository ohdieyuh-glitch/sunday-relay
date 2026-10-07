import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createBetaRateLimiter } from './beta-rate-limit';
import { createBrowserSessionStore } from './browser-session/grants';
import {
  createPendingSignInStore,
  handleNativeSignInRoute,
  MAX_PENDING_SIGNINS,
  SIGNIN_START_RATE,
  type NativeSignInDeps,
  type SignInFetch,
} from './wonderland-native-signin-routes';

/*
 * THE DESKTOP SIGN-IN, AGAINST A SCRIPTED GITHUB. Every GitHub answer is scripted; every request the bridge makes is recorded,
 * so the tests can say what left the bridge (the client id, the device code to GitHub only) and what never did (a client
 * secret, the device code or the user token to the client, GitHub's own error text).
 */

const T0 = Date.parse('2026-10-03T12:00:00.000Z');
// Built at run time, never literal (the release scan matches secret SHAPES).
const DEVICE_CODE = randomBytes(20).toString('hex');
const USER_TOKEN = ['gh', 'u', '_', randomBytes(18).toString('base64url')].join('');
const LEAK = 'GITHUB-SAYS-SOMETHING-PRIVATE';

interface Call { url: string; body: Record<string, unknown> | null; auth: string | undefined }

function github(script: { device?: () => unknown; token?: Array<() => unknown>; user?: () => { ok: boolean; body: unknown } }) {
  const calls: Call[] = [];
  const tokenAnswers = [...(script.token ?? [])];
  const fetchImpl: SignInFetch = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization });
    if (url.endsWith('/login/device/code')) return { ok: true, status: 200, json: async () => (script.device ?? defaultDevice)() };
    if (url.endsWith('/login/oauth/access_token')) {
      const next = tokenAnswers.shift();
      return { ok: true, status: 200, json: async () => (next ?? (() => ({ error: 'authorization_pending' })))() };
    }
    if (url.endsWith('/user')) {
      const user = (script.user ?? (() => ({ ok: true, body: { login: 'founder-gh', id: 4242, type: 'User' } })))();
      return { ok: user.ok, status: user.ok ? 200 : 401, json: async () => user.body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}

const defaultDevice = () => ({
  device_code: DEVICE_CODE, user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 899, interval: 5,
});

function bridge(gh: ReturnType<typeof github>, over: Partial<NativeSignInDeps> = {}) {
  const sessions = createBrowserSessionStore();
  const recorded: Array<{ participantId: string; login: string }> = [];
  const deps: NativeSignInDeps = {
    enabled: true,
    clientId: 'Iv1.publicclientid',
    sessions,
    pending: createPendingSignInStore(),
    startLimiter: createBetaRateLimiter(SIGNIN_START_RATE),
    recordPlayer: async (p) => { recorded.push(p); },
    fetchImpl: gh.fetchImpl,
    ...over,
  };
  // the claimed client (x-forwarded-for's first hop, as server.ts reads it): a documentation address unless a test names one
  const call = (path: string, body: unknown = null, at = T0, extra: { origin?: string; authorization?: string; clientKey?: string } = {}) =>
    handleNativeSignInRoute({ method: 'POST', path: `/wonderland/native/signin/${path}`, body, now: at, origin: extra.origin, authorization: extra.authorization, clientKey: extra.clientKey ?? '192.0.2.10' }, deps) as
      Promise<{ status: number; body: { data?: any; error?: { kind: string; message: string } }; headers?: Record<string, string> }>;
  return { deps, sessions, recorded, call };
}

/*
 * 10-04: CORE's live bridge hit GitHub's HTTP 400 error=device_flow_disabled, which the silent 503 hid. A failed device-code
 * request now writes ONE server-side WARN line naming GitHub's HTTP status and error CODE; the caller's answer is unchanged.
 */
describe('desktop sign-in: a failed device-code request is logged for the operator, never for the caller', () => {
  const refusing = (status: number, body: unknown): SignInFetch => async (url) => (url.endsWith('/login/device/code')
    ? { ok: status >= 200 && status < 300, status, json: async () => body }
    : { ok: false, status: 404, json: async () => ({}) });

  it("GitHub's 400 device_flow_disabled: the same 503, and exactly one WARN line with the code -- no client id, no code, no text", async () => {
    const lines: string[] = [];
    const clientId = `Iv1.${randomBytes(8).toString('hex')}`;
    const fetchImpl = refusing(400, { error: 'device_flow_disabled', error_description: LEAK, user_code: 'WDJB-MJHT', device_code: DEVICE_CODE });
    const b = bridge({ calls: [], fetchImpl }, { clientId, log: (l) => lines.push(l) });
    const quiet = bridge({ calls: [], fetchImpl }, { clientId });
    const answer = await b.call('start', {});
    const unlogged = await quiet.call('start', {});
    expect(answer.status).toBe(503);
    expect(JSON.stringify(answer.body)).toBe(JSON.stringify(unlogged.body)); // nothing new for the caller
    expect(JSON.stringify(answer.body)).toContain('signin_unavailable');
    expect(JSON.stringify(answer.body)).toContain('Signing in from the desktop is not available on this server right now.');
    expect(JSON.stringify(answer.body)).not.toMatch(/device_flow_disabled|HTTP 400|GitHub said/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('device_flow_disabled');
    expect(lines[0]).toContain('HTTP 400');
    for (const secret of [clientId, DEVICE_CODE, 'WDJB-MJHT', LEAK]) expect(lines.join('\n')).not.toContain(secret);
  });

  it('other refusals: the GitHub code is sanitised to [a-z_]{1,64}; a network failure and a 200 error are logged the same way', async () => {
    const cases: Array<[SignInFetch, RegExp]> = [
      [refusing(200, { error: 'incorrect_client_credentials' }), /HTTP 200, error=incorrect_client_credentials\)/],
      [refusing(400, { error: `unsupported_grant_type ${LEAK}` }), /HTTP 400, error=unrecognised\)/],
      [refusing(401, { error: 'Bad-Code<script>' }), /HTTP 401, error=unrecognised\)/],
      [refusing(500, null), /HTTP 500, error=unrecognised\)/],
      [async () => { throw new Error(`connect failed ${DEVICE_CODE}`); }, /HTTP none, error=no_answer\)/],
    ];
    for (const [fetchImpl, want] of cases) {
      const lines: string[] = [];
      const b = bridge({ calls: [], fetchImpl }, { log: (l) => lines.push(l) });
      expect((await b.call('start', {})).status).toBe(503);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(want);
      for (const secret of ['Iv1.publicclientid', DEVICE_CODE, LEAK, '<script>']) expect(lines[0]).not.toContain(secret);
    }
  });

  it('a successful start logs nothing', async () => {
    const lines: string[] = [];
    const b = bridge(github({}), { log: (l) => lines.push(l) });
    expect((await b.call('start', {})).status).toBe(200);
    expect(lines).toEqual([]);
  });
});

describe('desktop sign-in: who may start it', () => {
  it('refuses a web Origin, and is 503 when the deployment has not enabled social or has no client id -- without asking GitHub', async () => {
    const gh = github({});
    expect((await bridge(gh).call('start', null, T0, { origin: 'https://evil.example' })).body.error?.kind).toBe('native_client_only');
    expect((await bridge(gh, { enabled: false }).call('start')).status).toBe(503);
    expect((await bridge(gh, { clientId: null }).call('start')).body.error?.kind).toBe('signin_unavailable');
    expect(gh.calls).toHaveLength(0);
  });

  it('is 503 while the social schema is absent (033 not applied) -- before GitHub is asked, and no player is recorded', async () => {
    const gh = github({ token: [() => ({ access_token: USER_TOKEN })] });
    let ready = false;
    const b = bridge(gh, { socialReady: async () => ready });
    const start = await b.call('start');
    expect(start.status).toBe(503);
    expect(start.body.error?.kind).toBe('signin_unavailable');
    expect(gh.calls).toHaveLength(0);
    // the control: the same bridge with the schema present signs in, so the gate is the only difference
    ready = true;
    const handle = (await b.call('start')).body.data.handle as string;
    ready = false;
    expect((await b.call('poll', { handle }, T0 + 1)).status).toBe(503);
    expect(b.recorded).toHaveLength(0);
    expect(b.sessions.size.sessions).toBe(0);
  });

  it('is 503 when GitHub refuses the device flow, and never echoes GitHub', async () => {
    const gh = github({ device: () => ({ error: 'device_flow_disabled', error_description: LEAK }) });
    const r = await bridge(gh).call('start');
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain(LEAK);
  });

  it('refuses a user code or page that is not GitHub\'s shape', async () => {
    const odd = github({ device: () => ({ ...defaultDevice(), verification_uri: 'https://evil.example/login/device' }) });
    expect((await bridge(odd).call('start')).status).toBe(503);
    const long = github({ device: () => ({ ...defaultDevice(), user_code: 'VISIT EVIL DOT EXAMPLE' }) });
    expect((await bridge(long).call('start')).status).toBe(503);
  });
});

describe('desktop sign-in: the whole flow', () => {
  it('start gives the client a handle, the code and GitHub\'s page -- never the device code -- and sends GitHub no secret', async () => {
    const gh = github({});
    const b = bridge(gh);
    const r = await b.call('start');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', interval: 5 });
    expect(typeof r.body.data.handle).toBe('string');
    expect(JSON.stringify(r.body)).not.toContain(DEVICE_CODE);
    expect(gh.calls[0]?.body).toEqual({ client_id: 'Iv1.publicclientid' });
    expect(gh.calls.every((c) => c.body === null || !('client_secret' in c.body))).toBe(true);
  });

  it('pending, then approved: one session for ghu-<id>, the player recorded first, the GitHub token never returned, the handle single-use', async () => {
    const gh = github({ token: [() => ({ error: 'authorization_pending' }), () => ({ access_token: USER_TOKEN, token_type: 'bearer' })] });
    const b = bridge(gh);
    const handle = (await b.call('start')).body.data.handle as string;
    const first = await b.call('poll', { handle }, T0 + 1);
    expect(first.body.data).toEqual({ state: 'pending', interval: 5 });
    // too early: answered pending without asking GitHub again
    const before = gh.calls.length;
    expect((await b.call('poll', { handle }, T0 + 2000)).body.data.state).toBe('pending');
    expect(gh.calls.length).toBe(before);
    const done = await b.call('poll', { handle }, T0 + 6000);
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ state: 'signed_in', participantId: 'ghu-4242', login: 'founder-gh' });
    expect(JSON.stringify(done.body)).not.toContain(USER_TOKEN);
    expect(gh.calls.find((c) => c.url.endsWith('/user'))?.auth).toBe(`Bearer ${USER_TOKEN}`);
    expect(gh.calls.filter((c) => c.url.endsWith('/access_token')).every((c) => c.body?.device_code === DEVICE_CODE)).toBe(true);
    expect(b.recorded).toEqual([{ participantId: 'ghu-4242', login: 'founder-gh' }]);
    const verified = b.sessions.verifyNativeSocialSession({ token: done.body.data.token, now: T0 + 7000 });
    expect(verified).toMatchObject({ ok: true, participantId: 'ghu-4242' });
    // the session it minted is a SOCIAL one: no browser route and no world stream accepts it
    expect(b.sessions.verifySession({ token: done.body.data.token, origin: undefined, now: T0 + 7000 }).ok).toBe(false);
    expect(b.sessions.verifyNativeSession({ token: done.body.data.token, now: T0 + 7000 }).ok).toBe(false);
    expect((await b.call('poll', { handle }, T0 + 20_000)).body.error?.kind).toBe('signin_failed');
  });

  it('slow_down lengthens the interval', async () => {
    const gh = github({ token: [() => ({ error: 'slow_down', interval: 10 })] });
    const b = bridge(gh);
    const handle = (await b.call('start')).body.data.handle as string;
    expect((await b.call('poll', { handle }, T0 + 1)).body.data).toEqual({ state: 'pending', interval: 10 });
    const before = gh.calls.length;
    await b.call('poll', { handle }, T0 + 6000);
    expect(gh.calls.length).toBe(before); // 6 s is inside the new 10 s interval
  });

  it('expired, denied and unknown are told apart, each without GitHub\'s text, and each ends the handle', async () => {
    for (const [error, kind] of [['expired_token', 'signin_expired'], ['access_denied', 'signin_denied'], ['incorrect_device_code', 'signin_failed']] as const) {
      const gh = github({ token: [() => ({ error, error_description: LEAK })] });
      const b = bridge(gh);
      const handle = (await b.call('start')).body.data.handle as string;
      const r = await b.call('poll', { handle }, T0 + 1);
      expect(r.status, error).toBe(401);
      expect(r.body.error?.kind, error).toBe(kind);
      expect(JSON.stringify(r.body)).not.toContain(LEAK);
      expect((await b.call('poll', { handle }, T0 + 10_000)).body.error?.kind).toBe('signin_failed');
    }
    const b = bridge(github({}));
    expect((await b.call('poll', { handle: 'x'.repeat(43) })).body.error?.kind).toBe('signin_failed');
    expect((await b.call('poll', {})).body.error?.kind).toBe('signin_failed');
  });

  it('a code past its own lifetime is expired on the bridge, without asking GitHub', async () => {
    const gh = github({});
    const b = bridge(gh);
    const handle = (await b.call('start')).body.data.handle as string;
    const before = gh.calls.length;
    expect((await b.call('poll', { handle }, T0 + 900_000)).body.error?.kind).toBe('signin_expired');
    expect(gh.calls.length).toBe(before);
  });

  it('mints nothing when the player cannot be recorded, or GitHub will not say who it is', async () => {
    const gh = github({ token: [() => ({ access_token: USER_TOKEN })] });
    const b = bridge(gh, { recordPlayer: async () => { throw new Error('db down'); } });
    const handle = (await b.call('start')).body.data.handle as string;
    const r = await b.call('poll', { handle }, T0 + 1);
    expect(r.status).toBe(503);
    expect(b.sessions.size.sessions).toBe(0);
    const nobody = github({ token: [() => ({ access_token: USER_TOKEN })], user: () => ({ ok: false, body: {} }) });
    const b2 = bridge(nobody);
    const h2 = (await b2.call('start')).body.data.handle as string;
    expect((await b2.call('poll', { handle: h2 }, T0 + 1)).body.error?.kind).toBe('signin_failed');
    expect(b2.sessions.size.sessions).toBe(0);
  });
});

describe('desktop sign-out', () => {
  it('revokes its own social session, and refuses a browser session or a web Origin', async () => {
    const b = bridge(github({}));
    const minted = b.sessions.mintNativeSocialSession({ now: T0, participantId: 'ghu-4242' });
    if (!minted.ok) throw new Error('mint');
    expect((await b.call('revoke', null, T0 + 1, { origin: 'https://evil.example', authorization: `Relay-Session ${minted.session.token}` })).status).toBe(403);
    expect((await b.call('revoke', null, T0 + 1, { authorization: `Relay-Session ${minted.session.token}` })).body.data).toEqual({ revoked: true });
    expect(b.sessions.verifyNativeSocialSession({ token: minted.session.token, now: T0 + 2 }).ok).toBe(false);
    const browser = b.sessions.mintIdentitySession({ origin: 'https://wonderland.example', now: T0, participantId: 'ghu-4242', scope: 'browser_control' });
    if (!browser.ok) throw new Error('mint');
    expect((await b.call('revoke', null, T0 + 1, { authorization: `Relay-Session ${browser.session.token}` })).body.error?.kind).toBe('not_signed_in');
    expect(b.sessions.verifySession({ token: browser.session.token, origin: 'https://wonderland.example', now: T0 + 2 }).ok).toBe(true);
  });

  it('ends the player\'s presence after the session is revoked -- once, for its own player only -- and a failure there never undoes the sign-out', async () => {
    const ended: Array<{ participantId: string; now: number }> = [];
    const b = bridge(github({}), { onSignOut: async (participantId, now) => { ended.push({ participantId, now }); } });
    const minted = b.sessions.mintNativeSocialSession({ now: T0, participantId: 'ghu-4242' });
    if (!minted.ok) throw new Error('mint');
    await b.call('revoke', null, T0 + 1, { authorization: 'Relay-Session not-a-session' });
    expect(ended).toEqual([]);
    expect((await b.call('revoke', null, T0 + 1, { authorization: `Relay-Session ${minted.session.token}` })).body.data).toEqual({ revoked: true });
    expect(ended).toEqual([{ participantId: 'ghu-4242', now: T0 + 1 }]);
    const failing = bridge(github({}), { onSignOut: async () => { throw new Error('store down'); } });
    const second = failing.sessions.mintNativeSocialSession({ now: T0, participantId: 'ghu-7' });
    if (!second.ok) throw new Error('mint');
    const answer = await failing.call('revoke', null, T0 + 1, { authorization: `Relay-Session ${second.session.token}` });
    expect(answer.body.data).toEqual({ revoked: true });
    expect(failing.sessions.verifyNativeSocialSession({ token: second.session.token, now: T0 + 2 }).ok).toBe(false);
  });
});

/*
 * 10-06 (Second's review of its own R16 sign-in): the START is the one unauthenticated write in desktop sign-in -- each start keeps a
 * pending sign-in for up to 15 minutes and asks GitHub for a device code. Unlimited, about one start a second from one script held
 * MAX_PENDING_SIGNINS full, and every real player read "Sign-in isn't available on this Wonderland server right now" for as long
 * as the script ran.
 */
describe('desktop sign-in: a flood of starts cannot lock real players out', () => {
  const deviceAsks = (gh: ReturnType<typeof github>) => gh.calls.filter((c) => c.url.endsWith('/login/device/code')).length;

  it('one client: twelve starts a minute, then the answer a full store gives (503 signin_busy) with a Retry-After -- GitHub never asked for those', async () => {
    const gh = github({});
    let readies = 0;
    const b = bridge(gh, { socialReady: async () => { readies += 1; return true; } });
    const answers = [];
    for (let i = 0; i < 15; i += 1) answers.push(await b.call('start', {}, T0 + i * 1000, { clientKey: '203.0.113.7' }));
    expect(answers.map((a) => a.status)).toEqual([...Array(12).fill(200), 503, 503, 503]);
    for (const refused of answers.slice(12)) {
      // the same answer as a full pending store, which the shipped client already words -- not a 429 it would print as a code
      expect(refused.body.error?.kind).toBe('signin_busy');
      const retry = Number(refused.headers?.['retry-after']);
      expect(retry).toBeGreaterThanOrEqual(1);
      expect(retry).toBeLessThanOrEqual(60);
    }
    for (const allowed of answers.slice(0, 12)) expect(allowed.headers?.['retry-after']).toBeUndefined();
    // refused BEFORE any work: GitHub was asked twelve times, the schema read twelve times, twelve sign-ins are pending
    expect(deviceAsks(gh)).toBe(12);
    expect(readies).toBe(12);
    expect(b.deps.pending.size).toBe(12);
    // the control: another client is not refused for it, and the first may start again once its minute has passed
    expect((await b.call('start', {}, T0 + 9_000, { clientKey: '198.51.100.9' })).status).toBe(200);
    expect((await b.call('start', {}, T0 + 61_000, { clientKey: '203.0.113.7' })).status).toBe(200);
  });

  it('a fresh claimed client on every request (a forged x-forwarded-for) meets the global limit: 16 minutes of it never fill the pending store', async () => {
    const gh = github({});
    const b = bridge(gh);
    let most = 0;
    let n = 0;
    for (let s = 0; s < 16 * 60; s += 1) {
      for (const ms of [0, 400]) {
        n += 1;
        await b.call('start', {}, T0 + s * 1000 + ms, { clientKey: `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}` });
        most = Math.max(most, b.deps.pending.size);
      }
    }
    expect(n).toBe(1920);
    expect(most).toBeLessThan(MAX_PENDING_SIGNINS);
    // GitHub asked at most the global limit in each of the 16 minutes (+1 for a window that straddles the start)
    expect(deviceAsks(gh)).toBeLessThanOrEqual(17 * SIGNIN_START_RATE.global);
    expect(deviceAsks(gh)).toBeGreaterThan(0);
  });

  it('is sized so starts alone can never fill the pending store: (15 minutes / window + 1) x global <= MAX_PENDING_SIGNINS', () => {
    expect((Math.ceil(900_000 / SIGNIN_START_RATE.windowMs) + 1) * SIGNIN_START_RATE.global).toBeLessThanOrEqual(MAX_PENDING_SIGNINS);
    // one address may hold a household's three game clients, each pressing SIGN IN twice, and the R16 harness's own sign-ins
    expect(SIGNIN_START_RATE.perKey).toBeGreaterThanOrEqual(10);
    expect(SIGNIN_START_RATE.perKey).toBeLessThanOrEqual(SIGNIN_START_RATE.global / 4); // and one address alone never takes the whole minute
  });

  it('never stops a player who already has a code: polls and sign-out are not starts', async () => {
    const gh = github({ token: [() => ({ error: 'authorization_pending' }), () => ({ access_token: USER_TOKEN, token_type: 'bearer' })] });
    const b = bridge(gh);
    const handle = (await b.call('start', {}, T0, { clientKey: '203.0.113.7' })).body.data.handle as string;
    for (let i = 1; i <= 12; i += 1) await b.call('start', {}, T0 + i, { clientKey: '203.0.113.7' });
    expect((await b.call('start', {}, T0 + 13, { clientKey: '203.0.113.7' })).body.error?.kind).toBe('signin_busy');
    expect((await b.call('poll', { handle }, T0 + 6_000, { clientKey: '203.0.113.7' })).body.data).toEqual({ state: 'pending', interval: 5 });
    const done = await b.call('poll', { handle }, T0 + 12_000, { clientKey: '203.0.113.7' });
    expect(done.body.data).toMatchObject({ state: 'signed_in', participantId: 'ghu-4242' });
    const token = done.body.data.token as string;
    expect((await b.call('revoke', null, T0 + 13_000, { clientKey: '203.0.113.7', authorization: `Relay-Session ${token}` })).body.data).toEqual({ revoked: true });
  });
});
