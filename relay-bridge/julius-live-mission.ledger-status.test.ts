import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { JULIUS_LIVE_STEP_NAME, JULIUS_MISSION_JOB_NAME, JULIUS_PAID_WORKFLOW_PATH } from '../src/relay/mission/julius/julius-spend-ceiling';
import { ledgerStatusCommand } from './julius-live-mission';

/**
 * `ledger-status`: the read-only answer to "does another paid run fit?", for the operator-start tool and
 * for REVIEW. Three reads, one closed verdict, never FITS on anything that could not be read or that
 * disagrees with itself. These cases use the REAL contract and the REAL jobs body and LIVE-step log of
 * paid run 40520432789 (refused at its spend gate before any provider), beside a stand-in for the earlier
 * executed run whose charges are unreadable.
 */
const ROOT = process.cwd();
const CONTRACT = join(ROOT, '.github/julius-missions/julius-inworld-data-1/contract.json');
const JOBS = JSON.parse(readFileSync(join(ROOT, 'relay-bridge/julius/fixtures/run-40520432789.jobs.json'), 'utf8')) as { total_count: number; jobs: Record<string, unknown>[] };
const LOG = readFileSync(join(ROOT, 'relay-bridge/julius/fixtures/run-40520432789.live-step.txt'), 'utf8');
const REPO = 'ohdieyuh-glitch/sunday-relay';
const API = `https://api.github.com/repos/${REPO}`;
const HEAD = '598741524f87783baef99a2d6a40cf0dba8baa8c';
const NO_WAIT = { backoffMs: [0, 0, 0], sleep: async () => undefined } as const;

interface FakeRun {
  readonly wlj: string;
  readonly runId: number;
  readonly executed?: boolean;
  /** Serve the LIVE-step log (a refusal) or 404 it. */
  readonly log?: 'refusal' | 'missing';
}
const EXECUTED: FakeRun = { wlj: 'wlj_0c96b0f9-2879-4426-b464-fb132ae658fa', runId: 40299692757, executed: true, log: 'missing' };
const REFUSED: FakeRun = { wlj: 'wlj_7dd5ad76-ed4f-47c3-b3a6-5a2d9b38636a', runId: 40520432789, log: 'refusal' };
const REFUSED_NO_LOG: FakeRun = { ...REFUSED, log: 'missing' };
// The run of 2026-10-28 that reached the provider: executed, its evidence never uploaded.
const EXECUTED_2: FakeRun = { wlj: 'wlj_92f24bfc-3e6a-4e5f-a807-6c214fc19a42', runId: 40698923582, executed: true, log: 'missing' };

function jobsFor(run: FakeRun): unknown {
  const copy = JSON.parse(JSON.stringify(JOBS)) as { total_count: number; jobs: Record<string, unknown>[] };
  for (const job of copy.jobs) { job.run_id = run.runId; job.head_sha = HEAD; if (run.runId !== 40520432789) job.id = run.runId + 1; }
  if (run.executed === true) {
    const mission = copy.jobs.find((j) => j.name === JULIUS_MISSION_JOB_NAME) as { steps: Record<string, unknown>[] };
    (mission.steps.find((s) => s.name === JULIUS_LIVE_STEP_NAME) as Record<string, unknown>).conclusion = 'success';
  }
  return copy;
}

function github(runs: readonly FakeRun[], seenMethods: string[] = [], fault: (call: number, url: string) => 'throw' | undefined = () => undefined): typeof fetch {
  let call = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    call += 1;
    seenMethods.push((init?.method ?? 'GET').toUpperCase());
    if (fault(call, url) === 'throw') throw new TypeError('fetch failed');
    const suffix = (run: FakeRun): string => run.wlj.slice(4).replaceAll('-', '');
    if (url.endsWith('/matching-refs/tags/julius-run-spent-')) {
      return new Response(JSON.stringify(runs.map((run) => ({ ref: `refs/tags/julius-run-spent-${suffix(run)}`, object: { type: 'tag', sha: String(run.runId).padStart(40, '0') } }))), { status: 200 });
    }
    for (const run of runs) {
      const tagSha = String(run.runId).padStart(40, '0');
      if (url === `${API}/git/tags/${tagSha}`) {
        const message = ['julius-run-spent.v1', `run=${run.wlj}`, 'namespace=julius-inworld-data-1', 'reservedUsdMicros=30000000', `workflow_run_id=${String(run.runId)}`, 'workflow_run_attempt=1', `head_sha=${HEAD}`, ''].join('\n');
        return new Response(JSON.stringify({ message }), { status: 200 });
      }
      if (url === `${API}/actions/runs/${String(run.runId)}`) {
        return new Response(JSON.stringify({ id: run.runId, head_sha: HEAD, head_branch: 'main', event: 'workflow_dispatch', path: JULIUS_PAID_WORKFLOW_PATH, run_attempt: 1, status: 'completed', conclusion: 'failure' }), { status: 200 });
      }
      if (url.startsWith(`${API}/actions/runs/${String(run.runId)}/attempts/1/jobs`)) return new Response(JSON.stringify(jobsFor(run)), { status: 200 });
      if (url.startsWith(`${API}/actions/runs/${String(run.runId)}/artifacts`)) return new Response(JSON.stringify({ total_count: 0, artifacts: [] }), { status: 200 });
      const jobId = run.runId === 40520432789 ? 122247863302 : run.runId + 1;
      if (url === `${API}/actions/jobs/${String(jobId)}/logs`) {
        if (run.log === 'missing') return new Response('gone', { status: 404 });
        return new Response(null, { status: 302, headers: { location: 'https://logs.example.invalid/signed' } });
      }
    }
    if (url === 'https://logs.example.invalid/signed') return new Response(LOG, { status: 200 });
    return new Response('unexpected', { status: 404 });
  }) as typeof fetch;
}

