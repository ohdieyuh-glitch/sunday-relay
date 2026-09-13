import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_PAID_RUNS_AHEAD, dispatchArgs, dispatchKey, dispatchOnce, keyState, paidRunsAhead, runPaidDispatch } from './julius-paid-dispatch.mjs';

/**
 * ONE ATTEMPT, ONE PAID RUN — however the network behaves.
 *
 * The fake GitHub here does what the real one does on a bad day: it accepts a
 * dispatch and loses the answer, lists a new run a few polls late, or refuses
 * outright. Every case counts dispatch REQUESTS, because the property is not
 * "the client eventually reports success", it is "the client never asked for
 * a second paid run of one attempt".
 */

const SHA = '0845c593a8eb0d48c2329b907d966474e7273d89';
const PAID_KEY = `julius-continuous-1@${SHA.slice(0, 12)}#qualification#a1`;
const PREFLIGHT_KEY = `${PAID_KEY}#preflight`;

interface FakeRun { id: number; status: string; conclusion: string | null; title: string; headSha: string }
interface QueueRun { id: number; createdAt: string; status: string; title: string; slotJob: { status: string; conclusion: string | null } | null }

function fakeGitHub(options: {
  runs?: FakeRun[];
  checkpoints?: number;
  /** Per dispatch request: 'accept' creates the run; 'lose' creates it and reports failure; 'refuse' creates nothing. */
  answers?: Array<'accept' | 'lose' | 'refuse'>;
  /** Polls before a created run becomes visible in the listing. */
  listingLag?: number;
  /** How a created run ends when polled. */
  finishAs?: 'success' | 'failure';
  /** What each read of the paid queue returns, in order; the last one repeats. A thrown Error is an unreadable queue. */
  queue?: Array<QueueRun[] | Error>;
  /** What each read of main returns, in order; the last one repeats. */
  mains?: string[];
}) {
  const runs: FakeRun[] = [...(options.runs ?? [])];
  const pending: Array<{ run: FakeRun; visibleAfter: number }> = [];
  let polls = 0;
  let nextId = 1000;
  const dispatched: string[][] = [];
  let queueReads = 0;
  let mainReads = 0;
  return {
    dispatched,
    queueReads: () => queueReads,
    github: {
      mainSha: () => { const mains = options.mains ?? [SHA]; mainReads += 1; return mains[Math.min(mainReads - 1, mains.length - 1)]!; },
      queueRuns: () => {
        const snapshots = options.queue ?? [[]];
        queueReads += 1;
        const snapshot = snapshots[Math.min(queueReads - 1, snapshots.length - 1)]!;
        if (snapshot instanceof Error) throw snapshot;
        return snapshot.map((run) => ({ ...run }));
      },
      acceptedCheckpoints: () => options.checkpoints ?? 1,
      runs: () => {
        polls += 1;
        for (const entry of [...pending]) {
          if (polls >= entry.visibleAfter) { runs.push(entry.run); pending.splice(pending.indexOf(entry), 1); }
        }
        return runs.map((run) => ({ ...run }));
      },
      run: (id: number) => {
        const run = runs.find((candidate) => candidate.id === id)!;
        run.status = 'completed';
        run.conclusion = options.finishAs ?? 'success';
        return { ...run };
      },
      dispatch: (args: string[]) => {
        dispatched.push(args);
        const answer = (options.answers ?? [])[dispatched.length - 1] ?? 'accept';
        if (answer === 'refuse') return false;
        const field = (name: string) => args[args.indexOf('-f', args.findIndex((arg) => arg.startsWith(`${name}=`)) - 1) + 1]?.split('=').slice(1).join('=');
        const key = field('dispatch_key');
        const lane = field('lane');
        const mission = field('mission');
        const paid = args.includes('confirm_live=RUN LIVE MISSION');
        const run: FakeRun = { id: nextId += 1, status: 'queued', conclusion: null, headSha: SHA, title: `julius mission=${mission} lane=${lane} mode=${paid ? 'paid' : 'preflight'} key=${key}` };
        pending.push({ run, visibleAfter: polls + 1 + (options.listingLag ?? 0) });
        return answer === 'accept';
      },
    },
  };
}

const deps = (github: unknown, contractOk = true) => ({
  github,
  checkContract: () => (contractOk ? { ok: true } : { ok: false, detail: 'lane "lab" is not granted' }),
  sleep: async () => {},
  log: () => {},
});

