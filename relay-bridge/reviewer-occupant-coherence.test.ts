import { describe, expect, it } from 'vitest';

import {
  MISSION_DISPATCHABLE_OCCUPANTS,
  missionDispatchProblems,
  resolveRoleSlotsFromEnv,
  reviewerOccupantFor,
  explicitlySelectedReviewerOccupant,
  reviewerOccupantForTransport,
  reviewerSlotConflict,
} from './role-slot-config';
import { resolveReviewerTransport } from './reviewer-transport';
import { REMOTE_HERMES_ENV } from './hermes-remote-review';
import { OPENAI_REVIEWER_ENV } from './openai-reviewer';
import { DEVELOPMENT_DEFAULT_OCCUPANTS, ROLE_OCCUPANTS } from '../src/relay/mission/role-slots';

/**
 * THE THIRD REVIEWER BROKE THE ROLE SLOT, AND THIS IS THE PROOF AND THE FENCE.
 *
 * Relay decides two things about the Reviewer, in two places:
 *
 *   `resolveReviewerTransport` decides WHO ACTUALLY REVIEWS — local Hermes, a
 *   remote Hermes service, or the provider Reviewer.
 *
 *   `reviewerOccupantFor` decides WHO IS BOUND, and the binding is what the
 *   mission attests.
 *
 * When the provider Reviewer was added, only the first learned about it. The
 * consequence on a founder machine, with the exact configuration the handoff
 * recommends:
 *
 *   RELAY_OPENAI_REVIEWER_MODE=live      transport  -> provider (OpenAI)
 *   RELAY_ROLE_REVIEWER unset            occupant   -> hermes_local (default)
 *
 * The mission binds and attests `hermes_local` while OpenAI performs the
 * review. That is one occupant narrated and another doing the work — the
 * precise defect `role-slot-config.ts` describes itself as existing to
 * prevent, reintroduced from a direction it was not watching.
 *
 * Worse, the obvious fix was refused: `RELAY_ROLE_REVIEWER=openai_reviewer`
 * resolved to `invalid`, so a founder following the handoff would be told
 * their correct value was not one of the choices.
 */

const LAPTOP_DEFAULT_REVIEWER = DEVELOPMENT_DEFAULT_OCCUPANTS.reviewer;

const PROVIDER_ENV = {
  [OPENAI_REVIEWER_ENV.mode]: 'live',
  [OPENAI_REVIEWER_ENV.key]: 'key',
  [OPENAI_REVIEWER_ENV.model]: 'gpt-test',
};

const REMOTE_ENV = {
  [REMOTE_HERMES_ENV.mode]: 'remote',
  [REMOTE_HERMES_ENV.url]: 'https://hermes.example.com',
  [REMOTE_HERMES_ENV.token]: 'service-token',
  [REMOTE_HERMES_ENV.trustedOrigins]: 'https://hermes.example.com',
};

describe('the selector knows every Reviewer that can actually review', () => {
  it('accepts the provider Reviewer', () => {
    // Before this, a founder setting the value the handoff recommends was told
    // it was not one of the choices.
    const resolution = reviewerOccupantFor('openai_reviewer');
    expect(resolution.kind).toBe('occupant');
    if (resolution.kind === 'occupant') expect(resolution.occupantId).toBe('openai_reviewer');
  });

  it('still accepts both Hermes occupants', () => {
    expect(reviewerOccupantFor('hermes_local').kind).toBe('occupant');
    expect(reviewerOccupantFor('hermes_remote_service').kind).toBe('occupant');
  });

  it('still refuses a value that is not one of the choices', () => {
    expect(reviewerOccupantFor('gpt-5-please').kind).toBe('invalid');
    expect(reviewerOccupantFor('').kind).toBe('unset');
  });

  /**
   * THE DRIFT BARRIER. This is the test that would have caught the original
   * defect: a Reviewer occupant the mission can DRIVE, that the selector
   * cannot NAME, is an occupant an operator can never legitimately choose.
   */
  it('can name every dispatchable Reviewer occupant', () => {
    for (const occupant of ROLE_OCCUPANTS) {
      if (occupant.role !== 'reviewer') continue;
      if (!MISSION_DISPATCHABLE_OCCUPANTS.has(occupant.occupantId)) continue;
      const resolution = reviewerOccupantFor(occupant.occupantId);
      expect(resolution.kind, `${occupant.occupantId} is dispatchable and unnameable`).toBe('occupant');
    }
  });

  it('names the provider Reviewer as dispatchable, because the mission drives it', () => {
    // `callReviewer` handles the provider transport, so this is not a promise
    // — it is a fact about a branch that exists.
    expect(MISSION_DISPATCHABLE_OCCUPANTS.has('openai_reviewer')).toBe(true);
  });
});

