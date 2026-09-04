import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import {
  classifyUnreadableReview, extractReviewJson, reviewStructureFacts, runHermesReview, validateHermesReview,
  type HermesConfig, type HermesOutcome, type HermesReviewShape, type ReviewPacket,
} from './hermes-reviewer';
import { safeReviewDiagnostics } from '../src/relay/mission/julius';

/**
 * PAID ATTEMPT #2 SAID "UNREADABLE" TWICE AND NOTHING ELSE.
 *
 * Run 33802017460 paid for a Prompt Architect, a Coding Agent and three real
 * executor invocations, and then both reviewer tasks failed with the single
 * durable word `reviewer_review_incomplete`. The safe message that would have
 * separated a dead credential from a model writing prose was composed and then
 * dropped — the coordinator persists the code, the retryable flag and the
 * failure CLASS, not the message — so the one artifact built to explain a paid
 * failure could not say which of a dozen things had happened.
 *
 * Every case here drives the REAL local runner through a fake process. No
 * Hermes, no provider, no network: `spawnImpl` hands back a child this test
 * writes the stdout of. What is being proven is that each distinguishable
 * failure reaches a DIFFERENT durable shape, and that no invalid review ever
 * becomes a verdict.
 */

/** A child process this test drives: stdout text, exit code, and timing. */
function fakeChild(input: {
  readonly stdout?: string;
  /** Several writes, so a retained prefix can overflow on a later chunk. */
  readonly stdoutChunks?: readonly string[];
  readonly code?: number;
  readonly closeAfterMs?: number;
  readonly neverCloses?: boolean;
}) {
  return () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: Readable; stderr: Readable; kill: (signal?: string) => boolean;
    };
    child.stdout = new Readable({ read() { /* pushed below */ } });
    child.stderr = new Readable({ read() { /* never surfaced */ } });
    child.kill = () => true;
    setTimeout(() => {
      for (const chunk of input.stdoutChunks ?? (input.stdout !== undefined && input.stdout !== '' ? [input.stdout] : [])) {
        child.stdout.push(Buffer.from(chunk, 'utf8'));
      }
      child.stdout.push(null);
      child.stderr.push(null);
      if (input.neverCloses !== true) child.emit('close', input.code ?? 0);
    }, input.closeAfterMs ?? 0);
    return child as never;
  };
}

const CONFIG = (over: Partial<HermesConfig> = {}): HermesConfig => ({
  executable: '/nonexistent/hermes', model: 'grok-build-0.1', provider: 'xai',
  timeoutMs: 5_000, maxOutputBytes: 512 * 1024, ...over,
});

const PACKET: ReviewPacket = {
  missionId: 'mission:shape', baseRevision: 'base', artifactDigest: 'digest',
  originalRequest: 'do the thing', handoffJson: '{}', changedFiles: ['a.ts'],
  unifiedDiff: 'diff', changedFileContents: 'content', testCommand: 'npm test',
  testOutput: 'ok', relayEvidence: [],
};

const review = async (over: Parameters<typeof fakeChild>[0], cfg: Partial<HermesConfig> = {}): Promise<HermesOutcome> =>
  runHermesReview({ packet: PACKET, config: CONFIG(cfg), spawnImpl: fakeChild(over) });

const shapeOf = async (over: Parameters<typeof fakeChild>[0], cfg: Partial<HermesConfig> = {}): Promise<HermesReviewShape> => {
  const outcome = await review(over, cfg);
  if (outcome.kind !== 'review_incomplete') throw new Error(`expected review_incomplete, got ${outcome.kind}`);
  return outcome.shape;
};

const APPROVED = JSON.stringify({
  verdict: 'approved', summary: 'Meets every criterion.', findings: [],
  requirementsChecked: [{ requirement: 'r1', status: 'passed', evidence: 'tests pass' }],
});
const CHANGES = JSON.stringify({
  verdict: 'changes_required', summary: 'A criterion is unmet.',
  findings: [{ findingId: 'F-1', severity: 'blocking', requirement: 'r1', explanation: 'missing', evidence: 'none' }],
  requirementsChecked: [{ requirement: 'r1', status: 'failed', evidence: 'absent' }],
});

