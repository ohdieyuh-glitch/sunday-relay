import { afterAll, describe, expect, it } from 'vitest';

import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
const verifyBytes = (text: string, signatureB64: string) => verify(null, Buffer.from(text, 'utf8'), pair.publicKey, Buffer.from(signatureB64, 'base64'));
/** H1: a throwaway founder-approval key, pinned only in the fixture copy. */
const founder = generateKeyPairSync('ed25519');
const founderPem = String(founder.publicKey.export({ type: 'spki', format: 'pem' }));
const founderDer = Buffer.from(founder.publicKey.export({ type: 'spki', format: 'der' }));
const founderSpki = createHash('sha256').update(founderDer).digest('hex');
const founderSign = (text: string) => signWith(text, founder.privateKey);

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
  parseAuditRecord: (message: string) => { status: string; pr: number; method: string; main: string } | null;
  landedPullsFromAudits: (
    audits: Record<string, unknown>[],
    mainSha: string,
    contains: (ancestor: string, descendant: string) => boolean,
    botId?: string,
  ) => Set<number>;
  evaluateGovernedLanding: (input: Record<string, unknown>) => { ok: boolean; problems: string[] };
  governedCommitBody: (input: { message: string; tree: string; parents: string[] }) => { message: string; tree: string; parents: string[] };
  GOVERNED_READ_PERMISSIONS: Record<string, string>;
  GOVERNED_WORKFLOW_REF: string;
  governedWritePermissions: (paths: string[]) => Record<string, string>;
  checkWorkflowOrigin: (input: { ref?: string; sha?: string; workflowRef?: string; workflowSha?: string }) => string[];
  branchRulesProblems: (liveRules: unknown, snapshot: unknown, appId: string) => string[];
  refPatternMatches: (pattern: string, ref: string) => boolean | null;
  rulesetCoversRef: (conditions: unknown, ref?: string) => { ok: boolean; problem?: string };
  commitStatusPage: (body: unknown, httpStatus: number) => { ok: boolean; problem?: string; statuses?: unknown[] };
  githubAppJwt: (appId: string, privateKeyPem: unknown, now?: number) => string;
  nonceTagProblem: (input: Record<string, unknown>) => string | null;
  ensureAuditRef: (
    ref: string,
    sha: string,
    io: { create: (ref: string, sha: string) => Promise<unknown>; read: (ref: string) => Promise<string> },
  ) => Promise<{ ok: boolean; idempotent?: boolean; problem?: string }>;
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
    record?: { status?: string; resultingMainSha?: string };
  };
  chooseClearanceDelivery: (
    comments: { body?: string; created_at?: string; id?: number }[],
    publicKeyPem: string,
    expected?: { head?: string; tree?: string; base?: string },
  ) => { problem?: string; delivery?: { id: number; fields: { head: string; issued?: string } } };
};
const fixtureTrust = (await import(pathToFileURL(fixtureTrustPath).href)) as {
  TRUSTED_COMPUTING_BASE: readonly string[];
  canonicalCheckpointAttestation: (fields?: Record<string, unknown>) => string;
  judgeCommitLanding: (commit: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ ok: boolean; absent: boolean; reason: string; nonce?: string }>;
};

function attestationMaterial(signature: (text: string) => string = signWith) {
  const checkpoint = 'e'.repeat(40);
  const tcb = fixtureTrust.TRUSTED_COMPUTING_BASE.map((path) => ({
    path,
    sha256: createHash('sha256').update(path).digest('hex'),
  }));
  const text = fixtureTrust.canonicalCheckpointAttestation({
    checkpoint,
    commits: [{ sha: checkpoint, tree: T, basis: 'governed landing test' }],
    tcb,
    issued: '2026-10-23T18:00:00Z',
    expires: '2027-04-23T18:30:00Z',
  });
  return {
    attestationText: text,
    attestationSignatureB64: signature(text),
    attestationFounderSignatureB64: founderSign(text),
    treeHashes: Object.fromEntries(tcb.map((row) => [row.path, row.sha256])),
    checkpointNames: [`${checkpoint}.founder.sig`, `${checkpoint}.sig`, `${checkpoint}.txt`],
  };
}

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

