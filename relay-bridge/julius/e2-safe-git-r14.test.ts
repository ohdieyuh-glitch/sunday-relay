/* Round 9 (Skywalker 8439b565 HEAD guard; PILOT R8-2 secret paths, R8-3 dropped paths; 6:01 PM throwaway object dir with
   dispose()). The snapshot never relies on the coder's .gitignore / info/exclude. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as S from './e2-safe-git';
import * as G from './e2-evidence-gate';
import { git } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-safegit14-')));
/* Object dirs are created under os.tmpdir(); point it at a private dir so other test files' snapshots cannot race the counts. */
const privTmp = join(root, 'tmp'); mkdirSync(privTmp); process.env.TMPDIR = privTmp;
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
let k = 0;
function repo(): { dir: string; head: string } {
  const dir = join(root, `r${k++}`); mkdirSync(dir);
  git(dir, 'init', '-q'); git(dir, 'config', 'user.name', 'x'); git(dir, 'config', 'user.email', 'x@x');
  W(join(dir, 'a.txt'), '1\n'); git(dir, 'add', '-A'); git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
  return { dir, head: git(dir, 'rev-parse', 'HEAD') };
}
const snap = (r: { dir: string; head: string }, extra: { allowHeadNotParent?: true } = {}) => S.snapshotCommitSafely({ workspace: r.dir, parent: r.head, message: 'm', author: { name: 'J', email: 'j@x' }, ...extra });
const objDirs = (): string[] => readdirSync(privTmp).filter((n) => n.startsWith('e2-snap-objects-')).sort();
const SECRET = 'TOPSECRET-r14-value';
const allObjectsContain = (gitDir: string, needle: string): boolean => {
  const out = spawnSync('git', ['cat-file', '--batch-all-objects', '--batch'], { env: { PATH: process.env.PATH ?? '', GIT_DIR: gitDir, GIT_CONFIG_GLOBAL: '/dev/null' }, maxBuffer: 64 * 1024 * 1024 });
  return out.stdout.toString('latin1').includes(needle);
};

describe('Skywalker: HEAD guard', () => {
  it('HEAD != parent is refused (safe_git_head_not_parent) and leaves no object dir', () => {
    const r = repo(); W(join(r.dir, 'a.txt'), '2\n'); git(r.dir, '-c', 'commit.gpgsign=false', 'commit', '-qam', 'moved');
    const before = objDirs();
    expect(snap(r)).toEqual({ refused: 'safe_git_head_not_parent' });
    expect(objDirs()).toEqual(before);
  });
  it('the documented override allowHeadNotParent: true snapshots on the given parent', () => {
    const r = repo(); W(join(r.dir, 'a.txt'), '2\n'); git(r.dir, '-c', 'commit.gpgsign=false', 'commit', '-qam', 'moved');
    const out = snap(r, { allowHeadNotParent: true }) as S.SnapshotResult;
    expect(git(r.dir, 'rev-parse', `${out.head}^`)).toBe(r.head);
    out.dispose();
  });
});

describe('PILOT R8-2: secret-looking paths are refused by name, never via .gitignore', () => {
  const cases: Array<[string, Record<string, string>, string[]]> = [
    ['.env', { '.env': SECRET }, ['.env']],
    ['secret/k.pem', { 'secret/k.pem': SECRET }, ['secret/']],
    ['.env.local, x.key, id_rsa, credentials.json, .npmrc, .netrc, sub/c.pem', { '.env.local': SECRET, 'x.key': SECRET, 'id_rsa': SECRET, 'credentials.json': SECRET, '.npmrc': SECRET, '.netrc': SECRET, 'sub/c.pem': SECRET },
      ['.env.local', '.netrc', '.npmrc', 'credentials.json', 'id_rsa', 'sub/c.pem', 'x.key']],
    ['a .env DIRECTORY', { '.env/inner.txt': SECRET }, ['.env/']],
  ];
  for (const [name, files, paths] of cases) {
    it(`${name}: refused with the listing; the secret reaches no object store and no object dir survives`, () => {
      const r = repo(); for (const [p, c] of Object.entries(files)) W(join(r.dir, p), c);
      const before = objDirs();
      expect(snap(r)).toEqual({ refused: 'safe_git_secret_path', paths });
      expect(objDirs()).toEqual(before);
      expect(allObjectsContain(join(r.dir, '.git'), SECRET)).toBe(false);
    });
  }
  it('.env listed in .gitignore AND info/exclude is still refused (ignore rules are never read)', () => {
    const r = repo(); W(join(r.dir, '.gitignore'), '.env\nbuild/\n'); W(join(r.dir, '.git/info/exclude'), '.env\n'); W(join(r.dir, '.env'), SECRET);
    expect(snap(r)).toEqual({ refused: 'safe_git_secret_path', paths: ['.env'] });
  });
  it('an ignored NON-secret file is still included, and the result lists included/skipped', () => {
    const r = repo(); W(join(r.dir, '.gitignore'), 'build/\n'); W(join(r.dir, 'build/out.js'), 'x\n');
    const out = snap(r) as S.SnapshotResult;
    expect(out.included).toEqual(['.gitignore', 'a.txt', 'build/out.js']);
    expect(out.skipped).toEqual(['.git']);
    out.dispose();
  });
});

