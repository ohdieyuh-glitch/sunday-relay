import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleCronRoute, type CronRouteRequest } from './cron-routes';
import { createCronTickService, type CronTickService } from './cron-service';
import { loopDigest, readLoopRun } from '../src/relay/mission/loop/runtime';

/**
 * THE CRON TICK ENDPOINT, through the real handler and a real state root.
 *
 * What is tested is the endpoint's refusals and its ONE positive claim: a
 * tick creates durable Loop run RECORDS and dispatches nothing. Every gate
 * is asserted to have touched no disk, because "the flag was off" and "the
 * flag was off but we claimed three occurrences first" are the same status
 * code and completely different facts.
 */

const TOKEN = 'operator-token-for-cron-tests';
const T0 = '2026-08-06T12:00:30.000Z';
const ENABLED = {
  RELAY_BRIDGE_API_TOKEN: TOKEN,
  RELAY_LOOP_ENGINE_ENABLED: '1',
  RELAY_LOOP_CRON_ENABLED: '1',
} as NodeJS.ProcessEnv;

let root: string;
let service: CronTickService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-cron-route-'));
  service = createCronTickService({ root, now: () => T0 });
  service.schedules.create('sched-triage', STORED);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const BODY = {
  authorized: true,
  scheduleId: 'sched-triage',
  afterExclusive: '2026-08-06T09:00:00.000Z',
  maxOccurrences: 20,
  missedPolicy: 'run_all_with_limit',
  maxCatchUpRuns: 10,
  workClass: 'read_only',
  overlapPolicy: 'parallel_with_limit',
  parallelLimit: 5,
  binding: { projectId: 'prj_cron', workspaceId: null, loopId: 'lpe_cron' },
};

/** The schedule the tick reads. Stored, not asserted by the request. */
const STORED = {
  version: 1,
  cronExpression: '0 * * * *',
  timeZone: 'UTC',
  contractRef: 'contract-ref',
  contractBindingDigest: 'digest-1',
  authoredBy: 'founder',
  authoredAt: '2026-08-01T10:00:00.000Z',
};

function call(
  body: unknown = BODY,
  overrides: Partial<CronRouteRequest> = {},
  ticks: CronTickService | null = service,
) {
  const request: CronRouteRequest = {
    method: 'POST',
    path: '/cron/tick',
    authorization: `Bearer ${TOKEN}`,
    body,
    env: ENABLED,
    now: T0,
    authorize: () => ({ kind: 'operator', principal: 'operator' }),
    ...overrides,
  };
  return handleCronRoute(request, ticks);
}

const occurrenceDir = (): string => join(root, 'cron-occurrences');
const errorOf = (result: Awaited<ReturnType<typeof call>>) =>
  (result?.body as { error: { kind: string; message: string } }).error;
const dataOf = (result: Awaited<ReturnType<typeof call>>) =>
  (result?.body as { data: Record<string, unknown> }).data;

