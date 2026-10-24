/**
 * Liveness of the signed checkpoint attestation.
 *
 * The committed tree has no reviewer signature. These cases copy the trust
 * module, rewrite its pin constants to a throwaway key, and build a git
 * history the founder installer would produce: a checkpoint commit, then the
 * attestation and its signature, then a normal signed landing. The real
 * module is not rewritten.
 */
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PINNED_REVIEWER_RAW_KEY, PINNED_REVIEWER_SPKI_SHA256, TRUSTED_COMPUTING_BASE } from './julius-main-provenance-trust.mjs';

const ROOT = join(import.meta.dirname, '..');
const NOW = Date.parse('2026-10-23T18:30:00Z');
const home = mkdtempSync(join(tmpdir(), 'julius-liveness-home-'));
const gitEnv = {
  ...process.env,
  HOME: home,
  GIT_AUTHOR_NAME: 'Liveness',
  GIT_AUTHOR_EMAIL: 'liveness@example.com',
  GIT_COMMITTER_NAME: 'Liveness',
  GIT_COMMITTER_EMAIL: 'liveness@example.com',
  GIT_AUTHOR_DATE: '2026-10-23T18:30:00Z',
  GIT_COMMITTER_DATE: '2026-10-23T18:30:00Z',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
};

const pair = generateKeyPairSync('ed25519');
const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const der = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }));
const spki = createHash('sha256').update(der).digest('hex');
const raw = der.subarray(der.length - 32).toString('hex');
const attacker = generateKeyPairSync('ed25519');
const attackerPem = attacker.publicKey.export({ type: 'spki', format: 'pem' }).toString();

type TrustModule = {
  ATTESTATION_EXPIRES: string;
  ATTESTATION_ISSUED: string;
  CHECKPOINT_ATTESTATION_DIR: string;
  EXTERNAL_ANCHOR_VARIABLE: string;
  INSTALLER_RECOVERY: string;
  TRUSTED_COMPUTING_BASE: readonly string[];
  attestationWorktreeMatchesHead: (root?: string) => Promise<{ ok: boolean; reason: string }>;
  canonicalCheckpointAttestation: (fields?: Record<string, unknown>) => string;
  requireTrustedVerifier: (env?: NodeJS.ProcessEnv, options?: {
    root?: string;
    now?: number;
    identities?: Record<string, { committerId?: number; verificationVerified?: boolean; verificationReason?: string }>;
  }) => Promise<{ ok: boolean; reason: string }>;
  annotateChainLandings: (
    commits: Array<Record<string, unknown>>,
    options: { pem: string; anchor: string; now: number },
  ) => Promise<Array<{ signedLanding?: boolean; sha?: string }>>;
  evaluateTrustChain: (input: Record<string, unknown>) => { accepted: boolean; tipProvenant: boolean; reason: string };
};

let base = '';
let mod: TrustModule;

const git = (repo: string, args: string[], extra: Record<string, string> = {}) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Liveness', '-c', 'user.email=liveness@example.com', ...args], {
  cwd: repo,
  env: { ...gitEnv, ...extra },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

function landingMessage(clearance: string, signatureB64: string) {
  return [
    'Julius: liveness',
    '',
    '-----BEGIN JULIUS LANDING-----',
    'v: 1',
    `clearance-nonce: ${'ab'.repeat(16)}`,
    `clearance-b64: ${Buffer.from(clearance, 'utf8').toString('base64')}`,
    `signature-b64: ${signatureB64}`,
    '-----END JULIUS LANDING-----',
    '',
  ].join('\n');
}

function signText(text: string, key = pair.privateKey) {
  return sign(null, Buffer.from(text, 'utf8'), key).toString('base64');
}

async function landingBuilder() {
  // land-lib.mjs has no declaration file. Import it by URL, as the other provenance tests do.
  const loaded = (await import(new URL('../.github/julius-landing/land-lib.mjs', import.meta.url).href)) as {
    buildLandingCommitMessage: (input: { clearanceText: string; signatureB64: string }) => string;
  };
  return loaded.buildLandingCommitMessage;
}

