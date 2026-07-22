import type { Provenance } from '../protocol/enums';
import type { RelayMode } from './modes';
import type { RelayEntitlement } from './entitlement';
import type { DogState } from './dog';

/**
 * Live Terminal read model (Prompt 8.2) — PURE, browser-safe. A SERIALIZABLE
 * projection over the EXISTING normalized event stream + mission/mode/dog/
 * reviewer state — never a second event store and never a fake conversation
 * transcript. Hidden reasoning is omitted ("Private reasoning omitted.");
 * secrets/tokens/system prompts are redacted. This is the source both the
 * CLI and the graphical Live Terminal render.
 */

export type ConnectionState = 'LIVE' | 'RECONNECTING' | 'OFFLINE';
export type TerminalProvenanceLabel = 'SIMULATED' | 'LIVE LOCAL' | 'LIVE PROVIDER';

export interface RelayTerminalEvent {
  eventId: string;
  sequence: number;
  timestamp: string;
  source: string;
  sourceRole: 'relay' | 'architect' | 'coding-agent' | 'reviewer' | 'verification' | 'system' | 'user';
  eventKind: string;
  headline: string;
  safeSummary: string;
  status: string | null;
  provenance: Provenance;
  enforcement: string | null;
  taskId: string | null;
  attempt: number | null;
  sessionRef: string | null;
  expandable: boolean;
  detailReference: string | null;
  severity: 'info' | 'warning' | 'blocking' | null;
  omittedPrivateReasoning: boolean;
  redactionsApplied: number;
}

export interface RelayTerminalReadModel {
  runId: string;
  projectId: string;
  missionId: string;
  status: string;
  phase: string;
  mode: RelayMode;
  entitlement: RelayEntitlement;
  provenance: TerminalProvenanceLabel;
  connectionState: ConnectionState;
  dogState: DogState;
  activeRoles: string[];
  reviewerAvailable: boolean;
  reviewerRequired: boolean;
  outputVisibility: string;
  lastSequence: number;
  events: RelayTerminalEvent[];
  unreadEventCount: number;
  manualTaskActive: boolean;
  checkpointActive: boolean;
  startedAt: string;
  updatedAt: string;
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{8,}/g, /AKIA[0-9A-Z]{12,}/g, /BEGIN [A-Z ]*PRIVATE KEY/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g, /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/g,
  /\b(?:api[-_]?key|secret|password|token|cookie)\s*[:=]\s*\S{6,}/gi,
];
const PRIVATE_REASONING = /\b(chain[_ ]?of[_ ]?thought|thinking|internal[_ ]?monologue|scratchpad|hidden[_ ]?reasoning|system[_ ]?prompt)\b/i;

export function redactTerminalText(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, () => { redactions += 1; return '[redacted]'; });
  return { text: out, redactions };
}

const ROLE_OF = (source: string): RelayTerminalEvent['sourceRole'] => {
  if (['relay-core', 'system', 'user', 'architect', 'coding-agent', 'reviewer', 'verification'].includes(source)) {
    return source === 'relay-core' ? 'relay' : (source as RelayTerminalEvent['sourceRole']);
  }
  return 'relay';
};

const HEADLINE: Record<string, string> = {
  'architect.started': 'Objective received', 'architect.blueprint_created': 'Blueprint created',
  'architect.blueprint_accepted': 'Blueprint accepted', 'handoff.created': 'Handoff compiled',
  'handoff.dispatched': 'Responsibility contract delivered', 'agent.session_started': 'Session started',
  'agent.session_resumed': 'Session resumed', 'agent.report_created': 'Report returned',
  'reviewer.started': 'Review package received', 'reviewer.verdict_created': 'Review verdict',
  'verification.started': 'Verification started', 'verification.completed': 'Verification completed',
  'verification.check_passed': 'Check passed', 'verification.check_failed': 'Check failed',
  'run.checkpoint_required': 'Relay needs you', 'manual.task_created': 'Manual Task created',
  'audit.report_created': 'Final Audit generated', 'run.completed': 'Mission verified complete',
  'task.created': 'Task created', 'task.assigned': 'Owner assigned',
};

export interface ProjectTerminalEventInput {
  eventId?: string;
  sequence: number;
  at: string;
  source: string;
  kind: string;
  safeSummary: string;
  provenance: Provenance;
  taskId?: string | null;
  classification?: string;
}

/** Project one ledger event into a safe terminal event. Redacts secrets and
 * omits private reasoning; never fabricates. */
