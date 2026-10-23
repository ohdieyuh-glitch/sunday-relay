import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runBoundedCommand, secureCapturedStream, type BoundedRunOutcome } from './command-runner';
import { REDACTION_MARK, boundOutput, sanitizeOutput } from './output-sanitizer';

/**
 * Capture-path redaction (julius-diag-output-safety-1 / -2).
 *
 * The diagnostic seed is the oracle. These tests drive the same behaviour through vitest:
 * exact UTF-8 bounds, stream decoding across chunk boundaries, and redact-then-bound so a
 * secret that straddles the limit is not stored in part and the stored size stays within
 * the caller's bound plus the truncation mark.
 *
 * Tokens and multibyte characters are built at run time. No secret-shaped literal is written here.
 */

const TRUNCATION_MARK = '\n[TRUNCATED: output limit reached]';
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const prefixOf = (bounded: { text: string }): string => bounded.text.slice(0, bounded.text.length - TRUNCATION_MARK.length);
const SK = 's' + 'k-';
const MARK_BYTES = Buffer.byteLength(TRUNCATION_MARK, 'utf8');

const run = (script: string, outputLimitBytes: number, env: Record<string, string> = {}): Promise<BoundedRunOutcome> =>
  runBoundedCommand(
    {
      executable: process.execPath,
      args: ['-e', script],
      cwd: mkdtempSync(join(tmpdir(), 'capture-redaction-')),
      env: { PATH: process.env.PATH ?? '', ...env },
      timeoutMs: 20_000,
      outputLimitBytes,
    },
    () => new Date().toISOString(),
  );

describe('boundOutput counts UTF-8 bytes and never splits a character', () => {
  it('returns text that fits the byte budget untouched', () => {
    expect(boundOutput('héllo', 6)).toEqual({ text: 'héllo', truncated: false });
    expect(boundOutput('plain ascii', 11)).toEqual({ text: 'plain ascii', truncated: false });
    expect(boundOutput('', 0)).toEqual({ text: '', truncated: false });
    expect(boundOutput('€€', 6)).toEqual({ text: '€€', truncated: false });
  });

  it('keeps the longest prefix whose UTF-8 size fits, no shorter', () => {
    const bounded = boundOutput('é'.repeat(100), 100);
    expect(bounded.truncated).toBe(true);
    expect(prefixOf(bounded)).toBe('é'.repeat(50));
    expect(Buffer.byteLength(prefixOf(bounded), 'utf8')).toBe(100);
    const ascii = boundOutput('abcdefghij', 9);
    expect(ascii.truncated).toBe(true);
    expect(prefixOf(ascii)).toBe('abcdefghi');
  });

  it('never leaves a lone surrogate, including when the next character does not fit', () => {
    const emoji = '😀'.repeat(10);
    const ten = boundOutput(emoji, 10);
    expect(prefixOf(ten)).toBe('😀😀');
    expect(LONE_SURROGATE.test(ten.text)).toBe(false);
    const tiny = boundOutput(emoji, 3);
    expect(tiny.truncated).toBe(true);
    expect(prefixOf(tiny)).toBe('');
    expect(LONE_SURROGATE.test(tiny.text)).toBe(false);
    for (let limit = 0; limit < 40; limit += 1) {
      const out = boundOutput('a😀é€b'.repeat(8), limit);
      expect(LONE_SURROGATE.test(out.text), `limit ${limit}`).toBe(false);
      const prefix = out.truncated ? prefixOf(out) : out.text;
      expect(Buffer.byteLength(prefix, 'utf8'), `limit ${limit}`).toBeLessThanOrEqual(limit);
    }
  });

  it('marks a truncation exactly once and leaves an exact fit unmarked', () => {
    const out = boundOutput('x'.repeat(50), 10);
    expect(out.text).toBe(`${'x'.repeat(10)}${TRUNCATION_MARK}`);
    expect(out.text.split('TRUNCATED').length - 1).toBe(1);
    expect(boundOutput('x'.repeat(10), 10).text.includes('TRUNCATED')).toBe(false);
  });

  it('does not change what sanitizeOutput already matches', () => {
    const clean = sanitizeOutput(`token ${SK}${'ABCDEFGHIJKL'} and again ${SK}${'MNOPQRSTUVWX'} end`);
    expect(clean.redactions).toBe(2);
    expect(clean.text.includes(`${SK}A`)).toBe(false);
    expect(clean.text.split(REDACTION_MARK).length - 1).toBe(2);
  });
});

