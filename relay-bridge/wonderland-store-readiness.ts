import type { Pool } from 'pg';

import { readWonderlandEosClientConfig, WONDERLAND_EOS_TRUSTED_ENV } from './wonderland-voice/eos';
import { migrationVersion, TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS } from '../src/relay/persistence/wonderland-postgres';

/**
 * IS THIS BRIDGE'S WONDERLAND STORE READY, AS FACTS AN OPERATOR CAN READ WITHOUT A DATABASE CLIENT.
 *
 * A hosted bridge answers social with 503 until its database exists and is
 * migrated through 033, and voice until 035 is applied and EOS is configured.
 * Before this, telling which of those was true meant connecting to the database
 * by hand. This reads it from the process that serves the routes:
 *   - whether a database is configured at all (by variable NAME, never value);
 *   - whether it answers (a failure is a code, never the driver's message, which
 *     can name the host);
 *   - which of this build's migrations its ledger holds, whether they form a
 *     gap-free prefix of the chain this build ships, and any stamp this build
 *     does not know (a store ahead of the code);
 *   - which Wonderland surfaces that makes ready.
 *
 * Operator only (the route): the schema state of a deployment is layout, and the
 * unauthenticated `/health` routes deliberately say nothing about it.
 */

export const WONDERLAND_STORE_READINESS_VERSION = 'wonderland-store-readiness.v1' as const;
export const WONDERLAND_SOCIAL_STAMP = '033_wonderland_social';
export const WONDERLAND_VOICE_STAMP = '035_wonderland_voice';
/** Known to this build but not shipped in its chain: staged behind a migration that does not exist yet. */
export const WONDERLAND_STAGED_STAMPS: readonly string[] = Object.freeze([WONDERLAND_VOICE_STAMP]);
/** How long a readiness probe waits for the database before calling it unreachable. */
export const WONDERLAND_STORE_PROBE_TIMEOUT_MS = 5_000;

/** The migration stamps this build ships, in the order `migrate()` applies them. */
export const WONDERLAND_SHIPPED_CHAIN: readonly string[] = Object.freeze(
  WONDERLAND_MIGRATIONS.map((sql) => migrationVersion(sql)).filter((stamp): stamp is string => stamp !== null),
);

export interface WonderlandLedgerJudgement {
  /** How many of this build's stamps the ledger holds. */
  readonly applied: number;
  /** The chain's length: what "fully migrated" means for this build. */
  readonly expected: number;
  /** The last stamp of the longest applied prefix of the chain, or null when not even the first is applied. */
  readonly through: string | null;
  /** The chain's stamps the ledger does not hold, in chain order. */
  readonly pending: readonly string[];
  /** Whether the applied stamps are exactly a prefix of the chain: no gap, nothing out of order. */
  readonly gapFree: boolean;
  /** Stamps in the ledger that this build neither ships nor stages: a store ahead of this code, or not this chain at all. */
  readonly unknown: readonly string[];
}

/** Pure: the ledger as read, judged against the chain this build ships. */
export function judgeWonderlandLedger(applied: ReadonlySet<string>, chain: readonly string[] = WONDERLAND_SHIPPED_CHAIN): WonderlandLedgerJudgement {
  let prefix = 0;
  while (prefix < chain.length && applied.has(chain[prefix]!)) prefix += 1;
  const appliedInChain = chain.filter((stamp) => applied.has(stamp)).length;
  const known = new Set([...chain, ...WONDERLAND_STAGED_STAMPS]);
  return Object.freeze({
    applied: appliedInChain,
    expected: chain.length,
    through: prefix === 0 ? null : chain[prefix - 1]!,
    pending: Object.freeze(chain.filter((stamp) => !applied.has(stamp))),
    gapFree: appliedInChain === prefix,
    unknown: Object.freeze([...applied].filter((stamp) => !known.has(stamp)).sort()),
  });
}

export type WonderlandStoreDatabase =
  | { readonly state: 'NOT_CONFIGURED'; readonly missingConfig: readonly string[] }
  | { readonly state: 'UNREACHABLE'; readonly reason: string }
  | { readonly state: 'CONNECTED' };

