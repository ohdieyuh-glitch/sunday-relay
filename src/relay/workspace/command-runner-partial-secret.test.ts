import { describe, expect, it } from 'vitest';

import { runBoundedCommand, secureCapturedStream } from './command-runner';

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

interface Plan { readonly stream: 'stdout' | 'stderr'; readonly pieces: readonly string[]; readonly gapMs?: number; readonly hang?: boolean; readonly exitCode?: number }

const run = (plan: Plan, outputLimitBytes: number, timeoutMs = 20_000) => {
  const script = `
    const pieces = JSON.parse(process.env.PIECES);
    const gap = Number(process.env.GAP || 0);
    const out = process.${plan.stream};
    let i = 0;
    const next = () => { if (i < pieces.length) { out.write(pieces[i++]); setTimeout(next, gap); } else if (process.env.HANG === '1') { setInterval(() => {}, 1000); } else if (process.env.EXITCODE) { process.exitCode = Number(process.env.EXITCODE); } };
    next();`;
  return runBoundedCommand(
    {
      executable: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env: { ...process.env, PIECES: JSON.stringify(plan.pieces), GAP: String(plan.gapMs ?? 0), HANG: plan.hang === true ? '1' : '0', EXITCODE: plan.exitCode === undefined ? '' : String(plan.exitCode) } as Record<string, string>,
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

/**
 * THE SWEEP (REVIEW's ruling for the final cut). Every secret shape the sanitizer lists, in several surface forms, embedded in ordinary output; the stream is cut at EVERY byte offset, twice:
 *  - CAP: `secureCapturedStream(stream, k, false)`: the runner's own bound (cut after k bytes, truncation line appended), withhold and sanitize;
 *  - KILL: `secureCapturedStream(stream.slice(0, k), huge, true)`: a stream that stopped early (timeout, cancel, kill) after k bytes.
 * For each cut, no 6-character window of the secret BODY may remain in the stored text. The window is taken over the body only (not over a fixed prefix or the keyword), so a cut that leaves
 * fewer than 6 body characters is allowed to show them. The trailing-partial-token step is exercised by every cut that ends inside a token.
 */
interface Shape { readonly name: string; readonly body: string; readonly secret: string }
const sweepShapes = (): Shape[] => {
  const mk = (name: string, body: string, secret: string): Shape => ({ name, body, secret });
  const pemBody = Array.from({ length: 3 }, () => rand(64)).join('\n');
  const jwtHead = `eyJ${rand(20)}`;
  const jwtPay = `eyJ${rand(30)}`;
  const jwtSig = rand(24);
  const aws = rand(16).toUpperCase().replace(/[^A-Z0-9]/g, 'Q');
  const out: Shape[] = [
    mk('sk- key', rand(40), ''), mk('AKIA key', aws, ''), mk('github token', rand(36), ''), mk('slack token', rand(30), ''),
    mk('jwt', `${jwtHead}.${jwtPay}.${jwtSig}`, ''), mk('pem private key', pemBody, ''),
    mk('password=', rand(20), ''), mk('api_key:', rand(24), ''), mk('secret =', rand(22), ''), mk('TOKEN : ', rand(26), ''), mk('api-key=', rand(18), ''),
    mk('sk-proj- key', `${rand(20)}-${rand(8)}_${rand(24)}`, ''), mk('sk-svcacct- key', `${rand(16)}_${rand(12)}-${rand(20)}`, ''), mk('sk-admin- key', `${rand(14)}-${rand(14)}_${rand(14)}`, ''), mk('sk-ant-api03- key', `${rand(30)}-${rand(10)}_${rand(10)}`, ''),
  ];
  const secrets: Record<string, string> = {
    'sk- key': `sk-${out[0].body}`,
    'AKIA key': `AKIA${out[1].body}`,
    'github token': `ghp_${out[2].body}`,
    'slack token': `xoxb-${out[3].body}`,
    jwt: out[4].body,
    'pem private key': `${PEM_HEAD}\n${pemBody}\n${PEM_FOOT}`,
    'password=': `password=${out[6].body}`,
    'api_key:': `api_key: ${out[7].body}`,
    'secret =': `secret = ${out[8].body}`,
    'TOKEN : ': `TOKEN : ${out[9].body}`,
    'api-key=': `api-key=${out[10].body}`,
    'sk-proj- key': `sk-proj-${out[11].body}`,
    'sk-svcacct- key': `sk-svcacct-${out[12].body}`,
    'sk-admin- key': `sk-admin-${out[13].body}`,
    'sk-ant-api03- key': `sk-ant-api03-${out[14].body}`,
  };
  return out.map((s) => ({ ...s, secret: secrets[s.name] }));
};

const TRAILS: Array<[string, string]> = [['lines', '\nnext line of output\ndone.\n'], ['none', ''], ['space', ' '], ['comma-word', ', and more']];
const surround = (secret: string, lead: string, trail: string): string => `${lead}${secret}${trail}`;
const LEADS: Array<[string, string]> = [['plain', 'ok line one\nstep two done '], ['multibyte', 'caf\u00e9 \u2713 ok line\nstep two done '], ['stream-start', ''], ['after-newline', 'a line\n']];

/**
 * THE STRUCTURED PEM SWEEP (third cut). Several private key blocks in ONE stream, in every combination of: complete (dashed footer), incomplete (no footer), a BARE footer phrase, a footer CUT inside its
 * dashes, a header phrase INSIDE a body; five key kinds; LF and CRLF line ends. Every strict cut offset, by the byte cap and by a kill (a kill may also come after the last byte). Oracle: no 6-character window
 * of ANY body line is stored (the headers, footers and the phrase inside a body are not secrets). The cap is only judged for strict cuts (a stream the cap did not cut ended by itself and is stored as before).
 */
type Footer = 'full' | 'bare' | 'cut' | 'none';
interface Piece { readonly footer: Footer; readonly inner?: boolean }
const KINDS = ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'OPENSSH PRIVATE KEY', 'ENCRYPTED PRIVATE KEY'];
const P = (footer: Footer, inner = false): Piece => ({ footer, inner });
const STRUCTURES: Array<[string, Piece[]]> = [
  ['incomplete+incomplete', [P('none'), P('none')]],
  ['complete+incomplete', [P('full'), P('none')]],
  ['incomplete+complete', [P('none'), P('full')]],
  ['complete+complete+incomplete', [P('full'), P('full'), P('none')]],
  ['incomplete+complete+incomplete', [P('none'), P('full'), P('none')]],
  ['complete+incomplete+complete', [P('full'), P('none'), P('full')]],
  ['three incomplete', [P('none'), P('none'), P('none')]],
  ['incomplete+incomplete+complete', [P('none'), P('none'), P('full')]],
  ['bare footer between headers', [P('bare'), P('none')]],
  ['cut footer between headers', [P('cut'), P('none')]],
  ['bare footer then complete', [P('bare'), P('full')]],
  ['cut footer then complete', [P('cut'), P('full')]],
  ['incomplete+bare+incomplete', [P('none'), P('bare'), P('none')]],
  ['complete+bare+incomplete', [P('full'), P('bare'), P('none')]],
  ['incomplete+cut+complete', [P('none'), P('cut'), P('full')]],
  ['single complete', [P('full')]],
  ['single incomplete', [P('none')]],
  ['single bare footer', [P('bare')]],
  ['single cut footer', [P('cut')]],
  ['phrase inside body, incomplete+incomplete', [P('none', true), P('none')]],
  ['phrase inside body, complete+incomplete', [P('full', true), P('none')]],
  ['phrase inside body, incomplete+complete', [P('none', true), P('full')]],
  ['phrase inside body, incomplete (second)', [P('full'), P('none', true)]],
];

const buildPem = (pieces: Piece[], eol: string, kindShift: number, joiner: string = eol): { stream: string; secrets: string[] } => {
  const secrets: string[] = [];
  const parts: string[] = [];
  pieces.forEach((piece, i) => {
    const kind = KINDS[(i + kindShift) % KINDS.length];
    const lines = [rand(64), piece.inner === true ? 'inner' : rand(64), rand(64)];
    const bodyLines = lines.map((line) => {
      if (line !== 'inner') { secrets.push(line); return line; }
      const a = rand(24);
      const b = rand(24);
      secrets.push(a, b);
      return `${a} BEGIN ${'PRIVATE'} KEY ${b}`;
    });
    const footer = piece.footer === 'full' ? `${DASHES}END ${kind}${DASHES}` : piece.footer === 'bare' ? `END ${kind}` : piece.footer === 'cut' ? `${DASHES}END ${kind}--` : '';
    parts.push([`${DASHES}BEGIN ${kind}${DASHES}`, ...bodyLines, ...(footer === '' ? [] : [footer])].join(eol));
  });
  // a joiner other than the line end glues a block's last byte to the next header (`cat a.pem b.pem` when a.pem lacks a final newline); a CUT footer glued to a header would merge dashes into a
  // shape the sanitizer cannot read even on an uncut stream, so those joins keep the line end
  const glued = parts.map((_part, i) => (i < parts.length - 1 && pieces[i].footer !== 'cut' ? joiner : eol));
  const body = parts.map((part, i) => `${part}${i < parts.length - 1 ? glued[i] : ''}`).join('');
  return { stream: `build output${eol}${body}${eol}done${eol}`, secrets };
};

/** The first 6-character window of any secret found in `stored`, or null. The secrets' windows are built once per secrets array (a WeakMap), then ONE pass over the stored text looks each window up. */
const windowCache = new WeakMap<string[], Set<string>>();
const leakedAny = (stored: string, secrets: string[], size = 6): string | null => {
  let windows = windowCache.get(secrets);
  if (windows === undefined) {
    windows = new Set<string>();
    for (const secret of secrets) for (let a = 0; a + size <= secret.length; a += 1) windows.add(secret.slice(a, a + size));
    windowCache.set(secrets, windows);
  }
  for (let a = 0; a + size <= stored.length; a += 1) { const w = stored.slice(a, a + size); if (windows.has(w)) return w; }
  return null;
};

/**
 * ADVERSARIAL FUZZ (my own pass for the third cut). A seeded grammar: 1-5 fragments joined by random separators (including NONE and odd whitespace). A fragment is a vendor token, a keyword secret, a JWT, one or
 * more PEM blocks (random footer kind, key kind, CRLF or LF) or ordinary text. A random cut, by the cap or by a kill. The oracle is the sweep's: no 6-character window of any secret body stored.
 */
describe('ADVERSARIAL FUZZ: random mixes of every shape, odd whitespace, random separators, random cuts', () => {
  it('no 6-character window of any secret body is stored (seeded, 40,000 streams, cap and kill)', () => {
    let state = 0x9e3779b9;
    const next = (n: number): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 8) % n; };
    const pick = <T,>(items: readonly T[]): T => items[next(items.length)];
    const SEPARATORS = [' ', '\n', '\r\n', '\t', '  ', ', ', ': ', '\n\n', '"', '(', '='];
    const WORDS = ['build', 'ok', 'step', 'done', 'line', 'END', 'BEGIN', 'KEY', 'PRIVATE', 'error:', 'x=1', '--', '-----'];
    const text = (): string => Array.from({ length: 1 + next(5) }, () => pick(WORDS)).join(pick([' ', '  ', '\t', '\n', '\r\n']));
    const alnum = (n: number): string => { const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let o = ''; for (let i = 0; i < n; i += 1) o += a[next(a.length)]; return o; };
    const fragment = (secrets: string[]): string => {
      switch (next(9)) {
        case 0: { const b = alnum(8 + next(40)); secrets.push(b); return `sk-${b}`; }
        case 1: { const b = alnum(12 + next(20)).toUpperCase(); secrets.push(b); return `AKIA${b}`; }
        case 2: { const b = alnum(20 + next(30)); secrets.push(b); return `gh${pick(['p', 'o', 'u', 's', 'r'])}_${b}`; }
        case 3: { const b = alnum(10 + next(30)); secrets.push(b); return `xox${pick(['b', 'a', 'p', 'r', 's'])}-${b}`; }
        case 4: { const h = alnum(12 + next(20)); const p = alnum(12 + next(20)); const g = alnum(6 + next(20)); secrets.push(h, p, g); return `eyJ${h}.eyJ${p}.${g}`; }
        case 5: { const b = alnum(8 + next(30)); secrets.push(b); return ` ${pick(['password', 'secret', 'token', 'api_key', 'api-key', 'apikey', 'PASSWORD', 'Token'])}${pick(['=', ':', ' = ', ': ', ' :'])}${b}`; }
        case 6: case 7: {
          const eol = pick(['\n', '\r\n']);
          return Array.from({ length: 1 + next(3) }, () => {
            const kind = pick(KINDS);
            const lines = Array.from({ length: 1 + next(3) }, () => alnum(30 + next(40)));
            secrets.push(...lines);
            const footer = pick(['full', 'full', 'bare', 'cut', 'none']);
            const foot = footer === 'full' ? `${DASHES}END ${kind}${DASHES}` : footer === 'bare' ? `END ${kind}` : footer === 'cut' ? `${DASHES}END ${kind}${'-'.repeat(next(5))}${eol}` : '';
            return [`${DASHES}BEGIN ${kind}${DASHES}`, ...lines, ...(foot === '' ? [] : [foot])].join(eol);
          }).join(pick([eol, `${eol}${eol}`, '']));
        }
        default: return text();
      }
    };
    const failures: string[] = [];
    let streams = 0;
    for (let i = 0; i < 40_000; i += 1) {
      const secrets: string[] = [];
      const stream = Array.from({ length: 1 + next(5) }, () => fragment(secrets)).join(pick(SEPARATORS));
      streams += 1;
      const k = next(stream.length + 1);
      if (k < stream.length) {
        const cap = secureCapturedStream(stream, k, false);
        const capLeak = leakedAny(cap.text, secrets);
        if (capLeak !== null) failures.push(`CAP k=${k}: ${JSON.stringify(capLeak)} stream ${JSON.stringify(stream)} STORED ${JSON.stringify(cap.text)}`);
      }
      const kill = secureCapturedStream(stream.slice(0, k), 1_000_000, true);
      const killLeak = leakedAny(kill.text, secrets);
      if (killLeak !== null) failures.push(`KILL k=${k}: ${JSON.stringify(killLeak)} stream ${JSON.stringify(stream.slice(0, 200))}`);
    }
    // eslint-disable-next-line no-console
    console.log(`FUZZ: ${streams} streams, ${failures.length} leak(s)`);
    expect(failures.slice(0, 6), `${failures.length} leak(s); first ones`).toEqual([]);
  });
});

