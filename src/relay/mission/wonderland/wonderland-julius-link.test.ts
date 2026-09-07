import { describe, expect, it } from 'vitest';

import type { JuliusOperationalEvent } from '../julius/julius-events';
import {
  WONDERLAND_JULIUS_DEV_PROJECT,
  WONDERLAND_JULIUS_DEV_SCRIPT,
  WONDERLAND_JULIUS_LINK_LABEL,
  WONDERLAND_JULIUS_LINK_SOURCES,
  createWonderlandJuliusLink,
  observeJuliusEvents,
  wonderlandJuliusDevLink,
} from './wonderland-julius-link';
import { rehydrateJuliusEmbodiment } from './wonderland-julius-state';

/**
 * THE WHOLE SEAM, END TO END — and end to end means from the kernel's own event
 * shape to the clip Unreal plays, NOT from a live Julius.
 *
 * Every event below is either constructed here or comes from the labelled
 * development fixture. A passing suite proves the chain is correct; it proves
 * nothing whatever about a mission having run.
 */

const nextEventId = (_event: JuliusOperationalEvent, index: number): string => `w-${index}`;

const fresh = () =>
  createWonderlandJuliusLink({
    source: 'development_fixture',
    projectId: WONDERLAND_JULIUS_DEV_PROJECT,
    identity: { missionId: 'm1', agentId: 'a1' },
  });

describe('the link labels where its events came from', () => {
  it('has exactly two sources, and no third for "probably live"', () => {
    expect([...WONDERLAND_JULIUS_LINK_SOURCES]).toEqual([
      'live_runtime',
      'development_fixture',
    ]);
  });

  it('says on its own face that a fixture is not a mission', () => {
    expect(WONDERLAND_JULIUS_LINK_LABEL.development_fixture).toContain('NOT A MISSION');
    expect(wonderlandJuliusDevLink().status.sourceLabel).toContain('NOT A MISSION');
  });

  it('cannot produce a live label from the fixture', () => {
    // The guarantee is structural: `wonderlandJuliusDevLink` names its source,
    // and nothing folds a fixture into a link that claims otherwise.
    expect(wonderlandJuliusDevLink().status.source).toBe('development_fixture');
  });

  it('starts unobserved, and unobserved is not idle', () => {
    const link = fresh();
    expect(link.status.observed).toBe(false);
    expect(link.status.cursor).toBe(0);
    expect(link.embodiment.visualState).toBeNull();
    expect(link.embodiment.animation).toBe('dormant');
  });
});

