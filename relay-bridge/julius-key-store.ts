/**
 * J1 KEY STORE (port + file implementation). Provider keys never live in process.env: the coder session inherits the bridge's environment,
 * so a key in it is a key the coder can read. The architect and reviewer legs (which run in the bridge process) get their key from this port
 * at CALL time, from a private file path outside the repository.
 *
 *   - `getKey(name)` reads the file for ONE call and returns the value; nothing is cached (no field holds a key).
 *   - the logical key names (OPENAI_API_KEY, XAI_API_KEY) stay as NAMES only; they are the file names inside the key directory.
 *   - errors carry a CODE only: never the path, never the value, never the platform's own message (which names the path).
 *   - the filesystem is injected (`KeyStoreFs`); this module imports no node:fs and reads no environment variable.
 *   - the mode of a key file is checked where the platform has POSIX modes (not win32): group/other access refuses.
 */

export type KeyStoreErrorCode =
  | 'key_name_invalid' | 'key_file_absent' | 'key_file_unreadable' | 'key_file_empty' | 'key_file_mode_too_open'
  | 'key_dir_invalid' | 'key_dir_inside_repo';

/** A coded failure. The message IS the code; there is nothing else on it. */
export class KeyStoreError extends Error {
  constructor(readonly code: KeyStoreErrorCode) { super(code); this.name = 'KeyStoreError'; }
}

export interface KeyStore {
  /** Reads the key NOW. Throws a {@link KeyStoreError}. The caller must not keep the value past its call. */
  getKey(name: string): string;
  /** True when the key file exists and passes the mode check. Does not read or return the value. */
  has(name: string): boolean;
}

export interface KeyStoreFs {
  readFileSync(path: string): string;
  statSync(path: string): { isFile(): boolean; readonly mode: number };
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

export function createFileKeyStore(input: {
  readonly dir: string;
  readonly fs: KeyStoreFs;
  /** process.platform, injected. 'win32' has no POSIX modes. */
  readonly platform: string;
  /** The repository root: a key directory inside it is refused. */
  readonly repoRoot?: string;
  /** D-3: resolves links (fs.realpathSync). REQUIRED with repoRoot: the check is made on the real paths AND the lexical ones; a throw refuses (key_dir_invalid). */
  readonly realpath?: (path: string) => string;
}): KeyStore {
  if (typeof input.dir !== 'string' || input.dir.trim() === '') throw new KeyStoreError('key_dir_invalid');
  if (input.repoRoot !== undefined) {
    const inside = (d: string, r: string): boolean => d === r || d.startsWith(`${r}/`);
    if (inside(resolveSegments(input.dir), resolveSegments(input.repoRoot))) throw new KeyStoreError('key_dir_inside_repo');
    if (input.realpath === undefined) throw new KeyStoreError('key_dir_invalid');
    let realDir: string; let realRoot: string;
    try { realDir = resolveSegments(input.realpath(input.dir)); realRoot = resolveSegments(input.realpath(input.repoRoot)); } catch { throw new KeyStoreError('key_dir_invalid'); }
    if (inside(realDir, realRoot)) throw new KeyStoreError('key_dir_inside_repo');
  }
  const dir = slashes(input.dir).replace(/\/+$/u, '');
  const pathOf = (name: string): string => {
    if (typeof name !== 'string' || !NAME.test(name)) throw new KeyStoreError('key_name_invalid');
    return `${dir}/${name}`;
  };
  const checkMode = (path: string): void => {
    let st;
    try { st = input.fs.statSync(path); } catch (error) {
      throw new KeyStoreError((error as { code?: unknown }).code === 'ENOENT' ? 'key_file_absent' : 'key_file_unreadable');
    }
    if (!st.isFile()) throw new KeyStoreError('key_file_unreadable');
    if (input.platform !== 'win32' && (st.mode & 0o077) !== 0) throw new KeyStoreError('key_file_mode_too_open');
  };
  return {
    getKey(name) {
      const path = pathOf(name);
      checkMode(path);
      let text: string;
      try { text = input.fs.readFileSync(path); } catch (error) {
        throw new KeyStoreError((error as { code?: unknown }).code === 'ENOENT' ? 'key_file_absent' : 'key_file_unreadable');
      }
      const value = text.trim();
      if (value === '') throw new KeyStoreError('key_file_empty');
      return value;
    },
    has(name) {
      try { checkMode(pathOf(name)); return true; } catch { return false; }
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
