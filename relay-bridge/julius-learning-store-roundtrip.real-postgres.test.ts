import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptedAdapter, type ScriptedOutcome } from '../src/relay/mission/julius';
import type { JuliusBootstrapRequest } from '../src/relay/integration/julius/julius-port';
import { parseJuliusCarrySources, parseJuliusDumpTable, verifyJuliusCarryChain } from '../src/relay/mission/julius/julius-carry-verify';
import { juliusFindingTransitionFacts } from '../src/relay/mission/julius/julius-finding-lifecycle';
import { JuliusClaimPostgresRepository } from '../src/relay/persistence/julius-claim-postgres';
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
import { JuliusEventPostgresRepository } from '../src/relay/persistence/julius-event-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { createLiveJuliusBootstrapPort } from './julius/bootstrap';
import {
  CODER_WORKER, architectWorker, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal,
  recordJuliusLearningOutcome, reviewerWorker,
} from './julius/live-composition';
import { compileBootstrapRequest, parseLiveMissionContract } from './julius/mission-contract';
import { JULIUS_CARRIED_KNOWLEDGE_LIMIT, createPostgresMissionKnowledgeStore } from './julius/mission-knowledge';
import { createPostgresMissionSeedStore } from './julius/mission-seed';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * A LEARNING PAIR ACROSS TWO DATABASES, AS DECISION C'S OPTION D RUNS IT (C-13; SECOND's K5, and P4: REH's
 * executed scenario). Nothing is paid: every provider answers from a script, and a guard holds the network shut.
 *
 * ARM WITHOUT, on a fresh database, through the product path: the reviewer REJECTS THE BUILD citing the work it
 * judged, the runtime repairs it (`repair:build`), and the re-review resolves the finding from its own packet. Its
 * outcome is recorded, as the live job records it. Beside that finding the same store holds two CONTROLS: a finding
 * row written directly with no lifecycle, and a forged lifecycle whose review, repair and re-review are no tasks of
 * the run. Neither may ever travel.
 *
 * THE STORE IS DUMPED AND RESTORED BY `.github/julius-learning-store.sh`, the file the paid job runs, as it is: its
 * command lines are printed, and the restore reads the very file the dump wrote (same sha256).
 *
 * THE FOUR POINTS, ACROSS THE TWO DATABASES:
 *   1. WITHOUT wrote it      — the build finding, its repair and its resolving re-review, in the source store;
 *   2. eligibility chose it  — the carry plan the RESTORED store gives a WITH run is the one the SOURCE store gives:
 *                              the same verified repair finding, the same text by sha256, the controls and the design
 *                              excluded by their names on both sides;
 *   3. WITH restored it      — arm WITH, bootstrapped on the restored database with its carry REQUIRED and pinned to
 *                              its WITHOUT, holds the copy;
 *   4. the planner got it    — WITH's plan compiles admitted it, and the off-host verifier proves the chain from
 *                              WITHOUT's export (taken from the SOURCE store, before the dump) against WITH's record,
 *                              copies and receipts (read from the RESTORED store's own dump queries).
 * And the negative control: a second restore of the same file, whose repair task no longer finished, gives WITH
 * nothing it may inherit, and its required carry is refused before anything is dispatched.
 *
 * NEEDS a pg_dump / pg_restore / psql of the server's major version (JULIUS_TEST_PG_BINDIR names one, or the
 * standard places hold one). Without one the suite is todo, and where JULIUS_REAL_POSTGRES=1 demands it, a failure.
 */

const ROOT = resolve(__dirname, '..');
const SCRIPT = join(ROOT, '.github', 'julius-learning-store.sh');
const BASH = process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\bin\\bash.exe') ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const EXE = process.platform === 'win32' ? '.exe' : '';
const PG_BINDIR_ENV = 'JULIUS_TEST_PG_BINDIR';
const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
const nonce = () => randomBytes(4).toString('hex');

/* ---------------------------------------------------------------- the client tools, of the server's major version */

const INHERITED_ENV = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA'] as const;
const baseEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { LC_ALL: 'C', PGAPPNAME: 'julius-learning-roundtrip', PGCONNECT_TIMEOUT: '15' };
  for (const name of INHERITED_ENV) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
};

