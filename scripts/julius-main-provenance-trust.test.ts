import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { evaluateMainProvenance } from './julius-main-provenance.mjs';
import {
  ATTESTATION_EXPIRES,
  ATTESTATION_ISSUED,
  CHECKPOINT_HEADER,
  EXTERNAL_ANCHOR_VARIABLE,
  HISTORICAL_TCB,
  INSTALLER_RECOVERY,
  LANDING_REPO,
  PINNED_REVIEWER_RAW_KEY,
  PINNED_REVIEWER_SPKI_SHA256,
  RECORDED_RANGE,
  TRUSTED_CHECKPOINT_BASE,
  TRUSTED_CHECKPOINT_HEAD,
  TRUSTED_CHECKPOINT_SHA,
  TRUSTED_CHECKPOINT_TREE,
  TRUSTED_COMPUTING_BASE,
  attestationNonce,
  commitIdentityFields,
  landingIdentityProblem,
  attestationShapeProblem,
  attestationNonceProblems,
  canonicalCheckpointAttestation,
  classifyCommit,
  classifyRecordedRange,
  commitsMatch,
  evaluateTrustChain,
  exactFingerprintMatch,
  isCheckpointInstallerDiff,
  judgeAttestationWindow,
  parseCheckpointAttestation,
  requireTrustedVerifier,
  reviewerKeyPinRefusal,
  founderKeyPinRefusal,
} from './julius-main-provenance-trust.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const REAL_PEM = readFileSync(join(ROOT, '.github/julius-landing/reviewer-ed25519.pub'), 'utf8');
const PIN = PINNED_REVIEWER_SPKI_SHA256;
const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', cwd: ROOT });

/**
 * Relay CI checks out the pull request at depth 1, so the trusted checkpoint
 * is not in the clone. Fetch that commit (and the other recorded commits)
 * by full SHA. A full local clone already has them and does not fetch.
 */
function ensureCommit(sha: string, depth: number) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    execFileSync('git', ['fetch', `--depth=${depth}`, 'origin', sha], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  }
}
ensureCommit(TRUSTED_CHECKPOINT_SHA, 2);
ensureCommit(TRUSTED_CHECKPOINT_BASE, 1);
ensureCommit('689d2be92c3158ba4a59883ed4f6cc02f700660b', 1);
ensureCommit('f539cab2530b7733bd987068be676308440e04a5', 1);
/** #453's head, which pinned the 7eacf984 key this branch rotates away from. */
const PREVIOUS_PIN_HEAD = '7e945915a886deaee87de4a395947a36398e75bb';
ensureCommit(PREVIOUS_PIN_HEAD, 1);
const attacker = generateKeyPairSync('ed25519');
const attackerPem = attacker.publicKey.export({ type: 'spki', format: 'pem' }).toString();

const unsignedPath = join(ROOT, 'docs/provenance/checkpoint-2528ac5c-f539cab2.unsigned.txt');
const unsignedText = readFileSync(unsignedPath, 'utf8');

describe('the pinned reviewer key', () => {
  it('is the full SPKI SHA-256 and the raw 32 bytes, and a prefix is not a match', () => {
    expect(PIN).toHaveLength(64);
    expect(PINNED_REVIEWER_RAW_KEY).toHaveLength(64);
    expect(exactFingerprintMatch(PIN, PIN)).toBe(true);
    expect(exactFingerprintMatch(PIN.slice(0, 8), PIN)).toBe(false);
    expect(exactFingerprintMatch(`${PIN.slice(0, 8)}${'0'.repeat(56)}`, PIN)).toBe(false);
    expect(exactFingerprintMatch(PIN.slice(0, 63), PIN)).toBe(false);
  });

  it('is the rotated independent-review key 12c9b185', () => {
    expect(PIN).toBe('12c9b1853c4c33322241273f386b0fd08fdefd08134c911dd4024c5bb5cdff13');
    expect(PINNED_REVIEWER_RAW_KEY).toBe('e033a345ed082b8126c8c6d9ad43cb54a4c854fe8c5423c2fc7ed475ee5461b5');
    expect(REAL_PEM).toBe('-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA4DOjRe0IK4EmyMbZrUPLVKTIVP6MVCPC/H7Ude5UYbU=\n-----END PUBLIC KEY-----\n');
  });

  it('matches the public key in the worktree; earlier commits, including the 7eacf984 repin, carry a key it refuses', () => {
    expect(reviewerKeyPinRefusal(REAL_PEM, PIN)).toBeNull();
    for (const rev of [TRUSTED_CHECKPOINT_SHA, TRUSTED_CHECKPOINT_BASE, 'f539cab2530b7733bd987068be676308440e04a5', '689d2be92c3158ba4a59883ed4f6cc02f700660b', PREVIOUS_PIN_HEAD]) {
      const pem = git(['show', `${rev}:.github/julius-landing/reviewer-ed25519.pub`]);
      expect(reviewerKeyPinRefusal(pem, PIN)?.reason, rev).toMatch(/not the pinned reviewer key/u);
    }
  });

  it('the lander copy of the pin does not drift', async () => {
    const land = await import(pathToFileURL(join(ROOT, '.github/julius-landing/land-lib.mjs')).href) as {
      PINNED_REVIEWER_SPKI_SHA256: string;
      PINNED_REVIEWER_RAW_KEY: string;
    };
    expect(land.PINNED_REVIEWER_SPKI_SHA256).toBe(PIN);
    expect(land.PINNED_REVIEWER_RAW_KEY).toBe(PINNED_REVIEWER_RAW_KEY);
  });

  it('refuses a missing or different external anchor, including a short prefix', () => {
    expect(reviewerKeyPinRefusal(REAL_PEM, undefined)?.reason).toBe(`${EXTERNAL_ANCHOR_VARIABLE} is unset`);
    expect(reviewerKeyPinRefusal(REAL_PEM, '')?.reason).toBe(`${EXTERNAL_ANCHOR_VARIABLE} is unset`);
    expect(reviewerKeyPinRefusal(REAL_PEM, `${PIN.slice(0, 8)}${'0'.repeat(56)}`)?.reason).toContain('does not match');
    // Not 64 lowercase hex: refused before any compare, with its own reason.
    expect(reviewerKeyPinRefusal(REAL_PEM, PIN.slice(0, 8))?.reason).toMatch(/^reviewer_anchor_not_sha256/u);
    expect(reviewerKeyPinRefusal(attackerPem, PIN)?.reason).toContain(`not the pinned reviewer key ${PIN}`);
  });
});

