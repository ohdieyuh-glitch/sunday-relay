/**
 * OFFLINE / NOT A PAID RUN.
 *
 * End-to-end of the Wonderland mission read. Admission is the #407 route.
 * Dispatch is an injected fake GhSpawner: it returns scripted results and
 * starts no process. Evidence is createJuliusMissionEvidenceTestDouble.
 * No network, no real provider, no gh, no spend.
 *
 * The fixtures below are synthetic. They are not a bill and not a workflow run.
 * The completion object is the shape PR 446 returns at 041d2599: null phases,
 * null projectBrainRevision, null spendAccounting, and a response id that is
 * not the request id. This file does not import that reader.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { juliusMissionSpanId, juliusMissionTraceId } from '../scripts/julius-mission-trace.mjs';
import { openAdmissionFile } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  OPERATOR_DISPATCH_CONFIRMATION,
  WORKFLOW_RUN_ID_INPUT,
  createOperatorClaimTool,
  type GhResult,
  type GhSpawner,
} from '../src/relay/integration/wonderland-admission/operator-claim';
import { JULIUS_PINNED_CHECKER_SHA256, createJuliusMissionEvidenceTestDouble } from './julius-mission-evidence';
import {
  createWonderlandAdmissionService,
  handleWonderlandAdmissionRoute,
  WONDERLAND_ADMISSION_PATH,
  type WonderlandAdmissionRoutePorts,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import { handleWonderlandMissionReadRoute } from './wonderland-mission-result-route';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const KEY = '11111111-2222-4333-8444-555555555555';
const WHEN = '2026-10-23T17:18:00.000Z';
const LOG = 'ab'.repeat(32);
const PROJECT = 'project-1';
const LEGACY = 'run:0123456789abcdef01234567';

/** KAT vectors for RUN. Literals, locked to scripts/julius-mission-trace.test.ts. */
const TRACE_ID = '0ef34f0df7cf2cf89b844dcfa5fe084f';
const PLAN_SPAN = '20d74ea3e2204340';
const BUILD_SPAN = '6bc1bfe65ed9e64b';
const REVIEW_SPAN = '4d4c5030f6bc2dbc';
const SUPPLIED_TRACE = 'f'.repeat(32);
const NOT_FOUND = { status: 404, body: { error: { kind: 'not_found', message: 'Not found.' } } };

/**
 * OFFLINE fixture. Declares run_id (PR #459's input) so the claim tool can build
 * arguments. This is not .github/workflows/julius-first-live-mission.yml,
 * and it is not dispatched.
 */
const OFFLINE_WORKFLOW_FIXTURE = `
name: offline-fixture
on:
  workflow_dispatch:
    inputs:
      confirm_live:
        description: 'phrase'
        required: false
        default: ''
      mission:
        description: 'slug'
      lane:
        description: 'lane'
      dispatch_key:
        description: 'key'
      run_id:
        description: 'Julius bootstrap run id'
        required: false
        default: ''
jobs:
  paid:
    steps:
      - run: |
          case "$MARKER_NAMESPACE" in
            julius-first-live) RECORDED_PAID_ATTEMPTS=1 ;;  # run 33697109210
            *)                 RECORDED_PAID_ATTEMPTS=0 ;;
          esac
`;

/** The spent-tag read: absent, with GitHub's clock, which the claim keeps as its dispatch time. */
const ABSENT: GhResult = {
  code: 1,
  stdout: 'HTTP/2.0 404 Not Found\nDate: Fri, 23 Oct 2026 17:18:00 GMT\n\n{"message":"Not Found"}\n',
  stderr: '',
};
/** What main serves: the offline workflow, the J1 contract, and a grant that leaves J1 on lab. */
const OFFLINE_LANE_GRANT = "const DEFAULT_LANES = Object.freeze(['lab']);\nconst MISSION_LANES = Object.freeze({\n  'julius-first-live': Object.freeze(['regression']),\n});\n";
const WORKFLOW_OK: GhResult = { code: 0, stdout: '', stderr: '' };

function env(storePath: string): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_WONDERLAND_MISSION: 'julius-inworld-data-1',
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
  };
}

