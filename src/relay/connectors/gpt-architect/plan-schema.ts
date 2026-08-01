/**
 * THE STRICT JSON SCHEMA the Prompt Architect must answer with.
 *
 * `strict: true` on the Responses API means the model is constrained to this
 * exact shape, which is why `additionalProperties: false` and complete
 * `required` arrays appear at every level — the API rejects a strict schema
 * without them. Relay still re-validates the parsed result itself: a schema
 * constrains SHAPE, not truthfulness.
 *
 * `accepted` is pinned to `false` in the schema so the model cannot even
 * express a self-approved decision.
 */

export const ARCHITECT_PLAN_SCHEMA_NAME = 'relay_prompt_architect_plan';

const stringArray = { type: 'array', items: { type: 'string' } } as const;

export const ARCHITECT_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'objectiveSummary', 'assumptions', 'unresolvedQuestions', 'requirements',
    'architectureDecisions', 'implementationSteps', 'acceptanceCriteria',
    'testPlan', 'risks', 'prohibitedActions', 'handoff',
    'proposedContractAmendments', 'contextRefs',
  ],
  properties: {
    objectiveSummary: { type: 'string' },
    assumptions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'statement', 'confidence'],
        properties: {
          id: { type: 'string' },
          statement: { type: 'string' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    unresolvedQuestions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'question', 'blocksImplementation'],
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          blocksImplementation: { type: 'boolean' },
        },
      },
    },
    requirements: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'statement', 'rationale'],
        properties: {
          id: { type: 'string' }, statement: { type: 'string' }, rationale: { type: 'string' },
        },
      },
    },
    architectureDecisions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'decision', 'rationale', 'alternativesConsidered', 'accepted'],
        properties: {
          id: { type: 'string' },
          decision: { type: 'string' },
          rationale: { type: 'string' },
          alternativesConsidered: stringArray,
          // The model cannot approve its own decision: the only legal value
          // is false.
          accepted: { type: 'boolean', enum: [false] },
        },
      },
    },
    implementationSteps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['order', 'description', 'filesTouched'],
        properties: {
          order: { type: 'integer' }, description: { type: 'string' }, filesTouched: stringArray,
        },
      },
    },
    acceptanceCriteria: stringArray,
    testPlan: stringArray,
    risks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'risk', 'mitigation', 'severity'],
        properties: {
          id: { type: 'string' }, risk: { type: 'string' }, mitigation: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    prohibitedActions: stringArray,
    handoff: {
      type: 'object', additionalProperties: false,
      required: [
        'objective', 'boundedTask', 'acceptanceCriteria', 'requiredTests',
        'allowedFileScope', 'prohibitedActions', 'grantedTools',
        'missionContractRef', 'environmentRef', 'expectedEvidence',
      ],
      properties: {
        objective: { type: 'string' },
        boundedTask: { type: 'string' },
        acceptanceCriteria: stringArray,
        requiredTests: stringArray,
        allowedFileScope: stringArray,
        prohibitedActions: stringArray,
        grantedTools: stringArray,
        missionContractRef: { type: 'string' },
        environmentRef: { type: ['string', 'null'] },
        expectedEvidence: stringArray,
      },
    },
    proposedContractAmendments: stringArray,
    contextRefs: stringArray,
  },
};
