import { createHash } from 'node:crypto';
import { subscribe as subscribeDiagnostic, unsubscribe as unsubscribeDiagnostic } from 'node:diagnostics_channel';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { classifyDispatchAnswer, createMemoryAdmissionLedger, errorKindOf } from '../src/relay/integration/wonderland-admission';
import type { AdmissionLedger, AdmissionLedgerRow } from '../src/relay/integration/wonderland-admission';
import { createFileAdmissionLedger } from '../src/relay/integration/wonderland-admission/admission-file';
import { createBrowserSessionStore } from './browser-session/grants';
import { handleJuliusMissionRoute, isJuliusMissionRoute } from './julius-mission-routes';
import {
  createWonderlandAdmissionBridge,
  createWonderlandAdmissionService,
  handleWonderlandAdmissionRoute,
  isWonderlandAdmissionRoute,
  WONDERLAND_ADMISSION_PATH,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import { classifyWonderlandDispatchPath, handleWonderlandRoute, isWonderlandRoute } from './wonderland-routes';
import { WonderlandBackend } from '../src/relay/mission/wonderland/wonderland-backend';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const KEY = '11111111-2222-4333-8444-555555555555';
const WHEN = '2026-10-23T16:15:00.000Z';
const LOG = 'ab'.repeat(32);

function env(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_J1_PROJECT_ID: 'project-1',
    JULIUS_WONDERLAND_MISSION: 'julius-inworld-data-1',
    ...over,
  };
}

function request(over: Partial<WonderlandAdmissionRouteRequest> = {}): WonderlandAdmissionRouteRequest {
  return {
    method: 'POST',
    path: WONDERLAND_ADMISSION_PATH,
    url: `${WONDERLAND_ADMISSION_PATH}?projectId=project-1`,
    authorization: 'Relay-Session native-token',
    origin: undefined,
    rawBody: JSON.stringify({
      runId: RUN,
      clientTriggerId: 'trigger_01',
      clientLogSha256: LOG,
      clientUiActionUtc: WHEN,
    }),
    idempotencyKey: KEY,
    remoteAddress: '127.0.0.1',
    host: 'localhost',
    forwarded: false,
    nowIso: WHEN,
    nowMs: Date.parse(WHEN),
    ...over,
  };
}

function service(over: {
  env?: Record<string, string | undefined>;
  ledger?: AdmissionLedger;
  mintServerRunId?: () => string;
} = {}) {
  return createWonderlandAdmissionService({
    env: over.env ?? env(),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => token === 'native-token'
      ? { playerId: 'founder', projectId: 'project-1', sessionId: 'sess-1' }
      : null,
    readWorkflowText: () => null,
    ledger: over.ledger ?? createMemoryAdmissionLedger(),
    mintServerRunId: over.mintServerRunId,
  });
}

function kind(body: unknown): string {
  return errorKindOf(body).kind;
}

