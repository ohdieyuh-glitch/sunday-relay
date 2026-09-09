import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import { CAPABILITY_PROOF_COLUMNS, DrillRecord, writeAttestation } from './julius-drill-support';
import * as recovery from './julius-recovery-drill';
import * as failure from './julius-failure-recovery-drill';
import * as repair from './julius-repair-loop-drill';
import { CAPABILITY_PROOF_COLUMNS as GATE_COLUMNS, evaluate } from './wonderland-beta-gate.mjs';

/**
 * EVERY DRILL, HELD TO THE GATE'S DOCUMENT.
 *
 * A drill writes a ledger and the gate reads it. Two writers of one shape drift
 * the first time a column is added and only one of them learns about it, and
 * that exact failure has already cost this project two free dry runs:
 * `evidence.tsv` and `findings.tsv` arrived reading `unavailable` because a
 * query named a column the migrations never created, and nothing compared the
 * two until a paid run had been spent.
 *
 * A drill cannot simply import the gate — bundling the gate's module-scope
 * `import.meta.url` and its run-as-a-program guard into a drill's bundle makes
 * both resolve to that bundle, and the gate would run in place of the drill. So
 * the lists are separate and this is what makes them one.
 */
const DRILLS = [
  { name: 'restart/recovery', module: recovery, script: 'julius:recovery-drill' },
  { name: 'failure recovery', module: failure, script: 'julius:failure-recovery-drill' },
  { name: 'repair loop', module: repair, script: 'julius:repair-loop-drill' },
] as const;

const scripts = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).scripts as Record<string, string>;

describe('every Julius capability drill', () => {
  it('writes the exact columns the Beta Gate reads, in order', () => {
    expect([...CAPABILITY_PROOF_COLUMNS]).toEqual([...GATE_COLUMNS]);
  });

  for (const drill of DRILLS) {
    /**
     * A DRILL MUST CLAIM A ROW THE GATE HAS, and cover every file that row is
     * built on. A drill naming a capability that does not exist, or covering
     * two of three implementation files, files an attestation the gate refuses
     * — silently, from the drill's point of view, which is the worst way to
     * find out.
     */
    it(`the ${drill.name} drill claims a real gate capability and covers every file that row is built on`, () => {
      const row = evaluate(null).results.find((value) => value.id === drill.module.CAPABILITY);
      expect(row, `${drill.module.CAPABILITY} must be a capability the gate declares`).toBeDefined();
      expect(row!.missionRequired, 'a drill is inadmissible on a mission-required row').toBe(false);
      expect([...drill.module.EXERCISED].sort()).toEqual([...row!.implementedBy].sort());
    });

    it(`the ${drill.name} drill names a command an operator can actually run`, () => {
      expect(drill.module.DRILL_COMMAND).toBe(`npm run ${drill.script}`);
      expect(scripts[drill.script], `${drill.script} must exist in package.json`).toBeDefined();
      expect(drill.module.TRANSCRIPT_FILE).toMatch(/^[A-Za-z0-9._-]+$/u);
      expect(drill.module.INFRASTRUCTURE, 'the attestation must say what it ran against').toContain('real-postgres');
      expect(drill.module.INFRASTRUCTURE, 'and that it cost nothing').toContain('no-provider-call');
    });
  }

  it('no two drills claim the same capability or the same transcript file', () => {
    expect(new Set(DRILLS.map((drill) => drill.module.CAPABILITY)).size).toBe(DRILLS.length);
    expect(new Set(DRILLS.map((drill) => drill.module.TRANSCRIPT_FILE)).size).toBe(DRILLS.length);
  });
});

/**
 * THE LEDGER IS MERGED, NOT OVERWRITTEN.
 *
 * Three drills run into one directory — in CI and inside a mission bundle —
 * and the gate reads ONE ledger. A writer that truncated would leave the last
 * drill's proof and silently discard the other two: a directory that looks
 * complete and proves a third of what it claims.
 */
