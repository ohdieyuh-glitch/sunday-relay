import { createHash } from 'node:crypto';

import { runGptArchitect, type GptArchitectConfig, type GptRunOutcome } from '../src/relay/connectors/gpt-architect';
import {
  juliusCodingAgentFailureClass,
  type JuliusCodingAgentProvider,
  type JuliusCodingAgentRequest,
  JULIUS_CODING_AGENT_CONTRACT_VERSION,
} from '../src/relay/mission/julius/julius-coding-agent';
import type { JuliusApiIdentity, JuliusApiResult, JuliusRunView } from '../src/relay/mission/julius/julius-runtime-api';
import { RESEARCH_AUTHORITY_NOT_STATED } from '../src/relay/mission/julius/julius-research-protocol';
import { juliusParticipationProtocol } from '../src/relay/mission/julius/julius-worker-participation';
import { runHermesReview, type HermesConfig, type HermesOutcome, type ReviewPacket } from './hermes-reviewer';
import type { RoleCallInput, RoleCallOutput, RoleProvider, RoleUsage, RunLookup } from './julius-dispatch';
import { juliusAttemptCloseCommand, juliusAttemptStartCommand, parseJuliusAttemptClose, parseJuliusAttemptStart } from './julius/coder-workspace';
import type { ShellEffectPort } from './julius/executor-effects';

/**
 * J1 PRODUCTION ADAPTERS behind the `RoleProvider` / `RunLookup` ports of `julius-dispatch.ts`.
 *
 * WHAT THIS FILE IS. Thin wrappers over code that already exists: `runGptArchitect` (OpenAI Responses API), the
 * `JuliusCodingAgentProvider` port with the independent executor's `ShellEffectPort` behind it, and `runHermesReview` (local Hermes).
 * Each takes the real runner as an INJECTED function (defaulting to the real one only where the default is the repository's own
 * path), so the tests here use fakes and nothing in this file opens a socket, spawns a process or reads an environment variable.
 * KEYS: the controller reads the key from the environment and hands it to `call` as `apiKey`; no adapter reads `process.env`.
 *
 * WHAT IT REFUSES TO CLAIM.
 *   - CODER `toolCalls` is DERIVED from the executor's own record (the attempt close-out the independent executor ran after the
 *     session: the change set it observed). The session's own tool-invocation count is never consulted for the gate, so a session
 *     that says it ran ten tools and left the workspace untouched reports zero (signature is not capability).
 *   - REVIEWER response id is NEVER invented. The Hermes outcome carries no provider response id (OPEN_ITEMS 22): a response id
 *     must come from the injected `responseIdOf`; without one, or when it returns nothing, the leg reports null and the controller
 *     refuses the leg (`response_identity_missing`). The provider-echoed model is the outcome's `servedModel`, never the request.
 *   - Failures carry a CLASS (a fixed token), never a provider message.
 */

/** The independence groups. The controller requires the three to differ and the reviewer to equal JULIUS_J1_REVIEWER_PROVIDER. */
export const J1_ARCHITECT_PROVIDER_ID = 'openai';
export const J1_CODER_PROVIDER_ID = 'anthropic';
export const J1_REVIEWER_PROVIDER_ID = 'xai';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const nonEmpty = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim() !== '';

/* ---------------------------------------------------------------------------------------------------------------- */
/* Architect                                                                                                        */

export const J1_ARCHITECT_CHARTER = [
  'You are the Prompt Architect for a Relay mission.',
  'Read the mission brief below and produce the structured plan the output schema requires.',
  'You plan; you do not implement, review or approve work. No work has been done yet and no file has been touched.',
].join(' ');

export interface ArchitectRoleInput {
  readonly config: GptArchitectConfig;
  /** The frozen mission's brief (the contract text the architect plans from). Fixed by the composition, never taken from the client. */
  readonly brief: string;
  /** The environment variable the controller reads the key from. Required: no default is guessed. */
  readonly keyEnv: string;
  readonly instructions?: string;
  /** Injectable for offline tests; defaults to the real connector. */
  readonly run?: typeof runGptArchitect;
  readonly fake?: boolean;
}

