import { describe, expect, it } from 'vitest';

import { JULIUS_ACTIVITY_SIGNALS } from './wonderland-julius-activity';
import { JULIUS_VISUAL_STATES } from './wonderland-julius-state';
import { WONDERLAND_TERMINAL_VISUAL_STATES } from './wonderland-envelope-producer';
import {
  WONDERLAND_ACTIVITY_ACCENTS,
  WONDERLAND_ACTIVITY_INTENT_FIELDS,
  WONDERLAND_ANIMATED_STATES,
  WONDERLAND_REQUIRED_ACCENTS,
  WONDERLAND_SIGNAL_ACCENT,
  WONDERLAND_TERMINAL_STATES,
  planWonderlandActivityIntent,
} from './wonderland-activity-animation';

const plan = (
  signals: readonly (typeof JULIUS_ACTIVITY_SIGNALS)[number][],
  visualState: (typeof JULIUS_VISUAL_STATES)[number] | null = 'coding',
) => planWonderlandActivityIntent({ signals, visualState });

/* ------------------------------------------------------- the vocabulary */

describe('every signal can be shown', () => {
  it('gives every signal an accent, so no fact is unshowable', () => {
    // A signal added without an accent would be something Relay can report and
    // a world cannot express. That is the failure this table prevents.
    expect(Object.keys(WONDERLAND_SIGNAL_ACCENT).sort()).toEqual(
      [...JULIUS_ACTIVITY_SIGNALS].sort(),
    );
    for (const accent of Object.values(WONDERLAND_SIGNAL_ACCENT)) {
      expect(WONDERLAND_ACTIVITY_ACCENTS).toContain(accent);
    }
  });

  it('uses fewer accents than signals, deliberately', () => {
    // A viewer does not need two visual languages for "attempted again".
    expect(WONDERLAND_ACTIVITY_ACCENTS.length).toBeLessThan(JULIUS_ACTIVITY_SIGNALS.length);
    expect(new Set(Object.values(WONDERLAND_SIGNAL_ACCENT)).size).toBe(
      WONDERLAND_ACTIVITY_ACCENTS.length,
    );
  });

  it('names no clip, no colour and no asset', () => {
    // An accent is an INTENT. Naming a clip here would be inventing animation
    // assets without the engine, which is exactly what must not happen.
    const forbidden = /clip|anim|colou?r|sprite|mesh|texture|sound|shader|montage/i;
    for (const accent of WONDERLAND_ACTIVITY_ACCENTS) {
      expect(forbidden.test(accent)).toBe(false);
    }
  });

  it('agrees with the producer about which states end a run', () => {
    expect([...WONDERLAND_TERMINAL_STATES].sort()).toEqual(
      [...WONDERLAND_TERMINAL_VISUAL_STATES].sort(),
    );
  });

  it('lists every visual state for a renderer auditing coverage', () => {
    expect([...WONDERLAND_ANIMATED_STATES].sort()).toEqual([...JULIUS_VISUAL_STATES].sort());
    expect(WONDERLAND_REQUIRED_ACCENTS.length).toBe(WONDERLAND_ACTIVITY_ACCENTS.length);
  });
});

/* --------------------------------------------------------- the priority */

describe('priority is derived from the signal vocabulary', () => {
  it('makes the most urgent signal dominant, whatever order they arrive in', () => {
    const forwards = plan(['retrieving_context', 'awaiting_approval', 'swarming']);
    const backwards = plan(['swarming', 'awaiting_approval', 'retrieving_context']);
    expect(forwards.dominantSignal).toBe('awaiting_approval');
    expect(backwards.dominantSignal).toBe('awaiting_approval');
    expect(forwards.accents).toEqual(backwards.accents);
  });

  it('orders accents by the vocabulary rather than by a second table', () => {
    // Re-ordering JULIUS_ACTIVITY_SIGNALS must re-order the world, once. This
    // asserts the derivation rather than a copy of the result.
    const all = plan([...JULIUS_ACTIVITY_SIGNALS]);
    const expected: string[] = [];
    for (const signal of JULIUS_ACTIVITY_SIGNALS) {
      const accent = WONDERLAND_SIGNAL_ACCENT[signal];
      if (!expected.includes(accent)) expected.push(accent);
    }
    expect(all.accents).toEqual(expected);
  });

  it('carries the dominant SIGNAL as well as the accent', () => {
    // Two signals share `reattempting`; a renderer that wants to tell a retry
    // from a reroute can, and one that does not is not forced to.
    expect(plan(['retrying']).dominant).toBe('reattempting');
    expect(plan(['retrying']).dominantSignal).toBe('retrying');
    expect(plan(['switching_worker']).dominant).toBe('reattempting');
    expect(plan(['switching_worker']).dominantSignal).toBe('switching_worker');
  });

  it('collapses two signals sharing an accent into one', () => {
    const both = plan(['retrying', 'switching_worker']);
    expect(both.accents).toEqual(['reattempting']);
  });

  it('deduplicates a repeated signal', () => {
    expect(plan(['swarming', 'swarming', 'swarming']).accents).toEqual(['accompanied']);
  });
});

