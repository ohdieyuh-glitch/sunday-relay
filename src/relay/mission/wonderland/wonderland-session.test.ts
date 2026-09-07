import { describe, expect, it } from 'vitest';

import { wonderlandEnvelope } from './wonderland-envelope';
import type { WonderlandEnvelope } from './wonderland-envelope';
import { wonderlandRunSnapshot } from './wonderland-rehydration';
import {
  WONDERLAND_SESSION_FIELDS,
  WONDERLAND_SESSION_SCHEMA_V1,
  applyWonderlandEnvelope,
  applyWonderlandEnvelopes,
  openWonderlandSession,
  recoverWonderlandSession,
} from './wonderland-session';
import type { WonderlandSession } from './wonderland-session';

/**
 * THE FOLD THAT DRIVES A DOG.
 *
 * The property worth proving over and over here is that a refusal at ANY stage
 * leaves the visual state exactly where it was. A world under a misbehaving
 * stream must keep showing the last thing it had good reason to believe, rather
 * than degrading toward a default — and it must be possible to tell afterwards
 * which stage refused what.
 */

const PROJECT = 'project-1';
const JULIUS = 'julius-1';
const RUN = 'run-1';
const AT = '2026-09-07T10:00:00.000Z';

let n = 0;
const event = (
  overrides: Partial<Parameters<typeof wonderlandEnvelope>[0]> = {},
): WonderlandEnvelope => {
  n += 1;
  return wonderlandEnvelope({
    eventId: `evt-${n}`,
    projectId: PROJECT,
    juliusInstanceId: JULIUS,
    runId: RUN,
    missionId: 'mission-1',
    state: 'coding',
    stateSource: 'julius_run_state',
    sequence: n,
    revision: n,
    occurredAt: AT,
    ...overrides,
  });
};

const session = () => openWonderlandSession({ projectId: PROJECT });

describe('an unopened session', () => {
  it('claims nothing and says why', () => {
    const s = session();
    expect(s.schemaVersion).toBe(WONDERLAND_SESSION_SCHEMA_V1);
    expect(s.visualState).toBeNull();
    expect(s.clip).toBe('dormant');
    expect(s.attentionRequired).toBeNull();
    expect(s.terminal).toBe(false);
    expect((s.unobservedReason ?? '').length).toBeGreaterThan(10);
    expect(Object.keys(s).sort()).toEqual([...WONDERLAND_SESSION_FIELDS].sort());
  });

  it('rests rather than patrolling when nothing has been observed', () => {
    // `dormant`, never `patrol_walk`. Idle is an observed state.
    expect(session().clip).not.toBe('patrol_walk');
  });
});

/* --------------------------------------------------------- the happy path */

