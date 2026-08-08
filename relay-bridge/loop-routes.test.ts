import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOOP_ENGINE_ENV, handleLoopRoute, loopEngineEnabled, type LoopRouteRequest } from './loop-routes';
import { CRON_ENABLED_ENV } from './cron-routes';
import { CRON_SCHEDULER_ENABLED_ENV } from './cron-scheduler';
import { createLoopService, type LoopService } from './loop-service';
import { createFakeLoopAgent, loopDigest, readLoopRun, type FakeLoopAgentStep } from '../src/relay/mission/loop/runtime';
import { parseSlashCommand } from '../src/relay/mission/loop/loop-command-parser';
import { LOCK_FILE } from '../src/relay/persistence/lock';

/**
 * STAGE 2 — THE SERVER-TO-RUNTIME PROOF.
 *
 * The whole path, offline: a typed command, a compiled draft, an explicit
 * confirmation, an authenticated route, a server-side feature flag, a
 * deterministic authorizer, the REAL file lock, the Node journal, and a
 * scripted agent that refuses to be believed until it produces attested
 * evidence.
 *
 * Nothing here reaches a network, a provider, a credential or a real clock.
 */

const T0 = '2026-08-03T12:00:00.000Z';
const COMMAND = '/loop coding Verify the fixture until completion evidence is attested.';
const TOKEN = 'test-operator-token';

let root: string;
let service: LoopService;

const ENABLED: NodeJS.ProcessEnv = { [LOOP_ENGINE_ENV]: '1', RELAY_BRIDGE_API_TOKEN: TOKEN };

