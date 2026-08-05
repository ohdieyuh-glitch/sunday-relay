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
  // relay.css paints it with a gradient clipped to the text (`background`,
  // `background-clip: text`, `color: transparent`); mission-control.css
  // declares NO colour at all — only `font-weight: 700` and
  // `letter-spacing: 0.18em`, which override relay.css's 800 and 0.22em.
  'relay-wordmark': 'PRE-EXISTING: mission-control.css declares no colour and overrides font-weight (800 to 700) and letter-spacing (0.22em to 0.18em). Not verified as intentional.',
  // relay.css declares `color` AND `font-size: 12px`; mission-control.css
  // declares colour only, and is imported second, so it overrides only the
  // colour. Stated exactly, because this file's own rule is that a reason
  // which is not true of the code is the rot it exists to prevent.
  'relay-dim': 'relay.css declares colour + font-size; mission-control.css colour only, and overrides only colour',
  // Not harmless, and not claimed to be. `main.tsx` imports relay.css then
  // mission-control.css, so the later one overrides padding (9px 16px becomes
  // 6px 12px) and border-radius, and INTRODUCES min-height: 32px, which
  // relay.css does not declare at all. On `.relay-tagline` it introduces
  // margin-left and also overrides colour and font-size. Pre-existing
  // behaviour on a surface this change does not touch; recorded as a known
  // collision rather than asserted safe.
  'relay-btn': 'PRE-EXISTING: mission-control.css re-declares padding and border-radius and INTRODUCES min-height. Not verified as intentional.',
  'relay-tagline': 'PRE-EXISTING: mission-control.css INTRODUCES margin-left and also overrides colour and font-size. Not verified as intentional.',
  // Surfaced only once compound selectors became their own key. Both sheets
  // declare these at equal specificity and mission-control.css is imported
  // second, so its `color` and `border-color` win. relay.css gives `.primary`
  // a gradient background and `font-weight: 700`; mission-control declares
  // neither, so those survive.
  //
  // The gradient is NOT gold, whatever the token is called: `--gold-400` is
  // `#ad9beb` and `--gold-600` is `#8a74cf` — periwinkle and lilac, since the
  // de-gold reskin. `--mc-gold` is `#d9a441`, a real gold. So the shipped
  // result is gold text on a lilac gradient. Reading the token NAME instead of
  // its VALUE is how the previous version of this comment described it as
  // "gold-on-gold", which is the same defect this file exists to catch.
  'primary.relay-btn': 'PRE-EXISTING: mission-control.css wins on colour (#d9a441 gold) and border-color; relay.css keeps its periwinkle/lilac gradient and font-weight. Not verified as intentional.',
  'ghost.relay-btn': 'PRE-EXISTING: both sheets declare it; mission-control.css wins on colour while relay.css keeps background and border-color. Not verified as intentional.',
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
  /** One frame per open brace: whether it is an at-rule, and whether a rule. */
  const stack: ('at' | 'rule' | 'keyframes')[] = [];
  let buffer = '';

  const insideRule = () => stack.includes('rule') || stack.includes('keyframes');

  for (const char of source) {
    if (char === ';') {
      // A STATEMENT AT-RULE ends here and has no block: `@import url(x);`,
      // `@charset "UTF-8";`, `@layer a, b;`. Without this reset the buffer runs
      // on into the NEXT rule's selector, `startsWith('@')` misclassifies the
      // pair, and that rule vanishes — a silent false negative, which is the
      // same failure mode as the defect this file exists to catch.
      buffer = '';
      continue;
    }
    if (char === '{') {
      const head = buffer.trim();
      buffer = '';
      if (head.startsWith('@')) {
        // `\b`-anchored and case-insensitive: at-rule names are ASCII
        // case-insensitive, and `@keyframesish` is not `@keyframes`.
        stack.push(/^@(?:-[\w]+-)?keyframes\b/i.test(head) ? 'keyframes' : 'at');
        continue;
      }
      // A selector nested inside another RULE is scoped by its parent, exactly
      // like a descendant selector, so it is not an unscoped definition.
      if (!insideRule() && head !== '') lists.push(head);
      stack.push('rule');
      continue;
    }
    if (char === '}') {
      stack.pop();
      buffer = '';
      continue;
    }
    buffer += char;
  }
  // A sheet that ends inside a block was mis-parsed: every rule after the
  // unbalanced brace was read as nested and therefore skipped, so the rest of
  // the file went DARK. That is the same silent miss this guard exists to
  // prevent, so it is reported rather than tolerated.
  if (stack.length !== 0) throw new UnbalancedStylesheet(stack.length);
  return lists;
}

