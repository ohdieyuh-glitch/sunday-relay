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
import { JULIUS_PINNED_CHECKER_SHA256, acceptJuliusMissionEvidence } from './julius-mission-evidence';

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
      checkerVerdict: 'NOT_RUN',
      checker: null,
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
        checkerVerdict: 'NOT_RUN',
        checker: null,
      },
      phases: null,
    });
    expect(JSON.stringify(accepted)).not.toContain('"knownUsdMicros":0');
    expect(JSON.stringify(accepted)).not.toContain('f'.repeat(32));
  });
});

/**
 * 44a7f1e1 relay-bridge/julius-mission-evidence-reader.test.ts:382-400.
 * The reader assigns these on a present slot ledger. `spanId` and
 * `traceparent` are null at julius-mission-evidence-reader.ts:546-547.
 */
const CODER_PHASE = {
  role: 'CODING_AGENT',
  state: 'IDLE',
  stage: 'repair:build',
  attempt: 2,
  spanId: null,
  traceparent: null,
  knownUsdMicros: 1000,
  costComplete: true,
} as const;

const ABSENT_PHASE = {
  state: 'NEVER_DISPATCHED',
  stage: null,
  attempt: null,
  spanId: null,
  traceparent: null,
  knownUsdMicros: 0,
  costComplete: true,
} as const;

/** 44a7f1e1 relay-bridge/julius-mission-evidence-reader.test.ts:411-415. */
const PRESENT_PHASES = [
  { role: 'PROMPT_ARCHITECT', ...ABSENT_PHASE },
  CODER_PHASE,
  { role: 'INDEPENDENT_REVIEWER', ...ABSENT_PHASE },
] as const;

/**
 * 44a7f1e1 relay-bridge/julius-mission-evidence-reader.test.ts:436-438.
 * The reader also sets spanId and traceparent null (reader.ts:546-547).
 */
const HEADER_ONLY_PHASES = [
  { role: 'PROMPT_ARCHITECT', state: 'NEVER_DISPATCHED', knownUsdMicros: 0, costComplete: true, stage: null, attempt: null, spanId: null, traceparent: null },
  { role: 'CODING_AGENT', state: 'NEVER_DISPATCHED', knownUsdMicros: 0, costComplete: true, stage: null, attempt: null, spanId: null, traceparent: null },
  { role: 'INDEPENDENT_REVIEWER', state: 'NEVER_DISPATCHED', knownUsdMicros: 0, costComplete: true, stage: null, attempt: null, spanId: null, traceparent: null },
] as const;

