/**
 * One-shot bootstrap. The real reviewer key is not in this checkout, so the
 * passing cases run against a copy whose pin constants are a throwaway
 * ed25519 key. Dry-run is the default. There is no re-enable flag.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { PINNED_REVIEWER_RAW_KEY, PINNED_REVIEWER_SPKI_SHA256, TRUSTED_COMPUTING_BASE } from './julius-main-provenance-trust.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'ohdieyuh-glitch/sunday-relay';
const MAIN = '1'.repeat(40);
const TARGET = '2'.repeat(40);
const TREE = '3'.repeat(40);
const OTHER = '4'.repeat(40);
const INSTALLER = '5'.repeat(40);
const TOKEN = 'ghs_bootstrap_test_token_9f3a';
const APP = '5457712';
const BOT = '347502603';
const NOW = Date.parse('2026-10-23T18:30:00Z');
const ISSUED = '2026-10-23T18:00:00Z';
const EXPIRES = '2026-10-24T17:00:00Z';

const pair = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const otherPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const der = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }));
const spki = createHash('sha256').update(der).digest('hex');
const raw = der.subarray(der.length - 32).toString('hex');
const signWith = (text: string) => sign(null, Buffer.from(text, 'utf8'), pair.privateKey).toString('base64');

const work = mkdtempSync(join(tmpdir(), 'julius-governed-bootstrap-'));
const fixtureRoot = join(work, 'repo');
afterAll(() => rmSync(work, { recursive: true, force: true }));
mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true });
mkdirSync(join(fixtureRoot, '.github/julius-landing'), { recursive: true });
for (const rel of [
  'scripts/julius-governed-bootstrap.mjs',
  'scripts/julius-main-provenance-trust.mjs',
  '.github/julius-landing/governed-land.mjs',
  '.github/julius-landing/land-lib.mjs',
  '.github/julius-landing/main-ruleset.json',
]) {
  cpSync(join(ROOT, rel), join(fixtureRoot, rel));
}
const rewritePins = (rel: string) => {
  const path = join(fixtureRoot, rel);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replaceAll(PINNED_REVIEWER_SPKI_SHA256, spki)
    .replaceAll(PINNED_REVIEWER_RAW_KEY, raw));
};
rewritePins('scripts/julius-main-provenance-trust.mjs');
rewritePins('.github/julius-landing/land-lib.mjs');
writeFileSync(join(fixtureRoot, '.github/julius-landing/reviewer-ed25519.pub'), publicPem);

function fileBytes(rel: string) {
  const local = join(fixtureRoot, rel);
  return readFileSync(existsSync(local) ? local : join(ROOT, rel));
}

const snapshot = JSON.parse(fileBytes('.github/julius-landing/main-ruleset.json').toString('utf8')) as {
  id: number;
  rules: { type: string; parameters?: unknown }[];
};
const liveRules = snapshot.rules.map((rule) => ({ type: rule.type, ruleset_id: snapshot.id, parameters: rule.parameters }));
const tcb = TRUSTED_COMPUTING_BASE.map((path) => ({
  path,
  sha256: createHash('sha256').update(fileBytes(path)).digest('hex'),
}));
const treeHashes = Object.fromEntries(tcb.map((row) => [row.path, row.sha256]));

type Boot = {
  BOOTSTRAP_MAX_WINDOW_MS: number;
  INSTALLER_COMMIT_MESSAGE: string;
  evaluateGovernedBootstrap: (input: Record<string, unknown>) => { ok: boolean; problems: string[] };
  runBootstrap: (options: {
    argv?: string[];
    env?: NodeJS.ProcessEnv;
    request?: (path: string, init: { method: string; body?: string; token: string }) => Promise<{ status: number; body: unknown }>;
    readFile?: (path: string) => string;
    now?: number;
  }) => Promise<{ ok: boolean; execute: boolean; problems: string[]; record: string | null }>;
};

const boot = (await import(pathToFileURL(join(fixtureRoot, 'scripts/julius-governed-bootstrap.mjs')).href)) as Boot;
const trust = (await import(pathToFileURL(join(fixtureRoot, 'scripts/julius-main-provenance-trust.mjs')).href)) as {
  canonicalCheckpointAttestation: (fields?: Record<string, unknown>) => string;
  TRUSTED_COMPUTING_BASE: readonly string[];
};

function attest(over: { checkpoint?: string; tree?: string; issued?: string; expires?: string; nonce?: string } = {}) {
  const checkpoint = over.checkpoint ?? TARGET;
  const tree = over.tree ?? TREE;
  const text = trust.canonicalCheckpointAttestation({
    checkpoint,
    commits: [{ sha: checkpoint, tree, basis: 'governed bootstrap test' }],
    tcb,
    issued: over.issued ?? ISSUED,
    expires: over.expires ?? EXPIRES,
    ...(over.nonce ? { nonce: over.nonce } : {}),
  });
  return { text, signature: signWith(text) };
}

const signed = attest();

function good(over: Record<string, unknown> = {}) {
  return {
    expectedMainSha: MAIN,
    mainSha: MAIN,
    targetSha: TARGET,
    targetTree: TREE,
    compare: { behind_by: 0, status: 'ahead', ahead_by: 1 },
    publicKeyPem: publicPem,
    externalAnchor: spki,
    attestationText: signed.text,
    attestationSignatureB64: signed.signature,
    treeHashes,
    snapshot,
    snapshotSha256: treeHashes['.github/julius-landing/main-ruleset.json'],
    publicKeySha256: treeHashes['.github/julius-landing/reviewer-ed25519.pub'],
    liveRules,
    appId: APP,
    botId: BOT,
    now: NOW,
    ...over,
  };
}

const problems = (over: Record<string, unknown> = {}) => boot.evaluateGovernedBootstrap(good(over)).problems.join('\n');

describe('the bootstrap decision fails closed', () => {
  it('accepts a descendant target bound by a short signed attestation', () => {
    const decision = boot.evaluateGovernedBootstrap(good());
    expect(decision.ok, decision.problems.join('\n')).toBe(true);
    expect(boot.BOOTSTRAP_MAX_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('refuses a bad expected sha, a moved main, a bad target, and a target that is already main', () => {
    expect(problems({ expectedMainSha: 'abc' })).toMatch(/expected main sha is not a full 40-hex sha/u);
    expect(problems({ mainSha: OTHER })).toMatch(new RegExp(`main is ${OTHER}, not the expected ${MAIN}`));
    expect(problems({ mainSha: undefined })).toMatch(/main could not be read/u);
    expect(problems({ targetSha: 'zz' })).toMatch(/target sha is not a full 40-hex sha/u);
    expect(problems({ targetTree: 'zz' })).toMatch(/target tree is not a full 40-hex sha/u);
    const same = attest({ checkpoint: MAIN });
    expect(problems({
      targetSha: MAIN,
      attestationText: same.text,
      attestationSignatureB64: same.signature,
    })).toMatch(/the target is main; there is nothing to land/u);
  });

  it('refuses a target that is behind, diverged, or identical', () => {
    expect(problems({ compare: { behind_by: 1, status: 'behind', ahead_by: 0 } })).toMatch(/does not descend from main/u);
    expect(problems({ compare: { behind_by: 1, status: 'diverged', ahead_by: 1 } })).toMatch(/does not descend from main/u);
    expect(problems({ compare: { behind_by: 0, status: 'identical', ahead_by: 0 } })).toMatch(/does not descend from main/u);
  });

  it('refuses an unset pin, the wrong key, and a missing or bogus attestation', () => {
    expect(problems({ externalAnchor: '' })).toMatch(/JULIUS_REVIEWER_KEY_SHA256 is unset/u);
    expect(problems({ publicKeyPem: otherPem })).toMatch(/not the pinned reviewer key/u);
    expect(problems({ attestationText: '' })).toMatch(/was not verified/u);
    expect(problems({ attestationText: 'not an attestation\n', attestationSignatureB64: signed.signature })).toMatch(/was not verified/u);
    expect(problems({
      treeHashes: { ...treeHashes, 'scripts/julius-governed-bootstrap.mjs': '0'.repeat(64) },
    })).toMatch(/was not verified/u);
  });

  it('refuses a checkpoint or tree that is not the target, a nonce that does not bind, and a window longer than 24 hours', () => {
    const otherCommit = attest({ checkpoint: OTHER });
    expect(problems({
      attestationText: otherCommit.text,
      attestationSignatureB64: otherCommit.signature,
    })).toMatch(/the attestation checkpoint is not the target commit/u);
    const otherTree = attest({ tree: OTHER });
    expect(problems({
      attestationText: otherTree.text,
      attestationSignatureB64: otherTree.signature,
    })).toMatch(/the attestation does not bind the target tree/u);
    const rebound = attest({ nonce: 'ab'.repeat(16) });
    expect(problems({
      attestationText: rebound.text,
      attestationSignatureB64: rebound.signature,
    })).toMatch(/the attestation nonce does not bind the target/u);
    const long = attest({ issued: '2026-10-22T18:00:00Z', expires: '2026-10-24T18:00:00Z' });
    expect(problems({
      attestationText: long.text,
      attestationSignatureB64: long.signature,
    })).toMatch(/the attestation expiry is not a short window/u);
  });

  it('refuses an extra active ruleset, a snapshot that omits creation, a null id, and an unset bot', () => {
    expect(problems({
      liveRules: [...liveRules, { type: 'deletion', ruleset_id: 100, ruleset_source_type: 'Organization' }],
    })).toMatch(/an active ruleset other than the pinned main ruleset applies to main/u);
    expect(problems({
      snapshot: { ...snapshot, rules: snapshot.rules.filter((rule) => rule.type !== 'creation') },
    })).toMatch(/does not block deletion, force pushes, creation, and updates/u);
    expect(problems({ snapshot: { ...snapshot, id: null } })).toMatch(/no pinned ruleset id/u);
    expect(problems({ appId: '' })).toMatch(/JULIUS_GOVERNED_LANDER_APP_ID is unset/u);
    expect(problems({ botId: '' })).toMatch(/JULIUS_GOVERNED_LANDER_BOT_ID is unset/u);
    expect(problems({ snapshotSha256: '0'.repeat(64) })).toMatch(/main ruleset snapshot is not the blob on the target/u);
    expect(problems({ publicKeySha256: '1'.repeat(64) })).toMatch(/reviewer key is not the blob on the target/u);
    expect(problems({ liveRules: null })).toMatch(/could not be read/u);
  });
});

describe('runBootstrap talks to GitHub only with a token and never prints it', () => {
  const source = readFileSync(join(ROOT, 'scripts/julius-governed-bootstrap.mjs'), 'utf8');

  it('has no re-enable toggle and is named in the trusted computing base', () => {
    expect(source).not.toContain('--reenable');
    expect(source).not.toContain('--re-enable');
    expect(source).not.toContain('skip-attestation');
    expect(source).toContain('There is no re-enable flag');
    expect(source).toContain('delete this file');
    expect(TRUSTED_COMPUTING_BASE).toContain('scripts/julius-governed-bootstrap.mjs');
    expect(TRUSTED_COMPUTING_BASE).not.toContain('.github/workflows/julius-governed-evidence.yml');
    expect(trust.TRUSTED_COMPUTING_BASE).not.toContain('.github/workflows/julius-governed-evidence.yml');
  });

  const attestationPath = join(work, 'attestation.txt');
  const signaturePath = join(work, 'attestation.sig');
  writeFileSync(attestationPath, signed.text);
  writeFileSync(signaturePath, `${signed.signature}\n`);

  const argv = [
    '--main-sha', MAIN,
    '--target', TARGET,
    '--target-tree', TREE,
    '--attestation', attestationPath,
    '--signature', signaturePath,
  ];

  function client(mode: 'ok' | 'identity' | 'moved' | 'tree' = 'ok') {
    const calls: { path: string; method: string; body?: string; token: string }[] = [];
    const request = async (path: string, init: { method: string; body?: string; token: string }) => {
      calls.push({ path, method: init.method, body: init.body, token: init.token });
      if (path.endsWith('/git/ref/heads/main') && init.method === 'GET') {
        const seen = calls.filter((call) => call.path === path && call.method === 'GET').length;
        if (mode === 'moved' && seen === 2) return { status: 200, body: { object: { sha: OTHER } } };
        if (seen >= 3) return { status: 200, body: { object: { sha: INSTALLER } } };
        return { status: 200, body: { object: { sha: MAIN } } };
      }
      if (path.includes('/compare/')) return { status: 200, body: { behind_by: 0, status: 'ahead', ahead_by: 1 } };
      if (path === `/repos/${REPO}/commits/${TARGET}`) {
        return { status: 200, body: { commit: { tree: { sha: mode === 'tree' ? OTHER : TREE } } } };
      }
      if (path.includes('/contents/')) {
        const encoded = path.slice(path.indexOf('/contents/') + '/contents/'.length, path.indexOf('?ref='));
        const rel = encoded.split('/').map((part) => decodeURIComponent(part)).join('/');
        return { status: 200, body: { encoding: 'base64', content: fileBytes(rel).toString('base64') } };
      }
      if (path.endsWith('/rules/branches/main')) return { status: 200, body: liveRules };
      if (path.endsWith('/git/blobs') && init.method === 'POST') return { status: 201, body: { sha: 'b'.repeat(40) } };
      if (path.endsWith('/git/trees') && init.method === 'POST') return { status: 201, body: { sha: 'c'.repeat(40) } };
      if (path.endsWith('/git/commits') && init.method === 'POST') return { status: 201, body: { sha: INSTALLER } };
      if (path === `/repos/${REPO}/commits/${INSTALLER}`) {
        const id = mode === 'identity' ? 1 : Number(BOT);
        return { status: 200, body: { committer: { id }, commit: { verification: { verified: true, reason: 'valid' } } } };
      }
      if (path.endsWith('/git/refs/heads/main') && init.method === 'PATCH') return { status: 200, body: {} };
      return { status: 500, body: null };
    };
    return { calls, request };
  }

  const env = {
    JULIUS_GOVERNED_LANDER_TOKEN: TOKEN,
    JULIUS_REVIEWER_KEY_SHA256: spki,
    JULIUS_GOVERNED_LANDER_APP_ID: APP,
    JULIUS_GOVERNED_LANDER_BOT_ID: BOT,
  };

  it('returns before any request when the token is unset', async () => {
    let called = false;
    const result = await boot.runBootstrap({
      argv,
      env: {},
      request: async () => { called = true; return { status: 500, body: null }; },
      now: NOW,
    });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/JULIUS_GOVERNED_LANDER_TOKEN is unset/u);
  });

  it('dry-run reads and does not write, and the token stays out of the result', async () => {
    const { calls, request } = client();
    const result = await boot.runBootstrap({ argv, env, request, now: NOW });
    expect(result.ok, result.problems.join('\n')).toBe(true);
    expect(result.execute).toBe(false);
    expect(result.record).toContain('status: pending');
    expect(result.record).toContain(`target: ${TARGET}`);
    expect(result.record).toContain(`tree: ${TREE}`);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(calls.every((call) => call.token === TOKEN)).toBe(true);
  });

  it('execute creates an App commit with no author and fast-forwards with force false', async () => {
    const { calls, request } = client();
    const result = await boot.runBootstrap({ argv: [...argv, '--execute'], env, request, now: NOW });
    expect(result.ok, result.problems.join('\n')).toBe(true);
    expect(result.record).toContain('status: final');
    expect(result.record).toContain(`main: ${INSTALLER}`);
    const commit = calls.find((call) => call.path.endsWith('/git/commits') && call.method === 'POST');
    expect(JSON.parse(commit?.body ?? '{}')).toEqual({
      message: boot.INSTALLER_COMMIT_MESSAGE,
      tree: 'c'.repeat(40),
      parents: [TARGET],
    });
    const tree = JSON.parse(calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/trees'))?.body ?? '{}') as { base_tree: string };
    expect(tree.base_tree).toBe(TREE);
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ sha: INSTALLER, force: false });
    expect(calls.some((call) => call.body?.includes('force":true') || call.body?.includes('force": true'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('does not move main when the installer identity fails or main moved', async () => {
    const identity = client('identity');
    const refused = await boot.runBootstrap({ argv: [...argv, '--execute'], env, request: identity.request, now: NOW });
    expect(refused.ok).toBe(false);
    expect(refused.problems.join('\n')).toMatch(/not the governed lander bot/u);
    expect(identity.calls.some((call) => call.method === 'PATCH')).toBe(false);
    const moved = client('moved');
    const raced = await boot.runBootstrap({ argv: [...argv, '--execute'], env, request: moved.request, now: NOW });
    expect(raced.ok).toBe(false);
    expect(raced.problems.join('\n')).toMatch(/main moved before the update/u);
    expect(moved.calls.some((call) => call.method === 'PATCH')).toBe(false);
    const tree = client('tree');
    const mismatch = await boot.runBootstrap({ argv, env, request: tree.request, now: NOW });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.problems.join('\n')).toMatch(new RegExp(`the target tree is ${OTHER}, not ${TREE}`));
    expect(tree.calls.every((call) => call.method === 'GET')).toBe(true);
  });
});
