import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_RELAY_DOG_ACTIVITIES,
  OFFICIAL_RELAY_DOG_ACTIVITY_MOTION,
  officialRelayDogView,
} from '../../shared/official-relay-dog-states';
import { JULIUS_OPERATIONAL_EVENT_TYPES } from '../julius/julius-events';
import type { JuliusOperationalEvent } from '../julius/julius-events';
import { JULIUS_MISSION_STATES } from '../julius/julius-runtime';
import { WONDERLAND_EVENT_SCHEMA_VERSION } from './wonderland-backend';
import type { WonderlandEvent, WonderlandEventType } from './wonderland-backend';
import { WONDERLAND_MOTION_ANIMATION, wonderlandAnimationFor } from './wonderland-contracts';
import {
  JULIUS_EMBODIMENT_FIELDS,
  JULIUS_ENDING_STATES,
  JULIUS_EVENT_VISUAL_STATE,
  JULIUS_MISSION_PHASES,
  JULIUS_OPERATIONAL_EVENT_VISUAL_STATE,
  JULIUS_PHASE_TERMINAL,
  JULIUS_PHASE_VISUAL_STATE,
  JULIUS_RELAY_PHASE_PAYLOAD_KEY,
  JULIUS_RUN_STATE_PAYLOAD_KEY,
  JULIUS_RUN_STATE_VISUAL_STATE,
  JULIUS_STATE_SOURCES,
  JULIUS_TERMINAL_EVENTS,
  JULIUS_UNOBSERVED_REASON,
  JULIUS_VISUAL_STATES,
  JULIUS_VISUAL_STATE_ACTIVITY,
  JULIUS_VISUAL_STATE_PRIORITY,
  RELAY_MISSION_STATE_VISUAL_STATE,
  applyJuliusEvent,
  emptyJuliusEmbodiment,
  isJuliusMissionState,
  isMissionPhase,
  juliusReplayCursor,
  readJuliusState,
  rehydrateJuliusEmbodiment,
  resolveJuliusVisualState,
} from './wonderland-julius-state';
import type { JuliusVisualState } from './wonderland-julius-state';
import {
  JULIUS_TO_WONDERLAND_EVENT_TYPE,
  normalizeJuliusOperationalEvent,
  normalizeJuliusOperationalEvents,
} from './wonderland-julius-normalizer';

/**
 * JULIUS -> WONDERLAND, the integration seam's own tests.
 *
 * These prove the MAPPING and the ORDERING. They deliberately prove nothing
 * about a live Julius: every event below is constructed in this file, and a
 * passing suite here means the seam is integration-ready, not that a real
 * mission has ever driven the world. That distinction is the whole reason the
 * handoff document carries a separate "proven against real live Julius"
 * column — a test that manufactured its own input and then reported the world
 * connected would be exactly the untruth this repository is built to refuse.
 */

const PROJECT = 'project-1';

let nextSequence = 0;

function worldEvent(overrides: Partial<WonderlandEvent> = {}): WonderlandEvent {
  nextSequence += 1;
  return {
    eventId: `evt-${nextSequence}`,
    schemaVersion: WONDERLAND_EVENT_SCHEMA_VERSION,
    timestamp: '2026-09-07T10:00:00.000Z',
    projectId: PROJECT,
    sessionId: null,
    playerId: null,
    agentId: null,
    missionId: null,
    battleId: null,
    eventType: 'mission.stage_changed',
    payload: {},
    visibility: 'OWNER',
    correlationId: 'corr-1',
    causationId: null,
    sequence: nextSequence,
    ...overrides,
  };
}

const kernelEvent = (
  overrides: Partial<JuliusOperationalEvent> = {},
): JuliusOperationalEvent => ({
  eventId: 'julius-1',
  runId: 'run-1',
  projectId: PROJECT,
  type: 'run.transitioned',
  taskId: null,
  workerId: null,
  correlationId: 'corr-1',
  causationId: null,
  occurredAt: '2026-09-07T10:00:00.000Z',
  facts: {},
  ...overrides,
});

