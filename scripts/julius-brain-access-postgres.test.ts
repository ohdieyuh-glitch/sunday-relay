import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  createJuliusBrainAccessService,
  verifyJuliusBrainAuditChain,
  type JuliusBrainStateModeGrant,
} from '../src/relay/mission/julius/julius-brain-access';
import { createAccessFixtureIssuer } from '../src/relay/mission/julius/julius-brain-access-fixtures';
import { juliusBrainStateModePolicyHash, type JuliusBrainStateModePolicy } from '../src/relay/mission/julius/julius-brain-state-modes';
import { JuliusBrainAccessPostgresState } from '../src/relay/persistence/julius-brain-access-postgres';
import { assertJuliusBrainDatabase, migrateJuliusBrainDatabase } from '../src/relay/persistence/julius-brain-database';
import { juliusBrainRoleGrants } from '../src/relay/persistence/julius-brain-roles';

/**
 * THE BRAIN SERVICE'S ACCESS STATE ON A REAL POSTGRESQL, AS THE SERVICE ROLE.
 *
 * Replay protection, attempt registrations, sessions and the audit survive a
 * service restart; concurrent service processes cannot both exchange one token
 * or both register one attempt; the service role cannot rewrite any of it; an
 * owner who does is exposed by the audit chain; no token material is stored.
 * `JULIUS_REAL_POSTGRES=1` with `DATABASE_URL` naming a role that may create
 * databases and roles; todo otherwise.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const START = Date.parse('2026-09-15T12:00:00.000Z') / 1000;
const ISSUER = createAccessFixtureIssuer(START);
const MISSION = 'mission:julius-live-4';
const PROJECT = 'prj-julius-live-4';
const RUN = 'workflow:35000000000/1';
const fresh = (runId = RUN): JuliusBrainStateModePolicy => ({ mode: 'FRESH', missionId: MISSION, runId });
const learning = (runId = RUN): JuliusBrainStateModePolicy => ({ mode: 'LEARNING', missionId: MISSION, runId, learnFrom: { runIds: ['workflow:34739303313/1'], kinds: ['FINDING'], requireVerified: false } });

suite('Brain service access state on a real PostgreSQL', () => {
  it('survives restarts, holds under concurrent service processes, refuses the service role any rewrite, exposes an owner who rewrites, and stores no token', async () => {
    const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const database = `jbaccess${suffix}`;
    const service = `jbaccsvc${suffix}`;
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
    const servicePool = () => { const pool = new Pool({ connectionString: urlFor(service), max: 4 }); pool.on('error', () => undefined); pools.push(pool); return pool; };
    try {
      await migrateJuliusBrainDatabase(owner, { environment: 'test' });
      await admin.query(`CREATE ROLE ${service} LOGIN PASSWORD '${secret}'`);
      for (const grant of juliusBrainRoleGrants({ database, service, reader: service })) await owner.query(grant);

      const grants: JuliusBrainStateModeGrant[] = [];
      let now = START * 1000;
      /** One service process: its own pool, verified binding, durable state. */
      const processOf = async () => {
        const pool = servicePool();
        const identity = await assertJuliusBrainDatabase(pool, { environment: 'test' });
        return createJuliusBrainAccessService({
          brainId: 'brain:prj-julius-live-4', environment: 'test', binding: { databaseEnvironment: identity.environment },
          policy: { ...ISSUER.policy, environments: { 'julius-paid': 'test' } }, keys: ISSUER.keys, grants: () => grants,
          clock: { now: () => new Date(now).toISOString() }, state: new JuliusBrainAccessPostgresState(pool),
        });
      };
      const state = new JuliusBrainAccessPostgresState(servicePool());

      // A production service composed over this (test) database refuses to exist.
      const identity = await assertJuliusBrainDatabase(servicePool(), { environment: 'test' });
      expect(() => createJuliusBrainAccessService({ brainId: 'b', environment: 'production', binding: { databaseEnvironment: identity.environment }, policy: ISSUER.policy, keys: ISSUER.keys, grants: () => [], clock: { now: () => '' }, state })).toThrow('julius_brain_access_binding_mismatch');
      await expect(assertJuliusBrainDatabase(servicePool(), { environment: 'production' })).rejects.toThrow();

      // Restart: a session, a spent token and a FRESH registration outlive the process that made them.
      const first = await processOf();
      const token = ISSUER.mint();
      const issued = await first.issueSession({ token, projectId: PROJECT, missionId: MISSION, stateMode: fresh() });
      if (!issued.ok) throw new Error(issued.detail);
      const second = await processOf();
      expect(await second.authorize({ sessionToken: issued.sessionToken, call: { type: 'READ_CONTEXT' } })).toMatchObject({ ok: true, session: { brainRunId: RUN, sessionId: issued.session.sessionId } });
      expect(await second.issueSession({ token, projectId: PROJECT, missionId: MISSION, stateMode: fresh() })).toMatchObject({ ok: false, reasonCode: 'token_replayed' });
      grants.push({ brainRunId: RUN, missionId: MISSION, policyHash: juliusBrainStateModePolicyHash(learning()) });
      expect(await second.issueSession({ token: ISSUER.mint(), projectId: PROJECT, missionId: MISSION, stateMode: learning() })).toMatchObject({ ok: false, reasonCode: 'run_registration_mismatch' });
      now += ISSUER.policy.sessionTtlMs;
      expect(await (await processOf()).authorize({ sessionToken: issued.sessionToken, call: { type: 'READ_CONTEXT' } })).toMatchObject({ ok: false, reasonCode: 'session_expired' });
      now = START * 1000;

      // Concurrent processes: one token exchanged four times at once issues once; one attempt registered two ways at once registers once.
      const processes = await Promise.all([processOf(), processOf(), processOf(), processOf()]);
      const shared = ISSUER.mint({ run_id: '35000000010' });
      const raced = await Promise.all(processes.map((p) => p.issueSession({ token: shared, projectId: PROJECT, missionId: MISSION, stateMode: fresh('workflow:35000000010/1') })));
      expect(raced.map((result) => (result.ok ? 'issued' : result.reasonCode)).sort()).toEqual(['issued', 'token_replayed', 'token_replayed', 'token_replayed']);
      grants.push({ brainRunId: 'workflow:35000000011/1', missionId: MISSION, policyHash: juliusBrainStateModePolicyHash(learning('workflow:35000000011/1')) });
      const modes = await Promise.all([
        processes[0]!.issueSession({ token: ISSUER.mint({ run_id: '35000000011' }), projectId: PROJECT, missionId: MISSION, stateMode: fresh('workflow:35000000011/1') }),
        processes[1]!.issueSession({ token: ISSUER.mint({ run_id: '35000000011' }), projectId: PROJECT, missionId: MISSION, stateMode: learning('workflow:35000000011/1') }),
      ]);
      expect(modes.map((result) => (result.ok ? 'issued' : result.reasonCode)).sort()).toEqual(['issued', 'run_registration_mismatch']);

      // The audit: every decision of every process, one unbroken chain.
      const audit = await state.readAudit();
      expect(audit.length).toBe(11);
      expect(audit.map((event) => event.sequence)).toEqual(audit.map((_, i) => i + 1));
      expect(verifyJuliusBrainAuditChain(audit)).toEqual({ ok: true, problems: [] });
      const anchor = { sequence: audit.at(-1)!.sequence, hash: audit.at(-1)!.hash };

      // No token material anywhere in the access state.
      const stored = JSON.stringify((await owner.query("SELECT (SELECT json_agg(t) FROM julius_brain.access_token_claims t) AS claims, (SELECT json_agg(t) FROM julius_brain.access_registrations t) AS registrations, (SELECT json_agg(t) FROM julius_brain.access_sessions t) AS sessions, (SELECT json_agg(t) FROM julius_brain.access_audit t) AS audit")).rows[0]);
      for (const secretPart of [issued.sessionToken, token.split('.')[2]!, token.split('.')[1]!, shared.split('.')[2]!]) expect(stored).not.toContain(secretPart);
      expect(stored).not.toMatch(/jti-\d/);

      // The service role cannot rewrite access state.
      const svc = servicePool();
      for (const table of ['access_audit', 'access_registrations', 'access_token_claims', 'access_sessions']) {
        await expect(svc.query(`DELETE FROM julius_brain.${table}`)).rejects.toThrow(/permission denied/);
        await expect(svc.query(`TRUNCATE julius_brain.${table}`)).rejects.toThrow(/permission denied/);
      }
      await expect(svc.query("UPDATE julius_brain.access_registrations SET policy_hash = 'x'")).rejects.toThrow(/permission denied/);
      await expect(svc.query('ALTER TABLE julius_brain.access_audit DISABLE TRIGGER access_audit_immutable')).rejects.toThrow(/must be owner/);
      // Nor can the owner, while the guard stands.
      await expect(owner.query("UPDATE julius_brain.access_audit SET event = jsonb_set(event, '{reasonCode}', 'null') WHERE sequence = 2")).rejects.toThrow(/julius_brain_immutable/);

      // An owner who takes the guard down and rewrites a refusal as an allowance, then deletes the newest decision, is exposed.
      await owner.query('ALTER TABLE julius_brain.access_audit DISABLE TRIGGER access_audit_immutable');
      await owner.query(`UPDATE julius_brain.access_audit SET event = jsonb_set(jsonb_set(event, '{action}', '"CALL_ALLOWED"'), '{reasonCode}', 'null') WHERE sequence = (SELECT min(sequence) FROM julius_brain.access_audit WHERE event->>'action' = 'SESSION_REFUSED')`);
      await owner.query('DELETE FROM julius_brain.access_audit WHERE sequence = (SELECT max(sequence) FROM julius_brain.access_audit)');
      await owner.query('ALTER TABLE julius_brain.access_audit ENABLE TRIGGER access_audit_immutable');
      const tampered = await state.readAudit();
      expect(verifyJuliusBrainAuditChain(tampered).ok).toBe(false);
      expect(verifyJuliusBrainAuditChain(tampered, anchor).problems[0]).toMatch(/its content does not match its hash/);
    } finally {
      await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
      await owner.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${service}`).catch(() => undefined);
      await admin.end();
    }
  }, 120_000);
});
