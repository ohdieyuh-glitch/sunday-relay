import { describe, expect, it } from 'vitest';
import {
  GitHubApiError,
  classifyProviderFailure,
  decidePaidSlot,
  derivePaidRunState,
  parseRunTitle,
  paidRunAttemptRefusal,
  pinnedModelsFrom,
  waitForPaidSlot,
} from './julius-paid-slot.mjs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * THE PAID PROVIDER SLOT, PROVEN BY CALLING THE RULE.
 *
 * One paid Julius run at a time, in the order the lanes say, with nothing ever
 * cancelled and nothing ever preempted — and with every uncertainty (an API
 * error, a lagging listing, an unreadable title) resolved toward WAITING, never
 * toward spending. Every case below is a listing the Actions API could return,
 * handed to the same pure function the `paid-slot` job runs.
 */

const T = (minute: number): string => new Date(Date.UTC(2026, 8, 13, 0, minute)).toISOString();
const title = (mission: string, lane: string, key = 'none', mode = 'paid'): string =>
  `julius mission=${mission} lane=${lane} mode=${mode} key=${key}`;

type Slot = { status: string; conclusion: string | null } | null;
interface Run { id: number; createdAt: string; status: string; title: string; slotJob: Slot }

const WAITING: Slot = { status: 'in_progress', conclusion: null };
const ADMITTED: Slot = { status: 'completed', conclusion: 'success' };

const qualification = (id: number, minute: number, slotJob: Slot = WAITING, status = 'in_progress'): Run =>
  ({ id, createdAt: T(minute), status, title: title('julius-continuous-1', 'qualification', `julius-continuous-1@aaaaaaaaaaaa#qualification#a${id}`), slotJob });
const lab = (id: number, minute: number, slotJob: Slot = WAITING, status = 'in_progress'): Run =>
  ({ id, createdAt: T(minute), status, title: title('julius-lab-eval-1', 'lab', `julius-lab-eval-1@aaaaaaaaaaaa#lab#a${id}`), slotJob });

const decide = (self: Run, runs: Run[]) => decidePaidSlot({ self, runs });

describe('the title is an exact grammar', () => {
  it('reads what the workflow writes', () => {
    expect(parseRunTitle(title('julius-continuous-1', 'qualification', 'julius-continuous-1@0845c593a8eb#qualification#a1')))
      .toEqual({ mission: 'julius-continuous-1', lane: 'qualification', mode: 'paid', key: 'julius-continuous-1@0845c593a8eb#qualification#a1' });
    expect(parseRunTitle(title('julius-continuous-1', 'unspecified', 'none', 'preflight'))?.mode).toBe('preflight');
  });

  it('refuses a paid run with no lane, an unknown lane and a smuggled second assignment', () => {
    expect(parseRunTitle(title('m', 'unspecified'))).toBeNull();
    expect(parseRunTitle(title('m', 'urgent'))).toBeNull();
    expect(parseRunTitle('julius mission=m lane=lab mode=preflight mode=paid key=none')).toBeNull();
    expect(parseRunTitle('Julius first live mission')).toBeNull();
  });
});

