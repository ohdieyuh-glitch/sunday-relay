/**
 * Conformance fixture for YUJI's reader. The object below is copied from
 * 041d2599 relay-bridge/julius-mission-evidence-reader.test.ts:158-197.
 * That reader builds it at relay-bridge/julius-mission-evidence-reader.ts:523-537.
 * The file texts hashed into the archive are the ones at lines 124-156 of
 * the same test. This file does not import the #445/#446 stack.
 *
 * `responseId` there is `resp_0123456789abcdef`. `providerRequestId` is
 * `req_0123456789abcdef`. They stay two fields.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { juliusMissionTraceId } from '../scripts/julius-mission-trace.mjs';
import { acceptJuliusMissionEvidence } from './julius-mission-evidence';

const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const SHA = 'a'.repeat(40);
const DERIVED_TRACE = '192b1fbb866790da0ba590b4a8f45144';
const REQUEST_ID = 'req_0123456789abcdef';
const RESPONSE_ID = 'resp_0123456789abcdef';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Same digest as scripts/julius-paid-run-archive.mjs bundleDigest, path-sorted. */
function bundleDigest(files: readonly { path: string; sha256: string }[]): string {
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  return sha256(ordered.map((file) => `${file.path}\0${file.sha256}`).join('\n'));
}

/**
 * 041d2599 relay-bridge/julius-mission-evidence-reader.test.ts:124-197.
 * Returned only when the tag, the succeeded run, the marker, the single
 * RESULT: COMPLETED line, and runs.tsv agree.
 */
function readerOutput(): Record<string, unknown> {
  const messageId = 'msg_should_not_appear';
  const reviewerRequest = 'req_reviewer_0123456789';
  const diagnostics = [
    'run_id\trole\tstage\tdispatch_attempt\tprovider_request_id\tresponse_id\tprovider_message_id\tprovider_request_availability\tprovider_request_unavailable_reason\tcost_usd_micros\tcost_basis\texecution_cost_usd_micros\tbilling_path\ttrace_id\tspan_id',
    `${WLJ}\tCODING_AGENT\tbuild\t1\t${REQUEST_ID}\t${RESPONSE_ID}\t${messageId}\tCAPTURED\t\t1200\tPROVIDER_REPORTED\t1200\tAPI_BILLED\tffffffffffffffffffffffffffffffff\taaaaaaaaaaaaaaaa`,
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
  const result = `RESULT: COMPLETED after 2 ticks\n  run: ${WLJ}\n`;
  const files = [
    { path: 'cost-accounting.tsv', text: costs },
    { path: 'evidence.tsv', text: evidence },
    { path: 'live-mission.evidence.txt', text: result },
    { path: 'runs.tsv', text: runs },
    { path: 'worker-diagnostics.tsv', text: diagnostics },
  ];
  const digested = files.map((file) => ({
    path: file.path,
    sha256: sha256(file.text),
    kind: file.path.endsWith('.tsv') ? 'table' as const : 'text' as const,
  }));
  return {
    juliusFinalState: 'COMPLETED',
    spendTag: {
      schema: 'julius-run-spent.v1',
      run: WLJ,
      namespace: 'julius-first-live',
      reservedUsdMicros: 5_000_000,
      workflowRunId: '4242',
      workflowRunAttempt: '1',
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
      providerRequestId: REQUEST_ID,
      responseId: RESPONSE_ID,
      providerRequestAvailability: 'CAPTURED',
      providerRequestUnavailableReason: null,
    },
    archive: {
      artifactName: 'julius-live-evidence',
      artifactDigest: bundleDigest(digested),
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.text, 'utf8'), 0),
      conclusion: 'success',
      failedSteps: [],
      files: digested,
    },
    workArtifactRefs: ['artifact:julius-work-artifact.v1:plan'],
    projectBrainRevision: null,
    phases: null,
    traceId: juliusMissionTraceId(WLJ),
    traceparent: null,
  };
}

