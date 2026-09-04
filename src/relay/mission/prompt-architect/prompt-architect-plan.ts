import type {
  ArchitectHandoffProposal,
  ArchitectPlan,
} from './prompt-architect-contracts';

/**
 * PLAN VALIDATION AND HANDOFF BOUNDING — the gate every model answer passes
 * before it becomes anything a person can approve.
 *
 * Two jobs:
 *  1. VALIDATE. A structure that is malformed, truncated, or missing a
 *     required field is REJECTED. It never becomes a partial plan and never
 *     becomes an approved handoff.
 *  2. BOUND. A generated handoff can only ever be the INTERSECTION of what
 *     the model proposed and what the Mission Contract already permits.
 *     Generated text cannot widen file scope or grant a tool.
 */

/**
 * WHY A PLAN WAS REFUSED, as a machine token.
 *
 * Paid attempt #3 (run 33897565981) bought a real GPT-5.6 Sol answer that
 * parsed as JSON and then failed this validator — and the durable record held
 * `plan_validation_failed` and nothing else, because the coordinator persists
 * the code, the retryable flag and the failure CLASS, never the message. So
 * the artifact built to explain a paid failure could not say WHICH rule was
 * broken, and a fourth paid run was the only way to learn more. That is the
 * same opacity the reviewer shapes were added to close, on the other role.
 *
 * CLOSED VOCABULARY. These are tokens this repository chose, not validator
 * prose, so nothing a model wrote can travel inside one.
 */
export type ArchitectPlanReasonCode =
  | 'plan_object_invalid'
  | 'objective_summary_empty'
  | 'required_array_invalid'
  | 'required_string_array_invalid'
  | 'decision_object_invalid'
  | 'decision_statement_empty'
  | 'decision_rationale_empty'
  | 'decision_pre_accepted'
  | 'assumption_statement_empty'
  | 'handoff_missing'
  | 'handoff_objective_empty'
  | 'handoff_bounded_task_empty'
  | 'handoff_array_invalid'
  | 'handoff_allowed_scope_empty'
  | 'plan_false_work_claim';

export type PlanValidation =
  | { readonly ok: true; readonly plan: ArchitectPlan }
  | {
    readonly ok: false;
    readonly reason: string;
    readonly reasonCode: ArchitectPlanReasonCode;
    /**
     * The field the rule was about, when one rule covers many fields. Always a
     * literal from the lists below — never text a model produced.
     */
    readonly reasonField?: string;
  };

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Strict validation of a returned plan. Deliberately unforgiving: a model
 * that answers with the right words in the wrong shape has not produced a
 * plan Relay can act on.
 */