describe('the local reviewer names which failure it was', () => {
  /* --------------------------------------------------------- valid reviews */
  it('1. valid approved JSON still reviews, and the verdict is unchanged', async () => {
    const outcome = await review({ stdout: APPROVED });
    expect(outcome.kind).toBe('reviewed');
    if (outcome.kind !== 'reviewed') throw new Error('unreachable');
    expect(outcome.result.verdict).toBe('approved');
    expect(outcome.result.requirementsChecked[0]?.status).toBe('passed');
  });

  it('2. valid changes_required JSON keeps its blocking finding', async () => {
    const outcome = await review({ stdout: CHANGES });
    expect(outcome.kind).toBe('reviewed');
    if (outcome.kind !== 'reviewed') throw new Error('unreachable');
    expect(outcome.result.verdict).toBe('changes_required');
    expect(outcome.result.findings[0]?.severity).toBe('blocking');
  });

  it('3. fenced JSON reviews, and so does JSON with prose on both sides', async () => {
    const fenced = await review({ stdout: `Here is my review:\n\`\`\`json\n${APPROVED}\n\`\`\`\nHope that helps.` });
    expect(fenced.kind).toBe('reviewed');
    // A brace in the prose used to make the extractor span from that brace to
    // the last one in the text, producing a slice that parsed as nothing.
    const braced = await review({ stdout: `I checked {all} the criteria.\n${APPROVED}\nDone {ok}.` });
    expect(braced.kind, 'a stray brace in prose is not the review').toBe('reviewed');
  });

  it('4. JSON whose evidence quotes a regex backslash is repaired, not rejected', async () => {
    const withRegex = '{"verdict":"approved","summary":"ok","findings":[],'
      + '"requirementsChecked":[{"requirement":"r","status":"passed","evidence":"matched [\\s_]+ twice"}]}';
    expect(() => JSON.parse(withRegex), 'genuinely invalid JSON, so the case proves something').toThrow();
    const outcome = await review({ stdout: withRegex });
    expect(outcome.kind).toBe('reviewed');
    if (outcome.kind !== 'reviewed') throw new Error('unreachable');
    expect(outcome.result.parseRepaired, 'and the repair is recorded as evidence').toBe(true);
  });

  /* ------------------------------------------------------- invalid reviews */
  it('5. prose only is json_absent', async () => {
    expect(await shapeOf({ stdout: 'The change looks fine to me overall.' })).toBe('review_json_absent');
  });

  it('6. truncated JSON is unparseable, not absent', async () => {
    expect(await shapeOf({ stdout: '{"verdict":"approved","summary":"it is g' })).toBe('review_json_unparseable');
  });

  it('7. malformed JSON is unparseable', async () => {
    expect(await shapeOf({ stdout: '{"verdict":,,,"summary":}' })).toBe('review_json_unparseable');
  });

  it('8. a verdict outside the vocabulary is verdict_invalid, never an approval', async () => {
    for (const word of ['approve', 'PASS', 'lgtm', 'rejected']) {
      const stdout = JSON.stringify({ verdict: word, summary: 'ok', findings: [] });
      expect(await shapeOf({ stdout }), `"${word}" must not be read as a verdict`).toBe('review_verdict_invalid');
      expect(validateHermesReview(stdout), 'and the validator refuses it outright').toBeNull();
    }
  });

  it('9. a missing verdict is verdict_missing', async () => {
    expect(await shapeOf({ stdout: JSON.stringify({ summary: 'ok', findings: [] }) })).toBe('review_verdict_missing');
  });

  it('10. a missing or blank summary is distinguished from a missing verdict', async () => {
    expect(await shapeOf({ stdout: JSON.stringify({ verdict: 'approved', findings: [] }) }))
      .toBe('review_summary_missing');
    expect(await shapeOf({ stdout: JSON.stringify({ verdict: 'approved', summary: '   ', findings: [] }) }))
      .toBe('review_summary_invalid');
  });

  it('11. a nonzero exit is process_exit, whatever the text looked like', async () => {
    expect(await shapeOf({ stdout: 'crashed', code: 3 })).toBe('review_process_exit');
    // Even an empty stdout: the process is the fact, not the shape.
    expect(await shapeOf({ stdout: '', code: 1 })).toBe('review_process_exit');
  });

  it('12. a reviewer that never answers is a timeout', async () => {
    expect(await shapeOf({ neverCloses: true }, { timeoutMs: 40 })).toBe('review_timeout');
  });

  it('13. an authentication-shaped upstream failure is named as one', async () => {
    expect(await shapeOf({ stdout: 'HTTP 401: invalid api-key for provider xai' }))
      .toBe('review_authentication_failed');
  });

  it('13b. a reviewer QUOTING an HTTP 401 keeps its own verdict, and is not called an auth failure', async () => {
    // The upstream classifier matches an HTTP line anywhere in the text. A code
    // reviewer quoting one — this repository's fixtures contain such a line —
    // must not have its review recorded as a dead credential.
    const quoting = 'The diff logs "HTTP 401: invalid api-key" on failure, which is fine.\n'
      + '{"verdict":"changes_required","summary":"Handle the 401 branch."}';
    const outcome = await review({ stdout: quoting });
    expect(outcome.kind, 'the reviewer stated a verdict, so it reviewed').toBe('reviewed');
    if (outcome.kind !== 'reviewed') throw new Error('unreachable');
    expect(outcome.result.verdict).toBe('changes_required');
    // And the provider's own rejection — which is itself JSON — is still auth.
    expect(await shapeOf({ stdout: 'HTTP 400: {"code":"invalid-argument","error":"Incorrect API key provided."}' }))
      .toBe('review_authentication_failed');
  });

  it('14. any other upstream HTTP failure is named as one', async () => {
    expect(await shapeOf({ stdout: 'HTTP 503: upstream unavailable' })).toBe('review_provider_http_error');
  });

  it('15b. a later chunk overflowing is still named, with a prefix already retained', async () => {
    // The single-chunk case drops everything; this one keeps a prefix and then
    // overflows, which is the shape a real stream takes.
    const shape = await shapeOf(
      { stdoutChunks: ['{"verdict":"approved","summary":"', 'x'.repeat(400), '"}'] },
      { maxOutputBytes: 40 },
    );
    expect(shape).toBe('review_output_too_large');
  });

  it('15. output beyond the ceiling is named, not parsed as partial text', async () => {
    // The overflowing chunk used to be dropped and what arrived parsed anyway,
    // so OUR ceiling was reported as the model's malformed JSON.
    const huge = `{"verdict":"approved","summary":"${'x'.repeat(400)}","findings":[]}`;
    expect(await shapeOf({ stdout: huge }, { maxOutputBytes: 64 })).toBe('review_output_too_large');
  });

  it('15c. a COMPLETE review followed by overflow is refused, not approved', async () => {
    /**
     * The prefix parses perfectly — and a reviewer's later word is the one that
     * counts. Accepting this reads an approval out of a stream whose remainder
     * this process never saw, and a second verdict past the ceiling is exactly
     * what `extractReviewJson` refuses when it CAN see it. Truncation must not
     * be the way that guard is bypassed.
     */
    const complete = JSON.stringify({ verdict: 'approved', summary: 'Looks good.', findings: [] });
    const outcome = await review(
      { stdoutChunks: [complete, ' ...and on reflection: ', JSON.stringify({ verdict: 'changes_required', summary: 'AC-1 unmet' })] },
      { maxOutputBytes: complete.length + 4 },
    );
    expect(outcome.kind, 'a partial stream is not a verdict').toBe('review_incomplete');
    if (outcome.kind === 'review_incomplete') expect(outcome.shape).toBe('review_output_too_large');
  });

  /* -------------------------------------------------------------- the rule */
  it('NO invalid review ever becomes a verdict', async () => {
    const invalid = [
      'prose only', '{"verdict":"approved","summary":"cut', '{"verdict":,,,}',
      JSON.stringify({ verdict: 'approve', summary: 'ok' }),
      JSON.stringify({ summary: 'ok' }),
      JSON.stringify({ verdict: 'approved' }),
      'HTTP 401: invalid api-key',
    ];
    for (const stdout of invalid) {
      const outcome = await review({ stdout });
      expect(outcome.kind, `"${stdout.slice(0, 24)}" must not review`).toBe('review_incomplete');
      expect(validateHermesReview(stdout)).toBeNull();
    }
  });

  it('every shape a failure can take is distinct, so two causes never share a word', async () => {
    const seen = new Set<HermesReviewShape>([
      await shapeOf({ stdout: 'prose' }),
      await shapeOf({ stdout: '{"a": ' }),
      await shapeOf({ stdout: JSON.stringify({ verdict: 'nope', summary: 'x' }) }),
      await shapeOf({ stdout: JSON.stringify({ summary: 'x' }) }),
      await shapeOf({ stdout: JSON.stringify({ verdict: 'approved' }) }),
      await shapeOf({ stdout: 'HTTP 401: bad api-key' }),
      await shapeOf({ stdout: 'HTTP 500: boom' }),
      await shapeOf({ stdout: 'x', code: 9 }),
      await shapeOf({ neverCloses: true }, { timeoutMs: 40 }),
    ]);
    expect(seen.size, 'nine causes, nine words').toBe(9);
  });
});

