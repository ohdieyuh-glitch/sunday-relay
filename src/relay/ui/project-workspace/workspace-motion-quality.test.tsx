/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MOTION QUALITY, HELD STRUCTURALLY.
 *
 * The direction asks for premium, controlled motion that respects reduced
 * motion and does not slow the workspace with GPU-heavy effects. Two of those
 * three are checkable in the stylesheet, and checking them there is the only
 * way they stay true: a new keyframe is one line, and nothing about writing it
 * reminds you that someone reading this page may have asked the operating
 * system to stop things moving.
 *
 * WHAT THESE DO NOT CLAIM. Nobody has measured a frame here. "Premium" is a
 * judgement and no test can hold it. What is held is narrower and real: every
 * animation this workspace and its objects introduce can be switched off, and
 * the expensive per-frame effects are absent by construction.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', 'relay', ...parts), 'utf8');

const WORKSPACE_CSS = read('ui', 'project-workspace', 'relay-project-workspace.css');
const DOG_CSS = read('ui', 'pixel-dog', 'pixel-dog.css');

/** Every `animation:` declaration with the selector that carries it. */
function animationDeclarations(css: string): { selector: string; name: string }[] {
  const out: { selector: string; name: string }[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const nameMatch = /animation:\s*([a-z0-9-]+)/i.exec(match[2]);
    if (nameMatch === null) continue;
    // `animation: none` is the OFF switch, not an animation, and an at-rule's
    // own header is not a selector.
    if (nameMatch[1] === 'none' || match[1].trimStart().startsWith('@')) continue;
    const selector = match[1].split('\n').filter((l) => !l.trim().startsWith('/*')).join(' ');
    out.push({ selector, name: nameMatch[1] });
  }
  return out;
}

/** The text inside every reduced-motion block of a stylesheet. */
function reducedMotionBlocks(css: string): string {
  let out = '';
  const marker = '@media (prefers-reduced-motion: reduce)';
  let from = css.indexOf(marker);
  while (from !== -1) {
    // Walk braces from the media query's opening brace to its match.
    const open = css.indexOf('{', from);
    let depth = 0;
    let i = open;
    for (; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out += css.slice(open, i);
    from = css.indexOf(marker, i);
  }
  return out;
}

describe('everything that moves can be stopped', () => {
  it('the Relay Dog stops breathing and walking under reduced motion', () => {
    const reduced = reducedMotionBlocks(DOG_CSS);
    expect(reduced.length).toBeGreaterThan(0);
    // The parts carry the breathing and the gait; switching them off at the
    // part level is what covers every keyframe at once.
    expect(reduced).toContain('.rpd .rpd-part');
    expect(reduced).toContain('animation: none');
  });

  it('the Project Brain stops rotating and pulsing under reduced motion', () => {
    // The orb's motion is gated on a class the component only adds when it was
    // told motion is allowed — a stronger guarantee than a media query, since
    // it also covers a host that passes `reducedMotion` for its own reasons.
    for (const animated of ['rpb-rotate', 'rpb-signal', 'rpb-node-pulse', 'rpb-halo-breathe']) {
      const rule = WORKSPACE_CSS.slice(0, WORKSPACE_CSS.indexOf(`animation: ${animated}`));
      const selector = rule.slice(rule.lastIndexOf('\n', rule.lastIndexOf('{')) + 1);
      expect(selector, `${animated} runs without the live gate`).toContain('rpb-orb--live');
    }
  });

  it('names no keyframe the workspace cannot switch off', () => {
    // Every `animation:` in the workspace stylesheet must either sit behind a
    // gate the component controls (`--live`, `--moving`) or have its selector
    // named inside a reduced-motion block. A new keyframe that is neither
    // fails here rather than being discovered by someone it makes ill.
    const reduced = reducedMotionBlocks(WORKSPACE_CSS);
    const declarations = animationDeclarations(WORKSPACE_CSS);
    expect(declarations.length).toBeGreaterThan(0);
    for (const { selector, name } of declarations) {
      const gatedByClass = /--live\b|--moving\b/.test(selector);
      const stoppedByMedia = reduced.includes(selector.trim());
      expect(gatedByClass || stoppedByMedia, `${name} (${selector.trim()}) cannot be stopped`)
        .toBe(true);
    }
  });
});

describe('the column is lit from one place', () => {
  it('the threads and the Brain read the same accent variable', () => {
    // Brain → Dog → Mission. If a thread hardcoded its colour, choosing a tier
    // would light some of the column and not the rest, and the connection
    // would stop reading as one system.
    for (const selector of ['.rpw-brainstage-link', '.rpw-stagelink']) {
      const at = WORKSPACE_CSS.indexOf(selector);
      expect(at, `${selector} is missing`).toBeGreaterThan(-1);
      const rule = WORKSPACE_CSS.slice(at, WORKSPACE_CSS.indexOf('}', at));
      expect(rule, `${selector} hardcodes its colour`).not.toMatch(/#[0-9a-f]{3,6}|rgba?\(/i);
      expect(rule).toContain('var(--rpb-');
    }
  });

  it('declares the shared accent on the column, not on one object inside it', () => {
    const at = WORKSPACE_CSS.lastIndexOf('.rpw-main {');
    const rule = WORKSPACE_CSS.slice(at, WORKSPACE_CSS.indexOf('}', at));
    expect(rule).toContain('--rpb-accent');
    expect(rule).toContain('--rpb-glow');
  });
});

describe('nothing expensive runs per frame', () => {
  it('puts no filter on the animated sprite', () => {
    // A drop-shadow on `.rpd-art` re-rasterizes the whole sprite on every
    // frame of the breathing and the gait, and looks identical to the layer
    // behind it that composites once.
    const at = DOG_CSS.indexOf('.rpd--tier .rpd-art');
    if (at !== -1) {
      const rule = DOG_CSS.slice(at, DOG_CSS.indexOf('}', at));
      expect(rule, 'the tier filters the animated art').not.toContain('filter:');
    }
    expect(DOG_CSS).not.toMatch(/\.rpd-art\s*\{[^}]*filter:/);
  });

  it('animates transform and opacity, not layout', () => {
    // Animating width/height/top/left forces layout on every frame. The dog's
    // motion is transforms; the Brain's is transform and opacity.
    for (const css of [DOG_CSS, WORKSPACE_CSS]) {
      const keyframes = [...css.matchAll(/@keyframes\s+[a-z0-9-]+\s*\{([\s\S]*?)\n\}/gi)]
        .map((m) => m[1]);
      for (const body of keyframes) {
        expect(body).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding)\s*:/);
      }
    }
  });
});