/** The governed lander requires the signed digest rule; it is appended unless a test drops it on purpose. */
const DIGEST_RULE = 'comments-digest: excludes-delivery';
const withRule = (optional: string[]) => (optional.includes('NO-DIGEST-RULE') ? optional.filter((line) => line !== 'NO-DIGEST-RULE') : [...optional, DIGEST_RULE]);
const landingInput = (over: Record<string, unknown> = {}, optional = ['landing-method: squash', 'depends: -']) => {
  const text = typeof over.clearanceText === 'string' ? over.clearanceText : clearance(withRule(optional));
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
    treeDiffComplete: true,
    compare: { behind_by: 0, status: 'ahead', ahead_by: 1 },
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
    founderPublicKeyPem: founderPem,
    founderAnchor: founderSpki,
    founderSignatures: [founderSign(text)],
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

  it('parses the shipped queue (seeded at the bootstrap) and writes the landing record', () => {
    const shipped = realGoverned.parseGovernedQueue(readFileSync(join(LANDING, 'governed-queue.txt'), 'utf8'));
    expect(shipped.problems).toEqual([]);
    // Seeded in the bootstrap target, because adding a line later is itself a governed change and the lander
    // lands only what the queue on main already lists.
    expect(shipped.entries).toEqual([
      { pr: 459, depends: [] },
      { pr: 407, depends: [] },
      { pr: 447, depends: [407] },
      { pr: 448, depends: [407] },
      { pr: 468, depends: [] },
      { pr: 471, depends: [] },
      { pr: 472, depends: [] },
      { pr: 473, depends: [] },
      { pr: 474, depends: [] },
      { pr: 478, depends: [] },
      { pr: 479, depends: [] },
      { pr: 476, depends: [] },
      { pr: 477, depends: [] },
      { pr: 481, depends: [] },
      { pr: 482, depends: [] },
      { pr: 483, depends: [] },
      { pr: 486, depends: [] },
      { pr: 485, depends: [486] },
      { pr: 489, depends: [] },
      { pr: 491, depends: [] },
      { pr: 493, depends: [] },
      { pr: 494, depends: [] },
      { pr: 495, depends: [] },
      { pr: 496, depends: [] },
      { pr: 497, depends: [] },
      { pr: 498, depends: [] },
      { pr: 499, depends: [] },
      { pr: 500, depends: [] },
    ]);
    expect(realGoverned.parseGovernedQueue('7\n7 depends: -\n').problems.join('\n')).toMatch(/listed twice/u);
    expect(realGoverned.parseGovernedQueue('9 depends: 8,7\n').problems.join('\n')).toMatch(/numerically sorted/u);
    const record = realGoverned.formatLandingRecord({
      pr: 7, head: H, tree: T, base: B, clearanceDigest: DIGEST, checkRunIds: [1001], resultingMainSha: OTHER, method: 'squash',
    });
    expect(record).toBe([
      'JULIUS GOVERNED LANDING',
      'status: pending',
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
    const parsed = realGoverned.parseAuditRecord(record);
    expect(parsed).toEqual({ status: 'pending', pr: 7, method: 'squash', main: OTHER });
    const bot = '347502603';
    const audit = {
      sha: OTHER, message: record, ...appSigned(347502603),
    };
    expect([...realGoverned.landedPullsFromAudits([audit], OTHER, (ancestor) => ancestor === OTHER, bot)]).toEqual([7]);
    expect([...realGoverned.landedPullsFromAudits([audit], H, () => false, bot)]).toEqual([]);
    const forged = { sha: OTHER, message: record, ...appSigned(347502603), committerId: 347502603, committerEmail: '347502603+julius-governed-lander[bot]@users.noreply.github.com', committerName: 'julius-governed-lander[bot]', verificationVerified: false, verificationReason: 'unsigned' };
    expect([...realGoverned.landedPullsFromAudits([forged], OTHER, () => true, bot)]).toEqual([]);
    expect([...realGoverned.landedPullsFromAudits([audit], OTHER, () => true)]).toEqual([]);
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
    expect(workflow).toContain('app-id: ${{ vars.JULIUS_GOVERNED_LANDER_APP_ID }}');
    expect(workflow).toContain('vars.JULIUS_GOVERNED_LANDER_BOT_ID');
    expect(workflow).toContain('secrets.JULIUS_GOVERNED_LANDER_PRIVATE_KEY');
    expect(workflow).toContain('github.workflow_ref');
    expect(workflow).toContain('github.workflow_sha');
    expect(workflow).not.toContain('job_workflow_sha');
    expect(workflow).not.toContain('GITHUB_WORKFLOW_SHA:');
    expect(workflow).not.toContain('GITHUB_WORKFLOW_REF:');
    expect(workflow).toContain('permission-statuses: read');
    expect(workflow).not.toContain('permission-administration');
    expect(workflow).toContain('statuses: read');
    const jobIf = workflow.match(/^\s+if:\s+"([^"]+)"/m)?.[1] ?? '';
    const fields = [...jobIf.matchAll(/github\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) expect(['ref', 'workflow_ref', 'workflow_sha', 'sha']).toContain(field);
    const envAbove = (file: string, needle: string) => {
      const text = readFileSync(join(ROOT, file), 'utf8');
      const at = text.indexOf(needle);
      return text.slice(text.lastIndexOf('env:', at), at);
    };
    for (const file of [
      '.github/workflows/julius-governed-land.yml',
      '.github/workflows/julius-accept-main.yml',
      '.github/workflows/julius-land.yml',
    ]) {
      const verifierEnv = envAbove(file, 'node scripts/julius-main-provenance-trust.mjs --require-trusted-verifier');
      expect(verifierEnv).toContain('vars.JULIUS_GOVERNED_LANDER_BOT_ID');
      expect(verifierEnv).toContain('GH_TOKEN: ${{ github.token }}');
    }
    expect(envAbove('.github/workflows/julius-accept-main.yml', 'node scripts/julius-main-provenance.mjs')).toContain('vars.JULIUS_GOVERNED_LANDER_BOT_ID');
    for (const line of ['permission-contents: read', 'permission-pull-requests: read', 'permission-checks: read', 'permission-actions: read', 'permission-metadata: read']) {
      expect(workflow).toContain(line);
    }
    expect(workflow).not.toContain('permission-workflows:');
    expect(workflow).not.toContain('permission-contents: write');
    expect(workflow).not.toContain('JULIUS_LANDER_');
    expect(workflow).not.toContain('5444986');
    expect(source).not.toContain('JULIUS_LANDER_APP_ID');
    expect(source).not.toContain('JULIUS_LANDER_PRIVATE_KEY');
    expect(source).not.toContain('JULIUS_LANDER_TOKEN');
    expect(source).not.toContain('5444986');
    expect(source).toContain('force: false');
    expect(source).not.toContain('force: true');
    expect(source).not.toContain('author: identity');
    expect(source).not.toContain('committer: identity');
    expect(source).not.toContain('matching-refs/julius-governed-audit');
    expect(source).not.toContain('git/ref/julius-governed-audit/');
    expect(source).toContain('git/ref/heads/julius-governed-audit/pr/');
    const patchAt = source.indexOf("'/repos/ohdieyuh-glitch/sunday-relay/git/refs/heads/main'");
    const createAt = source.indexOf('refs/heads/julius-governed-audit/pr/${decision.record.pr}');
    expect(patchAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(patchAt);
    expect(source.match(/JSON\.stringify\(governedCommitBody\(/g)?.length).toBe(2);
    const commitBody = realGoverned.governedCommitBody({ message: 'land', tree: T, parents: [B] });
    expect(commitBody).toEqual({ message: 'land', tree: T, parents: [B] });
    expect(commitBody).not.toHaveProperty('author');
    expect(commitBody).not.toHaveProperty('committer');
    expect(source).toContain('landed, audit finalize failed');
    expect(source).toContain('is not in the governed queue');
    expect(realGoverned.GOVERNED_READ_PERMISSIONS.statuses).toBe('read');
    expect(realGoverned.GOVERNED_READ_PERMISSIONS).not.toHaveProperty('administration');
    expect(realGoverned.GOVERNED_READ_PERMISSIONS.contents).toBe('read');
    expect(realGoverned.GOVERNED_READ_PERMISSIONS).not.toHaveProperty('workflows');
    expect(realGoverned.governedWritePermissions(['src/relay/ordinary.ts'])).not.toHaveProperty('workflows');
    expect(realGoverned.governedWritePermissions(['src/relay/ordinary.ts']).statuses).toBe('read');
    // H1: a workflow path alone never mints workflows:write; both signatures must have verified.
    expect(realGoverned.governedWritePermissions([WORKFLOW])).not.toHaveProperty('workflows');
    expect((realGoverned.governedWritePermissions as (paths: string[], options?: { founderApproved?: boolean }) => Record<string, string>)([WORKFLOW], { founderApproved: true }).workflows).toBe('write');
    const sha = 'a'.repeat(40);
    expect(realGoverned.checkWorkflowOrigin({
      ref: 'refs/heads/main', sha, workflowRef: realGoverned.GOVERNED_WORKFLOW_REF, workflowSha: sha,
    })).toEqual([]);
    expect(realGoverned.checkWorkflowOrigin({
      ref: 'refs/heads/feature', sha, workflowRef: 'other', workflowSha: 'b'.repeat(40),
    }).join('\n')).toMatch(/not refs\/heads\/main/u);
    expect(realGoverned.commitStatusPage({ statuses: [{ state: 'success' }], total_count: 1 }, 200).ok).toBe(true);
    expect(realGoverned.commitStatusPage(null, 403).problem).toMatch(/statuses:read is required/u);
    expect(realGoverned.commitStatusPage({ statuses: [], total_count: 2 }, 200).problem).toMatch(/incomplete/u);
    const app = '5457712';
    const gate = {
      id: 99,
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/m*', 'refs/heads/julius-governed-audit/**/*'], exclude: [] } },
      bypass_actors: [{ actor_type: 'Integration', actor_id: 5457712, bypass_mode: 'always' }],
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'creation' }, { type: 'update' }],
    };
    const live = [
      { type: 'deletion', ruleset_id: 99 },
      { type: 'non_fast_forward', ruleset_id: 99 },
      { type: 'creation', ruleset_id: 99 },
      { type: 'update', ruleset_id: 99 },
    ];
    expect(realGoverned.refPatternMatches('refs/heads/m*', 'refs/heads/main')).toBe(true);
    expect(realGoverned.refPatternMatches('refs/heads/m?', 'refs/heads/main')).toBe(false);
    expect(realGoverned.refPatternMatches('refs/heads/[m]*', 'refs/heads/main')).toBeNull();
    expect(realGoverned.refPatternMatches('~DEFAULT_BRANCH', 'refs/heads/main')).toBe(true);
    expect(realGoverned.refPatternMatches('refs/julius-governed-audit/**', 'refs/julius-governed-audit/pr/1')).toBe(false);
    expect(realGoverned.refPatternMatches('refs/heads/julius-governed-audit/**/*', 'refs/heads/julius-governed-audit/pr/1')).toBe(true);
    expect(realGoverned.refPatternMatches('refs/heads/*', 'refs/heads/julius-governed-audit/pr/1')).toBe(false);
    expect(realGoverned.rulesetCoversRef({ ref_name: { include: ['refs/heads/main'], exclude: ['refs/heads/main'] } }).ok).toBe(false);
    expect(realGoverned.rulesetCoversRef({ ref_name: { include: [], exclude: [] } }).ok).toBe(false);
    expect(realGoverned.rulesetCoversRef({ ref_name: { include: ['refs/heads/[m]*'], exclude: [] } }).problem).toMatch(/cannot be evaluated/u);
    expect(realGoverned.branchRulesProblems(live, gate, app)).toEqual([]);
    expect(realGoverned.branchRulesProblems([...live, { type: 'deletion', ruleset_id: 100, ruleset_source_type: 'Organization' }], gate, app).join('\n')).toMatch(/an active ruleset other than the pinned main ruleset applies to main/u);
    expect(realGoverned.branchRulesProblems(live, { ...gate, rules: [{ type: 'update' }] }, app).join('\n')).toMatch(/does not block deletion, force pushes, creation, and updates/u);
    expect(realGoverned.branchRulesProblems(live, { ...gate, id: null }, app).join('\n')).toMatch(/no pinned ruleset id/u);
    expect(realGoverned.branchRulesProblems(live, gate, '').join('\n')).toMatch(/JULIUS_GOVERNED_LANDER_APP_ID is unset/u);
    expect(realGoverned.branchRulesProblems(live, { ...gate, enforcement: 'evaluate' }, app).join('\n')).toMatch(/not active/u);
    expect(realGoverned.branchRulesProblems(live, {
      ...gate,
      conditions: { ref_name: { include: ['refs/heads/other', 'refs/julius-governed-audit/**'], exclude: [] } },
    }, app).join('\n')).toMatch(/does not cover refs\/heads\/main/u);
    expect(realGoverned.branchRulesProblems(live, {
      ...gate,
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH', 'refs/julius-governed-audit/**'], exclude: [] } },
    }, app).join('\n')).toMatch(/does not cover refs\/heads\/julius-governed-audit/u);
    expect(realGoverned.branchRulesProblems(null, gate, app).join('\n')).toMatch(/could not be read/u);
    expect(realGoverned.branchRulesProblems(live, {
      ...gate,
      bypass_actors: [{ actor_type: 'OrganizationAdmin', actor_id: 1, bypass_mode: 'always' }],
    }, app).join('\n')).toMatch(/only the governed lander app/u);
    const shipped = JSON.parse(readFileSync(join(LANDING, 'main-ruleset.json'), 'utf8')) as {
      id: number;
      conditions: { ref_name: { include: string[] } };
      rules: { type: string }[];
      bypass_actors: { actor_id: number; actor_type: string; bypass_mode: string }[];
    };
    expect(shipped.id).toBe(25792058);
    expect(shipped.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH', 'refs/heads/julius-governed-audit/**/*']);
    expect(shipped.rules.map((rule) => rule.type)).toEqual(['deletion', 'non_fast_forward', 'creation', 'update']);
    expect(shipped.bypass_actors).toEqual([{ actor_id: 5457712, actor_type: 'Integration', bypass_mode: 'always' }]);
    const shippedLive = shipped.rules.map((rule) => ({ type: rule.type, ruleset_id: shipped.id }));
    expect(realGoverned.branchRulesProblems(shippedLive, shipped, app)).toEqual([]);
    expect(realGoverned.branchRulesProblems(shippedLive, { ...shipped, id: null }, app).join('\n')).toMatch(/no pinned ruleset id/u);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = realGoverned.githubAppJwt(app, privateKey, Date.parse('2026-10-24T00:00:00Z'));
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { iss: string; iat: number; exp: number };
    expect(payload.iss).toBe(app);
    expect(payload.exp - payload.iat).toBe(600);
  });
});

describe('eligibility fails closed', () => {
  it('refuses the wrong head, tree, or base', () => {
    expect(problemsOf({ pr: openPr({ head: { sha: OTHER, repo: { full_name: REPO } } }) })).toMatch(new RegExp(`the PR head is ${OTHER}`));
    expect(problemsOf({ commit: { commit: { tree: { sha: OTHER } }, parents: [{ sha: B }] } })).toMatch(new RegExp(`the head tree is ${OTHER}`));
    expect(problemsOf({ mainSha: OTHER })).toMatch(new RegExp(`main is ${OTHER}, the clearance names base ${B}`));
  });

  it('refuses a governed clearance that does not sign the comments-digest rule', () => {
    expect(problemsOf({}, ['landing-method: squash', 'NO-DIGEST-RULE'])).toMatch(/does not sign the comments-digest rule/u);
    expect(realLand.parseClearance(clearance(['landing-method: squash', 'comments-digest: all'])).problems.join('\n')).toMatch(/comments-digest must be excludes-delivery/u);
    expect(parseSignedClearance(clearance(['landing-method: squash', 'comments-digest: all']), REPO).problems.join('\n')).toMatch(/comments-digest must be excludes-delivery/u);
    expect(parseSignedClearance(clearance(['landing-method: squash', DIGEST_RULE]), REPO).problems).toEqual([]);
  });

  it('refuses an expired clearance and a replayed nonce', () => {
    expect(problemsOf({ now: Date.parse('2026-10-24T17:00:01Z') })).toMatch(/the clearance has expired/u);
    expect(problemsOf({ commitMessages: [`Landed earlier\nclearance-nonce: ${NONCE}\n`] })).toMatch(/nonce was already used/u);
    const forgedTag = problemsOf({ nonceTagExists: true, governedLanderBotId: '347502603' });
    expect(forgedTag).toMatch(/already exists and was not created by the governed lander app/u);
    expect(forgedTag).not.toMatch(/already used/u);
    expect(problemsOf({
      nonceTagExists: true,
      nonceTagIdentity: appSigned(347502603),
      governedLanderBotId: '347502603',
    })).toMatch(/already used/u);
    expect(problemsOf({ nonceTagExists: true, governedLanderBotId: '' })).toMatch(/JULIUS_GOVERNED_LANDER_BOT_ID is unset/u);
    expect(problemsOf({ nonceTagExists: true, nonceTagUnreadable: true, governedLanderBotId: '347502603' })).toMatch(/the nonce tag could not be read/u);
    expect(realGoverned.nonceTagProblem({ exists: false })).toBeNull();
  });

  it('refuses an unsigned clearance and a signature from the wrong key', () => {
    expect(realLand.verifyClearanceSignature(clearance(['landing-method: squash']), '', publicPem).join('\n')).toMatch(/not 64 bytes/u);
    expect(realLand.verifyClearanceSignature(clearance(['landing-method: squash']), signWith(clearance(['landing-method: squash'])), publicPem).join('\n')).toMatch(/not the pinned reviewer key/u);
    const text = clearance(['landing-method: squash']);
    expect(problemsOf({ clearanceText: text, signatureB64: '', publicKeyPem: publicPem })).toMatch(/reviewer_signature_missing/u);
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

  it('refuses a governed audit branch as the pull request head or base', () => {
    expect(problemsOf({
      pr: openPr({ head: { sha: H, ref: 'julius-governed-audit/pr/1', repo: { full_name: REPO } } }),
    })).toMatch(/julius-governed-audit\/pr\/1 is a governed audit branch/u);
    expect(problemsOf({
      pr: openPr({ base: { ref: 'refs/heads/julius-governed-audit/pr/1' } }),
    })).toMatch(/refs\/heads\/julius-governed-audit\/pr\/1 is a governed audit branch/u);
    const fields = realLand.parseClearance(clearance(['landing-method: squash'])).fields;
    const historical = realLand.checkPullRequest({
      fields,
      now: NOW,
      pr: {
        ...openPr(),
        user: { login: realLand.APP_LOGIN },
        commits: 1,
        head: { sha: H, ref: 'julius-governed-audit/pr/1', repo: { full_name: REPO } },
      },
      commit: {
        commit: { tree: { sha: T }, author: { name: realLand.APP_LOGIN }, committer: { name: realLand.APP_LOGIN } },
        parents: [{ sha: B }],
        author: { login: realLand.APP_LOGIN },
      },
      files: ['src/relay/ordinary.ts'],
      fileRows: 1,
      mainSha: B,
      allowedBranches: ['julius-governed-audit/pr/1'],
      digest: DIGEST,
    });
    expect(historical.join('\n')).toMatch(/julius-governed-audit\/pr\/1 is a governed audit branch/u);
  });

  it('creates the audit ref after the move and accepts only the same sha on retry', async () => {
    const created = await realGoverned.ensureAuditRef('refs/heads/julius-governed-audit/pr/7', H, {
      create: async () => undefined,
      read: async () => { throw new Error('unread'); },
    });
    expect(created).toEqual({ ok: true });
    const same = await realGoverned.ensureAuditRef('refs/heads/julius-governed-audit/pr/7', H, {
      create: async () => { throw new Error('exists'); },
      read: async () => H,
    });
    expect(same).toEqual({ ok: true, idempotent: true });
    const other = await realGoverned.ensureAuditRef('refs/heads/julius-governed-audit/pr/7', H, {
      create: async () => { throw new Error('exists'); },
      read: async () => OTHER,
    });
    expect(other.ok).toBe(false);
    expect(other.problem).toMatch(new RegExp(`already points at ${OTHER}`));
    const unreadable = await realGoverned.ensureAuditRef('refs/heads/julius-governed-audit/pr/7', H, {
      create: async () => { throw new Error('exists'); },
      read: async () => { throw new Error('gone'); },
    });
    expect(unreadable.problem).toMatch(/could not be created or read/u);
  });

  it('the evidence workflow is read-only and Relay CI covers these pull requests', () => {
    const evidence = readFileSync(join(ROOT, '.github/workflows/julius-governed-evidence.yml'), 'utf8');
    expect(evidence).toContain('pull_request:');
    expect(evidence).toContain('workflow_dispatch:');
    expect(evidence).toContain('contents: read');
    expect(evidence).not.toMatch(/secrets\./u);
    expect(evidence).toContain('GH_TOKEN: ${{ github.token }}');
    expect(evidence).toContain('JULIUS_REVIEWER_KEY_SHA256=${JULIUS_REVIEWER_KEY_SHA256}');
    expect(evidence).toContain('head_sha=');
    expect(evidence).toContain('head_tree=');
    expect(evidence).toContain('bypass_actors may be omitted for a non-admin token');
    expect(evidence).toContain('rulesets?includes_parents=true');
    expect(evidence).toContain('rules/branches/main');
    expect(evidence).toContain('julius-governed-audit/');
    expect(fixtureTrust.TRUSTED_COMPUTING_BASE).not.toContain('.github/workflows/julius-governed-evidence.yml');
    const relay = readFileSync(join(ROOT, '.github/workflows/relay-ci.yml'), 'utf8');
    // The temporary gatekeeper bases are gone: Relay CI runs on pull requests to main only.
    expect(relay).not.toContain('gatekeeper/prov1-review-fixes-20261024');
    expect(relay).not.toContain('gatekeeper/governed-lander-20261024');
    expect(relay).toContain('npm run typecheck');
    expect(relay).toContain('npm test');
    expect(relay).toContain("!startsWith(github.head_ref, 'julius-governed-audit/')");
    const infra = readFileSync(join(ROOT, '.github/workflows/julius-real-infra.yml'), 'utf8');
    expect(infra.match(/!startsWith\(github\.head_ref, 'julius-governed-audit\/'\)/g)?.length).toBe(4);
  });

  it('refuses a dependency that is not on main, a moved base, a draft, and a fast-forward that is not ahead', () => {
    expect(problemsOf({}, ['landing-method: squash', 'depends: 417'])).toMatch(/dependency not on main: 417/u);
    expect(problemsOf({ mainSha: OTHER })).toMatch(/the clearance names base/u);
    expect(problemsOf({ pr: openPr({ draft: true }) }, ['landing-method: squash'])).toMatch(/the pull request is a draft/u);
    expect(problemsOf({ pr: openPr({ draft: undefined }) }, ['landing-method: squash'])).toMatch(/the pull request is a draft/u);
    expect(problemsOf({ fastForward: true }, ['landing-method: fast-forward'])).toMatch(/fast-forward is only for a checkpoint or bootstrap landing/u);
    expect(problemsOf({}, ['landing-method: fast-forward'])).toMatch(/not a fast-forward of the signed base/u);
    expect(problemsOf({}, [])).toMatch(/does not name a landing method/u);
    expect(problemsOf({ files: [WORKFLOW] }, [`protected-paths: ${WORKFLOW}`, 'landing-method: squash'])).toMatch(/paired with a checkpoint attestation/u);
    const multi = fixture.evaluateGovernedLanding(landingInput({
      commit: { commit: { tree: { sha: T } }, parents: [{ sha: OTHER }, { sha: 'e'.repeat(40) }] },
    }));
    expect(multi.ok, multi.problems.join('\n')).toBe(true);
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

  it('fast-forwards a checkpoint diff and refuses an ordinary one', () => {
    const ordinary = fixture.evaluateGovernedLanding(landingInput({ fastForward: true }, ['landing-method: fast-forward']));
    expect(ordinary.ok).toBe(false);
    expect(ordinary.problems.join('\n')).toMatch(/fast-forward is only for a checkpoint or bootstrap landing/u);
    const attestation = `.github/julius-landing/checkpoints/${'e'.repeat(40)}`;
    const files = [`${attestation}.sig`, `${attestation}.txt`, WORKFLOW];
    const decision = fixture.evaluateGovernedLanding(landingInput({
      fastForward: true,
      files,
      pr: openPr({ changed_files: files.length }),
      ...attestationMaterial(),
    }, [`protected-paths: ${files.join(',')}`, 'landing-method: fast-forward']));
    expect(decision.ok, decision.problems.join('\n')).toBe(true);
    expect(decision.method).toBe('fast-forward');
    expect(decision.refUpdate).toEqual({ sha: H, force: false });
    expect(decision.message).toBeNull();
    expect(decision.record?.resultingMainSha).toBe(H);
    const bogus = fixture.evaluateGovernedLanding(landingInput({
      fastForward: true,
      files,
      pr: openPr({ changed_files: files.length }),
      ...attestationMaterial((text) => signWith(text, other.privateKey)),
    }, [`protected-paths: ${files.join(',')}`, 'landing-method: fast-forward']));
    expect(bogus.ok).toBe(false);
    expect(bogus.problems.join('\n')).toMatch(/the checkpoint attestation was not verified/u);
    const staleHashes = attestationMaterial();
    staleHashes.treeHashes[WORKFLOW] = '0'.repeat(64);
    const mismatched = fixture.evaluateGovernedLanding(landingInput({
      fastForward: true,
      files,
      pr: openPr({ changed_files: files.length }),
      ...staleHashes,
    }, [`protected-paths: ${files.join(',')}`, 'landing-method: fast-forward']));
    expect(mismatched.ok).toBe(false);
    expect(mismatched.problems.join('\n')).toMatch(/the checkpoint attestation was not verified/u);
  });

  it('B2: refuses a checkpoint landing whose head would leave a second or stray attestation on main', () => {
    const attestation = `.github/julius-landing/checkpoints/${'e'.repeat(40)}`;
    const files = [`${attestation}.sig`, `${attestation}.txt`, WORKFLOW];
    const landWith = (checkpointNames: string[] | null) => fixture.evaluateGovernedLanding(landingInput({
      fastForward: true,
      files,
      pr: openPr({ changed_files: files.length }),
      ...attestationMaterial(),
      checkpointNames,
    }, [`protected-paths: ${files.join(',')}`, 'landing-method: fast-forward']));
    const stale = '10aedd11643a1d717311b5824d54e863aa94d763';
    const two = landWith([`${'e'.repeat(40)}.founder.sig`, `${'e'.repeat(40)}.sig`, `${'e'.repeat(40)}.txt`, `${stale}.txt`]);
    expect(two.ok).toBe(false);
    expect(two.problems.join('\n')).toMatch(/would be refused: more than one checkpoint attestation is on main/u);
    const stray = landWith([`${'e'.repeat(40)}.founder.sig`, `${'e'.repeat(40)}.sig`, `${'e'.repeat(40)}.txt`, 'notes.md']);
    expect(stray.problems.join('\n')).toMatch(/would be refused: the checkpoint directory holds files that are not this attestation/u);
    expect(landWith(null).ok).toBe(false);
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
    const path = '.github/workflows/not-in-tcb.yml';
    const decision = fixture.evaluateGovernedLanding(landingInput(
      { files: [path] },
      [`protected-paths: ${path}`, 'landing-method: squash'],
    ));
    expect(decision.ok, decision.problems.join('\n')).toBe(true);
    expect(decision.refUpdate?.force).toBe(false);
    expect(decision.record?.status).toBe('pending');
    expect(decision.record?.resultingMainSha).toBe('pending');
  });

  it('refuses a squash whose head does not descend from the signed base', () => {
    const ci = '.github/workflows/ci.yml';
    const decision = fixture.evaluateGovernedLanding(landingInput({
      files: ['src/ok.ts', ci],
      compare: { behind_by: 2, status: 'diverged', ahead_by: 1 },
      pr: openPr({ changed_files: 1 }),
    }, [`protected-paths: ${ci}`, 'landing-method: squash']));
    expect(decision.ok).toBe(false);
    expect(decision.problems.join('\n')).toMatch(/does not descend from the signed base/u);
    expect(decision.problems.join('\n')).not.toMatch(/founder-governed/u);
  });

  it('orders clearances for this head by the signed issued field and ignores other heads', () => {
    const newer = clearance(['landing-method: squash']);
    const older = newer.replace('issued: 2026-10-23T18:00:00Z', 'issued: 2026-10-23T12:00:00Z');
    const otherHead = newer.replace(`head: ${H}`, `head: ${OTHER}`);
    const wrapped = (body: string) => `-----BEGIN JULIUS CLEARANCE-----\n${body}-----END JULIUS CLEARANCE-----\n-----BEGIN JULIUS CLEARANCE SIGNATURE-----\n${signWith(body)}\n-----END JULIUS CLEARANCE SIGNATURE-----`;
    const expected = { head: H, tree: T, base: B };
    const chosen = fixture.chooseClearanceDelivery([
      { body: wrapped(older), created_at: '2026-10-23T21:00:00Z', id: 9 },
      { body: wrapped(newer), created_at: '2026-10-23T18:00:00Z', id: 1 },
      { body: wrapped(otherHead), created_at: '2026-10-23T22:00:00Z', id: 3 },
    ], publicPem, expected);
    expect(chosen.problem).toBeUndefined();
    expect(chosen.delivery?.id).toBe(1);
    const alt = newer.replace(`nonce: ${NONCE}`, `nonce: ${'cd'.repeat(16)}`);
    const conflict = fixture.chooseClearanceDelivery([
      { body: wrapped(newer), created_at: '2026-10-23T18:00:00Z', id: 1 },
      { body: wrapped(alt), created_at: '2026-10-23T19:00:00Z', id: 2 },
    ], publicPem, expected);
    expect(conflict.problem).toMatch(/do not agree/u);
    const ignored = fixture.chooseClearanceDelivery([
      { body: wrapped(otherHead), created_at: '2026-10-23T22:00:00Z', id: 3 },
    ], publicPem, expected);
    expect(ignored.problem).toMatch(/no signed clearance is on the pull request/u);
  });
});

describe('the clearance tree and base bindings each hold on their own (review test gap)', () => {
  const judge = async (tree: string, base: string) => {
    const text = clearance(['landing-method: squash']).replace(`tree: ${T}`, `tree: ${tree}`).replace(`base: ${B}`, `base: ${base}`);
    const built = (await import(pathToFileURL(fixtureLib).href) as {
      buildLandingCommitMessage: (input: { clearanceText: string; signatureB64: string }) => string;
    }).buildLandingCommitMessage({ clearanceText: text, signatureB64: signWith(text) });
    return fixtureTrust.judgeCommitLanding(
      { message: built, committerTime: NOW, tree: T, parent: B, parentCount: 1, paths: ['src/relay/ordinary.ts'] },
      { pem: publicPem, anchor: spki, now: NOW + 1000, seenNonces: new Set<string>() },
    );
  };

  it('accepts the exact tree and base', async () => {
    const ok = await judge(T, B);
    expect(ok.ok, ok.reason).toBe(true);
  });

  it('refuses a signed tree that is not the commit tree, with the base correct', async () => {
    const result = await judge(OTHER, B);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(new RegExp(`the reviewer signed tree ${OTHER}`, 'u'));
    expect(result.reason).not.toMatch(/signed base/u);
  });

  it('refuses a signed base that is not the commit parent, with the tree correct', async () => {
    const result = await judge(T, OTHER);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(new RegExp(`the reviewer signed base ${OTHER}`, 'u'));
    expect(result.reason).not.toMatch(/signed tree/u);
  });
});

describe('H1: a reviewer signature alone does not land a governed path', () => {
  const CI = '.github/workflows/not-in-tcb.yml';
  const governed = [`protected-paths: ${CI}`, 'landing-method: squash'];
  const text = clearance(withRule(governed));
  const decide = (over: Record<string, unknown> = {}) => fixture.evaluateGovernedLanding(landingInput({ files: [CI], clearanceText: text, ...over })) as {
    ok: boolean; problems: string[]; message?: string | null; founderApproved?: boolean;
  };

  it('reviewer-only on a governed path is refused with a distinct reason, and no workflows token follows', () => {
    const refused = decide({ founderSignatures: [] });
    expect(refused.ok).toBe(false);
    expect(refused.problems.join('\n')).toMatch(/founder approval required for \.github\/workflows\/not-in-tcb\.yml: founder approval: founder_signature_missing: no founder-approval signature was supplied/u);
    expect(refused.founderApproved).toBeUndefined();
  });

  it('founder-only is refused: the reviewer signature is still required', () => {
    const founderOnly = decide({ signatureB64: founderSign(text), founderSignatures: [founderSign(text)] });
    expect(founderOnly.ok).toBe(false);
    expect(founderOnly.problems.join('\n')).toMatch(/does not verify|not the pinned reviewer key/u);
  });

  it('both signatures over different bytes are refused', () => {
    const other = text.replace(`nonce: ${NONCE}`, `nonce: ${'cd'.repeat(16)}`);
    const mismatched = decide({ founderSignatures: [founderSign(other)] });
    expect(mismatched.ok).toBe(false);
    expect(mismatched.problems.join('\n')).toMatch(/founder-approval signature does not verify over these exact bytes/u);
    const reviewerAsFounder = decide({ founderSignatures: [signWith(text)] });
    expect(reviewerAsFounder.ok).toBe(false);
  });

  it('both signatures over the same bytes land, and the landing block carries the founder signature', () => {
    const both = decide();
    expect(both.ok, both.problems.join('\n')).toBe(true);
    expect(both.founderApproved).toBe(true);
    expect(both.message).toContain(`founder-signature-b64: ${founderSign(text)}`);
    const parsed = realLand.parseLandingCommitMessage(both.message ?? '') as unknown as { problems: string[]; fields: { founderSignatureB64?: string } };
    expect(parsed.problems).toEqual([]);
    expect(parsed.fields.founderSignatureB64).toBe(founderSign(text));
  });

  it('an ordinary path lands on the reviewer signature alone, as before', () => {
    const ordinary = fixture.evaluateGovernedLanding(landingInput({ founderSignatures: [] })) as { ok: boolean; problems: string[]; founderApproved?: boolean; message?: string | null };
    expect(ordinary.ok, ordinary.problems.join('\n')).toBe(true);
    expect(ordinary.founderApproved).toBe(false);
    expect(ordinary.message).not.toContain('founder-signature-b64');
  });

  it('fails closed on an unset or different anchor, a wrong key file, and in the real tree, where no founder key is pinned', () => {
    expect(decide({ founderAnchor: '' }).problems.join('\n')).toMatch(/JULIUS_FOUNDER_APPROVAL_KEY_SHA256 is unset/u);
    expect(decide({ founderAnchor: spki }).problems.join('\n')).toMatch(/founder_anchor_mismatch: JULIUS_FOUNDER_APPROVAL_KEY_SHA256 does not match/u);
    expect(decide({ founderPublicKeyPem: otherPem }).problems.join('\n')).toMatch(/founder_anchor_mismatch/u);
    const real = realGoverned.evaluateGovernedLanding(landingInput({ files: [CI], clearanceText: text }));
    expect(real.ok).toBe(false);
    for (const path of ['.github/julius-landing/land-lib.mjs', 'scripts/julius-governed-bootstrap.mjs', 'package.json', `.github/julius-landing/checkpoints/${'e'.repeat(40)}.txt`]) {
      expect((realGoverned as unknown as { founderApprovalRequiredPaths: (files: string[], fields: Record<string, string>) => string[] })
        .founderApprovalRequiredPaths([path], {}), path).toEqual([path]);
    }
    expect((realGoverned as unknown as { founderApprovalRequiredPaths: (files: string[], fields: Record<string, string>) => string[] })
      .founderApprovalRequiredPaths(['src/relay/ordinary.ts', 'relay-bridge/x.ts'], {})).toEqual([]);
  });

  it('rotating the founder key needs both old signatures on the clearance; the attestation is checked against the new key', () => {
    const FOUNDER_PATH = '.github/julius-landing/founder-approval-ed25519.pub';
    const next = generateKeyPairSync('ed25519');
    const nextPem = String(next.publicKey.export({ type: 'spki', format: 'pem' }));
    const checkpoint = 'e'.repeat(40);
    const att = `.github/julius-landing/checkpoints/${checkpoint}`;
    const files = [FOUNDER_PATH, `${att}.founder.sig`, `${att}.sig`, `${att}.txt`].sort();
    const tcb = fixtureTrust.TRUSTED_COMPUTING_BASE.map((path) => ({
      path,
      sha256: path === FOUNDER_PATH ? createHash('sha256').update(nextPem, 'utf8').digest('hex') : createHash('sha256').update(path).digest('hex'),
    }));
    const attestation = fixtureTrust.canonicalCheckpointAttestation({
      checkpoint,
      commits: [{ sha: checkpoint, tree: T, basis: 'founder key rotation' }],
      tcb,
      issued: '2026-10-23T18:00:00Z',
      expires: '2027-04-23T18:30:00Z',
    });
    const rotation = clearance(withRule([`protected-paths: ${files.join(',')}`, 'landing-method: fast-forward']));
    const land = (over: Record<string, unknown>) => fixture.evaluateGovernedLanding(landingInput({
      fastForward: true,
      files,
      pr: openPr({ changed_files: files.length }),
      clearanceText: rotation,
      attestationText: attestation,
      attestationSignatureB64: signWith(attestation),
      attestationFounderSignatureB64: signWith(attestation, next.privateKey),
      treeHashes: Object.fromEntries(tcb.map((row) => [row.path, row.sha256])),
      checkpointNames: [`${checkpoint}.founder.sig`, `${checkpoint}.sig`, `${checkpoint}.txt`],
      headFounderPublicKeyPem: nextPem,
      ...over,
    }));
    const accepted = land({ founderSignatures: [founderSign(rotation)] });
    expect(accepted.ok, accepted.problems.join('\n')).toBe(true);
    const newKeyOnly = land({ founderSignatures: [signWith(rotation, next.privateKey)] });
    expect(newKeyOnly.ok).toBe(false);
    expect(newKeyOnly.problems.join('\n')).toMatch(/founder approval required/u);
    const oldKeyAttestation = land({ founderSignatures: [founderSign(rotation)], attestationFounderSignatureB64: founderSign(attestation) });
    expect(oldKeyAttestation.ok).toBe(false);
    expect(oldKeyAttestation.problems.join('\n')).toMatch(/the checkpoint attestation was not verified/u);
    const unbound = land({ founderSignatures: [founderSign(rotation)], headFounderPublicKeyPem: otherPem });
    expect(unbound.problems.join('\n')).toMatch(/rotated founder-approval key is not the blob the attestation hashes/u);
    // After the move the verifier pins the new key only through code constants and
    // JULIUS_FOUNDER_APPROVAL_KEY_SHA256: the old anchor refuses the new file.
    const pin = (fixtureTrust as unknown as { founderKeyPinRefusal: (pem: string, anchor: string) => string | null }).founderKeyPinRefusal;
    expect(pin(nextPem, founderSpki)).toMatch(/founder_anchor_mismatch/u);
    expect(pin(founderPem, founderSpki)).toBeNull();
  });
});

describe('reviewer-tools sign prints the exact signed bytes for the founder', () => {
  it('prints CLEARANCE_B64, CLEARANCE_SHA256 and SIGNATURE_B64 over the same bytes, with the governed lines', () => {
    const keyPath = join(work, 'throwaway-reviewer.pem');
    writeFileSync(keyPath, String(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })));
    const out = execFileSync(process.execPath, [
      join(LANDING, 'reviewer-tools.mjs'), 'sign', keyPath, '7', H, T, B, 'CLEARED', DIGEST, '2',
      '--protected-paths', WORKFLOW, '--landing-method', 'squash', '--depends', '-', '--comments-digest', 'excludes-delivery',
    ], { encoding: 'utf8' });
    rmSync(keyPath, { force: true });
    const value = (name: string) => out.split('\n').find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
    const bytes = Buffer.from(value('CLEARANCE_B64'), 'base64');
    expect(value('CLEARANCE_SHA256')).toBe(createHash('sha256').update(bytes).digest('hex'));
    const text = bytes.toString('utf8');
    expect(realLand.parseClearance(text).problems).toEqual([]);
    expect(text).toContain(`protected-paths: ${WORKFLOW}\nlanding-method: squash\ndepends: -\ncomments-digest: excludes-delivery\n`);
    expect(createPublicKey(publicPem) && verifyBytes(text, value('SIGNATURE_B64'))).toBe(true);
  });
});

describe('H1 as specified by REVIEW: both signatures over identical bytes, distinct refusal codes', () => {
  const CI = '.github/workflows/not-in-tcb.yml';
  const text = clearance(withRule([`protected-paths: ${CI}`, 'landing-method: squash']));
  const decide = (over: Record<string, unknown> = {}) => fixture.evaluateGovernedLanding(landingInput({ files: [CI], clearanceText: text, ...over }));
  const wrapped = (body: string, reviewer: string, founderSig?: string) => `-----BEGIN JULIUS CLEARANCE-----\n${body}-----END JULIUS CLEARANCE-----\n-----BEGIN JULIUS CLEARANCE SIGNATURE-----\n${reviewer}${founderSig === undefined ? '' : `\nfounder-signature-b64: ${founderSig}`}\n-----END JULIUS CLEARANCE SIGNATURE-----`;

  it('refused: reviewer-only (founder_signature_missing)', () => {
    expect(decide({ founderSignatures: [] }).problems.join('\n')).toMatch(/founder_signature_missing/u);
  });

  it('refused: founder-only (reviewer_signature_missing)', () => {
    expect(decide({ signatureB64: '' }).problems.join('\n')).toMatch(/reviewer_signature_missing/u);
    const chosen = fixture.chooseClearanceDelivery([{ body: wrapped(text, '', founderSign(text)), id: 1 }], publicPem, { head: H, tree: T, base: B });
    expect(chosen.problem).toMatch(/^reviewer_signature_missing/u);
  });

  it('refused: both signatures over different bytes (founder_signature_invalid)', () => {
    const other = text.replace(`nonce: ${NONCE}`, `nonce: ${'cd'.repeat(16)}`);
    expect(decide({ founderSignatures: [founderSign(other)] }).problems.join('\n')).toMatch(/founder_signature_invalid/u);
  });

  it('refused: a valid founder signature under an unpinned key (founder_key_unpinned)', () => {
    expect(decide({ founderPublicKeyPem: '' }).problems.join('\n')).toMatch(/founder_key_unpinned/u);
    expect(decide({ founderPublicKeyPem: 'not a key\n' }).problems.join('\n')).toMatch(/founder_key_unpinned/u);
    expect(decide({ founderPublicKeyPem: publicPem, founderSignatures: [signWith(text)], founderAnchor: spki }).problems.join('\n')).toMatch(/founder_key_unpinned: the founder-approval key is the reviewer key/u);
  });

  it('refused: anchor mismatch (founder_anchor_mismatch)', () => {
    expect(decide({ founderAnchor: '0'.repeat(64) }).problems.join('\n')).toMatch(/founder_anchor_mismatch/u);
    expect(decide({ founderAnchor: founderSpki.slice(0, 8) }).problems.join('\n')).toMatch(/founder_anchor_not_sha256/u);
    expect(decide({ founderAnchor: `${founderSpki}\r\n` }).ok).toBe(true);
  });

  it('accepted: both signatures over the same bytes, delivered as the founder-signature-b64 field', () => {
    const chosen = fixture.chooseClearanceDelivery([{ body: wrapped(text, signWith(text), founderSign(text)), id: 1 }], publicPem, { head: H, tree: T, base: B }) as {
      delivery?: { signatureB64: string; founderSignatures?: string[] };
    };
    expect(chosen.delivery?.founderSignatures).toEqual([founderSign(text)]);
    const both = decide({ signatureB64: chosen.delivery?.signatureB64, founderSignatures: chosen.delivery?.founderSignatures });
    expect(both.ok, both.problems.join('\n')).toBe(true);
  });

  it('the ordinary path stays reviewer-only', () => {
    const ordinary = fixture.evaluateGovernedLanding(landingInput({ founderSignatures: [], founderPublicKeyPem: '' }));
    expect(ordinary.ok, ordinary.problems.join('\n')).toBe(true);
  });
});

describe('REVIEW batch 2 on the lander', () => {
  it('PRACTICAL: a failing non-required status (Vercel) does not block; a failing required one still does', () => {
    const vercel = [{ context: 'Vercel', state: 'failure' }, { context: 'Vercel Preview Comments', state: 'error' }];
    const ok = fixture.evaluateGovernedLanding(landingInput({ statuses: vercel }));
    expect(ok.ok, ok.problems.join('\n')).toBe(true);
    const required = fixture.evaluateGovernedLanding(landingInput({ statuses: [{ context: 'Verify Relay', state: 'failure' }] }));
    expect(required.ok).toBe(false);
    expect(required.problems.join('\n')).toMatch(/status "Verify Relay" is failure/u);
    const historical = (realLand as unknown as { checkCi: (input: Record<string, unknown>) => string[] }).checkCi({
      checkRuns: [{ name: 'Verify Relay', status: 'completed', conclusion: 'success', app: { id: 15368 } }],
      statuses: vercel,
      self: 'x',
      required: [{ name: 'Verify Relay', appId: 15368 }],
    });
    expect(historical.join('\n')).toMatch(/status "Vercel" is failure/u);
  });

  const checkpoint = 'e'.repeat(40);
  const att = `.github/julius-landing/checkpoints/${checkpoint}`;
  const material = (over: { prior?: string; keySpkiSha256?: string; reviewerSigner?: typeof pair.privateKey; reviewerPathPem?: string } = {}) => {
    const tcb = fixtureTrust.TRUSTED_COMPUTING_BASE.map((path) => ({
      path,
      sha256: path === '.github/julius-landing/reviewer-ed25519.pub' && over.reviewerPathPem
        ? createHash('sha256').update(over.reviewerPathPem, 'utf8').digest('hex')
        : createHash('sha256').update(path).digest('hex'),
    }));
    const text = fixtureTrust.canonicalCheckpointAttestation({
      checkpoint,
      commits: [{ sha: checkpoint, tree: T, basis: 'batch 2' }],
      tcb,
      issued: '2026-10-23T18:00:00Z',
      expires: '2027-01-20T18:00:00Z',
      ...(over.prior ? { prior: over.prior } : {}),
      ...(over.keySpkiSha256 ? { keySpkiSha256: over.keySpkiSha256 } : {}),
    });
    return {
      attestationText: text,
      attestationSignatureB64: signWith(text, over.reviewerSigner ?? pair.privateKey),
      attestationFounderSignatureB64: founderSign(text),
      treeHashes: Object.fromEntries(tcb.map((row) => [row.path, row.sha256])),
      checkpointNames: [`${checkpoint}.founder.sig`, `${checkpoint}.sig`, `${checkpoint}.txt`],
    };
  };

  it('M2: a checkpoint refresh may name main\'s current checkpoint as its prior', () => {
    const PREV = '6'.repeat(40);
    const files = [`${att}.founder.sig`, `${att}.sig`, `${att}.txt`];
    const land = (over: Record<string, unknown>) => fixture.evaluateGovernedLanding(landingInput({
      fastForward: true, files, pr: openPr({ changed_files: files.length }), ...material({ prior: PREV }), ...over,
    }, [`protected-paths: ${files.join(',')}`, 'landing-method: fast-forward']));
    const ok = land({ mainCheckpoint: PREV });
    expect(ok.ok, ok.problems.join('\n')).toBe(true);
    expect(land({}).problems.join('\n')).toMatch(/prior is not the trusted checkpoint/u);
    expect(land({ mainCheckpoint: OTHER }).problems.join('\n')).toMatch(/prior is not the trusted checkpoint/u);
  });

  it('M1: the lander rotates the reviewer key with both current signatures; the attestation names and is signed by the new key', () => {
    const PUB = '.github/julius-landing/reviewer-ed25519.pub';
    const next = generateKeyPairSync('ed25519');
    const nextPem = String(next.publicKey.export({ type: 'spki', format: 'pem' }));
    const nextSpki = createHash('sha256').update(Buffer.from(next.publicKey.export({ type: 'spki', format: 'der' }))).digest('hex');
    const files = [PUB, `${att}.founder.sig`, `${att}.sig`, `${att}.txt`].sort();
    const text = clearance(withRule([`protected-paths: ${files.join(',')}`, 'landing-method: fast-forward']));
    const land = (over: Record<string, unknown>) => fixture.evaluateGovernedLanding(landingInput({
      fastForward: true, files, pr: openPr({ changed_files: files.length }), clearanceText: text, headPublicKeyPem: nextPem, ...over,
    }));
    const rotated = land({ ...material({ keySpkiSha256: nextSpki, reviewerSigner: next.privateKey, reviewerPathPem: nextPem }) });
    expect(rotated.ok, rotated.problems.join('\n')).toBe(true);
    // The attestation signed by the outgoing key, or naming it, would lock the verifier after the move.
    expect(land({ ...material({ keySpkiSha256: nextSpki, reviewerPathPem: nextPem }) }).ok).toBe(false);
    expect(land({ ...material({ reviewerSigner: next.privateKey, reviewerPathPem: nextPem }) }).ok).toBe(false);
    // The clearance must be signed by the current reviewer key: the new key alone is refused.
    expect(land({ ...material({ keySpkiSha256: nextSpki, reviewerSigner: next.privateKey, reviewerPathPem: nextPem }), signatureB64: signWith(text, next.privateKey) }).ok).toBe(false);
    // And by the current founder key.
    expect(land({ ...material({ keySpkiSha256: nextSpki, reviewerSigner: next.privateKey, reviewerPathPem: nextPem }), founderSignatures: [] }).problems.join('\n')).toMatch(/founder_signature_missing/u);
  });

  it('L6: a protected-paths entry on an ordinary path needs the governed App and the founder in the walk too', async () => {
    const path = 'src/relay/ordinary.ts';
    const text = clearance([`protected-paths: ${path}`, 'landing-method: squash']);
    const built = (await import(pathToFileURL(fixtureLib).href) as {
      buildLandingCommitMessage: (input: { clearanceText: string; signatureB64: string }) => string;
    }).buildLandingCommitMessage({ clearanceText: text, signatureB64: signWith(text) });
    const judged = await fixtureTrust.judgeCommitLanding(
      { message: built, committerTime: NOW, tree: T, parent: B, parentCount: 1, paths: [path] },
      { pem: publicPem, anchor: spki, now: NOW + 1000, seenNonces: new Set<string>(), governedLanderBotId: '424242' },
    );
    expect(judged.ok).toBe(false);
    expect(judged.reason).toMatch(/governed lander bot|founder approval|no GitHub-verified signature/u);
  });
});

describe('IDENTITY: the same App-signed rule in nonce tags, audits, the walk and the single-tip check', () => {
  const fixtures = JSON.parse(readFileSync(join(ROOT, 'scripts/julius-landing-identity-fixtures.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  const fields = (name: string) => (fixtureTrust as unknown as { commitIdentityFields: (body: unknown) => Record<string, unknown> }).commitIdentityFields(fixtures[name]);

  it('a nonce tag counts as spent only when its target is App-signed', () => {
    const spent = realGoverned.nonceTagProblem({ exists: true, nonce: NONCE, identity: fields('appSignedConstructed'), botId: '347502603' });
    expect(spent).toMatch(/already used/u);
    for (const name of ['spoofBotUnsigned', 'userTokenUnsigned', 'webUiHuman']) {
      expect(realGoverned.nonceTagProblem({ exists: true, nonce: NONCE, identity: fields(name), botId: '347502603' }), name).toMatch(/was not created by the governed lander app/u);
    }
  });

  it('an audit counts only when its commit is App-signed', () => {
    const record = realGoverned.formatLandingRecord({ pr: 7, head: H, tree: T, base: B, clearanceDigest: DIGEST, checkRunIds: [1], resultingMainSha: OTHER, method: 'squash' });
    expect([...realGoverned.landedPullsFromAudits([{ sha: OTHER, message: record, ...fields('appSignedConstructed') }], OTHER, () => true, '347502603')]).toEqual([7]);
    for (const name of ['spoofBotUnsigned', 'userTokenUnsigned', 'webUiHuman']) {
      expect([...realGoverned.landedPullsFromAudits([{ sha: OTHER, message: record, ...fields(name) }], OTHER, () => true, '347502603')], name).toEqual([]);
    }
  });

  it('the walk accepts a protected landing only from the App-signed shape', async () => {
    const text = clearance([`protected-paths: ${WORKFLOW}`, 'landing-method: squash']);
    const built = (await import(pathToFileURL(fixtureLib).href) as {
      buildLandingCommitMessage: (input: { clearanceText: string; signatureB64: string; founderSignatureB64?: string }) => string;
    }).buildLandingCommitMessage({ clearanceText: text, signatureB64: signWith(text), founderSignatureB64: founderSign(text) });
    const commit = { message: built, committerTime: NOW, tree: T, parent: B, parentCount: 1, headTree: T, headParentCount: 2, paths: [WORKFLOW] };
    const options = { pem: publicPem, anchor: spki, now: NOW + 1000, governedLanderBotId: '347502603', founderPem, founderAnchor: founderSpki };
    const ok = await fixtureTrust.judgeCommitLanding({ ...commit, ...fields('appSignedConstructed') }, { ...options, seenNonces: new Set<string>() });
    expect(ok.ok, ok.reason).toBe(true);
    for (const name of ['spoofBotUnsigned', 'userTokenUnsigned', 'webUiHuman']) {
      const refused = await fixtureTrust.judgeCommitLanding({ ...commit, ...fields(name) }, { ...options, seenNonces: new Set<string>() });
      expect(refused.ok, name).toBe(false);
    }
  });

  it('the single-tip check refuses the spoof shape for a governed path', () => {
    const tip = { mainSha: OTHER, mainTreeSha: T, parentSha: B };
    const text = clearance([`protected-paths: ${WORKFLOW}`, 'landing-method: squash']);
    const input = {
      repo: REPO,
      mainCommitMessage: `Landed PR #7 (${H.slice(0, 12)})\n\n${block(text)}\n`,
      reviewerKeyPem: publicPem, reviewerKeyAtSha: B, tipReviewerKeyPem: publicPem,
      changedPaths: [WORKFLOW], changedPathsComplete: true,
      headCommit: { sha: H, treeSha: T },
      governedLanderBotId: '347502603',
    };
    for (const name of ['spoofBotUnsigned', 'userTokenUnsigned', 'webUiHuman']) {
      const result = evaluateSignedLanding({ ...input, landingIdentity: fields(name) } as never, tip);
      expect(result.state, name).toBe('decided');
      if (result.state !== 'decided') continue;
      expect(result.result.verdict, name).toBe('unprovenanced');
      expect(result.result.reason, name).toMatch(/no GitHub-verified signature|author is not the governed lander bot/u);
    }
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

  it('L-2: a protected-paths entry on an ORDINARY path still needs the governed lander here, as in the walk', () => {
    // Nothing in the change is hard-forbidden or TCB: only the clearance's protected-paths entry makes
    // this a governed landing. Without that rule a hand push with this clearance would be accepted.
    const text = clearance(['protected-paths: src/relay/ordinary.ts', 'landing-method: squash']);
    const pushed = evaluateSignedLanding(signedInput(text, { changedPaths: ['src/relay/ordinary.ts'] }), tip);
    expect(pushed.state).toBe('decided');
    if (pushed.state !== 'decided') return;
    expect(pushed.result.verdict).toBe('unprovenanced');
    expect(pushed.result.reason).toMatch(/JULIUS_GOVERNED_LANDER_BOT_ID is unset|governed lander/u);
  });

  it('a governed clearance skips the worker check and still dies on the real pin after the path check', () => {
    const text = clearance([`protected-paths: ${WORKFLOW}`, 'landing-method: squash']);
    const handPushed = evaluateSignedLanding(signedInput(text, { changedPaths: [WORKFLOW] }), tip);
    expect(handPushed.state).toBe('decided');
    if (handPushed.state !== 'decided') return;
    expect(handPushed.result.verdict).toBe('unprovenanced');
    expect(handPushed.result.reason).toMatch(/JULIUS_GOVERNED_LANDER_BOT_ID is unset/u);
    expect(handPushed.result.prNumber).toBeUndefined();
    const acceptedShape = evaluateSignedLanding(signedInput(text, {
      changedPaths: [WORKFLOW],
      landingIdentity: appSigned(424242),
      governedLanderBotId: '424242',
    }), tip);
    expect(acceptedShape.state).toBe('decided');
    if (acceptedShape.state !== 'decided') return;
    expect(acceptedShape.result.verdict).toBe('unprovenanced');
    // H1: with the App committer verified, the real tree still refuses: no founder-approval key is pinned.
    expect(acceptedShape.result.reason).toMatch(/founder approval: founder_signature_missing/u);
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
      buildLandingCommitMessage: (input: { clearanceText: string; signatureB64: string; founderSignatureB64?: string }) => string;
    }).buildLandingCommitMessage({ clearanceText: text, signatureB64: signWith(text), founderSignatureB64: founderSign(text) });
    const commit = {
      message: built,
      committerTime: NOW,
      tree: T,
      parent: B,
      parentCount: 1,
      headTree: T,
      headParentCount: 2,
      paths: [WORKFLOW],
      ...appSigned(424242),
    };
    const seen = new Set<string>();
    const bot = { governedLanderBotId: '424242' };
    Object.assign(bot, { founderPem, founderAnchor: founderSpki });
    const ok = await fixtureTrust.judgeCommitLanding(commit, { pem: publicPem, anchor: spki, now: NOW + 1000, seenNonces: seen, ...bot });
    expect(ok.ok, ok.reason).toBe(true);
    expect(seen.has(NONCE)).toBe(true);
    const previousBot = process.env.JULIUS_GOVERNED_LANDER_BOT_ID;
    delete process.env.JULIUS_GOVERNED_LANDER_BOT_ID;
    const unset = await fixtureTrust.judgeCommitLanding(commit, { pem: publicPem, anchor: spki, now: NOW, seenNonces: new Set<string>() });
    expect(unset.ok).toBe(false);
    expect(unset.reason).toMatch(/JULIUS_GOVERNED_LANDER_BOT_ID is unset/u);
    if (previousBot === undefined) delete process.env.JULIUS_GOVERNED_LANDER_BOT_ID;
    else process.env.JULIUS_GOVERNED_LANDER_BOT_ID = previousBot;
    const hand = await fixtureTrust.judgeCommitLanding(
      { ...commit, authorId: 111 },
      { pem: publicPem, anchor: spki, now: Date.parse('2026-10-25T00:00:00Z'), seenNonces: new Set<string>(), ...bot },
    );
    expect(hand.ok).toBe(false);
    expect(hand.reason).toMatch(/not the governed lander bot 424242/u);
    expect(hand.reason).not.toMatch(/expired/u);
    const unsigned = await fixtureTrust.judgeCommitLanding(
      { ...commit, verificationVerified: false, verificationReason: 'unsigned' },
      { pem: publicPem, anchor: spki, now: Date.parse('2026-10-25T00:00:00Z'), seenNonces: new Set<string>(), ...bot },
    );
    expect(unsigned.ok).toBe(false);
    expect(unsigned.reason).toMatch(/no GitHub-verified signature/u);

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

void appSignedBody;
