/**
 * THE EXECUTOR'S DURABLE EXECUTE PATH, WITHOUT A CONTAINER, for the real-PostgreSQL proofs.
 *
 * `DockerJuliusSandboxAdapter.executeTool` does four durable things around the container it runs: it
 * records the sandbox (`save`, then `bindPhysical` at prepare), authorizes the execution against the
 * claimed dispatch (`authorizeExecution`), reads the receipts the in-sandbox wrapper left
 * (`DockerExecutorReceiptStore.consume`), and records the terminal receipt (`recordReceipt`). That last
 * write is the one paid run 36568129865 died on, with SQLSTATE 22P05. This stand-in performs exactly
 * those four, with the REAL receipt store and the REAL repository against a REAL PostgreSQL, and writes
 * the receipts the wrapper would have written for a command whose output it is told.
 *
 * What it does not do is run a container. The provider-free preflight does that, through the real
 * executor, in the `first-live-topology` job; this is what lets the same writes be proved beside the
 * other real-PostgreSQL cases, where a container is not available.
 */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import type { SandboxExecutionPort, ToolInvocationResult } from '../src/relay/mission/julius';
import { JuliusToolRecoveryPostgresRepository } from '../src/relay/persistence/julius-tool-recovery-postgres';
import { DockerExecutorReceiptStore, type ExecutorRequestManifest } from '../src/relay/workspace/julius-tools/executor-receipt-store';

const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const stable = (value: unknown): string => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;

/** What the command "printed", and where the executor is to fail, if anywhere. */
export interface StandInOutcome {
  readonly stdout: string | Uint8Array;
  readonly stderr?: string | Uint8Array;
  readonly exitCode?: number;
  /** Refuse at this stage, before any effect, with this error (as the executor's client would raise it). */
  readonly failAt?: 'create' | 'prepare' | 'execute';
  /** Fail AFTER the receipt is recorded: the effect happened, and the answer never reached Julius. */
  readonly failAfterReceipt?: boolean;
  readonly failure?: string;
}

export const STANDIN_RUNTIME_ID = 'executor-standin';
export const STANDIN_IMAGE = `sha256:${'5'.repeat(64)}`;
export const STANDIN_EXECUTOR = 'docker-executor.v1';

type ExecuteInput = Parameters<SandboxExecutionPort['executeTool']>[0];

/** The two receipts the in-sandbox wrapper writes, for the given manifest and output. */
export function standInReceipts(manifest: ExecutorRequestManifest, stdout: Uint8Array, stderr: Uint8Array, exitCode: number): { before: string; after: string } {
  const manifestDigest = sha(stable(manifest));
  const preTree = sha(`pre:${manifest.invocationId}`), postTree = sha(`post:${manifest.invocationId}`), changed = sha('');
  const durationMs = '7';
  const before = [
    'receiptVersion=1', 'phase=BEFORE', `manifestDigest=${manifestDigest}`, `invocationId=${manifest.invocationId}`,
    `dispatchGeneration=${manifest.dispatchGeneration}`, `sandboxId=${manifest.sandboxId}`, `tenantDigest=${sha(manifest.tenantId)}`,
    `projectDigest=${sha(manifest.projectId)}`, `runDigest=${sha(manifest.runId)}`, `taskDigest=${sha(manifest.taskId)}`,
    `workerDigest=${sha(manifest.workerId)}`, `toolId=${manifest.toolId}`, `toolVersion=${manifest.toolVersion}`,
    `requestDigest=${manifest.requestDigest}`, `policyDigest=${sha(manifest.policyRevision)}`, `leaseGeneration=${manifest.leaseGeneration}`,
    `imageDigest=${sha(manifest.imageDigest)}`, `executorIdentity=${manifest.executorIdentity}`, `preTreeDigest=${preTree}`,
    `startedAt=${new Date().toISOString()}`,
  ].join('\n') + '\n';
  const stdoutDigest = sha(stdout), stderrDigest = sha(stderr);
  const after = [
    'receiptVersion=1', 'phase=AFTER', `manifestDigest=${manifestDigest}`, `invocationId=${manifest.invocationId}`,
    `dispatchGeneration=${manifest.dispatchGeneration}`, `sandboxId=${manifest.sandboxId}`, `requestDigest=${manifest.requestDigest}`,
    `executorIdentity=${manifest.executorIdentity}`, `terminalState=${exitCode === 0 ? 'SUCCEEDED' : 'FAILED'}`, `exitCode=${exitCode}`,
    `durationMs=${durationMs}`, `finishedAt=${new Date().toISOString()}`, `stdoutDigest=${stdoutDigest}`, `stderrDigest=${stderrDigest}`,
    `preTreeDigest=${preTree}`, `postTreeDigest=${postTree}`, `changedPathsDigest=${changed}`,
    `outputBytes=${stdout.byteLength + stderr.byteLength}`,
    `executorResultDigest=${sha([String(exitCode), durationMs, stdoutDigest, stderrDigest, postTree, changed].join('\n'))}`,
  ].join('\n') + '\n';
  return { before, after };
}

const bytes = (value: string | Uint8Array | undefined): Uint8Array => typeof value === 'string' ? Buffer.from(value, 'utf8') : value ?? new Uint8Array();

/**
 * A `SandboxExecutionPort` that is the executor's durable path. `outcome` decides what each command
 * printed; `recordReceipt` is the repository's own, so the receipt row is exactly what the executor writes.
 */