function serverMajorOf(url: string): number | null {
  const probe = "const { Client } = require('pg'); const c = new Client({ connectionString: process.env.JLRT_PROBE_URL });"
    + " c.connect().then(() => c.query('SHOW server_version_num')).then((r) => { process.stdout.write(String(r.rows[0].server_version_num)); return c.end(); })"
    + ' .catch(() => process.exit(2));';
  try {
    const answer = Number(execFileSync(process.execPath, ['-e', probe], { cwd: ROOT, encoding: 'utf8', timeout: 30_000, windowsHide: true, env: { ...baseEnv(), JLRT_PROBE_URL: url } }).trim());
    return Number.isSafeInteger(answer) && answer >= 100_000 ? Math.floor(answer / 10_000) : null;
  } catch {
    return null;
  }
}

function clientDirFor(major: number): string | null {
  const stated = process.env[PG_BINDIR_ENV]?.trim();
  const candidates = stated !== undefined && stated !== '' ? [stated] : [
    ...(process.platform === 'win32'
      ? [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL', String(major), 'bin')]
      : [`/usr/lib/postgresql/${String(major)}/bin`, `/usr/pgsql-${String(major)}/bin`, `/opt/homebrew/opt/postgresql@${String(major)}/bin`]),
    ...(process.env.PATH ?? '').split(delimiter).filter((dir) => dir.trim() !== ''),
  ];
  for (const dir of new Set(candidates)) {
    const tools = ['pg_dump', 'pg_restore', 'psql'].map((tool) => join(dir, `${tool}${EXE}`));
    if (!tools.every((tool) => existsSync(tool))) continue;
    const majors = tools.map((tool) => {
      try {
        return Number(/\(PostgreSQL\)\s+(\d+)/u.exec(execFileSync(tool, ['--version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: baseEnv() }))?.[1]);
      } catch {
        return Number.NaN;
      }
    });
    if (majors.every((value) => value === major)) return dir;
  }
  return null;
}

const databaseUrl = juliusTestDatabaseUrl();
const serverMajor = databaseUrl === null ? null : serverMajorOf(databaseUrl);
const clientDir = serverMajor === null ? null : clientDirFor(serverMajor);
// A DEMANDED SUITE THAT CANNOT RUN IS A FAILURE, by its cause, never a todo (A5).
if (databaseUrl !== null && process.env.JULIUS_REAL_POSTGRES === '1') {
  if (serverMajor === null) {
    throw new Error('julius_real_postgres_server_unreadable: JULIUS_REAL_POSTGRES=1 demands this suite, and the server JULIUS_TEST_DATABASE_URL names did not say its version');
  }
  if (clientDir === null) {
    throw new Error(`julius_real_postgres_without_pg_client: JULIUS_REAL_POSTGRES=1 demands this suite, and no pg_dump/pg_restore/psql of the server's major (${String(serverMajor)}) was found; set ${PG_BINDIR_ENV}`);
  }
}
const suite = clientDir !== null ? describe : describe.todo;

/* ---------------------------------------------------------------- the scripted pair (zero spend) */

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const DESIGN = {
  components: [{ name: 'release-script', responsibility: 'Runs the migration, then the deploy.' }],
  decisions: [{ decisionId: 'D1', decision: 'Migrate before deploying.', reason: 'The deploy reads the migrated schema.' }],
};
const ALIGNED = { assessment: 'ALIGNED', claim: 'The release script matches the recorded design.' };
const ARCHITECT: ScriptedOutcome = { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null, architecture: DESIGN, consistency: ALIGNED };
const BUILD: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }, { type: 'DIFF', status: 'PASSED', safeSummary: 'The change set.' }], usdMicros: null };
const SENTINEL = 'ROUNDTRIP-SENTINEL the build deploys before the migration runs';
/** REH's premise: the build review FAILS, naming what it judged — the TEST and DIFF the build recorded. */
const REJECT_BUILD: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: SENTINEL }], usdMicros: null };
const PASS_AND_RESOLVE: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }], usdMicros: null, answerFindings: 'RESOLVED' };
const POLICY = { dimensions: ['dispatches', 'repairs'], minimumRelativeImprovement: 0.1, minimumImprovedDimensions: 1 };
const CARD = 'card:roundtrip:1';

type Facts = Record<string, string | number | boolean | null>;

