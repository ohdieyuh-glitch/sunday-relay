import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyWorldTrailMutation, WORLD_TRAIL_MUTATIONS, WORLD_TRAIL_TEST_FILES } from './world-trail-mutations.mjs';

/*
 * The transport ring's mutants (r16reh18 prototype) stay aimed: every anchor occurs exactly once in the code as it is now, every
 * mutant changes the file, and every test a mutant must fail exists by its RING-... id. A change that moves an anchor fails here, in
 * `npm test`, not in a mutation run nobody repeats. The mutation run itself is `node scripts/world-trail-mutations.mjs`.
 */

const root = join(__dirname, '..');
const tests = WORLD_TRAIL_TEST_FILES.map((f) => readFileSync(join(root, f), 'utf8')).join('\n');

describe('the transport ring mutants', () => {
  it('every anchor occurs exactly once, and every mutant changes its file', () => {
    for (const mutation of WORLD_TRAIL_MUTATIONS) {
      const text = readFileSync(join(root, mutation.file), 'utf8');
      expect(applyWorldTrailMutation(mutation, text), mutation.id).not.toBe(text);
    }
  });

  it('every mutant names a RING test that exists, and ids are unique', () => {
    expect(new Set(WORLD_TRAIL_MUTATIONS.map((m) => m.id)).size).toBe(WORLD_TRAIL_MUTATIONS.length);
    for (const mutation of WORLD_TRAIL_MUTATIONS) expect(tests.includes(`'${mutation.kills} `) || tests.includes(`"${mutation.kills} `) || tests.includes(`\`${mutation.kills} `), mutation.id).toBe(true);
  });
});
