import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_RELAY_DOG_HEIGHT,
  OFFICIAL_RELAY_DOG_PALETTE,
  OFFICIAL_RELAY_DOG_WIDTH,
} from '../../shared/official-relay-dog-sprite';
import { CHAKRA_ACCENTS } from '../../shared/relay-chakra';
import { knownFigure, unknownFigure, type RelayOperationsView } from '../../shared/llmops';
import { projectTerminalEvent, type RelayTerminalReadModel } from '../terminal';
import {
  WONDERLAND_DOG_MOTIONS,
  WONDERLAND_MOTION_ANIMATION,
  WONDERLAND_OWNER_ONLY_SECTIONS,
  WONDERLAND_WORLD_FIELDS,
  WONDERLAND_WORLD_SCHEMA_V1,
  WONDERLAND_WORLD_VISIBLE_SECTIONS,
  wonderlandAnimationFor,
} from './wonderland-contracts';
import type { WonderlandDogSkin } from './wonderland-contracts';
import {
  WONDERLAND_TERMINAL_MAX_LINES,
  projectWonderlandAgent,
  projectWonderlandAttestation,
  projectWonderlandBrain,
  projectWonderlandLoopSignal,
  projectWonderlandMission,
  projectWonderlandTerminal,
  projectWonderlandWorld,
  resolveWonderlandDogSkin,
} from './wonderland-projection';

/* ---------------------------------------------------------------- fixtures */

const AT = '2026-08-11T09:00:00.000Z';

const emptyOperations = (): RelayOperationsView => ({
  projectId: 'proj_1',
  spend: null,
  asOf: AT,
  health: 'degraded',
  healthReason: 'Two provider timeouts in the last five minutes.',
  latency: [],
  missingPhases: [],
  waits: [],
  waitingOnUserMs: 0,
  waitingOnUserOpen: false,
  errors: [],
  errorCount: 4,
  unrecoveredErrorCount: 2,
  unrecoveredIsExact: true,
  errorRate: knownFigure(0.25),
  evaluations: {
    total: 0, independent: 0, selfAssessed: 0, passed: 0, failed: 0,
    inconclusive: 0, independentCoverage: unknownFigure('unknown_denominator'),
  },
  repairs: {
    loops: 2, converged: 1, limitReached: 0, abandoned: 0,
    inProgress: 1, totalCycles: 3, endedUnfixed: 0,
  },
  newestSignalAt: AT,
  signalAgeMs: knownFigure(1200),
  droppedLatency: 0,
  droppedErrors: 0,
});

const readModelWith = (
  events: RelayTerminalReadModel['events'],
  lastSequence: number,
): RelayTerminalReadModel => ({
  runId: 'run_1',
  projectId: 'proj_1',
  missionId: 'mission_1',
  status: 'active',
  phase: 'review',
  mode: 'guided',
  entitlement: 'pro',
  provenance: 'LIVE PROVIDER',
  connectionState: 'LIVE',
  dogState: 'reviewing',
  activeRoles: ['reviewer'],
  reviewerAvailable: true,
  reviewerRequired: true,
  outputVisibility: 'full',
  lastSequence,
  events,
  unreadEventCount: 0,
  manualTaskActive: false,
  checkpointActive: false,
  startedAt: AT,
  updatedAt: AT,
});

/* ------------------------------------------------------------- unknown ≠ */