describe('the key names the attempt', () => {
  it('is deterministic and distinguishes paid from preflight', () => {
    expect(dispatchKey({ mission: 'julius-continuous-1', mainSha: SHA, lane: 'qualification', attempt: 1, paid: true })).toBe(PAID_KEY);
    expect(dispatchKey({ mission: 'julius-continuous-1', mainSha: SHA, lane: 'qualification', attempt: 1, paid: false })).toBe(PREFLIGHT_KEY);
    expect(() => dispatchKey({ mission: 'Bad', mainSha: SHA, lane: 'lab', attempt: 1, paid: true })).toThrow();
    expect(() => dispatchKey({ mission: 'm', mainSha: SHA, lane: 'urgent', attempt: 1, paid: true })).toThrow();
  });

  it('dispatches with the key, the lane and the typed confirmation only when paid', () => {
    const paid = dispatchArgs({ mission: 'm', lane: 'lab', key: 'm@0845c593a8eb#lab#a1', paid: true });
    expect(paid).toContain('confirm_live=RUN LIVE MISSION');
    expect(paid).toContain('dispatch_key=m@0845c593a8eb#lab#a1');
    expect(dispatchArgs({ mission: 'm', lane: 'lab', key: 'k'.repeat(8), paid: false })).not.toContain('confirm_live=RUN LIVE MISSION');
  });
});

describe('an ambiguous dispatch never becomes two runs', () => {
  it('GitHub creates the run and loses the answer: exactly ONE request, the run is found by its key', async () => {
    const fake = fakeGitHub({ answers: ['lose'], listingLag: 2 });
    const result = await dispatchOnce({ github: fake.github, key: PAID_KEY, sleep: async () => {}, log: () => {},
      args: dispatchArgs({ mission: 'julius-continuous-1', lane: 'qualification', key: PAID_KEY, paid: true }) });
    expect(fake.dispatched).toHaveLength(1);
    expect(result.outcome).toBe('DISPATCHED');
  });

  it('a request that truly created nothing is retried — and only after reconciliation found nothing', async () => {
    const fake = fakeGitHub({ answers: ['refuse', 'accept'] });
    const result = await dispatchOnce({ github: fake.github, key: PAID_KEY, sleep: async () => {}, log: () => {},
      args: dispatchArgs({ mission: 'julius-continuous-1', lane: 'qualification', key: PAID_KEY, paid: true }), reconcileMs: 30_000, pollMs: 10_000 });
    expect(fake.dispatched).toHaveLength(2);
    expect(result.outcome).toBe('DISPATCHED');
  });

  it('a GitHub that never lists the run is given up on after a bounded number of requests', async () => {
    const fake = fakeGitHub({ answers: ['refuse', 'refuse', 'refuse', 'refuse'] });
    const result = await dispatchOnce({ github: fake.github, key: PAID_KEY, sleep: async () => {}, log: () => {},
      args: [], reconcileMs: 20_000, pollMs: 10_000 });
    expect(fake.dispatched).toHaveLength(3);
    expect(result).toMatchObject({ outcome: 'REFUSED', reason: 'dispatch_unconfirmed_after_retries' });
  });

  it('a key already queued or running dispatches nothing', async () => {
    const fake = fakeGitHub({ runs: [{ id: 5, status: 'queued', conclusion: null, headSha: SHA, title: `julius mission=julius-continuous-1 lane=qualification mode=paid key=${PAID_KEY}` }] });
    const result = await dispatchOnce({ github: fake.github, key: PAID_KEY, sleep: async () => {}, log: () => {}, args: [] });
    expect(fake.dispatched).toHaveLength(0);
    expect(result).toMatchObject({ outcome: 'ALREADY_IN_FLIGHT', run: { id: 5 } });
  });

  it('a completed key is consumed: a retry must bump the attempt', () => {
    const runs = [{ id: 6, status: 'completed', conclusion: 'failure', headSha: SHA, title: `julius mission=julius-continuous-1 lane=qualification mode=paid key=${PAID_KEY}` }];
    expect(keyState(runs, PAID_KEY).state).toBe('CONSUMED');
  });
});