export function createArchitectRoleProvider(input: ArchitectRoleInput): RoleProvider {
  if (!input.config.liveMode || !nonEmpty(input.config.model)) throw new Error('architect_role_requires_live_config');
  if (!nonEmpty(input.keyEnv)) throw new Error('architect_role_requires_key_env');
  const run = input.run ?? runGptArchitect;
  const model = input.config.model;
  return {
    providerId: J1_ARCHITECT_PROVIDER_ID, model, fake: input.fake ?? false, keyEnv: input.keyEnv,
    async call(call: RoleCallInput): Promise<RoleCallOutput> {
      let outcome: GptRunOutcome;
      try {
        outcome = await run({
          apiKey: call.apiKey, config: input.config, instructions: input.instructions ?? J1_ARCHITECT_CHARTER,
          input: input.brief,
        });
      } catch {
        return { ok: false, text: '', responseId: null, model: null, failureClass: 'provider_error' };
      }
      if (!outcome.ok) {
        return {
          ok: false, text: '', responseId: nonEmpty(outcome.responseId) ? outcome.responseId : null,
          model: nonEmpty(outcome.actualModel) ? outcome.actualModel : null,
          ...(outcome.usage === undefined ? {} : { usage: gptUsage(outcome.usage) }),
          failureClass: outcome.failureClass,
        };
      }
      return {
        ok: true, text: outcome.outputText, responseId: outcome.responseId,
        // The PROVIDER's echoed model: `actualModel` is the response's own, never the configuration.
        model: outcome.actualModel, usage: gptUsage(outcome.usage), requests: 1,
      };
    },
  };
}

