import { execFile } from 'node:child_process';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import { JuliusPostgresRepository } from './julius-postgres';
import { JuliusContractPostgresRepository } from './julius-contract-postgres';
import { createJuliusPostgresRuntimeStore } from '../../../relay-bridge/julius/postgres-store';
import { createPostgresMissionSeedStore } from '../../../relay-bridge/julius/mission-seed';
import { assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal } from '../../../relay-bridge/julius/live-composition';
import { scriptedAdapter, seededTaskContract, worker, type ScriptedOutcome } from '../mission/julius';
import type { JuliusTask } from '../mission/julius';
import { evaluate } from '../../../scripts/wonderland-beta-gate.mjs';

/**
 * THE WHOLE EVIDENCE CHAIN, ON A REAL DATABASE, WITH NO PROVIDER.
 *
 * Three things have each been proven separately and never together:
 *
 *   the RUNTIME, against an in-memory store that is a program agreeing with
 *   itself; the DUMP's column names, against the migration SQL read as text;
 *   and the BETA GATE, against TSV fixtures written by hand in its own test.
 *
 * Between them sits the join nobody tested: a real run's rows, read out of
 * PostgreSQL by the dump's own queries, parsed by the gate. That join is
 * exactly where free dry runs #1 and #2 failed — `evidence.tsv` and
 * `findings.tsv` arrived reading `unavailable` because a query named a column
 * the migrations never created, and a paid run cannot be re-run for free to
 * find out. This drives a complete mission — plan, review, build, a REJECTED
 * build review, a repair round, its re-review — through the production
 * Postgres store with scripted adapters, then runs THE QUERIES THE SHIPPING
 * SCRIPT CONTAINS, extracted from the script itself, then hands the result to
 * the gate.
 *
 * WHAT THIS DOES NOT COVER, stated rather than implied: the dump script wraps
 * each query in `docker exec` against the mission's container, and there is no
 * container here, so the transport is not exercised — the `first-live-topology`
 * job does that. The SQL, the row shapes and the gate's reading of them are.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;
const run = promisify(execFile);

const RUN_ID = 'run:live-chain';
const PROJECT = 'project';
const MISSION = 'mission:live-chain';
const PLAN = `${RUN_ID}:plan`;
const BUILD = `${RUN_ID}:build`;

const PLAN_OK: ScriptedOutcome = {
  kind: 'succeed',
  evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Validated architect plan stored for this run.' }],
};
const BUILD_OK: ScriptedOutcome = {
  kind: 'succeed',
  evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'node --test: exit 0.' }],
};
const REVIEW_ACCEPT: ScriptedOutcome = {
  kind: 'succeed',
  evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'Independent review approved the change.' }],
};
const REVIEW_REJECT: ScriptedOutcome = {
  kind: 'succeed',
  evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The change is untested.' }],
};
/**
 * THE RE-REVIEW ANSWERS THE FINDING IT IS CHARGED WITH. Since #277 a re-review
 * that accepts a repair without answering the finding that caused it is HALTed
 * as FINDINGS_UNRESOLVED — "an unanswered finding is not resolved" — and that
 * is right: a live reviewer is handed the finding in its packet and must say
 * what became of it. This script read its packet from nowhere and answered
 * nothing, so the run parked in VERIFYING on main and on every branch since,
 * and no workflow ran this suite to say so. `answerFindings` reads the finding
 * ids out of the same compiled packet a live reviewer would see.
 */
const REVIEW_ACCEPT_ANSWERING: ScriptedOutcome = { ...REVIEW_ACCEPT, answerFindings: 'RESOLVED' };

const task = (over: Partial<JuliusTask> & { taskId: string }): JuliusTask => ({
  missionId: MISSION, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
  taskType: 'build', role: 'CODING_AGENT', ordinal: 0, state: 'RUNNABLE', ...over,
});

let pool: Pool;

