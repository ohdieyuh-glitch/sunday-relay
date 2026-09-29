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
  reviewSubjectTaskId,
  type JuliusContextSnapshot,
  type JuliusDispatchAllocation,
  type JuliusProviderAdapter,
  type JuliusProviderResult,
  type JuliusResearchPolicy,
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
import { sanitizeJuliusRebuttal } from '../../src/relay/mission/julius/julius-disagreement';
import { sanitizeJuliusArchitecture } from '../../src/relay/mission/julius/julius-architecture-state';
import { sanitizeJuliusConsistency } from '../../src/relay/mission/julius/julius-architecture-drift';
import {
  juliusParticipationProtocol,
  readJuliusParticipationBlock,
} from '../../src/relay/mission/julius/julius-worker-participation';
import { ARCHITECT_GUIDANCE_SCHEMA, ARCHITECT_GUIDANCE_SCHEMA_NAME } from '../../src/relay/connectors/gpt-architect/guidance-schema';
import { ARCHITECT_REBUTTAL_SCHEMA, ARCHITECT_REBUTTAL_SCHEMA_NAME } from '../../src/relay/connectors/gpt-architect/rebuttal-schema';
import {
  ARCHITECT_CONSULTATION_SCHEMA, ARCHITECT_CONSULTATION_SCHEMA_NAME,
} from '../../src/relay/connectors/gpt-architect/architecture-schema';
import { ARCHITECT_PLAN_SCHEMA, ARCHITECT_PLAN_SCHEMA_NAME } from '../../src/relay/connectors/gpt-architect';
import {
  RESEARCH_ASKS_FIELD,
  RESEARCH_AUTHORITY_NOT_STATED,
  juliusResearchAskFieldGuidance,
  renderJuliusResearchAuthority,
  withJuliusResearchAsks,
} from '../../src/relay/mission/julius/julius-research-protocol';
import {
  runHostedCodingAgent,
  type HostedQueryFn,
} from '../hosted-coding-agent/hosted-runner';
import {
  buildJuliusCodingAgentRequest,
  juliusCodingAgentFailureClass,
  juliusCodingAgentFailureDisposition,
  renderJuliusCodingAgentContract,
  type JuliusCodingAgentProvider,
} from '../../src/relay/mission/julius/julius-coding-agent';
import type { JuliusFileCreationGrant } from '../../src/relay/mission/julius/julius-file-creation';
import { createClaudeCodeCodingAgentProvider } from './claude-code-coding-provider';
import {
  hermesReviewVerdict,
  runHermesReview,
  type HermesConfig,
  type HermesOutcome,
  type HermesReviewDiagnostics,
  type ReviewPacket,
} from '../hermes-reviewer';
import { UNKNOWN_USAGE, type HermesUsage } from '../reviewer-harness/hermes/runner';
import { REVIEW_TRANSIENT_REASK_BACKOFF_MS, REVIEW_TRANSIENT_REASK_LIMIT, REVIEW_TRANSIENT_REASK_SHAPES, reviewerReaskWithinDeadline } from '../reviewer-deadline';
import { CODER_EXECUTOR_STEP_TIMEOUTS_MS } from '../hosted-coding-agent/coder-envelope';
import { juliusAttemptCloseCommand, juliusAttemptStartCommand, parseJuliusAttemptClose, parseJuliusAttemptStart, type JuliusAttemptClose } from './coder-workspace';
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
  /**
   * Forget a ref. A coder dispatch clears the run's diff and test output before
   * it runs, so a capture that fails leaves NOTHING for the reviewer rather
   * than the previous round's diff beside this round's test.
   */
  clear?(ref: string): void;
}

export const ARTIFACT_TEXT_CAP = 256 * 1024;