/**
 * THE FACTS BESIDE THE SHAPE.
 *
 * The shape says which boundary broke; these say enough to debug that boundary
 * without buying a second paid run. `review_process_exit` without the exit
 * code and `review_output_too_large` without the byte count were each a class
 * an operator could only investigate by paying again.
 */
describe('an incomplete review carries the safe facts that explain its shape', () => {
  const diagnosticsOf = async (over: Parameters<typeof fakeChild>[0], cfg: Partial<HermesConfig> = {}) => {
    const outcome = await review(over, cfg);
    if (outcome.kind !== 'review_incomplete') throw new Error(`expected review_incomplete, got ${outcome.kind}`);
    return outcome.diagnostics;
  };

  it('a nonzero exit reports the code the process actually returned', async () => {
    expect((await diagnosticsOf({ stdout: 'crashed', code: 1 })).processExitCode).toBe(1);
    // 137 is SIGKILL through a container — the OOM signature, and the single
    // most useful number this record can carry for a reviewer that vanished.
    const killed = await diagnosticsOf({ stdout: '', code: 137 });
    expect(killed.processExitCode).toBe(137);
    expect(killed.failureShape).toBe('review_process_exit');
    expect(killed.timedOut).toBe(false);
  });

  it('a timeout has no exit code, because the process did not exit', async () => {
    const timedOut = await diagnosticsOf({ neverCloses: true }, { timeoutMs: 40 });
    expect(timedOut.failureShape).toBe('review_timeout');
    expect(timedOut.timedOut).toBe(true);
    // null, never 0 — `0` would say it exited cleanly.
    expect(timedOut.processExitCode).toBeNull();
  });

  it('overflow reports the bytes seen and the ceiling they passed', async () => {
    const huge = `{"verdict":"approved","summary":"${'x'.repeat(400)}","findings":[]}`;
    const over = await diagnosticsOf({ stdout: huge }, { maxOutputBytes: 64 });
    expect(over.failureShape).toBe('review_output_too_large');
    expect(over.outputTruncated).toBe(true);
    expect(over.outputByteLimit).toBe(64);
    // THE TOTAL SEEN, not the ceiling read back as the size. Every chunk is
    // counted even though the overflowing ones are not kept.
    expect(over.outputBytesObserved).toBe(huge.length);
    expect(over.outputBytesObserved!).toBeGreaterThan(over.outputByteLimit!);
  });

  it('ambiguity reports how many verdicts made it ambiguous', async () => {
    const two = `${APPROVED}\n${CHANGES}`;
    const d = await diagnosticsOf({ stdout: two });
    expect(d.failureShape).toBe('review_json_ambiguous');
    expect(d.reviewObjectCount, 'two candidates is the whole reason it refused').toBe(2);
    expect(d.verdictPresent, 'no single verdict was selected').toBe(false);
    // And the array form of the same defect is counted too.
    const hidden = `[${CHANGES}]\n${APPROVED}`;
    expect((await diagnosticsOf({ stdout: hidden })).reviewObjectCount).toBe(2);
  });

  it('prose reports that no JSON was there at all', async () => {
    const prose = 'The plan looks fine to me overall.';
    const d = await diagnosticsOf({ stdout: prose });
    expect(d.failureShape).toBe('review_json_absent');
    expect(d.jsonDetected).toBe(false);
    expect(d.jsonParseable).toBe(false);
    expect(d.reviewObjectCount).toBe(0);
    // Derived, not hard-coded: a literal here only records what the assertion
    // happened to be written against.
    expect(d.outputBytesObserved).toBe(Buffer.byteLength(prose, 'utf8'));
    expect(d.outputTruncated).toBe(false);
  });

  it('a bad verdict word reports that JSON parsed and the verdict did not', async () => {
    const d = await diagnosticsOf({ stdout: JSON.stringify({ verdict: 'approve', summary: 'ok' }) });
    expect(d.failureShape).toBe('review_verdict_invalid');
    expect(d.jsonParseable).toBe(true);
    expect(d.verdictPresent).toBe(true);
    expect(d.verdictValid, 'present and outside the vocabulary').toBe(false);
    expect(d.summaryPresent).toBe(true);
  });

  it('a missing summary is distinguished from a missing verdict, in the facts too', async () => {
    const noSummary = await diagnosticsOf({ stdout: JSON.stringify({ verdict: 'approved' }) });
    expect(noSummary.failureShape).toBe('review_summary_missing');
    expect(noSummary.verdictValid).toBe(true);
    expect(noSummary.summaryPresent).toBe(false);

    const noVerdict = await diagnosticsOf({ stdout: JSON.stringify({ summary: 'ok' }) });
    expect(noVerdict.failureShape).toBe('review_verdict_missing');
    expect(noVerdict.verdictPresent).toBe(false);
    expect(noVerdict.summaryPresent).toBe(true);
  });

  it('the transport and the configured provider are named; the served model is not guessed', async () => {
    const d = await diagnosticsOf({ stdout: 'prose' });
    expect(d.transport).toBe('local');
    expect(d.provider, 'configuration, known before the call').toBe('xai');
    // Evidence, and a failed review produced none. Never the requested model
    // wearing the served model's clothes.
    expect(d.servedModel).toBeNull();
  });

  it('a VALID review counts as exactly one candidate, which is what makes two ambiguous', () => {
    // The parser semantics the ambiguity rule rests on, pinned directly:
    // one verdict-bearing object is a review, two is a text whose verdict
    // cannot be known. Read through the exported facts, not inferred.
    const one = reviewStructureFacts(APPROVED);
    expect(one.reviewObjectCount).toBe(1);
    expect(one.jsonParseable).toBe(true);
    expect(one.verdictPresent).toBe(true);
    expect(one.verdictValid).toBe(true);
    expect(one.summaryPresent).toBe(true);
    // `findings` and `requirementsChecked` are inside the review object, so
    // they are never counted as candidates of their own.
    expect(reviewStructureFacts(CHANGES).reviewObjectCount).toBe(1);
    expect(reviewStructureFacts(`${APPROVED}\n${CHANGES}`).reviewObjectCount).toBe(2);
    // And nothing at all is a measured zero, not an absent count.
    expect(reviewStructureFacts('prose').reviewObjectCount).toBe(0);
    expect(reviewStructureFacts(null).reviewObjectCount, 'no text is not a count').toBeNull();
  });

  it('no reviewer text of any kind reaches the record', async () => {
    const SECRET = 'Authorization: Bearer FAKESECRET123456789';
    const d = await diagnosticsOf({ stdout: `${SECRET}\nsk-live-FAKESECRET123456789\n{"verdict":"approve","summary":"${SECRET}"}` });
    const serialized = JSON.stringify(d);
    for (const secret of ['FAKESECRET123456789', 'sk-live', 'Authorization', 'approve']) {
      expect(serialized, `"${secret}" must not reach the diagnostics`).not.toContain(secret);
    }
    // Only counts, flags and tokens this runtime chose.
    expect(d.failureShape).toBe('review_verdict_invalid');
  });
});

