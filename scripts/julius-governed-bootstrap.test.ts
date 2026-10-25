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
import { spawnSync } from 'node:child_process';

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
/** 89 days: within the 90-day ceiling (M3). */
const EXPIRES = '2027-01-20T18:00:00Z';
const PREV = '6'.repeat(40);
const STALE = '10aedd11643a1d717311b5824d54e863aa94d763';

const pair = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const otherPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
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
const signWith = (text: string) => sign(null, Buffer.from(text, 'utf8'), pair.privateKey).toString('base64');
/** H1: a throwaway founder-approval key, pinned only in the fixture copy. */
const founder = generateKeyPairSync('ed25519');
const founderPem = founder.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const founderDer = Buffer.from(founder.publicKey.export({ type: 'spki', format: 'der' }));
const founderSpki = createHash('sha256').update(founderDer).digest('hex');
const founderSign = (text: string) => sign(null, Buffer.from(text, 'utf8'), founder.privateKey).toString('base64');
/** A different founder key, standing for main's current pin when a target tries to swap it in (BLOCKER-1). */
const oldFounder = generateKeyPairSync('ed25519');
const oldFounderPem = oldFounder.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const oldFounderSpki = createHash('sha256').update(Buffer.from(oldFounder.publicKey.export({ type: 'spki', format: 'der' }))).digest('hex');

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
  FOUNDER_MINT_JS: string[];
  founderCommandBlock: (input: Record<string, string>) => string;
  WORKFLOWS_PERMISSION_MESSAGE: string;
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

