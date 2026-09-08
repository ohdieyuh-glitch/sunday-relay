import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * C.A.R.D. IS THE VOCABULARY. PSP IS THE ONE IT REPLACED.
 *
 * The founder directive is explicit on both halves: new integration work uses
 * C.A.R.D., and nobody performs a destructive refactor across the repository
 * purely to rename historical artefacts. Those two instructions only coexist if
 * something holds the LINE between the old surface and the new one, which is
 * what this file is.
 *
 * Two territories, and the difference matters:
 *
 *   THE WONDERLAND INTEGRATION LAYER and the Unreal client are new. They were
 *   written after the rename and have never carried the old word. Keeping them
 *   that way costs nothing today and is impossible to do retroactively, so it
 *   is enforced now rather than after the first one slips in.
 *
 *   `src/relay/psp/`, `src/relay/ui/psp-import/` and their callers are
 *   HISTORICAL. They predate the rename, they are load-bearing, and renaming
 *   them would touch persistence formats, boundary allowlists and a UI import
 *   flow for no behavioural gain. They are inventoried here instead — so the
 *   residue is a known, counted quantity rather than a surprise — and left
 *   alone.
 *
 * The inventory is a CEILING, not a fixture. It fails when the old surface
 * GROWS, and it is meant to be lowered whenever a file is legitimately
 * migrated. It does not fail when the count drops, because a test that made
 * deleting the old vocabulary into a build failure would be defending exactly
 * the thing it exists to retire.
 */

const HERE = join(__dirname, '..', '..');

/** Every word we refuse in new work, as whole words rather than substrings. */
const RETIRED = /\bPSPs?\b/i;

function walk(dir: string, keep: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...walk(path, keep));
    } else if (keep(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe('C.A.R.D. is the vocabulary of the integration layer', () => {
  it('keeps the retired word out of the Wonderland integration layer', () => {
    const files = walk(join(HERE, 'mission', 'wonderland'), (name) => name.endsWith('.ts'))
      // This file names the retired word on purpose; a rule cannot state itself
      // without quoting the thing it forbids.
      .filter((path) => !path.endsWith('wonderland-card-vocabulary.test.ts'));

    expect(files.length).toBeGreaterThan(30);
    const offenders = files.filter((path) => RETIRED.test(readFileSync(path, 'utf8')));
    expect(
      offenders.map((path) => path.slice(HERE.length + 1)),
      'the Wonderland integration layer must use C.A.R.D. — this word was retired',
    ).toEqual([]);
  });

  it('keeps it out of the Unreal client too', () => {
    const client = join(HERE, '..', '..', 'wonderland', 'Source', 'Wonderland');
    const files = walk(client, (name) => name.endsWith('.h') || name.endsWith('.cpp'));

    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((path) => RETIRED.test(readFileSync(path, 'utf8')));
    expect(
      offenders.map((path) => path.slice(client.length + 1)),
      'the Unreal client must use C.A.R.D. — this word was retired',
    ).toEqual([]);
  });

  it('holds the historical surface at its current size rather than letting it grow', () => {
    /**
     * THE NUMBER IS A MEASUREMENT, NOT A TARGET.
     *
     * Counted across the whole source tree at the time this gate was written.
     * Raising it should require saying why in a commit message; lowering it is
     * always welcome and needs no ceremony.
     *
     * It started at 76. Three files in the Wonderland layer and one Unreal
     * header carried the retired word in PROSE — a comment about the palette
     * being overridable, another about what a Compound Agent is made of — which
     * is the "migrate where safe" half of the directive: a comment can be
     * corrected without touching a persisted format, a boundary allowlist or a
     * caller. What is left is identifiers and module paths, where a rename
     * would be exactly the destructive refactor the directive rules out.
     */
    const CEILING = 73;

    const files = walk(HERE, (name) => /\.(ts|tsx)$/.test(name)).filter(
      (path) => !path.endsWith('wonderland-card-vocabulary.test.ts'),
    );
    const carrying = files.filter((path) => RETIRED.test(readFileSync(path, 'utf8')));

    expect(
      carrying.length,
      `the retired vocabulary has spread to ${carrying.length} files (ceiling ${CEILING}). ` +
        'New work uses C.A.R.D.; if a file legitimately migrated, lower the ceiling.',
    ).toBeLessThanOrEqual(CEILING);
  });
});
