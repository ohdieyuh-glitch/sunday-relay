import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { flattenDiagnostics, JULIUS_CONTEXT_COMPILER_VERSION, safeReviewDiagnostics, type JuliusContextSnapshot } from '../../src/relay/mission/julius';
import { loadHermesConfig, type HermesConfig, type HermesOutcome, type ReviewPacket } from '../hermes-reviewer';
import { reviewerOperativeTimeoutMs } from '../reviewer-deadline';
import { createInMemoryArtifactExchange, createLiveHermesReviewerAdapter } from './live-workers';
import { boundEvidenceText, boundReviewEvidence, REVIEW_EVIDENCE_LIMITS } from './review-evidence-bound';

/**
 * THE REVIEWER'S EVIDENCE IS BOUNDED, AND THE BOUND IS NEVER SILENT.
 *
 * The pure function first (identity under the limit, a visible marker over it, a cut on a line and never inside a
 * surrogate pair), then the REAL reviewer adapter with the runner injected: a small implementation packet reaches the
 * runner byte-for-byte as before, an oversized one arrives bounded with the marker while the digest and the changed-file
 * list still name the whole artifact. No process, no provider, no spend.
 */

const lines = (count: number, width = 60): string => Array.from({ length: count }, (_, i) => `line ${String(i).padStart(5, '0')} ${'x'.repeat(width)}`).join('\n') + '\n';

describe('boundEvidenceText', () => {
  it('returns the SAME string at and under the limit (identity, not equality of content only)', () => {
    for (const keep of ['head', 'tail'] as const) {
      const exactly = 'a'.repeat(100);
      expect(boundEvidenceText(exactly, 100, keep, 'DIFF').text).toBe(exactly);
      expect(boundEvidenceText(exactly, 100, keep, 'DIFF').omittedChars).toBe(0);
      expect(boundEvidenceText('', 100, keep, 'DIFF')).toEqual({ text: '', omittedChars: 0 });
      expect(boundEvidenceText('short', 100, keep, 'DIFF').text).toBe('short');
    }
  });

  it('one character over the limit is bounded and says so', () => {
    const over = 'a'.repeat(101);
    const bounded = boundEvidenceText(over, 100, 'head', 'DIFF');
    expect(bounded.omittedChars).toBeGreaterThan(0);
    expect(bounded.text).toContain('[DIFF TRUNCATED: the first');
    expect(bounded.text).toContain('of 101 characters are shown');
    expect(bounded.text).toContain('State in your review whether what you could not see prevents a verdict.');
  });

  it('the diff keeps its head on a line boundary; the test output keeps its tail on a line boundary', () => {
    const text = lines(2_000);
    const head = boundEvidenceText(text, 10_000, 'head', 'DIFF');
    const body = head.text.slice(0, head.text.indexOf('[DIFF TRUNCATED'));
    expect(body.startsWith('line 00000 ')).toBe(true);
    expect(body.endsWith('\n')).toBe(true);
    expect(body.split('\n').filter((line) => line !== '').every((line) => /^line \d{5} x{60}$/u.test(line)), 'no half line').toBe(true);
    const tail = boundEvidenceText(text, 10_000, 'tail', 'TEST OUTPUT');
    const rest = tail.text.slice(tail.text.indexOf('\n') + 1);
    expect(tail.text.startsWith('[TEST OUTPUT TRUNCATED: the last')).toBe(true);
    expect(rest.endsWith('line 01999 ' + 'x'.repeat(60) + '\n')).toBe(true);
    expect(rest.split('\n').filter((line) => line !== '').every((line) => /^line \d{5} x{60}$/u.test(line)), 'no half line').toBe(true);
  });

  it('accounts exactly: shown + omitted = total, and the marker states the same numbers', () => {
    const text = lines(1_500);
    for (const keep of ['head', 'tail'] as const) {
      const bounded = boundEvidenceText(text, 7_777, keep, 'DIFF');
      const shown = Number(/the (?:first|last) (\d+) of (\d+) characters are shown, (\d+) omitted/u.exec(bounded.text)![1]);
      const total = Number(/of (\d+) characters/u.exec(bounded.text)![1]);
      expect(total).toBe(text.length);
      expect(shown + bounded.omittedChars).toBe(text.length);
    }
  });

  it('never cuts inside a surrogate pair, from either end, with no newline to land on', () => {
    const emoji = '\u{1F600}'; // two UTF-16 code units
    const text = emoji.repeat(500);
    for (const keep of ['head', 'tail'] as const) {
      for (const limit of [99, 100, 101, 250, 251]) {
        const bounded = boundEvidenceText(text, limit, keep, 'DIFF');
        const stripped = bounded.text.replace(/\[DIFF TRUNCATED[^\]]*\]\n?/u, '').replace(/\n$/u, '');
        // a well-formed string re-encodes to itself; a lone surrogate would come back as U+FFFD
        expect(Buffer.from(stripped, 'utf8').toString('utf8'), `${keep} ${limit}`).toBe(stripped);
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(stripped), `${keep} ${limit}: lone surrogate`).toBe(false);
      }
    }
  });

  it('refuses a limit that is not a positive safe integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => boundEvidenceText('x', bad, 'head', 'DIFF')).toThrow('review_evidence_limit_invalid');
    }
  });

  it('the bounded value is at most the limit plus one short marker', () => {
    const text = lines(20_000);
    for (const keep of ['head', 'tail'] as const) {
      expect(boundEvidenceText(text, 5_000, keep, 'DIFF').text.length).toBeLessThan(5_000 + 300);
    }
  });
});

