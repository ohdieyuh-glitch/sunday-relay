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
  /* Round 9: */ 'safe_git_head_not_parent', 'safe_git_secret_path', 'safe_git_dropped_path', 'safe_git_tree_mismatch', 'safe_git_alternates_present', 'safe_git_objdir_failed'] as const);
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
export function isDroppedPath(p: string): boolean {
  return p.split('/').some((c) => { const n = c.toLowerCase().replace(/[. ]+$/u, ''); return n === '.git' || /^git~\d+$/u.test(n); });
}
function walk(ws: string): { entries: Entry[]; outsideLinks: string[]; secret: string[]; dropped: string[] } {
  const entries: Entry[] = []; const outsideLinks: string[] = []; const secret: string[] = []; const dropped: string[] = [];
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
    }
  };
  rec('');
  const byPath = (a: { path: string } | string, b: { path: string } | string): number => { const x = typeof a === 'string' ? a : a.path; const y = typeof b === 'string' ? b : b.path; return x < y ? -1 : x > y ? 1 : 0; };
  return { entries: entries.sort(byPath), outsideLinks: outsideLinks.sort(), secret: secret.sort(), dropped: dropped.sort() };
}
/**
 * Round 10 (Skywalker 5a6e3400: the Round 9 registry + alternates-line design is withdrawn): the throwaway object
 * directory the snapshot's objects live in. Created by snapshotCommitSafely outside the workspace, mode 0700, unique.
 * NOTHING is written into the coder's .git. The caller passes `objectDir.path` to recordGitDiff({ objectDir }), which
 * checks it (checkSnapshotObjectDir) and hands it to git only through the gate's fixed module-git env
 * (GIT_ALTERNATE_OBJECT_DIRECTORIES). dispose() removes the directory; idempotent. After dispose the head hash survives
 * but its objects can no longer be read.
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
 * (safe_git_tree_mismatch). Objects go only to the throwaway object dir. Wiring order: snapshot -> recordGitDiff({ objectDir:
 * objectDir.path }) -> e2Gate -> dispose() in a finally. A refusal carries no object dir (already cleaned).
 */
export function snapshotCommitSafely(input: { readonly workspace: string; readonly parent: string; readonly message: string; readonly author: { readonly name: string; readonly email: string }; readonly allowHeadNotParent?: true }):
  SnapshotResult | Refused {
  const c = check(input?.workspace);
  if ('refused' in c) return c;
  if (typeof input.parent !== 'string' || !SHA.test(input.parent) || sg(c, ['rev-parse', '--verify', '-q', `${input.parent}^{commit}`])?.trim() !== input.parent) return no('safe_git_parent_invalid');
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
  const obj = { GIT_OBJECT_DIRECTORY: objDir, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(c.gitDir, 'objects') };
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
    const got = listed.split('\u0000').filter((x) => x !== '').map((l) => { const [meta, path] = l.split('\t'); return `${(meta ?? '').split(' ')[0]} ${path}`; });
    const want = w.entries.map((e) => `${e.mode} ${e.path}`);
    if (got.length !== want.length || got.some((g, i) => g !== want[i])) return no('safe_git_tree_mismatch');
    const who = { ...obj, GIT_AUTHOR_NAME: input.author.name, GIT_AUTHOR_EMAIL: input.author.email, GIT_COMMITTER_NAME: input.author.name, GIT_COMMITTER_EMAIL: input.author.email };
    const head = sg(c, ['commit-tree', tree, '-p', input.parent, '-F', '-'], { input: input.message, env: who })?.trim() ?? '';
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
