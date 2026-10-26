import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { juliusMissionTraceId } from '../scripts/julius-mission-trace.mjs';
import { handleJuliusMissionRoute } from './julius-mission-routes';
import {
  JULIUS_PINNED_CHECKER_SHA256,
  acceptJuliusMissionEvidence,
  bindJuliusEvidenceToDispatch,
  createJuliusMissionEvidenceTestDouble,
  JULIUS_DISPATCH_CLOCK_TOLERANCE_MS,
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

/** 44a7f1e1 relay-bridge/julius-mission-evidence-reader.test.ts:392-415. */
const PRESENT_PHASES = [
  {
    role: 'PROMPT_ARCHITECT',
    state: 'NEVER_DISPATCHED',
    stage: null,
    attempt: null,
    spanId: null,
    traceparent: null,
    knownUsdMicros: 0,
    costComplete: true,
  },
  {
    role: 'CODING_AGENT',
    state: 'IDLE',
    stage: 'repair:build',
    attempt: 2,
    spanId: null,
    traceparent: null,
    knownUsdMicros: 1000,
    costComplete: true,
  },
  {
    role: 'INDEPENDENT_REVIEWER',
    state: 'NEVER_DISPATCHED',
    stage: null,
    attempt: null,
    spanId: null,
    traceparent: null,
    knownUsdMicros: 0,
    costComplete: true,
  },
] as const;
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
      workflowRunCreatedAt: '2026-10-23T17:19:00Z',
    },
    spendAccounting: null,
    coderCost: {
      costUsdMicros: 1200,
      costBasis: 'PROVIDER_REPORTED',
      executionCostUsdMicros: 1200,
      billingPath: 'API_BILLED',
    },
    missionCost: {
      knownUsdMicros: 1200,
      unknownComponents: 0,
      complete: true,
    },
    providerReceipt: {
      providerRequestId: 'req_0123456789abcdef',
      responseId: 'resp_0123456789abcdef',
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
      files: [{ path: 'cost-accounting.tsv', sha256: DIGEST, kind: 'table' }],
    },
    workArtifactRefs: ['artifact:julius-work-artifact.v1:plan'],
    projectBrainRevision: null,
    phases: null,
    traceId: 'f'.repeat(32),
    traceparent: `00-${'f'.repeat(32)}-${'a'.repeat(16)}-01`,
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
    githubDate: '2026-10-23T17:18:05Z',
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
        exactMissionEvents: false,
        exactMissionStart: false,
        exactCompanion: false,
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
      const traceId = juliusMissionTraceId(RUN);
      expect(heldResult?.body).toMatchObject({
        wljRunId: RUN, serverRunId: RUN, legacyRunId: null, traceId, state: 'awaiting_operator', dispatchedAt: null,
        phases: null, projectBrainRevision: null, completion: null,
      });
      expect(heldProgress?.body).toMatchObject({
        wljRunId: RUN, serverRunId: RUN, legacyRunId: null, traceId, state: 'awaiting_operator',
        phases: null, projectBrainRevision: null,
      });
      expect(JSON.stringify(heldResult?.body)).not.toContain('completed');
      expect(JSON.stringify(heldProgress?.body)).not.toContain('completed');
      recordDispatch(storePath);
      const dispatchedResult = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports);
      const dispatchedProgress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports);
      expect(dispatchedResult?.body).toMatchObject({
        state: 'dispatched', traceId, dispatchedAt: WHEN, phases: null, projectBrainRevision: null, completion: null,
      });
      expect(dispatchedProgress?.body).toMatchObject({
        state: 'dispatched', traceId, phases: null, projectBrainRevision: null,
      });
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
        phases: null,
        projectBrainRevision: null,
        completion: {
          juliusFinalState: 'COMPLETED',
          spendTag: evidence.spendTag,
          spendAccounting: null,
          coderCost: evidence.coderCost,
          missionCost: evidence.missionCost,
          projectBrainRevision: null,
          phases: null,
          providerReceipt: {
            providerRequestId: 'req_0123456789abcdef',
            responseId: 'resp_0123456789abcdef',
            providerRequestAvailability: 'CAPTURED',
            providerRequestUnavailableReason: null,
          },
          archive: { artifactName: 'julius-live-evidence', artifactDigest: DIGEST, conclusion: 'success' },
        },
      });
      expect(progress?.body).toMatchObject({
        state: 'completed',
        traceId: juliusMissionTraceId(RUN),
        phases: null,
        projectBrainRevision: null,
      });
      const completion = (result?.body as {
        completion?: { providerReceipt?: { providerRequestId?: string | null; responseId?: string | null } };
      }).completion;
      expect(completion?.providerReceipt?.responseId).not.toBe(completion?.providerReceipt?.providerRequestId);
      expect(result?.body).toMatchObject({
        traceId: juliusMissionTraceId(RUN),
        completion: { traceId: juliusMissionTraceId(RUN), traceparent: null },
      });
      const rendered = `${JSON.stringify(result?.body)}${JSON.stringify(progress?.body)}`;
      expect(rendered).not.toContain('"phases":[]');
      expect(rendered).not.toContain('"projectBrainRevision":0');
      expect(JSON.stringify(result?.body)).not.toContain('f'.repeat(32));
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
      const nullRead = createJuliusMissionEvidenceTestDouble({ [RUN]: null });
      const phasesOnly = createJuliusMissionEvidenceTestDouble({
        [RUN]: {
          juliusFinalState: 'EXECUTING',
          projectBrainRevision: 0,
          phases: [{
            role: 'CODING_AGENT',
            state: 'ACTIVE',
            stage: 'build',
            attempt: 1,
            spanId: 'a'.repeat(16),
            traceparent: null,
            knownUsdMicros: 0,
            costComplete: true,
          }],
        },
      });
      for (const reader of [mocked, throwing, nullRead]) {
        const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, reader);
        const progress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports, reader);
        expect(result?.body).toMatchObject({
          state: 'dispatched', phases: null, projectBrainRevision: null, completion: null,
        });
        expect(progress?.body).toMatchObject({
          state: 'dispatched', phases: null, projectBrainRevision: null,
        });
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
        projectBrainRevision: null,
        phases: null,
      });
      expect(still?.body).toMatchObject({
        state: 'dispatched',
        projectBrainRevision: null,
        completion: null,
        phases: null,
      });
      const unfinished = `${JSON.stringify(moving?.body)}${JSON.stringify(still?.body)}`;
      expect(unfinished).not.toContain(`"spanId":"${'a'.repeat(16)}"`);
      expect(unfinished).not.toContain('NEVER_DISPATCHED');
      expect(unfinished).not.toContain('"projectBrainRevision":0');
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders a present projection, a revision of 0, and a null phase list', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      recordDispatch(storePath);
      const present = createJuliusMissionEvidenceTestDouble({
        [RUN]: completionValue({ projectBrainRevision: 0, phases: PRESENT_PHASES, spendAccounting: null }),
      });
      const progress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports, present);
      const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, present);
      expect(progress?.body).toMatchObject({
        state: 'completed',
        projectBrainRevision: 0,
        phases: PRESENT_PHASES,
      });
      expect(result?.body).toMatchObject({
        state: 'completed',
        projectBrainRevision: 0,
        phases: PRESENT_PHASES,
        completion: { projectBrainRevision: 0, phases: PRESENT_PHASES, spendAccounting: null, traceparent: null },
      });
      const rendered = `${JSON.stringify(progress?.body)}${JSON.stringify(result?.body)}`;
      expect(rendered).toContain('"projectBrainRevision":0');
      expect(rendered).toContain('"knownUsdMicros":0');
      expect(rendered).toContain('"spanId":null');
      expect(rendered).not.toContain('"spanId":"');
      const absentPhases = createJuliusMissionEvidenceTestDouble({
        [RUN]: completionValue({ projectBrainRevision: 4, phases: null, spendAccounting: null }),
      });
      const quiet = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports, absentPhases);
      expect(quiet?.body).toMatchObject({
        state: 'completed',
        projectBrainRevision: 4,
        phases: null,
      });
      expect(JSON.stringify(quiet?.body)).not.toContain('NEVER_DISPATCHED');
      const broken = createJuliusMissionEvidenceTestDouble({
        [RUN]: completionValue({
          projectBrainRevision: 4,
          phases: [{ ...PRESENT_PHASES[1], spanId: 'a'.repeat(16) }],
        }),
      });
      const dropped = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, broken);
      expect(dropped?.body).toMatchObject({
        state: 'completed',
        projectBrainRevision: 4,
        phases: null,
        completion: { phases: null, projectBrainRevision: 4 },
      });
      expect(JSON.stringify(dropped?.body)).not.toContain(`"spanId":"${'a'.repeat(16)}"`);
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
      const responseOnly = createJuliusMissionEvidenceTestDouble({
        [RUN]: completionValue({
          providerReceipt: {
            providerRequestId: 'req_0123456789abcdef',
            responseId: SECRET,
            providerRequestAvailability: 'CAPTURED',
          },
        }),
      });
      const kept = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, responseOnly);
      expect(kept?.body).toMatchObject({
        state: 'completed',
        completion: {
          providerReceipt: {
            providerRequestId: 'req_0123456789abcdef',
            responseId: null,
            providerRequestAvailability: 'CAPTURED',
            providerRequestUnavailableReason: null,
          },
        },
      });
      expect(JSON.stringify(kept?.body)).not.toContain(SECRET);
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

