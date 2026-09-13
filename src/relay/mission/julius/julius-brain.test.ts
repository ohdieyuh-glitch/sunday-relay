import { describe, expect, it } from 'vitest';

import {
  JULIUS_BRAIN_BODY_SCHEMAS,
  juliusPrincipal,
  juliusWorkerPrincipal,
  validateJuliusBrainObject,
  type JuliusBrainBody,
  type JuliusBrainPrincipal,
  type JuliusBrainRecord,
} from './julius-brain-contracts';
import type { JuliusBrainWriteGrant } from './julius-brain-policy';
import { juliusBrainEditableSurface } from './julius-brain-policy';
import { juliusBrainStateHash, projectJuliusBrain, verifyJuliusBrainLedger } from './julius-brain-projection';
import { createJuliusProjectBrainService, juliusLink } from './julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainRecords, type JuliusBrainCommitResult } from './julius-brain-store';
import { containsJuliusSecret, redactJuliusSecrets } from './julius-brain-secrets';

const PROJECT = 'prj-brain';
const BRAIN = 'brain:prj-brain';
const MISSION = 'mission:brain-1';

const JULIUS = juliusPrincipal('JULIUS', 'julius');
const USER = juliusPrincipal('USER', 'founder');
const ARCHITECT = juliusWorkerPrincipal('worker-architect', 'PROMPT_ARCHITECT');
const CODER = juliusWorkerPrincipal('worker-coder', 'CODING_AGENT');
const REVIEWER = juliusWorkerPrincipal('worker-reviewer', 'INDEPENDENT_REVIEWER');
const PYTHON = juliusPrincipal('TOOL', 'python.run:exec-1', { onBehalfOf: 'worker-coder', grantId: 'grant-1' });

function clock(start = Date.parse('2026-09-13T10:00:00.000Z')) {
  let tick = 0;
  return { now: () => new Date(start + (tick++) * 1_000).toISOString() };
}

async function setup() {
  const store = createJuliusBrainMemoryStore();
  const service = createJuliusProjectBrainService({ store, clock: clock() });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Brain', principal: JULIUS });
  const open = async (principal: JuliusBrainPrincipal, extra: { writeGrant?: JuliusBrainWriteGrant } = {}) =>
    (await service.open({ brainId: BRAIN, projectId: PROJECT, principal, ...extra }))!;
  return { store, service, open };
}

const committed = (result: JuliusBrainCommitResult) => {
  if (result.outcome !== 'COMMITTED') throw new Error(`expected COMMITTED, got ${result.reasonCode}: ${result.detail}`);
  return result;
};
const refused = (result: JuliusBrainCommitResult) => {
  if (result.outcome !== 'REFUSED') throw new Error('expected REFUSED');
  return result;
};

const decision = (statement: string, decisionClass = 'MISSION'): JuliusBrainBody => ({
  decisionClass, statement, rationale: `because ${statement}`, alternatives: [{ option: 'the other way', reasonRejected: 'slower' }], status: 'ACTIVE',
});
const evidence = (claim: string, extra: Partial<Record<string, unknown>> = {}): JuliusBrainBody => ({
  evidenceClass: 'MEASUREMENT', claim, summary: `measured ${claim}`, status: 'PASSED', verification: 'UNVERIFIED',
  data: { name: 'latency_ms', value: 12.5, unit: 'ms' }, juliusEvidenceId: null, ...extra,
} as JuliusBrainBody);

const scope = { missionId: MISSION };

describe('Project Brain — initialization and identity', () => {
  it('only mission authority initializes a Brain, and initialization is idempotent', async () => {
    const store = createJuliusBrainMemoryStore();
    const service = createJuliusProjectBrainService({ store, clock: clock() });
    await expect(service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'x', principal: CODER })).rejects.toThrow('julius_brain_initialize_requires_authority');
    expect((await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'x', principal: JULIUS })).created).toBe(true);
    expect((await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'x', principal: JULIUS })).created).toBe(false);
    await expect(service.initialize({ brainId: BRAIN, projectId: 'prj-other', title: 'x', principal: JULIUS })).rejects.toThrow('julius_brain_id_taken');
  });

  it('a Brain of one project cannot be opened from another', async () => {
    const { service } = await setup();
    expect(await service.open({ brainId: BRAIN, projectId: 'prj-other', principal: JULIUS })).toBeNull();
  });
});

