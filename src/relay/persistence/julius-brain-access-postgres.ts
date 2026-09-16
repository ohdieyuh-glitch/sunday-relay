import type { Pool } from 'pg';

import {
  chainJuliusBrainAuditEvent,
  type JuliusBrainAccessRegistration,
  type JuliusBrainAccessStatePort,
  type JuliusBrainAuditEntry,
  type JuliusBrainAuditEvent,
  type JuliusBrainRunSession,
} from '../mission/julius/julius-brain-access';

/**
 * The Brain service's access state in the Brain's own database
 * (migration 006): token claims, attempt registrations, sessions and the
 * hash-chained audit, each append-only. Every operation is atomic against
 * concurrent service processes: a claim or a registration is one INSERT that
 * either wins or reads what won; audit appends are serialised by a transaction
 * advisory lock, so two processes never chain from the same head.
 */

const AUDIT_LOCK = 'julius_brain.access_audit';

export class JuliusBrainAccessPostgresState implements JuliusBrainAccessStatePort {
  constructor(private readonly pool: Pool) {}

  async claimToken(tokenDigest: string, expiresAt: string): Promise<boolean> {
    const result = await this.pool.query('INSERT INTO julius_brain.access_token_claims(token_digest, expires_at) VALUES($1, $2) ON CONFLICT (token_digest) DO NOTHING', [tokenDigest, expiresAt]);
    return result.rowCount === 1;
  }

  async register(registration: JuliusBrainAccessRegistration): Promise<JuliusBrainAccessRegistration> {
    await this.pool.query(
      `INSERT INTO julius_brain.access_registrations(brain_run_id, project_id, mission_id, policy_hash, environment, registered_at)
       VALUES($1, $2, $3, $4, $5, $6) ON CONFLICT (brain_run_id) DO NOTHING`,
      [registration.brainRunId, registration.projectId, registration.missionId, registration.policyHash, registration.environment, registration.registeredAt],
    );
    const held = await this.pool.query<{ brain_run_id: string; project_id: string; mission_id: string; policy_hash: string; environment: JuliusBrainAccessRegistration['environment']; registered_at: Date }>(
      'SELECT brain_run_id, project_id, mission_id, policy_hash, environment, registered_at FROM julius_brain.access_registrations WHERE brain_run_id = $1', [registration.brainRunId],
    );
    const row = held.rows[0]!;
    return { brainRunId: row.brain_run_id, projectId: row.project_id, missionId: row.mission_id, policyHash: row.policy_hash, environment: row.environment, registeredAt: new Date(row.registered_at).toISOString() };
  }

  async putSession(tokenDigest: string, session: JuliusBrainRunSession): Promise<void> {
    await this.pool.query('INSERT INTO julius_brain.access_sessions(token_digest, session, expires_at) VALUES($1, $2::jsonb, $3)', [tokenDigest, JSON.stringify(session), session.expiresAt]);
  }

  async getSession(tokenDigest: string): Promise<JuliusBrainRunSession | null> {
    const result = await this.pool.query<{ session: JuliusBrainRunSession }>('SELECT session FROM julius_brain.access_sessions WHERE token_digest = $1', [tokenDigest]);
    return result.rows[0]?.session ?? null;
  }

  async appendAudit(entry: JuliusBrainAuditEntry): Promise<JuliusBrainAuditEvent> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [AUDIT_LOCK]);
      const head = await client.query<{ sequence: string; hash: string }>('SELECT sequence, hash FROM julius_brain.access_audit ORDER BY sequence DESC LIMIT 1');
      const previous = head.rows[0] === undefined ? null : { sequence: Number(head.rows[0].sequence), hash: head.rows[0].hash };
      const event = chainJuliusBrainAuditEvent(previous, entry);
      await client.query('INSERT INTO julius_brain.access_audit(sequence, event, previous_hash, hash) VALUES($1, $2::jsonb, $3, $4)', [event.sequence, JSON.stringify(event), event.previousHash, event.hash]);
      await client.query('COMMIT');
      return event;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async auditHead(): Promise<{ readonly sequence: number; readonly hash: string } | null> {
    const result = await this.pool.query<{ sequence: string; hash: string }>('SELECT sequence, hash FROM julius_brain.access_audit ORDER BY sequence DESC LIMIT 1');
    const row = result.rows[0];
    return row === undefined ? null : { sequence: Number(row.sequence), hash: row.hash };
  }

  async readAudit(): Promise<readonly JuliusBrainAuditEvent[]> {
    const result = await this.pool.query<{ event: JuliusBrainAuditEvent }>('SELECT event FROM julius_brain.access_audit ORDER BY sequence');
    return result.rows.map((row) => row.event);
  }
}