describe('a mission Relay has not observed is unknown, not idle and not complete', () => {
  it('carries no status, no verdict, and a findings figure that says why', () => {
    const mission = projectWonderlandMission({ missionId: 'mission_1' });

    expect(mission.observed).toBe(false);
    expect(mission.missionStatus).toBeNull();
    expect(mission.verdict).toBeNull();
    expect(mission.executionStatus).toBeNull();
    expect(mission.outcomeStatus).toBeNull();
    expect(mission.verificationStatus).toBeNull();
    expect(mission.releaseStatus).toBeNull();
    // The whole point: not zero.
    expect(mission.blockingFindingsOpen).toEqual({
      known: false, value: null, reason: 'not_observed',
    });
    expect(mission.unobservedReason).toContain('has not observed');
  });

  it('a mission id alone is not an observation of state', () => {
    // Knowing a mission's id is not knowing what it is doing. If `observed` were
    // taken from the caller rather than evidenced by an arriving fact, an
    // observation object with only an id would report a state Relay never saw.
    expect(projectWonderlandMission({ missionId: 'm' }).observed).toBe(false);
    expect(
      projectWonderlandMission({ missionId: 'm', verdict: 'partially_complete' }).observed,
    ).toBe(true);
  });

  it('never collapses the four status dimensions into one', () => {
    const mission = projectWonderlandMission({
      missionId: 'mission_1',
      missionStatus: 'in_progress',
      verdict: 'approved',
      status: {
        executionStatus: 'completed',
        outcomeStatus: 'partial',
        verificationStatus: 'changes_required',
        releaseStatus: 'not_eligible',
      },
      blockingFindingsOpen: knownFigure(3),
    });

    // Execution completed while verification demands changes and release is not
    // eligible. All four survive the crossing.
    expect(mission.executionStatus).toBe('completed');
    expect(mission.outcomeStatus).toBe('partial');
    expect(mission.verificationStatus).toBe('changes_required');
    expect(mission.releaseStatus).toBe('not_eligible');
    expect(mission.blockingFindingsOpen).toEqual({ known: true, value: 3, reason: null });
  });
});

describe('requested and served models are separate, and only agreement attests', () => {
  it('attests only when both are observed and equal', () => {
    const good = projectWonderlandAttestation('gpt-5-codex', 'gpt-5-codex');
    expect(good.attested).toBe(true);
    expect(good.unattestedReason).toBeNull();
  });

  it('a missing served model is not agreement', () => {
    const result = projectWonderlandAttestation('gpt-5-codex', null);
    expect(result.attested).toBe(false);
    expect(result.unattestedReason).toContain('did not report which model');
  });

  it('names a substitution as a substitution', () => {
    const result = projectWonderlandAttestation('gpt-5-codex', 'gpt-4o');
    expect(result.attested).toBe(false);
    expect(result.unattestedReason).toContain('gpt-5-codex');
    expect(result.unattestedReason).toContain('gpt-4o');
  });

  it('says so when neither was observed', () => {
    expect(projectWonderlandAttestation(null, null).unattestedReason).toContain('neither');
  });
});

/* ----------------------------------------------------------------- agent */

describe('the Agent animates from an observed Relay activity or not at all', () => {
  it('an absent dog state is dormant, never idle patrol', () => {
    const agent = projectWonderlandAgent(
      { agentId: 'agent_1' },
      [],
      resolveWonderlandDogSkin(),
    );
    expect(agent.observed).toBe(false);
    expect(agent.activity).toBeNull();
    expect(agent.pose).toBeNull();
    expect(agent.motion).toBeNull();
    expect(agent.animation).toBe('dormant');
    expect(agent.travelling).toBeNull();
    expect(agent.attentionRequired).toBeNull();
    expect(agent.activityLabel).toBeNull();
  });

  it('an UNRECOGNISED dog state is also dormant', () => {
    // The guard that matters. `officialRelayDogViewForState` resolves an unknown
    // string to `idle` so a 2D surface always has something safe to draw. Here
    // that fallback would turn "Relay said something this build cannot read" into
    // "the Agent is idling", and a renderer would animate a patrol.
    const agent = projectWonderlandAgent(
      { agentId: 'agent_1', workspaceState: 'a_state_from_a_newer_build' },
      [],
      resolveWonderlandDogSkin(),
    );
    expect(agent.observed).toBe(false);
    expect(agent.activity).toBeNull();
    expect(agent.animation).toBe('dormant');
    // The raw value is still carried, so the mismatch is inspectable.
    expect(agent.workspaceState).toBe('a_state_from_a_newer_build');
  });

  it('a recognised dog state resolves through the official identity tables', () => {
    const agent = projectWonderlandAgent(
      { agentId: 'agent_1', workspaceState: 'reviewing' },
      [],
      resolveWonderlandDogSkin(),
    );
    expect(agent.observed).toBe(true);
    expect(agent.activity).toBe('reviewing');
    // The official presentation: a review runs while the Dog rests, eyes shut.
    expect(agent.pose).toBe('sleeping');
    expect(agent.motion).toBe('sleep');
    expect(agent.animation).toBe('sleep_curl');
    expect(agent.travelling).toBe(false);
    expect(agent.activityLabel).toBe('REVIEWING');
  });

  it('patrol belongs to idle alone', () => {
    const idle = projectWonderlandAgent(
      { agentId: 'a', workspaceState: 'wandering' },
      [],
      resolveWonderlandDogSkin(),
    );
    expect(idle.motion).toBe('patrol');
    expect(idle.animation).toBe('patrol_walk');
    expect(idle.travelling).toBe(true);
  });

  it('every official motion has a clip, and only absence is dormant', () => {
    for (const motion of WONDERLAND_DOG_MOTIONS) {
      expect(wonderlandAnimationFor(motion)).toBe(WONDERLAND_MOTION_ANIMATION[motion]);
      expect(wonderlandAnimationFor(motion)).not.toBe('dormant');
    }
    expect(wonderlandAnimationFor(null)).toBe('dormant');
  });
});

