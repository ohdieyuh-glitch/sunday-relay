/**
 * A-9 (JULIUS_WONDERLAND_START_ACK, JULIUS_WONDERLAND_START_RESUME): the
 * durable Start intent, the 202 `accepted` answer and the recovery worker. A
 * real admission file and the real claim core over a recording fake `gh`;
 * nothing here reaches GitHub. A "crash" is an abandoned in-process instance
 * (its `gh` or claim never answers) followed by new ports, a new claim core
 * and a new wiring over the same files; no OS process is killed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PAID_WORKFLOW_FILE } from '../src/relay/integration/wonderland-admission/admission-contract';
import { openAdmissionFile, type ClaimEvent, type OperatorDocument } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  LANE_GRANT_SOURCE,
  OPERATOR_DISPATCH_CONFIRMATION,
  createOperatorClaimTool,
  missionContractPath,
  type AwaitableGhSpawner,
  type ClaimResult,
  type GhResult,
  type OperatorClaimTool,
  type PriorAttemptReader,
} from '../src/relay/integration/wonderland-admission/operator-claim';
import { createWonderlandAdmissionService, createWonderlandStatusBridge, handleWonderlandAdmissionRoute, WONDERLAND_ADMISSION_PATH, WONDERLAND_STATUS_PATH } from './wonderland-admission-route';
import { createWonderlandMissionReadBridge } from './wonderland-mission-result-route';
import { createWonderlandMissionStartBridge, createWonderlandStartsInFlight, startKeyHash } from './wonderland-mission-start-route';
import { createWonderlandMissionStatusBridge, createWonderlandStartV2Wiring } from './wonderland-mission-status-route';
import {
  START_INTENT_WINDOW_MS,
  START_INTENTS_SCHEMA,
  readStartIntents,
  startIntentsPath,
  startResumesLogPath,
  writeStartIntents,
  unreconciledClaimInStore,
  type StartIntent,
  type StartRequestsIo,
} from './wonderland-start-intents';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const RUN2 = 'wlj_1c8b2d3f-5a4e-4b7c-9d3e-4f5a6b7c8d9e';
const ADMIT_KEY = '11111111-2222-4333-8444-555555555555';
const ADMIT_KEY2 = '21111111-2222-4333-8444-555555555555';
const ADMIT_KEY_HASH = createHash('sha256').update(ADMIT_KEY).digest('hex');
const START_KEY = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const OTHER_KEY = '12345678-1234-4234-8234-123456789abc';
const TRIGGER = 'c'.repeat(32);
const WHEN = '2026-10-23T17:18:00.000Z';
const T0 = Date.parse(WHEN);
const PROJECT = 'project-1';
const REPO = 'founder/sunday-relay';
const MISSION = 'julius-inworld-data-1';
const WORKFLOW_RUN = '40250000001';
const PATH = (leaf: string, run = RUN) => `/wonderland/julius/missions/${run}/${leaf}`;
const ACK = { JULIUS_WONDERLAND_START_ACK: '1' };
const RESUME = { JULIUS_WONDERLAND_START_ACK: '1', JULIUS_WONDERLAND_START_RESUME: '1' };

const LANES = JSON.parse(readFileSync(join(__dirname, '../src/relay/integration/wonderland-admission/fixtures/pr459-lane-grants.json'), 'utf8')) as {
  readonly laneGrantExcerpt: string;
  readonly contractMarkerNamespace: string;
};
const WORKFLOW = `
name: fixture
on:
  workflow_dispatch:
    inputs:
      confirm_live:
        default: ''
      mission:
        description: 'slug'
      lane:
        description: 'lane'
      dispatch_key:
        description: 'key'
      run_id:
        default: ''
jobs:
  paid:
    steps:
      - run: |
          case "$MARKER_NAMESPACE" in
            *)                 RECORDED_PAID_ATTEMPTS=0 ;;
          esac
`;
const ABSENT: GhResult = { code: 1, stdout: 'HTTP/2.0 404 Not Found\nDate: Fri, 23 Oct 2026 17:18:05 GMT\n\n{"message":"Not Found"}\n', stderr: '' };
const CONTENTS = `repos/${REPO}/contents/`;
const ZERO_PRIOR: PriorAttemptReader = { read: () => Promise.resolve({ readable: true, counted: 0 }), readCompleted: () => Promise.resolve({ readable: true, counted: 0 }) };
const never = <T>() => new Promise<T>(() => undefined);
const tick = (ms = 5) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * A recording fake `gh`. `crash` freezes it, as a process dying there would:
 * `first` at its first call (before the claim core reserves), `before_spawn`
 * at `gh workflow run` before the call is made (C2), `after_spawn` once the
 * call is made and recorded (C3). `withdrawn` answers 404 for the lane grant.
 */
