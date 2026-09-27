import { describe, expect, it } from 'vitest';
import {
  JULIUS_RESEARCH_ASK_FIELDS,
  JULIUS_RESEARCH_ASK_FORBIDDEN_FIELDS,
  JULIUS_RESEARCH_ASK_JSON_SCHEMA,
  JULIUS_RESEARCH_ASK_LIMITS,
  RESEARCH_ASKS_FIELD,
  juliusResearchAskFieldGuidance,
  sanitizeJuliusResearchAsks,
  withJuliusResearchAsks,
} from './julius-research-protocol';
import { JULIUS_PARTICIPATION_CHANNELS } from './julius-worker-participation';
import {
  LIVE_REACH_ACTION_CAPABILITIES,
  LIVE_REACH_READ_CAPABILITIES,
  LIVE_REACH_SOURCES,
} from '../live-reach';

/**
 * THE SAME ASK, FOR A WORKER THAT ANSWERS WITH A SCHEMA.
 *
 * The Coding Agent asks through a marker block because its only structured
 * return is text. The Prompt Architect and the Independent Reviewer answer with
 * objects, so for them an ask is a field. These cases hold the three to ONE
 * authority: the same vocabulary, the same bounds, the same sanitizer. A slot
 * with a different door is the thing the founder's rule forbids.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['objectiveSummary'],
  properties: { objectiveSummary: { type: 'string' } },
});

describe('the field carries exactly the ask the sanitizer accepts', () => {
  it('offers every Live Reach source and read capability, and no action capability', () => {
    const items = JULIUS_RESEARCH_ASK_JSON_SCHEMA.items as Record<string, unknown>;
    const properties = items.properties as Record<string, { enum?: readonly string[] }>;
    expect(properties.source!.enum).toEqual([...LIVE_REACH_SOURCES]);
    expect(properties.capability!.enum).toEqual([...LIVE_REACH_READ_CAPABILITIES]);
    for (const action of LIVE_REACH_ACTION_CAPABILITIES) {
      expect(properties.capability!.enum!.includes(action), `the schema offers ${action}`).toBe(false);
    }
  });

  it('names exactly the fields the sanitizer rebuilds, and no forbidden one', () => {
    const items = JULIUS_RESEARCH_ASK_JSON_SCHEMA.items as Record<string, unknown>;
    expect(items.required).toEqual([...JULIUS_RESEARCH_ASK_FIELDS]);
    expect(Object.keys(items.properties as object).sort()).toEqual([...JULIUS_RESEARCH_ASK_FIELDS].sort());
    /**
     * A SCHEMA THAT OFFERED A FORBIDDEN FIELD would be teaching a worker to
     * produce an ask the sanitizer refuses WHOLE — a wasted turn on a paid run,
     * and a refusal the worker could reasonably think was Julius's fault.
     */
    for (const forbidden of JULIUS_RESEARCH_ASK_FORBIDDEN_FIELDS) {
      expect(Object.keys(items.properties as object).includes(forbidden), forbidden).toBe(false);
    }
  });

  it('caps the list at the number the sanitizer enforces', () => {
    expect(JULIUS_RESEARCH_ASK_JSON_SCHEMA.maxItems).toBe(JULIUS_RESEARCH_ASK_LIMITS.asks);
  });

  /**
   * THE SHAPE THE SCHEMA DESCRIBES IS A SHAPE THE DOMAIN ACCEPTS. Two
   * declarations of one contract drift; this drives the real sanitizer with an
   * ask built strictly from the schema's own vocabulary.
   */
  it('an ask conforming to the schema is accepted by the real sanitizer', () => {
    const items = JULIUS_RESEARCH_ASK_JSON_SCHEMA.items as Record<string, unknown>;
    const properties = items.properties as Record<string, { enum?: readonly string[] }>;
    const conforming = {
      source: properties.source!.enum![0],
      capability: properties.capability!.enum![0],
      reference: 'https://example.test/page',
      purpose: 'Establish a fact the packet does not carry.',
    };
    expect(sanitizeJuliusResearchAsks([conforming])).toHaveLength(1);
  });
});

