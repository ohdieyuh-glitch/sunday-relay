import { describe, expect, it } from 'vitest';

import { JULIUS_MISSION_STATES } from '../julius/julius-runtime';
import { transitionIsLegal } from '../julius/julius-state-path';
import {
  JULIUS_RUN_STATE_VISUAL_STATE,
  JULIUS_STATE_SOURCES,
  JULIUS_VISUAL_STATES,
} from './wonderland-julius-state';
import type { JuliusVisualState } from './wonderland-julius-state';
import {
  JULIUS_VISUAL_TRANSITIONS,
  VISUAL_STATES_WITHOUT_KERNEL_ORIGIN,
  WONDERLAND_FORBIDDEN_VISUAL_MOVES,
  WONDERLAND_VISUAL_VERDICTS,
  visualTransitionIsKernelReachable,
  wonderlandVisualDecision,
} from './wonderland-visual-transitions';

/**
 * THE VISUAL STATE MACHINE, HELD TO JULIUS'S OWN.
 *
 * A derived table is only safe if something checks that the derivation produced
 * the rules that matter. The forbidden-move sweep is that check: it names the
 * product's commitments, so a change to Julius's table that made any of them
 * reachable is something this repository notices rather than silently adopts.
 */

const decide = (
  from: JuliusVisualState | null,
  to: JuliusVisualState,
  extra: { source?: 'julius_run_state' | 'relay_phase' | 'event_type'; terminal?: boolean } = {},
) =>
  wonderlandVisualDecision({
    from,
    to,
    source: extra.source ?? 'julius_run_state',
    terminal: extra.terminal ?? false,
  });

describe('the derived table', () => {
  it('covers every visual state', () => {
    expect(Object.keys(JULIUS_VISUAL_TRANSITIONS).sort()).toEqual([...JULIUS_VISUAL_STATES].sort());
  });

  it('agrees with the kernel guard for every kernel pair', () => {
    // The derivation, recomputed independently here. If the two ever disagree,
    // the table was hand-edited.
    for (const from of JULIUS_MISSION_STATES) {
      for (const to of JULIUS_MISSION_STATES) {
        if (!transitionIsLegal(from, to)) continue;
        const a = JULIUS_RUN_STATE_VISUAL_STATE[from];
        const b = JULIUS_RUN_STATE_VISUAL_STATE[to];
        if (a === b) continue;
        expect(JULIUS_VISUAL_TRANSITIONS[a]).toContain(b);
      }
    }
  });

  it('claims no move the kernel cannot make', () => {
    for (const from of JULIUS_VISUAL_STATES) {
      for (const to of JULIUS_VISUAL_TRANSITIONS[from]) {
        const backed = JULIUS_MISSION_STATES.some(
          (k1) =>
            JULIUS_RUN_STATE_VISUAL_STATE[k1] === from &&
            JULIUS_MISSION_STATES.some(
              (k2) =>
                JULIUS_RUN_STATE_VISUAL_STATE[k2] === to && transitionIsLegal(k1, k2),
            ),
        );
        expect(backed, `${from} -> ${to} is claimed but no kernel pair backs it`).toBe(true);
      }
    }
  });

  it('lets an ending lead nowhere at all', () => {
    expect(JULIUS_VISUAL_TRANSITIONS.complete).toEqual([]);
    expect(JULIUS_VISUAL_TRANSITIONS.error).toEqual([]);
  });

  it('records that no kernel state maps to idle, because a RUN is never idle', () => {
    // A Julius run is never idle; a MISSION is. `idle` therefore arrives from
    // the Relay phase `ready` and from nowhere else — a real asymmetry rather
    // than a gap in the table.
    expect([...VISUAL_STATES_WITHOUT_KERNEL_ORIGIN]).toEqual(['idle']);
    expect(JULIUS_VISUAL_TRANSITIONS.idle).toEqual([]);
  });

  it('makes recovery from blocked an observable move, not a silence', () => {
    expect(JULIUS_VISUAL_TRANSITIONS.blocked).toContain('coding');
    expect(JULIUS_VISUAL_TRANSITIONS.blocked).toContain('repair');
    expect(JULIUS_VISUAL_TRANSITIONS.blocked).toContain('handoff');
  });

  it('keeps repair distinguishable from first-pass execution', () => {
    // REPAIRING is its own kernel state, so `repair` is its own visual state
    // and a repaired run does not look like a run that never failed.
    expect(JULIUS_VISUAL_TRANSITIONS.repair).toContain('coding');
    expect(JULIUS_VISUAL_TRANSITIONS.repair).toContain('verifying');
    expect(JULIUS_VISUAL_TRANSITIONS.independent_review).toContain('repair');
    expect(JULIUS_VISUAL_TRANSITIONS.verifying).toContain('repair');
  });

  it('treats staying put as not a move', () => {
    for (const state of JULIUS_VISUAL_STATES) {
      expect(visualTransitionIsKernelReachable(state, state)).toBe(false);
    }
  });
});

