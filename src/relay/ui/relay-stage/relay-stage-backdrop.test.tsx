/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';

import { RelayStage } from './RelayStage';
import { RelayStageBackdrop } from './RelayStageBackdrop';
import type { RelayStageActor } from './stage-layout';

/**
 * THE TWO SCENES, RENDERED.
 *
 * `stage-backdrop.test.ts` proves the catalog resolves. This proves the thing a
 * user actually sees — including the one property the Space Station exists for:
 * that the window shows OUTER SPACE rather than a painted wall.
 */

afterEach(cleanup);

const DOG: RelayStageActor = { id: 'relay-dog', x: 0.5, depth: 1, width: 1, layer: 'actors' };

describe('a backdrop is decoration and says so', () => {
  it('renders nothing at all for none, and for an id this build lacks', () => {
    for (const id of ['none', 'savannah', '', null, undefined]) {
      cleanup();
      render(createElement(RelayStageBackdrop, { backdrop: id as string }));
      expect(document.querySelector('[data-backdrop]'), String(id)).toBeNull();
    }
  });

  it('is hidden from assistive technology and takes no pointer events', () => {
    for (const id of ['jungle', 'space_station']) {
      cleanup();
      render(createElement(RelayStageBackdrop, { backdrop: id }));
      const node = document.querySelector('[data-backdrop]');
      expect(node?.getAttribute('aria-hidden'), id).toBe('true');
    }
    // Asserted in the stylesheet, since jsdom computes no cascade.
    const css = readCss('relay-stage-backdrop.css');
    expect(css.slice(css.indexOf('.rsb {'))).toContain('pointer-events: none');
  });
});

describe('the Jungle', () => {
  it('draws canopy, undergrowth and a light shaft', () => {
    render(createElement(RelayStageBackdrop, { backdrop: 'jungle' }));
    expect(document.querySelectorAll('.rsb-canopy').length).toBe(3);
    expect(document.querySelector('.rsb-undergrowth')).not.toBeNull();
    expect(document.querySelector('.rsb-shaft')).not.toBeNull();
  });

  it('reads depth through three separate canopy layers', () => {
    // Depth by colour and height rather than blur, so the silhouette stays
    // crisp beside a pixel-art actor.
    render(createElement(RelayStageBackdrop, { backdrop: 'jungle' }));
    for (const depth of ['far', 'mid', 'near']) {
      expect(document.querySelector(`.rsb-canopy--${depth}`), depth).not.toBeNull();
    }
  });
});

describe('the Space Station shows VISIBLE OUTER SPACE', () => {
  it('has a void with stars and a planet, not a painted wall', () => {
    render(createElement(RelayStageBackdrop, { backdrop: 'space_station' }));
    expect(document.querySelector('.rsb-void'), 'the window onto space').not.toBeNull();
    expect(document.querySelectorAll('.rsb-stars').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('.rsb-planet'), 'a planet limb').not.toBeNull();
  });

  it('the planet has a terminator, so the light has a direction', () => {
    // A flat disc would be a sticker. The lit edge and the shadow are one
    // gradient, which is what makes the sphere read as a sphere.
    const css = readCss('relay-stage-backdrop.css');
    const planet = css.slice(css.indexOf('.rsb--space_station .rsb-planet {'));
    expect(planet).toContain('radial-gradient(circle at');
    expect(planet).toContain('border-radius: 50%');
  });

  it('the interior is in FRONT of the void, not instead of it', () => {
    render(createElement(RelayStageBackdrop, { backdrop: 'space_station' }));
    const nodes = [...document.querySelectorAll('.rsb--space_station > *')]
      .map((n) => n.className);
    expect(nodes.indexOf('rsb-void')).toBeLessThan(nodes.findIndex((c) => c.includes('rsb-window-frame')));
    expect(document.querySelector('.rsb-deck'), 'a floor to stand on').not.toBeNull();
  });
});

describe('a backdrop lives in the one layer that clips', () => {
  it('the stage puts it in the backdrop layer, and that layer is clipped', () => {
    render(createElement(RelayStage, {
      actors: [DOG],
      render: () => createElement('div', { 'data-testid': 'dog' }),
      viewportWidthPx: 1440,
      backdrop: createElement(RelayStageBackdrop, { backdrop: 'jungle' }),
    }));
    const layer = document.querySelector('[data-stage-layer="backdrop"]');
    expect(layer?.classList.contains('is-clipped')).toBe(true);
    expect(layer?.querySelector('[data-backdrop="jungle"]')).not.toBeNull();
    // And the actors layer, in front of it, is NOT clipped.
    expect(
      document.querySelector('[data-stage-layer="actors"]')?.classList.contains('is-clipped'),
    ).toBe(false);
  });

  it('reduced motion stills the scene without changing it', () => {
    render(createElement(RelayStageBackdrop, { backdrop: 'space_station', reducedMotion: true }));
    const still = document.querySelector('[data-backdrop]')?.className ?? '';
    expect(still).toContain('rsb--still');
    // Same elements, same scene.
    expect(document.querySelector('.rsb-void')).not.toBeNull();
    expect(document.querySelector('.rsb-planet')).not.toBeNull();
  });
});

function readCss(name: string): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(__dirname, name), 'utf8');
}
