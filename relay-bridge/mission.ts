/**
 * PRODUCTION THREE-ROLE MISSION ORCHESTRATOR + in-memory registry.
 *
 * One record per browser mission id. `start` runs the real production
 * pipeline and is the SINGLE production caller of every role connector:
 *
 *   founder request
 *     → complete three-role preflight (nothing is consumed before it passes)
 *     → ChatGPT Prompt Architect            (runOpenAiArchitect — OpenAI REST)
 *     → validated structured handoff + persisted attestation
 *     → automatic handoff to Claude Code    (runCodingMission — local CLI)
 *     → truthful terminal events + agent claim
 *     → deterministic Relay verification + artifact digest
 *     → Hermes independent read-only review (runHermesReview — Hermes CLI)
 *     → completion authority               (decideCompletion, review REQUIRED)
 *
 * Guarantees: one dispatch per role per mission revision (persisted role
 * ledger), a full-team preflight before the first paid request, every state
 * transition persisted on the record BEFORE the next role begins, safe
 * cancellation, and never a fabricated success — a failed or unavailable role
 * fails honestly and no fallback may satisfy a required role.
 *
 * The Fusion/Sunday-Alcatraz architect path is preserved for the explicit
 * non-live development mode (RELAY_PROMPT_ARCHITECT_MODE=fusion); it never
 * runs in the live three-role path, and it never earns ChatGPT credit.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { runArchitect, ArchitectUnavailableError, type SundayMode } from './architect';
import { runCodingMission, codingHandoffDigest, type CancelHandle, type CodingOutcome } from './coding';
import { disposeRetainedWorktree } from './ship-mission';
import type { MissionRepositoryTarget } from '../src/relay/mission/repository-target';
import { resolveClaudeRuntime } from './claude-runtime';
import {
  ARCHITECT_COORDINATION_LABEL,
  architectPreflight,
  loadArchitectConfig,
  runOpenAiArchitect,
  PromptArchitectBlockedError,
  type ArchitectReceipt,
  type PromptArchitectHandoff,
} from './openai-architect';
import {
  hermesPreflight,
  loadHermesConfig,
  runHermesReview,
  type HermesOutcome,
  type HermesPreflightResult,
} from './hermes-reviewer';
import { resolveReviewerTransport as resolveTransport, reviewerPreflight as runReviewerPreflight } from './reviewer-transport';
import { runRemoteHermesReview } from './hermes-remote-review';
import { classifyModelIdentity } from './model-identity';
import { runOpenAiReview } from './openai-reviewer';
import type { ReviewerTransport } from './reviewer-transport';
import type { LiveReachService } from './live-reach-service';
import type { BackendProbe } from '../src/relay/mission/live-reach';
import type { MissionEvidenceReference } from '../src/relay/mission/wire-contracts';
import { renderForPrompt as renderEvidenceForPrompt, evidenceReference as evidenceReferenceOf } from '../src/relay/mission/evidence';
import { billingPhrase, buildAttestation, decideCompletion, declaredBillingPath, digest, occupantBillingPath, type ExecutionAttestation } from './attestation';
import { isProductionDeployment } from './deployment-environment';
import { createHostedClaudeInvoker } from './hosted-coding-agent/hosted-invoker';
import { RELAY_SKILLS, evaluateInternalSkillCall, findSkill } from '../src/relay/mission/skills';
import {
  HOSTED_API_KEY_ENV, HOSTED_MODEL_ENV, probeHostedReadiness,
} from './hosted-coding-agent/hosted-readiness';
import type { ClaudeCodeCapabilityProfile } from '../src/relay/connectors/claude-code/contracts';
import {
  CODING_AGENT_ROLE_ENV, REVIEWER_ROLE_ENV, configuredNames, describeBinding,
  explicitlySelectedReviewerOccupant, missionDispatchProblems, resolveRoleSlots, reviewerSlotConflict,
} from './role-slot-config';
import type { RoleSlot } from '../src/relay/mission/role-slots';
import { safeError, safeText } from './redact';
import type {
  BridgeEventInput,
  CodingTerminalState,
  LiveMissionUpdate,
  MissionAttestationSummary,
  MissionArchitectReceipt,
  MissionClaim,
  MissionError,
  MissionHandoff,
  MissionPhase,
  MissionReview,
  MissionRole,
  RelayMissionState,
} from './types';
import { createRandomIdFactory } from '../src/relay/protocol/ids';

const MAX_RETRIES = 2;

/** Relay's fixed safety envelope for the controlled fixture task. Authoritative
    — the Prompt Architect is told about it but can never widen it. */
const CLAIMED_FILE = 'src/normalize.js';
const PROHIBITED_FILES = ['package.json', 'README.md', 'test/', '.git'];
const VERIFICATION_COMMAND = 'node --test test/normalize.test.js';
const PROJECT_DESCRIPTION =
  'A throwaway Node.js fixture repository created by Relay under the OS temp directory. ' +
  'It contains src/normalize.js (a stub) and test/normalize.test.js (failing). No dependencies are installed.';

const FIXED_CONSTRAINTS = [
  `Edit only the claimed file (${CLAIMED_FILE}).`,
  'Do not modify protected files (package.json, README.md, test/).',
  'No shell, network, deployment, or git push.',
];
const FIXED_ACCEPTANCE = [
  'The existing test suite passes when Relay runs it.',
  'Only the claimed file changed; the source worktree is untouched.',
];
const FIXED_REQUIREMENTS = [
  'Trim surrounding whitespace from the input.',
  'Lowercase the result.',
  'Convert whitespace and underscores to hyphens.',
  'Collapse repeated hyphens into one.',
  'Remove leading and trailing hyphens.',
];
const OUT_OF_SCOPE = [
  'Installing packages or adding dependencies.',
  'Network access of any kind.',
  'Shell commands, deployment, or git operations.',
  'Editing the tests or any file outside the allowed list.',
];
const EVIDENCE_REQUIREMENTS = [
  'Relay itself runs the verification command; the agent never reports the result as evidence.',
  'Relay independently inspects the workspace; the agent report is a claim only.',
];
const NO_REPAIR_RULE =
  'There is no repair iteration. The Coding Agent gets exactly one invocation; a blocking review finding stops the mission.';
const MAX_ROLE_CALLS = 1;

/* --------------------------------------------------------- state model */

/** Coarse UI state for each orchestration phase. The browser's mission state
    union is unchanged — the fine-grained phase travels alongside it. */
const PHASE_STATE: Record<MissionPhase, RelayMissionState> = {
  ready: 'ready',
  preflight_checking: 'ready',
  prompt_architect_queued: 'architect_working',
  prompt_architect_working: 'architect_working',
  handoff_ready: 'handoff_ready',
  coding_agent_assigned: 'handoff_ready',
  coding_agent_starting: 'coding',
  coding: 'coding',
  claim_submitted: 'claim_submitted',
  relay_verifying: 'relay_verifying',
  reviewer_assigned: 'reviewer_reviewing',
  reviewer_starting: 'reviewer_reviewing',
  reviewer_working: 'reviewer_reviewing',
  review_received: 'reviewer_reviewing',
  completion_deciding: 'reviewer_reviewing',
  verified_complete: 'verified_complete',
  // terminal failures — the browser shows "stopped safely" with a safe reason
  preflight_blocked: 'failed',
  prompt_architect_failed: 'failed',
  prompt_architect_output_invalid: 'failed',
  dispatch_status_uncertain: 'failed',
  coding_agent_failed: 'failed',
  verification_failed: 'failed',
  reviewer_launch_failed: 'failed',
  review_incomplete: 'failed',
  review_blocked: 'failed',
  cancelled: 'cancelled',
  timed_out: 'failed',
};

const PHASE_ROLE: Partial<Record<MissionPhase, MissionRole>> = {
  prompt_architect_queued: 'prompt_architect',
  prompt_architect_working: 'prompt_architect',
  coding_agent_assigned: 'coding_agent',
  coding_agent_starting: 'coding_agent',
  coding: 'coding_agent',
  claim_submitted: 'coding_agent',
  reviewer_assigned: 'reviewer',
  reviewer_starting: 'reviewer',
  reviewer_working: 'reviewer',
  review_received: 'reviewer',
};

/** Terminal failure phases never resolve into a completed mission. */
const TERMINAL_FAILURE: ReadonlySet<MissionPhase> = new Set<MissionPhase>([
  'preflight_blocked',
  'prompt_architect_failed',
  'prompt_architect_output_invalid',
  'dispatch_status_uncertain',
  'coding_agent_failed',
  'verification_failed',
  'reviewer_launch_failed',
  'review_incomplete',
  'review_blocked',
  'timed_out',
]);

/* ------------------------------------------------------- role ledger */

type LedgerStatus = 'in_flight' | 'complete' | 'failed';

/** Persisted, per-role idempotency identity. A completed role is recovered,
    never redispatched — by a refresh, a duplicate POST, a second browser tab,
    a polling cycle, or a founder retry. */
const architectKey = (missionId: string, revision: string) => `${missionId}:prompt-architect:${revision}`;
const codingKey = (missionId: string, handoffDigest: string) => `${missionId}:coding-agent:${handoffDigest}`;
const reviewerKey = (missionId: string, artifactDigest: string) => `${missionId}:reviewer:${artifactDigest}`;
const completionKey = (missionId: string, artifactDigest: string, reviewDigest: string) =>
  `${missionId}:completion:${artifactDigest}:${reviewDigest}`;

/* --------------------------------------------------------- the record */

type StoredEvent = Omit<import('../src/relay/mission/wire-contracts').RelayEvent, 'id' | 'missionId' | 'demo'>;

interface MissionRecord {
  /** What this Mission is authorised to retrieve. Empty by default. */
  evidenceReferences: readonly { readonly source: string; readonly reference: string }[];
  /** Fenced observation blocks, in retrieval order. Empty until gathered. */
  liveEvidence: string[];
  /** Durable references to what was retrieved. References, never content. */
  evidenceRecords: MissionEvidenceReference[];
  missionId: string;
  /** The founder's exact request, preserved verbatim and separately from any
      generated handoff. */
  originalRequest: string;
  objective: string;
  /** Stable identity of this mission's contract. Every role is attested
      against it and a role attested against another revision cannot complete. */
  missionRevision: string;
  phase: MissionPhase;
  state: RelayMissionState;
  currentRole: MissionRole;
  events: StoredEvent[];
  handoff?: MissionHandoff;
  /** The validated Prompt Architect handoff, exactly as returned. */
  architectHandoff?: PromptArchitectHandoff;
  architectReceipt?: MissionArchitectReceipt;
  /** The repository this Mission targets, or null for the controlled fixture. */
  repositoryTarget: MissionRepositoryTarget | null;
  /** The files it declared it would write. Empty for the fixture. */
  intendedWritePaths: readonly string[];
  handoffDigest?: string;
  deliveredHandoffDigest?: string;
  claim?: MissionClaim;
  error?: MissionError;
  terminal?: CodingTerminalState;
  artifactDigest?: string;
  review?: MissionReview;
  attestations: Partial<Record<'prompt_architect' | 'coding_agent' | 'reviewer', ExecutionAttestation>>;
  codingOutcome?: CodingOutcome;
  ledger: Map<string, LedgerStatus>;
  completedAt: string | null;
  running: boolean;
  cancelRequested: boolean;
  cancelHandle: CancelHandle | null;
  retryCount: number;
}

/* --------------------------------------------------------- public API */

export type ArchitectPathMode = 'live' | 'fusion' | 'blocked';

/** Injectable role boundaries. Every default is the REAL production
    implementation — tests replace them so no provider is ever contacted. */
/** The occupant whose execution surface is the hosted Agent SDK. */
const HOSTED_CODING_OCCUPANT = 'claude_agent_sdk_hosted';

/**
 * The capability profile handed to the coding leg on the hosted path.
 *
 * It describes the CLI, and the hosted surface has no CLI — the invoker seam
 * replaces the spawn entirely, so nothing here reaches a process. NOTHING READS
 * IT on the hosted path either: `compileClaudePermissions` consults one field
 * behind a disabled branch, so the compiled policy is identical for any
 * profile. It exists to satisfy the parameter's type, and saying that is more
 * useful than a claim about enforcement it does not perform. The hosted run's
 * real restrictions live in `hosted-envelope.ts`.
 */
const HOSTED_PLACEHOLDER_CAPABILITIES: ClaudeCodeCapabilityProfile = Object.freeze({
  executablePath: null, version: null,
  nonInteractiveSupported: true, streamJsonSupported: true,
  explicitResumeSupported: false, maxTurnsSupported: true,
  allowedToolsSupported: true, disallowedToolsSupported: true,
  toolsRestrictionSupported: true, permissionModeSupported: true,
  systemPromptSupported: true, appendSystemPromptSupported: true,
  structuredSchemaSupported: true,
  mcpIsolationSupported: 'available', settingsIsolationSupported: 'available',
  cancellationSupported: true,
  probedAt: '1970-01-01T00:00:00.000Z', provenance: 'live',
});

