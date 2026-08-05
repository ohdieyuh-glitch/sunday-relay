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
 * THE PARSER IS BRACE-AWARE, and that is not a detail. The first version of
 * this guard matched `([^{}]+)\{[^}]*\}`, which swallows `@media … { .a { … }`
 * as a single match whose "selector" is the at-rule. It therefore MISSED THE
 * VERY RULE IT WAS WRITTEN FOR — the offending `.rdm` sat first inside a
 * `@media (max-width: 640px)` block — while catching the second and later rules
 * in the same block. Coverage was positionally accidental, and the cheapest way
 * to silence a real failure would have been to move the rule into a media
 * query. An at-rule does not scope a class name, so this parser descends.
 */

const SRC = join(__dirname, '..', '..');

/**
 * Collisions that exist today, each with a reason that is TRUE of the code.
 *
 * A reason here is a claim about behaviour, and an exception whose reason is
 * untrue is exactly the rot this file exists to prevent — the first version of
 * this list said these four were "colour and typography only", which is false
 * of two of them.
 */
const ALLOWED_COLLISIONS: Readonly<Record<string, string>> = Object.freeze({
  'relay-wordmark': 'relay.css + mission-control.css; both declare colour and font only',
  'relay-dim': 'relay.css + mission-control.css; both declare colour only',
  // Not harmless, and not claimed to be. `main.tsx` imports relay.css then
  // mission-control.css, so the later one re-declares padding (6px 12px over
  // 9px 16px), border-radius, border and min-height on every `.relay-btn`, and
  // margin-left on `.relay-tagline`. That is pre-existing behaviour on a
  // surface this change does not touch; it is recorded here as a known
  // collision rather than asserted safe.
  'relay-btn': 'PRE-EXISTING: mission-control.css re-declares padding/border-radius/min-height. Not verified as intentional.',
  'relay-tagline': 'PRE-EXISTING: mission-control.css re-declares margin-left. Not verified as intentional.',
});

/** A selector scoped to a colourway cannot collide with a bare class. */
const THEME_SCOPED = /\[data-relay-colorway=/;

function stylesheets(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) stylesheets(full, found);
    else if (entry.endsWith('.css')) found.push(full);
  }
  return found;
}

/**
 * Every selector list in the sheet, including those nested inside at-rules.
 *
 * Walks braces rather than matching them, so `@media { .a { } }` yields `.a`
 * and not `@media`. `@keyframes` is skipped: its children are percentages and
 * keywords, not selectors.
 */
function selectorLists(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const lists: string[] = [];
  const atRuleDepth: boolean[] = [];
  let buffer = '';
  let inKeyframes = 0;

  for (const char of source) {
    if (char === '{') {
      const head = buffer.trim();
      buffer = '';
      const isAtRule = head.startsWith('@');
      atRuleDepth.push(isAtRule);
      if (isAtRule) {
        if (/^@keyframes|^@-\w+-keyframes/.test(head)) inKeyframes += 1;
        continue;
      }
      // A rule's children are declarations, not selectors — but we only ever
      // reach here at a depth where `head` is a real selector list.
      if (inKeyframes === 0 && head !== '') lists.push(head);
      continue;
    }
    if (char === '}') {
      const wasAtRule = atRuleDepth.pop();
      if (wasAtRule && inKeyframes > 0) inKeyframes -= 1;
      buffer = '';
      continue;
    }
    buffer += char;
  }
  return lists;
}

/** Split a selector list on commas that are not inside `(` or `[`. */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/**
 * The selector's single compound, or null if it has a combinator.
 *
 * A descendant or sibling selector is SCOPED: `.x .a` styles `.a` only inside
 * `.x`, so another sheet's bare `.a` rule cannot be fighting it for the same
 * elements in the same way. Only a selector that is one compound is an
 * unscoped definition.
 */
function soleCompoundOf(selector: string): string | null {
  let depth = 0;
  for (const char of selector) {
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      return null;
    }
  }
  return selector.trim();
}

/**
 * Class names this stylesheet defines UNSCOPED — that is, as the whole subject
 * of a rule, where another sheet's bare rule of the same name would fight it.
 *
 * `.a:hover` and `.a[data-x]` count: they still style `.a`. `.a.b` and `.x .a`
 * do not: they need a second class or an ancestor, so they cannot be reached by
 * a bare `.a` rule alone.
 */
