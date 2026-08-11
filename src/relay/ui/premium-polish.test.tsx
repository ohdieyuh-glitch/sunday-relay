/** @vitest-environment jsdom */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { RelayPixelDog } from './pixel-dog';

/**
 * THE PREMIUM POLISH PASS, HELD MECHANICALLY.
 *
 * The polish itself is a judgement and no test can hold it. Four things about
 * it are not judgements, and every one of them is the kind of claim this
 * repository has shipped untrue before:
 *
 *   1. ONE TOKEN SYSTEM. `relay-tokens.css` is Relay's only token sheet. A
 *      token nobody consumes is a second vocabulary starting, and a token
 *      redefined in a surface sheet is that sheet forking the system.
 *   2. CONTRAST IS MEASURED, NOT ASSUMED. A glossier surface that drops small
 *      text under WCAG AA is a regression. The values are read out of the real
 *      stylesheets and the ratios are computed here, so a future "just a shade
 *      dimmer" fails at the shade rather than in someone's eyes. This pass
 *      LIFTED three colorways' secondary and tertiary text tiers because they
 *      measured 2.06:1 to 3.08:1 while carrying 8-11px metadata.
 *   3. GLASS IS GUARDED AND NEVER TOUCHES THE DOG. `backdrop-filter` lives
 *      inside `@supports`, so a browser without it keeps the flat surface
 *      instead of a transparent one — and no blur, radius or shadow may land on
 *      the Relay Dog's artwork, which is a hard voxel sprite whose sharpness is
 *      part of the identity.
 *   4. EVERY TRANSITION CAN BE SWITCHED OFF. A hover transition is one line and
 *      nothing about writing it reminds you that someone reading the page asked
 *      the operating system to stop things moving.
 *
 * WHAT THIS DOES NOT CLAIM. No frame has been measured and no browser has
 * rendered any of this — there is none in this environment. Animation gating is
 * held by `workspace-motion-quality.test.tsx`; this file holds transitions.
 */

const UI = __dirname;
const RELAY = join(UI, '..');

function stylesheetPaths(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) stylesheetPaths(full, found);
    else if (entry.endsWith('.css')) found.push(full);
  }
  return found;
}

const SHEETS: readonly { path: string; name: string; css: string }[] = stylesheetPaths(RELAY)
  .map((path) => ({ path, name: path.slice(RELAY.length + 1), css: readFileSync(path, 'utf8') }));

const read = (name: string): string => {
  const sheet = SHEETS.find((s) => s.name === name);
  if (sheet === undefined) throw new Error(`no stylesheet ${name}`);
  return sheet.css;
};

/* ------------------------------------------------------------------ parsing */

interface Rule {
  /** The selector list, comments stripped and whitespace collapsed. */
  selectors: string;
  /** Declarations of this rule only — nested blocks excluded. */
  body: string;
  /** Enclosing at-rule preludes, outermost first. */
  atRules: string[];
}

/**
 * Brace-aware rule walk. Descends at-rules (an at-rule does not scope a
 * declaration) and skips `@keyframes`, whose children are keyframe selectors
 * rather than element selectors.
 */
function rules(css: string): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const stack: { kind: 'at' | 'rule' | 'keyframes'; head: string }[] = [];
  let buffer = '';

  const inKeyframes = () => stack.some((f) => f.kind === 'keyframes');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') {
      const head = buffer.trim().replace(/\s+/g, ' ');
      buffer = '';
      if (head.startsWith('@')) {
        stack.push({
          kind: /^@(?:-[\w]+-)?keyframes\b/i.test(head) ? 'keyframes' : 'at',
          head,
        });
        continue;
      }
      stack.push({ kind: 'rule', head });
      continue;
    }
    if (char === '}') {
      const frame = stack.pop();
      if (frame !== undefined && frame.kind === 'rule' && !inKeyframes()) {
        out.push({
          selectors: frame.head,
          body: buffer,
          atRules: stack.filter((f) => f.kind === 'at').map((f) => f.head),
        });
      }
      buffer = '';
      continue;
    }
    buffer += char;
  }
  return out;
}

/** Custom properties declared by the FIRST rule whose selector list matches. */
function tokensOf(css: string, selector: string): Record<string, string> {
  const rule = rules(css).find((r) => r.selectors === selector);
  if (rule === undefined) throw new Error(`no rule for selector ${selector}`);
  const declared: Record<string, string> = {};
  for (const match of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declared[match[1]] = match[2].trim();
  }
  return declared;
}