describe('a tick creates records and dispatches nothing', () => {
  it('creates one durable run per due occurrence, all marked schedule-created', async () => {
    const result = await call();
    expect(result?.status).toBe(200);
    const data = dataOf(result);
    // 10:00, 11:00 and 12:00 are due against a 09:00 exclusive start.
    expect(data.runsCreated).toBe(3);
    expect(data.duplicates).toBe(0);
    expect(data.claimedWithoutRun).toBe(0);
    // A LITERAL claim about the code path, not a count of something observed.
    expect(data.dispatched).toBe(0);
    expect(String(data.note)).toContain('NOT advanced');

    const occurrences = data.occurrences as { outcome: string; journalRecorded?: boolean }[];
    expect(occurrences.map((o) => o.outcome)).toEqual(['run_created', 'run_created', 'run_created']);
    expect(occurrences.every((o) => o.journalRecorded === true)).toBe(true);

    // The runs exist on disk and say WHERE they came from.
    const runIds = service.store.runIdsForLoop('lpe_cron') ?? [];
    expect(runIds).toHaveLength(3);
    for (const runId of runIds) {
      const loaded = readLoopRun(service.store, runId, loopDigest);
      expect(loaded?.run?.creationSource).toBe('schedule');
    }
  });

  it('the window END is the SERVER clock, never the body', async () => {
    // A body that asks for a window reaching into next week gets the
    // server's own instant instead — so the tick's future_window refusal is
    // structurally unreachable from this route rather than merely unlikely.
    const result = await call({ ...BODY, untilInclusive: '2026-08-20T00:00:00.000Z' });
    expect(result?.status).toBe(200);
    const window = dataOf(result).window as { untilInclusive: string };
    expect(window.untilInclusive).toBe(T0);
    expect(dataOf(result).evaluatedAt).toBe(T0);
  });

  it('a SECOND identical tick creates nothing — every occurrence already handled', async () => {
    await call();
    const again = await call();
    expect(again?.status).toBe(200);
    const data = dataOf(again);
    expect(data.runsCreated).toBe(0);
    expect((data.occurrences as { outcome: string }[]).every((o) => o.outcome === 'already_handled'))
      .toBe(true);
    expect(service.store.runIdsForLoop('lpe_cron')).toHaveLength(3);
  });

  it('within one tick, a created run counts against the limit for the next occurrence', async () => {
    const result = await call({ ...BODY, parallelLimit: 1 });
    expect(result?.status).toBe(200);
    expect(dataOf(result).runsCreated).toBe(1);
    expect((dataOf(result).occurrences as { outcome: string }[]).map((o) => o.outcome))
      .toEqual(['run_created', 'skipped_by_capacity_unclaimed', 'skipped_by_capacity_unclaimed']);
    // …and the run it created is QUEUED, not executing, so it occupies no
    // execution slot in the journal-derived count. Nothing in this build
    // advances a scheduled run, so counting it as occupancy would saturate
    // the count forever — see the no-wedge test below.
    expect(service.activeRunsFor('lpe_cron')).toBe(0);
  });

  it('the overlap count is DERIVED — a caller claiming runs are live cannot stop its own tick', async () => {
    // Mutation check: reading `activeRuns` from the request body makes this
    // fail — a claimed 99 against a limit of 1 would refuse the first
    // occurrence. Derived, the journal says zero and the run is created.
    const result = await call({ ...BODY, parallelLimit: 1, activeRuns: 99 });
    expect(result?.status).toBe(200);
    expect(dataOf(result).runsCreated).toBe(1);
  });

  it('a SECOND tick still creates runs — a created-but-unstarted run must not wedge the endpoint', async () => {
    // THE DEFECT THIS PINS, found by review and reproduced across three
    // ticks: a scheduled run is created `queued` and nothing in this build
    // ever advances it. Counting `queued` as occupancy saturated the overlap
    // count at the first tick and never came down, so every later occurrence
    // hit the limit forever — and under `skip` each one was DURABLY CLAIMED
    // with no run behind it, silently consuming occurrences that the claim
    // marker then refuses to replay. Mutation check: counting `queued` as
    // active fails this.
    const first = await call();
    expect(dataOf(first).runsCreated).toBe(3);

    // A later window with three FRESH occurrences, under a limit the first
    // tick's runs would exhaust if they counted as executing.
    const later = await call(
      { ...BODY, afterExclusive: '2026-08-06T12:00:00.000Z', parallelLimit: 3 },
      { now: '2026-08-06T15:00:30.000Z' },
    );
    expect(later?.status).toBe(200);
    expect(dataOf(later).runsCreated).toBe(3);
    const outcomes = (dataOf(later).occurrences as { outcome: string }[]).map((o) => o.outcome);
    expect(outcomes).toEqual(['run_created', 'run_created', 'run_created']);
    // No occurrence was claimed without a run behind it.
    expect(dataOf(later).claimedWithoutRun).toBe(0);
  });

  it('two projects using ONE schedule id do not suppress each other', async () => {
    // The occurrence identity's first term must be globally unique, and
    // nothing allocates one: the id is a caller-supplied string and the claim
    // markers share one flat namespace on the volume. Un-namespaced, the
    // first project to tick durably marked the second's occurrences
    // already-handled — silent cross-tenant suppression, found by review.
    // Mutation check: dropping the binding from the qualified schedule id
    // makes the second project's tick report already_handled for everything.
    const a = await call();
    expect(dataOf(a).runsCreated).toBe(3);

    const b = await call({
      ...BODY,
      binding: { ...BODY.binding, projectId: 'prj_other', loopId: 'lpe_other' },
    });
    expect(b?.status).toBe(200);
    expect(dataOf(b).runsCreated).toBe(3);
    expect((dataOf(b).occurrences as { outcome: string }[])
      .every((o) => o.outcome === 'run_created')).toBe(true);
    // Distinct occurrence identities, so distinct claim markers.
    const idsA = (dataOf(a).occurrences as { occurrenceId: string }[]).map((o) => o.occurrenceId);
    const idsB = (dataOf(b).occurrences as { occurrenceId: string }[]).map((o) => o.occurrenceId);
    expect(idsA.some((id) => idsB.includes(id))).toBe(false);
  });
});

