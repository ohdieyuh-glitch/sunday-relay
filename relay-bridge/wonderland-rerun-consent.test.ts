/**
 * THE FOUNDER'S SECOND PHRASE, `RERUN PAID MISSION`, end to end over the real
 * admission file, the real claim core and the real Start and /status routes,
 * with a fake `gh` and an injected prior-attempt reader. Offline; nothing here
 * can reach GitHub or spend.
 */

import { createHash } from 'node:crypto';
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
  inFlightPeers,
  legalTransition,
  missionContractPath,
  parseRecordedPaidAttempts,
  priorCompletedCount,
  priorCount,
  recordedPaidAttempts,
  rerunConsentBinds,
  runsForDispatchKey,
  unsettledPeer,
  workflowDispatchArgs,
  type GhResult,
  type GhSpawner,
  type OperatorClaimTool,
  type PriorAttemptRead,
  type PriorAttemptReader,
  type RerunConsent,
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
/** The step-9 recorded-attempts table exactly as main's workflow writes it today. */
const RECORDED_CASE = `          case "$MARKER_NAMESPACE" in
            julius-first-live) RECORDED_PAID_ATTEMPTS=1 ;;  # run 33697109210
            *)                 RECORDED_PAID_ATTEMPTS=0 ;;
          esac
`;
const workflowYaml = (rerunInput: boolean, recordedCase: string = RECORDED_CASE) => `
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
jobs:
  paid:
    steps:
      - run: |
${recordedCase}`;
const ABSENT: GhResult = { code: 1, stdout: 'HTTP/2.0 404 Not Found\nDate: Fri, 23 Oct 2026 17:18:05 GMT\n\n{"message":"Not Found"}\n', stderr: '' };
const CONTENTS = `repos/${REPO}/contents/`;

function fakeGh(options: { rerunInput?: boolean; contract?: string; recordedCase?: string; runList?: () => GhResult } = {}): { spawn: GhSpawner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    spawn: {
      run(args) {
        calls.push([...args]);
        const target = args.find((arg) => arg.startsWith(CONTENTS));
        if (args[0] === 'api' && target !== undefined) {
          const path = target.slice(CONTENTS.length).replace(/\?ref=main$/u, '');
          const text = path === `.github/workflows/${PAID_WORKFLOW_FILE}` ? workflowYaml(options.rerunInput ?? true, options.recordedCase)
            : path === missionContractPath(MISSION) ? (options.contract ?? JSON.stringify({ markerNamespace: LANES.contractMarkerNamespace }))
              : path === LANE_GRANT_SOURCE ? LANES.laneGrantExcerpt : null;
          return text === null ? { code: 1, stdout: '', stderr: 'HTTP 404' } : { code: 0, stdout: text, stderr: '' };
        }
        if (args[0] === 'api') return ABSENT;
        if (args[0] === 'run') return options.runList?.() ?? { code: 1, stdout: '', stderr: 'HTTP 502' };
        if (args[0] === 'workflow') return { code: 0, stdout: `https://github.com/${REPO}/actions/runs/${WORKFLOW_RUN}\n`, stderr: '' };
        return { code: 99, stdout: '', stderr: '' };
      },
    },
  };
}

/**
 * A reader that answers `read` (attempted markers) and `readCompleted`
 * (completed markers), and records each namespace it was asked for.
 */
function reader(
  read: PriorAttemptRead | (() => never),
  completed: PriorAttemptRead | (() => never) = { readable: true, counted: 0 },
): PriorAttemptReader & { asked: string[]; askedCompleted: string[] } {
  const asked: string[] = [];
  const askedCompleted: string[] = [];
  const answer = (value: PriorAttemptRead | (() => never)) =>
    (typeof value === 'function' ? Promise.reject(new Error('gh down')) : Promise.resolve(value));
  return {
    asked,
    askedCompleted,
    read({ namespace }) {
      asked.push(namespace);
      return answer(read);
    },
    readCompleted({ namespace }) {
      askedCompleted.push(namespace);
      return answer(completed);
    },
  };
}
const ZERO: PriorAttemptRead = { readable: true, counted: 0 };
const ONE: PriorAttemptRead = { readable: true, counted: 1 };
const UNKNOWN: PriorAttemptRead = { readable: false };

function env(storePath: string, over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_WONDERLAND_MISSION: MISSION,
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
    JULIUS_WONDERLAND_START: '1',
    JULIUS_WONDERLAND_GITHUB_REPO: REPO,
    JULIUS_WONDERLAND_START_LANE: 'lab',
    ...over,
  };
}