suite('a learning pair across two databases: dumped and restored as Option D does it, the carry decided on both sides (C-13, P4)', () => {
  let admin: Pool;
  const pools: Pool[] = [];
  const created: string[] = [];
  const suffix = nonce();
  const scratch = mkdtempSync(join(tmpdir(), 'jlrt-'));
  const realFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl! });
    // ZERO SPEND (B3): nothing in this suite may reach a network. A provider that tried would be named here.
    globalThis.fetch = ((input: unknown) => {
      fetchCalls.push(String(input));
      return Promise.reject(new Error('jlrt_network_refused'));
    }) as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    for (const pool of pools) await pool.end().catch(() => undefined);
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    const left = await admin.query<{ datname: string }>('SELECT datname FROM pg_database WHERE datname = ANY($1)', [created]);
    await admin.end();
    rmSync(scratch, { recursive: true, force: true });
    if (left.rows.length > 0) throw new Error(`jlrt_databases_left: ${left.rows.map((row) => row.datname).join(', ')}`);
  });

  /** A fresh database on the test server, recorded for the drop. template0: never polluted, never "in use". */
  async function database(label: string, encoding: 'UTF8' | 'LATIN1' = 'UTF8'): Promise<{ readonly name: string; readonly pool: Pool }> {
    const name = `jlrt_${suffix}_${label}`;
    created.push(name);
    await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING '${encoding}' LC_COLLATE 'C' LC_CTYPE 'C'`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString() });
    pools.push(pool);
    return { name, pool };
  }

  /** The store script, run as the paid job runs it, against one database; its command lines are kept and printed. */
  function store(args: readonly string[], target: string) {
    const url = new URL(databaseUrl!);
    const password = url.password === '' ? null : decodeURIComponent(url.password);
    const env: NodeJS.ProcessEnv = {
      ...baseEnv(), PGHOST: url.hostname, PGPORT: url.port === '' ? '5432' : url.port, PGUSER: decodeURIComponent(url.username),
      PGDATABASE: target, JULIUS_PG_BINDIR: clientDir!.replaceAll('\\', '/'), ...(password === null ? {} : { PGPASSWORD: password }),
    };
    const result = spawnSync(BASH, [SCRIPT, ...args.map((arg) => arg.replaceAll('\\', '/'))], { encoding: 'utf8', env, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const commands = out.split('\n').filter((line) => line.startsWith('JULIUS_STORE_COMMAND '));
    console.info(`[julius-learning-store ${args[0] ?? ''} -> ${target}]\n${commands.join('\n')}`);
    // A4: the password reaches the tools through the environment only, never a printed line.
    if (password !== null) expect(out.includes(password), 'the password never appears in what the script printed').toBe(false);
    return { status: result.status, out, commands };
  }

  /** One registered pair's shared mission (an em dash in the objective, as every real contract has: 7a(2)'s premise). */
  function pair() {
    const id = nonce();
    const digest = sha256(`julius.learning-registration.v1 roundtrip ${id}`);
    const base = {
      missionId: `mission:roundtrip-${id}`, markerNamespace: `roundtrip-${id}`, projectId: `prj-roundtrip-${id}`,
      tenantId: `tenant-roundtrip-${id}`, objective: 'Add the deploy step to the release script — after the migration.',
      requirements: ['Run the migration first.'], constraints: ['Touch only scripts/.'],
      acceptanceCriteria: [{ id: 'AC-1', text: 'The release script deploys after migrating.', blocking: true }],
      testCommand: 'npm test', workspacePath: '/workspace/roundtrip', limits: { spendUsd: 2, repairCycles: 1 },
    };
    const arm = async (pool: Pool, input: {
      readonly clause: Record<string, unknown>;
      readonly scripts: { readonly architect: readonly ScriptedOutcome[]; readonly coder: readonly ScriptedOutcome[]; readonly reviewer: readonly ScriptedOutcome[] };
      readonly carry?: { readonly required: boolean; readonly fromRunIds?: readonly string[] };
    }) => {
      const parsed = parseLiveMissionContract(JSON.stringify({ ...base, learningPair: input.clause }));
      if (!parsed.ok) throw new Error(parsed.problem);
      const handoffs = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool));
      const packetFor = (dispatch: { readonly contextId: string }) =>
        handoffs.contexts.snapshotFor(dispatch.contextId)?.packet.blocks.map((block) => block.text).join('\n') ?? null;
      const entries = [
        { worker: architectWorker({}), adapter: scriptedAdapter(architectWorker({}), input.scripts.architect, { packetFor }) },
        { worker: CODER_WORKER, adapter: scriptedAdapter(CODER_WORKER, input.scripts.coder, { packetFor }) },
        { worker: reviewerWorker('hermes'), adapter: scriptedAdapter(reviewerWorker('hermes'), input.scripts.reviewer, { packetFor }) },
      ];
      // ZERO SPEND (B3): every adapter is a script; none could reach a provider.
      expect(entries.every((entry) => Array.isArray(entry.adapter.dispatches))).toBe(true);
      const request = compileBootstrapRequest(parsed.contract, entries.map((entry) => ({
        role: entry.worker.role as JuliusBootstrapRequest['workers'][number]['role'],
        integrationId: entry.worker.workerId, adapterId: entry.worker.adapterId,
        independenceGroup: entry.worker.providerId, requiredCapabilities: entry.worker.capabilities,
      })), CARD);
      const runs = new JuliusPostgresRepository(pool);
      const contracts = new JuliusContractPostgresRepository(pool);
      const submitted = await createLiveJuliusBootstrapPort({
        runs: {
          loadRun: runs.loadRun.bind(runs), createRun: runs.createRun.bind(runs), addTask: runs.addTask.bind(runs),
          transition: runs.transition.bind(runs), putTaskContract: contracts.putTaskContract.bind(contracts),
        },
        seeds: createPostgresMissionSeedStore(pool),
        knowledge: createPostgresMissionKnowledgeStore(pool),
        ...(input.carry === undefined ? {} : { carry: input.carry }),
        tenantId: base.tenantId, executionId: `execution:julius-live:${base.missionId}`,
      }).submit(request);
      const drive = async () => {
        if (!submitted.accepted) throw new Error(`${submitted.reasonCode}: ${submitted.safeMessage}`);
        const runtime = assembleLiveJuliusRuntime({ store: handoffs.store, entries, cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1 });
        return driveJuliusRunToTerminal({ loop: runtime.loop, store: handoffs.store, runId: submitted.runId, projectId: base.projectId, verification: runtime.verification });
      };
      const record = () => {
        if (!submitted.accepted) throw new Error('unreachable');
        return recordJuliusLearningOutcome({
          store: handoffs.store, runId: submitted.runId, projectId: base.projectId, registration: parsed.contract.learningPair!,
          objectiveDigest: request.missionBindingDigest, roles: entries.map((entry) => entry.worker.role),
        });
      };
      return { submitted, entries, drive, record };
    };
    return { digest, base, arm };
  }

  /* ---------------------------------------------------------------- reading a store as the bundle does */

  const dumpQuery = (file: string): string => {
    const script = readFileSync(join(ROOT, '.github', 'julius-live-evidence-dump.sh'), 'utf8');
    const line = script.split('\n').find((entry) => entry.startsWith('dump "SELECT') && entry.endsWith(`" ${file}`)) ?? '';
    expect(line, `${file} is dumped`).not.toBe('');
    return line.slice('dump "'.length, line.length - `" ${file}`.length);
  };
  const dumpedTable = async (pool: Pool, file: string) => {
    const result = await pool.query({ text: dumpQuery(file), rowMode: 'array', types: { getTypeParser: () => (value: string) => value } });
    const rows = result.rows as (string | null)[][];
    const text = `${[result.fields.map((field) => field.name).join('\t'), ...rows.map((row) => row.map((cell) => cell ?? '').join('\t')), `(${String(rows.length)} row${rows.length === 1 ? '' : 's'})`].join('\n')}\n`;
    const parsed = parseJuliusDumpTable(text);
    if (!parsed.ok) throw new Error(`${file}: ${parsed.problem}`);
    return parsed.value;
  };
  const sourcesOf = async (pool: Pool, runId: string): Promise<string> => {
    const sql = readFileSync(join(ROOT, '.github', 'julius-carry-sources.sql'), 'utf8');
    return JSON.stringify((await pool.query<{ json_build_object: unknown }>(sql.replace(":'run'", '$1'), [runId])).rows[0]?.json_build_object);
  };
  /** What a WITH run would inherit from this store: the carried ids and text digests, and every finding exclusion by name. */
  const carryOf = async (pool: Pool, input: { projectId: string; missionId: string; withoutRun: string; heir: string }) => {
    const plan = await new JuliusClaimPostgresRepository(pool).knowledgeCarryPlan({
      runId: input.heir, projectId: input.projectId, missionId: input.missionId, scopeTaskId: `${input.heir}:plan`,
      limit: JULIUS_CARRIED_KNOWLEDGE_LIMIT, occurredAt: '2026-10-06T12:00:00.000Z', fromRunIds: [input.withoutRun],
      scope: { taskId: `${input.heir}:plan`, taskType: 'plan', role: 'PROMPT_ARCHITECT' },
    });
    return {
      carried: plan.carried.map((item) => ({ entryId: item.entryId, source: item.source, sourceRef: item.sourceRef, digest: sha256(item.text) })),
      excluded: plan.excluded.map((item) => `${item.reason} ${item.sourceRef}`).sort(),
    };
  };
  const factsOf = async (pool: Pool, runId: string, type: string): Promise<readonly { task_id: string | null; facts: Facts }[]> => (await pool.query<{ task_id: string | null; facts: Facts }>(
    `SELECT payload->>'taskId' AS task_id, payload->'facts' AS facts FROM relay_wonderland.events WHERE stream_id = $1 AND event_type = $2 ORDER BY sequence`,
    [runId, `julius.${type}`])).rows;

  /** The two controls, written straight into the WITHOUT run's store: neither is a finding the runtime lived. */
  async function controls(pool: Pool, input: { runId: string; projectId: string; taskId: string }) {
    const direct = `finding:${input.runId}:control-direct-row`;
    const forged = `finding:${input.runId}:control-forged-life`;
    for (const [findingId, status] of [[direct, 'RESOLVED'], [forged, 'OPEN']] as const) {
      await pool.query(
        `INSERT INTO relay_wonderland.julius_reviewer_findings(finding_id,run_id,task_id,reviewer_worker_id,severity,category,claim,criterion_id,evidence_ids,blocking,status,created_at,updated_at)
         VALUES($1,$2,$3,'independent-reviewer-hermes','HIGH','review',$4,NULL,$5::jsonb,true,$6,now(),now())`,
        [findingId, input.runId, input.taskId, `CONTROL ${findingId}`, JSON.stringify([`evidence:${findingId}`]), status]);
    }
    // The forgery: a perfect lifecycle, appended through the event store, naming a review, repair and re-review that never ran.
    const events = new JuliusEventPostgresRepository(pool);
    const at = '2026-10-06T11:00:00.000Z';
    const append = (type: 'finding.recorded' | 'finding.transitioned', facts: Facts) => events.append({
      eventId: `jlrt:${nonce()}`, runId: input.runId, projectId: input.projectId, type, taskId: input.taskId, workerId: 'independent-reviewer-hermes',
      correlationId: `jlrt:${input.runId}`, causationId: null, occurredAt: at, facts,
    });
    await append('finding.recorded', { findingId: forged, evidenceId: `evidence:${forged}`, blocking: true, reviewTaskId: `review:${input.taskId}:never` });
    await append('finding.transitioned', juliusFindingTransitionFacts({ findingId: forged, move: 'REPAIR_SUCCEEDED', at, repairTaskId: `repair:${input.taskId}:never:task` }));
    await append('finding.transitioned', juliusFindingTransitionFacts({ findingId: forged, move: 'REVIEWER_RESOLVED', at, reviewTaskId: `review:repair:${input.taskId}:never:task` }));
    return { direct, forged };
  }

  it('carries arm WITHOUT\'s repaired BUILD finding across the dump and the restore, to arm WITH\'s planner, and nothing else — proven at all four points', async () => {
    const { digest, base, arm } = pair();
    const source = await database('src');
    await new TransactionalWonderlandDatabase(source.pool).migrate();

    /* ---------------------------------------------------------------- (1) ARM WITHOUT, on the source database */
    const without = await arm(source.pool, {
      clause: { registrationDigest: digest, arm: 'WITHOUT', rerunKey: `without-${nonce()}`, policy: POLICY },
      scripts: { architect: [ARCHITECT], coder: [BUILD], reviewer: [PASS_AND_RESOLVE, REJECT_BUILD, PASS_AND_RESOLVE] },
    });
    expect(without.submitted.accepted, 'arm WITHOUT bootstraps on its fresh store').toBe(true);
    if (!without.submitted.accepted) throw new Error('unreachable');
    const withoutRun = without.submitted.runId;
    const outcome = await without.drive();
    expect(outcome.state, String(outcome.haltCause)).toBe('COMPLETED');
    const repairs = await source.pool.query<{ task_id: string; task_type: string; state: string }>(
      `SELECT task_id, task_type, state FROM relay_wonderland.julius_tasks WHERE run_id = $1 AND task_type LIKE 'repair:%'`, [withoutRun]);
    expect(repairs.rows.map((row) => [row.task_type, row.state]), 'REH\'s premise: the BUILD was repaired').toEqual([['repair:build', 'SUCCEEDED']]);
    const findings = await source.pool.query<{ finding_id: string; task_id: string; evidence_ids: string[] }>(
      'SELECT finding_id, task_id, evidence_ids FROM relay_wonderland.julius_reviewer_findings WHERE run_id = $1', [withoutRun]);
    expect(findings.rows).toHaveLength(1);
    const finding = findings.rows[0]!;
    expect(finding.task_id, 'the finding judged the build').toBe(`${withoutRun}:build`);
    const cited = await source.pool.query('SELECT 1 FROM relay_wonderland.julius_evidence WHERE run_id = $1 AND evidence_id = ANY($2)', [withoutRun, finding.evidence_ids]);
    expect(cited.rowCount, 'the REJECT cites concrete evidence this run recorded').toBe(finding.evidence_ids.length);

    // 7b: a store dumped BEFORE its run's record is refused: the WITH arm would have no WITHOUT to meet.
    expect(await factsOf(source.pool, withoutRun, 'learning.arm.recorded'), 'the precondition: no record yet').toEqual([]);
    const early = store(['dump', join(scratch, 'early'), withoutRun], source.name);
    expect(early.status).toBe(1);
    expect(early.out, 'the dump itself ran: the refusal is about the record, not a missing tool').toContain('JULIUS_STORE_COMMAND host pg_dump --format=custom');
    expect(early.out).toContain('learning_store_without_record: the store does not hold the WITHOUT record of this run');
    expect((await without.record()).record, 'the record, as the live job writes it').toBe('RECORDED');

    const { direct, forged } = await controls(source.pool, { runId: withoutRun, projectId: base.projectId, taskId: `${withoutRun}:build` });

    /* ---------------------------------------------------------------- (2) what the SOURCE store would carry, and WITHOUT's export */
    const heir = `run:${'e'.repeat(24)}`;
    const ids = { projectId: base.projectId, missionId: base.missionId, withoutRun, heir };
    const fromSource = await carryOf(source.pool, ids);
    expect(fromSource.carried.map((item) => [item.source, item.sourceRef]), 'one verified repair finding, and only it').toEqual([['VERIFIED_REPAIR_FINDING', finding.finding_id]]);
    for (const control of [`finding_unresolved ${direct}`, `finding_provenance_unverified ${forged}`]) {
      expect(fromSource.excluded, `the control is present, and excluded by name: ${control}`).toContain(control);
    }
    expect(fromSource.excluded.some((line) => line.startsWith('architecture_not_a_source ')), 'the design in force, named, not carried').toBe(true);
    const exportText = await sourcesOf(source.pool, withoutRun);
    const exportDigest = sha256(exportText);

    /* ---------------------------------------------------------------- DUMP, then RESTORE the very same file */
    const dumped = store(['dump', join(scratch, 'store'), withoutRun], source.name);
    expect(dumped.status, dumped.out).toBe(0);
    expect(dumped.commands.some((line) => line.includes('pg_dump --format=custom --compress=0'))).toBe(true);
    const dumpFile = join(scratch, 'store', 'julius.pgdump');
    const dumpDigest = sha256(readFileSync(dumpFile));
    expect(dumped.out, 'the script names the digest of the file it wrote').toContain(`dump_sha256=${dumpDigest}`);

    const restored = await database('dst');
    const back = store(['restore', dumpFile, withoutRun, digest], restored.name);
    expect(back.status, back.out).toBe(0);
    expect(back.out, 'the restore read the file the dump wrote').toContain(`LEARNING_STORE_RESTORING dump_sha256=${dumpDigest}`);
    expect(back.out).toContain(`LEARNING_STORE_RESTORED without_julius_run_id=${withoutRun}`);
    expect(back.commands.some((line) => line.includes('pg_restore --no-owner --no-privileges --single-transaction --exit-on-error'))).toBe(true);
    await new TransactionalWonderlandDatabase(restored.pool).migrate();

    /* (2) THE RESTORED STORE DECIDES THE SAME CARRY: the same finding, the same text, the same exclusions. */
    expect(await carryOf(restored.pool, ids)).toEqual(fromSource);

    /* ---------------------------------------------------------------- (3) ARM WITH, on the restored database */
    const withArm = await arm(restored.pool, {
      clause: { registrationDigest: digest, arm: 'WITH', rerunKey: `with-${nonce()}`, withoutRunId: withoutRun, policy: POLICY },
      scripts: { architect: [ARCHITECT], coder: [BUILD], reviewer: [PASS_AND_RESOLVE] },
      carry: { required: true, fromRunIds: [withoutRun] },
    });
    expect(withArm.submitted.accepted, 'the restored carry holds a verified repair finding of its WITHOUT').toBe(true);
    if (!withArm.submitted.accepted) throw new Error('unreachable');
    const withRun = withArm.submitted.runId;
    expect((await withArm.drive()).state).toBe('COMPLETED');

    /* (4) THE PLANNER RECEIVED IT, and the chain holds from WITHOUT's SOURCE export to WITH's RESTORED rows (B1). */
    const receipts = await factsOf(restored.pool, withRun, 'knowledge.consumed');
    expect(receipts.length).toBeGreaterThan(0);
    for (const receipt of receipts) expect(receipt.facts).toMatchObject({ role: 'PROMPT_ARCHITECT', taskType: 'plan', missing: 0, inScope: 1, admitted: 1 });
    const sources = parseJuliusCarrySources(exportText);
    if (!sources.ok) throw new Error(sources.problem);
    const chain = verifyJuliusCarryChain({
      sources: sources.value, withRunId: withRun,
      knowledge: await dumpedTable(restored.pool, 'knowledge-carry.tsv'), copies: await dumpedTable(restored.pool, 'carry-copies.tsv'), tasks: await dumpedTable(restored.pool, 'tasks.tsv'),
      limit: JULIUS_CARRIED_KNOWLEDGE_LIMIT, sha256: (text) => sha256(Buffer.from(text, 'utf8')),
    });
    console.info(`[jlrt] WITHOUT export sha256 ${exportDigest}; dump sha256 ${dumpDigest}; verdict ${chain.verdict}`);
    expect(chain.checks.filter((item) => !item.ok)).toEqual([]);
    expect(chain.proven.map((item) => item.findingId)).toEqual([finding.finding_id]);

    /* ---------------------------------------------------------------- THE NEGATIVE CONTROL (B2) */
    // The same file, restored again; then its repair task no longer finished. B2 BY STATE, NOT DELETE (SECOND accepted):
    // julius_tasks is referenced WITHOUT ON DELETE CASCADE by the brain, the trajectory and the task contracts, and any
    // one broken link shows the same thing. The carry is then recomputed from the restored rows, so the finding must
    // stop being eligible, and WITH's required carry must refuse.
    const broken = await database('dst_broken');
    const again = store(['restore', dumpFile, withoutRun, digest], broken.name);
    expect(again.status, again.out).toBe(0);
    expect(again.out, 'the same file again').toContain(`LEARNING_STORE_RESTORING dump_sha256=${dumpDigest}`);
    await new TransactionalWonderlandDatabase(broken.pool).migrate();
    const repairTask = repairs.rows[0]!.task_id;
    const tampered = await broken.pool.query<{ task_id: string; task_type: string }>(
      `UPDATE relay_wonderland.julius_tasks SET state = 'FAILED' WHERE task_id = $1 AND run_id = $2 RETURNING task_id, task_type`, [repairTask, withoutRun]);
    console.info(`[jlrt] B2 tampered: ${JSON.stringify(tampered.rows)}`);
    expect(tampered.rows, 'exactly one row changed, and it is the finding\'s repair').toEqual([{ task_id: repairTask, task_type: 'repair:build' }]);
    const brokenCarry = await carryOf(broken.pool, ids);
    expect(brokenCarry.carried, 'nothing may travel once the repair did not finish').toEqual([]);
    expect(brokenCarry.excluded).toContain(`finding_provenance_unverified ${finding.finding_id}`);
    const refusedArm = await arm(broken.pool, {
      clause: { registrationDigest: digest, arm: 'WITH', rerunKey: `with-${nonce()}`, withoutRunId: withoutRun, policy: POLICY },
      scripts: { architect: [ARCHITECT], coder: [BUILD], reviewer: [PASS_AND_RESOLVE] },
      carry: { required: true, fromRunIds: [withoutRun] },
    });
    expect(refusedArm.submitted).toMatchObject({ accepted: false, reasonCode: 'carried_knowledge_required' });
    const refusedRun = (await broken.pool.query<{ run_id: string; state: string }>(
      `SELECT run_id, state FROM relay_wonderland.julius_runs WHERE mission_id = $1 AND run_id <> $2`, [base.missionId, withoutRun])).rows;
    expect(refusedRun.map((row) => row.state), 'left CREATED: nothing contracted, nothing dispatched').toEqual(['CREATED']);
    const [refusal] = await factsOf(broken.pool, refusedRun[0]!.run_id, 'knowledge.carried');
    expect(refusal?.facts, 'the refused run\'s own record says why: nothing eligible').toMatchObject({ outcome: 'EMPTY', carried: 0 });
    expect(String(refusal?.facts.excludedRefs), 'and names the finding whose repair did not finish').toContain(`finding_provenance_unverified:${withoutRun}:${finding.finding_id}`);
    expect(await factsOf(broken.pool, refusedRun[0]!.run_id, 'knowledge.consumed'), 'no planner receipt').toEqual([]);
    expect(refusedArm.entries.reduce((sum, entry) => sum + entry.adapter.dispatches.length, 0), 'no dispatch at all').toBe(0);

    expect(fetchCalls, 'zero spend: no provider was reached').toEqual([]);
  }, 600_000);

  it('7a: a store that already holds another mission\'s run refuses the restore, whole, and is left as it was', async () => {
    const { digest } = pair();
    const occupied = await database('occupied');
    await new TransactionalWonderlandDatabase(occupied.pool).migrate();
    // THE PRECONDITION, made and then read back: the target really holds a run of another mission.
    const other = { projectId: `prj-occupied-${suffix}`, missionId: `mission:occupied-${suffix}`, runId: `run:${'a'.repeat(24)}` };
    await occupied.pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [other.projectId]);
    await occupied.pool.query(`INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$1,'{}'::jsonb)`, [other.missionId, other.projectId]);
    await occupied.pool.query(
      `INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision,created_at)
       VALUES($1,$2,$3,'COMPLETED','julius-runtime.v1','card',1,0,now())`, [other.runId, other.missionId, other.projectId]);
    const runsIn = async () => (await occupied.pool.query<{ run_id: string }>('SELECT run_id FROM relay_wonderland.julius_runs')).rows.map((row) => row.run_id);
    expect(await runsIn(), 'the target holds another mission\'s run before the restore').toEqual([other.runId]);
    const dumpFile = join(scratch, 'store', 'julius.pgdump');
    expect(existsSync(dumpFile), 'the main case wrote the dump this case restores').toBe(true);
    const result = store(['restore', dumpFile, `run:${'0'.repeat(24)}`, digest], occupied.name);
    expect(result.status).not.toBe(0);
    expect(result.out, 'refused by pg_restore at the schema it would have created, not for anything else').toContain('schema "relay_wonderland" already exists');
    expect(result.out).not.toContain('LEARNING_STORE_RESTORED');
    expect(await runsIn(), 'one transaction: the target is exactly as it was').toEqual([other.runId]);
  }, 300_000);

  it('A5: demanded, with the server answering and NO client of its major, this suite FAILS by name, never todo', () => {
    // The precondition, made: a directory that holds no client at all, against a server that answers.
    const empty = mkdtempSync(join(tmpdir(), 'jlrt-noclient-'));
    expect(['pg_dump', 'pg_restore', 'psql'].some((tool) => existsSync(join(empty, `${tool}${EXE}`))), 'the stated directory holds no client').toBe(false);
    expect(serverMajor, 'the server answered its version').not.toBeNull();
    const child = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'relay-bridge/julius-learning-store-roundtrip.real-postgres.test.ts'], {
      cwd: ROOT, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITEST'))), [PG_BINDIR_ENV]: empty, JULIUS_REAL_POSTGRES: '1', JULIUS_TEST_DATABASE_URL: databaseUrl! },
    });
    rmSync(empty, { recursive: true, force: true });
    expect(child.status, 'the demanded suite failed').not.toBe(0);
    expect(`${child.stdout}${child.stderr}`).toContain(`julius_real_postgres_without_pg_client: JULIUS_REAL_POSTGRES=1 demands this suite, and no pg_dump/pg_restore/psql of the server's major (${String(serverMajor)}) was found`);
  }, 300_000);

  it('7a(2): a store that cannot encode the mission\'s text refuses the restore, and nothing remains behind', async () => {
    const { digest } = pair();
    const latin1 = await database('latin1', 'LATIN1');
    expect((await admin.query<{ encoding: string }>('SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = $1', [latin1.name])).rows[0]?.encoding,
      'the target really cannot hold UTF-8 text').toBe('LATIN1');
    const dumpFile = join(scratch, 'store', 'julius.pgdump');
    // A missing file would fail too, and prove nothing: the restore must fail on the TEXT, with the real dump in hand.
    expect(existsSync(dumpFile), 'the main case wrote the dump this case restores').toBe(true);
    const result = store(['restore', dumpFile, `run:${'0'.repeat(24)}`, digest], latin1.name);
    expect(result.status).not.toBe(0);
    expect(result.out, 'refused for the encoding, not for anything else').toContain('has no equivalent in encoding "LATIN1"');
    const left = await latin1.pool.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'relay_wonderland'");
    expect(left.rowCount, 'one transaction: the schema the restore began is gone with it').toBe(0);
  }, 300_000);
});
