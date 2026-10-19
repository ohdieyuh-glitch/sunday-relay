import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptedAdapter } from '../src/relay/mission/julius';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import {
  committedApproverAuthority, composeJuliusDecideStore, decideJuliusApprovalGuarded, juliusRunIdForContract,
  loadJuliusApprovalRequestView, parseJuliusApproverAllowlist, parseJuliusWorkflowApprovers,
} from './julius-approval-decide';
import { awaitApprovalComment, buildApprovalRequest, type GithubIssueClient, type GithubIssueComment } from './julius-approval-gw';
import { composeJuliusMissionBootstrap, missionWorkerRequests } from './julius-mission-routes';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { approvalScopesOf, compileBootstrapRequest, gatedCardRevision, parseLiveMissionContract } from './julius/mission-contract';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * V6 G-W AGAINST A REAL POSTGRESQL: `request` AND `await-comment` OVER A GENUINELY HELD RUN.
 *
 * The rules are unit-tested with fakes in julius-approval-gw.test.ts. What only a database can show is that the request is
 * built from the run the job really holds (one PENDING approval, the plan evidence it must cite, the contract's binding),
 * and that an accepted founder comment reaches the production decide path and resumes the run, while a refused or absent
 * one writes NOTHING: the approval stays PENDING and the run stays BLOCKED.
 *
 * Only GitHub is faked (a fixed clock and a scripted issue). The store, the guarded decide, the committed authority and the
 * lifecycle kernel are the production ones. Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const nonce = () => randomBytes(4).toString('hex');
const WORKERS = missionWorkerRequests('hermes');
const STAMP = '2026-10-19T01:00:00.000Z';
const FOUNDER = { login: 'ohdieyuh-glitch', id: 424242 };
const ALLOWLIST = JSON.stringify({ version: 1, approvers: [FOUNDER], operations: ['DISPATCH_WORKER'] });

suite('V6 G-W: request / await-comment over a held run', () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
  });
  afterAll(async () => pool?.end());

  /** A gated contract, bootstrapped and driven until it is HELD. */
  async function heldRun() {
    const id = nonce();
    const raw = JSON.stringify({
      missionId: `mission:gw-${id}`, markerNamespace: `gw-${id}`, projectId: `prj-gw-${id}`, tenantId: `tenant-gw-${id}`,
      objective: 'Write a comparison of the three candidate save-file formats.',
      requirements: ['Compare size, load time and forward compatibility.'], constraints: ['Touch only docs/.'],
      acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
      testCommand: '', workspacePath: '/workspace/gw', limits: { spendUsd: 2, repairCycles: 1 },
      approvalGates: [{ id: 'gate-build', operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'], reason: 'Sign off the plan first.' }],
    });
    const parsed = parseLiveMissionContract(raw);
    if (!parsed.ok) throw new Error(parsed.problem);
    const contract = parsed.contract;
    const cardRevision = gatedCardRevision('card:julius-live:1', contract.approvalGates);
    const submitted = await composeJuliusMissionBootstrap(pool)(`exec-gw-${id}`, contract.tenantId)
      .submit(compileBootstrapRequest(contract, WORKERS, cardRevision));
    if (!submitted.accepted) throw new Error('bootstrap refused');
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
    const outcome = await driveJuliusRunToTerminal({ loop: runtime.loop, store, runId: submitted.runId, projectId: contract.projectId, verification: runtime.verification });
    expect(outcome).toMatchObject({ state: 'BLOCKED', heldForApproval: true });
    return { raw, contract, runId: submitted.runId };
  }

  const authority = () => committedApproverAuthority({
    file: parseJuliusApproverAllowlist(ALLOWLIST),
    workflow: parseJuliusWorkflowApprovers(`${FOUNDER.login}#${FOUNDER.id}`),
  });

  const issueWith = (comments: GithubIssueComment[]): GithubIssueClient => ({
    serverTime: async () => STAMP,
    listComments: async () => comments,
    getComment: async (commentId) => comments.find((row) => row.id === commentId) ?? null,
  });

  async function awaitOn(held: { raw: string; contract: { projectId: string }; runId: string }, comments: GithubIssueComment[], windowMs = 30 * 60_000) {
    const { store, events } = composeJuliusDecideStore(pool);
    const loaded = await loadJuliusApprovalRequestView(store, held.raw);
    if (!loaded.ok) throw new Error(loaded.line);
    const auth = authority();
    let clock = 0;
    return awaitApprovalComment({
      client: issueWith(comments), issue: 9, windowMs, pollMs: 30_000, now: () => clock, sleep: async (ms) => { clock += ms; },
      context: { approvalId: loaded.view.pending[0]!.approvalId, citation: loaded.view.citation!, stamp: STAMP, listed: (who) => auth.listed(who) },
      decide: (decision) => decideJuliusApprovalGuarded({
        runId: held.runId, projectId: held.contract.projectId, approvalId: decision.approvalId, decision: decision.decision,
        approverId: decision.approverId, reason: decision.reason, commentId: decision.commentId,
      }, { store, events, authority: auth, clock: { now: () => new Date().toISOString() } }),
    });
  }

  const commentFor = (body: string, over: Partial<GithubIssueComment> = {}): GithubIssueComment => ({
    id: 5001, user: { ...FOUNDER, type: 'User' }, created_at: '2026-10-19T01:05:00Z', updated_at: '2026-10-19T01:05:00Z', body, ...over,
  });

  it('the request names the one pending approval, its plan evidence and the contract binding, and instructs the exact comment', async () => {
    const held = await heldRun();
    const { store } = composeJuliusDecideStore(pool);
    const loaded = await loadJuliusApprovalRequestView(store, held.raw);
    if (!loaded.ok) throw new Error(loaded.line);
    const built = buildApprovalRequest(loaded.view, STAMP, 30);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines[0]).toContain(`approval=${loaded.view.pending[0]!.approvalId}`);
    expect(built.lines[0]).toContain('task_type=build');
    expect(built.lines[0]).toContain('operation=DISPATCH_WORKER');
    expect(built.lines[2]).toContain(`binding=${compileBootstrapRequest(held.contract as never, [], 'unused').missionBindingDigest}`);
    // The plan task's own evidence id, as the pipeline writes it: run:<id>:plan:<n>:<n>.
    expect(built.citation).toMatch(/^run:[0-9a-f]+:plan:\d+:\d+$/u);
    expect(built.lines[4]).toBe(`TO_DECIDE_COMMENT_EXACTLY: APPROVE ${built.approvalId} plan ${built.citation} reviewed; <your words>`);
  });

  it('an accepted founder comment decides through the production path: APPROVED, the run READY, the founder named', async () => {
    const held = await heldRun();
    const { store } = composeJuliusDecideStore(pool);
    const loaded = await loadJuliusApprovalRequestView(store, held.raw);
    if (!loaded.ok) throw new Error(loaded.line);
    const approvalId = loaded.view.pending[0]!.approvalId;
    const body = `APPROVE ${approvalId} plan ${loaded.view.citation} reviewed; the plan is sound`;
    const result = await awaitOn(held, [commentFor(body)]);
    expect(result).toMatchObject({ exitCode: 0, decision: 'APPROVED' });
    expect(result.lines.some((line) => line.startsWith('APPROVAL_COMMENT_ACCEPTED id=5001 author=github:ohdieyuh-glitch#424242'))).toBe(true);
    const row = await pool.query('SELECT state, decided_by, decision_reason FROM relay_wonderland.julius_approvals WHERE run_id=$1', [held.runId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({ state: 'APPROVED', decided_by: 'github:ohdieyuh-glitch#424242' });
    expect(row.rows[0].decision_reason).toContain(loaded.view.citation);
    const run = await pool.query('SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1', [held.runId]);
    expect(run.rows[0].state).toBe('READY');
  });

  it('a stranger\'s comment, a pre-staged comment and an edited comment write NOTHING: PENDING, BLOCKED, window expiry', async () => {
    const held = await heldRun();
    const { store } = composeJuliusDecideStore(pool);
    const loaded = await loadJuliusApprovalRequestView(store, held.raw);
    if (!loaded.ok) throw new Error(loaded.line);
    const approvalId = loaded.view.pending[0]!.approvalId;
    const body = `APPROVE ${approvalId} plan ${loaded.view.citation} reviewed; the plan is sound`;
    const result = await awaitOn(held, [
      commentFor(body, { id: 1, user: { login: 'stranger', id: 7, type: 'User' } }),
      commentFor(body, { id: 2, created_at: '2026-10-18T20:00:00Z', updated_at: '2026-10-18T20:00:00Z' }),
      commentFor(body, { id: 3, updated_at: '2026-10-19T01:06:00Z' }),
      commentFor(body, { id: 4, user: { ...FOUNDER, type: 'Bot' } }),
    ]);
    expect(result).toMatchObject({ exitCode: 1, decision: 'NONE' });
    expect(result.lines).toEqual(expect.arrayContaining([
      'APPROVAL_COMMENT_REFUSED id=1 reason=NOT_ON_BOTH_LISTS',
      'APPROVAL_COMMENT_REFUSED id=2 reason=NOT_AFTER_REQUEST',
      'APPROVAL_COMMENT_REFUSED id=3 reason=EDITED',
      'APPROVAL_COMMENT_REFUSED id=4 reason=NOT_A_USER',
      `APPROVAL_WINDOW_EXPIRED approval=${approvalId}`,
    ]));
    const row = await pool.query('SELECT state, decided_by FROM relay_wonderland.julius_approvals WHERE run_id=$1', [held.runId]);
    expect(row.rows[0]).toMatchObject({ state: 'PENDING', decided_by: null });
    const run = await pool.query('SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1', [held.runId]);
    expect(run.rows[0].state).toBe('BLOCKED');
  });

  it('the founder\'s DENY is recorded and the run FAILS; the step exit is 5 so the job never resumes it', async () => {
    const held = await heldRun();
    const { store } = composeJuliusDecideStore(pool);
    const loaded = await loadJuliusApprovalRequestView(store, held.raw);
    if (!loaded.ok) throw new Error(loaded.line);
    const body = `DENY ${loaded.view.pending[0]!.approvalId} plan ${loaded.view.citation} reviewed; not this change`;
    const result = await awaitOn(held, [commentFor(body)]);
    expect(result).toMatchObject({ exitCode: 5, decision: 'DENIED' });
    const run = await pool.query('SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1', [held.runId]);
    expect(run.rows[0].state).toBe('FAILED');
  });

  it('a reason that does not cite the plan evidence is refused by the comment rules and nothing is written', async () => {
    const held = await heldRun();
    const { store } = composeJuliusDecideStore(pool);
    const loaded = await loadJuliusApprovalRequestView(store, held.raw);
    if (!loaded.ok) throw new Error(loaded.line);
    const result = await awaitOn(held, [commentFor(`APPROVE ${loaded.view.pending[0]!.approvalId} looks good to me, go ahead`)], 30 * 60_000);
    expect(result.decision).toBe('NONE');
    expect(result.lines).toContain('APPROVAL_COMMENT_REFUSED id=5001 reason=REASON_UNCITED');
    const row = await pool.query('SELECT state FROM relay_wonderland.julius_approvals WHERE run_id=$1', [held.runId]);
    expect(row.rows[0].state).toBe('PENDING');
  });

  it('the request refuses a run that is not held, and a contract that names no run', async () => {
    const held = await heldRun();
    const { store } = composeJuliusDecideStore(pool);
    const other = await loadJuliusApprovalRequestView(store, JSON.stringify({
      ...JSON.parse(held.raw), missionId: `mission:gw-none-${nonce()}`, markerNamespace: `gw-none-${nonce()}`,
    }));
    expect(other).toEqual({ ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=RUN_NOT_FOUND' });
    const target = juliusRunIdForContract(held.raw);
    expect(target.ok).toBe(true);
    // Decide it, then ask again: a granted run (READY) is no longer a held run.
    const loaded = await loadJuliusApprovalRequestView(store, held.raw);
    if (!loaded.ok) throw new Error(loaded.line);
    await awaitOn(held, [commentFor(`APPROVE ${loaded.view.pending[0]!.approvalId} plan ${loaded.view.citation} reviewed; fine`)]);
    expect(await loadJuliusApprovalRequestView(store, held.raw)).toEqual({ ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=RUN_NOT_BLOCKED' });
  });
});
