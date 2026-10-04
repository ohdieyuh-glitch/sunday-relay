import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptedAdapter } from '../src/relay/mission/julius';
import { juliusCarryEntryId, selectJuliusCarry } from '../src/relay/mission/julius/julius-carry';
import { juliusFindingTransitionFacts, type JuliusFindingMove } from '../src/relay/mission/julius/julius-finding-lifecycle';
import { JuliusCarryPostgresRepository } from '../src/relay/persistence/julius-carry-postgres';
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
import { JuliusEventPostgresRepository } from '../src/relay/persistence/julius-event-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { missionWorkerRequests } from './julius-mission-routes';
import { createLiveJuliusBootstrapPort } from './julius/bootstrap';
import { decideJuliusCarrySource } from './julius/carry-archive';
import { architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, reviewerWorker } from './julius/live-composition';
import { compileBootstrapRequest, parseLiveMissionContract } from './julius/mission-contract';
import { createArchivedMissionKnowledgeStore } from './julius/mission-knowledge';
import { createPostgresMissionSeedStore } from './julius/mission-seed';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * DECISION C ACROSS TWO DATABASES — THE PAID VENUE, ON REAL POSTGRESQL.
 *
 * A paid job's database is fresh and dies with the runner, so a WITH arm and
 * its WITHOUT arm never share one. This suite gives each its own database and
 * lets nothing cross between them except what the paid workflow carries: the
 * WITHOUT arm's `carry-export.json`, produced by the dump's OWN query file
 * (`.github/julius-carry-export.sql`), its bundle manifest, and GitHub's record
 * of the run. Then the four points, each read back from a database:
 *
 *   1. WITHOUT wrote it      — the findings and their lives, in the WITHOUT database;
 *   2. eligibility chose it  — the selection from the bundle is the selection the
 *                              WITHOUT database's own store would have made, item for
 *                              item, and the WITH arm's manifest event names the bundle;
 *   3. WITH restored it      — the carried row, in the WITH database, which never held
 *                              the WITHOUT run at all;
 *   4. the planner got it    — the WITH run's own `context.compiled` for its plan task.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const EXPORT_SQL = readFileSync(join(__dirname, '..', '.github', 'julius-carry-export.sql'), 'utf8');
const CARD = 'card:carry-archive:1';
const COMMIT = 'a'.repeat(40);
const WORKFLOW_RUN = '37300000001';
const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

const PLAN = [{ type: 'ARTIFACT' as const, status: 'PASSED' as const, safeSummary: 'Plan written.' }];
const BUILD = [
  { type: 'TEST' as const, status: 'PASSED' as const, safeSummary: 'Suite green.' },
  { type: 'DIFF' as const, status: 'PASSED' as const, safeSummary: 'The change set.' },
];
const REVIEW = [{ type: 'REVIEW_FINDING' as const, status: 'PASSED' as const, safeSummary: 'No blocking findings.' }];

