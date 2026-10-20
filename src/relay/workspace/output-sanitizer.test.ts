import { describe, expect, it } from 'vitest';

import { REDACTION_MARK, sanitizeOutput } from './output-sanitizer';

/**
 * The sanitizer's vendor-key patterns. Every key here is built at run time from pieces (no secret-shaped literal in this file); bodies come from a fixed-seed generator so a 6-character window
 * of a body cannot occur by chance elsewhere. Real OpenAI keys are `sk-proj-...`, `sk-svcacct-...`, `sk-admin-...` (hyphens AND underscores in the body); Anthropic keys are `sk-ant-api03-...`.
 */
let seed = 0x1badf00d;
const rand = (n: number, alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'): string => {
  let out = '';
  for (let i = 0; i < n; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out += alphabet[(seed >>> 24) % alphabet.length];
  }
  return out;
};
const withSeparators = (): string => `${rand(24)}-${rand(10)}_${rand(30)}-${rand(6)}_${rand(20)}`;
const SK = 'sk';

describe('vendor keys with hyphens and underscores in the body are redacted whole', () => {
  const kinds: Array<[string, string]> = [['project', 'proj'], ['service account', 'svcacct'], ['admin', 'admin'], ['anthropic', 'ant-api03']];
  for (const [label, infix] of kinds) {
    it(`${label}: ${SK}-${infix}-<body with - and _> is redacted from its first character to its last, in a sentence, in quotes and after an equals sign`, () => {
      const body = withSeparators();
      const key = `${SK}-${infix}-${body}`;
      for (const text of [`key ${key} end`, `"${key}"`, `OPENAI_API_KEY=${key}`, `${key}`, `Authorization: Bearer ${key}`]) {
        const r = sanitizeOutput(text);
        expect(r.text, text).not.toContain(body.slice(0, 8));
        expect(r.text, text).not.toContain(body.slice(-8));
        expect(r.text.includes(REDACTION_MARK), text).toBe(true);
        expect(r.redactions).toBeGreaterThanOrEqual(1);
      }
      // nothing of the body survives: no 6-character window of it is left
      const stored = sanitizeOutput(`log ${key} more`).text;
      for (let i = 0; i + 6 <= body.length; i += 1) expect(stored.includes(body.slice(i, i + 6)), `window ${i}`).toBe(false);
    });
  }

  it('the legacy alphanumeric key is still redacted, and ordinary text is untouched', () => {
    const body = rand(48);
    expect(sanitizeOutput(`${SK}-${body}`).text).toBe(REDACTION_MARK);
    for (const plain of ['the quick brown fox', 'a task was started', 'skipped 3 tests', 'sk-', 'sk-abc', 'ask-me-later', 'task-force-2024-q3-report', 'risk-free-and-sk-proj']) expect(sanitizeOutput(plain).text, plain).toBe(plain);
  });
});
