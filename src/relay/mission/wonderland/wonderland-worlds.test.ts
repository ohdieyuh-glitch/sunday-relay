import { describe, expect, it } from 'vitest';

import { WONDERLAND_EVENT_SCHEMA_VERSION } from './wonderland-backend';
import type { WonderlandEvent, WonderlandEventType } from './wonderland-backend';
import {
  admitToWonderland,
  beginWonderlandEntry,
  isInsideWonderland,
  offerWonderlandRenderer,
  claimWonderlandPresenting,
  requestWonderlandAdmission,
} from './wonderland-entry';
import type { WonderlandRendererOffer } from './wonderland-entry';
import {
  WONDERLAND_USAGE_REPORT_SCHEMA_V1,
  readWonderlandUsageAuthority,
} from './wonderland-usage-authority';
import type { WonderlandUsageReport } from './wonderland-usage-authority';
import {
  WONDERLAND_WORLDS_FIELDS,
  WONDERLAND_WORLDS_SCHEMA_V1,
  WONDERLAND_WORLD_FIELDS,
  focusWonderlandWorld,
  focusedWonderlandWorld,
  forgetWonderlandWorld,
  openWonderlandWorlds,
  planWonderlandWorldAnimation,
  presentedWonderlandWorlds,
  readWonderlandWorld,
  routeWonderlandEvent,
  routeWonderlandEvents,
  routeWonderlandUsageReport,
  setWonderlandEntry,
  watchWonderlandWorld,
  watchedWonderlandProjects,
} from './wonderland-worlds';
import type { WonderlandWorlds } from './wonderland-worlds';

/**
 * THE WALL BETWEEN WORLDS.
 *
 * Almost every test below asserts REFERENTIAL IDENTITY with `toBe` rather than
 * equality with `toEqual`, and that is the point rather than a style choice.
 * Equality would pass for a module that rebuilt every world on every event and
 * happened to get the values right; identity only passes if the other worlds
 * were genuinely never touched. The failure this guards against does not throw
 * and does not show a red state — it renders one project's mission on another
 * project's dog, which looks exactly like the product working.
 */

const A = 'project-a';
const B = 'project-b';
const PLAYER = 'player-1';

let nextSequence = 0;

function worldEvent(
  projectId: string,
  eventType: WonderlandEventType,
  overrides: Partial<WonderlandEvent> = {},
): WonderlandEvent {
  nextSequence += 1;
  return {
    eventId: `evt-${nextSequence}`,
    schemaVersion: WONDERLAND_EVENT_SCHEMA_VERSION,
    timestamp: '2026-09-07T10:00:00.000Z',
    projectId,
    sessionId: null,
    playerId: null,
    agentId: null,
    missionId: null,
    battleId: null,
    eventType,
    payload: {},
    visibility: 'OWNER',
    correlationId: 'corr-1',
    causationId: null,
    sequence: nextSequence,
    ...overrides,
  };
}

let nextRevision = 0;

function usageReport(
  projectId: string,
  current: number,
  overrides: Partial<WonderlandUsageReport> = {},
): WonderlandUsageReport {
  nextRevision += 1;
  const channel = {
    current,
    maximum: 500,
    reference: 500,
    tierId: 'tier-1',
    tierLabel: 'Tier one',
    unitLabel: 'units',
  };
  return {
    schemaVersion: WONDERLAND_USAGE_REPORT_SCHEMA_V1,
    projectId,
    revision: nextRevision,
    reportedAtIso: '2026-09-07T10:00:00.000Z',
    authorityId: 'authority-1',
    unavailableReason: null,
    compoundAgent: channel,
    singleAgent: channel,
    ...overrides,
  };
}

/** Two worlds watched, in a known order. */
const twoWorlds = (): WonderlandWorlds =>
  watchWonderlandWorld(
    watchWonderlandWorld(openWonderlandWorlds(), { projectId: A, playerId: PLAYER }),
    { projectId: B, playerId: PLAYER },
  );

const OFFER: WonderlandRendererOffer = Object.freeze({
  rendererId: 'renderer-1',
  kind: 'unreal_pixel_stream',
  description: 'The Unreal world, streamed',
});

/* --------------------------------------------------------- watching them */

