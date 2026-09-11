/**
 * THE THREE LIVE WORKERS, AS JULIUS PROVIDER ADAPTERS.
 *
 * Each factory wraps an EXISTING, already-proven provider implementation —
 * `runGptArchitect` (OpenAI Responses API), `runHostedCodingAgent` (Claude
 * Agent SDK), `runHermesReview` (local Hermes binary) — behind Julius's
 * provider-neutral `JuliusProviderAdapter` port. No provider client is
 * duplicated here and no provider payload leaves this module: adapters return
 * structured results and evidence whose summaries are composed from counts,
 * identifiers and observed model names, never from response bodies.
 *
 * WORKERS DO NOT ORCHESTRATE. An adapter receives a task and a context id,
 * answers with a result, and holds no reference to the registry, the router,
 * another adapter, or the run loop. The only cross-task material a worker can
 * see arrives through the two composition-owned handoffs below, both written
 * by Julius-dispatched work and both read-only to the next worker.
 *
 * WHY A CONTEXT HANDOFF EXISTS. The runtime compiles and persists a context
 * snapshot BEFORE dispatch, then hands the adapter only `{taskId, contextId}`.
 * PostgreSQL stores the snapshot's bounded metadata, not its packet text, so a
 * live adapter must receive the compiled packet from the same process that
 * persisted it. `CompiledContextSource` is that handoff: the composition wraps
 * the store's `persist` and retains each full snapshot under its contextId.
 */

import { classifyHostedFailure } from '../hosted-coding-agent/hosted-failure-reason';
import { createHash } from 'node:crypto';
import type { JuliusContractReviewCharge } from '../../src/relay/mission/julius/julius-task-contract';
import {
  JuliusDispatchError,
  reviewChargeFor,
  reviewStageOf,
  reviewSubjectTaskId,
  type JuliusContextSnapshot,
  type JuliusDispatchAllocation,
  type JuliusProviderAdapter,
  type JuliusProviderResult,
  type JuliusReviewStage,
  type JuliusReviewRequirement,
  type JuliusWorker,
} from '../../src/relay/mission/julius';
import {
  runGptArchitect,
  type GptArchitectConfig,
  type GptRunOutcome,
} from '../../src/relay/connectors/gpt-architect';
import { validateArchitectPlan, type ArchitectPlanReasonCode } from '../../src/relay/mission/prompt-architect/prompt-architect-plan';
import { sanitizeJuliusGuidanceProposal } from '../../src/relay/mission/julius/julius-continuous-lifecycle';
import { ARCHITECT_GUIDANCE_SCHEMA, ARCHITECT_GUIDANCE_SCHEMA_NAME } from '../../src/relay/connectors/gpt-architect/guidance-schema';
import {
  loadHostedQuery,
  runHostedCodingAgent,
  type HostedQueryFn,
  type HostedRunOutcome,
} from '../hosted-coding-agent/hosted-runner';
import { DEFAULT_HOSTED_LIMITS, hostedLimitsForAllocation, type HostedLimits } from '../hosted-coding-agent/hosted-envelope';
import type { HostedObservation } from '../hosted-coding-agent/hosted-observation';
import {
  runHermesReview,
  type HermesConfig,
  type HermesOutcome,
  type HermesReviewDiagnostics,
  type ReviewPacket,
} from '../hermes-reviewer';
import { UNKNOWN_USAGE, type HermesUsage } from '../reviewer-harness/hermes/runner';
import type { ShellEffectPort } from './executor-effects';

/* ------------------------------------------------------------- handoffs */

/** Compiled context snapshots, keyed by contextId, same-process only. */
export interface CompiledContextSource {
  snapshotFor(contextId: string): JuliusContextSnapshot | null;
}

/**
 * Bounded text artifacts produced by one Julius-dispatched task and read by a
 * later one (the architect's plan, the coder's diff and base revision). Keys
 * are runId-scoped; values are capped so a runaway payload cannot grow the
 * process without bound.
 */
export interface LiveArtifactExchange {
  put(ref: string, text: string): void;
  get(ref: string): string | null;
}

export const ARTIFACT_TEXT_CAP = 256 * 1024;

export function createLiveArtifactExchange(): LiveArtifactExchange {
  const values = new Map<string, string>();
  return {
    put(ref, text) { values.set(ref, text.slice(0, ARTIFACT_TEXT_CAP)); },
    get(ref) { return values.get(ref) ?? null; },
  };
}

export const planRef = (runId: string): string => `plan:${runId}`;
/** Per SUBJECT TASK, not per run: one mission can hold several guidance packets. */
export const guidanceRef = (taskId: string): string => `guidance:${taskId}`;
export const diffRef = (runId: string): string => `diff:${runId}`;
export const baseRevisionRef = (runId: string): string => `base:${runId}`;
export const testOutputRef = (runId: string): string => `test-output:${runId}`;

/* -------------------------------------------------------------- helpers */

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * A summary that may quote worker-derived text is bounded and scrubbed of
 * secret-shaped substrings before it can reach evidence or an event. This is
 * defense in depth on top of the callers' own redaction, not a substitute.
 */
export function safeClaim(text: string, cap = 240): string {
  return text
    .replace(/\b(sk|xai|rk|pk)-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]')
    .replace(/[\x00-\x1f]+/g, ' ')
    .slice(0, cap);
}

function requireSnapshot(contexts: CompiledContextSource, contextId: string): JuliusContextSnapshot {
  const snapshot = contexts.snapshotFor(contextId);
  if (snapshot === null) {
    // The pipeline persists the snapshot immediately before dispatch in this
    // same process, so a miss means the handoff itself is broken — refuse
    // rather than dispatch a provider against a context nobody compiled.
    throw new JuliusDispatchError('INVALID_REQUEST', false, 'Compiled context is not available to the adapter.', 'context_unavailable');
  }
  return snapshot;
}

const packetText = (snapshot: JuliusContextSnapshot): string =>
  snapshot.packet.blocks.map((block) => block.text).join('');

/** The mission context WITHOUT the findings Julius compiled for a repair. */
const missionText = (snapshot: JuliusContextSnapshot): string =>
  snapshot.packet.blocks.filter((block) => block.kind !== 'FINDING').map((block) => block.text).join('');

const nowIso = (): string => new Date().toISOString();

/**
 * WHAT A POST-LOCK ARCHITECT IS ACTUALLY GIVEN.
 *
 * A guidance dispatch is worth nothing if the architect cannot see the state it
 * is advising about, and ADR-021's proofs could not see that gap because they
 * all assert that the ASK happened. Everything here is already typed mission
 * state Julius owns:
 *
 *   - the compiled packet, which carries the objective, the requirements, the
 *     constraints, the criteria AND the coder's question — the question travels
 *     as an ordinary Project Brain HANDOFF entry scoped to this task, so there
 *     is no prose side channel and no second compiler;
 *   - the LOCKED TERMS, from the charge Julius proved at the gate and handed
 *     down. The architect reads the agreement rather than being told about it;
 *   - the plan the mission was built from, when this process still holds it.
 *
 * Nothing is fetched here and nothing is inferred. An adapter that reached into
 * the store for context would be choosing what it is advising against, which is
 * the same inversion the reviewer's charge exists to prevent.
 */
function guidanceInput(
  snapshot: JuliusContextSnapshot,
  dispatch: { readonly taskType?: string; readonly contract?: JuliusContractReviewCharge },
  priorPlan: string | null,
): string {
  const charge = dispatch.contract;
  const terms = charge === undefined ? [] : [
    '--- THE LOCKED MISSION CONTRACT (these terms are closed; advise within them) ---',
    `CONTRACT: ${charge.binding.contractId} revision ${charge.binding.contractRevision}`,
    `BINDING DIGEST: ${charge.binding.bindingDigest}`,
    `STAGE: ${charge.stage}`,
    `OBJECTIVE: ${charge.objective}`,
    `RESPONSIBILITY BOUNDARY: ${charge.responsibilityBoundary}`,
    `STOPPING CONDITION: ${charge.stoppingCondition}`,
    `IN SCOPE: ${charge.inScope.join(' | ') || '(none stated)'}`,
    `OUT OF SCOPE: ${charge.outOfScope.join(' | ') || '(none stated)'}`,
    `PERMITTED PATHS: ${charge.permittedPaths.join(' | ') || '(none stated)'}`,
    `PROHIBITED ACTIONS: ${charge.prohibitedActions.join(' | ') || '(none stated)'}`,
    `REQUIRED CHECKS: ${charge.requiredChecks.join(' | ') || '(none stated)'}`,
    `REQUIRED EVIDENCE: ${charge.requiredEvidence.join(' | ') || '(none stated)'}`,
    'BLOCKING ACCEPTANCE CRITERIA (affectedCriterionIds may name these and may invent none):',
    ...charge.blockingCriteria.map((line) => `  ${line}`),
    `FAILURE CONDITIONS: ${charge.failureConditions.join(' | ') || '(none stated)'}`,
  ];
  const plan = priorPlan === null ? [] : [
    '--- THE ACCEPTED PLAN THIS MISSION IS BEING BUILT FROM (context, not terms) ---',
    priorPlan,
  ];
  return [
    packetText(snapshot),
    ...(terms.length === 0 ? [] : [terms.join('\n')]),
    ...plan,
  ].join('\n\n');
}


/* ----------------------------------------------------- prompt architect */

/**
 * WHAT THE SCHEMA CANNOT SAY, SAID HERE.
 *
 * Paid attempt #3 bought a real plan that satisfied the strict JSON schema and
 * was then refused by `validateArchitectPlan`. The schema constrains SHAPE: it
 * cannot require that a string be non-empty in a way this runtime has verified
 * the Responses API accepts, and it cannot express "do not claim work that has
 * not happened" at all. Those rules lived only in a validator the model was
 * never told about — so the charter is where they have to be stated, in the
 * model's own terms, before it writes.
 *
 * Each line below corresponds to a rule `validateArchitectPlan` enforces, and
 * `plan-schema-parity.test.ts` holds them together: a validator rule with no
 * charter sentence is a rule the model is refused for without being told.
 *
 * This states the RULES, never the answers. No fixture, no expected plan, and
 * no hidden reasoning is requested or exposed.
 */
