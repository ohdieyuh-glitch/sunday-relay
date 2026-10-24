/**
 * J1 KEY STORE (port + file implementation). Provider keys never live in the process environment: the coder session inherits the bridge's environment,
 * so a key in it is a key the coder can read. The architect and reviewer legs (which run in the bridge process) get their key from this port
 * at CALL time, from a private file path outside the repository.
 *
 *   - `getKey(name)` opens the file, fstats THAT descriptor, and reads THAT descriptor. Nothing is cached (no field holds a key).
 *   - a symlink is refused (lstat, and an open that reports the path became a link). The bytes and the mode are of one inode.
 *   - the logical key names (OPENAI_API_KEY, XAI_API_KEY) stay as NAMES only; they are the file names inside the key directory.
 *   - errors carry a CODE only: never the path, never the value, never the platform's own message (which names the path).
 *   - the filesystem is injected (`KeyStoreFs`); this module imports no node:fs and reads no environment variable.
 *   - on a platform with POSIX identities (not win32): the owner must be `ownerUid`, and group or world permission refuses.
 *   - `repoRoot` is required. The inside-repo check always runs, on the lexical path and on `realpath`.
 */

export type KeyStoreErrorCode =
  | 'key_name_invalid' | 'key_file_absent' | 'key_file_unreadable' | 'key_file_empty' | 'key_file_mode_too_open'
  | 'key_file_symlink' | 'key_file_wrong_owner'
  | 'key_dir_invalid' | 'key_dir_inside_repo';

/** A coded failure. The message IS the code; there is nothing else on it. */
export class KeyStoreError extends Error {
  constructor(readonly code: KeyStoreErrorCode) { super(code); this.name = 'KeyStoreError'; }
}

export interface KeyStore {
  /** Reads the key NOW. Throws a {@link KeyStoreError}. The caller must not keep the value past its call. */
  getKey(name: string): string;
  /** True when the key file exists and passes the symlink, owner and mode checks. Does not read or return the value. */
  has(name: string): boolean;
}

export interface KeyFileStat {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  readonly mode: number;
  readonly uid: number;
}

/**
 * Open, then fstat, then read the descriptor. `openSync` is the O_NOFOLLOW open:
 * a symlink at the final path throws with code `ELOOP` (or `EPERM`) and is not followed.
 */
export interface KeyStoreFs {
  lstatSync(path: string): KeyFileStat;
  openSync(path: string): number;
  fstatSync(fd: number): KeyFileStat;
  readSync(fd: number): string;
  closeSync(fd: number): void;
}

const NAME = /^[A-Z][A-Z0-9_]{2,63}$/u;
const slashes = (p: string): string => p.replace(/\\/gu, '/');

