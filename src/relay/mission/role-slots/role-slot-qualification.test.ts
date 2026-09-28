import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  OCCUPANT_QUALIFICATION_STATUSES, ROLE_OCCUPANTS, juliusProviderQualification,
} from './index';

/**
 * PROVIDER CONFORMANCE, HELD TO ITS OWN RULES.
 *
 * The registry is a product definition and has always said so. What it could not
 * say, until the `qualification` field, is HOW FAR ANYTHING HAS ACTUALLY BEEN
 * PROVEN — so a reader had `adapterAvailable: true` and a list of environment
 * variables and no way to tell a leg that has completed a paid end-to-end
 * mission from one that has never been called.
 *
 * Three states, and the whole value is in what each one REFUSES:
 *
 *   VERIFIED     needs evidence AND a served model. Both. A leg that ran and
 *                whose bundle cannot name what answered it is not VERIFIED.
 *   COMPATIBLE   may not carry a qualified model list at all: a model list
 *                without VERIFIED beside it is a claim with the word removed.
 *   UNSUPPORTED  may not carry evidence. If there were evidence it would not be
 *                unsupported.
 *
 * AND THE RULE THESE CASES EXIST FOR: one qualified model never qualifies
 * another, not even from the same vendor, not even through the same adapter.
 */

const REPO = join(import.meta.dirname, '..', '..', '..', '..');

describe('every occupant declares how far it has been qualified', () => {
  it('finds occupants to check — an empty registry would make every case below vacuous', () => {
    expect(ROLE_OCCUPANTS.length).toBeGreaterThan(4);
  });

  it.each(ROLE_OCCUPANTS.map((occupant) => [occupant.occupantId, occupant] as const))(
    '%s: declares a status from the closed vocabulary, and a reason for it',
    (_id, occupant) => {
      expect(OCCUPANT_QUALIFICATION_STATUSES).toContain(occupant.qualification.status);
      expect(occupant.qualification.note.trim().length,
        'a status with no stated reason is a status nobody can challenge').toBeGreaterThan(20);
    },
  );

  it('never marks anything VERIFIED without both a served model and evidence', () => {
    for (const occupant of ROLE_OCCUPANTS) {
      if (occupant.qualification.status !== 'VERIFIED') continue;
      expect(occupant.qualification.qualifiedServedModels.length,
        `${occupant.occupantId}: VERIFIED must name the model that answered`).toBeGreaterThan(0);
      expect(occupant.qualification.evidence.length,
        `${occupant.occupantId}: VERIFIED must point at the run that proved it`).toBeGreaterThan(0);
    }
  });

  it('never lets an unverified occupant carry a qualified-model list', () => {
    // A model list beside COMPATIBLE would read as a qualification with the word
    // taken out, which is the shape of claim this field exists to prevent.
    for (const occupant of ROLE_OCCUPANTS) {
      if (occupant.qualification.status === 'VERIFIED') continue;
      expect(occupant.qualification.qualifiedServedModels,
        `${occupant.occupantId}: only a VERIFIED occupant may list qualified models`).toEqual([]);
    }
  });

  it('never lets an UNSUPPORTED occupant carry evidence', () => {
    for (const occupant of ROLE_OCCUPANTS) {
      if (occupant.qualification.status !== 'UNSUPPORTED') continue;
      expect(occupant.qualification.evidence,
        `${occupant.occupantId}: evidence and UNSUPPORTED cannot both be true`).toEqual([]);
    }
  });

  /**
   * A REFERENCE THAT CANNOT BE RESOLVED IS NOT EVIDENCE — the rule Julius PR 9
   * put on mission evidence, applied to the registry's own. A committed record
   * must exist on disk; a CI run reference must be shaped like one. Prose is
   * refused outright: "we ran it once" is not a reference.
   */
  it('resolves every evidence reference it carries', () => {
    for (const occupant of ROLE_OCCUPANTS) {
      for (const reference of occupant.qualification.evidence) {
        if (reference.startsWith('github-actions-run:')) {
          expect(reference, `${occupant.occupantId}: ${reference}`)
            .toMatch(/^github-actions-run:\d{6,}$/u);
          continue;
        }
        expect(existsSync(join(REPO, reference)),
          `${occupant.occupantId}: ${reference} is not a file in this repository`).toBe(true);
      }
    }
  });

  /**
   * THE VERIFIED SET, PINNED. Adding a row here is meant to cost a paid run and
   * a founder's attention, so it costs a deliberate edit to this list too. A
   * qualification that could be widened by an ordinary registry edit is not a
   * qualification.
   */
  it('has exactly one VERIFIED leg, and it is the one the paid bundle names', () => {
    const verified = ROLE_OCCUPANTS
      .filter((occupant) => occupant.qualification.status === 'VERIFIED')
      .map((occupant) => `${occupant.occupantId}@${occupant.qualification.qualifiedServedModels.join(',')}`);
    expect(verified).toEqual(['hermes_local@grok-build-0.1']);
  });
});

describe('a qualification belongs to a model, never to a vendor', () => {
  const verified = ROLE_OCCUPANTS.find((occupant) => occupant.qualification.status === 'VERIFIED')!;

  it('answers VERIFIED only for a served model the qualification covered', () => {
    for (const model of verified.qualification.qualifiedServedModels) {
      expect(juliusProviderQualification(verified, model)).toBe('VERIFIED');
    }
  });

  it('answers COMPATIBLE for a neighbouring model, however similar the name', () => {
    // The successor case, which is the one that actually happens: a provider
    // ships `grok-build-0.2` and nothing about the qualification moves.
    for (const model of ['grok-build-0.2', 'grok-build-0.1-preview', 'grok-build', 'GROK-BUILD-0.1']) {
      expect(juliusProviderQualification(verified, model),
        `${model} must not inherit a qualification`).toBe('COMPATIBLE');
    }
  });

  it('answers COMPATIBLE when the provider did not say what it served', () => {
    // Silence is the case that matters most: paid run 34414726976's own bundle
    // carries no served model for two of its three legs.
    for (const unknown of [null, '', '   ']) {
      expect(juliusProviderQualification(verified, unknown)).toBe('COMPATIBLE');
    }
  });

  it('never raises an occupant above what it declares, whatever model is named', () => {
    for (const occupant of ROLE_OCCUPANTS) {
      if (occupant.qualification.status === 'VERIFIED') continue;
      for (const model of ['grok-build-0.1', 'gpt-5.6-sol', 'claude-fable-5', 'anything']) {
        expect(juliusProviderQualification(occupant, model),
          `${occupant.occupantId} must stay ${occupant.qualification.status}`)
          .toBe(occupant.qualification.status);
      }
    }
  });

  it('does not let a shared independence group share a qualification', () => {
    // `hermes_local` and `hermes_remote_service` are the same vendor, the same
    // agent id and the same adapter id, and differ only in transport. One has a
    // paid bundle behind it and the other does not.
    const group = ROLE_OCCUPANTS.filter((occupant) =>
      occupant.independenceGroup === verified.independenceGroup);
    expect(group.length, 'the case needs at least two occupants in one group').toBeGreaterThan(1);
    const statuses = new Set(group.map((occupant) => occupant.qualification.status));
    expect(statuses.size,
      'same vendor, different qualification — this is the assertion the rule lives in')
      .toBeGreaterThan(1);
    for (const occupant of group) {
      if (occupant.occupantId === verified.occupantId) continue;
      expect(juliusProviderQualification(occupant, verified.qualification.qualifiedServedModels[0]!),
        `${occupant.occupantId} must not inherit its group-mate's qualification`).not.toBe('VERIFIED');
    }
  });
});
