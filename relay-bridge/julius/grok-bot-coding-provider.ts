import { createHash } from 'node:crypto';

import {
  juliusCodingAgentCharter,
  juliusScopeViolations,
  juliusServedModelVerdict,
  renderJuliusCodingAgentPrompt,
  type JuliusCodingAgentFailure,
  type JuliusCodingAgentProvider,
  type JuliusCodingAgentProviderOutcome,
  type JuliusCodingAgentRequest,
  type JuliusCodingAgentSession,
  type JuliusWorkspaceChange,
} from '../../src/relay/mission/julius/julius-coding-agent';
import type { ShellEffectPort } from './executor-effects';

/**
 * THE GROK BOT CODER: a `JuliusCodingAgentProvider` (julius-coding-agent.ts, the one-method port) whose session runs as a
 * Cursor Cloud Agent — the same agent and models Grok Bot runs on the user's Cursor subscription — reached through a
 * {@link CodingAgentTransport}. The concrete transport is `cursor-cloud-agents-transport.ts`; this file never makes a
 * request, never sees a credential and never names a host.
 *
 * Public sources this design reads (no key used; read 2026-10-30):
 *  - https://cursor.com/docs/cloud-agent/api/endpoints.md   (v1 agents/runs/usage shapes, `agentId` idempotency, `409 agent_id_conflict`)
 *  - https://cursor.com/docs/cloud-agent/api/overview        (same reference, rendered; webhooks "coming soon", so Julius POLLS)
 *  - https://cursor.com/docs/api.md                         (auth, 20 req/min default, 429, error shapes)
 *
 * WHAT IT REFUSES, AND WHY (each is a fixed `providerFailureClass` token):
 *  - absent or incomplete configuration: fails closed before anything is sent (`coder_grok_config_*`, runtimeStarted false);
 *  - a Claude/Anthropic model id or a router alias as the pinned model: there is NO Claude fallback and no "auto" (`coder_grok_model_*`);
 *  - a coder whose model family equals the reviewer's, unless `allowSameFamilyAsReviewer` (`coder_grok_same_family_as_reviewer`);
 *  - sunday-relay as the target repository, in any spelling (`coder_grok_target_is_sunday_relay`);
 *  - a served model the Cursor API does not itself report: the existing `coder_served_model_unattested` halt.
 *
 * WHAT IT NEVER DOES: retry a create (the transport is called once per `execute`, whatever happens); merge, check out or
 * trust the agent's branch or PR; apply anything outside the mission's permitted paths; report a cost of $0.
 */

export const GROK_BOT_CODER_PROVIDER_KIND = 'grok-bot-cloud-agent';

/**
 * THE FOUNDER'S AUTHORIZATION FOR `acceptRequestedModelUnattested`. TODO-FOUNDER: while this constant still begins with
 * `TODO-FOUNDER` the relaxation CANNOT take effect, whatever the configuration says; replacing it is a reviewed code change.
 */
export const GROK_CODER_FOUNDER_AUTHORIZATION_TOKEN =
  'TODO-FOUNDER: replace with the founder-issued authorization string for accepting a requested-but-unattested Grok Bot coder model';
const TODO_FOUNDER_PREFIX = 'TODO-FOUNDER';

/** The evidence string the founder asked for when the relaxation applies. */
export const GROK_CODER_REQUESTED_MODEL_UNATTESTED_EVIDENCE = 'requested model, unattested by provider';

/** sunday-relay itself. A mission's target is never this repository (founder rule: "never sunday-relay main"). */
const SUNDAY_RELAY_REPO = 'ohdieyuh-glitch/sunday-relay';

/* ================================================================== the transport port */

export interface CodingAgentRunRef { readonly agentId: string; readonly runId: string }

export interface CodingAgentCreateInput {
  /** The dispatch's idempotency key; the same key always derives the same `agentId`. */
  readonly idempotencyKey: string;
  readonly agentId: string;
  readonly name: string;
  readonly promptText: string;
  /** ALWAYS sent: an omitted model lets the service pick one (endpoints.md, `model`). */
  readonly modelId: string;
  /** `https://github.com/<owner>/<repo>`. */
  readonly repoUrl: string;
  /** A full 40-hex commit SHA. */
  readonly startingRef: string;
}

/**
 * WHAT A CREATE CAN TELL US. The split that matters is between `not_sent`/`rejected` (positive evidence nothing was
 * created: no runtime started) and `outcome_unknown` (a request left and no confirmed answer came back: it may be running).
 */
