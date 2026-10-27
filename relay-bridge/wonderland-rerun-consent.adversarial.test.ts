/**
 * REVIEW's adversarial cases for the founder's second phrase, adopted into the
 * suite. The header is wonderland-rerun-consent.test.ts's own fixtures; the
 * cases are REVIEW's, adapted to the step-9 mirror (two counts) and to the
 * strict reader contract (anything that is not a count is a 409 UNKNOWN).
 * Offline; nothing here can reach GitHub or spend.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PAID_WORKFLOW_FILE } from '../src/relay/integration/wonderland-admission/admission-contract';
import { openAdmissionFile, readAdmissionDocument } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  LANE_GRANT_SOURCE,
  createOperatorClaimTool,
  missionContractPath,
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
  WONDERLAND_ADMISSION_PATH,
  WONDERLAND_STATUS_PATH,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import { handleWonderlandMissionStartRoute } from './wonderland-mission-start-route';
import { createGhPriorAttemptReader } from './wonderland-prior-attempts';

const ADMIT_KEY = '11111111-2222-4333-8444-555555555555';
const START_KEY = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const WHEN = '2026-10-23T17:18:00.000Z';
const PROJECT = 'project-1';
const REPO = 'founder/sunday-relay';
const MISSION = 'julius-inworld-data-1';
const WORKFLOW_RUN = '40250000001';
const RUN_A = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
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
const kindOf = (body: unknown) => (body as { error?: { kind?: string } }).error?.kind;

describe('REVIEWER adversarial', () => {
  it('R1 homoglyph / padded / non-string phrases are 400 before any read, spawn or write; admission still startable', async () => {
    const variants: unknown[] = [
      'RERUN РAID MISSION',
      'RERUN PAID MISSION', 'RERUN PAID MISSION​', 'ＲERUN PAID MISSION', 'RERUN PAID MISSION\n',
      ['RERUN PAID MISSION'], { toString: 'RERUN PAID MISSION' }, 0, false,
    ];
    for (const wrong of variants) {
      const prior = reader(ONE);
      const fx = await admitted(RUN_A, prior);
      try {
        const r = await fx.start({ acknowledgeRerun: wrong });
        expect(r?.status, JSON.stringify(wrong)).toBe(400);
        expect(prior.asked).toEqual([]);
        expect(fx.gh.calls).toEqual([]);
        expect(fx.journal()).toEqual([]);
        expect((await fx.start({ acknowledgeRerun: PHRASE }))?.status).toBe(202);
      } finally { fx.cleanup(); }
    }
  });

  it('R2 stale status 0, fresh read 1 at Start: 409 twice, not burned, then a different start key with the phrase dispatches once', async () => {
    const prior = reader(ONE);
    const fx = await admitted(RUN_A, prior);
    try {
      const status = await handleWonderlandStatusRoute(statusRequest(RUN_A), fx.ports, () => Promise.resolve({ attempted: 0, completed: 0 }));
      expect(status?.body).toMatchObject({ priorAttempted: 0, priorCompleted: 0, rerunConsentRequired: false });
      const r1 = await fx.start({});
      expect(r1?.status).toBe(409);
      expect(kindOf(r1?.body)).toBe('julius_rerun_consent_required');
      expect(fx.journal()).toEqual([]);
      const r1b = await fx.start({});
      expect(r1b?.status).toBe(409);
      expect(fx.gh.calls.filter((a) => a.some((x) => x.includes('git/ref'))).length).toBe(0);
      const r2 = await fx.start({ acknowledgeRerun: PHRASE }, { idempotencyKey: '12345678-1234-4234-8234-123456789abc' });
      expect(r2?.status).toBe(202);
      expect(workflowRuns(fx.gh.calls)).toHaveLength(1);
      expect(fx.gh.calls.filter((a) => a.some((x) => x.includes('git/ref'))).length).toBe(1);
    } finally { fx.cleanup(); }
  });

  it('R3 concurrent Starts for the same admission: one dispatch, no duplicate', async () => {
    const prior = reader(ONE);
    const fx = await admitted(RUN_A, prior);
    try {
      const results = await Promise.all([
        fx.start({ acknowledgeRerun: PHRASE }),
        fx.start({ acknowledgeRerun: PHRASE }, { idempotencyKey: '12345678-1234-4234-8234-123456789abc' }),
        fx.start({}),
      ]);
      const statuses = results.map((r) => r?.status);
      expect(workflowRuns(fx.gh.calls)).toHaveLength(1);
      expect(statuses.filter((s) => s === 202)).toHaveLength(1);
      expect(statuses.every((s) => s === 202 || s === 200 || s === 409)).toBe(true);
      expect(fx.journal().filter((e) => e.state === 'dispatching')).toHaveLength(1);
    } finally { fx.cleanup(); }
  });

  it('R3b two separate claim tools (as two processes) on one store, both with consent: one dispatch', async () => {
    const prior = reader(ONE);
    const fx = await admitted(RUN_A, prior);
    try {
      const tool2 = createOperatorClaimTool(openAdmissionFile(fx.storePath), fx.gh.spawn, { nowIso: () => WHEN }, prior);
      const results = await Promise.all([
        fx.start({ acknowledgeRerun: PHRASE }),
        handleWonderlandMissionStartRoute(startRequest(RUN_A, { acknowledgeRerun: PHRASE }, { idempotencyKey: '12345678-1234-4234-8234-123456789abc' }), fx.ports, { claimTool: () => tool2 }),
      ]);
      expect(workflowRuns(fx.gh.calls)).toHaveLength(1);
      expect(results.map((r) => r?.status).sort()).toEqual([200, 202]);
    } finally { fx.cleanup(); }
  });

  it('R4 odd reader answers, on either read, are 409 UNKNOWN, never a 503, never a dispatch, never a write', async () => {
    const odd: unknown[] = [
      { readable: true, counted: Number.NaN }, { readable: true, counted: '1' }, { readable: true, counted: Infinity },
      { readable: true, counted: 2 ** 60 }, { readable: true }, null,
    ];
    for (const value of odd) {
      const odd = () => Promise.resolve(value as PriorAttemptRead);
      const zero = () => Promise.resolve(ZERO);
      for (const prior of [{ read: odd, readCompleted: zero }, { read: zero, readCompleted: odd }] as PriorAttemptReader[]) {
        for (const extra of [{}, { acknowledgeRerun: PHRASE }]) {
          const fx = await admitted(RUN_A, prior);
          try {
            const r = await fx.start(extra);
            expect(r?.status, JSON.stringify(value)).toBe(409);
            expect(kindOf(r?.body)).toBe('julius_prior_attempts_unknown');
            expect(workflowRuns(fx.gh.calls)).toEqual([]);
            expect(fx.journal()).toEqual([]);
          } finally { fx.cleanup(); }
        }
      }
    }
  });

  it('R5 forged journal after a 0-count dispatch: it still parses (logged as bug #99, forensic only), and a replay still never dispatches', async () => {
    const fx = await admitted(RUN_A, reader(ZERO));
    try {
      expect((await fx.start({}))?.status).toBe(202);
      const name = readdirSync(fx.dir).find((e) => e.endsWith('.operator.json')) ?? '';
      const path = join(fx.dir, name);
      const j = JSON.parse(readFileSync(path, 'utf8')) as { claims: Record<string, unknown>[] };
      const onlyOutcome = JSON.parse(JSON.stringify(j)) as typeof j;
      onlyOutcome.claims[1]!.acknowledgedRerun = true; onlyOutcome.claims[1]!.priorAttempted = 1; onlyOutcome.claims[1]!.priorCompleted = 0;
      writeFileSync(path, `${JSON.stringify(onlyOutcome)}\n`);
      let parsedOutcomeOnly = true;
      try { readAdmissionDocument(fx.storePath); } catch { parsedOutcomeOnly = false; }
      // Bug #99: a per-event read does not check the chain, so a forged outcome parses. legalTransition only guards appends.
      expect(parsedOutcomeOnly).toBe(true);
      for (const c of j.claims) { c.acknowledgedRerun = true; c.priorAttempted = 1; c.priorCompleted = 0; }
      writeFileSync(path, `${JSON.stringify(j)}\n`);
      let parsedBoth = true;
      try { readAdmissionDocument(fx.storePath); } catch { parsedBoth = false; }
      expect(parsedBoth).toBe(true);
      const calls = fx.gh.calls.length;
      const again = await fx.start({});
      expect(again?.status).toBe(200);
      expect(again?.body).toMatchObject({ replayed: true });
      expect(fx.gh.calls.length).toBe(calls);
    } finally { fx.cleanup(); }
  });

  it('R6 gh-backed reader: malformed 200s / gh failure are UNKNOWN; empty listing is 0; an unreadable run proof counts', async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const mk = (answer: (args: readonly string[]) => { code: number; stdout: Uint8Array }) => {
      const seen: string[][] = [];
      const r = createGhPriorAttemptReader(async (args) => { seen.push([...args]); return answer(args); });
      return { r, seen };
    };
    const ns = 'julius-live-mission-2';
    for (const body of ['not json', '{}', '{"total_count":2,"artifacts":[]}', '{"total_count":1,"artifacts":[{"name":"other","expired":false,"workflow_run":{"id":1,"head_sha":"a"}}]}', '[]', 'null', '']) {
      const { r } = mk(() => ({ code: 0, stdout: enc(body) }));
      expect(await r.read({ repo: REPO, namespace: ns }), body).toEqual({ readable: false });
    }
    expect(await mk(() => ({ code: 1, stdout: new Uint8Array() })).r.read({ repo: REPO, namespace: ns })).toEqual({ readable: false });
    expect(await mk(() => { throw new Error('boom'); }).r.read({ repo: REPO, namespace: ns })).toEqual({ readable: false });
    // X′ §2: the attempted markers are also read as record tags (`git/matching-refs/tags/julius-run-record-`), a list.
    const records = (args: readonly string[]): boolean => String(args[3]).includes('/git/matching-refs/tags/julius-run-record-');
    const empty = mk((args) => ({ code: 0, stdout: enc(records(args) ? '[]' : '{"total_count":0,"artifacts":[]}') }));
    expect(await empty.r.read({ repo: REPO, namespace: ns })).toEqual({ readable: true, counted: 0 });
    expect(empty.seen.every((a) => a[0] === 'api' && a[1] === '-X' && a[2] === 'GET')).toBe(true);
    const one = mk((args) => (records(args) ? { code: 0, stdout: enc('[]') } : String(args[3]).includes('/actions/artifacts?name=')
      ? { code: 0, stdout: enc(`{"total_count":1,"artifacts":[{"name":"${ns}-attempted","expired":false,"workflow_run":{"id":40278849833,"head_sha":"${'a'.repeat(40)}"}}]}`) }
      : { code: 1, stdout: new Uint8Array() }));
    expect(await one.r.read({ repo: REPO, namespace: ns })).toEqual({ readable: true, counted: 1 });
    expect(one.seen.every((a) => a[0] === 'api' && a[1] === '-X' && a[2] === 'GET')).toBe(true);
  });
});
