import { describe, expect, it } from 'vitest';
import { GITHUB_STUB_ENV, githubRootsForNativeSignIn } from './wonderland-github-stub-seam';

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
});
