import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readAdmissionDocument } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  createWonderlandAdmissionService,
  handleWonderlandAdmissionRoute,
  handleWonderlandStatusRoute,
  WONDERLAND_ADMISSION_PATH,
  WONDERLAND_STATUS_PATH,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import { classifyWonderlandDispatchPath, isWonderlandRoute } from './wonderland-routes';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const KEY = '11111111-2222-4333-8444-555555555555';
const WHEN = '2026-10-23T17:18:00.000Z';
const LOG = 'ab'.repeat(32);
const PROJECT = 'project-1';
const SERVER = `run:${'a'.repeat(24)}`;
const NOT_FOUND = { status: 404, body: { error: { kind: 'not_found', message: 'Not found.' } } };

function env(storePath: string): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_WONDERLAND_MISSION: 'julius-inworld-data-1',
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
  };
}

function service(storePath: string, mint: () => string) {
  return createWonderlandAdmissionService({
    env: env(storePath),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => {
      if (token === 'native-token') return { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-1' };
      if (token === 'other-token') return { playerId: 'other-player', projectId: PROJECT, sessionId: 'sess-2' };
      return null;
    },
    readWorkflowText: () => null,
    mintServerRunId: mint,
  });
}

function admitRequest(): WonderlandAdmissionRouteRequest {
  return {
    method: 'POST',
    path: WONDERLAND_ADMISSION_PATH,
    url: `${WONDERLAND_ADMISSION_PATH}?projectId=${PROJECT}`,
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
  };
}

function statusRequest(runId: string, over: Partial<WonderlandAdmissionRouteRequest> = {}): WonderlandAdmissionRouteRequest {
  const path = `${WONDERLAND_STATUS_PATH}?projectId=${PROJECT}&runId=${encodeURIComponent(runId)}`;
  return {
    method: 'GET',
    path: WONDERLAND_STATUS_PATH,
    url: path,
    authorization: 'Relay-Session native-token',
    origin: undefined,
    rawBody: undefined,
    idempotencyKey: undefined,
    remoteAddress: '127.0.0.1',
    host: 'localhost',
    forwarded: false,
    nowIso: WHEN,
    nowMs: Date.parse(WHEN),
    ...over,
  };
}

describe('wonderland status', () => {
  it('a queried status pathname is status, and a slash or other case is the catch-all', () => {
    const queried = `${WONDERLAND_STATUS_PATH}?projectId=${PROJECT}&runId=${encodeURIComponent(SERVER)}`;
    expect(isWonderlandRoute(queried)).toBe(false);
    expect(classifyWonderlandDispatchPath(WONDERLAND_STATUS_PATH, queried)).toEqual({
      catchAllPath: null,
      exactAdmission: false,
      exactStatus: true,
    });
    for (const raw of [
      `${WONDERLAND_STATUS_PATH}/?projectId=${PROJECT}`,
      `/Wonderland/Julius/Status?projectId=${PROJECT}`,
      `${WONDERLAND_STATUS_PATH}/x?projectId=${PROJECT}`,
    ]) {
      const classified = classifyWonderlandDispatchPath(raw.split('?')[0].replace(/\/+$/, '') || '/', raw);
      expect(classified.exactStatus, raw).toBe(false);
      expect(classified.catchAllPath, raw).not.toBeNull();
    }
  });

  it('returns the held pair after a restart, and a replay keeps that server run id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    try {
      const first = service(storePath, () => SERVER);
      const created = await handleWonderlandAdmissionRoute(admitRequest(), first);
      expect(created?.status).toBe(202);
      const held = readFileSync(storePath, 'utf8');
      first.close();
      const restarted = service(storePath, () => { throw new Error('restart must not mint'); });
      const replay = await handleWonderlandAdmissionRoute(admitRequest(), restarted);
      expect(replay?.status).toBe(200);
      const replayBody = replay?.body as { data?: { serverRunId?: string; state?: string; dispatched?: boolean } };
      expect(replayBody.data?.serverRunId).toBe(SERVER);
      expect(replayBody.data?.state).toBe('ADMISSION_HELD');
      expect(replayBody.data?.dispatched).toBe(false);
      const status = await handleWonderlandStatusRoute(statusRequest(SERVER), restarted);
      expect(status).toEqual({
        status: 200,
        body: { wljRunId: RUN, serverRunId: SERVER, state: 'held', updatedAt: WHEN },
      });
      expect(readAdmissionDocument(storePath).claims).toEqual([]);
      expect(readFileSync(storePath, 'utf8')).toBe(held);
      restarted.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a different player, a malformed run id, and an unknown run id are one 404 and write nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    try {
      const admitted = service(storePath, () => SERVER);
      await handleWonderlandAdmissionRoute(admitRequest(), admitted);
      admitted.close();
      const ports = service(storePath, () => { throw new Error('status must not mint'); });
      const before = readFileSync(storePath, 'utf8');
      const malformed = await handleWonderlandStatusRoute(statusRequest('not-a-run'), ports);
      const unknown = await handleWonderlandStatusRoute(statusRequest(`run:${'b'.repeat(24)}`), ports);
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      const journalPath = `${storePath}.operator.json`;
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { owners: Record<string, string> };
      journal.owners[SERVER] = 'other-player';
      writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
      const ownedBySomeoneElse = readFileSync(journalPath, 'utf8');
      const otherOwner = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
      expect(malformed).toEqual(NOT_FOUND);
      expect(unknown).toEqual(NOT_FOUND);
      expect(otherOwner).toEqual(NOT_FOUND);
      expect(JSON.stringify(malformed)).toBe(JSON.stringify(unknown));
      expect(JSON.stringify(unknown)).toBe(JSON.stringify(otherOwner));
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      expect(readFileSync(journalPath, 'utf8')).toBe(ownedBySomeoneElse);
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns a progress state only when the file already holds it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    try {
      const admitted = service(storePath, () => SERVER);
      await handleWonderlandAdmissionRoute(admitRequest(), admitted);
      admitted.close();
      const ports = service(storePath, () => { throw new Error('status must not mint'); });
      const held = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
      expect(held?.body).toMatchObject({ state: 'held' });
      const journalPath = `${storePath}.operator.json`;
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { progress: unknown[] };
      journal.progress = [{
        serverRunId: SERVER,
        state: 'providers_running',
        cause: null,
        updatedAt: '2026-10-23T18:00:00.000Z',
      }];
      writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
      const before = readFileSync(storePath, 'utf8');
      const running = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
      expect(running).toEqual({
        status: 200,
        body: {
          wljRunId: RUN,
          serverRunId: SERVER,
          state: 'providers_running',
          updatedAt: '2026-10-23T18:00:00.000Z',
        },
      });
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
