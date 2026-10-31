/**
 * Round 8 R7-1 (Skywalker ba9ee244, + 5:08 PM steering): a safe primitive for the wiring to record the coder's head
 * (and, if it must, snapshot the working tree into a commit) WITHOUT plain git porcelain in a coder-controlled repo.
 *
 * Order, for both entry points:
 *  1. `<workspace>/.git` must be a real directory (not a gitfile, not a symlink, no `commondir`): else safe_git_dir_not_plain.
 *  2. `.git/config` (and `.git/config.worktree` if present) are parsed by THIS module, without git. Any key outside the
 *     allowlist {@link SAFE_GIT_ALLOWED_KEY} is refused with a named code: include/includeIf -> safe_git_config_include,
 *     filter.* -> safe_git_config_filter, core.{fsmonitor,hooksPath,worktree,sshCommand,pager,editor,askPass,gitProxy,
 *     attributesFile,...} -> safe_git_config_core, alias.* -> safe_git_config_alias, extensions.* (incl. worktreeConfig)
 *     -> safe_git_config_extensions, anything else not allowlisted -> safe_git_config_other; an unparsable file ->
 *     safe_git_config_unparsed. Nothing has run yet.
 *  3. Only then git runs, with {@link e2GitPins} (the gate's pins + safe.directory=<realpath>), `-c commit.gpgSign=false`,
 *     the gate's env (E2_GIT_ENV: no global/system config or attributes, GIT_GRAFT_FILE=/dev/null, no replace refs),
 *     GIT_DIR pinned, a fixed PATH and nothing else from the caller's env. Head: `rev-parse --verify HEAD^{commit}` only.
 *     Snapshot: files are read by THIS module with lstat (symlinks are recorded as 120000 links, never followed; links that
 *     resolve outside the workspace are reported in `outsideLinks`), then `hash-object -w --no-filters --stdin`,
 *     `update-index -z --index-info` into a private GIT_INDEX_FILE, `write-tree`, `commit-tree`. Never status, add,
 *     checkout or commit; no hooks (core.hooksPath=/dev/null), no fsmonitor, no filters (--no-filters,
 *     core.attributesFile=/dev/null, GIT_ATTR_NOSYSTEM=1, attributes from the empty tree).
 * Returns `{ refused: <code> }` like the gate, so the wiring needs no new code path. Ignore rules are NOT applied by the
 * snapshot (every file except any `.git` entry is recorded).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { E2_GIT_ENV, E2_VERIFIER_PATH, e2GitPins } from './e2-evidence-gate';

export const SAFE_GIT_REASONS = Object.freeze(['safe_git_workspace_invalid', 'safe_git_dir_not_plain', 'safe_git_config_unparsed', 'safe_git_config_include', 'safe_git_config_filter',
  'safe_git_config_core', 'safe_git_config_alias', 'safe_git_config_extensions', 'safe_git_config_other', 'safe_git_head_unreadable', 'safe_git_parent_invalid', 'safe_git_tree_unreadable', 'safe_git_write_failed',
  /* Round 9: */ 'safe_git_head_not_parent', 'safe_git_secret_path', 'safe_git_dropped_path', 'safe_git_tree_mismatch', 'safe_git_alternates_present', 'safe_git_objdir_failed',
  /* Round 10 (PILOT R9-6): */ 'safe_git_special_file'] as const);
export type SafeGitRefusal = typeof SAFE_GIT_REASONS[number];
type Refused = { readonly refused: SafeGitRefusal; readonly paths?: readonly string[] };
const no = (refused: SafeGitRefusal, paths?: readonly string[]): Refused => Object.freeze(paths === undefined ? { refused } : { refused, paths: Object.freeze([...paths]) });