type Crash = 'none' | 'first' | 'before_spawn' | 'after_spawn';
function fakeGh(opts: { crash?: Crash; hold?: boolean; withdrawn?: boolean; rerunInput?: boolean } = {}) {
  const calls: string[][] = [];
  let froze: () => void = () => undefined;
  const frozen = new Promise<void>((resolve) => { froze = resolve; });
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  if (opts.hold !== true) release();
  const crash = opts.crash ?? 'none';
  const answer = (args: readonly string[]): GhResult => {
    const target = args.find((arg) => arg.startsWith(CONTENTS));
    if (args[0] === 'api' && target !== undefined) {
      const path = target.slice(CONTENTS.length).replace(/\?ref=main$/u, '');
      const text = path === `.github/workflows/${PAID_WORKFLOW_FILE}` ? (opts.rerunInput === true ? WORKFLOW.replace('      run_id:', "      acknowledge_rerun:\n        default: ''\n      run_id:") : WORKFLOW)
        : path === missionContractPath(MISSION) ? JSON.stringify({ markerNamespace: LANES.contractMarkerNamespace })
          : path === LANE_GRANT_SOURCE ? (opts.withdrawn === true ? null : LANES.laneGrantExcerpt) : null;
      return text === null ? { code: 1, stdout: '', stderr: 'HTTP 404' } : { code: 0, stdout: text, stderr: '' };
    }
    if (args[0] === 'api') return ABSENT;
    if (args[0] === 'run' && args[1] === 'list') {
      return { code: 0, stdout: JSON.stringify([{ databaseId: Number(WORKFLOW_RUN), attempt: 1, status: 'in_progress', conclusion: null, displayTitle: `Julius first live mission mode=paid key=${ADMIT_KEY_HASH}`, event: 'workflow_dispatch', headBranch: 'main' }]), stderr: '' };
    }
    if (args[0] === 'workflow') return { code: 0, stdout: `https://github.com/${REPO}/actions/runs/${WORKFLOW_RUN}\n`, stderr: '' };
    return { code: 99, stdout: '', stderr: '' };
  };
  const spawn: AwaitableGhSpawner = {
    async run(args) {
      if (crash === 'first') { froze(); return never(); }
      if (args[0] === 'workflow' && crash === 'before_spawn') { froze(); return never(); }
      calls.push([...args]);
      if (args[0] === 'workflow') {
        if (crash === 'after_spawn') { froze(); return never(); }
        await held;
      }
      await tick(1);
      return answer(args);
    },
  };
  return { spawn, calls, frozen, release: () => release() };
}
type Gh = ReturnType<typeof fakeGh>;
const workflowCalls = (gh: Gh) => gh.calls.filter((args) => args[0] === 'workflow').length;

function env(storePath: string, over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_WONDERLAND_MISSION: MISSION,
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
    JULIUS_WONDERLAND_START: '1',
    JULIUS_WONDERLAND_START_V2: '1',
    JULIUS_WONDERLAND_GITHUB_REPO: REPO,
    JULIUS_WONDERLAND_START_LANE: 'lab',
    ...over,
  };
}

const request = (over: Record<string, unknown>) => ({
  method: 'GET', path: PATH('status'), url: `${PATH('status')}?projectId=${PROJECT}`, authorization: 'Relay-Session native-token',
  remoteAddress: '127.0.0.1', host: 'localhost', forwarded: false, nowIso: WHEN, nowMs: T0, ...over,
});
const startRequest = (key = START_KEY, trigger = TRIGGER, nowMs = T0, run = RUN) => request({
  method: 'POST', path: PATH('start', run), url: `${PATH('start', run)}?projectId=${PROJECT}`, idempotencyKey: key, nowMs, nowIso: new Date(nowMs).toISOString(),
  body: JSON.stringify({ wljRunId: run, confirm: 'RUN LIVE MISSION', clientTriggerId: trigger, clientUiActionUtc: WHEN }),
});

/** A claim-core wrapper: the claim runs for real and then this process "dies" before the answer is saved (C4). */
const crashAfterClaim = (tool: OperatorClaimTool, done: () => void): OperatorClaimTool => ({
  ...tool,
  claim: async (input) => {
    const result = await tool.claim(input);
    if (!(result.ok && result.dispatchedWorkflow && !result.replayed)) return result;
    done();
    return never<ClaimResult>();
  },
});

