import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compileJuliusContext } from '../julius/julius-runtime';
import type { JuliusBrainEntry } from '../julius/julius-runtime';
import {
  WONDERLAND_BRAIN_CITATION_FIELDS,
  WONDERLAND_BRAIN_KINDS,
  noWonderlandBrainCitation,
  scopeWonderlandBrain,
  wonderlandBrainWasReported,
} from './wonderland-brain-scope';
import type { WonderlandBrainRetrieval } from './wonderland-brain-scope';

/** A phrase no other part of the system produces, planted in every entry. */
const CANARY = 'ZZCANARYZZ-project-substance-must-not-cross';

const retrieval = (
  overrides: Partial<WonderlandBrainRetrieval> = {},
): WonderlandBrainRetrieval => ({
  projectId: 'project-alpha',
  runId: 'run-1',
  taskId: 'task-7',
  projectBrainRevision: 4,
  kinds: ['OBJECTIVE', 'CONSTRAINT', 'CONSTRAINT', 'DECISION'],
  characterCount: 812,
  redactionCount: 2,
  truncated: false,
  contentHash: 'sha256:abc123',
  observedAtIso: '2026-09-08T00:00:00.000Z',
  ...overrides,
});

/* ------------------------------------------------------- the boundary */

describe('no project substance reaches a world', () => {
  it('carries no text from a real compilation, planted or otherwise', () => {
    // THE TEST THAT MATTERS. A real packet is compiled from entries whose text
    // is a canary, and the citation is serialised and searched. This is the
    // check that would fail the day somebody adds a "just the objectives" field
    // for the best of reasons.
    const entries: JuliusBrainEntry[] = WONDERLAND_BRAIN_KINDS.map((kind, index) => ({
      entryId: `entry-${index}`,
      kind,
      text: `${CANARY} ${kind} body number ${index}`,
      taskIds: [],
      allowedRoles: ['CODING_AGENT'],
      sensitivity: 'INTERNAL',
    }));

    const packet = compileJuliusContext({
      missionId: 'mission-1',
      task: { taskId: 'task-7', missionId: 'mission-1' } as never,
      worker: { workerId: 'worker-1', role: 'CODING_AGENT' } as never,
      entries,
      maxCharacters: 100_000,
    });
    expect(packet.blocks.length).toBe(entries.length);
    // The canary really is in the compiled packet, so its absence below means
    // something rather than the fixture being empty.
    expect(JSON.stringify(packet)).toContain(CANARY);

    const citation = scopeWonderlandBrain(
      retrieval({ kinds: packet.blocks.map((block) => block.kind) }),
    );
    expect(JSON.stringify(citation)).not.toContain(CANARY);
    expect(JSON.stringify(citation)).not.toContain('body number');
  });

  it('has no field that could hold free text', () => {
    // Every field is a number, a flag, an opaque handle or a closed token. The
    // three strings are identity and a hash; a fourth would need a reason.
    const citation = scopeWonderlandBrain(retrieval());
    const strings = Object.entries(citation).filter(([, value]) => typeof value === 'string');
    expect(strings.map(([key]) => key).sort()).toEqual([
      'contentHash',
      'observedAtIso',
      'projectId',
      'runId',
      'schemaVersion',
      'taskId',
    ]);
  });

  it('declares no import edge that could hand it an entry', () => {
    // The module takes a narrower shape than a snapshot on purpose: text is
    // never in scope, so no expression inside it could copy one. An import of
    // the kernel's snapshot type would put the packet back within reach.
    //
    // CHECKED AGAINST THE CODE, NOT THE PROSE. A first version searched the
    // whole file and failed on the module's own doc comment, which NAMES those
    // types while explaining why it does not import them. Deleting the
    // explanation to satisfy the test would have been exactly backwards, so the
    // comments come out first — the same mistake the core boundary scanner
    // makes when its credential regex hits a sentence about credentials.
    const source = readFileSync(join(__dirname, 'wonderland-brain-scope.ts'), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    expect(code).not.toContain('JuliusContextSnapshot');
    expect(code).not.toContain('JuliusContextPacket');
    expect(code).not.toContain('JuliusBrainEntry');
    expect(code.includes("from '../julius/")).toBe(false);

    // And the prose really does still explain the choice, so the check above is
    // guarding a documented decision rather than an accident.
    expect(source).toContain('JuliusContextSnapshot');
  });

  it('says nothing about sensitivity, deliberately', () => {
    const citation = scopeWonderlandBrain(retrieval());
    const keys = Object.keys(citation).join(' ').toLowerCase();
    expect(keys).not.toContain('sensitiv');
    expect(keys).not.toContain('secret');
  });
});

/* -------------------------------------------------------- the bounding */

describe('the citation is bounded whatever the brain holds', () => {
  it('stays a fixed shape whether the brain holds three entries or a million', () => {
    // §13: no full Project Brain payloads for a tiny change. The shape is
    // O(kinds), so there is no brain size at which this becomes expensive.
    //
    // Sizes are compared as a BOUND rather than for equality. A first version
    // asserted "the same length plus four" and failed on the extra digits in
    // larger counts, which is the citation being honest about bigger numbers
    // rather than growing with the input. What must not change is the SHAPE.
    const measure = (entries: number): { keys: number; buckets: number; bytes: number } => {
      const citation = scopeWonderlandBrain(
        retrieval({
          kinds: Array.from({ length: entries }, (_, index) => WONDERLAND_BRAIN_KINDS[index % 9]),
        }),
      );
      return {
        keys: Object.keys(citation).length,
        buckets: Object.keys(citation.kindCounts).length,
        bytes: JSON.stringify(citation).length,
      };
    };

    const three = measure(3);
    const many = measure(10_000);
    const absurd = measure(1_000_000);

    expect(many.keys).toBe(three.keys);
    expect(absurd.keys).toBe(three.keys);
    expect(many.buckets).toBe(WONDERLAND_BRAIN_KINDS.length);
    expect(absurd.buckets).toBe(WONDERLAND_BRAIN_KINDS.length);

    // A THIRD OF A MILLION TIMES THE ENTRIES, and under a hundred more bytes:
    // the growth is digits in the counters, not content.
    expect(absurd.bytes - three.bytes).toBeLessThan(100);
    expect(absurd.bytes).toBeLessThan(600);
  });

  it('reports every kind, so a zero is a reported zero', () => {
    const citation = scopeWonderlandBrain(retrieval({ kinds: ['OBJECTIVE'] }));
    expect(Object.keys(citation.kindCounts).sort()).toEqual([...WONDERLAND_BRAIN_KINDS].sort());
    expect(citation.kindCounts.OBJECTIVE).toBe(1);
    expect(citation.kindCounts.EVIDENCE).toBe(0);
  });

  it('counts an unknown kind in the total and in no bucket', () => {
    // The disagreement is the signal. Dropping it would hide that something new
    // appeared; inventing a bucket would put an unreviewed kernel token into a
    // world's vocabulary.
    const citation = scopeWonderlandBrain(retrieval({ kinds: ['OBJECTIVE', 'SOMETHING_NEW'] }));
    expect(citation.entryCount).toBe(2);
    const bucketed = Object.values(citation.kindCounts).reduce((sum, n) => sum + n, 0);
    expect(bucketed).toBe(1);
  });
});

/* ------------------------------------------------------- the vocabulary */

describe('the kind vocabulary tracks the kernel', () => {
  it('lists exactly the kinds a brain entry can have', () => {
    // Read from the kernel's own source rather than imported, because importing
    // the type would be the import edge the boundary test forbids. A kind added
    // there and not here fails, and vice versa.
    const source = readFileSync(
      join(__dirname, '..', 'julius', 'julius-runtime.ts'),
      'utf8',
    );
    const declaration = /JuliusBrainEntry\s*\{[^}]*?kind:\s*([^;]+);/.exec(source);
    expect(declaration, 'JuliusBrainEntry no longer declares its kinds inline').not.toBeNull();
    const kernel = [...(declaration?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(kernel.length).toBeGreaterThan(0);
    expect([...WONDERLAND_BRAIN_KINDS].sort()).toEqual(kernel);
  });
});

/* ---------------------------------------------------------- the honesty */

describe('a retrieval nobody reported is not a retrieval that found nothing', () => {
  it('tells the two apart', () => {
    const silent = noWonderlandBrainCitation({ projectId: 'project-alpha', runId: 'run-1' });
    const empty = scopeWonderlandBrain(retrieval({ kinds: [], characterCount: 0 }));

    expect(silent.entryCount).toBe(0);
    expect(empty.entryCount).toBe(0);
    // Same counts, different facts.
    expect(wonderlandBrainWasReported(silent)).toBe(false);
    expect(wonderlandBrainWasReported(empty)).toBe(true);
  });

  it('refuses to treat whitespace as a report', () => {
    const blank = scopeWonderlandBrain(retrieval({ contentHash: '   ', observedAtIso: '  ' }));
    expect(wonderlandBrainWasReported(blank)).toBe(false);
  });

  it('reports a truncated context, because a worker that did not see everything matters', () => {
    expect(scopeWonderlandBrain(retrieval({ truncated: true })).truncated).toBe(true);
    expect(scopeWonderlandBrain(retrieval()).truncated).toBe(false);
    // Not inferred from anything: only a reported truncation is one.
    expect(
      scopeWonderlandBrain(retrieval({ truncated: undefined as never })).truncated,
    ).toBe(false);
  });

  it('never turns a broken count into NaN geometry downstream', () => {
    const broken = scopeWonderlandBrain(
      retrieval({
        characterCount: Number.NaN,
        redactionCount: -4,
        projectBrainRevision: 1.5,
      }),
    );
    expect(broken.characterCount).toBe(0);
    expect(broken.redactionCount).toBe(0);
    expect(broken.brainRevision).toBe(0);
  });

  it('names every field it carries, so a C++ mirror cannot drift', () => {
    expect(Object.keys(scopeWonderlandBrain(retrieval())).sort()).toEqual(
      [...WONDERLAND_BRAIN_CITATION_FIELDS].sort(),
    );
  });

  it('is frozen, counters included', () => {
    const citation = scopeWonderlandBrain(retrieval());
    expect(Object.isFrozen(citation)).toBe(true);
    expect(Object.isFrozen(citation.kindCounts)).toBe(true);
  });
});
