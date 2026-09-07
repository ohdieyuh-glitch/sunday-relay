import { describe, expect, it } from 'vitest';

import type { JuliusOperationalEvent } from '../julius/julius-events';
import {
  WONDERLAND_CAPTURE_ESTABLISHES,
  WONDERLAND_CAPTURE_FIELDS,
  WONDERLAND_CAPTURE_ORIGINS,
  WONDERLAND_CAPTURE_SCHEMA_V1,
  WONDERLAND_EVIDENCE_FIELDS,
  WONDERLAND_EVIDENCE_LEVELS,
  verifyWonderlandCapture,
  wonderlandCapture,
  wonderlandEvidenceAtLeast,
  wonderlandEvidenceClaim,
} from './wonderland-evidence';
import type { WonderlandCapture } from './wonderland-evidence';
import { WONDERLAND_JULIUS_DEV_SCRIPT } from './wonderland-julius-link';

/**
 * THE HONESTY LADDER, AS CODE.
 *
 * The two tests that matter most are both negatives: `real` is unreachable from
 * here no matter what is fed in, and a capture claiming a live origin without
 * naming the run it came from is downgraded rather than believed. Everything
 * else is bookkeeping around those two.
 */

const PROJECT = 'project-1';
const nextEventId = (_: JuliusOperationalEvent, index: number) => `evt-${index}`;

const kernelEvent = (
  overrides: Partial<JuliusOperationalEvent> = {},
): JuliusOperationalEvent => ({
  eventId: 'julius-1',
  runId: 'run-1',
  projectId: PROJECT,
  type: 'run.transitioned',
  taskId: null,
  workerId: null,
  correlationId: 'corr-1',
  causationId: null,
  occurredAt: '2026-09-07T10:00:00.000Z',
  facts: {},
  ...overrides,
});

/** The dev script, which really does move the world. */
const script = (): readonly JuliusOperationalEvent[] =>
  WONDERLAND_JULIUS_DEV_SCRIPT.map((event) => ({ ...event, projectId: PROJECT }));

const synthesised = (
  events: readonly JuliusOperationalEvent[] = script(),
): WonderlandCapture =>
  wonderlandCapture({ captureId: 'cap-1', projectId: PROJECT, events });

/** A capture that has paid for its live claim. */
const recorded = (
  events: readonly JuliusOperationalEvent[] = script(),
): WonderlandCapture =>
  wonderlandCapture({
    captureId: 'cap-1',
    projectId: PROJECT,
    events,
    origin: 'recorded_from_live_run',
    sourceRunId: 'run-1',
    capturedAtIso: '2026-09-07T10:00:00.000Z',
  });

const verify = (capture: WonderlandCapture) =>
  verifyWonderlandCapture(capture, { nextEventId });

/* -------------------------------------------------------------- the ladder */

describe('the ladder', () => {
  it('runs weakest to strongest, so the order is the comparison', () => {
    expect([...WONDERLAND_EVIDENCE_LEVELS]).toEqual([
      'not_built',
      'simulated',
      'integration_ready',
      'recorded_event_verified',
      'real',
    ]);
  });

  it('compares by rung', () => {
    expect(wonderlandEvidenceAtLeast('real', 'recorded_event_verified')).toBe(true);
    expect(wonderlandEvidenceAtLeast('recorded_event_verified', 'real')).toBe(false);
    expect(wonderlandEvidenceAtLeast('simulated', 'simulated')).toBe(true);
    expect(wonderlandEvidenceAtLeast('not_built', 'simulated')).toBe(false);
  });

  it('says out loud that a capture can only ever establish two of the five', () => {
    expect([...WONDERLAND_CAPTURE_ESTABLISHES]).toEqual([
      'simulated',
      'recorded_event_verified',
    ]);
  });

  it('defaults an origin to the assumption that can only understate', () => {
    expect(WONDERLAND_CAPTURE_ORIGINS[0]).toBe('synthesised');
  });
});

/* ------------------------------------------------- the rung nothing reaches */

describe('`real` is unreachable from a replay', () => {
  it('is never returned, whatever is fed in', () => {
    // `real` means a live run drove the world AS IT RAN. A replay is not that,
    // however genuine the recording: the events are real and the driving is not.
    const captures: readonly WonderlandCapture[] = [
      synthesised(),
      recorded(),
      recorded([]),
      synthesised([]),
      recorded([kernelEvent({ type: 'run.transitioned', facts: { to: 'COMPLETED' } })]),
    ];
    for (const capture of captures) {
      const evidence = verify(capture);
      expect(evidence.level).not.toBe('real');
      expect(WONDERLAND_CAPTURE_ESTABLISHES.concat('integration_ready')).toContain(
        evidence.level,
      );
    }
  });

  it('cannot be reached by a capture that ran an entire mission to completion', () => {
    const evidence = verify(recorded());
    expect(evidence.reachedTerminal).toBe(true);
    expect(evidence.level).toBe('recorded_event_verified');
    expect(evidence.reason).toContain('NOT a live run');
  });
});

/* ----------------------------------------------- claiming a live origin */

