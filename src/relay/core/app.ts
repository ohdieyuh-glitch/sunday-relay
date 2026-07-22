import { ok, fail, relayError, type RelayResult } from '../protocol/errors';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import { createRandomIdFactory, type IdFactory, type RunId } from '../protocol/ids';
import type { Blueprint } from '../protocol/contracts';
import { createOrchestrator, type Orchestrator, type OrchestratorConfig } from './orchestrator';
import { createSimulatedAdapters, type ScenarioConfig } from '../connectors/simulated';
import { createInMemoryRelayStores, type InMemoryRelayStores } from '../storage/memory';
import type { CompletionPolicy, PermissionPolicy } from '../protocol/contracts';
import type { PolicyId } from '../protocol/ids';
import {
  auditView, blueprintView, eventFeedView, evidenceView, handoffView,
  manualTaskView, projectBrainView, reviewView, runStatusView,
  taskOwnershipView, usageView,
} from './read-models';

/**
 * Relay application facade (Prompt 5) — the ONE approved composition root
 * for clients. Serializable commands in, serializable read models out; all
 * workflow decisions stay in Relay Core. Storage is the volatile in-memory
 * profile: state lives only while this process lives, and the facade says
 * so (`storageProfile`). No provider access exists anywhere behind it.
 */

export interface ScenarioDefinition {
  name: string;
  description: string;
  scenario: ScenarioConfig;
  configOverrides?: Partial<OrchestratorConfig>;
  /** Demo choreography markers consumed by the CLI demo runner. */
  choreography?: 'duplicate' | 'stale' | 'pause-resume' | 'cancel' | 'manual';
  /** Presentation fixture content (displayed context only — the simulator
   * never claims the real feature was implemented). */
  displayObjective?: string;
  taskObjective?: string;
  claimedFiles?: string[];
}