/* ------------------------------------------------- the product's own rules */

describe('the moves that must never be reachable', () => {
  it('are all absent from the derived table', () => {
    for (const [from, to] of WONDERLAND_FORBIDDEN_VISUAL_MOVES) {
      expect(
        visualTransitionIsKernelReachable(from, to),
        `${from} -> ${to} became reachable`,
      ).toBe(false);
    }
  });

  it('refuses BLOCKED becoming COMPLETE, which is the headline', () => {
    // A blocked run must be observed recovering and then verified. Silence must
    // never resolve into success.
    const decision = decide('blocked', 'complete');
    expect(decision.verdict).toBe('refused_unreachable');
    expect((decision.reason ?? '').length).toBeGreaterThan(20);
  });

  it('refuses ERROR becoming COMPLETE', () => {
    expect(decide('error', 'complete').verdict).toBe('refused_unreachable');
  });
});

/* -------------------------------------------------------------- the guards */

describe('the three guards', () => {
  it('never un-completes a completed mission, whatever the source', () => {
    for (const source of JULIUS_STATE_SOURCES) {
      const decision = wonderlandVisualDecision({
        from: 'complete',
        to: 'coding',
        source,
        terminal: true,
      });
      expect(decision.verdict).toBe('refused_would_uncomplete');
    }
  });

  it('refuses a second, different ending', () => {
    const decision = decide('complete', 'error', { terminal: true });
    expect(decision.verdict).toBe('refused_second_ending');
  });

  it('accepts a redundant repeat of the same ending', () => {
    expect(decide('complete', 'complete', { terminal: true }).verdict).toBe('applied');
  });

  it('holds ONLY kernel-sourced readings to the kernel table', () => {
    // A `verification.failed` event legitimately produces `error` mid-run
    // without the kernel being FAILED. Refusing it because it arrived by a
    // coarser route would discard true information.
    expect(decide('complete', 'coding', { source: 'julius_run_state' }).verdict).toBe(
      'refused_unreachable',
    );
    expect(decide('complete', 'coding', { source: 'event_type' }).verdict).toBe('applied');
    expect(decide('complete', 'coding', { source: 'relay_phase' }).verdict).toBe('applied');
  });

  it('applies anything when nothing is held yet', () => {
    for (const state of JULIUS_VISUAL_STATES) {
      expect(decide(null, state).verdict).toBe('applied');
    }
  });

  it('checks truthfulness before precision', () => {
    // The terminal guards hold regardless of source; the reachability guard
    // applies only where precision exists. An un-completing move from a coarse
    // source is still refused.
    const decision = wonderlandVisualDecision({
      from: 'complete',
      to: 'coding',
      source: 'event_type',
      terminal: true,
    });
    expect(decision.verdict).toBe('refused_would_uncomplete');
  });

  it('names every verdict once and gives every refusal a sentence', () => {
    expect(new Set(WONDERLAND_VISUAL_VERDICTS).size).toBe(WONDERLAND_VISUAL_VERDICTS.length);
    for (const [from, to] of WONDERLAND_FORBIDDEN_VISUAL_MOVES) {
      const decision = decide(from, to);
      if (decision.verdict === 'applied') continue;
      expect(decision.reason).not.toBeNull();
      expect((decision.reason ?? '').endsWith('.')).toBe(true);
    }
  });
});

describe('across every pair', () => {
  it('returns exactly one verdict, always from the vocabulary', () => {
    for (const from of [...JULIUS_VISUAL_STATES, null]) {
      for (const to of JULIUS_VISUAL_STATES) {
        for (const terminal of [false, true]) {
          const decision = wonderlandVisualDecision({
            from,
            to,
            source: 'julius_run_state',
            terminal,
          });
          expect(WONDERLAND_VISUAL_VERDICTS).toContain(decision.verdict);
          expect(decision.reason === null).toBe(decision.verdict === 'applied');
        }
      }
    }
  });

  it('is a pure function', () => {
    const a = decide('coding', 'verifying');
    const b = decide('coding', 'verifying');
    expect(a).toEqual(b);
  });
});
