import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { paidRunArchive, paidRunArchiveBody } from './julius-brain-archive-fixtures';
import {
  importJuliusPaidRunArchive,
  juliusArchiveEntityId,
  sealJuliusPaidRunArchiveExport,
  validateJuliusPaidRunArchiveExport,
  type JuliusArchiveContentPort,
  type JuliusPaidRunArchiveExport,
} from './julius-brain-archive-import';
import { juliusPrincipal } from './julius-brain-contracts';
import { exportJuliusBrain, restoreJuliusBrainFromExport } from './julius-brain-export';
import { createJuliusProjectBrainService } from './julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, readAllJuliusBrainRecords } from './julius-brain-store';

const BRAIN = 'brain:julius';
const PROJECT = 'prj-julius-live-4';
const JULIUS = juliusPrincipal('JULIUS', 'julius');

function memoryContent(): JuliusArchiveContentPort & { bytes: Map<string, Uint8Array> } {
  const bytes = new Map<string, Uint8Array>();
  return {
    bytes,
    async put(content) {
      const hex = createHash('sha256').update(content).digest('hex');
      bytes.set(hex, content);
      return { contentHash: `sha256:${hex}`, byteSize: content.byteLength, storageRef: `cas://sha256/${hex}` };
    },
  };
}

async function brain() {
  const store = createJuliusBrainMemoryStore();
  const service = createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T10:00:00.000Z' } });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
  const content = memoryContent();
  const importArchive = (archive: JuliusPaidRunArchiveExport) => importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive, content, recordedAt: '2026-09-15T10:00:00.000Z' });
  return { store, service, content, importArchive };
}