export function projectTerminalEvent(e: ProjectTerminalEventInput): RelayTerminalEvent {
  const clean = redactTerminalText(e.safeSummary);
  const omitted = PRIVATE_REASONING.test(e.safeSummary);
  const severity: RelayTerminalEvent['severity'] =
    e.kind.includes('failed') || e.kind === 'run.checkpoint_required' ? 'warning'
      : e.kind === 'reviewer.verdict_created' ? 'blocking' : 'info';
  return {
    eventId: e.eventId ?? `evt_${e.sequence}`,
    sequence: e.sequence, timestamp: e.at, source: e.source, sourceRole: ROLE_OF(e.source),
    eventKind: e.kind, headline: HEADLINE[e.kind] ?? e.kind,
    safeSummary: omitted ? 'Private reasoning omitted.' : clean.text,
    status: e.classification ?? null, provenance: e.provenance, enforcement: null,
    taskId: e.taskId ?? null, attempt: null, sessionRef: null,
    expandable: false, detailReference: null, severity,
    omittedPrivateReasoning: omitted, redactionsApplied: clean.redactions,
  };
}

/* --------------------- deterministic in-process transport ----------- */

/** A provider-neutral, in-process event subscription. Production network
 * streaming (WebSocket) is NOT implemented — this local transport delivers
 * history + new events with monotonic ordering, duplicate suppression, gap
 * detection, and recovery from the last confirmed sequence. It never
 * fabricates events. */
export function createInProcessTerminalStream(all: readonly ProjectTerminalEventInput[]) {
  const sorted = [...all].sort((a, b) => a.sequence - b.sequence);
  let connection: ConnectionState = 'OFFLINE';

  return {
    connect(): void { connection = 'LIVE'; },
    disconnect(): void { connection = 'OFFLINE'; },
    reconnect(): void { connection = 'RECONNECTING'; },
    get connectionState(): ConnectionState { return connection; },

    /** Load safe events since a sequence, deduped + gap-checked. */
    loadSince(sinceSequence: number): { events: RelayTerminalEvent[]; gapDetected: boolean; lastSequence: number } {
      const slice = sorted.filter((e) => e.sequence > sinceSequence);
      const events: RelayTerminalEvent[] = [];
      const seen = new Set<number>();
      let gapDetected = false;
      let expected = sinceSequence + 1;
      for (const e of slice) {
        if (seen.has(e.sequence)) continue; // duplicate suppression
        seen.add(e.sequence);
        if (e.sequence > expected) gapDetected = true; // sequence gap
        expected = e.sequence + 1;
        events.push(projectTerminalEvent(e));
      }
      return { events, gapDetected, lastSequence: events.at(-1)?.sequence ?? sinceSequence };
    },
  };
}

export type TerminalStream = ReturnType<typeof createInProcessTerminalStream>;

/* --------------------- visible agent exchanges ---------------------- */

export interface AgentExchange {
  from: string;
  to: string;
  title: string;
  lines: string[];
}

/** The visible form of real Handoff Packages, Reports, Findings, Revision
 * Contracts, and Relay decisions — NOT free-form agent chat, NEVER secrets
 * or hidden reasoning. */
export function buildAgentExchanges(input: {
  objective: string; changedFiles: string[]; requiredProof: string[];
  findingTitle: string | null; repairAction: string | null;
}): AgentExchange[] {
  const ex: AgentExchange[] = [
    {
      from: 'ARCHITECT', to: 'CODING AGENT', title: 'Responsibility contract delivered.',
      lines: ['Objective:', `  ${input.objective}`, 'Files:', ...input.changedFiles.map((f) => `  - ${f}`),
        'Required proof:', ...input.requiredProof.map((p) => `  - ${p}`)],
    },
    {
      from: 'CODING AGENT', to: 'RELAY', title: 'Implementation report received.',
      lines: ['Claim:', '  The change was implemented.', 'Status:', '  Ready for Relay verification.'],
    },
    {
      from: 'RELAY', to: 'REVIEWER', title: 'Independent review package delivered.',
      lines: ['Includes:', '  - Mission objective', '  - Actual diff', '  - Changed files',
        '  - Verification evidence', '  - Security rubric'],
    },
  ];
  if (input.findingTitle) {
    ex.push({ from: 'REVIEWER', to: 'RELAY', title: 'Blocking finding:', lines: [`  ${input.findingTitle}`] });
    ex.push({
      from: 'RELAY', to: 'CODING AGENT', title: 'Focused repair delivered.',
      lines: ['Required repair:', `  ${input.repairAction ?? 'Apply the focused correction.'}`,
        'Do not expand:', '  - Objective', '  - File claims', '  - Permissions'],
    });
  }
  return ex;
}
