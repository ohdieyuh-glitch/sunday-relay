/**
 * THE SAFE LIVE TERMINAL PROJECTION — one Julius event becomes one Relay line.
 *
 * ONE MODEL, THREE SURFACES. Relay Web, the Wonderland Live Terminal and any
 * future CLI all render the output of this function. None of them formats a
 * Julius event itself, because three formatters are three places a label, a
 * redaction or a severity can silently disagree.
 *
 * IT NEVER FABRICATES. An event kind this module does not recognise is
 * rendered from the event's own safe summary and marked `recognized: false` —
 * not dropped (a terminal that hides what it cannot label is claiming it
 * showed everything), and not guessed at (a headline invented for an unknown
 * kind is a sentence nothing produced).
 *
 * IT NEVER EXPOSES. Private reasoning is replaced whole rather than redacted,
 * because a redacted chain of thought is still a record that one existed. Raw
 * exception dumps are replaced with a statement that one occurred. Secrets go
 * through Relay's existing redactor plus the boundary set. A fact whose KEY
 * could only hold a secret is dropped rather than shown as `[redacted]`.
 *
 * PURE. No Node, no network, no clock.
 */

import {
  TERMINAL_ROLE_LABELS,
  type JuliusEventActor,
  type JuliusEventFact,
  type JuliusOperationalEvent,
} from './julius-event-port';
import {
  containsPrivateReasoning,
  containsStackTrace,
  factKeyIsSecretShaped,
  redactBoundaryText,
} from './terminal-redaction';

/* --------------------------------------------------------------- bounds */

/** A terminal line is read by a human; anything longer is a payload. */
export const TERMINAL_LINE_MAX = 400;

/** Text substituted for content that must never be rendered. */
export const PRIVATE_REASONING_LINE = 'Private reasoning omitted.';
export const INTERNAL_FAILURE_LINE = 'An internal failure was reported. Details are withheld from the terminal.';
export const UNRECOGNISED_LINE = 'Relay has no projection for this event kind yet.';

/* ---------------------------------------------------------------- output */

export interface RelayTerminalEntry {
  readonly entryId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly runId: string;
  readonly actor: JuliusEventActor;
  /** The permanent role label, e.g. `Coding Agent`. */
  readonly label: string;
  /** The whole rendered line, e.g. `[Coding Agent] Task 17 started`. */
  readonly line: string;
  /** The line without its label, for a surface that renders the label itself. */
  readonly headline: string;
  readonly severity: 'info' | 'warning' | 'blocking';
  readonly taskId: string | null;
  readonly eventKind: string;
  /** False when no projection exists for this kind. Never hidden from callers. */
  readonly recognized: boolean;
  readonly redactionsApplied: number;
  readonly omittedPrivateReasoning: boolean;
  readonly omittedInternalFailure: boolean;
}

/* ------------------------------------------------------------ humanizing */

/**
 * `task_17` becomes `Task 17`, and anything else is left ALONE.
 *
 * The rewrite is deliberately narrow. A general-purpose prettifier applied to
 * an opaque identifier produces a label that looks authoritative and is not —
 * and an id a human never sees is an id they cannot quote back when something
 * goes wrong. So only the one shape Julius actually emits is rewritten, and
 * every other id is rendered verbatim.
 */
export function humanizeTaskReference(taskId: string): string {
  const match = /^task[_-](\d+)$/i.exec(taskId);
  return match === null ? taskId : `Task ${match[1]}`;
}

/**
 * `security-review` becomes `Security review`. Only a plain lower-kebab or
 * lower-snake token is rewritten; anything else is rendered verbatim for the
 * same reason as above.
 */
