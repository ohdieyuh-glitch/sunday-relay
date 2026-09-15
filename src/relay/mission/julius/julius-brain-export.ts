import {
  JULIUS_BRAIN_RECORD_KINDS,
  canonicalJuliusBrainJson,
  juliusBrainSha256,
  type JuliusBrainHead,
  type JuliusBrainIdentity,
  type JuliusBrainPrincipal,
  type JuliusBrainRecord,
  type JuliusBrainRecordKind,
} from './julius-brain-contracts';
import { juliusBrainReadable, type JuliusBrainReadGrant } from './julius-brain-policy';
import { juliusBrainStateHash, projectJuliusBrain, verifyJuliusBrainLedger, type JuliusBrainEntityState } from './julius-brain-projection';
import { redactJuliusSecretsDeep } from './julius-brain-secrets';
import type { JuliusBrainRestoreResult, JuliusBrainStore } from './julius-brain-store';
import { readAllJuliusBrainEntities, readAllJuliusBrainRecords } from './julius-brain-store';

/**
 * THE INSPECTABLE BRAIN: EXPORT, RESTORE, AND EVALUATION SNAPSHOTS.
 *
 * AN EXPORT IS A COMPLETE, SELF-VERIFYING BUNDLE. It carries the whole ledger
 * (so every id, author, provenance block and hash survives), the materialised
 * state, human-oriented sections, a timeline, and its own hash. Missing is
 * never zero: an absent objective is `null` and renders "Missing", an unknown
 * score is `null` and renders "Unknown", an empty list is an empty list.
 *
 * SECRETS: the Brain refuses credential-shaped content on write, so a healthy
 * export redacts nothing. The export scans anyway — defence in depth against a
 * record written before a pattern existed — and COUNTS what it replaced. A
 * redacted bundle no longer matches its own hashes, so it is marked not
 * restorable rather than restored into a Brain that would fail verification.
 *
 * RESTORE IS SAFE OR REFUSED. Only into a Brain id that does not exist; only
 * from an unredacted bundle whose ledger re-verifies and whose recorded state
 * hash re-derives.
 */

export const JULIUS_BRAIN_EXPORT_FORMAT = 'julius-project-brain-export.v1' as const;
export const JULIUS_BRAIN_EVALUATION_CONTEXT_FORMAT = 'julius-brain-evaluation-context.v1' as const;

export type JuliusBrainArtifactCheck = 'RESOLVED' | 'MISSING' | 'INTEGRITY_FAILURE' | 'UNSUPPORTED_REF' | 'NOT_CHECKED';

export interface JuliusBrainExportEntity {
  readonly entityId: string;
  readonly kind: JuliusBrainRecordKind;
  readonly version: number;
  readonly lifecycle: JuliusBrainEntityState['lifecycle'];
  readonly body: JuliusBrainEntityState['body'];
  readonly scope: JuliusBrainEntityState['scope'];
  readonly confidence: number | null;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly supersededBy: string | null;
  readonly retirement: JuliusBrainEntityState['retirement'];
  readonly links: JuliusBrainEntityState['links'];
  readonly inbound: JuliusBrainEntityState['inbound'];
}

