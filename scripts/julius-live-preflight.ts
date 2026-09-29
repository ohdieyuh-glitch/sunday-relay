/**
 * THE PROVIDER-FREE HALF OF THE FIRST LIVE MISSION'S PREFLIGHT.
 *
 * The live entrypoint's own preflight proves that the three C.A.R.D. roles
 * resolve and that every required variable is present, and it stops before
 * contacting anything (exit 5). What it cannot prove without spending money is
 * that the INFRASTRUCTURE underneath actually works. This script proves that
 * half, by driving one real sandbox round-trip through the independent
 * executor — create, prepare, execute, destroy — using the same control-plane
 * client, the same scoped credentials, the same signed-receipt verification
 * and the same sandbox limits the live mission will use.
 *
 * WHAT ONE ROUND-TRIP ACTUALLY ESTABLISHES:
 *   - the executor is reachable and answers on its scoped surface;
 *   - the derived `execute` credential authorizes a real operation;
 *   - the receipts verify against JULIUS_PUBLIC_KEY_PATH, so attestation is
 *     configured and the executor holds the matching private key;
 *   - the workspace ceiling is ENFORCEABLE — the executor refuses a workspace
 *     whose backing filesystem is larger than the declared bytes, so a
 *     successful prepare is proof the tmpfs is real and correctly sized;
 *   - the bind mount is live and `git` inside the sandbox accepts the
 *     repository's ownership;
 *   - and, decisively, that a change written on the HOST actually appears in
 *     the diff the sandbox captures. That last one is the whole reason this
 *     exists: the coding agent edits on the host and the DIFF is captured by
 *     a sandbox command, so anything that breaks that hand-off — git refusing
 *     the repository's ownership, an untracked file `git diff` cannot see, a
 *     mount that is not live — yields an empty diff and an independent review
 *     of NOTHING, after the mission has already paid an architect and a
 *     coding agent. Proving `git rev-parse` alone would not catch it.
 *
 * IT SPENDS NOTHING. No provider client is constructed and no credential is
 * printed; the commands it runs are `git rev-parse HEAD`, `git ls-files`,
 * `git --no-pager diff` and the coding adapter's own attempt start and
 * close-out snapshots — reads, apart from the unreferenced tree objects a
 * snapshot writes, and all but `ls-files` the ones the live coding adapter
 * itself issues — and it restores, byte for byte, the one file it touched. WHICH file that is, it asks git rather than assuming: see
 * `julius-live-probe-file.ts`, and run 34433098911, where the assumed name did
 * not exist in the first mission sliced out of Sunday Relay.
 *
 * AND THE CLOSE-OUT, SETTLED — paid run 36568129865. The coder's attempt
 * close-out (`juliusAttemptCloseCommand`) prints NUL-separated sections by
 * design, and no provider-free path had ever run it: the executor's receipt
 * insert died on it with SQLSTATE 22P05, answered 500, and left the invocation
 * DISPATCHING. So this probe now takes the attempt's start snapshot and its
 * close-out with the adapter's OWN commands (they write only unreferenced git
 * objects and a temporary index in the sandbox's tmpfs, never the real index),
 * and SETTLES every effect it runs through the production settlement
 * repository, exactly as the live shell port does (`shell-settlement.ts`). It
 * then proves, on this database: the close-out settled SUCCEEDED, a failing
 * close-out settled FAILED with its exit code, both stored under the explicit
 * `nul-escaped-v1` marker and decoded to the exact bytes Julius received,
 * nothing it dispatched was left open, the pre-fix write forms are still
 * refused here (the control), and a run made terminal with a dispatch still
 * open closes it and says so (the terminal-state invariant).
 *
 * IT IS A LEGITIMATE PARTICIPANT IN THE DURABLE SCHEMA. Free dry run #2
 * (run 33635375764) failed at its first `createSandbox` with SQLSTATE 23503:
 * this probe had invented a project, a run, a task and an invocation and
 * seeded none of them, while the executor's sandbox record references all
 * four. It now seeds a disposable, nonce-scoped identity in foreign-key order
 * before the first request (`julius-live-preflight-identity.ts`), records
 * each invocation through the production tool repository as the live mission
 * does, and removes exactly what it created afterwards, reporting anything
 * that remains rather than hiding it.
 */

import { execFile } from 'node:child_process';
import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { RemoteExecutorControlPlane } from '../src/relay/workspace/julius-tools/remote-executor-control-plane';
import type { ExecutorOperation } from '../src/relay/workspace/julius-tools/executor-operation-request';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { JuliusToolPostgresRepository } from '../src/relay/persistence/julius-tool-postgres';
import { JuliusToolSettlementPostgresRepository } from '../src/relay/persistence/julius-tool-settlement-postgres';
import { JULIUS_ENCODED_TEXT_MARKER, decodePgJson, decodePgText, pgJson } from '../src/relay/persistence/julius-storage-encoding';
import { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } from '../relay-bridge/julius/sandbox-limits';
import { juliusAttemptCloseCommand, juliusAttemptStartCommand, parseJuliusAttemptClose, parseJuliusAttemptStart } from '../relay-bridge/julius/coder-workspace';
import { classifyExecutorRefusal, shellDispatchClosure, shellEffectSettlement, type ShellEffectStage } from '../relay-bridge/julius/shell-settlement';
import { cleanupPreflightIdentity, migrateIfNeeded, preflightIdentityFor, preflightNonce, seedPreflightIdentity, seedPreflightInvocation, type PreflightIdentity } from './julius-live-preflight-identity';
import { resolveProbeFile } from './julius-live-probe-file';
import type {
  JuliusSandboxLimits,
  JuliusSandboxPolicy,
  ToolInvocationRequest,
  ToolInvocationResult,
} from '../src/relay/mission/julius';

