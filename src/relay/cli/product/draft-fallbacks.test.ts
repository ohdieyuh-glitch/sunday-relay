import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DRAFT_FIELDS, finalizeDraft, initialState, isSelectField, reduceKey,
  type AppData, type AppState,
} from './app';
import { demoData } from './demo';

/**
 * DraftField fallback repair.
 *
 * The integration inherited 12 × TS2741 — every `select` field omitted the
 * required `fallback`. The repair had to be semantic, not a silence: a
 * fallback is the value a draft keeps when the founder supplies nothing
 * usable, so filling them with `''` would have quietly changed what a project
 * is configured to do (an empty reviewer means NO INDEPENDENT REVIEW, an empty
 * limit means no budget ceiling).
 *
 * The invariant these tests lock is what makes the repair provably behaviour
 * preserving: for every select, `fallback === options[defaultIndex].value`,
 * and that value is exactly what `finalizeDraft` already defaulted to.
 */

const data: AppData = { ...demoData(), demo: false };
const SOURCE = readFileSync(join(__dirname, 'app.ts'), 'utf8');

describe('every DraftField declares a fallback', () => {
  it('has the expected field count and no field omits it', () => {
    expect(DRAFT_FIELDS.length).toBeGreaterThan(15);
    for (const field of DRAFT_FIELDS) {
      expect(field, `${field.key} has no fallback`).toHaveProperty('fallback');
      expect(field.fallback, `${field.key} fallback is undefined`).not.toBeUndefined();
    }
  });

  it('covers all 12 select fields that previously failed to typecheck', () => {
    const selects = DRAFT_FIELDS.filter(isSelectField);
    expect(selects.map((f) => f.key).sort()).toEqual([
      'architect', 'callLimit', 'codingAgent', 'existingProject', 'mode',
      'productionImpact', 'projectType', 'repairLimit', 'researchPreference',
      'reviewLimit', 'reviewer', 'runtimeLimitMinutes',
    ]);
    expect(selects).toHaveLength(12);
  });

  it('types each fallback in the field\'s own domain, not as a string', () => {
    const byKey = Object.fromEntries(DRAFT_FIELDS.map((f) => [f.key, f]));
    expect(typeof byKey.existingProject.fallback).toBe('boolean');
    for (const key of ['runtimeLimitMinutes', 'callLimit', 'reviewLimit', 'repairLimit']) {
      expect(typeof byKey[key].fallback, `${key} must fall back to a number`).toBe('number');
    }
    for (const key of ['projectType', 'productionImpact', 'mode', 'researchPreference']) {
      expect(typeof byKey[key].fallback, `${key} must fall back to a string`).toBe('string');
    }
  });
});

describe('each fallback is semantically valid', () => {
  it('is always one of the field\'s own options', () => {
    for (const field of DRAFT_FIELDS.filter(isSelectField)) {
      const values = field.options.map((o) => o.value);
      expect(values, `${field.key} fallback is not an offered option`).toContain(field.fallback);
    }
  });

  it('is exactly the option the flow pre-highlights', () => {
    for (const field of DRAFT_FIELDS.filter(isSelectField)) {
      expect(field.options[field.defaultIndex]).toBeDefined();
      expect(field.fallback, `${field.key} fallback != options[defaultIndex]`)
        .toBe(field.options[field.defaultIndex].value);
    }
  });

  it('matches what finalizeDraft already defaulted to — so no behaviour changed', () => {
    const finalized = finalizeDraft({}, '2026-07-29T00:00:00.000Z');
    const byKey = Object.fromEntries(DRAFT_FIELDS.map((f) => [f.key, f]));
    for (const key of [
      'projectType', 'existingProject', 'productionImpact', 'architect', 'codingAgent',
      'reviewer', 'mode', 'researchPreference', 'runtimeLimitMinutes', 'callLimit',
      'reviewLimit', 'repairLimit',
    ] as const) {
      expect(byKey[key].fallback, `${key} fallback diverges from finalizeDraft`)
        .toBe((finalized as unknown as Record<string, unknown>)[key]);
    }
  });

  it('never falls back to a value that removes a safeguard', () => {
    const byKey = Object.fromEntries(DRAFT_FIELDS.map((f) => [f.key, f]));
    // An unanswered reviewer must never mean "no independent review".
    expect(byKey.reviewer.fallback).toBe('Codex');
    expect(byKey.reviewer.fallback).not.toBe('');
    // An unanswered mode must be the most supervised one.
    expect(byKey.mode.fallback).toBe('GUIDED');
    // An unanswered impact must be the least permissive one.
    expect(byKey.productionImpact.fallback).toBe('none');
    // An unanswered budget must never widen a ceiling: the fallback is never
    // the largest option offered.
    for (const key of ['runtimeLimitMinutes', 'callLimit', 'reviewLimit', 'repairLimit']) {
      const field = byKey[key];
      if (!isSelectField(field)) throw new Error(`${key} should be a select`);
      const numeric = field.options.map((o) => Number(o.value));
      expect(Number(field.fallback), `${key} falls back to the maximum ceiling`)
        .toBeLessThan(Math.max(...numeric));
    }
  });

  it('text and list fields fall back to empty, which finalizeDraft normalises', () => {
    for (const field of DRAFT_FIELDS.filter((f) => !isSelectField(f))) {
      expect(field.fallback, `${field.key}`).toBe('');
    }
    const finalized = finalizeDraft({}, '2026-07-29T00:00:00.000Z');
    expect(finalized.repositoryPath).toBeNull();     // '' becomes null, not ''
    expect(finalized.stack).toEqual([]);
    expect(finalized.protectedAreas).toEqual([]);
  });
});