export interface JuliusBrainExportBundle {
  readonly format: typeof JULIUS_BRAIN_EXPORT_FORMAT;
  readonly exportedAt: string;
  readonly exportedBy: JuliusBrainPrincipal;
  readonly brain: JuliusBrainIdentity;
  readonly head: JuliusBrainHead;
  readonly stateHash: string;
  readonly ledger: { readonly verified: boolean; readonly problems: readonly string[] };
  readonly counts: {
    readonly records: number;
    readonly entities: number;
    readonly byKind: Readonly<Partial<Record<JuliusBrainRecordKind, number>>>;
    readonly byLifecycle: Readonly<Record<string, number>>;
  };
  readonly sections: {
    /** null: no active objective exists. */
    readonly objective: JuliusBrainExportEntity | null;
    readonly missions: readonly JuliusBrainExportEntity[];
    readonly state: JuliusBrainExportEntity | null;
    readonly requirements: readonly JuliusBrainExportEntity[];
    readonly architecture: readonly JuliusBrainExportEntity[];
    readonly decisions: { readonly active: readonly JuliusBrainExportEntity[]; readonly superseded: readonly JuliusBrainExportEntity[]; readonly retired: readonly JuliusBrainExportEntity[] };
    readonly research: readonly JuliusBrainExportEntity[];
    readonly evidence: readonly JuliusBrainExportEntity[];
    readonly evals: readonly JuliusBrainExportEntity[];
    readonly findings: readonly JuliusBrainExportEntity[];
    readonly repairs: readonly JuliusBrainExportEntity[];
    readonly handoffs: readonly JuliusBrainExportEntity[];
    readonly artifacts: readonly (JuliusBrainExportEntity & { readonly resolution: JuliusBrainArtifactCheck })[];
    readonly memory: readonly JuliusBrainExportEntity[];
    readonly pythonExecutions: readonly JuliusBrainExportEntity[];
    readonly checkpoints: readonly JuliusBrainExportEntity[];
  };
  readonly timeline: readonly {
    readonly sequence: number; readonly recordId: string; readonly entityId: string; readonly kind: JuliusBrainRecordKind;
    readonly op: string; readonly entityVersion: number; readonly principal: string; readonly occurredAt: string | null; readonly recordedAt: string;
  }[];
  readonly records: readonly JuliusBrainRecord[];
  readonly entities: readonly JuliusBrainEntityState[];
  readonly redaction: { readonly applied: number; readonly restorable: boolean };
  /** sha256 over the canonical bundle without this field. */
  readonly bundleHash: string;
}

export const juliusPrincipalLabel = (principal: JuliusBrainPrincipal): string =>
  `${principal.kind}:${principal.id}${principal.role === null ? '' : `(${principal.role})`}${principal.grantId === null ? '' : `[grant ${principal.grantId}]`}`;

const summary = (state: JuliusBrainEntityState): JuliusBrainExportEntity => ({
  entityId: state.entityId, kind: state.kind, version: state.version, lifecycle: state.lifecycle, body: state.body, scope: state.scope,
  confidence: state.confidence, createdBy: juliusPrincipalLabel(state.createdBy), updatedBy: juliusPrincipalLabel(state.updatedBy),
  createdAt: state.createdAt, updatedAt: state.updatedAt, supersededBy: state.supersededBy, retirement: state.retirement,
  links: state.links, inbound: state.inbound,
});

