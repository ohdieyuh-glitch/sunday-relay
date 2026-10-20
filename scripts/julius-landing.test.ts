import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// round 5 (c2): the top-level author account GitHub resolved must be the App; an unresolved (null) author is refused
const goodCommit = () => ({ commit: { tree: { sha: T }, author: { name: 'julius-worker[bot]' }, committer: { name: 'julius-worker[bot]' } }, author: { login: 'julius-worker[bot]' }, parents: [{ sha: B }] });
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
    expect(check({ files: ['a.ts'], fileRows: 301, pr: { ...goodPr(), changed_files: 301 } }).join(' ')).toContain('300 or more');
    const names = (n: number) => Array.from({ length: n }, (_, i) => `src/relay/x${i}.ts`);
    expect(check({ files: names(300), fileRows: 300, pr: { ...goodPr(), changed_files: 300 } }).join(' '), 'exactly 300 is refused (the provenance gate needs fewer than 300)').toContain('300 or more');
    expect(check({ files: names(299), fileRows: 299, pr: { ...goodPr(), changed_files: 299 } }), '299 passes').toEqual([]);
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

  it('reading pages is fail-closed: a full page at the cap throws after exactly the cap, a short page ends the read', async () => {
    let calls = 0;
    await expect(lib.readAllPages(async () => { calls += 1; return Array.from({ length: lib.PER_PAGE }, () => ({})); })).rejects.toThrow('refusing');
    expect(calls).toBe(lib.MAX_PAGES);
    let pages = 0;
    const rows = await lib.readAllPages(async () => { pages += 1; return pages < 3 ? Array.from({ length: lib.PER_PAGE }, () => ({})) : [{}]; });
    expect(rows).toHaveLength(2 * lib.PER_PAGE + 1);
    expect(pages).toBe(3);
    await expect(lib.readAllPages(async () => 'not a list')).rejects.toThrow('not a list');
  });

  it('governed paths are matched case-insensitively, including the exception-eligible files', () => {
    for (const f of ['.GitHub/Workflows/x.yml', '.github/JULIUS-LANDING/land.mjs', 'Package.JSON', 'claude.md', 'Scripts/Julius-Live-Contract-Check.mjs', 'Relay-Bridge/Julius/Role-Effort.test.ts']) {
      expect(check({ files: ['ok.ts', f], fileRows: 2, pr: { ...goodPr(), changed_files: 2 } }).join(' '), f).toContain('founder-governed');
    }
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
// the child process runs on the FIXTURE clock (NOW, still ticking), not the day the suite happens to run: the clearance fixtures are issued at NOW and expire hours later, so on the real
// clock every end-to-end case would fail once that expiry has passed. The shift is NOW minus the child's own start time, so it holds on any date.
const clockShift = ${NOW} - Date.now();
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + clockShift;
const scenario = JSON.parse(readFileSync(process.env.FAKE_SCENARIO, 'utf8'));
const calls = process.env.FAKE_CALLS;
globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace('https://api.github.com', '');
  const method = init.method ?? 'GET';
  appendFileSync(calls, JSON.stringify({ method, path, body: init.body ?? null }) + '\\n');
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  // scenario.failGet: a regexp source; any GET whose path matches answers HTTP 500 (an API failure before anything is written)
  // scenario.echo: the failure text echoes the request's Authorization header and token-shaped strings, as a misbehaving proxy or API might
  if (method === 'GET' && scenario.failGet && new RegExp(scenario.failGet).test(path) && scenario.echo === 'wrapped') {
    const tok = String(init.headers?.Authorization ?? '').replace(/^Bearer /, '');
    return reply(500, { message: 'upstream said: token ' + tok.slice(0, 20) + '\\n' + tok.slice(20) + ' and again Bearer ' + tok.slice(0, 14) + '\\r\\n ' + tok.slice(14) });
  }
  if (method === 'GET' && scenario.failGet && new RegExp(scenario.failGet).test(path) && scenario.echo === 'follow') {
    return reply(500, { message: 'upstream said: ghs_' + 'A'.repeat(36) + ' merged PR number 12 into main; also ghp_' + 'C'.repeat(36) + ' kept going, github_pat_' + 'B'.repeat(30) + ' done' });
  }
  if (method === 'GET' && scenario.failGet && new RegExp(scenario.failGet).test(path) && scenario.echo === 'b64') {
    const tok = String(init.headers?.Authorization ?? '').replace(/^Bearer /, '');
    const b = (s) => Buffer.from(s).toString('base64');
    return reply(500, { message: 'upstream said: ' + b(tok) + ' | ' + b('x-access-token:' + tok) + ' | ' + b('  ' + tok) + ' | ' + b(' ' + tok) + ' | ' + encodeURIComponent(tok) });
  }
  if (method === 'GET' && scenario.failGet && new RegExp(scenario.failGet).test(path)) return reply(500, { message: scenario.echo ? 'upstream said: Authorization: ' + (init.headers?.Authorization ?? '') + ' also ghs_' + 'A'.repeat(36) + ' github_pat_' + 'B'.repeat(30) + ' ghp_' + 'C'.repeat(36) : 'the fake fails this read' });
  // b6: the nonce tag. scenario.spentTags = tag names that already exist; scenario.tagReadStatus / tagCreateStatus override the answers.
  if (method === 'GET' && /\\/git\\/ref\\/tags\\//.test(path)) {
    const name = path.split('/git/ref/tags/')[1];
    if (scenario.tagReadStatus) return reply(scenario.tagReadStatus, { message: 'tag read answered by the fake' });
    return (scenario.spentTags ?? []).includes(name) ? reply(200, { ref: 'refs/tags/' + name }) : reply(404, { message: 'Not Found' });
  }
  if (method === 'POST' && /\\/git\\/refs$/.test(path)) {
    const b = JSON.parse(init.body);
    if (scenario.tagCreateStatus) return reply(scenario.tagCreateStatus, { message: 'tag creation answered by the fake' });
    if ((scenario.spentTags ?? []).includes(b.ref.replace('refs/tags/', ''))) return reply(422, { message: 'Reference already exists' });
    return reply(201, { ref: b.ref });
  }
  // The landing writes (git data API; the merge endpoint is not modelled on purpose: a request to it is an unexpected path, 404).
  if (method === 'POST' && /\\/git\\/commits$/.test(path)) {
    globalThis.__created = JSON.parse(init.body);
    return scenario.postStatus ? reply(scenario.postStatus, { message: 'commit creation refused by the fake' }) : reply(201, { sha: scenario.createdSha });
  }
  if (method === 'PATCH' && /\\/git\\/refs\\/heads\\/main$/.test(path)) {
    const b = JSON.parse(init.body);
    globalThis.__patchSeen = true;
    // scenario.patchLost: the update is (or is not) APPLIED by GitHub but the answer never arrives: 'applied' | 'unapplied' | 'moved' (main became something else), with 'throw' = a network error
    // and a number = an HTTP status (5xx) sent back instead of the answer
    if (scenario.patchLost) {
      if (scenario.patchLost.applied) globalThis.__mainAfterPatch = b.sha;
      if (scenario.patchLost.hang) return new Promise((_, reject) => { const keep = setTimeout(() => {}, 6000); init.signal?.addEventListener('abort', () => { clearTimeout(keep); reject(init.signal.reason); }); });
      if (scenario.patchLost.throw) throw new TypeError('fetch failed');
      return reply(scenario.patchLost.status, { message: 'the fake lost the answer' });
    }
    if (scenario.patchStatus) return reply(scenario.patchStatus, { message: 'ref update refused by the fake' });
    // GitHub's rule for a NON-forced update: refused unless main is still the parent of the new commit. A forced update would overwrite whatever main became.
    const mainNow = scenario.mainAtPatch ?? scenario.main;
    if (b.force !== true && mainNow !== globalThis.__created.parents[0]) return reply(422, { message: 'Update is not a fast forward' });
    globalThis.__mainAfterPatch = b.sha;
    return reply(200, { object: { sha: b.sha } });
  }
  if (method === 'PATCH' && /\\/pulls\\/\\d+$/.test(path)) return scenario.closeStatus ? reply(scenario.closeStatus, { message: 'close refused by the fake' }) : reply(200, {});
  if (method === 'POST' && /\\/issues\\/\\d+\\/comments$/.test(path)) return scenario.commentStatus ? reply(scenario.commentStatus, { message: 'comment refused by the fake' }) : reply(201, {});
  if (path.includes('/git/ref/heads/main')) {
    const seq = scenario.mainSequence;
    let sha = seq ? seq[Math.min(globalThis.__mainReads = (globalThis.__mainReads ?? 0) + 1, seq.length) - 1] : scenario.main;
    if (globalThis.__mainAfterPatch) sha = scenario.mainAfterOverride ?? globalThis.__mainAfterPatch;
    else if (globalThis.__patchSeen && scenario.mainAfterFailedPatch) sha = scenario.mainAfterFailedPatch;
    if (globalThis.__patchSeen && scenario.mainReadFails) return reply(500, { message: 'cannot read main' });
    return reply(200, { object: { sha } });
  }
  if (path.includes('/commits?sha=main')) return reply(200, scenario.history);
  // check runs: scenario.checkRunsSeq (one list per read, the last repeats) lets a test change CI between the reads
  if (/\\/commits\\/[0-9a-f]{40}\\/check-runs/.test(path)) {
    const seq = scenario.checkRunsSeq;
    const rows = seq ? seq[Math.min(globalThis.__ciReads = (globalThis.__ciReads ?? 0) + 1, seq.length) - 1] : scenario.checkRuns;
    return reply(200, { total_count: scenario.omitTotalCount ? undefined : rows.length, check_runs: rows });
  }
  if (/\\/commits\\/[0-9a-f]{40}\\/status/.test(path)) return reply(200, { total_count: scenario.totalCountOverride ?? scenario.statuses.length, statuses: scenario.statuses });
  // the read-back of the commit the lander created: it echoes what the lander POSTed unless the scenario supplies a tampered answer
  if (method === 'GET' && path.endsWith('/commits/' + scenario.createdSha)) {
    const c = globalThis.__created;
    return reply(200, scenario.readBack ?? { sha: scenario.createdSha, parents: c.parents.map((sha) => ({ sha })), commit: { tree: { sha: c.tree }, message: scenario.githubStripsNewline ? c.message.replace(/\\n$/, '') : c.message, author: c.author, committer: c.committer } });
  }
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
function runLand(over: { scenario?: Record<string, unknown>; text?: string; signature?: string; head?: string; pr?: string; dryRun?: string; ciWaitMs?: string; ref?: string; sha?: string; required?: string; token?: string; requestTimeoutMs?: string } = {}) {
  counter += 1;
  const requiredFile = join(landDir, 'required-checks.txt');
  if (over.required !== undefined) writeFileSync(requiredFile, over.required);
  const scenarioFile = join(work, `scenario-${counter}.json`);
  const callsFile = join(work, `calls-${counter}.log`);
  writeFileSync(callsFile, '');
  writeFileSync(scenarioFile, JSON.stringify({
    main: B, createdSha: '8'.repeat(40), pr: goodPr(), commit: goodCommit(), files: ['.github/julius-missions/x/contract.json'],
    checkRuns: [{ name: 'Verify Relay', status: 'completed', conclusion: 'success' }, { name: 'Land a cleared pull request', status: 'in_progress', conclusion: null }], statuses: [{ context: 'v', state: 'success' }],
    issueComments: [], inlineComments: [], reviews: [], history: [{ commit: { message: 'an earlier landing' } }], ...(over.scenario ?? {}),
  }));
  const text = over.text ?? clearanceText();
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(landDir, 'land.mjs')], {
    encoding: 'utf8', timeout: 25_000,
    env: {
      PATH: process.env.PATH ?? '', FAKE_SCENARIO: scenarioFile, FAKE_CALLS: callsFile, GH_TOKEN: over.token ?? 'not-a-token', ...(over.requestTimeoutMs ? { LAND_REQUEST_TIMEOUT_MS: over.requestTimeoutMs } : {}), PR: over.pr ?? '7', HEAD: over.head ?? H,
      CLEARANCE_B64: Buffer.from(text, 'utf8').toString('base64'), SIGNATURE_B64: over.signature ?? sig(text), DRY_RUN: over.dryRun ?? 'false', LAND_CI_WAIT_MS: over.ciWaitMs ?? '0', GITHUB_REF: over.ref ?? 'refs/heads/main', GITHUB_SHA: over.sha ?? B,
    },
  });
  if (over.required !== undefined) writeFileSync(requiredFile, '# test list\nVerify Relay\n');
  const calls = readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { method: string; path: string; body: string | null });
  // `merges` = every request that moves main (a ref update); `writes` = every request that is not a GET.
  return { code: r.status, out: `${r.stdout}${r.stderr}`, merges: calls.filter((c) => c.method === 'PATCH' && /\/git\/refs\/heads\/main$/.test(c.path)), writes: calls.filter((c) => c.method !== 'GET'), calls };
}

