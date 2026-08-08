import { describe, expect, it } from 'vitest';

import { renderStageView } from './stage';
import { layoutStage, stageShapeFor, stageCapacity } from '../../shared/relay-stage-layout';
import type { CliCaps } from './contracts';
import type { RelayStageActor } from '../../shared/relay-stage-layout';

/**
 * THE CLI'S STAGE SURFACE.
 *
 * This surface exists so the parity registry is not asserting that the CLI has
 * an equivalent of the backdrop picker while the CLI has nothing. What is
 * tested here is the property that makes the claim real: BOTH SURFACES READ THE
 * SAME PROJECTION, so they cannot disagree about capacity, about who is on the
 * stage, or about which scene is selected.
 */

const caps: CliCaps = {
  tty: false, color: false, unicode: false, width: 80,
  reducedMotion: false, plain: true, json: false,
};

const DOG: RelayStageActor = {
  id: 'relay-dog', x: 0.5, depth: 1, width: 1, track: 6, layer: 'actors',
};

const view = (over: Partial<Parameters<typeof renderStageView>[0]> = {}) =>
  renderStageView({ caps, actors: [DOG], ...over });

describe('the CLI answers the stage’s questions from the stage’s own projection', () => {
  it('reports the capacity the projection reports, not a number of its own', () => {
    const { json } = view() as { json: { capacity: number; requestedWidth: number } };
    const expected = layoutStage({ actors: [DOG], viewportWidthPx: 1440 });
    expect(json.capacity).toBe(expected.capacity);
    expect(json.capacity).toBe(stageCapacity(stageShapeFor(1440)));
    expect(json.requestedWidth).toBe(expected.requestedWidth);
  });

  it('names who is on the stage rather than describing a drawing', () => {
    const { lines, json } = view() as { lines: string[]; json: { placements: { id: string }[] } };
    expect(json.placements.map((p) => p.id)).toEqual(['relay-dog']);
    expect(lines.join('\n')).toContain('relay-dog');
  });

  it('an empty cast says WHY, and invents nobody', () => {
    const { lines, json } = view({ actors: [] }) as {
      lines: string[]; json: { emptyReason: string | null; placements: unknown[] };
    };
    expect(json.placements).toEqual([]);
    expect(json.emptyReason).not.toBeNull();
    expect(lines.join('\n')).toContain(json.emptyReason as string);
    expect(lines.join('\n')).not.toContain('relay-dog');
  });

  it('reports an overflowing cast instead of pretending it fits', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...DOG, id: `leopard-${i}`, width: 2 }));
    const { lines, json } = view({ actors: many }) as {
      lines: string[]; json: { overflowing: boolean };
    };
    expect(json.overflowing).toBe(true);
    expect(lines.join('\n')).toContain('overlapping');
  });
});

describe('the CLI offers the same scenes, and refuses the same substitution', () => {
  it('lists every scene in the catalog, including None', () => {
    const { lines, json } = view() as { lines: string[]; json: { catalog: string[] } };
    expect(json.catalog).toEqual(['none', 'jungle', 'space_station']);
    const text = lines.join('\n');
    expect(text).toContain('Jungle');
    expect(text).toContain('Space Station');
  });

  it('an unknown stored preference draws no scene and SAYS so', () => {
    // The website resolves this to `none`; so does the CLI, from the same
    // function. Neither substitutes the first scene in the catalog.
    const { lines, json } = view({ selectedBackdrop: 'savannah' }) as {
      lines: string[]; json: { backdrop: string };
    };
    expect(json.backdrop).toBe('none');
    expect(lines.join('\n')).toContain('not a scene this build has');
  });

  it('says Unknown when it cannot read the preference, rather than None', () => {
    // The website stores the backdrop per BROWSER and this surface has no
    // reader for it. Printing `None` asserted the founder had no scene
    // selected, when the true statement is that the CLI cannot see one — so a
    // founder who picked Jungle on the website was told None here.
    const { lines } = view() as { lines: string[] };
    const text = lines.join('\n');
    expect(text).toContain('Unknown');
    expect(text).toContain('cannot read it');
  });

  it('sanitizes a stored id before printing it to a terminal', () => {
    // The stored value became genuinely user-controlled the moment the website
    // began persisting it, and a terminal is an ANSI sink.
    const { lines } = view({ selectedBackdrop: '[31mred' }) as { lines: string[] };
    const text = lines.join('\n');
    expect(text).toContain('not a scene this build has');
    expect(text).not.toContain('[31m');
  });

  it('a known preference is reported as selected', () => {
    const { json } = view({ selectedBackdrop: 'space_station' }) as {
      json: { backdrop: string; backdropChoices: { id: string; selected: boolean }[] };
    };
    expect(json.backdrop).toBe('space_station');
    expect(json.backdropChoices.filter((c) => c.selected).map((c) => c.id))
      .toEqual(['space_station']);
  });

  it('mentions reduced motion only when that user’s setting is on', () => {
    const off = view({ selectedBackdrop: 'jungle', reducedMotion: false }) as { lines: string[] };
    expect(off.lines.join('\n')).toContain('This scene moves.');
    expect(off.lines.join('\n')).not.toContain('reduced-motion setting stills it');

    const on = view({ selectedBackdrop: 'jungle', reducedMotion: true }) as { lines: string[] };
    expect(on.lines.join('\n')).toContain('reduced-motion setting stills it');
  });

  it('says a backdrop carries no product meaning', () => {
    expect(view().lines.join('\n')).toContain('gates nothing');
  });
});
