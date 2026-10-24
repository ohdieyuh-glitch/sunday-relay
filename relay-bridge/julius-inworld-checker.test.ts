import { execFile } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { createInworldFrozenChecker, INWORLD_PIN_FILES, J1_PINNED_CHECKER_SHA256, J1_PINNED_CONTRACT_SHA256, pinInworldFiles, readInworldCheckerPin } from './julius-inworld-checker';
import type { FrozenCheckerRun } from './julius-frozen-checker';

const MISSION = resolve(__dirname, 'julius-inworld-mission', 'julius-inworld-data-1');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

type Doc = {
  schema: string;
  records: Array<Record<string, string | number>>;
  rejects: Array<Record<string, string | number>>;
  totals: { by_post: Array<Record<string, string | number>>; grand_total_cc: number };
  counts: Record<string, number>;
  [k: string]: unknown;
};

const loadCheck = async (): Promise<{ checkArtifact(t: string): { pass: boolean; output: string; failed: string[] }; expectedDocument(): Doc }> =>
  (await import(resolve(MISSION, 'checker', 'check.mjs'))) as never;

const mutate = async (fn: (d: Doc) => void): Promise<string> => {
  const { expectedDocument } = await loadCheck();
  const d = structuredClone(expectedDocument());
  fn(d);
  return JSON.stringify(d);
};

