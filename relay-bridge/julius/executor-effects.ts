/**
 * TOOL EFFECTS THROUGH THE INDEPENDENT EXECUTOR — the live shell port.
 *
 * Every physical effect a live worker needs (the base revision read, the
 * diff capture, the deterministic test run) goes through the PR #208 executor
 * control plane: a durable tool invocation is REQUESTED and AUTHORIZED in
 * PostgreSQL, its dispatch is CLAIMED through the outbox, the sandbox is
 * created and the effect executed by the separately-privileged executor
 * service, and the terminal result is SETTLED exactly once. Julius-side code
 * here holds no Docker authority and no receipt key — it talks to the
 * executor's HTTP surface and to PostgreSQL, exactly as the proven sibling
 * harness (`scripts/julius-sibling-e2e.ts`) does.
 *
 * WHAT THIS MODULE REFUSES TO BE: a local shell. There is deliberately no
 * `child_process` fallback — when the executor endpoint or its material is
 * absent, composition fails closed and no adapter that needs effects is ever
 * constructed.
 *
 * THE CLAIM HANDOFF. A durable tool invocation must carry the dispatching
 * task's CURRENT lease generation, and the outbox claim only matches when the
 * task row names the worker. The runtime hands adapters `{taskId, contextId}`
 * alone, so the composition records each task claim as it happens (same
 * process, same tick) and this port reads the generation from that record and
 * binds the worker onto the ACTIVE task row before requesting the invocation.
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  JuliusDispatchError,
  type JuliusExecutorRefusal,
  type JuliusSandboxLimits,
  type JuliusSandboxPolicy,
  type SandboxExecutionPort,
  type ToolInvocationRequest,
  type ToolInvocationResult,
} from '../../src/relay/mission/julius';
import type { JuliusToolPostgresRepository } from '../../src/relay/persistence/julius-tool-postgres';
import type { JuliusToolSettlementPostgresRepository } from '../../src/relay/persistence/julius-tool-settlement-postgres';
import { EXECUTOR_IDENTIFIER_MAX_LENGTH } from '../../src/relay/workspace/julius-tools/executor-schema';
import { safeClaim } from './live-workers';
import { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } from './sandbox-limits';
import { classifyExecutorRefusal, digestOf, shellDispatchClosure, shellEffectSettlement, type ExecutorRefusalClass, type ShellEffectStage } from './shell-settlement';

/* ---------------------------------------------------------------- shapes */

export interface ShellEffectInput {
  readonly runId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly workerId: string;
  /** Stable per-step key; retried attempts of the same lease deduplicate. */
  readonly invocationKey: string;
  readonly command: string;
  readonly timeoutMs: number;
}

export interface ShellEffectResult {
  readonly status: 'SUCCEEDED' | 'FAILED';
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly invocationId: string;
}

export interface ShellEffectPort {
  run(input: ShellEffectInput): Promise<ShellEffectResult>;
}

/** Task claims recorded by the composition as the run loop makes them. */
export interface TaskClaimSource {
  claimFor(taskId: string): { readonly leaseGeneration: number } | null;
}

/* --------------------------------------------------------------- digests */

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
/** Canonical JSON digest, identical to the sibling harness and the settlement repository; one definition, in `./shell-settlement`. */
export { digestOf };

/* ------------------------------------------------- the executor identity */

/**
 * THE LONGEST DISPATCH GENERATION THE IDENTITY BUDGET RESERVES ROOM FOR, in
 * decimal digits. A dispatch generation is a small counter; ten digits is
 * already four billion redispatches of one invocation.
 */
const DISPATCH_GENERATION_DIGITS = 10;

/**
 * THE LONGEST INVOCATION ID WHOSE EXECUTION IDENTITY STILL FITS.
 *
 * The executor composes `executionIdentity = invocationId:dispatchGeneration:sandboxId`
 * (remote-executor-control-plane.ts) and refuses any identifier longer than
 * {@link EXECUTOR_IDENTIFIER_MAX_LENGTH}; this port uses the invocation id as
 * the sandbox id, so the invocation id appears TWICE in it.
 */
export const EXECUTOR_INVOCATION_ID_MAX_LENGTH = Math.floor((EXECUTOR_IDENTIFIER_MAX_LENGTH - 2 - DISPATCH_GENERATION_DIGITS) / 2);

