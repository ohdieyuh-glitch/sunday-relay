import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CODING_AGENT_ROLE_ENV, REVIEWER_ROLE_ENV, reviewerOccupantFor } from './role-slot-config';
import { ROLE_OCCUPANTS } from '../src/relay/mission/role-slots';

/**
 * `.env.example` IS HOW A FOUNDER LEARNS AN OPTION EXISTS.
 *
 * A registered occupant nobody documents is one nobody will ever select. That
 * is a softer failure than a broken one and it lasts longer, because nothing
 * reports it: the capability is present, works, and is invisible.
 *
 * The reverse bit harder and is the reason this file exists. `.env.example`
 * documented all three Reviewers — including `openai_reviewer` as a
 * `RELAY_ROLE_REVIEWER` value, and `hermes_remote_service` as "dispatchable" —
 * while `reviewerOccupantFor` rejected the first as not one of the choices and
 * the dispatchable set excluded the second. The documentation was AHEAD of the
 * code, so a founder following it exactly was refused, and the refusal blamed
 * their value rather than the gap.
 *
 * Documentation that promises more than the code delivers is the same class of
 * defect as a comment describing a machine that does not exist. This holds the
 * two together in both directions.
 */

const ENV_EXAMPLE = readFileSync(join(process.cwd(), '.env.example'), 'utf8');

const reviewers = ROLE_OCCUPANTS.filter((o) => o.role === 'reviewer');
const codingAgents = ROLE_OCCUPANTS.filter((o) => o.role === 'coding_agent');

describe('every occupant a founder could select is documented', () => {
  it('documents each registered Reviewer by id', () => {
    expect(reviewers.length).toBeGreaterThan(1);
    for (const occupant of reviewers) {
      expect(ENV_EXAMPLE, `${occupant.occupantId} is registered and undocumented`)
        .toContain(occupant.occupantId);
    }
  });

  it('documents each registered Coding Agent by id', () => {
    for (const occupant of codingAgents) {
      // The offline engine is selected by its own flag rather than by name;
      // it is named in the file for exactly that reason.
      expect(ENV_EXAMPLE, `${occupant.occupantId} is registered and undocumented`)
        .toContain(occupant.occupantId);
    }
  });

  it('names both role selectors', () => {
    expect(ENV_EXAMPLE).toContain(REVIEWER_ROLE_ENV);
    expect(ENV_EXAMPLE).toContain(CODING_AGENT_ROLE_ENV);
  });
});

describe('the documentation does not promise what the code refuses', () => {
  /**
   * THE FAILURE THIS WOULD HAVE CAUGHT.
   *
   * Every Reviewer id printed in `.env.example` must be a value the selector
   * actually accepts. Before the coherence fix, `openai_reviewer` appeared
   * there and resolved to `invalid`.
   */
  it('every documented Reviewer id is a value the selector accepts', () => {
    for (const occupant of reviewers) {
      if (!ENV_EXAMPLE.includes(occupant.occupantId)) continue;
      const resolution = reviewerOccupantFor(occupant.occupantId);
      expect(resolution.kind, `${occupant.occupantId} is documented and refused`).toBe('occupant');
    }
  });

  it('does not document an occupant that is not registered', () => {
    // The other direction: an id in the file that no registry entry backs is
    // a value a founder can set and Relay will reject as invalid.
    const registered = new Set(ROLE_OCCUPANTS.map((o) => o.occupantId));
    /**
     * One underscore is enough, and the wider pattern is deliberate: the
     * narrower one skipped `openai_reviewer` and `hermes_local` entirely,
     * which are exactly the two ids this check most needed to judge. Verified
     * against the real file — every string it matches today is a registered
     * occupant, so widening it added coverage and no noise.
     *
     * Environment variable names are upper-case throughout the file, so a
     * lower-cased vendor-prefixed token is an occupant id or a mistake.
     */
    const documented = ENV_EXAMPLE.match(/\b(?:hermes|openai|claude|fusion)_[a-z0-9]+[_a-z0-9]*\b/g) ?? [];
    for (const candidate of new Set(documented)) {
      expect(registered, `${candidate} is documented and not registered`).toContain(candidate);
    }
  });
});
