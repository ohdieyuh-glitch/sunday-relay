import { describe, expect, it } from 'vitest';

import { describeUnreadableReview, validateHermesReview } from './hermes-reviewer';

/**
 * "RELAY COULD NOT READ THE REVIEW" IS SIX DIFFERENT FACTS WEARING ONE SENTENCE.
 *
 * A real Hermes review ran on xAI/Grok for 45 seconds against a real diff, on a
 * mission whose Architect had been paid, whose Coding Agent had edited the
 * file, and whose tests Relay had already run and passed. It returned
 * something the validator rejected, and the mission said only that it could
 * not be read — not whether the model wrote prose instead of JSON, chose a
 * verdict word outside the vocabulary, or omitted the summary.
 *
 * Each of those needs a different response: a prompt change, a vocabulary
 * change, or a bug fix. One sentence for all three is a sentence that cannot
 * be acted on.
 */

const ok = (over: Record<string, unknown> = {}) => JSON.stringify({
  verdict: 'approved', summary: 'Looks correct.', findings: [], ...over,
});

describe('the review shape names which failure it was', () => {
  it('separates prose from JSON', () => {
    const out = describeUnreadableReview('The change looks fine to me overall.');
    expect(out).toContain('json=absent');
  });

  it('separates malformed JSON from absent JSON', () => {
    // Braces present but the content is not valid JSON. My first fixture here
    // omitted the closing brace, which the validator's brace scan correctly
    // calls ABSENT rather than unparseable — the fixture was wrong, not the
    // describer.
    expect(describeUnreadableReview('{ "verdict": "approved",, }')).toContain('json=unparseable');
    expect(describeUnreadableReview('{ "verdict": "approved", ')).toContain('json=absent');
  });

  it('names a verdict word outside the vocabulary — the likeliest cause', () => {
    // A model answering "approve" or "PASS" is the single most common way a
    // real review fails to validate, and the word is safe to echo.
    const out = describeUnreadableReview(ok({ verdict: 'approve' }));
    expect(out).toContain('verdict="approve"');
    expect(out).toContain('summary=present');
  });

  it('names a missing summary', () => {
    const out = describeUnreadableReview(JSON.stringify({ verdict: 'approved', findings: [] }));
    expect(out).toContain('summary=absent');
  });

  it('names an empty summary, which is not the same as absent', () => {
    expect(describeUnreadableReview(ok({ summary: '   ' }))).toContain('summary=empty');
  });

  it('reads a fenced block the way the validator does', () => {
    const out = describeUnreadableReview('```json\n' + ok({ verdict: 'nope' }) + '\n```');
    expect(out).toContain('fenced=true');
    expect(out).toContain('verdict="nope"');
  });

  /** The half that keeps a diagnostic from becoming a disclosure. */
  it('NEVER includes the review text', () => {
    const secret = ['sk', 'notarealvalue0000'].join('-');
    const out = describeUnreadableReview(
      `The diff in /srv/app/src/normalize.js leaks ${secret} on line 4. Verdict: fine.`,
    );
    expect(out).not.toContain(secret);
    expect(out).not.toContain('/srv');
    expect(out).not.toContain('normalize');
  });

  it('refuses a verdict that is not a bare word', () => {
    const out = describeUnreadableReview(ok({ verdict: 'approved because sk-abcdefghijklmnop is fine' }));
    expect(out).toContain('verdict=unrecognisedShape');
    expect(out).not.toContain('sk-abcdefghijklmnop');
  });

  it('agrees with the validator about what is readable', () => {
    // The shape describer must not disagree with the thing it explains: a
    // review the validator ACCEPTS should never be described here at all, so
    // this asserts the fixture used above is genuinely valid.
    expect(validateHermesReview(ok())).not.toBeNull();
    expect(validateHermesReview(ok({ verdict: 'approve' }))).toBeNull();
  });
});