/* ------------------------------ behaviour ------------------------------ */

const openDraft = (): AppState => reduceKey(initialState(false), { name: 'n', char: 'n' }, data);

/** Walk the draft flow accepting every default, typing a value only where a
 * required text field would otherwise block. */
function acceptAllDefaults(): AppState {
  let state = openDraft();
  for (let guard = 0; guard < 80 && !state.draftReview; guard += 1) {
    const field = DRAFT_FIELDS[state.draftIndex];
    if (!field) break;
    if (!isSelectField(field) && !field.optional) state = reduceKey(state, { name: 'x', char: 'x' }, data);
    state = reduceKey(state, { name: 'enter' }, data);
  }
  return state;
}

describe('fallback policy in the running flow', () => {
  it('an unanswered draft finalizes to exactly the fallback values', () => {
    const state = acceptAllDefaults();
    expect(state.draftReview).toBe(true);
    const project = finalizeDraft(state.draft, '2026-07-29T00:00:00.000Z');
    const byKey = Object.fromEntries(DRAFT_FIELDS.map((f) => [f.key, f]));
    for (const key of ['projectType', 'existingProject', 'productionImpact', 'mode',
      'researchPreference', 'runtimeLimitMinutes', 'callLimit', 'reviewLimit', 'repairLimit'] as const) {
      expect((project as unknown as Record<string, unknown>)[key], key).toBe(byKey[key].fallback);
    }
  });

  it('an optional text field left empty commits its fallback, not undefined', () => {
    const state = acceptAllDefaults();
    const project = finalizeDraft(state.draft, '2026-07-29T00:00:00.000Z');
    expect(project.repositoryPath).toBeNull();
    expect(project.scopeSummary).toBe('');
    expect(project.evidenceRequirements).toEqual([]);
  });

  it('a REQUIRED text field left empty is refused — the fallback never satisfies it', () => {
    const state = reduceKey(openDraft(), { name: 'enter' }, data);   // 'name', empty
    expect(state.draftIndex).toBe(0);                                 // did not advance
    expect(state.message).toContain('required');
  });

  it('an explicit choice always beats the fallback', () => {
    let state = openDraft();
    state = reduceKey(state, { name: 'x', char: 'x' }, data);
    state = reduceKey(state, { name: 'enter' }, data);                // name
    expect(DRAFT_FIELDS[state.draftIndex].key).toBe('projectType');
    state = reduceKey(state, { name: 'down' }, data);                 // pick option 1
    state = reduceKey(state, { name: 'enter' }, data);
    expect(state.draft.projectType).toBe('interface');
    expect(state.draft.projectType).not.toBe(DRAFT_FIELDS[1].fallback);
  });

  it('cancelling does not overwrite anything — nothing is persisted', () => {
    const before = acceptAllDefaults();
    expect(Object.keys(before.draft).length).toBeGreaterThan(5);
    for (const key of [{ name: 'escape' }, { name: 'c', char: 'c' }] as const) {
      const cancelled = reduceKey(before, key, data);
      expect(cancelled.draft).toEqual({});
      expect(cancelled.savedDraft).toBe(before.savedDraft);
      expect(cancelled.message).toContain('Nothing was saved');
      expect(cancelled.message).not.toContain('__SAVE_DRAFT__');
    }
  });
});

/* ------------------------------ discipline ----------------------------- */

describe('the repair introduced no type escape hatch', () => {
  it('adds no assertion bypass', () => {
    expect(SOURCE).not.toMatch(/\bas any\b/);
    expect(SOURCE).not.toMatch(/:\s*any\b/);
    expect(SOURCE).not.toContain('as unknown as DraftField');
  });

  it('adds no ignored TypeScript diagnostic', () => {
    expect(SOURCE).not.toContain('@ts-ignore');
    expect(SOURCE).not.toContain('@ts-expect-error');
    expect(SOURCE).not.toContain('@ts-nocheck');
  });

  it('keeps fallback REQUIRED — it was never made optional to silence tsc', () => {
    expect(SOURCE).not.toMatch(/fallback\?\s*:/);
    expect(SOURCE).toContain('fallback: string;');
    expect(SOURCE).toContain('fallback: DraftFallback;');
  });

  it('app.ts is still covered by the project typecheck', () => {
    const tsconfig = readFileSync(join(__dirname, '..', '..', '..', '..', 'tsconfig.json'), 'utf8');
    expect(tsconfig).not.toContain('cli/product/app.ts');   // never excluded
  });
});