describe('PILOT R8-3: paths git drops are a named refusal (kills S14)', () => {
  it('.GIT/x, sub/.Git/x, git~1/x, sub/.git./y -> safe_git_dropped_path listing them', () => {
    const r = repo();
    for (const p of ['.GIT/x', 'sub/.Git/x', 'git~1/x', 'sub/.git./y']) W(join(r.dir, p), 'payload\n');
    expect(snap(r)).toEqual({ refused: 'safe_git_dropped_path', paths: ['.GIT', 'git~1', 'sub/.Git', 'sub/.git.'] });
  });
});

describe('6:01 PM design: throwaway object dir, dispose()', () => {
  it('objects live only in a 0700 dir outside the workspace; the gate diff reads them; dispose is idempotent and removes everything', async () => {
    const r = repo(); W(join(r.dir, 'b.txt'), 'new file r14\n');
    const loose = (): string => git(r.dir, 'count-objects', '-v').split('\n').filter((l) => /^(count|size|in-pack):/u.test(l)).join('\n');
    const looseBefore = loose();
    const out = snap(r) as S.SnapshotResult;
    const d = out.objectDir.path;
    expect(statSync(d).mode & 0o777).toBe(0o700);
    expect(relative(r.dir, d).startsWith('..')).toBe(true);
    expect(loose()).toBe(looseBefore); /* nothing written into the workspace object store */
    const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
    const diff = await G.recordGitDiff({ base: r.head, head: out.head, cwd: r.dir, runner });
    expect(diff?.exitCode).toBe(0);
    expect(diff?.paths).toEqual(['b.txt']);
    expect(diff?.isolated).toBe(true); /* the gate accepts exactly this live snapshot alternates line */
    out.dispose(); out.dispose();
    expect(out.objectDir.disposed()).toBe(true);
    expect(existsSync(d)).toBe(false);
    expect(existsSync(join(r.dir, '.git/objects/info/alternates'))).toBe(false);
    expect(spawnSync('git', ['cat-file', '-e', `${out.head}^{commit}`], { cwd: r.dir }).status).not.toBe(0); /* hash survives, objects do not */
  });
  it('a refusal carries no object dir (already cleaned)', () => {
    const r = repo(); W(join(r.dir, '.env'), SECRET);
    const before = objDirs();
    const out = snap(r);
    expect(Object.keys(out)).toEqual(['refused', 'paths']);
    expect(objDirs()).toEqual(before);
  });
  it('after dispose, the same alternates line written back is an isolation finding again (registry is live-only)', async () => {
    const r = repo(); W(join(r.dir, 'b.txt'), 'x\n');
    const out = snap(r) as S.SnapshotResult; const d = out.objectDir.path; const h = out.head;
    out.dispose();
    W(join(r.dir, '.git/objects/info/alternates'), `${d}\n`);
    const diff = await G.recordGitDiff({ base: r.head, head: h, cwd: r.dir, runner: G.spawnVerifierRunner({ timeoutMs: 30_000 }) });
    expect(diff?.isolationFindings).toContain('objects/info/alternates');
  });
  it('S25 kill: a refusal AFTER the object dir exists (objects/info is a file, so the alternates line cannot be written) removes the dir', () => {
    const r = repo(); rmSync(join(r.dir, '.git/objects/info'), { recursive: true, force: true }); writeFileSync(join(r.dir, '.git/objects/info'), '');
    const before = objDirs();
    expect(snap(r)).toEqual({ refused: 'safe_git_alternates_present' });
    expect(objDirs()).toEqual(before);
  });
  it('a pre-existing objects/info/alternates is refused (it could inject objects)', () => {
    const r = repo(); W(join(r.dir, '.git/objects/info/alternates'), '/tmp/elsewhere\n');
    expect(snap(r)).toEqual({ refused: 'safe_git_alternates_present' });
  });
  it('the recorded tree equals the no-follow walk (file list and modes)', () => {
    const r = repo(); W(join(r.dir, 'd/e.txt'), 'e\n');
    const out = snap(r) as S.SnapshotResult;
    expect(execFileSync('git', ['ls-tree', '-r', '--name-only', out.head], { cwd: r.dir }).toString().trim().split('\n')).toEqual(out.included);
    out.dispose();
  });
});