async function status(fetchImpl: typeof fetch, extra: { reads?: number; contractPath?: string | null; readFile?: (p: string) => string } = {}): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await ledgerStatusCommand({
    contractPath: extra.contractPath === undefined ? CONTRACT : extra.contractPath,
    env: { GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: 'ghs_test_not_a_real_token' },
    out: (line) => { lines.push(line); },
    fetchImpl, transport: NO_WAIT, sleep: async () => undefined,
    ...(extra.reads === undefined ? {} : { reads: extra.reads }),
    ...(extra.readFile === undefined ? {} : { readFile: extra.readFile }),
  });
  return { code, lines };
}
const verdict = (lines: readonly string[]): string => lines.find((line) => line.startsWith('ledger_verdict=')) ?? 'none';

describe('ledger-status: does another paid run fit under the pair cap?', () => {
  it('FITS once the refused run is proved NOT_EXECUTED from its own log: one executed prior holds $30, the next $30 run fits, headroom $0', async () => {
    const { code, lines } = await status(github([EXECUTED, REFUSED]));
    expect(code).toBe(0);
    const priorLines = lines.filter((line) => line.startsWith('prior_run ') || line.startsWith('prior_runs ledger=')).sort().join('\n');
    const hash = createHash('sha256').update(`${priorLines}\n`, 'utf8').digest('hex');
    expect(verdict(lines)).toBe(`ledger_verdict=FITS reads=3 consistent=yes reason=none pair_cap_usd_micros=60000000 next_run_ceiling_usd_micros=30000000 prior_counted_usd_micros=30000000 headroom_after_usd_micros=0 classification_sha256=${hash}`);
    expect(lines.filter((line) => line.startsWith('read ')).sort()).toEqual(['read 1 verdict=FITS', 'read 2 verdict=FITS', 'read 3 verdict=FITS']);
    const refusedLine = lines.find((line) => line.includes(`run=${REFUSED.wlj}`)) as string;
    expect(refusedLine).toContain('classification=NOT_EXECUTED');
    expect(refusedLine).toContain('basis=no_provider_execution_refused_before_provider');
    expect(refusedLine).toContain('counted=false');
    const executedLine = lines.find((line) => line.includes(`run=${EXECUTED.wlj}`)) as string;
    expect(executedLine).toContain('classification=UNKNOWN');
    expect(executedLine).toContain('counted=true');
  });

  it('the classification hash binds to EXACTLY the reviewed classifications: it changes when one run is classified differently, and is UNKNOWN when unread', async () => {
    const hashOf = (lines: readonly string[]): string => /classification_sha256=(\S+)/u.exec(verdict(lines))?.[1] ?? 'none';
    const fits = hashOf((await status(github([EXECUTED, REFUSED]))).lines);
    const again = hashOf((await status(github([EXECUTED, REFUSED]))).lines);
    const full = hashOf((await status(github([EXECUTED, REFUSED_NO_LOG]))).lines);
    expect(fits).toMatch(/^[0-9a-f]{64}$/u);
    expect(again).toBe(fits);
    expect(full).toMatch(/^[0-9a-f]{64}$/u);
    expect(full).not.toBe(fits);
    expect(hashOf((await status(github([EXECUTED, REFUSED], [], () => 'throw'))).lines)).toBe('UNKNOWN');
  });

  it('FULL once the J1 grant is used: without the log proof the refused run is UNKNOWN at $30, so with 40698923582 three counted runs fill the 3-run grant (founder ruling 2026-10-30)', async () => {
    const { code, lines } = await status(github([EXECUTED, REFUSED_NO_LOG, EXECUTED_2]));
    expect(code).toBe(1);
    expect(verdict(lines)).toContain('ledger_verdict=FULL reads=3 consistent=yes reason=qualifying_pair_third_run_refused');
  });

  it('UNREADABLE when GitHub cannot be read: never FITS, never zero', async () => {
    const { code, lines } = await status(github([EXECUTED, REFUSED], [], () => 'throw'));
    expect(code).toBe(3);
    expect(verdict(lines)).toContain('ledger_verdict=UNREADABLE reads=3 consistent=yes reason=spend_ledger_unreadable');
    expect(verdict(lines)).toContain('prior_counted_usd_micros=UNKNOWN headroom_after_usd_micros=UNKNOWN');
  });

  it('UNREADABLE when the three reads disagree: a ledger that changes under the reader is not FITS', async () => {
    let calls = 0;
    const flaky = github([EXECUTED, REFUSED], [], (call) => { calls = call; return call > 14 ? 'throw' : undefined; });
    const { code, lines } = await status(flaky);
    expect(calls).toBeGreaterThan(14);
    expect(code).toBe(3);
    expect(verdict(lines)).toContain('ledger_verdict=UNREADABLE');
    expect(verdict(lines)).toContain('consistent=no reason=reads_disagree');
  });

  it('is READ-ONLY: only GETs reach GitHub, and no tag, ref or status is written', async () => {
    const methods: string[] = [];
    await status(github([EXECUTED, REFUSED], methods));
    expect(methods.length).toBeGreaterThan(20);
    expect([...new Set(methods)]).toEqual(['GET']);
  });

  it('refuses a namespace that has no pair cap, a missing contract path, and an unreadable contract', async () => {
    const other = JSON.stringify({ ...JSON.parse(readFileSync(CONTRACT, 'utf8')) as Record<string, unknown>, markerNamespace: 'julius-first-live' });
    const wrongNamespace = await status(github([]), { readFile: () => other });
    expect(wrongNamespace.code).toBe(3);
    expect(verdict(wrongNamespace.lines)).toBe('ledger_verdict=UNREADABLE reason=not_a_qualifying_pair_namespace');
    const usage = await status(github([]), { contractPath: null });
    expect(usage.code).toBe(2);
    expect(usage.lines[0]).toContain('Usage: julius-live-mission ledger-status');
    const broken = await status(github([]), { readFile: () => 'not json' });
    expect(broken.code).toBe(2);
  });

  it('REFUSES to run while an exported run id would exclude a run from the count (a false FITS)', async () => {
    for (const name of ['JULIUS_SERVER_RUN_ID', 'JULIUS_RUN_ID']) {
      const lines: string[] = [];
      const code = await ledgerStatusCommand({
        contractPath: CONTRACT, env: { GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: 'ghs_test_not_a_real_token', [name]: REFUSED.wlj },
        out: (line) => { lines.push(line); }, fetchImpl: github([EXECUTED, REFUSED]), transport: NO_WAIT, sleep: async () => undefined,
      });
      expect(code).toBe(2);
      expect(lines.join('\n')).toContain('refuses to run while JULIUS_SERVER_RUN_ID or JULIUS_RUN_ID is set');
      expect(lines.some((line) => line.startsWith('ledger_verdict='))).toBe(false);
    }
  });

  it('a contract problem is a CONTRACT verdict (exit 4), never FULL', async () => {
    const over = JSON.stringify({ ...(JSON.parse(readFileSync(CONTRACT, 'utf8')) as Record<string, unknown>), limits: { spendUsd: 31, repairCycles: 3 } });
    const { code, lines } = await status(github([EXECUTED, REFUSED]), { readFile: () => over });
    expect(verdict(lines)).toContain('ledger_verdict=CONTRACT');
    expect(verdict(lines)).toContain('reason=namespace_spend_ceiling_exceeded');
    expect(code).toBe(4);
  });

  it('a retry that succeeds leaves a closed trace line in the output, and the read is still FITS', async () => {
    const { code, lines } = await status(github([EXECUTED, REFUSED], [], (call) => (call === 1 ? 'throw' : undefined)));
    expect(code).toBe(0);
    expect(lines).toContain('ledger-retry: attempt 1 reason=transport');
    expect(lines.filter((line) => line.startsWith('ledger-retry:')).every((line) => /^ledger-retry: attempt [1-3] reason=(transport|http_50[234])$/u.test(line))).toBe(true);
  });

  it('a single read is never enough to say FITS when asked for fewer: the count is printed', async () => {
    const { lines } = await status(github([EXECUTED, REFUSED]), { reads: 1 });
    expect(verdict(lines)).toContain('reads=1');
  });
});
