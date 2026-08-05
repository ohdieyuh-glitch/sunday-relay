/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';

import { RelayStage } from './RelayStage';
import { RelayWorkspaceDog } from '../project-workspace/RelayWorkspaceDog';
import type { RelayStageActor } from './stage-layout';

/**
 * THE REAL ACTOR ON THE REAL STAGE.
 *
 * Every other stage test renders `<div data-testid="dog" />` as its cast. That
 * proves the stage does not clip A STUB — and a stub has no clip of its own, no
 * `width: 100%` track, and no patrol engine. It is exactly the actor for which
 * the claim is easiest to satisfy.
 *
 * The two properties below were both FALSE of the shipped dog while every
 * stub-based test passed:
 *
 *   - `.rdm`, the dog's own motion boundary, carried `overflow-x: hidden`. In
 *     CSS a `hidden` on one axis forces the other from `visible` to `auto`, so
 *     a rule written to stop horizontal scroll was clipping the dog VERTICALLY.
 *     A jump was cut by the box the stage exists to remove.
 *   - `.rst-actor` is absolutely positioned with no width, so it shrink-to-fits.
 *     `.rdm { width: 100% }` then resolved to the sprite's own width, the patrol
 *     engine measured a track of nearly nothing, and patrol switched itself off
 *     without failing.
 *
 * jsdom computes no cascade and reports `clientWidth === 0`, so neither can be
 * settled by reading a computed style here. Both are asserted where the
 * decision actually lives: the stylesheet and the layout projection.
 */

afterEach(cleanup);

const DOG: RelayStageActor = {
  id: 'relay-dog', x: 0.5, depth: 1, width: 1, track: 6, layer: 'actors',
};

const readCss = (name: string): string => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  // Comments are stripped: these assertions are about DECLARATIONS, and a
  // comment that explains why a clip was removed contains the word `hidden`.
  return readFileSync(join(__dirname, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
};

function mountRealDog() {
  return render(createElement(RelayStage, {
    actors: [DOG],
    viewportWidthPx: 1440,
    render: (id: string) => (id === 'relay-dog'
      ? createElement(RelayWorkspaceDog, { state: 'wandering' as const })
      : null),
  }));
}

describe('the actual Relay Dog stands on the actual stage', () => {
  it('mounts the shipped dog, not a placeholder', () => {
    mountRealDog();
    // The real component brings the real motion boundary with it.
    expect(document.querySelector('.rdm'), 'the dog’s motion boundary').not.toBeNull();
    expect(document.querySelector('[data-stage-actor="relay-dog"]')).not.toBeNull();
  });

  it('nothing between the stage and the dog clips it', () => {
    mountRealDog();
    const stage = document.querySelector('.rst');
    const dog = document.querySelector('.rdm');
    expect(stage).not.toBeNull();
    expect(dog).not.toBeNull();

    // Walk the real ancestor chain. Clipping SELECTORS are collected and each
    // ancestor is tested with `matches`, not by class name: `.rst-layer` alone
    // does not clip — `.rst-layer.is-clipped` does, and only the backdrop layer
    // ever carries that second class.
    const clippingSelectors: string[] = [];
    for (const css of [readCss('relay-stage.css'), readCss('../relay-dog-motion/relay-dog-motion.css')]) {
      for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (!/overflow(-x|-y)?:\s*(hidden|auto|scroll)/.test(match[2])) continue;
        for (const selector of match[1].split(',')) {
          const trimmed = selector.trim();
          if (trimmed.startsWith('.') || trimmed.startsWith('#')) clippingSelectors.push(trimmed);
        }
      }
    }
    expect(clippingSelectors.length, 'the stylesheets do declare clips').toBeGreaterThan(0);

    for (let node = dog; node !== null && node !== stage; node = node.parentElement) {
      for (const selector of clippingSelectors) {
        expect(
          node.matches(selector),
          `${node.className} matches ${selector}, which clips, between stage and dog`,
        ).toBe(false);
      }
    }
  });

  it('the dog’s own motion boundary no longer clips on either axis', () => {
    // `overflow-x: hidden` cannot leave `overflow-y: visible` — the computed
    // value becomes `auto`. This is why the rule had to go rather than be
    // narrowed, and why the page-level containment uses `clip` instead.
    const dogCss = readCss('../relay-dog-motion/relay-dog-motion.css');
    const block = dogCss.slice(dogCss.indexOf('.rdm {'), dogCss.indexOf('.rdm-travel'));
    expect(block).not.toMatch(/overflow(-x|-y)?:\s*(hidden|auto|scroll)/);

    // The containment it replaced still exists, one level up, as `clip`.
    const stageCss = readCss('relay-stage.css');
    const bounds = stageCss.slice(stageCss.indexOf('.rpw-stage-bounds'));
    expect(bounds).toContain('overflow-x: clip');
  });

  it('gives the dog a box wider than its own sprite, so patrol has a track', () => {
    mountRealDog();
    const box = document.querySelector('[data-stage-actor="relay-dog"]') as HTMLElement | null;
    const width = box?.style.width ?? '';
    expect(width).toMatch(/^\d+(\.\d+)?%$/);
    // One dog unit of footprint at a six-wide stage would be ~16.7%. The track
    // is what makes it the whole stage; anything near the footprint means the
    // patrol engine is about to measure nearly nothing.
    expect(Number.parseFloat(width)).toBeGreaterThan(50);
  });
});
