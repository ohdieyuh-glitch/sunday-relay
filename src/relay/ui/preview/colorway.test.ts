/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import {
  COLORWAY_LABEL,
  RELAY_COLORWAYS,
  applyRelayColorway,
  nextColorway,
} from './colorway';

/**
 * Relay appearances: RELAY ORIGINAL (obsidian, default), MIDNIGHT (founder
 * website photo), RELAY MANUAL (founder black/cream/aged-gold reference).
 * The stylesheets key every variable override from data-relay-colorway on
 * the document root — this locks the attribute contract and that RELAY
 * MANUAL is optional while the existing appearances stay available.
 */

describe('relay appearances', () => {
  it('RELAY MANUAL exists as an optional third appearance; existing ones remain', () => {
    expect(RELAY_COLORWAYS).toEqual(['obsidian', 'midnight', 'manual']);
    expect(COLORWAY_LABEL.obsidian).toBe('RELAY ORIGINAL');
    expect(COLORWAY_LABEL.midnight).toBe('MIDNIGHT');
    expect(COLORWAY_LABEL.manual).toBe('RELAY MANUAL');
  });

  it('manual/midnight set the root attribute; obsidian removes it (default look)', () => {
    const root = document.createElement('div');
    applyRelayColorway('manual', root);
    expect(root.getAttribute('data-relay-colorway')).toBe('manual');
    applyRelayColorway('midnight', root);
    expect(root.getAttribute('data-relay-colorway')).toBe('midnight');
    applyRelayColorway('obsidian', root);
    expect(root.hasAttribute('data-relay-colorway')).toBe(false);
  });

  it('switching is immediate attribute swapping — no reload involved', () => {
    const root = document.createElement('div');
    applyRelayColorway('manual', root);
    applyRelayColorway('obsidian', root);
    applyRelayColorway('manual', root);
    expect(root.getAttribute('data-relay-colorway')).toBe('manual');
  });

  it('cycles through every appearance and back', () => {
    expect(nextColorway('obsidian')).toBe('midnight');
    expect(nextColorway('midnight')).toBe('manual');
    expect(nextColorway('manual')).toBe('obsidian');
  });
});