/**
 * THE INVOCATION ID FOR ONE TOOL EFFECT OF ONE LEASE — bounded, whatever the task.
 *
 * It was `${invocationKey}:g${leaseGeneration}`, and the key is `${taskId}:${step}`.
 * Task ids grow with every repair and segment prefix, so the id grew with them:
 * paid qualification 34757974058's second coder repair,
 * `repair:repair:run:5408584e00ffb49fd1c011a1:build:1:task:2:task`, gave a
 * 70-character invocation id and a 143-character execution identity, the
 * executor refused it `execution_envelope_invalid:executionIdentity`, and the
 * mission failed with two of its three repair cycles unspent. Every mission
 * that needs a second coder repair failed the same way.
 *
 * UNCHANGED WHERE IT FITS. Every id this port has ever issued inside the bound
 * is issued identically, so nothing recorded so far changes meaning.
 *
 * BOUNDED WHERE IT DOES NOT: `x-` + 128 bits of SHA-256 over the full key, then
 * the step and the lease generation. Deterministic — the same key and lease give
 * the same id, so the outbox deduplicates a retried attempt exactly as before —
 * and collision-resistant. The full task id is not lost: the durable invocation
 * row, the request the executor digests and signs over, and the evidence
 * summary all still carry it.
 */
export function executorInvocationId(invocationKey: string, leaseGeneration: number): string {
  if (invocationKey.length === 0) throw new Error('executor_invocation_key_empty');
  if (!Number.isSafeInteger(leaseGeneration) || leaseGeneration < 1) throw new Error('executor_lease_generation_invalid');
  const natural = `${invocationKey}:g${leaseGeneration}`;
  if (natural.length <= EXECUTOR_INVOCATION_ID_MAX_LENGTH) return natural;
  const tail = invocationKey.slice(invocationKey.lastIndexOf(':') + 1);
  const step = /^[a-z]{1,8}$/u.test(tail) ? tail : 'fx';
  const compact = `x-${sha(invocationKey).slice(0, 32)}:${step}:g${leaseGeneration}`;
  if (compact.length > EXECUTOR_INVOCATION_ID_MAX_LENGTH) throw new Error('executor_invocation_id_unbounded');
  return compact;
}

/**
 * THE TASK ID THE EXECUTOR IS SHOWN — bounded, whatever the task.
 *
 * The executor validates the task id as an identifier too (`request.taskId`,
 * `identity.taskId`), to the same {@link EXECUTOR_IDENTIFIER_MAX_LENGTH}.
 * Bounding the invocation id was not enough: paid qualification attempt 3
 * (run 34766115321) grew a coder repair task through repair and segment
 * prefixes to 134 characters, and the executor refused its sandbox with
 * `INVALID_REQUEST:executor_operation_invalid:identity.taskId`.
 *
 * UNCHANGED WHERE IT FITS, as every id so far has. Past the bound: `t-` + 128
 * bits of SHA-256 over the full task id — deterministic, so a retried lease
 * reaches the same sandbox scope. ONLY the executor sees it. Julius's own rows
 * (the task binding, the durable tool invocation) keep the full task id, and
 * the request the executor digests and signs is the one Julius recorded the
 * digest of, so nothing on either side compares the two forms.
 */
export function executorTaskId(taskId: string): string {
  if (taskId.length === 0) throw new Error('executor_task_id_empty');
  if (taskId.length <= EXECUTOR_IDENTIFIER_MAX_LENGTH) return taskId;
  return `t-${sha(taskId).slice(0, 32)}`;
}

/* ------------------------------------------------ what the executor said */

/*
 * `classifyExecutorRefusal` lives in `./shell-settlement`, a pure module, so the
 * provider-free preflight closes a failed dispatch with the same classification
 * the live port uses. Re-exported here, where its callers have always found it.
 */
export { classifyExecutorRefusal, type ExecutorRefusalClass };

const stepOf = (invocationKey: string): 'base' | 'diff' | 'test' | null => {
  const tail = invocationKey.slice(invocationKey.lastIndexOf(':') + 1);
  return tail === 'base' || tail === 'diff' || tail === 'test' ? tail : null;
};