/* ------------------------------------------------------- the vocabulary */

describe('the Julius visual vocabulary', () => {
  it('names every state the founder asked the world to show', () => {
    expect([...JULIUS_VISUAL_STATES].sort()).toEqual(
      [
        'attention',
        'blocked',
        'coding',
        'complete',
        'error',
        'handoff',
        'idle',
        'independent_review',
        'prompt_architect',
        'repair',
        'verifying',
      ].sort(),
    );
  });

  it('names no provider, model or vendor', () => {
    // The founder's rule: the user sees Julius's FUNCTION, never which vendor
    // happens to occupy a slot. A provider name here would leak a commercial
    // relationship into an animation.
    const forbidden =
      /claude|anthropic|openai|gpt|codex|hermes|sonnet|opus|haiku|gemini|llama|mistral|sdk|api/i;
    for (const state of JULIUS_VISUAL_STATES) expect(state).not.toMatch(forbidden);
  });

  it('is a bijection onto the shared dog activities, so no second vocabulary exists', () => {
    const activities = JULIUS_VISUAL_STATES.map((state) => JULIUS_VISUAL_STATE_ACTIVITY[state]);
    expect(new Set(activities).size).toBe(JULIUS_VISUAL_STATES.length);
    expect([...activities].sort()).toEqual([...OFFICIAL_RELAY_DOG_ACTIVITIES].sort());
  });

  it('derives a strict interrupt order with no ties, so two states cannot animate at once', () => {
    const priorities = JULIUS_VISUAL_STATES.map((state) => JULIUS_VISUAL_STATE_PRIORITY[state]);
    expect(new Set(priorities).size).toBe(JULIUS_VISUAL_STATES.length);
  });

  it('resolves the highest-priority candidate, and null for none', () => {
    expect(resolveJuliusVisualState([])).toBeNull();
    // A failure outranks a completion, and a blocked human outranks machine work.
    expect(resolveJuliusVisualState(['complete', 'error', 'coding'])).toBe('error');
    expect(resolveJuliusVisualState(['coding', 'blocked'])).toBe('blocked');
    expect(resolveJuliusVisualState(['idle', 'coding'])).toBe('coding');
  });

  it('reaches a real animation clip for every state, and never dormant for an observed one', () => {
    for (const state of JULIUS_VISUAL_STATES) {
      const activity = JULIUS_VISUAL_STATE_ACTIVITY[state];
      const motion = OFFICIAL_RELAY_DOG_ACTIVITY_MOTION[activity];
      const animation = wonderlandAnimationFor(motion);
      expect(animation).toBe(WONDERLAND_MOTION_ANIMATION[motion]);
      expect(animation).not.toBe('dormant');
    }
  });

  it('asks for a human on exactly the two states that need one', () => {
    const attention = JULIUS_VISUAL_STATES.filter(
      (state) => officialRelayDogView(JULIUS_VISUAL_STATE_ACTIVITY[state]).attentionRequired,
    );
    expect([...attention].sort()).toEqual(['blocked', 'error']);
  });
});

/* --------------------------------------------------------- derivations */

