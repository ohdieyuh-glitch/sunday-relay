import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_RELAY_DOG_ACTIVITIES,
  OFFICIAL_RELAY_DOG_ACTIVITY_MOTION,
} from '../../shared/official-relay-dog-states';
import { WONDERLAND_EVENT_SCHEMA_VERSION } from './wonderland-backend';
import type { WonderlandEvent, WonderlandEventType } from './wonderland-backend';
import {
  WONDERLAND_DOG_ANIMATIONS,
  WONDERLAND_DOG_OVERLAYS,
  WONDERLAND_MOTION_ANIMATION,
} from './wonderland-contracts';
import type { WonderlandDogAnimation } from './wonderland-contracts';
import {
  WONDERLAND_ACTIVITY_CLIP,
  WONDERLAND_ANIMATION_BLEND_MS,
  WONDERLAND_ANIMATION_LOOPS,
  WONDERLAND_ANIMATION_PLAN_FIELDS,
  WONDERLAND_ANIMATION_SCHEMA_V1,
  WONDERLAND_ANIMATION_TRANSITIONS,
  WONDERLAND_REQUIRED_CLIPS,
  planWonderlandAnimation,
  wonderlandClipForJuliusState,
} from './wonderland-julius-animation';
import type { WonderlandAnimationTransition } from './wonderland-julius-animation';
import {
  JULIUS_RELAY_PHASE_PAYLOAD_KEY,
  JULIUS_RUN_STATE_PAYLOAD_KEY,
  JULIUS_VISUAL_STATES,
  applyJuliusEvent,
  emptyJuliusEmbodiment,
} from './wonderland-julius-state';
import type { JuliusEmbodiment, JuliusVisualState } from './wonderland-julius-state';

/**
 * THE ANIMATION PLAN'S OWN TESTS.
 *
 * Everything below drives the plan through the REAL reducer rather than through
 * hand-built embodiments, so a mapping that drifted in the state layer fails
 * here too. Nothing here plays a clip or proves an asset exists — this is the
 * seam between a state and a renderer, and a passing suite means the decision
 * is coherent, not that a mission has ever been animated.
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

/** An embodiment holding exactly one observed state, via the real reducer. */
const observing = (eventType: WonderlandEventType): JuliusEmbodiment =>
  applyJuliusEvent(emptyJuliusEmbodiment({ projectId: PROJECT }), worldEvent({ eventType }));

const unobserved = (): JuliusEmbodiment => emptyJuliusEmbodiment({ projectId: PROJECT });

/* --------------------------------------------------------- the vocabulary */

