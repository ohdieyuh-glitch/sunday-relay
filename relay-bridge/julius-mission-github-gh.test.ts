import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createGhMissionGitHub, EVIDENCE_ARTIFACT_NAMES, GithubUnreadableError, type GhReadRunner } from './julius-mission-github-gh';
import { cachedEvidenceReader, EVIDENCE_RECHECK_MS, wonderlandLiveReadsFrom } from './wonderland-live-wiring';

const REPO = 'ohdieyuh-glitch/sunday-relay';
const RUN = '36568129865';
const SHA = 'c'.repeat(40);
const TAG_SHA = 'd'.repeat(40);
const TAG = 'refs/tags/julius-run-spent-0b7a1c2e4f3d4a6b8c2d3e4f5a6b7c8d';

/** Every argv this port may hand `gh`: a GET of one allowlisted path, or one artifact download. */
const ALLOWED_API = [
  /^repos\/ohdieyuh-glitch\/sunday-relay\/git\/ref\/tags\/julius-run-spent-[0-9a-f]{32}$/u,
  /^repos\/ohdieyuh-glitch\/sunday-relay\/git\/tags\/[0-9a-f]{40}$/u,
  /^repos\/ohdieyuh-glitch\/sunday-relay\/actions\/runs\/\d+$/u,
  /^repos\/ohdieyuh-glitch\/sunday-relay\/actions\/runs\/\d+\/attempts\/\d+$/u,
  /^repos\/ohdieyuh-glitch\/sunday-relay\/actions\/runs\/\d+\/attempts\/\d+\/jobs\?per_page=100$/u,
  /^repos\/ohdieyuh-glitch\/sunday-relay\/actions\/runs\/\d+\/artifacts\?per_page=100$/u,
  /^repos\/ohdieyuh-glitch\/sunday-relay\/commits\/[0-9a-f]{40}\/statuses\?per_page=100$/u,
];

function expectReadOnly(calls: readonly (readonly string[])[]): void {
  for (const args of calls) {
    if (args[0] === 'api') {
      expect(args.slice(0, 3), args.join(' ')).toEqual(['api', '-H', 'Accept: application/vnd.github+json']);
      expect(args, args.join(' ')).toHaveLength(4);
      expect(ALLOWED_API.some((pattern) => pattern.test(args[3] ?? '')), args[3]).toBe(true);
    } else {
      expect(args.slice(0, 3), args.join(' ')).toEqual(['run', 'download', RUN]);
      expect(args.slice(3, 5)).toEqual(['--repo', REPO]);
      expect(args[5]).toBe('--name');
      expect(args[7]).toBe('--dir');
      expect(args).toHaveLength(9);
    }
    for (const forbidden of ['-X', '--method', '-f', '-F', '--field', '--raw-field', '--input', 'workflow', 'dispatch', 'POST', 'PATCH', 'DELETE', 'PUT']) {
      expect(args, args.join(' ')).not.toContain(forbidden);
    }
  }
}

type Reply = { code: number; stdout: string; stderr?: string } | ((args: readonly string[]) => { code: number; stdout: string; stderr?: string });

function fake(routes: Record<string, Reply>): GhReadRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(args) {
      calls.push([...args]);
      const key = args[0] === 'api' ? args[3] ?? '' : `download ${args[6] ?? ''}`;
      const reply = routes[key];
      if (reply === undefined) return { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
      const value = typeof reply === 'function' ? reply(args) : reply;
      return { code: value.code, stdout: value.stdout, stderr: value.stderr ?? '' };
    },
  };
}

const json = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value) });
const base = `repos/${REPO}`;

