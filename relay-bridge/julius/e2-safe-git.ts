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
import { lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { E2_GIT_ENV, E2_VERIFIER_PATH, e2GitPins } from './e2-evidence-gate';

export const SAFE_GIT_REASONS = Object.freeze(['safe_git_workspace_invalid', 'safe_git_dir_not_plain', 'safe_git_config_unparsed', 'safe_git_config_include', 'safe_git_config_filter',
  'safe_git_config_core', 'safe_git_config_alias', 'safe_git_config_extensions', 'safe_git_config_other', 'safe_git_head_unreadable', 'safe_git_parent_invalid', 'safe_git_tree_unreadable', 'safe_git_write_failed'] as const);
export type SafeGitRefusal = typeof SAFE_GIT_REASONS[number];
type Refused = { readonly refused: SafeGitRefusal };
const no = (refused: SafeGitRefusal): Refused => Object.freeze({ refused });

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
function walk(ws: string): { entries: Entry[]; outsideLinks: string[] } {
  const entries: Entry[] = []; const outsideLinks: string[] = [];
  const rec = (rel: string): void => {
    for (const d of readdirSync(join(ws, rel), { withFileTypes: true })) {
      if (d.name === '.git') continue;
      const p = rel === '' ? d.name : `${rel}/${d.name}`;
      const abs = join(ws, p);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) {
        const target = readlinkSync(abs);
        const r = relative(ws, resolve(dirname(abs), target));
        if (r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)) outsideLinks.push(p);
        entries.push({ mode: '120000', data: Buffer.from(target), path: p });
      } else if (st.isDirectory()) rec(p);
      else if (st.isFile()) entries.push({ mode: (st.mode & 0o111) !== 0 ? '100755' : '100644', data: readFileSync(abs), path: p });
    }
  };
  rec('');
  return { entries: entries.sort((a, b) => (a.path < b.path ? -1 : 1)), outsideLinks: outsideLinks.sort() };
}
/** Snapshots the working tree into a commit on `parent` with plumbing only; see the module comment. */
export function snapshotCommitSafely(input: { readonly workspace: string; readonly parent: string; readonly message: string; readonly author: { readonly name: string; readonly email: string } }):
  { readonly commit: string; readonly tree: string; readonly outsideLinks: readonly string[]; readonly configKeys: readonly string[] } | Refused {
  const c = check(input?.workspace);
  if ('refused' in c) return c;
  if (typeof input.parent !== 'string' || !SHA.test(input.parent) || sg(c, ['rev-parse', '--verify', '-q', `${input.parent}^{commit}`])?.trim() !== input.parent) return no('safe_git_parent_invalid');
  let w;
  try { w = walk(c.ws); } catch { return no('safe_git_tree_unreadable'); }
  const tmp = mkdtempSync(join(tmpdir(), 'e2-safe-git-'));
  try {
    const lines: string[] = [];
    for (const e of w.entries) {
      const oid = sg(c, ['hash-object', '-w', '--no-filters', '--stdin'], { input: e.data })?.trim() ?? '';
      if (!SHA.test(oid)) return no('safe_git_write_failed');
      lines.push(`${e.mode} ${oid}\t${e.path}`);
    }
    const idx = { GIT_INDEX_FILE: join(tmp, 'index') };
    if (sg(c, ['update-index', '-z', '--index-info'], { input: lines.map((l) => `${l}\u0000`).join(''), env: idx }) === null) return no('safe_git_write_failed');
    const tree = sg(c, ['write-tree'], { env: idx })?.trim() ?? '';
    if (!SHA.test(tree)) return no('safe_git_write_failed');
    const who = { GIT_AUTHOR_NAME: input.author.name, GIT_AUTHOR_EMAIL: input.author.email, GIT_COMMITTER_NAME: input.author.name, GIT_COMMITTER_EMAIL: input.author.email };
    const commit = sg(c, ['commit-tree', tree, '-p', input.parent, '-F', '-'], { input: input.message, env: who })?.trim() ?? '';
    if (!SHA.test(commit)) return no('safe_git_write_failed');
    return Object.freeze({ commit, tree, outsideLinks: Object.freeze(w.outsideLinks), configKeys: c.configKeys });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
