/**
 * THE STORAGE BOUNDARY OF PAID RUN 36568129865, WITHOUT A DATABASE.
 *
 * `BoundaryClient` answers the way PostgreSQL does at this boundary and nowhere else: a `$n::jsonb`
 * parameter whose JSON holds U+0000 is refused with 22P05, and any other parameter holding U+0000 with
 * 22021. That is a model of PostgreSQL, not PostgreSQL. The same writes against a real one are held by
 * `scripts/julius-live-preflight-identity.test.ts` and, through the real executor, by the preflight;
 * these exist so every CI run, with or without a database, holds the shape of the fix.
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type { ToolInvocationResult } from '../mission/julius';
import { JuliusPostgresRepository } from './julius-postgres';
import { JULIUS_ENCODED_TEXT_MARKER, decodePgJson, decodePgText, encodePgText } from './julius-storage-encoding';
import { JuliusToolPostgresRepository } from './julius-tool-postgres';
import { JuliusToolRecoveryPostgresRepository } from './julius-tool-recovery-postgres';
import { JuliusToolSettlementPostgresRepository } from './julius-tool-settlement-postgres';

const stable = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
const digest = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');

const SECTION = '\u0000JULIUS-SECTION-9f2a\u0000';
const CLOSE_OUT = [`END ${'c'.repeat(40)}\n`, ' M README.md\u0000', 'M\u0000README.md\u0000', '', 'M\u0000README.md\u0000'].join(SECTION);
const INVOCATION = 'run:efb6e20f0d11885bc5085a68:build:status:g1';
const RESULT: ToolInvocationResult = {
  invocationId: INVOCATION, status: 'SUCCEEDED', exitCode: 0, safeSummary: 'Sandbox command completed.', stdout: CLOSE_OUT, stderr: '',
  stdoutRef: null, stderrRef: null, artifacts: [], evidence: [], durationMs: 7,
  resourceUsage: { toolCalls: 1, runtimeMs: 7, outputBytes: Buffer.byteLength(CLOSE_OUT) }, policyDecisionRef: 'card:julius-live:1', mutations: [],
};

const holdsNul = (value: unknown): boolean => typeof value === 'string' ? value.includes('\u0000')
  : Array.isArray(value) ? value.some(holdsNul)
    : value !== null && typeof value === 'object' ? Object.entries(value).some(([key, entry]) => key.includes('\u0000') || holdsNul(entry))
      : false;

type Answer = (sql: string, params: readonly unknown[]) => { rows: unknown[]; rowCount: number } | undefined;
class BoundaryClient {
  readonly commands: string[] = [];
  readonly params: unknown[][] = [];
  constructor(private readonly answer: Answer = () => undefined) {}
  async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const jsonb = new Set([...sql.matchAll(/\$(\d+)::jsonb/gu)].map((match) => Number(match[1]) - 1));
    params.forEach((value, index) => {
      if (typeof value === 'string') {
        if (jsonb.has(index) && holdsNul(JSON.parse(value))) throw Object.assign(new Error('unsupported Unicode escape sequence'), { code: '22P05' });
        if (!jsonb.has(index) && value.includes('\u0000')) throw Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: '22021' });
      }
    });
    this.commands.push(sql);
    this.params.push([...params]);
    return this.answer(sql, params) ?? { rows: [], rowCount: 1 };
  }
  release(): void {}
}
const poolOf = (client: BoundaryClient): Pool => ({ query: client.query.bind(client), connect: async () => client } as unknown as Pool);

const receipt = {
  invocationId: INVOCATION, dispatchGeneration: 1, sandboxId: INVOCATION, executionTokenHash: 'd'.repeat(64), requestDigest: 'a'.repeat(64),
  effectClassification: 'NON_IDEMPOTENT_MUTATION' as const, state: 'COMPLETED_WITH_RESULT' as const, startedAt: '2026-09-29T12:33:48.813Z',
  completedAt: '2026-09-29T12:33:48.900Z', resultDigest: digest(RESULT), beforeStateDigest: '1'.repeat(64), afterStateDigest: '2'.repeat(64),
  result: RESULT, projectId: 'prj-julius-live-6',
};

describe('the executor\'s receipt write: the one paid run 36568129865 died on', () => {
  it('the model refuses what the executor used to send, exactly as PostgreSQL did (22P05)', async () => {
    const client = new BoundaryClient();
    await expect(client.query('SELECT $1::jsonb', [JSON.stringify(RESULT)])).rejects.toMatchObject({ code: '22P05' });
    await expect(client.query('SELECT $1', [CLOSE_OUT])).rejects.toMatchObject({ code: '22021' });
  });

  it('now holds the NUL-separated result, marked, and exactly recoverable', async () => {
    const client = new BoundaryClient();
    expect(await new JuliusToolRecoveryPostgresRepository(poolOf(client)).recordReceipt(receipt)).toBe(true);
    const stored = JSON.parse(String(client.params[0]![13])) as ToolInvocationResult;
    expect(stored.stdout.startsWith(JULIUS_ENCODED_TEXT_MARKER)).toBe(true);
    expect(decodePgJson(stored)).toEqual(RESULT);
    expect(digest(decodePgJson(stored))).toBe(receipt.resultDigest);
  });

  it('still refuses a result whose digest does not cover it, before anything is written', async () => {
    const client = new BoundaryClient();
    await expect(new JuliusToolRecoveryPostgresRepository(poolOf(client)).recordReceipt({ ...receipt, resultDigest: digest({ ...RESULT, stdout: 'other' }) }))
      .rejects.toThrow('tool_receipt_result_invalid');
    expect(client.commands).toEqual([]);
  });
});

describe('the settlement of a NUL-separated result', () => {
  const settlementCommand = {
    settlementId: `settlement:${INVOCATION}`, invocationId: INVOCATION, dispatchGeneration: 1, resultDigest: digest(RESULT), result: RESULT,
    artifacts: [], evidence: [{ evidenceId: `tool:${INVOCATION}`, type: 'COMMAND_EXECUTION' as const, integrityHash: 'e'.repeat(64), facts: { safeSummary: 'Executor ran a shell effect: exit 0.' } }],
    taskOutcome: null, occurredAt: '2026-09-29T12:33:49.000Z',
  };
  /** Answers the settlement's reads with what PostgreSQL would hold: the receipt as the executor now stores it. */
  const settlementClient = (storedReceiptResult: unknown) => new BoundaryClient((sql) => {
    if (sql.startsWith('SELECT settlement_id')) return { rows: [], rowCount: 0 };
    if (sql.includes('SELECT i.*')) return { rows: [{ invocation_id: INVOCATION, dispatch_generation: 1, state: 'DISPATCHING', project_id: 'prj-julius-live-6', tenant_id: 'tenant', run_id: 'run', task_id: 'task', worker_id: 'worker', lease_generation: 1, budget_reservation_id: `budget:${INVOCATION}`, runtime_version: 'r', card_revision: 'card', mission_id: 'mission', mission_contract_revision: 1, project_brain_revision: 0, task_state: 'ACTIVE', task_lease_generation: 1, task_worker_id: 'worker', tool_id: 'shell.bash' }], rowCount: 1 };
    if (sql.includes('julius_tool_execution_receipts WHERE')) return { rows: [{ result: storedReceiptResult, result_digest: digest(RESULT) }], rowCount: 1 };
    if (sql.includes('budget_reservations b JOIN')) return { rows: [{ state: 'RESERVED' }], rowCount: 1 };
    if (sql.includes('RETURNING next_sequence')) return { rows: [{ sequence: '1' }], rowCount: 1 };
    if (sql.includes('SELECT 1 FROM relay_wonderland.julius_evidence')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    return undefined;
  });

  it('settles, with the preview and the settlement\'s result stored marked and decodable to the exact bytes', async () => {
    const storedByExecutor = JSON.parse(JSON.stringify(JSON.parse(String((await (async () => { const c = new BoundaryClient(); await new JuliusToolRecoveryPostgresRepository(poolOf(c)).recordReceipt(receipt); return c.params[0]![13]; })())))));
    const client = settlementClient(storedByExecutor);
    expect((await new JuliusToolSettlementPostgresRepository(poolOf(client)).settle(settlementCommand)).created).toBe(true);
    expect(client.commands.at(-1)).toBe('COMMIT');
    const update = client.params[client.commands.findIndex((sql) => sql.includes('julius_tool_invocations SET state'))]!;
    expect(String(update[4]).startsWith(JULIUS_ENCODED_TEXT_MARKER)).toBe(true);
    expect(decodePgText(String(update[4]))).toBe(CLOSE_OUT.slice(0, 8192));
    const inserted = client.params[client.commands.findIndex((sql) => sql.includes('INSERT INTO relay_wonderland.julius_tool_settlements'))]!;
    expect(decodePgJson(JSON.parse(String(inserted[10])))).toEqual(RESULT);
  });

  it('digests the receipt it reads back in the form it was digested in: the decoded one', async () => {
    // Handed the stored (encoded) receipt, the settlement agrees with the executor's digest.
    const encoded = JSON.parse(JSON.stringify({ ...RESULT, stdout: encodePgText(RESULT.stdout) }));
    await expect(new JuliusToolSettlementPostgresRepository(poolOf(settlementClient(encoded))).settle(settlementCommand)).resolves.toMatchObject({ created: true });
    // Handed a receipt whose decoded result is NOT the one digested, it still refuses as a conflict.
    const other = JSON.parse(JSON.stringify({ ...RESULT, stdout: encodePgText(`${RESULT.stdout}\u0000tampered`) }));
    await expect(new JuliusToolSettlementPostgresRepository(poolOf(settlementClient(other))).settle(settlementCommand)).rejects.toThrow('tool_settlement_receipt_conflict');
  });
});