export type CodingAgentCreateOutcome =
  | { readonly kind: 'created'; readonly ref: CodingAgentRunRef }
  | { readonly kind: 'not_sent'; readonly cause: 'aborted' | 'key_absent' | 'request_invalid' }
  | { readonly kind: 'rejected'; readonly status: number; readonly cause: 'authentication' | 'forbidden' | 'rate_limited' | 'credit' | 'invalid_request' | 'not_found' }
  | { readonly kind: 'conflict'; readonly status: 409 }
  | { readonly kind: 'outcome_unknown'; readonly cause: 'timeout' | 'network' | 'server_error' | 'malformed_response' | 'aborted_in_flight' };

export type CodingAgentTerminalStatus = 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED';

export type CodingAgentPollOutcome =
  | { readonly kind: 'terminal'; readonly status: CodingAgentTerminalStatus; readonly polls: number }
  | { readonly kind: 'deadline'; readonly polls: number }
  | { readonly kind: 'aborted'; readonly polls: number }
  | { readonly kind: 'poll_failed'; readonly cause: 'authentication' | 'not_found' | 'malformed_response' | 'key_absent' | 'unexpected_status'; readonly polls: number };

/** Token counts as the usage endpoint reports them. A zero is "nothing recorded", never "free". */
export interface CodingAgentUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
  readonly totalTokens: number;
}

export interface CodingAgentBranch { readonly repoUrl: string; readonly branch: string | null; readonly prUrl: string | null }

export type CodingAgentResultOutcome =
  | {
    readonly kind: 'result';
    readonly finalText: string | null;
    readonly durationMs: number | null;
    readonly branches: readonly CodingAgentBranch[];
    readonly usage: CodingAgentUsage | null;
    /** The model id THE SERVICE reported for this run, from a configured documented field; null when it reported none. */
    readonly reportedModelId: string | null;
    readonly reportedModelSource: string | null;
  }
  | { readonly kind: 'unavailable'; readonly cause: string };

export interface CodingAgentTransport {
  readonly transportKind: string;
  createRun(input: CodingAgentCreateInput, signal?: AbortSignal): Promise<CodingAgentCreateOutcome>;
  pollUntilTerminal(ref: CodingAgentRunRef, options: { readonly deadlineAtMs: number; readonly signal?: AbortSignal }): Promise<CodingAgentPollOutcome>;
  fetchResult(ref: CodingAgentRunRef, signal?: AbortSignal): Promise<CodingAgentResultOutcome>;
  /** Best effort, to stop work Julius has abandoned. Never a reason to retry anything. */
  cancelRun(ref: CodingAgentRunRef): Promise<'cancelled' | 'not_cancellable' | 'failed'>;
}

/* ================================================================== the workspace port */

/**
 * HOW THE AGENT'S WORK REACHES JULIUS' WORKSPACE: fetched as a git ref and applied to the WORKING TREE as a patch against
 * the base revision. No merge, no checkout, no commit; Julius' own attempt close still reads status, diff and tests itself.
 */
export interface GrokBotWorkspacePort {
  baseRevision(workspacePath: string, signal?: AbortSignal): Promise<{ readonly ok: true; readonly sha: string } | { readonly ok: false; readonly cause: string }>;
  /** Fetches the branch into a private ref and lists what it changed against `baseRevision`. Changes nothing in the working tree. */
  fetchBranch(input: { readonly workspacePath: string; readonly repoUrl: string; readonly branch: string; readonly baseRevision: string }, signal?: AbortSignal):
    Promise<{ readonly ok: true; readonly headSha: string; readonly changes: readonly JuliusWorkspaceChange[] } | { readonly ok: false; readonly cause: string }>;
  applyFetched(input: { readonly workspacePath: string; readonly baseRevision: string; readonly headSha: string }, signal?: AbortSignal):
    Promise<{ readonly ok: true } | { readonly ok: false; readonly cause: string }>;
}

const SHA40 = /^[0-9a-f]{40}$/u;
const SAFE_OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u;
/** A conservative subset of git's ref rules: no leading dash, no `..`, no `//`, no `@{`, no trailing `/` or `.lock`. */
export function isSafeBranchName(branch: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(branch) && !branch.includes('..') && !branch.includes('//')
    && !branch.endsWith('/') && !branch.endsWith('.lock') && !branch.endsWith('.');
}

/** `https://github.com/<owner>/<repo>` (optionally `.git` or a trailing slash) as `{ owner, repo }`, or null. */
export function parseGithubRepoUrl(raw: string): { readonly owner: string; readonly repo: string } | null {
  const m = /^(?:https:\/\/)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/iu.exec(raw.trim());
  if (m === null) return null;
  const [, owner, repo] = m;
  if (owner === undefined || repo === undefined || !SAFE_OWNER_REPO.test(owner) || !SAFE_OWNER_REPO.test(repo)) return null;
  return { owner, repo };
}

