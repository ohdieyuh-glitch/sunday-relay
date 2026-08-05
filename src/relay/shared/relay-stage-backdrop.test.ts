import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  RELAY_BACKDROPS, RELAY_BACKDROP_IDS, isKnownBackdrop, projectBackdropChoices,
  resolveBackdrop,
} from './relay-stage-backdrop';

/**
 * THE BACKDROP CATALOG.
 *
 * A backdrop is scenery: it carries no product meaning, gates nothing, and
 * cannot change what any surface reports. What is asserted here is the one
 * thing a catalog can get wrong in a way that matters — resolving an id it does
 * not have into a scene the user did not choose.
 */

describe('an unknown backdrop resolves to NONE, never to a substitute', () => {
  it('resolves every id it declares', () => {
    for (const id of RELAY_BACKDROP_IDS) {
      expect(resolveBackdrop(id).id, id).toBe(id);
    }
  });

  it('an id from an older build resolves to none, not to the first scene', () => {
    // Substituting a different scene would be the surface deciding something
    // the user did not. `jungle` is first in the catalog, so a naive fallback
    // would land there — which is exactly the bug this asserts against.
    for (const unknown of ['savannah', 'JUNGLE', '', 'none ', null, undefined, 7, {}]) {
      expect(resolveBackdrop(unknown).id, JSON.stringify(unknown)).toBe('none');
    }
  });

  it('knows what it knows', () => {
    expect(isKnownBackdrop('jungle')).toBe(true);
    expect(isKnownBackdrop('space_station')).toBe(true);
    expect(isKnownBackdrop('savannah')).toBe(false);
    expect(isKnownBackdrop(null)).toBe(false);
  });

  it('offers exactly the two scenes that were asked for, plus none', () => {
    expect([...RELAY_BACKDROP_IDS]).toEqual(['none', 'jungle', 'space_station']);
  });
});

describe('a picker can be honest about what reduced motion changes', () => {
  it('marks exactly one choice selected', () => {
    const choices = projectBackdropChoices({ selected: 'space_station', reducedMotion: false });
    expect(choices.filter((c) => c.selected).map((c) => c.id)).toEqual(['space_station']);
  });

  it('an unknown selection selects none, and says so in the projection too', () => {
    const choices = projectBackdropChoices({ selected: 'savannah', reducedMotion: false });
    expect(choices.filter((c) => c.selected).map((c) => c.id)).toEqual(['none']);
  });

  it('only ANIMATED scenes are affected by reduced motion', () => {
    // Saying "reduced motion changes this" about a still scene would be as
    // untrue as saying nothing changes at all.
    const on = projectBackdropChoices({ selected: 'none', reducedMotion: true });
    for (const choice of on) {
      expect(choice.changesWithReducedMotion, choice.id).toBe(choice.animated);
    }
    const off = projectBackdropChoices({ selected: 'none', reducedMotion: false });
    for (const choice of off) {
      expect(choice.changesWithReducedMotion, choice.id).toBe(false);
    }
  });

  it('every scene describes what it IS', () => {
    for (const entry of RELAY_BACKDROPS) {
      expect(entry.description.length, entry.id).toBeGreaterThan(20);
      expect(entry.label.length, entry.id).toBeGreaterThan(0);
    }
  });
});

describe('no scene reaches the network', () => {
  const read = (name: string) => readFileSync(join(__dirname, '..', 'ui', 'relay-stage', name), 'utf8');

  it('the backdrop stylesheet loads no external asset', () => {
    // An image URL is a request, a licence question, and a thing that can 404
    // into a blank stage. Every scene is geometry and gradient.
    const css = read('relay-stage-backdrop.css');
    expect(css).not.toMatch(/url\(/);
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/https?:/);
  });

  it('the backdrop component embeds no image and no remote reference', () => {
    const tsx = read('RelayStageBackdrop.tsx');
    expect(tsx).not.toMatch(/<img\b/);
    expect(tsx).not.toMatch(/https?:\/\//);
    expect(tsx).not.toMatch(/url\(/);
  });

  it('both scenes still their motion under reduced motion, and only the motion', () => {
    const css = read('relay-stage-backdrop.css');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('.rsb--still');
    // The stilled selectors are ANIMATIONS, not layout. Sliced to the END OF
    // THE BLOCK: running to EOF asserted a "no layout change" property over
    // the whole rest of the stylesheet, including the unrelated picker, which
    // is a test that passes because it is looking somewhere else.
    // Comments stripped first: the header comment NAMES `.rsb--still` while
    // explaining it, and slicing from that mention reads the wrong block.
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const start = declarations.indexOf('.rsb--still');
    const stillBlock = declarations.slice(start, declarations.indexOf('}', start) + 1);
    expect(stillBlock).toContain('animation: none');
    for (const layoutProperty of [/display:/, /position:/, /visibility:/, /width:/, /height:/]) {
      expect(stillBlock, String(layoutProperty)).not.toMatch(layoutProperty);
    }
  });
});