describe('qualification has priority, and nothing preempts an admitted run', () => {
  it('qualification HOLDS the slot and a lab dispatch arrives: the lab run waits, the qualification is untouched', () => {
    const q = qualification(10, 0, ADMITTED);
    const l = lab(11, 5);
    const decision = decide(l, [q, l]);
    expect(decision.decision).toBe('WAIT');
    expect(decision).toMatchObject({ holder: 10, reason: 'slot_held' });
    // And the holder, asked again, is not told to do anything: it is past admission.
    expect(derivePaidRunState({ runs: [q, l], lastCompleted: null }).state).toBe('QUALIFICATION_ACTIVE');
  });

  it('the queued lab run PROCEEDS once the qualification completes', () => {
    const q = qualification(10, 0, ADMITTED, 'completed');
    const l = lab(11, 5);
    expect(decide(l, [q, l]).decision).toBe('PROCEED');
  });

  it('a qualification dispatched AFTER a waiting lab run goes ahead of it', () => {
    const l = lab(11, 0);
    const q = qualification(12, 5);
    expect(decide(q, [l, q]).decision).toBe('PROCEED');
    expect(decide(l, [l, q])).toMatchObject({ decision: 'WAIT', reason: 'not_first_in_queue', ahead: [12] });
  });

  it('but a qualification never preempts a lab run that was already ADMITTED', () => {
    const l = lab(11, 0, ADMITTED);
    const q = qualification(12, 5);
    expect(decide(q, [l, q])).toMatchObject({ decision: 'WAIT', holder: 11, reason: 'slot_held' });
    expect(derivePaidRunState({ runs: [l, q], lastCompleted: null }).state).toBe('LAB_ACTIVE');
  });

  it('two lab runs never overlap: the earlier proceeds, the later waits while it holds, then proceeds', () => {
    const a = lab(20, 0);
    const b = lab(21, 1);
    expect(decide(a, [a, b]).decision).toBe('PROCEED');
    expect(decide(b, [a, b]).decision).toBe('WAIT');
    const admitted = { ...a, slotJob: ADMITTED };
    expect(decide(b, [admitted, b])).toMatchObject({ decision: 'WAIT', holder: 20 });
    expect(decide(b, [{ ...admitted, status: 'completed' }, b]).decision).toBe('PROCEED');
  });

  it('the queue order is lane, then arrival, then run id — and never the order of the listing', () => {
    const runs = [lab(33, 0), qualification(32, 9), lab(31, 0)];
    const order = runs.map((run) => decide(run, runs).decision);
    expect(order).toEqual(['WAIT', 'PROCEED', 'WAIT']);
    const reversed = [...runs].reverse();
    expect(decide(runs[1]!, reversed).decision).toBe('PROCEED');
    const noQualification = [lab(33, 0), lab(31, 0)];
    expect(decide(noQualification[1]!, noQualification).decision, 'equal arrival: the smaller run id goes first').toBe('PROCEED');
  });
});

describe('uncertainty always means waiting', () => {
  it('an unparseable live run waits at the lowest priority: it never jumps a lab run, and never vanishes', () => {
    const odd: Run = { id: 40, createdAt: T(0), status: 'in_progress', title: 'julius mission=x lane=?? mode=paid key=none', slotJob: WAITING };
    const l = lab(41, 5);
    expect(decide(l, [odd, l]).decision, 'a malformed dispatch cannot hold the queue').toBe('PROCEED');
    // …but an ADMITTED run holds the slot whether or not its title can be read.
    expect(decide(l, [{ ...odd, slotJob: ADMITTED }, l])).toMatchObject({ decision: 'WAIT', holder: 40 });
  });

  it('a listing that does not include this run is too old to decide on', () => {
    const l = lab(50, 0);
    expect(decide(l, [])).toMatchObject({ decision: 'WAIT', reason: 'self_not_listed' });
  });

  it('a malformed listing, or a self title that is not a paid run, never proceeds', () => {
    const l = lab(51, 0);
    expect(decidePaidSlot({ self: l, runs: [l, { id: 'x' } as never] })).toMatchObject({ decision: 'WAIT', reason: 'run_list_malformed' });
    expect(decidePaidSlot({ self: l, runs: null as never })).toMatchObject({ decision: 'WAIT' });
    const preflight = { ...l, title: title('m', 'lab', 'none', 'preflight') };
    expect(decide(preflight, [preflight])).toMatchObject({ decision: 'WAIT', reason: 'self_title_unparseable' });
  });

  it('preflight runs never compete for the slot', () => {
    const dry: Run = { id: 60, createdAt: T(0), status: 'in_progress', title: title('julius-continuous-1', 'unspecified', 'none', 'preflight'), slotJob: null };
    const l = lab(61, 5);
    expect(decide(l, [dry, l]).decision).toBe('PROCEED');
    expect(derivePaidRunState({ runs: [dry], lastCompleted: null }).state).toBe('IDLE');
  });
});

