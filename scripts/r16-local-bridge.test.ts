import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  adminDatabaseUrl, checkEosConfig, childEnv, ensureRoomSaltFile, parseArgs, REPO_ROOT,
  R16_THROWAWAY_DATABASE as LAUNCHER_DEFAULT_FENCE, throwawayDatabase, throwawayPgPort as launcherPgPort,
} from './r16-local-bridge.mjs';
import { throwawayPgPort as seamPgPort } from '../relay-bridge/wonderland-github-stub-seam';
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

/*
 * 10-04 (CORE's ask): the launcher's database fence and admin connection take the port from R16_THROWAWAY_PG_PORT (default
 * 54329) exactly as the stub fence and the migrate helper do; --eos-config and --room-salt-file reach the bridge as PATHS by
 * exact name, while every EOS_* VALUE and every credential-shaped variable stays behind. Every file here is SYNTHETIC, in a
 * fresh temp directory; secret values are made at run time.
 */
describe('the launcher: the throwaway port, the EOS paths, the room-salt file', () => {
  const STUB = ['--github-stub', 'http://127.0.0.1:8899'];

  it('the database fence and the admin connection follow R16_THROWAWAY_PG_PORT (default 54329), keeping sw_r16_<n> and 127.0.0.1', () => {
    // CORE's default, unchanged
    expect(LAUNCHER_DEFAULT_FENCE.test(GOOD)).toBe(true);
    expect(parseArgs(['--db', GOOD, '--port', '8797', ...STUB], {})).toMatchObject({ pgPort: 54329 });
    expect(adminDatabaseUrl(parseArgs(['--db', GOOD, '--port', '8797', ...STUB], {}).pgPort)).toBe('postgresql://postgres@127.0.0.1:54329/postgres');
    // CORE on its own 54349: nobody touches 54329
    const own = { R16_THROWAWAY_PG_PORT: '54349' };
    const db = 'postgresql://postgres@127.0.0.1:54349/sw_r16_12';
    const args = parseArgs(['--db', db, '--port', '8797', ...STUB], own);
    expect(args).toMatchObject({ db, pgPort: 54349 });
    expect(adminDatabaseUrl(args.pgPort)).toBe('postgresql://postgres@127.0.0.1:54349/postgres');
    for (const bad of [GOOD, 'postgresql://postgres@127.0.0.1:54349/sw2_r16_12', 'postgresql://postgres@127.0.0.1:54349/julius', 'postgresql://postgres@localhost:54349/sw_r16_12', 'postgresql://postgres@10.0.0.2:54349/sw_r16_12', 'postgresql://postgres@127.0.0.1:54349/sw_r16_12;x']) {
      expect(throwawayDatabase(own).test(bad), bad).toBe(false);
      expect(() => parseArgs(['--db', bad, '--port', '8797', ...STUB], own), bad).toThrow(/throwaway/);
    }
    expect(() => parseArgs(['--db', db, '--port', '54349', ...STUB], own)).toThrow(/not the database port/);
    expect(() => parseArgs(['--db', GOOD, '--port', '8797', ...STUB], { R16_THROWAWAY_PG_PORT: '5432' })).toThrow(/5432/);
    // the SAME port rule as the stub fence (and so the migrate helper): every input agrees, accepted or refused
    for (const raw of [undefined, '', '  ', '54329', '54339', ' 54349 ', '5432', '80', '65536', 'abc', '5433x', '1024']) {
      const env = raw === undefined ? {} : { R16_THROWAWAY_PG_PORT: raw };
      const outcome = (fn: () => number) => { try { return fn(); } catch { return 'refused'; } };
      expect(outcome(() => launcherPgPort(env)), JSON.stringify(raw)).toBe(outcome(() => seamPgPort(env)));
    }
  });

  it('childEnv: the two EOS PATHS by exact name from the arguments; no EOS_* value, secret, token or live store from the parent', () => {
    const planted = `planted-${randomBytes(12).toString('hex')}`;
    const parent = {
      PATH: '/bin', EOS_GAME_CLIENT_SECRET: planted, EOS_SERVER_CLIENT_SECRET: planted, EOS_GAME_CLIENT_ID: planted, EOS_PRODUCT_ID: planted, eos_deployment_id: planted,
      WONDERLAND_EOS_VOICE_CONFIG: `/parent/${planted}.env`, WONDERLAND_EOS_ROOM_SALT_FILE: `/parent/${planted}.salt`, WONDERLAND_EOS_ANYTHING: planted,
      JULIUS_LIVE_STORE_URL: planted, JULIUS_TEST_DATABASE_URL: planted, GITHUB_TOKEN: planted, SOME_API_KEY: planted, MY_PASSWORD: planted,
      ANTHROPIC_API_KEY: planted, OPENAI_API_KEY: planted, CLAUDE_CODE_OAUTH_TOKEN: planted, R16_THROWAWAY_PG_PORT: '5432',
    };
    const base = { db: GOOD, port: 8797, clientId: 'Iv1.x', githubStub: null, tap: null, dataDir: '/tmp/r16' };
    const withEos = childEnv(parent, { ...base, pgPort: 54349, eosConfig: '/synthetic/eos.env', roomSaltFile: '/synthetic/salt.txt' });
    expect(withEos.WONDERLAND_EOS_VOICE_CONFIG).toBe('/synthetic/eos.env');
    expect(withEos.WONDERLAND_EOS_ROOM_SALT_FILE).toBe('/synthetic/salt.txt');
    expect(withEos.R16_THROWAWAY_PG_PORT).toBe('54349');
    expect(withEos.PATH).toBe('/bin');
    // without the arguments, the parent's EOS paths do NOT pass through either
    const without = childEnv(parent, base);
    expect(without.WONDERLAND_EOS_VOICE_CONFIG).toBeUndefined();
    expect(without.WONDERLAND_EOS_ROOM_SALT_FILE).toBeUndefined();
    expect(without.R16_THROWAWAY_PG_PORT).toBe('54329');
    for (const env of [withEos, without]) {
      expect(Object.keys(env).filter((k) => /^EOS_/i.test(k) || /^WONDERLAND_EOS_ANYTHING$/.test(k))).toEqual([]);
      for (const [key, value] of Object.entries(env)) expect(value ?? '', key).not.toContain(planted);
    }
  });

  it('the room-salt file: created once (64 hex), never overwritten, refused inside the checkout -- its content never returned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r16-salt-'));
    const repo = join(dir, 'repo');
    const made = ensureRoomSaltFile(join(dir, 'outside', 'salt.txt'), repo);
    expect(made.created).toBe(true);
    const first = readFileSync(made.path, 'utf8');
    expect(first).toMatch(/^[0-9a-f]{64}\n$/);
    expect(ensureRoomSaltFile(made.path, repo)).toEqual({ path: made.path, created: false });
    expect(readFileSync(made.path, 'utf8')).toBe(first);
    // a file already there (someone's own salt) is kept byte for byte
    const kept = join(dir, 'kept.txt');
    writeFileSync(kept, 'keep-me-exactly');
    expect(ensureRoomSaltFile(kept, repo).created).toBe(false);
    expect(readFileSync(kept, 'utf8')).toBe('keep-me-exactly');
    // inside the checkout: refused, nothing written -- including the checkout root itself; a sibling that shares the prefix is outside
    for (const inside of [join(repo, 'salt.txt'), join(repo, 'deep', 'er', 'salt.txt'), repo]) {
      expect(() => ensureRoomSaltFile(inside, repo), inside).toThrow(/outside the repository/);
    }
    expect(existsSync(join(repo, 'salt.txt'))).toBe(false);
    expect(ensureRoomSaltFile(join(`${repo}-sibling`, 'salt.txt'), repo).created).toBe(true);
    // the real default: this launcher's own checkout (refused before anything is written)
    expect(() => ensureRoomSaltFile(join(REPO_ROOT, 'never-written-salt.txt'))).toThrow(/outside the repository/);
    expect(existsSync(join(REPO_ROOT, 'never-written-salt.txt'))).toBe(false);
    expect(JSON.stringify(made)).not.toContain(first.trim());
    rmSync(dir, { recursive: true, force: true });
  });

  it('--eos-config: existence only; a path under .iwonder-secrets is never printed; nothing printed carries a planted secret', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r16-eos-'));
    const planted = `planted-${randomBytes(12).toString('hex')}`;
    const synthetic = join(dir, 'eos.env');
    writeFileSync(synthetic, `EOS_PRODUCT_ID=${planted}\nEOS_SERVER_CLIENT_SECRET=${planted}\n`);
    const printed: string[] = [];
    const spies = [vi.spyOn(console, 'log').mockImplementation((...a) => { printed.push(a.join(' ')); }), vi.spyOn(console, 'error').mockImplementation((...a) => { printed.push(a.join(' ')); })];
    const said: string[] = [];
    const sayOrThrow = (fn: () => string) => { try { said.push(fn()); } catch (error) { said.push(error instanceof Error ? error.message : String(error)); } };
    // an ordinary path: printed, found or missing
    sayOrThrow(() => checkEosConfig(synthetic));
    sayOrThrow(() => checkEosConfig(join(dir, 'missing.env')));
    // a path shaped like the founder's folder: NEVER touched (the existence check is injected) and never printed
    const founderShaped = ['Z:\\nowhere\\.iwonder-secrets\\eos.env', '/nowhere/.iwonder-secrets/eos.env', 'Z:/nowhere/.IWONDER-SECRETS/sub/eos.env'];
    const looked: string[] = [];
    for (const path of founderShaped) {
      sayOrThrow(() => checkEosConfig(path, (p) => { looked.push(p); return true; }));
      sayOrThrow(() => checkEosConfig(path, (p) => { looked.push(p); return false; }));
    }
    // the launcher's own refusals, with the planted value in the environment and the arguments
    const parent = { EOS_GAME_CLIENT_SECRET: planted, R16_THROWAWAY_PG_PORT: planted };
    sayOrThrow(() => String(parseArgs(['--db', GOOD, '--port', '8797', ...STUB], parent)));
    sayOrThrow(() => String(parseArgs(['--db', `postgresql://postgres@127.0.0.1:54329/${planted}`, '--port', '8797', ...STUB], {})));
    for (const s of spies) s.mockRestore();
    expect(said[0]).toBe(`EOS config: ${synthetic}`);
    expect(said[1]).toBe(`the EOS config file is missing: ${join(dir, 'missing.env')}`);
    expect(said.slice(2, 8)).toEqual(founderShaped.flatMap(() => ["EOS config: the founder's file (path not printed)", 'the EOS config file is missing']));
    expect(looked).toEqual(founderShaped.flatMap((p) => [p, p]));
    for (const line of [...said, ...printed]) {
      expect(line).not.toContain(planted);
      expect(line.toLowerCase()).not.toContain('.iwonder-secrets');
    }
    expect(printed).toEqual([]); // the helpers RETURN their one line; only main prints it
    rmSync(dir, { recursive: true, force: true });
  });

  it('--eos-game-config: parsed, passed as WONDERLAND_EOS_GAME_CONFIG by exact name and never inherited; checked like --eos-config, under its own name', () => {
    const planted = `planted-${randomBytes(12).toString('hex')}`;
    const parsed = parseArgs(['--db', GOOD, '--port', '8797', '--github-stub', 'http://127.0.0.1:8899', '--eos-game-config', '/synthetic/eos-game.env'], {});
    expect(parsed.eosGameConfig).toBe('/synthetic/eos-game.env');
    expect(parseArgs(['--db', GOOD, '--port', '8797', '--github-stub', 'http://127.0.0.1:8899'], {}).eosGameConfig).toBeNull();
    const parent = { PATH: '/bin', WONDERLAND_EOS_GAME_CONFIG: `/parent/${planted}.env`, EOS_GAME_CLIENT_SECRET: planted };
    const base = { db: GOOD, port: 8797, clientId: 'Iv1.x', githubStub: null, tap: null, dataDir: '/tmp/r16' };
    expect(childEnv(parent, { ...base, eosGameConfig: '/synthetic/eos-game.env' }).WONDERLAND_EOS_GAME_CONFIG).toBe('/synthetic/eos-game.env');
    const without = childEnv(parent, base);
    expect(without.WONDERLAND_EOS_GAME_CONFIG).toBeUndefined();
    for (const [key, value] of Object.entries(without)) expect(value ?? '', key).not.toContain(planted);
    const founderShaped = '/nowhere/.iwonder-secrets/eos-game.env';
    expect(checkEosConfig(founderShaped, () => true, 'EOS game config')).toBe("EOS game config: the founder's file (path not printed)");
    expect(() => checkEosConfig(founderShaped, () => false, 'EOS game config')).toThrow(/^the EOS game config file is missing$/);
    expect(checkEosConfig('/synthetic/eos-game.env', () => true, 'EOS game config')).toBe('EOS game config: /synthetic/eos-game.env');
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