describe('Project Brain — the three tiers write through governance', () => {
  it('the Prompt Architect proposes requirements; only Julius or a user adopts them', async () => {
    const { open } = await setup();
    const architect = await open(ARCHITECT);
    const julius = await open(JULIUS);
    const body = { requirementClass: 'FUNCTIONAL', statement: 'Exports redact secrets', priority: 'MUST', status: 'ACTIVE' };
    expect(refused(await architect.create('REQUIREMENT', body, { key: 'req-1', scope })).reasonCode).toBe('proposal_only');
    const proposed = committed(await architect.create('REQUIREMENT', { ...body, status: 'PROPOSED' }, { key: 'req-1', scope }));
    const entityId = proposed.receipts[0]!.entityId;
    expect(refused(await architect.revise(entityId, { ...body, status: 'ACTIVE' }, { key: 'req-1-adopt', expectedVersion: 1 })).reasonCode).toBe('proposal_only');
    committed(await julius.revise(entityId, { ...body, status: 'ACTIVE' }, { key: 'req-1-adopt', expectedVersion: 1 }));
    const [state] = await julius.current('REQUIREMENT', MISSION);
    expect(state!.body.status).toBe('ACTIVE');
    expect(state!.version).toBe(2);
    expect(state!.createdBy).toEqual(ARCHITECT);
    expect(state!.updatedBy).toEqual(JULIUS);
  });

  it('each worker records decisions only of its own class; the reviewer records none', async () => {
    const { open } = await setup();
    expect(refused(await (await open(ARCHITECT)).create('DECISION', decision('use postgres'), { key: 'd1', scope })).reasonCode).toBe('decision_class_not_permitted');
    committed(await (await open(ARCHITECT)).create('DECISION', decision('use postgres', 'ARCHITECTURE'), { key: 'd1', scope }));
    committed(await (await open(CODER)).create('DECISION', decision('batch inserts', 'IMPLEMENTATION'), { key: 'd2', scope }));
    expect(refused(await (await open(REVIEWER)).create('DECISION', decision('reject', 'VERIFICATION'), { key: 'd3', scope })).reasonCode).toBe('kind_not_writable_by_principal');
  });

  it('the reviewer records findings and verifies evidence, but cannot touch mission truth', async () => {
    const { open } = await setup();
    const julius = await open(JULIUS);
    const coder = await open(CODER);
    const reviewer = await open(REVIEWER);
    const objective = committed(await julius.create('OBJECTIVE', { statement: 'Ship the Brain', successMeasure: null }, { key: 'objective', scope }));
    const ev = committed(await coder.create('EVIDENCE', evidence('p95 under 20ms'), { key: 'ev-1', scope }));
    const evidenceId = ev.receipts[0]!.entityId;

    // Self-verification is refused at creation and at revision.
    expect(refused(await coder.create('EVIDENCE', evidence('x', { verification: 'VERIFIED' }), { key: 'ev-self', scope })).reasonCode).toBe('self_verification_refused');
    expect(refused(await coder.revise(evidenceId, evidence('p95 under 20ms', { verification: 'VERIFIED' }), { key: 'ev-1-v', expectedVersion: 1 })).reasonCode).toBe('revision_not_permitted');

    // The reviewer may change verification — and nothing else.
    expect(refused(await reviewer.revise(evidenceId, evidence('p95 under 5ms', { verification: 'VERIFIED' }), { key: 'ev-1-v', expectedVersion: 1 })).reasonCode).toBe('revision_not_permitted');
    committed(await reviewer.revise(evidenceId, evidence('p95 under 20ms', { verification: 'VERIFIED' }), { key: 'ev-1-v', expectedVersion: 1 }));

    committed(await reviewer.create('FINDING', { findingClass: 'DEFECT', severity: 'HIGH', statement: 'no index', blocking: true, status: 'OPEN', juliusFindingId: null }, { key: 'f1', scope, links: [juliusLink('EVIDENCED_BY', evidenceId)] }));
    expect(refused(await reviewer.revise(objective.receipts[0]!.entityId, { statement: 'Ship nothing', successMeasure: null }, { key: 'obj-2', expectedVersion: 1 })).reasonCode).toBe('revision_not_permitted');
    expect(refused(await reviewer.retire(objective.receipts[0]!.entityId, { reason: 'no', disposition: 'WITHDRAWN', expectedVersion: 1, key: 'obj-retire' })).reasonCode).toBe('retirement_not_permitted');
  });

  it('repairs connect to findings, and each tier may move only its own part of a repair', async () => {
    const { open } = await setup();
    const julius = await open(JULIUS);
    const coder = await open(CODER);
    const reviewer = await open(REVIEWER);
    const finding = committed(await reviewer.create('FINDING', { findingClass: 'DEFECT', severity: 'HIGH', statement: 'missing index', blocking: true, status: 'OPEN', juliusFindingId: null }, { key: 'f1', scope }));
    const findingId = finding.receipts[0]!.entityId;
    const repairBody = { reason: 'add the index', status: 'REQUESTED', implementation: null, verification: 'NOT_RUN', reviewerDisposition: null, resultingState: null, juliusRepairId: null };
    expect(refused(await coder.create('REPAIR', repairBody, { key: 'r1', scope })).reasonCode).toBe('kind_not_writable_by_principal');
    const repair = committed(await julius.create('REPAIR', repairBody, { key: 'r1', scope, links: [juliusLink('REPAIRS', findingId)] }));
    const repairId = repair.receipts[0]!.entityId;
    committed(await coder.revise(repairId, { ...repairBody, status: 'IMPLEMENTED', implementation: 'CREATE INDEX' }, { key: 'r1-impl', expectedVersion: 1 }));
    expect(refused(await coder.revise(repairId, { ...repairBody, status: 'IMPLEMENTED', implementation: 'CREATE INDEX', reviewerDisposition: 'ACCEPTED' }, { key: 'r1-self-accept', expectedVersion: 2 })).reasonCode).toBe('revision_not_permitted');
    committed(await reviewer.revise(repairId, { ...repairBody, status: 'IMPLEMENTED', implementation: 'CREATE INDEX', reviewerDisposition: 'ACCEPTED', verification: 'PASSED' }, { key: 'r1-review', expectedVersion: 2 }));
    committed(await julius.revise(findingId, { findingClass: 'DEFECT', severity: 'HIGH', statement: 'missing index', blocking: true, status: 'RESOLVED', juliusFindingId: null }, { key: 'f1-resolve', expectedVersion: 1, links: [juliusLink('RESOLVES', repairId)] }));
    const provenance = (await julius.provenance(findingId))!;
    expect(provenance.inbound).toEqual([{ relation: 'REPAIRS', source: repairId, sourceLifecycle: 'ACTIVE' }]);
    expect(provenance.versions.map((version) => version.principal.id)).toEqual(['worker-reviewer', 'julius']);
  });
});