/** Allowed repository-config keys (lower-cased `section.key`; a subsection is `*`). */
export const SAFE_GIT_ALLOWED_KEY: ReadonlySet<string> = new Set([
  'core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase', 'core.precomposeunicode', 'core.symlinks',
  'user.name', 'user.email', 'remote.*.url', 'remote.*.fetch', 'branch.*.remote', 'branch.*.merge', 'init.defaultbranch', 'commit.gpgsign', 'gc.auto',
]);
const CORE_DANGEROUS = new Set(['fsmonitor', 'hookspath', 'worktree', 'sshcommand', 'pager', 'editor', 'askpass', 'gitproxy', 'attributesfile', 'excludesfile', 'untrackedcache', 'splitindex', 'alternaterefscommand']);
/** Parses a git config file; returns its keys (`section.key` / `section.*.key`, lower-cased) or null if unparsable. */
export function parseGitConfigKeys(text: string): string[] | null {
  const keys: string[] = [];
  let section: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/u, '').trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\\n]|\\.)*)")?\s*\]\s*(?:[#;].*)?$/u.exec(line);
    if (sec !== null) {
      const name = (sec[1] as string).toLowerCase();
      if (sec[2] !== undefined) section = `${name}.*`;
      else if (name.includes('.')) section = `${name.split('.')[0]}.*`; /* deprecated [section.sub] form */
      else section = name;
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=(.*))?$/u.exec(line);
    if (kv === null || section === null) return null;
    if (/\\$/u.test(kv[2] ?? '')) return null; /* continuation lines are refused rather than modelled */
    keys.push(`${section}.${(kv[1] as string).toLowerCase()}`);
  }
  return keys;
}
function classify(key: string): SafeGitRefusal | null {
  if (SAFE_GIT_ALLOWED_KEY.has(key)) return null;
  const [s, ...rest] = key.split('.');
  const last = rest[rest.length - 1] ?? '';
  if (s === 'include' || s === 'includeif') return 'safe_git_config_include';
  if (s === 'filter') return 'safe_git_config_filter';
  if (s === 'alias') return 'safe_git_config_alias';
  if (s === 'extensions') return 'safe_git_config_extensions';
  if (s === 'core' && CORE_DANGEROUS.has(last)) return 'safe_git_config_core';
  return 'safe_git_config_other';
}
type Checked = { readonly gitDir: string; readonly ws: string; readonly configKeys: readonly string[] };
function check(workspace: unknown): Checked | Refused {
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) return no('safe_git_workspace_invalid');
  let ws: string;
  try { ws = realpathSync(workspace); if (!lstatSync(ws).isDirectory()) return no('safe_git_workspace_invalid'); } catch { return no('safe_git_workspace_invalid'); }
  const gitDir = join(ws, '.git');
  try {
    const st = lstatSync(gitDir);
    if (st.isSymbolicLink() || !st.isDirectory()) return no('safe_git_dir_not_plain');
  } catch { return no('safe_git_dir_not_plain'); }
  try { lstatSync(join(gitDir, 'commondir')); return no('safe_git_dir_not_plain'); } catch { /* absent: good */ }
  const keys: string[] = [];
  for (const name of ['config', 'config.worktree']) {
    const p = join(gitDir, name);
    let st;
    try { st = lstatSync(p); } catch { if (name === 'config') return no('safe_git_dir_not_plain'); continue; }
    if (!st.isFile()) return no('safe_git_dir_not_plain');
    let parsed: string[] | null;
    try { parsed = parseGitConfigKeys(readFileSync(p, 'utf8')); } catch { parsed = null; }
    if (parsed === null) return no('safe_git_config_unparsed');
    for (const k of parsed) { const bad = classify(k); if (bad !== null) return no(bad); }
    if (name === 'config.worktree') return no('safe_git_config_extensions'); /* only meaningful with extensions.worktreeConfig */
    keys.push(...parsed);
  }
  return { gitDir, ws, configKeys: Object.freeze([...new Set(keys)].sort()) };
}
export const SAFE_GIT_EXTRA_PINS = Object.freeze(['-c', 'commit.gpgSign=false']);
/** The ONE git spawn site in this module: pins, safe.directory, the gate's env, GIT_DIR, fixed PATH, nothing else. */
function sg(c: Checked, args: readonly string[], opts: { input?: Buffer | string; env?: Record<string, string> } = {}): string | null {
  try {
    return execFileSync('git', [...e2GitPins(c.ws), ...SAFE_GIT_EXTRA_PINS, ...args], {
      cwd: c.ws, shell: false, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024, input: opts.input ?? '',
      /* caller extras (index file, identity) first, so they can never override the gate env, GIT_DIR or PATH. */
      env: { ...(opts.env ?? {}), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', ...E2_GIT_ENV, GIT_DIR: c.gitDir, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', PATH: E2_VERIFIER_PATH },
    }).toString('utf8');
  } catch { return null; }
}
const SHA = /^[0-9a-f]{40}$/u;
/** Records HEAD safely. Returns the head SHA and the repository config keys seen, or `{refused}`. */
export function recordHeadSafely(input: { readonly workspace: string }): { readonly head: string; readonly configKeys: readonly string[] } | Refused {
  const c = check(input?.workspace);
  if ('refused' in c) return c;
  const out = sg(c, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  const head = out?.trim() ?? '';
  return SHA.test(head) ? Object.freeze({ head, configKeys: c.configKeys }) : no('safe_git_head_unreadable');
}
type Entry = { mode: string; data: Buffer; path: string };
/**
 * Round 9 (PILOT R8-2) + Round 10 (F9-4): secret-looking paths are refused by name (a heuristic: names, never contents;
 * the refusal lists paths only), whatever the coder's .gitignore / info/exclude say (those
 * are never read). A secret-path refusal is a FAILED run, never a pass.
 */
export function isSecretPath(p: string): boolean {
  const parts = p.split('/'); const base = (parts[parts.length - 1] ?? '').toLowerCase();
  if (parts.slice(0, -1).some((d) => /^secret/iu.test(d))) return true;
  const parent = (parts[parts.length - 2] ?? '').toLowerCase();
  return /^\.env/u.test(base) || base.endsWith('.pem') || base.endsWith('.key') || base.startsWith('id_rsa') || base.startsWith('credentials')
    || base === '.npmrc' || base === '.netrc' || /^secret/u.test(base)
    /* Round 10 (Skywalker F9-4): more key and credential names. Still a heuristic on NAMES only. */
    || /^id_(ed25519|ecdsa|dsa)/u.test(base) || base === '.git-credentials' || /\.(p12|pfx|keystore|jks|gpg)$/u.test(base)
    || base === '.pgpass' || base === '.pypirc' || base === '.dockercfg' || base.startsWith('token') || base.endsWith('.tfvars') || /^service-account.*\.json$/u.test(base)
    || (parent === '.kube' && base === 'config') || (parent === '.docker' && base === 'config.json')
    || (base.endsWith('.asc') && /(priv|secret|secring)/u.test(base));
}
/** Round 9 (PILOT R8-3): a path component git refuses or silently drops (.git in any case, with trailing dots/spaces, or the 8.3 alias git~N). */
/* Round 10 (PILOT R9-6): HFS+ ignores these code points when comparing names (git's is_hfs_dotgit), so `.git\u200c` IS
   `.git` on macOS. Deliberately treated as `.git` everywhere (refused as dropped), whatever the gate's own OS. */
const HFS_IGNORABLE = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/gu;
export function isDroppedPath(p: string): boolean {
  return p.split('/').some((c) => { const n = c.replace(HFS_IGNORABLE, '').toLowerCase().replace(/[. ]+$/u, ''); return n === '.git' || /^git~\d+$/u.test(n); });
}
/** Round 10 (PILOT R9-5): git's order is UTF-8 byte order; JS `<` is UTF-16 code-unit order (U+FFFD vs U+1F600 differ). */
const byteOrder = (x: string, y: string): number => Buffer.compare(Buffer.from(x, 'utf8'), Buffer.from(y, 'utf8'));
function walk(ws: string): { entries: Entry[]; outsideLinks: string[]; secret: string[]; dropped: string[]; special: string[] } {
  const entries: Entry[] = []; const outsideLinks: string[] = []; const secret: string[] = []; const dropped: string[] = []; const special: string[] = [];
  const rec = (rel: string): void => {
    for (const d of readdirSync(join(ws, rel), { withFileTypes: true })) {
      if (rel === '' && d.name === '.git') continue;
      const p = rel === '' ? d.name : `${rel}/${d.name}`;
      if (isDroppedPath(p)) { dropped.push(p); continue; }
      const abs = join(ws, p);
      const st = lstatSync(abs);
      if (st.isDirectory()) { if (/^(secret|\.env)/iu.test(d.name)) { secret.push(`${p}/`); continue; } rec(p); continue; }
      if (isSecretPath(p)) { secret.push(p); continue; }
      if (st.isSymbolicLink()) {
        const target = readlinkSync(abs);
        const r = relative(ws, resolve(dirname(abs), target));
        if (r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)) outsideLinks.push(p);
        entries.push({ mode: '120000', data: Buffer.from(target), path: p });
      } else if (st.isFile()) entries.push({ mode: (st.mode & 0o111) !== 0 ? '100755' : '100644', data: readFileSync(abs), path: p });
      else special.push(p); /* Round 10 R9-6: FIFO, socket, device: refused by name, never silently skipped */
    }
  };
  rec('');
  return { entries: entries.sort((a, b) => byteOrder(a.path, b.path)), outsideLinks: outsideLinks.sort(byteOrder), secret: secret.sort(byteOrder), dropped: dropped.sort(byteOrder), special: special.sort(byteOrder) };
}
/**
 * Round 10 (Skywalker 5a6e3400: the Round 9 registry + alternates-line design is withdrawn): the throwaway object
 * directory the snapshot's objects live in. Created by snapshotCommitSafely outside the workspace, mode 0700, unique.
 * NOTHING is written into the coder's .git. The caller passes `objectDir.path` with the trusted seed store to
 * recordGitDiff({ objectDir, trustedObjects }), which checks both and hands them to git only through the gate's fixed
 * module-git env (GIT_OBJECT_DIRECTORY = this dir, GIT_ALTERNATE_OBJECT_DIRECTORIES = the store; the coder's
 * .git/objects is never read). dispose() removes the directory; idempotent.
 */
