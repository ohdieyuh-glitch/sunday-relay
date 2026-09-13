import {
  JULIUS_BRAIN_KIND_SECTION,
  canonicalJuliusBrainJson,
  juliusBrainSha256,
  type JuliusBrainRecordKind,
  type JuliusBrainSection,
} from './julius-brain-contracts';
import { juliusBrainReadable, type JuliusBrainReadGrant } from './julius-brain-policy';
import type { JuliusBrainEntityState, JuliusBrainLifecycle } from './julius-brain-projection';
import type { JuliusBrainEntry, JuliusWorkerRole } from './julius-runtime';

/**
 * RELEVANT CONTEXT WITHOUT DUMPING THE BRAIN.
 *
 * STRUCTURED, DETERMINISTIC, EXPLAINED. When the state a worker needs has a
 * known type and scope — the mission's objective, its active requirements, the
 * open blocking findings, the repair in progress, this task's evidence — it is
 * retrieved by that type and scope, not by similarity. Every admitted item says
 * WHY it was admitted, and every item that did not fit is COUNTED by reason, so
 * a packet can never present itself as the whole truth when it is a prefix.
 *
 * TIERS, in admission order:
 *   FOCUS              entities the caller named (any lifecycle; history is context)
 *   MISSION_AUTHORITY  mission, objective, ACTIVE requirements/criteria/constraints/prohibitions
 *   OPEN_FINDING       open findings, blocking and severe first
 *   ACTIVE_REPAIR      repairs not yet verified, rejected or abandoned
 *   TASK_SCOPE         anything scoped to this task
 *   DECISION           active decisions, newest first
 *   OPEN_QUESTION      open questions and open assumptions
 *   HANDOFF            handoffs addressed to this role, newest first
 *   ARCHITECTURE       components and interfaces
 *   EVIDENCE           evidence and evals, newest first
 *   MEMORY             memory facts, trusted first; expired working memory never
 *
 * Superseded and retired entities never enter except by FOCUS. Traces,
 * checkpoints and execution records are history, not context.
 *
 * A budget that cannot hold every MISSION_AUTHORITY item marks the view
 * `authorityTruncated`, so a caller can fail closed rather than dispatch a
 * worker that cannot see its own mission's constraints.
 *
 * Semantic retrieval is `julius-brain-retrieval.ts`: an optional fuzzy tier
 * that must earn its place against this baseline in an eval.
 */

export const JULIUS_BRAIN_CONTEXT_REASONS = [
  'FOCUS', 'MISSION_AUTHORITY', 'OPEN_FINDING', 'ACTIVE_REPAIR', 'TASK_SCOPE', 'DECISION',
  'OPEN_QUESTION', 'HANDOFF', 'ARCHITECTURE', 'EVIDENCE', 'MEMORY', 'SEMANTIC',
] as const;
export type JuliusBrainContextReason = typeof JULIUS_BRAIN_CONTEXT_REASONS[number];

export const JULIUS_BRAIN_CONTEXT_COMPILER_VERSION = 'julius-brain-context.v1' as const;

export interface JuliusBrainContextRequest {
  readonly missionId: string;
  readonly taskId: string | null;
  readonly role: JuliusWorkerRole | 'JULIUS';
  readonly grant: JuliusBrainReadGrant;
  readonly focusEntityIds?: readonly string[];
  /** Entities a semantic retriever proposed, in its rank order. Admitted last. */
  readonly semanticEntityIds?: readonly string[];
  readonly budgetCharacters: number;
  readonly asOf: string;
  /** Per-tier ceilings for the unbounded tiers. */
  readonly maxEvidence?: number;
  readonly maxHandoffs?: number;
}

export interface JuliusBrainContextItem {
  readonly entityId: string;
  readonly kind: JuliusBrainRecordKind;
  readonly section: JuliusBrainSection;
  readonly version: number;
  readonly lifecycle: JuliusBrainLifecycle;
  readonly reason: JuliusBrainContextReason;
  readonly text: string;
  readonly contradictedBy: readonly string[];
}

export interface JuliusBrainContextView {
  readonly compilerVersion: typeof JULIUS_BRAIN_CONTEXT_COMPILER_VERSION;
  readonly missionId: string;
  readonly taskId: string | null;
  readonly role: string;
  /** The newest Brain sequence any considered entity reflects. */
  readonly throughSequence: number;
  readonly items: readonly JuliusBrainContextItem[];
  readonly omitted: { readonly count: number; readonly byReason: Readonly<Partial<Record<JuliusBrainContextReason, number>>>; readonly entityIds: readonly string[] };
  readonly conflicts: readonly { readonly entityId: string; readonly contradictedBy: readonly string[] }[];
  readonly authorityTruncated: boolean;
  readonly characters: number;
  readonly budgetCharacters: number;
  readonly contextHash: string;
}