/* ------------------------------------------------------- the interrupt */

describe('only a human gate interrupts', () => {
  it('interrupts for an open approval', () => {
    // Nothing is happening until a person acts, and a viewer needs to notice.
    expect(plan(['awaiting_approval']).interrupt).toBe(true);
  });

  it('does not interrupt for the run working noisily', () => {
    // A world that cut its animation for a retry would flicker through a
    // perfectly normal recovery.
    for (const signal of JULIUS_ACTIVITY_SIGNALS.filter((s) => s !== 'awaiting_approval')) {
      expect(plan([signal]).interrupt).toBe(false);
    }
  });

  it('interrupts on the gate even when louder-looking signals are present', () => {
    expect(plan(['swarming', 'provider_degraded', 'awaiting_approval']).interrupt).toBe(true);
  });
});

/* --------------------------------------------------------- the endings */

describe('a finished run shows nothing, and says that is why', () => {
  it('suppresses accents in every terminal state', () => {
    for (const state of WONDERLAND_TERMINAL_STATES) {
      const ended = plan(['awaiting_approval', 'swarming'], state);
      expect(ended.accents).toEqual([]);
      expect(ended.dominant).toBeNull();
      expect(ended.interrupt).toBe(false);
      expect(ended.suppressedByTerminal).toBe(true);
    }
  });

  it('tells a suppressed ending from an empty one', () => {
    // The signals stay on the activity reading — they are the record of what
    // was true while it ran — so a surface must be able to explain which case
    // it is looking at.
    expect(plan([], 'complete').suppressedByTerminal).toBe(false);
    expect(plan(['retrying'], 'complete').suppressedByTerminal).toBe(true);
  });

  it('keeps showing accents in every state that is not an ending', () => {
    const running = JULIUS_VISUAL_STATES.filter(
      (state) => !WONDERLAND_TERMINAL_STATES.includes(state),
    );
    expect(running.length).toBeGreaterThan(5);
    for (const state of running) {
      expect(plan(['swarming'], state).accents).toEqual(['accompanied']);
    }
  });

  it('holds BLOCKED and ERROR to the same rule as COMPLETE', () => {
    // They are different facts and all three are endings. A blocked run is not
    // retrying, whatever its last signal said.
    expect(plan(['retrying'], 'blocked').accents).toEqual([]);
    expect(plan(['retrying'], 'error').accents).toEqual([]);
  });
});

/* --------------------------------------------------------- the unknown */

describe('unobserved shows nothing, and not because nothing is happening', () => {
  it('accents nothing when Relay has said nothing', () => {
    const untold = plan(['awaiting_approval', 'swarming'], null);
    expect(untold.accents).toEqual([]);
    expect(untold.dominant).toBeNull();
    expect(untold.dominantSignal).toBeNull();
    expect(untold.interrupt).toBe(false);
    expect(untold.suppressedByTerminal).toBe(false);
  });

  it('says why, rather than looking like a quiet run', () => {
    expect(plan([], null).reason).toMatch(/has not said/i);
    expect(plan([], 'coding').reason).not.toMatch(/has not said/i);
  });

  it('ignores a signal outside the vocabulary rather than accenting it', () => {
    const rogue = planWonderlandActivityIntent({
      signals: ['something_new' as never, 'swarming'],
      visualState: 'coding',
    });
    expect(rogue.accents).toEqual(['accompanied']);
    expect(rogue.dominantSignal).toBe('swarming');
  });
});

describe('the shape', () => {
  it('names every field it carries, so a C++ mirror cannot drift', () => {
    expect(Object.keys(plan(['swarming'])).sort()).toEqual(
      [...WONDERLAND_ACTIVITY_INTENT_FIELDS].sort(),
    );
  });

  it('always explains itself', () => {
    for (const state of [...JULIUS_VISUAL_STATES, null]) {
      expect(plan(['retrying'], state).reason.length).toBeGreaterThan(10);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(plan(['swarming']))).toBe(true);
  });
});
