import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WONDERLAND -- J1 client pure logic, held to public standards and to Node.
 *
 * `wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.{h,cpp}` is standard C++17 with no Unreal include:
 * SHA-256, JavaScript trim over UTF-8, the 12-hex artifact digest check, the result-body check and the run-id
 * format. `wonderland/Tools/j1_logic_kat.cpp` runs it against known answers. This file does three things:
 *
 *   1. Re-derives EVERY expected value in the KAT tables from Node (crypto, String.prototype.trim, a fatal
 *      TextDecoder) and from the NIST FIPS 180-2 example vectors spelled out below, so no KAT value is anyone's
 *      say-so.
 *   2. Derives the JavaScript trim set by scanning every code point in Node and compares it with the C++ table
 *      parsed from the implementation, so the two cannot drift.
 *   3. Compiles and runs the C++ KAT with -Werror when a C++ compiler is present. CI (ubuntu-latest) has one; a
 *      CI run without one FAILS rather than reporting a pass for C++ it never ran. A local machine without a
 *      compiler (Windows dev boxes) proves only parts 1 and 2, and the assertion says so.
 *
 * The result rows follow the J1 bridge contract at sunday-relay commit 31bfc58b, relay-bridge/julius-dispatch.ts
 * (blob 018fb582): result body {data:{runId,state,mode,resultText,resultSha256}} (:913) with resultSha256 =
 * sha256(resultText) (:628-631); resultText = JSON.stringify of the object at :624-628, whose artifactSha256 is the
 * sha256 of the artifact after scrubKeys, the 8,000-UTF-16-unit cut and one JavaScript trim (:55, :333-337, :527-530, :627)
 * and is null without an artifact; error body {error:{kind,message}} (:952) with no frozen list of kinds; a finished
 * run that failed answers 200 with `failure` set (:615-627). That commit is not on main, so it is cited, not read.
 *
 * FOUNDER RULINGS, 2026-10-23. (c): run ids are client-minted, cryptographically random UUIDv4s, and after any refusal
 * the next attempt carries a fresh run id AND a fresh idempotency key. R4-F: a scrubbed or cut artifact qualifies only
 * when independent verification confirms the original artifact and the exact scrub-cut-trim transformation; a
 * [redacted] marker or 8,000 units of text alone proves nothing, and missing, inconsistent or spoofable evidence
 * never qualifies. The KAT-UUID-FORMAT, KAT-KEY, KAT-ATTEMPT and KAT-QUALIFICATION tables pin both, and the rules
 * below restate them independently of the C++.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const CPP_DIR = join(ROOT, 'wonderland', 'Source', 'Wonderland');