/**
 * THE NUMBER BEHIND THE SHAPE.
 *
 * Paid attempt #4 (run 33907599197) reached the reviewer for the first time and
 * recorded `review_authentication_failed` — one shape covering a dead key
 * (401), a key without access to the model (403) and a malformed request whose
 * body merely mentions `api-key` (400). Three different repairs, and the
 * classifier already knew which; it dropped the number.
 */
describe('an upstream failure carries the status the provider returned', () => {
  const statusOf = async (stdout: string) => {
    const outcome = await review({ stdout });
    if (outcome.kind !== 'review_incomplete') throw new Error(`expected review_incomplete, got ${outcome.kind}`);
    return { shape: outcome.shape, status: outcome.diagnostics.providerHttpStatus };
  };

  it('401 is a dead credential, and says 401', async () => {
    expect(await statusOf('HTTP 401: {"error":"invalid api-key"}'))
      .toEqual({ shape: 'review_authentication_failed', status: 401 });
  });

  it('403 is a credential without access, and says 403', async () => {
    // Same shape as 401, different repair: the key works, the model does not.
    expect(await statusOf('HTTP 403: {"error":"model not permitted"}'))
      .toEqual({ shape: 'review_authentication_failed', status: 403 });
  });

  it('a 400 whose body names the credential keeps BOTH its classification and its number', async () => {
    // The existing rule treats an api-key-shaped body as authentication even at
    // 400 — xAI answers this way. The classification is unchanged; the status
    // is what now separates it from a real 401.
    expect(await statusOf('HTTP 400: {"code":"invalid-argument","message":"bad api-key"}'))
      .toEqual({ shape: 'review_authentication_failed', status: 400 });
  });

  it('a rate limit and a server error are upstream errors, with their numbers', async () => {
    expect(await statusOf('HTTP 429: {"error":"slow down"}'))
      .toEqual({ shape: 'review_provider_http_error', status: 429 });
    expect(await statusOf('HTTP 500: {"error":"boom"}'))
      .toEqual({ shape: 'review_provider_http_error', status: 500 });
    expect(await statusOf('HTTP 503: {"error":"unavailable"}'))
      .toEqual({ shape: 'review_provider_http_error', status: 503 });
  });

  it('no status line means null, never a guess and never a zero', async () => {
    // Prose, a malformed review and an unrecognised failure all reach here
    // without an HTTP status. `0` would assert a status nobody read.
    for (const stdout of ['The plan looks fine to me.', '{"verdict":"approve","summary":"x"}', '{"broken']) {
      expect((await statusOf(stdout)).status, stdout.slice(0, 20)).toBeNull();
    }
  });

  it('a number that is not a status cannot arrive dressed as one', async () => {
    // The classifier requires a literal `HTTP <3 digits>:` line, so a byte
    // count or a year in prose is not a status.
    expect((await statusOf('We processed 200 lines in 2026 and it looks fine.')).status).toBeNull();
    /**
     * TWO LAYERS, AND THE DURABLE ONE IS THE DOMAIN'S. The adapter reports what
     * the engine actually printed, so a nonsense `HTTP 999:` line is carried
     * truthfully here rather than quietly rewritten — and `safeHttpStatus`
     * refuses it on the way into the record, which is where it would otherwise
     * become a durable claim about a provider.
     */
    expect((await statusOf('HTTP 999: nonsense')).status, 'reported as read').toBe(999);
    expect(safeReviewDiagnostics({ providerHttpStatus: 999 })!.providerHttpStatus,
      'and refused before it is persisted').toBeNull();
    for (const value of [99, 600, 0, -401, 401.5, '401', null, undefined]) {
      expect(safeReviewDiagnostics({ providerHttpStatus: value })!.providerHttpStatus, String(value)).toBeNull();
    }
    expect(safeReviewDiagnostics({ providerHttpStatus: 401 })!.providerHttpStatus).toBe(401);
  });

  it('and the status never arrives with the body it came from', async () => {
    const SECRET = 'Authorization: Bearer FAKESECRET123456789';
    const outcome = await review({
      stdout: `HTTP 401: {"error":"invalid api-key sk-live-FAKESECRET123456789","header":"${SECRET}","prompt":"the whole review prompt"}`,
    });
    if (outcome.kind !== 'review_incomplete') throw new Error('unreachable');
    expect(outcome.diagnostics.providerHttpStatus).toBe(401);
    const serialized = JSON.stringify(outcome.diagnostics);
    for (const secret of ['FAKESECRET123456789', 'sk-live', 'Authorization', 'Bearer', 'prompt', 'invalid api-key']) {
      expect(serialized, `"${secret}" must not reach the diagnostics`).not.toContain(secret);
    }
  });
});