/** Thrown rather than swallowed: a mis-parsed sheet must not read as a clean one. */
class UnbalancedStylesheet extends Error {
  constructor(depth: number) {
    super(`stylesheet ends ${depth} block(s) deep — it cannot be scanned for collisions`);
    this.name = 'UnbalancedStylesheet';
  }
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
        .replace(/:{1,2}[\w-]+/g, '')
        // A leading element or universal still styles the same elements a bare
        // class rule would reach, so `a.foo` and `*.foo` define `foo`.
        .replace(/^[*]|^[a-zA-Z][\w-]*/, '');
      if (!bare.startsWith('.')) continue;
      const classes = [...bare.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      if (classes.length === 0) continue;
      // A COMPOUND is keyed on the whole compound, not dropped. A bare `.a`
      // cannot reach `.a.b` — but two sheets that BOTH declare `.a.b` are equal
      // specificity and the later one silently wins, which is the very thing
      // being guarded against. Sorted, so `.a.b` and `.b.a` are one key.
      names.add([...classes].sort().join('.'));
    }
  }
  return names;
}

function ownersByClass(files: readonly string[]): {
  owners: Map<string, string[]>; unscannable: string[];
} {
  const owners = new Map<string, string[]>();
  const unscannable: string[] = [];
  for (const file of files) {
    const relative = file.slice(SRC.length + 1);
    let names: Set<string>;
    try {
      names = definedClasses(readFileSync(file, 'utf8'));
    } catch (error) {
      // Named, not skipped. A sheet nobody could scan is a hole in the guard,
      // and a guard with an unreported hole is worse than no guard.
      unscannable.push(`${relative} — ${(error as Error).message}`);
      continue;
    }
    for (const name of names) {
      owners.set(name, [...(owners.get(name) ?? []), relative]);
    }
  }
  return { owners, unscannable };
}

describe('no class is defined by two stylesheets that share a bundle', () => {
  const files = stylesheets(SRC);
  const { owners, unscannable } = ownersByClass(files);

  it('every stylesheet could actually be scanned', () => {
    // A sheet the parser cannot walk contributes no classes, so it would slip
    // through every assertion below while looking clean.
    expect(unscannable, 'these stylesheets could not be scanned').toEqual([]);
  });

  it('parses real stylesheets, so nothing below can pass vacuously', () => {
    expect(files.length, 'found no stylesheets to walk').toBeGreaterThan(10);
    // The extractor must be producing real output. Without this, stubbing it to
    // return an empty Set makes every assertion below pass — and the only thing
    // that would notice is the allow-list canary, which the self-cleaning rule
    // actively encourages deleting.
    expect(owners.size, 'the class extractor produced almost nothing').toBeGreaterThan(500);
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
    // A COMPOUND is keyed on the whole compound rather than dropped: a bare
    // `.a` cannot reach `.a.b`, but two sheets that both declare `.a.b` are
    // equal specificity and the later one silently wins.
    expect(of('.a.b { }')).toEqual(['a.b']);
    expect(of('.b.a { }')).toEqual(['a.b']);
    // Element-qualified and universal still style what a bare class would.
    expect(of('a.foo { }')).toEqual(['foo']);
    expect(of('*.foo { }')).toEqual(['foo']);
    // A selector nested inside another rule is scoped by its parent.
    expect(of('.parent { .nested { color: red } }')).toEqual(['parent']);
    // A statement at-rule must not swallow the rule that follows it. Without
    // the `;` reset the buffer runs on, `startsWith('@')` misclassifies the
    // pair, and the following rule VANISHES — a silent false negative, the
    // same failure mode as the defect this file exists to catch.
    expect(of('@import url("x.css");\n.after { }')).toEqual(['after']);
    expect(of('@layer a, b;\n.after { }')).toEqual(['after']);
    expect(of('@charset "UTF-8";\n.after { }')).toEqual(['after']);
    // `\b`-anchored and case-insensitive, because at-rule names are ASCII
    // case-insensitive and `@keyframesish` is a different at-rule.
    expect(of('@keyframesish x { .kept { } }')).toEqual(['kept']);
    // Discriminating case. `@KEYFRAMES x { from {} }` yields [] whether or not
    // the match is case-insensitive, because `from` is not a class — so it
    // could never fail against the code it names. A CLASS inside the block is
    // what tells the two apart.
    expect(of('@KEYFRAMES x { .cls { } }')).toEqual([]);
    // A sheet that ends inside a block REPORTS rather than returning a partial
    // answer. Every rule after the unbalanced brace would have been read as
    // nested and skipped, so the rest of the file went dark — the same silent
    // miss this guard exists to prevent. The caller names the file instead.
    expect(() => of('.unterminated { color: red')).toThrow(/cannot be scanned/);
    // A stray closing brace is recoverable and does not hide anything.
    expect(of('} .stray { }')).toEqual(['stray']);
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
