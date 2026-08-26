/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RelayLanding } from './RelayLanding';
import { LANDING_SCENES } from './choreography';
import { parsePreviewHash } from '../preview/RelayPreviewApp';

afterEach(cleanup);

/**
 * jsdom has no WebGL, so every test in this file exercises the landing's
 * NO-CONTEXT path — which is exactly the path that matters most. A landing
 * page whose entire content lives inside a canvas is a blank page on any
 * device that cannot create one, and "it works on my GPU" is not a standard
 * this product accepts.
 */

describe('the landing degrades without WebGL', () => {
  it('renders rather than throwing when no context can be created', () => {
    expect(() => render(createElement(RelayLanding))).not.toThrow();
  });

  it('says so, plainly, instead of showing an empty page', () => {
    render(createElement(RelayLanding));
    expect(screen.getByRole('status').textContent).toMatch(/STATIC MODE/i);
  });

  it('still carries every beat of copy', () => {
    render(createElement(RelayLanding));
    for (const scene of LANDING_SCENES) {
      expect(screen.getAllByText(scene.headline).length).toBeGreaterThan(0);
      expect(screen.getAllByText(scene.body).length).toBeGreaterThan(0);
    }
  });

  it('still offers the call to action, reachable without a render loop', () => {
    // Without WebGL there is no loop, so nothing ever advances past beat one.
    // The CTA lives at beat eight — it has to be reachable anyway.
    render(createElement(RelayLanding));
    const cta = screen.getByRole('link', { name: /ENTER RELAY/i });
    // The CTA leads into the product's canonical entry, which is the
    // C.A.R.D.-first Entry Home — not straight into a workspace.
    expect(cta.getAttribute('href')).toBe('#/relay');
  });

  it('exposes the beats as real landmarks for assistive technology', () => {
    render(createElement(RelayLanding));
    for (const scene of LANDING_SCENES) {
      const section = screen.getByRole('region', { name: scene.eyebrow });
      expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe(scene.headline);
    }
  });
});

describe('asset safety', () => {
  const html = renderToStaticMarkup(createElement(RelayLanding));
  // Comments stripped: a comment EXPLAINING that no `url()` is used contains
  // the word, and an assertion that reads its own explanation tests nothing.
  const css = readFileSync(join(__dirname, 'relay-landing.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('renders no <img> element', () => {
    // A broken-image placeholder on the product's front door is the exact
    // failure `no-broken-assets.test.tsx` exists to make impossible. The
    // landing's mark and Dog are procedural for this reason among others.
    expect(html).not.toMatch(/<img\b/i);
  });

  it('fetches no image from CSS', () => {
    expect(css).not.toMatch(/url\(/);
  });
});

describe('the landing is the front door', () => {
  it('is what the bare URL resolves to', () => {
    expect(parsePreviewHash('')).toEqual({ screen: 'landing' });
    expect(parsePreviewHash('#/')).toEqual({ screen: 'landing' });
    expect(parsePreviewHash('#/landing')).toEqual({ screen: 'landing' });
  });

  it('does not displace the in-product entry', () => {
    // The C.A.R.D.-first flow is canonical founder direction. The landing is
    // added in FRONT of it, never in place of it.
    expect(parsePreviewHash('#/relay')).toEqual({ screen: 'home' });
    expect(parsePreviewHash('#/relay/console')).toEqual({ screen: 'console' });
  });
});

describe('containment', () => {
  const css = readFileSync(join(__dirname, 'relay-landing.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('uses overflow-x: clip on the page root, never hidden', () => {
    // `overflow-x: hidden` computes the OTHER axis to `auto`, silently making
    // the root a scroll container. On this page that would trap the fixed
    // canvas; elsewhere in this product it clipped the Relay Dog three times.
    const block = css.slice(css.indexOf('.rl3 {'), css.indexOf('}', css.indexOf('.rl3 {')));
    expect(block).toMatch(/overflow-x:\s*clip/);
    expect(block).not.toMatch(/overflow(-x|-y)?:\s*(hidden|auto|scroll)/);
  });

  it('casts no shadow anywhere', () => {
    // Both references are explicit: depth comes from translucency and
    // occlusion. A drop-shadow over a rendered scene reads as a sticker.
    expect(css).not.toMatch(/box-shadow\s*:/);
  });

  it('keeps the accent colours out of the chrome', () => {
    // Aquala's blue and Relay's gold belong to the RENDER. The single
    // permitted exception is the CTA's hairline, which the render cannot draw.
    const goldUses = css.match(/--rl3-gold\)/g) ?? [];
    expect(goldUses.length).toBeLessThanOrEqual(2);
    expect(css).not.toMatch(/--rl3-aqua/);
  });
});