describe('the recorded range stays non-provenant until a signature covers it', () => {
  it('classifies the three commits after 2528ac5c and does not call any of them provenant', () => {
    const rows = classifyRecordedRange();
    expect(rows.map((row) => row.sha)).toEqual(RECORDED_RANGE.map((row) => row.sha));
    expect(rows.map((row) => row.classification)).toEqual(['founder-exact-head', 'founder-squash', 'g6']);
    for (const row of rows) {
      expect(row.provenant, row.sha).toBe(false);
      expect(row.basis).toBe(RECORDED_RANGE.find((known) => known.sha === row.sha)?.basis);
    }
    expect(rows[2]?.touchesVerifier).toBe(true);
  });

  it('a known commit with a different tree is unprovenanced', () => {
    const row = classifyCommit({ sha: RECORDED_RANGE[2]!.sha, tree: 'a'.repeat(40) });
    expect(row.provenant).toBe(false);
    expect(row.classification).toBe('unprovenanced');
    expect(row.reason).toContain(RECORDED_RANGE[2]!.tree);
  });

  it('git author name, email and login never classify a commit', () => {
    const row = classifyCommit({
      sha: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      authorName: 'julius-worker[bot]',
      authorEmail: '325202980+julius-worker[bot]@users.noreply.github.com',
      authorLogin: 'julius-worker[bot]',
    } as { sha: string; tree: string });
    expect(row.classification).toBe('unprovenanced');
    expect(row.provenant).toBe(false);
  });
});

describe('JULIUS-CHECKPOINT-V1', () => {
  const text = canonicalCheckpointAttestation();

  it('the committed unsigned text is the historical attestation and is not a signature', () => {
    expect(unsignedText.startsWith(`${CHECKPOINT_HEADER}\n`)).toBe(true);
    expect(unsignedText).toContain('key-spki-sha256: b0b8e29b3efff5936dd51a54617ca8bda1b94e75557339821d7d00a98364d13a');
    expect(unsignedText).not.toBe(text);
    expect(unsignedText).not.toMatch(/signature/iu);
    expect(parseCheckpointAttestation(unsignedText).problems.join('\n')).toMatch(/key-spki-sha256 is not the pinned reviewer key 12c9b1853c4c33322241273f386b0fd08fdefd08134c911dd4024c5bb5cdff13/u);
    expect(parseCheckpointAttestation(text).problems).toEqual([]);
  });

  it('refuses a wrong tree, a reorder, an extra commit, a missing commit, the wrong key, another repo, and a short prefix', () => {
    const parsed = parseCheckpointAttestation(text);
    expect(commitsMatch(RECORDED_RANGE, parsed.fields.commits)).toBe(true);
    const wrongTree = RECORDED_RANGE.map((row, index) => (index === 1 ? { ...row, tree: 'a'.repeat(40) } : row));
    expect(commitsMatch(wrongTree, parsed.fields.commits)).toBe(false);
    expect(commitsMatch([...RECORDED_RANGE].reverse(), parsed.fields.commits)).toBe(false);
    expect(commitsMatch([...RECORDED_RANGE, RECORDED_RANGE[0]!], parsed.fields.commits)).toBe(false);
    expect(commitsMatch(RECORDED_RANGE.slice(0, 2), parsed.fields.commits)).toBe(false);

    const wrongKey = text.replace(`key-spki-sha256: ${PIN}`, `key-spki-sha256: ${'ab'.repeat(32)}`);
    expect(parseCheckpointAttestation(wrongKey).problems.join(' ')).toContain('not the pinned reviewer key');
    const prefix = text.replace(`key-spki-sha256: ${PIN}`, `key-spki-sha256: ${PIN.slice(0, 8)}`);
    expect(parseCheckpointAttestation(prefix).problems.join(' ')).toContain('not the pinned reviewer key');
    const otherRepo = text.replace(`repo: ${LANDING_REPO}`, 'repo: someone/else');
    expect(parseCheckpointAttestation(otherRepo).problems.join(' ')).toContain('someone/else');
    expect(parseCheckpointAttestation(text.replace('repo: ohdieyuh-glitch/sunday-relay', 'repo: OHDIEYUH-GLITCH/sunday-relay')).problems).toEqual([]);
    expect(parseCheckpointAttestation(text).fields.tcb.map((row) => row.path)).toEqual(HISTORICAL_TCB.map((row) => row.path));
    expect(attestationNonceProblems(parseCheckpointAttestation(text).fields)).toBeNull();
    const rebound = text.replace(`nonce: ${attestationNonce(RECORDED_RANGE, HISTORICAL_TCB)}`, `nonce: ${'ab'.repeat(16)}`);
    expect(parseCheckpointAttestation(rebound).problems).toEqual([]);
    expect(attestationNonceProblems(parseCheckpointAttestation(rebound).fields)).toContain('does not bind');
  });

  it('the unsigned file does not make f539cab2 provenant', () => {
    const chain = evaluateTrustChain({
      tipSha: RECORDED_RANGE[2]!.sha,
      tipTree: RECORDED_RANGE[2]!.tree,
      commits: RECORDED_RANGE,
      attestationText: unsignedText,
      reviewerKeyPem: REAL_PEM,
      externalAnchor: PIN,
    });
    expect(chain.accepted).toBe(false);
    expect(chain.tipProvenant).toBe(false);
    expect(chain.reason).toMatch(/key-spki-sha256 is not the pinned reviewer key/u);
  });
});

