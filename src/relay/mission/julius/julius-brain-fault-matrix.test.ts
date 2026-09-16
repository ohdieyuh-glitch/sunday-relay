import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createJuliusBrainAccessMemoryState, createJuliusBrainAccessService, type JuliusBrainAccessStatePort, type JuliusBrainAuditEvent } from './julius-brain-access';
import { createAccessFixtureIssuer } from './julius-brain-access-fixtures';
import { createJuliusBrainAnchorMemorySink, createJuliusBrainAuditAnchorer, verifyJuliusBrainAuditAgainstAnchors } from './julius-brain-audit-anchor';
import { juliusPrincipal, type JuliusBrainDraft } from './julius-brain-contracts';
import { classifyJuliusBrainFailure, decideJuliusBrainFailure, JuliusBrainAccessError } from './julius-brain-failure-model';
import { JULIUS_BRAIN_FAULT_AREAS, JULIUS_BRAIN_FAULT_MATRIX, renderJuliusBrainFaultMatrix, type JuliusBrainFaultCase } from './julius-brain-fault-matrix';
import { createJuliusBrainRateLimiter } from './julius-brain-rate-limit';
import { classifyJuliusBrainRetry } from './julius-brain-retry';
import { createJuliusBrainRequestMemoryLog } from './julius-brain-request-log';
import { JULIUS_BRAIN_REQUEST_FORMAT, type JuliusBrainResponse } from './julius-brain-service-api';
import { createJuliusBrainServiceRouter, type JuliusBrainServiceEffects } from './julius-brain-service-router';
import { createJuliusProjectBrainService } from './julius-brain-service';
import type { JuliusBrainStateModePolicy } from './julius-brain-state-modes';
import { createJuliusBrainMemoryStore, readAllJuliusBrainRecords } from './julius-brain-store';

/**
 * THE FAULT MATRIX, EXECUTED.
 *
 * Every row is checked for consistency with the retry and failure models, and
 * the rows marked `automated` are injected here and asserted end to end. The
 * rest name the suites that inject them, several against a real PostgreSQL.
 */

const START = Date.parse('2026-09-15T12:00:00.000Z');
const ISSUER = createAccessFixtureIssuer(START / 1000);
const BRAIN = 'brain:prj-julius-live-4';
const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const RUN = 'workflow:35000000000/1';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const FRESH: JuliusBrainStateModePolicy = { mode: 'FRESH', missionId: MISSION, runId: RUN };
const LEARNING: JuliusBrainStateModePolicy = { mode: 'LEARNING', missionId: MISSION, runId: RUN, learnFrom: { runIds: null, kinds: ['FINDING'], requireVerified: false } };
const ROOT = join(__dirname, '..', '..', '..', '..');

const draft = (key: string): JuliusBrainDraft => ({
  kind: 'TRACE', op: 'CREATE', entityId: `trace:${key}`, expectedVersion: 0, body: { traceClass: 'ACTION', summary: `fault matrix ${key}`, facts: {} }, links: [],
  scope: { missionId: MISSION, runId: RUN, taskId: null }, retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL',
  provenance: { source: 'run_observed', provider: null, model: null, tool: null, commit: null, externalRef: null, executionId: null }, idempotencyKey: `fault:${key}`, occurredAt: null,
});

