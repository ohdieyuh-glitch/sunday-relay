/**
 * THE FOUNDER'S SECOND PHRASE, `RERUN PAID MISSION`, end to end over the real
 * admission file, the real claim core and the real Start and /status routes,
 * with a fake `gh` and an injected prior-attempt reader. Offline; nothing here
 * can reach GitHub or spend.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PAID_WORKFLOW_FILE } from '../src/relay/integration/wonderland-admission/admission-contract';
import { openAdmissionFile, readAdmissionDocument, type ClaimEvent } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  LANE_GRANT_SOURCE,
  RERUN_PAID_MISSION_CONFIRMATION,
  createOperatorClaimTool,
  decideRerun,
  legalTransition,
  missionContractPath,
  workflowDispatchArgs,
  type GhResult,
  type GhSpawner,
  type OperatorClaimTool,
  type PriorAttemptRead,
  type PriorAttemptReader,
} from '../src/relay/integration/wonderland-admission/operator-claim';
import {
  createWonderlandAdmissionService,
  handleWonderlandAdmissionRoute,
  handleWonderlandStatusRoute,
  withRerunConsent,
  WONDERLAND_ADMISSION_PATH,
  WONDERLAND_STATUS_PATH,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import { handleWonderlandMissionStartRoute } from './wonderland-mission-start-route';
import { parseRehearsalArgv, rehearsalGh, rehearsalPriorReader, REHEARSAL_HOST, REHEARSAL_PORT } from './rehearsal/rerun-consent-harness';
import { createStatusPriorAttempts, wonderlandStatusPriorAttemptsFrom, type GhBytesRunner } from './wonderland-prior-attempts';

const ADMIT_KEY = '11111111-2222-4333-8444-555555555555';
const START_KEY = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const WHEN = '2026-10-23T17:18:00.000Z';
const PROJECT = 'project-1';
const REPO = 'founder/sunday-relay';
const MISSION = 'julius-inworld-data-1';
const WORKFLOW_RUN = '40250000001';
const RUN_A = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const RUN_B = 'wlj_1c8b2d3f-5a4e-4b7c-9d3e-4f5a6b7c8d9e';
const PHRASE = 'RERUN PAID MISSION';

const LANES = JSON.parse(readFileSync(join(__dirname, '../src/relay/integration/wonderland-admission/fixtures/pr459-lane-grants.json'), 'utf8')) as {
  readonly laneGrantExcerpt: string;
  readonly contractMarkerNamespace: string;
};
const workflowYaml = (rerunInput: boolean) => `
name: fixture
on:
  workflow_dispatch:
    inputs:
      confirm_live:
        default: ''
${rerunInput ? "      acknowledge_rerun:\n        default: ''\n" : ''}      mission:
        description: 'slug'
      lane:
        description: 'lane'
      dispatch_key:
        description: 'key'
      run_id:
        default: ''
`;
const ABSENT: GhResult = { code: 1, stdout: 'HTTP/2.0 404 Not Found\nDate: Fri, 23 Oct 2026 17:18:05 GMT\n\n{"message":"Not Found"}\n', stderr: '' };
const CONTENTS = `repos/${REPO}/contents/`;

function fakeGh(options: { rerunInput?: boolean; contract?: string } = {}): { spawn: GhSpawner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    spawn: {
      run(args) {
        calls.push([...args]);
        const target = args.find((arg) => arg.startsWith(CONTENTS));
        if (args[0] === 'api' && target !== undefined) {
          const path = target.slice(CONTENTS.length).replace(/\?ref=main$/u, '');
          const text = path === `.github/workflows/${PAID_WORKFLOW_FILE}` ? workflowYaml(options.rerunInput ?? true)
            : path === missionContractPath(MISSION) ? (options.contract ?? JSON.stringify({ markerNamespace: LANES.contractMarkerNamespace }))
              : path === LANE_GRANT_SOURCE ? LANES.laneGrantExcerpt : null;
          return text === null ? { code: 1, stdout: '', stderr: 'HTTP 404' } : { code: 0, stdout: text, stderr: '' };
        }
        if (args[0] === 'api') return ABSENT;
        if (args[0] === 'workflow') return { code: 0, stdout: `https://github.com/${REPO}/actions/runs/${WORKFLOW_RUN}\n`, stderr: '' };
        return { code: 99, stdout: '', stderr: '' };
      },
    },
  };
}

/** A reader that answers `read` and records each namespace it was asked for. */
function reader(read: PriorAttemptRead | (() => never)): PriorAttemptReader & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    read({ namespace }) {
      asked.push(namespace);
      return typeof read === 'function' ? Promise.reject(new Error('gh down')) : Promise.resolve(read);
    },
  };
}
const ZERO: PriorAttemptRead = { readable: true, counted: 0 };
const ONE: PriorAttemptRead = { readable: true, counted: 1 };
const UNKNOWN: PriorAttemptRead = { readable: false };

