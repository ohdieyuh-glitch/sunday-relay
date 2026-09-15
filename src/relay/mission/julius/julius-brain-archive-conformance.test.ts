import { describe, expect, it } from 'vitest';

import { PAID_RUN_ARTIFACT_BYTES, paidRunArchive, paidRunArchiveBody } from './julius-brain-archive-fixtures';
import {
  checkJuliusPaidRunArchiveConformance,
  JULIUS_ARCHIVE_CONFORMANCE_CASES,
  runJuliusArchiveConformanceCases,
} from './julius-brain-archive-conformance';
import { sealJuliusPaidRunArchiveExport } from './julius-brain-archive-import';
import { juliusPrincipal } from './julius-brain-contracts';
import { juliusBrainDraftFromLegacy } from './julius-brain-legacy';
import { juliusRunOpenedBody, juliusRunOpenedEntityId, juliusRunPreservedCheckpointLabel, juliusRunSealedBody, juliusRunSealedEntityId } from './julius-brain-preservation';
import { createJuliusProjectBrainService } from './julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, readAllJuliusBrainRecords } from './julius-brain-store';
import type { JuliusBrainAppend } from './julius-runtime-ports';

const BRAIN = 'brain:prj-julius-live-4';
const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const ATTEMPT_1 = 'workflow:34739303313/1';