describe('acceptJuliusMissionEvidence accepts the #454 projection', () => {
  it('keeps a present phase projection and a projectBrainRevision of 0', () => {
    // 44a7f1e1 reader.test.ts:407-416.
    const accepted = acceptJuliusMissionEvidence(WLJ, {
      ...readerOutput(),
      spendAccounting: null,
      projectBrainRevision: 0,
      phases: PRESENT_PHASES,
    });
    expect(accepted.completion?.juliusFinalState).toBe('COMPLETED');
    expect(accepted.completion?.spendAccounting).toBeNull();
    expect(accepted.completion?.projectBrainRevision).toBe(0);
    expect(accepted.phases).toEqual(PRESENT_PHASES);
    expect(accepted.completion?.phases).toEqual(PRESENT_PHASES);
    expect(accepted.completion?.traceId).toBe(DERIVED_TRACE);
    const json = JSON.stringify(accepted);
    expect(json).toContain('"projectBrainRevision":0');
    expect(json).toContain('"knownUsdMicros":0');
    expect(json).toContain('"spanId":null');
    expect(json).not.toContain('"spanId":"');
    expect(json).not.toContain('spendVerified');
    expect(json).not.toContain('unverifiableApiSpend');
  });

  it('keeps a positive projectBrainRevision on that same projection', () => {
    // 44a7f1e1 reader.test.ts:417.
    const accepted = acceptJuliusMissionEvidence(WLJ, {
      ...readerOutput(),
      spendAccounting: null,
      projectBrainRevision: 4,
      phases: PRESENT_PHASES,
    });
    expect(accepted.completion?.projectBrainRevision).toBe(4);
    expect(accepted.completion?.spendAccounting).toBeNull();
    expect(accepted.phases).toEqual(PRESENT_PHASES);
  });

  it('keeps three NEVER_DISPATCHED phases from a header-only ledger', () => {
    // 44a7f1e1 reader.test.ts:434-438.
    const accepted = acceptJuliusMissionEvidence(WLJ, {
      ...readerOutput(),
      projectBrainRevision: 0,
      phases: HEADER_ONLY_PHASES,
    });
    expect(accepted.completion?.projectBrainRevision).toBe(0);
    expect(accepted.phases).toEqual(HEADER_ONLY_PHASES);
    expect(JSON.stringify(accepted)).toContain('"knownUsdMicros":0');
    expect(JSON.stringify(accepted)).not.toContain('"phases":[]');
  });

  it('keeps a null phase list when the slot file is missing or unusable, and a positive revision', () => {
    // 44a7f1e1 reader.test.ts:446-452 and :486-488.
    for (const phases of [null, undefined]) {
      const accepted = acceptJuliusMissionEvidence(WLJ, {
        ...readerOutput(),
        spendAccounting: null,
        projectBrainRevision: 4,
        phases,
      });
      expect(accepted.completion?.juliusFinalState).toBe('COMPLETED');
      expect(accepted.completion?.projectBrainRevision).toBe(4);
      expect(accepted.completion?.spendAccounting).toBeNull();
      expect(accepted.phases).toBeNull();
      expect(accepted.completion?.phases).toBeNull();
    }
  });

  it('keeps the header-only phases when the run counter is null', () => {
    // 44a7f1e1 reader.test.ts:503-508. An empty or non-integer cell is null.
    for (const projectBrainRevision of [null, '', 'nope', -1, 1.5, false]) {
      const accepted = acceptJuliusMissionEvidence(WLJ, {
        ...readerOutput(),
        spendAccounting: null,
        projectBrainRevision,
        phases: HEADER_ONLY_PHASES,
      });
      expect(accepted.completion?.projectBrainRevision).toBeNull();
      expect(accepted.phases).toEqual(HEADER_ONLY_PHASES);
      expect(JSON.stringify(accepted.completion)).not.toContain('"projectBrainRevision":0');
    }
  });

  it('drops a phase list that is not the projection and does not invent one', () => {
    const malformed = [
      [{ role: 'CODING_AGENT', ...ABSENT_PHASE, state: 'ACTIVE' }],
      [],
      PRESENT_PHASES.map((phase) => ({ ...phase, spanId: 'a'.repeat(16) })),
      PRESENT_PHASES.map((phase) => ({ ...phase, knownUsdMicros: null })),
      PRESENT_PHASES.map((phase, index) => index === 1 ? { ...phase, stage: 'checkpoint' } : phase),
    ];
    for (const phases of malformed) {
      const accepted = acceptJuliusMissionEvidence(WLJ, {
        ...readerOutput(),
        projectBrainRevision: 4,
        phases,
      });
      expect(accepted.completion?.juliusFinalState).toBe('COMPLETED');
      expect(accepted.completion?.projectBrainRevision).toBe(4);
      expect(accepted.phases).toBeNull();
      const json = JSON.stringify(accepted);
      expect(json).not.toContain('"spanId":"');
      expect(json).not.toContain('NEVER_DISPATCHED');
      expect(json).not.toContain('"phases":[]');
    }
  });

  it('does not publish phases from a read that is not a verified completion', () => {
    const accepted = acceptJuliusMissionEvidence(WLJ, {
      juliusFinalState: 'EXECUTING',
      projectBrainRevision: 0,
      phases: PRESENT_PHASES,
    });
    expect(accepted).toEqual({ completion: null, phases: null });
  });
});

describe('the hidden checker verdict is a closed field', () => {
  const judged = 'b'.repeat(64);
  const checker = { reason: 'none', taskId: 'task:build-1', judgedTrimmedSha256: judged, gameDigest: judged.slice(0, 12), checkerSha256: JULIUS_PINNED_CHECKER_SHA256 };
  const withVerdict = (checkerVerdict: unknown, evidence: unknown = checker) => acceptJuliusMissionEvidence(WLJ, { ...(readerOutput() as Record<string, unknown>), checkerVerdict, checker: evidence });

  it('keeps PASS and FAIL with what was judged', () => {
    expect(withVerdict('PASS').completion).toMatchObject({ checkerVerdict: 'PASS', checker });
    expect(withVerdict('FAIL').completion).toMatchObject({ checkerVerdict: 'FAIL' });
  });

  it('reads anything else, or a verdict that names no judged bytes, as NOT_RUN', () => {
    for (const token of [undefined, null, 'pass', 'COMPLETED', 1, true]) {
      expect(withVerdict(token).completion?.checkerVerdict, String(token)).toBe('NOT_RUN');
    }
    expect(withVerdict('PASS', null).completion?.checkerVerdict).toBe('NOT_RUN');
    expect(withVerdict('PASS', { ...checker, gameDigest: '000000000000' }).completion?.checkerVerdict).toBe('NOT_RUN');
    expect(withVerdict('PASS', { ...checker, judgedTrimmedSha256: 'not-a-sha' }).completion?.checkerVerdict).toBe('NOT_RUN');
  });
});

describe('only the pinned hidden checker grades', () => {
  it('a PASS from any other checker is NOT_RUN', () => {
    const judged = 'b'.repeat(64);
    const checker = { reason: 'none', taskId: 'task:build-1', judgedTrimmedSha256: judged, gameDigest: judged.slice(0, 12), checkerSha256: 'c'.repeat(64) };
    expect(acceptJuliusMissionEvidence(WLJ, { ...(readerOutput() as Record<string, unknown>), checkerVerdict: 'PASS', checker }).completion?.checkerVerdict).toBe('NOT_RUN');
  });
});