describe('adding the field to a worker’s own schema', () => {
  it('adds the property AND the required name — strict mode needs both', () => {
    const composed = withJuliusResearchAsks(SCHEMA as unknown as Record<string, unknown>);
    expect(Object.keys(composed.properties as object)).toContain(RESEARCH_ASKS_FIELD);
    expect(composed.required).toEqual(['objectiveSummary', RESEARCH_ASKS_FIELD]);
  });

  it('leaves the original schema untouched — the connector still owns its own', () => {
    const before = JSON.stringify(SCHEMA);
    withJuliusResearchAsks(SCHEMA as unknown as Record<string, unknown>);
    expect(JSON.stringify(SCHEMA)).toBe(before);
  });

  it('keeps every property the worker’s schema already declared', () => {
    const composed = withJuliusResearchAsks(SCHEMA as unknown as Record<string, unknown>);
    expect(Object.keys(composed.properties as object)).toContain('objectiveSummary');
    expect(composed.additionalProperties).toBe(false);
  });

  it('is idempotent, so composing twice cannot duplicate the requirement', () => {
    const once = withJuliusResearchAsks(SCHEMA as unknown as Record<string, unknown>);
    expect(withJuliusResearchAsks(once)).toBe(once);
  });

  /**
   * A SCHEMA WITH NO `properties` IS NOT A SHAPE THIS CAN EXTEND, and silently
   * returning it would produce a schema the API accepts and the worker can
   * never satisfy — a failure that would first appear on a paid call.
   */
  it('refuses a schema it cannot extend rather than returning it unchanged', () => {
    expect(() => withJuliusResearchAsks({ type: 'object' })).toThrow('julius_research_schema_has_no_properties');
  });
});

describe('what a schema-bearing worker is told is what Julius accepts', () => {
  const guidance = juliusResearchAskFieldGuidance();

  it('names the field and every bound the sanitizer enforces', () => {
    expect(guidance).toContain(`"${RESEARCH_ASKS_FIELD}"`);
    const stated = (pattern: RegExp): number => {
      const match = pattern.exec(guidance);
      expect(match, `the guidance must state this bound: ${pattern.source}`).not.toBeNull();
      return Number.parseInt(match![1]!, 10);
    };
    expect(stated(/At most (\d+) per answer/u)).toBe(JULIUS_RESEARCH_ASK_LIMITS.asks);
    expect(stated(/what to read, up to (\d+) characters/u)).toBe(JULIUS_RESEARCH_ASK_LIMITS.referenceChars);
    expect(stated(/why you need it, up to (\d+) characters/u)).toBe(JULIUS_RESEARCH_ASK_LIMITS.purposeChars);
  });

  it('offers exactly the vocabulary the schema offers', () => {
    const offered = (label: string): readonly string[] => {
      const match = new RegExp(`"${label}": one of ([^\\n]+)`, 'u').exec(guidance);
      expect(match, `the guidance must offer a ${label} vocabulary`).not.toBeNull();
      return match![1]!.split(', ');
    };
    expect(offered('source')).toEqual([...LIVE_REACH_SOURCES]);
    expect(offered('capability')).toEqual([...LIVE_REACH_READ_CAPABILITIES]);
  });

  /**
   * THE TWO THINGS THAT CHANGE BEHAVIOUR: that Julius answers BEFORE the work
   * that depends on it — otherwise a worker files the question as a caveat and
   * proceeds on a guess — and that authorisation is Julius's, so an ask is not
   * a retrieval already in hand.
   */
  it('says the answer arrives before the dependent work, and that Julius decides', () => {
    expect(guidance).toContain('before the work that depends on it');
    expect(guidance).toContain('Julius decides whether this mission is authorised');
  });

  it('says an empty list is the ordinary answer, so the field is not pressure to ask', () => {
    expect(guidance).toContain('An EMPTY list is the ordinary answer');
  });

  /**
   * ONE AUTHORITY, TWO TRANSPORTS. The Coding Agent's marker block and this
   * field are different shapes of the same permission, so they must state the
   * same numbers. Held to the constants rather than to each other's wording,
   * which is what lets either text be rewritten without the other rotting.
   */
  it('states the same bounds the Coding Agent’s marker protocol states', () => {
    expect(JULIUS_PARTICIPATION_CHANNELS).toContain(RESEARCH_ASKS_FIELD);
    for (const bound of [
      JULIUS_RESEARCH_ASK_LIMITS.asks,
      JULIUS_RESEARCH_ASK_LIMITS.referenceChars,
      JULIUS_RESEARCH_ASK_LIMITS.purposeChars,
    ]) {
      expect(guidance).toContain(String(bound));
    }
  });
});
