import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ADVERSARIAL TESTS FOR THE AUTONOMOUS LANDING GATE (juju2, read-only attack on MAIN JULIUS's dev/autonomous-landing).
 *
 * Every test in `ATTACK` is a way to land (or to be unable to refuse) something the clearance did not authorize. They FAIL against the committed implementation (b02361b8) and pass
 * against `hardened/` (the patch that goes with them). `LANDING_DIR` and `WORKFLOW_FILE` select which implementation is attacked; the default is the committed one.
 * The `NON-FINDINGS` block are attacks that FAIL to get through, kept as evidence that they were tried.
 * No secret-shaped literal appears here: the key pair is generated per run.
 */

const ROOT = resolve(__dirname, '..');
const LANDING = process.env.LANDING_DIR ? resolve(process.env.LANDING_DIR) : resolve(ROOT, '.github/julius-landing');
const WORKFLOW = readFileSync(process.env.WORKFLOW_FILE ? resolve(process.env.WORKFLOW_FILE) : resolve(ROOT, '.github/workflows/julius-land.yml'), 'utf8');
const lib = (await import(pathToFileURL(join(LANDING, 'land-lib.mjs')).href)) as Record<string, any>;

const REPO = 'ohdieyuh-glitch/sunday-relay';
const H = 'a'.repeat(40);
const T = 'b'.repeat(40);
const B = 'c'.repeat(40);
const B2 = 'd'.repeat(40);
const NOW = Date.parse('2026-10-19T05:00:00Z');
const BRANCH = 'relay/julius-diag-digest-evidence-1';
const APP = 'julius-worker[bot]';
const NONCE = '0123456789abcdef0123456789abcdef';

const keys = generateKeyPairSync('ed25519');
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const emptyDigest = createHash('sha256').update('').digest('hex');

const clearanceText = (over: Record<string, string> = {}) => {
  const f: Record<string, string> = {
    pr: '7', head: H, tree: T, base: B, kind: 'CLEARED-TREE', 'bot-comments-sha256': emptyDigest, nonce: NONCE, by: 'INDEPENDENT_REVIEW',
    issued: '2026-10-19T04:59:00Z', expires: '2026-10-19T10:59:00Z', ...over,
  };
  return ['JULIUS-CLEARANCE-V1', `repo: ${REPO}`, ...['pr', 'head', 'tree', 'base', 'kind', 'bot-comments-sha256', 'nonce', 'by', 'issued', 'expires'].map((k) => `${k}: ${f[k]}`), ''].join('\n');
};
const sig = (text: string) => sign(null, Buffer.from(text, 'utf8'), keys.privateKey).toString('base64');
const goodPr = () => ({
  number: 7, state: 'open', merged: false, draft: false, title: 'Julius: test landing', commits: 1,
  head: { sha: H, ref: BRANCH, repo: { full_name: REPO } }, base: { ref: 'main' }, user: { login: APP },
});
const goodCommit = () => ({ commit: { tree: { sha: T }, author: { name: APP }, committer: { name: APP } }, parents: [{ sha: B }] });
const check = (over: Record<string, unknown> = {}) => lib.checkPullRequest({
  fields: lib.parseClearance(clearanceText()).fields, now: NOW, pr: goodPr(), commit: goodCommit(), files: ['.github/julius-missions/x/contract.json'], mainSha: B, allowedBranches: [BRANCH], digest: emptyDigest, ...over,
}) as string[];

/* ------------------------------------------------------------ the real land.mjs against an extended fake GitHub */

const work = mkdtempSync(join(tmpdir(), 'julius-land-attack-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const landDir = join(work, 'land');
mkdirSync(landDir, { recursive: true });
for (const f of ['land.mjs', 'land-lib.mjs', 'reviewer-tools.mjs', 'required-checks.txt']) if (existsSync(join(LANDING, f))) cpSync(join(LANDING, f), join(landDir, f));
writeFileSync(join(landDir, 'reviewer-ed25519.pub'), publicPem);
writeFileSync(join(landDir, 'allowed-branches.txt'), `# attack allowlist\n${BRANCH}\n`);
// a required-checks file is part of the hardened design; the committed implementation has none, so the default is created ONLY when the implementation reads one
const readsRequired = readFileSync(join(landDir, 'land.mjs'), 'utf8').includes('required-checks');
if (readsRequired && !existsSync(join(landDir, 'required-checks.txt'))) writeFileSync(join(landDir, 'required-checks.txt'), 'Verify Relay\n');

const preload = join(work, 'fake-github.mjs');
writeFileSync(preload, `
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
const scenario = JSON.parse(readFileSync(process.env.FAKE_SCENARIO, 'utf8'));
const calls = process.env.FAKE_CALLS;
const counterFile = process.env.FAKE_COUNTERS;
const bump = (key) => { const c = existsSync(counterFile) ? JSON.parse(readFileSync(counterFile, 'utf8')) : {}; c[key] = (c[key] ?? 0) + 1; writeFileSync(counterFile, JSON.stringify(c)); return c[key]; };
const pageOf = (rows, url) => { const u = new URL(url); const per = Number(u.searchParams.get('per_page') ?? 30); const page = Number(u.searchParams.get('page') ?? 1); return rows.slice((page - 1) * per, page * per); };
globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace('https://api.github.com', '');
  const bare = path.split('?')[0];
  const method = init.method ?? 'GET';
  appendFileSync(calls, JSON.stringify({ method, path, body: init.body ?? null }) + '\\n');
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (method === 'PUT' && /\\/pulls\\/\\d+\\/merge$/.test(bare)) return reply(200, { sha: scenario.mergedSha, merged: true });
  if (method === 'POST' && /\\/git\\/commits$/.test(bare)) return reply(201, { sha: scenario.createdSha ?? '8'.repeat(40) });
  if (method === 'PATCH' && /\\/git\\/refs\\/heads\\/main$/.test(bare)) return scenario.mainMovedBeforeUpdate ? reply(422, { message: 'Update is not a fast forward' }) : reply(200, { object: { sha: scenario.createdSha ?? '8'.repeat(40) } });
  if (method === 'PATCH' && /\\/pulls\\/\\d+$/.test(bare)) return reply(200, {});
  if (method === 'POST' && /\\/issues\\/\\d+\\/comments$/.test(bare)) return reply(201, {});
  if (bare.includes('/git/ref/heads/main')) { const n = bump('main'); const seq = scenario.mainSequence; return reply(200, { object: { sha: seq ? seq[Math.min(n - 1, seq.length - 1)] : scenario.main } }); }
  if (bare.includes('/commits') && path.includes('sha=main')) return reply(200, pageOf(scenario.history, url));
  if (/\\/commits\\/[0-9a-f]{40}\\/check-runs$/.test(bare)) return reply(200, { total_count: scenario.checkRunsTotal ?? scenario.checkRuns.length, check_runs: pageOf(scenario.checkRuns, url) });
  if (/\\/commits\\/[0-9a-f]{40}\\/status$/.test(bare)) return reply(200, { state: 'success', total_count: scenario.statusesTotal ?? scenario.statuses.length, statuses: pageOf(scenario.statuses, url) });
  if (bare.includes('/commits/' + scenario.mergedSha)) return reply(200, scenario.landed);
  if (/\\/commits\\/[0-9a-f]{40}$/.test(bare)) return reply(200, scenario.commit);
  if (/\\/pulls\\/\\d+\\/files$/.test(bare)) return reply(200, pageOf(scenario.files, url));
  if (/\\/issues\\/\\d+\\/comments$/.test(bare)) return reply(200, pageOf(scenario.issueComments, url));
  if (/\\/pulls\\/\\d+\\/comments$/.test(bare)) return reply(200, pageOf(scenario.inlineComments, url));
  if (/\\/pulls\\/\\d+\\/reviews$/.test(bare)) return reply(200, pageOf(scenario.reviews, url));
  if (/\\/pulls\\/\\d+$/.test(bare)) return reply(200, scenario.pr);
  return reply(404, { message: 'unexpected path ' + path });
};
`);

let counter = 0;
const file = (filename: string, extra: Record<string, unknown> = {}) => ({ filename, status: 'modified', ...extra });
const green = (name: string) => ({ name, status: 'completed', conclusion: 'success' });
const SELF = { name: 'Land a cleared pull request', status: 'in_progress', conclusion: null };
function runLand(scenario: Record<string, unknown> = {}) {
  counter += 1;
  const scenarioFile = join(work, `scenario-${counter}.json`);
  const callsFile = join(work, `calls-${counter}.log`);
  const countersFile = join(work, `counters-${counter}.json`);
  writeFileSync(callsFile, '');
  writeFileSync(scenarioFile, JSON.stringify({
    main: B, mergedSha: '9'.repeat(40), pr: goodPr(), commit: goodCommit(), files: [file('.github/julius-missions/x/contract.json')],
    checkRuns: [green('Verify Relay'), SELF], statuses: [{ context: 'v', state: 'success' }], issueComments: [], inlineComments: [], reviews: [], history: [{ commit: { message: 'an earlier landing' } }],
    landed: { parents: [{ sha: B }], commit: { tree: { sha: T } } }, ...scenario,
  }));
  const text = clearanceText();
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(landDir, 'land.mjs')], {
    encoding: 'utf8', timeout: 25_000,
    env: {
      PATH: process.env.PATH ?? '', FAKE_SCENARIO: scenarioFile, FAKE_CALLS: callsFile, FAKE_COUNTERS: countersFile, GH_TOKEN: 'not-a-token', PR: '7', HEAD: H,
      CLEARANCE_B64: Buffer.from(text, 'utf8').toString('base64'), SIGNATURE_B64: sig(text), DRY_RUN: 'false', LAND_CI_WAIT_MS: '0',
    },
  });
  const calls = readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { method: string; path: string; body: string | null });
  /** Anything that moves main: the pull-request merge API, or a ref update. */
  const landings = calls.filter((c) => (c.method === 'PUT' && /\/merge$/.test(c.path)) || (c.method === 'PATCH' && /\/git\/refs\/heads\/main$/.test(c.path)));
  return { code: r.status, out: `${r.stdout}${r.stderr}`, calls, landings, mergeBodies: calls.filter((c) => c.method === 'PUT').map((c) => JSON.parse(c.body ?? '{}') as Record<string, string>) };
}
const refused = (r: ReturnType<typeof runLand>, why: string) => {
  expect(r.landings, `${why}: nothing may move main. Output: ${r.out.slice(-300)}`).toHaveLength(0);
  expect(r.code, why).toBe(1);
};

