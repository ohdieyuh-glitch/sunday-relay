import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { createJuliusBrainAccessService } from '../src/relay/mission/julius/julius-brain-access';
import { createAccessFixtureIssuer } from '../src/relay/mission/julius/julius-brain-access-fixtures';
import { juliusPrincipal, type JuliusBrainDraft } from '../src/relay/mission/julius/julius-brain-contracts';
import { createJuliusBrainRateLimiter } from '../src/relay/mission/julius/julius-brain-rate-limit';
import { juliusBrainRequestKey } from '../src/relay/mission/julius/julius-brain-request-log';
import { JULIUS_BRAIN_REQUEST_FORMAT, type JuliusBrainRequest } from '../src/relay/mission/julius/julius-brain-service-api';
import { createJuliusBrainServiceRouter, type JuliusBrainServiceEffects } from '../src/relay/mission/julius/julius-brain-service-router';
import { createJuliusProjectBrainService } from '../src/relay/mission/julius/julius-brain-service';
import type { JuliusBrainStateModePolicy } from '../src/relay/mission/julius/julius-brain-state-modes';
import { readAllJuliusBrainRecords } from '../src/relay/mission/julius/julius-brain-store';
import { JuliusBrainAccessPostgresState } from '../src/relay/persistence/julius-brain-access-postgres';
import { migrateJuliusBrainDatabase } from '../src/relay/persistence/julius-brain-database';
import { JuliusBrainPostgresStore } from '../src/relay/persistence/julius-brain-postgres';
import { juliusBrainRoleGrants } from '../src/relay/persistence/julius-brain-roles';
import { JuliusBrainRateLimitPostgresStore, JuliusBrainRequestPostgresLog } from '../src/relay/persistence/julius-brain-service-postgres';

