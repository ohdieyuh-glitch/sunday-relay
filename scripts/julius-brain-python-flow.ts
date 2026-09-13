import { createHash } from 'node:crypto';

import { juliusPrincipal, juliusWorkerPrincipal, type JuliusBrainPrincipal } from '../src/relay/mission/julius/julius-brain-contracts';
import { exportJuliusBrain, resumeJuliusBrain } from '../src/relay/mission/julius/julius-brain-export';
import { juliusBrainSchemaDocument } from '../src/relay/mission/julius/julius-brain-schema-document';
import { createJuliusProjectBrainService, juliusLink } from '../src/relay/mission/julius/julius-brain-service';
import { readAllJuliusBrainEntities, readAllJuliusBrainRecords, type JuliusBrainCommitResult, type JuliusBrainStore } from '../src/relay/mission/julius/julius-brain-store';
import {
  JULIUS_PYTHON_DEFAULT_LIMITS,
  JULIUS_PYTHON_REQUEST_FORMAT,
  type JuliusPythonExecutionRequest,
  type JuliusPythonRunnerPort,
} from '../src/relay/mission/julius/julius-python-contracts';
import {
  createJuliusPythonExecutionService,
  type JuliusPythonExecutionRecord,
  type JuliusPythonExecutionService,
  type JuliusPythonExecutionStore,
} from '../src/relay/mission/julius/julius-python-service';
import type { JuliusCardPolicy } from '../src/relay/mission/julius/julius-policy';
import type { JuliusBrainContentStore } from '../src/relay/persistence/julius-brain-content-store';
import { StaticJuliusPythonEnvironmentRegistry } from '../src/relay/workspace/julius-tools/python-runner';

/**
 * THE PRIVATE-BETA FLOW: THREE TIERS, JULIUS, PYTHON AND THE PROJECT BRAIN.
 *
 *   Mission begins → Brain initialised → the Architect records architecture and
 *   research and proposes requirements → Julius adopts them → the Coding Agent
 *   asks for analysis → Julius grants a Python execution → Python reads only its
 *   granted slice, processes the mission's real dataset, and returns a
 *   structured measurement, an eval and an artifact → the coder concludes →
 *   the Independent Reviewer checks the evidence independently, with its own
 *   Python execution, contradicts the conclusion and raises a blocking finding
 *   → Julius requests a repair → the coder's repaired analysis locates the
 *   regression → the reviewer verifies it and accepts the repair → Julius
 *   resolves the finding, supersedes the wrong decision, completes the mission
 *   and checkpoints.
 *
 * The same scenario runs against the in-memory stores (always, where a Python
 * exists) and against PostgreSQL across process restarts (the drill).
 */

export const FLOW = Object.freeze({
  projectId: 'prj-brain-python-flow',
  brainId: 'brain:prj-brain-python-flow',
  missionId: 'mission:latency-regression',
  environmentId: 'system-python',
});

const JULIUS = juliusPrincipal('JULIUS', 'julius');
const USER = juliusPrincipal('USER', 'founder');
const ARCHITECT = juliusWorkerPrincipal('architect-1', 'PROMPT_ARCHITECT');
const CODER = juliusWorkerPrincipal('coder-1', 'CODING_AGENT');
const REVIEWER = juliusWorkerPrincipal('reviewer-1', 'INDEPENDENT_REVIEWER');

export const FLOW_CARD: JuliusCardPolicy = Object.freeze({
  revision: 'card-flow-1', autonomy: 'AUTONOMOUS', allowedProviders: [], capabilities: ['python', 'process'],
  network: false, filesystemRead: true, filesystemMutation: false, fallback: false, automaticRetry: false,
  subagents: { allowed: false, maxDepth: 0, maxActive: 0, maxTotal: 0 }, iterativeReview: { allowed: true, maxRounds: 2 },
  concurrency: 1, approvals: [],
});

/** 200 deterministic samples: ~4ms for the first 100, ~7ms after a regression at sample 100. */
export function latencyDataset(): string {
  let seed = 424242;
  const next = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
  const rows = ['sample,latency_ms'];
  for (let sample = 0; sample < 200; sample += 1) {
    const base = sample < 100 ? 4.0 : 7.0;
    rows.push(`${sample},${(base + (next() - 0.5) * 0.8).toFixed(3)}`);
  }
  return `${rows.join('\n')}\n`;
}

const py = (...lines: string[]) => `${lines.join('\n')}\n`;

