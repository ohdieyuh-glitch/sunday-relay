import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { STORED_BRAIN_KINDS, brainKindFromStored, brainKindToStored, type StoredBrainKind } from './julius-brain-kinds';
import type { JuliusBrainEntry } from '../mission/julius';

/**
 * THE MAPPING, HELD AGAINST THE CONSTRAINT ITSELF.
 *
 * The point of these is not that a switch statement returns what it says. It is
 * that the write direction cannot produce a value PostgreSQL will refuse — a
 * failure no in-memory test could ever surface, because the memory store has no
 * CHECK constraint. So the admitted list is read out of migration 014's SQL
 * rather than typed out here: a constraint that is narrowed or widened without
 * this file knowing turns the suite red instead of turning a paid mission red.
 */

const MIGRATION = resolve(__dirname, 'wonderland-migrations/014_julius_context_brain.sql');

/** The CHECK list, parsed from the migration the database actually runs. */
function admittedByTheDatabase(): readonly string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const check = /entry_kind text NOT NULL CHECK\(entry_kind IN\(([^)]*)\)\)/u.exec(sql);
  expect(check, 'migration 014 must still declare the entry_kind CHECK this file reads').not.toBeNull();
  return (check![1].match(/'([A-Z_]+)'/gu) ?? []).map((quoted) => quoted.slice(1, -1));
}

/** Every member of the domain union, listed so the coverage assertion is real. */
const DOMAIN_KINDS: readonly JuliusBrainEntry['kind'][] = [
  'OBJECTIVE', 'REQUIREMENT', 'CONSTRAINT', 'DECISION',
  'FINDING', 'REPAIR', 'HANDOFF', 'ARTIFACT', 'EVIDENCE',
];

describe('the Project Brain kind vocabularies', () => {
  it('declares exactly the kinds migration 014 admits', () => {
    expect([...STORED_BRAIN_KINDS].sort(), 'the constant and the constraint must not drift')
      .toEqual([...admittedByTheDatabase()].sort());
  });

  /**
   * THE LOAD-BEARING ONE. Before `brainKindToStored` existed, a writer handed a
   * domain entry would have sent OBJECTIVE, REQUIREMENT or EVIDENCE straight at
   * this constraint.
   */
  it('maps every domain kind onto a kind the database will accept', () => {
    const admitted = new Set(admittedByTheDatabase());
    for (const kind of DOMAIN_KINDS) {
      const stored = brainKindToStored(kind);
      expect(admitted.has(stored), `${kind} maps to ${stored}, which the CHECK constraint refuses`).toBe(true);
    }
  });

  it('MUTATION: the three kinds that would have been rejected are the ones the map exists for', () => {
    const admitted = new Set<string>(admittedByTheDatabase());
    const wouldHaveFailed = DOMAIN_KINDS.filter((kind) => !admitted.has(kind));
    expect(wouldHaveFailed, 'an identity mapping would have failed on exactly these')
      .toEqual(['OBJECTIVE', 'REQUIREMENT', 'EVIDENCE']);
    // And each is carried, not dropped: a stored value still comes back.
    for (const kind of wouldHaveFailed) expect(brainKindToStored(kind)).toBeTruthy();
  });

  it('round-trips the seven kinds that survive both directions', () => {
    for (const kind of ['DECISION', 'FINDING', 'REPAIR', 'HANDOFF', 'CONSTRAINT', 'ARTIFACT', 'REQUIREMENT'] as const) {
      expect(brainKindFromStored(brainKindToStored(kind)), `${kind} must survive a write and a read`).toBe(kind);
    }
  });

  /**
   * AND THE TWO THAT DO NOT, STATED RATHER THAN DISCOVERED. Both losses are the
   * bootstrap's existing choices; writing them down is what stops someone
   * "fixing" the round-trip by widening the constraint nobody asked to widen.
   */
  it('states the two lossy kinds instead of implying they round-trip', () => {
    expect(brainKindToStored('OBJECTIVE'), 'the seed stores the objective as a CONSTRAINT').toBe('CONSTRAINT');
    expect(brainKindFromStored('CONSTRAINT'), 'and it reads back as one').toBe('CONSTRAINT');

    expect(brainKindToStored('EVIDENCE'), 'EVIDENCE has no stored kind of its own').toBe('ARTIFACT');
    expect(brainKindFromStored('ARTIFACT')).toBe('ARTIFACT');
  });

  it('carries an unrecognised stored kind as ARTIFACT rather than dropping it', () => {
    expect(brainKindFromStored('RESEARCH_NOTE')).toBe('ARTIFACT');
    expect(brainKindFromStored('SOMETHING_A_LATER_MIGRATION_ADDS')).toBe('ARTIFACT');
  });

  it('every stored kind reads as a real domain kind', () => {
    const domain = new Set<string>(DOMAIN_KINDS);
    for (const stored of STORED_BRAIN_KINDS as readonly StoredBrainKind[]) {
      expect(domain.has(brainKindFromStored(stored)), `${stored} read back as something outside the union`).toBe(true);
    }
  });
});