/**
 * TWO KEYS, NO NEWLINE BETWEEN THEM (`cat a.pem b.pem` when a.pem lacks a final newline): both orders, RSA then EC and EC then RSA, glued with nothing, with five dashes, and (controls) with a line end, a space and an 'x'.
 * Every strict cut by the cap and every cut by a kill, with the second block cut or whole.
 */
describe('TWO KEYS glued without a newline: both orders, every separator, every cut', () => {
  it('no 6-character window of either body is stored', () => {
    const failures: string[] = [];
    let cuts = 0;
    for (const [first, second] of [['RSA PRIVATE KEY', 'EC PRIVATE KEY'], ['EC PRIVATE KEY', 'RSA PRIVATE KEY']] as const) {
      for (const sep of ['', '-----', '\n', '\r\n', ' ', 'x']) {
        const bodyA = [rand(64), rand(64)];
        const bodyB = [rand(64), rand(64)];
        const block = (kind: string, body: string[]): string => [`${DASHES}BEGIN ${kind}${DASHES}`, ...body, `${DASHES}END ${kind}${DASHES}`].join('\n');
        const stream = `${block(first, bodyA)}${sep}${block(second, bodyB)}${sep === '' || sep === '-----' ? '\n' : ''}`;
        const secrets = [...bodyA, ...bodyB];
        for (let k = 0; k <= stream.length; k += 1) {
          cuts += 2;
          const cap = secureCapturedStream(stream, k, false);
          if (leakedAny(cap.text, secrets) !== null) failures.push(`CAP  ${first}+${second} sep=${JSON.stringify(sep)} k=${k}`);
          const kill = secureCapturedStream(stream.slice(0, k), 1_000_000, true);
          if (leakedAny(kill.text, secrets) !== null) failures.push(`KILL ${first}+${second} sep=${JSON.stringify(sep)} k=${k}`);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`TWO KEYS: ${cuts} cuts, ${failures.length} leak(s)`);
    expect(failures.slice(0, 8), `${failures.length} leak(s); first ones`).toEqual([]);
  });
});

describe('a stream that ENDS BY ITSELF is not exempt from the unterminated-key rule (REVIEW, finding 2a)', () => {
  it('P10: exit 0 after a partial private key (a BEGIN header and body, no footer, e.g. `head -c 500 key.pem`): the body is not stored', async () => {
    const body = Array.from({ length: 4 }, () => rand(64)).join('\n');
    const r = await run({ stream: 'stdout', pieces: [`before\n${PEM_HEAD}\n${body}`] }, 100_000);
    expect(r.exitCode).toBe(0);
    expect(r.signal).toBeNull();
    expect(leaked(r.stdout, body), `stored: ${JSON.stringify(r.stdout.slice(-100))}`).toBeNull();
    expect(r.stdout).toContain('before');
  });

  it('P11: a NON-ZERO exit with no signal (a crash) after a partial private key: the body is not stored (stderr too)', async () => {
    for (const stream of ['stdout', 'stderr'] as const) {
      const body = Array.from({ length: 4 }, () => rand(64)).join('\n');
      const r = await run({ stream, pieces: [`${PEM_HEAD}\n${body}\nmore log lines`], exitCode: 3 }, 100_000);
      expect(r.exitCode).toBe(3);
      expect(r.signal).toBeNull();
      expect(leaked(r[stream], body), `${stream} stored: ${JSON.stringify(r[stream].slice(-100))}`).toBeNull();
    }
  });

  it('S7: a COMPLETE private key in a stream that ended by itself is unchanged: fully redacted, the text after it kept', async () => {
    const body = Array.from({ length: 4 }, () => rand(64)).join('\n');
    const r = await run({ stream: 'stdout', pieces: [`${PEM_HEAD}\n${body}\n${PEM_FOOT}\nafter the key\n`] }, 100_000);
    expect(leaked(r.stdout, body)).toBeNull();
    expect(r.stdout).toContain('after the key');
    expect(r.stdout).toContain('[REDACTED:secret-shape]');
  });

  it('S8: the trailing-partial-token step stays for early-stopped streams only: an \'ok\' with no trailing newline in a stream that ended by itself is stored verbatim', async () => {
    const r = await run({ stream: 'stdout', pieces: ['line one\nok'] }, 100_000);
    expect(r.stdout).toBe('line one\nok');
  });
});

describe('PEM SWEEP: several key blocks in one stream, every structure x kind rotation x line end, every cut incl. the uncut stream, cap and kill', () => {
  it('no 6-character window of any body line is stored', () => {
    const t0 = Date.now();
    const failures: string[] = [];
    const byStructure: string[] = [];
    let cuts = 0;
    for (const [name, pieces] of STRUCTURES) {
      let n = 0;
      for (const [eolName, eol] of [['LF', '\n'], ['CRLF', '\r\n']] as const) {
        for (const [shift, joinerName, joiner] of [[0, 'eol', eol], [2, 'eol', eol], [0, 'none', ''], [1, 'dashes', '-----']] as const) {
          if (pieces.length < 2 && joinerName !== 'eol') continue;
          const { stream, secrets } = buildPem(pieces, eol, shift, joiner);
          for (let k = 0; k <= stream.length; k += 1) {
            {
              n += 1;
              // k === stream.length is a stream that ENDED BY ITSELF (not cut): the unterminated-key rule applies to it too
              const cap = secureCapturedStream(stream, k, false);
              const capLeak = leakedAny(cap.text, secrets);
              if (capLeak !== null) failures.push(`CAP  ${name}/${eolName}/${joinerName}/shift${shift} k=${k}: ${JSON.stringify(capLeak)} tail ${JSON.stringify(cap.text.slice(-60))}`);
            }
            n += 1;
            const kill = secureCapturedStream(stream.slice(0, k), 1_000_000, true);
            const killLeak = leakedAny(kill.text, secrets);
            if (killLeak !== null) failures.push(`KILL ${name}/${eolName}/${joinerName}/shift${shift} k=${k}: ${JSON.stringify(killLeak)} tail ${JSON.stringify(kill.text.slice(-60))}`);
          }
        }
      }
      cuts += n;
      byStructure.push(`${name.padEnd(46)} ${String(n).padStart(6)} cuts (LF+CRLF, kind rotations, joiners: line end / none / 5 dashes, cap + kill)`);
    }
    // eslint-disable-next-line no-console
    console.log(`PEM SWEEP coverage (${cuts} cuts in ${Date.now() - t0} ms):\n${byStructure.join('\n')}`);
    const by: Record<string, number> = {};
    for (const f of failures) { const key = f.split(' k=')[0].replace(/\/(LF|CRLF)\/[a-z]+\/shift\d/, ''); by[key] = (by[key] ?? 0) + 1; }
    // eslint-disable-next-line no-console
    console.log(`PEM SWEEP LEAKS BY STRUCTURE AND CUT KIND (${failures.length}): ${JSON.stringify(by)}`);
    expect(failures.slice(0, 10), `${failures.length} leak(s); first ones`).toEqual([]);
  });

  it('the PEM sweep can fail: against a runner that withholds only from the LAST header, it finds the multi-header leak (self-test of the control)', () => {
    let leaks = 0;
    for (const [, pieces] of STRUCTURES.slice(0, 3)) {
      const { stream, secrets } = buildPem(pieces, '\n', 0);
      for (let k = 1; k < stream.length; k += 1) {
        const text = stream.slice(0, k);
        const begins = [...text.matchAll(/BEGIN [A-Z ]*PRIVATE KEY/g)];
        const last = begins[begins.length - 1];
        const naive = last?.index !== undefined && !/-----END [A-Z ]*PRIVATE KEY-----/.test(text.slice(last.index)) ? `${text.slice(0, last.index)}[REDACTED:secret-shape]` : text;
        if (leakedAny(naive.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[R]').replace(/BEGIN [A-Z ]*PRIVATE KEY/g, '[R]'), secrets) !== null) leaks += 1;
      }
    }
    expect(leaks).toBeGreaterThan(20);
  });
});

describe('SWEEP: every secret shape, cut at every byte offset, by the byte cap and by a kill', () => {
  it('no 6-character window of any secret body is stored, for any shape, any cut kind, any offset', () => {
    const t0 = Date.now();
    const failures: string[] = [];
    let cuts = 0;
    const table: string[] = [];
    for (const shape of sweepShapes()) {
      for (const [leadName, lead] of LEADS) for (const [trailName, trail] of TRAILS) {
        const stream = surround(shape.secret, lead, trail);
        let capCuts = 0;
        let killCuts = 0;
        for (let k = 0; k <= stream.length; k += 1) {
          const cap = secureCapturedStream(stream, k, false);
          capCuts += 1;
          const capLeak = leaked(cap.text, shape.body);
          if (capLeak !== null) failures.push(`CAP  ${shape.name}/${leadName}/${trailName} k=${k}: window ${JSON.stringify(capLeak)}  stored tail ${JSON.stringify(cap.text.slice(-70))}`);
          const kill = secureCapturedStream(stream.slice(0, k), 1_000_000, true);
          killCuts += 1;
          const killLeak = leaked(kill.text, shape.body);
          if (killLeak !== null) failures.push(`KILL ${shape.name}/${leadName}/${trailName} k=${k}: window ${JSON.stringify(killLeak)}  stored tail ${JSON.stringify(kill.text.slice(-70))}`);
        }
        cuts += capCuts + killCuts;
        table.push(`${shape.name.padEnd(16)} ${leadName.padEnd(13)} ${trailName.padEnd(10)} stream ${String(stream.length).padStart(3)} chars   cap offsets 0..${stream.length} (${capCuts})   kill offsets 0..${stream.length} (${killCuts})`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`SWEEP coverage (${cuts} cuts in ${Date.now() - t0} ms):\n${table.join('\n')}`);
    expect(failures.slice(0, 12), `${failures.length} leak(s); first ones`).toEqual([]);
  });

  it('the sweep can fail: against a runner that stores the stream with no withholding at all, it finds leaks (self-test of the control)', () => {
    let leaks = 0;
    for (const shape of sweepShapes()) {
      const stream = surround(shape.secret, LEADS[0][1], TRAILS[0][1]);
      for (let k = 0; k <= stream.length; k += 1) {
        // a naive store: bound, then sanitize, no withholding
        const bounded = stream.slice(0, k);
        const sanitized = bounded.replace(/\bsk-[A-Za-z0-9]{8,}/g, '[R]');
        if (leaked(sanitized, shape.body) !== null) leaks += 1;
      }
    }
    expect(leaks).toBeGreaterThan(50);
  });
});

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

  it('P7: a BARE end phrase (no dashes) after a private key header does not close the block: no body line is stored when the stream is cut by the byte cap', async () => {
    const body = Array.from({ length: 6 }, () => rand(64)).join('\n');
    const prefix = `${filler(40)}\n${PEM_HEAD}\n`;
    const bare = `END ${'PRIVATE'} KEY`;
    const r = await run({ stream: 'stdout', pieces: [`${prefix}${body}\n${bare}\n${filler(400)}`] }, prefix.length + body.length + bare.length + 12);
    expect(r.truncated).toBe(true);
    expect(leaked(r.stdout, body), `stored: ${JSON.stringify(r.stdout.slice(-120))}`).toBeNull();
  });

  it('P8: a dashed footer CUT inside its closing dashes does not close the block either (cap)', async () => {
    const body = Array.from({ length: 6 }, () => rand(64)).join('\n');
    const prefix = `${filler(40)}\n${PEM_HEAD}\n`;
    const cutFoot = `${DASHES}END ${'PRIVATE'} KEY--`;
    const r = await run({ stream: 'stdout', pieces: [`${prefix}${body}\n${cutFoot}\n${filler(400)}`] }, prefix.length + body.length + 1 + cutFoot.length);
    expect(r.truncated).toBe(true);
    expect(leaked(r.stdout, body), `stored: ${JSON.stringify(r.stdout.slice(-120))}`).toBeNull();
  });

  it('P9: a process killed by its timeout after a bare end phrase has the key body withheld too', async () => {
    const body = Array.from({ length: 6 }, () => rand(64)).join('\n');
    const r = await run({ stream: 'stdout', pieces: [`${PEM_HEAD}\n${body}\nEND ${'PRIVATE'} KEY`], hang: true }, 100_000, 1_500);
    expect(r.timedOut).toBe(true);
    expect(leaked(r.stdout, body), `stored: ${JSON.stringify(r.stdout.slice(-120))}`).toBeNull();
  });

  it('S6: a COMPLETE dashed footer still closes the block: a stream that stopped early after a whole key block keeps its redaction and nothing more is withheld than before', async () => {
    const body = Array.from({ length: 4 }, () => rand(64)).join('\n');
    const r = await run({ stream: 'stdout', pieces: [`${PEM_HEAD}\n${body}\n${PEM_FOOT}\nafter the key\n`], hang: true }, 100_000, 1_500);
    expect(r.timedOut).toBe(true);
    expect(leaked(r.stdout, body)).toBeNull();
    expect(r.stdout).toContain('after the key');
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
