import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mobile layout contracts (CSS-level; rendered-width proof runs in the
 * browser probe). Locks the founder mobile repairs:
 *   - desktop header controls collapse behind the gold MENU at ≤700px
 *   - touch-safe (≥44px) control minimums on mobile
 *   - safe-area insets on headers, sticky actions, terminal, footer
 *   - workforce strip cannot overlap/clip its text
 *   - the cream statement wraps deliberately on mobile
 *   - the dev preview switcher collapses behind a touch-safe handle
 */

const UI = __dirname;
const reh = readFileSync(join(UI, 'entry-home/relay-entry-home.css'), 'utf8');
const rpw = readFileSync(join(UI, 'project-workspace/relay-project-workspace.css'), 'utf8');
const rps = readFileSync(join(UI, 'project-settings/relay-project-settings.css'), 'utf8');
const rpv = readFileSync(join(UI, 'preview/relay-preview.css'), 'utf8');
const rmc = readFileSync(join(UI, 'chrome/relay-chrome.css'), 'utf8');
const rdm = readFileSync(join(UI, 'app/demo-simulation/relay-demo-workspace.css'), 'utf8');

describe('founder mobile header', () => {
  it('desktop controls hide at ≤700px and the MENU block appears', () => {
    expect(rpw).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.rpw-header-right[\s\S]*?display: none/);
    expect(reh).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.reh-header-right[\s\S]*?display: none/);
    expect(rmc).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.rmc-menu-btn \{ display: inline-flex/);
  });

  it('the MENU block is touch-safe and signal-gold themed under manual', () => {
    expect(rmc).toMatch(/\.rmc-menu-btn[\s\S]*?min-height: 44px/);
    expect(rmc).toMatch(
      /\[data-relay-colorway='manual'\][\s\S]*?--rmc-menu-bg: var\(--relay-manual-signal/,
    );
    expect(rmc).toMatch(/--rmc-menu-ink: var\(--relay-manual-ink/);
  });

  it('headers and overlays honor safe-area insets', () => {
    expect(rpw).toContain('env(safe-area-inset-top');
    expect(reh).toContain('env(safe-area-inset-top');
    expect(rmc).toContain('env(safe-area-inset-top');
    expect(rpw).toContain('env(safe-area-inset-bottom');
    expect(rps).toContain('env(safe-area-inset-bottom');
    expect(rpv).toContain('env(safe-area-inset-bottom');
  });
});

describe('mobile content repairs', () => {
  it('workforce strip cells clip with ellipsis instead of overlapping', () => {
    expect(rpw).toMatch(/\.rpw-strip-name \{ overflow: hidden; text-overflow: ellipsis/);
  });

  it('terminal rows break words only when unavoidable on mobile', () => {
    expect(rpw).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.rpw-tmrow-headline,[\s\S]*?overflow-wrap: break-word/);
  });

  it('the statement wraps deliberately: KEEP THE CONTEXT. on its own line', () => {
    expect(rpw).toMatch(/\.rpw-footer-gold \{ display: block; \}/);
  });

  it('touch-safe minimums exist for mobile controls', () => {
    expect(rpw).toMatch(/@media \(max-width: 700px\)[\s\S]*?min-height: 44px/);
    expect(reh).toMatch(/@media \(max-width: 700px\)[\s\S]*?min-height: 44px/);
    expect(rps).toMatch(/\.rps-nav-actions \.rps-btn \{ min-height: 44px/);
  });

  it('the dev preview switcher collapses behind a 44px handle without widening mobile', () => {
    expect(rpv).toMatch(/\.rpv-switcher \{[\s\S]*?display: none/);
    expect(rpv).toMatch(/\.rpv-switcher--open \{[\s\S]*?display: flex/);
    expect(rpv).toMatch(/\.rpv-devchip[\s\S]*?min-height: 44px/);
    expect(rpv).toMatch(/\.rpv-devchip[\s\S]*?max-width: calc\(100vw - 24px\)/);
    expect(rpv).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.rpv-switcher \{[\s\S]*?left: 12px;[\s\S]*?right: 12px/);
  });

  it('the integrated Demo Mission summary stays compact without horizontal overflow', () => {
    // NAMESPACED `rdms`, NOT `rdm`. This panel used to share `.rdm` — and
    // `.rdm-body` — with the Relay Dog's motion boundary, and both stylesheets
    // are imported by the preview app. Equal specificity plus later source
    // order meant the demo panel's `overflow-x: hidden` landed ON THE DOG below
    // 640px, re-imposing the exact vertical clip the Relay Stage exists to
    // remove (CSS forces `overflow-y: auto` when the other axis is `hidden`),
    // and giving the dog a stray border and panel background at every width.
    expect(rdm).toMatch(/\.rdms-title strong \{[\s\S]*?overflow-wrap: anywhere/);
    expect(rdm).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.rdms \{[\s\S]*?max-width: 100%[\s\S]*?overflow-x: hidden/);
    expect(rdm).toMatch(/\.rdms-toggle \{[\s\S]*?width: 44px;[\s\S]*?height: 44px/);
    // And the collision cannot come back: this stylesheet declares no rule that
    // the dog's boundary would also match.
    expect(rdm).not.toMatch(/(^|[\s,}])\.rdm(?![a-z-])/m);
  });
});

describe('coding agent terminal on mobile', () => {
  it('the terminal reflows to a two-column row layout at ≤700px', () => {
    expect(rpw).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.rcat-line \{[\s\S]*?grid-template-columns: auto 1fr/,
    );
  });

  it('terminal controls are touch-safe and the footer honors the safe area', () => {
    expect(rpw).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.rcat-toggle \{ min-height: 44px/);
    expect(rpw).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.rcat-foot \{ padding-bottom: max\(0\.5rem, env\(safe-area-inset-bottom\)/);
  });

  it('long output scrolls inside the terminal instead of widening the page', () => {
    // Every unbounded surface (feed, captured output, diff) is its own
    // scroll container and breaks words rather than forcing a page-wide
    // horizontal scroll on a phone.
    expect(rpw).toMatch(/\.rcat-feed \{[\s\S]*?overflow-x: hidden/);
    expect(rpw).toMatch(/\.rcat-output,[\s\S]*?\.rcat-diff \{[\s\S]*?overflow: auto/);
    expect(rpw).toMatch(/\.rcat-output,[\s\S]*?\.rcat-diff \{[\s\S]*?overflow-wrap: anywhere/);
    expect(rpw).toMatch(/\.rcat-line-body \{ min-width: 0; overflow-wrap: anywhere/);
  });

  it('the live cursor and status pulse stop under reduced motion', () => {
    expect(rpw).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.rcat-cursor,\s*\.rcat-status-dot \{ animation: none/,
    );
    expect(rpw).toMatch(/\.rcat--static \.rcat-cursor,[\s\S]*?animation: none/);
  });
});