describe('watching worlds', () => {
  it('starts watching nothing and claims nothing', () => {
    const worlds = openWonderlandWorlds();
    expect(worlds.schemaVersion).toBe(WONDERLAND_WORLDS_SCHEMA_V1);
    expect(watchedWonderlandProjects(worlds)).toEqual([]);
    expect(focusedWonderlandWorld(worlds)).toBeNull();
    expect(readWonderlandWorld(worlds, A)).toBeNull();
    expect(Object.keys(worlds).sort()).toEqual([...WONDERLAND_WORLDS_FIELDS].sort());
  });

  it('keeps the key and the world agreeing about whose it is', () => {
    const worlds = twoWorlds();
    for (const [key, world] of Object.entries(worlds.worlds)) {
      expect(world.projectId).toBe(key);
      expect(world.bridge.subscription.projectId).toBe(key);
      expect(world.entry.projectId).toBe(key);
      expect(Object.keys(world).sort()).toEqual([...WONDERLAND_WORLD_FIELDS].sort());
    }
  });

  it('focuses the first world watched, so a single-project surface need not choose', () => {
    const worlds = twoWorlds();
    expect(worlds.focusedProjectId).toBe(A);
    expect(focusedWonderlandWorld(worlds)?.projectId).toBe(A);
  });

  it('does not reset a world already being watched', () => {
    // A re-render, or a second component asking for the same project, must not
    // discard a fold that is already tracking a mission.
    const worlds = routeWonderlandEvent(twoWorlds(), worldEvent(A, 'agent.implementing'));
    const again = watchWonderlandWorld(worlds, { projectId: A, playerId: PLAYER });
    expect(again).toBe(worlds);
    expect(readWonderlandWorld(again, A)?.bridge.embodiment.visualState).toBe('coding');
  });

  it('forgets one world and leaves the other identical', () => {
    const worlds = twoWorlds();
    const forgotten = forgetWonderlandWorld(worlds, A);
    expect(readWonderlandWorld(forgotten, A)).toBeNull();
    expect(readWonderlandWorld(forgotten, B)).toBe(readWonderlandWorld(worlds, B));
    // Focus does not silently move to whatever is left: choosing a replacement
    // would be this record deciding what a person is looking at.
    expect(forgotten.focusedProjectId).toBeNull();
  });

  it('forgetting a world nobody watched changes nothing at all', () => {
    const worlds = twoWorlds();
    expect(forgetWonderlandWorld(worlds, 'project-z')).toBe(worlds);
  });
});

/* ------------------------------------------------- the wall, for events */

describe('routing an event', () => {
  it('lands in the world the EVENT names, never the focused one', () => {
    // A surface routing by what the user is looking at would apply a background
    // project's events to the foreground one every time someone switched tabs.
    const worlds = focusWonderlandWorld(twoWorlds(), A);
    const routed = routeWonderlandEvent(worlds, worldEvent(B, 'agent.implementing'));
    expect(readWonderlandWorld(routed, B)?.bridge.embodiment.visualState).toBe('coding');
    expect(readWonderlandWorld(routed, A)?.bridge.embodiment.visualState).toBeNull();
  });

  it('leaves every other world REFERENTIALLY identical', () => {
    const worlds = twoWorlds();
    const before = readWonderlandWorld(worlds, B);
    const routed = routeWonderlandEvent(worlds, worldEvent(A, 'agent.implementing'));
    expect(readWonderlandWorld(routed, B)).toBe(before);
  });

  it('never lets one project complete another', () => {
    const worlds = routeWonderlandEvent(twoWorlds(), worldEvent(A, 'mission.completed'));
    expect(readWonderlandWorld(worlds, A)?.bridge.embodiment.terminal).toBe(true);
    expect(readWonderlandWorld(worlds, B)?.bridge.embodiment.terminal).toBe(false);
    expect(readWonderlandWorld(worlds, B)?.bridge.embodiment.visualState).toBeNull();
  });

  it('drops an event for a project nobody asked to watch, and counts it', () => {
    // A stream carrying an unsubscribed project is either a server-side leak or
    // a client bug. The answer to both is to drop it, never to start rendering it.
    const worlds = twoWorlds();
    const routed = routeWonderlandEvent(worlds, worldEvent('project-z', 'agent.implementing'));
    expect(watchedWonderlandProjects(routed)).toEqual([A, B]);
    expect(readWonderlandWorld(routed, 'project-z')).toBeNull();
    expect(routed.unwatchedProjectMessagesDropped).toBe(1);
    expect(readWonderlandWorld(routed, A)).toBe(readWonderlandWorld(worlds, A));
    expect(readWonderlandWorld(routed, B)).toBe(readWonderlandWorld(worlds, B));
  });

  it('keeps two interleaved streams apart across many events', () => {
    const routed = routeWonderlandEvents(twoWorlds(), [
      worldEvent(A, 'agent.implementing'),
      worldEvent(B, 'agent.reviewing'),
      worldEvent(A, 'agent.verifying'),
      worldEvent(B, 'mission.failed'),
      worldEvent(A, 'mission.completed'),
    ]);
    const a = readWonderlandWorld(routed, A);
    const b = readWonderlandWorld(routed, B);
    expect(a?.bridge.embodiment.visualState).toBe('complete');
    expect(b?.bridge.embodiment.visualState).toBe('error');
    expect(a?.bridge.eventsApplied).toBe(3);
    expect(b?.bridge.eventsApplied).toBe(2);
  });

  it('does not let one project advance another project`s cursor', () => {
    // The cursor is what a reconnect resumes from. A shared one would make a
    // busy project silently skip a quiet project's replay.
    const routed = routeWonderlandEvents(twoWorlds(), [
      worldEvent(A, 'agent.implementing'),
      worldEvent(A, 'agent.verifying'),
      worldEvent(A, 'agent.repairing'),
    ]);
    expect(readWonderlandWorld(routed, B)?.bridge.embodiment.sequence).toBe(0);
  });
});

