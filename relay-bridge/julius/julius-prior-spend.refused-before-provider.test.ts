import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  JULIUS_LIVE_STEP_NAME,
  JULIUS_MISSION_JOB_NAME,
  JULIUS_PAID_WORKFLOW_PATH,
  classifyJuliusPriorRun,
  juliusArtifactAbsent,
  type JuliusPriorRunObservation,
  type JuliusWorkflowRunBinding,
} from '../../src/relay/mission/julius/julius-spend-ceiling';
import { readJuliusClassifiedSpentTags } from './julius-prior-spend';
import { ghApiFetch, ghApiGetArgs } from '../wonderland-prior-attempts';
import { JULIUS_TRUST_GATE_STEP_NAME, juliusLiveRefusedBeforeProvider as refusedBeforeProvider } from './julius-refused-before-provider';

/**
 * PAID RUN 40520432789 (2026-10-27): the LIVE step refused at its spend gate, `RESULT: BLOCKED —
 * spend_ledger_unreadable`, before any run row or provider could exist. Its evidence upload was blocked
 * under the billing lock, so a later run's classifier had nothing to prove that with and counted it at the
 * full $30 reservation. These tests take the REAL jobs body and the REAL LIVE-step log of that run (trimmed
 * of environment values) as fixtures. The log proof is accepted for that shape and for NO other.
 */
const JOBS = JSON.parse(readFileSync(join(process.cwd(), 'relay-bridge/julius/fixtures/run-40520432789.jobs.json'), 'utf8')) as Record<string, unknown>;
const LOG = readFileSync(join(process.cwd(), 'relay-bridge/julius/fixtures/run-40520432789.live-step.txt'), 'utf8');

const HEAD = '598741524f87783baef99a2d6a40cf0dba8baa8c';
/** The run as GitHub's runs API returns it for 40520432789 (the fields the proof reads). */
const RUN_BODY = { id: 40520432789, head_sha: HEAD, head_branch: 'main', event: 'workflow_dispatch', path: JULIUS_PAID_WORKFLOW_PATH, run_attempt: 1, status: 'completed', conclusion: 'failure' };
function juliusLiveRefusedBeforeProvider(jobs: unknown, log: string | null, binding: JuliusWorkflowRunBinding, run: unknown = RUN_BODY): boolean {
  return refusedBeforeProvider({ run, jobs, log, binding });
}
const RUN = 40520432789;
const BINDING: JuliusWorkflowRunBinding = { workflowRunId: String(RUN), workflowRunAttempt: '1', headSha: HEAD };
const WLJ = 'wlj_7dd5ad76-ed4f-47c3-b3a6-5a2d9b38636a';

type Job = Record<string, unknown> & { steps: Record<string, unknown>[] };
function jobsWith(edit: (mission: Job, all: Job[]) => void): unknown {
  const copy = JSON.parse(JSON.stringify(JOBS)) as { total_count: number; jobs: Job[] };
  const mission = copy.jobs.find((j) => j.name === JULIUS_MISSION_JOB_NAME) as Job;
  edit(mission, copy.jobs);
  return copy;
}
const step = (mission: Job, name: string): Record<string, unknown> => mission.steps.find((s) => s.name === name) as Record<string, unknown>;

const RESULT_LINE = /^(\S+Z )RESULT: BLOCKED — spend_ledger_unreadable: .*$/mu;
function logWith(edit: (log: string) => string): string { return edit(LOG); }
/** An extra line, stamped and inserted just before the RESULT line. */
const insertBeforeResult = (line: string) => (log: string): string => log.replace(RESULT_LINE, (match, stamp: string) => `${stamp}${line}\n${match}`);

/**
 * What the reader hands the classifier. The reader computes the flag from the jobs body and the log,
 * exactly as `observeJuliusWorkflowRun` does, and only when the evidence bundle is absent.
 */
function observation(overrides: Partial<Omit<JuliusPriorRunObservation, 'refusedBeforeProvider'>> & { liveLog?: string | null; refusedBeforeProvider?: boolean } = {}): JuliusPriorRunObservation {
  const { liveLog, refusedBeforeProvider, ...rest } = overrides;
  const jobs = rest.jobs ?? JOBS;
  const binding = rest.binding ?? BINDING;
  const log = liveLog === undefined ? LOG : liveLog;
  return {
    binding,
    run: RUN_BODY,
    jobs,
    artifacts: { total_count: 0, artifacts: [] },
    liveEvidence: null,
    verdict: null,
    ...rest,
    refusedBeforeProvider: refusedBeforeProvider ?? juliusLiveRefusedBeforeProvider(jobs, log, binding),
  };
}