describe('the animation plan vocabulary', () => {
  it('names one way to get between clips for each situation, and no synonyms', () => {
    expect([...WONDERLAND_ANIMATION_TRANSITIONS].sort()).toEqual(
      ['cross_fade', 'dormant', 'hold', 'interrupt', 'settle', 'wake'].sort(),
    );
    expect(new Set(WONDERLAND_ANIMATION_TRANSITIONS).size).toBe(
      WONDERLAND_ANIMATION_TRANSITIONS.length,
    );
  });

  it('gives every transition a blend duration', () => {
    for (const transition of WONDERLAND_ANIMATION_TRANSITIONS) {
      const ms = WONDERLAND_ANIMATION_BLEND_MS[transition];
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
    expect(Object.keys(WONDERLAND_ANIMATION_BLEND_MS).sort()).toEqual(
      [...WONDERLAND_ANIMATION_TRANSITIONS].sort(),
    );
  });

  it('makes an interrupt a CUT and not merely a fast blend', () => {
    expect(WONDERLAND_ANIMATION_BLEND_MS.interrupt).toBe(0);
    expect(WONDERLAND_ANIMATION_BLEND_MS.hold).toBe(0);
    // An ending is slower than ordinary work. A finish that snaps reads as a fault.
    expect(WONDERLAND_ANIMATION_BLEND_MS.settle).toBeGreaterThan(
      WONDERLAND_ANIMATION_BLEND_MS.cross_fade,
    );
    expect(WONDERLAND_ANIMATION_BLEND_MS.dormant).toBeGreaterThan(
      WONDERLAND_ANIMATION_BLEND_MS.cross_fade,
    );
  });

  it('declares loop behaviour for every clip in the shared vocabulary', () => {
    expect(Object.keys(WONDERLAND_ANIMATION_LOOPS).sort()).toEqual(
      [...WONDERLAND_DOG_ANIMATIONS].sort(),
    );
  });

  it('does not loop the one clip that depicts something settling once', () => {
    expect(WONDERLAND_ANIMATION_LOOPS.halt_slump).toBe(false);
    // Everything else loops: a paused world must not decay into a still frame.
    for (const clip of WONDERLAND_DOG_ANIMATIONS) {
      if (clip !== 'halt_slump') expect(WONDERLAND_ANIMATION_LOOPS[clip]).toBe(true);
    }
  });

  it('lists the plan fields exactly once each', () => {
    expect(new Set(WONDERLAND_ANIMATION_PLAN_FIELDS).size).toBe(
      WONDERLAND_ANIMATION_PLAN_FIELDS.length,
    );
  });
});

/* -------------------------------------------------------- the clip table */

describe('the clip a state resolves to', () => {
  it('is the shared chain composed, never a second opinion', () => {
    for (const activity of OFFICIAL_RELAY_DOG_ACTIVITIES) {
      expect(WONDERLAND_ACTIVITY_CLIP[activity]).toBe(
        WONDERLAND_MOTION_ANIMATION[OFFICIAL_RELAY_DOG_ACTIVITY_MOTION[activity]],
      );
    }
    expect(Object.keys(WONDERLAND_ACTIVITY_CLIP).sort()).toEqual(
      [...OFFICIAL_RELAY_DOG_ACTIVITIES].sort(),
    );
  });

  it('agrees with what the reducer actually put on the embodiment', () => {
    const cases: ReadonlyArray<readonly [WonderlandEventType, JuliusVisualState]> = [
      ['agent.implementing', 'coding'],
      ['agent.reviewing', 'independent_review'],
      ['agent.repairing', 'repair'],
      ['agent.verifying', 'verifying'],
      ['agent.planning', 'prompt_architect'],
      ['mission.completed', 'complete'],
      ['agent.error', 'error'],
    ];
    for (const [eventType, state] of cases) {
      const held = observing(eventType);
      expect(held.visualState).toBe(state);
      expect(held.animation).toBe(wonderlandClipForJuliusState(state));
    }
  });

  it('resolves an unobserved state to dormant and never to a resting clip', () => {
    expect(wonderlandClipForJuliusState(null)).toBe('dormant');
    expect(wonderlandClipForJuliusState(null)).not.toBe('patrol_walk');
    expect(unobserved().animation).toBe('dormant');
  });
});

describe('the clips a renderer must supply', () => {
  it('covers every visual state with no placeholder left over', () => {
    for (const state of JULIUS_VISUAL_STATES) {
      expect(WONDERLAND_REQUIRED_CLIPS).toContain(wonderlandClipForJuliusState(state));
    }
    expect(WONDERLAND_REQUIRED_CLIPS).toContain('dormant');
  });

  it('lists each clip once', () => {
    expect(new Set(WONDERLAND_REQUIRED_CLIPS).size).toBe(WONDERLAND_REQUIRED_CLIPS.length);
  });

  it('names ten slots: eleven states collapse to nine clips, plus dormant', () => {
    const overStates = new Set<WonderlandDogAnimation>(
      JULIUS_VISUAL_STATES.map((state) => wonderlandClipForJuliusState(state)),
    );
    expect(JULIUS_VISUAL_STATES.length).toBe(11);
    expect(overStates.size).toBe(9);
    expect(WONDERLAND_REQUIRED_CLIPS.length).toBe(10);
  });

  it('shares one standing clip across the three facts a body cannot tell apart', () => {
    // This is the documented ambiguity, and it is why terminal and
    // attentionRequired travel WITH the plan rather than being read off a clip.
    const standing = JULIUS_VISUAL_STATES.filter(
      (state) => wonderlandClipForJuliusState(state) === 'stand_still',
    );
    expect([...standing].sort()).toEqual(['attention', 'complete', 'verifying']);
  });

  it('asks for nothing outside the shared animation vocabulary', () => {
    for (const clip of WONDERLAND_REQUIRED_CLIPS) {
      expect(WONDERLAND_DOG_ANIMATIONS).toContain(clip);
    }
  });
});

/* ------------------------------------------------------- the transitions */

describe('planning a transition', () => {
  it('wakes from nothing observed into the first state Relay reports', () => {
    const plan = planWonderlandAnimation(unobserved(), observing('agent.implementing'));
    expect(plan.from).toBe('dormant');
    expect(plan.to).toBe('code_type');
    expect(plan.transition).toBe('wake');
    expect(plan.blendMs).toBe(WONDERLAND_ANIMATION_BLEND_MS.wake);
  });

  it('treats a first frame with no previous embodiment as that same wake', () => {
    const plan = planWonderlandAnimation(null, observing('agent.implementing'));
    expect(plan.from).toBe('dormant');
    expect(plan.transition).toBe('wake');
  });

  it('cross-fades one piece of work into another', () => {
    const plan = planWonderlandAnimation(observing('agent.implementing'), observing('agent.repairing'));
    expect(plan.transition).toBe('cross_fade');
    expect(plan.from).toBe('code_type');
    expect(plan.to).toBe('dig_forward');
  });

  it('holds rather than restarting a clip that has not changed', () => {
    const coding = observing('agent.implementing');
    const plan = planWonderlandAnimation(coding, coding);
    expect(plan.transition).toBe('hold');
    expect(plan.blendMs).toBe(0);
  });

  it('holds across a state change that does not change the clip', () => {
    // attention -> verifying is a real state change and the SAME standing clip.
    // Restarting it would twitch once per event, which reads as the world
    // stuttering; the change is told by the readout, not by the body.
    const plan = planWonderlandAnimation(observing('mission.started'), observing('agent.verifying'));
    expect(plan.from).toBe('stand_still');
    expect(plan.to).toBe('stand_still');
    expect(plan.transition).toBe('hold');
  });

  it('cuts to a state that needs a person', () => {
    const plan = planWonderlandAnimation(observing('agent.implementing'), observing('agent.error'));
    expect(plan.transition).toBe('interrupt');
    expect(plan.blendMs).toBe(0);
    expect(plan.attentionRequired).toBe(true);
  });

  it('cuts to an interrupting state even out of dormancy, where a wake would be gentler', () => {
    const plan = planWonderlandAnimation(unobserved(), observing('agent.error'));
    expect(plan.from).toBe('dormant');
    expect(plan.transition).toBe('interrupt');
  });

  it('settles into a real ending instead of snapping', () => {
    const done = applyJuliusEvent(
      observing('agent.implementing'),
      worldEvent({ eventType: 'mission.completed' }),
    );
    expect(done.terminal).toBe(true);
    const plan = planWonderlandAnimation(observing('agent.implementing'), done);
    expect(plan.transition).toBe('settle');
    expect(plan.blendMs).toBe(WONDERLAND_ANIMATION_BLEND_MS.settle);
  });

  it('cuts, not settles, into a mission that ENDED badly', () => {
    // A failure is an ending AND it needs a person. The person wins: the frame
    // that says the run failed is the next one, not one blended into.
    const failed = applyJuliusEvent(
      observing('agent.implementing'),
      worldEvent({ eventType: 'mission.failed' }),
    );
    expect(failed.terminal).toBe(true);
    const plan = planWonderlandAnimation(observing('agent.implementing'), failed);
    expect(plan.transition).toBe('interrupt');
    expect(plan.blendMs).toBe(0);
  });

  it('does not settle a mid-run state that merely resembles an ending', () => {
    // `verifying` is not an ending and nothing here is terminal; the ordinary
    // blend applies. `settle` must never fire on a run still running.
    const plan = planWonderlandAnimation(observing('agent.implementing'), observing('agent.verifying'));
    expect(plan.transition).toBe('cross_fade');
  });

  it('goes dormant slowly, and never by a cut', () => {
    const plan = planWonderlandAnimation(observing('agent.implementing'), unobserved());
    expect(plan.to).toBe('dormant');
    expect(plan.transition).toBe('dormant');
    expect(plan.blendMs).toBeGreaterThan(0);
    expect(plan.attentionRequired).toBeNull();
  });

  it('rests rather than guessing: an unobserved state neither asks nor works', () => {
    const plan = planWonderlandAnimation(observing('agent.error'), unobserved());
    expect(plan.transition).toBe('dormant');
    expect(plan.attentionRequired).toBeNull();
    expect(plan.to).not.toBe('patrol_walk');
  });
});

/* ------------------------------------------------------------ the plan */

describe('the plan itself', () => {
  it('reports whether the destination loops, so a one-shot is allowed to finish', () => {
    const failing = planWonderlandAnimation(observing('agent.implementing'), observing('agent.error'));
    expect(failing.to).toBe('halt_slump');
    expect(failing.loop).toBe(false);

    const working = planWonderlandAnimation(unobserved(), observing('agent.implementing'));
    expect(working.loop).toBe(true);
  });

  it('carries the overlay through and never decides one', () => {
    const next = observing('agent.implementing');
    expect(planWonderlandAnimation(unobserved(), next).overlay).toBe('none');
    for (const overlay of WONDERLAND_DOG_OVERLAYS) {
      expect(planWonderlandAnimation(unobserved(), next, { overlay }).overlay).toBe(overlay);
    }
  });

  it('always gives a reason a renderer could log', () => {
    for (const state of JULIUS_VISUAL_STATES) {
      const plan = planWonderlandAnimation(unobserved(), stateHolding(state));
      expect(plan.reason.length).toBeGreaterThan(20);
      expect(plan.reason.trim()).toBe(plan.reason);
      expect(plan.reason.endsWith('.')).toBe(true);
    }
  });

  it('is frozen, versioned, and shaped exactly as declared', () => {
    const plan = planWonderlandAnimation(unobserved(), observing('agent.implementing'));
    expect(plan.schemaVersion).toBe(WONDERLAND_ANIMATION_SCHEMA_V1);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.keys(plan).sort()).toEqual([...WONDERLAND_ANIMATION_PLAN_FIELDS].sort());
  });

  it('names no asset, no file and no provider anywhere in its output', () => {
    // The clips are replaceable slots. A plan that leaked a filename would make
    // them not replaceable, and a plan that leaked a provider would put a
    // billing relationship into an animation.
    const plan = planWonderlandAnimation(observing('agent.implementing'), observing('agent.error'));
    const text = JSON.stringify(plan).toLowerCase();
    for (const leak of ['.fbx', '.anim', '.uasset', 'anthropic', 'openai', 'claude', 'gpt', 'sk-']) {
      expect(text).not.toContain(leak);
    }
  });
});

