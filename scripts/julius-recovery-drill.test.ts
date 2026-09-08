import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import { CAPABILITY } from './julius-recovery-drill';
import { evaluate } from './wonderland-beta-gate.mjs';

/**
 * THE DRILL ITSELF, AGAINST A REAL DATABASE.
 *
 * `julius-drill-support.test.ts` holds what every drill's LEDGER must look
 * like; this is about whether this drill does what it says: two processes, a real lease expiry, a
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
