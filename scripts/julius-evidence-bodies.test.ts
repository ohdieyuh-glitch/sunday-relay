import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// @ts-expect-error — a plain ESM script without declarations; its exports are exercised directly.
import * as bodies from './julius-evidence-bodies.mjs';

/**
 * THE BODY COPIER (founder decision A): every value it uses came from the database, so every one is checked before a
 * byte is copied. These cases build the local store's real layout (<root>/<sha tenant>/<sha project>/<sha id>.blob) in
 * a temp directory and a `work-artifacts.tsv` as psql writes it.
 */

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });
const temp = (label: string) => { const dir = mkdtempSync(join(tmpdir(), `julius-bodies-${label}-`)); scratch.push(dir); return dir; };

const TENANT = sha('tenant:relay');
const PROJECT = sha('prj-a');
type Row = { id: string; text: string; storageRef?: string; contentHash?: string; byteSize?: string };
const idOf = (kind: string) => `julius-work-artifact.v1:run:abc:run:abc:build:g1:${kind}`;

/** A root holding each row's blob where the local store puts it, and a bundle holding the dump of those rows. */
const fixture = (label: string, rows: Row[], options: { writeBlobs?: boolean } = {}) => {
  const root = temp(`${label}-root`);
  const bundle = temp(`${label}-bundle`);
  const lines = ['artifact_id\tproject_id\trun_id\ttask_id\tlease_generation\trole\tkind\tcontent_type\tbyte_size\tcontent_hash\tstorage_ref\toccurred_at'];
  for (const row of rows) {
    const bytes = Buffer.from(row.text, 'utf8');
    if (options.writeBlobs !== false) {
      mkdirSync(join(root, TENANT, PROJECT), { recursive: true });
      writeFileSync(join(root, TENANT, PROJECT, `${sha(row.id)}.blob`), bytes);
    }
    lines.push([row.id, 'prj-a', 'run:abc', 'run:abc:build', '1', 'CODING_AGENT', 'DIFF', 'text/plain; charset=utf-8',
      row.byteSize ?? String(bytes.byteLength), row.contentHash ?? sha(bytes), row.storageRef ?? `local://${TENANT}/${PROJECT}/${sha(row.id)}`,
      '2026-10-03 12:00:00+00'].join('\t'));
  }
  lines.push(`(${rows.length} rows)`);
  writeFileSync(join(bundle, 'work-artifacts.tsv'), `${lines.join('\n')}\n`);
  return { root, bundle };
};
const statusesIn = (bundle: string) => readFileSync(join(bundle, 'artifacts', 'BODIES.tsv'), 'utf8').trim().split('\n').slice(1)
  .map((line) => { const [artifactId, body, , , status] = line.split('\t'); return { artifactId, body, status }; });
const bodyFiles = (bundle: string) => readdirSync(join(bundle, 'artifacts')).filter((file) => file.endsWith('.body'));