describe('Project Brain — changing truth never erases it', () => {
  it('a superseded decision stays in history, explains its successor, and cannot be revised', async () => {
    const { open } = await setup();
    const julius = await open(JULIUS);
    const first = committed(await julius.create('DECISION', decision('store JSON files'), { key: 'd-storage', scope }));
    const oldId = first.receipts[0]!.entityId;
    const second = committed(await julius.supersede(oldId, 1, decision('store in PostgreSQL'), { key: 'd-storage-2' }));
    const newId = second.receipts[0]!.entityId;

    const old = (await julius.entity(oldId))!;
    expect(old.lifecycle).toBe('SUPERSEDED');
    expect(old.supersededBy).toBe(newId);
    expect(old.body.statement).toBe('store JSON files');
    expect((await julius.current('DECISION')).map((state) => state.entityId)).toEqual([newId]);
    expect(refused(await julius.revise(oldId, decision('store JSON files again'), { key: 'revive', expectedVersion: 1 })).reasonCode).toBe('entity_not_active');
    expect(refused(await julius.supersede(oldId, 1, decision('a third way'), { key: 'd-storage-3' })).reasonCode).toBe('supersession_target_not_active');
    expect((await julius.provenance(newId))!.supersedes).toEqual([oldId]);
    expect((await julius.history({ kinds: ['DECISION'] })).records).toHaveLength(2);
  });

  it('contradiction keeps both claims and records the conflict on the contradicted one', async () => {
    const { open } = await setup();
    const coder = await open(CODER);
    const reviewer = await open(REVIEWER);
    const a = committed(await coder.create('EVIDENCE', evidence('the suite passes'), { key: 'ev-a', scope }));
    const b = committed(await reviewer.create('EVIDENCE', evidence('the suite fails on Windows', { evidenceClass: 'TEST_RESULT', status: 'FAILED', data: null }), {
      key: 'ev-b', scope, links: [juliusLink('CONTRADICTS', a.receipts[0]!.entityId)],
    }));
    const target = (await coder.entity(a.receipts[0]!.entityId))!;
    expect(target.lifecycle).toBe('ACTIVE');
    expect(target.inbound).toEqual([{ relation: 'CONTRADICTS', source: b.receipts[0]!.entityId, sourceKind: 'EVIDENCE' }]);
  });

  it('retirement preserves the last content and says why', async () => {
    const { open } = await setup();
    const julius = await open(JULIUS);
    const user = await open(USER);
    const finding = committed(await (await open(REVIEWER)).create('FINDING', { findingClass: 'RISK', severity: 'LOW', statement: 'flaky', blocking: false, status: 'OPEN', juliusFindingId: null }, { key: 'f', scope }));
    const id = finding.receipts[0]!.entityId;
    expect(refused(await user.retire(id, { reason: 'annoying', disposition: 'WITHDRAWN', expectedVersion: 1, key: 'f-retire' })).reasonCode).toBe('retirement_not_permitted');
    committed(await julius.retire(id, { reason: 'the test was deleted', disposition: 'STALE', expectedVersion: 1, key: 'f-retire' }));
    const state = (await julius.entity(id))!;
    expect(state.lifecycle).toBe('RETIRED');
    expect(state.retirement).toMatchObject({ reason: 'the test was deleted', disposition: 'STALE' });
    expect(state.body.statement).toBe('flaky');
  });

  it('a revision may not move an entity to another mission', async () => {
    const { open } = await setup();
    const julius = await open(JULIUS);
    const created = committed(await julius.create('CONSTRAINT', { statement: 'no network', status: 'ACTIVE' }, { key: 'c', scope }));
    const result = await julius.commit([{ ...julius.draft('CONSTRAINT', { statement: 'no network', status: 'ACTIVE' }, { key: 'c-move', scope: { missionId: 'mission:other' } }), op: 'REVISE', entityId: created.receipts[0]!.entityId, expectedVersion: 1 }]);
    expect(refused(result).reasonCode).toBe('scope_is_immutable');
  });
});