export const isSundayRelayRepo = (raw: string): boolean => {
  const parsed = parseGithubRepoUrl(raw);
  const loose = raw.trim().toLowerCase().replace(/\.git\/?$/u, '').replace(/\/$/u, '');
  return (parsed !== null && `${parsed.owner}/${parsed.repo}`.toLowerCase() === SUNDAY_RELAY_REPO) || loose.endsWith(`/${SUNDAY_RELAY_REPO}`) || loose.endsWith('/sunday-relay');
};

const q = (value: string): string => `'${value.replace(/'/gu, `'\\''`)}'`;
const FETCHED_REF = 'refs/julius/grok-coder/fetched';
const GIT = 'git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c protocol.allow=never -c protocol.https.allow=always';
const STATUS_TO_CHANGE: Readonly<Record<string, JuliusWorkspaceChange['change']>> = { M: 'MODIFIED', A: 'ADDED', D: 'DELETED', T: 'MODIFIED' };

/** The three fixed command shapes the shell-backed workspace port issues. Every interpolated value is validated first. */
export const grokWorkspaceCommands = Object.freeze({
  baseRevision: (): string => `${GIT} rev-parse --verify 'HEAD^{commit}'`,
  fetchBranch: (owner: string, repo: string, branch: string, base: string): string => [
    'set -eu',
    `${GIT} fetch --no-tags --no-recurse-submodules --quiet -- ${q(`https://github.com/${owner}/${repo}.git`)} ${q(`+refs/heads/${branch}:${FETCHED_REF}`)}`,
    `head="$(${GIT} rev-parse --verify '${FETCHED_REF}^{commit}')"`,
    `${GIT} merge-base --is-ancestor ${base} "$head"`,
    'printf \'HEAD %s\\n\' "$head"',
    `${GIT} -c core.quotePath=true diff --no-renames --name-status ${base} "$head"`,
  ].join('\n'),
  applyFetched: (base: string, head: string): string => [
    'set -euo pipefail',
    `${GIT} diff --binary --no-renames ${base} ${head} | ${GIT} apply --check --whitespace=nowarn -`,
    `${GIT} diff --binary --no-renames ${base} ${head} | ${GIT} apply --whitespace=nowarn -`,
    'echo APPLIED',
  ].join('\n'),
});

/**
 * The workspace port over the EXISTING shell port (`ShellEffectPort`). The J1 local shell port (julius-local-shell-port.ts)
 * runs only exact bridge-generated strings and refuses these with `command_not_allowed` until its allow-list is extended
 * by a reviewed change; that refusal surfaces here as a closed failure, never as a fallback.
 */
export function createShellGrokBotWorkspacePort(input: {
  readonly shell: ShellEffectPort;
  readonly ids: { readonly runId: string; readonly projectId: string; readonly taskId: string; readonly workerId: string };
  readonly timeoutMs?: number;
}): GrokBotWorkspacePort {
  const timeoutMs = input.timeoutMs ?? 120_000;
  let seq = 0;
  const run = async (step: string, command: string) => {
    seq += 1;
    return input.shell.run({ ...input.ids, invocationKey: `grok-coder:${step}:${seq}`, command, timeoutMs });
  };
  return {
    async baseRevision() {
      try {
        const r = await run('base', grokWorkspaceCommands.baseRevision());
        const sha = r.stdout.trim();
        return r.status === 'SUCCEEDED' && SHA40.test(sha) ? { ok: true, sha } : { ok: false, cause: 'base_revision_unreadable' };
      } catch { return { ok: false, cause: 'base_revision_unreadable' }; }
    },
    async fetchBranch({ repoUrl, branch, baseRevision }) {
      const parsed = parseGithubRepoUrl(repoUrl);
      if (parsed === null || !isSafeBranchName(branch) || !SHA40.test(baseRevision)) return { ok: false, cause: 'fetch_input_unsafe' };
      let r;
      try { r = await run('fetch', grokWorkspaceCommands.fetchBranch(parsed.owner, parsed.repo, branch, baseRevision)); } catch { return { ok: false, cause: 'fetch_failed' }; }
      if (r.status !== 'SUCCEEDED') return { ok: false, cause: 'fetch_failed' };
      const lines = r.stdout.split('\n').filter((l) => l !== '');
      const head = /^HEAD ([0-9a-f]{40})$/u.exec(lines[0] ?? '')?.[1];
      if (head === undefined) return { ok: false, cause: 'fetch_output_malformed' };
      const changes: JuliusWorkspaceChange[] = [];
      for (const line of lines.slice(1)) {
        const m = /^([MADT])\t([^\t"]+)$/u.exec(line);
        const kind = m?.[1] === undefined ? undefined : STATUS_TO_CHANGE[m[1]];
        if (m === null || kind === undefined || m[2] === undefined) return { ok: false, cause: 'fetch_output_malformed' };
        changes.push(Object.freeze({ path: m[2], change: kind }));
      }
      return { ok: true, headSha: head, changes: Object.freeze(changes) };
    },
    async applyFetched({ baseRevision, headSha }) {
      if (!SHA40.test(baseRevision) || !SHA40.test(headSha)) return { ok: false, cause: 'apply_input_unsafe' };
      try {
        const r = await run('apply', grokWorkspaceCommands.applyFetched(baseRevision, headSha));
        return r.status === 'SUCCEEDED' && r.stdout.trim().endsWith('APPLIED') ? { ok: true } : { ok: false, cause: 'apply_failed' };
      } catch { return { ok: false, cause: 'apply_failed' }; }
    },
  };
}

/* ================================================================== configuration */

/**
 * EVERY FIELD HAS A FAIL-CLOSED DEFAULT, and there is NO default model id: the provider refuses to run until a person
 * names one (a guessed id such as `grok-4.7` would be an assumption; GET /v1/models is the source once a key exists).
 */
export interface GrokBotCoderConfig {
  /** The pinned Cursor model id, sent on every create and compared with what the API reports. No default. */
  readonly pinnedModelId: string | null;
  /** The coder model's family (e.g. the vendor), stated by a person. No default. */
  readonly coderModelFamily: string | null;
  /** The reviewer's model family, stated by a person. No default. */
  readonly reviewerModelFamily: string | null;
  /** Default false: a coder of the reviewer's family is refused. */
  readonly allowSameFamilyAsReviewer: boolean;
  /** Default false. Takes effect only with `founderAuthorizationToken` equal to a non-TODO founder constant. */
  readonly acceptRequestedModelUnattested: boolean;
  readonly founderAuthorizationToken: string | null;
  /** The mission's target repository, `https://github.com/<owner>/<repo>`. Never sunday-relay. No default. */
  readonly targetRepoUrl: string | null;
  /** Wall-clock limit for the run, polled. No default. */
  readonly runDeadlineMs: number | null;
  /** A fixed execution charge per attempt, in micro-USD. Null: the full reservation is charged (the default). */
  readonly fixedPerAttemptReservationUsdMicros: number | null;
}