describe('the evidence body copier (decision A)', () => {
  it('copies each body the rows name, by storage_ref, to artifacts/<sha256(artifact id)>.body, byte for byte', () => {
    const rows = [{ id: idOf('DIFF'), text: 'diff --git a/x b/x\n+é€\n' }, { id: idOf('TEST_OUTPUT'), text: 'ok 1\n' }];
    const { root, bundle } = fixture('copy', rows);
    const result = bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: root });
    expect(result.counts.COPIED).toBe(2);
    for (const row of rows) {
      const name = `${sha(row.id)}.body`;
      expect(readFileSync(join(bundle, 'artifacts', name), 'utf8'), row.id).toBe(row.text);
    }
    expect(statusesIn(bundle).map((entry) => entry.status)).toEqual(['COPIED', 'COPIED']);
  });

  it('refuses a storage_ref that is not exactly local://<hex>/<hex>/<hex> — a ../ path among them — and copies nothing', () => {
    const { root, bundle } = fixture('ref', [
      { id: idOf('DIFF'), text: 'x', storageRef: `local://../../${PROJECT}/${sha(idOf('DIFF'))}` },
      { id: idOf('PLAN'), text: 'y', storageRef: `file:///etc/${sha(idOf('PLAN'))}` },
    ]);
    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: root });
    expect(statusesIn(bundle).map((entry) => entry.status)).toEqual(['REFUSED_REF', 'REFUSED_REF']);
    expect(bodyFiles(bundle)).toEqual([]);
  });

  it('keeps every path inside the root by path.relative, whatever segments it is handed (the regex is not the only guard)', () => {
    const root = temp('contain');
    expect(bodies.blobUnder(root, ['..', '..', 'outside'])).toEqual({ refused: 'REFUSED_PATH' });
    expect(bodies.blobUnder(root, [TENANT, PROJECT, 'absent'])).toEqual({ absent: true });
  });

  it('refuses a body reached through a symbolic link below the root, and copies nothing', () => {
    const elsewhere = temp('elsewhere');
    const row = { id: idOf('DIFF'), text: 'linked' };
    mkdirSync(join(elsewhere, PROJECT), { recursive: true });
    writeFileSync(join(elsewhere, PROJECT, `${sha(row.id)}.blob`), row.text);
    const { root, bundle } = fixture('symlink', [row], { writeBlobs: false });
    symlinkSync(elsewhere, join(root, TENANT), 'junction'); // a directory link; 'junction' needs no privilege on Windows
    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: root });
    expect(statusesIn(bundle)[0]!.status).toBe('REFUSED_SYMLINK');
    expect(bodyFiles(bundle)).toEqual([]);
  });

  it('refuses a storage_ref whose last segment is not sha256(artifact id), as the store derives it', () => {
    const { root, bundle } = fixture('refmismatch', [{ id: idOf('DIFF'), text: 'x', storageRef: `local://${TENANT}/${PROJECT}/${sha('another id')}` }]);
    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: root });
    expect(statusesIn(bundle)[0]!.status).toBe('REF_MISMATCH');
  });

  it('records HASH_MISMATCH and copies NOTHING when the blob is not the bytes the row names (hash or size)', () => {
    const { root, bundle } = fixture('hash', [
      { id: idOf('DIFF'), text: 'stored', contentHash: sha('recorded') },
      { id: idOf('PLAN'), text: 'stored', byteSize: '999' },
    ]);
    const result = bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: root });
    expect(result.counts.HASH_MISMATCH).toBe(2);
    expect(bodyFiles(bundle)).toEqual([]);
  });

  it('without a configured root, finds a body in exactly ONE mission directory: none is MISSING, two are AMBIGUOUS', () => {
    const base = temp('discovery');
    const present = { id: idOf('DIFF'), text: 'one' };
    const twice = { id: idOf('PLAN'), text: 'two' };
    const absent = { id: idOf('TEST_OUTPUT'), text: 'none' };
    for (const mission of ['mission-a', 'mission-b']) mkdirSync(join(base, mission, TENANT, PROJECT), { recursive: true });
    writeFileSync(join(base, 'mission-a', TENANT, PROJECT, `${sha(present.id)}.blob`), present.text);
    for (const mission of ['mission-a', 'mission-b']) writeFileSync(join(base, mission, TENANT, PROJECT, `${sha(twice.id)}.blob`), twice.text);
    const { bundle } = fixture('discover', [present, twice, absent], { writeBlobs: false });
    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: undefined, discoveryBase: base });
    expect(statusesIn(bundle).map((entry) => entry.status)).toEqual(['COPIED', 'AMBIGUOUS', 'MISSING']);
  });

  it('marks a row it cannot trust INVALID_ROW (no id, a hash that is not 64 hex), a failed dump writes an empty record, and a relative root is refused', () => {
    const { root, bundle } = fixture('invalid', [{ id: idOf('DIFF'), text: 'x', contentHash: 'not-a-hash' }]);
    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: root });
    expect(statusesIn(bundle)[0]!.status).toBe('INVALID_ROW');

    const failed = temp('unavailable');
    writeFileSync(join(failed, 'work-artifacts.tsv'), 'unavailable\n');
    expect(bodies.copyEvidenceBodies({ bundleDir: failed, configuredRoot: root }).dump).toBe('UNAVAILABLE');
    expect(readFileSync(join(failed, 'artifacts', 'BODIES.tsv'), 'utf8')).toBe('artifact_id\tbody\tcontent_hash\tbyte_size\tstatus\n');

    expect(() => bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: 'relative/root' })).toThrow('julius_evidence_bodies_root_not_absolute');
    expect(existsSync(join(bundle, 'artifacts'))).toBe(true);
  });
});
