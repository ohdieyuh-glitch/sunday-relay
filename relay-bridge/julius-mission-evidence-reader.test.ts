import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — the archive script is exercised for its digest only.
import { bundleDigest } from '../scripts/julius-paid-run-archive.mjs';
import { deriveJuliusSpentTag } from '../scripts/julius-admission-run-id.mjs';
import { juliusMissionTraceId } from '../scripts/julius-mission-trace.mjs';
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
const TRACE = juliusMissionTraceId(WLJ);

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

const MARKER = [
  'completed_at=2026-10-24T13:00:00Z',
  `run_id=${RUN}`,
  `commit=${SHA}`,
  'workflow_ref=unknown',
  '',
].join('\n');

const RESULT = `RESULT: COMPLETED after 2 ticks\n  run: ${WLJ}\n`;

function withProof(files: readonly { path: string; text: string }[], overrides: Partial<JuliusMissionWorkflowRun> = {}): JuliusMissionWorkflowRun {
  return workflow({
    ...overrides,
    artifacts: [
      { name: 'julius-live-evidence', files },
      { name: 'julius-first-live-completed', files: [{ path: 'marker.txt', text: MARKER }] },
    ],
  });
}

describe('JuliusMissionEvidenceReader', () => {
  it('returns null and does not call GitHub for an id that is not wlj_', async () => {
    const source = github(null, null);
    const reader = createJuliusMissionEvidenceReader(source);
    for (const id of ['preflight:abc', '', 'not-an-id', 'wlj_01234567-89ab-1cde-8fab-0123456789ab', LEGACY]) {
      expect(await reader.read(id), id).toBeNull();
    }
    expect(source.calls).toEqual([]);
  });

  it('returns null when the spend tag is absent, malformed, or names another run', async () => {
    const derived = deriveJuliusSpentTag(WLJ);
    expect(derived.ok && derived.tag).toBe('refs/tags/julius-run-spent-0123456789ab4cde8fab0123456789ab');
    const absent = github(null, workflow());
    expect(await createJuliusMissionEvidenceReader(absent).read(WLJ)).toBeNull();
    expect(absent.calls).toEqual([`tag ${derived.ok ? derived.tag : ''}`]);

    const malformed = github(`${tagMessage(WLJ)}forged=1\n`, workflow());
    expect(await createJuliusMissionEvidenceReader(malformed).read(WLJ)).toBeNull();
    expect(malformed.calls.some((call) => call.startsWith('run '))).toBe(false);

    const other = github(tagMessage('wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d'), workflow());
    expect(await createJuliusMissionEvidenceReader(other).read(WLJ)).toBeNull();
    expect(other.calls.some((call) => call.startsWith('run '))).toBe(false);
  });

  it('returns null when the tagged workflow run cannot be read or does not match', async () => {
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), 'throw-run')).read(WLJ)).toBeNull();
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), 'throw-tag')).read(WLJ)).toBeNull();
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({ headSha: 'b'.repeat(40) }))).read(WLJ)).toBeNull();
  });

  it('returns null while the matched run is queued or in progress', async () => {
    const running = github(tagMessage(WLJ), workflow({ status: 'in_progress', conclusion: null }));
    expect(await createJuliusMissionEvidenceReader(running).read(WLJ)).toBeNull();
    expect(running.calls.some((call) => call.startsWith('run '))).toBe(true);
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({ status: 'queued', conclusion: null }))).read(WLJ)).toBeNull();
  });

  it('returns the completion object only when the workflow, the marker, and the RESULT line agree', async () => {
    const reviewerRequest = 'req_reviewer_0123456789';
    const messageId = 'msg_should_not_appear';
    const diagnostics = [
      'run_id\trole\tstage\tdispatch_attempt\tprovider_request_id\tresponse_id\tprovider_message_id\tprovider_request_availability\tprovider_request_unavailable_reason\tcost_usd_micros\tcost_basis\texecution_cost_usd_micros\tbilling_path\ttrace_id\tspan_id',
      `${WLJ}\tCODING_AGENT\tbuild\t1\treq_0123456789abcdef\tresp_0123456789abcdef\t${messageId}\tCAPTURED\t\t1200\tPROVIDER_REPORTED\t1200\tAPI_BILLED\tffffffffffffffffffffffffffffffff\taaaaaaaaaaaaaaaa`,
      `${WLJ}\tPROMPT_ARCHITECT\tplan\t1\t\t\t\t\t\t\t\t\t\t\t`,
      `${WLJ}\tINDEPENDENT_REVIEWER\trepair:plan\t1\t${reviewerRequest}\t\t\tCAPTURED\t\t\t\t\t\t\t`,
      '(3 rows)',
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
    const runs = `run_id\tmission_id\tstate\tcard_revision\n${WLJ}\tmission:julius-continuous-1\tCOMPLETED\t7\n(1 row)\n`;
    const files = [
      { path: 'cost-accounting.tsv', text: costs },
      { path: 'evidence.tsv', text: evidence },
      { path: 'live-mission.evidence.txt', text: RESULT },
      { path: 'runs.tsv', text: runs },
      { path: 'worker-diagnostics.tsv', text: diagnostics },
    ];
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof(files))).read(WLJ);
    const digested = files.map((file) => ({
      path: file.path,
      sha256: createHash('sha256').update(file.text).digest('hex'),
      kind: file.path.endsWith('.tsv') ? 'table' : 'text',
    }));

    expect(reading).toEqual({
      juliusFinalState: 'COMPLETED',
      spendTag: {
        schema: 'julius-run-spent.v1',
        run: WLJ,
        namespace: 'julius-first-live',
        reservedUsdMicros: 5_000_000,
        workflowRunId: RUN,
        workflowRunAttempt: ATTEMPT,
        headSha: SHA,
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
        artifactDigest: bundleDigest([...digested].sort((a, b) => a.path.localeCompare(b.path))),
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.text, 'utf8'), 0),
        conclusion: 'success',
        failedSteps: [],
        files: digested,
      },
      workArtifactRefs: ['artifact:julius-work-artifact.v1:plan'],
      projectBrainRevision: null,
      phases: null,
      traceId: TRACE,
      traceparent: null,
    });
    const json = JSON.stringify(reading);
    expect(json).not.toContain('ffffffffffffffffffffffffffffffff');
    expect(json).not.toContain('"spanId"');
    expect(json).not.toContain(messageId);
    expect(json).not.toContain(reviewerRequest);
    expect(json).not.toContain('providerMessageId');
    expect(TRACE).toBe('192b1fbb866790da0ba590b4a8f45144');
  });

  it('does not invent a cost or a phase list the bundle does not carry', async () => {
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
      { path: 'live-mission.evidence.txt', text: RESULT },
    ]))).read(WLJ);
    expect(reading).toMatchObject({
      juliusFinalState: 'COMPLETED',
      spendAccounting: null,
      coderCost: null,
      missionCost: null,
      providerReceipt: null,
      workArtifactRefs: null,
      projectBrainRevision: null,
      phases: null,
      traceId: TRACE,
      traceparent: null,
    });
    expect(JSON.stringify(reading)).not.toContain('"knownUsdMicros":0');
  });

  it('returns null for a failed run and for a marker that disagrees with the conclusion', async () => {
    const failed = `RESULT: FAILED after 1 ticks\n  run: ${WLJ}\n`;
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({
      conclusion: 'failure',
      failedSteps: ['first-live-mission: Run the live mission'],
      artifacts: [{ name: 'julius-live-evidence', files: [{ path: 'live-mission.evidence.txt', text: failed }] }],
    }))).read(WLJ)).toBeNull();

    const marker = `completed_at=2026-10-24T13:00:00Z\nrun_id=${RUN}\ncommit=${SHA}\nworkflow_ref=unknown\n`;
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({
      conclusion: 'failure',
      failedSteps: ['first-live-mission: Run the live mission'],
      artifacts: [
        { name: 'julius-live-evidence', files: [{ path: 'live-mission.evidence.txt', text: RESULT }] },
        { name: 'julius-first-live-completed', files: [{ path: 'marker.txt', text: marker }] },
      ],
    }))).read(WLJ)).toBeNull();
  });

  it('drops a credential-shaped request id and does not count it captured', async () => {
    const secret = ['sk', 'ant', 'A'.repeat(24)].join('-');
    const diagnostics = [
      'run_id\trole\tprovider_request_id\tprovider_request_availability',
      `${WLJ}\tCODING_AGENT\t${secret}\tCAPTURED`,
      '(1 row)',
    ].join('\n');
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
      { path: 'live-mission.evidence.txt', text: RESULT },
      { path: 'worker-diagnostics.tsv', text: diagnostics },
    ]))).read(WLJ);
    expect(reading).toMatchObject({
      providerReceipt: {
        providerRequestId: null,
        responseId: null,
        providerRequestAvailability: 'UNAVAILABLE',
        providerRequestUnavailableReason: 'provider_request_id_credential_shaped',
      },
    });
    expect(JSON.stringify(reading)).not.toContain(secret);
  });

  it('returns null when runs.tsv names a different state', async () => {
    const runs = `run_id\tstate\n${WLJ}\tFAILED\n(1 row)\n`;
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
      { path: 'live-mission.evidence.txt', text: RESULT },
      { path: 'runs.tsv', text: runs },
    ]))).read(WLJ)).toBeNull();
  });
});