/** One bridge process over the store: new ports, a new claim core and a new wiring. */
function bridge(storePath: string, over: Record<string, string | undefined>, gh: Gh, opts: { wrap?: (tool: OperatorClaimTool) => OperatorClaimTool; io?: StartRequestsIo; prior?: PriorAttemptReader } = {}) {
  const ports = createWonderlandAdmissionService({
    env: env(storePath, over),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => (token === 'native-token' ? { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-1' } : null),
    readWorkflowText: () => null,
  });
  const real = createOperatorClaimTool(openAdmissionFile(storePath), gh.spawn, { nowIso: () => WHEN }, opts.prior ?? ZERO_PRIOR);
  const tool = opts.wrap === undefined ? real : opts.wrap(real);
  const wiring = createWonderlandStartV2Wiring(ports, { runReader: undefined, evidenceReader: undefined }, { spawn: gh.spawn, claimTool: () => tool, ...(opts.io === undefined ? {} : { startRequestsIo: opts.io }) });
  return {
    ports, real, tool, wiring, gh,
    env: env(storePath, over),
    start: (key?: string, trigger?: string, nowMs?: number, run?: string) => wiring.startBridge.handle(startRequest(key, trigger, nowMs, run)),
    status: async (nowMs = T0, run = RUN) => (await wiring.statusBridge.handle(request({ nowMs, path: PATH('status', run), url: `${PATH('status', run)}?projectId=${PROJECT}` })))?.body as Record<string, any>,
    resume: (nowMs = T0 + 60_000, envOver: Record<string, string | undefined> = {}) => wiring.requests.resumePass({ ...env(storePath, over), ...envOver }, nowMs),
    close: () => ports.close(),
  };
}
type Bridge = ReturnType<typeof bridge>;

async function admit(ports: Bridge['ports'], run = RUN, key = ADMIT_KEY) {
  const created = await handleWonderlandAdmissionRoute({
    method: 'POST', path: WONDERLAND_ADMISSION_PATH, url: `${WONDERLAND_ADMISSION_PATH}?projectId=${PROJECT}`,
    authorization: 'Relay-Session native-token', origin: undefined, idempotencyKey: key,
    rawBody: JSON.stringify({ runId: run, clientTriggerId: 'trigger_01', clientLogSha256: 'ab'.repeat(32), clientUiActionUtc: WHEN }),
    remoteAddress: '127.0.0.1', host: 'localhost', forwarded: false, nowIso: WHEN, nowMs: T0,
  }, ports);
  expect(created?.status).toBe(202);
}

/** A store with one admitted mission, and the first bridge over it. */
async function fixture(over: Record<string, string | undefined> = ACK, gh: Gh = fakeGh(), opts: Parameters<typeof bridge>[3] = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-intent-'));
  const storePath = join(dir, 'admission.json');
  const first = bridge(storePath, over, gh, opts);
  await admit(first.ports);
  return { dir, storePath, first, cleanup: () => { try { first.close(); } catch { /* closed */ } rmSync(dir, { recursive: true, force: true }); } };
}

const intents = (storePath: string): StartIntent[] => {
  const read = readStartIntents(storePath);
  if (!read.ok) throw new Error('unreadable');
  return [...read.intents];
};
const logLines = (storePath: string) => (existsSync(startResumesLogPath(storePath)) ? readFileSync(startResumesLogPath(storePath), 'utf8').trim().split('\n').filter(Boolean) : []);

/** Restart: the old bridge is abandoned where it stands and a new one opens the same files. */
function restart(old: Bridge, storePath: string, over: Record<string, string | undefined>, gh: Gh, opts: Parameters<typeof bridge>[3] = {}) {
  try { old.close(); } catch { /* closed */ }
  return bridge(storePath, over, gh, opts);
}

/** C1: the intent is saved and the claim core is frozen at its first `gh` read, before any reservation. */
async function crashedAtC1(over: Record<string, string> = RESUME) {
  const gh = fakeGh({ crash: 'first' });
  const fx = await fixture(over, gh);
  const ack = await fx.first.start();
  expect(ack?.status).toBe(202);
  await gh.frozen;
  return { fx, ack };
}

describe('A-9 ack: POST /start answers 202 accepted at once, durably', () => {
  it('saves the intent (fsync, rename, 0600) and answers 202 accepted while gh workflow run has not answered; 202 is not dispatched', async () => {
    const gh = fakeGh({ hold: true });
    const fx = await fixture(ACK, gh);
    try {
      const ack = await fx.first.start();
      expect(ack?.status).toBe(202);
      expect(ack?.body).toEqual({ wljRunId: RUN, ack: 'accepted', state: 'accepted', startKeyHash: startKeyHash(START_KEY), acceptedAt: WHEN, replayed: false, workflowRunId: null, dispatchedAt: null });
      const saved = intents(fx.storePath);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ wljRunId: RUN, startKeyHash: startKeyHash(START_KEY), clientTriggerId: TRIGGER, state: 'accepted', outcome: null, resumeAttempts: 0, rerunAcknowledged: false });
      expect(statSync(startIntentsPath(fx.storePath)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(startIntentsPath(fx.storePath), 'utf8')).schema).toBe(START_INTENTS_SCHEMA);
      // No key, no phrase, no grant is stored.
      expect(readFileSync(startIntentsPath(fx.storePath), 'utf8')).not.toContain(START_KEY);
      await tick(40);
      expect((await fx.first.status()).start.request).toMatchObject({ state: 'claiming', outcome: null, resumed: false });
      fx.first.gh.release();
      await fx.first.wiring.requests.idle();
      expect(workflowCalls(gh)).toBe(1);
      const settled = (await fx.first.status()).start.request;
      expect(settled.state).toBe('settled');
      expect(settled.outcome.httpStatus).toBe(202);
      expect(settled.outcome.body).toMatchObject({ state: 'dispatched', workflowRunId: WORKFLOW_RUN });
      expect(intents(fx.storePath)[0]).toMatchObject({ state: 'settled' });
    } finally {
      fx.cleanup();
    }
  });

  it('the saved outcome is the exact answer the synchronous v2 Start gives (ACK unset)', async () => {
    const on = await fixture(ACK);
    const off = await fixture({});
    try {
      await on.first.start();
      await on.first.wiring.requests.idle();
      const sync = await off.first.start();
      const saved = intents(on.storePath)[0]!.outcome!;
      expect({ status: saved.httpStatus, body: saved.body }).toEqual(sync);
    } finally {
      on.cleanup();
      off.cleanup();
    }
  });

  it('same key and body joins the live task; same key with another body is 409 key_reused; a new key while live is 409 in_progress', async () => {
    const gh = fakeGh({ crash: 'first' });
    const fx = await fixture(ACK, gh);
    try {
      await fx.first.start();
      await gh.frozen;
      const join = await fx.first.start();
      expect(join?.status).toBe(202);
      expect(join?.body).toMatchObject({ ack: 'accepted', replayed: true });
      expect((await fx.first.start(START_KEY, 'd'.repeat(32)))?.body).toMatchObject({ error: { kind: 'julius_start_key_reused' } });
      expect((await fx.first.start(START_KEY, 'd'.repeat(32)))?.status).toBe(409);
      const other = await fx.first.start(OTHER_KEY);
      expect(other?.status).toBe(409);
      expect(other?.body).toMatchObject({ error: { kind: 'julius_start_in_progress' }, startKeyHash: startKeyHash(START_KEY) });
      expect(intents(fx.storePath)).toHaveLength(1);
      expect(intents(fx.storePath)[0]!.startKeyHash).toBe(startKeyHash(START_KEY));
    } finally {
      fx.cleanup();
    }
  });

  it('once the journal holds a claim, any key replays it through the claim core and nothing dispatches again (R3, R4)', async () => {
    const fx = await fixture(ACK);
    try {
      await fx.first.start();
      await fx.first.wiring.requests.idle();
      const before = readFileSync(startIntentsPath(fx.storePath), 'utf8');
      for (const key of [START_KEY, OTHER_KEY]) {
        const again = await fx.first.start(key);
        expect(again?.status).toBe(200);
        expect(again?.body).toMatchObject({ state: 'dispatched', replayed: true });
      }
      expect(workflowCalls(fx.first.gh)).toBe(1);
      expect(readFileSync(startIntentsPath(fx.storePath), 'utf8')).toBe(before);
    } finally {
      fx.cleanup();
    }
  });

  it('a settled refusal with no claim is replayed from the intent for the same key, and a new key may try again', async () => {
    const fx = await fixture(ACK, fakeGh({ withdrawn: true }));
    try {
      await fx.first.start();
      await fx.first.wiring.requests.idle();
      const saved = intents(fx.storePath)[0]!;
      expect(saved.state).toBe('settled');
      expect(saved.outcome!.httpStatus).toBe(409);
      const again = await fx.first.start();
      expect(again).toEqual({ status: saved.outcome!.httpStatus, body: { ...saved.outcome!.body, replayed: true } });
      expect((await fx.first.start(OTHER_KEY))?.status).toBe(202);
      await fx.first.wiring.requests.idle();
      expect(workflowCalls(fx.first.gh)).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  it('a claim core that throws settles as 503 julius_start_unavailable, never as started', async () => {
    const fx = await fixture(ACK, fakeGh(), { wrap: (tool) => ({ ...tool, claim: async () => { throw new Error('boom'); } }) });
    try {
      expect((await fx.first.start())?.status).toBe(202);
      await fx.first.wiring.requests.idle();
      const request = (await fx.first.status()).start.request;
      expect(request.state).toBe('settled');
      expect(request.outcome).toMatchObject({ httpStatus: 503, body: { error: { kind: 'julius_start_unavailable' } } });
      expect(fx.first.wiring.requests.live(RUN)).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  it('an intent that cannot be saved is 503 and the claim core is never called (C0)', async () => {
    let claims = 0;
    const fx = await fixture(ACK, fakeGh(), {
      io: { writeIntents: () => { throw new Error('disk full'); } },
      wrap: (tool) => ({ ...tool, claim: (input) => { claims += 1; return tool.claim(input); } }),
    });
    try {
      const answer = await fx.first.start();
      expect(answer?.status).toBe(503);
      expect(answer?.body).toMatchObject({ error: { kind: 'julius_start_unavailable' } });
      expect(claims).toBe(0);
      expect(existsSync(startIntentsPath(fx.storePath))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  it('an unreadable intents file is 503 for /start (nothing claimed) and requestUnreadable on /status', async () => {
    const fx = await fixture(ACK);
    try {
      writeFileSync(startIntentsPath(fx.storePath), '{"schema":"other"}');
      expect((await fx.first.start())?.status).toBe(503);
      expect(workflowCalls(fx.first.gh)).toBe(0);
      const start = (await fx.first.status()).start;
      expect(start.request).toBeNull();
      expect(start.requestUnreadable).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  it('R4: a saved outcome that says started with no claim in the journal shows interrupted, never started', async () => {
    const { fx } = await crashedAtC1(ACK);
    const next = restart(fx.first, fx.storePath, ACK, fakeGh());
    try {
      writeStartIntents(fx.storePath, intents(fx.storePath).map((intent) => ({
        ...intent, state: 'settled' as const, outcome: { httpStatus: 202, body: { state: 'dispatched', workflowRunId: WORKFLOW_RUN } },
      })));
      expect((await next.status()).start.request).toMatchObject({ state: 'interrupted', outcome: null });
      expect((await next.status()).start.state).not.toBe('dispatched');
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });
});

describe('A-9 flags off: byte-identical to part 1', () => {
  const part1 = (fx: Awaited<ReturnType<typeof fixture>>) => {
    const startsInFlight = createWonderlandStartsInFlight();
    const tool = fx.first.tool;
    const start = createWonderlandMissionStartBridge(fx.first.ports, { claimTool: () => tool, claimToolV2: () => tool, startsInFlight });
    const read = createWonderlandMissionReadBridge(fx.first.ports, undefined);
    const status = createWonderlandMissionStatusBridge(fx.first.ports, {
      events: (r) => fx.first.wiring.eventsBridge.handle(r), result: (r) => read.handle(r), recovery: fx.first.wiring.recovery, startsInFlight,
    });
    return { start: (key = START_KEY) => start.handle(startRequest(key)), status: async () => JSON.stringify(await status.handle(request({}))) };
  };

  it.each([['unset', {}], ['0', { JULIUS_WONDERLAND_START_ACK: '0' }], ['true', { JULIUS_WONDERLAND_START_ACK: 'true' }], ['ack without v2', { JULIUS_WONDERLAND_START_ACK: '1', JULIUS_WONDERLAND_START_V2: undefined }]])(
    'ACK %s: /start and /status answer exactly as a part-1 wiring with no intents, and no file is written', async (_label, over) => {
      const a = await fixture({ ...over, JULIUS_WONDERLAND_START_RESUME: '1' });
      const b = await fixture(over);
      try {
        const p1 = part1(b);
        expect(JSON.stringify(await a.first.wiring.statusBridge.handle(request({})))).toBe(await p1.status());
        for (const key of [START_KEY, START_KEY, OTHER_KEY]) {
          expect(JSON.stringify(await a.first.start(key))).toBe(JSON.stringify(await p1.start(key)));
        }
        expect(JSON.stringify(await a.first.wiring.statusBridge.handle(request({})))).toBe(await p1.status());
        expect((await a.first.resume()).reason).toBe('disabled');
        expect(existsSync(startIntentsPath(a.storePath))).toBe(false);
        expect(existsSync(startResumesLogPath(a.storePath))).toBe(false);
      } finally {
        a.cleanup();
        b.cleanup();
      }
    });

  it('main /wonderland/julius/status, /progress and /result are byte-identical with ACK and RESUME on and off, after a Start under each', async () => {
    const off = await fixture({});
    const on = await fixture(RESUME);
    try {
      await off.first.start();
      await on.first.start();
      await on.first.wiring.requests.idle();
      await on.first.resume();
      const get = (path: string, url: string) => request({ path, url });
      type P = typeof on.first.ports;
      const reads = [
        (p: P) => createWonderlandStatusBridge(p).handle(get(WONDERLAND_STATUS_PATH, `${WONDERLAND_STATUS_PATH}?projectId=${PROJECT}&runId=${encodeURIComponent(RUN)}`)),
        (p: P) => createWonderlandMissionReadBridge(p).handle(get(PATH('progress'), `${PATH('progress')}?projectId=${PROJECT}`)),
        (p: P) => createWonderlandMissionReadBridge(p).handle(get(PATH('result'), `${PATH('result')}?projectId=${PROJECT}`)),
      ];
      for (const read of reads) {
        const a = await read(off.first.ports);
        const b = await read(on.first.ports);
        expect(a?.status).toBe(200);
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        expect(JSON.stringify(b)).not.toMatch(/start-intents|resumeAttempts|"request"/u);
      }
    } finally {
      off.cleanup();
      on.cleanup();
    }
  });
});

describe('A-9 recovery worker: what it resumes', () => {
  it('resumes an accepted intent once: count first, then the fsynced log line, then the claim core; /status says resumed', async () => {
    const { fx } = await crashedAtC1();
    const gh = fakeGh();
    const seen: { attempts: number; log: string[] }[] = [];
    const next = restart(fx.first, fx.storePath, RESUME, gh, {
      wrap: (tool) => ({ ...tool, claim: (input) => { seen.push({ attempts: intents(fx.storePath)[0]!.resumeAttempts, log: logLines(fx.storePath) }); return tool.claim(input); } }),
    });
    try {
      expect((await next.status(T0 + 60_000)).start.request).toMatchObject({ state: 'accepted', resumed: false });
      const pass = await next.resume();
      expect(pass).toEqual({ resumed: [startKeyHash(START_KEY)], refused: [], reason: 'ran' });
      await next.wiring.requests.idle();
      expect(seen).toHaveLength(1);
      expect(seen[0]!.attempts).toBe(1);
      expect(seen[0]!.log).toHaveLength(1);
      expect(JSON.parse(seen[0]!.log[0]!)).toEqual({ schema: 'wonderland-start-resume.v1', wljRunId: RUN, intentId: startKeyHash(START_KEY), intentAgeMs: 60_000, at: new Date(T0 + 60_000).toISOString() });
      expect(workflowCalls(gh)).toBe(1);
      const request = (await next.status(T0 + 61_000)).start.request;
      expect(request).toMatchObject({ state: 'settled', resumed: true, resumedAt: new Date(T0 + 60_000).toISOString() });
      expect(request.outcome.body).toMatchObject({ state: 'dispatched' });
      expect(await next.resume(T0 + 90_000)).toEqual({ resumed: [], refused: [], reason: 'ran' });
      expect(workflowCalls(gh)).toBe(1);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['RESUME unset', { JULIUS_WONDERLAND_START_RESUME: undefined }],
    ['kill switch', { JULIUS_WONDERLAND_START_RESUME_DISABLED: '1' }],
    ['ACK unset', { JULIUS_WONDERLAND_START_ACK: undefined }],
    ['START unset', { JULIUS_WONDERLAND_START: undefined }],
    ['V2 unset', { JULIUS_WONDERLAND_START_V2: undefined }],
  ])('%s at the pass: disabled, nothing marked, logged or claimed', async (_label, envOver) => {
    const { fx } = await crashedAtC1();
    const gh = fakeGh();
    const next = restart(fx.first, fx.storePath, RESUME, gh);
    try {
      expect((await next.resume(T0 + 60_000, envOver)).reason).toBe('disabled');
      expect(intents(fx.storePath)[0]!.resumeAttempts).toBe(0);
      expect(logLines(fx.storePath)).toHaveLength(0);
      expect(gh.calls).toHaveLength(0);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('an intent older than 10 minutes is never resumed, shows interrupted, and a same-key retry is 409 julius_start_interrupted', async () => {
    const { fx } = await crashedAtC1();
    const gh = fakeGh();
    const next = restart(fx.first, fx.storePath, RESUME, gh);
    const late = T0 + START_INTENT_WINDOW_MS + 1;
    try {
      expect(await next.resume(late)).toEqual({ resumed: [], refused: [], reason: 'ran' });
      expect((await next.status(late)).start.request.state).toBe('interrupted');
      const retry = await next.start(START_KEY, TRIGGER, late);
      expect(retry?.status).toBe(409);
      expect(retry?.body).toMatchObject({ error: { kind: 'julius_start_interrupted' } });
      expect(gh.calls).toHaveLength(0);
      // At exactly 10 minutes it is still inside the window.
      expect((await next.resume(T0 + START_INTENT_WINDOW_MS)).resumed).toHaveLength(1);
      await next.wiring.requests.idle();
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('an intent that carried the rerun phrase is never resumed (the phrase is never stored)', async () => {
    const { fx } = await crashedAtC1();
    const saved = intents(fx.storePath);
    writeStartIntents(fx.storePath, saved.map((intent) => ({ ...intent, rerunAcknowledged: true })));
    const gh = fakeGh();
    const next = restart(fx.first, fx.storePath, RESUME, gh);
    try {
      expect((await next.resume()).resumed).toHaveLength(0);
      expect((await next.status(T0 + 60_000)).start.request.state).toBe('interrupted');
      expect(gh.calls).toHaveLength(0);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('an intent already resumed once (count persisted, then a crash) is never resumed again, whatever the log says', async () => {
    const { fx } = await crashedAtC1();
    writeStartIntents(fx.storePath, intents(fx.storePath).map((intent) => ({ ...intent, resumeAttempts: 1, resumedAt: WHEN })));
    const gh = fakeGh();
    const next = restart(fx.first, fx.storePath, RESUME, gh);
    try {
      expect((await next.resume()).resumed).toHaveLength(0);
      rmSync(startResumesLogPath(fx.storePath), { force: true });
      writeFileSync(startResumesLogPath(fx.storePath), 'not json at all\n');
      expect((await next.resume()).resumed).toHaveLength(0);
      expect((await next.status(T0 + 60_000)).start.request).toMatchObject({ state: 'interrupted', resumed: true, resumedAt: WHEN });
      expect(gh.calls).toHaveLength(0);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('a missing, corrupt or misleading log changes nothing: the same intent is resumed exactly as with no log', async () => {
    for (const log of [null, 'garbage\n{"x":', `${JSON.stringify({ schema: 'wonderland-start-resume.v1', wljRunId: RUN, intentId: startKeyHash(START_KEY), intentAgeMs: 1, at: WHEN })}\n`]) {
      const { fx } = await crashedAtC1();
      if (log !== null) writeFileSync(startResumesLogPath(fx.storePath), log);
      const gh = fakeGh();
      const next = restart(fx.first, fx.storePath, RESUME, gh);
      try {
        expect((await next.resume()).resumed, String(log)).toEqual([startKeyHash(START_KEY)]);
        await next.wiring.requests.idle();
        expect(workflowCalls(gh)).toBe(1);
      } finally {
        next.close();
        rmSync(fx.dir, { recursive: true, force: true });
      }
    }
  });

  it('a log line that cannot be written refuses the resume (fail closed): no claim, the attempt stays spent, /status says why', async () => {
    const { fx } = await crashedAtC1();
    mkdirSync(startResumesLogPath(fx.storePath));
    const gh = fakeGh();
    let claims = 0;
    const next = restart(fx.first, fx.storePath, RESUME, gh, { wrap: (tool) => ({ ...tool, claim: (input) => { claims += 1; return tool.claim(input); } }) });
    try {
      expect(await next.resume()).toEqual({ resumed: [], refused: [startKeyHash(START_KEY)], reason: 'ran' });
      expect(claims).toBe(0);
      expect(intents(fx.storePath)[0]).toMatchObject({ resumeAttempts: 1, resumeRefused: 'resume_log_unwritable' });
      expect((await next.status(T0 + 60_000)).start.request).toMatchObject({ state: 'interrupted', resumed: true, resumeRefused: 'resume_log_unwritable' });
      rmSync(startResumesLogPath(fx.storePath), { recursive: true });
      expect((await next.resume()).resumed).toHaveLength(0);
      expect(gh.calls).toHaveLength(0);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('a resume count that cannot be written refuses the resume: no log line and no claim', async () => {
    const { fx } = await crashedAtC1();
    const gh = fakeGh();
    let claims = 0;
    const next = restart(fx.first, fx.storePath, RESUME, gh, {
      io: { writeIntents: () => { throw new Error('disk full'); } },
      wrap: (tool) => ({ ...tool, claim: (input) => { claims += 1; return tool.claim(input); } }),
    });
    try {
      expect(await next.resume()).toEqual({ resumed: [], refused: [startKeyHash(START_KEY)], reason: 'ran' });
      expect(claims).toBe(0);
      expect(logLines(fx.storePath)).toHaveLength(0);
      expect(intents(fx.storePath)[0]!.resumeAttempts).toBe(0);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('the claim core re-checks authorization now: a withdrawn lane grant is refused with no workflow call', async () => {
    const { fx } = await crashedAtC1();
    const gh = fakeGh({ withdrawn: true });
    const next = restart(fx.first, fx.storePath, RESUME, gh);
    try {
      expect((await next.resume()).resumed).toHaveLength(1);
      await next.wiring.requests.idle();
      expect(workflowCalls(gh)).toBe(0);
      const request = (await next.status(T0 + 60_000)).start.request;
      expect(request).toMatchObject({ state: 'settled', resumed: true });
      expect(request.outcome.httpStatus).toBe(409);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('the worker and a same-key client retry take the same lock: exactly one claim between them', async () => {
    const { fx } = await crashedAtC1();
    const gh = fakeGh();
    let claims = 0;
    const next = restart(fx.first, fx.storePath, RESUME, gh, { wrap: (tool) => ({ ...tool, claim: (input) => { claims += 1; return tool.claim(input); } }) });
    try {
      const [pass, retry] = await Promise.all([next.resume(), next.start(START_KEY, TRIGGER, T0 + 60_000)]);
      expect(retry?.status).toBe(202);
      expect(retry?.body).toMatchObject({ replayed: true });
      expect(pass.resumed).toEqual([startKeyHash(START_KEY)]);
      await next.wiring.requests.idle();
      expect(claims).toBe(1);
      expect(workflowCalls(gh)).toBe(1);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('a claim for the mission made outside the Start (the operator CLI, no Start binding) blocks the resume', async () => {
    const { fx } = await crashedAtC1();
    const gh = fakeGh();
    const next = restart(fx.first, fx.storePath, RESUME, gh);
    try {
      const claimed = await next.real.claim({
        wonderlandRunId: RUN, serverRunId: intents(fx.storePath)[0]!.serverRunId, repo: REPO, lane: 'lab', workflowSource: '',
        dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION, rerunConfirmation: null,
      });
      expect(claimed.ok).toBe(true);
      expect(workflowCalls(gh)).toBe(1);
      expect(await next.resume()).toEqual({ resumed: [], refused: [], reason: 'ran' });
      expect(intents(fx.storePath)[0]!.resumeAttempts).toBe(0);
      expect(logLines(fx.storePath)).toHaveLength(0);
      expect((await next.status(T0 + 60_000)).start.request.state).toBe('interrupted');
      expect(workflowCalls(gh)).toBe(1);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('a settled intent (a refusal, no claim in the journal) is never resumed', async () => {
    const fx = await fixture(RESUME, fakeGh({ withdrawn: true }));
    await fx.first.start();
    await fx.first.wiring.requests.idle();
    expect(intents(fx.storePath)[0]!.state).toBe('settled');
    const gh = fakeGh();
    const next = restart(fx.first, fx.storePath, RESUME, gh);
    try {
      expect(await next.resume()).toEqual({ resumed: [], refused: [], reason: 'ran' });
      expect(gh.calls).toHaveLength(0);
      expect((await next.status(T0 + 60_000)).start.request.state).toBe('settled');
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('a resume never carries the rerun phrase: with a counted prior paid attempt the claim core refuses it and nothing dispatches', async () => {
    const { fx } = await crashedAtC1();
    const gh = fakeGh({ rerunInput: true });
    const prior: PriorAttemptReader = { read: () => Promise.resolve({ readable: true, counted: 1 }), readCompleted: () => Promise.resolve({ readable: true, counted: 1 }) };
    const next = restart(fx.first, fx.storePath, RESUME, gh, { prior });
    try {
      expect((await next.resume()).resumed).toHaveLength(1);
      await next.wiring.requests.idle();
      expect(workflowCalls(gh)).toBe(0);
      const request = (await next.status(T0 + 60_000)).start.request;
      expect(request).toMatchObject({ state: 'settled', resumed: true });
      expect(request.outcome).toMatchObject({ httpStatus: 409, body: { error: { kind: 'julius_rerun_consent_required' } } });
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('a journal claim that carries the intent\'s key, even for another mission, blocks the resume', async () => {
    const { fx } = await crashedAtC1();
    const gh = fakeGh();
    const next = restart(fx.first, fx.storePath, RESUME, gh);
    try {
      await admit(next.ports, RUN2, ADMIT_KEY2);
      const claimed = await next.real.claim({
        wonderlandRunId: RUN2, serverRunId: (await next.status(T0, RUN2)).serverRunId, repo: REPO, lane: 'lab', workflowSource: '',
        dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION, rerunConfirmation: null,
        start: { startKeyHash: startKeyHash(START_KEY), clientTriggerId: TRIGGER },
      });
      expect(claimed.ok).toBe(true);
      expect(await next.resume()).toEqual({ resumed: [], refused: [], reason: 'ran' });
      expect(intents(fx.storePath).find((i) => i.wljRunId === RUN)!.resumeAttempts).toBe(0);
      expect(workflowCalls(gh)).toBe(1);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('a client retry that relaunched the claim in this process is never resumed beside it', async () => {
    const { fx } = await crashedAtC1();
    const gh = fakeGh({ crash: 'first' });
    let claims = 0;
    const next = restart(fx.first, fx.storePath, RESUME, gh, { wrap: (tool) => ({ ...tool, claim: (input) => { claims += 1; return tool.claim(input); } }) });
    try {
      expect((await next.start(START_KEY, TRIGGER, T0 + 30_000))?.body).toMatchObject({ ack: 'accepted', replayed: true });
      await gh.frozen;
      expect(next.wiring.requests.live(RUN)).toBe(startKeyHash(START_KEY));
      expect((await next.status(T0 + 30_000)).start.request.state).toBe('claiming');
      expect((await next.resume()).resumed).toHaveLength(0);
      expect(claims).toBe(1);
      expect(intents(fx.storePath)[0]!.resumeAttempts).toBe(0);
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  it('unreconciledClaimInStore: the latest event of each claim; dispatching (attempted or not) and G8 block, settled outcomes do not', () => {
    const event = (wlj: string, state: string, dispatchError: string | null = null) => ({ wonderlandRunId: wlj, serverRunId: `s-${wlj}`, state, dispatchError, dispatchAttempted: true }) as unknown as ClaimEvent;
    const doc = (claims: ClaimEvent[]) => ({ version: 1, revision: 1, admissions: [], claims, progress: [] }) as OperatorDocument;
    expect(unreconciledClaimInStore(doc([]))).toBe(false);
    expect(unreconciledClaimInStore(doc([event(RUN2, 'dispatching')]))).toBe(true);
    expect(unreconciledClaimInStore(doc([event(RUN2, 'dispatch_failed', 'gh_workflow_run_failed')]))).toBe(true);
    expect(unreconciledClaimInStore(doc([event(RUN2, 'dispatching'), event(RUN2, 'dispatched')]))).toBe(false);
    expect(unreconciledClaimInStore(doc([event(RUN2, 'dispatching'), event(RUN2, 'dispatch_failed', 'gh_workflow_run_not_started')]))).toBe(false);
    expect(unreconciledClaimInStore(doc([event(RUN, 'dispatched'), event(RUN2, 'dispatching')]))).toBe(true);
  });

  it('nothing resumes while any claim in the store is unreconciled, even another mission\'s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-intent-'));
    const storePath = join(dir, 'admission.json');
    const gh1 = fakeGh({ crash: 'before_spawn' });
    const first = bridge(storePath, RESUME, gh1);
    await admit(first.ports);
    await admit(first.ports, RUN2, ADMIT_KEY2);
    // RUN2: a reservation whose process died before spawn (dispatching in the journal).
    expect((await first.start(OTHER_KEY, TRIGGER, T0, RUN2))?.status).toBe(202);
    await gh1.frozen;
    // RUN: an intent whose process died before any gh call (a separate bridge in the same process after the first froze).
    const gh2 = fakeGh({ crash: 'first' });
    const second = restart(first, storePath, RESUME, gh2);
    expect((await second.start(START_KEY))?.status).toBe(202);
    await gh2.frozen;
    const gh3 = fakeGh();
    const third = restart(second, storePath, RESUME, gh3);
    try {
      expect(await third.resume()).toEqual({ resumed: [], refused: [], reason: 'unreconciled_claim_in_store' });
      expect(intents(storePath).find((i) => i.wljRunId === RUN)!.resumeAttempts).toBe(0);
      expect(gh3.calls).toHaveLength(0);
    } finally {
      third.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('A-9 crash windows C0-C4 (Addendum 2): a restart never adds a dispatch', () => {
  const cases: [string, Crash | 'c0' | 'c4', number][] = [
    ['C0 before the intent is saved', 'c0', 1],
    ['C1 intent saved, claim not reserved', 'first', 1],
    ['C2 reserved (dispatching), gh workflow run never made', 'before_spawn', 0],
    ['C3 right after spawn: the journal says dispatching', 'after_spawn', 1],
    ['C4 dispatched in the journal, the intent never settled', 'c4', 1],
  ];
  it.each(cases)('%s', async (_label, crash, total) => {
    let signal: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => { signal = resolve; });
    const gh = fakeGh({ crash: crash === 'c0' || crash === 'c4' ? 'none' : crash });
    const fx = await fixture(RESUME, gh, crash === 'c0'
      ? { io: { writeIntents: () => { signal(); throw new Error('crash'); } } }
      : crash === 'c4' ? { wrap: (tool) => crashAfterClaim(tool, signal) } : {});
    if (crash !== 'c0' && crash !== 'c4') void gh.frozen.then(signal);
    await fx.first.start();
    await reached;
    const after = fakeGh();
    const next = restart(fx.first, fx.storePath, RESUME, after);
    try {
      const pass = await next.resume();
      if (crash === 'before_spawn' || crash === 'after_spawn') expect(pass.reason).toBe('unreconciled_claim_in_store');
      await next.wiring.requests.idle();
      const retry = await next.start(START_KEY, TRIGGER, T0 + 60_000);
      await next.wiring.requests.idle();
      await next.resume(T0 + 120_000);
      await next.wiring.requests.idle();
      expect(workflowCalls(gh) + workflowCalls(after)).toBe(total);
      if (crash === 'before_spawn' || crash === 'after_spawn' || crash === 'c4') {
        // The journal holds a claim: the retry replays it and the intent is never resumed.
        expect(retry?.status).toBe(200);
        expect(workflowCalls(after)).toBe(0);
        expect(intents(fx.storePath)[0]!.resumeAttempts).toBe(0);
        expect(logLines(fx.storePath)).toHaveLength(0);
        const status = await next.status(T0 + 120_000);
        expect(status.start.request.state).not.toBe('accepted');
        expect(status.start.request.state).not.toBe('claiming');
        expect(status.start.requested).toBe(true);
      }
    } finally {
      next.close();
      rmSync(fx.dir, { recursive: true, force: true });
    }
  });
});

describe('A-9: 20 restarts over one store end with exactly one legitimate workflow call', () => {
  type Mode = 'ok' | 'c0' | 'c1' | 'c2' | 'c3' | 'c4';
  const MODES: readonly Mode[] = ['ok', 'c0', 'c1', 'c2', 'c3', 'c4'];
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  async function loop(modes: readonly Mode[]) {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-loop-'));
    const storePath = join(dir, 'admission.json');
    const ghs: Gh[] = [];
    let current: Bridge | null = null;
    let firstReserving: Mode | null = null;
    try {
      for (const [i, mode] of modes.entries()) {
        let signal: () => void = () => undefined;
        const reached = new Promise<void>((resolve) => { signal = resolve; });
        const crash: Crash = mode === 'c1' ? 'first' : mode === 'c2' ? 'before_spawn' : mode === 'c3' ? 'after_spawn' : 'none';
        const gh = fakeGh({ crash });
        ghs.push(gh);
        void gh.frozen.then(signal);
        const opts = mode === 'c4' ? { wrap: (tool: OperatorClaimTool) => crashAfterClaim(tool, signal) } : {};
        current = current === null ? bridge(storePath, RESUME, gh, opts) : restart(current, storePath, RESUME, gh, opts);
        if (i === 0) await admit(current.ports);
        if (mode === 'c0') continue;
        const now = T0 + i * 10_000;
        const hadClaim = firstReserving !== null;
        await current.resume(now);
        await current.start(START_KEY, TRIGGER, now);
        if (mode === 'ok') {
          await current.wiring.requests.idle();
        } else {
          await Promise.race([reached, tick(150)]);
        }
        if (!hadClaim && ['ok', 'c2', 'c3', 'c4'].includes(mode) && (current.wiring.requests.live(RUN) !== null || mode === 'ok')) firstReserving = mode;
      }
      // A last, healthy bridge: retry and resume once more.
      const last = fakeGh();
      ghs.push(last);
      current = restart(current!, storePath, RESUME, last);
      await current.resume(T0 + modes.length * 10_000);
      await current.start(START_KEY, TRIGGER, T0 + modes.length * 10_000);
      await current.wiring.requests.idle();
      const total = ghs.reduce((sum, gh) => sum + workflowCalls(gh), 0);
      return { total, firstReserving, intents: intents(storePath), status: await current.status(T0 + modes.length * 10_000 + 1) };
    } finally {
      try { current?.close(); } catch { /* closed */ }
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('a fixed sequence through every crash window before success: one call', async () => {
    const result = await loop(['c1', 'c0', 'c1', 'c0', 'c1', 'ok', 'c3', 'c2', 'c4', 'c1', 'ok', 'c0', 'c1', 'c2', 'ok', 'c3', 'c4', 'c1', 'ok', 'c0']);
    expect(result.total).toBe(1);
    expect(result.status.phase).toBe('dispatched');
    expect(result.status.start).toMatchObject({ requested: true, startKeyHash: startKeyHash(START_KEY), workflowRunId: WORKFLOW_RUN });
    expect(result.status.start.request).toMatchObject({ resumed: true });
    expect(result.intents[0]!.resumeAttempts).toBe(1);
  }, 120_000);

  it.each([1, 2, 3, 7, 42, 2026])('seed %i: twenty random restarts, at most one call, and exactly one unless the first reservation died before spawn (C2)', async (seed) => {
    const next = rng(seed);
    const modes = Array.from({ length: 20 }, () => MODES[Math.floor(next() * MODES.length)]!);
    const result = await loop(modes);
    const firstReserving = modes.find((mode) => ['ok', 'c2', 'c3', 'c4'].includes(mode));
    expect(result.total, modes.join(',')).toBe(firstReserving === 'c2' ? 0 : 1);
  }, 120_000);
});