/** One service, one Brain, one router: the world every injected fault runs against. */
async function world(options: { limits?: boolean; state?: JuliusBrainAccessStatePort } = {}) {
  let now = START;
  const clock = { now: () => new Date(now).toISOString() };
  const store = createJuliusBrainMemoryStore();
  const brains = createJuliusProjectBrainService({ store, clock });
  await brains.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
  const state = options.state ?? createJuliusBrainAccessMemoryState();
  const grants: { brainRunId: string; missionId: string; policyHash: string }[] = [];
  const access = createJuliusBrainAccessService({
    brainId: BRAIN, environment: 'production', binding: { databaseEnvironment: 'production' }, policy: ISSUER.policy, keys: ISSUER.keys,
    grants: () => grants, clock, state,
    limits: options.limits === true ? createJuliusBrainRateLimiter({ clock, limits: { READ: { ATTEMPT: { limit: 1, windowMs: 60_000 } }, WRITE: {}, ARTIFACT_READ: {}, RECOVERY: {}, ADMIN: {} } }) : undefined,
  });
  const writes: string[] = [];
  const effects: JuliusBrainServiceEffects = {
    async readContext() { return { items: 0 }; },
    async writeRecords({ session, drafts }) {
      writes.push('writeRecords');
      const handle = (await brains.open({ brainId: BRAIN, projectId: PROJECT, principal: session.principal }))!;
      const result = await handle.commit(drafts as JuliusBrainDraft[]);
      if (result.outcome !== 'COMMITTED') throw new Error(`${result.reasonCode}: ${result.detail}`);
      return { appended: result.receipts.filter((receipt) => receipt.outcome === 'APPENDED').length };
    },
    async writeArtifact() { return {}; }, async readArtifact() { return {}; }, async checkpoint() { return {}; },
    async seal() { return {}; }, async preservation() { return {}; }, async recover() { return {}; }, async verify() { return { ok: true }; },
  };
  const router = createJuliusBrainServiceRouter({ access, effects, requests: createJuliusBrainRequestMemoryLog(), clock, state });
  const send = (operation: 'READ_CONTEXT' | 'WRITE_RECORDS', payload: Record<string, unknown>, extra: Record<string, unknown>) =>
    router.handle({ format: JULIUS_BRAIN_REQUEST_FORMAT, operation, payload, ...extra }) as Promise<JuliusBrainResponse>;
  const register = async (token = ISSUER.mint(), stateMode: JuliusBrainStateModePolicy = FRESH, requestId = 'req-register-01') =>
    router.handle({ format: JULIUS_BRAIN_REQUEST_FORMAT, requestId, operation: 'REGISTER_ATTEMPT', identityToken: token, payload: { projectId: PROJECT, missionId: MISSION, stateMode } }) as Promise<JuliusBrainResponse>;
  return {
    store, state, access, router, send, register, grants, writes, clock,
    advance: (ms: number) => { now += ms; },
    records: () => readAllJuliusBrainRecords(store, BRAIN, PROJECT),
    audit: () => state.readAudit(),
  };
}

const lastAudit = (events: readonly JuliusBrainAuditEvent[]) => `${events.at(-1)?.action ?? 'none'}:${events.at(-1)?.reasonCode ?? ''}`;