describe('claiming to be recorded from a live run', () => {
  it('is downgraded when the run is not named', () => {
    const capture = wonderlandCapture({
      captureId: 'cap-1',
      projectId: PROJECT,
      events: script(),
      origin: 'recorded_from_live_run',
      capturedAtIso: '2026-09-07T10:00:00.000Z',
    });
    expect(capture.origin).toBe('synthesised');
    expect(verify(capture).level).toBe('simulated');
  });

  it('is downgraded when the capture time is not recorded', () => {
    const capture = wonderlandCapture({
      captureId: 'cap-1',
      projectId: PROJECT,
      events: script(),
      origin: 'recorded_from_live_run',
      sourceRunId: 'run-1',
    });
    expect(capture.origin).toBe('synthesised');
  });

  it('is downgraded by blank or whitespace, not just by absence', () => {
    for (const [runId, at] of [
      ['', '2026-09-07T10:00:00.000Z'],
      ['   ', '2026-09-07T10:00:00.000Z'],
      ['run-1', '  '],
    ] as const) {
      const capture = wonderlandCapture({
        captureId: 'cap-1',
        projectId: PROJECT,
        events: script(),
        origin: 'recorded_from_live_run',
        sourceRunId: runId,
        capturedAtIso: at,
      });
      expect(capture.origin).toBe('synthesised');
    }
  });

  it('is downgraded IN THE RECORD, so a file on disk cannot sit there lying', () => {
    // The downgrade happens at construction rather than at verification: a
    // stored capture claiming a live origin would otherwise survive being read
    // by something that never called the verifier.
    const capture = wonderlandCapture({
      captureId: 'cap-1',
      projectId: PROJECT,
      events: script(),
      origin: 'recorded_from_live_run',
    });
    expect(JSON.parse(JSON.stringify(capture)).origin).toBe('synthesised');
  });

  it('keeps a partially filled record, so the downgrade stays explainable', () => {
    const capture = wonderlandCapture({
      captureId: 'cap-1',
      projectId: PROJECT,
      events: script(),
      origin: 'recorded_from_live_run',
      sourceRunId: 'run-7',
    });
    expect(capture.origin).toBe('synthesised');
    expect(capture.sourceRunId).toBe('run-7');
    expect(capture.capturedAtIso).toBeNull();
  });

  it('is honoured when it is paid for', () => {
    expect(recorded().origin).toBe('recorded_from_live_run');
    expect(verify(recorded()).level).toBe('recorded_event_verified');
  });
});

/* ---------------------------------------------------------- the replay */

describe('replaying a capture', () => {
  it('uses the real seam, and reports what it actually reached', () => {
    const evidence = verify(recorded());
    expect(evidence.eventsCaptured).toBe(WONDERLAND_JULIUS_DEV_SCRIPT.length);
    expect(evidence.eventsApplied).toBe(evidence.eventsNormalized);
    expect(evidence.statesObserved.length).toBeGreaterThan(1);
    expect(evidence.statesObserved).toContain('complete');
    // Silent events are ordinary: most kernel events are not state changes.
    expect(evidence.silentEvents).toBe(
      evidence.eventsCaptured - evidence.eventsNormalized,
    );
  });

  it('lists each observed state once, in the order it arrived', () => {
    const evidence = verify(recorded());
    expect(new Set(evidence.statesObserved).size).toBe(evidence.statesObserved.length);
    expect(evidence.statesObserved[evidence.statesObserved.length - 1]).toBe('complete');
  });

  it('is deterministic: the same capture verifies the same way twice', () => {
    expect(verify(recorded())).toEqual(verify(recorded()));
  });

  it('drops to integration-ready when nothing in it moved the world', () => {
    // A real recording of events the model does not map proves the code runs
    // and nothing at all about a mission. That is what integration-ready means.
    const quiet = recorded([kernelEvent({ type: 'evidence.recorded' })]);
    const evidence = verify(quiet);
    expect(evidence.statesObserved).toEqual([]);
    expect(evidence.level).toBe('integration_ready');
    expect(evidence.reason).toContain('no event in it produced a visual state');
  });

  it('says plainly that an empty capture establishes nothing', () => {
    const evidence = verify(recorded([]));
    expect(evidence.level).toBe('integration_ready');
    expect(evidence.reason).toContain('holds no events');
  });

  it('is frozen and shaped exactly as declared', () => {
    const evidence = verify(recorded());
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.keys(evidence).sort()).toEqual([...WONDERLAND_EVIDENCE_FIELDS].sort());
    expect(Object.keys(recorded()).sort()).toEqual([...WONDERLAND_CAPTURE_FIELDS].sort());
    expect(recorded().schemaVersion).toBe(WONDERLAND_CAPTURE_SCHEMA_V1);
  });
});

/* ------------------------------------------------------------- the claim */

describe('the sentence a person may say', () => {
  it('never lets a replay be described as a live run', () => {
    // This is the sentence that gets copied into a demo script, and it is the
    // exact point where `recorded_event_verified` becomes "Julius is connected".
    const claim = wonderlandEvidenceClaim(verify(recorded()));
    expect(claim).toContain('replayed');
    expect(claim).toContain('No live run has driven the world');
    expect(claim.toLowerCase()).not.toContain('connected');
  });

  it('says a synthesised run is simulated, in those words', () => {
    expect(wonderlandEvidenceClaim(verify(synthesised())).toLowerCase()).toContain(
      'simulated',
    );
  });

  it('has a sentence for every rung', () => {
    for (const level of WONDERLAND_EVIDENCE_LEVELS) {
      const claim = wonderlandEvidenceClaim({
        ...verify(synthesised()),
        level,
      });
      expect(claim.length).toBeGreaterThan(15);
      expect(claim.endsWith('.')).toBe(true);
    }
  });

  it('describes today`s repository correctly: nothing is above integration-ready', () => {
    // The dev script is the only Julius event stream this repository owns, and
    // it is synthesised. There is no capture anywhere that could do better.
    const evidence = verify(synthesised());
    expect(wonderlandEvidenceAtLeast(evidence.level, 'recorded_event_verified')).toBe(false);
  });
});