describe('every gate refuses before touching disk', () => {
  it('an unauthenticated call is 401 and evaluates nothing', async () => {
    const result = await call(BODY, { authorize: () => ({ kind: 'none', principal: 'none' }) });
    expect(result?.status).toBe(401);
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('a paired BROWSER is 403 — cron is operator-only', async () => {
    const result = await call(BODY, { authorize: () => ({ kind: 'browser', principal: 'browser' }) });
    expect(result?.status).toBe(403);
    expect(errorOf(result).kind).toBe('authorization_required');
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('the Loop engine flag off is 403, before any body field is read', async () => {
    const result = await call(BODY, { env: { RELAY_BRIDGE_API_TOKEN: TOKEN } });
    expect(errorOf(result).kind).toBe('loop_engine_disabled');
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('the CRON flag off is 403, and claims nothing — the gate is before the disk', async () => {
    // Mutation check: moving the cron gate below the evaluation would leave
    // an occurrence directory behind on a refused tick.
    const result = await call(BODY, {
      env: { RELAY_BRIDGE_API_TOKEN: TOKEN, RELAY_LOOP_ENGINE_ENABLED: '1' },
    });
    expect(result?.status).toBe(403);
    expect(errorOf(result).kind).toBe('cron_disabled');
    expect(errorOf(result).message).toContain('claimed or created');
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('a flag set to a plausible-looking value is still off', async () => {
    for (const value of ['true', 'yes', 'TRUE', '', ' 1']) {
      const result = await call(BODY, {
        env: { RELAY_BRIDGE_API_TOKEN: TOKEN, RELAY_LOOP_ENGINE_ENABLED: '1', RELAY_LOOP_CRON_ENABLED: value },
      });
      expect(errorOf(result).kind, value).toBe('cron_disabled');
    }
  });

  it('no mounted state root is 503, never a claim it cannot mark durably', async () => {
    const result = await call(BODY, {}, null);
    expect(result?.status).toBe(503);
    expect(errorOf(result).kind).toBe('cron_not_ready');
  });

  it('a path that names no operation is 422 even when the state root is missing', async () => {
    // 503 says "this operation exists and the server is temporarily unready",
    // which invites a retry for something that will never exist. Readiness is
    // decided after the operation is recognized, not before.
    const result = await call(BODY, { path: '/cron/nonsense' }, null);
    expect(result?.status).toBe(422);
    expect(errorOf(result).message).toContain('Unknown Cron operation');
  });

  it('reaching the route is not consent — authorized must be explicitly true', async () => {
    for (const authorized of [undefined, false, 'true', 1]) {
      const result = await call({ ...BODY, authorized });
      expect(result?.status, String(authorized)).toBe(403);
      expect(errorOf(result).kind).toBe('authorization_required');
    }
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('a GET, or any other cron path, is refused as an unknown operation', async () => {
    expect(errorOf(await call(BODY, { method: 'GET' })).message).toContain('Unknown Cron operation');
    expect(errorOf(await call(BODY, { path: '/cron/nonsense' })).message)
      .toContain('Unknown Cron operation');
    // …and a real family with the wrong method is still unknown.
    expect(errorOf(await call(BODY, { method: 'DELETE', path: '/cron/schedules' })).message)
      .toContain('Unknown Cron operation');
  });

  it('a path outside the family is not this handler’s business', async () => {
    expect(await call(BODY, { path: '/loop/status/x' })).toBeNull();
  });
});

describe('what the endpoint refuses to promise', () => {
  it('every policy that would CONSUME an occurrence is refused by name', async () => {
    // queue_one/queue_all: no queue to enqueue into. skip: it drops an
    // occurrence because "a run is live", and in this build the live run is
    // an inert record — the drop would be irreversible. Mutation check:
    // putting 'skip' back into SERVABLE_OVERLAP fails this.
    for (const overlapPolicy of ['queue_one', 'queue_all', 'skip']) {
      const result = await call({ ...BODY, overlapPolicy, queueLimit: 3 });
      expect(result?.status, overlapPolicy).toBe(422);
      expect(errorOf(result).kind).toBe('overlap_policy_unservable');
      expect(errorOf(result).message).toContain('never consume an occurrence they did not run');
    }
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('an unknown overlap policy is refused the same way, never silently dispatched', async () => {
    const result = await call({ ...BODY, overlapPolicy: 'improvise' });
    expect(result?.status).toBe(422);
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('a bad cron expression is refused with the FIELD and TOKEN named', async () => {
    // The expression comes from the STORE now, so a bad one has to be stored.
    service.schedules.create('sched-bad', { ...STORED, cronExpression: '99 * * * *' });
    const result = await call({ ...BODY, scheduleId: 'sched-bad' });
    expect(result?.status).toBe(422);
    expect(errorOf(result).message).toContain('is not a minute value');
  });

  it('a cron expression in the REQUEST is REFUSED, not ignored', async () => {
    // Ignoring it let a caller believe a value took effect that never did.
    // Mutation check: dropping the store-owned-field check returns 200 and
    // silently uses the stored expression.
    for (const field of ['cronExpression', 'timeZone', 'contractVersion']) {
      const result = await call({ ...BODY, [field]: field === 'contractVersion' ? 9 : 'x' });
      expect(result?.status, field).toBe(422);
      expect(errorOf(result).kind).toBe('field_owned_by_the_schedule');
      expect(errorOf(result).message).toContain(field);
    }
    for (const field of ['contractRef', 'contractBindingDigest']) {
      const result = await call({ ...BODY, binding: { ...BODY.binding, [field]: 'x' } });
      expect(result?.status, field).toBe(422);
      expect(errorOf(result).message).toContain(`binding.${field}`);
    }
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('an EDIT cannot replay an already-handled window', async () => {
    // Review measured six runs for the same three hours: a new version gave
    // every occurrence a fresh identity and a fresh claim. The window's start
    // is clamped to the governing version's authoredAt, so a version owns
    // only moments after it existed. Mutation check: removing the clamp
    // creates three more runs here.
    const first = await call();
    expect(dataOf(first).runsCreated).toBe(3);

    service.schedules.edit('sched-triage', {
      ...STORED, cronExpression: '0 * * * *', authoredAt: '2026-08-06T12:00:00.000Z',
      contractRef: 'contract-ref-2',
    }, []);

    const second = await call();
    expect(second?.status).toBe(200);
    expect(dataOf(second).runsCreated).toBe(0);
    // …and the window it actually evaluated starts at the new version, not
    // at the caller's older request.
    expect((dataOf(second).window as { afterExclusive: string }).afterExclusive)
      .toBe('2026-08-06T12:00:00.000Z');
  });

  it('a bare UTC offset is not an IANA zone — Intl would have accepted it', async () => {
    // The rule is CRON_LOOPS.md's, and it needs its own check: Intl accepts
    // "+05:30" happily, so without this the doc rule was unenforced. A fixed
    // offset cannot express daylight saving.
    for (const [i, timeZone] of ['+05:30', '-08:00', 'GMT+2'].entries()) {
      service.schedules.create(`sched-tz${i}`, { ...STORED, timeZone });
      const result = await call({ ...BODY, scheduleId: `sched-tz${i}` });
      expect(result?.status, timeZone).toBe(422);
      expect(errorOf(result).message).toContain('not an IANA timezone name');
    }
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('a zone the host cannot answer for is refused by the evaluator', async () => {
    service.schedules.create('sched-mars', { ...STORED, timeZone: 'Mars/Olympus_Mons' });
    const result = await call({ ...BODY, scheduleId: 'sched-mars' });
    expect(result?.status).toBe(422);
    expect(errorOf(result).kind).toBe('unknown_timezone');
  });

  it('missing fields are listed by name, and nothing is created', async () => {
    const result = await call({ authorized: true, scheduleId: 'sched-triage' });
    expect(result?.status).toBe(422);
    expect(errorOf(result).message).toContain('afterExclusive');
    expect(errorOf(result).message).toContain('missedPolicy');
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('a schedule that does not exist is 404 — a tick runs a STORED schedule', async () => {
    const result = await call({ ...BODY, scheduleId: 'sched-nope' });
    expect(result?.status).toBe(404);
    expect(errorOf(result).kind).toBe('schedule_not_found');
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('a PAUSED schedule is not evaluated', async () => {
    // Mutation check: ignoring the paused flag runs a schedule an operator
    // deliberately stopped.
    service.schedules.setPaused('sched-triage', true, T0);
    const result = await call();
    expect(result?.status).toBe(409);
    expect(errorOf(result).kind).toBe('schedule_paused');
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('a CORRUPT schedule refuses rather than running a partial history', async () => {
    writeFileSync(
      join(root, 'cron-schedules', 'sched-triage', 'versions.ndjson'),
      'torn\n{"kind":"version","version":2}\n',
    );
    const result = await call();
    expect(result?.status).toBe(409);
    expect(errorOf(result).kind).toBe('schedule_corrupt');
  });

  it('the response reports the contract version the run came from', async () => {
    const result = await call();
    expect(dataOf(result).contractVersion).toBe(1);
  });

  it('uses the HIGHEST version as head, not the last journal line', async () => {
    // planScheduleEdit picks the head by version because gaps are permitted
    // and position does not imply order. The route used the last array
    // element, so a journal whose lines are out of order would run an older
    // schedule while reporting a newer version. Mutation check: restoring
    // history[length - 1] fails this.
    writeFileSync(
      join(root, 'cron-schedules', 'sched-triage', 'versions.ndjson'),
      [
        JSON.stringify({ kind: 'version', version: STORED }),
        JSON.stringify({ kind: 'version', version: { ...STORED, version: 4, cronExpression: '0 * * * *' } }),
        JSON.stringify({ kind: 'version', version: { ...STORED, version: 2, cronExpression: '0 0 1 1 *' } }),
      ].join('\n') + '\n',
    );
    const result = await call();
    expect(result?.status).toBe(200);
    // Version 4 governs: hourly, three occurrences — not version 2's yearly.
    expect(dataOf(result).contractVersion).toBe(4);
    expect(dataOf(result).runsCreated).toBe(3);
  });

  it('a missing BINDING field is named as binding.<field>', async () => {
    const result = await call({ ...BODY, binding: { projectId: 'prj_cron' } });
    expect(result?.status).toBe(422);
    expect(errorOf(result).message).toContain('binding.loopId');
  });

  it('a window wider than the evaluation bound is refused, not scanned', async () => {
    // The governing version must be old enough that the clamp does not shrink
    // the window below the bound — otherwise this would test the clamp.
    service.schedules.create('sched-old', { ...STORED, authoredAt: '2026-06-01T00:00:00.000Z' });
    const result = await call({
      ...BODY, scheduleId: 'sched-old', afterExclusive: '2026-07-01T00:00:00.000Z',
    });
    expect(result?.status).toBe(422);
    expect(errorOf(result).kind).toBe('window_too_large');
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('run_latest over a truncated window is refused rather than quietly broken', async () => {
    const result = await call({ ...BODY, missedPolicy: 'run_latest', maxOccurrences: 2 });
    expect(result?.status).toBe(422);
    expect(errorOf(result).kind).toBe('truncated_window_under_run_latest');
  });

  it('high-risk work awaits confirmation — a tick never auto-catches it up', async () => {
    const result = await call({ ...BODY, workClass: 'financial' });
    expect(result?.status).toBe(200);
    expect(dataOf(result).runsCreated).toBe(0);
    expect((dataOf(result).occurrences as { outcome: string }[])
      .every((o) => o.outcome === 'awaiting_confirmation')).toBe(true);
    // Nothing was claimed either: a held occurrence is not a handled one.
    expect(existsSync(occurrenceDir())).toBe(false);
  });
});

describe('an operator can create, list and pause a schedule', () => {
  const CREATE = {
    authorized: true,
    scheduleId: 'sched-new',
    cronExpression: '0 9 * * 1-5',
    timeZone: 'America/Los_Angeles',
    contractRef: 'contract-ref',
    contractBindingDigest: 'digest-1',
    authoredBy: 'founder',
  };

  it('creates a schedule an operator can then tick', async () => {
    const created = await call(CREATE, { path: '/cron/schedules' });
    expect(created?.status).toBe(200);
    expect(dataOf(created).version).toBe(1);
    // The AUTHORING INSTANT is the server's, not the caller's.
    expect(dataOf(created).authoredAt).toBe(T0);
    expect(String(dataOf(created).note)).toContain('Nothing runs it');
    expect(service.schedules.read('sched-new')?.history).toHaveLength(1);

    // AND THEN TICKS IT. The whole point of the route is that the Cron path is
    // reachable by an operator; a create test that never ticks proves half of
    // it. The window opens before the schedule existed on purpose: the reply
    // must show the clamp, not the requested start.
    const ticked = await call(
      { ...BODY, scheduleId: 'sched-new', afterExclusive: '2020-01-01T00:00:00.000Z' },
    );
    expect(ticked?.status).toBe(200);
    expect(dataOf(ticked).contractVersion).toBe(1);
    expect((dataOf(ticked).window as Record<string, unknown>).afterExclusive).toBe(T0);
  });

  it('refuses a caller-supplied authoring instant outright, and stores nothing', async () => {
    // Reading authoredAt from the body would hand back the replay the tick's
    // clamp exists to prevent: a caller could backdate a version and own
    // moments that predate it. This used to be ignored silently, which let the
    // caller believe a backdate had landed. Refusing says so.
    const created = await call(
      { ...CREATE, authoredAt: '2020-01-01T00:00:00.000Z' },
      { path: '/cron/schedules' },
    );
    expect(created?.status).toBe(422);
    expect(errorOf(created).kind).toBe('field_not_accepted');
    expect(service.schedules.list()).toEqual(['sched-triage']);
  });

  it('lists the schedules that exist', async () => {
    await call(CREATE, { path: '/cron/schedules' });
    const listed = await call(undefined, { method: 'GET', path: '/cron/schedules' });
    expect(listed?.status).toBe(200);
    expect(dataOf(listed).schedules).toEqual([
      { scheduleId: 'sched-new', state: 'active' },
      { scheduleId: 'sched-triage', state: 'active' },
    ]);
  });

  it('the listing says which schedules are paused rather than showing them as ordinary', async () => {
    // A bare list of ids reports a paused schedule identically to a running
    // one, which is the state an operator most needs to see.
    await call({ authorized: true, paused: true }, { path: '/cron/schedules/sched-triage/pause' });
    const listed = await call(undefined, { method: 'GET', path: '/cron/schedules' });
    expect(dataOf(listed).schedules).toEqual([{ scheduleId: 'sched-triage', state: 'paused' }]);
  });

  it('creating requires explicit authorization, like a tick', async () => {
    const { authorized: _drop, ...withoutConsent } = CREATE;
    const created = await call(withoutConsent, { path: '/cron/schedules' });
    expect(created?.status).toBe(403);
    expect(errorOf(created).kind).toBe('authorization_required');
    expect(service.schedules.list()).toEqual(['sched-triage']);
  });

  it('refuses a bad expression or a non-IANA zone at creation, not at tick time', async () => {
    const badCron = await call({ ...CREATE, cronExpression: '99 * * * *' }, { path: '/cron/schedules' });
    expect(badCron?.status).toBe(422);
    expect(errorOf(badCron).message).toContain('is not a minute value');
    const badZone = await call({ ...CREATE, timeZone: '+05:30' }, { path: '/cron/schedules' });
    expect(badZone?.status).toBe(422);
    expect(errorOf(badZone).message).toContain('not an IANA timezone name');
    expect(service.schedules.list()).toEqual(['sched-triage']);
  });

  it('refuses a zone that is IANA-SHAPED but that no evaluator can resolve', async () => {
    // The pattern accepts any Word/Word. Storing `America/Atlantis` produced a
    // schedule whose every tick failed `unknown_timezone` forever — and with
    // no edit and no delete route, the id was burned.
    const atlantis = await call(
      { ...CREATE, timeZone: 'America/Atlantis' }, { path: '/cron/schedules' },
    );
    expect(atlantis?.status).toBe(422);
    expect(errorOf(atlantis).message).toContain('cannot resolve');
    expect(service.schedules.list()).toEqual(['sched-triage']);
  });

  it('refuses an unusable schedule id as a validation failure, not a conflict', async () => {
    // 409 said "this conflicts with something"; nothing existed to conflict
    // with. A caller cannot tell "pick another name" from "fix this field".
    for (const scheduleId of ['../escape', 'has space', '_leading', 'x'.repeat(100)]) {
      const result = await call({ ...CREATE, scheduleId }, { path: '/cron/schedules' });
      expect(result?.status, scheduleId).toBe(422);
      expect(errorOf(result).kind, scheduleId).toBe('validation_failed');
    }
    expect(service.schedules.list()).toEqual(['sched-triage']);
  });

  it('refuses a body field this server decides, rather than discarding it silently', async () => {
    // `paused: true` was accepted, dropped, and answered with a success — so an
    // operator who created a schedule intending it to start paused got an
    // ACTIVE one and no indication of it.
    for (const field of ['paused', 'version', 'authoredAt']) {
      const result = await call(
        { ...CREATE, [field]: field === 'paused' ? true : 99 }, { path: '/cron/schedules' },
      );
      expect(result?.status, field).toBe(422);
      expect(errorOf(result).kind, field).toBe('field_not_accepted');
    }
    expect(service.schedules.list()).toEqual(['sched-triage']);
  });

  it('refuses to create over an existing schedule, and leaves it exactly as it was', async () => {
    const before = service.schedules.read('sched-triage');
    const again = await call(
      { ...CREATE, scheduleId: 'sched-triage', contractRef: 'contract-OVERWRITE' },
      { path: '/cron/schedules' },
    );
    expect(again?.status).toBe(409);
    expect(errorOf(again).kind).toBe('schedule_not_created');
    // The property that matters: a refused create is not a partial one.
    expect(service.schedules.read('sched-triage')).toEqual(before);
  });

  it('pauses and resumes, and a paused schedule then refuses a tick', async () => {
    const paused = await call({ authorized: true, paused: true },
      { path: '/cron/schedules/sched-triage/pause' });
    expect(paused?.status).toBe(200);
    expect(dataOf(paused).paused).toBe(true);
    expect((await call())?.status).toBe(409);

    const resumed = await call({ authorized: true, paused: false },
      { path: '/cron/schedules/sched-triage/pause' });
    expect(resumed?.status).toBe(200);
    expect((await call())?.status).toBe(200);
  });

  it('pausing requires explicit authorization and an explicit boolean', async () => {
    expect((await call({ paused: true }, { path: '/cron/schedules/sched-triage/pause' }))?.status)
      .toBe(403);
    expect((await call({ authorized: true }, { path: '/cron/schedules/sched-triage/pause' }))?.status)
      .toBe(422);
    expect((await call({ authorized: true, paused: 'yes' },
      { path: '/cron/schedules/sched-triage/pause' }))?.status).toBe(422);
  });

  it('pausing a schedule that does not exist says so, and does not blame a lock', async () => {
    // THE DEFECT THIS PINS. `setPaused` takes the write lock BEFORE it replays,
    // and opening a lock inside a directory that does not exist fails ENOENT —
    // which the store can only report as contention. An operator was sent to
    // investigate a competing writer for a schedule that was never created.
    // Asserting only the status let that false message pass.
    const result = await call({ authorized: true, paused: true },
      { path: '/cron/schedules/sched-nope/pause' });
    expect(result?.status).toBe(404);
    expect(errorOf(result).kind).toBe('schedule_not_found');
    expect(errorOf(result).message).not.toContain('another process');
    expect(errorOf(result).message).not.toContain('lock');
  });

  it('the schedule routes are behind the same gates as the tick', async () => {
    for (const path of ['/cron/schedules', '/cron/schedules/sched-triage/pause']) {
      expect((await call(CREATE, { path, authorize: () => ({ kind: 'none', principal: 'none' }) }))?.status)
        .toBe(401);
      expect((await call(CREATE, {
        path, env: { RELAY_BRIDGE_API_TOKEN: TOKEN, RELAY_LOOP_ENGINE_ENABLED: '1' },
      }))?.status).toBe(403);
    }
  });
});

describe('the tick leaves the state root the way it says it does', () => {
  it('claims exactly the occurrences it reports, and no others', async () => {
    await call();
    const claimed = readdirSync(occurrenceDir()).sort();
    expect(claimed).toHaveLength(3);
    for (const dir of claimed) {
      expect(readdirSync(join(occurrenceDir(), dir)).sort())
        .toEqual(['claimed.json', 'triggers.ndjson']);
    }
  });
});
