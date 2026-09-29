import { describe, expect, it } from 'vitest';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { Pool } from 'pg';

import {
  CAPABILITY_PROOF_COLUMNS, DrillRecord, JULIUS_DRILL_DATABASE_NAME, drillDatabaseTarget, foreignJuliusRuns,
  writeAttestation, writeDrillAttestation,
} from './julius-drill-support';
import { drillDrivenFiles, drillEntry, specifiersIn } from './julius-drill-closure.mjs';
import * as recovery from './julius-recovery-drill';
import * as failure from './julius-failure-recovery-drill';
import * as repair from './julius-repair-loop-drill';
import { CAPABILITY_PROOF_COLUMNS as GATE_COLUMNS, evaluate } from './wonderland-beta-gate.mjs';

const REPO = join(__dirname, '..');

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

  it('a drill that cannot say what it drove files nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-ledger-unknown-drill-'));
    expect(() => writeDrillAttestation({
      outDir: dir, repoRoot: REPO, record: record(3), verified: true, capability: 'REPAIR LOOP', drill: 'npm run julius:no-such-drill',
      exercised: ['package.json'], infrastructure: 'real-postgres,no-provider-call', transcriptFile: 'x.txt',
    })).toThrow(/drill_driven_files_unknown: package\.json has no script julius:no-such-drill/u);
  });
});

/**
 * WHAT A DRILL DROVE IS READ FROM THE TREE — and the reader is held to the
 * bundler. GATE_AUDIT.md P0-2: the repair drill's attestation named one file,
 * its row's own, while the pipeline, repositories and composition it drove
 * through changed underneath it, and the gate kept calling it proven. A drill
 * now attests every file its build reaches, the gate demands exactly that set
 * back, and both read it with `julius-drill-closure.mjs`. That reader is a
 * regular-expression scanner; this is what keeps it honest: for every drill,
 * every repository file esbuild actually bundles must be in its closure.
 */
describe('the drill closure the gate binds a proof to', () => {
  for (const drill of DRILLS) {
    it(`covers every repository file esbuild bundles for the ${drill.name} drill`, async () => {
      const entry = drillEntry(REPO, drill.module.DRILL_COMMAND);
      expect('entry' in entry, JSON.stringify(entry)).toBe(true);
      const driven = drillDrivenFiles(REPO, drill.module.DRILL_COMMAND);
      if (!('files' in driven)) throw new Error(`the drill's closure is unknown: ${driven.error}`);
      const bundled = await build({
        entryPoints: [(entry as { entry: string }).entry], absWorkingDir: REPO, bundle: true, platform: 'node', format: 'cjs',
        external: ['pg'], write: false, metafile: true, logLevel: 'silent',
      });
      const inputs = Object.keys(bundled.metafile.inputs).filter((path) => !path.includes('node_modules'));
      expect(inputs.length, 'esbuild bundled the drill').toBeGreaterThan(50);
      expect(inputs.filter((path) => !driven.files.includes(path)), 'every bundled repository file is attested').toEqual([]);
      // And each file the drill's row is built on really is one it imports.
      for (const path of drill.module.EXERCISED) expect(driven.files, `${drill.name} drives ${path}`).toContain(path);
      // A dependency the bundle carries is pinned by the lockfile, which is attested too.
      expect(driven.files).toContain('package-lock.json');
    }, 90_000);
  }

  it('reads value imports and skips the ones the compiler erases', () => {
    const found = specifiersIn([
      "import { a } from './a';",
      "import type { B } from './b';",
      "export * from './c';",
      "export type { D } from './d';",
      'import {\n  e,\n  type F,\n} from "./e";',
      "import './side-effect';",
      "const g = await import('./g');",
      "const h = require('./h');",
      "// import { nope } from './comment';",
      ' * import { nope } from \'./doc-comment\';',
    ].join('\n'));
    expect([...found].sort()).toEqual(['./a', './c', './e', './g', './h', './side-effect']);
  });
});