function service(storePath: string): WonderlandAdmissionRoutePorts {
  return createWonderlandAdmissionService({
    env: env(storePath),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => (
      token === 'native-token' ? { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-offline' } : null
    ),
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

function readRequest(kind: 'result' | 'progress', runId: string): WonderlandAdmissionRouteRequest {
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
  };
}

/**
 * Shape copied from 041d2599
 * relay-bridge/julius-mission-evidence-reader.test.ts:158-197,
 * with `spendTag.run` set to this admitted id. The reader builds that
 * object at relay-bridge/julius-mission-evidence-reader.ts:523-537.
 * `phases`, `spendAccounting`, and `projectBrainRevision` are null there.
 */
function readerCompletion(): Record<string, unknown> {
  return {
    juliusFinalState: 'COMPLETED',
    spendTag: {
      schema: 'julius-run-spent.v1',
      run: RUN,
      namespace: 'julius-first-live',
      reservedUsdMicros: 5_000_000,
      workflowRunId: '4242',
      workflowRunAttempt: '1',
      headSha: 'ab'.repeat(20),
      workflowRunCreatedAt: '2026-10-23T17:19:00Z',
    },
    spendAccounting: null,
    coderCost: {
      costUsdMicros: 1200,
      costBasis: 'PROVIDER_REPORTED',
      executionCostUsdMicros: 1200,
      billingPath: 'API_BILLED',
    },
    missionCost: { knownUsdMicros: 1200, unknownComponents: 0, complete: true },
    providerReceipt: {
      providerRequestId: 'req_0123456789abcdef',
      responseId: 'resp_0123456789abcdef',
      providerRequestAvailability: 'CAPTURED',
      providerRequestUnavailableReason: null,
    },
    archive: {
      artifactName: 'julius-live-evidence',
      artifactDigest: 'cd'.repeat(32),
      fileCount: 1,
      totalBytes: 12,
      conclusion: 'success',
      failedSteps: [],
      files: [{ path: 'cost-accounting.tsv', sha256: 'cd'.repeat(32), kind: 'table' }],
    },
    workArtifactRefs: ['artifact:julius-work-artifact.v1:plan'],
    projectBrainRevision: null,
    phases: null,
    traceId: SUPPLIED_TRACE,
    traceparent: `00-${SUPPLIED_TRACE}-${'a'.repeat(16)}-01`,
  };
}

/**
 * Scripted dispatcher. `run` never starts gh. An unexpected command fails
 * the claim instead of being executed.
 */
function fakeDispatcher(): { readonly spawn: GhSpawner; readonly calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    spawn: {
      run(args) {
        const copy = [...args];
        calls.push(copy);
        const contents = args.find((arg) => arg.includes('/contents/'));
        if (args[0] === 'api' && contents !== undefined) {
          if (contents.includes('/.github/workflows/')) return { code: 0, stdout: OFFLINE_WORKFLOW_FIXTURE, stderr: '' };
          if (contents.endsWith('/contract.json?ref=main')) return { code: 0, stdout: '{"markerNamespace":"julius-inworld-data-1"}', stderr: '' };
          if (contents.endsWith('/scripts/julius-live-contract-check.mjs?ref=main')) return { code: 0, stdout: OFFLINE_LANE_GRANT, stderr: '' };
          return { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
        }
        if (args[0] === 'api') return ABSENT;
        if (args[0] === 'workflow') return WORKFLOW_OK;
        return { code: 99, stdout: '', stderr: 'OFFLINE fixture refused an unexpected command' };
      },
    },
  };
}

async function admittedStore(): Promise<{ dir: string; storePath: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-e2e-offline-'));
  const storePath = join(dir, 'admission.json');
  const created = service(storePath);
  const response = await handleWonderlandAdmissionRoute(admitRequest(), created);
  expect(response?.status).toBe(202);
  created.close();
  return { dir, storePath };
}

describe('OFFLINE / NOT A PAID RUN — wonderland mission result end to end', () => {
  it('admits a wlj id, fake-dispatches, and completes only from the #446 evidence shape', async () => {
    expect(juliusMissionTraceId(RUN)).toBe(TRACE_ID);
    expect(juliusMissionSpanId(RUN, 'PROMPT_ARCHITECT', 'plan', 1)).toBe(PLAN_SPAN);
    expect(juliusMissionSpanId(RUN, 'CODING_AGENT', 'build', 1)).toBe(BUILD_SPAN);
    expect(juliusMissionSpanId(RUN, 'INDEPENDENT_REVIEWER', 'repair:plan', 1)).toBe(REVIEW_SPAN);

    const { dir, storePath } = await admittedStore();
    const ports = service(storePath);
    try {
      const held = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports);
      expect(held?.status).toBe(200);
      expect(held?.body).toMatchObject({
        wljRunId: RUN,
        serverRunId: RUN,
        traceId: TRACE_ID,
        state: 'awaiting_operator',
        phases: null,
        projectBrainRevision: null,
        completion: null,
      });
      ports.close();

      const { calls, spawn } = fakeDispatcher();
      const claimed = await createOperatorClaimTool(openAdmissionFile(storePath), spawn, { nowIso: () => WHEN }, { read: () => Promise.resolve({ readable: true, counted: 0 }), readCompleted: () => Promise.resolve({ readable: true, counted: 0 }) }).claim({
        wonderlandRunId: RUN,
        serverRunId: RUN,
        repo: 'founder/sunday-relay',
        lane: 'lab',
        workflowSource: OFFLINE_WORKFLOW_FIXTURE,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      });
      if (!claimed.ok) throw new Error(`offline claim refused: ${claimed.kind}`);
      expect(claimed.dispatchedWorkflow).toBe(true);
      expect(claimed.record.state).toBe('dispatched');
      expect(claimed.record.dispatchAttempted).toBe(true);
      expect(claimed.record.workflowRunId).toBeNull();
      expect(calls.map((args) => (args.some((arg) => arg.includes('/contents/')) ? 'main' : args[0]))).toEqual(['main', 'main', 'main', 'api', 'workflow']);
      expect(calls.find((args) => args[0] === 'workflow')).toContain(`${WORKFLOW_RUN_ID_INPUT}=${RUN}`);
      expect(calls.find((args) => args[0] === 'workflow')).toContain(`dispatch_key=${createHash('sha256').update(KEY).digest('hex')}`);
      expect(calls.flat().join('\n')).not.toMatch(/trace_id|traceId|traceparent/);

      const reading = service(storePath);
      try {
        const bareResult = await handleWonderlandMissionReadRoute(readRequest('result', RUN), reading);
        const bareProgress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), reading);
        expect(bareResult?.body).toMatchObject({
          state: 'dispatched',
          traceId: TRACE_ID,
          dispatchedAt: WHEN,
          phases: null,
          projectBrainRevision: null,
          completion: null,
        });
        expect(bareProgress?.body).toMatchObject({
          state: 'dispatched', traceId: TRACE_ID, phases: null, projectBrainRevision: null,
        });
        expect(JSON.stringify(bareResult?.body)).not.toContain('"completed"');
        expect(JSON.stringify(bareProgress?.body)).not.toContain('"completed"');

        const nullReader = createJuliusMissionEvidenceTestDouble({ [RUN]: null });
        const nullResult = await handleWonderlandMissionReadRoute(readRequest('result', RUN), reading, nullReader);
        const nullProgress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), reading, nullReader);
        expect(nullResult?.body).toMatchObject({
          state: 'dispatched', traceId: TRACE_ID, phases: null, projectBrainRevision: null, completion: null,
        });
        expect(nullProgress?.body).toMatchObject({
          state: 'dispatched', traceId: TRACE_ID, phases: null, projectBrainRevision: null,
        });

        expect(nullResult?.body).toMatchObject({ checkerVerdict: 'NOT_RUN' });

        // A completed run with no grade is completed-and-unverified, not a verified completion.
        const ungraded = await handleWonderlandMissionReadRoute(readRequest('result', RUN), reading, createJuliusMissionEvidenceTestDouble({ [RUN]: readerCompletion() }));
        expect(ungraded?.body).toMatchObject({ state: 'completed', checkerVerdict: 'NOT_RUN' });
        const judged = 'b'.repeat(64);
        const checker = { reason: 'none', taskId: 'task:build-1', judgedTrimmedSha256: judged, gameDigest: judged.slice(0, 12), checkerSha256: JULIUS_PINNED_CHECKER_SHA256 };
        for (const verdict of ['PASS', 'FAIL'] as const) {
          const graded = createJuliusMissionEvidenceTestDouble({ [RUN]: { ...(readerCompletion() as Record<string, unknown>), checkerVerdict: verdict, checker } });
          const gradedResult = await handleWonderlandMissionReadRoute(readRequest('result', RUN), reading, graded);
          expect(gradedResult?.body, verdict).toMatchObject({ state: 'completed', checkerVerdict: verdict, completion: { checkerVerdict: verdict, checker } });
        }

        const reader = createJuliusMissionEvidenceTestDouble({ [RUN]: readerCompletion() });
        const doneResult = await handleWonderlandMissionReadRoute(readRequest('result', RUN), reading, reader);
        const doneProgress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), reading, reader);
        expect(doneResult?.status).toBe(200);
        expect(doneResult?.body).toMatchObject({
          state: 'completed',
          traceId: TRACE_ID,
          phases: null,
          projectBrainRevision: null,
          completion: {
            juliusFinalState: 'COMPLETED',
            traceId: TRACE_ID,
            traceparent: null,
            spendAccounting: null,
            projectBrainRevision: null,
            phases: null,
            workArtifactRefs: ['artifact:julius-work-artifact.v1:plan'],
            coderCost: { costUsdMicros: 1200, costBasis: 'PROVIDER_REPORTED' },
            missionCost: { knownUsdMicros: 1200, unknownComponents: 0, complete: true },
            providerReceipt: {
              providerRequestId: 'req_0123456789abcdef',
              responseId: 'resp_0123456789abcdef',
              providerRequestAvailability: 'CAPTURED',
            },
          },
        });
        expect(doneProgress?.body).toMatchObject({
          state: 'completed',
          traceId: TRACE_ID,
          phases: null,
          projectBrainRevision: null,
        });
        const serialized = `${JSON.stringify(doneResult?.body)}${JSON.stringify(doneProgress?.body)}`;
        expect(serialized).not.toContain(SUPPLIED_TRACE);
        expect(serialized).not.toContain(PLAN_SPAN);
        expect(serialized).not.toContain(BUILD_SPAN);
        expect(serialized).not.toContain(REVIEW_SPAN);
        expect(serialized).not.toContain(`"spanId":"${'a'.repeat(16)}"`);
        expect(serialized).not.toContain('"phases":[]');
        expect(serialized).not.toContain('"projectBrainRevision":0');
        expect(serialized).not.toContain('"responseId":"req_0123456789abcdef"');
      } finally {
        reading.close();
      }
    } finally {
      try { ports.close(); } catch { /* already closed before the claim */ }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the ceiling at dispatched with no reader, and gives legacy ids a null trace', async () => {
    expect(juliusMissionTraceId(LEGACY)).toBeNull();
    expect(juliusMissionTraceId('preflight:abc')).toBeNull();
    expect(juliusMissionSpanId(LEGACY, 'CODING_AGENT', 'build', 1)).toBeNull();
    expect(juliusMissionSpanId('preflight:abc', 'PROMPT_ARCHITECT', 'plan', 1)).toBeNull();
    expect(juliusMissionTraceId(RUN)).toBe(TRACE_ID);

    const { dir, storePath } = await admittedStore();
    const { calls, spawn } = fakeDispatcher();
    const claimed = await createOperatorClaimTool(openAdmissionFile(storePath), spawn, { nowIso: () => WHEN }, { read: () => Promise.resolve({ readable: true, counted: 0 }), readCompleted: () => Promise.resolve({ readable: true, counted: 0 }) }).claim({
      wonderlandRunId: RUN,
      serverRunId: RUN,
      repo: 'founder/sunday-relay',
      lane: 'lab',
      workflowSource: OFFLINE_WORKFLOW_FIXTURE,
      dispatch: true,
      confirmation: OPERATOR_DISPATCH_CONFIRMATION,
    });
    if (!claimed.ok) throw new Error(`offline claim refused: ${claimed.kind}`);
    expect(calls.map((args) => (args.some((arg) => arg.includes('/contents/')) ? 'main' : args[0]))).toEqual(['main', 'main', 'main', 'api', 'workflow']);
    const ports = service(storePath);
    try {
      const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports);
      const progress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports);
      expect(result?.body).toMatchObject({
        state: 'dispatched', traceId: TRACE_ID, phases: null, projectBrainRevision: null, completion: null,
      });
      expect(progress?.body).toMatchObject({
        state: 'dispatched', traceId: TRACE_ID, phases: null, projectBrainRevision: null,
      });
      expect(JSON.stringify(result?.body)).not.toContain('"completed"');

      const supplied = createJuliusMissionEvidenceTestDouble({
        [LEGACY]: { traceId: SUPPLIED_TRACE, juliusFinalState: 'COMPLETED' },
        'preflight:abc': { traceId: SUPPLIED_TRACE },
      });
      const legacyResult = await handleWonderlandMissionReadRoute(readRequest('result', LEGACY), ports, supplied);
      const legacyProgress = await handleWonderlandMissionReadRoute(readRequest('progress', LEGACY), ports, supplied);
      const preflight = await handleWonderlandMissionReadRoute(readRequest('result', 'preflight:abc'), ports, supplied);
      expect(legacyResult).toEqual(NOT_FOUND);
      expect(legacyProgress).toEqual(NOT_FOUND);
      expect(preflight).toEqual(NOT_FOUND);
      const denied = `${JSON.stringify(legacyResult)}${JSON.stringify(legacyProgress)}${JSON.stringify(preflight)}`;
      expect(denied).not.toContain(SUPPLIED_TRACE);
      expect(denied).not.toContain(TRACE_ID);
      expect(denied).not.toContain('traceId');
    } finally {
      ports.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