describe('Project Brain — concurrency, idempotency and atomicity', () => {
  it('a stale writer is refused instead of silently overwriting a concurrent revision', async () => {
    const { open } = await setup();
    const julius = await open(JULIUS);
    const user = await open(USER);
    const created = committed(await julius.create('OBJECTIVE', { statement: 'v1', successMeasure: null }, { key: 'o', scope }));
    const id = created.receipts[0]!.entityId;
    const [a, b] = await Promise.all([
      julius.revise(id, { statement: 'julius v2', successMeasure: null }, { key: 'o-julius', expectedVersion: 1 }),
      user.revise(id, { statement: 'user v2', successMeasure: null }, { key: 'o-user', expectedVersion: 1 }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['COMMITTED', 'REFUSED']);
    const loser = a.outcome === 'REFUSED' ? a : b;
    expect(refused(loser).reasonCode).toBe('version_conflict');
    expect((await julius.history({ entityId: id })).records).toHaveLength(2);
  });

  it('a replay is a duplicate with the original receipt, even if the clock moved; different content under the key is a conflict', async () => {
    const { open, store } = await setup();
    const coder = await open(CODER);
    const first = committed(await coder.create('EVIDENCE', evidence('ok'), { key: 'ev-replay', scope, occurredAt: '2026-09-13T11:00:00.000Z' }));
    const replay = committed(await coder.create('EVIDENCE', evidence('ok'), { key: 'ev-replay', scope, occurredAt: '2026-09-13T11:05:00.000Z' }));
    expect(replay.receipts[0]).toEqual({ ...first.receipts[0], outcome: 'DUPLICATE' });
    expect((await store.head(BRAIN, PROJECT))!.sequence).toBe(1);
    expect(refused(await coder.create('EVIDENCE', evidence('not ok'), { key: 'ev-replay', scope })).reasonCode).toBe('idempotency_key_conflict');
    // The same content from a different principal is a different write.
    expect(refused(await (await open(REVIEWER)).create('EVIDENCE', evidence('ok'), { key: 'ev-replay', scope })).reasonCode).toBe('idempotency_key_conflict');
  });

  it('a batch is all or nothing', async () => {
    const { open, store } = await setup();
    const julius = await open(JULIUS);
    const drafts = [
      julius.draft('OBJECTIVE', { statement: 'one', successMeasure: null }, { key: 'b1', scope }),
      julius.draft('CONSTRAINT', { statement: 'two', status: 'ACTIVE' }, { key: 'b2', scope }),
      julius.draft('CONSTRAINT', { statement: 'three', status: 'NOT_A_STATUS' }, { key: 'b3', scope }),
    ];
    const result = refused(await julius.commit(drafts));
    expect(result.index).toBe(2);
    expect(result.reasonCode).toBe('invalid_draft');
    expect((await store.head(BRAIN, PROJECT))!.sequence).toBe(0);
    expect(await julius.entities()).toEqual([]);
  });

  it('a batch may link to entities it creates', async () => {
    const { open } = await setup();
    const julius = await open(JULIUS);
    const ev = julius.draft('EVIDENCE', evidence('fast'), { key: 'ev-in-batch', scope, entityId: 'evidence:latency' });
    const ev2 = julius.draft('EVAL', {
      evaluationName: 'latency', target: { targetKind: 'ENTITY', reference: 'evidence:latency' }, inputs: [], outcome: 'PASS', score: null, maxScore: null,
      metrics: [{ name: 'p95', value: 12.5, unit: 'ms' }], evaluator: 'julius',
      reproducibility: { seed: null, codeHash: null, inputsHash: null, environmentHash: null, commit: null, command: null, environmentRunId: null },
    }, { key: 'eval-in-batch', scope, links: [juliusLink('EVIDENCED_BY', 'evidence:latency')] });
    const result = committed(await julius.commit([ev, ev2]));
    expect(result.receipts.map((receipt) => receipt.sequence)).toEqual([1, 2]);
    expect((await julius.entity('evidence:latency'))!.inbound).toHaveLength(1);
  });

  it('seeded random operations keep every invariant', async () => {
    const { open, store } = await setup();
    const principals = [JULIUS, USER, ARCHITECT, CODER, REVIEWER];
    const handles = await Promise.all(principals.map((principal) => open(principal)));
    let seed = 20260913;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
    let committedCount = 0;
    for (let step = 0; step < 300; step += 1) {
      const handle = pick(handles);
      const existing = await handle.entities();
      const roll = random();
      let result: JuliusBrainCommitResult;
      if (roll < 0.45 || existing.length === 0) {
        result = await handle.create(pick(['DECISION', 'EVIDENCE', 'CONSTRAINT', 'OPEN_QUESTION'] as const) === 'EVIDENCE'
          ? 'EVIDENCE' : 'CONSTRAINT', random() < 0.5 ? evidence(`c${step}`) : { statement: `s${step}`, status: random() < 0.5 ? 'ACTIVE' : 'PROPOSED' },
        { key: `k${step}`, scope, links: existing.length > 0 && random() < 0.3 ? [juliusLink(pick(['SUPPORTS', 'CONTRADICTS', 'RELATES_TO'] as const), pick(existing).entityId)] : [] });
      } else if (roll < 0.75) {
        const target = pick(existing);
        result = await handle.revise(target.entityId, target.body, { key: `k${step}`, expectedVersion: random() < 0.8 ? target.version : target.version + 1 });
      } else if (roll < 0.9) {
        const target = pick(existing);
        result = await handle.supersede(target.entityId, target.version, target.body, { key: `k${step}` });
      } else {
        const target = pick(existing);
        result = await handle.retire(target.entityId, { reason: 'random', disposition: 'WITHDRAWN', expectedVersion: target.version, key: `k${step}` });
      }
      if (result.outcome === 'COMMITTED') committedCount += 1;
      expect(store.verify(BRAIN)).toEqual({ ok: true, problems: [] });
    }
    const records = await readAllJuliusBrainRecords(store, BRAIN, PROJECT);
    expect(records.length).toBeGreaterThan(20);
    expect(committedCount).toBeGreaterThan(20);
    expect(records.map((record) => record.sequence)).toEqual(records.map((_, index) => index + 1));
    const versions = new Map<string, number>();
    for (const record of records) {
      expect(record.entityVersion).toBe((versions.get(record.entityId) ?? 0) + 1);
      versions.set(record.entityId, record.entityVersion);
    }
  });
});

describe('Project Brain — secrets never enter', () => {
  it('credential-shaped content is refused, the refusal does not repeat the secret, and task ids are not keys', async () => {
    const { open } = await setup();
    const coder = await open(CODER);
    const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz012345';
    const result = refused(await coder.create('EVIDENCE', evidence(`the key is ${key}`), { key: 'ev-secret', scope }));
    expect(result.reasonCode).toBe('credential_shaped_content');
    expect(result.detail).not.toContain(key);
    committed(await coder.create('EVIDENCE', evidence('task-abcdefghijklmnopqrstuvwxyz0123 passed'), { key: 'ev-task', scope }));
    expect(refused(await coder.create('EVIDENCE', evidence('connect postgres://relay:hunter2hunter2@db/x'), { key: 'ev-url', scope })).reasonCode).toBe('credential_shaped_content');
  });

  it('a granted literal secret is refused even when it has no known shape', async () => {
    const { service } = await setup();
    const coder = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: CODER, secretLiterals: ['plainword-7781'] }))!;
    expect(refused(await coder.create('EVIDENCE', evidence('saw plainword-7781 in output'), { key: 'ev-literal', scope })).reasonCode).toBe('credential_shaped_content');
  });

  it('redaction counts what it replaced', () => {
    expect(redactJuliusSecrets('Bearer abcdefghijklmnopqrstuvwxyz and token=abcdefghij', [])).toEqual({ text: '[REDACTED] and [REDACTED]', redactions: 2 });
    expect(containsJuliusSecret('output tokens: 16')).toBe(false);
  });
});