export function validateArchitectPlan(raw: unknown): PlanValidation {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'structured output is not an object', reasonCode: 'plan_object_invalid' };
  }
  const v = raw as Record<string, unknown>;

  if (!nonEmptyString(v.objectiveSummary)) {
    return { ok: false, reason: 'objectiveSummary is missing or empty', reasonCode: 'objective_summary_empty' };
  }
  for (const key of ['assumptions', 'unresolvedQuestions', 'requirements',
    'architectureDecisions', 'implementationSteps', 'risks']) {
    if (!Array.isArray(v[key])) return { ok: false, reason: `${key} must be an array`, reasonCode: 'required_array_invalid', reasonField: key };
  }
  for (const key of ['acceptanceCriteria', 'testPlan', 'prohibitedActions',
    'proposedContractAmendments', 'contextRefs']) {
    if (!isStringArray(v[key])) return { ok: false, reason: `${key} must be an array of strings`, reasonCode: 'required_string_array_invalid', reasonField: key };
  }

  // Every proposed decision must arrive UNACCEPTED. A model claiming its own
  // decision is accepted is exactly the untruth this gate exists to stop.
  for (const decision of v.architectureDecisions as unknown[]) {
    if (decision === null || typeof decision !== 'object') {
      return { ok: false, reason: 'architectureDecisions contains a non-object', reasonCode: 'decision_object_invalid' };
    }
    const d = decision as Record<string, unknown>;
    // Split for the CODE only: the message is unchanged, and each half now
    // names which of the two was missing.
    if (!nonEmptyString(d.decision)) {
      return { ok: false, reason: 'an architecture decision is missing its statement or rationale', reasonCode: 'decision_statement_empty' };
    }
    if (!nonEmptyString(d.rationale)) {
      return { ok: false, reason: 'an architecture decision is missing its statement or rationale', reasonCode: 'decision_rationale_empty' };
    }
    if (d.accepted === true) {
      return { ok: false, reason: 'a proposed decision may not arrive pre-accepted', reasonCode: 'decision_pre_accepted' };
    }
  }

  for (const assumption of v.assumptions as unknown[]) {
    const a = assumption as Record<string, unknown>;
    if (a === null || typeof a !== 'object' || !nonEmptyString(a.statement)) {
      return { ok: false, reason: 'an assumption is missing its statement', reasonCode: 'assumption_statement_empty' };
    }
  }

  const handoff = v.handoff;
  if (handoff === null || typeof handoff !== 'object') {
    return { ok: false, reason: 'handoff is missing', reasonCode: 'handoff_missing' };
  }
  const h = handoff as Record<string, unknown>;
  if (!nonEmptyString(h.objective)) {
    return { ok: false, reason: 'handoff is missing its objective or bounded task', reasonCode: 'handoff_objective_empty' };
  }
  if (!nonEmptyString(h.boundedTask)) {
    return { ok: false, reason: 'handoff is missing its objective or bounded task', reasonCode: 'handoff_bounded_task_empty' };
  }
  for (const key of ['acceptanceCriteria', 'requiredTests', 'allowedFileScope',
    'prohibitedActions', 'grantedTools', 'expectedEvidence']) {
    if (!isStringArray(h[key])) {
      return { ok: false, reason: `handoff.${key} must be an array of strings`, reasonCode: 'handoff_array_invalid', reasonField: `handoff.${key}` };
    }
  }
  if ((h.allowedFileScope as string[]).length === 0) {
    // An unbounded handoff is not a bounded handoff.
    return { ok: false, reason: 'handoff.allowedFileScope must name at least one path', reasonCode: 'handoff_allowed_scope_empty' };
  }

  // No field may claim work already happened.
  const serialized = JSON.stringify(v).toLowerCase();
  for (const claim of ['files were edited', 'tests were run', 'i ran the tests', 'i edited']) {
    if (serialized.includes(claim)) {
      return { ok: false, reason: `plan claims work that did not happen: "${claim}"`, reasonCode: 'plan_false_work_claim' };
    }
  }

  return { ok: true, plan: normalizePlan(v) };
}

