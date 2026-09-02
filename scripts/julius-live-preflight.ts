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
 * printed; the only commands it runs are `git rev-parse HEAD` and
 * `git --no-pager diff` — the same two reads the live coding adapter issues —
 * and it restores the file it touched.
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

import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { RemoteExecutorControlPlane } from '../src/relay/workspace/julius-tools/remote-executor-control-plane';
import type { ExecutorOperation } from '../src/relay/workspace/julius-tools/executor-operation-request';
import { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } from '../relay-bridge/julius/sandbox-limits';
import { cleanupPreflightIdentity, migrateIfNeeded, preflightIdentityFor, preflightNonce, seedPreflightIdentity, seedPreflightInvocation, type PreflightIdentity } from './julius-live-preflight-identity';
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

    // The migration set is a one-shot replay, so it is applied only where its last
    // migration has not landed — the same guard the live entrypoint uses. A probe
    // pointed at an already-migrated validation database must not fail on 42P07.
    const migration = await migrateIfNeeded(pool);
    out(migration === 'applied' ? '  migrations applied (empty database)' : '  migrations already present (one-shot replay skipped)');

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

  /** One full create → prepare → execute → destroy round-trip, as the mission does it. */
  /* Receipts live at the host path the executor was given (the mission's transport) or under the
   * executor's private root; either way a sandbox must never see that path itself. */
  const hostReceiptRoot = process.env.JULIUS_RECEIPT_HOST_ROOT?.trim() || '/executor-private/receipts';
  let previousSandboxId = '';
  const runInSandbox = async (command: string): Promise<ToolInvocationResult> => {
    step += 1;
    const invocationId = `preflight:${identity.nonce}:${step}`;
    if (step > 1) previousSandboxId = `preflight:${identity.nonce}:${step - 1}`;
    const request: ToolInvocationRequest = {
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
    };
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
    try {
      await client.createSandbox({ identity: sandboxIdentity, policy: PREFLIGHT_POLICY, limits: PREFLIGHT_LIMITS });
      await client.prepareWorkspace({
        sandboxId: invocationId, sourceRef: workspace, expectedLeaseGeneration: leaseGeneration,
      });
      return await client.executeTool({
        sandboxId: invocationId, expectedLeaseGeneration: leaseGeneration,
        dispatchGeneration, requestDigest: digestOf(request),
        executionTokenHash: sha(`token:${invocationId}`),
        effectClassification: 'NON_IDEMPOTENT_MUTATION', request,
      });
    } finally {
      await client.destroySandbox({
        sandboxId: invocationId, expectedLeaseGeneration: leaseGeneration,
        reason: 'preflight round-trip finished',
      }).catch(() => undefined);
    }
  };

  out('JULIUS LIVE PREFLIGHT — independent executor round-trip');
  out(`  workspace: ${workspace}`);
  out(`  caller: ${callerId} tenant: ${tenantId}`);
  out(`  sandbox: network=${PREFLIGHT_POLICY.network} workspaceBytes=${PREFLIGHT_LIMITS.workspaceBytes} outputBytes=${PREFLIGHT_LIMITS.outputBytes}`);

  const marker = `julius-live-preflight-${Date.now()}`;
  const probeFile = join(workspace, 'README.md');
  let restore: string | null = null;
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

    /* The hand-off itself: write on the HOST exactly as the coding agent
     * does, then capture the diff from a sandbox exactly as the mission does,
     * and require the change to be visible. An empty diff here means the
     * Independent Reviewer would be handed nothing to review. */
    restore = readFileSync(probeFile, 'utf8');
    writeFileSync(probeFile, `${restore}\n${marker}\n`);
    const diff = await runInSandbox('git --no-pager diff');
    if (diff.status !== 'SUCCEEDED' || diff.exitCode !== 0) {
      out('PREFLIGHT FAILED: the sandbox could not capture a workspace diff.');
      out(`  stderr (first 400 chars): ${diff.stderr.slice(0, 400)}`);
      return 1;
    }
    if (!diff.stdout.includes(marker)) {
      out('PREFLIGHT FAILED: a change written on the host did NOT appear in the diff captured inside the sandbox.');
      out(`  the diff was ${diff.stdout.length} bytes and did not contain the probe marker.`);
      out('  The Independent Reviewer would be handed an empty diff — a review of nothing — after the');
      out('  mission had already paid an architect and a coding agent. Common causes: the deliverables are');
      out('  untracked (git diff never reports those), the workspace is not the live bind mount, or git');
      out('  refused the repository inside the sandbox.');
      return 1;
    }
    out(`  host-written change is visible in the sandbox diff (${diff.stdout.length} bytes) — the reviewer will see real work.`);

    /* The receipt transport's isolation, proven from INSIDE a sandbox. The adapter mounts
     * `<receipt root>/<sha256(sandboxId)>` — this sandbox's own scope — at /julius-receipts-root
     * and nothing else of the root; so from within, the mount holds exactly one entry (this
     * execution's token directory), the previous sandbox's scope is unreachable, the host root's
     * own path does not exist, and neither does anything under /executor-private. */
    const previousScope = sha(previousSandboxId);
    const scope = await runInSandbox([
      'set -e',
      'test -d /julius-receipts-root',
      '[ "$(ls -A /julius-receipts-root | wc -l)" -eq 1 ]',
      `test ! -e /julius-receipts-root/${previousScope}`,
      `test ! -e /julius-receipts-root/../${previousScope}`,
      `test ! -e ${hostReceiptRoot}`,
      'test ! -e /executor-private',
      'test ! -e /executor-private/private.pem',
      'test ! -e /executor-private/ledger',
      'echo RECEIPT_SCOPE_OK',
    ].join(' && '));
    if (scope.status !== 'SUCCEEDED' || scope.exitCode !== 0 || !scope.stdout.includes('RECEIPT_SCOPE_OK')) {
      out('PREFLIGHT FAILED: a sandbox could see more of the receipt transport than its own scoped subtree, or reached the key or ledger.');
      out(`  stderr (first 400 chars): ${scope.stderr.slice(0, 400)}`);
      return 1;
    }
    out('  sandbox receipt scope: only its own subtree is mounted; the parent root, the previous sandbox, the key and the ledger are unreachable.');
    out('PREFLIGHT OK: executor, scoped credentials, attestation, workspace ceiling, in-sandbox git, the host→sandbox diff hand-off and the receipt scope all proven. No provider was contacted.');
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    out(`PREFLIGHT FAILED: ${message.slice(0, 300)}`);
    return 1;
  } finally {
    // The probe must leave the mission's workspace exactly as it found it, or
    // the run would open with a diff nobody asked for.
    if (restore !== null) {
      try { writeFileSync(probeFile, restore); } catch { out('  WARNING: the preflight probe could not restore README.md.'); }
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
