import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * THE AUTONOMOUS LANDING GATE (`.github/julius-landing/**` + `.github/workflows/julius-land.yml`).
 *
 * The workflow is the ONLY automated merger and this repository has no branch protection, so these tests are the second lock on it: every gate is shown to REFUSE (forged or tampered
 * signature, stale clearance, changed head, wrong base, wrong tree, unauthorized branch, founder-governed or forbidden files, failing/pending CI, changed bot comments, a merge API
 * error, a landed tree that is not the cleared one) and the happy path to merge exactly once, pinned to the cleared head. The end-to-end cases run the REAL `land.mjs` in a child
 * process against an in-memory fake of the GitHub REST API (a preloaded fetch), so no network is touched and nothing can merge anything.
 */

const ROOT = resolve(__dirname, '..');
const LANDING = resolve(ROOT, '.github/julius-landing');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/julius-land.yml'), 'utf8');
const lib = (await import(pathToFileURL(join(LANDING, 'land-lib.mjs')).href)) as Record<string, any>;

const REPO = 'ohdieyuh-glitch/sunday-relay';
const H = 'a'.repeat(40);
const T = 'b'.repeat(40);
const B = 'c'.repeat(40);
const NOW = Date.parse('2026-10-19T05:00:00Z');
const BRANCH = 'relay/julius-diag-digest-evidence-1';

const keys = generateKeyPairSync('ed25519');
const otherKeys = generateKeyPairSync('ed25519');
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

const clearanceText = (over: Record<string, string> = {}) => {
  const f: Record<string, string> = {
    pr: '7', head: H, tree: T, base: B, kind: 'CLEARED-TREE', 'bot-comments-sha256': createHash('sha256').update('').digest('hex'), 'governed-exceptions': '-', nonce: '0123456789abcdef0123456789abcdef', by: 'INDEPENDENT_REVIEW',
    issued: '2026-10-19T04:59:00Z', expires: '2026-10-19T10:59:00Z', ...over,
  };
  return ['JULIUS-CLEARANCE-V1', `repo: ${REPO}`, ...['pr', 'head', 'tree', 'base', 'kind', 'bot-comments-sha256', 'governed-exceptions', 'nonce', 'by', 'issued', 'expires'].map((k) => `${k}: ${f[k]}`), ''].join('\n');
};
const sig = (text: string, key = keys.privateKey) => sign(null, Buffer.from(text, 'utf8'), key).toString('base64');

const goodPr = () => ({
  number: 7, state: 'open', merged: false, draft: false, title: 'Julius: test landing', commits: 1, changed_files: 1,
  head: { sha: H, ref: BRANCH, repo: { full_name: REPO } }, base: { ref: 'main' }, user: { login: 'julius-worker[bot]' },
});
const goodCommit = () => ({ commit: { tree: { sha: T }, author: { name: 'julius-worker[bot]' }, committer: { name: 'julius-worker[bot]' } }, parents: [{ sha: B }] });
const allowed = [BRANCH];
const emptyDigest = createHash('sha256').update('').digest('hex');
const check = (over: Record<string, unknown> = {}) => lib.checkPullRequest({
  fields: lib.parseClearance(clearanceText()).fields, now: NOW, pr: goodPr(), commit: goodCommit(), files: ['.github/julius-missions/x/contract.json'], fileRows: 1, mainSha: B, allowedBranches: allowed, digest: emptyDigest, ...over,
}) as string[];

describe('the clearance text', () => {
  it('parses the canonical form and refuses every deviation', () => {
    expect(lib.parseClearance(clearanceText()).problems).toEqual([]);
    const text = clearanceText();
    const bad = [
      text.replace('JULIUS-CLEARANCE-V1', 'JULIUS-CLEARANCE-V2'), text.replace(REPO, 'someone/else'), text.replace(`head: ${H}`, 'head: abc'), text.replace('pr: 7', 'pr: 0'),
      text.replace('CLEARED-TREE', 'APPROVED'), text.replace('nonce: 0123456789abcdef0123456789abcdef', 'nonce: short'), text.replace('by: INDEPENDENT_REVIEW', 'by: JULIUS_DEV'), text.replace('issued: 2026-10-19T04:59:00Z', 'issued: yesterday'), `${text}extra: line\n`, text.slice(0, -1), text.replace('\n', '\r\n'),
    ];
    for (const b of bad) expect(lib.parseClearance(b).problems.length, JSON.stringify(b.slice(0, 60))).toBeGreaterThan(0);
  });
});

