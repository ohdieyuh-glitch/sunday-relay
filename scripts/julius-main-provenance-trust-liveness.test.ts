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
  requireTrustedVerifier: (env?: NodeJS.ProcessEnv, options?: { root?: string; now?: number }) => Promise<{ ok: boolean; reason: string }>;
};

let base = '';
let mod: TrustModule;

const git = (repo: string, args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Liveness', '-c', 'user.email=liveness@example.com', ...args], {
  cwd: repo,
  env: gitEnv,
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
  const clearance = 'liveness-clearance';
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/note.txt'), 'subsequent\n');
  const message = landingMessage(clearance, signText(clearance));
  const messagePath = join(repo, '.git/liveness-message.txt');
  writeFileSync(messagePath, message);
  git(repo, ['add', 'src/note.txt']);
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
});
