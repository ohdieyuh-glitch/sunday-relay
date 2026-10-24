import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createJuliusMemoryStore, JuliusRuntimeApi } from '../../src/relay/mission/julius';
import type { JuliusBootstrapRequest } from '../../src/relay/integration/julius/julius-port';
import { handleJuliusStateRoute } from '../julius-state-routes';
import {
  adoptJuliusServerRunId, createLiveJuliusBootstrapPort, isJuliusAdmissionRunId, juliusBootstrapRunId,
  JULIUS_CLIENT_RUN_ID, JULIUS_J1_NAMESPACE,
  type RunCreationStore,
} from './bootstrap';
import { compileBootstrapRequest, parseLiveMissionContract } from './mission-contract';
import type { MissionSeedStore, SeedBrainEntry } from './mission-seed';

/**
 * THE ADMISSION ID IS THE JULIUS RUN.
 *
 * `juliusBootstrapRunId` names a run `run:${idempotencyKey}`. Wonderland's game
 * polls the id it minted at admission. Those two strings differ, so a status
 * read of the admission id would miss the run that was paid for. Adoption
 * makes them one id, and a supplied id that is not that shape is refused
 * before the store is touched.
 */

const HEX = '0123456789abcdef01234567';
const SERVER = `run:${HEX}`;
/** Ruling (c): the id the game minted and polls. Version nibble 4, variant 8/9/a/b. */
const ADMISSION = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const WORKERS: JuliusBootstrapRequest['workers'] = [
  { role: 'PROMPT_ARCHITECT', integrationId: 'architect', adapterId: 'architect-adapter', independenceGroup: 'openai', requiredCapabilities: ['plan'] },
  { role: 'CODING_AGENT', integrationId: 'coder', adapterId: 'coder-adapter', independenceGroup: 'anthropic', requiredCapabilities: ['implement'] },
  { role: 'INDEPENDENT_REVIEWER', integrationId: 'reviewer', adapterId: 'reviewer-adapter', independenceGroup: 'hermes', requiredCapabilities: ['review'] },
];

const contract = (over: Record<string, unknown> = {}) => ({
  missionId: 'mission-live-1', markerNamespace: 'mission-live-1', projectId: 'prj-live', tenantId: 'tenant-live',
  objective: 'Prove the admission id is the run.', requirements: ['Keep the id.'], constraints: ['Touch only the fixture.'],
  acceptanceCriteria: [{ id: 'AC-1', text: 'The fixture test passes.', blocking: true }],
  testCommand: 'npm test', workspacePath: '/workspace/mission', limits: { spendUsd: 2, repairCycles: 1 },
  ...over,
});

const requestFor = (over: Record<string, unknown> = {}): JuliusBootstrapRequest => {
  const parsed = parseLiveMissionContract(JSON.stringify(contract(over)));
  if (!parsed.ok) throw new Error(parsed.problem);
  return compileBootstrapRequest(parsed.contract, WORKERS, 'card:adoption:1');
};

const seeds = (brain: SeedBrainEntry[], writes: string[]): MissionSeedStore => ({
  async ensureBase() { writes.push('ensureBase'); },
  async insertCriteria() { writes.push('criteria'); },
  async insertBrainEntries(_runId, _projectId, entries) { brain.push(...entries); writes.push('brain'); },
});