function service(storePath: string, over: Record<string, string | undefined> = {}) {
  return createWonderlandAdmissionService({
    env: env(storePath, over),
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

async function admitted(run: string, prior: PriorAttemptReader, gh = fakeGh(), over: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-rerun-'));
  const storePath = join(dir, 'admission.json');
  const ports = service(storePath, over);
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
          expect(event).not.toHaveProperty('priorCompleted');
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
      const status = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports, () => Promise.resolve({ attempted: 1, completed: 0 }));
      expect(status?.body).toMatchObject({ state: 'awaiting_operator', priorAttempted: 1, priorCompleted: 0, rerunConsentRequired: true });

      // The same admission, now with the founder's phrase: it dispatches once, carrying the flag exactly once.
      const accepted = await fx.start({ acknowledgeRerun: PHRASE });
      expect(accepted?.status).toBe(202);
      const runs = workflowRuns(fx.gh.calls);
      expect(runs).toHaveLength(1);
      expect(ackFlags(runs[0] ?? [])).toEqual([['-f', 'acknowledge_rerun=RERUN PAID MISSION']]);
      const events = fx.journal();
      expect(events.map((event) => event.state)).toEqual(['dispatching', 'dispatched']);
      for (const event of events) expect(event).toMatchObject({ acknowledgedRerun: true, priorAttempted: 1, priorCompleted: 0 });
    } finally {
      fx.cleanup();
    }
  });

  it('THE STEP-9 MIRROR: completed markers > 0 with attempted 0 need the phrase; with it, the flag is sent and the counts recorded', async () => {
    const prior = reader(ZERO, ONE);
    const fx = await admitted(RUN_A, prior);
    try {
      const refused = await fx.start();
      expect(refused?.status).toBe(409);
      expect(kindOf(refused?.body)).toBe('julius_rerun_consent_required');
      expect(refused?.body).toMatchObject({ retry: false, priorAttempted: 0, priorCompleted: 1 });
      expect(fx.journal()).toEqual([]);
      expect(workflowRuns(fx.gh.calls)).toEqual([]);
      expect(prior.askedCompleted).toEqual([LANES.contractMarkerNamespace]);
      const accepted = await fx.start({ acknowledgeRerun: PHRASE });
      expect(accepted?.status).toBe(202);
      expect(ackFlags(workflowRuns(fx.gh.calls)[0] ?? [])).toEqual([['-f', 'acknowledge_rerun=RERUN PAID MISSION']]);
      for (const event of fx.journal()) expect(event).toMatchObject({ acknowledgedRerun: true, priorAttempted: 0, priorCompleted: 1 });
    } finally {
      fx.cleanup();
    }
  });

  it('THE STEP-9 MIRROR: an unreadable completed listing, or an unreadable recorded table on main, is UNKNOWN: 409, nothing written, phrase or not', async () => {
    const cases: { prior: ReturnType<typeof reader>; gh?: () => ReturnType<typeof fakeGh> }[] = [
      { prior: reader(ZERO, UNKNOWN) },
      { prior: reader(ZERO, () => { throw new Error('x'); }) },
      { prior: reader(ZERO, ZERO), gh: () => fakeGh({ recordedCase: '' }) },
      { prior: reader(ZERO, ZERO), gh: () => fakeGh({ recordedCase: RECORDED_CASE.replace('RECORDED_PAID_ATTEMPTS=0', 'RECORDED_PAID_ATTEMPTS=zero') }) },
    ];
    for (const { prior, gh } of cases) {
      for (const extra of [{}, { acknowledgeRerun: PHRASE }]) {
        const fx = await admitted(RUN_A, prior, gh === undefined ? fakeGh() : gh());
        try {
          const refused = await fx.start(extra);
          expect(refused?.status).toBe(409);
          expect(kindOf(refused?.body)).toBe('julius_prior_attempts_unknown');
          expect(refused?.body).toMatchObject({ retry: false, priorAttempted: 0, priorCompleted: 'UNKNOWN' });
          expect(fx.journal()).toEqual([]);
          expect(workflowRuns(fx.gh.calls)).toEqual([]);
        } finally {
          fx.cleanup();
        }
      }
    }
  });

  it('THE STEP-9 MIRROR: julius-first-live carries a recorded paid attempt of 1 on main, so its Start needs the phrase with no marker at all', async () => {
    const gh = fakeGh({ contract: JSON.stringify({ markerNamespace: 'julius-first-live' }) });
    const fx = await admitted(RUN_A, reader(ZERO, ZERO), gh, { JULIUS_WONDERLAND_START_LANE: 'regression' });
    try {
      const refused = await fx.start();
      expect(refused?.status).toBe(409);
      expect(kindOf(refused?.body)).toBe('julius_rerun_consent_required');
      expect(refused?.body).toMatchObject({ priorAttempted: 0, priorCompleted: 1 });
      expect(fx.journal()).toEqual([]);
      expect((await fx.start({ acknowledgeRerun: PHRASE }))?.status).toBe(202);
      expect(ackFlags(workflowRuns(fx.gh.calls)[0] ?? [])).toEqual([['-f', 'acknowledge_rerun=RERUN PAID MISSION']]);
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
  it('decideRerun: either count UNKNOWN never unlocks, both 0 ignore the phrase, either above 0 needs the exact phrase', () => {
    const d = (attempted: number | 'UNKNOWN', completed: number | 'UNKNOWN', phrase: string | null | undefined) => decideRerun({ attempted, completed }, phrase);
    expect(d('UNKNOWN', 0, PHRASE)).toEqual({ ok: false, kind: 'julius_prior_attempts_unknown', priorAttempted: 'UNKNOWN', priorCompleted: 0 });
    expect(d(0, 'UNKNOWN', PHRASE)).toEqual({ ok: false, kind: 'julius_prior_attempts_unknown', priorAttempted: 0, priorCompleted: 'UNKNOWN' });
    expect(d(-1, 0, PHRASE).ok).toBe(false);
    expect(d(0, 1.5, PHRASE).ok).toBe(false);
    expect(d(0, 0, PHRASE)).toEqual({ ok: true, acknowledgedRerun: false, priorAttempted: 0, priorCompleted: 0 });
    expect(d(1, 0, null)).toEqual({ ok: false, kind: 'julius_rerun_consent_required', priorAttempted: 1, priorCompleted: 0 });
    expect(d(0, 1, null)).toEqual({ ok: false, kind: 'julius_rerun_consent_required', priorAttempted: 0, priorCompleted: 1 });
    expect(d(1, 0, undefined).ok).toBe(false);
    expect(d(1, 0, 'rerun paid mission').ok).toBe(false);
    expect(d(2, 0, PHRASE)).toEqual({ ok: true, acknowledgedRerun: true, priorAttempted: 2, priorCompleted: 0 });
    expect(d(0, 3, PHRASE)).toEqual({ ok: true, acknowledgedRerun: true, priorAttempted: 0, priorCompleted: 3 });
    expect(RERUN_PAID_MISSION_CONFIRMATION).toBe(PHRASE);
    expect(priorCompletedCount(ONE, 1)).toBe(2);
    expect(priorCompletedCount(ZERO, null)).toBe('UNKNOWN');
    expect(priorCompletedCount(UNKNOWN, 0)).toBe('UNKNOWN');
  });

  it('the recorded table is read from main\'s workflow text, strictly: today\'s case list, a changed one, and unparseable ones', () => {
    const live = readFileSync(join(__dirname, `../.github/workflows/${PAID_WORKFLOW_FILE}`), 'utf8');
    // The case list in this checkout's workflow, exactly. A change there fails here, on purpose.
    expect(parseRecordedPaidAttempts(live)).toEqual({ byNamespace: new Map([['julius-first-live', 1]]), fallback: 0 });
    expect(recordedPaidAttempts(live, 'julius-first-live')).toBe(1);
    expect(recordedPaidAttempts(live, 'julius-inworld-data-1')).toBe(0);
    // Drift: a changed case list on main is what the parse reflects.
    const drifted = workflowYaml(true, `          case "$MARKER_NAMESPACE" in
            julius-first-live) RECORDED_PAID_ATTEMPTS=1 ;;  # run 33697109210
            julius-inworld-data-1) RECORDED_PAID_ATTEMPTS=2 ;;
            *)                 RECORDED_PAID_ATTEMPTS=0 ;;
          esac
`);
    expect(recordedPaidAttempts(drifted, 'julius-inworld-data-1')).toBe(2);
    expect(recordedPaidAttempts(drifted, 'julius-other-1')).toBe(0);
    const arm = '            *)                 RECORDED_PAID_ATTEMPTS=0 ;;\n';
    for (const broken of [
      '',
      RECORDED_CASE.replace('esac', 'done'),
      RECORDED_CASE.replace(arm, ''),
      RECORDED_CASE.replace(arm, '').replace('          esac', `${arm}            julius-x-1) RECORDED_PAID_ATTEMPTS=4 ;;\n          esac`),
      RECORDED_CASE.replace('RECORDED_PAID_ATTEMPTS=1', 'RECORDED_PAID_ATTEMPTS=${N}'),
      RECORDED_CASE.replace('julius-first-live)', 'julius-first-live|julius-x-1)'),
      `${RECORDED_CASE}${RECORDED_CASE}`,
      RECORDED_CASE.replace('julius-first-live) RECORDED_PAID_ATTEMPTS=1 ;;', 'julius-first-live) RECORDED_PAID_ATTEMPTS=1 ;;\n            julius-first-live) RECORDED_PAID_ATTEMPTS=0 ;;'),
      `${RECORDED_CASE}          RECORDED_PAID_ATTEMPTS=0\n`,
    ]) {
      expect(parseRecordedPaidAttempts(workflowYaml(true, broken)), JSON.stringify(broken)).toBeNull();
      expect(recordedPaidAttempts(workflowYaml(true, broken), 'julius-first-live')).toBeNull();
    }
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
    const acked = { ...reservation, acknowledgedRerun: true as const, priorAttempted: 1, priorCompleted: 0 };
    expect(legalTransition(null, acked)).toBe(true);
    expect(legalTransition(null, { ...acked, priorAttempted: 0, priorCompleted: 2 }), 'completed only').toBe(true);
    expect(legalTransition(acked, { ...outcome, acknowledgedRerun: true, priorAttempted: 1, priorCompleted: 0 })).toBe(true);
    expect(legalTransition(reservation, outcome)).toBe(true);
    expect(legalTransition(acked, outcome), 'dropped').toBe(false);
    expect(legalTransition(reservation, { ...outcome, acknowledgedRerun: true, priorAttempted: 1, priorCompleted: 0 }), 'added').toBe(false);
    expect(legalTransition(acked, { ...outcome, acknowledgedRerun: true, priorAttempted: 2, priorCompleted: 0 }), 'attempted changed').toBe(false);
    expect(legalTransition(acked, { ...outcome, acknowledgedRerun: true, priorAttempted: 1, priorCompleted: 1 }), 'completed changed').toBe(false);
    expect(legalTransition(null, { ...reservation, acknowledgedRerun: true }), 'no count').toBe(false);
    expect(legalTransition(null, { ...reservation, acknowledgedRerun: true, priorAttempted: 1 }), 'no completed count').toBe(false);
    expect(legalTransition(null, { ...reservation, priorAttempted: 1, priorCompleted: 0 }), 'count without consent').toBe(false);
    expect(legalTransition(null, { ...reservation, acknowledgedRerun: true, priorAttempted: 0, priorCompleted: 0 }), 'zero is not a rerun').toBe(false);
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
      for (const claim of legacy.claims) { delete claim.acknowledgedRerun; delete claim.priorAttempted; delete claim.priorCompleted; }
      writeFileSync(path, `${JSON.stringify(legacy)}\n`);
      for (const event of readAdmissionDocument(fx.storePath).claims) expect(event.acknowledgedRerun).toBeUndefined();
      // Half a record is corrupt.
      const half = JSON.parse(original) as typeof journal;
      delete half.claims[1]?.priorAttempted;
      writeFileSync(path, `${JSON.stringify(half)}\n`);
      expect(() => readAdmissionDocument(fx.storePath)).toThrow();
      const halfCompleted = JSON.parse(original) as typeof journal;
      delete halfCompleted.claims[1]?.priorCompleted;
      writeFileSync(path, `${JSON.stringify(halfCompleted)}\n`);
      expect(() => readAdmissionDocument(fx.storePath)).toThrow();
      const flipped = JSON.parse(original) as typeof journal;
      if (flipped.claims[1] !== undefined) flipped.claims[1].acknowledgedRerun = 'yes';
      writeFileSync(path, `${JSON.stringify(flipped)}\n`);
      expect(() => readAdmissionDocument(fx.storePath)).toThrow();
      // The reservation's consent flipped off after the fact: legalTransition refuses the stored outcome over it.
      const parsed = JSON.parse(original) as typeof journal;
      const [stored, out] = parsed.claims as unknown as ClaimEvent[];
      expect(stored !== undefined && out !== undefined).toBe(true);
      const { acknowledgedRerun: _a, priorAttempted: _p, priorCompleted: _c, ...stripped } = stored as ClaimEvent;
      expect(legalTransition(stripped as ClaimEvent, out as ClaimEvent)).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});

describe('/status before Start', () => {
  const EXACT_KEYS = ['dispatchedAt', 'legacyRunId', 'priorAttempted', 'priorCompleted', 'rerunConsentRequired', 'serverRunId', 'state', 'updatedAt', 'wljRunId', 'workflowRunId'];

  it('shows priorAttempted, priorCompleted and rerunConsentRequired at top level: required only when both are known and one is above zero, and never the phrase', async () => {
    const fx = await admitted(RUN_A, reader(ZERO));
    try {
      const shown: Record<string, unknown>[] = [];
      const cases = [
        [0, 0, false], [1, 0, true], [3, 0, true], [0, 1, true], [2, 2, true],
        ['UNKNOWN', 0, false], [0, 'UNKNOWN', false], ['UNKNOWN', 1, false], [1, 'UNKNOWN', false], ['UNKNOWN', 'UNKNOWN', false],
      ] as const;
      for (const [attempted, completed, required] of cases) {
        const asked: string[] = [];
        const status = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports, (mission) => {
          asked.push(mission);
          return Promise.resolve({ attempted, completed });
        });
        expect(status?.status).toBe(200);
        const body = status?.body as Record<string, unknown>;
        shown.push(body);
        expect(Object.keys(body).sort()).toEqual(EXACT_KEYS);
        expect(body, `${String(attempted)}/${String(completed)}`).toEqual({
          wljRunId: RUN_A, serverRunId: RUN_A, legacyRunId: null, dispatchedAt: null, workflowRunId: null,
          state: 'awaiting_operator', updatedAt: WHEN, priorAttempted: attempted, priorCompleted: completed, rerunConsentRequired: required,
        });
        expect(asked).toEqual([MISSION]);
      }
      // No reader wired, a reader that throws, or nonsense counts: UNKNOWN and not required.
      for (const port of [
        undefined,
        () => Promise.reject(new Error('x')),
        () => Promise.resolve({ attempted: -1, completed: 0 }),
        () => Promise.resolve({ attempted: 0, completed: Number.NaN }),
        () => Promise.resolve(null),
      ]) {
        const status = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports, port as never);
        expect(status?.body).toMatchObject({ rerunConsentRequired: false });
        const body = status?.body as Record<string, unknown>;
        expect(body.priorAttempted === 'UNKNOWN' || body.priorCompleted === 'UNKNOWN').toBe(true);
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
      const withCount = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports, () => Promise.resolve({ attempted: 2, completed: 1 }));
      for (const body of [plain?.body, withCount?.body] as Record<string, unknown>[]) {
        for (const key of ['wljRunId', 'serverRunId', 'state', 'updatedAt']) expect(typeof body[key], key).toBe('string');
        for (const key of ['legacyRunId', 'dispatchedAt', 'workflowRunId']) expect(body[key], key).toBeNull();
        expect(typeof body.rerunConsentRequired).toBe('boolean');
        for (const key of ['priorAttempted', 'priorCompleted']) {
          expect(typeof body[key] === 'number' || body[key] === 'UNKNOWN', key).toBe(true);
        }
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
        return Promise.resolve({ attempted: 1, completed: 1 });
      });
      expect(status?.body).toMatchObject({ state: 'dispatched', priorAttempted: 'UNKNOWN', priorCompleted: 'UNKNOWN', rerunConsentRequired: false });
      expect(asked).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  it('withRerunConsent is true exactly when both are known and one is above zero', () => {
    expect(withRerunConsent({}, 0, 0)).toEqual({ priorAttempted: 0, priorCompleted: 0, rerunConsentRequired: false });
    expect(withRerunConsent({}, 1, 0)).toEqual({ priorAttempted: 1, priorCompleted: 0, rerunConsentRequired: true });
    expect(withRerunConsent({}, 0, 1)).toEqual({ priorAttempted: 0, priorCompleted: 1, rerunConsentRequired: true });
    expect(withRerunConsent({}, 'UNKNOWN', 1)).toEqual({ priorAttempted: 'UNKNOWN', priorCompleted: 1, rerunConsentRequired: false });
    expect(withRerunConsent({}, 1, 'UNKNOWN')).toEqual({ priorAttempted: 1, priorCompleted: 'UNKNOWN', rerunConsentRequired: false });
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
  /** `gh` answering main's contract and workflow by path, recording every argv. */
  const mainRunner = (files: { contract?: string | null; workflow?: string | null }): GhBytesRunner & { calls: string[][] } => {
    const calls: string[][] = [];
    const run = (async (args: readonly string[]) => {
      calls.push([...args]);
      const path = args.at(-1) ?? '';
      const text = path.includes('/contract.json') ? files.contract : path.includes('/.github/workflows/') ? (files.workflow === undefined ? workflowYaml(true) : files.workflow) : null;
      if (text === null || text === undefined) return { code: 1, stdout: new Uint8Array() };
      return { code: 0, stdout: new TextEncoder().encode(text) };
    }) as GhBytesRunner & { calls: string[][] };
    run.calls = calls;
    return run;
  };

  it('reads the contract and the workflow at main with GETs, then both counts; caches known counts, never UNKNOWN', async () => {
    let now = 0;
    const prior = reader(ONE, ONE);
    const run = mainRunner({ contract: JSON.stringify({ markerNamespace: MISSION }) });
    const status = createStatusPriorAttempts({ repo: REPO, run, reader: prior, nowMs: () => now, ttlMs: 1000 });
    expect(await status(MISSION)).toEqual({ attempted: 1, completed: 1 });
    expect(run.calls.every((args) => args.slice(0, 3).join(' ') === 'api -X GET')).toBe(true);
    expect(run.calls.map((args) => args.at(-1))).toEqual([
      `repos/${REPO}/contents/${missionContractPath(MISSION)}?ref=main`,
      `repos/${REPO}/contents/.github/workflows/${PAID_WORKFLOW_FILE}?ref=main`,
    ]);
    expect(await status(MISSION)).toEqual({ attempted: 1, completed: 1 });
    expect(prior.asked).toEqual([MISSION]);
    now = 1000;
    await status(MISSION);
    expect(prior.asked).toHaveLength(2);
    const firstLive = createStatusPriorAttempts({ repo: REPO, run: mainRunner({ contract: JSON.stringify({ markerNamespace: 'julius-first-live' }) }), reader: reader(ZERO, ZERO) });
    expect(await firstLive(MISSION), 'the recorded constant').toEqual({ attempted: 0, completed: 1 });
    const unknown = reader(UNKNOWN);
    const never = createStatusPriorAttempts({ repo: REPO, run, reader: unknown, nowMs: () => 0 });
    expect(await never(MISSION)).toEqual({ attempted: 'UNKNOWN', completed: 0 });
    await never(MISSION);
    expect(unknown.asked).toHaveLength(2);
    const noTable = createStatusPriorAttempts({ repo: REPO, run: mainRunner({ contract: JSON.stringify({ markerNamespace: MISSION }), workflow: null }), reader: reader(ZERO, ZERO) });
    expect(await noTable(MISSION)).toEqual({ attempted: 0, completed: 'UNKNOWN' });
    for (const contract of [null, '{}', 'not json', JSON.stringify({ markerNamespace: 'X' })]) {
      const asked = reader(ONE);
      expect(await createStatusPriorAttempts({ repo: REPO, run: mainRunner({ contract }), reader: asked })(MISSION), String(contract))
        .toEqual({ attempted: 'UNKNOWN', completed: 'UNKNOWN' });
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
    expect(parseRehearsalArgv(['--prior', '0'])).toMatchObject({ prior: 0, completed: 0 });
    expect(parseRehearsalArgv(['--prior', '1'])?.prior).toBe(1);
    expect(parseRehearsalArgv(['--prior', 'UNKNOWN'])?.prior).toBe('UNKNOWN');
    expect(parseRehearsalArgv(['--prior', '0', '--completed', '1'])).toMatchObject({ prior: 0, completed: 1 });
    expect(parseRehearsalArgv(['--prior', '0', '--completed', 'UNKNOWN'])).toMatchObject({ prior: 0, completed: 'UNKNOWN' });
    for (const bad of [[], ['--prior', '2'], ['--prior', 'unknown'], ['--prior', '1', '--session-token', 'x'], ['--prior', '0', '--completed'], ['--prior', '0', '--completed', '2']]) {
      expect(parseRehearsalArgv(bad), bad.join(' ')).toBeNull();
    }
    expect(await rehearsalPriorReader('UNKNOWN').read({ repo: REPO, namespace: MISSION })).toEqual({ readable: false });
    expect(await rehearsalPriorReader(1).read({ repo: REPO, namespace: MISSION })).toEqual({ readable: true, counted: 1 });
    expect(await rehearsalPriorReader(0).readCompleted({ repo: REPO, namespace: MISSION })).toEqual({ readable: true, counted: 0 });
    expect(await rehearsalPriorReader(0, 'UNKNOWN').readCompleted({ repo: REPO, namespace: MISSION })).toEqual({ readable: false });
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

describe('reader answers that are not a count are UNKNOWN, a 409, never a 503', () => {
  it('null, a truthy non-boolean readable, or a malformed count, on either read', async () => {
    const odd: unknown[] = [null, undefined, { readable: 1, counted: 1 }, { readable: 'true', counted: 1 }, { readable: true }, { readable: true, counted: '1' }, 7];
    for (const value of odd) {
      for (const which of ['read', 'readCompleted'] as const) {
        const answer = () => Promise.resolve(value as PriorAttemptRead);
        const prior: PriorAttemptReader = {
          read: which === 'read' ? answer : () => Promise.resolve(ZERO),
          readCompleted: which === 'readCompleted' ? answer : () => Promise.resolve(ZERO),
        };
        const fx = await admitted(RUN_A, prior);
        try {
          const refused = await fx.start({ acknowledgeRerun: PHRASE });
          expect(refused?.status, `${which} ${JSON.stringify(value)}`).toBe(409);
          expect(kindOf(refused?.body)).toBe('julius_prior_attempts_unknown');
          expect(fx.journal()).toEqual([]);
          expect(workflowRuns(fx.gh.calls)).toEqual([]);
        } finally {
          fx.cleanup();
        }
      }
    }
    // An answer that throws when it is looked at is still read inside the try: UNKNOWN, a 409, never a 503.
    const hostile = { get readable(): boolean { throw new Error('hostile getter'); }, counted: 1 };
    for (const which of ['read', 'readCompleted'] as const) {
      const answer = () => Promise.resolve(hostile as unknown as PriorAttemptRead);
      const prior: PriorAttemptReader = {
        read: which === 'read' ? answer : () => Promise.resolve(ZERO),
        readCompleted: which === 'readCompleted' ? answer : () => Promise.resolve(ZERO),
      };
      const fx = await admitted(RUN_A, prior);
      try {
        const refused = await fx.start({ acknowledgeRerun: PHRASE });
        expect(refused?.status, which).toBe(409);
        expect(kindOf(refused?.body)).toBe('julius_prior_attempts_unknown');
        expect(fx.journal()).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }
    expect(priorCount({ readable: 1, counted: 1 } as unknown as PriorAttemptRead)).toBe('UNKNOWN');
    expect(priorCount(null)).toBe('UNKNOWN');
  });
});

describe('the in-flight guard: one paid run of a mission at a time', () => {
  const KEY_A = ADMIT_KEY;
  const KEY_B = '22222222-3333-4444-8555-666666666666';
  const dispatchKey = (key: string) => createHash('sha256').update(key).digest('hex');
  const listing = (key: string, status: string): GhResult => ({
    code: 0,
    stdout: JSON.stringify([{
      databaseId: 40250000001, displayTitle: `julius mission=${MISSION} lane=lab mode=paid key=${dispatchKey(key)}`,
      status, conclusion: status === 'completed' ? 'failure' : '', event: 'workflow_dispatch', headBranch: 'main', attempt: 1,
    }]),
    stderr: '',
  });

  /** Two admissions of the same mission in ONE store, and one claim core over it. */
  async function pair(prior: PriorAttemptReader, runList: () => GhResult) {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-inflight-'));
    const storePath = join(dir, 'admission.json');
    const ports = service(storePath);
    for (const [run, key, trigger] of [[RUN_A, KEY_A, 'trigger_01'], [RUN_B, KEY_B, 'trigger_02']] as const) {
      const created = await handleWonderlandAdmissionRoute(base(run, {
        path: WONDERLAND_ADMISSION_PATH,
        url: `${WONDERLAND_ADMISSION_PATH}?projectId=${PROJECT}`,
        idempotencyKey: key,
        rawBody: JSON.stringify({ runId: run, clientTriggerId: trigger, clientLogSha256: 'ab'.repeat(32), clientUiActionUtc: WHEN }),
      }), ports);
      expect(created?.status).toBe(202);
    }
    const gh = fakeGh({ runList });
    const tool = createOperatorClaimTool(openAdmissionFile(storePath), gh.spawn, { nowIso: () => WHEN }, prior);
    const start = (run: string, extra: Record<string, unknown> = {}) =>
      handleWonderlandMissionStartRoute(startRequest(run, extra), ports, { claimTool: () => tool });
    const claimsOf = (run: string) => readAdmissionDocument(storePath).claims.filter((event) => event.wonderlandRunId === run);
    const journalPath = () => join(dir, readdirSync(dir).find((entry) => entry.endsWith('.operator.json')) ?? '');
    return { dir, storePath, gh, start, claimsOf, journalPath, cleanup() { ports.close(); rmSync(dir, { recursive: true, force: true }); } };
  }

  it('A dispatched and its run still going: B is 409 julius_paid_run_in_flight, nothing written, retry true; once that run completed, B goes on', async () => {
    let runStatus = 'in_progress';
    const fx = await pair(reader(ZERO), () => listing(KEY_A, runStatus));
    try {
      expect((await fx.start(RUN_A))?.status).toBe(202);
      for (const extra of [{}, { acknowledgeRerun: PHRASE }]) {
        const refused = await fx.start(RUN_B, extra);
        expect(refused?.status).toBe(409);
        expect(refused?.body).toEqual({
          error: { kind: 'julius_paid_run_in_flight', message: expect.any(String) },
          retry: true, wljRunId: RUN_B, state: 'admitted', workflowRunId: null, dispatchedAt: null, replayed: false, inFlightWljRunId: RUN_A,
        });
        expect(fx.claimsOf(RUN_B)).toEqual([]);
      }
      expect(workflowRuns(fx.gh.calls)).toHaveLength(1);
      runStatus = 'completed';
      expect((await fx.start(RUN_B))?.status).toBe(202);
      expect(workflowRuns(fx.gh.calls)).toHaveLength(2);
    } finally {
      fx.cleanup();
    }
  });

  it('a run list that cannot be read, or shows no run for the key of A, keeps B refused', async () => {
    const lists: (() => GhResult)[] = [
      () => ({ code: 1, stdout: '', stderr: 'HTTP 502' }),
      () => ({ code: 0, stdout: '[]', stderr: '' }),
      () => listing(KEY_B, 'completed'),
    ];
    for (const runList of lists) {
      const fx = await pair(reader(ZERO), runList);
      try {
        expect((await fx.start(RUN_A))?.status).toBe(202);
        const refused = await fx.start(RUN_B);
        expect(kindOf(refused?.body)).toBe('julius_paid_run_in_flight');
        expect(fx.claimsOf(RUN_B)).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }
  });

  it('a terminal progress note, or a terminal claim state, settles A without any GitHub read', async () => {
    const noList = (): GhResult => { throw new Error('no run list expected'); };
    const fx = await pair(reader(ZERO), noList);
    try {
      expect((await fx.start(RUN_A))?.status).toBe(202);
      const journal = JSON.parse(readFileSync(fx.journalPath(), 'utf8')) as { progress: unknown[] };
      journal.progress = [...journal.progress, { serverRunId: RUN_A, state: 'failed', cause: null, updatedAt: WHEN }];
      writeFileSync(fx.journalPath(), `${JSON.stringify(journal)}\n`);
      expect((await fx.start(RUN_B))?.status).toBe(202);
    } finally {
      fx.cleanup();
    }
    const failed = await pair(reader(ZERO), noList);
    try {
      const real = failed.gh.spawn.run.bind(failed.gh.spawn);
      let first = true;
      failed.gh.spawn.run = (args) => {
        if (args[0] === 'workflow' && first) {
          first = false;
          return { code: 1, stdout: '', stderr: 'boom' };
        }
        return real(args);
      };
      expect(kindOf((await failed.start(RUN_A))?.body)).toBe('dispatch_failed');
      expect((await failed.start(RUN_B))?.status).toBe(202);
    } finally {
      failed.cleanup();
    }
  });

  it('D3 (c): in flight under start key K, the other admission then terminal, the SAME key K proceeds per the count', async () => {
    let runStatus = 'in_progress';
    for (const [prior, expected] of [[reader(ZERO), 202], [reader(ONE), 409]] as const) {
      runStatus = 'in_progress';
      const fx = await pair(prior, () => listing(KEY_A, runStatus));
      try {
        expect((await fx.start(RUN_A, { acknowledgeRerun: PHRASE }))?.status).toBe(202);
        const refused = await fx.start(RUN_B);
        expect(kindOf(refused?.body)).toBe('julius_paid_run_in_flight');
        const journal = JSON.parse(readFileSync(fx.journalPath(), 'utf8')) as { progress: unknown[] };
        journal.progress = [...journal.progress, { serverRunId: RUN_A, state: 'failed', cause: null, updatedAt: WHEN }];
        writeFileSync(fx.journalPath(), `${JSON.stringify(journal)}\n`);
        const retried = await fx.start(RUN_B);
        expect(retried?.status, JSON.stringify(retried?.body)).toBe(expected);
        if (expected === 409) expect(kindOf(retried?.body)).toBe('julius_rerun_consent_required');
        expect(workflowRuns(fx.gh.calls)).toHaveLength(expected === 202 ? 2 : 1);
      } finally {
        fx.cleanup();
      }
    }
  });

  it('inFlightPeers: the same mission only, other admissions only, dispatching or dispatched only', async () => {
    const fx = await pair(reader(ZERO), () => listing(KEY_A, 'in_progress'));
    try {
      const document = () => readAdmissionDocument(fx.storePath);
      const rowOf = (run: string) => {
        const row = document().admissions.find((entry) => entry.runId === run);
        if (row === undefined) throw new Error('missing row');
        return row;
      };
      expect(inFlightPeers(document(), rowOf(RUN_B))).toEqual([]);
      expect((await fx.start(RUN_A))?.status).toBe(202);
      expect(inFlightPeers(document(), rowOf(RUN_B)).map((row) => row.runId)).toEqual([RUN_A]);
      expect(inFlightPeers(document(), rowOf(RUN_A))).toEqual([]);
      expect(inFlightPeers(document(), { ...rowOf(RUN_B), missionId: 'julius-other-1' })).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe('REVIEW findings on fd7d438d', () => {
  it('O1: a consent built for one admission never binds another, nor another phrase, nor edited fields', () => {
    const consent: RerunConsent = {
      wonderlandRunId: RUN_A, serverRunId: RUN_A, prior: { attempted: 1, completed: 0 },
      acknowledgedRerun: true, priorAttempted: 1, priorCompleted: 0,
    };
    expect(rerunConsentBinds(consent, { runId: RUN_A, serverRunId: RUN_A }, PHRASE)).toBe(true);
    expect(rerunConsentBinds(consent, { runId: RUN_B, serverRunId: RUN_B }, PHRASE), 'another admission').toBe(false);
    expect(rerunConsentBinds(consent, { runId: RUN_A, serverRunId: RUN_B }, PHRASE), 'another server run').toBe(false);
    expect(rerunConsentBinds({ ...consent, wonderlandRunId: RUN_B }, { runId: RUN_A, serverRunId: RUN_A }, PHRASE), 'built for B').toBe(false);
    expect(rerunConsentBinds(consent, { runId: RUN_A, serverRunId: RUN_A }, null), 'no phrase on this claim').toBe(false);
    expect(rerunConsentBinds({ ...consent, acknowledgedRerun: false }, { runId: RUN_A, serverRunId: RUN_A }, PHRASE), 'flag edited').toBe(false);
    expect(rerunConsentBinds({ ...consent, priorAttempted: 2 }, { runId: RUN_A, serverRunId: RUN_A }, PHRASE), 'count edited').toBe(false);
    expect(rerunConsentBinds({ ...consent, prior: { attempted: 'UNKNOWN', completed: 0 } }, { runId: RUN_A, serverRunId: RUN_A }, PHRASE), 'unknown').toBe(false);
  });

  it('O3: a stored consent needs both whole counts with at least one above 0; priorAttempted 0 alone is corrupt', async () => {
    const fx = await admitted(RUN_A, reader(ONE));
    try {
      expect((await fx.start({ acknowledgeRerun: PHRASE }))?.status).toBe(202);
      const name = readdirSync(fx.dir).find((entry) => entry.endsWith('.operator.json')) ?? '';
      const path = join(fx.dir, name);
      const original = readFileSync(path, 'utf8');
      const edit = (fields: Record<string, unknown>, drop: readonly string[] = []) => {
        const journal = JSON.parse(original) as { claims: Record<string, unknown>[] };
        for (const claim of journal.claims) {
          Object.assign(claim, fields);
          for (const key of drop) delete claim[key];
        }
        writeFileSync(path, `${JSON.stringify(journal)}\n`);
      };
      for (const [fields, drop] of [
        [{ priorAttempted: 0, priorCompleted: 0 }, []],
        [{ priorAttempted: 0 }, ['priorCompleted']],
        [{ priorAttempted: 0, acknowledgedRerun: false }, []],
        [{ priorAttempted: -1, priorCompleted: 2 }, []],
        [{ priorAttempted: 1.5, priorCompleted: 0 }, []],
      ] as const) {
        edit(fields, drop);
        expect(() => readAdmissionDocument(fx.storePath), JSON.stringify(fields)).toThrow();
      }
      // A completed-only consent (attempted 0, completed 1) is the step-9 case, and is valid.
      edit({ priorAttempted: 0, priorCompleted: 1 });
      expect(readAdmissionDocument(fx.storePath).claims.every((event) => event.priorAttempted === 0 && event.priorCompleted === 1)).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  it('D5 behaviourally: the phrase in process.env, or in the bridge env, under any plausible name, neither sends the flag nor satisfies consent', async () => {
    const names = [
      'ACKNOWLEDGE_RERUN', 'acknowledge_rerun', 'RERUN_PAID_MISSION', 'JULIUS_RERUN_ACK', 'JULIUS_ACKNOWLEDGE_RERUN',
      'JULIUS_WONDERLAND_ACKNOWLEDGE_RERUN', 'JULIUS_WONDERLAND_RERUN_ACKNOWLEDGE', 'JULIUS_WONDERLAND_RERUN_CONFIRM',
      'RELAY_ACKNOWLEDGE_RERUN', 'WONDERLAND_ACKNOWLEDGE_RERUN', 'RERUN_CONFIRM', 'INPUT_ACKNOWLEDGE_RERUN',
    ];
    const saved = new Map(names.map((name) => [name, process.env[name]]));
    for (const name of names) process.env[name] = PHRASE;
    const bridgeEnv = Object.fromEntries(names.map((name) => [name, PHRASE]));
    try {
      const counted = await admitted(RUN_A, reader(ONE), fakeGh(), bridgeEnv);
      try {
        const refused = await counted.start();
        expect(refused?.status).toBe(409);
        expect(kindOf(refused?.body)).toBe('julius_rerun_consent_required');
        expect(counted.journal()).toEqual([]);
        expect(workflowRuns(counted.gh.calls)).toEqual([]);
      } finally {
        counted.cleanup();
      }
      const zero = await admitted(RUN_A, reader(ZERO), fakeGh(), bridgeEnv);
      try {
        expect((await zero.start())?.status).toBe(202);
        const runs = workflowRuns(zero.gh.calls);
        expect(runs).toHaveLength(1);
        expect(ackFlags(runs[0] ?? [])).toEqual([]);
        for (const event of zero.journal()) expect(event).not.toHaveProperty('acknowledgedRerun');
      } finally {
        zero.cleanup();
      }
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe('REVIEW D3: a refusal is never remembered under the start key', () => {
  it('(a) 409 consent required, then the SAME x-relay-idempotency-key with the phrase: exactly one gh workflow run, with the flag, one reservation', async () => {
    const fx = await admitted(RUN_A, reader(ONE));
    try {
      const refused = await fx.start({}, { idempotencyKey: START_KEY });
      expect(kindOf(refused?.body)).toBe('julius_rerun_consent_required');
      const accepted = await fx.start({ acknowledgeRerun: PHRASE }, { idempotencyKey: START_KEY });
      expect(accepted?.status).toBe(202);
      const runs = workflowRuns(fx.gh.calls);
      expect(runs).toHaveLength(1);
      expect(ackFlags(runs[0] ?? [])).toEqual([['-f', 'acknowledge_rerun=RERUN PAID MISSION']]);
      expect(fx.journal().filter((event) => event.state === 'dispatching')).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  it('(b) 409 UNKNOWN, the reader recovers to 1, then the SAME key with the phrase: exactly one dispatch', async () => {
    let attempted: PriorAttemptRead = UNKNOWN;
    const recovering: PriorAttemptReader = {
      read: () => Promise.resolve(attempted),
      readCompleted: () => Promise.resolve(ZERO),
    };
    const fx = await admitted(RUN_A, recovering);
    try {
      const refused = await fx.start({ acknowledgeRerun: PHRASE }, { idempotencyKey: START_KEY });
      expect(kindOf(refused?.body)).toBe('julius_prior_attempts_unknown');
      expect(fx.journal()).toEqual([]);
      attempted = ONE;
      const accepted = await fx.start({ acknowledgeRerun: PHRASE }, { idempotencyKey: START_KEY });
      expect(accepted?.status).toBe(202);
      expect(workflowRuns(fx.gh.calls)).toHaveLength(1);
      expect(fx.journal().filter((event) => event.state === 'dispatching')).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });
});

describe('TODAY\'S REAL PEERS are settled: the founder\'s next J1 Start is not refused as in flight', () => {
  /**
   * The live bridge's admission store and journal, copied read-only on
   * 2026-10-26 (four J1 admissions, each `dispatched`, the last
   * wlj_0c96b0f9 to workflow run 40299692757), and the real `gh run list`
   * answer for them, all four runs `completed`. Ids and hashes only.
   */
  const REAL = JSON.parse(readFileSync(join(__dirname, 'fixtures/realrun-j1-store-20261026.json'), 'utf8')) as {
    readonly store: { readonly rows: readonly { readonly runId: string; readonly keyHash: string; readonly missionId: string }[] };
    readonly journal: { readonly claims: readonly { readonly wonderlandRunId: string; readonly state: string; readonly workflowRunId: string | null }[] };
    readonly runList: readonly unknown[];
  };
  const REAL_PEERS = [
    'wlj_23f50bac-67d8-497c-b31f-1db02311ae93',
    'wlj_1ed344d1-16f4-48fa-baa2-9f7cc8602e36',
    'wlj_309e375d-c2c6-4a63-8590-b417c07dd433',
    'wlj_0c96b0f9-2879-4426-b464-fb132ae658fa',
  ];
  const NEXT = 'wlj_5d6e7f80-91a2-4b3c-8d4e-5f60718293a4';

  async function realStore(prior: PriorAttemptReader, runList: () => GhResult) {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-realpeer-'));
    const storePath = join(dir, 'admission.json');
    writeFileSync(storePath, `${JSON.stringify(REAL.store)}\n`);
    writeFileSync(`${storePath}.operator.json`, `${JSON.stringify((REAL as unknown as { journal: unknown }).journal)}\n`);
    const ports = service(storePath, { JULIUS_J1_MAX_RUNS_PER_MISSION: '10', JULIUS_J1_DAILY_CAP: '10' });
    const created = await handleWonderlandAdmissionRoute(base(NEXT, {
      path: WONDERLAND_ADMISSION_PATH,
      url: `${WONDERLAND_ADMISSION_PATH}?projectId=${PROJECT}`,
      idempotencyKey: '33333333-4444-4555-8666-777777777777',
      rawBody: JSON.stringify({ runId: NEXT, clientTriggerId: 'trigger_09', clientLogSha256: 'ab'.repeat(32), clientUiActionUtc: WHEN }),
    }), ports);
    expect(created?.status, JSON.stringify(created?.body)).toBe(202);
    const gh = fakeGh({ runList });
    const tool = createOperatorClaimTool(openAdmissionFile(storePath), gh.spawn, { nowIso: () => WHEN }, prior);
    const start = (extra: Record<string, unknown> = {}) => handleWonderlandMissionStartRoute(startRequest(NEXT, extra), ports, { claimTool: () => tool });
    return { storePath, gh, start, cleanup() { ports.close(); rmSync(dir, { recursive: true, force: true }); } };
  }
  const realList = (): GhResult => ({ code: 0, stdout: JSON.stringify(REAL.runList), stderr: '' });

  it('the fixture is the real record: four J1 admissions, each dispatched to a run the real list shows completed', () => {
    expect(REAL.store.rows.map((row) => row.runId)).toEqual(REAL_PEERS);
    expect(new Set(REAL.store.rows.map((row) => row.missionId))).toEqual(new Set([MISSION]));
    const dispatched = REAL.journal.claims.filter((claim) => claim.state === 'dispatched');
    expect(dispatched.map((claim) => [claim.wonderlandRunId, claim.workflowRunId])).toEqual([
      [REAL_PEERS[0], '40242149156'], [REAL_PEERS[1], '40258482240'], [REAL_PEERS[2], '40278849833'], [REAL_PEERS[3], '40299692757'],
    ]);
    for (const row of REAL.store.rows) {
      const runs = runsForDispatchKey(realList(), row.keyHash);
      expect(runs?.length, row.runId).toBe(1);
      expect(runs?.[0]?.status, row.runId).toBe('completed');
    }
  });

  it('the journal names all four as dispatched peers, and the real run list settles every one', async () => {
    const fx = await realStore(reader(ONE), realList);
    try {
      const document = readAdmissionDocument(fx.storePath);
      const next = document.admissions.find((row) => row.runId === NEXT);
      if (next === undefined) throw new Error('missing the new admission');
      const peers = inFlightPeers(document, next);
      expect(peers.map((row) => row.runId)).toEqual(REAL_PEERS);
      const listing = fakeGh({ runList: realList }).spawn;
      expect(unsettledPeer(listing, REPO, peers)).toBeNull();
      for (const peer of peers) expect(unsettledPeer(listing, REPO, [peer]), peer.runId).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  it('so the next J1 Start reaches the consent decision: 409 consent required without the phrase, one dispatch with the flag with it', async () => {
    const fx = await realStore(reader(ONE), realList);
    try {
      const refused = await fx.start();
      expect(refused?.status).toBe(409);
      expect(kindOf(refused?.body)).toBe('julius_rerun_consent_required');
      expect(refused?.body).toMatchObject({ priorAttempted: 1, priorCompleted: 0 });
      const accepted = await fx.start({ acknowledgeRerun: PHRASE });
      expect(accepted?.status, JSON.stringify(accepted?.body)).toBe(202);
      const runs = workflowRuns(fx.gh.calls);
      expect(runs).toHaveLength(1);
      expect(ackFlags(runs[0] ?? [])).toEqual([['-f', 'acknowledge_rerun=RERUN PAID MISSION']]);
    } finally {
      fx.cleanup();
    }
  });

  it('the same store with 40299692757 still running is refused as in flight, naming wlj_0c96b0f9', async () => {
    const running = (): GhResult => ({
      code: 0,
      stdout: JSON.stringify(REAL.runList.map((row) => ((row as { databaseId: number }).databaseId === 40299692757 ? { ...(row as object), status: 'in_progress', conclusion: '' } : row))),
      stderr: '',
    });
    const fx = await realStore(reader(ONE), running);
    try {
      const refused = await fx.start({ acknowledgeRerun: PHRASE });
      expect(kindOf(refused?.body)).toBe('julius_paid_run_in_flight');
      expect(refused?.body).toMatchObject({ inFlightWljRunId: REAL_PEERS[3], retry: true });
      expect(workflowRuns(fx.gh.calls)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});
