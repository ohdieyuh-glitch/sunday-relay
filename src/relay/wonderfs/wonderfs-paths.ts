/**
 * WONDERFS — path rules (§6.6, INV-9). The server enforces them; the client checks first only for kinder words.
 *
 * A path names one entry inside one project: relative, `/`-separated, NFC. Every rule exists because a path ends up as a
 * file on a player's Windows disk (the local working copy, §12), in a log line, or in another player's view:
 *   - control characters (C0, DEL, C1 incl. NEL, U+2028/U+2029) would split log lines: the class of the social backend's
 *     CR/LF finding (log injection);
 *   - bidirectional controls and zero-width characters let one name read as another (`txt.exe` shown as `exe.txt`);
 *   - `< > : " \ | ? *`, a trailing space or dot, and the DOS device names are what NTFS / Win32 refuse or silently alter;
 *   - the 200-character limit keeps `%LOCALAPPDATA%\Wonderland\Projects\<id>\<path>` inside MAX_PATH;
 *   - `.wonderfs` at the root is the server's own namespace (§8.3).
 *
 * Uniqueness is CASE-INSENSITIVE per directory (two names one NTFS folder could not hold apart are one name here). The key
 * is deliberately CONSERVATIVE: `lower(upper(nfc))` folds every pair NTFS's upcase table folds (Greek final sigma included)
 * and a few it does not (ß ~ ss). A refused name is an inconvenience; two files that collide on a player's disk are a loss.
 */

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';

export const WFS_MAX_PATH_CHARS = 200;
export const WFS_MAX_COMPONENT_BYTES = 255;
export const WFS_RESERVED_ROOT = '.wonderfs';

/** Characters never allowed anywhere in a path. */
const FORBIDDEN_CHARS =
  // C0 controls, DEL, C1 controls (NEL U+0085 among them)
  '[\\u0000-\\u001f\\u007f-\\u009f' +
  // line / paragraph separators (JavaScript line terminators)
  '\\u2028\\u2029' +
  // bidirectional embedding / override / isolate controls, LRM / RLM / ALM
  '\\u200e\\u200f\\u061c\\u202a-\\u202e\\u2066-\\u2069' +
  // zero-width space / non-joiner / joiner, word joiner, BOM
  '\\u200b-\\u200d\\u2060\\ufeff' +
  // what Win32 refuses in a name
  '<>:"\\\\|?*]';
const FORBIDDEN_RE = new RegExp(FORBIDDEN_CHARS, 'u');

/** DOS device names: refused with or without an extension, in any case, with or without trailing spaces before the dot. */
const DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$',
  'COM0', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'COM¹', 'COM²', 'COM³',
  'LPT0', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9', 'LPT¹', 'LPT²', 'LPT³',
]);

export interface WfsPath {
  /** The normalized display path. */
  readonly path: string;
  /** The case-insensitive uniqueness key. */
  readonly key: string;
  readonly components: readonly string[];
}

const utf8 = new TextEncoder();

/** The uniqueness key of an already-normalized path or component. */
export function wfsPathKey(normalized: string): string {
  return normalized.toUpperCase().toLowerCase().normalize('NFC');
}

function refuse(why: string): RelayResult<WfsPath> {
  return fail(
    relayError('validation-failed', `That file name can't be used: ${why}.`, {
      details: [`wonderfs-path: ${why}`],
      // The path itself is NOT echoed into entityIds: it failed validation, so it may hold exactly the characters a log
      // line must never carry.
    }),
  );
}

/** Validate and normalize one path (§6.6). Never throws. */
export function normalizeWfsPath(input: unknown): RelayResult<WfsPath> {
  if (typeof input !== 'string') return refuse('it is not text');
  const path = input.normalize('NFC');
  if (path.length === 0) return refuse('it is empty');
  if (path.length > WFS_MAX_PATH_CHARS) return refuse(`it is longer than ${WFS_MAX_PATH_CHARS} characters`);
  if (FORBIDDEN_RE.test(path)) return refuse('it contains a character that is not allowed in a file name');
  if (path.startsWith('/')) return refuse('it starts with "/"');
  if (path.endsWith('/')) return refuse('it ends with "/"');
  const components = path.split('/');
  for (const c of components) {
    if (c.length === 0) return refuse('it has an empty folder name ("//")');
    if (c === '.' || c === '..') return refuse('it uses "." or ".." as a name');
    if (utf8.encode(c).length > WFS_MAX_COMPONENT_BYTES) return refuse(`one name is longer than ${WFS_MAX_COMPONENT_BYTES} bytes`);
    if (c.startsWith(' ')) return refuse('a name starts with a space');
    if (c.endsWith(' ') || c.endsWith('.')) return refuse('a name ends with a space or a dot');
    const stem = c.split('.')[0].replace(/ +$/u, '').toUpperCase();
    if (DEVICE_NAMES.has(stem)) return refuse(`"${stem}" is a name Windows reserves for a device`);
  }
  if (wfsPathKey(components[0]) === WFS_RESERVED_ROOT) return refuse(`"${WFS_RESERVED_ROOT}" at the top is reserved`);
  return ok({ path, key: wfsPathKey(path), components });
}

/** The parent of a normalized path, or `null` at the root. */
export function wfsParentPath(normalizedPath: string): string | null {
  const at = normalizedPath.lastIndexOf('/');
  return at < 0 ? null : normalizedPath.slice(0, at);
}

/** True when `key` is strictly beneath the directory whose key is `dirKey`. */
export function wfsIsBeneath(key: string, dirKey: string): boolean {
  return key.startsWith(`${dirKey}/`);
}

/**
 * The path a descendant takes when its directory moves: its leading `fromDepth` components are replaced by `toComponents`.
 * Component-wise on purpose: a key prefix and a display prefix need not have the same LENGTH (ß folds to ss).
 */
export function wfsRebase(descendantPath: string, fromDepth: number, toComponents: readonly string[]): string {
  return [...toComponents, ...descendantPath.split('/').slice(fromDepth)].join('/');
}
