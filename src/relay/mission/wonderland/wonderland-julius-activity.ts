/**
 * WHAT JULIUS IS DOING RIGHT NOW, BESIDES WHAT PHASE IT IS IN.
 *
 * `wonderland-julius-state.ts` answers "which phase" and there is exactly one
 * answer at a time: a run is coding or reviewing or repairing, never two. This
 * module answers a different question — "what else is true" — and there can be
 * several answers at once. A Coding Agent can be retrying while a subagent
 * swarm is running while an approval is outstanding, and a vocabulary with room
 * for one of those would have to pick.
 *
 * WHY IT IS A SEPARATE AXIS RATHER THAN MORE STATES. Folding these into
 * `JULIUS_VISUAL_STATES` would mean choosing between `coding` and `retrying`
 * for a run that is doing both, and the choice would be made by whichever event
 * arrived last. It would also break a bijection the world depends on: eleven
 * visual states map one-to-one onto eleven dog activities, and a twelfth state
 * with no animation is a state the world cannot draw.
 *
 * SIGNALS ARE RAISED AND CLEARED BY EVENTS, NEVER INFERRED AND NEVER TIMED OUT.
 * Every signal below names the event types that raise it and the ones that
 * clear it, and `wonderlandJuliusActivity` does nothing else. There is no
 * heuristic that decides a retry "probably finished", because a signal that
 * expired on a guess would go dark during the exact incident an operator was
 * watching it for. A signal that is stuck on is a stream that stopped, which is
 * a fact worth seeing.
 *
 * AN EMPTY SET MEANS NOTHING WAS REPORTED. It does not mean nothing is
 * happening. Julius emits no event for a great deal of what it does — see
 * `JULIUS_ACTIVITY_NOT_YET_EMITTED` — and a renderer that read silence as
 * calm would be inventing the most reassuring possible answer to a question
 * nobody asked.
 *
 * MORE THAN ONE AGENT IS REPRESENTABLE, WHICH IS THE POINT. Signals are
 * collected per worker as well as for the run, because /MAS spawns two or three
 * Compound clones under one primary and a shape that could only describe "the"
 * agent would have to be replaced the day that ships. Nothing here assumes one.
 */

import {
  JULIUS_OPERATIONAL_EVENT_TYPES,
  type JuliusOperationalEvent,
  type JuliusOperationalEventType,
} from '../julius/julius-events';
import { exactKeys } from './wonderland-contracts';

export const WONDERLAND_ACTIVITY_SCHEMA_V1 = 'relay-wonderland-activity.v1' as const;

/* ------------------------------------------------------------ the signals */

/**
 * Concurrent facts about a run, each backed by an event Julius actually emits.
 *
 * The order is the order an operator reads them in, most urgent first, and
 * `wonderlandJuliusActivity` sorts by it so two clients showing the same run
 * list the same things in the same order.
 */
export const JULIUS_ACTIVITY_SIGNALS = [
  /** A human gate is open. The run is waiting on a person, not on a model. */
  'awaiting_approval',
  /** A provider failed and the run continued. Not an error state — a degraded one. */
  'provider_degraded',
  /** A recovery action was taken. The run is repairing its own machinery. */
  'recovering',
  /** A dispatch is being retried. */
  'retrying',
  /** Work moved to a different worker: a reroute or a fallback. */
  'switching_worker',
  /** Subagents are running. This is what /MAS looks like from outside. */
  'swarming',
  /** Context was compiled for a worker: Project Brain, memory, or both. */
  'retrieving_context',
] as const;
export type JuliusActivitySignal = (typeof JULIUS_ACTIVITY_SIGNALS)[number];

/**
 * WHAT THE FOUNDER ASKED TO SEE THAT JULIUS DOES NOT YET SAY.
 *
 * The directive lists activities the world must eventually visualise. Most map
 * onto a visual state or a signal above. These do not map onto anything,
 * because no member of `JULIUS_OPERATIONAL_EVENT_TYPES` reports them — and the
 * catalogue is audited in both directions, so that absence is a fact rather
 * than an oversight in this file.
 *
 * They are recorded HERE, in the module that would render them, rather than
 * left implicit. A signal invented for one of these would have to be derived
 * from something that does not mean it — "the run is coding, so it is probably
 * using a tool" — and a world that guessed would be indistinguishable from one
 * that knew until the guess was wrong in front of the founder.
 *
 * Each entry names what Julius would have to emit. That is the ask for whoever
 * owns the kernel; it is not something this layer can supply.
 */
