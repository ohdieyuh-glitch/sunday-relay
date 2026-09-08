import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import { CAPABILITY_PROOF_COLUMNS } from './julius-drill-support';
import { CAPABILITY, DRILL_COMMAND, EXERCISED, TRANSCRIPT_FILE } from './julius-recovery-drill';
import { CAPABILITY_PROOF_COLUMNS as GATE_COLUMNS, evaluate } from './wonderland-beta-gate.mjs';

/**
 * THE DRILL AND THE GATE, HELD TO ONE DOCUMENT.
 *
 * The drill writes a ledger and the gate reads it. Two writers of one shape
 * drift the first time a column is added and only one of them learns about it,
 * and that exact failure has already cost this project two free dry runs:
 * `evidence.tsv` and `findings.tsv` arrived reading `unavailable` because a
 * query named a column the migrations never created, and nothing compared the
 * two until a paid run had been spent.
 *
 * The drill cannot simply import the gate — bundling the gate's module-scope
 * `import.meta.url` and its run-as-a-program guard into the drill's bundle
 * makes both resolve to that bundle, and the gate would run in place of the
 * drill. So the lists are separate and this test is what makes them one.
 */
describe('the Julius restart/recovery drill', () => {
  it('writes the exact columns the Beta Gate reads, in order', () => {
    expect([...CAPABILITY_PROOF_COLUMNS]).toEqual([...GATE_COLUMNS]);
  });

  /**
   * AND IT CLAIMS A CAPABILITY THE GATE ACTUALLY HAS, whose every
   * implementation file it says it drives. A drill naming a row that does not
   * exist, or covering two of three files, files an attestation the gate will
   * refuse — silently, from the drill's point of view, which is the worst way
   * to find out.
   */
  it('claims a real Beta Gate capability and covers every file that row is built on', () => {
    const row = evaluate(null).results.find((value) => value.id === CAPABILITY);
    expect(row, `${CAPABILITY} must be a capability the gate declares`).toBeDefined();
    expect(row!.missionRequired, 'a drill is inadmissible on a mission-required row').toBe(false);
    expect([...EXERCISED].sort()).toEqual([...row!.implementedBy].sort());
  });

  it('names itself with a command that exists', () => {
    const scripts = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(DRILL_COMMAND).toBe('npm run julius:recovery-drill');
    expect(scripts['julius:recovery-drill'], 'the attestation names the command an operator can rerun').toBeDefined();
    expect(TRANSCRIPT_FILE).toMatch(/^[A-Za-z0-9._-]+$/u);
  });
});

/**
 * THE DRILL ITSELF, AGAINST A REAL DATABASE.
 *
 * Everything above is about the shape of what the drill writes. This is about
 * whether the drill does what it says: two processes, a real lease expiry, a
 * production sweep, and an attestation the gate then accepts. It needs a
 * PostgreSQL, so it is env-gated the same way the live-chain proof is —
 * `JULIUS_REAL_POSTGRES=1` with `DATABASE_URL` — and written as a guarded
 * block rather than an early return, which is how a test comes to assert
 * nothing and still pass.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1')
  && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const runProcess = promisify(execFile);

suite('the Julius restart/recovery drill, run for real', () => {
  it('crashes a process holding a lease, recovers the run in a fresh one, and the gate believes it', async () => {
    const out = mkdtempSync(join(tmpdir(), 'julius-recovery-drill-'));
    const database = `juliusdrill${Date.now().toString(36)}`;
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await admin.query(`CREATE DATABASE ${database}`);
    } finally {
      await admin.end();
    }
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${database}`;

    // THROUGH THE NPM SCRIPT AN OPERATOR RUNS, which builds the bundle first.
    // Reaching into the bundle directory instead would make this test depend
    // on some earlier CI step having produced the artifact — exactly what
    // `ci-test-accounting` exists to catch — and would let it run against a
    // stale binary, which has cost this project a founder-facing failure once
    // already (`reviewer pair-browser`, three hours stale).
    const { stdout } = await runProcess('npm', ['run', 'julius:recovery-drill', '--silent', '--', '--out', out],
      { encoding: 'utf8', timeout: 300_000, env: { ...process.env, DATABASE_URL: url.toString() } });

    expect(stdout, 'the drill must reach its own verdict line').toContain('JULIUS RESTART RECOVERY VERIFIED');
    expect(stdout, 'and the production sweep must be what moved it').toContain('REQUEUE/LEASE_EXPIRED');
    expect(stdout).not.toContain('[FAIL]');

    // THE JOIN NOBODY OTHERWISE TESTS: the gate reading the drill's own file.
    const row = evaluate(null, { capabilityDir: out }).results.find((value) => value.id === CAPABILITY)!;
    expect(row.capability, row.capabilityBasis).toBe('PROVEN');
    expect(row.verdict).toBe('CAPABILITY PROVEN');
    expect(row.basis).toContain('real-postgres,two-processes,real-lease-expiry,no-provider-call');

    /**
     * AND THE FAILING DIRECTION, ON THE SAME DATABASE. Everything above is the
     * happy one: the drill passed, so a drill that had stopped checking would
     * look identical. Run it again on a database that already holds its run and
     * it must refuse — a drill that reads the previous run's sweep and reports
     * PASS about it is not testimony — and the ledger it then files must be one
     * the gate rejects, on the outcome column AND on the transcript.
     */
    const again = mkdtempSync(join(tmpdir(), 'julius-recovery-drill-again-'));
    const second = await runProcess('npm', ['run', 'julius:recovery-drill', '--silent', '--', '--out', again],
      { encoding: 'utf8', timeout: 300_000, env: { ...process.env, DATABASE_URL: url.toString() } })
      .then(() => ({ code: 0 }), (error: { code?: number }) => ({ code: error.code ?? 1 }));
    expect(second.code, 'a dirty database is a drill failure, not a quiet pass').toBe(8);
    const ledger = readFileSync(join(again, 'capability-proofs.tsv'), 'utf8');
    expect(ledger, 'and it files what actually happened').toContain('FAILED');
    const refused = evaluate(null, { capabilityDir: again }).results.find((value) => value.id === CAPABILITY)!;
    expect(refused.capability).toBe('UNPROVEN');
    expect(refused.capabilityBasis).toContain('the drill recorded FAILED, not VERIFIED');
  }, 300_000);
});