describe('acceptJuliusMissionEvidence accepts the #446 object', () => {
  it('keeps the copied fields and derives its own trace id', () => {
    expect(juliusMissionTraceId(WLJ)).toBe(DERIVED_TRACE);
    const fixture = readerOutput();
    const accepted = acceptJuliusMissionEvidence(WLJ, fixture);
    expect(accepted.phases).toBeNull();
    expect(accepted.completion).toEqual({
      ...fixture,
      traceId: DERIVED_TRACE,
      traceparent: null,
    });
    const receipt = accepted.completion?.providerReceipt;
    expect(receipt?.providerRequestId).toBe(REQUEST_ID);
    expect(receipt?.responseId).toBe(RESPONSE_ID);
    expect(receipt?.responseId).not.toBe(receipt?.providerRequestId);
    expect(accepted.completion?.spendAccounting).toBeNull();
    expect(accepted.completion?.projectBrainRevision).toBeNull();
    expect(accepted.completion?.phases).toBeNull();
    const json = JSON.stringify(accepted);
    expect(json).not.toContain('ffffffffffffffffffffffffffffffff');
    expect(json).not.toContain('"spanId"');
    expect(json).not.toContain('msg_should_not_appear');
    expect(json).not.toContain('req_reviewer_0123456789');
    expect(json).not.toContain('providerMessageId');
    expect(json).not.toContain('"phases":[]');
    expect(json).not.toContain('"projectBrainRevision":0');
  });

  it('ignores a trace id on the payload and does not copy a missing response id', () => {
    const fixture = readerOutput();
    const poisoned = {
      ...fixture,
      traceId: 'f'.repeat(32),
      traceparent: `00-${'f'.repeat(32)}-${'a'.repeat(16)}-01`,
      providerReceipt: {
        providerRequestId: REQUEST_ID,
        providerRequestAvailability: 'CAPTURED',
        providerRequestUnavailableReason: null,
      },
    };
    const accepted = acceptJuliusMissionEvidence(WLJ, poisoned);
    expect(accepted.completion?.traceId).toBe(DERIVED_TRACE);
    expect(accepted.completion?.traceparent).toBeNull();
    expect(accepted.completion?.providerReceipt).toEqual({
      providerRequestId: REQUEST_ID,
      responseId: null,
      providerRequestAvailability: 'CAPTURED',
      providerRequestUnavailableReason: null,
    });
    const json = JSON.stringify(accepted);
    expect(json).not.toContain('f'.repeat(32));
    expect(json).not.toContain(`"responseId":"${REQUEST_ID}"`);
  });

  it('keeps a response id the payload set, even when that string equals the request id', () => {
    const fixture = readerOutput();
    const same = {
      ...fixture,
      providerReceipt: {
        providerRequestId: REQUEST_ID,
        responseId: REQUEST_ID,
        providerRequestAvailability: 'CAPTURED',
        providerRequestUnavailableReason: null,
      },
    };
    const accepted = acceptJuliusMissionEvidence(WLJ, same);
    expect(accepted.completion?.providerReceipt?.providerRequestId).toBe(REQUEST_ID);
    expect(accepted.completion?.providerReceipt?.responseId).toBe(REQUEST_ID);
  });

  it('a null read is not completion, and null sections stay null', () => {
    expect(acceptJuliusMissionEvidence(WLJ, null)).toEqual({ completion: null, phases: null });
    // 041d2599 relay-bridge/julius-mission-evidence-reader.test.ts:211-222.
    const sparse = {
      juliusFinalState: 'COMPLETED',
      spendTag: {
        schema: 'julius-run-spent.v1',
        run: WLJ,
        namespace: 'julius-first-live',
        reservedUsdMicros: 5_000_000,
        workflowRunId: '4242',
        workflowRunAttempt: '1',
        headSha: SHA,
      },
      spendAccounting: null,
      coderCost: null,
      missionCost: null,
      providerReceipt: null,
      workArtifactRefs: null,
      projectBrainRevision: null,
      phases: null,
      traceId: 'f'.repeat(32),
      traceparent: null,
    };
    const accepted = acceptJuliusMissionEvidence(WLJ, sparse);
    expect(accepted).toEqual({
      completion: {
        juliusFinalState: 'COMPLETED',
        spendTag: sparse.spendTag,
        spendAccounting: null,
        coderCost: null,
        missionCost: null,
        providerReceipt: null,
        archive: null,
        workArtifactRefs: null,
        projectBrainRevision: null,
        phases: null,
        traceId: DERIVED_TRACE,
        traceparent: null,
      },
      phases: null,
    });
    expect(JSON.stringify(accepted)).not.toContain('"knownUsdMicros":0');
    expect(JSON.stringify(accepted)).not.toContain('f'.repeat(32));
  });
});