describe('land.mjs end to end against a fake GitHub', () => {
  it('lands exactly once: creates the cleared tree on the cleared base, advances main with a non-forced ref update, then closes the PR', () => {
    const r = runLand();
    expect(r.out).toContain('LANDED PR #7');
    expect(r.code).toBe(0);
    expect(r.merges).toHaveLength(1);
    const body = JSON.parse(r.merges[0]!.body ?? '{}') as Record<string, unknown>;
    expect(body).toEqual({ sha: '8'.repeat(40), force: false });
    expect(r.calls.some((c) => c.method === 'PUT'), 'the merge endpoint is never used').toBe(false);
  });

  it('a signed governed exception lets exactly that file change', () => {
    const text = clearanceText({ 'governed-exceptions': 'scripts/julius-live-contract-check.mjs' });
    const r = runLand({ text, signature: sig(text), scenario: { files: ['.github/julius-missions/x/contract.json', 'scripts/julius-live-contract-check.mjs'], pr: { ...goodPr(), changed_files: 2 } } });
    expect(r.out).toContain('LANDED PR #7');
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

  it('CLOCK PIN: on the fixture clock a clearance that expired one second before NOW is refused as expired, and one that expires a minute after NOW lands', () => {
    const expired = runLand({ text: clearanceText({ issued: '2026-10-19T04:00:00Z', expires: '2026-10-19T04:59:59Z' }) });
    expect(expired.code, expired.out).toBe(1);
    expect(expired.out).toContain('the clearance has expired');
    expect(expired.merges).toHaveLength(0);
    const live = runLand({ text: clearanceText({ issued: '2026-10-19T04:59:00Z', expires: '2026-10-19T05:01:00Z' }) });
    expect(live.code, live.out).toBe(0);
    expect(live.out).toContain('LANDED PR #7');
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
  }, 30_000);

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
      ['check runs sent without total_count', runLand({ scenario: { omitTotalCount: true } })],
      ['statuses whose total_count differs from the rows', runLand({ scenario: { totalCountOverride: 5 } })],
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
  }, 30_000);

  it('a ref-update error fails the job unlanded, and a main that is not the created commit afterwards raises an alert (exit 2)', () => {
    const rejected = runLand({ scenario: { patchStatus: 405 } });
    expect(rejected.code).not.toBe(0);
    expect(rejected.merges).toHaveLength(1);
    const wrong = runLand({ scenario: { mainAfterOverride: 'f'.repeat(40) } });
    expect(wrong.code).toBe(2);
    expect(wrong.out).toContain('ALERT AFTER LANDING');
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
    // round 3: each entry also names the GitHub App (15368 = GitHub Actions) that must have produced the check run
    const parsed = lib.parseRequiredChecks(req.map((l) => l.trim())) as Array<{ name: string; appId?: number }>;
    expect(parsed.map((p) => p.name)).toEqual(['Verify Relay', 'real-infra-julius', 'learning-store-container', 'sibling-control-plane', 'first-live-topology (executor-private)', 'first-live-topology (host-visible)']);
    expect(parsed.map((p) => p.appId)).toEqual([15368, 15368, 15368, 15368, 15368, 15368]);
  });

  it('the allowlist names only the authorized workstream branches and the committed key is a PEM public key or the shipped placeholder', () => {
    const list = readFileSync(join(LANDING, 'allowed-branches.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    for (const b of list) expect(b).toMatch(/^relay\/julius-[a-z0-9-]+$/u);
    expect(readFileSync(join(LANDING, 'reviewer-ed25519.pub'), 'utf8')).toContain('BEGIN PUBLIC KEY');
    expect(readFileSync(join(LANDING, 'reviewer-ed25519.pub'), 'utf8')).not.toMatch(/PRIVATE KEY/u);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ v3: L1 format, L2 final CI read, L3 no merge endpoint, L4 digest bodies */

const goodSignature = (text = clearanceText()) => sig(text);
const buildMessage = (text = clearanceText()) => lib.buildLandingCommitMessage({ clearanceText: text, signatureB64: goodSignature(text) }) as string;
const IDENTITY = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };

describe('L1: the landing commit message carries the signed clearance in a fixed, parseable block', () => {
  it('round-trips: the parser returns the exact clearance text, signature and nonce, and every field comes from the signed clearance', () => {
    const text = clearanceText();
    const msg = buildMessage(text);
    expect(msg.endsWith('\n') && !msg.endsWith('\n\n')).toBe(true);
    expect(msg.split('\n').slice(-7)).toEqual(['-----BEGIN JULIUS LANDING-----', 'v: 1', 'clearance-nonce: 0123456789abcdef0123456789abcdef', `clearance-b64: ${Buffer.from(text).toString('base64')}`, `signature-b64: ${goodSignature(text)}`, '-----END JULIUS LANDING-----', '']);
    const parsed = lib.parseLandingCommitMessage(msg, { expected: { pr: 7, head: H, tree: T, base: B }, publicKeyPem: publicPem });
    expect(parsed.problems).toEqual([]);
    expect(parsed.fields.clearanceText).toBe(text);
    expect(parsed.fields.signatureB64).toBe(goodSignature(text));
    expect(parsed.fields.nonce).toBe('0123456789abcdef0123456789abcdef');
    expect(parsed.fields.clearance).toMatchObject({ pr: '7', head: H, tree: T, base: B });
    expect(parsed.fields.freeText.split('\n')[0]).toBe(lib.squashTitle(7, H));
    expect(lib.nonceUsed([msg], '0123456789abcdef0123456789abcdef'), 'the replay guard reads the block').toBe(true);
  });

  it('the parser refuses a message whose signed clearance is for another tree, head, base or PR number, and a signature that does not verify', () => {
    const msg = buildMessage();
    for (const [name, expected] of [['tree', { tree: 'd'.repeat(40) }], ['head', { head: 'd'.repeat(40) }], ['base', { base: 'd'.repeat(40) }], ['pr', { pr: 8 }]] as const) {
      expect(lib.parseLandingCommitMessage(msg, { expected }).problems.join(' '), name).toContain(`the signed clearance ${name}`);
    }
    // another PR's clearance swapped in: its own signature is fine but the PR/head/tree/base no longer match the commit
    const other = clearanceText({ pr: '8', head: 'e'.repeat(40) });
    expect(lib.parseLandingCommitMessage(buildMessage(other), { expected: { pr: 7, head: H }, publicKeyPem: publicPem }).problems.length).toBeGreaterThan(0);
    // a tampered clearance with the old signature
    const tampered = msg.replace(/clearance-b64: \S+/u, `clearance-b64: ${Buffer.from(clearanceText({ tree: 'd'.repeat(40) })).toString('base64')}`);
    expect(lib.parseLandingCommitMessage(tampered, { publicKeyPem: publicPem }).problems.join(' ')).toContain('does not verify');
    expect(lib.parseLandingCommitMessage(msg, { publicKeyPem: otherKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }).problems.join(' ')).toContain('does not verify');
    expect(lib.parseLandingCommitMessage(msg.replace(/nonce: 0123/u, 'nonce: 1123')).problems.join(' ')).toContain('differs from the signed clearance nonce');
  });

  it('the parser is strict: marker count, position, extra/missing/duplicate keys, trailing text, non-canonical base64, multi-line values, CR', () => {
    const msg = buildMessage();
    const lines = msg.split('\n');
    const bad: Array<[string, string]> = [
      ['a second BEGIN', msg.replace('Landed PR', '-----BEGIN JULIUS LANDING-----\nLanded PR')],
      ['a second END', `${msg}-----END JULIUS LANDING-----\n`],
      ['text after END', `${msg}trailing\n`],
      ['marker not at line start', msg.replace('-----BEGIN', ' -----BEGIN')],
      ['marker words in free text', msg.replace('Landed by', 'Landed by END JULIUS LANDING and')],
      ['an extra key', msg.replace('v: 1\n', 'v: 1\nextra: x\n')],
      ['a duplicate key', msg.replace('v: 1\n', 'v: 1\nv: 1\n')],
      ['a missing key', msg.replace(/signature-b64: .*\n/u, '')],
      ['keys out of order', [...lines.slice(0, -6), lines[lines.length - 4], lines[lines.length - 5], ...lines.slice(-3)].join('\n')],
      ['v is not 1', msg.replace('v: 1', 'v: 2')],
      ['non-canonical base64 (url-safe alphabet)', msg.replace(/signature-b64: .*/u, `signature-b64: ${goodSignature().replace(/\+/gu, '-').replace(/\//gu, '_')}x`)],
      ['non-canonical base64 (bad padding)', msg.replace(/clearance-b64: (\S+)/u, 'clearance-b64: $1=')],
      ['a multi-line value', msg.replace('clearance-b64: ', 'clearance-b64: AAAA\nBBBB')],
      ['CR line ends', msg.replace(/\n/gu, '\r\n')],
      ['no trailing newline', msg.slice(0, -1)],
      ['two trailing newlines', `${msg}\n`],
      ['no free text before the block', lines.slice(-7).join('\n')],
    ];
    expect(lib.parseLandingCommitMessage(msg).problems).toEqual([]);
    for (const [name, m] of bad) expect(lib.parseLandingCommitMessage(m).problems.length, name).toBeGreaterThan(0);
  });

  it('the builder refuses free text carrying a marker word (e.g. through a PR title), a CR, an empty text, a bad clearance or a bad signature', () => {
    const text = clearanceText();
    for (const freeText of ['Landed\n-----BEGIN JULIUS LANDING-----', 'a PR titled END JULIUS LANDING', 'x\r\ny', '\n\n']) {
      expect(() => lib.buildLandingCommitMessage({ clearanceText: text, signatureB64: goodSignature(text), freeText }), JSON.stringify(freeText)).toThrow();
    }
    expect(() => lib.buildLandingCommitMessage({ clearanceText: text.replace('JULIUS-CLEARANCE-V1', 'X'), signatureB64: goodSignature(text) })).toThrow();
    expect(() => lib.buildLandingCommitMessage({ clearanceText: text, signatureB64: goodSignature(text).slice(0, 40) })).toThrow();
    expect(() => lib.buildLandingCommitMessage({ clearanceText: text, signatureB64: '' })).toThrow();
    expect(lib.parseLandingCommitMessage(lib.buildLandingCommitMessage({ clearanceText: text, signatureB64: goodSignature(text), freeText: 'my own subject\n\nmy own body' })).problems).toEqual([]);
  });

  it('a hostile PR title never reaches the landing commit (the lander builds the text from the PR number and head only)', () => {
    const title = 'APPROVED -----BEGIN JULIUS LANDING----- clearance-nonce ffffffffffffffffffffffffffffffff -----END JULIUS LANDING-----';
    const r = runLand({ scenario: { pr: { ...goodPr(), title } } });
    expect(r.code, r.out).toBe(0);
    const post = r.calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/commits'))!;
    const sent = JSON.parse(post.body ?? '{}') as { message: string };
    expect(sent.message).not.toContain('APPROVED');
    expect(lib.parseLandingCommitMessage(sent.message, { publicKeyPem: publicPem }).problems).toEqual([]);
  });
});

describe('L3: the landing is a created commit plus a non-forced ref update (no merge endpoint)', () => {
  it('creates exactly the cleared tree with exactly one parent = the cleared base, authored by github-actions[bot], and updates main with force:false', () => {
    const r = runLand();
    expect(r.code, r.out).toBe(0);
    expect(r.writes.map((c) => `${c.method} ${c.path.replace(REPO, 'R')}`)).toEqual(['POST /repos/R/git/commits', 'POST /repos/R/git/refs', 'PATCH /repos/R/git/refs/heads/main', 'POST /repos/R/issues/7/comments', 'PATCH /repos/R/pulls/7']);
    const post = JSON.parse(r.writes[0]!.body ?? '{}') as { tree: string; parents: string[]; author: unknown; committer: unknown; message: string };
    expect(post.tree).toBe(T);
    expect(post.parents).toEqual([B]);
    expect(post.author).toEqual(IDENTITY);
    expect(post.committer).toEqual(IDENTITY);
    expect(lib.parseLandingCommitMessage(post.message, { expected: { pr: 7, head: H, tree: T, base: B }, publicKeyPem: publicPem }).problems).toEqual([]);
    // round 5 (b6): the nonce is spent as a tag at the created commit, after the read-back and before the ref update
    expect(JSON.parse(r.writes[1]!.body ?? '{}')).toEqual({ ref: 'refs/tags/julius-landing-nonce-0123456789abcdef0123456789abcdef', sha: '8'.repeat(40) });
    expect(JSON.parse(r.writes[2]!.body ?? '{}')).toEqual({ sha: '8'.repeat(40), force: false });
    const comment = JSON.parse(r.writes[3]!.body ?? '{}') as { body: string };
    expect(comment.body).toContain('8'.repeat(40));
    expect(JSON.parse(r.writes[4]!.body ?? '{}')).toEqual({ state: 'closed' });
    // the read-back happened before the ref update
    const idx = (pred: (c: { method: string; path: string }) => boolean) => r.calls.findIndex(pred);
    expect(idx((c) => c.method === 'GET' && c.path.endsWith(`/commits/${'8'.repeat(40)}`))).toBeGreaterThan(idx((c) => c.method === 'POST' && c.path.endsWith('/git/commits')));
    expect(idx((c) => c.method === 'GET' && c.path.endsWith(`/commits/${'8'.repeat(40)}`))).toBeLessThan(idx((c) => c.method === 'PATCH' && c.path.endsWith('/git/refs/heads/main')));
  });

  it('main moves between the tip read and the ref update: GitHub refuses the non-forced update, the lander refuses and reports, and writes nothing else', () => {
    const r = runLand({ scenario: { mainAtPatch: 'f'.repeat(40) } });
    expect(r.code).toBe(1);
    expect(r.out).toContain('the ref update was refused');
    expect(r.out).toContain('Nothing was landed');
    expect(r.writes.map((c) => c.method)).toEqual(['POST', 'POST', 'PATCH']);
    expect(r.merges).toHaveLength(1);
    expect(JSON.parse(r.merges[0]!.body ?? '{}').force).toBe(false);
  });

  it('a ref update refused with 422 or 409 is reported, never retried and never forced', () => {
    for (const patchStatus of [422, 409]) {
      const r = runLand({ scenario: { patchStatus } });
      expect(r.code, String(patchStatus)).toBe(1);
      expect(r.out).toContain(`${patchStatus}`);
      expect(r.merges, 'exactly one attempt').toHaveLength(1);
      for (const m of r.merges) expect(JSON.parse(m.body ?? '{}').force).toBe(false);
      expect(r.writes.some((c) => c.path.includes('/issues/') || /\/pulls\/\d+$/.test(c.path)), 'no comment, no close').toBe(false);
    }
  });

  it('a commit that cannot be created, or that reads back with another tree, parent, message or identity, is never put on main', () => {
    const c = (over: Record<string, unknown>, parents = [{ sha: B }]) => ({ sha: '8'.repeat(40), parents, commit: { tree: { sha: T }, message: 'x', author: IDENTITY, committer: IDENTITY, ...over } });
    const cases: Array<[string, Record<string, unknown>]> = [
      ['the create call fails', { postStatus: 500 }],
      ['another tree', { readBack: c({ tree: { sha: 'f'.repeat(40) } }) }],
      ['another parent', { readBack: c({}, [{ sha: 'f'.repeat(40) }]) }],
      ['two parents', { readBack: c({}, [{ sha: B }, { sha: H }]) }],
      ['no parent', { readBack: c({}, []) }],
      ['another message', { readBack: c({ message: 'something else' }) }],
      ['another committer', { readBack: c({ committer: { name: 'julius-worker[bot]', email: 'x@y.z' } }) }],
      ['another sha', { readBack: { ...c({}), sha: 'f'.repeat(40) } }],
    ];
    for (const [name, scenario] of cases) {
      const r = runLand({ scenario });
      expect(r.code, `${name}: ${r.out}`).toBe(1);
      expect(r.merges, name).toHaveLength(0);
      expect(r.writes.map((w) => w.method), name).toEqual(['POST']);
    }
  });

  it('a PR that is closed after landing but cannot be closed is reported (exit 3) and the output names the landed commit', () => {
    const r = runLand({ scenario: { closeStatus: 500 } });
    expect(r.code).toBe(3);
    expect(r.out).toContain('LANDED PR #7');
    expect(r.out).toContain('closing PR #7 failed');
  });

  it('a replayed clearance for a different PR number is refused at the lander (dispatch inputs, and the live PR number)', () => {
    const r8 = clearanceText({ pr: '8' });
    const dispatchedAs7 = runLand({ text: r8, signature: sig(r8) });
    expect(dispatchedAs7.code).toBe(1);
    expect(dispatchedAs7.out).toContain('differ from the signed clearance');
    const dispatchedAs8 = runLand({ text: r8, signature: sig(r8), pr: '8' });
    expect(dispatchedAs8.code, 'pr 8 dispatched, but the PR object read is #7').toBe(1);
    expect(dispatchedAs8.out).toContain('the clearance is for PR 8, not 7');
    expect(dispatchedAs8.writes).toHaveLength(0);
  });
});

describe('dry run writes nothing at all', () => {
  it('performs the reads and the checks, computes the commit body, prints what it would do, and sends ZERO POST/PATCH/PUT/DELETE', () => {
    for (const dryRun of ['true', '', 'False', 'no']) {
      const r = runLand({ dryRun });
      expect(r.code, dryRun).toBe(0);
      expect(r.writes, `DRY_RUN=${JSON.stringify(dryRun)}`).toEqual([]);
      expect(r.calls.some((c) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.method))).toBe(false);
      expect(r.calls.filter((c) => c.path.includes('/check-runs')).length, 'the CI state was read').toBeGreaterThanOrEqual(2);
      expect(r.out).toContain('POST /repos/ohdieyuh-glitch/sunday-relay/git/commits');
      expect(r.out).toContain('"force":false');
      expect(r.out).toContain('-----BEGIN JULIUS LANDING-----');
    }
  });
});

describe('L2: the final decision is taken from a final read that includes the CI state', () => {
  const VR = (status: string, conclusion: string | null) => ({ name: 'Verify Relay', status, conclusion });
  const SELF_RUN = { name: 'Land a cleared pull request', status: 'in_progress', conclusion: null };

  it('a check that fails, re-runs, or is newly added after the CI wait is seen by the final read and refuses', () => {
    const green = [VR('completed', 'success'), SELF_RUN];
    const cases: Array<[string, unknown[][]]> = [
      ['the required check was re-run and failed', [green, [VR('completed', 'failure'), SELF_RUN]]],
      ['the required check was re-run and is pending again', [green, [VR('in_progress', null), SELF_RUN]]],
      ['a new failing check appeared', [green, [...green, { name: 'extra-scan', status: 'completed', conclusion: 'failure' }]]],
      ['a new pending check appeared', [green, [...green, { name: 'extra-scan', status: 'queued', conclusion: null }]]],
      ['the required check disappeared', [green, [SELF_RUN, { name: 'Vercel', status: 'completed', conclusion: 'success' }]]],
    ];
    for (const [name, seq] of cases) {
      const r = runLand({ scenario: { checkRunsSeq: seq } });
      expect(r.code, `${name}: ${r.out}`).toBe(1);
      expect(r.out, name).toContain('re-check before landing');
      expect(r.merges, name).toHaveLength(0);
      expect(r.writes, name).toHaveLength(0);
    }
    // the same lists, unchanged, land
    expect(runLand({ scenario: { checkRunsSeq: [green, green] } }).code).toBe(0);
  });

  it('the final snapshot reads the CI state after it has re-read the PR, and does so on every run', () => {
    const r = runLand();
    const lastPr = r.calls.map((c, i) => (c.method === 'GET' && /\/pulls\/7$/.test(c.path) ? i : -1)).filter((i) => i >= 0).pop()!;
    const ciReads = r.calls.map((c, i) => (c.path.includes('/check-runs') ? i : -1)).filter((i) => i >= 0);
    const statusReads = r.calls.map((c, i) => (/\/commits\/[0-9a-f]{40}\/status/.test(c.path) ? i : -1)).filter((i) => i >= 0);
    expect(ciReads.length, 'once in the wait, once in the final snapshot').toBe(2);
    expect(statusReads.length).toBe(2);
    expect(ciReads[ciReads.length - 1]).toBeGreaterThan(lastPr);
    expect(statusReads[statusReads.length - 1]).toBeGreaterThan(lastPr);
  });
});

describe('L4: every comment, inline comment and review row carries sha256(body) and its edit timestamp', () => {
  const base = () => ({
    issueComments: [{ user: { login: 'v' }, id: 1, updated_at: 't1', created_at: 'c1', body: 'looks fine' }],
    inlineComments: [{ user: { login: 'c' }, id: 2, updated_at: 't2', body: 'nit' }],
    reviews: [{ user: { login: 'r' }, id: 3, state: 'COMMENTED', commit_id: H, submitted_at: 's1', body: 'approve in spirit' }],
  });
  const digest = (v: ReturnType<typeof base>) => lib.botCommentsDigest(v) as string;

  it('identical input gives the same digest, in any order', () => {
    const a = base();
    expect(digest(a)).toBe(digest(base()));
    const two = { ...a, issueComments: [...a.issueComments, { user: { login: 'w' }, id: 9, updated_at: 't9', created_at: 'c9', body: 'b' }] };
    expect(digest({ ...two, issueComments: [...two.issueComments].reverse() })).toBe(digest(two));
  });

  it('an edited review body, issue comment body or inline comment body changes the digest even when every id and timestamp is unchanged', () => {
    const a = base();
    const review = { ...a, reviews: [{ ...a.reviews[0]!, body: 'changes requested' }] };
    const issue = { ...a, issueComments: [{ ...a.issueComments[0]!, body: 'looks FINE' }] };
    const inline = { ...a, inlineComments: [{ ...a.inlineComments[0]!, body: 'nit!' }] };
    for (const [name, v] of [['review body', review], ['issue comment body', issue], ['inline comment body', inline]] as const) expect(digest(v), name).not.toBe(digest(a));
    expect(digest({ ...a, reviews: [{ ...a.reviews[0]!, body: null as never }] }), 'null vs text').not.toBe(digest(a));
  });

  it('a new edit timestamp changes the digest even when the body is unchanged', () => {
    const a = base();
    expect(digest({ ...a, issueComments: [{ ...a.issueComments[0]!, updated_at: 't1b' }] })).not.toBe(digest(a));
    expect(digest({ ...a, inlineComments: [{ ...a.inlineComments[0]!, updated_at: 't2b' }] })).not.toBe(digest(a));
    expect(digest({ ...a, reviews: [{ ...a.reviews[0]!, submitted_at: 's2' }] })).not.toBe(digest(a));
    expect(digest({ ...a, reviews: [{ ...a.reviews[0]!, state: 'APPROVED' }] })).not.toBe(digest(a));
  });

  it('end to end: an edited body (same id and timestamp) between the clearance and the landing refuses', () => {
    const signedAgainst = base();
    const text = clearanceText({ 'bot-comments-sha256': digest(signedAgainst) });
    const ok = runLand({ text, signature: sig(text), scenario: signedAgainst });
    expect(ok.code, ok.out).toBe(0);
    const edited = runLand({ text, signature: sig(text), scenario: { ...signedAgainst, reviews: [{ ...signedAgainst.reviews[0]!, body: 'edited after the reviewer looked' }] } });
    expect(edited.code).toBe(1);
    expect(edited.out).toContain('differs from what the reviewer saw');
    expect(edited.writes).toHaveLength(0);
  });
});

describe('the provenance gate and the allowlist are founder-governed', () => {
  it('a PR touching scripts/julius-main-provenance.mjs, its .d.mts or its test is refused, in any letter case, by the pure check and by the lander', () => {
    for (const f of ['scripts/julius-main-provenance.mjs', 'scripts/julius-main-provenance.d.mts', 'scripts/julius-main-provenance.test.ts', 'Scripts/Julius-Main-Provenance.MJS']) {
      expect(check({ files: ['ok.ts', f], fileRows: 2, pr: { ...goodPr(), changed_files: 2 } }).join(' '), f).toContain('founder-governed');
      const r = runLand({ scenario: { files: ['ok.ts', f], pr: { ...goodPr(), changed_files: 2 } } });
      expect(r.code, f).toBe(1);
      expect(r.writes, f).toHaveLength(0);
    }
    // (round 2: the rule is a prefix, so a sibling such as julius-main-provenance-notes.md is governed too; an unrelated neighbour is not)
    expect(check({ files: ['scripts/julius-main-notes.md'] })).toEqual([]);
  });

  it('PIN: the shipped allowlist is EXACTLY this list (any change is a founder-governed update and must change this pin in the same commit; reuse of a landed name goes through retire + supersede, not through an extension)', () => {
    const list = readFileSync(join(LANDING, 'allowed-branches.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(list).toEqual([
      'relay/julius-partial-secret-capture-fix', 'relay/julius-coder-runtime-budget', 'relay/julius-diag-digest-evidence-2', 'relay/julius-report-refused-reason', 'relay/julius-accounting-instruments',
      'relay/julius-maxeffort-gauntlet-1', 'relay/julius-maxeffort-loop-1', 'relay/julius-ask-route',
    ]);
  });

  it('the shipped allowlist refuses the superseded Candidate C branch (evidence-1) and allows evidence-2', () => {
    const list = readFileSync(join(LANDING, 'allowed-branches.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(list).not.toContain('relay/julius-diag-digest-evidence-1');
    expect(list).toContain('relay/julius-diag-digest-evidence-2');
    const onBranch = (ref: string) => check({ allowedBranches: list, pr: { ...goodPr(), head: { ...goodPr().head, ref } } });
    expect(onBranch('relay/julius-diag-digest-evidence-1').join(' ')).toContain('not in the founder');
    expect(onBranch('relay/julius-diag-digest-evidence-2')).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ v3 round 2: prefix rule, ambiguous ref update, review timestamp */

describe('round 2: the provenance gate and review-currency are PREFIX rules', () => {
  it('any path starting with scripts/julius-main-provenance or scripts/julius-review-currency is refused, in any case, signed or not; unrelated neighbours are not', () => {
    const governed = [
      'scripts/julius-main-provenance2.mjs', 'scripts/julius-main-provenance.mjs', 'scripts/julius-main-provenance-v2.test.ts', 'scripts/julius-main-provenance', 'SCRIPTS/Julius-Main-Provenance.Extra.mjs',
      'scripts/julius-review-currency.mjs', 'scripts/julius-review-currency.d.mts', 'scripts/julius-review-currency.test.ts', 'scripts/julius-review-currency2.mjs', 'Scripts/JULIUS-REVIEW-CURRENCY.mjs',
    ];
    for (const f of governed) {
      expect(check({ files: ['ok.ts', f], fileRows: 2, pr: { ...goodPr(), changed_files: 2 } }).join(' '), f).toContain('founder-governed');
      expect(lib.FORBIDDEN_PATH.test(f), f).toBe(true);
    }
    for (const f of ['scripts/julius-main-notes.md', 'scripts/other-julius-review-currency.mjs', 'docs/julius-main-provenance.md']) expect(lib.HARD_FORBIDDEN_PATH.test(f), f).toBe(false);
    for (const f of ['scripts/julius-main-provenance2.mjs', 'scripts/julius-review-currency.mjs']) {
      const r = runLand({ scenario: { files: ['ok.ts', f], pr: { ...goodPr(), changed_files: 2 } } });
      expect(r.code, f).toBe(1);
      expect(r.writes, f).toHaveLength(0);
    }
  });
});

describe('round 2: an ambiguous ref-update outcome is judged by re-reading main, never retried', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['HTTP 500', { status: 500 }],
    ['HTTP 502', { status: 502 }],
    ['HTTP 408', { status: 408 }],
    ['HTTP 429', { status: 429 }],
    ['a network error', { throw: true }],
  ];

  it('main == the created commit: treated as landed (the PATCH response was lost), then the PR is commented and closed', () => {
    for (const [name, lost] of cases) {
      const r = runLand({ scenario: { patchLost: { ...lost, applied: true } } });
      expect(r.code, `${name}: ${r.out}`).toBe(0);
      expect(r.out, name).toContain('LANDED (the PATCH response was lost)');
      expect(r.out, name).toContain('LANDED PR #7');
      expect(r.merges, `${name}: one attempt, no retry`).toHaveLength(1);
      expect(JSON.parse(r.merges[0]!.body ?? '{}').force, name).toBe(false);
      expect(r.writes.map((c) => c.method), name).toEqual(['POST', 'POST', 'PATCH', 'POST', 'PATCH']);
    }
  });

  it('main == the cleared base: ALERT, state in doubt (exit 2), no retry, no comment or close', () => {
    for (const [name, lost] of cases) {
      const r = runLand({ scenario: { patchLost: { ...lost, applied: false } } });
      expect(r.code, `${name}: ${r.out}`).toBe(2);
      expect(r.out, name).toContain('ALERT AFTER AN AMBIGUOUS REF UPDATE');
      expect(r.out, name).toContain('state in doubt');
      expect(r.out, name).toContain('still the cleared base');
      expect(r.out, name).not.toContain('Nothing was landed');
      expect(r.merges, name).toHaveLength(1);
      expect(r.writes.map((c) => c.method), name).toEqual(['POST', 'POST', 'PATCH']);
    }
  });

  it('main is anything else (or cannot be read): ALERT, exit 2, naming the tip, and nothing more is written', () => {
    const other = 'f'.repeat(40);
    for (const [name, lost] of cases) {
      const r = runLand({ scenario: { patchLost: { ...lost, applied: false }, mainAfterFailedPatch: other } });
      expect(r.code, `${name}: ${r.out}`).toBe(2);
      expect(r.out, name).toContain('ALERT AFTER AN AMBIGUOUS REF UPDATE');
      expect(r.out, name).toContain(other);
      expect(r.writes.map((c) => c.method), name).toEqual(['POST', 'POST', 'PATCH']);
    }
    const unreadable = runLand({ scenario: { patchLost: { status: 500, applied: false }, mainReadFails: true } });
    expect(unreadable.code).toBe(2);
    expect(unreadable.out).toContain('could not be read again');
    expect(unreadable.writes.map((c) => c.method)).toEqual(['POST', 'POST', 'PATCH']);
  });

  it('a clean 4xx refusal is NOT re-judged: it refuses at once and main is not even re-read', () => {
    const r = runLand({ scenario: { patchStatus: 422 } });
    expect(r.code).toBe(1);
    const patchAt = r.calls.findIndex((c) => c.method === 'PATCH');
    expect(r.calls.slice(patchAt + 1).filter((c) => c.path.includes('/git/ref/heads/main'))).toHaveLength(0);
  });
});

describe('round 2: the review row carries its own edit timestamp', () => {
  it('a review that differs ONLY in submitted_at (or only in updated_at when there is no submitted_at) changes the digest', () => {
    const review = { user: { login: 'r' }, id: 3, state: 'COMMENTED', commit_id: H, body: 'same body' };
    const digest = (r: Record<string, unknown>) => lib.botCommentsDigest({ issueComments: [], inlineComments: [], reviews: [r] }) as string;
    expect(digest({ ...review, submitted_at: '2026-10-19T01:00:00Z' })).not.toBe(digest({ ...review, submitted_at: '2026-10-19T02:00:00Z' }));
    expect(digest({ ...review, submitted_at: '2026-10-19T01:00:00Z' })).not.toBe(digest(review));
    expect(digest({ ...review, updated_at: 'u1' })).not.toBe(digest({ ...review, updated_at: 'u2' }));
    expect(digest({ ...review, submitted_at: '2026-10-19T01:00:00Z' })).toBe(digest({ ...review, submitted_at: '2026-10-19T01:00:00Z' }));
  });
});

describe('round 2: the phrase JULIUS LANDING (uppercase) appears exactly twice in a message, in the two marker lines', () => {
  const text = clearanceText();
  const build = (freeText: string) => lib.buildLandingCommitMessage({ clearanceText: text, signatureB64: goodSignature(text), freeText }) as string;

  it('the builder refuses any free text containing JULIUS LANDING anywhere; lower and mixed case stay allowed', () => {
    for (const bad of ['about JULIUS LANDING', 'x BEGIN JULIUS LANDING', 'x END JULIUS LANDING', 'JULIUS LANDING', 'subject\n\nbody mentions JULIUS LANDING in passing', 'JULIUS LANDINGS']) {
      expect(() => build(bad), JSON.stringify(bad)).toThrow();
    }
    for (const ok of ['julius landing', 'Julius landing', 'Julius Landing', 'about julius landing\n\nand the Julius landing workflow']) {
      const msg = build(ok);
      expect(lib.parseLandingCommitMessage(msg, { publicKeyPem: publicPem }).problems, ok).toEqual([]);
      expect(msg.split('JULIUS LANDING').length - 1, ok).toBe(2);
    }
    expect(buildMessage().split('JULIUS LANDING').length - 1, 'the default text').toBe(2);
  });

  it('the parser rejects a message with any extra mention of the phrase, wherever it is', () => {
    const msg = buildMessage();
    expect(lib.parseLandingCommitMessage(msg).problems).toEqual([]);
    const withExtra: Array<[string, string]> = [
      ['in the free text', msg.replace('Landed by', 'about JULIUS LANDING and landed by')],
      ['as BEGIN in the free text', msg.replace('Landed by', 'x BEGIN JULIUS LANDING y landed by')],
      ['a third marker-like line', msg.replace('v: 1\n', 'v: 1\nJULIUS LANDING\n')],
      ['in the subject', `JULIUS LANDING ${msg}`],
    ];
    for (const [name, m] of withExtra) expect(lib.parseLandingCommitMessage(m).problems.length, name).toBeGreaterThan(0);
  });

  it('a PR title containing JULIUS LANDING never reaches the landing message', () => {
    const r = runLand({ scenario: { pr: { ...goodPr(), title: 'about JULIUS LANDING' } } });
    expect(r.code, r.out).toBe(0);
    const sent = JSON.parse(r.calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/commits'))!.body ?? '{}') as { message: string };
    expect(sent.message).not.toContain('about');
    expect(sent.message.split('JULIUS LANDING').length - 1).toBe(2);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ v3 round 3: post-landing errors, more governed prefixes, check-run app id, no stack traces */

describe('round 3 R1: nothing after the ref update may exit 1 or die with a stack trace', () => {
  it('a failed read of main after the update is an ALERT (exit 2) naming the created commit, and the comment and the close are still attempted', () => {
    const r = runLand({ scenario: { mainReadFails: true } });
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain(`ALERT AFTER LANDING: main was updated to ${'8'.repeat(40)} but reading main back failed`);
    expect(r.writes.map((c) => c.method), 'commit, nonce tag, ref update, comment, close').toEqual(['POST', 'POST', 'PATCH', 'POST', 'PATCH']);
    expect(r.out).not.toMatch(/\n\s+at /u);
    expect(r.out).not.toContain('Nothing was landed');
  });

  it('a failing comment and a failing close each keep exit 3, each is attempted on its own, and an ALERT outranks them', () => {
    const comment = runLand({ scenario: { commentStatus: 500 } });
    expect(comment.code, comment.out).toBe(3);
    expect(comment.out).toContain('commenting on PR #7 failed');
    expect(comment.writes.map((c) => c.method), 'the close is still attempted after a failed comment').toEqual(['POST', 'POST', 'PATCH', 'POST', 'PATCH']);
    const close = runLand({ scenario: { closeStatus: 500 } });
    expect(close.code, close.out).toBe(3);
    expect(close.out).toContain('closing PR #7 failed');
    const both = runLand({ scenario: { commentStatus: 500, closeStatus: 500 } });
    expect(both.code).toBe(3);
    expect(both.out).toContain('commenting on PR #7 failed');
    expect(both.out).toContain('closing PR #7 failed');
    const alertAndComment = runLand({ scenario: { mainReadFails: true, commentStatus: 500 } });
    expect(alertAndComment.code, 'an ALERT is not downgraded to 3').toBe(2);
  });

  it('a main that is not the created commit after the update is still an ALERT (exit 2) and nothing is claimed in a PR comment', () => {
    const r = runLand({ scenario: { mainAfterOverride: 'f'.repeat(40) } });
    expect(r.code).toBe(2);
    expect(r.writes.map((c) => c.method)).toEqual(['POST', 'POST', 'PATCH']);
  });
});

describe('round 3 H3: an unexpected error before the ref update is one line and exit 1, never a stack trace', () => {
  it('a failing read (pull request, CI, main, the created commit) or a failing commit creation ends with a single REFUSED line', () => {
    const cases: Array<[string, Record<string, unknown>, string[]]> = [
      ['the PR read fails', { failGet: '/pulls/7$' }, []],
      ['the files read fails', { failGet: '/pulls/7/files' }, []],
      ['the CI read fails', { failGet: '/check-runs' }, []],
      ['the main read fails', { failGet: '/git/ref/heads/main' }, []],
      ['the history read fails', { failGet: '/commits\\?sha=main' }, []],
      ['the commit creation fails', { postStatus: 500 }, ['POST']],
      ['the read-back of the created commit fails', { failGet: `/commits/${'8'.repeat(40)}$` }, ['POST']],
    ];
    for (const [name, scenario, writes] of cases) {
      const r = runLand({ scenario });
      expect(r.code, `${name}: ${r.out}`).toBe(1);
      expect(r.out, name).toContain('REFUSED: unexpected error before anything was landed');
      expect(r.out, name).toContain('Nothing was landed');
      expect(r.out, name).not.toMatch(/\n\s+at /u);
      expect(r.out, name).not.toContain('node:internal');
      expect(r.out.trim().split('\n').filter((l) => l.startsWith('REFUSED')), name).toHaveLength(1);
      expect(r.writes.map((c) => c.method), name).toEqual(writes);
      expect(r.merges, name).toHaveLength(0);
    }
    const dry = runLand({ dryRun: 'true', scenario: { failGet: '/pulls/7$' } });
    expect(dry.code).toBe(1);
    expect(dry.out).not.toMatch(/\n\s+at /u);
  });
});

describe('round 3 H2: a required check is matched by app id as well as name, and only success is green', () => {
  const run = (name: string, conclusion: string | null, appId?: number) => ({ name, status: conclusion ? 'completed' : 'in_progress', conclusion, ...(appId === undefined ? {} : { app: { id: appId } }) });
  const self = 'Land a cleared pull request';
  const ci = (checkRuns: unknown[], required: unknown[]) => lib.checkCi({ checkRuns, statuses: [], self, required }) as string[];
  const req = [{ name: 'Verify Relay', appId: 15368 }];

  it('the entry parser: `Name @id` keeps the name and the id; anything else stays a plain name', () => {
    expect(lib.parseRequiredChecks(['Verify Relay @15368', 'first-live-topology (host-visible) @15368', 'plain name'])).toEqual([
      { name: 'Verify Relay', appId: 15368 }, { name: 'first-live-topology (host-visible)', appId: 15368 }, { name: 'plain name', appId: undefined },
    ]);
    for (const odd of ['x @abc', 'x@15368', 'x @']) expect(lib.parseRequiredChecks([odd])[0]).toEqual({ name: odd, appId: undefined });
  });

  it('the right app passes; another app under the same name, a missing app, or a second look-alike run are refused', () => {
    expect(ci([run('Verify Relay', 'success', 15368)], req)).toEqual([]);
    expect(ci([run('Verify Relay', 'success', 99)], req).join(' ')).toContain('not the required app 15368');
    expect(ci([run('Verify Relay', 'success')], req).join(' ')).toContain('unknown');
    expect(ci([run('Verify Relay', 'success', 15368), run('Verify Relay', 'success', 99)], req).join(' ')).toContain('2 times');
    expect(ci([run('Verify Relay', 'success', 99)], ['Verify Relay']), 'a name-only entry still matches by name').toEqual([]);
  });

  it('neutral is NOT green, for a required and for any other check', () => {
    expect(ci([run('Verify Relay', 'neutral', 15368)], req).join(' ')).toContain('concluded neutral');
    expect(ci([run('Verify Relay', 'success', 15368), run('lint', 'neutral')], req).join(' ')).toContain('"lint" concluded neutral');
    expect(ci([run('Verify Relay', 'success', 15368), run('lint', 'success')], req)).toEqual([]);
  });

  it('end to end: the lander reads the app id from required-checks.txt and refuses a look-alike check', () => {
    const required = '# test\nVerify Relay @15368\n';
    const selfRun = { name: 'Land a cleared pull request', status: 'in_progress', conclusion: null };
    const good = runLand({ required, scenario: { checkRuns: [{ name: 'Verify Relay', status: 'completed', conclusion: 'success', app: { id: 15368 } }, selfRun] } });
    expect(good.code, good.out).toBe(0);
    for (const [name, rows] of [
      ['another app', [{ name: 'Verify Relay', status: 'completed', conclusion: 'success', app: { id: 7 } }, selfRun]],
      ['no app', [{ name: 'Verify Relay', status: 'completed', conclusion: 'success' }, selfRun]],
      ['neutral', [{ name: 'Verify Relay', status: 'completed', conclusion: 'neutral', app: { id: 15368 } }, selfRun]],
    ] as const) {
      const r = runLand({ required, scenario: { checkRuns: rows } });
      expect(r.code, `${name}: ${r.out}`).toBe(1);
      expect(r.writes, name).toHaveLength(0);
    }
  });
});

describe('round 3 R2: the gate and secret-handling scripts workflows run are governed by prefix', () => {
  const governed: Array<[string, string[]]> = [
    ['scripts/julius-main-monotonicity', ['scripts/julius-main-monotonicity.mjs', 'scripts/julius-main-monotonicity.d.mts', 'scripts/julius-main-monotonicity.test.ts', 'scripts/julius-main-monotonicity2.mjs']],
    ['scripts/julius-paid-slot', ['scripts/julius-paid-slot.mjs', 'scripts/julius-paid-slot.d.mts', 'scripts/julius-paid-slot.test.ts']],
    ['scripts/julius-subscription-check', ['scripts/julius-subscription-check.mjs', 'scripts/julius-subscription-check.d.mts', 'scripts/julius-subscription-check.test.ts']],
    ['scripts/julius-live-preflight-gates', ['scripts/julius-live-preflight-gates.mjs', 'scripts/julius-live-preflight-gates.d.mts', 'scripts/julius-live-preflight-gates.test.ts']],
    ['scripts/julius-accept', ['scripts/julius-accept-main.mjs', 'scripts/julius-accept.mjs', 'scripts/julius-acceptance.ts']],
    ['scripts/relay-repository-boundary', ['scripts/relay-repository-boundary.mjs', 'scripts/relay-repository-boundary2.mjs']],
    ['scripts/export-julius-harness', ['scripts/export-julius-harness.mjs', 'scripts/export-julius-harness.test.ts']],
    ['.github/julius-live-', ['.github/julius-live-executor.sh', '.github/julius-live-key-boundary.sh', '.github/julius-live-receipt-boundary.sh', '.github/julius-live-hermes-isolation/sitecustomize.py', '.github/julius-live-new-boundary.sh']],
    ['.github/actions/', ['.github/actions/setup/action.yml', '.github/actions/x/y/z.js']],
    ['.github/julius-mission-slice/', ['.github/julius-mission-slice/loader.mjs', '.github/julius-mission-slice/resolve.mjs', '.github/julius-mission-slice/README.md']],
    ['.github/julius-learning-registrations/', ['.github/julius-learning-registrations/julius-learning-pair-1.json', '.github/julius-learning-registrations/new.json']],
  ];

  it('every file under each prefix is refused by the pure check, in any letter case', () => {
    for (const [prefix, files] of governed) {
      for (const f of files) {
        for (const variant of [f, f.toUpperCase(), f.replace(/^./u, (c) => c.toUpperCase())]) {
          expect(check({ files: ['ok.ts', variant], fileRows: 2, pr: { ...goodPr(), changed_files: 2 } }).join(' '), `${prefix}: ${variant}`).toContain('founder-governed');
        }
      }
    }
  });

  it('end to end: a PR touching any one of them is refused and nothing is written', () => {
    for (const [prefix, files] of governed) {
      const f = files[0]!;
      const r = runLand({ scenario: { files: ['ok.ts', f], pr: { ...goodPr(), changed_files: 2 } } });
      expect(r.code, `${prefix}: ${f}: ${r.out}`).toBe(1);
      expect(r.out).toContain('founder-governed');
      expect(r.writes, `${prefix}: ${f}`).toHaveLength(0);
    }
  });

  it('neighbours that must stay allowed are allowed (relay-bridge, src, the mission directories, the harness manifest, other scripts), and such a PR lands', () => {
    const allowedFiles = [
      'relay-bridge/julius/x.ts', 'src/relay/mission/julius/x.ts', '.github/julius-missions/julius-m/contract.json', 'JULIUS_HARNESS_MANIFEST.md',
      'scripts/julius-live-probe-file.ts', 'scripts/julius-mission-slice.test.ts', 'scripts/julius-evidence-bodies.mjs',
      'scripts/julius-main-notes.md', '.github/workflows-notes.md', '.github/julius-missions/julius-live-m/contract.json', 'docs/actions/readme.md',
    ];
    for (const f of allowedFiles) expect(lib.HARD_FORBIDDEN_PATH.test(f), f).toBe(false);
    expect(check({ files: allowedFiles, fileRows: allowedFiles.length, pr: { ...goodPr(), changed_files: allowedFiles.length } })).toEqual([]);
    const r = runLand({ scenario: { files: allowedFiles.slice(0, 4), pr: { ...goodPr(), changed_files: 4 } } });
    expect(r.code, r.out).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ v3 round 4: the landing system's own tests are governed; one reader of required-checks.txt */

describe('round 4: scripts/julius-landing* (the landing tests) is a governed prefix', () => {
  const landing = ['scripts/julius-landing.test.ts', 'scripts/julius-landing-attack.test.ts', 'scripts/julius-landing-new.test.ts', 'scripts/julius-landing.mjs', 'scripts/julius-landing2.ts'];

  it('every such file is refused by the pure check, in any letter case', () => {
    for (const f of landing) {
      for (const variant of [f, f.toUpperCase(), f.replace(/^./u, (c) => c.toUpperCase()), f.replace('landing', 'Landing')]) {
        expect(check({ files: ['ok.ts', variant], fileRows: 2, pr: { ...goodPr(), changed_files: 2 } }).join(' '), variant).toContain('founder-governed');
      }
    }
  });

  it('end to end: a PR touching any of them is refused and nothing is written', () => {
    for (const f of landing) {
      const r = runLand({ scenario: { files: ['ok.ts', f], pr: { ...goodPr(), changed_files: 2 } } });
      expect(r.code, `${f}: ${r.out}`).toBe(1);
      expect(r.out).toContain('founder-governed');
      expect(r.writes, f).toHaveLength(0);
    }
  });

  it('neighbours stay allowed: other julius-live scripts, other julius- tests', () => {
    const allowedFiles = ['scripts/julius-live-probe-file.ts', 'scripts/julius-evidence-bodies.test.ts', 'scripts/julius-mission-pins.test.ts', 'scripts/julius-drill-support.ts', 'scripts/landing-notes.md', 'docs/scripts/julius-landing.md'];
    for (const f of allowedFiles) expect(lib.HARD_FORBIDDEN_PATH.test(f), f).toBe(false);
    expect(check({ files: allowedFiles, fileRows: allowedFiles.length, pr: { ...goodPr(), changed_files: allowedFiles.length } })).toEqual([]);
    const r = runLand({ scenario: { files: allowedFiles.slice(0, 3), pr: { ...goodPr(), changed_files: 3 } } });
    expect(r.code, r.out).toBe(0);
  });
});

describe('round 4: required-checks.txt has exactly one reader, the lander (via parseRequiredChecks)', () => {
  it('no workflow and no other script or landing file mentions the file; land.mjs parses it only through parseRequiredChecks', () => {
    const listed = (dir: string) => readdirSync(resolve(ROOT, dir)).map((f) => join(dir, f));
    const candidates = [...listed('.github/workflows'), ...listed('scripts').filter((f) => /\.(mjs|ts|sh|js|cjs|mts)$/u.test(f)), ...listed('.github/julius-landing').filter((f) => /\.mjs$/u.test(f))];
    const readers = candidates.filter((f) => readFileSync(resolve(ROOT, f), 'utf8').includes('required-checks')).map((f) => f.replace(/\\/gu, '/')).sort();
    // the lander, the lander's library (documentation comment) and the two landing test files (which pin or rewrite the file)
    const expected = ['.github/julius-landing/land-lib.mjs', '.github/julius-landing/land.mjs', 'scripts/julius-landing-attack.test.ts', 'scripts/julius-landing.test.ts'];
    // scripts/julius-main-provenance-signed.test.ts (the provenance gate's test, not present in every tree) mentions the path as TEST DATA only: a governed-paths list. It is expected
    // when it exists, and then it must not READ the file.
    const dataOnly = 'scripts/julius-main-provenance-signed.test.ts';
    const dataOnlyPresent = existsSync(resolve(ROOT, dataOnly));
    expect(readers).toEqual((dataOnlyPresent ? [...expected, dataOnly] : expected).sort());
    if (dataOnlyPresent) {
      const hits = readFileSync(resolve(ROOT, dataOnly), 'utf8').split('\n').filter((l) => l.includes('required-checks'));
      expect(hits.length, 'it does mention the path').toBeGreaterThan(0);
      for (const line of hits) {
        expect(line, 'only the full governed path as a quoted string').toContain("'.github/julius-landing/required-checks.txt'");
        expect(line, 'a mention, not a read').not.toMatch(/readFile|readdir|createReadStream|ghRaw|fetch\(|parseRequiredChecks|existsSync|spawn|exec/u);
      }
    }
    const land = readFileSync(join(LANDING, 'land.mjs'), 'utf8');
    expect(land).toMatch(/parseRequiredChecks\(readFileSync\(join\(here, 'required-checks\.txt'\)/u);
    expect(land.match(/required-checks\.txt'/gu), 'land.mjs reads the file exactly once').toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ v3 round 5 (from juju2's attack): c2, b6, a10, r5, a9 */

describe('round 5 c2: the head commit\'s resolved GitHub author must be the App; an unresolved author is refused', () => {
  it('null, missing, another account and a bot look-alike are refused; the App passes', () => {
    const withAuthor = (author: unknown) => ({ ...goodCommit(), author });
    expect(check({ commit: goodCommit() })).toEqual([]);
    expect(check({ commit: withAuthor({ login: 'julius-worker[bot]' }) })).toEqual([]);
    expect(check({ commit: withAuthor(null) }).join(' ')).toContain('unresolved');
    expect(check({ commit: withAuthor(undefined) }).join(' ')).toContain('unresolved');
    expect(check({ commit: withAuthor({}) }).join(' ')).toContain('unresolved');
    expect(check({ commit: withAuthor({ login: 'ohdieyuh-glitch' }) }).join(' ')).toContain('ohdieyuh-glitch');
    expect(check({ commit: withAuthor({ login: 'julius-worker' }) }).length).toBeGreaterThan(0);
    expect(check({ commit: withAuthor({ login: 'Julius-Worker[bot]' }) }).length).toBeGreaterThan(0);
    const noAuthorKey = goodCommit() as Record<string, unknown>;
    delete noAuthorKey.author;
    expect(check({ commit: noAuthorKey }).join(' ')).toContain('unresolved');
  });

  it('end to end: a head whose author name is the App but whose account is unresolved never lands and nothing is written', () => {
    const r = runLand({ scenario: { commit: { ...goodCommit(), author: null } } });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('unresolved');
    expect(r.writes).toHaveLength(0);
  });
});

describe('round 5 b6: the clearance nonce is spent as a tag, atomically, before main is touched', () => {
  const TAG = 'julius-landing-nonce-0123456789abcdef0123456789abcdef';

  it('order: commit created, read back, THEN the nonce tag, THEN the ref update, then comment and close', () => {
    const r = runLand();
    expect(r.code, r.out).toBe(0);
    const at = (pred: (c: { method: string; path: string }) => boolean) => r.calls.findIndex(pred);
    const created = at((c) => c.method === 'POST' && c.path.endsWith('/git/commits'));
    const readBack = at((c) => c.method === 'GET' && c.path.endsWith(`/commits/${'8'.repeat(40)}`));
    const tag = at((c) => c.method === 'POST' && c.path.endsWith('/git/refs'));
    const patch = at((c) => c.method === 'PATCH' && c.path.endsWith('/git/refs/heads/main'));
    expect([created, readBack, tag, patch].every((i) => i >= 0)).toBe(true);
    expect(created).toBeLessThan(readBack);
    expect(readBack).toBeLessThan(tag);
    expect(tag).toBeLessThan(patch);
    expect(JSON.parse(r.calls[tag]!.body ?? '{}')).toEqual({ ref: `refs/tags/${TAG}`, sha: '8'.repeat(40) });
    expect(r.calls.some((c) => c.method === 'GET' && c.path.endsWith(`/git/ref/tags/${TAG}`)), 'the tag was READ first').toBe(true);
  });

  it('a spent tag refuses with zero writes, even when the nonce is no longer in the history window or the history never held it', () => {
    const outOfWindow = Array.from({ length: 100 }, (_, i) => ({ commit: { message: `later commit ${i}` } }));
    for (const history of [[{ commit: { message: 'an earlier landing' } }], outOfWindow]) {
      const r = runLand({ scenario: { spentTags: [TAG], history } });
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain(`the nonce tag ${TAG} exists`);
      expect(r.writes).toHaveLength(0);
    }
  });

  it('a tag read that is not a clean 404 (403, 500) refuses with zero writes', () => {
    for (const tagReadStatus of [403, 500, 502]) {
      const r = runLand({ scenario: { tagReadStatus } });
      expect(r.code, `${tagReadStatus}: ${r.out}`).toBe(1);
      expect(r.writes, String(tagReadStatus)).toHaveLength(0);
    }
  });

  it('a dry run only READS the tag (it refuses when spent, writes nothing when not)', () => {
    const spent = runLand({ dryRun: 'true', scenario: { spentTags: [TAG] } });
    expect(spent.code).toBe(1);
    expect(spent.writes).toHaveLength(0);
    const unspent = runLand({ dryRun: 'true' });
    expect(unspent.code, unspent.out).toBe(0);
    expect(unspent.writes).toHaveLength(0);
    expect(unspent.calls.some((c) => c.method === 'GET' && c.path.endsWith(`/git/ref/tags/${TAG}`))).toBe(true);
    expect(unspent.out).toContain(`refs/tags/${TAG}`);
  });

  it('a tag that cannot be created (422 already exists, 500) stops before main is touched, and says the clearance must not be reused', () => {
    for (const tagCreateStatus of [422, 500]) {
      const r = runLand({ scenario: { tagCreateStatus } });
      expect(r.code, `${tagCreateStatus}: ${r.out}`).toBe(1);
      expect(r.out).toContain(`the nonce tag ${TAG} could not be created`);
      expect(r.out).toContain('must not be reused');
      expect(r.merges, 'no ref update').toHaveLength(0);
      expect(r.writes.map((c) => c.method)).toEqual(['POST', 'POST']);
    }
  });

  it('a refusal AFTER the tag exists spends the clearance: the tag was created before the refused ref update', () => {
    const r = runLand({ scenario: { patchStatus: 422 } });
    expect(r.code).toBe(1);
    expect(r.writes.map((c) => `${c.method} ${c.path.split('/git/')[1] ?? ''}`)).toEqual(['POST commits', 'POST refs', 'PATCH refs/heads/main']);
  });

  it('a commit that fails its read-back spends nothing: no tag is created', () => {
    const r = runLand({ scenario: { readBack: { sha: '8'.repeat(40), parents: [{ sha: 'f'.repeat(40) }], commit: { tree: { sha: T }, message: 'x' } } } });
    expect(r.code).toBe(1);
    expect(r.writes.map((c) => c.method)).toEqual(['POST']);
  });
});

describe('round 5 a10: every request has a deadline, so a hung connection after an applied ref update reaches the recovery re-read', () => {
  it('a PATCH that hangs after being applied is recovered as LANDED; one that hangs unapplied is an ALERT (state in doubt); both within the deadline', () => {
    const started = Date.now();
    const applied = runLand({ requestTimeoutMs: '700', scenario: { patchLost: { hang: true, applied: true } } });
    expect(applied.code, applied.out).toBe(0);
    expect(applied.out).toContain('LANDED (the PATCH response was lost)');
    expect(applied.merges, 'one attempt').toHaveLength(1);
    const unapplied = runLand({ requestTimeoutMs: '700', scenario: { patchLost: { hang: true, applied: false } } });
    expect(unapplied.code, unapplied.out).toBe(2);
    expect(unapplied.out).toContain('state in doubt');
    expect(unapplied.merges).toHaveLength(1);
    expect(Date.now() - started, 'neither run waited for the fake\'s 6 s keep-alive each').toBeLessThan(20_000);
  });

  it('the default is 30 seconds, every request goes through the deadline, and the workflow never sets the test override', () => {
    const land = readFileSync(join(LANDING, 'land.mjs'), 'utf8');
    expect(land).toContain('env.LAND_REQUEST_TIMEOUT_MS ?? 30_000');
    expect(land.match(/AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/gu), 'exactly one place issues requests').toHaveLength(1);
    expect(land.match(/\bfetch\(/gu), 'and it is the only fetch call').toHaveLength(1);
    expect(WORKFLOW).not.toContain('LAND_REQUEST_TIMEOUT_MS');
  });
});

describe('round 5 r5: nothing the lander prints carries a credential, whatever an error text echoes', () => {
  it('an error that echoes the Authorization header, the token and token-shaped strings is printed redacted (stdout and stderr)', () => {
    const token = `ghs_${'T'.repeat(36)}`;
    const r = runLand({ token, scenario: { failGet: '/pulls/7$', echo: true } });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('REFUSED: unexpected error before anything was landed');
    for (const secret of [token, 'T'.repeat(36), `ghs_${'A'.repeat(36)}`, `github_pat_${'B'.repeat(30)}`, `ghp_${'C'.repeat(36)}`, 'Bearer ghs']) expect(r.out, secret).not.toContain(secret);
    expect(r.out).toContain('***');
  });

  it('the redaction also covers a plain token literal that is not token-shaped', () => {
    const r = runLand({ token: 'plain-secret-value-123', scenario: { failGet: '/git/ref/heads/main', echo: true } });
    expect(r.out).not.toContain('plain-secret-value-123');
    expect(r.out).not.toMatch(/Authorization: Bearer/iu);
  });
});

describe('v3.4: GitHub stores a created commit message without its final newline (real run 39290405293)', () => {
  const S = 'a'.repeat(40);
  const BASE = 'b'.repeat(40);
  const TREE = 'c'.repeat(40);
  const sent = lib.buildLandingCommitMessage({ clearanceText: clearanceText(), signatureB64: sig(clearanceText()) }) as string;
  const created = (message: string) => ({ sha: S, parents: [{ sha: BASE }], commit: { tree: { sha: TREE }, message, author: lib.LANDER_IDENTITY, committer: lib.LANDER_IDENTITY } });
  const verdict = (message: string) => lib.checkCreatedCommit({ created: created(message), sha: S, base: BASE, tree: TREE, message: sent }) as string[];

  it('the message as sent, and the message as GitHub stores it (the one final newline removed), are both accepted', () => {
    expect(sent.endsWith('\n') && !sent.endsWith('\n\n')).toBe(true);
    expect(verdict(sent)).toEqual([]);
    expect(verdict(sent.slice(0, -1)), 'the real API answer').toEqual([]);
  });

  it('NOTHING else is accepted: extra text, extra newlines or spaces after the block, a changed nonce or signature character, a changed free text, a missing marker character', () => {
    const stripped = sent.slice(0, -1);
    const lines = stripped.split('\n');
    const swapLast = (i: number) => lines.map((l, j) => (j === i ? `${l.slice(0, -1)}${l.endsWith('A') ? 'B' : 'A'}` : l)).join('\n');
    const cases: Array<[string, string]> = [
      ['extra text after the END marker', `${stripped}\nextra`],
      ['two final newlines', `${sent}\n`],
      ['a trailing space after the END marker', `${stripped} `],
      ['a trailing tab', `${stripped}\t`],
      ['the END marker cut by one character', stripped.slice(0, -1)],
      ['the nonce line changed', swapLast(lines.findIndex((l) => l.startsWith('clearance-nonce: ')))],
      ['the signature line changed', swapLast(lines.findIndex((l) => l.startsWith('signature-b64: ')))],
      ['the clearance line changed', swapLast(lines.findIndex((l) => l.startsWith('clearance-b64: ')))],
      ['the free text changed', stripped.replace('Landed PR', 'Landed pr')],
      ['an empty message', ''],
    ];
    for (const [name, message] of cases) expect(verdict(message), name).not.toEqual([]);
  });

  it('end to end against a fake GitHub that stores the message without its final newline: the landing succeeds exactly once', () => {
    const r = runLand({ scenario: { githubStripsNewline: true } });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('LANDED PR #7');
    expect(r.merges).toHaveLength(1);
  });
});
describe('v3.4 V-1: the README does not oversell the nonce tag', () => {
  it('says the tag is NOT tamper-proof, names the App that could delete or re-create it, and names the ruleset that would close it', () => {
    const readme = readFileSync(join(LANDING, 'README.md'), 'utf8');
    expect(readme).toContain('NOT tamper-proof');
    expect(readme).toContain('could also delete or re-create it');
    expect(readme).toContain('refs/tags/julius-landing-nonce-*');
    expect(readme).not.toMatch(/(?<!NOT )tamper-proof/u);
  });
});

describe('the README carries the operator runbook', () => {
  it('names the rules the first live landings taught', () => {
    const readme = readFileSync(join(LANDING, 'README.md'), 'utf8');
    for (const phrase of ['Operator runbook', 'signed G6 token', 'final newline', 'gh workflow run julius-real-infra.yml', 'late bot comment', 'close the PR and delete its branch', 'UNKNOWN, never absence', 'about 80 s behind GitHub']) expect(readme, phrase).toContain(phrase);
  });
});

describe('the evidence scrubber stays founder-governed', () => {
  it('scripts/julius-live-evidence.mjs is hard-forbidden to the lander and is NOT eligible for a signed exception (REVIEW ruling: its allowed shapes change only through a governed install)', () => {
    expect(lib.HARD_FORBIDDEN_PATH.test('scripts/julius-live-evidence.mjs')).toBe(true);
    expect(lib.EXCEPTION_ELIGIBLE).toEqual(['relay-bridge/julius/role-effort.test.ts', 'scripts/julius-live-contract-check.mjs']);
  });
});

describe('the real-infra workflow path filter covers the paths the landing steps touch (otherwise five required checks never appear)', () => {
  const filter = (): string[] => {
    const yml = readFileSync(join(LANDING, '..', 'workflows', 'julius-real-infra.yml'), 'utf8');
    const m = /pull_request:\s*\n\s*paths: \[(.*)\]/u.exec(yml);
    expect(m, 'the pull_request paths filter is present').not.toBeNull();
    return (m as RegExpExecArray)[1].split(',').map((p) => p.trim().replace(/^'|'$/gu, ''));
  };
  // GitHub path-filter semantics: `*` matches within one path segment, `**` crosses segments
  const matches = (pattern: string, file: string): boolean => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*\*/gu, '\u0000').replace(/\*/gu, '[^/]*').replace(/\u0000/gu, '.*')}$`, 'u').test(file);
  const touched = [
    'src/relay/workspace/command-runner.ts', 'src/relay/workspace/command-runner-partial-secret.test.ts', 'src/relay/workspace/output-sanitizer.ts', 'src/relay/workspace/output-sanitizer.test.ts',
    '.github/julius-missions/julius-diag-digest-evidence-1/contract.json', '.github/julius-missions/julius-maxeffort-loop-1/dryrun/dryrun.sh',
    '.github/julius-learning-registrations/julius-learning-pair-2.json', '.github/julius-mission-slice/loader.mjs', 'JULIUS_HARNESS_MANIFEST.md',
    'relay-bridge/julius/live-composition.ts', 'scripts/julius-live-contract-check.mjs', 'src/relay/mission/julius/julius-policy.ts',
  ];
  it('every file a landing step has touched matches at least one filter entry', () => {
    const patterns = filter();
    for (const file of touched) expect(patterns.some((p) => matches(p, file)), file).toBe(true);
  });
  it('the matcher is not a blanket: unrelated paths still do not match', () => {
    const patterns = filter();
    for (const file of ['README.md', 'docs/relay/CURRENT_STATE.md', 'wonderland/Source/Wonderland/WonderlandX.cpp', 'src/relay/ui/app/RelayX.tsx']) expect(patterns.some((p) => matches(p, file)), file).toBe(false);
  });
});

describe('v3.4 s3: scripts that required CI runs from the PR itself, and julius-paid-dispatch*, are founder-governed paths', () => {
  const S3 = [
    'scripts/relay-parity-gate.mjs', 'scripts/wonderland-beta-gate.mjs', 'scripts/wonderland-beta-gate.test.ts', 'scripts/julius-live-preflight-identity.test.ts', 'scripts/julius-derive-scoped-credentials.mjs',
    'scripts/julius-ci-callers.mjs', 'scripts/ci-test-accounting.test.ts', '.github/julius-learning-store.sh', '.github/julius-phase.sh', '.github/wait-for-executor.sh',
    'scripts/julius-paid-dispatch.mjs', 'scripts/julius-paid-dispatch.d.mts', 'scripts/julius-paid-dispatch.test.ts', 'scripts/julius-paid-run-archive.mjs', 'scripts/julius-paid-run-archive.test.ts',
  ];
  it('every one is refused by the lander\'s hard-forbidden rule and by checkPullRequest, in any letter case', () => {
    for (const f of S3) {
      expect(lib.HARD_FORBIDDEN_PATH.test(f), f).toBe(true);
      expect(lib.HARD_FORBIDDEN_PATH.test(f.toUpperCase()), f.toUpperCase()).toBe(true);
      expect(check({ files: ['ok.ts', f], fileRows: 2, pr: { ...goodPr(), changed_files: 2 } }).join(' '), f).toContain('founder-governed');
    }
  });

  it('near neighbours stay allowed (the rule is not a blanket on scripts/ or .github/)', () => {
    for (const f of ['scripts/julius-evidence-bodies.mjs', 'scripts/relay-notes.md', '.github/julius-learning-notes.md', '.github/phase-notes.sh', 'docs/julius-paid-dispatch.md']) expect(lib.HARD_FORBIDDEN_PATH.test(f), f).toBe(false);
  });
});

describe('v3.5b S-4: the token-shape redaction no longer eats the words that follow a token', () => {
  it('a token-shaped string on one line leaves the words after it (they were swallowed by the whitespace-tolerant run)', () => {
    const r = runLand({ token: 'plain-secret-value-123', scenario: { failGet: '/pulls/7$', echo: 'follow' } });
    expect(r.out).not.toMatch(/ghs_A{8}|ghp_C{8}|github_pat_B{8}/u);
    expect(r.out).toContain('merged PR number 12 into main');
    expect(r.out).toContain('kept going');
    expect(r.out).toContain('done');
  });
});

describe('v3.5b S-4b: the README states what the output redaction covers and its accepted residuals', () => {
  it('names the covered forms and every accepted residual', () => {
    const readme = readFileSync(join(LANDING, 'README.md'), 'utf8');
    expect(readme).toMatch(/## Output redaction/u);
    for (const word of ['line break', 'base64', 'percent-encoded', 'JSON-escaped', 'hex', 'zero-width', 'reversed', 'about four characters']) expect(readme, word).toContain(word);
  });
});

describe('v3.5b S-2: the executor / reviewer-isolation / preflight / usage-limit / pins-check scripts are founder-governed paths', () => {
  const S2 = [
    '.github/julius-mission-pins.sh', '.github/julius-executor-entrypoint.sh', 'scripts/julius-docker-executor.sh', 'scripts/julius-executor-ready.mjs',
    'scripts/julius-reviewer-isolation.mjs', 'scripts/julius-reviewer-isolation.test.ts', 'scripts/julius-reviewer-deadline.mjs', 'scripts/julius-live-preflight.ts', 'scripts/julius-usage-limit.mjs',
  ];
  it('every one is refused by the hard-forbidden rule and by checkPullRequest, in any letter case', () => {
    for (const f of S2) {
      expect(lib.HARD_FORBIDDEN_PATH.test(f), f).toBe(true);
      expect(lib.HARD_FORBIDDEN_PATH.test(f.toUpperCase()), f.toUpperCase()).toBe(true);
      expect(check({ files: ['ok.ts', f], fileRows: 2, pr: { ...goodPr(), changed_files: 2 } }).join(' '), f).toContain('founder-governed');
    }
  });
  it('near neighbours stay allowed', () => {
    for (const f of ['scripts/julius-live-preflight-notes.md', 'scripts/julius-usage-limit-notes.md', 'docs/julius-executor-entrypoint.md', 'scripts/julius-reviewer-notes.md']) expect(lib.HARD_FORBIDDEN_PATH.test(f), f).toBe(false);
  });
});

describe('v3.4 V-4: redaction also covers a token wrapped across a line break and its base64 forms', () => {
  const TOKEN = 'ghs_' + 'abcdefghijklmnopqrstuvwxyz0123456789'.split('').reverse().join('');
  const compact = (s: string) => s.replace(/\s+/g, '');
  it('a token broken by a line break (LF, or CRLF plus a space) leaves no run of it in stdout or stderr', () => {
    const r = runLand({ token: TOKEN, scenario: { failGet: '/pulls/7$', echo: 'wrapped' } });
    expect(r.code, r.out).toBe(1);
    const flat = compact(r.out);
    for (const piece of [TOKEN, TOKEN.slice(4, 24), TOKEN.slice(10, 30), TOKEN.slice(20), TOKEN.slice(14)]) expect(flat, piece).not.toContain(piece);
  });

  it('the base64 forms of the token (alone, behind x-access-token:, at the three byte alignments) and its percent-encoding are not printed', () => {
    const r = runLand({ token: TOKEN, scenario: { failGet: '/pulls/7$', echo: 'b64' } });
    expect(r.code, r.out).toBe(1);
    const b = (s: string) => Buffer.from(s).toString('base64');
    for (const form of [b(TOKEN), b('x-access-token:' + TOKEN), b('  ' + TOKEN), b(' ' + TOKEN), encodeURIComponent(TOKEN)]) {
      // the middle of each form, away from the padding and the unstable edge characters
      expect(r.out, form).not.toContain(form.slice(8, form.length - 8));
    }
  });
});

describe('round 5 a9: the docs say exactly what the non-forced ref update does and does not do', () => {
  it('the README and land.mjs call it a fast-forward test, name the backward-reset residual, and say what the post-update read detects', () => {
    const readme = readFileSync(join(LANDING, 'README.md'), 'utf8');
    const land = readFileSync(join(LANDING, 'land.mjs'), 'utf8');
    for (const [name, text] of [['README', readme], ['land.mjs', land]] as const) {
      expect(text, name).toMatch(/fast-forward/iu);
      expect(text, name).toMatch(/backward/iu);
      expect(text, name).not.toMatch(/compare-and-swap that GitHub refuses unless/iu);
    }
    expect(readme).toContain('nonce tag');
    expect(readme).toContain('by construction');
  });
});