describe('Project Brain — tools write only observations, only under a grant', () => {
  const grant = (overrides: Partial<JuliusBrainWriteGrant> = {}): JuliusBrainWriteGrant => ({
    grantId: 'grant-1', brainId: BRAIN, principalId: PYTHON.id, issuedBy: 'julius', kinds: ['EVIDENCE', 'FINDING', 'EVAL', 'ARTIFACT', 'TRACE'],
    missionId: MISSION, taskId: 'task-analysis', maxRecords: 3, expiresAt: '2026-09-13T12:00:00.000Z', ...overrides,
  });
  const toolScope = { missionId: MISSION, taskId: 'task-analysis' };

  it('without its grant a tool writes nothing', async () => {
    const { open } = await setup();
    expect(refused(await (await open(PYTHON)).create('EVIDENCE', evidence('x'), { key: 't1', scope: toolScope })).reasonCode).toBe('grant_required');
  });

  it('with a grant: unverified observations in scope, nothing else, up to the limit', async () => {
    const { open } = await setup();
    const python = await open(PYTHON, { writeGrant: grant() });
    committed(await python.create('EVIDENCE', evidence('mean=4.2'), { key: 't1', scope: toolScope }));
    expect(refused(await python.create('EVIDENCE', evidence('mean=4.2', { verification: 'VERIFIED' }), { key: 't2', scope: toolScope })).reasonCode).toBe('tool_cannot_verify');
    expect(refused(await python.create('FINDING', { findingClass: 'RISK', severity: 'HIGH', statement: 'drift', blocking: true, status: 'OPEN', juliusFindingId: null }, { key: 't3', scope: toolScope })).reasonCode).toBe('tool_cannot_declare_blocking');
    expect(refused(await python.create('DECISION', decision('x'), { key: 't4', scope: toolScope })).reasonCode).toBe('grant_kind_not_permitted');
    expect(refused(await python.create('EVIDENCE', evidence('elsewhere'), { key: 't5', scope: { missionId: MISSION, taskId: 'task-other' } })).reasonCode).toBe('grant_scope_mismatch');
    committed(await python.create('FINDING', { findingClass: 'RISK', severity: 'HIGH', statement: 'drift', blocking: false, status: 'OPEN', juliusFindingId: null }, { key: 't3', scope: toolScope }));
    committed(await python.create('TRACE', { traceClass: 'TOOL_INVOCATION', summary: 'ran', facts: { rows: 10 } }, { key: 't6', scope: toolScope }));
    expect(refused(await python.create('TRACE', { traceClass: 'TOOL_INVOCATION', summary: 'ran again', facts: {} }, { key: 't7', scope: toolScope })).reasonCode).toBe('grant_record_limit');
  });

  it('an expired grant writes nothing', async () => {
    const { open } = await setup();
    const python = await open(PYTHON, { writeGrant: grant({ expiresAt: '2026-09-13T09:00:00.000Z' }) });
    expect(refused(await python.create('EVIDENCE', evidence('x'), { key: 't1', scope: toolScope })).reasonCode).toBe('grant_expired');
  });

  it('a tool reads nothing it was not granted', async () => {
    const { open } = await setup();
    committed(await (await open(JULIUS)).create('OBJECTIVE', { statement: 'secret plan', successMeasure: null }, { key: 'o', scope }));
    expect(await (await open(PYTHON)).entities()).toEqual([]);
  });
});