describe('the transport and the bound occupant name the same thing', () => {
  it('maps each transport onto the occupant it would actually run', () => {
    expect(reviewerOccupantForTransport(resolveReviewerTransport(PROVIDER_ENV))).toBe('openai_reviewer');
    expect(reviewerOccupantForTransport(resolveReviewerTransport(REMOTE_ENV))).toBe('hermes_remote_service');
    expect(reviewerOccupantForTransport(resolveReviewerTransport({}))).toBe('hermes_local');
  });

  it('reports NO conflict when they agree', () => {
    expect(reviewerSlotConflict({
      transport: resolveReviewerTransport(PROVIDER_ENV),
      boundOccupantId: 'openai_reviewer',
    })).toBeNull();
    expect(reviewerSlotConflict({
      transport: resolveReviewerTransport({}),
      boundOccupantId: 'hermes_local',
    })).toBeNull();
  });

  /**
   * THE ONE THAT MATTERS, and the exact configuration the handoff recommends.
   */
  it('REFUSES the provider transport bound to the laptop default', () => {
    const conflict = reviewerSlotConflict({
      transport: resolveReviewerTransport(PROVIDER_ENV),
      boundOccupantId: LAPTOP_DEFAULT_REVIEWER,
    });
    expect(conflict).not.toBeNull();
    // It names BOTH settings, because an operator has to know which two
    // disagree — not merely that something does.
    expect(conflict?.safeMessage).toContain(OPENAI_REVIEWER_ENV.mode);
    expect(conflict?.safeMessage).toContain('RELAY_ROLE_REVIEWER');
    expect(conflict?.role).toBe('reviewer');
  });

  it('REFUSES a remote transport bound to the local reviewer, and the reverse', () => {
    expect(reviewerSlotConflict({
      transport: resolveReviewerTransport(REMOTE_ENV),
      boundOccupantId: 'hermes_local',
    })).not.toBeNull();
    expect(reviewerSlotConflict({
      transport: resolveReviewerTransport({}),
      boundOccupantId: 'hermes_remote_service',
    })).not.toBeNull();
  });

  it('says nothing when no Reviewer is bound at all', () => {
    // An unstaffed role has nothing to disagree with. A mission that does not
    // review is a different question, answered elsewhere.
    expect(reviewerSlotConflict({
      transport: resolveReviewerTransport(PROVIDER_ENV),
      boundOccupantId: null,
    })).toBeNull();
  });

  it('says nothing when the transport is unavailable', () => {
    // An ambiguous or misconfigured transport is already refused with its own,
    // better reason. Adding a conflict on top would bury it.
    const ambiguous = resolveReviewerTransport({ ...PROVIDER_ENV, ...REMOTE_ENV });
    expect(ambiguous.kind).toBe('unavailable');
    expect(reviewerSlotConflict({ transport: ambiguous, boundOccupantId: 'hermes_local' })).toBeNull();
  });
});

/**
 * THE UNDISPATCHABLE REFUSAL, KEPT HONEST.
 *
 * This used to be proven at the mission level by a real occupant that was
 * genuinely undrivable. Every registered occupant is now drivable, so that
 * test could only survive by keeping one broken. The mechanism is what
 * matters, and a synthetic occupant proves it without holding the product
 * back.
 */
describe('an occupant this bridge cannot drive is still refused', () => {
  it('names the occupant and the role', () => {
    const problems = missionDispatchProblems({
      reviewer: { occupant: { occupantId: 'some_future_reviewer', displayName: 'Some future reviewer' } },
    }, ['reviewer']);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.role).toBe('reviewer');
    expect(problems[0]?.safeMessage).toContain('some_future_reviewer');
    expect(problems[0]?.safeMessage).toContain('Some future reviewer');
  });

  it('says nothing about a role this mission does not dispatch', () => {
    // A Reviewer the development path never calls must not block it.
    expect(missionDispatchProblems({
      reviewer: { occupant: { occupantId: 'some_future_reviewer', displayName: 'Some future reviewer' } },
    }, ['prompt_architect', 'coding_agent'])).toEqual([]);
  });

  it('passes every occupant Relay actually ships', () => {
    // The other direction: if this ever fails, a registered occupant lost its
    // execution path rather than gaining one.
    for (const occupant of ROLE_OCCUPANTS) {
      expect(
        MISSION_DISPATCHABLE_OCCUPANTS.has(occupant.occupantId),
        `${occupant.occupantId} is registered and not dispatchable`,
      ).toBe(true);
    }
  });
});

/**
 * WHICH TRANSPORTS COUNT AS A STATEMENT — the property that keeps a hosted
 * deployment fail-closed while still following an operator who spoke once.
 */
