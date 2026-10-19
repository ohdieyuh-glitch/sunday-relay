/**
 * THE REVIEWER'S EVIDENCE, BOUNDED — AND NEVER BOUNDED SILENTLY.
 *
 * The Independent Reviewer is handed the implementation diff and the test output inside ONE prompt, and the
 * prompt goes to its process as a single argument. Nothing bounded those two fields: a large diff or a noisy
 * test run would have grown the prompt until the operating system refused to start the process, which the
 * adapter can only report as "could not be started" — a failure that names no cause and a review that never
 * happened. The context compiler's 24,000-character cap covers the mission context only, not these.
 *
 * THE RULES, and the reason for each:
 *   1. UNDER THE LIMIT, THE TEXT IS RETURNED UNCHANGED. Not equal: the same string. Every packet that fits today
 *      is byte-for-byte what it was, so adding the bound moves no existing run.
 *   2. OVER THE LIMIT, THE REVIEWER IS TOLD. A visible marker states what was shown, of how much, and where the
 *      rest went, and asks the reviewer to say if the omission prevents a verdict. A reviewer that does not
 *      know it was handed a partial diff would approve a part as though it were the whole.
 *   3. A CUT FALLS ON A LINE BOUNDARY when one is near, so no line is shown half; and never inside a surrogate
 *      pair, so the result is always well-formed text.
 *   4. THE DIFF KEEPS ITS HEAD (the file headers and first hunks name what changed) and THE TEST OUTPUT KEEPS ITS
 *      TAIL (a runner prints its verdict and its failures last).
 *   5. THE DIGEST IS NOT HERE. `artifactDigest` and `changedFiles` are computed from the FULL diff by the caller,
 *      so the record of what was reviewed still names the whole artifact and every changed file.
 */

/** Characters, not bytes: a bound on what the reviewer reads. The prompt as a whole is bounded by the caller's argv limit. */
export const REVIEW_EVIDENCE_LIMITS = Object.freeze({
  /** About 600 lines of ordinary diff. The largest implementation diff measured on a paid run was far below it. */
  diffChars: 40_000,
  /** A runner's summary and failures; the tail is what is kept. */
  testOutputChars: 12_000,
});

export interface BoundedEvidenceText {
  readonly text: string;
  /** Characters not shown; 0 means the text is the input, unchanged. */
  readonly omittedChars: number;
}

/** True when `index` splits a surrogate pair (the code unit before it is a high surrogate and the one at it is a low one). */
function splitsSurrogatePair(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false;
  const before = text.charCodeAt(index - 1);
  const at = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff;
}

/** How far back from the limit a line boundary may be found before the cut is taken mid-line instead. */
const LINE_SEARCH_WINDOW = 400;

/**
 * Bound `text` to about `limit` characters, keeping its `keep` end.
 *
 * `limit` must be a positive safe integer. The marker is added to the kept text and is not counted in the limit,
 * so a bounded value is at most `limit` plus one short marker line.
 */
export function boundEvidenceText(text: string, limit: number, keep: 'head' | 'tail', label: string): BoundedEvidenceText {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('review_evidence_limit_invalid');
  if (text.length <= limit) return { text, omittedChars: 0 };

  let kept: string;
  if (keep === 'head') {
    let end = limit;
    const newline = text.lastIndexOf('\n', end - 1);
    if (newline >= end - LINE_SEARCH_WINDOW && newline > 0) end = newline + 1;
    else if (splitsSurrogatePair(text, end)) end -= 1;
    kept = text.slice(0, end);
  } else {
    let start = text.length - limit;
    const newline = text.indexOf('\n', start);
    if (newline !== -1 && newline <= start + LINE_SEARCH_WINDOW) start = newline + 1;
    else if (splitsSurrogatePair(text, start)) start += 1;
    kept = text.slice(start);
  }
  const omittedChars = text.length - kept.length;
  const where = keep === 'head' ? 'first' : 'last';
  const marker = `[${label} TRUNCATED: the ${where} ${kept.length} of ${text.length} characters are shown, ${omittedChars} omitted. ` +
    'State in your review whether what you could not see prevents a verdict.]';
  return { text: keep === 'head' ? `${kept}${kept.endsWith('\n') ? '' : '\n'}${marker}` : `${marker}\n${kept}`, omittedChars };
}

export interface BoundedReviewEvidence {
  readonly unifiedDiff: string;
  readonly testOutput: string;
  /** What was left out of each field; both 0 when nothing was bounded. */
  readonly omitted: { readonly diff: number; readonly testOutput: number };
}

/** The two unbounded fields of an implementation review packet, bounded by the limits above. */
export function boundReviewEvidence(input: { readonly unifiedDiff: string; readonly testOutput: string }): BoundedReviewEvidence {
  const diff = boundEvidenceText(input.unifiedDiff, REVIEW_EVIDENCE_LIMITS.diffChars, 'head', 'DIFF');
  const output = boundEvidenceText(input.testOutput, REVIEW_EVIDENCE_LIMITS.testOutputChars, 'tail', 'TEST OUTPUT');
  return { unifiedDiff: diff.text, testOutput: output.text, omitted: { diff: diff.omittedChars, testOutput: output.omittedChars } };
}