export function humanizeCapability(capability: string): string {
  if (!/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(capability)) return capability;
  const spaced = capability.replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** `1 blocking finding` / `2 blocking findings`, never `2 blocking finding(s)`. */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/* ------------------------------------------------------------ fact access */

const factString = (facts: Readonly<Record<string, JuliusEventFact>>, key: string): string | null => {
  if (factKeyIsSecretShaped(key)) return null;
  const value = facts[key];
  if (typeof value !== 'string' || value.trim() === '') return null;
  return redactBoundaryText(value).text;
};

const factCount = (facts: Readonly<Record<string, JuliusEventFact>>, key: string): number | null => {
  const value = facts[key];
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
    ? value
    : null;
};

/* --------------------------------------------------------- the projections */

/**
 * ONE HEADLINE PER RECOGNISED KIND.
 *
 * Every entry composes its sentence from `facts`, never by reformatting the
 * event's prose — a projection that reads numbers back out of a sentence
 * breaks the day the sentence changes. When a fact a headline needs is absent,
 * the projection returns `null` and the event falls through to its own safe
 * summary rather than rendering `Task undefined started`.
 */
type Projector = (event: JuliusOperationalEvent) => string | null;

const PROJECTORS: Readonly<Record<string, Projector>> = Object.freeze({
  /* --------------------------------------------------------- lifecycle -- */
  'run.created': () => 'Run created',
  'run.planning': () => 'Planning started',
  'run.ready': () => 'Ready to execute',
  'run.paused': (event) => {
    const reason = factString(event.facts, 'reason');
    return reason === null ? 'Run paused' : `Run paused · ${reason}`;
  },
  'run.resumed': () => 'Run resumed',
  'run.cancelled': (event) => {
    const reason = factString(event.facts, 'reason');
    return reason === null ? 'Run cancelled' : `Run cancelled · ${reason}`;
  },
  'run.completed': () => 'Mission verified complete',
  'run.blocked': (event) => {
    const reason = factString(event.facts, 'reason');
    return reason === null ? 'Run blocked' : `Run blocked · ${reason}`;
  },

  /* ----------------------------------------------------------- workers -- */
  'worker.dispatched': (event) => {
    const task = factString(event.facts, 'task') ?? event.taskId;
    return task === null ? null : `${humanizeTaskReference(task)} started`;
  },
  'worker.succeeded': (event) => {
    const task = factString(event.facts, 'task') ?? event.taskId;
    return task === null ? null : `${humanizeTaskReference(task)} completed`;
  },
  'worker.failed': (event) => {
    const task = factString(event.facts, 'task') ?? event.taskId;
    return task === null ? null : `${humanizeTaskReference(task)} failed`;
  },

  /* ------------------------------------------------------ verification -- */
  'verification.started': () => 'Verification started',
  'verification.passed': () => 'Verification passed',
  'verification.failed': (event) => {
    const blocking = factCount(event.facts, 'blockingFindings');
    return blocking === null
      ? 'Verification failed'
      : `Verification failed · ${pluralize(blocking, 'blocking finding', 'blocking findings')}`;
  },

  /* ------------------------------------------------------------ repair -- */
  'repair.scheduled': (event) => {
    const round = factCount(event.facts, 'round');
    return round === null ? 'Repair scheduled' : `Repair round ${round} scheduled`;
  },
  'repair.completed': (event) => {
    const round = factCount(event.facts, 'round');
    return round === null ? 'Repair completed' : `Repair round ${round} completed`;
  },

  /* --------------------------------------------------------- sub-agent -- */
  'subagent.authorized': (event) => {
    const capability = factString(event.facts, 'capability');
    return capability === null ? 'Sub-agent authorized' : `${humanizeCapability(capability)} started`;
  },
  'subagent.denied': (event) => {
    const reason = factString(event.facts, 'reason');
    return reason === null ? 'Sub-agent request denied' : `Sub-agent request denied · ${reason}`;
  },
  'subagent.completed': (event) => {
    const capability = factString(event.facts, 'capability');
    return capability === null ? 'Sub-agent completed' : `${humanizeCapability(capability)} completed`;
  },

  /* ---------------------------------------------------------- gauntlet -- */
  'gauntlet.started': (event) => {
    const rounds = factCount(event.facts, 'maxRounds');
    return rounds === null
      ? 'Gauntlet started'
      : `Gauntlet started · up to ${pluralize(rounds, 'round', 'rounds')}`;
  },
  'gauntlet.round': (event) => {
    const round = factCount(event.facts, 'round');
    return round === null ? 'Gauntlet round started' : `Round ${round} started`;
  },
  'gauntlet.completed': () => 'GAUNTLET CLEARED',
  'gauntlet.halted': (event) => {
    const reason = factString(event.facts, 'reason');
    return reason === null ? 'Gauntlet halted' : `Gauntlet halted · ${reason}`;
  },

  /* ------------------------------------------------------------- C.A.R.D. */
  'card.applied': (event) => {
    const revision = factString(event.facts, 'revision');
    return revision === null ? 'C.A.R.D. applied' : `Revision ${revision} applied`;
  },
  'card.denied': (event) => {
    const operation = factString(event.facts, 'operation');
    return operation === null ? 'Operation denied by policy' : `${operation} denied by policy`;
  },
  'card.approval_required': (event) => {
    const operation = factString(event.facts, 'operation');
    return operation === null ? 'Approval required' : `Approval required for ${operation}`;
  },

  /* -------------------------------------------------------- Project Brain */
  'brain.updated': (event) => {
    const entries = factCount(event.facts, 'entries');
    return entries === null
      ? 'Project Brain updated'
      : `Project Brain updated · ${pluralize(entries, 'entry', 'entries')}`;
  },
  'brain.context_compiled': (event) => {
    const truncated = event.facts.truncated;
    return truncated === true ? 'Context compiled · truncated to fit the budget' : 'Context compiled';
  },

  /* -------------------------------------------------------------- autonomy */
  'autonomy.changed': (event) => {
    const mode = factString(event.facts, 'mode');
    return mode === null ? 'Autonomy mode changed' : `Autonomy mode set to ${mode}`;
  },
  'autonomy.denied': (event) => {
    const mode = factString(event.facts, 'mode');
    return mode === null ? 'Autonomy change denied' : `${mode} was denied`;
  },
});

/** Every event kind this module has a projection for. */
export const PROJECTED_EVENT_KINDS: readonly string[] = Object.freeze(Object.keys(PROJECTORS).sort());

/* --------------------------------------------------------- the projection */

const clamp = (text: string): string =>
  (text.length <= TERMINAL_LINE_MAX ? text : `${text.slice(0, TERMINAL_LINE_MAX - 1)}…`);

/**
 * Project one Julius event into one Relay terminal entry.
 *
 * ORDER MATTERS AND IS DELIBERATE. Private reasoning and internal failures are
 * detected on the RAW summary, before any redaction, because redaction can
 * remove the very marker that identifies them — a chain of thought containing
 * an API key would otherwise have the key removed and the reasoning kept.
 */
export function projectJuliusEvent(event: JuliusOperationalEvent): RelayTerminalEntry {
  const label = TERMINAL_ROLE_LABELS[event.actor] ?? TERMINAL_ROLE_LABELS.RELAY_SYSTEM;
  const raw = typeof event.safeSummary === 'string' ? event.safeSummary : '';

  const omittedPrivateReasoning = containsPrivateReasoning(raw);
  const omittedInternalFailure = !omittedPrivateReasoning && containsStackTrace(raw);

  const projector = PROJECTORS[event.kind];
  const recognized = projector !== undefined;
  const projected = projector?.(event) ?? null;

  let headline: string;
  let redactionsApplied = 0;
  if (omittedPrivateReasoning) {
    // Replaced WHOLE. Nothing from the original text survives into the entry,
    // and nothing stores the original.
    headline = PRIVATE_REASONING_LINE;
  } else if (omittedInternalFailure) {
    headline = INTERNAL_FAILURE_LINE;
  } else if (projected !== null) {
    const clean = redactBoundaryText(projected);
    headline = clean.text;
    redactionsApplied = clean.redactions;
  } else if (raw.trim() !== '') {
    const clean = redactBoundaryText(raw.trim());
    headline = clean.text;
    redactionsApplied = clean.redactions;
  } else {
    // No projection AND no summary. Say exactly that rather than inventing a
    // sentence or dropping the event.
    headline = `${UNRECOGNISED_LINE} (${redactBoundaryText(event.kind).text})`;
  }

  headline = clamp(headline);

  return {
    entryId: event.eventId,
    sequence: event.sequence,
    timestamp: event.occurredAt,
    runId: event.runId,
    actor: event.actor,
    label,
    line: clamp(`[${label}] ${headline}`),
    headline,
    severity: event.severity ?? (omittedInternalFailure ? 'warning' : 'info'),
    taskId: event.taskId,
    eventKind: event.kind,
    recognized,
    redactionsApplied,
    omittedPrivateReasoning,
    omittedInternalFailure,
  };
}

/* ------------------------------------------------------------- the stream */

export interface RelayTerminalProjection {
  readonly runId: string;
  readonly entries: readonly RelayTerminalEntry[];
  readonly lastSequence: number;
  /** A missing sequence was observed. Surfaced, never filled. */
  readonly gapDetected: boolean;
  readonly redactionsApplied: number;
}

/**
 * Project a batch, in sequence order, deduplicating by sequence and detecting
 * gaps.
 *
 * A DUPLICATE IS DROPPED AND A GAP IS REPORTED, which are opposite treatments
 * of the same kind of anomaly for a reason: a duplicate has nothing to tell a
 * reader, and a gap means the terminal is not showing everything that
 * happened — the one thing a terminal must never quietly do.
 */
export function projectJuliusEvents(
  runId: string,
  events: readonly JuliusOperationalEvent[],
  sinceSequence: number,
): RelayTerminalProjection {
  const scoped = events
    .filter((event) => event.runId === runId && event.sequence > sinceSequence)
    .sort((a, b) => a.sequence - b.sequence);

  const entries: RelayTerminalEntry[] = [];
  const seen = new Set<number>();
  let gapDetected = false;
  let expected = sinceSequence + 1;
  let redactionsApplied = 0;

  for (const event of scoped) {
    if (seen.has(event.sequence)) continue;
    seen.add(event.sequence);
    if (event.sequence > expected) gapDetected = true;
    expected = event.sequence + 1;
    const entry = projectJuliusEvent(event);
    redactionsApplied += entry.redactionsApplied;
    entries.push(entry);
  }

  return {
    runId,
    entries,
    lastSequence: entries.at(-1)?.sequence ?? sinceSequence,
    gapDetected,
    redactionsApplied,
  };
}