export const SCENARIOS: Record<string, ScenarioDefinition> = {
  direct: {
    name: 'direct',
    description: 'Direct success — no repair needed.',
    scenario: { reviewerAttempt1: 'approved', usdPerStep: 0.01 },
  },
  repair: {
    name: 'repair',
    description: 'Golden path — one failing check, one bounded repair, approval.',
    scenario: { failingCheckAttempt1: 'npx vitest run', reviewerAttempt1: 'changes_requested', reviewerAttempt2: 'approved', usdPerStep: 0.01 },
  },
  checkpoint: {
    name: 'checkpoint',
    description: 'Unsafe repair (protected file) — Guided Mode checkpoints.',
    scenario: { failingCheckAttempt1: 'npx vitest run', reviewerAttempt1: 'changes_requested', usdPerStep: 0.01 },
    configOverrides: { repairPlanFacts: { requiresProtectedFile: true } },
  },
  duplicate: {
    name: 'duplicate',
    description: 'Equivalent active task — dispatch denied, agent never invoked.',
    scenario: { usdPerStep: 0.01 },
    choreography: 'duplicate',
  },
  stale: {
    name: 'stale',
    description: 'Repository moved under a compiled handoff — checkpoint before dispatch.',
    scenario: { usdPerStep: 0.01 },
    choreography: 'stale',
  },
  failure: {
    name: 'failure',
    description: 'Honest failure — verification still fails after the single repair.',
    scenario: { failingCheckAttempt1: 'npx vitest run', stillFailingAfterRepair: true, reviewerAttempt1: 'changes_requested', usdPerStep: 0.01 },
  },
  'budget-warning': {
    name: 'budget-warning',
    description: 'Budget warning threshold crossed; run still completes.',
    scenario: { reviewerAttempt1: 'approved', usdPerStep: 0.05 },
    configOverrides: { budget: { maxUsd: 1, warningAtFraction: 0.05 }, costEstimatePerStep: { usd: 0.04 } },
  },
  'budget-stop': {
    name: 'budget-stop',
    description: 'Hard budget stop before dispatch.',
    scenario: { usdPerStep: 0.5 },
    configOverrides: { budget: { maxUsd: 0.6, missingEstimate: 'allow' }, costEstimatePerStep: { usd: 0.5 } },
  },
  'pause-resume': {
    name: 'pause-resume',
    description: 'Pause mid-run, resume, complete.',
    scenario: { reviewerAttempt1: 'approved', usdPerStep: 0.01 },
    choreography: 'pause-resume',
  },
  cancel: {
    name: 'cancel',
    description: 'Operator cancellation mid-run.',
    scenario: { usdPerStep: 0.01 },
    choreography: 'cancel',
  },
  manual: {
    name: 'manual',
    description: 'Manual Task — a protected setting needs the user; simple steps, then verified resume.',
    scenario: {
      reviewerAttempt1: 'approved',
      usdPerStep: 0.01,
      manualActionRequest: {
        reason: 'This setting can affect production. Relay is not allowed to change it without you.',
        requestedAction: 'Approve a protected setting',
        category: 'protected_resource',
        applicationOrLocation: 'Project settings',
        proposedSteps: [
          'Open the project settings.',
          'Open "Access."',
          'Review the requested change.',
          'Choose "Approve."',
          'Return to Relay.',
          'Choose "Done."',
        ],
        expectedResult: 'The change shows as approved.',
        verificationMethod: 'simulated-setting-check',
      },
    },
    choreography: 'manual',
    displayObjective: 'Demonstrate a Manual Task: Relay stops at a protected setting and asks the user for help (SIMULATED).',
    taskObjective: 'Demonstrate the Manual Task checkpoint flow (SIMULATED — no real settings are read or changed).',
  },
  yc: {
    name: 'yc',
    description: 'YC presentation preset — golden path with one bounded repair (SIMULATED).',
    scenario: {
      failingCheckAttempt1: 'anonymous spend-control proof',
      reviewerAttempt1: 'changes_requested',
      reviewerAttempt2: 'approved',
      usdPerStep: 0.02,
      changedFiles: ['src/access/anonymous-policy.ts', 'src/access/spend-boundary.ts'],
      reviewerFinding: {
        id: 'SEC-1',
        title: 'Anonymous spend-boundary bypass',
        detail: 'Anonymous traffic could bypass an account-level spend boundary.',
        recommendation: 'Enforce the account-level spend boundary for anonymous sessions and prove it with the spend-control tests.',
      },
    },
    displayObjective: "Finish Sunday's anonymous live-access activation safely and prepare it for production verification.",
    taskObjective: 'Demonstrate Relay orchestration for the anonymous live-access activation (SIMULATED — the real activation is NOT performed).',
    claimedFiles: ['src/access/anonymous-policy.ts', 'src/access/spend-boundary.ts'],
  },
  competitive: {
    name: 'competitive',
    description: 'Competitive proof — Mission Contract, Claude Implementer, Codex Independent Reviewer, finding, repair, verified completion (SIMULATED).',
    scenario: {
      // The anonymous rate-limit proof fails on attempt 1 BECAUSE of the
      // IPv6 rotation bypass; the INDEPENDENT REVIEWER identifies the /128
      // root cause, driving the one bounded repair (/64 aggregation), after
      // which all 30/30 pass.
      failingCheckAttempt1: '30/30 anonymous rate-limit proof',
      reviewerAttempt1: 'changes_requested',
      reviewerAttempt2: 'approved',
      usdPerStep: 0.02,
      changedFiles: ['src/access/anonymous-policy.ts', 'src/access/ipv6-identity.ts', 'src/access/spend-boundary.ts'],
      reviewerFinding: {
        id: 'F-1',
        title: 'IPv6 /128 rotation bypass',
        detail: 'The implementation identifies an IPv6 client by its complete /128 address. One client can rotate addresses inside the same /64 and avoid the intended anonymous identity limit.',
        recommendation: 'Aggregate IPv6 anonymous identities at the /64 boundary before applying the rate and spending policies.',
      },
    },
    displayObjective: 'Protect anonymous live access and prove one actor cannot bypass the rate limit or spending controls.',
    taskObjective: 'Demonstrate provider-neutral mission-control orchestration for anonymous access protection (SIMULATED — Claude Implementer and Codex Reviewer are deterministic simulations; no external Codex connection is active).',
    claimedFiles: ['src/access/anonymous-policy.ts', 'src/access/ipv6-identity.ts', 'src/access/spend-boundary.ts'],
  },
};

