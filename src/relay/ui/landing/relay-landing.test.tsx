/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RelayLanding } from './RelayLanding';
import { LANDING_SCENES, sceneAt } from './choreography';
import { parsePreviewHash } from '../preview/RelayPreviewApp';

/**
 * The landing is CHROME now: `RelayWorld` owns the canvas, the renderer and the
 * frame loop for the whole journey, and hands this component its state. These
 * props stand in for that world with no WebGL available — which is also the
 * real production path on a device that cannot create a context.
 */
const chrome = (over: Partial<Parameters<typeof RelayLanding>[0]> = {}) => ({
  position: sceneAt(0),
  telemetry: { width: 1440, height: 900, dpr: 1, tier: 'high', fps: 60, webgl: false },
  anchors: [],
  reducedMotion: false,
  onEnterRelay: () => undefined,
  overPortal: false,
  ...over,
});

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
    expect(() => render(createElement(RelayLanding, chrome()))).not.toThrow();
  });

  it('says so, plainly, instead of showing an empty page', () => {
    render(createElement(RelayLanding, chrome()));
    expect(screen.getByRole('status').textContent).toMatch(/STATIC MODE/i);
  });

  it('still carries every beat of copy', () => {
    render(createElement(RelayLanding, chrome()));
    for (const scene of LANDING_SCENES) {
      expect(screen.getAllByText(scene.headline).length).toBeGreaterThan(0);
      expect(screen.getAllByText(scene.body).length).toBeGreaterThan(0);
    }
  });

  it('still offers the call to action, reachable without a render loop', () => {
    // Without WebGL there is no loop, so nothing ever advances past beat one.
    // The CTA lives at beat eight — it has to be reachable anyway.
    let entered = 0;
    render(createElement(RelayLanding, chrome({ onEnterRelay: () => { entered += 1; } })));
    const cta = screen.getByRole('button', { name: /ENTER RELAY/i });
    // A BUTTON, not a link: entering Relay is an authored camera move inside a
    // live scene, not a document navigation. It is also the keyboard path into
    // a portal that is otherwise a 3D artifact.
    cta.click();
    expect(entered).toBe(1);
  });

  it('exposes the beats as real landmarks for assistive technology', () => {
    render(createElement(RelayLanding, chrome()));
    for (const scene of LANDING_SCENES) {
      const section = screen.getByRole('region', { name: scene.eyebrow });
      expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe(scene.headline);
    }
  });
});

describe('asset safety', () => {
  const html = renderToStaticMarkup(createElement(RelayLanding, chrome()));
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

  it('hands ENTER RELAY to the new Relay experience, never the old shell', () => {
    // The CTA's destination changed meaning: `#/relay` is now Compound Agent
    // creation with the persistent 3D Dog. The old Entry Home is off the
    // onboarding path entirely.
    expect(parsePreviewHash('#/relay')).toEqual({ screen: 'experience' });
    expect(parsePreviewHash('#/relay/console')).toEqual({ screen: 'console' });
  });
});

describe('the i.Wonder brandmark — a link to the separate company deployment', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('renders as plain text when no company URL is configured — not a broken link', () => {
    vi.stubEnv('VITE_IWONDER_WEB_URL', '');
    const { container } = render(createElement(RelayLanding, chrome()));
    const brandmark = within(container.querySelector('.rl3-brand')!).getByText('i.Wonder');
    expect(brandmark.tagName).toBe('SPAN');
  });

  it('links out to the configured, separate i.Wonder deployment', () => {
    vi.stubEnv('VITE_IWONDER_WEB_URL', 'https://iwonder.example.com/');
    const { container } = render(createElement(RelayLanding, chrome()));
    const brandmark = within(container.querySelector('.rl3-brand')!).getByText('i.Wonder');
    expect(brandmark.tagName).toBe('A');
    expect(brandmark.getAttribute('href')).toBe('https://iwonder.example.com/');
    expect(brandmark.getAttribute('target')).toBe('_blank');
    expect(brandmark.getAttribute('rel')).toContain('noopener');
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