/* ----------------------------------------------------------------- contrast */

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not an opaque hex colour: ${hex}`);
  return (
    0.2126 * channel(parseInt(full.slice(0, 2), 16))
    + 0.7152 * channel(parseInt(full.slice(2, 4), 16))
    + 0.0722 * channel(parseInt(full.slice(4, 6), 16))
  );
}

/** WCAG 2.1 relative-luminance contrast ratio. */
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * A colour tier: which stylesheet block declares it, and under which name.
 * Resolved through ONE level of `var(--other)`, which is how the manual
 * colorway maps its semantic tokens onto each surface.
 */
interface Palette { readonly label: string; readonly tokens: Record<string, string> }

function resolve(palette: Palette, token: string, through?: Palette): string {
  const raw = palette.tokens[token];
  if (raw === undefined) throw new Error(`${palette.label} declares no ${token}`);
  const via = /^var\((--[\w-]+)\)$/.exec(raw);
  if (via === null) return raw;
  const source = through ?? palette;
  const target = source.tokens[via[1]];
  if (target === undefined) throw new Error(`${palette.label}: ${token} -> ${via[1]} unresolved`);
  return target;
}

const ENTRY = read('ui/entry-home/relay-entry-home.css');
const WORKSPACE = read('ui/project-workspace/relay-project-workspace.css');
const SETTINGS = read('ui/project-settings/relay-project-settings.css');
const CHROME = read('ui/chrome/relay-chrome.css');
const MANUAL = read('ui/relay-manual-theme.css');
const TOKENS = read('relay-tokens.css');
const MISSION_CONTROL = read('ui/mission-control.css');

const palettes = {
  entryObsidian: { label: 'entry home / obsidian', tokens: tokensOf(ENTRY, '.reh') },
  entryMidnight: {
    label: 'entry home / midnight',
    tokens: tokensOf(ENTRY, "[data-relay-colorway='midnight'] .reh"),
  },
  workspaceObsidian: { label: 'workspace / obsidian', tokens: tokensOf(WORKSPACE, '.rpw') },
  workspaceMidnight: {
    label: 'workspace / midnight',
    tokens: tokensOf(WORKSPACE, "[data-relay-colorway='midnight'] .rpw"),
  },
  settingsObsidian: { label: 'settings / obsidian', tokens: tokensOf(SETTINGS, '.rps') },
  settingsMidnight: {
    label: 'settings / midnight',
    tokens: tokensOf(SETTINGS, "[data-relay-colorway='midnight'] .rps"),
  },
  chromeObsidian: { label: 'mobile chrome / obsidian', tokens: tokensOf(CHROME, ':root') },
  chromeMidnight: {
    label: 'mobile chrome / midnight',
    tokens: tokensOf(CHROME, "[data-relay-colorway='midnight']"),
  },
  missionControl: { label: 'mission control', tokens: tokensOf(MISSION_CONTROL, '.relay-mc') },
  root: { label: 'relay tokens', tokens: tokensOf(TOKENS, ':root') },
  manual: { label: 'RELAY MANUAL', tokens: tokensOf(MANUAL, "[data-relay-colorway='manual']") },
} as const;

/**
 * Every text tier against every ground it is actually painted on.
 *
 * 4.5:1 is the WCAG AA floor for normal text, and this is normal text: the
 * tertiary tier carries 8-11px metadata — timestamps, operating keys, phase
 * labels, verification notes. It is deliberately NOT the 3:1 large-text floor.
 *
 * BORDERS ARE OUT OF SCOPE and not silently included: a panel divider is not a
 * UI component boundary a reader must find. The controls that DO need 3:1
 * (inputs) already carry a graphite border in every colorway.
 */
const TEXT_ON_GROUND: readonly {
  palette: Palette; text: string; grounds: readonly string[];
}[] = [
  { palette: palettes.entryObsidian, text: '--reh-cream', grounds: ['--reh-bg', '--reh-panel', '--reh-panel-2'] },
  { palette: palettes.entryObsidian, text: '--reh-dim', grounds: ['--reh-bg', '--reh-panel', '--reh-panel-2'] },
  { palette: palettes.entryObsidian, text: '--reh-faint', grounds: ['--reh-bg', '--reh-panel', '--reh-panel-2'] },
  { palette: palettes.entryMidnight, text: '--reh-cream', grounds: ['--reh-bg', '--reh-panel', '--reh-panel-2'] },
  { palette: palettes.entryMidnight, text: '--reh-dim', grounds: ['--reh-bg', '--reh-panel', '--reh-panel-2'] },
  { palette: palettes.entryMidnight, text: '--reh-faint', grounds: ['--reh-bg', '--reh-panel', '--reh-panel-2'] },
  { palette: palettes.workspaceObsidian, text: '--rpw-cream', grounds: ['--rpw-bg', '--rpw-panel', '--rpw-panel-2'] },
  { palette: palettes.workspaceObsidian, text: '--rpw-dim', grounds: ['--rpw-bg', '--rpw-panel', '--rpw-panel-2'] },
  { palette: palettes.workspaceObsidian, text: '--rpw-faint', grounds: ['--rpw-bg', '--rpw-panel', '--rpw-panel-2'] },
  { palette: palettes.workspaceMidnight, text: '--rpw-cream', grounds: ['--rpw-bg', '--rpw-panel', '--rpw-panel-2'] },
  { palette: palettes.workspaceMidnight, text: '--rpw-dim', grounds: ['--rpw-bg', '--rpw-panel', '--rpw-panel-2'] },
  { palette: palettes.workspaceMidnight, text: '--rpw-faint', grounds: ['--rpw-bg', '--rpw-panel', '--rpw-panel-2'] },
  { palette: palettes.settingsObsidian, text: '--rps-dim', grounds: ['--rps-bg', '--rps-panel'] },
  { palette: palettes.settingsObsidian, text: '--rps-faint', grounds: ['--rps-bg', '--rps-panel'] },
  { palette: palettes.settingsMidnight, text: '--rps-dim', grounds: ['--rps-bg', '--rps-panel'] },
  { palette: palettes.settingsMidnight, text: '--rps-faint', grounds: ['--rps-bg', '--rps-panel'] },
  { palette: palettes.chromeObsidian, text: '--rmc-dim', grounds: ['--rmc-bg', '--rmc-panel'] },
  { palette: palettes.chromeMidnight, text: '--rmc-dim', grounds: ['--rmc-bg', '--rmc-panel'] },
  { palette: palettes.missionControl, text: '--mc-dim', grounds: ['--mc-bg', '--mc-panel'] },
  { palette: palettes.root, text: '--text', grounds: ['--bg', '--surface-solid'] },
  { palette: palettes.root, text: '--text-dim', grounds: ['--bg', '--surface-solid'] },
  { palette: palettes.root, text: '--text-faint', grounds: ['--bg', '--surface-solid'] },
  // RELAY MANUAL. Its black system areas and its ivory technical-manual areas
  // are two different grounds with two different ladders, so both are named.
  { palette: palettes.manual, text: '--relay-manual-cream', grounds: ['--relay-manual-black', '--relay-manual-stage', '--relay-manual-raised-black'] },
  { palette: palettes.manual, text: '--relay-manual-soft-gray', grounds: ['--relay-manual-black', '--relay-manual-stage', '--relay-manual-raised-black'] },
  { palette: palettes.manual, text: '--relay-manual-cream-text-muted', grounds: ['--relay-manual-black', '--relay-manual-stage', '--relay-manual-raised-black'] },
  { palette: palettes.manual, text: '--relay-manual-gold-muted', grounds: ['--relay-manual-black', '--relay-manual-stage', '--relay-manual-raised-black'] },
  { palette: palettes.manual, text: '--relay-manual-ink', grounds: ['--relay-manual-cream', '--relay-manual-cream-panel'] },
  { palette: palettes.manual, text: '--relay-manual-graphite-deep', grounds: ['--relay-manual-cream', '--relay-manual-cream-panel'] },
  { palette: palettes.manual, text: '--relay-manual-graphite', grounds: ['--relay-manual-cream', '--relay-manual-cream-panel'] },
];

describe('contrast is measured, on every colorway and every ground', () => {
  it('every text tier clears the 4.5:1 WCAG AA floor for normal text', () => {
    const failures: string[] = [];
    let measured = 0;
    for (const { palette, text, grounds } of TEXT_ON_GROUND) {
      const foreground = resolve(palette, text);
      for (const ground of grounds) {
        const ratio = contrast(foreground, resolve(palette, ground));
        measured += 1;
        if (ratio < 4.5) {
          failures.push(
            `${palette.label}: ${text} (${foreground}) on ${ground} `
            + `(${resolve(palette, ground)}) = ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }
    // Not vacuous: an empty table, or a resolver returning nothing, would
    // otherwise pass this silently.
    expect(measured, 'the contrast table measured almost nothing').toBeGreaterThan(60);
    expect(failures, 'these pairs are below the WCAG AA floor for normal text').toEqual([]);
  });

  it('keeps a readable LADDER, not three tiers at the same weight', () => {
    // Lifting the tertiary tier to clear AA can collapse it into the secondary,
    // which trades an accessibility failure for a hierarchy failure. Each step
    // must be a real step: at least 1.2x the ratio of the one below it.
    const ladders: readonly [Palette, string, string, string, string][] = [
      [palettes.entryObsidian, '--reh-bg', '--reh-faint', '--reh-dim', '--reh-cream'],
      [palettes.entryMidnight, '--reh-bg', '--reh-faint', '--reh-dim', '--reh-cream'],
      [palettes.workspaceObsidian, '--rpw-bg', '--rpw-faint', '--rpw-dim', '--rpw-cream'],
      [palettes.workspaceMidnight, '--rpw-bg', '--rpw-faint', '--rpw-dim', '--rpw-cream'],
      [palettes.root, '--bg', '--text-faint', '--text-dim', '--text'],
    ];
    for (const [palette, ground, faint, dim, primary] of ladders) {
      const bg = resolve(palette, ground);
      const steps = [faint, dim, primary].map((t) => contrast(resolve(palette, t), bg));
      expect(steps[1] / steps[0], `${palette.label}: secondary is not a step above tertiary`)
        .toBeGreaterThan(1.2);
      expect(steps[2] / steps[1], `${palette.label}: primary is not a step above secondary`)
        .toBeGreaterThan(1.2);
    }
  });

  it('the manual colorway’s ivory surfaces actually USE the ladder measured above', () => {
    // Measuring a token no surface assigns proves nothing. These are the five
    // cream re-scoping blocks; each must map its secondary tier to the deeper
    // graphite and its tertiary tier to graphite itself.
    // The tier tokens are NAMED rather than matched by suffix: `--rps-gold-dim`
    // also ends in `-dim`, and a suffix match found that instead — which would
    // have made this assertion about a border colour.
    const creamBlocks: readonly [string, string][] = [
      [
        "[data-relay-colorway='manual'] .reh-starter, [data-relay-colorway='manual'] .reh-routes, [data-relay-colorway='manual'] .reh-brief, [data-relay-colorway='manual'] .reh-recent, [data-relay-colorway='manual'] .reh-footer",
        '--reh',
      ],
      ["[data-relay-colorway='manual'] .reh-guide", '--reh'],
      ["[data-relay-colorway='manual'] .rps", '--rps'],
      ["[data-relay-colorway='manual'] .rpw-conversation", '--rpw'],
      ["[data-relay-colorway='manual'] .rpw-status", '--rpw'],
    ];
    for (const [selector, prefix] of creamBlocks) {
      const declared = tokensOf(MANUAL, selector);
      expect(declared[`${prefix}-dim`], `${selector} secondary tier`)
        .toBe('var(--relay-manual-graphite-deep)');
      expect(declared[`${prefix}-faint`], `${selector} tertiary tier`)
        .toBe('var(--relay-manual-graphite)');
    }
  });

  it('every themed scrollbar thumb clears the 3:1 floor for a UI component', () => {
    // `scrollbar-color: <thumb> <track>` is set once per surface root and
    // inherits into every scroller. A thumb nobody can see is a scrollbar
    // nobody can grab.
    const thumbs: readonly [Palette, string, string][] = [
      [palettes.entryObsidian, '--reh-faint', '--reh-bg'],
      [palettes.entryMidnight, '--reh-faint', '--reh-bg'],
      [palettes.workspaceObsidian, '--rpw-faint', '--rpw-bg'],
      [palettes.workspaceMidnight, '--rpw-faint', '--rpw-bg'],
      [palettes.settingsObsidian, '--rps-faint', '--rps-bg'],
      [palettes.root, '--text-faint', '--bg'],
      [palettes.chromeObsidian, '--rmc-dim', '--rmc-bg'],
      [palettes.missionControl, '--mc-dim', '--mc-bg'],
    ];
    for (const [palette, thumb, track] of thumbs) {
      const ratio = contrast(resolve(palette, thumb), resolve(palette, track));
      expect(ratio, `${palette.label}: ${thumb} thumb on ${track}`).toBeGreaterThanOrEqual(3);
    }
    /**
     * AND THE DECLARED THUMB IS THE ONE THAT WAS MEASURED.
     *
     * This checked that the STRING `scrollbar-color` appeared, and nothing tied
     * it to the tokens above — a mutation that swapped the value to an unmeasured
     * `#232323` (1.42:1) passed all 15 tests. That is a guarantee about a token
     * nobody proved the thumb uses. The declared value's first `var()` is now
     * resolved and required to be a token this list actually measured.
     */
    const measuredThumbs = new Set(thumbs.map(([, thumb]) => thumb));
    for (const [sheet, selector] of [
      [ENTRY, '.reh'], [WORKSPACE, '.rpw'], [SETTINGS, '.rps'],
      [read('relay.css'), '.relay-app'], [MISSION_CONTROL, '.relay-mc'],
    ] as const) {
      const rule = rules(sheet).find((r) => r.selectors === selector);
      expect(rule?.body, `${selector} declares no themed scrollbar`).toContain('scrollbar-color');
      const declared = /scrollbar-color:\s*([^;]+);/.exec(rule?.body ?? '');
      expect(declared, `${selector} scrollbar-color is unreadable`).not.toBeNull();
      const token = /var\(\s*(--[\w-]+)/.exec((declared as RegExpExecArray)[1])?.[1];
      expect(token, `${selector} declares a literal scrollbar thumb instead of a measured token`).toBeDefined();
      expect(measuredThumbs, `${selector} thumb ${String(token)} is not in the measured set`).toContain(token);
    }
  });
});

