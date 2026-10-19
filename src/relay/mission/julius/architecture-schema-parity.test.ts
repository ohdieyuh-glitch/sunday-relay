import { describe, expect, it } from 'vitest';

import {
  ARCHITECT_ARCHITECTURE_KEYS, ARCHITECT_ARCHITECTURE_SCHEMA, ARCHITECT_CONSISTENCY_KEYS,
  ARCHITECT_CONSISTENCY_SCHEMA, ARCHITECT_CONSULTATION_KEYS, ARCHITECT_CONSULTATION_SCHEMA,
  ARCHITECT_CONSULTATION_SCHEMA_NAME,
} from '../../connectors/gpt-architect/architecture-schema';
import { JULIUS_PEER_PROTECTED_TERMS } from './julius-peer-channel';
import {
  JULIUS_ASSUMPTION_STATES, JULIUS_BOUNDARY_KINDS, JULIUS_RISK_IMPACTS, sanitizeJuliusArchitecture,
} from './julius-architecture-state';
import {
  JULIUS_CONSISTENCY_ASSESSMENTS, JULIUS_COSMETIC_DRIFT_KINDS, JULIUS_MATERIAL_DRIFT_KINDS, sanitizeJuliusConsistency,
} from './julius-architecture-drift';

/**
 * THE PROVIDER SCHEMA AND THE DOMAIN SANITIZERS MUST ADMIT THE SAME THING.
 *
 * The plan path learned this the expensive way: a paid run bought an answer the
 * schema allowed and the validator refused. Guidance and the rebuttal each got
 * this test before it cost anything, and the consultation gets it for the same
 * reason — plus one the others do not carry. This schema is the one place an
 * architect could describe the whole system, so it is also the one place a
 * contract term could hide. It cannot: the absence IS the safety property.
 *
 * The schema is a DOCUMENT this repository sends. No JSON Schema engine runs
 * here: the Responses API is the only reader whose opinion decides a paid run,
 * so the claims below are about the document's own key lists and enums.
 */

const props = (schema: { properties?: Record<string, unknown> }) => (schema.properties ?? {}) as Record<string, unknown>;
const enumOf = (schema: { properties?: Record<string, unknown> }, key: string): readonly string[] =>
  ((props(schema)[key] as { enum?: readonly string[] } | undefined)?.enum) ?? [];
const itemsOf = (schema: { properties?: Record<string, unknown> }, key: string) =>
  ((props(schema)[key] as { items?: { properties?: Record<string, unknown>; additionalProperties?: boolean; required?: readonly string[] } } | undefined)?.items) ?? {};

const ARCHITECTURE = {
  components: [{ name: 'normalizer', responsibility: 'Turns a journal page into rows.' }],
  boundaries: [{ name: 'JournalReader', kind: 'INTERFACE', contract: 'peek() may return fewer bytes.', locator: 'src/journal.ts' }],
  dependencies: [{ name: 'pg', assumption: 'Postgres 16 renders NULL as empty.', locator: 'package.json' }],
  decisions: [{ decisionId: 'D-1', decision: 'Reuse the reader.', reason: 'One buffer is enough.', rejectedAlternatives: ['a second buffer'], evidenceRefs: ['src/journal.ts:120'] }],
  assumptions: [{ assumptionId: 'A-1', claim: 'The boundary is a requirement.', state: 'UNVERIFIED', evidenceRefs: [] }],
  openQuestions: [{ questionId: 'Q-1', question: 'Requirement or accident?', owner: 'PROMPT_ARCHITECT', blocking: false }],
  risks: [{ riskId: 'R-1', risk: 'A partial read reads as EOF.', impact: 'HIGH', mitigation: 'Assert the byte count.' }],
};
const CONSISTENCY = {
  assessment: 'DRIFT_REQUIRES_REPAIR', claim: 'The reader still assumes variable-width rows.',
  drift: [{ kind: 'SCHEMA', name: 'JournalRow', claim: 'Fixed width was built.' }],
  driftingTaskIds: ['build-1'], evidenceRefs: ['src/journal.ts:120'],
};