describe('julius-paid-run-archive-export.v1 conformance kit', () => {
  it('a conforming export: no errors, its Unknown fields counted, its identity summarised', () => {
    const report = checkJuliusPaidRunArchiveConformance(paidRunArchive());
    expect(report.verdict).toBe('CONFORMANT');
    expect(report.findings.filter((finding) => finding.level !== 'NOTE')).toEqual([]);
    expect(report.summary).toMatchObject({
      workflowRunId: '34739303313', workflowRunAttempt: 1, brainRunId: ATTEMPT_1, missionId: MISSION, stateMode: 'FRESH', outcome: 'FAILED',
      contentHash: paidRunArchive().integrity.contentHash, items: { tasks: 4, evidence: 4, usage: 3, artifacts: 1 },
    });
    expect(report.summary!.unknownFields).toBeGreaterThan(0);
    expect(report.findings.every((finding) => finding.check === 'null-semantics.unknown-count')).toBe(true);
    expect(report.brain).toBeNull();
  });

  it('every catalogued corruption of a valid export is refused, and every unknown-but-valid value accepted', () => {
    const results = runJuliusArchiveConformanceCases(paidRunArchive());
    expect(results.filter((result) => result.result !== 'PASS')).toEqual([]);
    expect(results).toHaveLength(JULIUS_ARCHIVE_CONFORMANCE_CASES.length);
    // What the founder named, each covered by at least one case.
    const ids = results.map((result) => result.id);
    for (const prefix of ['version.newer', 'version.older', 'identity.workflow-run', 'identity.attempt', 'identity.accepted-main', 'identity.mission', 'identity.campaign', 'identity.state-mode', 'identity.outcome',
      'integrity.section', 'integrity.content', 'artifacts.digest', 'null.listed-with-value', 'null.unlisted-null-list', 'null.empty-string', 'identity.outcome.unknown-but-valid',
      'references.broken', 'references.duplicate', 'references.cross-run', 'vocabulary.evidence-type', 'security.credentials', 'cost.totals-conflict', 'consistency.outcome']) {
      expect(ids.some((id) => id.startsWith(prefix)), prefix).toBe(true);
    }
  });

  it('a case with nothing to corrupt is NOT_APPLICABLE, never a pass', () => {
    const empty = sealJuliusPaidRunArchiveExport({
      ...paidRunArchiveBody(),
      accounting: { knownUsdMicros: 0, estimatedUsdMicros: null, unknownComponents: 0, components: 0, unknown: [] },
      tasks: [], research: [], evidence: [], findings: [], reviews: [], repairs: [], usage: [], brainEntries: [], events: [], toolInvocations: [], artifacts: [],
    });
    const results = runJuliusArchiveConformanceCases(empty);
    expect(results.filter((result) => result.result === 'FAIL')).toEqual([]);
    const notApplicable = results.filter((result) => result.result === 'NOT_APPLICABLE').map((result) => result.id);
    expect(notApplicable).toEqual(expect.arrayContaining(['references.duplicate', 'security.credentials', 'artifacts.digest.invalid', 'vocabulary.evidence-type']));
    expect(results.find((result) => result.id === 'version.newer')!.result).toBe('PASS');
    // A baseline that does not conform is not a basis for any case.
    expect(() => runJuliusArchiveConformanceCases({ ...paidRunArchive(), exportedAt: 'yesterday' })).toThrow(/baseline_not_conformant/);
  });

  it('artifact digests: supplied bytes must hash to the declared digest and size; missing bytes are declared, not verified', () => {
    const exact = checkJuliusPaidRunArchiveConformance(paidRunArchive(), { artifactBytes: (id) => PAID_RUN_ARTIFACT_BYTES.get(id) ?? null });
    expect(exact.verdict).toBe('CONFORMANT');
    expect(exact.findings.some((finding) => finding.check === 'artifacts.digest')).toBe(false);

    const tampered = checkJuliusPaidRunArchiveConformance(paidRunArchive(), { artifactBytes: (id) => (id === 'art-plan' ? new TextEncoder().encode('not the plan') : PAID_RUN_ARTIFACT_BYTES.get(id) ?? null) });
    expect(tampered.verdict).toBe('NOT_CONFORMANT');
    expect(tampered.findings).toContainEqual(expect.objectContaining({ level: 'ERROR', check: 'artifacts.digest', location: 'artifacts[0]' }));

    const partial = checkJuliusPaidRunArchiveConformance(paidRunArchive(), { artifactBytes: () => null });
    expect(partial.verdict).toBe('CONFORMANT');
    expect(partial.findings).toContainEqual({ level: 'NOTE', check: 'artifacts.digest', location: 'artifacts', detail: '1 artifact(s) supplied without bytes; their digests are declared, not verified' });
  });

  it('versions and non-exports: only this contract is read; the archive label is never an export', () => {
    expect(checkJuliusPaidRunArchiveConformance(null).verdict).toBe('NOT_AN_EXPORT');
    expect(checkJuliusPaidRunArchiveConformance({ format: 'julius-paid-run-archive.v1' })).toMatchObject({ verdict: 'NOT_AN_EXPORT', summary: null });
    expect(checkJuliusPaidRunArchiveConformance({ ...paidRunArchive(), format: 'julius-paid-run-archive-export.v2' })).toMatchObject({ verdict: 'UNSUPPORTED_VERSION', findings: [{ check: 'version' }] });
    // The source's archive label is provenance: any label, the same verdict.
    const relabelled = sealJuliusPaidRunArchiveExport({ ...paidRunArchiveBody(), source: { ...paidRunArchiveBody().source, archiveSchemaVersion: 'julius-paid-run-archive.v1+34-columns' } });
    expect(checkJuliusPaidRunArchiveConformance(relabelled).verdict).toBe('CONFORMANT');
  });

  it('against a Brain: preservation metadata that contradicts the export is refused; otherwise it says what the import would do', async () => {
    const V1: Readonly<Record<string, Pick<JuliusBrainAppend, 'kind' | 'taskId' | 'safeText'>>> = {
      'seed:constraint': { kind: 'CONSTRAINT', taskId: null, safeText: 'Edit only the trust core file' },
      'brain:decision:plan-1:ACCEPT:TASK_VERIFIED': { kind: 'DECISION', taskId: 'plan-1', safeText: 'ACCEPT (TASK_VERIFIED): The plan is reviewed and accepted.' },
      'brain:guidance-request:build-1': { kind: 'HANDOFF', taskId: 'build-1', safeText: 'Which ledger settles a hosted dispatch?' },
      'brain:decision:build-1:REPAIR:BLOCKING_FINDINGS': { kind: 'DECISION', taskId: 'build-1', safeText: 'REPAIR (BLOCKING_FINDINGS): the budget stopped the build.' },
    };
    const withLive = async (live: { entries: readonly string[]; seal?: number; checkpoint?: boolean; juliusRunId?: string; acceptedMainSha?: string } | null) => {
      const store = createJuliusBrainMemoryStore();
      const service = createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T12:00:00.000Z' } });
      await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
      const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
      if (live !== null) {
        const scope = { missionId: MISSION, runId: ATTEMPT_1 };
        await julius.create('TRACE', juliusRunOpenedBody({ brainRunId: ATTEMPT_1, juliusRunId: live.juliusRunId ?? 'run:julius-live-4', missionId: MISSION, acceptedMainSha: live.acceptedMainSha ?? paidRunArchive().identity.acceptedMainSha }), { key: juliusRunOpenedEntityId(ATTEMPT_1), entityId: juliusRunOpenedEntityId(ATTEMPT_1), scope });
        for (const entryId of live.entries) {
          const append: JuliusBrainAppend = { runId: 'run:julius-live-4', projectId: PROJECT, workerId: 'julius', entryId, evidenceIds: [], occurredAt: '2026-09-13T05:05:00.000Z', ...V1[entryId]! };
          await julius.commit([juliusBrainDraftFromLegacy({ append, missionId: MISSION, brainRunId: ATTEMPT_1 })]);
        }
        if (live.seal !== undefined) await julius.create('TRACE', juliusRunSealedBody({ brainRunId: ATTEMPT_1, expectedEntries: live.seal, writtenEntries: live.entries.length, missingEntryIds: [] }), { key: juliusRunSealedEntityId(ATTEMPT_1), entityId: juliusRunSealedEntityId(ATTEMPT_1), scope });
        if (live.checkpoint) await julius.checkpoint(juliusRunPreservedCheckpointLabel(ATTEMPT_1));
      }
      const brain = { brainId: BRAIN, records: await readAllJuliusBrainRecords(store, BRAIN, PROJECT), entities: await readAllJuliusBrainEntities(store, BRAIN, PROJECT) };
      return checkJuliusPaidRunArchiveConformance(paidRunArchive(), { brain });
    };

    expect((await withLive(null)).brain).toEqual({ preservation: 'NOT_PRESERVED', conflicts: [], wouldImport: 'RECONSTRUCT' });
    expect((await withLive({ entries: ['seed:constraint'] })).brain).toEqual({ preservation: 'PARTIALLY_PRESERVED', conflicts: [], wouldImport: 'RECONCILE' });
    const preserved = await withLive({ entries: Object.keys(V1), seal: 4, checkpoint: true });
    expect(preserved).toMatchObject({ verdict: 'CONFORMANT', brain: { preservation: 'PRESERVED', wouldImport: 'REFUSE_ALREADY_PRESERVED' } });

    // Contradictory preservation metadata: the live markers say something the export does not.
    const sealCount = await withLive({ entries: ['seed:constraint'], seal: 7 });
    expect(sealCount).toMatchObject({ verdict: 'NOT_CONFORMANT', brain: { wouldImport: 'REFUSE_CONFLICTING_HISTORY', conflicts: ['the live run sealed 7 v1 entries; the export lists 4'] } });
    expect(sealCount.findings).toContainEqual({ level: 'ERROR', check: 'consistency.live-history', location: 'identity', detail: 'the live run sealed 7 v1 entries; the export lists 4' });
    const otherMain = await withLive({ entries: [], acceptedMainSha: 'f'.repeat(40) });
    expect(otherMain.brain).toMatchObject({ wouldImport: 'REFUSE_CONFLICTING_HISTORY', conflicts: [expect.stringContaining(`executed ${'f'.repeat(40)}`)] });
    const otherRun = await withLive({ entries: [], juliusRunId: 'run:julius-live-5' });
    expect(otherRun.brain).toMatchObject({ wouldImport: 'REFUSE_CONFLICTING_HISTORY', conflicts: ['the live run was Julius run run:julius-live-5; the export says run:julius-live-4'] });
  });
});
