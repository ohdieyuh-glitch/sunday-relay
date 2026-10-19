import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBoundedCommand } from './command-runner.ts';

/**
 * NEGATIVE CONTROLS FOR THE PARTIAL-SECRET DISCLOSURE (independent investigation, SECOND JULIUS).
 *
 * Root cause: captured output is BOUNDED first and SANITIZED second. A secret the cap cuts through loses its tail before any pattern can see its shape, and the
 * surviving head is stored in clear. The same order (slice, then sanitize) is used by three more production sites. Separately, a private-key header with no END
 * marker anywhere is redacted as a header only: the key body stays, with or without a cap.
 *
 * Every fixture is built at run time from pieces, so no secret-shaped literal exists in this file. Every secret body comes from a fixed-seed generator, so a window of its
 * characters cannot occur by accident in the filler text.
 *
 * Tests named N* are NEGATIVE CONTROLS: they FAIL on the pristine base and pass once the invariant holds. Tests named C* are POSITIVE CONTROLS: they pass on the base
 * and must keep passing (they prove the harness can see a correct redaction, and that the fix does not over-redact).
 */

const here = dirname(fileURLToPath(import.meta.url));
let seed = 0x2545f491;
const rand = (n: number): string => {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < n; i += 1) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; s += a[(seed >>> 24) % a.length]; }
  return s;
};
const dash5 = '-----';
const PEM_HEAD = `${dash5}BEGIN ${'PRIVATE'} KEY${dash5}`;
const PEM_FOOT = `${dash5}END ${'PRIVATE'} KEY${dash5}`;

/** Does any `k`-character window of `secret` appear in `stored`? */
const leaks = (stored: string, secret: string, k = 6): string | null => {
  for (let i = 0; i + k <= secret.length; i += 1) { const w = secret.slice(i, i + k); if (stored.includes(w)) return w; }
  return null;
};

interface Plan { readonly stream: 'stdout' | 'stderr'; readonly pieces: readonly string[]; readonly gapMs?: number; readonly hang?: boolean }
const run = async (plan: Plan, outputLimitBytes: number, timeoutMs = 20000) => {
  const script = `
    const pieces = JSON.parse(process.env.PIECES);
    const gap = Number(process.env.GAP || 0);
    const out = process.${plan.stream};
    let i = 0;
    const next = () => { if (i < pieces.length) { out.write(pieces[i++]); setTimeout(next, gap); } else if (process.env.HANG === '1') { setInterval(() => {}, 1000); } };
    next();`;
  return runBoundedCommand(
    { executable: process.execPath, args: ['-e', script], cwd: process.cwd(), env: { ...process.env, PIECES: JSON.stringify(plan.pieces), GAP: String(plan.gapMs ?? 0), HANG: plan.hang ? '1' : '0' } as Record<string, string>, timeoutMs, outputLimitBytes },
    () => new Date().toISOString(),
  );
};
const filler = (bytes: number): string => { let s = ''; let n = 0; while (s.length < bytes) { s += `log line ${n}\n`; n += 1; } return s.slice(0, bytes); };

/* ------------------------------------------------------------------------------------------------------------------ N: the cap cuts through a secret */

test('N1: a private key whose END marker is beyond the cap: no part of the key body is stored', async () => {
  const body = rand(160);
  const prefix = `${filler(40)}\n${PEM_HEAD}\n`;
  const limit = prefix.length + 70; // the cap falls inside the body
  const r = await run({ stream: 'stdout', pieces: [prefix + body + `\n${PEM_FOOT}\n`] }, limit);
  assert.equal(r.truncated, true);
  assert.equal(leaks(r.stdout, body), null, `stored: ${JSON.stringify(r.stdout.slice(-120))}`);
  assert.ok(r.redactions >= 1, 'something was redacted and counted');
});

test('N2: the same through stderr', async () => {
  const body = rand(160);
  const prefix = `${filler(40)}\n${PEM_HEAD}\n`;
  const r = await run({ stream: 'stderr', pieces: [prefix + body + `\n${PEM_FOOT}\n`] }, prefix.length + 70);
  assert.equal(leaks(r.stderr, body), null, `stored: ${JSON.stringify(r.stderr.slice(-120))}`);
});

test('N3: a vendor-prefixed key cut one character below the shape minimum is not stored', async () => {
  const tail = rand(30);
  const key = `${'s'}${'k'}-${tail}`;
  const lead = `${filler(30)} key: `;
  const r = await run({ stream: 'stdout', pieces: [lead + key + '\n'] }, lead.length + 3 + 7);
  assert.equal(r.truncated, true);
  assert.equal(leaks(r.stdout, tail.slice(0, 7), 5), null, `stored: ${JSON.stringify(r.stdout.slice(-60))}`);
});

test('N4: a source-host token cut at 19 of its 20-character minimum is not stored', async () => {
  const tail = rand(30);
  const lead = `${filler(30)} `;
  const r = await run({ stream: 'stdout', pieces: [lead + 'gh' + 'p_' + tail + '\n'] }, lead.length + 4 + 19);
  assert.equal(leaks(r.stdout, tail.slice(0, 19), 6), null, `stored: ${JSON.stringify(r.stdout.slice(-60))}`);
});