describe('POST /wonderland/julius/dispatch', () => {
  it('is off unless the flag is exactly 1, and reserves nothing', async () => {
    let appends = 0;
    const ledger: AdmissionLedger = {
      async rows() { return []; },
      async append() { appends += 1; },
    };
    const ports = service({ env: env({ JULIUS_WONDERLAND_ADMISSION: undefined }), ledger });
    const result = await handleWonderlandAdmissionRoute(request(), ports);
    expect(result?.status).toBe(503);
    expect(kind(result?.body)).toBe('julius_dispatch_disabled');
    expect(classifyDispatchAnswer(503, true, 'julius_dispatch_disabled')).toBe('Refused');
    expect(appends).toBe(0);
  });

  it('stays disabled when the flag is off and no store path is set', async () => {
    const ports = createWonderlandAdmissionService({
      env: env({ JULIUS_WONDERLAND_ADMISSION: undefined }),
      operatorToken: 'operator-token',
      verifyNativeSession: () => null,
      readWorkflowText: () => null,
    });
    const result = await handleWonderlandAdmissionRoute(request(), ports);
    expect(result?.status).toBe(503);
    expect(kind(result?.body)).toBe('julius_dispatch_disabled');
  });

  it('a missing, relative, or URL store path is julius_dispatch_unavailable', async () => {
    const paths = [undefined, 'admission.json', './admission.json', 'https://example.com/admission.json', 'file:///tmp/admission.json'];
    for (const storePath of paths) {
      const ports = createWonderlandAdmissionService({
        env: env({ JULIUS_WONDERLAND_ADMISSION_STORE: storePath }),
        operatorToken: 'operator-token',
        verifyNativeSession: () => ({ playerId: 'founder', projectId: 'project-1', sessionId: 'sess-1' }),
        readWorkflowText: () => null,
      });
      const result = await handleWonderlandAdmissionRoute(request(), ports);
      expect(result?.status, String(storePath)).toBe(503);
      expect(kind(result?.body), String(storePath)).toBe('julius_dispatch_unavailable');
      expect(classifyDispatchAnswer(503, true, 'julius_dispatch_unavailable')).toBe('Refused');
    }
  });

  it('a second opener gets 503 while the writer lock is held', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wonderland-admission-lock-'));
    const file = join(dir, 'admission.json');
    const holder = createFileAdmissionLedger(file);
    try {
      const ports = createWonderlandAdmissionService({
        env: env({ JULIUS_WONDERLAND_ADMISSION_STORE: file }),
        operatorToken: 'operator-token',
        verifyNativeSession: () => ({ playerId: 'founder', projectId: 'project-1', sessionId: 'sess-1' }),
        readWorkflowText: () => null,
      });
      const result = await handleWonderlandAdmissionRoute(request(), ports);
      expect(result?.status).toBe(503);
      expect(kind(result?.body)).toBe('julius_dispatch_unavailable');
      ports.close();
    } finally {
      holder.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a corrupt store file is 503 and the bytes stay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wonderland-admission-corrupt-'));
    const file = join(dir, 'admission.json');
    const bytes = Buffer.from('{"schemaVersion":999,"rows":[]}\n');
    writeFileSync(file, bytes);
    try {
      const ports = createWonderlandAdmissionService({
        env: env({ JULIUS_WONDERLAND_ADMISSION_STORE: file }),
        operatorToken: 'operator-token',
        verifyNativeSession: () => ({ playerId: 'founder', projectId: 'project-1', sessionId: 'sess-1' }),
        readWorkflowText: () => null,
      });
      const result = await handleWonderlandAdmissionRoute(request(), ports);
      expect(result?.status).toBe(503);
      expect(kind(result?.body)).toBe('julius_dispatch_unavailable');
      expect(readFileSync(file)).toEqual(bytes);
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an injected write failure keeps the pair and does not publish a row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wonderland-admission-unwritten-'));
    const file = join(dir, 'admission.json');
    const ledger = createFileAdmissionLedger(file, {
      persist() { throw new Error('disk full'); },
    });
    try {
      const ports = createWonderlandAdmissionService({
        env: env(),
        operatorToken: 'operator-token',
        verifyNativeSession: () => ({ playerId: 'founder', projectId: 'project-1', sessionId: 'sess-1' }),
        readWorkflowText: () => null,
        ledger,
        mintServerRunId: () => `run:${'a'.repeat(24)}`,
      });
      const first = await handleWonderlandAdmissionRoute(request(), ports);
      const second = await handleWonderlandAdmissionRoute(request(), ports);
      expect(first?.status).toBe(202);
      expect((first?.body as { data: { state: string; serverRunId: string } }).data.state).toBe('LEDGER_UNWRITTEN');
      expect(second?.status).toBe(200);
      expect((second?.body as { data: { serverRunId: string; state: string } }).data.serverRunId).toBe(`run:${'a'.repeat(24)}`);
      expect((second?.body as { data: { state: string } }).data.state).toBe('LEDGER_UNWRITTEN');
      const parked = JSON.parse(readFileSync(file, 'utf8')) as { rows: { state: string; serverRunId: string }[] };
      expect(parked.rows).toEqual([expect.objectContaining({
        state: 'LEDGER_UNWRITTEN',
        serverRunId: `run:${'a'.repeat(24)}`,
      })]);
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a pair once and replays it as 200 with no error object', async () => {
    const ports = service();
    const first = await handleWonderlandAdmissionRoute(request(), ports);
    const second = await handleWonderlandAdmissionRoute(request(), ports);
    expect(first?.status).toBe(202);
    expect(second?.status).toBe(200);
    const firstKind = errorKindOf(first?.body);
    const secondKind = errorKindOf(second?.body);
    expect(firstKind.hasError).toBe(false);
    expect(secondKind.hasError).toBe(false);
    expect(classifyDispatchAnswer(first?.status ?? 0, firstKind.hasError, firstKind.kind)).toBe('Accepted');
    expect(classifyDispatchAnswer(second?.status ?? 0, secondKind.hasError, secondKind.kind)).toBe('Accepted');
    const created = (first?.body as { data: { dispatchId: string; serverRunId: string; dispatched: boolean; confirmLive: string; submittedToPaidWorkflow: boolean; state: string } }).data;
    const replayed = (second?.body as { data: { dispatchId: string; serverRunId: string; state: string; replayed: boolean; correlation: { resultSha256: null; requestId: string } } }).data;
    expect(replayed.dispatchId).toBe(created.dispatchId);
    expect(created.serverRunId).toMatch(/^run:[0-9a-f]{24}$/);
    expect(replayed.serverRunId).toBe(created.serverRunId);
    expect(replayed.replayed).toBe(true);
    expect(replayed.state).toBe('ADMISSION_HELD');
    expect(created.dispatched).toBe(false);
    expect(created.confirmLive).toBe('');
    expect(created.submittedToPaidWorkflow).toBe(false);
    expect(replayed.correlation.resultSha256).toBeNull();
    expect(replayed.correlation.requestId).toBe('trigger_01');
    const expectedHash = createHash('sha256').update(KEY).digest('hex');
    expect((first?.body as { data: { correlation: { idempotencyKeyHash: string } } }).data.correlation.idempotencyKeyHash).toBe(expectedHash);
  });

  it('a concurrent resend during the ledger write returns the one run', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let appends = 0;
    const ledger: AdmissionLedger = {
      async rows() { return []; },
      async append() {
        appends += 1;
        await gate;
      },
    };
    const ports = service({ ledger });
    const first = handleWonderlandAdmissionRoute(request(), ports);
    const second = handleWonderlandAdmissionRoute(request(), ports);
    const replay = await second;
    expect(appends).toBe(1);
    expect(replay?.status).toBe(200);
    expect(errorKindOf(replay?.body).hasError).toBe(false);
    expect(JSON.stringify(replay?.body)).not.toContain('julius_dispatch_busy');
    const replayId = (replay?.body as { data: { dispatchId: string; state: string } }).data;
    expect(replayId.state).toBe('RESERVED');
    release();
    const created = await first;
    expect(created?.status).toBe(202);
    expect((created?.body as { data: { dispatchId: string; state: string } }).data.dispatchId).toBe(replayId.dispatchId);
    expect((created?.body as { data: { state: string } }).data.state).toBe('ADMISSION_HELD');
    expect(appends).toBe(1);
  });

  it('a failed reservation is a bare 500 and does not leak the minted id', async () => {
    const minted: string[] = [];
    const valid = `run:${'ab'.repeat(12)}`;
    const ports = service({
      mintServerRunId: () => {
        const id = minted.length === 0 ? 'run:not-a-bootstrap-id' : valid;
        minted.push(id);
        return id;
      },
    });
    const failed = await handleWonderlandAdmissionRoute(request(), ports);
    expect(failed).toEqual({ status: 500, body: {} });
    expect(classifyDispatchAnswer(500, false, '')).toBe('NoAnswer');
    const created = await handleWonderlandAdmissionRoute(request(), ports);
    const replayed = await handleWonderlandAdmissionRoute(request(), ports);
    expect(created?.status).toBe(202);
    expect(replayed?.status).toBe(200);
    const createdId = (created?.body as { data: { serverRunId: string } }).data.serverRunId;
    const replayedId = (replayed?.body as { data: { serverRunId: string } }).data.serverRunId;
    expect(createdId).toBe(valid);
    expect(replayedId).toBe(valid);
    expect(JSON.stringify(created?.body)).not.toContain('run:not-a-bootstrap-id');
    expect(minted).toEqual(['run:not-a-bootstrap-id', valid]);
  });

  it('the two cap kinds are the only 429 refusals the route returns', async () => {
    const ports = service({ env: env({ JULIUS_J1_DAILY_CAP: '1' }) });
    const first = await handleWonderlandAdmissionRoute(request(), ports);
    expect(first?.status).toBe(202);
    const other = await handleWonderlandAdmissionRoute(request({
      idempotencyKey: '99999999-8888-4777-a666-555555555555',
      rawBody: JSON.stringify({
        runId: 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        clientTriggerId: 'trigger_02',
        clientLogSha256: LOG,
        clientUiActionUtc: WHEN,
      }),
    }), ports);
    expect(other?.status).toBe(429);
    expect(kind(other?.body)).toBe('julius_dispatch_cap_reached');
    expect(classifyDispatchAnswer(429, true, kind(other?.body))).toBe('Refused');
  });

  it('a non-founder native session is founder_only', async () => {
    const ports = createWonderlandAdmissionService({
      env: env(),
      operatorToken: 'operator-token',
      verifyNativeSession: ({ token }) => token === 'other-token'
        ? { playerId: 'other-player', projectId: 'project-1', sessionId: 'sess-2' }
        : null,
      readWorkflowText: () => null,
      ledger: createMemoryAdmissionLedger(),
    });
    const result = await handleWonderlandAdmissionRoute(request({
      authorization: 'Relay-Session other-token',
    }), ports);
    expect(result?.status).toBe(403);
    expect(kind(result?.body)).toBe('julius_dispatch_founder_only');
  });

  it('anything isLoopbackPeer rejects is not_loopback', async () => {
    const ports = service();
    const cases: Array<Partial<WonderlandAdmissionRouteRequest>> = [
      { forwarded: true },
      { remoteAddress: '8.8.8.8' },
      { remoteAddress: undefined },
      { host: 'example.com' },
      { host: undefined },
      { host: '127.0.0.1.example' },
    ];
    for (const over of cases) {
      const result = await handleWonderlandAdmissionRoute(request(over), ports);
      expect(result?.status, JSON.stringify(over)).toBe(403);
      expect(kind(result?.body), JSON.stringify(over)).toBe('julius_dispatch_not_loopback');
    }
  });

  it('a queried path still reaches the admission handler', async () => {
    const queried = `${WONDERLAND_ADMISSION_PATH}?projectId=project-1`;
    const result = await handleWonderlandAdmissionRoute(request({ path: queried, url: queried }), service());
    expect(result?.status).toBe(202);
    expect((result?.body as { data: { state: string } }).data.state).toBe('ADMISSION_HELD');
  });

  it('refuses the operator credential, a browser origin, and a missing session with the J1 kinds', async () => {
    const ports = service();
    const operator = await handleWonderlandAdmissionRoute(request({ authorization: 'Bearer operator-token' }), ports);
    const browser = await handleWonderlandAdmissionRoute(request({ origin: 'https://sunday-relay.vercel.app' }), ports);
    const signedOut = await handleWonderlandAdmissionRoute(request({ authorization: undefined }), ports);
    expect(kind(operator?.body)).toBe('julius_dispatch_operator_is_not_the_game');
    expect(kind(browser?.body)).toBe('julius_dispatch_browser_refused');
    expect(signedOut?.status).toBe(401);
    expect(kind(signedOut?.body)).toBe('sign_in_required');
  });

  it('reads model pins from the workflow text and does not invent one that is missing', async () => {
    const source = readFileSync(join(__dirname, '../.github/workflows/julius-first-live-mission.yml'), 'utf8');
    const ports = createWonderlandAdmissionService({
      env: env(),
      operatorToken: 'operator-token',
      verifyNativeSession: () => ({ playerId: 'founder', projectId: 'project-1', sessionId: 'sess-1' }),
      readWorkflowText: () => source,
      ledger: createMemoryAdmissionLedger(),
    });
    const result = await handleWonderlandAdmissionRoute(request(), ports);
    const pins = (result?.body as { data: { modelPins: { architectModel: string; codingModel: string; reviewerProvider: string; reviewerModel: string } } }).data.modelPins;
    expect(pins).toEqual({
      architectModel: 'gpt-5.6-sol',
      codingModel: 'claude-opus-5-5',
      reviewerProvider: 'xai',
      reviewerModel: 'grok-build-0.1',
    });
  });
});

describe('admission path exclusion is exact', () => {
  const ORIGIN = 'https://sunday-relay.vercel.app';
  const NOW = 1_700_000_000_000;
  const VARIANTS = [
    '/wonderland/julius/dispatch/',
    '/Wonderland/Julius/Dispatch',
    '/wonderland/julius/dispatch/x',
  ] as const;
  const CONTROL = '/wonderland/no-such-route';

  function bridgePath(raw: string): string {
    return raw.split('?')[0].replace(/\/+$/, '') || '/';
  }

  async function catchAll(path: string, authorization?: string) {
    return handleWonderlandRoute({
      method: 'POST',
      path,
      url: path,
      authorization,
      origin: authorization === undefined ? undefined : ORIGIN,
      body: {},
      now: NOW,
    }, {
      backend: WonderlandBackend.empty(),
      sessions: sessions,
      response: {} as never,
      request: {} as never,
    });
  }

  let sessions = createBrowserSessionStore();
  let playerToken = '';

  beforeAll(() => {
    sessions = createBrowserSessionStore();
    const minted = sessions.mintIdentitySession({
      origin: ORIGIN, now: NOW, participantId: 'founder', scope: 'browser_control',
    });
    if (!minted.ok) throw new Error('session mint failed');
    playerToken = `Relay-Session ${minted.session.token}`;
  });

  it('excludes only the exact admission path', () => {
    expect(isWonderlandRoute(WONDERLAND_ADMISSION_PATH)).toBe(false);
    expect(isWonderlandAdmissionRoute(WONDERLAND_ADMISSION_PATH)).toBe(true);
    const exact = classifyWonderlandDispatchPath(WONDERLAND_ADMISSION_PATH, WONDERLAND_ADMISSION_PATH);
    expect(exact).toEqual({ catchAllPath: null, exactAdmission: true });
  });

  it('a query on the admission pathname is admission', () => {
    const queried = `${WONDERLAND_ADMISSION_PATH}?projectId=project-1`;
    expect(isWonderlandAdmissionRoute(queried)).toBe(true);
    expect(isWonderlandRoute(queried)).toBe(false);
    expect(classifyWonderlandDispatchPath(WONDERLAND_ADMISSION_PATH, queried)).toEqual({
      catchAllPath: null,
      exactAdmission: true,
    });
  });

  it('sends slash, case, and child variants through the catch-all refusal', async () => {
    const signedOut = await catchAll(CONTROL);
    const signedIn = await catchAll(CONTROL, playerToken);
    expect(signedOut).toEqual({ status: 401, body: { error: 'authenticated player identity required' } });
    expect(signedIn).toEqual({ status: 404, body: { error: 'Wonderland route not found' } });
    for (const raw of VARIANTS) {
      const classified = classifyWonderlandDispatchPath(bridgePath(raw), raw);
      expect(classified.exactAdmission, raw).toBe(false);
      expect(classified.catchAllPath, raw).not.toBeNull();
      expect(isWonderlandAdmissionRoute(raw), raw).toBe(false);
      expect(isWonderlandRoute(classified.catchAllPath ?? ''), raw).toBe(true);
      expect(await catchAll(classified.catchAllPath ?? '')).toEqual(signedOut);
      expect(await catchAll(classified.catchAllPath ?? '', playerToken)).toEqual(signedIn);
      expect(await handleJuliusMissionRoute({
        method: 'POST',
        path: raw,
        operator: true,
        body: '{}',
      }, {
        bootstrap: () => { throw new Error('create path must not run'); },
        missingConfig: [],
        reviewerProvider: 'xai',
        cardRevision: 'card:julius-live:1',
      })).toBeNull();
    }
  });
});

describe('mission-handler wiring', () => {
  it('leaves the Wonderland catch-all and is served by the mission handler', async () => {
    expect(isWonderlandRoute(WONDERLAND_ADMISSION_PATH)).toBe(false);
    expect(isWonderlandRoute('/wonderland/presence/join')).toBe(true);
    expect(isJuliusMissionRoute(WONDERLAND_ADMISSION_PATH)).toBe(false);
    expect(isJuliusMissionRoute('/julius/missions')).toBe(true);
    const ports = service();
    const admitted = await handleJuliusMissionRoute({
      method: 'POST',
      path: WONDERLAND_ADMISSION_PATH,
      operator: false,
      body: request().rawBody,
      authorization: 'Relay-Session native-token',
      idempotencyKey: KEY,
      remoteAddress: '127.0.0.1',
      host: 'localhost',
      forwarded: false,
      url: `${WONDERLAND_ADMISSION_PATH}?projectId=project-1`,
      nowIso: WHEN,
      nowMs: Date.parse(WHEN),
    }, {
      bootstrap: null,
      missingConfig: ['JULIUS_DATABASE_URL'],
      reviewerProvider: null,
      cardRevision: 'card:julius-live:1',
      wonderlandAdmissionBridge: createWonderlandAdmissionBridge(ports),
    });
    expect(admitted?.status).toBe(202);
    expect(admitted?.body).not.toHaveProperty('error');
    const again = await handleJuliusMissionRoute({
      method: 'POST',
      path: WONDERLAND_ADMISSION_PATH,
      operator: false,
      body: request().rawBody,
      authorization: 'Relay-Session native-token',
      idempotencyKey: KEY,
      remoteAddress: '127.0.0.1',
      host: 'localhost',
      forwarded: false,
      url: `${WONDERLAND_ADMISSION_PATH}?projectId=project-1`,
      nowIso: WHEN,
      nowMs: Date.parse(WHEN),
    }, {
      bootstrap: null,
      missingConfig: ['JULIUS_DATABASE_URL'],
      reviewerProvider: null,
      cardRevision: 'card:julius-live:1',
      wonderlandAdmissionBridge: createWonderlandAdmissionBridge(ports),
    });
    expect(again?.status).toBe(200);
    const unwired = await handleJuliusMissionRoute({
      method: 'POST',
      path: WONDERLAND_ADMISSION_PATH,
      operator: true,
      body: request().rawBody,
      remoteAddress: '127.0.0.1',
      host: 'localhost',
      forwarded: false,
      nowIso: WHEN,
      nowMs: Date.parse(WHEN),
    }, {
      bootstrap: () => { throw new Error('create path must not run'); },
      missingConfig: [],
      reviewerProvider: 'xai',
      cardRevision: 'card:julius-live:1',
    });
    expect(unwired).toBeNull();
  });
});

const MARKERS = {
  relayNorthMarker: 'pine',
  relaySouthMarker: 'oak',
  relayEastMarker: 'reed',
  relayWestMarker: 'moss',
} as const;

function assertNoMarker(value: unknown): void {
  const text = JSON.stringify(value);
  for (const marker of Object.values(MARKERS)) expect(text).not.toContain(marker);
}

const NETWORK_CHANNELS = [
  'http.client.request.start',
  'net.client.socket',
  'undici:request:create',
  'undici:client:beforeConnect',
  'child_process',
] as const;

function armIsolation(): { hits: string[]; restore: () => void } {
  const hits: string[] = [];
  const listeners = NETWORK_CHANNELS.map((name) => {
    const listener = () => { hits.push(name); };
    subscribeDiagnostic(name, listener);
    return { name, listener };
  });
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
    hits.push('fetch');
    throw new Error('admission must not call fetch');
  }) as typeof fetch);
  return {
    hits,
    restore() {
      fetchSpy.mockRestore();
      for (const { name, listener } of listeners) unsubscribeDiagnostic(name, listener);
    },
  };
}

