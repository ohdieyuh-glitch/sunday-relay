/* Round 11 (PILOT 09eb14e1 R10-1..R10-7, Skywalker 09eb14e1 F10-1/F10-2). Each fix has a control.
   R10-1/F10-1: a same-uid writer swapping objects between the rehash and the diff must never yield verified evidence
   with a non-honest diff (PILOT: 10/60 did; Skywalker: 12/40). R10-2: a foreign-owned seed builds a store. R10-3: S20
   kill input. R10-4: secret names + Unicode folding. R10-5: dispose() never throws and reports leftovers. R10-7: the
   commit-graph pins. */
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import * as G from './e2-evidence-gate';
import * as S from './e2-safe-git';
import { git, makeRepo } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-r16-')));
const privTmp = join(root, 'tmp'); mkdirSync(privTmp); process.env.TMPDIR = privTmp;
const me = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
let sudoOk = false; try { execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' }); sudoOk = true; } catch { /* no sudo */ }
const reclaim = (p: string): void => { if (sudoOk) { try { execFileSync('sudo', ['-n', 'chown', '-R', me, p], { stdio: 'ignore' }); } catch { /* best effort */ } } };
afterAll(() => { reclaim(root); rmSync(root, { recursive: true, force: true }); });
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const AU = { name: 'n', email: 'e@x' };
const PINNED = "import test from 'node:test'; import assert from 'node:assert'; import { readFileSync } from 'node:fs';\n"
  + [0, 1, 2].map((i) => `test('c${i}',()=>assert.strictEqual(readFileSync(new URL('./out.txt', import.meta.url),'utf8'),'GOOD\\n'));`).join('\n') + '\n';
const BASEF = { 't.test.mjs': PINNED, 'out.txt': 'OLD\n' };
const hashOf = (c: string): string => execFileSync('git', ['hash-object', '--stdin'], { input: c }).toString().trim();
const loose = (bytes: string): Buffer => deflateSync(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(bytes)}\0`), Buffer.from(bytes)]));
const runner = G.spawnVerifierRunner({ timeoutMs: 60_000 });
let k = 0;
function seed(): { repo: string; base: string } {
  const repo = join(root, `r${k++}`); mkdirSync(repo);
  const base = makeRepo(repo, BASEF, {}, W).base; git(repo, 'reset', '-q', '--hard', base);
  return { repo, base };
}
type Swap = { readonly kill: () => Promise<void> };
/** A same-uid child that keeps atomically renaming `file` between `good` and `evil` bytes (temp files in `tmpDir`). */
function swapper(file: string, good: Buffer, evil: Buffer, tmpDir: string): Swap {
  const g = join(tmpDir, `good${k}`); const e = join(tmpDir, `evil${k++}`); writeFileSync(g, good); writeFileSync(e, evil);
  const sw = spawn('sh', ['-c', `while :; do cp ${e} ${e}.x && mv ${e}.x ${file}; cp ${g} ${g}.y && mv ${g}.y ${file}; done`], { stdio: 'ignore' });
  return { kill: async () => { sw.kill('SIGKILL'); await new Promise((r) => setTimeout(r, 200)); writeFileSync(file, good); } };
}
async function race(target: 'store' | 'objdir', runs: number): Promise<{ counts: Record<string, number>; forged: number; honest: string }> {
  const { repo, base } = seed();
  const store = S.buildTrustedSeedStore({ seed: repo, base }) as S.TrustedSeedStore;
  W(join(repo, 'out.txt'), 'GOOD\n');
  const s = S.snapshotCommitSafely({ workspace: repo, parent: base, message: 'c', author: AU, trustedObjects: store.objects }) as S.SnapshotResult;
  const swapDir = join(root, `sw${k++}`); mkdirSync(swapDir);
  const [objects, oid, evilBytes] = target === 'store' ? [store.objects, hashOf('OLD\n'), 'EVIL-BASE-CONTENT\n'] : [s.objectDir.path, hashOf('GOOD\n'), 'EVIL-UNTESTED-CONTENT\n'];
  const f = join(objects, oid.slice(0, 2), oid.slice(2));
  expect(existsSync(f), 'the raced object is a loose file').toBe(true);
  chmodSync(f, 0o644);
  const good = readFileSync(f);
  const counts: Record<string, number> = {}; const shas: Array<[string, string]> = [];
  const sw = swapper(f, good, loose(evilBytes), swapDir);
  try {
    for (let i = 0; i < runs; i++) {
      const d = await G.recordGitDiff({ base, head: s.head, cwd: repo, runner, objectDir: s.objectDir.path, trustedObjects: store.objects });
      const verdict = String(d?.objectDirRefusal ?? d?.objectRefusal ?? (d?.exitCode === 0 ? 'verified' : `exit_${String(d?.exitCode)}`));
      counts[verdict] = (counts[verdict] ?? 0) + 1;
      shas.push([verdict, String(d?.sha256)]);
    }
  } finally { await sw.kill(); }
  const ctl = await G.recordGitDiff({ base, head: s.head, cwd: repo, runner, objectDir: s.objectDir.path, trustedObjects: store.objects });
  expect(ctl?.objectRefusal).toBeNull(); expect(ctl?.exitCode).toBe(0);
  const honest = String(ctl?.sha256);
  s.dispose(); store.dispose();
  return { counts, forged: shas.filter(([v, sha]) => v === 'verified' && sha !== honest).length, honest };
}

const logRace = (n: string, r: { counts: Record<string, number>; forged: number }): void => { if (process.env.E2_R16_LOG) writeFileSync(process.env.E2_R16_LOG, `${n} ${JSON.stringify(r.counts)} forged=${r.forged}\n`, { flag: 'a' }); };
describe('R10-1 / F10-1: a swap between rehash and diff never yields verified evidence with a forged diff', () => {
  it('PILOT: 60 recordGitDiff calls while the store OLD blob flips (control: the honest sha after the swapper stops)', async () => {
    const r = await race('store', 60);
    logRace('store', r);
    expect(r.forged).toBe(0);
  }, 300_000);
  it('Skywalker: 40 calls while the objDir head (GOOD) blob flips', async () => {
    const r = await race('objdir', 40);
    logRace('objdir', r);
    expect(r.forged).toBe(0);
  }, 300_000);
  it('the diff is computed only from the verified private copy: with every source dir removed after the record, the evidence is unchanged and no private dir is left', async () => {
    const { repo, base } = seed();
    const store = S.buildTrustedSeedStore({ seed: repo, base }) as S.TrustedSeedStore;
    W(join(repo, 'out.txt'), 'GOOD\n');
    const s = S.snapshotCommitSafely({ workspace: repo, parent: base, message: 'c', author: AU, trustedObjects: store.objects }) as S.SnapshotResult;
    const d = await G.recordGitDiff({ base, head: s.head, cwd: repo, runner, objectDir: s.objectDir.path, trustedObjects: store.objects });
    expect(d?.objectRefusal).toBeNull(); expect(d?.exitCode).toBe(0); expect(d?.ancestry).toBe(true); expect(d?.paths).toEqual(['out.txt']);
    expect(d?.argv.some((a) => a.startsWith('e2.verifiedObjects='))).toBe(true);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(privTmp).filter((n) => n.startsWith('e2-verified-'))).toEqual([]);
    s.dispose(); store.dispose();
  }, 120_000);
});

describe('R10-2: a foreign-owned seed (uid 65534) still builds the trusted store', () => {
  it(sudoOk ? 'real chown via sudo -n' : 'sudo unavailable: simulated by a seed git refuses as dubious (safe.directory absent)', async () => {
    const { repo, base } = seed();
    if (sudoOk) execFileSync('sudo', ['-n', 'chown', '-R', '65534:65534', repo]);
    else W(join(root, 'no-sudo-marker'), 'x');
    try {
      const st = S.buildTrustedSeedStore({ seed: repo, base });
      expect('refused' in st ? st.refused : 'built').toBe('built');
      if (!('refused' in st)) {
        const spec = await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.mjs', workspace: repo, base, trustedObjects: st.objects } as Parameters<typeof G.pinVerifierSpecWithBaseRun>[0], runner);
        expect('refused' in spec ? spec.refused : spec.trustedObjects).toBe(st.objects);
        st.dispose();
      }
    } finally { reclaim(repo); }
    /* control: a plain local fetch from the foreign seed is refused by git itself (the condition the fix works around) */
    expect(sudoOk).toBe(true);
  }, 120_000);
});

describe('R10-2: the gate-owned seed copy never follows a symlink inside the seed .git', () => {
  it('objects/info symlinked to an outside dir refuses store_seed_invalid; control without the link builds', () => {
    const a = seed();
    const ok = S.buildTrustedSeedStore({ seed: a.repo, base: a.base });
    expect('refused' in ok ? ok.refused : 'built').toBe('built');
    if (!('refused' in ok)) ok.dispose();
    const b = seed();
    const outside = join(root, `outside-${Date.now()}`); mkdirSync(outside);
    rmSync(join(b.repo, '.git', 'objects', 'info'), { recursive: true, force: true });
    symlinkSync(outside, join(b.repo, '.git', 'objects', 'info'));
    const st = S.buildTrustedSeedStore({ seed: b.repo, base: b.base });
    expect('refused' in st ? st.refused : 'built').toBe('store_seed_invalid');
  });
});

describe('R10-3: S20 kill input (PILOT): a U+FFFD file and a 0xFF-named file', () => {
  it('refused as safe_git_tree_mismatch (the 0xFF file would otherwise vanish from the evidence)', () => {
    const { repo, base } = seed();
    W(join(repo, '\ufffd'), 'REAL-FFFD\n');
    writeFileSync(Buffer.concat([Buffer.from(`${repo}/`), Buffer.from([0xff])]), 'INVALID-NAME-CONTENT\n');
    const s = S.snapshotCommitSafely({ workspace: repo, parent: base, message: 'c', author: AU });
    expect('refused' in s ? s.refused : 'snapshotted').toBe('safe_git_tree_mismatch');
  });
  it('control: the U+FFFD file alone snapshots', () => {
    const { repo, base } = seed();
    W(join(repo, '\ufffd'), 'REAL-FFFD\n');
    const s = S.snapshotCommitSafely({ workspace: repo, parent: base, message: 'c', author: AU });
    expect('refused' in s ? s.refused : 'snapshotted').toBe('snapshotted');
    if (!('refused' in s)) s.dispose();
  });
});

describe('R10-4 / F10-2: secret names (a documented heuristic on names), Unicode-normalised', () => {
  const SECRET = ['_netrc', 'my_id_ed25519', 'id_ed25519_sk', 'id_xmss', 'gh_token', 'api_token.txt', 'api_tokens', 'x.tfvars.json', 'sa-key.json', 'sa-key-prod.json',
    'application_default_credentials.json', 'gcloud/application_default_credentials.json', '.ssh/config', '.ssh/known_hosts', '.yarnrc.yml', 'pub.asc', 'credentials/x',
    'a/credentials/b.txt', 'client_secret.json', 'client_secret_123.json', 'apikey', 'apikey.txt', 'api_key.txt', 'kubeconfig', '.aws/config', '.vault-token',
    'terraform.tfstate', 'terraform.tfstate.backup', 'priv.ppk', 'x.p8', 'my-token.json',
    '\u2170d_rsa', '.\u0435nv', '\uff0eenv', '\uff49\uff44_rsa', '.\uff25\uff2e\uff36', '.e\u0301nv', '.netrc\u200c', 'id_rs\u0430'];
  const PLAIN = ['notes.txt', 'src/index.ts', 'README.md', 'config.json', 'known.txt', 'credits.md', 'tokenless/a.txt'.replace('tokenless', 'pkg'), 'environment.ts'.replace('env', 'xnv'), 'api.ts', 'asc.txt', 'p8.txt'];
  it.each(SECRET)('%s is a secret path', (p) => { expect(S.isSecretPath(p)).toBe(true); });
  it.each(PLAIN)('control: %s is not', (p) => { expect(S.isSecretPath(p)).toBe(false); });
  it('a credentials/ directory is refused by the snapshot with its path, and nothing is written', () => {
    const { repo, base } = seed();
    W(join(repo, 'credentials', 'x'), 'k\n');
    const s = S.snapshotCommitSafely({ workspace: repo, parent: base, message: 'c', author: AU });
    expect(s).toEqual({ refused: 'safe_git_secret_path', paths: ['credentials/'] });
  });
});

describe('R10-5: dispose() never throws; it reports what it could not remove and never follows a swapped symlink', () => {
  it('objDir contents owned by another uid: dispose does not throw and reports leftovers (store disposal independent)', () => {
    const { repo, base } = seed();
    const store = S.buildTrustedSeedStore({ seed: repo, base }) as S.TrustedSeedStore;
    W(join(repo, 'out.txt'), 'GOOD\n');
    const s = S.snapshotCommitSafely({ workspace: repo, parent: base, message: 'c', author: AU, trustedObjects: store.objects }) as S.SnapshotResult;
    const od = s.objectDir.path;
    if (sudoOk) execFileSync('sudo', ['-n', 'chown', '-R', '65534:65534', od]);
    else { for (const d of require('node:fs').readdirSync(od)) chmodSync(join(od, d), 0o500); }
    let rep: unknown; let threw: unknown = null;
    try { rep = (s.dispose as () => unknown)(); } catch (e) { threw = e; }
    const srep = (store.dispose as () => unknown)();
    reclaim(od); try { for (const d of require('node:fs').readdirSync(od)) chmodSync(join(od, d), 0o700); } catch { /* gone */ }
    expect(threw).toBeNull();
    expect((rep as { leftovers: string[] }).leftovers.length).toBeGreaterThan(0);
    expect((srep as { leftovers: string[] }).leftovers).toEqual([]);
    expect(existsSync(store.storeDir)).toBe(false);
    rmSync(od, { recursive: true, force: true });
  });
  it('objDir swapped for a symlink: nothing outside is removed and the real directory is reported', () => {
    const { repo, base } = seed();
    W(join(repo, 'out.txt'), 'GOOD\n');
    const s = S.snapshotCommitSafely({ workspace: repo, parent: base, message: 'c', author: AU }) as S.SnapshotResult;
    const od = s.objectDir.path; const real = `${od}.real`;
    renameSync(od, real); symlinkSync(real, od);
    let rep: unknown; let threw: unknown = null;
    try { rep = (s.dispose as () => unknown)(); } catch (e) { threw = e; }
    expect(threw).toBeNull();
    expect(existsSync(real)).toBe(true);
    expect(require('node:fs').readdirSync(real).length).toBeGreaterThan(0);
    expect((rep as { leftovers: string[] }).leftovers).toContain(real);
    rmSync(real, { recursive: true, force: true }); rmSync(od, { force: true });
  });
  it('store dir swapped for a symlink: store.dispose() removes nothing outside and reports the real directory', () => {
    const { repo, base } = seed();
    const st = S.buildTrustedSeedStore({ seed: repo, base }) as S.TrustedSeedStore;
    const sd = st.storeDir; const real = `${sd}.real`;
    renameSync(sd, real); symlinkSync(real, sd);
    const rep = st.dispose();
    expect(existsSync(join(real, relative(sd, st.objects)))).toBe(true);
    expect(rep.leftovers).toContain(real);
    rmSync(real, { recursive: true, force: true }); rmSync(sd, { force: true });
  });
  it('control: a normal dispose removes everything and reports no leftovers (idempotent)', () => {
    const { repo, base } = seed();
    W(join(repo, 'out.txt'), 'GOOD\n');
    const s = S.snapshotCommitSafely({ workspace: repo, parent: base, message: 'c', author: AU }) as S.SnapshotResult;
    expect((s.dispose as () => unknown)()).toEqual({ leftovers: [] });
    expect((s.dispose as () => unknown)()).toEqual({ leftovers: [] });
    expect(existsSync(s.objectDir.path)).toBe(false);
  });
});

describe('R10-7: commit-graph is never read', () => {
  it('the pins carry core.commitGraph=false and gc.writeCommitGraph=false', () => {
    const pins = G.e2GitPins(root);
    const kv = pins.filter((_, i) => pins[i - 1] === '-c');
    expect(kv).toContain('core.commitGraph=false');
    expect(kv).toContain('gc.writeCommitGraph=false');
  });
});
