import { describe, expect, it } from 'vitest';

import {
  ARCHITECT_REBUTTAL_KEYS, ARCHITECT_REBUTTAL_SCHEMA, ARCHITECT_REBUTTAL_SCHEMA_NAME,
} from '../../connectors/gpt-architect/rebuttal-schema';
import { JULIUS_PEER_PROTECTED_TERMS } from './julius-peer-channel';
import { sanitizeJuliusRebuttal } from './julius-disagreement';

/**
 * THE PROVIDER SCHEMA AND THE DOMAIN SANITIZER MUST ADMIT THE SAME FOUR FIELDS.
 *
 * The guidance path got this test before it cost anything, for the reason the
 * plan path learned the expensive way: a paid run bought an answer the schema
 * allowed and the validator refused. The rebuttal path gets it for the same
 * reason and carries the same obligation — the schema must be incapable of
 * expressing a contract term or a completion claim, so an architect cannot
 * amend the agreement while arguing about it.
 *
 * The schema is a DOCUMENT this repository sends. No JSON Schema engine runs
 * here: the Responses API is the only reader whose opinion decides a paid run,
 * so the claims below are about the document's own key lists.
 */

const props = (ARCHITECT_REBUTTAL_SCHEMA.properties ?? {}) as Record<string, unknown>;
const required = (ARCHITECT_REBUTTAL_SCHEMA.required ?? []) as readonly string[];

const MAINTAINS = () => ({
  position: 'MAINTAINS',
  argument: 'The boundary is unchanged: the adapter calls the same port it always did.',
  evidence: [{ locator: 'src/relay/mission/julius/julius-runtime-ports.ts:241', claim: 'The port signature is untouched by the change under review.' }],
  missionTermsMustChange: false,
});

describe('the rebuttal schema and the domain sanitizer agree', () => {
  it('is a strict, closed object that names itself', () => {
    expect(ARCHITECT_REBUTTAL_SCHEMA.type).toBe('object');
    expect(ARCHITECT_REBUTTAL_SCHEMA.additionalProperties).toBe(false);
    expect(ARCHITECT_REBUTTAL_SCHEMA_NAME).toBe('relay_prompt_architect_rebuttal');
  });

  it('requires exactly the keys it declares, and declares exactly the keys it lists', () => {
    expect([...required].sort()).toEqual([...ARCHITECT_REBUTTAL_KEYS].sort());
    expect(Object.keys(props).sort()).toEqual([...ARCHITECT_REBUTTAL_KEYS].sort());
  });

  it('admits what the domain admits', () => {
    const reading = sanitizeJuliusRebuttal(MAINTAINS());
    expect(reading.ok).toBe(true);
    expect(sanitizeJuliusRebuttal({ ...MAINTAINS(), position: 'CONCEDES', evidence: [] }).ok).toBe(true);
  });

  it('cannot express a mission-owned term, at any level', () => {
    // The absence IS the safety property: a strict model has nowhere to put one.
    const keys = ARCHITECT_REBUTTAL_KEYS.map((key) => key.toLowerCase().replace(/[^a-z0-9]/gu, ''));
    for (const term of JULIUS_PEER_PROTECTED_TERMS) expect(keys).not.toContain(term);
    const evidenceItem = ((props.evidence as { items?: { properties?: Record<string, unknown>; additionalProperties?: boolean } }).items) ?? {};
    expect(evidenceItem.additionalProperties, 'an evidence entry is closed too').toBe(false);
    expect(Object.keys(evidenceItem.properties ?? {}).sort()).toEqual(['claim', 'locator']);
  });

  it('the position is a two-value enum, because Julius resolves on one of two answers', () => {
    expect((props.position as { enum?: readonly string[] }).enum).toEqual(['CONCEDES', 'MAINTAINS']);
    expect(sanitizeJuliusRebuttal({ ...MAINTAINS(), position: 'IT_DEPENDS' }))
      .toEqual({ ok: false, reasonCode: 'rebuttal_position_unknown' });
  });

  it('the rule the schema cannot state is stated by the domain: a maintained position must cite', () => {
    // JSON Schema cannot say "required only when position is MAINTAINS", so the
    // array is always present and the refusal is made where it can be truthful.
    expect(required).toContain('evidence');
    expect(sanitizeJuliusRebuttal({ ...MAINTAINS(), evidence: [] }))
      .toEqual({ ok: false, reasonCode: 'rebuttal_maintains_without_evidence' });
  });

  it('a completion claim or a contract edit is refused even though the schema forbade it', () => {
    // Two walls: the schema a cooperating provider obeys, and the sanitizer that
    // is ours. Only the second is under this repository's control.
    expect(sanitizeJuliusRebuttal({ ...MAINTAINS(), verdict: 'VERIFIED' }))
      .toEqual({ ok: false, reasonCode: 'peer_response_mints_julius_only_outcome' });
    expect(sanitizeJuliusRebuttal({ ...MAINTAINS(), acceptanceCriteria: [] }))
      .toEqual({ ok: false, reasonCode: 'peer_response_mutates_protected_term' });
  });
});
