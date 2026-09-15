import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createJuliusBrainCarryJournal,
  juliusBrainCarryDigest,
  openJuliusBrainCarry,
  sealJuliusBrainCarry,
  type JuliusBrainCarry,
  type JuliusBrainCarryKey,
  type JuliusBrainCarryPayload,
} from './julius-brain-carry';
import { juliusPrincipal } from './julius-brain-contracts';
import { exportJuliusBrain, restoreJuliusBrainFromExport, type JuliusBrainExportBundle } from './julius-brain-export';
import { createJuliusProjectBrainService } from './julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, type JuliusBrainStore } from './julius-brain-store';

const BRAIN = 'brain:prj-carry';
const PROJECT = 'prj-carry';
const MISSION = 'mission:carry';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const clock = { now: () => '2026-09-15T12:00:00.000Z' };
const KEY: JuliusBrainCarryKey = { keyId: 'carry-key-1', secret: new Uint8Array(32).fill(7) };
const EXPECT = { brainId: BRAIN, projectId: PROJECT, environment: 'test' as const, minimumSequence: 0 };

/** One disposable job's Brain: a memory store and the artifact bytes it holds. */
async function job(store: JuliusBrainStore = createJuliusBrainMemoryStore()) {
  const service = createJuliusProjectBrainService({ store, clock });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Carry', principal: JULIUS });
  const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
  const bytes = new Map<string, Uint8Array>();
  const putArtifact = async (name: string, text: string) => {
    const content = new TextEncoder().encode(text);
    const hex = createHash('sha256').update(content).digest('hex');
    bytes.set(`sha256:${hex}`, content);
    const result = await julius.create('ARTIFACT', {
      artifactClass: 'REPORT', name, contentType: 'text/plain', byteSize: content.byteLength, contentHash: `sha256:${hex}`, storageRef: `cas://sha256/${hex}`, commit: null,
    }, { key: `artifact:${name}`, scope: { missionId: MISSION } });
    if (result.outcome !== 'COMMITTED') throw new Error(result.detail);
  };
  const exportNow = async (secretLiterals: readonly string[] = []): Promise<JuliusBrainCarryPayload> => {
    const bundle = (await exportJuliusBrain({ store, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: clock.now(), secretLiterals }))!;
    return { bundle, content: [...bytes].map(([contentHash, value]) => ({ contentHash, bytes: value })) };
  };
  return { store, julius, bytes, putArtifact, exportNow };
}

const seal = (payload: JuliusBrainCarryPayload, previous: JuliusBrainCarry['previous'] = null) =>
  sealJuliusBrainCarry({ payload, environment: 'test', previous, producedBy: { workflowRunId: '34739303313', workflowRunAttempt: 1, acceptedMainSha: '0845c593aa1ef2b7d1c4e8f6a09b3c2d5e7f8a91' }, createdAt: clock.now(), key: KEY });

/** What an artifact file round trip does to a carry: JSON, base64 bytes. */
function throughAFile(carry: JuliusBrainCarry, payload: JuliusBrainCarryPayload) {
  const file = JSON.stringify({ carry, bundle: payload.bundle, content: payload.content.map((item) => ({ contentHash: item.contentHash, base64: Buffer.from(item.bytes).toString('base64') })) });
  const read = JSON.parse(file) as { carry: JuliusBrainCarry; bundle: JuliusBrainExportBundle; content: { contentHash: string; base64: string }[] };
  return { carry: read.carry, payload: { bundle: read.bundle, content: read.content.map((item) => ({ contentHash: item.contentHash, bytes: new Uint8Array(Buffer.from(item.base64, 'base64')) })) } };
}

