import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleCronRoute, type CronRouteRequest } from './cron-routes';
import {
  createCronTickService, MAX_LISTED_SCHEDULES, type CronTickService,
} from './cron-service';
import {
  appendLoopRunEvent, emptyLoopBudget, emptyLoopRunRecord, loopDigest, readLoopRun, seedLoopRun,
} from '../src/relay/mission/loop/runtime';

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
};

/** The schedule the tick reads. Stored, not asserted by the request. */
const STORED = {
  version: 1,
  cronExpression: '0 * * * *',
  timeZone: 'UTC',
  contractRef: 'contract-ref',
  contractBindingDigest: 'digest-1',
  projectId: 'prj_cron',
  workspaceId: null,
  loopId: 'lpe_cron',
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

  it('two schedules in different projects do not suppress each other', async () => {
    // The occurrence identity's first term must be globally unique, and
    // nothing allocates one: the id is a caller-supplied string and the claim
    // markers share one flat namespace on the volume. Un-namespaced, the first
    // schedule to tick durably marked the second's occurrences already-handled
    // — silent cross-tenant suppression, found by review. The ids differ, so
    // what keeps them apart now is the id itself: one state root holds one
    // schedule per id, which is why the occurrence term no longer needs
    // qualifying with a binding that could move under a rebinding.
    expect(service.schedules.create('sched-other', {
      ...STORED, projectId: 'prj_other', loopId: 'lpe_other',
    }).ok).toBe(true);

    const a = await call();
    expect(dataOf(a).runsCreated).toBe(3);

    const b = await call({ ...BODY, scheduleId: 'sched-other' });
    expect(b?.status).toBe(200);
    expect(dataOf(b).runsCreated).toBe(3);
    expect((dataOf(b).occurrences as { outcome: string }[])
      .every((o) => o.outcome === 'run_created')).toBe(true);
    // Each schedule's runs land in ITS OWN Loop, per its stored binding.
    expect(service.store.runIdsForLoop('lpe_cron')).toHaveLength(3);
    expect(service.store.runIdsForLoop('lpe_other')).toHaveLength(3);
  });

  it('a caller cannot tick one schedule into a Loop it does not name', async () => {
    // THE DEFECT THIS PINS. The binding arrived in the REQUEST and was also
    // part of the claim key, so the durable marker protected a (schedule,
    // binding) pair rather than the schedule: review measured three ticks over
    // one identical window, differing only in binding, producing NINE runs —
    // six of them in the same Loop for the same three hours. The binding is the
    // schedule's now, so a request carrying one is refused rather than obeyed.
    const first = await call();
    expect(dataOf(first).runsCreated).toBe(3);

    const hijack = await call({
      ...BODY,
      binding: { projectId: 'prj_other', workspaceId: null, loopId: 'lpe_other' },
    });
    expect(hijack?.status).toBe(422);
    expect(errorOf(hijack).kind).toBe('field_owned_by_the_schedule');
    // Nothing was created anywhere, and the window stays handled exactly once.
    expect(service.store.runIdsForLoop('lpe_other') ?? []).toHaveLength(0);
    expect(service.store.runIdsForLoop('lpe_cron')).toHaveLength(3);
  });

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
    for (const field of ['projectId', 'workspaceId', 'loopId', 'contractRef', 'contractBindingDigest']) {
      const result = await call({ ...BODY, binding: { [field]: 'x' } });
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

  it('a bare UTC offset does not name a place — Intl would have accepted it', async () => {
    // The rule is CRON_LOOPS.md's, and it needs its own check: Intl accepts
    // "+05:30" happily, so without this the doc rule was unenforced. A fixed
    // offset cannot express daylight saving. The message says Area/Location
    // rather than "not an IANA timezone name", which was false: `Japan` and
    // `EST` ARE IANA names, and this check refuses them for lacking a slash.
    for (const [i, timeZone] of ['+05:30', '-08:00', 'GMT+2'].entries()) {
      service.schedules.create(`sched-tz${i}`, { ...STORED, timeZone });
      const result = await call({ ...BODY, scheduleId: `sched-tz${i}` });
      expect(result?.status, timeZone).toBe(422);
      expect(errorOf(result).message).toContain('not an Area/Location timezone name');
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

  it('a tick carrying a binding is refused, not obeyed and not ignored', async () => {
    // The tick used to REQUIRE one and name the missing field; the binding is
    // the schedule's now, so the same request is refused by name. The
    // equivalent naming test lives at creation, where the binding is given.
    const result = await call({ ...BODY, binding: { projectId: 'prj_cron' } });
    expect(result?.status).toBe(422);
    expect(errorOf(result).kind).toBe('field_owned_by_the_schedule');
    expect(errorOf(result).message).toContain('binding.projectId');
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
    binding: { projectId: 'prj_cron', workspaceId: null, loopId: 'lpe_cron' },
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

  it('the listing says CORRUPT rather than presenting an unreadable schedule as ordinary', async () => {
    // Mutation check: report 'active' here instead and an operator sees a
    // healthy schedule that 409s on every tick. Corrupt is the half of this
    // that actually misleads, so it is the half worth pinning.
    writeFileSync(
      join(root, 'cron-schedules', 'sched-triage', 'versions.ndjson'),
      'torn\n{"kind":"version","version":2}\n',
    );
    const listed = await call(undefined, { method: 'GET', path: '/cron/schedules' });
    expect(dataOf(listed).schedules).toEqual([{ scheduleId: 'sched-triage', state: 'corrupt' }]);
    expect(dataOf(listed).totalStored).toBe(1);
    expect(dataOf(listed).truncated).toBe(false);
  });

  it('reports the REAL total when the listing is capped, and says it was capped', async () => {
    // Both fields were previously asserted only against a single schedule,
    // where `totalStored: slice(...).length` and a hardcoded `truncated: false`
    // would pass identically. This crosses the boundary, which is the only
    // place either field can be wrong.
    const extra = MAX_LISTED_SCHEDULES; // plus the sched-triage the harness makes
    for (let i = 0; i < extra; i += 1) {
      const id = `bulk-${String(i).padStart(4, '0')}`;
      expect(service.schedules.create(id, { ...STORED, authoredAt: T0 }).ok, id).toBe(true);
    }
    const listed = await call(undefined, { method: 'GET', path: '/cron/schedules' });
    expect(dataOf(listed).totalStored).toBe(MAX_LISTED_SCHEDULES + 1);
    expect(dataOf(listed).truncated).toBe(true);
    expect((dataOf(listed).schedules as unknown[]).length).toBe(MAX_LISTED_SCHEDULES);
  }, 30_000);

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
    expect(errorOf(badZone).message).toContain('not an Area/Location timezone name');
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

  it('refuses a fixed offset wearing a zone name, which the refusal already claims', async () => {
    // Etc/GMT+5 is a REAL zone, so the evaluator resolves it and both earlier
    // checks pass — while being precisely the fixed offset the non-IANA
    // message says is not allowed. Such a schedule drifts an hour against its
    // author's wall clock twice a year, permanently.
    // Every spelling Intl accepts, because the refusal tests the CANONICAL
    // name: a case-sensitive pattern over the raw string refused one spelling
    // and stored the identical zone under another.
    // SystemV/* was missed entirely by the pattern this rule used to be, which
    // is why the rule is now ICU's own list of places. Six of its thirteen
    // members DO observe daylight saving; they are refused because their rules
    // are frozen at the pre-1987 ruleset, not because they are fixed offsets.
    for (const timeZone of [
      'Etc/GMT+5', 'etc/gmt+5', 'ETC/GMT+5', 'Etc/GMT-14',
      'SystemV/EST5', 'SystemV/PST8', 'systemv/mst7',
      // DST-OBSERVING and still refused: frozen on the pre-1987 US ruleset, so
      // it diverges from the place it names for weeks each spring. Including
      // it is what caught a refusal that called it a fixed offset.
      'SystemV/EST5EDT', 'SystemV/PST8PDT',
    ]) {
      const offset = await call({ ...CREATE, timeZone }, { path: '/cron/schedules' });
      expect(offset?.status, timeZone).toBe(422);
      expect(errorOf(offset).message, timeZone).toContain('does not name a place');
      expect(errorOf(offset).message, timeZone).not.toContain('names a fixed offset, not a place');
    }
    // A string that names NO zone gets the diagnosis for naming no zone, not
    // the one for naming an offset.
    const nonsense = await call({ ...CREATE, timeZone: 'Etc/GMT+05' }, { path: '/cron/schedules' });
    expect(nonsense?.status).toBe(422);
    expect(errorOf(nonsense).message).toContain('cannot resolve');
    // And a real place still passes all of it.
    expect((await call({ ...CREATE, timeZone: 'America/New_York' },
      { path: '/cron/schedules' }))?.status).toBe(200);
    expect(service.schedules.list()).toEqual(['sched-new', 'sched-triage']);
  });

  it('the tick refuses a stored fixed-offset zone, as its own message promises', async () => {
    // A schedule written straight into the store — or created before creation
    // learned to refuse these — would otherwise run under exactly the zone the
    // tick's refusal text says it will not run.
    expect(service.schedules.create('sched-drift',
      { ...STORED, timeZone: 'Etc/GMT+5', authoredAt: T0 }).ok).toBe(true);
    const ticked = await call({ ...BODY, scheduleId: 'sched-drift' });
    expect(ticked?.status).toBe(422);
    expect(errorOf(ticked).message).toContain('does not name a place');
    // Refused BEFORE anything is claimed. Without this the check could later
    // drift below the claim loop and still satisfy the assertions above, which
    // is the one way this repair regresses silently.
    expect(existsSync(occurrenceDir())).toBe(false);
  });

  it('names a missing binding field as binding.<field> at creation', async () => {
    const partial = await call(
      { ...CREATE, binding: { projectId: 'prj_cron' } }, { path: '/cron/schedules' },
    );
    expect(partial?.status).toBe(422);
    expect(errorOf(partial).message).toContain('binding.loopId');
    // An absent binding entirely is the same failure, not a stored schedule.
    const { binding: _drop, ...withoutBinding } = CREATE;
    const none = await call(withoutBinding, { path: '/cron/schedules' });
    expect(none?.status).toBe(422);
    expect(errorOf(none).message).toContain('binding.projectId');
    // Leaving the workspace OUT is not a way to say there is none: the store
    // refuses absent outright, so accepting it here would be two rules for one
    // field — the split this branch spent a round removing for contractRef.
    const absentWorkspace = await call(
      { ...CREATE, binding: { projectId: 'prj_cron', loopId: 'lpe_cron' } },
      { path: '/cron/schedules' },
    );
    expect(absentWorkspace?.status).toBe(422);
    expect(errorOf(absentWorkspace).message).toContain('Leaving it out');
    // A wrong-TYPED workspace is told what it did, not what someone else did:
    // one message for absent, one for blank, one for neither.
    const numberWorkspace = await call(
      { ...CREATE, binding: { ...CREATE.binding, workspaceId: 5 } },
      { path: '/cron/schedules' },
    );
    expect(numberWorkspace?.status).toBe(422);
    expect(errorOf(numberWorkspace).message).toContain('It is neither');
    expect(errorOf(numberWorkspace).message).not.toContain('Leaving it out');
    // And the contract fields belong at the top level, not inside the binding,
    // where the tick already refuses them by name.
    for (const field of ['contractRef', 'contractBindingDigest']) {
      const inBinding = await call(
        { ...CREATE, binding: { ...CREATE.binding, [field]: 'x' } },
        { path: '/cron/schedules' },
      );
      expect(inBinding?.status, field).toBe(422);
      expect(errorOf(inBinding).kind, field).toBe('field_not_accepted');
    }
    expect(service.schedules.list()).toEqual(['sched-triage']);
    // A workspace is optional, but a BLANK is not a way to say there is none:
    // accepting it and storing `null` would be a field discarded and answered
    // with a success, which is what this route refuses everywhere else.
    const blankWorkspace = await call(
      { ...CREATE, binding: { ...CREATE.binding, workspaceId: '  ' } },
      { path: '/cron/schedules' },
    );
    expect(blankWorkspace?.status).toBe(422);
    expect(errorOf(blankWorkspace).message).toContain('names no workspace');
    expect(service.schedules.list()).toEqual(['sched-triage']);
    // Explicit null IS how you say it, and it stores as absent.
    const noWorkspace = await call(
      { ...CREATE, binding: { ...CREATE.binding, workspaceId: null } },
      { path: '/cron/schedules' },
    );
    expect(noWorkspace?.status).toBe(200);
    expect(service.schedules.read('sched-new')?.history[0]?.workspaceId).toBeNull();
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
    // `binding` is deliberately NOT here: a schedule pins what its runs belong
    // to, so creation is where it must be given, and the tick is where it is
    // refused. Its own tests are above.
    for (const field of ['paused', 'version', 'contractVersion', 'authoredAt']) {
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

  it('an EDIT appends a version, and the tick then runs the new one', async () => {
    // `planScheduleEdit` and `store.edit` were fully built and reachable from
    // no surface, so a stored schedule could never be corrected or rebound.
    const edited = await call(
      { ...CREATE, scheduleId: 'sched-triage', cronExpression: '*/30 * * * *' },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(edited?.status).toBe(200);
    expect(dataOf(edited).version).toBe(2);
    expect(dataOf(edited).authoredAt).toBe(T0);
    // WHAT CHANGED IS NAMED. A version whose diff nobody can state is a
    // version nobody can review.
    // Both really did change: the fixture's zone differs from the stored one,
    // and `changed` reports what the edit did rather than what it was called.
    expect(dataOf(edited).changed).toEqual(['cronExpression', 'timeZone']);

    const history = service.schedules.read('sched-triage')?.history ?? [];
    expect(history).toHaveLength(2);
    // EVERY EARLIER VERSION IS KEPT, unchanged — that is the whole rule.
    expect(history[0]?.cronExpression).toBe('0 * * * *');
    expect(history[1]?.cronExpression).toBe('*/30 * * * *');

    // …and the tick runs the NEW one, reporting the version it came from.
    const ticked = await call();
    expect(ticked?.status).toBe(200);
    expect(dataOf(ticked).contractVersion).toBe(2);
  });

  it('an edit survives another schedule\'s runs in the same Loop', async () => {
    // THE DEFECT THIS PINS, and it needs a real VERSION MISMATCH to exist: an
    // earlier version of this test gave both schedules version 1, so the
    // orphan check never fired and the mutation it named passed.
    //
    // Two schedules may bind one Loop. `planScheduleEdit` reads every run's
    // `contractVersion` as THIS schedule's, so the other's runs cite versions
    // this history lacks: every future edit refused as orphaning, no delete
    // route, the schedule never correctable again.
    expect(service.schedules.create('sched-shared', {
      ...STORED, loopId: 'lpe_cron',
    }).ok).toBe(true);
    // v2 for the OTHER schedule, authored before the window so its tick runs.
    expect(service.schedules.edit('sched-shared', {
      ...STORED, cronExpression: '0 * * * *', contractRef: 'contract-two',
      authoredAt: '2026-08-02T10:00:00.000Z',
    }, []).ok).toBe(true);
    const ticked = await call({ ...BODY, scheduleId: 'sched-shared' });
    expect(dataOf(ticked).runsCreated).toBe(3);
    expect(dataOf(ticked).contractVersion).toBe(2);

    // Three runs now sit in lpe_cron citing v2 — a version sched-triage's
    // history does not contain. Its edit must still succeed.
    const edited = await call(
      { ...CREATE, scheduleId: 'sched-triage', cronExpression: '*/30 * * * *' },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(edited?.status).toBe(200);
    expect(dataOf(edited).version).toBe(2);
    // AND THE OTHER SCHEDULE'S RUNS ARE NOT REPORTED AS THIS ONE'S. A run
    // records the schedule that created it now, so the list is this schedule's
    // — previously the only list available was every run in the Loop, which
    // both misreported them and refused every future edit as orphaning.
    expect(dataOf(edited).unfinishedRunsUndisturbed).toEqual([]);
    expect(dataOf(edited).unattributedRuns).toBe(0);
  });

  it('still sees its own runs after a REBINDING moved it to another Loop', async () => {
    // `loopId` is a versioned field and rebinding is a supported edit, so runs
    // made before one live in the Loop that version named. Scanning only the
    // head's Loop made them vanish from both outputs — an empty report over
    // this schedule's own unfinished work.
    const ticked = await call();
    expect(dataOf(ticked).runsCreated).toBe(3);

    const rebound = await call(
      {
        ...CREATE,
        scheduleId: 'sched-triage',
        binding: { projectId: 'prj_cron', workspaceId: null, loopId: 'lpe_moved' },
      },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(rebound?.status).toBe(200);
    expect(dataOf(rebound).changed).toContain('loopId');
    // The three runs are in lpe_cron, which the schedule no longer points at.
    expect((dataOf(rebound).unfinishedRunsUndisturbed as string[])).toHaveLength(3);

    // A SECOND edit still sees them, because the scan covers every Loop the
    // history names, not only the current one.
    const again = await call(
      { ...CREATE, scheduleId: 'sched-triage', cronExpression: '*/15 * * * *',
        binding: { projectId: 'prj_cron', workspaceId: null, loopId: 'lpe_moved' } },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(again?.status).toBe(200);
    expect((dataOf(again).unfinishedRunsUndisturbed as string[])).toHaveLength(3);
  });

  it('counts a run that names NO schedule as unknown, never as another schedule\'s absence', async () => {
    // A schedule-created run written before runs recorded their schedule
    // carries `null`. Calling those "not ours" would report a clean list of unfinished
    // work over runs that may well be ours — unknown reported as zero, which
    // is the one thing this codebase refuses everywhere else.
    const legacy = seedLoopRun({
      runId: 'lpr_legacy',
      loopId: 'lpe_cron',
      projectId: 'prj_cron',
      workspaceId: null,
      contractRef: 'contract-ref',
      contractVersion: 1,
      contractBindingDigest: 'digest-1',
      budget: emptyLoopBudget({
        maxIterations: null, maxTotalDurationMinutes: null, maxSpendMicros: null, currency: null,
        maxTotalTokens: null, maxProviderCalls: null, maxConsecutiveFailures: 0,
      }),
      createdAt: T0,
      provenance: 'offline',
    });
    service.store.create(emptyLoopRunRecord(legacy));
    const base = (payload: Record<string, unknown>, key: string | null) => ({
      at: T0,
      runId: 'lpr_legacy',
      loopId: 'lpe_cron',
      projectId: 'prj_cron',
      kind: payload.kind as string,
      actor: 'relay-schedule',
      recoveryGeneration: 0,
      expectedPreviousState: null,
      idempotencyKey: key,
      payload,
    });
    const confirmed = appendLoopRunEvent(service.store, {
      runId: 'lpr_legacy',
      digest: loopDigest,
      base: base({
        kind: 'loop.contract_confirmed',
        contractRef: 'contract-ref',
        contractVersion: 1,
        bindingDigest: 'digest-1',
        confirmedBy: 'relay-schedule',
      }, null) as never,
    });
    expect(confirmed.ok).toBe(true);
    const appended = appendLoopRunEvent(service.store, {
      runId: 'lpr_legacy',
      digest: loopDigest,
      // NO scheduleId in the payload — exactly what an older build wrote.
      base: base({
        kind: 'loop.run_created',
        idempotencyKey: 'legacy-1',
        creationSource: 'schedule',
        createdBy: 'relay-schedule',
      }, 'legacy-1') as never,
    });
    expect(appended.ok).toBe(true);
    expect(readLoopRun(service.store, 'lpr_legacy', loopDigest)?.run?.scheduleId).toBeNull();

    const edited = await call(
      { ...CREATE, scheduleId: 'sched-triage', cronExpression: '*/30 * * * *' },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(edited?.status).toBe(200);
    expect(dataOf(edited).unattributedRuns).toBe(1);
    // …and it is NOT silently listed as this schedule's unfinished work.
    expect(dataOf(edited).unfinishedRunsUndisturbed).toEqual([]);
  });

  it('counts a record that never got its identity, at sequence ONE', async () => {
    // THE DEFECT THIS PINS. `confirmLoopRun` writes the record, then
    // `contract_confirmed`, then `run_created`. A crash or a refused third
    // append leaves a DURABLE record at sequence 1 that still carries the
    // seed's defaults — `creationSource: 'api'`, no scheduleId — and a re-tick
    // finds it and answers `duplicate`, so nothing ever repairs it. Keying the
    // unknown on `lastSequence === 0` missed it by exactly one event; only
    // `loop.run_created` gives a run its identity.
    const half = seedLoopRun({
      runId: 'lpr_half',
      loopId: 'lpe_cron',
      projectId: 'prj_cron',
      workspaceId: null,
      contractRef: 'contract-ref',
      contractVersion: 1,
      contractBindingDigest: 'digest-1',
      budget: emptyLoopBudget({
        maxIterations: null, maxTotalDurationMinutes: null, maxSpendMicros: null, currency: null,
        maxTotalTokens: null, maxProviderCalls: null, maxConsecutiveFailures: 0,
      }),
      createdAt: T0,
      provenance: 'offline',
    });
    service.store.create(emptyLoopRunRecord(half));
    const confirmed = appendLoopRunEvent(service.store, {
      runId: 'lpr_half',
      digest: loopDigest,
      base: {
        at: T0,
        runId: 'lpr_half',
        loopId: 'lpe_cron',
        projectId: 'prj_cron',
        kind: 'loop.contract_confirmed',
        actor: 'relay-schedule',
        recoveryGeneration: 0,
        expectedPreviousState: null,
        idempotencyKey: null,
        payload: {
          kind: 'loop.contract_confirmed',
          contractRef: 'contract-ref',
          contractVersion: 1,
          bindingDigest: 'digest-1',
          confirmedBy: 'relay-schedule',
        },
      },
    });
    expect(confirmed.ok).toBe(true);
    // It reads as an ordinary `api` run — which is exactly the trap.
    expect(readLoopRun(service.store, 'lpr_half', loopDigest)?.run?.creationSource).toBe('api');

    const edited = await call(
      { ...CREATE, scheduleId: 'sched-triage', cronExpression: '*/30 * * * *' },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(edited?.status).toBe(200);
    expect(dataOf(edited).unattributedRuns).toBe(1);
  });

  it('counts a run it cannot READ as unknown too', async () => {
    // A run whose journal is TORN — a damaged final line — might be this
    // schedule's. Dropping it
    // would report a clean list over work that may be unfinished —
    // the same unknown-as-zero this refuses for an unattributed run.
    const ticked = await call();
    expect(dataOf(ticked).runsCreated).toBe(3);
    const runIds = service.store.runIdsForLoop('lpe_cron') ?? [];
    expect(runIds.length).toBe(3);
    writeFileSync(
      join(root, 'loops', 'lpe_cron', 'runs', runIds[0] as string, 'journal.jsonl'),
      'this is not a journal\n',
    );
    // …and one whose journal is EMPTY, which replays to no run at all rather
    // than to a damaged one. Both are unknown; neither is absent.
    writeFileSync(
      join(root, 'loops', 'lpe_cron', 'runs', runIds[1] as string, 'journal.jsonl'),
      '',
    );

    const edited = await call(
      { ...CREATE, scheduleId: 'sched-triage', cronExpression: '*/30 * * * *' },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(edited?.status).toBe(200);
    expect(dataOf(edited).unattributedRuns).toBe(2);
    // The one it CAN read is still reported as its own.
    expect((dataOf(edited).unfinishedRunsUndisturbed as string[])).toHaveLength(1);
  });

  it('reports its OWN unfinished runs, and counts what it cannot attribute', async () => {
    // The planner returns the runs a change must not disturb, and the route
    // used to discard them because no run said which schedule made it.
    const ticked = await call();
    expect(dataOf(ticked).runsCreated).toBe(3);

    const edited = await call(
      { ...CREATE, scheduleId: 'sched-triage', cronExpression: '*/30 * * * *' },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(edited?.status).toBe(200);
    const unfinished = dataOf(edited).unfinishedRunsUndisturbed as string[];
    expect(unfinished).toHaveLength(3);
    // Each still resolves to the version it started under.
    for (const runId of unfinished) {
      expect(readLoopRun(service.store, runId, loopDigest)?.run?.contractVersion).toBe(1);
    }
    expect(dataOf(edited).unattributedRuns).toBe(0);
  });

  it('an edit that changes nothing is refused, rather than splitting the history', async () => {
    const same = await call(
      { ...CREATE, scheduleId: 'sched-triage', cronExpression: '0 * * * *', timeZone: 'UTC' },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(same?.status).toBe(409);
    expect(errorOf(same).kind).toBe('schedule_not_edited');
    expect(service.schedules.read('sched-triage')?.history).toHaveLength(1);
  });

  it('the path names the schedule an edit changes, not the body', async () => {
    // Obeying the body would edit a schedule the caller never addressed;
    // ignoring it would answer 200 for a change that landed elsewhere.
    const mismatched = await call(
      { ...CREATE, scheduleId: 'sched-other' },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(mismatched?.status).toBe(422);
    expect(errorOf(mismatched).message).toContain('changes the schedule in the path');
    expect(service.schedules.read('sched-triage')?.history).toHaveLength(1);
  });

  it('editing a missing schedule is 404, and a corrupt one is 409', async () => {
    const absent = await call(
      { ...CREATE, scheduleId: 'sched-nope' }, { path: '/cron/schedules/sched-nope/edit' },
    );
    expect(absent?.status).toBe(404);
    expect(errorOf(absent).message).not.toContain('lock');

    writeFileSync(
      join(root, 'cron-schedules', 'sched-triage', 'versions.ndjson'),
      'torn\n{"kind":"version","version":2}\n',
    );
    const corrupt = await call(
      { ...CREATE, scheduleId: 'sched-triage' }, { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(corrupt?.status).toBe(409);
    expect(errorOf(corrupt).kind).toBe('schedule_corrupt');
  });

  it('an edit cannot pause, and requires the same authorization a create does', async () => {
    const paused = await call(
      { ...CREATE, scheduleId: 'sched-triage', paused: true },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(paused?.status).toBe(422);
    expect(errorOf(paused).kind).toBe('field_not_accepted');
    const { authorized: _drop, ...withoutConsent } = CREATE;
    const unauthorized = await call(
      { ...withoutConsent, scheduleId: 'sched-triage' },
      { path: '/cron/schedules/sched-triage/edit' },
    );
    expect(unauthorized?.status).toBe(403);
    expect(service.schedules.read('sched-triage')?.history).toHaveLength(1);
  });

  it('deletes a schedule, purges its claims, and frees the id', async () => {
    // Tick first so there are real claims to purge.
    expect(dataOf(await call()).runsCreated).toBe(3);
    expect(existsSync(occurrenceDir())).toBe(true);

    const deleted = await call({ authorized: true },
      { path: '/cron/schedules/sched-triage/delete' });
    expect(deleted?.status).toBe(200);
    expect(dataOf(deleted).claimsPurged).toBe(3);
    expect(readdirSync(occurrenceDir())).toEqual([]);

    // GONE IS MISSING, and the id is free: a create under the same name works,
    // and its ticks can only own moments after it exists.
    expect((await call())?.status).toBe(404);
    const recreated = await call(
      { ...CREATE, scheduleId: 'sched-triage' }, { path: '/cron/schedules' },
    );
    expect(recreated?.status).toBe(200);
    const listed = await call(undefined, { method: 'GET', path: '/cron/schedules' });
    expect(dataOf(listed).schedules).toEqual([{ scheduleId: 'sched-triage', state: 'active' }]);
  });

  it('deletes a CORRUPT schedule, which no other operation can touch', async () => {
    // Before this the doc said such a record had to be removed from the state
    // root by hand: create conflicts, pause and edit read it first.
    writeFileSync(
      join(root, 'cron-schedules', 'sched-triage', 'versions.ndjson'),
      'torn\n{"kind":"version","version":2}\n',
    );
    expect((await call())?.status).toBe(409);
    expect((await call({ authorized: true },
      { path: '/cron/schedules/sched-triage/delete' }))?.status).toBe(200);
    expect((await call())?.status).toBe(404);
  });

  it('deletes a record too damaged to even READ, which is the whole point', async () => {
    // A journal that cannot be opened at all — not merely one that replays as
    // corrupt — made `inspectSchedule` THROW, which the server turned into a
    // 500 and left the record undeletable through the endpoint while the store
    // beneath would have removed it happily. Present-and-unreadable is present.
    const journal = join(root, 'cron-schedules', 'sched-triage', 'versions.ndjson');
    rmSync(journal);
    mkdirSync(journal);   // a directory where the file was: reading throws EISDIR
    const deleted = await call({ authorized: true },
      { path: '/cron/schedules/sched-triage/delete' });
    expect(deleted?.status).not.toBe(500);
    // The unlink cannot remove a directory either, so this refuses TRUTHFULLY
    // rather than reporting a deletion that did not happen.
    expect(deleted?.status).toBe(409);
    expect(errorOf(deleted).message).toContain('still there');
  });

  it('deleting a schedule that is not there is 404, as everywhere else', async () => {
    // 409 would tell an operator retrying a timed-out delete that they
    // conflicted with something, when what happened is that it worked.
    const absent = await call({ authorized: true },
      { path: '/cron/schedules/sched-nope/delete' });
    expect(absent?.status).toBe(404);
    expect(errorOf(absent).kind).toBe('schedule_not_found');
  });

  it('deleting requires explicit authorization, like every other write', async () => {
    const unauthorized = await call({}, { path: '/cron/schedules/sched-triage/delete' });
    expect(unauthorized?.status).toBe(403);
    expect(errorOf(unauthorized).kind).toBe('authorization_required');
    expect(service.schedules.read('sched-triage')?.history).toHaveLength(1);
  });

  it('the schedule routes are behind the same gates as the tick', async () => {
    for (const path of [
      '/cron/schedules', '/cron/schedules/sched-triage/pause',
      '/cron/schedules/sched-triage/edit', '/cron/schedules/sched-triage/delete',
    ]) {
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