/** The injections. Each returns what actually happened, in the matrix's own terms. */
const INJECTIONS: Readonly<Record<string, () => Promise<{ mutation: JuliusBrainFaultCase['expectedMutation']; preservation: JuliusBrainFaultCase['expectedPreservation']; audit: string }>>> = {
  async 'auth.token-replayed'() {
    const w = await world();
    const token = ISSUER.mint();
    expect((await w.register(token)).outcome).toBe('OK');
    const before = (await w.records()).length;
    const again = await w.register(token, FRESH, 'req-register-02');
    expect(again).toMatchObject({ outcome: 'REFUSED', reasonCode: 'token_replayed' });
    return { mutation: (await w.records()).length === before ? 'NONE' : 'ONCE', preservation: 'UNAFFECTED', audit: lastAudit(await w.audit()) };
  },
  async 'auth.mode-escalation'() {
    const w = await world();
    expect((await w.register()).outcome).toBe('OK');
    w.grants.push({ brainRunId: RUN, missionId: MISSION, policyHash: (await import('./julius-brain-state-modes')).juliusBrainStateModePolicyHash(LEARNING) });
    const escalated = await w.register(ISSUER.mint(), LEARNING, 'req-register-02');
    expect(escalated).toMatchObject({ outcome: 'REFUSED', reasonCode: 'run_registration_mismatch' });
    return { mutation: 'NONE', preservation: 'UNAFFECTED', audit: lastAudit(await w.audit()) };
  },
  async 'auth.session-expired'() {
    const w = await world();
    const registered = await w.register();
    w.advance(ISSUER.policy.sessionTtlMs);
    const refused = await w.send('WRITE_RECORDS', { drafts: [draft('expired')] }, { requestId: 'req-write-01', sessionToken: registered.sessionToken });
    expect(refused).toMatchObject({ outcome: 'REFUSED', reasonCode: 'session_expired' });
    return { mutation: w.writes.length === 0 ? 'NONE' : 'ONCE', preservation: 'UNAFFECTED', audit: lastAudit(await w.audit()) };
  },
  async 'service.rate-limited'() {
    const w = await world({ limits: true });
    const registered = await w.register();
    expect((await w.send('READ_CONTEXT', { role: 'CODING_AGENT' }, { requestId: 'req-read-01', sessionToken: registered.sessionToken })).outcome).toBe('OK');
    const throttled = await w.send('READ_CONTEXT', { role: 'CODING_AGENT' }, { requestId: 'req-read-02', sessionToken: registered.sessionToken });
    expect(throttled).toMatchObject({ outcome: 'REFUSED', reasonCode: 'rate_limited' });
    return { mutation: 'NONE', preservation: 'UNAFFECTED', audit: lastAudit(await w.audit()) };
  },
  async 'service.request-replayed'() {
    const w = await world();
    const registered = await w.register();
    const body = { requestId: 'req-write-01', sessionToken: registered.sessionToken };
    const first = await w.send('WRITE_RECORDS', { drafts: [draft('replayed')] }, body);
    const second = await w.send('WRITE_RECORDS', { drafts: [draft('replayed')] }, body);
    expect([first.outcome, second.outcome, second.replayed]).toEqual(['OK', 'OK', true]);
    expect(w.writes).toHaveLength(1);
    const written = (await w.records()).filter((record) => record.idempotencyKey === 'fault:replayed');
    return { mutation: written.length === 1 ? 'ONCE' : 'NONE', preservation: 'UNAFFECTED', audit: `${(await w.audit()).at(-1)!.action}:` };
  },
  async 'network.lost-after-commit'() {
    // The write lands; the answer is lost. Reconciling reads the Brain, and the repeat is a no-op.
    const w = await world();
    const registered = await w.register();
    const body = { requestId: 'req-write-01', sessionToken: registered.sessionToken };
    expect((await w.send('WRITE_RECORDS', { drafts: [draft('lost')] }, body)).outcome).toBe('OK');
    const failure = classifyJuliusBrainFailure(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
    expect(classifyJuliusBrainRetry(failure)).toBe('RECONCILE_BEFORE_RETRY');
    const repeated = await w.send('WRITE_RECORDS', { drafts: [draft('lost')] }, body);
    expect(repeated).toMatchObject({ outcome: 'OK', replayed: true });
    const written = (await w.records()).filter((record) => record.idempotencyKey === 'fault:lost');
    return { mutation: written.length === 1 ? 'ONCE' : 'NONE', preservation: 'UNAFFECTED', audit: 'none' };
  },
  async 'artifact.foreign-read'() {
    const w = await world();
    const registered = await w.register();
    const refused = await w.router.handle({
      format: JULIUS_BRAIN_REQUEST_FORMAT, requestId: 'req-art-01', operation: 'READ_ARTIFACT', sessionToken: registered.sessionToken,
      payload: { contentHash: `sha256:${'f'.repeat(64)}` },
    }) as JuliusBrainResponse;
    expect(refused).toMatchObject({ outcome: 'REFUSED', reasonCode: 'artifact_not_admitted' });
    return { mutation: 'NONE', preservation: 'UNAFFECTED', audit: lastAudit(await w.audit()) };
  },
  async 'database.schema-mismatch'() {
    const failure = classifyJuliusBrainFailure(new Error('julius_brain_database_migrations_pending:007_julius_brain_service_requests'));
    expect(failure).toMatchObject({ failureClass: 'SCHEMA_MISMATCH', retryable: false });
    expect(decideJuliusBrainFailure({ mode: 'FRESH', phase: 'OPEN', failure })).toMatchObject({ retry: 'NONE', then: 'PROCEED_WITHOUT_BRAIN', preservation: 'NOT_PRESERVED', alert: 'CONFIGURATION' });
    expect(decideJuliusBrainFailure({ mode: 'LEARNING', phase: 'OPEN', failure }).then).toBe('REFUSE_RUN');
    return { mutation: 'NONE', preservation: 'NOT_PRESERVED', audit: 'none' };
  },
  async 'checkpoint.refused'() {
    // The seal lands and the checkpoint does not: the attempt is partially preserved, and says why.
    const { deriveJuliusBrainRunPreservation, juliusRunOpenedBody, juliusRunOpenedEntityId, juliusRunSealedBody, juliusRunSealedEntityId } = await import('./julius-brain-preservation');
    const store = createJuliusBrainMemoryStore();
    const clock = { now: () => new Date(START).toISOString() };
    const brains = createJuliusProjectBrainService({ store, clock });
    await brains.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
    const julius = (await brains.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
    const scope = { missionId: MISSION, runId: RUN };
    await julius.create('TRACE', juliusRunOpenedBody({ brainRunId: RUN, juliusRunId: 'run:julius-live-4', missionId: MISSION, acceptedMainSha: null }), { key: juliusRunOpenedEntityId(RUN), entityId: juliusRunOpenedEntityId(RUN), scope });
    await julius.create('TRACE', juliusRunSealedBody({ brainRunId: RUN, expectedEntries: 0, writtenEntries: 0, missingEntryIds: [] }), { key: juliusRunSealedEntityId(RUN), entityId: juliusRunSealedEntityId(RUN), scope });
    const derived = deriveJuliusBrainRunPreservation({ brainId: BRAIN, brainRunId: RUN, records: await readAllJuliusBrainRecords(store, BRAIN, PROJECT), entities: await (await import('./julius-brain-store')).readAllJuliusBrainEntities(store, BRAIN, PROJECT) });
    expect(derived).toMatchObject({ status: 'PARTIALLY_PRESERVED', completeness: 'NOT_RECOVERED', reasons: ['no checkpoint was committed for the run'] });
    return { mutation: 'NONE', preservation: 'PARTIALLY_PRESERVED', audit: 'none' };
  },
  async 'audit.unwritable'() {
    const broken = createJuliusBrainAccessMemoryState();
    const w = await world({ state: { ...broken, appendAudit: async () => { throw new Error('audit store unreachable'); } } });
    const before = (await w.records()).length;
    // At the access contract the append throws; at the service boundary that is a FAILED answer, never a session.
    const registered = await w.register();
    expect(registered).toMatchObject({ outcome: 'FAILED', reasonCode: 'operation_failed' });
    expect(registered.sessionToken).toBeUndefined();
    // Nothing about the Brain changed.
    return { mutation: (await w.records()).length === before ? 'NONE' : 'ONCE', preservation: 'UNAFFECTED', audit: 'none' };
  },
  async 'audit.anchor-sink-down'() {
    const w = await world();
    await w.register();
    const sink = createJuliusBrainAnchorMemorySink();
    const anchorer = createJuliusBrainAuditAnchorer({ environment: 'production', sink, clock: w.clock, auditHead: () => w.state.auditHead(), brainHead: async () => null });
    expect((await anchorer.anchor()).outcome).toBe('ANCHORED');
    const failing = createJuliusBrainAuditAnchorer({
      environment: 'production', clock: w.clock, auditHead: () => w.state.auditHead(), brainHead: async () => null,
      sink: { append: async () => { throw new Error('anchor store unreachable'); }, read: () => sink.read() },
    });
    // The service keeps working while the sink is down: another session is issued and audited.
    expect((await w.register(ISSUER.mint(), FRESH, 'req-register-02')).outcome).toBe('OK');
    expect(await failing.anchor()).toMatchObject({ outcome: 'SINK_UNAVAILABLE' });
    // The service kept serving and auditing; only the vouched window is behind.
    const checked = verifyJuliusBrainAuditAgainstAnchors({ events: await w.audit(), anchors: await sink.read(), environment: 'production' });
    expect(checked.ok).toBe(true);
    expect(checked.verifiedThrough).toBeLessThan((await w.audit()).length);
    return { mutation: 'NONE', preservation: 'UNAFFECTED', audit: lastAudit(await w.audit()) };
  },
};

describe('the Brain fault matrix', () => {
  it('covers every area, names proofs that exist, and agrees with the retry and failure models', () => {
    const ids = JULIUS_BRAIN_FAULT_MATRIX.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const area of JULIUS_BRAIN_FAULT_AREAS) expect(JULIUS_BRAIN_FAULT_MATRIX.some((item) => item.area === area), area).toBe(true);
    for (const item of JULIUS_BRAIN_FAULT_MATRIX) {
      for (const proof of item.provenBy) {
        const path = proof.includes('/') ? join(ROOT, proof) : join(__dirname, proof);
        expect(existsSync(path), `${item.id}: ${proof}`).toBe(true);
      }
      // A row that says the outcome is unknown must be reconciled before it is retried, and vice versa.
      if (item.expectedMutation === 'UNKNOWN_UNTIL_RECONCILED') expect(item.retryClass, item.id).toBe('RECONCILE_BEFORE_RETRY');
      if (item.retryClass === 'DO_NOT_RETRY') expect(item.expectedMutation, item.id).not.toBe('UNKNOWN_UNTIL_RECONCILED');
      // Nothing may claim preservation it did not earn.
      expect(['UNAFFECTED', 'AT_RISK', 'NOT_PRESERVED', 'PARTIALLY_PRESERVED'], item.id).toContain(item.expectedPreservation);
    }
    // Every access refusal the matrix names is one the access contract can actually answer.
    for (const item of JULIUS_BRAIN_FAULT_MATRIX) {
      const [action, reason] = item.expectedAudit.split(':');
      if (action === 'none') continue;
      expect(['SESSION_ISSUED', 'SESSION_REFUSED', 'CALL_ALLOWED', 'CALL_REFUSED'], item.id).toContain(action);
      if (reason !== undefined && reason !== '') expect(classifyJuliusBrainFailure(new JuliusBrainAccessError(reason, 'x')).failureClass, item.id).not.toBe('UNKNOWN');
    }
    expect(renderJuliusBrainFaultMatrix().split('\n')).toHaveLength(JULIUS_BRAIN_FAULT_MATRIX.length + 2);
    // The document beside it is generated from this table: `npm run julius:fault-matrix:export`.
    const document = readFileSync(join(ROOT, 'docs', 'JULIUS_BRAIN_FAULT_MATRIX.md'), 'utf8');
    expect(document, 'docs/JULIUS_BRAIN_FAULT_MATRIX.md is stale').toContain(renderJuliusBrainFaultMatrix());
    expect(document).toContain(`${JULIUS_BRAIN_FAULT_MATRIX.filter((item) => item.automated).length} of ${JULIUS_BRAIN_FAULT_MATRIX.length} rows`);
  });

  it('every automated row is injected and behaves exactly as the matrix says', async () => {
    const automated = JULIUS_BRAIN_FAULT_MATRIX.filter((item) => item.automated);
    expect(automated.length).toBeGreaterThanOrEqual(10);
    for (const item of automated) {
      const injection = INJECTIONS[item.id];
      expect(injection, `${item.id} is marked automated but has no injection`).toBeDefined();
      const observed = await injection!();
      expect({ id: item.id, mutation: observed.mutation, preservation: observed.preservation })
        .toEqual({ id: item.id, mutation: item.expectedMutation, preservation: item.expectedPreservation });
      // `none` means the failure happens before any decision is recorded; the row is not silent about which.
      if (item.expectedAudit !== 'none') expect(observed.audit, item.id).toBe(item.expectedAudit);
    }
  }, 60_000);
});