function resolveSegments(path: string): string {
  const out: string[] = [];
  for (const seg of slashes(path).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/').toLowerCase();
}

function ioCode(error: unknown): string | undefined {
  return (error as { code?: unknown }).code === undefined ? undefined : String((error as { code?: unknown }).code);
}

export function createFileKeyStore(input: {
  readonly dir: string;
  readonly fs: KeyStoreFs;
  /** process.platform, injected. 'win32' has no POSIX owner or mode. */
  readonly platform: string;
  /** The repository root. A key directory inside it is refused. Required, so the check cannot be skipped. */
  readonly repoRoot: string;
  /** D-3: resolves links (fs.realpathSync). The check is made on the real paths AND the lexical ones; a throw refuses (key_dir_invalid). */
  readonly realpath: (path: string) => string;
  /** The only uid allowed to own a key file, on platforms that have one. */
  readonly ownerUid: number;
}): KeyStore {
  if (typeof input.dir !== 'string' || input.dir.trim() === '') throw new KeyStoreError('key_dir_invalid');
  if (typeof input.repoRoot !== 'string' || input.repoRoot.trim() === '') throw new KeyStoreError('key_dir_invalid');
  if (typeof input.realpath !== 'function') throw new KeyStoreError('key_dir_invalid');
  const inside = (d: string, r: string): boolean => d === r || d.startsWith(`${r}/`);
  if (inside(resolveSegments(input.dir), resolveSegments(input.repoRoot))) throw new KeyStoreError('key_dir_inside_repo');
  let realDir: string;
  let realRoot: string;
  try {
    realDir = resolveSegments(input.realpath(input.dir));
    realRoot = resolveSegments(input.realpath(input.repoRoot));
  } catch {
    throw new KeyStoreError('key_dir_invalid');
  }
  if (inside(realDir, realRoot)) throw new KeyStoreError('key_dir_inside_repo');
  const dir = slashes(input.dir).replace(/\/+$/u, '');
  const pathOf = (name: string): string => {
    if (typeof name !== 'string' || !NAME.test(name)) throw new KeyStoreError('key_name_invalid');
    return `${dir}/${name}`;
  };
  const posix = input.platform !== 'win32';
  const inspect = (st: KeyFileStat): void => {
    if (st.isSymbolicLink() || !st.isFile()) throw new KeyStoreError(st.isSymbolicLink() ? 'key_file_symlink' : 'key_file_unreadable');
    if (!posix) return;
    if ((st.mode & 0o077) !== 0) throw new KeyStoreError('key_file_mode_too_open');
    if (st.uid !== input.ownerUid) throw new KeyStoreError('key_file_wrong_owner');
  };
  /** lstat refuses a link. open+fstat is the inode the read uses, so a swap between the two cannot change which bytes are returned. */
  const openChecked = (path: string): number => {
    let listed: KeyFileStat;
    try { listed = input.fs.lstatSync(path); } catch (error) {
      throw new KeyStoreError(ioCode(error) === 'ENOENT' ? 'key_file_absent' : 'key_file_unreadable');
    }
    if (listed.isSymbolicLink()) throw new KeyStoreError('key_file_symlink');
    let fd: number;
    try { fd = input.fs.openSync(path); } catch (error) {
      const code = ioCode(error);
      if (code === 'ELOOP' || code === 'EPERM') throw new KeyStoreError('key_file_symlink');
      throw new KeyStoreError(code === 'ENOENT' ? 'key_file_absent' : 'key_file_unreadable');
    }
    try {
      inspect(input.fs.fstatSync(fd));
      return fd;
    } catch (error) {
      try { input.fs.closeSync(fd); } catch { /* the coded error is the one that matters */ }
      throw error;
    }
  };
  return {
    getKey(name) {
      const fd = openChecked(pathOf(name));
      try {
        const text = input.fs.readSync(fd);
        const value = text.trim();
        if (value === '') throw new KeyStoreError('key_file_empty');
        return value;
      } catch (error) {
        if (error instanceof KeyStoreError) throw error;
        throw new KeyStoreError(ioCode(error) === 'ENOENT' ? 'key_file_absent' : 'key_file_unreadable');
      } finally {
        try { input.fs.closeSync(fd); } catch { /* the value was already taken, or the coded error already thrown */ }
      }
    },
    has(name) {
      let fd: number;
      try { fd = openChecked(pathOf(name)); } catch { return false; }
      try { return true; } finally {
        try { input.fs.closeSync(fd); } catch { /* presence does not depend on the close */ }
      }
    },
  };
}

export type KeyEnvVerdict = { readonly ok: true } | { readonly ok: false; readonly code: 'provider_key_in_env'; readonly names: readonly string[] };

/**
 * REFUSES when any logical key NAME is present in the environment (any value, even empty). The coder session inherits the bridge env;
 * that is the point. Only variable NAMES are returned, never a value.
 */
export function assertNoProviderKeysInEnv(env: Readonly<Record<string, string | undefined>>, logicalNames: readonly string[]): KeyEnvVerdict {
  const present = logicalNames.filter((name) => env[name] !== undefined);
  return present.length === 0 ? { ok: true } : { ok: false, code: 'provider_key_in_env', names: present };
}
