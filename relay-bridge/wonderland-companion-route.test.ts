import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createWonderlandAdmissionService,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import { classifyWonderlandDispatchPath, isWonderlandRoute } from './wonderland-routes';
import {
  createFileCompanionResultStore,
  handleWonderlandCompanionRoute,
  isWonderlandCompanionRoute,
  type CompanionResultRecord,
  type CompanionResultStore,
  type WonderlandCompanionRoutePorts,
} from './wonderland-companion-route';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const UNKNOWN = 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LEGACY = `run:${'ab'.repeat(12)}`;
const WHEN = '2026-10-23T17:18:00.000Z';
const PROJECT = 'project-1';
const SHA = 'ab'.repeat(32);
const NOT_FOUND = { status: 404, body: { error: { kind: 'not_found', message: 'Not found.' } } };

function companionPath(runId: string): string {
  return `/wonderland/julius/missions/${encodeURIComponent(runId)}/companion`;
}

function env(storePath: string): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_WONDERLAND_MISSION: 'julius-inworld-data-1',
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
  };
}

function admission(storePath: string) {
  return createWonderlandAdmissionService({
    env: env(storePath),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => {
      if (token === 'native-token') return { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-1' };
      return null;
    },
    readWorkflowText: () => null,
  });
}

function request(runId: string, over: Partial<WonderlandAdmissionRouteRequest> = {}): WonderlandAdmissionRouteRequest {
  const path = companionPath(runId);
  return {
    method: 'GET',
    path,
    url: `${path}?projectId=${PROJECT}`,
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

function storedRow(over: Partial<CompanionResultRecord> = {}): CompanionResultRecord {
  return {
    wljRunId: RUN,
    legacyRunId: null,
    taskId: 'cmp_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d',
    state: 'result_received',
    summary: 'a local note',
    contentSha256: SHA,
    artifactKind: 'text',
    byteLength: 12,
    provenance: {
      source: 'simulated',
      wakeId: null,
      bodyDigest: null,
      contentSha256: SHA,
    },
    updatedAt: WHEN,
    ...over,
  };
}

function ports(storePath: string, companionResults: CompanionResultStore): WonderlandCompanionRoutePorts {
  return { ...admission(storePath), companionResults };
}

describe('wonderland companion read', () => {
  it('a queried companion pathname is the companion route, and a slash or other case is the catch-all', () => {
    const path = companionPath(RUN);
    const queried = `${path}?projectId=${PROJECT}`;
    expect(isWonderlandCompanionRoute(queried)).toBe(true);
    expect(isWonderlandRoute(queried)).toBe(false);
    expect(classifyWonderlandDispatchPath(path, queried)).toEqual({
      catchAllPath: null,
      exactAdmission: false,
      exactStatus: false,
      exactCompanion: true,
    });
    for (const raw of [
      `${path}/?projectId=${PROJECT}`,
      `/Wonderland/Julius/Missions/${RUN}/Companion?projectId=${PROJECT}`,
      `${path}/extra?projectId=${PROJECT}`,
    ]) {
      const classified = classifyWonderlandDispatchPath(raw.split('?')[0].replace(/\/+$/, '') || '/', raw);
      expect(classified.exactCompanion, raw).toBe(false);
      expect(classified.catchAllPath, raw).not.toBeNull();
    }
  });

  it('returns a stored result with verified hard-coded false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    const open = ports(join(dir, 'admission.json'), {
      read: () => ({ ...storedRow(), verified: true }) as CompanionResultRecord,
    });
    try {
      const result = await handleWonderlandCompanionRoute(request(RUN), open);
      expect(result?.status).toBe(200);
      const body = result?.body as { verified?: boolean; result?: { summary?: string; untrusted?: boolean } };
      expect(body.verified).toBe(false);
      expect(body.result).toEqual({
        untrusted: true,
        summary: 'a local note',
        artifact: { kind: 'text', sha256: SHA, byteLength: 12 },
      });
      expect(JSON.stringify(result?.body)).not.toContain('"verified":true');
    } finally {
      open.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses the status 404 for an unknown wlj id, a legacy id, and a malformed id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    try {
      const store: CompanionResultStore = { read: () => storedRow() };
      const open = ports(join(dir, 'admission.json'), store);
      expect(await handleWonderlandCompanionRoute(request(UNKNOWN), open)).toEqual(NOT_FOUND);
      expect(await handleWonderlandCompanionRoute(request(LEGACY), open)).toEqual(NOT_FOUND);
      expect(await handleWonderlandCompanionRoute(request('preflight:probe'), open)).toEqual(NOT_FOUND);
      expect(await handleWonderlandCompanionRoute(request('not-a-run'), open)).toEqual(NOT_FOUND);
      expect(await handleWonderlandCompanionRoute(request(RUN.toUpperCase()), open)).toEqual(NOT_FOUND);
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a peer that is not loopback, and that refusal is not a result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    try {
      const store: CompanionResultStore = { read: () => storedRow() };
      const open = ports(join(dir, 'admission.json'), store);
      const forwarded = await handleWonderlandCompanionRoute(request(RUN, { forwarded: true }), open);
      const remote = await handleWonderlandCompanionRoute(request(RUN, { remoteAddress: '10.0.0.8' }), open);
      expect(forwarded).toEqual({
        status: 403,
        body: {
          error: {
            kind: 'julius_dispatch_not_loopback',
            message: 'Mission dispatch is only served to the same machine.',
          },
        },
      });
      expect(remote?.status).toBe(403);
      for (const refused of [forwarded, remote]) {
        expect(refused?.body).not.toHaveProperty('result');
        expect(refused?.body).not.toHaveProperty('verified');
        expect(JSON.stringify(refused?.body)).not.toContain('a local note');
      }
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('POST is not an ingest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    try {
      const store: CompanionResultStore = { read: () => storedRow() };
      const open = ports(join(dir, 'admission.json'), store);
      const posted = await handleWonderlandCompanionRoute(request(RUN, {
        method: 'POST',
        rawBody: JSON.stringify({ summary: 'ignore' }),
      }), open);
      expect(posted).toEqual({
        status: 405,
        body: { error: { kind: 'method_not_allowed', message: 'Companion status is a GET.' } },
      });
      expect(posted?.body).not.toHaveProperty('verified');
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a local file and closes a URL store without returning a result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    const file = join(dir, 'companion.json');
    const admitted = admission(join(dir, 'admission.json'));
    try {
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, results: { [RUN]: storedRow() } }));
      const open = { ...admitted, companionResults: createFileCompanionResultStore(file) };
      const found = await handleWonderlandCompanionRoute(request(RUN), open);
      expect(found?.status).toBe(200);
      expect((found?.body as { verified?: boolean }).verified).toBe(false);
      const missing = await handleWonderlandCompanionRoute(request(UNKNOWN), {
        ...admitted,
        companionResults: createFileCompanionResultStore(join(dir, 'absent.json')),
      });
      expect(missing).toEqual(NOT_FOUND);
      const closed = await handleWonderlandCompanionRoute(request(RUN), {
        ...admitted,
        companionResults: createFileCompanionResultStore('https://example.test/companion.json'),
      });
      expect(closed?.status).toBe(503);
      expect(closed?.body).toEqual({
        error: {
          kind: 'julius_dispatch_unavailable',
          message: 'Wonderland admission store is not available. Nothing was reserved.',
        },
      });
      expect(closed?.body).not.toHaveProperty('result');
      expect(closed?.body).not.toHaveProperty('verified');
    } finally {
      admitted.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not call out or mount an ingest', () => {
    const source = readFileSync(join(__dirname, 'wonderland-companion-route.ts'), 'utf8');
    const mission = readFileSync(join(__dirname, 'julius-mission-routes.ts'), 'utf8');
    expect(source).not.toContain('child_process');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('operator-claim');
    expect(source).not.toMatch(/\bgh\b/);
    expect(source).not.toContain('http.request');
    expect(mission).not.toContain('wonderland-companion-route');
    expect(mission).not.toContain('wonderland-admission-route');
  });
});
