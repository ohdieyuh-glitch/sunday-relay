import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { boundOutput, sanitizeOutput, REDACTION_MARK } from './output-sanitizer.ts';
import { runBoundedCommand, type BoundedRunOutcome } from './command-runner.ts';

/**
 * CAPTURED PROCESS OUTPUT MUST BE SAFE TO STORE — THE SPECIFICATION.
 *
 * `runBoundedCommand` runs an approved command and returns its stdout and stderr, bounded to `outputLimitBytes` and with
 * secret-shaped substrings redacted, because what it returns is stored in results and evidence and shown to people. Three
 * things about how it does that are wrong today, and each one has a consequence a reader of the stored output cannot see:
 *
 *   1. THE BOUND IS A GUESS. `boundOutput` counts every non-ASCII UTF-16 unit as three bytes and cuts the string at a UTF-16
 *      unit, so it keeps less text than the budget allows for ordinary accented text, and it can cut an emoji in half,
 *      leaving a lone surrogate that no later reader can decode.
 *   2. THE DECODING IS PER CHUNK. A multi-byte character whose bytes arrive in two reads is turned into U+FFFD twice, and the
 *      real character is gone for good.
 *   3. THE ORDER IS BOUND, THEN REDACT. A secret that straddles the limit is cut first, and what is left of it is too short
 *      for any redaction pattern to match, so its first characters are stored in clear. Redacting after bounding can also
 *      make the stored text LONGER than the bound the caller asked for (the redaction mark is longer than a short secret).
 *
 * WHAT THIS FILE PINS. The first group exercises `boundOutput` directly; the second drives the real runner against real
 * child processes (`process.execPath`), because a helper that is right and not used is not a fix. It does not name any new
 * export: how the work is arranged between the two files is the implementer's to decide.
 */

const TRUNCATION_MARK = '\n[TRUNCATED: output limit reached]';
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const prefixOf = (bounded: { text: string }): string => bounded.text.slice(0, bounded.text.length - TRUNCATION_MARK.length);

/* ------------------------------------------------------------------ boundOutput */

test('text that fits the byte budget is returned untouched, however it is spelled', () => {
  assert.deepEqual(boundOutput('héllo', 6), { text: 'héllo', truncated: false }); // 6 UTF-8 bytes exactly
  assert.deepEqual(boundOutput('plain ascii', 11), { text: 'plain ascii', truncated: false });
  assert.deepEqual(boundOutput('', 0), { text: '', truncated: false });
  assert.deepEqual(boundOutput('€€', 6), { text: '€€', truncated: false }); // 3 bytes each
});

test('the bound is the exact UTF-8 byte count: the longest prefix that fits is kept, no shorter', () => {
  const bounded = boundOutput('é'.repeat(100), 100); // 2 bytes each: exactly 50 fit
  assert.equal(bounded.truncated, true);
  assert.equal(prefixOf(bounded), 'é'.repeat(50));
  assert.equal(Buffer.byteLength(prefixOf(bounded), 'utf8'), 100);
  const ascii = boundOutput('abcdefghij', 9);
  assert.equal(ascii.truncated, true);
  assert.equal(prefixOf(ascii), 'abcdefghi');
});

test('a character is never cut in half: nothing a reader sees is a lone surrogate', () => {
  const emoji = '😀'.repeat(10); // 4 bytes each
  const ten = boundOutput(emoji, 10);
  assert.equal(prefixOf(ten), '😀😀'); // 8 bytes; a third would be 12
  assert.equal(LONE_SURROGATE.test(ten.text), false);
  const tiny = boundOutput(emoji, 3); // not even one fits
  assert.equal(tiny.truncated, true);
  assert.equal(prefixOf(tiny), '');
  assert.equal(LONE_SURROGATE.test(tiny.text), false);
  for (let limit = 0; limit < 40; limit += 1) {
    const out = boundOutput('a😀é€b'.repeat(8), limit);
    assert.equal(LONE_SURROGATE.test(out.text), false, `limit ${limit}`);
    assert.ok(Buffer.byteLength(prefixOf(out.truncated ? out : { text: out.text + TRUNCATION_MARK }), 'utf8') <= limit, `limit ${limit}`);
  }
});