describe('deriving a visual state from what Julius reports', () => {
  it('is total over every mission phase the live runtime can report', () => {
    expect(JULIUS_MISSION_PHASES.length).toBe(28);
    for (const phase of JULIUS_MISSION_PHASES) {
      expect(JULIUS_VISUAL_STATES).toContain(JULIUS_PHASE_VISUAL_STATE[phase]);
      expect(typeof JULIUS_PHASE_TERMINAL[phase]).toBe('boolean');
    }
  });

  it('is total over every state the Julius kernel can hold', () => {
    expect(JULIUS_MISSION_STATES.length).toBe(13);
    for (const state of JULIUS_MISSION_STATES) {
      expect(JULIUS_VISUAL_STATES).toContain(JULIUS_RUN_STATE_VISUAL_STATE[state]);
    }
  });

  it('never renders a queued role as a working one', () => {
    // `prompt_architect_queued` is not the architect working. Announcing an
    // intention as a fact is the defect this whole layer exists to avoid.
    expect(JULIUS_PHASE_VISUAL_STATE.prompt_architect_queued).toBe('attention');
    expect(JULIUS_PHASE_VISUAL_STATE.prompt_architect_working).toBe('prompt_architect');
  });

  it('carries work between roles as its own state, never as the destination role', () => {
    for (const phase of [
      'handoff_ready',
      'coding_agent_assigned',
      'coding_agent_starting',
      'claim_submitted',
      'reviewer_assigned',
      'reviewer_starting',
    ] as const) {
      expect(JULIUS_PHASE_VISUAL_STATE[phase]).toBe('handoff');
    }
    expect(JULIUS_PHASE_VISUAL_STATE.coding).toBe('coding');
    expect(JULIUS_PHASE_VISUAL_STATE.reviewer_working).toBe('independent_review');
  });

  it('separates a stop from a fault and from a success', () => {
    // A ceiling and a cancellation are stops. They are not errors, and above
    // all they are not completions.
    for (const phase of [
      'budget_exhausted',
      'cancelled',
      'preflight_blocked',
      'review_blocked',
    ] as const) {
      expect(JULIUS_PHASE_VISUAL_STATE[phase]).toBe('blocked');
    }
    for (const phase of [
      'coding_agent_failed',
      'verification_failed',
      'reviewer_launch_failed',
      'timed_out',
    ] as const) {
      expect(JULIUS_PHASE_VISUAL_STATE[phase]).toBe('error');
    }
    expect(JULIUS_PHASE_VISUAL_STATE.verified_complete).toBe('complete');
  });

  it('lets no phase but the verified one reach complete', () => {
    const completing = JULIUS_MISSION_PHASES.filter(
      (phase) => JULIUS_PHASE_VISUAL_STATE[phase] === 'complete',
    );
    expect(completing).toEqual(['verified_complete']);
  });

  it('lets no kernel state but COMPLETED reach complete', () => {
    const completing = JULIUS_MISSION_STATES.filter(
      (state) => JULIUS_RUN_STATE_VISUAL_STATE[state] === 'complete',
    );
    expect(completing).toEqual(['COMPLETED']);
  });

  it('reaches repair through the kernel, which is the only vocabulary that names it', () => {
    expect(JULIUS_RUN_STATE_VISUAL_STATE.REPAIRING).toBe('repair');
    expect(RELAY_MISSION_STATE_VISUAL_STATE.repair_in_progress).toBe('repair');
    // The live runtime's phase model has no repair phase yet. Stating the
    // absence keeps it a dependency on the Julius session rather than a gap.
    expect(
      JULIUS_MISSION_PHASES.filter((phase) => JULIUS_PHASE_VISUAL_STATE[phase] === 'repair'),
    ).toEqual([]);
  });

  it('treats an approval as a verdict, not as a completion', () => {
    expect(RELAY_MISSION_STATE_VISUAL_STATE.approved).toBe('verifying');
    expect(RELAY_MISSION_STATE_VISUAL_STATE.verified_complete).toBe('complete');
  });

  it('recognises exactly the vocabularies it claims to', () => {
    expect(isMissionPhase('coding')).toBe(true);
    expect(isMissionPhase('EXECUTING')).toBe(false);
    expect(isMissionPhase(7)).toBe(false);
    expect(isJuliusMissionState('EXECUTING')).toBe(true);
    expect(isJuliusMissionState('coding')).toBe(false);
    expect(isJuliusMissionState(null)).toBe(false);
  });
});

/* ------------------------------------------------------- reading events */

