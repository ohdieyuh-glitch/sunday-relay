import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NO TWO STYLESHEETS MAY QUIETLY STYLE EACH OTHER'S COMPONENTS.
 *
 * This exists because of a defect that four review rounds and 5000 passing
 * tests did not catch. The Demo Mission summary owned `.rdm` and `.rdm-body`;
 * so did the Relay Dog's motion boundary. Both stylesheets are imported into
 * the same bundle, so equal specificity and later source order put the demo
 * panel's `overflow-x: hidden` ON THE DOG below 640px — re-imposing the exact
 * vertical clip the Relay Stage was built to remove — and gave the dog a
 * border and panel background at every width.
 *
 * Nothing failed. Both components' own tests passed, because each read only
 * its own stylesheet. The collision existed solely in the built artifact.
 *
 * The previous guard asserted that ONE file does not declare ONE class. That
 * closes the instance. This closes the CLASS OF BUG: every class name defined
 * in more than one stylesheet must be listed below with a reason.
 *
 * The list is SELF-CLEANING — an entry that stops colliding fails the test and
 * must be deleted, so a stale exception cannot accumulate.
 */

const SRC = join(__dirname, '..', '..');

/**
 * Collisions that are deliberate, each with the reason it is safe.
 *
 * A class belongs here only if the two definitions cannot restyle each other's
 * component — because one is specificity-scoped to a context the other never
 * enters, or because both describe the same component on purpose.
 */
const ALLOWED_COLLISIONS: Readonly<Record<string, string>> = Object.freeze({
  // `relay.css` and `mission-control.css` share four design-system classes.
  // Both definitions are colour and typography only — neither declares
  // `overflow`, `position`, or any box property — so the later one restyles the
  // earlier one's appearance and cannot move or clip anything. Pre-existing,
  // and untouched by the Relay Stage work.
  'relay-wordmark': 'relay.css + mission-control.css, colour and type only',
  'relay-tagline': 'relay.css + mission-control.css, colour and type only',
  'relay-dim': 'relay.css + mission-control.css, colour and type only',
  'relay-btn': 'relay.css + mission-control.css, colour and type only',
});

/** Rules whose selector is attribute-scoped cannot collide with a bare class. */
const THEME_SCOPED = /\[data-relay-colorway=/;

function stylesheets(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) stylesheets(full, found);
    else if (entry.endsWith('.css')) found.push(full);
  }
  return found;
}

/** Class names this stylesheet defines in an UNSCOPED rule. */
function definedClasses(css: string): Set<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set<string>();
  for (const match of withoutComments.matchAll(/([^{}]+)\{[^}]*\}/g)) {
    const selectorList = match[1];
    if (THEME_SCOPED.test(selectorList)) continue;
    for (const selector of selectorList.split(',')) {
      const trimmed = selector.trim();
      if (trimmed.startsWith('@') || trimmed === '') continue;
      // Only the SUBJECT of the selector — its last compound — can be restyled
      // by another sheet's bare rule. `.rps-mcp .rmcp` defines `rmcp` only in
      // the context of `.rps-mcp`, so it is not an unscoped definition.
      const compounds = trimmed.split(/\s+|>|\+|~/).filter(Boolean);
      if (compounds.length !== 1) continue;
      const classes = [...compounds[0].matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      if (classes.length === 1) names.add(classes[0]);
    }
  }
  return names;
}

describe('no class is defined by two stylesheets that share a bundle', () => {
  const files = stylesheets(SRC);

  it('finds the stylesheets, so an empty walk cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('every cross-stylesheet collision is listed with a reason', () => {
    const owners = new Map<string, string[]>();
    for (const file of files) {
      const relative = file.slice(SRC.length + 1);
      if (relative.endsWith('relay-manual-theme.css')) continue;
      for (const name of definedClasses(readFileSync(file, 'utf8'))) {
        owners.set(name, [...(owners.get(name) ?? []), relative]);
      }
    }

    const undeclared: string[] = [];
    for (const [name, sheets] of owners) {
      if (sheets.length < 2) continue;
      if (name in ALLOWED_COLLISIONS) continue;
      undeclared.push(`${name} — ${sheets.join(' AND ')}`);
    }

    expect(
      undeclared.sort(),
      'each of these class names is defined by two stylesheets in one bundle, so '
      + 'the later one silently restyles the earlier one’s component. Rename it, '
      + 'scope it, or add it to ALLOWED_COLLISIONS with the reason it is safe.',
    ).toEqual([]);
  });

  it('the allow-list is self-cleaning: no entry has stopped colliding', () => {
    const owners = new Map<string, number>();
    for (const file of files) {
      if (file.endsWith('relay-manual-theme.css')) continue;
      for (const name of definedClasses(readFileSync(file, 'utf8'))) {
        owners.set(name, (owners.get(name) ?? 0) + 1);
      }
    }
    const stale = Object.keys(ALLOWED_COLLISIONS)
      .filter((name) => !name.startsWith('__'))
      .filter((name) => (owners.get(name) ?? 0) < 2);
    expect(stale, 'these exceptions no longer collide and must be deleted')
      .toEqual([]);
  });
});
