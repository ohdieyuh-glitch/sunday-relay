import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptedAdapter } from '../src/relay/mission/julius';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import {
  committedApproverAuthority, composeJuliusDecideStore, decideJuliusApprovalGuarded, juliusPlanCitation,
  parseJuliusApproverAllowlist, parseJuliusWorkflowApprovers,
} from './julius-approval-decide';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { approvalScopesOf, gatedCardRevision, parseLiveMissionContract } from './julius/mission-contract';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * V6 G-5 AGAINST A REAL POSTGRESQL: THE THREE GOVERNANCE QUERIES, AS THE DUMP SCRIPT HOLDS THEM, READ A REAL DRILL.
 *
 * A gated mission is created and held, decided through the decide CLI's own composition, and driven to
 * COMPLETED. Then the `approvals.tsv`, `transitions.tsv` and `lifecycle-events.tsv` queries are taken VERBATIM
 * from `.github/julius-live-evidence-dump.sh` and executed, and their rows must tell the story the V6 reading
 * needs (E2, E5): one approval, PENDING -> APPROVED by the named person with the cited reason; the walk to BLOCKED
 * by APPROVAL_REQUIRED and back to READY by APPROVAL_GRANTED; `julius.approval.requested` then
 * `julius.approval.decided` for the same approval; the build's dispatch after the decision.
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and `todo` without it.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const FOUNDER = 'github:founder#1001';
const SCRIPT = readFileSync(join(__dirname, '..', '.github', 'julius-live-evidence-dump.sh'), 'utf8');
const sqlOf = (file: string): string => {
  const match = SCRIPT.split('\n').map((line) => /^dump "(.+)" ([a-z-]+\.tsv)$/u.exec(line)).find((found) => found?.[2] === file);
  if (!match) throw new Error(`the dump script declares no ${file}`);
  return match[1]!;
};