describe('reading a state out of one world event', () => {
  it('prefers the kernel state over the phase over the event type', () => {
    const both = worldEvent({
      eventType: 'agent.implementing',
      payload: {
        [JULIUS_RUN_STATE_PAYLOAD_KEY]: 'REVIEWING',
        [JULIUS_RELAY_PHASE_PAYLOAD_KEY]: 'coding',
      },
    });
    expect(readJuliusState(both)).toEqual({
      visualState: 'independent_review',
      source: 'julius_run_state',
      relayPhase: null,
      sourceState: 'REVIEWING',
    });

    const phaseOnly = worldEvent({
      eventType: 'agent.implementing',
      payload: { [JULIUS_RELAY_PHASE_PAYLOAD_KEY]: 'reviewer_working' },
    });
    expect(readJuliusState(phaseOnly)).toEqual({
      visualState: 'independent_review',
      source: 'relay_phase',
      relayPhase: 'reviewer_working',
      sourceState: 'reviewer_working',
    });

    const typeOnly = worldEvent({ eventType: 'agent.implementing' });
    expect(readJuliusState(typeOnly)?.source).toBe('event_type');
  });

  it('declares its precedence as data, most precise first', () => {
    expect(JULIUS_STATE_SOURCES).toEqual(['julius_run_state', 'relay_phase', 'event_type']);
  });

  it('ignores a payload state that Julius could not have been in', () => {
    const bogus = worldEvent({
      eventType: 'agent.implementing',
      payload: { [JULIUS_RUN_STATE_PAYLOAD_KEY]: 'ASCENDED' },
    });
    // Degrades to the coarser link rather than putting an impossible state in
    // the world.
    expect(readJuliusState(bogus)?.source).toBe('event_type');
  });

  it('says nothing about Julius for an event that is about something else', () => {
    for (const eventType of [
      'presence.joined',
      'battle.started',
      'project_avatar.evolved',
      'mission.stage_changed',
    ] as const) {
      expect(readJuliusState(worldEvent({ eventType }))).toBeNull();
    }
  });
});

/* ----------------------------------------------------------- the reducer */