const PREFLIGHT_DONE: FakeRun = { id: 70, status: 'completed', conclusion: 'success', headSha: SHA, title: `julius mission=julius-live-mission-6 lane=lab mode=preflight key=julius-live-mission-6@${SHA.slice(0, 12)}#lab#a1#preflight` };
const queued = (id: number, lane: string, state: 'holding' | 'waiting', createdAt = '2026-09-13T10:00:00Z'): QueueRun => ({
  id, createdAt, status: 'in_progress', title: `julius mission=m${id} lane=${lane} mode=paid key=m${id}@${SHA.slice(0, 12)}#${lane}#a1`,
  slotJob: state === 'holding' ? { status: 'completed', conclusion: 'success' } : { status: 'in_progress', conclusion: null },
});
const paidRequests = (fake: { dispatched: string[][] }) => fake.dispatched.filter((args) => args.includes('confirm_live=RUN LIVE MISSION'));
const mission6 = { mission: 'julius-live-mission-6', lane: 'lab', paid: true, holdPollMs: 5 * 60_000, maxHoldMs: 30 * 60_000 };

describe('a paid run joins the queue only when it can outwait what is ahead of it', () => {
  it('the depth limit is what the workflow’s two timeouts allow: the admission wait fits one whole paid job', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/julius-first-live-mission.yml'), 'utf8');
    const slot = workflow.slice(workflow.indexOf('\n  paid-slot:\n'), workflow.indexOf('\n  first-live-mission:\n'));
    const paid = workflow.slice(workflow.indexOf('\n  first-live-mission:\n'));
    const minutes = (text: string) => Number(/^\s*timeout-minutes:\s*(\d+)\s*$/mu.exec(text)![1]);
    expect(Math.floor(minutes(slot) / minutes(paid))).toBe(MAX_PAID_RUNS_AHEAD);
  });

  it('TWO runs ahead: the paid request is never made, and the hold ends in a refusal that spent nothing', async () => {
    const fake = fakeGitHub({ runs: [PREFLIGHT_DONE], queue: [[queued(1, 'lab', 'holding'), queued(2, 'lab', 'waiting')]] });
    const result = await runPaidDispatch(mission6, deps(fake.github));
    expect(result).toMatchObject({ outcome: 'REFUSED', reason: 'queue_still_too_deep', ahead: 2 });
    expect(paidRequests(fake)).toHaveLength(0);
    expect(fake.queueReads()).toBe(7);
  });

  it('ONE run ahead: the paid request is made', async () => {
    const fake = fakeGitHub({ runs: [PREFLIGHT_DONE], queue: [[queued(1, 'qualification', 'holding')]] });
    const result = await runPaidDispatch(mission6, deps(fake.github));
    expect(result.outcome).toBe('DISPATCHED');
    expect(paidRequests(fake)).toHaveLength(1);
  });

  it('a queue that drains while the dispatch is held is joined as soon as it can be', async () => {
    const deep = [queued(1, 'lab', 'holding'), queued(2, 'lab', 'waiting')];
    const fake = fakeGitHub({ runs: [PREFLIGHT_DONE], queue: [deep, deep, [queued(2, 'lab', 'holding')]] });
    const result = await runPaidDispatch(mission6, deps(fake.github));
    expect(result.outcome).toBe('DISPATCHED');
    expect(fake.queueReads()).toBe(3);
    expect(paidRequests(fake)).toHaveLength(1);
  });

  it('a waiting run of a lower-priority lane is not ahead: a qualification dispatch counts only the holder', () => {
    const runs = [queued(1, 'lab', 'holding'), queued(2, 'lab', 'waiting'), queued(3, 'regression', 'waiting')];
    expect(paidRunsAhead(runs, 'qualification')).toEqual({ ahead: 1, holders: [1], waiting: [] });
    expect(paidRunsAhead(runs, 'lab')).toEqual({ ahead: 2, holders: [1], waiting: [2] });
    expect(paidRunsAhead(runs, 'regression')).toEqual({ ahead: 3, holders: [1], waiting: [2, 3] });
  });

  it('main moving during the hold refuses, because the preflight proved the older rig', async () => {
    const deep = [queued(1, 'lab', 'holding'), queued(2, 'lab', 'waiting')];
    const fake = fakeGitHub({ runs: [PREFLIGHT_DONE], queue: [deep, [queued(2, 'lab', 'holding')]], mains: [SHA, 'e'.repeat(40)] });
    const result = await runPaidDispatch(mission6, deps(fake.github));
    expect(result).toMatchObject({ outcome: 'REFUSED', reason: 'main_moved_while_holding' });
    expect(paidRequests(fake)).toHaveLength(0);
  });

  it('an unreadable queue holds rather than dispatching', async () => {
    const fake = fakeGitHub({ runs: [PREFLIGHT_DONE], queue: [new Error('github_queue_unreadable')] });
    const result = await runPaidDispatch(mission6, deps(fake.github));
    expect(result).toMatchObject({ outcome: 'REFUSED', reason: 'queue_unreadable_while_holding' });
    expect(paidRequests(fake)).toHaveLength(0);
  });
});