export async function exportJuliusBrain(input: {
  readonly store: JuliusBrainStore;
  readonly brainId: string;
  readonly projectId: string;
  readonly exportedBy: JuliusBrainPrincipal;
  readonly exportedAt: string;
  readonly resolveArtifact?: (storageRef: string, contentHash: string) => Promise<Exclude<JuliusBrainArtifactCheck, 'NOT_CHECKED'>>;
  readonly secretLiterals?: readonly string[];
}): Promise<JuliusBrainExportBundle | null> {
  if (input.exportedBy.kind !== 'JULIUS' && input.exportedBy.kind !== 'USER') throw new Error('julius_brain_export_requires_authority');
  const brain = await input.store.loadBrain(input.brainId, input.projectId);
  if (brain === null) return null;
  const records = await readAllJuliusBrainRecords(input.store, brain.brainId, brain.projectId);
  const entities = await readAllJuliusBrainEntities(input.store, brain.brainId, brain.projectId);
  const verification = verifyJuliusBrainLedger(brain.brainId, records, entities);
  const of = (kinds: readonly JuliusBrainRecordKind[]) => entities.filter((state) => kinds.includes(state.kind)).sort((a, b) => a.createdSequence - b.createdSequence);
  const tally = <T extends string>(values: readonly T[]) => values.reduce<Partial<Record<T, number>>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {});
  const decisions = of(['DECISION']);
  const activeObjective = of(['OBJECTIVE']).filter((state) => state.lifecycle === 'ACTIVE').at(-1) ?? null;
  const latestState = of(['MISSION_STATE']).filter((state) => state.lifecycle === 'ACTIVE').sort((a, b) => b.updatedSequence - a.updatedSequence)[0] ?? null;
  const artifacts = [];
  for (const state of of(['ARTIFACT'])) {
    const resolution: JuliusBrainArtifactCheck = input.resolveArtifact === undefined
      ? 'NOT_CHECKED'
      : await input.resolveArtifact(String(state.body.storageRef), String(state.body.contentHash));
    artifacts.push({ ...summary(state), resolution });
  }
  const unhashed = {
    format: JULIUS_BRAIN_EXPORT_FORMAT,
    exportedAt: input.exportedAt,
    exportedBy: input.exportedBy,
    brain,
    head: verification.head,
    stateHash: verification.stateHash,
    ledger: { verified: verification.ok, problems: verification.problems },
    counts: {
      records: records.length, entities: entities.length,
      byKind: tally(entities.map((state) => state.kind)),
      byLifecycle: tally(entities.map((state) => state.lifecycle)) as Record<string, number>,
    },
    sections: {
      objective: activeObjective === null ? null : summary(activeObjective),
      missions: of(['MISSION']).map(summary),
      state: latestState === null ? null : summary(latestState),
      requirements: of(['REQUIREMENT', 'ACCEPTANCE_CRITERION', 'CONSTRAINT', 'PROHIBITION', 'ASSUMPTION', 'OPEN_QUESTION']).map(summary),
      architecture: of(['ARCHITECTURE_COMPONENT', 'ARCHITECTURE_INTERFACE']).map(summary),
      decisions: {
        active: decisions.filter((state) => state.lifecycle === 'ACTIVE').map(summary),
        superseded: decisions.filter((state) => state.lifecycle === 'SUPERSEDED').map(summary),
        retired: decisions.filter((state) => state.lifecycle === 'RETIRED').map(summary),
      },
      research: of(['RESEARCH']).map(summary),
      evidence: of(['EVIDENCE']).map(summary),
      evals: of(['EVAL']).map(summary),
      findings: of(['FINDING']).map(summary),
      repairs: of(['REPAIR']).map(summary),
      handoffs: of(['HANDOFF']).map(summary),
      artifacts,
      memory: of(['MEMORY_FACT']).map(summary),
      pythonExecutions: of(['PYTHON_EXECUTION']).map(summary),
      checkpoints: of(['CHECKPOINT']).map(summary),
    },
    timeline: records.map((record) => ({
      sequence: record.sequence, recordId: record.recordId, entityId: record.entityId, kind: record.kind, op: record.op,
      entityVersion: record.entityVersion, principal: juliusPrincipalLabel(record.principal), occurredAt: record.occurredAt, recordedAt: record.recordedAt,
    })),
    records,
    entities,
  };
  const redacted = redactJuliusSecretsDeep(unhashed, input.secretLiterals ?? []);
  const withRedaction = { ...redacted.value, redaction: { applied: redacted.redactions, restorable: redacted.redactions === 0 && verification.ok } };
  return { ...withRedaction, bundleHash: juliusBrainSha256(canonicalJuliusBrainJson(withRedaction)) } as JuliusBrainExportBundle;
}

export type JuliusBrainImportCheck = { readonly ok: true } | { readonly ok: false; readonly reasonCode: string; readonly detail: string };

/** Everything a restore requires, checked before any store is touched. */
export function checkJuliusBrainExportForRestore(bundle: JuliusBrainExportBundle): JuliusBrainImportCheck {
  if (bundle.format !== JULIUS_BRAIN_EXPORT_FORMAT) return { ok: false, reasonCode: 'unsupported_format', detail: String(bundle.format) };
  const { bundleHash, ...rest } = bundle;
  if (juliusBrainSha256(canonicalJuliusBrainJson(rest)) !== bundleHash) return { ok: false, reasonCode: 'bundle_hash_mismatch', detail: 'The bundle does not match its own hash.' };
  if (bundle.redaction.applied !== 0 || !bundle.redaction.restorable) return { ok: false, reasonCode: 'bundle_redacted', detail: `${bundle.redaction.applied} redaction(s): this bundle no longer matches its ledger hashes.` };
  const verification = verifyJuliusBrainLedger(bundle.brain.brainId, bundle.records, bundle.entities);
  if (!verification.ok) return { ok: false, reasonCode: 'ledger_invalid', detail: verification.problems.slice(0, 8).join('; ') };
  if (verification.stateHash !== bundle.stateHash) return { ok: false, reasonCode: 'state_hash_mismatch', detail: 'The recorded state hash does not re-derive.' };
  return { ok: true };
}