suite('V6 G-5: the governance dumps over a real drill (gated -> held -> granted -> completed)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
  });
  afterAll(async () => pool?.end());

  it('approvals.tsv, transitions.tsv and lifecycle-events.tsv carry the hold, the person, the grant and the dispatch', async () => {
    const id = randomBytes(4).toString('hex');
    const raw = JSON.stringify({
      missionId: `mission:gov-dump-${id}`, markerNamespace: `gov-dump-${id}`, projectId: `prj-gov-dump-${id}`, tenantId: `tenant-gov-dump-${id}`,
      objective: 'Write a comparison of the three candidate save-file formats.',
      requirements: ['Compare size, load time and forward compatibility.'], constraints: ['Touch only docs/.'],
      acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
      testCommand: '', workspacePath: '/workspace/gov-dump', limits: { spendUsd: 2, repairCycles: 1 },
      approvalGates: [{ id: 'gate-build', operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'], reason: 'Sign off the plan first.' }],
    });
    const parsed = parseLiveMissionContract(raw);
    if (!parsed.ok) throw new Error(parsed.problem);
    const contract = parsed.contract;
    const cardRevision = gatedCardRevision('card:julius-live:1', contract.approvalGates);
    const created = await handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body: raw },
      { bootstrap: composeJuliusMissionBootstrap(pool), missingConfig: [], reviewerProvider: 'xai', cardRevision });
    const runId = ((created?.body as { data?: { runId: string } }).data!).runId;

    const store = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store;
    const runtime = assembleLiveJuliusRuntime({
      store,
      entries: [
        { worker: architectWorker({}), adapter: scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }], usdMicros: null }]) },
        { worker: CODER_WORKER, adapter: scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: [
          { type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }, { type: 'DIFF', status: 'PASSED', safeSummary: 'The change set.' },
        ], usdMicros: 1_000 }]) },
        { worker: reviewerWorker('hermes'), adapter: scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }], usdMicros: null }]) },
      ],
      cardRevision, spendCeilingUsdMicros: 2_000_000, maxRepairRounds: 1,
      ...(contract.approvalGates === undefined ? {} : { approvalScopes: approvalScopesOf(contract.approvalGates) }),
    });
    const drive = () => driveJuliusRunToTerminal({ loop: runtime.loop, store, runId, projectId: contract.projectId, verification: runtime.verification });
    expect((await drive()).state).toBe('BLOCKED');

    // THE DUMP OF A HELD RUN: one PENDING row, and nobody named.
    const heldApprovals = (await pool.query(sqlOf('approvals.tsv'))).rows.filter((row) => row.run_id === runId);
    expect(heldApprovals).toHaveLength(1);
    expect(heldApprovals[0]).toMatchObject({ state: 'PENDING', decided_by: null, policy_revision: cardRevision, reason_code: 'CARD_SCOPED_APPROVAL_REQUIRED' });

    const decide = composeJuliusDecideStore(pool);
    const citation = juliusPlanCitation(await decide.store.tasksForRun(runId, contract.projectId), await decide.store.evidenceForRun(runId, contract.projectId));
    const approvalId = heldApprovals[0]!.approval_id as string;
    const reason = `Plan ${citation ?? 'none'} reviewed; build approved.`;
    const result = await decideJuliusApprovalGuarded({
      runId, projectId: contract.projectId, approvalId, decision: 'APPROVED', approverId: FOUNDER, reason, commentId: '42',
    }, {
      store: decide.store, events: decide.events, clock: { now: () => new Date().toISOString() }, ids: { next: (kind) => `${kind}:${randomUUID()}` },
      authority: committedApproverAuthority({
        file: parseJuliusApproverAllowlist(JSON.stringify({ version: 1, approvers: [{ login: 'founder', id: 1001 }], operations: ['DISPATCH_WORKER'] })),
        workflow: parseJuliusWorkflowApprovers('founder#1001'),
      }),
    });
    expect(result.exitCode, result.line).toBe(0);
    expect((await drive()).state).toBe('COMPLETED');

    // approvals.tsv
    const approvals = (await pool.query(sqlOf('approvals.tsv'))).rows.filter((row) => row.run_id === runId);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ approval_id: approvalId, state: 'APPROVED', decided_by: FOUNDER, decision_reason: reason, policy_revision: cardRevision });
    expect((approvals[0]!.requested_at as Date).getTime()).toBeLessThanOrEqual((approvals[0]!.decided_at as Date).getTime());

    // transitions.tsv, in the ledger's order
    const walk = (await pool.query(sqlOf('transitions.tsv'))).rows.filter((row) => row.run_id === runId);
    const sequences = walk.map((row) => Number(row.sequence));
    expect(sequences, 'ordered by the ledger position').toEqual([...sequences].sort((a, b) => a - b));
    const toBlocked = walk.findIndex((row) => row.to_state === 'BLOCKED' && row.reason_code === 'APPROVAL_REQUIRED');
    const granted = walk.findIndex((row) => row.from_state === 'BLOCKED' && row.to_state === 'READY' && row.reason_code === 'APPROVAL_GRANTED');
    expect(toBlocked, 'the walk to BLOCKED by APPROVAL_REQUIRED').toBeGreaterThanOrEqual(0);
    expect(granted, 'then BLOCKED -> READY by APPROVAL_GRANTED').toBeGreaterThan(toBlocked);
    expect(walk.at(-1)).toMatchObject({ to_state: 'COMPLETED' });

    // lifecycle-events.tsv
    const events = (await pool.query(sqlOf('lifecycle-events.tsv'))).rows.filter((row) => row.run_id === runId);
    const requested = events.findIndex((row) => row.event_type === 'julius.approval.requested' && row.approval_id === approvalId);
    const decided = events.findIndex((row) => row.event_type === 'julius.approval.decided' && row.approval_id === approvalId);
    expect(requested).toBeGreaterThanOrEqual(0);
    expect(decided).toBeGreaterThan(requested);
    expect(events[decided]).toMatchObject({ decision: 'APPROVED', decided_by: FOUNDER, operation: 'DISPATCH_WORKER' });
    const buildTask = approvals[0]!.task_id as string;
    const buildDispatch = events.findIndex((row) => row.event_type === 'julius.worker.dispatched' && row.task_id === buildTask);
    expect(buildDispatch, 'the build was dispatched after the decision').toBeGreaterThan(decided);
    expect(events.filter((row) => row.event_type === 'julius.worker.dispatched' && row.task_id === buildTask)).toHaveLength(1);
  });
});
