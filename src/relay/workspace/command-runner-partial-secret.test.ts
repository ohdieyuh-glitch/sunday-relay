import { describe, expect, it } from 'vitest';

import { runBoundedCommand } from './command-runner';

/**
 * PARTIAL-SECRET DISCLOSURE AT THE CAPTURE CAP (security finding, independent reviewer MEDIUM / ADVISORY).
 *
 * The runner bounds a captured stream first and sanitizes it second, and every sanitizer pattern needs a secret's WHOLE shape. A stream that stops early (the
 * cap cut it, a chunk was dropped past the capture limit, a timeout, a cancel, a kill) can end INSIDE a secret, and the surviving head used to be stored in clear.
 *
 * Every secret here is built at run time from pieces, so no secret-shaped literal exists in this file; every body comes from a fixed-seed generator, so a window of
 * its characters cannot occur by chance in the filler. `P*` tests are the NEGATIVE CONTROLS: they fail on the base. `S*` tests are controls that pass on the
 * base and must stay unchanged.
 */

let seed = 0x2545f491;
const rand = (n: number): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < n; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out += alphabet[(seed >>> 24) % alphabet.length];
  }
  return out;
};
const DASHES = '-----';
const PEM_HEAD = `${DASHES}BEGIN ${'PRIVATE'} KEY${DASHES}`;
const PEM_FOOT = `${DASHES}END ${'PRIVATE'} KEY${DASHES}`;

/** The first `k`-character window of `secret` found in `stored`, or null. */
const leaked = (stored: string, secret: string, k = 6): string | null => {
  for (let i = 0; i + k <= secret.length; i += 1) {
    const window = secret.slice(i, i + k);
    if (stored.includes(window)) return window;
  }
  return null;
};

interface Plan { readonly stream: 'stdout' | 'stderr'; readonly pieces: readonly string[]; readonly gapMs?: number; readonly hang?: boolean }

const run = (plan: Plan, outputLimitBytes: number, timeoutMs = 20_000) => {
  const script = `
    const pieces = JSON.parse(process.env.PIECES);
    const gap = Number(process.env.GAP || 0);
    const out = process.${plan.stream};
    let i = 0;
    const next = () => { if (i < pieces.length) { out.write(pieces[i++]); setTimeout(next, gap); } else if (process.env.HANG === '1') { setInterval(() => {}, 1000); } };
    next();`;
  return runBoundedCommand(
    {
      executable: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env: { ...process.env, PIECES: JSON.stringify(plan.pieces), GAP: String(plan.gapMs ?? 0), HANG: plan.hang === true ? '1' : '0' } as Record<string, string>,
      timeoutMs,
      outputLimitBytes,
    },
    () => new Date().toISOString(),
  );
};

const filler = (bytes: number): string => {
  let text = '';
  let n = 0;
  while (text.length < bytes) { text += `log line ${n}\n`; n += 1; }
  return text.slice(0, bytes);
};

