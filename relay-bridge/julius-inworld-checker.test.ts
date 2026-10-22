import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createInworldHiddenChecker, inworldCheckerPin } from './julius-inworld-checker';

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

  it('the adapter grades through the pinned checker and refuses a pin mismatch', async () => {
    const { expectedDocument } = await loadCheck();
    const good = JSON.stringify(expectedDocument());
    const pin = inworldCheckerPin(MISSION);
    expect(pin).toMatch(/^[0-9a-f]{64}$/);
    const ok = createInworldHiddenChecker(MISSION, { checkerSha256: pin });
    expect(await ok.check({ runId: 'run:1', artifactText: good })).toEqual({ pass: true, output: 'pass' });
    expect((await ok.check({ runId: 'run:1', artifactText: '{}' })).pass).toBe(false);
    const stale = createInworldHiddenChecker(MISSION, { checkerSha256: '0'.repeat(64) });
    expect(await stale.check({ runId: 'run:1', artifactText: good })).toEqual({ pass: false, output: 'checker_pin_mismatch' });
  });
});