export async function restoreJuliusBrainFromExport(store: JuliusBrainStore, bundle: JuliusBrainExportBundle): Promise<JuliusBrainRestoreResult> {
  const check = checkJuliusBrainExportForRestore(bundle);
  if (!check.ok) return { outcome: 'REFUSED', reasonCode: check.reasonCode, detail: check.detail };
  return store.restore(bundle.brain, bundle.records);
}

/* ------------------------------------------------------ human-readable */

const show = (value: unknown): string => (value === null || value === undefined ? 'Unknown' : typeof value === 'object' ? canonicalJuliusBrainJson(value) : String(value));

export function renderJuliusBrainExportMarkdown(bundle: JuliusBrainExportBundle): string {
  const out: string[] = [];
  const entity = (item: JuliusBrainExportEntity, fields: readonly string[]) => {
    const lifecycle = item.lifecycle === 'ACTIVE' ? '' : ` — **${item.lifecycle}**${item.supersededBy ? ` by \`${item.supersededBy}\`` : ''}${item.retirement ? ` (${item.retirement.disposition}: ${item.retirement.reason})` : ''}`;
    out.push(`- \`${item.entityId}\` v${item.version}${lifecycle}`);
    for (const field of fields) if (field in item.body) out.push(`  - ${field}: ${show(item.body[field])}`);
    out.push(`  - by ${item.createdBy}${item.updatedBy === item.createdBy ? '' : `, last changed by ${item.updatedBy}`}; confidence ${show(item.confidence)}`);
  };
  const section = (title: string, items: readonly JuliusBrainExportEntity[], fields: readonly string[]) => {
    out.push('', `## ${title}`, '');
    if (items.length === 0) out.push('None recorded.');
    for (const item of items) entity(item, fields);
  };
  out.push(`# Project Brain — ${bundle.brain.title}`, '');
  out.push(`- Brain \`${bundle.brain.brainId}\` in project \`${bundle.brain.projectId}\``);
  out.push(`- Exported ${bundle.exportedAt} by ${juliusPrincipalLabel(bundle.exportedBy)}`);
  out.push(`- Head: sequence ${bundle.head.sequence}, chain \`${bundle.head.chainHash}\``);
  out.push(`- Ledger ${bundle.ledger.verified ? 'VERIFIED' : `NOT VERIFIED (${bundle.ledger.problems.length} problem(s))`}; state \`${bundle.stateHash}\``);
  out.push(`- ${bundle.counts.records} records, ${bundle.counts.entities} entities; redactions applied: ${bundle.redaction.applied}; restorable: ${bundle.redaction.restorable ? 'yes' : 'no'}`);
  out.push('', '## Objective', '');
  if (bundle.sections.objective === null) out.push('Missing — no active objective is recorded.');
  else entity(bundle.sections.objective, ['statement', 'successMeasure']);
  out.push('', '## Current state', '');
  if (bundle.sections.state === null) out.push('Missing — no mission state is recorded.');
  else entity(bundle.sections.state, ['phase', 'activeTaskIds', 'waitingOn', 'humanBoundaries', 'repairRound', 'budget']);
  section('Requirements, constraints and questions', bundle.sections.requirements, ['statement', 'question', 'status', 'answer', 'blocking']);
  section('Architecture', bundle.sections.architecture, ['name', 'responsibility', 'contract']);
  section('Decisions — active', bundle.sections.decisions.active, ['decisionClass', 'statement', 'rationale', 'alternatives']);
  section('Decisions — superseded', bundle.sections.decisions.superseded, ['statement', 'rationale']);
  section('Decisions — retired', bundle.sections.decisions.retired, ['statement']);
  section('Research', bundle.sections.research, ['question', 'findings', 'sources', 'status']);
  section('Evidence', bundle.sections.evidence, ['evidenceClass', 'claim', 'status', 'verification', 'summary']);
  section('Evals', bundle.sections.evals, ['evaluationName', 'outcome', 'score', 'maxScore', 'metrics', 'reproducibility']);
  section('Findings', bundle.sections.findings, ['severity', 'statement', 'blocking', 'status']);
  section('Repairs', bundle.sections.repairs, ['reason', 'status', 'implementation', 'verification', 'reviewerDisposition', 'resultingState']);
  section('Handoffs', bundle.sections.handoffs, ['handoffClass', 'summary']);
  out.push('', '## Artifacts', '');
  if (bundle.sections.artifacts.length === 0) out.push('None recorded.');
  for (const artifact of bundle.sections.artifacts) {
    entity(artifact, ['artifactClass', 'name', 'contentType', 'byteSize', 'contentHash', 'storageRef']);
    out.push(`  - resolution: ${artifact.resolution}`);
  }
  section('Memory', bundle.sections.memory, ['statement', 'trust', 'expiresAt']);
  section('Python executions', bundle.sections.pythonExecutions, ['executionId', 'state', 'scriptHash', 'exitCode', 'durationMs', 'network', 'structuredOutput', 'redactions']);
  section('Checkpoints', bundle.sections.checkpoints, ['label', 'throughSequence', 'stateHash']);
  out.push('', '## Timeline', '', '| # | kind | op | entity | by | occurred |', '|---|---|---|---|---|---|');
  for (const row of bundle.timeline) out.push(`| ${row.sequence} | ${row.kind} | ${row.op} v${row.entityVersion} | \`${row.entityId}\` | ${row.principal} | ${row.occurredAt ?? 'Unknown'} |`);
  return `${out.join('\n')}\n`;
}

