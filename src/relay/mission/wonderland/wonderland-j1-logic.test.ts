import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
 * sha256 of the artifact after scrubKeys, the 8,000-char cut and one JavaScript trim (:55, :333-337, :527-530, :627)
 * and is null without an artifact; error body {error:{kind,message}} (:952) with no frozen list of kinds; a finished
 * run that failed answers 200 with `failure` set (:615-627). That commit is not on main, so it is cited, not read.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const CPP_DIR = join(ROOT, 'wonderland', 'Source', 'Wonderland');
const LOGIC_CPP = join(CPP_DIR, 'WonderlandJuliusMissionLogic.cpp');
const LOGIC_H = join(CPP_DIR, 'WonderlandJuliusMissionLogic.h');
const KAT_CPP = join(ROOT, 'wonderland', 'Tools', 'j1_logic_kat.cpp');

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const fromHex = (hex: string): Buffer => Buffer.from(hex, 'hex');
const LOWER_HEX_64 = /^[0-9a-f]{64}$/u;
const STRICT_RUN_ID = /^(wlj_)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BRIDGE_RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/u;

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
    .map((line) => [...line.matchAll(/"([^"]*)"|E(?:ResultEnvelope|FinishedResult)::(\w+)|(-?\d+)/gu)]
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
          + `envelope=${String(table('KAT-ENVELOPE').length)} result=${String(table('KAT-RESULT').length)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 120_000);
});