export interface MissionRoleDeps {
  runOpenAiArchitect?: typeof runOpenAiArchitect;
  runFusionArchitect?: typeof runArchitect;
  runCodingMission?: typeof runCodingMission;
  runHermesReview?: typeof runHermesReview;
  /** The remote Reviewer, for a bridge that reaches a dedicated service. */
  runRemoteHermesReview?: typeof runRemoteHermesReview;
  /** The provider-API Reviewer, for a bridge with neither binary nor service. */
  runOpenAiReview?: typeof runOpenAiReview;
  /**
   * Live Reach retrieval, for a Mission authorised to read something.
   *
   * Injected so the gathering path is testable without a network, and so a
   * deployment that wires no retrieval simply gathers nothing.
   */
  gatherEvidence?: LiveReachService['retrieve'];
  /** Probes the readiness model reads. Empty means nothing was observed. */
  evidenceProbes?: readonly BackendProbe[];
  /**
   * The transport used to PROBE the remote Reviewer's readiness.
   *
   * Injected for the same reason every other outward call in this file is: a
   * test must be able to exercise the hosted path without a network, and a
   * readiness probe that could not be stubbed would make the remote mission
   * path untestable — which is how the hosted Coding Agent's equivalent defect
   * survived until an independent review ran it on a real host.
   */
  remoteReviewerFetch?: typeof fetch;
  resolveClaudeRuntime?: typeof resolveClaudeRuntime;
  hermesPreflight?: typeof hermesPreflight;
  /** Relay-side preflight override (persistence / write-scope probes). */
  relayPreflight?: () => { ready: boolean; missing: string[] };
  /** Builds the hosted Coding Agent invoker. Replaced in tests so the whole
      hosted pipeline is proven with no paid call. */
  createHostedInvoker?: typeof createHostedClaudeInvoker;
}

export interface MissionRegistryConfig {
  /**
   * Where the development architect lives, or null where it cannot live
   * anywhere — a production container has no loopback Fusion. A mission that
   * would select the fusion path with null here is refused rather than sent to
   * an address nothing answers.
   */
  fusionBaseUrl: string | null;
  sundayMode: SundayMode;
  claudeMode: 'live' | 'fake';
  confirmLive: boolean;
  now?: () => string;
  baseEnv?: Record<string, string | undefined>;
  /** Environment the Prompt Architect configuration is read from (values are
      never read into a mission view — only presence is ever checked). */
  architectEnv?: NodeJS.ProcessEnv;
  /** Environment the Hermes reviewer configuration is read from. */
  hermesEnv?: NodeJS.ProcessEnv;
  deps?: MissionRoleDeps;
}

export interface MissionRegistry {
  start(input: {
    missionId: string;
    objective: string;
    /**
     * References the Mission is AUTHORISED to retrieve before planning.
     *
     * Explicit and empty by default. A Mission does not decide on its own that
     * it needs the internet, and Relay does not decide for it — the caller
     * that knows the Mission's scope names what may be read, which is the same
     * separation Live Reach draws between a capability being available and a
     * Mission having asked for it.
     */
    evidenceReferences?: readonly { readonly source: string; readonly reference: string }[];
    /**
     * THE REPOSITORY THIS MISSION TARGETS, when the caller selected one.
     *
     * Absent means the controlled fixture — every existing caller, and the
     * default the design document requires to keep working unchanged.
     *
     * Present means a resolved, AUTHORIZED `MissionRepositoryTarget`. The Mission
     * engine does not resolve it: resolution reads a registration, and a
     * registration is a founder action. The caller that registered it passes the
     * resolved target, which is the same separation the evidence references above
     * draw between a capability existing and a Mission having asked for it.
     */
    repositoryTarget?: MissionRepositoryTarget;
    /**
     * The files this Mission declares it will write, narrowed from the target's
     * write scope. Required whenever `repositoryTarget` is present.
     *
     * Deliberately NOT derived from the architect's handoff: the handoff is a
     * model's plan and this is an authorization decision, so taking it from there
     * would let the architect widen its own envelope.
     */
    intendedWritePaths?: readonly string[];
  }): LiveMissionUpdate;
  get(missionId: string): LiveMissionUpdate | null;
  /**
   * WHAT THE SHIP NEEDS FROM A COMPLETED MISSION, or null.
   *
   * A pure read: it returns a target, its retained worktree, and its key ONLY
   * for a mission that is `verified_complete`, carried a real repository target,
   * and retained a worktree. Any other mission — fixture, unfinished, or one
   * whose worktree was not retained — returns null, so a ship can never be
   * attempted against a mission that has nothing to ship.
   */
  shipContext(missionId: string): {
    readonly target: MissionRepositoryTarget;
    readonly worktreePath: string;
  } | null;
  cancel(missionId: string): LiveMissionUpdate | null;
  retry(missionId: string): LiveMissionUpdate | null;
}

/** Explicit path selection. Live execution is NEVER inferred from a credential
    being present — the mode must say so. */
export function selectArchitectPath(env: NodeJS.ProcessEnv): ArchitectPathMode {
  if (env.RELAY_PROMPT_ARCHITECT_MODE === 'live') return 'live';
  if (env.RELAY_PROMPT_ARCHITECT_MODE === 'fusion') return 'fusion';
  return 'blocked';
}

/** Relay-side readiness: a writable scratch root that is NOT inside a founder
    repository, plus the in-process idempotency + cancellation ownership. */
