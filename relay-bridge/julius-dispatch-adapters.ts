import { createHash } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';

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
 *   - CODER `changedPaths` is DERIVED from the executor's own record (the attempt close-out the independent executor ran after the
 *     session: the change set it observed). The session's own tool-invocation count is never consulted for the gate, so a session
 *     that says it ran ten tools and left the workspace untouched reports zero changed paths (signature is not capability). When the
 *     executor captured nothing the count is null (UNKNOWN), never 0. `toolInvocations` is null: this executor mediates only the two
 *     attempt commands, not the session's own tools, so it cannot say.
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

/** What the executor itself recorded about one coder attempt. This, and nothing the session says, is what `changedPaths` is derived from. */
export interface CoderExecutorRecord {
  readonly startInvocationId: string | null;
  readonly closeInvocationId: string;
  readonly captured: boolean;
  /** Paths the executor observed this attempt changing (own changes when the tree snapshots were captured, else the change set). */
  readonly changedPaths: number;
  readonly baseTree: string | null;
  readonly endTree: string | null;
  /** Bounded evidence text for the reviewer, built from the executor's own close-out; null when nothing was captured. */
  readonly evidence: string | null;
}

/** Changed paths for the controller's gate, from the executor's record alone. NULL (unknown) when the executor did not capture a workspace; never 0 by default. */
export function deriveCoderChangedPaths(record: CoderExecutorRecord): number | null {
  return record.captured ? record.changedPaths : null;
}

export const J1_CODER_EVIDENCE_MAX_CHARS = 4_000;

/**
 * The evidence the executor record supports TODAY: the observed change set (kind and path), labelled as such. The close-out command
 * prints name-status lines only, so there is no diff text and no file contents in the record; this never claims there is.
 */
export function coderEvidenceText(changes: readonly { readonly path: string; readonly change: string }[], truncated: boolean): string {
  const lines = ['EXECUTOR-OBSERVED CHANGE SET (kind and path only; the executor recorded no diff text and no file contents)'];
  for (const c of changes) lines.push(`${c.change}\t${c.path}`);
  if (truncated) lines.push('(change set truncated by the executor)');
  const text = lines.join('\n');
  return text.length <= J1_CODER_EVIDENCE_MAX_CHARS ? text : `${text.slice(0, J1_CODER_EVIDENCE_MAX_CHARS)}\n(evidence cut at ${J1_CODER_EVIDENCE_MAX_CHARS} chars)`;
}

/** Default coder child-process environment: process plumbing only. NEVER a provider key. */
export const J1_CODER_ENV_DEFAULT_ALLOW: readonly string[] = Object.freeze(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG']);
/** Names that can never be allow-listed for the coder, whatever the caller says. */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|BEARER)/iu;

/**
 * The environment the coder session is HANDED (the second argument of `execute`). Built from an explicit allow-list over an
 * injected snapshot; a variable whose value contains any known secret value is dropped even if its name is allowed. The adapter
 * never reads `process.env`; what the real session process inherits beyond this is the provider implementation's concern (LIMIT:
 * this file can hand the snapshot, it cannot inspect a spawned process or the workspace for keys).
 */
export function buildCoderChildEnv(snapshot: Readonly<Record<string, string | undefined>>, allow: readonly string[], secretValues: readonly string[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of allow) {
    const value = snapshot[name];
    if (typeof value !== 'string') continue;
    if (secretValues.some((secret) => secret.length >= 8 && value.includes(secret))) continue;
    out[name] = value;
  }
  return Object.freeze(out);
}

/** A coding provider that may take the session environment as a second argument (a one-argument provider is assignable). */
export interface CoderExecutePort {
  readonly providerKind: string;
  execute(request: JuliusCodingAgentRequest, context: { readonly env: Readonly<Record<string, string>> }): ReturnType<JuliusCodingAgentProvider['execute']>;
}

