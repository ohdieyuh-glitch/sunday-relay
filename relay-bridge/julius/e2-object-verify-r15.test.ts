/* Round 10 (PILOT 5a6e3400 R9-1, HIGH): a corrupt loose object planted in the coder's own .git/objects under the hash of
   the good content. git never re-hashes loose objects on read, and Round 9's `hash-object -w` with the coder store as an
   alternate skipped writing the real object. Fix: (a) snapshot objects are written with the throwaway dir as the ONLY
   store (no coder alternate; the commit object is hashed directly, so commit-tree's parent lookup is not needed);
   (b) recordGitDiff re-hashes every object the diff and ancestry check read (commits head..base plus base, and all
   their trees and blobs) before any diff, refusing with e2_object_hash_mismatch. */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import * as G from './e2-evidence-gate';
import * as S from './e2-safe-git';
import { MODEL, RUN, START, anchorOf, call, git, liveCapture, makeRepo, tail } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-objverify-r15-')));
const privTmp = join(root, 'tmp'); mkdirSync(privTmp); process.env.TMPDIR = privTmp;
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const TB = (n: number): string => "import t from 'node:test'; import assert from 'node:assert';\n" + Array.from({ length: n }, (_, i) => `t('c${i}',()=>assert.strictEqual(${i}+1,${i + 1}));`).join('\n') + '\n';
const AU = { name: 'n', email: 'e@x' };
const EVIL = 'EVIL-UNTESTED-CONTENT\n';
const hashOf = (repo: string, content: string): string => execFileSync('git', ['hash-object', '--stdin'], { cwd: repo, input: content }).toString().trim();
/** Overwrite (or create) the coder's loose object `oid` with a blob holding `bytes` (wrong hash). */
function plant(repo: string, oid: string, bytes: string): void {
  const d = join(repo, '.git/objects', oid.slice(0, 2)); mkdirSync(d, { recursive: true });
  const f = join(d, oid.slice(2)); if (existsSync(f)) chmodSync(f, 0o644);
  writeFileSync(f, deflateSync(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(bytes)}\0`), Buffer.from(bytes)])));
}
let k = 0;
async function gate(repo: string, b: string, h: string, objectDir?: string): Promise<{ gate: 'PASS' | readonly string[]; diff: G.E2DiffEvidence | null }> {
  const runner = G.spawnVerifierRunner({ timeoutMs: 60_000 });
  const spec = await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.mjs', workspace: repo, base: b }, runner);
  if ('refused' in spec) throw new Error(`spec refused ${spec.refused}`);
  const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
  const diff = await G.recordGitDiff({ base: b, head: h, cwd: repo, runner, ...(objectDir === undefined ? {} : { objectDir }) });
  const { lines, evidence } = await liveCapture(root, `s${k++}.jsonl`, START + call('c0', 'edit_file', { path: 'a.txt' }) + tail());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff, binding: { runId: RUN, base: b, head: h, workspace: repo }, modelId: MODEL });
  return { gate: g.ok ? 'PASS' : g.reasons, diff };
}
const newRepo = (): string => { const r = join(root, `r${k++}`); mkdirSync(r); return r; };

describe('R9-1: planted corrupt loose objects never reach a PASS', () => {
  it('control (committed head): honest repo PASSes and records objectsVerified', async () => {
    const r = newRepo(); const { base, head } = makeRepo(r, { 't.test.mjs': TB(3), 'a.txt': 'a\n' }, { 'a.txt': 'GOOD\n' }, W);
    const g = await gate(r, base, head);
    expect(g.gate).toBe('PASS'); expect(g.diff?.objectRefusal).toBeNull();
  }, 60_000);
  it('committed-head path: the head blob is corrupted in the coder store -> e2_object_hash_mismatch', async () => {
    const r = newRepo(); const { base, head } = makeRepo(r, { 't.test.mjs': TB(3), 'a.txt': 'a\n' }, { 'a.txt': 'GOOD\n' }, W);
    plant(r, hashOf(r, 'GOOD\n'), EVIL);
    const g = await gate(r, base, head);
    expect(g.gate).not.toBe('PASS'); expect(g.gate).toContain('e2_object_hash_mismatch');
  }, 60_000);
  it('base side: the base blob of the changed file is corrupted -> e2_object_hash_mismatch', async () => {
    const r = newRepo(); const { base, head } = makeRepo(r, { 't.test.mjs': TB(3), 'a.txt': 'a\n' }, { 'a.txt': 'GOOD\n' }, W);
    plant(r, hashOf(r, 'a\n'), 'z\n');
    const g = await gate(r, base, head);
    expect(g.gate).toContain('e2_object_hash_mismatch');
  }, 60_000);
  it('snapshot path (PILOT repro): corrupt object planted BEFORE the snapshot; the snapshot still writes the real object to its own dir, and the gate refuses', async () => {
    const r = newRepo(); const base = makeRepo(r, { 't.test.mjs': TB(3), 'a.txt': 'a\n' }, {}, W).base; git(r, 'reset', '-q', '--hard', base);
    const oid = hashOf(r, 'GOOD\n'); plant(r, oid, EVIL); W(join(r, 'a.txt'), 'GOOD\n');
    const s = S.snapshotCommitSafely({ workspace: r, parent: base, message: 'c', author: AU });
    if ('refused' in s) throw new Error(s.refused);
    try {
      expect(existsSync(join(s.objectDir.path, oid.slice(0, 2), oid.slice(2)))).toBe(true); /* (a) no skipped write */
      const g = await gate(r, base, s.head, s.objectDir.path);
      expect(g.gate).not.toBe('PASS'); expect(g.gate).toContain('e2_object_hash_mismatch');
    } finally { s.dispose(); }
  }, 60_000);
  it('snapshot path control: no planted object -> PASS', async () => {
    const r = newRepo(); const base = makeRepo(r, { 't.test.mjs': TB(3), 'a.txt': 'a\n' }, {}, W).base; git(r, 'reset', '-q', '--hard', base); W(join(r, 'a.txt'), 'GOOD\n');
    const s = S.snapshotCommitSafely({ workspace: r, parent: base, message: 'c', author: AU });
    if ('refused' in s) throw new Error(s.refused);
    try { expect((await gate(r, base, s.head, s.objectDir.path)).gate).toBe('PASS'); } finally { s.dispose(); }
  }, 60_000);
  it('snapshot writes every object (blobs, tree, commit) into its own dir, none into the coder store', () => {
    const r = newRepo(); const base = makeRepo(r, { 'a.txt': 'a\n' }, {}, W).base; git(r, 'reset', '-q', '--hard', base); W(join(r, 'a.txt'), 'a\n'); W(join(r, 'b.txt'), 'b\n');
    const count = (d: string): number => readdirSync(d).filter((x) => /^[0-9a-f]{2}$/u.test(x)).reduce((n, x) => n + readdirSync(join(d, x)).length, 0);
    const before = count(join(r, '.git/objects'));
    const s = S.snapshotCommitSafely({ workspace: r, parent: base, message: 'c', author: AU });
    if ('refused' in s) throw new Error(s.refused);
    expect(count(join(r, '.git/objects'))).toBe(before);
    expect(count(s.objectDir.path)).toBe(4); /* a.txt (same bytes as base, still written), b.txt, tree, commit */
    s.dispose();
  });
});