const CODER_V1 = py(
  'import csv',
  'from julius import artifacts, brain, evidence, result',
  'objective = brain.get_objective()',
  'budget = brain.inputs()["budget_ms"]',
  'rows = [float(r["latency_ms"]) for r in csv.DictReader(open("../inputs/latency.csv"))]',
  'mean = sum(rows) / len(rows)',
  'artifacts.write("summary-v1.json", \'{"mean_ms": %.4f, "samples": %d}\' % (mean, len(rows)))',
  'art = brain.register_artifact("summary-v1.json", "REPORT", "application/json")',
  'm = brain.record_evidence(evidence.Measurement("mean_latency_ms", round(mean, 4), "ms", claim="latency is within the %s ms budget" % budget, status=evidence.PASSED if mean <= budget else evidence.FAILED), supports=[objective], derived_from=[art])',
  'brain.record_eval(evidence.EvaluationResult("latency-budget-v1", "DATASET", "latency.csv", "PASS" if mean <= budget else "FAIL", score=1 if mean <= budget else 0, max_score=1, seed=0), evidenced_by=[m])',
  'result.set({"mean_ms": round(mean, 4), "samples": len(rows)})',
);

const REVIEWER_CHECK = py(
  'import csv',
  'from julius import brain, evidence, result',
  'budget = brain.inputs()["budget_ms"]',
  'claims = brain.query_evidence(claim="within the")',
  'assert len(claims) == 1, "the reviewer checks the coder\'s claim, not its own"',
  'rows = [float(r["latency_ms"]) for r in csv.DictReader(open("../inputs/latency.csv"))]',
  'tail = sorted(rows[-50:])',
  'p95_tail = tail[int(round(0.95 * (len(tail) - 1)))]',
  'c = brain.record_evidence(evidence.Comparison("p95_tail_vs_budget", baseline=budget, candidate=round(p95_tail, 4), better="LOWER", unit="ms", claim="the most recent traffic is within budget"), contradicts=[claims[0]])',
  'brain.record_eval(evidence.EvaluationResult("latency-budget-independent", "ENTITY", claims[0].entity_id, "FAIL" if p95_tail > budget else "PASS", score=0 if p95_tail > budget else 1, max_score=1, seed=0), evidenced_by=[c])',
  'result.set({"p95_tail_ms": round(p95_tail, 4), "contradicts": claims[0].entity_id})',
);

const CODER_REPAIR = py(
  'import csv',
  'from julius import artifacts, brain, evidence, result',
  'budget = brain.inputs()["budget_ms"]',
  'rows = [float(r["latency_ms"]) for r in csv.DictReader(open("../inputs/latency.csv"))]',
  'windows = []',
  'for start in range(0, len(rows), 20):',
  '    w = sorted(rows[start:start + 20])',
  '    windows.append((start, w[int(round(0.95 * (len(w) - 1)))]))',
  'change = next((start for start, p95 in windows if p95 > budget), None)',
  'artifacts.write("windows.csv", "window_start,p95_ms\\n" + "".join("%d,%.4f\\n" % (s, p) for s, p in windows))',
  'art = brain.register_artifact("windows.csv", "DATASET", "text/csv")',
  'series = brain.record_evidence(evidence.MetricSeries("p95_by_window", [(s, round(p, 4)) for s, p in windows], unit="ms", status=evidence.PASSED), derived_from=[art])',
  'located = brain.record_evidence(evidence.Measurement("regression_start_sample", change, None, claim="the regression starts at sample %s" % change, status=evidence.PASSED if change is not None else evidence.INCONCLUSIVE), derived_from=[art, series])',
  'brain.record_eval(evidence.EvaluationResult("regression-located", "DATASET", "latency.csv", "PASS" if change is not None else "INCONCLUSIVE", score=None, max_score=None, metrics=[("change_point", change, "sample")], seed=0), evidenced_by=[located])',
  'result.set({"change_point": change, "windows": len(windows)})',
);

const must = (result: JuliusBrainCommitResult, what: string): string => {
  if (result.outcome !== 'COMMITTED') throw new Error(`flow_write_refused:${what}:${result.reasonCode}:${result.detail}`);
  return result.receipts[0]!.entityId;
};

const succeeded = (record: JuliusPythonExecutionRecord, what: string): JuliusPythonExecutionRecord => {
  if (record.state !== 'SUCCEEDED') throw new Error(`flow_python_${what}_${record.state}:${record.outcome?.reasonCode}:${record.outcome?.stderr?.text.slice(-400)}`);
  return record;
};

