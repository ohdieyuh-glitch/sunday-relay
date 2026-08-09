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
import { buildAttestation, decideCompletion, digest, type ExecutionAttestation } from './attestation';
import { isProductionDeployment } from './deployment-environment';
import {
  CODING_AGENT_ROLE_ENV, REVIEWER_ROLE_ENV, configuredNames, describeBinding,
  missionDispatchProblems, resolveRoleSlots,
} from './role-slot-config';
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
export interface MissionRoleDeps {
  runOpenAiArchitect?: typeof runOpenAiArchitect;
  runFusionArchitect?: typeof runArchitect;
  runCodingMission?: typeof runCodingMission;
  runHermesReview?: typeof runHermesReview;
  resolveClaudeRuntime?: typeof resolveClaudeRuntime;
  hermesPreflight?: typeof hermesPreflight;
  /** Relay-side preflight override (persistence / write-scope probes). */
  relayPreflight?: () => { ready: boolean; missing: string[] };
}

export interface MissionRegistryConfig {
  fusionBaseUrl: string;
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
  start(input: { missionId: string; objective: string }): LiveMissionUpdate;
  get(missionId: string): LiveMissionUpdate | null;
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
  const callReviewer = deps.runHermesReview ?? runHermesReview;
  const resolveRuntime = deps.resolveClaudeRuntime ?? resolveClaudeRuntime;
  const checkHermes = deps.hermesPreflight ?? hermesPreflight;
  const checkRelay = deps.relayPreflight ?? defaultRelayPreflight;

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
        model: a.model,
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
    review: rec.review,
    attestations: toAttestationSummaries(rec),
  });

  /** Terminal failure. `phase` is the exact supported failure state; the code
      is the same string so the browser and the report agree. */
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
        reviewerOccupant: hermesEnv[REVIEWER_ROLE_ENV] ?? architectEnv[REVIEWER_ROLE_ENV],
        codingAgentOccupant: hermesEnv[CODING_AGENT_ROLE_ENV] ?? architectEnv[CODING_AGENT_ROLE_ENV],
        // The mode the bridge already resolved, not a second reading of the
        // variable behind it.
        fakeCodingRuntime: config.claudeMode === 'fake',
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
      const undispatchable = missionDispatchProblems(boundRoles);
      if (undispatchable.length > 0) {
        fail(rec, 'preflight_blocked', undispatchable.map((p) => p.safeMessage).join(' '), {
          code: 'occupant_not_dispatchable',
          retryable: false,
        });
        return;
      }

      // Coding runtime — resolved (never invoked) before any spend.
      const runtime = resolveRuntime(config.claudeMode, now, config.confirmLive);
      if (!runtime.ok) {
        fail(rec, 'preflight_blocked', `Coding Agent unavailable — ${runtime.safeMessage}`, {
          code: 'coding_agent_not_ready',
          retryable: false,
        });
        return;
      }

      // Reviewer — proven available from local read-only probes only. This is
      // deliberately BEFORE the OpenAI request: an unavailable reviewer must
      // never be discovered after a paid call has already been consumed.
      if (live) {
        hermesReady = checkHermes(hermesConfig);
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
         * The Coding Agent entry carries its runtime PROVENANCE, because
         * `RELAY_BRIDGE_FAKE_CLAUDE=1` resolves a synthetic executable while
         * the occupant is still `claude_code_local` — an unqualified id there
         * would claim the installed CLI held the role when a fake ran.
         */
        meta: `ROLES ${boundRoles.prompt_architect.requestedOccupantId} · `
          + `${boundRoles.coding_agent.requestedOccupantId}(${runtime.runtime.provenance}) · `
          + `${boundRoles.reviewer.requestedOccupantId}`,
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
              model: architectConfig.model,
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
            architectLabel: `ChatGPT · ${safeText(architectResult.receipt.model)}`,
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
            model: safeText(architectResult.receipt.model),
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
          rec.attestations.prompt_architect = buildAttestation({
            missionId: rec.missionId,
            missionRevision: rec.missionRevision,
            role: 'prompt_architect',
            requestedActor: 'ChatGPT',
            actualActor: 'ChatGPT',
            requestedRuntime: 'openai-chat-completions',
            actualRuntime: 'openai-chat-completions',
            provider: 'openai',
            model: architectResult.receipt.model,
            billingPath: 'api_billed',
            launchVerified: true,
            completionVerified: true,
            fallbackOccurred: false,
            externalExecutionIdRedacted: architectResult.receipt.requestIdRedacted ?? undefined,
            inputDigest: architectResult.receipt.inputDigest,
            outputDigest: architectResult.receipt.outputDigest,
            startedAt: architectResult.receipt.startedAt,
            completedAt: architectResult.receipt.completedAt,
          });
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
          headline: 'Coding Agent assignment created — Claude Code.',
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
          executablePath: runtime.runtime.executablePath,
          capabilities: runtime.runtime.capabilities,
          now,
          ids,
          baseEnv: config.baseEnv,
          emit: (e) => append(rec, e),
          publishTerminal: (t) => {
            rec.terminal = t;
          },
          projectLabel: 'Relay controlled fixture (throwaway repository)',
          missionId: rec.missionId,
          missionRevision: rec.missionRevision,
          // The REQUESTED identity, from the binding. What actually ran is
          // observed inside the coding leg and never copied from here.
          requestedOccupant: {
            actorName: boundRoles.coding_agent.occupant.actorName,
            adapterId: boundRoles.coding_agent.occupant.adapterId,
            // Passed through, not narrowed. The coding leg owns the
            // translation into the attestation's vocabulary, and a run that
            // spends nothing must not be laundered into one that does.
            billingPath: boundRoles.coding_agent.occupant.billingPath,
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
      const evidence = coding.evidence;
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
        rec.ledger.set(revKey, 'in_flight');
        setPhase(rec, 'reviewer_starting');
        append(rec, {
          role: 'reviewer',
          category: 'reviewer',
          truth: 'system_notice',
          headline: 'Hermes launched — one read-only review, no retries.',
          detail: `Hermes Agent CLI · ${safeText(hermesReady?.provider ?? 'configured provider')} · ${safeText(
            hermesReady?.model ?? 'configured model',
          )} · subscription-backed.`,
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
        });

        const reviewerStartedAt =
          reviewOutcome.kind === 'launch_failed' ? now() : reviewOutcome.startedAt;
        const reviewerCompletedAt =
          reviewOutcome.kind === 'launch_failed' ? now() : reviewOutcome.completedAt;
        const resolvedProvider = (reviewOutcome.kind === 'reviewed' ? reviewOutcome.provider : null) ?? hermesReady?.provider ?? null;
        const resolvedModel = (reviewOutcome.kind === 'reviewed' ? reviewOutcome.model : null) ?? hermesReady?.model ?? null;

        rec.attestations.reviewer = buildAttestation({
          missionId: rec.missionId,
          missionRevision: rec.missionRevision,
          role: 'reviewer',
          requestedActor: 'Hermes',
          actualActor: 'Hermes',
          requestedRuntime: 'hermes-agent-cli',
          actualRuntime: 'hermes-agent-cli',
          provider: resolvedProvider ?? undefined,
          model: resolvedModel ?? undefined,
          billingPath: 'subscription',
          launchVerified: reviewOutcome.kind !== 'launch_failed',
          completionVerified: reviewOutcome.kind === 'reviewed',
          fallbackOccurred: false,
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
          detail: `Verdict ${reviewOutcome.result.verdict} · ${reviewOutcome.result.findings.length} finding(s) · ${reviewOutcome.result.requirementsChecked.length} requirement(s) checked.`,
          artifactRef: evidence.artifactDigest,
        });

        rec.review = {
          reviewer: 'Hermes',
          runtime: 'Hermes Agent CLI (read-only)',
          provider: resolvedProvider,
          model: resolvedModel,
          billing: 'subscription',
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

      const review = rec.review as MissionReview;
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
        fail(rec, 'verification_failed', 'The mission stopped unexpectedly.', {
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
    start({ missionId, objective }) {
      const existing = records.get(missionId);
      if (existing) return toView(existing); // idempotent — one dispatch per mission id
      const request = safeText(objective) || 'Implement the controlled demo task.';
      const rec: MissionRecord = {
        missionId,
        originalRequest: request,
        objective: request,
        missionRevision: `rev_${digest(`${missionId}:${request}`)}`,
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
      };
      records.set(missionId, rec);
      void runPipeline(rec); // fire-and-forget; browser polls for progress
      return toView(rec);
    },

    get(missionId) {
      const rec = records.get(missionId);
      return rec ? toView(rec) : null;
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