describe('the real run 40520432789: refused at the spend gate, before any provider', () => {
  it('the fixtures are the real run: the mission job, a julius-paid runner, a trust gate that passed, a LIVE step that failed in 11 s', () => {
    const mission = (JOBS.jobs as Job[]).find((j) => j.name === JULIUS_MISSION_JOB_NAME) as Job;
    expect(mission.runner_name).toBe('julius-paid-Kaisin');
    expect(mission.labels).toEqual(['julius-paid']);
    expect(step(mission, JULIUS_TRUST_GATE_STEP_NAME).conclusion).toBe('success');
    const live = step(mission, JULIUS_LIVE_STEP_NAME);
    expect(live.conclusion).toBe('failure');
    expect((Date.parse(live.completed_at as string) - Date.parse(live.started_at as string)) / 1000).toBe(11);
    expect(LOG).toContain('RESULT: BLOCKED — spend_ledger_unreadable');
  });

  it('is proved NOT_EXECUTED from its own log, with no evidence bundle at all', () => {
    expect(juliusLiveRefusedBeforeProvider(JOBS, LOG, BINDING)).toBe(true);
    const proof = classifyJuliusPriorRun(observation(), WLJ);
    expect(proof.classification).toBe('NOT_EXECUTED');
    expect(proof.basis).toBe('no_provider_execution_refused_before_provider');
    expect(proof.knownChargesUsdMicros).toBeNull();
  });

  it('without the log it is still UNKNOWN, counted at the full reservation: the proof is the log, not the absence of evidence', () => {
    for (const liveLog of [null, '']) {
      const proof = classifyJuliusPriorRun(observation({ liveLog }), WLJ);
      expect(proof.classification).toBe('UNKNOWN');
      expect(proof.basis).toBe('evidence_unreadable');
    }
    const flagAbsent = classifyJuliusPriorRun({ ...observation(), refusedBeforeProvider: undefined }, WLJ);
    expect(flagAbsent.classification).toBe('UNKNOWN');
    const flagFalse = classifyJuliusPriorRun(observation({ refusedBeforeProvider: false }), WLJ);
    expect(flagFalse.classification).toBe('UNKNOWN');
  });

  it('an evidence bundle that EXISTS is never overridden by the log', () => {
    const artifacts = { total_count: 1, artifacts: [{ id: 9, name: 'julius-live-evidence', expired: false, workflow_run: { id: RUN, head_sha: HEAD } }] };
    // The reader never even computes the flag where a bundle exists; and a flag handed over anyway is ignored.
    const proof = classifyJuliusPriorRun(observation({ artifacts, liveEvidence: null, refusedBeforeProvider: true }), WLJ);
    expect(proof.classification).toBe('UNKNOWN');
    expect(proof.basis).toBe('evidence_unreadable');
  });

  it('CRLF line ends and the colour codes the raw log carries are read the same', () => {
    expect(juliusLiveRefusedBeforeProvider(JOBS, LOG.replaceAll('\n', '\r\n'), BINDING)).toBe(true);
    expect(LOG).toMatch(/\u001b\[/u);
  });
});

describe('the proof is refused for every other shape: UNKNOWN stays UNKNOWN', () => {
  const refused = (jobs: unknown, log: string | null, binding: JuliusWorkflowRunBinding = BINDING): void => {
    expect(juliusLiveRefusedBeforeProvider(jobs, log, binding)).toBe(false);
    expect(classifyJuliusPriorRun(observation({ jobs: jobs as JuliusPriorRunObservation['jobs'], liveLog: log, binding }), WLJ).classification).not.toBe('NOT_EXECUTED');
  };

  it.each([
    ['a line the entrypoint prints only after a run row exists', insertBeforeResult('  run created: run_0001')],
    ['a provider response id', insertBeforeResult('  response id: msg_01ABCDEFGHIJKLMNOP')],
    ['a task line', insertBeforeResult('task build-1 dispatched to CODING_AGENT')],
    ['a cost line', insertBeforeResult('  cost usd_micros=250000')],
    ['an env-looking line with a lowercase key', insertBeforeResult('  anthropic_api_key: SET')],
  ])('%s anywhere in the output', (_name, edit) => { refused(JOBS, logWith(edit)); });

  it('a RESULT with a code outside the closed set, or a different verb', () => {
    refused(JOBS, logWith((log) => log.replace('BLOCKED — spend_ledger_unreadable', 'BLOCKED — something_new')));
    refused(JOBS, logWith((log) => log.replace('RESULT: BLOCKED', 'RESULT: COMPLETED')));
  });

  it('two RESULT lines, a RESULT that is not the last output line, or no RESULT line', () => {
    refused(JOBS, logWith((log) => log.replace(RESULT_LINE, (match, stamp: string) => `${match}\n${stamp}${match.slice(stamp.length)}`)));
    refused(JOBS, logWith(insertBeforeResult('  live_ledger: BOUND')).replace(/(\S+Z )julius_exit=1/u, (m, stamp: string) => `${stamp}  live_ledger: BOUND\n${m}`));
    refused(JOBS, logWith((log) => log.replace(RESULT_LINE, '')));
  });

  it('an exit status that is not 1, a missing exit line, or a missing shell error line', () => {
    refused(JOBS, logWith((log) => log.replace('julius_exit=1', 'julius_exit=0')));
    refused(JOBS, logWith((log) => log.replace('julius_exit=1', 'julius_exit=2')));
    refused(JOBS, logWith((log) => log.replace(/^.*julius_exit=1.*$/mu, '')));
    refused(JOBS, logWith((log) => log.replace('##[error]Process completed with exit code 1.', '##[error]Process completed with exit code 2.')));
  });

  it('a log that does not hold the one entrypoint command, or holds it twice', () => {
    refused(JOBS, logWith((log) => log.replace('node dist-relay-bridge/julius-live-mission.cjs \\', 'node somewhere/else.cjs \\')));
    refused(JOBS, logWith((log) => `${log}${log}`));
    refused(JOBS, '');
    refused(JOBS, null);
  });

  it('a run that did not run on a julius-paid runner, or whose labels are anything else', () => {
    refused(jobsWith((m) => { m.runner_name = 'GitHub Actions 7'; }), LOG);
    refused(jobsWith((m) => { m.runner_name = 'julius-ci-Kaisin'; }), LOG);
    refused(jobsWith((m) => { m.labels = ['self-hosted']; }), LOG);
    refused(jobsWith((m) => { m.labels = ['julius-paid', 'extra']; }), LOG);
  });

  it('a trust gate that did not pass, a LIVE step that did not fail, or a job that did not fail', () => {
    refused(jobsWith((m) => { step(m, JULIUS_TRUST_GATE_STEP_NAME).conclusion = 'failure'; }), LOG);
    refused(jobsWith((m) => { step(m, JULIUS_TRUST_GATE_STEP_NAME).conclusion = 'skipped'; }), LOG);
    refused(jobsWith((m) => { step(m, JULIUS_LIVE_STEP_NAME).conclusion = 'success'; }), LOG);
    refused(jobsWith((m) => { step(m, JULIUS_LIVE_STEP_NAME).conclusion = 'cancelled'; }), LOG);
    refused(jobsWith((m) => { m.conclusion = 'success'; }), LOG);
    refused(jobsWith((m) => { m.status = 'in_progress'; }), LOG);
  });

  it('a LIVE step that ran longer than a refusal can take', () => {
    refused(jobsWith((m) => { step(m, JULIUS_LIVE_STEP_NAME).completed_at = '2026-10-27T14:44:22Z'; }), LOG);
    refused(jobsWith((m) => { step(m, JULIUS_LIVE_STEP_NAME).completed_at = 'not a time'; }), LOG);
    refused(jobsWith((m) => { step(m, JULIUS_LIVE_STEP_NAME).completed_at = '2026-10-27T14:00:00Z'; }), LOG);
  });

  it('a jobs body for another run, attempt or head, a missing mission job, or a duplicate of it', () => {
    refused(JOBS, LOG, { ...BINDING, workflowRunId: '40520432790' });
    refused(JOBS, LOG, { ...BINDING, workflowRunAttempt: '2' });
    refused(JOBS, LOG, { ...BINDING, headSha: 'f'.repeat(40) });
    refused(jobsWith((m, all) => { all.splice(all.indexOf(m), 1); }), LOG);
    refused(jobsWith((m, all) => { all.push(JSON.parse(JSON.stringify(m)) as Job); }), LOG);
    refused({ total_count: 99, jobs: (JOBS.jobs as unknown[]) }, LOG);
    refused(null, LOG);
  });
});

describe('review fixes D1/D2: the run-level checks and the duration bound', () => {
  it('only a manual dispatch of main, on this head, that finished: any other run is refused', () => {
    for (const run of [
      { ...RUN_BODY, head_branch: 'julius/other' }, { ...RUN_BODY, head_branch: undefined },
      { ...RUN_BODY, event: 'schedule' }, { ...RUN_BODY, event: 'push' }, { ...RUN_BODY, event: undefined },
      { ...RUN_BODY, head_sha: 'f'.repeat(40) }, { ...RUN_BODY, id: 1 }, { ...RUN_BODY, status: 'in_progress' }, null, 'run',
    ]) {
      expect(juliusLiveRefusedBeforeProvider(JOBS, LOG, BINDING, run)).toBe(false);
    }
    expect(juliusLiveRefusedBeforeProvider(JOBS, LOG, BINDING, RUN_BODY)).toBe(true);
  });

  it('a refusal after the transport retry, which can take minutes, is within the bound; a run that ran for minutes of real work is not', () => {
    const at = (seconds: number) => jobsWith((m) => { step(m, JULIUS_LIVE_STEP_NAME).completed_at = new Date(Date.parse(step(m, JULIUS_LIVE_STEP_NAME).started_at as string) + seconds * 1000).toISOString(); });
    expect(juliusLiveRefusedBeforeProvider(at(250), LOG, BINDING)).toBe(true);
    expect(juliusLiveRefusedBeforeProvider(at(300), LOG, BINDING)).toBe(true);
    expect(juliusLiveRefusedBeforeProvider(at(301), LOG, BINDING)).toBe(false);
  });

  it('a log that carries the retry trace before its refusal is still the proof; a malformed trace line is not', () => {
    const withTrace = logWith(insertBeforeResult('ledger-retry: attempt 1 reason=transport'));
    expect(juliusLiveRefusedBeforeProvider(JOBS, withTrace, BINDING)).toBe(true);
    const twice = logWith(insertBeforeResult('ledger-retry: attempt 1 reason=transport')).replace(RESULT_LINE, (match, stamp: string) => `${stamp}ledger-retry: attempt 2 reason=http_503\n${match}`);
    expect(juliusLiveRefusedBeforeProvider(JOBS, twice, BINDING)).toBe(true);
    for (const bad of ['ledger-retry: attempt 1 reason=anything', 'ledger-retry: attempt 0 reason=transport', 'ledger-retry: attempt 4 reason=transport', 'ledger-retry: attempt 12 reason=transport', ' ledger-retry: attempt 1 reason=transport', 'ledger-retry: attempt 1 reason=transport ', 'ledger-retry: attempt 1 reason=transport https://x.invalid']) {
      expect(juliusLiveRefusedBeforeProvider(JOBS, logWith(insertBeforeResult(bad)), BINDING)).toBe(false);
    }
  });
});

describe('review fix F1: the Start route reads the job log through gh, which needs --allow-escape-sequences', () => {
  const REPO = 'ohdieyuh-glitch/sunday-relay';
  const TAG_SHA = 'c'.repeat(40);
  const MESSAGE = [
    'julius-run-spent.v1', `run=${WLJ}`, 'namespace=julius-inworld-data-1', 'reservedUsdMicros=30000000',
    `workflow_run_id=${String(RUN)}`, 'workflow_run_attempt=1', `head_sha=${HEAD}`, '',
  ].join('\n');
  const missionJobId = ((JOBS.jobs as Job[]).find((j) => j.name === JULIUS_MISSION_JOB_NAME) as Job).id as number;
  const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

  /** gh 2.100: a job log with colour codes is REFUSED (exit 1) unless the flag is passed. */
  function runner(options: { ignoreFlag?: boolean } = {}): { run: (args: readonly string[]) => Promise<{ code: number; stdout: Uint8Array }>; argv: string[][] } {
    const argv: string[][] = [];
    const run = async (args: readonly string[]) => {
      argv.push([...args]);
      const path = args[args.length - 1] as string;
      const flag = args.includes('--allow-escape-sequences') && options.ignoreFlag !== true;
      const ok = (stdout: Uint8Array) => ({ code: 0, stdout });
      if (path === `repos/${REPO}/git/matching-refs/tags/julius-run-spent-`) return ok(bytes([{ ref: `refs/tags/julius-run-spent-${WLJ.slice(4).replaceAll('-', '')}`, object: { type: 'tag', sha: TAG_SHA } }]));
      if (path === `repos/${REPO}/git/tags/${TAG_SHA}`) return ok(bytes({ message: MESSAGE }));
      if (path === `repos/${REPO}/actions/runs/${String(RUN)}`) return ok(bytes(RUN_BODY));
      if (path.startsWith(`repos/${REPO}/actions/runs/${String(RUN)}/attempts/1/jobs`)) return ok(bytes(JOBS));
      if (path.startsWith(`repos/${REPO}/actions/runs/${String(RUN)}/artifacts`)) return ok(bytes({ total_count: 0, artifacts: [] }));
      if (path === `repos/${REPO}/actions/jobs/${String(missionJobId)}/logs`) {
        return flag ? ok(bytes(LOG)) : { code: 1, stdout: new Uint8Array() };
      }
      return { code: 1, stdout: new Uint8Array() };
    };
    return { run, argv };
  }

  it('gives the flag to the job-log path and to NO other path', () => {
    expect(ghApiGetArgs(`https://api.github.com/repos/${REPO}/actions/jobs/${String(missionJobId)}/logs`))
      .toEqual(['api', '-X', 'GET', '--allow-escape-sequences', `repos/${REPO}/actions/jobs/${String(missionJobId)}/logs`]);
    for (const path of [`repos/${REPO}/actions/runs/1/jobs`, `repos/${REPO}/git/tags/${TAG_SHA}`, `repos/${REPO}/actions/runs/1/logs`, `repos/${REPO}/actions/jobs/abc/logs`, `repos/${REPO}/actions/jobs/1/logs/extra`, 'repos/o/r/actions/jobs/1/logs?x=1']) {
      expect(ghApiGetArgs(`https://api.github.com/${path}`)).toEqual(['api', '-X', 'GET', path]);
    }
    expect(ghApiGetArgs('https://api.github.com/repos/o/r/actions/jobs/1/logs/../x')).toBeNull();
  });

  it('through the gh route, with a REAL colour-coded log, the Start route reaches the SAME count as the workflow: NOT_EXECUTED, not counted', async () => {
    const { run, argv } = runner();
    const result = await readJuliusClassifiedSpentTags({ repository: REPO, token: 'gh-cli-login', namespace: 'julius-inworld-data-1', fetchImpl: ghApiFetch(run) });
    expect(LOG).toMatch(/\u001b\[/u);
    expect(result.ledger.readable).toBe(true);
    expect(result.audit[0]).toMatchObject({ runId: WLJ, classification: 'NOT_EXECUTED', basis: 'no_provider_execution_refused_before_provider', counted: false });
    expect(argv.some((args) => args.includes('--allow-escape-sequences'))).toBe(true);
  });

  it('without the flag (the old argv) gh refuses the log, the run stays UNKNOWN and counted: this is the divergence the flag closes', async () => {
    const result = await readJuliusClassifiedSpentTags({ repository: REPO, token: 'gh-cli-login', namespace: 'julius-inworld-data-1', fetchImpl: ghApiFetch(runner({ ignoreFlag: true }).run) });
    expect(result.audit[0]).toMatchObject({ classification: 'UNKNOWN', basis: 'evidence_unreadable', counted: true });
  });
});

describe('the live reader fetches the log only when the bundle is absent, and reads it through the classifier', () => {
  const REPO = 'ohdieyuh-glitch/sunday-relay';
  const API = `https://api.github.com/repos/${REPO}`;
  const TAG_SHA = 'c'.repeat(40);
  const MESSAGE = [
    'julius-run-spent.v1', `run=${WLJ}`, 'namespace=julius-inworld-data-1', 'reservedUsdMicros=30000000',
    `workflow_run_id=${String(RUN)}`, 'workflow_run_attempt=1', `head_sha=${HEAD}`, '',
  ].join('\n');
  const missionJobId = ((JOBS.jobs as Job[]).find((j) => j.name === JULIUS_MISSION_JOB_NAME) as Job).id as number;

  function github(options: { artifacts?: unknown; artifactsStatus?: number; logStatus?: number; logBody?: string; jobs?: unknown } = {}): { fetchImpl: typeof fetch; urls: string[]; tokenOffHost: boolean[] } {
    const urls: string[] = [];
    const tokenOffHost: boolean[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url.replace(API, ''));
      const headers = new Headers(init?.headers);
      if (!url.startsWith('https://api.github.com/')) tokenOffHost.push(headers.has('authorization'));
      if (url.endsWith('/matching-refs/tags/julius-run-spent-')) {
        return new Response(JSON.stringify([{ ref: `refs/tags/julius-run-spent-${WLJ.slice(4).replaceAll('-', '')}`, object: { type: 'tag', sha: TAG_SHA } }]), { status: 200 });
      }
      if (url === `${API}/git/tags/${TAG_SHA}`) return new Response(JSON.stringify({ message: MESSAGE }), { status: 200 });
      if (url === `${API}/actions/runs/${String(RUN)}`) {
        return new Response(JSON.stringify(RUN_BODY), { status: 200 });
      }
      if (url.startsWith(`${API}/actions/runs/${String(RUN)}/attempts/1/jobs`)) return new Response(JSON.stringify(options.jobs ?? JOBS), { status: 200 });
      if (url.startsWith(`${API}/actions/runs/${String(RUN)}/artifacts`)) return new Response(JSON.stringify(options.artifacts ?? { total_count: 0, artifacts: [] }), { status: options.artifactsStatus ?? 200 });
      if (url === `${API}/actions/jobs/${String(missionJobId)}/logs`) {
        expect(init?.redirect).toBe('manual');
        return new Response(null, { status: 302, headers: { location: 'https://logs.example.invalid/signed' } });
      }
      if (url === 'https://logs.example.invalid/signed') return new Response(options.logBody ?? LOG, { status: options.logStatus ?? 200 });
      return new Response('unexpected', { status: 404 });
    }) as typeof fetch;
    return { fetchImpl, urls, tokenOffHost };
  }

  const read = (fetchImpl: typeof fetch) => readJuliusClassifiedSpentTags({ repository: REPO, token: 'ghs_test_not_a_real_token', namespace: 'julius-inworld-data-1', fetchImpl });

  it('RESTORES the slot: the run is NOT_EXECUTED and no longer counted, via the real route (redirect followed without the token)', async () => {
    const { fetchImpl, urls, tokenOffHost } = github();
    const result = await read(fetchImpl);
    expect(result.ledger.readable).toBe(true);
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0]).toMatchObject({ runId: WLJ, classification: 'NOT_EXECUTED', basis: 'no_provider_execution_refused_before_provider', counted: false });
    expect(urls).toContain(`/actions/jobs/${String(missionJobId)}/logs`);
    expect(tokenOffHost).toEqual([false]);
  });

  it('an unreadable or non-OK log is UNKNOWN, counted: failing to read the log is never a proof', async () => {
    for (const options of [{ logStatus: 500 }, { logStatus: 404 }, { logBody: '' }, { logBody: 'unrelated text' }]) {
      const result = await read(github(options).fetchImpl);
      expect(result.audit[0]).toMatchObject({ classification: 'UNKNOWN', basis: 'evidence_unreadable', counted: true });
    }
  });

  it('is not fetched at all when the run has its evidence bundle', async () => {
    const artifacts = { total_count: 1, artifacts: [{ id: 9, name: 'julius-live-evidence', expired: false, workflow_run: { id: RUN, head_sha: HEAD } }] };
    const { fetchImpl, urls } = github({ artifacts });
    await read(fetchImpl);
    expect(urls.some((url) => url.includes('/logs'))).toBe(false);
  });

  describe('review fix P2: ABSENCE of the evidence bundle must be proven by the listing, never inferred from a null id', () => {
    const named = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 9, name: 'julius-live-evidence', expired: false, workflow_run: { id: RUN, head_sha: HEAD }, ...extra });
    const other = { id: 3, name: 'unrelated', expired: false, workflow_run: { id: RUN, head_sha: HEAD } };
    const unknownCases: ReadonlyArray<readonly [string, { artifacts?: unknown; artifactsStatus?: number }]> = [
      ['the artifacts listing answers 503', { artifacts: { message: 'unavailable' }, artifactsStatus: 503 }],
      ['the artifacts body is not an object', { artifacts: ['not', 'an', 'object'] }],
      ['the artifacts body is a string', { artifacts: 'nope' }],
      ['total_count is not the length of the list (truncated or paged)', { artifacts: { total_count: 101, artifacts: [other] } }],
      ['artifacts is not an array', { artifacts: { total_count: 0, artifacts: {} } }],
      ['an entry of the list is not an object', { artifacts: { total_count: 1, artifacts: [null] } }],
      ['the evidence entry is listed twice', { artifacts: { total_count: 2, artifacts: [named(), named({ id: 10 })] } }],
      ['the evidence entry is EXPIRED', { artifacts: { total_count: 1, artifacts: [named({ expired: true })] } }],
      ['the evidence entry belongs to another run', { artifacts: { total_count: 1, artifacts: [named({ workflow_run: { id: RUN + 1, head_sha: HEAD } })] } }],
      ['the evidence entry belongs to another head', { artifacts: { total_count: 1, artifacts: [named({ workflow_run: { id: RUN, head_sha: 'd'.repeat(40) } })] } }],
    ];
    for (const [title, options] of unknownCases) {
      it(`${title}: UNKNOWN, counted, and the job log is never even fetched`, async () => {
        const { fetchImpl, urls } = github(options);
        const result = await read(fetchImpl);
        expect(result.audit[0]).toMatchObject({ classification: 'UNKNOWN', basis: 'evidence_unreadable', counted: true });
        expect(urls.some((url) => url.includes('/logs'))).toBe(false);
      });
    }

    it('juliusArtifactAbsent is true for a complete listing without the name, and false for every shape that proves nothing', () => {
      const name = 'julius-live-evidence';
      expect(juliusArtifactAbsent({ total_count: 0, artifacts: [] }, name)).toBe(true);
      expect(juliusArtifactAbsent({ total_count: 1, artifacts: [other] }, name)).toBe(true);
      for (const body of [null, undefined, 'x', 3, [], { total_count: 0 }, { artifacts: [] }, { total_count: 3, artifacts: 'abc' }, { total_count: 2, artifacts: { length: 2 } }, { total_count: 1, artifacts: [] }, { total_count: 1, artifacts: [3] }, { total_count: 1, artifacts: [named()] }, { total_count: 1, artifacts: [named({ expired: true })] }]) {
        expect(juliusArtifactAbsent(body, name)).toBe(false);
      }
    });

    it('the kernel does not trust the flag alone: a flag handed over with an unproven listing stays UNKNOWN', () => {
      for (const artifacts of [null, 'x', { total_count: 1, artifacts: [named({ expired: true })] }, { total_count: 2, artifacts: [named(), named()] }]) {
        const proof = classifyJuliusPriorRun(observation({ artifacts, refusedBeforeProvider: true }), WLJ);
        expect(proof.classification).toBe('UNKNOWN');
        expect(proof.basis).toBe('evidence_unreadable');
      }
    });

    it('the positive case stands: a complete listing with other artifacts but NO evidence entry, and a log that proves the refusal, is NOT_EXECUTED', async () => {
      const { fetchImpl, urls } = github({ artifacts: { total_count: 1, artifacts: [other] } });
      const result = await read(fetchImpl);
      expect(result.audit[0]).toMatchObject({ classification: 'NOT_EXECUTED', basis: 'no_provider_execution_refused_before_provider', counted: false });
      expect(urls.some((url) => url.includes('/logs'))).toBe(true);
    });
  });

  it('is not fetched when the LIVE step never ran (proof (a) decides first)', async () => {
    const jobs = jobsWith((m) => { step(m, JULIUS_LIVE_STEP_NAME).conclusion = 'skipped'; });
    const { fetchImpl, urls } = github({ jobs });
    const result = await read(fetchImpl);
    expect(result.audit[0]).toMatchObject({ classification: 'NOT_EXECUTED', basis: 'no_provider_execution_live_never_ran' });
    expect(urls.some((url) => url.includes('/logs'))).toBe(false);
  });
});
