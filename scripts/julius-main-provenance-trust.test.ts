import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { evaluateMainProvenance } from './julius-main-provenance.mjs';
import {
  CHECKPOINT_HEADER,
  EXTERNAL_ANCHOR_VARIABLE,
  LANDING_REPO,
  PINNED_REVIEWER_RAW_KEY,
  PINNED_REVIEWER_SPKI_SHA256,
  RECORDED_RANGE,
  TRUSTED_CHECKPOINT_BASE,
  TRUSTED_CHECKPOINT_HEAD,
  TRUSTED_CHECKPOINT_SHA,
  TRUSTED_CHECKPOINT_TREE,
  canonicalCheckpointAttestation,
  classifyCommit,
  classifyRecordedRange,
  commitsMatch,
  evaluateTrustChain,
  exactFingerprintMatch,
  parseCheckpointAttestation,
  requireTrustedVerifier,
  reviewerKeyPinRefusal,
} from './julius-main-provenance-trust.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const REAL_PEM = readFileSync(join(ROOT, '.github/julius-landing/reviewer-ed25519.pub'), 'utf8');
const PIN = PINNED_REVIEWER_SPKI_SHA256;
const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', cwd: ROOT });
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

  it('matches the committed public key and the same bytes at the checkpoint, its parent, and f539cab2', () => {
    for (const rev of ['HEAD', TRUSTED_CHECKPOINT_SHA, TRUSTED_CHECKPOINT_BASE, 'f539cab2530b7733bd987068be676308440e04a5', '689d2be92c3158ba4a59883ed4f6cc02f700660b']) {
      const pem = git(['show', `${rev}:.github/julius-landing/reviewer-ed25519.pub`]);
      expect(reviewerKeyPinRefusal(pem, PIN), rev).toBeNull();
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
    expect(reviewerKeyPinRefusal(REAL_PEM, PIN.slice(0, 8))?.reason).toContain('does not match');
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

  it('the committed unsigned text is exactly the canonical attestation and is not a signature', () => {
    expect(unsignedText).toBe(text);
    expect(unsignedText.startsWith(`${CHECKPOINT_HEADER}\n`)).toBe(true);
    expect(unsignedText).not.toMatch(/signature/iu);
    expect(parseCheckpointAttestation(unsignedText).problems).toEqual([]);
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
    expect(chain.reason).toContain('no signed checkpoint attestation covers this chain');
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
    headCommit: { sha: TRUSTED_CHECKPOINT_HEAD, authorLogin: 'julius-worker[bot]', treeSha: TRUSTED_CHECKPOINT_TREE },
    externalReviewerKeySha256: PIN,
    ...over,
  } as Parameters<typeof evaluateMainProvenance>[0]);

  it('the real key and the real landing at the checkpoint are provenant', () => {
    const result = historical();
    expect(result.verdict, result.reason).toBe('provenant');
    expect(result.via).toBe('signed-landing');
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
      headCommit: { sha: '3'.repeat(40), authorLogin: 'julius-worker[bot]', treeSha: '4'.repeat(40) },
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
    expect(covered.reason).toContain('does not verify');
  });
});

describe('the checkpoint workflow and the working tree', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/julius-accept-main.yml'), 'utf8');

  it('runs the verifier from the checkpoint copy and refuses the tip copy when the trusted files differ', () => {
    expect(workflow).toContain(`ref: ${TRUSTED_CHECKPOINT_SHA}`);
    expect(workflow).toContain('working-directory: checkpoint-verifier');
    expect(workflow).toContain('does not execute the tip verifier');
    expect(workflow).toContain(PIN);
    expect(workflow).toContain(EXTERNAL_ANCHOR_VARIABLE);
  });

  it('this working tree is not a trusted verifier', async () => {
    const result = await requireTrustedVerifier({ ...process.env, [EXTERNAL_ANCHOR_VARIABLE]: PIN });
    expect(result.ok).toBe(false);
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
