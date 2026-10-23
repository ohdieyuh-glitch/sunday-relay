import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { classifyDispatchAnswer, errorKindOf } from '../src/relay/integration/wonderland-admission';
import type { AdmissionLedger } from '../src/relay/integration/wonderland-admission';
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

function service(over: { env?: Record<string, string | undefined>; ledger?: AdmissionLedger } = {}) {
  return createWonderlandAdmissionService({
    env: over.env ?? env(),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => token === 'native-token'
      ? { playerId: 'founder', projectId: 'project-1', sessionId: 'sess-1' }
      : null,
    readWorkflowText: () => null,
    ledger: over.ledger,
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
    const created = (first?.body as { data: { dispatchId: string; dispatched: boolean; confirmLive: string; submittedToPaidWorkflow: boolean; state: string } }).data;
    const replayed = (second?.body as { data: { dispatchId: string; state: string; replayed: boolean; correlation: { resultSha256: null; requestId: string } } }).data;
    expect(replayed.dispatchId).toBe(created.dispatchId);
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
    '/wonderland/julius/dispatch?x=1',
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

  it('sends slash, case, child, and query variants through the catch-all refusal', async () => {
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
