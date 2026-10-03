#!/usr/bin/env node
/**
 * THE EVIDENCE BUNDLE'S OWN RESOLVER (founder decision A, 2026-10-03). The dump copies it into every bundle as
 * `resolve-artifacts.mjs`, so a bundle downloaded anywhere resolves itself: it reads ONLY the bundle's files (no
 * database, no network, no import), and needs nothing but Node.
 *
 * For every work artifact the bundle names it answers whether the body it carries is the one the run recorded,
 * by BOTH hashes:
 *   - `content_hash` (work-artifacts.tsv): sha256 of the body as stored, with its byte size;
 *   - `integrity_hash` (evidence.tsv, on every row whose `artifact_ref` is `artifact:<id>`): sha256 of the FULL text
 *     the worker produced. The store keeps at most 256 Ki UTF-16 units, so a longer text's stored body cannot match it.
 *
 * VERDICTS, one per artifact (and per unresolvable evidence row):
 *   RESOLVED          the body matches content_hash and byte_size, and every integrity_hash naming it
 *                     (an artifact no evidence row names is checked by content_hash alone, and says so);
 *   TRUNCATED         content_hash matches, an integrity_hash does not, and the body is EXACTLY the cap long in UTF-16
 *                     units (decoded, never counted in bytes): honest, but it does not verify, so --strict fails it;
 *   DROPPED_BY_SCAN   the credential scan removed the body, and its record agrees with BODIES.tsv (id, body, hash) and
 *                     the body is really gone;
 *   MISSING           no body and no drop record: a deletion is never read as a drop;
 *   MISMATCH          any hash or size disagreement, or a drop record that disagrees or whose body is still present;
 *   UNRESOLVABLE      an evidence row whose artifact_ref is not exactly `artifact:<id>`, or names no work artifact;
 *   UNVERIFIABLE      an evidence row that names an artifact but carries no 64-hex integrity_hash;
 *   HASH_ONLY         an evidence row with an integrity_hash and no artifact (a tool row): listed, not a failure;
 *   UNEXPECTED_FILE   a file under artifacts/ that BODIES.tsv does not name;
 *   UNAVAILABLE       a dump the resolver needs is missing, failed (`unavailable`) or lacks a column it needs;
 *   any copy status other than COPIED from BODIES.tsv (AMBIGUOUS, HASH_MISMATCH, REFUSED_*, REF_MISMATCH, INVALID_ROW).
 *
 *   node resolve-artifacts.mjs [--strict] [<artifact id> | --evidence <evidence id>]
 *
 * Exit 0 only when every verdict reported is RESOLVED, DROPPED_BY_SCAN or HASH_ONLY, or TRUNCATED without --strict.
 * The row closes on a --strict run. It prints ids, hashes and verdicts only, never a body.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The stored-body cap, in UTF-16 code units (relay-bridge/julius/artifact-exchange.ts ARTIFACT_TEXT_CAP). */
