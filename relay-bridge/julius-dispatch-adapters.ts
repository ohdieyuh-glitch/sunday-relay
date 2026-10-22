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
import { composeRoleProviders } from './julius-role-compose';
import { bundleStep, hashWorkspace, J1_ARTIFACT_FILE, type WorkspaceFs } from './julius-dispatch-bundle';
import { createXaiDirectReviewerRoleProvider, type XaiDirectReviewerInput } from './julius-xai-direct-reviewer';

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

// The EXACT live Julius architect charter (ARCHITECT_CHARTER in julius/live-workers.ts), copied verbatim so the J1 architect leg is the same architect. A read-only test extracts the live text and compares sha256 so drift fails.
export const J1_ARCHITECT_CHARTER = [
  'You are the Prompt Architect for a Relay mission run by Julius, the mission controller.',
  'Read the mission context below and produce the structured plan the output schema requires.',
  'You plan; you do not implement, review, or approve your own work.',
  'This is a PLAN ONLY. No work has been done yet and no file has been touched.',
  'Write the entire plan in the FUTURE tense: what is to be done, not what has been done.',
  'Never assert or imply that any file has already been changed, that any test has already',
  'been executed, or that you yourself have performed any of the work — a plan that claims',
  'completed work is refused outright, wherever the claim appears.',
  'State that rule in your own words if you must state it at all; do not quote these sentences back.',
  'Every required string must be substantive: objectiveSummary, each assumption statement,',
  'each architecture decision and its rationale, and the handoff objective and bounded task',
  'must each be non-empty and meaningful. An empty string is refused.',
  'handoff.allowedFileScope must name at least one concrete path drawn from the mission context;',
  'an empty scope is an unbounded handoff and is refused.',
  'Architecture decisions are PROPOSALS: leave accepted false. Approval is not yours to give.',
].join(' ');

