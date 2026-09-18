import { describe, expect, it } from 'vitest';

import {
  PROJECT_AVATAR_SKINS,
  PROJECT_AVATAR_STAGES,
  PROVISIONAL_GROWTH_POLICY,
  STAGE_METRES,
  applyGrowth,
  beginEvolution,
  completeEvolution,
  createProjectAvatar,
  earnedFrom,
  figureForAvatar,
  figureNameFor,
  isLegalSpawnMove,
  projectAvatarView,
  setActivity,
  setSpawnState,
  type GrowthEvent,
  type ProjectAvatar,
} from './index';

/**
 * THE PROJECT AVATAR RULES, PROVEN. Two things matter most here and both are the founder's own words: an avatar begins
 * SMALL rather than at the reference sheet's mature form, and a stage change is an EVENT rather than a mesh swap.
 */

const clock = (at = '2026-09-17T12:00:00.000Z') => ({ at });

function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function avatar(skin: 'TEN_TAILS' | 'CHERUBIM' = 'TEN_TAILS'): ProjectAvatar {
  return createProjectAvatar({ projectAvatarId: 'pav_1', projectId: 'pixel-canvas', ownerId: 'founder', skin }, clock());
}

const growth = (signal: GrowthEvent['signal'], times: number): GrowthEvent[] =>
  Array.from({ length: times }, (_, i) => ({ signal, at: `2026-09-17T12:0${i}:00.000Z`, evidenceId: `ev_${i}`, detail: 'a real thing the project did' }));

describe('project avatars: a project begins small', () => {
  it('starts SMALL, unspawned, with nothing pretended about its progress', () => {
    const fresh = avatar();
    expect(fresh.currentForm).toBe('SMALL');
    expect(fresh.unlockedForm).toBe('SMALL');
    expect(fresh.progress).toBe(0);
    expect(fresh.spawnState).toBe('NOT_SPAWNED');
    expect(fresh.history).toHaveLength(1);
    expect(fresh.history[0].stage).toBe('SMALL');
  });

  it('has two canonical skins and three canonical stages, in order', () => {
    expect(PROJECT_AVATAR_SKINS).toEqual(['TEN_TAILS', 'CHERUBIM']);
    expect(PROJECT_AVATAR_STAGES).toEqual(['SMALL', 'MEDIUM', 'LARGE']);
    // The domain and the art cannot drift: these are the metres the figure generator solves for.
    expect(STAGE_METRES).toEqual({ SMALL: 1.15, MEDIUM: 2.7, LARGE: 5.6 });
  });

  it('names the figure for a skin and a stage, and nothing else', () => {
    expect(figureNameFor('TEN_TAILS', 'SMALL')).toBe('TenTails_Small.wlvox');
    expect(figureNameFor('CHERUBIM', 'LARGE')).toBe('Cherubim_Large.wlvox');
    expect(figureForAvatar(avatar('CHERUBIM'))).toBe('Cherubim_Small.wlvox');
  });
});

