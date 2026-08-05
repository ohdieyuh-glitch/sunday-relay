/** @vitest-environment jsdom */
import { afterEach, describe, expect, it as baseIt } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { RelayStage } from './RelayStage';
import { RELAY_STAGE_LAYERS, type RelayStageActor } from '../../shared/relay-stage-layout';

/**
 * THE STAGE, RENDERED.
 *
 * `stage-layout.test.ts` proves the projection. This proves the surface that
 * consumes it — a different claim, and the one the MCP milestone's reachability
 * check exists to keep honest.
 *
 * The band this replaces was `width: 100%` with its scenery clipped to a fixed
 * `128px × 90px` box. What follows asserts the three things that makes it stop
 * being a rectangle: it has no frame, only its backdrop clips, and it says what
 * it cannot hold instead of drawing an overlap.
 */

const it = (name: string, fn: () => void | Promise<void>) => baseIt(name, fn, 120000);
afterEach(cleanup);

const DOG: RelayStageActor = { id: 'relay-dog', x: 0.5, depth: 1, width: 1, layer: 'actors' };
const LEOPARD: RelayStageActor = { id: 'leopard', x: 0.3, depth: 0.8, width: 2, layer: 'actors' };
const CUB: RelayStageActor = { id: 'cub', x: 0.7, depth: 0.6, width: 0.6, layer: 'actors' };

const stage = (props: Partial<Parameters<typeof RelayStage>[0]> = {}) => render(
  createElement(RelayStage, {
    actors: [DOG],
    render: (id: string) => createElement('div', { 'data-testid': id }, id),
    viewportWidthPx: 1440,
    ...props,
  }),
);

const el = () => document.querySelector('.rst') as HTMLElement;

/* --------------------------------------------------------------- frame */

describe('the stage is frameless', () => {
  it('declares no border, background, radius or shadow on the stage element', () => {
    // Frameless is the requirement, so it is asserted against the STYLESHEET
    // rather than against a computed style jsdom does not compute.
    const css = readStageCss();
    const block = css.slice(css.indexOf('.rst {'), css.indexOf('.rst-layer {'));
    // Matched as PROPERTIES rather than as the four exact strings: `border:`
    // does not catch `border-top:`, and `background:` does not catch
    // `background-color:` or `background-image:`. The stylesheet is frameless
    // either way — this is about whether the guard would catch it becoming
    // framed, which is the only reason the guard exists.
    const framingProperties = /(^|[;{]\s*)(border(-[a-z]+)*|background(-[a-z]+)*|box-shadow|outline(-[a-z]+)*)\s*:/;
    const declarations = block.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations, 'the stage must declare no framing property').not.toMatch(framingProperties);
  });

  it('sizes itself by ASPECT with a floor, never a fixed height', () => {
    stage();
    const style = el().getAttribute('style') ?? '';
    expect(style).toContain('aspect-ratio');
    expect(style).toContain('min-height');
    expect(style).not.toMatch(/(?:^|;)\s*height:/);
  });

  it('a narrow viewport gets a taller stage rather than a squeezed one', () => {
    stage({ viewportWidthPx: 390 });
    const narrow = Number((el().getAttribute('style') ?? '').match(/aspect-ratio:\s*([\d.]+)/)?.[1]);
    cleanup();
    stage({ viewportWidthPx: 1440 });
    const wide = Number((el().getAttribute('style') ?? '').match(/aspect-ratio:\s*([\d.]+)/)?.[1]);
    expect(narrow).toBeLessThan(wide);
  });
});

/* -------------------------------------------------------------- layers */

describe('only the backdrop clips', () => {
  it('renders every layer, and marks exactly one as clipped', () => {
    stage();
    const clipped: string[] = [];
    for (const layer of RELAY_STAGE_LAYERS) {
      const node = document.querySelector(`[data-stage-layer="${layer}"]`);
      expect(node, layer).not.toBeNull();
      if (node?.classList.contains('is-clipped')) clipped.push(layer);
    }
    expect(clipped).toEqual(['backdrop']);
  });

  it('a backdrop is rendered only when one is supplied', () => {
    stage();
    expect(document.querySelector('[data-stage-layer="backdrop"]')?.children.length).toBe(0);
    cleanup();
    stage({ backdrop: createElement('div', { 'data-testid': 'jungle' }) });
    expect(screen.getByTestId('jungle')).toBeTruthy();
  });

  it('scenery and effects never swallow a pointer meant for a control', () => {
    const css = readStageCss();
    expect(css).toContain('.rst-layer {');
    expect(css.slice(css.indexOf('.rst-layer {'))).toContain('pointer-events: none');
    expect(css).toContain('.rst-layer--actors { pointer-events: auto; }');
  });
});

/* -------------------------------------------------------------- actors */

describe('a mixed cast is placed, not positioned', () => {
  it('renders the Dog, a wider Leopard and a cub together', () => {
    stage({ actors: [DOG, LEOPARD, CUB] });
    for (const id of ['relay-dog', 'leopard', 'cub']) {
      expect(screen.getByTestId(id), id).toBeTruthy();
    }
  });

  it('gives each actor a percentage position, so nothing is in fixed pixels', () => {
    stage({ actors: [DOG, LEOPARD] });
    for (const id of ['relay-dog', 'leopard']) {
      const style = document.querySelector(`[data-stage-actor="${id}"]`)?.getAttribute('style') ?? '';
      expect(style, id).toMatch(/left:\s*[\d.]+%/);
      expect(style, id).toMatch(/bottom:\s*[\d.]+%/);
      expect(style, id).toMatch(/scale\([\d.]+\)/);
    }
  });

  it('an actor with no rendered node leaves an empty slot, not an invented one', () => {
    render(createElement(RelayStage, {
      actors: [DOG],
      render: () => null,
      viewportWidthPx: 1440,
    }));
    const slot = document.querySelector('[data-stage-actor="relay-dog"]');
    expect(slot).not.toBeNull();
    expect(slot?.textContent).toBe('');
  });
});

/* ------------------------------------------------------ truthful states */

describe('the stage says what it cannot do', () => {
  it('an empty stage says so, and draws nobody', () => {
    stage({ actors: [], emptyReason: 'No mission is running.' });
    expect(screen.getByRole('status').textContent).toContain('No mission is running');
    expect(document.querySelector('[data-stage-actor]')).toBeNull();
  });

  it('an overflowing cast is REPORTED, not silently overlapped', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...LEOPARD, id: `leopard-${i}` }));
    stage({ actors: many });
    expect(el().getAttribute('data-stage-overflowing')).toBe('yes');
    expect(document.querySelector('.rst-overflow')?.textContent).toContain('overlapping');
  });

  it('a cast that fits reports no overflow', () => {
    stage({ actors: [DOG, CUB] });
    expect(el().getAttribute('data-stage-overflowing')).toBe('no');
    expect(document.querySelector('.rst-overflow')).toBeNull();
  });

  it('reduced motion changes the MOTION, never the layout', () => {
    stage({ actors: [DOG, LEOPARD] });
    const before = [...document.querySelectorAll('[data-stage-actor]')]
      .map((n) => n.getAttribute('style'));
    cleanup();
    stage({ actors: [DOG, LEOPARD], reducedMotion: true });
    const after = [...document.querySelectorAll('[data-stage-actor]')]
      .map((n) => n.getAttribute('style'));
    expect(after).toEqual(before);
    expect(el().classList.contains('rst--still')).toBe(true);
  });
});

function readStageCss(): string {
  // Read once, lazily, so the import graph stays free of node builtins for
  // every test that does not need them.
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(__dirname, 'relay-stage.css'), 'utf8');
}