describe('the loop meditation hover is additive and comes from a real loop', () => {
  const skin = resolveWonderlandDogSkin();
  const agentFor = (loopState: Parameters<typeof projectWonderlandLoopSignal>[0]['state']) =>
    projectWonderlandAgent(
      { agentId: 'a', workspaceState: 'reviewing' },
      [projectWonderlandLoopSignal({ loopId: 'loop_1', state: loopState })],
      skin,
    );

  it('an executing loop hovers, and the clip still comes from the activity', () => {
    const agent = agentFor('running');
    expect(agent.overlay).toBe('loop_meditation_hover');
    // ADDITIVE: the pose and clip are unchanged by the overlay.
    expect(agent.pose).toBe('sleeping');
    expect(agent.animation).toBe('sleep_curl');
  });

  it('a loop WAITING on approval does not hover', () => {
    // A run blocked on a human is making no progress. Animating it as meditation
    // would be a claim of activity once a frame.
    expect(agentFor('waiting_approval').overlay).toBe('none');
    expect(agentFor('waiting_budget').overlay).toBe('none');
    expect(agentFor('rate_limited').overlay).toBe('none');
  });

  it('an exhausted or unobserved loop does not hover', () => {
    expect(agentFor('budget_exhausted').overlay).toBe('none');
    expect(agentFor('completed').overlay).toBe('none');
    expect(agentFor(null).overlay).toBe('none');
    expect(
      projectWonderlandAgent({ agentId: 'a', workspaceState: 'reviewing' }, [], skin).overlay,
    ).toBe('none');
  });

  it('classifies loops from Relay\'s own predicates', () => {
    expect(projectWonderlandLoopSignal({ loopId: 'l', state: 'running' })).toMatchObject({
      observed: true, executing: true, waiting: false, terminal: false,
    });
    expect(projectWonderlandLoopSignal({ loopId: 'l', state: 'waiting_approval' })).toMatchObject({
      executing: false, waiting: true, terminal: false,
    });
    expect(projectWonderlandLoopSignal({ loopId: 'l', state: 'token_exhausted' })).toMatchObject({
      executing: false, waiting: false, terminal: true,
    });
    // recovery_required is neither over nor running: it is the state of not knowing.
    expect(projectWonderlandLoopSignal({ loopId: 'l', state: 'recovery_required' })).toMatchObject({
      executing: false, waiting: false, terminal: false,
    });
    expect(projectWonderlandLoopSignal({ loopId: 'l' })).toMatchObject({
      observed: false, executing: false, waiting: false, terminal: false,
    });
  });
});