describe('Project Brain — memory trust: auto-generate is allowed, auto-trust is not', () => {
  it('generated memory is UNVERIFIED; promotion is mission authority with evidence', async () => {
    const { open } = await setup();
    const coder = await open(CODER);
    const julius = await open(JULIUS);
    expect(refused(await coder.create('MEMORY_FACT', { statement: 'tests take 14 minutes', trust: 'VERIFIED', expiresAt: null }, { key: 'm', scope })).reasonCode).toBe('auto_trust_refused');
    const fact = committed(await coder.create('MEMORY_FACT', { statement: 'tests take 14 minutes', trust: 'UNVERIFIED', expiresAt: null }, { key: 'm', scope }));
    const id = fact.receipts[0]!.entityId;
    expect(refused(await coder.revise(id, { statement: 'tests take 14 minutes', trust: 'VERIFIED', expiresAt: null }, { key: 'm-self', expectedVersion: 1 })).reasonCode).toBe('auto_trust_refused');
    expect(refused(await julius.revise(id, { statement: 'tests take 14 minutes', trust: 'VERIFIED', expiresAt: null }, { key: 'm-v', expectedVersion: 1 })).reasonCode).toBe('trust_requires_evidence');
    const ev = committed(await coder.create('EVIDENCE', evidence('suite duration 842s', { evidenceClass: 'MEASUREMENT' }), { key: 'ev-d', scope }));
    committed(await julius.revise(id, { statement: 'tests take 14 minutes', trust: 'VERIFIED', expiresAt: null }, { key: 'm-v', expectedVersion: 1, links: [juliusLink('EVIDENCED_BY', ev.receipts[0]!.entityId)] }));
  });
});