describe('boundReviewEvidence', () => {
  it('leaves a packet that fits exactly as it was', () => {
    const diff = lines(300);
    const out = lines(50);
    expect(diff.length).toBeLessThan(REVIEW_EVIDENCE_LIMITS.diffChars);
    expect(boundReviewEvidence({ unifiedDiff: diff, testOutput: out })).toEqual({ unifiedDiff: diff, testOutput: out, omitted: { diff: 0, testOutput: 0 } });
  });

  it('the diff keeps its HEAD and the test output keeps its TAIL, each from its own end', () => {
    const diff = `FIRST-DIFF-LINE${'\n'}${lines(3_000)}LAST-DIFF-LINE${'\n'}`;
    const output = `FIRST-OUTPUT-LINE${'\n'}${lines(1_000)}LAST-OUTPUT-LINE${'\n'}`;
    const bounded = boundReviewEvidence({ unifiedDiff: diff, testOutput: output });
    expect(bounded.unifiedDiff).toContain('FIRST-DIFF-LINE');
    expect(bounded.unifiedDiff).not.toContain('LAST-DIFF-LINE');
    expect(bounded.unifiedDiff).toContain('the first ');
    expect(bounded.testOutput).toContain('LAST-OUTPUT-LINE');
    expect(bounded.testOutput).not.toContain('FIRST-OUTPUT-LINE');
    expect(bounded.testOutput).toContain('the last ');
  });

  it('bounds each field by its own limit and reports what each lost', () => {
    const bounded = boundReviewEvidence({ unifiedDiff: lines(3_000), testOutput: lines(1_000) });
    expect(bounded.omitted.diff).toBeGreaterThan(0);
    expect(bounded.omitted.testOutput).toBeGreaterThan(0);
    expect(bounded.unifiedDiff).toContain('[DIFF TRUNCATED');
    expect(bounded.testOutput).toContain('[TEST OUTPUT TRUNCATED');
  });
});

/* ------------------------------------------------------------ through the real adapter */

const worker = {
  workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER' as const,
  adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
  taskTypes: ['review:build'], concurrencyLimit: 1, timeoutMs: reviewerOperativeTimeoutMs(), maxRetries: 1,
  status: 'AVAILABLE' as const,
};
const PLAN = JSON.stringify({
  objectiveSummary: 'Change the fixture.', assumptions: [], unresolvedQuestions: [], requirements: [], architectureDecisions: [],
  implementationSteps: [{ id: 'S1', description: 'Edit the fixture' }], risks: [], acceptanceCriteria: ['AC-1'], testPlan: ['npm test'],
  prohibitedActions: [], proposedContractAmendments: [], contextRefs: [],
  handoff: { objective: 'Change.', boundedTask: 'Edit.', acceptanceCriteria: ['AC-1'], requiredTests: ['npm test'], allowedFileScope: ['src/'], prohibitedActions: [], grantedTools: [], expectedEvidence: ['TEST'] },
});
const snapshot = (taskId: string): JuliusContextSnapshot => ({
  contextId: 'ctx-1', runId: 'run-live', taskId, workerId: worker.workerId, workerRole: 'INDEPENDENT_REVIEWER',
  compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 0,
  taskContractRevision: 1, taskContractDigest: 'sha256:contract', sourceEntryIds: [], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
  acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:content', integrityVersion: null, integrityConflicts: null,
  integrityExcludedEntryIds: null, integrityEvictedEntryIds: null, characterCount: 24, redactionCount: 0, truncated: false,
  packet: { missionId: 'mission-live-1', taskId, workerId: worker.workerId, sourceEntryIds: [], blocks: [{ kind: 'CONSTRAINT', text: 'OBJECTIVE: bound test' }], truncated: false },
});
const APPROVED = {
  kind: 'reviewed',
  result: { verdict: 'approved', summary: 'Fine.', findings: [], requirementsChecked: [], parseRepaired: false },
  startedAt: '2026-10-18T12:00:00.000Z', completedAt: '2026-10-18T12:00:01.000Z', requestedModel: 'grok-build-0.1', servedModel: 'grok-build-0.1', provider: 'xai',
} as unknown as HermesOutcome;