/* ------------------------------------------------------------------ skin */

describe('a skin transforms the Relay Dog and never replaces it', () => {
  it('stamps the canonical proportions, whatever the skin asks for', () => {
    const skin = resolveWonderlandDogSkin({ skinId: 's', displayName: 'S' });
    expect(skin.gridWidth).toBe(OFFICIAL_RELAY_DOG_WIDTH);
    expect(skin.gridHeight).toBe(OFFICIAL_RELAY_DOG_HEIGHT);
    expect(skin.uniformScaleOnly).toBe(true);
  });

  it('recolours eyes and collar only', () => {
    const skin = resolveWonderlandDogSkin({
      skinId: 's', displayName: 'S', chakraTier: 'throat',
    });
    expect(skin.chakraTier).toBe('throat');
    expect(skin.eyeColor).toBe(CHAKRA_ACCENTS.throat.bright);
    expect(skin.collarColor).toBe(CHAKRA_ACCENTS.throat.accent);
    // The animal itself is never recoloured: body, shading and visor stay
    // canonical, which is what keeps the Dog from becoming a colour swatch.
    expect(skin.bodyColor).toBe(OFFICIAL_RELAY_DOG_PALETTE.w);
    expect(skin.shadowColor).toBe(OFFICIAL_RELAY_DOG_PALETTE.s);
    expect(skin.visorColor).toBe(OFFICIAL_RELAY_DOG_PALETTE.d);
  });

  it('an unrecognised tier is untiered, not the first tier', () => {
    const skin = resolveWonderlandDogSkin({
      skinId: 's', displayName: 'S', chakraTier: 'from_a_forked_build',
    });
    expect(skin.chakraTier).toBeNull();
    expect(skin.eyeColor).toBe(OFFICIAL_RELAY_DOG_PALETTE.y);
    expect(skin.collarColor).toBe(OFFICIAL_RELAY_DOG_PALETTE.c);
  });
});

/* -------------------------------------------------------------- terminal */

describe('the in-world terminal shows Relay\'s own words or says it has none', () => {
  it('an absent stream is an explained absence, not an empty frame', () => {
    const panel = projectWonderlandTerminal(null);
    expect(panel.present).toBe(false);
    expect(panel.lines).toEqual([]);
    expect(panel.connectionState).toBeNull();
    expect(panel.provenance).toBeNull();
    expect(panel.runId).toBeNull();
    expect(panel.unavailableReason).toContain('not because the system is quiet');
  });

  it('copies each line from the already-redacted Relay projection', () => {
    const event = projectTerminalEvent({
      sequence: 7,
      at: AT,
      source: 'reviewer',
      kind: 'reviewer.verdict_created',
      safeSummary: 'The reviewer returned api_key=abcdef123456 in its summary.',
      provenance: 'live',
    });
    const panel = projectWonderlandTerminal(readModelWith([event], 7));

    expect(panel.lines).toHaveLength(1);
    expect(panel.lines[0].headline).toBe('Review verdict');
    // The secret never reaches the world, because the world never re-derives the
    // text: it carries what projectTerminalEvent already redacted.
    expect(panel.lines[0].detail).not.toContain('abcdef123456');
    expect(panel.lines[0].detail).toContain('[redacted]');
    expect(panel.lines[0].redactionsApplied).toBeGreaterThan(0);
    expect(panel.lines[0].severity).toBe('blocking');
  });

  it('never carries private reasoning, only the fact that it was omitted', () => {
    const event = projectTerminalEvent({
      sequence: 1,
      at: AT,
      source: 'coding-agent',
      kind: 'agent.report_created',
      safeSummary: 'My internal monologue said the shortcut was fine.',
      provenance: 'live',
    });
    const panel = projectWonderlandTerminal(readModelWith([event], 1));
    expect(panel.lines[0].detail).toBe('Private reasoning omitted.');
    expect(panel.lines[0].omittedPrivateReasoning).toBe(true);
  });

  it('keeps the newest lines and says how many it dropped', () => {
    const events = Array.from({ length: 20 }, (_, index) =>
      projectTerminalEvent({
        sequence: index + 1,
        at: AT,
        source: 'relay-core',
        kind: 'task.created',
        safeSummary: `line ${index + 1}`,
        provenance: 'live',
      }),
    );
    const panel = projectWonderlandTerminal(readModelWith(events, 20));

    expect(panel.lines).toHaveLength(WONDERLAND_TERMINAL_MAX_LINES);
    expect(panel.lines[0].sequence).toBe(20 - WONDERLAND_TERMINAL_MAX_LINES + 1);
    expect(panel.lines.at(-1)?.sequence).toBe(20);
    // A window presented as a whole is the lie this field prevents.
    expect(panel.truncatedFrom).toBe(20);
    // The read model's own cursor, not the last line the panel kept.
    expect(panel.lastSequence).toBe(20);
  });

  it('reports no truncation when nothing was dropped', () => {
    const event = projectTerminalEvent({
      sequence: 1, at: AT, source: 'relay-core', kind: 'task.created',
      safeSummary: 'one', provenance: 'live',
    });
    expect(projectWonderlandTerminal(readModelWith([event], 1)).truncatedFrom).toBeNull();
  });
});

