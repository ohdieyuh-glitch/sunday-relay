import { describe, expect, it } from 'vitest';

import { juliusPrincipal, juliusWorkerPrincipal, type JuliusBrainPrincipal } from './julius-brain-contracts';
import {
  checkJuliusBrainExportForRestore,
  createJuliusBrainEvaluationContext,
  exportJuliusBrain,
  juliusBrainMissionReadGrant,
  renderJuliusBrainExportMarkdown,
  restoreJuliusBrainFromExport,
  resumeJuliusBrain,
  verifyJuliusBrainEvaluationContext,
} from './julius-brain-export';
import { createJuliusProjectBrainService, juliusLink } from './julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, type JuliusBrainCommitResult } from './julius-brain-store';

const PROJECT = 'prj-x';
const BRAIN = 'brain:x';
const MISSION = 'mission:x';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const CODER = juliusWorkerPrincipal('coder', 'CODING_AGENT');
const REVIEWER = juliusWorkerPrincipal('reviewer', 'INDEPENDENT_REVIEWER');
const HASH = `sha256:${'a'.repeat(64)}`;

const ok = (result: JuliusBrainCommitResult): string => {
  if (result.outcome !== 'COMMITTED') throw new Error(`${result.reasonCode}: ${result.detail}`);
  return result.receipts[0]!.entityId;
};

async function scenario(options: { objective?: boolean } = {}) {
  let tick = 0;
  const store = createJuliusBrainMemoryStore();
  const service = createJuliusProjectBrainService({ store, clock: { now: () => new Date(Date.parse('2026-09-13T10:00:00Z') + (tick++) * 1000).toISOString() } });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Export fixture', principal: JULIUS });
  const open = async (principal: JuliusBrainPrincipal) => (await service.open({ brainId: BRAIN, projectId: PROJECT, principal }))!;
  const julius = await open(JULIUS);
  const coder = await open(CODER);
  const reviewer = await open(REVIEWER);
  const scope = { missionId: MISSION };
  if (options.objective !== false) ok(await julius.create('OBJECTIVE', { statement: 'Export everything', successMeasure: null }, { key: 'o', scope }));
  const d1 = ok(await julius.create('DECISION', { decisionClass: 'MISSION', statement: 'plain files', rationale: 'simple', alternatives: [], status: 'ACTIVE' }, { key: 'd1', scope }));
  ok(await julius.supersede(d1, 1, { decisionClass: 'MISSION', statement: 'a ledger', rationale: 'history', alternatives: [], status: 'ACTIVE' }, { key: 'd2' }));
  const artifact = ok(await coder.create('ARTIFACT', { artifactClass: 'REPORT', name: 'r.json', contentType: 'application/json', byteSize: 2, contentHash: HASH, storageRef: `cas://sha256/${'a'.repeat(64)}`, commit: null }, { key: 'a', scope }));
  const evidence = ok(await coder.create('EVIDENCE', { evidenceClass: 'MEASUREMENT', claim: 'rows=10', summary: 'counted', status: 'PASSED', verification: 'UNVERIFIED', data: { value: 10 }, juliusEvidenceId: null }, { key: 'e', scope, links: [juliusLink('DERIVED_FROM', artifact)] }));
  ok(await reviewer.create('EVAL', {
    evaluationName: 'row-count', target: { targetKind: 'ENTITY', reference: evidence }, inputs: [], outcome: 'PASS', score: null, maxScore: null,
    metrics: [{ name: 'rows', value: 10, unit: null }], evaluator: 'reviewer',
    reproducibility: { seed: null, codeHash: null, inputsHash: null, environmentHash: null, commit: null, command: null, environmentRunId: null },
  }, { key: 'eval', scope, links: [juliusLink('EVIDENCED_BY', evidence)] }));
  ok(await julius.checkpoint('fixture'));
  return { store, service, julius };
}