describe('julius-inworld-data-1 hidden checker', () => {
  it('passes the reference document, and only as one compact line', async () => {
    const { checkArtifact, expectedDocument } = await loadCheck();
    const text = JSON.stringify(expectedDocument());
    expect(text.length).toBeLessThan(8000);
    expect(checkArtifact(text)).toMatchObject({ pass: true, output: 'pass' });
    expect(checkArtifact(JSON.stringify(expectedDocument(), null, 2)).failed).toContain('not_a_single_compact_line');
  });

  it('anchors a few values to hand arithmetic, independent of the oracle code', async () => {
    const { expectedDocument } = await loadCheck();
    const d = expectedDocument();
    const rec = (id: string): Record<string, string | number> => d.records.find((r) => r.txn_id === id) as Record<string, string | number>;
    expect(rec('TP-1004')).toMatchObject({ unit_price_cc: 101, ts: '2026-03-05T07:00:00Z' }); // 1.005 half-up; +02:00 -> 07:00Z; ties go to the later line
    expect(rec('TP-1008').unit_price_cc).toBe(300100); // 3,000.999 -> 3001.00
    expect(rec('TP-1010')).toMatchObject({ unit_price_cc: 99, ts: '2026-03-08T17:00:00Z', status: 'void' }); // 0.994 -> 0.99; -05:00 -> 17:00Z
    expect(rec('TP-1022').ts).toBe('2027-01-01T00:59:59Z'); // year rollover
    expect(rec('TP-1025').qty).toBe(3); // exact tie: later line wins
    expect(rec('TP-1003').ts).toBe('2026-03-04T16:00:00Z'); // epoch 1772640000; the later bad_ts duplicate does not supersede it
    expect(d.counts).toEqual({ input_rows: 29, records: 15, rejects: 14 });
  });

  const wrong: Array<[string, (d: Doc) => void, string]> = [
    ['half-up rounding missed (float-style 1.005 -> 100)', (d) => { const r = d.records.find((x) => x.txn_id === 'TP-1004')!; r.unit_price_cc = 100; r.line_total_cc = 100; }, 'records'],
    ['offset ignored', (d) => { d.records.find((x) => x.txn_id === 'TP-1010')!.ts = '2026-03-08T12:00:00Z'; }, 'records'],
    ['tie broken toward the earlier line', (d) => { d.records.find((x) => x.txn_id === 'TP-1025')!.qty = 2; }, 'records'],
    ['an invalid duplicate superseded a valid row', (d) => { d.records = d.records.filter((x) => x.txn_id !== 'TP-1003'); }, 'records'],
    ['records unsorted', (d) => { d.records.reverse(); }, 'records'],
    ['a reject missing', (d) => { d.rejects.pop(); }, 'rejects'],
    ['a reject with the wrong reason', (d) => { d.rejects[0]!.reason = 'bad_ts'; }, 'rejects'],
    ['wrong grand total', (d) => { d.totals.grand_total_cc += 1; }, 'totals'],
    ['void counted as settled', (d) => { d.totals.by_post[1]!.settled_total_cc = Number(d.totals.by_post[1]!.settled_total_cc) + 250000; }, 'totals'],
    ['wrong counts', (d) => { d.counts.records = 16; }, 'counts'],
    ['wrong schema string', (d) => { d.schema = 'inworld-ledger.v2'; }, 'schema'],
    ['extra top-level key', (d) => { d.note = 'x'; }, 'top_level_keys'],
  ];
  for (const [label, fn, section] of wrong) {
    it(`refuses: ${label}`, async () => {
      const { checkArtifact } = await loadCheck();
      const result = checkArtifact(await mutate(fn));
      expect(result.pass).toBe(false);
      expect(result.failed).toContain(section);
    });
  }

  it('pins the tightened contract rules with unit inputs (parsers imported from the oracle)', async () => {
    const o = (await import(resolve(MISSION, 'checker', 'oracle.mjs'))) as {
      parseQty(s: string): number | null; parsePrice(s: string): number | null; parseTs(s: string): string | null;
      normalize(csv: string, posts: unknown[]): Doc;
    };
    // R4: single U+0020 only, no-space pcs ok, leading zeros decimal
    expect(o.parseQty('12pcs')).toBe(12);
    expect(o.parseQty('12 pcs')).toBe(12);
    expect(o.parseQty('12' + String.fromCharCode(9) + 'pcs')).toBeNull();
    expect(o.parseQty('12  pcs')).toBeNull();
    expect(o.parseQty('x 2')).toBeNull();
    expect(o.parseQty('007')).toBe(7);
    expect(o.parseQty('x03')).toBe(3);
    expect(o.parseQty('00')).toBeNull();
    // R5: zero or one space, leading zeros
    expect(o.parsePrice('12.5cr')).toBe(1250);
    expect(o.parsePrice('12.5  cr')).toBeNull();
    expect(o.parsePrice('007.5 cr')).toBe(750);
    expect(o.parsePrice('0,005 cr')).toBe(500);
    expect(o.parsePrice('12.5' + String.fromCharCode(9) + 'cr')).toBeNull();
    expect(o.parsePrice('12.5' + String.fromCharCode(160) + 'cr')).toBeNull();
    expect(o.parsePrice('0.004 cr')).toBeNull();
    expect(o.parsePrice('0.005 cr')).toBe(1);
    // R6 v2: years are written as given (no two-digit mapping), Gregorian leap years, out-of-range after the offset
    expect(o.parseTs('0050-06-15T12:00:00Z')).toBe('0050-06-15T12:00:00Z');
    expect(o.parseTs('01/01/0050 00:00')).toBe('0050-01-01T00:00:00Z');
    expect(o.parseTs('0000-01-01T00:00:00Z')).toBeNull();
    expect(o.parseTs('0001-01-01T00:00:00+01:00')).toBeNull();
    expect(o.parseTs('9999-12-31T23:59:59-01:00')).toBeNull();
    expect(o.parseTs('1900-02-29T00:00:00Z')).toBeNull();
    expect(o.parseTs('1900-02-28T00:00:00Z')).toBe('1900-02-28T00:00:00Z');
    expect(o.parseTs('2000-02-29T00:00:00Z')).toBe('2000-02-29T00:00:00Z');
    expect(o.parseTs('2100-02-29T00:00:00Z')).toBeNull();
    expect(o.parseTs('2024-02-29T00:00:00Z')).toBe('2024-02-29T00:00:00Z');
    expect(o.parseTs('0004-02-29T00:00:00Z')).toBe('0004-02-29T00:00:00Z');
    expect(o.parseTs('0100-02-29T00:00:00Z')).toBeNull();
    expect(o.parseTs('0000000000')).toBe('1970-01-01T00:00:00Z');
    // R6: offset ranges, seconds, case
    expect(o.parseTs('2026-03-01T00:00:00+23:59')).toBe('2026-02-28T00:01:00Z');
    expect(o.parseTs('2026-03-01T00:00:00-00:00')).toBe('2026-03-01T00:00:00Z');
    expect(o.parseTs('2026-03-01T00:00:00+24:00')).toBeNull();
    expect(o.parseTs('2026-03-01T00:00:00+05:60')).toBeNull();
    expect(o.parseTs('2026-03-01T00:00:60Z')).toBeNull();
    expect(o.parseTs('2026-03-01t00:00:00Z')).toBeNull();
    expect(o.parseTs('2026-03-01T00:00:00z')).toBeNull();
    // v4: ASCII-only folding, safe-integer limits, product limit order, whitespace-only line
    const posts4 = [{ id: 'dock', name: 'Dock', aliases: ['pier'] }];
    const rowOf = (id: string, post: string, qty: string, price: string, ts = '2026-01-01T00:00:00Z') => `${id},${post},item,${qty},${price},${ts},ok`;
    const run4 = (...rows: string[]) => o.normalize(['txn_id,post,item,qty,unit_price,ts,status', ...rows].join('\n'), posts4);
    expect(run4(rowOf('ab-0001', 'dock', '1', '1 cr')).records).toHaveLength(1);
    expect(run4(rowOf('ſb-0001', 'dock', '1', '1 cr')).rejects[0].reason).toBe('bad_txn_id');
    expect(run4(rowOf('ab-0001', 'Kock', '1', '1 cr')).rejects[0].reason).toBe('unknown_post');
    expect(run4(rowOf('ab-0001', 'dock', '9007199254740992', '1 cr')).rejects[0].reason).toBe('bad_qty');
    expect(run4(rowOf('ab-0001', 'dock', '9007199254740991', '0.01 cr')).records).toHaveLength(1);
    expect(run4(rowOf('ab-0001', 'dock', '9007199254740991', '0.02 cr')).rejects[0].reason).toBe('bad_qty');
    expect(run4(rowOf('ab-0001', 'dock', '1', '90071992547409.92 cr')).rejects[0].reason).toBe('bad_price');
    expect(run4(rowOf('ab-0001', 'dock', '9007199254740991', '0.02 cr', 'bad')).rejects[0].reason).toBe('bad_qty');
    expect(run4('   ,,,,,,', '', rowOf('ab-0002', 'dock', '1', '1 cr')).rejects).toEqual([{ line_no: 1, txn_id: '', reason: 'bad_txn_id' }]);
    expect(run4(rowOf('ab-0003', 'pier', '1', '1 cr')).records[0].post).toBe('dock');
    // R1/R7: empty item allowed, short rows read missing fields as empty, 'settled' accepted
    const posts = [{ id: 'p1', name: 'One', aliases: [] }];
    const csv = ['h', 'AA-0001,one,,1,1 cr,2026-01-01T00:00:00Z,settled', 'AA-0002,one', ''].join(String.fromCharCode(10));
    const doc = o.normalize(csv, posts);
    expect(doc.records).toHaveLength(1);
    expect(doc.records[0]).toMatchObject({ item: '', status: 'settled' });
    expect(doc.rejects).toEqual([{ line_no: 2, txn_id: 'AA-0002', reason: 'bad_qty' }]);
  });

  it('refuses non-JSON, fenced JSON, arrays, empty and over-long artifacts', async () => {
    const { checkArtifact, expectedDocument } = await loadCheck();
    const good = JSON.stringify(expectedDocument());
    expect(checkArtifact('').pass).toBe(false);
    expect(checkArtifact('here you go: ' + good).output).toBe('not_json');
    expect(checkArtifact('```json\n' + good + '\n```').output).toBe('not_json');
    expect(checkArtifact('[]').output).toBe('not_an_object');
    expect(checkArtifact(good.slice(0, 3000)).output).toBe('not_json');
    expect(checkArtifact(good + ' '.repeat(8000)).failed).toContain('artifact_too_long');
  });

  it('the checker output names sections only, never artifact values', async () => {
    const { checkArtifact } = await loadCheck();
    const text = await mutate((d) => { d.records[0]!.item = 'SECRET-LOOKING-VALUE'; });
    const result = checkArtifact(text);
    expect(result.output).toBe('fail:records');
    expect(result.output).not.toContain('SECRET');
  });

  it('the visible shape test accepts the reference document and rejects a malformed one', async () => {
    const { expectedDocument } = await loadCheck();
    const run = (doc: unknown): boolean => {
      const dir = mkdtempSync(join(tmpdir(), 'inworld-shape-'));
      dirs.push(dir);
      mkdirSync(join(dir, 'out'));
      cpSync(join(MISSION, 'seed', 'format.test.mjs'), join(dir, 'format.test.mjs'));
      writeFileSync(join(dir, 'out', 'normalized.json'), JSON.stringify(doc));
      try { execFileSync(process.execPath, ['--test', 'format.test.mjs'], { cwd: dir, stdio: 'pipe' }); return true; } catch { return false; }
    };
    expect(run(expectedDocument())).toBe(true);
    const bad = expectedDocument();
    bad.counts.rejects = 0;
    expect(run(bad)).toBe(false);
  });

  it('refuses internal whitespace, a decimal spelling such as 1250.0, and a duplicate key that JSON.parse would accept', async () => {
    const { checkArtifact, expectedDocument } = await loadCheck();
    const good = JSON.stringify(expectedDocument());
    expect(checkArtifact(good)).toMatchObject({ pass: true, output: 'pass' });
    const spaced = good.replace('":"', '": "');
    expect(JSON.parse(spaced)).toEqual(JSON.parse(good));
    expect(checkArtifact(spaced).failed).toContain('whitespace');
    expect(checkArtifact(spaced).pass).toBe(false);
    const decimal = good.replace(/:1250(?=[,}\]])/, ':1250.0');
    expect(decimal).not.toBe(good);
    expect(JSON.stringify(JSON.parse(decimal))).toBe(good);
    const decimalResult = checkArtifact(decimal);
    expect(decimalResult.pass).toBe(false);
    expect(decimalResult.failed).toContain('noncanonical_number');
    expect(decimalResult.output).toBe('noncanonical_number');
    const duplicated = good.replace('{', '{"schema":"inworld-ledger.v1",');
    expect(JSON.parse(duplicated).schema).toBe('inworld-ledger.v1');
    expect(JSON.stringify(JSON.parse(duplicated))).toBe(good);
    const dupResult = checkArtifact(duplicated);
    expect(dupResult.pass).toBe(false);
    expect(dupResult.failed).toContain('duplicate_key');
  });

  it('pins contract.json with the checker bytes, and the pin is a fresh read rather than a hash taken before import', () => {
    const entries = INWORLD_PIN_FILES.map((name) => [name, readFileSync(join(MISSION, name))] as const);
    expect(INWORLD_PIN_FILES).toContain('contract.json');
    const combined = pinInworldFiles(entries);
    const withoutContract = pinInworldFiles(entries.filter(([name]) => name !== 'contract.json'));
    expect(combined).not.toBe(withoutContract);
    expect(readInworldCheckerPin(MISSION)).toBe(combined);
    expect(J1_PINNED_CHECKER_SHA256).toBe(combined);
    expect(J1_PINNED_CONTRACT_SHA256).toBe(createHash('sha256').update(readFileSync(join(MISSION, 'contract.json'))).digest('hex'));
    const source = readFileSync(resolve(__dirname, 'julius-inworld-checker.ts'), 'utf8');
    expect(source).not.toContain('createInworldHiddenChecker');
    expect(source).not.toMatch(/import\s*\(/);
    expect(source).not.toContain('pathToFileURL');
    const vite = readFileSync(resolve(__dirname, '../vite.config.mts'), 'utf8');
    expect(vite).toContain('relay-bridge/julius-inworld-mission/**/format.test.mjs');
    expect(vite).not.toContain("'relay-bridge/julius-inworld-mission/**'");
  });

  it('grades through createFrozenReviewerChecker, re-reads on every check, and refuses 1250.0 from the staged bytes', async () => {
    const { expectedDocument } = await loadCheck();
    const good = JSON.stringify(expectedDocument());
    let reads = 0;
    const checker = createInworldFrozenChecker(MISSION, {
      checkerSha256: J1_PINNED_CHECKER_SHA256,
      contractSha256: J1_PINNED_CONTRACT_SHA256,
    }, realIo(() => { reads += 1; }));
    expect(reads).toBe(0);
    const passed = await checker.check({ runId: 'run:1', artifactText: good });
    expect(passed.pass).toBe(true);
    expect(passed.output).toContain('PASS');
    const afterFirst = reads;
    expect(afterFirst).toBeGreaterThan(0);
    const decimal = good.replace(/:1250(?=[,}\]])/, ':1250.0');
    const refused = await checker.check({ runId: 'run:1', artifactText: decimal });
    expect(refused.pass).toBe(false);
    expect(refused.output).toContain('noncanonical_number');
    expect(reads).toBeGreaterThan(afterFirst);
    const stale = createInworldFrozenChecker(MISSION, {
      checkerSha256: '0'.repeat(64),
      contractSha256: J1_PINNED_CONTRACT_SHA256,
    }, realIo());
    expect(await stale.check({ runId: 'run:1', artifactText: good })).toEqual({ pass: false, output: 'checker_pin_mismatch' });
  });

  it('a module cache of an always-pass checker is not what grades: the staged bytes are', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inworld-pin-'));
    dirs.push(dir);
    cpSync(MISSION, dir, { recursive: true });
    const checkerPath = join(dir, 'checker', 'check.mjs');
    const original = readFileSync(checkerPath);
    const alwaysPass = [
      "export function checkArtifact() { return { pass: true, output: 'pass', failed: [] }; }",
      "export function expectedDocument() { return { schema: 'x', records: [], rejects: [], totals: { by_post: [], grand_total_cc: 0 }, counts: {} }; }",
    ].join('\n');
    writeFileSync(checkerPath, alwaysPass);
    await import(pathToFileURL(checkerPath).href);
    writeFileSync(checkerPath, original);
    const checker = createInworldFrozenChecker(dir, {
      checkerSha256: J1_PINNED_CHECKER_SHA256,
      contractSha256: J1_PINNED_CONTRACT_SHA256,
    }, realIo());
    const result = await checker.check({ runId: 'run:1', artifactText: '{}' });
    expect(result.pass).toBe(false);
    expect(result.output).not.toBe('pass');
  });
});