describe('folding events into one embodied Julius', () => {
  it('starts unobserved, and unobserved is not idle', () => {
    const empty = emptyJuliusEmbodiment({ projectId: PROJECT });
    expect(empty.visualState).toBeNull();
    expect(empty.activity).toBeNull();
    expect(empty.motion).toBeNull();
    expect(empty.animation).toBe('dormant');
    expect(empty.attentionRequired).toBeNull();
    expect(empty.unobservedReason).toBe(JULIUS_UNOBSERVED_REASON);
    expect(empty.sequence).toBe(0);
    expect(empty.terminal).toBe(false);
  });

  it('applies an observed state through the whole presentation chain', () => {
    const state = applyJuliusEvent(
      emptyJuliusEmbodiment({ projectId: PROJECT }),
      worldEvent({
        eventType: 'mission.stage_changed',
        missionId: 'mission-1',
        agentId: 'agent-1',
        payload: { [JULIUS_RUN_STATE_PAYLOAD_KEY]: 'EXECUTING' },
      }),
    );
    expect(state.visualState).toBe('coding');
    expect(state.activity).toBe('implementing');
    expect(state.motion).toBe('code_progression');
    expect(state.animation).toBe('code_type');
    expect(state.attentionRequired).toBe(false);
    expect(state.missionId).toBe('mission-1');
    expect(state.agentId).toBe('agent-1');
    expect(state.unobservedReason).toBeNull();
    expect(state.observedAtIso).toBe('2026-09-07T10:00:00.000Z');
  });

  it('rejects an event from another project without moving its cursor', () => {
    const start = applyJuliusEvent(
      emptyJuliusEmbodiment({ projectId: PROJECT }),
      worldEvent({ eventType: 'agent.implementing' }),
    );
    const after = applyJuliusEvent(
      start,
      worldEvent({ projectId: 'someone-else', eventType: 'mission.failed' }),
    );
    expect(after.sequence).toBe(start.sequence);
    expect(after.visualState).toBe('coding');
    expect(after.foreignProjectEventsRejected).toBe(1);
  });

  it('rejects a stale or duplicate sequence, which is what makes replay safe', () => {
    const first = applyJuliusEvent(
      emptyJuliusEmbodiment({ projectId: PROJECT }),
      worldEvent({ eventType: 'agent.implementing', sequence: 10 }),
    );
    const replayed = applyJuliusEvent(
      first,
      worldEvent({ eventType: 'agent.planning', sequence: 10 }),
    );
    expect(replayed.visualState).toBe('coding');
    expect(replayed.staleEventsRejected).toBe(1);

    const older = applyJuliusEvent(
      replayed,
      worldEvent({ eventType: 'mission.completed', sequence: 4 }),
    );
    // An out-of-order arrival must not be able to complete a running mission.
    expect(older.visualState).toBe('coding');
    expect(older.terminal).toBe(false);
    expect(older.staleEventsRejected).toBe(2);
  });

  it('accepts a gap and counts it, rather than stranding the world or hiding it', () => {
    const first = applyJuliusEvent(
      emptyJuliusEmbodiment({ projectId: PROJECT }),
      worldEvent({ eventType: 'agent.planning', sequence: 5 }),
    );
    const jumped = applyJuliusEvent(
      first,
      worldEvent({ eventType: 'agent.implementing', sequence: 9 }),
    );
    expect(jumped.visualState).toBe('coding');
    expect(jumped.sequence).toBe(9);
    expect(jumped.sequenceGapsObserved).toBe(1);
  });

  it('skips another mission inside the same project but keeps the cursor moving', () => {
    const start = applyJuliusEvent(
      emptyJuliusEmbodiment({ projectId: PROJECT, missionId: 'mission-1' }),
      worldEvent({ eventType: 'agent.implementing', missionId: 'mission-1' }),
    );
    const other = applyJuliusEvent(
      start,
      worldEvent({ eventType: 'mission.failed', missionId: 'mission-2' }),
    );
    expect(other.visualState).toBe('coding');
    expect(other.terminal).toBe(false);
    expect(other.foreignMissionEventsSkipped).toBe(1);
    expect(other.sequence).toBeGreaterThan(start.sequence);
  });

  it('ignores an event it does not model, and says how many', () => {
    const start = applyJuliusEvent(
      emptyJuliusEmbodiment({ projectId: PROJECT }),
      worldEvent({ eventType: 'agent.implementing' }),
    );
    const after = applyJuliusEvent(start, worldEvent({ eventType: 'presence.joined' }));
    expect(after.visualState).toBe('coding');
    expect(after.unmodelledEventsIgnored).toBe(1);
    expect(after.sequence).toBeGreaterThan(start.sequence);
  });

  it('recovers out of an error when a repair actually starts', () => {
    const failed = rehydrateJuliusEmbodiment({ projectId: PROJECT }, [
      worldEvent({ eventType: 'agent.implementing' }),
      worldEvent({ eventType: 'verification.failed' }),
    ]);
    expect(failed.visualState).toBe('error');
    expect(failed.terminal).toBe(false);

    const repairing = applyJuliusEvent(
      failed,
      worldEvent({
        eventType: 'mission.stage_changed',
        payload: { [JULIUS_RUN_STATE_PAYLOAD_KEY]: 'REPAIRING' },
      }),
    );
    expect(repairing.visualState).toBe('repair');
    expect(repairing.animation).toBe('dig_forward');
  });
});

/* ------------------------------------------- the rules that must not bend */