test('N5: a three-segment bearer token cut before its third segment is not stored', async () => {
  const head = `eyJ${rand(20)}`;
  const mid = `eyJ${rand(20)}`;
  const lead = `${filler(30)} `;
  const r = await run({ stream: 'stdout', pieces: [`${lead}${head}.${mid}.${rand(20)}\n`] }, lead.length + head.length + 1 + mid.length);
  assert.equal(leaks(r.stdout, head, 8), null, `stored: ${JSON.stringify(r.stdout.slice(-80))}`);
  assert.equal(leaks(r.stdout, mid, 8), null);
});

test('N6: an assignment cut after fewer than eight value characters is not stored', async () => {
  const value = rand(20);
  const lead = `${filler(30)} `;
  const r = await run({ stream: 'stdout', pieces: [`${lead}pass${'word'}=${value}\n`] }, lead.length + 'password='.length + 4);
  assert.equal(leaks(r.stdout, value.slice(0, 4), 4), null, `stored: ${JSON.stringify(r.stdout.slice(-50))}`);
});

/* ---------------------------------------------------------------------------------------------- N: a stream that ended without the secret ending */

test('N7: a private key with no END marker anywhere, well inside the cap and the process exiting normally: the body is not stored', async () => {
  const body = rand(160);
  const r = await run({ stream: 'stdout', pieces: [`${filler(30)}\n${PEM_HEAD}\n${body}\n`] }, 10000);
  assert.equal(r.truncated, false);
  assert.equal(leaks(r.stdout, body), null, `stored: ${JSON.stringify(r.stdout.slice(-120))}`);
});

test('N8: a process killed by its timeout in the middle of a token: the part written so far is not stored', async () => {
  const tail = rand(5);
  const r = await run({ stream: 'stdout', pieces: [`${filler(20)}\n`, `s${'k'}-${tail}`], gapMs: 50, hang: true }, 10000, 800);
  assert.equal(r.timedOut, true);
  assert.equal(leaks(r.stdout, tail, 5), null, `stored: ${JSON.stringify(r.stdout.slice(-40))}`);
});

/* ------------------------------------------------------------------------------------------------------------------------------ C: positive controls */

test('C1: a secret wholly inside the cap is redacted (the harness can see a correct redaction)', async () => {
  const body = rand(100);
  const r = await run({ stream: 'stdout', pieces: [`${filler(20)}\n${PEM_HEAD}\n${body}\n${PEM_FOOT}\n${filler(20)}`] }, 10000);
  assert.equal(leaks(r.stdout, body), null);
  assert.ok(r.redactions >= 1);
});

test('C2: the result does not depend on how the bytes are chunked: a secret split across three writes is redacted', async () => {
  const body = rand(100);
  const whole = `${filler(20)}\n${PEM_HEAD}\n${body}\n${PEM_FOOT}\n`;
  const a = Math.floor(whole.length / 3);
  const r = await run({ stream: 'stdout', pieces: [whole.slice(0, a), whole.slice(a, 2 * a), whole.slice(2 * a)], gapMs: 30 }, 10000);
  assert.equal(leaks(r.stdout, body), null);
  const tok = `${'s'}${'k'}-${rand(30)}`;
  const t = await run({ stream: 'stdout', pieces: [tok.slice(0, 5), tok.slice(5, 12), tok.slice(12)], gapMs: 30 }, 10000);
  assert.equal(leaks(t.stdout, tok.slice(3), 6), null);
});

test('C3: multi-byte text around a secret does not stop it being redacted', async () => {
  const tok = `${'s'}${'k'}-${rand(30)}`;
  const r = await run({ stream: 'stdout', pieces: [`${'\u{1F600}é€'.repeat(5)} ${tok} ${'日本語'.repeat(4)}\n`] }, 10000);
  assert.equal(leaks(r.stdout, tok.slice(3), 6), null);
});

test('C4: ordinary output that is cut by the cap is stored verbatim up to the cut (no over-redaction of an ordinary tail)', async () => {
  const text = filler(400);
  const r = await run({ stream: 'stdout', pieces: [text] }, 200);
  assert.equal(r.truncated, true);
  assert.ok(r.stdout.startsWith(text.slice(0, 190)), 'the stored prefix is the original text');
  assert.equal(r.stdout.includes('REDACTED'), false);
});

/* ---------------------------------------------------------------------------------------------- N: the other production sites that bound before sanitizing */

test('N9: no production file applies the sanitizer to text that has already been sliced or bounded', () => {
  const root = join(here, '..');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name) || name === 'output-sanitizer.ts') continue;
      const text = readFileSync(full, 'utf8');
      for (const m of text.matchAll(/sanitizeOutput\(([^;\n]*)\)/g)) if (/\.slice\(|bounded|boundOutput/.test(m[1])) offenders.push(`${full.slice(root.length)}: ${m[0].slice(0, 90)}`);
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], 'every site must sanitize the whole text and bound the result');
});
