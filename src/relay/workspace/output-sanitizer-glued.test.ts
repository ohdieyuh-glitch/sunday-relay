import { describe, expect, it } from 'vitest';

import { secureCapturedStream } from './command-runner';
import { REDACTION_MARK, sanitizeOutput } from './output-sanitizer';

/**
 * Glued key=value secrets have no word boundary before the key (`xpassword=`).
 * The assignment pattern still requires 8 non-whitespace characters after the
 * separator, so `hunter2` (7) stays and these cases use `hunter22` (8).
 * `passwordless`, `tokenizer`, and `apikey_docs` are ordinary words.
 */

const VALUE = 'hunter22';
const SHORT = 'hunter2';

const KEYS = ['password', 'secret', 'token', 'apikey', 'api_key', 'api-key'] as const;
const PREFIXES = ['x', 'pre', 'foo', '9', '_'] as const;

describe('glued key=value secrets are redacted', () => {
  it('redacts each assignment family when a word character is glued to the key, mid-line', () => {
    for (const key of KEYS) {
      for (const prefix of PREFIXES) {
        const raw = `alpha ${prefix}${key}=${VALUE} omega`;
        const stored = sanitizeOutput(raw);
        expect(stored.text, raw).not.toContain(VALUE);
        expect(stored.text, raw).toContain(REDACTION_MARK);
        expect(stored.text.startsWith('alpha '), raw).toBe(true);
        expect(stored.text.endsWith(' omega'), raw).toBe(true);
      }
    }
  });

  it('redacts a glued secret in the middle of a multi-line capture, not only the last token', () => {
    const raw = `line one\nbuild xpassword=${VALUE} continued\nline three`;
    const stored = sanitizeOutput(raw);
    expect(stored.text).not.toContain(VALUE);
    expect(stored.text).toContain('line one');
    expect(stored.text).toContain('line three');
    expect(stored.text).toContain(REDACTION_MARK);

    const captured = secureCapturedStream(raw, 1_000_000, false);
    expect(captured.text).not.toContain(VALUE);
    expect(captured.text).toContain('line one');
    expect(captured.text).toContain('line three');
  });

  it('redacts glued assignments with the same separators the pattern already allows', () => {
    for (const sep of ['=', ':', ' = ', ': ', ' :']) {
      const raw = `mid xpassword${sep}${VALUE} end`;
      const stored = sanitizeOutput(raw);
      expect(stored.text, raw).not.toContain(VALUE);
      expect(stored.text, raw).toContain(REDACTION_MARK);
      expect(stored.text.startsWith('mid '), raw).toBe(true);
      expect(stored.text.endsWith(' end'), raw).toBe(true);
    }
  });

  it('redacts a glued secret in another case', () => {
    const raw = `note xPASSWORD=${VALUE} done`;
    const stored = sanitizeOutput(raw);
    expect(stored.text).not.toContain(VALUE);
    expect(stored.text).toContain(REDACTION_MARK);
    expect(stored.text.startsWith('note '), raw).toBe(true);
  });

  it('redacts a glued secret sitting against unicode letters and punctuation', () => {
    const samples = [
      `«xpassword=${VALUE}»`,
      `(xpassword=${VALUE})`,
      `，xpassword=${VALUE}`,
      `xpassword=${VALUE}。`,
      `"xsecret=${VALUE}"`,
      `éxpassword=${VALUE}`,
    ];
    for (const raw of samples) {
      const stored = sanitizeOutput(raw);
      expect(stored.text, raw).not.toContain(VALUE);
      expect(stored.text, raw).toContain(REDACTION_MARK);
    }
  });

  it('still redacts a secret that already has a boundary beside unicode or punctuation', () => {
    const samples = [
      `épassword=${VALUE}`,
      `(password=${VALUE})`,
      `«password=${VALUE}»`,
      `，password=${VALUE}`,
      `password=${VALUE}。`,
    ];
    for (const raw of samples) {
      const stored = sanitizeOutput(raw);
      expect(stored.text, raw).not.toContain(VALUE);
      expect(stored.text, raw).toContain(REDACTION_MARK);
    }
  });
});

describe('ordinary words are not redacted', () => {
  it('keeps passwordless, tokenizer, and apikey_docs when they are not assignments', () => {
    const samples = [
      'passwordless',
      'the passwordless account stayed up',
      'tokenizer',
      `tokenizer: ${VALUE}`,
      'Read apikey_docs before changing the client.',
      'apikey_docs',
      `apikey_docs=${'overview'}`,
      `passwordless=${VALUE}`,
    ];
    for (const raw of samples) {
      expect(sanitizeOutput(raw).text, raw).toBe(raw);
      expect(sanitizeOutput(raw).redactions, raw).toBe(0);
    }
  });

  it('keeps a glued assignment whose value is still under 8 characters', () => {
    for (const raw of [`xpassword=${SHORT}`, `password=${SHORT}`, `note xpassword=${SHORT} end`]) {
      expect(sanitizeOutput(raw).text, raw).toBe(raw);
    }
  });
});