export function durableExecutorStandIn(input: {
  readonly pool: Pool;
  readonly receiptRoot: string;
  /** What this dispatch does, decided when its sandbox is created (a refused create has no command yet). */
  readonly outcome: (invocationId: string) => StandInOutcome;
  /** The receipt write, replaceable ONLY by a mutation case that restores the pre-fix behaviour. */
  readonly recordReceipt?: JuliusToolRecoveryPostgresRepository['recordReceipt'];
}): SandboxExecutionPort {
  const store = new JuliusToolRecoveryPostgresRepository(input.pool);
  const receipts = new DockerExecutorReceiptStore(input.receiptRoot);
  const recordReceipt = input.recordReceipt ?? store.recordReceipt.bind(store);
  const decided = new Map<string, StandInOutcome>();
  const outcomeOf = (sandboxId: string): StandInOutcome => {
    const known = decided.get(sandboxId);
    if (known === undefined) throw new Error('standin_sandbox_unknown');
    return known;
  };
  const refuse = (outcome: StandInOutcome): never => { throw new Error(outcome.failure ?? 'EXECUTOR_UNAVAILABLE:executor_failure'); };
  const unsupported = async (): Promise<never> => { throw new Error('standin_operation_unsupported'); };
  return {
    async createSandbox({ identity, policy, limits }) {
      const outcome = input.outcome(identity.invocationId);
      decided.set(identity.sandboxId, outcome);
      if (outcome.failAt === 'create') refuse(outcome);
      const record = { ...identity, state: 'CREATING' as const, workspaceRef: null, runtimeKind: 'docker-rootless-boundary', limits, policy, safeFailure: null };
      if (!await store.save({ ...record, runtimeInstanceId: STANDIN_RUNTIME_ID, containerId: null, imageDigest: STANDIN_IMAGE, lastHeartbeatAt: identity.createdAt })) throw new Error('sandbox_identity_conflict');
      return record;
    },
    async prepareWorkspace({ sandboxId, sourceRef, expectedLeaseGeneration }) {
      if (outcomeOf(sandboxId).failAt === 'prepare') refuse(outcomeOf(sandboxId));
      if (!await store.bindPhysical({ sandboxId, runtimeInstanceId: STANDIN_RUNTIME_ID, leaseGeneration: expectedLeaseGeneration, containerId: `standin-${sha(sandboxId).slice(0, 12)}`, workspaceRef: sourceRef })) throw new Error('sandbox_durable_bind_failed');
      const bound = await store.loadOwned(sandboxId);
      return bound;
    },
    async executeTool(execution: ExecuteInput): Promise<ToolInvocationResult> {
      const outcome = outcomeOf(execution.sandboxId);
      if (outcome.failAt === 'execute') refuse(outcome);
      const record = await store.authorizeExecution({
        sandboxId: execution.sandboxId, runtimeInstanceId: STANDIN_RUNTIME_ID, invocationId: execution.request.invocationId,
        leaseGeneration: execution.expectedLeaseGeneration, dispatchGeneration: execution.dispatchGeneration,
        requestDigest: execution.requestDigest, executionTokenHash: execution.executionTokenHash,
      });
      const manifest: ExecutorRequestManifest = {
        invocationId: record.invocationId, dispatchGeneration: execution.dispatchGeneration, sandboxId: record.sandboxId,
        tenantId: record.tenantId, projectId: record.projectId, runId: record.runId, taskId: record.taskId,
        workerId: execution.request.workerId, toolId: execution.request.toolId, toolVersion: execution.request.toolVersion,
        requestDigest: execution.requestDigest, argumentsDigest: sha(stable(execution.request.arguments)),
        policyRevision: record.policyRevision, leaseGeneration: record.leaseGeneration, imageDigest: STANDIN_IMAGE,
        effectClassification: execution.effectClassification, executorIdentity: STANDIN_EXECUTOR,
      };
      const directory = await receipts.prepare(execution.executionTokenHash, manifest);
      const stdout = bytes(outcome.stdout), stderr = bytes(outcome.stderr);
      const written = standInReceipts(manifest, stdout, stderr, outcome.exitCode ?? 0);
      await Promise.all([
        writeFile(join(directory, 'before.receipt'), written.before), writeFile(join(directory, 'after.receipt'), written.after),
        writeFile(join(directory, 'stdout'), stdout), writeFile(join(directory, 'stderr'), stderr), writeFile(join(directory, 'changed-paths'), ''),
      ]);
      const consumed = await receipts.consume(execution.executionTokenHash, record.sandboxId);
      if (consumed === null || consumed.receipt.result === null) throw new Error('executor_receipt_missing');
      // THE WRITE PAID RUN 36568129865 DIED ON. The executor service masks whatever it throws as a 500.
      try {
        await recordReceipt({ ...consumed.receipt, projectId: record.projectId });
      } catch (error) {
        throw Object.assign(new Error('EXECUTOR_UNAVAILABLE:executor_failure'), { cause: error });
      }
      if (outcome.failAfterReceipt === true) refuse(outcome);
      return consumed.receipt.result;
    },
    async destroySandbox({ sandboxId, expectedLeaseGeneration }) {
      if (!await store.beginDestroy({ sandboxId, runtimeInstanceId: STANDIN_RUNTIME_ID, leaseGeneration: expectedLeaseGeneration })) return false;
      return store.finishDestroy({ sandboxId, runtimeInstanceId: STANDIN_RUNTIME_ID, leaseGeneration: expectedLeaseGeneration });
    },
    cancelExecution: unsupported, inspectSandbox: unsupported, collectArtifacts: unsupported,
    discoverSandboxes: unsupported, quarantineSandbox: unsupported, reconcileSandboxes: unsupported,
  };
}

/** The outcome for a create or prepare refusal: the executor never reaches the command. */
export const refusedAt = (stage: 'create' | 'prepare' | 'execute', failure = 'EXECUTOR_UNAVAILABLE:sandbox_create_failed'): StandInOutcome => ({ stdout: '', failAt: stage, failure });