async function buildFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'julius-liveness-'));
  const rewritten = readFileSync(join(ROOT, 'scripts/julius-main-provenance-trust.mjs'), 'utf8')
    .replaceAll(PINNED_REVIEWER_SPKI_SHA256, spki)
    .replaceAll(PINNED_REVIEWER_RAW_KEY, raw);
  for (const rel of TRUSTED_COMPUTING_BASE) {
    mkdirSync(join(repo, dirname(rel)), { recursive: true });
    cpSync(join(ROOT, rel), join(repo, rel));
  }
  writeFileSync(join(repo, 'scripts/julius-main-provenance-trust.mjs'), rewritten);
  writeFileSync(join(repo, '.github/julius-landing/reviewer-ed25519.pub'), publicPem);
  git(repo, ['init', '-b', 'main']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'checkpoint']);
  const loaded = await import(pathToFileURL(join(repo, 'scripts/julius-main-provenance-trust.mjs')).href) as TrustModule;
  const sha = git(repo, ['rev-parse', 'HEAD']).trim();
  const tree = git(repo, ['rev-parse', 'HEAD^{tree}']).trim();
  const tcb = loaded.TRUSTED_COMPUTING_BASE.map((path) => ({
    path,
    sha256: createHash('sha256').update(readFileSync(join(repo, path))).digest('hex'),
  }));
  const text = loaded.canonicalCheckpointAttestation({
    checkpoint: sha,
    commits: [{ sha, tree, basis: 'liveness fixture checkpoint' }],
    tcb,
    issued: loaded.ATTESTATION_ISSUED,
    expires: loaded.ATTESTATION_EXPIRES,
  });
  const signature = signText(text);
  const dir = join(repo, loaded.CHECKPOINT_ATTESTATION_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sha}.txt`), text);
  writeFileSync(join(dir, `${sha}.sig`), `${signature}\n`);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'installer-1 attestation']);
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/note.txt'), 'subsequent\n');
  git(repo, ['add', 'src/note.txt']);
  const landingTree = git(repo, ['write-tree']).trim();
  const parent = git(repo, ['rev-parse', 'HEAD']).trim();
  const head = git(repo, ['commit-tree', landingTree, '-p', parent, '-m', 'reviewed head']).trim();
  const nonce = 'ab'.repeat(16);
  const clearance = [
    'JULIUS-CLEARANCE-V1',
    'repo: ohdieyuh-glitch/sunday-relay',
    'pr: 381',
    `head: ${head}`,
    `tree: ${landingTree}`,
    `base: ${parent}`,
    'kind: CLEARED',
    `bot-comments-sha256: ${'c'.repeat(64)}`,
    'governed-exceptions: -',
    `nonce: ${nonce}`,
    'by: INDEPENDENT_REVIEW',
    'issued: 2026-10-23T18:00:00Z',
    'expires: 2026-10-24T18:00:00Z',
    '',
  ].join('\n');
  const buildLandingCommitMessage = await landingBuilder();
  const message = buildLandingCommitMessage({ clearanceText: clearance, signatureB64: signText(clearance) });
  const messagePath = join(repo, '.git/liveness-message.txt');
  writeFileSync(messagePath, message);
  git(repo, ['commit', '-F', messagePath]);
  return { repo, mod: loaded, env: { [loaded.EXTERNAL_ANCHOR_VARIABLE]: spki } };
}

function copyFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'julius-liveness-copy-'));
  cpSync(base, repo, { recursive: true });
  return repo;
}

beforeAll(async () => {
  const built = await buildFixture();
  base = built.repo;
  mod = built.mod;
}, 30_000);

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  if (base) rmSync(base, { recursive: true, force: true });
});

describe('signed checkpoint liveness', () => {
  const gate = (repo: string, env: NodeJS.ProcessEnv = { [mod.EXTERNAL_ANCHOR_VARIABLE]: spki }, now = NOW) =>
    mod.requireTrustedVerifier(env, { root: repo, now });

  it('the land gate and the accept-main gate pass for a subsequent signed landing', async () => {
    const verifier = await gate(base);
    expect(verifier.ok, verifier.reason).toBe(true);
    expect(verifier.reason).toContain('chain verified from attested checkpoint');
    const integrity = await mod.attestationWorktreeMatchesHead(base);
    expect(integrity.ok, integrity.reason).toBe(true);
  });

  it('after one protected landing by the App, the verifiers still accept main', async () => {
    const repo = copyFixture();
    mkdirSync(join(repo, '.github/workflows'), { recursive: true });
    writeFileSync(join(repo, '.github/workflows/ci.yml'), 'name: ci\n');
    git(repo, ['add', '.github/workflows/ci.yml']);
    const landingTree = git(repo, ['write-tree']).trim();
    const parent = git(repo, ['rev-parse', 'HEAD']).trim();
    const head = git(repo, ['commit-tree', landingTree, '-p', parent, '-m', 'reviewed head']).trim();
    const clearance = [
      'JULIUS-CLEARANCE-V1',
      'repo: ohdieyuh-glitch/sunday-relay',
      'pr: 452',
      `head: ${head}`,
      `tree: ${landingTree}`,
      `base: ${parent}`,
      'kind: CLEARED',
      `bot-comments-sha256: ${'c'.repeat(64)}`,
      'governed-exceptions: -',
      `nonce: ${'cd'.repeat(16)}`,
      'by: INDEPENDENT_REVIEW',
      'issued: 2026-10-23T18:00:00Z',
      'expires: 2026-10-24T18:00:00Z',
      'protected-paths: .github/workflows/ci.yml',
      'landing-method: squash',
      '',
    ].join('\n');
    const buildLandingCommitMessage = await landingBuilder();
    const message = buildLandingCommitMessage({ clearanceText: clearance, signatureB64: signText(clearance) });
    const messagePath = join(repo, '.git/protected-message.txt');
    writeFileSync(messagePath, message);
    git(repo, ['commit', '-F', messagePath]);
    const landingSha = git(repo, ['rev-parse', 'HEAD']).trim();
    const identities = {
      [landingSha]: { committerId: 347502603, verificationVerified: true as const, verificationReason: 'valid' },
    };
    const previousBot = process.env.JULIUS_GOVERNED_LANDER_BOT_ID;
    delete process.env.JULIUS_GOVERNED_LANDER_BOT_ID;
    try {
      for (const file of [
        '.github/workflows/julius-governed-land.yml',
        '.github/workflows/julius-accept-main.yml',
        '.github/workflows/julius-land.yml',
      ]) {
        expect(readFileSync(join(repo, file), 'utf8')).toContain('JULIUS_GOVERNED_LANDER_BOT_ID: ${{ vars.JULIUS_GOVERNED_LANDER_BOT_ID }}');
      }
      const missing = await mod.requireTrustedVerifier(
        { [mod.EXTERNAL_ANCHOR_VARIABLE]: spki },
        { root: repo, now: NOW, identities },
      );
      expect(missing.ok, missing.reason).toBe(false);
      expect(missing.reason).toMatch(/JULIUS_GOVERNED_LANDER_BOT_ID is unset/u);
      const accepted = await mod.requireTrustedVerifier(
        { [mod.EXTERNAL_ANCHOR_VARIABLE]: spki, JULIUS_GOVERNED_LANDER_BOT_ID: '347502603' },
        { root: repo, now: NOW, identities },
      );
      expect(accepted.ok, accepted.reason).toBe(true);
      const provenance = (await import(pathToFileURL(join(base, 'scripts/julius-main-provenance.mjs')).href)) as {
        evaluateMainProvenance: (input: Record<string, unknown>) => { verdict: string; reason: string };
      };
      const fields = {
        repo: 'ohdieyuh-glitch/sunday-relay',
        mainSha: landingSha,
        mainShaAfter: landingSha,
        mainTreeSha: landingTree,
        mainParents: [parent],
        mainCommitMessage: message,
        reviewerKeyPem: publicPem,
        reviewerKeyAtSha: parent,
        tipReviewerKeyPem: publicPem,
        changedPaths: ['.github/workflows/ci.yml'],
        changedPathsComplete: true,
        headCommit: { sha: head, authorLogin: 'not-the-coding-worker', treeSha: landingTree },
        landingCommitterId: 347502603,
        landingVerificationVerified: true,
        landingVerificationReason: 'valid',
        externalReviewerKeySha256: spki,
      };
      const proved = provenance.evaluateMainProvenance({ ...fields, governedLanderBotId: '347502603' });
      expect(proved.verdict, proved.reason).toBe('provenant');
      const unset = provenance.evaluateMainProvenance(fields);
      expect(unset.verdict, unset.reason).toBe('unprovenanced');
      expect(unset.reason).toMatch(/JULIUS_GOVERNED_LANDER_BOT_ID is unset/u);
    } finally {
      if (previousBot === undefined) delete process.env.JULIUS_GOVERNED_LANDER_BOT_ID;
      else process.env.JULIUS_GOVERNED_LANDER_BOT_ID = previousBot;
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('the same tree without the attestation fails closed', async () => {
    const repo = copyFixture();
    rmSync(join(repo, mod.CHECKPOINT_ATTESTATION_DIR), { recursive: true, force: true });
    const result = await gate(repo);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(mod.INSTALLER_RECOVERY);
    rmSync(repo, { recursive: true, force: true });
  });

  it('an unsigned attestation fails closed and an env signature does not replace the file', async () => {
    const repo = copyFixture();
    const dir = join(repo, mod.CHECKPOINT_ATTESTATION_DIR);
    for (const name of readdirSync(dir)) if (name.endsWith('.sig')) rmSync(join(dir, name));
    const result = await gate(repo, {
      [mod.EXTERNAL_ANCHOR_VARIABLE]: spki,
      JULIUS_CHECKPOINT_ATTESTATIONS: 'JULIUS-CHECKPOINT-V1\n',
      JULIUS_CHECKPOINT_ATTESTATION_SIGNATURE: signText('nope'),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('unsigned');
    expect(result.reason).toContain(mod.INSTALLER_RECOVERY);
    rmSync(repo, { recursive: true, force: true });
  });

  it('refuses an expired attestation, one that is not yet valid, and a 2020 attestation', async () => {
    const cases = [
      { issued: '2026-10-01T00:00:00Z', expires: '2026-10-02T00:00:00Z', now: NOW, reason: 'expired' },
      { issued: '2027-01-01T00:00:00Z', expires: '2027-06-01T00:00:00Z', now: NOW, reason: 'not yet valid' },
      { issued: '2020-01-01T00:00:00Z', expires: '2020-01-02T00:00:00Z', now: NOW, reason: 'expired' },
    ];
    for (const item of cases) {
      const repo = copyFixture();
      const dir = join(repo, mod.CHECKPOINT_ATTESTATION_DIR);
      const fileName = readdirSync(dir).find((name) => name.endsWith('.txt'))!;
      const current = readFileSync(join(dir, fileName), 'utf8');
      const next = current
        .replace(/^issued: .*$/mu, `issued: ${item.issued}`)
        .replace(/^expires: .*$/mu, `expires: ${item.expires}`);
      writeFileSync(join(dir, fileName), next);
      writeFileSync(join(dir, fileName.replace(/\.txt$/u, '.sig')), `${signText(next)}\n`);
      const result = await gate(repo, { [mod.EXTERNAL_ANCHOR_VARIABLE]: spki }, item.now);
      expect(result.ok, item.reason).toBe(false);
      expect(result.reason, item.reason).toContain(item.reason);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('refuses a prefix anchor, a padded prefix, uppercase, and a forged signature', async () => {
    for (const anchor of [spki.slice(0, 8), `${spki.slice(0, 8)}${'0'.repeat(56)}`, spki.toUpperCase()]) {
      const result = await gate(base, { [mod.EXTERNAL_ANCHOR_VARIABLE]: anchor });
      expect(result.ok, anchor).toBe(false);
      expect(result.reason, anchor).toContain('does not match');
    }
    const repo = copyFixture();
    const dir = join(repo, mod.CHECKPOINT_ATTESTATION_DIR);
    const sigName = readdirSync(dir).find((name) => name.endsWith('.sig'))!;
    writeFileSync(join(dir, sigName), `${Buffer.alloc(64, 4).toString('base64')}\n`);
    const forged = await gate(repo);
    expect(forged.ok).toBe(false);
    expect(forged.reason).toContain('does not verify');
    rmSync(repo, { recursive: true, force: true });
  });

  it('a tree with a swapped attestation fails accept-main', async () => {
    const repo = copyFixture();
    const dir = join(repo, mod.CHECKPOINT_ATTESTATION_DIR);
    const fileName = readdirSync(dir).find((name) => name.endsWith('.txt'))!;
    const rel = `${mod.CHECKPOINT_ATTESTATION_DIR}/${fileName}`;
    writeFileSync(join(repo, rel), `${readFileSync(join(repo, rel), 'utf8')}swapped\n`);
    const dirty = await mod.attestationWorktreeMatchesHead(repo);
    expect(dirty.ok).toBe(false);
    expect(dirty.reason).toContain('swapped');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'swap the attestation']);
    const committed = await gate(repo);
    expect(committed.ok).toBe(false);
    expect(committed.reason).not.toContain('chain verified');
    rmSync(repo, { recursive: true, force: true });
  });

  it('refuses a commit after the checkpoint when the chain does not justify it', async () => {
    const repo = copyFixture();
    writeFileSync(join(repo, 'src/other.txt'), 'direct\n');
    git(repo, ['add', 'src/other.txt']);
    git(repo, ['commit', '-m', 'hand push']);
    const result = await gate(repo);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('does not justify');
    rmSync(repo, { recursive: true, force: true });
  });

  it('rejects an expired clearance for a different pull request on a direct src push', async () => {
    const repo = copyFixture();
    const buildLandingCommitMessage = await landingBuilder();
    const other = '9'.repeat(40);
    const text = [
      'JULIUS-CLEARANCE-V1',
      'repo: ohdieyuh-glitch/sunday-relay',
      'pr: 9',
      `head: ${other}`,
      `tree: ${other}`,
      `base: ${other}`,
      'kind: CLEARED',
      `bot-comments-sha256: ${'c'.repeat(64)}`,
      'governed-exceptions: -',
      `nonce: ${'cd'.repeat(16)}`,
      'by: INDEPENDENT_REVIEW',
      'issued: 2020-01-01T00:00:00Z',
      'expires: 2020-01-02T00:00:00Z',
      '',
    ].join('\n');
    const message = buildLandingCommitMessage({ clearanceText: text, signatureB64: signText(text) });
    writeFileSync(join(repo, 'src/attack.txt'), 'direct push\n');
    const messagePath = join(repo, '.git/attack-message.txt');
    writeFileSync(messagePath, message);
    git(repo, ['add', 'src/attack.txt']);
    git(repo, ['commit', '-F', messagePath]);
    const result = await gate(repo);
    expect(result.ok, result.reason).toBe(false);
    expect(result.reason).toMatch(/expired|signed tree|signed base|clearance/u);
    expect(result.reason).not.toContain('chain verified');
    rmSync(repo, { recursive: true, force: true });
  });

  it('rejects a live clearance signed for a different tree, base, and pull request', async () => {
    const repo = copyFixture();
    const buildLandingCommitMessage = await landingBuilder();
    const other = '8'.repeat(40);
    const text = [
      'JULIUS-CLEARANCE-V1',
      'repo: ohdieyuh-glitch/sunday-relay',
      'pr: 9',
      `head: ${other}`,
      `tree: ${other}`,
      `base: ${other}`,
      'kind: CLEARED',
      `bot-comments-sha256: ${'c'.repeat(64)}`,
      'governed-exceptions: -',
      `nonce: ${'12'.repeat(16)}`,
      'by: INDEPENDENT_REVIEW',
      'issued: 2026-10-23T18:00:00Z',
      'expires: 2026-10-24T18:00:00Z',
      '',
    ].join('\n');
    writeFileSync(join(repo, 'src/mismatch.txt'), 'other review\n');
    const messagePath = join(repo, '.git/mismatch-message.txt');
    writeFileSync(messagePath, buildLandingCommitMessage({ clearanceText: text, signatureB64: signText(text) }));
    git(repo, ['add', 'src/mismatch.txt']);
    git(repo, ['commit', '-F', messagePath]);
    const result = await gate(repo);
    expect(result.ok, result.reason).toBe(false);
    expect(result.reason).toMatch(/signed tree|signed base/u);
    expect(result.reason).toContain('pull request #9');
    expect(result.reason).not.toContain('chain verified');
    rmSync(repo, { recursive: true, force: true });
  });

  it('a depth-1 checkout with a remote verifies, and a checkout with no history fails closed', async () => {
    const remote = copyFixture();
    const shallow = mkdtempSync(join(tmpdir(), 'julius-shallow-'));
    execFileSync('git', ['clone', '--depth', '1', `file://${remote}`, shallow], {
      env: gitEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const deepened = await gate(shallow);
    expect(deepened.ok, deepened.reason).toBe(true);

    const stranded = mkdtempSync(join(tmpdir(), 'julius-stranded-'));
    execFileSync('git', ['clone', '--depth', '1', `file://${remote}`, stranded], {
      env: gitEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    git(stranded, ['remote', 'remove', 'origin']);
    const missing = await gate(stranded);
    expect(missing.ok).toBe(false);
    expect(missing.reason).toMatch(/history is missing/u);
    expect(missing.reason).not.toMatch(/does not reach the trusted checkpoint/u);
    rmSync(remote, { recursive: true, force: true });
    rmSync(shallow, { recursive: true, force: true });
    rmSync(stranded, { recursive: true, force: true });
  });

  it('the checkpoint and installer commits cover this branch without landing blocks', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'julius-installer-lineage-'));
    for (const rel of mod.TRUSTED_COMPUTING_BASE) {
      mkdirSync(join(repo, dirname(rel)), { recursive: true });
      cpSync(join(base, rel), join(repo, rel));
    }
    git(repo, ['init', '-b', 'main']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'checkpoint']);
    const checkpoint = git(repo, ['rev-parse', 'HEAD']).trim();
    const tree = git(repo, ['rev-parse', 'HEAD^{tree}']).trim();
    mkdirSync(join(repo, '.github/julius-landing'), { recursive: true });
    mkdirSync(join(repo, 'docs/provenance'), { recursive: true });
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    writeFileSync(join(repo, '.github/julius-landing/README.md'), 'installer readme\n');
    writeFileSync(join(repo, 'docs/provenance/checkpoint-2528ac5c-f539cab2.unsigned.txt'), 'historical\n');
    writeFileSync(join(repo, 'scripts/julius-landing.test.ts'), 'test\n');
    writeFileSync(join(repo, 'scripts/julius-main-provenance-signed.test.ts'), 'test\n');
    writeFileSync(join(repo, 'scripts/julius-main-provenance-trust-liveness.test.ts'), 'test\n');
    writeFileSync(join(repo, 'scripts/julius-main-provenance-trust.test.ts'), 'test\n');
    const tcb = mod.TRUSTED_COMPUTING_BASE.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(join(repo, path))).digest('hex'),
    }));
    const text = mod.canonicalCheckpointAttestation({
      checkpoint,
      commits: [{ sha: checkpoint, tree, basis: 'installer lineage' }],
      tcb,
      issued: mod.ATTESTATION_ISSUED,
      expires: mod.ATTESTATION_EXPIRES,
    });
    const dir = join(repo, mod.CHECKPOINT_ATTESTATION_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${checkpoint}.txt`), text);
    writeFileSync(join(dir, `${checkpoint}.sig`), `${signText(text)}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'founder installer companions and attestation']);
    const installed = await gate(repo);
    expect(installed.ok, installed.reason).toBe(true);
    writeFileSync(join(repo, 'scripts/julius-main-provenance-trust.test.ts'), 'test\nlater\n');
    git(repo, ['add', 'scripts/julius-main-provenance-trust.test.ts']);
    git(repo, ['commit', '-m', 'installer follow-up touches only the trust test']);
    const result = await gate(repo);
    expect(result.ok, result.reason).toBe(false);

    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/ride-along.ts'), 'no\n');
    git(repo, ['add', 'src/ride-along.ts']);
    git(repo, ['commit', '-m', 'arbitrary code must not ride along']);
    const ridden = await gate(repo);
    expect(ridden.ok, ridden.reason).toBe(false);
    rmSync(repo, { recursive: true, force: true });
  });

  it('rejects a pinned signature that is not a JULIUS-CLEARANCE-V1 clearance, and an expired clearance that does bind', async () => {
    const buildLandingCommitMessage = await landingBuilder();
    const loose = copyFixture();
    writeFileSync(join(loose, 'src/loose.txt'), 'signed blob\n');
    const loosePath = join(loose, '.git/loose-message.txt');
    writeFileSync(loosePath, landingMessage('not-a-clearance', signText('not-a-clearance')));
    git(loose, ['add', 'src/loose.txt']);
    git(loose, ['commit', '-F', loosePath]);
    const looseResult = await gate(loose);
    expect(looseResult.ok, looseResult.reason).toBe(false);
    expect(looseResult.reason).toMatch(/JULIUS-CLEARANCE-V1/u);

    const bound = copyFixture();
    const parent = git(bound, ['rev-parse', 'HEAD']).trim();
    writeFileSync(join(bound, 'src/bound.txt'), 'expired but bound\n');
    git(bound, ['add', 'src/bound.txt']);
    const tree = git(bound, ['write-tree']).trim();
    const head = git(bound, ['commit-tree', tree, '-p', parent, '-m', 'reviewed head']).trim();
    const text = [
      'JULIUS-CLEARANCE-V1',
      'repo: ohdieyuh-glitch/sunday-relay',
      'pr: 381',
      `head: ${head}`,
      `tree: ${tree}`,
      `base: ${parent}`,
      'kind: CLEARED',
      `bot-comments-sha256: ${'c'.repeat(64)}`,
      'governed-exceptions: -',
      `nonce: ${'ef'.repeat(16)}`,
      'by: INDEPENDENT_REVIEW',
      'issued: 2020-01-01T00:00:00Z',
      'expires: 2020-01-01T12:00:00Z',
      '',
    ].join('\n');
    const boundPath = join(bound, '.git/bound-message.txt');
    writeFileSync(boundPath, buildLandingCommitMessage({ clearanceText: text, signatureB64: signText(text) }));
    git(bound, ['commit', '-F', boundPath]);
    const boundResult = await gate(bound);
    expect(boundResult.ok, boundResult.reason).toBe(false);
    expect(boundResult.reason).toContain('expired');
    rmSync(loose, { recursive: true, force: true });
    rmSync(bound, { recursive: true, force: true });
  });

  it('a rename of arbitrary code onto an installer path is not an installer commit', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'julius-rename-'));
    for (const rel of mod.TRUSTED_COMPUTING_BASE) {
      mkdirSync(join(repo, dirname(rel)), { recursive: true });
      cpSync(join(base, rel), join(repo, rel));
    }
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/evil.ts'), 'ride\n');
    git(repo, ['init', '-b', 'main']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'checkpoint']);
    const checkpoint = git(repo, ['rev-parse', 'HEAD']).trim();
    const tree = git(repo, ['rev-parse', 'HEAD^{tree}']).trim();
    git(repo, ['mv', 'src/evil.ts', 'scripts/julius-main-provenance-trust.test.ts']);
    const tcb = mod.TRUSTED_COMPUTING_BASE.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(join(repo, path))).digest('hex'),
    }));
    const text = mod.canonicalCheckpointAttestation({
      checkpoint,
      commits: [{ sha: checkpoint, tree, basis: 'rename must not ride along' }],
      tcb,
      issued: mod.ATTESTATION_ISSUED,
      expires: mod.ATTESTATION_EXPIRES,
    });
    const dir = join(repo, mod.CHECKPOINT_ATTESTATION_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${checkpoint}.txt`), text);
    writeFileSync(join(dir, `${checkpoint}.sig`), `${signText(text)}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'rename arbitrary code onto an installer path']);
    const result = await gate(repo);
    expect(result.ok, result.reason).toBe(false);
    expect(result.reason).not.toContain('chain verified');
    rmSync(repo, { recursive: true, force: true });
  });

  it('verifies every landing on the chain, not only the newest commit', async () => {
    const annotate = mod.annotateChainLandings;
    expect(typeof annotate).toBe('function');
    const parent = '2'.repeat(40);
    const older = 'a'.repeat(40);
    const newer = 'b'.repeat(40);
    const olderTree = 'c'.repeat(40);
    const newerTree = 'd'.repeat(40);
    const clearanceFor = (tree: string, base: string, nonce: string) => [
      'JULIUS-CLEARANCE-V1',
      'repo: ohdieyuh-glitch/sunday-relay',
      'pr: 381',
      `head: ${'e'.repeat(40)}`,
      `tree: ${tree}`,
      `base: ${base}`,
      'kind: CLEARED',
      `bot-comments-sha256: ${'c'.repeat(64)}`,
      'governed-exceptions: -',
      `nonce: ${nonce}`,
      'by: INDEPENDENT_REVIEW',
      'issued: 2026-10-23T12:00:00Z',
      'expires: 2026-10-24T12:00:00Z',
      '',
    ].join('\n');
    const blockFor = (text: string) => landingMessage(text, signText(text)).replace(`clearance-nonce: ${'ab'.repeat(16)}`, `clearance-nonce: ${text.match(/nonce: ([0-9a-f]{32})/u)?.[1] ?? ''}`);
    const olderText = clearanceFor(olderTree, parent, '11'.repeat(16));
    const newerText = clearanceFor(newerTree, older, '22'.repeat(16));
    const landedAt = NOW;
    const commits = [
      { sha: older, tree: olderTree, parent, message: blockFor(olderText), paths: ['src/older.ts'], committerTime: landedAt },
      { sha: newer, tree: newerTree, parent: older, message: blockFor(newerText), paths: ['src/newer.ts'], committerTime: landedAt },
    ];
    const annotated = await annotate(commits, { pem: publicPem, anchor: spki, now: NOW });
    expect(annotated[0]?.signedLanding, 'older landing').toBe(true);
    expect(annotated[1]?.signedLanding, 'newer landing').toBe(true);
    const replayText = clearanceFor('1'.repeat(40), newer, '22'.repeat(16));
    const replayed = await annotate([
      ...commits,
      { sha: 'f'.repeat(40), tree: '1'.repeat(40), parent: newer, message: blockFor(replayText), paths: ['src/replay.ts'], committerTime: landedAt },
    ], { pem: publicPem, anchor: spki, now: NOW });
    expect(replayed[2]?.signedLanding).not.toBe(true);
    const chain = mod.evaluateTrustChain({
      tipSha: newer,
      tipTree: newerTree,
      commits: annotated,
      reviewerKeyPem: publicPem,
      externalAnchor: spki,
      now: NOW,
    });
    expect(chain?.accepted, chain?.reason).toBe(true);
    expect(chain?.tipProvenant).toBe(true);
  });

  it('refuses a verifier-only change, and a verifier plus attestation signed by another key', async () => {
    const only = copyFixture();
    writeFileSync(join(only, 'scripts/julius-main-provenance-trust.mjs'), `${readFileSync(join(only, 'scripts/julius-main-provenance-trust.mjs'), 'utf8')}\n`, { flag: 'a' });
    const onlyResult = await gate(only);
    expect(onlyResult.ok).toBe(false);
    expect(onlyResult.reason).toContain('scripts/julius-main-provenance-trust.mjs');
    expect(onlyResult.reason).toContain('not the attested trusted-file hash');

    const both = copyFixture();
    writeFileSync(join(both, 'scripts/julius-main-provenance-trust.mjs'), `${readFileSync(join(both, 'scripts/julius-main-provenance-trust.mjs'), 'utf8')}\n// swapped\n`);
    writeFileSync(join(both, '.github/julius-landing/reviewer-ed25519.pub'), attackerPem);
    const checkpoint = git(both, ['rev-parse', 'HEAD~2']).trim();
    const tree = git(both, ['rev-parse', `${checkpoint}^{tree}`]).trim();
    const tcb = mod.TRUSTED_COMPUTING_BASE.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(join(both, path))).digest('hex'),
    }));
    const text = mod.canonicalCheckpointAttestation({
      checkpoint,
      commits: [{ sha: checkpoint, tree, basis: 'altered verifier and attestation' }],
      tcb,
    });
    const dir = join(both, mod.CHECKPOINT_ATTESTATION_DIR);
    writeFileSync(join(dir, `${checkpoint}.txt`), text);
    writeFileSync(join(dir, `${checkpoint}.sig`), `${signText(text, attacker.privateKey)}\n`);
    const attackerResult = await gate(both);
    expect(attackerResult.ok).toBe(false);
    expect(attackerResult.reason).toContain('not the pinned reviewer key');

    const stale = copyFixture();
    const staleDir = join(stale, mod.CHECKPOINT_ATTESTATION_DIR);
    const previous = readFileSync(join(staleDir, `${checkpoint}.sig`), 'utf8');
    writeFileSync(join(stale, 'scripts/julius-main-provenance-trust.mjs'), `${readFileSync(join(stale, 'scripts/julius-main-provenance-trust.mjs'), 'utf8')}\n// again\n`);
    const staleTcb = mod.TRUSTED_COMPUTING_BASE.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(join(stale, path))).digest('hex'),
    }));
    const staleText = mod.canonicalCheckpointAttestation({
      checkpoint,
      commits: [{ sha: checkpoint, tree, basis: 'altered verifier, old signature' }],
      tcb: staleTcb,
    });
    writeFileSync(join(staleDir, `${checkpoint}.txt`), staleText);
    writeFileSync(join(staleDir, `${checkpoint}.sig`), previous);
    const staleResult = await gate(stale);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.reason).toContain('does not verify');
    rmSync(only, { recursive: true, force: true });
    rmSync(both, { recursive: true, force: true });
    rmSync(stale, { recursive: true, force: true });
  });

  it('keeps landings that were inside their window when committed, and refuses a new expired landing', async () => {
    const repo = copyFixture();
    const buildLandingCommitMessage = await landingBuilder();
    const later = Date.parse('2026-10-24T19:30:00Z');
    writeFileSync(join(repo, 'src/second.txt'), 'second landing\n');
    git(repo, ['add', 'src/second.txt']);
    const parent = git(repo, ['rev-parse', 'HEAD']).trim();
    const tree = git(repo, ['write-tree']).trim();
    const head = git(repo, ['commit-tree', tree, '-p', parent, '-m', 'reviewed head']).trim();
    const text = [
      'JULIUS-CLEARANCE-V1',
      'repo: ohdieyuh-glitch/sunday-relay',
      'pr: 381',
      `head: ${head}`,
      `tree: ${tree}`,
      `base: ${parent}`,
      'kind: CLEARED',
      `bot-comments-sha256: ${'c'.repeat(64)}`,
      'governed-exceptions: -',
      `nonce: ${'44'.repeat(16)}`,
      'by: INDEPENDENT_REVIEW',
      'issued: 2026-10-23T18:00:00Z',
      'expires: 2026-10-24T18:00:00Z',
      '',
    ].join('\n');
    const messagePath = join(repo, '.git/second-message.txt');
    writeFileSync(messagePath, buildLandingCommitMessage({ clearanceText: text, signatureB64: signText(text) }));
    git(repo, ['commit', '-F', messagePath]);
    const aged = await gate(repo, { [mod.EXTERNAL_ANCHOR_VARIABLE]: spki }, later);
    expect(aged.ok, aged.reason).toBe(true);
    expect(aged.reason).not.toMatch(/expired/u);

    writeFileSync(join(repo, 'src/late.txt'), 'new landing after expiry\n');
    git(repo, ['add', 'src/late.txt']);
    const lateParent = git(repo, ['rev-parse', 'HEAD']).trim();
    const lateTree = git(repo, ['write-tree']).trim();
    const lateWhen = '2026-10-24T19:30:00Z';
    const lateHead = git(repo, ['commit-tree', lateTree, '-p', lateParent, '-m', 'late head'], {
      GIT_AUTHOR_DATE: lateWhen,
      GIT_COMMITTER_DATE: lateWhen,
    }).trim();
    const lateText = [
      'JULIUS-CLEARANCE-V1',
      'repo: ohdieyuh-glitch/sunday-relay',
      'pr: 382',
      `head: ${lateHead}`,
      `tree: ${lateTree}`,
      `base: ${lateParent}`,
      'kind: CLEARED',
      `bot-comments-sha256: ${'c'.repeat(64)}`,
      'governed-exceptions: -',
      `nonce: ${'55'.repeat(16)}`,
      'by: INDEPENDENT_REVIEW',
      'issued: 2026-10-23T18:00:00Z',
      'expires: 2026-10-24T18:00:00Z',
      '',
    ].join('\n');
    const latePath = join(repo, '.git/late-message.txt');
    writeFileSync(latePath, buildLandingCommitMessage({ clearanceText: lateText, signatureB64: signText(lateText) }));
    git(repo, ['commit', '-F', latePath], { GIT_AUTHOR_DATE: lateWhen, GIT_COMMITTER_DATE: lateWhen });
    const fresh = await gate(repo, { [mod.EXTERNAL_ANCHOR_VARIABLE]: spki }, later);
    expect(fresh.ok, fresh.reason).toBe(false);
    expect(fresh.reason).toContain('expired');
    rmSync(repo, { recursive: true, force: true });
  });

  it('refuses a companion-only commit after the signed installer', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'julius-installer-after-sig-'));
    for (const rel of mod.TRUSTED_COMPUTING_BASE) {
      mkdirSync(join(repo, dirname(rel)), { recursive: true });
      cpSync(join(base, rel), join(repo, rel));
    }
    git(repo, ['init', '-b', 'main']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'checkpoint']);
    const checkpoint = git(repo, ['rev-parse', 'HEAD']).trim();
    const tree = git(repo, ['rev-parse', 'HEAD^{tree}']).trim();
    mkdirSync(join(repo, '.github/julius-landing'), { recursive: true });
    const tcb = mod.TRUSTED_COMPUTING_BASE.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(join(repo, path))).digest('hex'),
    }));
    const text = mod.canonicalCheckpointAttestation({
      checkpoint,
      commits: [{ sha: checkpoint, tree, basis: 'signed installer' }],
      tcb,
      issued: mod.ATTESTATION_ISSUED,
      expires: mod.ATTESTATION_EXPIRES,
    });
    const dir = join(repo, mod.CHECKPOINT_ATTESTATION_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${checkpoint}.txt`), text);
    writeFileSync(join(dir, `${checkpoint}.sig`), `${signText(text)}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'founder installer with signature']);
    const installed = await gate(repo);
    expect(installed.ok, installed.reason).toBe(true);
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    writeFileSync(join(repo, 'scripts/julius-main-provenance-trust.test.ts'), 'weakened\n');
    git(repo, ['add', 'scripts/julius-main-provenance-trust.test.ts']);
    git(repo, ['commit', '-m', 'unsigned edit of a companion test']);
    const weakened = await gate(repo);
    expect(weakened.ok, weakened.reason).toBe(false);
    expect(weakened.reason).not.toContain('chain verified');
    rmSync(repo, { recursive: true, force: true });
  });

  it('an unsigned installer block does not burn a nonce a later landing needs', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'julius-nonce-burn-'));
    for (const rel of mod.TRUSTED_COMPUTING_BASE) {
      mkdirSync(join(repo, dirname(rel)), { recursive: true });
      cpSync(join(base, rel), join(repo, rel));
    }
    git(repo, ['init', '-b', 'main']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'checkpoint']);
    const checkpoint = git(repo, ['rev-parse', 'HEAD']).trim();
    const tree = git(repo, ['rev-parse', 'HEAD^{tree}']).trim();
    const buildLandingCommitMessage = await landingBuilder();
    const burned = '66'.repeat(16);
    const fake = [
      'JULIUS-CLEARANCE-V1',
      'repo: ohdieyuh-glitch/sunday-relay',
      'pr: 381',
      `head: ${'a'.repeat(40)}`,
      `tree: ${'b'.repeat(40)}`,
      `base: ${checkpoint}`,
      'kind: CLEARED',
      `bot-comments-sha256: ${'c'.repeat(64)}`,
      'governed-exceptions: -',
      `nonce: ${burned}`,
      'by: INDEPENDENT_REVIEW',
      'issued: 2026-10-23T18:00:00Z',
      'expires: 2026-10-24T18:00:00Z',
      '',
    ].join('\n');
    const tcb = mod.TRUSTED_COMPUTING_BASE.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(join(repo, path))).digest('hex'),
    }));
    const text = mod.canonicalCheckpointAttestation({
      checkpoint,
      commits: [{ sha: checkpoint, tree, basis: 'installer burns nothing' }],
      tcb,
      issued: mod.ATTESTATION_ISSUED,
      expires: mod.ATTESTATION_EXPIRES,
    });
    const dir = join(repo, mod.CHECKPOINT_ATTESTATION_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${checkpoint}.txt`), text);
    writeFileSync(join(dir, `${checkpoint}.sig`), `${signText(text)}\n`);
    const fakePath = join(repo, '.git/fake-installer-message.txt');
    writeFileSync(fakePath, buildLandingCommitMessage({ clearanceText: fake, signatureB64: signText(fake, attacker.privateKey) }));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-F', fakePath]);
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/real.txt'), 'real landing\n');
    git(repo, ['add', 'src/real.txt']);
    const parent = git(repo, ['rev-parse', 'HEAD']).trim();
    const landingTree = git(repo, ['write-tree']).trim();
    const head = git(repo, ['commit-tree', landingTree, '-p', parent, '-m', 'reviewed head']).trim();
    const real = [
      'JULIUS-CLEARANCE-V1',
      'repo: ohdieyuh-glitch/sunday-relay',
      'pr: 381',
      `head: ${head}`,
      `tree: ${landingTree}`,
      `base: ${parent}`,
      'kind: CLEARED',
      `bot-comments-sha256: ${'c'.repeat(64)}`,
      'governed-exceptions: -',
      `nonce: ${burned}`,
      'by: INDEPENDENT_REVIEW',
      'issued: 2026-10-23T18:00:00Z',
      'expires: 2026-10-24T18:00:00Z',
      '',
    ].join('\n');
    const realPath = join(repo, '.git/real-landing-message.txt');
    writeFileSync(realPath, buildLandingCommitMessage({ clearanceText: real, signatureB64: signText(real) }));
    git(repo, ['commit', '-F', realPath]);
    const result = await gate(repo);
    expect(result.ok, result.reason).toBe(true);
    expect(result.reason).not.toMatch(/already used/u);
    rmSync(repo, { recursive: true, force: true });
  });

  it('a walk longer than 30 commits fails closed instead of verifying', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'julius-walk-cap-'));
    for (const rel of mod.TRUSTED_COMPUTING_BASE) {
      mkdirSync(join(repo, dirname(rel)), { recursive: true });
      cpSync(join(base, rel), join(repo, rel));
    }
    git(repo, ['init', '-b', 'main']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'checkpoint']);
    const checkpoint = git(repo, ['rev-parse', 'HEAD']).trim();
    const tree = git(repo, ['rev-parse', 'HEAD^{tree}']).trim();
    const tcb = mod.TRUSTED_COMPUTING_BASE.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(join(repo, path))).digest('hex'),
    }));
    const text = mod.canonicalCheckpointAttestation({
      checkpoint,
      commits: [{ sha: checkpoint, tree, basis: 'walk cap' }],
      tcb,
      issued: mod.ATTESTATION_ISSUED,
      expires: mod.ATTESTATION_EXPIRES,
    });
    const dir = join(repo, mod.CHECKPOINT_ATTESTATION_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${checkpoint}.txt`), text);
    writeFileSync(join(dir, `${checkpoint}.sig`), `${signText(text)}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'founder installer with signature']);
    for (let i = 0; i < 30; i += 1) git(repo, ['commit', '--allow-empty', '-m', `pad ${i}`]);
    const result = await gate(repo);
    expect(result.ok, result.reason).toBe(false);
    expect(result.reason).toMatch(/stopped after 30 commits/u);
    expect(result.reason).not.toContain('chain verified');
    rmSync(repo, { recursive: true, force: true });
  });
});
