/**
 * The governed lander end to end, against a fake GitHub. The real reviewer key
 * is not in this checkout, so the run uses a copy of the landing directory
 * whose pin constants are a throwaway ed25519 key. No network is reached:
 * every request goes through the injected fetch and an unknown route is a 599.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANDING = join(ROOT, '.github/julius-landing');
const REPO = 'ohdieyuh-glitch/sunday-relay';
const H = 'a'.repeat(40);
const T = 'b'.repeat(40);
const B = 'c'.repeat(40);
const S = '5'.repeat(40);
const NONCE = 'ab'.repeat(16);
const APP = '5457712';
const BOT = '347502603';
const BOT_LOGIN = 'julius-governed-lander[bot]';
const NOW = Date.parse('2026-10-23T18:30:00Z');

const pair = generateKeyPairSync('ed25519');
const publicPem = String(pair.publicKey.export({ type: 'spki', format: 'pem' }));
const der = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }));
const spki = createHash('sha256').update(der).digest('hex');
const raw = der.subarray(der.length - 32).toString('hex');
/** The identity GitHub reports for a commit the governed App created through the API: bot author, web-flow signer, valid signature. */
const appSigned = (bot: string | number) => ({
  authorId: Number(bot), authorType: 'Bot', authorEmail: `${bot}+julius-governed-lander[bot]@users.noreply.github.com`,
  committerId: 19864447, committerEmail: 'noreply@github.com', committerName: 'GitHub',
  verificationVerified: true, verificationReason: 'valid',
});
/** The same, as a REST commits/{sha} body. */
const appSignedBody = (bot: string | number, rest: Record<string, unknown> = {}, commit: Record<string, unknown> = {}) => ({
  ...rest,
  author: { login: 'julius-governed-lander[bot]', id: Number(bot), type: 'Bot' },
  committer: { login: 'web-flow', id: 19864447, type: 'User' },
  commit: {
    author: { name: 'julius-governed-lander[bot]', email: `${bot}+julius-governed-lander[bot]@users.noreply.github.com` },
    committer: { name: 'GitHub', email: 'noreply@github.com' },
    verification: { verified: true, reason: 'valid' },
    ...commit,
  },
});
const signWith = (text: string, key = pair.privateKey) => sign(null, Buffer.from(text, 'utf8'), key).toString('base64');
/** H1: a throwaway founder-approval key, pinned only in the fixture copy. */
const founder = generateKeyPairSync('ed25519');
const founderPem = String(founder.publicKey.export({ type: 'spki', format: 'pem' }));
const founderDer = Buffer.from(founder.publicKey.export({ type: 'spki', format: 'der' }));
const founderSpki = createHash('sha256').update(founderDer).digest('hex');
const founderSign = (text: string) => sign(null, Buffer.from(text, 'utf8'), founder.privateKey).toString('base64');
const appKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const work = mkdtempSync(join(tmpdir(), 'julius-governed-run-'));
const fixtureRoot = join(work, 'repo');
const fixtureLanding = join(fixtureRoot, '.github/julius-landing');
cpSync(LANDING, fixtureLanding, { recursive: true });
const repin = (path: string) => writeFileSync(path, readFileSync(path, 'utf8')
  .replace(/export const PINNED_REVIEWER_SPKI_SHA256 = '[0-9a-f]+';/u, `export const PINNED_REVIEWER_SPKI_SHA256 = '${spki}';`)
  .replace(/export const PINNED_REVIEWER_RAW_KEY = '[0-9a-f]+';/u, `export const PINNED_REVIEWER_RAW_KEY = '${raw}';`));
repin(join(fixtureLanding, 'land-lib.mjs'));
cpSync(join(ROOT, 'scripts/julius-main-provenance-trust.mjs'), join(fixtureRoot, 'scripts/julius-main-provenance-trust.mjs'));
repin(join(fixtureRoot, 'scripts/julius-main-provenance-trust.mjs'));
writeFileSync(join(fixtureLanding, 'reviewer-ed25519.pub'), publicPem);