describe('a key spends once', () => {
  const key = 'julius-continuous-1@0845c593a8eb#qualification#a1';
  const withKey = (id: number, minute: number, slotJob: Slot, status = 'in_progress'): Run =>
    ({ id, createdAt: T(minute), status, title: title('julius-continuous-1', 'qualification', key), slotJob });

  it('two live runs with one key: the later refuses itself, the earlier is unaffected', () => {
    const first = withKey(70, 0, WAITING);
    const second = withKey(71, 0, WAITING);
    expect(decide(second, [first, second])).toEqual({ decision: 'REFUSE_DUPLICATE', original: 70 });
    expect(decide(first, [first, second]).decision).toBe('PROCEED');
  });

  it('a key whose run was admitted and completed is consumed', () => {
    const done = withKey(72, 0, ADMITTED, 'completed');
    const again = withKey(73, 9, WAITING);
    expect(decide(again, [done, again])).toEqual({ decision: 'REFUSE_DUPLICATE', original: 72 });
  });

  it('a key whose earlier run was refused BEFORE admission is not consumed', () => {
    const refused = withKey(74, 0, { status: 'completed', conclusion: 'failure' }, 'completed');
    const retry = withKey(75, 9, WAITING);
    expect(decide(retry, [refused, retry]).decision).toBe('PROCEED');
  });
});

describe('a paid run names its dispatch key, or it never spends (Decision C fix round 2)', () => {
  // The dispatch client never sends a paid request without a key (`dispatch_key_required`), but a hand dispatch from
  // the Actions page can, and its title then says `key=none`. That run competed for the slot and could spend like any
  // other, with no key to make a second one refuse itself. It is refused here, server-side, before the queue is read.
  const unkeyed = (id: number, minute: number): Run =>
    ({ id, createdAt: T(minute), status: 'in_progress', title: title('julius-learning-pair-1-without-1', 'lab'), slotJob: WAITING });

  it('a paid self with key=none refuses itself, even with the slot free and nobody ahead', () => {
    const self = unkeyed(100, 0);
    expect(parseRunTitle(self.title)).toMatchObject({ mode: 'paid', key: null });
    expect(decide(self, [self])).toEqual({ decision: 'REFUSE_UNKEYED' });
    expect(decide(self, [lab(99, 0, ADMITTED), self])).toEqual({ decision: 'REFUSE_UNKEYED' });
  });

  it('the wait stops at the first reading, in one line, with a code of its own, and nothing is spent', async () => {
    const self = unkeyed(101, 0);
    const lines: string[] = [];
    let reads = 0;
    let clock = 0;
    const code = await waitForPaidSlot({
      readState: async () => { reads += 1; return { self, runs: [self] }; },
      sleep: async (ms: number) => { clock += ms; }, now: () => clock, log: (line) => { lines.push(line); },
    });
    expect(code).toBe(6);
    expect(reads).toBe(1);
    expect(lines).toEqual(['paid_slot_dispatch_key_required: a paid run must carry the dispatch key scripts/julius-paid-dispatch.mjs mints; this run will not spend']);
  });

  it('a dry run is untouched: an unkeyed preflight title is not a paid run, and it does not hold up a paid one', () => {
    const dry: Run = { id: 102, createdAt: T(0), status: 'in_progress', title: title('julius-learning-pair-1-without-1', 'unspecified', 'none', 'preflight'), slotJob: null };
    expect(decide(dry, [dry])).toMatchObject({ decision: 'WAIT', reason: 'self_title_unparseable' });
    const keyed = lab(103, 5);
    expect(decide(keyed, [dry, keyed]).decision).toBe('PROCEED');
  });
});

