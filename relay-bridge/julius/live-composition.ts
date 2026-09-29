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

import { coderAttemptDeadlineMs } from '../hosted-coding-agent/coder-envelope';
import { architectOperativeTimeoutMs } from '../../src/relay/connectors/gpt-architect/config';
import { reviewerOperativeTimeoutMs } from '../reviewer-deadline';
import { randomUUID } from 'node:crypto';
import {
  JuliusProviderHealthRegistry,
  JuliusProviderRouter,
  JuliusRunLoop,
  JuliusWorkerRegistry,
  juliusLeaseHoldBoundMs,
  juliusLeaseMsFor,
  fixedResourceEstimate,
  juliusSharedCeilingPolicy,
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
  JULIUS_DEFAULT_MAX_CODER_SEGMENTS,
  MAX_TASK_ATTEMPTS,
  juliusTickAllowance,
  planJuliusTickBudget,
  planRunStatePath,
  type JuliusTickBudget,
  type JuliusWorker,
  type JuliusWorkerRole,
  noJuliusResearch,
  type JuliusResearchLedger,
  type JuliusResearchPolicy,
} from '../../src/relay/mission/julius';
import { createJuliusResearchMediator, juliusResearchPortFrom } from './research-mediator';
import type { MeteredOutcome } from '../../src/relay/mission/live-reach';

/**
 * What a recorded research outcome COST, rebuilt from the durable row.
 *
 * Deliberately conservative: only the two outcomes that provably never left the
 * process — a policy refusal and an exhausted budget — are free. Everything
 * else reached something, and a projection that guessed otherwise would let a
 * restarted mission re-spend a budget it had already used. An outcome this
 * build does not recognise is charged rather than ignored, for the same reason.
 */