describe('the signature is the trust anchor', () => {
  it('accepts the reviewer key and refuses a forged, tampered, truncated or wrong-type signature', () => {
    const text = clearanceText();
    expect(lib.verifyClearanceSignature(text, sig(text), publicPem)).toEqual([]);
    expect(lib.verifyClearanceSignature(text, sig(text, otherKeys.privateKey), publicPem), 'signed by another key').not.toEqual([]);
    expect(lib.verifyClearanceSignature(text.replace(H, 'd'.repeat(40)), sig(text), publicPem), 'text changed after signing').not.toEqual([]);
    expect(lib.verifyClearanceSignature(text, sig(text).slice(0, 40), publicPem), 'truncated').not.toEqual([]);
    expect(lib.verifyClearanceSignature(text, '', publicPem), 'empty').not.toEqual([]);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(lib.verifyClearanceSignature(text, sig(text), rsa), 'a non-ed25519 committed key').not.toEqual([]);
    expect(lib.verifyClearanceSignature(text, sig(text), '-----BEGIN PUBLIC KEY-----\nPLACEHOLDER\n-----END PUBLIC KEY-----\n'), 'the shipped placeholder key').not.toEqual([]);
  });
});

describe('the pull request against the clearance', () => {
  it('holds for the exact cleared PR and refuses each way it can differ', () => {
    expect(check()).toEqual([]);
    expect(check({ now: Date.parse('2026-10-19T11:00:00Z') }), 'stale: expired').not.toEqual([]);
    expect(check({ now: Date.parse('2026-10-19T04:00:00Z') }), 'dated in the future').not.toEqual([]);
    expect(check({ pr: { ...goodPr(), head: { ...goodPr().head, sha: 'e'.repeat(40) } } }), 'changed head').not.toEqual([]);
    expect(check({ mainSha: 'f'.repeat(40) }), 'main moved').not.toEqual([]);
    expect(check({ commit: { ...goodCommit(), commit: { ...goodCommit().commit, tree: { sha: 'f'.repeat(40) } } } }), 'wrong tree').not.toEqual([]);
    expect(check({ commit: { ...goodCommit(), parents: [{ sha: B }, { sha: H }] } }), 'merge commit').not.toEqual([]);
    expect(check({ pr: { ...goodPr(), commits: 2 } }), 'two commits').not.toEqual([]);
    expect(check({ pr: { ...goodPr(), user: { login: 'ohdieyuh-glitch' } } }), 'not the App').not.toEqual([]);
    expect(check({ commit: { ...goodCommit(), commit: { ...goodCommit().commit, author: { name: 'someone' } } } }), 'commit not authored by the App').not.toEqual([]);
    expect(check({ pr: { ...goodPr(), draft: true } }), 'draft').not.toEqual([]);
    expect(check({ pr: { ...goodPr(), state: 'closed' } }), 'closed').not.toEqual([]);
    expect(check({ pr: { ...goodPr(), number: 8 } }), 'another PR').not.toEqual([]);
    expect(check({ pr: { ...goodPr(), head: { ...goodPr().head, ref: 'relay/not-allowed' } } }), 'branch not in the founder allowlist').not.toEqual([]);
    expect(check({ pr: { ...goodPr(), head: { ...goodPr().head, repo: { full_name: 'fork/repo' } } } }), 'a fork head').not.toEqual([]);
    expect(check({ digest: 'f'.repeat(64) }), 'bot comments changed since the reviewer looked').not.toEqual([]);
    expect(check({ files: [] }), 'no files').not.toEqual([]);
  });

  it('cannot land HARD founder-governed paths (workflows, the landing system, pins, migrations, approvers, package manifests, CODEOWNERS, CLAUDE.md, the evidence dump), signed or not', () => {
    const hard = [
      '.github/workflows/julius-land.yml', '.github/workflows/anything.yml', '.github/julius-landing/reviewer-ed25519.pub', '.github/julius-landing/allowed-branches.txt', '.github/julius-landing/required-checks.txt',
      '.github/julius-landing/land.mjs', '.github/julius-mission-pins.txt', 'relay-bridge/migrations/040_x.sql', 'src/db/migration/1.sql', '.github/julius-approvers.json', 'scripts/julius-approval-gates.mjs',
      'package.json', 'package-lock.json', '.github/CODEOWNERS', 'CODEOWNERS', 'CLAUDE.md', 'scripts/julius-live-evidence.mjs', '.github/julius-live-evidence-dump.sh',
    ];
    for (const f of hard) expect(check({ files: ['ok.ts', f], fileRows: 2, pr: { ...goodPr(), changed_files: 2 } }).join(' '), f).toContain('founder-governed');
    expect(check({ files: ['.github/julius-missions/m/contract.json', 'src/relay/x.ts'], fileRows: 2, pr: { ...goodPr(), changed_files: 2 } })).toEqual([]);
  });

  it('a RENAME or COPY is judged by BOTH names: a workflow moved out of .github/workflows is still a workflow change', () => {
    const rename = ['docs/harmless.md', '.github/workflows/julius-land.yml'];
    expect(check({ files: rename, fileRows: 1, pr: { ...goodPr(), changed_files: 1 } }).join(' ')).toContain('founder-governed');
    const copyInto = ['.github/workflows/new.yml', 'scripts/old.mjs'];
    expect(check({ files: copyInto, fileRows: 1, pr: { ...goodPr(), changed_files: 1 } }).join(' ')).toContain('founder-governed');
  });

  it('a truncated, short or huge file list is refused: rows read must equal the PR changed_files, and 300 is the ceiling', () => {
    expect(check({ fileRows: 1, pr: { ...goodPr(), changed_files: 5 } }).join(' ')).toContain('incomplete');
    expect(check({ fileRows: 0, pr: { ...goodPr(), changed_files: 1 } }).join(' ')).toContain('incomplete');
    expect(check({ files: ['a.ts'], fileRows: 301, pr: { ...goodPr(), changed_files: 301 } }).join(' ')).toContain('more than 300');
    expect(check({ pr: { ...goodPr(), changed_files: undefined } }).join(' ')).not.toBe('');
  });

  it('the spend ceilings and the effort tripwire change only if the reviewer signed that exact file, and a signed exception for an unchanged file is refused', () => {
    const files = ['.github/julius-missions/m/contract.json', 'scripts/julius-live-contract-check.mjs'];
    const pr = { ...goodPr(), changed_files: 2 };
    const withExc = (v: string) => lib.parseClearance(clearanceText({ 'governed-exceptions': v })).fields;
    expect(check({ files, fileRows: 2, pr }).join(' '), 'unsigned').toContain('not listed in the signed governed-exceptions');
    expect(check({ files, fileRows: 2, pr, fields: withExc('scripts/julius-live-contract-check.mjs') })).toEqual([]);
    expect(check({ files: ['.github/julius-missions/m/contract.json'], fileRows: 1, fields: withExc('scripts/julius-live-contract-check.mjs') }).join(' '), 'exception for an unchanged file').toContain('does not change');
    expect(check({ files: [...files, 'relay-bridge/julius/role-effort.test.ts'], fileRows: 3, pr: { ...goodPr(), changed_files: 3 }, fields: withExc('scripts/julius-live-contract-check.mjs') }).join(' '), 'one of two signed').toContain('role-effort.test.ts');
    for (const bad of ['package.json', 'scripts/julius-live-contract-check.mjs,package.json', 'scripts/julius-live-contract-check.mjs,scripts/julius-live-contract-check.mjs', 'scripts/zzz.mjs,scripts/julius-live-contract-check.mjs']) {
      expect(lib.parseClearance(clearanceText({ 'governed-exceptions': bad })).problems.length, bad).toBeGreaterThan(0);
    }
    // a workflow can never be excepted: the exception list is limited to the two eligible files
    expect(lib.parseClearance(clearanceText({ 'governed-exceptions': '.github/workflows/julius-land.yml' })).problems.length).toBeGreaterThan(0);
  });

  it('the runtime guard: the job must run from refs/heads/main at main\'s tip', () => {
    expect(lib.checkRuntime({ ref: 'refs/heads/main', sha: B, mainSha: B })).toEqual([]);
    expect(lib.checkRuntime({ ref: 'refs/heads/relay/rogue', sha: B, mainSha: B })).not.toEqual([]);
    expect(lib.checkRuntime({ ref: 'refs/heads/main', sha: 'e'.repeat(40), mainSha: B })).not.toEqual([]);
    expect(lib.checkRuntime({ ref: undefined, sha: undefined, mainSha: B })).not.toEqual([]);
  });

  it('the digest of bot comments, inline comments and reviews is order independent and changes with any addition', () => {
    const a = { issueComments: [{ user: { login: 'v' }, id: 1, updated_at: 't1' }, { user: { login: 'c' }, id: 2, updated_at: 't2' }], inlineComments: [], reviews: [] };
    const reversed = { ...a, issueComments: [...a.issueComments].reverse() };
    expect(lib.botCommentsDigest(a)).toBe(lib.botCommentsDigest(reversed));
    expect(lib.botCommentsDigest({ ...a, issueComments: [...a.issueComments, { user: { login: 'x' }, id: 3, updated_at: 't3' }] })).not.toBe(lib.botCommentsDigest(a));
    expect(lib.botCommentsDigest({ ...a, reviews: [{ user: { login: 'r' }, id: 9, state: 'APPROVED', commit_id: H }] })).not.toBe(lib.botCommentsDigest(a));
    expect(lib.botCommentsDigest({ ...a, issueComments: [{ ...a.issueComments[0], updated_at: 't9' }, a.issueComments[1]] }), 'an edited comment').not.toBe(lib.botCommentsDigest(a));
  });

  it('a nonce is used once: it is found in a landed commit message and nowhere else', () => {
    expect(lib.nonceUsed(['x', 'Landed. clearance-nonce aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.'], 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(lib.nonceUsed(['x', 'Landed. clearance-nonce bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.'], 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(lib.nonceUsed([], 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('CI must be completed and green; this workflow\'s own check is ignored; a pending status blocks', () => {
    const run = (name: string, status: string, conclusion: string | null) => ({ name, status, conclusion });
    const self = 'Land a cleared pull request';
    expect(lib.checkCi({ checkRuns: [run('a', 'completed', 'success'), run(self, 'in_progress', null)], statuses: [{ context: 's', state: 'success' }], self })).toEqual([]);
    expect(lib.checkCi({ checkRuns: [run('a', 'completed', 'failure')], statuses: [], self }), 'failure').not.toEqual([]);
    expect(lib.checkCi({ checkRuns: [run('a', 'completed', 'cancelled')], statuses: [], self }), 'cancelled').not.toEqual([]);
    expect(lib.checkCi({ checkRuns: [run('a', 'completed', 'skipped')], statuses: [], self }), 'skipped is not green').not.toEqual([]);
    expect(lib.checkCi({ checkRuns: [run('a', 'in_progress', null)], statuses: [], self }), 'pending').not.toEqual([]);
    expect(lib.checkCi({ checkRuns: [], statuses: [], self }), 'nothing ran').not.toEqual([]);
    expect(lib.checkCi({ checkRuns: [run('a', 'completed', 'success')], statuses: [{ context: 's', state: 'pending' }], self })).not.toEqual([]);
    const required = ['Verify Relay', 'real-infra-julius'];
    const ok2 = [run('Verify Relay', 'completed', 'success'), run('real-infra-julius', 'completed', 'success')];
    expect(lib.checkCi({ checkRuns: ok2, statuses: [], self, required })).toEqual([]);
    expect(lib.checkCi({ checkRuns: [run('real-infra-julius', 'completed', 'success'), run('other', 'completed', 'success')], statuses: [], self, required }).join(' '), 'Verify Relay never ran').toContain('Verify Relay');
    expect(lib.checkCi({ checkRuns: [run('Verify Relay', 'completed', 'success'), run('other', 'completed', 'success')], statuses: [], self, required }).join(' '), 'real-infra-julius never ran').toContain('real-infra-julius');
    expect(lib.checkCi({ checkRuns: [...ok2, run('Verify Relay', 'completed', 'success')], statuses: [], self, required }).join(' '), 'a duplicated required check').toContain('2 times');
    expect(lib.ciIsPending({ checkRuns: [run('a', 'queued', null)], statuses: [], self })).toBe(true);
    expect(lib.ciIsPending({ checkRuns: [run(self, 'in_progress', null), run('a', 'completed', 'success')], statuses: [], self })).toBe(false);
  });

  it('the landed commit must be the cleared tree directly on the cleared base', () => {
    expect(lib.checkLanded({ landed: { parents: [{ sha: B }], commit: { tree: { sha: T } } }, base: B, tree: T })).toEqual([]);
    expect(lib.checkLanded({ landed: { parents: [{ sha: B }], commit: { tree: { sha: 'f'.repeat(40) } } }, base: B, tree: T })).not.toEqual([]);
    expect(lib.checkLanded({ landed: { parents: [{ sha: 'f'.repeat(40) }], commit: { tree: { sha: T } } }, base: B, tree: T })).not.toEqual([]);
  });
});

/* ------------------------------------------------------------- end to end: the real land.mjs against a fake GitHub */

const work = mkdtempSync(join(tmpdir(), 'julius-land-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const landDir = join(work, 'land');
mkdirSync(landDir, { recursive: true });
for (const f of ['land.mjs', 'land-lib.mjs']) cpSync(join(LANDING, f), join(landDir, f));
writeFileSync(join(landDir, 'required-checks.txt'), '# test list\nVerify Relay\n');
writeFileSync(join(landDir, 'reviewer-ed25519.pub'), publicPem);
writeFileSync(join(landDir, 'allowed-branches.txt'), `# test allowlist\n${BRANCH}\n`);
const preload = join(work, 'fake-github.mjs');
writeFileSync(preload, `
import { readFileSync, appendFileSync } from 'node:fs';
const scenario = JSON.parse(readFileSync(process.env.FAKE_SCENARIO, 'utf8'));
const calls = process.env.FAKE_CALLS;
globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace('https://api.github.com', '');
  const method = init.method ?? 'GET';
  appendFileSync(calls, JSON.stringify({ method, path, body: init.body ?? null }) + '\\n');
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (method === 'PUT' && /\\/pulls\\/\\d+\\/merge$/.test(path)) return scenario.mergeStatus === 200 ? reply(200, { sha: scenario.mergedSha, merged: true }) : reply(scenario.mergeStatus, { message: 'merge refused by the fake' });
  if (path.includes('/git/ref/heads/main')) {
    const seq = scenario.mainSequence;
    const sha = seq ? seq[Math.min(globalThis.__mainReads = (globalThis.__mainReads ?? 0) + 1, seq.length) - 1] : scenario.main;
    return reply(200, { object: { sha } });
  }
  if (path.includes('/commits?sha=main')) return reply(200, scenario.history);
  if (/\\/commits\\/[0-9a-f]{40}\\/check-runs/.test(path)) return reply(200, { check_runs: scenario.checkRuns });
  if (/\\/commits\\/[0-9a-f]{40}\\/status/.test(path)) return reply(200, { statuses: scenario.statuses });
  if (path.includes('/commits/' + scenario.mergedSha)) return reply(200, scenario.landed);
  if (/\\/commits\\/[0-9a-f]{40}$/.test(path)) return reply(200, scenario.commit);
  if (/\\/pulls\\/\\d+\\/files/.test(path)) return reply(200, scenario.files.map((f) => (typeof f === 'string' ? { filename: f } : f)));
  if (/\\/issues\\/\\d+\\/comments/.test(path)) return reply(200, scenario.issueComments);
  if (/\\/pulls\\/\\d+\\/comments/.test(path)) return reply(200, scenario.inlineComments);
  if (/\\/pulls\\/\\d+\\/reviews/.test(path)) return reply(200, scenario.reviews);
  if (/\\/pulls\\/\\d+$/.test(path)) return reply(200, scenario.pr);
  return reply(404, { message: 'unexpected path ' + path });
};
`);

let counter = 0;
function runLand(over: { scenario?: Record<string, unknown>; text?: string; signature?: string; head?: string; pr?: string; dryRun?: string; ciWaitMs?: string; ref?: string; sha?: string } = {}) {
  counter += 1;
  const scenarioFile = join(work, `scenario-${counter}.json`);
  const callsFile = join(work, `calls-${counter}.log`);
  writeFileSync(callsFile, '');
  writeFileSync(scenarioFile, JSON.stringify({
    main: B, mergedSha: '9'.repeat(40), mergeStatus: 200, pr: goodPr(), commit: goodCommit(), files: ['.github/julius-missions/x/contract.json'],
    checkRuns: [{ name: 'Verify Relay', status: 'completed', conclusion: 'success' }, { name: 'Land a cleared pull request', status: 'in_progress', conclusion: null }], statuses: [{ context: 'v', state: 'success' }],
    issueComments: [], inlineComments: [], reviews: [], history: [{ commit: { message: 'an earlier landing' } }], landed: { parents: [{ sha: B }], commit: { tree: { sha: T } } }, ...(over.scenario ?? {}),
  }));
  const text = over.text ?? clearanceText();
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(landDir, 'land.mjs')], {
    encoding: 'utf8', timeout: 25_000,
    env: {
      PATH: process.env.PATH ?? '', FAKE_SCENARIO: scenarioFile, FAKE_CALLS: callsFile, GH_TOKEN: 'not-a-token', PR: over.pr ?? '7', HEAD: over.head ?? H,
      CLEARANCE_B64: Buffer.from(text, 'utf8').toString('base64'), SIGNATURE_B64: over.signature ?? sig(text), DRY_RUN: over.dryRun ?? 'false', LAND_CI_WAIT_MS: over.ciWaitMs ?? '0', GITHUB_REF: over.ref ?? 'refs/heads/main', GITHUB_SHA: over.sha ?? B,
    },
  });
  const calls = readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { method: string; path: string; body: string | null });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, merges: calls.filter((c) => c.method === 'PUT'), calls };
}

describe('land.mjs end to end against a fake GitHub', () => {
  it('merges exactly once, squash, pinned to the cleared head, and verifies the landed tree', () => {
    const r = runLand();
    expect(r.out).toContain('MERGED PR #7');
    expect(r.code).toBe(0);
    expect(r.merges).toHaveLength(1);
    const body = JSON.parse(r.merges[0]!.body ?? '{}') as Record<string, string>;
    expect(body.sha).toBe(H);
    expect(body.merge_method).toBe('squash');
  });

  it('a signed governed exception lets exactly that file change', () => {
    const text = clearanceText({ 'governed-exceptions': 'scripts/julius-live-contract-check.mjs' });
    const r = runLand({ text, signature: sig(text), scenario: { files: ['.github/julius-missions/x/contract.json', 'scripts/julius-live-contract-check.mjs'], pr: { ...goodPr(), changed_files: 2 } } });
    expect(r.out).toContain('MERGED PR #7');
    expect(r.merges).toHaveLength(1);
    const other = runLand({ text, signature: sig(text), scenario: { files: ['.github/julius-missions/x/contract.json', 'scripts/julius-live-contract-check.mjs', 'relay-bridge/julius/role-effort.test.ts'], pr: { ...goodPr(), changed_files: 3 } } });
    expect(other.merges).toHaveLength(0);
    expect(other.code).toBe(1);
  });

  it('a dry run (and anything other than the exact string "false") never merges', () => {
    for (const dryRun of ['true', '', 'False', 'no', '0']) {
      const r = runLand({ dryRun });
      expect(r.code, dryRun).toBe(0);
      expect(r.merges, `DRY_RUN=${JSON.stringify(dryRun)}`).toHaveLength(0);
      expect(r.out).toContain('DRY RUN');
    }
  });

  it('refuses without merging: forged signature, tampered clearance, stale clearance, changed head, moved main, wrong tree', () => {
    const text = clearanceText();
    const cases: Array<[string, ReturnType<typeof runLand>]> = [
      ['forged signature (another key)', runLand({ signature: sig(text, otherKeys.privateKey) })],
      ['tampered clearance (head swapped, old signature)', runLand({ text: clearanceText({ head: 'd'.repeat(40) }), signature: sig(text), head: 'd'.repeat(40) })],
      ['stale clearance', runLand({ text: clearanceText({ issued: '2026-10-10T00:00:00Z', expires: '2026-10-11T00:00:00Z' }) })],
      ['dispatch head differs from the signed head', runLand({ head: 'd'.repeat(40) })],
      ['PR head moved after clearance', runLand({ scenario: { pr: { ...goodPr(), head: { ...goodPr().head, sha: 'e'.repeat(40) } } } })],
      ['main moved', runLand({ scenario: { main: 'f'.repeat(40) } })],
      ['replay: the nonce is already in main history', runLand({ scenario: { history: [{ commit: { message: 'Landed. clearance-nonce 0123456789abcdef0123456789abcdef.' } }] } })],
      ['wrong tree', runLand({ scenario: { commit: { ...goodCommit(), commit: { ...goodCommit().commit, tree: { sha: 'f'.repeat(40) } } } } })],
    ];
    for (const [name, r] of cases) {
      expect(r.code, `${name}: ${r.out}`).toBe(1);
      expect(r.merges, name).toHaveLength(0);
      expect(r.out, name).toContain('REFUSED');
    }
  });

  it('refuses without merging: unauthorized branch, founder-governed files, failing or pending CI, changed bot comments', () => {
    const cases: Array<[string, ReturnType<typeof runLand>]> = [
      ['branch outside the allowlist', runLand({ scenario: { pr: { ...goodPr(), head: { ...goodPr().head, ref: 'relay/rogue' } } } })],
      ['a workflow file in the PR', runLand({ scenario: { files: ['.github/workflows/julius-land.yml'] } })],
      ['the landing key in the PR', runLand({ scenario: { files: ['.github/julius-landing/reviewer-ed25519.pub'] } })],
      ['the allowlist in the PR', runLand({ scenario: { files: ['ok.ts', '.github/julius-landing/allowed-branches.txt'], pr: { ...goodPr(), changed_files: 2 } } })],
      ['a workflow RENAMED out of .github/workflows (previous_filename)', runLand({ scenario: { files: [{ filename: 'docs/harmless.md', previous_filename: '.github/workflows/julius-land.yml', status: 'renamed' }] } })],
      ['a truncated files list (5 changed, 1 row)', runLand({ scenario: { pr: { ...goodPr(), changed_files: 5 } } })],
      ['approvers json in the PR', runLand({ scenario: { files: ['.github/julius-approvers.json'] } })],
      ['package.json in the PR', runLand({ scenario: { files: ['package.json'] } })],
      ['the spend ceilings changed with no signed exception', runLand({ scenario: { files: ['scripts/julius-live-contract-check.mjs'] } })],
      ['the required check Verify Relay never ran', runLand({ scenario: { checkRuns: [{ name: 'Vercel', status: 'completed', conclusion: 'success' }] } })],
      ['Verify Relay ran twice', runLand({ scenario: { checkRuns: [{ name: 'Verify Relay', status: 'completed', conclusion: 'success' }, { name: 'Verify Relay', status: 'completed', conclusion: 'success' }] } })],
      ['the workflow runs from another ref', runLand({ ref: 'refs/heads/relay/rogue' })],
      ['the workflow commit is not main\'s tip', runLand({ sha: 'e'.repeat(40) })],
      ['main moves between the final re-check and the merge', runLand({ scenario: { mainSequence: [B, B, B, 'f'.repeat(40)] } })],
      ['a failing check', runLand({ scenario: { checkRuns: [{ name: 'Verify Relay', status: 'completed', conclusion: 'failure' }] } })],
      ['a pending check (wait budget 0)', runLand({ scenario: { checkRuns: [{ name: 'Verify Relay', status: 'in_progress', conclusion: null }] } })],
      ['a new bot comment since the clearance', runLand({ scenario: { issueComments: [{ user: { login: 'bot' }, id: 5, updated_at: 't' }] } })],
      ['a review appeared', runLand({ scenario: { reviews: [{ user: { login: 'someone' }, id: 6, state: 'APPROVED', commit_id: H }] } })],
    ];
    for (const [name, r] of cases) {
      expect(r.code, `${name}: ${r.out}`).toBe(1);
      expect(r.merges, name).toHaveLength(0);
    }
  });

  it('a merge API error fails the job, and a landed tree that is not the cleared one raises an alert (exit 2)', () => {
    const rejected = runLand({ scenario: { mergeStatus: 405 } });
    expect(rejected.code).not.toBe(0);
    expect(rejected.merges).toHaveLength(1);
    const wrong = runLand({ scenario: { landed: { parents: [{ sha: B }], commit: { tree: { sha: 'f'.repeat(40) } } } } });
    expect(wrong.code).toBe(2);
    expect(wrong.out).toContain('ALERT AFTER MERGE');
  });
});

describe('the workflow file is pinned', () => {
  const on = /\non:\n([\s\S]*?)\n[a-z]/u.exec(WORKFLOW)?.[1] ?? '';
  it('is dispatch-only, with the least permissions the merge needs and none that could change workflows or delete a checkpoint', () => {
    expect(on).toContain('workflow_dispatch:');
    for (const trigger of ['push:', 'pull_request', 'schedule:', 'workflow_run:', 'repository_dispatch:', 'issue_comment']) expect(on, trigger).not.toContain(trigger);
    const permissions = /\npermissions:\n((?: {2}[a-z-]+: [a-z]+\n)+)/u.exec(WORKFLOW)?.[1] ?? '';
    expect(permissions.trim().split('\n').map((l) => l.trim())).toEqual(['contents: write', 'pull-requests: write', 'checks: read', 'statuses: read', 'issues: read']);
    expect(WORKFLOW).not.toMatch(/\n\s+(actions|workflows|id-token|packages|deployments):\s/u);
  });

  it('uses no secret, pins every action to a commit, checks out main, and passes inputs only through env (never into the shell text)', () => {
    expect(WORKFLOW).not.toMatch(/secrets\./u);
    const uses = [...WORKFLOW.matchAll(/\n\s+- uses: (\S+)/gu)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, 'an action not pinned by 40-hex sha').toMatch(/@[0-9a-f]{40}$/u);
    expect(WORKFLOW).toMatch(/ref: main\n/u);
    const runLines = [...WORKFLOW.matchAll(/\n\s+run: (.*)/gu)].map((m) => m[1]!);
    expect(runLines).toEqual(['node .github/julius-landing/land.mjs']);
    for (const line of runLines) expect(line).not.toContain('${{');
    expect(WORKFLOW).not.toContain('LAND_CI_WAIT_MS');
  });

  it('the job does not start from any ref but main (a branch copy of the workflow cannot run)', () => {
    expect(WORKFLOW).toContain("\n    if: github.ref == 'refs/heads/main'\n");
  });

  it('defaults to a dry run and merges only on an explicit "false"; the job cannot cancel another landing', () => {
    expect(WORKFLOW).toMatch(/dry_run:[\s\S]*?default: 'true'/u);
    expect(WORKFLOW).toMatch(/cancel-in-progress: false/u);
    expect(readFileSync(join(LANDING, 'land.mjs'), 'utf8')).toContain("env.DRY_RUN !== 'false'");
  });

  it('V6 stays off the autonomous path, and the required-check list names the six CI checks', () => {
    const list = readFileSync(join(LANDING, 'allowed-branches.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    expect(list.filter((b) => b.includes('v6'))).toEqual([]);
    const req = readFileSync(join(LANDING, 'required-checks.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    expect(req).toEqual(['Verify Relay', 'real-infra-julius', 'learning-store-container', 'sibling-control-plane', 'first-live-topology (executor-private)', 'first-live-topology (host-visible)']);
  });

  it('the allowlist names only the authorized workstream branches and the committed key is a PEM public key or the shipped placeholder', () => {
    const list = readFileSync(join(LANDING, 'allowed-branches.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    for (const b of list) expect(b).toMatch(/^relay\/julius-[a-z0-9-]+$/u);
    expect(readFileSync(join(LANDING, 'reviewer-ed25519.pub'), 'utf8')).toContain('BEGIN PUBLIC KEY');
    expect(readFileSync(join(LANDING, 'reviewer-ed25519.pub'), 'utf8')).not.toMatch(/PRIVATE KEY/u);
  });
});