function env(storePath: string): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_WONDERLAND_MISSION: MISSION,
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
    JULIUS_WONDERLAND_START: '1',
    JULIUS_WONDERLAND_GITHUB_REPO: REPO,
    JULIUS_WONDERLAND_START_LANE: 'lab',
  };
}

function service(storePath: string) {
  return createWonderlandAdmissionService({
    env: env(storePath),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => {
      if (token === 'native-token') return { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-1' };
      if (token === 'other-token') return { playerId: 'other-player', projectId: PROJECT, sessionId: 'sess-2' };
      return null;
    },
    readWorkflowText: () => null,
  });
}

function base(run: string, over: Partial<WonderlandAdmissionRouteRequest>): WonderlandAdmissionRouteRequest {
  const path = `/wonderland/julius/missions/${run}/start`;
  return {
    method: 'POST',
    path,
    url: `${path}?projectId=${PROJECT}`,
    authorization: 'Relay-Session native-token',
    origin: undefined,
    rawBody: undefined,
    idempotencyKey: START_KEY,
    remoteAddress: '127.0.0.1',
    host: 'localhost',
    forwarded: false,
    nowIso: WHEN,
    nowMs: Date.parse(WHEN),
    ...over,
  };
}

const startRequest = (run: string, extra: Record<string, unknown> = {}, over: Partial<WonderlandAdmissionRouteRequest> = {}) => base(run, {
  rawBody: JSON.stringify({ wljRunId: run, confirm: 'RUN LIVE MISSION', clientTriggerId: 'c'.repeat(32), clientUiActionUtc: WHEN, ...extra }),
  ...over,
});
const statusRequest = (run: string) => base(run, {
  method: 'GET',
  path: WONDERLAND_STATUS_PATH,
  url: `${WONDERLAND_STATUS_PATH}?projectId=${PROJECT}&runId=${encodeURIComponent(run)}`,
  idempotencyKey: undefined,
});

async function admitted(run: string, prior: PriorAttemptReader, gh = fakeGh()) {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-rerun-'));
  const storePath = join(dir, 'admission.json');
  const ports = service(storePath);
  const created = await handleWonderlandAdmissionRoute(base(run, {
    path: WONDERLAND_ADMISSION_PATH,
    url: `${WONDERLAND_ADMISSION_PATH}?projectId=${PROJECT}`,
    idempotencyKey: ADMIT_KEY,
    rawBody: JSON.stringify({ runId: run, clientTriggerId: 'trigger_01', clientLogSha256: 'ab'.repeat(32), clientUiActionUtc: WHEN }),
  }), ports);
  expect(created?.status).toBe(202);
  const tool: OperatorClaimTool = createOperatorClaimTool(openAdmissionFile(storePath), gh.spawn, { nowIso: () => WHEN }, prior);
  const deps = { claimTool: () => tool };
  const journal = () => readAdmissionDocument(storePath).claims;
  const journalBytes = () => {
    const name = readdirSync(dir).find((entry) => entry.endsWith('.operator.json'));
    return name === undefined ? null : readFileSync(join(dir, name), 'utf8');
  };
  const start = (extra: Record<string, unknown> = {}, over: Partial<WonderlandAdmissionRouteRequest> = {}) =>
    handleWonderlandMissionStartRoute(startRequest(run, extra, over), ports, deps);
  return {
    dir, storePath, ports, gh, tool, journal, journalBytes, start,
    cleanup() { ports.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

const workflowRuns = (calls: readonly string[][]) => calls.filter((args) => args[0] === 'workflow');
const ackFlags = (argv: readonly string[]) => argv.flatMap((arg, index) => (arg.startsWith('acknowledge_rerun') ? [[argv[index - 1], arg]] : []));
const kindOf = (body: unknown) => (body as { error?: { kind?: string } }).error?.kind;

describe('the rerun gate on a Wonderland Start', () => {
  it('counted 0: dispatches with no acknowledge_rerun, and a phrase sent anyway is ignored', async () => {
    for (const extra of [{}, { acknowledgeRerun: PHRASE }]) {
      const prior = reader(ZERO);
      const fx = await admitted(RUN_A, prior);
      try {
        const result = await fx.start(extra);
        expect(result?.status).toBe(202);
        const runs = workflowRuns(fx.gh.calls);
        expect(runs).toHaveLength(1);
        expect(ackFlags(runs[0] ?? [])).toEqual([]);
        expect(runs[0]?.join(' ')).not.toContain(PHRASE);
        expect(prior.asked).toEqual([LANES.contractMarkerNamespace]);
        for (const event of fx.journal()) {
          expect(event).not.toHaveProperty('acknowledgedRerun');
          expect(event).not.toHaveProperty('priorAttempted');
        }
      } finally {
        fx.cleanup();
      }
    }
  });

  it('counted 1 without the phrase: 409 julius_rerun_consent_required, nothing written, no workflow run, still claimable', async () => {
    const prior = reader(ONE);
    const fx = await admitted(RUN_A, prior);
    try {
      const journalBefore = fx.journalBytes();
      const storeBefore = readFileSync(fx.storePath, 'utf8');
      const refused = await fx.start();
      expect(refused?.status).toBe(409);
      expect(kindOf(refused?.body)).toBe('julius_rerun_consent_required');
      expect(refused?.body).toMatchObject({ retry: false, priorAttempted: 1, state: 'admitted', wljRunId: RUN_A });
      expect(fx.journal()).toEqual([]);
      expect(fx.journalBytes()).toBe(journalBefore);
      expect(readFileSync(fx.storePath, 'utf8')).toBe(storeBefore);
      expect(workflowRuns(fx.gh.calls)).toEqual([]);
      // Not even the spent tag was read: the gate stands before it.
      expect(fx.gh.calls.some((args) => args.some((arg) => arg.includes('git/ref/tags')))).toBe(false);
      const status = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports, () => Promise.resolve(1));
      expect(status?.body).toMatchObject({ state: 'awaiting_operator', priorAttempted: 1, rerunConsentRequired: true });

      // The same admission, now with the founder's phrase: it dispatches once, carrying the flag exactly once.
      const accepted = await fx.start({ acknowledgeRerun: PHRASE });
      expect(accepted?.status).toBe(202);
      const runs = workflowRuns(fx.gh.calls);
      expect(runs).toHaveLength(1);
      expect(ackFlags(runs[0] ?? [])).toEqual([['-f', 'acknowledge_rerun=RERUN PAID MISSION']]);
      const events = fx.journal();
      expect(events.map((event) => event.state)).toEqual(['dispatching', 'dispatched']);
      for (const event of events) expect(event).toMatchObject({ acknowledgedRerun: true, priorAttempted: 1 });
    } finally {
      fx.cleanup();
    }
  });

  it('UNKNOWN, with or without the phrase, a reader that throws, or a contract with no namespace: 409 julius_prior_attempts_unknown, nothing written or dispatched', async () => {
    const cases: { prior: ReturnType<typeof reader>; gh?: ReturnType<typeof fakeGh>; asks: number }[] = [
      { prior: reader(UNKNOWN), asks: 1 },
      { prior: reader(() => { throw new Error('x'); }), asks: 1 },
      { prior: reader(ONE), gh: fakeGh({ contract: '{}' }), asks: 0 },
    ];
    for (const { prior, gh, asks } of cases) {
      for (const extra of [{}, { acknowledgeRerun: PHRASE }]) {
        const fx = await admitted(RUN_A, prior, gh ?? fakeGh());
        try {
          const before = prior.asked.length;
          const refused = await fx.start(extra);
          expect(refused?.status).toBe(409);
          expect(kindOf(refused?.body)).toBe('julius_prior_attempts_unknown');
          expect(refused?.body).toMatchObject({ retry: false, priorAttempted: 'UNKNOWN' });
          expect(fx.journal()).toEqual([]);
          expect(workflowRuns(fx.gh.calls)).toEqual([]);
          expect(fx.gh.calls.flat().join(' ')).not.toContain('acknowledge_rerun');
          expect(prior.asked.length - before).toBe(asks);
        } finally {
          fx.cleanup();
        }
      }
    }
  });

  it('a wrong phrase is a 400 before any claim or read', async () => {
    for (const wrong of ['rerun paid mission', ' RERUN PAID MISSION', 'RERUN PAID MISSION ', 'RERUN  PAID MISSION', 'RUN LIVE MISSION', '', true, null, 1]) {
      const prior = reader(ONE);
      const fx = await admitted(RUN_A, prior);
      try {
        const refused = await fx.start({ acknowledgeRerun: wrong });
        expect(refused?.status, String(wrong)).toBe(400);
        expect(kindOf(refused?.body)).toBe('julius_rerun_ack_invalid');
        expect(prior.asked).toEqual([]);
        expect(fx.gh.calls).toEqual([]);
        expect(fx.journal()).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }
  });

  it('the phrase on any other session is refused by the paired-founder guard before it is read', async () => {
    const prior = reader(ONE);
    const fx = await admitted(RUN_A, prior);
    try {
      for (const over of [
        { authorization: 'Bearer operator-token' },
        { authorization: 'Relay-Session other-token' },
        { authorization: undefined },
        { origin: 'https://sunday-relay.vercel.app' },
        { remoteAddress: '10.0.0.8', host: 'relay.example' },
      ] as Partial<WonderlandAdmissionRouteRequest>[]) {
        const refused = await fx.start({ acknowledgeRerun: PHRASE }, over);
        expect(refused?.status, JSON.stringify(over)).toBeGreaterThanOrEqual(400);
        expect(refused?.status).not.toBe(409);
      }
      expect(prior.asked).toEqual([]);
      expect(fx.gh.calls).toEqual([]);
      expect(fx.journal()).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  it('consent given on admission A never applies to admission B', async () => {
    const prior = reader(ONE);
    const a = await admitted(RUN_A, prior);
    const b = await admitted(RUN_B, prior);
    try {
      expect((await a.start({ acknowledgeRerun: PHRASE }))?.status).toBe(202);
      const refused = await b.start();
      expect(refused?.status).toBe(409);
      expect(kindOf(refused?.body)).toBe('julius_rerun_consent_required');
      expect(b.journal()).toEqual([]);
      expect(workflowRuns(b.gh.calls)).toEqual([]);
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });

  it('a replay after dispatch never reads, never spawns, never re-sends the phrase', async () => {
    const prior = reader(ONE);
    const fx = await admitted(RUN_A, prior);
    try {
      expect((await fx.start({ acknowledgeRerun: PHRASE }))?.status).toBe(202);
      const calls = fx.gh.calls.length;
      const asked = prior.asked.length;
      for (const extra of [{}, { acknowledgeRerun: PHRASE }]) {
        const again = await fx.start(extra, { idempotencyKey: '12345678-1234-4234-8234-123456789abc' });
        expect(again?.status).toBe(200);
        expect(again?.body).toMatchObject({ state: 'dispatched', replayed: true });
      }
      expect(fx.gh.calls.length).toBe(calls);
      expect(prior.asked.length).toBe(asked);
      expect(workflowRuns(fx.gh.calls)).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  it('a workflow on main that does not declare acknowledge_rerun refuses the rerun before anything is written', async () => {
    const fx = await admitted(RUN_A, reader(ONE), fakeGh({ rerunInput: false }));
    try {
      const refused = await fx.start({ acknowledgeRerun: PHRASE });
      expect(refused?.status).toBe(409);
      expect(kindOf(refused?.body)).toBe('workflow_dispatch_input_missing');
      expect(fx.journal()).toEqual([]);
      expect(workflowRuns(fx.gh.calls)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe('the rerun decision and the journal', () => {
  it('decideRerun: UNKNOWN never unlocks, 0 ignores the phrase, n>0 needs the exact phrase', () => {
    expect(decideRerun(UNKNOWN, PHRASE)).toEqual({ ok: false, kind: 'julius_prior_attempts_unknown', priorAttempted: 'UNKNOWN' });
    expect(decideRerun({ readable: true, counted: -1 }, PHRASE).ok).toBe(false);
    expect(decideRerun({ readable: true, counted: 1.5 }, PHRASE).ok).toBe(false);
    expect(decideRerun(ZERO, PHRASE)).toEqual({ ok: true, acknowledgedRerun: false, priorAttempted: 0 });
    expect(decideRerun(ONE, null)).toEqual({ ok: false, kind: 'julius_rerun_consent_required', priorAttempted: 1 });
    expect(decideRerun(ONE, undefined).ok).toBe(false);
    expect(decideRerun(ONE, 'rerun paid mission').ok).toBe(false);
    expect(decideRerun({ readable: true, counted: 2 }, PHRASE)).toEqual({ ok: true, acknowledgedRerun: true, priorAttempted: 2 });
    expect(RERUN_PAID_MISSION_CONFIRMATION).toBe(PHRASE);
  });

  it('the argv carries acknowledge_rerun only with confirm_live and the acknowledged flag', () => {
    const args = (over: { confirmLive?: boolean; acknowledgeRerun?: boolean }) => workflowDispatchArgs({
      repo: REPO, mission: MISSION, lane: 'lab', dispatchKey: 'a'.repeat(64), serverRunId: RUN_A, ...over,
    });
    expect(ackFlags(args({ confirmLive: true }))).toEqual([]);
    expect(ackFlags(args({ confirmLive: false, acknowledgeRerun: true }))).toEqual([]);
    expect(ackFlags(args({ confirmLive: true, acknowledgeRerun: true }))).toEqual([['-f', 'acknowledge_rerun=RERUN PAID MISSION']]);
  });

  const reservation: ClaimEvent = {
    wonderlandRunId: RUN_A, serverRunId: RUN_A, state: 'dispatching', spentTag: 'julius-run-spent-x', spentTagState: 'absent',
    at: WHEN, dispatchAttempted: false, dispatchError: null, halt: null, workflowRunId: null, githubDate: '2026-10-23T17:18:05Z',
  };
  const outcome: ClaimEvent = { ...reservation, state: 'dispatched', dispatchAttempted: true, workflowRunId: WORKFLOW_RUN };

  it('legalTransition keeps the reservation\'s consent: an outcome cannot add, drop or change it', () => {
    const acked = { ...reservation, acknowledgedRerun: true as const, priorAttempted: 1 };
    expect(legalTransition(null, acked)).toBe(true);
    expect(legalTransition(acked, { ...outcome, acknowledgedRerun: true, priorAttempted: 1 })).toBe(true);
    expect(legalTransition(reservation, outcome)).toBe(true);
    expect(legalTransition(acked, outcome), 'dropped').toBe(false);
    expect(legalTransition(reservation, { ...outcome, acknowledgedRerun: true, priorAttempted: 1 }), 'added').toBe(false);
    expect(legalTransition(acked, { ...outcome, acknowledgedRerun: true, priorAttempted: 2 }), 'count changed').toBe(false);
    expect(legalTransition(null, { ...reservation, acknowledgedRerun: true }), 'no count').toBe(false);
    expect(legalTransition(null, { ...reservation, priorAttempted: 1 }), 'count without consent').toBe(false);
    expect(legalTransition(null, { ...reservation, acknowledgedRerun: true, priorAttempted: 0 }), 'zero is not a rerun').toBe(false);
  });

  it('a tampered journal is refused: an outcome appended over a flipped reservation throws, a half record is corrupt, a legacy record parses', async () => {
    const prior = reader(ONE);
    const fx = await admitted(RUN_A, prior);
    try {
      expect((await fx.start({ acknowledgeRerun: PHRASE }))?.status).toBe(202);
      const name = readdirSync(fx.dir).find((entry) => entry.endsWith('.operator.json')) ?? '';
      const path = join(fx.dir, name);
      const journal = JSON.parse(readFileSync(path, 'utf8')) as { claims: Record<string, unknown>[] };
      const original = JSON.stringify(journal);
      // Legacy: no rerun keys at all reads as no consent.
      const legacy = JSON.parse(original) as typeof journal;
      for (const claim of legacy.claims) { delete claim.acknowledgedRerun; delete claim.priorAttempted; }
      writeFileSync(path, `${JSON.stringify(legacy)}\n`);
      for (const event of readAdmissionDocument(fx.storePath).claims) expect(event.acknowledgedRerun).toBeUndefined();
      // Half a record is corrupt.
      const half = JSON.parse(original) as typeof journal;
      delete half.claims[1]?.priorAttempted;
      writeFileSync(path, `${JSON.stringify(half)}\n`);
      expect(() => readAdmissionDocument(fx.storePath)).toThrow();
      const flipped = JSON.parse(original) as typeof journal;
      if (flipped.claims[1] !== undefined) flipped.claims[1].acknowledgedRerun = 'yes';
      writeFileSync(path, `${JSON.stringify(flipped)}\n`);
      expect(() => readAdmissionDocument(fx.storePath)).toThrow();
      // The reservation's consent flipped off after the fact: legalTransition refuses the stored outcome over it.
      const parsed = JSON.parse(original) as typeof journal;
      const [stored, out] = parsed.claims as unknown as ClaimEvent[];
      expect(stored !== undefined && out !== undefined).toBe(true);
      const { acknowledgedRerun: _a, priorAttempted: _p, ...stripped } = stored as ClaimEvent;
      expect(legalTransition(stripped as ClaimEvent, out as ClaimEvent)).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});

describe('/status before Start', () => {
  const EXACT_KEYS = ['dispatchedAt', 'legacyRunId', 'priorAttempted', 'rerunConsentRequired', 'serverRunId', 'state', 'updatedAt', 'wljRunId', 'workflowRunId'];

  it('shows priorAttempted and rerunConsentRequired at top level, true only above zero, and never the phrase', async () => {
    const fx = await admitted(RUN_A, reader(ZERO));
    try {
      const shown: Record<string, unknown>[] = [];
      for (const [counted, required] of [[0, false], [1, true], [3, true], ['UNKNOWN', false]] as const) {
        const asked: string[] = [];
        const status = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports, (mission) => {
          asked.push(mission);
          return Promise.resolve(counted);
        });
        expect(status?.status).toBe(200);
        const body = status?.body as Record<string, unknown>;
        shown.push(body);
        expect(Object.keys(body).sort()).toEqual(EXACT_KEYS);
        expect(body).toEqual({
          wljRunId: RUN_A, serverRunId: RUN_A, legacyRunId: null, dispatchedAt: null, workflowRunId: null,
          state: 'awaiting_operator', updatedAt: WHEN, priorAttempted: counted, rerunConsentRequired: required,
        });
        expect(asked).toEqual([MISSION]);
      }
      // No reader wired, a reader that throws, or a nonsense count: UNKNOWN and not required.
      for (const port of [undefined, () => Promise.reject(new Error('x')), () => Promise.resolve(-1), () => Promise.resolve(Number.NaN)]) {
        const status = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports, port as never);
        expect(status?.body).toMatchObject({ priorAttempted: 'UNKNOWN', rerunConsentRequired: false });
      }
      expect(JSON.stringify(shown)).not.toMatch(/RERUN PAID MISSION|acknowledge/iu);
    } finally {
      fx.cleanup();
    }
  });

  it('the existing fields keep their types: strings and nulls only', async () => {
    const fx = await admitted(RUN_A, reader(ZERO));
    try {
      const plain = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports);
      const withCount = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports, () => Promise.resolve(2));
      for (const body of [plain?.body, withCount?.body] as Record<string, unknown>[]) {
        for (const key of ['wljRunId', 'serverRunId', 'state', 'updatedAt']) expect(typeof body[key], key).toBe('string');
        for (const key of ['legacyRunId', 'dispatchedAt', 'workflowRunId']) expect(body[key], key).toBeNull();
        expect(typeof body.rerunConsentRequired).toBe('boolean');
        expect(typeof body.priorAttempted === 'number' || body.priorAttempted === 'UNKNOWN').toBe(true);
      }
    } finally {
      fx.cleanup();
    }
  });

  it('once started, /status reads nothing and says UNKNOWN, not required', async () => {
    const fx = await admitted(RUN_A, reader(ZERO));
    try {
      expect((await fx.start())?.status).toBe(202);
      const asked: string[] = [];
      const status = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports, (mission) => {
        asked.push(mission);
        return Promise.resolve(1);
      });
      expect(status?.body).toMatchObject({ state: 'dispatched', priorAttempted: 'UNKNOWN', rerunConsentRequired: false });
      expect(asked).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  it('withRerunConsent is true exactly above zero', () => {
    expect(withRerunConsent({}, 0)).toEqual({ priorAttempted: 0, rerunConsentRequired: false });
    expect(withRerunConsent({}, 1)).toEqual({ priorAttempted: 1, rerunConsentRequired: true });
    expect(withRerunConsent({}, 'UNKNOWN')).toEqual({ priorAttempted: 'UNKNOWN', rerunConsentRequired: false });
  });
});

describe('source scan: the phrase has one source, the founder\'s Start body', () => {
  const read = (path: string) => readFileSync(join(__dirname, path), 'utf8');
  const sources = {
    core: read('../src/relay/integration/wonderland-admission/operator-claim.ts'),
    cli: read('../src/relay/integration/wonderland-admission/operator-claim-cli.ts'),
    file: read('../src/relay/integration/wonderland-admission/admission-file.ts'),
    start: read('wonderland-mission-start-route.ts'),
    status: read('wonderland-admission-route.ts'),
    prior: read('wonderland-prior-attempts.ts'),
    server: read('server.ts'),
  };

  it('no environment, config, flag or default reads or names it', () => {
    for (const [name, source] of Object.entries(sources)) {
      // An env key naming a rerun or an acknowledgement would be a second source.
      expect(source, name).not.toMatch(/env(?:\.|\[\s*['"`])[A-Za-z0-9_]*(?:RERUN|Rerun|rerun|ACKNOWLEDGE|Acknowledge|acknowledge)/u);
      expect(source, name).not.toMatch(/process\.env\b[^;\n]*(?:RERUN|rerun|Rerun|acknowledge|Acknowledge|ACKNOWLEDGE)/u);
    }
    // The literal is written once, as the core's constant, and nowhere else that runs.
    for (const [name, source] of Object.entries(sources)) {
      const count = source.split("'RERUN PAID MISSION'").length - 1;
      expect(count, name).toBe(name === 'core' ? 1 : 0);
    }
    // The CLI cannot carry consent at all.
    expect(sources.cli).not.toMatch(/rerunConfirmation|acknowledgeRerun|RERUN_PAID_MISSION|acknowledge_rerun/u);
    // The Start route sets rerunConfirmation only from body.acknowledgeRerun, after comparing it with the constant.
    expect(sources.start).toMatch(/Object\.hasOwn\(body, 'acknowledgeRerun'\)/u);
    expect(sources.start.match(/rerunConfirmation = /gu) ?? []).toHaveLength(1);
    expect(sources.start).toContain('rerunConfirmation = RERUN_PAID_MISSION_CONFIRMATION;');
    // The default reader is UNKNOWN, never zero.
    expect(sources.core).toMatch(/UNWIRED_PRIOR_ATTEMPTS: PriorAttemptReader = \{\n\s*read: \(\) => Promise\.resolve\(\{ readable: false \}\)/u);
  });

  it('the prior-attempt fetch only runs gh api -X GET', () => {
    expect(sources.prior).toMatch(/return \['api', '-X', 'GET', path\];/u);
    expect(sources.prior).not.toMatch(/'workflow'|'run',|-X', 'POST|--method/u);
    expect([...sources.prior.matchAll(/execFile\(\s*'([^']+)'/gu)].map((match) => match[1])).toEqual(['gh']);
  });

  it('the production server cannot reach the rehearsal harness', () => {
    const production = readdirSync(__dirname).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    for (const name of production) {
      expect(read(name), name).not.toMatch(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*rehearsal/u);
    }
  });
});

describe('the /status prior-attempt reader', () => {
  const contractRunner = (contract: string | null): GhBytesRunner & { calls: string[][] } => {
    const calls: string[][] = [];
    const run = (async (args: readonly string[]) => {
      calls.push([...args]);
      if (contract === null) return { code: 1, stdout: new Uint8Array() };
      return { code: 0, stdout: new TextEncoder().encode(contract) };
    }) as GhBytesRunner & { calls: string[][] };
    run.calls = calls;
    return run;
  };

  it('reads the contract namespace at main with a GET, then the same reader; caches a count, never UNKNOWN', async () => {
    let now = 0;
    const prior = reader(ONE);
    const run = contractRunner(JSON.stringify({ markerNamespace: MISSION }));
    const status = createStatusPriorAttempts({ repo: REPO, run, reader: prior, nowMs: () => now, ttlMs: 1000 });
    expect(await status(MISSION)).toBe(1);
    expect(run.calls[0]?.slice(0, 3)).toEqual(['api', '-X', 'GET']);
    expect(run.calls[0]?.at(-1)).toBe(`repos/${REPO}/contents/${missionContractPath(MISSION)}?ref=main`);
    expect(await status(MISSION)).toBe(1);
    expect(prior.asked).toEqual([MISSION]);
    now = 1000;
    expect(await status(MISSION)).toBe(1);
    expect(prior.asked).toHaveLength(2);
    const unknown = reader(UNKNOWN);
    const never = createStatusPriorAttempts({ repo: REPO, run, reader: unknown, nowMs: () => 0 });
    expect(await never(MISSION)).toBe('UNKNOWN');
    expect(await never(MISSION)).toBe('UNKNOWN');
    expect(unknown.asked).toHaveLength(2);
    for (const contract of [null, '{}', 'not json', JSON.stringify({ markerNamespace: 'X' })]) {
      const asked = reader(ONE);
      expect(await createStatusPriorAttempts({ repo: REPO, run: contractRunner(contract), reader: asked })(MISSION), String(contract)).toBe('UNKNOWN');
      expect(asked.asked).toEqual([]);
    }
  });

  it('is wired only when Start is on and a repository is set', () => {
    expect(wonderlandStatusPriorAttemptsFrom({})).toBeUndefined();
    expect(wonderlandStatusPriorAttemptsFrom({ JULIUS_WONDERLAND_START: '1' })).toBeUndefined();
    expect(wonderlandStatusPriorAttemptsFrom({ JULIUS_WONDERLAND_GITHUB_REPO: REPO })).toBeUndefined();
    expect(typeof wonderlandStatusPriorAttemptsFrom({ JULIUS_WONDERLAND_START: '1', JULIUS_WONDERLAND_GITHUB_REPO: REPO })).toBe('function');
  });
});

describe('the rehearsal harness (test-only, simulated)', () => {
  const harness = readFileSync(join(__dirname, 'rehearsal/rerun-consent-harness.ts'), 'utf8');

  it('binds 127.0.0.1:8793 only, reads no environment, and starts no process', () => {
    expect(REHEARSAL_HOST).toBe('127.0.0.1');
    expect(REHEARSAL_PORT).toBe(8793);
    expect([...harness.matchAll(/\.listen\(([^)]*)\)/gu)].map((match) => match[1]?.split(',').slice(0, 2).join(',').trim()))
      .toEqual(['REHEARSAL_PORT, REHEARSAL_HOST']);
    expect(harness).not.toMatch(/process\.env/u);
    expect(harness).not.toMatch(/child_process|spawnSync|execFile|ghClaimSpawner|createGhPriorAttemptReader|ghBytesRunner/u);
    expect(harness).toContain('[SIMULATED rerun-consent rehearsal]');
  });

  it('argv selects 0, 1 or UNKNOWN and nothing else', async () => {
    expect(parseRehearsalArgv(['--prior', '0'])?.prior).toBe(0);
    expect(parseRehearsalArgv(['--prior', '1'])?.prior).toBe(1);
    expect(parseRehearsalArgv(['--prior', 'UNKNOWN'])?.prior).toBe('UNKNOWN');
    for (const bad of [[], ['--prior', '2'], ['--prior', 'unknown'], ['--prior', '1', '--session-token', 'x']]) {
      expect(parseRehearsalArgv(bad), bad.join(' ')).toBeNull();
    }
    expect(await rehearsalPriorReader('UNKNOWN').read({ repo: REPO, namespace: MISSION })).toEqual({ readable: false });
    expect(await rehearsalPriorReader(1).read({ repo: REPO, namespace: MISSION })).toEqual({ readable: true, counted: 1 });
  });

  it('its fake gh records a workflow run and logs it as simulated, never executed', () => {
    const lines: string[] = [];
    const gh = rehearsalGh((line) => lines.push(line));
    const result = gh.run(['workflow', 'run', 'x.yml', '-f', 'acknowledge_rerun=RERUN PAID MISSION']);
    expect(result.code).toBe(0);
    expect(gh.calls).toEqual([['workflow', 'run', 'x.yml', '-f', 'acknowledge_rerun=RERUN PAID MISSION']]);
    expect(lines.join('\n')).toMatch(/SIMULATED.*NOT EXECUTED/u);
  });
});
