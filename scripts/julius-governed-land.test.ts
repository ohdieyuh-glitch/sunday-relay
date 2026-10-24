import { afterAll, describe, expect, it } from 'vitest';

import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateMainProvenance, evaluateSignedLanding, parseSignedClearance } from './julius-main-provenance.mjs';

/**
 * Governed landing. Binding refusals need a signature the pinned key accepts.
 * The real private key is not in this checkout, so those cases run against a
 * copy whose pin constants are a throwaway ed25519 key. The real module still
 * has to refuse that key.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANDING = join(ROOT, '.github/julius-landing');
const H = 'a'.repeat(40);
const T = 'b'.repeat(40);
const B = 'c'.repeat(40);
const OTHER = 'd'.repeat(40);
const NONCE = 'ab'.repeat(16);
const DIGEST = 'c'.repeat(64);
const NOW = Date.parse('2026-10-23T18:30:00Z');
const WORKFLOW = '.github/workflows/julius-governed-land.yml';
const REPO = 'ohdieyuh-glitch/sunday-relay';

const pair = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const publicPem = String(pair.publicKey.export({ type: 'spki', format: 'pem' }));
const otherPem = String(other.publicKey.export({ type: 'spki', format: 'pem' }));
const der = Buffer.from(createPublicKey(publicPem).export({ type: 'spki', format: 'der' }));
const spki = createHash('sha256').update(der).digest('hex');
const raw = der.subarray(der.length - 32).toString('hex');
const signWith = (text: string, key = pair.privateKey) => sign(null, Buffer.from(text, 'utf8'), key).toString('base64');

const realLand = (await import(pathToFileURL(join(LANDING, 'land-lib.mjs')).href)) as {
  parseClearance: (text: string) => { problems: string[]; fields: Record<string, string> };
  checkPullRequest: (input: Record<string, unknown>) => string[];
  parseLandingCommitMessage: (message: string) => { problems: string[]; fields: { clearance?: { head?: string } } };
  HARD_FORBIDDEN_PATH: RegExp;
  APP_LOGIN: string;
  REPO: string;
  verifyClearanceSignature: (text: string, signatureB64: string, publicKeyPem: string) => string[];
};
const realGoverned = (await import(pathToFileURL(join(LANDING, 'governed-land.mjs')).href)) as {
  parseGovernedQueue: (text: string) => { problems: string[]; entries: { pr: number; depends: number[] }[] };
  planGovernedQueue: (
    entries: { pr: number; depends: number[] }[],
    landed: number[],
    evaluate: (entry: { pr: number }, landed: Set<number>) => { ok: boolean; problems: string[] },
  ) => { stopped: boolean; results: { pr: number; ok: boolean; problems: string[] }[] };
  formatLandingRecord: (record: Record<string, unknown>) => string;
  evaluateGovernedLanding: (input: Record<string, unknown>) => { ok: boolean; problems: string[] };
};

const work = mkdtempSync(join(tmpdir(), 'julius-governed-land-'));
const fixtureRoot = join(work, 'repo');
const fixtureLanding = join(fixtureRoot, '.github/julius-landing');
afterAll(() => rmSync(work, { recursive: true, force: true }));
cpSync(LANDING, fixtureLanding, { recursive: true });
const fixtureLib = join(fixtureLanding, 'land-lib.mjs');
writeFileSync(fixtureLib, readFileSync(fixtureLib, 'utf8')
  .replace(/export const PINNED_REVIEWER_SPKI_SHA256 = '[0-9a-f]+';/u, `export const PINNED_REVIEWER_SPKI_SHA256 = '${spki}';`)
  .replace(/export const PINNED_REVIEWER_RAW_KEY = '[0-9a-f]+';/u, `export const PINNED_REVIEWER_RAW_KEY = '${raw}';`));
cpSync(join(ROOT, 'scripts/julius-main-provenance-trust.mjs'), join(fixtureRoot, 'scripts/julius-main-provenance-trust.mjs'));
const fixtureTrustPath = join(fixtureRoot, 'scripts/julius-main-provenance-trust.mjs');
writeFileSync(fixtureTrustPath, readFileSync(fixtureTrustPath, 'utf8')
  .replace(/export const PINNED_REVIEWER_SPKI_SHA256 = '[0-9a-f]+';/u, `export const PINNED_REVIEWER_SPKI_SHA256 = '${spki}';`)
  .replace(/export const PINNED_REVIEWER_RAW_KEY = '[0-9a-f]+';/u, `export const PINNED_REVIEWER_RAW_KEY = '${raw}';`));
const fixture = (await import(pathToFileURL(join(fixtureLanding, 'governed-land.mjs')).href)) as {
  evaluateGovernedLanding: (input: Record<string, unknown>) => {
    ok: boolean;
    problems: string[];
    method?: string;
    message?: string | null;
    refUpdate?: { sha: string | null; force: boolean };
    fields?: { head?: string };
  };
};
const fixtureTrust = (await import(pathToFileURL(fixtureTrustPath).href)) as {
  judgeCommitLanding: (commit: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ ok: boolean; absent: boolean; reason: string; nonce?: string }>;
};

const previousAnchor = process.env.JULIUS_REVIEWER_KEY_SHA256;
process.env.JULIUS_REVIEWER_KEY_SHA256 = spki;
afterAll(() => {
  if (previousAnchor === undefined) delete process.env.JULIUS_REVIEWER_KEY_SHA256;
  else process.env.JULIUS_REVIEWER_KEY_SHA256 = previousAnchor;
});

const clearance = (optional: string[] = []) => [
  'JULIUS-CLEARANCE-V1',
  `repo: ${REPO}`,
  'pr: 7',
  `head: ${H}`,
  `tree: ${T}`,
  `base: ${B}`,
  'kind: CLEARED',
  `bot-comments-sha256: ${DIGEST}`,
  'governed-exceptions: -',
  `nonce: ${NONCE}`,
  'by: INDEPENDENT_REVIEW',
  'issued: 2026-10-23T18:00:00Z',
  'expires: 2026-10-24T17:00:00Z',
  ...optional,
  '',
].join('\n');

const openPr = (over: Record<string, unknown> = {}) => ({
  number: 7,
  state: 'open',
  merged: false,
  draft: false,
  changed_files: 1,
  head: { sha: H, repo: { full_name: REPO } },
  base: { ref: 'main' },
  ...over,
});

const landingInput = (over: Record<string, unknown> = {}, optional = ['landing-method: squash', 'depends: -']) => {
  const text = typeof over.clearanceText === 'string' ? over.clearanceText : clearance(optional);
  const signatureB64 = typeof over.signatureB64 === 'string' ? over.signatureB64 : signWith(text);
  const rest = { ...over };
  delete rest.clearanceText;
  delete rest.signatureB64;
  return {
    publicKeyPem: publicPem,
    now: NOW,
    pr: openPr(),
    commit: { commit: { tree: { sha: T } }, parents: [{ sha: B }] },
    files: ['src/relay/ordinary.ts'],
    fileRows: 1,
    mainSha: B,
    digest: DIGEST,
    commitMessages: [] as string[],
    nonceTagExists: false,
    checkRuns: [{ name: 'Verify Relay', status: 'completed', conclusion: 'success', app: { id: 15368 }, id: 1001 }],
    statuses: [],
    required: [{ name: 'Verify Relay', appId: 15368 }],
    landedOnMain: [] as number[],
    fastForward: false,
    ...rest,
    clearanceText: text,
    signatureB64,
  };
};

const problemsOf = (over: Record<string, unknown> = {}, optional?: string[]) => fixture.evaluateGovernedLanding(landingInput(over, optional)).problems.join('\n');

describe('clearance format stays backward compatible', () => {
  const historical = clearance();

  it('parses a historical clearance and rejects an unknown extra line', () => {
    expect(realLand.parseClearance(historical).problems).toEqual([]);
    expect(parseSignedClearance(historical, REPO).problems).toEqual([]);
    expect(realLand.parseClearance(`${historical}extra: line\n`).problems.join('\n')).toMatch(/exactly one trailing newline and no extra lines/u);
    expect(parseSignedClearance(`${historical}extra: line\n`, REPO).problems.join('\n')).toMatch(/exactly one trailing newline and no extra lines/u);
  });

  it('parses the signed optional lines the same way in both parsers', () => {
    const text = clearance([
      `protected-paths: ${WORKFLOW}`,
      'landing-method: fast-forward',
      'binds-draft: yes',
      'depends: 417,451',
    ]);
    const left = realLand.parseClearance(text);
    const right = parseSignedClearance(text, REPO);
    expect(left.problems).toEqual([]);
    expect(right.problems).toEqual([]);
    expect(left.fields['protected-paths']).toBe(WORKFLOW);
    expect(right.fields['protected-paths']).toBe(left.fields['protected-paths']);
    expect(right.fields['landing-method']).toBe('fast-forward');
    expect(right.fields['binds-draft']).toBe('yes');
    expect(right.fields.depends).toBe('417,451');
  });

  it('refuses an unsorted or glob protected-paths list', () => {
    for (const value of [`${WORKFLOW},.github/julius-landing/governed-land.mjs`, 'src/*.ts']) {
      const text = clearance([`protected-paths: ${value}`, 'landing-method: squash']);
      expect(realLand.parseClearance(text).problems.join('\n')).toMatch(/protected-paths must be "-" or a sorted comma-separated path list/u);
      expect(parseSignedClearance(text, REPO).problems.join('\n')).toMatch(/protected-paths must be "-" or a sorted comma-separated path list/u);
    }
  });

  it('the historical lander still refuses a founder-governed path named in protected-paths', () => {
    const text = clearance([`protected-paths: ${WORKFLOW}`, 'landing-method: squash']);
    const fields = realLand.parseClearance(text).fields;
    const problems = realLand.checkPullRequest({
      fields,
      now: NOW,
      pr: {
        ...openPr(),
        user: { login: realLand.APP_LOGIN },
        commits: 1,
        head: { sha: H, ref: 'branch', repo: { full_name: REPO } },
      },
      commit: {
        commit: { tree: { sha: T }, author: { name: realLand.APP_LOGIN }, committer: { name: realLand.APP_LOGIN } },
        parents: [{ sha: B }],
        author: { login: realLand.APP_LOGIN },
      },
      files: [WORKFLOW],
      fileRows: 1,
      mainSha: B,
      allowedBranches: ['branch'],
      digest: DIGEST,
    });
    expect(problems.join('\n')).toContain(`the PR changes founder-governed paths: ${WORKFLOW}`);
    expect(problems.join('\n')).not.toContain('protected-paths');
  });
});

describe('queue, record, and workflow', () => {
  it('stops only when a later entry depends on the refused pull request', () => {
    const blocking = realGoverned.planGovernedQueue(
      [{ pr: 7, depends: [] }, { pr: 9, depends: [7] }],
      [],
      () => ({ ok: false, problems: ['refused'] }),
    );
    expect(blocking.stopped).toBe(true);
    expect(blocking.results.map((row) => row.pr)).toEqual([7]);

    const continued = realGoverned.planGovernedQueue(
      [{ pr: 7, depends: [] }, { pr: 8, depends: [] }, { pr: 9, depends: [8] }],
      [],
      (entry, landed) => {
        if (entry.pr === 7) return { ok: false, problems: ['refused'] };
        if (entry.pr === 9) expect(landed.has(8)).toBe(true);
        return { ok: true, problems: [] };
      },
    );
    expect(continued.stopped).toBe(false);
    expect(continued.results.map((row) => row.ok)).toEqual([false, true, true]);
  });

  it('parses the shipped queue as empty and writes the landing record', () => {
    const shipped = realGoverned.parseGovernedQueue(readFileSync(join(LANDING, 'governed-queue.txt'), 'utf8'));
    expect(shipped.problems).toEqual([]);
    expect(shipped.entries).toEqual([]);
    expect(realGoverned.parseGovernedQueue('7\n7 depends: -\n').problems.join('\n')).toMatch(/listed twice/u);
    expect(realGoverned.parseGovernedQueue('9 depends: 8,7\n').problems.join('\n')).toMatch(/numerically sorted/u);
    const record = realGoverned.formatLandingRecord({
      pr: 7, head: H, tree: T, base: B, clearanceDigest: DIGEST, checkRunIds: [1001], resultingMainSha: OTHER, method: 'squash',
    });
    expect(record).toBe([
      'JULIUS GOVERNED LANDING',
      'pr: 7',
      `head: ${H}`,
      `tree: ${T}`,
      `base: ${B}`,
      `clearance-sha256: ${DIGEST}`,
      'check-runs: 1001',
      `main: ${OTHER}`,
      'method: squash',
      '',
    ].join('\n'));
  });

  it('the workflow mints an app token and never force-pushes', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/julius-governed-land.yml'), 'utf8');
    const source = readFileSync(join(LANDING, 'governed-land.mjs'), 'utf8');
    expect(workflow).toContain('environment: governed-landing');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('pr:');
    expect(workflow).toContain("cron: '17 * * * *'");
    expect(workflow).toContain('actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510');
    expect(workflow).toContain('app-id: ${{ vars.JULIUS_LANDER_APP_ID }}');
    expect(workflow).toContain('private-key: ${{ secrets.JULIUS_LANDER_PRIVATE_KEY }}');
    for (const line of ['permission-contents: write', 'permission-pull-requests: write', 'permission-workflows: write', 'permission-checks: read', 'permission-actions: read', 'permission-metadata: read']) {
      expect(workflow).toContain(line);
    }
    expect(source).toContain('force: false');
    expect(source).not.toContain('force: true');
    expect(source).toContain('is not in the governed queue');
  });
});

describe('eligibility fails closed', () => {
  it('refuses the wrong head, tree, or base', () => {
    expect(problemsOf({ pr: openPr({ head: { sha: OTHER, repo: { full_name: REPO } } }) })).toMatch(new RegExp(`the PR head is ${OTHER}`));
    expect(problemsOf({ commit: { commit: { tree: { sha: OTHER } }, parents: [{ sha: B }] } })).toMatch(new RegExp(`the head tree is ${OTHER}`));
    expect(problemsOf({ mainSha: OTHER })).toMatch(new RegExp(`main is ${OTHER}, the clearance names base ${B}`));
  });

  it('refuses an expired clearance and a replayed nonce', () => {
    expect(problemsOf({ now: Date.parse('2026-10-24T17:00:01Z') })).toMatch(/the clearance has expired/u);
    expect(problemsOf({ commitMessages: [`Landed earlier\nclearance-nonce: ${NONCE}\n`] })).toMatch(/nonce was already used/u);
    expect(problemsOf({ nonceTagExists: true })).toMatch(/nonce was already used/u);
  });

  it('refuses an unsigned clearance and a signature from the wrong key', () => {
    expect(realLand.verifyClearanceSignature(clearance(['landing-method: squash']), '', publicPem).join('\n')).toMatch(/not 64 bytes/u);
    expect(realLand.verifyClearanceSignature(clearance(['landing-method: squash']), signWith(clearance(['landing-method: squash'])), publicPem).join('\n')).toMatch(/not the pinned reviewer key/u);
    const text = clearance(['landing-method: squash']);
    expect(problemsOf({ clearanceText: text, signatureB64: '', publicKeyPem: publicPem })).toMatch(/not 64 bytes/u);
    expect(problemsOf({ clearanceText: text, signatureB64: signWith(text, other.privateKey), publicKeyPem: otherPem })).toMatch(/not the pinned reviewer key/u);
    expect(realGoverned.evaluateGovernedLanding(landingInput()).problems.join('\n')).toMatch(/not the pinned reviewer key/u);
  });

  it('refuses a missing required check, including one from the wrong app', () => {
    expect(problemsOf({
      checkRuns: [{ name: 'Verify Relay', status: 'completed', conclusion: 'failure', app: { id: 15368 }, id: 1001 }],
    })).toMatch(/concluded failure/u);
    expect(problemsOf({
      checkRuns: [{ name: 'Verify Relay', status: 'completed', conclusion: 'success', app: { id: 1 }, id: 1001 }],
    })).toMatch(/not the required app 15368/u);
  });

  it('refuses a founder-governed path the clearance does not enumerate, and an enumerated path the diff does not change', () => {
    expect(problemsOf({ files: [WORKFLOW] }, ['landing-method: squash'])).toMatch(/not listed in the signed protected-paths/u);
    expect(problemsOf({}, [`protected-paths: ${WORKFLOW}`, 'landing-method: squash'])).toMatch(/lists protected paths the PR does not change/u);
  });

  it('refuses a dependency that is not on main, a moved base, a draft, and a fast-forward that is not ahead', () => {
    expect(problemsOf({}, ['landing-method: squash', 'depends: 417'])).toMatch(/dependency not on main: 417/u);
    expect(problemsOf({ mainSha: OTHER })).toMatch(/the clearance names base/u);
    expect(problemsOf({ pr: openPr({ draft: true }) }, ['landing-method: squash'])).toMatch(/the pull request is a draft/u);
    expect(problemsOf({}, ['landing-method: fast-forward'])).toMatch(/not a fast-forward of the signed base/u);
    expect(problemsOf({}, [])).toMatch(/does not name a landing method/u);
    expect(problemsOf({
      commit: { commit: { tree: { sha: T } }, parents: [{ sha: OTHER }] },
    })).toMatch(/one commit on the signed base/u);
  });
});

describe('squash and fast-forward pass only when every binding holds', () => {
  it('builds a squash landing on the signed base and does not force the ref', () => {
    const decision = fixture.evaluateGovernedLanding(landingInput());
    expect(decision.ok, decision.problems.join('\n')).toBe(true);
    expect(decision.method).toBe('squash');
    expect(decision.refUpdate).toEqual({ sha: null, force: false });
    expect(decision.message).toContain('-----BEGIN JULIUS LANDING-----');
    expect(decision.message).toContain('Landed PR #7 ');
    const parsed = realLand.parseLandingCommitMessage(decision.message ?? '');
    expect(parsed.problems).toEqual([]);
    expect(parsed.fields.clearance?.head).toBe(H);
  });

  it('fast-forwards only the cleared head, still with force false', () => {
    const decision = fixture.evaluateGovernedLanding(landingInput({
      fastForward: true,
      commit: { commit: { tree: { sha: T } }, parents: [{ sha: OTHER }, { sha: 'e'.repeat(40) }] },
    }, ['landing-method: fast-forward']));
    expect(decision.ok, decision.problems.join('\n')).toBe(true);
    expect(decision.method).toBe('fast-forward');
    expect(decision.refUpdate).toEqual({ sha: H, force: false });
    expect(decision.message).toBeNull();
  });

  it('a draft passes only when the clearance binds it', () => {
    const unbound = fixture.evaluateGovernedLanding(landingInput({ pr: openPr({ draft: true }) }, ['landing-method: squash']));
    expect(unbound.ok).toBe(false);
    const bound = fixture.evaluateGovernedLanding(landingInput(
      { pr: openPr({ draft: true }) },
      ['landing-method: squash', 'binds-draft: yes'],
    ));
    expect(bound.ok, bound.problems.join('\n')).toBe(true);
  });

  it('an enumerated protected path is part of a passing squash', () => {
    const decision = fixture.evaluateGovernedLanding(landingInput(
      { files: [WORKFLOW] },
      [`protected-paths: ${WORKFLOW}`, 'landing-method: squash'],
    ));
    expect(decision.ok, decision.problems.join('\n')).toBe(true);
    expect(decision.refUpdate?.force).toBe(false);
  });
});

describe('the main-provenance verifier accepts this landing and refuses a direct push', () => {
  const tip = { mainSha: OTHER, mainTreeSha: T, parentSha: B };
  const signedInput = (text: string, over: Record<string, unknown> = {}) => ({
    repo: REPO,
    mainCommitMessage: `Landed PR #7 (${H.slice(0, 12)})\n\n${block(text)}\n`,
    reviewerKeyPem: publicPem,
    reviewerKeyAtSha: B,
    tipReviewerKeyPem: publicPem,
    changedPaths: ['src/relay/ordinary.ts'],
    changedPathsComplete: true,
    headCommit: { sha: H, authorLogin: 'not-the-coding-worker', treeSha: T },
    ...over,
  });

  it('a governed clearance skips the worker check and still dies on the real pin after the path check', () => {
    const text = clearance([`protected-paths: ${WORKFLOW}`, 'landing-method: squash']);
    const acceptedShape = evaluateSignedLanding(signedInput(text, { changedPaths: [WORKFLOW] }), tip);
    expect(acceptedShape.state).toBe('decided');
    if (acceptedShape.state !== 'decided') return;
    expect(acceptedShape.result.verdict).toBe('unprovenanced');
    expect(acceptedShape.result.reason).toMatch(/not the pinned reviewer key/u);
    expect(acceptedShape.result.prNumber).toBe(7);
    expect(acceptedShape.result.reason).not.toMatch(/coding worker/u);
    expect(acceptedShape.result.reason).not.toMatch(/founder-governed paths/u);

    const omitted = evaluateSignedLanding(signedInput(clearance(['landing-method: squash']), { changedPaths: [WORKFLOW] }), tip);
    expect(omitted.state).toBe('decided');
    if (omitted.state !== 'decided') return;
    expect(omitted.result.reason).toMatch(/founder-governed paths/u);
    expect(omitted.result.prNumber).toBeUndefined();

    const historical = evaluateSignedLanding(signedInput(clearance()), tip);
    expect(historical.state).toBe('decided');
    if (historical.state !== 'decided') return;
    expect(historical.result.reason).toMatch(/not the coding worker/u);
  });

  it('a direct push with no landing block is unprovenanced', () => {
    const pushed = evaluateMainProvenance({
      repo: REPO,
      mainSha: B,
      mainShaAfter: B,
      mainTreeSha: T,
      mainParents: [H],
      mainCommitMessage: 'direct push by someone else\n',
      pullRequests: [],
      reviewedTreeSha: undefined,
      reviewedHeadShaAfter: undefined,
      reviews: [],
      reviewComments: [],
      parentContainedInReviewedHead: false,
      baseRefChanged: false,
    });
    expect(pushed.verdict).toBe('unprovenanced');
    expect(pushed.reason).toContain('no merged pull request records');
  });

  it('judgeCommitLanding accepts the squash when the protected path is enumerated', async () => {
    const text = clearance([`protected-paths: ${WORKFLOW}`, 'landing-method: squash']);
    const built = (await import(pathToFileURL(fixtureLib).href) as {
      buildLandingCommitMessage: (input: { clearanceText: string; signatureB64: string }) => string;
    }).buildLandingCommitMessage({ clearanceText: text, signatureB64: signWith(text) });
    const commit = {
      message: built,
      committerTime: NOW,
      tree: T,
      parent: B,
      parentCount: 1,
      headTree: T,
      headParentCount: 1,
      headParent: B,
      paths: [WORKFLOW],
    };
    const seen = new Set<string>();
    const ok = await fixtureTrust.judgeCommitLanding(commit, { pem: publicPem, anchor: spki, now: NOW + 1000, seenNonces: seen });
    expect(ok.ok, ok.reason).toBe(true);
    expect(seen.has(NONCE)).toBe(true);

    const missing = await fixtureTrust.judgeCommitLanding(
      { ...commit, paths: ['.github/workflows/julius-land.yml'] },
      { pem: publicPem, anchor: spki, now: NOW + 1000, seenNonces: new Set<string>() },
    );
    expect(missing.ok).toBe(false);
    expect(missing.reason).toMatch(/founder-governed paths/u);

    const absent = await fixtureTrust.judgeCommitLanding(
      { message: 'direct push by someone else\n' },
      { pem: publicPem, anchor: spki, now: NOW },
    );
    expect(absent.absent).toBe(true);

    const expired = await fixtureTrust.judgeCommitLanding(
      { ...commit, committerTime: Date.parse('2026-10-24T18:00:00Z') },
      { pem: publicPem, anchor: spki, now: Date.parse('2026-10-24T18:00:01Z'), seenNonces: new Set<string>() },
    );
    expect(expired.ok).toBe(false);
    expect(expired.reason).toMatch(/the clearance has expired/u);

    const replayed = await fixtureTrust.judgeCommitLanding(commit, { pem: publicPem, anchor: spki, now: NOW, seenNonces: new Set([NONCE]) });
    expect(replayed.ok).toBe(false);
    expect(replayed.reason).toMatch(/already used/u);
  });
});

function block(text: string) {
  return [
    '-----BEGIN JULIUS LANDING-----',
    'v: 1',
    `clearance-nonce: ${NONCE}`,
    `clearance-b64: ${Buffer.from(text, 'utf8').toString('base64')}`,
    `signature-b64: ${signWith(text)}`,
    '-----END JULIUS LANDING-----',
  ].join('\n');
}
