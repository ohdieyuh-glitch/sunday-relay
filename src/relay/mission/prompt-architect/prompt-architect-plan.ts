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

export type PlanValidation =
  | { readonly ok: true; readonly plan: ArchitectPlan }
  | { readonly ok: false; readonly reason: string };

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
    return { ok: false, reason: 'structured output is not an object' };
  }
  const v = raw as Record<string, unknown>;

  if (!nonEmptyString(v.objectiveSummary)) {
    return { ok: false, reason: 'objectiveSummary is missing or empty' };
  }
  for (const key of ['assumptions', 'unresolvedQuestions', 'requirements',
    'architectureDecisions', 'implementationSteps', 'risks']) {
    if (!Array.isArray(v[key])) return { ok: false, reason: `${key} must be an array` };
  }
  for (const key of ['acceptanceCriteria', 'testPlan', 'prohibitedActions',
    'proposedContractAmendments', 'contextRefs']) {
    if (!isStringArray(v[key])) return { ok: false, reason: `${key} must be an array of strings` };
  }

  // Every proposed decision must arrive UNACCEPTED. A model claiming its own
  // decision is accepted is exactly the untruth this gate exists to stop.
  for (const decision of v.architectureDecisions as unknown[]) {
    if (decision === null || typeof decision !== 'object') {
      return { ok: false, reason: 'architectureDecisions contains a non-object' };
    }
    const d = decision as Record<string, unknown>;
    if (!nonEmptyString(d.decision) || !nonEmptyString(d.rationale)) {
      return { ok: false, reason: 'an architecture decision is missing its statement or rationale' };
    }
    if (d.accepted === true) {
      return { ok: false, reason: 'a proposed decision may not arrive pre-accepted' };
    }
  }

  for (const assumption of v.assumptions as unknown[]) {
    const a = assumption as Record<string, unknown>;
    if (a === null || typeof a !== 'object' || !nonEmptyString(a.statement)) {
      return { ok: false, reason: 'an assumption is missing its statement' };
    }
  }

  const handoff = v.handoff;
  if (handoff === null || typeof handoff !== 'object') {
    return { ok: false, reason: 'handoff is missing' };
  }
  const h = handoff as Record<string, unknown>;
  if (!nonEmptyString(h.objective) || !nonEmptyString(h.boundedTask)) {
    return { ok: false, reason: 'handoff is missing its objective or bounded task' };
  }
  for (const key of ['acceptanceCriteria', 'requiredTests', 'allowedFileScope',
    'prohibitedActions', 'grantedTools', 'expectedEvidence']) {
    if (!isStringArray(h[key])) {
      return { ok: false, reason: `handoff.${key} must be an array of strings` };
    }
  }
  if ((h.allowedFileScope as string[]).length === 0) {
    // An unbounded handoff is not a bounded handoff.
    return { ok: false, reason: 'handoff.allowedFileScope must name at least one path' };
  }

  // No field may claim work already happened.
  const serialized = JSON.stringify(v).toLowerCase();
  for (const claim of ['files were edited', 'tests were run', 'i ran the tests', 'i edited']) {
    if (serialized.includes(claim)) {
      return { ok: false, reason: `plan claims work that did not happen: "${claim}"` };
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
