import { describe, expect, it } from 'vitest';

import { emptyJuliusActivity } from './wonderland-julius-activity';
import { noWonderlandBrainCitation } from './wonderland-brain-scope';
import { wonderlandRunSnapshot } from './wonderland-rehydration';
import { projectWonderlandUsageHud, wonderlandUsageHudFixture } from './wonderland-usage-meter';
import {
  WONDERLAND_AUTONOMY_LEVELS,
  WONDERLAND_CARD_SCOPE_FIELDS,
  WONDERLAND_HYDRATION_FIELDS,
  scopeWonderlandCard,
  wonderlandHydration,
  wonderlandHydrationResume,
  wonderlandHydrationVerdict,
} from './wonderland-hydration';
import type { WonderlandHydration } from './wonderland-hydration';
import { emptyWonderlandUsageAuthority, projectWonderlandUsageFromAuthority } from './wonderland-usage-authority';

const PROJECT = 'project-alpha';
const RUN = 'run-1';
const AT = '2026-09-08T00:00:00.000Z';

const authority = projectWonderlandUsageFromAuthority(
  emptyWonderlandUsageAuthority({ projectId: PROJECT }),
  AT,
);

const hydration = (overrides: Partial<Parameters<typeof wonderlandHydration>[0]> = {}) =>
  wonderlandHydration({
    run: wonderlandRunSnapshot({
      projectId: PROJECT,
      runId: RUN,
      state: 'EXECUTING',
      revision: 7,
      atSequence: 120,
      observedAtIso: AT,
    }),
    usage: authority.hud,
    usageStatus: authority.status,
    activity: emptyJuliusActivity({ projectId: PROJECT, runId: RUN }),
    brain: noWonderlandBrainCitation({ projectId: PROJECT, runId: RUN }),
    card: scopeWonderlandCard({ cardRevision: 'card:v3' }),
    observedAtIso: AT,
    ...overrides,
  });

/* --------------------------------------------------------- the C.A.R.D. */

