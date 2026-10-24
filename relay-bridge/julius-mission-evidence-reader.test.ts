import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — the archive script is exercised for its digest only.
import { bundleDigest } from '../scripts/julius-paid-run-archive.mjs';
import { deriveJuliusSpentTag } from '../scripts/julius-admission-run-id.mjs';
import {
  createJuliusMissionEvidenceReader,
  type JuliusMissionGitHub,
  type JuliusMissionWorkflowRun,
} from './julius-mission-evidence-reader';

const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const LEGACY = 'run:0123456789abcdef01234567';
const SHA = 'a'.repeat(40);
const RUN = '4242';
const ATTEMPT = '1';

function tagMessage(run: string, extra = ''): string {
  return [
    'julius-run-spent.v1',
    `run=${run}`,
    'namespace=julius-first-live',
    'reservedUsdMicros=5000000',
    `workflow_run_id=${RUN}`,
    `workflow_run_attempt=${ATTEMPT}`,
    `head_sha=${SHA}`,
    extra,
  ].filter((line) => line !== '').join('\n') + '\n';
}

function github(message: string | null, run: JuliusMissionWorkflowRun | null | 'throw-run' | 'throw-tag'): JuliusMissionGitHub & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async readAnnotatedTagMessage(tagRef) {
      calls.push(`tag ${tagRef}`);
      if (message === null && run === 'throw-tag') throw new Error('tag unread');
      if (run === 'throw-tag') throw new Error('tag unread');
      return message;
    },
    async readWorkflowRun(workflowRunId, workflowRunAttempt) {
      calls.push(`run ${workflowRunId} ${workflowRunAttempt}`);
      if (run === 'throw-run' || run === 'throw-tag') throw new Error('run unread');
      return run;
    },
  };
}

function workflow(overrides: Partial<JuliusMissionWorkflowRun> = {}): JuliusMissionWorkflowRun {
  return {
    workflowRunId: RUN,
    workflowRunAttempt: ATTEMPT,
    headSha: SHA,
    status: 'completed',
    conclusion: 'success',
    failedSteps: [],
    artifacts: [],
    ...overrides,
  };
}

