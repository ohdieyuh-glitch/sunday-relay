/// <reference types="vite/client" />

/**
 * Relay-owned ambient build types.
 *
 * Only the NON-SECRET, public build flags Relay reads. A provider key is
 * never read here and never reaches the browser bundle — the Relay bridge
 * holds provider auth locally and is addressed by URL only.
 */
interface ImportMetaEnv {
  /** `1` selects the live bridge adapter instead of the demo adapter. */
  readonly VITE_RELAY_LIVE?: string;
  /** Explicit Relay bridge base URL. Unset = same-origin `/relay-api`. */
  readonly VITE_RELAY_BRIDGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
