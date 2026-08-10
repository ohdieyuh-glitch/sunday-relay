import { describe, expect, it } from 'vitest';

import { redactPayload, safeText } from '../../redact';
import { validateHermesReview } from '../../hermes-reviewer';

/**
 * A REAL VERDICT IS LONGER THAN THE DISPLAY LIMIT.
 *
 * The Hermes runner returned the Reviewer's stdout through `safeText` — the
 * sanitizer for short strings a human reads, which collapses whitespace and
 * cuts at 600 characters. Every real verdict is longer, so every remote review
 * arrived with its JSON severed and Relay reported "returned a review Relay
 * could not read".
 *
 * The mission that exposed it had paid the Prompt Architect, watched the hosted
 * Coding Agent edit the file, passed its own tests, bound an artifact digest,
 * and run Hermes on xAI/Grok for 45 seconds against the real diff. The verdict
 * was destroyed on arrival, and the message blamed the model.
 *
 * This is the SECOND time a display sanitizer has eaten a machine-read payload
 * in this pipeline. The first was the hosted Coding Agent's execution report.
 */

/** A verdict shaped like the prompt asks for, longer than the 600-char cap. */
const realisticVerdict = (): string => JSON.stringify({
  verdict: 'changes_required',
  summary: 'The guard rejects unknown versions but the test does not cover the boundary case. '.repeat(4),
  findings: [
    {
      findingId: 'F-1',
      severity: 'major',
      requirement: 'The guard refuses an unknown schema version.',
      file: 'src/normalize.js',
      line: 12,
      explanation: 'The comparison uses loose equality, so "1" and 1 are treated alike. '.repeat(3),
      evidence: 'Line 12 compares with == rather than ===.',
      recommendedAction: 'Use strict equality and add a boundary test.',
    },
  ],
});

describe('the Reviewer verdict survives the runner', () => {
  const verdict = realisticVerdict();

  it('uses a fixture longer than the display cap', () => {
    // Guards the guard: a shorter verdict would pass against the old code and
    // prove nothing — which is exactly how this survived.
    expect(verdict.length).toBeGreaterThan(600);
  });

  it('is DESTROYED by the display sanitizer, which is why it was wrong here', () => {
    // The defect, pinned: this is what production did to every review.
    expect(validateHermesReview(safeText(verdict))).toBeNull();
  });

  it('SURVIVES payload redaction and still validates', () => {
    const result = validateHermesReview(redactPayload(verdict));
    expect(result).not.toBeNull();
    expect(result?.verdict).toBe('changes_required');
    expect(result?.findings).toHaveLength(1);
  });

  it('still strips a provider secret from the payload', () => {
    // The half that must not regress: redaction is kept, only the bound is
    // dropped.
    const secret = ['sk', 'notarealvalue0000000'].join('-');
    const withSecret = JSON.stringify({
      verdict: 'approved', summary: `token ${secret} appeared in the diff`, findings: [],
    });
    const out = redactPayload(withSecret);
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
    // And it is still parseable after redaction.
    expect(validateHermesReview(out)).not.toBeNull();
  });

  it('still strips an absolute host path', () => {
    /**
     * The prefixes `stripAbsolutePaths` actually targets are `/home`,
     * `/Users`, `/tmp`, `/var` and `/root` — the workspace roots this product
     * creates. My first version of this test used `/srv`, which it does not
     * cover, and I corrected the TEST rather than widening the function:
     * broadening a redaction rule to make an assertion pass changes behaviour
     * everywhere for the sake of one example.
     */
    const out = redactPayload(JSON.stringify({
      verdict: 'approved', summary: 'checked /tmp/relay-claude-fixture-abc123/src/x.js', findings: [],
    }));
    expect(out).not.toContain('relay-claude-fixture-abc123');
    expect(out).toContain('…/x.js');
  });

  it('does not collapse the payload into one line', () => {
    // `safeText` also flattens whitespace. Harmless for JSON, fatal for a
    // fenced block, and unnecessary either way.
    expect(redactPayload('{\n  "verdict": "approved"\n}')).toContain('\n');
  });
});
