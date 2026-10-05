import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptedAdapter, type ScriptedOutcome } from '../src/relay/mission/julius';
import { juliusCarryEntryId, selectJuliusCarry } from '../src/relay/mission/julius/julius-carry';
import { foldJuliusFindings } from '../src/relay/mission/julius/julius-finding-lifecycle';
import { JuliusCarryPostgresRepository } from '../src/relay/persistence/julius-carry-postgres';
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { missionWorkerRequests } from './julius-mission-routes';
import { createLiveJuliusBootstrapPort } from './julius/bootstrap';
import { decideJuliusCarrySource } from './julius/carry-archive';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { compileBootstrapRequest, parseLiveMissionContract, type LiveMissionContractFile } from './julius/mission-contract';
import { createArchivedMissionKnowledgeStore, createPostgresMissionKnowledgeStore, type MissionKnowledgeStore } from './julius/mission-knowledge';
import { createPostgresMissionSeedStore } from './julius/mission-seed';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * DECISION C, DRESS REHEARSAL: BOTH ARMS ARE REAL RUNS, ON TWO DATABASES, AND NOTHING IS PAID.
 *
 * `julius-carry-archive.real-postgres.test.ts` proves the transport on findings
 * written by hand. This proves it on findings the PIPELINE wrote: the WITHOUT
 * arm is bootstrapped from a `carryArm: "WITHOUT"` contract through the real
 * bootstrap port and driven through the live composition, with scripted
 * providers. Its reviewer rejects the build once, a repair runs, and the
 * re-review answers the finding from its own compiled packet. Whatever shape
 * the runtime actually gives that finding's life is what the export reads, so a
 * drift between the carry's expectations and the runtime's ledger fails here
 * rather than on a paid WITH arm.
 *
 * Then the WITH arm, from a `carryArm: "WITH", "carryFrom": ...` contract, is
 * bootstrapped on a SECOND database from the WITHOUT run's export alone (the
 * dump's own query file, bundled and verified exactly as the paid job verifies
 * it), and driven to its end. The four points, each read from a database:
 *
 *   1. WITHOUT wrote it      — a finding raised by its reviewer, repaired, resolved by the re-review;
 *   2. eligibility chose it  — the bundle selects what the WITHOUT store selects, and the WITH
 *                              manifest names the bundle;
 *   3. WITH restored it      — the carried row in the WITH database;
 *   4. the planner got it    — the WITH plan task's `context.compiled` holds it.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const EXPORT_SQL = readFileSync(join(__dirname, '..', '.github', 'julius-carry-export.sql'), 'utf8');
/** The bundle's own `review-warnings.tsv` query, read from the dump script exactly as the paid job runs it. */
const REVIEW_WARNINGS_SQL = (/^dump "(SELECT [^"]+)" review-warnings\.tsv$/mu
  .exec(readFileSync(join(__dirname, '..', '.github', 'julius-live-evidence-dump.sh'), 'utf8'))?.[1]) ?? '';
const CARD = 'card:c-rehearsal:1';
const COMMIT = 'c'.repeat(40);
const WORKFLOW_RUN = '37300000042';
const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

const PLAN_OK: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }], usdMicros: null };
const BUILD_OK: ScriptedOutcome = {
  kind: 'succeed', usdMicros: 1_000,
  evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }, { type: 'DIFF', status: 'PASSED', safeSummary: 'The change set.' }],
};
const REVIEW_ACCEPT: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'Independent review approved the change.' }], usdMicros: null };
const REVIEW_REJECT: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The save-file loader accepts a big-endian header it then mis-reads.' }], usdMicros: null };
const REVIEW_ACCEPT_ANSWERING: ScriptedOutcome = { ...REVIEW_ACCEPT, answerFindings: 'RESOLVED' };
/** A plan review that accepts with ONE concern of a named kind: what a real reviewer's minor finding becomes once it says its kind. */
const PLAN_WARNED: ScriptedOutcome = {
  ...REVIEW_ACCEPT,
  reviewVerdict: {
    verdict: 'WARNING', claim: 'The plan is acceptable with one concern.',
    warnings: [{ category: 'contract_drift', claim: 'The test plan names ESM where the mission requires CommonJS.' }],
  },
};

