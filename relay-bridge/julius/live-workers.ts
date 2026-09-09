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

import { createHash } from 'node:crypto';
import type { JuliusContractReviewCharge } from '../../src/relay/mission/julius/julius-task-contract';
import {
  JuliusDispatchError,
  reviewChargeFor,
  reviewStageOf,
  type JuliusContextSnapshot,
  type JuliusDispatchAllocation,
  type JuliusProviderAdapter,
  type JuliusProviderResult,
  type JuliusReviewStage,
  type JuliusWorker,
} from '../../src/relay/mission/julius';
import {
  runGptArchitect,
  type GptArchitectConfig,
  type GptRunOutcome,
} from '../../src/relay/connectors/gpt-architect';
import { validateArchitectPlan, type ArchitectPlanReasonCode } from '../../src/relay/mission/prompt-architect/prompt-architect-plan';
import {
  loadHostedQuery,
  runHostedCodingAgent,
  type HostedQueryFn,
  type HostedRunOutcome,
} from '../hosted-coding-agent/hosted-runner';
import { DEFAULT_HOSTED_LIMITS, hostedLimitsForAllocation, type HostedLimits } from '../hosted-coding-agent/hosted-envelope';
import {
  runHermesReview,
  type HermesConfig,
  type HermesOutcome,
  type ReviewPacket,
} from '../hermes-reviewer';
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
 * THE SAFE FACTS BESIDE A PLAN FAILURE.
 *
 * `plan_validation_failed` named the boundary and nothing else, so paid attempt
 * #3 could not say WHICH of fifteen rules the plan broke. These are structural
 * only — a closed reason code, booleans, a byte count, and identifiers the
 * provider itself returned. No plan text, no prompt, no provider body.
 */
const planDiagnostics = (input: {
  readonly requestedModel: string | null;
  readonly servedModel?: string | null;
  readonly responseId?: string | null;
  readonly jsonParseable: boolean;
  readonly validationPassed: boolean;
  readonly validationReasonCode?: string | null;
  readonly validationField?: string | null;
  readonly validationClaimPhrase?: string | null;
  readonly attempts?: number | null;
  readonly outputBytes?: number | null;
}): Record<string, unknown> => ({
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
      const priorPlan = revising ? input.artifacts.get(planRef(snapshot.runId)) : null;
      if (revising && priorPlan === null) {
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'The prior architect plan is not available to this process; a plan revision without it is refused.', 'prior_plan_unavailable');
      }
      const baseCharter = revising ? `${ARCHITECT_CHARTER} ${ARCHITECT_REVISION_CHARTER}` : ARCHITECT_CHARTER;
      let attempts = 0;
      let correction: string | null = null;
      for (;;) {
      attempts += 1;
      const outcome: GptRunOutcome = await run({
        apiKey: input.apiKey,
        config: input.config,
        // The correction goes in the INSTRUCTIONS, beside the charter it did
        // not follow — not into the mission packet, which is Julius's own
        // compiled context and is not the place to record a model's mistake.
        instructions: correction === null ? baseCharter : `${baseCharter} ${correction}`,
        input: revising
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
        const failed = planDiagnostics({
          requestedModel: input.config.model, servedModel: outcome.actualModel ?? null,
          responseId: outcome.responseId ?? null, jsonParseable: false, validationPassed: false,
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
            requestedModel: input.config.model, servedModel: outcome.actualModel,
            responseId: outcome.responseId, jsonParseable: false, validationPassed: false,
            outputBytes: Buffer.byteLength(outcome.outputText, 'utf8'), attempts,
          }));
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
            requestedModel: input.config.model, servedModel: outcome.actualModel,
            responseId: outcome.responseId, jsonParseable: true, validationPassed: false,
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
        usage: {
          inputTokens: outcome.usage.inputTokens ?? undefined,
          outputTokens: outcome.usage.outputTokens ?? undefined,
          toolCalls: 0,
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
        const coderDiagnostics: Record<string, unknown> = {
          // THE ROUND THAT SPENT THE MONEY. Fixing this to 'build' made a
          // repair round's cost refusal indistinguishable from the first
          // build's in the very artifact that exists to tell them apart.
          stage: dispatch.taskType === 'repair:build' ? 'repair:build' : 'build',
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
          costCeilingUsdMicros: limits.maxCostCents * 10_000,
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
        };
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
        usage: {
          inputTokens: observed.usage.inputTokens ?? undefined,
          outputTokens: observed.usage.outputTokens ?? undefined,
          usdMicros: observed.usage.totalCostUsd === null ? undefined : Math.round(observed.usage.totalCostUsd * 1_000_000),
          toolCalls: observed.toolsUsed.length,
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
      const planArtifact = input.artifacts.get(planRef(snapshot.runId));
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
          { ...outcome.diagnostics, stage, reviewAttempts },
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
      return {
        workerId: input.worker.workerId,
        providerId: input.worker.providerId,
        status: 'SUCCEEDED',
        safeSummary: `Independent Hermes review completed: verdict ${outcome.result.verdict}, ${outcome.result.findings.length} findings (${blocking.length} blocking), served model ${safeClaim(outcome.servedModel ?? 'unknown', 80)}.`,
        evidence,
        usage: { toolCalls: 0 },
      };
    },
  };
}