/* ------------------------------------------- evaluation-context snapshots */

/**
 * A SCOPED, HASHED, READ-ONLY SLICE OF THE BRAIN for an isolated consumer: a
 * Python execution today, a GVE evaluation environment later. The consumer
 * gets exactly what the grant admits, pinned to a sequence, with a hash it can
 * return alongside its results so Julius can prove what it evaluated against.
 */
export interface JuliusBrainEvaluationContext {
  readonly format: typeof JULIUS_BRAIN_EVALUATION_CONTEXT_FORMAT;
  readonly brainId: string;
  readonly grant: JuliusBrainReadGrant;
  readonly throughSequence: number;
  /** Run identity of the consumer (a Python execution id, a GVE run id). */
  readonly consumerRunId: string;
  readonly createdAt: string;
  readonly entities: readonly JuliusBrainEntityState[];
  /**
   * The state mode the entities were selected under, or null when the caller
   * applied none. Hashed with everything else, so a consumer can prove which
   * prior state was withheld from it.
   */
  readonly stateMode: { readonly mode: string; readonly policyHash: string; readonly excluded: Readonly<Record<string, number>> } | null;
  /**
   * A snapshot holds no edge to an entity it does not hold. Links and inbound
   * edges naming anything outside were removed, and counted here: an edge from
   * a withheld prior run would otherwise carry its id and its judgment in.
   */
  readonly withheldEdges: number;
  readonly snapshotHash: string;
}

export function createJuliusBrainEvaluationContext(input: {
  readonly brainId: string;
  /** Already selected by a state mode when `stateMode` is given; the grant still applies on top. */
  readonly entities: readonly JuliusBrainEntityState[];
  readonly head: JuliusBrainHead;
  readonly grant: JuliusBrainReadGrant;
  readonly consumerRunId: string;
  readonly createdAt: string;
  readonly stateMode?: JuliusBrainEvaluationContext['stateMode'];
}): JuliusBrainEvaluationContext {
  if (input.grant.brainId !== input.brainId) throw new Error('julius_brain_snapshot_grant_brain_mismatch');
  const selected = input.entities
    .filter((state) => juliusBrainReadable({ grant: input.grant, kind: state.kind, scope: state.scope, sensitivity: state.sensitivity }))
    .filter((state) => input.grant.includeHistory || state.lifecycle === 'ACTIVE')
    .sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
  const held = new Set(selected.map((state) => state.entityId));
  let withheldEdges = 0;
  const entities = selected.map((state) => {
    const links = state.links.filter((link) => held.has(link.target));
    const inbound = state.inbound.filter((edge) => held.has(edge.source));
    withheldEdges += state.links.length - links.length + state.inbound.length - inbound.length;
    return { ...state, links, inbound };
  });
  const content = {
    format: JULIUS_BRAIN_EVALUATION_CONTEXT_FORMAT, brainId: input.brainId, grant: input.grant,
    throughSequence: input.head.sequence, consumerRunId: input.consumerRunId, createdAt: input.createdAt, entities,
    stateMode: input.stateMode ?? null, withheldEdges,
  };
  return { ...content, snapshotHash: juliusBrainSha256(canonicalJuliusBrainJson(content)) };
}