suite('Decision C dress rehearsal: a real WITHOUT run teaches a real WITH run, across two databases', () => {
  const nonce = randomBytes(4).toString('hex');
  const projectId = `prj-c-rehearsal-${nonce}`;
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];
  const roots: string[] = [];

  const database = async (label: string): Promise<Pool> => {
    const name = `crehearse${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 8 });
    pool.on('error', () => undefined);
    made.push({ name, pool });
    await new TransactionalWonderlandDatabase(pool).migrate();
    return pool;
  };

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl!, max: 2 }); }, 30_000);
  afterAll(async () => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    for (const { name, pool } of made) {
      await pool.end().catch(() => undefined);
      await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    }
    await admin?.end();
  }, 120_000);

  /** One mission, bootstrapped through the real port and driven through the live composition on `pool`. */
  const runMission = async (input: {
    readonly pool: Pool;
    readonly contract: LiveMissionContractFile;
    readonly knowledge: MissionKnowledgeStore;
    readonly reviews: readonly ScriptedOutcome[];
  }) => {
    // As the live entrypoint composes it: the contract's promotion policy, when it declares one.
    const promotion = input.contract.promotedWarningCategories === undefined ? {} : { promotedWarningCategories: input.contract.promotedWarningCategories };
    const runs = new JuliusPostgresRepository(input.pool);
    const contracts = new JuliusContractPostgresRepository(input.pool);
    const port = createLiveJuliusBootstrapPort({
      runs: {
        loadRun: runs.loadRun.bind(runs), createRun: runs.createRun.bind(runs), addTask: runs.addTask.bind(runs),
        transition: runs.transition.bind(runs), putTaskContract: contracts.putTaskContract.bind(contracts),
      },
      seeds: createPostgresMissionSeedStore(input.pool),
      knowledge: input.knowledge,
      tenantId: input.contract.tenantId,
      executionId: `exec-${input.contract.missionId}`,
    });
    const submitted = await port.submit(compileBootstrapRequest(input.contract, missionWorkerRequests('xai'), CARD));
    if (!submitted.accepted) throw new Error(`bootstrap refused: ${submitted.reasonCode} ${submitted.safeMessage}`);
    const handoffs = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(input.pool));
    const packetFor = (dispatch: { readonly contextId: string }): string | null => {
      const snapshot = handoffs.contexts.snapshotFor(dispatch.contextId);
      return snapshot === null ? null : snapshot.packet.blocks.map((block) => block.text).join('\n');
    };
    const runtime = assembleLiveJuliusRuntime({
      store: handoffs.store,
      entries: [
        { worker: architectWorker({}), adapter: scriptedAdapter(architectWorker({}), [PLAN_OK]) },
        { worker: CODER_WORKER, adapter: scriptedAdapter(CODER_WORKER, [BUILD_OK]) },
        { worker: reviewerWorker('hermes'), adapter: scriptedAdapter(reviewerWorker('hermes'), input.reviews, { packetFor }) },
      ],
      cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 2, owner: `c-rehearsal-${input.contract.missionId}`,
      ...promotion,
    });
    const outcome = await driveJuliusRunToTerminal({ loop: runtime.loop, store: handoffs.store, runId: submitted.runId, projectId, maxTicks: 40 });
    return { runId: submitted.runId, outcome };
  };

  /** The checkout: the pair's two contracts side by side, as `.github/julius-missions/` holds them. */
  const checkout = (withoutFields: Record<string, unknown> = {}): { root: string; withoutPath: string; withPath: string } => {
    const root = mkdtempSync(join(tmpdir(), 'c-rehearsal-'));
    roots.push(root);
    const write = (name: string, fields: Record<string, unknown>): string => {
      const dir = join(root, '.github', 'julius-missions', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'contract.json'), JSON.stringify({
        missionId: `mission:${name}-${nonce}`, markerNamespace: `${name.replace(/^julius-/u, '')}-${nonce}`, projectId, tenantId: `tenant-${nonce}`,
        objective: 'Make the save-file loader refuse a header whose byte order it cannot read.',
        requirements: ['A big-endian header is refused with a clear error.'],
        constraints: ['Touch only src/save/.'],
        acceptanceCriteria: [{ id: 'AC-1', text: 'The loader refuses what it cannot read.', blocking: true }],
        testCommand: '', workspacePath: '/workspace/c-rehearsal', limits: { spendUsd: 2, repairCycles: 2 }, ...fields,
      }, null, 2));
      return join(dir, 'contract.json');
    };
    return {
      root,
      withoutPath: write('julius-c-without-1', { carryArm: 'WITHOUT', ...withoutFields }),
      withPath: write('julius-c-with-1', { carryArm: 'WITH', carryFrom: 'julius-c-without-1' }),
    };
  };
  const parse = (path: string): LiveMissionContractFile => {
    const parsed = parseLiveMissionContract(readFileSync(path, 'utf8'));
    if (!parsed.ok) throw new Error(parsed.problem);
    return parsed.contract;
  };

  /** The WITHOUT run's bundle, exactly what the paid job would carry: the export, a manifest naming it, and the run record. */
  const bundleOf = async (without: Pool, withoutRunId: string, paths: { readonly root: string; readonly withoutPath: string }) => {
    const exported = await without.query({
      text: EXPORT_SQL.replace(":'run'", '$1'), values: [withoutRunId], types: { getTypeParser: () => (value: string) => value },
    });
    const exportText = `${String(Object.values(exported.rows[0] as Record<string, unknown>)[0])}\n`;
    const bundle = join(paths.root, 'carry-source');
    mkdirSync(bundle);
    writeFileSync(join(bundle, 'carry-export.json'), exportText);
    writeFileSync(join(bundle, 'bundle-manifest.txt'), `${[
      'manifest_version=1', 'source=github-actions', `commit=${COMMIT}`, `tree=${'d'.repeat(40)}`, 'tracked_changes=0', 'mode=paid',
      'mode_basis=dispatch_confirm_live', `julius_run_id=${withoutRunId}`, `workflow_run_id=${WORKFLOW_RUN}`, 'workflow_run_attempt=1',
      'workflow_ref=o/r/.github/workflows/julius-first-live-mission.yml@refs/heads/main', 'event=workflow_dispatch', 'ref=refs/heads/main',
      `github_sha=${COMMIT}`, 'mission=julius-c-without-1', `contract_sha256=${sha256(readFileSync(paths.withoutPath))}`,
      'produced_at=2026-10-04T23:00:00Z', `carry_export_sha256=${sha256(exportText)}`,
    ].join('\n')}\n`);
    writeFileSync(join(bundle, 'source-run.json'), JSON.stringify({
      id: WORKFLOW_RUN, path: '.github/workflows/julius-first-live-mission.yml', event: 'workflow_dispatch', headSha: COMMIT,
      displayTitle: 'julius mission=julius-c-without-1 lane=lab mode=paid key=julius-c-without-1@cccccccccccc#lab#a1',
      runAttempt: '1', artifactDigest: `sha256:${'e'.repeat(64)}`, archiveSha256: 'e'.repeat(64),
    }));
    return { bundle, exportText };
  };

  it('a reviewer\'s repaired, resolved finding in the WITHOUT run reaches the WITH run\'s planner, and every point is on a database', async () => {
    const without = await database('wo');
    const withDb = await database('wi');
    const paths = checkout();

    /* ------------------------------------------------ the WITHOUT arm, a real run on its own database */
    const withoutRun = await runMission({
      pool: without, contract: parse(paths.withoutPath), knowledge: createPostgresMissionKnowledgeStore(without),
      // plan review accepts; the build review REJECTS; the repair's re-review answers the finding; anything after accepts.
      reviews: [REVIEW_ACCEPT, REVIEW_REJECT, REVIEW_ACCEPT_ANSWERING, REVIEW_ACCEPT],
    });
    expect(withoutRun.outcome, `the WITHOUT arm completes through its repair (halt: ${withoutRun.outcome.haltCause ?? 'none'})`)
      .toMatchObject({ state: 'COMPLETED', stalled: false });

    // POINT 1, as the runtime wrote it: a finding its reviewer raised, a repair addressed, and a re-review resolved.
    const carry = new JuliusCarryPostgresRepository(without);
    const sources = await carry.carrySources({ projectId, excludeRunId: 'none' });
    const source = sources.find((item) => item.runId === withoutRun.runId);
    expect(source, 'the WITHOUT run holds reviewer findings').toBeDefined();
    const lives = foldJuliusFindings(source!.findings, source!.ledger);
    const resolved = lives.filter((life) => life.state === 'RESOLVED' && life.repairTaskIds.length > 0 && life.lastMove === 'REVIEWER_RESOLVED');
    expect(resolved.length, JSON.stringify(lives, null, 2)).toBeGreaterThan(0);
    // A WITHOUT arm inherits nothing, and says so on its own ledger.
    const withoutManifest = await without.query<{ payload: { facts: Record<string, unknown> } }>(
      "SELECT payload FROM relay_wonderland.events WHERE stream_id = $1 AND event_type = 'julius.knowledge.carried'", [withoutRun.runId]);
    expect(withoutManifest.rows.map((row) => row.payload.facts)).toEqual([expect.objectContaining({ arm: 'WITHOUT', selected: 0, origin: 'STORE' })]);

    /* ------------------------------------------- the bundle, exactly what the paid job would carry */
    const { bundle, exportText } = await bundleOf(without, withoutRun.runId, paths);
    const withContract = parse(paths.withPath);
    const decision = decideJuliusCarrySource({
      contractPath: paths.withPath, contract: withContract, bundleDir: bundle, workflowRunId: WORKFLOW_RUN, commit: COMMIT, requireArchiveForWith: true,
    });
    expect(decision.kind, decision.lines.join('\n')).toBe('ARCHIVE');
    if (decision.kind !== 'ARCHIVE') return;

    // POINT 2: the bundle selects, item for item, what the WITHOUT database's own store selects.
    const fromStore = selectJuliusCarry({ targetRunId: 'run:not-yet', sources: [source!], claims: [] });
    const fromBundle = selectJuliusCarry({ targetRunId: 'run:not-yet', sources: [decision.verdict.source], claims: [] });
    expect(fromBundle).toEqual(fromStore);
    expect(fromBundle.counts.VERIFIED_REPAIR_FINDING).toBeGreaterThan(0);
    const carriedIds = fromBundle.selected.map((item) => item.entryId);
    expect(carriedIds).toContain(juliusCarryEntryId(withoutRun.runId, `finding:${resolved[0]!.findingId}`));

    /* ---------------------------- the WITH arm, a real run on a database that never held its pair */
    const withRun = await runMission({
      pool: withDb, contract: withContract,
      knowledge: createArchivedMissionKnowledgeStore({ pool: withDb, archive: { source: decision.verdict.source, origin: decision.verdict.origin } }),
      reviews: [REVIEW_ACCEPT],
    });
    expect(withRun.outcome, `the WITH arm completes (halt: ${withRun.outcome.haltCause ?? 'none'})`).toMatchObject({ state: 'COMPLETED', stalled: false });
    expect((await withDb.query('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id = $1', [withoutRun.runId])).rowCount).toBe(0);

    // POINT 2 on the WITH ledger, and POINT 3.
    const withManifest = await withDb.query<{ payload: { facts: Record<string, unknown> } }>(
      "SELECT payload FROM relay_wonderland.events WHERE stream_id = $1 AND event_type = 'julius.knowledge.carried'", [withRun.runId]);
    expect(withManifest.rows).toHaveLength(1);
    expect(withManifest.rows[0]!.payload.facts).toMatchObject({
      arm: 'WITH', origin: 'ARCHIVE', sourceRunId: withoutRun.runId, sourceWorkflowRunId: WORKFLOW_RUN,
      sourceExportSha256: sha256(exportText), selected: carriedIds.length, written: carriedIds.length,
    });
    const restored = await withDb.query<{ entry_id: string; worker_id: string; task_id: string | null }>(
      "SELECT entry_id, worker_id, task_id FROM relay_wonderland.julius_brain_entries WHERE run_id = $1 AND entry_id LIKE 'carried:%' ORDER BY entry_id",
      [withRun.runId]);
    expect(restored.rows.map((row) => row.entry_id)).toEqual([...carriedIds].sort());
    expect(restored.rows.every((row) => row.task_id === null)).toBe(true);
    const reviewerOf = new Map(source!.findings.map((finding) => [finding.findingId, finding.reviewerWorkerId]));
    expect(restored.rows[0]!.worker_id, 'the copy is the reviewer\'s, as raised').toBe(reviewerOf.get(resolved[0]!.findingId));

    // POINT 4: the WITH planner's own compile names what it was handed.
    const planTask = (await withDb.query<{ task_id: string }>(
      "SELECT task_id FROM relay_wonderland.julius_tasks WHERE run_id = $1 AND task_type = 'plan'", [withRun.runId])).rows[0]!.task_id;
    const compiled = (await withDb.query<{ payload: { taskId?: string; facts: Record<string, unknown> } }>(
      "SELECT payload FROM relay_wonderland.events WHERE stream_id = $1 AND event_type = 'julius.context.compiled' ORDER BY sequence", [withRun.runId]))
      .rows.filter((row) => row.payload.taskId === planTask);
    expect(compiled.length).toBeGreaterThan(0);
    const received = String(compiled.at(-1)!.payload.facts.carriedReceivedIds ?? '').split(' ').filter((id) => id !== '');
    expect(Number(compiled.at(-1)!.payload.facts.carriedReceived)).toBeGreaterThan(0);
    expect(received).toContain(juliusCarryEntryId(withoutRun.runId, `finding:${resolved[0]!.findingId}`));
  }, 120_000);

  /**
   * DECISION C, OPTION B: THE SAME KIND OF WITHOUT ARM M2 WAS, MADE TO TEACH.
   *
   * M2's reviewer accepted the plan with two warnings and nothing was repaired,
   * so a WITH arm paired with it would have learned nothing. Here the WITHOUT
   * contract names one kind of warning as blocking (`promotedWarningCategories`):
   * the plan review's warning of that kind is promoted, the plan is repaired, the
   * re-review resolves it, and the bundle carries it to a WITH arm whose planner
   * receives it. The control is the same review under a contract that promotes
   * nothing: the warning is retained, nothing is repaired, and the WITH arm is
   * refused before a run exists. `review-warnings.tsv` says which was which.
   */
  const warningsOf = async (pool: Pool, runId: string) => (await pool.query<{ category: string | null; promoted_to_blocking: boolean | null; warning_index: string }>(
    `SELECT * FROM (${REVIEW_WARNINGS_SQL}) w WHERE w.run_id = $1`, [runId])).rows
    .map((row) => ({ index: Number(row.warning_index), category: row.category, promoted: row.promoted_to_blocking }));

  it('option B: a WITHOUT arm whose contract promotes a kind of warning leaves a verified repair finding its WITH arm\'s planner receives', async () => {
    expect(REVIEW_WARNINGS_SQL, 'the dump script\'s own query was found').toContain('julius.review.verdict.declared');
    const without = await database('bwo');
    const withDb = await database('bwi');
    const paths = checkout({ promotedWarningCategories: ['contract_drift'] });
    const withoutContract = parse(paths.withoutPath);
    expect(withoutContract.promotedWarningCategories).toEqual(['contract_drift']);

    // The plan review warns; the promoted warning sends the plan to repair; the re-review answers it; the build is accepted.
    const withoutRun = await runMission({
      pool: without, contract: withoutContract, knowledge: createPostgresMissionKnowledgeStore(without),
      reviews: [PLAN_WARNED, REVIEW_ACCEPT_ANSWERING, REVIEW_ACCEPT],
    });
    expect(withoutRun.outcome, `halt: ${withoutRun.outcome.haltCause ?? 'none'}`).toMatchObject({ state: 'COMPLETED', stalled: false });

    // POINT 1: the warning's life, as the runtime wrote it.
    const source = (await new JuliusCarryPostgresRepository(without).carrySources({ projectId, excludeRunId: 'none' }))
      .find((item) => item.runId === withoutRun.runId);
    expect(source, 'the WITHOUT run holds reviewer findings').toBeDefined();
    const promoted = source!.findings.find((finding) => finding.findingId.startsWith('finding:warning:'));
    expect(promoted, JSON.stringify(source!.findings)).toMatchObject({ category: 'contract_drift', blocking: true });
    const life = foldJuliusFindings(source!.findings, source!.ledger).find((item) => item.findingId === promoted!.findingId);
    expect(life, JSON.stringify(life)).toMatchObject({ state: 'RESOLVED', lastMove: 'REVIEWER_RESOLVED' });
    expect(life!.repairTaskIds.length).toBeGreaterThan(0);
    // The bundle file says it was a warning of a named kind, and that Julius promoted it.
    expect(await warningsOf(without, withoutRun.runId)).toEqual([{ index: 0, category: 'contract_drift', promoted: true }]);

    // POINT 2: the bundle admits the pair, and selects exactly what the store selects.
    const { bundle, exportText } = await bundleOf(without, withoutRun.runId, paths);
    const withContract = parse(paths.withPath);
    const decision = decideJuliusCarrySource({
      contractPath: paths.withPath, contract: withContract, bundleDir: bundle, workflowRunId: WORKFLOW_RUN, commit: COMMIT, requireArchiveForWith: true,
    });
    expect(decision.kind, decision.lines.join('\n')).toBe('ARCHIVE');
    if (decision.kind !== 'ARCHIVE') return;
    const fromBundle = selectJuliusCarry({ targetRunId: 'run:not-yet', sources: [decision.verdict.source], claims: [] });
    expect(fromBundle).toEqual(selectJuliusCarry({ targetRunId: 'run:not-yet', sources: [source!], claims: [] }));
    expect(fromBundle.counts.VERIFIED_REPAIR_FINDING).toBe(1);
    const carried = juliusCarryEntryId(withoutRun.runId, `finding:${promoted!.findingId}`);
    expect(fromBundle.selected.map((item) => item.entryId)).toContain(carried);

    // POINTS 3 and 4: the WITH arm, on a database that never held its pair, restores it and its planner receives it.
    const withRun = await runMission({
      pool: withDb, contract: withContract,
      knowledge: createArchivedMissionKnowledgeStore({ pool: withDb, archive: { source: decision.verdict.source, origin: decision.verdict.origin } }),
      reviews: [REVIEW_ACCEPT],
    });
    expect(withRun.outcome).toMatchObject({ state: 'COMPLETED', stalled: false });
    const manifest = await withDb.query<{ payload: { facts: Record<string, unknown> } }>(
      "SELECT payload FROM relay_wonderland.events WHERE stream_id = $1 AND event_type = 'julius.knowledge.carried'", [withRun.runId]);
    expect(manifest.rows[0]!.payload.facts).toMatchObject({ arm: 'WITH', origin: 'ARCHIVE', sourceRunId: withoutRun.runId, sourceExportSha256: sha256(exportText) });
    const restored = await withDb.query<{ entry_id: string }>(
      "SELECT entry_id FROM relay_wonderland.julius_brain_entries WHERE run_id = $1 AND entry_id LIKE 'carried:%'", [withRun.runId]);
    expect(restored.rows.map((row) => row.entry_id)).toContain(carried);
    const planTask = (await withDb.query<{ task_id: string }>(
      "SELECT task_id FROM relay_wonderland.julius_tasks WHERE run_id = $1 AND task_type = 'plan'", [withRun.runId])).rows[0]!.task_id;
    const compiled = (await withDb.query<{ payload: { taskId?: string; facts: Record<string, unknown> } }>(
      "SELECT payload FROM relay_wonderland.events WHERE stream_id = $1 AND event_type = 'julius.context.compiled' ORDER BY sequence", [withRun.runId]))
      .rows.filter((row) => row.payload.taskId === planTask);
    expect(String(compiled.at(-1)!.payload.facts.carriedReceivedIds ?? '').split(' ')).toContain(carried);
  }, 120_000);

  it('option B\'s control: the same review under a contract that promotes nothing teaches nothing, and the WITH arm is refused for free', async () => {
    const without = await database('cwo');
    const paths = checkout();
    const withoutContract = parse(paths.withoutPath);
    expect(withoutContract.promotedWarningCategories).toBeUndefined();
    const withoutRun = await runMission({
      pool: without, contract: withoutContract, knowledge: createPostgresMissionKnowledgeStore(without),
      reviews: [PLAN_WARNED, REVIEW_ACCEPT],
    });
    expect(withoutRun.outcome).toMatchObject({ state: 'COMPLETED', stalled: false });
    // The warning is the same kind, retained and never blocking: M2's shape.
    expect(await warningsOf(without, withoutRun.runId)).toEqual([{ index: 0, category: 'contract_drift', promoted: false }]);
    const { bundle } = await bundleOf(without, withoutRun.runId, paths);
    const decision = decideJuliusCarrySource({
      contractPath: paths.withPath, contract: parse(paths.withPath), bundleDir: bundle, workflowRunId: WORKFLOW_RUN, commit: COMMIT, requireArchiveForWith: true,
    });
    expect(decision.kind).toBe('REFUSED');
    expect(decision.kind === 'REFUSED' && decision.reasonCode).toBe('CARRY_SOURCE_NOT_A_VALID_PAIR');
  }, 120_000);
});
