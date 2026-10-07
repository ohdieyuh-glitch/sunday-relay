import { describe, expect, it } from 'vitest';
import { EVAL_EVIDENCE_TYPES } from '../mission/project-brain/project-brain-components';
import { EVIDENCE_RUN } from './project-brain-components-postgres';

// PM-24 (PREREG_PB_B16_PM07_EQUIVALENCE, 2026-10-04): THE DOOR AND THE STORE AGREE ON WHAT AN EVAL MAY CITE.
// evidenceInRun answers 'mission' and 'criterion' before it looks a type up; every other type the door admits must be
// one the store can place in a run. A type the door admitted and the store could not place would reach evidenceInRun's
// fail-closed branch and be refused as evidence of no run. This test is what keeps that branch unreachable (PM-07).
describe('Project Brain eval evidence: the door and the store', () => {
  it('every type the door admits, other than mission and criterion, is a type the store can place in a run', () => {
    const answeredBeforeTheLookup = ['mission', 'criterion'];
    const placeable = Object.keys(EVIDENCE_RUN);
    const unplaceable = EVAL_EVIDENCE_TYPES.filter((type) => !answeredBeforeTheLookup.includes(type) && !placeable.includes(type));
    expect(unplaceable).toEqual([]);
  });
});
