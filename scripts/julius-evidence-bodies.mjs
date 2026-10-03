#!/usr/bin/env node
/**
 * THE WORK-ARTIFACT BODIES, COPIED INTO THE EVIDENCE BUNDLE (founder decision A, 2026-10-03).
 *
 * A paid run's bundle used to name its artifacts and carry none of them: `julius_work_artifacts` rows hold a
 * content hash and a `storage_ref`, and the bytes stayed in the runner's artifact root, destroyed with the job.
 * So no one could check, after the run, that the plan, diff or test output the evidence names is the one the
 * reviewer read. This copies each body the run recorded into `<bundle>/artifacts/`, after the dump has written
 * `work-artifacts.tsv`, and records what it did with every row in `artifacts/BODIES.tsv`.
 *
 * Every row is CHECKED before a byte is copied, because every value in it came from the database:
 *   - `storage_ref` must be exactly `local://<64 hex>/<64 hex>/<64 hex>`, the local store's own form, and its last
 *     segment must be sha256(artifact_id), as the store derives it. Anything else is REFUSED_REF / REF_MISMATCH.
 *   - the blob path is built from those segments under the root and must stay inside it (`path.relative`, so the
 *     check holds on Windows too, never a '/'-prefix test); no directory below the root and not the blob itself may
 *     be a symbolic link (lstat). REFUSED_PATH / REFUSED_SYMLINK, and nothing is copied.
 *   - the bytes are hashed and measured: they must equal the row's content_hash and byte_size, or the body is NOT
 *     copied and the row is HASH_MISMATCH (evidence of a fault: recorded, never swallowed; the resolver fails on it).
 * The bundle file is `artifacts/<sha256(artifact_id)>.body`: hex only, since artifact ids carry ':'.
 *
 * THE ROOT. `JULIUS_WORK_ARTIFACT_ROOT` when it is set (the job sets it, so the mission and this share one root);
 * otherwise each mission directory under `<tmpdir>/julius-work-artifacts/` is a candidate, and a body must be found
 * in exactly one of them (MISSING / AMBIGUOUS otherwise). Bodies are never found by a name glob.
 *
 * It copies text the run's workers wrote (plans, diffs, test output). That is what the founder approved; the
 * workflow's credential scan, which runs after this, drops a body that trips it and records the drop.
 *
 *   node scripts/julius-evidence-bodies.mjs <bundle directory>
 *
 * Exits 0 whenever it could read the bundle (every row's outcome is in BODIES.tsv), 2 on a usage error.
 * It prints counts only, never a body.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BODY_DIRECTORY = 'artifacts';
export const BODIES_FILE = 'BODIES.tsv';
export const BODY_STATUSES = Object.freeze(['COPIED', 'MISSING', 'AMBIGUOUS', 'HASH_MISMATCH', 'REFUSED_REF', 'REF_MISMATCH', 'REFUSED_PATH', 'REFUSED_SYMLINK', 'INVALID_ROW']);
const STORAGE_REF = /^local:\/\/([0-9a-f]{64})\/([0-9a-f]{64})\/([0-9a-f]{64})$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** psql `-A -F '\t'` output: a header, rows, a `(N rows)` footer; `unavailable` when the dump failed. */
export function readDump(path) {
  if (!existsSync(path)) return { status: 'ABSENT', columns: [], rows: [] };
  const lines = readFileSync(path, 'utf8').split('\n').map((line) => line.replace(/\r$/u, '')).filter((line) => line.length > 0);
  if (lines.length === 1 && lines[0].trim() === 'unavailable') return { status: 'UNAVAILABLE', columns: [], rows: [] };
  if (lines.length === 0) return { status: 'EMPTY', columns: [], rows: [] };
  const columns = lines[0].split('\t');
  const rows = [];
  for (const line of lines.slice(1)) {
    if (/^\(\d+ rows?\)$/u.test(line.trim())) continue;
    const fields = line.split('\t');
    rows.push(fields.length === columns.length ? Object.fromEntries(columns.map((column, index) => [column, fields[index]])) : null);
  }
  return { status: 'READ', columns, rows };
}

