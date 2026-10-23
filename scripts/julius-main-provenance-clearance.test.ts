import { describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { REVIEW_AUTHORITY_LOGINS } from './julius-review-currency.mjs';
import {
  WORKER_AUTHOR_LOGINS,
  evaluateMainProvenance,
  extractClearanceOffers,
  readReviewerKey,
} from './julius-main-provenance.mjs';

/**
 * A worker-PR squash may be provenant because the allowlisted reviewer key signed
 * a JULIUS-CLEARANCE-V1 for that exact head and tree. The keys in this file are
 * generated here. The committed reviewer key is only fingerprinted, never used
 * to sign.
 */

const { verifyClearanceSignature } = (await import(new URL('../.github/julius-landing/land-lib.mjs', import.meta.url).href)) as {
  verifyClearanceSignature: (text: string, signatureB64: string, publicKeyPem: string) => string[];
};

const MAIN = '1'.repeat(40);
const PARENT = '2'.repeat(40);
const HEAD = '3'.repeat(40);
const TREE = '4'.repeat(40);
const OTHER = '6'.repeat(40);
const WORKER = WORKER_AUTHOR_LOGINS[0]!;
const APPROVER = 'ohdieyuh-glitch';
const NOW = Date.parse('2026-10-23T12:00:00Z');
const NONCE = 'ab'.repeat(16);

const reviewer = generateKeyPairSync('ed25519');
const attacker = generateKeyPairSync('ed25519');
const pem = (key: { export(options: { type: 'spki'; format: 'pem' }): string | Buffer }) => String(key.export({ type: 'spki', format: 'pem' }));
const REVIEWER_PEM = pem(reviewer.publicKey);
const ATTACKER_PEM = pem(attacker.publicKey);

const clearanceText = (over: Record<string, string> = {}) => {
  const fields: Record<string, string> = {
    pr: '226', head: HEAD, tree: TREE, base: PARENT, kind: 'CLEARED',
    'bot-comments-sha256': 'c'.repeat(64), 'governed-exceptions': '-', nonce: NONCE, by: 'INDEPENDENT_REVIEW',
    issued: '2026-10-23T11:00:00Z', expires: '2026-10-23T15:00:00Z', ...over,
  };
  return ['JULIUS-CLEARANCE-V1', 'repo: ohdieyuh-glitch/sunday-relay',
    ...['pr', 'head', 'tree', 'base', 'kind', 'bot-comments-sha256', 'governed-exceptions', 'nonce', 'by', 'issued', 'expires'].map((key) => `${key}: ${fields[key]}`),
    ''].join('\n');
};
const signWith = (privateKey: typeof reviewer.privateKey, text: string) => sign(null, Buffer.from(text, 'utf8'), privateKey).toString('base64');

const offer = (text = clearanceText(), privateKey: typeof reviewer.privateKey = reviewer.privateKey) =>
  ({ text, signatureB64: signWith(privateKey, text) });

const packet = (over: Record<string, unknown> = {}) => ({
  offers: [offer()],
  reviewerKeyPem: REVIEWER_PEM,
  reviewerKeyAtSha: PARENT,
  now: NOW,
  ...over,
});

const provenance = (over: Record<string, unknown> = {}) => evaluateMainProvenance({
  mainSha: MAIN,
  mainShaAfter: MAIN,
  mainTreeSha: TREE,
  mainParents: [PARENT],
  pullRequests: [{ number: 226, merged: true, mergeCommitSha: MAIN, authorLogin: WORKER, headSha: HEAD, baseRef: 'main' }],
  reviewedTreeSha: TREE,
  reviewedHeadShaAfter: HEAD,
  reviews: [],
  reviewComments: [],
  statuses: [],
  parentContainedInReviewedHead: true,
  baseRefChanged: false,
  repo: 'ohdieyuh-glitch/sunday-relay',
  workerClearance: packet(),
  ...over,
});

const expectVerdict = (result: { verdict: string; reason: string }, verdict: string, reason?: RegExp) => {
  expect(result.verdict, result.reason).toBe(verdict);
  if (reason) expect(result.reason).toMatch(reason);
};

describe('a worker-PR squash cleared by JULIUS-CLEARANCE-V1', () => {
  it('is provenant with no GitHub APPROVED review, and names the clearance rather than a new approver', () => {
    const result = provenance();
    expectVerdict(result, 'provenant', /JULIUS-CLEARANCE-V1/u);
    expect(result).toMatchObject({ via: 'worker-clearance', approvedBy: ['INDEPENDENT_REVIEW'], reviewedHeadSha: HEAD, prNumber: 226 });
    expect(result.approvedBy).not.toContain(WORKER);
    expect(REVIEW_AUTHORITY_LOGINS).toEqual(['ohdieyuh-glitch']);
  });

  it('the founder APPROVED review still suffices, and a bad clearance beside it does not revoke it', () => {
    const approved = provenance({
      reviews: [{ commit_id: HEAD, state: 'APPROVED', user: { login: APPROVER } }],
      workerClearance: undefined,
    });
    expectVerdict(approved, 'provenant');
    expect(approved.approvedBy).toEqual([APPROVER]);
    expect(approved.via).toBeUndefined();
    const beside = provenance({
      reviews: [{ commit_id: HEAD, state: 'APPROVED', user: { login: APPROVER } }],
      workerClearance: packet({ reviewerKeyPem: ATTACKER_PEM }),
    });
    expectVerdict(beside, 'provenant');
    expect(beside.approvedBy).toEqual([APPROVER]);
  });

  it('a missing clearance leaves an unapproved worker squash unprovenanced', () => {
    expectVerdict(provenance({ workerClearance: undefined }), 'unprovenanced', /no approval exists/u);
  });

  it('does not authorize a pull request the coding worker did not open', () => {
    const founderAuthored = provenance({
      pullRequests: [{ number: 226, merged: true, mergeCommitSha: MAIN, authorLogin: APPROVER, headSha: HEAD, baseRef: 'main' }],
    });
    expectVerdict(founderAuthored, 'unprovenanced', /not the coding worker/u);
    expect(founderAuthored.reason).not.toMatch(/JULIUS-CLEARANCE-V1 clears/u);
  });

  it('does not override a block or an unreadable review', () => {
    const blocked = provenance({
      reviews: [{ commit_id: HEAD, state: 'CHANGES_REQUESTED', user: { login: APPROVER } }],
    });
    expectVerdict(blocked, 'unprovenanced', /requested changes/u);
    const moving = provenance({ reviewedHeadShaAfter: OTHER });
    expectVerdict(moving, 'indeterminate', /head moved/u);
  });

  it('a wrong key, a flipped signature, an expired clearance, a future clearance, and a too-long lifetime fail closed', () => {
    expectVerdict(provenance({ workerClearance: packet({ reviewerKeyPem: ATTACKER_PEM }) }), 'unprovenanced', /does not verify/u);
    const text = clearanceText();
    const flipped = Buffer.from(signWith(reviewer.privateKey, text), 'base64');
    flipped[0] = (flipped[0]! ^ 1);
    expectVerdict(provenance({
      workerClearance: packet({ offers: [{ text, signatureB64: flipped.toString('base64') }] }),
    }), 'unprovenanced', /does not verify/u);
    expectVerdict(provenance({
      workerClearance: packet({ offers: [offer(clearanceText({ expires: '2026-10-23T11:30:00Z' }))] }),
    }), 'unprovenanced', /expired/u);
    expectVerdict(provenance({
      workerClearance: packet({ offers: [offer(clearanceText({ issued: '2026-10-23T18:00:00Z', expires: '2026-10-23T20:00:00Z' }))] }),
    }), 'unprovenanced', /future/u);
    expectVerdict(provenance({
      workerClearance: packet({ offers: [offer(clearanceText({ issued: '2026-10-22T10:00:00Z', expires: '2026-10-23T15:00:00Z' }))] }),
    }), 'unprovenanced', /24 hours/u);
  });

  it('a mismatched head, tree, pull request, or base fails closed', () => {
    expectVerdict(provenance({
      workerClearance: packet({ offers: [offer(clearanceText({ head: OTHER }))] }),
    }), 'unprovenanced', /names head/u);
    expectVerdict(provenance({
      workerClearance: packet({ offers: [offer(clearanceText({ tree: OTHER }))] }),
    }), 'unprovenanced', /names tree/u);
    expectVerdict(provenance({
      workerClearance: packet({ offers: [offer(clearanceText({ pr: '227' }))] }),
    }), 'unprovenanced', /pull request #227/u);
    expectVerdict(provenance({
      workerClearance: packet({ offers: [offer(clearanceText({ base: OTHER }))] }),
    }), 'unprovenanced', /names base/u);
  });

  it('a missing clock, a missing key, a key read at the wrong commit, and a malformed clearance fail closed', () => {
    expectVerdict(provenance({ workerClearance: packet({ now: undefined }) }), 'indeterminate', /no time was supplied/u);
    expectVerdict(provenance({ workerClearance: packet({ reviewerKeyPem: undefined }) }), 'indeterminate', /could not be read/u);
    expectVerdict(provenance({ workerClearance: packet({ reviewerKeyAtSha: MAIN }) }), 'indeterminate', /parent of the squash/u);
    expectVerdict(provenance({ workerClearance: packet({ offers: [] }) }), 'indeterminate', /without a clearance body/u);
    expectVerdict(provenance({
      workerClearance: packet({ offers: [{ text: 'not a clearance\n', signatureB64: signWith(reviewer.privateKey, 'not a clearance\n') }] }),
    }), 'indeterminate', /malformed/u);
  });

  it('the other squash gates still refuse: a different tree on main, a retarget, an uncontained parent', () => {
    expectVerdict(provenance({ mainTreeSha: OTHER }), 'unprovenanced', /is not the reviewed tree/u);
    expectVerdict(provenance({ baseRefChanged: true }), 'unprovenanced', /base of pull request/u);
    expectVerdict(provenance({ parentContainedInReviewedHead: false }), 'unprovenanced', /was not contained/u);
  });

  it('agrees with the landing verifier, and the committed key is the allowlisted fingerprint', () => {
    const text = clearanceText();
    const signature = signWith(reviewer.privateKey, text);
    expect(verifyClearanceSignature(text, signature, REVIEWER_PEM)).toEqual([]);
    expect(verifyClearanceSignature(text, signature, ATTACKER_PEM).length).toBeGreaterThan(0);
    expectVerdict(provenance({ workerClearance: packet({ offers: [{ text, signatureB64: signature }] }) }), 'provenant');
    const real = readFileSync(resolve(import.meta.dirname, '../.github/julius-landing/reviewer-ed25519.pub'), 'utf8');
    expect(readReviewerKey(real).problem).toBeUndefined();
    const der = createPublicKey(real).export({ type: 'spki', format: 'der' });
    expect(createHash('sha256').update(der).digest('hex')).toMatch(/^b0b8e29b/u);
    const throwaway = createHash('sha256').update(createPublicKey(REVIEWER_PEM).export({ type: 'spki', format: 'der' })).digest('hex');
    expect(throwaway.startsWith('b0b8e29b')).toBe(false);
  });
});

describe('clearance offers in a pull request body or comment', () => {
  it('reads a reviewer-tools pair and refuses a truncated one or a free-text mention', () => {
    const text = clearanceText();
    const signature = signWith(reviewer.privateKey, text);
    const encoded = Buffer.from(text, 'utf8').toString('base64');
    const found = extractClearanceOffers(`note\nCLEARANCE_B64=${encoded}\nSIGNATURE_B64=${signature}\n`);
    expect(found).toEqual([{ text, signatureB64: signature }]);
    expect(extractClearanceOffers('JULIUS-CLEARANCE-V1 is not an offer by itself\n')).toEqual([]);
    expect(extractClearanceOffers(`CLEARANCE_B64=${encoded}\n`).length).toBe(1);
    expect(extractClearanceOffers(`CLEARANCE_B64=${encoded}\n`)[0]?.signatureB64).toBeUndefined();
  });
});

describe('the CLI accepts a worker-PR clearance from a comment', () => {
  const REPO = 'ohdieyuh-glitch/sunday-relay';
  const issuedAt = new Date(Date.now() - 60_000);
  issuedAt.setMilliseconds(0);
  const expiresAt = new Date(issuedAt.getTime() + 2 * 60 * 60_000);
  const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/u, 'Z');
  const text = clearanceText({ issued: iso(issuedAt), expires: iso(expiresAt) });
  const signature = signWith(reviewer.privateKey, text);
  const comment = `CLEARANCE_B64=${Buffer.from(text, 'utf8').toString('base64')}\nSIGNATURE_B64=${signature}\n`;
  const keyFile = { type: 'file', encoding: 'base64', content: Buffer.from(REVIEWER_PEM, 'utf8').toString('base64') };

  const routes = (over: Record<string, unknown> = {}) => ({
    [`repos/${REPO}/branches/main`]: { commit: { sha: MAIN } },
    [`repos/${REPO}/commits/${MAIN}`]: { commit: { tree: { sha: TREE }, message: 'Julius: squash (#226)\n' }, parents: [{ sha: PARENT }] },
    [`repos/${REPO}/commits/${MAIN}/pulls`]: [{
      number: 226, merged_at: '2026-10-23T12:00:00Z', merge_commit_sha: MAIN,
      user: { login: WORKER }, head: { sha: HEAD }, base: { ref: 'main' }, body: '',
    }],
    [`repos/${REPO}/pulls/226`]: { head: { sha: HEAD } },
    [`repos/${REPO}/issues/226/timeline`]: [{ event: 'merged' }],
    [`repos/${REPO}/issues/226/comments`]: [{ body: comment }],
    [`repos/${REPO}/pulls/226/reviews`]: [],
    [`repos/${REPO}/pulls/226/comments`]: [],
    [`repos/${REPO}/commits/${HEAD}`]: { commit: { tree: { sha: TREE } } },
    [`repos/${REPO}/commits/${HEAD}/statuses`]: [],
    [`repos/${REPO}/compare/${PARENT}...${HEAD}`]: { merge_base_commit: { sha: PARENT } },
    [`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub`]: keyFile,
    ...over,
  });

  const run = (table: Record<string, unknown>) => {
    const directory = mkdtempSync(join(tmpdir(), 'julius-clearance-'));
    try {
      writeFileSync(join(directory, 'gh'), [
        '#!/usr/bin/env node',
        `const table = ${JSON.stringify(table)};`,
        "const path = (process.argv[3] ?? '').split('?')[0];",
        'if (!(path in table)) { process.stderr.write(`stub: no route for ${path}\\n`); process.exit(1); }',
        'process.stdout.write(JSON.stringify(table[path]));',
      ].join('\n'), { mode: 0o755 });
      chmodSync(join(directory, 'gh'), 0o755);
      try {
        const stdout = execFileSync(process.execPath, [resolve(import.meta.dirname, 'julius-main-provenance.mjs'), REPO], {
          encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}` }, stdio: 'pipe',
        });
        return { code: 0, stdout, stderr: '' };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return { code: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  it('a comment carrying a valid clearance makes the squash provenant', () => {
    const result = run(routes());
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('provenance=provenant');
    expect(result.stdout).toContain('approved_by=INDEPENDENT_REVIEW');
  }, 30_000);

  it('the same comment signed under a different key does not', () => {
    const result = run(routes({
      [`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub`]: {
        ...keyFile, content: Buffer.from(ATTACKER_PEM, 'utf8').toString('base64'),
      },
    }));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('does not verify');
    expect(result.stdout).not.toContain('provenance=provenant');
  }, 30_000);
});
