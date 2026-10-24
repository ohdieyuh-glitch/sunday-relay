import { describe, expect, it } from 'vitest';

import {
  COMPANION_EVIDENCE_SCHEMA_VERSION,
  createMemoryCompanionEvidenceStore,
  type CompanionEvidenceDraft,
  type CompanionEvidenceView,
} from './julius-companion-evidence';

const WLJ = 'wlj_11111111-1111-4111-8111-111111111111';
const OTHER = 'wlj_22222222-2222-4222-8222-222222222222';
const LEGACY = `run:${'ab'.repeat(12)}`;
const HASH = 'a'.repeat(64);
const AT = '2026-10-24T05:35:00.000Z';

const draft = (over: Partial<CompanionEvidenceDraft> = {}): CompanionEvidenceDraft => ({
  wljRunId: WLJ,
  legacyRunId: LEGACY,
  disposition: 'integrated',
  summary: 'the companion wrote a note',
  contentSha256: HASH,
  artifactKind: 'text',
  byteLength: 24,
  provenance: { source: 'companion_port', wakeId: 'wake_01', bodyDigest: 'b'.repeat(64), contentSha256: HASH },
  updatedAt: AT,
  ...over,
});

function viewOf(store: ReturnType<typeof createMemoryCompanionEvidenceStore>, runId: string): CompanionEvidenceView | null {
  const read = store.read(runId);
  expect(read.ok).toBe(true);
  if (!read.ok) return null;
  return read.result;
}

describe('companion evidence store', () => {
  it('uses schema version 1 and keys a row on the wlj id', () => {
    const store = createMemoryCompanionEvidenceStore();
    expect(store.schemaVersion).toBe(COMPANION_EVIDENCE_SCHEMA_VERSION);
    expect(store.record(draft())).toEqual({ ok: true });
    expect(viewOf(store, WLJ)).toMatchObject({ wljRunId: WLJ, legacyRunId: LEGACY, companion: { state: 'integrated' } });
  });

  it('a missing wlj id is no result', () => {
    const store = createMemoryCompanionEvidenceStore();
    expect(store.read(OTHER)).toEqual({ ok: true, result: null });
    expect(store.read(WLJ)).toEqual({ ok: true, result: null });
  });

  it('a legacy id is refused, including the legacy id stored beside a wlj row', () => {
    const store = createMemoryCompanionEvidenceStore();
    expect(store.record(draft())).toEqual({ ok: true });
    expect(store.read(LEGACY)).toEqual({ ok: false, reason: 'companion_legacy_read_only' });
    expect(store.record(draft({ wljRunId: LEGACY }))).toEqual({ ok: false, reason: 'companion_legacy_read_only' });
    expect(viewOf(store, WLJ)?.wljRunId).toBe(WLJ);
  });

  it('a missing disposition is no result, even when a summary was offered', () => {
    const store = createMemoryCompanionEvidenceStore();
    expect(store.record(draft({ disposition: 'missing', summary: 'should not be served' }))).toEqual({ ok: true });
    const view = viewOf(store, WLJ);
    expect(view?.companion).toEqual({ state: 'no_result' });
    expect(view?.result).toBeNull();
    expect(view?.provenance).toBeNull();
  });

  it('the summary is served untrusted and is never marked verified', () => {
    const store = createMemoryCompanionEvidenceStore();
    expect(store.record(draft({
      provenance: { source: 'simulated', wakeId: null, bodyDigest: null, contentSha256: HASH },
    }))).toEqual({ ok: true });
    const view = viewOf(store, WLJ);
    expect(view?.result).toEqual({
      untrusted: true,
      summary: 'the companion wrote a note',
      artifact: { kind: 'text', sha256: HASH, byteLength: 24 },
    });
    expect(view?.result).not.toHaveProperty('verified');
    expect(view?.result).not.toHaveProperty('verifiedBy');
    expect(view?.provenance).toEqual({ source: 'simulated', wakeId: null, bodyDigest: null, contentSha256: HASH });
    expect(view?.provenance).not.toHaveProperty('verifiedBy');
    expect(view).not.toHaveProperty('verified');
    expect(JSON.stringify(view)).not.toContain('verified');
  });

  it('an unparseable id is refused and a too-long summary is not stored', () => {
    const store = createMemoryCompanionEvidenceStore();
    expect(store.read('run:NOPE')).toEqual({ ok: false, reason: 'companion_run_id_invalid' });
    expect(store.record(draft({ summary: 'x'.repeat(4097) }))).toEqual({ ok: false, reason: 'companion_evidence_invalid' });
    expect(store.read(WLJ)).toEqual({ ok: true, result: null });
  });
});
