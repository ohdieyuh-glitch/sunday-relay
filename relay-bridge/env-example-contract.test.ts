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

/**
 * A VALUE IN THIS FILE IS COPIED, NOT READ.
 *
 * `.env.example` is the file a founder copies to `.env`, so every value in it
 * ships into a real configuration. An edit once spliced a comment block into
 * the middle of another one and the assignment swallowed the following comment
 * line as its VALUE:
 *
 *   RELAY_HOSTED_CODING_MODEL=claude_agent_sdk_hosted — a real, hosted,
 *
 * Copied verbatim, that configures a model name no provider has, and the
 * failure surfaces as a provider rejection rather than as a typo. Nothing
 * caught it: the occupant-id checks above read the file as prose, and prose is
 * exactly what it had become.
 *
 * A value here is a port, a mode, an executable name, a number — never a
 * sentence. That is what this checks.
 */
describe('no variable carries prose as its value', () => {
  const assignments = ENV_EXAMPLE.split('\n')
    .map((line, i) => ({ line, number: i + 1 }))
    .filter((entry) => /^[A-Z][A-Z0-9_]*=/.test(entry.line));

  it('finds the assignments at all, so this cannot pass on an empty match', () => {
    expect(assignments.length).toBeGreaterThan(20);
  });

  it('gives every non-empty value a single token', () => {
    for (const { line, number } of assignments) {
      const value = line.slice(line.indexOf('=') + 1).trim();
      if (value === '') continue;
      // A real example value is one token: 8790, balanced, hermes, 180000.
      expect(value, `${p_label(line)} at line ${String(number)} carries prose`).not.toMatch(/\s/);
    }
  });

  it('lets no value contain an em dash, which only prose uses here', () => {
    for (const { line, number } of assignments) {
      expect(line, `line ${String(number)}`).not.toContain('—');
    }
  });
});

function p_label(line: string): string {
  return line.slice(0, Math.max(0, line.indexOf('=')));
}