export interface WonderlandStoreReadiness {
  readonly version: typeof WONDERLAND_STORE_READINESS_VERSION;
  readonly database: WonderlandStoreDatabase;
  /** Null unless CONNECTED: an unreachable ledger is unknown, never empty. */
  readonly ledger: WonderlandLedgerJudgement | null;
  readonly surfaces: {
    /** Friends, blocks, parties, servers, presence, Recent Players, messages (migration 033). */
    readonly social: 'READY' | 'NOT_APPLIED' | 'UNKNOWN';
    /** EOS identities and voice issuances (migration 035, staged). */
    readonly voiceSchema: 'READY' | 'NOT_APPLIED' | 'UNKNOWN';
    /** The game client's runtime EOS configuration: presence of every variable, never a value. */
    readonly eosClientConfig: 'CONFIGURED' | 'NOT_CONFIGURED';
    /** The trusted voice server's credentials: presence only. */
    readonly eosTrustedServer: 'CONFIGURED' | 'NOT_CONFIGURED';
  };
  /** Browser and player sessions live in memory: a restart revokes every one, by design. */
  readonly sessions: 'IN_MEMORY_REVOKED_ON_RESTART';
}

/** A driver failure as a code a reader can act on, never the driver's text (which can carry the host or user). */
export function wonderlandStoreFailureReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{2,40}$/u.test(code)) return code;
  if (error instanceof Error && error.message === 'wonderland_store_probe_timeout') return 'TIMEOUT';
  return 'ERROR';
}

export async function readWonderlandStoreReadiness(input: {
  readonly pool: Pool | null;
  readonly missingConfig: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
}): Promise<WonderlandStoreReadiness> {
  const eosClientConfig = readWonderlandEosClientConfig(input.env).ok ? 'CONFIGURED' as const : 'NOT_CONFIGURED' as const;
  const trusted = [WONDERLAND_EOS_TRUSTED_ENV.clientId, WONDERLAND_EOS_TRUSTED_ENV.clientSecret]
    .every((name) => (input.env[name] ?? '').trim() !== '') ? 'CONFIGURED' as const : 'NOT_CONFIGURED' as const;
  const base = { version: WONDERLAND_STORE_READINESS_VERSION, sessions: 'IN_MEMORY_REVOKED_ON_RESTART' as const };
  const unknownSurfaces = { social: 'UNKNOWN' as const, voiceSchema: 'UNKNOWN' as const, eosClientConfig, eosTrustedServer: trusted };
  if (input.pool === null) {
    return Object.freeze({ ...base, database: { state: 'NOT_CONFIGURED' as const, missingConfig: [...input.missingConfig] }, ledger: null, surfaces: unknownSurfaces });
  }
  let applied: ReadonlySet<string>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    applied = await Promise.race([
      new TransactionalWonderlandDatabase(input.pool).appliedMigrationVersions(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('wonderland_store_probe_timeout')), input.timeoutMs ?? WONDERLAND_STORE_PROBE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    return Object.freeze({ ...base, database: { state: 'UNREACHABLE' as const, reason: wonderlandStoreFailureReason(error) }, ledger: null, surfaces: unknownSurfaces });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return Object.freeze({
    ...base,
    database: { state: 'CONNECTED' as const },
    ledger: judgeWonderlandLedger(applied),
    surfaces: {
      social: applied.has(WONDERLAND_SOCIAL_STAMP) ? 'READY' as const : 'NOT_APPLIED' as const,
      voiceSchema: applied.has(WONDERLAND_VOICE_STAMP) ? 'READY' as const : 'NOT_APPLIED' as const,
      eosClientConfig,
      eosTrustedServer: trusted,
    },
  });
}

export const WONDERLAND_READINESS_PATH = '/wonderland/readiness';

/** `GET /relay-api/wonderland/readiness`, operator only. Null when the path is not this route. */
export async function handleWonderlandReadinessRoute(
  request: { readonly method: string; readonly path: string; readonly operator: boolean },
  read: () => Promise<WonderlandStoreReadiness>,
): Promise<{ readonly status: number; readonly body: unknown } | null> {
  if (request.path !== WONDERLAND_READINESS_PATH) return null;
  if (request.method !== 'GET') {
    return { status: 405, body: { error: { kind: 'method_not_allowed', message: 'Wonderland readiness is read-only.' } } };
  }
  if (!request.operator) {
    return { status: 401, body: { error: { kind: 'operator_required', message: 'Wonderland store readiness is deployment layout: it requires operator authentication.' } } };
  }
  return { status: 200, body: { data: await read() } };
}