describe('admission holds no provider keys and runs no paid role', () => {
  it('admit, resend, cap, and failure neither call out nor copy the markers', async () => {
    const isolation = armIsolation();
    const recorded: AdmissionLedgerRow[] = [];
    const ledger: AdmissionLedger = {
      async rows() { return recorded.slice(); },
      async append(row) { recorded.push(row); },
    };
    const failedWrites: AdmissionLedgerRow[] = [];
    const failingLedger: AdmissionLedger = {
      async rows() { return []; },
      async append(row) {
        failedWrites.push(row);
        throw new Error('ledger down');
      },
    };
    const withKeys = {
      ...env({ JULIUS_J1_DAILY_CAP: '1' }),
      ...MARKERS,
    };
    try {
      const ports = createWonderlandAdmissionService({
        env: withKeys,
        operatorToken: 'operator-token',
        verifyNativeSession: ({ token }) => token === 'native-token'
          ? { playerId: 'founder', projectId: 'project-1', sessionId: 'sess-1' }
          : null,
        readWorkflowText: () => null,
        ledger,
      });
      const admitted = await handleWonderlandAdmissionRoute(request(), ports);
      const resent = await handleWonderlandAdmissionRoute(request(), ports);
      const capped = await handleWonderlandAdmissionRoute(request({
        idempotencyKey: '99999999-8888-4777-a666-555555555555',
        rawBody: JSON.stringify({
          runId: 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          clientTriggerId: 'trigger_02',
          clientLogSha256: LOG,
          clientUiActionUtc: WHEN,
        }),
      }), ports);
      const failed = await handleWonderlandAdmissionRoute(request({ nowIso: 'not-a-time' }), ports);
      const failingPorts = createWonderlandAdmissionService({
        env: withKeys,
        operatorToken: 'operator-token',
        verifyNativeSession: () => ({ playerId: 'founder', projectId: 'project-1', sessionId: 'sess-1' }),
        readWorkflowText: () => null,
        ledger: failingLedger,
      });
      const unwritten = await handleWonderlandAdmissionRoute(request({
        idempotencyKey: '22222222-3333-4444-8555-666666666666',
        rawBody: JSON.stringify({
          runId: 'wlj_bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          clientTriggerId: 'trigger_03',
          clientLogSha256: LOG,
          clientUiActionUtc: WHEN,
        }),
      }), failingPorts);

      expect(admitted?.status).toBe(202);
      expect(resent?.status).toBe(200);
      expect(capped?.status).toBe(429);
      expect(kind(capped?.body)).toBe('julius_dispatch_cap_reached');
      expect(failed).toEqual({ status: 500, body: {} });
      expect(unwritten?.status).toBe(202);
      expect((unwritten?.body as { data: { state: string; dispatched: boolean } }).data.state).toBe('LEDGER_UNWRITTEN');
      expect((admitted?.body as { data: { dispatched: boolean; confirmLive: string } }).data).toMatchObject({
        dispatched: false,
        confirmLive: '',
      });
      const bodies = [admitted?.body, resent?.body, capped?.body, failed?.body, unwritten?.body];
      for (const body of bodies) assertNoMarker(body);
      expect(recorded).toHaveLength(1);
      expect(failedWrites).toHaveLength(1);
      assertNoMarker(recorded);
      assertNoMarker(failedWrites);
      expect(isolation.hits).toEqual([]);
    } finally {
      isolation.restore();
    }
  });
});

