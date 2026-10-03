import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// @ts-expect-error — a plain ESM script without declarations; its exports are exercised directly.
import * as resolver from './julius-evidence-resolve.mjs';

/**
 * THE BUNDLE'S OWN RESOLVER (founder decision A). The row closes only when a bundle is independently resolvable, so
 * each case below is a bundle on disk, built as the dump, the copier and the scan write it, and each pre-registered
 * probe (PREREG_SECOND_AB_PROBES A-1, A-2, A-4, A-6, A-7) has a case that fails a resolver which skips its check.
 */

const ROOT = resolve(import.meta.dirname, '..');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });
const idOf = (kind: string) => `julius-work-artifact.v1:run:abc:run:abc:build:g1:${kind}`;

type Spec = { id: string; body: string; evidence?: Array<{ evidenceId: string; fullText?: string; ref?: string; integrity?: string }> };
/** A bundle as the dump, the copier and (optionally) the scan leave it. Free text with a newline and a tab included. */
const bundleOf = (specs: Spec[], extraEvidence: string[] = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'julius-resolve-'));
  scratch.push(dir);
  mkdirSync(join(dir, 'artifacts'));
  const work = ['artifact_id\tproject_id\trun_id\ttask_id\tlease_generation\trole\tkind\tcontent_type\tbyte_size\tcontent_hash\tstorage_ref\toccurred_at'];
  const copied = ['artifact_id\tbody\tcontent_hash\tbyte_size\tstatus'];
  const evidence = ['evidence_id\tevidence_type\tstatus\tsafe_summary\toccurred_at\trun_id\ttask_id\tintegrity_hash\tartifact_ref'];
  for (const spec of specs) {
    const bytes = Buffer.from(spec.body, 'utf8');
    const name = `artifacts/${sha(spec.id)}.body`;
    work.push([spec.id, 'prj-a', 'run:abc', 'run:abc:build', '1', 'CODING_AGENT', 'DIFF', 'text/plain', String(bytes.byteLength), sha(bytes), `local://${'a'.repeat(64)}/${'b'.repeat(64)}/${sha(spec.id)}`, '2026-10-03'].join('\t'));
    copied.push([spec.id, name, sha(bytes), String(bytes.byteLength), 'COPIED'].join('\t'));
    writeFileSync(join(dir, name), bytes);
    for (const row of spec.evidence ?? [{ evidenceId: `${spec.id}:e` }]) {
      const integrity = row.integrity ?? sha(Buffer.from(row.fullText ?? spec.body, 'utf8'));
      evidence.push([row.evidenceId, 'DIFF', 'PASSED', 'a summary\nthat spans\ttwo lines', '2026-10-03', 'run:abc', 'run:abc:build', integrity, row.ref ?? `artifact:${spec.id}`].join('\t'));
    }
  }
  evidence.push(...extraEvidence);
  writeFileSync(join(dir, 'work-artifacts.tsv'), `${work.join('\n')}\n(${specs.length} rows)\n`);
  writeFileSync(join(dir, 'artifacts', 'BODIES.tsv'), `${copied.join('\n')}\n`);
  writeFileSync(join(dir, 'evidence.tsv'), `${evidence.join('\n')}\n(${evidence.length - 1} rows)\n`);
  return dir;
};
const verdicts = (dir: string) => (resolver.resolveBundle(dir) as Array<{ verdict: string; subject: string }>).map((entry) => `${entry.verdict} ${entry.subject}`);
const exitOf = (dir: string, strict: boolean) => resolver.exitCodeFor(resolver.resolveBundle(dir), strict);
const drop = (dir: string, id: string, overrides: Partial<Record<'body' | 'content_hash' | 'marker', string>> = {}) => {
  const name = `artifacts/${sha(id)}.body`;
  writeFileSync(join(dir, 'artifacts', 'DROPPED_BY_SCAN.tsv'), `artifact_id\tbody\tcontent_hash\tbyte_size\tlayer\tmarker\n${[
    id, overrides.body ?? name, overrides.content_hash ?? '', '0', 'shape', overrides.marker ?? 'DROPPED_BY_SCAN'].join('\t')}\n`);
};

