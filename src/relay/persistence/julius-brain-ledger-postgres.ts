import type { Pool, PoolClient } from 'pg';

import {
  appendBrainRecord,
  verifyBrainLedger,
  type BrainAppendResult,
  type BrainRecord,
  type BrainRecordDraft,
  type BrainLedgerVerification,
} from '../mission/brain/brain-ledger';
import { brainScopeRunId } from '../mission/brain/brain-attempt-identity';

/**
 * THE LEDGER, ON POSTGRESQL.
 *
 * The decision of what may be appended is pure and lives in
 * `mission/brain/brain-ledger.ts`; this holds the rows and the one thing a pure
 * function cannot do — make the decision and the write the same atomic act.
 *
 *   ONE APPENDER AT A TIME, PER PROJECT. A record commits to the one before it,
 *   so two processes appending at once would either chain from the same
 *   predecessor or interleave. A transaction advisory lock keyed on the project
 *   makes the read-decide-write a single step, and the database's
 *   `UNIQUE (project_id, sequence)` refuses the write if that ever fails.
 *
 *   A REPLAY WRITES NOTHING. The same idempotency key with the same statement
 *   returns the record that is already there, and the ledger does not grow.
 *
 *   THE STORE NEVER EDITS. There is no UPDATE and no DELETE in this file, and
 *   the database refuses them anyway (migration 001).
 */

export interface JuliusBrainLedgerStore {
  append(input: { readonly projectId: string; readonly draft: BrainRecordDraft; readonly recordedAt: string; readonly recordId: string }): Promise<BrainAppendResult>;
  records(projectId: string, query?: { readonly scope?: string; readonly runId?: string; readonly afterSequence?: number; readonly limit?: number }): Promise<readonly BrainRecord[]>;
  verify(projectId: string): Promise<BrainLedgerVerification>;
}

interface Row {
  record_id: string; sequence: string; domain: string; kind: string; status: string; scope: string;
  project_id: string; mission_id: string; author: string; author_id: string;
  payload: Record<string, string | number | boolean | null>; evidence_ids: string[];
  occurred_at: Date | null; recorded_at: Date; supersedes: string | null; idempotency_key: string;
  previous_hash: string | null; hash: string;
}

const toRecord = (row: Row): BrainRecord => ({
  recordId: row.record_id, sequence: Number(row.sequence), domain: row.domain as BrainRecord['domain'], kind: row.kind,
  status: row.status as BrainRecord['status'], scope: row.scope, projectId: row.project_id, missionId: row.mission_id,
  author: row.author as BrainRecord['author'], authorId: row.author_id, payload: row.payload, evidenceIds: row.evidence_ids,
  // The stored instant is rendered exactly as it was written: an Unknown time stays null.
  occurredAt: row.occurred_at === null ? null : new Date(row.occurred_at).toISOString(),
  recordedAt: new Date(row.recorded_at).toISOString(),
  supersedes: row.supersedes, idempotencyKey: row.idempotency_key, previousHash: row.previous_hash, hash: row.hash,
});

const SELECT = `SELECT record_id, sequence, domain, kind, status, scope, project_id, mission_id, author, author_id,
  payload, evidence_ids, occurred_at, recorded_at, supersedes, idempotency_key, previous_hash, hash
  FROM julius_brain.records`;

export class JuliusBrainLedgerPostgresStore implements JuliusBrainLedgerStore {
  constructor(private readonly pool: Pool) {}

  async append(input: { readonly projectId: string; readonly draft: BrainRecordDraft; readonly recordedAt: string; readonly recordId: string }): Promise<BrainAppendResult> {
    const client: PoolClient = await this.pool.connect();
    try {
      // READ COMMITTED, deliberately: under SERIALIZABLE the transaction's
      // snapshot is taken at its first statement, which is BEFORE the advisory
      // lock is granted — so a waiter would read the ledger as it stood before
      // the winner committed and compute the same sequence again. Here the read
      // below takes a fresh snapshot once the lock is held, and the lock is what
      // makes read-decide-write one step.
      await client.query('BEGIN');
      // One appender per project: two projects never wait on each other.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`julius_brain.records:${input.projectId}`]);
      const held = await client.query<Row>(`${SELECT} WHERE project_id = $1 ORDER BY sequence`, [input.projectId]);
      const ledger = held.rows.map(toRecord);
      const decision = appendBrainRecord({ ledger, draft: input.draft, recordedAt: input.recordedAt, recordId: input.recordId });
      if (decision.outcome !== 'APPENDED') {
        await client.query('ROLLBACK');
        return decision;
      }
      const record = decision.record;
      const runId = brainScopeRunId(record.scope);
      if (runId === null) {
        await client.query('ROLLBACK');
        return { outcome: 'REFUSED', reasonCode: 'scope_invalid', detail: `${record.scope} names no run` };
      }
      await client.query(
        `INSERT INTO julius_brain.records(record_id, sequence, domain, kind, status, scope, run_id, project_id, mission_id,
           author, author_id, payload, evidence_ids, occurred_at, recorded_at, supersedes, idempotency_key, previous_hash, hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19)`,
        [
          record.recordId, record.sequence, record.domain, record.kind, record.status, record.scope, runId, record.projectId, record.missionId,
          record.author, record.authorId, JSON.stringify(record.payload), JSON.stringify(record.evidenceIds),
          record.occurredAt, record.recordedAt, record.supersedes, record.idempotencyKey, record.previousHash, record.hash,
        ],
      );
      await client.query('COMMIT');
      return decision;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async records(projectId: string, query: { readonly scope?: string; readonly runId?: string; readonly afterSequence?: number; readonly limit?: number } = {}): Promise<readonly BrainRecord[]> {
    const values: unknown[] = [projectId, query.afterSequence ?? 0];
    let where = 'project_id = $1 AND sequence > $2';
    if (query.scope !== undefined) { values.push(query.scope); where += ` AND scope = $${values.length}`; }
    if (query.runId !== undefined) { values.push(query.runId); where += ` AND run_id = $${values.length}`; }
    values.push(Math.max(1, Math.min(query.limit ?? 5_000, 5_000)));
    const result = await this.pool.query<Row>(`${SELECT} WHERE ${where} ORDER BY sequence LIMIT $${values.length}`, values);
    return result.rows.map(toRecord);
  }

  /** Read the whole ledger back and check it is the history it claims. */
  async verify(projectId: string): Promise<BrainLedgerVerification> {
    const result = await this.pool.query<Row>(`${SELECT} WHERE project_id = $1 ORDER BY sequence`, [projectId]);
    return verifyBrainLedger(result.rows.map(toRecord));
  }
}
