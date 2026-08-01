/**
 * Bridge configuration — env-driven, no secrets read or printed here. The
 * bridge never holds a provider API key: the Fusion backend owns the Alcatraz
 * key, and the Claude coding leg uses the local CLI subscription login.
 *
 * PRODUCTION HOSTING. A managed host injects `PORT` and expects the process to
 * bind every interface, so both are read from the environment rather than
 * assumed. Production additionally REFUSES TO START without the pieces that
 * make the service safe — a bridge token and an exact CORS allowlist — because
 * a bridge that boots wide open is worse than one that does not boot.
 */

import { isAbsolute } from 'node:path';
import type { SundayMode } from './architect';

export interface BridgeConfig {
  port: number;
  /** Bind address. A managed host needs every interface, not loopback. */
  host: string;
  /** Base URL of the real Sunday Alcatraz (Fusion) backend. */
  fusionBaseUrl: string;
  sundayMode: SundayMode;
  /** 'fake' = keyless offline pipeline (no model call); 'live' = real Claude. */
  claudeMode: 'live' | 'fake';
  /**
   * EXACT origins allowed to call the bridge from a browser. Empty means no
   * browser origin is allowed — never "any origin", which with authenticated
   * routes would let any page spend a founder's credentials.
   */
  allowedOrigins: readonly string[];
  /** Required true for a real Claude run (the browser Start = confirm-live). */
  confirmLive: boolean;
  /** Absolute durable-state root (the mounted volume), or null when unset. */
  stateRoot: string | null;
  production: boolean;
}

function pickMode(v: string | undefined): SundayMode {
  return v === 'fast' || v === 'deep' ? v : 'balanced';
}

/** Comma or space separated, trimmed, empties dropped. Order is irrelevant. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter((o) => o !== '');
}

export function loadBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const stateRoot = env.RELAY_STATE_HOME?.trim();
  return {
    // A managed host injects PORT. The Relay-specific variable still wins for
    // local runs, and the historical default remains the fallback.
    port: Number(env.RELAY_BRIDGE_PORT ?? env.PORT ?? 8790),
    host: env.RELAY_BRIDGE_HOST?.trim() || '0.0.0.0',
    fusionBaseUrl: (env.FUSION_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    sundayMode: pickMode(env.RELAY_BRIDGE_SUNDAY_MODE),
    claudeMode: env.RELAY_BRIDGE_FAKE_CLAUDE === '1' ? 'fake' : 'live',
    // `ALLOWED_FRONTEND_ORIGIN` is the historical single-origin spelling and
    // still works; `RELAY_ALLOWED_ORIGINS` is the production one.
    allowedOrigins: parseAllowedOrigins(
      env.RELAY_ALLOWED_ORIGINS ?? env.ALLOWED_FRONTEND_ORIGIN,
    ),
    // Fake mode implies confirmation (no real spend). Live requires the flag.
    confirmLive: env.RELAY_BRIDGE_FAKE_CLAUDE === '1' || env.RELAY_BRIDGE_CONFIRM_LIVE === '1',
    stateRoot: stateRoot !== undefined && stateRoot !== '' ? stateRoot : null,
    production: env.NODE_ENV === 'production',
  };
}

/**
 * What must be true before a PRODUCTION bridge may accept traffic.
 *
 * Returns the missing pieces by NAME, never by value, so the message is safe
 * to print in a deployment log.
 */
export function productionConfigProblems(
  config: BridgeConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!config.production) return [];
  const problems: string[] = [];
  if ((env.RELAY_BRIDGE_API_TOKEN ?? '').trim() === '') {
    problems.push('RELAY_BRIDGE_API_TOKEN is not set — every protected route would be unreachable.');
  }
  if (config.allowedOrigins.length === 0) {
    problems.push('RELAY_ALLOWED_ORIGINS is not set — no browser origin would be allowed.');
  }
  if (config.allowedOrigins.some((o) => o === '*')) {
    problems.push('RELAY_ALLOWED_ORIGINS contains "*", which is never permitted with authenticated routes.');
  }
  if (config.stateRoot === null) {
    problems.push('RELAY_STATE_HOME is not set — durable state would not use the mounted volume.');
  } else if (!isAbsolute(config.stateRoot)) {
    problems.push('RELAY_STATE_HOME must be an absolute path.');
  }
  if (!Number.isFinite(config.port) || config.port <= 0) {
    problems.push('PORT did not resolve to a usable port number.');
  }
  return problems;
}