describe('the evidence bundle resolver (decision A)', () => {
  it('RESOLVED: the body matches content_hash AND the integrity_hash of every evidence row naming it; free text with a newline and a tab does not move the columns', () => {
    const dir = bundleOf([{ id: idOf('DIFF'), body: 'diff --git a/x b/x\n+é\n' }, { id: idOf('PLAN'), body: 'plan' }]);
    expect(verdicts(dir)).toEqual([`RESOLVED ${idOf('DIFF')}`, `RESOLVED ${idOf('PLAN')}`]);
    expect(exitOf(dir, true)).toBe(0);
  });

  it('A-1, BOTH HASHES: a body whose content_hash matches but whose evidence integrity_hash does not is a MISMATCH', () => {
    const dir = bundleOf([{ id: idOf('DIFF'), body: 'the stored diff', evidence: [{ evidenceId: 'e1', fullText: 'a different diff' }] }]);
    expect(verdicts(dir)).toEqual([`MISMATCH ${idOf('DIFF')}`]);
    expect(exitOf(dir, false)).toBe(1);
  });

  it('A-2, TAMPER: one byte appended to a body, or an edited content_hash, is a MISMATCH', () => {
    const appended = bundleOf([{ id: idOf('DIFF'), body: 'body' }]);
    appendFileSync(join(appended, 'artifacts', `${sha(idOf('DIFF'))}.body`), 'x');
    expect(verdicts(appended)).toEqual([`MISMATCH ${idOf('DIFF')}`]);
    const edited = bundleOf([{ id: idOf('DIFF'), body: 'body' }]);
    const tsv = join(edited, 'work-artifacts.tsv');
    writeFileSync(tsv, readFileSync(tsv, 'utf8').replace(sha(Buffer.from('body')), sha('other')));
    expect(verdicts(edited)).toEqual([`MISMATCH ${idOf('DIFF')}`]);
  });

  it('A-4 / A-7, DROPPED_BY_SCAN: a body removed by the scan with an agreeing record resolves DROPPED_BY_SCAN, and that passes --strict', () => {
    const dir = bundleOf([{ id: idOf('DIFF'), body: 'credential-shaped text' }, { id: idOf('PLAN'), body: 'plan' }]);
    rmSync(join(dir, 'artifacts', `${sha(idOf('DIFF'))}.body`));
    drop(dir, idOf('DIFF'), { content_hash: sha(Buffer.from('credential-shaped text')) });
    expect(verdicts(dir)).toEqual([`DROPPED_BY_SCAN ${idOf('DIFF')}`, `RESOLVED ${idOf('PLAN')}`]);
    expect(exitOf(dir, true)).toBe(0);
  });

  it('MISSING IS NOT DROPPED: a body deleted with no record is MISSING; a record that disagrees, or whose body is still there, is a MISMATCH', () => {
    const deleted = bundleOf([{ id: idOf('DIFF'), body: 'x' }]);
    rmSync(join(deleted, 'artifacts', `${sha(idOf('DIFF'))}.body`));
    expect(verdicts(deleted)).toEqual([`MISSING ${idOf('DIFF')}`]);

    const wrongHash = bundleOf([{ id: idOf('DIFF'), body: 'x' }]);
    rmSync(join(wrongHash, 'artifacts', `${sha(idOf('DIFF'))}.body`));
    drop(wrongHash, idOf('DIFF'), { content_hash: sha('not the body') });
    expect(verdicts(wrongHash)).toEqual([`MISMATCH ${idOf('DIFF')}`]);

    const stillThere = bundleOf([{ id: idOf('DIFF'), body: 'x' }]);
    drop(stillThere, idOf('DIFF'), { content_hash: sha(Buffer.from('x')) });
    expect(verdicts(stillThere)).toEqual([`MISMATCH ${idOf('DIFF')}`]);
  });

  it('ONLY THE artifact: SCHEME: any other scheme, a malformed ref, or a ref naming no work artifact is UNRESOLVABLE (never stripped)', () => {
    const dir = bundleOf([{ id: idOf('DIFF'), body: 'x', evidence: [
      { evidenceId: 'other-scheme', ref: `blob:${idOf('DIFF')}` },
      { evidenceId: 'spaced', ref: `artifact: ${idOf('DIFF')}` },
      { evidenceId: 'unknown', ref: 'artifact:julius-work-artifact.v1:none' },
    ] }]);
    expect(verdicts(dir)).toEqual(['UNRESOLVABLE other-scheme', 'UNRESOLVABLE spaced', 'UNRESOLVABLE unknown', `RESOLVED ${idOf('DIFF')}`]);
    expect(exitOf(dir, false)).toBe(1);
  });

  it('THE CAP IS IN UTF-16 UNITS: a body of exactly 262,144 three-byte characters is TRUNCATED (fails --strict); one unit short with a mismatch is a MISMATCH', () => {
    const cap = resolver.BODY_CAP_UNITS as number;
    expect(cap).toBe(262_144);
    const atCap = '€'.repeat(cap); // 786,432 bytes, 262,144 units
    const truncated = bundleOf([{ id: idOf('TEST_OUTPUT'), body: atCap, evidence: [{ evidenceId: 'full', fullText: `${atCap}and more` }] }]);
    expect(verdicts(truncated)).toEqual([`TRUNCATED ${idOf('TEST_OUTPUT')}`]);
    expect([exitOf(truncated, false), exitOf(truncated, true)], 'honest, but not a closing verdict').toEqual([0, 1]);
    const short = '€'.repeat(cap - 1);
    const shortBundle = bundleOf([{ id: idOf('TEST_OUTPUT'), body: short, evidence: [{ evidenceId: 'full', fullText: `${short}and more` }] }]);
    expect(verdicts(shortBundle), 'below the cap a mismatch cannot be truncation').toEqual([`MISMATCH ${idOf('TEST_OUTPUT')}`]);
  });

  it('lists a hash-only evidence row without failing, and fails an artifact row with no integrity_hash, an unexpected file and an absent dump', () => {
    const hashOnly = ['tool:1\tCOMMAND_EXECUTION\tPASSED\tran\t2026-10-03\trun:abc\trun:abc:build\t' + sha('stdout') + '\t'];
    const dir = bundleOf([{ id: idOf('DIFF'), body: 'x', evidence: [{ evidenceId: 'no-hash', integrity: '' }] }], hashOnly);
    expect(verdicts(dir)).toEqual(['UNVERIFIABLE no-hash', 'HASH_ONLY tool:1', `RESOLVED ${idOf('DIFF')}`]);
    writeFileSync(join(dir, 'artifacts', 'planted.body'), 'x');
    expect(verdicts(dir).some((line) => line.startsWith('UNEXPECTED_FILE artifacts/(sha256 ')), 'named by digest, never by its own name').toBe(true);
    rmSync(join(dir, 'work-artifacts.tsv'));
    expect(verdicts(dir)).toEqual(['UNAVAILABLE work-artifacts.tsv']);
  });

  it('PRINTS NO BUNDLE TEXT: the job summary is published unscanned, so a marker planted in a body, a ref and a file name never reaches the output', () => {
    const marker = 'PLANTED-MARKER-7f3a9c';
    const dir = bundleOf([{ id: idOf('DIFF'), body: `a body holding ${marker}`, evidence: [{ evidenceId: 'bad-ref', ref: `blob:${marker}` }, { evidenceId: 'unknown-ref', ref: `artifact:${marker}` }] }]);
    appendFileSync(join(dir, 'artifacts', `${sha(idOf('DIFF'))}.body`), ` and ${marker} again`);
    writeFileSync(join(dir, 'artifacts', `${marker}.body`), marker);
    copyFileSync(join(ROOT, 'scripts', 'julius-evidence-resolve.mjs'), join(dir, 'resolve-artifacts.mjs'));
    const run = spawnSync(process.execPath, [join(dir, 'resolve-artifacts.mjs')], { cwd: tmpdir(), env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' }, encoding: 'utf8' });
    expect(run.status, 'the tampered body, the bad refs and the stray file all fail it').toBe(1);
    expect(run.stdout).toContain(`RESOLVE MISMATCH ${idOf('DIFF')}`);
    expect(`${run.stdout}${run.stderr}`, 'nothing of the bundle text is repeated').not.toContain(marker);
  });

  it('A-6, OFF-HOST: copied into a bundle as resolve-artifacts.mjs, it resolves that bundle in a child process with no database variable and no network', () => {
    const dir = bundleOf([{ id: idOf('DIFF'), body: 'diff' }, { id: idOf('PLAN'), body: 'plan' }]);
    copyFileSync(join(ROOT, 'scripts', 'julius-evidence-resolve.mjs'), join(dir, 'resolve-artifacts.mjs'));
    const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };
    const run = spawnSync(process.execPath, [join(dir, 'resolve-artifacts.mjs'), '--strict'], { cwd: tmpdir(), env, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`RESOLVE RESOLVED ${idOf('DIFF')}`);
    expect(run.stdout).toContain('strict=yes exit=0');
    const one = spawnSync(process.execPath, [join(dir, 'resolve-artifacts.mjs'), idOf('PLAN')], { cwd: tmpdir(), env, encoding: 'utf8' });
    expect(one.stdout.trim().split('\n')).toEqual([expect.stringContaining(`RESOLVE RESOLVED ${idOf('PLAN')}`), 'RESOLVE SUMMARY resolved=1 strict=no exit=0']);
  });
});
