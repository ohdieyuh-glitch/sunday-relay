/**
 * V6 G-5: THE READER (`scripts/julius-v6-read.mjs`) AGAINST FIXTURES (a)-(i) OF V6_CODE_DESIGN SECTION 7.
 *
 * THE FIXTURES COME FROM THE PRODUCER. `scripts/fixtures/julius-v6-read/<a..i>/` are bundles written by the REAL
 * `.github/julius-live-evidence-dump.sh`, run unmodified against a throwaway PostgreSQL (127.0.0.1:54329) that the real
 * gated drill (gated -> held -> granted -> completed, through the decide CLI's own composition) had just written; the
 * HELD_FOR_APPROVAL lines of each `job-log.txt` come from `liveHeldForApprovalLines` and its APPROVAL_DECIDED line from
 * `decideJuliusApprovalGuarded`. See `fixtures/julius-v6-read/PROVENANCE.txt` for what is produced and what is not:
 *   - (b)-(e), (g), (h) are the clean drill with ONE SQL change each (an INJECTED row, or one changed column);
 *   - (f) is the clean drill with the approvals table made unreadable, so the REAL dump wrote `unavailable`;
 *   - (i) is the drill stopped at the hold (approval PENDING);
 *   - `operator-approval.txt` is SYNTHETIC (the founder workflow G-W is not built, so no producer of that file exists);
 *   - `ci-log.txt` is a LOCAL `vitest --reporter=verbose` run of the named tests, not a CI log.
 * Every case below names the item it pins: a reader mutant that changes a verdict must fail one of them.
 */
import { copyFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { E7_TESTS, E8_TESTS, ITEMS, main, parseTime, parseTsv, readV6, type V6ItemResult } from './julius-v6-read.mjs';

const FIXTURES = join(__dirname, 'fixtures', 'julius-v6-read');
const dir = (name: string): string => join(FIXTURES, name);

const read = (name: string, overrides: Partial<Parameters<typeof readV6>[0]> = {}): Record<string, V6ItemResult> => {
  const base = dir(name);
  const results = readV6({
    bundle: base,
    log: join(base, 'job-log.txt'),
    approvers: join(base, 'approvers.json'),
    workflowLogins: readFileSync(join(base, 'workflow-logins.txt'), 'utf8'),
    contract: join(base, 'contract.json'),
    grant: join(base, 'grant.json'),
    ciLog: join(FIXTURES, 'ci-log.txt'),
    ...overrides,
  });
  return Object.fromEntries(results.map((result) => [result.id, result]));
};
const statuses = (results: Record<string, V6ItemResult>): string[] => ITEMS.map((id) => `${id}=${results[id]!.status}`);

/** A copy of a fixture the case may edit, removed afterwards. */
const scratch = (name: string, edit: (copy: string) => void, run: (copy: string) => void): void => {
  const copy = mkdtempSync(join(tmpdir(), 'v6read-'));
  try { cpSync(dir(name), copy, { recursive: true }); edit(copy); run(copy); } finally { rmSync(copy, { recursive: true, force: true }); }
};

describe('V6 reader: the fixtures (a)-(i) of the design, built from the producer', () => {
  it('the fixture set is exactly a..i, each with the files the reader reads', () => {
    expect(readdirSync(FIXTURES).filter((entry) => /^[a-i]$/u.test(entry)).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    for (const name of 'abcdefghi') {
      for (const file of ['approvals.tsv', 'transitions.tsv', 'lifecycle-events.tsv', 'trajectory.tsv', 'budget.tsv', 'bundle-manifest.txt', 'job-log.txt']) {
        expect(readdirSync(dir(name)), `${name} carries ${file}`).toContain(file);
      }
    }
  });

  it('(a) granted, clean: E1-E9 are all MET, and each cites the rows it relied on', () => {
    const r = read('a');
    expect(statuses(r)).toEqual(ITEMS.map((id) => `${id}=MET`));
    expect(r.E5!.rows.join(' ')).toContain('approvals.tsv');
    expect(r.E6!.rows.some((row) => row.startsWith('trajectory.tsv'))).toBe(true);
    expect(r.E2!.rows.some((row) => row.startsWith('log:'))).toBe(true);
  });

  it('(b) a julius.budget.reserved inside the hold window: E3 and E4 are NOT MET, citing the reservation row', () => {
    const r = read('b');
    expect(r.E3!.status).toBe('NOT MET');
    expect(r.E4!.status).toBe('NOT MET');
    expect(r.E3!.rows.some((row) => row.startsWith('budget.tsv'))).toBe(true);
    expect(r.E6!.status).toBe('MET');
  });

  it('(c) two DISPATCH rows for the build after the grant: E6 is NOT MET', () => {
    const r = read('c');
    expect(r.E6!.status).toBe('NOT MET');
    expect(r.E6!.because.join(' ')).toMatch(/2 provider-class DISPATCH/u);
    expect(r.E3!.status).toBe('MET');
  });

  it('(d) a DISPATCH before decided_at: E4, E6 and E7 are NOT MET', () => {
    const r = read('d');
    expect(r.E4!.status).toBe('NOT MET');
    expect(r.E6!.status).toBe('NOT MET');
    expect(r.E7!.status).toBe('NOT MET');
  });

  it('(e) decided_by not allowlisted: E5 is NOT MET (committed file and workflow literal both name it absent)', () => {
    const r = read('e');
    expect(r.E5!.status).toBe('NOT MET');
    expect(r.E5!.because.join(' ')).toContain('not in the committed');
    expect(r.E5!.because.join(' ')).toContain('not in the founder workflow');
  });

  it('(f) approvals.tsv reads `unavailable`: every item that reads it is UNKNOWN, never MET and never NOT MET', () => {
    expect(readFileSync(join(dir('f'), 'approvals.tsv'), 'utf8').trim()).toBe('unavailable');
    const r = read('f');
    for (const id of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E9']) {
      expect(r[id]!.status, `${id} cannot be read`).toBe('UNKNOWN');
      expect(r[id]!.because.join(' ')).toContain('approvals.tsv is unavailable');
    }
    expect(r.E8!.status, 'E8 reads the CI log only').toBe('MET');
  });

  it('(g) a RETRY of the gated task: E6 is UNKNOWN (never MET by default)', () => {
    const r = read('g');
    expect(r.E6!.status).toBe('UNKNOWN');
    expect(r.E6!.because.join(' ')).toContain('RETRY');
  });

  it('(h) the build\'s contract re-locked after decided_at: E6 is UNKNOWN', () => {
    const r = read('h');
    expect(r.E6!.status).toBe('UNKNOWN');
    expect(r.E6!.because.join(' ')).toContain('re-lock');
  });

  it('(i) a held-only log (no RESULT): E9 is NOT MET, and E2 still reads the hold', () => {
    const r = read('i');
    expect(r.E9!.status).toBe('NOT MET');
    expect(r.E9!.because.join(' ')).toContain('ended held');
    expect(readFileSync(join(dir('i'), 'job-log.txt'), 'utf8')).not.toMatch(/^RESULT:/mu);
    expect(r.E2!.because.join(' ')).toContain('one HELD_FOR_APPROVAL line');
  });
});

describe('V6 reader: the rules that are not a fixture', () => {
  it('NOT MET outranks UNKNOWN: a known failure decides the item whatever else is unread', () => {
    scratch('d', (copy) => rmSync(join(copy, 'budget.tsv')), (copy) => {
      const r = read('d', { bundle: copy });
      expect(r.E4!.status).toBe('NOT MET');
      expect(r.E4!.because.join(' ')).toContain('UNKNOWN: budget.tsv is missing');
    });
  });

  it('a missing input is UNKNOWN: no approvers file, no workflow literal, no operator comment, no CI log', () => {
    expect(read('a', { approvers: undefined }).E5!.status).toBe('UNKNOWN');
    expect(read('a', { workflowLogins: undefined }).E5!.status).toBe('UNKNOWN');
    scratch('a', (copy) => rmSync(join(copy, 'operator-approval.txt')), (copy) => expect(read('a', { bundle: copy }).E5!.status).toBe('UNKNOWN'));
    const noCi = read('a', { ciLog: undefined });
    expect(noCi.E7!.status).toBe('UNKNOWN');
    expect(noCi.E8!.status).toBe('UNKNOWN');
    expect(read('a', { log: undefined }).E9!.status).toBe('UNKNOWN');
    expect(read('a', { contract: undefined }).E1!.status).toBe('UNKNOWN');
  });

  it('a truncated TSV (footer disagrees with the rows) is unreadable, so UNKNOWN', () => {
    scratch('a', (copy) => {
      const text = readFileSync(join(copy, 'transitions.tsv'), 'utf8').split('\n');
      writeFileSync(join(copy, 'transitions.tsv'), `${text.slice(0, 3).join('\n')}\n${text.at(-2)}\n`);
    }, (copy) => {
      expect(read('a', { bundle: copy }).E5!.status).toBe('UNKNOWN');
      expect(parseTsv('a\tb\n1\t2\n(2 rows)\n')).toMatchObject({ state: 'unreadable' });
      expect(parseTsv('unavailable\n')).toEqual({ state: 'unavailable' });
      expect(parseTsv(null)).toEqual({ state: 'missing' });
    });
  });

  it('E2: a RESULT line in LIVE-1 is NOT MET (a held run has none)', () => {
    scratch('a', (copy) => {
      const lines = readFileSync(join(copy, 'job-log.txt'), 'utf8').split('\n');
      lines.splice(lines.indexOf('julius_exit=3'), 0, 'RESULT: BLOCKED (stalled before terminal state) after 4 ticks');
      writeFileSync(join(copy, 'job-log.txt'), lines.join('\n'));
    }, (copy) => {
      const r = read('a', { bundle: copy, log: join(copy, 'job-log.txt') });
      expect(r.E2!.status).toBe('NOT MET');
      expect(r.E2!.because.join(' ')).toContain('LIVE-1 printed a RESULT');
    });
  });

  it('E9: two RESULT lines for one run are NOT MET (the gate reads them as no answer)', () => {
    scratch('a', (copy) => {
      const text = readFileSync(join(copy, 'job-log.txt'), 'utf8').replace('julius_exit=0', 'RESULT: COMPLETED after 2 ticks\n  run: ' + readFileSync(join(copy, 'bundle-manifest.txt'), 'utf8').match(/julius_run_id=(\S+)/u)![1] + '\njulius_exit=0');
      writeFileSync(join(copy, 'job-log.txt'), text);
    }, (copy) => {
      const r = read('a', { bundle: copy, log: join(copy, 'job-log.txt') });
      expect(r.E9!.status).toBe('NOT MET');
      expect(r.E9!.because.join(' ')).toContain('2 RESULT');
    });
  });

  it('E9: a third invocation (a third julius_exit=) is NOT MET', () => {
    scratch('a', (copy) => writeFileSync(join(copy, 'job-log.txt'), `${readFileSync(join(copy, 'job-log.txt'), 'utf8')}julius_exit=0\n`), (copy) => {
      const r = read('a', { bundle: copy, log: join(copy, 'job-log.txt') });
      expect(r.E9!.status).toBe('NOT MET');
      expect(r.E9!.because.join(' ')).toContain('[3, 0, 0]');
    });
  });

  it('E1: a clause that differs from the committed grant is NOT MET, and a grant with no entry is NOT MET', () => {
    scratch('a', (copy) => {
      const grant = JSON.parse(readFileSync(join(copy, 'grant.json'), 'utf8')) as Record<string, Array<Record<string, unknown>>>;
      for (const gates of Object.values(grant)) gates[0]!.reason = 'a different reason';
      writeFileSync(join(copy, 'grant.json'), JSON.stringify(grant));
    }, (copy) => expect(read('a', { bundle: copy, grant: join(copy, 'grant.json') }).E1!.status).toBe('NOT MET'));
    scratch('a', (copy) => writeFileSync(join(copy, 'grant.json'), '{}'), (copy) => expect(read('a', { bundle: copy, grant: join(copy, 'grant.json') }).E1!.status).toBe('NOT MET'));
  });

  it('E7/E8: a CI log that lacks a named test is UNKNOWN, and one that shows it failing is NOT MET', () => {
    scratch('a', (copy) => {
      const lines = readFileSync(join(FIXTURES, 'ci-log.txt'), 'utf8').split('\n').filter((line) => !E8_TESTS.some((name) => line.includes(name)));
      writeFileSync(join(copy, 'ci-only-e7.txt'), lines.join('\n'));
      writeFileSync(join(copy, 'ci-failing.txt'), readFileSync(join(FIXTURES, 'ci-log.txt'), 'utf8').split('\n')
        .map((line) => (line.includes(E7_TESTS[1]!) ? line.replace(/^(\s*)\S+/u, '$1×') : line)).join('\n'));
    }, (copy) => {
      const onlyE7 = read('a', { bundle: copy, ciLog: join(copy, 'ci-only-e7.txt') });
      expect(onlyE7.E7!.status).toBe('MET');
      expect(onlyE7.E8!.status).toBe('UNKNOWN');
      expect(read('a', { bundle: copy, ciLog: join(copy, 'ci-failing.txt') }).E7!.status).toBe('NOT MET');
    });
  });

  it('timestamps compare as written by psql: offsets, fractions and ISO Z', () => {
    expect(parseTime('2026-10-15 09:28:49.711-07')).toBe(parseTime('2026-10-15T16:28:49.711Z'));
    expect(parseTime('2026-10-15 09:28:49.711-07')! > parseTime('2026-10-15 09:28:49.689-07')!).toBe(true);
    expect(parseTime('2026-10-15 09:28:49.689123-07')! > parseTime('2026-10-15 09:28:49.689-07')!).toBe(true);
    expect(parseTime('not a time')).toBeNull();
  });

  it('the command line: zero network, exit 0 only when everything is MET, 1 otherwise, 2 for usage', () => {
    const lines: string[] = [];
    const base = dir('a');
    const args = ['--bundle', base, '--log', join(base, 'job-log.txt'), '--approvers', join(base, 'approvers.json'), '--workflow-logins', 'founder#1001',
      '--contract', join(base, 'contract.json'), '--grant', join(base, 'grant.json'), '--ci-log', join(FIXTURES, 'ci-log.txt')];
    expect(main(args, (text) => lines.push(text))).toBe(0);
    expect(lines.join('')).toContain('E9: MET');
    expect(lines.join('')).toContain('NOT JUDGED HERE');
    expect(main(['--bundle', dir('c'), ...args.slice(2)], () => undefined)).toBe(1);
    expect(main([], () => undefined)).toBe(2);
    expect(main(['--bundle'], () => undefined)).toBe(2);
    const source = readFileSync(join(__dirname, 'julius-v6-read.mjs'), 'utf8');
    expect(source, 'a pure file reader: no network, no process spawn').not.toMatch(/node:(?:http|https|net|child_process|dns|tls|dgram)|\bfetch\(|XMLHttpRequest|WebSocket/u);
    void copyFileSync;
  });
});