export function verifyJuliusBrainEvaluationContext(context: JuliusBrainEvaluationContext): boolean {
  const { snapshotHash, ...content } = context;
  return juliusBrainSha256(canonicalJuliusBrainJson(content)) === snapshotHash;
}

/** A read grant covering every kind within the given missions, for exports and snapshots. */
export function juliusBrainMissionReadGrant(input: { readonly grantId: string; readonly brainId: string; readonly missionIds: readonly string[] | null; readonly kinds?: readonly JuliusBrainRecordKind[]; readonly taskIds?: readonly string[] | null; readonly includeHistory?: boolean }): JuliusBrainReadGrant {
  return {
    grantId: input.grantId, brainId: input.brainId, kinds: input.kinds ?? JULIUS_BRAIN_RECORD_KINDS,
    missionIds: input.missionIds, taskIds: input.taskIds ?? null, includeHistory: input.includeHistory ?? false, includeRestricted: false,
  };
}

/** Re-derive a projection hash at a sequence: what a resume compares a checkpoint against. */
export function juliusBrainStateHashAt(brainId: string, records: readonly JuliusBrainRecord[], sequence: number): string {
  return juliusBrainStateHash(projectJuliusBrain(brainId, records, sequence).entities.values());
}

export interface JuliusBrainResumeReport {
  readonly status: 'VERIFIED' | 'NOT_VERIFIED' | 'NOT_FOUND';
  readonly head: JuliusBrainHead | null;
  readonly records: number;
  readonly entities: number;
  readonly lastCheckpoint: { readonly entityId: string; readonly label: string; readonly throughSequence: number; readonly matches: boolean } | null;
  readonly problems: readonly string[];
}

/**
 * RESUME: what a process that just started must establish before it trusts a
 * Brain it did not write. The ledger re-verifies end to end, the stored head is
 * the ledger's head, the materialised rows are the projection, and the latest
 * checkpoint's pinned state re-derives from the ledger up to its sequence.
 * "VERIFIED" is announced only when all four hold.
 */
export async function resumeJuliusBrain(store: JuliusBrainStore, brainId: string, projectId: string): Promise<JuliusBrainResumeReport> {
  const head = await store.head(brainId, projectId);
  if (head === null) return { status: 'NOT_FOUND', head: null, records: 0, entities: 0, lastCheckpoint: null, problems: ['brain_not_found'] };
  const records = await readAllJuliusBrainRecords(store, brainId, projectId);
  const entities = await readAllJuliusBrainEntities(store, brainId, projectId);
  const verification = verifyJuliusBrainLedger(brainId, records, entities);
  const problems = [...verification.problems];
  if (verification.head.sequence !== head.sequence || verification.head.chainHash !== head.chainHash) problems.push('stored head differs from the ledger head');
  const checkpoint = entities.filter((state) => state.kind === 'CHECKPOINT').sort((a, b) => b.createdSequence - a.createdSequence)[0];
  let lastCheckpoint: JuliusBrainResumeReport['lastCheckpoint'] = null;
  if (checkpoint !== undefined) {
    const throughSequence = Number(checkpoint.body.throughSequence);
    const matches = juliusBrainStateHashAt(brainId, records, throughSequence) === checkpoint.body.stateHash;
    if (!matches) problems.push(`checkpoint ${checkpoint.entityId} does not re-derive`);
    lastCheckpoint = { entityId: checkpoint.entityId, label: String(checkpoint.body.label), throughSequence, matches };
  }
  return { status: problems.length === 0 ? 'VERIFIED' : 'NOT_VERIFIED', head, records: records.length, entities: entities.length, lastCheckpoint, problems };
}
