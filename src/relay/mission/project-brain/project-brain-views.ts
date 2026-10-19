import type { JuliusBrainEntry } from '../julius/julius-runtime';
import {
  PROJECT_BRAIN_LIVE_STATUSES,
  type ProjectBrainRecordDomain,
} from './project-brain';
import type { PbRecordRow, ProjectBrainDocument, ProjectBrainItem, ProjectBrainSection } from './project-brain-document';

/**
 * THE THREE WAYS THE ONE PROJECT BRAIN IS READ.
 *
 *   1. **By Julius**, during a mission: `projectBrainContextEntries` turns what a
 *      person stated into context entries Julius's own compiler ranks. They enter
 *      as `OBJECTIVE`-kind entries, which `julius-context-provenance.ts` qualifies
 *      as `user_stated`, `UNVERIFIED`, `INSTRUCTION` -- exactly what they are. A
 *      proposed requirement can never outrank the locked contract, a verification
 *      decision or a reviewer's cited finding.
 *   2. **By Wonderland's existing panel**: `projectWonderlandBrainView` fills the
 *      panel's own twenty-nine surfaces, by the ids the panel already draws, from
 *      the document -- real rows or an honest zero, never a sample line.
 *   3. **By a companion**: `projectBrainCompanionContext` hands over one mission's
 *      terms, open findings and what the project chose to share -- not the whole
 *      Brain, and never anything that would let it redefine the mission.
 *
 * Pure.
 */

/* --------------------------------------------------------- 1. for Julius */

/** Statements that are memory, not working notes. A scratchpad is not yet memory. */
const CONTEXT_DOMAINS: ReadonlySet<ProjectBrainRecordDomain> = new Set<ProjectBrainRecordDomain>([
  'USER_FACT', 'PREFERENCE', 'IDENTITY', 'INSTRUCTION', 'WORKFLOW', 'SHARED_CONTEXT', 'OBJECTIVE_NOTE', 'REQUIREMENT', 'CONSTRAINT',
  'ACCEPTANCE_CRITERION', 'ARCHITECTURE_NOTE', 'DECISION', 'RESEARCH_NOTE', 'MISSION_INPUT', 'MEMORY_REVIEW', 'FINDING_RESPONSE',
  'GOVERNANCE_ACK', 'COMPANION_RESULT',
]);
const PROPOSAL_DOMAINS: ReadonlySet<ProjectBrainRecordDomain> = new Set<ProjectBrainRecordDomain>([
  'OBJECTIVE_NOTE', 'REQUIREMENT', 'CONSTRAINT', 'ACCEPTANCE_CRITERION', 'ARCHITECTURE_NOTE', 'COMPANION_RESULT',
]);

export const PROJECT_BRAIN_CONTEXT_LIMIT = 40;
const CONTEXT_TEXT_MAX = 800;

/** The context entry id for one version of one record: a revision is a different entry. */
export const projectBrainContextEntryId = (record: Pick<PbRecordRow, 'recordId' | 'version'>): string => `${record.recordId}@v${record.version}`;

/**
 * WHAT A PERSON TOLD THE PROJECT BRAIN, AS JULIUS READS IT. Only records in this
 * project, either project-wide or scoped to THIS run, only live statuses, newest
 * first, capped. The scope filter is applied by the store's query and again here,
 * so a record from another mission cannot reach a packet by any path.
 */