describe('the paid dispatch enters the queue only after the rig proved itself for free', () => {
  it('no preflight at this main: the preflight is dispatched and awaited first, then exactly one paid request', async () => {
    const fake = fakeGitHub({});
    const result = await runPaidDispatch({ mission: 'julius-continuous-1', lane: 'qualification', paid: true }, deps(fake.github));
    expect(result.outcome).toBe('DISPATCHED');
    expect(fake.dispatched).toHaveLength(2);
    expect(fake.dispatched[0]).not.toContain('confirm_live=RUN LIVE MISSION');
    expect(fake.dispatched[1]).toContain('confirm_live=RUN LIVE MISSION');
    expect(fake.dispatched[1]).toContain(`dispatch_key=${PAID_KEY}`);
  });

  it('a failed preflight refuses the paid dispatch: no paid request is ever made', async () => {
    const fake = fakeGitHub({ finishAs: 'failure' });
    const result = await runPaidDispatch({ mission: 'julius-continuous-1', lane: 'qualification', paid: true }, deps(fake.github));
    expect(result).toMatchObject({ outcome: 'REFUSED', reason: 'preflight_blocked' });
    expect(fake.dispatched.filter((args) => args.includes('confirm_live=RUN LIVE MISSION'))).toHaveLength(0);
  });

  it('a successful preflight at THIS main is reused; one at an older main is not', async () => {
    const reused = fakeGitHub({ runs: [{ id: 7, status: 'completed', conclusion: 'success', headSha: SHA, title: `julius mission=julius-continuous-1 lane=qualification mode=preflight key=${PREFLIGHT_KEY}` }] });
    await runPaidDispatch({ mission: 'julius-continuous-1', lane: 'qualification', paid: true }, deps(reused.github));
    expect(reused.dispatched).toHaveLength(1);

    const stale = fakeGitHub({ runs: [{ id: 8, status: 'completed', conclusion: 'success', headSha: 'f'.repeat(40), title: 'julius mission=julius-continuous-1 lane=qualification mode=preflight key=none' }] });
    await runPaidDispatch({ mission: 'julius-continuous-1', lane: 'qualification', paid: true }, deps(stale.github));
    expect(stale.dispatched, 'a preflight of another main proves another rig').toHaveLength(2);
  });

  it('refuses before any request when main is not accepted or the contract refuses the lane', async () => {
    const unaccepted = fakeGitHub({ checkpoints: 0 });
    expect(await runPaidDispatch({ mission: 'julius-continuous-1', lane: 'qualification', paid: true }, deps(unaccepted.github)))
      .toMatchObject({ outcome: 'REFUSED', reason: 'main_not_accepted' });
    expect(unaccepted.dispatched).toHaveLength(0);

    const wrongLane = fakeGitHub({});
    expect(await runPaidDispatch({ mission: 'julius-continuous-1', lane: 'lab', paid: true }, deps(wrongLane.github, false)))
      .toMatchObject({ outcome: 'REFUSED', reason: 'contract_refused' });
    expect(wrongLane.dispatched).toHaveLength(0);
  });

  it('the same paid attempt asked for twice, by two sessions, is one run', async () => {
    const fake = fakeGitHub({ runs: [{ id: 9, status: 'completed', conclusion: 'success', headSha: SHA, title: `julius mission=julius-continuous-1 lane=qualification mode=preflight key=${PREFLIGHT_KEY}` }] });
    const first = await runPaidDispatch({ mission: 'julius-continuous-1', lane: 'qualification', paid: true }, deps(fake.github));
    const second = await runPaidDispatch({ mission: 'julius-continuous-1', lane: 'qualification', paid: true }, deps(fake.github));
    expect(first.outcome).toBe('DISPATCHED');
    expect(second.outcome).toBe('ALREADY_IN_FLIGHT');
    expect(fake.dispatched.filter((args) => args.includes('confirm_live=RUN LIVE MISSION'))).toHaveLength(1);
  });
});