/**
 * GATE_AUDIT.md P1-4: A DRILL NEVER WRITES INTO A STORE.
 *
 * Every drill used to take whatever `DATABASE_URL` said, and on this project's
 * workstation that is Julius's LIVE store (`…/julius`), inherited from the user
 * profile; on a runner `…/julius` is the paid mission's own database. The drills
 * write COMPLETED missions driven by scripted fakes, and the gate would then
 * have read them as real ones. The target is now accepted only when its
 * database is a drill's by name — which is what every caller already creates —
 * or the throwaway `JULIUS_TEST_DATABASE_URL` names, and `…/julius` is refused
 * before a connection exists.
 */
describe('the database a drill may write to', () => {
  const LIVE = 'postgresql://drill@127.0.0.1:5432/julius';

  /** The per-drill names a caller's loop creates: `julius_${drill//-/_}`, passed as `${DATABASE_URL%/*}/$db`. */
  const namesCreatedBy = (relativePath: string): string[] => {
    const source = readFileSync(join(REPO, relativePath), 'utf8');
    const loop = /for drill in ([a-z -]+); do\s+db="julius_\$\{drill\/\/-\/_\}"/u.exec(source);
    if (loop === null) throw new Error(`${relativePath} no longer creates its drill databases as julius_\${drill//-/_}`);
    return loop[1]!.trim().split(/\s+/u).map((drill) => `julius_${drill.replace(/-/gu, '_')}`);
  };

  it('ACCEPTS the databases CI, the paid workflow and the local launcher create, with no workflow change', () => {
    for (const caller of ['.github/workflows/julius-real-infra.yml', '.github/workflows/julius-first-live-mission.yml', 'scripts/julius-local-qualification.sh']) {
      const names = namesCreatedBy(caller);
      expect(names, caller).toEqual(['julius_recovery_drill', 'julius_failure_recovery_drill', 'julius_repair_loop_drill']);
      for (const name of names) {
        const target = drillDatabaseTarget({ databaseUrl: `${LIVE.slice(0, LIVE.lastIndexOf('/'))}/${name}` });
        expect(target.ok, `${caller}: ${name} — ${target.ok ? '' : target.reason}`).toBe(true);
      }
    }
    expect(drillDatabaseTarget({ databaseUrl: 'postgresql://drill@127.0.0.1:5432/juliusdrillkzf3m9x2' }).ok, 'the drill suites\' fresh databases').toBe(true);
    expect(drillDatabaseTarget({ databaseUrl: 'postgres://drill@db:5433/julius_drill_scratch' }).ok).toBe(true);
    // The repository's declared throwaway, exactly as a launcher names it.
    const suites = 'postgresql://drill@127.0.0.1:5432/julius_suites';
    expect(drillDatabaseTarget({ databaseUrl: suites, testDatabaseUrl: suites }).ok).toBe(true);
  });

  it('REFUSES the live store by name, whatever else is set, and anything it cannot show to be a throwaway', () => {
    const refused: readonly [Parameters<typeof drillDatabaseTarget>[0], string][] = [
      [{ databaseUrl: LIVE }, 'drill_database_is_julius_store'],
      [{ databaseUrl: LIVE, testDatabaseUrl: LIVE }, 'drill_database_is_julius_store'],
      [{ databaseUrl: 'postgresql://drill@10.0.0.9:6543/julius' }, 'drill_database_is_julius_store'],
      [{ databaseUrl: 'postgresql://drill@127.0.0.1:5432/postgres' }, 'drill_database_not_throwaway'],
      [{ databaseUrl: 'postgresql://drill@127.0.0.1:5432/julius_prod' }, 'drill_database_not_throwaway'],
      [{ databaseUrl: 'postgresql://drill@127.0.0.1:5432/julius_suites', testDatabaseUrl: 'postgresql://drill@127.0.0.1:5433/julius_suites' }, 'drill_database_not_throwaway'],
      [{ databaseUrl: 'host=127.0.0.1 dbname=julius_recovery_drill' }, 'drill_database_unverifiable'],
      [{ databaseUrl: 'postgresql://drill@127.0.0.1:5432/' }, 'drill_database_unverifiable'],
      [{ databaseUrl: '' }, 'drill_requires_database_url'],
      [{}, 'drill_requires_database_url'],
    ];
    for (const [input, code] of refused) {
      const target = drillDatabaseTarget(input);
      expect(target.ok, JSON.stringify(input)).toBe(false);
      expect(target.ok ? '' : target.code, JSON.stringify(input)).toBe(code);
    }
    expect(JULIUS_DRILL_DATABASE_NAME.test('julius')).toBe(false);
  });

  it('every drill entry refuses the live store before it connects (port 1 is never dialled)', async () => {
    const live = 'postgresql://drill@127.0.0.1:1/julius';
    const stderr = process.stderr.write.bind(process.stderr);
    const said: string[] = [];
    process.stderr.write = ((chunk: string) => { said.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try {
      expect(await recovery.runRecoveryDrill({ argv: [], repoRoot: REPO, databaseUrl: live })).toBe(2);
      expect(await failure.runFailureRecoveryDrill({ argv: [], repoRoot: REPO, databaseUrl: live })).toBe(2);
      expect(await repair.runRepairLoopDrill({ argv: [], repoRoot: REPO, databaseUrl: live })).toBe(2);
    } finally {
      process.stderr.write = stderr;
    }
    expect(said.join(''), 'each names the refusal').toMatch(/julius_recovery_drill_refused_database: drill_database_is_julius_store/u);
    expect(said.join('')).toMatch(/julius_failure_recovery_drill_refused_database: drill_database_is_julius_store/u);
    expect(said.join('')).toMatch(/julius_repair_loop_drill_refused_database: drill_database_is_julius_store/u);
  });

  it('and refuses any database holding a run that is not its own, asked before the migration writes anything', async () => {
    const scalarFrom = (answers: Readonly<Record<string, string | null>>) => async (sql: string) =>
      (sql.includes('to_regclass') ? answers.migrated ?? null : answers.foreign ?? null);
    expect(await foreignJuliusRuns(scalarFrom({ migrated: 'false' }), ['run:repair-drill']), 'a fresh database has no Julius schema at all').toBe(0);
    expect(await foreignJuliusRuns(scalarFrom({ migrated: 'true', foreign: '0' }), ['run:repair-drill'])).toBe(0);
    expect(await foreignJuliusRuns(scalarFrom({ migrated: 'true', foreign: '2' }), ['run:repair-drill'])).toBe(2);
    expect(await foreignJuliusRuns(scalarFrom({ migrated: 'true', foreign: 'many' }), ['run:repair-drill']), 'an answer that is not a count is not zero')
      .toBe(Number.POSITIVE_INFINITY);
    // The orchestrator asks before its first write: the migration, or — for the
    // recovery drill, whose migration runs in the crashing child — the spawn of it.
    for (const drill of ['julius-recovery-drill.ts', 'julius-failure-recovery-drill.ts', 'julius-repair-loop-drill.ts']) {
      const source = readFileSync(join(REPO, 'scripts', drill), 'utf8');
      const body = source.slice(source.indexOf('async function orchestrate('));
      const checked = body.indexOf('await foreignJuliusRuns(');
      expect(checked, `${drill} asks`).toBeGreaterThan(0);
      const writes = [body.indexOf('.migrate()'), body.indexOf("child('crash')")].filter((index) => index >= 0);
      expect(writes.length, `${drill} writes somewhere`).toBeGreaterThan(0);
      expect(checked, `${drill} asks before its first write`).toBeLessThan(Math.min(...writes));
    }
  });
});

/**
 * THE CONTRACT julius-real-infra HOLDS THE DRILLS TO, with the REAL writer.
 * After the drills run, the workflow calls `evaluate(null, { capabilityDir })`
 * and requires the capability axis of the three rows to read PROVEN. This
 * writes each drill's attestation exactly as the drill does — the same record
 * shape, `writeDrillAttestation`, its own command, capability, transcript and
 * probe files — and holds the gate to accepting all three.
 */
describe('the attestations the drills write are the ones the gate accepts', () => {
  it('RESTART / RECOVERY, FAILURE RECOVERY and REPAIR LOOP read PROVEN on the capability axis', () => {
    const out = mkdtempSync(join(tmpdir(), 'julius-real-infra-contract-'));
    for (const drill of DRILLS) {
      const record = new DrillRecord();
      for (let index = 1; index <= 12; index += 1) record.step(`step ${index}`, true, 'observed');
      writeDrillAttestation({
        outDir: out, repoRoot: REPO, record, verified: record.seal(`JULIUS ${drill.name.toUpperCase().replace(/[^A-Z ]/gu, ' ')}`),
        capability: drill.module.CAPABILITY, drill: drill.module.DRILL_COMMAND, exercised: drill.module.EXERCISED,
        infrastructure: drill.module.INFRASTRUCTURE, transcriptFile: drill.module.TRANSCRIPT_FILE,
      });
    }
    const report = evaluate(null, { capabilityDir: out });
    for (const drill of DRILLS) {
      const row = report.results.find((value) => value.id === drill.module.CAPABILITY)!;
      expect(row.capability, `${drill.module.CAPABILITY}: ${row.capabilityBasis}`).toBe('PROVEN');
      expect(row.capabilityBasis).toContain(`${drill.module.DRILL_COMMAND} drove every one of the`);
    }
  });
});

/**
 * THE TWO NEW DRILLS, AGAINST A REAL DATABASE.
 *
 * Env-gated the same way the live-chain proof is — `JULIUS_REAL_POSTGRES=1`
 * with `JULIUS_TEST_DATABASE_URL`, which names a throwaway database and is never
 * the inherited `DATABASE_URL` — and written as a guarded suite rather than an early
 * return, which is how a test comes to assert nothing and still pass. Each runs
 * through the npm script an operator runs, which builds the bundle first, so
 * neither depends on a CI step having produced an artifact.
 */
const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;
const runProcess = promisify(execFile);

suite('the failure-recovery and repair-loop drills, run for real', () => {
  const freshDatabase = async (): Promise<string> => {
    const name = `juliusdrill${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const admin = new Pool({ connectionString: databaseUrl! });
    try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
    const url = new URL(databaseUrl!);
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

    // The capability axis is what the drill proves. With no mission bundle the
    // mission axis is UNKNOWN, and a drill never stands in for UNKNOWN.
    const row = evaluate(null, { capabilityDir: out }).results.find((value) => value.id === failure.CAPABILITY)!;
    expect(row.capability, row.capabilityBasis).toBe('PROVEN');
    expect(row.verdict).toBe('FAIL');

    /**
     * A DATABASE HOLDING SOMEBODY ELSE'S RUN IS A STORE, WHATEVER IT IS CALLED.
     * The repair drill, pointed at the database the failure drill just wrote,
     * must refuse before it migrates or writes anything.
     */
    const foreign = mkdtempSync(join(tmpdir(), 'julius-repair-drill-foreign-'));
    const refusedHere = await runProcess('npm', ['run', 'julius:repair-loop-drill', '--silent', '--', '--out', foreign],
      { encoding: 'utf8', timeout: 300_000, env: { ...process.env, DATABASE_URL: url } })
      .then(() => ({ code: 0 }), (error: { code?: number }) => ({ code: error.code ?? 1 }));
    expect(refusedHere.code, 'a database with foreign runs is refused').toBe(8);
    expect(readFileSync(join(foreign, 'julius-repair-loop-drill.transcript.txt'), 'utf8')).toContain('run(s) here are not run:repair-drill');
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
    expect(row.verdict, 'no bundle: the mission axis is UNKNOWN, which no drill stands in for').toBe('FAIL');

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