function normalizePlan(v: Record<string, unknown>): ArchitectPlan {
  const h = v.handoff as Record<string, unknown>;
  return {
    objectiveSummary: v.objectiveSummary as string,
    assumptions: (v.assumptions as Record<string, unknown>[]).map((a, i) => ({
      id: typeof a.id === 'string' ? a.id : `A${i + 1}`,
      statement: a.statement as string,
      confidence: a.confidence === 'high' || a.confidence === 'low' ? a.confidence : 'medium',
    })),
    unresolvedQuestions: (v.unresolvedQuestions as Record<string, unknown>[]).map((q, i) => ({
      id: typeof q.id === 'string' ? q.id : `Q${i + 1}`,
      question: String(q.question ?? ''),
      blocksImplementation: q.blocksImplementation === true,
    })),
    requirements: (v.requirements as Record<string, unknown>[]).map((r, i) => ({
      id: typeof r.id === 'string' ? r.id : `R${i + 1}`,
      statement: String(r.statement ?? ''),
      rationale: String(r.rationale ?? ''),
    })),
    architectureDecisions: (v.architectureDecisions as Record<string, unknown>[]).map((d, i) => ({
      id: typeof d.id === 'string' ? d.id : `D${i + 1}`,
      decision: d.decision as string,
      rationale: d.rationale as string,
      alternativesConsidered: isStringArray(d.alternativesConsidered) ? d.alternativesConsidered : [],
      // Forced: approval is never something the model can assert.
      accepted: false,
    })),
    implementationSteps: (v.implementationSteps as Record<string, unknown>[]).map((s, i) => ({
      order: typeof s.order === 'number' ? s.order : i + 1,
      description: String(s.description ?? ''),
      filesTouched: isStringArray(s.filesTouched) ? s.filesTouched : [],
    })),
    acceptanceCriteria: v.acceptanceCriteria as string[],
    testPlan: v.testPlan as string[],
    risks: (v.risks as Record<string, unknown>[]).map((r, i) => ({
      id: typeof r.id === 'string' ? r.id : `RISK${i + 1}`,
      risk: String(r.risk ?? ''),
      mitigation: String(r.mitigation ?? ''),
      severity: r.severity === 'high' || r.severity === 'low' ? r.severity : 'medium',
    })),
    prohibitedActions: v.prohibitedActions as string[],
    handoff: {
      objective: h.objective as string,
      boundedTask: h.boundedTask as string,
      acceptanceCriteria: h.acceptanceCriteria as string[],
      requiredTests: h.requiredTests as string[],
      allowedFileScope: h.allowedFileScope as string[],
      prohibitedActions: h.prohibitedActions as string[],
      grantedTools: h.grantedTools as string[],
      missionContractRef: typeof h.missionContractRef === 'string' ? h.missionContractRef : '',
      environmentRef: typeof h.environmentRef === 'string' ? h.environmentRef : null,
      expectedEvidence: h.expectedEvidence as string[],
    },
    proposedContractAmendments: v.proposedContractAmendments as string[],
    contextRefs: v.contextRefs as string[],
  };
}

/* --------------------------------------------------------------- bounding */

export interface MissionContractBounds {
  readonly missionContractRef: string;
  readonly environmentRef: string | null;
  /** Paths the contract already allows. The handoff can only narrow these. */
  readonly allowedFileScope: readonly string[];
  /** Tools the contract already grants. Generated text cannot add one. */
  readonly grantedTools: readonly string[];
  readonly prohibitedActions: readonly string[];
}

export interface BoundedHandoff {
  readonly handoff: ArchitectHandoffProposal;
  /** Anything the model asked for that the contract does not permit. */
  readonly rejectedFileScope: readonly string[];
  readonly rejectedTools: readonly string[];
}

/**
 * INTERSECT the proposal with the Mission Contract. This is the guarantee
 * that a generated plan can never widen permissions: a path or tool the
 * contract does not already allow is dropped and reported, never granted.
 */
export function boundHandoff(
  proposal: ArchitectHandoffProposal,
  bounds: MissionContractBounds,
): BoundedHandoff {
  const allowedScope = proposal.allowedFileScope.filter((p) => bounds.allowedFileScope.includes(p));
  const rejectedFileScope = proposal.allowedFileScope.filter(
    (p) => !bounds.allowedFileScope.includes(p),
  );
  const grantedTools = proposal.grantedTools.filter((t) => bounds.grantedTools.includes(t));
  const rejectedTools = proposal.grantedTools.filter((t) => !bounds.grantedTools.includes(t));

  return {
    handoff: {
      ...proposal,
      allowedFileScope: allowedScope,
      grantedTools,
      // Prohibitions only ever accumulate — the union, never the intersection.
      prohibitedActions: [
        ...new Set([...bounds.prohibitedActions, ...proposal.prohibitedActions]),
      ],
      // Identity comes from the contract, not from generated text.
      missionContractRef: bounds.missionContractRef,
      environmentRef: bounds.environmentRef,
    },
    rejectedFileScope,
    rejectedTools,
  };
}

/** Does this plan still need a human decision before implementation? */
export function planNeedsInput(plan: ArchitectPlan): boolean {
  return plan.unresolvedQuestions.some((q) => q.blocksImplementation);
}
