import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AdmissionState } from '../src/relay/integration/wonderland-admission/admission-store';
import { noteAwaitingOperatorExpiry, readAdmissionDocument, type DispatchError, type OperatorClaimState, type WorkflowHalt } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  AWAITING_OPERATOR_WINDOW_MS,
  WONDERLAND_STATUS_CAUSES,
  WONDERLAND_STATUS_STATES,
  WONDERLAND_STATUS_TERMINAL_STATES,
  isWonderlandStatusTerminal,
  wonderlandStatusStateFromAdmission,
  type WonderlandStatusCause,
  type WonderlandStatusState,
} from '../src/relay/integration/wonderland-admission';
import {
  createWonderlandAdmissionService,
  handleWonderlandAdmissionRoute,
  handleWonderlandStatusRoute,
  WONDERLAND_ADMISSION_PATH,
  WONDERLAND_STATUS_PATH,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import { classifyWonderlandDispatchPath, isWonderlandRoute } from './wonderland-routes';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const KEY = '11111111-2222-4333-8444-555555555555';
const WHEN = '2026-10-23T17:18:00.000Z';
const LOG = 'ab'.repeat(32);
const PROJECT = 'project-1';
const SERVER = RUN;
const SPENT = 'julius-run-spent-0b7a1c2e4f3d4a6b8c2d3e4f5a6b7c8d';
const NOT_FOUND = { status: 404, body: { error: { kind: 'not_found', message: 'Not found.' } } };

function env(storePath: string): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_WONDERLAND_MISSION: 'julius-inworld-data-1',
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
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

function admitRequest(extra: Record<string, unknown> = {}): WonderlandAdmissionRouteRequest {
  return {
    method: 'POST',
    path: WONDERLAND_ADMISSION_PATH,
    url: `${WONDERLAND_ADMISSION_PATH}?projectId=${PROJECT}`,
    authorization: 'Relay-Session native-token',
    origin: undefined,
    rawBody: JSON.stringify({
      runId: RUN,
      clientTriggerId: 'trigger_01',
      clientLogSha256: LOG,
      clientUiActionUtc: WHEN,
      ...extra,
    }),
    idempotencyKey: KEY,
    remoteAddress: '127.0.0.1',
    host: 'localhost',
    forwarded: false,
    nowIso: WHEN,
    nowMs: Date.parse(WHEN),
  };
}

function statusRequest(runId: string, over: Partial<WonderlandAdmissionRouteRequest> = {}): WonderlandAdmissionRouteRequest {
  const path = `${WONDERLAND_STATUS_PATH}?projectId=${PROJECT}&runId=${encodeURIComponent(runId)}`;
  return {
    method: 'GET',
    path: WONDERLAND_STATUS_PATH,
    url: path,
    authorization: 'Relay-Session native-token',
    origin: undefined,
    rawBody: undefined,
    idempotencyKey: undefined,
    remoteAddress: '127.0.0.1',
    host: 'localhost',
    forwarded: false,
    nowIso: WHEN,
    nowMs: Date.parse(WHEN),
    ...over,
  };
}

describe('wonderland status', () => {
  it('a queried status pathname is status, and a slash or other case is the catch-all', () => {
    const queried = `${WONDERLAND_STATUS_PATH}?projectId=${PROJECT}&runId=${encodeURIComponent(SERVER)}`;
    expect(isWonderlandRoute(queried)).toBe(false);
    expect(classifyWonderlandDispatchPath(WONDERLAND_STATUS_PATH, queried)).toEqual({
      catchAllPath: null,
      exactAdmission: false,
      exactStatus: true,
      exactCompanion: false,
    });
    for (const raw of [
      `${WONDERLAND_STATUS_PATH}/?projectId=${PROJECT}`,
      `/Wonderland/Julius/Status?projectId=${PROJECT}`,
      `${WONDERLAND_STATUS_PATH}/x?projectId=${PROJECT}`,
    ]) {
      const classified = classifyWonderlandDispatchPath(raw.split('?')[0].replace(/\/+$/, '') || '/', raw);
      expect(classified.exactStatus, raw).toBe(false);
      expect(classified.catchAllPath, raw).not.toBeNull();
    }
  });

  it('returns the held pair after a restart, and a replay keeps that server run id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    try {
      const first = service(storePath);
      const created = await handleWonderlandAdmissionRoute(admitRequest(), first);
      expect(created?.status).toBe(202);
      const held = readFileSync(storePath, 'utf8');
      first.close();
      const restarted = service(storePath);
      const replay = await handleWonderlandAdmissionRoute(admitRequest(), restarted);
      expect(replay?.status).toBe(200);
      const replayBody = replay?.body as { data?: { serverRunId?: string; state?: string; dispatched?: boolean } };
      expect(replayBody.data?.serverRunId).toBe(SERVER);
      expect(replayBody.data?.state).toBe('ADMISSION_HELD');
      expect(replayBody.data?.dispatched).toBe(false);
      const status = await handleWonderlandStatusRoute(statusRequest(SERVER), restarted);
      expect(status).toEqual({
        status: 200,
        body: {
          wljRunId: RUN,
          serverRunId: SERVER,
          legacyRunId: null,
          dispatchedAt: null,
          workflowRunId: null,
          state: 'awaiting_operator',
          updatedAt: WHEN,
        },
      });
      expect(readAdmissionDocument(storePath).claims).toEqual([]);
      expect(readFileSync(storePath, 'utf8')).toBe(held);
      restarted.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('awaiting_operator is open on the last millisecond, and an expired read stays final', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    try {
      const admitted = service(storePath);
      await handleWonderlandAdmissionRoute(admitRequest(), admitted);
      admitted.close();
      const ports = service(storePath);
      const acceptedAtMs = Date.parse(WHEN);
      const before = readFileSync(storePath, 'utf8');
      const journalPath = `${storePath}.operator.json`;
      const journalBefore = readFileSync(journalPath, 'utf8');
      const open = await handleWonderlandStatusRoute(
        statusRequest(SERVER, { nowMs: acceptedAtMs + AWAITING_OPERATOR_WINDOW_MS }),
        ports,
      );
      expect(open?.body).toEqual({
        wljRunId: RUN,
        serverRunId: SERVER,
        legacyRunId: null,
        dispatchedAt: null,
          workflowRunId: null,
        state: 'awaiting_operator',
        updatedAt: WHEN,
      });
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      expect(readFileSync(journalPath, 'utf8')).toBe(journalBefore);
      const expiredAtMs = acceptedAtMs + AWAITING_OPERATOR_WINDOW_MS + 1;
      const poisoned = `${WONDERLAND_STATUS_PATH}?projectId=${PROJECT}&runId=${encodeURIComponent(SERVER)}&now=${encodeURIComponent(WHEN)}&nowMs=0`;
      const closed = await handleWonderlandStatusRoute(statusRequest(SERVER, {
        nowMs: expiredAtMs,
        url: poisoned,
        rawBody: JSON.stringify({ nowIso: WHEN, nowMs: 0 }),
      }), ports);
      const expiredBody = {
        wljRunId: RUN,
        serverRunId: SERVER,
        legacyRunId: null,
        dispatchedAt: null,
          workflowRunId: null,
        state: 'failed',
        cause: 'AWAITING_OPERATOR_EXPIRED',
        updatedAt: new Date(expiredAtMs).toISOString(),
      };
      expect(closed?.body).toEqual(expiredBody);
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      expect(readAdmissionDocument(storePath).claims).toEqual([]);
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        revision: number;
        claims: unknown[];
        progress: unknown[];
        owners: Record<string, string>;
      };
      expect(journal.claims).toEqual([]);
      expect(journal.owners[SERVER]).toBe('founder');
      expect(journal.revision).toBe(1);
      expect(journal.progress).toEqual([{
        serverRunId: SERVER,
        state: 'failed',
        cause: 'AWAITING_OPERATOR_EXPIRED',
        updatedAt: new Date(expiredAtMs).toISOString(),
      }]);
      const again = await handleWonderlandStatusRoute(statusRequest(SERVER, { nowMs: Date.parse(WHEN) }), ports);
      expect(again?.body).toEqual(expiredBody);
      expect(JSON.parse(readFileSync(journalPath, 'utf8')).progress).toHaveLength(1);
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a planted expiry note is failed while the row stays held and the clock is still open', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    const notedAt = '2026-10-23T17:18:01.000Z';
    try {
      const admitted = service(storePath);
      await handleWonderlandAdmissionRoute(admitRequest(), admitted);
      admitted.close();
      const before = readFileSync(storePath, 'utf8');
      expect(JSON.parse(before).rows[0].state).toBe('ADMISSION_HELD');
      noteAwaitingOperatorExpiry(storePath, SERVER, notedAt);
      const journalPath = `${storePath}.operator.json`;
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { revision: number; progress: unknown[] };
      journal.progress.push({
        serverRunId: SERVER,
        state: 'held',
        cause: 'still_open',
        updatedAt: '2026-10-23T17:19:00.000Z',
      });
      journal.revision += 1;
      writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
      const ports = service(storePath);
      const status = await handleWonderlandStatusRoute(statusRequest(SERVER, { nowMs: Date.parse(WHEN) }), ports);
      expect(status?.status).toBe(200);
      expect(status?.body).toMatchObject({
        state: 'failed',
        cause: 'AWAITING_OPERATOR_EXPIRED',
        updatedAt: notedAt,
        serverRunId: SERVER,
      });
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      expect(JSON.parse(before).rows[0].state).toBe('ADMISSION_HELD');
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('HTTP dispatch refuses a replay once the expiry note is stored', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    const notedAt = '2026-10-23T17:18:01.000Z';
    try {
      const admitted = service(storePath);
      const created = await handleWonderlandAdmissionRoute(admitRequest(), admitted);
      expect(created?.status).toBe(202);
      admitted.close();
      const before = readFileSync(storePath, 'utf8');
      expect(JSON.parse(before).rows[0].state).toBe('ADMISSION_HELD');
      noteAwaitingOperatorExpiry(storePath, SERVER, notedAt);
      const journalBefore = readFileSync(`${storePath}.operator.json`, 'utf8');
      const ports = service(storePath);
      const replay = await handleWonderlandAdmissionRoute(admitRequest({
        workflowRunId: '4242424242',
        nowIso: WHEN,
      }), ports);
      expect(replay?.status).toBe(409);
      expect(replay?.body).toEqual({
        error: {
          kind: 'AWAITING_OPERATOR_EXPIRED',
          message: 'The held phase expired. The admission was not dispatched.',
        },
      });
      expect(JSON.stringify(replay?.body)).not.toContain('4242424242');
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      expect(readFileSync(`${storePath}.operator.json`, 'utf8')).toBe(journalBefore);
      expect(JSON.parse(before).rows[0].state).toBe('ADMISSION_HELD');
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a caller workflowRunId on the dispatch body is not stored', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    try {
      const admitted = service(storePath);
      const created = await handleWonderlandAdmissionRoute(admitRequest({ workflowRunId: '4242424242' }), admitted);
      expect(created?.status).toBe(202);
      expect(JSON.stringify(created?.body)).not.toContain('4242424242');
      expect(JSON.stringify(created?.body)).not.toContain('workflowRunId');
      const admission = readFileSync(storePath, 'utf8');
      const journal = readFileSync(`${storePath}.operator.json`, 'utf8');
      expect(admission).not.toContain('4242424242');
      expect(admission).not.toContain('workflowRunId');
      expect(journal).not.toContain('4242424242');
      expect(journal).not.toContain('workflowRunId');
      expect(readAdmissionDocument(storePath).claims).toEqual([]);
      admitted.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a recorded dispatch keeps a later INTERRUPTED or FAILED progress note off the answer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    try {
      const admitted = service(storePath);
      await handleWonderlandAdmissionRoute(admitRequest(), admitted);
      admitted.close();
      const ports = service(storePath);
      const journalPath = `${storePath}.operator.json`;
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        schemaVersion: number;
        revision: number;
        claims: unknown[];
        progress: unknown[];
        owners: Record<string, string>;
      };
      const admissionBytes = readFileSync(storePath, 'utf8');
      journal.claims = [{
        wonderlandRunId: RUN,
        serverRunId: SERVER,
        state: 'dispatched',
        spentTag: SPENT,
        spentTagState: 'absent',
        at: WHEN,
        dispatchAttempted: true,
        dispatchError: null,
        halt: null,
      }];
      for (const state of ['interrupted', 'failed'] as const) {
        journal.progress = [{
          serverRunId: SERVER,
          state,
          cause: state,
          updatedAt: '2026-10-23T18:00:00.000Z',
        }];
        writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
        const status = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
        expect(status?.body, state).toMatchObject({
          state: 'dispatched',
          serverRunId: SERVER,
          legacyRunId: null,
          dispatchedAt: WHEN,
          workflowRunId: null,
          updatedAt: WHEN,
        });
        expect(status?.body, state).not.toHaveProperty('cause');
        expect(readFileSync(storePath, 'utf8')).toBe(admissionBytes);
      }
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a different player, a malformed run id, and an unknown run id are one 404 and write nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    try {
      const admitted = service(storePath);
      await handleWonderlandAdmissionRoute(admitRequest(), admitted);
      admitted.close();
      const ports = service(storePath);
      const before = readFileSync(storePath, 'utf8');
      const malformed = await handleWonderlandStatusRoute(statusRequest('not-a-run'), ports);
      const unknown = await handleWonderlandStatusRoute(statusRequest(`run:${'b'.repeat(24)}`), ports);
      const otherWlj = await handleWonderlandStatusRoute(
        statusRequest('wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
        ports,
      );
      const found = await handleWonderlandStatusRoute(statusRequest(RUN), ports);
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      const journalPath = `${storePath}.operator.json`;
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { owners: Record<string, string> };
      journal.owners[SERVER] = 'other-player';
      writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
      const ownedBySomeoneElse = readFileSync(journalPath, 'utf8');
      const otherOwner = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
      expect(found?.status).toBe(200);
      expect(found?.body).toMatchObject({ wljRunId: RUN, serverRunId: RUN, legacyRunId: null, workflowRunId: null });
      expect(malformed).toEqual(NOT_FOUND);
      expect(unknown).toEqual(NOT_FOUND);
      expect(otherWlj).toEqual(NOT_FOUND);
      expect(otherOwner).toEqual(NOT_FOUND);
      expect(JSON.stringify(malformed)).toBe(JSON.stringify(unknown));
      expect(JSON.stringify(unknown)).toBe(JSON.stringify(otherOwner));
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      expect(readFileSync(journalPath, 'utf8')).toBe(ownedBySomeoneElse);
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps an unknown stored progress token to unknown and drops its cause', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    try {
      const admitted = service(storePath);
      await handleWonderlandAdmissionRoute(admitRequest(), admitted);
      admitted.close();
      const ports = service(storePath);
      const held = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
      expect(held?.body).toMatchObject({ state: 'awaiting_operator' });
      writeProgress(storePath, 'providers_running', 'watch');
      const before = readFileSync(storePath, 'utf8');
      const running = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
      expect(running).toEqual({
        status: 200,
        body: {
          wljRunId: RUN,
          serverRunId: SERVER,
          legacyRunId: null,
          dispatchedAt: null,
          workflowRunId: null,
          state: 'unknown',
          updatedAt: '2026-10-23T18:00:00.000Z',
        },
      });
      expect(running?.body).not.toHaveProperty('cause');
      expect(JSON.stringify(running?.body)).not.toContain('providers_running');
      expect(JSON.stringify(running?.body)).not.toContain('watch');
      expect(readFileSync(storePath, 'utf8')).toBe(before);
      expect(isWonderlandStatusTerminal('unknown')).toBe(false);
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is exhaustive over the closed status state and cause unions', async () => {
    expect(WONDERLAND_STATUS_STATES.map(coverStatusState)).toEqual([...WONDERLAND_STATUS_STATES]);
    expect(WONDERLAND_STATUS_CAUSES.map(coverStatusCause)).toEqual([...WONDERLAND_STATUS_CAUSES]);

    const admissionStatus: Record<AdmissionState, WonderlandStatusState> = {
      RESERVED: 'reserved',
      ADMISSION_HELD: 'held',
      LEDGER_UNWRITTEN: 'ledger_unwritten',
      INTERRUPTED: 'interrupted',
      FAILED: 'failed',
    };
    const claimStatus: Record<OperatorClaimState, WonderlandStatusState> = {
      dispatched: 'dispatched',
      dispatch_failed: 'dispatch_failed',
      already_spent: 'already_spent',
    };
    const writerCauses: Record<WorkflowHalt | DispatchError, WonderlandStatusCause> = {
      RUN_ID_ALREADY_SPENT: 'RUN_ID_ALREADY_SPENT',
      SPENT_TAG_UNVERIFIED: 'SPENT_TAG_UNVERIFIED',
      gh_workflow_run_failed: 'gh_workflow_run_failed',
    };
    const clockCauses: readonly WonderlandStatusCause[] = ['AWAITING_OPERATOR_EXPIRED'];
    for (const [stored, state] of Object.entries(admissionStatus) as Array<[AdmissionState, WonderlandStatusState]>) {
      expect(wonderlandStatusStateFromAdmission(stored)).toBe(state);
    }
    const writerStates = new Set<WonderlandStatusState>([
      ...Object.values(admissionStatus),
      ...Object.values(claimStatus),
      'awaiting_operator',
    ]);
    expect([...WONDERLAND_STATUS_STATES].filter((state) => state !== 'unknown').sort()).toEqual([...writerStates].sort());
    expect([...Object.values(writerCauses), ...clockCauses].sort()).toEqual([...WONDERLAND_STATUS_CAUSES].sort());
    expect(new Set(WONDERLAND_STATUS_STATES.filter(isWonderlandStatusTerminal))).toEqual(new Set(WONDERLAND_STATUS_TERMINAL_STATES));
    expect(WONDERLAND_STATUS_TERMINAL_STATES).not.toContain('unknown');

    const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
    const storePath = join(dir, 'admission.json');
    try {
      const admitted = service(storePath);
      await handleWonderlandAdmissionRoute(admitRequest(), admitted);
      admitted.close();
      const ports = service(storePath);
      for (const state of WONDERLAND_STATUS_STATES) {
        writeProgress(storePath, state, state === 'unknown' ? 'RUN_ID_ALREADY_SPENT' : null);
        const before = readFileSync(storePath, 'utf8');
        const status = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
        expect(status, state).toEqual({
          status: 200,
          body: {
            wljRunId: RUN,
            serverRunId: SERVER,
            legacyRunId: null,
            dispatchedAt: null,
          workflowRunId: null,
            state,
            updatedAt: '2026-10-23T18:00:00.000Z',
          },
        });
        expect(status?.body, state).not.toHaveProperty('cause');
        expect(readFileSync(storePath, 'utf8')).toBe(before);
      }
      for (const cause of WONDERLAND_STATUS_CAUSES) {
        writeProgress(storePath, 'dispatch_failed', cause);
        const before = readFileSync(storePath, 'utf8');
        const status = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
        expect(status, cause).toEqual({
          status: 200,
          body: {
            wljRunId: RUN,
            serverRunId: SERVER,
            legacyRunId: null,
            dispatchedAt: null,
          workflowRunId: null,
            state: 'dispatch_failed',
            cause,
            updatedAt: '2026-10-23T18:00:00.000Z',
          },
        });
        expect(readFileSync(storePath, 'utf8')).toBe(before);
      }
      writeProgress(storePath, 'dispatched', 'not_a_cause');
      const badCause = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
      expect(badCause?.body).toEqual({
        wljRunId: RUN,
        serverRunId: SERVER,
        legacyRunId: null,
        dispatchedAt: null,
        workflowRunId: null,
        state: 'unknown',
        updatedAt: '2026-10-23T18:00:00.000Z',
      });
      expect(badCause?.body).not.toHaveProperty('cause');

      const journalPath = `${storePath}.operator.json`;
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { progress: unknown[]; claims: unknown[] };
      journal.progress = [];
      journal.claims = [];
      const cleared = `${JSON.stringify(journal)}\n`;
      writeFileSync(journalPath, cleared);
      const admissionBytes = readFileSync(storePath, 'utf8');
      expect(JSON.parse(admissionBytes)).toMatchObject({ schemaVersion: 3 });
      expect(JSON.parse(admissionBytes)).not.toHaveProperty('claims');
      const fromRow = await handleWonderlandStatusRoute(statusRequest(SERVER), ports);
      expect(fromRow?.body).toMatchObject({ state: 'awaiting_operator', updatedAt: WHEN });
      expect(fromRow?.body).not.toHaveProperty('cause');
      expect(readFileSync(storePath, 'utf8')).toBe(admissionBytes);
      expect(readFileSync(journalPath, 'utf8')).toBe(cleared);

      const learned = '36568129865';
      const withClaim = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        schemaVersion: number;
        revision: number;
        claims: Array<Record<string, unknown>>;
        owners: Record<string, string>;
        progress: unknown[];
      };
      withClaim.claims = [{
        wonderlandRunId: RUN,
        serverRunId: SERVER,
        state: 'dispatched',
        spentTag: SPENT,
        spentTagState: 'absent',
        at: WHEN,
        dispatchAttempted: true,
        dispatchError: null,
        halt: null,
      }];
      withClaim.progress = [];
      writeFileSync(journalPath, `${JSON.stringify(withClaim)}\n`);
      const omitted = await handleWonderlandStatusRoute(statusRequest(RUN), ports);
      expect(omitted?.status).toBe(200);
      expect(omitted?.body).toMatchObject({ state: 'dispatched', workflowRunId: null });
      withClaim.claims[0] = { ...withClaim.claims[0], workflowRunId: learned };
      writeFileSync(journalPath, `${JSON.stringify(withClaim)}\n`);
      const known = await handleWonderlandStatusRoute(statusRequest(RUN), ports);
      expect(known?.body).toMatchObject({
        wljRunId: RUN,
        serverRunId: RUN,
        workflowRunId: learned,
        state: 'dispatched',
      });
      const beforeBad = readFileSync(journalPath, 'utf8');
      withClaim.claims[0] = { ...withClaim.claims[0], workflowRunId: '0' };
      writeFileSync(journalPath, `${JSON.stringify(withClaim)}\n`);
      const bad = await handleWonderlandStatusRoute(statusRequest(RUN), ports);
      expect(bad?.status).toBe(503);
      expect(readFileSync(storePath, 'utf8')).toBe(admissionBytes);
      expect(readFileSync(journalPath, 'utf8')).toBe(`${JSON.stringify(withClaim)}\n`);
      expect(readFileSync(journalPath, 'utf8')).not.toBe(beforeBad);
      ports.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Compile-time exhaustiveness: a new union member fails this switch. */
function coverStatusState(state: WonderlandStatusState): WonderlandStatusState {
  switch (state) {
    case 'held':
    case 'reserved':
    case 'awaiting_operator':
    case 'ledger_unwritten':
    case 'interrupted':
    case 'failed':
    case 'dispatched':
    case 'dispatch_failed':
    case 'already_spent':
    case 'unknown':
      return state;
    default: {
      const leftover: never = state;
      return leftover;
    }
  }
}

/** Compile-time exhaustiveness: a new union member fails this switch. */
function coverStatusCause(cause: WonderlandStatusCause): WonderlandStatusCause {
  switch (cause) {
    case 'RUN_ID_ALREADY_SPENT':
    case 'SPENT_TAG_UNVERIFIED':
    case 'gh_workflow_run_failed':
    case 'AWAITING_OPERATOR_EXPIRED':
      return cause;
    default: {
      const leftover: never = cause;
      return leftover;
    }
  }
}

function writeProgress(storePath: string, state: string, cause: string | null): void {
  const journalPath = `${storePath}.operator.json`;
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    schemaVersion: number;
    revision: number;
    claims: unknown[];
    owners: Record<string, string>;
  };
  writeFileSync(journalPath, `${JSON.stringify({
    schemaVersion: journal.schemaVersion,
    revision: journal.revision + 1,
    claims: journal.claims,
    owners: journal.owners,
    progress: [{
      serverRunId: SERVER,
      state,
      cause,
      updatedAt: '2026-10-23T18:00:00.000Z',
    }],
  })}\n`);
}