function gptUsage(usage: { readonly inputTokens: number | null; readonly outputTokens: number | null; readonly totalTokens: number | null }): RoleUsage {
  return { input: usage.inputTokens, output: usage.outputTokens, total: usage.totalTokens };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Coder                                                                                                            */

/** What the executor itself recorded about one coder attempt. This, and nothing the session says, is what `toolCalls` is derived from. */
export interface CoderExecutorRecord {
  readonly startInvocationId: string | null;
  readonly closeInvocationId: string;
  readonly captured: boolean;
  /** Paths the executor observed this attempt changing (own changes when the tree snapshots were captured, else the change set). */
  readonly changedPaths: number;
  readonly baseTree: string | null;
  readonly endTree: string | null;
}

/** `toolCalls` for the controller's gate, from the executor's record alone. Zero when the executor did not capture a workspace. */
export function deriveCoderToolCalls(record: CoderExecutorRecord): number {
  return record.captured ? record.changedPaths : 0;
}

export interface CoderRoleInput {
  /** The port implementation, e.g. `createClaudeCodeCodingAgentProvider(...)`. Built by the composition. */
  readonly provider: JuliusCodingAgentProvider;
  /** The independent executor. The adapter never runs a command anywhere else. */
  readonly shell: ShellEffectPort;
  readonly projectId: string;
  readonly workerId: string;
  readonly workspacePath: string;
  readonly brief: string;
  readonly model: string;
  /** Null for a subscription coder (no key); otherwise the variable the controller reads. Required: no default is guessed. */
  readonly keyEnv: string | null;
  readonly permittedPaths?: readonly string[];
  readonly budgetUsdMicros?: number | null;
  /** Called with the executor record for every attempt that reached the close-out, for the composition to ledger or log. */
  readonly onExecutorRecord?: (record: CoderExecutorRecord, call: RoleCallInput) => void;
  readonly timeouts?: { readonly base: number; readonly status: number };
  readonly fake?: boolean;
}

const DEFAULT_STEP_TIMEOUTS = Object.freeze({ base: 60_000, status: 60_000 });

export function createCoderRoleProvider(input: CoderRoleInput): RoleProvider {
  if (!nonEmpty(input.model)) throw new Error('coder_role_requires_model');
  if (!nonEmpty(input.workspacePath)) throw new Error('coder_role_requires_workspace');
  const timeouts = input.timeouts ?? DEFAULT_STEP_TIMEOUTS;
  return {
    providerId: J1_CODER_PROVIDER_ID, model: input.model, fake: input.fake ?? false, keyEnv: input.keyEnv,
    async call(call: RoleCallInput): Promise<RoleCallOutput> {
      if (!nonEmpty(call.architectText)) return { ok: false, text: '', responseId: null, model: null, failureClass: 'architect_plan_absent' };
      const scope = { runId: call.runId, projectId: input.projectId, workerId: input.workerId, taskId: `${call.dispatchId}:coder` };
      /* BEFORE THE SESSION: where this attempt starts. A refusal here means no session was launched. */
      let start;
      try {
        const before = await input.shell.run({ ...scope, invocationKey: `${scope.taskId}:base`, command: juliusAttemptStartCommand(null), timeoutMs: timeouts.base });
        if (before.status !== 'SUCCEEDED') return { ok: false, text: '', responseId: null, model: null, failureClass: 'executor_start_refused' };
        start = { invocationId: before.invocationId, ...parseJuliusAttemptStart(before.stdout, null) };
      } catch {
        return { ok: false, text: '', responseId: null, model: null, failureClass: 'executor_start_unavailable' };
      }
      const request: JuliusCodingAgentRequest = Object.freeze({
        version: JULIUS_CODING_AGENT_CONTRACT_VERSION,
        identity: Object.freeze({ runId: call.runId, missionId: call.missionId, taskId: scope.taskId, taskType: 'build', contextId: `${call.dispatchId}:context` }),
        workspacePath: input.workspacePath,
        contract: null,
        plan: call.architectText,
        sections: Object.freeze({
          acceptedGuidance: Object.freeze([]), architecture: Object.freeze([]), findings: Object.freeze([]), continuation: Object.freeze([]),
          missionContext: Object.freeze([Object.freeze({ entryId: 'j1:brief', kind: 'MISSION', text: input.brief })]),
        }),
        permissions: Object.freeze({
          mayEditFiles: true as const, mayRunCommands: false as const, mayUseNetwork: false as const,
          permittedPaths: Object.freeze([...(input.permittedPaths ?? [])]), outOfScope: Object.freeze([]), prohibitedActions: Object.freeze([]),
        }),
        requiredEvidence: Object.freeze([]),
        budget: Object.freeze({ usdMicros: input.budgetUsdMicros ?? null }),
        protocol: Object.freeze({ participation: juliusParticipationProtocol(), researchAuthority: RESEARCH_AUTHORITY_NOT_STATED }),
      });
      let outcome;
      try {
        outcome = await input.provider.execute(request);
      } catch {
        return { ok: false, text: '', responseId: null, model: null, failureClass: 'provider_error' };
      }
      if (outcome.kind === 'failed') {
        const sessionId = outcome.diagnostics.responseId;
        return {
          ok: false, text: '', responseId: typeof sessionId === 'string' && sessionId !== '' ? sessionId : null, model: null,
          failureClass: outcome.providerFailureClass ?? juliusCodingAgentFailureClass(outcome.failure),
        };
      }
      /* AFTER THE SESSION: what the executor itself saw. This is the only source of `toolCalls`. */
      let record: CoderExecutorRecord;
      try {
        const status = await input.shell.run({
          ...scope, invocationKey: `${scope.taskId}:status`, timeoutMs: timeouts.status,
          command: juliusAttemptCloseCommand(start.baseTree !== null && start.startTree !== null ? { baseTree: start.baseTree, startTree: start.startTree } : null),
        });
        const close = parseJuliusAttemptClose(status.stdout, status.status === 'SUCCEEDED');
        record = {
          startInvocationId: start.invocationId, closeInvocationId: status.invocationId, captured: close.status.captured,
          changedPaths: close.own !== null ? close.own.length : close.status.changes.length,
          baseTree: start.baseTree, endTree: close.endTree,
        };
      } catch {
        return { ok: false, text: '', responseId: null, model: null, failureClass: 'executor_close_unavailable' };
      }
      try { input.onExecutorRecord?.(record, call); } catch { /* a record sink must not break the leg */ }
      const observation = outcome.observation;
      const sessionId = observation.diagnostics.responseId;
      const usage: RoleUsage = { input: observation.inputTokens, output: observation.outputTokens, total: observation.inputTokens !== null && observation.outputTokens !== null ? observation.inputTokens + observation.outputTokens : null };
      return {
        ok: true,
        // THE ARTIFACT IS THE SESSION'S FINAL MESSAGE (the hidden checker reads exactly this).
        text: outcome.finalText ?? '',
        responseId: typeof sessionId === 'string' && sessionId !== '' ? sessionId : null,
        // Attested served model, or null (the controller then refuses the leg).
        model: observation.providerModel,
        usage,
        toolCalls: deriveCoderToolCalls(record),
        requests: null,
      };
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Reviewer (xAI through Hermes)                                                                                    */

export interface ReviewerRoleInput {
  readonly config: HermesConfig;
  readonly brief: string;
  /** The variable the controller reads the key from. Required: whether Hermes' own profile or this variable holds the credential is not resolvable from the code. */
  readonly keyEnv: string;
  /**
   * WHERE THE PROVIDER RESPONSE ID COMES FROM. The Hermes outcome carries none, so this is a required port with no default.
   * It receives the completed outcome; a null or empty answer makes the leg report no response id, which the controller refuses.
   */
  readonly responseIdOf: (outcome: Extract<HermesOutcome, { kind: 'reviewed' }>, call: RoleCallInput) => string | null;
  readonly testCommand?: string;
  /** Injectable for offline tests; defaults to the real Hermes runner. */
  readonly run?: typeof runHermesReview;
  readonly fake?: boolean;
}

export function createReviewerRoleProvider(input: ReviewerRoleInput): RoleProvider {
  const { config } = input;
  if (!nonEmpty(config.executable) || !nonEmpty(config.model) || !nonEmpty(config.provider)) throw new Error('reviewer_role_requires_live_config');
  // The reviewer must be a DIFFERENT provider from the architect (openai) and the coder (anthropic).
  if (config.provider !== J1_REVIEWER_PROVIDER_ID) throw new Error('reviewer_role_requires_xai_provider');
  if (!nonEmpty(input.keyEnv)) throw new Error('reviewer_role_requires_key_env');
  const run = input.run ?? runHermesReview;
  return {
    providerId: J1_REVIEWER_PROVIDER_ID, model: config.model, fake: input.fake ?? false, keyEnv: input.keyEnv,
    async call(call: RoleCallInput): Promise<RoleCallOutput> {
      if (!nonEmpty(call.architectText) || !nonEmpty(call.coderArtifact)) return { ok: false, text: '', responseId: null, model: null, failureClass: 'review_inputs_absent' };
      const packet: ReviewPacket = {
        missionId: call.missionId, originalRequest: input.brief, handoffJson: call.architectText,
        acceptanceCriteria: [], priorFindings: [], baseRevision: 'unknown',
        artifactDigest: sha256(call.coderArtifact), changedFiles: [],
        // The dispatch route has the coder's final message only, not a workspace diff: it is shown as the artifact under review.
        unifiedDiff: '', changedFileContents: call.coderArtifact,
        testCommand: input.testCommand ?? '', testOutput: '', relayEvidence: [],
      };
      let outcome: HermesOutcome;
      try {
        outcome = await run({ packet, config });
      } catch {
        return { ok: false, text: '', responseId: null, model: null, failureClass: 'provider_error' };
      }
      if (outcome.kind === 'launch_failed') return { ok: false, text: '', responseId: null, model: null, failureClass: 'reviewer_launch_failed' };
      if (outcome.kind === 'review_incomplete') {
        return { ok: false, text: '', responseId: null, model: null, failureClass: outcome.shape, ...(outcome.usage === undefined ? {} : { usage: hermesUsage(outcome.usage), requests: outcome.usage.apiCalls }) };
      }
      if (outcome.result.verdict === 'unable_to_review') return { ok: false, text: '', responseId: null, model: null, failureClass: 'reviewer_unable_to_review' };
      let responseId: string | null = null;
      try { responseId = input.responseIdOf(outcome, call); } catch { responseId = null; }
      return {
        ok: true, text: outcome.result.summary,
        responseId: nonEmpty(responseId) ? responseId : null,
        // The engine's own served model; null when it did not say (never the requested one).
        model: outcome.servedModel,
        usage: hermesUsage(outcome.usage), requests: outcome.usage.apiCalls,
        // Any non-approved verdict is a rejection (the engine's own rule: any changes_required is blocking).
        verdict: outcome.result.verdict === 'approved' ? 'approve' : 'reject',
      };
    },
  };
}

function hermesUsage(usage: { readonly inputTokens: number | null; readonly outputTokens: number | null; readonly totalTokens: number | null }): RoleUsage {
  return { input: usage.inputTokens, output: usage.outputTokens, total: usage.totalTokens };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Composition helper                                                                                               */

/** Refuses a composition whose three providers are not three different independence groups. */
export function composeRoleProviders(providers: { readonly architect: RoleProvider; readonly coder: RoleProvider; readonly reviewer: RoleProvider }): typeof providers {
  const ids = [providers.architect.providerId, providers.coder.providerId, providers.reviewer.providerId];
  if (new Set(ids).size !== 3) throw new Error('role_providers_not_independent');
  if (new Set([providers.architect.fake, providers.coder.fake, providers.reviewer.fake]).size !== 1) throw new Error('role_providers_mixed_fake_and_real');
  return providers;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* RunLookup                                                                                                        */

export interface RunLookupInput {
  /** The structural subset of `JuliusRuntimeApi` this needs. */
  readonly api: { inspectRun(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<JuliusRunView>> };
  /** The read-scoped identity the bridge uses for the one configured project. */
  readonly identityFor: (projectId: string) => JuliusApiIdentity;
  /**
   * THE FROZEN CONTRACT'S sha256 AS RECORDED FOR THIS RUN, or null when nothing was recorded. The run view carries only a contract
   * REVISION number, not a content hash, so this is a required port with no default; null makes the controller refuse the run as
   * not the frozen mission (409), never accept it.
   */
  readonly contractSha256Of: (input: { readonly projectId: string; readonly runId: string; readonly missionId: string }) => Promise<string | null>;
}

export function createJuliusRunLookup(input: RunLookupInput): RunLookup {
  return {
    async lookup({ projectId, runId }) {
      const result = await input.api.inspectRun(input.identityFor(projectId), runId);
      if (!result.ok) {
        // An unknown run, or one in another project, is "no such run"; anything else (identity, scope) is an unavailable lookup.
        if (result.reason === 'run_not_found' || result.reason === 'not_authorized_for_project') return null;
        throw new Error(`run_lookup_${result.reason}`);
      }
      const { missionId, state } = result.value;
      const contractSha256 = await input.contractSha256Of({ projectId, runId, missionId });
      return { missionId, contractSha256: nonEmpty(contractSha256) ? contractSha256 : '', state };
    },
  };
}
