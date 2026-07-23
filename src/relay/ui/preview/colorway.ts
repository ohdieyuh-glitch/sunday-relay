/**
 * Relay colorways. OBSIDIAN is the original deep-black + gold system look;
 * MIDNIGHT is the founder-photo website colorway — deep slate-indigo screen,
 * cream text, warm gold accents. Purely presentational: a data attribute on
 * the document root that the module stylesheets key their variable
 * overrides from. No persistence here — hosts decide where the choice lives.
 */

export type RelayColorway = 'obsidian' | 'midnight';

export const RELAY_COLORWAYS: readonly RelayColorway[] = ['obsidian', 'midnight'];

export const COLORWAY_LABEL: Record<RelayColorway, string> = {
  obsidian: 'OBSIDIAN',
  midnight: 'MIDNIGHT',
};

/** Apply a colorway to the document root (default obsidian = no attribute). */
export function applyRelayColorway(colorway: RelayColorway, root: HTMLElement): void {
  if (colorway === 'obsidian') {
    root.removeAttribute('data-relay-colorway');
  } else {
    root.setAttribute('data-relay-colorway', colorway);
  }
}

export function nextColorway(current: RelayColorway): RelayColorway {
  const i = RELAY_COLORWAYS.indexOf(current);
  return RELAY_COLORWAYS[(i + 1) % RELAY_COLORWAYS.length];
}