export const GROK_BOT_CODER_CONFIG_DEFAULTS: GrokBotCoderConfig = Object.freeze({
  pinnedModelId: null,
  coderModelFamily: null,
  reviewerModelFamily: null,
  allowSameFamilyAsReviewer: false,
  acceptRequestedModelUnattested: false,
  founderAuthorizationToken: null,
  targetRepoUrl: null,
  runDeadlineMs: null,
  fixedPerAttemptReservationUsdMicros: null,
});

const MAX_RUN_DEADLINE_MS = 6 * 60 * 60 * 1000;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CLAUDE_LIKE = /claude|anthropic|opus|sonnet|haiku/iu;
const ROUTER_ALIASES = new Set(['auto', 'default', 'auto-smart', 'auto-fast']);

type Refusal = { readonly failure: JuliusCodingAgentFailure; readonly providerFailureClass: string; readonly safeMessage: string };

/** Validates the configuration. A refusal means nothing is sent. Exported so the wiring can refuse at construction. */
export function grokBotCoderConfigRefusal(config: GrokBotCoderConfig | null | undefined): Refusal | null {
  const refuse = (providerFailureClass: string, safeMessage: string, failure: JuliusCodingAgentFailure = 'LAUNCH_FAILED'): Refusal =>
    ({ failure, providerFailureClass, safeMessage });
  if (config === null || config === undefined) return refuse('coder_grok_config_absent', 'The Grok Bot coder is not configured; nothing was dispatched.');
  const model = config.pinnedModelId;
  if (typeof model !== 'string' || !MODEL_ID.test(model)) return refuse('coder_grok_config_model_absent', 'No pinned Grok Bot coder model id is configured; nothing was dispatched.');
  if (CLAUDE_LIKE.test(model)) return refuse('coder_grok_model_claude_refused', 'The Grok Bot coder refuses a Claude model; there is no Claude fallback.');
  if (ROUTER_ALIASES.has(model.toLowerCase())) return refuse('coder_grok_model_router_refused', 'The Grok Bot coder refuses a router alias; the model must be pinned.');
  const coderFamily = typeof config.coderModelFamily === 'string' ? config.coderModelFamily.trim().toLowerCase() : '';
  const reviewerFamily = typeof config.reviewerModelFamily === 'string' ? config.reviewerModelFamily.trim().toLowerCase() : '';
  if (coderFamily === '' || reviewerFamily === '') return refuse('coder_grok_config_family_absent', 'The coder and reviewer model families are not both configured; nothing was dispatched.');
  if (coderFamily === reviewerFamily && config.allowSameFamilyAsReviewer !== true) {
    return refuse('coder_grok_same_family_as_reviewer', 'The coder model family equals the reviewer\'s; independence is refused unless explicitly allowed.');
  }
  if (typeof config.targetRepoUrl !== 'string' || config.targetRepoUrl.trim() === '') return refuse('coder_grok_config_target_absent', 'No target repository is configured; nothing was dispatched.');
  if (isSundayRelayRepo(config.targetRepoUrl)) return refuse('coder_grok_target_is_sunday_relay', 'The Grok Bot coder never works on sunday-relay; nothing was dispatched.');
  if (parseGithubRepoUrl(config.targetRepoUrl) === null) return refuse('coder_grok_config_target_invalid', 'The target repository is not a github.com owner/repo URL; nothing was dispatched.');
  const deadline = config.runDeadlineMs;
  if (typeof deadline !== 'number' || !Number.isInteger(deadline) || deadline <= 0 || deadline > MAX_RUN_DEADLINE_MS) {
    return refuse('coder_grok_config_deadline_absent', 'No valid run deadline is configured; nothing was dispatched.');
  }
  const fixed = config.fixedPerAttemptReservationUsdMicros;
  if (fixed !== null && (typeof fixed !== 'number' || !Number.isInteger(fixed) || fixed <= 0)) {
    return refuse('coder_grok_config_fixed_reservation_invalid', 'A fixed per-attempt reservation must be a positive whole number of micro-USD; zero is never a cost.');
  }
  return null;
}

