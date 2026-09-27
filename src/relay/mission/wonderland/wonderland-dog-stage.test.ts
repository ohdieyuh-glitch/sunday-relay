import { describe, expect, it } from 'vitest';
import {
  WONDERLAND_DOG_ACTIVITIES,
  WONDERLAND_LOCKED_STAGES,
  WONDERLAND_MISSION_STAGES,
  WONDERLAND_STAGE_PRESENTATION,
  resolveWonderlandStagePresentation,
  wonderlandStageForActivity,
  wonderlandStageTransition,
  type WonderlandMissionStage,
} from './wonderland-dog-stage';

/**
 * These tests are the written specification, executed. Each locked stage is
 * asserted against the direction field by field, so a later edit that quietly
 * turns the verification beam into a projectile, or moves the book onto
 * implementing, fails here rather than in a play session.
 */

describe('the activity vocabulary maps completely', () => {
  /**
   * The drift check against the UI list lives in
   * `src/relay/ui/relay-dog-motion/dog-stage-parity.test.ts`. It cannot live
   * here: the UI boundary rule forbids a non-UI file — test files INCLUDED —
   * from importing anything under `src/relay/ui`, and the quarantine list for
   * that rule is self-cleaning and reserved for pre-existing violations.
   */
  it('maps every activity to a stage', () => {
    for (const activity of WONDERLAND_DOG_ACTIVITIES) {
      expect(WONDERLAND_MISSION_STAGES, `${activity} has no stage`).toContain(
        wonderlandStageForActivity(activity),
      );
    }
  });
});

describe('MISSION START — the floating activation', () => {
  const presentation = WONDERLAND_STAGE_PRESENTATION.mission_start;

  it('floats, carries no prop, and shows the Mission Contract', () => {
    expect(presentation.kind).toBe('staged');
    if (presentation.kind !== 'staged') return;
    expect(presentation.locomotion).toBe('floating');
    // "Do not add a book here. Do not add a paintbrush here."
    expect(presentation.prop).toBe('none');
    expect(presentation.emission).toBe('none');
    expect(presentation.contractPresent).toBe(true);
  });

  it('is not meditation and not grounded', () => {
    if (presentation.kind !== 'staged') throw new Error('expected a staged presentation');
    expect(presentation.locomotion).not.toBe('grounded');
    expect(presentation.animationId).not.toMatch(/medit/i);
  });
});

describe('PLANNING — the book, and the orbit', () => {
  const presentation = WONDERLAND_STAGE_PRESENTATION.planning;

  it('reads a book while circling the Mission Contract', () => {
    if (presentation.kind !== 'staged') throw new Error('expected a staged presentation');
    expect(presentation.prop).toBe('book');
    // "It should visibly MOVE AROUND the Mission Contract while reading."
    expect(presentation.locomotion).toBe('orbit_contract');
    expect(presentation.contractPresent).toBe(true);
  });

  it('is reading, never writing', () => {
    if (presentation.kind !== 'staged') throw new Error('expected a staged presentation');
    expect(presentation.intent).toMatch(/read/i);
    expect(presentation.intent).not.toMatch(/writ/i);
  });
});

describe('BOOK MEANS PLANNING — and nothing else', () => {
  it('assigns the book to exactly one stage', () => {
    const withBook = WONDERLAND_MISSION_STAGES.filter((stage) => {
      const presentation = WONDERLAND_STAGE_PRESENTATION[stage];
      return presentation.kind === 'staged' && presentation.prop === 'book';
    });
    expect(withBook).toEqual(['planning']);
  });

  it('assigns the paintbrush to exactly one stage', () => {
    const withBrush = WONDERLAND_MISSION_STAGES.filter((stage) => {
      const presentation = WONDERLAND_STAGE_PRESENTATION[stage];
      return presentation.kind === 'staged' && presentation.prop === 'paintbrush';
    });
    expect(withBrush).toEqual(['implementing']);
  });
});