describe('only an explicitly configured transport supplies the occupant', () => {
  it('lets remote and provider stand in for a named occupant', () => {
    // Both need variables set, so both are an operator saying what they want.
    expect(explicitlySelectedReviewerOccupant(resolveReviewerTransport(REMOTE_ENV)))
      .toBe('hermes_remote_service');
    expect(explicitlySelectedReviewerOccupant(resolveReviewerTransport(PROVIDER_ENV)))
      .toBe('openai_reviewer');
  });

  it('does NOT let the local transport stand in for one', () => {
    /**
     * THE ONE THAT MATTERS, because it is the difference between following an
     * operator and guessing for them.
     *
     * Local is what configuring nothing produces. Treating it as a statement
     * would bind an installed Hermes on a container that has none, and turn a
     * hosted deployment's honest `no_occupant_requested` into a silent guess —
     * exactly the wrong-machine binding the role registry exists to remove.
     */
    expect(explicitlySelectedReviewerOccupant(resolveReviewerTransport({}))).toBeNull();
  });

  it('supplies nothing for a transport that could not be resolved', () => {
    const ambiguous = resolveReviewerTransport({ ...PROVIDER_ENV, ...REMOTE_ENV });
    expect(explicitlySelectedReviewerOccupant(ambiguous)).toBeNull();
  });
});

/**
 * THE STATUS ROUTE MUST AGREE WITH THE PRODUCT IT REPORTS ON.
 *
 * `/relay-api/health` resolves role slots through `resolveRoleSlotsFromEnv`,
 * and it read `RELAY_ROLE_REVIEWER` directly while `mission.ts` ALSO accepted
 * an explicitly configured transport as naming the occupant.
 *
 * The consequence was not a crash. It was worse for a founder mid-deployment:
 * set `RELAY_HERMES_MODE=remote` (or the provider mode), leave the role
 * selector unset as the handoff instructs, read `no_occupant_requested`, and
 * conclude the configuration failed — while a Mission would have bound the
 * occupant and run. A status route reporting a staffed deployment as unstaffed
 * is the same defect this route exists to prevent, pointing the other way.
 */
describe('health resolves the Reviewer the way a mission does', () => {
  const HOSTED = { RAILWAY_ENVIRONMENT: 'production', RELAY_PROMPT_ARCHITECT_MODE: 'live' };

  it('binds the REMOTE Hermes occupant from the transport alone', () => {
    // The canonical Reviewer: Hermes service, xAI, Grok. Configured by the
    // RELAY_HERMES_* names and NOT by naming the occupant.
    const resolution = resolveRoleSlotsFromEnv({
      ...HOSTED,
      ...REMOTE_ENV,
      OPENAI_API_KEY: 'k',
      OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-test',
      RELAY_ROLE_CODING_AGENT: 'claude_agent_sdk_hosted',
      ANTHROPIC_API_KEY: 'k',
      RELAY_HOSTED_CODING_MODEL: 'claude-test',
    });
    expect(resolution.requested.reviewer).toBe('hermes_remote_service');
  });

  it('reports no reviewer refusal once the transport is configured', () => {
    const resolution = resolveRoleSlotsFromEnv({
      ...HOSTED,
      ...REMOTE_ENV,
      OPENAI_API_KEY: 'k',
      OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-test',
      RELAY_ROLE_CODING_AGENT: 'claude_agent_sdk_hosted',
      ANTHROPIC_API_KEY: 'k',
      RELAY_HOSTED_CODING_MODEL: 'claude-test',
    });
    const reviewerProblems = resolution.binding.ok
      ? []
      : resolution.binding.problems.filter((p) => p.role === 'reviewer');
    expect(reviewerProblems.map((p) => p.reason)).not.toContain('no_occupant_requested');
  });

  it('still refuses an unstaffed Reviewer when NOTHING is configured', () => {
    // The honest state production reported all day, and it must survive: a
    // hosted deployment that configured no transport and named no occupant is
    // unstaffed, and saying otherwise would be the original defect inverted.
    const resolution = resolveRoleSlotsFromEnv({ ...HOSTED, OPENAI_API_KEY: 'k', OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-test' });
    expect(resolution.requested.reviewer).toBeUndefined();
  });

  it('an explicitly named occupant still wins over the transport', () => {
    const resolution = resolveRoleSlotsFromEnv({
      ...HOSTED, ...REMOTE_ENV, RELAY_ROLE_REVIEWER: 'hermes_local',
    });
    // Named and contradicting: the mission refuses this, and health must not
    // quietly report the transport's occupant as though it were chosen.
    expect(resolution.requested.reviewer).toBe('hermes_local');
  });
});