/** Whether the founder relaxation applies. A TODO-FOUNDER pin can never authorize anything. */
export function grokCoderUnattestedRelaxationApplies(config: GrokBotCoderConfig, pin: string = GROK_CODER_FOUNDER_AUTHORIZATION_TOKEN): boolean {
  return config.acceptRequestedModelUnattested === true
    && typeof config.founderAuthorizationToken === 'string'
    && !pin.startsWith(TODO_FOUNDER_PREFIX)
    && config.founderAuthorizationToken === pin;
}

/**
 * THE IDEMPOTENCY KEY of one dispatch, and the client-supplied `agentId` it derives (endpoints.md: "Client-supplied agent
 * identifier in the form `bc-…`… re-POSTing the same agentId returns 409 agent_id_conflict"). The exact shape the service
 * accepts after `bc-` is not documented; the UUID-shaped form mirrors every documented example and is UNVERIFIED.
 */
export function grokCoderIdempotencyKey(request: JuliusCodingAgentRequest): string {
  const { runId, missionId, taskId, taskType, contextId } = request.identity;
  return ['julius-grok-coder.v1', runId, missionId, taskId, taskType, contextId].map((part) => part.replace(/\|/gu, '%7C')).join('|');
}
export function grokCoderAgentId(idempotencyKey: string): string {
  const h = createHash('sha256').update(idempotencyKey).digest('hex');
  return `bc-${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/* ================================================================== the provider */

export function createGrokBotCodingAgentProvider(input: {
  readonly config: GrokBotCoderConfig | null;
  readonly transport: CodingAgentTransport | null;
  readonly workspace: GrokBotWorkspacePort | null;
  readonly now?: () => number;
  /** Fixed-vocabulary lines only: ids, statuses, classes. Never a header, a body, or provider prose. */
  readonly log?: (line: string) => void;
  /** The founder pin; the composition root passes nothing, so the TODO-FOUNDER constant applies. */
  readonly founderAuthorizationPin?: string;
}): JuliusCodingAgentProvider {
  const now = input.now ?? Date.now;
  const log = input.log ?? ((): void => undefined);
  const pin = input.founderAuthorizationPin ?? GROK_CODER_FOUNDER_AUTHORIZATION_TOKEN;
  return {
    providerKind: GROK_BOT_CODER_PROVIDER_KIND,
    async execute(request: JuliusCodingAgentRequest, signal?: AbortSignal, session?: JuliusCodingAgentSession): Promise<JuliusCodingAgentProviderOutcome> {
      const notStarted = (failure: JuliusCodingAgentFailure, providerFailureClass: string, safeMessage: string): JuliusCodingAgentProviderOutcome => {
        log(`grok-coder refused-before-create class=${providerFailureClass}`);
        return { kind: 'failed', failure, runtimeStarted: false, costUsdMicros: null, safeMessage, providerFailureClass, diagnostics: { codingAgentProvider: GROK_BOT_CODER_PROVIDER_KIND, runtimeStarted: false } };
      };
      const aborted = (): boolean => signal?.aborted === true;
      if (aborted()) return notStarted('CANCELLED', 'coder_cancelled_before_launch', 'The dispatch was cancelled before the Grok Bot coder was created.');

      const refusal = grokBotCoderConfigRefusal(input.config);
      if (refusal !== null) return notStarted(refusal.failure, refusal.providerFailureClass, refusal.safeMessage);
      const config = input.config as GrokBotCoderConfig;
      const transport = input.transport;
      const workspace = input.workspace;
      if (transport === null) return notStarted('LAUNCH_FAILED', 'coder_grok_transport_absent', 'No coding-agent transport is configured; nothing was dispatched.');
      if (workspace === null) return notStarted('LAUNCH_FAILED', 'coder_grok_workspace_port_absent', 'No workspace port is configured; nothing was dispatched.');
      if (session?.selfTest !== undefined) {
        return notStarted('LAUNCH_FAILED', 'coder_grok_self_test_unsupported', 'The Grok Bot coder cannot offer the mission\'s self-test tool; nothing was dispatched.');
      }
      const fixed = config.fixedPerAttemptReservationUsdMicros;
      const budget = request.budget.usdMicros;
      if (budget !== null && budget < 10_000) {
        return notStarted('COST_CEILING_REACHED', 'coder_allocation_below_one_cent', 'The remaining mission budget is below one cent; the Grok Bot coder was not dispatched.');
      }
      if (budget !== null && fixed !== null && fixed > budget) {
        return notStarted('COST_CEILING_REACHED', 'coder_grok_fixed_reservation_exceeds_allocation', 'The fixed per-attempt reservation exceeds this dispatch\'s allocation; nothing was dispatched.');
      }

      const target = parseGithubRepoUrl(config.targetRepoUrl as string) as { owner: string; repo: string };
      const repoUrl = `https://github.com/${target.owner}/${target.repo}`;
      const base = await workspace.baseRevision(request.workspacePath, signal);
      if (!base.ok || !SHA40.test(base.sha)) return notStarted('LAUNCH_FAILED', 'coder_grok_base_revision_unreadable', 'The workspace base revision could not be read; nothing was dispatched.');
      if (aborted()) return notStarted('CANCELLED', 'coder_cancelled_before_launch', 'The dispatch was cancelled before the Grok Bot coder was created.');

      const idempotencyKey = grokCoderIdempotencyKey(request);
      const agentId = grokCoderAgentId(idempotencyKey);
      const modelId = config.pinnedModelId as string;
      const evidence: Record<string, unknown> = {
        codingAgentProvider: GROK_BOT_CODER_PROVIDER_KIND,
        transport: transport.transportKind,
        requestedModel: modelId,
        cursorAgentId: agentId,
        idempotencyKeySha256: createHash('sha256').update(idempotencyKey).digest('hex'),
        targetRepo: `${target.owner}/${target.repo}`,
        baseRevision: base.sha,
      };
      /** Every ending after the create left: unknown spend, charged in full unless a fixed reservation is configured. Never $0. */
      const costFacts = (): Record<string, unknown> => ({
        costBasis: 'NOT_APPLICABLE', billingPath: 'SUBSCRIPTION', costSource: 'unavailable', spendVerified: false,
        ...(fixed === null ? { chargedAs: 'FULL_RESERVATION' } : { executionCostUsdMicros: fixed, chargedAs: 'FIXED_PER_ATTEMPT_RESERVATION' }),
      });
      const started = (failure: JuliusCodingAgentFailure, providerFailureClass: string, safeMessage: string, extra: Record<string, unknown> = {}): JuliusCodingAgentProviderOutcome => {
        log(`grok-coder failed agent=${agentId} class=${providerFailureClass}`);
        return {
          kind: 'failed', failure, runtimeStarted: true, costUsdMicros: null, safeMessage, providerFailureClass,
          diagnostics: { ...evidence, ...costFacts(), runtimeStarted: true, outcome: 'failed', ...extra },
        };
      };

      const prompt = renderJuliusCodingAgentPrompt(request, juliusCodingAgentCharter());
      log(`grok-coder create agent=${agentId} model=${modelId}`);
      const startedAtMs = now();
      // THE ONE CREATE. Whatever it returns, this method never calls it again.
      const created = await transport.createRun({
        idempotencyKey, agentId, name: `julius ${request.identity.taskId}`.slice(0, 100), promptText: prompt, modelId, repoUrl, startingRef: base.sha,
      }, signal);
      evidence.createCalls = 1;
      switch (created.kind) {
        case 'not_sent':
          return created.cause === 'aborted'
            ? notStarted('CANCELLED', 'coder_cancelled_before_launch', 'The dispatch was cancelled before the Grok Bot coder was created.')
            : created.cause === 'key_absent'
              ? notStarted('AUTHENTICATION', 'coder_grok_api_key_absent', 'No Cursor API key is available to the transport; nothing was dispatched.')
              : notStarted('LAUNCH_FAILED', 'coder_grok_request_invalid', 'The create request could not be formed; nothing was dispatched.');
        case 'rejected': {
          const byCause: Record<typeof created.cause, [JuliusCodingAgentFailure, string]> = {
            authentication: ['AUTHENTICATION', 'coder_grok_api_unauthenticated'],
            forbidden: ['AUTHENTICATION', 'coder_grok_api_forbidden'],
            rate_limited: ['RATE_LIMITED', 'coder_grok_api_rate_limited'],
            credit: ['CREDIT_UNAVAILABLE', 'coder_grok_api_credit_unavailable'],
            invalid_request: ['LAUNCH_FAILED', 'coder_grok_api_invalid_request'],
            not_found: ['LAUNCH_FAILED', 'coder_grok_api_not_found'],
          };
          const [failure, cls] = byCause[created.cause];
          return notStarted(failure, cls, 'The Cursor API refused to create the Grok Bot coder; nothing was started.');
        }
        case 'conflict':
          // An agent already exists under this dispatch's id: a prior dispatch with the same key. It is never adopted and never
          // replaced; what it did is unknown, so it is charged and a person looks.
          return started('CONTINUATION_UNAVAILABLE', 'coder_grok_agent_id_conflict', 'A Cloud Agent already exists for this dispatch; it is not adopted and the outcome is unknown.', { outcomeUnknown: true });
        case 'outcome_unknown':
          return created.cause === 'timeout'
            ? started('TIMEOUT', 'coder_grok_create_outcome_unknown', 'The create request timed out after it was sent; the outcome is unknown and it is never retried.', { outcomeUnknown: true, timedOut: true })
            : started('INTERRUPTED', 'coder_grok_create_outcome_unknown', 'The create request was sent without a confirmed answer; the outcome is unknown and it is never retried.', { outcomeUnknown: true });
        case 'created':
          break;
      }
      const ref = created.ref;
      evidence.cursorRunId = ref.runId;
      if (ref.agentId !== agentId) {
        return started('MALFORMED_OUTPUT', 'coder_grok_agent_id_mismatch', 'The Cursor API answered with an agent id other than the one requested.', { outcomeUnknown: true });
      }

      const polled = await transport.pollUntilTerminal(ref, { deadlineAtMs: startedAtMs + (config.runDeadlineMs as number), ...(signal === undefined ? {} : { signal }) });
      evidence.polls = polled.polls;
      if (polled.kind === 'deadline' || polled.kind === 'aborted') {
        const cancel = await transport.cancelRun(ref).catch(() => 'failed' as const);
        evidence.cancelRequested = cancel;
        return polled.kind === 'deadline'
          ? started('TIMEOUT', 'coder_timed_out', 'The Grok Bot coder did not finish before the deadline.', { timedOut: true })
          : started('CANCELLED', 'coder_cancelled', 'The Grok Bot coder run was cancelled.');
      }
      if (polled.kind === 'poll_failed') {
        return polled.cause === 'authentication' || polled.cause === 'key_absent'
          ? started('AUTHENTICATION', 'coder_grok_poll_unauthenticated', 'The Cursor API stopped accepting the key while the run was active.')
          : started('INTERRUPTED', 'coder_grok_poll_failed', 'The run status could not be read; the outcome is unknown.', { outcomeUnknown: true });
      }
      evidence.providerStatus = polled.status.toLowerCase();
      if (polled.status === 'ERROR') return started('PROCESS_EXIT', 'coder_grok_run_error', 'The Cloud Agent run ended in an error.');
      if (polled.status === 'EXPIRED') return started('TIMEOUT', 'coder_grok_run_expired', 'The Cloud Agent run expired.', { timedOut: true });
      if (polled.status === 'CANCELLED') return started('CANCELLED', 'coder_cancelled', 'The Cloud Agent run was cancelled outside Julius.');
      if (aborted()) return started('CANCELLED', 'coder_cancelled', 'The Grok Bot coder run was cancelled.');

      const result = await transport.fetchResult(ref, signal);
      if (result.kind !== 'result') return started('PARTIAL_RESPONSE', 'coder_grok_result_unavailable', 'The finished run\'s result could not be read.');
      if (result.usage !== null) {
        Object.assign(evidence, {
          inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cachedInputTokens: result.usage.cacheReadTokens,
          cacheWriteTokens: result.usage.cacheWriteTokens, totalTokens: result.usage.totalTokens,
          // "Runs without any recorded token usage report zeros" (endpoints.md): a zero is not evidence of no cost.
          usageAllZero: result.usage.totalTokens === 0,
        });
      }
      if (result.durationMs !== null) evidence.providerDurationMs = result.durationMs;

      /**
       * THE SERVED MODEL IS WHAT THE CURSOR API REPORTS FOR THE RUN — never what the agent says about itself. The public
       * v1 docs document no model field on the agent, run or usage record, so by default this is UNATTESTED and the
       * dispatch halts on the existing class. Only the founder relaxation proceeds, and it says so on the record.
       */
      const verdict = juliusServedModelVerdict(modelId, result.reportedModelId);
      evidence.servedModelVerdict = verdict;
      if (result.reportedModelId !== null) evidence.servedModel = result.reportedModelId;
      if (result.reportedModelSource !== null) evidence.servedModelSource = result.reportedModelSource;
      if (verdict === 'MISMATCH') {
        return started('SERVED_MODEL_MISMATCH', 'coder_served_model_mismatch', 'The Cursor API reported a model other than the one pinned; the dispatch stops rather than accept a substitute.');
      }
      if (verdict === 'UNATTESTED') {
        if (!grokCoderUnattestedRelaxationApplies(config, pin)) {
          return started('SERVED_MODEL_UNATTESTED', 'coder_served_model_unattested', 'The Cursor API did not report which model served the run; the dispatch stops rather than assume it.');
        }
        evidence.servedModelAttestation = GROK_CODER_REQUESTED_MODEL_UNATTESTED_EVIDENCE;
      } else {
        evidence.servedModelAttestation = 'reported by provider';
      }

      /** THE AGENT'S BRANCH IS UNTRUSTED: the one on the target repository is fetched and applied as a patch; its PR is a URL on the record, nothing more. */
      const onTarget = result.branches.filter((b) => {
        const p = parseGithubRepoUrl(b.repoUrl);
        return p !== null && p.owner.toLowerCase() === target.owner.toLowerCase() && p.repo.toLowerCase() === target.repo.toLowerCase();
      });
      if (result.branches.length !== onTarget.length) return started('ENVELOPE_NOT_HONOURED', 'coder_grok_branch_outside_target', 'The agent pushed to a repository other than the mission\'s target.');
      const pushed = onTarget.filter((b) => b.branch !== null);
      if (pushed.length > 1) return started('MALFORMED_OUTPUT', 'coder_grok_branches_ambiguous', 'The agent reported more than one pushed branch.');
      const untrustedPr = onTarget.find((b) => b.prUrl !== null)?.prUrl ?? null;
      if (untrustedPr !== null) evidence.untrustedPrUrl = untrustedPr;
      const branch = pushed[0]?.branch ?? null;
      if (branch !== null) {
        if (!isSafeBranchName(branch)) return started('MALFORMED_OUTPUT', 'coder_grok_branch_name_unsafe', 'The agent reported a branch name outside the accepted shape.');
        evidence.agentBranch = branch;
        const fetched = await workspace.fetchBranch({ workspacePath: request.workspacePath, repoUrl, branch, baseRevision: base.sha }, signal);
        if (!fetched.ok) return started('TOOL_CRASH', 'coder_grok_branch_fetch_failed', 'The agent\'s branch could not be fetched into the workspace.', { fetchRefusal: fetched.cause });
        evidence.agentHeadSha = fetched.headSha;
        evidence.fetchedChangeCount = fetched.changes.length;
        const violations = juliusScopeViolations({ changes: fetched.changes, permittedPaths: request.permissions.permittedPaths, outOfScope: request.permissions.outOfScope });
        const gitInternal = fetched.changes.some((c) => c.path === '.git' || c.path.startsWith('.git/') || c.path.includes('/.git/'));
        if (violations.length > 0 || gitInternal) {
          return started('ENVELOPE_NOT_HONOURED', 'coder_grok_patch_out_of_scope', 'The agent changed paths outside the mission\'s permitted scope; nothing was applied.', { scopeViolationCount: violations.length });
        }
        const applied = await workspace.applyFetched({ workspacePath: request.workspacePath, baseRevision: base.sha, headSha: fetched.headSha }, signal);
        if (!applied.ok) return started('TOOL_CRASH', 'coder_grok_patch_apply_failed', 'The agent\'s changes could not be applied to the workspace.', { applyRefusal: applied.cause });
        evidence.patchApplied = true;
      } else {
        evidence.patchApplied = false;
      }
      if (aborted()) return started('CANCELLED', 'coder_cancelled', 'The Grok Bot coder run was cancelled.');

      log(`grok-coder completed agent=${agentId} status=finished`);
      return {
        kind: 'completed',
        finalText: result.finalText,
        observation: {
          // Only an id the API reported; a relaxed unattested run records null here and the relaxation in diagnostics.
          providerModel: verdict === 'MATCH' ? result.reportedModelId : null,
          turns: null,
          toolInvocations: null,
          inputTokens: result.usage?.inputTokens ?? null,
          outputTokens: result.usage?.outputTokens ?? null,
          costUsdMicros: null,
          costBasis: 'NOT_APPLICABLE',
          diagnostics: { ...evidence, ...costFacts(), runtimeStarted: true, outcome: 'succeeded' },
        },
      };
    },
  };
}
