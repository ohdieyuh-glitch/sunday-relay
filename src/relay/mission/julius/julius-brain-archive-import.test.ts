import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { PAID_RUN_ARTIFACT_BYTES, paidRunArchive, paidRunArchiveBody } from './julius-brain-archive-fixtures';
import {
  checkJuliusPaidRunArchiveExport,
  importJuliusPaidRunArchive,
  juliusArchiveEntityId,
  sealJuliusPaidRunArchiveExport,
  validateJuliusPaidRunArchiveExport,
  type JuliusArchiveContentPort,
  type JuliusPaidRunArchiveExport,
  type JuliusPaidRunArchiveExportBody,
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
  const importArchive = (archive: JuliusPaidRunArchiveExport, options: { artifactBytes?: (id: string) => Uint8Array | null; projectId?: string } = {}) =>
    importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: options.projectId ?? PROJECT, archive, content, recordedAt: '2026-09-15T10:00:00.000Z', artifactBytes: options.artifactBytes });
  return { store, service, content, importArchive };
}

/** Re-seal after a mutation, as a (faulty or hostile) exporter would: integrity checks alone cannot catch it. */
const resealed = (mutate: (body: JuliusPaidRunArchiveExportBody) => unknown) => sealJuliusPaidRunArchiveExport(mutate(paidRunArchiveBody()) as JuliusPaidRunArchiveExportBody);
const errorsOf = (archive: unknown) => validateJuliusPaidRunArchiveExport(archive);