describe('project avatars: growth unlocks a form, an event puts it on', () => {
  it('earns MEDIUM from real project signals without changing what it wears', () => {
    let pet = avatar();
    // Twelve units is MEDIUM under the provisional policy: three verified accomplishments is twelve.
    pet = applyGrowth(pet, growth('VERIFIED_ACCOMPLISHMENT', 3), clock());
    expect(pet.unlockedForm).toBe('MEDIUM');
    // AND IT IS STILL WEARING SMALL. The founder asked that a stage change be an event, not a side effect.
    expect(pet.currentForm).toBe('SMALL');
  });

  it('refuses an evolution the project has not earned', () => {
    const pet = avatar();
    const refused = beginEvolution(pet, clock());
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('permission-denied');
      expect(refused.error.message).toContain('has not earned MEDIUM');
    }
  });

  it('evolves through EVOLVING and records when and why', () => {
    let pet = applyGrowth(avatar(), growth('VERIFIED_ACCOMPLISHMENT', 3), clock());
    pet = must(setSpawnState(pet, 'SUMMONING', clock()));
    pet = must(setSpawnState(pet, 'PRESENT', clock()));
    pet = must(beginEvolution(pet, clock()));
    expect(pet.spawnState).toBe('EVOLVING');
    expect(pet.activity).toBe('EVOLVE');
    // STILL SMALL WHILE IT HAPPENS: the world is showing the moment, and the form changes when the moment ends.
    expect(pet.currentForm).toBe('SMALL');
    pet = must(completeEvolution(pet, clock('2026-09-17T12:30:00.000Z')));
    expect(pet.currentForm).toBe('MEDIUM');
    expect(pet.activity).toBe('CELEBRATION');
    expect(pet.history.map((row) => row.stage)).toEqual(['SMALL', 'MEDIUM']);
    expect(pet.history[1].at).toBe('2026-09-17T12:30:00.000Z');
  });

  it('never skips a stage, and never goes backwards', () => {
    // Enough for LARGE straight away -- ten verified accomplishments is forty.
    let pet = applyGrowth(avatar(), growth('VERIFIED_ACCOMPLISHMENT', 10), clock());
    expect(pet.unlockedForm).toBe('LARGE');
    pet = must(setSpawnState(pet, 'SUMMONING', clock()));
    pet = must(setSpawnState(pet, 'PRESENT', clock()));
    pet = must(beginEvolution(pet, clock()));
    pet = must(completeEvolution(pet, clock()));
    // ONE STEP AT A TIME: SMALL earned LARGE, but it becomes MEDIUM first.
    expect(pet.currentForm).toBe('MEDIUM');
    pet = must(beginEvolution(pet, clock()));
    pet = must(completeEvolution(pet, clock()));
    expect(pet.currentForm).toBe('LARGE');
    expect(beginEvolution(pet, clock()).ok).toBe(false);

    // A WITHDRAWN SIGNAL DOES NOT TAKE A FORM AWAY from a project that earned it.
    const after = applyGrowth(pet, [], clock());
    expect(after.unlockedForm).toBe('LARGE');
    expect(after.currentForm).toBe('LARGE');
  });

  it('the growth policy is a replaceable value, and says it is provisional', () => {
    expect(PROVISIONAL_GROWTH_POLICY.provisional).toBe(true);
    expect(earnedFrom(growth('CREATION_PROGRESS', 6), PROVISIONAL_GROWTH_POLICY).stage).toBe('SMALL');
    // A different policy is a different answer from the same events -- which is the point of it being a value.
    const generous = { ...PROVISIONAL_GROWTH_POLICY, policyId: 'test', toNextStage: { MEDIUM: 3, LARGE: 5 } } as const;
    expect(earnedFrom(growth('CREATION_PROGRESS', 6), generous).stage).toBe('LARGE');
    // And a surface is told, so a stage earned under a placeholder is never shown as though it were final.
    expect(projectAvatarView(avatar()).provisionalProgress).toBe(true);
  });
});

describe('project avatars: in the world, or not', () => {
  it('only moves between spawn states that exist', () => {
    expect(isLegalSpawnMove('NOT_SPAWNED', 'PRESENT')).toBe(false);
    expect(isLegalSpawnMove('NOT_SPAWNED', 'SUMMONING')).toBe(true);
    expect(isLegalSpawnMove('PRESENT', 'RESTING')).toBe(true);
    expect(isLegalSpawnMove('RESTING', 'EVOLVING')).toBe(false);
    const pet = avatar();
    expect(setSpawnState(pet, 'PRESENT', clock()).ok).toBe(false);
  });

  it('will not be given something to do while it is not in the world', () => {
    const pet = avatar();
    expect(setActivity(pet, 'PROJECT_ACTIVE', clock()).ok).toBe(false);
    let present = must(setSpawnState(pet, 'SUMMONING', clock()));
    present = must(setSpawnState(present, 'PRESENT', clock()));
    expect(must(setActivity(present, 'PROJECT_ACTIVE', clock())).activity).toBe('PROJECT_ACTIVE');
  });

  it('tells a client what it needs to draw the creature, and no arithmetic', () => {
    const pet = applyGrowth(avatar('CHERUBIM'), growth('MISSION_COMPLETED', 7), clock());
    const view = projectAvatarView(pet);
    expect(view).toMatchObject({ skin: 'CHERUBIM', currentForm: 'SMALL', unlockedForm: 'MEDIUM', spawnState: 'NOT_SPAWNED' });
    expect(view.progressPercent).toBe(7);
    // NO BACKEND INTERNALS: no growth events, no evidence ids, no policy weights.
    const keys = Object.keys(view);
    expect(keys).not.toContain('history');
    expect(keys).not.toContain('progress');
    expect(JSON.stringify(view)).not.toContain('ev_0');
  });
});
