import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptedAdapter, type ScriptedOutcome } from '../src/relay/mission/julius';
import type { JuliusBootstrapRequest } from '../src/relay/integration/julius/julius-port';
import { juliusArchitectureEntryId } from '../src/relay/mission/julius/julius-architecture-state';
import { juliusCarriedCopyId } from '../src/relay/mission/julius/julius-claim-ledger';
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { createLiveJuliusBootstrapPort } from './julius/bootstrap';
import {
  CODER_WORKER, architectWorker, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { compileBootstrapRequest, parseLiveMissionContract } from './julius/mission-contract';
import { createPostgresMissionKnowledgeStore } from './julius/mission-knowledge';
import { createPostgresMissionSeedStore } from './julius/mission-seed';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * THE CORRECTED CARRY, END TO END, AS THE PAID EXPERIMENT WILL RUN IT (founder ruling 2026-10-04, R2 + R3).
 *
 * Two arms of one registered pair, one store, the PRODUCTION compositions: each arm's contract through the
 * real parser and request compiler, `createLiveJuliusBootstrapPort` over the PostgreSQL repositories with the
 * real knowledge store, and a run loop over `createJuliusPostgresRuntimeStore(pool)`. Arm WITH is bootstrapped
 * exactly as `julius-live-mission.ts` binds a registered arm WITH: `carry: { required: true, fromRunIds:
 * [withoutRunId] }`. Only the providers are scripted, and their scripts are the premise:
 *
 *   ARM WITHOUT  the architect records a design; the reviewer REJECTS the plan with a cited finding (the
 *                sentinel); the real verification repairs the plan; the re-review RESOLVES the finding; the
 *                build passes; the run COMPLETES. Everything between those scripted answers is production code.
 *   ARM WITH     must inherit that finding and that design, in its PLANNER's packet, and nowhere else.
 *
 * WHAT IT PROVES, the founder's four points, each read from durable rows — and the bundle's own query:
 *   (1) exactly what arm WITHOUT wrote: the finding row, its RESOLVED life, the verdict mirrors, the design;
 *   (2) which of it became carry-eligible, and why the rest did not: the `knowledge.carried` row;
 *   (3) exactly what arm WITH carried: two `carried:…:into:<with>` rows, scoped to its plan, with provenance;
 *   (4) that the planner RECEIVED them: the plan's durable snapshot, the packet text it was handed, and the
 *       `knowledge.consumed` row — and that no other worker of arm WITH did.
 * And the gate: an arm WITH whose WITHOUT left nothing eligible is REFUSED before READY, nothing dispatched.
 *
 * NEVER EXECUTED when drafted (read-only session, 2026-10-04): HEAVY, run it foreground, one boot.
 * Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and `todo` without it.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;
const CARD = 'card:carry-planner:1';
const nonce = () => randomBytes(4).toString('hex');

const SENTINEL = 'CARRY-PLANNER-SENTINEL the plan deploys before the migration runs';
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const DESIGN = {
  components: [{ name: 'release-script', responsibility: 'Runs the migration, then the deploy.' }],
  decisions: [{ decisionId: 'D1', decision: 'Migrate before deploying.', reason: 'The deploy reads the migrated schema.' }],
};
const ALIGNED = { assessment: 'ALIGNED', claim: 'The release script matches the recorded design.' };
/** Every architect answer: a plan, the whole design (unchanged after r1), and an aligned assessment of it. */
const ARCHITECT_WITH_DESIGN: ScriptedOutcome = { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null, architecture: DESIGN, consistency: ALIGNED };
const ARCHITECT_PLAIN: ScriptedOutcome = { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null };
const BUILD: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }, { type: 'DIFF', status: 'PASSED', safeSummary: 'The change set.' }], usdMicros: 1_000 };
/** A FAILED review finding on the plan: Julius records a blocking finding and repairs the plan. */
const REJECT_PLAN: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: SENTINEL }], usdMicros: null };
/** Every later review: passes, and ANSWERS any finding its packet shows as RESOLVED (silence would hold the run). */
const PASS_AND_RESOLVE: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }], usdMicros: null, answerFindings: 'RESOLVED' };
const POLICY = { dimensions: ['dispatches', 'repairs'], minimumRelativeImprovement: 0.1, minimumImprovedDimensions: 1 };

type Snapshot = { task_id: string; worker_role: string; source_entry_ids: string[]; integrity_excluded_entry_ids: string[] | null; integrity_evicted_entry_ids: string[] | null };
type Facts = Record<string, string | number | boolean | null>;