/**
 * THE SAME OBJECTS THE LIVE COMPOSITION SENDS — not equal copies, the objects
 * themselves. They come from `relay-bridge/julius/sandbox-limits`, a pure
 * constants module, rather than from `executor-effects.ts`, which reaches the
 * provider connectors; so this script still contacts no provider and there is
 * no copy here to drift. Dry run 33625851653 failed because the copy that used
 * to live here, and its twin in the composition, both asked for 4,767 bytes
 * more output than the executor's ceiling allows. `outputBytes` is now that
 * ceiling, imported from the validator's own module, and
 * `julius-first-live-mission.test.ts` asserts identity, not mere equality.
 */
export const PREFLIGHT_LIMITS: JuliusSandboxLimits = EXECUTOR_SANDBOX_LIMITS;
export const PREFLIGHT_POLICY: JuliusSandboxPolicy = EXECUTOR_SANDBOX_POLICY;

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Canonical JSON, identical to the live shell port and the executor. */
const stable = (value: unknown): string => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
export const digestOf = (value: unknown): string => sha(stable(value));

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`preflight_config_missing:${name}`);
  return value;
};

/**
 * The durable half: the live run refuses without PostgreSQL, and it applies
 * the migration itself on first use. Applying it HERE means a schema problem
 * surfaces before a provider is ever paid, and the tables the Julius runtime
 * writes are proven to exist rather than assumed.
 */
async function proveDurableStore(pool: Pool, out: (line: string) => void): Promise<boolean> {
  try {
    const version = await pool.query<{ server_version: string }>('SHOW server_version');
    out(`  PostgreSQL reachable: server_version=${version.rows[0]?.server_version ?? 'unknown'}`);

    // `migrate()` applies only the versions `schema_migrations` does not already
    // hold, so this is safe against an empty database, a partly migrated one and
    // a current one alike. The line below reports what was MEASURED: saying
    // "empty database" because something was applied was wrong for the one case
    // the version ledger exists to serve — a database at 021 receiving 022.
    const migration = await migrateIfNeeded(pool);
    out(migration.applied.length === 0
      ? `  migrations already current (${migration.alreadyPresent} present)`
      : `  migrations applied: ${migration.applied.join(', ')} (${migration.alreadyPresent} already present)`);

    // Naming the tables the run actually writes turns "migrate() returned"
    // into "the schema the runtime needs is present".
    const required_tables = ['julius_runs', 'julius_tasks', 'julius_acceptance_criteria', 'julius_verification_decisions'];
    const present = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='relay_wonderland' AND table_name = ANY($1::text[])`,
      [required_tables],
    );
    const found = new Set(present.rows.map((row) => row.table_name));
    const missing = required_tables.filter((table) => !found.has(table));
    if (missing.length > 0) {
      out(`PREFLIGHT FAILED: the migration left these tables absent: ${missing.join(', ')}`);
      return false;
    }
    out(`  schema verified: ${required_tables.length} Julius tables present in relay_wonderland`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    out(`PREFLIGHT FAILED: the durable store refused — ${message.slice(0, 200)}`);
    return false;
  }
}

async function main(): Promise<number> {
  const out = (line: string): void => { process.stdout.write(`${line}\n`); };
  const pool = new Pool({ connectionString: required('DATABASE_URL') });
  let identity: PreflightIdentity | null = null;
  let code = 1;
  let cleanupFailed = false;
  try {
    out('JULIUS LIVE PREFLIGHT — durable store');
    if (!await proveDurableStore(pool, out)) return 1;

    const tenantId = process.env.JULIUS_TENANT_ID ?? 'tenant';
    const policyRevision = process.env.RELAY_JULIUS_CARD_REVISION ?? 'card:julius-live:1';
    identity = preflightIdentityFor({ tenantId, nonce: preflightNonce(), policyRevision });
    // Eight executor requests at most, each bounded by the request timeout, plus a margin.
    const requestTimeoutMs = Number(process.env.JULIUS_REQUEST_TIMEOUT_MS ?? '120000');
    await seedPreflightIdentity(pool, identity, { leaseMinutes: Math.ceil((8 * requestTimeoutMs + 120_000) / 60_000) });
    out(`  preflight identity seeded in foreign-key order: project=${identity.projectId} run=${identity.runId} task=${identity.taskId}`);

    code = await roundTrips(pool, identity, out);
  } finally {
    // What the preflight created, the preflight removes — and says so either way.
    if (identity !== null) {
      try {
        const report = await cleanupPreflightIdentity(pool, identity);
        const summary = Object.entries(report.deleted).filter(([, count]) => count > 0).map(([table, count]) => `${table}=${count}`).join(' ');
        if (report.remaining > 0) {
          out(`PREFLIGHT CLEANUP FAILED: ${report.remaining} row(s) still carry ${identity.projectId} after cleanup (deleted: ${summary || 'nothing'}).`);
          cleanupFailed = true;
        } else {
          out(`  preflight identity removed (${summary || 'nothing to delete'}); nothing of ${identity.projectId} remains.`);
        }
      } catch (error) {
        out(`PREFLIGHT CLEANUP FAILED: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'} — rows of ${identity.projectId} may remain.`);
        cleanupFailed = true;
      }
    }
    await pool.end().catch(() => undefined);
  }
  // A proof that left junk behind is not a clean proof: cleanup failure is its own exit 1, never hidden behind a passing round trip.
  return code === 0 && cleanupFailed ? 1 : code;
}