describe('ATTACK: ways past the gate', () => {
  it('ATK-1 the job runs only from main: a dispatch of a BRANCH copy of this workflow (which could drop every gate) must not run', () => {
    const job = /\njobs:\n {2}land:\n([\s\S]*?)\n {4}steps:/u.exec(WORKFLOW)?.[1] ?? '';
    expect(job.length, 'the job block was found').toBeGreaterThan(20);
    expect(job,"the job needs `if: github.ref == 'refs/heads/main'` (workflow_dispatch runs the workflow file of the SELECTED ref)").toMatch(/if:.*github\.ref\s*==\s*'refs\/heads\/main'/u);
  });

  it('ATK-2 a PR with only ONE unrelated green check lands: the lander never requires the named checks (Verify Relay) to be present', () => {
    refused(runLand({ checkRuns: [green('some-lint'), SELF] }), 'only an unrelated check ran, the real CI never started');
  });

  it('ATK-3 more than 100 check runs: a FAILING run beyond the first page is never read (fail-open)', () => {
    const rows = Array.from({ length: 100 }, (_, i) => green(i === 0 ? 'Verify Relay' : `matrix-${i}`));
    rows.push({ name: 'real-postgres', status: 'completed', conclusion: 'failure' } as never);
    refused(runLand({ checkRuns: rows, checkRunsTotal: rows.length }), 'run 101 failed');
  });

  it('ATK-4 more than 100 commit statuses: a failing status beyond the first page is never read', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ context: `s${i}`, state: 'success' }));
    rows.push({ context: 'security-scan', state: 'failure' });
    refused(runLand({ statuses: rows, statusesTotal: rows.length }), 'status 101 failed');
  });

  it('ATK-5 a RENAME out of a founder-governed path: only the NEW name is checked, so the reviewer key / allowlist / workflow can be deleted by renaming it', () => {
    for (const previous of ['.github/julius-landing/reviewer-ed25519.pub', '.github/julius-landing/allowed-branches.txt', '.github/workflows/julius-land.yml']) {
      refused(runLand({ files: [file('docs/harmless.txt', { status: 'renamed', previous_filename: previous })] }), `renamed away from ${previous}`);
    }
  });

  it('ATK-6 the founder-governed list misses the approver authority and CODEOWNERS, and is case-sensitive', () => {
    const paths = ['.github/julius-approvers.json', '.github/CODEOWNERS', '.GITHUB/julius-landing/allowed-branches.txt', '.github/Julius-Landing/reviewer-ed25519.pub', '.github/JULIUS-MISSION-PINS.txt'];
    const notRefused = paths.filter((path) => !check({ files: ['ok.ts', path] }).join(' ').includes('founder-governed'));
    expect(notRefused, 'every one of these must be refused as founder-governed').toEqual([]);
  });

  it('ATK-7 the App identity is a commit AUTHOR NAME (free text): a commit whose GitHub-resolved author is someone else passes', () => {
    const spoofed = { ...goodCommit(), author: { login: 'a-dev-session' }, committer: { login: 'a-dev-session' } };
    expect(check({ commit: spoofed }).length, 'the resolved GitHub login of the commit author/committer must be the App').toBeGreaterThan(0);
  });

  it('ATK-8 the PR TITLE (editable by anyone with write access) becomes the squash commit title verbatim; it can carry another clearance\'s nonce and any text', () => {
    const r = runLand({ pr: { ...goodPr(), title: 'APPROVED BY THE FOUNDER clearance-nonce ffffffffffffffffffffffffffffffff' } });
    expect(r.landings.length).toBe(1);
    const body = r.mergeBodies[0] ?? r.calls.map((c) => c.body).join(' ');
    expect(JSON.stringify(body), 'the landed commit title is built by the workflow, never from the PR title').not.toContain('APPROVED BY THE FOUNDER');
  });

  it('ATK-9 more than 1000 changed files: the page cap is silent, so a forbidden path past file 1000 is never seen', () => {
    const files = Array.from({ length: 1000 }, (_, i) => file(`docs/f${i}.md`));
    files.push(file('.github/julius-landing/reviewer-ed25519.pub'));
    refused(runLand({ files }), 'file 1001 is the reviewer key');
  });

  it('ATK-10 TOCTOU: main moves AFTER the final re-check; the merge API squashes onto the NEW tip (an unreviewed tree) and the lander only notices afterwards', () => {
    const r = runLand({ mainSequence: [B, B, B2], landed: { parents: [{ sha: B2 }], commit: { tree: { sha: 'e'.repeat(40) } } } });
    expect(r.landings, 'a landing is sent only when main still equals the cleared base at the moment of the request').toHaveLength(0);
    expect(r.code).toBe(1);
  });
});