describe('anchor variables are a trimmed sha256 hex, nothing else', () => {
  const founderPair = generateKeyPairSync('ed25519');
  const founderPem = founderPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const founderDer = Buffer.from(founderPair.publicKey.export({ type: 'spki', format: 'der' }));
  const founderSpki = createHash('sha256').update(founderDer).digest('hex');
  const base64Spki = founderDer.toString('base64');

  it('the reviewer anchor: a 64-hex value with a trailing CRLF passes; base64 SPKI text is reviewer_anchor_not_sha256', async () => {
    expect(reviewerKeyPinRefusal(REAL_PEM, `${PIN}\r\n`)).toBeNull();
    expect(reviewerKeyPinRefusal(REAL_PEM, `  ${PIN}\n`)).toBeNull();
    expect(reviewerKeyPinRefusal(REAL_PEM, Buffer.from(REAL_PEM).toString('base64'))?.reason).toMatch(/^reviewer_anchor_not_sha256: anchor is not a sha256 hex/u);
    expect(reviewerKeyPinRefusal(REAL_PEM, REAL_PEM)?.reason).toMatch(/^reviewer_anchor_not_sha256/u);
    expect(reviewerKeyPinRefusal(REAL_PEM, PIN.toUpperCase())?.reason).toMatch(/^reviewer_anchor_not_sha256/u);
    expect(reviewerKeyPinRefusal(REAL_PEM, '\r\n')?.reason).toMatch(/is unset/u);
    const land = await import(pathToFileURL(join(ROOT, '.github/julius-landing/land-lib.mjs')).href) as { externalAnchorProblems: (value: unknown) => string[] };
    expect(land.externalAnchorProblems(`${PIN}\r\n`)).toEqual([]);
    expect(land.externalAnchorProblems(Buffer.from(REAL_PEM).toString('base64')).join('\n')).toMatch(/^reviewer_anchor_not_sha256: anchor is not a sha256 hex/u);
  });

  it('the founder anchor: a 64-hex value with a trailing CRLF passes the parse; base64 SPKI text is founder_anchor_not_sha256', () => {
    expect(founderKeyPinRefusal(founderPem, `${founderSpki}\r\n`)).toBeNull();
    expect(founderKeyPinRefusal(founderPem, base64Spki)).toMatch(/founder approval: founder_anchor_not_sha256: anchor is not a sha256 hex/u);
    expect(founderKeyPinRefusal(founderPem, founderSpki.toUpperCase())).toMatch(/founder_anchor_not_sha256/u);
    expect(founderKeyPinRefusal(founderPem, '0'.repeat(64))).toMatch(/founder_anchor_mismatch/u);
  });
});