/* -------------------------------------------------------------- token system */

describe('relay-tokens.css is the ONE token system', () => {
  const declared = Object.keys(palettes.root.tokens);
  const allCss = SHEETS.map((s) => s.css).join('\n');

  it('declares the material and motion vocabulary the surfaces consume', () => {
    for (const token of [
      '--edge-light', '--edge-light-strong', '--elev-1', '--elev-2', '--elev-3',
      '--sheen', '--glass-blur', '--glass-blur-strong', '--glass-saturate',
      '--ease-emphasis', '--dur-fast', '--dur-base',
    ]) {
      expect(declared, `relay-tokens.css declares no ${token}`).toContain(token);
    }
    // Each elevation is built the same way: an inset edge light plus at least
    // one cast shadow. A "depth" token with no inset is a drop shadow, and the
    // step from 1 to 3 would stop being one system.
    for (const step of ['--elev-1', '--elev-2', '--elev-3'] as const) {
      const value = palettes.root.tokens[step];
      expect(value, `${step} has no inset edge light`).toContain('inset');
      expect(value, `${step} casts no shadow`).toMatch(/rgba\(0, 0, 0/);
    }
    // The sheen is LIGHT, not a colour: white at low alpha, so it works on
    // every colorway's panel without carrying a hue of its own.
    expect(palettes.root.tokens['--sheen']).toContain('linear-gradient');
    expect(palettes.root.tokens['--sheen']).toMatch(/rgba\(255, 255, 255/);
    expect(palettes.root.tokens['--ease-emphasis']).toMatch(/^cubic-bezier\(/);
  });

  it('has no dead token: every one is consumed by a Relay stylesheet', () => {
    // The header of relay-tokens.css claims exactly this. A token nobody reads
    // is a second vocabulary starting beside the live one, and the previous
    // version of that header carried a count that would have gone stale the
    // first time anyone added a line.
    const unused = declared.filter((token) => {
      const uses = allCss.match(new RegExp(`var\\(${token}\\b`, 'g')) ?? [];
      return uses.length === 0;
    });
    expect(unused, 'these tokens are declared and never consumed').toEqual([]);
  });

  it('no surface stylesheet redefines a material or motion token', () => {
    // A surface may define its OWN palette (`--rpw-*`, `--reh-*`) — that is the
    // established shape. What it may not do is redeclare the shared material,
    // because then two sheets disagree about what `--elev-2` means.
    const shared = [
      '--elev-1', '--elev-2', '--elev-3', '--sheen', '--edge-light',
      '--edge-light-strong', '--glass-blur', '--glass-blur-strong',
      '--glass-saturate', '--ease-emphasis', '--dur-fast', '--dur-base',
    ];
    const forks: string[] = [];
    for (const sheet of SHEETS) {
      if (sheet.name === 'relay-tokens.css') continue;
      for (const token of shared) {
        if (new RegExp(`${token}\\s*:`).test(sheet.css.replace(/\/\*[\s\S]*?\*\//g, ''))) {
          forks.push(`${sheet.name} redeclares ${token}`);
        }
      }
    }
    expect(forks).toEqual([]);
  });

  it('fetches no asset: not one stylesheet contains a url()', () => {
    // Every mark, scene and texture in Relay is drawn from primitives. A
    // request that can 404 is a surface that is sometimes not there.
    const offenders = SHEETS.filter((s) => s.css.includes('url(')).map((s) => s.name);
    expect(offenders).toEqual([]);
    expect(SHEETS.length, 'found no stylesheets to check').toBeGreaterThan(15);
  });
});

/* --------------------------------------------------------------------- glass */

describe('glass is guarded, and never lands on the Relay Dog', () => {
  const glassRules = SHEETS.flatMap((sheet) =>
    rules(sheet.css)
      .filter((rule) => /backdrop-filter\s*:/.test(rule.body))
      .map((rule) => ({ sheet: sheet.name, rule })),
  );

  it('every backdrop-filter sits inside an @supports test for it', () => {
    expect(glassRules.length, 'no glass was found at all').toBeGreaterThan(5);
    const unguarded = glassRules
      .filter(({ rule }) => !rule.atRules.some((at) => /^@supports\s*\(\s*backdrop-filter/.test(at)))
      .map(({ sheet, rule }) => `${sheet}: ${rule.selectors}`);
    expect(
      unguarded,
      'a browser without backdrop-filter would get the lowered opacity with no blur, '
      + 'which is a transparent panel rather than a frosted one',
    ).toEqual([]);
  });

  it('no glass, blur, radius or shadow reaches the voxel sprite', () => {
    // The Dog is a hard-edged 18x14 sprite rendered with `crispEdges`. Any of
    // these would soften or reshape the identity, and a "premium glass pass" is
    // exactly the change that would do it by accident.
    /**
     * TWO CLASSES OF SUBJECT, because they need different rules.
     *
     * The SPRITE itself takes none of the four properties. The CONTAINERS take
     * no `filter` — a mutation putting `filter: blur(1.5px)` on `.rpd-stage`
     * passed every test, because `RelayPixelDog` renders the sprite INSIDE that
     * element, so a filter there blurs the whole voxel Dog while touching none of
     * the four names the guard knew about.
     *
     * But containers may carry `border-radius` and `box-shadow`, and widening the
     * guard without that distinction flagged four legitimate rules: a tier
     * pedestal, a sleep mat, a dig hole and a dig mound. Those are round objects
     * the Dog stands on and digs — rounding them is the design, and a guard that
     * forbade it would have been widened away the first time somebody drew a
     * circle.
     */
    const spriteSubjects = /^\.(rpd-art|rpd-part|rpd-markwrap|rst-actor)\b/;
    const containerSubjects = /^\.(rpd-stage|rdm|rdo|rst-layer--actors)\b/;
    const offenders: string[] = [];
    for (const sheet of SHEETS) {
      for (const rule of rules(sheet.css)) {
        for (const selector of rule.selectors.split(',').map((s) => s.trim())) {
          // The SUBJECT is the last compound; `.rpd--tier .rpd-stage::before`
          // styles the stage, not the art.
          const subject = selector.split(/[\s>+~]+/).pop() ?? '';
          const isSprite = spriteSubjects.test(subject);
          const isContainer = containerSubjects.test(subject);
          if (!isSprite && !isContainer) continue;
          // A container may be round or lifted; it may never blur what is inside it.
          const properties = isSprite
            ? ['backdrop-filter', 'filter', 'border-radius', 'box-shadow']
            : ['backdrop-filter', 'filter'];
          for (const property of properties) {
            if (new RegExp(`(^|;|\\s)${property}\\s*:`).test(rule.body)) {
              offenders.push(`${sheet.name}: ${selector} declares ${property}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    // The sprite keeps its pixel rendering, which is the other half of sharp.
    expect(read('ui/pixel-dog/pixel-dog.css')).toMatch(/\.rpd-art\s*\{[^}]*image-rendering: pixelated/);
  });

  it('the stage vignette cannot darken an actor', () => {
    // It is painted on the BACKDROP element. The backdrop layer is z-index 0
    // and the actors layer is z-index 3, so the ordering — not a promise —
    // keeps the Dog out of it.
    const backdrop = read('ui/relay-stage/relay-stage-backdrop.css');
    expect(backdrop).toMatch(/\.rsb::after\s*\{[\s\S]*?pointer-events: none/);
    const stage = read('ui/relay-stage/relay-stage.css');
    expect(stage).toMatch(/\.rst-layer--backdrop \{ z-index: 0; \}/);
    expect(stage).toMatch(/\.rst-layer--actors \{ z-index: 3; \}/);
    // And the stage is still FRAMELESS: the vignette must not have become a box.
    const root = rules(stage).find((r) => r.selectors === '.rst');
    expect(root?.body).not.toMatch(/border\s*:|background\s*:|box-shadow\s*:|border-radius\s*:/);
  });
});

/* ----------------------------------------------------------- reduced motion */

describe('every transition Relay declares can be switched off', () => {
  /** The first class name in a selector, which is what a blanket rule reaches. */
  const firstClass = (selector: string): string | null => {
    const match = /\.([\w-]+)/.exec(selector);
    return match === null ? null : match[1];
  };

  const analysis = SHEETS.map((sheet) => {
    const parsed = rules(sheet.css);
    const reduced = parsed.filter((r) =>
      r.atRules.some((at) => /prefers-reduced-motion\s*:\s*reduce/.test(at)));
    const named = new Set<string>();
    const blankets: string[] = [];
    for (const rule of reduced) {
      for (const selector of rule.selectors.split(',').map((s) => s.trim())) {
        const blanket = /^\.([\w-]+) \*$/.exec(selector);
        if (blanket !== null) blankets.push(blanket[1]);
        const name = firstClass(selector);
        if (name !== null) named.add(name);
      }
    }
    const moving = parsed.filter((rule) => {
      if (rule.atRules.some((at) => /prefers-reduced-motion/.test(at))) return false;
      const declaration = /(^|;|\s)transition(-property)?\s*:\s*([^;]+)/.exec(rule.body);
      return declaration !== null && !/^none\b/.test(declaration[3].trim());
    });
    return { sheet: sheet.name, moving, named, blankets };
  });

  it('names or blankets every transitioned selector in its own stylesheet', () => {
    const total = analysis.reduce((sum, a) => sum + a.moving.length, 0);
    // Not vacuous: if the parser stopped finding transitions this whole suite
    // would pass while covering nothing.
    expect(total, 'found almost no transitions to hold').toBeGreaterThan(14);

    const uncovered: string[] = [];
    for (const { sheet, moving, named, blankets } of analysis) {
      for (const rule of moving) {
        for (const selector of rule.selectors.split(',').map((s) => s.trim())) {
          const name = firstClass(selector);
          if (name === null) continue;
          const covered = named.has(name)
            || blankets.some((root) => name === root || name.startsWith(`${root}-`));
          if (!covered) uncovered.push(`${sheet}: ${selector}`);
        }
      }
    }
    expect(
      uncovered,
      'each of these transitions keeps running for a reader who asked the '
      + 'operating system to stop things moving. Name the selector in a '
      + 'prefers-reduced-motion block in the same stylesheet.',
    ).toEqual([]);
  });

  it('gives press feedback without moving anything', () => {
    // A press that nudges the control is motion under a finger, and it is the
    // one feedback that cannot survive reduced motion. Relay deepens the plate
    // instead, so nothing here may transform on :active.
    const offenders: string[] = [];
    for (const sheet of SHEETS) {
      for (const rule of rules(sheet.css)) {
        if (!rule.selectors.includes(':active')) continue;
        if (/(^|;|\s)transform\s*:/.test(rule.body)) {
          offenders.push(`${sheet.name}: ${rule.selectors}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* -------------------------------------------------- the Dog's proportions */

afterEach(cleanup);

describe('the Relay Dog’s proportions survive the polish', () => {
  it('is 18x14 at one uniform scale, at every size the surfaces use', () => {
    // The identity specification is explicit that ONE scale factor drives both
    // axes — independent width and height distort the body. Every unit the
    // Relay surfaces pass is checked, not just the default.
    for (const unit of [1, 2, 3, 4, 6, 8, 12]) {
      const { container } = render(<RelayPixelDog pose="standing" label="TEST" unit={unit} />);
      const svg = container.querySelector('svg.rpd-art');
      expect(svg, `unit ${String(unit)} drew no art`).not.toBeNull();
      expect(Number(svg!.getAttribute('width'))).toBe(18 * unit);
      expect(Number(svg!.getAttribute('height'))).toBe(14 * unit);
      // Square pixels: the sprite cannot shear even if the box is right.
      for (const rect of Array.from(svg!.querySelectorAll('rect'))) {
        expect(rect.getAttribute('width')).toBe(rect.getAttribute('height'));
      }
      expect(svg!.getAttribute('shape-rendering')).toBe('crispEdges');
      cleanup();
    }
  });

  it('keeps short legs and a compact body: the anatomy rows are unchanged', () => {
    // The specification calls the proportions load-bearing. Rows 0-5 are the
    // head, 6-10 the body, 11-13 the legs — three leg rows out of fourteen is
    // what "short block-shaped legs" means numerically, and a polish pass that
    // restyled the sprite would move that boundary.
    const { container } = render(<RelayPixelDog pose="standing" label="TEST" unit={1} />);
    const svg = container.querySelector('svg.rpd-art')!;
    const rowsWithPixels = new Set(
      Array.from(svg.querySelectorAll('rect')).map((r) => Number(r.getAttribute('y'))),
    );
    expect(Math.max(...rowsWithPixels)).toBe(13);
    const legGroup = svg.querySelectorAll('.rpd-part--leg-front-near, .rpd-part--leg-front-far, .rpd-part--leg-rear-near, .rpd-part--leg-rear-far');
    expect(legGroup.length, 'four independently animatable paws').toBe(4);
    const legRows = new Set(
      Array.from(legGroup).flatMap((g) =>
        Array.from(g.querySelectorAll('rect')).map((r) => Number(r.getAttribute('y')))),
    );
    expect([...legRows].sort((a, b) => a - b)).toEqual([11, 12, 13]);
  });
});

/* ============ what an independent review found in the polish pass ============ */

describe('a grid override cannot silently lose its repeat', () => {
  /**
   * `background-size` is POSITIONAL, and CSS truncates the size list to the
   * image-layer count. The base grid rules grew from two layers to four with a
   * four-value size; five colorway overrides still declared two layers, so the
   * two grid lines took `100% 100%, 100% 100%` — on a `position: fixed; inset: 0`
   * element that is one line at the top, one at the left, and no grid at all.
   * The technical grid is a named identity element of every Relay surface, and
   * it was gone on five of the six colorway × surface combinations. Obsidian,
   * the default, was unaffected — so nobody testing the default would see it.
   *
   * The rule this closes: any `*-grid-bg` rule that declares `background-image`
   * must declare a `background-size` with the SAME number of values, so no rule
   * depends on a size list written for a different layer count.
   */
  const GRID_SHEETS = [
    'src/relay/ui/entry-home/relay-entry-home.css',
    'src/relay/ui/project-workspace/relay-project-workspace.css',
    'src/relay/ui/project-settings/relay-project-settings.css',
    'src/relay/ui/relay-manual-theme.css',
  ];

  /** Top-level comma count — commas inside `rgba(...)`/`linear-gradient(...)` do
   *  not separate layers, and counting them would make every rule look wrong. */
  const topLevelParts = (value: string): number => {
    let depth = 0;
    let parts = 1;
    for (const ch of value) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ',' && depth === 0) parts += 1;
    }
    return parts;
  };

  it('no grid rule declares a layer count the size list in effect does not cover', () => {
    /**
     * NOT "every rule must restate the size" — the retina blocks legitimately
     * inherit it, because they declare the SAME layer count as the base and only
     * halve the stops. The first version of this test demanded a restatement
     * everywhere and flagged three innocent rules, which is a guard that would
     * have been widened away the first time it fired.
     *
     * The real rule: a rule may inherit the base's size list only when its layer
     * count MATCHES the base's. Otherwise it must declare its own.
     */
    type Rule = { readonly selector: string; readonly layers: number; readonly sizes: number | null };
    const byClass = new Map<string, Rule[]>();
    for (const sheet of GRID_SHEETS) {
      const css = readFileSync(sheet, 'utf8');
      for (const match of css.matchAll(/([^{}]*?)\{([^{}]*)\}/g)) {
        const [, rawSelector, body] = match;
        const selector = rawSelector.trim().replace(/\s+/g, ' ');
        const cls = /\.((?:reh|rpw|rps)-grid-bg)\b/.exec(selector)?.[1];
        if (cls === undefined) continue;
        const image = /background-image:\s*([^;]+);/.exec(body);
        if (image === null) continue;
        const size = /background-size:\s*([^;]+);/.exec(body);
        const list = byClass.get(cls) ?? [];
        list.push({
          selector: `${sheet} ${selector}`,
          layers: topLevelParts(image[1]),
          sizes: size === null ? null : topLevelParts(size[1]),
        });
        byClass.set(cls, list);
      }
    }
    expect(byClass.size, 'no grid rules were parsed at all').toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [cls, rules] of byClass) {
      // The base is the one that declares a size and has the plainest selector.
      const base = rules.find((r) => r.sizes !== null && !r.selector.includes('['));
      if (base === undefined || base.sizes === null) {
        offenders.push(`${cls} has no base rule declaring a background-size`);
        continue;
      }
      for (const rule of rules) {
        const effective = rule.sizes ?? base.sizes;
        if (rule.layers !== effective) {
          offenders.push(`${rule.selector}: ${String(rule.layers)} layers against ${String(effective)} sizes`);
        }
      }
    }
    expect(offenders, 'a size list written for a different layer count silently kills the grid').toEqual([]);
  });
});

describe('the sheen does not eat the contrast the ladder guarantees', () => {
  /**
   * The pass added `--sheen` on top of the very panel tokens the contrast table
   * measures against. The arithmetic in that table was correct and the GROUND
   * was wrong: composited, the tightest pairs landed at 4.04–4.45.
   *
   * Asserted on the token's PEAK alpha rather than by re-deriving every pair,
   * because the peak is the single number that decides the worst case and a
   * future change to it is the way this comes back.
   */
  it('keeps the peak alpha low enough that no measured pair drops below AA', () => {
    const tokens = readFileSync('src/relay/relay-tokens.css', 'utf8');
    const sheen = /--sheen:\s*linear-gradient\(([\s\S]*?)\);/.exec(tokens);
    expect(sheen, '--sheen is not declared as a linear-gradient').not.toBeNull();
    const alphas = [...(sheen as RegExpExecArray)[1].matchAll(/rgba\(\s*255,\s*255,\s*255,\s*([0-9.]+)\s*\)/g)]
      .map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThan(0);
    /**
     * 0.020 is the measured ceiling: above it the obsidian and midnight faint
     * tiers on `panel-2` fall under 4.5:1. Raising it means re-deriving the
     * ladder, not editing this number.
     */
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.02);
  });
});

/**
 * `@supports` ADDS NO SPECIFICITY, AND THAT IS A TRAP WITH A HISTORY.
 *
 * `@supports` is a CONDITIONAL GROUP RULE — a container, not a compound
 * selector — so `@supports (...) { .x { background: A } }` and a plain
 * `.x { background: B }` are BOTH specificity (0,1,0). Source order decides,
 * and the flat rule usually comes later because the enhancement gets written
 * first and the base rule grows afterwards.
 *
 * The failure is quiet in the worst way: `background` is overridden and
 * `backdrop-filter` is NOT, because the flat rule never mentions it. The
 * element keeps a blur compositing layer and loses the translucency the blur
 * existed to pair with — it pays the whole cost of glass and renders none of
 * it. Nothing errors, nothing looks obviously broken, and it survived review
 * once here already: `.rpv-devchip` and `.rpv-notice` in `relay-preview.css`
 * were both dead this way while `.rpv-switcher`, declared above the block,
 * worked — so a spot-check of "does the glass work" could pass on the one
 * subject that happened to be ordered correctly.
 *
 * Scanned across EVERY Relay stylesheet rather than asserted on the three
 * selectors that were wrong, because the mistake is a property of how
 * `@supports` is specified and will recur wherever the next one is written.
 */
describe('an @supports enhancement cannot be silently outranked by a later flat rule', () => {
  /** Declarations inside a block, as [property, value]. Shorthand-blind on
   *  purpose: an exact property match is the sound, no-false-positive check. */
  const declarationsIn = (body: string): string[] =>
    [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);

  /** Selectors of a rule head, split and trimmed. */
  const selectorsIn = (head: string): string[] =>
    head.split(',').map((s) => s.trim()).filter((s) => s !== '');

  it('declares every @supports property below the flat rules for the same selector', () => {
    const losses: string[] = [];

    for (const sheet of SHEETS) {
      /**
       * COMMENTS ARE STRIPPED FIRST, and this is not cosmetic. A selector head
       * is matched as "the run of text before `{`", so a comment sitting above
       * a rule becomes part of the captured selector and the exact-string
       * comparison below stops matching. The first version of this scanner did
       * not strip, and caught `.rpv-notice` while missing `.rpv-devchip` —
       * which is preceded by a comment — in a mutation where BOTH were broken.
       * A scanner that finds half its subjects reads exactly like one that
       * works.
       */
      const css = sheet.css.replace(/\/\*[\s\S]*?\*\//g, '');
      // Find each @supports block and its balanced extent.
      for (const opener of [...css.matchAll(/@supports[^{]*\{/g)]) {
        const bodyStart = (opener.index as number) + opener[0].length;
        let depth = 1;
        let i = bodyStart;
        while (i < css.length && depth > 0) {
          if (css[i] === '{') depth += 1;
          else if (css[i] === '}') depth -= 1;
          i += 1;
        }
        const body = css.slice(bodyStart, i - 1);
        const after = css.slice(i);

        // What the enhancement claims, per selector.
        const claims = new Map<string, Set<string>>();
        for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          for (const selector of selectorsIn(rule[1])) {
            const set = claims.get(selector) ?? new Set<string>();
            for (const property of declarationsIn(rule[2])) set.add(property);
            claims.set(selector, set);
          }
        }

        // Anything AFTER the block, at the top level, re-declaring the same
        // property for the SAME selector string. Same string ⇒ same
        // specificity, so later wins outright — no specificity maths needed,
        // and no false positive from a more-specific selector legitimately
        // overriding.
        for (const rule of after.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
          for (const selector of selectorsIn(rule[1])) {
            const claimed = claims.get(selector);
            if (claimed === undefined) continue;
            for (const property of declarationsIn(rule[2])) {
              if (claimed.has(property)) {
                losses.push(`${sheet.name}: "${selector}" re-declares "${property}" after the @supports that sets it`);
              }
            }
          }
        }
      }
    }

    expect(losses, losses.join('\n')).toEqual([]);
  });
});

/**
 * A RETINA PASS THAT A COLOURWAY OUTRANKS IS A RETINA PASS THAT DOES NOTHING.
 *
 * `@media` adds no specificity — the same property `@supports` has, and the
 * same trap. A retina block written as `.reh-grid-bg` is (0,1,0); Relay's
 * colourway overrides are `[data-relay-colorway='x'] .reh-grid-bg`, which is
 * (0,2,0). The override wins at every resolution, so the sharpening was dead
 * on midnight and manual — while working on obsidian, the default, which is
 * where it would be checked.
 *
 * The fix was to stop competing: `--grid-stop` resolves on `:root` and every
 * grid rule inherits it, colourway overrides included. This guard holds that
 * shape — hairline widths come from the token, and no rule re-litigates them
 * inside a resolution query where specificity decides the winner.
 */
describe('HD sharpening cannot be outranked by a colourway', () => {
  const GRID = /\.(reh|rpw|rps)-grid-bg\b/;

  /** Every `name(...)` span, parenthesis-balanced so nested `rgba(...)` and
   *  `var(...)` do not truncate it. */
  const balancedCalls = (text: string, name: string): string[] => {
    const out: string[] = [];
    let from = 0;
    for (;;) {
      const start = text.indexOf(`${name}(`, from);
      if (start === -1) return out;
      let depth = 0;
      let i = start + name.length;
      for (; i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') { depth -= 1; if (depth === 0) { i += 1; break; } }
      }
      out.push(text.slice(start, i));
      from = i;
    }
  };

  it('declares every grid hairline through the --grid-stop token', () => {
    const raw: string[] = [];
    for (const sheet of SHEETS) {
      const css = sheet.css.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const rule of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
        if (!GRID.test(rule[1])) continue;
        /**
         * A bare `1px` stop inside a linear-gradient is the un-tokenised form.
         * Extracted with a BALANCED scan, not `linear-gradient\([^;]*?\)` —
         * that stops at the first `)`, which belongs to the `rgba(...)` colour,
         * so the span it returns ends BEFORE the stop width it is looking for.
         * Written that way this test passed against a hard-coded hairline.
         */
        for (const gradient of balancedCalls(rule[2], 'linear-gradient')) {
          if (/\b1px\b/.test(gradient) && !gradient.includes('--grid-stop')) {
            raw.push(`${sheet.name}: "${rule[1].trim()}" hard-codes a 1px hairline`);
          }
        }
      }
    }
    expect(raw, raw.join('\n')).toEqual([]);
  });

  it('resolves --grid-stop at :root, where no colourway selector can outrank it', () => {
    const tokens = read('relay-tokens.css');
    expect(tokens).toMatch(/--grid-stop:\s*1px/);
    const retina = /@media \(min-resolution: 2dppx\) \{\s*:root \{\s*--grid-stop:\s*0\.5px/;
    expect(tokens, '--grid-stop must be re-resolved on :root at 2dppx').toMatch(retina);
  });

  it('leaves no resolution query redeclaring a grid background', () => {
    /**
     * The regression this closes: reintroducing a per-rule retina block would
     * pass the two tests above (the token would still exist) and still lose to
     * a colourway override for whatever it redeclared.
     */
    const offenders: string[] = [];
    for (const sheet of SHEETS) {
      const css = sheet.css.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const opener of css.matchAll(/@media[^{]*min-resolution[^{]*\{/g)) {
        const start = (opener.index as number) + opener[0].length;
        let depth = 1;
        let i = start;
        while (i < css.length && depth > 0) {
          if (css[i] === '{') depth += 1;
          else if (css[i] === '}') depth -= 1;
          i += 1;
        }
        const body = css.slice(start, i - 1);
        for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          if (GRID.test(rule[1])) {
            offenders.push(`${sheet.name}: "${rule[1].trim()}" is restyled inside a resolution query`);
          }
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

/**
 * A PANEL BACKGROUND MUST NOT FALL BACK TO NOTHING.
 *
 * `background: var(--sheen), var(--surface, transparent)` fails INVISIBLY: if
 * the token is renamed or dropped, the rule still parses, the sheen still
 * paints, and the panel becomes a faint gradient over whatever is behind it —
 * with its text still styled for an opaque ground. `.rsbp` shipped that way as
 * the only consumer of `--surface`.
 *
 * A missing background token should be conspicuous, not quietly survivable.
 */
describe('a background token never falls back to transparent', () => {
  /** Split a CSS value on commas that are NOT inside parentheses. */
  const topLevelLayers = (value: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of value) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
      current += ch;
    }
    out.push(current);
    return out;
  };

  it('has no background declaration whose var() fallback is transparent', () => {
    const bad: string[] = [];
    for (const sheet of SHEETS) {
      const css = sheet.css.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const declaration of css.matchAll(/background(?:-color|-image)?\s*:\s*([^;}]+)/g)) {
        /**
         * Only TOP-LEVEL layers. `radial-gradient(circle, var(--glow,
         * transparent), transparent 70%)` is correct — a missing glow SHOULD
         * resolve to no glow. The defect is a whole background layer that can
         * vanish, leaving text styled for a ground that is not painted, so the
         * value is split on top-level commas and each layer checked alone.
         */
        for (const layer of topLevelLayers(declaration[1])) {
          if (/^var\(\s*--[\w-]+\s*,\s*transparent\s*\)$/.test(layer.trim())) {
            bad.push(`${sheet.name}: ${declaration[0].trim().slice(0, 90)}`);
          }
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
