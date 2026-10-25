// VISIBLE SHAPE CHECK (in the coder's workspace). It checks the SHAPE of out/normalized.json only: keys, types, sort order, and that
// the counts add up. It does NOT check any value against the rules in contract.json: passing it is necessary, not sufficient.
// Run: node --test format.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const doc = JSON.parse(readFileSync(new URL('./out/normalized.json', import.meta.url), 'utf8'));
const isInt = (v) => Number.isSafeInteger(v);

test('top level', () => {
  assert.deepEqual(Object.keys(doc).sort(), ['counts', 'records', 'rejects', 'schema', 'totals']);
  assert.equal(doc.schema, 'inworld-ledger.v1');
});

test('records', () => {
  assert.ok(Array.isArray(doc.records));
  for (const r of doc.records) {
    assert.deepEqual(Object.keys(r).sort(), ['item', 'line_total_cc', 'post', 'qty', 'status', 'ts', 'txn_id', 'unit_price_cc']);
    assert.match(r.txn_id, /^[A-Z]{2}-\d{4}$/);
    assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(['settled', 'void', 'pending'].includes(r.status));
    assert.ok(isInt(r.qty) && isInt(r.unit_price_cc) && isInt(r.line_total_cc));
    assert.equal(r.line_total_cc, r.qty * r.unit_price_cc);
  }
  const keys = doc.records.map((r) => `${r.ts}|${r.txn_id}`);
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(new Set(doc.records.map((r) => r.txn_id)).size, doc.records.length);
});

test('rejects and counts', () => {
  const reasons = ['bad_txn_id', 'unknown_post', 'bad_qty', 'bad_price', 'bad_ts', 'bad_status', 'duplicate_superseded'];
  for (const r of doc.rejects) {
    assert.deepEqual(Object.keys(r).sort(), ['line_no', 'reason', 'txn_id']);
    assert.ok(reasons.includes(r.reason));
  }
  const lines = doc.rejects.map((r) => r.line_no);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
  assert.deepEqual(doc.counts, { input_rows: doc.records.length + doc.rejects.length, records: doc.records.length, rejects: doc.rejects.length });
});

test('totals', () => {
  assert.equal(doc.totals.by_post.length, 4);
  assert.equal(doc.totals.grand_total_cc, doc.totals.by_post.reduce((t, p) => t + p.settled_total_cc, 0));
});
