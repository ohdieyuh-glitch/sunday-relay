/* Round 4 R3-3: the verifier child's environment is a key allowlist; NODE_OPTIONS and GIT_* never pass. */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordGitDiff, spawnVerifierRunner } from './e2-evidence-gate';
import { makeRepo } from './e2-test-kit';

let dir = '';
beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'e2-env-r9-')));
  writeFileSync(join(dir, 'preload.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(join(dir, 'PRELOADED'))}, 'x');`);
  writeFileSync(join(dir, 'keys.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify(process.env));`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const hostile = (): Record<string, string> => ({
  NODE_OPTIONS: `--require ${join(dir, 'preload.cjs')}`, GIT_DIR: '/nonexistent', GIT_EXTERNAL_DIFF: '/bin/false',
  HOME: '/tmp/x', LD_PRELOAD: '/x.so', npm_config_prefix: '/', CI: '1', TZ: 'UTC', NODE_ENV: 'test', LANG: 'C', PATH: '/evil',
});

describe('R3-3 env allowlist', () => {
  for (const route of ['options.env', 'extraEnv'] as const) {
    it(`NODE_OPTIONS=--require does not run and only allowlisted keys pass (${route})`, async () => {
      rmSync(join(dir, 'PRELOADED'), { force: true });
      const out = join(dir, `env-${route}.json`);
      const runner = spawnVerifierRunner(route === 'options.env' ? { env: hostile() } : {});
      const r = await runner(['node', 'keys.mjs', out], dir, route === 'extraEnv' ? hostile() : undefined);
      expect(r.exitCode).toBe(0);
      expect(existsSync(join(dir, 'PRELOADED'))).toBe(false);
      const env = JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>;
      expect(Object.keys(env).filter((k) => !['PATH', 'LANG', 'LC_ALL', 'NODE_OPTIONS', 'CI', 'TZ', 'NODE_ENV', 'LC_CTYPE', '__CF_USER_TEXT_ENCODING'].includes(k))).toEqual([]);
      expect(env.CI).toBe('1'); expect(env.TZ).toBe('UTC'); expect(env.NODE_ENV).toBe('test');
      expect(env.PATH).not.toBe('/evil');
      /* Round 9 N8-1: NODE_OPTIONS is the runner's own fixed value, never the caller's. */
      expect(env.NODE_OPTIONS).toBe('--disallow-code-generation-from-strings');
    });
  }
  it('GIT_DIR in the runner env cannot redirect the module git diff', async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'e2-env-r9-git-')));
    try {
      const { base, head } = makeRepo(repo, { 'a.txt': 'a\n' }, { 'a.txt': 'b\n' }, (p, c) => writeFileSync(p, c));
      const d = await recordGitDiff({ base, head, cwd: repo, runner: spawnVerifierRunner({ env: hostile() }) });
      expect(d?.exitCode).toBe(0);
      expect(d?.bytes).toBeGreaterThan(0);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});