function definedClasses(css: string): Set<string> {
  const names = new Set<string>();
  for (const list of selectorLists(css)) {
    for (const selector of splitSelectorList(list)) {
      // Checked PER SELECTOR, not per list: `[data-relay-colorway=x] .a, .b {}`
      // scopes `.a` and leaves `.b` bare.
      if (THEME_SCOPED.test(selector)) continue;
      const subject = soleCompoundOf(selector);
      if (subject === null) continue;
      // Functional pseudo-classes carry their own selectors; strip them whole
      // so `.a:not(.b)` reads as `.a` and never invents a `.b`.
      const bare = subject
        .replace(/:{1,2}[\w-]+\([^)]*\)/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/:{1,2}[\w-]+/g, '');
      if (!bare.startsWith('.')) continue;
      const classes = [...bare.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      if (classes.length === 1) names.add(classes[0]);
    }
  }
  return names;
}

function ownersByClass(files: readonly string[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const file of files) {
    const relative = file.slice(SRC.length + 1);
    for (const name of definedClasses(readFileSync(file, 'utf8'))) {
      owners.set(name, [...(owners.get(name) ?? []), relative]);
    }
  }
  return owners;
}

describe('no class is defined by two stylesheets that share a bundle', () => {
  const files = stylesheets(SRC);
  const owners = ownersByClass(files);

  it('parses real stylesheets, so nothing below can pass vacuously', () => {
    expect(files.length, 'found no stylesheets to walk').toBeGreaterThan(10);
    // The extractor must be producing real output. Without this, stubbing it to
    // return an empty Set makes every assertion below pass — and the only thing
    // that would notice is the allow-list canary, which the self-cleaning rule
    // actively encourages deleting.
    expect(owners.size, 'the class extractor produced almost nothing').toBeGreaterThan(200);
  });

  it('descends into at-rules, where the original defect lived', () => {
    // The offending `.rdm` was the FIRST rule inside `@media (max-width: 640px)`.
    // A parser that treats an at-rule opener as a selector misses exactly that.
    const nested = selectorLists('@media (max-width: 640px) { .first { color: red } .second { } }');
    expect(nested).toEqual(['.first', '.second']);
    expect(selectorLists('@keyframes x { from { opacity: 0 } }')).toEqual([]);
  });

  it('reads a selector’s subject, and only when it is a bare class', () => {
    const of = (css: string) => [...definedClasses(css)];
    expect(of('.a:hover { }')).toEqual(['a']);
    expect(of('.a[data-x] { }')).toEqual(['a']);
    expect(of('.a:not(.b) { }')).toEqual(['a']);
    expect(of('.a:is(.c, .d) { }')).toEqual(['a']);
    expect(of('.a, .b { }')).toEqual(['a', 'b']);
    // Needs an ancestor or a second class, so a bare rule cannot reach it.
    expect(of('.x .a { }')).toEqual([]);
    expect(of('.a.b { }')).toEqual([]);
    // Scoped per selector, not per list.
    expect(of('[data-relay-colorway="m"] .q, .bare { }')).toEqual(['bare']);
  });

  it('every cross-stylesheet collision is listed with a reason', () => {
    const undeclared: string[] = [];
    for (const [name, sheets] of owners) {
      if (sheets.length < 2) continue;
      // `hasOwn`, not `in`: `.constructor` and `.toString` are legal class
      // names and would otherwise be exempted by the prototype chain.
      if (Object.hasOwn(ALLOWED_COLLISIONS, name)) continue;
      undeclared.push(`${name} — ${sheets.join(' AND ')}`);
    }

    expect(
      undeclared.sort(),
      'each of these class names is defined by two stylesheets in one bundle, so '
      + 'the later one silently restyles the earlier one’s component. Rename it, '
      + 'scope it, or add it to ALLOWED_COLLISIONS with a reason that is TRUE.',
    ).toEqual([]);
  });

  it('the allow-list is self-cleaning: no entry has stopped colliding', () => {
    const stale = Object.keys(ALLOWED_COLLISIONS)
      .filter((name) => (owners.get(name)?.length ?? 0) < 2);
    expect(stale, 'these exceptions no longer collide and must be deleted')
      .toEqual([]);
  });
});
