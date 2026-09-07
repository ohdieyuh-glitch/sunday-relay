import { describe, expect, it } from 'vitest';

import { WONDERLAND_LINK_EXPLANATIONS } from './wonderland-bridge';
import type { WonderlandLinkStatus } from './wonderland-bridge';
import { beginWonderlandEntry } from './wonderland-entry';
import { wonderlandEnvelope } from './wonderland-envelope';
import { applyWonderlandOrdering, openWonderlandCursor } from './wonderland-ordering';
import type { WonderlandCursor } from './wonderland-ordering';
import { accountWonderlandUsage } from './wonderland-usage-accounting';
import type { WonderlandUsageAuthorityStatus } from './wonderland-usage-authority';
import {
  WONDERLAND_DIAGNOSTICS_FIELDS,
  WONDERLAND_DIAGNOSTICS_SCHEMA_V1,
  formatWonderlandDiagnostics,
  projectWonderlandDiagnostics,
} from './wonderland-diagnostics';

/**
 * DIAGNOSTICS.
 *
 * Two things are worth proving: that every question an operator actually asks
 * has an answer here, and that nothing sensitive can be in the answer. The
 * second is checked by sweeping the rendered output rather than by reading the
 * type, because "there is no field for it" is a claim worth testing.
 */

const PROJECT = 'project-1';

const link: WonderlandLinkStatus = Object.freeze({
  state: 'live',
  lastSnapshotAtIso: '2026-09-07T10:00:00.000Z',
  explanation: WONDERLAND_LINK_EXPLANATIONS.live,
});

const usage: WonderlandUsageAuthorityStatus = Object.freeze({
  reading: 'not_reported',
  reason: 'No usage authority has reported capacity for this world yet.',
  ageSeconds: null,
  revision: 0,
  authorityId: null,
  foreignProjectReportsRejected: 0,
  staleRevisionsRejected: 0,
  malformedReportsRejected: 0,
});

let n = 0;
const event = (overrides: Record<string, unknown> = {}) => {
  n += 1;
  return wonderlandEnvelope({
    eventId: `evt-${n}`,
    projectId: PROJECT,
    juliusInstanceId: 'julius-1',
    runId: 'run-1',
    state: 'coding',
    stateSource: 'julius_run_state',
    sequence: n,
    revision: 1,
    occurredAt: '2026-09-07T10:00:00.000Z',
    ...overrides,
  });
};

const cursorWith = (events: readonly ReturnType<typeof event>[]): WonderlandCursor =>
  events.reduce(
    (c, e) => applyWonderlandOrdering(c, e).cursor,
    openWonderlandCursor({ projectId: PROJECT }),
  );

const project = (overrides: Partial<Parameters<typeof projectWonderlandDiagnostics>[0]> = {}) =>
  projectWonderlandDiagnostics({
    cursor: cursorWith([event({ sequence: 1 })]),
    link,
    reconnectAttempts: 0,
    usage,
    visualState: 'coding',
    terminal: false,
    unobservedReason: null,
    ...overrides,
  });

describe('the shape', () => {
  it('is frozen, versioned and exactly as declared', () => {
    const d = project();
    expect(d.schemaVersion).toBe(WONDERLAND_DIAGNOSTICS_SCHEMA_V1);
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.keys(d).sort()).toEqual([...WONDERLAND_DIAGNOSTICS_FIELDS].sort());
  });

  it('answers every question an operator actually asks', () => {
    const d = project();
    expect(d.projectId).toBe(PROJECT);
    expect(d.juliusInstanceId).toBe('julius-1');
    expect(d.runId).toBe('run-1');
    expect(d.visualState).toBe('coding');
    expect(d.lastAcceptedSequence).toBe(1);
    expect(d.lastAcceptedRevision).toBe(1);
    expect(d.linkState).toBe('live');
    expect(d.usageReading).toBe('not_reported');
    expect(d.entryAdmission).toBe('not_requested');
  });
});