describe('driving a mission', () => {
  it('wakes into the first state and plans the transition', () => {
    const outcome = applyWonderlandEnvelope(session(), event({ state: 'coding' }));
    expect(outcome.ordering).toBe('applied');
    expect(outcome.legality).toBe('applied');
    expect(outcome.session.visualState).toBe('coding');
    expect(outcome.session.clip).toBe('code_type');
    expect(outcome.plan?.transition).toBe('wake');
    expect(outcome.plan?.from).toBe('dormant');
  });

  it('learns identity without ever unlearning it', () => {
    let s = applyWonderlandEnvelope(session(), event({ state: 'coding' })).session;
    s = applyWonderlandEnvelope(
      s,
      event({ state: 'verifying', missionId: null, workerRole: null }),
    ).session;
    expect(s.missionId).toBe('mission-1');
    expect(s.cursor.runId).toBe(RUN);
  });

  it('carries the worker role that acted', () => {
    const outcome = applyWonderlandEnvelope(
      session(),
      event({ state: 'independent_review', workerRole: 'INDEPENDENT_REVIEWER' }),
    );
    expect(outcome.session.workerRole).toBe('INDEPENDENT_REVIEWER');
  });

  it('refuses the shortcuts a mission cannot actually take', () => {
    // Both of these look reasonable and neither is a move Julius has. The
    // derived table is what stops a world inventing a plausible path.
    const coding = applyWonderlandEnvelope(session(), event({ state: 'coding' })).session;
    expect(applyWonderlandEnvelope(coding, event({ state: 'complete' })).legality).toBe(
      'refused_unreachable',
    );

    const planning = applyWonderlandEnvelope(session(), event({ state: 'prompt_architect' }))
      .session;
    expect(applyWonderlandEnvelope(planning, event({ state: 'coding' })).legality).toBe(
      'refused_unreachable',
    );
  });

  it('cuts into a state that needs a human, and says a human is needed', () => {
    let s = applyWonderlandEnvelope(session(), event({ state: 'coding' })).session;
    const outcome = applyWonderlandEnvelope(s, event({ state: 'blocked' }));
    expect(outcome.plan?.transition).toBe('interrupt');
    expect(outcome.plan?.blendMs).toBe(0);
    expect(outcome.session.attentionRequired).toBe(true);
  });

  it('latches terminal on a real ending, arriving the way Julius actually does', () => {
    // Through VERIFYING, because EXECUTING → COMPLETED is not a move Julius
    // has: a run reaches COMPLETED by being verified first.
    let s = applyWonderlandEnvelope(session(), event({ state: 'coding' })).session;
    s = applyWonderlandEnvelope(s, event({ state: 'verifying' })).session;
    const outcome = applyWonderlandEnvelope(s, event({ state: 'complete', terminal: true }));
    expect(outcome.session.terminal).toBe(true);
    expect(outcome.session.visualState).toBe('complete');
  });

  it('HOLDS on a kernel-path completion, because verifying and complete share a clip', () => {
    // Worth stating rather than discovering later: `complete`'s only kernel
    // predecessor is VERIFYING, and both draw `stand_still`, so the clip does
    // not change and `settle` cannot fire on that path. The completion is told
    // by the readout and the terminal flag, not by the body — which is exactly
    // why those travel alongside the plan.
    let s = applyWonderlandEnvelope(session(), event({ state: 'coding' })).session;
    s = applyWonderlandEnvelope(s, event({ state: 'verifying' })).session;
    const outcome = applyWonderlandEnvelope(s, event({ state: 'complete', terminal: true }));
    expect(outcome.plan?.from).toBe('stand_still');
    expect(outcome.plan?.to).toBe('stand_still');
    expect(outcome.plan?.transition).toBe('hold');
  });

  it('settles when a completion arrives from a state with a different clip', () => {
    // Reachable through the coarser sources: `agent.complete` and
    // `mission.completed` are event-sourced and are not held to the kernel
    // table, so a completion can legitimately follow coding directly.
    const s = applyWonderlandEnvelope(session(), event({ state: 'coding' })).session;
    const outcome = applyWonderlandEnvelope(
      s,
      event({ state: 'complete', terminal: true, stateSource: 'event_type' }),
    );
    expect(outcome.legality).toBe('applied');
    expect(outcome.plan?.transition).toBe('settle');
    expect(outcome.session.terminal).toBe(true);
  });

  it('runs a whole mission end to end', () => {
    // The REAL path, which is longer than the obvious one: planning hands off
    // before coding starts (PLANNING → READY → EXECUTING), and verification
    // stands between coding and completion.
    const s = applyWonderlandEnvelopes(session(), [
      event({ state: 'attention' }),
      event({ state: 'prompt_architect' }),
      event({ state: 'handoff' }),
      event({ state: 'coding' }),
      event({ state: 'independent_review' }),
      event({ state: 'verifying' }),
      event({ state: 'complete', terminal: true }),
    ]);
    expect(s.visualState).toBe('complete');
    expect(s.terminal).toBe(true);
    expect(s.cursor.applied).toBe(7);
    expect(s.illegalTransitionsRefused).toBe(0);
    expect(s.lastRefusalReason).toBeNull();
  });
});

/* ------------------------------------------------- the refusals, in order */