export const JULIUS_ACTIVITY_NOT_YET_EMITTED: Readonly<Record<string, string>> = Object.freeze({
  interpreting:
    'no event marks the gap between a mission arriving and a worker being selected. `run.created` and `worker.selected` bracket it, but the bracket is not a report: a run that sat in a queue would render as interpreting for as long as it waited.',
  planning:
    'the Prompt Architect phase is visible as a STATE, but nothing distinguishes planning from having planned. An `architect.planning` / `architect.planned` pair would.',
  research:
    'no event reports a worker reading anything outside the workspace. Tool-level events would carry it.',
  tool_usage:
    'no event reports a tool call at all. `worker.dispatched` says a worker started and `worker.completed` says it finished; everything in between is silent, so a world cannot show a Compound Agent reaching for something.',
  project_brain_vs_memory:
    '`context.compiled` reports that context was assembled and not WHICH SOURCE it came from, so Project Brain retrieval and memory retrieval collapse into one signal. A fact on the event naming the source would separate them without a new type.',
});

/* -------------------------------------------------- what raises and clears */

/**
 * The event types that raise each signal, and the ones that put it down.
 *
 * Declared as data rather than written as a switch so the test can hold every
 * type in it against the kernel's own catalogue. A signal raised by a type
 * Julius does not emit is a signal that can never appear, which is the promise
 * `julius-event-coverage.test.ts` refuses on the kernel side and this refuses
 * here.
 */
interface SignalRule {
  readonly raisedBy: readonly JuliusOperationalEventType[];
  readonly clearedBy: readonly JuliusOperationalEventType[];
}

export const JULIUS_ACTIVITY_RULES: Readonly<Record<JuliusActivitySignal, SignalRule>> =
  Object.freeze({
    awaiting_approval: {
      raisedBy: ['approval.requested'],
      clearedBy: ['approval.decided'],
    },
    provider_degraded: {
      // Cleared by the work actually landing. A provider that failed and was
      // rerouted is still a degraded run until something completes.
      raisedBy: ['provider.failure'],
      clearedBy: ['worker.completed'],
    },
    recovering: {
      raisedBy: ['recovery.action'],
      clearedBy: ['worker.completed', 'task.claimed'],
    },
    retrying: {
      raisedBy: ['retry.scheduled'],
      clearedBy: ['worker.dispatched', 'worker.completed'],
    },
    switching_worker: {
      raisedBy: ['reroute.selected', 'fallback.selected'],
      clearedBy: ['worker.dispatched'],
    },
    swarming: {
      // NOT cleared by `subagent.denied`: a denial means one child never
      // started, and other children may still be running. Counted, below.
      raisedBy: ['subagent.spawned'],
      clearedBy: ['subagent.completed'],
    },
    retrieving_context: {
      raisedBy: ['context.compiled'],
      clearedBy: ['worker.dispatched'],
    },
  });

/* -------------------------------------------------------------- the reading */

export interface JuliusWorkerActivity {
  readonly workerId: string;
  /** Signals raised by events naming this worker. Sorted, deduplicated. */
  readonly signals: readonly JuliusActivitySignal[];
}

export const JULIUS_WORKER_ACTIVITY_FIELDS = exactKeys<JuliusWorkerActivity>()([
  'workerId',
  'signals',
] as const);

export interface JuliusActivityReading {
  readonly schemaVersion: typeof WONDERLAND_ACTIVITY_SCHEMA_V1;
  readonly projectId: string;
  readonly runId: string;
  /**
   * Signals true for the run. Sorted by `JULIUS_ACTIVITY_SIGNALS` order.
   *
   * Empty means NOTHING WAS REPORTED, never that nothing is happening.
   */
  readonly signals: readonly JuliusActivitySignal[];
  /**
   * Per-worker signals, for every worker any event named.
   *
   * Sorted by worker id so two clients agree on the order. A run with three
   * concurrent Compound clones has three entries here and always could have —
   * nothing in this shape assumes one agent.
   */
  readonly workers: readonly JuliusWorkerActivity[];
  /** How many subagents have been spawned and not yet reported complete. */
  readonly activeSubagents: number;
  /** Subagent spawns Julius refused. A denial is a fact, not an absence. */
  readonly subagentsDenied: number;
  /** When the last event that moved anything occurred. Null until one has. */
  readonly observedAtIso: string | null;
  /** Events read whose type raises or clears nothing here. Not an error. */
  readonly unusedEvents: number;
  /** Events refused for naming another project or run. */
  readonly foreignEvents: number;
}

export const JULIUS_ACTIVITY_READING_FIELDS = exactKeys<JuliusActivityReading>()([
  'schemaVersion',
  'projectId',
  'runId',
  'signals',
  'workers',
  'activeSubagents',
  'subagentsDenied',
  'observedAtIso',
  'unusedEvents',
  'foreignEvents',
] as const);

const ORDER = new Map<JuliusActivitySignal, number>(
  JULIUS_ACTIVITY_SIGNALS.map((signal, index) => [signal, index]),
);

const sortSignals = (signals: Iterable<JuliusActivitySignal>): readonly JuliusActivitySignal[] =>
  [...new Set(signals)].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));

