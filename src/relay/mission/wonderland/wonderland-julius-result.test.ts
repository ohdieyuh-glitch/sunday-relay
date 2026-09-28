import { describe, expect, it } from 'vitest';

import type { JuliusMissionResultView } from '../julius/julius-runtime-api';
import {
  WONDERLAND_JULIUS_RESULT_FIELDS,
  WONDERLAND_JULIUS_RESULT_SCHEMA_V1,
  WONDERLAND_RESULT_WITHHELD,
  projectWonderlandJuliusResult,
  trimHostPaths,
} from './wonderland-julius-result';

/**
 * THE USER RESULT, HELD TO FOUNDER DECISION 5.
 *
 * Every removal has a CONTROL beside it: the same field carrying ordinary text
 * comes through untouched, so no test here can pass because the projection
 * simply blanked everything.
 */

const DIGEST = 'a'.repeat(64);

const view = (over: Partial<JuliusMissionResultView> = {}): JuliusMissionResultView => ({
  runId: 'run:0001',
  missionId: 'mission:alpha',
  state: 'COMPLETED',
  verified: true,
  terminal: true,
  criteria: [
    { criterionId: 'c-1', description: 'The page loads in under a second', requiredEvidenceTypes: ['TEST'],
      satisfied: true, basis: 'EVIDENCE', evidenceIds: ['e-1'] },
    { criterionId: 'c-2', description: 'The mission is complete', requiredEvidenceTypes: [],
      satisfied: true, basis: 'COMPLETION', evidenceIds: [] },
  ],
  deliverables: [
    { evidenceId: 'e-1', taskId: 'task-internal-7', type: 'TEST', safeSummary: '12 tests passed in src/app.test.ts',
      artifactRef: 'artifact:report-1', integrityHash: DIGEST, retained: true, occurredAt: '2026-09-27T10:00:00.000Z' },
  ],
  outstandingFindings: [],
  reviewDecisions: [{ taskId: 'task-internal-7', action: 'ACCEPT', reasonCode: 'ALL_EVIDENCE_PASSED' }],
  cost: { knownUsdMicros: 1_234_567, unknownComponents: 0, complete: true },
  failure: null,
  ...over,
});

const OWNER = { includeCost: true } as const;
const MEMBER = { includeCost: false } as const;

describe('the result is Julius\'s, with nothing re-derived', () => {
  it('carries the run, both words for its state, and Julius\'s own verdicts verbatim', () => {
    const result = projectWonderlandJuliusResult(view(), OWNER);
    expect(result.schemaVersion).toBe(WONDERLAND_JULIUS_RESULT_SCHEMA_V1);
    expect(result).toMatchObject({
      runId: 'run:0001', missionId: 'mission:alpha', juliusState: 'COMPLETED', taskState: 'Completed',
      verified: true, terminal: true, tokens: 'UNKNOWN', withheldDetails: 0, failure: null,
    });
    expect(result.criteria.map((c) => [c.criterionId, c.satisfied, c.basis])).toEqual([
      ['c-1', true, 'EVIDENCE'], ['c-2', true, 'COMPLETION'],
    ]);
  });

  it('NEVER re-derives: an unverified run whose criteria all read satisfied stays unverified', () => {
    // Julius decided both halves. A projection that "fixed" either would be a second authority.
    const result = projectWonderlandJuliusResult(view({ state: 'EXECUTING', verified: false, terminal: false }), OWNER);
    expect(result.verified).toBe(false);
    expect(result.criteria.every((c) => c.satisfied)).toBe(true);
    expect(result.taskState).toBe('Implementation');
  });

  it('a READY run is Queued, not verified, not over -- the run the acceptance follows', () => {
    const result = projectWonderlandJuliusResult(view({
      state: 'READY', verified: false, terminal: false, deliverables: [], reviewDecisions: [],
      criteria: [{ criterionId: 'c-2', description: 'The mission is complete', requiredEvidenceTypes: [],
        satisfied: false, basis: 'COMPLETION', evidenceIds: [] }],
      cost: { knownUsdMicros: 0, unknownComponents: 0, complete: true },
    }), OWNER);
    expect(result).toMatchObject({ juliusState: 'READY', taskState: 'Queued', verified: false, terminal: false });
    expect(result.review).toEqual({ verdict: null, reasonCode: null, repairRounds: 0, reReviewedAfterRepair: false, decisions: 0 });
  });

  it('names exactly its fields -- no taskId, no slot, no provider, no model rides along', () => {
    const result = projectWonderlandJuliusResult(view({
      outstandingFindings: [{ findingId: 'f-1', taskId: 'task-internal-7', claim: 'A test is flaky', severity: 'HIGH' }],
    }), OWNER);
    expect(Object.keys(result).sort()).toEqual([...WONDERLAND_JULIUS_RESULT_FIELDS].sort());
    expect(Object.keys(result.deliverables[0]).sort()).toEqual(
      ['artifactRef', 'evidenceId', 'integrityHash', 'occurredAt', 'retained', 'summary', 'type']);
    expect(Object.keys(result.openFindings[0]).sort()).toEqual(['claim', 'findingId', 'severity']);
    expect(JSON.stringify(result)).not.toContain('task-internal-7');
  });

  it('is frozen, all the way down', () => {
    const result = projectWonderlandJuliusResult(view(), OWNER);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.criteria[0])).toBe(true);
    expect(Object.isFrozen(result.deliverables[0])).toBe(true);
    expect(Object.isFrozen(result.cost)).toBe(true);
  });
});