export interface BrainPythonFlowDeps {
  readonly brains: JuliusBrainStore;
  readonly executions: JuliusPythonExecutionStore;
  readonly content: JuliusBrainContentStore;
  readonly runner: JuliusPythonRunnerPort;
  readonly python: string;
  readonly clock: { now(): string };
  readonly hostInstanceId: string;
}

export function flowPythonService(deps: BrainPythonFlowDeps): JuliusPythonExecutionService {
  return createJuliusPythonExecutionService({
    store: deps.executions, brains: deps.brains, runner: deps.runner,
    environments: new StaticJuliusPythonEnvironmentRegistry(new Map([[FLOW.environmentId, deps.python]])),
    secrets: { has: () => false, resolve: async () => null },
    policies: { cardFor: async () => FLOW_CARD },
    schema: juliusBrainSchemaDocument(), clock: deps.clock, hostInstanceId: deps.hostInstanceId, cancelPollMs: 100, disconnectGraceMs: 2_000,
  });
}

export function flowRequest(input: {
  readonly executionId: string; readonly requestedBy: JuliusBrainPrincipal; readonly taskId: string; readonly purpose: string;
  readonly source: string; readonly dataset: { storageRef: string; contentHash: string }; readonly readKinds: JuliusPythonExecutionRequest['brainRead']['kinds'];
  readonly now: string; readonly timeoutMs?: number;
}): JuliusPythonExecutionRequest {
  return {
    format: JULIUS_PYTHON_REQUEST_FORMAT, executionId: input.executionId, idempotencyKey: input.executionId,
    brainId: FLOW.brainId, projectId: FLOW.projectId, missionId: FLOW.missionId, runId: null, taskId: input.taskId,
    requestedBy: input.requestedBy, purpose: input.purpose, script: { kind: 'INLINE', source: input.source }, argv: [],
    inputs: { budget_ms: 6 }, files: [{ name: 'latency.csv', ...input.dataset }],
    brainRead: { kinds: input.readKinds, taskScoped: false, includeHistory: false },
    brainWrite: { kinds: ['EVIDENCE', 'EVAL', 'ARTIFACT', 'TRACE'], maxRecords: 20 },
    environment: { environmentId: FLOW.environmentId, requirements: [] }, network: { mode: 'DENY' }, secrets: [],
    limits: { ...JULIUS_PYTHON_DEFAULT_LIMITS, timeoutMs: input.timeoutMs ?? 60_000 }, requestedAt: input.now,
  };
}

export interface BrainPythonFlowIds {
  readonly datasetArtifact: string;
  readonly coderEvidence: string;
  readonly reviewerEvidence: string;
  readonly finding: string;
  readonly repair: string;
  readonly wrongDecision: string;
  readonly rightDecision: string;
  readonly executions: readonly string[];
}

