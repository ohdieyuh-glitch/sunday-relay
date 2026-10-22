// REFERENCE IMPLEMENTATION of the julius-inworld-data-1 rules (contract.json requirements R1-R13). HIDDEN: never part of the coder's workspace.
// Node built-ins only. Decimal arithmetic is done on digit strings, never on floats.
export const SCHEMA = 'inworld-ledger.v1';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const iso = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
};
// Gregorian calendar by rule (divisible by 4, except centuries unless divisible by 400); never the JS two-digit-year mapping of Date.UTC.
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, mo) => (mo === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(mo) ? 30 : 31);
const validParts = (y, mo, d, h, mi, s) => {
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  return d <= daysIn(y, mo);
};
// Epoch ms of a validated UTC wall time; setUTCFullYear keeps years 1..99 as written.
const utcMs = (y, mo, d, h, mi, s) => { const dt = new Date(0); dt.setUTCFullYear(y, mo - 1, d); dt.setUTCHours(h, mi, s, 0); return dt.getTime(); };
// A converted time outside year 0001..9999 is not representable in the output shape.
const inRange = (ms) => { const y = new Date(ms).getUTCFullYear(); return y >= 1 && y <= 9999; };

export function parseTs(raw) {
  let m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  if (m) {
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
    if (!validParts(y, mo, d, h, mi, s)) return null;
    let offsetMin = 0;
    if (m[7] !== 'Z') {
      const sign = m[7][0] === '-' ? -1 : 1;
      const oh = Number(m[7].slice(1, 3));
      const om = Number(m[7].slice(4, 6));
      if (oh > 23 || om > 59) return null;
      offsetMin = sign * (oh * 60 + om);
    }
    const ms = utcMs(y, mo, d, h, mi, s) - offsetMin * 60000;
    return inRange(ms) ? iso(ms) : null;
  }
  m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(raw);
  if (m) {
    const [d, mo, y, h, mi] = m.slice(1, 6).map(Number);
    if (!validParts(y, mo, d, h, mi, 0)) return null;
    return iso(utcMs(y, mo, d, h, mi, 0));
  }
  if (/^\d{10}$/.test(raw)) return iso(Number(raw) * 1000);
  return null;
}

/** Price string -> integer hundredths of a credit, half-up on the digits past the second decimal; null when malformed or zero. */
export function parsePrice(raw) {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))? ?cr$/i.exec(raw);
  if (!m) return null;
  const whole = m[1].replace(/,/g, '');
  const frac = m[2] ?? '';
  let cc = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  if (frac.length > 2 && frac[2] >= '5') cc += 1n;
  if (cc <= 0n) return null;
  return Number(cc);
}

export function parseQty(raw) {
  const m = /^(\d+)$/.exec(raw) ?? /^x(\d+)$/i.exec(raw) ?? /^(\d+) ?pcs?$/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

const STATUS = new Map([
  ['ok', 'settled'], ['done', 'settled'], ['completed', 'settled'], ['settled', 'settled'],
  ['void', 'void'], ['voided', 'void'], ['cancelled', 'void'], ['pending', 'pending'], ['hold', 'pending'],
]);

export function normalize(csvText, posts) {
  const table = parseCsv(csvText);
  const dataRows = table.slice(1);
  const lookup = new Map();
  for (const p of posts) {
    lookup.set(p.name.toLowerCase(), p.id);
    for (const a of p.aliases) lookup.set(a.toLowerCase(), p.id);
  }
  const valid = [];
  const rejects = [];
  dataRows.forEach((cells, index) => {
    const lineNo = index + 1;
    const [idRaw, postRaw, itemRaw, qtyRaw, priceRaw, tsRaw, statusRaw] = [0, 1, 2, 3, 4, 5, 6].map((i) => (cells[i] ?? '').trim());
    const txnId = idRaw.toUpperCase();
    const reject = (reason) => { rejects.push({ line_no: lineNo, txn_id: idRaw, reason }); };
    if (!/^[A-Z]{2}-\d{4}$/.test(txnId)) return reject('bad_txn_id');
    const post = lookup.get(postRaw.toLowerCase());
    if (post === undefined) return reject('unknown_post');
    const qty = parseQty(qtyRaw);
    if (qty === null) return reject('bad_qty');
    const price = parsePrice(priceRaw);
    if (price === null) return reject('bad_price');
    const ts = parseTs(tsRaw);
    if (ts === null) return reject('bad_ts');
    const status = STATUS.get(statusRaw.toLowerCase());
    if (status === undefined) return reject('bad_status');
    valid.push({ lineNo, idRaw, record: { txn_id: txnId, post, item: itemRaw, qty, unit_price_cc: price, ts, status, line_total_cc: qty * price } });
    return undefined;
  });
  const winners = new Map();
  for (const v of valid) {
    const cur = winners.get(v.record.txn_id);
    if (cur === undefined) winners.set(v.record.txn_id, v);
    else if (v.record.ts >= cur.record.ts) {
      rejects.push({ line_no: cur.lineNo, txn_id: cur.idRaw, reason: 'duplicate_superseded' });
      winners.set(v.record.txn_id, v);
    } else rejects.push({ line_no: v.lineNo, txn_id: v.idRaw, reason: 'duplicate_superseded' });
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const records = [...winners.values()].map((v) => v.record).sort((a, b) => cmp(a.ts, b.ts) || cmp(a.txn_id, b.txn_id));
  rejects.sort((a, b) => a.line_no - b.line_no);
  const byPost = posts.map((p) => {
    const settled = records.filter((r) => r.post === p.id && r.status === 'settled');
    return { post: p.id, settled_count: settled.length, settled_total_cc: settled.reduce((t, r) => t + r.line_total_cc, 0) };
  });
  return {
    schema: SCHEMA,
    records,
    rejects,
    totals: { by_post: byPost, grand_total_cc: byPost.reduce((t, p) => t + p.settled_total_cc, 0) },
    counts: { input_rows: dataRows.length, records: records.length, rejects: rejects.length },
  };
}