/* -------------------------------------------- the wall, for money */

describe('routing a usage report', () => {
  /**
   * Units left on a project's compound meter, and null unless the reading is
   * genuinely `known` — reading the figures without checking that would report
   * a stale number as a current one, which is the whole thing the authority
   * layer exists to prevent.
   */
  const remaining = (worlds: WonderlandWorlds, projectId: string): number | null => {
    const world = readWonderlandWorld(worlds, projectId);
    if (world === null) return null;
    const state = world.bridge.usage;
    const reading = readWonderlandUsageAuthority(state, '2026-09-07T10:00:01.000Z');
    if (reading.reading !== 'known') return null;
    return state.report?.compoundAgent.current ?? null;
  };

  it('drains only the meter of the project that spent', () => {
    // Sharper than the event case: usage is money, and a meter that fell
    // because a different project spent is a false statement about a budget.
    const worlds = twoWorlds();
    const routed = routeWonderlandUsageReport(worlds, usageReport(A, 120));
    expect(remaining(routed, A)).toBe(120);
    expect(readWonderlandWorld(routed, B)).toBe(readWonderlandWorld(worlds, B));
    expect(remaining(routed, B)).toBeNull();
  });

  it('keeps two projects on independent revisions', () => {
    // Report revisions are per project. A shared counter would make B's second
    // report look stale because A had already sent three.
    let worlds = twoWorlds();
    worlds = routeWonderlandUsageReport(worlds, usageReport(A, 400));
    worlds = routeWonderlandUsageReport(worlds, usageReport(A, 300));
    worlds = routeWonderlandUsageReport(worlds, usageReport(B, 90));
    expect(remaining(worlds, A)).toBe(300);
    expect(remaining(worlds, B)).toBe(90);
  });

  it('drops a report for a project nobody asked to watch', () => {
    const worlds = twoWorlds();
    const routed = routeWonderlandUsageReport(worlds, usageReport('project-z', 10));
    expect(routed.unwatchedProjectMessagesDropped).toBe(1);
    expect(readWonderlandWorld(routed, A)).toBe(readWonderlandWorld(worlds, A));
  });
});

/* ------------------------------------------------- the wall, for entry */

describe('storing an entry', () => {
  it('files it under the project the entry itself names', () => {
    const worlds = twoWorlds();
    const admitted = admitToWonderland(
      requestWonderlandAdmission(beginWonderlandEntry({ projectId: A, playerId: PLAYER })),
      { sessionId: 'session-1', atIso: '2026-09-07T10:00:00.000Z' },
    );
    const stored = setWonderlandEntry(worlds, admitted);
    expect(readWonderlandWorld(stored, A)?.entry.admission).toBe('admitted');
    expect(readWonderlandWorld(stored, B)).toBe(readWonderlandWorld(worlds, B));
    expect(readWonderlandWorld(stored, B)?.entry.admission).toBe('not_requested');
  });

  it('never admits one project by entering another', () => {
    const worlds = twoWorlds();
    const inside = claimWonderlandPresenting(
      offerWonderlandRenderer(
        admitToWonderland(beginWonderlandEntry({ projectId: A, playerId: PLAYER }), {
          sessionId: 'session-1',
          atIso: '2026-09-07T10:00:00.000Z',
        }),
        OFFER,
      ),
      { rendererId: OFFER.rendererId, atIso: '2026-09-07T10:00:02.000Z' },
    );
    const stored = setWonderlandEntry(worlds, inside);
    expect(presentedWonderlandWorlds(stored).map((world) => world.projectId)).toEqual([A]);
    expect(isInsideWonderland(readWonderlandWorld(stored, B)!.entry)).toBe(false);
  });

  it('drops an entry for a project nobody asked to watch', () => {
    const worlds = twoWorlds();
    const stray = beginWonderlandEntry({ projectId: 'project-z', playerId: PLAYER });
    const stored = setWonderlandEntry(worlds, stray);
    expect(readWonderlandWorld(stored, 'project-z')).toBeNull();
    expect(stored.unwatchedProjectMessagesDropped).toBe(1);
  });
});