describe('what the world may never claim', () => {
  it('lets no error or blocked state masquerade as complete', () => {
    for (const eventType of [
      'agent.error',
      'mission.failed',
      'verification.failed',
    ] as const) {
      const state = rehydrateJuliusEmbodiment({ projectId: PROJECT }, [worldEvent({ eventType })]);
      expect(state.visualState).toBe('error');
      expect(state.visualState).not.toBe('complete');
    }
    for (const runState of ['BLOCKED', 'PAUSED', 'CANCELLED', 'WAITING'] as const) {
      const state = rehydrateJuliusEmbodiment({ projectId: PROJECT }, [
        worldEvent({ payload: { [JULIUS_RUN_STATE_PAYLOAD_KEY]: runState } }),
      ]);
      expect(state.visualState).toBe('blocked');
    }
  });

  it('lets no transport condition produce a completion', () => {
    // Every non-ending path through the reducer, run against a state that has
    // never been told a mission ended.
    const running = rehydrateJuliusEmbodiment({ projectId: PROJECT }, [
      worldEvent({ eventType: 'agent.implementing', sequence: 20 }),
    ]);
    const transportNoise = [
      worldEvent({ projectId: 'elsewhere', eventType: 'mission.completed' }),
      worldEvent({ eventType: 'mission.completed', sequence: 3 }),
      worldEvent({ eventType: 'presence.left', sequence: 30 }),
    ];
    const after = transportNoise.reduce(applyJuliusEvent, running);
    expect(after.terminal).toBe(false);
    expect(after.visualState).toBe('coding');
  });

  it('latches an ending so a completion cannot be taken back', () => {
    const done = rehydrateJuliusEmbodiment({ projectId: PROJECT }, [
      worldEvent({ eventType: 'mission.completed' }),
    ]);
    expect(done.terminal).toBe(true);
    const later = applyJuliusEvent(done, worldEvent({ eventType: 'agent.implementing' }));
    expect(later.terminal).toBe(true);
  });

  it('sets terminal from an ending event and from nothing else', () => {
    expect([...JULIUS_TERMINAL_EVENTS].sort()).toEqual(['mission.completed', 'mission.failed']);
    const nonEnding = (Object.keys(JULIUS_EVENT_VISUAL_STATE) as WonderlandEventType[]).filter(
      (eventType) => !JULIUS_TERMINAL_EVENTS.includes(eventType),
    );
    for (const eventType of nonEnding) {
      expect(
        rehydrateJuliusEmbodiment({ projectId: PROJECT }, [worldEvent({ eventType })]).terminal,
      ).toBe(false);
    }
  });

  it('keeps the ending vocabulary honest about which one succeeded', () => {
    expect([...JULIUS_ENDING_STATES].sort()).toEqual(['blocked', 'complete', 'error']);
  });

  it('carries every field the manifest names', () => {
    const state = emptyJuliusEmbodiment({ projectId: PROJECT });
    expect(Object.keys(state).sort()).toEqual([...JULIUS_EMBODIMENT_FIELDS].sort());
  });
});

/* ------------------------------------------------ reconnect / rehydration */

describe('recovering after a lost stream', () => {
  const stream = (): readonly WonderlandEvent[] => [
    worldEvent({ eventType: 'mission.created', missionId: 'mission-1' }),
    worldEvent({ payload: { [JULIUS_RELAY_PHASE_PAYLOAD_KEY]: 'prompt_architect_working' } }),
    worldEvent({ payload: { [JULIUS_RELAY_PHASE_PAYLOAD_KEY]: 'coding' } }),
    worldEvent({ eventType: 'presence.updated' }),
    worldEvent({ payload: { [JULIUS_RELAY_PHASE_PAYLOAD_KEY]: 'reviewer_working' } }),
  ];

  it('reaches the same state a client that never disconnected would hold', () => {
    const events = stream();
    const uninterrupted = rehydrateJuliusEmbodiment({ projectId: PROJECT }, events);

    // Drop out after the third event and replay from the cursor, exactly as the
    // events route's `?cursor=` contract allows.
    const partial = rehydrateJuliusEmbodiment({ projectId: PROJECT }, events.slice(0, 3));
    const cursor = juliusReplayCursor(partial);
    const replayed = events.filter((event) => event.sequence > cursor);
    const recovered = replayed.reduce(applyJuliusEvent, partial);

    expect(recovered.visualState).toBe(uninterrupted.visualState);
    expect(recovered.sequence).toBe(uninterrupted.sequence);
    expect(recovered.animation).toBe(uninterrupted.animation);
  });

  it('survives the overlap a replay-then-subscribe stream deliberately produces', () => {
    const events = stream();
    const clean = rehydrateJuliusEmbodiment({ projectId: PROJECT }, events);
    // The route replays from a cursor and then attaches live, so the last few
    // events arrive twice by design.
    const withOverlap = [...events, ...events.slice(-2)].reduce(
      applyJuliusEvent,
      emptyJuliusEmbodiment({ projectId: PROJECT }),
    );
    expect(withOverlap.visualState).toBe(clean.visualState);
    expect(withOverlap.sequence).toBe(clean.sequence);
    expect(withOverlap.staleEventsRejected).toBe(2);
  });

  it('resumes from exactly the highest applied sequence', () => {
    const state = rehydrateJuliusEmbodiment({ projectId: PROJECT }, stream());
    expect(juliusReplayCursor(state)).toBe(state.sequence);
  });
});

