import { describe, expect, it } from 'vitest';

import { redactPayload, safeText } from './redact';

/**
 * THE REVIEWER JUDGES WHAT IT IS GIVEN.
 *
 * The unified diff and the resulting file contents were both put through
 * `safeText` before entering the review packet — so Hermes was handed a
 * 600-character fragment of the diff and asked whether the implementation
 * satisfies the objective. On a fixture small enough to fit under the cap it
 * answered well; on anything larger it would have been judging a stump and
 * Relay would have recorded that verdict as an independent review.
 *
 * That is worse than the two truncations before it. Those produced a visible
 * failure — a report that would not parse, a verdict that would not read. This
 * one produces a CONFIDENT ANSWER ABOUT THE WRONG TEXT, which nothing detects.
 */

/** A diff longer than the display cap — i.e. any real one. */
const realisticDiff = (): string => [
  'diff --git a/src/normalize.js b/src/normalize.js',
  '--- a/src/normalize.js',
  '+++ b/src/normalize.js',
  ...Array.from({ length: 30 }, (_, i) => `+  const step${String(i)} = value.replace(/_/g, '-');`),
].join('\n');

describe('the review packet is not truncated to a headline', () => {
  const diff = realisticDiff();

  it('uses a diff longer than the display cap', () => {
    expect(diff.length).toBeGreaterThan(600);
  });

  it('the display sanitizer WOULD have destroyed it', () => {
    // The defect, pinned: what the Reviewer used to receive.
    const shown = safeText(diff);
    expect(shown.length).toBeLessThanOrEqual(600);
    expect(shown).not.toContain('step29');
  });

  it('payload redaction preserves the whole diff', () => {
    const kept = redactPayload(diff);
    expect(kept).toContain('step0');
    expect(kept).toContain('step29');
    expect(kept.length).toBe(diff.length);
  });

  it('still removes a provider secret from the diff', () => {
    const secret = ['sk', 'notarealvalue00000'].join('-');
    const out = redactPayload(`${diff}\n+  const key = '${secret}';`);
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });

  it('still removes a workspace path from the diff', () => {
    const out = redactPayload(`${diff}\n+// written at /tmp/relay-claude-fixture-zz9/src/normalize.js`);
    expect(out).not.toContain('relay-claude-fixture-zz9');
  });

  it('keeps newlines, which a diff is made of', () => {
    // `safeText` also collapses whitespace — a diff flattened to one line is
    // unreadable to a reviewer even when it fits.
    expect(redactPayload(diff).split('\n').length).toBeGreaterThan(30);
    expect(safeText(diff).split('\n')).toHaveLength(1);
  });
});