describe('VERIFYING — a sustained beam, not a projectile', () => {
  const presentation = WONDERLAND_STAGE_PRESENTATION.verifying;

  it('plants facing the Contract and emits the verification beam', () => {
    if (presentation.kind !== 'staged') throw new Error('expected a staged presentation');
    expect(presentation.locomotion).toBe('planted_facing_contract');
    expect(presentation.emission).toBe('verification_beam');
    expect(presentation.headTracksContract).toBe(true);
  });

  it('is the only stage that emits anything', () => {
    const emitting = WONDERLAND_MISSION_STAGES.filter((stage) => {
      const p = WONDERLAND_STAGE_PRESENTATION[stage];
      return p.kind === 'staged' && p.emission !== 'none';
    });
    expect(emitting).toEqual(['verifying']);
  });

  it('describes verification, never damage', () => {
    if (presentation.kind !== 'staged') throw new Error('expected a staged presentation');
    expect(presentation.intent).not.toMatch(/damage|attack|combat|destroy/i);
  });
});

describe('HANDOFF — the event survives, the animation does not', () => {
  it('remains a real stage so Julius event semantics are untouched', () => {
    expect(WONDERLAND_MISSION_STAGES).toContain('handoff');
    expect(wonderlandStageForActivity('handoff')).toBe('handoff');
  });

  it('has no dedicated presentation', () => {
    expect(WONDERLAND_STAGE_PRESENTATION.handoff.kind).toBe('inherit');
  });

  it('keeps showing the stage that was already playing', () => {
    const resolved = resolveWonderlandStagePresentation('handoff', 'implementing');
    expect(resolved.shownStage).toBe('implementing');
    if (resolved.presentation.kind !== 'staged') throw new Error('expected a staged presentation');
    expect(resolved.presentation.prop).toBe('paintbrush');
  });

  it('falls back to the resting world when nothing was playing', () => {
    const resolved = resolveWonderlandStagePresentation('handoff', null);
    expect(resolved.shownStage).toBe('none');
  });

  it('causes no prop change and no animation cut', () => {
    const transition = wonderlandStageTransition('implementing', 'handoff');
    expect(transition.propExiting).toBe('none');
    expect(transition.propEntering).toBe('none');
    expect(transition.contractDespawns).toBe(false);
  });

  it('is the only inheriting stage', () => {
    const inheriting = WONDERLAND_MISSION_STAGES.filter(
      (stage) => WONDERLAND_STAGE_PRESENTATION[stage].kind === 'inherit',
    );
    expect(inheriting).toEqual(['handoff']);
  });
});

describe('the Mission Contract exists only during a mission', () => {
  it('is absent before a task begins', () => {
    const none = WONDERLAND_STAGE_PRESENTATION.none;
    if (none.kind !== 'staged') throw new Error('expected a staged presentation');
    expect(none.contractPresent).toBe(false);
  });

  it('spawns on the transition into mission start', () => {
    const transition = wonderlandStageTransition('none', 'mission_start');
    expect(transition.contractSpawns).toBe(true);
  });
});

describe('transitions never hard-cut a prop or a beam', () => {
  it('closes the book and opens the paintbrush between planning and implementing', () => {
    const transition = wonderlandStageTransition('planning', 'implementing');
    expect(transition.propExiting).toBe('book');
    expect(transition.propEntering).toBe('paintbrush');
  });

  it('puts the brush away and begins the beam between implementing and verifying', () => {
    const transition = wonderlandStageTransition('implementing', 'verifying');
    expect(transition.propExiting).toBe('paintbrush');
    expect(transition.propEntering).toBe('none');
    expect(transition.emissionBeginning).toBe('verification_beam');
  });

  it('ends the beam when verification ends', () => {
    const transition = wonderlandStageTransition('verifying', 'complete');
    expect(transition.emissionEnding).toBe('verification_beam');
    expect(transition.emissionBeginning).toBe('none');
  });
});

describe('the presentation table is total and provider-blind', () => {
  it('covers every stage', () => {
    for (const stage of WONDERLAND_MISSION_STAGES) {
      expect(WONDERLAND_STAGE_PRESENTATION[stage as WonderlandMissionStage]).toBeDefined();
    }
  });

  it('names no provider anywhere in the table', () => {
    const serialized = JSON.stringify(WONDERLAND_STAGE_PRESENTATION).toLowerCase();
    for (const vendor of ['openai', 'anthropic', 'xai', 'gpt-', 'claude', 'gemini', 'grok']) {
      expect(serialized, `the presentation table names ${vendor}`).not.toContain(vendor);
    }
  });

  it('locks the four stages this specification fixed', () => {
    expect(WONDERLAND_LOCKED_STAGES).toEqual([
      'mission_start',
      'planning',
      'implementing',
      'verifying',
    ]);
  });
});