const ARCHITECT_CHARTER = [
  'You are the Prompt Architect for a Relay mission run by Julius, the mission controller.',
  'Read the mission context below and produce the structured plan the output schema requires.',
  'You plan; you do not implement, review, or approve your own work.',
  'This is a PLAN ONLY. No work has been done yet and no file has been touched.',
  /**
   * THE BAN, STATED WITHOUT HANDING BACK THE BANNED STRINGS.
   *
   * The first version of this line quoted all four refused phrases verbatim,
   * and the schema then asks for `prohibitedActions` — so the most obedient
   * possible answer was to echo them straight back. Paid runs 34185920678 and
   * 34186711214 both died on `plan_false_work_claim`, on two independent
   * samples of the same mission, and neither could say where. The validator
   * now exempts the fields that ENUMERATE a condition, but a phrase echoed
   * into an implementation step or an assumption is still a claim and still
   * refused — so the charter stops supplying the text to echo.
   */
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

/**
 * WHAT THE ARCHITECT MAY SAY AFTER THE CONTRACT IS LOCKED.
 *
 * A plan is written to become the agreement. Guidance is written UNDER one that
 * is already closed, to a coder that is already working, and the difference is
 * the whole charter: the terms are not on the table.
 *
 * THE SCHEMA ALREADY MAKES A CONTRACT AMENDMENT UNSAYABLE — there is no
 * `objective` key, no `inScope`, no `permittedPaths`, no `budget` — so this text
 * does not repeat the field list. It says the one thing a schema cannot: that
 * discovering the agreement is wrong is a legitimate finding to REPORT, and
 * never something to route around. `unresolvedQuestions` is where that goes, and
 * Julius carries it into the formal revision path if it holds.
 *
 * It does not hand back the banned strings, for the reason
 * `ARCHITECT_CHARTER` learned on two paid runs: a charter that quotes the
 * phrases it refuses, beside a schema asking for prose, makes echoing them the
 * most obedient possible answer.
 */
const ARCHITECT_GUIDANCE_CHARTER = [
  'You are the Prompt Architect for a Relay mission run by Julius, the mission controller.',
  'The Mission Contract below is LOCKED and a Coding Agent is already working under it.',
  'You are being asked for GUIDANCE at a specific checkpoint, not for a plan and not for a revision.',
  'Answer the question that was actually asked, using the mission state provided.',
  'THE TERMS ARE NOT ON THE TABLE. You may not restate, widen, narrow, reinterpret or replace the',
  'objective, the scope, the permitted paths, the acceptance criteria, the budget or any other',
  'contract term; the output schema gives you nowhere to put one, and Julius refuses a packet that',
  'tries. Advise on HOW to proceed within the agreement as it stands.',
  'If the agreement itself looks wrong or insufficient, SAY SO in unresolvedQuestions and stop there.',
  'That is a legitimate and useful finding. Julius decides whether it becomes a formal contract',
  'revision, which is independently challenged and re-locked; you do not get to make that change',
  'yourself, and advice written as though you had is worse than no advice.',
  'affectedCriterionIds may NAME acceptance criteria the locked contract already carries.',
  'It may not invent one — an id the contract does not hold is refused.',
  'additionalProhibitions may only NARROW what the coder may do. A prohibition restricts; it can',
  'never grant permission the agreement withheld.',
  'Every reference must say WHERE you read something — a repository path, a specification section,',
  'a document locator — and how well you corroborated it. Never quote a retrieved body back:',
  'the locator and your judgement are what travel, not the source text.',
  'Be concrete and bounded. Guidance a coder cannot act on is guidance that cost a dispatch for nothing.',
].join(' ');

const ARCHITECT_REVISION_CHARTER = [
  'This is a PLAN REVISION. The Independent Reviewer rejected the prior plan for the REVIEW FINDING entries',
  'in the mission context. Keep the mission objective and every acceptance criterion exactly as stated;',
  'revise the plan so that each finding is addressed, and say in the plan how each one was addressed.',
  'Do not claim any finding is resolved by implementation work — none has happened.',
  'The revised plan stays in the future tense throughout, exactly as the first one had to.',
].join(' ');

/**
 * WHICH REVIEW THIS IS. Read from the task type Julius dispatches with —
 * `review:plan`, `review:build`, `review:repair:plan`, `review:repair:build` —
 * by the domain's own `reviewStageOf`. The first version of this read a diff
 * artifact's existence, the second parsed the task id; both were guesses
 * dressed as facts, and the first one recorded every plan review as a build
 * review. A dispatch whose stage cannot be read is refused, not reviewed.
 */
/**
 * A CORRECTION IS A SPEND, AND A SPEND NEEDS BUDGET.
 *
 * The architect's allocation is a RESERVATION against the run's budget rather
 * than a per-call cap — only the hosted coder is handed its ceiling as a limit
 * — so two calls inside one dispatch cannot exceed a reservation already made.
 * What they can do is buy a second call for a mission that has nothing left,
 * which is the ceiling being ignored rather than respected.
 *
 * So a dispatch whose allocation says the mission is exhausted gets its first
 * ask and no correction, and the original refusal surfaces exactly as it did
 * before this file learned to re-ask. An adapter handed no allocation at all
 * behaves as it always has: Julius did not bound this dispatch, and inventing a
 * bound here would be this file deciding a budget it cannot see.
 */
const correctionAffordable = (allocation: JuliusDispatchAllocation | undefined): boolean =>
  allocation === undefined || allocation.usdMicros > 0;

/**
 * HOW TO ASK AGAIN FOR A REVIEW THAT ARRIVED IN THE WRONG SHAPE.
 *
 * Keyed on the CLOSED failure shape the Hermes reader assigned, so nothing the
 * model wrote travels back into the next prompt — the text was malformed, and
 * quoting it invites the same answer. A shape with no correction is one a
 * second ask cannot fix, and null is what keeps the re-ask from being bought.
 */
const REVIEW_ATTEMPT_LIMIT = 2;

function reviewCorrectionFor(shape: string): string | null {
  switch (shape) {
    case 'review_json_absent':
      return 'CORRECTION — your previous answer contained no JSON report at all. Emit exactly one JSON object in the shape given above, with no prose before or after it and no code fence.';
    case 'review_json_unparseable':
      return 'CORRECTION — your previous answer contained a JSON object that could not be parsed. Emit exactly one WELL-FORMED JSON object in the shape given above: every key and string double-quoted, no trailing commas, no comments, and no backslash escape other than the ones JSON defines.';
    case 'review_json_ambiguous':
      return 'CORRECTION — your previous answer contained MORE THAN ONE object carrying a verdict, so which one was your review could not be known. Emit exactly one JSON object, and quote no other object containing a verdict anywhere in your answer.';
    case 'review_verdict_missing':
      return 'CORRECTION — your previous answer contained JSON with no verdict. Emit exactly one JSON object whose "verdict" is one of "approved", "changes_required" or "unable_to_review".';
    case 'review_verdict_invalid':
      return 'CORRECTION — your previous answer carried a verdict outside the permitted set. The "verdict" must be exactly one of "approved", "changes_required" or "unable_to_review", spelled in lower case.';
    case 'review_summary_missing':
    case 'review_summary_invalid':
      return 'CORRECTION — your previous answer had no usable "summary". Emit exactly one JSON object whose "summary" is a non-empty string stating what you reviewed and what you concluded.';
    default:
      // A timeout, a 503, a refused credential, a dead process, an oversized
      // answer, a rejected request, a classifier disagreement: none is a shape
      // a re-ask repairs, and each is handled where it is classified.
      return null;
  }
}

const reviewStageOfDispatch = (taskType: string | undefined): JuliusReviewStage | null =>
  (taskType === undefined ? null : reviewStageOf(taskType));

/**
 * WHAT A HARNESS ESTIMATED, IN MICRO-DOLLARS, OR NOTHING.
 *
 * Hermes writes an `estimated_cost` to its usage file and `parseUsageFile`
 * carries it as a STRING with its currency, deliberately, so nothing turns it
 * into a computed figure Relay would then have to defend. The same narrowing
 * `reviewerHarnessMeterAdapter` already applies is applied here — an integer
 * micro amount in USD, or null — and the result is never written to a spend
 * column. A price a harness worked out from its own table is not a bill.
 */
const harnessEstimateMicros = (usage: { costMicros: string | null; currency: string | null }): number | null =>
  usage.costMicros !== null && usage.currency === 'USD'
    && /^\d+$/.test(usage.costMicros) && Number(usage.costMicros) <= Number.MAX_SAFE_INTEGER
    ? Number(usage.costMicros)
    : null;

/**
 * THE JULIUS-SIDE REVIEWER RECORD: what the transport observed, plus what only
 * the dispatch knows.
 *
 * The transport reports its own lifecycle and cannot know which STAGE Julius
 * asked it to review or how many times Julius asked; the dispatch knows both
 * and neither used to reach the durable row on a success. The two instants are
 * carried explicitly rather than left to be recovered by subtracting an
 * elapsed time from an event's `occurred_at` across two tables.
 *
 * `elapsedMs` is derived ONLY where the transport measured none — the remote
 * and provider paths run no process and time nothing — and it is derived from
 * two instants that are both on the same row, so the arithmetic is checkable
 * instead of asserted.
 */
const reviewerDiagnostics = (input: {
  /**
   * `HermesOutcome` requires this, and the runner is INJECTABLE — so a harness
   * or an older transport can still hand back an outcome without it. Throwing
   * here would turn a review that was bought and answered into a dispatch
   * failure, which is the most expensive possible way to report a missing
   * field. Absent means "this transport observed nothing", so nothing is
   * written for it and the evidence dump, which keys on `diag_transport`,
   * skips the row rather than showing a wall of nulls.
   */
  readonly diagnostics: HermesReviewDiagnostics | undefined;
  readonly stage: string;
  readonly reviewAttempts: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly usage?: HermesUsage;
}): Record<string, unknown> => {
  const started = input.startedAt === undefined ? Number.NaN : Date.parse(input.startedAt);
  const completed = input.completedAt === undefined ? Number.NaN : Date.parse(input.completedAt);
  const estimated = input.usage === undefined ? null : harnessEstimateMicros(input.usage);
  const observed = input.diagnostics !== null && typeof input.diagnostics === 'object' ? input.diagnostics : undefined;
  return {
    ...observed,
    stage: input.stage,
    reviewAttempts: input.reviewAttempts,
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
    ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
    elapsedMs: observed?.elapsedMs
      ?? (Number.isFinite(started) && Number.isFinite(completed) && completed >= started ? completed - started : null),
    /* WHAT IT COST, AND ON WHOSE AUTHORITY. This transport is never billed
       directly: Hermes talks to the provider and reports its own arithmetic, so
       the strongest honest basis here is ESTIMATED — and UNKNOWN when even that
       is absent. Neither is ever `PROVIDER_REPORTED`, and neither is zero. */
    costBasis: estimated === null ? 'UNKNOWN' : 'ESTIMATED',
    estimatedCostUsdMicros: estimated,
    inputTokens: input.usage?.inputTokens ?? null,
    outputTokens: input.usage?.outputTokens ?? null,
  };
};

/**
 * THE FACTS BESIDE A CODER'S ATTEMPT — the SAME facts whether it refused or
 * finished.
 *
 * This used to be built inside the refusal branch, so a hosted session that
 * completed left no diagnostics row at all: no turn count, no tool count, no
 * permission denials, no served model, and — on the one worker that reports a
 * real dollar figure — no `cost_source` saying the figure was the runtime's
 * own. Live Run 3's coder succeeded and its whole lifecycle reached the bundle
 * only as a sentence in `evidence.tsv`.
 *
 * Extracted rather than duplicated on purpose: a fact present on one ending and
 * absent on the other reads as a bug in the record, and two hand-kept copies is
 * how that happens.
 */
const hostedCoderDiagnostics = (input: {
  readonly taskType: string | undefined;
  readonly requestedModel: string | null;
  readonly observed: HostedObservation | null;
  readonly limits: HostedLimits;
  readonly outcome: 'succeeded' | 'failed';
  /**
   * The runner's own classification of the error it caught, when it caught one.
   * It is strictly better evidence than the final text: on
   * `coder_provider_error_after_init` the runtime threw INSTEAD of finishing,
   * so the cause is in the thrown error and the final text is whatever the
   * stream had managed to emit before it.
   */
  readonly failureReason?: string | null;
}): Record<string, unknown> => {
  const observed = input.observed;
  return {
    /** Stated, so a successful row is never read as a failure nobody classified. */
    outcome: input.outcome,
    /**
     * WHY IT FAILED, in a closed vocabulary — never the runtime's own words.
     *
     * Paid Mission 5's rerun stopped six turns into a twenty-six turn envelope
     * with `is_error: true`, changed nothing, cost $0.885661, and the record
     * said `coder_provider_error_after_init` and one fixed sentence. Nothing in
     * any artifact said why, and the cause is now unrecoverable.
     *
     * `classifyHostedFailure` MATCHES the runtime's final text and returns a
     * constant from its own vocabulary; no substring of that text can reach
     * this row. The fixed sentence in `hosted-runner.ts` stays exactly as it is,
     * for exactly the reason it gives.
     *
     * NULL ON SUCCESS, deliberately: a run that worked has no failure reason,
     * and classifying a successful summary would read the word "error" in it as
     * one.
     */
    failureReason: input.outcome === 'failed'
      ? input.failureReason ?? classifyHostedFailure(observed?.finalText ?? null)
      : null,
    // THE ROUND THAT SPENT THE MONEY. Fixing this to 'build' made a
    // repair round's cost refusal indistinguishable from the first
    // build's in the very artifact that exists to tell them apart.
    stage: input.taskType === 'repair:build' ? 'repair:build' : 'build',
    transport: 'hosted',
    provider: 'anthropic',
    requestedModel: input.requestedModel,
    servedModel: observed?.actualModel ?? null,
    responseId: observed?.sessionId ?? null,
    numTurns: observed?.numTurns ?? null,
    // INVOCATIONS, not distinct names: `toolsUsed` deduplicates, so ten
    // edits and one read would have been reported as 2.
    toolUseCount: observed?.toolInvocations ?? null,
    /**
     * ONLY WHEN A RESULT ARRIVED. `permissionDenials` starts at 0 and is
     * populated by the result message alone, so reporting it after a
     * timeout or a cancellation would assert that no denial occurred —
     * evidence the envelope held — on precisely the runs where the
     * terminal data never came. `resultSubtype` is null until that
     * message, which is how this knows.
     */
    permissionDenials: observed?.resultSubtype === null || observed === null
      ? null : observed.permissionDenials,
    resultSubtype: observed?.resultSubtype ?? null,
    isError: observed?.isError ?? null,
    // A COUNT of the runtime's final text, never the text.
    outputBytesObserved: observed?.finalText === null || observed?.finalText === undefined
      ? null : Buffer.byteLength(observed.finalText, 'utf8'),
    /**
     * AN OBSERVED SUCCESSFUL RESULT, not merely a runtime that started.
     * `initSeen && isError !== true` is true after a timeout or a
     * provider exception — `isError` is still null then — so it claimed
     * an implementation existed on exactly the partial runs these
     * diagnostics exist to tell apart.
     */
    implementationPresent: observed === null || observed.isError === null
      ? null : observed.isError === false,
    /**
     * THE MONEY, BESIDE THE REFUSAL. Paid run 34037313976 was refused for
     * cost and the amount lived only in a message nothing persisted.
     * Unknown stays Unknown: a runtime that reported no cost reads null
     * with `costSource: unavailable`, never zero.
     */
    costUsdMicros: observed?.usage.totalCostUsd === null || observed?.usage.totalCostUsd === undefined
      ? null : Math.round(observed.usage.totalCostUsd * 1_000_000),
    costCeilingUsdMicros: input.limits.maxCostCents * 10_000,
    costSource: observed?.usage.source ?? null,
    /**
     * DID THE RUNTIME EVER START? A run that never launched billed
     * nothing; one that launched and was aborted — the timeout, which is
     * the case a cost is LEAST likely to be reported for, because the
     * SDK reports cost only in its final result message — billed an
     * unknown amount. The ledger needs that difference to decide whether
     * a hand-back may free the hold.
     */
    runtimeStarted: observed?.initSeen ?? false,
    /**
     * HOW THE COST CAME TO BE KNOWN, in the vocabulary all three roles answer
     * in. `costSource` above is the hosted runtime's own word for itself
     * (`runtime_reported` / `unavailable`) and says nothing a reviewer or an
     * architect could also say. This is the one Live Run 3's ledger needed: it
     * settled one component with a figure and three with nothing, and had no
     * column to tell "billed $0.61" from "reported nothing".
     *
     * `PROVIDER_REPORTED` requires BOTH the runtime's own attestation and an
     * actual figure. A basis without its number would assert a report nobody
     * made, and every reader downstream would count the component as accounted
     * for.
     */
    costBasis: observed?.usage.source === 'runtime_reported'
      && observed.usage.totalCostUsd !== null && observed.usage.totalCostUsd !== undefined
      ? 'PROVIDER_REPORTED' : 'UNKNOWN',
    inputTokens: observed?.usage.inputTokens ?? null,
    outputTokens: observed?.usage.outputTokens ?? null,
  };
};

/**
 * THE SAFE FACTS BESIDE A PLAN FAILURE.
 *
 * `plan_validation_failed` named the boundary and nothing else, so paid attempt
 * #3 could not say WHICH of fifteen rules the plan broke. These are structural
 * only — a closed reason code, booleans, a byte count, and identifiers the
 * provider itself returned. No plan text, no prompt, no provider body.
 */
/**
 * EVERY FACT THE PROVIDER'S OWN ANSWER CARRIES, in one place, so that a call
 * site reports all of them or none.
 *
 * `planDiagnostics` takes eighteen optional fields, and six call sites each
 * chose a subset by hand. Only ONE — the connector-failure path — passed the
 * whole provider picture. The three refusal sites (unparseable JSON, guidance
 * invalid, plan invalid) passed no tokens at all, so a plan that was BOUGHT and
 * then thrown away recorded nothing about what it cost; and both success sites
 * omitted the elapsed time, the provider's status, the total and reasoning
 * tokens and the ceiling, so a run that worked left THINNER evidence than one
 * that failed. That is the wrong way round: the paid proof reads the successful
 * run.
 *
 * Nothing here is new information. Every field was already on the outcome and
 * already in scope at every site; what was missing was a reason each site could
 * not quietly report a subset. Spreading one constructor is that reason, and
 * `architect-diagnostics.test.ts` fails when a site stops doing it.
 */
const providerFacts = (
  outcome: GptRunOutcome,
  startedAtMs: number,
  maxOutputTokens: number,
): {
  readonly servedModel: string | null;
  readonly responseId: string | null;
  readonly providerStatus: string | null;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly totalTokens: number | null;
  readonly maxOutputTokens: number;
  readonly incompleteReason: string | null;
  readonly elapsedMs: number;
} => ({
  // The response is the authority for what answered, never the request.
  servedModel: outcome.actualModel ?? null,
  responseId: outcome.responseId ?? null,
  // A success carries the provider's `status` under its own name; a failure
  // carries it as `providerStatus`, present only when the provider answered.
  providerStatus: (outcome.ok ? outcome.status : outcome.providerStatus) ?? null,
  inputTokens: outcome.usage?.inputTokens ?? null,
  cachedInputTokens: outcome.usage?.cachedInputTokens ?? null,
  outputTokens: outcome.usage?.outputTokens ?? null,
  reasoningTokens: outcome.usage?.reasoningTokens ?? null,
  totalTokens: outcome.usage?.totalTokens ?? null,
  // The ceiling in force, so "it ran out" stays a comparison rather than a claim.
  maxOutputTokens,
  // A success is by definition not incomplete; null there is the true answer.
  incompleteReason: outcome.ok ? null : outcome.incompleteReason ?? null,
  elapsedMs: Date.now() - startedAtMs,
});

const planDiagnostics = (input: {
  readonly requestedModel: string | null;
  readonly servedModel?: string | null;
  readonly responseId?: string | null;
  readonly jsonParseable: boolean | null;
  /**
   * NULL MEANS VALIDATION WAS NEVER REACHED, and that is not the same claim as
   * `false`. A connector failure returns before Julius validates anything, and
   * writing `false` there says the plan was validated and rejected — a
   * different, and untrue, sentence about a paid run. Mission 4's first attempt
   * recorded exactly that.
   */
  readonly validationPassed: boolean | null;
  readonly validationReasonCode?: string | null;
  readonly validationField?: string | null;
  readonly validationClaimPhrase?: string | null;
  readonly attempts?: number | null;
  readonly outputBytes?: number | null;
  /** Named, so a plan that VALIDATED is a fact rather than the absence of a reason code. */
  readonly outcome?: 'succeeded' | 'failed';
  readonly inputTokens?: number | null;
  /** Billed at a different rate, so a token count without it is not the cost. */
  readonly cachedInputTokens?: number | null;
  readonly outputTokens?: number | null;
  /** Reasoning models spend these against the SAME ceiling as visible output. */
  readonly reasoningTokens?: number | null;
  /** The ceiling that was in force, so "it ran out" is checkable, not asserted. */
  readonly maxOutputTokens?: number | null;
  /** The provider's own word for why it stopped early — `max_output_tokens`. */
  readonly incompleteReason?: string | null;
  /** The provider's own `status` when it answered at all. */
  readonly providerStatus?: string | null;
  readonly totalTokens?: number | null;
  /** Wall clock across the provider call, measured by the adapter. */
  readonly elapsedMs?: number | null;
}): Record<string, unknown> => ({
  outcome: input.outcome ?? 'failed',
  stage: 'plan',
  transport: 'openai',
  provider: 'openai',
  requestedModel: input.requestedModel,
  // Evidence: the model the provider said answered, never the one requested.
  servedModel: input.servedModel ?? null,
  responseId: input.responseId ?? null,
  jsonDetected: input.jsonParseable,
  jsonParseable: input.jsonParseable,
  validationPassed: input.validationPassed,
  validationReasonCode: input.validationReasonCode ?? null,
  validationField: input.validationField ?? null,
  validationClaimPhrase: input.validationClaimPhrase ?? null,
  outputBytesObserved: input.outputBytes ?? null,
  /** How many provider calls this ONE dispatch bought, including the correction. */
  planAttempts: input.attempts ?? null,
  /**
   * THE ARCHITECT IS BILLED AND CANNOT SAY SO.
   *
   * Chat Completions reports tokens and never a price, so this role's honest
   * basis is `UNKNOWN` — every time, including on the plans that worked. Live
   * Run 3's architect reservation settled with no figure and the ledger could
   * not distinguish that from a free call. The tokens are recorded because they
   * are what a price recorded at the time would eventually measure; until such
   * a table exists, inventing the dollars is exactly what is forbidden.
   */
  costBasis: 'UNKNOWN',
  inputTokens: input.inputTokens ?? null,
  /**
   * CACHED INPUT IS BILLED DIFFERENTLY, and the connector has always read it
   * (`input_tokens_details.cached_tokens`) into `GptUsage` — where it then
   * reached no diagnostic at all. A row carrying `inputTokens` alone reports a
   * quantity at one price when some of it was bought at another, which is a
   * cost claim nobody can check.
   */
  cachedInputTokens: input.cachedInputTokens ?? null,
  outputTokens: input.outputTokens ?? null,
  /**
   * A FAILED CALL WAS STILL BILLED, and until Mission 4's first attempt these
   * three were only ever written on the SUCCESS path — the connector computed
   * the provider's usage and dropped it one line later on every failure. The
   * result was a paid architect call whose durable row said nothing about what
   * it consumed, and a `max_output_tokens` exhaustion that could only be
   * diagnosed by reading the connector's source. `reasoningTokens` is here
   * because on a reasoning model it is spent against the SAME ceiling as the
   * visible answer, so it is the number that explains the exhaustion; and the
   * ceiling itself is recorded beside it, so "it ran out of room" is a
   * comparison anyone can check rather than a claim they must take.
   */
  reasoningTokens: input.reasoningTokens ?? null,
  totalTokens: input.totalTokens ?? null,
  maxOutputTokens: input.maxOutputTokens ?? null,
  incompleteReason: input.incompleteReason ?? null,
  providerStatus: input.providerStatus ?? null,
  elapsedMs: input.elapsedMs ?? null,
});

/**
 * WHAT TO TELL THE ARCHITECT SO IT CAN FIX ITS OWN ANSWER.
 *
 * Built from the validator's CLOSED reason code and its STRUCTURAL path, never
 * from the model's own output. Feeding a refused plan back invites the model to
 * repeat it, and this file already learned that lesson once: the charter used
 * to quote the four banned phrases verbatim, and the most obedient possible
 * answer was to echo them back.
 *
 * A code with no correction is one a second attempt cannot plausibly fix, and
 * returning null for it is what keeps the retry from buying a second identical
 * refusal.
 */
function planCorrection(reasonCode: ArchitectPlanReasonCode, field: string | null): string | null {
  const at = field === null ? 'a required field' : `the field \`${field}\``;
  switch (reasonCode) {
    case 'plan_false_work_claim':
      return `CORRECTION — your previous answer was REFUSED: ${at} asserted that work had already been done. Nothing has been done: no file has been changed, no test has been run, and the Coding Agent has not started. Produce the plan again with every field in the FUTURE tense, describing what is to be done. Do not restate this correction anywhere in the plan.`;
    case 'objective_summary_empty':
    case 'assumption_statement_empty':
    case 'decision_statement_empty':
    case 'decision_rationale_empty':
    case 'handoff_objective_empty':
    case 'handoff_bounded_task_empty':
      return `CORRECTION — your previous answer was REFUSED: ${at} was empty or whitespace. Produce the plan again with every required string substantive and specific to this mission.`;
    case 'handoff_allowed_scope_empty':
      return 'CORRECTION — your previous answer was REFUSED: handoff.allowedFileScope named no path, which is an unbounded handoff. Produce the plan again, naming at least one concrete path drawn from the mission context.';
    case 'decision_pre_accepted':
      return 'CORRECTION — your previous answer was REFUSED: an architecture decision was marked accepted. Decisions are PROPOSALS and approval is not yours to give. Produce the plan again with every decision left unaccepted.';
    case 'plan_object_invalid':
    case 'handoff_missing':
    case 'required_array_invalid':
    case 'required_string_array_invalid':
    case 'decision_object_invalid':
    case 'handoff_array_invalid':
      return `CORRECTION — your previous answer was REFUSED: ${at} was not the shape the output schema requires. Produce the plan again with every required field present and of exactly the declared type.`;
    default:
      return null;
  }
}

/**
 * ONE CORRECTION, AND WHY IT IS WORTH A SECOND CALL.
 *
 * A plan that parses and then breaks one of the validator's own rules is a
 * SELF-INFLICTED, SELF-CORRECTABLE error, and until now it killed the mission
 * outright. Paid runs 34185920678 and 34186711214 each bought one `gpt-5.6-sol`
 * answer, had it refused over a single field, and ended FAILED with no coder,
 * no diff, no review and no repair — while Julius's repair loop exists for
 * exactly this shape of failure everywhere else in the run.
 *
 * STRICTLY ONE. A second refusal is the failure it always was, and the record
 * says how many attempts were bought so the call count and the cost stay true —
 * a retry nobody could see would be a spend nobody could account for.
 */
const PLAN_ATTEMPT_LIMIT = 2;

/**
 * MAP A VALIDATED ARCHITECT PLAN ONTO A CONTRACT PROPOSAL.
 *
 * Reads only fields `validateArchitectPlan` has already accepted, and reads them
 * defensively anyway: this runs on provider output, and a mapper that assumed
 * its input would be the thing that turned a validated plan into a crash.
 * `undefined` when nothing usable is there — Julius then keeps the revision it
 * has, which is the seeded one, and the run continues.
 *
 * ACCEPTANCE CRITERIA ARE DELIBERATELY NOT MAPPED. The architect states them as
 * prose with no mission ids, and the contract's criteria carry the MISSION's
 * ids; proposing them would be refused by `reviseJuliusTaskContract` anyway, and
 * sending a field that is always refused would make every plan log a refusal.
 */
function contractProposalFromPlan(plan: unknown): Record<string, unknown> | undefined {
  if (plan === null || typeof plan !== 'object') return undefined;
  const value = plan as Record<string, unknown>;
  const handoff = value.handoff !== null && typeof value.handoff === 'object'
    ? value.handoff as Record<string, unknown>
    : {};
  const strings = (raw: unknown): string[] | undefined =>
    (Array.isArray(raw) && raw.every((entry) => typeof entry === 'string') && raw.length > 0
      ? raw as string[]
      : undefined);
  const text = (raw: unknown): string | undefined =>
    (typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined);

  const proposal: Record<string, unknown> = {};
  const set = (key: string, candidate: unknown): void => { if (candidate !== undefined) proposal[key] = candidate; };
  set('objective', text(handoff.objective) ?? text(value.objectiveSummary));
  set('responsibilityBoundary', text(handoff.boundedTask));
  set('inScope', strings(handoff.allowedFileScope));
  set('permittedPaths', strings(handoff.allowedFileScope));
  set('prohibitedActions', strings(handoff.prohibitedActions) ?? strings(value.prohibitedActions));
  set('requiredChecks', strings(handoff.requiredTests) ?? strings(value.testPlan));
  set('expectedOutputs', strings(handoff.expectedEvidence));
  return Object.keys(proposal).length === 0 ? undefined : proposal;
}

export function createLiveArchitectAdapter(input: {
  readonly worker: JuliusWorker;
  readonly contexts: CompiledContextSource;
  readonly artifacts: LiveArtifactExchange;
  readonly config: GptArchitectConfig;
  readonly apiKey: string;
  /** Injectable for offline tests; defaults to the real connector. */
  readonly run?: typeof runGptArchitect;
}): JuliusProviderAdapter {
  if (!input.config.liveMode || input.config.model === null || !input.apiKey) {
    throw new Error('architect_adapter_requires_live_config');
  }
  const run = input.run ?? runGptArchitect;
  return {
    adapterId: input.worker.adapterId,
    async dispatch(dispatch): Promise<JuliusProviderResult> {
      const snapshot = requireSnapshot(input.contexts, dispatch.contextId);
      /**
       * A PLAN REVISION IS THE ARCHITECT'S JOB. `repair:plan` arrives here
       * because a repair inherits its subject's role; the prior plan is shown
       * beside the reviewer's findings (compiled into the context by Julius as
       * FINDING entries), the objective and criteria are unchanged, and the
       * revised plan replaces the artifact the Coding Agent will read.
       */
      const revising = dispatch.taskType === 'repair:plan';
      /**
       * THE ARCHITECT'S SECOND JOB. `guidance` and `repair:guidance` arrive here
       * because a guidance task is the architect's, and a repair of one inherits
       * its subject's role and stage. Everything below that is not explicitly
       * branched is shared with the plan path on purpose: one provider call
       * site, one failure classification, one credential boundary.
       */
      const guiding = dispatch.taskType === 'guidance' || dispatch.taskType === 'repair:guidance';
      const priorPlan = revising || guiding ? input.artifacts.get(planRef(snapshot.runId)) : null;
      if (revising && priorPlan === null) {
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'The prior architect plan is not available to this process; a plan revision without it is refused.', 'prior_plan_unavailable');
      }
      /**
       * GUIDANCE IS REFUSED WITHOUT THE LOCKED TERMS.
       *
       * Julius hands the charge down because it proved the lock at the gate. An
       * architect advising with no charge would be advising about an agreement
       * it cannot see, and every word of the guidance charter is about staying
       * inside terms it has to be able to read. Fail closed rather than write
       * advice against a contract nobody showed us.
       */
      if (guiding && dispatch.contract === undefined) {
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'Guidance was dispatched without the locked contract charge; advising against terms this process cannot read is refused.', 'guidance_contract_absent');
      }
      const baseCharter = guiding
        ? ARCHITECT_GUIDANCE_CHARTER
        : revising ? `${ARCHITECT_CHARTER} ${ARCHITECT_REVISION_CHARTER}` : ARCHITECT_CHARTER;
      let attempts = 0;
      let correction: string | null = null;
      for (;;) {
      attempts += 1;
      const startedAtMs = Date.now();
      const outcome: GptRunOutcome = await run({
        apiKey: input.apiKey,
        config: input.config,
        // The correction goes in the INSTRUCTIONS, beside the charter it did
        // not follow — not into the mission packet, which is Julius's own
        // compiled context and is not the place to record a model's mistake.
        instructions: correction === null ? baseCharter : `${baseCharter} ${correction}`,
        // THE ANSWER'S SHAPE FOLLOWS THE JOB. Absent means the plan schema, so
        // the plan path is byte-identical to what it was.
        ...(guiding ? { schema: { name: ARCHITECT_GUIDANCE_SCHEMA_NAME, schema: ARCHITECT_GUIDANCE_SCHEMA } } : {}),
        input: guiding
          ? guidanceInput(snapshot, dispatch, priorPlan)
          : revising
            ? [packetText(snapshot), '--- PRIOR PLAN (rejected by the Independent Reviewer; revise it against the REVIEW FINDING entries above) ---', priorPlan].join('\n\n')
            : packetText(snapshot),
        signal: dispatch.signal,
      });
      if (!outcome.ok) {
        /**
         * THE CLASS TRAVELS WITH THE CODE.
         *
         * Nine `JuliusErrorCode`s cannot separate a refusal from a malformed
         * response from a 500 — all three are WORKER_EXECUTION_FAILURE — and
         * the first paid mission failed on exactly that ambiguity: its durable
         * record held the code alone. The connector's own class is a fixed
         * machine token, so it is passed through and narrowed again by
         * `safeFailureClass` on the way into the error.
         */
        // Nothing was generated, so nothing about a plan is claimed: no JSON,
        // no validation, no byte count.
        /* THE PROVIDER EITHER ANSWERED OR IT DID NOT, and the two report
         * different things. A response with no usable text is a real
         * observation that no JSON was produced; a call that never reached the
         * provider observed nothing at all, and `false` would be a reading
         * nobody took. `validationPassed` is null either way: this path returns
         * before Julius validates, so it never had a verdict to report. */
        const responded = typeof outcome.responseId === 'string' && outcome.responseId.length > 0;
        const failed = planDiagnostics({
          // Absent when the call never reached the provider; never zero for a
          // call that did. `undefined` becomes null in the row, which is the
          // honest reading of "no answer to report".
          ...providerFacts(outcome, startedAtMs, input.config.maxOutputTokens),
          requestedModel: input.config.model,
          jsonParseable: responded ? false : null,
          validationPassed: null,
          attempts,
        });
        switch (outcome.failureClass) {
          case 'authentication_failed':
          case 'permission_denied':
            throw new JuliusDispatchError('AUTH_CONFIGURATION', false, 'Prompt Architect authentication or configuration failed.', outcome.failureClass, failed);
          case 'rate_limited':
            throw new JuliusDispatchError('RATE_LIMIT', true, 'Prompt Architect provider rate limit reached.', outcome.failureClass, failed);
          case 'timeout':
          case 'network_disconnected':
            throw new JuliusDispatchError('TIMEOUT', true, 'Prompt Architect provider timed out.', outcome.failureClass, failed);
          case 'model_unavailable':
            throw new JuliusDispatchError('PROVIDER_UNAVAILABLE', false, 'Prompt Architect model is unavailable.', outcome.failureClass, failed);
          default:
            throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Prompt Architect failed: ${outcome.failureClass}.`, outcome.failureClass, failed);
        }
      }
      let parsed: unknown;
      let parseFailed = false;
      try { parsed = JSON.parse(outcome.outputText); } catch { parseFailed = true; }
      if (parseFailed) {
        if (attempts < PLAN_ATTEMPT_LIMIT && correctionAffordable(dispatch.allocation)) {
          correction = 'CORRECTION — your previous answer was REFUSED: it was not parseable JSON. Answer with exactly one JSON object conforming to the output schema, and nothing else — no prose before or after it, and no code fence.';
          continue;
        }
        // Julius's own classes, not the provider's: the call succeeded and what
        // came back was unusable, which is a different repair from a 500.
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'Prompt Architect output was not parseable JSON.', 'unparseable_plan_json',
          planDiagnostics({
            ...providerFacts(outcome, startedAtMs, input.config.maxOutputTokens),
            requestedModel: input.config.model, jsonParseable: false, validationPassed: false,
            outputBytes: Buffer.byteLength(outcome.outputText, 'utf8'), attempts,
          }));
      }
      /**
       * THE DOMAIN'S OWN SANITIZER IS THE VALIDATOR.
       *
       * Asking `sanitizeJuliusGuidanceProposal` rather than writing a second
       * set of rules here is what keeps the adapter and the domain from ever
       * disagreeing about what a valid packet is — the failure
       * `plan-schema-parity.test.ts` exists because the plan path had two
       * readings and a paid run found the gap. The packet Julius stores is
       * still the one the PIPELINE sanitizes: this call is for a legible
       * refusal and a bounded correction, not for authority.
       */
      if (guiding) {
        if (sanitizeJuliusGuidanceProposal(parsed) === null) {
          if (attempts < PLAN_ATTEMPT_LIMIT && correctionAffordable(dispatch.allocation)) {
            correction = 'CORRECTION — your previous answer was REFUSED: it did not form a usable guidance packet. Answer with exactly one JSON object conforming to the output schema. Every listed field must be present, every string must be substantive, and no field naming a Mission Contract term may appear.';
            continue;
          }
          throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'Prompt Architect guidance failed validation.', 'guidance_validation_failed',
            planDiagnostics({
              ...providerFacts(outcome, startedAtMs, input.config.maxOutputTokens),
              requestedModel: input.config.model, jsonParseable: true, validationPassed: false,
              outputBytes: Buffer.byteLength(outcome.outputText, 'utf8'), attempts,
            }));
        }
        input.artifacts.put(guidanceRef(dispatch.taskId), outcome.outputText);
        return {
          workerId: input.worker.workerId,
          providerId: input.worker.providerId,
          status: 'SUCCEEDED',
          /**
           * THE PARSED ANSWER, NOT A SANITISED ONE. Julius sanitises what it
           * stores, exactly as it does for `contractProposal`: an adapter that
           * pre-cleaned the packet would be deciding what the domain is allowed
           * to refuse.
           */
          guidance: parsed,
          safeSummary: `Prompt Architect guidance produced by observed model ${safeClaim(outcome.actualModel ?? 'unknown', 80)} (response ${safeClaim(outcome.responseId ?? 'unknown', 80)}).`,
          evidence: [{
            type: 'ARTIFACT',
            status: 'PASSED',
            safeSummary: `Validated guidance packet stored for this task (${outcome.outputText.length} chars, sha256:${sha256(outcome.outputText).slice(0, 16)}…).`,
            artifactRef: guidanceRef(dispatch.taskId),
            occurredAt: nowIso(),
          }],
          diagnostics: planDiagnostics({
            ...providerFacts(outcome, startedAtMs, input.config.maxOutputTokens),
            requestedModel: input.config.model,
            jsonParseable: true, validationPassed: true, outcome: 'succeeded',
            attempts, outputBytes: Buffer.byteLength(outcome.outputText, 'utf8'),
          }),
          usage: {
            inputTokens: outcome.usage.inputTokens ?? undefined,
            outputTokens: outcome.usage.outputTokens ?? undefined,
            toolCalls: 0,
            costBasis: 'UNKNOWN',
          },
        };
      }
      const validation = validateArchitectPlan(parsed);
      if (!validation.ok) {
        const remedy = attempts < PLAN_ATTEMPT_LIMIT && correctionAffordable(dispatch.allocation)
          ? planCorrection(validation.reasonCode, validation.reasonField ?? null)
          : null;
        if (remedy !== null) { correction = remedy; continue; }
        /**
         * THE RULE IT BROKE, as a closed token. Paid attempt #3 recorded
         * `plan_validation_failed` and stopped there: the reason was composed
         * into the message below and the coordinator persists the class, not
         * the message. The code travels beside it now, so the next paid failure
         * names which of the fifteen rules refused the plan.
         */
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Prompt Architect plan failed validation: ${safeClaim(validation.reason, 120)}.`, 'plan_validation_failed',
          planDiagnostics({
            ...providerFacts(outcome, startedAtMs, input.config.maxOutputTokens),
            requestedModel: input.config.model, jsonParseable: true, validationPassed: false,
            validationReasonCode: validation.reasonCode, validationField: validation.reasonField ?? null,
            validationClaimPhrase: validation.reasonClaim ?? null,
            outputBytes: Buffer.byteLength(outcome.outputText, 'utf8'), attempts,
          }));
      }
      input.artifacts.put(planRef(snapshot.runId), outcome.outputText);
      return {
        workerId: input.worker.workerId,
        providerId: input.worker.providerId,
        status: 'SUCCEEDED',
        /**
         * THE CONTRACT REVISION THE PLAN IMPLIES, read off the validated plan
         * rather than asked for separately.
         *
         * The architect already states the bounded handoff it proposes — the
         * objective, the task boundary, the allowed file scope, the required
         * tests, the prohibited actions and the expected evidence — and every
         * one of those is a field of the task contract. So this is a MAPPING of
         * output the schema already validates, not a new capability, not a
         * second prompt, and not a second paid call.
         *
         * NOTHING HERE BINDS ANYONE. It is a proposal: Julius sanitises it
         * against an allowlist, refuses every mission-owned field, refuses a
         * result that could not be reviewed against, and stores what survives as
         * a DRAFT that the plan review then challenges or accepts.
         */
        contractProposal: contractProposalFromPlan(parsed),
        safeSummary: `Prompt Architect plan produced by observed model ${safeClaim(outcome.actualModel ?? 'unknown', 80)} (response ${safeClaim(outcome.responseId ?? 'unknown', 80)}).`,
        evidence: [{
          type: 'ARTIFACT',
          status: 'PASSED',
          safeSummary: `Validated architect plan stored for this run (${outcome.outputText.length} chars, sha256:${sha256(outcome.outputText).slice(0, 16)}…).`,
          artifactRef: planRef(snapshot.runId),
          occurredAt: nowIso(),
        }],
        /**
         * THE PLAN THAT VALIDATED, ON THE RECORD. `planDiagnostics` existed
         * only to explain refusals, so a run whose architect answered correctly
         * recorded no served model, no response id and no attempt count — and
         * `planAttempts` on a success is the number that says whether a
         * dispatch bought one provider call or two.
         */
        diagnostics: planDiagnostics({
          ...providerFacts(outcome, startedAtMs, input.config.maxOutputTokens),
          requestedModel: input.config.model,
          jsonParseable: true, validationPassed: true, outcome: 'succeeded',
          attempts, outputBytes: Buffer.byteLength(outcome.outputText, 'utf8'),
        }),
        usage: {
          inputTokens: outcome.usage.inputTokens ?? undefined,
          outputTokens: outcome.usage.outputTokens ?? undefined,
          toolCalls: 0,
          // Tokens, never a price: this provider reports no cost, so the basis
          // is UNKNOWN and the reservation stays held rather than settling at
          // zero. Unknown is not free.
          costBasis: 'UNKNOWN',
        },
      };
      }
    },
  };
}

