/**
 * THE STRICT JSON SCHEMA the Prompt Architect answers an ARCHITECTURE
 * CONSULTATION with.
 *
 * Julius goes back to the architect when the record says the design moved, and
 * once more before a run may call itself complete. The answer has two halves
 * and both are required: the architecture the architect now holds, and its
 * assessment of whether what was built matches it.
 *
 * THE SAFETY PROPERTY IS THE ABSENCE, exactly as it is for guidance and for a
 * rebuttal. `additionalProperties: false` with a complete `required` list means
 * a strict model cannot express `objective`, `blockingAcceptanceCriteria`,
 * `permittedPaths`, `budget`, a verdict or a completion: there is no key to put
 * one in. `sanitizeJuliusArchitecture` and `sanitizeJuliusConsistency` refuse
 * those names again on the way in, through the same peer authority guard every
 * other peer response passes, and `architecture-schema-parity.test.ts` holds
 * this file against the domain's own limits and vocabularies.
 *
 * THE ASSESSMENT IS NOT A VERDICT. `assessment` cannot say VERIFIED, ACCEPTED
 * or COMPLETE — the enum has four values and none of them is a completion. The
 * strongest thing an architect can do here is refuse to let a completion happen.
 */

export const ARCHITECT_CONSULTATION_SCHEMA_NAME = 'relay_prompt_architect_architecture';

/** The top-level keys, in one place: the schema below and the parity test both read this. */
export const ARCHITECT_CONSULTATION_KEYS: readonly string[] = Object.freeze(['architecture', 'consistency']);

export const ARCHITECT_ARCHITECTURE_KEYS: readonly string[] = Object.freeze([
  'components', 'boundaries', 'dependencies', 'decisions', 'assumptions', 'openQuestions', 'risks',
]);

export const ARCHITECT_CONSISTENCY_KEYS: readonly string[] = Object.freeze([
  'assessment', 'claim', 'drift', 'driftingTaskIds', 'evidenceRefs',
]);

/**
 * THE EIGHT KINDS OF EDGE A DESIGN DECLARES — and, not by accident, the eight
 * kinds of change that are MATERIAL. A drift item may also name a cosmetic
 * kind, and then it cannot carry a blocking assessment: the domain refuses a
 * repair or a re-plan demanded on the strength of a rename.
 */
const BOUNDARY_KINDS = [
  'INTERFACE', 'SCHEMA', 'DEPENDENCY', 'OWNERSHIP', 'SECURITY', 'CONCURRENCY', 'PERSISTENCE', 'INVARIANT',
] as const;
const COSMETIC_KINDS = ['NAMING', 'FORMATTING', 'COMMENT', 'DOCUMENTATION', 'LOGGING', 'TEST_ONLY'] as const;

const component = {
  type: 'object', additionalProperties: false,
  required: ['name', 'responsibility'],
  properties: { name: { type: 'string' }, responsibility: { type: 'string' } },
} as const;

const boundary = {
  type: 'object', additionalProperties: false,
  required: ['name', 'kind', 'contract', 'locator'],
  properties: {
    name: { type: 'string' },
    kind: { type: 'string', enum: [...BOUNDARY_KINDS] },
    contract: { type: 'string' },
    /** Where it lives, so a conflict with the permitted paths is checkable. Null when there is no one place. */
    locator: { type: ['string', 'null'] },
  },
} as const;

const dependency = {
  type: 'object', additionalProperties: false,
  required: ['name', 'assumption', 'locator'],
  properties: {
    name: { type: 'string' },
    /** What the design assumes about it. A dependency with no assumption is a name, not a design. */
    assumption: { type: 'string' },
    locator: { type: ['string', 'null'] },
  },
} as const;

const decision = {
  type: 'object', additionalProperties: false,
  required: ['decisionId', 'decision', 'reason', 'rejectedAlternatives', 'evidenceRefs'],
  properties: {
    decisionId: { type: 'string' },
    decision: { type: 'string' },
    reason: { type: 'string' },
    /** What was considered and turned down. Re-proposing it is the commonest way a mission goes round twice. */
    rejectedAlternatives: { type: 'array', items: { type: 'string' } },
    evidenceRefs: { type: 'array', items: { type: 'string' } },
  },
} as const;

const assumption = {
  type: 'object', additionalProperties: false,
  required: ['assumptionId', 'claim', 'state', 'evidenceRefs'],
  properties: {
    assumptionId: { type: 'string' },
    claim: { type: 'string' },
    state: { type: 'string', enum: ['HOLDS', 'UNVERIFIED', 'INVALIDATED'] },
    evidenceRefs: { type: 'array', items: { type: 'string' } },
  },
} as const;

const question = {
  type: 'object', additionalProperties: false,
  required: ['questionId', 'question', 'owner', 'blocking'],
  properties: {
    questionId: { type: 'string' },
    question: { type: 'string' },
    owner: { type: 'string' },
    blocking: { type: 'boolean' },
  },
} as const;

const risk = {
  type: 'object', additionalProperties: false,
  required: ['riskId', 'risk', 'impact', 'mitigation'],
  properties: {
    riskId: { type: 'string' },
    risk: { type: 'string' },
    impact: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    mitigation: { type: 'string' },
  },
} as const;

const drift = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'name', 'claim'],
  properties: {
    kind: { type: 'string', enum: [...BOUNDARY_KINDS, ...COSMETIC_KINDS] },
    name: { type: 'string' },
    claim: { type: 'string' },
  },
} as const;

export const ARCHITECT_ARCHITECTURE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: [...ARCHITECT_ARCHITECTURE_KEYS],
  properties: {
    components: { type: 'array', items: component },
    boundaries: { type: 'array', items: boundary },
    dependencies: { type: 'array', items: dependency },
    decisions: { type: 'array', items: decision },
    assumptions: { type: 'array', items: assumption },
    openQuestions: { type: 'array', items: question },
    risks: { type: 'array', items: risk },
  },
} as const;

export const ARCHITECT_CONSISTENCY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: [...ARCHITECT_CONSISTENCY_KEYS],
  properties: {
    /**
     * FOUR ANSWERS, AND NONE OF THEM IS A COMPLETION. ALIGNED means nothing
     * drifted; DRIFT_NON_BLOCKING records drift that does not need fixing;
     * DRIFT_REQUIRES_REPAIR and REPLAN_REQUIRED each HOLD the run rather than
     * failing it, and each needs material drift and evidence behind it.
     */
    assessment: { type: 'string', enum: ['ALIGNED', 'DRIFT_NON_BLOCKING', 'DRIFT_REQUIRES_REPAIR', 'REPLAN_REQUIRED'] },
    claim: { type: 'string' },
    drift: { type: 'array', items: drift },
    /**
     * THE WORK THAT DRIFTED, by task id. A schema cannot express "required only
     * when DRIFT_REQUIRES_REPAIR", so the array is always present and the domain
     * refuses an empty one on that assessment — Julius will not guess which work
     * is wrong.
     */
    driftingTaskIds: { type: 'array', items: { type: 'string' } },
    evidenceRefs: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const ARCHITECT_CONSULTATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: [...ARCHITECT_CONSULTATION_KEYS],
  properties: {
    architecture: ARCHITECT_ARCHITECTURE_SCHEMA,
    consistency: ARCHITECT_CONSISTENCY_SCHEMA,
  },
} as const;
