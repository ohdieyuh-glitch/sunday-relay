import type { Provenance } from '../protocol/enums';
import type { RelayFinding, RelayRepair, TimelineEntry, TimelineKind } from './contracts';

/**
 * Mission timeline projection (Prompt 8.1) — PURE. Derived from the EXISTING
 * append-only normalized event stream (never a second event store), enriched
 * with requested-vs-actual agent identity, role, provenance, attempt, and
 * mission/task revision. Finding/repair/resolution entries (which are mission
 * projections, not ledger events) are spliced in at their anchoring review
 * event so the ordered history stays attributable. No event is silently
 * removed; a required-but-unlaunched execution is representable as a failure.
 */

export interface TimelineEventInput {
  sequence: number;
  at: string;
  source: string;
  kind: string;
  provenance: Provenance;
  safeSummary: string;
}

export interface TimelineContext {
  missionRevision: number;
  taskRevision: number;
  requestedImplementer: string;
  actualImplementer: string;
  requestedReviewer: string;
  actualReviewer: string;
  findings: readonly RelayFinding[];
  repairs: readonly RelayRepair[];
}

const KIND_MAP: Record<string, TimelineKind> = {
  'run.created': 'mission_requested',
  'run.validated': 'mission_validated',
  'run.started': 'mission_validated',
  'architect.blueprint_accepted': 'mission_revision_locked',
  'task.created': 'task_created',
  'task.assigned': 'task_assigned',
  'task.ownership_changed': 'task_assigned',
  'handoff.created': 'handoff_compiled',
  'handoff.dispatched': 'execution_requested',
  'agent.session_started': 'launch_verified',
  'agent.session_resumed': 'launch_verified',
  'agent.report_created': 'report_received',
  'agent.process_started': 'execution_authorized',
  'agent.initialized': 'launch_verified',
  'agent.process_completed': 'report_received',
  'verification.started': 'verification_started',
  'verification.completed': 'verification_result',
  'reviewer.started': 'review_requested',
  'reviewer.verdict_created': 're_review_completed',
  'audit.report_created': 'completion_evaluated',
  'run.completed': 'mission_verified',
};

const isReviewerEvent = (source: string, kind: string): boolean =>
  source === 'reviewer' || kind.startsWith('reviewer.');
const isImplementerEvent = (source: string, kind: string): boolean =>
  source === 'coding-agent' || kind.startsWith('agent.');

export function buildMissionTimeline(events: readonly TimelineEventInput[], ctx: TimelineContext): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  let attempt = 1;
  let findingsSpliced = false;
  let resolutionsSpliced = false;

  for (const e of events) {
    if (e.kind === 'agent.session_resumed') attempt = 2;
    const kind = KIND_MAP[e.kind] ?? 'other';
    const reviewer = isReviewerEvent(e.source, e.kind);
    const implementer = isImplementerEvent(e.source, e.kind);

    const entry: TimelineEntry = {
      sequence: e.sequence, at: e.at, kind, summary: e.safeSummary,
      requestedAgent: reviewer ? ctx.requestedReviewer : implementer ? ctx.requestedImplementer : null,
      actualAgent: reviewer ? ctx.actualReviewer : implementer ? ctx.actualImplementer : null,
      role: reviewer ? 'reviewer' : implementer ? 'coding-agent' : null,
      provenance: e.provenance,
      attempt: reviewer || implementer ? attempt : null,
      missionRevision: ctx.missionRevision,
      taskRevision: ctx.taskRevision,
      evidenceRefs: [],
    };

    // The first agent report is the completion claim.
    if (e.kind === 'agent.report_created' && attempt === 1 && !out.some((o) => o.kind === 'completion_claimed')) {
      entry.kind = 'completion_claimed';
    }
    out.push(entry);

    // Splice the finding/repair projection entries exactly ONCE, right after
    // the first reviewer verdict event (the reviewer may emit more than one
    // verdict event per attempt — guard on a flag, not a count).
    if (e.kind === 'reviewer.verdict_created' && !findingsSpliced && ctx.findings.length > 0) {
      findingsSpliced = true;
      for (const f of ctx.findings) {
        out.push(makeSynthetic(e, 'finding_created', `Finding ${f.findingId}: ${f.title} (${f.severity}).`, ctx));
      }
      for (const r of ctx.repairs) {
        out.push(makeSynthetic(e, 'repair_created', `Repair ${r.repairId} created for ${r.findingId} — scope locked.`, ctx));
        out.push(makeSynthetic(e, 'repair_assigned', `Repair ${r.repairId} assigned to ${ctx.actualImplementer} (iteration ${r.iteration}).`, ctx));
      }
    }
    // Splice resolutions exactly ONCE, at completion.
    if ((e.kind === 'run.completed' || e.kind === 'audit.report_created') && !resolutionsSpliced) {
      const resolved = ctx.findings.filter((x) => x.status === 'resolved');
      if (resolved.length > 0) {
        resolutionsSpliced = true;
        for (const f of resolved) {
          out.push(makeSynthetic(e, 'finding_resolved', `Finding ${f.findingId} resolved by re-review ${f.resolutionReviewId} with evidence.`, ctx));
        }
      }
    }
  }
  // Reassign monotonic display sequence while preserving order.
  return out.map((entry, i) => ({ ...entry, sequence: i + 1 }));
}

function makeSynthetic(anchor: TimelineEventInput, kind: TimelineKind, summary: string, ctx: TimelineContext): TimelineEntry {
  return {
    sequence: anchor.sequence, at: anchor.at, kind, summary,
    requestedAgent: kind.startsWith('repair') ? ctx.requestedImplementer : null,
    actualAgent: kind.startsWith('repair') ? ctx.actualImplementer : null,
    role: kind.startsWith('repair') ? 'coding-agent' : null,
    provenance: anchor.provenance, attempt: kind.startsWith('repair') ? 2 : null,
    missionRevision: ctx.missionRevision, taskRevision: ctx.taskRevision, evidenceRefs: [],
  };
}