const LOGIC_CPP = join(CPP_DIR, 'WonderlandJuliusMissionLogic.cpp');
const LOGIC_H = join(CPP_DIR, 'WonderlandJuliusMissionLogic.h');
const KAT_CPP = join(ROOT, 'wonderland', 'Tools', 'j1_logic_kat.cpp');
const J1_DISPATCH = join(ROOT, 'relay-bridge', 'julius-dispatch.ts');

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const fromHex = (hex: string): Buffer => Buffer.from(hex, 'hex');
const LOWER_HEX_64 = /^[0-9a-f]{64}$/u;
const STRICT_RUN_ID = /^(wlj_)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BRIDGE_RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/u;
/** julius-dispatch.ts at 31bfc58b, verbatim: :962 and :964. Compared with the file itself when it is in the tree. */
const BRIDGE_RUN_ID_SOURCE = 'const RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/;';
const BRIDGE_KEY_SOURCE = 'const KEY = /^[A-Za-z0-9_-]{8,80}$/;';
const BRIDGE_KEY = /^[A-Za-z0-9_-]{8,80}$/u;
const CANONICAL_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Strict UTF-8 decode, or null: the same refusal the C++ makes. */
function utf8OrNull(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

const source = (path: string): string => readFileSync(path, 'utf8');

/** The text between `// NAME-BEGIN` and `// NAME-END`, proving both markers exist. */
function section(text: string, name: string): string {
  const begin = text.indexOf(`// ${name}-BEGIN`);
  const end = text.indexOf(`// ${name}-END`);
  expect(begin, `${name}-BEGIN marker`).toBeGreaterThan(-1);
  expect(end, `${name}-END marker`).toBeGreaterThan(begin);
  return text.slice(begin, end);
}

/** The rows of one KAT table: each `{ ... },` line split into string, integer and enum fields. */
function table(name: string): string[][] {
  const rows = section(source(KAT_CPP), name)
    .split('\n')
    .filter((line) => /^\s*\{.*\},\s*$/u.test(line))
    .map((line) => [...line.matchAll(/"([^"]*)"|E(?:ResultEnvelope|FinishedResult|DispatchAnswer|AttemptVerdict|ArtifactQualification|MintResult)::(\w+)|(-?\d+)/gu)]
      .map((m) => m[1] ?? m[2] ?? m[3] ?? ''));
  expect(rows.length, `${name} has rows`).toBeGreaterThan(0);
  return rows;
}

const byLabel = (rows: string[][]): Map<string, string[]> => new Map(rows.map((row) => [row[0] ?? '', row]));

/** NIST FIPS 180-2 / CSRC SHA-256 example vectors, verbatim: label -> [message, repeat, digest]. */
const NIST: Readonly<Record<string, readonly [string, number, string]>> = {
  nist_empty: ['', 1, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  nist_abc: ['abc', 1, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  nist_448bit: ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', 1,
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  nist_896bit: ['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu', 1,
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
  nist_million_a: ['a', 1_000_000, 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
};

describe('J1 client logic: SHA-256 known answers', () => {
  it('carries every NIST example vector verbatim', () => {
    const rows = byLabel(table('KAT-SHA256'));
    for (const [label, [message, repeat, digest]] of Object.entries(NIST)) {
      const row = rows.get(label);
      expect(row, `${label} is missing from the KAT`).toBeDefined();
      expect(row).toEqual([label, Buffer.from(message, 'utf8').toString('hex'), String(repeat), digest]);
      expect(sha256(Buffer.from(message.repeat(repeat), 'utf8')), `Node agrees with NIST on ${label}`).toBe(digest);
    }
  });

  it('every KAT digest equals Node crypto over the same bytes', () => {
    const rows = table('KAT-SHA256');
    expect(rows.length).toBeGreaterThanOrEqual(Object.keys(NIST).length + 7);
    for (const [label, inputHex, repeat, expected] of rows) {
      expect(sha256(fromHex((inputHex ?? '').repeat(Number(repeat)))), `${label}`).toBe(expected);
    }
  });
});

describe('J1 client logic: JavaScript trim', () => {
  it('the C++ whitespace table is exactly what String.prototype.trim removes', () => {
    const fromNode: number[] = [];
    for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
      const lone = codePoint >= 0xd800 && codePoint <= 0xdfff;
      if (!lone && String.fromCodePoint(codePoint).trim() === '') fromNode.push(codePoint);
    }
    const fromCpp: number[] = [];
    for (const m of section(source(LOGIC_CPP), 'JS-TRIM-SET').matchAll(/\{\s*0x([0-9A-Fa-f]+)\s*,\s*0x([0-9A-Fa-f]+)\s*\}/gu)) {
      for (let codePoint = parseInt(m[1] ?? '', 16); codePoint <= parseInt(m[2] ?? '', 16); codePoint += 1) fromCpp.push(codePoint);
    }
    expect(fromNode.length).toBe(25);
    expect(fromCpp).toEqual(fromNode);
    for (const notTrimmed of [0x0085, 0x200b, 0x180e]) expect(fromCpp).not.toContain(notTrimmed);
  });

  it('every trim row agrees with Node, and every refused row really is malformed UTF-8', () => {
    for (const [label, inputHex, expectedHex, valid] of table('KAT-TRIM')) {
      const text = utf8OrNull(fromHex(inputHex ?? ''));
      if (valid === '1') {
        expect(text, `${label} is well-formed`).not.toBeNull();
        expect(Buffer.from((text ?? '').trim(), 'utf8').toString('hex'), `${label}`).toBe(expectedHex);
      } else {
        expect(text, `${label} must be malformed UTF-8`).toBeNull();
        expect(expectedHex, `${label} yields nothing`).toBe('');
      }
    }
  });
});

describe('J1 client logic: the 12-hex artifact digest', () => {
  it('every digest row agrees with sha256(JS-trim(text)) from Node', () => {
    for (const [label, artifactHex, expected, ok, digest12] of table('KAT-DIGEST')) {
      const text = utf8OrNull(fromHex(artifactHex ?? ''));
      const actual = text === null ? null : sha256(Buffer.from(text.trim(), 'utf8'));
      const verified = actual !== null && LOWER_HEX_64.test(expected ?? '') && actual === expected;
      expect(verified ? '1' : '0', `${label} verdict`).toBe(ok);
      expect(digest12, `${label} digest12`).toBe(verified ? (expected ?? '').slice(0, 12) : '');
    }
  });
});

describe('J1 client logic: the 8,000-unit cut splitting a surrogate pair (P396-1)', () => {
  /** The artifact bytes of one KAT-DIGEST-CUT row: PrefixHex x PrefixRepeat, then TailHex. */
  const cutBytes = (row: string[]): Buffer => fromHex((row[1] ?? '').repeat(Number(row[2])) + (row[3] ?? ''));

  it('every cut row agrees with sha256(JS-trim(text)) from Node', () => {
    for (const row of table('KAT-DIGEST-CUT')) {
      const [label, , , , expected, ok, digest12] = row;
      const text = utf8OrNull(cutBytes(row));
      const actual = text === null ? null : sha256(Buffer.from(text.trim(), 'utf8'));
      const verified = actual !== null && LOWER_HEX_64.test(expected ?? '') && actual === expected;
      expect(verified ? '1' : '0', `${label} verdict`).toBe(ok);
      expect(digest12, `${label} digest12`).toBe(verified ? (expected ?? '').slice(0, 12) : '');
    }
  });

  it('the rows are exactly what the bridge cut, trim and hash give, and only the U+FFFD form verifies', () => {
    const rows = byLabel(table('KAT-DIGEST-CUT'));
    const ufffd = rows.get('cut_splits_pair_lone_surrogate_as_ufffd_ok');
    const wtf8 = rows.get('cut_splits_pair_lone_surrogate_as_wtf8_refused');
    const fits = rows.get('pair_fits_at_8000_units_ok');
    expect(ufffd && wtf8 && fits, 'all three cut rows are present').toBeTruthy();
    // Restated from julius-dispatch.ts at 31bfc58b: scrubKeys cuts with out.slice(0, 8000) (:333-337, no key value in
    // this text), the coder's text is trimmed once (:530), and sha256 is update(value, 'utf8') (:328, :627).
    const bridge = (coderText: string): string => coderText.slice(0, 8_000).trim();
    const split = bridge('x'.repeat(7_999) + '\u{1F600}');
    expect(split.length).toBe(8_000);
    expect(split.charCodeAt(7_999), 'the cut leaves a lone high surrogate').toBe(0xd83d);
    expect(JSON.stringify(split).endsWith('\\ud83d"'), 'JSON.stringify sends it as the escape \\ud83d').toBe(true);
    expect(Buffer.from(split, 'utf8').equals(cutBytes(ufffd ?? [])), 'Node encodes it as EF BF BD').toBe(true);
    expect(createHash('sha256').update(split, 'utf8').digest('hex')).toBe(ufffd?.[4]);
    // The WTF-8 bytes of the same lone surrogate are malformed UTF-8 and carry the same bridge hash: refusing them is
    // the wrapper's encoding mistake, never a different artifact.
    expect(utf8OrNull(cutBytes(wtf8 ?? [])), 'ED A0 BD is malformed UTF-8').toBeNull();
    expect(cutBytes(wtf8 ?? []).subarray(-3).toString('hex')).toBe('eda0bd');
    expect(wtf8?.[4]).toBe(ufffd?.[4]);
    expect(wtf8?.[5]).toBe('0');
    const whole = bridge('x'.repeat(7_998) + '\u{1F600}');
    expect(whole.length).toBe(8_000);
    expect(Buffer.from(whole, 'utf8').equals(cutBytes(fits ?? [])), 'a pair that fits is kept whole').toBe(true);
    expect(createHash('sha256').update(whole, 'utf8').digest('hex')).toBe(fits?.[4]);
  });

  it('the header tells the wrapper to decode lone surrogates to U+FFFD, that the digest re-trims, and to check missionId', () => {
    const header = source(LOGIC_H);
    expect(header).toContain('8,000 UTF-16 code units');
    expect(header).toContain('decode every lone \\uD800-\\uDFFF escape in artifactText to U+FFFD (EF BF BD)');
    expect(header).toContain('THE DIGEST CHECK RE-TRIMS');
    expect(header).toContain('CHECK missionId');
  });
});

describe('J1 client logic: run id', () => {
  it('formats exactly as the RFC 4122 v4 layout of the raw bytes, with the wlj_ prefix', () => {
    for (const [label, bytesHex, expected] of table('KAT-RUNID-FORMAT')) {
      const laid = fromHex(bytesHex ?? '');
      expect(laid.length, label).toBe(16);
      laid[6] = ((laid[6] ?? 0) & 0x0f) | 0x40;
      laid[8] = ((laid[8] ?? 0) & 0x3f) | 0x80;
      const h = laid.toString('hex');
      expect(`wlj_${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, label).toBe(expected);
    }
  });

  it('every strict and bridge verdict matches the plan regex and the bridge regex', () => {
    const rows = table('KAT-RUNID-STRICT');
    for (const [id, strict, bridge] of rows) {
      expect(STRICT_RUN_ID.test(id ?? '') ? '1' : '0', `strict: ${id}`).toBe(strict);
      expect(BRIDGE_RUN_ID.test(id ?? '') ? '1' : '0', `bridge: ${id}`).toBe(bridge);
    }
    const ids = rows.map((row) => row[0]);
    for (const required of ['0b7a1c2e-4f3d-9a6b-1c2d-3e4f5a6b7c8d', 'wlj_0b7a1c2e-4f3d-9a6b-1c2d-3e4f5a6b7c8d', 'a'.repeat(129)]) {
      expect(ids, `the fixed negative ${required.slice(0, 44)} is tested`).toContain(required);
    }
  });
});

/** The RFC 4122 v4 layout of 16 bytes, restated from the RFC rather than from the C++. */
function uuidV4(bytes: Buffer): string {
  const laid = Buffer.from(bytes);
  laid[6] = ((laid[6] ?? 0) & 0x0f) | 0x40;
  laid[8] = ((laid[8] ?? 0) & 0x3f) | 0x80;
  const h = laid.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

describe('J1 client logic: client-minted run ids and keys (ruling (c))', () => {
  it('the restated bridge rules are the J1 source lines, verbatim, whenever that file is in the tree', () => {
    expect(BRIDGE_RUN_ID_SOURCE).toContain(BRIDGE_RUN_ID.source);
    expect(BRIDGE_KEY_SOURCE).toContain(BRIDGE_KEY.source);
    if (existsSync(J1_DISPATCH)) {
      const j1 = source(J1_DISPATCH);
      expect(j1, 'julius-dispatch.ts still has the run-id rule this file restates').toContain(BRIDGE_RUN_ID_SOURCE);
      expect(j1, 'julius-dispatch.ts still has the key rule this file restates').toContain(BRIDGE_KEY_SOURCE);
    }
  });

  it('every UUID format row is the RFC 4122 v4 layout of its bytes, and passes the bridge run-id and key rules', () => {
    const rows = table('KAT-UUID-FORMAT');
    for (const [label, bytesHex, expected] of rows) {
      const bytes = fromHex(bytesHex ?? '');
      expect(bytes.length, label).toBe(16);
      expect(uuidV4(bytes), `${label}`).toBe(expected);
      expect(CANONICAL_UUID_V4.test(expected ?? ''), `${label} canonical`).toBe(true);
      expect(BRIDGE_RUN_ID.test(expected ?? '') && BRIDGE_RUN_ID.test(`wlj_${expected ?? ''}`), `${label} bridge run id`).toBe(true);
      expect(BRIDGE_KEY.test(expected ?? ''), `${label} bridge key`).toBe(true);
      expect(STRICT_RUN_ID.test(`wlj_${expected ?? ''}`), `${label} strict with prefix`).toBe(true);
    }
    // The run-id rows are the same layout with the prefix, so the two tables cannot disagree.
    const uuidRows = byLabel(rows);
    for (const [label, bytesHex, expected] of table('KAT-RUNID-FORMAT')) {
      const twin = uuidRows.get(label ?? '');
      if (twin !== undefined) expect(expected, label).toBe(`wlj_${twin[2] ?? ''}`);
      expect(expected, label).toBe(`wlj_${uuidV4(fromHex(bytesHex ?? ''))}`);
    }
  });

  it("Node's crypto.randomUUID has exactly the minted shape, and passes every rule the bridge applies", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 10_000; index += 1) {
      const id = randomUUID();
      expect(CANONICAL_UUID_V4.test(id), id).toBe(true);
      expect(STRICT_RUN_ID.test(id) && STRICT_RUN_ID.test(`wlj_${id}`), id).toBe(true);
      expect(BRIDGE_RUN_ID.test(`wlj_${id}`) && BRIDGE_KEY.test(id), id).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('every key row matches the canonical UUIDv4 rule and the bridge key rule', () => {
    const rows = table('KAT-KEY');
    for (const [key, canonical, bridge] of rows) {
      expect(CANONICAL_UUID_V4.test(key ?? '') ? '1' : '0', `canonical: ${key}`).toBe(canonical);
      expect(BRIDGE_KEY.test(key ?? '') ? '1' : '0', `bridge key: ${key}`).toBe(bridge);
    }
    const keys = rows.map((row) => row[0]);
    for (const required of ['wlj_ba7816bf-8f01-4fea-8141-40de5dae2223', 'BA7816BF-8F01-4FEA-8141-40DE5DAE2223', '1234567', 'a'.repeat(81)]) {
      expect(keys, `the negative ${required.slice(0, 40)} is tested`).toContain(required);
    }
  });
});

describe('J1 client logic: a failed random source refuses the attempt (YUJI requirement 3)', () => {
  it('every mint row is a refusal with no id when the source fails, and the lowercase UUIDv4 pair otherwise', () => {
    const rows = table('KAT-MINT');
    for (const [label, available, runHex, keyHex, verdict, runId, key] of rows) {
      const blocks = Number(available);
      const runUuid = uuidV4(fromHex(runHex ?? ''));
      const keyUuid = uuidV4(fromHex(keyHex ?? ''));
      let expected = 'Minted';
      if (blocks < 2) expected = 'RandomUnavailable';
      else if (runUuid === keyUuid) expected = 'RandomRepeated';
      expect(verdict, `${label}`).toBe(expected);
      expect([runId, key], `${label} output`).toEqual(expected === 'Minted' ? [`wlj_${runUuid}`, keyUuid] : ['', '']);
      if (expected === 'Minted') {
        expect(runId, `${label} lowercase`).toBe((runId ?? '').toLowerCase());
        expect(CANONICAL_UUID_V4.test(key ?? '') && STRICT_RUN_ID.test(runId ?? ''), `${label} canonical`).toBe(true);
      }
    }
    const labels = rows.map((row) => row[0]);
    for (const required of ['source_fails_at_once', 'source_fails_on_key', 'stuck_source', 'uppercase_free_from_high_bytes']) {
      expect(labels, required).toContain(required);
    }
  });
});

/** The answer rule: any error object or kind, or any status outside 2xx, is a refusal. Kinds are never listed. */
function referenceAnswer(status: number, hasError: boolean, kind: string, noAnswer: boolean): string {
  if (noAnswer) return 'NoAnswer';
  if (hasError || kind !== '' || status < 200 || status > 299) return 'Refused';
  return 'Accepted';
}

/** The fresh-after-refusal rule: an answered pair is spent in either role; an unanswered one may only be resent whole. */
function referenceVerdict(answer: string, reuse: string): string {
  if (answer === 'NoAnswer') return reuse === 'both' ? 'Admitted' : 'PreviousAttemptUnanswered';
  if (reuse === 'run' || reuse === 'both' || reuse === 'key_as_run') return 'RunIdReused';
  if (reuse === 'key' || reuse === 'run_as_key') return 'KeyReused';
  return 'Admitted';
}

describe('J1 client logic: a fresh run id and key after every refusal (ruling (c))', () => {
  it('every attempt row expects what the stated rules give', () => {
    for (const [label, status, hasError, kind, noAnswer, reuse, answer, verdict] of table('KAT-ATTEMPT')) {
      const expectedAnswer = referenceAnswer(Number(status), hasError === '1', kind ?? '', noAnswer === '1');
      expect(answer, `${label} answer`).toBe(expectedAnswer);
      expect(verdict, `${label} verdict`).toBe(referenceVerdict(expectedAnswer, reuse ?? ''));
    }
  });

  it('the named refusals, accepted answers and no answer are each tried with every kind of reuse', () => {
    const rows = table('KAT-ATTEMPT');
    const labels = rows.map((row) => row[0]);
    for (const refusal of ['repeat_already_used_409', 'cap_reached_429', 'mission_cap_reached_429', 'accepted_202', 'replayed_200', 'no_answer']) {
      for (const reuse of ['none', 'run', 'key', 'both', 'key_as_run', 'run_as_key']) {
        expect(labels, `${refusal}_${reuse}`).toContain(`${refusal}_${reuse}`);
      }
    }
    const byName = byLabel(rows);
    expect(byName.get('repeat_already_used_409_none')?.slice(1, 4)).toEqual(['409', '1', 'julius_dispatch_repeat_already_used']);
    expect(byName.get('cap_reached_429_none')?.slice(1, 4)).toEqual(['429', '1', 'julius_dispatch_cap_reached']);
    expect(byName.get('mission_cap_reached_429_none')?.slice(1, 4)).toEqual(['429', '1', 'julius_dispatch_mission_cap_reached']);
    for (const required of ['unknown_kind_on_200_none', 'kind_without_flag_on_202_none', 'flag_without_kind_on_200_none', 'status_500_no_error_none', 'status_302_no_error_none']) {
      expect(labels, required).toContain(required);
    }
    // After any refusal, reusing either value is never admitted.
    for (const row of rows) {
      if (row[6] === 'Refused' && row[5] !== 'none') expect(row[7], `${row[0]}`).not.toBe('Admitted');
    }
  });

  it('the header documents the CSPRNG duty, and the logic itself draws no randomness', () => {
    const header = source(LOGIC_H);
    expect(header).toContain('RUN IDS ARE CLIENT-MINTED');
    expect(header).toContain("Unreal's IPlatformCrypto");
    expect(header).toContain('CreateRandomBytes');
    expect(header).toContain('OpenSSL\n//      RAND_bytes');
    expect(header).toContain('NEVER FGuid::NewGuid');
    expect(header).toContain('there is NO fallback to any other source');
    expect(header).toContain('af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md, blob cf528758');
    expect(header).not.toContain('still the founder');
    expect(header).toContain('class IRandomBytes16');
    for (const text of [source(LOGIC_CPP), header.replace(/^\s*\/\/.*$/gmu, '')]) {
      expect(text).not.toMatch(/\b(rand|srand|random_device|mt19937|BCryptGenRandom|getrandom|arc4random|RAND_bytes|CreateRandomBytes|NewGuid|CreateGuid)\s*\(/u);
    }
  });
});

/** R4-F, restated: fail closed. Units are UTF-16 code units of the text the wrapper hands over. */
function referenceQualification(row: string[]): { verdict: string; scrub: boolean; atLimit: boolean; over: boolean; units: number } {
  const [, prefixHex, repeat, tailHex, finished, present, verified, original, transformed, artifactSha] = row;
  const text = utf8OrNull(fromHex((prefixHex ?? '').repeat(Number(repeat)) + (tailHex ?? '')));
  const units = text === null ? 0 : text.length;
  const signals = { scrub: text !== null && text.includes('[redacted]'), atLimit: units === 8_000, over: units > 8_000, units };
  if (finished !== 'Completed') return { verdict: 'NotCompleted', ...signals };
  if (text === null) return { verdict: 'Unreadable', ...signals };
  if (signals.over) return { verdict: 'EvidenceInconsistent', ...signals };
  if (present !== '1') {
    if (verified === '1' || original !== '' || transformed !== '') return { verdict: 'EvidenceInconsistent', ...signals };
    return { verdict: signals.scrub || signals.atLimit ? 'TransformedUnverified' : 'NoTransformSignal', ...signals };
  }
  const consistent = verified === '1' && LOWER_HEX_64.test(original ?? '') && LOWER_HEX_64.test(artifactSha ?? '')
    && transformed === artifactSha;
  return { verdict: consistent ? 'TransformedVerified' : 'EvidenceInconsistent', ...signals };
}

describe('J1 client logic: scrubbed or cut results never qualify without evidence (ruling R4-F)', () => {
  it('every qualification row expects what the stated rules give', () => {
    for (const row of table('KAT-QUALIFICATION')) {
      const reference = referenceQualification(row);
      expect(row[10], `${row[0]}`).toBe(reference.verdict);
      expect(row.slice(11, 15), `${row[0]} signals`).toEqual([reference.scrub ? '1' : '0', reference.atLimit ? '1' : '0',
        reference.over ? '1' : '0', String(reference.units)]);
    }
  });

  it('a marker or 8,000 units alone never qualifies, and the bridge scrub and cut really produce those texts', () => {
    const rows = byLabel(table('KAT-QUALIFICATION'));
    for (const label of ['x_8000_at_limit', 'cut_split_pair_ufffd_at_limit', 'pair_fits_at_limit', 'redacted_marker_short',
      'redacted_marker_spoofed_by_coder', 'partial_marker_cut_at_limit']) {
      expect(rows.get(label)?.[10], label).toBe('TransformedUnverified');
    }
    for (const label of ['evidence_not_independently_verified', 'evidence_transformed_hash_mismatch', 'evidence_missing_original',
      'evidence_uppercase_original', 'evidence_short_transformed', 'verified_flag_without_present', 'hashes_without_present',
      'over_limit_never_from_bridge', 'over_limit_even_with_evidence']) {
      expect(rows.get(label)?.[10], label).toBe('EvidenceInconsistent');
    }
    expect(rows.get('marker_with_verified_evidence')?.[10]).toBe('TransformedVerified');
    // Restated from julius-dispatch.ts at 31bfc58b (:333-337, :530): the scrub writes exactly '[redacted]', then the cut.
    const scrubKeys = (text: string, keys: readonly string[]): string => {
      let out = text;
      for (const key of keys) if (key.length >= 8) out = out.split(key).join('[redacted]');
      return out.slice(0, 8_000);
    };
    expect(scrubKeys('use sk-0123456789 here', ['sk-0123456789']).trim()).toBe('use [redacted] here');
    expect(scrubKeys('x'.repeat(9_000), []).trim().length).toBe(8_000);
    expect(scrubKeys(`${'x'.repeat(7_995)}sk-0123456789`, ['sk-0123456789']).trim().endsWith('[reda')).toBe(true);
    // The limit of what the client can see: a cut that the trim hid leaves fewer than 8,000 units and no marker.
    expect(scrubKeys(`${' '.repeat(10)}${'x'.repeat(9_000)}`, []).trim().length).toBe(7_990);
  });

  it('the header records that the bridge carries no transform evidence, so the wrapper passes none', () => {
    const header = source(LOGIC_H);
    expect(header).toContain('NO TRANSFORM EVIDENCE EXISTS YET (ruling R4-F)');
    expect(header).toContain('passes an EMPTY FTransformEvidence');
    expect(header).toContain('No value here is a PASS');
  });
});

/** The rules the C++ must implement, restated independently, so the TABLE's expectations are checked too. */
function referenceEnvelope(row: string[], expectedRunId: string): string {
  const [, status, hasData, hasError, kind, dataRunId, textHex, resultSha] = row;
  if (hasError === '1' || kind !== '') return 'Refused';
  if (status !== '200' || hasData !== '1') return 'Unreadable';
  if (dataRunId !== expectedRunId) return 'WrongRun';
  const intact = LOWER_HEX_64.test(resultSha ?? '') && sha256(fromHex(textHex ?? '')) === resultSha;
  return intact ? 'BodyIntact' : 'Damaged';
}

function referenceResult(row: string[], expectedRunId: string): string {
  const [, dataState, dataMode, innerRunId, mode, expectedMode, failureNull, , state, shaNull, artSha, textNull, textHex] = row;
  if (innerRunId !== expectedRunId) return 'WrongRun';
  if (dataState !== state || dataMode !== mode) return 'Damaged';
  if (mode !== expectedMode) return 'ModeMismatch';
  if (failureNull !== '1' || state !== 'COMPLETED') return 'FailureOutcome';
  if (shaNull === '1' || textNull === '1') return 'NoArtifact';
  const text = utf8OrNull(fromHex(textHex ?? ''));
  const ok = text !== null && LOWER_HEX_64.test(artSha ?? '') && sha256(Buffer.from(text.trim(), 'utf8')) === artSha;
  return ok ? 'Completed' : 'Damaged';
}

describe('J1 client logic: the result body (bridge contract 31bfc58b)', () => {
  const kat = source(KAT_CPP);
  const expectedRunId = /ExpectedRunId = "([^"]+)"/u.exec(kat)?.[1] ?? '';

  it('the fixture resultText is shaped exactly like JSON.stringify of julius-dispatch.ts:624-628', () => {
    const intact = byLabel(table('KAT-ENVELOPE')).get('completed_body_intact');
    expect(intact).toBeDefined();
    const text = fromHex(intact?.[6] ?? '').toString('utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['runId', 'dispatchId', 'missionId', 'mode', 'state', 'failure', 'roles',
      'spendUnknownLegs', 'reviewerVerdict', 'checkerPass', 'artifactSha256', 'artifactText']);
    expect(JSON.stringify(parsed), 'the bytes are what JSON.stringify produces').toBe(text);
    expect(parsed.runId).toBe(expectedRunId);
    expect(parsed.artifactSha256).toBe(sha256(Buffer.from(String(parsed.artifactText), 'utf8')));
    expect(sha256(Buffer.from(text, 'utf8')), 'resultSha256 = sha256(resultText)').toBe(intact?.[7]);
  });

  it('every envelope row expects what the stated rules give, and the required cases are present', () => {
    const rows = table('KAT-ENVELOPE');
    expect(STRICT_RUN_ID.test(expectedRunId)).toBe(true);
    for (const row of rows) expect(row[8], `${row[0]}`).toBe(referenceEnvelope(row, expectedRunId));
    const labels = rows.map((row) => row[0]);
    for (const required of ['unknown_kind_on_200', 'unknown_kind_on_403', 'result_sha_one_hex_digit_off',
      'result_text_one_byte_mutated', 'data_run_id_other_run', 'error_and_data_both']) {
      expect(labels, required).toContain(required);
    }
  });

  it('every finished-result row expects what the stated rules give, and the required cases are present', () => {
    const rows = table('KAT-RESULT');
    for (const row of rows) {
      const verdict = referenceResult(row, expectedRunId);
      expect(row[13], `${row[0]}`).toBe(verdict);
      expect(row[14], `${row[0]} digest12`).toBe(verdict === 'Completed' ? (row[10] ?? '').slice(0, 12) : '');
    }
    const labels = rows.map((row) => row[0]);
    for (const required of ['null_artifact_sha256_and_text', 'null_artifact_sha256_text_present',
      'failure_reviewer_rejected_on_200', 'failure_checker_failed_on_200', 'failure_budget_refused_halted',
      'failure_unknown_word_on_200', 'artifact_sha_mismatch', 'data_state_disagrees_with_result',
      'data_mode_disagrees_with_result', 'fake_answer_on_live_build', 'live_answer_on_rehearsal_build']) {
      expect(labels, required).toContain(required);
    }
  });

  it('the header cites the contract commit and neither file includes Unreal', () => {
    const header = source(LOGIC_H);
    expect(header).toContain('31bfc58b');
    expect(header).not.toMatch(/#include\s+["<](CoreMinimal|Engine|UObject|Misc|HAL)/u);
    expect(source(LOGIC_CPP)).not.toMatch(/#include\s+["<](CoreMinimal|Engine|UObject|Misc|HAL)/u);
  });
});

function cxxCompiler(): string | null {
  for (const candidate of ['g++', 'c++', 'clang++']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // not on PATH; try the next
    }
  }
  return null;
}

describe('J1 client logic: the C++ itself', () => {
  it('compiles with -Werror and passes every known answer', () => {
    expect(existsSync(LOGIC_CPP), 'the implementation exists').toBe(true);
    expect(existsSync(KAT_CPP), 'the KAT exists').toBe(true);
    const cxx = cxxCompiler();
    if (cxx === null) {
      // Without a compiler only the Node half above is proven. That is acceptable on a developer machine and NOT
      // on CI, where a missing compiler would otherwise read as a pass for C++ that never ran.
      expect(process.env.GITHUB_ACTIONS, 'CI has no C++ compiler, so the C++ KAT did not run').not.toBe('true');
    } else {
      const dir = mkdtempSync(join(tmpdir(), 'j1-logic-kat-'));
      try {
        const exe = join(dir, process.platform === 'win32' ? 'j1_logic_kat.exe' : 'j1_logic_kat');
        execFileSync(cxx, ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', CPP_DIR, KAT_CPP, LOGIC_CPP, '-o', exe],
          { stdio: 'pipe' });
        const out = execFileSync(exe, { encoding: 'utf8' });
        const counts = [table('KAT-SHA256'), table('KAT-TRIM'), table('KAT-DIGEST'), table('KAT-RUNID-FORMAT'),
          table('KAT-RUNID-STRICT')].map((rows) => rows.length);
        expect(out).toContain(`J1 LOGIC KAT PASS sha256=${String(counts[0])} trim=${String(counts[1])} digest=${String(counts[2])} `
          + `runid_format=${String(counts[3])} runid_strict=${String(counts[4])} generated=10000 `
          + `envelope=${String(table('KAT-ENVELOPE').length)} result=${String(table('KAT-RESULT').length)} `
          + `digest_cut=${String(table('KAT-DIGEST-CUT').length)} `
          + `uuid_format=${String(table('KAT-UUID-FORMAT').length)} key=${String(table('KAT-KEY').length)} `
          + `attempt=${String(table('KAT-ATTEMPT').length)} minted=2000 qualification=${String(table('KAT-QUALIFICATION').length)} `
          + `mint=${String(table('KAT-MINT').length)}\n`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 120_000);
});