function attest(over: { checkpoint?: string; tree?: string; issued?: string; expires?: string; nonce?: string; prior?: string } = {}) {
  const checkpoint = over.checkpoint ?? TARGET;
  const tree = over.tree ?? TREE;
  const text = trust.canonicalCheckpointAttestation({
    checkpoint,
    commits: [{ sha: checkpoint, tree, basis: 'governed bootstrap test' }],
    tcb,
    ...(over.prior ? { prior: over.prior } : {}),
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
    founderFingerprint: founderSpki,
    mainReviewerPem: publicPem,
    mainFounderPem: '',
    mainHasAttestation: false,
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
  it('accepts a descendant target bound by an 89-day signed attestation', () => {
    const decision = boot.evaluateGovernedBootstrap(good());
    expect(decision.ok, decision.problems.join('\n')).toBe(true);
    expect(boot.ATTESTATION_MAX_WINDOW_MS).toBe(90 * 24 * 60 * 60 * 1000);
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

  it('M3: refuses a window past 90 days and one that expires within seven days of install', () => {
    const ninetyOne = attest({ issued: '2026-10-23T18:00:00Z', expires: '2027-01-22T18:00:00Z' });
    expect(problems({ attestationText: ninetyOne.text, attestationSignatureB64: ninetyOne.signature, attestationFounderSignatureB64: ninetyOne.founderSignature })).toMatch(/longer than the 90-day ceiling/u);
    const long = attest({ issued: '2026-10-23T18:00:00Z', expires: '2027-04-26T18:00:00Z' });
    expect(problems({ attestationText: long.text, attestationSignatureB64: long.signature })).toMatch(/longer than the 90-day ceiling/u);
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

  it('H1: the bootstrap requires both signatures over the same attestation bytes', () => {
    expect(problems({ attestationSignatureB64: '' })).toMatch(/reviewer_signature_missing/u);
    expect(problems({ attestationFounderSignatureB64: '' })).toMatch(/founder_signature_missing/u);
    expect(problems({ founderPublicKeyPem: '' })).toMatch(/founder_key_unpinned/u);
    expect(problems({ founderAnchor: '0'.repeat(64) })).toMatch(/founder_anchor_mismatch/u);
    expect(problems({ attestationFounderSignatureB64: attest({ tree: OTHER }).founderSignature })).toMatch(/founder_signature_invalid/u);
    expect(boot.evaluateGovernedBootstrap(good()).ok).toBe(true);
  });

  it('H1: the attestation needs the founder-approval signature as well as the reviewer signature', () => {
    expect(problems({ attestationFounderSignatureB64: '' })).toMatch(/founder approval: founder_signature_missing: no founder-approval signature was supplied/u);
    expect(problems({ attestationFounderSignatureB64: signed.signature })).toMatch(/founder approval: founder_signature_invalid: the founder-approval signature does not verify/u);
    const other = attest({ tree: OTHER });
    expect(problems({ attestationFounderSignatureB64: other.founderSignature })).toMatch(/founder-approval signature does not verify over these exact bytes/u);
    expect(problems({ founderAnchor: '' })).toMatch(/JULIUS_FOUNDER_APPROVAL_KEY_SHA256 is unset/u);
    expect(problems({ founderPublicKeyPem: otherPem })).toMatch(/founder_anchor_mismatch/u);
  });

  it('H1: the real tree pins exactly the founder\'s key, and an empty key is still founder_key_unpinned', async () => {
    const real = (await import(pathToFileURL(join(ROOT, 'scripts/julius-main-provenance-trust.mjs')).href)) as {
      FOUNDER_APPROVAL_KEY_PATH: string;
      founderApprovalProblem: (input: Record<string, unknown>) => string | null;
    };
    // The founder's public key, as openssl pkey -pubout wrote it: file sha256 cee2ca8c..., SPKI DER sha256
    // f17a2a17..., the fingerprint the founder confirmed and set as JULIUS_FOUNDER_APPROVAL_KEY_SHA256.
    const keyFile = join(ROOT, real.FOUNDER_APPROVAL_KEY_PATH);
    expect(existsSync(keyFile)).toBe(true);
    const bytes = readFileSync(keyFile);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('cee2ca8c35ccb5c54206ad652fcfe45e09daca1c9f8c72e8ed7c3089eb474bcd');
    const { createPublicKey } = await import('node:crypto');
    const der = createPublicKey(bytes).export({ format: 'der', type: 'spki' });
    expect(createHash('sha256').update(der).digest('hex')).toBe('f17a2a172fc0bdb45a4840f778e12be1794b80736385c9023e795d9a1d2480cc');
    expect(real.founderApprovalProblem({ text: signed.text, signatureB64: signed.founderSignature, pem: '', anchor: founderSpki }))
      .toMatch(/founder approval: founder_key_unpinned/u);
    // A valid founder signature under a key that is not pinned (no anchor for it) is refused.
    expect(problems({ founderAnchor: spki })).toMatch(/founder_anchor_mismatch/u);
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
    '--founder-fingerprint', founderSpki,
  ];

  type Mode = 'ok' | 'identity' | 'moved' | 'tree' | 'readback-tree' | 'readback-parents' | 'readback-message' | 'readback-extra' | 'stale' | 'env-missing' | 'env-open' | 'env-extra'
    | 'main-pinned' | 'main-pinned-swap' | 'var-mismatch' | 'var-missing' | 'patch-timeout-moved' | 'patch-timeout-unmoved' | 'patch-422' | 'var-crlf' | 'var-base64';
  function client(mode: Mode = 'ok') {
    const calls: { path: string; method: string; body?: string; token: string }[] = [];
    const request = async (path: string, init: { method: string; body?: string; token: string }) => {
      calls.push({ path, method: init.method, body: init.body, token: init.token });
      if (path.endsWith('/git/ref/heads/main') && init.method === 'GET') {
        const seen = calls.filter((call) => call.path === path && call.method === 'GET').length;
        if (mode === 'moved' && seen === 2) return { status: 200, body: { object: { sha: OTHER } } };
        if (mode === 'patch-timeout-unmoved' || mode === 'patch-422') return { status: 200, body: { object: { sha: MAIN } } };
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
      if (path === `/repos/${REPO}/actions/variables/JULIUS_REVIEWER_KEY_SHA256`) return mode === 'var-missing' ? { status: 404, body: null } : { status: 200, body: { value: mode === 'var-crlf' ? `${spki}\r\n` : spki } };
      if (path === `/repos/${REPO}/actions/variables/JULIUS_FOUNDER_APPROVAL_KEY_SHA256`) return { status: 200, body: { value: mode === 'var-mismatch' ? '0'.repeat(64) : mode === 'var-crlf' ? `${founderSpki}\r\n` : mode === 'var-base64' ? Buffer.from(founderPem).toString('base64') : founderSpki } };
      const encodedFile = (text: string) => ({ status: 200, body: { encoding: 'base64', content: Buffer.from(text).toString('base64') } });
      if (path === `/repos/${REPO}/contents/.github/julius-landing/founder-approval-ed25519.pub?ref=${MAIN}`) {
        if (mode === 'main-pinned') return encodedFile(founderPem);
        if (mode === 'main-pinned-swap') return encodedFile(oldFounderPem);
        return { status: 404, body: null };
      }
      if (path === `/repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub?ref=${MAIN}`) return encodedFile(publicPem);
      if (path === `/repos/${REPO}/contents/.github/julius-landing/checkpoints?ref=${MAIN}`) {
        return mode === 'main-pinned' || mode === 'main-pinned-swap' ? { status: 200, body: [{ type: 'file', name: `${PREV}.txt` }] } : { status: 404, body: null };
      }
      if (path === `/repos/${REPO}/contents/.github/julius-landing/checkpoints/${PREV}.txt?ref=${MAIN}`) return encodedFile(attest({ checkpoint: PREV }).text);
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
        const body = appSignedBody(BOT);
        return { status: 200, body: mode === 'identity' ? { ...body, author: { ...body.author, id: 1 } } : body };
      }
      if (path.endsWith('/git/refs/heads/main') && init.method === 'PATCH') {
        if (mode === 'patch-timeout-moved' || mode === 'patch-timeout-unmoved') return { status: 504, body: null };
        if (mode === 'patch-422') return { status: 422, body: null };
        return { status: 200, body: {} };
      }
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
      at('check-runs?per_page=100'),
      at('/access_tokens'),
      at('node scripts/julius-governed-bootstrap.mjs "${ARGS[@]}"\n'),
      at('read -r -p "Type EXECUTE ${TARGET:0:12} to move main: " CONFIRM </dev/tty'),
      at('node scripts/julius-governed-bootstrap.mjs "${ARGS[@]}" --execute'),
      at('test "$(git rev-list --parents -n 1 origin/main)" = "$(git rev-parse origin/main) $TARGET"'),
      at('rules/branches/main'),
      at('--require-trusted-verifier'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(block).toContain(`MAIN_SHA='${MAIN}'`);
    expect(block).toContain(`TARGET='${TARGET}'`);
    expect(block).toContain(`TARGET_TREE='${TREE}'`);
    expect(block).toContain('JULIUS_GOVERNED_LANDER_APP_ID=5457712 JULIUS_GOVERNED_LANDER_BOT_ID=347502603');
    expect(block).toContain('repositories: ["sunday-relay"]');
    expect(block).toContain('method: "DELETE"');
    // F2: the founder's own lines are never filled from arguments.
    expect(block).toContain("FOUNDER_SIGNATURE='<path to the .founder.sig you wrote on the offline device>'");
    expect(block).toContain("FOUNDER_FINGERPRINT='<the SPKI-DER sha256 of your founder-approval key, from your offline record>'");
    // F5b: the PEM path reaches the mint process only; the token never sits in an argv; a failed revoke is loud.
    expect(block).not.toMatch(/export[^\n]*JULIUS_APP_PEM_FILE/u);
    expect(block).toContain('JULIUS_GOVERNED_LANDER_TOKEN="$(JULIUS_APP_PEM_FILE="$APP_PEM_FILE" node --input-type=module -e');
    expect(block).not.toMatch(/curl[^\n]*TOKEN/u);
    expect(block).not.toContain('|| true\' EXIT');
    expect(block).toContain('WARNING: THE INSTALLATION TOKEN WAS NOT REVOKED');
    // F5c / L-4: untracked files make the checkout dirty, including files inside untracked
    // directories and files a local status.showUntrackedFiles setting would hide.
    expect(block).toContain('test -z "$(git status --porcelain --untracked-files=all)"');
    expect(block).not.toContain('test -z "$(git status --porcelain)"');
    // F4 / L-1: the founder must TYPE the confirmation, and nothing reaches --execute without it.
    // Deleting the comparison would turn the checkpoint into "press Enter".
    const lines = block.split('\n').map((line) => line.trim());
    const prompt = lines.findIndex((line) => line.startsWith('read -r -p "Type EXECUTE ${TARGET:0:12}') && line.endsWith('CONFIRM </dev/tty'));
    const compare = lines.indexOf('test "$CONFIRM" = "EXECUTE ${TARGET:0:12}"');
    const execute = lines.findIndex((line) => line.includes('--execute'));
    expect(prompt, 'the typed confirmation prompt').toBeGreaterThan(-1);
    expect(compare, 'the exact comparison of what was typed').toBeGreaterThan(prompt);
    expect(execute, '--execute runs only after the comparison').toBeGreaterThan(compare);
    expect(lines.filter((line) => line.includes('--execute') && !line.startsWith('#')).length, 'exactly one --execute').toBe(1);
    // F5d: the escaped checkpoints pattern and the tree comparison.
    expect(block).toContain("grep -v '^[.]github/julius-landing/checkpoints/'");
    expect(block).toContain('diff <(git ls-tree -r "$TARGET"');
    // The token goes only into a variable; nothing echoes it or the PEM.
    expect(block).not.toMatch(/echo[^\n]*\$[A-Z_]*(TOKEN|PEM)/u);
    expect(block).not.toMatch(/\b(cat|printf)\b[^\n]*(TOKEN|PEM)/u);
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

  it('BLOCKER-1: the anchors come from the repository variables API, never from the environment', async () => {
    const wrongEnv = { ...env, JULIUS_REVIEWER_KEY_SHA256: '0'.repeat(64), JULIUS_FOUNDER_APPROVAL_KEY_SHA256: '0'.repeat(64) };
    const ok = await boot.runBootstrap({ argv, env: wrongEnv, request: client().request, now: NOW });
    expect(ok.ok, ok.problems.join('\n')).toBe(true);
    const missing = await boot.runBootstrap({ argv, env, request: client('var-missing').request, now: NOW });
    expect(missing.problems.join('\n')).toMatch(/JULIUS_REVIEWER_KEY_SHA256 could not be read/u);
    const mismatch = await boot.runBootstrap({ argv, env, request: client('var-mismatch').request, now: NOW });
    expect(mismatch.problems.join('\n')).toMatch(/founder_anchor_mismatch: the repository variable JULIUS_FOUNDER_APPROVAL_KEY_SHA256 is not the key in --founder-fingerprint/u);
  });

  it('the anchors from the API are trimmed (the live value ends in CRLF); a base64 key is founder_anchor_not_sha256', async () => {
    const crlf = await boot.runBootstrap({ argv, env, request: client('var-crlf').request, now: NOW });
    expect(crlf.ok, crlf.problems.join('\n')).toBe(true);
    const b64 = await boot.runBootstrap({ argv, env, request: client('var-base64').request, now: NOW });
    expect(b64.ok).toBe(false);
    expect(b64.problems.join('\n')).toMatch(/founder_anchor_not_sha256: anchor is not a sha256 hex/u);
  });

  it('BLOCKER-1: once main carries a founder pin, a target that swaps in another founder key is refused', async () => {
    const same = client('main-pinned');
    const kept = await boot.runBootstrap({ argv, env, request: same.request, now: NOW });
    expect(kept.ok, kept.problems.join('\n')).toBe(true);
    const swap = client('main-pinned-swap');
    const swapped = await boot.runBootstrap({ argv: [...argv, '--execute'], env, request: swap.request, now: NOW });
    expect(swapped.ok).toBe(false);
    expect(swapped.problems.join('\n')).toMatch(/not founder-approved under main's current founder-approval key/u);
    expect(swap.calls.some((call) => call.method !== 'GET')).toBe(false);
    void oldFounderSpki;
  });

  it('BLOCKER-1: the attestation must verify under main\'s current reviewer key when main is pinned', () => {
    const other = generateKeyPairSync('ed25519');
    const otherMain = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(problems({ mainHasAttestation: true, mainFounderPem: founderPem, mainReviewerPem: otherMain })).toMatch(/main's reviewer key is not the key in JULIUS_REVIEWER_KEY_SHA256/u);
    expect(problems({ mainHasAttestation: true, mainFounderPem: '' })).toMatch(/founder_key_unpinned: main carries a checkpoint attestation but no founder-approval pin/u);
    expect(problems({ mainHasAttestation: true, mainFounderPem: founderPem, attestationSignatureB64: signWith('other bytes') })).toMatch(/not signed by main's current reviewer key/u);
    expect(problems({ mainHasAttestation: true, mainFounderPem: founderPem })).toBe('');
  });

  it('HIGH-2: the founder-typed fingerprint is required and must equal the target key file and the variable', () => {
    expect(problems({ founderFingerprint: undefined })).toMatch(/--founder-fingerprint is required/u);
    expect(problems({ founderFingerprint: 'abc' })).toMatch(/--founder-fingerprint is required/u);
    expect(problems({ founderFingerprint: oldFounderSpki })).toMatch(/key file in the target is not the key in --founder-fingerprint/u);
    expect(problems({ founderFingerprint: oldFounderSpki, founderAnchor: oldFounderSpki })).toMatch(/key file in the target is not the key in --founder-fingerprint/u);
    expect(problems({ founderAnchor: oldFounderSpki })).toMatch(/JULIUS_FOUNDER_APPROVAL_KEY_SHA256 is not the key in --founder-fingerprint/u);
  });

  it('M2: a recovery may name main\'s current checkpoint as its prior; any other prior is refused', () => {
    const refreshed = attest({ prior: PREV });
    const base = { attestationText: refreshed.text, attestationSignatureB64: refreshed.signature, attestationFounderSignatureB64: refreshed.founderSignature };
    expect(problems({ ...base, mainHasAttestation: true, mainFounderPem: founderPem, mainCheckpoint: PREV })).toBe('');
    expect(problems({ ...base })).toMatch(/prior is not the trusted checkpoint/u);
  });

  it('F3: an unanswered PATCH is landed when main is the installer, in doubt otherwise; only a clean 4xx is a refusal', async () => {
    const moved = await boot.runBootstrap({ argv: [...argv, '--execute'], env, request: client('patch-timeout-moved').request, now: NOW }) as { ok: boolean; summary?: string; problems: string[] };
    expect(moved.ok, moved.problems.join('\n')).toBe(true);
    expect(moved.summary).toMatch(/LANDED \(the PATCH response was lost/u);
    const doubt = await boot.runBootstrap({ argv: [...argv, '--execute'], env, request: client('patch-timeout-unmoved').request, now: NOW }) as { ok: boolean; ambiguous?: boolean; problems: string[] };
    expect(doubt.ok).toBe(false);
    expect(doubt.ambiguous).toBe(true);
    expect(doubt.problems.join('\n')).toMatch(/ALERT: the update of main is in doubt/u);
    expect(doubt.problems.join('\n')).not.toMatch(/main was not moved/u);
    const refused = await boot.runBootstrap({ argv: [...argv, '--execute'], env, request: client('patch-422').request, now: NOW }) as { ok: boolean; ambiguous?: boolean; problems: string[] };
    expect(refused.ok).toBe(false);
    expect(refused.ambiguous).toBeUndefined();
    expect(refused.problems.join('\n')).toMatch(/the ref update was refused; no retry and no force: 422/u);
  });

  it('IDENTITY: the installer read-back accepts only the App-signed shape; the spoof, user-token and web-UI shapes never move main', async () => {
    const fixtures = JSON.parse(readFileSync(join(ROOT, 'scripts/julius-landing-identity-fixtures.json'), 'utf8')) as Record<string, unknown>;
    for (const name of ['spoofBotUnsigned', 'userTokenUnsigned', 'webUiHuman']) {
      const base = client();
      const result = await boot.runBootstrap({
        argv: [...argv, '--execute'],
        env,
        request: async (path, init) => (path === `/repos/${REPO}/commits/${INSTALLER}` ? { status: 200, body: fixtures[name] } : base.request(path, init)),
        now: NOW,
      });
      expect(result.ok, name).toBe(false);
      expect(result.problems.join('\n'), name).toMatch(/no GitHub-verified signature|author is not the governed lander bot|not GitHub's web-flow signer/u);
      expect(base.calls.some((call) => call.method === 'PATCH'), name).toBe(false);
    }
    const constructed = client();
    const accepted = await boot.runBootstrap({
      argv: [...argv, '--execute'],
      env,
      request: async (path, init) => (path === `/repos/${REPO}/commits/${INSTALLER}` ? { status: 200, body: fixtures.appSignedConstructed } : constructed.request(path, init)),
      now: NOW,
    });
    expect(accepted.ok, accepted.problems.join('\n')).toBe(true);
    expect(constructed.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
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

describe('HIGH-1: the founder token mint asks for workflows:write and says so plainly when the App lacks it', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const pemPath = join(work, 'throwaway-app.pem');
  writeFileSync(pemPath, rsa);
  const mintPath = join(work, 'mint.mjs');
  writeFileSync(mintPath, boot.FOUNDER_MINT_JS.join('\n'));
  // A stubbed GitHub: the installation lookup, then the token mint. No network is reached.
  const stub = (permissions: Record<string, string>, mintStatus: number) => {
    const preload = join(work, `stub-${mintStatus}-${Object.keys(permissions).length}.mjs`);
    writeFileSync(preload, [
      'const requests = [];',
      'globalThis.fetch = async (url, init = {}) => {',
      '  requests.push(init.body ? JSON.parse(init.body) : null);',
      '  process.env.STUB_LAST_BODY = init.body ?? "";',
      `  if (String(url).endsWith('/installation')) return new Response(JSON.stringify({ id: 1, permissions: ${JSON.stringify(permissions)} }), { status: 200 });`,
      `  return new Response(JSON.stringify({ message: 'secret-body-marker', token: 'ghs_never_print_me' }), { status: ${mintStatus} });`,
      '};',
    ].join('\n'));
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, mintPath], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, JULIUS_APP_PEM_FILE: pemPath, JULIUS_GOVERNED_LANDER_APP_ID: APP },
      encoding: 'utf8',
    });
  };
  const full = { contents: 'write', metadata: 'read', actions: 'read', workflows: 'write', actions_variables: 'read' };

  it('a 422 from the mint prints the plain Workflows message and nothing else', () => {
    const result = stub(full, 422);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(boot.WORKFLOWS_PERMISSION_MESSAGE);
    for (const secret of ['secret-body-marker', 'ghs_never_print_me', 'PRIVATE KEY', rsa.split('\n')[1]]) expect(result.stderr).not.toContain(secret);
  });

  it('an installation without Workflows: write is refused before the mint is requested', () => {
    const withoutWorkflows = { ...full, workflows: 'read' };
    const result = stub(withoutWorkflows, 201);
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(boot.WORKFLOWS_PERMISSION_MESSAGE);
    expect(result.stdout).toBe('');
  });

  it('a granted App gets a token for this repository with workflows:write, and only the token reaches stdout', () => {
    const recorded = join(work, 'mint-request.json');
    const preload = join(work, 'stub-granted.mjs');
    writeFileSync(preload, [
      'import { writeFileSync } from "node:fs";',
      'globalThis.fetch = async (url, init = {}) => {',
      '  if (String(url).endsWith("/installation")) return new Response(JSON.stringify({ id: 1, permissions: ' + JSON.stringify(full) + ' }), { status: 200 });',
      '  writeFileSync(' + JSON.stringify(recorded) + ', init.body);',
      '  return new Response(JSON.stringify({ token: "ghs_fixture_token" }), { status: 201 });',
      '};',
    ].join('\n'));
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, mintPath], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, JULIUS_APP_PEM_FILE: pemPath, JULIUS_GOVERNED_LANDER_APP_ID: APP },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('ghs_fixture_token');
    expect(result.stderr).toBe('');
    expect(JSON.parse(readFileSync(recorded, 'utf8'))).toEqual({ repositories: ['sunday-relay'], permissions: full });
  });
});

describe('F4: the founder block gates --execute on green required checks on the target', () => {
  const ciGate = (runs: unknown) => {
    const lines = (boot as unknown as { FOUNDER_CI_GATE_JS: string[] }).FOUNDER_CI_GATE_JS;
    const source = lines.join('\n');
    // The block runs this same script.
    expect(boot.founderCommandBlock({ target: TARGET })).toContain(lines[0]!);
    const script = join(work, 'ci-gate.cjs');
    writeFileSync(script, source);
    const preload = join(work, 'ci-gate-stub.cjs');
    writeFileSync(preload, `require('node:child_process').execFileSync = () => ${JSON.stringify(JSON.stringify(runs))};`);
    return spawnSync(process.execPath, ['--require', preload, script, TARGET], { cwd: ROOT, encoding: 'utf8' });
  };
  const run = (name: string, conclusion: string, app = 15368) => ({ name, status: 'completed', conclusion, app: { id: app } });
  const required = readFileSync(join(ROOT, '.github/julius-landing/required-checks.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => /^(.*\S)\s+@([0-9]+)$/u.exec(l)).map((m, i, all) => (m ? { name: m[1], app: Number(m[2]) } : { name: String(all[i]), app: 15368 }));

  it('passes only when every required check is one green run from its App', () => {
    const green = required.map((r) => run(r.name!, 'success', r.app));
    expect(ciGate({ total_count: green.length, check_runs: green }).status).toBe(0);
    const red = [...green.slice(1), run(required[0]!.name!, 'failure', required[0]!.app)];
    const failed = ciGate({ total_count: red.length, check_runs: red });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(required[0]!.name);
    const wrongApp = [...green.slice(1), run(required[0]!.name!, 'success', 1)];
    expect(ciGate({ total_count: wrongApp.length, check_runs: wrongApp }).status).toBe(1);
    expect(ciGate({ total_count: green.length + 5, check_runs: green }).status).toBe(1);
  });
});

describe('a Windows checkout cannot hand the founder CRLF copies of the trusted files', () => {

  it('(a) .gitattributes turns line-ending conversion off for every TCB path and every checkpoint record', async () => {
    const trust = (await import(pathToFileURL(join(ROOT, 'scripts/julius-main-provenance-trust.mjs')).href)) as { TRUSTED_COMPUTING_BASE: readonly string[] };
    const attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8').split('\n').map((line) => line.trim());
    for (const path of trust.TRUSTED_COMPUTING_BASE) expect(attributes, path).toContain(`${path} -text`);
    expect(attributes).toContain('.github/julius-landing/checkpoints/** -text');
    // Git itself reads them that way.
    const checked = spawnSync('git', ['check-attr', 'text', '--', ...trust.TRUSTED_COMPUTING_BASE, '.github/julius-landing/checkpoints/x.founder.sig'], { cwd: ROOT, encoding: 'utf8' });
    expect(checked.status).toBe(0);
    for (const line of checked.stdout.trim().split('\n')) expect(line, line).toMatch(/: text: unset$/u);
  });

  it('(b) the founder block refuses a trusted file that is not the target\'s exact bytes, and says how to check out', () => {
    const block = boot.founderCommandBlock({ target: TARGET });
    expect(block).toContain('git -c core.autocrlf=false checkout --detach "$TARGET"');
    const loop = block.split('\n').find((line) => line.startsWith('for p in ') && line.includes('tcb_checkout_differs')) ?? '';
    expect(loop).not.toBe('');
    // A throwaway repository holding one trusted file with LF line endings, as the API blob is.
    const repo = mkdtempSync(join(tmpdir(), 'julius-tcb-checkout-'));
    const git = (...args: string[]) => spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' });
    try {
      git('init', '-q');
      mkdirSync(join(repo, 'scripts'), { recursive: true });
      const lf = 'line one\nline two\n';
      writeFileSync(join(repo, 'scripts/julius-governed-bootstrap.mjs'), lf);
      git('add', '.');
      git('commit', '-q', '-m', 'target');
      const target = git('rev-parse', 'HEAD').stdout.trim();
      const run = () => spawnSync('bash', ['-c', `set -euo pipefail; TARGET=${target}; ${loop}`], { cwd: repo, encoding: 'utf8' });
      expect(run().status, 'exact bytes pass').toBe(0);
      writeFileSync(join(repo, 'scripts/julius-governed-bootstrap.mjs'), lf.replaceAll('\n', '\r\n'));
      const crlf = run();
      expect(crlf.status, 'a CRLF copy is refused').not.toBe(0);
      expect(crlf.stderr).toContain('tcb_checkout_differs: scripts/julius-governed-bootstrap.mjs');
      writeFileSync(join(repo, 'scripts/julius-governed-bootstrap.mjs'), lf);
      mkdirSync(join(repo, '.github/julius-landing'), { recursive: true });
      writeFileSync(join(repo, '.github/julius-landing/land-lib.mjs'), 'not on the target\n');
      const extra = run();
      expect(extra.status, 'a trusted file the target does not have is refused').not.toBe(0);
      expect(extra.stderr).toContain('tcb_checkout_unexpected: .github/julius-landing/land-lib.mjs');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('LOW: both repo variables are compared after trimming CR and whitespace, as parseAnchor does', () => {
    const block = boot.founderCommandBlock({ target: TARGET });
    expect(block).toContain("JULIUS_REVIEWER_KEY_SHA256 --jq .value | tr -d '[:space:]')\" = \"$REVIEWER_PIN\"");
    expect(block).toContain("JULIUS_FOUNDER_APPROVAL_KEY_SHA256 --jq .value | tr -d '[:space:]')\" = \"$(printf '%s' \"$FOUNDER_FINGERPRINT\" | tr -d '[:space:]')\"");
  });
});

void appSigned;
