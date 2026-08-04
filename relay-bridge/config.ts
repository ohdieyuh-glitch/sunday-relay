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

import { isProductionDeployment } from './deployment-environment';
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
  /**
   * IS THIS A REAL DEPLOYMENT? Inferred — `NODE_ENV=production` or any Railway
   * marker. Used by everything that fails CLOSED: a wrong answer here makes a
   * gate stricter, never looser, and cannot take the service down.
   */
  production: boolean;
  /**
   * DID AN OPERATOR SAY SO? `NODE_ENV=production` and nothing else.
   *
   * These are two different questions and they were one flag, which is the
   * whole of the risk in this change. The boot refusal below EXITS THE
   * PROCESS, and on a platform that restarts it, exiting is a crash loop. A
   * fail-fast may be armed by a declaration; it must not be armed by an
   * inference about the host, because the inference cannot know whether the
   * variables it is about to insist on were ever set.
   */
  declaredProduction: boolean;
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
  // `RELAY_DATA_DIR` is the hosted-volume variable; `RELAY_STATE_HOME` is the
  // existing local one and still works.
  const stateRoot = (env.RELAY_DATA_DIR ?? env.RELAY_STATE_HOME)?.trim();
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
    /**
     * Inferred, and used only where being wrong is safe. `NODE_ENV` alone is
     * not enough: Railway does not set it, so a real deployment was taking
     * the development branch of the trusted-origin gate.
     *
     * WHAT THE UN-GATED CASE IS AND IS NOT. An earlier draft of this comment
     * said the bridge would boot "with every protected route unauthenticated
     * and any page allowed to spend the founder's credentials". Both halves
     * are false against this code, and a reviewer was right to say so:
     * `bearer-auth.ts` returns false for an empty configured secret, so a
     * missing token makes every protected route UNREACHABLE rather than open;
     * and `server.ts` matches origins by exact string with no wildcard branch,
     * so a literal `*` entry allows nothing a browser can send. What is
     * actually lost is the fail-fast and the warnings — a diagnostics gap, not
     * an open door. Worth closing; not worth a crash loop.
     */
    production: isProductionDeployment(env),
    /**
     * Declared. Arms the boot refusal, which exits the process — see
     * `productionConfigProblems`.
     */
    declaredProduction: env.NODE_ENV === 'production',
  };
}

/**
 * What must be true before a PRODUCTION bridge may accept traffic AT ALL.
 *
 * Deliberately short. A boot failure takes the service down, so only things
 * that would make it unsafe — not merely limited — belong here. A missing
 * token would leave every protected route unreachable, and a wildcard origin
 * would let any page spend a founder's credentials; both are fatal.
 *
 * Absent CORS origins and an absent volume are NOT fatal: an empty allowlist
 * already means "no browser may call this", which is the safe direction, and
 * an absent volume falls back to the local default. Those are warnings, so a
 * bridge configured for CLI use only still starts.
 *
 * Returns the missing pieces by NAME, never by value, so the message is safe
 * to print in a deployment log.
 */
export function productionConfigProblems(
  config: BridgeConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  /*
   * DECLARED, NOT INFERRED — and this line is the safety of the whole change.
   *
   * A problem here is fatal: the server sets a non-zero exit code and stops,
   * and on a platform that restarts the process that is a crash loop rather
   * than a message. Arming that from `isProductionDeployment` would mean a
   * host marker alone could newly insist on four variables nobody had been
   * asked for, on a service that was running perfectly a minute earlier.
   *
   * A fail-fast is a promise the operator made. `NODE_ENV=production` is how
   * they make it. Everything that fails CLOSED uses the inferred flag, because
   * being wrong there refuses a request; being wrong HERE refuses to boot.
   */
  if (!config.declaredProduction) return [];
  const problems: string[] = [];
  if ((env.RELAY_BRIDGE_API_TOKEN ?? '').trim() === '') {
    problems.push('RELAY_BRIDGE_API_TOKEN is not set — every protected route would be unreachable.');
  }
  if (config.allowedOrigins.some((o) => o === '*')) {
    problems.push('RELAY_ALLOWED_ORIGINS contains "*", which is never permitted with authenticated routes.');
  }
  if (config.stateRoot !== null && !isAbsolute(config.stateRoot)) {
    // Name the variable that was actually read. `RELAY_STATE_HOME` also
    // reaches this field, and being told to fix a variable you never set is
    // its own small outage.
    problems.push(
      `${env.RELAY_DATA_DIR !== undefined && env.RELAY_DATA_DIR !== '' ? 'RELAY_DATA_DIR' : 'RELAY_STATE_HOME'} must be an absolute path.`,
    );
  }
  if (!Number.isFinite(config.port) || config.port <= 0) {
    problems.push('PORT did not resolve to a usable port number.');
  }
  return problems;
}

/**
 * Production settings worth saying out loud without refusing to start. Each
 * names a capability the service will simply not have.
 */
export function productionConfigWarnings(config: BridgeConfig): string[] {
  if (!config.production) return [];
  const warnings: string[] = [];
  if (!config.declaredProduction) {
    // Say what is therefore NOT running, by name. A deployment that never set
    // NODE_ENV gets every fail-closed gate and none of the fail-fast, and an
    // operator should learn that from the log rather than from an incident.
    warnings.push(
      'NODE_ENV is not "production" on what looks like a real deployment. Fail-closed gates are '
      + 'active, but the startup refusal for a missing RELAY_BRIDGE_API_TOKEN, a "*" CORS origin, '
      + 'a relative state path or an unusable PORT is NOT armed. Set NODE_ENV=production to arm it.',
    );
  }
  if (config.allowedOrigins.length === 0) {
    warnings.push('RELAY_ALLOWED_ORIGINS is not set — no browser origin may call this bridge. Authenticated CLI use is unaffected.');
  }
  if (config.stateRoot === null) {
    warnings.push('RELAY_DATA_DIR is not set — durable state uses the default path, not a mounted volume.');
  }
  return warnings;
}