export interface ArchitectRoleInput {
  readonly config: GptArchitectConfig;
  /** The frozen mission's brief (the contract text the architect plans from). Fixed by the composition, never taken from the client. */
  readonly brief: string;
  /** The environment variable the controller reads the key from. Required: no default is guessed. */
  readonly keyEnv: string;
  /** Echoed-model strings the controller accepts for this role. Default [config.model]. */
  readonly servedModelAllow?: readonly string[];
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
    providerId: J1_ARCHITECT_PROVIDER_ID, model, fake: input.fake ?? false, keyEnv: input.keyEnv, servedModelAllow: servedAllowOf(input.servedModelAllow, model),
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

/** A role's served-model list: the explicit list (non-empty, no blanks) or exactly [requested model]. */
function servedAllowOf(list: readonly string[] | undefined, model: string): readonly string[] {
  const allow = list ?? [model];
  if (allow.length === 0 || allow.some((m) => !nonEmpty(m))) throw new Error('served_model_allow_invalid');
  return Object.freeze([...allow]);
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
/** True when a variable NAME looks like a credential. Exported so the real coder builder applies the same test to the env it is handed. */
export const isSecretLikeEnvName = (name: string): boolean => SECRET_NAME.test(name);

/**
 * The environment the coder session is HANDED (handed to `providerFor`, because the real `execute` has no env argument). Built from an explicit allow-list over an
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

/**
 * WHAT THE CODER ENVELOPE IS AND IS NOT. `mayRunCommands:false`, `mayUseNetwork:false` and `permittedPaths` are FIELDS ON THE
 * REQUEST this adapter builds and checks (`assertCoderRequestEnvelope`). This adapter has no tool envelope: it does not intercept
 * the session's tools, does not recompute the touched paths against `permittedPaths`, and the post-session change set is
 * evidence for the reviewer, not a scope check. Enforcement, if any, is the provider implementation's. Do not cite these fields
 * as enforcement.
 */
export const J1_CODER_ENVELOPE_LIMITS = Object.freeze({
  requestFieldsChecked: true,
  toolEnvelopeEnforcedByThisAdapter: false,
  scopeRecomputedFromWorkspace: false,
  statement: 'mayRunCommands/mayUseNetwork/permittedPaths are request fields only; they are NOT enforced by this adapter (no tool envelope, no scope recompute).',
});

/** The files the J1 coder may READ. A recorded request field, not enforcement. */
export const J1_CODER_READ_PATHS: readonly string[] = Object.freeze(['data/legacy_ledger.csv', 'data/posts.json', 'format.test.mjs']);
/** The only file the J1 coder may WRITE. */
export const J1_CODER_WRITE_PATHS: readonly string[] = Object.freeze([J1_ARTIFACT_FILE]);
/** The coder tool envelope as a RECORDED request field: Read, Write, Edit only; no Bash, no Web, no Task, no network. NOT enforced by this adapter. */
export const J1_CODER_TOOL_ENVELOPE = Object.freeze({
  allowedTools: Object.freeze(['Read', 'Write', 'Edit']),
  disallowedTools: Object.freeze(['Bash', 'WebFetch', 'WebSearch', 'Task']),
  recordedRequestFieldOnly: true as const,
});

/** Checks the request this adapter is about to send carries the stated envelope. Says nothing about what the session then does. */
export function assertCoderRequestEnvelope(request: JuliusCodingAgentRequest): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const p = (request as { permissions?: { mayRunCommands?: unknown; mayUseNetwork?: unknown; permittedPaths?: unknown; readPaths?: unknown; toolEnvelope?: { allowedTools?: unknown; disallowedTools?: unknown } } }).permissions;
  if (p === undefined || p === null) return { ok: false, reason: 'permissions_absent' };
  if (p.mayRunCommands !== false) return { ok: false, reason: 'mayRunCommands_not_false' };
  if (p.mayUseNetwork !== false) return { ok: false, reason: 'mayUseNetwork_not_false' };
  if (!Array.isArray(p.permittedPaths) || p.permittedPaths.length === 0 || p.permittedPaths.some((x) => !nonEmpty(x as string))) return { ok: false, reason: 'permittedPaths_empty' };
  if (!Array.isArray(p.readPaths) || p.readPaths.some((x) => !nonEmpty(x as string))) return { ok: false, reason: 'readPaths_absent' };
  const tools = p.toolEnvelope;
  if (tools === undefined || tools === null) return { ok: false, reason: 'tool_envelope_absent' };
  const allowed = Array.isArray(tools.allowedTools) ? [...(tools.allowedTools as unknown[])].sort().join(',') : null;
  if (allowed !== 'Edit,Read,Write') return { ok: false, reason: 'tool_envelope_allowed_tools_wrong' };
  const disallowed = Array.isArray(tools.disallowedTools) ? (tools.disallowedTools as unknown[]) : [];
  if (!['Bash', 'WebFetch', 'WebSearch', 'Task'].every((t) => disallowed.includes(t))) return { ok: false, reason: 'tool_envelope_disallowed_tools_incomplete' };
  return { ok: true };
}

export interface CoderRoleInput {
  /** The port implementation, e.g. `createClaudeCodeCodingAgentProvider(...)`. Built by the composition. */
  /**
   * BUILDS the coding provider for ONE attempt, handed the allow-listed environment. The real `JuliusCodingAgentProvider.execute`
   * takes (request, signal, session) and has no environment argument, so the environment can only be applied where the provider
   * is constructed: the composition returns a provider whose session process gets exactly this env. A plain provider object is
   * deliberately not accepted, so there is no path that skips the allow-list. LIMIT: whether the real Claude Code provider can be
   * built with an explicit env is NOT shown here (its constructor has no env option today).
   */
  readonly providerFor: (env: Readonly<Record<string, string>>) => JuliusCodingAgentProvider;
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
  /** Echoed-model strings the controller accepts for the coder (the session's attested provider model). Default [model]. */
  readonly servedModelAllow?: readonly string[];
  /** REQUIRED and non-empty: there is no default scope. A request field only (see J1_CODER_ENVELOPE_LIMITS). */
  readonly permittedPaths?: readonly string[];
  /** Files the coder may read (a recorded request field). Default none recorded. */
  readonly readPaths?: readonly string[];
  /** The bundle step: the workspace before/after hash lists and the judged-message-against-file comparison. Absent = no bundle step. */
  readonly bundle?: { readonly fs: WorkspaceFs; readonly artifactPath: string; /** '.git' when the bridge made a repository in the workspace: its own tree hash, named exclusions recorded. Absent = nothing excluded. */ readonly gitDir?: '.git' | null };
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
  if (!Array.isArray(input.permittedPaths) || input.permittedPaths.length === 0 || input.permittedPaths.some((x) => !nonEmpty(x))) throw new Error('coder_role_requires_permitted_paths');
  const timeouts = input.timeouts ?? DEFAULT_STEP_TIMEOUTS;
  const envAllow = input.envAllowList ?? J1_CODER_ENV_DEFAULT_ALLOW;
  if (envAllow.some((name) => SECRET_NAME.test(name) || name === input.keyEnv)) throw new Error('coder_env_allowlist_contains_secret_name');
  return {
    providerId: J1_CODER_PROVIDER_ID, model: input.model, fake: input.fake ?? false, keyEnv: input.keyEnv, servedModelAllow: servedAllowOf(input.servedModelAllow, input.model),
    async call(call: RoleCallInput): Promise<RoleCallOutput> {
      if (!nonEmpty(call.architectText)) return { ok: false, text: '', responseId: null, model: null, failureClass: 'architect_plan_absent', providerContacted: false };
      const scope = { runId: call.runId, projectId: input.projectId, workerId: input.workerId, taskId: `${call.dispatchId}:coder` };
      /* BEFORE THE SESSION: where this attempt starts. A refusal here means no session was launched. */
      let start;
      try {
        const before = await input.shell.run({ ...scope, invocationKey: `${scope.taskId}:base`, command: juliusAttemptStartCommand(null), timeoutMs: timeouts.base });
        if (before.status !== 'SUCCEEDED') return { ok: false, text: '', responseId: null, model: null, failureClass: 'executor_start_refused', providerContacted: false };
        start = { invocationId: before.invocationId, ...parseJuliusAttemptStart(before.stdout, null) };
      } catch {
        return { ok: false, text: '', responseId: null, model: null, failureClass: 'executor_start_unavailable', providerContacted: false };
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
          permittedPaths: Object.freeze([...input.permittedPaths!]), outOfScope: Object.freeze([]), prohibitedActions: Object.freeze([]),
          // RECORDED request fields (see J1_CODER_ENVELOPE_LIMITS): the read set and the tool envelope. Not enforcement.
          readPaths: Object.freeze([...(input.readPaths ?? [])]), toolEnvelope: J1_CODER_TOOL_ENVELOPE,
        }),
        requiredEvidence: Object.freeze([]),
        budget: Object.freeze({ usdMicros: input.budgetUsdMicros ?? null }),
        protocol: Object.freeze({ participation: juliusParticipationProtocol(), researchAuthority: RESEARCH_AUTHORITY_NOT_STATED }),
      });
      if (!assertCoderRequestEnvelope(request).ok) return { ok: false, text: '', responseId: null, model: null, failureClass: 'coder_request_envelope_invalid', providerContacted: false };
      /* THE WORKSPACE BEFORE THE SESSION (bundle step). A workspace that cannot be hashed means no session was launched. */
      let beforeHashes;
      if (input.bundle !== undefined) {
        try { beforeHashes = await hashWorkspace(input.bundle.fs, { gitDir: input.bundle.gitDir ?? null }); } catch {
          return { ok: false, text: '', responseId: null, model: null, failureClass: 'workspace_snapshot_unavailable', providerContacted: false };
        }
      }
      let outcome;
      try {
        // Built at call time from the injected snapshot: the secret values the composition lists are read when the leg runs.
        const childEnv = buildCoderChildEnv(input.envSnapshot ?? {}, envAllow, [...(input.secretValues ?? []), call.apiKey]);
        outcome = await input.providerFor(childEnv).execute(request);
      } catch {
        return { ok: false, text: '', responseId: null, model: null, failureClass: 'provider_error' };
      }
      if (outcome.kind === 'failed') {
        const sessionId = outcome.diagnostics.responseId;
        /* A runtime that never launched spent nothing. One that did has an UNKNOWN amount: the usage is reported as explicit nulls (never 0). */
        if (!outcome.runtimeStarted) return { ok: false, text: '', responseId: null, model: null, failureClass: outcome.providerFailureClass ?? juliusCodingAgentFailureClass(outcome.failure), providerContacted: false };
        return {
          ok: false, text: '', responseId: typeof sessionId === 'string' && sessionId !== '' ? sessionId : null, model: null,
          usage: { input: null, output: null, total: null }, costUsdMicros: outcome.costUsdMicros,
          failureClass: outcome.providerFailureClass ?? juliusCodingAgentFailureClass(outcome.failure),
        };
      }
      const observation = outcome.observation;
      const sessionId = observation.diagnostics.responseId;
      const usage: RoleUsage = { input: observation.inputTokens, output: observation.outputTokens, total: observation.inputTokens !== null && observation.outputTokens !== null ? observation.inputTokens + observation.outputTokens : null };
      const sessionResponseId = typeof sessionId === 'string' && sessionId !== '' ? sessionId : null;
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
        /* The session already ran and may be billed: its id, model and usage are kept on this failure. */
        return { ok: false, text: '', responseId: sessionResponseId, model: observation.providerModel, usage, failureClass: 'executor_close_unavailable' };
      }
      try { input.onExecutorRecord?.(record, call); } catch { /* a record sink must not break the leg */ }
      /* THE BUNDLE STEP: only the artifact file changed, and the final judged message IS that file (trimmed bytes). Both hashes are kept. */
      let bundle: RoleCallOutput['bundle'];
      if (input.bundle !== undefined && beforeHashes !== undefined) {
        try {
          const after = await hashWorkspace(input.bundle.fs, { gitDir: input.bundle.gitDir ?? null });
          let fileBytes: Uint8Array | null = null;
          const artifactValue = after.files[input.bundle.artifactPath];
          /* A symlink standing in for the artifact is never read (it could point at a key file): the scope check fails it. */
          if (artifactValue !== undefined && !artifactValue.startsWith('symlink:') && !artifactValue.startsWith('special:')) fileBytes = await input.bundle.fs.readFile(input.bundle.artifactPath);
          const step = bundleStep({ judgedMessage: outcome.finalText ?? '', before: beforeHashes, after, fileBytes, artifactPath: input.bundle.artifactPath });
          bundle = {
            judgedSha256: step.judgedSha256, fileSha256: step.fileSha256, changedPaths: step.changedPaths,
            beforeList: step.beforeList, afterList: step.afterList, beforeListSha256: step.beforeListSha256, afterListSha256: step.afterListSha256,
            gitTreeSha256Before: step.gitTreeSha256Before, gitTreeSha256After: step.gitTreeSha256After, excluded: step.excluded,
          };
          if (!step.ok) return { ok: false, text: '', responseId: sessionResponseId, model: observation.providerModel, usage, failureClass: step.failureClass ?? 'artifact_file_mismatch', bundle };
        } catch {
          return { ok: false, text: '', responseId: sessionResponseId, model: observation.providerModel, usage, failureClass: 'workspace_snapshot_unavailable' };
        }
      }
      return {
        ok: true,
        ...(bundle === undefined ? {} : { bundle }),
        // THE ARTIFACT IS THE SESSION'S FINAL MESSAGE (the hidden checker reads exactly this).
        text: outcome.finalText ?? '',
        responseId: sessionResponseId,
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
  /** Echoed-model strings the controller accepts for the Hermes reviewer. Default [config.model]. */
  readonly servedModelAllow?: readonly string[];
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
    providerId: J1_REVIEWER_PROVIDER_ID, model: config.model, fake: input.fake ?? false, keyEnv: input.keyEnv, servedModelAllow: servedAllowOf(input.servedModelAllow, config.model),
    async call(call: RoleCallInput): Promise<RoleCallOutput> {
      if (!nonEmpty(call.architectText) || !nonEmpty(call.coderArtifact)) return { ok: false, text: '', responseId: null, model: null, failureClass: 'review_inputs_absent', providerContacted: false };
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
      const idOf = (o: Extract<HermesOutcome, { kind: 'reviewed' }>): string | null => { try { const id = input.responseIdOf(o, call); return nonEmpty(id) ? id : null; } catch { return null; } };
      if (outcome.kind === 'launch_failed') return { ok: false, text: '', responseId: null, model: null, failureClass: 'reviewer_launch_failed', shownSha256 };
      if (outcome.kind === 'review_incomplete') {
        return { ok: false, text: '', responseId: null, model: null, failureClass: outcome.shape, shownSha256, ...(outcome.usage === undefined ? {} : { usage: hermesUsage(outcome.usage), requests: outcome.usage.apiCalls }) };
      }
      if (outcome.result.verdict === 'unable_to_review') {
        return { ok: false, text: '', responseId: idOf(outcome), model: nonEmpty(outcome.servedModel) ? outcome.servedModel : null, usage: hermesUsage(outcome.usage), requests: outcome.usage.apiCalls, failureClass: 'reviewer_unable_to_review', shownSha256 };
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

export { composeRoleProviders, modelVendor, type ModelVendor } from './julius-role-compose';

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

/**
 * THE FROZEN RUN LOOKUP. J1 creates its own run (the controller writes `run_created`), so there is no Julius store row to read.
 * The lookup answers, for the ONE configured project, with the frozen mission record (mission id and contract sha256 from the
 * prereg-pinned environment) in state READY; any other project is "no such run". It proves nothing about the run id; the
 * controller's own run-creator, key-reuse and per-mission run caps bound that.
 */
export function createFrozenRunLookup(input: { readonly projectId: string; readonly frozen: { readonly missionId: string; readonly contractSha256: string } }): RunLookup {
  if (!nonEmpty(input.projectId) || !nonEmpty(input.frozen.missionId) || !/^[0-9a-f]{64}$/u.test(input.frozen.contractSha256)) throw new Error('frozen_run_lookup_invalid');
  const { projectId, frozen } = input;
  return {
    async lookup(query) {
      if (query.projectId !== projectId) return null;
      return { missionId: frozen.missionId, contractSha256: frozen.contractSha256, state: 'READY' };
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Production composition (NOT wired into server.ts)                                                                */

export interface J1ProductionCompositionInput {
  /** The environment SNAPSHOT the composition derives the coder env and the secret list from. Injected; nothing here reads process.env. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Injected transport for the direct xAI reviewer. */
  readonly fetchImpl: XaiDirectReviewerInput['fetchImpl'];
  /** The frozen mission's brief, fixed by the composition. */
  readonly brief: string;
  /** True for the zero-spend rehearsal build: stamps every adapter fake (composeRoleProviders refuses a mix). */
  readonly fake?: boolean;
  readonly architect: Omit<ArchitectRoleInput, 'brief' | 'fake'>;
  readonly coder: Omit<CoderRoleInput, 'brief' | 'fake' | 'keyEnv' | 'envSnapshot' | 'secretValues'> & { readonly keyEnv?: string | null; readonly secretKeyEnvs?: readonly string[] };
  readonly reviewer: Omit<XaiDirectReviewerInput, 'brief' | 'fake' | 'fetchImpl'>;
}

/**
 * THE J1 LIVE COMPOSITION: GPT architect + coder session + DIRECT xAI reviewer (the path that returns a provider response id),
 * composed through `composeRoleProviders`. Everything is injected (env snapshot, fetch, runners, shell); no adapter reads the
 * process environment and this function opens nothing. It is deliberately NOT referenced from server.ts: the bridge still ships
 * `createUncomposedJuliusDispatch` until a reviewed composition replaces it.
 */
export function createJ1ProductionComposition(input: J1ProductionCompositionInput): { readonly architect: RoleProvider; readonly coder: RoleProvider; readonly reviewer: RoleProvider } {
  const fake = input.fake === true;
  const keyEnvs = [input.architect.keyEnv, input.reviewer.keyEnv, ...(input.coder.secretKeyEnvs ?? [])];
  const secretValues = keyEnvs.map((name) => (input.env[name] ?? '').trim()).filter((v) => v !== '');
  return composeRoleProviders({
    architect: createArchitectRoleProvider({ ...input.architect, brief: input.brief, fake }),
    coder: createCoderRoleProvider({ ...input.coder, keyEnv: input.coder.keyEnv ?? null, brief: input.brief, fake, envSnapshot: input.env, secretValues }),
    reviewer: createXaiDirectReviewerRoleProvider({ ...input.reviewer, brief: input.brief, fetchImpl: input.fetchImpl, fake }),
  });
}
