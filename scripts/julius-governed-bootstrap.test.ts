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

import { PINNED_REVIEWER_RAW_KEY, PINNED_REVIEWER_SPKI_SHA256, TRUSTED_CHECKPOINT_SHA, TRUSTED_COMPUTING_BASE } from './julius-main-provenance-trust.mjs';

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
/** Six months: the bootstrap installs the long-window attestation directly (B4). */
const EXPIRES = '2027-04-23T18:00:00Z';
const STALE = '10aedd11643a1d717311b5824d54e863aa94d763';

const pair = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const otherPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const der = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }));
const spki = createHash('sha256').update(der).digest('hex');
const raw = der.subarray(der.length - 32).toString('hex');
const signWith = (text: string) => sign(null, Buffer.from(text, 'utf8'), pair.privateKey).toString('base64');
/** H1: a throwaway founder-approval key, pinned only in the fixture copy. */
const founder = generateKeyPairSync('ed25519');
const founderPem = founder.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const founderDer = Buffer.from(founder.publicKey.export({ type: 'spki', format: 'der' }));
const founderSpki = createHash('sha256').update(founderDer).digest('hex');
const founderRaw = founderDer.subarray(founderDer.length - 32).toString('hex');
const founderSign = (text: string) => sign(null, Buffer.from(text, 'utf8'), founder.privateKey).toString('base64');

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
writeFileSync(join(fixtureRoot, '.github/julius-landing/founder-approval-ed25519.pub'), founderPem);
{
  const trustPath = join(fixtureRoot, 'scripts/julius-main-provenance-trust.mjs');
  writeFileSync(trustPath, readFileSync(trustPath, 'utf8')
    .replace('export const PINNED_FOUNDER_APPROVAL_SPKI_SHA256 = null;', `export const PINNED_FOUNDER_APPROVAL_SPKI_SHA256 = '${founderSpki}';`)
    .replace('export const PINNED_FOUNDER_APPROVAL_RAW_KEY = null;', `export const PINNED_FOUNDER_APPROVAL_RAW_KEY = '${founderRaw}';`));
}

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
  ATTESTATION_MAX_WINDOW_MS: number;
  BOOTSTRAP_MIN_REMAINING_MS: number;
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
  return { text, signature: signWith(text), founderSignature: founderSign(text) };
}

const signed = attest();