/** One refused effect as the error Julius records: a class, the step, the field — never the executor's text. */
const refused = (refusal: JuliusExecutorRefusal, invocationKey: string, field: string | null, safeMessage: string): JuliusDispatchError =>
  new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, safeMessage, refusal, {
    executorStep: stepOf(invocationKey), executorRefusal: refusal, executorRefusalField: field,
  });

/* ------------------------------------------------------------ live port */

/*
 * The limits and policy are declared in `./sandbox-limits` — a pure module the
 * provider-free preflight can import without reaching `./live-workers` and the
 * provider connectors behind it — and re-exported here, where the live port
 * consumes them. `outputBytes` there is the executor's own ceiling, imported
 * from its validator; dry run 33625851653 failed because a literal kept here
 * had drifted above it.
 */
export { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } from './sandbox-limits';

export function createExecutorShellPort(config: {
  readonly pool: Pool;
  readonly tools: JuliusToolPostgresRepository;
  readonly settlement: JuliusToolSettlementPostgresRepository;
  readonly client: SandboxExecutionPort;
  readonly claims: TaskClaimSource;
  readonly tenantId: string;
  readonly callerId: string;
  /** The card revision every invocation is authorized under. */
  readonly policyRevision: string;
  /** The execution session the budget reservations belong to. */
  readonly executionId: string;
  /** What `prepareWorkspace` clones into the sandbox. */
  readonly workspaceSourceRef: string;
  readonly limits?: JuliusSandboxLimits;
  readonly policy?: JuliusSandboxPolicy;
}): ShellEffectPort {
  const limits = config.limits ?? EXECUTOR_SANDBOX_LIMITS;
  const policy = config.policy ?? EXECUTOR_SANDBOX_POLICY;
  return {
    async run(input): Promise<ShellEffectResult> {
      const claim = config.claims.claimFor(input.taskId);
      if (claim === null) {
        throw refused('executor_claim_missing', input.invocationKey, null, 'No recorded task claim exists for this tool effect, so it cannot be authorized.');
      }
      const invocationId = executorInvocationId(input.invocationKey, claim.leaseGeneration);
      const now = () => new Date().toISOString();

      // The outbox claim matches only when the ACTIVE task row names the
      // dispatching worker under the current lease — bind it idempotently.
      await config.pool.query(
        `UPDATE relay_wonderland.julius_tasks SET worker_id=$2 WHERE task_id=$1 AND state='ACTIVE' AND lease_generation=$3`,
        [input.taskId, input.workerId, claim.leaseGeneration],
      );
      await config.pool.query(
        `INSERT INTO relay_wonderland.budget_reservations(reservation_id,execution_id,worker_id,operation_key,idempotency_key,state,tool_calls,runtime_ms,expires_at)
         VALUES($1,$2,$3,'tool',$4,'RESERVED',1,$5,now()+interval '60 minutes') ON CONFLICT DO NOTHING`,
        [`budget:${invocationId}`, config.executionId, input.workerId, invocationId, input.timeoutMs],
      );

      const request: ToolInvocationRequest = {
        invocationId, runId: input.runId, taskId: executorTaskId(input.taskId), projectId: input.projectId,
        workerId: input.workerId, toolId: 'shell.bash', toolVersion: '1',
        arguments: { command: input.command }, cwd: '.',
        idempotencyKey: invocationId, timeoutMs: input.timeoutMs, expectedMutation: 'WORKSPACE',
      };
      const requestDigest = digestOf(request);
      await config.tools.request({
        invocationId, idempotencyKey: invocationId, requestDigest,
        tenantId: config.tenantId, projectId: input.projectId, runId: input.runId,
        taskId: input.taskId, workerId: input.workerId, leaseGeneration: claim.leaseGeneration,
        policyRevision: config.policyRevision, toolId: 'shell.bash', toolVersion: '1',
        mutationClass: 'WORKSPACE', requestedAt: now(),
      });
      const authorized = await config.tools.authorize({
        invocationId, tenantId: config.tenantId, projectId: input.projectId,
        requestDigest, policyRevision: config.policyRevision,
        budgetReservationId: `budget:${invocationId}`, authorizedAt: now(),
      });
      if (!authorized) {
        throw refused('executor_invocation_unauthorized', input.invocationKey, null, `Tool invocation ${invocationId} could not be authorized.`);
      }
      const claimed = await config.tools.claimDispatch({
        claimedBy: config.callerId, now: now(),
        claimedUntil: new Date(Date.now() + input.timeoutMs + 120_000).toISOString(), limit: 16,
      });
      const dispatch = claimed.find((entry) => entry.invocation.invocationId === invocationId);
      if (dispatch === undefined) {
        throw refused('executor_dispatch_unclaimed', input.invocationKey, null, `Tool invocation ${invocationId} was authorized but its dispatch could not be claimed.`);
      }

      const identity = {
        sandboxId: invocationId, invocationId, tenantId: config.tenantId,
        projectId: input.projectId, runId: input.runId, taskId: executorTaskId(input.taskId),
        leaseGeneration: claim.leaseGeneration, policyRevision: config.policyRevision,
        createdAt: now(), expiresAt: new Date(Date.now() + input.timeoutMs + 600_000).toISOString(),
      };
      /**
       * NO DISPATCH IS LEFT OPEN. Paid run 36568129865's close-out was claimed
       * (DISPATCHING), the executor answered 500, this port threw, and nothing
       * ever wrote the invocation's end. Now every way out of a claimed
       * dispatch that is not a settlement closes it first, as what it was:
       * provably no effect, or an outcome Julius does not know. Closing is
       * best effort and never replaces the refusal in hand; the run's terminal
       * transition closes whatever this could not.
       */
      const closeUnsettled = async (stage: ShellEffectStage, refusal: JuliusExecutorRefusal | null, failureClass: string): Promise<void> => {
        try {
          await config.tools.failDispatch(shellDispatchClosure({
            invocationId, invocationKey: input.invocationKey, dispatchGeneration: dispatch.dispatchGeneration,
            stage, refusal, failureClass, completedAt: now(),
          }));
        } catch {
          /* The refusal already in hand is the answer this effect gives. */
        }
      };

      let result: ToolInvocationResult;
      let stage: ShellEffectStage = 'create';
      try {
        await config.client.createSandbox({ identity, policy, limits });
        stage = 'prepare';
        await config.client.prepareWorkspace({
          sandboxId: invocationId, sourceRef: config.workspaceSourceRef,
          expectedLeaseGeneration: claim.leaseGeneration,
        });
        stage = 'execute';
        result = await config.client.executeTool({
          sandboxId: invocationId, expectedLeaseGeneration: claim.leaseGeneration,
          dispatchGeneration: dispatch.dispatchGeneration, requestDigest,
          executionTokenHash: sha(`token:${invocationId}`),
          effectClassification: 'NON_IDEMPOTENT_MUTATION', request,
        });
      } catch (error) {
        // NAMED, NOT RETHROWN BARE. The step, the class and the field survive
        // into the durable failure; the executor's own text does not.
        if (error instanceof JuliusDispatchError) {
          await closeUnsettled(stage, null, 'executor_dispatch_error');
          throw error;
        }
        const { refusal, field } = classifyExecutorRefusal(error);
        await closeUnsettled(stage, refusal, refusal);
        throw refused(refusal, input.invocationKey, field, `The independent executor refused the ${stepOf(input.invocationKey) ?? 'tool'} effect (${refusal}).`);
      } finally {
        await config.client.destroySandbox({
          sandboxId: invocationId, expectedLeaseGeneration: claim.leaseGeneration,
          reason: 'live-mission tool effect finished',
        }).catch(() => undefined);
      }

      /**
       * THE RESULT IS SETTLED RAW. Its stdout may hold NULs (the attempt
       * close-out prints NUL-separated sections by design); the settlement
       * repository encodes what PostgreSQL cannot store, and the parser below
       * this port still receives every byte. A settlement that fails leaves
       * the effect done but unrecorded, so the dispatch is closed as unknown
       * rather than left DISPATCHING, and the failure surfaces as before.
       */
      try {
        await config.settlement.settle(shellEffectSettlement({
          invocationId, dispatchGeneration: dispatch.dispatchGeneration, result,
          safeSummary: safeClaim(`Executor ran a shell effect for ${input.taskId}: exit ${result.exitCode ?? 'unknown'}.`),
          occurredAt: now(),
        }));
      } catch (error) {
        await closeUnsettled('settle', null, 'tool_settlement_failed');
        throw error;
      }

      return {
        status: result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
        exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
        invocationId,
      };
    },
  };
}
