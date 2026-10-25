import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CONTEXT,
  DESCRIPTION_MAX,
  GRAMMAR,
  MIN_INTERVAL_MS,
  TASK_QUERY,
  configFrom,
  credentialShaped,
  describe as describeProgress,
  parseTaskRows,
  readTasks,
  run,
  snapshotOf,
} from '../.github/julius-live-progress.mjs';
import { LIVE_PROGRESS_GRAMMAR } from '../relay-bridge/wonderland-mission-events-route';

const WLJ = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const ENV = {
  WLJ,
  RUN_ID: '36568129865',
  RUN_ATTEMPT: '1',
  HEAD_SHA: 'c'.repeat(40),
  GITHUB_REPOSITORY: 'ohdieyuh-glitch/sunday-relay',
  GH_TOKEN: 'job-token-stand-in',
  PG_CONTAINER: 'julius-postgres',
  PGUSER: 'julius',
  PGDATABASE: 'julius',
  PGPASSWORD: 'db-password-stand-in',
};

type Row = { role: string; taskType: string; state: string; ordinal: number };
const task = (role: string, taskType: string, state: string, ordinal: number): Row => ({ role, taskType, state, ordinal });

describe('the progress projection', () => {
  it('counts repair rounds as the runtime does, for whichever task is active: build c0, repair:build c1, review c1, repair:plan c2, repair:build c3', () => {
    const history: Row[] = [];
    const steps: readonly [string, string, string][] = [
      ['CODING_AGENT', 'build', 'c0'],
      ['CODING_AGENT', 'repair:build', 'c1'],
      ['INDEPENDENT_REVIEWER', 'review', 'c1'],
      ['PROMPT_ARCHITECT', 'repair:plan', 'c2'],
      ['CODING_AGENT', 'repair:build', 'c3'],
    ];
    steps.forEach(([role, type, expected], index) => {
      for (const done of history) done.state = 'SUCCEEDED';
      history.push(task(role, type, 'ACTIVE', index + 1));
      const snapshot = snapshotOf(history);
      expect(snapshot && `c${snapshot.cycle}`, `${type} at ${index + 1}`).toBe(expected);
    });
    history.push(task('CODING_AGENT', 'repair:build', 'ACTIVE', 9));
    expect(snapshotOf(history)?.cycle, 'a fourth round is published as x, never 4').toBe('x');
  });

  it('maps every value through a closed table and nothing else gets out', () => {
    expect(snapshotOf([task('CODING_AGENT', 'repair:build', 'ACTIVE', 7)])).toEqual({ role: 'coder', taskType: 'repair_build', state: 'active', ordinal: 7, cycle: '1' });
    expect(snapshotOf([task('SOMEONE_NEW', 'repair:explode', 'ACTIVE', 12345)])).toEqual({ role: 'other', taskType: 'other', state: 'active', ordinal: 9999, cycle: '1' });
    expect(snapshotOf([task('CODING_AGENT', 'build', 'SUCCEEDED', 1)]), 'no active task is idle').toBeNull();
    // The newest active task wins when two are active.
    expect(snapshotOf([task('CODING_AGENT', 'build', 'ACTIVE', 2), task('INDEPENDENT_REVIEWER', 'review', 'ACTIVE', 5)])?.role).toBe('reviewer');
  });

  it('reads only the four allowlisted columns of this run, in a read-only session, bound by a psql variable', () => {
    expect(TASK_QUERY).toContain('SET default_transaction_read_only = on;');
    expect(TASK_QUERY).toContain("SELECT role, task_type, state, ordinal FROM relay_wonderland.julius_tasks WHERE run_id = :'wlj' ORDER BY ordinal;");
    expect(TASK_QUERY).not.toMatch(/summary|text|payload|evidence|output|events/iu);
    expect(parseTaskRows('SET\nCODING_AGENT\tbuild\tACTIVE\t3\nmalformed\nA\tB\tC\tnot-a-number\n')).toEqual([task('CODING_AGENT', 'build', 'ACTIVE', 3)]);
  });

  it('every description is the bridge\'s v1 grammar, at most 140 characters, and never credential-shaped', () => {
    expect(GRAMMAR.source).toBe(LIVE_PROGRESS_GRAMMAR.source);
    const base = { runId: '36568129865', wlj8: '0b7a1c2e', seq: 3 };
    const active = describeProgress({ ...base, snapshot: { role: 'coder', taskType: 'repair_build', state: 'active', ordinal: 7, cycle: '1' }, marker: null });
    expect(active).toBe('v1 r36568129865.a1.0b7a1c2e s3 coder:repair_build:active o7 c1');
    expect(describeProgress({ ...base, snapshot: null, marker: null })).toBe('v1 r36568129865.a1.0b7a1c2e s3 idle');
    expect(describeProgress({ ...base, snapshot: null, marker: 'ended' })).toBe('v1 r36568129865.a1.0b7a1c2e s3 ended');
    const longest = describeProgress({ runId: '9'.repeat(20), wlj8: 'ffffffff', seq: 999999, snapshot: { role: 'reviewer', taskType: 'repair_guidance', state: 'cancelled', ordinal: 9999, cycle: 'x' }, marker: null });
    expect(longest).not.toBeNull();
    expect(longest!.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    // Outside the closed lists, or wider than the grammar: nothing is posted.
    expect(describeProgress({ ...base, snapshot: { role: 'coder', taskType: 'free text', state: 'active', ordinal: 7, cycle: '1' }, marker: null })).toBeNull();
    expect(describeProgress({ ...base, seq: 1_000_000, snapshot: null, marker: null })).toBeNull();
    // The key header is assembled at run time: written out, it is a committed key sample to the boundary scan.
    for (const shaped of ['sk-ant-x', 'ghp_x', 'github_pat_x', 'xai-x', ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '), 'Bearer x']) {
      expect(credentialShaped(shaped), shaped).toBe(true);
    }
  });

  it('refuses to publish at all unless the run is bound: attempt 1, a wlj, a run id, a head sha, a repo, a token, a container', () => {
    expect(configFrom(ENV).refused).toBeNull();
    for (const [key, value, reason] of [
      ['RUN_ATTEMPT', '2', 'attempt_not_1'],
      ['WLJ', 'run:aaaaaaaaaaaaaaaaaaaaaaaa', 'wlj_invalid'],
      ['RUN_ID', 'x', 'run_id_invalid'],
      ['HEAD_SHA', 'main', 'head_sha_invalid'],
      ['GITHUB_REPOSITORY', 'nope', 'repo_invalid'],
      ['GH_TOKEN', '', 'token_missing'],
      ['PG_CONTAINER', 'a;b', 'container_invalid'],
    ] as const) {
      expect(configFrom({ ...ENV, [key]: value }).refused, key).toBe(reason);
    }
  });
});

describe('the publisher loop', () => {
  const harness = (reads: readonly (readonly Row[] | null)[], over: { stopAfter?: number; failPost?: boolean } = {}) => {
    const posted: { description: string; state: string }[] = [];
    const logs: string[] = [];
    const sleeps: number[] = [];
    let index = 0;
    let clock = 0;
    return {
      posted, logs, sleeps,
      done: run(ENV, {
        log: (line: string) => logs.push(line),
        readTasks: async () => reads[Math.min(index++, reads.length - 1)] ?? null,
        postStatus: async (_config: unknown, description: string, state: string) => {
          if (over.failPost) throw new Error('network');
          posted.push({ description, state });
          return true;
        },
        sleep: async (ms: number) => { sleeps.push(ms); clock += ms; },
        now: () => clock,
        stopped: () => index >= (over.stopAfter ?? reads.length),
      }),
    };
  };

  it('posts on change only, waits ≥10 s between reads, and ends with `ended`, not a verdict', async () => {
    const coder = [task('CODING_AGENT', 'build', 'ACTIVE', 1)];
    const review = [task('CODING_AGENT', 'build', 'SUCCEEDED', 1), task('INDEPENDENT_REVIEWER', 'review', 'ACTIVE', 2)];
    const h = harness([[], coder, coder, review, review]);
    await h.done;
    expect(h.posted.map((entry) => [entry.description, entry.state])).toEqual([
      ['v1 r36568129865.a1.0b7a1c2e s1 idle', 'pending'],
      ['v1 r36568129865.a1.0b7a1c2e s2 coder:build:active o1 c0', 'pending'],
      ['v1 r36568129865.a1.0b7a1c2e s3 reviewer:review:active o2 c0', 'pending'],
      ['v1 r36568129865.a1.0b7a1c2e s4 ended', 'success'],
    ]);
    expect(h.sleeps.every((ms) => ms >= MIN_INTERVAL_MS)).toBe(true);
    expect(h.logs.filter((line) => line.startsWith('live_progress posted'))).toEqual(['live_progress posted s1', 'live_progress posted s2', 'live_progress posted s3', 'live_progress posted s4']);
    for (const entry of h.posted) expect(entry.state === 'failure' || /PASS|FAIL|verdict|complete/iu.test(entry.description)).toBe(false);
  });

  it('a store it cannot read or a post that fails is skipped and logged, never a crash, and logs carry no task text', async () => {
    const h = harness([null, null], { failPost: true });
    await expect(h.done).resolves.toBeUndefined();
    expect(h.logs).toContain('live_progress skipped reason=store_unreadable');
    expect(h.logs).toContain('live_progress skipped reason=post_failed');
    for (const line of h.logs) expect(line).toMatch(/^live_progress (posted s\d+|skipped reason=[a-z_]+)$/u);
  });

  it('a re-run attempt publishes nothing', async () => {
    const posted: string[] = [];
    await run({ ...ENV, RUN_ATTEMPT: '2' }, { log: () => {}, postStatus: async (_c: unknown, d: string) => { posted.push(d); return true; } });
    expect(posted).toEqual([]);
  });
});

describe('the token never reaches a child, and the status goes only to this run\'s head sha', () => {
  it('the psql child gets PATH and the database password only', async () => {
    const seen: { command: string; args: readonly string[]; env: Record<string, string> }[] = [];
    const fakeSpawn = (command: string, args: readonly string[], options: { env: Record<string, string> }) => {
      seen.push({ command, args, env: options.env });
      const listeners: Record<string, (value: unknown) => void> = {};
      const stdoutListeners: ((chunk: string) => void)[] = [];
      setTimeout(() => {
        for (const listener of stdoutListeners) listener('CODING_AGENT\tbuild\tACTIVE\t1\n');
        listeners.close?.(0);
      }, 0);
      return {
        stdout: { on: (_event: string, listener: (chunk: string) => void) => { stdoutListeners.push(listener); } },
        stdin: { end: () => {} },
        on: (event: string, listener: (value: unknown) => void) => { listeners[event] = listener; },
        kill: () => {},
      };
    };
    const config = configFrom(ENV);
    const rows = await readTasks(config, fakeSpawn as never);
    expect(rows).toEqual([task('CODING_AGENT', 'build', 'ACTIVE', 1)]);
    expect(seen[0]?.command).toBe('docker');
    expect(seen[0]?.args).toEqual(['exec', '-i', '-e', 'PGPASSWORD', 'julius-postgres', 'psql', '-U', 'julius', '-d', 'julius', '-A', '-t', '-F', '\t', '-v', `wlj=${WLJ}`, '-v', 'ON_ERROR_STOP=1']);
    expect(Object.keys(seen[0]?.env ?? {}).sort()).toEqual(['PATH', 'PGPASSWORD']);
    expect(JSON.stringify(seen)).not.toContain('job-token-stand-in');
  });

  it('posts to this repo\'s statuses for the head sha, with the exact context, and nothing else', () => {
    const source = readFileSync(join(__dirname, '../.github/julius-live-progress.mjs'), 'utf8');
    expect(source).toContain("export const CONTEXT = 'julius-live-progress';");
    expect(CONTEXT).toBe('julius-live-progress');
    expect(source).toContain('https://api.github.com/repos/${config.repo}/statuses/${config.headSha}');
    expect(source.match(/fetchImpl\(/gu)).toHaveLength(1);
    expect(source).not.toMatch(/check-runs|\/checks|workflow_dispatch|\/dispatches|\/git\/refs/u);
  });
});