describe('folding the kernel through the seam', () => {
  it('walks the whole pipeline and ends complete', () => {
    const link = wonderlandJuliusDevLink();
    expect(link.status.observed).toBe(true);
    expect(link.embodiment.visualState).toBe('complete');
    expect(link.embodiment.terminal).toBe(true);
    expect(link.embodiment.activity).toBe('complete');
    expect(link.embodiment.animation).toBe('stand_still');
  });

  it('reaches every stage the script walks through, in order', () => {
    // Fold the script one event at a time and collect the states it passes.
    let link = fresh();
    const seen: (string | null)[] = [];
    for (const [index, event] of WONDERLAND_JULIUS_DEV_SCRIPT.entries()) {
      link = observeJuliusEvents(link, [event], {
        identity: { missionId: 'm1', agentId: 'a1' },
        nextEventId: () => `w-${index}`,
      }).link;
      seen.push(link.embodiment.visualState);
    }
    // Duplicates collapsed: what a viewer would actually watch happen.
    const distinct = seen.filter((state, i) => i === 0 || state !== seen[i - 1]);
    expect(distinct).toEqual([
      'attention',
      'prompt_architect',
      'handoff',
      'coding',
      'independent_review',
      'repair',
      'verifying',
      'complete',
    ]);
  });

  it('counts the kernel events the world has no truthful type for', () => {
    const link = wonderlandJuliusDevLink();
    // `context.compiled` and `budget.reserved` say nothing about what Julius is
    // doing. They are counted rather than invented into a stage change.
    expect(link.status.silentJuliusEvents).toBe(2);
    expect(link.status.published).toBe(WONDERLAND_JULIUS_DEV_SCRIPT.length - 2);
  });

  it('numbers world events densely, so a silent one leaves no false gap', () => {
    const observation = observeJuliusEvents(fresh(), WONDERLAND_JULIUS_DEV_SCRIPT, {
      identity: { missionId: 'm1', agentId: 'a1' },
      nextEventId,
    });
    expect(observation.published.map((event) => event.sequence)).toEqual(
      observation.published.map((_event, index) => index + 1),
    );
    expect(observation.link.embodiment.sequenceGapsObserved).toBe(0);
  });

  it('hands the world events back rather than keeping them', () => {
    // A link that retained them would be a second event store with no replay
    // and no ordering guarantee.
    const observation = observeJuliusEvents(fresh(), WONDERLAND_JULIUS_DEV_SCRIPT, {
      nextEventId,
    });
    expect(observation.published.length).toBeGreaterThan(0);
    expect(Object.keys(observation.link)).toEqual(['status', 'embodiment']);
  });

  it('is the same fold whether the stream arrives whole or in pieces', () => {
    // "The stream arrived in two pieces" is the normal case, not an edge one.
    const whole = observeJuliusEvents(fresh(), WONDERLAND_JULIUS_DEV_SCRIPT, {
      identity: { missionId: 'm1', agentId: 'a1' },
      nextEventId,
    }).link;

    const half = Math.floor(WONDERLAND_JULIUS_DEV_SCRIPT.length / 2);
    const first = observeJuliusEvents(fresh(), WONDERLAND_JULIUS_DEV_SCRIPT.slice(0, half), {
      identity: { missionId: 'm1', agentId: 'a1' },
      nextEventId,
    }).link;
    const pieced = observeJuliusEvents(first, WONDERLAND_JULIUS_DEV_SCRIPT.slice(half), {
      identity: { missionId: 'm1', agentId: 'a1' },
      nextEventId,
    }).link;

    expect(pieced.embodiment.visualState).toBe(whole.embodiment.visualState);
    expect(pieced.embodiment.sequence).toBe(whole.embodiment.sequence);
    expect(pieced.status.cursor).toBe(whole.status.cursor);
    expect(pieced.status.published).toBe(whole.status.published);
    expect(pieced.status.silentJuliusEvents).toBe(whole.status.silentJuliusEvents);
  });

  it('leaves the cursor exactly where a reconnect resumes', () => {
    const observation = observeJuliusEvents(fresh(), WONDERLAND_JULIUS_DEV_SCRIPT, {
      nextEventId,
    });
    expect(observation.link.status.cursor).toBe(observation.link.embodiment.sequence);
    // And replaying the published events from zero reaches the same state.
    const replayed = rehydrateJuliusEmbodiment(
      { projectId: WONDERLAND_JULIUS_DEV_PROJECT },
      observation.published,
    );
    expect(replayed.visualState).toBe(observation.link.embodiment.visualState);
    expect(replayed.sequence).toBe(observation.link.embodiment.sequence);
  });

  it('mutates nothing — the link it was given still answers for its own state', () => {
    const before = fresh();
    observeJuliusEvents(before, WONDERLAND_JULIUS_DEV_SCRIPT, { nextEventId });
    expect(before.status.observed).toBe(false);
    expect(before.status.cursor).toBe(0);
    expect(before.embodiment.visualState).toBeNull();
  });

  it('stays unobserved when every event says nothing about Julius', () => {
    // Arriving is not observing. A run of events the model does not map leaves
    // the link exactly as unobserved as it was.
    const quiet = WONDERLAND_JULIUS_DEV_SCRIPT.filter(
      (event) => event.type === 'context.compiled' || event.type === 'budget.reserved',
    );
    expect(quiet.length).toBeGreaterThan(0);
    const link = observeJuliusEvents(fresh(), quiet, { nextEventId }).link;
    expect(link.status.observed).toBe(false);
    expect(link.embodiment.visualState).toBeNull();
    expect(link.status.published).toBe(0);
  });
});

describe('the dev script is shaped like the runtime, not like a convenience', () => {
  it('carries the destination state the way the kernel does', () => {
    // A fixture written in a shape the runtime does not use would exercise a
    // path production never takes, and pass while the real one broke.
    const transitions = WONDERLAND_JULIUS_DEV_SCRIPT.filter(
      (event) => event.type === 'run.transitioned',
    );
    expect(transitions.length).toBeGreaterThan(0);
    for (const event of transitions) expect(typeof event.facts.to).toBe('string');
  });

  it('names one project and one run throughout', () => {
    for (const event of WONDERLAND_JULIUS_DEV_SCRIPT) {
      expect(event.projectId).toBe(WONDERLAND_JULIUS_DEV_PROJECT);
      expect(event.runId).toBe('dev-run-1');
    }
  });

  it('uses fixed instants, so it cannot look more live than it is', () => {
    for (const event of WONDERLAND_JULIUS_DEV_SCRIPT) {
      expect(event.occurredAt.startsWith('2026-01-01T')).toBe(true);
    }
  });
});