describe('Project Brain — reads are scoped and history is honest', () => {
  it('workers do not see RESTRICTED entities, and history counts what it omitted', async () => {
    const { open } = await setup();
    const julius = await open(JULIUS);
    committed(await julius.create('CONSTRAINT', { statement: 'public', status: 'ACTIVE' }, { key: 'c1', scope }));
    committed(await julius.create('CONSTRAINT', { statement: 'restricted', status: 'ACTIVE' }, { key: 'c2', scope, sensitivity: 'RESTRICTED' }));
    const coder = await open(CODER);
    expect((await coder.entities()).map((state) => state.body.statement)).toEqual(['public']);
    const page = await coder.history();
    expect(page.records).toHaveLength(1);
    expect(page.omitted).toBe(1);
  });
});

describe('Project Brain — the ledger is the authority', () => {
  it('the materialised state equals the projection of the ledger, and a checkpoint pins it', async () => {
    const { open, store } = await setup();
    const julius = await open(JULIUS);
    committed(await julius.create('OBJECTIVE', { statement: 'one', successMeasure: null }, { key: 'o', scope }));
    const d = committed(await julius.create('DECISION', decision('a'), { key: 'd', scope }));
    committed(await julius.supersede(d.receipts[0]!.entityId, 1, decision('b'), { key: 'd2' }));
    const verification = await julius.verify();
    expect(verification.ok).toBe(true);
    const checkpoint = committed(await julius.checkpoint('after-decisions'));
    const [pin] = await julius.current('CHECKPOINT');
    expect(pin!.body).toMatchObject({ throughSequence: 3, stateHash: verification.stateHash, entityCount: 3 });
    const records = await readAllJuliusBrainRecords(store, BRAIN, PROJECT);
    expect(juliusBrainStateHash(projectJuliusBrain(BRAIN, records, 3).entities.values())).toBe(verification.stateHash);
    expect(checkpoint.receipts[0]!.sequence).toBe(4);
  });

  it('tampering with any record is detected', async () => {
    const { open, store } = await setup();
    const julius = await open(JULIUS);
    committed(await julius.create('OBJECTIVE', { statement: 'honest', successMeasure: null }, { key: 'o', scope }));
    committed(await julius.create('CONSTRAINT', { statement: 'kept', status: 'ACTIVE' }, { key: 'c', scope }));
    const records = await readAllJuliusBrainRecords(store, BRAIN, PROJECT);
    const tampered: JuliusBrainRecord[] = [{ ...records[0]!, body: { statement: 'rewritten', successMeasure: null } }, records[1]!];
    expect(verifyJuliusBrainLedger(BRAIN, tampered).problems).toContain(`record ${records[0]!.recordId}: content hash mismatch`);
    const reordered = [records[1]!, records[0]!];
    expect(verifyJuliusBrainLedger(BRAIN, reordered).ok).toBe(false);
    expect(verifyJuliusBrainLedger(BRAIN, [records[0]!]).ok).toBe(true);
  });

  it('a verified ledger restores into a fresh store with identical state, and never over an existing Brain', async () => {
    const { open, store } = await setup();
    const julius = await open(JULIUS);
    committed(await julius.create('OBJECTIVE', { statement: 'survive', successMeasure: null }, { key: 'o', scope }));
    committed(await (await open(CODER)).create('EVIDENCE', evidence('ok'), { key: 'e', scope }));
    const records = await readAllJuliusBrainRecords(store, BRAIN, PROJECT);
    const identity = (await store.loadBrain(BRAIN, PROJECT))!;
    expect((await store.restore(identity, records)).outcome).toBe('REFUSED');
    const fresh = createJuliusBrainMemoryStore();
    expect(await fresh.restore(identity, records)).toMatchObject({ outcome: 'RESTORED', entityCount: 2 });
    expect(await fresh.entities(BRAIN, PROJECT, {})).toEqual(await store.entities(BRAIN, PROJECT, {}));
    expect(fresh.verify(BRAIN).ok).toBe(true);
    const corrupt = records.map((record, index) => index === 1 ? { ...record, occurredAt: '2020-01-01T00:00:00.000Z' } : record);
    expect(await createJuliusBrainMemoryStore().restore(identity, corrupt)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'ledger_invalid' });
  });
});