type RunResult = { exitCode: number; notes: string[]; walked: { pr: number; ok: boolean; problems: string[] }[] };
type Governed = {
  runGovernedLand: (options: Record<string, unknown>) => Promise<RunResult>;
  GOVERNED_WORKFLOW_REF: string;
  formatLandingRecord: (record: Record<string, unknown>) => string;
};
const governed = (await import(pathToFileURL(join(fixtureLanding, 'governed-land.mjs')).href)) as Governed;
const lib = (await import(pathToFileURL(join(fixtureLanding, 'land-lib.mjs')).href)) as {
  botCommentsDigest: (input: { issueComments: unknown[]; inlineComments: unknown[]; reviews: unknown[] }) => string;
};

const previousAnchor = process.env.JULIUS_REVIEWER_KEY_SHA256;
beforeAll(() => { process.env.JULIUS_REVIEWER_KEY_SHA256 = spki; });
afterAll(() => {
  if (previousAnchor === undefined) delete process.env.JULIUS_REVIEWER_KEY_SHA256;
  else process.env.JULIUS_REVIEWER_KEY_SHA256 = previousAnchor;
  rmSync(work, { recursive: true, force: true });
});

const snapshotText = readFileSync(join(LANDING, 'main-ruleset.json'), 'utf8');
const snapshot = JSON.parse(snapshotText) as { id: number; rules: { type: string; parameters?: unknown }[] };
const liveRules = snapshot.rules.map((rule) => ({ type: rule.type, ruleset_id: snapshot.id, parameters: rule.parameters }));

export function clearanceText(optional: string[], digest: string) {
  return [
    'JULIUS-CLEARANCE-V1',
    `repo: ${REPO}`,
    'pr: 7',
    `head: ${H}`,
    `tree: ${T}`,
    `base: ${B}`,
    'kind: CLEARED',
    `bot-comments-sha256: ${digest}`,
    'governed-exceptions: -',
    `nonce: ${NONCE}`,
    'by: INDEPENDENT_REVIEW',
    'issued: 2026-10-23T18:00:00Z',
    'expires: 2026-10-24T17:00:00Z',
    ...optional,
    '',
  ].join('\n');
}

export function delivery(text: string, signature = signWith(text), founderSignature?: string) {
  // H1 delivery: the founder signature is a separate field in the same block, outside the signed text.
  const founderField = founderSignature === undefined ? '' : `\nfounder-signature-b64: ${founderSignature}`;
  return `-----BEGIN JULIUS CLEARANCE-----\n${text}-----END JULIUS CLEARANCE-----\n-----BEGIN JULIUS CLEARANCE SIGNATURE-----\n${signature}${founderField}\n-----END JULIUS CLEARANCE SIGNATURE-----`;
}

type Route = { status: number; body?: unknown };
type Call = { method: string; path: string; body: unknown; auth: string };

export type Scenario = {
  issueComments?: { id: number; user: { login: string }; created_at: string; updated_at: string; body: string }[];
  files?: string[];
  patch?: 'ok' | 'timeout-moved' | 'timeout-unmoved' | 'timeout-unreadable' | 'conflict';
  auditRef?: 'ok' | 'fail';
  comment?: 'ok' | 'fail';
  environment?: 'ok' | 'env-missing' | 'env-open' | 'env-extra';
  nonceTags?: { ref: string; object: { sha: string } }[];
  main?: string;
  statuses?: { context: string; state: string }[];
  override?: (call: Call, state: { main: string }) => Route | undefined;
};