export function projectBrainContextEntries(records: readonly PbRecordRow[], runId: string): readonly JuliusBrainEntry[] {
  return records
    .filter((record) => record.scope === 'PROJECT' || record.runId === runId)
    .filter((record) => CONTEXT_DOMAINS.has(record.domain) && PROJECT_BRAIN_LIVE_STATUSES.includes(record.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.recordId.localeCompare(b.recordId))
    .slice(0, PROJECT_BRAIN_CONTEXT_LIMIT)
    .map((record) => {
      const proposal = PROPOSAL_DOMAINS.has(record.domain) && record.status === 'PROPOSED'
        ? ' [a proposal, not a term of the contract]' : '';
      const subject = record.subjectRef === null ? '' : ` about ${record.subjectRef}`;
      const body = record.body === '' ? '' : ` — ${record.body}`;
      const text = `PROJECT BRAIN ${record.domain} ${record.status}${subject}, stated by ${record.author.kind} ${record.author.id} (v${record.version})${proposal}: ${record.title}${body}`;
      return {
        entryId: projectBrainContextEntryId(record),
        // `OBJECTIVE` is the kind Julius qualifies as user_stated / UNVERIFIED /
        // INSTRUCTION. A person's statement is exactly that, whatever its domain.
        kind: 'OBJECTIVE' as const,
        text: text.length > CONTEXT_TEXT_MAX ? `${text.slice(0, CONTEXT_TEXT_MAX)}…` : text,
        taskIds: [],
        allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const,
        sensitivity: 'INTERNAL' as const,
        provenance: {
          workerId: `project-brain:${record.author.kind}:${record.author.id}`,
          recordedAt: record.updatedAt,
          evidenceIds: [],
        },
      };
    });
}

/* ------------------------------------------------------ 2. for Wonderland */

export const WONDERLAND_PROJECT_BRAIN_SCHEMA_V1 = 'relay-wonderland-project-brain.v1' as const;

export type WonderlandBrainAccess = 'YOURS' | 'REVIEW' | 'SYSTEM';

export interface WonderlandBrainSurfaceEntry {
  readonly ref: string;
  readonly line: string;
  readonly status: string | null;
  readonly version: number | null;
  readonly author: string | null;
  readonly recordedAt: string | null;
  /** True on a REVIEW surface: the panel offers ACCEPT / DECLINE for it. */
  readonly reviewable: boolean;
  /** The newest live review of this entry, if a person has given one. */
  readonly review: 'ACCEPTED' | 'DECLINED' | null;
}

export interface WonderlandBrainSurface {
  readonly id: string;
  readonly access: WonderlandBrainAccess;
  /** The record domain a proposal on this surface becomes; null where nothing may be proposed. */
  readonly proposeDomain: ProjectBrainRecordDomain | null;
  /** Every matching item, not only those sent. */
  readonly entryCount: number;
  readonly entries: readonly WonderlandBrainSurfaceEntry[];
  /** Proposals people made here that are saved and still open. */
  readonly proposals: readonly WonderlandBrainSurfaceEntry[];
}

export interface WonderlandProjectBrainView {
  readonly schemaVersion: typeof WONDERLAND_PROJECT_BRAIN_SCHEMA_V1;
  readonly projectId: string;
  readonly observedAt: string;
  readonly cursor: string;
  readonly brainRevision: number;
  readonly missionRef: string | null;
  readonly missionTitle: string | null;
  readonly missionState: string | null;
  readonly sourceLine: string;
  readonly surfaces: readonly WonderlandBrainSurface[];
}

export const WONDERLAND_SURFACE_ENTRY_LIMIT = 12;
const LINE_MAX = 240;

interface SurfaceRule {
  readonly id: string;
  readonly access: WonderlandBrainAccess;
  readonly proposeDomain: ProjectBrainRecordDomain | null;
  readonly select: (doc: ProjectBrainDocument) => readonly ProjectBrainItem[];
}

const inSection = (doc: ProjectBrainDocument, ...sections: ProjectBrainSection[]): ProjectBrainItem[] =>
  sections.flatMap((section) => doc.sections[section]);
const ofKind = (doc: ProjectBrainDocument, section: ProjectBrainSection, ...kinds: string[]): ProjectBrainItem[] =>
  doc.sections[section].filter((value) => kinds.includes(value.kind));
const byRole = (doc: ProjectBrainDocument, role: string): ProjectBrainItem[] => [
  ...doc.sections.governance.filter((value) => value.kind === 'MODEL_TOPOLOGY' && value.attributes.role === role),
  ...PROJECT_BRAIN_ROLE_SECTIONS.flatMap((section) => doc.sections[section]).filter((value) => value.author?.kind === role),
];
const PROJECT_BRAIN_ROLE_SECTIONS: readonly ProjectBrainSection[] = ['architecture', 'handoffs', 'findings', 'evidence', 'research'];

/**
 * THE PANEL'S OWN SURFACES, IN ITS OWN ORDER, with the access each already
 * declares (`WonderlandProjectBrain.cpp`). The mapping is the only design here:
 * which durable rows answer which surface's stated purpose.
 */
export const WONDERLAND_BRAIN_SURFACES: readonly SurfaceRule[] = [
  // 01 MEMORY CORE
  { id: 'user_facts', access: 'YOURS', proposeDomain: 'USER_FACT', select: (doc) => [...ofKind(doc, 'memory', 'USER_FACT'), ...ofKind(doc, 'research', 'RESEARCH_NOTE')] },
  { id: 'learned_facts', access: 'REVIEW', proposeDomain: null, select: (doc) => doc.sections.provenance.filter((value) => value.ref.startsWith('entry:carried:')) },
  { id: 'preferences', access: 'YOURS', proposeDomain: 'PREFERENCE', select: (doc) => ofKind(doc, 'memory', 'PREFERENCE') },
  { id: 'identity', access: 'YOURS', proposeDomain: 'IDENTITY', select: (doc) => ofKind(doc, 'memory', 'IDENTITY') },
  { id: 'session_history', access: 'SYSTEM', proposeDomain: null, select: (doc) => inSection(doc, 'missions') },
  { id: 'past_actions', access: 'SYSTEM', proposeDomain: null, select: (doc) => ofKind(doc, 'trace', 'STATE_TRANSITION') },
  {
    id: 'user_events', access: 'SYSTEM', proposeDomain: null,
    select: (doc) => [
      ...doc.sections.provenance.filter((value) => value.kind.startsWith('MUTATION_') && (value.author?.kind === 'FOUNDER' || value.author?.kind === 'WONDERLAND_PLAYER')),
      ...ofKind(doc, 'governance', 'LIFECYCLE_CONTROL'),
    ],
  },
  { id: 'agent_experiences', access: 'SYSTEM', proposeDomain: null, select: (doc) => [...inSection(doc, 'repairs'), ...doc.sections.trace.filter((value) => /^TRAJECTORY_(RETRY|FALLBACK|RECOVERY|REPAIR)$/u.test(value.kind))] },
  { id: 'instructions', access: 'YOURS', proposeDomain: 'INSTRUCTION', select: (doc) => ofKind(doc, 'memory', 'INSTRUCTION') },
  {
    id: 'prompt_systems', access: 'SYSTEM', proposeDomain: null,
    // The compiled frame each role last received: one line per role, newest.
    select: (doc) => {
      const seen = new Set<unknown>();
      return ofKind(doc, 'handoffs', 'CONTEXT_PACKET').filter((value) => (seen.has(value.attributes.workerRole) ? false : (seen.add(value.attributes.workerRole), true)));
    },
  },
  { id: 'workflows', access: 'YOURS', proposeDomain: 'WORKFLOW', select: (doc) => ofKind(doc, 'memory', 'WORKFLOW') },
  { id: 'skills', access: 'SYSTEM', proposeDomain: null, select: (doc) => ofKind(doc, 'trace', 'SUBAGENT_SUCCEEDED') },
  // 02 PROJECT BRAIN SYSTEMS
  { id: 'scratchpads', access: 'YOURS', proposeDomain: 'SCRATCHPAD', select: (doc) => ofKind(doc, 'memory', 'SCRATCHPAD') },
  { id: 'memory_synthesis', access: 'SYSTEM', proposeDomain: null, select: (doc) => ofKind(doc, 'provenance', 'CLAIM_STANDING') },
  {
    id: 'auto_memories', access: 'REVIEW', proposeDomain: null,
    // What Julius wrote into the Brain itself during a mission and nobody has adopted: its handoffs and research.
    select: (doc) => inSection(doc, 'handoffs', 'research').filter((value) => value.sourceTable === 'julius_brain_entries' && value.author?.kind !== 'SYSTEM'),
  },
  { id: 'context_handoffs', access: 'SYSTEM', proposeDomain: null, select: (doc) => inSection(doc, 'handoffs').filter((value) => value.sourceTable !== 'julius_brain_entries' || value.kind === 'BRAIN_HANDOFF') },
  {
    id: 'agent_state', access: 'SYSTEM', proposeDomain: null,
    select: (doc) => [...inSection(doc, 'missions').filter((value) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(value.status ?? '')), ...ofKind(doc, 'governance', 'MODEL_TOPOLOGY')],
  },
  // 03 LARGE LANGUAGE MODEL COMPONENTS
  { id: 'prompt_architect', access: 'SYSTEM', proposeDomain: null, select: (doc) => byRole(doc, 'PROMPT_ARCHITECT') },
  { id: 'coding_agent', access: 'SYSTEM', proposeDomain: null, select: (doc) => byRole(doc, 'CODING_AGENT') },
  { id: 'independent_reviewer', access: 'SYSTEM', proposeDomain: null, select: (doc) => byRole(doc, 'INDEPENDENT_REVIEWER') },
  { id: 'shared_context', access: 'YOURS', proposeDomain: 'SHARED_CONTEXT', select: (doc) => inSection(doc, 'companions') },
  // 04 MISSION CONTEXT
  { id: 'objective', access: 'SYSTEM', proposeDomain: null, select: (doc) => inSection(doc, 'objective') },
  { id: 'requirements', access: 'YOURS', proposeDomain: 'REQUIREMENT', select: (doc) => inSection(doc, 'requirements', 'acceptanceCriteria') },
  { id: 'constraints', access: 'YOURS', proposeDomain: 'CONSTRAINT', select: (doc) => inSection(doc, 'constraints') },
  { id: 'decisions', access: 'SYSTEM', proposeDomain: null, select: (doc) => inSection(doc, 'decisions', 'architecture') },
  { id: 'evidence', access: 'SYSTEM', proposeDomain: null, select: (doc) => inSection(doc, 'evidence') },
  { id: 'evaluations', access: 'SYSTEM', proposeDomain: null, select: (doc) => inSection(doc, 'evals', 'findings') },
  { id: 'trace', access: 'SYSTEM', proposeDomain: null, select: (doc) => inSection(doc, 'trace') },
  { id: 'governance', access: 'SYSTEM', proposeDomain: null, select: (doc) => inSection(doc, 'governance') },
];

/** Surface id -> the record domain a proposal there becomes. The server's table; a client cannot pick another. */
export const wonderlandProposeDomainFor = (surfaceId: string): ProjectBrainRecordDomain | null =>
  WONDERLAND_BRAIN_SURFACES.find((surface) => surface.id === surfaceId)?.proposeDomain ?? null;
export const wonderlandSurfaceIsReviewable = (surfaceId: string): boolean =>
  WONDERLAND_BRAIN_SURFACES.find((surface) => surface.id === surfaceId)?.access === 'REVIEW';

const lineOf = (value: ProjectBrainItem): string => {
  const detail = value.text.split('\n')[0]?.trim() ?? '';
  const line = detail === '' || detail === value.title ? value.title : `${value.title}: ${detail}`;
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX)}…` : line;
};

export function projectWonderlandBrainView(doc: ProjectBrainDocument): WonderlandProjectBrainView {
  // The newest live review per subject. MEMORY_REVIEW records name what they review.
  const reviews = new Map<string, 'ACCEPTED' | 'DECLINED'>();
  for (const value of [...doc.sections.provenance].reverse()) {
    if (value.kind !== 'MEMORY_REVIEW' || value.subjectRef === null) continue;
    if (value.status === 'ACCEPTED' || value.status === 'DECLINED') reviews.set(value.subjectRef, value.status);
    else reviews.delete(value.subjectRef);
  }
  const surfaces = WONDERLAND_BRAIN_SURFACES.map((rule): WonderlandBrainSurface => {
    const items = rule.select(doc);
    const isProposal = (value: ProjectBrainItem) => value.source === 'PROJECT_BRAIN' && value.status === 'PROPOSED';
    const shown = (value: ProjectBrainItem): WonderlandBrainSurfaceEntry => ({
      ref: value.ref, line: lineOf(value), status: value.status, version: value.version,
      author: value.author === null ? null : value.author.kind, recordedAt: value.recordedAt,
      reviewable: rule.access === 'REVIEW', review: reviews.get(value.ref) ?? null,
    });
    const live = items.filter((value) => value.status !== 'WITHDRAWN' && value.status !== 'SUPERSEDED');
    return {
      id: rule.id, access: rule.access, proposeDomain: rule.proposeDomain,
      entryCount: live.filter((value) => !isProposal(value)).length,
      entries: live.filter((value) => !isProposal(value)).slice(0, WONDERLAND_SURFACE_ENTRY_LIMIT).map(shown),
      proposals: live.filter(isProposal).slice(0, WONDERLAND_SURFACE_ENTRY_LIMIT).map(shown),
    };
  });
  const mission = doc.missions[0] ?? null;
  return {
    schemaVersion: WONDERLAND_PROJECT_BRAIN_SCHEMA_V1,
    projectId: doc.projectId,
    observedAt: doc.observedAt,
    cursor: doc.cursor,
    brainRevision: doc.revision,
    missionRef: mission?.ref ?? null,
    missionTitle: mission?.objective ?? null,
    missionState: mission?.state ?? null,
    sourceLine: `PROJECT BRAIN · LIVE · ${doc.projectId} · REVISION ${doc.revision}`,
    surfaces,
  };
}

/* ------------------------------------------------------- 3. for a companion */

export const PROJECT_BRAIN_COMPANION_CONTEXT_SCHEMA_V1 = 'relay-project-brain-companion-context.v1' as const;

export interface ProjectBrainCompanionContext {
  readonly schemaVersion: typeof PROJECT_BRAIN_COMPANION_CONTEXT_SCHEMA_V1;
  readonly projectId: string;
  readonly runId: string;
  readonly cursor: string;
  /** Who decides. Always Julius: a companion's result is a proposal for Julius to validate. */
  readonly authority: 'julius_decides';
  readonly objective: readonly ProjectBrainItem[];
  readonly requirements: readonly ProjectBrainItem[];
  readonly constraints: readonly ProjectBrainItem[];
  readonly acceptanceCriteria: readonly ProjectBrainItem[];
  readonly openFindings: readonly ProjectBrainItem[];
  readonly sharedContext: readonly ProjectBrainItem[];
}

/**
 * ONE MISSION'S WORKING CONTEXT, AND NOTHING ELSE. The mission filter is exact
 * (its ref), applied before anything else; shared context is the project's own
 * SHARED_CONTEXT records, nothing a person kept to themselves. No governance
 * internals, no provenance, no other mission, no personal memory.
 */
export function projectBrainCompanionContext(doc: ProjectBrainDocument, runId: string): ProjectBrainCompanionContext | null {
  const mission = doc.missions.find((value) => value.runId === runId);
  if (mission === undefined) return null;
  const forMission = (section: ProjectBrainSection) => doc.sections[section].filter((value) => value.missionRef === mission.ref
    && value.status !== 'WITHDRAWN' && value.status !== 'SUPERSEDED' && value.status !== 'DECLINED');
  return {
    schemaVersion: PROJECT_BRAIN_COMPANION_CONTEXT_SCHEMA_V1,
    projectId: doc.projectId,
    runId,
    cursor: doc.cursor,
    authority: 'julius_decides',
    objective: forMission('objective'),
    requirements: forMission('requirements'),
    constraints: forMission('constraints'),
    acceptanceCriteria: forMission('acceptanceCriteria'),
    openFindings: forMission('findings').filter((value) => value.kind === 'REVIEWER_FINDING' && value.status === 'OPEN'),
    sharedContext: doc.sections.companions.filter((value) => value.kind === 'SHARED_CONTEXT' && value.scope === 'PROJECT'
      && value.status !== 'WITHDRAWN' && value.status !== 'SUPERSEDED'),
  };
}