describe('what it says about a stream', () => {
  it('reads clean when nothing has been refused', () => {
    expect(project().degraded).toBe(false);
  });

  it('flags degraded on ANY refusal, and keeps the kinds apart', () => {
    const cursor = cursorWith([
      event({ sequence: 1 }),
      event({ projectId: 'other', sequence: 2 }),
      event({ sequence: 2, runId: 'run-9' }),
      event({ sequence: 1, eventId: 'stale-one' }),
    ]);
    const d = project({ cursor });
    expect(d.degraded).toBe(true);
    expect(d.foreignProjectsRejected).toBe(1);
    expect(d.foreignRunsRejected).toBe(1);
    expect(d.staleSequencesRejected + d.staleRevisionsRejected).toBe(1);
    expect(d.eventsAccepted).toBe(1);
  });

  it('counts a gap as degraded even when everything that arrived was accepted', () => {
    const d = project({ cursor: cursorWith([event({ sequence: 1 }), event({ sequence: 9 })]) });
    expect(d.sequenceGaps).toBe(1);
    expect(d.eventsAccepted).toBe(2);
    expect(d.degraded).toBe(true);
  });

  it('says whether the revision came from a snapshot', () => {
    // Which decides what a tie means, so an operator debugging a refused event
    // needs to be able to see it.
    expect(project().revisionFromSnapshot).toBe(false);
  });
});

describe('what it says about money', () => {
  it('distinguishes "nothing totalled" from "the total is complete"', () => {
    // Null rather than false: they are different answers and collapsing them
    // would make a build with no accounting look like one with a clean total.
    expect(project().usageAccountPartial).toBeNull();
    expect(project({ account: accountWonderlandUsage([]) }).usageAccountPartial).toBe(false);
  });

  it('surfaces unattributed units, which is why a meter may read UNKNOWN', () => {
    const account = accountWonderlandUsage([
      { units: 12, orchestratorId: null, runId: null, workerRole: null, soloAgentId: null },
    ]);
    const d = project({ account });
    expect(d.usageAccountPartial).toBe(true);
    expect(d.usageUnattributedUnits).toBe(12);
  });

  it('reports the authority`s own reading rather than deriving one', () => {
    const d = project({
      usage: { ...usage, reading: 'stale', ageSeconds: 900, revision: 4, authorityId: 'auth-1' },
    });
    expect(d.usageReading).toBe('stale');
    expect(d.usageAgeSeconds).toBe(900);
    expect(d.usageAuthorityId).toBe('auth-1');
  });
});

describe('what it says about the way in', () => {
  it('reports admission and presentation separately', () => {
    const d = project({
      entry: beginWonderlandEntry({ projectId: PROJECT, playerId: 'player-1' }),
    });
    expect(d.entryAdmission).toBe('not_requested');
    expect(d.entryPresentation).toBe('no_renderer');
  });
});

/* ------------------------------------------------------------- the sweep */

describe('nothing sensitive can be in the answer', () => {
  it('carries no credential, header, URL or provider name', () => {
    // Structural rather than filtered — there is no field these could occupy —
    // but the claim is worth checking rather than trusting.
    const rendered = formatWonderlandDiagnostics(
      project({
        cursor: cursorWith([event({ sequence: 1, metadata: { apiKey: 'sk-live-abcdefgh' } })]),
        account: accountWonderlandUsage([]),
        entry: beginWonderlandEntry({ projectId: PROJECT, playerId: 'p' }),
        lastRefusalReason: 'This snapshot belongs to another world.',
      }),
    ).toLowerCase();

    for (const leak of [
      'bearer',
      'authorization',
      'relay-session',
      'http://',
      'https://',
      'openai',
      'anthropic',
      'gpt-',
      'claude-',
      'hermes',
    ]) {
      expect(rendered, `diagnostics leaked ${leak}`).not.toContain(leak);
    }
    expect(rendered).not.toMatch(/\bsk-[a-z0-9]{8,}/);
  });

  it('carries no metadata or payload field at all', () => {
    const fields = [...WONDERLAND_DIAGNOSTICS_FIELDS].map((f) => f.toLowerCase());
    for (const forbidden of ['metadata', 'payload', 'facts', 'token', 'header', 'url', 'body']) {
      expect(fields.some((f) => f.includes(forbidden))).toBe(false);
    }
  });

  it('renders every field, using `unknown` rather than blank for an absence', () => {
    const rendered = formatWonderlandDiagnostics(project());
    for (const field of WONDERLAND_DIAGNOSTICS_FIELDS) {
      expect(rendered).toContain(`${field}: `);
    }
    expect(rendered).toContain('unknown');
    expect(rendered.split('\n').length).toBe(WONDERLAND_DIAGNOSTICS_FIELDS.length);
  });

  it('holds no state of its own — the same inputs render identically', () => {
    expect(formatWonderlandDiagnostics(project())).toBe(formatWonderlandDiagnostics(project()));
  });
});
