import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE DOCUMENT IS CHECKED AGAINST THE CODE, NOT MAINTAINED FROM MEMORY.
 *
 * `REPOSITORY_TARGETS.md` opens with "Read 'What is not built' before believing
 * anything else here", which makes a stale line in it worse than a stale line
 * anywhere else in this repository: it is the sentence a founder reads to
 * decide what Relay can do.
 *
 * It has now gone stale twice in ways nobody would notice by reading it. It
 * claimed the dry-run mode "does not exist" while `planDryRun` was built,
 * exported from the barrel and covered by 19 tests — understating the product
 * in the one place that is supposed to be conservative. And its architecture
 * listing silently omitted three modules.
 *
 * Prose cannot be diffed against behaviour in general. These check the two
 * things that CAN be checked mechanically: every module exists in the listing,
 * and no entry claims a symbol is absent while the barrel exports it.
 */

const DOC = join(__dirname, '..', 'docs', 'relay', 'REPOSITORY_TARGETS.md');
const BRIDGE = __dirname;
const DOMAIN = join(__dirname, '..', 'src', 'relay', 'mission', 'repository-target');

const doc = readFileSync(DOC, 'utf8');

/**
 * THE ARCHITECTURE LISTING ONLY — the fenced block, not the whole document.
 *
 * The first version of these tests asked `doc.includes(filename)`, which is
 * satisfied by ANY mention anywhere: a module dropped from the listing is still
 * named in the prose two sections down, so all three checks passed against a
 * doc I had deliberately broken. Scoping to the block is the whole guard.
 */
const listing = (() => {
  const fence = doc.indexOf('```\nsrc/relay/mission/repository-target/');
  if (fence === -1) throw new Error('the architecture listing block was not found');
  const end = doc.indexOf('```', fence + 3);
  return doc.slice(fence, end);
})();

/** Value exports from the barrel, single-line and multi-line alike. */
const barrelExports = (): string[] => {
  const barrel = readFileSync(join(DOMAIN, 'index.ts'), 'utf8');
  const names: string[] = [];
  // `export { ... } from '...'` — skipping `export type { ... }`.
  for (const block of barrel.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    if (block[1] !== undefined) continue;
    for (const raw of block[2].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (/^[a-z][A-Za-z0-9]*$/.test(name)) names.push(name);
    }
  }
  return names;
};

/** Source modules, excluding tests and the barrel. */
const modulesIn = (dir: string): string[] =>
  readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts');

describe('REPOSITORY_TARGETS.md describes the code that exists', () => {
  it('lists every repository-target domain module', () => {
    const missing = modulesIn(DOMAIN).filter((f) => !listing.includes(f));
    expect(missing, `not in the doc's architecture listing: ${missing.join(', ')}`).toEqual([]);
  });

  it('lists every bridge module that is part of this feature', () => {
    /**
     * Scoped by NAME rather than by "everything in relay-bridge", because the
     * bridge holds the whole hosted pipeline and this document is about one
     * feature. The prefixes are the feature's own.
     */
    const owned = modulesIn(BRIDGE).filter(
      (f) => f.startsWith('repository-') || f.startsWith('ship-') || f.includes('deployment-provider'),
    );
    expect(owned.length).toBeGreaterThan(3);
    const missing = owned.filter((f) => !listing.includes(f));
    expect(missing, `not in the doc's architecture listing: ${missing.join(', ')}`).toEqual([]);
  });

  it('never says a barrel-exported symbol does not exist', () => {
    /**
     * The dry-run defect exactly: "No dry-run mode ... it does not exist" while
     * `planDryRun` was exported. Checks the "What is NOT built" section only —
     * elsewhere "does not exist" is legitimate prose about design choices.
     */
    const start = doc.indexOf('## What is NOT built');
    expect(start).toBeGreaterThan(-1);
    const section = doc.slice(start);

    const exported = barrelExports();
    /**
     * The precondition is asserted, not assumed. The first version used a
     * line-anchored regex that missed every SINGLE-LINE `export { ... }` — so
     * `planDryRun`, the symbol this test exists for, was not in the set it
     * searched, and the check passed against the exact stale claim it was
     * written to catch.
     */
    expect(exported).toContain('planDryRun');
    expect(exported).toContain('renderPullRequestBody');
    expect(exported.length).toBeGreaterThan(40);

    const denials: string[] = [];
    for (const symbol of exported) {
      // A sentence naming the symbol AND denying its existence.
      const pattern = new RegExp(
        `\`${symbol}\`[^.]{0,160}?(does not exist|is not built|no such)`, 'i',
      );
      if (pattern.test(section)) denials.push(symbol);
    }
    expect(denials, `claimed absent while exported: ${denials.join(', ')}`).toEqual([]);
  });
});
