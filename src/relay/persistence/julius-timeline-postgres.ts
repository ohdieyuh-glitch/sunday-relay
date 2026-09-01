import type { Pool } from 'pg';

import type { JuliusTimelineEntry, JuliusTimelineReader } from '../mission/julius';

/**
 * THE SAFE TIMELINE, READ FROM THE EVENT LEDGER.
 *
 * `JuliusEventPostgresRepository` writes every Julius event into
 * `relay_wonderland.events` with a per-stream sequence and an outbox row in
 * the same transaction. That makes the ledger the authority, the outbox the
 * delivery boundary and any realtime channel a PROJECTION of both — which is
 * the ordering this reader depends on and does not re-implement.
 *
 * A CURSOR IS A SEQUENCE, NOT AN OFFSET. `UNIQUE(stream_id, sequence)` makes a
 * sequence stable under concurrent inserts; an offset shifts, and a
 * reconnecting reader on an offset silently skips or repeats.
 *
 * SCOPED BY BOTH RUN AND PROJECT. The events table carries `project_id`, so a
 * caller holding a run id from another tenant reads an empty page rather than
 * that tenant's timeline.
 *
 * ONLY SAFE FACTS CROSS. The stored payload is the event's own `facts` plus
 * its identity — `validateJuliusEvent` rejects a payload larger than 8 KiB or
 * containing a credential-shaped assignment before it is ever written — and
 * this reader projects those fields and drops the rest rather than returning
 * the row.
 */
export class JuliusTimelinePostgresRepository implements JuliusTimelineReader {
  constructor(private readonly pool: Pool) {}

  async timeline(input: {
    runId: string; projectId: string; sinceSequence: number; limit: number;
  }): Promise<{ entries: readonly JuliusTimelineEntry[]; hasMore: boolean }> {
    // One row over the page is fetched so `hasMore` is a FACT rather than a
    // guess from a full page — a page that happens to end exactly on the limit
    // would otherwise always claim there is more.
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT event_id,sequence,event_type,payload,occurred_at
         FROM relay_wonderland.events
        WHERE stream_id=$1 AND project_id=$2 AND sequence>$3
          AND event_type LIKE 'julius.%'
        ORDER BY sequence
        LIMIT $4`,
      [input.runId, input.projectId, input.sinceSequence, input.limit + 1],
    );
    const rows = result.rows.slice(0, input.limit);
    return {
      hasMore: result.rows.length > rows.length,
      entries: rows.map((row) => {
        const payload = parsePayload(row.payload);
        return {
          eventId: String(row.event_id),
          sequence: Number(row.sequence),
          // Stored as `julius.<type>`; the prefix is how the ledger separates
          // Julius events from Wonderland's own, and is not part of the type.
          type: String(row.event_type).replace(/^julius\./, ''),
          taskId: typeof payload.taskId === 'string' ? payload.taskId : null,
          workerId: typeof payload.workerId === 'string' ? payload.workerId : null,
          occurredAt: new Date(String(row.occurred_at)).toISOString(),
          facts: safeFacts(payload.facts),
        };
      }),
    };
  }
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/**
 * Scalars only, on the way out as well as on the way in.
 *
 * `validateJuliusEvent` already refuses a non-scalar fact at write time. This
 * refuses one at READ time too, because a row could have been written by an
 * older build, restored from a backup, or edited by hand — and a timeline is
 * exactly where a nested object would be rendered without anyone looking.
 */
function safeFacts(value: unknown): Readonly<Record<string, string | number | boolean | null>> {
  const source = parsePayload(value);
  const facts: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(source)) {
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      facts[key] = item as string | number | boolean | null;
    }
  }
  return facts;
}