test('a truncation is marked exactly once, and an untruncated text carries no mark', () => {
  const out = boundOutput('x'.repeat(50), 10);
  assert.equal(out.text, `${'x'.repeat(10)}${TRUNCATION_MARK}`);
  assert.equal(out.text.split('TRUNCATED').length - 1, 1);
  assert.equal(boundOutput('x'.repeat(10), 10).text.includes('TRUNCATED'), false);
});

test('redaction still finds what it found before (the existing behaviour is kept)', () => {
  const clean = sanitizeOutput('token sk-ABCDEFGHIJKL and again sk-MNOPQRSTUVWX end');
  assert.equal(clean.redactions, 2);
  assert.equal(clean.text.includes('sk-A'), false);
  assert.equal(clean.text.split(REDACTION_MARK).length - 1, 2);
});

/* ------------------------------------------------------------------ the real runner */

const run = (script: string, outputLimitBytes: number): Promise<BoundedRunOutcome> =>
  runBoundedCommand(
    {
      executable: process.execPath,
      args: ['-e', script],
      cwd: mkdtempSync(join(tmpdir(), 'output-safety-')),
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 20_000,
      outputLimitBytes,
    },
    () => new Date().toISOString(),
  );

test('an ordinary command is unchanged: its output, exit code and flags', async () => {
  const outcome = await run("console.log('hello'); console.error('warn')", 1_000);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.stdout, 'hello\n');
  assert.equal(outcome.stderr, 'warn\n');
  assert.equal(outcome.truncated, false);
  assert.equal(outcome.redactions, 0);
  assert.equal(outcome.timedOut, false);
});

test('a multi-byte character whose bytes arrive in two reads survives, on stdout and on stderr', async () => {
  const script = "const euro = Buffer.from('€'); process.stdout.write(euro.subarray(0, 2)); process.stderr.write(euro.subarray(0, 1));"
    + " setTimeout(() => { process.stdout.write(euro.subarray(2)); process.stderr.write(euro.subarray(1)); }, 150);";
  const outcome = await run(script, 1_000);
  assert.equal(outcome.stdout, '€');
  assert.equal(outcome.stderr, '€');
  assert.equal(outcome.stdout.includes('�') || outcome.stderr.includes('�'), false);
});

test('a secret that straddles the limit is not stored in clear: no part of it survives the cut', async () => {
  // 90 bytes of padding, then a secret-shaped value that runs past the 100-byte limit.
  const outcome = await run("process.stdout.write('x'.repeat(90) + 'sk-ABCDEFGHIJKLMNOPQRSTUV' + '\\n')", 100);
  assert.equal(outcome.outputLimitHit, true);
  assert.equal(outcome.truncated, true);
  assert.doesNotMatch(outcome.stdout, /sk-[A-Za-z0-9]/);
  assert.equal(outcome.stdout.includes('ABCD'), false);
});

test('the stored text never exceeds the caller\'s bound plus the truncation mark, even when redaction lengthens it', async () => {
  // Five short secrets (12 bytes each); each becomes a 23-byte mark, so redacting AFTER bounding would store far more than 60 bytes.
  const outcome = await run("process.stdout.write('sk-12345678 '.repeat(5))", 60);
  assert.ok(Buffer.byteLength(outcome.stdout, 'utf8') <= 60 + Buffer.byteLength(TRUNCATION_MARK, 'utf8'), `stored ${Buffer.byteLength(outcome.stdout, 'utf8')} bytes`);
  assert.equal(outcome.stdout.includes('sk-1234'), false);
});

test('every secret within the captured output is counted once, and none is stored', async () => {
  const outcome = await run("console.log('a sk-ABCDEFGHIJKL b'); console.error('c sk-MNOPQRSTUVWX d')", 1_000);
  assert.equal(outcome.redactions, 2);
  assert.equal(outcome.stdout.includes('sk-A'), false);
  assert.equal(outcome.stderr.includes('sk-M'), false);
  assert.equal(outcome.stdout, `a ${REDACTION_MARK} b\n`);
});
