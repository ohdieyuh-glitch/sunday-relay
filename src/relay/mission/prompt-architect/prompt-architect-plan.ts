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

  // No CLAIM FIELD may say work already happened.
  const claim = findFalseWorkClaim(v);
  if (claim !== null) {
    return {
      ok: false,
      reason: `plan claims work that did not happen: "${claim.phrase}"`,
      reasonCode: 'plan_false_work_claim',
      // BOTH HALVES, and both are safe. The phrase is one of four literals this
      // file owns, and the path is structural. Paid run 34185920678 refused a
      // 14,581-byte plan with this code and nothing else, and there was no way
      // to tell a real completion claim from a prohibition that names one.
      reasonField: `${claim.path} :: ${claim.phrase}`,
    };
  }

  return { ok: true, plan: normalizePlan(v) };
}

/**
 * THE FOUR PHRASES A PLAN MAY NOT CLAIM, and the fields that may nonetheless
 * contain them.
 *
 * WHY THIS IS NOT A SUBSTRING SCAN OVER THE WHOLE DOCUMENT ANY MORE.
 *
 * The architect's charter tells it, in these words, never to say that files
 * were edited or that tests were run. The plan schema then asks it for
 * `prohibitedActions` and `handoff.prohibitedActions` — lists whose entire
 * purpose is to state what must NOT be done. A plan that lists "claiming that
 * files were edited before the Coding Agent runs" as a prohibited action is
 * doing exactly what it was asked to do, and `JSON.stringify(plan)` could not
 * tell that apart from the plan opening with "Done — I edited the files."
 *
 * Paid run 34185920678 died on that ambiguity: a schema-valid 14,581-byte plan
 * from `gpt-5.6-sol` was refused with `plan_false_work_claim` and no field, no
 * phrase and no path, so nobody could say which of the two it was. The mission
 * spent the architect's dispatch and produced no plan.
 *
 * THE RULE IS NOT WEAKENED — it is aimed. A completion claim is a claim, and a
 * claim lives in a field that ASSERTS. The two prohibition lists ASSERT NOTHING;
 * they forbid. Every other string in the document is still scanned, including
 * risks, assumptions, decisions, steps, criteria, the test plan and the whole of
 * the handoff apart from its prohibitions — so `objectiveSummary` saying "I
 * edited the fixture" is refused exactly as before.
 *
 * The walk reports WHERE, which is the other half of the repair: a refusal that
 * cannot be explained is a refusal nobody can act on.
 */
const FALSE_WORK_CLAIMS = ['files were edited', 'tests were run', 'i ran the tests', 'i edited'] as const;

/**
 * The fields whose content is a PROHIBITION rather than an assertion. Named as
 * exact paths, not as a key name: a key called `prohibitedActions` appearing
 * somewhere unexpected must not silently become an exemption.
 */
const CLAIM_EXEMPT_PATHS = new Set(['plan.prohibitedActions', 'plan.handoff.prohibitedActions']);

/**
 * A PATH SEGMENT IS ONLY EMITTED IF IT IS A NAME, NOT PROSE.
 *
 * The walk descends through `Object.keys`, and those keys come from the MODEL's
 * JSON. A plan that nested a claim under a key the model invented would put
 * that key into `reasonField`, which reaches the published evidence bundle —
 * the one place this repository refuses to put model-authored text. So each
 * segment is held to the same alphabet `safeFailureClass` uses, and anything
 * else becomes a placeholder that still says a level was descended.
 *
 * The workflow's credential scan is the second layer, and this is deliberately
 * not left to it: a bundle is refused wholesale when that scan fires, so a
 * model-chosen key would cost the evidence for the whole run.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const safeSegment = (key: string): string => (SAFE_PATH_SEGMENT.test(key) ? key : '<field>');

function findFalseWorkClaim(value: unknown, path = 'plan'): { path: string; phrase: string } | null {
  // The exemption is checked on the SANITISED path, which is the same string a
  // schema-conforming plan produces: `prohibitedActions` is a safe segment, so
  // the real field still matches, and a model-chosen key that sanitised to
  // `<field>` never can.
  if (CLAIM_EXEMPT_PATHS.has(path)) return null;
  if (typeof value === 'string') {
    const haystack = value.toLowerCase();
    const phrase = FALSE_WORK_CLAIMS.find((candidate) => haystack.includes(candidate));
    return phrase === undefined ? null : { path, phrase };
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findFalseWorkClaim(item, `${path}[${index}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    // Sorted, so the reported path is the same one every time for a plan that
    // trips the rule twice. A diagnostic that moves is a diagnostic nobody trusts.
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const found = findFalseWorkClaim((value as Record<string, unknown>)[key], `${path}.${safeSegment(key)}`);
      if (found !== null) return found;
    }
  }
  return null;
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