async function packetFor(diff: string, testOutput: string): Promise<ReviewPacket> {
  const artifacts = createInMemoryArtifactExchange();
  const at = (kind: 'PLAN' | 'DIFF' | 'TEST_OUTPUT' | 'BASE_REVISION', taskId: string, role: 'PROMPT_ARCHITECT' | 'CODING_AGENT') =>
    ({ kind, runId: 'run-live', taskId, leaseGeneration: 1, role });
  artifacts.seed(at('PLAN', 'plan-1', 'PROMPT_ARCHITECT'), PLAN);
  artifacts.seed(at('DIFF', 'build-1', 'CODING_AGENT'), diff);
  artifacts.seed(at('TEST_OUTPUT', 'build-1', 'CODING_AGENT'), testOutput);
  artifacts.seed(at('BASE_REVISION', 'build-1', 'CODING_AGENT'), 'abc123');
  const seen: ReviewPacket[] = [];
  const adapter = createLiveHermesReviewerAdapter({
    worker, contexts: { snapshotFor: () => snapshot('build-1:review') }, artifacts,
    config: loadHermesConfig({ RELAY_HERMES_PROVIDER: 'xai', RELAY_HERMES_MODEL: 'grok-build-0.1' } as never),
    testCommand: 'npm test',
    run: (async (input: { packet: ReviewPacket; config: HermesConfig }) => { seen.push(input.packet); return APPROVED; }) as never,
  });
  await adapter.dispatch({
    taskId: 'build-1:review', attempt: { leaseGeneration: 1 },
    reads: { subject: { taskId: 'build-1', leaseGeneration: 1 }, plan: { taskId: 'plan-1', leaseGeneration: 1 } },
    contextId: 'ctx-1', taskType: 'review:build',
    allocation: { usdMicros: 300_000, basis: 'ESTIMATE', policyVersion: 'julius-allocation.v1' },
  } as never);
  expect(seen, 'the reviewer was asked once').toHaveLength(1);
  return seen[0];
}