describe('the waiting loop', () => {
  const clock = () => {
    let now = 0;
    return { now: () => now, sleep: async (ms: number) => { now += ms; } };
  };

  it('admits only after two PROCEED readings at least fifteen seconds apart', async () => {
    const { now, sleep } = clock();
    const l = lab(80, 0);
    let reads = 0;
    const code = await waitForPaidSlot({ readState: async () => { reads += 1; return { self: l, runs: [l] }; }, sleep, now, log: () => {} });
    expect(code).toBe(0);
    expect(reads, 'one reading is never enough').toBe(2);
  });

  it('the confirmation is a GAP IN TIME, not a count: fast polls need readings spanning fifteen seconds', async () => {
    const { now, sleep } = clock();
    const l = lab(82, 0);
    let reads = 0;
    const code = await waitForPaidSlot({ readState: async () => { reads += 1; return { self: l, runs: [l] }; }, sleep, now, log: () => {}, pollMs: 5_000 });
    expect(code).toBe(0);
    expect(reads, 'readings at 0, 5, 10 and 15 seconds: the fourth is the first a full gap after the first').toBe(4);
  });

  it('an API error between two PROCEEDs discards the first: unknown is not free', async () => {
    const { now, sleep } = clock();
    const l = lab(81, 0);
    const script: Array<'ok' | 'err'> = ['ok', 'err', 'ok', 'ok'];
    let reads = 0;
    const lines: string[] = [];
    const code = await waitForPaidSlot({
      readState: async () => {
        const step = script[Math.min(reads, script.length - 1)];
        reads += 1;
        if (step === 'err') throw new GitHubApiError('github_api_unreachable');
        return { self: l, runs: [l] };
      },
      sleep, now, log: (line: string) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(reads, 'the reading before the error did not count toward admission').toBe(4);
    expect(lines.some((line) => line.includes('state=UNKNOWN'))).toBe(true);
  });

  it('a run that errors forever is never admitted, and gives up without spending', async () => {
    const { now, sleep } = clock();
    const lines: string[] = [];
    const code = await waitForPaidSlot({
      readState: async () => { throw new GitHubApiError('github_api_http_502'); },
      sleep, now, log: (line: string) => lines.push(line), maxWaitMs: 30 * 60_000,
    });
    expect(code).toBe(4);
    expect(lines.at(-1)).toContain('paid_slot_wait_exhausted');
  });

  it('a duplicate exits 3 at once', async () => {
    const { now, sleep } = clock();
    const key = 'julius-continuous-1@0845c593a8eb#qualification#a1';
    const a: Run = { id: 90, createdAt: T(0), status: 'in_progress', title: title('julius-continuous-1', 'qualification', key), slotJob: WAITING };
    const b: Run = { ...a, id: 91 };
    expect(await waitForPaidSlot({ readState: async () => ({ self: b, runs: [a, b] }), sleep, now, log: () => {} })).toBe(3);
  });

  it('a waiting run keeps waiting while the qualification holds, and is admitted after it releases', async () => {
    const { now, sleep } = clock();
    const holding = qualification(100, 0, ADMITTED);
    const l = lab(101, 1);
    let reads = 0;
    const code = await waitForPaidSlot({
      readState: async () => {
        reads += 1;
        return { self: l, runs: [reads <= 5 ? holding : { ...holding, status: 'completed' }, l] };
      },
      sleep, now, log: () => {},
    });
    expect(code).toBe(0);
    expect(reads, 'five readings while held, then two to confirm').toBe(7);
  });
});

describe('status says what is true, and no more', () => {
  it('a failure in a gate or preflight step is PREFLIGHT_BLOCKED', () => {
    for (const failedStep of ['Gate: the dispatch inputs are well formed', 'Preflight: all three roles resolve to the expected models, nothing dispatched']) {
      expect(derivePaidRunState({ runs: [], lastCompleted: { id: 1, conclusion: 'failure', failedStep, logsRead: false, providerClass: null } }).state).toBe('PREFLIGHT_BLOCKED');
    }
  });

  it('a LIVE failure is PROVIDER_BLOCKED only when its log was read and shows a provider refusal', () => {
    const live = { id: 2, conclusion: 'failure', failedStep: 'LIVE: run the first real Julius mission' };
    expect(derivePaidRunState({ runs: [], lastCompleted: { ...live, logsRead: true, providerClass: 'INSUFFICIENT_QUOTA' } }).state).toBe('PROVIDER_BLOCKED');
    const unread = derivePaidRunState({ runs: [], lastCompleted: { ...live, logsRead: false, providerClass: null } });
    expect(unread.state).toBe('IDLE');
    expect(unread.lastLiveFailure, 'an unread failure is not classified').toBe('unclassified');
  });

  it('the provider classifier needs a provider\'s own wording, not a stray word', () => {
    expect(classifyProviderFailure('task failed code=AUTH_CONFIGURATION')).toBe('AUTH_CONFIGURATION');
    expect(classifyProviderFailure('{"error":{"type":"insufficient_quota"}}')).toBe('INSUFFICIENT_QUOTA');
    expect(classifyProviderFailure('Your credit balance is too low')).toBe('CREDIT_BALANCE');
    expect(classifyProviderFailure('the reviewer discussed quota policy in its findings')).toBeNull();
    expect(classifyProviderFailure('HTTP 429 rate limited, retrying')).toBeNull();
  });

  it('reads pinned models as keys, not as words in a comment', () => {
    const yaml = [
      '      # was OPENAI_PROMPT_ARCHITECT_MODEL: gpt-4o once',
      '      OPENAI_PROMPT_ARCHITECT_MODEL: gpt-5.6-sol',
      '      RELAY_HOSTED_CODING_MODEL: claude-fable-5',
      '      RELAY_HERMES_PROVIDER: xai',
      '      RELAY_HERMES_MODEL: grok-build-0.1',
    ].join('\n');
    expect(pinnedModelsFrom(yaml)).toEqual({ architect: 'gpt-5.6-sol', coder: 'claude-fable-5', reviewerProvider: 'xai', reviewerModel: 'grok-build-0.1' });
  });
});

/**
 * A GITHUB RE-RUN OF A PAID ARM NEVER SPENDS AGAIN (Decision C, audit F4, 2026-10-13). A re-run keeps its run id, so
 * its key is never a duplicate of itself, and arms 2-4 carry the typed rerun acknowledgement by design.
 */
describe('F4: only a first attempt is admitted', () => {
  it('attempt "1" passes; any later attempt, and an unknown one, is refused', () => {
    expect(paidRunAttemptRefusal('1')).toBeNull();
    for (const later of ['2', '3', '17']) expect(paidRunAttemptRefusal(later), later).toBe('paid_slot_rerun_refused');
    for (const unknown of [undefined, '', ' 1', '1 ', 'one', '01x']) expect(paidRunAttemptRefusal(unknown), String(unknown)).toBe('paid_slot_run_attempt_unknown');
  });

  it('the wait command refuses attempt 2 before it reads anything (exit 5), and lets attempt 1 through to the queue', () => {
    const script = resolve(import.meta.dirname, 'julius-paid-slot.mjs');
    const run = (attempt: string | undefined) => spawnSync(process.execPath, [script, 'wait', '--repo', 'owner/repo', '--run-id', '37300000002'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...(attempt === undefined ? {} : { GITHUB_RUN_ATTEMPT: attempt }) },
    });
    const second = run('2');
    expect(second.status, second.stderr).toBe(5);
    expect(second.stdout).toContain('paid_slot_rerun_refused: workflow run attempt 2 is not the first');
    const unknown = run(undefined);
    expect(unknown.status).toBe(5);
    expect(unknown.stdout).toContain('paid_slot_run_attempt_unknown: workflow run attempt unknown');
    // The first attempt passes the attempt check and stops at the next one (no token here), so no network is touched.
    const first = run('1');
    expect(first.status).toBe(2);
    expect(first.stderr).toContain('paid_slot_refused: github_token_missing');
    expect(first.stdout).not.toContain('paid_slot_rerun_refused');
  });
});
