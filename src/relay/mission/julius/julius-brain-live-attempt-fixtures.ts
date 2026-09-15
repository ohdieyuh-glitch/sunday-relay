import { paidRunArchive } from './julius-brain-archive-fixtures';
import { juliusBrainDraftFromLegacy } from './julius-brain-legacy';
import {
  juliusRunOpenedBody,
  juliusRunOpenedEntityId,
  juliusRunPreservedCheckpointLabel,
  juliusRunSealedBody,
  juliusRunSealedEntityId,
} from './julius-brain-preservation';
import type { JuliusBrainHandle } from './julius-brain-service';
import type { JuliusBrainAppend } from './julius-runtime-ports';

/**
 * What the prepared live binding writes for one workflow attempt — the open
 * marker, the mirrored v1 entries, the seal and the run checkpoint — built from
 * the same pure pieces the binding uses, for recovery proofs against the paid-run
 * archive fixture. Tests only; nothing composes it.
 */

export const LIVE_ATTEMPT_MISSION = 'mission:julius-live-4';
export const LIVE_ATTEMPT_JULIUS_RUN = 'run:julius-live-4';

/** The v1 entries the archive fixture lists, as the live runtime would have appended them. */
export const LIVE_ATTEMPT_V1_ENTRIES: Readonly<Record<string, Pick<JuliusBrainAppend, 'kind' | 'taskId' | 'safeText'>>> = {
  'seed:constraint': { kind: 'CONSTRAINT', taskId: null, safeText: 'Edit only the trust core file' },
  'brain:decision:plan-1:ACCEPT:TASK_VERIFIED': { kind: 'DECISION', taskId: 'plan-1', safeText: 'ACCEPT (TASK_VERIFIED): The plan is reviewed and accepted.' },
  'brain:guidance-request:build-1': { kind: 'HANDOFF', taskId: 'build-1', safeText: 'Which ledger settles a hosted dispatch?' },
  'brain:decision:build-1:REPAIR:BLOCKING_FINDINGS': { kind: 'DECISION', taskId: 'build-1', safeText: 'REPAIR (BLOCKING_FINDINGS): the budget stopped the build.' },
};
export const LIVE_ATTEMPT_ALL_ENTRIES = Object.keys(LIVE_ATTEMPT_V1_ENTRIES);

export interface LiveAttemptOptions {
  /** Entry ids to mirror; an id outside the fixture needs `append`. */
  readonly entries: readonly string[];
  readonly append?: Readonly<Record<string, Partial<Pick<JuliusBrainAppend, 'kind' | 'taskId' | 'safeText'>>>>;
  readonly seal?: number;
  readonly checkpoint?: boolean;
  readonly juliusRunId?: string;
  readonly missionId?: string;
  readonly acceptedMainSha?: string | null;
  readonly open?: boolean;
}

export async function writeLiveAttempt(julius: JuliusBrainHandle, brainRunId: string, options: LiveAttemptOptions): Promise<void> {
  const scope = { missionId: LIVE_ATTEMPT_MISSION, runId: brainRunId };
  const must = (outcome: string, what: string) => { if (outcome !== 'COMMITTED') throw new Error(`live_attempt_fixture_${what}_${outcome}`); };
  if (options.open !== false) {
    const opened = await julius.create('TRACE', juliusRunOpenedBody({
      brainRunId, juliusRunId: options.juliusRunId ?? LIVE_ATTEMPT_JULIUS_RUN, missionId: options.missionId ?? LIVE_ATTEMPT_MISSION,
      acceptedMainSha: options.acceptedMainSha === undefined ? paidRunArchive().identity.acceptedMainSha : options.acceptedMainSha,
    }), { key: juliusRunOpenedEntityId(brainRunId), entityId: juliusRunOpenedEntityId(brainRunId), scope });
    must(opened.outcome, 'open');
  }
  for (const entryId of options.entries) {
    const base = LIVE_ATTEMPT_V1_ENTRIES[entryId] ?? { kind: 'CONSTRAINT', taskId: null, safeText: `entry ${entryId}` };
    const append: JuliusBrainAppend = { runId: LIVE_ATTEMPT_JULIUS_RUN, projectId: 'prj-julius-live-4', workerId: 'julius', entryId, evidenceIds: [], occurredAt: '2026-09-13T05:05:00.000Z', ...base, ...options.append?.[entryId] };
    must((await julius.commit([juliusBrainDraftFromLegacy({ append, missionId: LIVE_ATTEMPT_MISSION, brainRunId })])).outcome, 'entry');
  }
  if (options.seal !== undefined) {
    const sealed = await julius.create('TRACE', juliusRunSealedBody({ brainRunId, expectedEntries: options.seal, writtenEntries: options.entries.length, missingEntryIds: [] }), { key: juliusRunSealedEntityId(brainRunId), entityId: juliusRunSealedEntityId(brainRunId), scope });
    must(sealed.outcome, 'seal');
  }
  if (options.checkpoint) await julius.checkpoint(juliusRunPreservedCheckpointLabel(brainRunId));
}
