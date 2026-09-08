import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE HUD AND THE CONFIGURATION RAIL SHARE A COLUMN.
 *
 * Both are anchored to the left edge of the Relay stage: the usage HUD is a
 * fixed top-left overlay, and the rail is absolutely positioned at the same
 * padding. A rail centred in the whole viewport grows upward into the HUD's
 * readout and the two sets of type overlap — which is what the app actually did
 * until it was rendered and looked at.
 *
 * WHAT THIS TEST CAN AND CANNOT DO, stated rather than implied. jsdom performs
 * no layout: `getBoundingClientRect` returns zeroes, so an overlap cannot be
 * measured here and any test claiming to measure one would be theatre. What CAN
 * be checked is the CONTRACT — that the rail's vertical origin is derived from
 * a reserved HUD band rather than from the viewport — which is precisely the
 * line whose removal reintroduces the bug. A reviewer restoring `top: 50%`
 * fails this.
 *
 * The real verification was visual, at three viewport widths, and it is not
 * repeatable in this suite. That is a limit of the harness and it is better
 * said than papered over.
 */

const css = readFileSync(
  join(__dirname, '..', 'relay-experience', 'relay-experience.css'),
  'utf8',
);

/** The `.rx-panel` block, up to its closing brace. */
const panelBlock = (): string => {
  const start = css.indexOf('.rx-panel {');
  expect(start, '.rx-panel rule not found').toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
};

describe('the configuration rail clears the usage HUD', () => {
  it('reserves a band for the HUD rather than centring in the viewport', () => {
    const block = panelBlock();
    expect(block).toContain('--rx-hud-reserve');
    // The bug, exactly: a bare viewport centring puts the rail under the HUD.
    expect(block).not.toMatch(/\btop:\s*50%/);
  });

  it('derives the rail`s origin and height from that reserve', () => {
    const block = panelBlock();
    expect(block).toMatch(/top:\s*calc\([^;]*--rx-hud-reserve/);
    expect(block).toMatch(/max-height:\s*calc\([^;]*--rx-hud-reserve/);
  });

  it('sizes the reserve from the HUD`s own width clamp, not a guessed constant', () => {
    // The two must move together. A constant would be correct at one viewport
    // width and wrong at every other, which is worse than an obvious error.
    const hudCss = readFileSync(join(__dirname, 'wonderland-hud.css'), 'utf8');
    const hudWidth = /width:\s*(clamp\([^)]*\))/.exec(hudCss)?.[1];
    expect(hudWidth, 'the HUD must declare a width clamp').toBeDefined();

    const reserve = /--rx-hud-reserve:\s*([^;]+);/.exec(panelBlock())?.[1] ?? '';
    const normalise = (s: string) => s.replace(/\s+/g, '');
    expect(normalise(reserve)).toContain(normalise(hudWidth ?? '__none__'));
  });

  it('leaves the mobile bottom sheet alone, where the two never share a column', () => {
    // Under the breakpoint the rail is a bottom sheet with `top: auto`, so the
    // reserve is neither needed nor applied. Asserting this stops someone
    // "fixing" mobile by adding an offset that pushes the sheet off screen.
    const mobile = css.slice(css.indexOf('@media (max-width: 860px)'));
    const mobilePanel = mobile.slice(mobile.indexOf('.rx-panel {'));
    expect(mobilePanel.slice(0, mobilePanel.indexOf('}'))).toContain('top: auto');
  });

  it('keeps the HUD itself anchored top-left, which is canonical', () => {
    const hudCss = readFileSync(join(__dirname, 'wonderland-hud.css'), 'utf8');
    const block = hudCss.slice(hudCss.indexOf('.wh {'));
    const rule = block.slice(0, block.indexOf('}'));
    expect(rule).toContain('position: fixed');
    expect(rule).toMatch(/top:\s*clamp/);
    expect(rule).toMatch(/left:\s*clamp/);
    // The fix moved the RAIL. If anyone ever moves the HUD instead, that is a
    // change to the frozen design and must be a deliberate, founder-led one.
    expect(rule).not.toMatch(/\b(right|bottom):/);
  });
});
