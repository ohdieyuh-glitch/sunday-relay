/**
 * THE STRICT JSON SCHEMA the Prompt Architect must answer a DISAGREEMENT with.
 *
 * A rebuttal is not guidance and not a plan. The Independent Reviewer has
 * challenged something the architect is responsible for, Julius has opened a
 * disagreement, and this is the architect's ONE answer to it: concede, or
 * maintain the position and cite what supports it.
 *
 * THE SAFETY PROPERTY IS THE ABSENCE, exactly as it is for guidance.
 * `additionalProperties: false` with a complete `required` list means a strict
 * model cannot express `objective`, `blockingAcceptanceCriteria`,
 * `permittedPaths`, `budget` or any other contract term: there is no key to put
 * one in. `sanitizeJuliusRebuttal` refuses those names again on the way in,
 * through the same peer authority guard every other peer response passes, and
 * `rebuttal-schema-parity.test.ts` holds this file against the domain.
 *
 * `missionTermsMustChange` is the one place an architect may say that its
 * position needs a MISSION-OWNED term to move. Saying so does not move it:
 * Julius escalates the disagreement instead of deciding it, which is the
 * difference between raising a question about the agreement and editing it.
 */

export const ARCHITECT_REBUTTAL_SCHEMA_NAME = 'relay_prompt_architect_rebuttal';

/** The keys, in one place: the schema below and the parity test both read this. */
export const ARCHITECT_REBUTTAL_KEYS: readonly string[] = Object.freeze([
  'position', 'argument', 'evidence', 'missionTermsMustChange',
]);

/**
 * EVIDENCE IS A POINTER AND A CLAIM ABOUT IT — never a body.
 *
 * The same rule the guidance reference carries: a fetched or quoted document is
 * attacker-controlled by assumption, and a rebuttal that could carry one would
 * be an instruction channel into the reviewer's re-review. `locator` says where
 * to look; `claim` is the architect's own bounded sentence about what is there.
 */
const evidence = {
  type: 'object',
  additionalProperties: false,
  required: ['locator', 'claim'],
  properties: {
    locator: { type: 'string' },
    claim: { type: 'string' },
  },
} as const;

export const ARCHITECT_REBUTTAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...ARCHITECT_REBUTTAL_KEYS],
  properties: {
    /**
     * TWO ANSWERS, AND NO THIRD. "It depends" is not a position Julius can
     * resolve a disagreement on, and a model given room for one will take it.
     */
    position: { type: 'string', enum: ['CONCEDES', 'MAINTAINS'] },
    argument: { type: 'string' },
    /**
     * A MAINTAINED POSITION MUST CITE. The schema cannot express "required only
     * when MAINTAINS", so the array is always present and the domain refuses an
     * empty one on a maintained position — the refusal a strict schema cannot
     * make is made where it can be made truthfully.
     */
    evidence: { type: 'array', items: evidence },
    missionTermsMustChange: { type: 'boolean' },
  },
} as const;