suite('the corrected carry reaches the next run’s planner, and only the planner (R2, R3)', () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
  });
  afterAll(async () => pool?.end());

  /** One registered pair's shared mission, and a bootstrap + drive for one arm of it. */
  function pair() {
    const id = nonce();
    const digest = createHash('sha256').update(`julius.learning-registration.v1 carry ${id}`).digest('hex');
    const base = {
      missionId: `mission:carry-planner-${id}`, markerNamespace: `carry-planner-${id}`, projectId: `prj-carry-planner-${id}`,
      tenantId: `tenant-carry-planner-${id}`, objective: 'Add the deploy step to the release script.',
      requirements: ['Run the migration first.'], constraints: ['Touch only scripts/.'],
      acceptanceCriteria: [{ id: 'AC-1', text: 'The release script deploys after migrating.', blocking: true }],
      testCommand: 'npm test', workspacePath: '/workspace/carry-planner', limits: { spendUsd: 2, repairCycles: 1 },
    };

    const bootstrap = async (input: {
      readonly clause: Record<string, unknown>;
      readonly scripts: { readonly architect: readonly ScriptedOutcome[]; readonly coder: readonly ScriptedOutcome[]; readonly reviewer: readonly ScriptedOutcome[] };
      readonly carry?: { readonly required: boolean; readonly fromRunIds?: readonly string[] };
    }) => {
      const parsed = parseLiveMissionContract(JSON.stringify({ ...base, learningPair: input.clause }));
      if (!parsed.ok) throw new Error(parsed.problem);
      // ONE HANDOFF CACHE PER ARM, so this arm's snapshots are never evicted by the other's.
      const handoffs = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool));
      const packetFor = (dispatch: { readonly contextId: string }) =>
        handoffs.contexts.snapshotFor(dispatch.contextId)?.packet.blocks.map((block) => block.text).join('\n') ?? null;
      const architect = scriptedAdapter(architectWorker({}), input.scripts.architect, { packetFor });
      const coder = scriptedAdapter(CODER_WORKER, input.scripts.coder, { packetFor });
      const reviewer = scriptedAdapter(reviewerWorker('hermes'), input.scripts.reviewer, { packetFor });
      const entries = [
        { worker: architectWorker({}), adapter: architect },
        { worker: CODER_WORKER, adapter: coder },
        { worker: reviewerWorker('hermes'), adapter: reviewer },
      ];
      const request = compileBootstrapRequest(parsed.contract, entries.map((entry) => ({
        role: entry.worker.role as JuliusBootstrapRequest['workers'][number]['role'],
        integrationId: entry.worker.workerId, adapterId: entry.worker.adapterId,
        independenceGroup: entry.worker.providerId, requiredCapabilities: entry.worker.capabilities,
      })), CARD);
      const runs = new JuliusPostgresRepository(pool);
      const contracts = new JuliusContractPostgresRepository(pool);
      // EXACTLY THE LIVE ENTRYPOINT'S BINDING (`julius-live-mission.ts`): the knowledge store, and on arm WITH the requirement.
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
      return { submitted, handoffs, architect, coder, reviewer, drive };
    };
    return { id, digest, base, bootstrap };
  }

  const snapshotsOf = async (runId: string): Promise<readonly Snapshot[]> => (await pool.query<Snapshot>(
    `SELECT task_id, worker_role, source_entry_ids, integrity_excluded_entry_ids, integrity_evicted_entry_ids
       FROM relay_wonderland.julius_context_snapshots WHERE run_id = $1 ORDER BY created_at, context_id`, [runId])).rows;

  const factsOf = async (runId: string, type: string): Promise<readonly { task_id: string | null; facts: Facts }[]> => (await pool.query<{ task_id: string | null; facts: Facts }>(
    `SELECT payload->>'taskId' AS task_id, payload->'facts' AS facts FROM relay_wonderland.events
      WHERE stream_id = $1 AND event_type = $2 ORDER BY sequence`, [runId, `julius.${type}`])).rows;

  /** The bundle's own query for knowledge-carry.tsv, read out of the dump script and run as written. */
  const dumpQuery = (file: string): string => {
    const script = readFileSync(join(__dirname, '..', '.github', 'julius-live-evidence-dump.sh'), 'utf8');
    const line = script.split('\n').find((entry) => entry.startsWith('dump "SELECT') && entry.endsWith(`" ${file}`)) ?? '';
    expect(line, `${file} is dumped`).not.toBe('');
    return line.slice('dump "'.length, line.length - `" ${file}`.length);
  };

  it('CASE 1 — arm WITHOUT’s resolved finding and accepted design reach arm WITH’s planner, structured, and reach no other worker', async () => {
    const { digest, bootstrap } = pair();

    /* ---------------------------------------------------------------- arm WITHOUT */
    const withoutArm = await bootstrap({
      clause: { registrationDigest: digest, arm: 'WITHOUT', rerunKey: `without-${nonce()}`, policy: POLICY },
      scripts: { architect: [ARCHITECT_WITH_DESIGN], coder: [BUILD], reviewer: [REJECT_PLAN, PASS_AND_RESOLVE] },
    });
    expect(withoutArm.submitted.accepted, 'arm WITHOUT bootstraps: it is the first run of its mission').toBe(true);
    const withoutOutcome = await withoutArm.drive();
    expect(withoutOutcome.state, String(withoutOutcome.haltCause)).toBe('COMPLETED');
    if (!withoutArm.submitted.accepted) throw new Error('unreachable');
    const withoutRun = withoutArm.submitted.runId;

    // CONTROL: arm WITHOUT, the mission's first run, inherited nothing — its carry is EMPTY and its plan was owed nothing.
    expect((await factsOf(withoutRun, 'knowledge.carried')).map((row) => row.facts.outcome)).toEqual(['EMPTY']);
    expect(await factsOf(withoutRun, 'knowledge.consumed')).toEqual([]);
    for (const snapshot of await snapshotsOf(withoutRun)) {
      expect(snapshot.source_entry_ids.filter((entryId) => entryId.startsWith('carried:')), snapshot.task_id).toEqual([]);
    }

    /* (1) EXACTLY WHAT ARM WITHOUT WROTE: the finding, its life, the verdict mirrors, the design. */
    const findings = await pool.query<{ finding_id: string; task_id: string; blocking: boolean; claim: string }>(
      'SELECT finding_id, task_id, blocking, claim FROM relay_wonderland.julius_reviewer_findings WHERE run_id = $1', [withoutRun]);
    expect(findings.rows, 'the reviewer’s cited finding on the plan').toEqual([
      expect.objectContaining({ task_id: `${withoutRun}:plan`, blocking: true, claim: SENTINEL }),
    ]);
    const findingId = findings.rows[0]!.finding_id;
    const moves = (await factsOf(withoutRun, 'finding.transitioned')).filter((row) => row.facts.findingId === findingId).map((row) => row.facts.move);
    expect(moves, 'a repair addressed it and the independent re-review resolved it').toEqual(['REPAIR_SUCCEEDED', 'REVIEWER_RESOLVED']);
    const written = await pool.query<{ entry_id: string; entry_kind: string; task_id: string | null }>(
      'SELECT entry_id, entry_kind, task_id FROM relay_wonderland.julius_brain_entries WHERE run_id = $1 ORDER BY revision', [withoutRun]);
    const writtenIds = written.rows.map((row) => row.entry_id);
    expect(writtenIds, 'the plan’s REPAIR verdict mirror — what the first carry handed over').toContain(`brain:decision:${withoutRun}:plan:REPAIR:BLOCKING_FINDINGS`);
    const design = juliusArchitectureEntryId(withoutRun, 1);
    expect(writtenIds, 'the design in force, run-wide in its own run').toContain(design);
    expect(written.rows.find((row) => row.entry_id === design)?.task_id).toBeNull();

    /* ---------------------------------------------------------------- arm WITH */
    const withArm = await bootstrap({
      clause: { registrationDigest: digest, arm: 'WITH', rerunKey: `with-${nonce()}`, withoutRunId: withoutRun, policy: POLICY },
      scripts: { architect: [ARCHITECT_WITH_DESIGN], coder: [BUILD], reviewer: [PASS_AND_RESOLVE] },
      carry: { required: true, fromRunIds: [withoutRun] },
    });
    expect(withArm.submitted.accepted, 'a non-empty carry lets arm WITH start').toBe(true);
    if (!withArm.submitted.accepted) throw new Error('unreachable');
    const withRun = withArm.submitted.runId;
    expect(withRun).not.toBe(withoutRun);

    /* (2) WHAT BECAME ELIGIBLE, AND WHY THE REST DID NOT — one decision, on arm WITH's stream. */
    const decisions = await factsOf(withRun, 'knowledge.carried');
    expect(decisions).toHaveLength(1);
    const decision = decisions[0]!.facts;
    expect(decision).toMatchObject({
      outcome: 'CARRIED', scopeTaskId: `${withRun}:plan`, scopeRole: 'PROMPT_ARCHITECT', sourceRuns: 1, sourceRunIds: withoutRun,
      carried: 2, carriedFindings: 1, carriedArchitecture: 1,
    });
    expect(String(decision.excludedByReason), 'the verdict mirrors were left behind, by name').toMatch(/decision_mirror=\d+/u);

    /* (3) EXACTLY WHAT ARM WITH CARRIED: two rows, the plan's, with where they came from. */
    const findingCopy = juliusCarriedCopyId(withRun, withoutRun, findingId);
    const designCopy = juliusCarriedCopyId(withRun, withoutRun, design);
    const carried = await pool.query<{ entry_id: string; task_id: string | null; entry_kind: string; safe_content: string }>(
      `SELECT entry_id, task_id, entry_kind, safe_content FROM relay_wonderland.julius_brain_entries WHERE run_id = $1 AND entry_id LIKE 'carried:%' ORDER BY revision`, [withRun]);
    expect(carried.rows.map((row) => [row.entry_id, row.task_id, row.entry_kind])).toEqual([
      [designCopy, `${withRun}:plan`, 'DECISION'],
      [findingCopy, `${withRun}:plan`, 'FINDING'],
    ]);
    const findingText = carried.rows[1]!.safe_content;
    for (const line of [
      `SOURCE RUN: ${withoutRun} (COMPLETED)`,
      `SOURCE TASK: ${withoutRun}:plan (plan, PROMPT_ARCHITECT)`,
      `REVIEWER'S CLAIM: ${SENTINEL}`,
      `SCOPE HERE: ${withRun}:plan (plan, PROMPT_ARCHITECT) only`,
    ]) expect(findingText.split('\n'), line).toContain(line);
    expect(findingText).toMatch(new RegExp(`^FINDING: ${findingId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} \\| severity HIGH \\| category review \\| criterion none \\| blocking$`, 'mu'));
    expect(findingText).toMatch(/^REPAIRED BY: repair:\S+ \| RESOLVED BY THE INDEPENDENT RE-REVIEW: \S+$/mu);

    /* (4) THE PLANNER RECEIVED THEM: arm WITH's drive, then its plan's packet. */
    const withOutcome = await withArm.drive();
    expect(withOutcome.state, String(withOutcome.haltCause)).toBe('COMPLETED');
    const snapshots = await snapshotsOf(withRun);
    const plans = snapshots.filter((snapshot) => snapshot.task_id === `${withRun}:plan`);
    expect(plans.length, 'the plan was compiled').toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan.worker_role).toBe('PROMPT_ARCHITECT');
      expect(plan.source_entry_ids, 'both carried rows are in the planner’s packet').toEqual(expect.arrayContaining([designCopy, findingCopy]));
      expect(plan.integrity_evicted_entry_ids ?? []).not.toContain(findingCopy);
      expect(plan.integrity_excluded_entry_ids ?? []).not.toContain(findingCopy);
    }
    // THE TEXT THE ARCHITECT WAS HANDED, out of the snapshot its dispatch named — not what the store held.
    const planDispatch = withArm.architect.dispatches.find((dispatch) => dispatch.taskId === `${withRun}:plan`);
    expect(planDispatch, 'the architect was dispatched for the plan').toBeTruthy();
    const packet = withArm.handoffs.contexts.snapshotFor(planDispatch!.contextId)!.packet;
    const handed = packet.blocks.map((block) => block.text).join('\n');
    expect(handed).toContain(`REVIEWER'S CLAIM: ${SENTINEL}`);
    expect(handed).toContain('CARRIED FROM AN EARLIER RUN: ACCEPTED ARCHITECTURE.');
    expect(handed, 'never the generic verdict line the first carry handed over').not.toContain('Verification requires repair.');
    const ranked = packet.integrity!.admitted.find((row) => row.entryId === findingCopy);
    expect(ranked, 'ranked as a reviewer-verified finding, scoped to this task').toMatchObject({ trust: 'VERIFIED', contextType: 'REVIEW_FINDING', taskScoped: true });
    const receipts = await factsOf(withRun, 'knowledge.consumed');
    expect(receipts.length, 'every planner compile writes its receipt').toBeGreaterThan(0);
    for (const receipt of receipts) {
      expect(receipt.task_id, 'a receipt is the plan’s, never another task’s').toBe(`${withRun}:plan`);
      expect(receipt.facts).toMatchObject({ role: 'PROMPT_ARCHITECT', taskType: 'plan', inScope: 2, admitted: 2, evicted: 0, missing: 0 });
      expect(String(receipt.facts.admittedEntryIds).split(' ').sort()).toEqual([designCopy, findingCopy].sort());
    }

    // AND NOBODY ELSE: no other packet of arm WITH holds a carried row — not the coder's, not the reviewer's.
    for (const snapshot of snapshots.filter((item) => item.task_id !== `${withRun}:plan`)) {
      expect(snapshot.source_entry_ids.filter((entryId) => entryId.startsWith('carried:')), `${snapshot.task_id} (${snapshot.worker_role})`).toEqual([]);
    }

    /* THE BUNDLE SAYS THE SAME: the dump's own SQL, run against this store, read per run (rows sort by stream id). */
    const bundle = (await pool.query<Record<string, string | null>>(dumpQuery('knowledge-carry.tsv'))).rows;
    const bundleOf = (runId: string) => bundle.filter((row) => row.run_id === runId).map((row) => [row.event_type, row.outcome ?? row.admitted]);
    expect(bundleOf(withoutRun), 'arm WITHOUT: looked, inherited nothing').toEqual([['julius.knowledge.carried', 'EMPTY']]);
    expect(bundleOf(withRun), 'arm WITH: the decision first, then the planner’s receipts').toEqual([
      ['julius.knowledge.carried', 'CARRIED'],
      ...receipts.map(() => ['julius.knowledge.consumed', '2']),
    ]);
    const withRows = bundle.filter((row) => row.run_id === withRun);
    expect(withRows.find((row) => row.event_type === 'julius.knowledge.carried')?.carried_entries).toContain(findingCopy);
    expect(withRows.find((row) => row.event_type === 'julius.knowledge.consumed')?.admitted_entry_ids).toContain(findingCopy);
  });

  it('CASE 2 — an arm WITH whose arm WITHOUT left nothing eligible is REFUSED before READY, with the reason on the record', async () => {
    const { digest, base, bootstrap } = pair();
    // Arm WITHOUT completes cleanly: no reviewer finding, no design. What it leaves is verdict mirrors only.
    const withoutArm = await bootstrap({
      clause: { registrationDigest: digest, arm: 'WITHOUT', rerunKey: `without-${nonce()}`, policy: POLICY },
      scripts: { architect: [ARCHITECT_PLAIN], coder: [BUILD], reviewer: [PASS_AND_RESOLVE] },
    });
    const withoutOutcome = await withoutArm.drive();
    expect(withoutOutcome.state, String(withoutOutcome.haltCause)).toBe('COMPLETED');
    if (!withoutArm.submitted.accepted) throw new Error('unreachable');
    const withoutRun = withoutArm.submitted.runId;

    const withArm = await bootstrap({
      clause: { registrationDigest: digest, arm: 'WITH', rerunKey: `with-${nonce()}`, withoutRunId: withoutRun, policy: POLICY },
      scripts: { architect: [ARCHITECT_PLAIN], coder: [BUILD], reviewer: [PASS_AND_RESOLVE] },
      carry: { required: true, fromRunIds: [withoutRun] },
    });
    expect(withArm.submitted).toMatchObject({ accepted: false, reasonCode: 'carried_knowledge_required' });
    // The run exists, CREATED and inert: not READY, nothing claimable, nothing compiled, nothing dispatched.
    const created = await pool.query<{ run_id: string; state: string }>(
      'SELECT run_id, state FROM relay_wonderland.julius_runs WHERE mission_id = $1 AND run_id <> $2', [base.missionId, withoutRun]);
    expect(created.rows.map((row) => row.state)).toEqual(['CREATED']);
    const refusedRun = created.rows[0]!.run_id;
    expect(await snapshotsOf(refusedRun)).toEqual([]);
    expect(withArm.architect.dispatches.length + withArm.coder.dispatches.length + withArm.reviewer.dispatches.length).toBe(0);
    // WHY, ON THE RECORD: the carry looked, found only verdict mirrors, and said so.
    const [record] = await factsOf(refusedRun, 'knowledge.carried');
    expect(record?.facts).toMatchObject({ outcome: 'EMPTY', carried: 0, carriedFindings: 0, carriedArchitecture: 0, sourceRuns: 1, sourceRunIds: withoutRun });
    expect(String(record?.facts.excludedByReason), 'the verdict mirrors it found, left behind by name').toMatch(/decision_mirror=\d+/u);
    const rows = await pool.query('SELECT 1 FROM relay_wonderland.julius_brain_entries WHERE run_id = $1 AND entry_id LIKE $2', [refusedRun, 'carried:%']);
    expect(rows.rowCount).toBe(0);
  });
});