suite('Decision C across two databases: a WITH arm learns from its pair\'s bundle alone', () => {
  const nonce = randomBytes(4).toString('hex');
  const projectId = `prj-c-${nonce}`;
  const withoutRun = `run:c-without-${nonce}`;
  const repaired = `f-repaired-${nonce}`;
  let admin: Pool;
  let without: Pool;
  let withDb: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];
  const roots: string[] = [];

  const database = async (label: string): Promise<Pool> => {
    const name = `carry${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 8 });
    made.push({ name, pool });
    await new TransactionalWonderlandDatabase(pool).migrate();
    return pool;
  };

  /** The dump's own query file, run as psql runs it: the one psql variable bound, the document read as the server wrote it. */
  const exportOf = async (pool: Pool, runId: string): Promise<string> => {
    const sql = EXPORT_SQL.replace(":'run'", '$1');
    expect(sql.includes(":'run'"), 'the query binds its run in exactly one place').toBe(false);
    const result = await pool.query({ text: sql, values: [runId], types: { getTypeParser: () => (value: string) => value } });
    expect(result.rows).toHaveLength(1);
    return `${String(Object.values(result.rows[0] as Record<string, unknown>)[0])}\n`;
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl!, max: 2 });
    without = await database('wo');
    withDb = await database('wi');

    // POINT 1, IN THE WITHOUT ARM'S OWN DATABASE: a review raised three findings;
    // one was repaired and then resolved by the re-review, one only repaired, one left open.
    await without.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [projectId]);
    await without.query(
      `INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$1,'{}')`,
      [`mission:${withoutRun}`, projectId]);
    await without.query(
      `INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision)
       VALUES($1,$2,$3,'COMPLETED','1','card',1,0)`, [withoutRun, `mission:${withoutRun}`, projectId]);
    const tasks: Array<[string, string, string]> = [
      ['plan', 'PROMPT_ARCHITECT', 'plan'], ['build', 'CODING_AGENT', 'build'], ['review', 'INDEPENDENT_REVIEWER', 'review:build'],
      ['repair-1', 'CODING_AGENT', 'repair:build'], ['review:repair-1', 'INDEPENDENT_REVIEWER', 'review:repair:build'],
    ];
    for (const [ordinal, [suffix, role, type]] of tasks.entries()) {
      await without.query(
        "INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,parent_task_id,role,task_type,state,ordinal,required_evidence_types) VALUES($1,$2,NULL,$3,$4,'SUCCEEDED',$5,'[]'::jsonb)",
        [`${withoutRun}:${suffix}`, withoutRun, role, type, ordinal]);
    }
    const finding = (findingId: string, createdAt: string, claim: string) => without.query(
      `INSERT INTO relay_wonderland.julius_reviewer_findings(finding_id,run_id,task_id,reviewer_worker_id,severity,category,claim,criterion_id,evidence_ids,blocking,status,created_at,updated_at)
       VALUES($1,$2,$3,'reviewer-hermes','HIGH','correctness',$4,NULL,'["evidence:review-1"]'::jsonb,true,'OPEN',$5,$5)`,
      [findingId, withoutRun, `${withoutRun}:build`, claim, createdAt]);
    // Sub-second instants on purpose: the store reader keeps whole seconds, and the export must agree with it.
    await finding(repaired, '2026-10-04T10:01:00.789Z',
      'The save-file loader must reject a big-endian header.\tIt silently byte-swapped it,\nso a corrupt save loaded as a valid one.');
    await finding(`f-addressed-${nonce}`, '2026-10-04T10:01:01.250Z', 'The save-file writer leaves a temp file behind on failure.');
    await finding(`f-open-${nonce}`, '2026-10-04T10:01:02.001Z', 'The save-file format comparison omits load time.');
    const events = new JuliusEventPostgresRepository(without);
    let sequence = 0;
    const event = async (type: 'finding.recorded' | 'finding.transitioned', taskSuffix: string, facts: Record<string, string | number | boolean | null>) => {
      sequence += 1;
      await events.append({
        eventId: `carry-archive:${nonce}:${String(sequence)}`, runId: withoutRun, projectId, type, taskId: `${withoutRun}:${taskSuffix}`,
        workerId: null, correlationId: withoutRun, causationId: null, occurredAt: `2026-10-04T10:${String(10 + sequence)}:00.000Z`, facts,
      });
    };
    const move = (findingId: string, mv: JuliusFindingMove, task: string, ids: { review?: string; repair?: string }) =>
      event('finding.transitioned', task, juliusFindingTransitionFacts({
        findingId, move: mv, at: '2026-10-04T10:40:00.000Z', reviewTaskId: ids.review ?? null, repairTaskId: ids.repair ?? null,
      }));
    for (const findingId of [repaired, `f-addressed-${nonce}`, `f-open-${nonce}`]) {
      await event('finding.recorded', 'review', { findingId, evidenceId: 'evidence:review-1', blocking: true, category: 'correctness', reviewTaskId: `${withoutRun}:review` });
    }
    await move(repaired, 'REPAIR_SUCCEEDED', 'repair-1', { repair: `${withoutRun}:repair-1` });
    await move(`f-addressed-${nonce}`, 'REPAIR_SUCCEEDED', 'repair-1', { repair: `${withoutRun}:repair-1` });
    await move(repaired, 'REVIEWER_RESOLVED', 'review:repair-1', { review: `${withoutRun}:review:repair-1` });
  });

  afterAll(async () => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    for (const { name, pool } of made) {
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await admin?.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end();
  });

  /** The receiving checkout's two missions, and the directory the fetch step fills from the WITHOUT run's bundle. */
  const checkout = (exportText: string) => {
    const root = mkdtempSync(join(tmpdir(), 'carry-archive-pg-'));
    roots.push(root);
    const contract = (name: string, fields: Record<string, unknown>) => {
      const dir = join(root, '.github', 'julius-missions', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'contract.json'), JSON.stringify({
        missionId: `mission:${name}-${nonce}`, markerNamespace: `c-${nonce}`, projectId, tenantId: `tenant-c-${nonce}`,
        objective: 'Write a comparison of the three candidate save-file formats.',
        requirements: ['Compare size, load time and forward compatibility.'],
        constraints: ['Touch only docs/.'],
        acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
        testCommand: '', workspacePath: '/workspace/c', limits: { spendUsd: 2, repairCycles: 1 }, ...fields,
      }, null, 2));
      return join(dir, 'contract.json');
    };
    const withoutPath = contract('julius-c-without-1', { carryArm: 'WITHOUT' });
    const withPath = contract('julius-c-with-1', { carryArm: 'WITH', carryFrom: 'julius-c-without-1' });
    const bundle = join(root, 'carry-source');
    mkdirSync(bundle);
    const manifest = [
      'manifest_version=1', 'source=github-actions', `commit=${COMMIT}`, `tree=${'b'.repeat(40)}`, 'tracked_changes=0', 'mode=paid',
      'mode_basis=dispatch_confirm_live', `julius_run_id=${withoutRun}`, `workflow_run_id=${WORKFLOW_RUN}`, 'workflow_run_attempt=1',
      'workflow_ref=o/r/.github/workflows/julius-first-live-mission.yml@refs/heads/main', 'event=workflow_dispatch',
      'ref=refs/heads/main', `github_sha=${COMMIT}`, 'mission=julius-c-without-1', `contract_sha256=${sha256(readFileSync(withoutPath))}`,
      'produced_at=2026-10-04T11:00:00Z', `carry_export_sha256=${sha256(exportText)}`,
    ];
    writeFileSync(join(bundle, 'bundle-manifest.txt'), `${manifest.join('\n')}\n`);
    writeFileSync(join(bundle, 'carry-export.json'), exportText);
    writeFileSync(join(bundle, 'source-run.json'), JSON.stringify({
      id: WORKFLOW_RUN, path: '.github/workflows/julius-first-live-mission.yml', event: 'workflow_dispatch', headSha: COMMIT,
      displayTitle: `julius mission=julius-c-without-1 lane=lab mode=paid key=julius-c-without-1@aaaaaaaaaaaa#lab#a1`,
      runAttempt: '1', artifactDigest: `sha256:${'d'.repeat(64)}`, archiveSha256: 'd'.repeat(64),
    }));
    const parsed = parseLiveMissionContract(readFileSync(withPath, 'utf8'));
    if (!parsed.ok) throw new Error(parsed.problem);
    return { withPath, bundle, contract: parsed.contract };
  };

  it('point 2: the bundle the dump writes selects exactly what the WITHOUT arm\'s own store would have, finding for finding', async () => {
    const exportText = await exportOf(without, withoutRun);
    const target = `run:c-with-${nonce}`;
    const fromStore = selectJuliusCarry({
      targetRunId: target,
      sources: await new JuliusCarryPostgresRepository(without).carrySources({ projectId, excludeRunId: target }),
      claims: [],
    });
    const { withPath, bundle, contract } = checkout(exportText);
    const decision = decideJuliusCarrySource({
      contractPath: withPath, contract, bundleDir: bundle, workflowRunId: WORKFLOW_RUN, commit: COMMIT, requireArchiveForWith: true,
    });
    expect(decision.kind, JSON.stringify(decision.lines)).toBe('ARCHIVE');
    if (decision.kind !== 'ARCHIVE') return;
    const fromBundle = selectJuliusCarry({ targetRunId: target, sources: [decision.verdict.source], claims: [] });
    expect(fromBundle, 'the archive is a transport, never a second policy').toEqual(fromStore);
    expect(fromBundle.selected.map((item) => item.entryId)).toEqual([juliusCarryEntryId(withoutRun, `finding:${repaired}`)]);
    expect(fromBundle.excluded.map((item) => item.reasonCode).sort()).toEqual(['FINDING_ADDRESSED_NOT_VERIFIED', 'FINDING_UNRESOLVED']);
    // The claim's tab and line break survived the trip: the export is JSON, never a TSV row.
    expect(decision.verdict.source.findings.find((item) => item.findingId === repaired)!.claim).toContain('header.\tIt silently byte-swapped it,\nso');
  });

  it('a run the bundle does not name exports no run, and the verifier refuses it', async () => {
    const exportText = await exportOf(without, 'run:never-existed');
    expect(JSON.parse(exportText)).toEqual({ format: 'julius-carry-export.v1', runId: null, projectId: null, findings: [], ledger: [] });
    const { withPath, bundle, contract } = checkout(exportText);
    expect(decideJuliusCarrySource({
      contractPath: withPath, contract, bundleDir: bundle, workflowRunId: WORKFLOW_RUN, commit: COMMIT, requireArchiveForWith: true,
    })).toMatchObject({ kind: 'REFUSED', reasonCode: 'CARRY_SOURCE_EXPORT_MALFORMED' });
  });

  it('points 3 and 4: the WITH arm, on a database that never held its pair, restores the repaired finding and hands it to its planner', async () => {
    const { withPath, bundle, contract } = checkout(await exportOf(without, withoutRun));
    const decision = decideJuliusCarrySource({
      contractPath: withPath, contract, bundleDir: bundle, workflowRunId: WORKFLOW_RUN, commit: COMMIT, requireArchiveForWith: true,
    });
    if (decision.kind !== 'ARCHIVE') throw new Error(decision.lines.join('\n'));
    const runs = new JuliusPostgresRepository(withDb);
    const contracts = new JuliusContractPostgresRepository(withDb);
    const port = createLiveJuliusBootstrapPort({
      runs: {
        loadRun: runs.loadRun.bind(runs), createRun: runs.createRun.bind(runs), addTask: runs.addTask.bind(runs),
        transition: runs.transition.bind(runs), putTaskContract: contracts.putTaskContract.bind(contracts),
      },
      seeds: createPostgresMissionSeedStore(withDb),
      knowledge: createArchivedMissionKnowledgeStore({ pool: withDb, archive: { source: decision.verdict.source, origin: decision.verdict.origin } }),
      tenantId: contract.tenantId,
      executionId: `exec-c-${nonce}`,
    });
    const submitted = await port.submit(compileBootstrapRequest(contract, missionWorkerRequests('xai'), CARD));
    expect(submitted.accepted, JSON.stringify(submitted)).toBe(true);
    if (!submitted.accepted) return;
    const runId = submitted.runId;

    // THE WITH DATABASE NEVER HELD THE WITHOUT RUN: what it knows came from the bundle alone.
    expect((await withDb.query('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id = $1', [withoutRun])).rowCount).toBe(0);
    expect((await withDb.query('SELECT 1 FROM relay_wonderland.julius_reviewer_findings WHERE run_id = $1', [withoutRun])).rowCount).toBe(0);

    // POINT 3: the carried row, authored by the reviewer who raised it, run-wide in the WITH run.
    const carriedId = juliusCarryEntryId(withoutRun, `finding:${repaired}`);
    const rows = await withDb.query<{ entry_id: string; worker_id: string; task_id: string | null; safe_content: string }>(
      "SELECT entry_id, worker_id, task_id, safe_content FROM relay_wonderland.julius_brain_entries WHERE run_id = $1 AND entry_id LIKE 'carried:%'", [runId]);
    expect(rows.rows.map((row) => row.entry_id)).toEqual([carriedId]);
    expect(rows.rows[0]).toMatchObject({ worker_id: 'reviewer-hermes', task_id: null });
    expect(rows.rows[0]!.safe_content).toContain(`Source: run ${withoutRun}, about task ${withoutRun}:build; raised by review ${withoutRun}:review, repaired by ${withoutRun}:repair-1; resolved by review ${withoutRun}:review:repair-1.`);

    // POINT 2, ON THE WITH ARM'S OWN LEDGER: the manifest names the bundle it learned from.
    const manifest = await withDb.query<{ payload: { facts: Record<string, unknown> } }>(
      "SELECT payload FROM relay_wonderland.events WHERE stream_id = $1 AND event_type = 'julius.knowledge.carried'", [runId]);
    expect(manifest.rows).toHaveLength(1);
    expect(manifest.rows[0]!.payload.facts).toMatchObject({
      version: 'julius-carry.v2', arm: 'WITH', selected: 1, verifiedRepairFindings: 1, written: 1, selectedEntryIds: carriedId,
      origin: 'ARCHIVE', sourceRunId: withoutRun, sourceProjectId: projectId, sourceMission: 'julius-c-without-1',
      sourceWorkflowRunId: WORKFLOW_RUN, sourceWorkflowRunAttempt: '1', sourceCommit: COMMIT,
      sourceExportSha256: decision.verdict.origin.exportSha256, sourceArchiveSha256: 'd'.repeat(64),
    });
    expect(String(manifest.rows[0]!.payload.facts.excludedByCode)).toBe('FINDING_ADDRESSED_NOT_VERIFIED=1 FINDING_UNRESOLVED=1');

    // POINT 4: drive the WITH run until its planner's packet is compiled, and read what the compile recorded.
    const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: PLAN, usdMicros: null }]);
    const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: BUILD, usdMicros: 1_000 }]);
    const reviewer = scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: REVIEW, usdMicros: null }]);
    const runtime = assembleLiveJuliusRuntime({
      store: createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(withDb)).store,
      entries: [
        { worker: architectWorker({}), adapter: architect },
        { worker: CODER_WORKER, adapter: coder },
        { worker: reviewerWorker('hermes'), adapter: reviewer },
      ],
      cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1, owner: 'carry-archive',
    });
    const planTask = (await withDb.query<{ task_id: string }>(
      "SELECT task_id FROM relay_wonderland.julius_tasks WHERE run_id = $1 AND task_type = 'plan'", [runId])).rows[0]!.task_id;
    const planCompiles = async () => (await withDb.query<{ payload: { taskId?: string; facts: Record<string, unknown> } }>(
      "SELECT payload FROM relay_wonderland.events WHERE stream_id = $1 AND event_type = 'julius.context.compiled' ORDER BY sequence", [runId]))
      .rows.filter((row) => row.payload.taskId === planTask);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && (await planCompiles()).length === 0) {
      const report = await runtime.loop.tick({ projectId });
      if (report.claimed === 0) await runtime.loop.advanceRun(runId, projectId);
    }
    const compiled = await planCompiles();
    expect(compiled.length, 'the planner\'s packet was compiled on the WITH run\'s ledger').toBeGreaterThan(0);
    expect(compiled.at(-1)!.payload.facts).toMatchObject({ carriedReceived: 1, carriedReceivedIds: carriedId });
    expect(architect.dispatches.length, 'and the planner was dispatched with it').toBeGreaterThan(0);

    // AND ALL OF IT IS READABLE FROM THE WITH ARM'S BUNDLE, after its database is gone: the dump's own
    // `carry.tsv` query, run against this database, holds the manifest (point 2) and the plan task's
    // receipt (point 4) as tokens.
    const dumpLine = readFileSync(join(__dirname, '..', '.github', 'julius-live-evidence-dump.sh'), 'utf8')
      .split('\n').find((line) => line.startsWith('dump "SELECT') && line.endsWith('" carry.tsv'))!;
    const carryQuery = dumpLine.slice('dump "'.length, -'" carry.tsv'.length);
    const tsv = (await withDb.query<Record<string, string | null>>(carryQuery)).rows.filter((row) => row.run_id === runId);
    const manifestRow = tsv.find((row) => row.event_type === 'julius.knowledge.carried');
    expect(manifestRow).toMatchObject({
      arm: 'WITH', origin: 'ARCHIVE', selected: '1', verified_repair_findings: '1', selected_entry_ids: carriedId,
      source_run_id: withoutRun, source_mission: 'julius-c-without-1', source_workflow_run_id: WORKFLOW_RUN,
      source_commit: COMMIT, source_export_sha256: decision.verdict.origin.exportSha256,
    });
    expect(tsv.find((row) => row.event_type === 'julius.context.compiled' && row.task_id === planTask))
      .toMatchObject({ carried_received: '1', carried_received_ids: carriedId });
    expect(tsv.every((row) => Object.values(row).every((value) => value === null || !/[\t\n]/u.test(String(value)))), 'one TSV row per event').toBe(true);
  }, 90_000);
});