describe('a stream that stopped early never stores the head of a secret it was cut inside', () => {
  it('P1: a vendor-prefixed key cut one character below the shape minimum is not stored', async () => {
    const tail = rand(30);
    const lead = `${filler(30)} key: `;
    const r = await run({ stream: 'stdout', pieces: [`${lead}s${'k'}-${tail}\n`] }, lead.length + 3 + 7);
    expect(r.truncated).toBe(true);
    expect(leaked(r.stdout, tail.slice(0, 7), 5), `stored: ${JSON.stringify(r.stdout.slice(-60))}`).toBeNull();
  });

  it('P2: a source-host token cut at 19 of its 20-character minimum is not stored', async () => {
    const tail = rand(30);
    const lead = `${filler(30)} `;
    const r = await run({ stream: 'stdout', pieces: [`${lead}gh${'p'}_${tail}\n`] }, lead.length + 4 + 19);
    expect(leaked(r.stdout, tail.slice(0, 19), 6), `stored: ${JSON.stringify(r.stdout.slice(-60))}`).toBeNull();
  });

  it('P3: a private key whose END marker is in a DROPPED chunk (past the capture limit) has no body line stored', async () => {
    const body = rand(120);
    const first = `${filler(150)}\n${PEM_HEAD}\n${body}\n`;
    const second = `${rand(40)}\n${PEM_FOOT}\n${filler(700)}`;
    const limit = first.length + 50;
    expect(first.length + second.length).toBeGreaterThan(limit * 2); // the second write is dropped whole
    const r = await run({ stream: 'stdout', pieces: [first, second], gapMs: 150 }, limit);
    expect(r.outputLimitHit).toBe(true);
    expect(leaked(r.stdout, body), `stored: ${JSON.stringify(r.stdout.slice(-120))}`).toBeNull();
    expect(r.redactions).toBeGreaterThanOrEqual(1);
  });

  it('P4: a private key whose END marker is beyond the byte cap has no body line stored (stdout and stderr)', async () => {
    for (const stream of ['stdout', 'stderr'] as const) {
      const body = rand(160);
      const prefix = `${filler(40)}\n${PEM_HEAD}\n`;
      const r = await run({ stream, pieces: [`${prefix}${body}\n${PEM_FOOT}\n`] }, prefix.length + 70);
      expect(leaked(r[stream], body), `${stream}: ${JSON.stringify(r[stream].slice(-100))}`).toBeNull();
    }
  });

  it('P5: a three-segment bearer token cut before its third segment is not stored', async () => {
    const head = `eyJ${rand(20)}`;
    const mid = `eyJ${rand(20)}`;
    const lead = `${filler(30)} `;
    const r = await run({ stream: 'stdout', pieces: [`${lead}${head}.${mid}.${rand(20)}\n`] }, lead.length + head.length + 1 + mid.length);
    expect(leaked(r.stdout, mid, 8), `stored: ${JSON.stringify(r.stdout.slice(-80))}`).toBeNull();
  });

  it('P6: a process killed by its timeout in the middle of a token has that token withheld', async () => {
    const tail = rand(5);
    const r = await run({ stream: 'stdout', pieces: [`${filler(20)}\n`, `s${'k'}-${tail}`], gapMs: 50, hang: true }, 10_000, 600);
    expect(r.timedOut).toBe(true);
    expect(leaked(r.stdout, tail, 5), `stored: ${JSON.stringify(r.stdout.slice(-40))}`).toBeNull();
  });
});

describe('a stream that ended by itself is stored exactly as before', () => {
  it('S1: no cap, no kill: output without a trailing newline is stored verbatim, nothing withheld', async () => {
    const r = await run({ stream: 'stdout', pieces: ['result: ok done'] }, 10_000);
    expect(r.truncated).toBe(false);
    expect(r.stdout).toBe('result: ok done');
    expect(r.redactions).toBe(0);
  });

  it('S2: a secret wholly inside the cap is redacted as before', async () => {
    const body = rand(100);
    const r = await run({ stream: 'stdout', pieces: [`${filler(20)}\n${PEM_HEAD}\n${body}\n${PEM_FOOT}\n${filler(20)}`] }, 10_000);
    expect(leaked(r.stdout, body)).toBeNull();
    expect(r.redactions).toBeGreaterThanOrEqual(1);
  });

  it('S3: the result does not depend on how the bytes are chunked: a secret split across three writes is redacted', async () => {
    const body = rand(100);
    const whole = `${filler(20)}\n${PEM_HEAD}\n${body}\n${PEM_FOOT}\n`;
    const a = Math.floor(whole.length / 3);
    const r = await run({ stream: 'stdout', pieces: [whole.slice(0, a), whole.slice(a, 2 * a), whole.slice(2 * a)], gapMs: 30 }, 10_000);
    expect(leaked(r.stdout, body)).toBeNull();
    const token = `s${'k'}-${rand(30)}`;
    const t = await run({ stream: 'stdout', pieces: [token.slice(0, 5), token.slice(5, 12), token.slice(12)], gapMs: 30 }, 10_000);
    expect(leaked(t.stdout, token.slice(3), 6)).toBeNull();
  });

  it('S4: multi-byte text around a secret does not stop it being redacted', async () => {
    const token = `s${'k'}-${rand(30)}`;
    const r = await run({ stream: 'stdout', pieces: [`${'\u{1F600}é€'.repeat(5)} ${token} ${'日本語'.repeat(4)}\n`] }, 10_000);
    expect(leaked(r.stdout, token.slice(3), 6)).toBeNull();
  });

  it('S5: ordinary output cut by the cap keeps its text up to the last whole token, then the standard truncation line', async () => {
    const text = filler(400);
    const r = await run({ stream: 'stdout', pieces: [text] }, 200);
    expect(r.truncated).toBe(true);
    expect(r.stdout.startsWith(text.slice(0, 180))).toBe(true);
    expect(r.stdout.endsWith('\n[TRUNCATED: output limit reached]')).toBe(true);
  });
});