export type SnapshotObjectDir = { readonly path: string; readonly disposed: () => boolean };
export type SnapshotResult = {
  readonly head: string; readonly tree: string; readonly objectDir: SnapshotObjectDir; readonly dispose: () => void;
  readonly included: readonly string[]; readonly skipped: readonly string[]; readonly outsideLinks: readonly string[]; readonly configKeys: readonly string[];
};
/**
 * Snapshots the working tree into a commit on `parent` with plumbing only; see the module comment.
 * Round 9: refuses unless HEAD == parent (override: `allowHeadNotParent: true`, for a caller that has deliberately moved
 * HEAD and records why); refuses secret-looking paths (safe_git_secret_path, with `paths`) and paths git would drop
 * (safe_git_dropped_path, with `paths`); compares the written tree's file list and modes to the no-follow walk
 * (safe_git_tree_mismatch). Objects go only to the throwaway object dir. Wiring order: buildTrustedSeedStore -> pin ->
 * coder -> kill -> snapshot({ trustedObjects }) -> recordGitDiff({ objectDir, trustedObjects }) -> e2Gate -> dispose() in a finally. A refusal carries no object dir (already cleaned).
 */
export function snapshotCommitSafely(input: { readonly workspace: string; readonly parent: string; readonly message: string; readonly author: { readonly name: string; readonly email: string }; readonly allowHeadNotParent?: true; readonly trustedObjects?: string }):
  SnapshotResult | Refused {
  const c = check(input?.workspace);
  if ('refused' in c) return c;
  if (typeof input.parent !== 'string' || !SHA.test(input.parent) || sg(c, ['rev-parse', '--verify', '-q', `${input.parent}^{commit}`], input.trustedObjects === undefined ? {} : { env: { GIT_OBJECT_DIRECTORY: input.trustedObjects } })?.trim() !== input.parent) return no('safe_git_parent_invalid');
  /* Round 10: with the trusted store, the parent must be the trusted base (read from the store, not the coder's .git). */
  if (input.allowHeadNotParent !== true) {
    const head = sg(c, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'])?.trim() ?? '';
    if (head !== input.parent) return no('safe_git_head_not_parent');
  }
  const altFile = join(c.gitDir, 'objects', 'info', 'alternates');
  if (existsSync(altFile) || lstatExists(altFile)) return no('safe_git_alternates_present');
  let w;
  try { w = walk(c.ws); } catch { return no('safe_git_tree_unreadable'); }
  if (w.dropped.length > 0) return no('safe_git_dropped_path', w.dropped);
  if (w.secret.length > 0) return no('safe_git_secret_path', w.secret);
  if (w.special.length > 0) return no('safe_git_special_file', w.special);
  let objDir: string;
  try {
    objDir = realpathSync(mkdtempSync(join(tmpdir(), 'e2-snap-objects-')));
    chmodSync(objDir, 0o700);
    const r = relative(c.ws, objDir);
    if (!(r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r))) { rmSync(objDir, { recursive: true, force: true }); return no('safe_git_objdir_failed'); }
  } catch { return no('safe_git_objdir_failed'); }
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    rmSync(objDir, { recursive: true, force: true });
  };
  const tmp = mkdtempSync(join(tmpdir(), 'e2-safe-git-'));
  /* Round 10 (PILOT R9-1): the throwaway dir is the ONLY object store. With the coder's store as an alternate, `hash-object
     -w` saw a planted (corrupt) object under the good hash as present and skipped the write. No coder object is read here. */
  const obj = { GIT_OBJECT_DIRECTORY: objDir };
  let ok = false;
  try {
    const lines: string[] = [];
    for (const e of w.entries) {
      const oid = sg(c, ['hash-object', '-w', '--no-filters', '--stdin'], { input: e.data, env: obj })?.trim() ?? '';
      if (!SHA.test(oid)) return no('safe_git_write_failed');
      lines.push(`${e.mode} ${oid}\t${e.path}`);
    }
    const idx = { ...obj, GIT_INDEX_FILE: join(tmp, 'index') };
    if (sg(c, ['update-index', '-z', '--index-info'], { input: lines.map((l) => `${l}\u0000`).join(''), env: idx }) === null) return no('safe_git_write_failed');
    const tree = sg(c, ['write-tree'], { env: idx })?.trim() ?? '';
    if (!SHA.test(tree)) return no('safe_git_write_failed');
    const listed = sg(c, ['ls-tree', '-r', '-z', '--full-tree', tree], { env: obj });
    if (listed === null) return no('safe_git_write_failed');
    /* Round 10 R9-5: both lists in byte order (git's own order), so names whose UTF-16 and UTF-8 orders differ compare equal. */
    const got = listed.split('\u0000').filter((x) => x !== '').map((l) => { const [meta, path] = l.split('\t'); return `${(meta ?? '').split(' ')[0]} ${path}`; }).sort(byteOrder);
    const want = w.entries.map((e) => `${e.mode} ${e.path}`).sort(byteOrder);
    if (got.length !== want.length || got.some((g, i) => g !== want[i])) return no('safe_git_tree_mismatch');
    /* Round 10 R9-1: the commit object is hashed directly (commit-tree would look the parent up in the coder store). */
    const ident = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' && !/[<>\n\r\0]/u.test(x) ? x.trim() : null);
    const name = ident(input.author.name); const email = ident(input.author.email);
    if (name === null || email === null || typeof input.message !== 'string' || input.message.includes('\0')) return no('safe_git_write_failed');
    const when = `${Math.floor(Date.now() / 1000)} +0000`;
    const body = `tree ${tree}\nparent ${input.parent}\nauthor ${name} <${email}> ${when}\ncommitter ${name} <${email}> ${when}\n\n${input.message.endsWith('\n') ? input.message : `${input.message}\n`}`;
    const head = sg(c, ['hash-object', '-t', 'commit', '-w', '--stdin'], { input: body, env: obj })?.trim() ?? '';
    if (!SHA.test(head)) return no('safe_git_write_failed');
    ok = true;
    return Object.freeze({
      head, tree, dispose, objectDir: Object.freeze({ path: objDir, disposed: () => disposed }),
      included: Object.freeze(w.entries.map((e) => e.path)), skipped: Object.freeze(['.git']), outsideLinks: Object.freeze(w.outsideLinks), configKeys: c.configKeys,
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    if (!ok) dispose();
  }
}
function lstatExists(p: string): boolean { try { lstatSync(p); return true; } catch { return false; } }
/**
 * Round 10 (Skywalker amendment to 5a6e3400): the TRUSTED SEED STORE. Build it from the mission seed BEFORE any coder code
 * runs. `git init --bare` in a fresh 0700 directory outside the seed, then `fetch --no-tags <seed> <base>` over the file
 * transport (objects arrive as a pack; index-pack re-hashes every object), then `fsck --strict` on the store. Pin the
 * spec from it (pinVerifierSpecWithBaseRun({ trustedObjects: store.objects })), and pass it to every recordGitDiff
 * ({ objectDir, trustedObjects }). The coder's .git is never a source after this. dispose() removes it; idempotent.
 */
export const TRUSTED_STORE_REASONS = Object.freeze(['store_seed_invalid', 'store_base_missing', 'store_failed'] as const);
export type TrustedStoreRefusal = typeof TRUSTED_STORE_REASONS[number];
export type TrustedSeedStore = { readonly storeDir: string; readonly objects: string; readonly base: string; readonly tree: string; readonly dispose: () => void };
export function buildTrustedSeedStore(input: { readonly seed: string; readonly base: string }): TrustedSeedStore | { readonly refused: TrustedStoreRefusal } {
  const nope = (refused: TrustedStoreRefusal) => Object.freeze({ refused });
  const c = check(input?.seed);
  if ('refused' in c) return nope('store_seed_invalid');
  if (typeof input.base !== 'string' || !SHA.test(input.base)) return nope('store_base_missing');
  let storeDir: string;
  try {
    storeDir = realpathSync(mkdtempSync(join(tmpdir(), 'e2-trusted-store-')));
    chmodSync(storeDir, 0o700);
    const r = relative(c.ws, storeDir);
    if (!(r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r))) { rmSync(storeDir, { recursive: true, force: true }); return nope('store_failed'); }
  } catch { return nope('store_failed'); }
  let ok = false;
  const dispose = (): void => { rmSync(storeDir, { recursive: true, force: true }); };
  try {
    const repo = join(storeDir, 'repo.git');
    const st = { ...c, gitDir: repo };
    if (sg(c, ['init', '-q', '--bare', repo]) === null) return nope('store_failed');
    if (sg(st, ['-c', 'protocol.file.allow=always', 'fetch', '-q', '--no-tags', '--no-write-fetch-head', '--', c.ws, input.base]) === null) {
      return nope(sg(c, ['cat-file', '-e', `${input.base}^{commit}`]) === null ? 'store_base_missing' : 'store_failed');
    }
    if (sg(st, ['rev-parse', '--verify', '-q', `${input.base}^{commit}`])?.trim() !== input.base) return nope('store_base_missing');
    if (sg(st, ['fsck', '--strict', '--no-dangling', '--no-progress']) === null) return nope('store_failed');
    const tree = sg(st, ['rev-parse', '--verify', '-q', `${input.base}^{tree}`])?.trim() ?? '';
    if (!SHA.test(tree)) return nope('store_failed');
    const objects = join(repo, 'objects');
    chmodSync(objects, 0o700);
    ok = true;
    return Object.freeze({ storeDir, objects, base: input.base, tree, dispose });
  } finally { if (!ok) dispose(); }
}
