import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RelayLanding } from './RelayLanding';
import { sceneAt } from './choreography';

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
});
