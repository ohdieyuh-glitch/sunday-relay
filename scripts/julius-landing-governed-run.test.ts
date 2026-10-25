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
const signWith = (text: string, key = pair.privateKey) => sign(null, Buffer.from(text, 'utf8'), key).toString('base64');
/** H1: a throwaway founder-approval key, pinned only in the fixture copy. */
const founder = generateKeyPairSync('ed25519');
const founderPem = String(founder.publicKey.export({ type: 'spki', format: 'pem' }));
const founderDer = Buffer.from(founder.publicKey.export({ type: 'spki', format: 'der' }));
const founderSpki = createHash('sha256').update(founderDer).digest('hex');
const founderRaw = founderDer.subarray(founderDer.length - 32).toString('hex');
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
{
  const trustPath = join(fixtureRoot, 'scripts/julius-main-provenance-trust.mjs');
  writeFileSync(trustPath, readFileSync(trustPath, 'utf8')
    .replace('export const PINNED_FOUNDER_APPROVAL_SPKI_SHA256 = null;', `export const PINNED_FOUNDER_APPROVAL_SPKI_SHA256 = '${founderSpki}';`)
    .replace('export const PINNED_FOUNDER_APPROVAL_RAW_KEY = null;', `export const PINNED_FOUNDER_APPROVAL_RAW_KEY = '${founderRaw}';`));
}
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
  const founderBlock = founderSignature === undefined ? '' : `\n-----BEGIN JULIUS FOUNDER APPROVAL SIGNATURE-----\n${founderSignature}\n-----END JULIUS FOUNDER APPROVAL SIGNATURE-----`;
  return `-----BEGIN JULIUS CLEARANCE-----\n${text}-----END JULIUS CLEARANCE-----\n-----BEGIN JULIUS CLEARANCE SIGNATURE-----\n${signature}\n-----END JULIUS CLEARANCE SIGNATURE-----${founderBlock}`;
}

type Route = { status: number; body?: unknown };
type Call = { method: string; path: string; body: unknown; auth: string };

export type Scenario = {
  issueComments?: { id: number; user: { login: string }; created_at: string; updated_at: string; body: string }[];
  files?: string[];
  patch?: 'ok' | 'timeout-moved' | 'timeout-unmoved' | 'timeout-unreadable' | 'conflict';
  auditRef?: 'ok' | 'fail';
  comment?: 'ok' | 'fail';
  override?: (call: Call, state: { main: string }) => Route | undefined;
};

/** A fake GitHub. Every route the lander may call is listed; anything else is 599. */
export function fakeGithub(scenario: Scenario) {
  const calls: Call[] = [];
  const state = { main: B };
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
    if (method === 'GET' && at(`/commits/${H}/status?per_page=100`)) return { status: 200, body: { total_count: 0, statuses: [] } };
    if (method === 'GET' && at(`/git/ref/tags/julius-landing-nonce-${NONCE}`)) return { status: 404 };
    if (method === 'GET' && path.startsWith(`/repos/${REPO}/git/ref/heads/julius-governed-audit/pr/`)) return { status: 404 };
    if (method === 'GET' && at('/installation')) return { status: 200, body: { id: 174890170 } };
    if (method === 'POST' && path === '/app/installations/174890170/access_tokens') return { status: 201, body: { token: 'ghs_write_token' } };
    if (method === 'POST' && at('/git/commits')) {
      landingMessage = String((call.body as { message?: string })?.message ?? '');
      return { status: 201, body: { sha: S } };
    }
    if (method === 'GET' && at(`/commits/${S}`)) {
      const who = { name: BOT_LOGIN, email: `${BOT}+${BOT_LOGIN}@users.noreply.github.com` };
      return {
        status: 200,
        body: {
          sha: S,
          parents: [{ sha: B }],
          committer: { id: Number(BOT) },
          commit: { tree: { sha: T }, message: landingMessage.replace(/\n$/u, ''), author: who, committer: who, verification: { verified: true, reason: 'valid' } },
        },
      };
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
    expect(result.text).toMatch(/founder approval required for \.github\/workflows\/ci\.yml: founder approval: no founder-approval signature was supplied/u);
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
