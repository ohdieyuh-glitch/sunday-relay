import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyWorldTrailMutation, WORLD_TRAIL_MUTATIONS, WORLD_TRAIL_TEST_FILES } from './world-trail-mutations.mjs';

/*
 * The transport ring's mutants stay aimed: every anchor occurs exactly once in the code as it is now, every mutant changes its files,
 * and every test a mutant must fail exists by its id. A change that moves an anchor fails here, in `npm test`, not in a mutation run
 * nobody repeats. The mutation run itself is `node scripts/world-trail-mutations.mjs`.
 */

const root = join(__dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const titles = WORLD_TRAIL_TEST_FILES.map(read).join('\n');

describe('the transport ring mutants', () => {
  it('every anchor occurs exactly once, and every mutant changes its files', () => {
    for (const mutation of WORLD_TRAIL_MUTATIONS) {
      const out = applyWorldTrailMutation(mutation, read);
      for (const [file, text] of out) expect(text, `${mutation.id} ${file}`).not.toBe(read(file));
    }
  });

  it('ids are unique, and every mutant names tests that exist', () => {
    expect(new Set(WORLD_TRAIL_MUTATIONS.map((m) => m.id)).size).toBe(WORLD_TRAIL_MUTATIONS.length);
    for (const mutation of WORLD_TRAIL_MUTATIONS) {
      expect(mutation.kills.length, mutation.id).toBeGreaterThan(0);
      for (const id of mutation.kills) {
        const exists = id === 'GOLDEN' ? titles.includes('every answer of the scenario is exactly the recorded bytes') : new RegExp(`['"\`](?:[A-Z0-9-]+ )*${id}[ :]`).test(titles);
        expect(exists, `${mutation.id} names ${id}`).toBe(true);
      }
    }
  });
});