export interface CoderRoleInput {
  /** The port implementation, e.g. `createClaudeCodeCodingAgentProvider(...)`. Built by the composition. */
  readonly provider: CoderExecutePort;
  /** Injected parent environment snapshot the allow-list filters. Absent = the session gets an EMPTY environment. */
  readonly envSnapshot?: Readonly<Record<string, string | undefined>>;
  /** Variable names the session may see. Default J1_CODER_ENV_DEFAULT_ALLOW. A key-like name or the role keyEnv is refused at construction. */
  readonly envAllowList?: readonly string[];
  /** Every provider key value in play (the composition passes them); a variable holding one is dropped. */
  readonly secretValues?: readonly string[];
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
  const envAllow = input.envAllowList ?? J1_CODER_ENV_DEFAULT_ALLOW;
  if (envAllow.some((name) => SECRET_NAME.test(name) || name === input.keyEnv)) throw new Error('coder_env_allowlist_contains_secret_name');
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
        // Built at call time from the injected snapshot: the secret values the composition lists are read when the leg runs.
        outcome = await input.provider.execute(request, { env: buildCoderChildEnv(input.envSnapshot ?? {}, envAllow, [...(input.secretValues ?? []), call.apiKey]) });
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
      /* AFTER THE SESSION: what the executor itself saw. This is the only source of `changedPaths`. */
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
          evidence: close.status.captured ? coderEvidenceText(close.own !== null ? close.own : close.status.changes, close.truncated) : null,
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
        changedPaths: deriveCoderChangedPaths(record),
        // The executor mediates the two attempt commands only, not the session's own tools: it cannot say, so null (never 0).
        toolInvocations: null,
        evidence: record.evidence,
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
      const evidence = nonEmpty(call.coderEvidence) ? call.coderEvidence : '';
      // sha256 over everything shown: brief, plan, artifact and executor evidence, length-framed as a JSON array so the parts cannot blur.
      const shownSha256 = sha256(JSON.stringify([input.brief, call.architectText, call.coderArtifact, evidence]));
      const packet: ReviewPacket = {
        missionId: call.missionId, originalRequest: input.brief, handoffJson: call.architectText,
        acceptanceCriteria: [], priorFindings: [], baseRevision: 'unknown',
        artifactDigest: sha256(call.coderArtifact), changedFiles: [],
        // The artifact (the coder's final message) is shown as the exact bytes under review, with its sha256 in artifactDigest; the
        // executor's evidence (a labelled change set today, a diff when the record carries one) goes in the diff slot.
        unifiedDiff: evidence, changedFileContents: call.coderArtifact,
        testCommand: input.testCommand ?? '', testOutput: '', relayEvidence: [],
      };
      let outcome: HermesOutcome;
      try {
        outcome = await run({ packet, config });
      } catch {
        return { ok: false, text: '', responseId: null, model: null, failureClass: 'provider_error' };
      }
      if (outcome.kind === 'launch_failed') return { ok: false, text: '', responseId: null, model: null, failureClass: 'reviewer_launch_failed', shownSha256 };
      if (outcome.kind === 'review_incomplete') {
        return { ok: false, text: '', responseId: null, model: null, failureClass: outcome.shape, shownSha256, ...(outcome.usage === undefined ? {} : { usage: hermesUsage(outcome.usage), requests: outcome.usage.apiCalls }) };
      }
      if (outcome.result.verdict === 'unable_to_review') {
        return { ok: false, text: '', responseId: null, model: nonEmpty(outcome.servedModel) ? outcome.servedModel : null, usage: hermesUsage(outcome.usage), requests: outcome.usage.apiCalls, failureClass: 'reviewer_unable_to_review', shownSha256 };
      }
      let responseId: string | null = null;
      try { responseId = input.responseIdOf(outcome, call); } catch { responseId = null; }
      return {
        ok: true, text: outcome.result.summary,
        responseId: nonEmpty(responseId) ? responseId : null,
        // The engine's own served model; null when it did not say (never the requested one).
        model: outcome.servedModel,
        usage: hermesUsage(outcome.usage), requests: outcome.usage.apiCalls, shownSha256,
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

export type ModelVendor = 'openai' | 'anthropic' | 'xai';

/** Provider-routed prefixes (`anthropic/claude-x`, `x-ai/grok-4`): the segment names the vendor. */
const ROUTE_VENDOR: Readonly<Record<string, ModelVendor>> = Object.freeze({ openai: 'openai', anthropic: 'anthropic', xai: 'xai', 'x-ai': 'xai' });
/** Known model-name prefixes. `o3`, `o4-mini` and `gpt-5` are all OpenAI; `claude-*` Anthropic; `grok-*` xAI. */
const NAME_VENDOR: readonly (readonly [RegExp, ModelVendor])[] = Object.freeze([
  [/^(gpt-|gpt\d|chatgpt-|codex-|o\d+(-|$))/u, 'openai'],
  [/^claude(-|$)/u, 'anthropic'],
  [/^grok(-|$)/u, 'xai'],
]);

/**
 * The vendor behind a model name, from an EXPLICIT map, or null when it cannot be mapped (the composition then fails closed).
 * A routed form is accepted only when its route segment and its name agree; a conflict (`openai/claude-x`) is null, not a guess.
 */
export function modelVendor(model: string): ModelVendor | null {
  const parts = model.trim().toLowerCase().split('/').filter((p) => p !== '');
  if (parts.length === 0) return null;
  const name = parts[parts.length - 1]!;
  const byName = NAME_VENDOR.find(([re]) => re.test(name))?.[1] ?? null;
  const routed = new Set(parts.slice(0, -1).map((p) => ROUTE_VENDOR[p]).filter((v): v is ModelVendor => v !== undefined));
  if (routed.size > 1) return null;
  const byRoute = routed.size === 1 ? [...routed][0]! : null;
  if (byRoute !== null && byName !== null && byRoute !== byName) return null;
  return byName ?? byRoute;
}

/**
 * Refuses a composition whose three providers are not three different independence groups, whose models cannot all be mapped to a
 * vendor (FAILS CLOSED: 'role_model_vendor_unmapped'), or whose three models share a vendor.
 */
export function composeRoleProviders(providers: { readonly architect: RoleProvider; readonly coder: RoleProvider; readonly reviewer: RoleProvider }): typeof providers {
  const ids = [providers.architect.providerId, providers.coder.providerId, providers.reviewer.providerId];
  if (new Set(ids).size !== 3) throw new Error('role_providers_not_independent');
  if (new Set([providers.architect.fake, providers.coder.fake, providers.reviewer.fake]).size !== 1) throw new Error('role_providers_mixed_fake_and_real');
  // Independence is provider AND model vendor (review F3): a provider string alone can change without changing the model behind it.
  const vendors = [providers.architect.model, providers.coder.model, providers.reviewer.model].map(modelVendor);
  if (vendors.some((v) => v === null)) throw new Error('role_model_vendor_unmapped');
  if (new Set(vendors).size !== 3) throw new Error('role_models_not_independent_families');
  return providers;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Contract binding (prereg b)                                                                                      */

export interface ContractBindingInput {
  /** The port the run lookup will use. Absent (undefined/null/not a function) = refuse. */
  readonly contractSha256Of: unknown;
  /** The sha256 the reviewed prereg pins for the contract file. */
  readonly preregContractSha256: string;
  /** Injected reader of the EXACT contract file bytes (the composition passes a file read; tests pass bytes). */
  readonly readContractBytes: () => Uint8Array;
}

/**
 * Refuses unless a `contractSha256Of` port exists AND the sha256 of the exact contract file bytes equals the prereg value.
 * Throws a class token only.
 */
export function assertContractBinding(input: ContractBindingInput): string {
  if (typeof input.contractSha256Of !== 'function') throw new Error('contract_sha256_port_absent');
  if (!/^[0-9a-f]{64}$/u.test(input.preregContractSha256)) throw new Error('prereg_contract_sha256_invalid');
  let bytes: Uint8Array;
  try { bytes = input.readContractBytes(); } catch { throw new Error('contract_bytes_unreadable'); }
  if (!(bytes instanceof Uint8Array)) throw new Error('contract_bytes_unreadable');
  const actual = createHash('sha256').update(bytes).digest();
  const expected = Buffer.from(input.preregContractSha256, 'hex');
  if (!timingSafeEqual(actual, expected)) throw new Error('contract_sha256_mismatch');
  return input.preregContractSha256;
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
  /** REQUIRED: the prereg's contract sha256 and a reader of the exact contract bytes; construction refuses on absence or mismatch (`assertContractBinding`). */
  readonly contractBinding: { readonly preregContractSha256: string; readonly readContractBytes: () => Uint8Array };
}

export function createJuliusRunLookup(input: RunLookupInput): RunLookup {
  assertContractBinding({ contractSha256Of: input.contractSha256Of, preregContractSha256: input.contractBinding?.preregContractSha256 ?? '', readContractBytes: input.contractBinding?.readContractBytes ?? ((): Uint8Array => { throw new Error('absent'); }) });
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