function good(over: Record<string, unknown> = {}) {
  return {
    expectedMainSha: MAIN,
    mainSha: MAIN,
    targetSha: TARGET,
    targetTree: TREE,
    liveTargetTree: TREE,
    existingCheckpointNames: [],
    attestedRange: [{ sha: TARGET, tree: TREE }],
    compare: { behind_by: 0, status: 'ahead', ahead_by: 1 },
    publicKeyPem: publicPem,
    externalAnchor: spki,
    attestationText: signed.text,
    attestationSignatureB64: signed.signature,
    attestationFounderSignatureB64: signed.founderSignature,
    founderPublicKeyPem: founderPem,
    founderAnchor: founderSpki,
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
  it('accepts a descendant target bound by a six-month signed attestation', () => {
    const decision = boot.evaluateGovernedBootstrap(good());
    expect(decision.ok, decision.problems.join('\n')).toBe(true);
    expect(boot.ATTESTATION_MAX_WINDOW_MS).toBe(184 * 24 * 60 * 60 * 1000);
    expect(boot.BOOTSTRAP_MAX_WINDOW_MS).toBe(boot.ATTESTATION_MAX_WINDOW_MS);
    expect(boot.BOOTSTRAP_MIN_REMAINING_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('refuses a bad expected sha, a moved main, a bad target, and a target tree that is not the live tree', () => {
    expect(problems({ expectedMainSha: 'abc' })).toMatch(/expected main sha is not a full 40-hex sha/u);
    expect(problems({ mainSha: OTHER })).toMatch(new RegExp(`main is ${OTHER}, not the expected ${MAIN}`));
    expect(problems({ mainSha: undefined })).toMatch(/main could not be read/u);
    expect(problems({ targetSha: 'zz' })).toMatch(/target sha is not a full 40-hex sha/u);
    expect(problems({ targetTree: 'zz' })).toMatch(/target tree is not a full 40-hex sha/u);
    expect(problems({ targetTree: undefined })).toMatch(/target tree is not a full 40-hex sha/u);
    expect(problems({ liveTargetTree: OTHER })).toMatch(new RegExp(`the target tree is ${OTHER}, not ${TREE}`));
  });

  it('refuses a target that is behind, diverged, or identical but not main', () => {
    expect(problems({ compare: { behind_by: 1, status: 'behind', ahead_by: 0 } })).toMatch(/does not descend from main/u);
    expect(problems({ compare: { behind_by: 1, status: 'diverged', ahead_by: 1 } })).toMatch(/does not descend from main/u);
    expect(problems({ compare: { behind_by: 0, status: 'identical', ahead_by: 0 } })).toMatch(/does not descend from main/u);
  });

  it('B4: a target equal to main is the recovery path and re-attests main', () => {
    const same = attest({ checkpoint: MAIN });
    const decision = boot.evaluateGovernedBootstrap(good({
      targetSha: MAIN,
      compare: null,
      attestedRange: [{ sha: MAIN, tree: TREE }],
      existingCheckpointNames: [`${STALE}.sig`, `${STALE}.txt`],
      attestationText: same.text,
      attestationSignatureB64: same.signature,
      attestationFounderSignatureB64: same.founderSignature,
    }));
    expect(decision.ok, decision.problems.join('\n')).toBe(true);
    expect((decision as { recovery?: boolean }).recovery).toBe(true);
  });

  it('B4: refuses a window past six months and one that expires within seven days of install', () => {
    const long = attest({ issued: '2026-10-23T18:00:00Z', expires: '2027-04-26T18:00:00Z' });
    expect(problems({ attestationText: long.text, attestationSignatureB64: long.signature })).toMatch(/longer than the six-month ceiling/u);
    const soon = attest({ issued: '2026-10-23T18:00:00Z', expires: '2026-10-29T18:00:00Z' });
    expect(problems({ attestationText: soon.text, attestationSignatureB64: soon.signature })).toMatch(/expires within seven days/u);
  });

  it('B2: the installed directory is exactly one attestation, whatever the target carried', () => {
    const plan = (boot as unknown as { installerDiffPlan: (target: string, names: string[]) => { added: string[]; removed: string[] } })
      .installerDiffPlan(TARGET, [`${STALE}.txt`]);
    expect(plan.removed).toEqual([`.github/julius-landing/checkpoints/${STALE}.txt`]);
    expect(plan.added).toEqual([`.github/julius-landing/checkpoints/${TARGET}.founder.sig`, `.github/julius-landing/checkpoints/${TARGET}.sig`, `.github/julius-landing/checkpoints/${TARGET}.txt`]);
    expect(problems({ existingCheckpointNames: [`${STALE}.txt`] })).toBe('');
    expect(problems({ existingCheckpointNames: ['README.md'] })).toMatch(/holds files that are not attestations/u);
    expect(problems({ existingCheckpointNames: null })).toMatch(/checkpoint directory at the target could not be read/u);
  });

  it('H1: the attestation needs the founder-approval signature as well as the reviewer signature', () => {
    expect(problems({ attestationFounderSignatureB64: '' })).toMatch(/founder approval: no founder-approval signature was supplied/u);
    expect(problems({ attestationFounderSignatureB64: signed.signature })).toMatch(/founder approval: the founder-approval signature does not verify/u);
    const other = attest({ tree: OTHER });
    expect(problems({ attestationFounderSignatureB64: other.founderSignature })).toMatch(/founder-approval signature does not verify over these exact bytes/u);
    expect(problems({ founderAnchor: '' })).toMatch(/JULIUS_FOUNDER_APPROVAL_KEY_SHA256 is unset/u);
    expect(problems({ founderPublicKeyPem: otherPem })).toMatch(/not the pinned founder-approval key/u);
  });

  it('H1: the real tree pins no founder-approval key, so the real bootstrap refuses', async () => {
    const real = (await import(pathToFileURL(join(ROOT, 'scripts/julius-main-provenance-trust.mjs')).href)) as {
      PINNED_FOUNDER_APPROVAL_SPKI_SHA256: string | null;
      founderApprovalProblem: (input: Record<string, unknown>) => string | null;
    };
    expect(real.PINNED_FOUNDER_APPROVAL_SPKI_SHA256).toBeNull();
    expect(real.founderApprovalProblem({ text: signed.text, signatureB64: signed.founderSignature, pem: founderPem, anchor: founderSpki }))
      .toMatch(/no founder-approval key is pinned/u);
  });

  it('refuses an attestation whose commit list is not the first-parent chain from the prior', () => {
    expect(problems({ attestedRange: [{ sha: OTHER, tree: TREE }, { sha: TARGET, tree: TREE }] })).toMatch(/does not list the first-parent chain/u);
    expect(problems({ attestedRange: null })).toMatch(/first-parent chain from 2528ac5c[0-9a-f]+ to the target could not be read/u);
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

  it('refuses a checkpoint or tree that is not the target and a nonce that does not bind', () => {
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
    })).toMatch(/installed checkpoint directory would be refused: nonce does not bind/u);
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
    // B4: the script is the recovery path for an expired attestation and stays in the tree.
    expect(source).toContain('Keep this file');
    expect(source).not.toContain('delete this file');
    expect(TRUSTED_COMPUTING_BASE).toContain('scripts/julius-governed-bootstrap.mjs');
    expect(TRUSTED_COMPUTING_BASE).not.toContain('.github/workflows/julius-governed-evidence.yml');
    expect(trust.TRUSTED_COMPUTING_BASE).not.toContain('.github/workflows/julius-governed-evidence.yml');
  });

  const attestationPath = join(work, 'attestation.txt');
  const signaturePath = join(work, 'attestation.sig');
  writeFileSync(attestationPath, signed.text);
  writeFileSync(signaturePath, `${signed.signature}\n`);
  const founderSignaturePath = join(work, 'attestation.founder.sig');
  writeFileSync(founderSignaturePath, `${signed.founderSignature}\n`);

  const argv = [
    '--main-sha', MAIN,
    '--target', TARGET,
    '--target-tree', TREE,
    '--attestation', attestationPath,
    '--signature', signaturePath,
    '--founder-signature', founderSignaturePath,
  ];

  type Mode = 'ok' | 'identity' | 'moved' | 'tree' | 'readback-tree' | 'readback-parents' | 'readback-message' | 'readback-extra' | 'stale' | 'env-missing' | 'env-open' | 'env-extra';
  function client(mode: Mode = 'ok') {
    const calls: { path: string; method: string; body?: string; token: string }[] = [];
    const request = async (path: string, init: { method: string; body?: string; token: string }) => {
      calls.push({ path, method: init.method, body: init.body, token: init.token });
      if (path.endsWith('/git/ref/heads/main') && init.method === 'GET') {
        const seen = calls.filter((call) => call.path === path && call.method === 'GET').length;
        if (mode === 'moved' && seen === 2) return { status: 200, body: { object: { sha: OTHER } } };
        if (seen >= 3) return { status: 200, body: { object: { sha: INSTALLER } } };
        return { status: 200, body: { object: { sha: MAIN } } };
      }
      if (path === `/repos/${REPO}/compare/${TARGET}...${INSTALLER}`) {
        const files = [
          { status: 'added', filename: `.github/julius-landing/checkpoints/${TARGET}.txt` },
          { status: 'added', filename: `.github/julius-landing/checkpoints/${TARGET}.sig` },
          { status: 'added', filename: `.github/julius-landing/checkpoints/${TARGET}.founder.sig` },
          ...(mode === 'stale' ? [{ status: 'removed', filename: `.github/julius-landing/checkpoints/${STALE}.txt` }] : []),
          ...(mode === 'readback-extra' ? [{ status: 'removed', filename: 'src/main.tsx' }] : []),
        ];
        return { status: 200, body: { behind_by: 0, status: 'ahead', ahead_by: 1, files } };
      }
      if (path.includes('/compare/')) return { status: 200, body: { behind_by: 0, status: 'ahead', ahead_by: 1 } };
      if (path === `/repos/${REPO}/environments/governed-landing`) {
        if (mode === 'env-missing') return { status: 404, body: null };
        const policy = mode === 'env-open' ? null : { protected_branches: false, custom_branch_policies: true };
        return { status: 200, body: { name: 'governed-landing', deployment_branch_policy: policy } };
      }
      if (path === `/repos/${REPO}/environments/governed-landing/deployment-branch-policies?per_page=100`) {
        const rows = mode === 'env-extra' ? [{ name: 'main', type: 'branch' }, { name: 'relay/*', type: 'branch' }] : [{ name: 'main', type: 'branch' }];
        return { status: 200, body: { total_count: rows.length, branch_policies: rows } };
      }

      if (path === `/repos/${REPO}/commits/${TARGET}`) {
        return { status: 200, body: { commit: { tree: { sha: mode === 'tree' ? OTHER : TREE } }, parents: [{ sha: TRUSTED_CHECKPOINT_SHA }] } };
      }
      if (path === `/repos/${REPO}/contents/.github/julius-landing/checkpoints?ref=${TARGET}`) {
        return mode === 'stale' ? { status: 200, body: [{ type: 'file', name: `${STALE}.txt` }] } : { status: 404, body: null };
      }
      if (path === `/repos/${REPO}/git/commits/${INSTALLER}`) {
        return {
          status: 200,
          body: {
            tree: { sha: mode === 'readback-tree' ? OTHER : 'c'.repeat(40) },
            parents: mode === 'readback-parents' ? [{ sha: MAIN }] : [{ sha: TARGET }],
            message: mode === 'readback-message' ? 'something else' : boot.INSTALLER_COMMIT_MESSAGE.replace(/\n$/u, ''),
          },
        };
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
    JULIUS_FOUNDER_APPROVAL_KEY_SHA256: founderSpki,
  };

  it('the founder block: one bash block, prerequisites and fail-fast first, then the dry run, --execute, and verification', async () => {
    const result = await boot.runBootstrap({ argv, env: {}, request: async () => ({ status: 500, body: null }), now: NOW }) as { instructions?: string | null };
    const block = String(result.instructions);
    expect(block.match(/FOUNDER: run this whole block/gu)).toHaveLength(1);
    expect(block).toContain('set -euo pipefail');
    const at = (needle: string) => {
      const index = block.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };
    const order = [
      at('command -v node'),
      at('test "$(git rev-parse HEAD)" = "$TARGET"'),
      at('actions/variables/JULIUS_REVIEWER_KEY_SHA256'),
      at('/access_tokens'),
      at('node scripts/julius-governed-bootstrap.mjs "${ARGS[@]}"\n'),
      at('node scripts/julius-governed-bootstrap.mjs "${ARGS[@]}" --execute'),
      at('test "$(git rev-parse origin/main^)" = "$TARGET"'),
      at('--require-trusted-verifier'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(block).toContain(`MAIN_SHA='${MAIN}'`);
    expect(block).toContain(`TARGET='${TARGET}'`);
    expect(block).toContain(`TARGET_TREE='${TREE}'`);
    expect(block).toContain('JULIUS_GOVERNED_LANDER_APP_ID=5457712 JULIUS_GOVERNED_LANDER_BOT_ID=347502603');
    expect(block).toContain('repositories: ["sunday-relay"]');
    expect(block).toContain('X DELETE');
    // The token goes only into a variable; nothing echoes it or the PEM.
    expect(block).not.toMatch(/echo[^\n]*(TOKEN|PEM)/u);
    expect(block).not.toMatch(/(cat|printf)[^\n]*(TOKEN|PEM)/u);
    expect(block).not.toContain('set -x');
    expect(block).not.toContain(TOKEN);
  });

  it('dry run explains what it checked and would write, and ends with the founder block', async () => {
    const { request } = client();
    const result = await boot.runBootstrap({ argv, env, request, now: NOW }) as { ok: boolean; summary?: string; instructions?: string };
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('DRY RUN: every check passed and nothing was written.');
    expect(result.summary).toContain(`add    .github/julius-landing/checkpoints/${TARGET}.founder.sig`);
    expect(result.instructions).toContain('FOUNDER: run this whole block');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    // The script never opens the App private key, even when the founder's shell has it set.
    const opened: string[] = [];
    const readFile = (path: string) => { opened.push(path); return readFileSync(path, 'utf8'); };
    await boot.runBootstrap({ argv, env: { ...env, JULIUS_APP_PEM_FILE: '/founder/app.pem' }, request: client().request, readFile, now: NOW });
    expect(opened.some((path) => path.includes('app.pem'))).toBe(false);
  });

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

  it('H2: refuses without writing unless governed-landing deploys from main only', async () => {
    for (const mode of ['env-missing', 'env-open', 'env-extra'] as const) {
      const { calls, request } = client(mode);
      const result = await boot.runBootstrap({ argv: [...argv, '--execute'], env, request, now: NOW });
      expect(result.ok, mode).toBe(false);
      expect(result.problems.join('\n'), mode).toMatch(/governed-landing/u);
      expect(calls.every((call) => call.method === 'GET'), mode).toBe(true);
    }
  });

  it('B1: refuses before any request when --target-tree is omitted, so base_tree is never undefined', async () => {
    const { calls, request } = client();
    const withoutTree = argv.filter((value, index) => value !== '--target-tree' && argv[index - 1] !== '--target-tree');
    const result = await boot.runBootstrap({ argv: [...withoutTree, '--execute'], env, request, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/--target-tree is required/u);
    expect(calls).toEqual([]);
  });

  it('B1: does not move main unless the installer tree, single parent, message and diff are exactly what was created', async () => {
    for (const [mode, why] of [
      ['readback-tree', new RegExp(`installer tree is ${OTHER}`)],
      ['readback-parents', /installer parents are/u],
      ['readback-message', /installer message is not the installer message/u],
      ['readback-extra', /diff is .*removed:src\/main\.tsx/u],
    ] as const) {
      const { calls, request } = client(mode);
      const result = await boot.runBootstrap({ argv: [...argv, '--execute'], env, request, now: NOW });
      expect(result.ok, mode).toBe(false);
      expect(result.problems.join('\n'), mode).toMatch(why);
      expect(calls.some((call) => call.method === 'PATCH'), mode).toBe(false);
    }
  });

  it('B2: execute removes a stale attestation in the same installer and checks that removal on read-back', async () => {
    const { calls, request } = client('stale');
    const result = await boot.runBootstrap({ argv: [...argv, '--execute'], env, request, now: NOW });
    expect(result.ok, result.problems.join('\n')).toBe(true);
    const tree = JSON.parse(calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/trees'))?.body ?? '{}') as {
      base_tree: string;
      tree: { path: string; sha: string | null }[];
    };
    expect(tree.base_tree).toBe(TREE);
    expect(tree.tree).toContainEqual({ path: `.github/julius-landing/checkpoints/${STALE}.txt`, mode: '100644', type: 'blob', sha: null });
    expect(tree.tree.filter((row) => row.sha !== null).map((row) => row.path).sort()).toEqual([
      `.github/julius-landing/checkpoints/${TARGET}.founder.sig`,
      `.github/julius-landing/checkpoints/${TARGET}.sig`,
      `.github/julius-landing/checkpoints/${TARGET}.txt`,
    ]);
    const unexpected = client('ok');
    const withoutRemoval = await boot.runBootstrap({
      argv: [...argv, '--execute'],
      env,
      request: async (path, init) => (path === `/repos/${REPO}/contents/.github/julius-landing/checkpoints?ref=${TARGET}`
        ? { status: 200, body: [{ type: 'file', name: `${STALE}.txt` }] }
        : unexpected.request(path, init)),
      now: NOW,
    });
    expect(withoutRemoval.ok).toBe(false);
    expect(withoutRemoval.problems.join('\n')).toMatch(/not exactly .*removed:/u);
    expect(unexpected.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });
});
