import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { JULIUS_REAL_POSTGRES_ENV, JULIUS_TEST_DATABASE_ENV, juliusTestDatabaseAbsence, juliusTestDatabaseUrl } from './julius-test-database';

/**
 * THE RULE THAT KEEPS TEST WRITES OUT OF THE LIVE STORE, held to by a sweep.
 *
 * On the founder's workstation every shell inherits a `DATABASE_URL` pointing at
 * the PERSISTENT Julius database. A real-PostgreSQL suite migrates and writes,
 * so a suite that read that variable would write test runs into real mission
 * history — and nothing in the URL distinguishes it from the ephemeral database
 * CI provisions: same name, same host, same port, same credentials. The only
 * honest rule is that the LAUNCHER states which database a test may have, so
 * this sweep is what stops the old habit coming back one file at a time.
 */

const ROOT = resolve(import.meta.dirname, '../../..');

describe('the test database is stated, never inherited', () => {
  it('reads only its own variable, and treats blank as absent', () => {
    expect(JULIUS_TEST_DATABASE_ENV).toBe('JULIUS_TEST_DATABASE_URL');
    expect(juliusTestDatabaseUrl({})).toBeNull();
    expect(juliusTestDatabaseUrl({ JULIUS_TEST_DATABASE_URL: '   ' })).toBeNull();
    expect(juliusTestDatabaseUrl({ JULIUS_TEST_DATABASE_URL: ' postgres://x/y ' })).toBe('postgres://x/y');
    // THE VARIABLE THAT MUST NOT WORK: an inherited runtime URL, alone, buys
    // nothing.
    // No inline credentials even in a fixture: the repository boundary scan reads
    // this file too, and a URL shaped like a real one is the shape it forbids.
    expect(juliusTestDatabaseUrl({ DATABASE_URL: 'postgres://127.0.0.1:5432/julius' })).toBeNull();
    expect(juliusTestDatabaseAbsence()).toContain('THROWAWAY');
  });

  it('a launcher that DEMANDS the real suites without a test database fails loudly, never reads green', () => {
    // julius-real-infra set JULIUS_REAL_POSTGRES=1 and no test database from #288
    // on, and every real-PostgreSQL step went green on all-todo suites (run
    // 36587881843: 0 of 28 cases executed). The demand with nothing to run on is
    // a launcher error, and it still never falls back to the inherited URL.
    expect(JULIUS_REAL_POSTGRES_ENV).toBe('JULIUS_REAL_POSTGRES');
    expect(() => juliusTestDatabaseUrl({ JULIUS_REAL_POSTGRES: '1' })).toThrow(/julius_real_postgres_without_test_database/u);
    expect(() => juliusTestDatabaseUrl({ DATABASE_URL: 'postgres://127.0.0.1:5432/julius', JULIUS_REAL_POSTGRES: '1' }))
      .toThrow(/JULIUS_TEST_DATABASE_URL is not set/u);
    expect(() => juliusTestDatabaseUrl({ JULIUS_REAL_POSTGRES: '1', JULIUS_TEST_DATABASE_URL: '  ' })).toThrow();
    expect(juliusTestDatabaseUrl({ JULIUS_REAL_POSTGRES: '1', JULIUS_TEST_DATABASE_URL: 'postgres://x/y' })).toBe('postgres://x/y');
    // Anything but the literal demand leaves the old answer: a todo, not an error.
    expect(juliusTestDatabaseUrl({ JULIUS_REAL_POSTGRES: '0' })).toBeNull();
  });

  it('NO test file in this repository reads DATABASE_URL', () => {
    // `git ls-files` rather than a directory walk: the rule is about what is
    // committed, and a walk would also sweep build output and node_modules.
    const tracked = execFileSync('git', ['ls-files', '*.test.ts', '*.test.mts', '*.test.mjs'], { cwd: ROOT, encoding: 'utf8' })
      .split(/\r?\n/u).filter((line) => line.trim() !== '');
    expect(tracked.length, 'the sweep must actually find the test files').toBeGreaterThan(50);
    const offenders = tracked.filter((file) => {
      // This file names the variable in order to forbid it.
      if (file.endsWith('julius-test-database.test.ts')) return false;
      return /process\.env\.DATABASE_URL|process\.env\[['"`]DATABASE_URL/u.test(readFileSync(resolve(ROOT, file), 'utf8'));
    });
    expect(offenders, 'a test that reads DATABASE_URL can write into the live Julius store').toEqual([]);
  });
});