/* ------------------------------------------------------- the normalizer */

describe('normalizing a real Julius runtime event', () => {
  it('carries the kernel state so the world reads the kernel, not a guess', () => {
    const normalized = normalizeJuliusOperationalEvent({
      event: kernelEvent({ type: 'run.transitioned', facts: { to: 'REPAIRING' } }),
      sequence: 1,
      eventId: 'w-1',
      identity: { missionId: 'mission-1', agentId: 'agent-1' },
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.eventType).toBe('mission.stage_changed');
    expect(normalized?.payload[JULIUS_RUN_STATE_PAYLOAD_KEY]).toBe('REPAIRING');
    expect(normalized?.missionId).toBe('mission-1');
    expect(normalized?.visibility).toBe('OWNER');
    expect(readJuliusState(normalized as WonderlandEvent)?.visualState).toBe('repair');
  });

  it('refuses to invent a world type for a kernel event that has none', () => {
    for (const type of [
      'budget.settled',
      'context.compiled',
      'worker.dispatched',
      'task.claimed',
      'repair.scheduled',
    ] as const) {
      expect(
        normalizeJuliusOperationalEvent({
          event: kernelEvent({ type }),
          sequence: 1,
          eventId: 'w-1',
        }),
      ).toBeNull();
    }
  });

  it('never derives an agent identity from a dispatch slot', () => {
    const normalized = normalizeJuliusOperationalEvent({
      event: kernelEvent({ type: 'run.created', workerId: 'worker-7' }),
      sequence: 1,
      eventId: 'w-1',
    });
    expect(normalized?.agentId).toBeNull();
    expect(JSON.stringify(normalized?.payload)).not.toContain('worker-7');
  });

  it('drops a destination state Julius could not have been in', () => {
    const normalized = normalizeJuliusOperationalEvent({
      event: kernelEvent({ type: 'run.transitioned', facts: { to: 'ASCENDED' } }),
      sequence: 1,
      eventId: 'w-1',
    });
    expect(normalized?.payload[JULIUS_RUN_STATE_PAYLOAD_KEY]).toBeUndefined();
  });

  it('redacts a fact the kernel let through', () => {
    const normalized = normalizeJuliusOperationalEvent({
      event: kernelEvent({
        type: 'run.created',
        facts: { reasonCode: 'Bearer sk-abcdefghijklmnop' },
      }),
      sequence: 1,
      eventId: 'w-1',
    });
    expect(JSON.stringify(normalized?.payload)).not.toContain('abcdefghijklmnop');
  });

  it('refuses a sequence it was not given by the ledger', () => {
    for (const sequence of [0, -1, 1.5, Number.NaN]) {
      expect(
        normalizeJuliusOperationalEvent({
          event: kernelEvent({ type: 'run.created' }),
          sequence,
          eventId: 'w-1',
        }),
      ).toBeNull();
    }
  });

  it('allocates world sequences densely, so a silent event leaves no false gap', () => {
    const result = normalizeJuliusOperationalEvents(
      [
        kernelEvent({ type: 'run.created' }),
        kernelEvent({ type: 'budget.settled' }),
        kernelEvent({ type: 'run.transitioned', facts: { toState: 'EXECUTING' } }),
        kernelEvent({ type: 'context.compiled' }),
        kernelEvent({ type: 'run.completed' }),
      ],
      { baseSequence: 40, nextEventId: (_event, index) => `w-${index}` },
    );
    expect(result.silentEvents).toBe(2);
    expect(result.events.map((event) => event.sequence)).toEqual([41, 42, 43]);

    const state = rehydrateJuliusEmbodiment({ projectId: PROJECT }, result.events);
    expect(state.sequenceGapsObserved).toBe(0);
    expect(state.visualState).toBe('complete');
    expect(state.terminal).toBe(true);
  });

  it('claims only kernel event types that exist, in both directions', () => {
    const declared = Object.keys(JULIUS_TO_WONDERLAND_EVENT_TYPE);
    for (const type of declared) expect(JULIUS_OPERATIONAL_EVENT_TYPES).toContain(type);
    for (const type of Object.keys(JULIUS_OPERATIONAL_EVENT_VISUAL_STATE)) {
      expect(JULIUS_OPERATIONAL_EVENT_TYPES).toContain(type);
    }
    // The two tables must agree about silence: a kernel event with no world
    // type also has no visual state, because both would be the same guess.
    const visualOnly = Object.keys(JULIUS_OPERATIONAL_EVENT_VISUAL_STATE).filter(
      (type) => !declared.includes(type),
    );
    expect(visualOnly.sort()).toEqual(['approval.requested', 'budget.denied', 'verification.decided']);
  });

  it('never lets the two tables disagree about one kernel event', () => {
    // A kernel event reaches the world by BOTH paths: read directly, and
    // normalized into a world event and read through the other table. Two
    // answers for one event is drift with a delay fuse — a finding recorded
    // mid-review resolved to `independent_review` one way and `verifying` the
    // other, and the world flipped stage for something nothing performed.
    const offenders: string[] = [];
    for (const [kernelType, worldType] of Object.entries(JULIUS_TO_WONDERLAND_EVENT_TYPE)) {
      const direct =
        JULIUS_OPERATIONAL_EVENT_VISUAL_STATE[kernelType as keyof typeof JULIUS_OPERATIONAL_EVENT_VISUAL_STATE];
      const viaWorld = JULIUS_EVENT_VISUAL_STATE[worldType as WonderlandEventType];
      if (direct !== undefined && viaWorld !== undefined && direct !== viaWorld) {
        offenders.push(`${kernelType}: direct ${direct}, via ${worldType} ${viaWorld}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------ coverage */

describe('the seam is honest about what it does not cover', () => {
  it('maps every world event type that names a mission-pipeline fact', () => {
    const modelled = new Set<string>(Object.keys(JULIUS_EVENT_VISUAL_STATE));
    for (const eventType of [
      'mission.created',
      'mission.started',
      'mission.completed',
      'mission.failed',
      'agent.planning',
      'agent.implementing',
      'agent.reviewing',
      'agent.verifying',
      'agent.repairing',
      'agent.complete',
      'agent.error',
    ]) {
      expect(modelled.has(eventType)).toBe(true);
    }
  });

  it('models no event that belongs to another subject', () => {
    for (const eventType of [
      'presence.joined',
      'presence.updated',
      'presence.left',
      'battle.created',
      'battle.completed',
      'project_avatar.evolved',
      'subagent.spawned',
    ]) {
      expect(Object.keys(JULIUS_EVENT_VISUAL_STATE)).not.toContain(eventType);
    }
  });

  it('reaches every visual state from at least one real Relay vocabulary', () => {
    const reachable = new Set<JuliusVisualState>([
      ...JULIUS_MISSION_PHASES.map((phase) => JULIUS_PHASE_VISUAL_STATE[phase]),
      ...JULIUS_MISSION_STATES.map((state) => JULIUS_RUN_STATE_VISUAL_STATE[state]),
    ]);
    for (const state of JULIUS_VISUAL_STATES) expect(reachable.has(state)).toBe(true);
  });
});