/* ---------------------------------------------------------- exhaustive */

/**
 * EVERY VISUAL STATE, REACHED THROUGH THE REDUCER RATHER THAN HAND-BUILT.
 *
 * Three of the eleven are not reachable from an event TYPE at all, which is
 * itself worth pinning: `idle`, `handoff` and `blocked` arrive as a state the
 * kernel or the phase asserted, carried in the payload. And the kernel has no
 * idle at all — a Julius run is never idle, a MISSION is, so `idle` comes from
 * the Relay phase `ready` and from nowhere else. A fixture that quietly used a
 * hand-built embodiment would have hidden that.
 */
const STATE_FIXTURE: Readonly<Record<JuliusVisualState, () => WonderlandEvent>> = Object.freeze({
  idle: () => worldEvent({ payload: { [JULIUS_RELAY_PHASE_PAYLOAD_KEY]: 'ready' } }),
  attention: () => worldEvent({ eventType: 'mission.started' }),
  prompt_architect: () => worldEvent({ eventType: 'agent.planning' }),
  coding: () => worldEvent({ eventType: 'agent.implementing' }),
  handoff: () => worldEvent({ payload: { [JULIUS_RUN_STATE_PAYLOAD_KEY]: 'READY' } }),
  independent_review: () => worldEvent({ eventType: 'agent.reviewing' }),
  repair: () => worldEvent({ eventType: 'agent.repairing' }),
  verifying: () => worldEvent({ eventType: 'agent.verifying' }),
  complete: () => worldEvent({ eventType: 'agent.complete' }),
  blocked: () => worldEvent({ payload: { [JULIUS_RUN_STATE_PAYLOAD_KEY]: 'BLOCKED' } }),
  error: () => worldEvent({ eventType: 'agent.error' }),
});

