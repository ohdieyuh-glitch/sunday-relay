import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { handleJuliusMissionRoute } from './julius-mission-routes';
import {
  createJuliusMissionEvidenceTestDouble,
  type JuliusMissionEvidenceReader,
} from './julius-mission-evidence';
import {
  createWonderlandAdmissionService,
  handleWonderlandAdmissionRoute,
  WONDERLAND_ADMISSION_PATH,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import {
  createWonderlandMissionReadBridge,
  handleWonderlandMissionReadRoute,
} from './wonderland-mission-result-route';
import { classifyWonderlandDispatchPath, isWonderlandRoute } from './wonderland-routes';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const KEY = '11111111-2222-4333-8444-555555555555';
const WHEN = '2026-10-23T17:18:00.000Z';
const LOG = 'ab'.repeat(32);
const PROJECT = 'project-1';
const SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);
const SECRET = 'sk-ant-FAKETESTNOTREAL'; // relay-boundary:allow-fixture — synthetic
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

function service(storePath: string) {
  return createWonderlandAdmissionService({
    env: env(storePath),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => {
      if (token === 'native-token') return { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-1' };
      if (token === 'other-token') return { playerId: 'other-player', projectId: PROJECT, sessionId: 'sess-2' };
      return null;
    },
    readWorkflowText: () => null,
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

function readRequest(
  kind: 'result' | 'progress',
  runId: string,
  over: Partial<WonderlandAdmissionRouteRequest> = {},
): WonderlandAdmissionRouteRequest {
  const pathname = `/wonderland/julius/missions/${runId}/${kind}`;
  return {
    method: 'GET',
    path: pathname,
    url: `${pathname}?projectId=${PROJECT}`,
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

function completionValue(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    juliusFinalState: 'COMPLETED',
    spendTag: {
      schema: 'julius-run-spent.v1',
      run: RUN,
      namespace: 'julius-live-mission-5',
      reservedUsdMicros: 30_000_000,
      workflowRunId: '4242',
      workflowRunAttempt: '1',
      headSha: SHA,
    },
    spendAccounting: {
      knownUsdMicros: 30_000_000,
      unknownCostComponents: 0,
      unverifiableApiSpend: false,
      spendVerified: true,
    },
    coderCost: {
      costUsdMicros: 608861,
      costBasis: 'PROVIDER_REPORTED',
      executionCostUsdMicros: null,
      billingPath: 'API_BILLED',
    },
    missionCost: {
      knownUsdMicros: 608861,
      unknownComponents: 2,
      complete: false,
    },
    providerReceipt: {
      providerRequestId: 'req_0123456789abcdef',
      responseId: 'req_0123456789abcdef',
      providerMessageId: 'msg_does_not_count',
      providerRequestAvailability: 'CAPTURED',
      providerRequestUnavailableReason: null,
    },
    archive: {
      artifactName: 'julius-live-evidence',
      artifactDigest: DIGEST,
      fileCount: 1,
      totalBytes: 12,
      conclusion: 'success',
      failedSteps: [],
      files: [{ path: 'tasks.tsv', sha256: DIGEST, kind: 'table' }],
    },
    workArtifactRefs: [`artifact:julius-work-artifact.v1:${RUN}:build-1:g1:DIFF`],
    projectBrainRevision: 3,
    phases: [
      { role: 'PROMPT_ARCHITECT', state: 'IDLE', stage: 'plan', knownUsdMicros: null, costComplete: false },
      { role: 'CODING_AGENT', state: 'IDLE', stage: 'build', knownUsdMicros: 608861, costComplete: true },
      { role: 'INDEPENDENT_REVIEWER', state: 'IDLE', stage: null, knownUsdMicros: null, costComplete: false },
    ],
    apiKey: SECRET,
    token: 'ghp_FAKETESTNOTREAL', // relay-boundary:allow-fixture — synthetic
    password: 'super-secret-password',
    ...over,
  };
}

async function admitted(): Promise<{ storePath: string; dir: string; ports: ReturnType<typeof service> }> {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-result-'));
  const storePath = join(dir, 'admission.json');
  const created = service(storePath);
  const response = await handleWonderlandAdmissionRoute(admitRequest(), created);
  expect(response?.status).toBe(202);
  created.close();
  return { storePath, dir, ports: service(storePath) };
}

function recordDispatch(storePath: string): void {
  const journalPath = `${storePath}.operator.json`;
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { claims: unknown[] };
  journal.claims = [{
    wonderlandRunId: RUN,
    serverRunId: RUN,
    state: 'dispatched',
    spentTag: `julius-run-spent-${'0b7a1c2e4f3d4a6b8c2d3e4f5a6b7c8d'}`,
    spentTagState: 'absent',
    at: WHEN,
    dispatchAttempted: true,
    dispatchError: null,
    halt: null,
    workflowRunId: null,
  }];
  writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
}

describe('wonderland mission result and progress', () => {
  it('keeps a queried result or progress path off the catch-all, and a slash or other case on it', () => {
    for (const kind of ['result', 'progress'] as const) {
      const pathname = `/wonderland/julius/missions/${RUN}/${kind}`;
      const queried = `${pathname}?projectId=${PROJECT}`;
      expect(isWonderlandRoute(queried), kind).toBe(false);
      expect(classifyWonderlandDispatchPath(pathname, queried), kind).toEqual({
        catchAllPath: null,
        exactAdmission: false,
        exactStatus: false,
        exactMissionResult: kind === 'result',
        exactMissionProgress: kind === 'progress',
      });
      for (const raw of [
        `${pathname}/?projectId=${PROJECT}`,
        `/Wonderland/Julius/Missions/${RUN}/${kind}?projectId=${PROJECT}`,
        `${pathname}/extra?projectId=${PROJECT}`,
      ]) {
        const classified = classifyWonderlandDispatchPath(raw.split('?')[0].replace(/\/+$/, '') || '/', raw);
        expect(classified.exactMissionResult, raw).toBe(false);
        expect(classified.exactMissionProgress, raw).toBe(false);
        expect(classified.catchAllPath, raw).not.toBeNull();
      }
    }
  });

  it('with no reader, reports the status ceiling and never completed', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      const heldResult = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports);
      const heldProgress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports);
      expect(heldResult?.body).toMatchObject({
        wljRunId: RUN, serverRunId: RUN, legacyRunId: null, state: 'awaiting_operator', dispatchedAt: null, completion: null,
      });
      expect(heldProgress?.body).toMatchObject({
        wljRunId: RUN, serverRunId: RUN, legacyRunId: null, state: 'awaiting_operator', phases: null,
      });
      expect(JSON.stringify(heldResult?.body)).not.toContain('completed');
      expect(JSON.stringify(heldProgress?.body)).not.toContain('completed');
      recordDispatch(storePath);
      const dispatchedResult = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports);
      const dispatchedProgress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports);
      expect(dispatchedResult?.body).toMatchObject({ state: 'dispatched', dispatchedAt: WHEN, completion: null });
      expect(dispatchedProgress?.body).toMatchObject({ state: 'dispatched', phases: null });
      expect(JSON.stringify(dispatchedResult?.body)).not.toContain('"completed"');
      expect(JSON.stringify(dispatchedProgress?.body)).not.toContain('"completed"');
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('completes only when the test double returns the spend-tag evidence shape', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      recordDispatch(storePath);
      const evidence = completionValue();
      const reader = createJuliusMissionEvidenceTestDouble({ [RUN]: evidence });
      const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, reader);
      const progress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports, reader);
      expect(result?.status).toBe(200);
      expect(result?.body).toMatchObject({
        state: 'completed',
        completion: {
          juliusFinalState: 'COMPLETED',
          spendTag: evidence.spendTag,
          coderCost: evidence.coderCost,
          projectBrainRevision: 3,
          providerReceipt: {
            providerRequestId: 'req_0123456789abcdef',
            responseId: 'req_0123456789abcdef',
            providerRequestAvailability: 'CAPTURED',
            providerRequestUnavailableReason: null,
          },
          archive: { artifactName: 'julius-live-evidence', artifactDigest: DIGEST, conclusion: 'success' },
        },
      });
      expect(progress?.body).toMatchObject({
        state: 'completed',
        phases: [
          { role: 'PROMPT_ARCHITECT', state: 'IDLE', stage: 'plan' },
          { role: 'CODING_AGENT', state: 'IDLE', stage: 'build' },
          { role: 'INDEPENDENT_REVIEWER', state: 'IDLE', stage: null },
        ],
      });
      const serialized = `${JSON.stringify(result?.body)}${JSON.stringify(progress?.body)}`;
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain('ghp_FAKETESTNOTREAL');
      expect(serialized).not.toContain('super-secret-password');
      expect(serialized).not.toContain('msg_does_not_count');
      expect(serialized).not.toContain('apiKey');
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a mocked completion signal, a message id, and a throwing reader stay at dispatched', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      recordDispatch(storePath);
      const mocked = createJuliusMissionEvidenceTestDouble({
        [RUN]: { completed: true, state: 'completed', juliusFinalState: 'COMPLETED' },
      });
      const messageOnly = createJuliusMissionEvidenceTestDouble({
        [RUN]: completionValue({
          providerReceipt: {
            providerRequestId: null,
            providerMessageId: 'msg_does_not_count',
            providerRequestAvailability: 'CAPTURED',
          },
        }),
      });
      const throwing: JuliusMissionEvidenceReader = {
        read: () => Promise.reject(new Error(SECRET)),
      };
      const phasesOnly = createJuliusMissionEvidenceTestDouble({
        [RUN]: {
          juliusFinalState: 'EXECUTING',
          phases: [{ role: 'CODING_AGENT', state: 'ACTIVE', stage: 'build' }],
        },
      });
      for (const reader of [mocked, throwing]) {
        const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, reader);
        const progress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports, reader);
        expect(result?.body).toMatchObject({ state: 'dispatched', completion: null });
        expect(progress?.body).toMatchObject({ state: 'dispatched', phases: null });
        expect(JSON.stringify(result?.body)).not.toContain(SECRET);
        expect(JSON.stringify(progress?.body)).not.toContain(SECRET);
      }
      const captured = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, messageOnly);
      expect(captured?.body).toMatchObject({
        state: 'completed',
        completion: {
          providerReceipt: {
            providerRequestId: null,
            responseId: null,
            providerRequestAvailability: 'UNAVAILABLE',
            providerRequestUnavailableReason: 'provider_request_id_unusable',
          },
        },
      });
      expect(JSON.stringify(captured?.body)).not.toContain('msg_does_not_count');
      const moving = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports, phasesOnly);
      const still = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, phasesOnly);
      expect(moving?.body).toMatchObject({
        state: 'dispatched',
        phases: [{ role: 'CODING_AGENT', state: 'ACTIVE', stage: 'build', knownUsdMicros: null, costComplete: null }],
      });
      expect(still?.body).toMatchObject({ state: 'dispatched', completion: null });
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops a credential-shaped request id and does not echo it', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      recordDispatch(storePath);
      const reader = createJuliusMissionEvidenceTestDouble({
        [RUN]: completionValue({
          providerReceipt: {
            providerRequestId: SECRET,
            providerRequestAvailability: 'CAPTURED',
          },
        }),
      });
      const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, reader);
      expect(result?.body).toMatchObject({
        state: 'completed',
        completion: {
          providerReceipt: {
            providerRequestId: null,
            responseId: null,
            providerRequestAvailability: 'UNAVAILABLE',
            providerRequestUnavailableReason: 'provider_request_id_credential_shaped',
          },
        },
      });
      expect(JSON.stringify(result?.body)).not.toContain(SECRET);
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('legacy, preflight, malformed, and unknown ids are one 404', async () => {
    const { dir, ports } = await admitted();
    try {
      const legacy = `run:${'ab'.repeat(12)}`;
      for (const runId of [legacy, 'preflight:abc', 'not-a-run', 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee']) {
        for (const kind of ['result', 'progress'] as const) {
          const response = await handleWonderlandMissionReadRoute(readRequest(kind, runId), ports);
          expect(response, `${kind} ${runId}`).toEqual(NOT_FOUND);
        }
      }
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a non-loopback request is 403 and carries no result', async () => {
    const { dir, ports } = await admitted();
    try {
      const reader = createJuliusMissionEvidenceTestDouble({ [RUN]: completionValue() });
      for (const kind of ['result', 'progress'] as const) {
        const response = await handleWonderlandMissionReadRoute(
          readRequest(kind, RUN, { remoteAddress: '203.0.113.7' }),
          ports,
          reader,
        );
        expect(response).toEqual({
          status: 403,
          body: { error: { kind: 'julius_dispatch_not_loopback', message: 'Mission dispatch is only served to the same machine.' } },
        });
        expect(JSON.stringify(response?.body)).not.toContain(SECRET);
        expect(JSON.stringify(response?.body)).not.toContain(RUN);
      }
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the mission handler reaches the read only through the injected bridge', async () => {
    const { dir, ports } = await admitted();
    try {
      const path = `/wonderland/julius/missions/${RUN}/result`;
      const absent = await handleJuliusMissionRoute({
        method: 'GET',
        path,
        operator: false,
        body: undefined,
        url: `${path}?projectId=${PROJECT}`,
        authorization: 'Relay-Session native-token',
        remoteAddress: '127.0.0.1',
        host: 'localhost',
        forwarded: false,
        nowIso: WHEN,
        nowMs: Date.parse(WHEN),
      }, {
        bootstrap: null,
        missingConfig: [],
        reviewerProvider: null,
        cardRevision: 'card:julius-live:1',
      });
      expect(absent).toBeNull();
      const bridged = await handleJuliusMissionRoute({
        method: 'GET',
        path,
        operator: false,
        body: undefined,
        url: `${path}?projectId=${PROJECT}`,
        authorization: 'Relay-Session native-token',
        remoteAddress: '127.0.0.1',
        host: 'localhost',
        forwarded: false,
        nowIso: WHEN,
        nowMs: Date.parse(WHEN),
      }, {
        bootstrap: null,
        missingConfig: [],
        reviewerProvider: null,
        cardRevision: 'card:julius-live:1',
        wonderlandMissionReadBridge: createWonderlandMissionReadBridge(ports),
      });
      expect(bridged?.body).toMatchObject({ state: 'awaiting_operator', completion: null });
      expect(JSON.stringify(bridged?.body)).not.toContain('"completed"');
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
