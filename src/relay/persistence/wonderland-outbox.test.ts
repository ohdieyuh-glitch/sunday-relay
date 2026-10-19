import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { WonderlandEvent } from '../mission/wonderland/wonderland-backend';
import { TransactionalWonderlandDatabase, WONDERLAND_MIGRATION_002 } from './wonderland-postgres';

class OutboxPool {
  commands: string[] = []; topRows: unknown[] = []; released = 0;
  async query(text: string) { this.commands.push(text); return { rows: this.topRows, rowCount: text.startsWith('UPDATE') ? 1 : this.topRows.length }; }
  async connect() { const pool = this; return { async query(text: string) { pool.commands.push(text); if (text.includes('RETURNING next_sequence-1')) return { rows: [{ sequence: '1' }], rowCount: 1 }; return { rows: [], rowCount: text.startsWith('INSERT') || text.startsWith('UPDATE') ? 1 : 0 }; }, release() { pool.released += 1; } }; }
  async end() {}
}
const db = (pool: OutboxPool) => new TransactionalWonderlandDatabase(pool as unknown as Pool);
const event: Omit<WonderlandEvent, 'sequence'> = { eventId: 'event-1', schemaVersion: 'relay-wonderland-event.v1', timestamp: '2026-08-24T00:00:00.000Z', projectId: 'project-1', sessionId: null, playerId: 'alice', agentId: 'agent-a', missionId: 'mission-1', battleId: 'battle-1', eventType: 'battle.started', payload: {}, visibility: 'PARTICIPANTS', correlationId: 'battle-1', causationId: null };

describe('Wonderland transactional outbox migration', () => {
  it('enforces one outbox row per event, leases, retry state and a claim index', () => { expect(WONDERLAND_MIGRATION_002).toContain('event_id text NOT NULL UNIQUE'); expect(WONDERLAND_MIGRATION_002).toContain("CHECK(status IN('PENDING','CLAIMED','DELIVERED','DEAD'))"); expect(WONDERLAND_MIGRATION_002).toContain('claimed_until'); expect(WONDERLAND_MIGRATION_002).toContain('next_attempt_at'); expect(WONDERLAND_MIGRATION_002).toContain('wonderland_outbox_claim'); });
});

describe('atomic command, event and outbox commit', () => {
  it('writes the effect, event, outbox and idempotency response before one COMMIT', async () => { const pool = new OutboxPool(); const result = await db(pool).commitCommand({ scope: 'battle', commandId: 'command-1', requestHash: 'hash-1', streamId: 'project-1', event }, async transaction => { await transaction.saveExecution({ executionId: 'exec-1', battleId: null, missionId: 'mission-1', projectId: 'project-1', playerId: 'alice', agentId: 'agent-a', cardSnapshot: { cardVersionId: 'card-1' } as never, workspaceIsolationRef: 'workspace', permissions: [], budget: {} as never, state: 'RUNNING', usage: {} as never, receiptIds: [], evidenceIds: [], artifactIds: [], startedAt: null, completedAt: null, cancellationRequestedAt: null, terminalReason: null, checkpoint: {} as never, version: 1 }, null); return { accepted: true }; }); expect(result.event.sequence).toBe(1); const joined = pool.commands.join('\n'); const execution = joined.indexOf('INSERT INTO relay_wonderland.execution_sessions'); const persistedEvent = joined.indexOf('INSERT INTO relay_wonderland.events'); const outbox = joined.indexOf('INSERT INTO relay_wonderland.outbox'); const idempotency = joined.indexOf('INSERT INTO relay_wonderland.idempotency'); expect(execution).toBeLessThan(persistedEvent); expect(persistedEvent).toBeLessThan(outbox); expect(outbox).toBeLessThan(idempotency); expect(pool.commands.at(-1)).toBe('COMMIT'); });
  it('rolls back before event/outbox when the mutation fails', async () => { const pool = new OutboxPool(); await expect(db(pool).commitCommand({ scope: 'battle', commandId: 'bad', requestHash: 'hash', streamId: 'project-1', event }, async () => { throw new Error('mutation failed'); })).rejects.toThrow('mutation failed'); expect(pool.commands).not.toContain(expect.stringContaining('relay_wonderland.events')); expect(pool.commands).not.toContain(expect.stringContaining('relay_wonderland.outbox')); expect(pool.commands.at(-1)).toBe('ROLLBACK'); });
});

describe('multi-worker outbox delivery', () => {
  it('claims with SKIP LOCKED and returns durable lease ownership', async () => { const pool = new OutboxPool(); pool.topRows = [{ outbox_id: 'outbox:event-1', event_id: 'event-1', project_id: 'project-1', attempts: 1 }]; const claimed = await db(pool).claimOutbox('worker-a', '2026-08-24T00:00:00Z', '2026-08-24T00:01:00Z'); expect(claimed).toEqual([{ outboxId: 'outbox:event-1', eventId: 'event-1', projectId: 'project-1', attempts: 1 }]); expect(pool.commands[0]).toContain('FOR UPDATE SKIP LOCKED'); });
  it('requires the claiming worker to complete or retry delivery', async () => { const pool = new OutboxPool(); expect(await db(pool).completeOutbox('worker-a', 'outbox:event-1', '2026-08-24T00:00:01Z')).toBe(true); expect(pool.commands[0]).toContain("status='CLAIMED' AND claimed_by=$2"); expect(await db(pool).failOutbox('worker-a', 'outbox:event-2', 'transport failed', '2026-08-24T00:00:10Z')).toBe(true); expect(pool.commands[1]).toContain("THEN 'DEAD' ELSE 'PENDING'"); });
});