/**
 * THE SERVICE'S OWN DURABILITY, ON A REAL POSTGRESQL.
 *
 * A request id answered once stays answered across a service restart, a cold
 * database connection and two processes racing; a different request under that
 * id is refused; limits hold across processes; and the service role cannot
 * rewrite an answer. `JULIUS_REAL_POSTGRES=1` with `DATABASE_URL` naming a role
 * that may create databases and roles; todo otherwise.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const START = Date.parse('2026-09-15T12:00:00.000Z');
const ISSUER = createAccessFixtureIssuer(START / 1000);
const BRAIN = 'brain:prj-julius-live-4';
const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const RUN = 'workflow:35000000000/1';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const FRESH: JuliusBrainStateModePolicy = { mode: 'FRESH', missionId: MISSION, runId: RUN };

const draft = (key: string): JuliusBrainDraft => ({
  kind: 'TRACE', op: 'CREATE', entityId: `trace:${key}`, expectedVersion: 0, body: { traceClass: 'ACTION', summary: `durable service proof ${key}`, facts: {} }, links: [],
  scope: { missionId: MISSION, runId: RUN, taskId: null }, retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL',
  provenance: { source: 'run_observed', provider: null, model: null, tool: null, commit: null, externalRef: null, executionId: null }, idempotencyKey: `durable:${key}`, occurredAt: null,
});

suite('the Brain service on a real PostgreSQL', () => {
  it('a request id keeps its answer across restarts, cold connections and racing processes; limits hold across them; and the service role cannot rewrite an answer', async () => {
    const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const database = `jbsvc${suffix}`;
    const serviceRole = `jbsvcrole${suffix}`;
    const secret = randomUUID();
    const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const urlFor = (user: string | null) => {
      const url = new URL(process.env.DATABASE_URL!);
      url.pathname = `/${database}`;
      if (user !== null) { url.username = user; url.password = secret; }
      return url.toString();
    };
    await admin.query(`CREATE DATABASE ${database}`);
    const owner = new Pool({ connectionString: urlFor(null), max: 2 });
    const pools: Pool[] = [];
    const servicePool = () => { const pool = new Pool({ connectionString: urlFor(serviceRole), max: 4 }); pool.on('error', () => undefined); pools.push(pool); return pool; };
    let now = START;
    const clock = { now: () => new Date(now).toISOString() };
    const effectCalls: string[] = [];
    try {
      await migrateJuliusBrainDatabase(owner, { environment: 'test' });
      await createJuliusProjectBrainService({ store: new JuliusBrainPostgresStore(owner), clock }).initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
      await admin.query(`CREATE ROLE ${serviceRole} LOGIN PASSWORD '${secret}'`);
      for (const grant of juliusBrainRoleGrants({ database, service: serviceRole, reader: serviceRole })) await owner.query(grant);

      /** One service process: its own pool, its own router, the same durable state. */
      const processOf = (options: { slow?: () => Promise<void> } = {}) => {
        const pool = servicePool();
        const store = new JuliusBrainPostgresStore(pool);
        const access = createJuliusBrainAccessService({
          brainId: BRAIN, environment: 'test', binding: { databaseEnvironment: 'test' },
          policy: { ...ISSUER.policy, environments: { 'julius-paid': 'test' } }, keys: ISSUER.keys, grants: () => [], clock,
          state: new JuliusBrainAccessPostgresState(pool),
          limits: createJuliusBrainRateLimiter({ clock, store: new JuliusBrainRateLimitPostgresStore(pool), limits: { READ: { ATTEMPT: { limit: 2, windowMs: 60_000 } }, WRITE: { ATTEMPT: { limit: 50, windowMs: 60_000 } }, ARTIFACT_READ: {}, RECOVERY: {}, ADMIN: {} } }),
        });
        const effects: JuliusBrainServiceEffects = {
          async readContext() { effectCalls.push('readContext'); return { items: 0 }; },
          async writeRecords({ session, drafts }) {
            effectCalls.push('writeRecords');
            if (options.slow !== undefined) await options.slow();
            const handle = (await createJuliusProjectBrainService({ store, clock }).open({ brainId: BRAIN, projectId: PROJECT, principal: session.principal }))!;
            const result = await handle.commit(drafts as JuliusBrainDraft[]);
            if (result.outcome !== 'COMMITTED') throw new Error(`${result.reasonCode}: ${result.detail}`);
            return { appended: result.receipts.filter((receipt) => receipt.outcome === 'APPENDED').length };
          },
          async writeArtifact() { return {}; }, async readArtifact() { return {}; }, async checkpoint() { return {}; },
          async seal() { return {}; }, async preservation() { return {}; }, async recover() { return {}; }, async verify() { return { ok: true }; },
        };
        return createJuliusBrainServiceRouter({ access, effects, requests: new JuliusBrainRequestPostgresLog(pool), clock });
      };

      const first = processOf();
      const registered = await first.handle({ format: JULIUS_BRAIN_REQUEST_FORMAT, requestId: 'req-register-01', operation: 'REGISTER_ATTEMPT', identityToken: ISSUER.mint(), payload: { projectId: PROJECT, missionId: MISSION, stateMode: FRESH } });
      if (registered.outcome !== 'OK') throw new Error(`${registered.reasonCode}: ${registered.detail}`);
      const sessionToken = registered.sessionToken!;
      const write = (requestId: string, key: string): JuliusBrainRequest => ({ format: JULIUS_BRAIN_REQUEST_FORMAT, requestId, operation: 'WRITE_RECORDS', sessionToken, payload: { drafts: [draft(key)] } });

      expect(await first.handle(write('req-write-01', 'one'))).toMatchObject({ outcome: 'OK', result: { appended: 1 } });
      // A second process, a cold pool: the same request id answers what it answered, and does nothing again.
      const second = processOf();
      expect(await second.handle(write('req-write-01', 'one'))).toMatchObject({ outcome: 'OK', replayed: true, result: { appended: 1 } });
      expect(await second.handle(write('req-write-01', 'other'))).toMatchObject({ outcome: 'REFUSED', reasonCode: 'request_id_conflict' });
      expect(effectCalls.filter((call) => call === 'writeRecords')).toHaveLength(1);

      // Two processes racing one request id: one does the work, the other is told it is in flight.
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const slow = processOf({ slow: () => gate });
      const fast = processOf();
      const racing = Promise.all([slow.handle(write('req-write-02', 'race')), fast.handle(write('req-write-02', 'race'))]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      release();
      const raced = await racing;
      expect(raced.map((response) => response.outcome).sort()).toEqual(['OK', 'REFUSED']);
      expect(raced.find((response) => response.outcome === 'REFUSED')).toMatchObject({ reasonCode: 'request_in_flight' });
      expect((await readAllJuliusBrainRecords(new JuliusBrainPostgresStore(owner), BRAIN, PROJECT)).filter((record) => record.idempotencyKey === 'durable:race')).toHaveLength(1);

      // Limits are the database's, so a second process cannot hand out a third read.
      const reads = { format: JULIUS_BRAIN_REQUEST_FORMAT, requestId: 'req-read-01', operation: 'READ_CONTEXT' as const, sessionToken, payload: { role: 'CODING_AGENT' } };
      expect((await first.handle(reads)).outcome).toBe('OK');
      expect((await second.handle(reads)).outcome).toBe('OK');
      expect(await processOf().handle(reads)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'rate_limited' });

      // The service role may withdraw a claim that has no answer, and may not touch one that has.
      const log = new JuliusBrainRequestPostgresLog(servicePool());
      const answered = juliusBrainRequestKey(RUN, 'req-write-01');
      await log.abandon({ key: answered });
      expect(await log.read(answered)).toMatchObject({ requestDigest: expect.any(String), response: expect.objectContaining({ outcome: 'OK' }) });
      const svc = servicePool();
      await expect(svc.query(`DELETE FROM julius_brain.service_requests WHERE key = $1`, [answered])).rejects.toThrow(/julius_brain_immutable: an answered request is not deleted/);
      await expect(svc.query(`UPDATE julius_brain.service_requests SET response = '{"outcome":"OK"}'::jsonb WHERE key = $1`, [answered])).rejects.toThrow(/julius_brain_immutable: a request that was answered keeps its answer/);
      await expect(svc.query('TRUNCATE julius_brain.service_requests')).rejects.toThrow(/permission denied|julius_brain_immutable/);

      // A session the service never issued is refused before any of this is reached.
      expect(await first.handle({ ...write('req-write-03', 'forged'), sessionToken: 'not-a-session' })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'session_unknown' });
    } finally {
      await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
      await owner.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${serviceRole}`).catch(() => undefined);
      await admin.end();
    }
  }, 120_000);
});