/** Every signal a type raises, and every signal it clears. Built once. */
const RAISES = new Map<JuliusOperationalEventType, JuliusActivitySignal[]>();
const CLEARS = new Map<JuliusOperationalEventType, JuliusActivitySignal[]>();
for (const signal of JULIUS_ACTIVITY_SIGNALS) {
  for (const type of JULIUS_ACTIVITY_RULES[signal].raisedBy) {
    RAISES.set(type, [...(RAISES.get(type) ?? []), signal]);
  }
  for (const type of JULIUS_ACTIVITY_RULES[signal].clearedBy) {
    CLEARS.set(type, [...(CLEARS.get(type) ?? []), signal]);
  }
}

export function emptyJuliusActivity(input: {
  readonly projectId: string;
  readonly runId: string;
}): JuliusActivityReading {
  return Object.freeze({
    schemaVersion: WONDERLAND_ACTIVITY_SCHEMA_V1,
    projectId: input.projectId,
    runId: input.runId,
    signals: Object.freeze([]),
    workers: Object.freeze([]),
    activeSubagents: 0,
    subagentsDenied: 0,
    observedAtIso: null,
    unusedEvents: 0,
    foreignEvents: 0,
  });
}

/**
 * Fold events into the activity currently true for one run.
 *
 * ORDER IS THE CALLER'S PROBLEM, deliberately. `wonderland-ordering.ts` already
 * owns the question of which events a world should have applied, and duplicating
 * its cursor here would give one stream two answers. Feed this what ordering
 * accepted, in the order it accepted them.
 *
 * A RUN THAT ENDS DOES NOT CLEAR ITS SIGNALS. A completed run that finished with
 * an approval outstanding still had one outstanding, and blanking the set at the
 * end would erase the most useful part of the record. The visual state says the
 * run is over; this says what was true while it ran.
 */
export function wonderlandJuliusActivity(
  base: JuliusActivityReading,
  events: readonly JuliusOperationalEvent[],
): JuliusActivityReading {
  const run = new Set<JuliusActivitySignal>(base.signals);
  const byWorker = new Map<string, Set<JuliusActivitySignal>>(
    base.workers.map((worker) => [worker.workerId, new Set(worker.signals)]),
  );
  let activeSubagents = base.activeSubagents;
  let subagentsDenied = base.subagentsDenied;
  let observedAtIso = base.observedAtIso;
  let unusedEvents = base.unusedEvents;
  let foreignEvents = base.foreignEvents;

  for (const event of events) {
    // IDENTITY FIRST, as everywhere else in this layer. One run's activity
    // rendered over another's is worse than showing none.
    if (event.projectId !== base.projectId || event.runId !== base.runId) {
      foreignEvents += 1;
      continue;
    }

    const raises = RAISES.get(event.type) ?? [];
    const clears = CLEARS.get(event.type) ?? [];
    const counts = event.type === 'subagent.spawned' ||
      event.type === 'subagent.completed' ||
      event.type === 'subagent.denied';

    if (raises.length === 0 && clears.length === 0 && !counts) {
      unusedEvents += 1;
      continue;
    }

    for (const signal of clears) run.delete(signal);
    for (const signal of raises) run.add(signal);

    if (event.workerId !== null && event.workerId.trim() !== '') {
      const held = byWorker.get(event.workerId) ?? new Set<JuliusActivitySignal>();
      for (const signal of clears) held.delete(signal);
      for (const signal of raises) held.add(signal);
      byWorker.set(event.workerId, held);
    }

    if (event.type === 'subagent.spawned') activeSubagents += 1;
    if (event.type === 'subagent.completed') activeSubagents = Math.max(0, activeSubagents - 1);
    if (event.type === 'subagent.denied') subagentsDenied += 1;

    observedAtIso = event.occurredAt;
  }

  // `swarming` follows the COUNT rather than the last event, because two
  // subagents spawning and one completing leaves one running. Clearing on the
  // first completion would put the swarm away while it was still working.
  if (activeSubagents > 0) run.add('swarming');
  else run.delete('swarming');

  return Object.freeze({
    schemaVersion: WONDERLAND_ACTIVITY_SCHEMA_V1,
    projectId: base.projectId,
    runId: base.runId,
    signals: sortSignals(run),
    workers: Object.freeze(
      [...byWorker.entries()]
        .map(([workerId, signals]) => Object.freeze({ workerId, signals: sortSignals(signals) }))
        .sort((a, b) => (a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0)),
    ),
    activeSubagents,
    subagentsDenied,
    observedAtIso,
    unusedEvents,
    foreignEvents,
  });
}

/**
 * Every event type this module reads. Exported so the test can hold it against
 * the kernel's catalogue rather than re-listing it.
 */
export const JULIUS_ACTIVITY_EVENT_TYPES: readonly JuliusOperationalEventType[] = Object.freeze(
  [...new Set<JuliusOperationalEventType>([
    ...RAISES.keys(),
    ...CLEARS.keys(),
    'subagent.spawned',
    'subagent.completed',
    'subagent.denied',
  ])].sort(),
);

/** True when the type is one the kernel actually declares. Used by the test. */
export const juliusDeclaresEventType = (type: string): boolean =>
  (JULIUS_OPERATIONAL_EVENT_TYPES as readonly string[]).includes(type);
