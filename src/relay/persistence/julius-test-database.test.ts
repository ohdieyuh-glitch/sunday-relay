import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  JULIUS_REAL_POSTGRES_ENV, JULIUS_TEST_DATABASE_ENV, juliusTestDatabaseAbsence, juliusTestDatabaseNamesLiveStore, juliusTestDatabaseUrl,
} from './julius-test-database';

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

  it('the second guard refuses the live store by its DATABASE NAME, never by its port (#348 CI)', () => {
    // A pure predicate: nothing here is dialled. No credentials in any literal (see above).
    // CI'S OWN THROWAWAY DATABASES PASS, on whatever port CI serves them. julius-real-infra.yml names
    // `${DATABASE_URL%/*}/julius_suites` on the julius-postgres container's 5432 (l.291) and
    // 127.0.0.1:55432/julius_suites (l.481); the old guard refused the first for its port, so on #348 the
    // world-observe suite threw before a single case ran.
    for (const url of [
      'postgres://julius-postgres:5432/julius_suites',
      'postgresql://127.0.0.1:55432/julius_suites',
      'postgres://127.0.0.1:5432/juliusdrillkzf3m9x2',
      'postgres://db.invalid:9/julius_live_copy',
    ]) {
      expect(juliusTestDatabaseNamesLiveStore(url), url).toBe(false);
    }
    // THE LIVE STORE'S NAME IS REFUSED, on any host and any port, however the name is spelled in the URL.
    for (const url of [
      'postgres://db.invalid:9/julius',
      'postgresql://db.invalid:55432/julius?sslmode=disable',
      'postgres://db.invalid:9/%6Aulius',
      'postgres://db.invalid:9/JULIUS',
    ]) {
      expect(juliusTestDatabaseNamesLiveStore(url), url).toBe(true);
    }
    // A GUARD THAT CANNOT TELL SAYS NO: no database name (pg would fall back to the user's name, `julius` on the
    // live store), a scheme pg-connection-string does not read the name from, or a URL that does not parse.
    for (const url of ['postgres://julius@db.invalid:9', 'postgres://db.invalid:9/', 'socket:/var/run/postgresql?db=julius', 'not a url']) {
      expect(juliusTestDatabaseNamesLiveStore(url), url).toBe(true);
    }
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