describe('a refusal at any stage leaves the state exactly where it was', () => {
  const coding = (): WonderlandSession =>
    applyWonderlandEnvelope(session(), event({ state: 'coding', sequence: 5, revision: 5 }))
      .session;

  it('refuses on ORDERING before asking whether the move is legal', () => {
    // Running the state machine over a misrouted event would be asking whether
    // a move is legal before establishing that the move happened.
    const before = coding();
    const outcome = applyWonderlandEnvelope(
      before,
      event({ projectId: 'other', state: 'complete', terminal: true }),
    );
    expect(outcome.ordering).toBe('foreign_project');
    expect(outcome.legality).toBeNull();
    expect(outcome.plan).toBeNull();
    expect(outcome.session.visualState).toBe('coding');
    expect(outcome.session.clip).toBe('code_type');
    expect(outcome.session.cursor.foreignProjects).toBe(1);
  });

  it('refuses on LEGALITY when the event is in order but impossible', () => {
    let s = coding();
    s = applyWonderlandEnvelope(s, event({ state: 'blocked', sequence: 6, revision: 6 })).session;
    const outcome = applyWonderlandEnvelope(
      s,
      event({ state: 'complete', sequence: 7, revision: 7 }),
    );
    expect(outcome.ordering).toBe('applied');
    expect(outcome.legality).toBe('refused_unreachable');
    expect(outcome.plan).toBeNull();
    expect(outcome.session.visualState).toBe('blocked');
    expect(outcome.session.illegalTransitionsRefused).toBe(1);
  });

  it('advances the cursor on a legality refusal, because delivery was fine', () => {
    // Refusing an event's CONTENT is not a reason to ask for it again.
    let s = coding();
    s = applyWonderlandEnvelope(s, event({ state: 'blocked', sequence: 6, revision: 6 })).session;
    const outcome = applyWonderlandEnvelope(
      s,
      event({ state: 'complete', sequence: 9, revision: 9 }),
    );
    expect(outcome.session.cursor.sequence).toBe(9);
  });

  it('never un-completes a completed mission', () => {
    let s = applyWonderlandEnvelope(
      session(),
      event({ state: 'complete', terminal: true, sequence: 1, revision: 1 }),
    ).session;
    const outcome = applyWonderlandEnvelope(
      s,
      event({ state: 'coding', sequence: 2, revision: 2 }),
    );
    expect(outcome.legality).toBe('refused_would_uncomplete');
    expect(outcome.session.visualState).toBe('complete');
    expect(outcome.session.terminal).toBe(true);
    expect(outcome.session.clip).toBe('stand_still');
  });

  it('returns NO PLAN rather than a hold when nothing was applied', () => {
    // A hold is a real instruction — keep playing, do not restart — and
    // returning one would tell a renderer a decision was made about the event.
    const outcome = applyWonderlandEnvelope(coding(), event({ projectId: 'other' }));
    expect(outcome.plan).toBeNull();
  });

  it('gives every refusal a sentence, and remembers the last one', () => {
    const outcome = applyWonderlandEnvelope(
      coding(),
      event({ juliusInstanceId: 'julius-2', state: 'complete' }),
    );
    expect((outcome.reason ?? '').length).toBeGreaterThan(15);
    expect(outcome.session.lastRefusalReason).toBe(outcome.reason);
  });

  it('keeps ordering refusals and legality refusals in different counters', () => {
    let s = coding();
    s = applyWonderlandEnvelope(s, event({ state: 'blocked', sequence: 6, revision: 6 })).session;
    s = applyWonderlandEnvelope(s, event({ projectId: 'other' })).session;
    s = applyWonderlandEnvelope(s, event({ state: 'complete', sequence: 7, revision: 7 })).session;
    expect(s.cursor.foreignProjects).toBe(1);
    expect(s.illegalTransitionsRefused).toBe(1);
  });
});

/* ------------------------------------------------------------- recovery */