describe('no completion and no verdict before the operator dispatched the run', () => {
  const judged = 'b'.repeat(64);
  const graded = (verdict: 'PASS' | 'FAIL') => ({
    ...completionValue(), checkerVerdict: verdict,
    checker: { reason: 'none', taskId: 'task:build-1', judgedTrimmedSha256: judged, gameDigest: judged.slice(0, 12), checkerSha256: JULIUS_PINNED_CHECKER_SHA256 },
  });
  // The fields operator-claim.ts records for each refused outcome.
  const REFUSED: Record<string, Record<string, unknown>> = {
    dispatch_failed: { state: 'dispatch_failed', spentTagState: 'absent', dispatchError: 'gh_workflow_run_failed', halt: null },
    already_spent: { state: 'already_spent', spentTagState: 'present', dispatchError: null, halt: 'RUN_ID_ALREADY_SPENT' },
  };
  const recordClaim = (storePath: string, state: string): void => {
    recordDispatch(storePath);
    const journalPath = `${storePath}.operator.json`;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { claims: Array<Record<string, unknown>> };
    journal.claims[0] = { ...journal.claims[0], ...REFUSED[state] };
    writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
  };

  it('a PASS or FAIL fixture on a row still awaiting the operator is NOT_RUN and never completed', async () => {
    const { dir, ports } = await admitted();
    try {
      for (const verdict of ['PASS', 'FAIL'] as const) {
        const reader = createJuliusMissionEvidenceTestDouble({ [RUN]: graded(verdict) });
        const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, reader);
        const progress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports, reader);
        expect(result?.body, verdict).toMatchObject({ state: 'awaiting_operator', checkerVerdict: 'NOT_RUN', completion: null, phases: null });
        expect(progress?.body, verdict).toMatchObject({ state: 'awaiting_operator', phases: null });
      }
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a refused or failed claim keeps the ceiling and NOT_RUN', async () => {
    for (const state of ['dispatch_failed', 'already_spent']) {
      const { dir, storePath, ports } = await admitted();
      try {
        recordClaim(storePath, state);
        const reader = createJuliusMissionEvidenceTestDouble({ [RUN]: graded('PASS') });
        const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, reader);
        expect(result?.body, state).toMatchObject({ state, checkerVerdict: 'NOT_RUN', completion: null });
        ports.close();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('an expired held row (failed / AWAITING_OPERATOR_EXPIRED) keeps the ceiling and NOT_RUN', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      const journalPath = `${storePath}.operator.json`;
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { revision: number; progress: unknown[] };
      journal.revision += 1;
      journal.progress = [...journal.progress, { serverRunId: RUN, state: 'failed', cause: 'AWAITING_OPERATOR_EXPIRED', updatedAt: WHEN }];
      writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
      const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, createJuliusMissionEvidenceTestDouble({ [RUN]: graded('PASS') }));
      expect(result?.body).toMatchObject({ state: 'failed', cause: 'AWAITING_OPERATOR_EXPIRED', checkerVerdict: 'NOT_RUN', completion: null });
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a dispatched run with a pinned PASS is completed and PASS', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      recordDispatch(storePath);
      const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, createJuliusMissionEvidenceTestDouble({ [RUN]: graded('PASS') }));
      expect(result?.body).toMatchObject({ state: 'completed', checkerVerdict: 'PASS', completion: { checkerVerdict: 'PASS' } });
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('evidence is bound to the operator dispatch record', () => {
  const judged = 'b'.repeat(64);
  const passing = (spendTag: Record<string, unknown> = {}) => {
    const base = completionValue();
    return {
      ...base,
      spendTag: { ...(base.spendTag as Record<string, unknown>), ...spendTag },
      checkerVerdict: 'PASS',
      checker: { reason: 'none', taskId: 'task:build-1', judgedTrimmedSha256: judged, gameDigest: judged.slice(0, 12), checkerSha256: JULIUS_PINNED_CHECKER_SHA256 },
    };
  };
  const dispatchWith = (storePath: string, claim: Record<string, unknown>): void => {
    recordDispatch(storePath);
    const journalPath = `${storePath}.operator.json`;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { claims: Array<Record<string, unknown>> };
    journal.claims[0] = { ...journal.claims[0], ...claim };
    writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
  };
  const read = async (storePath: string, ports: ReturnType<typeof service>, value: unknown) => {
    void storePath;
    return handleWonderlandMissionReadRoute(readRequest('result', RUN), ports, createJuliusMissionEvidenceTestDouble({ [RUN]: value }));
  };

  it('the spend tag must name the workflow run the claim recorded', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      dispatchWith(storePath, { workflowRunId: '4242' });
      const same = await read(storePath, ports, passing({ workflowRunId: '4242' }));
      expect(same?.body).toMatchObject({ state: 'completed', checkerVerdict: 'PASS' });
      const other = await read(storePath, ports, passing({ workflowRunId: '9999' }));
      expect(other?.body).toMatchObject({ state: 'dispatched', checkerVerdict: 'NOT_RUN', completion: null, phases: null });
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a run created before GitHub\'s clock on the dispatch, or with no creation time, is not completion; the local clock is not read', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      // The operator machine's clock (`at`) runs 30 minutes fast; GitHub said 17:18:30 on the tag read.
      dispatchWith(storePath, { at: '2026-10-23T17:48:30.400Z', githubDate: '2026-10-23T17:18:30Z' });
      const before = await read(storePath, ports, passing({ workflowRunCreatedAt: '2026-10-23T17:18:27Z' }));
      expect(before?.body).toMatchObject({ state: 'dispatched', checkerVerdict: 'NOT_RUN', completion: null });
      // Two seconds of GitHub's own spread is the dispatch's run; three is not.
      const atTolerance = await read(storePath, ports, passing({ workflowRunCreatedAt: '2026-10-23T17:18:28Z' }));
      expect(atTolerance?.body).toMatchObject({ state: 'completed', checkerVerdict: 'PASS' });
      const sameSecond = await read(storePath, ports, passing({ workflowRunCreatedAt: '2026-10-23T17:18:30Z' }));
      expect(sameSecond?.body).toMatchObject({ state: 'completed', checkerVerdict: 'PASS' });
      const after = await read(storePath, ports, passing({ workflowRunCreatedAt: '2026-10-23T17:25:00Z' }));
      expect(after?.body).toMatchObject({ state: 'completed', checkerVerdict: 'PASS' });
      for (const missing of [undefined, null, '', 'yesterday', '2026-10-23 17:25:00', 1_766_000_000]) {
        const value = passing({ workflowRunCreatedAt: missing });
        const reading = await read(storePath, ports, value);
        expect(reading?.body, String(missing)).toMatchObject({ state: 'dispatched', checkerVerdict: 'NOT_RUN', completion: null });
      }
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a claim without GitHub\'s clock binds no completion', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      dispatchWith(storePath, { githubDate: null });
      const reading = await read(storePath, ports, passing());
      expect(reading?.body).toMatchObject({ state: 'dispatched', checkerVerdict: 'NOT_RUN', completion: null });
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bindJuliusEvidenceToDispatch: no recorded dispatch or GitHub clock is no completion; a null workflow run id on the record does not bind', () => {
    const accepted = acceptJuliusMissionEvidence(RUN, passing());
    expect(accepted.completion).not.toBeNull();
    const clock = '2026-10-23T17:18:05Z';
    const none = { completion: null, phases: null };
    expect(bindJuliusEvidenceToDispatch(accepted, { dispatchedAt: null, workflowRunId: null, githubDispatchDate: clock })).toEqual(none);
    expect(bindJuliusEvidenceToDispatch(accepted, { dispatchedAt: 'not-a-time', workflowRunId: null, githubDispatchDate: clock })).toEqual(none);
    expect(bindJuliusEvidenceToDispatch(accepted, { dispatchedAt: WHEN, workflowRunId: null, githubDispatchDate: null })).toEqual(none);
    expect(bindJuliusEvidenceToDispatch(accepted, { dispatchedAt: WHEN, workflowRunId: null, githubDispatchDate: 'Fri, 23 Oct 2026' })).toEqual(none);
    expect(bindJuliusEvidenceToDispatch(accepted, { dispatchedAt: WHEN, workflowRunId: null, githubDispatchDate: clock })).toBe(accepted);
    expect(bindJuliusEvidenceToDispatch(accepted, { dispatchedAt: WHEN, workflowRunId: '4242', githubDispatchDate: clock })).toBe(accepted);
    expect(bindJuliusEvidenceToDispatch(accepted, { dispatchedAt: WHEN, workflowRunId: '4243', githubDispatchDate: clock })).toEqual(none);
    // The run (created 17:19:00) against GitHub's clock: 17:19:02 is inside the tolerance, 17:19:03 is not.
    expect(bindJuliusEvidenceToDispatch(accepted, { dispatchedAt: WHEN, workflowRunId: null, githubDispatchDate: '2026-10-23T17:19:02Z' })).toBe(accepted);
    expect(bindJuliusEvidenceToDispatch(accepted, { dispatchedAt: WHEN, workflowRunId: null, githubDispatchDate: '2026-10-23T17:19:03Z' })).toEqual(none);
    // The local dispatch time no longer orders anything.
    expect(bindJuliusEvidenceToDispatch(accepted, { dispatchedAt: '2026-10-23T17:19:01.000Z', workflowRunId: null, githubDispatchDate: clock })).toBe(accepted);
    expect(JULIUS_DISPATCH_CLOCK_TOLERANCE_MS).toBe(2_000);
  });

  it('a dispatching reservation is reported as dispatching, not unknown, and reads no evidence', async () => {
    const { dir, storePath, ports } = await admitted();
    try {
      dispatchWith(storePath, { state: 'dispatching', dispatchAttempted: false, workflowRunId: null });
      const result = await read(storePath, ports, passing());
      expect(result?.body).toMatchObject({ state: 'dispatching', dispatchedAt: null, checkerVerdict: 'NOT_RUN', completion: null });
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('/result says OUTCOME UNKNOWN when Julius recorded one, for the dispatched run only', () => {
  const OUTCOME = { cause: 'HANDED_OUTCOME_UNKNOWN', role: 'CODING_AGENT', taskId: 'task:build:1', workflowRunId: '4242' };
  const dispatchedTo = (storePath: string, workflowRunId: string | null) => {
    recordDispatch(storePath);
    const journalPath = `${storePath}.operator.json`;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { claims: Record<string, unknown>[] };
    journal.claims = journal.claims.map((claim) => ({ ...claim, workflowRunId }));
    writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
  };
  const reader = (outcome: unknown, completion: unknown = null): JuliusMissionEvidenceReader & { outcomeReads: number } => {
    const double = {
      outcomeReads: 0,
      read: async () => completion,
      async readOutcomeUnknown() { double.outcomeReads += 1; return outcome; },
    };
    return double;
  };
  const withRun = async (run: (ctx: Awaited<ReturnType<typeof admitted>>) => Promise<void>) => {
    const ctx = await admitted();
    try { await run(ctx); } finally { ctx.ports.close(); rmSync(ctx.dir, { recursive: true, force: true }); }
  };
  const body = async (ctx: Awaited<ReturnType<typeof admitted>>, double: JuliusMissionEvidenceReader) =>
    (await handleWonderlandMissionReadRoute(readRequest('result', RUN), ctx.ports, double))?.body as Record<string, unknown>;

  it('a dispatched run whose record holds HANDED_OUTCOME_UNKNOWN reports it, and is never completed or PASS', async () => {
    await withRun(async (ctx) => {
      dispatchedTo(ctx.storePath, '4242');
      const result = await body(ctx, reader(OUTCOME));
      expect(result.outcomeUnknown).toEqual({ cause: 'HANDED_OUTCOME_UNKNOWN', role: 'CODING_AGENT', taskId: 'task:build:1' });
      expect(result).toMatchObject({ state: 'dispatched', checkerVerdict: 'NOT_RUN', completion: null });
    });
  });

  it('the outcome of another workflow run, or a dispatch that recorded no run, is not this run\'s', async () => {
    await withRun(async (ctx) => {
      dispatchedTo(ctx.storePath, '4243');
      expect((await body(ctx, reader(OUTCOME))).outcomeUnknown).toBeNull();
    });
    await withRun(async (ctx) => {
      dispatchedTo(ctx.storePath, null);
      expect((await body(ctx, reader(OUTCOME))).outcomeUnknown).toBeNull();
    });
  });

  it('before dispatch nothing is read; a reader without the method, a throw or a bad value is none read', async () => {
    await withRun(async (ctx) => {
      const double = reader(OUTCOME);
      expect((await body(ctx, double)).outcomeUnknown).toBeNull();
      expect(double.outcomeReads).toBe(0);
      dispatchedTo(ctx.storePath, '4242');
      expect((await body(ctx, createJuliusMissionEvidenceTestDouble({}))).outcomeUnknown).toBeNull();
      expect((await body(ctx, { read: async () => null, readOutcomeUnknown: async () => { throw new Error('unread'); } })).outcomeUnknown).toBeNull();
      expect((await body(ctx, reader({ ...OUTCOME, cause: 'TIMEOUT' }))).outcomeUnknown).toBeNull();
      expect((await body(ctx, reader(null))).outcomeUnknown).toBeNull();
    });
  });

  it('progress does not carry it', async () => {
    await withRun(async (ctx) => {
      dispatchedTo(ctx.storePath, '4242');
      const progress = (await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ctx.ports, reader(OUTCOME)))?.body as Record<string, unknown>;
      expect(progress).not.toHaveProperty('outcomeUnknown');
    });
  });
});
