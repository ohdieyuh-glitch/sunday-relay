import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseJuliusAttemptClose } from '../../../relay-bridge/julius/coder-workspace';
import {
  JULIUS_ENCODED_TEXT_MALFORMED,
  JULIUS_ENCODED_TEXT_MARKER,
  JULIUS_NUL_ESCAPED_V1,
  decodePgJson,
  decodePgText,
  encodePgJson,
  encodePgText,
  isPgEncodedText,
  pgJson,
  pgTextNeedsEncoding,
} from './julius-storage-encoding';

/**
 * `nul-escaped-v1`, the storage boundary's encoding (paid run 36568129865). These are the pure
 * properties; `scripts/julius-live-preflight-identity.test.ts` holds the same writes against a REAL
 * PostgreSQL, where 22P05 and 22021 are the database's own answer rather than this file's model of it.
 */

/** What PostgreSQL accepts in a `text` value, and in a `jsonb` string once parsed: no U+0000, no unpaired surrogate. */
const postgresAccepts = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { index += 1; continue; }
      return false;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};
/** Every string in a JSON value, keys included. */
const strings = (value: unknown): string[] => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(strings)
    : value !== null && typeof value === 'object' ? Object.entries(value).flatMap(([key, entry]) => [key, ...strings(entry)])
      : [];
const stable = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
const digest = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');

const TREE_C = 'c'.repeat(40);
const SECTION = '\u0000JULIUS-SECTION-9f2a\u0000';
/** The attempt close-out's output, byte for byte the shape `juliusAttemptCloseCommand` prints. */
const CLOSE_OUT = [
  `END ${TREE_C}\n`,
  ' M src/app.ts\u0000?? notes\\draft.md\u0000',
  'M\u0000src/app.ts\u0000A\u0000notes\\draft.md\u0000',
  '',
  'M\u0000src/app.ts\u0000A\u0000notes\\draft.md\u0000',
].join(SECTION);

describe('nul-escaped-v1: what does not need it is stored exactly as it was', () => {
  it.each([
    ['plain text', 'Sandbox command completed.'],
    ['the empty string', ''],
    ['backslashes with no NUL', 'C:\\Users\\julius\\repo and a \\0 that is text'],
    ['other control characters', 'tab\there\u0001\u001f\u007f\r\nend'],
    ['astral characters as valid pairs', 'dog \u{1F415} and \u{10FFFF}'],
    ['the marker, not at the start', `leading ${JULIUS_ENCODED_TEXT_MARKER}`],
  ])('%s', (_name, text) => {
    expect(pgTextNeedsEncoding(text)).toBe(false);
    expect(encodePgText(text)).toBe(text);
    expect(decodePgText(text)).toBe(text);
    expect(pgJson({ stdout: text })).toBe(JSON.stringify({ stdout: text }));
  });
});

describe('nul-escaped-v1: what needs it is encoded explicitly, storably and exactly', () => {
  it('the attempt close-out: marked, free of NUL, and decoded to every original byte', () => {
    const stored = encodePgText(CLOSE_OUT);
    expect(stored.startsWith(JULIUS_ENCODED_TEXT_MARKER), 'the stored value says it was encoded').toBe(true);
    expect(JULIUS_ENCODED_TEXT_MARKER).toBe(`julius-encoding:${JULIUS_NUL_ESCAPED_V1}\n`);
    expect(isPgEncodedText(stored)).toBe(true);
    expect(postgresAccepts(stored)).toBe(true);
    expect(stored).not.toContain('\u0000');
    // Readable: the sections and paths are all still there, NUL written `\0`, the backslash doubled.
    expect(stored).toContain(`\\0JULIUS-SECTION-9f2a\\0`);
    expect(stored).toContain('notes\\\\draft.md');
    expect(decodePgText(stored)).toBe(CLOSE_OUT);
  });

  it('the parser reads the decoded value exactly as it reads the raw one, and the stored one not at all', () => {
    const raw = parseJuliusAttemptClose(CLOSE_OUT, true);
    expect(raw.endTree).toBe(TREE_C);
    expect(raw.own?.map((change) => change.path)).toEqual(['src/app.ts', 'notes\\draft.md']);
    expect(parseJuliusAttemptClose(decodePgText(encodePgText(CLOSE_OUT)), true)).toEqual(raw);
    // Which is why the encoding stays at the storage boundary: the stored form has no sections at all.
    expect(parseJuliusAttemptClose(encodePgText(CLOSE_OUT), true).endTree).toBeNull();
  });

  it.each([
    ['a lone high surrogate, as a slice at 8192 leaves one', `abc\ud83d`],
    ['a lone low surrogate', `\udc00abc`],
    ['a reversed pair', `\ude00\ud83d`],
    ['NUL beside a valid pair', `\u0000\u{1F415}\u0000`],
    ['only NUL', '\u0000'],
    ['a raw value that starts with the marker', `${JULIUS_ENCODED_TEXT_MARKER}not encoded at all`],
    ['a raw value that is exactly the marker', JULIUS_ENCODED_TEXT_MARKER],
    ['a backslash before a zero before a NUL', '\\0\u0000\\\\u0000'],
  ])('%s', (_name, text) => {
    expect(pgTextNeedsEncoding(text)).toBe(true);
    const stored = encodePgText(text);
    expect(isPgEncodedText(stored)).toBe(true);
    expect(postgresAccepts(stored)).toBe(true);
    expect(decodePgText(stored)).toBe(text);
  });

  it('is injective and nests: two values never share a stored form, and an encoded value encodes again', () => {
    const values = ['', '\u0000', '\\0', '\\\u0000', '\u0000\\', `${JULIUS_ENCODED_TEXT_MARKER}`, `${JULIUS_ENCODED_TEXT_MARKER}\\0`, '\ud800', '\\ud800', 'x'];
    const stored = values.map(encodePgText);
    expect(new Set(stored).size).toBe(values.length);
    for (const value of values) expect(decodePgText(decodePgText(encodePgText(encodePgText(value))))).toBe(value);
  });
});