/* ----------------------------------------------------------------- brain */

describe('the world\'s weather comes from the Project Brain or is fog', () => {
  it('an absent record is unknown health, not healthy', () => {
    const brain = projectWonderlandBrain(null);
    expect(brain.present).toBe(false);
    expect(brain.health).toBe('unknown');
    expect(brain.projectId).toBeNull();
    expect(brain.errorRate).toEqual({ known: false, value: null, reason: 'not_observed' });
    expect(brain.signalAgeMs.known).toBe(false);
    expect(brain.openRepairLoops.known).toBe(false);
  });

  it('carries Relay\'s own health and sentence verbatim', () => {
    const brain = projectWonderlandBrain(emptyOperations());
    expect(brain.present).toBe(true);
    expect(brain.health).toBe('degraded');
    expect(brain.healthReason).toBe('Two provider timeouts in the last five minutes.');
    expect(brain.errorRate).toEqual({ known: true, value: 0.25, reason: null });
    expect(brain.unrecoveredErrorCount).toEqual({ known: true, value: 2, reason: null });
    expect(brain.openRepairLoops).toEqual({ known: true, value: 1, reason: null });
  });

  it('an inexact unrecovered count is unknown, never reported as a total', () => {
    // Relay marks the count inexact when errors were evicted: it is a FLOOR, and
    // a floor shown as a count would let the world imply every error recovered.
    const brain = projectWonderlandBrain({ ...emptyOperations(), unrecoveredIsExact: false });
    expect(brain.unrecoveredErrorCount.known).toBe(false);
    expect(brain.unrecoveredErrorCount.value).toBeNull();
    expect(brain.unrecoveredErrorCount.reason).toBe('unreadable');
  });
});

/* ----------------------------------------------------------------- world */

