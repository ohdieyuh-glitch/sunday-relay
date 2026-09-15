import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { paidRunArchive } from './julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive } from './julius-brain-archive-import';
import { juliusPrincipal } from './julius-brain-contracts';
import {
  deriveJuliusBrainRunPreservation,
  juliusArchiveRecoveryEntityId,
  juliusRunOpenedBody,
  juliusRunOpenedEntityId,
  juliusRunPreservedCheckpointLabel,
  juliusRunSealedBody,
  juliusRunSealedEntityId,
} from './julius-brain-preservation';
import { createJuliusProjectBrainService } from './julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, readAllJuliusBrainRecords } from './julius-brain-store';

const BRAIN = 'brain:prj-julius-live-4';
const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const RUN = 'workflow:34739303313/1';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const content = { put: async (bytes: Uint8Array) => { const hex = createHash('sha256').update(bytes).digest('hex'); return { contentHash: `sha256:${hex}`, byteSize: bytes.byteLength, storageRef: `cas://sha256/${hex}` }; } };

async function brain() {
  const store = createJuliusBrainMemoryStore();
  const service = createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T12:00:00.000Z' } });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
  const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
  const derive = async (brainRunId = RUN) => deriveJuliusBrainRunPreservation({
    brainId: BRAIN, brainRunId, records: await readAllJuliusBrainRecords(store, BRAIN, PROJECT), entities: await readAllJuliusBrainEntities(store, BRAIN, PROJECT),
  });
  const scope = { missionId: MISSION, runId: RUN };
  const open = () => julius.create('TRACE', juliusRunOpenedBody({ brainRunId: RUN, juliusRunId: 'run:julius-live-4', missionId: MISSION, acceptedMainSha: null }), { key: juliusRunOpenedEntityId(RUN), entityId: juliusRunOpenedEntityId(RUN), scope });
  const seal = (expected: number, written: number) => julius.create('TRACE', juliusRunSealedBody({ brainRunId: RUN, expectedEntries: expected, writtenEntries: written, missingEntryIds: [] }), { key: juliusRunSealedEntityId(RUN), entityId: juliusRunSealedEntityId(RUN), scope });
  return { store, julius, derive, open, seal };
}

describe('run preservation, derived from durable evidence', () => {
  it('nothing durable is NOT_PRESERVED, an open alone is PARTIALLY_PRESERVED, and every reason is named', async () => {
    const { derive, open } = await brain();
    expect(await derive()).toEqual({
      brainRunId: RUN, status: 'NOT_PRESERVED',
      evidence: { opened: null, sealed: null, checkpoint: null, liveRecords: 0, recoveries: [] },
      reasons: ['the run was never opened against a verified Brain', 'the run was never sealed', 'no checkpoint was committed for the run'],
    });
    await open();
    expect(await derive()).toMatchObject({ status: 'PARTIALLY_PRESERVED', evidence: { opened: { juliusRunId: 'run:julius-live-4' }, liveRecords: 1 }, reasons: ['the run was never sealed', 'no checkpoint was committed for the run'] });
  });

  it('a checkpoint taken before the seal, or one that does not re-derive, is not preservation', async () => {
    const early = await brain();
    await early.open();
    await early.julius.checkpoint(juliusRunPreservedCheckpointLabel(RUN));
    await early.seal(0, 0);
    expect(await early.derive()).toMatchObject({ status: 'PARTIALLY_PRESERVED', reasons: ['the run checkpoint was taken before the seal'] });

    const lying = await brain();
    await lying.open();
    await lying.seal(0, 0);
    const head = (await lying.store.head(BRAIN, PROJECT))!;
    await lying.julius.create('CHECKPOINT', { label: juliusRunPreservedCheckpointLabel(RUN), throughSequence: head.sequence, stateHash: `sha256:${'0'.repeat(64)}`, entityCount: 2 }, { key: 'forged-state' });
    expect(await lying.derive()).toMatchObject({ status: 'PARTIALLY_PRESERVED', evidence: { checkpoint: { matches: false } }, reasons: ['the run checkpoint does not re-derive from the ledger'] });

    const honest = await brain();
    await honest.open();
    await honest.seal(0, 0);
    await honest.julius.checkpoint(juliusRunPreservedCheckpointLabel(RUN));
    expect(await honest.derive()).toMatchObject({ status: 'PRESERVED', reasons: [] });
    // Another run's evidence says nothing about this one.
    expect(await honest.derive('workflow:34739303313/2')).toMatchObject({ status: 'NOT_PRESERVED' });
  });

  it('records an archive import wrote are not live evidence, and a recovery is listed without making a run PRESERVED', async () => {
    const { store, julius, derive } = await brain();
    expect((await importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: '2026-09-15T12:00:00.000Z' })).outcome).toBe('IMPORTED');
    // The import's own recovery trace is listed; a recovery trace a worker wrote would not be.
    const recovery = juliusArchiveRecoveryEntityId(RUN, paidRunArchive().integrity.contentHash);
    const derived = await derive();
    expect(derived).toMatchObject({ status: 'NOT_PRESERVED', evidence: { liveRecords: 0, recoveries: [{ entityId: recovery, facts: { mode: 'RECONSTRUCTED', preservationBefore: 'NOT_PRESERVED' } }] } });
    expect(julius).toBeDefined();
  });
});