describe('nul-escaped-v1: a stored value that is not a canonical encoding is refused, never guessed at', () => {
  it.each([
    ['an unknown escape', `${JULIUS_ENCODED_TEXT_MARKER}a\\x00`],
    ['a trailing backslash', `${JULIUS_ENCODED_TEXT_MARKER}abc\\`],
    ['a short \\u escape', `${JULIUS_ENCODED_TEXT_MARKER}\\u00d`],
    ['uppercase hex', `${JULIUS_ENCODED_TEXT_MARKER}\\uD800`],
    ['a \\u escape of a character that needs none', `${JULIUS_ENCODED_TEXT_MARKER}\\u0041`],
    ['an escaped valid pair (not canonical)', `${JULIUS_ENCODED_TEXT_MARKER}\\ud83d\\udc15`],
    ['a marked value with nothing that needed marking', `${JULIUS_ENCODED_TEXT_MARKER}plain`],
    ['a raw NUL inside an encoded body', `${JULIUS_ENCODED_TEXT_MARKER}a\u0000b`],
  ])('%s', (_name, stored) => {
    expect(() => decodePgText(stored)).toThrow(JULIUS_ENCODED_TEXT_MALFORMED);
  });
});

describe('nul-escaped-v1 over JSON: the shape survives, every string is storable, and digests agree', () => {
  const result = {
    invocationId: 'run:efb6e20f0d11885bc5085a68:build:status:g1', status: 'SUCCEEDED', exitCode: 0,
    safeSummary: 'Sandbox command completed.', stdout: CLOSE_OUT, stderr: 'warning: \\ is fine\n',
    stdoutRef: null, stderrRef: null, artifacts: [], evidence: [{ evidenceId: 'e', facts: { 'key\u0000': 'v\u0000', n: 1, ok: true, none: null } }],
    durationMs: 12, resourceUsage: { toolCalls: 1, runtimeMs: 12, outputBytes: 211 }, policyDecisionRef: 'card:julius-live:1', mutations: [],
  };

  it('encodes only the strings that need it, keys included, and decodes to a deep-equal value', () => {
    const stored = encodePgJson(result) as typeof result;
    expect(stored.stdout.startsWith(JULIUS_ENCODED_TEXT_MARKER)).toBe(true);
    expect(stored.stderr, 'a string with no NUL is untouched').toBe(result.stderr);
    expect(stored.invocationId).toBe(result.invocationId);
    expect(Object.keys(stored.evidence[0]!.facts)).toContain(encodePgText('key\u0000'));
    expect(strings(stored).every(postgresAccepts)).toBe(true);
    expect(decodePgJson(stored)).toEqual(result);
  });

  it('what a `$n::jsonb` parameter is handed carries no \\u0000 escape, and parses back to the stored value', () => {
    const text = pgJson(result);
    expect(JSON.stringify(result)).toContain('\\u0000');
    expect(text).not.toContain('\\u0000');
    expect(decodePgJson(JSON.parse(text))).toEqual(result);
  });

  it('the digest of the decoded value is the digest of the raw value: stored form never enters a digest', () => {
    expect(digest(decodePgJson(JSON.parse(pgJson(result))))).toBe(digest(result));
    expect(digest(encodePgJson(result)), 'a digest over the stored form would disagree').not.toBe(digest(result));
  });

  it('numbers, booleans, null, arrays and a JSON-native object pass through unchanged', () => {
    const when = new Date('2026-09-29T12:33:48.813Z');
    expect(encodePgJson([1, true, null, 'x', [2]])).toEqual([1, true, null, 'x', [2]]);
    expect(encodePgJson({ at: when })).toEqual({ at: when });
    expect(encodePgJson(null)).toBeNull();
  });
});
