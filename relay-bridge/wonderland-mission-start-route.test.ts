import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PAID_WORKFLOW_FILE } from '../src/relay/integration/wonderland-admission/admission-contract';
import { readAdmissionDocument } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  LANE_GRANT_SOURCE,
  createOperatorClaimTool,
  missionContractPath,
  type GhResult,
  type GhSpawner,
  type OperatorClaimTool,
} from '../src/relay/integration/wonderland-admission/operator-claim';
import { openAdmissionFile } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  createWonderlandAdmissionService,
  handleWonderlandAdmissionRoute,
  WONDERLAND_ADMISSION_PATH,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import { handleWonderlandMissionStartRoute, isWonderlandMissionStartRoute } from './wonderland-mission-start-route';
import { classifyWonderlandDispatchPath, isWonderlandRoute } from './wonderland-routes';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const ADMIT_KEY = '11111111-2222-4333-8444-555555555555';
const START_KEY = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const WHEN = '2026-10-23T17:18:00.000Z';
const PROJECT = 'project-1';
const REPO = 'founder/sunday-relay';
const MISSION = 'julius-inworld-data-1';
const START_PATH = `/wonderland/julius/missions/${RUN}/start`;
const WORKFLOW_RUN = '40250000001';

const LANES = JSON.parse(readFileSync(join(__dirname, '../src/relay/integration/wonderland-admission/fixtures/pr459-lane-grants.json'), 'utf8')) as {
  readonly laneGrantExcerpt: string;
  readonly contractMarkerNamespace: string;
};
const WORKFLOW = `
name: fixture
on:
  workflow_dispatch:
    inputs:
      confirm_live:
        default: ''
      mission:
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

/** `gh` as GitHub would answer the claim core: main's files, an absent spent tag, and one workflow run. */
function fakeGh(): { spawn: GhSpawner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    spawn: {
      run(args) {
        calls.push([...args]);
        const target = args.find((arg) => arg.startsWith(CONTENTS));
        if (args[0] === 'api' && target !== undefined) {
          const path = target.slice(CONTENTS.length).replace(/\?ref=main$/u, '');
          const text = path === `.github/workflows/${PAID_WORKFLOW_FILE}` ? WORKFLOW
            : path === missionContractPath(MISSION) ? JSON.stringify({ markerNamespace: LANES.contractMarkerNamespace })
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

function base(over: Partial<WonderlandAdmissionRouteRequest>): WonderlandAdmissionRouteRequest {
  return {
    method: 'POST',
    path: START_PATH,
    url: `${START_PATH}?projectId=${PROJECT}`,
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

const admitRequest = () => base({
  path: WONDERLAND_ADMISSION_PATH,
  url: `${WONDERLAND_ADMISSION_PATH}?projectId=${PROJECT}`,
  idempotencyKey: ADMIT_KEY,
  rawBody: JSON.stringify({ runId: RUN, clientTriggerId: 'trigger_01', clientLogSha256: 'ab'.repeat(32), clientUiActionUtc: WHEN }),
});

const startBody = (over: Record<string, unknown> = {}) => JSON.stringify({
  wljRunId: RUN, confirm: 'RUN LIVE MISSION', clientTriggerId: 'c'.repeat(32), clientUiActionUtc: WHEN, ...over,
});
const startRequest = (over: Partial<WonderlandAdmissionRouteRequest> = {}) => base({ rawBody: startBody(), ...over });

/** An admitted, held J1 row on a real admission file, and the real claim core over a fake `gh`. */
async function admitted(over: Record<string, string | undefined> = {}, nowIso: () => string = () => WHEN) {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-start-'));
  const storePath = join(dir, 'admission.json');
  const ports = service(storePath, over);
  const created = await handleWonderlandAdmissionRoute(admitRequest(), ports);
  expect(created?.status).toBe(202);
  const gh = fakeGh();
  const tool = createOperatorClaimTool(openAdmissionFile(storePath), gh.spawn, { nowIso });
  const claims: string[] = [];
  const deps = {
    claimTool: (path: string): OperatorClaimTool => {
      claims.push(path);
      return tool;
    },
  };
  return {
    storePath, ports, gh, deps, claims,
    cleanup() { ports.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

const workflowRuns = (calls: readonly string[][]) => calls.filter((args) => args[0] === 'workflow');
const kind = (body: unknown) => (body as { error?: { kind?: string } }).error?.kind;

describe('the in-Wonderland mission start route', () => {
  it('is its own exact route, kept out of the Wonderland catch-all', () => {
    expect(isWonderlandMissionStartRoute(`${START_PATH}?projectId=${PROJECT}`)).toBe(true);
    expect(isWonderlandRoute(START_PATH)).toBe(false);
    expect(classifyWonderlandDispatchPath(START_PATH, `${START_PATH}?projectId=${PROJECT}`).exactMissionStart).toBe(true);
    for (const raw of [`${START_PATH}/`, START_PATH.toUpperCase(), `${START_PATH}/x`]) {
      expect(isWonderlandMissionStartRoute(raw), raw).toBe(false);
      expect(isWonderlandRoute(raw), raw).toBe(true);
    }
  });

  it('the founder\'s confirmed Start runs the claim core once and dispatches exactly one workflow', async () => {
    const fx = await admitted();
    try {
      const result = await handleWonderlandMissionStartRoute(startRequest(), fx.ports, fx.deps);
      expect(result?.status).toBe(202);
      expect(result?.body).toEqual({ wljRunId: RUN, state: 'dispatched', workflowRunId: WORKFLOW_RUN, dispatchedAt: WHEN, replayed: false });
      expect(fx.claims).toEqual([fx.storePath]);
      const runs = workflowRuns(fx.gh.calls);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toEqual(expect.arrayContaining(['-f', 'lane=lab', '-f', `mission=${MISSION}`, '-f', 'confirm_live=RUN LIVE MISSION', '--ref', 'main']));
      expect(JSON.stringify(result?.body)).not.toMatch(/gh |--repo|admission\.json|token/u);
    } finally {
      fx.cleanup();
    }
  });

  it('a repeat, with any start key, replays the recorded run and never runs gh again', async () => {
    const fx = await admitted();
    try {
      expect((await handleWonderlandMissionStartRoute(startRequest(), fx.ports, fx.deps))?.status).toBe(202);
      const before = fx.gh.calls.length;
      for (const key of [START_KEY, '12345678-1234-4234-8234-123456789abc']) {
        const again = await handleWonderlandMissionStartRoute(startRequest({ idempotencyKey: key }), fx.ports, fx.deps);
        expect(again?.status).toBe(200);
        expect(again?.body).toEqual({ wljRunId: RUN, state: 'dispatched', workflowRunId: WORKFLOW_RUN, dispatchedAt: WHEN, replayed: true });
      }
      expect(fx.gh.calls.length).toBe(before);
    } finally {
      fx.cleanup();
    }
  });

  it('two Starts at once: one dispatches, the other replays', async () => {
    const fx = await admitted();
    try {
      const [a, b] = await Promise.all([
        handleWonderlandMissionStartRoute(startRequest(), fx.ports, fx.deps),
        handleWonderlandMissionStartRoute(startRequest({ idempotencyKey: '12345678-1234-4234-8234-123456789abc' }), fx.ports, fx.deps),
      ]);
      expect([a?.status, b?.status].sort()).toEqual([200, 202]);
      expect(workflowRuns(fx.gh.calls)).toHaveLength(1);
      const claims = readAdmissionDocument(fx.storePath).claims.filter((event) => event.state === 'dispatched');
      expect(claims).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  it('two bridges on one file (separate claim cores) still dispatch once', async () => {
    const fx = await admitted();
    try {
      const second = fakeGh();
      const other = createOperatorClaimTool(openAdmissionFile(fx.storePath), second.spawn, { nowIso: () => WHEN });
      const [a, b] = await Promise.all([
        handleWonderlandMissionStartRoute(startRequest(), fx.ports, fx.deps),
        handleWonderlandMissionStartRoute(startRequest(), fx.ports, { claimTool: () => other }),
      ]);
      expect([a?.status, b?.status].filter((status) => status === 202)).toHaveLength(1);
      expect(workflowRuns(fx.gh.calls).length + workflowRuns(second.calls).length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  it('refuses without the founder\'s explicit confirmation, and calls no claim', async () => {
    const fx = await admitted();
    try {
      for (const rawBody of [
        startBody({ confirm: undefined }),
        startBody({ confirm: 'run live mission' }),
        startBody({ confirm: 'RUN LIVE MISSION ' }),
        startBody({ wljRunId: 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
        startBody({ clientTriggerId: undefined }),
        'not json',
      ]) {
        const result = await handleWonderlandMissionStartRoute(startRequest({ rawBody }), fx.ports, fx.deps);
        expect(result?.status, rawBody).toBe(400);
      }
      const missingKey = await handleWonderlandMissionStartRoute(startRequest({ idempotencyKey: undefined }), fx.ports, fx.deps);
      expect(kind(missingKey?.body)).toBe('julius_start_idempotency_key_invalid');
      const get = await handleWonderlandMissionStartRoute(startRequest({ method: 'GET' }), fx.ports, fx.deps);
      expect(get?.status).toBe(405);
      expect(fx.claims).toEqual([]);
      expect(fx.gh.calls).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  it('refuses anyone but the paired founder on this machine, and calls no claim', async () => {
    const fx = await admitted();
    try {
      const refusals: Array<[Partial<WonderlandAdmissionRouteRequest>, number]> = [
        [{ authorization: undefined }, 401],
        [{ authorization: 'Relay-Session bogus' }, 401],
        [{ authorization: 'Bearer operator-token' }, 403],
        [{ authorization: 'Relay-Session other-token' }, 403],
        [{ origin: 'https://sunday-relay.vercel.app' }, 403],
        [{ remoteAddress: '10.0.0.5' }, 403],
        [{ forwarded: true }, 403],
        [{ url: `${START_PATH}?projectId=project-2` }, 403],
      ];
      for (const [over, status] of refusals) {
        const result = await handleWonderlandMissionStartRoute(startRequest(over), fx.ports, fx.deps);
        expect(result?.status, JSON.stringify(over)).toBe(status);
      }
      const otherRun = 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      const path = `/wonderland/julius/missions/${otherRun}/start`;
      const unknown = await handleWonderlandMissionStartRoute(
        startRequest({ path, url: `${path}?projectId=${PROJECT}`, rawBody: startBody({ wljRunId: otherRun }) }), fx.ports, fx.deps);
      expect(unknown?.status).toBe(404);
      expect(fx.claims).toEqual([]);
      expect(fx.gh.calls).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  it('is off unless JULIUS_WONDERLAND_START=1, and needs the repository and lane on the bridge', async () => {
    for (const [over, expected] of [
      [{ JULIUS_WONDERLAND_START: undefined }, 'julius_start_disabled'],
      [{ JULIUS_WONDERLAND_START: 'true' }, 'julius_start_disabled'],
      [{ JULIUS_WONDERLAND_GITHUB_REPO: undefined }, 'julius_start_not_configured'],
      [{ JULIUS_WONDERLAND_START_LANE: undefined }, 'julius_start_not_configured'],
      [{ JULIUS_WONDERLAND_START_LANE: 'paid' }, 'julius_start_not_configured'],
    ] as const) {
      const fx = await admitted(over);
      try {
        const result = await handleWonderlandMissionStartRoute(startRequest(), fx.ports, fx.deps);
        expect(result?.status, expected).toBe(503);
        expect(kind(result?.body)).toBe(expected);
        expect(fx.gh.calls).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }
  });

  it('an expired admission is refused and never dispatched', async () => {
    const late = new Date(Date.parse(WHEN) + 7 * 60 * 60 * 1000).toISOString();
    const fx = await admitted({}, () => late);
    try {
      const result = await handleWonderlandMissionStartRoute(startRequest({ nowIso: late, nowMs: Date.parse(late) }), fx.ports, fx.deps);
      expect(result?.status).toBe(409);
      expect(kind(result?.body)).toBe('AWAITING_OPERATOR_EXPIRED');
      expect((result?.body as { retry?: boolean }).retry).toBe(false);
      expect(workflowRuns(fx.gh.calls)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});