describe('Project Brain — schemas are strict and missing is not unknown', () => {
  it('refuses unknown fields and absent nullable fields; accepts explicit null', () => {
    const spec = JULIUS_BRAIN_BODY_SCHEMAS.OBJECTIVE;
    expect(validateJuliusBrainObject(spec, { statement: 's', successMeasure: null })).toEqual([]);
    expect(validateJuliusBrainObject(spec, { statement: 's' })).toEqual(['body.successMeasure: required']);
    expect(validateJuliusBrainObject(spec, { statement: 's', successMeasure: null, extra: 1 })).toEqual(['body.extra: unknown field']);
    expect(validateJuliusBrainObject(JULIUS_BRAIN_BODY_SCHEMAS.EVAL, {})).toContain('body.score: required');
  });

  it('declares the editable surface: evidence and trace are shown, never edited', () => {
    const surface = new Map(juliusBrainEditableSurface().map((row) => [row.kind, row]));
    expect(surface.get('EVIDENCE')!.editability).toBe('SYSTEM_OWNED');
    expect(surface.get('TRACE')!.userRevisableFields).toBeNull();
    expect(surface.get('OBJECTIVE')!.editability).toBe('USER_EDITABLE');
    expect(surface.get('MISSION')!.userRevisableFields).toEqual(['title']);
  });
});