describe('what a world may know about a C.A.R.D.', () => {
  it('reports a role slot as filled and never by whom', () => {
    // `CardVersion.promptArchitect` and friends hold model/provider
    // identifiers. The world is told the slot is occupied and nothing else.
    const scope = scopeWonderlandCard({
      cardRevision: 'card:v3',
      promptArchitect: 'some-provider-model-name',
      codingAgent: 'another-provider-model',
      reviewer: '',
    });
    expect(scope.hasPromptArchitect).toBe(true);
    expect(scope.hasCodingAgent).toBe(true);
    expect(scope.hasIndependentReviewer).toBe(false);
    expect(JSON.stringify(scope)).not.toContain('provider');
    expect(JSON.stringify(scope)).not.toContain('model');
  });

  it('says NULL, not empty, when nobody could read the record', () => {
    // The failure this closes. `julius_runs.card_revision` is free text with no
    // foreign key, and nothing in the persistence layer reads
    // `relay_wonderland.card_versions` — so the reader that is about to be
    // written cannot resolve the slots. Reporting them `false` would draw three
    // unfilled roles as a fact about a C.A.R.D. nobody has seen.
    const unresolved = scopeWonderlandCard({ cardRevision: 'card:v3' });
    expect(unresolved.hasPromptArchitect).toBeNull();
    expect(unresolved.hasCodingAgent).toBeNull();
    expect(unresolved.hasIndependentReviewer).toBeNull();
  });

  it('distinguishes a slot the record says is EMPTY from one nobody read', () => {
    // Present-and-blank is an answer; absent is not. Those are different facts
    // and only the first may be drawn.
    const read = scopeWonderlandCard({
      cardRevision: 'card:v3',
      promptArchitect: '',
      codingAgent: null,
      reviewer: '   ',
    });
    expect(read.hasPromptArchitect).toBe(false);
    expect(read.hasCodingAgent).toBe(false);
    expect(read.hasIndependentReviewer).toBe(false);

    // And a partial read stays partial: one slot resolved does not make the
    // other two answerable.
    const partial = scopeWonderlandCard({ cardRevision: 'card:v3', codingAgent: 'x' });
    expect(partial.hasCodingAgent).toBe(true);
    expect(partial.hasPromptArchitect).toBeNull();
    expect(partial.hasIndependentReviewer).toBeNull();
  });

  it('never carries a provider or model name, whatever it is handed', () => {
    // The inversion is the guarantee: `models`, `tools` and `permissions` are
    // not parameters, so no expression in the scope could copy one.
    const scope = scopeWonderlandCard({
      cardRevision: 'card:v3',
      promptArchitect: 'gpt-4o',
      codingAgent: 'claude-opus',
      reviewer: 'hermes-agent',
    } as never);
    const serialised = JSON.stringify(scope).toLowerCase();
    for (const name of ['gpt', 'claude', 'hermes', 'openai', 'anthropic', 'xai', 'gemini']) {
      expect(serialised).not.toContain(name);
    }
  });

  it('reads swarm eligibility from capability tokens and keeps only the role', () => {
    const scope = scopeWonderlandCard({
      cardRevision: 'card:v3',
      capabilities: ['swarm:researcher', 'swarm:tester', 'tool:bash', 'swarm:researcher'],
    });
    expect(scope.swarmEligible).toBe(true);
    // Deduplicated, sorted, and the non-swarm capability is not carried at all.
    expect(scope.eligibleSwarmRoles).toEqual(['researcher', 'tester']);
    expect(JSON.stringify(scope)).not.toContain('bash');
  });

  it('says a C.A.R.D. with no swarm capability is not swarm eligible', () => {
    const scope = scopeWonderlandCard({ cardRevision: 'card:v3', capabilities: ['tool:bash'] });
    expect(scope.swarmEligible).toBe(false);
    expect(scope.eligibleSwarmRoles).toEqual([]);
  });

  it('does NOT say a C.A.R.D. nobody read is ineligible', () => {
    // The third answer, and the one this field used to get wrong. A reader that
    // cannot resolve the record — which is every reader today, because C.A.R.D.
    // policy is not persisted at all — omits `capabilities` and must get back
    // "nobody looked", not "this run may not spawn a swarm". It was returning
    // `false`, beside three role slots that correctly said UNKNOWN.
    const scope = scopeWonderlandCard({ cardRevision: 'card:v3' });
    expect(scope.swarmEligible).toBeNull();
    // And the role list is empty either way, which is exactly why it cannot be
    // read on its own: the flag beside it is what carries the distinction.
    expect(scope.eligibleSwarmRoles).toEqual([]);
  });

  it('tells present-and-empty from absent, on the capability list too', () => {
    // The same supplied-check the three slots use. `capabilities: []` is a
    // record that was read and permits nothing; omitting it is a record that
    // was never opened. `?? []` would have collapsed both into the first.
    expect(scopeWonderlandCard({ cardRevision: 'c', capabilities: [] }).swarmEligible).toBe(false);
    expect(scopeWonderlandCard({ cardRevision: 'c' }).swarmEligible).toBeNull();
  });

  it('separates eligibility from activity', () => {
    // "May spawn a swarm" and "is running one" are different facts owned by
    // different systems. A world needs the first to leave room before any
    // clone exists, and the second is on the activity axis.
    const scope = scopeWonderlandCard({
      cardRevision: 'card:v3',
      capabilities: ['swarm:architect'],
    });
    expect(scope.swarmEligible).toBe(true);
    expect(Object.keys(scope)).not.toContain('swarming');
  });

  it('carries autonomy only when it is one of the three levels', () => {
    for (const level of WONDERLAND_AUTONOMY_LEVELS) {
      expect(scopeWonderlandCard({ cardRevision: 'c', autonomy: level }).autonomy).toBe(level);
    }
    // Never defaulted to a level: an unrecognised value is silence, not
    // SUPERVISED, because guessing the cautious one still claims a fact.
    expect(scopeWonderlandCard({ cardRevision: 'c', autonomy: 'SOMETHING' }).autonomy).toBeNull();
    expect(scopeWonderlandCard({ cardRevision: 'c' }).autonomy).toBeNull();
  });

  it('names every field it carries', () => {
    expect(Object.keys(scopeWonderlandCard({ cardRevision: 'c' })).sort()).toEqual(
      [...WONDERLAND_CARD_SCOPE_FIELDS].sort(),
    );
  });
});

/* -------------------------------------------------------- the hydration */

describe('one payload a world can start from', () => {
  it('takes the project from the run rather than from a second argument', () => {
    // A hydration naming one project at the top and carrying another's run
    // underneath would pass every downstream check while the meters belonged
    // to somebody else.
    expect(hydration().projectId).toBe(PROJECT);
  });

  it('carries usage, brain, C.A.R.D. and activity — the things not on an event', () => {
    const payload = hydration();
    expect(Object.keys(payload).sort()).toEqual([...WONDERLAND_HYDRATION_FIELDS].sort());
    expect(payload.usage.compoundAgent.channel).toBe('compound_agent');
    expect(payload.usage.singleAgent.channel).toBe('single_agent');
    expect(payload.usageStatus.reading).toBe('not_reported');
    expect(payload.card.cardRevision).toBe('card:v3');
  });

  it('carries the run position, so the tail is all that follows', () => {
    const resume = wonderlandHydrationResume(hydration());
    expect(resume).toEqual({ projectId: PROJECT, runId: RUN, afterSequence: 120 });
  });

  it('asks for everything when the snapshot could not say where it sat', () => {
    // Correct and merely more expensive: ordering refuses what is already held.
    const unpositioned = hydration({
      run: wonderlandRunSnapshot({
        projectId: PROJECT,
        runId: RUN,
        state: 'EXECUTING',
        revision: 7,
        observedAtIso: AT,
      }),
    });
    expect(wonderlandHydrationResume(unpositioned).afterSequence).toBe(0);
  });

  it('does not recompute the meters it was given', () => {
    // Every figure came through the usage authority, where the project, schema
    // and revision checks live. A hydration that built a meter directly would
    // be a path around all three.
    const fixture = wonderlandUsageHudFixture(AT);
    const payload = hydration({ usage: fixture });
    expect(payload.usage).toBe(fixture);
  });
});

