import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { childEnv, parseArgs } from './r16-local-bridge.mjs';
import { createGitHubDeviceStub, parseIdentity } from './github-device-stub.mjs';
import { createBrowserSessionStore } from '../relay-bridge/browser-session/grants';
import { createPendingSignInStore, handleNativeSignInRoute } from '../relay-bridge/wonderland-native-signin-routes';
import { R16_THROWAWAY_DATABASE, r16ThrowawayDatabase } from './r16-migrate-throwaway';

/*
 * THE R16 LOCAL REHEARSAL'S FENCES, and the GitHub stub against the bridge's REAL sign-in code: the runner refuses every
 * database but the throwaway one and inherits nothing database- or credential-shaped; the stub's identities sign in, in
 * order, through handleNativeSignInRoute exactly as the bridge serves it.
 */

const GOOD = 'postgresql://postgres@127.0.0.1:54329/sw_r16_1';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

describe('the runner refuses anything but the throwaway rehearsal', () => {
  it('accepts the throwaway database, a port and exactly one way to reach GitHub', () => {
    expect(parseArgs(['--db', GOOD, '--port', '8797', '--github-stub', 'http://127.0.0.1:8899'])).toMatchObject({ db: GOOD, port: 8797, githubStub: 'http://127.0.0.1:8899', build: true });
    expect(parseArgs(['--db', GOOD, '--port', '8797', '--client-id-file', 'id.txt', '--no-build'])).toMatchObject({ clientIdFile: 'id.txt', build: false });
  });

  it('refuses the live store and every other database', () => {
    for (const db of ['postgresql://postgres@127.0.0.1:5432/julius', 'postgresql://postgres@127.0.0.1:54329/julius', 'postgresql://postgres@db.example:54329/sw_r16_1', 'postgresql://postgres@127.0.0.1:54329/sw_r16_1;x', 'postgres://postgres@127.0.0.1:54329/sw_social_1']) {
      expect(() => parseArgs(['--db', db, '--port', '8797', '--github-stub', 'http://127.0.0.1:8899']), db).toThrow(/throwaway/);
    }
    expect(() => parseArgs(['--port', '8797', '--github-stub', 'http://127.0.0.1:8899'])).toThrow(/throwaway/);
  });

  it('refuses a bad port, both or neither GitHub source, and a stub that is not loopback', () => {
    expect(() => parseArgs(['--db', GOOD, '--port', '54329', '--github-stub', 'http://127.0.0.1:8899'])).toThrow(/port/);
    expect(() => parseArgs(['--db', GOOD, '--port', '8797'])).toThrow(/exactly one/);
    expect(() => parseArgs(['--db', GOOD, '--port', '8797', '--client-id-file', 'a', '--github-stub', 'http://127.0.0.1:8899'])).toThrow(/exactly one/);
    expect(() => parseArgs(['--db', GOOD, '--port', '8797', '--github-stub', 'http://10.0.0.2:8899'])).toThrow(/127\.0\.0\.1/);
  });

  it('the child inherits no database URL, PG variable, client secret, operator token or production mode', () => {
    const env = childEnv({
      PATH: '/bin', DATABASE_URL: 'postgresql://live', JULIUS_DATABASE_URL: 'postgresql://live2', JULIUS_TEST_DATABASE_URL: 'x', PGHOST: 'h', PGPASSWORD: 'p',
      RELAY_GITHUB_APP_CLIENT_SECRET: 's', RELAY_BRIDGE_API_TOKEN: 'op', NODE_ENV: 'production', WONDERLAND_SOCIAL_TAP: '/old', RELAY_BRIDGE_HOST: '0.0.0.0',
    }, { db: GOOD, port: 8797, clientId: 'Iv1.x', githubStub: null, tap: null, dataDir: '/tmp/r16' });
    expect(env.PATH).toBe('/bin');
    expect(env.JULIUS_DATABASE_URL).toBe(GOOD);
    for (const gone of ['DATABASE_URL', 'JULIUS_TEST_DATABASE_URL', 'PGHOST', 'PGPASSWORD', 'RELAY_GITHUB_APP_CLIENT_SECRET', 'WONDERLAND_SOCIAL_TAP', 'WONDERLAND_SOCIAL_GITHUB_STUB']) {
      expect(env[gone], gone).toBeUndefined();
    }
    expect(env.RELAY_BRIDGE_API_TOKEN).not.toBe('op');
    expect(env).toMatchObject({ NODE_ENV: 'development', WONDERLAND_SOCIAL_ENABLED: '1', RELAY_BRIDGE_HOST: '127.0.0.1', RELAY_BRIDGE_PORT: '8797', RELAY_GITHUB_APP_CLIENT_ID: 'Iv1.x' });
  });

  it('the migrate helper fences on the port R16_THROWAWAY_PG_PORT names (default 54329), never 5432', () => {
    // CORE's default, unchanged
    expect(R16_THROWAWAY_DATABASE.test(GOOD)).toBe(true);
    expect(r16ThrowawayDatabase({}).test('postgresql://postgres@127.0.0.1:54339/sw2_r16_1')).toBe(false);
    // Second's portable instance, named
    const second = r16ThrowawayDatabase({ R16_THROWAWAY_PG_PORT: '54339' });
    expect(second.test('postgresql://postgres@127.0.0.1:54339/sw2_r16_7')).toBe(true);
    expect(second.test('postgresql://postgres@127.0.0.1:54339/sw_r16_7')).toBe(true);
    for (const db of [GOOD, 'postgresql://postgres@127.0.0.1:54339/julius', 'postgresql://postgres@127.0.0.1:54339/sw2_r16_1;x', 'postgresql://postgres@db.example:54339/sw2_r16_1']) {
      expect(second.test(db), db).toBe(false);
    }
    expect(() => r16ThrowawayDatabase({ R16_THROWAWAY_PG_PORT: '5432' })).toThrow(/5432/);
  });
});