describe('the temporary Brain carry (a stopgap until the durable database)', () => {
  it('seals only a restorable bundle with every artifact byte, and opens only under the same key, Brain and environment', async () => {
    const a = await job();
    await a.julius.create('CONSTRAINT', { statement: 'Edit only the trust core file', status: 'ACTIVE' }, { key: 'c', scope: { missionId: MISSION } });
    await a.putArtifact('report.txt', 'the paid run ended FAILED: coder_cost_exceeded');
    const payload = await a.exportNow();
    const carry = seal(payload);
    expect(carry).toMatchObject({ purpose: 'TEMPORARY_CARRY', head: { sequence: 2 }, content: [{ byteSize: 46 }], seal: { algorithm: 'HMAC-SHA256', keyId: 'carry-key-1' } });
    expect(JSON.stringify(carry)).not.toContain(Buffer.from(KEY.secret).toString('hex'));

    const opened = openJuliusBrainCarry({ carry, payload, key: KEY, expect: EXPECT });
    expect(opened.outcome).toBe('OPENED');
    const restored = createJuliusBrainMemoryStore();
    expect(await restoreJuliusBrainFromExport(restored, payload.bundle)).toMatchObject({ outcome: 'RESTORED' });
    expect(await readAllJuliusBrainEntities(restored, BRAIN, PROJECT)).toEqual(await readAllJuliusBrainEntities(a.store, BRAIN, PROJECT));

    const refused = (overrides: Partial<Parameters<typeof openJuliusBrainCarry>[0]>) => {
      const result = openJuliusBrainCarry({ carry, payload, key: KEY, expect: EXPECT, ...overrides });
      return result.outcome === 'REFUSED' ? result.reasons : [];
    };
    expect(refused({ key: { keyId: 'carry-key-1', secret: new Uint8Array(32).fill(8) } })).toEqual(['seal: not sealed by this key']);
    expect(refused({ key: { keyId: 'carry-key-2', secret: KEY.secret } })).toEqual(['seal: not sealed by this key']);
    expect(refused({ carry: { ...carry, environment: 'production' } })).toEqual(['seal: not sealed by this key']);
    expect(refused({ expect: { ...EXPECT, environment: 'production' } })).toEqual(['environment: carry is test, expected production']);
    expect(refused({ expect: { ...EXPECT, projectId: 'prj-other' } })).toEqual(['brain: carry is for another Brain or project']);

    // The bundle, the bytes, the manifest: each must be what was sealed.
    const record = payload.bundle.records[0]!;
    const tamperedBundle = { ...payload.bundle, records: [{ ...record, body: { ...record.body, statement: 'Edit anything' } }, ...payload.bundle.records.slice(1)] };
    expect(refused({ payload: { ...payload, bundle: tamperedBundle } })).toContain('bundle: bundle_hash_mismatch');
    const flipped = new Uint8Array(payload.content[0]!.bytes); flipped[0] = flipped[0]! ^ 1;
    expect(refused({ payload: { ...payload, content: [{ contentHash: payload.content[0]!.contentHash, bytes: flipped }] } })).toEqual([`content: ${payload.content[0]!.contentHash} does not match`]);
    expect(refused({ payload: { ...payload, content: [] } })).toEqual([`content: ${payload.content[0]!.contentHash} missing`]);
    const stray = new TextEncoder().encode('not sealed');
    expect(refused({ payload: { ...payload, content: [...payload.content, { contentHash: `sha256:${createHash('sha256').update(stray).digest('hex')}`, bytes: stray }] } })[0]).toMatch(/is not in the sealed manifest$/);

    // Nothing unrestorable is ever sealed.
    expect(() => seal({ ...payload, content: [] })).toThrow('julius_brain_carry_content_missing');
    expect(() => seal({ ...payload, bundle: tamperedBundle })).toThrow('julius_brain_carry_bundle_not_restorable:bundle_hash_mismatch');
    await a.julius.create('MEMORY_FACT', { statement: 'The fixture codename is plover-7731', trust: 'UNVERIFIED', expiresAt: null }, { key: 'm', scope: { missionId: MISSION } });
    const redacted = await a.exportNow(['plover-7731']);
    expect(redacted.bundle.redaction.applied).toBeGreaterThan(0);
    expect(() => seal(redacted)).toThrow('julius_brain_carry_bundle_not_restorable:bundle_redacted');
  });

  it('lineage: a carry extends the carry it names; an older carry is a rollback; a fork cannot be sealed', async () => {
    const first = await job();
    await first.julius.create('CONSTRAINT', { statement: 'one', status: 'ACTIVE' }, { key: 'one', scope: { missionId: MISSION } });
    const payload1 = await first.exportNow();
    const carry1 = seal(payload1);

    // Job 2 restores carry 1, works, and seals a carry that names it.
    const second = createJuliusBrainMemoryStore();
    await restoreJuliusBrainFromExport(second, payload1.bundle);
    const job2 = await job(second);
    await job2.julius.create('CONSTRAINT', { statement: 'two', status: 'ACTIVE' }, { key: 'two', scope: { missionId: MISSION } });
    const payload2 = await job2.exportNow();
    const carry2 = seal(payload2, carry1.head);
    expect(openJuliusBrainCarry({ carry: carry2, payload: payload2, key: KEY, expect: { ...EXPECT, minimumSequence: carry1.head.sequence } }).outcome).toBe('OPENED');

    // Handing a later job the older carry is a rollback.
    const rollback = openJuliusBrainCarry({ carry: carry1, payload: payload1, key: KEY, expect: { ...EXPECT, minimumSequence: carry2.head.sequence } });
    expect(rollback).toEqual({ outcome: 'REFUSED', reasons: [`rollback: carry head 1 is below the known floor 2`] });

    // A job that restored carry 1 and diverged cannot claim to extend carry 2.
    const forked = createJuliusBrainMemoryStore();
    await restoreJuliusBrainFromExport(forked, payload1.bundle);
    const job3 = await job(forked);
    await job3.julius.create('CONSTRAINT', { statement: 'three', status: 'ACTIVE' }, { key: 'three', scope: { missionId: MISSION } });
    await job3.julius.create('CONSTRAINT', { statement: 'four', status: 'ACTIVE' }, { key: 'four', scope: { missionId: MISSION } });
    const payload3 = await job3.exportNow();
    expect(() => seal(payload3, carry2.head)).toThrow('julius_brain_carry_does_not_extend_previous');
    // …and rewriting which carry it names breaks the seal.
    expect(openJuliusBrainCarry({ carry: { ...carry2, previous: null }, payload: payload2, key: KEY, expect: EXPECT })).toEqual({ outcome: 'REFUSED', reasons: ['seal: not sealed by this key'] });
  });

  it('the journal: preserved only after every step in order, with the upload confirmed against the sealed digest', async () => {
    // Job 1: genesis, explicitly authorised.
    const first = await job();
    const journal1 = createJuliusBrainCarryJournal();
    expect(journal1.priorVerified({ outcome: 'GENESIS_AUTHORIZED' })).toBe(true);
    expect(journal1.restored({ outcome: 'GENESIS' })).toBe(true);
    await first.julius.create('CONSTRAINT', { statement: 'one', status: 'ACTIVE' }, { key: 'one', scope: { missionId: MISSION } });
    await first.putArtifact('evidence.txt', 'build passed');
    expect(journal1.executed()).toBe(true);
    const payload1 = await first.exportNow();
    const carry1 = seal(payload1);
    expect(journal1.exported(carry1)).toBe(true);
    expect(journal1.status()).toMatchObject({ preserved: false, mayDestroyDisposableState: false });
    const written = throughAFile(carry1, payload1);
    expect(journal1.exportVerified(openJuliusBrainCarry({ ...written, key: KEY, expect: EXPECT }))).toBe(true);
    expect(journal1.status()).toMatchObject({ step: 'EXPORT_VERIFIED', preserved: false, mayDestroyDisposableState: false });
    expect(journal1.uploadConfirmed({ storedDigest: juliusBrainCarryDigest(written.carry) })).toBe(true);
    expect(journal1.status()).toEqual({ step: 'UPLOAD_CONFIRMED', failed: null, carryDigest: juliusBrainCarryDigest(carry1), preserved: true, mayDestroyDisposableState: true });

    // Job 2: a fresh disposable store, the carry read back from the file, the same Brain afterwards.
    const journal2 = createJuliusBrainCarryJournal();
    const fromFile = throughAFile(carry1, payload1);
    const opened = openJuliusBrainCarry({ ...fromFile, key: KEY, expect: { ...EXPECT, minimumSequence: 0 } });
    expect(journal2.priorVerified(opened)).toBe(true);
    const disposable = createJuliusBrainMemoryStore();
    const restore = await restoreJuliusBrainFromExport(disposable, fromFile.payload.bundle);
    expect(journal2.restored(restore)).toBe(true);
    expect(await readAllJuliusBrainEntities(disposable, BRAIN, PROJECT)).toEqual(await readAllJuliusBrainEntities(first.store, BRAIN, PROJECT));

    // Upload not confirmed: the Brain is not preserved, and nothing may be destroyed.
    expect(journal2.executed()).toBe(true);
    const carry2 = seal({ bundle: (await exportJuliusBrain({ store: disposable, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: clock.now() }))!, content: fromFile.payload.content }, carry1.head);
    expect(journal2.exported(carry2)).toBe(true);
    expect(journal2.exportVerified(openJuliusBrainCarry({ carry: carry2, payload: { bundle: (await exportJuliusBrain({ store: disposable, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: clock.now() }))!, content: fromFile.payload.content }, key: KEY, expect: EXPECT }))).toBe(true);
    expect(journal2.uploadConfirmed({ storedDigest: null })).toBe(false);
    expect(journal2.status()).toMatchObject({ preserved: false, mayDestroyDisposableState: false, failed: { at: 'EXPORT_VERIFIED' } });
    expect(journal2.uploadConfirmed({ storedDigest: juliusBrainCarryDigest(carry2) })).toBe(false);

    // Out of order, a refused prior, a failed export, a different carry verified: never preserved.
    const early = createJuliusBrainCarryJournal();
    expect(early.exported(carry1)).toBe(false);
    expect(early.status()).toMatchObject({ preserved: false, failed: { reason: 'out of order: EXPORTED after STARTED' } });
    const refusedPrior = createJuliusBrainCarryJournal();
    expect(refusedPrior.priorVerified({ outcome: 'REFUSED', reasons: ['seal: not sealed by this key'] })).toBe(false);
    expect(refusedPrior.status().failed).toEqual({ at: 'STARTED', reason: 'prior carry refused: seal: not sealed by this key' });
    const swapped = createJuliusBrainCarryJournal();
    swapped.priorVerified({ outcome: 'GENESIS_AUTHORIZED' }); swapped.restored({ outcome: 'GENESIS' }); swapped.executed(); swapped.exported(carry2);
    expect(swapped.exportVerified(opened)).toBe(false);
    expect(swapped.status()).toMatchObject({ preserved: false, failed: { reason: 'export verified a different carry than was sealed' } });
    const noExport = createJuliusBrainCarryJournal();
    noExport.priorVerified({ outcome: 'GENESIS_AUTHORIZED' }); noExport.restored({ outcome: 'GENESIS' }); noExport.executed();
    expect(noExport.exported({ error: 'ENOSPC: no space left on device' })).toBe(false);
    expect(noExport.status()).toMatchObject({ preserved: false, mayDestroyDisposableState: false, failed: { at: 'EXECUTED', reason: 'export failed: ENOSPC: no space left on device' } });
  });
});