describe('recovering from a snapshot', () => {
  const snapshot = (state: Parameters<typeof wonderlandRunSnapshot>[0]['state'], revision: number) =>
    wonderlandRunSnapshot({
      projectId: PROJECT,
      juliusInstanceId: JULIUS,
      runId: RUN,
      missionId: 'mission-1',
      state,
      revision,
      observedAtIso: AT,
    });

  it('shows CODING for a client joining mid-mission, with the right clip', () => {
    const outcome = recoverWonderlandSession(session(), snapshot('EXECUTING', 7));
    expect(outcome.session.visualState).toBe('coding');
    expect(outcome.session.clip).toBe('code_type');
    expect(outcome.session.stateSource).toBe('julius_run_state');
    expect(outcome.session.terminal).toBe(false);
  });

  it('returns NO PLAN, because arriving is not a transition', () => {
    // Handing a renderer a `wake` into the middle of a mission would perform an
    // entrance that never happened.
    expect(recoverWonderlandSession(session(), snapshot('EXECUTING', 7)).plan).toBeNull();
  });

  it('recovers COMPLETE as terminal, from the KERNEL state', () => {
    const outcome = recoverWonderlandSession(session(), snapshot('COMPLETED', 9));
    expect(outcome.session.visualState).toBe('complete');
    expect(outcome.session.terminal).toBe(true);
  });

  it('replays the whole history afterwards without moving', () => {
    // The headline reconnect requirement, through the composed fold.
    let s = recoverWonderlandSession(session(), snapshot('COMPLETED', 6)).session;
    const before = s.visualState;
    s = applyWonderlandEnvelopes(s, [
      event({ state: 'attention', sequence: 1, revision: 1 }),
      event({ state: 'prompt_architect', sequence: 2, revision: 2 }),
      event({ state: 'coding', sequence: 3, revision: 3 }),
      event({ state: 'complete', sequence: 6, revision: 6, terminal: true }),
    ]);
    expect(s.visualState).toBe(before);
    expect(s.visualState).toBe('complete');
    expect(s.cursor.applied).toBe(0);
    expect(s.cursor.staleRevisions).toBe(4);
  });

  it('refuses a snapshot from another world and keeps what it had', () => {
    const s = applyWonderlandEnvelope(session(), event({ state: 'coding' })).session;
    const outcome = recoverWonderlandSession(
      s,
      wonderlandRunSnapshot({
        projectId: 'other',
        runId: RUN,
        state: 'COMPLETED',
        revision: 99,
        observedAtIso: AT,
      }),
    );
    expect(outcome.session.visualState).toBe('coding');
    expect(outcome.session.terminal).toBe(false);
    expect((outcome.reason ?? '').length).toBeGreaterThan(10);
  });
});

describe('across the fold', () => {
  it('keeps every session frozen and correctly shaped', () => {
    const sessions = [
      session(),
      applyWonderlandEnvelope(session(), event({ state: 'coding' })).session,
      applyWonderlandEnvelope(session(), event({ projectId: 'other' })).session,
      recoverWonderlandSession(session(), wonderlandRunSnapshot({
        projectId: PROJECT, runId: RUN, state: 'REVIEWING', revision: 2, observedAtIso: AT,
      })).session,
    ];
    for (const s of sessions) {
      expect(Object.isFrozen(s)).toBe(true);
      expect(Object.keys(s).sort()).toEqual([...WONDERLAND_SESSION_FIELDS].sort());
      expect(s.projectId).toBe(PROJECT);
    }
  });

  it('leaks no provider payload into the session, whatever the envelope carried', () => {
    const s = applyWonderlandEnvelope(
      session(),
      event({
        state: 'coding',
        metadata: { completion: 'x'.repeat(400), apiKey: 'sk-live-abcdefgh', model: 'gpt-4o' },
      }),
    ).session;
    const text = JSON.stringify(s);
    expect(text).not.toContain('xxxxx');
    expect(text).not.toMatch(/\bsk-live/);
    // The session holds no metadata field at all — the envelope's stays there.
    expect(Object.keys(s)).not.toContain('metadata');
  });
});