describe('runBoundedCommand decodes, redacts, then bounds', () => {
  it('leaves an ordinary command unchanged', async () => {
    const outcome = await run("console.log('hello'); console.error('warn')", 1_000);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe('hello\n');
    expect(outcome.stderr).toBe('warn\n');
    expect(outcome.truncated).toBe(false);
    expect(outcome.redactions).toBe(0);
    expect(outcome.timedOut).toBe(false);
    expect(outcome.outputLimitHit).toBe(false);
  });

  it('reassembles a multi-byte character split across reads, on stdout and stderr', async () => {
    const script = "const euro = Buffer.from('€'); process.stdout.write(euro.subarray(0, 2)); process.stderr.write(euro.subarray(0, 1));"
      + " setTimeout(() => { process.stdout.write(euro.subarray(2)); process.stderr.write(euro.subarray(1)); }, 150);";
    const outcome = await run(script, 1_000);
    expect(outcome.stdout).toBe('€');
    expect(outcome.stderr).toBe('€');
    expect(outcome.stdout.includes('�') || outcome.stderr.includes('�')).toBe(false);
  });

  it('does not store any part of a secret that straddles the byte limit', async () => {
    const secret = `${SK}${'ABCDEFGHIJKLMNOPQRSTUV'}`;
    const script = `process.stdout.write('x'.repeat(90) + ${JSON.stringify(secret)} + '\\n')`;
    const outcome = await run(script, 100);
    expect(outcome.outputLimitHit).toBe(true);
    expect(outcome.truncated).toBe(true);
    expect(outcome.stdout).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(outcome.stdout.includes('ABCD')).toBe(false);
    expect(Buffer.byteLength(outcome.stdout, 'utf8')).toBeLessThanOrEqual(100 + MARK_BYTES);
  });

  it('keeps stored text within the bound plus the truncation mark when redaction lengthens it', async () => {
    const one = `${SK}${'12345678'} `;
    const script = `process.stdout.write(${JSON.stringify(one)}.repeat(5))`;
    const outcome = await run(script, 60);
    expect(Buffer.byteLength(outcome.stdout, 'utf8')).toBeLessThanOrEqual(60 + MARK_BYTES);
    expect(outcome.stdout.includes(`${SK}1234`)).toBe(false);
    expect(outcome.truncated).toBe(true);
  });

  it('counts every captured secret once and stores the redaction mark', async () => {
    const out = `a ${SK}${'ABCDEFGHIJKL'} b`;
    const err = `c ${SK}${'MNOPQRSTUVWX'} d`;
    const outcome = await run(`console.log(${JSON.stringify(out)}); console.error(${JSON.stringify(err)})`, 1_000);
    expect(outcome.redactions).toBe(2);
    expect(outcome.stdout.includes(`${SK}A`)).toBe(false);
    expect(outcome.stderr.includes(`${SK}M`)).toBe(false);
    expect(outcome.stdout).toBe(`a ${REDACTION_MARK} b\n`);
  });
});