const memoryPort = (serverRunId: string | undefined, namespace: string | undefined, writes: string[]) => {
  const store = createJuliusMemoryStore();
  const created: Array<{ commandId: string; runId: string }> = [];
  const runs: RunCreationStore = {
    loadRun: (runId, projectId) => store.loadRun(runId, projectId),
    async createRun(input) {
      writes.push('createRun');
      created.push({ commandId: input.commandId, runId: input.runId });
      store.seedRun({
        runId: input.runId, missionId: input.missionId, projectId: input.projectId, state: 'CREATED',
        cardRevision: input.cardRevision, missionContractRevision: input.missionContractRevision,
        projectBrainRevision: input.projectBrainRevision, version: 1,
      });
      return { runId: input.runId, state: 'CREATED', version: 1 };
    },
    addTask: (input) => store.addTask(input),
    putTaskContract: (input) => store.putTaskContract(input),
    transition: async (input) => {
      const transitioned = await store.transition(input);
      return { state: transitioned.state, version: transitioned.version };
    },
  };
  const brain: SeedBrainEntry[] = [];
  const port = createLiveJuliusBootstrapPort({
    runs, seeds: seeds(brain, writes), tenantId: 'tenant-live', executionId: 'execution-live',
    ...(serverRunId === undefined ? {} : { serverRunId }),
    ...(namespace === undefined ? {} : { namespace }),
  });
  const api = new JuliusRuntimeApi({
    store, timeline: store, approvers: { mayApprove: async () => false }, clock: { now: () => '2026-10-23T00:00:00.000Z' },
  });
  return { port, api, store, created, brain };
};