describe('COST: the owner sees it; an ordinary member does not (founder decision 5)', () => {
  it('a member gets no cost at all -- not zero, not a floor, not a field to read', () => {
    const result = projectWonderlandJuliusResult(view(), MEMBER);
    expect(result.cost).toEqual({ visible: false });
    expect(JSON.stringify(result)).not.toContain('1234567');
    expect(JSON.stringify(result)).not.toMatch(/usd/i);
  });

  it('CONTROL: the owner gets the exact figure, and whether it is complete', () => {
    expect(projectWonderlandJuliusResult(view(), OWNER).cost)
      .toEqual({ visible: true, knownUsdMicros: 1_234_567, unknownComponents: 0, complete: true });
    expect(projectWonderlandJuliusResult(view({ cost: { knownUsdMicros: 5, unknownComponents: 2, complete: false } }), OWNER).cost)
      .toEqual({ visible: true, knownUsdMicros: 5, unknownComponents: 2, complete: false });
  });

  it('TOKENS are UNKNOWN for everyone, never a number standing in for one', () => {
    expect(projectWonderlandJuliusResult(view(), OWNER).tokens).toBe('UNKNOWN');
    expect(projectWonderlandJuliusResult(view(), MEMBER).tokens).toBe('UNKNOWN');
  });
});

describe('NEVER SHOWN: reasoning, secrets, credentials, host paths', () => {
  it('a finding claim carrying private reasoning is withheld whole, and counted', () => {
    const result = projectWonderlandJuliusResult(view({
      outstandingFindings: [
        { findingId: 'f-1', taskId: 't', severity: 'HIGH', claim: 'My chain of thought: the user probably wants X' },
        { findingId: 'f-2', taskId: 't', severity: 'LOW', claim: 'The header overlaps the logo at 320px' },
      ],
    }), OWNER);
    expect(result.openFindings[0].claim).toBe(WONDERLAND_RESULT_WITHHELD);
    // CONTROL: an ordinary claim is untouched.
    expect(result.openFindings[1].claim).toBe('The header overlaps the logo at 320px');
    expect(result.withheldDetails).toBe(1);
  });

  it('an evidence summary carrying a stack trace is withheld whole', () => {
    const result = projectWonderlandJuliusResult(view({
      deliverables: [{ ...view().deliverables[0], safeSummary: 'TypeError: x is undefined\n    at run (/srv/app/worker.js:10:3)' }],
    }), OWNER);
    expect(result.deliverables[0].summary).toBe(WONDERLAND_RESULT_WITHHELD);
    // CONTROL: the default summary, with its relative path, is shown as written.
    expect(projectWonderlandJuliusResult(view(), OWNER).deliverables[0].summary).toBe('12 tests passed in src/app.test.ts');
  });

  it('secrets are redacted wherever they appear -- the credential itself, not only its label -- and counted', () => {
    const result = projectWonderlandJuliusResult(view({
      deliverables: [{ ...view().deliverables[0], safeSummary: 'Called the API with Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123' }],
      // relay-boundary:allow-fixture
      failure: { reasonCode: 'PROVIDER_ERROR', failureClass: 'OPENAI_API_KEY=sk-FAKETESTNOTREAL-aaaaaaaaaaaa' },
      state: 'FAILED', verified: false,
    }), OWNER);
    const json = JSON.stringify(result);
    expect(json).not.toContain('abcdefghijklmnopqrstuvwxyz0123');
    expect(json).not.toContain('FAKETESTNOTREAL');
    expect(json).toContain('[redacted]');
    // CONTROL: the code beside it is untouched.
    expect(result.failure?.reasonCode).toBe('PROVIDER_ERROR');
    expect(result.withheldDetails).toBe(2);
  });

  it('host paths are cut back to the file name the mission made, and counted', () => {
    const result = projectWonderlandJuliusResult(view({
      criteria: [{ ...view().criteria[0], description: 'Write C:\\Users\\kaisi\\julius-ws\\run-9\\src\\index.html.' }],
      outstandingFindings: [{ findingId: 'f', taskId: 't', severity: 'LOW', claim: 'Fails in /home/runner/work/ws/src/app.ts' }],
    }), OWNER);
    expect(result.criteria[0].description).toBe('Write \u2026/index.html.');
    expect(result.openFindings[0].claim).toBe('Fails in \u2026/app.ts');
    expect(JSON.stringify(result)).not.toMatch(/kaisi|runner|julius-ws/);
    expect(result.withheldDetails).toBe(2);
  });

  it('an artifact reference Julius could not promise -- a process key or a path -- is dropped, never shown', () => {
    const shown = (artifactRef: string | null, integrityHash: string | null) =>
      projectWonderlandJuliusResult(view({ deliverables: [{ ...view().deliverables[0], artifactRef, integrityHash }] }), OWNER);
    for (const bad of ['diff:run-1', 'C:\\dev\\ws\\out.zip', '/home/me/out.zip', 'local://not-a-digest']) {
      const result = shown(bad, DIGEST);
      expect(result.deliverables[0].artifactRef, bad).toBeNull();
      expect(result.deliverables[0].retained).toBe(false);
      expect(result.withheldDetails).toBe(1);
    }
    expect(shown('artifact:report-1', 'not-a-digest').deliverables[0].integrityHash).toBeNull();
    // CONTROL: a durable reference and a real digest come through.
    expect(shown('artifact:report-1', DIGEST).deliverables[0]).toMatchObject({ artifactRef: 'artifact:report-1', integrityHash: DIGEST, retained: true });
  });

  it('a corpus of everything forbidden leaves nothing forbidden in the JSON', () => {
    const poison = [
      'thinking: I should hide this',
      'system prompt says be terse',
      'the adapter echoed sk-ant-api03-FAKETESTNOTREAL-aaaaaaaaaaaa', // relay-boundary:allow-fixture
      'postgres://' + 'relay:FAKETESTNOTREAL@invalid/fixture', // relay-boundary:allow-fixture
      'C:\\Users\\kaisi\\secret-dir\\notes.txt',
      '\\\\fileserver\\share\\kaisi\\notes.txt',
      'file:///C:/Users/kaisi/notes.txt',
    ];
    const result = projectWonderlandJuliusResult(view({
      criteria: poison.map((text, i) => ({ criterionId: `c-${i}`, description: text, requiredEvidenceTypes: [], satisfied: false, basis: 'COMPLETION' as const, evidenceIds: [] })),
      outstandingFindings: poison.map((text, i) => ({ findingId: `f-${i}`, taskId: 't', severity: 'HIGH', claim: text })),
    }), MEMBER);
    const json = JSON.stringify(result);
    for (const needle of ['hide this', 'be terse', 'FAKETESTNOTREAL', 'kaisi', 'secret-dir', 'fileserver']) {
      expect(json, needle).not.toContain(needle);
    }
  });
});