export function meteredFromJuliusOutcome(outcome: unknown): MeteredOutcome {
  switch (outcome) {
    case 'policy_refused':
    case 'budget_exhausted':
      return 'not_attempted';
    case 'observed':
    // A signalled page was still fetched. The signal is about trust, not cost.
    case 'injection_signaled':
      return 'observed';
    case 'throttled': return 'throttled';
    case 'unauthenticated': return 'unauthenticated';
    case 'unsupported_content': return 'answered_unusable';
    case 'unreachable': return 'unreachable';
    default: return 'unreachable';
  }
}
import {
  emptyJuliusResearchLedger, isJuliusResearchRole, recordJuliusResearch,
  type JuliusResearchRequest,
} from '../../src/relay/mission/julius';
import type { JuliusTimelineReader } from '../../src/relay/mission/julius';
import { createLiveReachService } from '../live-reach-service';
import type { BackendProbe } from '../../src/relay/mission/live-reach';
import {
  evaluateReadiness,
  readGptArchitectConfig,
} from '../../src/relay/connectors/gpt-architect';
import { HOSTED_API_KEY_ENV, HOSTED_MODEL_ENV } from '../hosted-coding-agent/hosted-readiness';
import { ANTHROPIC_CREDENTIAL_ENV_NAMES, JULIUS_CLAUDE_AUTH_ENV, resolveClaudeAuthMode } from '../hosted-coding-agent/hosted-auth';
import { loadHermesConfig } from '../hermes-reviewer';
import type { runGptArchitect } from '../../src/relay/connectors/gpt-architect';
import type { runHostedCodingAgent, HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import type { runHermesReview } from '../hermes-reviewer';

/**
 * THE OUTPUT TOKENS THE RUN BUDGET ALREADY RESERVES FOR ONE DISPATCH.
 *
 * `fixedResourceEstimate` has always reserved 20,000 output tokens per
 * dispatch, and the connector has always capped the architect at 4,000
 * (`DEFAULT_MAX_OUTPUT_TOKENS`). The two numbers describe the SAME call and did
 * not agree: Julius was reserving budget for a request five times larger than
 * the one it was willing to make.
 *
 * This is now the ceiling a mission may raise its architect to, and no higher.
 * That is the whole safety property: a mission cannot buy more output than the
 * reservation already covers, so a larger token limit can never outrun the
 * mission's own `spendUsd` ceiling by arriving unbudgeted. Raising the ceiling
 * beyond this would mean raising the reservation, deliberately, here.
 */
export const ARCHITECT_OUTPUT_TOKEN_RESERVATION = 20_000;

/**
 * HOW MANY CHARACTERS OF MISSION CONTEXT EACH SLOT'S PACKET MAY COMPILE.
 *
 * THE ARCHITECT AND THE CODER: 200,000. Room for the page a worker asked for,
 * beside everything else it is owed. 24,000 was the whole packet, and
 * qualification attempt 4 (run 34774471909) compiled up to 10,130 characters of
 * mission context before any research, so a served page could never fit beside
 * it. The research resume is bounded at 160,000
 * (`JULIUS_RESEARCH_ASK_LIMITS.renderedChars`), and 200,000 holds it with
 * the largest context attempt 4 compiled, three times over. Neither slot's
 * packet goes through argv:
 *   - the architect's is an HTTPS request body;
 *   - the hosted SDK writes the coder's prompt to the child's stdin
 *     (`--input-format stream-json`, @anthropic-ai/claude-agent-sdk 0.3.220,
 *     sdk.mjs:108 and sdk.mjs:136).
 *
 * THE INDEPENDENT REVIEWER: 24,000, unchanged. Its prompt reaches Hermes as a
 * single `-z` argument, and Linux refuses any argv string over 131,072 bytes
 * at exec, before a provider is asked. Nothing the reviewer is owed needs more:
 *   - research answers are scoped to the continuation that asked;
 *   - the served-page trail is a line per read;
 *   - its mission text is cut to 8,000 characters by the packet builder.
 * Keeping the ceiling where it was keeps the reviewer's argv exactly as large
 * as it was. Attempts 3 and 4 measured at most 54,797 bytes.
 *
 * A budget is a ceiling, not a size: a packet with nothing extra to carry
 * compiles exactly as before.
 */
export function liveContextCharacterBudget(role: JuliusWorkerRole): number {
  return role === 'INDEPENDENT_REVIEWER' ? 24_000 : 200_000;
}
import {
  createLiveArchitectAdapter,
  createLiveHermesReviewerAdapter,
  createLiveHostedCodingAdapter,
  type CompiledContextSource,
  type LiveArtifactExchange,
  type ResearchPolicySource,
} from './live-workers';
import type { ShellEffectPort, TaskClaimSource } from './executor-effects';

/* ------------------------------------------------------- role resolution */

/**
 * A FUNCTION OF THE ENVIRONMENT, like `reviewerWorker` is a function of the
 * provider, and for the same reason: the one field that is not a constant is
 * the deadline, and a constant deadline is how a declaration stops describing
 * the call it declares.
 */
export const architectWorker = (env: Record<string, string | undefined>): JuliusWorker => ({
  workerId: 'prompt-architect-openai', role: 'PROMPT_ARCHITECT',
  adapterId: 'openai-architect-live', providerId: 'openai',
  // `repair:plan` is a PLAN REVISION: a repair inherits its subject's role and
  // stage, so a rejected plan comes back here with the reviewer's findings in
  // its context, not to the Coding Agent. Paid run 34037313976 minted the
  // latter, and nobody could route it.
  /**
   * `guidance` and `repair:guidance` are the continuous lifecycle's additions:
   * the architect that ADVISES under a contract that is already locked, and its
   * own repair. They are registered here only now that every step of the live
   * path can genuinely serve one — the architect's guidance branch answers
   * under the locked charge and refuses without it, the reviewer has a GUIDANCE
   * rubric rather than the implementation one, and the reviewer's adapter
   * refuses a guidance review whose packet it cannot read. Registering earlier
   * would have minted a task whose review could approve something it never saw.
   */
  /**
   * `rebuttal` joins them because the architect can now ANSWER a disagreement.
   * PR #270 registered none, so Julius proved the rebuttal unroutable and
   * resolved every live challenge against the architect without asking it —
   * safe, and not a peer. Registering it here and `review:rebuttal` on the
   * reviewer are one change: a rebuttal nobody could re-review would leave a
   * maintained position with no way to be judged.
   */
  /**
   * `architecture` joins them because Julius now goes BACK to the architect
   * mid-mission and before completion. Registering it here and
   * `review:architecture` on the reviewer are one change, for the reason the
   * rebuttal pair was: a consultation nobody could review would let a design
   * change after the terms locked with nothing able to check it.
   */
  capabilities: ['plan'],
  taskTypes: ['plan', 'repair:plan', 'guidance', 'repair:guidance', 'rebuttal', 'architecture'],
  /**
   * RESOLVED, not merely derived. This first read `300_000`, a literal that
   * happened to equal the connector's default; the literal was then replaced by
   * `DEFAULT_TIMEOUT_MS` itself, which looked like a derivation and was still
   * one step short — the number that bounds the call is
   * `readGptArchitectConfig(env).timeoutMs`, and `RELAY_PROMPT_ARCHITECT_TIMEOUT_MS`
   * moves it. So setting that variable moved the operative deadline and left
   * this declaration behind, which is precisely the drift the previous comment
   * claimed to have ended. Reading through the same resolver the adapter's
   * config comes from makes the two incapable of disagreeing under ANY
   * environment, rather than under the empty one.
   */
  concurrencyLimit: 1, timeoutMs: architectOperativeTimeoutMs(env), maxRetries: 1, status: 'AVAILABLE',
});

/**
 * WHAT THE ARCHITECT MAY SPEND OF THE JOB, worst case — its RESOLVED deadline
 * times every attempt the run loop will make.
 *
 * Exported because the job-budget proof in `coder-envelope.test.ts` needs this
 * number and used to compute it from `DEFAULT_TIMEOUT_MS * 2`: the connector's
 * fallback times a literal. Both factors were restatements, so raising the
 * architect's real deadline in the workflow would have raised the real worst
 * case while the proof that the four shares fit inside `JOB_BUDGET_MS` stayed
 * where it was and kept passing.
 */
export const architectWorstCaseSpendMs = (env: Record<string, string | undefined>): number =>
  architectOperativeTimeoutMs(env) * (architectWorker(env).maxRetries + 1);

/**
 * WHAT SETTLING A DISPATCH MAY TAKE AFTER THE WORKER ANSWERED: evidence,
 * acceptance, verification and any research the answer asked Julius to serve
 * inline, one retrieval at a time. It is the old flat lease, which had to cover
 * all of that and the dispatch besides; now it covers only what follows the
 * dispatch, beside a deadline the worker itself declares.
 */
export const JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS = 600_000;

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
  /**
   * THIS ONE WAS ACTUALLY WRONG, by four minutes. It declared `600_000` while
   * `hosted-runner.ts` aborts the run at `DEFAULT_HOSTED_LIMITS.maxRuntimeMs`,
   * which is 360_000. A reader of this composition root would have budgeted ten
   * minutes for a coder the runtime kills at six. Same defect as the reviewer's,
   * found by the same structural test, fixed the same way.
   */
  /**
   * AND THEN IT WAS WRONG THE OTHER WAY. The session's own limit was declared as
   * the whole dispatch's, but the dispatch also runs the base read before the
   * session and the status, diff and test captures after it — so a session that
   * used its allowance was cut while its tests ran. The worker declares the
   * ATTEMPT: the session's limit plus the executor steps around it.
   */
  concurrencyLimit: 1, timeoutMs: coderAttemptDeadlineMs(), maxRetries: 1, status: 'AVAILABLE',
};