describe('JULIUS_SERVER_RUN_ID becomes the Julius run id', () => {
  it('adopts a valid id even when it is not run:${idempotencyKey}, including an explicit rerun', async () => {
    const request = requestFor();
    const derived = juliusBootstrapRunId(request);
    expect(derived).not.toBe(SERVER);
    const writes: string[] = [];
    const harness = memoryPort(SERVER, request.missionId, writes);
    const outcome = await harness.port.submit(request);
    expect(outcome.accepted).toBe(true);
    if (outcome.accepted) {
    expect(outcome.runId).toBe(SERVER);
    expect(outcome.runId).not.toBe(derived);
    expect(harness.created).toEqual([{ commandId: `bootstrap:${SERVER}`, runId: SERVER }]);
    expect(writes[0]).toBe('ensureBase');
    expect(writes).toContain('createRun');
    expect(harness.brain.map((entry) => entry.entryId)).toContain(`${SERVER}:objective`);
    expect(harness.brain.some((entry) => entry.entryId.includes(derived))).toBe(false);
    }
    const rerun = await memoryPort(SERVER, undefined, []).port.submit({
      ...request, rerunIntent: 'EXPLICIT', rerunKey: 'arm-key-1',
    });
    expect(rerun.accepted).toBe(true);
    if (rerun.accepted) expect(rerun.runId).toBe(SERVER);
    const padded = adoptJuliusServerRunId({ request, serverRunId: `  ${SERVER}  ` });
    expect(padded.ok && padded.runId).toBe(SERVER);
  });

  it('refuses a mismatch before any store write, and does not echo the bad value', async () => {
    const request = requestFor();
    const bad = [
      `run:${HEX.slice(0, 23)}`, `run:${HEX}a`, `run:${HEX.toUpperCase()}`, `run:${HEX};touch /tmp/pwn`, 'run:not-an-id',
      '11111111-1111-4111-8111-111111111111',
      ADMISSION.toUpperCase(),
      'wlj_01234567-89ab-1cde-8fab-0123456789ab',
      'wlj_01234567-89ab-4cde-cfab-0123456789ab',
      `wlj_${ADMISSION}`,
      'wlj_01234567-89ab-4cde-8fab-0123456789ab\nextra',
    ];
    for (const serverRunId of bad) {
      const writes: string[] = [];
      const harness = memoryPort(serverRunId, 'mission-live-1', writes);
      const outcome = await harness.port.submit(request);
      expect(outcome.accepted, serverRunId).toBe(false);
      if (!outcome.accepted) {
      expect(outcome.reasonCode, serverRunId).toBe('server_run_id_mismatch');
      expect(outcome.safeMessage).not.toContain(serverRunId);
      expect(outcome.safeMessage).not.toContain('touch');
      expect(writes, serverRunId).toEqual([]);
      expect(await harness.store.loadRun(juliusBootstrapRunId(request), 'prj-live')).toBeNull();
      }
    }
  });

  it('refuses Wonderland J1 with a missing id, and leaves every other mission on today\'s name', async () => {
    const ordinary = requestFor();
    const derived = juliusBootstrapRunId(ordinary);
    for (const serverRunId of [undefined, '', 'none']) {
      const writes: string[] = [];
      const outcome = await memoryPort(serverRunId, ordinary.missionId, writes).port.submit(ordinary);
      expect(outcome.accepted, String(serverRunId)).toBe(true);
      if (outcome.accepted) expect(outcome.runId, String(serverRunId)).toBe(derived);
    }
    const byMission = requestFor({ missionId: JULIUS_J1_NAMESPACE });
    const byNamespace = requestFor({ markerNamespace: JULIUS_J1_NAMESPACE });
    for (const [request, namespace] of [
      [byMission, 'not-j1'],
      [byNamespace, JULIUS_J1_NAMESPACE],
    ] as const) {
      for (const serverRunId of [undefined, '', 'none']) {
        const writes: string[] = [];
        const outcome = await memoryPort(serverRunId, namespace, writes).port.submit(request);
        expect(outcome.accepted, `${request.missionId}/${namespace}/${String(serverRunId)}`).toBe(false);
        if (!outcome.accepted) expect(outcome.reasonCode).toBe('server_run_id_required');
        expect(writes).toEqual([]);
      }
    }
    const near = requestFor({ missionId: 'julius-inworld-data-10', markerNamespace: 'julius-inworld-data-10' });
    const nearOutcome = await memoryPort(undefined, near.missionId, []).port.submit(near);
    expect(nearOutcome.accepted).toBe(true);
    if (nearOutcome.accepted) expect(nearOutcome.runId).toBe(juliusBootstrapRunId(near));
  });

  it('a status lookup by the server run id returns that run, and the derived id does not', async () => {
    const request = requestFor();
    const derived = juliusBootstrapRunId(request);
    const harness = memoryPort(SERVER, request.missionId, []);
    const outcome = await harness.port.submit(request);
    expect(outcome.accepted).toBe(true);
    const identity = { tenantId: 'tenant-live', projectId: 'prj-live', actorId: 'operator', scopes: ['run:read'] as const };
    const found = await harness.api.inspectRun(identity, SERVER);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value.runId).toBe(SERVER);
      expect(found.value.state).toBe('READY');
    }
    const missed = await harness.api.inspectRun(identity, derived);
    expect(missed.ok).toBe(false);
    if (!missed.ok) expect(missed.reason).toBe('run_not_found');
    const evidence = await harness.api.inspectEvidence(identity, SERVER);
    expect(evidence.ok).toBe(true);
    const evidenceMiss = await harness.api.inspectEvidence(identity, derived);
    expect(evidenceMiss.ok).toBe(false);
    const tasks = await harness.api.inspectTasks(identity, SERVER);
    expect(tasks.ok).toBe(true);
    if (tasks.ok) {
      expect(tasks.value.map((task) => task.taskId)).toEqual([`${SERVER}:plan`, `${SERVER}:build`]);
      expect(tasks.value.every((task) => task.missionId === request.missionId)).toBe(true);
    }
    const ports = { api: harness.api, missingConfig: [] };
    const status = await handleJuliusStateRoute({
      method: 'GET', path: `/julius/runs/${SERVER}/run`, operator: true, projectId: 'prj-live', tenantId: 'tenant-live',
    }, ports);
    expect(status?.status).toBe(200);
    expect(JSON.stringify(status?.body)).toContain(`"runId":"${SERVER}"`);
    expect(JSON.stringify(status?.body)).not.toContain(derived);
    const wrong = await handleJuliusStateRoute({
      method: 'GET', path: `/julius/runs/${derived}/run`, operator: true, projectId: 'prj-live', tenantId: 'tenant-live',
    }, ports);
    expect(wrong?.status).toBe(404);
    const live = readFileSync(resolve('relay-bridge/julius-live-mission.ts'), 'utf8');
    expect(live).toContain('Run ${submitted.runId} accepted in state ${submitted.state}; driving the Julius run loop.');
    const resumedAt = live.indexOf('admission_run_already_bootstrapped');
    const driveAt = live.indexOf('assembleLiveJuliusRuntime(');
    expect(resumedAt).toBeGreaterThan(0);
    expect(driveAt).toBeGreaterThan(resumedAt);
  });

  it('stores a client-minted UUIDv4 as the Julius run id, and a second submit does not write or spend again', async () => {
    expect(JULIUS_CLIENT_RUN_ID.test(ADMISSION)).toBe(true);
    expect(isJuliusAdmissionRunId(ADMISSION)).toBe(true);
    const request = requestFor({ missionId: JULIUS_J1_NAMESPACE, markerNamespace: JULIUS_J1_NAMESPACE });
    const derived = juliusBootstrapRunId(request);
    expect(derived).not.toBe(ADMISSION);
    const writes: string[] = [];
    const harness = memoryPort(ADMISSION, JULIUS_J1_NAMESPACE, writes);
    const outcome = await harness.port.submit(request);
    expect(outcome.accepted).toBe(true);
    if (outcome.accepted) {
      expect(outcome.runId).toBe(ADMISSION);
      expect(outcome.resumed).not.toBe(true);
    }
    expect(harness.created).toEqual([{ commandId: `bootstrap:${ADMISSION}`, runId: ADMISSION }]);
    expect(writes.filter((write) => write === 'createRun')).toHaveLength(1);
    const before = writes.length;
    const replay = await harness.port.submit(request);
    expect(replay.accepted).toBe(true);
    if (replay.accepted) {
      expect(replay.runId).toBe(ADMISSION);
      expect(replay.resumed).toBe(true);
      expect(replay.state).toBe('READY');
    }
    expect(writes).toHaveLength(before);
    expect(harness.created).toHaveLength(1);
    const identity = { tenantId: 'tenant-live', projectId: 'prj-live', actorId: 'operator', scopes: ['run:read'] as const };
    const found = await harness.api.inspectRun(identity, ADMISSION);
    expect(found.ok).toBe(true);
    const missed = await harness.api.inspectRun(identity, derived);
    expect(missed.ok).toBe(false);
    const rerun = await harness.port.submit({ ...request, rerunIntent: 'EXPLICIT', rerunKey: 'arm-key-1' });
    expect(rerun.accepted).toBe(true);
    if (rerun.accepted) {
      expect(rerun.runId).toBe(ADMISSION);
      expect(rerun.resumed).toBe(true);
    }
    expect(harness.created).toHaveLength(1);
    const hexJ1 = await memoryPort(SERVER, JULIUS_J1_NAMESPACE, []).port.submit(request);
    expect(hexJ1.accepted).toBe(true);
    if (hexJ1.accepted) expect(hexJ1.runId).toBe(SERVER);
  });

  it('the live entrypoint passes JULIUS_SERVER_RUN_ID and the contract namespace, not a different env name', () => {
    const source = readFileSync(resolve('relay-bridge/julius-live-mission.ts'), 'utf8');
    expect(source).toContain('serverRunId: env.JULIUS_SERVER_RUN_ID');
    expect(source).toContain('namespace: contract.markerNamespace');
    expect(source).not.toContain('serverRunId: env.SERVER_RUN_ID');
    const bootstrap = readFileSync(resolve('relay-bridge/julius/bootstrap.ts'), 'utf8');
    const adoption = bootstrap.indexOf('return { ok: true, runId: supplied };');
    const storeWrite = bootstrap.indexOf('await deps.seeds.ensureBase(');
    expect(adoption).toBeGreaterThan(0);
    expect(adoption).toBeLessThan(storeWrite);
    expect(bootstrap.indexOf('if (!adopted.ok) return refuse(adopted.reasonCode, adopted.safeMessage);')).toBeLessThan(storeWrite);
  });
});
