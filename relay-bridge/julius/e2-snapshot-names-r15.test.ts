/* Round 10 (PILOT 5a6e3400 R9-5, R9-6): byte-order tree comparison, special files, and HFS-ignorable `.git` names. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as S from './e2-safe-git';
import { git, makeRepo } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-names-r15-')));
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const AU = { name: 'n', email: 'e@x' };
let k = 0;
function repo(): { r: string; base: string } {
  const r = join(root, `r${k++}`); mkdirSync(r); const base = makeRepo(r, { 'a.txt': 'a\n' }, {}, W).base; git(r, 'reset', '-q', '--hard', base); return { r, base };
}
describe('R9-5: the written tree is compared in git byte order (not UTF-16 order)', () => {
  it('U+FFFD and U+1F600 names (UTF-16 order != byte order): a legitimate snapshot succeeds and lists both', () => {
    const { r, base } = repo(); W(join(r, '\uFFFD.txt'), 'x\n'); W(join(r, '\u{1F600}.txt'), 'y\n');
    const s = S.snapshotCommitSafely({ workspace: r, parent: base, message: 'c', author: AU });
    expect('refused' in s ? s.refused : 'ok').toBe('ok');
    if (!('refused' in s)) { expect([...s.included].sort()).toEqual(['a.txt', '\u{1F600}.txt', '\uFFFD.txt'].sort()); s.dispose(); }
  });
  it('control: plain ASCII names still snapshot', () => {
    const { r, base } = repo(); W(join(r, 'b.txt'), 'b\n');
    const s = S.snapshotCommitSafely({ workspace: r, parent: base, message: 'c', author: AU });
    expect('refused' in s ? s.refused : 'ok').toBe('ok'); if (!('refused' in s)) s.dispose();
  });
});
describe('R9-6: special files and HFS-ignorable .git names', () => {
  it('a FIFO is refused with safe_git_special_file and its path (never silently dropped)', () => {
    const { r, base } = repo(); execFileSync('mkfifo', [join(r, 'pipe')]);
    expect(S.snapshotCommitSafely({ workspace: r, parent: base, message: 'c', author: AU })).toEqual({ refused: 'safe_git_special_file', paths: ['pipe'] });
  });
  it('a unix socket path is refused the same way', async () => {
    const { r, base } = repo(); const net = await import('node:net');
    const srv = net.createServer(); await new Promise<void>((res) => srv.listen(join(r, 'sock'), res));
    try { expect(S.snapshotCommitSafely({ workspace: r, parent: base, message: 'c', author: AU })).toEqual({ refused: 'safe_git_special_file', paths: ['sock'] }); } finally { srv.close(); }
  });
  it('`.git\\u200c` (and other HFS-ignorable code points) is treated as .git: refused as a dropped path', () => {
    for (const n of ['.git\u200c', '.g\u200dit', '\ufeff.git', '.GIT\u206a']) expect(S.isDroppedPath(`d/${n}/config`), n).toBe(true);
    const { r, base } = repo(); W(join(r, 'd', '.git\u200c', 'hooks', 'x'), 'x\n');
    expect(S.snapshotCommitSafely({ workspace: r, parent: base, message: 'c', author: AU })).toEqual({ refused: 'safe_git_dropped_path', paths: ['d/.git\u200c'] });
  });
  it('control: an ordinary name containing U+200C elsewhere is kept', () => {
    expect(S.isDroppedPath('docs/a\u200cb.md')).toBe(false);
  });
});
