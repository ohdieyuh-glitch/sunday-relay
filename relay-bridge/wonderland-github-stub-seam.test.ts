import { describe, expect, it } from 'vitest';
import { GITHUB_STUB_ENV, THROWAWAY_PG_PORT_ENV, githubRootsForNativeSignIn, isThrowawayDatabaseUrl, throwawayPgPort } from './wonderland-github-stub-seam';
import { openDevPostgresStore } from './dev-social-server';

/*
 * THE DEVELOPMENT GITHUB STUB IS FENCED. Without the variable the sign-in always asks the real GitHub; with it, the bridge
 * refuses to start unless the stub is loopback, the process is not production, and the database is the throwaway one.
 */

const THROWAWAY = 'postgresql://postgres@127.0.0.1:54329/sw_r16_1';

describe('the GitHub roots for the desktop sign-in', () => {
  it('are the real GitHub when the stub variable is absent or empty, whatever else is set', () => {
    for (const env of [{}, { [GITHUB_STUB_ENV]: '' }, { [GITHUB_STUB_ENV]: '  ', NODE_ENV: 'production' }, { JULIUS_DATABASE_URL: THROWAWAY }]) {
      expect(githubRootsForNativeSignIn(env as NodeJS.ProcessEnv)).toEqual({ oauthRoot: 'https://github.com', apiRoot: 'https://api.github.com', stub: false });
    }
  });

  it('are the loopback stub only with a loopback URL, outside production, on the throwaway database', () => {
    const roots = githubRootsForNativeSignIn({ [GITHUB_STUB_ENV]: 'http://127.0.0.1:8899', JULIUS_DATABASE_URL: THROWAWAY } as NodeJS.ProcessEnv);
    expect(roots).toEqual({ oauthRoot: 'http://127.0.0.1:8899', apiRoot: 'http://127.0.0.1:8899', stub: true });
  });

  it('refuses to start under NODE_ENV=production', () => {
    expect(() => githubRootsForNativeSignIn({ [GITHUB_STUB_ENV]: 'http://127.0.0.1:8899', JULIUS_DATABASE_URL: THROWAWAY, NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/production/);
  });

  it('refuses a stub that is not loopback http', () => {
    for (const url of ['https://127.0.0.1:8899', 'http://localhost:8899', 'http://10.0.0.5:8899', 'http://127.0.0.1:8899/github', 'http://127.0.0.1.evil.example:8899', 'http://127.0.0.1:80', 'https://github.com']) {
      expect(() => githubRootsForNativeSignIn({ [GITHUB_STUB_ENV]: url, JULIUS_DATABASE_URL: THROWAWAY } as NodeJS.ProcessEnv), url).toThrow(/loopback/);
    }
  });

  it('refuses any database but the throwaway one on 127.0.0.1:54329, including none and the live default', () => {
    for (const db of [undefined, 'postgresql://postgres@127.0.0.1:5432/julius', 'postgresql://postgres@db.example:54329/x', 'postgresql://postgres@127.0.0.1:54329/a;drop']) {
      const env: NodeJS.ProcessEnv = { [GITHUB_STUB_ENV]: 'http://127.0.0.1:8899' };
      if (db !== undefined) env.JULIUS_DATABASE_URL = db;
      expect(() => githubRootsForNativeSignIn(env), String(db)).toThrow(/throwaway/);
    }
    expect(() => githubRootsForNativeSignIn({ [GITHUB_STUB_ENV]: 'http://127.0.0.1:8899', DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/julius' } as NodeJS.ProcessEnv)).toThrow(/throwaway/);
  });

  it('takes the throwaway port from R16_THROWAWAY_PG_PORT (default 54329), never 5432, and never a database named julius', () => {
    const stub = { [GITHUB_STUB_ENV]: 'http://127.0.0.1:8899' };
    // another loopback port, named: accepted -- and then the default port is not
    expect(githubRootsForNativeSignIn({ ...stub, [THROWAWAY_PG_PORT_ENV]: '54339', JULIUS_DATABASE_URL: 'postgresql://postgres@127.0.0.1:54339/sw2_r16_1' } as NodeJS.ProcessEnv).stub).toBe(true);
    expect(() => githubRootsForNativeSignIn({ ...stub, [THROWAWAY_PG_PORT_ENV]: '54339', JULIUS_DATABASE_URL: THROWAWAY } as NodeJS.ProcessEnv)).toThrow(/127\.0\.0\.1:54339/);
    // unset or empty: 54329, exactly as before
    expect(throwawayPgPort({})).toBe(54329);
    expect(throwawayPgPort({ [THROWAWAY_PG_PORT_ENV]: ' ' } as NodeJS.ProcessEnv)).toBe(54329);
    // the live store's port, a privileged port, or anything that is not a plain port: refused
    for (const bad of ['5432', '80', '99999', '54339; drop', 'x']) {
      expect(() => githubRootsForNativeSignIn({ ...stub, [THROWAWAY_PG_PORT_ENV]: bad, JULIUS_DATABASE_URL: `postgresql://postgres@127.0.0.1:${bad}/sw_r16_1` } as NodeJS.ProcessEnv), bad).toThrow(/5432/);
    }
    expect(() => githubRootsForNativeSignIn({ ...stub, JULIUS_DATABASE_URL: 'postgresql://postgres@127.0.0.1:54329/julius' } as NodeJS.ProcessEnv)).toThrow(/throwaway/);
  });
});

describe("one throwaway-database rule for every tool that migrates by itself (Second, 10-06: the dev server's --pg took the LIVE store)", () => {
  const LIVE = 'postgresql://postgres@127.0.0.1:5432/julius';
  it('the live store is never a throwaway: port 5432, the julius database, another host, another port, a path or a query -- all refused', () => {
    const env = {} as NodeJS.ProcessEnv;   // the default throwaway port, 54329
    expect(isThrowawayDatabaseUrl('postgresql://postgres@127.0.0.1:54329/sw_social_1', env)).toBe(true);   // the control: a throwaway passes
    for (const bad of [
      LIVE,
      'postgresql://postgres@127.0.0.1:5432/sw_social_1',
      'postgresql://postgres@127.0.0.1:54329/julius',
      'postgresql://postgres@localhost:54329/sw_social_1',
      'postgresql://postgres@10.0.0.5:54329/sw_social_1',
      'postgresql://postgres@127.0.0.1:54339/sw_social_1',
      'postgresql://postgres@127.0.0.1:54329/sw_social_1?host=10.0.0.5',
      'postgresql://postgres@127.0.0.1:54329/sw/../julius',
    ]) expect(isThrowawayDatabaseUrl(bad, env), bad).toBe(false);
    // the port is the configured one: 54339 when R16_THROWAWAY_PG_PORT says so, and then 54329 is not
    const second = { [THROWAWAY_PG_PORT_ENV]: '54339' } as NodeJS.ProcessEnv;
    expect(isThrowawayDatabaseUrl('postgresql://postgres@127.0.0.1:54339/sw2_r16_1', second)).toBe(true);
    expect(isThrowawayDatabaseUrl('postgresql://postgres@127.0.0.1:54329/sw2_r16_1', second)).toBe(false);
    expect(() => isThrowawayDatabaseUrl('postgresql://postgres@127.0.0.1:5432/x', { [THROWAWAY_PG_PORT_ENV]: '5432' } as NodeJS.ProcessEnv)).toThrow(/5432/);
  });

  it('the dev social server refuses a non-throwaway database BEFORE connecting (it migrates what it opens)', async () => {
    // PORT 9, NEVER THE LIVE URL, HERE: this call would CONNECT and MIGRATE if the guard ever regressed (or under the guard's own RED
    // control), and the live store listens on 127.0.0.1:5432 on the machines that run this. On port 9 nothing listens: a broken guard
    // fails this test with a connection error instead of touching anything. The live URL is refused above, by the pure predicate.
    await expect(openDevPostgresStore('postgresql://postgres@127.0.0.1:9/julius', {} as NodeJS.ProcessEnv)).rejects.toThrow(/THROWAWAY/);
    await expect(openDevPostgresStore('postgresql://postgres@127.0.0.1:9/sw_social_1', {} as NodeJS.ProcessEnv)).rejects.toThrow(/THROWAWAY/);
  });

  it("the live store's own URLs are refused before ANY pool exists: a FAKE pool factory records the attempt and can connect to nothing", async () => {
    // MAIN's request (10-06): a regressed PORT check must fail a test too. The live URLs go in literally here because the pool is a
    // stand-in -- were the guard to regress, the factory is called (attempt recorded, the test fails) and nothing is ever connected.
    const attempts: string[] = [];
    const fakePool = (connectionString: string) => {
      attempts.push(connectionString);
      const refuse = async () => { throw new Error('fake pool: no connection is ever made'); };
      return { query: refuse, connect: refuse, end: async () => undefined } as never;
    };
    for (const url of [LIVE, 'postgresql://postgres@127.0.0.1:5432/anything', 'postgresql://postgres@127.0.0.1:5432/sw_social_1']) {
      await expect(openDevPostgresStore(url, {} as NodeJS.ProcessEnv, fakePool), url).rejects.toThrow(/THROWAWAY/);
    }
    expect(attempts).toEqual([]);
    // the control: a throwaway URL DOES reach the factory (so an empty `attempts` above is the guard's doing, not a dead factory)
    await expect(openDevPostgresStore('postgresql://postgres@127.0.0.1:54329/sw_social_1', {} as NodeJS.ProcessEnv, fakePool)).rejects.toThrow(/fake pool/);
    expect(attempts).toEqual(['postgresql://postgres@127.0.0.1:54329/sw_social_1']);
  });
});
