/**
 * Bridge configuration — env-driven, no secrets read or printed here. The
 * bridge never holds a provider API key: the Fusion backend owns the Alcatraz
 * key, and the Claude coding leg uses the local CLI subscription login.
 */

import type { SundayMode } from './architect';

export interface BridgeConfig {
  port: number;
  /** Base URL of the real Sunday Alcatraz (Fusion) backend. */
  fusionBaseUrl: string;
  sundayMode: SundayMode;
  /** 'fake' = keyless offline pipeline (no model call); 'live' = real Claude. */
  claudeMode: 'live' | 'fake';
  /** Restrict CORS to this origin, or null for open (dev). */
  allowedOrigin: string | null;
  /** Required true for a real Claude run (the browser Start = confirm-live). */
  confirmLive: boolean;
}

function pickMode(v: string | undefined): SundayMode {
  return v === 'fast' || v === 'deep' ? v : 'balanced';
}

export function loadBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return {
    port: Number(env.RELAY_BRIDGE_PORT ?? 8790),
    fusionBaseUrl: (env.FUSION_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    sundayMode: pickMode(env.RELAY_BRIDGE_SUNDAY_MODE),
    claudeMode: env.RELAY_BRIDGE_FAKE_CLAUDE === '1' ? 'fake' : 'live',
    allowedOrigin: env.ALLOWED_FRONTEND_ORIGIN?.trim() ? env.ALLOWED_FRONTEND_ORIGIN.trim() : null,
    // Fake mode implies confirmation (no real spend). Live requires the flag.
    confirmLive: env.RELAY_BRIDGE_FAKE_CLAUDE === '1' || env.RELAY_BRIDGE_CONFIRM_LIVE === '1',
  };
}