suite('the Julius evidence chain: a real run, the shipping dump queries, the Beta Gate', () => {
  beforeAll(async () => {
    // `describe.todo` never runs this body when the suite is gated off, so the
    // check is belt-and-braces — written as a guarded block rather than an
    // early `return`, which `ci-test-accounting` rightly refuses because a
    // silent return is how a test comes to assert nothing and still pass.
    if (enabled) {
      pool = new Pool({ connectionString: databaseUrl! });
      await new TransactionalWonderlandDatabase(pool).migrate();
    }
  });
  afterAll(async () => pool?.end());

  it('drives a mission with a repair round, dumps it, and the gate reads what the run actually did', async () => {
    const runs = new JuliusPostgresRepository(pool);
    const contracts = new JuliusContractPostgresRepository(pool);
    const seeds = createPostgresMissionSeedStore(pool);
    const at = new Date().toISOString();

    /* ------------------------------------------------ the deployment, as production seeds it */
    await seeds.ensureBase({
      tenantId: 'tenant', projectId: PROJECT, missionId: MISSION, executionId: 'execution:live-chain',
      cardRevision: 'card:live-chain', missionSnapshot: { mission: MISSION }, canonicalHash: 'hash:live-chain',
    });
    const created = await runs.createRun({
      commandId: `bootstrap:${RUN_ID}`, runId: RUN_ID, missionId: MISSION, projectId: PROJECT,
      cardRevision: 'card:live-chain', missionContractRevision: 1, projectBrainRevision: 0, occurredAt: at,
    });
    await seeds.insertCriteria(RUN_ID, [{ criterionId: 'AC-1', description: 'The fixture test passes.', requiredEvidenceTypes: [] }]);
    await seeds.insertBrainEntries(RUN_ID, PROJECT, [
      { entryId: 'brain:seed', kind: 'CONSTRAINT', text: 'OBJECTIVE: prove the evidence chain end to end.', revision: 1 },
    ]);
    expect(await runs.addTask({
      commandId: `task:${PLAN}`, runId: RUN_ID, projectId: PROJECT,
      task: task({ taskId: PLAN, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'], ordinal: 0 }),
    })).toBe(true);
    // BLOCKED, because only Julius releases work: the accepting plan review does.
    expect(await runs.addTask({
      commandId: `task:${BUILD}`, runId: RUN_ID, projectId: PROJECT,
      task: task({ taskId: BUILD, taskType: 'build', requiredEvidenceTypes: ['TEST'], ordinal: 1, state: 'BLOCKED', dependencyIds: [PLAN] }),
    })).toBe(true);
    // The build's contract, seeded as a DRAFT exactly as the bootstrap writes it.
    expect(await contracts.putTaskContract({
      projectId: PROJECT, occurredAt: at,
      contract: seededTaskContract({ runId: RUN_ID, taskId: BUILD, state: 'draft' }),
    })).toBe(true);
    // CREATED → PLANNING → READY, both steps, because the transition table
    // refuses the shortcut and the bootstrap port walks it the same way.
    let version = created.version;
    for (const step of ['PLANNING', 'READY'] as const) {
      const moved = await runs.transition({
        commandId: `bootstrap:${RUN_ID}:${step}`, runId: RUN_ID, projectId: PROJECT, expectedVersion: version,
        to: step, reasonCode: 'BOOTSTRAP', safeSummary: `Mission bootstrap advanced the run to ${step}.`,
        evidenceIds: [], occurredAt: at,
      });
      version = moved.version;
    }

    /* ------------------------------------------------------------- the run, provider-free */
    const architect = worker({
      workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
      capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'],
    });
    const coder = worker({
      workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter',
      capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
    });
    const reviewer = worker({
      workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter',
      capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:build'],
    });
    // THE SAME HANDOFFS THE JOB COMPOSES: the PostgreSQL snapshot table holds a
    // packet's identity and hashes, not its text, so the live path keeps the
    // compiled packets beside the store and a reviewer reads its own from there.
    const handoffs = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool));
    const store = handoffs.store;
    const packetFor = (dispatch: { readonly contextId: string }): string | null => {
      const snapshot = handoffs.contexts.snapshotFor(dispatch.contextId);
      return snapshot === null ? null : snapshot.packet.blocks.map((block) => block.text).join('\n');
    };
    const runtime = assembleLiveJuliusRuntime({
      store,
      entries: [
        { worker: architect, adapter: scriptedAdapter(architect, [PLAN_OK, PLAN_OK]) },
        { worker: coder, adapter: scriptedAdapter(coder, [BUILD_OK, BUILD_OK]) },
        // The build review REJECTS once: that is the case the product exists
        // for, and it is what puts a repair round in the durable record. The
        // re-review of the repair then ANSWERS the finding it raised.
        { worker: reviewer, adapter: scriptedAdapter(reviewer, [REVIEW_ACCEPT, REVIEW_REJECT, REVIEW_ACCEPT_ANSWERING, REVIEW_ACCEPT], { packetFor }) },
      ],
      cardRevision: 'card:live-chain', spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 3,
      owner: 'live-chain-driver',
    });
    const outcome = await driveJuliusRunToTerminal({
      loop: runtime.loop, store, runId: RUN_ID, projectId: PROJECT, maxTicks: 32,
    });
    expect(outcome, `the run must reach COMPLETED for the rest to mean anything (halt: ${outcome.haltCause ?? 'none'})`)
      .toMatchObject({ state: 'COMPLETED', stalled: false });

    /* --------------------------------- the dump, using the queries the shipping script holds */
    const script = readFileSync('.github/julius-live-evidence-dump.sh', 'utf8');
    const calls = [...script.matchAll(/^dump "(.+)" ([A-Za-z0-9._-]+)$/gmu)].map((match) => ({ sql: match[1]!, file: match[2]! }));
    expect(calls.length, 'the dump script still declares its queries in the shape this test reads').toBeGreaterThanOrEqual(14);

    const bundleRoot = mkdtempSync(join(tmpdir(), 'julius-chain-'));
    const bundle = join(bundleRoot, 'julius-live-evidence');
    mkdirSync(bundle);
    const url = new URL(databaseUrl!);
    const env = {
      ...process.env,
      PGHOST: url.searchParams.get('host') ?? url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGDATABASE: url.pathname.replace(/^\//u, ''),
    };
    for (const call of calls) {
      // The same flags the script passes through `docker exec`, so the bytes
      // the gate parses are the bytes a live run would upload.
      const { stdout } = await run('psql', ['-v', 'ON_ERROR_STOP=1', '-A', '-F', '\t', '-c', call.sql], { env, maxBuffer: 32 * 1024 * 1024 });
      writeFileSync(join(bundle, call.file), stdout);
      expect(stdout.trim(), `${call.file} must not be the failure sentinel`).not.toBe('unavailable');
    }
    // The two files the WORKFLOW writes beside the dump, so the gate sees the
    // shape a real bundle has. Their content is the run's own truth.
    writeFileSync(join(bundle, 'live-mission.evidence.txt'),
      `Run ${RUN_ID} accepted in state READY; driving the Julius run loop.\nRESULT: ${outcome.state} after ${outcome.ticks} ticks\n`);

    /* ------------------------------------------------------------------ the gate reads it */
    const report = evaluate(bundleRoot);
    const verdicts = new Map(report.results.map((row) => [row.id, row]));
    const basis = (id: string) => `${id}: ${verdicts.get(id)?.verdict} — ${verdicts.get(id)?.basis}`;

    // EVERY ROW THE RUNTIME CAN EARN, earned from database rows this run wrote.
    for (const id of [
      'PROJECT CREATION', 'JULIUS MISSION START', 'PROMPT ARCHITECT', 'CODING AGENT',
      'TASK CONTRACT LOCK', 'INDEPENDENT REVIEWER', 'REPAIR LOOP', 'VERIFICATION',
      'VERIFIED COMPLETION', 'PROJECT BRAIN PERSISTENCE',
    ]) {
      expect(verdicts.get(id)?.verdict, basis(id)).toBe('PASS');
    }

    // AND THE CONTRACT ROW EARNED IT THE STRONG WAY: the claim rows in
    // `contract-events.tsv` are what proves the build RAN under the lock, and
    // this is the first time that logic has read real database output.
    expect(verdicts.get('TASK CONTRACT LOCK')?.basis)
      .toContain('were claimed under that revision and digest');
    expect(verdicts.get('TASK CONTRACT LOCK')?.basis).not.toContain('not measurable');

    /**
     * AND THE REFUSAL, ON REAL ROWS. Everything above is the happy direction:
     * the build did run under the lock, so a gate that had stopped comparing
     * would still say PASS and this test could not tell. So the claim event's
     * recorded revision is moved in the DATABASE — the one place a mismatch can
     * be manufactured without touching code — and the same dump and the same
     * gate are asked again. This is the shape a stale handoff would leave
     * behind, read end to end.
     */
    const claimQuery = calls.find((call) => call.file === 'contract-events.tsv')!;
    await pool.query(
      `UPDATE relay_wonderland.events
          SET payload=jsonb_set(payload,'{facts,contractRevision}','99'::jsonb)
        WHERE event_type='julius.task.claimed' AND payload->>'taskId'=$1`,
      [BUILD],
    );
    const { stdout: mutated } = await run('psql', ['-v', 'ON_ERROR_STOP=1', '-A', '-F', '\t', '-c', claimQuery.sql], { env, maxBuffer: 32 * 1024 * 1024 });
    writeFileSync(join(bundle, 'contract-events.tsv'), mutated);
    const refused = evaluate(bundleRoot).results.find((row) => row.id === 'TASK CONTRACT LOCK')!;
    expect(refused.verdict, refused.basis).toBe('FAIL');
    expect(refused.basis).toContain('claimed under revision 99');

    // The repair round is real, not inferred: a repair task and its re-review.
    const tasks = readFileSync(join(bundle, 'tasks.tsv'), 'utf8');
    expect(tasks).toMatch(/repair:.*\trepair:build\tCODING_AGENT\tSUCCEEDED/u);
    // And the trajectory names the agreement every bound dispatch ran under.
    const trajectory = readFileSync(join(bundle, 'trajectory.tsv'), 'utf8');
    expect(trajectory).toContain('DISPATCH');
    expect(trajectory, 'a bound dispatch row carries its contract binding').toMatch(/sha256:[0-9a-f]{64}/u);
  }, 120_000);
});