describe('the GitHub device stub, through the bridge\'s real sign-in', () => {
  it('parses identities strictly', () => {
    expect(parseIdentity('9001:stub-alpha')).toEqual({ id: 9001, login: 'stub-alpha' });
    for (const bad of ['stub-alpha', '9001:', 'x:stub', '9001:a b']) expect(() => parseIdentity(bad), bad).toThrow();
  });

  it('two identities sign in, in order, each pending once then approved; a third start finds none left', async () => {
    const lines: string[] = [];
    const stub = createGitHubDeviceStub([parseIdentity('9001:stub-alpha'), parseIdentity('9002:stub-beta')], (line: string) => lines.push(line));
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise<void>((r) => stub.close(() => r())));
    const root = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    const sessions = createBrowserSessionStore();
    const recorded: string[] = [];
    let clock = Date.parse('2026-10-03T12:00:00.000Z');
    const deps = { enabled: true, clientId: 'stub-client-id', sessions, pending: createPendingSignInStore(), recordPlayer: async (p: { participantId: string }) => { recorded.push(p.participantId); }, oauthRoot: root, apiRoot: root };
    const post = (path: string, body: unknown = {}) =>
      handleNativeSignInRoute({ method: 'POST', path: `/wonderland/native/signin/${path}`, authorization: undefined, origin: undefined, body, now: clock }, deps) as Promise<{ status: number; body: any }>;
    const signIn = async () => {
      const started = await post('start');
      expect(started.status).toBe(200);
      expect(started.body.data.verificationUri).toBe(`${root}/login/device`);
      clock += 1;
      expect((await post('poll', { handle: started.body.data.handle })).body.data.state).toBe('pending');
      clock += 5000;
      const done = await post('poll', { handle: started.body.data.handle });
      expect(done.status).toBe(200);
      return done.body.data;
    };
    const alpha = await signIn();
    const beta = await signIn();
    expect([alpha.participantId, alpha.login]).toEqual(['ghu-9001', 'stub-alpha']);
    expect([beta.participantId, beta.login]).toEqual(['ghu-9002', 'stub-beta']);
    expect(recorded).toEqual(['ghu-9001', 'ghu-9002']);
    expect(sessions.verifyNativeSocialSession({ token: beta.token, now: clock }).ok).toBe(true);
    expect((await post('start')).status).toBe(503);
    expect(lines.join('\n')).not.toMatch(/stubtok_/);
  });
});