function defaultRelayPreflight(): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  let probe: string | null = null;
  try {
    probe = mkdtempSync(join(tmpdir(), 'relay-preflight-'));
  } catch {
    missing.push('relay writable scratch directory');
  } finally {
    if (probe) {
      try {
        rmSync(probe, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
  // The controlled fixture is always created under the OS temp directory. If
  // that root sits inside the process working tree, a founder repository would
  // be inside the task's write scope — block rather than risk it.
  const cwd = process.cwd();
  if (tmpdir().startsWith(cwd + sep) || tmpdir() === cwd) {
    missing.push('relay write scope isolated from the founder repository');
  }
  return { ready: missing.length === 0, missing };
}

export function createMissionRegistry(config: MissionRegistryConfig): MissionRegistry {
  const now = config.now ?? (() => new Date().toISOString());
  const records = new Map<string, MissionRecord>();
  const deps = config.deps ?? {};
  const callArchitect = deps.runOpenAiArchitect ?? runOpenAiArchitect;
  const callFusionArchitect = deps.runFusionArchitect ?? runArchitect;
  const callCoding = deps.runCodingMission ?? runCodingMission;
  const callLocalReviewer = deps.runHermesReview ?? runHermesReview;
  const callRemoteReviewer = deps.runRemoteHermesReview ?? runRemoteHermesReview;
  const callProviderReviewer = deps.runOpenAiReview ?? runOpenAiReview;
  /**
   * ONE CALL SITE, TWO TRANSPORTS.
   *
   * The mission leg asks for a review and gets a `HermesOutcome`. Which host
   * produced it is this function's business and nothing else's — which is why
   * the attestation, the verdict and the findings below are untouched by the
   * remote path existing.
   *
   * A transport that resolved UNAVAILABLE never reaches here: the preflight
   * refuses first, so this cannot be asked to review with a reviewer the
   * deployment does not have.
   */
  const callReviewer = async (input: {
    packet: Parameters<typeof runHermesReview>[0]['packet'];
    config: Parameters<typeof runHermesReview>[0]['config'];
    now: () => string;
    transport: ReviewerTransport;
    runId: string;
  }) => (
    input.transport.kind === 'remote'
      ? await callRemoteReviewer({
        packet: input.packet,
        config: input.transport.config,
        runId: input.runId,
      })
      : input.transport.kind === 'provider'
        ? await callProviderReviewer({ packet: input.packet, config: input.transport.config })
        : await callLocalReviewer({ packet: input.packet, config: input.config, now: input.now })
  );
  const resolveRuntime = deps.resolveClaudeRuntime ?? resolveClaudeRuntime;
  const checkHermes = deps.hermesPreflight ?? hermesPreflight;
  const checkRelay = deps.relayPreflight ?? defaultRelayPreflight;
  const makeHostedInvoker = deps.createHostedInvoker ?? createHostedClaudeInvoker;
  /**
   * The default gatherer refuses everything, and that is correct.
   *
   * A bridge that wired no Live Reach service has no way to retrieve, and a
   * Mission naming a reference on such a deployment must be told it was not
   * retrieved — never handed a fabricated observation.
   */
  const gatherEvidence = deps.gatherEvidence ?? (async () => ({
    ok: false as const,
    refusal: 'not_ready' as const,
    detail: 'This bridge has no Live Reach service wired, so nothing was retrieved.',
    attempt: null,
    events: [],
  }));
  const evidenceProbes = deps.evidenceProbes ?? [];

  const append = (rec: MissionRecord, e: BridgeEventInput): void => {
    rec.events.push({
      sequence: rec.events.length,
      at: now(),
      role: e.role,
      category: e.category,
      truth: e.truth,
      headline: safeText(e.headline),
      detail: e.detail === undefined ? undefined : safeText(e.detail),
      meta: e.meta === undefined ? undefined : safeText(e.meta),
      done: e.done,
      findingId: e.findingId,
      repairId: e.repairId,
      // Every event carries the mission revision it belongs to, plus safe
      // references to the execution / attestation / artifact it describes.
      missionRevision: rec.missionRevision,
      executionRef: e.executionRef === undefined ? undefined : safeText(e.executionRef),
      attestationRef: e.attestationRef === undefined ? undefined : safeText(e.attestationRef),
      artifactRef: e.artifactRef === undefined ? undefined : safeText(e.artifactRef),
    });
  };

  /** Persist a phase transition. Called BEFORE the next role begins — the
      record, not an in-memory promise, is what advances the mission. */
  const setPhase = (rec: MissionRecord, phase: MissionPhase, role?: MissionRole): void => {
    rec.phase = phase;
    rec.state = PHASE_STATE[phase];
    rec.currentRole = role ?? PHASE_ROLE[phase] ?? 'relay';
  };

  const toAttestationSummaries = (rec: MissionRecord): MissionAttestationSummary[] =>
    (['prompt_architect', 'coding_agent', 'reviewer'] as const)
      .map((role) => rec.attestations[role])
      .filter((a): a is ExecutionAttestation => Boolean(a))
      .map((a) => ({
        role: a.role,
        attestationId: a.attestationId,
        missionRevision: a.missionRevision,
        requestedActor: a.requestedActor,
        actualActor: a.actualActor,
        actualRuntime: a.actualRuntime,
        provider: a.provider,
        requestedModel: a.requestedModel,
        actualModel: a.actualModel,
        billingPath: a.billingPath,
        launchVerified: a.launchVerified,
        completionVerified: a.completionVerified,
        fallbackOccurred: a.fallbackOccurred,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        terminalReason: a.terminalReason,
      }));

  const toView = (rec: MissionRecord): LiveMissionUpdate => ({
    state: rec.state,
    phase: rec.phase,
    missionRevision: rec.missionRevision,
    currentRole: rec.currentRole,
    currentStep: rec.events.length,
    completedAt: rec.completedAt,
    events: rec.events.map((e) => ({ ...e })),
    handoff: rec.handoff,
    claim: rec.claim,
    error: rec.error,
    terminal: rec.terminal,
    artifactDigest: rec.artifactDigest,
    handoffDigest: rec.handoffDigest,
    architectReceipt: rec.architectReceipt,
    /**
     * ABSENT AND EMPTY ARE DIFFERENT FACTS. Absent: the Mission was authorised
     * to read nothing. Empty: it was authorised and retrieved none.
     */
    ...(rec.evidenceReferences.length === 0 ? {} : { evidence: [...rec.evidenceRecords] }),
    review: rec.review,
    attestations: toAttestationSummaries(rec),
  });

  /** Terminal failure. `phase` is the exact supported failure state; the code
      is the same string so the browser and the report agree. */
  /**
   * A TERMINAL FAILURE MUST NOT LEAK THE RETAINED WORKTREE. Retention happens
   * on deterministic verification, which is BEFORE the independent reviewer; a
   * rejection then ends the mission at `fail()`. Without this, that ordinary
   * outcome left a worktree, its admin entry, and a branch inside the founder's
   * repository every time. A completed SHIP disposes its own worktree; every
   * other terminal state disposes here.
   */
  const disposeIfRetained = (rec: MissionRecord): void => {
    const worktreePath = rec.codingOutcome?.retainedWorktreePath ?? null;
    if (worktreePath === null || rec.repositoryTarget === null) return;
    disposeRetainedWorktree({
      worktreePath,
      sourceRepositoryPath: rec.repositoryTarget.location.kind === 'local_path'
        ? rec.repositoryTarget.location.path
        : worktreePath,
      workingBranch: rec.repositoryTarget.workingBranch,
    });
    if (rec.codingOutcome !== undefined) {
      rec.codingOutcome = { ...rec.codingOutcome, retainedWorktreePath: null };
    }
  };

  const fail = (
    rec: MissionRecord,
    requestedPhase: MissionPhase,
    message: string,
    opts: { retryable?: boolean; code?: string } = {},
  ): void => {
    // A stop is only ever recorded as one of the supported terminal failures.
    const phase: MissionPhase = TERMINAL_FAILURE.has(requestedPhase) ? requestedPhase : 'verification_failed';
    rec.error = {
      code: opts.code ?? phase,
      safeMessage: safeError(message),
      retryable: opts.retryable ?? rec.retryCount < MAX_RETRIES,
    };
    append(rec, {
      role: 'relay',
      category: 'relay',
      truth: 'system_notice',
      headline: 'Mission stopped safely — no completion is claimed.',
      detail: rec.error.safeMessage,
      meta: `STATE ${phase}`,
      done: true,
    });
    disposeIfRetained(rec);
    setPhase(rec, phase, 'relay');
    rec.completedAt = now();
  };

  const cancelled = (rec: MissionRecord): void => {
    rec.error = undefined;
    append(rec, {
      role: 'relay',
      category: 'relay',
      truth: 'system_notice',
      headline: 'Mission cancelled by the operator.',
      detail: 'The run was stopped. Completed roles and their evidence are preserved. No completion is claimed.',
      done: true,
    });
    disposeIfRetained(rec);
    setPhase(rec, 'cancelled', 'relay');
    rec.completedAt = now();
  };

  /* ------------------------------------------------------- the pipeline */

  async function runPipeline(rec: MissionRecord): Promise<void> {
    rec.running = true;
    rec.cancelRequested = false;
    rec.cancelHandle = null;
    const ids = createRandomIdFactory();
    const architectEnv = config.architectEnv ?? process.env;
    const hermesEnv = config.hermesEnv ?? config.architectEnv ?? process.env;

    try {
      /* ---------------- COMPLETE PREFLIGHT (before anything is consumed) */
      setPhase(rec, 'preflight_checking', 'relay');
      append(rec, {
        role: 'relay',
        category: 'relay',
        truth: 'system_notice',
        headline: 'Preflight started — verifying the whole three-role team.',
        detail: 'No provider request or agent process is dispatched until every role is available.',
      });

      const path = selectArchitectPath(architectEnv);
      const architectConfig = loadArchitectConfig(architectEnv);
      const architectReady = architectPreflight(architectConfig);

      if (path === 'blocked') {
        fail(rec, 'preflight_blocked', architectReady.reason as string, {
          code: 'architect_not_configured',
          retryable: false,
        });
        return;
      }

      const live = path === 'live';
      let hermesReady: HermesPreflightResult | null = null;
      const hermesConfig = loadHermesConfig(hermesEnv);
      /**
       * WHICH REVIEWER THIS DEPLOYMENT HAS.
       *
       * Resolved once, and both the preflight and the call read it — so there
       * is no arrangement in which Relay probes for one reviewer and invokes
       * another. That was the hosted Coding Agent's defect: it probed for the
       * local CLI on a container that would never have one.
       */
      const reviewerTransport = resolveTransport(hermesEnv);

      if (live && !architectReady.ready) {
        fail(rec, 'preflight_blocked', architectReady.reason as string, {
          code: 'architect_not_configured',
          retryable: false,
        });
        return;
      }

      /**
       * WHO HOLDS EACH ROLE — bound before anything is resolved, probed or
       * spent.
       *
       * Binding proves the requested combination is coherent: registered
       * occupants, in the right slots, able to run on THIS host, configured,
       * and with a Reviewer that is independent of the implementer. It proves
       * nothing about readiness, which the probes below still decide. Refusing
       * here costs nothing; refusing after the architect call costs a paid
       * request for a mission that could never have finished.
       *
       * DELIBERATELY AFTER THE ARCHITECT'S OWN CHECK, AND ONLY THAT ONE. The
       * architect names its missing variables precisely
       * (`architect_not_configured`); binding would answer the same situation
       * with the blunter `role_binding_refused` and an operator would lose the
       * better message. Every other role has no earlier check to defer to, so
       * binding is the first thing that speaks for them — which is the point,
       * since the Coding Agent runtime probe below is what a hosted deployment
       * must never reach with an occupant that could not run there anyway.
       */
      const roles = resolveRoleSlots({
        architectMode: architectEnv.RELAY_PROMPT_ARCHITECT_MODE,
        /**
         * NAMED, OR IMPLIED BY A TRANSPORT THE OPERATOR EXPLICITLY CONFIGURED.
         *
         * An operator who sets `RELAY_OPENAI_REVIEWER_MODE=live` and names no
         * occupant has said which Reviewer they want exactly once. Relay used
         * to answer that by applying its own development default and then
         * attesting `hermes_local` while OpenAI reviewed. Following the one
         * statement they made is both more honest and less hostile than
         * refusing over a disagreement with a default Relay invented.
         *
         * `explicitlySelectedReviewerOccupant` returns nothing for the local
         * transport on purpose: local is what configuring nothing produces, so
         * it is not a statement, and treating it as one would bind an
         * installed Hermes on a container that has none.
         */
        reviewerOccupant: (hermesEnv[REVIEWER_ROLE_ENV] ?? architectEnv[REVIEWER_ROLE_ENV] ?? '').trim() !== ''
          ? (hermesEnv[REVIEWER_ROLE_ENV] ?? architectEnv[REVIEWER_ROLE_ENV])
          : (explicitlySelectedReviewerOccupant(reviewerTransport) ?? undefined),
        codingAgentOccupant: hermesEnv[CODING_AGENT_ROLE_ENV] ?? architectEnv[CODING_AGENT_ROLE_ENV],
        // The mode the bridge already resolved, not a second reading of the
        // variable behind it.
        fakeCodingRuntime: config.claudeMode === 'fake',
        // The mission's own decision, the same `live` that drives
        // `requiresIndependentReview`, the Hermes probe and the review leg —
        // passed rather than re-derived, so the three cannot disagree.
        requiresReview: live,
        /**
         * ONE-WAY, LIKE THE FUNCTION ITSELF.
         *
         * `isProductionDeployment` is documented as a signal that can only
         * turn production ON, because "a host that can be talked out of being
         * a production host is not one". Asking only the INJECTED environment
         * reintroduced exactly that: a caller handing this registry a curated
         * `architectEnv` would make a real server evaluate as a founder
         * machine, switch development defaults on, and bind an installed CLI
         * inside a container. Not reachable today — `server.ts` passes
         * `process.env` — which makes it a latent fail-OPEN, and the only kind
         * worth closing before it is reachable.
         */
        hosted: isProductionDeployment(process.env)
          || isProductionDeployment(architectEnv)
          || isProductionDeployment(hermesEnv),
        // Both environments count: a deployment sets one process environment,
        // and only the tests hand these two apart.
        configuredNames: new Set([
          ...configuredNames(architectEnv), ...configuredNames(hermesEnv),
        ]),
      });
      if (!roles.binding.ok) {
        fail(rec, 'preflight_blocked', describeBinding(roles), {
          code: 'role_binding_refused',
          retryable: false,
        });
        return;
      }
      const boundRoles = roles.binding.bindings;
      /**
       * The two roles every mission dispatches. The Reviewer may legitimately
       * be unstaffed — the development path never calls it — so it is read
       * defensively below rather than asserted here.
       */
      const boundArchitect = boundRoles.prompt_architect;
      const boundCoding = boundRoles.coding_agent;
      if (boundArchitect === undefined || boundCoding === undefined) {
        fail(rec, 'preflight_blocked',
          'Relay could not staff the Prompt Architect and Coding Agent roles for this mission.', {
            code: 'role_binding_refused',
            retryable: false,
          });
        return;
      }

      /**
       * AND CAN THIS BRIDGE ACTUALLY DRIVE THEM?
       *
       * Binding proves the request is coherent. It cannot prove this pipeline
       * has an execution path, because that is not a property of the occupant.
       * Without this check the mission bound `claude_agent_sdk_hosted`,
       * announced it in the preflight, and then ran the Claude Code CLI, which
       * attested itself — the mission narrating one occupant while another did
       * the work. Refusing is the only honest answer until the surface is
       * wired.
       */
      // Bounded to the roles this mission will actually dispatch. A reviewer
      // the development path never calls must not block it for being
      // undrivable.
      const dispatchedRoles: RoleSlot[] = live
        ? ['prompt_architect', 'coding_agent', 'reviewer']
        : ['prompt_architect', 'coding_agent'];
      const undispatchable = missionDispatchProblems(boundRoles, dispatchedRoles);
      if (undispatchable.length > 0) {
        fail(rec, 'preflight_blocked', undispatchable.map((p) => p.safeMessage).join(' '), {
          code: 'occupant_not_dispatchable',
          retryable: false,
        });
        return;
      }

      /**
       * AND DO THE TWO REVIEWER DECISIONS NAME THE SAME THING?
       *
       * Relay decides the Reviewer twice: `reviewerTransport` above decides
       * who reviews, and the role slot decides who is BOUND — and the binding
       * is what gets attested. Nothing reconciled them, which was harmless
       * while both were Hermes and became reachable the moment a third
       * transport arrived.
       *
       * The configuration that broke it is the one the founder handoff
       * recommends: `RELAY_OPENAI_REVIEWER_MODE=live` with `RELAY_ROLE_REVIEWER`
       * unset resolves the provider transport on a founder machine while
       * binding the development default, so OpenAI performs the review and
       * `hermes_local` is attested. That is the mission narrating one occupant
       * while another does the work — the defect the dispatch check above
       * exists to prevent, arriving from a direction it was not watching.
       *
       * Refused rather than resolved, and only when a Reviewer is actually
       * dispatched: picking a winner would BE the substitution.
       */
      if (dispatchedRoles.includes('reviewer')) {
        const conflict = reviewerSlotConflict({
          transport: reviewerTransport,
          boundOccupantId: boundRoles.reviewer?.occupant.occupantId ?? null,
        });
        if (conflict !== null) {
          fail(rec, 'preflight_blocked', conflict.safeMessage, {
            code: 'role_binding_refused',
            retryable: false,
          });
          return;
        }
      }

      /**
       * CODING RUNTIME — resolved (never invoked) before any spend, AND ONLY
       * FOR THE SURFACE THE BOUND OCCUPANT ACTUALLY USES.
       *
       * This probe asks whether an installed `claude` CLI exists on this
       * machine. It ran unconditionally, so binding the hosted Agent SDK
       * occupant — whose whole purpose is to need no CLI — still died on a
       * container with "Install Claude Code: Claude Code is not installed on
       * this machine." That is the wrong-machine instruction the role-slot
       * registry documents itself as removing, surviving one layer below the
       * registry that removed it.
       *
       * The hosted surface has its OWN readiness probe, which is free, offline
       * and asks the right question: is the SDK package resolvable, is its
       * platform runtime present, is a credential variable set.
       */
      const hostedCoding = boundCoding.occupant.occupantId === HOSTED_CODING_OCCUPANT;
      let runtime: ReturnType<typeof resolveRuntime> | null = null;
      if (hostedCoding) {
        const hostedReady = probeHostedReadiness({
          env: { ...architectEnv, ...hermesEnv },
          now: now(),
        });
        if (hostedReady.blockedReason !== null) {
          fail(rec, 'preflight_blocked', `Coding Agent unavailable — ${hostedReady.blockedReason}`, {
            code: 'coding_agent_not_ready',
            retryable: false,
          });
          return;
        }
      } else {
        runtime = resolveRuntime(config.claudeMode, now, config.confirmLive);
        if (!runtime.ok) {
          fail(rec, 'preflight_blocked', `Coding Agent unavailable — ${runtime.safeMessage}`, {
            code: 'coding_agent_not_ready',
            retryable: false,
          });
          return;
        }
      }
      /** What the runtime probe OBSERVED, for the preflight line. The hosted
          surface reports its own provenance rather than borrowing the CLI's. */
      const codingProvenance = runtime === null ? 'hosted' : runtime.runtime.provenance;

      /**
       * GATHER WHAT THIS MISSION WAS AUTHORISED TO READ.
       *
       * Before the architect, because a plan made from a recollection cannot
       * be fixed by evidence arriving after it. Only the references the caller
       * named, only through `evaluateLiveReach`, and a refusal is recorded
       * rather than retried — a Mission that may not read a source proceeds
       * without it and says so, instead of failing.
       *
       * `gatherEvidence` is injected for the same reason every outward call in
       * this file is: the hosted path has to be testable without a network.
       */
      if (rec.evidenceReferences.length > 0) {
        /**
         * THE SKILL LAYER, ON THE REAL PATH.
         *
         * `relay.evidence.gather` declares who may run it and exactly which
         * capability it invokes, and this is where that declaration starts
         * mattering: an architect gathering evidence passes through the
         * narrowing before anything leaves the machine.
         *
         * It is a NARROWING and nothing more. Whether this Mission may read a
         * given source is `evaluateLiveReach`'s answer, taken inside
         * `gatherEvidence` exactly as before — this cannot make a retrieval
         * possible that the permission model refuses, and there is no branch
         * here that could. What it adds is the one thing the permission model
         * has no opinion about: whether the ROLE doing the gathering is one
         * this skill was written for.
         *
         * Evidence is gathered on the architect's behalf, before it plans.
         *
         * WHAT THIS DOES AND DOES NOT BUY, said plainly so nobody reads more
         * into it. The role here is constant — the architect is the only thing
         * that gathers evidence today — and the architect IS permitted, so on
         * this call site the narrowing cannot currently refuse on the role
         * axis. What it does buy is that the catalogue stopped being a
         * document: removing `architect` from `permittedRoles`, renaming the
         * capability, or bumping the version now stops evidence gathering on
         * the real path and says why, instead of leaving a declaration nothing
         * consults. A second caller with a different role is where the axis
         * starts biting, and it will arrive at a gate that already exists.
         */
        const evidenceSkill = evaluateInternalSkillCall({
          skill: findSkill(RELAY_SKILLS, 'relay.evidence.gather', 1),
          capabilityName: 'relay.live_reach.retrieve',
          role: 'architect',
          // Gathering evidence changes nothing outside Relay, so a read-only
          // Mission runs it — `skillChangesSomething` is what decides that,
          // and it says no for this skill.
          missionAuthorisesChange: false,
          // The governing judgement runs per reference inside `gatherEvidence`,
          // which is the only thing that can answer "may this Mission read
          // THIS source". Nothing is asserted about it here.
          governing: { allowed: true, detail: 'decided per reference by the Live Reach permission model' },
        });

        if (!evidenceSkill.ok) {
          // A skill refusal is recorded and the Mission proceeds without the
          // evidence — the same shape a Live Reach refusal already takes. A
          // Mission that cannot gather is not a Mission that failed.
          append(rec, {
            role: 'relay',
            category: 'research',
            truth: 'system_notice',
            headline: 'Evidence gathering was not run.',
            detail: `relay.evidence.gather — ${evidenceSkill.refusal}: ${evidenceSkill.detail}`,
          });
        }

        for (const request of evidenceSkill.ok ? rec.evidenceReferences : []) {
          const gathered = await gatherEvidence({
            missionId: rec.missionId,
            projectId: rec.missionId,
            source: request.source,
            capability: 'read_item',
            reference: request.reference,
            missionAuthorises: true,
            probes: evidenceProbes,
          });
          if (gathered.ok) {
            rec.liveEvidence.push(renderEvidenceForPrompt(gathered.artifact));
            /**
             * The durable reference, for the Project Brain.
             *
             * References, never content: the Brain records THAT something was
             * observed and never absorbs what it claimed, and a browser
             * showing retrieved text would be opening untrusted content in a
             * surface built to display honesty.
             */
            const ref = evidenceReferenceOf(gathered.artifact);
            rec.evidenceRecords.push({
              evidenceId: ref.evidenceId,
              source: ref.source,
              reference: ref.reference,
              publishedAt: ref.publishedAt,
              retrievedAt: ref.retrievedAt,
              contentFingerprint: ref.contentFingerprint,
              actualBackendId: gathered.attempt.actualBackendId,
              fallbackOccurred: gathered.attempt.fallbackOccurred,
            });
            /**
             * `research`, and truth `relay_evidence` — Relay made this request
             * itself and saw the answer, so it is Relay's evidence rather than
             * an agent's claim. The distinction is the point of the field.
             */
            append(rec, {
              role: 'relay',
              category: 'research',
              truth: 'relay_evidence',
              headline: `Retrieved ${request.reference}`,
              detail: `Source ${request.source}. Recorded as evidence and handed to the Prompt Architect as data.`,
            });
          } else {
            // Recorded, not retried, and never invented. The mission continues
            // with less rather than pretending it read something.
            // A system notice, not evidence: nothing was observed.
            append(rec, {
              role: 'relay',
              category: 'research',
              truth: 'system_notice',
              headline: `Did not retrieve ${request.reference}`,
              detail: `${gathered.refusal}. The mission continues without it rather than pretending it read something.`,
            });
          }
        }
      }

      // Reviewer — proven available from local read-only probes only. This is
      // deliberately BEFORE the OpenAI request: an unavailable reviewer must
      // never be discovered after a paid call has already been consumed.
      if (live) {
        hermesReady = await runReviewerPreflight({
          transport: reviewerTransport,
          localConfig: hermesConfig,
          localPreflight: checkHermes,
          ...(deps.remoteReviewerFetch === undefined
            ? {}
            : { deps: { fetchImpl: deps.remoteReviewerFetch } }),
        });
        if (!hermesReady.ready) {
          fail(rec, 'preflight_blocked', hermesReady.reason as string, {
            code: 'reviewer_not_available',
            retryable: false,
          });
          return;
        }
      }

      const relayReady = checkRelay();
      if (!relayReady.ready) {
        fail(rec, 'preflight_blocked', `Relay is not ready. Missing: ${relayReady.missing.join(', ')}.`, {
          code: 'relay_not_ready',
          retryable: false,
        });
        return;
      }

      append(rec, {
        role: 'relay',
        category: 'relay',
        truth: 'relay_evidence',
        headline: 'Preflight passed — Prompt Architect, Coding Agent, and Reviewer are all available.',
        /**
         * WHO HOLDS EACH ROLE, FROM THE BINDING ITSELF.
         *
         * `describeBinding` composes this from `renderBindingLine`, so the
         * occupant names a founder reads here are the ones the binding
         * produced. The previous version built its own sentence from the same
         * fields, which made `renderBindingLine` dead code carrying a claim
         * that three surfaces shared it.
         */
        detail: live
          ? `${describeBinding(roles)} · Architect model ` +
            `${safeText(architectConfig.model ?? 'configured')} · Reviewer ` +
            `${safeText(hermesReady?.provider ?? 'configured provider')}/` +
            `${safeText(hermesReady?.model ?? 'configured model')}, read-only.`
          : 'Development path: Sunday Alcatraz (Fusion) architect · no live Prompt Architect or Reviewer call.',
        /**
         * The slot assignment, separate from readiness: what was REQUESTED for
         * each role. What actually answers is attested per role.
         *
         * The Coding Agent entry carries its runtime PROVENANCE because the
         * occupant id is what was REQUESTED and the provenance is what was
         * OBSERVED, and only the second can contradict the first.
         */
        meta: `ROLES ${boundArchitect.requestedOccupantId} · `
          + `${boundCoding.requestedOccupantId}(${codingProvenance}) · `
          + `${boundRoles.reviewer?.requestedOccupantId ?? 'unstaffed'}`,
      });

      if (rec.cancelRequested) return cancelled(rec);

      append(rec, {
        role: 'relay',
        category: 'relay',
        truth: 'system_notice',
        headline: 'Mission Contract locked.',
        detail: 'Scope, roles, permissions, and completion policy set for this mission revision.',
        meta: `REVISION ${rec.missionRevision}`,
      });

      /* ------------------------------------- STEP 1 — PROMPT ARCHITECT */
      const archKey = architectKey(rec.missionId, rec.missionRevision);
      const archStatus = rec.ledger.get(archKey);
      if (archStatus === 'in_flight') {
        fail(rec, 'dispatch_status_uncertain', 'A Prompt Architect dispatch was started but its outcome is unknown.', {
          retryable: false,
        });
        return;
      }

      if (archStatus !== 'complete') {
        setPhase(rec, 'prompt_architect_queued');
        append(rec, {
          role: 'prompt_architect',
          category: 'prompt_architect',
          truth: 'system_notice',
          headline: live
            ? 'Prompt Architect dispatch prepared — ChatGPT (OpenAI).'
            : 'Prompt Architect dispatch prepared — Sunday Alcatraz (Fusion engine).',
          detail: live
            ? `${ARCHITECT_COORDINATION_LABEL}. One request, no retries, no fallback handoff.`
            : 'Development path — this is not the live ChatGPT Prompt Architect.',
          meta: `IDEMPOTENCY ${archKey}`,
        });

        rec.ledger.set(archKey, 'in_flight');
        setPhase(rec, 'prompt_architect_working');

        if (live) {
          const startedAt = now();
          append(rec, {
            role: 'prompt_architect',
            category: 'prompt_architect',
            truth: 'system_notice',
            headline: 'OpenAI request started.',
            detail: `Model ${safeText(architectConfig.model ?? '')} · bounded output · one call for this mission revision.`,
          });

          let architectResult: { handoff: PromptArchitectHandoff; receipt: ArchitectReceipt };
          try {
            architectResult = await callArchitect({
              originalRequest: rec.originalRequest,
              /**
               * WHAT RELAY OBSERVED, handed over as fenced data.
               *
               * Gathered above, before the architect was called, so a plan is
               * made with current information rather than a recollection. Each
               * block states that it is an observation BEFORE its contents
               * appear. Empty when the Mission authorised nothing, which is
               * the default.
               */
              ...(rec.liveEvidence.length === 0 ? {} : { liveEvidence: rec.liveEvidence }),
              missionId: rec.missionId,
              missionRevision: rec.missionRevision,
              objective: rec.objective,
              requirements: FIXED_REQUIREMENTS,
              constraints: FIXED_CONSTRAINTS,
              outOfScope: OUT_OF_SCOPE,
              acceptanceCriteria: FIXED_ACCEPTANCE,
              allowedFiles: [CLAIMED_FILE],
              prohibitedFiles: PROHIBITED_FILES,
              requiredTests: [VERIFICATION_COMMAND],
              evidenceRequirements: EVIDENCE_REQUIREMENTS,
              maxRoleCalls: MAX_ROLE_CALLS,
              noRepairRule: NO_REPAIR_RULE,
              verificationCommand: VERIFICATION_COMMAND,
              projectDescription: PROJECT_DESCRIPTION,
              config: architectConfig,
              now,
            });
          } catch (err) {
            rec.ledger.set(archKey, 'failed');
            const blocked = err instanceof PromptArchitectBlockedError ? err : null;
            const malformed = blocked?.code === 'architect_malformed';
            // The role is attested as attempted-and-failed. It never earns
            // credit, and no fixture handoff is substituted for it.
            rec.attestations.prompt_architect = buildAttestation({
              missionId: rec.missionId,
              missionRevision: rec.missionRevision,
              role: 'prompt_architect',
              requestedActor: 'ChatGPT',
              actualActor: 'ChatGPT',
              requestedRuntime: 'openai-chat-completions',
              actualRuntime: 'openai-chat-completions',
              provider: 'openai',
              // The call FAILED, so nothing was served. Only the requested
              // axis can be filled here, and `actualModel` stays absent
              // rather than being borrowed from configuration.
              requestedModel: architectConfig.model,
              billingPath: 'api_billed',
              launchVerified: blocked ? blocked.code !== 'architect_unreachable' : false,
              completionVerified: false,
              fallbackOccurred: false,
              inputDigest: digest(rec.originalRequest),
              startedAt,
              completedAt: now(),
              terminalReason: blocked?.code ?? 'architect_failed',
            });
            fail(
              rec,
              malformed ? 'prompt_architect_output_invalid' : 'prompt_architect_failed',
              blocked?.message ?? 'The Prompt Architect could not produce a handoff.',
              { code: blocked?.code, retryable: blocked?.retryable ?? false },
            );
            return;
          }

          append(rec, {
            role: 'prompt_architect',
            category: 'prompt_architect',
            truth: 'system_notice',
            headline: 'OpenAI response received.',
            detail:
              `${architectResult.receipt.totalTokens ?? 'unknown'} total tokens · ` +
              `request ${architectResult.receipt.requestIdRedacted ?? '(no id)'} · api-billed.`,
            executionRef: architectResult.receipt.requestIdRedacted ?? undefined,
          });
          append(rec, {
            role: 'prompt_architect',
            category: 'prompt_architect',
            truth: 'system_notice',
            headline: 'Handoff validated — structure accepted by the strict validator.',
            detail: `${architectResult.handoff.implementationInstructions.length} implementation step(s) · ${architectResult.handoff.acceptanceCriteria.length} acceptance criterion(s).`,
          });

          // ---- persist the validated handoff + receipt + attestation
          rec.architectHandoff = architectResult.handoff;
          rec.handoff = {
            objective: architectResult.handoff.objective,
            instructions: architectResult.handoff.implementationInstructions,
            constraints: FIXED_CONSTRAINTS,
            acceptanceCriteria: FIXED_ACCEPTANCE,
            /**
             * THE MODEL THAT ANSWERED NAMES THE ARCHITECT, not the one asked
             * for. This label reaches the founder's Live Terminal as the
             * architect's runtime line, and it read `receipt.model` — the
             * DEPRECATED spelling, which carries the REQUESTED model. So a
             * request for `gpt-4o` served by `gpt-4o-2024-11-20` was displayed
             * as `gpt-4o`: the same laundering as defect 3, one role over.
             *
             * When the provider named no model the requested one is still
             * shown, because a blank is less useful than a labelled
             * configuration — but it is labelled, so nobody reads it as
             * evidence.
             */
            architectLabel: architectResult.receipt.actualModel !== null
              ? `ChatGPT · ${safeText(architectResult.receipt.actualModel)}`
              : `ChatGPT · ${safeText(architectResult.receipt.requestedModel)} (requested; the provider named no model)`,
            architectProvenance: 'live',
          };
          rec.handoffDigest = codingHandoffDigest({
            objective: rec.handoff.objective,
            instructions: rec.handoff.instructions,
            acceptanceCriteria: rec.handoff.acceptanceCriteria,
            constraints: rec.handoff.constraints,
          });
          rec.architectReceipt = {
            provider: architectResult.receipt.provider,
            // Two facts, two fields, on the wire as well as in the
            // attestation. `servedModel` is null when the provider named
            // none and is never defaulted from `requestedModel`.
            requestedModel: safeText(architectResult.receipt.requestedModel),
            servedModel: architectResult.receipt.actualModel === null
              ? null
              : safeText(architectResult.receipt.actualModel),
            coordinationLabel: architectResult.receipt.coordinationLabel,
            networkPath: architectResult.receipt.networkPath,
            billingPath: architectResult.receipt.billingPath,
            requestIdRedacted: architectResult.receipt.requestIdRedacted,
            startedAt: architectResult.receipt.startedAt,
            completedAt: architectResult.receipt.completedAt,
            inputTokens: architectResult.receipt.inputTokens,
            outputTokens: architectResult.receipt.outputTokens,
            totalTokens: architectResult.receipt.totalTokens,
            inputDigest: architectResult.receipt.inputDigest,
            outputDigest: architectResult.receipt.outputDigest,
          };
          /**
           * THE ARCHITECT'S MODEL IDENTITY, CLASSIFIED ONCE AND ACTED ON HERE.
           *
           * Computed before the attestation because the mission has to be able
           * to STOP here. The previous version only fed the classification into
           * `fallbackOccurred` and carried on — and `fallbackOccurred: true`
           * reaches `attestsRealExecution` → `decideCompletion`, so a
           * substituted architect model killed the mission at the very END,
           * after the Coding Agent and the Reviewer had both run and been paid,
           * with the message "The Prompt Architect did not produce an attested
           * execution" and no event anywhere naming a model. An independent
           * review found that by running it.
           *
           * A refusal belongs where the fact is discovered. The reviewer leg
           * does exactly this — see `reviewerModelSubstituted` — and now both
           * legs fail fast with both model names in the record.
           */
          const architectIdentity = classifyModelIdentity({
            requested: architectResult.receipt.requestedModel,
            served: architectResult.receipt.actualModel,
          });
          rec.attestations.prompt_architect = buildAttestation({
            missionId: rec.missionId,
            missionRevision: rec.missionRevision,
            role: 'prompt_architect',
            requestedActor: 'ChatGPT',
            actualActor: 'ChatGPT',
            requestedRuntime: 'openai-chat-completions',
            actualRuntime: 'openai-chat-completions',
            provider: 'openai',
            // The receipt already keeps these as separate facts; the
            // attestation now can too, instead of flattening them into one
            // `model` field that silently meant "requested".
            requestedModel: architectResult.receipt.requestedModel,
            actualModel: architectResult.receipt.actualModel ?? undefined,
            billingPath: 'api_billed',
            launchVerified: true,
            completionVerified: true,
            /**
             * THE SAME RULE THE REVIEWER USES, so two roles cannot rule
             * opposite ways on one fact.
             *
             * This was the literal `false`, and the reviewer leg 400 lines down
             * was calling the identical `gpt-test` → `gpt-test-2026-01-01`
             * relationship a substitution. One file, one fact, two answers.
             * Now both ask `classifyModelIdentity`: a version resolution is not
             * a fallback for either role, and a genuine substitution is one for
             * both — and the mission stops immediately below rather than at the
             * end.
             */
            fallbackOccurred: architectIdentity.substituted,
            externalExecutionIdRedacted: architectResult.receipt.requestIdRedacted ?? undefined,
            inputDigest: architectResult.receipt.inputDigest,
            outputDigest: architectResult.receipt.outputDigest,
            startedAt: architectResult.receipt.startedAt,
            completedAt: architectResult.receipt.completedAt,
          });
          /**
           * REFUSED HERE, WITH BOTH NAMES, BEFORE THE CODING AGENT COSTS
           * ANYTHING.
           *
           * The event is appended first so the record explains the failure even
           * though `fail` is what ends the mission: the previous version's
           * refusal was invisible, and a founder reading four successful
           * architect events followed by a terminal `verification_failed` could
           * not learn why.
           */
          if (architectIdentity.substituted) {
            append(rec, {
              role: 'prompt_architect',
              category: 'prompt_architect',
              truth: 'system_notice',
              headline: 'Prompt Architect refused — the provider substituted the model.',
              detail: `${architectIdentity.reason} Relay does not accept a handoff from a substituted model.`,
            });
            rec.ledger.set(archKey, 'failed');
            fail(
              rec,
              /**
               * `prompt_architect_failed`, not a new phase member. The architect
               * leg did not produce an acceptable handoff, which is exactly what
               * that phase means, and a new member would have to be added to
               * every exhaustive switch over `MissionPhase` and to the
               * surface-parity contract. WHICH failure it was travels in the
               * message, with both model names in it.
               */
              'prompt_architect_failed',
              `${architectIdentity.reason} Relay does not accept a handoff from a substituted model.`,
              { retryable: false },
            );
            return;
          }
          rec.ledger.set(archKey, 'complete');

          append(rec, {
            role: 'relay',
            category: 'relay',
            truth: 'relay_evidence',
            headline: 'Handoff persisted with the Prompt Architect execution attestation.',
            detail: `${ARCHITECT_COORDINATION_LABEL}.`,
            meta: `HANDOFF ${rec.handoffDigest}`,
            attestationRef: rec.attestations.prompt_architect.attestationId,
          });
        } else {
          // ---- Preserved development path: Sunday Alcatraz (Fusion engine).
          // It never claims to be ChatGPT and never earns the live attestation.
          const startedAt = now();
          if (config.fusionBaseUrl === null) {
            /**
             * REFUSED AT THE CONFIGURATION, not at the request.
             *
             * The development architect is a loopback service. On a container
             * there is nothing at loopback, so selecting it there was always
             * going to fail — and failing at the HTTP call would have reported
             * an unreachable endpoint rather than the fact that this
             * deployment has no development architect at all.
             */
            fail(rec, 'preflight_blocked', 'This deployment has no development architect: FUSION_BASE_URL is unset and a hosted bridge has no loopback service to fall back to.', {
              code: 'architect_not_configured',
              retryable: false,
            });
            return;
          }
          const fusion = await callFusionArchitect({
            objective: rec.objective,
            fusionBaseUrl: config.fusionBaseUrl,
            fixedConstraints: FIXED_CONSTRAINTS,
            fixedAcceptance: FIXED_ACCEPTANCE,
            sundayMode: config.sundayMode,
          });
          rec.handoff = {
            objective: fusion.objective,
            instructions: fusion.instructions,
            constraints: fusion.constraints,
            acceptanceCriteria: fusion.acceptanceCriteria,
            architectLabel: fusion.architectLabel,
            architectProvenance: fusion.architectProvenance,
          };
          rec.handoffDigest = codingHandoffDigest({
            objective: rec.handoff.objective,
            instructions: rec.handoff.instructions,
            acceptanceCriteria: rec.handoff.acceptanceCriteria,
            constraints: rec.handoff.constraints,
          });
          rec.attestations.prompt_architect = buildAttestation({
            missionId: rec.missionId,
            missionRevision: rec.missionRevision,
            role: 'prompt_architect',
            requestedActor: 'Sunday Alcatraz (Fusion engine)',
            actualActor: 'Sunday Alcatraz (Fusion engine)',
            requestedRuntime: 'fusion-http',
            actualRuntime: 'fusion-http',
            billingPath: fusion.architectProvenance === 'live' ? 'api_billed' : 'simulated',
            launchVerified: true,
            completionVerified: true,
            fallbackOccurred: false,
            inputDigest: digest(rec.originalRequest),
            outputDigest: digest(fusion.briefText),
            startedAt,
            completedAt: now(),
          });
          rec.ledger.set(archKey, 'complete');
          append(rec, {
            role: 'prompt_architect',
            category: 'prompt_architect',
            truth: 'system_notice',
            headline: `Handoff brief ready — ${fusion.architectLabel}.`,
            detail: fusion.briefText,
            meta: fusion.traceId ? `TRACE ${fusion.traceId}` : undefined,
            done: true,
          });
        }
      }

      setPhase(rec, 'handoff_ready', 'relay');
      if (rec.cancelRequested) return cancelled(rec);

      /* --------------------------- STEP 2 — AUTOMATIC CLAUDE HANDOFF */
      const handoff = rec.handoff as MissionHandoff;
      const codingHandoff = {
        objective: handoff.objective,
        instructions: handoff.instructions,
        acceptanceCriteria: handoff.acceptanceCriteria,
        constraints: handoff.constraints,
      };
      const persistedHandoffDigest = codingHandoffDigest(codingHandoff);
      const codeKey = codingKey(rec.missionId, persistedHandoffDigest);
      const codeStatus = rec.ledger.get(codeKey);
      if (codeStatus === 'in_flight') {
        fail(rec, 'dispatch_status_uncertain', 'A Coding Agent dispatch was started but its outcome is unknown.', {
          retryable: false,
        });
        return;
      }

      let coding: CodingOutcome;
      if (codeStatus === 'complete' && rec.codingOutcome) {
        coding = rec.codingOutcome;
        append(rec, {
          role: 'relay',
          category: 'relay',
          truth: 'relay_evidence',
          headline: 'Coding Agent result recovered — the completed role was not redispatched.',
          meta: `IDEMPOTENCY ${codeKey}`,
        });
      } else {
        setPhase(rec, 'coding_agent_assigned');
        append(rec, {
          role: 'coding_agent',
          category: 'coding_agent',
          truth: 'system_notice',
          headline: `Coding Agent assignment created — ${safeText(boundCoding.occupant.displayName)}.`,
          detail:
            'Relay compiled the persisted handoff into the task package: founder request, mission contract, ' +
            'instructions, constraints, acceptance criteria, allowed file, prohibited files, verification command, ' +
            'no network, no package installation, no repair iteration, bounded runtime, isolated fixture.',
          meta: `HANDOFF ${persistedHandoffDigest}`,
        });
        rec.ledger.set(codeKey, 'in_flight');
        setPhase(rec, 'coding_agent_starting');

        coding = await callCoding({
          handoff: codingHandoff,
          // Unused by the hosted surface: the seam replaces the spawn entirely.
          executablePath: runtime?.runtime.executablePath ?? '',
          capabilities: runtime?.runtime.capabilities ?? HOSTED_PLACEHOLDER_CAPABILITIES,
          now,
          ids,
          baseEnv: config.baseEnv,
          emit: (e) => append(rec, e),
          publishTerminal: (t) => {
            rec.terminal = t;
          },
          /**
           * THE LABEL FOLLOWS THE SOURCE. Calling a founder's repository "the
           * controlled fixture (throwaway repository)" in the Live Terminal
           * would be a claim about blast radius that is false, and it is the
           * line a founder reads to know what Relay is touching.
           */
          projectLabel: rec.repositoryTarget === null
            ? 'Relay controlled fixture (throwaway repository)'
            : `${rec.repositoryTarget.repositoryKey} (isolated worktree on ${rec.repositoryTarget.workingBranch})`,
          repositoryTarget: rec.repositoryTarget ?? undefined,
          intendedWritePaths: rec.intendedWritePaths,
          missionId: rec.missionId,
          missionRevision: rec.missionRevision,
          /**
           * WHICH SURFACE RUNS THE AGENT. Absent means the installed CLI, so
           * every existing caller is unchanged. The hosted surface is chosen
           * by the BOUND OCCUPANT — never by a credential being present, which
           * is the same rule the architect follows.
           */
          invokeAgent: boundCoding.occupant.occupantId === HOSTED_CODING_OCCUPANT
            ? makeHostedInvoker({
              apiKey: hermesEnv[HOSTED_API_KEY_ENV] ?? architectEnv[HOSTED_API_KEY_ENV] ?? '',
              requestedModel: hermesEnv[HOSTED_MODEL_ENV] ?? architectEnv[HOSTED_MODEL_ENV] ?? null,
            })
            : undefined,
          runtimeLabel: boundCoding.occupant.displayName,
          // The REQUESTED identity, from the binding. What actually ran is
          // observed inside the coding leg and never copied from here.
          requestedOccupant: {
            actorName: boundCoding.occupant.actorName,
            adapterId: boundCoding.occupant.adapterId,
            // Passed through whole. The coding leg owns the translation into
            // the attestation's vocabulary, and `unknown` survives as unknown
            // rather than being converted into a claim.
            billingPath: boundCoding.occupant.billingPath,
          },
          requiresIndependentReview: live,
          onState: (s) => {
            if (s === 'claim_submitted') setPhase(rec, 'claim_submitted');
            else if (s === 'relay_verifying') setPhase(rec, 'relay_verifying', 'relay');
            else setPhase(rec, 'coding');
          },
          registerHandle: (h) => {
            rec.cancelHandle = h;
          },
          isCancelRequested: () => rec.cancelRequested,
        });
        rec.codingOutcome = coding;
        rec.ledger.set(codeKey, coding.stopped || coding.cancelled ? 'failed' : 'complete');
      }

      rec.claim = coding.claim ?? undefined;
      rec.deliveredHandoffDigest = coding.deliveredHandoffDigest ?? undefined;
      if (coding.attestation) rec.attestations.coding_agent = coding.attestation;

      if (coding.cancelled || rec.cancelRequested) return cancelled(rec);
      if (coding.stopped) {
        const timedOut = /timed out/i.test(coding.stopReason ?? '');
        fail(
          rec,
          timedOut ? 'timed_out' : 'coding_agent_failed',
          coding.stopReason ?? 'The coding agent stopped before completing.',
        );
        return;
      }

      /* ---------------------- STEP 3 — DETERMINISTIC RELAY VERIFICATION */
      /**
       * REASSIGNABLE BECAUSE A REPAIR REPLACES IT.
       *
       * A repaired implementation is a different artifact: different bytes,
       * different digest, its own Relay inspection and its own test run. When
       * the re-review accepts it, THAT is what the mission has, and the
       * completion decision must be taken against it. See the repair leg.
       */
      let evidence = coding.evidence;
      if (!evidence) {
        fail(rec, 'verification_failed', 'Relay produced no deterministic evidence for this run.');
        return;
      }
      append(rec, {
        role: 'relay',
        category: 'verification',
        truth: 'relay_evidence',
        headline: coding.deterministicPassed
          ? 'Relay verification passed — scope preserved and required tests passed.'
          : 'Relay verification did not pass.',
        detail: evidence.relayEvidence.join(' · '),
        done: true,
      });
      if (!coding.deterministicPassed) {
        // The reviewer is NOT invoked and the coding agent is NOT retried.
        // Every captured event, diff, and terminal line is preserved.
        fail(rec, 'verification_failed', 'Relay could not verify the result under the completion policy.');
        return;
      }

      rec.artifactDigest = evidence.artifactDigest;
      append(rec, {
        role: 'relay',
        category: 'relay',
        truth: 'relay_evidence',
        headline: 'Artifact digest created — the review will be bound to this exact result.',
        meta: `ARTIFACT ${evidence.artifactDigest}`,
        artifactRef: evidence.artifactDigest,
      });

      if (rec.cancelRequested) return cancelled(rec);

      /* ------------------------------- STEP 4 — HERMES PRODUCTION REVIEW */
      if (!live) {
        // Preserved development path: no reviewer, deterministic policy only.
        if (coding.verifiedComplete) {
          append(rec, {
            role: 'relay',
            category: 'completion_engine',
            truth: 'relay_evidence',
            headline: 'Development path complete — deterministic verification only.',
            detail: 'This is not the live three-role mission and no independent review was performed.',
            done: true,
          });
          setPhase(rec, 'verified_complete', 'relay');
          rec.completedAt = now();
        } else {
          fail(rec, 'verification_failed', 'Relay could not verify the result under the completion policy.');
        }
        return;
      }

      const revKey = reviewerKey(rec.missionId, evidence.artifactDigest);
      const revStatus = rec.ledger.get(revKey);
      if (revStatus === 'in_flight') {
        fail(rec, 'dispatch_status_uncertain', 'A Reviewer dispatch was started but its outcome is unknown.', {
          retryable: false,
        });
        return;
      }

      let reviewOutcome: HermesOutcome | null = null;
      if (revStatus === 'complete' && rec.review) {
        append(rec, {
          role: 'relay',
          category: 'relay',
          truth: 'relay_evidence',
          headline: 'Reviewer result recovered — the completed role was not redispatched.',
          meta: `IDEMPOTENCY ${revKey}`,
        });
      } else {
        setPhase(rec, 'reviewer_assigned');
        append(rec, {
          role: 'reviewer',
          category: 'reviewer',
          truth: 'system_notice',
          headline: 'Reviewer assignment created — Hermes (independent, read-only).',
          detail:
            'Hermes receives the founder request, the mission contract, the Prompt Architect handoff, the scope, ' +
            'the changed files, the real diff, the resulting content, the deterministic test output, and the ' +
            "artifact digest. It cannot edit, run a coding agent, or repair the implementation.",
          meta: `ARTIFACT ${evidence.artifactDigest}`,
          artifactRef: evidence.artifactDigest,
        });
        /**
         * WHAT THE REVIEW COST — the operator's declaration if they made one,
         * otherwise the registered occupant that actually ran, and never a
         * literal. Computed ONCE, before the launch line that announces it, and
         * used by that line, the attestation and the founder-facing review card
         * alike — three places that previously carried independent
         * `'subscription'` claims agreeing with each other and with nothing
         * else.
         */
        const reviewerBilling = declaredBillingPath(hermesEnv.RELAY_HERMES_BILLING_MODE)
          ?? occupantBillingPath(boundRoles.reviewer?.occupant.billingPath);

        rec.ledger.set(revKey, 'in_flight');
        setPhase(rec, 'reviewer_starting');
        append(rec, {
          role: 'reviewer',
          category: 'reviewer',
          truth: 'system_notice',
          headline: 'Hermes launched — one read-only review, no retries.',
          /**
           * `provider not reported` rather than `configured provider`: the
           * placeholder read as though Relay knew which one and was being
           * terse. On the run that exposed this, every field in this line was
           * a placeholder and the line still ended "subscription-backed".
           */
          detail: `Hermes Agent CLI · ${safeText(hermesReady?.provider ?? 'provider not reported')} · ${safeText(
            hermesReady?.model ?? 'model not reported',
          )} · ${billingPhrase(reviewerBilling)}.`,
        });
        setPhase(rec, 'reviewer_working');

        reviewOutcome = await callReviewer({
          packet: {
            missionId: rec.missionId,
            missionRevision: rec.missionRevision,
            originalRequest: rec.originalRequest,
            handoffJson: JSON.stringify(rec.architectHandoff ?? codingHandoff),
            acceptanceCriteria: handoff.acceptanceCriteria,
            allowedFiles: evidence.allowedFiles,
            prohibitedFiles: evidence.prohibitedFiles,
            baseRevision: evidence.baseRevision,
            artifactDigest: evidence.artifactDigest,
            changedFiles: evidence.changedFiles,
            unifiedDiff: evidence.unifiedDiff,
            changedFileContents: evidence.changedFileContents,
            testCommand: evidence.testCommand,
            testOutput: evidence.testOutput,
            relayEvidence: evidence.relayEvidence,
          },
          config: hermesConfig,
          now,
          /**
           * The transport decides where this runs. A remote reviewer returns
           * the SAME `HermesOutcome`, so everything below this line — the
           * attestation, the verdict, the findings — is unchanged.
           */
          transport: reviewerTransport,
          runId: `${rec.missionId}-review-${String(rec.missionRevision ?? 1)}`,
        });

        const reviewerStartedAt =
          reviewOutcome.kind === 'launch_failed' ? now() : reviewOutcome.startedAt;
        const reviewerCompletedAt =
          reviewOutcome.kind === 'launch_failed' ? now() : reviewOutcome.completedAt;
        const resolvedProvider = (reviewOutcome.kind === 'reviewed' ? reviewOutcome.provider : null) ?? hermesReady?.provider ?? null;
        /**
         * REQUESTED AND SERVED, RESOLVED ON SEPARATE AXES — NEVER ACROSS THEM.
         *
         * This used to be one `resolvedModel`: the outcome's model, else the
         * preflight's. Both sources were configuration, and the single field
         * fed both the attestation and the founder-facing review card — so
         * the requested model was attested as the one that reviewed, which is
         * defect 3 in HOSTED_MISSION_EVIDENCE.md.
         *
         * The requested axis may fall back from the outcome to the preflight:
         * both name what was ASKED FOR, and the preflight's value is the
         * remote service's own verified configuration. The served axis has no
         * fallback anywhere: it is what the provider itself said answered, or
         * it is null.
         */
        const requestedReviewerModel =
          (reviewOutcome.kind === 'reviewed' ? reviewOutcome.requestedModel : null) ?? hermesReady?.model ?? null;
        const servedReviewerModel = reviewOutcome.kind === 'reviewed' ? reviewOutcome.servedModel : null;
        /**
         * NOT EVERY DIFFERENCE IS A SUBSTITUTION, and this used to say it was.
         *
         * `requested !== served` refused `gpt-4o` answered by
         * `gpt-4o-2024-08-06` — the same model named exactly, which is what
         * every provider does and the reason these two axes exist. On the
         * reviewer configuration this repository's own docs recommend for a
         * hosted run, that failed EVERY mission at the review step with
         * `retryable: false`, after the review had been paid for, and told the
         * founder their provider had swapped the reviewer. An independent
         * review found it by running it.
         *
         * `classifyModelIdentity` is the one rule; see `model-identity.ts`.
         * Unknown stays Unknown, a version resolution is truthful on both axes
         * and is not a fallback, and only a genuinely different model is
         * refused.
         */
        const reviewerModelIdentity = classifyModelIdentity({
          requested: requestedReviewerModel,
          served: servedReviewerModel,
        });
        const reviewerModelSubstituted = reviewerModelIdentity.substituted;

        rec.attestations.reviewer = buildAttestation({
          missionId: rec.missionId,
          missionRevision: rec.missionRevision,
          role: 'reviewer',
          requestedActor: 'Hermes',
          actualActor: 'Hermes',
          requestedRuntime: 'hermes-agent-cli',
          actualRuntime: 'hermes-agent-cli',
          provider: resolvedProvider ?? undefined,
          requestedModel: requestedReviewerModel ?? undefined,
          actualModel: servedReviewerModel ?? undefined,
          /**
           * THE OCCUPANT THAT RAN DECIDES THIS, not a literal.
           *
           * Every hosted review has attested `subscription` while the bound
           * occupant — `hermes_remote_service`, and `hermes_local` beside it —
           * is registered `billingPath: 'api'`, reviewing on an xAI API key.
           * The attestation contradicted the registry entry for the very
           * occupant it names, and it did so in the direction that hides cost:
           * a founder reading it saw a review their subscription had already
           * paid for.
           *
           * `isPaidApiCall` tests `api_billed`, so every real review has also
           * been invisible to Relay's own accounting of what a mission spent.
           *
           * Derived exactly as the coding leg derives its own — same registry
           * field, same translation — because two legs deciding the same fact
           * by different means is how they came to disagree.
           */
          billingPath: reviewerBilling,
          launchVerified: reviewOutcome.kind !== 'launch_failed',
          completionVerified: reviewOutcome.kind === 'reviewed',
          /**
           * A provider that answers with a different model than the one
           * requested has substituted the reviewer — which is exactly what a
           * fallback is, performed by somebody else. `attestsRealExecution`
           * is false for such a run, and the guard below refuses the review.
           */
          fallbackOccurred: reviewerModelSubstituted,
          inputDigest: evidence.artifactDigest,
          outputDigest: reviewOutcome.kind === 'reviewed' ? digest(JSON.stringify(reviewOutcome.result)) : undefined,
          startedAt: reviewerStartedAt,
          completedAt: reviewerCompletedAt,
          terminalReason: reviewOutcome.kind === 'reviewed' ? undefined : reviewOutcome.kind,
        });

        if (reviewOutcome.kind === 'launch_failed') {
          rec.ledger.set(revKey, 'failed');
          fail(rec, 'reviewer_launch_failed', reviewOutcome.safeMessage, { retryable: false });
          return;
        }
        if (reviewOutcome.kind === 'review_incomplete') {
          rec.ledger.set(revKey, 'failed');
          fail(rec, 'review_incomplete', reviewOutcome.safeMessage, { retryable: false });
          return;
        }
        /**
         * NO FALLBACK — INCLUDING ONE THE PROVIDER PERFORMS. Relay never
         * substitutes a neighbouring model, and it does not accept a
         * substitution made on the other side of the API either. A review
         * answered by a model other than the requested one is refused, with
         * both names in the record.
         */
        if (reviewerModelSubstituted) {
          rec.ledger.set(revKey, 'failed');
          fail(
            rec,
            'review_incomplete',
            `${reviewerModelIdentity.reason} Relay does not accept a review from a substituted model.`,
            { retryable: false },
          );
          return;
        }

        append(rec, {
          role: 'reviewer',
          category: 'reviewer',
          truth: 'system_notice',
          headline: 'Hermes response received.',
          detail: reviewOutcome.result.summary,
          attestationRef: rec.attestations.reviewer.attestationId,
        });
        append(rec, {
          role: 'reviewer',
          category: 'reviewer',
          truth: 'relay_evidence',
          headline: 'Review validated — structured verdict accepted.',
          detail: `Verdict ${reviewOutcome.result.verdict} · ${reviewOutcome.result.findings.length} finding(s) · ${reviewOutcome.result.requirementsChecked.length} requirement(s) checked · `
            + `served model ${safeText(servedReviewerModel ?? 'not reported by the provider')}.`,
          artifactRef: evidence.artifactDigest,
        });

        rec.review = {
          reviewer: 'Hermes',
          runtime: 'Hermes Agent CLI (read-only)',
          provider: resolvedProvider,
          requestedModel: requestedReviewerModel,
          servedModel: servedReviewerModel,
          // The same translation the attestation uses, so the founder-facing
          // review card and the machine-read attestation cannot disagree about
          // what the review cost.
          billing: reviewerBilling,
          verdict: reviewOutcome.result.verdict,
          summary: safeText(reviewOutcome.result.summary),
          findings: reviewOutcome.result.findings.map((f) => ({
            findingId: f.findingId,
            severity: f.severity,
            requirement: f.requirement,
            explanation: f.explanation,
            evidence: f.evidence,
            file: f.file,
            line: f.line,
            recommendedAction: f.recommendedAction,
          })),
          requirementsChecked: reviewOutcome.result.requirementsChecked.map((r) => ({ ...r })),
          reviewedArtifactDigest: evidence.artifactDigest,
          startedAt: reviewOutcome.startedAt,
          completedAt: reviewOutcome.completedAt,
        };
        rec.ledger.set(revKey, 'complete');

        for (const finding of rec.review.findings) {
          append(rec, {
            role: 'reviewer',
            category: 'reviewer',
            truth: 'relay_evidence',
            headline: `Finding ${finding.findingId} (${finding.severity}) persisted.`,
            detail: finding.explanation,
            meta: finding.file ? `FILE ${finding.file}` : undefined,
            findingId: finding.findingId,
          });
        }
      }

      let review = rec.review as MissionReview;

      /* --------------------- STEP 4b — ONE BOUNDED REPAIR, IF REJECTED --- */
      /**
       * A REJECTED IMPLEMENTATION GETS EXACTLY ONE CHANCE.
       *
       * Relay used to stop here: `review_blocked` mapped straight to `failed`,
       * the repair vocabulary in `review-repair.ts` had no caller at all, and
       * a mission a Reviewer could have unblocked in one pass died with three
       * paid legs behind it.
       *
       * THE BOUND IS ONE ATTEMPT AND IT IS NOT A TUNING KNOB. The revision
       * prompt tells the agent "attempt 2 of at most 2", and an unbounded loop
       * against a Reviewer that keeps objecting is a way to spend a founder's
       * money in a circle.
       *
       * WHAT MAKES IT A REPAIR RATHER THAN A RETRY: the agent resumes from the
       * exact bytes the Reviewer read, receives only the blocking findings,
       * and may still touch only the claimed file. A SECOND review then judges
       * the result on its own artifact digest — the repair is never assumed to
       * have worked, which is the same rule that governs the first attempt.
       */
      /**
       * Filtered on the MISSION's finding type rather than through
       * `openBlockingFindings`, which types `RelayFinding` — a different shape
       * that carries fields this one does not. Reaching for the domain helper
       * would have meant a cast, and a cast here would hide exactly the kind of
       * field mismatch that makes a repair address the wrong thing.
       */
      const blocking = review.findings.filter((f) => f.severity === 'blocking');
      /**
       * Captured rather than asserted. `canRepair` already proves this is a
       * string; a non-null assertion below would have made the compiler agree
       * without the code proving anything, which is how a null reaches a file
       * write.
       */
      const reviewedContent = evidence.claimedFileContent;
      const canRepair = review.verdict !== 'approved'
        && blocking.length > 0
        && reviewedContent !== null;

      if (canRepair && reviewedContent !== null) {
        append(rec, {
          role: 'coding_agent',
          category: 'repair',
          truth: 'system_notice',
          headline: `Repair attempt started — ${String(blocking.length)} blocking finding(s).`,
          detail: 'The Coding Agent resumes from the reviewed result and may address only these '
            + 'findings, inside the same claimed file. One attempt; a second review decides.',
        });
        setPhase(rec, 'coding', 'coding_agent');

        const repair = await callCoding({
          handoff: codingHandoff,
          executablePath: runtime?.runtime.executablePath ?? '',
          capabilities: runtime?.runtime.capabilities ?? HOSTED_PLACEHOLDER_CAPABILITIES,
          now,
          ids,
          baseEnv: config.baseEnv,
          emit: (e) => append(rec, e),
          publishTerminal: (t) => { rec.terminal = t; },
          /**
           * THE LABEL FOLLOWS THE SOURCE. Calling a founder's repository "the
           * controlled fixture (throwaway repository)" in the Live Terminal
           * would be a claim about blast radius that is false, and it is the
           * line a founder reads to know what Relay is touching.
           */
          projectLabel: rec.repositoryTarget === null
            ? 'Relay controlled fixture (throwaway repository)'
            : `${rec.repositoryTarget.repositoryKey} (isolated worktree on ${rec.repositoryTarget.workingBranch})`,
          repositoryTarget: rec.repositoryTarget ?? undefined,
          intendedWritePaths: rec.intendedWritePaths,
          missionId: rec.missionId,
          missionRevision: rec.missionRevision,
          ...(hostedCoding
            ? {
              invokeAgent: makeHostedInvoker({
                apiKey: hermesEnv[HOSTED_API_KEY_ENV] ?? architectEnv[HOSTED_API_KEY_ENV] ?? '',
                requestedModel: hermesEnv[HOSTED_MODEL_ENV] ?? architectEnv[HOSTED_MODEL_ENV] ?? null,
              }),
            }
            : {}),
          revision: {
            findingSummaries: blocking.map((f) => `${f.findingId}: ${f.explanation}`),
            priorContents: { [evidence.changedFiles[0] ?? '']: reviewedContent },
          },
        });

        /**
         * A REPAIR THAT PRODUCES NOTHING MUST SAY SO.
         *
         * The first production run of this leg fired correctly — "Repair
         * attempt started — 3 blocking finding(s)" — and then emitted NOTHING
         * before the completion decision, because this check skipped in
         * silence when the second run returned no evidence. The mission was
         * refused for the right reason (the original rejection stood) and the
         * record could not say whether the repair had run and failed, been
         * stopped at a precondition, or never started.
         *
         * That is the same blindness this session fixed five times in other
         * people's code, written into new code by me. The stop reason the
         * coding leg already produces is surfaced here instead.
         */
        const repaired = repair.evidence;
        if (repaired === null || repaired === undefined) {
          append(rec, {
            role: 'coding_agent',
            category: 'repair',
            truth: 'system_notice',
            headline: 'Repair produced no verifiable result — the original review stands.',
            detail: repair.stopReason !== undefined && repair.stopReason !== ''
              ? `The repair run stopped: ${repair.stopReason}`
              : 'The repair run returned no evidence and no reason. The mission is refused on the '
                + 'first review, which is unchanged.',
          });
        }
        if (repaired !== null && repaired !== undefined) {
          append(rec, {
            role: 'relay',
            category: 'verification',
            truth: 'relay_evidence',
            headline: 'Repair verified — Relay re-ran the required tests itself.',
            detail: `Changed files (Relay-observed): ${repaired.changedFiles.join(', ') || '(none)'}`,
          });

          const secondOutcome = await callReviewer({
            packet: {
              missionId: rec.missionId,
              missionRevision: rec.missionRevision,
              originalRequest: rec.originalRequest,
              handoffJson: JSON.stringify(rec.architectHandoff ?? codingHandoff),
              acceptanceCriteria: handoff.acceptanceCriteria,
              allowedFiles: repaired.allowedFiles,
              prohibitedFiles: repaired.prohibitedFiles,
              baseRevision: repaired.baseRevision,
              artifactDigest: repaired.artifactDigest,
              changedFiles: repaired.changedFiles,
              unifiedDiff: repaired.unifiedDiff,
              changedFileContents: repaired.changedFileContents,
              testCommand: repaired.testCommand,
              testOutput: repaired.testOutput,
              relayEvidence: repaired.relayEvidence,
            },
            config: hermesConfig,
            now,
            transport: reviewerTransport,
            runId: `${rec.missionId}-review-${String(rec.missionRevision ?? 1)}-repair`,
          });

          const secondRequestedModel = secondOutcome.kind === 'reviewed'
            ? (secondOutcome.requestedModel ?? hermesReady?.model ?? null)
            : null;
          const secondServedModel = secondOutcome.kind === 'reviewed' ? secondOutcome.servedModel : null;
          /**
           * THE SAME NO-SUBSTITUTION RULE AS THE FIRST REVIEW, through the same
           * function — so a version resolution is accepted here exactly as it is
           * there, and the two legs cannot drift apart.
           */
          const secondIdentity = classifyModelIdentity({
            requested: secondRequestedModel,
            served: secondServedModel,
          });
          const secondSubstituted = secondIdentity.substituted;
          if (secondOutcome.kind === 'reviewed' && secondSubstituted) {
            append(rec, {
              role: 'reviewer',
              category: 'reviewer',
              truth: 'system_notice',
              headline: 'Re-review refused — the provider substituted the reviewer model.',
              detail: `${secondIdentity.reason} The first review stands.`,
            });
          }
          if (secondOutcome.kind === 'reviewed' && !secondSubstituted) {
            append(rec, {
              role: 'reviewer',
              category: 'reviewer',
              truth: 'relay_evidence',
              headline: `Re-review complete — verdict ${secondOutcome.result.verdict}.`,
              detail: 'The repair was judged independently, bound to its own artifact digest. '
                + `Served model ${safeText(secondServedModel ?? 'not reported by the provider')}.`,
            });
            rec.review = {
              ...review,
              verdict: secondOutcome.result.verdict,
              summary: secondOutcome.result.summary,
              findings: secondOutcome.result.findings.map((f) => ({ ...f })),
              requirementsChecked: secondOutcome.result.requirementsChecked.map((r) => ({ ...r })),
              reviewedArtifactDigest: repaired.artifactDigest,
              // The re-review's own model facts replace the first attempt's —
              // this card now describes the review that actually stands.
              requestedModel: secondRequestedModel,
              servedModel: secondServedModel,
            };
            review = rec.review;
            /**
             * AND THE ATTESTATION IS REBUILT FROM THE SAME OUTCOME.
             *
             * Overwriting only `rec.review` left the reviewer ATTESTATION
             * describing the FIRST review — so a mission whose first look
             * reported no served model and whose second reported one showed
             * `servedModel: "grok-build-0.1"` on the founder's card and
             * `actualModel: undefined` in the machine-read record, for the same
             * mission. An independent review found that by probing the real
             * registry. The comment two hundred lines up promises these two
             * cannot disagree about the review; this is what makes that true.
             */
            const secondReviewerAttestation = rec.attestations.reviewer;
            if (secondReviewerAttestation !== undefined) {
              /**
               * WHICH FIELDS COME FROM WHERE, because the previous version of
               * the comment above said "rebuilt from the same outcome" and six
               * of these are copied from the FIRST attestation.
               *
               *   from `secondOutcome`  the model facts, the digests, the times
               *   from the FIRST        the actors and runtimes, which describe
               *                         the same occupant driving the same
               *                         transport — a re-review is the SAME
               *                         reviewer looking again, and inventing a
               *                         new actor for it would be a claim
               *                         nothing observed
               *   from `rec`            nothing; see below
               *
               * `provider` comes from the outcome when it reported one, because
               * it is an observation and the first attempt's is not evidence
               * about this one.
               */
              const secondProvider = secondOutcome.provider ?? secondReviewerAttestation.provider;
              rec.attestations.reviewer = buildAttestation({
                // ONE fact from ONE place. This took `missionId` from the stale
                // attestation and `missionRevision` from `rec`; they agree
                // today, and sourcing two facts that must agree from two places
                // is how they stop agreeing.
                missionId: rec.missionId,
                missionRevision: rec.missionRevision,
                role: 'reviewer',
                requestedActor: secondReviewerAttestation.requestedActor,
                actualActor: secondReviewerAttestation.actualActor,
                requestedRuntime: secondReviewerAttestation.requestedRuntime,
                actualRuntime: secondReviewerAttestation.actualRuntime,
                provider: secondProvider,
                requestedModel: secondRequestedModel ?? undefined,
                actualModel: secondServedModel ?? undefined,
                billingPath: secondReviewerAttestation.billingPath,
                launchVerified: true,
                completionVerified: true,
                // The re-review was adopted, so by construction it was not a
                // substitution — the branch above refuses those.
                fallbackOccurred: false,
                // Bound to the REPAIRED artifact, which is what this review read.
                inputDigest: repaired.artifactDigest,
                outputDigest: digest(JSON.stringify(secondOutcome.result)),
                startedAt: secondOutcome.startedAt,
                completedAt: secondOutcome.completedAt,
              });
              /**
               * AND THE SUPERSEDED ID IS RECORDED, because an earlier event
               * still points at it.
               *
               * `buildAttestation` derives its id from
               * `missionId:role:startedAt`, so a rebuild with the second
               * review's timestamps produces a NEW id — while the "Hermes
               * response received" event appended during the first review still
               * carries the old one. That left every repaired mission's record
               * containing an event referencing a reviewer attestation the
               * record no longer held, and it was the event a founder reads
               * first. A re-review found it by diffing the refs against the ids.
               *
               * Both ids travel in one notice rather than the ref being
               * rewritten: the first attestation really did exist and really was
               * superseded, and erasing the reference would erase that.
               */
              append(rec, {
                role: 'reviewer',
                category: 'reviewer',
                truth: 'system_notice',
                headline: 'The first reviewer attestation was superseded by the re-review.',
                detail: `Attestation ${secondReviewerAttestation.attestationId} describes the review that was `
                  + `rejected; ${rec.attestations.reviewer.attestationId} describes the one that stands. `
                  + 'An earlier event in this record still references the first.',
              });
            }
            /**
             * THE REPAIRED ARTIFACT BECOMES THE MISSION'S ARTIFACT, WITH ITS
             * REVIEW, IN ONE STEP.
             *
             * Only `rec.review` moved here. The completion decision then
             * compared the repaired review's digest against the FIRST
             * attempt's evidence and refused every repair with "The artifact
             * changed after review; the review is stale" — which was true, and
             * was Relay describing its own omission.
             *
             * Observed on `pack-12-repair-cycle-1786427080`: rejection,
             * repair, Relay's own re-verification, "Re-review complete —
             * verdict approved", and then a refusal. Every role did its job
             * and the mission was lost between two variables.
             *
             * The other completion inputs read from `evidence` too —
             * `scopePreserved`, `deterministicTestsPassed`,
             * `protectedPathsUntouched` — so leaving it behind also meant
             * judging the repair's scope by the first attempt's inspection.
             * That direction is worse than the refusal: a repair that broke
             * scope would have been assessed on evidence that predates it.
             *
             * Assigned TOGETHER with the review, and only when the re-review
             * was actually read, so the pair always describes one artifact.
             */
            evidence = repaired;
            /**
             * AND THE RECORD THE FOUNDER READS. `rec.artifactDigest` is set
             * once, from the first attempt, and feeds the mission view. A
             * completed repair would have shown the digest of the artifact it
             * replaced — the record disagreeing with its own review about
             * which bytes were judged.
             */
            rec.artifactDigest = repaired.artifactDigest;
          }
        }
      }

      setPhase(rec, 'review_received');

      /* ------------------------- STEP 5 — PRODUCTION COMPLETION AUTHORITY */
      setPhase(rec, 'completion_deciding', 'relay');
      const reviewDigest = digest(JSON.stringify(review));
      const compKey = completionKey(rec.missionId, evidence.artifactDigest, reviewDigest);
      append(rec, {
        role: 'relay',
        category: 'completion_engine',
        truth: 'system_notice',
        headline: 'Completion decision started.',
        detail:
          'Independent review is REQUIRED for this mission. Passing tests alone, or the coding agent’s own claim, ' +
          'can never produce a verified completion.',
        meta: `IDEMPOTENCY ${compKey}`,
        artifactRef: evidence.artifactDigest,
      });

      const blockingFindings = review.findings.filter((f) => f.severity === 'blocking').length;

      const decision = decideCompletion({
        attestations: rec.attestations,
        requiresIndependentReview: true,
        missionRevision: rec.missionRevision,
        handoffStored: Boolean(rec.handoffDigest),
        handoffDeliveredAutomatically: Boolean(rec.deliveredHandoffDigest),
        persistedHandoffDigest,
        deliveredHandoffDigest: rec.deliveredHandoffDigest,
        scopePreserved: evidence.inspectionAssessment === 'allowed',
        deterministicTestsPassed: evidence.testPassed,
        protectedPathsUntouched: evidence.protectedChanges.length === 0 && evidence.sourceUnchanged,
        reviewerApproved: review.verdict === 'approved' && !hasBlockingFindingRecord(review),
        blockingFindings,
        reviewedArtifactDigest: review.reviewedArtifactDigest,
        currentArtifactDigest: evidence.artifactDigest,
      });

      if (decision.state === 'verified_complete') {
        rec.ledger.set(compKey, 'complete');
        append(rec, {
          role: 'relay',
          category: 'completion_engine',
          truth: 'relay_evidence',
          headline: 'Completion policy satisfied — MISSION VERIFIED.',
          detail:
            'Three genuine execution attestations (ChatGPT · Claude Code · Hermes) · validated handoff delivered ' +
            'automatically · only the claimed file changed · protected paths untouched · Relay-run tests passed · ' +
            'Hermes independently approved the exact artifact Relay verified.',
          meta: `ARTIFACT ${evidence.artifactDigest}`,
          artifactRef: evidence.artifactDigest,
          attestationRef: rec.attestations.reviewer?.attestationId,
          done: true,
        });
        setPhase(rec, 'verified_complete', 'relay');
        rec.completedAt = now();
        return;
      }

      fail(rec, decision.state, decision.reason, { retryable: false });
    } catch (err) {
      if (err instanceof ArchitectUnavailableError) {
        fail(rec, 'prompt_architect_failed', err.message, { code: err.code, retryable: err.retryable });
      } else {
        /**
         * NAME WHAT FAILED, WITHOUT LEAKING WHAT FAILED WITH.
         *
         * This discarded `err` entirely and reported "The mission stopped
         * unexpectedly." for every unexpected throw. The first real hosted
         * three-role mission died here, and neither the founder nor Relay
         * could tell whether a required executable was missing, the workspace
         * root was unwritable, or a provider had misbehaved. A refusal that
         * names nothing cannot be acted on, and this product's whole rule is
         * that a refusal says what is missing.
         *
         * What is safe to surface is narrow and deliberate: the error's CLASS
         * and, for a spawn failure, the COMMAND that was not found. A message
         * body is not surfaced — it can carry paths, arguments and anything a
         * provider echoed back.
         */
        fail(rec, 'verification_failed', describeUnexpected(err), {
          code: 'internal',
          retryable: true,
        });
      }
    } finally {
      rec.running = false;
      rec.cancelHandle = null;
    }
  }

  return {
    start({ missionId, objective, evidenceReferences, repositoryTarget, intendedWritePaths }) {
      const existing = records.get(missionId);
      if (existing) return toView(existing); // idempotent — one dispatch per mission id
      const request = safeText(objective) || 'Implement the controlled demo task.';
      const rec: MissionRecord = {
        missionId,
        originalRequest: request,
        objective: request,
        missionRevision: `rev_${digest(`${missionId}:${request}`)}`,
        repositoryTarget: repositoryTarget ?? null,
        intendedWritePaths: intendedWritePaths ?? [],
        phase: 'ready',
        state: 'ready',
        currentRole: 'relay',
        events: [],
        attestations: {},
        ledger: new Map(),
        completedAt: null,
        running: false,
        cancelRequested: false,
        cancelHandle: null,
        retryCount: 0,
        evidenceReferences: evidenceReferences ?? [],
        liveEvidence: [],
        evidenceRecords: [],
      };
      records.set(missionId, rec);
      void runPipeline(rec); // fire-and-forget; browser polls for progress
      return toView(rec);
    },

    get(missionId) {
      const rec = records.get(missionId);
      return rec ? toView(rec) : null;
    },

    shipContext(missionId) {
      const rec = records.get(missionId);
      if (rec === undefined) return null;
      // Only a VERIFIED mission with a real target and a retained worktree.
      if (rec.state !== 'verified_complete') return null;
      if (rec.repositoryTarget === null) return null;
      const worktreePath = rec.codingOutcome?.retainedWorktreePath ?? null;
      if (worktreePath === null) return null;
      return { target: rec.repositoryTarget, worktreePath };
    },

    cancel(missionId) {
      const rec = records.get(missionId);
      if (!rec) return null;
      if (rec.running) {
        rec.cancelRequested = true;
        try {
          rec.cancelHandle?.cancel();
        } catch {
          /* handle may be gone; the pipeline will observe cancelRequested */
        }
      } else if (!rec.completedAt) {
        cancelled(rec);
      }
      return toView(rec);
    },

    retry(missionId) {
      const rec = records.get(missionId);
      if (!rec) return null;
      if (rec.running) return toView(rec);
      if (rec.state !== 'failed') return toView(rec);
      if (rec.error && rec.error.retryable === false) return toView(rec);
      if (rec.retryCount >= MAX_RETRIES) {
        rec.error = {
          code: 'retry_exhausted',
          safeMessage: 'The mission has already been retried the maximum number of times.',
          retryable: false,
        };
        return toView(rec);
      }
      rec.retryCount += 1;
      // The role ledger is deliberately PRESERVED: a retry resumes from the
      // first incomplete role and never repeats a completed one.
      rec.events = [];
      rec.error = undefined;
      rec.completedAt = null;
      setPhase(rec, 'ready', 'relay');
      void runPipeline(rec);
      return toView(rec);
    },
  };
}

/** A review that approves while carrying a blocking finding is not an
    approval. Mirrors `hasBlockingFinding` for the persisted read-model. */
function hasBlockingFindingRecord(review: MissionReview): boolean {
  return review.findings.some((f) => f.severity === 'blocking');
}

/**
 * A SAFE, ACTIONABLE description of an unexpected throw.
 *
 * Node's system errors carry a short uppercase `code` (`ENOENT`, `EACCES`,
 * `ETIMEDOUT`) and, for a failed spawn, the executable in `path`. Those two
 * facts identify almost every real deployment failure — a missing binary, an
 * unwritable volume, a timeout — and neither can carry a credential.
 *
 * The MESSAGE is deliberately not included. It can contain absolute paths,
 * full argument lists, and text a provider echoed back, which is exactly the
 * material this bridge redacts everywhere else.
 */
export function describeUnexpected(err: unknown): string {
  const base = 'The mission stopped unexpectedly';
  if (typeof err !== 'object' || err === null) return `${base}.`;

  const code = (err as { code?: unknown }).code;
  const path = (err as { path?: unknown }).path;
  const name = (err as { name?: unknown }).name;

  // A bare command name from a failed spawn is the single most useful fact a
  // hosted deployment can be told: it names the thing to install.
  const executable = typeof path === 'string' && path !== '' && !path.includes('/')
    ? path
    : null;

  const safeCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,31}$/.test(code) ? code : null;

  if (safeCode === 'ENOENT' && executable !== null) {
    return `${base}: ${executable} was not found on this host (ENOENT). `
      + 'A hosted deployment must provide it in the image.';
  }
  if (safeCode !== null) return `${base}: ${safeCode}.`;
  if (typeof name === 'string' && /^[A-Za-z]{3,40}$/.test(name)) return `${base}: ${name}.`;
  return `${base}.`;
}