/* --------------------------------------------------------- coding agent */

const CODER_CHARTER = [
  'You are the Coding Agent for a Relay mission run by Julius, the mission controller.',
  'Implement exactly what the mission context and the architect plan below require, by editing files in this workspace only.',
  'Do not run commands; verification is executed separately by an independent executor.',
  'You implement; you do not review or approve your own work, and completion is decided by Julius.',
].join(' ');

/**
 * THE LOCKED CONTRACT, AS THE CODER'S CHARGE.
 *
 * The same document the independent reviewer will grade against, rendered for
 * the worker that has to satisfy it. It arrives on the dispatch, computed by
 * Julius from the contract its gate proved; the adapter never looks one up,
 * because a worker that chose its own terms would be choosing what it is
 * graded against. Every line is a closed field of the contract — no mission
 * ids, no provider text, no prose of another worker's.
 */
export function coderContractBrief(contract: JuliusContractReviewCharge): string {
  const list = (items: readonly string[], empty: string) => (items.length === 0 ? `    - ${empty}` : items.map((item) => `    - ${item}`).join('\n'));
  return [
    '--- TASK CONTRACT (locked; the reviewer grades against exactly this) ---',
    `  CONTRACT: ${contract.binding.contractId} revision ${contract.binding.contractRevision}`,
    `  BINDING DIGEST: ${contract.binding.bindingDigest}`,
    `  ROUND: ${contract.stage}`,
    `  OBJECTIVE: ${contract.objective}`,
    `  RESPONSIBILITY BOUNDARY: ${contract.responsibilityBoundary}`,
    `  IN SCOPE:\n${list(contract.inScope, '(none stated)')}`,
    `  OUT OF SCOPE:\n${list(contract.outOfScope, '(none)')}`,
    `  PERMITTED PATHS:\n${list(contract.permittedPaths, '(none stated)')}`,
    `  PROHIBITED ACTIONS:\n${list(contract.prohibitedActions, '(none)')}`,
    `  BLOCKING ACCEPTANCE CRITERIA:\n${list(contract.blockingCriteria, '(none stated)')}`,
    `  REVIEW CRITERIA (what the independent reviewer will check):\n${list(contract.contractReviewCriteria, '(none stated)')}`,
    `  REQUIRED EVIDENCE: ${contract.requiredEvidence.join(', ') || '(none stated)'}`,
    `  REQUIRED CHECKS:\n${list(contract.requiredChecks, '(none stated)')}`,
    `  FAILURE CONDITIONS:\n${list(contract.failureConditions, '(none stated)')}`,
    `  STOPPING CONDITION: ${contract.stoppingCondition}`,
  ].join('\n');
}