describe('chunk boundaries', () => {
  const splitScript = `
    const a = Buffer.from(process.env.PART_A, 'base64');
    const b = Buffer.from(process.env.PART_B, 'base64');
    process.stdout.write(a);
    process.stderr.write(a);
    setTimeout(() => { process.stdout.write(b); process.stderr.write(b); }, 150);
  `;

  const splitRun = (bytes: Buffer, at: number, outputLimitBytes: number) => run(splitScript, outputLimitBytes, {
    PART_A: bytes.subarray(0, at).toString('base64'),
    PART_B: bytes.subarray(at).toString('base64'),
  });

  it('redacts a token split at every byte offset, on both streams', async () => {
    const token = `${SK}${'ABCDEFGHIJKLMNOP'}`;
    const bytes = Buffer.from(`${token}\n`);
    expect(bytes.length).toBeGreaterThan(8);
    for (let at = 0; at <= bytes.length; at += 1) {
      const outcome = await splitRun(bytes, at, 1_000);
      expect(outcome.exitCode, `split ${at}`).toBe(0);
      expect(outcome.stdout, `stdout split ${at}`).not.toMatch(/sk-[A-Za-z0-9]/);
      expect(outcome.stderr, `stderr split ${at}`).not.toMatch(/sk-[A-Za-z0-9]/);
      expect(outcome.stdout.includes('ABCDEFGH'), `stdout body split ${at}`).toBe(false);
      expect(outcome.stderr.includes('ABCDEFGH'), `stderr body split ${at}`).toBe(false);
      expect(outcome.stdout, `stdout split ${at}`).toBe(`${REDACTION_MARK}\n`);
      expect(outcome.stderr, `stderr split ${at}`).toBe(`${REDACTION_MARK}\n`);
      expect(outcome.redactions, `split ${at}`).toBe(2);
    }
  }, 90_000);

  it('reassembles multibyte characters split at every byte offset, on both streams', async () => {
    const samples = ['é', '€', '😀', 'a😀é€b'];
    for (const sample of samples) {
      const bytes = Buffer.from(sample);
      for (let at = 1; at < bytes.length; at += 1) {
        const outcome = await splitRun(bytes, at, 1_000);
        expect(outcome.stdout, `${sample} stdout @${at}`).toBe(sample);
        expect(outcome.stderr, `${sample} stderr @${at}`).toBe(sample);
        expect(outcome.stdout.includes('�') || outcome.stderr.includes('�'), `${sample} @${at}`).toBe(false);
        expect(LONE_SURROGATE.test(outcome.stdout + outcome.stderr), `${sample} @${at}`).toBe(false);
      }
    }
  }, 90_000);
});

describe('bounds and cost of a large captured stream', () => {
  it('stores at most the bound plus the truncation mark when the process emits far more', async () => {
    const script = `
      let n = 0;
      const tick = () => {
        if (n >= 200) return;
        process.stdout.write('line ' + String(n).padStart(4, '0') + ' ' + 'x'.repeat(240) + '\\n');
        n += 1;
        setImmediate(tick);
      };
      tick();
    `;
    const limit = 4_096;
    const outcome = await run(script, limit);
    expect(outcome.outputLimitHit).toBe(true);
    expect(outcome.truncated).toBe(true);
    const storedBytes = Buffer.byteLength(outcome.stdout, 'utf8');
    expect(storedBytes).toBeLessThanOrEqual(limit + MARK_BYTES);
    // A single read larger than the capture window is dropped whole, so the truncation mark is present
    // only when the bytes that were kept exceed the caller's bound.
    if (outcome.stdout.endsWith(TRUNCATION_MARK)) {
      expect(Buffer.byteLength(outcome.stdout.slice(0, -TRUNCATION_MARK.length), 'utf8')).toBeLessThanOrEqual(limit);
      expect(outcome.stdout.startsWith('line 0000 ')).toBe(true);
    } else {
      expect(storedBytes).toBeLessThanOrEqual(limit);
    }
  }, 20_000);

  it('redacts before bounding a multi-megabyte capture, and stays well under a second and a half', () => {
    const secret = `${SK}${'ABCDEFGHIJKLMNOP'}`;
    // The bound lands on the newline after the secret, so a bound-then-redact pass keeps the whole
    // secret and then lengthens it. The tail is padding, not a partial token the withhold step can shrink.
    const head = `${'y'.repeat(8_192 - secret.length - 2)}\n${secret}\n`;
    expect(Buffer.byteLength(head, 'utf8')).toBe(8_192);
    const raw = `${head}${'z'.repeat(2_000_000)}\n`;
    const started = Date.now();
    const stored = secureCapturedStream(raw, 8_192, false);
    const elapsed = Date.now() - started;
    // Linear in the capture. A per-byte quadratic pass on ~2MB does not finish in this budget.
    expect(elapsed).toBeLessThan(1_500);
    expect(stored.truncated).toBe(true);
    expect(Buffer.byteLength(stored.text, 'utf8')).toBeLessThanOrEqual(8_192 + MARK_BYTES);
    expect(stored.text.includes('ABCDEFGH')).toBe(false);
    expect(stored.text).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(stored.redactions).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line no-console
    console.log(`large-stream secureCapturedStream ${raw.length} chars in ${elapsed} ms`);
  });
});