describe('JuliusMissionEvidenceReader', () => {
  it('does not call GitHub for a preflight id or any other non-admission id', async () => {
    const source = github(null, null);
    const reader = createJuliusMissionEvidenceReader(source);
    for (const id of ['preflight:abc', '', 'not-an-id', 'wlj_01234567-89ab-1cde-8fab-0123456789ab']) {
      const reading = await reader.read(id);
      expect(reading.state, id).toBe('dispatched');
      expect(reading.cause, id).toBeNull();
      expect(reading.spendTag, id).toBeNull();
      expect(reading.traceId, id).toBeNull();
      expect(reading.admissionForm, id).toBeNull();
      expect(reading.missionCost, id).toBeNull();
      expect(reading.coderCost, id).toBeNull();
    }
    expect(source.calls).toEqual([]);
  });

  it('stays dispatched when the spend tag is absent, malformed, or names another run', async () => {
    const derived = deriveJuliusSpentTag(WLJ);
    expect(derived.ok && derived.tag).toBe('refs/tags/julius-run-spent-0123456789ab4cde8fab0123456789ab');
    const absent = github(null, workflow());
    expect(await createJuliusMissionEvidenceReader(absent).read(WLJ)).toMatchObject({
      admissionForm: 'wlj',
      runId: WLJ,
      state: 'dispatched',
      spendTag: null,
      traceId: '192b1fbb866790da0ba590b4a8f45144',
      traceparent: null,
    });
    expect(absent.calls).toEqual([`tag ${derived.ok ? derived.tag : ''}`]);

    const malformed = github(`${tagMessage(WLJ)}forged=1\n`, workflow());
    expect((await createJuliusMissionEvidenceReader(malformed).read(WLJ)).spendTag).toBeNull();
    expect(malformed.calls).toEqual([`tag ${derived.ok ? derived.tag : ''}`]);

    const other = github(tagMessage('wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d'), workflow());
    expect((await createJuliusMissionEvidenceReader(other).read(WLJ)).state).toBe('dispatched');
    expect(other.calls.some((call) => call.startsWith('run '))).toBe(false);
  });

  it('stays dispatched when the tagged workflow run cannot be read or does not match', async () => {
    const thrown = github(tagMessage(WLJ), 'throw-run');
    const unread = await createJuliusMissionEvidenceReader(thrown).read(WLJ);
    expect(unread.state).toBe('dispatched');
    expect(unread.spendTag?.reservedUsdMicros).toBe(5_000_000);
    expect(unread.cause).toBeNull();
    expect(unread.juliusFinalState).toBeNull();

    const mismatch = github(tagMessage(WLJ), workflow({ headSha: 'b'.repeat(40) }));
    const reading = await createJuliusMissionEvidenceReader(mismatch).read(WLJ);
    expect(reading.state).toBe('dispatched');
    expect(reading.artifact).toBeNull();
    expect(reading.completedMarker).toBeNull();
    expect(reading.resultLine).toBeNull();
  });

  it('reports running only while the matched run is in progress', async () => {
    const running = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({ status: 'in_progress', conclusion: null }))).read(WLJ);
    expect(running.state).toBe('running');
    expect(running.juliusFinalState).toBeNull();
    expect(running.cause).toBeNull();
    const queued = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({ status: 'queued', conclusion: null }))).read(WLJ);
    expect(queued.state).toBe('dispatched');
  });

  it('completes only when the workflow, the marker, and the RESULT line agree', async () => {
    const diagnostics = [
      'run_id\trole\tstage\tdispatch_attempt\tprovider_request_id\tprovider_request_availability\tprovider_request_unavailable_reason\tcost_usd_micros\tcost_basis\texecution_cost_usd_micros\tbilling_path\ttrace_id\tspan_id',
      `${WLJ}\tCODING_AGENT\tbuild\t1\treq_0123456789abcdef\tCAPTURED\t\t1200\tPROVIDER_REPORTED\t1200\tAPI_BILLED\tffffffffffffffffffffffffffffffff\taaaaaaaaaaaaaaaa`,
      `${WLJ}\tPROMPT_ARCHITECT\tplan\t1\t\t\t\t\t\t\t\t\t`,
      '(2 rows)',
    ].join('\n');
    const evidence = [
      'run_id\tartifact_ref',
      `${WLJ}\tartifact:julius-work-artifact.v1:plan`,
      '(1 row)',
    ].join('\n');
    const costs = [
      'run_id\trole\tcomponents\tknown_usd_micros\testimated_usd_micros\tunknown_components\testimated_components\tunsettled_components',
      `${WLJ}\tCODING_AGENT\t1\t1200\t0\t0\t0\t0`,
      '(1 row)',
    ].join('\n');
    const runs = `run_id\tmission_id\tstate\n${WLJ}\tmission:julius-continuous-1\tCOMPLETED\n(1 row)\n`;
    const result = `RESULT: COMPLETED after 2 ticks\n  run: ${WLJ}\n`;
    const marker = [
      'completed_at=2026-10-24T13:00:00Z',
      `run_id=${RUN}`,
      `commit=${SHA}`,
      'workflow_ref=unknown',
      '',
    ].join('\n');
    const files = [
      { path: 'cost-accounting.tsv', text: costs },
      { path: 'evidence.tsv', text: evidence },
      { path: 'live-mission.evidence.txt', text: result },
      { path: 'runs.tsv', text: runs },
      { path: 'worker-diagnostics.tsv', text: diagnostics },
    ];
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({
      artifacts: [
        { name: 'julius-live-evidence', files },
        { name: 'julius-first-live-completed', files: [{ path: 'marker.txt', text: marker }] },
      ],
    }))).read(WLJ);

    expect(reading.state).toBe('completed');
    expect(reading.juliusFinalState).toBe('COMPLETED');
    expect(reading.cause).toBeNull();
    expect(reading.traceId).toBe('192b1fbb866790da0ba590b4a8f45144');
    expect(reading.traceparent).toBeNull();
    expect(reading.phases).toBeNull();
    expect(reading.spans).toEqual([
      {
        role: 'CODING_AGENT', stage: 'build', attempt: 1, spanId: '3e314a67b8845836',
        traceparent: '00-192b1fbb866790da0ba590b4a8f45144-3e314a67b8845836-01',
      },
      {
        role: 'PROMPT_ARCHITECT', stage: 'plan', attempt: 1, spanId: '83fcf8b101fb2299',
        traceparent: '00-192b1fbb866790da0ba590b4a8f45144-83fcf8b101fb2299-01',
      },
    ]);
    expect(reading.completedMarker).toMatchObject({ workflowRunId: RUN, commit: SHA });
    expect(reading.resultLine).toBe('RESULT: COMPLETED after 2 ticks');
    expect(reading.providerReceipt).toEqual({
      providerRequestId: 'req_0123456789abcdef',
      responseId: 'req_0123456789abcdef',
      providerRequestAvailability: 'CAPTURED',
      providerRequestUnavailableReason: null,
    });
    expect(reading.coderCost).toEqual({
      costUsdMicros: 1200, costBasis: 'PROVIDER_REPORTED', executionCostUsdMicros: 1200, billingPath: 'API_BILLED',
    });
    expect(reading.missionCost).toEqual({ knownUsdMicros: 1200, unknownComponents: 0, complete: true });
    expect(reading.spendAccounting).toMatchObject({ knownUsdMicros: 1200, spendVerified: null, unverifiableApiSpend: null });
    expect(reading.spendTag?.reservedUsdMicros).toBe(5_000_000);
    expect(reading.workArtifactRefs).toEqual(['artifact:julius-work-artifact.v1:plan']);
    expect(reading.projectBrainRevision).toBeNull();
    expect(reading.artifact?.name).toBe('julius-live-evidence');
    const digested = files.map((file) => ({
      path: file.path,
      sha256: createHash('sha256').update(file.text).digest('hex'),
    }));
    expect(reading.artifact?.digest).toBe(bundleDigest(digested.sort((a, b) => a.path.localeCompare(b.path))));
    expect(JSON.stringify(reading)).not.toContain('ffffffffffffffffffffffffffffffff');
    expect(reading.spans?.some((span) => span.spanId === 'aaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('does not invent a cost, a receipt, or a completion the bundle does not carry', async () => {
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({
      artifacts: [{ name: 'julius-live-evidence', files: null }],
    }))).read(WLJ);
    expect(reading.state).toBe('dispatched');
    expect(reading.missionCost).toBeNull();
    expect(reading.coderCost).toBeNull();
    expect(reading.providerReceipts).toBeNull();
    expect(reading.spans).toBeNull();
    expect(reading.artifact).toEqual({ name: 'julius-live-evidence', digest: null, fileCount: null, totalBytes: null });
    expect(reading.completedMarker).toBeNull();
    expect(reading.resultLine).toBeNull();
    expect(JSON.stringify(reading)).not.toContain('"knownUsdMicros":0');
  });

  it('names a failed run from the workflow conclusion and its failed steps', async () => {
    const result = `RESULT: FAILED after 1 ticks\n  run: ${WLJ}\n`;
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({
      conclusion: 'failure',
      failedSteps: ['first-live-mission: Run the live mission'],
      artifacts: [{ name: 'julius-live-evidence', files: [{ path: 'live-mission.evidence.txt', text: result }] }],
    }))).read(WLJ);
    expect(reading.state).toBe('failed');
    expect(reading.cause).toBe('failure: first-live-mission: Run the live mission');
    expect(reading.juliusFinalState).toBeNull();
    expect(reading.resultLine).toBe('RESULT: FAILED after 1 ticks');
    expect(reading.completedMarker).toBeNull();
  });

  it('stays dispatched when the marker and the workflow conclusion disagree', async () => {
    const marker = `completed_at=2026-10-24T13:00:00Z\nrun_id=${RUN}\ncommit=${SHA}\nworkflow_ref=unknown\n`;
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({
      conclusion: 'failure',
      failedSteps: ['first-live-mission: Run the live mission'],
      artifacts: [{ name: 'julius-first-live-completed', files: [{ path: 'marker.txt', text: marker }] }],
    }))).read(WLJ);
    expect(reading.state).toBe('dispatched');
    expect(reading.cause).toBeNull();
    expect(reading.completedMarker).toBeNull();
  });

  it('drops a credential-shaped request id and does not count it captured', async () => {
    const secret = ['sk', 'ant', 'A'.repeat(24)].join('-');
    const diagnostics = [
      'run_id\trole\tstage\tdispatch_attempt\tprovider_request_id\tprovider_request_availability\tprovider_request_unavailable_reason',
      `${WLJ}\tCODING_AGENT\tbuild\t1\t${secret}\tCAPTURED\t`,
      '(1 row)',
    ].join('\n');
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({
      status: 'in_progress',
      conclusion: null,
      artifacts: [{ name: 'julius-live-evidence', files: [{ path: 'worker-diagnostics.tsv', text: diagnostics }] }],
    }))).read(WLJ);
    expect(reading.providerReceipt?.providerRequestAvailability).toBe('UNAVAILABLE');
    expect(reading.providerReceipt?.providerRequestUnavailableReason).toBe('provider_request_id_credential_shaped');
    expect(reading.providerReceipt?.providerRequestId).toBeNull();
    expect(JSON.stringify(reading)).not.toContain(secret);
  });

  it('reads a legacy id without deriving a trace id or rewriting it', async () => {
    const derived = deriveJuliusSpentTag(LEGACY);
    const source = github(tagMessage(LEGACY), workflow({ conclusion: 'cancelled', failedSteps: [] }));
    const reading = await createJuliusMissionEvidenceReader(source).read(LEGACY);
    expect(reading.admissionForm).toBe('legacy');
    expect(reading.runId).toBe(LEGACY);
    expect(reading.state).toBe('failed');
    expect(reading.cause).toBe('cancelled');
    expect(reading.traceId).toBeNull();
    expect(reading.spans).toBeNull();
    expect(reading.juliusFinalState).toBeNull();
    expect(source.calls[0]).toBe(`tag ${derived.ok ? derived.tag : ''}`);
    expect(reading.runId?.startsWith('wlj_')).toBe(false);
  });
});