const TERMINAL_MISSION = ['COMPLETED', 'FAILED', 'CANCELLED'];
const OPEN_REPAIR = ['REQUESTED', 'IN_PROGRESS', 'IMPLEMENTED'];
const SEVERITY: Readonly<Record<string, number>> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const TRUST: Readonly<Record<string, number>> = { APPROVED: 0, VERIFIED: 1, SUPPORTED: 2, UNVERIFIED: 3 };
const HISTORY_ONLY: readonly JuliusBrainRecordKind[] = ['TRACE', 'CHECKPOINT', 'PYTHON_EXECUTION', 'MISSION_STATE'];

const clip = (text: string, max = 600): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const str = (value: unknown): string => (value === null || value === undefined ? 'Unknown' : String(value));

/** One compact, self-describing line per entity. Unknown values say Unknown. */
export function renderJuliusBrainEntity(state: JuliusBrainEntityState): string {
  const b = state.body;
  const head = `[${state.kind} ${state.entityId} v${state.version}${state.lifecycle === 'ACTIVE' ? '' : ` ${state.lifecycle}`}]`;
  const confidence = state.confidence === null ? '' : ` (confidence ${state.confidence})`;
  switch (state.kind) {
    case 'MISSION': return `${head} ${str(b.title)} — status ${str(b.status)}`;
    case 'OBJECTIVE': return `${head} ${clip(str(b.statement))}${b.successMeasure === null ? '' : ` — success: ${clip(str(b.successMeasure), 200)}`}`;
    case 'REQUIREMENT': return `${head} ${str(b.requirementClass)} ${str(b.priority)}: ${clip(str(b.statement))} (${str(b.status)})`;
    case 'ACCEPTANCE_CRITERION': return `${head} ${b.blocking ? 'BLOCKING' : 'non-blocking'}: ${clip(str(b.statement))} (${str(b.status)})`;
    case 'CONSTRAINT': case 'PROHIBITION': case 'ASSUMPTION': return `${head} ${clip(str(b.statement))} (${str(b.status)})`;
    case 'OPEN_QUESTION': return `${head} ${clip(str(b.question))}${b.answer === null ? ' — unanswered' : ` — answer: ${clip(str(b.answer), 300)}`}`;
    case 'ARCHITECTURE_COMPONENT': return `${head} ${str(b.name)}: ${clip(str(b.responsibility), 300)}`;
    case 'ARCHITECTURE_INTERFACE': return `${head} ${str(b.name)} provided by ${str(b.providedBy)}: ${clip(str(b.contract), 300)}`;
    case 'DECISION': return `${head} ${str(b.decisionClass)}: ${clip(str(b.statement), 300)} — because ${clip(str(b.rationale), 300)}`;
    case 'RESEARCH': return `${head} Q: ${clip(str(b.question), 200)} — ${Array.isArray(b.findings) ? b.findings.length : 0} finding(s), ${str(b.status)}${confidence}`;
    case 'EVIDENCE': return `${head} ${str(b.evidenceClass)} ${str(b.status)} ${str(b.verification)}: ${clip(str(b.claim), 300)} — ${clip(str(b.summary), 300)}`;
    case 'EVAL': return `${head} ${str(b.evaluationName)}: ${str(b.outcome)} score ${str(b.score)}/${str(b.maxScore)} by ${str(b.evaluator)}`;
    case 'FINDING': return `${head} ${str(b.severity)} ${b.blocking ? 'BLOCKING ' : ''}${str(b.findingClass)} (${str(b.status)}): ${clip(str(b.statement))}`;
    case 'REPAIR': return `${head} ${str(b.status)}: ${clip(str(b.reason), 300)}; implementation ${b.implementation === null ? 'none yet' : clip(str(b.implementation), 200)}; verification ${str(b.verification)}; reviewer ${str(b.reviewerDisposition)}`;
    case 'HANDOFF': return `${head} ${str(b.fromRole)} → ${str(b.toRole)}: ${clip(str(b.summary))}`;
    case 'ARTIFACT': return `${head} ${str(b.artifactClass)} ${str(b.name)} (${str(b.contentType)}, ${str(b.byteSize)} bytes, ${str(b.contentHash)})`;
    case 'MEMORY_FACT': return `${head} ${str(b.trust)}: ${clip(str(b.statement))}`;
    default: return `${head} ${clip(canonicalJuliusBrainJson(b), 300)}`;
  }
}