describe('the review, and repair', () => {
  const decided = (...actions: string[]) => projectWonderlandJuliusResult(view({
    reviewDecisions: actions.map((action, i) => ({ taskId: 't', action, reasonCode: `R${i}` })),
  }), OWNER).review;

  it('the verdict is the LATEST decision, and a repair followed by a decision was re-reviewed', () => {
    expect(decided('REPAIR', 'ACCEPT')).toEqual({ verdict: 'ACCEPT', reasonCode: 'R1', repairRounds: 1, reReviewedAfterRepair: true, decisions: 2 });
  });

  it('a repair that is the last word has not been re-reviewed yet', () => {
    expect(decided('ACCEPT', 'REPAIR')).toMatchObject({ verdict: 'REPAIR', repairRounds: 1, reReviewedAfterRepair: false });
    expect(decided('REPAIR', 'ACCEPT', 'REPAIR')).toMatchObject({ repairRounds: 2, reReviewedAfterRepair: false });
  });

  it('no repair is no repair', () => {
    expect(decided('ACCEPT')).toMatchObject({ repairRounds: 0, reReviewedAfterRepair: false });
  });
});

describe('the failure, when there is one', () => {
  it('is the reason Julius named, carried as a code', () => {
    const result = projectWonderlandJuliusResult(view({
      state: 'FAILED', verified: false, failure: { reasonCode: 'TASK_FAILED', failureClass: 'PROVIDER_TIMEOUT' },
    }), MEMBER);
    expect(result.failure).toEqual({ reasonCode: 'TASK_FAILED', failureClass: 'PROVIDER_TIMEOUT' });
    expect(result.taskState).toBe('Failed');
  });

  it('a reason that is really a stack trace is withheld rather than printed as a code', () => {
    const result = projectWonderlandJuliusResult(view({
      state: 'FAILED', verified: false,
      failure: { reasonCode: 'Error: boom\n    at x (C:\\dev\\a.js:1:1)', failureClass: null },
    }), MEMBER);
    expect(result.failure).toEqual({ reasonCode: WONDERLAND_RESULT_WITHHELD, failureClass: null });
  });
});

describe('trimHostPaths', () => {
  it('cuts each kind of host path and counts them', () => {
    expect(trimHostPaths('a C:\\x\\y\\z.txt b /Users/q/r.md c \\\\srv\\share\\s.doc d file:///tmp/t.log'))
      .toEqual({ text: 'a \u2026/z.txt b \u2026/r.md c \u2026/s.doc d \u2026/t.log', trimmed: 4 });
  });

  it('CONTROL: leaves the project\'s own relative paths, URLs and ordinary prose alone', () => {
    for (const text of [
      'edited src/app.ts and docs/readme.md', 'see https://example.com/home/page', 'ratio 3:4 at 10:30',
      'the /api/users route', 'a ~/notes file',
    ]) {
      expect(trimHostPaths(text), text).toEqual({ text, trimmed: 0 });
    }
  });
});
