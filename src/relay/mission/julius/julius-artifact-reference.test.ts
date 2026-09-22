import { describe, expect, it } from 'vitest';

import { isJuliusContentDigest, juliusDurableArtifactRef, JULIUS_CONTENT_DIGEST_RE } from './julius-artifact-reference';

/**
 * WHAT MAY BE WRITTEN INTO A DURABLE COLUMN ABOUT AN ARTIFACT.
 *
 * `julius_evidence.integrity_hash` was NULL on every row the three live roles
 * ever wrote, while those same adapters computed the sha256 of the body and
 * buried sixteen characters of it in an English sentence. `artifact_ref` was
 * worse than empty: it held a key into a `Map` that lives in one process —
 * `plan:<runId>`, `diff:<runId>` — so a durable row told every later reader to
 * look somewhere that would never exist again.
 */

const DIGEST = 'a'.repeat(64);

describe('a content digest', () => {
  it('is sha256, lowercase hex, exactly 64 characters', () => {
    expect(isJuliusContentDigest(DIGEST)).toBe(true);
    expect(JULIUS_CONTENT_DIGEST_RE.test(DIGEST)).toBe(true);
  });

  it('is not anything that merely looks like one', () => {
    for (const value of [
      'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), `${'a'.repeat(63)}g`,
      `sha256:${'a'.repeat(64)}`, ' '.repeat(64), '', 'unknown', null, undefined, 42, {}, [DIGEST],
    ]) expect(isJuliusContentDigest(value), JSON.stringify(value)).toBe(false);
  });

  it('is not a truncated one, which is what used to be recorded — in prose', () => {
    expect(isJuliusContentDigest(DIGEST.slice(0, 16))).toBe(false);
  });
});

describe('a durable artifact reference', () => {
  it('is kept when it names something that outlives this process', () => {
    expect(juliusDurableArtifactRef('artifact:diff-1')).toBe('artifact:diff-1');
    expect(juliusDurableArtifactRef('artifact:a.b_c-d:e')).toBe('artifact:a.b_c-d:e');
    const local = `local://${'1'.repeat(64)}/${'2'.repeat(64)}/${'3'.repeat(64)}`;
    expect(juliusDurableArtifactRef(local), 'what LocalJuliusArtifactStore.finalize returns').toBe(local);
  });

  it('is NULL for a key into this process — the value that used to be stored', () => {
    // Every one of these is a real key the live artifact exchange uses.
    for (const value of ['plan:run-1', 'diff:run-1', 'test-output:run-1', 'base:run-1', 'guidance:plan-1:review']) {
      expect(juliusDurableArtifactRef(value), value).toBeNull();
    }
  });

  it('is NULL for anything else a worker might write', () => {
    for (const value of [
      '', '   ', 'artifact:', 'artifact:../escape', 'artifact:a b',
      'local://short', `local://${'1'.repeat(64)}/${'2'.repeat(64)}`,
      'https://example.test/x', '../../etc/passwd', null, undefined, 42, {}, ['artifact:x'],
    ]) expect(juliusDurableArtifactRef(value), JSON.stringify(value)).toBeNull();
  });

  it('refuses an over-long name rather than truncating it into a different one', () => {
    // 200 characters is the bound `LocalJuliusArtifactStore.segment` enforces
    // on every scope value it hashes; the two agree on purpose.
    expect(juliusDurableArtifactRef(`artifact:${'a'.repeat(200)}`)).not.toBeNull();
    expect(juliusDurableArtifactRef(`artifact:${'a'.repeat(201)}`)).toBeNull();
  });
});