export async function runBrainPythonMissionFlow(deps: BrainPythonFlowDeps): Promise<BrainPythonFlowIds> {
  const { projectId, brainId, missionId } = FLOW;
  const brainService = createJuliusProjectBrainService({ store: deps.brains, clock: deps.clock });
  const python = flowPythonService(deps);
  await brainService.initialize({ brainId, projectId, title: 'Latency regression mission', principal: JULIUS });
  const open = async (principal: JuliusBrainPrincipal) => (await brainService.open({ brainId, projectId, principal }))!;
  const [julius, user, architect, coder, reviewer] = await Promise.all([JULIUS, USER, ARCHITECT, CODER, REVIEWER].map(open));
  const scope = { missionId };

  // Mission begins; the user states the objective.
  const mission = must(await julius.create('MISSION', { missionId, title: 'Find the latency regression', status: 'ACTIVE', missionContract: { missionId, revision: 1, canonicalHash: null }, parentProjectId: projectId }, { key: 'mission', entityId: 'mission:latency-regression', scope }), 'mission');
  must(await user.create('OBJECTIVE', { statement: 'Establish whether request latency regressed, and where', successMeasure: 'the regression, if any, is located to a sample window' }, { key: 'objective', scope }), 'objective');

  // The Prompt Architect records architecture and research, and proposes requirements.
  must(await architect.create('ARCHITECTURE_COMPONENT', { name: 'Latency analysis', responsibility: 'Governed Python analyses over the mission dataset', interfaces: ['python.run'], dependsOn: ['Project Brain'], constraints: ['network denied'] }, { key: 'component', scope }), 'component');
  must(await architect.create('RESEARCH', {
    question: 'Which statistic exposes a tail regression?',
    findings: [{ statement: 'A whole-period mean hides a regression confined to recent traffic; a windowed p95 exposes it', confidence: 0.8 }],
    sources: [{ sourceKind: 'DOCUMENT', reference: 'SRE latency practice', retrievedAt: null }],
    contradictions: [], unresolved: ['whether the regression is still ongoing'], status: 'CONCLUDED',
  }, { key: 'research-statistic', scope, confidence: 0.8 }), 'research');
  const requirement = must(await architect.create('REQUIREMENT', { requirementClass: 'NON_FUNCTIONAL', statement: 'p95 latency stays within 6 ms', priority: 'MUST', status: 'PROPOSED' }, { key: 'req-budget', scope }), 'requirement');
  must(await julius.revise(requirement, { requirementClass: 'NON_FUNCTIONAL', statement: 'p95 latency stays within 6 ms', priority: 'MUST', status: 'ACTIVE' }, { key: 'req-budget-adopt', expectedVersion: 1 }), 'adopt');
  must(await julius.create('CONSTRAINT', { statement: 'Analyses run with the network denied', status: 'ACTIVE' }, { key: 'constraint-network', scope }), 'constraint');
  must(await architect.create('HANDOFF', { handoffClass: 'ARCHITECT_TO_CODER', fromRole: 'PROMPT_ARCHITECT', toRole: 'CODING_AGENT', summary: 'Measure latency against the 6 ms budget using the attached dataset', openQuestions: [] }, { key: 'handoff-analysis', scope }), 'handoff');

  // The coder registers the mission's real dataset.
  const bytes = new TextEncoder().encode(latencyDataset());
  const dataset = await deps.content.put(bytes);
  const datasetArtifact = must(await coder.create('ARTIFACT', { artifactClass: 'DATASET', name: 'latency.csv', contentType: 'text/csv', byteSize: dataset.byteSize, contentHash: dataset.contentHash, storageRef: dataset.storageRef, commit: null }, { key: 'dataset', scope }), 'dataset');

  // The coder asks for analysis; Julius grants a Python execution.
  const v1 = succeeded(await python.execute(flowRequest({
    executionId: 'exec-coder-v1', requestedBy: CODER, taskId: 'task-analysis', purpose: 'Measure latency against the budget',
    source: CODER_V1, dataset, readKinds: ['OBJECTIVE', 'REQUIREMENT', 'CONSTRAINT', 'RESEARCH'], now: deps.clock.now(),
  })), 'coder_v1');
  const coderEvidence = (await coder.entities({ kinds: ['EVIDENCE'] })).find((state) => state.provenance.executionId === v1.executionId)!.entityId;
  const wrongDecision = must(await coder.create('DECISION', { decisionClass: 'IMPLEMENTATION', statement: 'No regression: mean latency is within budget', rationale: 'The Python measurement of the mean is under 6 ms', alternatives: [], status: 'ACTIVE' }, { key: 'decision-no-regression', scope, links: [juliusLink('EVIDENCED_BY', coderEvidence)] }), 'decision-v1');
  must(await coder.create('HANDOFF', { handoffClass: 'CODER_TO_REVIEWER', fromRole: 'CODING_AGENT', toRole: 'INDEPENDENT_REVIEWER', summary: 'Latency is within budget; please verify', openQuestions: [] }, { key: 'handoff-review', scope }), 'handoff-review');

  // The reviewer checks independently, with its own execution.
  const check = succeeded(await python.execute(flowRequest({
    executionId: 'exec-reviewer-check', requestedBy: REVIEWER, taskId: 'task-review', purpose: 'Independently check the latency claim',
    source: REVIEWER_CHECK, dataset, readKinds: ['REQUIREMENT', 'EVIDENCE'], now: deps.clock.now(),
  })), 'reviewer_check');
  const reviewerEvidence = (await reviewer.entities({ kinds: ['EVIDENCE'] })).find((state) => state.provenance.executionId === check.executionId)!.entityId;
  const finding = must(await reviewer.create('FINDING', { findingClass: 'DEFECT', severity: 'HIGH', statement: 'The mean masks a regression in recent traffic: tail p95 exceeds the budget', blocking: true, status: 'OPEN', juliusFindingId: null }, { key: 'finding-mean-masks', scope, links: [juliusLink('EVIDENCED_BY', reviewerEvidence)] }), 'finding');

  // Julius requests a repair.
  const repairBody = (patch: Record<string, unknown>) => ({ reason: 'Analyse by window and locate the regression', status: 'REQUESTED', implementation: null, verification: 'NOT_RUN', reviewerDisposition: null, resultingState: null, juliusRepairId: null, ...patch });
  const repair = must(await julius.create('REPAIR', repairBody({}), { key: 'repair-windowed', scope, links: [juliusLink('REPAIRS', finding)] }), 'repair');
  must(await julius.create('HANDOFF', { handoffClass: 'REPAIR_GUIDANCE', fromRole: 'JULIUS', toRole: 'CODING_AGENT', summary: 'Use a windowed p95, per the research', openQuestions: [] }, { key: 'handoff-repair', scope }), 'handoff-repair');
  const fixed = succeeded(await python.execute(flowRequest({
    executionId: 'exec-coder-repair', requestedBy: CODER, taskId: 'task-repair', purpose: 'Locate the regression by window',
    source: CODER_REPAIR, dataset, readKinds: ['REQUIREMENT', 'RESEARCH'], now: deps.clock.now(),
  })), 'coder_repair');
  must(await coder.revise(repair, repairBody({ status: 'IMPLEMENTED', implementation: `windowed p95 (execution ${fixed.executionId})` }), { key: 'repair-implemented', expectedVersion: 1 }), 'repair-implemented');
  const located = (await coder.entities({ kinds: ['EVIDENCE'] })).find((state) => state.provenance.executionId === fixed.executionId && state.body.evidenceClass === 'MEASUREMENT')!;

  // The reviewer verifies the repaired evidence and accepts the repair.
  must(await reviewer.revise(located.entityId, { ...located.body, verification: 'VERIFIED' }, { key: 'located-verified', expectedVersion: located.version }), 'verify');
  must(await reviewer.revise(repair, repairBody({ status: 'IMPLEMENTED', implementation: `windowed p95 (execution ${fixed.executionId})`, verification: 'PASSED', reviewerDisposition: 'ACCEPTED' }), { key: 'repair-reviewed', expectedVersion: 2 }), 'repair-reviewed');

  // Julius resolves, supersedes the wrong conclusion, completes and checkpoints.
  must(await julius.revise(repair, repairBody({ status: 'VERIFIED', implementation: `windowed p95 (execution ${fixed.executionId})`, verification: 'PASSED', reviewerDisposition: 'ACCEPTED', resultingState: `regression located at sample ${String((fixed.outcome!.structured.value as Record<string, unknown>).change_point)}` }), { key: 'repair-verified', expectedVersion: 3 }), 'repair-verified');
  must(await julius.revise(finding, { findingClass: 'DEFECT', severity: 'HIGH', statement: 'The mean masks a regression in recent traffic: tail p95 exceeds the budget', blocking: true, status: 'RESOLVED', juliusFindingId: null }, { key: 'finding-resolved', expectedVersion: 1, links: [juliusLink('EVIDENCED_BY', reviewerEvidence), juliusLink('RESOLVES', repair)] }), 'finding-resolved');
  const rightDecision = must(await julius.supersede(wrongDecision, 1, { decisionClass: 'MISSION', statement: `Latency regressed from sample ${String((fixed.outcome!.structured.value as Record<string, unknown>).change_point)}; the budget is breached`, rationale: 'The windowed p95, independently contradicted then repaired and verified, locates the regression', alternatives: [{ option: 'Accept the mean-based conclusion', reasonRejected: 'The reviewer showed it masks the tail' }], status: 'ACTIVE' }, { key: 'decision-regressed', links: [juliusLink('EVIDENCED_BY', located.entityId)] }), 'supersede');
  must(await julius.revise(mission, { missionId, title: 'Find the latency regression', status: 'COMPLETED', missionContract: { missionId, revision: 1, canonicalHash: null }, parentProjectId: projectId }, { key: 'mission-completed', expectedVersion: 1 }), 'mission-completed');
  must(await julius.create('MISSION_STATE', { phase: 'COMPLETED', activeTaskIds: [], dependencies: [], waitingOn: [], humanBoundaries: [], repairRound: 1, retryState: {}, budget: { spentUsdMicros: 0, limitUsdMicros: null } }, { key: 'state-completed', scope }), 'state');
  must(await julius.checkpoint('mission-completed'), 'checkpoint');
  return { datasetArtifact, coderEvidence, reviewerEvidence, finding, repair, wrongDecision, rightDecision, executions: [v1.executionId, check.executionId, fixed.executionId] };
}