describe('a settlement that loses a serialization race is replayed, a bounded number of times', () => {
  const command = {
    settlementId: `settlement:${INVOCATION}`, invocationId: INVOCATION, dispatchGeneration: 1, resultDigest: digest(RESULT), result: RESULT,
    artifacts: [], evidence: [], taskOutcome: null, occurredAt: '2026-09-29T12:33:49.000Z',
  };
  /** The settlement's reads answered as PostgreSQL holds them; the run's stream upsert fails with `codes[n]` on attempt n. */
  const racing = (codes: readonly (string | null)[]) => {
    let attempt = -1;
    const client = new BoundaryClient((sql) => {
      if (sql.startsWith('SELECT settlement_id')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT i.*')) return { rows: [{ invocation_id: INVOCATION, dispatch_generation: 1, state: 'DISPATCHING', project_id: 'p', tenant_id: 't', run_id: 'run', task_id: 'task', worker_id: 'w', lease_generation: 1, budget_reservation_id: 'b', runtime_version: 'r', card_revision: 'c', mission_id: 'm', mission_contract_revision: 1, project_brain_revision: 0, task_state: 'ACTIVE', task_lease_generation: 1, task_worker_id: 'w', tool_id: 'shell.bash' }], rowCount: 1 };
      if (sql.includes('julius_tool_execution_receipts WHERE')) return { rows: [{ result: JSON.parse(JSON.stringify({ ...RESULT, stdout: encodePgText(RESULT.stdout) })), result_digest: digest(RESULT) }], rowCount: 1 };
      if (sql.includes('budget_reservations b JOIN')) return { rows: [{ state: 'RESERVED' }], rowCount: 1 };
      if (sql.includes('RETURNING next_sequence')) return { rows: [{ sequence: '1' }], rowCount: 1 };
      return undefined;
    });
    const answer = client.query.bind(client);
    client.query = async (sql: string, params: readonly unknown[] = []) => {
      if (sql.startsWith('BEGIN')) attempt += 1;
      const code = codes[attempt];
      if (sql.includes('RETURNING next_sequence') && code) throw Object.assign(new Error('could not serialize access due to concurrent update'), { code });
      return answer(sql, params);
    };
    return client;
  };
  const begins = (client: BoundaryClient) => client.commands.filter((sql) => sql.startsWith('BEGIN')).length;

  it.each(['40001', '40P01'])('a %s on the first attempt is replayed, and the replay settles', async (code) => {
    const client = racing([code]);
    await expect(new JuliusToolSettlementPostgresRepository(poolOf(client)).settle(command)).resolves.toMatchObject({ created: true });
    expect(begins(client)).toBe(2);
    expect(client.commands.filter((sql) => sql === 'ROLLBACK')).toHaveLength(1);
    expect(client.commands.filter((sql) => sql === 'COMMIT')).toHaveLength(1);
  });

  it('three in a row surface as the database said, after exactly three attempts', async () => {
    const client = racing(['40001', '40P01', '40001']);
    await expect(new JuliusToolSettlementPostgresRepository(poolOf(client)).settle(command)).rejects.toMatchObject({ code: '40001' });
    expect(begins(client)).toBe(3);
    expect(client.commands).not.toContain('COMMIT');
  });

  it('a failure that is not a serialization failure is never replayed', async () => {
    const client = racing(['23505']);
    await expect(new JuliusToolSettlementPostgresRepository(poolOf(client)).settle(command)).rejects.toMatchObject({ code: '23505' });
    expect(begins(client)).toBe(1);
  });
});

describe('a claimed dispatch that will not settle is closed as what it was', () => {
  it('FAILED, with its recovery state, and its outbox row DEAD with the class; only from an open state and this generation', async () => {
    const client = new BoundaryClient();
    const repo = new JuliusToolPostgresRepository(poolOf(client));
    expect(await repo.failDispatch({ invocationId: INVOCATION, dispatchGeneration: 1, failure: 'UNKNOWN_OUTCOME', failureClass: 'executor_unavailable', safeSummary: 'The status effect failed at execute.', completedAt: 't' })).toBe(true);
    const update = client.commands.find((sql) => sql.includes('julius_tool_invocations SET state=\'FAILED\''))!;
    expect(update).toContain("state IN('DISPATCHING','RUNNING')");
    expect(update).toContain('dispatch_generation=$2');
    expect(client.params[client.commands.indexOf(update)]![2]).toBe('UNKNOWN_OUTCOME');
    expect(client.commands.some((sql) => sql.includes("julius_tool_outbox SET state='DEAD'"))).toBe(true);
    expect(client.commands.at(-1)).toBe('COMMIT');
  });

  it('a known no-effect failure keeps recovery NONE, and a class that is not a class is refused', async () => {
    const client = new BoundaryClient();
    const repo = new JuliusToolPostgresRepository(poolOf(client));
    await repo.failDispatch({ invocationId: INVOCATION, dispatchGeneration: 1, failure: 'NO_EFFECT', failureClass: 'executor_unavailable', safeSummary: 's', completedAt: 't' });
    expect(client.params[1]![2]).toBe('NONE');
    await expect(repo.failDispatch({ invocationId: INVOCATION, dispatchGeneration: 1, failure: 'NO_EFFECT', failureClass: 'EXECUTOR_UNAVAILABLE:boom', safeSummary: 's', completedAt: 't' })).rejects.toThrow('tool_dispatch_failure_class_invalid');
  });

  it('writes nothing to the outbox when the dispatch was already settled', async () => {
    const client = new BoundaryClient((sql) => sql.includes("SET state='FAILED'") ? { rows: [], rowCount: 0 } : undefined);
    expect(await new JuliusToolPostgresRepository(poolOf(client)).failDispatch({ invocationId: INVOCATION, dispatchGeneration: 1, failure: 'UNKNOWN_OUTCOME', failureClass: 'tool_settlement_failed', safeSummary: 's', completedAt: 't' })).toBe(false);
    expect(client.commands.some((sql) => sql.includes('julius_tool_outbox'))).toBe(false);
  });

  it('a stored preview is handed back decoded, so a reader receives the bytes, not the storage form', async () => {
    const row = { invocation_id: INVOCATION, idempotency_key: INVOCATION, request_digest: 'a'.repeat(64), tenant_id: 't', project_id: 'p', run_id: 'r', task_id: 'k', worker_id: 'w', lease_generation: '1', policy_revision: 'c', tool_id: 'shell.bash', tool_version: '1', mutation_class: 'WORKSPACE', state: 'SUCCEEDED', sandbox_id: null, budget_reservation_id: null, exit_code: 0, safe_summary: 'Sandbox command completed.', stdout_preview: encodePgText(CLOSE_OUT), stdout_artifact_id: null, stderr_preview: '', stderr_artifact_id: null, evidence_ids: [], artifact_ids: [], duration_ms: 7, requested_at: '2026-09-29T12:33:48.813Z', authorized_at: null, started_at: null, completed_at: '2026-09-29T12:33:49Z' };
    const client = new BoundaryClient((sql) => sql.startsWith('SELECT * FROM relay_wonderland.julius_tool_invocations WHERE invocation_id') ? { rows: [row], rowCount: 1 } : undefined);
    expect((await new JuliusToolPostgresRepository(poolOf(client)).load({ invocationId: INVOCATION, tenantId: 't', projectId: 'p' }))?.stdoutPreview).toBe(CLOSE_OUT);
  });

  it('a finished run opens no new invocation', async () => {
    const task = (runState: string) => new BoundaryClient((sql) => sql.includes('SELECT t.lease_generation')
      ? { rows: [{ lease_generation: '1', state: 'ACTIVE', worker_id: 'w', lease_owner: 'owner', lease_valid: true, card_revision: 'c', run_state: runState, tenant_member: true }], rowCount: 1 }
      : sql.includes('INSERT INTO relay_wonderland.julius_tool_invocations') ? { rows: [{ invocation_id: 'i', idempotency_key: 'i', request_digest: 'a'.repeat(64), tenant_id: 't', project_id: 'p', run_id: 'r', task_id: 'k', worker_id: 'w', lease_generation: '1', policy_revision: 'c', tool_id: 'shell.bash', tool_version: '1', mutation_class: 'WORKSPACE', state: 'REQUESTED', requested_at: '2026-09-29T00:00:00Z' }], rowCount: 1 }
        : sql.startsWith('SELECT * FROM') ? { rows: [], rowCount: 0 } : undefined);
    const input = { invocationId: 'i', idempotencyKey: 'i', requestDigest: 'a'.repeat(64), tenantId: 't', projectId: 'p', runId: 'r', taskId: 'k', workerId: 'w', leaseGeneration: 1, policyRevision: 'c', toolId: 'shell.bash' as const, toolVersion: '1', mutationClass: 'WORKSPACE' as const, requestedAt: '2026-09-29T00:00:00Z' };
    for (const terminal of ['FAILED', 'COMPLETED', 'CANCELLED']) {
      await expect(new JuliusToolPostgresRepository(poolOf(task(terminal))).request(input)).rejects.toThrow('tool_run_terminal');
    }
    expect((await new JuliusToolPostgresRepository(poolOf(task('EXECUTING'))).request(input)).created).toBe(true);
  });
});

describe('the terminal-state invariant at the run\'s terminal transition', () => {
  const runRow = { run_id: 'run', mission_id: 'mission', project_id: 'project', state: 'EXECUTING', card_revision: 'card', mission_contract_revision: '1', project_brain_revision: '0', version: '4' };
  const transitioned = (closed: readonly Record<string, string>[]) => new BoundaryClient((sql, params) => {
    if (sql.startsWith('SELECT * FROM relay_wonderland.julius_runs')) return { rows: [runRow], rowCount: 1 };
    if (sql.includes('RETURNING *')) return { rows: [{ ...runRow, state: params[1], version: '5' }], rowCount: 1 };
    if (sql.includes('RETURNING next_sequence')) return { rows: [{ sequence: '1' }], rowCount: 1 };
    if (sql.includes('WITH open AS')) return { rows: [...closed], rowCount: closed.length };
    if (sql.startsWith('SELECT sequence,payload FROM relay_wonderland.events')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT 1 FROM relay_wonderland.julius_runs')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    return undefined;
  });
  /** The parameters of the event INSERT that carries this id; the existence check before it carries the id too. */
  const eventInsert = (client: BoundaryClient, eventId: string): unknown[] | undefined =>
    client.params.find((params, index) => params[0] === eventId && client.commands[index]!.startsWith('INSERT INTO relay_wonderland.events'));
  const transition = (client: BoundaryClient, to: 'FAILED' | 'WAITING') => new JuliusPostgresRepository(poolOf(client)).transition({
    commandId: 'end', runId: 'run', projectId: 'project', expectedVersion: 4, to, reasonCode: 'TASK_FAILED', safeSummary: 'Run ended.', evidenceIds: [], occurredAt: '2026-09-29T12:33:49.546Z',
  });

  it('a terminal transition closes every open invocation of the run in the same transaction, and surfaces each by name', async () => {
    const client = transitioned([{ invocation_id: INVOCATION, task_id: 'task', prior_state: 'DISPATCHING', state: 'FAILED', recovery_state: 'UNKNOWN_OUTCOME' }]);
    expect((await transition(client, 'FAILED')).state).toBe('FAILED');
    const sweep = client.commands.find((sql) => sql.includes('WITH open AS'))!;
    expect(sweep).toContain("state IN('REQUESTED','AUTHORIZED','DISPATCHING','RUNNING')");
    expect(sweep).toContain("'UNKNOWN_OUTCOME'");
    expect(client.params[client.commands.indexOf(sweep)]!.slice(0, 2)).toEqual(['run', 'project']);
    expect(client.commands.some((sql) => sql.includes("julius_tool_outbox SET state='DEAD'"))).toBe(true);
    const event = eventInsert(client, `julius:tool-invocation-closed:${INVOCATION}`);
    expect(event, 'a recovery.action names the closed invocation').toBeDefined();
    expect(event![4]).toBe('julius.recovery.action');
    const facts = (JSON.parse(String(event![5])) as { facts: Record<string, string> }).facts;
    expect(facts).toMatchObject({ code: 'TOOL_INVOCATION_UNRESOLVED', failureClass: 'infrastructure_evidence_integrity', invocationId: INVOCATION, priorState: 'DISPATCHING', closedAs: 'FAILED', recoveryState: 'UNKNOWN_OUTCOME', runTerminalState: 'FAILED' });
    expect(client.commands.indexOf(sweep), 'inside the transition, before it commits').toBeLessThan(client.commands.lastIndexOf('COMMIT'));
  });

  it('a transition that is not terminal sweeps nothing', async () => {
    const client = transitioned([]);
    await transition(client, 'WAITING');
    expect(client.commands.some((sql) => sql.includes('WITH open AS'))).toBe(false);
  });

  it('an invocation id the event rules would refuse is named by digest, and never keeps the run from ending', async () => {
    const hostile = 'run:x:build:token: leaked:g1';
    const client = transitioned([{ invocation_id: hostile, task_id: 'task', prior_state: 'RUNNING', state: 'FAILED', recovery_state: 'UNKNOWN_OUTCOME' }]);
    expect((await transition(client, 'FAILED')).state).toBe('FAILED');
    const event = eventInsert(client, `julius:tool-invocation-closed:${hostile}`)!;
    const facts = (JSON.parse(String(event[5])) as { facts: Record<string, string> }).facts;
    expect(facts.invocationId).toBeUndefined();
    expect(facts.invocationDigest).toBe(createHash('sha256').update(hostile).digest('hex'));
  });
});