describe('the world document', () => {
  const world = (overrides: Partial<Parameters<typeof projectWonderlandWorld>[0]> = {}) =>
    projectWonderlandWorld(
      { revision: 12, provenance: 'live', agent: { agentId: 'agent_1' }, ...overrides },
      AT,
    );

  it('echoes the injected instant and carries its schema version', () => {
    const document = world();
    expect(document.observedAtIso).toBe(AT);
    expect(document.schemaVersion).toBe(WONDERLAND_WORLD_SCHEMA_V1);
    expect(document.revision).toBe(12);
  });

  it('labels a simulated world in the document itself', () => {
    const simulated = world({ provenance: 'simulated' });
    expect(simulated.simulated).toBe(true);
    expect(simulated.provenanceLabel).toContain('SIMULATED WORLD');

    const live = world({ provenance: 'live' });
    expect(live.simulated).toBe(false);
    expect(live.provenanceLabel).toContain('LIVE');

    // Imported and manual are not simulated, and still say what they are.
    expect(world({ provenance: 'imported' }).provenanceLabel).toContain('IMPORTED');
    expect(world({ provenance: 'manual' }).provenanceLabel).toContain('MANUAL');
  });

  it('declares Relay authoritative and the client presentational', () => {
    const document = world();
    expect(document.replication.authority).toBe('relay');
    expect(document.replication.clientRole).toBe('presentational');
    expect(document.replication.revision).toBe(12);
  });

  it('accounts for every document section exactly once in the replication split', () => {
    // A section in neither list would be replicated in whichever direction the
    // engine happened to default — not a decision anybody would have made.
    const owner: string[] = [...WONDERLAND_OWNER_ONLY_SECTIONS];
    const shared: string[] = [...WONDERLAND_WORLD_VISIBLE_SECTIONS];
    const all: string[] = [...WONDERLAND_WORLD_FIELDS];

    expect(owner.filter((section) => shared.includes(section))).toEqual([]);
    expect([...owner, ...shared].sort()).toEqual([...all].sort());
    for (const section of [...owner, ...shared]) {
      expect(all, `${section} is not a field of WonderlandWorld`).toContain(section);
    }
  });

  it('defaults every optional section to an explained absence', () => {
    const document = world();
    expect(document.missions).toEqual([]);
    expect(document.loops).toEqual([]);
    expect(document.entities).toEqual([]);
    expect(document.classes).toEqual([]);
    expect(document.gve).toBeNull();
    expect(document.brain.present).toBe(false);
    expect(document.terminal.present).toBe(false);
    expect(document.agent.animation).toBe('dormant');
  });

  it('is read-only over its input', () => {
    const input = Object.freeze({
      revision: 1,
      provenance: 'live' as const,
      agent: Object.freeze({ agentId: 'agent_1', workspaceState: 'reviewing' }),
      loops: Object.freeze([Object.freeze({ loopId: 'l', state: 'running' as const })]),
      missions: Object.freeze([Object.freeze({ missionId: 'm', verdict: 'blocked' as const })]),
    });
    // Frozen input: any mutation would throw in strict mode, which ES modules are.
    expect(() => projectWonderlandWorld(input, AT)).not.toThrow();
    expect(input.agent.workspaceState).toBe('reviewing');
    expect(input.loops[0].state).toBe('running');
  });
});

describe('the Dog\'s proportions are not something a caller can supply', () => {
  it('re-stamps a forged skin passed straight into projectWonderlandAgent', () => {
    /**
     * `wonderland-contracts.ts` claimed "the type has nowhere to put a different
     * width" — and `WonderlandDogSkin` necessarily has `gridWidth`,
     * `gridHeight` and `uniformScaleOnly`, because they mirror to C++.
     * `resolveWonderlandDogSkin` is safe; THIS function is exported from the
     * barrel, takes an already-built skin, and carried whatever it was handed. An
     * independent review put a 999x3 magenta-bodied Dog into the document.
     *
     * The founder's directive is that skins TRANSFORM the Dog and never replace
     * it. Identity is not a caller's to supply.
     */
    const forged = {
      gridWidth: 999,
      gridHeight: 3,
      uniformScaleOnly: false,
      bodyColor: '#ff00ff',
      shadowColor: '#123456',
      visorColor: '#00ff00',
    } as WonderlandDogSkin;

    const agent = projectWonderlandAgent(
      { workspaceState: null, missions: [], simulated: false } as never,
      [],
      forged,
    );
    expect(agent.skin.gridWidth).toBe(OFFICIAL_RELAY_DOG_WIDTH);
    expect(agent.skin.gridHeight).toBe(OFFICIAL_RELAY_DOG_HEIGHT);
    expect(agent.skin.uniformScaleOnly).toBe(true);
    // And what a skin IS allowed to change still crosses.
    expect(agent.skin.bodyColor).toBe('#ff00ff');
    expect(agent.skin.visorColor).toBe('#00ff00');
  });
});