async function roundTrips(pool: Pool, identity: PreflightIdentity, out: (line: string) => void): Promise<number> {
  const workspace = required('JULIUS_WORKSPACE');
  const callerId = required('JULIUS_CALLER_ID');
  const { tenantId } = identity;

  let scopedEntries: Record<string, string>;
  try {
    scopedEntries = JSON.parse(required('JULIUS_SCOPED_CREDENTIALS')) as Record<string, string>;
  } catch {
    // The parser's own error quotes a slice of its input, and the input is a
    // credential map — so the message is composed here instead.
    out('PREFLIGHT FAILED: JULIUS_SCOPED_CREDENTIALS is not valid JSON. Its content is never echoed.');
    return 1;
  }
  const scoped = new Map(Object.entries(scopedEntries)) as ReadonlyMap<ExecutorOperation, string>;
  for (const operation of ['create', 'prepare', 'execute', 'destroy'] as const) {
    if (!scoped.get(operation)) {
      out(`PREFLIGHT FAILED: JULIUS_SCOPED_CREDENTIALS has no "${operation}" credential. Its content is never echoed.`);
      return 1;
    }
  }

  const trustedReceiptKeys = new Map<string, KeyObject>([[
    required('EXECUTOR_KEY_ID'),
    createPublicKey(readFileSync(required('JULIUS_PUBLIC_KEY_PATH'), 'utf8')),
  ]]);

  const client = new RemoteExecutorControlPlane({
    endpoint: new URL(required('JULIUS_EXECUTOR_ENDPOINT')),
    serviceCredential: scoped.get('execute') as string,
    scopedCredentials: scoped,
    callerId,
    tenantId,
    requestTimeoutMs: Number(process.env.JULIUS_REQUEST_TIMEOUT_MS ?? '120000'),
    trustedReceiptKeys,
    allowInsecureLoopbackForTests: process.env.JULIUS_EXECUTOR_ALLOW_LOOPBACK === '1',
  });

  const { leaseGeneration, projectId } = identity;
  let step = 0;
  const tools = new JuliusToolPostgresRepository(pool);
  const settlement = new JuliusToolSettlementPostgresRepository(pool);

  /** The request every preflight invocation makes: the live shell port's shape, one command. */
  const requestFor = (invocationId: string, command: string): ToolInvocationRequest => ({
    invocationId,
    runId: identity.runId,
    taskId: identity.taskId,
    projectId,
    workerId: identity.workerId,
    toolId: 'shell.bash', toolVersion: '1',
    arguments: { command },
    cwd: '.',
    idempotencyKey: invocationId,
    timeoutMs: 30_000,
    expectedMutation: 'WORKSPACE',
  });

  /* Receipts live at the host path the executor was given (the mission's transport) or under the
   * executor's private root; either way a sandbox must never see that path itself. */
  const hostReceiptRoot = process.env.JULIUS_RECEIPT_HOST_ROOT?.trim() || '/executor-private/receipts';
  /** The sandbox that ran before the current one, for the sibling-scope check. */
  let previousSandboxId = '';
  /**
   * One full create → prepare → execute → destroy round-trip, as the mission does it, SETTLED as the
   * live shell port settles it (`shellEffectSettlement` through the production settlement repository)
   * and, when the executor refuses, CLOSED as the live port closes it (`shellDispatchClosure`). Paid run
   * 36568129865 failed on a settlement no provider-free path had ever made; now every effect here makes one.
   */
  const runInSandbox = async (
    command: string,
    afterPrepare?: (sandboxId: string) => Promise<void>,
    via: { readonly settle: JuliusToolSettlementPostgresRepository['settle'] } = settlement,
  ): Promise<ToolInvocationResult> => {
    step += 1;
    const invocationId = `preflight:${identity.nonce}:${step}`;
    const request = requestFor(invocationId, command);
    const sandboxIdentity = {
      sandboxId: invocationId, invocationId, tenantId,
      projectId, runId: request.runId, taskId: request.taskId,
      leaseGeneration, policyRevision: identity.policyRevision,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    // The invocation exists, REQUESTED then AUTHORIZED, before the executor is
    // asked to record a sandbox that references it — the order the live
    // mission follows and the order the foreign keys enforce.
    const { dispatchGeneration } = await seedPreflightInvocation(pool, identity, { invocationId, requestDigest: digestOf(request), requestedAt: sandboxIdentity.createdAt });
    const close = (stage: ShellEffectStage, failureClass: string, refusal: ReturnType<typeof classifyExecutorRefusal>['refusal'] | null) =>
      tools.failDispatch(shellDispatchClosure({ invocationId, invocationKey: invocationId, dispatchGeneration, stage, refusal, failureClass, completedAt: new Date().toISOString() }))
        .catch(() => false);
    let stage: ShellEffectStage = 'create';
    let result: ToolInvocationResult;
    try {
      await client.createSandbox({ identity: sandboxIdentity, policy: PREFLIGHT_POLICY, limits: PREFLIGHT_LIMITS });
      stage = 'prepare';
      await client.prepareWorkspace({
        sandboxId: invocationId, sourceRef: workspace, expectedLeaseGeneration: leaseGeneration,
      });
      if (afterPrepare) await afterPrepare(invocationId);
      stage = 'execute';
      result = await client.executeTool({
        sandboxId: invocationId, expectedLeaseGeneration: leaseGeneration,
        dispatchGeneration, requestDigest: digestOf(request),
        executionTokenHash: sha(`token:${invocationId}`),
        effectClassification: 'NON_IDEMPOTENT_MUTATION', request,
      });
    } catch (error) {
      // Closed as what it was, never left DISPATCHING; the refusal itself is still the answer.
      const { refusal } = classifyExecutorRefusal(error);
      await close(stage, refusal, refusal);
      throw error;
    } finally {
      await client.destroySandbox({
        sandboxId: invocationId, expectedLeaseGeneration: leaseGeneration,
        reason: 'preflight round-trip finished',
      }).catch(() => undefined);
      previousSandboxId = invocationId;
    }
    try {
      const settled = await via.settle(shellEffectSettlement({
        invocationId, dispatchGeneration, result,
        safeSummary: `Preflight shell effect ${step} settled: exit ${result.exitCode ?? 'unknown'}.`,
        occurredAt: new Date().toISOString(),
      }));
      if (!settled.created) throw new Error('settlement_not_created');
    } catch (error) {
      await close('settle', 'tool_settlement_failed', null);
      throw new Error(`preflight_settlement_failed:${invocationId}:${error instanceof Error ? error.message.slice(0, 160) : 'unknown'}`);
    }
    return result;
  };

  /**
   * WHAT THE STORE HOLDS FOR ONE SETTLED CLOSE-OUT, read back and checked against what Julius received.
   * The invocation reached the state its exit code says; the preview, the receipt's result and the
   * settlement's result each carry the `nul-escaped-v1` marker and decode to the exact bytes; every
   * stored digest covers the DECODED value; and the parser reads the raw output as the adapter does.
   */
  const proveSettledCloseOut = async (result: ToolInvocationResult, expected: { readonly exitCode: number; readonly state: 'SUCCEEDED' | 'FAILED' }, probe: string): Promise<string[]> => {
    const problems: string[] = [];
    if (result.exitCode !== expected.exitCode || result.status !== expected.state) problems.push(`the executor answered ${result.status}/exit ${result.exitCode ?? 'unknown'}, expected ${expected.state}/exit ${expected.exitCode}`);
    if (!result.stdout.includes('\u0000')) problems.push('the output reached Julius without a NUL, so the NUL-separated path was not exercised');
    const parsed = parseJuliusAttemptClose(result.stdout, true);
    if (parsed.endTree === null) problems.push('the parser found no end tree in the close-out');
    if (!(parsed.own ?? []).some((change) => change.path === probe)) problems.push(`the attempt's own changes do not name ${probe}`);
    if (!parsed.status.changes.some((change) => change.path === probe)) problems.push(`the change set does not name ${probe}`);
    const invocation = (await pool.query<{ state: string; exit_code: number | null; stdout_preview: string; recovery_state: string }>(
      'SELECT state, exit_code, stdout_preview, recovery_state FROM relay_wonderland.julius_tool_invocations WHERE invocation_id=$1', [result.invocationId])).rows[0];
    if (invocation === undefined) return [...problems, 'the invocation row is missing'];
    if (invocation.state !== expected.state || Number(invocation.exit_code) !== expected.exitCode) problems.push(`the invocation settled ${invocation.state}/exit ${invocation.exit_code ?? 'none'}`);
    if (invocation.recovery_state !== 'RECONCILED') problems.push(`the invocation's recovery state is ${invocation.recovery_state}`);
    if (!invocation.stdout_preview.startsWith(JULIUS_ENCODED_TEXT_MARKER)) problems.push('the stored preview carries no encoding marker');
    else if (decodePgText(invocation.stdout_preview) !== result.stdout.slice(0, 8192)) problems.push('the stored preview does not decode to the bytes Julius received');
    const receipt = (await pool.query<{ result: { stdout?: unknown }; result_digest: string }>(
      'SELECT result, result_digest FROM relay_wonderland.julius_tool_execution_receipts WHERE invocation_id=$1', [result.invocationId])).rows[0];
    if (receipt === undefined) return [...problems, 'the executor recorded no receipt row'];
    const recorded = decodePgJson<ToolInvocationResult>(receipt.result);
    if (!String(receipt.result.stdout ?? '').startsWith(JULIUS_ENCODED_TEXT_MARKER)) problems.push('the receipt result carries no encoding marker');
    if (recorded.stdout !== result.stdout) problems.push('the receipt result does not decode to the bytes Julius received');
    if (digestOf(recorded) !== receipt.result_digest) problems.push('the receipt digest does not cover the decoded result');
    const settled = (await pool.query<{ result: unknown; result_digest: string }>(
      'SELECT result, result_digest FROM relay_wonderland.julius_tool_settlements WHERE invocation_id=$1', [result.invocationId])).rows[0];
    if (settled === undefined) problems.push('no settlement row');
    else if (digestOf(decodePgJson(settled.result)) !== settled.result_digest || settled.result_digest !== receipt.result_digest) problems.push('the settlement does not decode to the receipt\'s result');
    return problems;
  };

  /**
   * THE TERMINAL-STATE INVARIANT, with this preflight's own disposable run: a dispatch claimed and
   * never executed, then the run made FAILED through the production repository, as paid run
   * 36568129865's run was with its close-out still DISPATCHING. Afterwards nothing of the run may be
   * open, the dispatch must read FAILED/UNKNOWN_OUTCOME, a `recovery.action` must name it, and a new
   * invocation on the finished run must be refused. No executor request is made, so nothing here can
   * add an executor refusal to the topology job's diagnostics.
   */
  const proveTerminalInvariant = async (): Promise<string[]> => {
    step += 1;
    const invocationId = `preflight:${identity.nonce}:${step}`;
    await seedPreflightInvocation(pool, identity, { invocationId, requestDigest: digestOf(requestFor(invocationId, 'true')), requestedAt: new Date().toISOString() });
    const runs = new JuliusPostgresRepository(pool);
    const run = await runs.loadRun(identity.runId, projectId);
    if (run === null) return ['the preflight run is missing'];
    await runs.transition({
      commandId: `preflight-invariant:${identity.nonce}`, runId: identity.runId, projectId, expectedVersion: run.version,
      to: 'FAILED', reasonCode: 'PREFLIGHT_INVARIANT_PROBE',
      safeSummary: 'The provider-free preflight ended its disposable run with one dispatch still open, to prove the terminal-state invariant.',
      evidenceIds: [], occurredAt: new Date().toISOString(),
    });
    const problems: string[] = [];
    const closed = (await pool.query<{ state: string; recovery_state: string }>(
      'SELECT state, recovery_state FROM relay_wonderland.julius_tool_invocations WHERE invocation_id=$1', [invocationId])).rows[0];
    if (closed?.state !== 'FAILED' || closed.recovery_state !== 'UNKNOWN_OUTCOME') problems.push(`the open dispatch was left ${closed?.state ?? 'missing'}/${closed?.recovery_state ?? 'missing'}`);
    const stillOpen = (await pool.query<{ open: string }>(
      `SELECT count(*) AS open FROM relay_wonderland.julius_tool_invocations WHERE run_id=$1 AND project_id=$2 AND state IN('REQUESTED','AUTHORIZED','DISPATCHING','RUNNING')`,
      [identity.runId, projectId])).rows[0];
    if (Number(stillOpen?.open ?? 0) !== 0) problems.push(`${stillOpen?.open ?? '?'} invocation(s) of the terminal run are still open`);
    const surfaced = (await pool.query<{ code: string | null }>(
      `SELECT payload->'facts'->>'code' AS code FROM relay_wonderland.events WHERE event_id=$1 AND event_type='julius.recovery.action'`,
      [`julius:tool-invocation-closed:${invocationId}`])).rows[0];
    if (surfaced?.code !== 'TOOL_INVOCATION_UNRESOLVED') problems.push('no integrity event names the closed dispatch');
    const late = `preflight:${identity.nonce}:late`;
    const answer = await tools.request({
      invocationId: late, idempotencyKey: late, requestDigest: digestOf(requestFor(late, 'true')),
      tenantId, projectId, runId: identity.runId, taskId: identity.taskId, workerId: identity.workerId,
      leaseGeneration, policyRevision: identity.policyRevision, toolId: 'shell.bash', toolVersion: '1',
      mutationClass: 'WORKSPACE', requestedAt: new Date().toISOString(),
    }).then(() => 'ACCEPTED', (error: unknown) => (error instanceof Error ? error.message : 'refused'));
    if (answer !== 'tool_run_terminal') problems.push(`a new invocation on the terminal run was answered ${answer}`);
    return problems;
  };

  /* THE RECEIPT SCOPE, FROM THE DAEMON'S OWN MOUNT TABLE. The workload inside a sandbox runs as
   * uid 65532 and the scoped receipt directory is root:root 0700, so nothing run inside can even
   * list /julius-receipts-root — which is itself a property worth proving, and which makes an
   * in-sandbox listing useless as a scope proof. So the proof is taken by this operator-side probe
   * from the host, between prepare and execute, while the sandbox exists: `docker inspect` of the
   * container the executor labelled with this sandbox id must show exactly one receipt mount, its
   * source the sandbox's own sha256 scope under the receipt root, and no mount of the root itself,
   * of an earlier sandbox's scope, or of anything under /executor-private. Julius never holds the
   * Docker socket; this probe runs as the operator that started the executor and already does. */
  const dockerBinary = process.env.JULIUS_PREFLIGHT_DOCKER_BINARY ?? '/usr/bin/docker';
  const docker = promisify(execFile);
  const proveReceiptScope = async (sandboxId: string): Promise<void> => {
    const listed = await docker(dockerBinary, ['ps', '-aq', '--filter', `label=julius.sandbox=${sandboxId}`]).catch((error: Error) => {
      throw new Error(`preflight_docker_unavailable:${error.message.slice(0, 80)}`);
    });
    const containers = listed.stdout.trim().split('\n').filter(Boolean);
    if (containers.length !== 1) throw new Error(`preflight_sandbox_container_count:${containers.length}`);
    const inspected = await docker(dockerBinary, ['inspect', '--format', '{{json .Mounts}}', containers[0] as string]);
    const mounts = JSON.parse(inspected.stdout) as Array<{ Type: string; Source: string; Destination: string; RW: boolean }>;
    const expectedSource = join(hostReceiptRoot, sha(sandboxId));
    const receiptMounts = mounts.filter((mount) => mount.Destination === '/julius-receipts-root');
    const problems: string[] = [];
    if (receiptMounts.length !== 1) problems.push(`receipt_mounts=${receiptMounts.length}`);
    if (receiptMounts[0] && (receiptMounts[0].Type !== 'bind' || receiptMounts[0].Source !== expectedSource)) problems.push('receipt_mount_is_not_the_sandbox_scope');
    for (const mount of mounts) {
      if (mount.Source === hostReceiptRoot) problems.push('whole_receipt_root_mounted');
      if (previousSandboxId && mount.Source === join(hostReceiptRoot, sha(previousSandboxId))) problems.push('earlier_sandbox_scope_mounted');
      if (mount.Source.startsWith('/executor-private') || mount.Destination.startsWith('/executor-private')) problems.push('executor_private_mounted');
      if (mount.Destination.startsWith('/julius-receipts-root/')) problems.push('receipt_subpath_mounted');
      if (mount.Type === 'bind' && !['/workspace', '/julius-receipts-root'].includes(mount.Destination)) problems.push(`unexpected_bind:${mount.Destination}`);
    }
    if (problems.length > 0) throw new Error(`preflight_receipt_scope_violation:${problems.join(',')}`);
    out(`  receipt scope (daemon mount table): one bind, ${hostReceiptRoot}/<sha256(sandboxId)> → /julius-receipts-root; no root, no earlier scope, nothing under /executor-private.`);
  };

  out('JULIUS LIVE PREFLIGHT — independent executor round-trip');
  out(`  workspace: ${workspace}`);
  out(`  caller: ${callerId} tenant: ${tenantId}`);
  out(`  sandbox: network=${PREFLIGHT_POLICY.network} workspaceBytes=${PREFLIGHT_LIMITS.workspaceBytes} outputBytes=${PREFLIGHT_LIMITS.outputBytes}`);

  const marker = `julius-live-preflight-${Date.now()}`;
  /* Resolved from git's own tracked list once the sandbox is proven, never
   * assumed from a filename. See `julius-live-probe-file.ts`. */
  let probeFile: string | null = null;
  let probePath = '(none chosen)';
  let restore: Buffer | null = null;
  try {
    const result = await runInSandbox('git rev-parse HEAD');
    out('  createSandbox / prepareWorkspace: OK (ceiling enforceable, ancestry unrenameable, mount live)');
    const revision = result.stdout.trim();
    out(`  executeTool: status=${result.status} exit=${result.exitCode ?? 'unknown'}`);

    if (result.status !== 'SUCCEEDED' || result.exitCode !== 0) {
      out('PREFLIGHT FAILED: `git rev-parse HEAD` did not succeed inside the sandbox.');
      out('  Without it the coding agent produces no base revision and the captured diff is empty,');
      out('  so the independent reviewer would review nothing.');
      out(`  stderr (first 400 chars): ${result.stderr.slice(0, 400)}`);
      return 1;
    }
    if (!/^[0-9a-f]{40}$/.test(revision)) {
      out(`PREFLIGHT FAILED: the sandbox returned no usable base revision (${revision.length} chars).`);
      return 1;
    }
    out(`  base revision resolved inside the sandbox: ${revision}`);
    out('  receipts verified against EXECUTOR_KEY_ID — attestation is configured.');

    /* WHICH FILE TO WRITE TO, ASKED OF GIT RATHER THAN ASSUMED.
     *
     * The probe needs a file `git diff` will report, so it asks the sandbox's
     * OWN git — the same view that will capture the mission's diff — what it
     * tracks, and picks the first tracked text file from that list. Until
     * Mission 4 this was the literal string `README.md`: true of every mission
     * seeded from a throwaway tree, and false of the first mission sliced out
     * of Sunday Relay itself, which failed here on ENOENT before reaching a
     * provider. A workspace with nothing tracked and readable cannot produce a
     * reviewable diff at all, so that is a stated failure, not a skip. */
    const resolved = await resolveProbeFile(runInSandbox, (relative) => readFileSync(join(workspace, relative)));
    if (!resolved.ok && resolved.failure === 'list_failed') {
      out('PREFLIGHT FAILED: the sandbox could not list the workspace\'s tracked files.');
      out('  Without that list the host→sandbox hand-off cannot be probed at all.');
      out(`  stderr (first 400 chars): ${resolved.stderr.slice(0, 400)}`);
      return 1;
    }
    if (!resolved.ok) {
      out('PREFLIGHT FAILED: the mission workspace has no tracked text file to probe the hand-off with.');
      out(`  git tracks ${resolved.tracked} path(s); ${resolved.examined} were examined and none could carry the proof.`);
      for (const rejection of resolved.rejected.slice(0, 10)) out(`    rejected ${rejection.path}: ${rejection.reason}`);
      out('  A workspace whose files git does not track produces an empty `git diff`, so the Independent');
      out('  Reviewer would be handed nothing no matter what the coding agent wrote. Check that the');
      out('  provisioner committed the seed (throwaway-tree mode) or the slice (slice mode).');
      return 1;
    }
    probePath = resolved.path;
    probeFile = join(workspace, probePath);
    restore = resolved.content;
    out(`  hand-off probe file, chosen from git's own tracked list: ${probePath} (${restore.length} bytes; ${resolved.examined} of ${resolved.tracked} tracked path(s) examined)`);

    /* THE ATTEMPT'S START, taken with the coding adapter's own command before the host writes
     * anything, so the probe's edit below is exactly what an attempt's "own" change looks like. */
    const started = await runInSandbox(juliusAttemptStartCommand(null));
    const attemptStart = started.status === 'SUCCEEDED' ? parseJuliusAttemptStart(started.stdout, null) : null;
    if (attemptStart === null || attemptStart.baseTree === null || attemptStart.startTree === null) {
      out('PREFLIGHT FAILED: the attempt start snapshot (juliusAttemptStartCommand) could not be taken inside the sandbox.');
      out(`  exit=${started.exitCode ?? 'unknown'}; stderr (first 400 chars): ${started.stderr.slice(0, 400)}`);
      out('  Without it every coder attempt closes out with no start tree, and its attribution is empty.');
      return 1;
    }
    const attemptTrees = { baseTree: attemptStart.baseTree, startTree: attemptStart.startTree };
    out(`  attempt start snapshot (the adapter's own command): base tree ${attemptTrees.baseTree}, start tree ${attemptTrees.startTree}; settled ${started.status}.`);

    /* The hand-off itself: write on the HOST exactly as the coding agent
     * does, then capture the diff from a sandbox exactly as the mission does,
     * and require the change to be visible. An empty diff here means the
     * Independent Reviewer would be handed nothing to review.
     * Bytes, not a decoded string: the file is restored EXACTLY as found, so a
     * missing trailing newline or a CRLF ending cannot become a diff the
     * mission never asked for. */
    writeFileSync(probeFile, Buffer.concat([restore, Buffer.from(`\n${marker}\n`, 'utf8')]));
    const diff = await runInSandbox('git --no-pager diff');
    if (diff.status !== 'SUCCEEDED' || diff.exitCode !== 0) {
      out('PREFLIGHT FAILED: the sandbox could not capture a workspace diff.');
      out(`  stderr (first 400 chars): ${diff.stderr.slice(0, 400)}`);
      return 1;
    }
    if (!diff.stdout.includes(marker)) {
      out('PREFLIGHT FAILED: a change written on the host did NOT appear in the diff captured inside the sandbox.');
      out(`  the probe wrote to ${probePath}; the diff was ${diff.stdout.length} bytes and did not contain the marker.`);
      out('  The Independent Reviewer would be handed an empty diff — a review of nothing — after the');
      out('  mission had already paid an architect and a coding agent. Common causes: the deliverables are');
      out('  untracked (git diff never reports those), the workspace is not the live bind mount, or git');
      out('  refused the repository inside the sandbox.');
      return 1;
    }
    out(`  host-written change to ${probePath} is visible in the sandbox diff (${diff.stdout.length} bytes) — the reviewer will see real work.`);

    /* THE ATTEMPT CLOSE-OUT: the step paid run 36568129865 died on. The adapter's own command, whose
     * output is NUL-separated by design, through the real executor and settled through the real store.
     * Before the fix the executor's receipt insert refused it (22P05) and answered 500 here. */
    const closeCommand = juliusAttemptCloseCommand(attemptTrees);
    const closeOut = await runInSandbox(closeCommand);
    const closeProblems = await proveSettledCloseOut(closeOut, { exitCode: 0, state: 'SUCCEEDED' }, probePath);
    if (closeProblems.length > 0) {
      out('PREFLIGHT FAILED: the attempt close-out did not settle as the mission needs it to.');
      for (const problem of closeProblems) out(`  ${problem}`);
      return 1;
    }
    const nulCount = [...closeOut.stdout].filter((character) => character === '\u0000').length;
    out(`  attempt close-out (the adapter's own command): exit 0, ${nulCount} NUL byte(s) in ${closeOut.stdout.length} chars, parsed to its end tree and ${probePath} as the attempt's own change.`);
    out(`  settled SUCCEEDED through the production settlement repository; preview, receipt and settlement stored as ${JULIUS_ENCODED_TEXT_MARKER.trim()} and decoded to the exact bytes; every digest covers the decoded value.`);

    /* A FAILED CLOSE-OUT SETTLES TRUTHFULLY: the same output, a non-zero exit, recorded as FAILED with
     * that exit code rather than lost or left open. And it settles through a REAL serialization
     * conflict: in a live mission the settlement runs beside the run loop, whose every event append
     * upserts the same `stream_sequences` row the settlement's event does. Here, once the settlement's
     * first attempt holds its snapshot, a concurrent transaction commits a change to that row, so
     * PostgreSQL refuses the attempt (40001, "could not serialize access due to concurrent update")
     * and the settlement must replay it. A refusal there used to end the coder's step and leave the
     * invocation DISPATCHING, exactly as the 22P05 of paid run 36568129865 did. */
    const conflict = { attempts: 0, forced: 0 };
    const conflicted = new JuliusToolSettlementPostgresRepository(pool, undefined, async (point) => {
      if (point !== 'AFTER_BUDGET') return;
      conflict.attempts += 1;
      if (conflict.forced > 0) return;
      conflict.forced += 1;
      await pool.query('UPDATE relay_wonderland.stream_sequences SET next_sequence=next_sequence+1 WHERE stream_id=$1', [identity.runId]);
    });
    const failedClose = await runInSandbox(`${closeCommand}\nexit 3`, undefined, conflicted);
    const failedProblems = await proveSettledCloseOut(failedClose, { exitCode: 3, state: 'FAILED' }, probePath);
    if (conflict.forced !== 1 || conflict.attempts !== 2) failedProblems.push(`the forced serialization conflict was not met and replayed exactly once (forced ${conflict.forced}, attempts ${conflict.attempts})`);
    if (failedProblems.length > 0) {
      out('PREFLIGHT FAILED: a failing attempt close-out did not settle truthfully.');
      for (const problem of failedProblems) out(`  ${problem}`);
      return 1;
    }
    out('  a failing close-out (same output, exit 3) settled FAILED with exit 3, stored and decoded the same way,');
    out('  through a real serialization conflict on the run\'s event stream (40001 on the first attempt, settled on the replay).');

    /* The receipt transport's isolation. The scope itself is proven from the daemon's mount
     * table while THE SANDBOX THAT RUNS THE SCOPE PROBE exists (`proveReceiptScope`, between
   * prepare and execute) — named by its role, not counted, because the number of round-trips
   * before it has already changed once.
     * What is proven from INSIDE is the workload's view: it runs as uid 65532, cannot list the
     * root-owned receipt mount at all, and finds nothing under /executor-private. */
    const scope = await runInSandbox([
      '[ "$(id -u)" = "65532" ]',
      'test -d /julius-receipts-root',
      '! ls -A /julius-receipts-root >/dev/null 2>&1',
      'test ! -e /executor-private',
      'test ! -e /executor-private/private.pem',
      'test ! -e /executor-private/ledger',
      'echo RECEIPT_WORKLOAD_REFUSED',
    ].join(' && '), proveReceiptScope);
    if (scope.status !== 'SUCCEEDED' || scope.exitCode !== 0 || !scope.stdout.includes('RECEIPT_WORKLOAD_REFUSED')) {
      out('PREFLIGHT FAILED: the sandbox workload could read the receipt mount, or reached /executor-private.');
      out(`  stderr (first 400 chars): ${scope.stderr.slice(0, 400)}`);
      return 1;
    }
    out('  sandbox workload (uid 65532): the receipt mount exists but cannot be listed; nothing under /executor-private is reachable.');

    /* NOTHING THIS PREFLIGHT DISPATCHED IS LEFT OPEN: every effect above settled, through the store. */
    const open = await pool.query<{ invocation_id: string; state: string }>(
      `SELECT invocation_id, state FROM relay_wonderland.julius_tool_invocations
       WHERE run_id=$1 AND project_id=$2 AND state IN('REQUESTED','AUTHORIZED','DISPATCHING','RUNNING')`, [identity.runId, projectId]);
    if (open.rows.length > 0) {
      out(`PREFLIGHT FAILED: ${open.rows.length} dispatched invocation(s) were left open: ${open.rows.map((row) => `${row.invocation_id}=${row.state}`).join(', ')}.`);
      return 1;
    }
    out(`  all ${step} preflight effects settled through the production settlement repository; none is left DISPATCHING.`);

    /* THE CONTROL: the pre-fix write forms, against THIS database. What the executor's receipt insert
     * handed `$n::jsonb` before the fix, and what the settlement handed a `text` preview, must still be
     * refused here, or the encoding above proved nothing; the encoded form must be accepted and exact. */
    const refusedAs = (attempt: Promise<unknown>): Promise<string | null> => attempt.then(() => null, (error: { code?: unknown }) => String(error?.code ?? 'refused'));
    const rawJson = await refusedAs(pool.query('SELECT $1::jsonb AS stored', [JSON.stringify({ stdout: closeOut.stdout })]));
    const rawText = await refusedAs(pool.query('SELECT $1::text AS stored', [closeOut.stdout.slice(0, 8192)]));
    const encoded = await pool.query<{ stored: unknown }>('SELECT $1::jsonb AS stored', [pgJson({ stdout: closeOut.stdout })]);
    const exact = decodePgJson<{ stdout?: string }>(encoded.rows[0]?.stored).stdout === closeOut.stdout;
    if (rawJson === null || rawText === null || !exact) {
      out(`PREFLIGHT FAILED: the storage control did not hold (unencoded jsonb ${rawJson ?? 'ACCEPTED'}, unencoded text ${rawText ?? 'ACCEPTED'}, encoded exact=${String(exact)}).`);
      return 1;
    }
    out(`  storage control on this PostgreSQL: the pre-fix forms are refused (jsonb ${rawJson}, text ${rawText}), exactly as paid run 36568129865 was; the encoded form is accepted and exact.`);

    /* THE TERMINAL-STATE INVARIANT, on the database the mission will use. One more dispatch is
     * claimed and never executed (the state the close-out was left in), and the disposable run is
     * made terminal through the production repository: the dispatch must be closed as an unknown
     * outcome, the closure surfaced by name, and nothing new admitted to the finished run. */
    const invariantProblems = await proveTerminalInvariant();
    if (invariantProblems.length > 0) {
      out('PREFLIGHT FAILED: a terminal run left a tool invocation open, or did not say so.');
      for (const problem of invariantProblems) out(`  ${problem}`);
      return 1;
    }
    out('  terminal-state invariant: a run made terminal with a dispatch still open closed it FAILED/UNKNOWN_OUTCOME, surfaced TOOL_INVOCATION_UNRESOLVED, and refused a new invocation.');
    out('PREFLIGHT OK: executor, scoped credentials, attestation, workspace ceiling, in-sandbox git, the host→sandbox diff hand-off, the receipt scope, the NUL-separated attempt close-out settled through the store, and the terminal-state invariant all proven. No provider was contacted.');
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    out(`PREFLIGHT FAILED: ${message.slice(0, 300)}`);
    return 1;
  } finally {
    // The probe must leave the mission's workspace exactly as it found it, or
    // the run would open with a diff nobody asked for.
    if (restore !== null && probeFile !== null) {
      try { writeFileSync(probeFile, restore); } catch { out(`  WARNING: the preflight probe could not restore ${probePath}.`); }
    }
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stdout.write(`JULIUS LIVE PREFLIGHT crashed: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}\n`);
      process.exitCode = 1;
    },
  );
}