export function createLiveArtifactExchange(): LiveArtifactExchange {
  const values = new Map<string, string>();
  return {
    put(ref, text) { values.set(ref, text.slice(0, ARTIFACT_TEXT_CAP)); },
    get(ref) { return values.get(ref) ?? null; },
    clear(ref) { values.delete(ref); },
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
 * THE ASK, FOR THE TWO SLOTS THAT ANSWER WITH A SCHEMA.
 *
 * Separated from the charters so the architect's plan, the architect's guidance
 * and the reviewer's review are all told the same thing, in the same words,
 * from the domain's own bounds. A slot told a different rule from the one its
 * sanitizer enforces is the drift `HostedLimits.maxTurns` was.
 */
const RESEARCH_FIELD_GUIDANCE = juliusResearchAskFieldGuidance();

/**
 * WHAT THIS DISPATCH MAY RESEARCH, from the SAME sealed policy the research
 * mediator decides with: the composition hands both the one `researchPolicyFor`,
 * so the sentence a worker reads and the decision its ask meets cannot come from
 * two readings of the contract. Rendering grants nothing; the mediator never
 * reads this text.
 */
export type ResearchPolicySource = (missionId: string) => JuliusResearchPolicy;

/**
 * THE MISSION'S OWN AUTHORISATION TO CREATE FILES, by mission id, from its
 * trusted contract. Null for a mission means its coder may not create files.
 * The same shape as {@link ResearchPolicySource}, for the same reason: the
 * composition owns mission-level authority, and a dispatch only looks it up.
 */
export type FileCreationGrantSource = (missionId: string) => JuliusFileCreationGrant | null;
const researchAuthorityFor =(source: ResearchPolicySource | undefined, missionId: string, role: string): string =>
  (source === undefined ? RESEARCH_AUTHORITY_NOT_STATED : renderJuliusResearchAuthority({ policy: source(missionId), role }));

/**
 * READ THE ASK OFF A WORKER'S OWN ANSWER, and carry it or nothing.
 *
 * ABSENT AND EMPTY ARE THE SAME THING HERE, deliberately: the schema makes the
 * field required, so the ordinary answer is `[]` — a worker saying it needs
 * nothing. Passing an empty list on would open a checkpoint for a question
 * nobody asked, and the pipeline would record a refusal against a worker that
 * did exactly what it was told. Anything else goes through untouched.
 */
function researchAsksFrom(parsed: unknown): { researchAsks?: unknown } {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const asks = (parsed as Record<string, unknown>)[RESEARCH_ASKS_FIELD];
  if (asks === undefined) return {};
  if (Array.isArray(asks) && asks.length === 0) return {};
  return { researchAsks: asks };
}

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

/**
 * THE ARCHITECT ANSWERS A DISAGREEMENT ONCE.
 *
 * Julius opened a disagreement because the Independent Reviewer challenged
 * something this architect is responsible for. The challenge, its category and
 * the reviewer's position are in the mission context as a HANDOFF entry Julius
 * wrote for this task. There is no second rebuttal and no negotiation: one
 * answer, and then Julius decides.
 */
const ARCHITECT_REBUTTAL_CHARTER = [
  'You are the Prompt Architect for a Relay mission run by Julius, the mission controller.',
  'The Independent Reviewer has CHALLENGED your architecture position, and Julius has opened a',
  'disagreement. The challenge, its category and what the reviewer says are in the DISAGREEMENT entry',
  'in your mission context. This is your ONE answer to it.',
  'Answer with position CONCEDES or MAINTAINS, and nothing between them.',
  'CONCEDES means the reviewer is right and Julius should act on the challenge: repair or re-plan follows.',
  'MAINTAINS means you believe the challenged position is correct. Then you MUST cite evidence: each',
  'entry is a locator — a repository path, a specification section, a test or a document — and your own',
  'bounded claim about what is there. Never quote a retrieved body back; the locator and your judgement',
  'travel, not the source text. A maintained position with nothing to cite is refused, because the',
  'Independent Reviewer will judge your EVIDENCE, not your confidence.',
  'Your argument must say which challenged claim you are answering, and why the evidence answers it.',
  'THE TERMS ARE NOT ON THE TABLE. You may not restate, widen, narrow or replace the objective, the',
  'acceptance criteria, the scope, the permitted paths, the budget, the permissions or any other',
  'contract term, and you may not declare any work verified, accepted or complete. The output schema',
  'gives you nowhere to put one, and Julius refuses an answer that tries.',
  'If your position genuinely requires a MISSION-OWNED term to change, set missionTermsMustChange true',
  'and say why in the argument. That does not change the term: Julius escalates the disagreement to',
  'whoever owns the mission rather than deciding it. Claiming it when it is untrue stops the work for',
  'no reason, so use it only when the agreement itself is the problem.',
  'A maintained position is re-reviewed independently once, and then Julius resolves the disagreement.',
].join(' ');

const ARCHITECT_CONSULTATION_CHARTER = [
  'You are the Prompt Architect for a Relay mission run by Julius, the mission controller.',
  'Julius has come BACK to you. Something in the record moved — the design and the agreement disagree, a',
  'review says its evidence contradicts an assumption you named, a dependency appeared, a repair was',
  'required for an architectural reason, a coder asked the design a question, a re-plan was proposed, or',
  'the run is ready to complete and nobody has asked whether what was built matches what was designed.',
  'The reason is in your mission context, with the ARCHITECTURE entry that is currently in force.',
  'Answer BOTH halves.',
  'ARCHITECTURE is the design you hold NOW: components and what each is responsible for, the boundaries a',
  'change can cross, the dependencies and what you assume about each, the decisions with what you rejected',
  'and why, the assumptions with whether each still holds, the open questions with who owns them, and the',
  'risks with their impact and mitigation. State the whole picture, not a diff: Julius records it as a',
  'revision and computes what moved itself.',
  'CONSISTENCY is your assessment of whether what was BUILT matches what was DESIGNED.',
  'ALIGNED means it matches, and then you must name no drift at all.',
  'DRIFT_NON_BLOCKING means it drifted and the drift does not need fixing — the record says so rather than',
  'pretending it did not happen.',
  'DRIFT_REQUIRES_REPAIR means it drifted across a boundary that matters and the named work must be',
  'repaired. Name the drifting task ids; Julius will not guess which work is wrong.',
  'REPLAN_REQUIRED means the DESIGN is what is wrong for what has been learned.',
  'MATERIAL MEANS A BOUNDARY MOVED: an interface, a schema, a dependency, who owns a subsystem, the',
  'security boundary, the concurrency model, the persistence model or an invariant. A rename, a reformat,',
  'a comment, a log line or a test-only change is NOT drift. An assessment that demands repair or a',
  'replan on the strength of a cosmetic change is refused.',
  'Anything other than ALIGNED must name drift AND cite evidence: a locator a reader can check.',
  'THE TERMS ARE NOT ON THE TABLE. You may not restate, widen, narrow or replace the objective, the',
  'acceptance criteria, the scope, the permitted paths, the budget or the permissions, and you may not',
  'declare any work verified, accepted or complete. The output schema gives you nowhere to put one, and',
  'Julius refuses an answer that tries. Your assessment can HOLD a completion; it can never make one.',
  'If your design conflicts with the locked terms, say so in the consistency claim and assess',
  'REPLAN_REQUIRED. Julius escalates a re-plan that needs a mission term to move rather than applying it.',
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
/** Whether a dispatch's own signal has fired, read through a call so flow analysis cannot cache an answer from before an await. */
const signalAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

/** A wait that ends early on the dispatch's own cancellation, so a cut never waits out a backoff. */
const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal?.aborted === true) { resolve(); return; }
  const onAbort = (): void => { clearTimeout(timer); resolve(); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

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
    case 'review_engine_invalid_tool_call':
      return 'CORRECTION — your previous answer tried to call a tool. This review has NO tools of any kind. Do not call any tool; judge only what is in this packet, and emit exactly one JSON object in the shape given above.';
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
  /**
   * WHY A SECOND CALL WAS BOUGHT, as the closed shape token of the answer that
   * caused it — a correctable shape defect, or `review_service_unavailable`.
   * `reviewAttempts` says how many calls; this says what the first one was.
   * Null when the dispatch asked once.
   */
  readonly reviewReaskShape: string | null;
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
    /**
     * HOW MANY PROVIDER CALLS THE ENGINE SAYS IT MADE for the LAST attempt,
     * from its own usage file. On a failed review this is the difference
     * between "a paid provider was asked and the answer was unusable" and "no
     * request ever left" — a distinction paid qualification 34753589938 could
     * not draw. Null when the engine wrote no usage report.
     */
    engineApiCalls: input.usage?.apiCalls ?? null,
    reviewReaskShape: input.reviewReaskShape,
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
  /** The mission's sealed research policy, the same source the mediator decides with. */
  readonly researchPolicyFor?: ResearchPolicySource;
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
      /**
       * THE ARCHITECT'S THIRD JOB, and the one PR #270 left unroutable: a
       * rebuttal to a reviewer challenge. Julius minted the task, wrote the
       * challenge into this task's context and asked once. Without this branch
       * the live composition registered no worker for it, and every live
       * disagreement resolved REBUTTAL_UNROUTABLE — the challenge upheld
       * because nobody could answer it.
       */
      const rebutting = dispatch.taskType === 'rebuttal';
      /**
       * THE ARCHITECT'S FOURTH JOB: being consulted again. Julius mints an
       * `architecture` task for one of seven named reasons, and once before a
       * run may complete. Without this branch the composition would register no
       * worker for it, every consultation would be recorded unroutable, and the
       * completion gate would let every run through unasked.
       */
      const consulting = dispatch.taskType === 'architecture';
      const priorPlan = revising || guiding || rebutting || consulting ? input.artifacts.get(planRef(snapshot.runId)) : null;
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
      const roleCharter = consulting
        ? ARCHITECT_CONSULTATION_CHARTER
        : rebutting
        ? ARCHITECT_REBUTTAL_CHARTER
        : guiding
          ? ARCHITECT_GUIDANCE_CHARTER
          : revising ? `${ARCHITECT_CHARTER} ${ARCHITECT_REVISION_CHARTER}` : ARCHITECT_CHARTER;
      // A FIELD NOBODY WAS TOLD ABOUT IS A FIELD NOBODY USES. The schema makes
      // the architect answer it; this is what it means.
      const baseCharter = `${roleCharter}\n\n${RESEARCH_FIELD_GUIDANCE}\n\n${researchAuthorityFor(input.researchPolicyFor, snapshot.packet.missionId, input.worker.role)}`;
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
        /**
         * BOTH BRANCHES NOW SUPPLY A SCHEMA, because both carry the ask.
         * `withJuliusResearchAsks` adds the property AND its name to
         * `required` — strict mode rejects a schema that adds only the first,
         * and that rejection would arrive on a paid call.
         */
        schema: consulting
          ? { name: ARCHITECT_CONSULTATION_SCHEMA_NAME, schema: withJuliusResearchAsks(ARCHITECT_CONSULTATION_SCHEMA) }
          : rebutting
          ? { name: ARCHITECT_REBUTTAL_SCHEMA_NAME, schema: withJuliusResearchAsks(ARCHITECT_REBUTTAL_SCHEMA) }
          : guiding
            ? { name: ARCHITECT_GUIDANCE_SCHEMA_NAME, schema: withJuliusResearchAsks(ARCHITECT_GUIDANCE_SCHEMA) }
            : { name: ARCHITECT_PLAN_SCHEMA_NAME, schema: withJuliusResearchAsks(ARCHITECT_PLAN_SCHEMA) },
        input: consulting || rebutting
          // The trigger, the challenge and the architecture in force are all
          // entries Julius compiled into this packet; the plan is context.
          ? guidanceInput(snapshot, dispatch, priorPlan)
          : guiding
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
          case 'refused':
            // The provider declined the REQUEST, not the caller: INVALID_REQUEST,
            // the code the Coding Agent's CONTENT_REFUSED carries, so one
            // phenomenon has one code whichever peer meets it. Never retryable.
            throw new JuliusDispatchError('INVALID_REQUEST', false, 'The Prompt Architect provider declined this request.', outcome.failureClass, failed);
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
      if (consulting) {
        /**
         * BOTH HALVES ARE VALIDATED BY THE DOMAIN'S OWN SANITIZERS, for the
         * reason the rebuttal is: one reading of what a usable answer is,
         * shared with the pipeline that will act on it. A consultation that
         * demands a repair on the strength of a rename, or that names drift
         * with nothing to cite, fails here and is corrected once rather than
         * reaching Julius as an assessment it must hold a completion against.
         *
         * The REVISION NUMBER passed here is a placeholder: Julius assigns the
         * real one from its own ledger. Nothing in the sanitizer's judgement
         * depends on it, and inventing an authoritative number in an adapter is
         * exactly the kind of second reading this pattern exists to prevent.
         */
        const source = parsed as { architecture?: unknown; consistency?: unknown };
        const architectureOk = sanitizeJuliusArchitecture({
          value: source.architecture, revision: 1, proposedByTaskId: dispatch.taskId, recordedAt: nowIso(),
        }).ok;
        const consistencyOk = sanitizeJuliusConsistency({ value: source.consistency, revision: 1 }).ok;
        if (!architectureOk || !consistencyOk) {
          if (attempts < PLAN_ATTEMPT_LIMIT && correctionAffordable(dispatch.allocation)) {
            correction = 'CORRECTION — your previous answer was REFUSED: it did not form a usable architecture consultation. Answer with exactly one JSON object conforming to the output schema. "architecture" must state the whole design — at least one component, boundary, dependency, decision, assumption, question or risk — and "consistency" must carry an assessment of exactly ALIGNED, DRIFT_NON_BLOCKING, DRIFT_REQUIRES_REPAIR or REPLAN_REQUIRED. ALIGNED must name no drift; anything else must name drift AND cite at least one evidence reference; DRIFT_REQUIRES_REPAIR and REPLAN_REQUIRED must name drift whose kind is a boundary that moved, not a rename or a reformat, and DRIFT_REQUIRES_REPAIR must name the drifting task ids. No field may name a Mission Contract term, and no field may declare work verified, accepted or complete.';
            continue;
          }
          throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'Prompt Architect architecture consultation failed validation.', 'architecture_validation_failed',
            planDiagnostics({
              ...providerFacts(outcome, startedAtMs, input.config.maxOutputTokens),
              requestedModel: input.config.model, jsonParseable: true, validationPassed: false,
              outputBytes: Buffer.byteLength(outcome.outputText, 'utf8'), attempts,
            }));
        }
        return {
          workerId: input.worker.workerId,
          providerId: input.worker.providerId,
          status: 'SUCCEEDED',
          /** THE PARSED ANSWER, NOT A SANITISED ONE. Julius decides what it may refuse. */
          architecture: source.architecture,
          consistency: source.consistency,
          ...researchAsksFrom(parsed),
          safeSummary: `Prompt Architect architecture consultation produced by observed model ${safeClaim(outcome.actualModel ?? 'unknown', 80)} (response ${safeClaim(outcome.responseId ?? 'unknown', 80)}).`,
          /**
           * A CONSULTATION IS NOT A DELIVERABLE. What it produces is state and
           * an assessment, both of which Julius records. The task carries one
           * ARTIFACT row so the dispatch is accounted for.
           */
          evidence: [{
            type: 'ARTIFACT',
            status: 'PASSED',
            safeSummary: `Architecture consultation recorded (${outcome.outputText.length} chars).`,
            integrityHash: sha256(outcome.outputText),
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
      if (rebutting) {
        /**
         * THE DOMAIN'S OWN SANITIZER IS THE VALIDATOR, as it is for guidance:
         * one reading of what a usable rebuttal is, shared with the pipeline
         * that will act on it. A maintained position with nothing to cite fails
         * here and is corrected once, rather than reaching Julius as an answer
         * it must resolve the disagreement against.
         */
        if (!sanitizeJuliusRebuttal(parsed).ok) {
          if (attempts < PLAN_ATTEMPT_LIMIT && correctionAffordable(dispatch.allocation)) {
            correction = 'CORRECTION — your previous answer was REFUSED: it did not form a usable rebuttal. Answer with exactly one JSON object conforming to the output schema. "position" must be exactly CONCEDES or MAINTAINS; a MAINTAINS position must carry at least one evidence entry with a locator and your own claim about it; no field may name a Mission Contract term, and no field may declare work verified, accepted or complete.';
            continue;
          }
          throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'Prompt Architect rebuttal failed validation.', 'rebuttal_validation_failed',
            planDiagnostics({
              ...providerFacts(outcome, startedAtMs, input.config.maxOutputTokens),
              requestedModel: input.config.model, jsonParseable: true, validationPassed: false,
              outputBytes: Buffer.byteLength(outcome.outputText, 'utf8'), attempts,
            }));
        }
        return {
          workerId: input.worker.workerId,
          providerId: input.worker.providerId,
          status: 'SUCCEEDED',
          /** THE PARSED ANSWER, NOT A SANITISED ONE. Julius decides what it may refuse. */
          rebuttal: parsed,
          ...researchAsksFrom(parsed),
          safeSummary: `Prompt Architect rebuttal produced by observed model ${safeClaim(outcome.actualModel ?? 'unknown', 80)} (response ${safeClaim(outcome.responseId ?? 'unknown', 80)}).`,
          /**
           * THE ARGUMENT IS NOT EVIDENCE OF THE WORK. A rebuttal produces no
           * artifact a reviewer judges as a deliverable; what it produces is a
           * position, which Julius records on the disagreement. The task carries
           * one ARTIFACT row so the dispatch is accounted for, and its summary
           * says only which position was taken and how much was cited.
           */
          evidence: [{
            type: 'ARTIFACT',
            status: 'PASSED',
            safeSummary: `Rebuttal recorded (${outcome.outputText.length} chars).`,
            integrityHash: sha256(outcome.outputText),
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
          /**
           * WHAT IT ASKED FOR, UNTOUCHED. Julius sanitises with
           * `sanitizeJuliusResearchAsks`; an adapter that pre-cleaned the ask
           * would be deciding what the domain may refuse, and a refusal nobody
           * recorded is a worker that believes it asked.
           */
          ...researchAsksFrom(parsed),
          safeSummary: `Prompt Architect guidance produced by observed model ${safeClaim(outcome.actualModel ?? 'unknown', 80)} (response ${safeClaim(outcome.responseId ?? 'unknown', 80)}).`,
          evidence: [{
            type: 'ARTIFACT',
            status: 'PASSED',
            safeSummary: `Validated guidance packet held for this task (${outcome.outputText.length} chars).`,
            integrityHash: sha256(outcome.outputText),
            artifactRef: null,
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
        // The PRE-LOCK ask. Everything the architect could not settle from the
        // mission packet, raised before the plan becomes the agreement rather
        // than as a question nobody answers.
        ...researchAsksFrom(parsed),
        safeSummary: `Prompt Architect plan produced by observed model ${safeClaim(outcome.actualModel ?? 'unknown', 80)} (response ${safeClaim(outcome.responseId ?? 'unknown', 80)}).`,
        evidence: [{
          type: 'ARTIFACT',
          status: 'PASSED',
          safeSummary: `Validated architect plan held for this run (${outcome.outputText.length} chars).`,
          /**
           * THE DIGEST OF THE PLAN, WHOLE, IN THE COLUMN BUILT FOR IT.
           *
           * It used to be computed, cut to sixteen characters and pushed into
           * the sentence above while `integrity_hash` stayed NULL — a digest no
           * reader could compare and no body could ever be checked against.
           *
           * `artifactRef` is null because the plan lives in this process's
           * artifact exchange, and a key into a Map that dies with the process
           * is not a reference a durable row may make. Null says "unknown";
           * `plan:<runId>` said "look here" to a reader who would find nothing.
           */
          integrityHash: sha256(outcome.outputText),
          artifactRef: null,
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

/**
 * THE LOCKED CONTRACT, AS THE CODER'S CHARGE. Rendered by the domain, so every
 * coding provider — and the parity test — reads one document.
 */
export function coderContractBrief(contract: JuliusContractReviewCharge): string {
  return renderJuliusCodingAgentContract(contract);
}

/**
 * THE JULIUS SIDE OF EVERY CODING AGENT.
 *
 * Whatever implements the role — Claude Code today, Codex or Devin tomorrow —
 * this is the part that does not change when it is swapped, because none of it
 * is the provider's to decide:
 *
 *   - WHAT THE PROVIDER IS SHOWN is a governed request built by the domain from
 *     the compiled packet, sorted into sections by the authority each part
 *     carries.
 *   - WHAT IT CAN SAY BACK is a closed outcome. A provider cannot return
 *     evidence, a status or a verdict: the port has no field for one.
 *   - THE EVIDENCE is minted here, from what the independent executor observed
 *     after the provider stopped — the base revision, the diff, the test.
 *   - A FAILURE is classified by the provider and DISPOSED OF by the domain's
 *     taxonomy: transient failures are retryable, operator failures are not,
 *     and none of them produces a result.
 *   - WHAT THE WORKER ASKED FOR is read here from its closing text and handed on
 *     untouched for Julius's sanitizers to refuse.
 */
export function createJuliusCodingAgentAdapter(input: {
  readonly worker: JuliusWorker;
  readonly contexts: CompiledContextSource;
  readonly artifacts: LiveArtifactExchange;
  readonly projectId: string;
  readonly workspacePath: string;
  /** The deterministic verification command the mission declares. */
  readonly testCommand: string;
  /** Tool effects go through the independent executor, never a local shell. */
  readonly shell: ShellEffectPort;
  readonly provider: JuliusCodingAgentProvider;
  /** The mission's sealed research policy, the same source the mediator decides with. */
  readonly researchPolicyFor?: ResearchPolicySource;
  /**
   * THE MISSION'S OWN GRANT TO CREATE FILES, looked up by mission id from its
   * trusted contract. Absent, or null for a mission, means that mission's coder
   * may not create files -- the default. Never derived from a worker's proposal.
   */
  readonly fileCreationGrantFor?: FileCreationGrantSource;
}): JuliusProviderAdapter {
  return {
    adapterId: input.worker.adapterId,
    async dispatch(dispatch): Promise<JuliusProviderResult> {
      const snapshot = requireSnapshot(input.contexts, dispatch.contextId);
      const plan = input.artifacts.get(planRef(snapshot.runId));
      if (plan === null) {
        // The artifact exchange is same-process: after a restart the plan is
        // gone even though the plan TASK succeeded durably. Implementing without
        // it would silently downgrade what the mission paid the architect for.
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'The architect plan artifact is not available to this process; a resumed run cannot implement without it.');
      }

      const shellScope = {
        runId: snapshot.runId,
        projectId: input.projectId,
        taskId: dispatch.taskId,
        workerId: input.worker.workerId,
      };
      /**
       * NO EFFECT, AND NO EVIDENCE, AFTER AN ABORT. The executor steps are the
       * only way an attempt's work becomes evidence, so each one first asks
       * whether the dispatch it belongs to is still running. The coordinator has
       * already settled a cancelled dispatch; these stop the abandoned promise
       * from reading the workspace, writing a diff artifact or running the tests
       * under a claim that may by now be another attempt's.
       */
      const stopIfCancelled = (step: 'base' | 'status' | 'diff' | 'test', spent: { readonly costUsdMicros: number | null } | null): void => {
        if (dispatch.signal?.aborted !== true) return;
        throw new JuliusDispatchError('CANCELLED', false, 'The dispatch was cancelled; no further executor effect ran.', `coder_cancelled_before_${step}`, {
          runtimeStarted: spent !== null,
          ...(spent === null || spent.costUsdMicros === null ? {} : { costUsdMicros: spent.costUsdMicros }),
        });
      };
      stopIfCancelled('base', null);
      /**
       * WHERE THIS ATTEMPT STARTS, AS A TREE — and the one undo Julius allows.
       *
       * The base step used to read HEAD and nothing else, so an attempt knew
       * which commit it stood on and nothing about what the directory already
       * held. It now also records the committed tree and the working tree, so
       * the attempt's own changes can be told from what it inherited; and, when
       * Julius asked, it first puts back a refused attempt's edits — never
       * anything else, and never when the workspace has moved since.
       */
      const restoreRequest = dispatch.workspace === undefined ? null
        : { toTree: dispatch.workspace.restoreToTree, expectedTree: dispatch.workspace.expectedTree };
      const before = await input.shell.run({
        ...shellScope,
        invocationKey: `${dispatch.taskId}:base`,
        command: juliusAttemptStartCommand(restoreRequest),
        timeoutMs: CODER_EXECUTOR_STEP_TIMEOUTS_MS.base,
      });
      const attemptStart = before.status === 'SUCCEEDED'
        ? parseJuliusAttemptStart(before.stdout, restoreRequest)
        : { headRevision: null, baseTree: null, startTree: null, restore: restoreRequest === null ? null : { outcome: 'REFUSED_EXECUTOR' as const, toTree: restoreRequest.toTree, expectedTree: restoreRequest.expectedTree, observedTree: null, removed: 0, restored: 0 } };
      if (attemptStart.headRevision !== null) {
        input.artifacts.put(baseRevisionRef(snapshot.runId), attemptStart.headRevision);
      }
      // A STALE DIFF IS WORSE THAN NONE. The refs are per run; clear this
      // round's before it runs, so a later capture failure is visible as absent.
      input.artifacts.clear?.(diffRef(snapshot.runId));
      input.artifacts.clear?.(testOutputRef(snapshot.runId));

      const request = buildJuliusCodingAgentRequest({
        snapshot, taskId: dispatch.taskId, taskType: dispatch.taskType ?? 'build', contextId: dispatch.contextId,
        workspacePath: input.workspacePath, plan, contract: dispatch.contract, allocation: dispatch.allocation,
        participationProtocol: juliusParticipationProtocol(),
        researchAuthority: researchAuthorityFor(input.researchPolicyFor, snapshot.packet.missionId, input.worker.role),
        fileCreationGrant: input.fileCreationGrantFor?.(snapshot.packet.missionId) ?? null,
      });
      const outcome = await input.provider.execute(request, dispatch.signal);

      /** The close-out look at the workspace: the tree this attempt leaves, the change set, and who changed what. */
      const closeStep = () => input.shell.run({
        ...shellScope,
        invocationKey: `${dispatch.taskId}:status`,
        command: juliusAttemptCloseCommand(
          attemptStart.baseTree !== null && attemptStart.startTree !== null
            ? { baseTree: attemptStart.baseTree, startTree: attemptStart.startTree }
            : null,
        ),
        timeoutMs: CODER_EXECUTOR_STEP_TIMEOUTS_MS.status,
      });
      /** What the attempt owns, inherits and leaves — as the adapter observed it. The kernel derives `captured`. */
      const attemptRecord = (close: JuliusAttemptClose | null): Record<string, unknown> => ({
        baseTree: attemptStart.baseTree,
        startTree: attemptStart.startTree,
        endTree: close?.endTree ?? null,
        own: close?.own ?? null,
        inherited: close?.inherited ?? null,
        cumulative: close?.cumulative ?? null,
        truncated: close?.truncated ?? false,
        ...(attemptStart.restore === null ? {} : { restore: attemptStart.restore }),
      });

      if (outcome.kind === 'failed') {
        /**
         * A FAILED ATTEMPT STILL EDITED THE DIRECTORY, and those edits used to
         * reach the record only by appearing inside the NEXT attempt's diff.
         * The same close-out the successful path runs is taken here so the
         * attempt owns what it changed.
         *
         * NOT AFTER AN ABORT. PR #278's rule stands: a cancelled dispatch
         * collects no executor evidence, and the record says the snapshot was
         * not captured because the attempt was cancelled — which is UNKNOWN,
         * and never a clean workspace. A runtime that never started changed
         * nothing to look for.
         */
        const cancelled = outcome.failure === 'CANCELLED' || dispatch.signal?.aborted === true;
        const close = cancelled || !outcome.runtimeStarted
          ? null
          : await closeStep().then(
            (result) => parseJuliusAttemptClose(result.stdout, result.status === 'SUCCEEDED'),
            // The attempt already failed; a failed look at the workspace does not
            // replace its reason, and leaves the record uncaptured rather than empty.
            () => null,
          );
        /**
         * THE PROVIDER NAMES THE FAILURE; THE DOMAIN DECIDES WHAT IT MEANS.
         * The class travels with the code, the money travels with the class, and
         * nothing about a failure can become a result.
         */
        const disposition = juliusCodingAgentFailureDisposition(outcome.failure);
        throw new JuliusDispatchError(
          disposition.code, disposition.retryable, safeClaim(outcome.safeMessage, 200),
          outcome.providerFailureClass ?? juliusCodingAgentFailureClass(outcome.failure),
          {
            ...outcome.diagnostics,
            codingAgentFailure: outcome.failure,
            operatorActionRequired: disposition.operatorAction,
            runtimeStarted: outcome.runtimeStarted,
            ...(outcome.costUsdMicros === null ? {} : { costUsdMicros: outcome.costUsdMicros }),
          },
          {
            providerKind: input.provider.providerKind,
            workspace: close === null
              ? { captured: false, changes: [], truncated: false }
              : { captured: close.status.captured, changes: close.status.changes, truncated: close.status.truncated },
            attempt: attemptRecord(close),
            attemptOutcome: 'FAILED',
            ...(cancelled ? { uncapturedReason: 'DISPATCH_CANCELLED' } : {}),
          },
        );
      }

      /**
       * A PAID SESSION IS STILL PAID FOR IF WHAT FOLLOWS IT FAILS.
       *
       * The diff and the test run through the executor after the provider has
       * stopped. An executor refusal there used to carry only executor fields,
       * so the reservation was released at $0 for a session the runtime had
       * billed. The provider's cost rides on any failure from here on.
       */
      const afterSession = async <T,>(step: () => Promise<T>): Promise<T> => {
        try {
          return await step();
        } catch (error) {
          if (!(error instanceof JuliusDispatchError)) throw error;
          throw new JuliusDispatchError(error.code, error.retryable, error.safeMessage, error.failureClass, {
            ...(error.diagnostics ?? {}),
            runtimeStarted: true,
            ...(outcome.observation.costUsdMicros === null ? {} : { costUsdMicros: outcome.observation.costUsdMicros }),
          });
        }
      };

      /**
       * THE CHANGE SET, AS THE EXECUTOR SAW IT — tracked AND untracked. `git
       * diff` alone never showed a new file, so a coder whose contribution was
       * new files looked like one that had done nothing, and a new file outside
       * the agreement was invisible to everyone. Julius holds the work to the
       * locked contract from this set.
       */
      stopIfCancelled('status', outcome.observation);
      const status = await afterSession(closeStep);
      const close = parseJuliusAttemptClose(status.stdout, status.status === 'SUCCEEDED');
      const workspace = close.status;
      /**
       * THE DIFF THE REVIEWER READS, new files included: each untracked file is
       * rendered against /dev/null with plain git and a bash loop, so nothing
       * outside what the executor image already runs is needed.
       */
      stopIfCancelled('diff', outcome.observation);
      const diff = await afterSession(() => input.shell.run({
        ...shellScope,
        invocationKey: `${dispatch.taskId}:diff`,
        command: 'git --no-pager diff || exit 3; git --no-pager diff --stat; git ls-files --others --exclude-standard | while IFS= read -r file; do git --no-pager diff --no-index -- /dev/null "$file"; done; exit 0',
        timeoutMs: CODER_EXECUTOR_STEP_TIMEOUTS_MS.diff,
      }));
      if (diff.status === 'SUCCEEDED') input.artifacts.put(diffRef(snapshot.runId), diff.stdout);
      stopIfCancelled('test', outcome.observation);
      /**
       * NO CHECK DECLARED, NO CHECK RUN, NO TEST ROW. A mission whose contract
       * carries an empty test command is a report, an analysis, a plan — work
       * proven by the diff it produced, not by a suite it never had. Running an
       * empty command would be a shell no-op exiting 0, and recording that as
       * a PASSED test would be the falsest evidence this path could write. The
       * reviewer is told, in the packet, that no check was declared.
       */
      const checkDeclared = input.testCommand.trim() !== '';
      const test = checkDeclared
        ? await afterSession(() => input.shell.run({
          ...shellScope,
          invocationKey: `${dispatch.taskId}:test`,
          command: input.testCommand,
          timeoutMs: CODER_EXECUTOR_STEP_TIMEOUTS_MS.test,
        }))
        : null;
      // The body the TEST evidence is drawn from, named once so the evidence
      // can carry its digest rather than describing it.
      const testOutputText = test === null
        ? 'No deterministic check was declared by the mission contract; none was run.'
        : `exit=${test.exitCode ?? 'unknown'}\n${test.stdout}\n${test.stderr}`;
      input.artifacts.put(testOutputRef(snapshot.runId), testOutputText);

      /**
       * WHAT THE WORKER ASKED FOR, HANDED ON EXACTLY AS IT WROTE IT. Julius
       * sanitises; an adapter that pre-cleaned a request would be deciding what
       * the domain is allowed to refuse. A block that could not be read does not
       * fail the dispatch: the work is in the diff and the tests already ran.
       */
      const participation = readJuliusParticipationBlock(outcome.finalText);
      const readable = participation.present && participation.readable;
      const channels = readable
        ? {
            ...('guidanceRequest' in participation ? { guidanceRequest: participation.guidanceRequest } : {}),
            ...('researchAsks' in participation ? { researchAsks: participation.researchAsks } : {}),
            ...('segmentResume' in participation ? { segmentResume: participation.segmentResume } : {}),
            ...('architectureObservations' in participation ? { architectureObservations: participation.architectureObservations } : {}),
          }
        : {};
      const changed = workspace.changes.length > 0;
      const observation = outcome.observation;
      return {
        workerId: input.worker.workerId,
        providerId: input.worker.providerId,
        status: 'SUCCEEDED',
        ...channels,
        /**
         * WHAT HAPPENED TO THE WORKSPACE, AND WHAT THE CODER SAID ABOUT IT, for
         * Julius to hold to the agreement. The report is handed on unsanitised.
         */
        implementation: {
          providerKind: input.provider.providerKind,
          workspace,
          attempt: attemptRecord(close),
          attemptOutcome: 'SUCCEEDED',
          ...(readable && 'report' in participation ? { report: participation.report } : {}),
        },
        safeSummary: `Coding Agent session completed (${input.provider.providerKind}; observed model ${safeClaim(observation.providerModel ?? 'unknown', 80)}, ${observation.turns ?? 'unknown'} turns); tests ${test === null ? 'not declared by the mission' : test.status === 'SUCCEEDED' ? 'passed' : 'failed'} under the independent executor.`,
        evidence: [
          {
            type: 'DIFF',
            /**
             * PASSED MEANS A CHANGE WAS OBSERVED. A captured diff of nothing was
             * PASSED, so a session that changed nothing produced the same
             * evidence as one that did the work.
             */
            status: diff.status === 'SUCCEEDED' && workspace.captured && changed ? 'PASSED' : 'INCONCLUSIVE',
            safeSummary: diff.status !== 'SUCCEEDED' || !workspace.captured
              ? 'Workspace diff could not be captured by the executor.'
              : changed
                ? `Workspace diff captured by executor invocation ${diff.invocationId} (${String(workspace.changes.length)} changed path(s), ${String(workspace.changes.filter((change) => change.change === 'UNTRACKED').length)} new; ${diff.stdout.length} chars).`
                : `The executor observed no change to the workspace (invocation ${status.invocationId}).`,
            /**
             * THE DIGEST OF THE DIFF THAT WAS CAPTURED — and nothing at all
             * when none was. A digest of the empty string would be a real
             * sha256 of a body nobody produced, which is exactly the
             * plausible-looking stand-in this column must never hold.
             *
             * `artifactRef` is null for the reason it is null everywhere on
             * this path: `diff:<runId>` is a key into this process's exchange,
             * not a reference that survives it — and, being keyed per RUN, it
             * is overwritten by the next repair round anyway.
             */
            integrityHash: diff.status === 'SUCCEEDED' && workspace.captured ? sha256(diff.stdout) : null,
            artifactRef: null,
            occurredAt: nowIso(),
          },
          ...(test === null ? [] : [{
            type: 'TEST',
            status: test.status === 'SUCCEEDED' ? 'PASSED' : 'FAILED',
            safeSummary: `Deterministic test command exited ${test.exitCode ?? 'unknown'} under executor invocation ${test.invocationId}.`,
            // The test output had no digest and no reference at all: the record
            // named an exit code and described output nobody could identify.
            integrityHash: sha256(testOutputText),
            artifactRef: null,
            occurredAt: nowIso(),
          }]),
        ],
        diagnostics: { ...observation.diagnostics, codingAgentProvider: input.provider.providerKind },
        usage: {
          inputTokens: observation.inputTokens ?? undefined,
          outputTokens: observation.outputTokens ?? undefined,
          usdMicros: observation.costUsdMicros ?? undefined,
          // INVOCATIONS, not distinct tool names.
          toolCalls: observation.toolInvocations ?? undefined,
          /**
           * `PROVIDER_REPORTED` only when the provider actually reported a figure.
           * Anything else is UNKNOWN, which the ledger holds as an unreleased
           * reservation rather than a settlement of zero.
           */
          costBasis: observation.costBasis,
        },
      };
    },
  };
}

/**
 * THE LIVE CODING AGENT: the Julius side above, with Claude Code behind the port.
 * The name and the configuration stay, so the composition and every existing
 * caller are unchanged.
 */
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
  /** The mission's sealed research policy, the same source the mediator decides with. */
  readonly researchPolicyFor?: ResearchPolicySource;
  /** The mission's own file-creation grant, by mission id. Absent means no mission may create files. */
  readonly fileCreationGrantFor?: FileCreationGrantSource;
  readonly run?: typeof runHostedCodingAgent;
  readonly queryLoader?: () => Promise<HostedQueryFn>;
}): JuliusProviderAdapter {
  // `testCommand` is deliberately NOT in this guard. Empty means the mission
  // declared no deterministic check, which is a valid mission and not a missing
  // configuration; the dispatch below runs nothing and records no TEST row.
  if (!input.apiKey || !input.requestedModel || !input.workspacePath) {
    throw new Error('hosted_coding_adapter_requires_live_config');
  }
  return createJuliusCodingAgentAdapter({
    worker: input.worker, contexts: input.contexts, artifacts: input.artifacts, projectId: input.projectId,
    workspacePath: input.workspacePath, testCommand: input.testCommand, shell: input.shell,
    ...(input.researchPolicyFor === undefined ? {} : { researchPolicyFor: input.researchPolicyFor }),
    ...(input.fileCreationGrantFor === undefined ? {} : { fileCreationGrantFor: input.fileCreationGrantFor }),
    provider: createClaudeCodeCodingAgentProvider({
      apiKey: input.apiKey, requestedModel: input.requestedModel,
      ...(input.run === undefined ? {} : { run: input.run }),
      ...(input.queryLoader === undefined ? {} : { queryLoader: input.queryLoader }),
    }),
  });
}

/* -------------------------------------------------- independent reviewer */

export function createLiveHermesReviewerAdapter(input: {
  readonly worker: JuliusWorker;
  readonly contexts: CompiledContextSource;
  readonly artifacts: LiveArtifactExchange;
  readonly config: HermesConfig;
  readonly testCommand: string;
  /** The mission's sealed research policy, the same source the mediator decides with. */
  readonly researchPolicyFor?: ResearchPolicySource;
  readonly run?: typeof runHermesReview;
  /** The backoff before a transient re-ask. Injectable so a proof does not wait it out. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /**
   * How many transient re-asks one dispatch may buy. `REVIEW_TRANSIENT_REASK_LIMIT`
   * unless a proof says otherwise; production never passes it. It is an input
   * so the deadline arithmetic ACROSS re-asks can be observed at all — under
   * the policy's own limit of one, nothing reads the consumed time after the
   * one backoff, and an accounting error there would be invisible until the
   * day the limit changed.
   */
  readonly transientReaskLimit?: number;
}): JuliusProviderAdapter {
  if (!input.config.executable || !input.config.model || !input.config.provider) {
    throw new Error('hermes_reviewer_adapter_requires_live_config');
  }
  const run = input.run ?? runHermesReview;
  const sleep = input.sleep ?? abortableSleep;
  const transientReaskLimit = input.transientReaskLimit ?? REVIEW_TRANSIENT_REASK_LIMIT;
  if (!Number.isSafeInteger(transientReaskLimit) || transientReaskLimit < 0) throw new Error('hermes_reviewer_adapter_reask_limit_invalid');
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
        ...(input.researchPolicyFor === undefined ? {} : {
          researchAuthority: researchAuthorityFor(input.researchPolicyFor, snapshot.packet.missionId, input.worker.role),
        }),
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
       * output are not shape defects: the first two are answers that never
       * arrived and take the bounded transient re-ask below, the rest need a
       * human or a smaller request, and re-asking would spend for nothing.
       * `review_output_too_large` is deliberately excluded — a runaway answer
       * asked again is a second runaway answer.
       */
      let reviewAttempts = 0;
      let reviewCorrection: string | undefined;
      let reviewReaskShape: string | null = null;
      /**
       * ONE BOUNDED RE-ASK FOR A TRANSIENT STATUS, INSIDE THE SAME DEADLINE.
       *
       * `review_service_unavailable` is `retryable: true` and a review stage
       * gets ONE pipeline attempt, so on the live path the retryable shape
       * reached a pipeline with nothing left to spend on it and a single 429
       * ended the mission. `review_timeout` is the same gap, and the one the
       * paid record actually shows: both of the last two COMPLETED missions had
       * a first review attempt time out and a second ask complete it (see
       * `REVIEW_TRANSIENT_REASK_SHAPES`). The pipeline's rule stands — a second task attempt
       * is a blind retry — and this is not one: the answer never arrived, the
       * adapter asks once more after a short backoff, and only when the
       * declared deadline still holds a whole review after what the first ask
       * consumed. The second run is given the REMAINING window, so the adapter
       * still stops before the deadline Julius enforces around the dispatch.
       *
       * The time consumed is read from the runner's own two instants on each
       * incomplete outcome, and a duration that cannot be established refuses
       * the re-ask rather than counting as nothing.
       */
      let transientReasks = 0;
      let consumedMs: number | null = 0;
      let runConfig: HermesConfig = input.config;
      let outcome: HermesOutcome;
      for (;;) {
      reviewAttempts += 1;
      outcome = await run({ packet: { ...packet, ...(reviewCorrection === undefined ? {} : { correction: reviewCorrection }) }, config: runConfig });
      if (outcome.kind === 'review_incomplete') {
        const started = Date.parse(outcome.startedAt);
        const completed = Date.parse(outcome.completedAt);
        consumedMs = consumedMs !== null && Number.isFinite(started) && Number.isFinite(completed) && completed >= started
          ? consumedMs + (completed - started)
          : null;
      }
      if (outcome.kind === 'review_incomplete' && correctionAffordable(dispatch.allocation)) {
        if (reviewAttempts < REVIEW_ATTEMPT_LIMIT) {
          const remedy = reviewCorrectionFor(outcome.shape);
          if (remedy !== null) { reviewCorrection = remedy; reviewReaskShape = outcome.shape; continue; }
        }
        if (REVIEW_TRANSIENT_REASK_SHAPES.has(outcome.shape) && transientReasks < transientReaskLimit && dispatch.signal?.aborted !== true) {
          const decision = reviewerReaskWithinDeadline({ deadlineMs: input.config.timeoutMs, consumedMs, backoffMs: REVIEW_TRANSIENT_REASK_BACKOFF_MS });
          if (decision.allowed) {
            transientReasks += 1;
            reviewReaskShape = outcome.shape;
            await sleep(REVIEW_TRANSIENT_REASK_BACKOFF_MS, dispatch.signal);
            // A cancellation that landed during the backoff wins: the transient
            // failure surfaces as it is, and nothing further is bought. Read
            // through a call, because flow analysis still believes the signal
            // it checked before the await.
            if (signalAborted(dispatch.signal)) break;
            // What the dispatch has consumed so far: what the decision was made
            // against plus the backoff just waited out — read back off the
            // decision rather than restated beside it.
            consumedMs = input.config.timeoutMs - decision.remainingMs;
            runConfig = { ...input.config, timeoutMs: decision.remainingMs };
            continue;
          }
        }
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
                : outcome.shape === 'review_request_rejected' || outcome.shape === 'review_content_refused'
                  // The request is what has to change, so repeating it verbatim
                  // only spends the attempt. Never the provider's fault — and a
                  // model that DECLINED the request itself belongs here for the
                  // same reason, carried as the code the Coding Agent's
                  // CONTENT_REFUSED carries so one phenomenon has one code.
                  ? ['INVALID_REQUEST', false] as const
                  // THE ENGINE'S OWN GIVE-UPS, each named for what clears it.
                  // Exhausted credits and a provider the engine already retried
                  // are the provider's; a context ceiling is the request's. None
                  // is re-asked blindly — the invalid tool call is corrected in
                  // the loop above, and reaches here only if that correction was
                  // not affordable or also failed.
                  : outcome.shape === 'review_engine_billing_exhausted' || outcome.shape === 'review_engine_gave_up'
                    ? ['PROVIDER_UNAVAILABLE', false] as const
                    : outcome.shape === 'review_engine_context_exceeded'
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
            diagnostics: outcome.diagnostics, stage, reviewAttempts, reviewReaskShape,
            startedAt: outcome.startedAt, completedAt: outcome.completedAt,
            // A FAILED REVIEW STILL ACCOUNTS FOR WHAT IT BOUGHT: tokens, calls
            // and the served model, from the file Hermes writes on failure too.
            ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
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
        /**
         * WHAT THE REVIEWER COULD NOT CHECK FROM THE PACKET ALONE.
         *
         * A reviewer with no way to look anything up has to accept a claim or
         * refuse it on suspicion; this is the third door, and it is the same
         * door the other two slots have.
         */
        ...(outcome.result.researchAsks === undefined ? {} : { researchAsks: outcome.result.researchAsks }),
        /**
         * WHAT THE REVIEWER CONCLUDED, IN JULIUS'S VOCABULARY. The evidence above
         * stays exactly as it was — Julius takes the stricter of the two — so a
         * reviewer's WARNING is retained where it used to be dropped, and a
         * challenge or a block can be said at all.
         */
        reviewVerdict: hermesReviewVerdict(outcome.result),
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
          diagnostics: outcome.diagnostics, stage, reviewAttempts, reviewReaskShape,
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