describe('the capability-proof ledger', () => {
  const record = (steps: number): DrillRecord => {
    const value = new DrillRecord();
    for (let index = 1; index <= steps; index += 1) value.step(`step ${index}`, true, 'read something');
    value.seal('SOMETHING');
    return value;
  };
  const write = (outDir: string, capability: string, drill: string, transcriptFile: string) => writeAttestation({
    outDir, repoRoot: join(__dirname, '..'), record: record(3), verified: true,
    capability, drill, exercised: ['package.json'], infrastructure: 'real-postgres,no-provider-call', transcriptFile,
  });

  it('carries every drill through and lets a rerun supersede only its own rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-ledger-'));
    write(dir, 'RESTART / RECOVERY', 'npm run a', 'a.txt');
    write(dir, 'FAILURE RECOVERY', 'npm run b', 'b.txt');
    write(dir, 'REPAIR LOOP', 'npm run c', 'c.txt');
    const first = readFileSync(join(dir, 'capability-proofs.tsv'), 'utf8');
    for (const capability of ['RESTART / RECOVERY', 'FAILURE RECOVERY', 'REPAIR LOOP']) {
      expect(first, `${capability} must survive the drills that ran after it`).toContain(capability);
    }
    expect(first.trim().split('\n').at(-1), 'and the row count must be the real one').toBe('(3 rows)');

    write(dir, 'FAILURE RECOVERY', 'npm run b', 'b.txt');
    const second = readFileSync(join(dir, 'capability-proofs.tsv'), 'utf8');
    expect(second.trim().split('\n').at(-1), 'a rerun replaces its own row, it does not add one').toBe('(3 rows)');
    expect(second).toContain('RESTART / RECOVERY');
    expect(second).toContain('REPAIR LOOP');
  });

  /**
   * AND IT REFUSES TO DESTROY EVIDENCE IT CANNOT READ. A ledger written under a
   * different column list is not mergeable; overwriting it would discard proofs
   * silently, so the drill fails on its own output instead.
   */
  it('refuses a ledger whose header it cannot merge, rather than overwriting it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-ledger-alien-'));
    writeFileSync(join(dir, 'capability-proofs.tsv'), 'capability\tsomething_else\n');
    expect(() => write(dir, 'REPAIR LOOP', 'npm run c', 'c.txt'))
      .toThrow(/capability_proof_ledger_header_mismatch/u);
  });
});

/**
 * THE TWO NEW DRILLS, AGAINST A REAL DATABASE.
 *
 * Env-gated the same way the live-chain proof is — `JULIUS_REAL_POSTGRES=1`
 * with `DATABASE_URL` — and written as a guarded suite rather than an early
 * return, which is how a test comes to assert nothing and still pass. Each runs
 * through the npm script an operator runs, which builds the bundle first, so
 * neither depends on a CI step having produced an artifact.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1')
  && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const runProcess = promisify(execFile);

suite('the failure-recovery and repair-loop drills, run for real', () => {
  const freshDatabase = async (): Promise<string> => {
    const name = `juliusdrill${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    return url.toString();
  };

  it('retries a transient provider failure, refuses to retry a permanent one, and the gate believes it', async () => {
    const out = mkdtempSync(join(tmpdir(), 'julius-failure-drill-'));
    const url = await freshDatabase();
    const { stdout } = await runProcess('npm', ['run', 'julius:failure-recovery-drill', '--silent', '--', '--out', out],
      { encoding: 'utf8', timeout: 300_000, env: { ...process.env, DATABASE_URL: url } });

    expect(stdout).toContain('JULIUS FAILURE RECOVERY VERIFIED');
    expect(stdout, 'the transient failure must be classified retryable by the runtime').toContain('TIMEOUT/true');
    expect(stdout, 'and the permanent one must not be').toContain('AUTH_CONFIGURATION/false');
    expect(stdout).not.toContain('[FAIL]');

    const row = evaluate(null, { capabilityDir: out }).results.find((value) => value.id === failure.CAPABILITY)!;
    expect(row.capability, row.capabilityBasis).toBe('PROVEN');
    expect(row.verdict).toBe('CAPABILITY PROVEN');
  }, 300_000);

  it('turns a rejecting review into a bounded repair that is re-reviewed, and the gate believes it', async () => {
    const out = mkdtempSync(join(tmpdir(), 'julius-repair-drill-'));
    const url = await freshDatabase();
    const { stdout } = await runProcess('npm', ['run', 'julius:repair-loop-drill', '--silent', '--', '--out', out],
      { encoding: 'utf8', timeout: 300_000, env: { ...process.env, DATABASE_URL: url } });

    expect(stdout).toContain('JULIUS REPAIR LOOP VERIFIED');
    expect(stdout, 'the repair must inherit its subject’s stage').toContain('repair:build');
    expect(stdout, 'and its subject’s role').toContain('CODING_AGENT');
    expect(stdout).not.toContain('[FAIL]');

    const row = evaluate(null, { capabilityDir: out }).results.find((value) => value.id === repair.CAPABILITY)!;
    expect(row.capability, row.capabilityBasis).toBe('PROVEN');
    expect(row.verdict).toBe('CAPABILITY PROVEN');

    /**
     * AND THE FAILING DIRECTION. The drill passed, so one that had stopped
     * checking would look identical. Given a database that already holds its
     * run it must refuse, and file a ledger the gate rejects.
     */
    const again = mkdtempSync(join(tmpdir(), 'julius-repair-drill-again-'));
    const second = await runProcess('npm', ['run', 'julius:repair-loop-drill', '--silent', '--', '--out', again],
      { encoding: 'utf8', timeout: 300_000, env: { ...process.env, DATABASE_URL: url } })
      .then(() => ({ code: 0 }), (error: { code?: number }) => ({ code: error.code ?? 1 }));
    expect(second.code, 'a dirty database is a drill failure, not a quiet pass').toBe(8);
    const refused = evaluate(null, { capabilityDir: again }).results.find((value) => value.id === repair.CAPABILITY)!;
    expect(refused.capability).toBe('UNPROVEN');
    expect(refused.capabilityBasis).toContain('the drill recorded FAILED, not VERIFIED');
  }, 300_000);
});