export const BODY_CAP_UNITS = 256 * 1024;
const HEX64 = /^[0-9a-f]{64}$/u;
const ARTIFACT_REF = /^artifact:(\S+)$/u;
const PASSING = new Set(['RESOLVED', 'DROPPED_BY_SCAN', 'HASH_ONLY']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
/**
 * A value this resolver will not repeat: its digest and length. The workflow publishes the resolver's output to the job
 * summary, which no scan reads, so it prints ids it verified, hashes, sizes and verdicts — never a body's bytes, and
 * never a ref or a file name it could not verify.
 */
const opaque = (value) => `sha256 ${sha256(value).slice(0, 16)}…, ${value.length} chars`;

const linesOf = (path) => readFileSync(path, 'utf8').split('\n').map((line) => line.replace(/\r$/u, ''));
const footer = (line) => /^\(\d+ rows?\)$/u.test(line.trim());

/** A psql `-A -F '\t'` dump whose values carry no tab or newline (ids, hashes, refs, counts). */
export function readTable(path) {
  if (!existsSync(path)) return { status: 'ABSENT', columns: [], rows: [] };
  const lines = linesOf(path).filter((line) => line.length > 0);
  if (lines.length === 1 && lines[0].trim() === 'unavailable') return { status: 'UNAVAILABLE', columns: [], rows: [] };
  if (lines.length === 0) return { status: 'EMPTY', columns: [], rows: [] };
  const columns = lines[0].split('\t');
  const rows = [];
  let malformed = 0;
  for (const line of lines.slice(1)) {
    if (footer(line)) continue;
    const fields = line.split('\t');
    if (fields.length !== columns.length) { malformed += 1; continue; }
    rows.push(Object.fromEntries(columns.map((column, index) => [column, fields[index]])));
  }
  return { status: 'READ', columns, rows, malformed };
}

/**
 * evidence.tsv, whose `safe_summary` is free text: a value may hold a newline (a row then spans lines) or a tab (it
 * then has more fields). Its LAST two columns are `integrity_hash, artifact_ref`, so a record is read from its first
 * field and its last two, whatever the text between them held.
 */
export function readEvidence(path) {
  if (!existsSync(path)) return { status: 'ABSENT', rows: [] };
  const lines = linesOf(path);
  const content = lines.filter((line) => line.length > 0);
  if (content.length === 1 && content[0].trim() === 'unavailable') return { status: 'UNAVAILABLE', rows: [] };
  if (content.length === 0) return { status: 'EMPTY', rows: [] };
  const columns = lines[0].split('\t');
  if (columns[0] !== 'evidence_id' || columns.at(-2) !== 'integrity_hash' || columns.at(-1) !== 'artifact_ref') {
    return { status: 'NO_ARTIFACT_COLUMNS', rows: [] };
  }
  const rows = [];
  let pending = null;
  for (const line of lines.slice(1)) {
    if (pending === null && (line.length === 0 || footer(line))) continue;
    const joined = pending === null ? line : `${pending}\n${line}`;
    const fields = joined.split('\t');
    if (fields.length < columns.length) { pending = joined; continue; }
    pending = null;
    rows.push({ evidenceId: fields[0], integrityHash: fields.at(-2), artifactRef: fields.at(-1) });
  }
  return { status: pending === null ? 'READ' : 'TRUNCATED_RECORD', rows };
}

/** Every verdict for the bundle at `bundleDir`. */
export function resolveBundle(bundleDir) {
  const verdicts = [];
  const add = (verdict, subject, detail) => verdicts.push({ verdict, subject, detail });
  const artifacts = readTable(join(bundleDir, 'work-artifacts.tsv'));
  const evidence = readEvidence(join(bundleDir, 'evidence.tsv'));
  const bodies = readTable(join(bundleDir, 'artifacts', 'BODIES.tsv'));
  const dropped = readTable(join(bundleDir, 'artifacts', 'DROPPED_BY_SCAN.tsv'));
  if (artifacts.status !== 'READ') { add('UNAVAILABLE', 'work-artifacts.tsv', artifacts.status); return verdicts; }
  if (artifacts.malformed > 0) add('UNAVAILABLE', 'work-artifacts.tsv', `${artifacts.malformed} malformed row(s)`);
  if (evidence.status !== 'READ') { add('UNAVAILABLE', 'evidence.tsv', evidence.status); return verdicts; }
  if (artifacts.rows.length > 0 && bodies.status !== 'READ') { add('UNAVAILABLE', 'artifacts/BODIES.tsv', bodies.status); return verdicts; }

  const byId = new Map(artifacts.rows.map((row) => [row.artifact_id, row]));
  const bodyRows = new Map((bodies.rows ?? []).map((row) => [row.artifact_id, row]));
  const dropRows = new Map((dropped.status === 'READ' ? dropped.rows : []).map((row) => [row.artifact_id, row]));
  const integrity = new Map();
  for (const row of evidence.rows) {
    if (row.artifactRef === '') {
      if (row.integrityHash !== '') add('HASH_ONLY', row.evidenceId, `integrity_hash ${row.integrityHash}; no artifact`);
      continue;
    }
    const match = ARTIFACT_REF.exec(row.artifactRef);
    if (match === null) { add('UNRESOLVABLE', row.evidenceId, `artifact_ref is not artifact:<id> (${opaque(row.artifactRef)})`); continue; }
    if (!byId.has(match[1])) { add('UNRESOLVABLE', row.evidenceId, `artifact_ref names no work artifact (${opaque(match[1])})`); continue; }
    if (!HEX64.test(row.integrityHash)) { add('UNVERIFIABLE', row.evidenceId, `names ${match[1]} but carries no integrity_hash`); continue; }
    integrity.set(match[1], [...(integrity.get(match[1]) ?? []), { evidenceId: row.evidenceId, hash: row.integrityHash }]);
  }

  for (const [id, row] of [...byId.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const name = `artifacts/${sha256(id)}.body`;
    const copy = bodyRows.get(id);
    const drop = dropRows.get(id);
    const path = join(bundleDir, ...name.split('/'));
    if (copy === undefined) { add('MISSING', id, 'BODIES.tsv has no row for it'); continue; }
    if (drop !== undefined) {
      const agrees = drop.body === name && copy.body === name && copy.status === 'COPIED' && drop.content_hash === row.content_hash
        && copy.content_hash === row.content_hash && drop.marker === 'DROPPED_BY_SCAN';
      if (!agrees) add('MISMATCH', id, 'its DROPPED_BY_SCAN record disagrees with BODIES.tsv or work-artifacts.tsv');
      else if (existsSync(path)) add('MISMATCH', id, 'recorded DROPPED_BY_SCAN, but its body is still present');
      else add('DROPPED_BY_SCAN', id, `content_hash ${row.content_hash}; integrity ${(integrity.get(id) ?? []).map((entry) => entry.hash).join(',') || 'none'}`);
      continue;
    }
    if (copy.status !== 'COPIED') { add(copy.status, id, 'the copy step recorded it'); continue; }
    if (copy.body !== name) { add('MISMATCH', id, `BODIES.tsv names ${copy.body}, expected ${name}`); continue; }
    if (!existsSync(path)) { add('MISSING', id, 'its body is gone and no DROPPED_BY_SCAN record says why'); continue; }
    const bytes = readFileSync(path);
    const digest = sha256(bytes);
    if (digest !== row.content_hash || copy.content_hash !== row.content_hash || String(bytes.byteLength) !== row.byte_size) {
      add('MISMATCH', id, 'the body does not match its content_hash and byte_size');
      continue;
    }
    const naming = integrity.get(id) ?? [];
    if (naming.length === 0) { add('RESOLVED', id, `content_hash ${digest}; no evidence row names it`); continue; }
    const unequal = naming.filter((entry) => entry.hash !== digest);
    if (unequal.length === 0) { add('RESOLVED', id, `content_hash = integrity_hash = ${digest} (${naming.map((entry) => entry.evidenceId).join(',')})`); continue; }
    const atCap = bytes.toString('utf8').length === BODY_CAP_UNITS;
    if (atCap) add('TRUNCATED', id, `content_hash ${digest}; the body is the ${BODY_CAP_UNITS}-unit cap, so integrity_hash ${unequal.map((entry) => entry.hash).join(',')} is over a longer text`);
    else add('MISMATCH', id, `integrity_hash ${unequal.map((entry) => `${entry.evidenceId}=${entry.hash}`).join(',')} != body ${digest}`);
  }

  for (const id of dropRows.keys()) if (!byId.has(id)) add('MISMATCH', id, 'a DROPPED_BY_SCAN record names no work artifact');
  const named = new Set([...bodyRows.values()].map((row) => row.body));
  const directory = join(bundleDir, 'artifacts');
  if (existsSync(directory)) {
    for (const file of readdirSync(directory)) {
      if (file === 'BODIES.tsv' || file === 'DROPPED_BY_SCAN.tsv') continue;
      if (!named.has(`artifacts/${file}`)) add('UNEXPECTED_FILE', /^[0-9a-f]{64}\.body$/u.test(file) ? `artifacts/${file}` : `artifacts/(${opaque(file)})`, 'BODIES.tsv does not name it');
    }
  }
  return verdicts;
}

/** The exit code for `verdicts` (filtered to what was asked), strict or not. */
export const exitCodeFor = (verdicts, strict) => (verdicts.every((entry) => PASSING.has(entry.verdict) || (!strict && entry.verdict === 'TRUNCATED')) ? 0 : 1);

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const rest = args.filter((arg) => arg !== '--strict');
  const evidenceAt = rest.indexOf('--evidence');
  const wanted = evidenceAt >= 0 ? rest[evidenceAt + 1] : rest[0];
  // The bundle is the directory this file sits in (`import.meta.dirname` needs Node 20.11; this does not).
  const bundleDir = process.env.JULIUS_EVIDENCE_BUNDLE ?? dirname(fileURLToPath(import.meta.url));
  const all = resolveBundle(bundleDir);
  const shown = wanted === undefined ? all : all.filter((entry) => entry.subject === wanted
    || (evidenceAt >= 0 && entry.detail.includes(wanted)));
  for (const entry of shown) process.stdout.write(`RESOLVE ${entry.verdict} ${entry.subject} ${entry.detail}\n`);
  const counts = shown.reduce((acc, entry) => ({ ...acc, [entry.verdict]: (acc[entry.verdict] ?? 0) + 1 }), {});
  const code = shown.length === 0 && wanted !== undefined ? 1 : exitCodeFor(shown, strict);
  process.stdout.write(`RESOLVE SUMMARY ${Object.entries(counts).map(([verdict, count]) => `${verdict.toLowerCase()}=${count}`).join(' ') || 'nothing'} strict=${strict ? 'yes' : 'no'} exit=${code}\n`);
  process.exitCode = code;
}