function makeService(
  script: readonly FakeLoopAgentStep[],
  maxIterationsPerCall?: number,
): LoopService {
  let tick = 0;
  const counters = new Map<string, number>();
  return createLoopService({
    root,
    maxIterationsPerCall,
    agent: createFakeLoopAgent(script, { now: () => T0, model: 'fixture-model' }),
    now: () => new Date(Date.parse(T0) + (tick += 1) * 1000).toISOString(),
    newId: (kind) => {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${kind}_${next}`;
    },
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-loop-routes-'));
  service = makeService([
    { kind: 'completion_claim_only' },
    { kind: 'observed_evidence', evidenceRefs: ['evd_seen'] },
    { kind: 'attested_evidence', evidenceRefs: ['evd_attested'] },
  ]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** One request through the real handler. Operator unless told otherwise. */
function call(
  method: string,
  path: string,
  body: unknown = undefined,
  overrides: Partial<LoopRouteRequest> = {},
) {
  const request: LoopRouteRequest = {
    method,
    path,
    authorization: `Bearer ${TOKEN}`,
    body,
    env: ENABLED,
    now: T0,
    ...overrides,
  };
  return handleLoopRoute(request, overrides.body === undefined && service === null ? null : service);
}

const CONFIRM_BODY = {
  projectId: 'prj_proof',
  loopId: 'lpe_proof',
  contractRef: 'loop-contract-proof',
  contractVersion: 1,
  contractBindingDigest: 'binding-proof',
  confirmationRequestId: 'cfm_1',
  objective: 'Verify the fixture until completion evidence is attested.',
  targetExpression: 'coding',
  workspaceId: 'wsp_proof',
  authorized: true,
};

/* ==================================================== the feature flag === */

describe('the Loop engine flag is server-authoritative and defaults off', () => {
  it('is off unless the server says exactly 1', () => {
    expect(loopEngineEnabled({})).toBe(false);
    for (const value of ['', '0', 'true', 'TRUE', 'yes', 'on', ' 1', '1 ']) {
      expect(loopEngineEnabled({ [LOOP_ENGINE_ENV]: value }), `"${value}" must not enable`).toBe(false);
    }
    expect(loopEngineEnabled({ [LOOP_ENGINE_ENV]: '1' })).toBe(true);
  });

  it('refuses every operation when disabled, and creates nothing', async () => {
    const result = await handleLoopRoute({
      method: 'POST', path: '/loop/confirm', authorization: `Bearer ${TOKEN}`,
      body: CONFIRM_BODY, env: { RELAY_BRIDGE_API_TOKEN: TOKEN }, now: T0,
    }, service);
    expect(result?.status).toBe(403);
    expect((result?.body as { kind: string }).kind).toBe('loop_engine_disabled');
    expect(existsSync(join(root, 'loops'))).toBe(true);
    // Nothing was written for this Loop.
    expect(service.store.runIdsForLoop('lpe_proof')).toBeNull();
  });

  it('reports the capability without the browser being able to assert it', async () => {
    const on = await call('GET', '/loop/capability');
    expect((on?.body as { data: { loopEngineEnabled: boolean } }).data.loopEngineEnabled).toBe(true);
    const off = await handleLoopRoute({
      method: 'GET', path: '/loop/capability', authorization: `Bearer ${TOKEN}`,
      body: undefined, env: { RELAY_BRIDGE_API_TOKEN: TOKEN }, now: T0,
    }, service);
    const data = (off?.body as { data: Record<string, unknown> }).data;
    expect(data.loopEngineEnabled).toBe(false);
    // And it tells a surface what Stage 2 can actually execute.
    expect(data.multiRoleSupported).toBe(false);
    expect(data.supportedRoles).toEqual(['coding_agent']);
  });

  it('reports cronScheduled from the scheduler that exists, not from the flags', async () => {
    const read = async (
      env: NodeJS.ProcessEnv, cronSchedulerRunning?: boolean,
    ): Promise<Record<string, unknown>> => {
      const result = await handleLoopRoute({
        method: 'GET', path: '/loop/capability', authorization: `Bearer ${TOKEN}`,
        body: undefined, env, now: T0, cronSchedulerRunning,
      }, service);
      return (result?.body as { data: Record<string, unknown> }).data;
    };

    // The tick ENDPOINT existing is not a scheduler. Cron on, no timer built.
    const endpointOnly = await read({ ...ENABLED, [CRON_ENABLED_ENV]: '1' }, false);
    expect(endpointOnly.cronSupported).toBe(true);
    expect(endpointOnly.cronScheduled).toBe(false);

    // A scheduler that was actually constructed is the only thing that says yes.
    const scheduled = await read({ ...ENABLED, [CRON_ENABLED_ENV]: '1' }, true);
    expect(scheduled.cronScheduled).toBe(true);

    // THE CASE REVIEW FOUND. Both flags set, but no state root mounted, so
    // `main()` builds no scheduler — an absent volume is deliberately not
    // fatal. The flags say yes and the deployment has no timer; the field must
    // follow the timer, because its whole purpose is to be believed without
    // checking the deployment.
    const flagsWithoutVolume = await read({
      ...ENABLED, [CRON_ENABLED_ENV]: '1', [CRON_SCHEDULER_ENABLED_ENV]: '1',
    }, false);
    expect(flagsWithoutVolume.cronSupported).toBe(true);
    expect(flagsWithoutVolume.cronScheduled).toBe(false);

    // A host that never says anything gets the safe answer.
    const unstated = await read({ ...ENABLED, [CRON_ENABLED_ENV]: '1' });
    expect(unstated.cronScheduled).toBe(false);

    // AND cronScheduled STILL IMPLIES cronSupported. The two are read at
    // different moments — this one from the env now, the other from a
    // scheduler built at boot — so without conjoining them a surface could be
    // told "nothing may tick, and something ticks on a schedule".
    const timerWithoutCron = await read({ ...ENABLED }, true);
    expect(timerWithoutCron.cronSupported).toBe(false);
    expect(timerWithoutCron.cronScheduled).toBe(false);
  });
});

/* ====================================================== authentication === */

describe('authentication and authorization', () => {
  it('refuses an unauthenticated call', async () => {
    const result = await handleLoopRoute({
      method: 'GET', path: '/loop/status/lpr_x', authorization: undefined,
      body: undefined, env: ENABLED, now: T0,
    }, service);
    expect(result?.status).toBe(401);
    expect((result?.body as { kind: string }).kind).toBe('authentication_failed');
  });

  it('lets a browser read but not confirm', async () => {
    const browser = { authorize: () => ({ kind: 'browser' as const, principal: 'browser' }) };
    const read = await call('GET', '/loop/status/lpr_missing', undefined, browser);
    // Reached the handler — a 404 proves it was allowed to ask.
    expect(read?.status).toBe(404);

    const confirm = await call('POST', '/loop/confirm', CONFIRM_BODY, browser);
    expect(confirm?.status).toBe(403);
    expect((confirm?.body as { kind: string }).kind).toBe('authorization_required');
  });

  it('refuses a confirmation for a workspace the principal may not act in', async () => {
    const result = await call('POST', '/loop/confirm', CONFIRM_BODY, {
      authorizeScope: (scope) => scope.workspaceId === 'wsp_proof'
        ? { allowed: false, status: 403, message: 'You may not start Loops in that workspace.' }
        : { allowed: true },
    });
    expect(result?.status).toBe(403);
    expect(service.store.runIdsForLoop('lpe_proof')).toBeNull();
  });

  it('refuses a confirmation that was never explicitly authorized', async () => {
    const result = await call('POST', '/loop/confirm', { ...CONFIRM_BODY, authorized: false });
    expect(result?.status).toBe(403);
    expect((result?.body as { error: string }).error).toContain('explicit confirmation');
  });
});

/* ====================================================== malformed input === */

describe('malformed input produces sanitized client errors', () => {
  it('refuses a traversal in a run id without throwing', async () => {
    for (const bad of ['..%2f..%2fetc%2fpasswd', 'a%2Fb', '%ZZ', '.']) {
      const result = await call('GET', `/loop/status/${bad}`);
      expect(result?.status, bad).toBe(422);
      expect((result?.body as { error: string }).error).not.toContain('/home/');
    }
  });

  it('refuses a control action with no request id', async () => {
    const result = await call('POST', '/loop/pause/lpr_whatever', {});
    expect(result?.status).toBe(422);
    expect((result?.body as { error: string }).error).toContain('requestId');
  });

  it('refuses an unknown Loop operation', async () => {
    expect((await call('POST', '/loop/teleport/lpr_x', {}))?.status).toBe(422);
  });

  it('reports a missing run as not found', async () => {
    expect((await call('GET', '/loop/status/lpr_absent'))?.status).toBe(404);
    expect((await call('GET', '/loop/inspect/lpr_absent'))?.status).toBe(404);
    expect((await call('GET', '/loop/history/lpe_absent'))?.status).toBe(404);
  });
});

/* ================================================ the whole flow === */

describe('/loop coding — command to attested completion through the route', () => {
  it('parses and compiles before anything is confirmed', () => {
    const parsed = parseSlashCommand(COMMAND);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const command = parsed.value.command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.target.requestedRoles).toEqual(['coding_agent']);
    // Parsing started nothing.
    expect(service.store.runIdsForLoop('lpe_proof')).toBeNull();
  });

  it('confirms once, runs to attested completion, and reports it', async () => {
    const result = await call('POST', '/loop/confirm', CONFIRM_BODY);
    expect(result?.status).toBe(200);
    const data = (result?.body as { data: Record<string, unknown> }).data;
    expect(typeof data.runId).toBe('string');
    expect(String(data.runId).startsWith('lpr_')).toBe(true);
    expect(data.state).toBe('completed');
    expect(data.succeeded).toBe(true);
    expect(data.duplicate).toBe(false);
  });

  it('serves the completed run from status after the fact', async () => {
    const created = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const runId = (created?.body as { data: { runId: string } }).data.runId;
    const status = await call('GET', `/loop/status/${runId}`);
    expect(status?.status).toBe(200);
    const data = (status?.body as { data: Record<string, unknown> }).data;
    expect(data.state).toBe('completed');
    expect(data.succeeded).toBe(true);
    // Three iterations: claim, observed, attested.
    expect((data.usage as { iterationsStarted: number }).iterationsStarted).toBe(3);
  });

  it('inspect returns evidence, decisions and the causal event list', async () => {
    const created = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const runId = (created?.body as { data: { runId: string } }).data.runId;
    const inspected = await call('GET', `/loop/inspect/${runId}`);
    const data = (inspected?.body as { data: Record<string, unknown> }).data;

    const iterations = data.iterations as { observations: { trust: string }[]; evidenceRefs: string[] }[];
    expect(iterations).toHaveLength(3);
    expect(iterations[0].observations.some((o) => o.trust === 'claim')).toBe(true);
    expect(iterations[2].observations.some((o) => o.trust === 'attested')).toBe(true);
    expect(iterations[2].evidenceRefs).toContain('evd_attested');
    expect((data.events as unknown[]).length).toBeGreaterThan(10);
    expect(data.journalIntegrity).toBe('ok');
  });

  it('history lists exactly this Loop\'s runs', async () => {
    await call('POST', '/loop/confirm', CONFIRM_BODY);
    const history = await call('GET', '/loop/history/lpe_proof');
    const data = (history?.body as { data: { runs: unknown[] } }).data;
    expect(data.runs).toHaveLength(1);

    // A different Loop is untouched and unlisted.
    expect((await call('GET', '/loop/history/lpe_other'))?.status).toBe(404);
  });

  it('a new client restores server truth without re-running anything', async () => {
    const created = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const runId = (created?.body as { data: { runId: string } }).data.runId;

    // A refresh: a brand-new service over the same bytes, and an agent scripted
    // for NOTHING. If restoring re-ran work, the fake would throw.
    const restarted = makeService([]);
    const restored = await handleLoopRoute({
      method: 'GET', path: `/loop/status/${runId}`, authorization: `Bearer ${TOKEN}`,
      body: undefined, env: ENABLED, now: T0,
    }, restarted);
    expect((restored?.body as { data: { state: string } }).data.state).toBe('completed');
  });

  it('reads are side-effect free', async () => {
    const created = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const runId = (created?.body as { data: { runId: string } }).data.runId;
    const before = service.store.read(runId)?.events.length;

    for (let i = 0; i < 3; i += 1) {
      await call('GET', `/loop/status/${runId}`);
      await call('GET', `/loop/inspect/${runId}`);
      await call('GET', '/loop/history/lpe_proof');
    }
    // Not one line appended, and no lock left behind.
    expect(service.store.read(runId)?.events.length).toBe(before);
    const dir = service.store.runDir('lpe_proof', runId);
    if (!dir.ok) throw new Error('expected a run dir');
    expect(existsSync(join(dir.value, LOCK_FILE))).toBe(false);
  });
});

/* ======================================================= idempotency === */

describe('one confirmation creates one run', () => {
  it('returns the existing run for a repeated confirmation', async () => {
    const first = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const firstId = (first?.body as { data: { runId: string } }).data.runId;
    const events = service.store.read(firstId)?.events.length;

    const second = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const data = (second?.body as { data: Record<string, unknown> }).data;
    expect(data.runId).toBe(firstId);
    expect(data.duplicate).toBe(true);
    // No second run, no second journal, no extra usage.
    expect(service.store.runIdsForLoop('lpe_proof')).toHaveLength(1);
    expect(service.store.read(firstId)?.events.length).toBe(events);
    expect((data.usage as { iterationsStarted: number }).iterationsStarted).toBe(3);
  });

  it('two concurrent confirmations create one run', async () => {
    const [a, b] = await Promise.all([
      call('POST', '/loop/confirm', CONFIRM_BODY),
      call('POST', '/loop/confirm', CONFIRM_BODY),
    ]);
    const idA = (a?.body as { data: { runId: string } }).data.runId;
    const idB = (b?.body as { data: { runId: string } }).data.runId;
    expect(idA).toBe(idB);
    expect(service.store.runIdsForLoop('lpe_proof')).toHaveLength(1);
  });

  it('a different confirmation request is a different run', async () => {
    await call('POST', '/loop/confirm', CONFIRM_BODY);
    const other = makeService([{ kind: 'attested_evidence' }]);
    const second = await handleLoopRoute({
      method: 'POST', path: '/loop/confirm', authorization: `Bearer ${TOKEN}`,
      body: { ...CONFIRM_BODY, confirmationRequestId: 'cfm_2' }, env: ENABLED, now: T0,
    }, other);
    const data = (second?.body as { data: Record<string, unknown> }).data;
    expect(data.duplicate).toBe(false);
    expect(other.store.runIdsForLoop('lpe_proof')).toHaveLength(2);
  });

  it('a moved contract under the same request id is a different run, never the old one', async () => {
    const first = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const firstId = (first?.body as { data: { runId: string } }).data.runId;
    const moved = makeService([{ kind: 'attested_evidence' }]);
    const second = await handleLoopRoute({
      method: 'POST', path: '/loop/confirm', authorization: `Bearer ${TOKEN}`,
      body: { ...CONFIRM_BODY, contractBindingDigest: 'binding-CHANGED' }, env: ENABLED, now: T0,
    }, moved);
    const data = (second?.body as { data: { runId: string } }).data;
    // The digest is part of the identity, so this cannot be answered with the
    // run that executed the OLD contract.
    expect(data.runId).not.toBe(firstId);
  });
});

/* ======================================================= the real lock === */

describe('the real Node lock guards execution', () => {
  it('leaves no lock behind after a completed run', async () => {
    const created = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const runId = (created?.body as { data: { runId: string } }).data.runId;
    const dir = service.store.runDir('lpe_proof', runId);
    if (!dir.ok) throw new Error('expected a run dir');
    expect(existsSync(join(dir.value, LOCK_FILE))).toBe(false);
  });

  it('writes its lock inside the state root, never the repository', async () => {
    const created = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const runId = (created?.body as { data: { runId: string } }).data.runId;
    const dir = service.store.runDir('lpe_proof', runId);
    if (!dir.ok) throw new Error('expected a run dir');
    expect(dir.value.startsWith(root)).toBe(true);
    expect(dir.value).not.toContain(process.cwd());
  });

  it('refuses to dispatch while another holder has the run locked', async () => {
    const created = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const runId = (created?.body as { data: { runId: string } }).data.runId;

    // Someone else takes the lock — a second bridge process, or a CLI.
    const held = service.store.lock('lpe_proof', runId, 'other-process', () => T0);
    expect(held.ok).toBe(true);
    if (!held.ok) throw new Error('unreachable');
    // A live lock is never stolen.
    const second = service.store.lock('lpe_proof', runId, 'me', () => T0);
    expect(second.ok).toBe(false);
    held.value.lock.release();
    // And releasing twice is harmless.
    held.value.lock.release();
    const third = service.store.lock('lpe_proof', runId, 'me', () => T0);
    expect(third.ok).toBe(true);
    if (third.ok) third.value.lock.release();
  });
});

/* ================================================== control requests === */

describe('pause, resume and stop through the route', () => {
  /**
   * A run left mid-flight.
   *
   * Confirmation drives the engine INLINE, so a run normally settles before the
   * response returns and there is nothing left to pause. Bounding the drive to
   * one iteration per call is what leaves the run in `running` — which is the
   * state a control action actually applies to, and the state a background
   * worker would leave it in for real.
   */
  async function runningRun(): Promise<string> {
    service = makeService([
      { kind: 'continuing' }, { kind: 'continuing' }, { kind: 'continuing' }, { kind: 'continuing' },
    ], 1);
    const created = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const runId = (created?.body as { data: { runId: string } }).data.runId;
    const state = (created?.body as { data: { state: string } }).data.state;
    if (state !== 'running') throw new Error(`expected a running run, got ${state}`);
    return runId;
  }

  it('pauses, records a safe checkpoint, and writes a snapshot', async () => {
    const runId = await runningRun();
    const paused = await call('POST', `/loop/pause/${runId}`, { requestId: 'lpq_pause_1' });
    expect(paused?.status).toBe(200);
    const data = (paused?.body as { data: Record<string, unknown> }).data;
    expect(data.state).toBe('paused');
    expect((data.latestCheckpoint as { reason: string }).reason).toBe('safe_pause_reached');
    // A corroborating snapshot exists, and the journal is still authoritative.
    const record = service.store.read(runId);
    expect(record?.snapshot).not.toBeNull();
    expect(readLoopRun(service.store, runId, loopDigest)?.source).toBe('current');
  });

  it('treats a redelivered pause as the same request', async () => {
    const runId = await runningRun();
    await call('POST', `/loop/pause/${runId}`, { requestId: 'lpq_pause_1' });
    const events = service.store.read(runId)?.events.length;
    const again = await call('POST', `/loop/pause/${runId}`, { requestId: 'lpq_pause_1' });
    expect((again?.body as { data: { duplicate: boolean } }).data.duplicate).toBe(true);
    expect(service.store.read(runId)?.events.length).toBe(events);
  });

  it('refuses a control request that is not an lpq id', async () => {
    const runId = await runningRun();
    const result = await call('POST', `/loop/pause/${runId}`, { requestId: 'pause-1' });
    expect(result?.status).toBe(422);
    expect((result?.body as { error: string }).error).toContain('lpq_');
  });

  it('refuses a request id already used for a different action', async () => {
    const runId = await runningRun();
    await call('POST', `/loop/pause/${runId}`, { requestId: 'lpq_shared' });
    const conflicting = await call('POST', `/loop/stop/${runId}`, { requestId: 'lpq_shared' });
    expect(conflicting?.status).toBe(409);
    expect((conflicting?.body as { kind: string }).kind).toBe('conflicting_request');
  });

  it('resumes with a NEW request id and advances the generation exactly once', async () => {
    const runId = await runningRun();
    await call('POST', `/loop/pause/${runId}`, { requestId: 'lpq_pause_1' });
    const before = (await call('GET', `/loop/status/${runId}`));
    const beforeGen = (before?.body as { data: { recoveryGeneration: number } }).data.recoveryGeneration;

    const resumed = await call('POST', `/loop/resume/${runId}`, { requestId: 'lpq_resume_1', authorized: true });
    expect(resumed?.status).toBe(200);
    const data = (resumed?.body as { data: Record<string, unknown> }).data;
    expect(data.recoveryGeneration).toBe(beforeGen + 1);

    // A SECOND pause afterwards is a distinct request, not a duplicate of the
    // first — the bug that generation-derived ids caused.
    const pausedAgain = await call('POST', `/loop/pause/${runId}`, { requestId: 'lpq_pause_2' });
    expect((pausedAgain?.body as { data: { duplicate: boolean } }).data.duplicate).toBe(false);
  });

  it('requires explicit authorization to resume', async () => {
    const runId = await runningRun();
    await call('POST', `/loop/pause/${runId}`, { requestId: 'lpq_pause_1' });
    const result = await call('POST', `/loop/resume/${runId}`, { requestId: 'lpq_resume_1' });
    expect(result?.status).toBe(403);
  });

  it('stops without completing, and a repeat does not stop twice', async () => {
    const runId = await runningRun();
    const stopped = await call('POST', `/loop/stop/${runId}`, { requestId: 'lpq_stop_1', reason: 'enough' });
    const data = (stopped?.body as { data: Record<string, unknown> }).data;
    expect(data.state).toBe('stopped');
    expect(data.succeeded).toBe(false);
    expect(data.finished).toBe(true);

    const events = service.store.read(runId)?.events.length;
    const again = await call('POST', `/loop/stop/${runId}`, { requestId: 'lpq_stop_2' });
    // The run already ended; a second stop changes nothing.
    expect(again?.status).toBe(409);
    expect(service.store.read(runId)?.events.length).toBe(events);
  });

  it('refuses a control action on a finished run', async () => {
    const created = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const runId = (created?.body as { data: { runId: string } }).data.runId;
    const result = await call('POST', `/loop/pause/${runId}`, { requestId: 'lpq_pause_late' });
    expect(result?.status).toBe(409);
    expect((result?.body as { kind: string }).kind).toBe('already_finished');
  });
});

/* ================================================ unsupported targets === */

describe('a target Stage 2 cannot run is refused, never substituted', () => {
  it('refuses /loop reviewer rather than running it through the coding fake', async () => {
    // THE FAILURE THIS PREVENTS. The only adapter in this build staffs
    // coding_agent. Executing a Reviewer contract through it and reporting the
    // result would be claiming an independent review that never happened —
    // which is the single most consequential lie this system could tell.
    const result = await call('POST', '/loop/confirm', { ...CONFIRM_BODY, targetExpression: 'reviewer' });
    expect(result?.status).toBe(422);
    const body = result?.body as { kind: string; error: string };
    expect(body.kind).toBe('unsupported_target');
    expect(body.error).toContain('reviewer');
    expect(body.error).toContain('did not do it');
    // And nothing was created.
    expect(service.store.runIdsForLoop('lpe_proof')).toBeNull();
  });

  it('refuses architect for the same reason', async () => {
    const result = await call('POST', '/loop/confirm', { ...CONFIRM_BODY, targetExpression: 'architect' });
    expect(result?.status).toBe(422);
    expect((result?.body as { kind: string }).kind).toBe('unsupported_target');
  });

  it('refuses every multi-role expression', async () => {
    for (const expression of ['all', 'team', 'coding,reviewer', 'architect,coding,reviewer']) {
      const result = await call('POST', '/loop/confirm', { ...CONFIRM_BODY, targetExpression: expression });
      expect(result?.status, expression).toBe(422);
      expect((result?.body as { kind: string }).kind).toBe('unsupported_target');
      expect(service.store.runIdsForLoop('lpe_proof'), expression).toBeNull();
    }
  });

  it('accepts every alias that means the one supported role', async () => {
    for (const expression of ['coding', 'coder', 'coding-agent']) {
      rmSync(root, { recursive: true, force: true });
      root = mkdtempSync(join(tmpdir(), 'relay-loop-routes-'));
      service = makeService([{ kind: 'attested_evidence' }]);
      const result = await call('POST', '/loop/confirm', { ...CONFIRM_BODY, targetExpression: expression });
      expect(result?.status, expression).toBe(200);
    }
  });
});

/* ========================================================== leakage === */

describe('projections disclose nothing they should not', () => {
  it('never carries a lock owner, a path, a secret or reasoning', async () => {
    const created = await call('POST', '/loop/confirm', CONFIRM_BODY);
    const runId = (created?.body as { data: { runId: string } }).data.runId;
    for (const path of [`/loop/status/${runId}`, `/loop/inspect/${runId}`, '/loop/history/lpe_proof']) {
      const body = JSON.stringify((await call('GET', path))?.body);
      expect(body).not.toContain('"pid"');
      expect(body).not.toContain('"hostname"');
      expect(body).not.toContain(root);
      expect(body).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
      expect(body).not.toMatch(/<thinking>|chain[- ]of[- ]thought/i);
    }
  });
});