export interface BrainPythonFlowSummary {
  readonly records: number;
  readonly entities: number;
  readonly head: number;
  readonly resume: string;
  readonly checkpointMatches: boolean;
  readonly executions: readonly { readonly executionId: string; readonly state: string; readonly admitted: number; readonly scriptHash: string; readonly brainScriptHash: unknown; readonly brainState: unknown }[];
  readonly finding: { readonly status: unknown; readonly inbound: readonly string[] } | null;
  readonly decisions: { readonly superseded: number; readonly active: readonly string[] };
  readonly contradicted: readonly string[];
  readonly verifiedEvidence: number;
  readonly artifacts: readonly { readonly name: string; readonly resolution: string }[];
  readonly provenance: readonly string[];
  readonly mission: unknown;
  readonly exportRedactions: number;
  readonly recordDigest: string;
}

export async function summariseBrainPythonFlow(deps: { brains: JuliusBrainStore; executions: JuliusPythonExecutionStore; content: JuliusBrainContentStore }, executionIds: readonly string[]): Promise<BrainPythonFlowSummary> {
  const { brainId, projectId } = FLOW;
  const records = await readAllJuliusBrainRecords(deps.brains, brainId, projectId);
  const entities = await readAllJuliusBrainEntities(deps.brains, brainId, projectId);
  const resume = await resumeJuliusBrain(deps.brains, brainId, projectId);
  const byId = new Map(entities.map((state) => [state.entityId, state]));
  const executions = [];
  for (const executionId of executionIds) {
    const record = await deps.executions.load(executionId, projectId);
    const brainRecord = byId.get(`python-execution:${executionId}`);
    executions.push({
      executionId, state: record?.state ?? 'MISSING', admitted: record?.outcome?.proposals.admitted ?? -1, scriptHash: record?.scriptHash ?? 'MISSING',
      brainScriptHash: brainRecord?.body.scriptHash ?? null, brainState: brainRecord?.body.state ?? null,
    });
  }
  const finding = entities.find((state) => state.kind === 'FINDING') ?? null;
  const decisions = entities.filter((state) => state.kind === 'DECISION');
  const artifacts = [];
  for (const state of entities.filter((candidate) => candidate.kind === 'ARTIFACT')) {
    artifacts.push({ name: String(state.body.name), resolution: (await deps.content.resolve(String(state.body.storageRef), String(state.body.contentHash))).status });
  }
  // Walk the final decision's evidence back to the execution that produced it.
  const provenance: string[] = [];
  const active = decisions.find((state) => state.lifecycle === 'ACTIVE' && state.body.decisionClass === 'MISSION');
  let cursor = active === undefined ? undefined : byId.get(active.links.find((link) => link.relation === 'EVIDENCED_BY')?.target ?? '');
  for (let depth = 0; cursor !== undefined && depth < 6; depth += 1) {
    provenance.push(`${cursor.kind}:${cursor.createdBy.kind}`);
    const produced = cursor.links.find((link) => link.relation === 'PRODUCED_BY' || link.relation === 'DERIVED_FROM');
    cursor = produced === undefined ? undefined : byId.get(produced.target);
  }
  const bundle = await exportJuliusBrain({ store: deps.brains, brainId, projectId, exportedBy: JULIUS, exportedAt: '2026-09-13T00:00:00.000Z' });
  return {
    records: records.length, entities: entities.length, head: resume.head?.sequence ?? 0, resume: resume.status,
    checkpointMatches: resume.lastCheckpoint?.matches ?? false,
    executions,
    finding: finding === null ? null : { status: finding.body.status, inbound: finding.inbound.map((edge) => `${edge.relation}<-${edge.sourceKind}`) },
    decisions: { superseded: decisions.filter((state) => state.lifecycle === 'SUPERSEDED').length, active: decisions.filter((state) => state.lifecycle === 'ACTIVE').map((state) => String(state.body.statement)) },
    contradicted: entities.filter((state) => state.inbound.some((edge) => edge.relation === 'CONTRADICTS')).map((state) => state.entityId),
    verifiedEvidence: entities.filter((state) => state.kind === 'EVIDENCE' && state.body.verification === 'VERIFIED').length,
    artifacts: artifacts.sort((a, b) => a.name.localeCompare(b.name)),
    provenance,
    mission: byId.get('mission:latency-regression')?.body.status ?? null,
    exportRedactions: bundle?.redaction.applied ?? -1,
    recordDigest: `sha256:${createHash('sha256').update(records.map((record) => `${record.sequence}:${record.recordId}:${record.chainHash}`).join('\n')).digest('hex')}`,
  };
}