/* ---------------------------------------------------------------- focus */

describe('focus', () => {
  it('changes nothing about any world', () => {
    // A record that paused a background fold when a person looked away would be
    // silently losing events it had already received.
    const worlds = routeWonderlandEvent(twoWorlds(), worldEvent(A, 'agent.implementing'));
    const focused = focusWonderlandWorld(worlds, B);
    expect(focused.focusedProjectId).toBe(B);
    expect(readWonderlandWorld(focused, A)).toBe(readWonderlandWorld(worlds, A));
    expect(readWonderlandWorld(focused, B)).toBe(readWonderlandWorld(worlds, B));
  });

  it('keeps folding a world nobody is looking at', () => {
    let worlds = focusWonderlandWorld(twoWorlds(), A);
    worlds = routeWonderlandEvent(worlds, worldEvent(B, 'agent.implementing'));
    worlds = routeWonderlandEvent(worlds, worldEvent(B, 'mission.completed'));
    expect(readWonderlandWorld(worlds, B)?.bridge.embodiment.terminal).toBe(true);
  });

  it('refuses to focus a world nobody is watching', () => {
    const worlds = twoWorlds();
    expect(focusWonderlandWorld(worlds, 'project-z')).toBe(worlds);
    expect(focusWonderlandWorld(worlds, A)).toBe(worlds);
  });
});

/* ------------------------------------------------------- the animation */

describe('planning a world`s animation', () => {
  it('pairs a project with ITSELF across the update, never with another', () => {
    const before = routeWonderlandEvent(twoWorlds(), worldEvent(A, 'agent.implementing'));
    const after = routeWonderlandEvent(before, worldEvent(A, 'agent.repairing'));

    const planA = planWonderlandWorldAnimation(before, after, A);
    expect(planA?.from).toBe('code_type');
    expect(planA?.to).toBe('dig_forward');

    // B did not move, so its plan holds. If the two had been crossed, B would
    // be told to cross-fade into A's work.
    const planB = planWonderlandWorldAnimation(before, after, B);
    expect(planB?.transition).toBe('hold');
    expect(planB?.to).toBe('dormant');
  });

  it('wakes a world that has only just been watched', () => {
    const before = openWonderlandWorlds();
    const after = routeWonderlandEvent(
      watchWonderlandWorld(before, { projectId: A, playerId: PLAYER }),
      worldEvent(A, 'agent.implementing'),
    );
    expect(planWonderlandWorldAnimation(before, after, A)?.transition).toBe('wake');
  });

  it('plans nothing for a world that is no longer watched', () => {
    const before = twoWorlds();
    const after = forgetWonderlandWorld(before, A);
    expect(planWonderlandWorldAnimation(before, after, A)).toBeNull();
  });
});

/* ---------------------------------------------------------- everything */

describe('across every route', () => {
  it('keeps the record and every world frozen', () => {
    const steps: readonly WonderlandWorlds[] = [
      openWonderlandWorlds(),
      twoWorlds(),
      routeWonderlandEvent(twoWorlds(), worldEvent(A, 'agent.implementing')),
      routeWonderlandUsageReport(twoWorlds(), usageReport(A, 10)),
      routeWonderlandEvent(twoWorlds(), worldEvent('project-z', 'agent.implementing')),
      focusWonderlandWorld(twoWorlds(), B),
      forgetWonderlandWorld(twoWorlds(), A),
    ];
    for (const worlds of steps) {
      expect(Object.isFrozen(worlds)).toBe(true);
      expect(Object.isFrozen(worlds.worlds)).toBe(true);
      for (const world of Object.values(worlds.worlds)) expect(Object.isFrozen(world)).toBe(true);
    }
  });

  it('never invents a world', () => {
    const routed = routeWonderlandEvents(openWonderlandWorlds(), [
      worldEvent(A, 'agent.implementing'),
      worldEvent(B, 'mission.completed'),
    ]);
    expect(watchedWonderlandProjects(routed)).toEqual([]);
    expect(routed.unwatchedProjectMessagesDropped).toBe(2);
  });

  it('reports nobody as present, because no renderer exists to make them so', () => {
    const worlds = routeWonderlandEvents(twoWorlds(), [
      worldEvent(A, 'agent.implementing'),
      worldEvent(B, 'mission.completed'),
    ]);
    expect(presentedWonderlandWorlds(worlds)).toEqual([]);
  });
});