describe('ATTACK: the reviewer tool and the lander must agree', () => {
  it('ATK-11 reviewer-tools `digest` reads ONE page; with more than 100 comments the digest the reviewer signs can never equal the lander\'s (the clearance is unusable)', () => {
    const comments = Array.from({ length: 105 }, (_, i) => ({ user: { login: 'bot' }, id: i + 1, updated_at: 't' }));
    const scenarioFile = join(work, 'digest-scenario.json');
    const callsFile = join(work, 'digest-calls.log');
    const countersFile = join(work, 'digest-counters.json');
    writeFileSync(callsFile, '');
    writeFileSync(scenarioFile, JSON.stringify({ issueComments: comments, inlineComments: [], reviews: [], files: [], history: [], checkRuns: [], statuses: [], main: B }));
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(landDir, 'reviewer-tools.mjs'), 'digest', '7'], {
      encoding: 'utf8', timeout: 25_000, env: { PATH: process.env.PATH ?? '', FAKE_SCENARIO: scenarioFile, FAKE_CALLS: callsFile, FAKE_COUNTERS: countersFile, GH_TOKEN: 'not-a-token' },
    });
    const expected = lib.botCommentsDigest({ issueComments: comments, inlineComments: [], reviews: [] }) as string;
    expect(r.stdout.trim(), r.stderr.slice(0, 200)).toBe(expected);
  });
});

describe('NON-FINDINGS: attacks that fail to get through (evidence they were tried)', () => {
  it('replaying a clearance after 100 newer commits cannot work: the nonce leaves the window but the BASE binding refuses (main is no longer the cleared base)', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({ commit: { message: `later commit ${i}` } }));
    const r = runLand({ history, main: B2 });
    refused(r, 'a replay with the nonce outside the 100-commit window');
    expect(r.out).toContain('main is');
  });

  it('inputs reach the shell only through env: no expression is interpolated into a run line', () => {
    const runLines = [...WORKFLOW.matchAll(/\n\s+run: (.*)/gu)].map((m) => m[1]!);
    for (const line of runLines) expect(line).not.toContain('${{');
  });

  it('a draft, a closed PR and a PR from a fork are refused by the pure check', () => {
    expect(check({ pr: { ...goodPr(), draft: true } }).length).toBeGreaterThan(0);
    expect(check({ pr: { ...goodPr(), state: 'closed' } }).length).toBeGreaterThan(0);
    expect(check({ pr: { ...goodPr(), head: { ...goodPr().head, repo: { full_name: 'fork/repo' } } } }).length).toBeGreaterThan(0);
  });
});