/* ---------------------------------------------------------- the refusals */

describe('a hydration is adopted wholesale, so it is judged carefully', () => {
  it('refuses another project outright', () => {
    expect(wonderlandHydrationVerdict('project-beta', hydration())).toBe('foreign_project');
  });

  it('refuses an unbound world, because silence is not permission', () => {
    expect(wonderlandHydrationVerdict('', hydration())).toBe('foreign_project');
  });

  it('refuses an unbound world even when the payload names no project either', () => {
    // The case the empty-string check actually guards. Comparing two blanks
    // finds them equal, so without it an unbound world would adopt a nameless
    // hydration — and adopt it WHOLESALE, replacing everything at once.
    const nameless = { ...hydration(), projectId: '' };
    expect(wonderlandHydrationVerdict('', nameless as WonderlandHydration)).toBe(
      'foreign_project',
    );
  });

  it('catches the RUN alone naming another project', () => {
    // Isolated deliberately. A payload where several parts disagree is caught
    // by whichever clause is checked first, so a redundant clause looks alive
    // while doing nothing. This one leaves every other part consistent, so only
    // the run check can catch it.
    const runElsewhere = {
      ...hydration(),
      run: { ...hydration().run, projectId: 'project-beta' },
    };
    expect(wonderlandHydrationVerdict(PROJECT, runElsewhere as WonderlandHydration)).toBe(
      'inconsistent',
    );
  });

  it('catches a payload whose top-level project disagrees with its run', () => {
    // The constructor takes the project FROM the run so this cannot be built
    // in process. Over a wire it can, and the mismatch would otherwise be
    // invisible: ordering compares the envelope's project to the cursor's and
    // both would agree while the meters underneath belonged to somebody else.
    const mismatched = { ...hydration(), projectId: 'project-beta' };
    expect(wonderlandHydrationVerdict('project-beta', mismatched as WonderlandHydration)).toBe(
      'inconsistent',
    );
  });

  it('accepts its own project', () => {
    expect(wonderlandHydrationVerdict(PROJECT, hydration())).toBe('accepted');
  });

  it('refuses an unknown schema rather than guessing at its fields', () => {
    const future = { ...hydration(), schemaVersion: 'relay-wonderland-hydration.v9' };
    expect(wonderlandHydrationVerdict(PROJECT, future as WonderlandHydration)).toBe(
      'unsupported_schema',
    );
  });

  it('catches an assembly whose parts disagree about the run', () => {
    // The activity axis is folded per run. One assembled against a different
    // run would show another mission's signals under this run's name.
    const mixed = hydration({ activity: emptyJuliusActivity({ projectId: PROJECT, runId: 'run-2' }) });
    expect(wonderlandHydrationVerdict(PROJECT, mixed)).toBe('inconsistent');
  });

  it('catches an assembly whose parts disagree about the project', () => {
    const mixedBrain = hydration({
      brain: noWonderlandBrainCitation({ projectId: 'project-beta', runId: RUN }),
    });
    expect(wonderlandHydrationVerdict(PROJECT, mixedBrain)).toBe('inconsistent');
  });

  it('catches the two meters being swapped, as a second line of defence', () => {
    // GREEN is the Compound Agent and BLUE is the single agent, and the founder
    // locked that. A HUD with them the other way round would draw a single
    // agent's spend on the dominant frame.
    //
    // The projection already refuses it, which is the stronger guard and the
    // one that matters in process:
    expect(() =>
      projectWonderlandUsageHud({
        compoundAgent: authority.hud.singleAgent,
        singleAgent: authority.hud.compoundAgent,
        observedAtIso: AT,
      }),
    ).toThrow(/channel_mismatch/);

    // But a hydration crosses a WIRE, and nothing on the far side ran that
    // constructor. So the verdict checks it again on arrival, where a
    // hand-assembled or corrupted payload is the realistic way it would happen.
    const swapped = {
      ...hydration(),
      usage: {
        ...authority.hud,
        compoundAgent: authority.hud.singleAgent,
        singleAgent: authority.hud.compoundAgent,
      },
    };
    expect(wonderlandHydrationVerdict(PROJECT, swapped as WonderlandHydration)).toBe(
      'inconsistent',
    );
  });
});
