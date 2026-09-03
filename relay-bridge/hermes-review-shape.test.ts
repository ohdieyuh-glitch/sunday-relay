import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import {
  classifyUnreadableReview, extractReviewJson, runHermesReview, validateHermesReview,
  type HermesConfig, type HermesOutcome, type HermesReviewShape, type ReviewPacket,
} from './hermes-reviewer';

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