describe('a hostile review leaks nothing structural inspection does not need', () => {
  const SECRET = 'Authorization: Bearer FAKESECRET123456789';
  const HOSTILE = [
    `I reviewed the diff. The header was ${SECRET} and the key sk-live-FAKESECRET123456789.`,
    '```',
    '- const key = "xai-FAKESECRET123456789";',
    '+ const key = process.env.XAI_API_KEY;',
    '```',
    '{"verdict":"approve","summary":"the diff sets Authorization: Bearer FAKESECRET123456789"}',
  ].join('\n');

  it('the shape token carries no reviewer text at all', async () => {
    const shape = await shapeOf({ stdout: HOSTILE });
    // A word outside the vocabulary — and the token is the whole record.
    expect(shape).toBe('review_verdict_invalid');
    expect(JSON.stringify(shape)).not.toContain('FAKESECRET123456789');
    expect(JSON.stringify(shape)).not.toContain('sk-live');
    expect(JSON.stringify(shape)).not.toContain('xai-');
  });

  it('the safe message describes shape, and quotes only a bare verdict word', async () => {
    const outcome = await review({ stdout: HOSTILE });
    if (outcome.kind !== 'review_incomplete') throw new Error('unreachable');
    for (const secret of ['FAKESECRET123456789', 'sk-live-', 'xai-FAKESECRET', 'process.env.XAI_API_KEY']) {
      expect(outcome.safeMessage, `"${secret}" must not reach the message`).not.toContain(secret);
    }
    // What it MAY say: the structural facts, and the one bare word that is
    // almost always the cause.
    expect(outcome.safeMessage).toContain('verdict="approve"');
    expect(outcome.safeMessage).toContain('json=parsed');
  });

  it('no diff line survives, even when the review is otherwise valid', async () => {
    const valid = JSON.stringify({
      verdict: 'changes_required',
      summary: `remove the hardcoded ${SECRET}`,
      findings: [{ findingId: 'F-1', severity: 'blocking', requirement: 'r', explanation: SECRET, evidence: SECRET }],
    });
    const outcome = await review({ stdout: valid });
    // A VALID review is not a leak path this function controls — the verdict
    // and its findings are the reviewer's product and travel by design. What
    // must never happen is the SHAPE machinery copying them.
    expect(outcome.kind).toBe('reviewed');
    expect(classifyUnreadableReview(valid), 'a readable review has no shape complaint').toBe('review_classifier_disagreement');
    expect(JSON.stringify(classifyUnreadableReview(valid))).not.toContain('FAKESECRET');
  });
});