export function createLiveHostedCodingAdapter(input: {
  readonly worker: JuliusWorker;
  readonly contexts: CompiledContextSource;
  readonly artifacts: LiveArtifactExchange;
  readonly projectId: string;
  readonly apiKey: string;
  readonly requestedModel: string;
  readonly workspacePath: string;
  /** The deterministic verification command the mission declares. */
  readonly testCommand: string;
  /** Tool effects go through the independent executor, never a local shell. */
  readonly shell: ShellEffectPort;
  readonly run?: typeof runHostedCodingAgent;
  readonly queryLoader?: () => Promise<HostedQueryFn>;
}): JuliusProviderAdapter {
  if (!input.apiKey || !input.requestedModel || !input.workspacePath || !input.testCommand) {
    throw new Error('hosted_coding_adapter_requires_live_config');
  }
  const run = input.run ?? runHostedCodingAgent;
  const loadQuery = input.queryLoader ?? loadHostedQuery;
  return {
    adapterId: input.worker.adapterId,
    async dispatch(dispatch): Promise<JuliusProviderResult> {
      const snapshot = requireSnapshot(input.contexts, dispatch.contextId);
      const plan = input.artifacts.get(planRef(snapshot.runId));
      if (plan === null) {
        // The artifact exchange is same-process: after a restart or in a
        // second process the plan is gone even though the plan TASK succeeded
        // durably. Implementing without the plan on a resumed run would be a
        // silent downgrade of what the mission paid the architect for —
        // refuse, so the resume fails visibly instead. (Independent review
        // finding F1; the durable artifact store is the recorded fix.)
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'The architect plan artifact is not available to this process; a resumed run cannot implement without it.');
      }

      const shellScope = {
        runId: snapshot.runId,
        projectId: input.projectId,
        taskId: dispatch.taskId,
        workerId: input.worker.workerId,
      };
      const before = await input.shell.run({
        ...shellScope,
        invocationKey: `${dispatch.taskId}:base`,
        command: 'git rev-parse HEAD',
        timeoutMs: 15_000,
      });
      if (before.status === 'SUCCEEDED') {
        input.artifacts.put(baseRevisionRef(snapshot.runId), before.stdout.trim());
      }

      let queryFn: HostedQueryFn;
      try { queryFn = await loadQuery(); } catch {
        throw new JuliusDispatchError('AUTH_CONFIGURATION', false, 'The hosted Claude Agent SDK runtime is not installed.');
      }
      /**
       * THE MISSION'S ALLOCATION IS THE EXECUTION LIMIT. Julius reserved
       * `dispatch.allocation.usdMicros` for this dispatch from the mission
       * budget; the hosted envelope is limited to exactly that, and the
       * runtime is told to stop there. With no allocation — a composition
       * without a policy — the envelope keeps its own conservative default,
       * which is how paid run 34037313976 was refused at 50 cents of a $20
       * mission: the limit was nobody's decision. Now it is Julius's.
       */
      const limits: HostedLimits = dispatch.allocation === undefined
        ? DEFAULT_HOSTED_LIMITS
        : hostedLimitsForAllocation(dispatch.allocation.usdMicros);
      /**
       * AN ALLOCATION BELOW ONE CENT BUYS NOTHING AND STILL BILLS.
       *
       * The envelope speaks whole cents, so anything under 10,000 micro-dollars
       * floors to a 0¢ ceiling — and a runtime told to stop at $0 still bills
       * the turn it takes to notice. Refusing before the dispatch spends
       * nothing and says exactly why the mission cannot continue.
       */
      if (dispatch.allocation !== undefined && limits.maxCostCents < 1) {
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false,
          'The remaining mission budget is below one cent; the hosted Coding Agent was not dispatched.', 'coder_allocation_below_one_cent');
      }
      const outcome: HostedRunOutcome = await run({
        queryFn,
        prompt: [
          CODER_CHARTER,
          '--- MISSION CONTEXT ---',
          packetText(snapshot),
          '--- ARCHITECT PLAN ---',
          plan,
          // The locked terms, when Julius dispatched under one. Absent only for
          // a composition that ran the coder without a contract, which the
          // dispatch gate no longer permits on the live path.
          ...(dispatch.contract === undefined ? [] : [coderContractBrief(dispatch.contract)]),
        ].join('\n\n'),
        workspacePath: input.workspacePath,
        apiKey: input.apiKey,
        requestedModel: input.requestedModel,
        limits,
        now: nowIso,
      });
      if (outcome.kind !== 'completed') {
        /**
         * THE FACTS BESIDE THE CODER'S REFUSAL.
         *
         * Paid Mission #2 recorded `coder_refused` and stopped there — the same
         * single word `reviewer_review_incomplete` was, on the third worker. An
         * untrusted result, a runtime that did not honour its envelope and a
         * cost ceiling are three different repairs, and the runner already knew
         * which. These are the structural facts its observation actually
         * carries; nothing is invented to fill a column, and no transcript,
         * prompt, final text or provider body is among them.
         */
        const observed = 'observation' in outcome ? outcome.observation : null;
        const coderDiagnostics: Record<string, unknown> = hostedCoderDiagnostics({
          taskType: dispatch.taskType, requestedModel: input.requestedModel,
          observed, limits, outcome: 'failed',
          failureReason: 'failureReason' in outcome ? outcome.failureReason ?? null : null,
        });
        if (outcome.kind === 'timed_out') throw new JuliusDispatchError('TIMEOUT', true, 'Hosted Coding Agent timed out.', 'coder_timed_out', { ...coderDiagnostics, timedOut: true });
        if (outcome.kind === 'cancelled') throw new JuliusDispatchError('CANCELLED', false, 'Hosted Coding Agent run was cancelled.', 'coder_cancelled', coderDiagnostics);
        if (outcome.kind === 'launch_failed') throw new JuliusDispatchError('AUTH_CONFIGURATION', false, `Hosted Coding Agent could not launch: ${safeClaim(outcome.safeMessage, 120)}.`, 'coder_launch_failed', coderDiagnostics);
        // THE REFUSAL CODE IS THE CLASS. Four causes, four words, instead of one.
        if (outcome.kind === 'refused') {
          throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Hosted Coding Agent refused: ${safeClaim(outcome.safeMessage, 120)}.`, outcome.refusalCode, coderDiagnostics);
        }
        // Unreachable today: the four kinds above are the whole union. Kept so
        // a fifth outcome added later fails as a named worker failure rather
        // than falling through to a success it never earned.
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'The hosted Coding Agent returned an unrecognised outcome.', 'coder_outcome_unrecognised', coderDiagnostics);
      }

      const diff = await input.shell.run({
        ...shellScope,
        invocationKey: `${dispatch.taskId}:diff`,
        command: 'git --no-pager diff && git --no-pager diff --stat',
        timeoutMs: 30_000,
      });
      if (diff.status === 'SUCCEEDED') input.artifacts.put(diffRef(snapshot.runId), diff.stdout);
      const test = await input.shell.run({
        ...shellScope,
        invocationKey: `${dispatch.taskId}:test`,
        command: input.testCommand,
        timeoutMs: 300_000,
      });
      input.artifacts.put(testOutputRef(snapshot.runId), `exit=${test.exitCode ?? 'unknown'}\n${test.stdout}\n${test.stderr}`);

      const observed = outcome.observation;
      return {
        workerId: input.worker.workerId,
        providerId: input.worker.providerId,
        status: 'SUCCEEDED',
        safeSummary: `Hosted Coding Agent session completed (observed model ${safeClaim(observed.actualModel ?? 'unknown', 80)}, ${observed.numTurns ?? 'unknown'} turns); tests ${test.status === 'SUCCEEDED' ? 'passed' : 'failed'} under the independent executor.`,
        evidence: [
          {
            type: 'DIFF',
            status: diff.status === 'SUCCEEDED' ? 'PASSED' : 'INCONCLUSIVE',
            safeSummary: diff.status === 'SUCCEEDED'
              ? `Workspace diff captured by executor invocation ${diff.invocationId} (${diff.stdout.length} chars).`
              : 'Workspace diff could not be captured by the executor.',
            artifactRef: diff.status === 'SUCCEEDED' ? diffRef(snapshot.runId) : null,
            occurredAt: nowIso(),
          },
          {
            type: 'TEST',
            status: test.status === 'SUCCEEDED' ? 'PASSED' : 'FAILED',
            safeSummary: `Deterministic test command exited ${test.exitCode ?? 'unknown'} under executor invocation ${test.invocationId}.`,
            artifactRef: null,
            occurredAt: nowIso(),
          },
        ],
        /**
         * THE SESSION THAT WORKED, ON THE RECORD — the same fields its refusal
         * has carried since paid Mission #2, from the same builder so the two
         * cannot drift apart. Live Run 3's coder finished, and its turn count,
         * tool count, permission denials and served model reached the bundle
         * only inside a prose sentence.
         */
        diagnostics: hostedCoderDiagnostics({
          taskType: dispatch.taskType, requestedModel: input.requestedModel,
          observed, limits, outcome: 'succeeded',
        }),
        usage: {
          inputTokens: observed.usage.inputTokens ?? undefined,
          outputTokens: observed.usage.outputTokens ?? undefined,
          usdMicros: observed.usage.totalCostUsd === null ? undefined : Math.round(observed.usage.totalCostUsd * 1_000_000),
          toolCalls: observed.toolsUsed.length,
          /**
           * THE ONLY WORKER THAT CAN SAY `PROVIDER_REPORTED`, and only when its
           * runtime actually reported. Anything else is UNKNOWN, which the
           * ledger holds as an unreleased reservation rather than a settlement
           * of zero.
           */
          costBasis: observed.usage.source === 'runtime_reported' && observed.usage.totalCostUsd !== null
            ? 'PROVIDER_REPORTED' : 'UNKNOWN',
        },
      };
    },
  };
}

/* -------------------------------------------------- independent reviewer */

export function createLiveHermesReviewerAdapter(input: {
  readonly worker: JuliusWorker;
  readonly contexts: CompiledContextSource;
  readonly artifacts: LiveArtifactExchange;
  readonly config: HermesConfig;
  readonly testCommand: string;
  readonly run?: typeof runHermesReview;
}): JuliusProviderAdapter {
  if (!input.config.executable || !input.config.model || !input.config.provider) {
    throw new Error('hermes_reviewer_adapter_requires_live_config');
  }
  const run = input.run ?? runHermesReview;
  return {
    adapterId: input.worker.adapterId,
    async dispatch(dispatch): Promise<JuliusProviderResult> {
      const snapshot = requireSnapshot(input.contexts, dispatch.contextId);
      /**
       * THE STAGE DECIDES WHAT IS REVIEWED. Paid run 34037313976's plan review
       * judged a plan by an implementation rubric and produced six blocking
       * findings demanding a diff and executed tests of a plan. The stage is
       * canonical task metadata now, the charge for it is the domain's, and
       * the packet carries only what the stage is about: a PLAN review sees
       * the plan and no diff or test output even if one exists; an
       * IMPLEMENTATION review requires the diff and is refused without it.
       */
      const stage = reviewStageOfDispatch(dispatch.taskType);
      if (stage === null) {
        throw new JuliusDispatchError('INVALID_REQUEST', false, 'The review dispatch names no known review stage; a review of an unknown stage is refused.', 'reviewer_stage_unknown');
      }
      const charge = reviewChargeFor(stage);
      /**
       * THE STAGE SAYS WHAT IT NEEDS, AND THIS CHECKS FOR EXACTLY THAT.
       *
       * `charge.requires` has named `['plan', 'guidance']` for a guidance
       * review since the stage vocabulary was written, and this adapter read
       * only `plan` and (for an implementation) `diff`. So a guidance review
       * would have passed its own preconditions holding the plan and NOT the
       * packet it exists to judge — a review of something it could not see,
       * whose "approved" would release a continuation. Reading the requirement
       * list rather than restating it means a stage that gains a requirement
       * gains the check with it.
       */
      const subjectTaskId = reviewSubjectTaskId(dispatch.taskId ?? '');
      const artifactFor = (requirement: JuliusReviewRequirement): string | null => {
        if (requirement === 'plan') return input.artifacts.get(planRef(snapshot.runId));
        if (requirement === 'diff') return input.artifacts.get(diffRef(snapshot.runId));
        return subjectTaskId === null ? null : input.artifacts.get(guidanceRef(subjectTaskId));
      };
      const REQUIREMENT_REFUSAL: Readonly<Record<JuliusReviewRequirement, { readonly message: string; readonly shape: string }>> = {
        plan: {
          // The artifact exchange is same-process. After a restart the plan is
          // gone even though its task succeeded durably, and a review dispatched
          // without it would be a review of NOTHING whose approval could
          // complete the mission. Refuse instead: a resumed run fails visibly
          // rather than completing falsely. (Independent review finding F1.)
          message: 'The architect plan artifact is not available to this process; an independent review of nothing is refused.',
          shape: 'reviewer_plan_absent',
        },
        diff: {
          // AN EMPTY DIFF IS NO DIFF. The exchange stores whatever `git diff`
          // printed, so a coder that edited nothing leaves an empty string —
          // which is not an implementation, and a review of it is the plan
          // review's mistake in the other direction.
          message: 'No workspace diff artifact is available to this process; an implementation review of nothing is refused.',
          shape: 'reviewer_implementation_absent',
        },
        guidance: {
          message: 'The guidance packet under review is not available to this process; a review of guidance nobody can read is refused.',
          shape: 'reviewer_guidance_absent',
        },
      };
      for (const requirement of charge.requires) {
        const artifact = artifactFor(requirement);
        if (artifact === null || artifact.trim() === '') {
          const refusal = REQUIREMENT_REFUSAL[requirement];
          throw new JuliusDispatchError('INVALID_REQUEST', false, refusal.message, refusal.shape);
        }
      }
      const planArtifact = input.artifacts.get(planRef(snapshot.runId));
      const guidanceArtifact = charge.subject === 'GUIDANCE' ? artifactFor('guidance') : null;
      const diffArtifact = charge.subject === 'IMPLEMENTATION' ? input.artifacts.get(diffRef(snapshot.runId)) : null;
      if (planArtifact === null) {
        // The artifact exchange is same-process. After a restart the plan is
        // gone even though its task succeeded durably, and a review dispatched
        // without it would be a review of NOTHING whose approval could
        // complete the mission. Refuse instead: a resumed run fails visibly
        // rather than completing falsely. (Independent review finding F1.)
        throw new JuliusDispatchError('INVALID_REQUEST', false, 'The architect plan artifact is not available to this process; an independent review of nothing is refused.', 'reviewer_plan_absent');
      }
      // AN EMPTY DIFF IS NO DIFF. The exchange stores whatever `git diff`
      // printed, so a coder that edited nothing leaves an empty string — which
      // is not an implementation, and a review of it is the plan review's
      // mistake in the other direction.
      if (charge.subject === 'IMPLEMENTATION' && (diffArtifact === null || diffArtifact.trim() === '')) {
        throw new JuliusDispatchError('INVALID_REQUEST', false, 'No workspace diff artifact is available to this process; an implementation review of nothing is refused.', 'reviewer_implementation_absent');
      }
      /**
       * The findings Julius compiled into this context, for a repair review.
       *
       * NOT REQUIRED, AND THE FIRST VERSION REFUSED WITHOUT THEM. Julius admits
       * a repair round on the subject's own FAILED evidence as well as on a
       * reviewer finding (`verifyTask` → EVIDENCE_FAILED), and such a round has
       * no findings by construction. Refusing there would have failed a run
       * that was repairing exactly as designed — a defect this change would
       * have introduced. When findings exist the reviewer must judge their
       * resolution; when none do, it judges the repaired work and its evidence.
       */
      const priorFindings = snapshot.packet.blocks.filter((block) => block.kind === 'FINDING').map((block) => block.text);
      const unifiedDiff = diffArtifact ?? '';
      const packet: ReviewPacket = {
        stage,
        charge,
        /**
         * THE LOCKED CONTRACT, WHEN JULIUS DISPATCHED ONE. It arrives on the
         * dispatch — computed by Julius from the contract its gate proved — and
         * is never looked up here: a reviewer that could fetch its own charge
         * would be choosing what it grades against. Absent for a plan review,
         * whose subject is the document that becomes the contract's detail.
         */
        ...(dispatch.contract === undefined ? {} : { contract: dispatch.contract }),
        missionId: snapshot.packet.missionId,
        // THE FINDINGS ARE NOT THE FOUNDER'S REQUEST. `packetText` joins every
        // block, so the FINDING entries Julius compiled for a repair review
        // would appear under "FOUNDER'S ORIGINAL REQUEST" as well as under the
        // prior-findings heading, and a reviewer asked whether the plan is
        // faithful to the request would be reading findings as the request.
        originalRequest: safeClaim(missionText(snapshot), 8_000),
        handoffJson: planArtifact,
        // THE PACKET UNDER JUDGEMENT, for a guidance review and for no other
        // stage. The plan stays beside it because guidance that contradicts
        // the plan it supplements cannot be spotted from the packet alone —
        // which is why `charge.requires` names both.
        ...(guidanceArtifact === null ? {} : { guidanceJson: guidanceArtifact }),
        acceptanceCriteria: [...snapshot.acceptanceCriterionIds],
        priorFindings,
        baseRevision: input.artifacts.get(baseRevisionRef(snapshot.runId)) ?? 'unknown',
        artifactDigest: sha256(charge.subject === 'IMPLEMENTATION' ? unifiedDiff : planArtifact),
        changedFiles: [...new Set([...unifiedDiff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]))],
        unifiedDiff,
        changedFileContents: '',
        testCommand: input.testCommand,
        testOutput: charge.subject === 'IMPLEMENTATION' ? (input.artifacts.get(testOutputRef(snapshot.runId)) ?? '') : '',
        relayEvidence: [...snapshot.evidenceIds],
      };
      /**
       * ONE CORRECTED RE-ASK, ON THE SHAPES A RE-ASK CAN FIX.
       *
       * Paid run 33802017460 bought a real plan, a real diff and passing tests,
       * and both reviews then failed to parse: no verdict reached Julius and
       * the run ended FAILED with zero decisions. Those shapes are
       * `retryable: false` for a good reason — a plain retry asks the identical
       * question and gets the identical answer — but a CORRECTION is not a
       * retry. It names the shape defect, from the CLOSED shape token and never
       * from the model's own (malformed) text — which is structural, not
       * merely intended: `review_incomplete` carries a safe message, a shape
       * and diagnostics, and the review text is not among them.
       *
       * ONLY the shapes where an answer ARRIVED in the wrong shape. A timeout,
       * a 503, a refused credential, a process that died and an oversized
       * output are not shape defects: three are already retryable at the task
       * level and the rest need a human or a smaller request, and re-asking
       * would spend for nothing. `review_output_too_large` is deliberately
       * excluded — a runaway answer asked again is a second runaway answer.
       */
      let reviewAttempts = 0;
      let reviewCorrection: string | undefined;
      let outcome: HermesOutcome;
      for (;;) {
      reviewAttempts += 1;
      outcome = await run({ packet: { ...packet, ...(reviewCorrection === undefined ? {} : { correction: reviewCorrection }) }, config: input.config });
      if (outcome.kind === 'review_incomplete' && reviewAttempts < REVIEW_ATTEMPT_LIMIT && correctionAffordable(dispatch.allocation)) {
        const remedy = reviewCorrectionFor(outcome.shape);
        if (remedy !== null) { reviewCorrection = remedy; continue; }
      }
      break;
      }
      if (outcome.kind === 'launch_failed') {
        throw new JuliusDispatchError('PROVIDER_UNAVAILABLE', false, `Hermes reviewer could not launch: ${safeClaim(outcome.safeMessage, 120)}.`, 'reviewer_launch_failed');
      }
      if (outcome.kind === 'review_incomplete') {
        /**
         * THE SHAPE IS THE CLASS, because the class is what survives.
         *
         * Paid attempt #2 (run 33802017460) failed with both reviewer tasks
         * recording the single word `reviewer_review_incomplete`. The message
         * beside it already separated a dead credential from a model writing
         * prose — and the message is not persisted; the coordinator writes the
         * code, the retryable flag and the failure class. So the artifact that
         * exists to explain a paid failure said only that the review was
         * unreadable, and a second paid run was the only way to learn more.
         *
         * A timeout, a refused credential, an upstream HTTP error, a review
         * service with no capacity and a request that service would not admit
         * are the five an operator can act on without reading anything else,
         * so they keep their own Julius codes; the rest are worker execution
         * failures distinguished by their shape.
         *
         * AND TWO OF THEM ARE RETRYABLE, because two of them describe an answer
         * that did not arrive rather than one that arrived wrong.
         *
         * Every shape used to be `retryable: false` under one sentence — "every
         * one of them describes an answer that will be identical if asked
         * again" — which is true of a malformed verdict and false of a review
         * that timed out or a service that was full. The rest of Julius already
         * knows this: the Prompt Architect and the Coding Agent both raise
         * TIMEOUT retryable, and only the reviewer treated its own timeout as
         * final. Nothing paid for is discarded by retrying one: a timeout and a
         * 503 produced no verdict to throw away.
         *
         * The refusals stay final, and are held there twice — `retryable: false`
         * here, and `decideJuliusContinuation` refusing AUTH_CONFIGURATION and
         * INVALID_REQUEST whatever this flag says. Retries remain bounded by the
         * task's attempt ceiling, the C.A.R.D.'s `automaticRetry`, and the run
         * spend budget, so "retryable" is a permission to re-ask, never a
         * licence to spend without one.
         */
        const [code, retryable] = outcome.shape === 'review_timeout'
          ? ['TIMEOUT', true] as const
          : outcome.shape === 'review_service_unavailable'
            // Capacity clears as runs finish and a drain ends when the deploy
            // lands. Neither is a verdict, and neither needs a human first.
            ? ['PROVIDER_UNAVAILABLE', true] as const
            : outcome.shape === 'review_authentication_failed'
              ? ['AUTH_CONFIGURATION', false] as const
              : outcome.shape === 'review_provider_http_error'
                ? ['PROVIDER_UNAVAILABLE', false] as const
                : outcome.shape === 'review_request_rejected'
                  // The request is what has to change, so repeating it verbatim
                  // only spends the attempt. Never the provider's fault.
                  ? ['INVALID_REQUEST', false] as const
                  : ['WORKER_EXECUTION_FAILURE', false] as const;
        /**
         * THE SHAPE, AND THE FACTS THAT LET SOMEONE DEBUG THE SHAPE.
         *
         * `review_process_exit` without the exit code, and
         * `review_output_too_large` without the byte count, each name a class
         * an operator then has to buy a second paid run to investigate. The
         * domain rebuilds this from an allowlist before it is written, so
         * nothing here can widen what reaches the durable event.
         */
        throw new JuliusDispatchError(
          code, retryable, `Hermes review incomplete: ${safeClaim(outcome.safeMessage, 120)}.`, outcome.shape,
          reviewerDiagnostics({
            diagnostics: outcome.diagnostics, stage, reviewAttempts,
            startedAt: outcome.startedAt, completedAt: outcome.completedAt,
          }),
        );
      }
      if (outcome.result.verdict === 'unable_to_review') {
        // A reviewer that could not review has not reviewed. Recording that as
        // evidence would park the run; failing the dispatch keeps the outcome
        // visible and retryable by policy. (Independent review finding F8.)
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'Hermes was unable to review the change.', 'reviewer_unable_to_review');
      }
      const blocking = outcome.result.findings.filter((finding) => finding.severity === 'blocking' || finding.severity === 'major');
      // The engine's own rule (`hasBlockingFinding`) treats ANY changes_required
      // verdict as blocking; a non-approved verdict with only minor findings
      // must therefore drive the repair path too, not park the run on
      // inconclusive evidence. (Independent review finding F8.)
      const evidence = blocking.length === 0 && outcome.result.verdict === 'approved'
        ? [{
          type: 'REVIEW_FINDING' as const,
          status: 'PASSED' as const,
          safeSummary: `Independent review verdict approved with no blocking findings (served model ${safeClaim(outcome.servedModel ?? 'unknown', 80)}).`,
          occurredAt: nowIso(),
        }]
        : blocking.length === 0
          ? [{
            type: 'REVIEW_FINDING' as const,
            status: 'FAILED' as const,
            safeSummary: safeClaim(`Independent review verdict ${outcome.result.verdict} without blocking-severity findings: ${outcome.result.summary}`),
            occurredAt: nowIso(),
          }]
          : blocking.map((finding) => ({
            type: 'REVIEW_FINDING' as const,
            status: 'FAILED' as const,
            safeSummary: safeClaim(`[${finding.severity}] ${finding.requirement}: ${finding.explanation}`),
            occurredAt: nowIso(),
          }));
      /**
       * THE SAME REASON THE DIAGNOSTICS ARE OPTIONAL ABOVE: the runner is
       * injectable, so a harness or an older transport can answer without a
       * usage report. A review that was bought and answered must not become a
       * dispatch failure over a missing field, and `UNKNOWN_USAGE` says exactly
       * what is true of it — no tokens, no cost, `source: 'unavailable'`.
       */
      const reviewUsage: HermesUsage = outcome.usage !== null && typeof outcome.usage === 'object' ? outcome.usage : UNKNOWN_USAGE;
      return {
        workerId: input.worker.workerId,
        providerId: input.worker.providerId,
        status: 'SUCCEEDED',
        safeSummary: `Independent Hermes review completed: verdict ${outcome.result.verdict}, ${outcome.result.findings.length} findings (${blocking.length} blocking), served model ${safeClaim(outcome.servedModel ?? 'unknown', 80)}.`,
        evidence,
        /**
         * THE REVIEW THAT WORKED, ON THE RECORD.
         *
         * Live Run 3 approved both stages and left `worker-diagnostics.tsv`
         * empty, so the served model survived only because a prose evidence
         * summary happened to name it, and the elapsed time of a healthy review
         * — the number the next timeout has to be read against — survived
         * nowhere at all.
         */
        diagnostics: reviewerDiagnostics({
          diagnostics: outcome.diagnostics, stage, reviewAttempts,
          startedAt: outcome.startedAt, completedAt: outcome.completedAt,
          usage: reviewUsage,
        }),
        /**
         * TOKENS AND AN ESTIMATE, NEVER A BILL.
         *
         * `{ toolCalls: 0 }` was the whole of this, so every reviewer
         * reservation in Live Run 3 settled with no figure and the ledger read
         * three unreported components exactly as it reads a free one. Hermes
         * reports tokens and its own `estimated_cost`; both are recorded, and
         * `usdMicros` stays absent because nothing here was billed to Relay.
         */
        usage: {
          toolCalls: 0,
          inputTokens: reviewUsage.inputTokens ?? undefined,
          outputTokens: reviewUsage.outputTokens ?? undefined,
          costBasis: harnessEstimateMicros(reviewUsage) === null ? 'UNKNOWN' : 'ESTIMATED',
          estimatedUsdMicros: harnessEstimateMicros(reviewUsage) ?? undefined,
        },
      };
    },
  };
}