describe('the consultation schema and the domain sanitizers agree', () => {
  it('is a strict, closed object of two closed objects, and names itself', () => {
    for (const schema of [ARCHITECT_CONSULTATION_SCHEMA, ARCHITECT_ARCHITECTURE_SCHEMA, ARCHITECT_CONSISTENCY_SCHEMA]) {
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
    }
    expect(ARCHITECT_CONSULTATION_SCHEMA_NAME).toBe('relay_prompt_architect_architecture');
  });

  it.each([
    ['the consultation', ARCHITECT_CONSULTATION_SCHEMA, ARCHITECT_CONSULTATION_KEYS],
    ['the architecture', ARCHITECT_ARCHITECTURE_SCHEMA, ARCHITECT_ARCHITECTURE_KEYS],
    ['the consistency assessment', ARCHITECT_CONSISTENCY_SCHEMA, ARCHITECT_CONSISTENCY_KEYS],
  ])('%s requires exactly the keys it declares', (_label, schema, keys) => {
    expect([...(schema.required as readonly string[])].sort()).toEqual([...keys].sort());
    expect(Object.keys(props(schema)).sort()).toEqual([...keys].sort());
  });

  it('admits what the domain admits', () => {
    expect(sanitizeJuliusArchitecture({ value: ARCHITECTURE, revision: 1, proposedByTaskId: 't', recordedAt: 'now' }).ok).toBe(true);
    expect(sanitizeJuliusConsistency({ value: CONSISTENCY, revision: 1 }).ok).toBe(true);
    expect(sanitizeJuliusConsistency({
      value: { assessment: 'ALIGNED', claim: 'It matches.', drift: [], driftingTaskIds: [], evidenceRefs: [] }, revision: 1,
    }).ok).toBe(true);
  });

  it('carries exactly the domain vocabularies, with nothing added and nothing missing', () => {
    expect(enumOf(ARCHITECT_CONSISTENCY_SCHEMA, 'assessment')).toEqual([...JULIUS_CONSISTENCY_ASSESSMENTS]);
    const boundary = itemsOf(ARCHITECT_ARCHITECTURE_SCHEMA, 'boundaries');
    expect((boundary.properties?.kind as { enum?: readonly string[] })?.enum).toEqual([...JULIUS_BOUNDARY_KINDS]);
    const assumption = itemsOf(ARCHITECT_ARCHITECTURE_SCHEMA, 'assumptions');
    expect((assumption.properties?.state as { enum?: readonly string[] })?.enum).toEqual([...JULIUS_ASSUMPTION_STATES]);
    const risk = itemsOf(ARCHITECT_ARCHITECTURE_SCHEMA, 'risks');
    expect((risk.properties?.impact as { enum?: readonly string[] })?.enum).toEqual([...JULIUS_RISK_IMPACTS]);
    const drift = itemsOf(ARCHITECT_CONSISTENCY_SCHEMA, 'drift');
    expect((drift.properties?.kind as { enum?: readonly string[] })?.enum)
      .toEqual([...JULIUS_MATERIAL_DRIFT_KINDS, ...JULIUS_COSMETIC_DRIFT_KINDS]);
  });

  it('every nested object is closed too, so nothing can be smuggled one level down', () => {
    for (const key of ['components', 'boundaries', 'dependencies', 'decisions', 'assumptions', 'openQuestions', 'risks']) {
      expect(itemsOf(ARCHITECT_ARCHITECTURE_SCHEMA, key).additionalProperties, key).toBe(false);
    }
    expect(itemsOf(ARCHITECT_CONSISTENCY_SCHEMA, 'drift').additionalProperties).toBe(false);
  });

  it('cannot express a mission-owned term, at any level', () => {
    const keys = [
      ...ARCHITECT_CONSULTATION_KEYS, ...ARCHITECT_ARCHITECTURE_KEYS, ...ARCHITECT_CONSISTENCY_KEYS,
      ...['components', 'boundaries', 'dependencies', 'decisions', 'assumptions', 'openQuestions', 'risks']
        .flatMap((key) => Object.keys(itemsOf(ARCHITECT_ARCHITECTURE_SCHEMA, key).properties ?? {})),
      ...Object.keys(itemsOf(ARCHITECT_CONSISTENCY_SCHEMA, 'drift').properties ?? {}),
    ].map((key) => key.toLowerCase().replace(/[^a-z0-9]/gu, ''));
    for (const term of JULIUS_PEER_PROTECTED_TERMS) expect(keys, term).not.toContain(term);
  });

  it('cannot express a completion: the only verdict-shaped field has four values and none of them verifies anything', () => {
    const assessments = enumOf(ARCHITECT_CONSISTENCY_SCHEMA, 'assessment');
    for (const word of ['VERIFIED', 'ACCEPTED', 'COMPLETE', 'PASS', 'CONTINUE']) {
      expect(assessments, word).not.toContain(word);
    }
    // And the domain refuses the word even if a model finds a string field for it.
    expect(sanitizeJuliusConsistency({ value: { ...CONSISTENCY, status: 'VERIFIED' }, revision: 1 }))
      .toEqual({ ok: false, reasonCode: 'peer_response_mints_julius_only_outcome' });
  });
});