/** Competitive proof completion policy: 6 blocking product-relevant checks,
 * independent review required. Deterministic scenario data, labeled
 * SIMULATED end-to-end. */
const COMPETITIVE_COMPLETION_POLICY: CompletionPolicy = {
  policyId: 'pol_competitive-proof' as PolicyId,
  riskLevel: 'low',
  requiredEvidence: [
    { evidenceType: 'command', command: '30/30 anonymous rate-limit proof', mustPass: true },
    { evidenceType: 'command', command: '40/40 session proof', mustPass: true },
    { evidenceType: 'command', command: '23/23 spending proof', mustPass: true },
    { evidenceType: 'command', command: 'TypeScript build', mustPass: true },
    { evidenceType: 'command', command: 'file-claim policy', mustPass: true },
    { evidenceType: 'command', command: 'protected-path policy', mustPass: true },
  ],
  requiresIndependentReview: true,
  requiresHumanApproval: false,
  enforcementRequirements: [],
  acceptedProvenance: ['simulated'],
};

SCENARIOS.competitive.configOverrides = {
  completionPolicy: COMPETITIVE_COMPLETION_POLICY,
  budget: { maxUsd: 2, warningAtFraction: 0.8, missingEstimate: 'checkpoint' },
  costEstimatePerStep: { usd: 0.02 },
};

/** YC presentation completion policy: 13 product-relevant simulated checks.
 * Deterministic scenario data — labeled SIMULATED end-to-end. */
const YC_COMPLETION_POLICY: CompletionPolicy = {
  policyId: 'pol_yc-presentation' as PolicyId,
  riskLevel: 'low',
  requiredEvidence: [
    { evidenceType: 'command', command: 'anonymous access-policy tests', mustPass: true },
    { evidenceType: 'command', command: 'anonymous spend-control proof', mustPass: true },
    { evidenceType: 'command', command: 'rate-limit tests', mustPass: true },
    { evidenceType: 'command', command: 'HMAC token-scope tests', mustPass: true },
    { evidenceType: 'command', command: 'emergency-stop test', mustPass: true },
    { evidenceType: 'command', command: 'session-ownership tests', mustPass: true },
    { evidenceType: 'command', command: 'zero-dispatch auth tests', mustPass: true },
    { evidenceType: 'command', command: 'typecheck', mustPass: true },
    { evidenceType: 'command', command: 'build', mustPass: true },
    { evidenceType: 'command', command: 'migration dry-run check', mustPass: true },
    { evidenceType: 'command', command: 'config validation', mustPass: true },
    { evidenceType: 'command', command: 'targeted regression tests', mustPass: true },
    { evidenceType: 'diff', mustPass: true },
  ],
  requiresIndependentReview: true,
  requiresHumanApproval: false,
  enforcementRequirements: [],
  acceptedProvenance: ['simulated'],
};

SCENARIOS.yc.configOverrides = {
  completionPolicy: YC_COMPLETION_POLICY,
  budget: { maxUsd: 2, warningAtFraction: 0.8, missingEstimate: 'checkpoint' },
  costEstimatePerStep: { usd: 0.02 },
};

