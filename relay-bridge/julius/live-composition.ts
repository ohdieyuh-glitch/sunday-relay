/**
 * THE LIVE JULIUS COMPOSITION — C.A.R.D. roles resolved to live adapters,
 * assembled around the durable runtime, with every refusal made before any
 * provider client exists.
 *
 * Julius owns orchestration; this module only WIRES. It resolves the three
 * C.A.R.D. roles from the deployment environment into `JuliusWorker` entries
 * plus the live adapters from `./live-workers`, and assembles the same
 * runtime shape the deterministic fixtures prove (`createJuliusHarness`) with
 * production parts in every socket: the PostgreSQL-backed store, a real
 * budget ceiling, the executor-backed shell port, and NO scripted adapter —
 * this module has no import through which one could arrive.
 *
 * FAIL CLOSED, NAMED. `resolveLiveWorkers` returns every problem it found —
 * the exact environment variable names that are missing, never their values —
 * and refuses to construct any adapter until all three roles resolve. There
 * is no partial composition and no fallback worker.
 */

import { randomUUID } from 'node:crypto';
import {
  JuliusProviderHealthRegistry,
  JuliusProviderRouter,
  JuliusRunLoop,
  JuliusWorkerRegistry,
  fixedResourceEstimate,
  juliusAllocationPolicy,
  type JuliusBudgetPort,
  type JuliusCardPolicy,
  type JuliusClaimedTask,
  type JuliusContextSnapshot,
  type JuliusPipelineDependencies,
  type JuliusPolicySource,
  type JuliusRecoveryDriver,
  type JuliusProviderAdapter,
  type JuliusRuntimeStore,
  type JuliusVerificationPolicy,
  type JuliusWorker,
} from '../../src/relay/mission/julius';
import {
  evaluateReadiness,
  readGptArchitectConfig,
} from '../../src/relay/connectors/gpt-architect';
import { HOSTED_API_KEY_ENV, HOSTED_MODEL_ENV } from '../hosted-coding-agent/hosted-readiness';
import { loadHermesConfig } from '../hermes-reviewer';
import type { runGptArchitect } from '../../src/relay/connectors/gpt-architect';
import type { runHostedCodingAgent, HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import type { runHermesReview } from '../hermes-reviewer';
import {
  createLiveArchitectAdapter,
  createLiveHermesReviewerAdapter,
  createLiveHostedCodingAdapter,
  type CompiledContextSource,
  type LiveArtifactExchange,
} from './live-workers';
import type { ShellEffectPort, TaskClaimSource } from './executor-effects';

/* ------------------------------------------------------- role resolution */

export const ARCHITECT_WORKER: JuliusWorker = {
  workerId: 'prompt-architect-openai', role: 'PROMPT_ARCHITECT',
  adapterId: 'openai-architect-live', providerId: 'openai',
  // `repair:plan` is a PLAN REVISION: a repair inherits its subject's role and
  // stage, so a rejected plan comes back here with the reviewer's findings in
  // its context, not to the Coding Agent. Paid run 34037313976 minted the
  // latter, and nobody could route it.
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'],
  concurrencyLimit: 1, timeoutMs: 300_000, maxRetries: 1, status: 'AVAILABLE',
};

export const CODER_WORKER: JuliusWorker = {
  workerId: 'coding-agent-claude-hosted', role: 'CODING_AGENT',
  adapterId: 'claude-agent-sdk-hosted-live', providerId: 'anthropic',
  capabilities: ['implement'],
  // A repair is `repair:<stage>` on the subject's own role, and a second
  // round is still `repair:build`, so this one registration covers every
  // Coding Agent repair round. `repair:plan` belongs to the Prompt Architect.
  // The pipeline proves a repair routable BEFORE creating it, so an omission
  // here halts the run with `REPAIR_UNROUTABLE` rather than spending an
  // attempt on `PROVIDER_UNAVAILABLE` (paid run 34037313976, tick 5).
  taskTypes: ['build', 'repair:build'],
  concurrencyLimit: 1, timeoutMs: 600_000, maxRetries: 1, status: 'AVAILABLE',
};

export const reviewerWorker = (providerId: string): JuliusWorker => ({
  workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER',
  adapterId: 'hermes-local-live', providerId,
  capabilities: ['review'],
  taskTypes: ['review:plan', 'review:build', 'review:repair:build', 'review:repair:plan'],
  concurrencyLimit: 1, timeoutMs: 240_000, maxRetries: 1, status: 'AVAILABLE',
});

export interface LiveRoleProblem {
  readonly role: 'PROMPT_ARCHITECT' | 'CODING_AGENT' | 'INDEPENDENT_REVIEWER';
  readonly reason: string;
  /** Environment variable NAMES (or preconditions) — never values. */
  readonly missing: readonly string[];
}

export interface LiveWorkerEntry {
  readonly worker: JuliusWorker;
  readonly adapter: JuliusProviderAdapter;
}

export interface LiveWorkerResolution {
  readonly ok: boolean;
  readonly problems: readonly LiveRoleProblem[];
  readonly entries: readonly LiveWorkerEntry[];
  /** Requested configuration, safe to print: models and providers, no secrets. */
  readonly requested: {
    readonly architectModel: string | null;
    readonly codingModel: string | null;
    readonly reviewerProvider: string | null;
    readonly reviewerModel: string | null;
  };
}

export function resolveLiveWorkers(options: {
  readonly env: Record<string, string | undefined>;
  readonly projectId: string;
  readonly workspacePath: string;
  readonly testCommand: string;
  readonly contexts: CompiledContextSource;
  readonly artifacts: LiveArtifactExchange;
  /** Absent shell = no executor = no coding agent. Never a local fallback. */
  readonly shell: ShellEffectPort | null;
  /** Test seams: inject fakes here; production callers omit them. */
  readonly runners?: {
    readonly architect?: typeof runGptArchitect;
    readonly coder?: typeof runHostedCodingAgent;
    readonly reviewer?: typeof runHermesReview;
    readonly queryLoader?: () => Promise<HostedQueryFn>;
  };
}): LiveWorkerResolution {
  const problems: LiveRoleProblem[] = [];
  const entries: LiveWorkerEntry[] = [];

  const architectConfig = readGptArchitectConfig(options.env);
  const architectReadiness = evaluateReadiness(architectConfig);
  const hermes = loadHermesConfig(options.env);
  const requested = {
    architectModel: architectConfig.model,
    codingModel: options.env[HOSTED_MODEL_ENV]?.trim() || null,
    reviewerProvider: hermes.provider ?? null,
    reviewerModel: hermes.model ?? null,
  };

  if (!architectReadiness.ready) {
    problems.push({ role: 'PROMPT_ARCHITECT', reason: 'live_config_missing', missing: architectReadiness.missing });
  } else {
    entries.push({
      worker: ARCHITECT_WORKER,
      adapter: createLiveArchitectAdapter({
        worker: ARCHITECT_WORKER, contexts: options.contexts, artifacts: options.artifacts,
        config: architectConfig, apiKey: options.env.OPENAI_API_KEY ?? '',
        run: options.runners?.architect,
      }),
    });
  }

  const codingMissing: string[] = [];
  if (!options.env[HOSTED_API_KEY_ENV]) codingMissing.push(HOSTED_API_KEY_ENV);
  if (!requested.codingModel) codingMissing.push(HOSTED_MODEL_ENV);
  if (!options.workspacePath) codingMissing.push('mission workspacePath (contract field)');
  if (!options.testCommand) codingMissing.push('mission testCommand');
  if (options.shell === null) codingMissing.push('executor shell port (JULIUS_EXECUTOR_ENDPOINT and its material)');
  if (codingMissing.length > 0) {
    problems.push({ role: 'CODING_AGENT', reason: 'live_config_missing', missing: codingMissing });
  } else {
    entries.push({
      worker: CODER_WORKER,
      adapter: createLiveHostedCodingAdapter({
        worker: CODER_WORKER, contexts: options.contexts, artifacts: options.artifacts,
        projectId: options.projectId, apiKey: options.env[HOSTED_API_KEY_ENV] ?? '',
        requestedModel: requested.codingModel ?? '', workspacePath: options.workspacePath,
        testCommand: options.testCommand, shell: options.shell as ShellEffectPort,
        run: options.runners?.coder, queryLoader: options.runners?.queryLoader,
      }),
    });
  }

  const reviewerMissing: string[] = [];
  if (!hermes.executable) reviewerMissing.push('RELAY_HERMES_EXECUTABLE');
  if (!hermes.provider) reviewerMissing.push('RELAY_HERMES_PROVIDER');
  if (!hermes.model) reviewerMissing.push('RELAY_HERMES_MODEL');
  if (reviewerMissing.length > 0) {
    problems.push({ role: 'INDEPENDENT_REVIEWER', reason: 'live_config_missing', missing: reviewerMissing });
  } else if (hermes.provider === CODER_WORKER.providerId) {
    // An Independent Reviewer sharing the Coding Agent's vendor is not
    // independent; refusing here is cheaper than discovering it in a review
    // nobody can trust.
    problems.push({ role: 'INDEPENDENT_REVIEWER', reason: 'reviewer_not_independent', missing: ['RELAY_HERMES_PROVIDER (must differ from the Coding Agent provider)'] });
  } else {
    const worker = reviewerWorker(hermes.provider as string);
    entries.push({
      worker,
      adapter: createLiveHermesReviewerAdapter({
        worker, contexts: options.contexts, artifacts: options.artifacts,
        config: hermes, testCommand: options.testCommand,
        run: options.runners?.reviewer,
      }),
    });
  }

  return { ok: problems.length === 0, problems, entries: problems.length === 0 ? entries : [], requested };
}

/* --------------------------------------------------------------- budget */

/**
 * The dispatch-path budget: an in-process ceiling seeded from the mission's
 * spend limit. Reservations are idempotent by id and denial is a value.
 * Durable per-tool budget rows live with the executor settlement; making THIS
 * ledger durable is recorded debt, stated in JULIUS_BETA_READINESS.md rather
 * than papered over here.
 */
export function createRunSpendBudget(ceilingUsdMicros: number): JuliusBudgetPort {
  const held = new Map<string, { usdMicros: number; state: 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'DENIED' }>();
  const outstanding = () => [...held.values()]
    .filter((row) => row.state === 'RESERVED' || row.state === 'COMMITTED')
    .reduce((total, row) => total + row.usdMicros, 0);
  return {
    async reserve(input) {
      const existing = held.get(input.reservationId);
      if (existing !== undefined) {
        return existing.state === 'DENIED'
          ? { state: 'DENIED', denialReason: 'BUDGET_EXHAUSTED' }
          : { state: 'RESERVED', denialReason: null };
      }
      if (outstanding() + input.usdMicros > ceilingUsdMicros) {
        held.set(input.reservationId, { usdMicros: 0, state: 'DENIED' });
        return { state: 'DENIED', denialReason: 'BUDGET_EXHAUSTED' };
      }
      held.set(input.reservationId, { usdMicros: input.usdMicros, state: 'RESERVED' });
      return { state: 'RESERVED', denialReason: null };
    },
    async commit(input) {
      const row = held.get(input.reservationId);
      if (row === undefined || row.state !== 'RESERVED') return;
      // UNKNOWN SETTLES AT WHAT IT RESERVED. `null` is "the boundary reported
      // no cost", and freeing the hold on that would hand the rest of the
      // mission money this dispatch may already have spent.
      held.set(input.reservationId, { usdMicros: input.usdMicros ?? row.usdMicros, state: 'COMMITTED' });
    },
    async release(input) {
      const row = held.get(input.reservationId);
      if (row === undefined || row.state !== 'RESERVED') return;
      // SPENT MONEY IS CHARGED, NOT RELEASED. A failed attempt that billed
      // before it failed settles at what it billed; only an attempt that spent
      // nothing hands its whole hold back.
      const spent = typeof input.usdMicros === 'number' && Number.isFinite(input.usdMicros) && input.usdMicros > 0
        ? Math.min(input.usdMicros, row.usdMicros) : 0;
      held.set(input.reservationId, spent > 0
        ? { usdMicros: spent, state: 'COMMITTED' }
        : { usdMicros: 0, state: 'RELEASED' });
    },
    // What an allocation may be derived from: the ceiling minus everything
    // held or spent. This ledger can always answer, so it never says null.
    async available() { return ceilingUsdMicros - outstanding(); },
  };
}

/* ------------------------------------------------------------- assembly */

export interface LiveJuliusRuntime {
  readonly loop: JuliusRunLoop;
  readonly registry: JuliusWorkerRegistry;
  readonly router: JuliusProviderRouter;
  readonly store: JuliusRuntimeStore;
  readonly card: JuliusCardPolicy;
  readonly verification: JuliusVerificationPolicy;
}

/** Wraps the store so compiled contexts and task claims reach the adapters. */
/**
 * Generic in the store so a store that is ALSO a recovery driver stays one.
 * Declared as `JuliusRuntimeStore`, the spread below erased `recoverExpired`
 * from the type while keeping it at runtime — and the run loop, which sweeps
 * expired leases before it claims, cannot be built from a store that has lost
 * it.
 */
export function createContextAndClaimHandoffs<S extends JuliusRuntimeStore>(store: S): {
  readonly store: S;
  readonly contexts: CompiledContextSource;
  readonly claims: TaskClaimSource;
} {
  const snapshots = new Map<string, JuliusContextSnapshot>();
  const claims = new Map<string, { leaseGeneration: number }>();
  const wrapped: S = {
    ...store,
    persist: async (input) => {
      /**
       * KEYED BY THE ID THE STORE KEPT.
       *
       * Adapters resolve a context by the id the pipeline hands them, and the
       * pipeline now uses the STORED id — which, on a retry of unchanged
       * content, is the id of the row that already existed rather than the one
       * minted for this compile. Caching under the minted id would leave the
       * adapter unable to find a context that is durably present.
       */
      const persisted = await store.persist(input);
      if (persisted !== null) {
        snapshots.set(persisted, { ...input.snapshot, contextId: persisted });
        if (snapshots.size > 64) {
          const oldest = snapshots.keys().next().value;
          if (oldest !== undefined) snapshots.delete(oldest);
        }
      }
      return persisted;
    },
    claimRunnable: async (input) => {
      const claimed: JuliusClaimedTask[] = await store.claimRunnable(input);
      for (const claim of claimed) claims.set(claim.taskId, { leaseGeneration: claim.leaseGeneration });
      return claimed;
    },
  };
  return {
    store: wrapped,
    contexts: { snapshotFor: (contextId) => snapshots.get(contextId) ?? null },
    claims: { claimFor: (taskId) => claims.get(taskId) ?? null },
  };
}

export function assembleLiveJuliusRuntime(options: {
  // Also the recovery driver: the run loop sweeps expired leases itself, so
  // the bound on crash churn belongs to the kernel and not to a driver.
  readonly store: JuliusRuntimeStore & JuliusRecoveryDriver;
  readonly entries: readonly LiveWorkerEntry[];
  readonly cardRevision: string;
  readonly spendCeilingUsdMicros: number;
  readonly maxRepairRounds: number;
  readonly owner?: string;
  readonly budget?: JuliusBudgetPort;
}): LiveJuliusRuntime {
  const registry = new JuliusWorkerRegistry();
  const adapters = new Map<string, JuliusProviderAdapter>();
  for (const entry of options.entries) {
    registry.register(entry.worker);
    adapters.set(entry.worker.adapterId, entry.adapter);
  }
  const health = new JuliusProviderHealthRegistry();
  const router = new JuliusProviderRouter(registry, adapters, health);

  const card: JuliusCardPolicy = {
    revision: options.cardRevision,
    autonomy: 'AUTONOMOUS',
    allowedProviders: options.entries.map((entry) => entry.worker.providerId),
    capabilities: ['plan', 'implement', 'review'],
    network: true,
    filesystemMutation: true,
    fallback: false,
    automaticRetry: true,
    subagents: { allowed: false, maxDepth: 1, maxActive: 0, maxTotal: 0 },
    iterativeReview: { allowed: true, maxRounds: Math.max(1, options.maxRepairRounds + 1) },
    concurrency: 1,
    approvals: [],
  };
  const verification: JuliusVerificationPolicy = {
    revision: `verify:${options.cardRevision}`,
    reviewerRequired: true,
    maxRepairRounds: options.maxRepairRounds,
  };

  const deps: JuliusPipelineDependencies = {
    store: options.store,
    router,
    budget: options.budget ?? createRunSpendBudget(options.spendCeilingUsdMicros),
    clock: { now: () => new Date().toISOString() },
    ids: { next: (kind) => `${kind}:${randomUUID()}` },
    resources: fixedResourceEstimate({
      usdMicros: 300_000, inputTokens: 50_000, outputTokens: 20_000, toolCalls: 10, runtimeMs: 300_000,
    }),
    /**
     * THE MISSION CONTRACT GOVERNS THE CODING AGENT'S SPEND. The same two
     * contract fields that seed the run budget and the repair bound derive
     * the per-dispatch allocation: each Coding Agent round may spend an equal
     * share of `spendUsd` over the build and every authorised repair round,
     * never more than remains. See docs/JULIUS_PAID_RUN_34037313976_REPAIRS.md.
     */
    allocation: juliusAllocationPolicy({
      ceilingUsdMicros: options.spendCeilingUsdMicros, authorizedRepairRounds: options.maxRepairRounds,
    }),
    owner: options.owner ?? 'julius-live-mission',
    contextCharacterBudget: 24_000,
  };
  const policies: JuliusPolicySource = {
    async policyFor() { return { card, verification }; },
    capabilityFor: (task) => (task.role === 'PROMPT_ARCHITECT' ? 'plan' : task.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement'),
  };
  const loop = new JuliusRunLoop(deps, policies, { claimLimit: 4, leaseMs: 600_000 });
  return { loop, registry, router, store: options.store, card, verification };
}

/* ---------------------------------------------------------------- drive */

export interface DriveOutcome {
  readonly state: string;
  readonly ticks: number;
  readonly stalled: boolean;
  /**
   * Why a non-terminal run stopped moving, when that is knowable. Under the
   * effective-verification semantics a successfully repaired and re-accepted
   * REPAIR no longer blocks completion, so a run parked in VERIFYING with
   * every task terminal means some task's CURRENT decision is still not
   * effectively accepted — a HALT, or a REPAIR whose repair lineage never
   * reached an accepting re-verification. Naming those decisions beats
   * reporting an unexplained stall.
   */
  readonly haltCause: string | null;
}

/**
 * Tick the run loop until the run reaches a terminal state or nothing moves.
 * Completion, failure and every transition in between are the loop's own
 * decisions — this driver only asks it to take the next step.
 */
export async function driveJuliusRunToTerminal(input: {
  readonly loop: JuliusRunLoop;
  // The same store object goes to `assembleLiveJuliusRuntime`, whose run loop
  // sweeps expired leases itself, so it must be the recovery driver too. This
  // driver no longer sweeps — an earlier comment here said the sweep "below"
  // needed it, and there is no sweep below any more.
  readonly store: JuliusRuntimeStore & JuliusRecoveryDriver;
  readonly runId: string;
  readonly projectId: string;
  readonly maxTicks?: number;
}): Promise<DriveOutcome> {
  const maxTicks = input.maxTicks ?? 32;
  const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
  const stallCause = async (state: string): Promise<string | null> => {
    if (state !== 'VERIFYING') return null;
    const decisions = await input.store.decisionsForRun(input.runId, input.projectId);
    const nonAccept = decisions.filter((decision) => decision.action !== 'ACCEPT');
    return nonAccept.length === 0 ? null
      : `completion requires every task's current verification decision to be effectively accepted; this run's durable history holds these non-ACCEPT decisions (a REPAIR may already be superseded through its repair lineage): ${nonAccept.map((decision) => `${decision.action}(${decision.reasonCode})`).join(', ')}`;
  };
  let lastState = 'UNKNOWN';
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    // THE SWEEP IS THE KERNEL'S. This driver used to call `recover` before
    // every tick, which made a store-level guarantee depend on one composition
    // root remembering to make it — and it passed the default limit of 100
    // where `tick` passes the claim limit, so the bound the comments advertised
    // was not the bound the live path applied. `tick` sweeps first now.
    const report = await input.loop.tick({ projectId: input.projectId });
    const run = await input.store.loadRun(input.runId, input.projectId);
    lastState = run?.state ?? 'UNKNOWN';
    if (run !== null && terminal.has(run.state)) return { state: run.state, ticks: tick, stalled: false, haltCause: null };
    if (report.claimed === 0) {
      const advance = await input.loop.advanceRun(input.runId, input.projectId);
      const after = await input.store.loadRun(input.runId, input.projectId);
      lastState = after?.state ?? lastState;
      if (after !== null && terminal.has(after.state)) return { state: after.state, ticks: tick, stalled: false, haltCause: null };
      if (advance === null || !advance.changed) {
        return { state: lastState, ticks: tick, stalled: true, haltCause: await stallCause(lastState) };
      }
    }
  }
  return { state: lastState, ticks: maxTicks, stalled: true, haltCause: await stallCause(lastState) };
}
