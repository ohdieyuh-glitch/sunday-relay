import { describe, expect, it } from 'vitest';

import {
  ARCHITECT_GUIDANCE_KEYS, ARCHITECT_GUIDANCE_SCHEMA, ARCHITECT_GUIDANCE_SCHEMA_NAME,
} from '../../connectors/gpt-architect/guidance-schema';
import {
  JULIUS_GUIDANCE_FORBIDDEN_FIELDS, JULIUS_GUIDANCE_REFERENCE_KINDS,
  JULIUS_GUIDANCE_REFERENCE_TRUST, sanitizeJuliusGuidanceProposal,
} from './julius-continuous-lifecycle';

/**
 * THE PROVIDER SCHEMA AND THE DOMAIN SANITIZER MUST ADMIT THE SAME TEN FIELDS.
 *
 * `plan-schema-parity.test.ts` exists because a paid run bought an answer the
 * schema allowed and the validator refused, and nobody had written the gap
 * down. The guidance path gets that test BEFORE it costs anything, and it
 * carries one obligation the plan path does not: the schema must be incapable
 * of expressing a contract term, so that a model cannot propose an amendment
 * even by accident and a reviewer never has to notice one.
 *
 * The schema is a DOCUMENT this repository sends. No JSON Schema engine runs
 * here on purpose — the Responses API is the only reader whose opinion decides
 * a paid run, so the claims below are about the document's own key lists.
 */

const props = (ARCHITECT_GUIDANCE_SCHEMA.properties ?? {}) as Record<string, unknown>;
const required = (ARCHITECT_GUIDANCE_SCHEMA.required ?? []) as readonly string[];

const VALID = () => ({
  subObjective: 'Route the claim-qualified path through the integrity layer.',
  relevantRequirements: ['R4'],
  relevantConstraints: ['No new dependency.'],
  repositoryFindings: ['compileJuliusContext packs in array order.'],
  runtimeFindings: ['The 120-memory adversarial case truncates at entry 31.'],
  references: [{ kind: 'REPOSITORY', locator: 'src/relay/mission/julius/julius-runtime.ts:136', retrievedAt: '2026-09-11T03:00:00.000Z', trust: 'CORROBORATED' }],
  recommendedActions: ['Redact before selection, not after.'],
  additionalProhibitions: ['Do not call julius-memory-trust exports.'],
  affectedCriterionIds: ['AC-3'],
  unresolvedQuestions: [],
});

describe('the guidance schema and the domain sanitizer agree', () => {
  it('is a strict, closed object: no additional properties at the top level', () => {
    expect(ARCHITECT_GUIDANCE_SCHEMA.type).toBe('object');
    expect(ARCHITECT_GUIDANCE_SCHEMA.additionalProperties).toBe(false);
  });

  it('requires exactly the keys it declares, and declares exactly the keys it lists', () => {
    expect([...required].sort()).toEqual([...ARCHITECT_GUIDANCE_KEYS].sort());
    expect(Object.keys(props).sort()).toEqual([...ARCHITECT_GUIDANCE_KEYS].sort());
  });

  it('admits a packet the sanitizer also admits', () => {
    const sanitized = sanitizeJuliusGuidanceProposal(VALID());
    expect(sanitized).not.toBeNull();
    expect(Object.keys(sanitized as object).sort()).toEqual([...ARCHITECT_GUIDANCE_KEYS].sort());
  });

  /**
   * THE ABSENCE IS THE SAFETY PROPERTY. A strict schema with
   * `additionalProperties: false` gives a cooperating model no key to put a
   * contract term in; the sanitizer refuses the same names for the model that
   * does not cooperate. Both halves are asserted, because either alone is a
   * rule someone has to remember.
   */
  it('cannot express any contract-owned field, and the sanitizer refuses each by name', () => {
    for (const forbidden of JULIUS_GUIDANCE_FORBIDDEN_FIELDS) {
      expect(Object.keys(props), `schema must not carry the contract term ${forbidden}`).not.toContain(forbidden);
      expect(required, `schema must not require the contract term ${forbidden}`).not.toContain(forbidden);
      expect(
        sanitizeJuliusGuidanceProposal({ ...VALID(), [forbidden]: 'anything at all' }),
        `the sanitizer must refuse a proposal carrying ${forbidden}`,
      ).toBeNull();
    }
  });

  it('the two key lists are disjoint — no field is both admitted and forbidden', () => {
    const overlap = ARCHITECT_GUIDANCE_KEYS.filter((k) => JULIUS_GUIDANCE_FORBIDDEN_FIELDS.includes(k));
    expect(overlap, 'a key cannot be both guidance-owned and contract-owned').toEqual([]);
  });

  /**
   * A REFERENCE SAYS WHERE, NEVER WHAT. External content is attacker-controlled
   * by assumption: a fetched page that says "ignore the contract" is a page that
   * said that, and admitting its body would make retrieval an instruction
   * channel. There is deliberately no body field at any level of this schema.
   */
  it('a reference carries a locator and a trust judgement, and no retrieved text', () => {
    const ref = ((props.references ?? {}) as Record<string, unknown>).items as Record<string, unknown>;
    expect(ref.additionalProperties).toBe(false);
    expect([...(ref.required as readonly string[])].sort()).toEqual(['kind', 'locator', 'retrievedAt', 'trust']);
    const refProps = ref.properties as Record<string, Record<string, unknown>>;
    for (const banned of ['body', 'content', 'text', 'html', 'snippet', 'excerpt', 'raw']) {
      expect(Object.keys(refProps), `a reference must not carry ${banned}`).not.toContain(banned);
    }
    expect(refProps.kind.enum).toEqual([...JULIUS_GUIDANCE_REFERENCE_KINDS]);
    expect(refProps.trust.enum).toEqual([...JULIUS_GUIDANCE_REFERENCE_TRUST]);
  });

  it('names itself distinctly from the plan schema', () => {
    expect(ARCHITECT_GUIDANCE_SCHEMA_NAME).toBe('relay_prompt_architect_guidance');
  });
});