export interface RelayAppOptions {
  scenarioName: string;
  /** Interactive Guided Mode: blueprint awaits an explicit approval command. */
  interactiveBlueprint?: boolean;
  maxCostUsd?: number;
  /** Deterministic seams for tests; production uses real clock/random ids. */
  ids?: IdFactory;
  now?: () => string;
  /** Test-only deterministic overrides layered onto the registered scenario
   * (e.g. a failing manual verification). The CLI never sets these. */
  overrides?: { scenario?: Partial<ScenarioConfig>; config?: Partial<OrchestratorConfig> };
}

export interface RelayApp {
  readonly scenarioName: string;
  readonly storageProfile: 'volatile-memory';
  readonly adapterProfile: 'simulation';
  start(objective: string, taskObjective?: string): RelayResult<{ runId: RunId }>;
  step(): RelayResult<{ action: string; done: boolean; status: string }>;
  continueRun(): RelayResult<{ actions: string[]; stopReason: string; status: string }>;
  acceptBlueprint(): RelayResult<{ status: string }>;
  rejectBlueprint(reason: string): RelayResult<{ status: string }>;
  pause(): RelayResult<{ status: string }>;
  resume(): RelayResult<{ status: string }>;
  cancel(reason: string): RelayResult<{ status: string }>;
  respondCheckpoint(response: 'approve' | 'reject', note?: string): RelayResult<{ status: string }>;
  /** Manual Task responses (Prompt 6.1). Cancel stays the canonical cancel(). */
  respondManualTask(response: 'done' | 'help' | 'cannot', note?: string): RelayResult<{ status: string }>;
  /** For the duplicate/stale demo choreography only. */
  startSecondEquivalentRun(): RelayResult<{ runId: RunId }>;
  moveBaseRevision(to: string): void;
  status(): ReturnType<typeof runStatusView>;
  events(sinceSequence?: number): ReturnType<typeof eventFeedView>;
  brain(): ReturnType<typeof projectBrainView>;
  task(): ReturnType<typeof taskOwnershipView>;
  blueprint(): ReturnType<typeof blueprintView>;
  handoff(): ReturnType<typeof handoffView>;
  evidence(): ReturnType<typeof evidenceView>;
  review(): ReturnType<typeof reviewView>;
  usage(): ReturnType<typeof usageView> | null;
  audit(): ReturnType<typeof auditView>;
  manualTask(): ReturnType<typeof manualTaskView>;
}

/** The simulation profile's completion policy: simulated evidence is
 * EXPLICITLY accepted (never silently), independent review required. */
const SIMULATION_COMPLETION_POLICY: CompletionPolicy = {
  policyId: 'pol_simulation-low-risk' as PolicyId,
  riskLevel: 'low',
  requiredEvidence: [{ evidenceType: 'command', command: 'npx vitest run', mustPass: true }],
  requiresIndependentReview: true,
  requiresHumanApproval: false,
  enforcementRequirements: [],
  acceptedProvenance: ['simulated'],
};

const SIMULATION_PERMISSION_POLICY: PermissionPolicy = {
  permittedTools: [{ value: 'editor', enforcement: 'advisory' }],
  permittedFiles: [],
  prohibitedActions: [{ value: 'network-egress', enforcement: 'advisory' }],
  protectedPaths: [{ pattern: '.git', enforcement: 'enforced' }],
};

