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

/**
 * SANITIZER RESIDUALS R2-R5 (security record for #389 / S-1). Each shape below was stored VERBATIM before this change, even from an uncut stream. Secret bodies are generated at run time
 * (no secret-shaped literal here); the oracle is that no 6-character window of any body survives.
 */
describe('residual shapes: JSON-quoted keys, quoted values with spaces, PGP and SSH2 private-key blocks', () => {
  const noWindowSurvives = (text: string, body: string): void => {
    const stored = sanitizeOutput(text).text;
    for (let i = 0; i + 6 <= body.length; i += 1) expect(stored.includes(body.slice(i, i + 6)), `${text} -> window ${i}`).toBe(false);
  };

  it('R2: a JSON-quoted key (and an upper-case env-style name) is redacted', () => {
    const body = rand(24);
    for (const name of ['api_key', 'apiKey', 'secret', 'password', 'token', 'OPENAI_API_KEY', 'client_secret']) {
      noWindowSurvives(`{"${name}":"${body}"}`, body);
      noWindowSurvives(`{"${name}": "${body}", "ok": true}`, body);
    }
  });

  it('R3: a quoted value with spaces is redacted whole', () => {
    const words = `${rand(9)} ${rand(9)} ${rand(9)}`;
    for (const text of [`password="${words}"`, `secret='${words}'`, `token: "${words}"`]) noWindowSurvives(text, words.replace(/ /g, ''));
    const stored = sanitizeOutput(`password="${words}" and then`).text;
    expect(stored).toContain(' and then');
  });

  it('R4: a PGP private-key block (the BLOCK suffix) is redacted from header to footer', () => {
    const body = rand(60);
    noWindowSurvives(`before\n-----BEGIN PGP PRIVATE KEY BLOCK-----\n${body}\n-----END PGP PRIVATE KEY BLOCK-----\nafter`, body);
    expect(sanitizeOutput(`-----BEGIN PGP PRIVATE KEY BLOCK-----\n${body}\n-----END PGP PRIVATE KEY BLOCK-----\nafter`).text).toContain('after');
  });

  it('R5: an SSH2 ENCRYPTED private-key block (digit in the label, four dashes) is redacted from header to footer', () => {
    const body = rand(60);
    noWindowSurvives(`---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----\n${body}\n---- END SSH2 ENCRYPTED PRIVATE KEY ----\nafter`, body);
    noWindowSurvives(`-----BEGIN SSH2 ENCRYPTED PRIVATE KEY-----\n${body}\n-----END SSH2 ENCRYPTED PRIVATE KEY-----\nafter`, body);
  });

  it('controls: ordinary prose and short or unquoted-but-short values are untouched', () => {
    for (const plain of ['the password reset link was sent', 'tokens: 123456789012', 'max_tokens: 4096', 'secret: x', 'token="short"', 'a "password" field is required']) {
      expect(sanitizeOutput(plain).text, plain).toBe(plain);
    }
  });
});

/**
 * SANITIZER RESIDUALS R5 (glued tokens), R6 (glued key blocks), R7 (more vendor shapes) and R2b (JSON inside a JSON string), from the reviewer's probes of the first round. Prefixes are assembled at run time.
 */
