import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RELAY MANUAL colorway — locked to the founder black / cream / aged-gold
 * reference. Exact semantic tokens, defined once, consumed everywhere;
 * signal gold rare; no generic neon-yellow approximations anywhere in the
 * Relay stylesheets; the existing colorways remain untouched.
 */

const UI = join(__dirname);
const theme = readFileSync(join(UI, 'relay-manual-theme.css'), 'utf8');
const allCss = [
  'relay-manual-theme.css',
  'entry-home/relay-entry-home.css',
  'project-workspace/relay-project-workspace.css',
  'project-settings/relay-project-settings.css',
  'preview/relay-preview.css',
  'chrome/relay-chrome.css',
  'pixel-dog/pixel-dog.css',
].map((f) => readFileSync(join(UI, f), 'utf8'));

describe('exact semantic tokens (defined once)', () => {
  const TOKENS: Array<[string, string]> = [
    ['--relay-manual-black', '#070705'],
    ['--relay-manual-stage', '#0b0b09'],
    ['--relay-manual-raised-black', '#11110f'],
    ['--relay-manual-ink', '#0c0c0a'],
    ['--relay-manual-cream', '#eae8dc'],
    ['--relay-manual-cream-panel', '#f5f3e7'],
    ['--relay-manual-cream-muted', '#c8c5b8'],
    ['--relay-manual-cream-text-muted', '#a5a39a'],
    ['--relay-manual-graphite', '#5d5c58'],
    ['--relay-manual-soft-gray', '#a2a19e'],
    ['--relay-manual-gold', '#846622'],
    ['--relay-manual-gold-dark', '#795c1c'],
    ['--relay-manual-gold-muted', '#9d8e6b'],
    ['--relay-manual-signal', '#e7c153'],
    ['--relay-manual-signal-soft', '#dab456'],
    ['--relay-manual-grid-dark', '#1b1c17'],
    ['--relay-manual-grid-cream', '#d6d3c4'],
  ];

  it('every required token exists with the exact founder value', () => {
    for (const [name, value] of TOKENS) {
      const def = new RegExp(`${name}:\\s*${value};`, 'i');
      expect(theme, `${name} should be ${value}`).toMatch(def);
    }
  });

  it('tokens are defined exactly once (single source of truth)', () => {
    for (const [name, value] of TOKENS) {
      const defs = theme.match(new RegExp(`${name}:\\s*#`, 'gi')) ?? [];
      expect(defs.length, `${name} definition count`).toBe(1);
      void value;
    }
  });

  it('the colorway is scoped behind the manual attribute wrapper', () => {
    expect(theme).toContain("[data-relay-colorway='manual']");
    // The default look needs no attribute — obsidian palettes never appear
    // under the manual wrapper file.
    expect(theme).not.toContain('#07080b');
  });
});

describe('reference-specific behavior', () => {
  it('KEEP THE CONTEXT. reads in aged gold on the cream editorial footer', () => {
    expect(theme).toMatch(
      /\.rpw-footer-gold\s*\{\s*color:\s*var\(--relay-manual-gold\)/,
    );
    expect(theme).toMatch(/\.rpw-footer-statement\s*\{\s*color:\s*var\(--relay-manual-ink\)/);
  });

  it('signal gold is rare: primary controls and the menu block only', () => {
    const uses = theme.match(/var\(--relay-manual-signal\)/g) ?? [];
    // Primary CTAs (starter/brief/guide/settings/send) + active switch —
    // a hard ceiling keeps signal gold from spreading to headings/borders.
    expect(uses.length).toBeLessThanOrEqual(24);
    // Signal gold never colors body text directly: every use pairs with an
    // ink foreground (background usage) except soft accents.
    expect(theme).not.toMatch(/^\s*color:\s*var\(--relay-manual-signal\);/m);
  });

  it('cream surfaces flip to ink text via variable re-scoping, not hex scatter', () => {
    // The overrides consume tokens; raw non-token hexes are limited to the
    // token block + rgba() derived lines.
    const body = theme.slice(theme.indexOf('PREVIEW SHELL'));
    const rawHex = body.match(/#[0-9a-f]{6}/gi) ?? [];
    expect(rawHex.length, `unexpected raw hex values: ${rawHex.join(', ')}`).toBe(0);
  });
});

describe('forbidden approximations', () => {
  it('no neon/generic yellow anywhere in the Relay stylesheets', () => {
    for (const css of allCss) {
      expect(css).not.toMatch(/#ffd700/i);
      expect(css).not.toMatch(/#ffc107/i);
      expect(css).not.toMatch(/yellow-400|amber-400/);
    }
  });

  it('existing colorways remain untouched: obsidian + midnight still defined', () => {
    const rpw = allCss[2];
    expect(rpw).toContain('--rpw-bg: #07080b'); // obsidian default
    expect(rpw).toContain("[data-relay-colorway='midnight']");
    expect(rpw).toContain('#1b2138'); // midnight base
  });
});
