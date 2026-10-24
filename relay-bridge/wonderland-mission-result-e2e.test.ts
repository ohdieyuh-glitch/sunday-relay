/**
 * OFFLINE / NOT A PAID RUN.
 *
 * End-to-end of the Wonderland mission read. Admission is the #407 route.
 * Dispatch is an injected fake GhSpawner: it returns scripted results and
 * starts no process. Evidence is createJuliusMissionEvidenceTestDouble.
 * No network, no real provider, no gh, no spend.
 *
 * The fixtures below are synthetic. They are not a bill and not a workflow run.
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
  SERVER_RUN_ID_INPUT,
  createOperatorClaimTool,
  type GhResult,
  type GhSpawner,
} from '../src/relay/integration/wonderland-admission/operator-claim';
import { createJuliusMissionEvidenceTestDouble } from './julius-mission-evidence';
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
const WORK_REF = `artifact:julius-work-artifact.v1:${RUN}:build-1:g1:DIFF`;
const NOT_FOUND = { status: 404, body: { error: { kind: 'not_found', message: 'Not found.' } } };

/**
 * OFFLINE fixture. Declares server_run_id so the claim tool can build
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
      server_run_id:
        description: 'Julius bootstrap run id'
        required: false
        default: ''
`;

const ABSENT: GhResult = {
  code: 1,
  stdout: 'HTTP/2.0 404 Not Found\n{"message":"Not Found"}\n',
  stderr: '',
};
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

function phase(role: string, stage: string, attempt: number, state = 'ACTIVE'): Record<string, unknown> {
  return { role, state, stage, attempt, knownUsdMicros: null, costComplete: false };
}

interface PhaseView {
  readonly role: string;
  readonly stage: string | null;
  readonly attempt: number | null;
  readonly spanId: string | null;
  readonly traceparent: string | null;
}

function phasesOf(body: unknown): PhaseView[] {
  const record = body !== null && typeof body === 'object' ? body as { phases?: PhaseView[] | null } : {};
  return record.phases ?? [];
}

function traceparent(spanId: string): string {
  return `00-${TRACE_ID}-${spanId}-01`;
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
  it('admits a wlj id, fake-dispatches, and walks plan, build, review, and COMPLETED', async () => {
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
        completion: null,
      });
      ports.close();

      const { calls, spawn } = fakeDispatcher();
      const claimed = await createOperatorClaimTool(openAdmissionFile(storePath), spawn, { nowIso: () => WHEN }).claim({
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
      expect(calls.map((args) => args[0])).toEqual(['api', 'workflow']);
      expect(calls[1]).toContain(`${SERVER_RUN_ID_INPUT}=${RUN}`);
      expect(calls[1]).toContain(`dispatch_key=${createHash('sha256').update(KEY).digest('hex')}`);
      expect(calls.flat().join('\n')).not.toMatch(/trace_id|traceId|traceparent/);

      const reading = service(storePath);
      try {
        const bareResult = await handleWonderlandMissionReadRoute(readRequest('result', RUN), reading);
        const bareProgress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), reading);
        expect(bareResult?.body).toMatchObject({
          state: 'dispatched',
          traceId: TRACE_ID,
          dispatchedAt: WHEN,
          completion: null,
        });
        expect(bareProgress?.body).toMatchObject({ state: 'dispatched', traceId: TRACE_ID, phases: null });
        expect(JSON.stringify(bareResult?.body)).not.toContain('"completed"');
        expect(JSON.stringify(bareProgress?.body)).not.toContain('"completed"');

        const evidence: Record<string, unknown> = {
          traceId: SUPPLIED_TRACE,
          traceparent: `00-${SUPPLIED_TRACE}-${'a'.repeat(16)}-01`,
          spanId: 'a'.repeat(16),
          phases: [phase('PROMPT_ARCHITECT', 'plan', 1)],
        };
        const reader = createJuliusMissionEvidenceTestDouble({ [RUN]: evidence });

        const plan = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), reading, reader);
        expect(plan?.body).toMatchObject({ state: 'dispatched', traceId: TRACE_ID });
        expect(phasesOf(plan?.body)).toEqual([
          expect.objectContaining({
            role: 'PROMPT_ARCHITECT', stage: 'plan', attempt: 1, spanId: PLAN_SPAN, traceparent: traceparent(PLAN_SPAN),
          }),
        ]);

        evidence.phases = [
          phase('PROMPT_ARCHITECT', 'plan', 1),
          phase('CODING_AGENT', 'build', 1),
        ];
        const build = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), reading, reader);
        expect(build?.body).toMatchObject({ state: 'dispatched', traceId: TRACE_ID });
        expect(phasesOf(build?.body).map((row) => [row.role, row.spanId])).toEqual([
          ['PROMPT_ARCHITECT', PLAN_SPAN],
          ['CODING_AGENT', BUILD_SPAN],
        ]);

        // The closed stage set has no stage named "review". The review step
        // is the independent reviewer. repair:plan attempt 1 is that role's
        // KAT span for this wlj id.
        evidence.phases = [
          phase('PROMPT_ARCHITECT', 'plan', 1),
          phase('CODING_AGENT', 'build', 1),
          phase('INDEPENDENT_REVIEWER', 'repair:plan', 1),
        ];
        const review = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), reading, reader);
        const reviewResult = await handleWonderlandMissionReadRoute(readRequest('result', RUN), reading, reader);
        expect(review?.body).toMatchObject({ state: 'dispatched', traceId: TRACE_ID });
        expect(reviewResult?.body).toMatchObject({ state: 'dispatched', traceId: TRACE_ID, completion: null });
        expect(phasesOf(review?.body).map((row) => [row.role, row.spanId, row.traceparent])).toEqual([
          ['PROMPT_ARCHITECT', PLAN_SPAN, traceparent(PLAN_SPAN)],
          ['CODING_AGENT', BUILD_SPAN, traceparent(BUILD_SPAN)],
          ['INDEPENDENT_REVIEWER', REVIEW_SPAN, traceparent(REVIEW_SPAN)],
        ]);

        Object.assign(evidence, {
          juliusFinalState: 'COMPLETED',
          spendTag: {
            schema: 'julius-run-spent.v1',
            run: RUN,
            namespace: 'offline-fixture',
            reservedUsdMicros: 0,
            workflowRunId: '4242',
            workflowRunAttempt: '1',
            headSha: 'ab'.repeat(20),
          },
          coderCost: {
            costUsdMicros: 12,
            costBasis: 'PROVIDER_REPORTED',
            executionCostUsdMicros: null,
            billingPath: 'API_BILLED',
          },
          workArtifactRefs: [WORK_REF],
          projectBrainRevision: 3,
          providerReceipt: {
            providerRequestId: 'req_offline_fixture_1',
            responseId: 'req_offline_fixture_1',
            providerRequestAvailability: 'CAPTURED',
            providerRequestUnavailableReason: null,
          },
          phases: [
            phase('PROMPT_ARCHITECT', 'plan', 1, 'IDLE'),
            phase('CODING_AGENT', 'build', 1, 'IDLE'),
            phase('INDEPENDENT_REVIEWER', 'repair:plan', 1, 'IDLE'),
          ],
        });
        const doneResult = await handleWonderlandMissionReadRoute(readRequest('result', RUN), reading, reader);
        const doneProgress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), reading, reader);
        expect(doneResult?.status).toBe(200);
        expect(doneResult?.body).toMatchObject({
          state: 'completed',
          traceId: TRACE_ID,
          completion: {
            juliusFinalState: 'COMPLETED',
            traceId: TRACE_ID,
            traceparent: null,
            projectBrainRevision: 3,
            workArtifactRefs: [WORK_REF],
            coderCost: { costUsdMicros: 12 },
            providerReceipt: {
              providerRequestId: 'req_offline_fixture_1',
              responseId: 'req_offline_fixture_1',
              providerRequestAvailability: 'CAPTURED',
            },
          },
        });
        expect(doneProgress?.body).toMatchObject({ state: 'completed', traceId: TRACE_ID });
        expect(phasesOf(doneProgress?.body).map((row) => row.spanId)).toEqual([PLAN_SPAN, BUILD_SPAN, REVIEW_SPAN]);
        const serialized = `${JSON.stringify(doneResult?.body)}${JSON.stringify(doneProgress?.body)}${JSON.stringify(review?.body)}`;
        expect(serialized).not.toContain(SUPPLIED_TRACE);
        expect(serialized).not.toContain(`"spanId":"${'a'.repeat(16)}"`);
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
    const claimed = await createOperatorClaimTool(openAdmissionFile(storePath), spawn, { nowIso: () => WHEN }).claim({
      wonderlandRunId: RUN,
      serverRunId: RUN,
      repo: 'founder/sunday-relay',
      lane: 'lab',
      workflowSource: OFFLINE_WORKFLOW_FIXTURE,
      dispatch: true,
      confirmation: OPERATOR_DISPATCH_CONFIRMATION,
    });
    if (!claimed.ok) throw new Error(`offline claim refused: ${claimed.kind}`);
    expect(calls.map((args) => args[0])).toEqual(['api', 'workflow']);
    const ports = service(storePath);
    try {
      const result = await handleWonderlandMissionReadRoute(readRequest('result', RUN), ports);
      const progress = await handleWonderlandMissionReadRoute(readRequest('progress', RUN), ports);
      expect(result?.body).toMatchObject({ state: 'dispatched', traceId: TRACE_ID, completion: null });
      expect(progress?.body).toMatchObject({ state: 'dispatched', traceId: TRACE_ID, phases: null });
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