function stateHolding(state: JuliusVisualState): JuliusEmbodiment {
  const held = applyJuliusEvent(
    emptyJuliusEmbodiment({ projectId: PROJECT }),
    STATE_FIXTURE[state](),
  );
  // The fixture must genuinely produce the state, or the sweep below proves
  // nothing about the states it thought it covered.
  expect(held.visualState).toBe(state);
  return held;
}

describe('across every pair of states', () => {
  it('produces exactly one plan, always in the declared vocabulary', () => {
    for (const from of JULIUS_VISUAL_STATES) {
      for (const to of JULIUS_VISUAL_STATES) {
        const plan = planWonderlandAnimation(stateHolding(from), stateHolding(to));
        expect(WONDERLAND_ANIMATION_TRANSITIONS).toContain(plan.transition);
        expect(plan.blendMs).toBe(
          WONDERLAND_ANIMATION_BLEND_MS[plan.transition as WonderlandAnimationTransition],
        );
        expect(plan.to).toBe(wonderlandClipForJuliusState(to));
        expect(plan.loop).toBe(WONDERLAND_ANIMATION_LOOPS[plan.to]);
      }
    }
  });

  it('never blends into a state that needs a person', () => {
    for (const from of JULIUS_VISUAL_STATES) {
      for (const to of ['blocked', 'error'] as const) {
        const plan = planWonderlandAnimation(stateHolding(from), stateHolding(to));
        // `hold` is the one exception and it is not a blend: the clip already
        // playing IS the interrupting one, so there is no frame to cut to.
        if (plan.transition === 'hold') {
          expect(plan.from).toBe(plan.to);
          continue;
        }
        expect(plan.transition).toBe('interrupt');
        expect(plan.blendMs).toBe(0);
      }
    }
  });

  it('is a pure function: the same pair plans the same way every time', () => {
    for (const from of JULIUS_VISUAL_STATES) {
      const a = planWonderlandAnimation(stateHolding(from), stateHolding('coding'));
      const b = planWonderlandAnimation(stateHolding(from), stateHolding('coding'));
      expect(a).toEqual(b);
    }
  });
});