describe('the extractor finds one object without becoming permissive', () => {
  it('prefers a fenced object over a brace in the surrounding prose', () => {
    const text = `Note {see below}.\n\`\`\`json\n${APPROVED}\n\`\`\``;
    const slice = extractReviewJson(text);
    expect(slice).not.toBeNull();
    expect(JSON.parse(slice!).verdict).toBe('approved');
  });

  it('does not end an object on a brace inside a quoted string', () => {
    const text = '{"verdict":"approved","summary":"the diff added } and { here","findings":[]}';
    expect(validateHermesReview(text)?.summary).toBe('the diff added } and { here');
  });

  /**
   * THE CASE THAT WAS MISSING, AND THE DEFECT IT WOULD HAVE CAUGHT.
   *
   * The first extractor took the first parseable object ANYWHERE, at any depth.
   * A reviewer that quotes a JSON object out of the diff and then states its own
   * verdict below had the QUOTED object read as its verdict — so a review that
   * said `changes_required` was recorded as an approval, and the run completed.
   * Reviewer text of exactly this shape is invited by this repository's own
   * diffs, which carry review fixtures as literals.
   */
  it('refuses a text whose verdict cannot be known, rather than picking one', () => {
    const quotedThenReal = `The diff contained ${APPROVED} which I disagree with.\n`
      + '{"verdict":"changes_required","summary":"AC-1 is unmet."}';
    expect(validateHermesReview(quotedThenReal), 'two verdicts is not a tie to break').toBeNull();
    expect(classifyUnreadableReview(quotedThenReal)).toBe('review_json_ambiguous');
    expect(extractReviewJson(quotedThenReal)).toBeNull();
  });

  it('never descends into an array or into a failed parent to find a verdict', () => {
    // An approval inside a findings list, and an approval nested under a parent
    // that does not parse. Both were selected before; neither is the review.
    const inArray = `[${APPROVED},{"verdict":"changes_required","summary":"no"}]`;
    expect(validateHermesReview(inArray), 'an array of reviews is not a review').toBeNull();
    const nested = `{"outer": broken, "inner": ${APPROVED}}`;
    expect(validateHermesReview(nested), 'a child of an unparseable parent is not the review').toBeNull();
  });

  it('a verdict hidden in an array still makes the text ambiguous, not approved', () => {
    /**
     * THE INVERSE OF THE CRITICAL. Not descending into arrays stopped a
     * findings entry from being read as the review — and then DISCARDING the
     * array became its own way to pick a verdict the reviewer did not give: a
     * real `changes_required` in a list, an `approved` quoted beside it, and
     * exactly one candidate left standing at the top level.
     */
    const hidden = [
      'My findings, as a list:',
      '[{"verdict":"changes_required","summary":"AC-1 is unmet"}]',
      `The diff claimed ${APPROVED} which I dispute.`,
    ].join('\n');
    expect(validateHermesReview(hidden), 'two verdicts is never an approval').toBeNull();
    expect(classifyUnreadableReview(hidden)).toBe('review_json_ambiguous');
    expect(extractReviewJson(hidden)).toBeNull();
  });

  it('the arrays a REAL review carries are untouched, because they are not top level', () => {
    // The guard above must not refuse ordinary reviews: `findings` and
    // `requirementsChecked` live inside the review object, which the scan takes
    // whole and never looks inside. Without this the fix would fail closed on
    // every valid review, which is a worse defect than the one it closes.
    expect(validateHermesReview(APPROVED)?.verdict).toBe('approved');
    expect(validateHermesReview(CHANGES)?.verdict).toBe('changes_required');
    expect(validateHermesReview(`\`\`\`json\n${APPROVED}\n\`\`\``)?.verdict).toBe('approved');
  });

  it('a verdict that exists ONLY inside an array names the missing field, not an approval', () => {
    // Nothing competes with it, so there is no ambiguity to report — but an
    // array is still not the review, and no verdict is manufactured from it.
    expect(validateHermesReview(`{"summary":"see list"}\n[${APPROVED}]`)).toBeNull();
    expect(classifyUnreadableReview(`{"summary":"see list"}\n[${APPROVED}]`))
      .toBe('review_verdict_missing');
  });

  it('a single object missing its verdict is still found, so the field can be named', () => {
    // Refusing to extract would report "no JSON" for a review that was JSON.
    expect(classifyUnreadableReview('{"summary":"looks fine","findings":[]}'))
      .toBe('review_verdict_missing');
  });

  it('prose that quotes code with braces is absent, not unparseable', () => {
    // A CODE reviewer writing prose quotes code, and code has braces. Calling
    // that "unparseable" points the operator at a ceiling; the fix is the prompt.
    expect(classifyUnreadableReview('The function foo() { return 1; } is fine, so I approve.'))
      .toBe('review_json_absent');
    expect(classifyUnreadableReview('```\n- if (a) { b(); }\n+ if (a) { c(); }\n```\nLooks right.'))
      .toBe('review_json_absent');
  });

  it('finds nothing in text that contains no object at all', () => {
    expect(extractReviewJson('no braces here')).toBeNull();
    expect(extractReviewJson('an array [1,2,3] is not a review')).toBeNull();
  });

  it('a review the validator accepts is never reported unreadable, and the reverse', () => {
    // The classifier and the validator must agree on every input, or the
    // artifact would name a cause the code did not act on.
    const inputs = [
      APPROVED, CHANGES, 'prose', '{"verdict":"approve","summary":"x"}',
      '{"summary":"x"}', '{"verdict":"approved"}', '{"verdict":"approved","summary":" "}',
      '{"broken', `\`\`\`json\n${APPROVED}\n\`\`\``,
    ];
    for (const text of inputs) {
      const accepted = validateHermesReview(text) !== null;
      const shape = classifyUnreadableReview(text);
      expect(accepted, `"${text.slice(0, 20)}" — accepted iff the shape says readable`)
        .toBe(shape === 'review_classifier_disagreement');
    }
  });
});