export const reviewerWorker = (providerId: string): JuliusWorker => ({
  workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER',
  adapterId: 'hermes-local-live', providerId,
  capabilities: ['review'],
  /**
   * EVERY STAGE THE DOMAIN DEFINES, and the two guidance stages arrive with
   * the architect's. A `guidance` task nobody could re-review would be minted,
   * dispatched, and then never accepted — and the continuation blocked on it
   * would never release, which is a stalled mission rather than a refused one.
   * The registrations are therefore added together or not at all, and
   * `julius-live-composition.test.ts` holds this list against
   * `JULIUS_REVIEW_STAGES` so a stage cannot be added to the domain without a
   * reviewer for it.
   */
  taskTypes: [
    'review:plan', 'review:build', 'review:guidance', 'review:rebuttal', 'review:architecture',
    'review:repair:plan', 'review:repair:build', 'review:repair:guidance',
  ],
  /**
   * THE SAME CALL `loadHermesConfig` MAKES. This used to read `240_000`, a
   * number nothing enforced, while the limit that actually cut a review off was
   * 400_000 from the workflow environment — 160 s apart, with the inert one
   * written here where a reader would look for it. Both now come from
   * `resolveReviewerDeadline`, so the declared and the operative deadline are
   * the same value by construction and `reviewer-deadline.test.ts` fails if a
   * literal is ever put back.
   */
  concurrencyLimit: 1, timeoutMs: reviewerOperativeTimeoutMs(), maxRetries: 1, status: 'AVAILABLE',
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
  /**
   * The mission contract's `limits.architectMaxOutputTokens`, when it declares
   * one. Bounded by `ARCHITECT_OUTPUT_TOKEN_RESERVATION`; absent means the
   * environment's default stands.
   */
  readonly architectMaxOutputTokens?: number | null;
  /**
   * The mission's sealed research policy, handed to every worker so each is TOLD
   * what it may ask for. The entrypoint passes the same function to the research
   * mediator, which is what DECIDES; absent, each prompt says it was not told.
   */
  readonly researchPolicyFor?: ResearchPolicySource;
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

  /**
   * THE MISSION MAY RAISE ITS OWN ARCHITECT CEILING, WITHIN THE RESERVATION.
   *
   * The environment supplies the default; the mission contract governs the
   * exception, the same way it governs `spendUsd` and `repairCycles`. A
   * declared value is bounded at parse time and again by
   * `julius-live-contract-check.mjs`; anything absent or unusable leaves the
   * environment's answer untouched, so a mission that says nothing behaves
   * exactly as every mission did before.
   */
  const envArchitectConfig = readGptArchitectConfig(options.env);
  const declaredCeiling = options.architectMaxOutputTokens;
  const architectConfig = typeof declaredCeiling === 'number'
      && Number.isInteger(declaredCeiling)
      && declaredCeiling > 0
      && declaredCeiling <= ARCHITECT_OUTPUT_TOKEN_RESERVATION
    ? { ...envArchitectConfig, maxOutputTokens: declaredCeiling }
    : envArchitectConfig;
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
    // ONE worker object for the registration and the adapter, exactly as the
    // reviewer does it below. Two calls would be two resolutions of the same
    // environment — equal today, and the shape that drifts.
    const worker = architectWorker(options.env);
    entries.push({
      worker,
      adapter: createLiveArchitectAdapter({
        worker, contexts: options.contexts, artifacts: options.artifacts,
        config: architectConfig, apiKey: options.env.OPENAI_API_KEY ?? '',
        ...(options.researchPolicyFor === undefined ? {} : { researchPolicyFor: options.researchPolicyFor }),
        run: options.runners?.architect,
      }),
    });
  }

  const codingMissing: string[] = [];
  /**
   * WHICH CREDENTIAL THIS COMPOSITION EXPECTS, and why an unknown mode is fatal.
   *
   * `ANTHROPIC_API` is the default and unchanged: the key is required, as it always
   * was. `CLAUDE_SUBSCRIPTION` requires its ABSENCE instead — Anthropic documents
   * that the key takes precedence over subscription authentication, so demanding one
   * in subscription mode would be demanding the thing that defeats the mode.
   *
   * A MISSPELLED MODE IS REFUSED rather than defaulted, because falling back to API
   * mode would bill a balance nobody chose.
   */
  const authMode = resolveClaudeAuthMode(options.env);
  if (!authMode.ok) {
    codingMissing.push(`${JULIUS_CLAUDE_AUTH_ENV} (${authMode.refusal}: ${authMode.because})`);
  } else if (authMode.mode === 'ANTHROPIC_API') {
    if (!options.env[HOSTED_API_KEY_ENV]) codingMissing.push(HOSTED_API_KEY_ENV);
  } else if (options.env[HOSTED_API_KEY_ENV]) {
    // Present in the PARENT is not the same as reaching the child — `hostedChildEnv`
    // builds from `{}` and omits it in this mode — but a key configured alongside a
    // subscription request is a contradiction the operator should resolve rather
    // than one this composition should silently pick a winner for.
    codingMissing.push(`${HOSTED_API_KEY_ENV} is set while ${JULIUS_CLAUDE_AUTH_ENV}=CLAUDE_SUBSCRIPTION; unset the key for this deployment or choose ANTHROPIC_API`);
  }
  if (authMode.ok && authMode.mode === 'CLAUDE_SUBSCRIPTION') {
    // THE SAME CONTRADICTION FOR EVERY OTHER ROUTE OFF THE SUBSCRIPTION. None of these
    // reaches the child either, but each is documented to outrank the setup-token
    // token, and an operator who configured one next to a subscription request has
    // not decided which they meant. Names only; no value is read.
    for (const name of ANTHROPIC_CREDENTIAL_ENV_NAMES) {
      if (name === HOSTED_API_KEY_ENV || !options.env[name]) continue;
      codingMissing.push(`${name} is set while ${JULIUS_CLAUDE_AUTH_ENV}=CLAUDE_SUBSCRIPTION; it outranks the subscription, so unset it or choose ANTHROPIC_API`);
    }
  }
  if (!requested.codingModel) codingMissing.push(HOSTED_MODEL_ENV);
  if (!options.workspacePath) codingMissing.push('mission workspacePath (contract field)');
  // An EMPTY test command is not missing configuration: it is the mission's
  // declaration that it has no deterministic check — a report, an analysis, a
  // plan — and the coder then runs nothing and records no TEST row. Refusing it
  // here was the third of three guards that made Julius coding-only on the live
  // path; the field is still required to be a string by the contract parser.
  if (typeof options.testCommand !== 'string') codingMissing.push('mission testCommand');
  if (options.shell === null) codingMissing.push('executor shell port (JULIUS_EXECUTOR_ENDPOINT and its material)');
  if (codingMissing.length > 0) {
    problems.push({ role: 'CODING_AGENT', reason: 'live_config_missing', missing: codingMissing });
  } else {
    entries.push({
      worker: CODER_WORKER,
      adapter: createLiveHostedCodingAdapter({
        worker: CODER_WORKER, contexts: options.contexts, artifacts: options.artifacts,
        projectId: options.projectId,
        // In subscription mode this is the empty string and is never placed in the
        // child's environment; `hostedChildEnv` omits the variable entirely.
        apiKey: authMode.ok && authMode.mode === 'CLAUDE_SUBSCRIPTION' ? '' : options.env[HOSTED_API_KEY_ENV] ?? '',
        ...(authMode.ok ? { authMode: authMode.mode } : {}),
        requestedModel: requested.codingModel ?? '', workspacePath: options.workspacePath,
        testCommand: options.testCommand, shell: options.shell as ShellEffectPort,
        ...(options.researchPolicyFor === undefined ? {} : { researchPolicyFor: options.researchPolicyFor }),
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
        ...(options.researchPolicyFor === undefined ? {} : { researchPolicyFor: options.researchPolicyFor }),
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
      // SPENT MONEY IS CHARGED, NOT RELEASED, AND CHARGED AT WHAT IT COST.
      //
      // A failed attempt that billed before it failed settles at what it
      // billed — not at what it was allowed to bill. Clamping to the hold
      // would hide real overspend from the ledger and let the mission be
      // granted money it has already spent; recording the excess drives
      // `available()` down, and past zero it denies the next dispatch, which
      // is the honest direction for a ceiling that has been exceeded. Only an
      // attempt that spent nothing hands its whole hold back.
      const spent = typeof input.usdMicros === 'number' && Number.isFinite(input.usdMicros) && input.usdMicros > 0
        ? input.usdMicros : 0;
      // AND UNKNOWN SPEND KEEPS ITS HOLD. A hosted runtime reports cost only
      // in the final message a timeout never delivers, so the attempt most
      // likely to have billed is the one least likely to say so.
      if (spent === 0 && input.spendUnknown === true) {
        held.set(input.reservationId, { usdMicros: row.usdMicros, state: 'COMMITTED' });
        return;
      }
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
/**
 * THE RESEARCH SPEND, READ BACK FROM A RUN'S OWN ROWS — bytes included.
 *
 * A left fold of `recordJuliusResearch` over the run's `research.retrieved`
 * rows: the same function the live path charges with, so the two readers cannot
 * disagree, and a restarted process replays to the same position because the
 * rows ARE the position.
 *
 * THE BYTE COUNT IS READ, NOT INVENTED. This projection used to pass
 * `bytes: null` for every row because the row carried none. Paid qualification
 * attempt 4 (run 34774471909) then refused every research ask after the first
 * as `byte_budget_unenforceable`: one read per mission, and the three-per-slot
 * allowance unusable. The row now records `bytes` beside `bytesRecorded: true`.
 *
 * A ROW WITHOUT A RECORDED COUNT IS UNKNOWN SPEND, NEVER ZERO. A row written
 * before the count existed, or one whose count is not a non-negative integer,
 * is replayed as unsized, so a byte budget over it says it cannot be enforced —
 * the fail-closed answer — rather than letting the next read through under a
 * number that looks measured.
 */
export async function projectDurableJuliusResearchLedger(
  reader: JuliusTimelineReader,
  request: Pick<JuliusResearchRequest, 'missionId' | 'runId' | 'projectId'>,
): Promise<JuliusResearchLedger> {
  let ledger = emptyJuliusResearchLedger(request.missionId);
  let sinceSequence = 0;
  for (;;) {
    const page = await reader.timeline({
      runId: request.runId, projectId: request.projectId, sinceSequence, limit: 500,
    });
    for (const entry of page.entries) {
      sinceSequence = Math.max(sinceSequence, entry.sequence);
      if (entry.type !== 'research.retrieved') continue;
      const role = entry.facts.role;
      if (typeof role !== 'string' || !isJuliusResearchRole(role)) continue;
      const recorded = entry.facts.bytesRecorded === true;
      const bytes = entry.facts.bytes;
      ledger = recordJuliusResearch(ledger, role, {
        source: 'web',
        outcome: meteredFromJuliusOutcome(entry.facts.outcome),
        bytes: recorded && typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null,
        at: entry.occurredAt,
      });
    }
    if (page.entries.length === 0 || !page.hasMore) break;
  }
  return ledger;
}

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
  /**
   * THE EXECUTION ATTEMPT, for naming peer requests. A mission's run id repeats
   * across workflow attempts, so the live entrypoint passes the workflow run and
   * attempt; absent, the pipeline's local scope.
   */
  readonly executionScope?: string;
  readonly budget?: JuliusBudgetPort;
  /**
   * How long a claimed task's lease lasts. In production it is DERIVED — the
   * longest deadline any registered worker declares plus the settlement
   * allowance — and renewed while the work is real; a drill that must witness a REAL expiry — a
   * process dying with the lease held and a fresh one reclaiming it off the
   * wall clock — cannot wait that long, and faking `now` would prove the sweep
   * against a clock nobody runs. Stated here so the drill shortens the lease
   * rather than the truth.
   */
  readonly leaseMs?: number;
  /**
   * THE MISSION'S RESEARCH AUTHORITY, one sealed policy per mission.
   *
   * Absent, every mission gets `noJuliusResearch` — allowlist empty, no slot
   * authorised, retrieval budget zero — and a research ask from any worker is
   * refused as `research_not_authorized` before a socket can exist. That is the
   * armed-and-inert state the arming stack is meant to reach: the door is
   * built, governed and closed, and opening it for a mission is an act of
   * mission authority rather than a code change.
   */
  readonly researchPolicyFor?: (missionId: string) => JuliusResearchPolicy;
  /** Injected in tests so the whole mediated path runs without a network. */
  readonly researchFetch?: typeof fetch;
  /**
   * WHICH BACKENDS HAVE ACTUALLY BEEN SEEN TO ANSWER, which is a different
   * question from what this mission is allowed to read.
   *
   * Live Reach refuses a capability no backend has been OBSERVED serving —
   * `capability_unavailable`, decided before the mission allowlist is even
   * consulted. That gate is right: "this mission authorises reading a page"
   * and "Relay has a backend that can read a page" are separate facts, and a
   * mission may not assert the second by wanting the first.
   *
   * It was also, until this was wired, unconditional: the composition never
   * supplied probes, so EVERY governed retrieval was refused whatever the
   * mission authorised. The seam existed on the mediator and only a test ever
   * reached it.
   *
   * Absent still means refused — the default stays closed, and an operator
   * supplying an observed probe is asserting something they have seen.
   */
  readonly researchProbes?: readonly BackendProbe[];
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
      usdMicros: 300_000, inputTokens: 50_000, outputTokens: ARCHITECT_OUTPUT_TOKEN_RESERVATION,
      toolCalls: 10, runtimeMs: 300_000,
    }),
    /**
     * THE MISSION CONTRACT GOVERNS EVERY SLOT'S SPEND, not just the coder's.
     *
     * The same two contract fields still derive it — `spendUsd` is the ceiling
     * and `repairCycles` the authorised repair rounds — but the rule is now v3:
     * each peer holds a protected floor no other slot may take, everything
     * above the floors is one shared pool, and a dispatch draws its own unspent
     * floor plus whatever of that pool is genuinely free.
     *
     * WHY NOT v1: it has no per-slot dimension at all, so the coder drew an
     * equal share of the whole ceiling and the peers took a flat estimate out
     * of the same pot — one worker with two commentators.
     *
     * WHY NOT v2: it capped every dispatch at one per-round share of a per-slot
     * envelope. On this repository's own figures that cap is 2,499,750 and
     * Mission 5's first dispatch really settled 5,177,120, so v2 would have
     * refused to fund work that actually happened while peer money sat unspent
     * and out of reach.
     *
     * See docs/JULIUS_PAID_RUN_34037313976_REPAIRS.md for the original rule.
     */
    allocation: juliusSharedCeilingPolicy({
      ceilingUsdMicros: options.spendCeilingUsdMicros, authorizedRepairRounds: options.maxRepairRounds,
    }),
    /**
     * THE ONE GOVERNED DOOR TO THE OUTSIDE, and it starts closed.
     *
     * Bound rather than omitted so a research ask is refused for the true
     * reason — this mission authorises none — instead of the weaker
     * `RESEARCH_UNSERVED`, which says only that Julius has no way to look. It
     * runs in the BRIDGE, never inside the executor: the sandbox keeps
     * `--network none`, and mediation is what makes that compatible with a
     * worker needing to read a specification.
     */
    research: juliusResearchPortFrom(createJuliusResearchMediator({
      policyFor: options.researchPolicyFor ?? ((missionId) => noJuliusResearch(missionId)),
      liveReach: createLiveReachService({
        now: () => new Date().toISOString(),
        nextEvidenceId: () => `evidence:${randomUUID()}`,
        ...(options.researchFetch === undefined ? {} : { fetchImpl: options.researchFetch }),
      }),
      now: () => new Date().toISOString(),
      /**
       * THE RESEARCH SPEND, READ BACK FROM THE RUN'S OWN ROWS.
       *
       * Bound only when the store can serve a timeline; otherwise the mediator
       * keeps its in-process Map and says so. The projection is a left fold of
       * `recordJuliusResearch` over the `research.retrieved` rows, which is the
       * same function the live path charges with — one rule, two readers, so
       * they cannot disagree. A restarted process replays to the same position
       * because the rows ARE the position.
       */
      ...(typeof (options.store as { timeline?: unknown }).timeline === 'function'
        ? {
          durableLedger: (request: JuliusResearchRequest) =>
            projectDurableJuliusResearchLedger(options.store as unknown as JuliusTimelineReader, request),
        }
        : {}),
      // READINESS, NOT AUTHORITY. Handed through unchanged; the mission's own
      // allowlist is decided separately and afterwards, so a probe can never
      // widen what a mission may read.
      ...(options.researchProbes === undefined
        ? {}
        : { retrievalContext: () => ({ probes: options.researchProbes }) }),
    })),
    /**
     * THE MONEY RECORD, READ BACK. The same store that writes `budget.reserved`
     * and `budget.settled` reads them, so the per-slot ledger is projected from
     * durable truth and a restarted process reaches the same accounts.
     */
    ...(typeof (options.store as { timeline?: unknown }).timeline === 'function'
      ? { timeline: options.store as unknown as JuliusTimelineReader }
      : {}),
    ...(options.executionScope === undefined ? {} : { executionScope: options.executionScope }),
    owner: options.owner ?? 'julius-live-mission',
    contextCharacterBudget: liveContextCharacterBudget,
  };
  const policies: JuliusPolicySource = {
    async policyFor() { return { card, verification }; },
    capabilityFor: (task) => (task.role === 'PROMPT_ARCHITECT' ? 'plan' : task.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement'),
  };
  /**
   * THE LEASE FOLLOWS THE WORKERS, AND IS RENEWED WHILE THEY WORK.
   *
   * It was a flat 600 000 ms beside a Coding Agent whose attempt now declares
   * more than that, and nothing renewed it. The lease is derived from the
   * registered workers' own deadlines, renewed four times per lease from
   * admission, and never held past the task's bound: every worker of its role
   * at its deadline, plus the settlement allowance.
   */
  const workers = options.entries.map((entry) => entry.worker);
  const leaseMs = options.leaseMs ?? juliusLeaseMsFor(workers, JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS);
  const loop = new JuliusRunLoop(deps, policies, {
    claimLimit: 4, leaseMs,
    leaseRenewal: {
      renewEveryMs: Math.max(1, Math.floor(leaseMs / 4)),
      holdBoundMsFor: (task) => juliusLeaseHoldBoundMs(workers, task, JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS),
    },
  });
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
  /**
   * THE TICK ACCOUNT, when the drive was bounded by the mission's structure
   * (`verification` given): what was planned, what the run added, what it
   * consumed, and whether the allowance ran out. Null for a drive bounded only
   * by a bare `maxTicks`.
   */
  readonly tickAccount: DriveTickAccount | null;
}

export interface DriveTickAccount {
  readonly plannedTicks: number;
  readonly hardMaxTicks: number;
  /** The allowance in force when the drive ended: planned plus what the run added, capped, then tightened by any override. */
  readonly allowance: number;
  readonly ticksConsumed: number;
  readonly ticksRemaining: number;
  readonly beyondMainPath: number;
  /** Of those, the dispatches that exist because a peer disagreed: one rebuttal, one re-review. */
  readonly disagreementTicks: number;
  /** Of those, the dispatches that exist because Julius went back to the architect. */
  readonly architectureTicks: number;
  readonly retries: number;
  /** An operator's `maxTicks`, which may only tighten the allowance. Null when none was given. */
  readonly override: number | null;
  readonly reason: string;
  readonly exhausted: boolean;
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
  /**
   * With a verification policy, the allowance is DERIVED from the run's own
   * structure (`planJuliusTickBudget`) and `maxTicks` can only tighten it.
   * Without one, `maxTicks` alone bounds the drive, as it always has.
   */
  readonly verification?: JuliusVerificationPolicy;
  readonly maxTicks?: number;
}): Promise<DriveOutcome> {
  const maxTicks = input.maxTicks ?? 32;
  const override = input.verification !== undefined && input.maxTicks !== undefined ? input.maxTicks : null;
  const budget = input.verification === undefined ? null : await liveTickBudgetFor({
    store: input.store, runId: input.runId, projectId: input.projectId, verification: input.verification,
  });
  let retries = 0;
  let account: Omit<DriveTickAccount, 'ticksConsumed' | 'ticksRemaining' | 'exhausted'> | null = null;
  const accountAt = (consumed: number, exhausted: boolean): DriveTickAccount | null => (account === null ? null : {
    ...account, ticksConsumed: consumed, ticksRemaining: Math.max(0, account.allowance - consumed), exhausted,
  });
  const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
  const stallCause = async (state: string): Promise<string | null> => {
    if (state !== 'VERIFYING') return null;
    const decisions = await input.store.decisionsForRun(input.runId, input.projectId);
    const nonAccept = decisions.filter((decision) => decision.action !== 'ACCEPT');
    return nonAccept.length === 0 ? null
      : `completion requires every task's current verification decision to be effectively accepted; this run's durable history holds these non-ACCEPT decisions (a REPAIR may already be superseded through its repair lineage): ${nonAccept.map((decision) => `${decision.action}(${decision.reasonCode})`).join(', ')}`;
  };
  let lastState = 'UNKNOWN';
  for (let tick = 1; budget !== null || tick <= maxTicks; tick += 1) {
    if (budget !== null) {
      const now = juliusTickAllowance({
        budget, tasks: await input.store.tasksForRun(input.runId, input.projectId), retries,
      });
      account = {
        plannedTicks: budget.plannedTicks, hardMaxTicks: budget.hardMaxTicks,
        allowance: override === null ? now.allowance : Math.min(now.allowance, override),
        beyondMainPath: now.beyondMainPath, disagreementTicks: now.disagreementTicks,
        architectureTicks: now.architectureTicks,
        retries: now.retries, override, reason: budget.reason,
      };
      if (tick > account.allowance) {
        return failForTickBudget({ input, consumed: tick - 1, account: accountAt(tick - 1, true)! });
      }
    }
    // THE SWEEP IS THE KERNEL'S. This driver used to call `recover` before
    // every tick, which made a store-level guarantee depend on one composition
    // root remembering to make it — and it passed the default limit of 100
    // where `tick` passes the claim limit, so the bound the comments advertised
    // was not the bound the live path applied. `tick` sweeps first now.
    const report = await input.loop.tick({ projectId: input.projectId });
    retries += report.outcomes.filter((outcome) => outcome.kind === 'RETRY').length;
    const run = await input.store.loadRun(input.runId, input.projectId);
    lastState = run?.state ?? 'UNKNOWN';
    if (run !== null && terminal.has(run.state)) {
      return { state: run.state, ticks: tick, stalled: false, haltCause: null, tickAccount: accountAt(tick, false) };
    }
    if (report.claimed === 0) {
      const advance = await input.loop.advanceRun(input.runId, input.projectId);
      const after = await input.store.loadRun(input.runId, input.projectId);
      lastState = after?.state ?? lastState;
      if (after !== null && terminal.has(after.state)) {
        return { state: after.state, ticks: tick, stalled: false, haltCause: null, tickAccount: accountAt(tick, false) };
      }
      /**
       * A RESUMED VERIFICATION IS PROGRESS, even when the run state did not
       * move. `advanceRun` runs any verification the run is owed — the window a
       * crash between accepting a worker's result and recording the decision
       * leaves open — and an accepted plan releases a BLOCKED build while the
       * run stays READY. Reading `changed` alone would call that a stall on the
       * very tick that unblocked the run, and the mission would be abandoned
       * one step from finishing.
       */
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) {
        return { state: lastState, ticks: tick, stalled: true, haltCause: await stallCause(lastState), tickAccount: accountAt(tick, false) };
      }
    }
  }
  return { state: lastState, ticks: maxTicks, stalled: true, haltCause: await stallCause(lastState), tickAccount: null };
}

/**
 * THE TICK BUDGET FOR A SUBMITTED RUN, from its seeded work units and the
 * verification policy the runtime was assembled with. One derivation, read by
 * the drive that enforces it and by the entrypoint that prints it before any
 * provider is asked.
 */
export async function liveTickBudgetFor(input: {
  readonly store: JuliusRuntimeStore;
  readonly runId: string;
  readonly projectId: string;
  readonly verification: JuliusVerificationPolicy;
}): Promise<JuliusTickBudget> {
  return planJuliusTickBudget({
    units: (await input.store.tasksForRun(input.runId, input.projectId))
      .filter((task) => task.parentTaskId === null && !task.taskType.startsWith('review:'))
      .map((task) => task.role),
    repairRounds: input.verification.maxRepairRounds,
    segmentCeiling: input.verification.maxCoderSegments ?? JULIUS_DEFAULT_MAX_CODER_SEGMENTS,
    reviewerRequired: input.verification.reviewerRequired,
    taskAttempts: MAX_TASK_ATTEMPTS,
  });
}

/**
 * THE ALLOWANCE RAN OUT, AND THE RUN SAYS SO.
 *
 * Attempt 4 stopped at its ceiling with the run row READY and nothing on the
 * ledger, so the evidence could only show a run that had stopped. The run now
 * moves to FAILED along a legal path, and a `run.failed` row carries the
 * numbers: planned, allowance, consumed, what the run added, the hard maximum
 * and any override. If the move cannot be made, the state is reported as it
 * stands and no failure is claimed.
 */
async function failForTickBudget(args: {
  readonly input: { readonly store: JuliusRuntimeStore & JuliusRecoveryDriver; readonly runId: string; readonly projectId: string };
  readonly consumed: number;
  readonly account: DriveTickAccount;
}): Promise<DriveOutcome> {
  const { input, account } = args;
  const reasonCode = 'tick_budget_exhausted';
  const safeSummary = `The run consumed its whole tick allowance (${String(account.allowance)} of a planned ${String(account.plannedTicks)}, hard maximum ${String(account.hardMaxTicks)}) without reaching a terminal state.`;
  let current = await input.store.loadRun(input.runId, input.projectId);
  for (let attempt = 0; attempt < 3 && current !== null && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.state); attempt += 1) {
    const path = planRunStatePath(current.state, 'FAILED');
    if (path.length === 0) break;
    try {
      for (const [index, step] of path.entries()) {
        const last = index === path.length - 1;
        current = await input.store.transition({
          commandId: `tick-budget:${input.runId}:${String(current.version)}:${step}`,
          runId: input.runId, projectId: input.projectId, expectedVersion: current.version, to: step,
          reasonCode: last ? reasonCode : 'PASSED_THROUGH',
          safeSummary: last ? safeSummary : `Run passed through ${step} on the way to FAILED.`,
          evidenceIds: [], occurredAt: new Date().toISOString(),
        });
      }
    } catch {
      current = await input.store.loadRun(input.runId, input.projectId);
    }
  }
  const state = current?.state ?? 'UNKNOWN';
  if (state === 'FAILED') {
    await input.store.appendEvent({
      eventId: `event:${randomUUID()}`, runId: input.runId, projectId: input.projectId, type: 'run.failed',
      taskId: null, workerId: null, correlationId: `tick-budget:${input.runId}`, causationId: null,
      occurredAt: new Date().toISOString(),
      facts: {
        reasonCode, plannedTicks: account.plannedTicks, allowance: account.allowance, ticksConsumed: args.consumed,
        hardMaxTicks: account.hardMaxTicks, beyondMainPath: account.beyondMainPath,
        disagreementTicks: account.disagreementTicks, architectureTicks: account.architectureTicks,
        retries: account.retries,
        override: account.override, tickBudgetReason: account.reason,
      },
    });
  }
  return {
    state, ticks: args.consumed, stalled: state !== 'FAILED',
    haltCause: state === 'FAILED' ? `${reasonCode}: ${safeSummary}` : null,
    tickAccount: account,
  };
}
