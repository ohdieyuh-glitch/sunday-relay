import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyWorldTrailMutation, testIdsOf, WORLD_TRAIL_MUTANT_MAP, WORLD_TRAIL_MUTATIONS, WORLD_TRAIL_TEST_FILES } from './world-trail-mutations.mjs';

/*
 * The transport ring's mutants stay aimed and accounted for: every anchor occurs exactly once in the code as it is now, every mutant
 * changes its files, every test a mutant must fail exists as the LEADING id of a real test title (the runner credits kills by exact
 * id), and the mutant map covers M01..M49 with every live id a mutant and every mutant live. A moved anchor fails here, in `npm test`.
 */

const root = join(__dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
/** Every test title in the runner's files, as written (a template literal's text up to its first `${` is enough for the ids). */
const titles = WORLD_TRAIL_TEST_FILES.flatMap((f) => [...read(f).matchAll(/\bit\(\s*(['"`])((?:\.|(?!\1).)*?)\1/g)].map((m) => m[2].replace(/\'/g, "'")));
const idsInTests = new Set(titles.flatMap((t) => testIdsOf(t)));

describe('the transport ring mutants', () => {
  it('every anchor occurs exactly once, and every mutant changes its files', () => {
    for (const mutation of WORLD_TRAIL_MUTATIONS) {
      const out = applyWorldTrailMutation(mutation, read);
      for (const [file, text] of out) expect(text, `${mutation.id} ${file}`).not.toBe(read(file));
    }
  });

  it('ids are unique, and every mutant names tests that exist by their exact leading id', () => {
    expect(new Set(WORLD_TRAIL_MUTATIONS.map((m) => m.id)).size).toBe(WORLD_TRAIL_MUTATIONS.length);
    expect(idsInTests.has('GOLDEN')).toBe(true);
    for (const mutation of WORLD_TRAIL_MUTATIONS) {
      expect(mutation.kills.length, mutation.id).toBeGreaterThan(0);
      for (const id of mutation.kills) expect(idsInTests.has(id), `${mutation.id} names ${id}`).toBe(true);
    }
    // exact credit: an id later in a title, or inside a word, is no id of that test
    expect(testIdsOf('RING-C01 R09 appearing offline, then back (see R27)')).toEqual(['RING-C01', 'R09']);
    expect(testIdsOf('R27b in memory')).toEqual(['R27b']);
    expect(testIdsOf('a test about R27')).toEqual([]);
  });

  it('the mutant map covers M01..M49 with no gap; its live ids are exactly the mutants', () => {
    const mapIds = WORLD_TRAIL_MUTANT_MAP.map((x) => x.id);
    expect(new Set(mapIds).size).toBe(mapIds.length);
    for (let n = 1; n <= 49; n += 1) expect(mapIds, `M${String(n).padStart(2, '0')}`).toContain(`M${String(n).padStart(2, '0')}`);
    const live = WORLD_TRAIL_MUTANT_MAP.filter((x) => x.status === 'live').map((x) => x.id).sort();
    expect(live).toEqual(WORLD_TRAIL_MUTATIONS.map((m) => m.id).sort());
    for (const x of WORLD_TRAIL_MUTANT_MAP) expect(x.note.length, x.id).toBeGreaterThan(10);
  });
});