const fileDiff = (path: string, body: string): string => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,1 @@\n${body}`;

describe('the real reviewer adapter', () => {
  it('a packet that fits reaches the reviewer byte-for-byte as it always did', async () => {
    const diff = fileDiff('src/a.ts', lines(200));
    const output = lines(40);
    const packet = await packetFor(diff, output);
    expect(packet.unifiedDiff).toBe(diff);
    expect(packet.testOutput).toBe(output);
    expect(packet.changedFiles).toEqual(['src/a.ts']);
  });

  it('an oversized diff and test output arrive bounded and marked, while the digest and the file list name the whole artifact', async () => {
    const big = fileDiff('src/a.ts', lines(3_000)) + fileDiff('src/b.ts', lines(10)) + fileDiff('src/c.ts', lines(10));
    expect(big.length).toBeGreaterThan(REVIEW_EVIDENCE_LIMITS.diffChars);
    const small = fileDiff('src/a.ts', lines(10));
    const smallPacket = await packetFor(small, 'ok\n');
    const bigPacket = await packetFor(big, lines(1_000));
    expect(bigPacket.unifiedDiff.length).toBeLessThan(REVIEW_EVIDENCE_LIMITS.diffChars + 300);
    expect(bigPacket.unifiedDiff).toContain('[DIFF TRUNCATED');
    expect(bigPacket.testOutput).toContain('[TEST OUTPUT TRUNCATED');
    // every changed file is still named, including the two whose hunks were cut off, so the reviewer knows what it cannot see
    expect(bigPacket.changedFiles).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    // the digest is of the whole artifact, not of what was shown: it differs between a small and a big diff and does not depend on the bound
    expect(bigPacket.artifactDigest).not.toBe(smallPacket.artifactDigest);
    expect(bigPacket.artifactDigest.replace(/^sha256:/u, ''), 'the digest is of the WHOLE diff the coder produced, not of what the reviewer was shown')
      .toBe(createHash('sha256').update(big).digest('hex'));
    expect(smallPacket.artifactDigest.replace(/^sha256:/u, '')).toBe(createHash('sha256').update(small).digest('hex'));
  });
});

/* ------------------------------------------------------------------- B1: a bounded review leaves FACTS in the record, and only then */

/** Dispatch a build review whose runner answers `outcome`, and keep what the adapter returned or threw. */
async function reviewWith(diff: string, testOutput: string, outcome: HermesOutcome): Promise<{ result: Record<string, unknown> | null; failure: { diagnostics?: Record<string, unknown> } | null }> {
  const artifacts = createInMemoryArtifactExchange();
  const at = (kind: 'PLAN' | 'DIFF' | 'TEST_OUTPUT' | 'BASE_REVISION', taskId: string, role: 'PROMPT_ARCHITECT' | 'CODING_AGENT') =>
    ({ kind, runId: 'run-live', taskId, leaseGeneration: 1, role });
  artifacts.seed(at('PLAN', 'plan-1', 'PROMPT_ARCHITECT'), PLAN);
  artifacts.seed(at('DIFF', 'build-1', 'CODING_AGENT'), diff);
  artifacts.seed(at('TEST_OUTPUT', 'build-1', 'CODING_AGENT'), testOutput);
  artifacts.seed(at('BASE_REVISION', 'build-1', 'CODING_AGENT'), 'abc123');
  const adapter = createLiveHermesReviewerAdapter({
    worker, contexts: { snapshotFor: () => snapshot('build-1:review') }, artifacts,
    config: loadHermesConfig({ RELAY_HERMES_PROVIDER: 'xai', RELAY_HERMES_MODEL: 'grok-build-0.1' } as never),
    testCommand: 'npm test',
    run: (async () => outcome) as never,
  });
  const dispatch = {
    taskId: 'build-1:review', attempt: { leaseGeneration: 1 },
    reads: { subject: { taskId: 'build-1', leaseGeneration: 1 }, plan: { taskId: 'plan-1', leaseGeneration: 1 } },
    contextId: 'ctx-1', taskType: 'review:build',
    allocation: { usdMicros: 300_000, basis: 'ESTIMATE', policyVersion: 'julius-allocation.v1' },
  } as never;
  try {
    return { result: (await adapter.dispatch(dispatch)) as unknown as Record<string, unknown>, failure: null };
  } catch (error) {
    return { result: null, failure: error as { diagnostics?: Record<string, unknown> } };
  }
}

const INCOMPLETE = {
  kind: 'review_incomplete', safeMessage: 'the review process exited', shape: 'review_process_exit',
  startedAt: '2026-10-18T12:00:00.000Z', completedAt: '2026-10-18T12:00:01.000Z',
} as unknown as HermesOutcome;

describe('B1: what was left out of the reviewer\'s evidence is a FACT in the record, absent when nothing was left out', () => {
  const OMITTED_KEYS = ['reviewEvidencePatchOmitted', 'reviewEvidenceTestOutputOmitted'];
  const big = fileDiff('src/a.ts', lines(3_000));
  const noisy = lines(1_000);

  it('a bounded review records both omitted counts on the success path, equal to what boundReviewEvidence says it cut', async () => {
    const cut = boundReviewEvidence({ unifiedDiff: big, testOutput: noisy }).omitted;
    expect(cut.diff).toBeGreaterThan(0);
    expect(cut.testOutput).toBeGreaterThan(0);
    const { result } = await reviewWith(big, noisy, APPROVED);
    const diagnostics = result?.diagnostics as Record<string, unknown>;
    expect(diagnostics.reviewEvidencePatchOmitted).toBe(cut.diff);
    expect(diagnostics.reviewEvidenceTestOutputOmitted).toBe(cut.testOutput);
  });

  it('only the field that was bounded is recorded: a big diff with a short test output names the diff alone', async () => {
    const { result } = await reviewWith(big, 'ok' + String.fromCharCode(10), APPROVED);
    const diagnostics = result?.diagnostics as Record<string, unknown>;
    expect(diagnostics.reviewEvidencePatchOmitted).toBeGreaterThan(0);
    expect('reviewEvidenceTestOutputOmitted' in diagnostics).toBe(false);
  });

  it('ABSENT IS TODAY: a review that saw everything leaves neither key, on success or on failure', async () => {
    const small = fileDiff('src/a.ts', lines(10));
    const ok = await reviewWith(small, 'ok' + String.fromCharCode(10), APPROVED);
    const okDiagnostics = ok.result?.diagnostics as Record<string, unknown>;
    for (const key of OMITTED_KEYS) expect(key in okDiagnostics, key).toBe(false);
    const failed = await reviewWith(small, 'ok' + String.fromCharCode(10), INCOMPLETE);
    expect(failed.failure, 'the incomplete review really failed the dispatch').not.toBeNull();
    for (const key of OMITTED_KEYS) expect(key in (failed.failure?.diagnostics ?? {}), key).toBe(false);
  });

  it('a bounded review that then FAILS still leaves the fact: the partial diff is on the record of the failed attempt too', async () => {
    const cut = boundReviewEvidence({ unifiedDiff: big, testOutput: noisy }).omitted;
    const { failure } = await reviewWith(big, noisy, INCOMPLETE);
    expect(failure).not.toBeNull();
    expect(failure?.diagnostics?.reviewEvidencePatchOmitted).toBe(cut.diff);
    expect(failure?.diagnostics?.reviewEvidenceTestOutputOmitted).toBe(cut.testOutput);
  });

  it('the kernel allowlist keeps a positive count, drops anything else, and adds no key when none is reported', () => {
    const plain = safeReviewDiagnostics({ stage: 'build' }) as Record<string, unknown>;
    for (const key of OMITTED_KEYS) expect(key in plain, key).toBe(false);
    const kept = safeReviewDiagnostics({ stage: 'build', reviewEvidencePatchOmitted: 12_345, reviewEvidenceTestOutputOmitted: 7 }) as Record<string, unknown>;
    expect(kept.reviewEvidencePatchOmitted).toBe(12_345);
    expect(kept.reviewEvidenceTestOutputOmitted).toBe(7);
    for (const bad of [0, -1, 1.5, '5', null, Number.NaN, Number.POSITIVE_INFINITY, {}, true]) {
      const dropped = safeReviewDiagnostics({ stage: 'build', reviewEvidencePatchOmitted: bad, reviewEvidenceTestOutputOmitted: bad }) as Record<string, unknown>;
      for (const key of OMITTED_KEYS) expect(key in dropped, `${key}=${String(bad)}`).toBe(false);
    }
    // the only difference a reported count makes to the object is its own two keys
    expect(Object.keys(kept).filter((key) => !(key in plain)).sort()).toEqual([...OMITTED_KEYS].sort());
  });

  it('on the durable event the keys are diag_-prefixed, which is exactly what the evidence dump columns read', () => {
    const flat = flattenDiagnostics(safeReviewDiagnostics({ stage: 'build', reviewEvidencePatchOmitted: 9 }));
    expect(flat.diag_reviewEvidencePatchOmitted).toBe(9);
    expect('diag_reviewEvidenceTestOutputOmitted' in flat).toBe(false);
    const dump = readFileSync(join(__dirname, '..', '..', '.github', 'julius-live-evidence-dump.sh'), 'utf8');
    const line = dump.split(String.fromCharCode(10)).find((l) => l.includes('AS served_model_usage_key')) ?? '';
    expect(line).toContain("e.payload->'facts'->>'diag_reviewEvidencePatchOmitted' AS review_evidence_patch_omitted");
    expect(line).toContain("e.payload->'facts'->>'diag_reviewEvidenceTestOutputOmitted' AS review_evidence_test_output_omitted");
    // appended after the last column the frozen checker's needed list could ever name before them; the two effort columns (effort-evidence.test.ts) follow them
    expect(line.indexOf('AS result_model_third_output_tokens')).toBeLessThan(line.indexOf('AS review_evidence_patch_omitted'));
    expect(line).toMatch(/AS review_evidence_test_output_omitted,e\.payload->'facts'->>'diag_effortSent' AS effort_sent,e\.payload->'facts'->>'diag_effortEchoed' AS effort_echoed FROM relay_wonderland\.events e/u);
  });
});
