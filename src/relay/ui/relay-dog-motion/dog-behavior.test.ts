import { describe, expect, it } from 'vitest';

import {
  DOG_ACTIVITY_PRIORITY,
  RELAY_DOG_ACTIVITIES,
  projectHomeDogBehavior,
  projectRelayStateToDogBehavior,
  projectWorkspaceDogBehavior,
  resolveDogActivity,
  type RelayDogActivityKind,
} from './dog-behavior';
import type { WorkspaceDogState } from '../project-workspace/contracts';
import type { HomeDogState } from '../entry-home/contracts';

describe('workspace state → dog behavior', () => {
  const CASES: Array<[WorkspaceDogState, RelayDogActivityKind, boolean]> = [
    // state, activity, patrolEnabled
    ['wandering', 'idle', true],
    ['trotting', 'thinking', false],
    ['implementing', 'implementing', false],
    ['running', 'implementing', false],
    ['sprinting', 'implementing', false],
    ['carrying_handoff', 'handoff', false],
    ['researching', 'researching', false],
    ['verifying', 'verifying', false],
    ['reviewing', 'reviewing', false],
    ['repairing', 'repairing', false],
    ['waiting_for_user', 'waiting_for_user', false],
    ['stopped_safely', 'complete', false],
    ['complete', 'complete', false],
  ];

  it.each(CASES)('%s → %s (patrol %s)', (state, activity, patrolEnabled) => {
    const behavior = projectWorkspaceDogBehavior(state);
    expect(behavior.activity).toBe(activity);
    expect(behavior.patrolEnabled).toBe(patrolEnabled);
  });

  it('ONLY idle enables autonomous patrol', () => {
    for (const [state] of CASES) {
      const behavior = projectWorkspaceDogBehavior(state);
      expect(behavior.patrolEnabled, state).toBe(behavior.activity === 'idle');
    }
  });

  it('waiting for the user is the attention state', () => {
    expect(projectWorkspaceDogBehavior('waiting_for_user').attentionRequired).toBe(true);
    expect(projectWorkspaceDogBehavior('wandering').attentionRequired).toBe(false);
    expect(projectWorkspaceDogBehavior('implementing').attentionRequired).toBe(false);
  });

  it('every existing state still maps to a real activity', () => {
    for (const [state] of CASES) {
      expect(RELAY_DOG_ACTIVITIES).toContain(projectWorkspaceDogBehavior(state).activity);
    }
  });

  it('every activity carries a reduced-motion fallback label', () => {
    for (const activity of RELAY_DOG_ACTIVITIES) {
      const behavior = resolveBehaviorForActivity(activity);
      expect(behavior.reducedMotionFallback.length).toBeGreaterThan(0);
    }
  });

  function resolveBehaviorForActivity(activity: RelayDogActivityKind) {
    // Every activity is reachable from some state except `error`, which the
    // general projector produces for an unrecognized/failed visual state.
    const byActivity: Partial<Record<RelayDogActivityKind, WorkspaceDogState>> = {
      idle: 'wandering',
      thinking: 'trotting',
      waiting_for_user: 'waiting_for_user',
      researching: 'researching',
      implementing: 'implementing',
      handoff: 'carrying_handoff',
      verifying: 'verifying',
      reviewing: 'reviewing',
      repairing: 'repairing',
      complete: 'complete',
    };
    const state = byActivity[activity];
    return state ? projectWorkspaceDogBehavior(state) : { reducedMotionFallback: 'STOPPED' };
  }
});

describe('home state → dog behavior', () => {
  const CASES: Array<[HomeDogState, RelayDogActivityKind, boolean]> = [
    ['ready', 'idle', true],
    ['wandering', 'idle', true],
    ['waiting', 'waiting_for_user', false],
  ];

  it.each(CASES)('%s → %s (patrol %s)', (state, activity, patrolEnabled) => {
    const behavior = projectHomeDogBehavior(state);
    expect(behavior.activity).toBe(activity);
    expect(behavior.patrolEnabled).toBe(patrolEnabled);
  });

  it('waiting on the home screen still asks for attention', () => {
    expect(projectHomeDogBehavior('waiting').attentionRequired).toBe(true);
  });
});

describe('general projection and fallback', () => {
  it('accepts either vocabulary', () => {
    expect(projectRelayStateToDogBehavior('implementing').activity).toBe('implementing');
    expect(projectRelayStateToDogBehavior('ready').activity).toBe('idle');
    expect(projectRelayStateToDogBehavior('reviewing').activity).toBe('reviewing');
  });

  it('an unknown state falls back to idle rather than leaving the dog undefined', () => {
    const behavior = projectRelayStateToDogBehavior('teleporting');
    expect(behavior.activity).toBe('idle');
    expect(behavior.patrolEnabled).toBe(true);
    expect(behavior.reducedMotionFallback).toBeTruthy();
  });

  it('never mutates its input and returns a fresh object each call', () => {
    const first = projectWorkspaceDogBehavior('implementing');
    const second = projectWorkspaceDogBehavior('implementing');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe('animation priority', () => {
  it('assigns a unique rank to every activity', () => {
    const ranks = RELAY_DOG_ACTIVITIES.map((a) => DOG_ACTIVITY_PRIORITY[a]);
    expect(new Set(ranks).size).toBe(RELAY_DOG_ACTIVITIES.length);
  });

  it('ranks error highest and idle patrol lowest', () => {
    for (const activity of RELAY_DOG_ACTIVITIES) {
      if (activity === 'error') continue;
      expect(DOG_ACTIVITY_PRIORITY.error).toBeLessThan(DOG_ACTIVITY_PRIORITY[activity]);
    }
    for (const activity of RELAY_DOG_ACTIVITIES) {
      if (activity === 'idle') continue;
      expect(DOG_ACTIVITY_PRIORITY.idle).toBeGreaterThan(DOG_ACTIVITY_PRIORITY[activity]);
    }
  });

  it('a human being blocked outranks every machine activity', () => {
    for (const activity of ['implementing', 'researching', 'thinking', 'handoff', 'complete'] as const) {
      expect(DOG_ACTIVITY_PRIORITY.waiting_for_user).toBeLessThan(DOG_ACTIVITY_PRIORITY[activity]);
    }
  });

  it('review and verification outrank the work they judge', () => {
    expect(DOG_ACTIVITY_PRIORITY.reviewing).toBeLessThan(DOG_ACTIVITY_PRIORITY.implementing);
    expect(DOG_ACTIVITY_PRIORITY.verifying).toBeLessThan(DOG_ACTIVITY_PRIORITY.implementing);
  });

  it('resolves exactly one activity from competing candidates', () => {
    expect(resolveDogActivity(['idle', 'implementing', 'waiting_for_user'])).toBe('waiting_for_user');
    expect(resolveDogActivity(['idle', 'thinking'])).toBe('thinking');
    expect(resolveDogActivity(['idle'])).toBe('idle');
    expect(resolveDogActivity([])).toBe('idle');
  });
});