function realIo(onRead?: () => void) {
  return {
    nodePath: process.execPath,
    readFileBytes: async (path: string) => { onRead?.(); return readFileSync(path); },
    stage: async (files: readonly { readonly name: string; readonly bytes: Uint8Array }[]) => {
      const dir = mkdtempSync(join(tmpdir(), 'inworld-stage-'));
      dirs.push(dir);
      const paths = files.map((file) => {
        const path = join(dir, file.name);
        writeFileSync(path, file.bytes);
        return path;
      });
      return { paths, cleanup: async () => { rmSync(dir, { recursive: true, force: true }); } };
    },
    readStagedBytes: async (path: string) => readFileSync(path),
    realpath: async (path: string) => realpathSync(path),
    baseEnv: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP },
    writeArtifact: async (text: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'inworld-artifact-'));
      dirs.push(dir);
      const path = join(dir, 'artifact.txt');
      writeFileSync(path, text, 'utf8');
      return { path, cleanup: async () => { rmSync(dir, { recursive: true, force: true }); } };
    },
    run: (command: string, args: readonly string[], env: Readonly<Record<string, string>>): Promise<FrozenCheckerRun> => new Promise((resolvePromise) => {
      execFile(command, [...args], { env: { ...env }, encoding: 'utf8', timeout: 30_000 }, (error, stdout, stderr) => {
        const code = error === null ? 0 : (error as NodeJS.ErrnoException).code;
        resolvePromise({
          exitCode: typeof code === 'number' ? code : null,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
        });
      });
    }),
  };
}