export function createRelayApp(options: RelayAppOptions): RelayResult<RelayApp> {
  const definition = SCENARIOS[options.scenarioName];
  if (!definition) {
    return fail(relayError('validation-failed', `Unknown scenario "${options.scenarioName}". Known: ${Object.keys(SCENARIOS).join(', ')}.`));
  }
  const stores: InMemoryRelayStores = createInMemoryRelayStores({ acknowledgeVolatile: true });
  const ids = options.ids ?? createRandomIdFactory();
  const now = options.now ?? (() => new Date().toISOString());
  const adapters = createSimulatedAdapters({ ...definition.scenario, ...(options.overrides?.scenario ?? {}) });
  const config: OrchestratorConfig = {
    completionPolicy: SIMULATION_COMPLETION_POLICY,
    permissionPolicy: SIMULATION_PERMISSION_POLICY,
    budget: { maxUsd: options.maxCostUsd ?? 1, warningAtFraction: 0.8, missingEstimate: 'checkpoint' },
    loopPolicy: { maxAutomaticRevisions: 1 },
    stoppingCondition: { description: 'stop after report', maxRuntimeMs: 60000 },
    baseRevision: 'rev-sim-abc123',
    leaseMs: 3_600_000,
    costEstimatePerStep: { usd: 0.01 },
    autoAcceptBlueprint: !options.interactiveBlueprint,
    ...(definition.configOverrides ?? {}),
    ...(options.overrides?.config ?? {}),
    ...(options.maxCostUsd !== undefined ? { budget: { maxUsd: options.maxCostUsd, warningAtFraction: 0.8, missingEstimate: 'checkpoint' as const } } : {}),
  };
  const orchestrator: Orchestrator = createOrchestrator({ stores, adapters, ids, clock: { now }, config });

  let runId: RunId | null = null;
  let currentBlueprint: Blueprint | null = null;
  let blueprintAccepted = false;
  const verdicts: Parameters<typeof reviewView>[2] = [];
  let commandSeq = 0;

  const needRun = <T>(fn: (id: RunId) => T): T | RelayResult<never> =>
    runId ? fn(runId) : fail(relayError('not-found', 'No run started yet — enter an objective first.'));

  const userCommand = (commandType: string, payload: Record<string, unknown>): RelayResult<{ status: string }> => {
    if (!runId) return fail(relayError('not-found', 'No run started yet.'));
    const result = orchestrator.command({
      protocolVersion: RELAY_PROTOCOL_VERSION,
      commandId: `cli-${commandType}-${++commandSeq}`,
      commandType,
      issuedAt: now(),
      actor: { kind: 'user', id: 'cli-operator' },
      payload,
      provenance: 'manual',
    });
    if (!result.ok) return result;
    return ok({ status: result.value.run.status });
  };

  const trackArtifacts = () => {
    // Blueprint + verdict tracking for read views (derived from stored reports).
    if (!runId) return;
    const reports = stores.reports.list().filter((r) => r.runId === runId);
    const blueprintReport = reports.find((r) => r.reportType === 'blueprint');
    if (blueprintReport && !currentBlueprint) {
      const payload = blueprintReport.payload as { architectDisplayName: string; content: Blueprint['content'] };
      currentBlueprint = {
        blueprintId: (stores.runs.get(runId)?.blueprintId ?? 'blu_pending') as Blueprint['blueprintId'],
        projectId: blueprintReport.projectId, runId, version: 1, source: 'simulated',
        architectIdentity: { adapterId: blueprintReport.agentIdentity.adapterId, displayName: payload.architectDisplayName },
        submittedAt: blueprintReport.submittedAt, content: payload.content, provenance: blueprintReport.provenance,
      };
    }
    if (stores.runs.get(runId)?.phase !== 'blueprint') blueprintAccepted = true;
    const reviewReports = reports.filter((r) => r.reportType === 'review');
    while (verdicts.length < reviewReports.length) {
      const report = reviewReports[verdicts.length];
      const payload = report.payload as { verdict: 'approved' | 'changes_requested'; findings: [] };
      verdicts.push({ verdict: payload.verdict, findings: payload.findings, independent: true, provenance: report.provenance, reportId: report.reportId });
    }
  };

  const app: RelayApp = {
    scenarioName: definition.name,
    storageProfile: 'volatile-memory',
    adapterProfile: 'simulation',

    start(objective, taskObjective) {
      if (runId) return fail(relayError('duplicate-command', 'A run already exists in this volatile session.'));
      const setup = orchestrator.setup({
        projectName: 'Sunday Relay Demo',
        objective,
        taskObjective: taskObjective ?? definition.taskObjective ?? `Demonstrate Relay orchestration for: ${objective} (SIMULATED — the real feature is NOT implemented)`,
        claimedFiles: definition.claimedFiles ?? ['src/sim/feature.ts'],
        equivalenceKey: `sim:${definition.name}`,
      });
      if (!setup.ok) return setup;
      runId = setup.value.run.runId;
      return ok({ runId });
    },

    step() {
      return needRun((id) => {
        const result = orchestrator.step(id);
        if (!result.ok) return result;
        trackArtifacts();
        return ok({ action: result.value.action, done: result.value.done, status: result.value.run.status });
      }) as RelayResult<{ action: string; done: boolean; status: string }>;
    },

    continueRun() {
      return needRun((id) => {
        const result = orchestrator.runUntilStopped(id);
        if (!result.ok) return result;
        trackArtifacts();
        return ok({ actions: result.value.actions, stopReason: result.value.stopReason, status: result.value.run.status });
      }) as RelayResult<{ actions: string[]; stopReason: string; status: string }>;
    },

    acceptBlueprint() {
      if (!currentBlueprint) return fail(relayError('not-found', 'No blueprint awaiting approval.'));
      const accepted = userCommand('accept-blueprint', { runId, blueprintId: currentBlueprint.blueprintId });
      if (accepted.ok) blueprintAccepted = true;
      return accepted;
    },
    rejectBlueprint(reason) {
      return userCommand('cancel-run', { runId, reason: `Blueprint rejected: ${reason}` });
    },
    pause: () => userCommand('pause-run', { runId }),
    resume: () => userCommand('resume-run', { runId }),
    cancel: (reason) => userCommand('cancel-run', { runId, reason }),
    respondCheckpoint(response, note) {
      const checkpoint = runId ? stores.runs.get(runId)?.checkpoint : null;
      if (!checkpoint) return fail(relayError('not-found', 'No checkpoint awaiting a response.'));
      return userCommand('respond-checkpoint', { runId, checkpointId: checkpoint.checkpointId, response, ...(note ? { note } : {}) });
    },
    respondManualTask(response, note) {
      const checkpoint = runId ? stores.runs.get(runId)?.checkpoint : null;
      if (!checkpoint?.manualTask) return fail(relayError('not-found', 'No manual task awaiting a response.'));
      return userCommand('respond-manual-task', {
        runId,
        checkpointId: checkpoint.checkpointId,
        manualTaskId: checkpoint.manualTask.manualTaskId,
        response,
        ...(note ? { note } : {}),
      });
    },

    startSecondEquivalentRun() {
      const setup = orchestrator.setup({
        projectName: 'Sunday Relay Demo',
        objective: 'Second, equivalent objective (duplicate demonstration).',
        taskObjective: 'Equivalent work under the same equivalence key.',
        claimedFiles: ['src/sim/other.ts'],
        equivalenceKey: `sim:${definition.name}`,
      });
      if (!setup.ok) return setup;
      runId = setup.value.run.runId; // views now follow the second run
      currentBlueprint = null;
      blueprintAccepted = false;
      return ok({ runId });
    },
    moveBaseRevision(to) {
      config.baseRevision = to;
    },

    status: () => (runId ? runStatusView(stores, runId) : null),
    events: (since = 0) => (runId ? eventFeedView(stores, runId, since) : []),
    brain: () => (runId ? projectBrainView(stores, runId) : null),
    task: () => (runId ? taskOwnershipView(stores, runId) : null),
    blueprint: () => (runId ? blueprintView(stores, runId, currentBlueprint, blueprintAccepted) : null),
    handoff: () => (runId ? handoffView(stores, runId) : null),
    evidence: () => (runId ? evidenceView(stores, runId) : []),
    review: () => (runId ? reviewView(stores, runId, verdicts) : []),
    usage: () => (runId ? usageView(stores, runId) : null),
    audit: () => (runId ? auditView(stores, runId) : null),
    manualTask: () => (runId ? manualTaskView(stores, runId) : null),
  };
  return ok(app);
}
