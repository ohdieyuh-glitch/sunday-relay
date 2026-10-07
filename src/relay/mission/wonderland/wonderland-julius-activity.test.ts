import { describe, expect, it } from 'vitest';

import { JULIUS_OPERATIONAL_EVENT_TYPES } from '../julius/julius-events';
import type { JuliusOperationalEvent, JuliusOperationalEventType } from '../julius/julius-events';
import { JULIUS_VISUAL_STATES } from './wonderland-julius-state';
import {
  JULIUS_ACTIVITY_EVENT_TYPES,
  JULIUS_ACTIVITY_NOT_YET_EMITTED,
  JULIUS_ACTIVITY_READING_FIELDS,
  JULIUS_ACTIVITY_RULES,
  JULIUS_ACTIVITY_SIGNALS,
  JULIUS_WORKER_ACTIVITY_FIELDS,
  emptyJuliusActivity,
  juliusDeclaresEventType,
  wonderlandJuliusActivity,
} from './wonderland-julius-activity';

const PROJECT = 'project-alpha';
const RUN = 'run-1';

let sequence = 0;
const event = (
  type: JuliusOperationalEventType,
  overrides: Partial<JuliusOperationalEvent> = {},
): JuliusOperationalEvent => {
  sequence += 1;
  return {
    eventId: `event-${sequence}`,
    runId: RUN,
    projectId: PROJECT,
    type,
    taskId: null,
    workerId: null,
    correlationId: `corr-${sequence}`,
    causationId: null,
    occurredAt: `2026-09-08T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    facts: {},
    ...overrides,
  };
};

const fold = (...events: readonly JuliusOperationalEvent[]) =>
  wonderlandJuliusActivity(emptyJuliusActivity({ projectId: PROJECT, runId: RUN }), events);

/* --------------------------------------------------------- the vocabulary */

describe('every signal is backed by an event Julius really emits', () => {
  it('raises and clears only types the kernel declares', () => {
    const named = new Set<string>();
    for (const signal of JULIUS_ACTIVITY_SIGNALS) {
      for (const type of JULIUS_ACTIVITY_RULES[signal].raisedBy) named.add(type);
      for (const type of JULIUS_ACTIVITY_RULES[signal].clearedBy) named.add(type);
    }
    const undeclared = [...named].filter((type) => !juliusDeclaresEventType(type));
    expect(
      undeclared,
      'a signal raised by a type Julius does not emit is a signal that can never appear',
    ).toEqual([]);
  });

  it('gives every signal something that raises it', () => {
    // A signal with no raiser is unreachable; a signal with no clearer is
    // permanent. Both are real design choices somewhere, and neither is one
    // anybody should make by forgetting to fill in an array.
    const unreachable = JULIUS_ACTIVITY_SIGNALS.filter(
      (signal) => JULIUS_ACTIVITY_RULES[signal].raisedBy.length === 0,
    );
    const permanent = JULIUS_ACTIVITY_SIGNALS.filter(
      (signal) => JULIUS_ACTIVITY_RULES[signal].clearedBy.length === 0,
    );
    expect(unreachable, 'these signals can never be raised').toEqual([]);
    expect(permanent, 'these signals can never be cleared').toEqual([]);
  });

  it('reads a strict subset of the kernel catalogue', () => {
    const catalogue = new Set<string>(JULIUS_OPERATIONAL_EVENT_TYPES);
    expect(JULIUS_ACTIVITY_EVENT_TYPES.filter((type) => !catalogue.has(type))).toEqual([]);
    expect(JULIUS_ACTIVITY_EVENT_TYPES.length).toBeLessThan(JULIUS_OPERATIONAL_EVENT_TYPES.length);
  });

  it('shares no member with the visual state vocabulary', () => {
    // The two axes answer different questions. A word appearing in both would
    // let a renderer treat one as the other and lose the distinction that made
    // a separate vocabulary worth having.
    const states = new Set<string>(JULIUS_VISUAL_STATES);
    expect(JULIUS_ACTIVITY_SIGNALS.filter((signal) => states.has(signal))).toEqual([]);
  });

  it('names no provider, vendor or SDK', () => {
    const forbidden = /openai|anthropic|claude|gpt|xai|grok|gemini|hermes|codex|llama|sdk/i;
    expect(JULIUS_ACTIVITY_SIGNALS.filter((signal) => forbidden.test(signal))).toEqual([]);
  });
});

describe('the gap is recorded rather than fabricated', () => {
  it('lists what the directive asked for that Julius does not report', () => {
    // The point of the constant is that a future reader can tell "we chose not
    // to show this" from "we forgot". Each entry needs a reason long enough to
    // be one.
    const entries = Object.entries(JULIUS_ACTIVITY_NOT_YET_EMITTED);
    expect(entries.length).toBeGreaterThan(0);
    for (const [item, reason] of entries) {
      expect(reason.length, `${item} needs a reason, not a label`).toBeGreaterThan(60);
    }
  });

  it('never lists something a signal already covers', () => {
    // A gap that has since been closed must leave this list, or the list stops
    // being a to-do and becomes decoration.
    const covered = new Set<string>(JULIUS_ACTIVITY_SIGNALS);
    const stale = Object.keys(JULIUS_ACTIVITY_NOT_YET_EMITTED).filter((item) => covered.has(item));
    expect(stale, 'these are listed as missing and are in fact emitted').toEqual([]);
  });

  it('does not silently gain a signal for something with no event', () => {
    // The failure this guards is the tempting one: adding `using_tool` and
    // deriving it from `worker.dispatched`, which reports a worker starting and
    // not a tool being reached for. Any such signal would have to raise on a
    // type already used for something else, so the raiser sets must be disjoint.
    const raisers = new Map<string, string[]>();
    for (const signal of JULIUS_ACTIVITY_SIGNALS) {
      for (const type of JULIUS_ACTIVITY_RULES[signal].raisedBy) {
        raisers.set(type, [...(raisers.get(type) ?? []), signal]);
      }
    }
    const shared = [...raisers.entries()].filter(([, signals]) => signals.length > 1);
    expect(
      shared.map(([type, signals]) => `${type} -> ${signals.join(', ')}`),
      'two signals raised by one event type means one of them is an inference',
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------- the fold */

describe('signals are raised and cleared by events and by nothing else', () => {
  it('starts with nothing reported, which is not the same as nothing happening', () => {
    const empty = emptyJuliusActivity({ projectId: PROJECT, runId: RUN });
    expect(empty.signals).toEqual([]);
    expect(empty.workers).toEqual([]);
    expect(empty.observedAtIso).toBeNull();
    expect(empty.activeSubagents).toBe(0);
  });

  it('raises an approval and holds it until a decision arrives', () => {
    const waiting = fold(event('approval.requested'));
    expect(waiting.signals).toContain('awaiting_approval');

    // Deliberately NOT cleared by time, by a later phase, or by anything else
    // that merely happened afterwards.
    const still = wonderlandJuliusActivity(waiting, [event('evidence.recorded')]);
    expect(still.signals).toContain('awaiting_approval');

    const decided = wonderlandJuliusActivity(still, [event('approval.decided')]);
    expect(decided.signals).not.toContain('awaiting_approval');
  });

  it('carries a provider failure as degraded rather than as an error', () => {
    const degraded = fold(event('provider.failure'));
    expect(degraded.signals).toEqual(['provider_degraded']);
    // `error` is a visual STATE and means the run stopped. This does not.
    expect(degraded.signals as readonly string[]).not.toContain('error');
  });

  it('clears a retry when the dispatch it was waiting for happens', () => {
    const retrying = fold(event('retry.scheduled'));
    expect(retrying.signals).toContain('retrying');
    expect(wonderlandJuliusActivity(retrying, [event('worker.dispatched')]).signals).not.toContain(
      'retrying',
    );
  });

  it('reports a reroute and a fallback as the same fact', () => {
    expect(fold(event('reroute.selected')).signals).toContain('switching_worker');
    expect(fold(event('fallback.selected')).signals).toContain('switching_worker');
  });

  it('holds several signals at once, because a run does several things at once', () => {
    const busy = fold(
      event('approval.requested'),
      event('retry.scheduled'),
      event('subagent.spawned'),
      event('context.compiled'),
    );
    expect(busy.signals.length).toBeGreaterThan(3);
    expect(busy.signals).toContain('awaiting_approval');
    expect(busy.signals).toContain('retrying');
    expect(busy.signals).toContain('swarming');
    expect(busy.signals).toContain('retrieving_context');
  });

  it('orders signals the same way every time', () => {
    const a = fold(event('context.compiled'), event('approval.requested'));
    const b = fold(event('approval.requested'), event('context.compiled'));
    expect(a.signals).toEqual(b.signals);
    expect(a.signals[0]).toBe('awaiting_approval');
  });

  it('leaves a finished run holding what was true while it ran', () => {
    // Blanking the set at the end would erase the most useful part of the
    // record: that this run completed with a human gate still open.
    const ended = fold(event('approval.requested'), event('run.completed'));
    expect(ended.signals).toContain('awaiting_approval');
  });
});

/* ------------------------------------------------------------- the swarm */

describe('more than one agent is representable, which is the whole point', () => {
  it('counts subagents rather than following the last event', () => {
    const two = fold(event('subagent.spawned'), event('subagent.spawned'));
    expect(two.activeSubagents).toBe(2);
    expect(two.signals).toContain('swarming');

    // One of two finishing does not end a swarm. Clearing on the first
    // completion would put the swarm away while it was still working.
    const one = wonderlandJuliusActivity(two, [event('subagent.completed')]);
    expect(one.activeSubagents).toBe(1);
    expect(one.signals).toContain('swarming');

    const none = wonderlandJuliusActivity(one, [event('subagent.completed')]);
    expect(none.activeSubagents).toBe(0);
    expect(none.signals).not.toContain('swarming');
  });

  it('never counts below zero when completions outnumber spawns', () => {
    const odd = fold(event('subagent.completed'), event('subagent.completed'));
    expect(odd.activeSubagents).toBe(0);
    expect(odd.signals).not.toContain('swarming');
  });

  it('counts a denial without ending the swarm that is still running', () => {
    const denied = fold(event('subagent.spawned'), event('subagent.denied'));
    expect(denied.subagentsDenied).toBe(1);
    expect(denied.activeSubagents).toBe(1);
    expect(denied.signals).toContain('swarming');
  });

  it('keeps each worker’s signals apart', () => {
    const reading = fold(
      event('retry.scheduled', { workerId: 'worker-b' }),
      event('provider.failure', { workerId: 'worker-a' }),
      event('context.compiled', { workerId: 'worker-a' }),
    );
    expect(reading.workers.map((worker) => worker.workerId)).toEqual(['worker-a', 'worker-b']);
    const a = reading.workers.find((worker) => worker.workerId === 'worker-a');
    const b = reading.workers.find((worker) => worker.workerId === 'worker-b');
    expect(a?.signals).toEqual(['provider_degraded', 'retrieving_context']);
    expect(b?.signals).toEqual(['retrying']);
  });

  it('records three concurrent workers, so /MAS needs no new shape', () => {
    const swarm = fold(
      event('subagent.spawned', { workerId: 'clone-1' }),
      event('subagent.spawned', { workerId: 'clone-2' }),
      event('subagent.spawned', { workerId: 'clone-3' }),
    );
    expect(swarm.workers.length).toBe(3);
    expect(swarm.activeSubagents).toBe(3);
    for (const worker of swarm.workers) expect(worker.signals).toContain('swarming');
  });

  it('does not invent a worker for an event that named none', () => {
    expect(fold(event('approval.requested')).workers).toEqual([]);
    expect(fold(event('retry.scheduled', { workerId: '   ' })).workers).toEqual([]);
  });
});

/* ---------------------------------------------------------- the refusals */

describe('one run’s activity never renders over another’s', () => {
  it('refuses an event for another project and counts it', () => {
    const reading = fold(event('approval.requested', { projectId: 'project-beta' }));
    expect(reading.signals).toEqual([]);
    expect(reading.foreignEvents).toBe(1);
  });

  it('refuses an event for another run in the same project', () => {
    const reading = fold(event('approval.requested', { runId: 'run-2' }));
    expect(reading.signals).toEqual([]);
    expect(reading.foreignEvents).toBe(1);
  });

  it('counts an event it has no rule for without treating it as an error', () => {
    const reading = fold(event('evidence.recorded'), event('finding.recorded'));
    expect(reading.unusedEvents).toBe(2);
    expect(reading.signals).toEqual([]);
    expect(reading.observedAtIso).toBeNull();
  });

  it('advances the observation instant only on an event that moved something', () => {
    const moved = fold(event('approval.requested'));
    expect(moved.observedAtIso).not.toBeNull();
    const after = wonderlandJuliusActivity(moved, [event('evidence.recorded')]);
    expect(after.observedAtIso).toBe(moved.observedAtIso);
  });
});

describe('the shape', () => {
  it('names every field it carries, so a C++ mirror cannot drift', () => {
    const reading = fold(event('retry.scheduled', { workerId: 'worker-a' }));
    expect(Object.keys(reading).sort()).toEqual([...JULIUS_ACTIVITY_READING_FIELDS].sort());
    expect(Object.keys(reading.workers[0]).sort()).toEqual(
      [...JULIUS_WORKER_ACTIVITY_FIELDS].sort(),
    );
  });

  it('is frozen, so a consumer cannot edit the reading it was handed', () => {
    const reading = fold(event('approval.requested'));
    expect(Object.isFrozen(reading)).toBe(true);
    expect(() => {
      (reading as { activeSubagents: number }).activeSubagents = 9;
    }).toThrow();
  });
});