describe('the read-only gh port', () => {
  it('refuses an invalid repo, and builds no argv from an unvalidated id', async () => {
    expect(() => createGhMissionGitHub({ repo: 'not a repo', runner: fake({}) })).toThrow('github_repo_invalid');
    const runner = fake({});
    const github = createGhMissionGitHub({ repo: REPO, runner });
    expect(await github.readRun('1; rm -rf /')).toBeNull();
    expect(await github.readRun('0')).toBeNull();
    expect(await github.readRunJobs(RUN, 0)).toBeNull();
    expect(await github.readCommitStatuses('main')).toBeNull();
    expect(await github.readAnnotatedTagMessage('refs/tags/v1.0.0')).toBeNull();
    expect(await github.readAnnotatedTagMessage('refs/tags/julius-run-spent-../../x')).toBeNull();
    expect(await github.readWorkflowRun('abc', '1')).toBeNull();
    expect(await github.readWorkflowRun(RUN, '1;')).toBeNull();
    expect(runner.calls).toEqual([]);
  });

  it('reads the spent tag message through the annotated tag only; a lightweight tag or a 404 is null; other failures throw', async () => {
    const runner = fake({
      [`${base}/git/ref/tags/julius-run-spent-0b7a1c2e4f3d4a6b8c2d3e4f5a6b7c8d`]: json({ object: { type: 'tag', sha: TAG_SHA } }),
      [`${base}/git/tags/${TAG_SHA}`]: json({ message: 'julius-run-spent.v1\nrun=x\n' }),
    });
    const github = createGhMissionGitHub({ repo: REPO, runner });
    expect(await github.readAnnotatedTagMessage(TAG)).toBe('julius-run-spent.v1\nrun=x\n');
    const lightweight = createGhMissionGitHub({ repo: REPO, runner: fake({
      [`${base}/git/ref/tags/julius-run-spent-0b7a1c2e4f3d4a6b8c2d3e4f5a6b7c8d`]: json({ object: { type: 'commit', sha: TAG_SHA } }),
    }) });
    expect(await lightweight.readAnnotatedTagMessage(TAG)).toBeNull();
    expect(await createGhMissionGitHub({ repo: REPO, runner: fake({}) }).readAnnotatedTagMessage(TAG)).toBeNull();
    const broken = createGhMissionGitHub({ repo: REPO, runner: fake({
      [`${base}/git/ref/tags/julius-run-spent-0b7a1c2e4f3d4a6b8c2d3e4f5a6b7c8d`]: { code: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' },
    }) });
    await expect(broken.readAnnotatedTagMessage(TAG)).rejects.toBeInstanceOf(GithubUnreadableError);
    expectReadOnly(runner.calls);
  });

  it('a running run lists its artifacts but fetches no bytes; a finished run downloads only the reader\'s artifacts, bounded', async () => {
    const attempt = (status: string) => json({ id: Number(RUN), run_attempt: 1, head_sha: SHA, status, conclusion: status === 'completed' ? 'success' : null, created_at: '2026-10-23T17:19:00Z' });
    const jobs = json({ jobs: [{ id: 1, name: 'Preflight, then the live mission', status: 'completed', conclusion: 'failure', steps: [
      { number: 1, name: 'LIVE: run the first real Julius mission', status: 'completed', conclusion: 'failure' },
    ] }] });
    const artifacts = json({ artifacts: [
      { name: 'julius-live-evidence', size_in_bytes: 100, expired: false },
      { name: 'julius-inworld-data-1-completed', size_in_bytes: 10, expired: false },
      { name: 'julius-inworld-verdict', size_in_bytes: 10, expired: false },
      { name: 'some-other-artifact', size_in_bytes: 10, expired: false },
      { name: 'julius-live-evidence-old', size_in_bytes: 10, expired: true },
    ] });
    const download = (args: readonly string[]) => {
      const dir = args[8] ?? '';
      mkdirSync(join(dir, 'nested'), { recursive: true });
      writeFileSync(join(dir, 'live-mission.evidence.txt'), `artifact ${args[6]}`);
      writeFileSync(join(dir, 'nested', 'runs.tsv'), 'run_id\tstate\n');
      return { code: 0, stdout: '' };
    };
    let downloadedTo = '';
    const running = fake({
      [`${base}/actions/runs/${RUN}/attempts/1`]: attempt('in_progress'),
      [`${base}/actions/runs/${RUN}/attempts/1/jobs?per_page=100`]: jobs,
      [`${base}/actions/runs/${RUN}/artifacts?per_page=100`]: artifacts,
    });
    const live = await createGhMissionGitHub({ repo: REPO, runner: running }).readWorkflowRun(RUN, '1');
    expect(live?.artifacts.map((artifact) => [artifact.name, artifact.files])).toEqual([
      ['julius-live-evidence', null], ['julius-inworld-data-1-completed', null], ['julius-inworld-verdict', null],
    ]);
    expect(running.calls.some((args) => args[0] === 'run')).toBe(false);
    const finished = fake({
      [`${base}/actions/runs/${RUN}/attempts/1`]: attempt('completed'),
      [`${base}/actions/runs/${RUN}/attempts/1/jobs?per_page=100`]: jobs,
      [`${base}/actions/runs/${RUN}/artifacts?per_page=100`]: artifacts,
      'download julius-live-evidence': (args) => { downloadedTo = args[8] ?? ''; return download(args); },
      'download julius-inworld-data-1-completed': download,
      'download julius-inworld-verdict': download,
    });
    const done = await createGhMissionGitHub({ repo: REPO, runner: finished }).readWorkflowRun(RUN, '1');
    expect(done).toMatchObject({ workflowRunId: RUN, headSha: SHA, status: 'completed', conclusion: 'success', createdAt: '2026-10-23T17:19:00Z', failedSteps: ['LIVE: run the first real Julius mission'] });
    const evidence = done?.artifacts.find((artifact) => artifact.name === 'julius-live-evidence');
    expect(evidence?.files).toEqual([
      { path: 'live-mission.evidence.txt', text: 'artifact julius-live-evidence' },
      { path: 'nested/runs.tsv', text: 'run_id\tstate\n' },
    ]);
    expect(finished.calls.filter((args) => args[0] === 'run').map((args) => args[6])).toEqual([
      'julius-live-evidence', 'julius-inworld-data-1-completed', 'julius-inworld-verdict',
    ]);
    expect(existsSync(downloadedTo)).toBe(false);
    expectReadOnly([...running.calls, ...finished.calls]);
  });

  it('downloads exactly the artifacts the paid workflow uploads for evidence and verdict, so a graded verdict can reach /result', () => {
    // Every `name:` under an upload-artifact step of the paid workflow; the reader's names must each be one of them.
    const workflow = readFileSync(join('.github', 'workflows', 'julius-first-live-mission.yml'), 'utf8');
    const lines = workflow.split('\n');
    const uploaded = new Set<string>();
    lines.forEach((line, i) => {
      if (!/^\s*- uses: actions\/upload-artifact@/u.test(line)) return;
      const name = lines.slice(i + 1, i + 7).map((next) => /^\s+name:\s*(\S.*)$/u.exec(next)?.[1]).find((hit) => hit !== undefined);
      if (name !== undefined) uploaded.add(name.trim());
    });
    expect(uploaded.has('julius-inworld-verdict')).toBe(true);
    for (const name of EVIDENCE_ARTIFACT_NAMES) expect(uploaded.has(name), name).toBe(true);
    expect([...EVIDENCE_ARTIFACT_NAMES].sort()).toEqual(['julius-inworld-verdict', 'julius-live-evidence']);
  });

  it('reads job steps and commit statuses as names and states only', async () => {
    const runner = fake({
      [`${base}/actions/runs/${RUN}`]: json({ id: Number(RUN), run_attempt: 1, status: 'in_progress', conclusion: null, event: 'workflow_dispatch', head_branch: 'main', head_sha: SHA, path: '.github/workflows/julius-first-live-mission.yml', display_title: 'julius mission=x lane=lab mode=paid key=k', created_at: '2026-10-23T17:19:00Z', logs_url: 'https://example.invalid/logs' }),
      [`${base}/actions/runs/${RUN}/attempts/1/jobs?per_page=100`]: json({ jobs: [{ id: 7, name: 'spend-tag', status: 'completed', conclusion: 'success', started_at: '2026-10-23T17:19:01Z', completed_at: '2026-10-23T17:19:30Z', steps: [{ number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', started_at: '2026-10-23T17:19:01Z', completed_at: '2026-10-23T17:19:02Z' }] }] }),
      [`${base}/commits/${SHA}/statuses?per_page=100`]: json([{ id: 99, context: 'julius-live-progress', state: 'pending', description: 'v1 r1.a1.0b7a1c2e s1 idle', creator: { login: 'github-actions[bot]' }, created_at: '2026-10-23T17:20:00Z', target_url: 'https://example.invalid' }]),
    });
    const github = createGhMissionGitHub({ repo: REPO, runner });
    const run = await github.readRun(RUN);
    expect(run).toEqual({
      id: RUN, attempt: 1, status: 'in_progress', conclusion: null, event: 'workflow_dispatch', headBranch: 'main', headSha: SHA,
      path: '.github/workflows/julius-first-live-mission.yml', displayTitle: 'julius mission=x lane=lab mode=paid key=k', createdAt: '2026-10-23T17:19:00Z',
    });
    expect(await github.readRunJobs(RUN, 1)).toEqual([{
      id: '7', name: 'spend-tag', status: 'completed', conclusion: 'success', startedAt: '2026-10-23T17:19:01Z', completedAt: '2026-10-23T17:19:30Z',
      steps: [{ number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', startedAt: '2026-10-23T17:19:01Z', completedAt: '2026-10-23T17:19:02Z' }],
    }]);
    expect(await github.readCommitStatuses(SHA)).toEqual([{
      id: '99', context: 'julius-live-progress', state: 'pending', description: 'v1 r1.a1.0b7a1c2e s1 idle', creator: 'github-actions[bot]', createdAt: '2026-10-23T17:20:00Z',
    }]);
    expectReadOnly(runner.calls);
  });

  it('the module starts no process itself and never writes: no execFile, spawn, POST or field flag in its source', () => {
    const source = readFileSync(join(__dirname, 'julius-mission-github-gh.ts'), 'utf8');
    expect(source).not.toMatch(/child_process|execFile|spawn/u);
    expect(source).not.toMatch(/'-X'|'--method'|'-f'|'-F'|'--input'|POST|PATCH|DELETE/u);
  });
});

describe('the wiring', () => {
  it('is off unless JULIUS_WONDERLAND_GITHUB_REPO names owner/name', () => {
    expect(wonderlandLiveReadsFrom({})).toBeNull();
    expect(wonderlandLiveReadsFrom({ JULIUS_WONDERLAND_GITHUB_REPO: 'not a repo' })).toBeNull();
    expect(wonderlandLiveReadsFrom({ JULIUS_WONDERLAND_GITHUB_REPO: REPO }, fake({}))).not.toBeNull();
  });

  it('caches a completed reading for good and rechecks anything else after the window; one read at a time', async () => {
    let clock = 0;
    const answers: unknown[] = [null, null, { juliusFinalState: 'COMPLETED' }];
    let reads = 0;
    const reader = cachedEvidenceReader({ read: async () => answers[Math.min(reads++, answers.length - 1)] }, () => clock);
    expect(await reader.read('wlj_x')).toBeNull();
    expect(await reader.read('wlj_x')).toBeNull();
    expect(reads).toBe(1);
    clock = EVIDENCE_RECHECK_MS;
    const [a, b] = await Promise.all([reader.read('wlj_x'), reader.read('wlj_x')]);
    expect([a, b, reads]).toEqual([null, null, 2]);
    clock += EVIDENCE_RECHECK_MS;
    expect(await reader.read('wlj_x')).toEqual({ juliusFinalState: 'COMPLETED' });
    clock += 10 * EVIDENCE_RECHECK_MS;
    expect(await reader.read('wlj_x')).toEqual({ juliusFinalState: 'COMPLETED' });
    expect(reads).toBe(3);
    const failing = cachedEvidenceReader({ read: async () => { throw new Error('boom'); } }, () => clock);
    expect(await failing.read('wlj_y')).toBeNull();
  });
});
