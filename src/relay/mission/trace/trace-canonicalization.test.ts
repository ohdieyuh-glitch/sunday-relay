import { describe, expect, it } from 'vitest';

import { canonicalEventInput, canonicalSerialize } from './trace-canonicalization';
import { sha256Hex } from './trace-hashing';
import { unsupportedMetadataValues } from './trace-fixtures';

const expectOk = (result: ReturnType<typeof canonicalSerialize>): string => {
  if (!result.ok) throw new Error(`expected canonicalization to succeed: ${result.error.reason}`);
  return result.value;
};

describe('canonical serialization', () => {
  it('sorts object keys recursively', () => {
    expect(expectOk(canonicalSerialize({ b: 1, a: { d: 2, c: 3 } }))).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it('preserves array order — order is meaning', () => {
    expect(expectOk(canonicalSerialize([3, 1, 2]))).toBe('[3,1,2]');
    expect(expectOk(canonicalSerialize([1, 2, 3]))).not.toBe(expectOk(canonicalSerialize([3, 2, 1])));
  });

  it('preserves explicit null', () => {
    expect(expectOk(canonicalSerialize({ a: null }))).toBe('{"a":null}');
  });

  it('produces identical output regardless of key INSERTION order', () => {
    const first: Record<string, unknown> = {};
    first.zeta = 1;
    first.alpha = { y: [1, 2], x: 'v' };
    const second: Record<string, unknown> = {};
    second.alpha = { x: 'v', y: [1, 2] };
    second.zeta = 1;

    expect(expectOk(canonicalSerialize(first))).toBe(expectOk(canonicalSerialize(second)));
    expect(sha256Hex(expectOk(canonicalSerialize(first)))).toBe(
      sha256Hex(expectOk(canonicalSerialize(second))),
    );
  });

  it('produces DIFFERENT output for meaningfully different metadata', () => {
    const a = expectOk(canonicalSerialize({ actor: 'agent-claude', count: 1 }));
    const b = expectOk(canonicalSerialize({ actor: 'agent-claude', count: 2 }));
    expect(a).not.toBe(b);
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });

  it('treats an absent key and an explicitly undefined key as identical', () => {
    expect(expectOk(canonicalSerialize({ a: 1, b: undefined }))).toBe(
      expectOk(canonicalSerialize({ a: 1 })),
    );
  });

  it('normalizes -0 to 0 so equal numbers never hash differently', () => {
    expect(expectOk(canonicalSerialize({ v: -0 }))).toBe(expectOk(canonicalSerialize({ v: 0 })));
  });

  it.each(unsupportedMetadataValues())('rejects %s', (_label, metadata) => {
    const result = canonicalSerialize(metadata);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['UNSUPPORTED_METADATA_VALUE', 'CANONICALIZATION_FAILED']).toContain(result.error.code);
    expect(result.error.field).toBeTruthy();
  });

  it('names the exact path that failed', () => {
    const result = canonicalSerialize({ outer: { inner: [1, Number.NaN] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('outer.inner[1]');
    expect(result.error.reason).toMatch(/non-finite/u);
  });

  it('rejects a class instance rather than silently stringifying it', () => {
    class Custom {
      value = 1;
    }
    const result = canonicalSerialize({ v: new Custom() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toMatch(/not a plain JSON object/u);
  });

  it('never mutates the value it serializes', () => {
    const value = { b: 1, a: [3, 2, 1], nested: { z: null } };
    const snapshot = JSON.stringify(value);
    canonicalSerialize(value);
    expect(JSON.stringify(value)).toBe(snapshot);
    // Key order in the ORIGINAL object is untouched.
    expect(Object.keys(value)).toEqual(['b', 'a', 'nested']);
  });

  it('handles deeply nested structures deterministically', () => {
    const deep = { l1: { l2: { l3: { l4: [{ b: 2, a: 1 }] } } } };
    expect(expectOk(canonicalSerialize(deep))).toBe('{"l1":{"l2":{"l3":{"l4":[{"a":1,"b":2}]}}}}');
  });
});

describe('canonical event hash input', () => {
  const envelope = {
    eventId: 'evt-1',
    traceId: 'trace-1',
    sequence: 2,
    previousEventHash: 'a'.repeat(64),
    actorId: 'relay',
    sourceTrust: 'observed',
    metadata: { k: 'v' },
    eventHash: 'ffff',
  };

  it('EXCLUDES eventHash from the hash input', () => {
    const canonical = expectOk(canonicalEventInput(envelope));
    expect(canonical).not.toContain('"eventHash"');
    expect(canonical).not.toContain('ffff');
  });

  it('INCLUDES previousEventHash, sequence, actor, trust, and metadata', () => {
    const canonical = expectOk(canonicalEventInput(envelope));
    expect(canonical).toContain('"previousEventHash"');
    expect(canonical).toContain('"sequence":2');
    expect(canonical).toContain('"actorId":"relay"');
    expect(canonical).toContain('"sourceTrust":"observed"');
    expect(canonical).toContain('"metadata":{"k":"v"}');
  });

  it('changes when any hashed field changes', () => {
    const base = expectOk(canonicalEventInput(envelope));
    expect(expectOk(canonicalEventInput({ ...envelope, sequence: 3 }))).not.toBe(base);
    expect(expectOk(canonicalEventInput({ ...envelope, actorId: 'other' }))).not.toBe(base);
    expect(expectOk(canonicalEventInput({ ...envelope, sourceTrust: 'attested' }))).not.toBe(base);
    expect(
      expectOk(canonicalEventInput({ ...envelope, previousEventHash: 'b'.repeat(64) })),
    ).not.toBe(base);
    expect(expectOk(canonicalEventInput({ ...envelope, metadata: { k: 'w' } }))).not.toBe(base);
  });

  it('does NOT change when only eventHash changes', () => {
    expect(expectOk(canonicalEventInput({ ...envelope, eventHash: 'different' }))).toBe(
      expectOk(canonicalEventInput(envelope)),
    );
  });
});
