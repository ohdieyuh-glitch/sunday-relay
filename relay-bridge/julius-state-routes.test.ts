import { describe, expect, it } from 'vitest';

import { JuliusRuntimeApi } from '../src/relay/mission/julius';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from '../src/relay/mission/julius/julius-runtime-fixtures';
import type { JuliusRunRow } from '../src/relay/mission/julius/julius-runtime-ports';
import { handleJuliusStateRoute, isJuliusStateRoute, type JuliusStateRoutePorts } from './julius-state-routes';

/**
 * THE ROUTE FAMILY, HELD TO THE THREE THINGS IT PROMISES.
 *
 * It is a mapping and nothing more: a path to an API method, a refusal to a
 * status. So these cases are about the mapping — that it refuses before it
 * reads, that it says WHY it cannot read, and that what it serves is the API's
 * own answer for a real mission and not a shape invented for the wire.
 *
 * The API here is the in-memory one over a mission the harness actually ran,
 * because a route test against a hand-built view would prove the route and
 * nothing about Julius.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'openai', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'anthropic', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});
const RUN: JuliusRunRow = {
  runId: 'run:abc', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');
const OK = { kind: 'succeed' as const, usdMicros: null };

async function ranMission(): Promise<JuliusHarness> {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [{ ...OK, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan.' }] }] },
      { worker: CODER, script: [{ kind: 'succeed', usdMicros: 608_861, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Green.' }] }] },
      { worker: REVIEWER, script: [{ ...OK, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'Fine.' }] }, { ...OK, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'Fine.' }] }] },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1 }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 1 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: RUN.runId, projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask(RUN.runId, task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask(RUN.runId, task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  for (let tick = 0; tick < 20; tick += 1) {
    if ((await harness.loop.tick({ projectId: 'prj-1' })).claimed === 0) break;
  }
  return harness;
}

const portsOver = (harness: JuliusHarness): JuliusStateRoutePorts => ({
  api: new JuliusRuntimeApi({
    store: harness.store as never, timeline: harness.store as never,
    approvers: { mayApprove: async () => false }, clock: harness.clock,
  }),
  missingConfig: [],
});

const get = (path: string, over: Partial<Parameters<typeof handleJuliusStateRoute>[0]> = {}) => ({
  method: 'GET', path, operator: true, projectId: 'prj-1', tenantId: 'tenant', ...over,
});

describe('a percent-encoded run id', () => {
  it('reaches the same run as the raw one — a standards-correct client may encode the colon', async () => {
    const harness = await ranMission();
    const raw = await handleJuliusStateRoute(get('/julius/runs/run:abc/run'), portsOver(harness));
    const encoded = await handleJuliusStateRoute(get('/julius/runs/run%3Aabc/run'), portsOver(harness));
    expect(raw?.status).toBe(200);
    expect(encoded?.status).toBe(200);
    expect(encoded?.body).toEqual(raw?.body);
    const slots = await handleJuliusStateRoute(get('/julius/runs/run%3Aabc/slots'), portsOver(harness));
    expect(slots?.status).toBe(200);
  });

  it('a malformed escape is a run that cannot be named, not a route that does not exist', async () => {
    const harness = await ranMission();
    const result = await handleJuliusStateRoute(get('/julius/runs/run%E0%A4%A/run'), portsOver(harness));
    expect(result?.status).toBe(404);
    expect((result?.body as { error: { kind: string } }).error.kind).toBe('run_not_found');
  });
});

describe('the Julius state routes', () => {
  it('claims exactly the /julius family', () => {
    expect(isJuliusStateRoute('/julius')).toBe(true);
    expect(isJuliusStateRoute('/julius/runs/run:abc/slots')).toBe(true);
    expect(isJuliusStateRoute('/juliusx')).toBe(false);
    expect(isJuliusStateRoute('/reviewer/status')).toBe(false);
  });

  it('refuses before it reads: no operator, no read', async () => {
    const harness = await ranMission();
    const result = await handleJuliusStateRoute(get('/julius/runs/run:abc/slots', { operator: false }), portsOver(harness));
    expect(result?.status).toBe(401);
    expect((result?.body as { error: { kind: string } }).error.kind).toBe('operator_required');
  });

  /**
   * THE REFUSAL THAT MATTERS MOST. A bridge with no database must say so — never
   * answer an empty run, because "nothing is reachable from this process" and
   * "this mission has done nothing" are different facts.
   */
  it('names the missing configuration when no durable state is reachable, rather than serving an empty run', async () => {
    const result = await handleJuliusStateRoute(get('/julius/runs/run:abc/run'), { api: null, missingConfig: ['DATABASE_URL'] });
    expect(result?.status).toBe(503);
    const body = result?.body as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe('julius_state_unavailable');
    expect(body.error.message).toContain('DATABASE_URL');
    expect(body.error.message).toContain('not an empty mission');
  });

  it('is read-only', async () => {
    const harness = await ranMission();
    const result = await handleJuliusStateRoute(get('/julius/runs/run:abc/run', { method: 'POST' }), portsOver(harness));
    expect(result?.status).toBe(405);
  });

  it('serves the API’s own slot view for a mission that really ran', async () => {
    const harness = await ranMission();
    const result = await handleJuliusStateRoute(get('/julius/runs/run:abc/slots'), portsOver(harness));
    expect(result?.status).toBe(200);
    const slots = (result?.body as { data: readonly { role: string; state: string; knownUsdMicros: number; costComplete: boolean; servedModel: string | null }[] }).data;
    expect(slots.map((slot) => slot.role)).toEqual(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']);
    const coder = slots.find((slot) => slot.role === 'CODING_AGENT')!;
    expect(coder.state).toBe('IDLE');
    expect(coder.knownUsdMicros).toBe(608_861);
    expect(coder.costComplete).toBe(true);
    // Silence is null on the wire, exactly as it is in the runtime.
    expect(coder.servedModel).toBeNull();
    const reviewer = slots.find((slot) => slot.role === 'INDEPENDENT_REVIEWER')!;
    expect(reviewer.costComplete, 'an unpriced slot is a floor on the wire too').toBe(false);
  });

  it('serves every other view the contract lists, from the same mission', async () => {
    const harness = await ranMission();
    for (const view of ['run', 'tasks', 'evidence', 'verification', 'timeline']) {
      const result = await handleJuliusStateRoute(get(`/julius/runs/run:abc/${view}`), portsOver(harness));
      expect(result?.status, view).toBe(200);
      expect((result?.body as { data: unknown }).data, view).toBeTruthy();
    }
    const run = await handleJuliusStateRoute(get('/julius/runs/run:abc/run'), portsOver(harness));
    expect((run?.body as { data: { state: string } }).data.state).toBe('COMPLETED');
  });

  it('answers 404 for a run it cannot see, and the same 404 for another project’s run', async () => {
    const harness = await ranMission();
    const missing = await handleJuliusStateRoute(get('/julius/runs/run:nope/run'), portsOver(harness));
    expect(missing?.status).toBe(404);
    // A run that exists but belongs to another project must be indistinguishable
    // from one that does not exist, or the route enumerates other tenants' ids.
    const foreign = await handleJuliusStateRoute(get('/julius/runs/run:abc/run', { projectId: 'prj-other' }), portsOver(harness));
    expect(foreign?.status).toBe(404);
  });

  it('refuses a view it does not serve, and a shape it does not serve', async () => {
    const harness = await ranMission();
    expect((await handleJuliusStateRoute(get('/julius/runs/run:abc/brain'), portsOver(harness)))?.status).toBe(404);
    expect((await handleJuliusStateRoute(get('/julius/runs'), portsOver(harness)))?.status).toBe(404);
    expect((await handleJuliusStateRoute(get('/julius/runs/../../etc/run'), portsOver(harness)))?.status).toBe(404);
  });

  it('serves nothing for a path outside the family', async () => {
    const harness = await ranMission();
    expect(await handleJuliusStateRoute(get('/reviewer/status'), portsOver(harness))).toBeNull();
  });
});
