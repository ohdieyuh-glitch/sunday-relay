/**
 * WHAT POSTGRESQL CANNOT HOLD, HELD ANYWAY: EXPLICITLY AND REVERSIBLY.
 *
 * Paid run 36568129865 (Mission 6, run:efb6e20f0d11885bc5085a68). The coder's
 * attempt close-out (`juliusAttemptCloseCommand`) prints NUL-separated output
 * BY DESIGN: its section markers are NUL-wrapped and `git status`/`git diff`
 * run with `-z`, because paths may contain any other byte. PostgreSQL stores
 * neither form of that byte. A `text` value refuses U+0000 outright (SQLSTATE
 * 22021), and `jsonb` refuses the `\u0000` escape that `JSON.stringify` writes
 * for it (22P05). The executor's receipt insert died with 22P05, the executor
 * answered 500, and the invocation stayed DISPATCHING for ever. On the success
 * path the same close-out would have FAILED a coder that did real work.
 *
 * THE ENCODING, `nul-escaped-v1`. A string is encoded only when it needs to
 * be: when it holds U+0000, when it holds an unpaired UTF-16 surrogate (the
 * driver would otherwise rewrite that to U+FFFD on the way in, which is a
 * silent strip), or when it already begins with the marker, so a raw string
 * can never be mistaken for an encoded one. The stored form is the marker line
 * `julius-encoding:nul-escaped-v1` and then the text with every `\` written
 * `\\`, every U+0000 written `\0`, and every unpaired surrogate written
 * `\uXXXX` in lowercase hex. Nothing else changes: newlines, tabs, other
 * control characters and every valid code point are stored as themselves, so a
 * stored preview stays readable in `psql` and states in its first line that it
 * was encoded. Decoding is exact and strict: a stored value that is not the
 * canonical encoding of some string is refused, never guessed at.
 *
 * WHERE IT APPLIES: at the PostgreSQL boundary and nowhere else. The executor
 * and Julius hand each other raw strings, the shell port returns raw stdout to
 * the parser that needs its NULs, and every digest (the receipt's result
 * digest, the settlement's, an evidence integrity hash) is computed over the
 * raw value, never over a stored form. A reader of a stored value decodes it
 * before comparing it with anything.
 */

/** The encoding's name, as it appears in the marker line. */
export const JULIUS_NUL_ESCAPED_V1 = 'nul-escaped-v1';

/** The first line of every encoded value. A stored string without it was stored exactly as it was. */
export const JULIUS_ENCODED_TEXT_MARKER = `julius-encoding:${JULIUS_NUL_ESCAPED_V1}\n`;

const HIGH = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const LOW = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * Whether PostgreSQL would refuse or rewrite this string: U+0000 is refused by
 * `text` and by `jsonb`, and an unpaired surrogate is replaced on the way in.
 * A string already starting with the marker needs encoding too, so that a
 * stored value's first line alone says which form it is in.
 */
export function pgTextNeedsEncoding(text: string): boolean {
  if (text.startsWith(JULIUS_ENCODED_TEXT_MARKER)) return true;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) return true;
    if (HIGH(code)) {
      if (LOW(text.charCodeAt(index + 1))) { index += 1; continue; }
      return true;
    }
    if (LOW(code)) return true;
  }
  return false;
}

/** Whether a STORED value is in the encoded form. It says nothing about whether it decodes. */
export const isPgEncodedText = (stored: string): boolean => stored.startsWith(JULIUS_ENCODED_TEXT_MARKER);

/**
 * The value to store for `text`. Unchanged when nothing in it needs encoding,
 * which is every string Julius stored before this encoding existed.
 */
export function encodePgText(text: string): string {
  if (!pgTextNeedsEncoding(text)) return text;
  let body = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x5c) body += '\\\\';
    else if (code === 0) body += '\\0';
    else if (HIGH(code) && LOW(text.charCodeAt(index + 1))) { body += text[index]! + text[index + 1]!; index += 1; }
    else if (HIGH(code) || LOW(code)) body += `\\u${code.toString(16).padStart(4, '0')}`;
    else body += text[index]!;
  }
  return JULIUS_ENCODED_TEXT_MARKER + body;
}

/** The error every malformed stored value raises. The value itself is never quoted. */
export const JULIUS_ENCODED_TEXT_MALFORMED = 'julius_encoded_text_malformed';

/**
 * The exact string a stored value encodes. A value without the marker is
 * returned as stored. An encoded value must be the CANONICAL encoding of what
 * it decodes to, so there is exactly one stored form for every string and a
 * hand-edited or foreign value is refused rather than silently reinterpreted.
 */
export function decodePgText(stored: string): string {
  if (!isPgEncodedText(stored)) return stored;
  const body = stored.slice(JULIUS_ENCODED_TEXT_MARKER.length);
  let text = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (character !== '\\') { text += character; continue; }
    const next = body[index + 1];
    if (next === '\\') { text += '\\'; index += 1; continue; }
    if (next === '0') { text += '\u0000'; index += 1; continue; }
    if (next === 'u' && /^[0-9a-f]{4}$/u.test(body.slice(index + 2, index + 6))) {
      const code = Number.parseInt(body.slice(index + 2, index + 6), 16);
      if (!HIGH(code) && !LOW(code)) throw new Error(JULIUS_ENCODED_TEXT_MALFORMED);
      text += String.fromCharCode(code);
      index += 5;
      continue;
    }
    throw new Error(JULIUS_ENCODED_TEXT_MALFORMED);
  }
  if (encodePgText(text) !== stored) throw new Error(JULIUS_ENCODED_TEXT_MALFORMED);
  return text;
}

const plainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * A JSON value made safe for `jsonb`: every string in it, object keys
 * included, passes through {@link encodePgText}. The shape is unchanged, so a
 * stored record stays inspectable field by field, and only the fields that
 * needed it carry the marker. Values `JSON.stringify` already handles on its
 * own terms (numbers, booleans, null, a `Date`) pass through untouched.
 */
export function encodePgJson(value: unknown): unknown {
  if (typeof value === 'string') return encodePgText(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(encodePgJson);
  if (!plainObject(value)) return value;
  const encoded: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) encoded[encodePgText(key)] = encodePgJson(entry);
  return encoded;
}

/**
 * The exact JSON value a stored `jsonb` value encodes; the inverse of
 * {@link encodePgJson}. It takes the value as the driver returns a `jsonb`
 * column, already parsed: a top-level string is a JSON string, not JSON text.
 */
export function decodePgJson<T = unknown>(stored: unknown): T {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return decodePgText(value);
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(walk);
    if (!plainObject(value)) return value;
    const decoded: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) decoded[decodePgText(key)] = walk(entry);
    return decoded;
  };
  return walk(stored) as T;
}

/** `JSON.stringify` of the encoded value: what a `$n::jsonb` parameter is handed. */
export const pgJson = (value: unknown): string => JSON.stringify(encodePgJson(value));
