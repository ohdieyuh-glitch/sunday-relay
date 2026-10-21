import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RelayLanding } from './RelayLanding';
import { BRAND_EYEBROW, LANDING_SCENES, sceneAt } from './choreography';

describe('brand casing', () => {
  it('renders i.Wonder with a lowercase i and never uppercases it', () => {
    const html = renderToStaticMarkup(
      createElement(RelayLanding, {
        position: sceneAt(0),
        telemetry: { width: 1440, height: 900, dpr: 1, tier: 'high', fps: 60, webgl: true },
        anchors: [], reducedMotion: false, onEnterRelay: () => undefined, overPortal: false,
      }),
    );
    expect(html).toContain('>i.Wonder<');
    expect(html).not.toContain('i.WONDER');
    expect(html).not.toContain('I.WONDER');
    // every element carrying the brand opts out of the uppercase register
    const brandEls = html.match(/<[^>]*rl3-brandmark[^>]*>i\.Wonder</g) ?? [];
    expect(brandEls.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * THE OPENING COPY, PINNED.
   *
   * `origin/relay/wonderland-v2` — 775 commits of world development — has no
   * `src/relay/ui/landing/` at all. An integration from that line, or a revert
   * reaching for an older Entry Home surface, replaces this opening without
   * anything failing: the product still builds, still renders, and quietly
   * stops being Relay's Wonderland. `RelayWorld.tsx` importing `RelayLanding`
   * means a DELETED landing breaks the typecheck; nothing made a REWRITTEN one
   * break anything.
   *
   * These two strings are the founder's canonical direction, so they are held
   * as strings rather than described.
   */
  it('opens on Relay’s Wonderland, and on the line the founder wrote', () => {
    expect(LANDING_SCENES[0]?.headline, 'the canonical opening line')
      .toBe('Enter the World Where Ideas Become Real.');
    expect(LANDING_SCENES[0]?.eyebrow, 'and the brand is the first thing said').toBe(BRAND_EYEBROW);
    expect(LANDING_SCENES.map((scene) => scene.eyebrow), 'the product names itself in the opening sequence')
      .toContain('RELAY’S WONDERLAND');
  });
});
