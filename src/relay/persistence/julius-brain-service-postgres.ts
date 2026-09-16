import type { Pool } from 'pg';

import type { JuliusBrainRateLimitStore } from '../mission/julius/julius-brain-rate-limit';
import type { JuliusBrainRequestBegin, JuliusBrainRequestEntry, JuliusBrainRequestLog } from '../mission/julius/julius-brain-request-log';
import type { JuliusBrainResponse, JuliusBrainServiceOperation } from '../mission/julius/julius-brain-service-api';

/**
 * The service's own durable state (migration 007): what each request id already
 * answered, and — when the deployment wants exact limits rather than per-process
 * ones — the rate-limit counters.
 *
 * Both are atomic against concurrent service processes: a request id is claimed
 * by one INSERT that either wins or reads what won, and a counter is incremented
 * by one statement that refuses to pass its limit.
 */

export class JuliusBrainRequestPostgresLog implements JuliusBrainRequestLog {
  constructor(private readonly pool: Pool) {}

  async begin(input: { readonly key: string; readonly requestDigest: string; readonly operation: JuliusBrainServiceOperation; readonly at: string }): Promise<JuliusBrainRequestBegin> {
    const claimed = await this.pool.query(
      `INSERT INTO julius_brain.service_requests(key, request_digest, operation, started_at) VALUES($1, $2, $3, $4)
       ON CONFLICT (key) DO NOTHING`,
      [input.key, input.requestDigest, input.operation, input.at],
    );
    if (claimed.rowCount === 1) return { state: 'NEW' };
    const held = await this.read(input.key);
    if (held === null) return { state: 'NEW' }; // the claim was withdrawn between the two statements
    if (held.requestDigest !== input.requestDigest) return { state: 'CONFLICT', heldDigest: held.requestDigest, heldOperation: held.operation };
    return held.response === null ? { state: 'IN_FLIGHT' } : { state: 'REPLAY', response: held.response };
  }

  async complete(input: { readonly key: string; readonly response: JuliusBrainResponse; readonly at: string }): Promise<void> {
    await this.pool.query('UPDATE julius_brain.service_requests SET response = $2::jsonb, completed_at = $3 WHERE key = $1 AND response IS NULL', [input.key, JSON.stringify(input.response), input.at]);
  }

  async abandon(input: { readonly key: string }): Promise<void> {
    await this.pool.query('DELETE FROM julius_brain.service_requests WHERE key = $1 AND response IS NULL', [input.key]);
  }

  async read(key: string): Promise<JuliusBrainRequestEntry | null> {
    const result = await this.pool.query<{ key: string; request_digest: string; operation: JuliusBrainServiceOperation; response: JuliusBrainResponse | null; started_at: Date; completed_at: Date | null }>(
      'SELECT key, request_digest, operation, response, started_at, completed_at FROM julius_brain.service_requests WHERE key = $1', [key],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      key: row.key, requestDigest: row.request_digest, operation: row.operation, response: row.response,
      startedAt: new Date(row.started_at).toISOString(), completedAt: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
    };
  }
}

export class JuliusBrainRateLimitPostgresStore implements JuliusBrainRateLimitStore {
  constructor(private readonly pool: Pool) {}

  async consume(input: { readonly key: string; readonly windowStart: number; readonly windowMs: number; readonly limit: number }): Promise<{ readonly used: number; readonly allowed: boolean }> {
    const result = await this.pool.query<{ used: number }>(
      `INSERT INTO julius_brain.rate_limit_counters(key, window_start, used) VALUES($1, $2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET used = julius_brain.rate_limit_counters.used + 1
       WHERE julius_brain.rate_limit_counters.used < $3
       RETURNING used`,
      [input.key, input.windowStart, input.limit],
    );
    if (result.rows[0] !== undefined) return { used: Number(result.rows[0].used), allowed: true };
    // The window is full. Older windows for this key can no longer be reached.
    await this.pool.query('DELETE FROM julius_brain.rate_limit_counters WHERE key = $1 AND window_start < $2', [input.key, input.windowStart]);
    return { used: input.limit, allowed: false };
  }

  async release(input: { readonly key: string; readonly windowStart: number }): Promise<void> {
    await this.pool.query('UPDATE julius_brain.rate_limit_counters SET used = GREATEST(used - 1, 0) WHERE key = $1 AND window_start = $2', [input.key, input.windowStart]);
  }
}