export function compileJuliusBrainContext(entities: readonly JuliusBrainEntityState[], request: JuliusBrainContextRequest): JuliusBrainContextView {
  if (!Number.isSafeInteger(request.budgetCharacters) || request.budgetCharacters < 1) throw new Error('julius_brain_context_budget_invalid');
  const asOf = Date.parse(request.asOf);
  const visible = entities.filter((state) => juliusBrainReadable({ grant: request.grant, kind: state.kind, scope: state.scope, sensitivity: state.sensitivity }));
  const byId = new Map(visible.map((state) => [state.entityId, state]));
  const inMission = (state: JuliusBrainEntityState) => state.scope.missionId === null || state.scope.missionId === request.missionId;
  const mission = visible.find((state) => state.kind === 'MISSION' && state.body.missionId === request.missionId && state.lifecycle === 'ACTIVE');
  const missionTerminal = mission !== undefined && TERMINAL_MISSION.includes(String(mission.body.status));
  const live = (state: JuliusBrainEntityState) => {
    if (state.lifecycle !== 'ACTIVE' || !inMission(state) || HISTORY_ONLY.includes(state.kind)) return false;
    if (state.retention === 'WORKING') {
      if (missionTerminal) return false;
      const expires = typeof state.body.expiresAt === 'string' ? Date.parse(state.body.expiresAt) : Number.NaN;
      if (!Number.isNaN(expires) && expires <= asOf) return false;
    }
    return true;
  };
  const activeContradictors = (state: JuliusBrainEntityState) => state.inbound
    .filter((edge) => edge.relation === 'CONTRADICTS' && byId.get(edge.source)?.lifecycle === 'ACTIVE')
    .map((edge) => edge.source);
  const newest = (a: JuliusBrainEntityState, b: JuliusBrainEntityState) => b.updatedSequence - a.updatedSequence;
  const oldest = (a: JuliusBrainEntityState, b: JuliusBrainEntityState) => a.createdSequence - b.createdSequence;

  const tiers: [JuliusBrainContextReason, JuliusBrainEntityState[]][] = [
    ['FOCUS', (request.focusEntityIds ?? []).map((id) => byId.get(id)).filter((state): state is JuliusBrainEntityState => state !== undefined)],
    ['MISSION_AUTHORITY', visible.filter((state) => live(state) && (
      (state.kind === 'MISSION' && state.body.missionId === request.missionId) || state.kind === 'OBJECTIVE'
      || (['REQUIREMENT', 'ACCEPTANCE_CRITERION', 'CONSTRAINT', 'PROHIBITION'].includes(state.kind) && state.body.status === 'ACTIVE'))).sort(oldest)],
    ['OPEN_FINDING', visible.filter((state) => live(state) && state.kind === 'FINDING' && state.body.status === 'OPEN')
      .sort((a, b) => Number(b.body.blocking) - Number(a.body.blocking) || (SEVERITY[String(a.body.severity)] ?? 9) - (SEVERITY[String(b.body.severity)] ?? 9) || oldest(a, b))],
    ['ACTIVE_REPAIR', visible.filter((state) => live(state) && state.kind === 'REPAIR' && OPEN_REPAIR.includes(String(state.body.status))).sort(oldest)],
    ['TASK_SCOPE', request.taskId === null ? [] : visible.filter((state) => live(state) && state.scope.taskId === request.taskId).sort(newest)],
    ['DECISION', visible.filter((state) => live(state) && state.kind === 'DECISION' && state.body.status === 'ACTIVE').sort(newest)],
    ['OPEN_QUESTION', visible.filter((state) => live(state) && ((state.kind === 'OPEN_QUESTION' && state.body.status === 'OPEN') || (state.kind === 'ASSUMPTION' && state.body.status === 'OPEN'))).sort(oldest)],
    ['HANDOFF', visible.filter((state) => live(state) && state.kind === 'HANDOFF' && state.body.toRole === request.role).sort(newest).slice(0, request.maxHandoffs ?? 3)],
    ['ARCHITECTURE', visible.filter((state) => live(state) && (state.kind === 'ARCHITECTURE_COMPONENT' || state.kind === 'ARCHITECTURE_INTERFACE')).sort(oldest)],
    ['EVIDENCE', visible.filter((state) => live(state) && (state.kind === 'EVIDENCE' || state.kind === 'EVAL')).sort(newest).slice(0, request.maxEvidence ?? 12)],
    ['MEMORY', visible.filter((state) => live(state) && state.kind === 'MEMORY_FACT')
      .sort((a, b) => (TRUST[String(a.body.trust)] ?? 9) - (TRUST[String(b.body.trust)] ?? 9) || newest(a, b))],
    ['SEMANTIC', (request.semanticEntityIds ?? []).map((id) => byId.get(id)).filter((state): state is JuliusBrainEntityState => state !== undefined && live(state))],
  ];

  const items: JuliusBrainContextItem[] = [];
  const admitted = new Set<string>();
  const omittedIds: string[] = [];
  const byReason: Partial<Record<JuliusBrainContextReason, number>> = {};
  let characters = 0;
  let authorityTruncated = false;
  for (const [reason, candidates] of tiers) {
    for (const state of candidates) {
      if (admitted.has(state.entityId)) continue;
      const contradictedBy = activeContradictors(state);
      const text = `${contradictedBy.length > 0 ? `[CONTRADICTED by ${contradictedBy.join(', ')}] ` : ''}${renderJuliusBrainEntity(state)}\n`;
      if (characters + text.length > request.budgetCharacters) {
        // SKIP, DO NOT STOP. A large item must not hide every smaller one after
        // it — but the skip is counted, and an authority skip is flagged.
        if (!omittedIds.includes(state.entityId)) omittedIds.push(state.entityId);
        byReason[reason] = (byReason[reason] ?? 0) + 1;
        if (reason === 'MISSION_AUTHORITY' || reason === 'FOCUS') authorityTruncated = true;
        continue;
      }
      admitted.add(state.entityId);
      characters += text.length;
      items.push({ entityId: state.entityId, kind: state.kind, section: JULIUS_BRAIN_KIND_SECTION[state.kind], version: state.version, lifecycle: state.lifecycle, reason, text, contradictedBy });
    }
  }
  const stillOmitted = omittedIds.filter((id) => !admitted.has(id));
  const conflicts = items.filter((item) => item.contradictedBy.length > 0).map((item) => ({ entityId: item.entityId, contradictedBy: item.contradictedBy }));
  const throughSequence = visible.reduce((max, state) => Math.max(max, state.updatedSequence), 0);
  const content = { items: items.map(({ entityId, version, reason, text }) => ({ entityId, version, reason, text })), omitted: stillOmitted, throughSequence, missionId: request.missionId, taskId: request.taskId, role: request.role, compiler: JULIUS_BRAIN_CONTEXT_COMPILER_VERSION };
  return {
    compilerVersion: JULIUS_BRAIN_CONTEXT_COMPILER_VERSION,
    missionId: request.missionId, taskId: request.taskId, role: request.role,
    throughSequence, items,
    omitted: { count: stillOmitted.length, byReason, entityIds: stillOmitted.slice(0, 50) },
    conflicts, authorityTruncated, characters, budgetCharacters: request.budgetCharacters,
    contextHash: juliusBrainSha256(canonicalJuliusBrainJson(content)),
  };
}

