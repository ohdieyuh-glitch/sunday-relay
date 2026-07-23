/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { COLORWAY_LABEL, applyRelayColorway, nextColorway } from './colorway';

/**
 * Colorways: OBSIDIAN (original) and MIDNIGHT (founder website photo).
 * The stylesheets key every variable override from data-relay-colorway on
 * the document root — this locks the attribute contract.
 */

describe('relay colorways', () => {
  it('midnight sets the root attribute; obsidian removes it (default look)', () => {
    const root = document.createElement('div');
    applyRelayColorway('midnight', root);
    expect(root.getAttribute('data-relay-colorway')).toBe('midnight');
    applyRelayColorway('obsidian', root);
    expect(root.hasAttribute('data-relay-colorway')).toBe(false);
  });

  it('cycles obsidian → midnight → obsidian with honest labels', () => {
    expect(nextColorway('obsidian')).toBe('midnight');
    expect(nextColorway('midnight')).toBe('obsidian');
    expect(COLORWAY_LABEL.obsidian).toBe('OBSIDIAN');
    expect(COLORWAY_LABEL.midnight).toBe('MIDNIGHT');
  });
});