describe('residual shapes, second round: glued tokens, glued key blocks, more vendor keys, escaped JSON', () => {
  const windows = (body: string): string[] => { const out: string[] = []; for (let i = 0; i + 6 <= body.length; i += 1) out.push(body.slice(i, i + 6)); return out; };
  const leaks = (text: string, body: string): boolean => { const stored = sanitizeOutput(text).text; return windows(body).some((w) => stored.includes(w)); };
  const hex = '0123456789abcdef';

  it('R5: two GitHub tokens glued together leave no tail of either; a fine-grained github_pat_ token is redacted whole', () => {
    const a = rand(30); const b = rand(25);
    expect(leaks(`gho_${a}ghs_${b}`, a), 'first').toBe(false);
    expect(leaks(`gho_${a}ghs_${b}`, b), 'second tail').toBe(false);
    const id = rand(22); const body = rand(40);
    expect(leaks(`PAT github_pat_${id}_${body} end`, id + body)).toBe(false);
  });

  it('R6: a footer glued to the next block\'s header (8 dashes) does not store the second key', () => {
    const k1 = rand(60); const k2 = rand(60);
    const RSA = 'RSA PRIVATE KEY';
    for (const glue of ['-----', '---', '--------', '']) {
      const text = `-----BEGIN ${RSA}-----\n${k1}\n-----END ${RSA}-${glue}----BEGIN ${RSA}-----\n${k2}\n-----END ${RSA}-----`;
      expect(leaks(text, k1), `glue "${glue}" first`).toBe(false);
      expect(leaks(text, k2), `glue "${glue}" second`).toBe(false);
    }
  });

  it('R7: Stripe, OpenRouter, sk-live-, and aws_secret_access_key / passwd values are redacted', () => {
    const b = rand(32); const h = rand(48, hex); const aws = rand(40);
    expect(leaks(`k ${SK}_live_${b}`, b)).toBe(false);
    expect(leaks(`k rk_test_${b}`, b)).toBe(false);
    expect(leaks(`k ${SK}-live-${b}`, b)).toBe(false);
    expect(leaks(`k ${SK}-or-v1-${h}`, h)).toBe(false);
    expect(leaks(`aws_secret_access_key = ${aws}`, aws)).toBe(false);
    expect(leaks(`AWS_SECRET_ACCESS_KEY=${aws}`, aws)).toBe(false);
    expect(leaks(`passwd=${b}`, b)).toBe(false);
  });

  it('R2b: JSON inside a JSON string (escaped quotes, one and two levels) is redacted', () => {
    const b = rand(24);
    expect(leaks(`{"log":"{\\"password\\":\\"${b}\\"}"}`, b)).toBe(false);
    expect(leaks(`{"log":"{\\\\\\"token\\\\\\": \\\\\\"${b}\\\\\\"}"}`, b)).toBe(false);
  });

  it('controls: ordinary text near the new patterns is untouched', () => {
    for (const plain of ['ask-me-later', 'risk-free-live-streaming', `${SK}_live`, `${SK}-live-short`, 'gho_short', 'github_pat_short', 'PWD=/home/user/some/long/working/directory', 'secret_santa: yes', 'password reset', 'the --- BEGIN section ---']) {
      expect(sanitizeOutput(plain).text, plain).toBe(plain);
    }
  });
});

describe('S-1: private-key header shapes are scanned in linear time (worker output is untrusted)', () => {
  const timed = (input: string): number => { const t0 = performance.now(); sanitizeOutput(input); return performance.now() - t0; };
  it('20000 repeated bare headers, 5000 repeated full headers and 5000 unterminated blocks finish fast', () => {
    expect(timed('BEGIN PRIVATE KEY '.repeat(20000))).toBeLessThan(250);
    expect(timed('-----BEGIN PRIVATE KEY-----'.repeat(5000))).toBeLessThan(250);
    expect(timed('-----END PRIVATE KEY-----' + '-----BEGIN PRIVATE KEY-----'.repeat(5000))).toBeLessThan(250);
    expect(timed('-----BEGIN PRIVATE KEY-----'.repeat(5000) + 'END PRIVATE KEY')).toBeLessThan(250);
    expect(timed('-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n'.repeat(5000))).toBeLessThan(250);
  });
  it('a real block and two glued blocks are still redacted whole', () => {
    const b = 'A'.repeat(64);
    const one = `-----BEGIN RSA PRIVATE KEY-----\n${b}\n-----END RSA PRIVATE KEY-----`;
    expect(sanitizeOutput(`x ${one} y`).text).not.toContain(b);
    expect(sanitizeOutput(`${one}${one.replace('-----BEGIN', '--BEGIN')}`).text).not.toContain(b);
  });
});

describe('private_key as a name (reviewer condition on the residual list)', () => {
  it('redacts `private_key: <x>` and `PRIVATE-KEY=<x>`', () => {
    const b = rand(24);
    for (const text of [`private_key: ${b}`, `PRIVATE-KEY=${b}`]) {
      const stored = sanitizeOutput(text).text;
      expect(stored, text).toContain(REDACTION_MARK);
      expect(stored, text).not.toContain(b.slice(0, 12));
    }
  });
  it('leaves `private_key_path: x` and `private_keys: x` unchanged (the colon must follow `key` directly)', () => {
    for (const plain of ['private_key_path: /home/user/.ssh/id_ed25519_long_name', 'private_keys: /home/user/.ssh/keys_directory_name']) {
      expect(sanitizeOutput(plain).text, plain).toBe(plain);
    }
  });
});