/** A fake GitHub. Every route the lander may call is listed; anything else is 599. */
export function fakeGithub(scenario: Scenario) {
  const calls: Call[] = [];
  const state = { main: scenario.main ?? B };
  const pr = {
    number: 7,
    state: 'open',
    merged: false,
    draft: false,
    changed_files: (scenario.files ?? ['src/relay/ordinary.ts']).length,
    head: { sha: H, ref: 'relay/ordinary', repo: { full_name: REPO } },
    base: { ref: 'main' },
  };
  let landingMessage = '';
  const route = (call: Call): Route => {
    const custom = scenario.override?.(call, state);
    if (custom) return custom;
    const { method, path } = call;
    const at = (suffix: string) => path === `/repos/${REPO}${suffix}`;
    if (method === 'GET' && at('/git/ref/heads/main')) {
      if (scenario.patch === 'timeout-unreadable' && calls.some((row) => row.method === 'PATCH')) return { status: 502 };
      return { status: 200, body: { object: { sha: state.main } } };
    }
    if (method === 'GET' && at('/rules/branches/main')) return { status: 200, body: liveRules };
    if (path === `/repos/${REPO}/environments/governed-landing`) {
      if ((scenario.environment ?? 'ok') === 'env-missing') return { status: 404, body: null };
      const policy = (scenario.environment ?? 'ok') === 'env-open' ? null : { protected_branches: false, custom_branch_policies: true };
      return { status: 200, body: { name: 'governed-landing', deployment_branch_policy: policy } };
    }
    if (path === `/repos/${REPO}/environments/governed-landing/deployment-branch-policies?per_page=100`) {
      const rows = (scenario.environment ?? 'ok') === 'env-extra' ? [{ name: 'main', type: 'branch' }, { name: 'relay/*', type: 'branch' }] : [{ name: 'main', type: 'branch' }];
      return { status: 200, body: { total_count: rows.length, branch_policies: rows } };
    }

    if (method === 'GET' && path === `/user/${BOT}`) return { status: 200, body: { id: Number(BOT), login: BOT_LOGIN } };
    if (method === 'GET' && at('/pulls/7')) return { status: 200, body: pr };
    if (method === 'GET' && at(`/commits/${H}`)) return { status: 200, body: { sha: H, commit: { tree: { sha: T }, message: 'head\n' }, parents: [{ sha: B }] } };
    if (method === 'GET' && at('/issues/7/comments?per_page=100&page=1')) return { status: 200, body: scenario.issueComments ?? [] };
    if (method === 'GET' && at('/pulls/7/comments?per_page=100&page=1')) return { status: 200, body: [] };
    if (method === 'GET' && at('/pulls/7/reviews?per_page=100&page=1')) return { status: 200, body: [] };
    if (method === 'GET' && at(`/commits/${H}/check-runs?per_page=100`)) {
      return { status: 200, body: { total_count: 1, check_runs: [{ id: 1001, name: 'Verify Relay', status: 'completed', conclusion: 'success', app: { id: 15368 } }] } };
    }
    if (method === 'GET' && at(`/compare/${B}...${H}`)) {
      return { status: 200, body: { behind_by: 0, ahead_by: 1, status: 'ahead', files: (scenario.files ?? ['src/relay/ordinary.ts']).map((filename) => ({ filename })) } };
    }
    if (method === 'GET' && at(`/commits/${H}/status?per_page=100`)) return { status: 200, body: { total_count: (scenario.statuses ?? []).length, statuses: scenario.statuses ?? [] } };
    if (method === 'GET' && at(`/git/ref/tags/julius-landing-nonce-${NONCE}`)) return { status: 404 };
    if (method === 'GET' && path.startsWith(`/repos/${REPO}/git/ref/heads/julius-governed-audit/pr/`)) return { status: 404 };
    if (method === 'GET' && at('/git/matching-refs/tags/julius-landing-nonce-?per_page=100&page=1')) return { status: 200, body: scenario.nonceTags ?? [] };
    if (method === 'GET' && at('/installation')) return { status: 200, body: { id: 174890170 } };
    if (method === 'POST' && path === '/app/installations/174890170/access_tokens') return { status: 201, body: { token: 'ghs_write_token' } };
    if (method === 'POST' && at('/git/commits')) {
      landingMessage = String((call.body as { message?: string })?.message ?? '');
      return { status: 201, body: { sha: S } };
    }
    if (method === 'GET' && at(`/commits/${S}`)) {
      return { status: 200, body: appSignedBody(BOT, { sha: S, parents: [{ sha: B }] }, { tree: { sha: T }, message: landingMessage.replace(/\n$/u, '') }) };
    }
    if (method === 'POST' && at('/git/refs')) {
      const ref = String((call.body as { ref?: string })?.ref ?? '');
      if (ref.startsWith('refs/heads/julius-governed-audit/') && scenario.auditRef === 'fail') return { status: 500 };
      return { status: 201, body: { ref } };
    }
    if (method === 'PATCH' && at('/git/refs/heads/main')) {
      const sha = String((call.body as { sha?: string })?.sha ?? '');
      if (scenario.patch === 'conflict') return { status: 422 };
      if (scenario.patch === 'timeout-moved' || scenario.patch === 'timeout-unreadable') {
        state.main = sha;
        return { status: 504 };
      }
      if (scenario.patch === 'timeout-unmoved') return { status: 504 };
      state.main = sha;
      return { status: 200, body: { object: { sha } } };
    }
    if (method === 'POST' && at('/issues/7/comments')) return scenario.comment === 'fail' ? { status: 500 } : { status: 201, body: {} };
    if (method === 'PATCH' && at('/pulls/7')) return { status: 200, body: {} };
    return { status: 599 };
  };
  const fetchImpl = async (url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
    const path = url.replace('https://api.github.com', '');
    const call: Call = {
      method: init.method ?? 'GET',
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      auth: init.headers?.Authorization ?? '',
    };
    calls.push(call);
    const answer = route(call);
    const text = answer.body === undefined ? '' : JSON.stringify(answer.body);
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
  return { calls, fetchImpl, state };
}

export const baseEnv = (over: Record<string, string> = {}) => ({
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: B,
  GITHUB_WORKFLOW_REF: governed.GOVERNED_WORKFLOW_REF,
  GITHUB_WORKFLOW_SHA: B,
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  JULIUS_GOVERNED_LANDER_APP_ID: APP,
  JULIUS_GOVERNED_LANDER_BOT_ID: BOT,
  JULIUS_GOVERNED_LANDER_TOKEN: 'ghs_read_token',
  JULIUS_GOVERNED_LANDER_PRIVATE_KEY: appKey,
  JULIUS_REVIEWER_KEY_SHA256: spki,
  JULIUS_FOUNDER_APPROVAL_KEY_SHA256: founderSpki,
  DRY_RUN: 'false',
  PR: '7',
  ...over,
});

const localFiles: Record<string, string> = {
  'governed-queue.txt': '7\n',
  'required-checks.txt': 'Verify Relay @15368\n',
  'reviewer-ed25519.pub': publicPem,
  'founder-approval-ed25519.pub': founderPem,
  'main-ruleset.json': snapshotText,
};

export async function run(scenario: Scenario, env: Record<string, string> = {}, files: Record<string, string> = {}) {
  const github = fakeGithub(scenario);
  const result = await governed.runGovernedLand({
    env: baseEnv(env),
    fetchImpl: github.fetchImpl,
    readLocal: (name: string) => {
      const all = { ...localFiles, ...files };
      if (!(name in all)) throw new Error(`no fixture for ${name}`);
      return all[name];
    },
    now: () => NOW,
    stdout: () => undefined,
    stderr: () => undefined,
  });
  return { ...result, ...github, text: result.notes.join('\n') };
}

const botComment = { id: 11, user: { login: 'vercel[bot]' }, created_at: '2026-10-23T17:00:00Z', updated_at: '2026-10-23T17:00:00Z', body: 'preview deployed' };

describe('the governed lander runs against an injected GitHub', () => {
  it('refuses a pull request that carries no signed clearance, and writes nothing', async () => {
    const result = await run({ issueComments: [botComment] });
    expect(result.exitCode).toBe(1);
    expect(result.text).toMatch(/no signed clearance is on the pull request/u);
    expect(result.calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  it('refuses before any GitHub call when the workflow is not main', async () => {
    const result = await run({}, { GITHUB_REF: 'refs/heads/feature' });
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });

});

const reviewerComment = (body: string, id = 12) => ({ id, user: { login: 'ohdieyuh-glitch' }, created_at: '2026-10-23T18:01:00Z', updated_at: '2026-10-23T18:01:00Z', body });
const governedOptional = ['landing-method: squash', 'depends: -', 'comments-digest: excludes-delivery'];
/** The digest the reviewer signs, derived from the comment list the reviewer saw, without the delivery comment. */
const seenDigest = (issueComments: unknown[]) => lib.botCommentsDigest({ issueComments, inlineComments: [], reviews: [] });

describe('B3: the delivering clearance comment is outside the digest by a signed rule', () => {
  it('lands a squash whose signed digest was derived from the comment list without its delivery', async () => {
    const text = clearanceText(governedOptional, seenDigest([botComment]));
    const result = await run({ issueComments: [botComment, reviewerComment(delivery(text))] });
    expect(result.exitCode, result.text).toBe(0);
    const patch = result.calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/git/refs/heads/main'));
    expect(patch?.body).toEqual({ sha: S, force: false });
    expect(result.state.main).toBe(S);
  });

  it('still binds every other comment: a later bot comment or an edited delivery is refused', async () => {
    const text = clearanceText(governedOptional, seenDigest([botComment]));
    const later = { ...botComment, id: 13, body: 'a later bot comment' };
    const added = await run({ issueComments: [botComment, reviewerComment(delivery(text)), later] });
    expect(added.exitCode).toBe(1);
    expect(added.text).toMatch(/differs from what the reviewer saw/u);
    const edited = await run({ issueComments: [botComment, reviewerComment(`${delivery(text)}\nalso: ship it`)] });
    expect(edited.exitCode).toBe(1);
    expect(edited.text).toMatch(/differs from what the reviewer saw/u);
    for (const result of [added, edited]) expect(result.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('refuses a clearance that does not sign the rule, even when its digest happens to exclude the delivery', async () => {
    const text = clearanceText(['landing-method: squash', 'depends: -'], seenDigest([botComment]));
    const result = await run({ issueComments: [botComment, reviewerComment(delivery(text))] });
    expect(result.exitCode).toBe(1);
    expect(result.text).toMatch(/does not sign the comments-digest rule/u);
    expect(result.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });
});

describe('H1: the governed lander needs the founder-approval signature for a governed path', () => {
  const WORKFLOW = '.github/workflows/ci.yml';
  const optional = [`protected-paths: ${WORKFLOW}`, 'landing-method: squash', 'depends: -', 'comments-digest: excludes-delivery'];
  const minted = (calls: { method: string; path: string; body: unknown }[]) => calls.filter((call) => call.method === 'POST' && call.path.endsWith('/access_tokens'));

  it('refuses a reviewer-only clearance on a workflow path before any write token exists', async () => {
    const text = clearanceText(optional, seenDigest([botComment]));
    const result = await run({ files: [WORKFLOW], issueComments: [botComment, reviewerComment(delivery(text))] });
    expect(result.exitCode).toBe(1);
    expect(result.text).toMatch(/founder approval required for \.github\/workflows\/ci\.yml: founder approval: founder_signature_missing: no founder-approval signature was supplied/u);
    expect(minted(result.calls)).toEqual([]);
    expect(result.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('lands with both signatures over the same bytes, and only then requests workflows:write', async () => {
    const text = clearanceText(optional, seenDigest([botComment]));
    const result = await run({ files: [WORKFLOW], issueComments: [botComment, reviewerComment(delivery(text, signWith(text), founderSign(text)))] });
    expect(result.exitCode, result.text).toBe(0);
    const tokens = minted(result.calls);
    expect(tokens).toHaveLength(1);
    expect((tokens[0]?.body as { permissions?: Record<string, string> })?.permissions?.workflows).toBe('write');
    // MEDIUM: the write token is scoped to this one repository.
    expect((tokens[0]?.body as { repositories?: string[] })?.repositories).toEqual(['sunday-relay']);
    const created = result.calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/commits'));
    expect(String((created?.body as { message?: string })?.message)).toContain(`founder-signature-b64: ${founderSign(text)}`);
  });

  it('refuses a founder signature over other bytes, and the hourly schedule is held to the same rule', async () => {
    const text = clearanceText(optional, seenDigest([botComment]));
    const other = clearanceText(optional, seenDigest([]));
    const mismatched = await run({ files: [WORKFLOW], issueComments: [botComment, reviewerComment(delivery(text, signWith(text), founderSign(other)))] });
    expect(mismatched.exitCode).toBe(1);
    expect(mismatched.text).toMatch(/founder-approval signature does not verify over these exact bytes/u);
    const scheduled = await run({ files: [WORKFLOW], issueComments: [botComment, reviewerComment(delivery(text))] }, { GITHUB_EVENT_NAME: 'schedule', DRY_RUN: '', PR: '' });
    expect(scheduled.exitCode).toBe(1);
    expect(scheduled.text).toMatch(/founder approval required/u);
    expect(minted(scheduled.calls)).toEqual([]);
  });
});

describe('H2: the governed-landing environment must deploy from main only before the App key is used', () => {
  const minted = (calls: { method: string; path: string }[]) => calls.filter((call) => call.path.endsWith('/access_tokens') || call.path.endsWith('/installation'));
  for (const [environment, why] of [
    ['env-missing', /governed-landing environment could not be read \(404\)/u],
    ['env-open', /does not restrict deployments to main/u],
    ['env-extra', /deploys from branch:main, branch:relay\/\*, not main only/u],
  ] as const) {
    it(`refuses ${environment} before any App JWT or write token`, async () => {
      const text = clearanceText(governedOptional, seenDigest([botComment]));
      const result = await run({ environment, issueComments: [botComment, reviewerComment(delivery(text))] });
      expect(result.exitCode).toBe(1);
      expect(result.text).toMatch(why);
      expect(minted(result.calls)).toEqual([]);
      expect(result.calls.some((call) => call.method !== 'GET')).toBe(false);
    });
  }

  it('the workflow checks the environment with the job token before any step names the App private key', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/julius-governed-land.yml'), 'utf8');
    const check = workflow.indexOf('node .github/julius-landing/governed-land.mjs --require-environment');
    const firstKey = workflow.indexOf('secrets.JULIUS_GOVERNED_LANDER_PRIVATE_KEY');
    expect(check).toBeGreaterThan(-1);
    expect(firstKey).toBeGreaterThan(check);
    // F5e: the trusted verifier runs before the environment check, and both before the key.
    expect(workflow.indexOf('node scripts/julius-main-provenance-trust.mjs --require-trusted-verifier')).toBeGreaterThan(-1);
    expect(workflow.indexOf('node scripts/julius-main-provenance-trust.mjs --require-trusted-verifier')).toBeLessThan(check);
    expect(workflow.slice(workflow.lastIndexOf('- name:', check), check)).toContain('GH_TOKEN: ${{ github.token }}');
    expect(workflow).toMatch(/^permissions:\n  contents: read\n  statuses: read\n  actions: read\n/mu);
  });
});

describe('H3: an ambiguous ref update is not a clean refusal, and a lost audit record is recovered', () => {
  const text = () => clearanceText(governedOptional, seenDigest([botComment]));
  const comments = () => [botComment, reviewerComment(delivery(text()))];
  const auditRefs = (calls: { method: string; path: string; body: unknown }[]) => calls.filter((call) => call.method === 'POST' && String((call.body as { ref?: string })?.ref ?? '').startsWith('refs/heads/julius-governed-audit/'));

  it('a timed-out PATCH that did move main is a landing, not a refusal', async () => {
    const result = await run({ issueComments: comments(), patch: 'timeout-moved' });
    expect(result.exitCode, result.text).toBe(0);
    expect(result.text).toMatch(/LANDED \(the PATCH response was lost/u);
    expect(auditRefs(result.calls)).toHaveLength(1);
  });

  it('a timed-out PATCH with main unmoved or unreadable is exit 2, with no audit ref and no retry', async () => {
    for (const patch of ['timeout-unmoved', 'timeout-unreadable'] as const) {
      const result = await run({ issueComments: comments(), patch });
      expect(result.exitCode, `${patch}: ${result.text}`).toBe(2);
      expect(result.text).toMatch(/ALERT/u);
      expect(auditRefs(result.calls)).toEqual([]);
      expect(result.calls.filter((call) => call.method === 'PATCH' && call.path.endsWith('/git/refs/heads/main'))).toHaveLength(1);
    }
  });

  it('a clean 4xx from the PATCH with main unmoved is an ordinary refusal, exit 1', async () => {
    const result = await run({ issueComments: comments(), patch: 'conflict' });
    expect(result.exitCode).toBe(1);
    expect(result.text).toMatch(/the ref update was refused; no retry and no force/u);
  });

  it('landed but the audit ref or the comment failed is exit 3, not 0', async () => {
    const ref = await run({ issueComments: comments(), auditRef: 'fail' });
    expect(ref.state.main).toBe(S);
    expect(ref.exitCode, ref.text).toBe(3);
    expect(ref.text).toMatch(/landed, audit finalize failed/u);
    const comment = await run({ issueComments: comments(), comment: 'fail' });
    expect(comment.exitCode).toBe(3);
  });

  it('the nonce tag names the App-signed landing commit, so a later run re-creates the lost audit ref and does not land again', async () => {
    const first = await run({ issueComments: comments(), auditRef: 'fail' });
    const tag = first.calls.find((call) => call.method === 'POST' && String((call.body as { ref?: string })?.ref).startsWith('refs/tags/julius-landing-nonce-'));
    expect((tag?.body as { sha?: string })?.sha).toBe(S);
    const landingMessage = String((first.calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/commits'))?.body as { message?: string })?.message);
    const landedCommit = appSignedBody(BOT, { sha: S, parents: [{ sha: B }] }, { tree: { sha: T }, message: landingMessage });
    const later = await run({
      main: S,
      issueComments: comments(),
      nonceTags: [{ ref: `refs/tags/julius-landing-nonce-${NONCE}`, object: { sha: S } }],
      override: (call) => (call.method === 'GET' && call.path === `/repos/${REPO}/commits/${S}` ? { status: 200, body: landedCommit } : undefined),
    }, { GITHUB_SHA: S, GITHUB_WORKFLOW_SHA: S });
    expect(later.exitCode, later.text).toBe(0);
    expect(later.text).toMatch(/recovered refs\/heads\/julius-governed-audit\/pr\/7 at 5{40}/u);
    expect(later.text).toMatch(/pull request 7 is already on main/u);
    expect(auditRefs(later.calls).map((call) => call.body)).toEqual([{ ref: 'refs/heads/julius-governed-audit/pr/7', sha: S }]);
    expect(later.calls.some((call) => call.method === 'PATCH' && call.path.endsWith('/git/refs/heads/main'))).toBe(false);
    // A tag whose target is not App-signed recovers nothing.
    const forged = await run({
      main: S,
      issueComments: comments(),
      nonceTags: [{ ref: `refs/tags/julius-landing-nonce-${NONCE}`, object: { sha: S } }],
      override: (call) => (call.method === 'GET' && call.path === `/repos/${REPO}/commits/${S}` ? { status: 200, body: { ...landedCommit, committer: { login: 'julius-governed-lander[bot]', id: Number(BOT), type: 'Bot' }, commit: { ...landedCommit.commit, verification: { verified: false, reason: 'unsigned' } } } } : undefined),
    }, { GITHUB_SHA: S, GITHUB_WORKFLOW_SHA: S });
    expect(auditRefs(forged.calls)).toEqual([]);
    expect(forged.text).not.toMatch(/already on main/u);
  });
});

describe('REVIEW batch 2 end to end', () => {
  const text = () => clearanceText(governedOptional, seenDigest([botComment]));

  it('PRACTICAL: a failing Vercel status does not stop a landing gated on required-checks.txt', async () => {
    const result = await run({ issueComments: [botComment, reviewerComment(delivery(text()))], statuses: [{ context: 'Vercel', state: 'failure' }] });
    expect(result.exitCode, result.text).toBe(0);
  });

  it('L2: a delivery of the same text with a signature that does not verify is not left out of the digest', async () => {
    const forged = Buffer.alloc(64, 7).toString('base64');
    const result = await run({ issueComments: [botComment, reviewerComment(delivery(text())), reviewerComment(delivery(text(), forged), 13)] });
    expect(result.exitCode).toBe(1);
    expect(result.text).toMatch(/differs from what the reviewer saw/u);
  });

  it('L1: a decoy nonce tag naming the same pull request does not hide the App-signed audit commit', async () => {
    const first = await run({ issueComments: [botComment, reviewerComment(delivery(text()))], auditRef: 'fail' });
    const landingMessage = String((first.calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/commits'))?.body as { message?: string })?.message);
    const DECOY = '9'.repeat(40);
    const landed = appSignedBody(BOT, { sha: S, parents: [{ sha: B }] }, { tree: { sha: T }, message: landingMessage });
    const decoy = { ...landed, sha: DECOY, committer: { login: 'julius-governed-lander[bot]', id: Number(BOT), type: 'Bot' }, commit: { ...landed.commit, verification: { verified: false, reason: 'unsigned' } } };
    const later = await run({
      main: S,
      issueComments: [botComment, reviewerComment(delivery(text()))],
      nonceTags: [
        { ref: `refs/tags/julius-landing-nonce-${'0'.repeat(32)}`, object: { sha: DECOY } },
        { ref: `refs/tags/julius-landing-nonce-${NONCE}`, object: { sha: S } },
      ],
      override: (call) => {
        if (call.method === 'GET' && call.path === `/repos/${REPO}/commits/${S}`) return { status: 200, body: landed };
        if (call.method === 'GET' && call.path === `/repos/${REPO}/commits/${DECOY}`) return { status: 200, body: decoy };
        return undefined;
      },
    }, { GITHUB_SHA: S, GITHUB_WORKFLOW_SHA: S });
    expect(later.exitCode, later.text).toBe(0);
    expect(later.text).toMatch(/recovered refs\/heads\/julius-governed-audit\/pr\/7 at 5{40}/u);
  });
});

describe('IDENTITY: the governed squash read-back moves main only for the App-signed shape', () => {
  const fixtures = JSON.parse(readFileSync(join(ROOT, 'scripts/julius-landing-identity-fixtures.json'), 'utf8')) as Record<string, Record<string, any>>;
  const text = () => clearanceText(governedOptional, seenDigest([botComment]));
  for (const name of ['spoofBotUnsigned', 'userTokenUnsigned', 'webUiHuman']) {
    it(`refuses the ${name} shape and never PATCHes main`, async () => {
      const result = await run({
        issueComments: [botComment, reviewerComment(delivery(text()))],
        override: (call) => {
          if (call.method !== 'GET' || call.path !== `/repos/${REPO}/commits/${S}`) return undefined;
          const body = JSON.parse(JSON.stringify(fixtures[name]));
          return { status: 200, body: { ...body, sha: S, parents: [{ sha: B }], commit: { ...body.commit, tree: { sha: T }, message: 'x' } } };
        },
      });
      expect(result.exitCode).toBe(1);
      expect(result.calls.some((call) => call.method === 'PATCH' && call.path.endsWith('/git/refs/heads/main'))).toBe(false);
    });
  }
});

void appSigned;

describe('EVIDENCE: a refused squash read-back names what GitHub reported, in one closed line', () => {
  it('prints the created sha and the identity summary, and no token-shaped string', async () => {
    const fixtures = JSON.parse(readFileSync(join(ROOT, 'scripts/julius-landing-identity-fixtures.json'), 'utf8')) as Record<string, Record<string, any>>;
    const text = clearanceText(governedOptional, seenDigest([botComment]));
    const result = await run({
      issueComments: [botComment, reviewerComment(delivery(text))],
      override: (call) => {
        if (call.method !== 'GET' || call.path !== `/repos/${REPO}/commits/${S}`) return undefined;
        const body = JSON.parse(JSON.stringify(fixtures.webUiHuman));
        return { status: 200, body: { ...body, sha: S, parents: [{ sha: B }], token: 'ghs_never_print_me', commit: { ...body.commit, tree: { sha: T }, message: 'x' } } };
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.text).toContain(`created commit ${S}: author ohdieyuh-glitch/225496319/User; committer web-flow/19864447/User; git committer GitHub <noreply@github.com>; verification true/valid`);
    expect(result.text).not.toMatch(/gh[pousr]_[A-Za-z0-9_]{8,}/u);
    expect(result.calls.some((call) => call.method === 'PATCH' && call.path.endsWith('/git/refs/heads/main'))).toBe(false);
  });
});