describe('the landing identity is the App bot author, signed by GitHub as web-flow (real response shapes)', () => {
  // FETCHED: spoofBotUnsigned (ac05075be7), userTokenUnsigned (910e81d3ef), webUiHuman (f539cab2).
  // CONSTRUCTED: appSignedConstructed (f539cab2 with the bot as author). See _provenance in the file.
  const fixtures = JSON.parse(readFileSync(join(ROOT, 'scripts/julius-landing-identity-fixtures.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  const BOT = '347502603';
  const judge = (body: Record<string, unknown>) => landingIdentityProblem({ ...commitIdentityFields(body), botId: BOT });
  const variant = (change: (body: Record<string, any>) => void) => {
    const body = JSON.parse(JSON.stringify(fixtures.appSignedConstructed));
    change(body);
    return judge(body);
  };

  it('accepts the App-created shape: bot author, web-flow committer GitHub <noreply@github.com>, verified valid (constructed)', () => {
    expect(judge(fixtures.appSignedConstructed!)).toBeNull();
  });

  it('refuses REVIEW\'s probe ac05075be7: a user token naming the bot as author gives author = committer = bot, unsigned (fetched)', () => {
    expect(judge(fixtures.spoofBotUnsigned!)).toMatch(/no GitHub-verified signature/u);
    // Even if such a commit were signed, a committer equal to the bot is not GitHub's signer.
    const signed = JSON.parse(JSON.stringify(fixtures.spoofBotUnsigned));
    signed.commit.verification = { verified: true, reason: 'valid' };
    expect(judge(signed)).toMatch(/not GitHub's web-flow signer/u);
  });

  it('refuses 910e81d3ef: a user-token API commit, unsigned (fetched)', () => {
    expect(judge(fixtures.userTokenUnsigned!)).toMatch(/no GitHub-verified signature/u);
  });

  it('refuses f539cab2: a web-UI commit, web-flow signed and valid, with a human author (fetched)', () => {
    expect(judge(fixtures.webUiHuman!)).toMatch(/the landing author is not the governed lander bot 347502603/u);
  });

  it('refuses each single deviation from the App shape', () => {
    expect(variant((b) => { b.author.type = 'User'; })).toMatch(/author is not the governed lander bot/u);
    expect(variant((b) => { b.author.id = 225496319; })).toMatch(/author is not the governed lander bot/u);
    expect(variant((b) => { b.commit.verification = { verified: false, reason: 'unsigned' }; })).toMatch(/no GitHub-verified signature/u);
    expect(variant((b) => { b.commit.verification = { verified: true, reason: 'unknown_key' }; })).toMatch(/no GitHub-verified signature/u);
    expect(variant((b) => { b.committer = { login: 'ohdieyuh-glitch', id: 225496319, type: 'User' }; })).toMatch(/not GitHub's web-flow signer/u);
    expect(variant((b) => { b.committer = { login: 'julius-governed-lander[bot]', id: 347502603, type: 'Bot' }; })).toMatch(/not GitHub's web-flow signer/u);
    expect(variant((b) => { b.commit.committer = { name: 'GitHub', email: 'someone@example.com' }; })).toMatch(/not GitHub's web-flow signer/u);
    expect(variant((b) => { b.commit.committer = { name: 'Not GitHub', email: 'noreply@github.com' }; })).toMatch(/not GitHub's web-flow signer/u);
    expect(variant((b) => { b.commit.author.email = 'ohdieyuh@gmail.com'; })).toMatch(/author email is not the noreply address/u);
    expect(variant((b) => { b.commit.author.email = '1+julius-governed-lander[bot]@users.noreply.github.com'; })).toMatch(/author email is not the noreply address/u);
    expect(landingIdentityProblem({ ...commitIdentityFields(fixtures.appSignedConstructed!), botId: '' })).toMatch(/JULIUS_GOVERNED_LANDER_BOT_ID is unset/u);
  });
});

describe('the checkpoint directory shape (L4)', () => {
  const cp = 'a'.repeat(40);
  const text = canonicalCheckpointAttestation({ checkpoint: cp, commits: [{ sha: cp, tree: 'b'.repeat(40), basis: 'shape' }], tcb: [{ path: 'x', sha256: 'c'.repeat(64) }] });
  it('requires <checkpoint>.founder.sig beside the .txt and .sig', () => {
    expect(attestationShapeProblem({ names: [`${cp}.sig`, `${cp}.txt`], text })).toMatch(/^founder_signature_missing: the checkpoint attestation has no founder-approval signature/u);
    expect(attestationShapeProblem({ names: [`${cp}.founder.sig`, `${cp}.txt`], text })).toMatch(/^reviewer_signature_missing/u);
    expect(attestationShapeProblem({ names: [`${cp}.founder.sig`, `${cp}.sig`, `${cp}.txt`], text })).toBeNull();
  });
  it('F5f: the monotonicity gate accept-main runs is in the trusted computing base and the heredoc', () => {
    expect(TRUSTED_COMPUTING_BASE).toContain('scripts/julius-main-monotonicity.mjs');
    expect(readFileSync(join(ROOT, '.github/workflows/julius-accept-main.yml'), 'utf8')).toContain('          scripts/julius-main-monotonicity.mjs\n          EOF');
  });
  it('M2: accepts a prior only from the allowed list', () => {
    const prev = 'd'.repeat(40);
    const refreshed = canonicalCheckpointAttestation({ prior: prev, checkpoint: cp, commits: [{ sha: cp, tree: 'b'.repeat(40), basis: 'shape' }], tcb: [{ path: 'x', sha256: 'c'.repeat(64) }] });
    const names = [`${cp}.founder.sig`, `${cp}.sig`, `${cp}.txt`];
    expect(attestationShapeProblem({ names, text: refreshed })).toMatch(/prior is not the trusted checkpoint/u);
    expect(attestationShapeProblem({ names, text: refreshed, allowedPriors: [TRUSTED_CHECKPOINT_SHA, prev] })).toBeNull();
  });
});

describe('adversarial refusals', () => {
  const message = git(['cat-file', '-p', TRUSTED_CHECKPOINT_SHA]).split('\n\n').slice(1).join('\n\n');
  const paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', TRUSTED_CHECKPOINT_SHA]).trim().split('\n');

  const historical = (over: Record<string, unknown> = {}) => evaluateMainProvenance({
    repo: LANDING_REPO,
    mainSha: TRUSTED_CHECKPOINT_SHA,
    mainShaAfter: TRUSTED_CHECKPOINT_SHA,
    mainTreeSha: TRUSTED_CHECKPOINT_TREE,
    mainParents: [TRUSTED_CHECKPOINT_BASE],
    mainCommitMessage: message,
    reviewerKeyPem: REAL_PEM,
    reviewerKeyAtSha: TRUSTED_CHECKPOINT_BASE,
    tipReviewerKeyPem: REAL_PEM,
    changedPaths: paths,
    changedPathsComplete: true,
    headCommit: { sha: TRUSTED_CHECKPOINT_HEAD, treeSha: TRUSTED_CHECKPOINT_TREE, authenticatedAuthor: { login: 'julius-worker[bot]', source: 'pull-opener', accountType: 'Bot' } },
    externalReviewerKeySha256: PIN,
    ...over,
  } as Parameters<typeof evaluateMainProvenance>[0]);

  it('the checkpoint landing was signed by the previous key, so it is not provenant under this pin', () => {
    const result = historical();
    expect(result.verdict, result.reason).toBe('unprovenanced');
    expect(result.reason).toMatch(/does not verify against the reviewer key committed at the parent/u);
    const chain = evaluateTrustChain({
      tipSha: TRUSTED_CHECKPOINT_SHA,
      tipTree: TRUSTED_CHECKPOINT_TREE,
      reviewerKeyPem: REAL_PEM,
      externalAnchor: PIN,
    });
    expect(chain.tipProvenant).toBe(true);
    expect(chain.reason).toContain('39335737220');
  });

  it('(a) an attacker key that signs the tip is refused because it is not the pin', () => {
    const text = ['JULIUS-CLEARANCE-V1', `repo: ${LANDING_REPO}`, 'pr: 1', `head: ${'3'.repeat(40)}`, `tree: ${'4'.repeat(40)}`, `base: ${'2'.repeat(40)}`, 'kind: CLEARED', `bot-comments-sha256: ${'c'.repeat(64)}`, 'governed-exceptions: -', `nonce: ${'ab'.repeat(16)}`, 'by: INDEPENDENT_REVIEW', 'issued: 2026-10-23T00:00:00Z', 'expires: 2026-10-24T00:00:00Z', ''].join('\n');
    const signature = sign(null, Buffer.from(text, 'utf8'), attacker.privateKey).toString('base64');
    const block = ['-----BEGIN JULIUS LANDING-----', 'v: 1', `clearance-nonce: ${'ab'.repeat(16)}`, `clearance-b64: ${Buffer.from(text).toString('base64')}`, `signature-b64: ${signature}`, '-----END JULIUS LANDING-----'].join('\n');
    const result = evaluateMainProvenance({
      repo: LANDING_REPO,
      mainSha: '1'.repeat(40),
      mainShaAfter: '1'.repeat(40),
      mainTreeSha: '4'.repeat(40),
      mainParents: ['2'.repeat(40)],
      mainCommitMessage: `Julius: attacker\n\n${block}\n`,
      reviewerKeyPem: attackerPem,
      reviewerKeyAtSha: '2'.repeat(40),
      tipReviewerKeyPem: attackerPem,
      changedPaths: ['src/a.ts'],
      changedPathsComplete: true,
      headCommit: { sha: '3'.repeat(40), treeSha: '4'.repeat(40), authenticatedAuthor: { login: 'julius-worker[bot]', source: 'pull-opener', accountType: 'Bot' } },
      externalReviewerKeySha256: PIN,
    } as Parameters<typeof evaluateMainProvenance>[0]);
    expect(result.verdict).toBe('unprovenanced');
    expect(result.reason).toContain(`not the pinned reviewer key ${PIN}`);
    expect(result.reason).not.toMatch(/does not verify/u);
  });

  it('(b) the real signature with the parent key swapped is refused because of the pin', () => {
    const result = historical({ reviewerKeyPem: attackerPem, tipReviewerKeyPem: attackerPem });
    expect(result.verdict).toBe('unprovenanced');
    expect(result.reason).toContain(`not the pinned reviewer key ${PIN}`);
    expect(result.reason).not.toMatch(/does not verify/u);
  });

  it('(c) a chain whose recorded tree was altered is not accepted', () => {
    const altered = RECORDED_RANGE.map((row, index) => (index === 0 ? { ...row, tree: 'd'.repeat(40) } : row));
    const chain = evaluateTrustChain({
      tipSha: altered[2]!.sha,
      tipTree: altered[2]!.tree,
      commits: altered,
      attestationText: unsignedText,
      reviewerKeyPem: REAL_PEM,
      externalAnchor: PIN,
    });
    expect(chain.accepted).toBe(false);
    expect(chain.tipProvenant).toBe(false);
  });

  it('(d) a commit that changes the verifier is not a signed landing and is refused', () => {
    const chain = evaluateTrustChain({
      tipSha: 'e'.repeat(40),
      tipTree: 'f'.repeat(40),
      commits: [{ sha: 'e'.repeat(40), tree: 'f'.repeat(40), touchesVerifier: true }],
      reviewerKeyPem: REAL_PEM,
      externalAnchor: PIN,
    });
    expect(chain.accepted).toBe(false);
    expect(chain.tipProvenant).toBe(false);
    expect(chain.classifications[0]?.touchesVerifier).toBe(true);
    expect(chain.classifications[0]?.classification).not.toBe('signed-g6');
  });

  it('(e) the real signature fails closed when the external anchor is missing or different', () => {
    expect(historical({ externalReviewerKeySha256: undefined }).reason).toBe(`${EXTERNAL_ANCHOR_VARIABLE} is unset`);
    expect(historical({ externalReviewerKeySha256: `${PIN.slice(0, 8)}${'f'.repeat(56)}` }).reason).toContain('does not match');
    const badSignature = historical({
      mainCommitMessage: message.replace(/signature-b64: \S+/u, `signature-b64: ${Buffer.alloc(64, 7).toString('base64')}`),
    });
    expect(badSignature.verdict).toBe('unprovenanced');
    expect(badSignature.reason).toContain('does not verify');
  });

  it('(g) a direct push that is nobody\'s merge result is unprovenanced', () => {
    const result = evaluateMainProvenance({
      repo: LANDING_REPO,
      mainSha: '1'.repeat(40),
      mainShaAfter: '1'.repeat(40),
      mainTreeSha: '4'.repeat(40),
      mainParents: ['2'.repeat(40)],
      mainCommitMessage: 'pushed by hand\n',
      pullRequests: [],
    } as Parameters<typeof evaluateMainProvenance>[0]);
    expect(result.verdict).toBe('unprovenanced');
    expect(result.reason).toContain('no merged pull request records');
  });

  it('a signed landing directly on the checkpoint can be the tip; a covered founder tip cannot', () => {
    const landing = evaluateTrustChain({
      tipSha: '1'.repeat(40),
      tipTree: '4'.repeat(40),
      commits: [{ sha: '1'.repeat(40), tree: '4'.repeat(40), signedLanding: true }],
      reviewerKeyPem: REAL_PEM,
      externalAnchor: PIN,
    });
    expect(landing.accepted).toBe(true);
    expect(landing.tipProvenant).toBe(true);
    const covered = evaluateTrustChain({
      tipSha: RECORDED_RANGE[2]!.sha,
      tipTree: RECORDED_RANGE[2]!.tree,
      commits: RECORDED_RANGE,
      attestationText: unsignedText,
      signatureB64: Buffer.alloc(64, 9).toString('base64'),
      reviewerKeyPem: REAL_PEM,
      externalAnchor: PIN,
    });
    expect(covered.tipProvenant).toBe(false);
    expect(covered.reason).toMatch(/key-spki-sha256 is not the pinned reviewer key/u);
  });
});

describe('the founder installer diff is an exact path set', () => {
  const installer = 'b994daebe511e3bbddcd18edb1a7caf221810387';
  const afterCheckpoint = [
    installer,
    'bdd2194bb6d2a721da16e14546c7115915f5b5d3',
    'f9b5b051b546787b486079f945ced851b1f46382',
    '55beb365bef178bd4f717ee4b5ae9214dc124d59',
    '03591462e046bd8f3b1ed7687400ac48846e8642',
  ];

  it('accepts the real installer commit and the four commits after it, and nothing outside that exact set', () => {
    for (const sha of afterCheckpoint) {
      // diff-tree needs the parent. A depth-1 fetch of the commit leaves that parent out.
      ensureCommit(sha, 2);
      const paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]).trim().split('\n').filter((path) => path !== '');
      expect(paths.length, sha).toBeGreaterThan(0);
      expect(isCheckpointInstallerDiff(paths), `${sha} ${paths.join(' ')}`).toBe(true);
    }
    expect(isCheckpointInstallerDiff(['src/evil.ts'])).toBe(false);
    expect(isCheckpointInstallerDiff(['docs/provenance/checkpoint-2528ac5c-f539cab2.unsigned.txt', 'src/evil.ts'])).toBe(false);
    expect(isCheckpointInstallerDiff(['scripts/julius-main-provenance-trust.test.ts.bak'])).toBe(false);
    expect(isCheckpointInstallerDiff(['scripts/not-an-installer-test.ts'])).toBe(false);
    expect(isCheckpointInstallerDiff(['docs/provenance/other-attestation.txt'])).toBe(false);
    expect(isCheckpointInstallerDiff(['README.md'])).toBe(false);
    expect(isCheckpointInstallerDiff([])).toBe(false);
  });
});

describe('the checkpoint workflow and the working tree', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/julius-accept-main.yml'), 'utf8');
  const land = readFileSync(join(ROOT, '.github/workflows/julius-land.yml'), 'utf8');

  it('runs the attested verifier and cmps the attestation files to HEAD', () => {
    expect(workflow).not.toContain('working-directory: checkpoint-verifier');
    expect(workflow).not.toContain('path: checkpoint-verifier');
    expect(workflow).toContain('node scripts/julius-main-provenance-trust.mjs --require-trusted-verifier');
    expect(workflow).toContain('cmp -s');
    expect(workflow).toContain('.github/julius-landing/checkpoints/');
    expect(workflow).toContain('was swapped and does not match HEAD');
    expect(workflow).toContain(EXTERNAL_ANCHOR_VARIABLE);
    expect(land.indexOf('actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510')).toBeGreaterThan(land.indexOf('--require-trusted-verifier'));
    expect(land).toMatch(/fetch-depth:\s*0/u);
    expect(workflow).toMatch(/fetch-depth:\s*0/u);
    const provenance = readFileSync(join(ROOT, 'scripts/julius-main-provenance.mjs'), 'utf8');
    expect(provenance).toContain('annotateChainLandings');
    expect(provenance).not.toContain('index === commits.length - 1');
    const heredoc = workflow.split("done <<'EOF'\n")[1]?.split('\n          EOF')[0] ?? '';
    const listed = heredoc.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    expect(listed).toEqual([...TRUSTED_COMPUTING_BASE]);
    expect(TRUSTED_COMPUTING_BASE).toContain('.github/julius-landing/reviewer-ed25519.pub');
    expect(TRUSTED_COMPUTING_BASE).toContain('scripts/julius-main-provenance-trust.mjs');
    expect(TRUSTED_COMPUTING_BASE).toContain('scripts/julius-main-provenance-trust.d.mts');
  });

  it('a tree without a signed checkpoint attestation is not a trusted verifier, and an env attestation is not a substitute', async () => {
    // Since the bootstrap, this repository's own tree carries the signed attestation, so the rule is
    // checked against a root without one: before or after the bootstrap, the env never stands in for it.
    const bare = mkdtempSync(join(tmpdir(), 'julius-no-checkpoint-'));
    try {
      const result = await requireTrustedVerifier({
        ...process.env,
        [EXTERNAL_ANCHOR_VARIABLE]: PIN,
        JULIUS_CHECKPOINT_ATTESTATIONS: unsignedText,
        JULIUS_CHECKPOINT_ATTESTATION_SIGNATURE: Buffer.alloc(64, 9).toString('base64'),
      }, { root: bare });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain(INSTALLER_RECOVERY);
      mkdirSync(join(bare, '.github/julius-landing/checkpoints'), { recursive: true });
      const empty = await requireTrustedVerifier({
        ...process.env,
        [EXTERNAL_ANCHOR_VARIABLE]: PIN,
        JULIUS_CHECKPOINT_ATTESTATIONS: unsignedText,
      }, { root: bare });
      expect(empty.ok).toBe(false);
      expect(empty.reason).toContain(INSTALLER_RECOVERY);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
    expect(readFileSync(join(ROOT, '.github/julius-landing/README.md'), 'utf8')).toContain(INSTALLER_RECOVERY);
  });

  it('B2: the tree carries no stale checkpoint attestation, so the bootstrap leaves exactly one', () => {
    // 10aedd11's unsigned attestation was on #453's head. The bootstrap only adds
    // <target>.txt and its signatures, so a stale file would leave two
    // attestations on main and every gate would refuse. Before the bootstrap the
    // tree has none; after it, exactly the one attested checkpoint's three files.
    const checkpoint = '10aedd11643a1d717311b5824d54e863aa94d763';
    const dir = join(ROOT, '.github/julius-landing/checkpoints');
    const names = (existsSync(dir) ? readdirSync(dir) : []).filter((name) => /^[0-9a-f]{40}\./u.test(name)).sort();
    if (names.length > 0) {
      const attested = names[0]?.slice(0, 40) ?? '';
      expect(attested).not.toBe(checkpoint);
      expect(names).toEqual([`${attested}.founder.sig`, `${attested}.sig`, `${attested}.txt`]);
    }
    const stale = git(['show', `${PREVIOUS_PIN_HEAD}:.github/julius-landing/checkpoints/${checkpoint}.txt`]);
    expect(createHash('sha256').update(stale).digest('hex')).toBe('a4fde0b67e790890fa58b2998d8ed88b436f67c2ff2bde49c98fd59f70cb8d25');
    expect(parseCheckpointAttestation(stale).fields.checkpoint).toBe(checkpoint);
    const installer = 'b994daebe511e3bbddcd18edb1a7caf221810387';
    ensureCommit(checkpoint, 1);
    ensureCommit(installer, 1);
    const installerParents = git(['cat-file', '-p', installer]).split('\n').filter((line) => line.startsWith('parent ')).map((line) => line.slice('parent '.length));
    expect(installerParents, installer).toEqual([checkpoint]);
    const isAncestor = (older: string, newer: string) => {
      try {
        git(['merge-base', '--is-ancestor', older, newer]);
        return true;
      } catch {
        return false;
      }
    };
    const head = git(['rev-parse', 'HEAD']).trim();
    const shallow = () => git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
    // A depth-1 checkout has these objects only after ensureCommit, and the
    // path from HEAD to them is missing until the shallow boundary moves.
    for (let attempt = 0; shallow() && !isAncestor(installer, head) && attempt < 20; attempt += 1) {
      execFileSync('git', ['fetch', '--deepen=1000', 'origin', head], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    }
    expect(isAncestor(installer, head), installer).toBe(true);
    expect(isAncestor(checkpoint, head), checkpoint).toBe(true);
  });
});

describe('attestation lifetime', () => {
  const fields = { issued: ATTESTATION_ISSUED, expires: ATTESTATION_EXPIRES };

  it('accepts the closed window and refuses expired, not-yet-valid, and a 2020 attestation', () => {
    expect(judgeAttestationWindow(fields, Date.parse(ATTESTATION_ISSUED))).toBeNull();
    expect(judgeAttestationWindow(fields, Date.parse(ATTESTATION_EXPIRES))).toBeNull();
    expect(judgeAttestationWindow(fields, Date.parse(ATTESTATION_ISSUED) - 1000)).toContain('not yet valid');
    expect(judgeAttestationWindow(fields, Date.parse(ATTESTATION_EXPIRES) + 1000)).toContain('expired');
    expect(judgeAttestationWindow({ issued: '2020-01-01T00:00:00Z', expires: '2020-01-02T00:00:00Z' }, Date.parse('2026-10-23T18:30:00Z'))).toContain('expired');
  });
});

describe('the lander pin compare, against the real module', () => {
  it('refuses a prefix, a prefix padded with zeros, uppercase, a missing anchor, and the wrong key', async () => {
    const land = await import(pathToFileURL(join(ROOT, '.github/julius-landing/land-lib.mjs')).href) as {
      exactPinnedFingerprint: (spki: string, raw: string) => boolean;
      reviewerKeyMaterialProblems: (pem: string) => string[];
      externalAnchorProblems: (external?: string) => string[];
      verifyClearanceSignature: (text: string, signature: string, pem: string) => string[];
      PINNED_REVIEWER_SPKI_SHA256: string;
      PINNED_REVIEWER_RAW_KEY: string;
    };
    const pin = land.PINNED_REVIEWER_SPKI_SHA256;
    const raw = land.PINNED_REVIEWER_RAW_KEY;
    expect(land.exactPinnedFingerprint(pin, raw)).toBe(true);
    expect(land.exactPinnedFingerprint(pin.slice(0, 8), raw)).toBe(false);
    expect(land.exactPinnedFingerprint(`${pin.slice(0, 8)}${'0'.repeat(56)}`, raw)).toBe(false);
    expect(land.exactPinnedFingerprint(pin.toUpperCase(), raw)).toBe(false);
    expect(land.exactPinnedFingerprint(pin, '0'.repeat(64))).toBe(false);
    expect(land.reviewerKeyMaterialProblems(REAL_PEM)).toEqual([]);
    expect(land.reviewerKeyMaterialProblems(attackerPem).join(' ')).toContain(`not the pinned reviewer key ${pin}`);
    expect(land.externalAnchorProblems(undefined)).toEqual([`${EXTERNAL_ANCHOR_VARIABLE} is unset`]);
    expect(land.externalAnchorProblems('')).toEqual([`${EXTERNAL_ANCHOR_VARIABLE} is unset`]);
    expect(land.externalAnchorProblems(pin.slice(0, 8)).join(' ')).toMatch(/reviewer_anchor_not_sha256/u);
    expect(land.externalAnchorProblems(`${pin.slice(0, 8)}${'0'.repeat(56)}`).join(' ')).toContain('does not match');
    expect(land.externalAnchorProblems(pin.toUpperCase()).join(' ')).toMatch(/reviewer_anchor_not_sha256/u);
    expect(land.externalAnchorProblems(pin)).toEqual([]);
    const bad = Buffer.alloc(64, 3).toString('base64');
    expect(land.verifyClearanceSignature('not a clearance\n', bad, REAL_PEM).join(' ')).toContain('does not verify');
    expect(land.verifyClearanceSignature('not a clearance\n', bad, attackerPem).join(' ')).toContain(`not the pinned reviewer key ${pin}`);
    expect(land.verifyClearanceSignature('not a clearance\n', bad, attackerPem).join(' ')).not.toContain('does not verify');
  });
});

describe('mutation of the pin comparison and the chain comparison', () => {
  const source = readFileSync(join(ROOT, 'scripts/julius-main-provenance-trust.mjs'), 'utf8');
  const driver = (mod: {
    exactFingerprintMatch: (actual: unknown, expected: unknown) => boolean;
    commitsMatch: (actual: unknown, listed: unknown) => boolean;
    PINNED_REVIEWER_SPKI_SHA256: string;
  }) => {
    const pin = mod.PINNED_REVIEWER_SPKI_SHA256;
    if (!mod.exactFingerprintMatch(pin, pin)) throw new Error('real pin must match');
    if (mod.exactFingerprintMatch(`${pin.slice(0, 8)}${'0'.repeat(56)}`, pin)) throw new Error('prefix must not match');
    if (mod.exactFingerprintMatch(pin.slice(0, 8), pin)) throw new Error('short must not match');
    const one = { sha: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const two = { sha: 'c'.repeat(40), tree: 'd'.repeat(40) };
    if (!mod.commitsMatch([one, two], [one, two])) throw new Error('same list must match');
    if (mod.commitsMatch([one, two], [two, one])) throw new Error('reorder must not match');
    if (mod.commitsMatch([one], [{ sha: one.sha, tree: 'e'.repeat(40) }])) throw new Error('wrong tree must not match');
    if (mod.commitsMatch([one, two], [one])) throw new Error('extra must not match');
    if (mod.commitsMatch([one], [one, two])) throw new Error('missing must not match');
  };

  const killed = async (name: string, transform: (text: string) => string) => {
    const directory = mkdtempSync(join(tmpdir(), 'julius-trust-mutant-'));
    const file = join(directory, 'mutant.mjs');
    const next = transform(source);
    expect(next, `${name} did not change the source`).not.toBe(source);
    writeFileSync(file, next);
    try {
      const mod = await import(pathToFileURL(file).href);
      let failed = false;
      try { driver(mod); } catch { failed = true; }
      expect(failed, `${name} survived`).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  it('kills a prefix compare, a flipped compare, a dropped length check, and a dropped tree compare', async () => {
    const survivors: string[] = [];
    const cases: Array<[string, (text: string) => string]> = [
      ['prefix', (text) => text.replace('&& actual === expected;', '&& actual.slice(0, 8) === expected.slice(0, 8);')],
      ['flipped equality', (text) => text.replace('&& actual === expected;', '&& actual !== expected;')],
      ['dropped length', (text) => text.replace(' || actual.length !== listed.length', '')],
      ['dropped tree', (text) => text.replace(' || actual[i]?.tree !== listed[i]?.tree', '')],
    ];
    for (const [name, transform] of cases) {
      try { await killed(name, transform); } catch (error) { survivors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    expect(survivors, `surviving mutants: ${survivors.join('; ')}`).toEqual([]);
  });
});

describe('mutation of the lander pin compare', () => {
  const source = readFileSync(join(ROOT, '.github/julius-landing/land-lib.mjs'), 'utf8');
  const driver = (mod: {
    exactPinnedFingerprint: (spki: string, raw: string) => boolean;
    externalAnchorProblems: (external?: string) => string[];
    PINNED_REVIEWER_SPKI_SHA256: string;
    PINNED_REVIEWER_RAW_KEY: string;
  }) => {
    const pin = mod.PINNED_REVIEWER_SPKI_SHA256;
    const raw = mod.PINNED_REVIEWER_RAW_KEY;
    if (!mod.exactPinnedFingerprint(pin, raw)) throw new Error('real pin must match');
    if (mod.exactPinnedFingerprint(`${pin.slice(0, 8)}${'0'.repeat(56)}`, raw)) throw new Error('prefix must not match');
    if (mod.exactPinnedFingerprint(pin.slice(0, 8), raw)) throw new Error('short must not match');
    if (mod.exactPinnedFingerprint(pin, '00'.repeat(32))) throw new Error('raw key must not be ignored');
    if (mod.externalAnchorProblems(`${pin.slice(0, 8)}${'0'.repeat(56)}`).length === 0) throw new Error('anchor prefix must not match');
    if (mod.externalAnchorProblems(pin.slice(0, 8)).length === 0) throw new Error('short anchor must not match');
    if (mod.externalAnchorProblems(undefined).length === 0) throw new Error('unset anchor must not match');
  };

  it('kills an 8-hex pin compare, an ignored raw key, and an 8-hex external anchor', async () => {
    const cases: Array<[string, (text: string) => string]> = [
      ['prefix fingerprint', (text) => text.replace('spkiSha256 === PINNED_REVIEWER_SPKI_SHA256', 'spkiSha256.slice(0, 8) === PINNED_REVIEWER_SPKI_SHA256.slice(0, 8)')],
      ['raw key ignored', (text) => text.replace('&& rawHex === PINNED_REVIEWER_RAW_KEY', '&& true')],
      ['prefix anchor', (text) => text.replace('  if (external === PINNED_REVIEWER_SPKI_SHA256) return [];', '  if (external.slice(0, 8) === PINNED_REVIEWER_SPKI_SHA256.slice(0, 8)) return [];')],
    ];
    const survivors: string[] = [];
    for (const [name, transform] of cases) {
      const directory = mkdtempSync(join(tmpdir(), 'julius-land-pin-'));
      const file = join(directory, 'land-lib.mjs');
      const next = transform(source);
      try {
        if (next === source) throw new Error(`${name} did not change the source`);
        writeFileSync(file, next);
        const mod = await import(pathToFileURL(file).href);
        let failed = false;
        try { driver(mod); } catch { failed = true; }
        if (!failed) throw new Error(`${name} survived`);
      } catch (error) {
        survivors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
    expect(survivors, survivors.join('; ')).toEqual([]);
  });
});