const ADMISSION_SOURCES = [
  ...readdirSync(join(__dirname, '../src/relay/integration/wonderland-admission'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(__dirname, '../src/relay/integration/wonderland-admission', name)),
  join(__dirname, 'wonderland-admission-route.ts'),
];

const ALLOWED_ENV_READS = new Set([
  'JULIUS_J1_PROJECT_ID',
  'JULIUS_J1_FOUNDER_PLAYER_ID',
  'JULIUS_WONDERLAND_MISSION',
  'JULIUS_J1_DAILY_CAP',
  'JULIUS_J1_MAX_RUNS_PER_MISSION',
  'JULIUS_WONDERLAND_ADMISSION_STORE',
]);

const FORBIDDEN_IMPORT = /(?:^|\/)julius(?:\/|$)|julius-dispatch|child_process|(?:^|:)(?:http2?|https|net|tls|dgram)$|undici|node-fetch|(?:^|\/)axios(?:\/|$)|(?:^|\/)openai(?:\/|$)|@anthropic|@ai-sdk|(?:^|\/)xai(?:\/|$)/u;

describe('admission sources import no provider, process, or secret', () => {
  it('imports nothing that can spend, and reads no provider or dispatch secret', () => {
    expect(ADMISSION_SOURCES.length).toBeGreaterThanOrEqual(4);
    for (const file of ADMISSION_SOURCES) {
      const source = readFileSync(file, 'utf8');
      const specifiers = [
        ...source.matchAll(/^\s*(?:import|export)[^;]*?\bfrom\s+['"]([^'"]+)['"]/gmu),
        ...source.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
      ].map((match) => match[1]);
      for (const specifier of specifiers) {
        expect(FORBIDDEN_IMPORT.test(specifier), `${file} imports ${specifier}`).toBe(false);
      }
      expect(source, file).not.toMatch(/\bprocess\.env\b/);
      expect(source, file).not.toMatch(/_API_KEY/);
      expect(source, file).not.toMatch(/\bGITHUB_TOKEN\b/);
      expect(source, file).not.toMatch(/\bGH_TOKEN\b/);
      expect(source, file).not.toMatch(/\bchild_process\b/);
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
      expect(source, file).not.toMatch(/\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(/);
      expect(source, file).not.toMatch(/\bhttps?\.(?:request|get)\s*\(/);
      expect(source, file).not.toMatch(/github\.event/);
      const withoutGateLabel = source.split('workflow_dispatch is the only trigger').join('');
      expect(withoutGateLabel, file).not.toMatch(/workflow_dispatch/);
      const envReads = [
        ...source.matchAll(/\benv(?:\?\.)?\.([A-Za-z0-9_]+)/gu),
        ...source.matchAll(/\benv\s*\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/gu),
      ].map((match) => match[1]);
      for (const name of envReads) {
        expect(ALLOWED_ENV_READS.has(name), `${file} reads env ${name}`).toBe(true);
      }
    }
  });
});

describe('the route does not gain a spend path', () => {
  it('does not dispatch, retry, or name a provider endpoint', () => {
    const source = readFileSync(join(__dirname, 'wonderland-admission-route.ts'), 'utf8');
    const server = readFileSync(join(__dirname, 'server.ts'), 'utf8');
    const mission = readFileSync(join(__dirname, 'julius-mission-routes.ts'), 'utf8');
    expect(server).not.toContain('handleWonderlandAdmissionRoute');
    expect(mission).not.toContain('wonderland-admission-route');
    expect(source).not.toContain('workflow_dispatch');
    expect(source).not.toContain('setTimeout');
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('api.openai.com');
    expect(source).not.toContain('api.anthropic.com');
    expect(source).not.toContain('api.x.ai');
    expect(source).not.toContain('julius_dispatch_busy');
    expect(source).not.toContain('--confirm-live');
  });
});