describe('paid-run archive → Project Brain', () => {
  it('imports one run atomically, scoped to its run, with provenance on every record and unknown cost kept unknown', async () => {
    const { store, content, importArchive } = await brain();
    const archive = paidRunArchive();
    expect(validateJuliusPaidRunArchiveExport(archive)).toEqual([]);
    const result = await importArchive(archive);
    if (result.outcome !== 'IMPORTED') throw new Error(JSON.stringify(result));
    expect(result.duplicates).toBe(0);
    expect(result.counts).toEqual({ ARTIFACT: 2, TRACE: 10, EVIDENCE: 7, DECISION: 2, FINDING: 1, REPAIR: 1, RESEARCH: 1 });
    expect(result.accounting).toEqual({ knownUsdMicros: 369044, knownIsFloor: true, estimatedUsdMicros: 41200, unknownComponents: 2, components: 3 });

    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    expect(entities).toHaveLength(result.appended);
    for (const state of entities) {
      expect(state.scope).toMatchObject({ missionId: 'mission:julius-live-4', runId: 'workflow:34739303313/1' });
      expect(state.provenance.commit).toBe('0845c593aa1ef2b7d1c4e8f6a09b3c2d5e7f8a91');
      expect(state.provenance.externalRef).toMatch(/^julius-paid-run-archive:34739303313\/1#/);
      expect(state.createdBy).toEqual(juliusPrincipal('JULIUS', 'julius:archive-importer'));
      if (state.entityId !== result.anchorEntityId) expect(state.links.some((link) => link.relation === 'DERIVED_FROM' && link.target === result.anchorEntityId)).toBe(true);
    }
    // The anchor is the export's own bytes, content-addressed and resolvable.
    const anchor = entities.find((state) => state.entityId === result.anchorEntityId)!;
    const hex = String(anchor.body.contentHash).slice(7);
    expect(content.bytes.has(hex)).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(content.bytes.get(hex)!)).integrity.contentHash).toBe(archive.integrity.contentHash);

    const byId = new Map(entities.map((state) => [state.entityId, state]));
    const run = archive.run;
    expect(byId.get(juliusArchiveEntityId(run, 'usage', 'usage-architect'))!.body).toMatchObject({ status: 'INCONCLUSIVE', data: { usdMicros: null, costBasis: 'UNKNOWN', provider: 'openai', model: 'gpt-5.6-sol' } });
    expect(byId.get(juliusArchiveEntityId(run, 'usage', 'usage-architect'))!.provenance).toMatchObject({ provider: 'openai', model: 'gpt-5.6-sol' });
    expect(byId.get(juliusArchiveEntityId(run, 'findings', 'f-budget'))!.body).toMatchObject({ severity: 'UNKNOWN', blocking: true, status: 'OPEN' });
    expect(byId.get(juliusArchiveEntityId(run, 'findings', 'f-budget'))!.inbound).toEqual([{ relation: 'REPAIRS', source: juliusArchiveEntityId(run, 'repairs', 'repair:build-1:1'), sourceKind: 'REPAIR' }]);
    expect(byId.get(juliusArchiveEntityId(run, 'reviews', 'dec-build'))!.body.rationale).toBe('Unknown — the archive recorded no rationale.');
    expect(byId.get(juliusArchiveEntityId(run, 'events', '2'))!.body.facts).toMatchObject({ allocationBasis: 'ESTIMATE_NO_LEDGER', droppedFacts: 1 });
    expect(byId.get(juliusArchiveEntityId(run, 'artifacts', 'art-plan'))!.body).toMatchObject({ byteSize: 1834, storageRef: 'archive-ref:34739303313/1/art-plan' });
  });

  it('is idempotent: re-importing writes nothing; another attempt is another run', async () => {
    const { store, importArchive } = await brain();
    const first = await importArchive(paidRunArchive());
    const head = await store.head(BRAIN, PROJECT);
    const again = await importArchive(JSON.parse(JSON.stringify(paidRunArchive())));
    expect(again).toMatchObject({ outcome: 'ALREADY_IMPORTED', appended: 0 });
    expect(await store.head(BRAIN, PROJECT)).toEqual(head);
    // The same mission contract, so the same Julius run id — and still another Brain run.
    const second = await importArchive(paidRunArchive({ attempt: 2 }));
    expect(paidRunArchive({ attempt: 2 }).run.juliusRunId).toBe(paidRunArchive().run.juliusRunId);
    expect(second).toMatchObject({ outcome: 'IMPORTED', brainRunId: 'workflow:34739303313/2' });
    const lifecycles = (await readAllJuliusBrainEntities(store, BRAIN, PROJECT)).filter((state) => state.kind === 'TRACE' && state.body.traceClass === 'LIFECYCLE');
    expect(lifecycles.map((state) => [state.scope.runId, (state.body.facts as { juliusRunId: string }).juliusRunId]).sort()).toEqual([
      ['workflow:34739303313/1', 'run:julius-live-4'], ['workflow:34739303313/2', 'run:julius-live-4'],
    ]);
    expect((await readAllJuliusBrainEntities(store, BRAIN, PROJECT)).length).toBe((first.outcome === 'IMPORTED' ? first.appended : 0) * 2);
  });

  it('rejects a tampered export before writing, and refuses a re-sealed different history under the same keys', async () => {
    const { store, importArchive } = await brain();
    const archive = paidRunArchive();
    const tampered = { ...archive, evidence: archive.evidence.map((item, i) => (i === 2 ? { ...item, status: 'PASSED' as const } : item)) };
    const rejected = await importArchive(tampered);
    expect(rejected).toMatchObject({ outcome: 'REJECTED' });
    expect(rejected.outcome === 'REJECTED' && rejected.errors).toEqual(['integrity.sectionHashes.evidence: does not match the section', 'integrity.contentHash: does not match the export']);
    expect(await store.head(BRAIN, PROJECT)).toMatchObject({ sequence: 0 });

    await importArchive(archive);
    const head = await store.head(BRAIN, PROJECT);
    // A correctly re-sealed but DIFFERENT history of the same run and attempt is not an overwrite.
    const rewritten = sealJuliusPaidRunArchiveExport({ ...paidRunArchiveBody(), evidence: paidRunArchiveBody().evidence.map((item, i) => (i === 2 ? { ...item, status: 'PASSED' as const } : item)) });
    expect(await importArchive(rewritten)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'idempotency_key_conflict' });
    expect(await store.head(BRAIN, PROJECT)).toEqual(head);
  });

  it('rejects broken references, credential-shaped content and dishonest cost, each with its location', async () => {
    const { store, importArchive } = await brain();
    const broken = paidRunArchive({ mutate: (body) => ({ ...body, findings: body.findings.map((item) => ({ ...item, evidenceIds: ['ev-missing'] })) }) });
    expect(await importArchive(broken)).toMatchObject({ outcome: 'REJECTED', errors: ['findings[0].evidenceIds: ev-missing is not in evidence'] });
    const token = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz012345'].join('-');
    const leaky = paidRunArchive({ mutate: (body) => ({ ...body, evidence: body.evidence.map((item, i) => (i === 0 ? { ...item, safeSummary: `used ${token}` } : item)) }) });
    const leak = await importArchive(leaky);
    expect(leak).toMatchObject({ outcome: 'REJECTED', errors: ['evidence[0]: credential-shaped content (provider-key)'] });
    expect(JSON.stringify(leak)).not.toContain(token);
    const zeroBill = paidRunArchive({ mutate: (body) => ({ ...body, usage: body.usage.map((item) => (item.componentId === 'usage-coder' ? { ...item, usdMicros: null } : item)) }) });
    expect(await importArchive(zeroBill)).toMatchObject({ outcome: 'REJECTED', errors: ['usage[2]: PROVIDER_REPORTED requires usdMicros'] });
    const inventedAmount = paidRunArchive({ mutate: (body) => ({ ...body, usage: body.usage.map((item) => (item.componentId === 'usage-architect' ? { ...item, usdMicros: 0 } : item)) }) });
    expect(await importArchive(inventedAmount)).toMatchObject({ outcome: 'REJECTED', errors: ['usage[0]: UNKNOWN basis cannot carry usdMicros'] });
    expect(await store.head(BRAIN, PROJECT)).toMatchObject({ sequence: 0 });
  });

  it('is all or nothing: a refusal partway through leaves the Brain untouched', async () => {
    const { store, service, importArchive } = await brain();
    const archive = paidRunArchive();
    const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
    // Something else already holds an id the import needs, deep in the batch.
    const squatter = await julius.create('CONSTRAINT', { statement: 'squatting', status: 'ACTIVE' }, { key: 'squat', entityId: juliusArchiveEntityId(archive.run, 'events', '4') });
    expect(squatter.outcome).toBe('COMMITTED');
    const head = await store.head(BRAIN, PROJECT);
    expect(await importArchive(archive)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'entity_already_exists' });
    expect(await store.head(BRAIN, PROJECT)).toEqual(head);
    expect(await readAllJuliusBrainRecords(store, BRAIN, PROJECT)).toHaveLength(1);
  });

  it('survives export and restore byte for byte', async () => {
    const { store, importArchive } = await brain();
    await importArchive(paidRunArchive());
    const bundle = (await exportJuliusBrain({ store, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: '2026-09-15T11:00:00.000Z' }))!;
    expect(bundle.redaction.applied).toBe(0);
    const restored = createJuliusBrainMemoryStore();
    expect(await restoreJuliusBrainFromExport(restored, JSON.parse(JSON.stringify(bundle)))).toMatchObject({ outcome: 'RESTORED' });
    expect(await readAllJuliusBrainEntities(restored, BRAIN, PROJECT)).toEqual(await readAllJuliusBrainEntities(store, BRAIN, PROJECT));
  });
});