describe('Project Brain export', () => {
  it('is complete, preserves ids and provenance, and distinguishes missing from unknown from empty', async () => {
    const { store } = await scenario();
    const bundle = (await exportJuliusBrain({ store, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: '2026-09-13T12:00:00Z' }))!;
    expect(bundle.ledger.verified).toBe(true);
    expect(bundle.redaction).toEqual({ applied: 0, restorable: true });
    expect(bundle.sections.objective?.body.statement).toBe('Export everything');
    expect(bundle.sections.decisions.active.map((d) => d.body.statement)).toEqual(['a ledger']);
    expect(bundle.sections.decisions.superseded[0]!.supersededBy).toBe(bundle.sections.decisions.active[0]!.entityId);
    expect(bundle.sections.artifacts[0]!.resolution).toBe('NOT_CHECKED');
    expect(bundle.sections.repairs).toEqual([]);
    expect(bundle.sections.state).toBeNull();
    expect(bundle.records.map((record) => record.recordId)).toEqual(bundle.timeline.map((row) => row.recordId));
    expect(bundle.timeline.find((row) => row.kind === 'EVAL')!.principal).toBe('WORKER:reviewer(INDEPENDENT_REVIEWER)');
    const markdown = renderJuliusBrainExportMarkdown(bundle);
    expect(markdown).toContain('score: Unknown');
    expect(markdown).toContain('## Repairs\n\nNone recorded.');
    expect(markdown).toContain('Missing — no mission state is recorded.');
    expect(markdown).toContain('resolution: NOT_CHECKED');
  });

  it('says Missing when there is no objective, and checks artifacts when it can', async () => {
    const { store } = await scenario({ objective: false });
    const bundle = (await exportJuliusBrain({ store, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: '2026-09-13T12:00:00Z', resolveArtifact: async () => 'MISSING' }))!;
    expect(bundle.sections.objective).toBeNull();
    expect(renderJuliusBrainExportMarkdown(bundle)).toContain('Missing — no active objective is recorded.');
    expect(bundle.sections.artifacts[0]!.resolution).toBe('MISSING');
  });

  it('only mission authority exports', async () => {
    const { store } = await scenario();
    await expect(exportJuliusBrain({ store, brainId: BRAIN, projectId: PROJECT, exportedBy: CODER, exportedAt: 'x' })).rejects.toThrow('julius_brain_export_requires_authority');
  });

  it('restores an unredacted bundle into an empty store, identically, and resume verifies it', async () => {
    const { store } = await scenario();
    const bundle = (await exportJuliusBrain({ store, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: '2026-09-13T12:00:00Z' }))!;
    const roundTripped = JSON.parse(JSON.stringify(bundle));
    const fresh = createJuliusBrainMemoryStore();
    expect(await restoreJuliusBrainFromExport(fresh, roundTripped)).toMatchObject({ outcome: 'RESTORED' });
    expect(await readAllJuliusBrainEntities(fresh, BRAIN, PROJECT)).toEqual(await readAllJuliusBrainEntities(store, BRAIN, PROJECT));
    const report = await resumeJuliusBrain(fresh, BRAIN, PROJECT);
    expect(report).toMatchObject({ status: 'VERIFIED', lastCheckpoint: { label: 'fixture', matches: true } });
    expect(await restoreJuliusBrainFromExport(fresh, roundTripped)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'brain_exists' });
  });

  it('refuses a tampered bundle, and a bundle whose ledger was edited and re-hashed', async () => {
    const { store } = await scenario();
    const bundle = (await exportJuliusBrain({ store, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: '2026-09-13T12:00:00Z' }))!;
    const edited = JSON.parse(JSON.stringify(bundle));
    edited.records[0].body.statement = 'Export nothing';
    expect(checkJuliusBrainExportForRestore(edited)).toMatchObject({ ok: false, reasonCode: 'bundle_hash_mismatch' });
    const { bundleHash: _drop, ...rest } = edited;
    const { juliusBrainSha256, canonicalJuliusBrainJson } = await import('./julius-brain-contracts');
    const rehashed = { ...rest, bundleHash: juliusBrainSha256(canonicalJuliusBrainJson(rest)) };
    expect(checkJuliusBrainExportForRestore(rehashed)).toMatchObject({ ok: false, reasonCode: 'ledger_invalid' });
  });

  it('redacts a secret that entered before it was known to be one, counts it, and refuses to restore that bundle', async () => {
    const { store } = await scenario();
    const bundle = (await exportJuliusBrain({ store, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: '2026-09-13T12:00:00Z', secretLiterals: ['Export everything'] }))!;
    expect(bundle.redaction.applied).toBeGreaterThan(0);
    expect(bundle.redaction.restorable).toBe(false);
    expect(JSON.stringify(bundle)).not.toContain('Export everything');
    expect(await restoreJuliusBrainFromExport(createJuliusBrainMemoryStore(), bundle)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'bundle_redacted' });
  });

  it('cuts a scoped, hashed evaluation context a separate environment can verify', async () => {
    const { store } = await scenario();
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    const head = (await store.head(BRAIN, PROJECT))!;
    const grant = juliusBrainMissionReadGrant({ grantId: 'g-eval', brainId: BRAIN, missionIds: [MISSION], kinds: ['EVIDENCE', 'EVAL', 'OBJECTIVE'] });
    const context = createJuliusBrainEvaluationContext({ brainId: BRAIN, entities, head, grant, consumerRunId: 'gve-run-1', createdAt: '2026-09-13T12:00:00Z' });
    expect(context.entities.map((state) => state.kind).sort()).toEqual(['EVAL', 'EVIDENCE', 'OBJECTIVE']);
    expect(context.throughSequence).toBe(head.sequence);
    expect(verifyJuliusBrainEvaluationContext(JSON.parse(JSON.stringify(context)))).toBe(true);
    expect(verifyJuliusBrainEvaluationContext({ ...context, entities: context.entities.slice(1) })).toBe(false);
  });
});