/**
 * THE v1 BRIDGE. A compiled v2 view as the entries the existing context
 * compiler (`compileJuliusContext`) consumes, so a worker packet can be fed
 * from typed memory without changing the compiler or its snapshot hash format.
 * The v1 kind vocabulary is narrower; the rendered text carries the true kind.
 */
export function juliusBrainContextAsEntries(view: JuliusBrainContextView, roles: readonly JuliusWorkerRole[]): JuliusBrainEntry[] {
  const kindFor = (kind: JuliusBrainRecordKind): JuliusBrainEntry['kind'] => {
    switch (kind) {
      case 'MISSION': case 'OBJECTIVE': return 'OBJECTIVE';
      case 'REQUIREMENT': case 'ACCEPTANCE_CRITERION': case 'OPEN_QUESTION': case 'ASSUMPTION': return 'REQUIREMENT';
      case 'CONSTRAINT': case 'PROHIBITION': case 'ARCHITECTURE_COMPONENT': case 'ARCHITECTURE_INTERFACE': return 'CONSTRAINT';
      case 'DECISION': return 'DECISION';
      case 'FINDING': return 'FINDING';
      case 'REPAIR': return 'REPAIR';
      case 'HANDOFF': return 'HANDOFF';
      case 'ARTIFACT': return 'ARTIFACT';
      default: return 'EVIDENCE';
    }
  };
  return view.items.map((item) => ({
    entryId: `brain2:${item.entityId}:v${item.version}`,
    kind: kindFor(item.kind),
    text: item.text,
    taskIds: [],
    allowedRoles: [...roles],
    sensitivity: 'INTERNAL',
  }));
}