describe('paid-run archive export v1 → Project Brain', () => {
  it('imports one attempt atomically, scoped to its workflow run, with Unknown kept Unknown and nothing trusted', async () => {
    const { store, content, importArchive } = await brain();
    const archive = paidRunArchive();
    expect(validateJuliusPaidRunArchiveExport(archive)).toEqual([]);
    const result = await importArchive(archive);
    if (result.outcome !== 'IMPORTED') throw new Error(JSON.stringify(result));
    expect(result.duplicates).toBe(0);
    expect(result.counts).toEqual({ ARTIFACT: 2, TRACE: 15, EVIDENCE: 9, DECISION: 2, FINDING: 1, REPAIR: 1, RESEARCH: 2 });
    expect(result.accounting).toEqual({ knownUsdMicros: 369044, knownIsFloor: true, estimatedUsdMicros: 41200, unknownComponents: 2, components: 3 });
    // The two v1 decision entries are the two reviews: one logical fact, one record.
    expect(result.represented).toEqual({ entriesByReview: 2, entriesByLiveMirror: 0, reviewsByLiveMirror: 0 });
    expect(result.unknownFields).toBe(46);

    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    expect(entities).toHaveLength(result.appended);
    for (const state of entities) {
      expect(state.scope).toMatchObject({ missionId: 'mission:julius-live-4', runId: 'workflow:34739303313/1' });
      expect(state.provenance.commit).toBe('0845c593aa1ef2b7d1c4e8f6a09b3c2d5e7f8a91');
      expect(state.provenance.externalRef).toMatch(/^julius-paid-run-archive:34739303313\/1#/);
      expect(state.createdBy).toEqual(juliusPrincipal('JULIUS', 'julius:archive-importer'));
      if (state.entityId !== result.anchorEntityId) expect(state.links.some((link) => link.relation === 'DERIVED_FROM' && link.target === result.anchorEntityId)).toBe(true);
      // An archive grants no trust: every imported piece of evidence is UNVERIFIED, whatever the source said.
      if (state.kind === 'EVIDENCE') expect(state.body.verification).toBe('UNVERIFIED');
    }
    const anchor = entities.find((state) => state.entityId === result.anchorEntityId)!;
    expect(JSON.parse(new TextDecoder().decode(content.bytes.get(String(anchor.body.contentHash).slice(7))!)).integrity.contentHash).toBe(archive.integrity.contentHash);

    const identity = archive.identity;
    const get = (section: Parameters<typeof juliusArchiveEntityId>[1], id: string) => entities.find((state) => state.entityId === juliusArchiveEntityId(identity, section, id))!;
    // Unknown: no severity, no time, no task, no evidence links — none invented.
    expect(get('findings', 'f-budget')).toMatchObject({ createdAt: null, scope: { taskId: null }, links: [{ relation: 'DERIVED_FROM' }], body: { severity: 'UNKNOWN', blocking: true } });
    expect((await readAllJuliusBrainRecords(store, BRAIN, PROJECT)).find((record) => record.entityId === get('findings', 'f-budget').entityId)!.occurredAt).toBeNull();
    expect(get('evidence', 'ev-review').body).toMatchObject({ verification: 'UNVERIFIED', data: { sourceVerification: 'VERIFIED' } });
    expect(get('evidence', 'ev-cmd')).toMatchObject({ scope: { taskId: null }, body: { evidenceClass: 'COMMAND_EXECUTION', data: { artifactRefs: null, unknown: ['artifactRefs', 'integrityHash', 'sourceVerification', 'taskId'] } } });
    expect(get('reviews', 'dec-build').body).toMatchObject({ statement: 'REPAIR (BLOCKING_FINDINGS) on build-1', rationale: 'Unknown — the archive recorded no rationale.' });
    expect(get('repairs', 'repair:build-1:1').body).toMatchObject({ status: 'ABANDONED', reason: 'Repair round 1 of build-1; the archive recorded no reason' });
    expect(get('usage', 'usage-coder').body).toMatchObject({ data: { provider: null, model: null, inputTokens: null, usdMicros: 369044, costBasis: 'PROVIDER_REPORTED' } });
    expect(get('research', 'build-1:1:0').body).toMatchObject({ unresolved: ['refused: host_not_allowlisted'], sources: [{ reference: 'registry.example.org', retrievedAt: null }] });
    expect(get('researchDelivery', 'plan-1:1:0').body.facts).toMatchObject({ bytes: 18342, rangeStart: 0, rangeEnd: 18341, disposition: 'SERVED', unknown: 'evidenceId,handoffRef' });
    expect(get('events', 'trajectory.tsv#1').body.facts).toMatchObject({ sequence: null, unknown: 'sequence', durationMs: 81000 });
    expect(get('brainEntries', 'brain:guidance-request:build-1').body.summary).toContain('its content is not archived');
    expect(entities.some((state) => state.entityId === juliusArchiveEntityId(identity, 'brainEntries', 'brain:decision:build-1:REPAIR:BLOCKING_FINDINGS'))).toBe(false);
    expect(get('report', '34739303313/1').body).toMatchObject({ status: 'INCONCLUSIVE', data: { unknownFields: 46, unknownByField: { 'findings.severity': 1, 'findings.occurredAt': 1, 'usage.provider': 1, 'usage.usdMicros': 2, 'tasks.workerId': 4 }, represented: { entriesByReview: 2 } } });
    // No bytes were supplied for the artifact: a reference, honestly unresolvable.
    expect(get('artifacts', 'art-plan').body).toMatchObject({ storageRef: 'archive-ref:34739303313/1/art-plan' });
  });

  it('artifact digests: supplied bytes are verified and held; bytes that do not match are refused before anything is written', async () => {
    const held = await brain();
    const result = await held.importArchive(paidRunArchive(), { artifactBytes: (id) => PAID_RUN_ARTIFACT_BYTES.get(id) ?? null });
    expect(result.outcome).toBe('IMPORTED');
    const artifact = (await readAllJuliusBrainEntities(held.store, BRAIN, PROJECT)).find((state) => state.entityId === juliusArchiveEntityId(paidRunArchive().identity, 'artifacts', 'art-plan'))!;
    expect(artifact.body.storageRef).toMatch(/^cas:\/\/sha256\/[0-9a-f]{64}$/);
    expect(artifact.body.contentHash).toBe(`sha256:${String(artifact.body.storageRef).slice('cas://sha256/'.length)}`);

    const wrong = await brain();
    const rejected = await wrong.importArchive(paidRunArchive(), { artifactBytes: () => new TextEncoder().encode('{"plan":"something else entirely, of a different size"}') });
    expect(rejected).toMatchObject({ outcome: 'REJECTED', reasonCode: 'artifact_bytes_mismatch' });
    expect(await wrong.store.head(BRAIN, PROJECT)).toMatchObject({ sequence: 0 });
    expect(wrong.content.bytes.size).toBe(0);
  });

  it('is idempotent: re-importing writes nothing; another attempt of the same contract is another run', async () => {
    const { store, importArchive } = await brain();
    const first = await importArchive(paidRunArchive());
    const head = await store.head(BRAIN, PROJECT);
    expect(await importArchive(JSON.parse(JSON.stringify(paidRunArchive())))).toMatchObject({ outcome: 'ALREADY_IMPORTED', appended: 0 });
    expect(await store.head(BRAIN, PROJECT)).toEqual(head);
    const second = await importArchive(paidRunArchive({ attempt: 2 }));
    expect(paidRunArchive({ attempt: 2 }).identity.juliusRunId).toBe(paidRunArchive().identity.juliusRunId);
    expect(second).toMatchObject({ outcome: 'IMPORTED', brainRunId: 'workflow:34739303313/2' });
    const lifecycles = (await readAllJuliusBrainEntities(store, BRAIN, PROJECT)).filter((state) => state.kind === 'TRACE' && state.body.traceClass === 'LIFECYCLE' && state.entityId.includes(':run:'));
    expect(lifecycles.map((state) => [state.scope.runId, (state.body.facts as { juliusRunId: string }).juliusRunId]).sort()).toEqual([
      ['workflow:34739303313/1', 'run:julius-live-4'], ['workflow:34739303313/2', 'run:julius-live-4'],
    ]);
    expect((await readAllJuliusBrainEntities(store, BRAIN, PROJECT)).length).toBe((first.outcome === 'IMPORTED' ? first.appended : 0) * 2);
  });

  it('versions: another version of the format, or another format, fails safely and says which', async () => {
    const { store, importArchive } = await brain();
    const v2 = { ...paidRunArchive(), format: 'julius-paid-run-archive-export.v2' } as unknown as JuliusPaidRunArchiveExport;
    expect(await importArchive(v2)).toEqual({ outcome: 'REJECTED', reasonCode: 'unsupported_export_version', errors: ['format: version v2 is not supported; this importer reads julius-paid-run-archive-export.v1 only'] });
    expect(checkJuliusPaidRunArchiveExport({ ...paidRunArchive(), format: 'julius-paid-run-archive-export.v0' })).toMatchObject({ ok: false, reasonCode: 'unsupported_export_version' });
    expect(checkJuliusPaidRunArchiveExport({ ...paidRunArchive(), format: 'julius-project-brain-export.v1' })).toMatchObject({ ok: false, reasonCode: 'not_an_archive_export' });
    expect(checkJuliusPaidRunArchiveExport({ run: {} })).toMatchObject({ ok: false, reasonCode: 'not_an_archive_export' });
    expect(checkJuliusPaidRunArchiveExport(null)).toMatchObject({ ok: false, reasonCode: 'not_an_archive_export' });
    expect(await store.head(BRAIN, PROJECT)).toMatchObject({ sequence: 0 });
  });

  it('integrity: identity, accepted main, state mode and every section are bound by hash; a re-sealed different history is a conflict', async () => {
    const { store, importArchive } = await brain();
    const archive = paidRunArchive();
    const tamperedIdentity = (patch: object) => ({ ...archive, identity: { ...archive.identity, ...patch } });
    expect(errorsOf(tamperedIdentity({ acceptedMainSha: 'f'.repeat(40) }))).toEqual(['integrity.sectionHashes.identity: does not match', 'integrity.contentHash: does not match the export']);
    expect(errorsOf(tamperedIdentity({ stateMode: 'LEARNING' }))).toEqual(['integrity.sectionHashes.identity: does not match', 'integrity.contentHash: does not match the export']);
    expect(errorsOf(tamperedIdentity({ workflowRunAttempt: 9 }))).toEqual(['integrity.sectionHashes.identity: does not match', 'integrity.contentHash: does not match the export']);
    expect(errorsOf({ ...archive, evidence: archive.evidence.map((item, i) => (i === 2 ? { ...item, status: 'PASSED' } : item)) }))
      .toEqual(['integrity.sectionHashes.evidence: does not match', 'integrity.contentHash: does not match the export']);
    expect(errorsOf({ ...archive, exportedAt: '2026-09-16T09:00:00.000Z' })).toEqual(['integrity.contentHash: does not match the export']);
    const { tasks: _tasks, ...hashesWithoutTasks } = archive.integrity.sectionHashes;
    expect(errorsOf({ ...archive, integrity: { ...archive.integrity, sectionHashes: hashesWithoutTasks } })).toContain('integrity.sectionHashes: exactly the identity, the accounting claim and every section');

    // A project the import was not asked for.
    expect(await importArchive(archive, { projectId: 'prj-other' })).toMatchObject({ outcome: 'REJECTED', reasonCode: 'identity_mismatch' });

    await importArchive(archive);
    const head = await store.head(BRAIN, PROJECT);
    // A correctly re-sealed but DIFFERENT history of the same attempt is not an overwrite.
    const rewritten = resealed((body) => ({ ...body, evidence: body.evidence.map((item, i) => (i === 2 ? { ...item, status: 'PASSED' } : item)) }));
    expect(await importArchive(rewritten)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'idempotency_key_conflict' });
    expect(await store.head(BRAIN, PROJECT)).toEqual(head);
  });

  it('Unknown is explicit: empty strings, malformed unknown lists, missing or extra fields and unlisted null lists are refused with their location', async () => {
    const withFinding = (patch: object) => resealed((body) => ({ ...body, findings: [{ ...body.findings[0], ...patch }] }));
    expect(errorsOf(withFinding({ claim: '' }))).toEqual(['findings[0].claim: an empty string is not a value (null means Unknown)']);
    expect(errorsOf(withFinding({ severity: 'HIGH' }))).toEqual(['findings[0].unknown: severity is listed as Unknown but has a value']);
    expect(errorsOf(withFinding({ unknown: ['evidenceIds', 'occurredAt', 'rationale', 'severity', 'taskId', 'claim'] }))).toEqual(expect.arrayContaining(['findings[0].unknown: claim is not a nullable field']));
    expect(errorsOf(withFinding({ unknown: ['taskId', 'evidenceIds', 'occurredAt', 'rationale', 'severity'] }))).toEqual(['findings[0].unknown: sorted and unique']);
    expect(errorsOf(withFinding({ evidenceIds: null, unknown: ['occurredAt', 'rationale', 'severity', 'taskId'] }))).toEqual(['findings[0].evidenceIds: null must be listed as Unknown ([] records none)']);
    expect(errorsOf(withFinding({ blocking: null }))).toEqual(['findings[0].blocking: required']);
    expect(errorsOf(withFinding({ confidence: 0.9 }))).toEqual(['findings[0].confidence: not part of the contract']);
    expect(errorsOf(resealed((body) => ({ ...body, tasks: body.tasks.map(({ workerId: _w, ...task }) => task) })))).toContain('tasks[0].workerId: missing');
    expect(errorsOf(resealed((body) => ({ ...body, identity: { ...body.identity, outcomeReason: '' } })))).toEqual(['identity.outcomeReason: an empty string is not a value (null means Unknown)']);
    expect(errorsOf(resealed((body) => ({ ...body, events: [{ ...body.events[0], facts: { note: '' } }] })))).toEqual(['events[0].facts.note: an empty string is not a value (null means Unknown)']);
    expect(errorsOf(resealed((body) => ({ ...body, research: [{ ...body.research[0], deliveryRange: { start: 9, end: 3 } }] })))).toEqual(['research[0].deliveryRange: start after end']);
    expect(errorsOf(resealed((body) => ({ ...body, research: [{ ...body.research[0], refusalReason: 'served anyway' }] })))).toEqual(['research[0].refusalReason: only a REFUSED request has one']);
    expect(errorsOf(resealed((body) => ({ ...body, identity: { ...body.identity, occurredAt: '2026-09-13T05:00:00.000Z' } })))).toEqual(['identity.occurredAt: not part of the contract']);
    expect(errorsOf(resealed((body) => ({ ...body, run: body.identity })))).toEqual(['run: not part of the contract']);
    expect(errorsOf(resealed((body) => ({ ...body, usage: [{ ...body.usage[0], startedAt: 'yesterday' }] })))).toEqual(['usage[0].startedAt: not part of the contract']);
    expect(errorsOf(resealed((body) => ({ ...body, events: [{ ...body.events[0], occurredAt: '13/09/2026' }] })))).toEqual(['events[0].occurredAt: an ISO timestamp']);
  });

  it('rejects broken references, credential-shaped content and dishonest cost, each with its location', async () => {
    const { store, importArchive } = await brain();
    expect(await importArchive(resealed((body) => ({ ...body, reviews: body.reviews.map((item) => ({ ...item, evidenceIds: ['ev-missing'] })) }))))
      .toMatchObject({ outcome: 'REJECTED', errors: ['reviews[0].evidenceIds: ev-missing is not in evidence', 'reviews[1].evidenceIds: ev-missing is not in evidence'] });
    expect(errorsOf(resealed((body) => ({ ...body, repairs: [{ ...body.repairs[0], findingIds: ['f-missing'] }] })))).toEqual(['repairs[0].findingIds: f-missing is not in findings']);
    expect(errorsOf(resealed((body) => ({ ...body, evidence: [{ ...body.evidence[0], artifactRefs: ['art-missing'] }, ...body.evidence.slice(1)] })))).toEqual(['evidence[0].artifactRefs: art-missing is not in artifacts']);
    expect(errorsOf(resealed((body) => ({ ...body, tasks: [...body.tasks, { ...body.tasks[0] }] })))).toEqual(['tasks: duplicate id plan-1']);
    const token = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz012345'].join('-');
    const leak = await importArchive(resealed((body) => ({ ...body, evidence: body.evidence.map((item, i) => (i === 0 ? { ...item, safeSummary: `used ${token}` } : item)) })));
    expect(leak).toMatchObject({ outcome: 'REJECTED', errors: ['evidence[0]: credential-shaped content (provider-key)'] });
    expect(JSON.stringify(leak)).not.toContain(token);
    expect(errorsOf(resealed((body) => ({ ...body, usage: body.usage.map((item) => (item.componentId === 'usage-coder' ? { ...item, usdMicros: null, unknown: [...item.unknown, 'usdMicros'].sort() } : item)) }))))
      .toEqual(['usage[2]: PROVIDER_REPORTED requires usdMicros', 'accounting.knownUsdMicros: the export claims 369044; its usage sums to 0']);
    expect(errorsOf(resealed((body) => ({ ...body, usage: body.usage.map((item) => (item.componentId === 'usage-architect' ? { ...item, usdMicros: 0, unknown: ['estimatedUsdMicros'] } : item)) }))))
      .toEqual(['usage[0]: UNKNOWN basis cannot carry usdMicros']);
    expect(await store.head(BRAIN, PROJECT)).toMatchObject({ sequence: 0 });
  });

  it('is all or nothing: a refusal partway through leaves the Brain untouched', async () => {
    const { store, service, importArchive } = await brain();
    const archive = paidRunArchive();
    const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
    // Something else already holds an id the import needs, deep in the batch.
    const squatter = await julius.create('CONSTRAINT', { statement: 'squatting', status: 'ACTIVE' }, { key: 'squat', entityId: juliusArchiveEntityId(archive.identity, 'events', 'failures.tsv#4') });
    expect(squatter.outcome).toBe('COMMITTED');
    const head = await store.head(BRAIN, PROJECT);
    expect(await importArchive(archive)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'entity_already_exists' });
    expect(await store.head(BRAIN, PROJECT)).toEqual(head);
    expect(await readAllJuliusBrainRecords(store, BRAIN, PROJECT)).toHaveLength(1);
  });

  it('survives export and restore byte for byte, Unknown times included', async () => {
    const { store, importArchive } = await brain();
    await importArchive(paidRunArchive());
    const bundle = (await exportJuliusBrain({ store, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: '2026-09-15T11:00:00.000Z' }))!;
    expect(bundle.redaction.applied).toBe(0);
    const restored = createJuliusBrainMemoryStore();
    expect(await restoreJuliusBrainFromExport(restored, JSON.parse(JSON.stringify(bundle)))).toMatchObject({ outcome: 'RESTORED' });
    expect(await readAllJuliusBrainEntities(restored, BRAIN, PROJECT)).toEqual(await readAllJuliusBrainEntities(store, BRAIN, PROJECT));
  });
});