/** The roots a body may live under: the configured one, or every mission directory under the discovery base. */
export function artifactRoots({ configuredRoot, discoveryBase }) {
  const configured = (configuredRoot ?? '').trim();
  if (configured !== '') {
    if (!isAbsolute(configured)) throw new Error('julius_evidence_bodies_root_not_absolute: JULIUS_WORK_ARTIFACT_ROOT must name an absolute directory');
    return [resolve(configured)];
  }
  const base = resolve(discoveryBase ?? join(tmpdir(), 'julius-work-artifacts'));
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(base, entry.name)).sort();
}

/** Where `segments` put a blob under `root`, or why it may not be read: containment by path.relative, symlinks by lstat. */
export function blobUnder(root, segments) {
  const absolute = resolve(root, segments[0], segments[1], `${segments[2]}.blob`);
  const inside = relative(resolve(root), absolute);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return { refused: 'REFUSED_PATH' };
  const steps = [resolve(root, segments[0]), resolve(root, segments[0], segments[1]), absolute];
  for (const step of steps) {
    let stat;
    try { stat = lstatSync(step); } catch { return { absent: true }; }
    if (stat.isSymbolicLink()) return { refused: 'REFUSED_SYMLINK' };
  }
  if (!lstatSync(absolute).isFile()) return { refused: 'REFUSED_PATH' };
  return { path: absolute };
}

/** One work-artifacts row → its outcome, and the bytes when they may be copied. */
export function bodyFor(row, roots) {
  const artifactId = row?.artifact_id ?? '';
  const outcome = (status, extra = {}) => ({ artifactId, status, contentHash: row?.content_hash ?? '', byteSize: row?.byte_size ?? '', ...extra });
  if (row === null || artifactId === '' || /[\u0000-\u001f]/u.test(artifactId) || !HEX64.test(row.content_hash ?? '') || !/^\d+$/u.test(row.byte_size ?? '')) {
    return outcome('INVALID_ROW');
  }
  const match = STORAGE_REF.exec(row.storage_ref ?? '');
  if (match === null) return outcome('REFUSED_REF');
  const segments = [match[1], match[2], match[3]];
  if (segments[2] !== sha256(artifactId)) return outcome('REF_MISMATCH');
  const found = [];
  for (const root of roots) {
    const blob = blobUnder(root, segments);
    if (blob.refused !== undefined) return outcome(blob.refused);
    if (blob.path !== undefined) found.push(blob.path);
  }
  if (found.length === 0) return outcome('MISSING');
  if (found.length > 1) return outcome('AMBIGUOUS');
  const bytes = readFileSync(found[0]);
  if (sha256(bytes) !== row.content_hash || bytes.byteLength !== Number(row.byte_size)) return outcome('HASH_MISMATCH');
  return outcome('COPIED', { body: `${BODY_DIRECTORY}/${segments[2]}.body`, bytes });
}

/** Copies every body the rows name into `<bundle>/artifacts/` and writes BODIES.tsv. Returns the counts. */
export function copyEvidenceBodies({ bundleDir, configuredRoot, discoveryBase }) {
  const dump = readDump(join(bundleDir, 'work-artifacts.tsv'));
  const directory = join(bundleDir, BODY_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  const lines = ['artifact_id\tbody\tcontent_hash\tbyte_size\tstatus'];
  const counts = Object.fromEntries(BODY_STATUSES.map((status) => [status, 0]));
  if (dump.status === 'READ') {
    const roots = artifactRoots({ configuredRoot, discoveryBase });
    for (const row of dump.rows) {
      const result = bodyFor(row, roots);
      if (result.status === 'COPIED') writeFileSync(join(bundleDir, result.body), result.bytes);
      counts[result.status] += 1;
      lines.push([result.artifactId, result.body ?? '-', result.contentHash, result.byteSize, result.status].join('\t'));
    }
  }
  writeFileSync(join(directory, BODIES_FILE), `${lines.join('\n')}\n`);
  return { dump: dump.status, counts };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bundleDir = process.argv[2];
  if (bundleDir === undefined || bundleDir.trim() === '') {
    process.stderr.write('usage: julius-evidence-bodies.mjs <bundle directory>\n');
    process.exitCode = 2;
  } else {
    try {
      const { dump, counts } = copyEvidenceBodies({ bundleDir, configuredRoot: process.env.JULIUS_WORK_ARTIFACT_ROOT, discoveryBase: undefined });
      process.stdout.write(`EVIDENCE BODIES work-artifacts=${dump} ${BODY_STATUSES.map((status) => `${status.toLowerCase()}=${counts[status]}`).join(' ')}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
