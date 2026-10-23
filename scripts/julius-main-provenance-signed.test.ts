import { afterAll, describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { NON_ATTESTING_IDENTITIES } from './julius-review-currency.mjs';
import {
  AUTHENTICATED_COMMIT_SOURCES,
  LANDING_BEGIN,
  LANDING_END,
  WORKER_APP_ID,
  evaluateMainProvenance,
  extractLandingBlock,
  parseSignedClearance,
  SIGNED_LANDING_GOVERNED,
  readReviewerKey,
} from './julius-main-provenance.mjs';

/**
 * A TIP THE INDEPENDENT REVIEWER SIGNED FOR.
 *
 * The autonomous lander lands a commit whose message carries the reviewer's ed25519 clearance. This file is the
 * executable argument that such a tip is provenant ONLY when every fact lines up, and that the founder-approval path is
 * untouched when no block is present. Each case below spoils exactly one fact of the passing shape.
 */

// The lander has no declaration file (it is a plain .mjs under .github); the cross-check only needs this one function.
const { parseClearance, HARD_FORBIDDEN_PATH, EXCEPTION_ELIGIBLE } = (await import(new URL('../.github/julius-landing/land-lib.mjs', import.meta.url).href)) as {
  parseClearance: (text: string) => { problems: string[] };
  HARD_FORBIDDEN_PATH: RegExp;
  EXCEPTION_ELIGIBLE: string[];
};

const MAIN = '1'.repeat(40);
const PARENT = '2'.repeat(40);
const HEAD = '3'.repeat(40);
const TREE = '4'.repeat(40);
const OTHER_TREE = '5'.repeat(40);
const OTHER = '6'.repeat(40);
const WORKER = NON_ATTESTING_IDENTITIES[0]!;
const NONCE = 'ab'.repeat(16);

const reviewer = generateKeyPairSync('ed25519');
const attacker = generateKeyPairSync('ed25519');
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (key: { export(options: { type: 'spki'; format: 'pem' }): string | Buffer }) => String(key.export({ type: 'spki', format: 'pem' }));
const REVIEWER_PEM = pem(reviewer.publicKey);

const clearanceText = (over: Record<string, string> = {}) => {
  const fields: Record<string, string> = {
    pr: '381', head: HEAD, tree: TREE, base: PARENT, kind: 'CLEARED-TREE',
    'bot-comments-sha256': 'c'.repeat(64), 'governed-exceptions': '-', nonce: NONCE, by: 'INDEPENDENT_REVIEW',
    issued: '2026-10-19T09:00:00Z', expires: '2026-10-20T09:00:00Z', ...over,
  };
  return ['JULIUS-CLEARANCE-V1', 'repo: ohdieyuh-glitch/sunday-relay',
    ...['pr', 'head', 'tree', 'base', 'kind', 'bot-comments-sha256', 'governed-exceptions', 'nonce', 'by', 'issued', 'expires'].map((k) => `${k}: ${fields[k]}`),
    ''].join('\n');
};
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const signWith = (privateKey: typeof reviewer.privateKey, text: string) => sign(null, Buffer.from(text, 'utf8'), privateKey).toString('base64');

const block = (over: { text?: string; signature?: string; nonce?: string; v?: string } = {}) => {
  const text = over.text ?? clearanceText();
  return [LANDING_BEGIN, `v: ${over.v ?? '1'}`, `clearance-nonce: ${over.nonce ?? NONCE}`, `clearance-b64: ${b64(text)}`,
    `signature-b64: ${over.signature ?? signWith(reviewer.privateKey, text)}`, LANDING_END].join('\n');
};
const message = (blockText = block()) => `Julius: land the cleared tree (#381)\n\nThe lander wrote this.\n\n${blockText}\n`;

/** The passing shape for the SIGNED path. No pull request, no approval record: none is needed and none is read. */
type ProvenanceInput = Parameters<typeof evaluateMainProvenance>[0];
/** Authenticated coding-worker opener. Git name and email-derived login are not this object. */
const workerAuthor = { login: WORKER, source: 'pull-opener', accountType: 'Bot' };
const clearedHead = (over: Record<string, unknown> = {}) => ({ sha: HEAD, treeSha: TREE, authenticatedAuthor: workerAuthor, ...over });

const signedTip = (over: Record<string, unknown> = {}) => evaluateMainProvenance({
  repo: 'ohdieyuh-glitch/sunday-relay',
  mainSha: MAIN,
  mainShaAfter: MAIN,
  mainTreeSha: TREE,
  mainParents: [PARENT],
  mainCommitMessage: message(),
  reviewerKeyPem: REVIEWER_PEM,
  reviewerKeyAtSha: PARENT,
  tipReviewerKeyPem: REVIEWER_PEM,
  changedPaths: ['src/relay/ordinary.ts', '.github/julius-missions/julius-diag-digest-evidence-2/contract.json'],
  changedPathsComplete: true,
  headCommit: clearedHead(),
  ...over,
} as unknown as ProvenanceInput);

const createPublicKeyEquals = (a: string, b: string) => {
  try { return readReviewerKey(a).key !== undefined || Buffer.from(a.split('\n')[1]!, 'base64').equals(Buffer.from(b.split('\n')[1]!, 'base64')); } catch { return false; }
};

const expectVerdict = (result: { verdict: string; reason: string }, verdict: string, reason?: RegExp) => {
  expect(result.verdict, result.reason).toBe(verdict);
  if (reason) expect(result.reason).toMatch(reason);
};

describe('a tip signed for by the Independent Reviewer', () => {
  it('the passing shape is provenant, names the reviewer, and never needed a pull request', () => {
    const result = signedTip();
    expectVerdict(result, 'provenant');
    expect(result).toMatchObject({ prNumber: 381, reviewedHeadSha: HEAD, approvedBy: ['INDEPENDENT_REVIEW'], parentSha: PARENT, via: 'signed-landing' });
  });

  it('kind CLEARED is accepted exactly like CLEARED-TREE', () => {
    const text = clearanceText({ kind: 'CLEARED' });
    expectVerdict(signedTip({ mainCommitMessage: message(block({ text })) }), 'provenant');
  });

  it('1. a signature made by any other key is refused', () => {
    const forged = block({ signature: signWith(attacker.privateKey, clearanceText()) });
    expectVerdict(signedTip({ mainCommitMessage: message(forged) }), 'unprovenanced', /does not verify/u);
  });

  it('2. the key must be the one committed at the PARENT: read anywhere else, it is not a key', () => {
    expectVerdict(signedTip({ reviewerKeyAtSha: MAIN }), 'indeterminate', /single parent/u);
    expectVerdict(signedTip({ reviewerKeyAtSha: undefined }), 'indeterminate');
    expectVerdict(signedTip({ reviewerKeyPem: undefined }), 'indeterminate');
    expectVerdict(signedTip({ reviewerKeyPem: '' }), 'indeterminate', /could not be read/u);
    expectVerdict(signedTip({ reviewerKeyPem: 'not a key' }), 'indeterminate', /exactly one PEM block/u);
  });

  it('3. a key that is not ed25519 is never used', () => {
    expectVerdict(signedTip({ reviewerKeyPem: pem(rsa.publicKey) }), 'indeterminate', /not an ed25519/u);
  });

  it('4. a signature that is edited by one byte, or truncated, does not verify', () => {
    const good = Buffer.from(signWith(reviewer.privateKey, clearanceText()), 'base64');
    const flipped = Buffer.from(good); flipped[0] = (flipped[0]! ^ 1);
    expectVerdict(signedTip({ mainCommitMessage: message(block({ signature: flipped.toString('base64') })) }), 'unprovenanced', /does not verify/u);
    expectVerdict(signedTip({ mainCommitMessage: message(block({ signature: good.subarray(0, 63).toString('base64') })) }), 'unprovenanced', /64 bytes/u);
  });

  it('5. a clearance text edited after signing does not verify', () => {
    const signedFor = clearanceText();
    const edited = clearanceText({ issued: '2026-10-19T09:00:01Z' });
    const tampered = block({ text: edited, signature: signWith(reviewer.privateKey, signedFor) });
    expectVerdict(signedTip({ mainCommitMessage: message(tampered) }), 'unprovenanced', /does not verify/u);
  });

  it('6. the reviewer signed a DIFFERENT tree: replaying a genuine clearance on another tip', () => {
    const other = clearanceText({ tree: OTHER_TREE });
    expectVerdict(signedTip({ mainCommitMessage: message(block({ text: other })) }), 'unprovenanced', /signed tree/u);
    expectVerdict(signedTip({ mainTreeSha: OTHER_TREE }), 'unprovenanced', /signed tree/u);
  });

  it('7. the reviewer signed a DIFFERENT base: the same tree cleared over another parent is another proof', () => {
    const other = clearanceText({ base: OTHER });
    expectVerdict(signedTip({ mainCommitMessage: message(block({ text: other })) }), 'unprovenanced', /signed base/u);
    expectVerdict(signedTip({ mainParents: [OTHER] , reviewerKeyAtSha: OTHER }), 'unprovenanced', /signed base/u);
  });

  it('8. the nonce in the block must be the nonce inside the signed text', () => {
    expectVerdict(signedTip({ mainCommitMessage: message(block({ nonce: 'cd'.repeat(16) })) }), 'unprovenanced', /nonce/u);
  });

  it('9. the cleared head must be read, be the named commit, carry the signed tree and be authenticated as the worker', () => {
    expectVerdict(signedTip({ headCommit: undefined }), 'indeterminate');
    expectVerdict(signedTip({ headCommit: clearedHead({ sha: OTHER }) }), 'indeterminate');
    expectVerdict(signedTip({ headCommit: clearedHead({ treeSha: undefined }) }), 'indeterminate');
    expectVerdict(signedTip({ headCommit: clearedHead({ treeSha: OTHER_TREE }) }), 'unprovenanced', /not the signed tree/u);
    for (const login of ['a-passing-collaborator', 'ohdieyuh-glitch', '']) {
      expectVerdict(signedTip({ headCommit: clearedHead({ authenticatedAuthor: { ...workerAuthor, login } }) }), 'unprovenanced', /not the coding worker/u);
    }
  });

  it('9b. a spoofed git author name, email, or email-derived login is not the coding worker', () => {
    const spoofedEmail = '41898282+julius-worker[bot]@users.noreply.github.com';
    const gitOnly = {
      sha: HEAD,
      treeSha: TREE,
      authorLogin: WORKER,
      gitAuthorName: WORKER,
      gitAuthorEmail: spoofedEmail,
      emailDerivedLogin: WORKER,
    };
    expectVerdict(signedTip({ headCommit: gitOnly }), 'unprovenanced', /not identity/u);
    expectVerdict(signedTip({ headCommit: { ...gitOnly, authenticatedAuthor: undefined } }), 'unprovenanced', /not identity/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({
        gitAuthorName: WORKER,
        gitAuthorEmail: spoofedEmail,
        emailDerivedLogin: WORKER,
        authenticatedAuthor: { login: 'a-dev-session', source: 'pull-opener', accountType: 'Bot' },
      }),
    }), 'unprovenanced', /not the coding worker/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({ emailDerivedLogin: 'a-dev-session', gitAuthorName: WORKER }),
    }), 'unprovenanced', /email-derived/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({ gitAuthorName: 'Spoofed Name', emailDerivedLogin: WORKER }),
    }), 'unprovenanced', /free-text name/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({ authenticatedAuthor: { login: WORKER, source: 'git-email', accountType: 'Bot' } }),
    }), 'unprovenanced', /not from an authenticated GitHub source/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({ authenticatedAuthor: { login: WORKER, source: 'pull-opener', accountType: 'User' } }),
    }), 'unprovenanced', /not a GitHub App/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({ authenticatedAuthor: { login: WORKER, source: 'pull-opener' } }),
    }), 'unprovenanced', /account type is missing/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({ authenticatedAuthor: { ...workerAuthor, appId: 1 } }),
    }), 'unprovenanced', /installation id/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({
        authenticatedAuthor: { login: WORKER, source: 'app-installation', accountType: 'Bot' },
      }),
    }), 'unprovenanced', /installation id is missing/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({
        authenticatedAuthor: { login: WORKER, source: 'app-installation', accountType: 'Bot', appId: WORKER_APP_ID },
        emailDerivedLogin: WORKER,
        gitAuthorName: WORKER,
      }),
    }), 'provenant');
    expectVerdict(signedTip({
      headCommit: clearedHead({
        authenticatedAuthor: { login: WORKER, source: 'verified-signature', accountType: 'Bot', signatureVerified: true },
        verification: { verified: true, reason: 'valid', signerLogin: WORKER },
      }),
    }), 'provenant');
    expectVerdict(signedTip({
      headCommit: clearedHead({
        authenticatedAuthor: { login: WORKER, source: 'verified-signature', accountType: 'Bot', signatureVerified: false },
      }),
    }), 'unprovenanced', /no verified signature/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({
        verification: { verified: true, reason: 'valid', signerLogin: 'a-dev-session' },
      }),
    }), 'unprovenanced', /signer/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({ verification: { verified: false, reason: 'bad_email' } }),
    }), 'unprovenanced', /does not verify/u);
    expectVerdict(signedTip({
      headCommit: clearedHead({
        gitAuthorName: WORKER,
        gitAuthorEmail: spoofedEmail,
        emailDerivedLogin: null,
        verification: { verified: false, reason: 'unsigned' },
      }),
    }), 'provenant');
    expect(AUTHENTICATED_COMMIT_SOURCES).toEqual(['pull-opener', 'app-installation', 'verified-signature']);
    expect(WORKER_APP_ID).toBe(4838349);
  });

  it('10. a clearance that does not parse is refused even when it is genuinely signed', () => {
    const lines = clearanceText().split('\n');
    const bad = [
      lines.filter((l) => !l.startsWith('by: ')).join('\n'),
      clearanceText().replace('JULIUS-CLEARANCE-V1', 'JULIUS-CLEARANCE-V2'),
      clearanceText().replace('repo: ohdieyuh-glitch/sunday-relay', 'repo: someone/else'),
      `${clearanceText()}extra: line\n`,
      clearanceText().replace(`tree: ${TREE}`, 'tree: 4444'),
      clearanceText({ nonce: 'xyz' }),
      clearanceText({ by: 'MAIN_JULIUS' }),
      clearanceText({ kind: 'CLEARED-SOMETHING' }),
    ];
    for (const text of bad) {
      expectVerdict(signedTip({ mainCommitMessage: message(block({ text, nonce: NONCE })) }), 'indeterminate', /malformed/u);
    }
  });

  it('10b. P2: the clearance repo line must equal the QUERIED repository as well as the landing repository', () => {
    expectVerdict(signedTip({ repo: 'ohdieyuh-glitch/sunday-relay' }), 'provenant');
    expectVerdict(signedTip(), 'provenant');
    expectVerdict(signedTip({ repo: 'someone/else' }), 'indeterminate', /malformed.*queried repo/u);
    expect(parseSignedClearance(clearanceText(), 'ohdieyuh-glitch/sunday-relay').problems).toEqual([]);
    expect(parseSignedClearance(clearanceText(), 'someone/else').problems.join(';')).toMatch(/queried repo/u);
  });

  it('11. injection through a title or body: any second mention of the marker words refuses the whole tip', () => {
    const legit = block();
    const cases = [
      `Julius: ${LANDING_BEGIN} (#381)\n\n${legit}\n`,
      `Julius (#381)\n\n${legit}\n\nfooter ${LANDING_END}\n`,
      `Julius (#381)\n\nJULIUS LANDING notes\n\n${legit}\n`,
      `Julius (#381)\n\n${legit}\n\n${legit}\n`,
      `Julius (#381)\n\n${block({ text: clearanceText({ pr: '9' }) })}\n\n${legit}\n`,
    ];
    for (const text of cases) expectVerdict(signedTip({ mainCommitMessage: text }), 'indeterminate');
  });

  it('12. the block must be exact: extra keys, missing keys, order, trailing text, CR and a wrong version all refuse', () => {
    const text = clearanceText();
    const exact = [LANDING_BEGIN, 'v: 1', `clearance-nonce: ${NONCE}`, `clearance-b64: ${b64(text)}`, `signature-b64: ${signWith(reviewer.privateKey, text)}`, LANDING_END];
    const mutate = (fn: (lines: string[]) => string[]) => `Julius (#381)\n\n${fn([...exact]).join('\n')}\n`;
    const variants = [
      mutate((l) => [...l.slice(0, 5), 'extra: value', l[5]!]),
      mutate((l) => [l[0]!, l[2]!, l[1]!, l[3]!, l[4]!, l[5]!]),
      mutate((l) => [l[0]!, l[1]!, l[2]!, l[4]!, l[5]!]),
      mutate((l) => l.map((line) => line.replace('v: 1', 'v: 2'))),
      mutate((l) => l.map((line) => line.replace(/^(clearance-b64: .*?)=*$/u, '$1 '))),
      mutate((l) => l.map((line) => (line.startsWith('clearance-b64: ') ? `${line.slice(0, 20)}\n${line.slice(20)}` : line))),
      `${mutate((l) => l)}trailing text\n`,
      mutate((l) => l).replace(/\n/gu, '\r\n'),
      mutate((l) => l.map((line) => (line === LANDING_BEGIN ? ` ${LANDING_BEGIN}` : line))),
      mutate((l) => l.map((line) => (line === LANDING_END ? `${LANDING_END} ` : line))),
      mutate((l) => l.map((line) => (line.startsWith('signature-b64: ') ? `${line}!` : line))),
    ];
    for (const variant of variants) expectVerdict(signedTip({ mainCommitMessage: variant }), 'indeterminate');
    expectVerdict(signedTip({ mainCommitMessage: `Julius (#381)\n\n${exact.join('\n')}` }), 'provenant');
    expectVerdict(signedTip({ mainCommitMessage: `${exact.join('\n')}\n` }), 'provenant');
  });

  it('12b. a carriage return ANYWHERE in the message, a lone marker word, and non-canonical base64 are all refused', () => {
    expectVerdict(signedTip({ mainCommitMessage: message().replace('Julius: land', 'Julius:\r land') }), 'indeterminate', /carriage return/u);
    expectVerdict(signedTip({ mainCommitMessage: 'Julius: JULIUS LANDING (#381)\n' }), 'indeterminate', /exactly one BEGIN and one END/u);
    expectVerdict(signedTip({ mainCommitMessage: `Julius (#381)\n\n${LANDING_BEGIN}\n` }), 'indeterminate', /exactly one BEGIN and one END/u);
    // The same signature bytes with a padding bit flipped decode identically and VERIFY, so only the canonical-form rule refuses them.
    const text = clearanceText();
    const good = signWith(reviewer.privateKey, text);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const last = good.length - 3;
    const flipped = `${good.slice(0, last)}${alphabet[alphabet.indexOf(good[last]!) ^ 1]}${good.slice(last + 1)}`;
    expect(Buffer.from(flipped, 'base64').equals(Buffer.from(good, 'base64')), 'the variant must decode to the same bytes').toBe(true);
    expect(flipped).not.toBe(good);
    expectVerdict(signedTip({ mainCommitMessage: message(block({ signature: flipped })) }), 'indeterminate', /not canonical/u);
  });

  it('12c. H1: the key file AT THE TIP must be byte-identical to the parent\'s', () => {
    expectVerdict(signedTip({ tipReviewerKeyPem: pem(attacker.publicKey) }), 'unprovenanced', /changes the reviewer key file/u);
    expectVerdict(signedTip({ tipReviewerKeyPem: `${REVIEWER_PEM}\n` }), 'unprovenanced', /changes the reviewer key file/u);
    expectVerdict(signedTip({ tipReviewerKeyPem: REVIEWER_PEM.replace('-----BEGIN', ' -----BEGIN') }), 'unprovenanced', /changes the reviewer key file/u);
    expectVerdict(signedTip({ tipReviewerKeyPem: undefined }), 'indeterminate', /at the tip could not be read/u);
    expectVerdict(signedTip({ tipReviewerKeyPem: '' }), 'unprovenanced', /changes the reviewer key file/u);
    expectVerdict(signedTip({ tipReviewerKeyPem: 42 }), 'indeterminate', /at the tip could not be read/u);
  });

  it('12d. H4: the key file is exactly one PUBLIC ed25519 SPKI block: a private key, two blocks, extra text or a padded encoding are refused', () => {
    const privatePem = String(reviewer.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const cases: Array<[string, string, RegExp]> = [
      ['a private key', privatePem, /private key/u],
      ['a private key before the public one', `${privatePem}${REVIEWER_PEM}`, /private key/u],
      ['two public blocks', `${REVIEWER_PEM}${pem(attacker.publicKey)}`, /exactly one PEM block/u],
      ['a comment line before the block', `# the reviewer key\n${REVIEWER_PEM}`, /exactly one SPKI PUBLIC KEY block/u],
      ['trailing text after the block', `${REVIEWER_PEM}trailing\n`, /exactly one SPKI PUBLIC KEY block/u],
      ['CRLF line ends', REVIEWER_PEM.replace(/\n/gu, '\r\n'), /carriage return/u],
      ['an RSA public key', pem(rsa.publicKey), /not an ed25519 key|canonical/u],
      ['an empty file', '', /could not be read/u],
      ['a block with no body', '-----BEGIN PUBLIC KEY-----\n-----END PUBLIC KEY-----\n', /exactly one SPKI PUBLIC KEY block/u],
    ];
    for (const [name, text, reason] of cases) {
      expect(readReviewerKey(text).problem, name).toMatch(reason);
      expectVerdict(signedTip({ reviewerKeyPem: text, tipReviewerKeyPem: text }), 'indeterminate', reason);
    }
    // The encoding must be the canonical one: flip an unused padding bit of the base64 body (it decodes to the same key).
    const lines = REVIEWER_PEM.split('\n');
    const body = lines[1]!;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const index = body.indexOf('=') > 0 ? body.indexOf('=') - 1 : -1;
    expect(index, 'an SPKI ed25519 body ends in a padded base64 group').toBeGreaterThan(0);
    if (index > 0) {
      const flipped = `${body.slice(0, index)}${alphabet[alphabet.indexOf(body[index]!) ^ 1]}${body.slice(index + 1)}`;
      const padded = [lines[0], flipped, ...lines.slice(2)].join('\n');
      expect(createPublicKeyEquals(padded, REVIEWER_PEM), 'the variant must be the same key').toBe(true);
      expect(readReviewerKey(padded).problem).toMatch(/canonical/u);
    }
    expect(readReviewerKey(REVIEWER_PEM).problem).toBeUndefined();
    expect(readReviewerKey(`${REVIEWER_PEM}\n`).problem, 'a second trailing newline is not part of the one block').toMatch(/exactly one SPKI PUBLIC KEY block/u);
  });

  it('12e. the real reviewer key file committed in this repository is accepted by the key reader', () => {
    const real = readFileSync(resolve(import.meta.dirname, '../.github/julius-landing/reviewer-ed25519.pub'), 'utf8');
    expect(readReviewerKey(real).problem).toBeUndefined();
  });

  it('12f. d4b: a signed tip may not change founder-governed paths, whoever signed it', () => {
    const governed = [
      '.github/workflows/julius-land.yml', '.github/julius-landing/reviewer-ed25519.pub', '.github/julius-landing/allowed-branches.txt', '.github/julius-landing/required-checks.txt',
      'scripts/julius-main-provenance.mjs', 'scripts/julius-main-provenance-signed.test.ts', 'scripts/julius-review-currency.mjs', 'scripts/julius-landing.test.ts',
      'scripts/relay-repository-boundary.mjs', 'scripts/export-julius-harness.mjs', '.github/actions/setup/action.yml', '.github/julius-live-gate.sh',
      '.github/julius-mission-pins.txt', '.github/julius-approvers.json', 'CODEOWNERS', '.github/CODEOWNERS', 'CLAUDE.md', 'package.json', 'package-lock.json',
      'src/relay/persistence/migrations/036_x.sql', 'migration/001.sql',
      '.GITHUB/Julius-Landing/README.md', 'Scripts/Julius-Main-Provenance.MJS', '.github/WORKFLOWS/x.yml',
    ];
    for (const path of governed) {
      expectVerdict(signedTip({ changedPaths: ['src/relay/ordinary.ts', path] }), 'unprovenanced', /founder-governed paths/u);
    }
    // a rename AWAY from a governed path lists the old name too: the caller (the CLI) passes both, and either one refuses
    expectVerdict(signedTip({ changedPaths: ['docs/moved.md', '.github/workflows/old.yml'] }), 'unprovenanced', /founder-governed/u);
    // ordinary work is provenant
    expectVerdict(signedTip({ changedPaths: ['src/a.ts', 'relay-bridge/julius/x.ts', '.github/julius-missions/julius-diag-digest-evidence-2/dryrun/dryrun.sh', 'JULIUS_HARNESS_MANIFEST.md'] }), 'provenant');
  });

  it('12g. d4b: the two exception-eligible files change only when the SIGNED clearance names them exactly', () => {
    const files = ['relay-bridge/julius/role-effort.test.ts', 'scripts/julius-live-contract-check.mjs'];
    const signedFor = (list: string) => message(block({ text: clearanceText({ 'governed-exceptions': list }) }));
    expectVerdict(signedTip({ changedPaths: files }), 'unprovenanced', /founder-governed/u);
    expectVerdict(signedTip({ changedPaths: [files[0]!], mainCommitMessage: signedFor(files[1]!) }), 'unprovenanced', /founder-governed/u);
    expectVerdict(signedTip({ changedPaths: files, mainCommitMessage: signedFor(files.slice().sort().join(',')) }), 'provenant');
    expectVerdict(signedTip({ changedPaths: [files[0]!], mainCommitMessage: signedFor(files[0]!) }), 'provenant');
    // a case variant is a different (never listed) name: refused even when the exact name is signed
    expectVerdict(signedTip({ changedPaths: ['Relay-Bridge/Julius/role-effort.test.ts'], mainCommitMessage: signedFor(files[0]!) }), 'unprovenanced', /founder-governed/u);
  });

  it('12h. d4b: an unreadable, truncated or empty list of changed paths is never a pass', () => {
    expectVerdict(signedTip({ changedPaths: undefined }), 'indeterminate', /could not be read completely/u);
    expectVerdict(signedTip({ changedPathsComplete: undefined }), 'indeterminate', /could not be read completely/u);
    expectVerdict(signedTip({ changedPathsComplete: 'true' }), 'indeterminate');
    expectVerdict(signedTip({ changedPathsComplete: false }), 'indeterminate');
    expectVerdict(signedTip({ changedPaths: [] }), 'indeterminate');
    expectVerdict(signedTip({ changedPaths: ['src/a.ts', ''] }), 'indeterminate');
    expectVerdict(signedTip({ changedPaths: ['src/a.ts', 42] }), 'indeterminate');
    expectVerdict(signedTip({ changedPaths: 'src/a.ts' }), 'indeterminate');
  });

  it('12i. d4b DRIFT: the gate\'s copy of the lander\'s forbidden-path rules equals the lander\'s, to the byte', () => {
    expect(SIGNED_LANDING_GOVERNED.HARD_FORBIDDEN.source).toBe(HARD_FORBIDDEN_PATH.source);
    expect(SIGNED_LANDING_GOVERNED.HARD_FORBIDDEN.flags).toBe(HARD_FORBIDDEN_PATH.flags);
    expect([...SIGNED_LANDING_GOVERNED.EXCEPTION_ELIGIBLE]).toEqual(EXCEPTION_ELIGIBLE);
  });

  it('13. a tip that carries a block is judged by the block ALONE: a legitimate founder approval cannot rescue a bad block', () => {
    const founderStyle = {
      pullRequests: [{ number: 226, merged: true, mergeCommitSha: MAIN, authorLogin: WORKER, headSha: HEAD, baseRef: 'main' }],
      reviewedTreeSha: TREE, reviewedHeadShaAfter: HEAD,
      reviews: [{ commit_id: HEAD, state: 'APPROVED', user: { login: 'ohdieyuh-glitch' } }], reviewComments: [], statuses: [],
      parentContainedInReviewedHead: true, baseRefChanged: false,
    };
    const forged = block({ signature: signWith(attacker.privateKey, clearanceText()) });
    const result = signedTip({ ...founderStyle, mainCommitMessage: message(forged) });
    expect(result.verdict).not.toBe('provenant');
  });

  it('14. no block at all: the founder-approval path decides exactly as before, and an unsigned tip stays unprovenanced', () => {
    const founderStyle = {
      pullRequests: [{ number: 226, merged: true, mergeCommitSha: MAIN, authorLogin: WORKER, headSha: HEAD, baseRef: 'main' }],
      reviewedTreeSha: TREE, reviewedHeadShaAfter: HEAD,
      reviews: [{ commit_id: HEAD, state: 'APPROVED', user: { login: 'ohdieyuh-glitch' } }], reviewComments: [], statuses: [],
      parentContainedInReviewedHead: true, baseRefChanged: false,
    };
    expectVerdict(signedTip({ ...founderStyle, mainCommitMessage: 'Julius: an ordinary squash (#226)\n', reviewerKeyPem: undefined, headCommit: undefined }), 'provenant');
    expectVerdict(signedTip({ pullRequests: [], mainCommitMessage: 'Julius: an ordinary squash\n' }), 'unprovenanced', /no merged pull request/u);
    expectVerdict(signedTip({ pullRequests: [], mainCommitMessage: undefined }), 'unprovenanced', /no merged pull request/u);
    expectVerdict(signedTip({ pullRequests: [], mainCommitMessage: 42 }), 'indeterminate', /could not be read/u);
    expectVerdict(signedTip({ pullRequests: [], mainCommitMessage: null }), 'indeterminate', /could not be read/u);
  });

  it('15. the earlier gates still apply first: main moving, a bad tree read, a merge commit, a root commit', () => {
    expectVerdict(signedTip({ mainShaAfter: OTHER }), 'indeterminate', /moved/u);
    expectVerdict(signedTip({ mainTreeSha: undefined }), 'indeterminate');
    expectVerdict(signedTip({ mainParents: [PARENT, OTHER] }), 'indeterminate', /2 parents/u);
    expectVerdict(signedTip({ mainParents: [] }), 'indeterminate', /0 parents/u);
    expectVerdict(signedTip({ mainParents: undefined }), 'indeterminate');
  });

  it('16. expiry is deliberately not judged: an old clearance proves the content was cleared over that base', () => {
    const old = clearanceText({ issued: '2020-01-01T00:00:00Z', expires: '2020-01-02T00:00:00Z' });
    expectVerdict(signedTip({ mainCommitMessage: message(block({ text: old })) }), 'provenant');
  });
});

describe('the block parser and the restated clearance rules', () => {
  it('extractLandingBlock: absent, ok, invalid', () => {
    expect(extractLandingBlock('an ordinary message\n').state).toBe('absent');
    expect(extractLandingBlock(undefined).state, 'a message never supplied leaves the old path alone').toBe('absent');
    expect(extractLandingBlock(42).state).toBe('invalid');
    expect(extractLandingBlock(null).state).toBe('invalid');
    expect(extractLandingBlock(message())).toMatchObject({ state: 'ok', nonce: NONCE });
    // the API returns a stored message WITHOUT its final newline: still ok; anything after the END marker is not
    expect(extractLandingBlock(message().replace(/\n$/u, ''))).toMatchObject({ state: 'ok', nonce: NONCE });
    expect(extractLandingBlock(`${message()}extra\n`).state).toBe('invalid');
    expect(extractLandingBlock(`${message().replace(/\n$/u, '')}\nextra`).state).toBe('invalid');
    expect(extractLandingBlock(`${message()}\n`).state).toBe('invalid');
  });

  it('parseSignedClearance agrees with the lander\'s parseClearance on a corpus of single-line edits', () => {
    const base = clearanceText();
    const lines = base.split('\n');
    const corpus = new Set<string>([base]);
    lines.forEach((_, i) => {
      corpus.add(lines.filter((__, j) => j !== i).join('\n'));
      corpus.add(lines.map((l, j) => (j === i ? `${l}x` : l)).join('\n'));
      corpus.add(lines.map((l, j) => (j === i ? l.replace(/[0-9a-f]/u, 'g') : l)).join('\n'));
      corpus.add(lines.map((l, j) => (j === i ? '' : l)).join('\n'));
    });
    corpus.add(`${base}\n`);
    corpus.add(base.slice(0, -1));
    corpus.add(clearanceText({ 'governed-exceptions': 'scripts/julius-live-contract-check.mjs' }));
    corpus.add(clearanceText({ 'governed-exceptions': 'scripts/julius-live-contract-check.mjs,relay-bridge/julius/role-effort.test.ts' }));
    corpus.add(clearanceText({ 'governed-exceptions': 'relay-bridge/julius/role-effort.test.ts,scripts/julius-live-contract-check.mjs' }));
    corpus.add(clearanceText({ pr: '0' }));
    corpus.add(clearanceText({ issued: '2026-13-45T00:00:00Z' }));
    let compared = 0;
    for (const text of corpus) {
      const mine = parseSignedClearance(text, 'ohdieyuh-glitch/sunday-relay').problems.length === 0;
      const theirs = parseClearance(text).problems.length === 0;
      expect(mine, `the two parsers disagree on: ${JSON.stringify(text)}`).toBe(theirs);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(40);
  });
});

describe('the CLI on a signed tip', () => {
  const REPO = 'ohdieyuh-glitch/sunday-relay'; // P2: the queried repo must be the clearance's repo
  const keyFile = { type: 'file', encoding: 'base64', content: Buffer.from(REVIEWER_PEM, 'utf8').toString('base64') };
  const routes = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    [`repos/${REPO}/branches/main`]: { commit: { sha: MAIN } },
    [`repos/${REPO}/commits/${MAIN}`]: { commit: { tree: { sha: TREE }, message: message() }, parents: [{ sha: PARENT }] },
    [`repos/${REPO}/commits/${MAIN}/pulls`]: [],
    [`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub@${PARENT}`]: keyFile,
    [`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub@${MAIN}`]: keyFile,
    [`repos/${REPO}/commits/${HEAD}`]: {
      sha: HEAD,
      author: { login: WORKER },
      commit: { tree: { sha: TREE }, author: { name: WORKER, email: 'worker@invalid' }, verification: { verified: false, reason: 'unsigned' } },
    },
    [`repos/${REPO}/pulls/381`]: { number: 381, user: { login: WORKER, type: 'Bot' }, head: { sha: HEAD } },
    [`repos/${REPO}/compare/${PARENT}...${MAIN}`]: { ahead_by: 1, behind_by: 0, files: [{ filename: 'src/relay/ordinary.ts' }] },
    ...over,
  });

  /**
   * A STUB `gh` THAT WORKS ON EVERY PLATFORM. The gate spawns `gh` without a shell, and Windows will not execute an
   * extensionless script, so the stub is a COPY OF THE NODE BINARY named `gh`, and NODE_OPTIONS preloads a script that
   * answers from the table when (and only when) the process is the stub, so the gate itself is untouched.
   */
  const stubDirectory = mkdtempSync(join(tmpdir(), 'julius-provenance-gh-'));
  const stubName = process.platform === 'win32' ? 'gh.exe' : 'gh';
  copyFileSync(process.execPath, join(stubDirectory, stubName));
  afterAll(() => { rmSync(stubDirectory, { recursive: true, force: true }); });

  const run = (table: Record<string, unknown>) => {
    const directory = mkdtempSync(join(tmpdir(), 'julius-provenance-signed-'));
    try {
      const stub = join(directory, 'stub.cjs');
      writeFileSync(stub, [
        'const base = require("node:path").basename(process.execPath).toLowerCase();',
        'if (base === "gh" || base === "gh.exe") {',
        `  const table = ${JSON.stringify(table)};`,
        '  const full = process.argv[process.argv.length - 1] ?? "";',
        '  const split = full.split("?");',
        '  const ref = (split[1] ?? "").replace(/^ref=/, "");',
        '  const path = split[0].includes("/contents/") ? split[0] + "@" + ref : split[0];',
        '  if (!(path in table)) { process.stderr.write("stub: no route for " + path + "\\n"); process.exit(1); }',
        '  process.stdout.write(JSON.stringify(table[path]));',
        '  process.exit(0);',
        '}',
      ].join('\n'));
      const env: Record<string, string | undefined> = { ...process.env };
      for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
      env.PATH = `${stubDirectory}${delimiter}${process.env.PATH ?? ''}`;
      env.NODE_OPTIONS = `--require=${stub.replace(/\\/gu, '/')}`;
      try {
        const stdout = execFileSync(process.execPath, [resolve(import.meta.dirname, 'julius-main-provenance.mjs'), REPO], {
          encoding: 'utf8', env, stdio: 'pipe',
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

  it('proves a signed tip end to end, reading the key at the parent', () => {
    const result = run(routes());
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('provenance=provenant');
    expect(result.stdout).toContain('approved_by=INDEPENDENT_REVIEW');
    expect(result.stdout).toContain('pr=381');
  }, 30_000);

  it('a key that exists only at the tip (never at the parent) is an error, never a pass', () => {
    const onlyTip = routes(); delete onlyTip[`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub@${PARENT}`];
    expect(run(onlyTip).code).toBe(1);
  }, 30_000);

  it('a tip that changes the key file, or lacks it, is never a pass even when the parent key signs the block', () => {
    const swapped = run(routes({ [`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub@${MAIN}`]: { ...keyFile, content: Buffer.from(pem(attacker.publicKey), 'utf8').toString('base64') } }));
    expect(swapped.code).toBe(1);
    expect(swapped.stderr).toContain('changes the reviewer key file');
    const noTip = routes(); delete noTip[`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub@${MAIN}`];
    expect(run(noTip).code).toBe(1);
  }, 60_000);

  it('a missing key, a missing head commit or a wrong head author is never a pass', () => {
    const noKey = routes(); delete noKey[`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub@${PARENT}`];
    expect(run(noKey).code).toBe(1);
    const noHead = routes(); delete noHead[`repos/${REPO}/commits/${HEAD}`];
    expect(run(noHead).code).toBe(1);
    const wrongAuthor = run(routes({
      [`repos/${REPO}/commits/${HEAD}`]: {
        sha: HEAD,
        author: { login: WORKER },
        commit: { tree: { sha: TREE }, author: { name: WORKER, email: '41898282+julius-worker[bot]@users.noreply.github.com' } },
      },
      [`repos/${REPO}/pulls/381`]: { number: 381, user: { login: 'a-passing-collaborator', type: 'User' }, head: { sha: HEAD } },
    }));
    expect(wrongAuthor.code).toBe(1);
    expect(wrongAuthor.stderr).toContain('not the coding worker');
    const spoofedEmail = run(routes({
      [`repos/${REPO}/pulls/381`]: { number: 381, user: { login: 'a-dev-session', type: 'Bot' }, head: { sha: HEAD } },
    }));
    expect(spoofedEmail.code).toBe(1);
    expect(spoofedEmail.stderr).toContain('not the coding worker');
    const emailDisagrees = run(routes({
      [`repos/${REPO}/commits/${HEAD}`]: {
        sha: HEAD,
        author: { login: 'a-dev-session' },
        commit: { tree: { sha: TREE }, author: { name: WORKER, email: 'spoofed@invalid' } },
      },
    }));
    expect(emailDisagrees.code).toBe(1);
    expect(emailDisagrees.stderr).toContain('email-derived');
    const attackerFile = { ...keyFile, content: Buffer.from(pem(attacker.publicKey), 'utf8').toString('base64') };
    const wrongKey = run(routes({
      [`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub@${PARENT}`]: attackerFile,
      [`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub@${MAIN}`]: attackerFile,
    }));
    expect(wrongKey.code).toBe(1);
    expect(wrongKey.stderr).toContain('does not verify');
  }, 60_000);

  it('d4b: a governed path, a renamed-away governed path, a tip that is not exactly one commit ahead, 300 files or no compare answer is never a pass', () => {
    const compare = (over: Record<string, unknown>) => routes({ [`repos/${REPO}/compare/${PARENT}...${MAIN}`]: { ahead_by: 1, behind_by: 0, files: [{ filename: 'src/relay/ordinary.ts' }], ...over } });
    const governed = run(compare({ files: [{ filename: 'src/relay/ordinary.ts' }, { filename: '.github/julius-landing/land.mjs' }] }));
    expect(governed.code).toBe(1);
    expect(governed.stderr).toContain('founder-governed paths');
    const renamed = run(compare({ files: [{ filename: 'docs/new.md', previous_filename: '.github/workflows/old.yml' }] }));
    expect(renamed.code).toBe(1);
    expect(renamed.stderr).toContain('founder-governed paths');
    expect(run(compare({ ahead_by: 2 })).code).toBe(1);
    expect(run(compare({ behind_by: 1 })).code).toBe(1);
    expect(run(compare({ files: Array.from({ length: 300 }, (_, i) => ({ filename: `src/f${i}.ts` })) })).code).toBe(1);
    expect(run(compare({ files: undefined })).code).toBe(1);
    const noCompare = routes(); delete noCompare[`repos/${REPO}/compare/${PARENT}...${MAIN}`];
    expect(run(noCompare).code).toBe(1);
  }, 120_000);

  it('a tip without a block costs no extra reads: the old path answers exactly as before', () => {
    const legacy = routes({
      [`repos/${REPO}/commits/${MAIN}`]: { commit: { tree: { sha: TREE }, message: 'Julius: ordinary (#226)\n' }, parents: [{ sha: PARENT }] },
    });
    delete legacy[`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub@${PARENT}`];
    delete legacy[`repos/${REPO}/contents/.github/julius-landing/reviewer-ed25519.pub@${MAIN}`];
    const result = run(legacy);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no merged pull request records');
  }, 30_000);

  it('an evidence file that omits any signed-path field can never pass', () => {
    const full = {
      mainSha: MAIN, mainShaAfter: MAIN, mainTreeSha: TREE, mainParents: [PARENT], mainCommitMessage: message(),
      reviewerKeyPem: REVIEWER_PEM, reviewerKeyAtSha: PARENT, tipReviewerKeyPem: REVIEWER_PEM,
      changedPaths: ['src/a.ts'], changedPathsComplete: true, headCommit: clearedHead(),
    };
    const runEvidence = (evidence: Record<string, unknown>) => {
      const directory = mkdtempSync(join(tmpdir(), 'julius-provenance-signed-evidence-'));
      const file = join(directory, 'evidence.json');
      try {
        writeFileSync(file, JSON.stringify(evidence));
        try {
          const stdout = execFileSync(process.execPath, [resolve(import.meta.dirname, 'julius-main-provenance.mjs'), REPO, 'main', '--evidence', file], { encoding: 'utf8', stdio: 'pipe' });
          return { code: 0, stdout };
        } catch (error) {
          return { code: (error as { status?: number }).status ?? -1, stdout: String((error as { stdout?: string }).stdout ?? '') };
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    };
    const ok = runEvidence(full);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('provenance=provenant');
    for (const field of ['mainCommitMessage', 'reviewerKeyPem', 'reviewerKeyAtSha', 'tipReviewerKeyPem', 'changedPaths', 'changedPathsComplete', 'headCommit', 'mainParents', 'mainTreeSha'] as const) {
      const { [field]: _omitted, ...trimmed } = full;
      const result = runEvidence(trimmed);
      expect(result.code, `omitting ${field} must not pass`).toBe(1);
      expect(result.stdout).not.toContain('provenance=provenant');
    }
  }, 90_000);
});

describe('v3.5b S-3: the queried repository is REQUIRED (library, GitHub mode and --evidence mode) and compared case-insensitively', () => {
  const R = 'ohdieyuh-glitch/sunday-relay';
  it('a missing repo is refused, in the parser and in the verdict (it was silently skipped)', () => {
    expect(parseSignedClearance(clearanceText()).problems.join(';')).toMatch(/queried repository is required/u);
    expect(parseSignedClearance(clearanceText(), undefined).problems.join(';')).toMatch(/queried repository is required/u);
    expectVerdict(signedTip({ repo: undefined }), 'indeterminate', /malformed.*queried repository is required/u);
    expectVerdict(signedTip({ repo: 42 }), 'indeterminate', /queried repository is required/u);
  });
  it('a mixed-case spelling of the landing repository is accepted; another repository is not', () => {
    expect(parseSignedClearance(clearanceText(), 'Ohdieyuh-Glitch/Sunday-Relay').problems).toEqual([]);
    expectVerdict(signedTip({ repo: 'OHDIEYUH-GLITCH/SUNDAY-RELAY' }), 'provenant');
    expectVerdict(signedTip({ repo: 'ohdieyuh-glitch/sunday-relay2' }), 'indeterminate', /queried repo/u);
  });
  it('--evidence mode uses the repository on the command line (the file cannot supply or omit it)', () => {
    const full = {
      mainSha: MAIN, mainShaAfter: MAIN, mainTreeSha: TREE, mainParents: [PARENT], mainCommitMessage: message(),
      reviewerKeyPem: REVIEWER_PEM, reviewerKeyAtSha: PARENT, tipReviewerKeyPem: REVIEWER_PEM,
      changedPaths: ['src/a.ts'], changedPathsComplete: true, headCommit: clearedHead(),
    };
    const run = (repoArg: string, evidence: Record<string, unknown>) => {
      const directory = mkdtempSync(join(tmpdir(), 'julius-provenance-s3-'));
      const file = join(directory, 'evidence.json');
      try {
        writeFileSync(file, JSON.stringify(evidence));
        try {
          return { code: 0, stdout: execFileSync(process.execPath, [resolve(import.meta.dirname, 'julius-main-provenance.mjs'), repoArg, 'main', '--evidence', file], { encoding: 'utf8', stdio: 'pipe' }) };
        } catch (error) {
          return { code: (error as { status?: number }).status ?? -1, stdout: String((error as { stdout?: string }).stdout ?? '') + String((error as { stderr?: string }).stderr ?? '') };
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    };
    expect(run(R, full).stdout).toContain('provenance=provenant');
    expect(run('Ohdieyuh-Glitch/Sunday-Relay', full).stdout).toContain('provenance=provenant');
    const other = run('someone/else', full);
    expect(other.code).toBe(1);
    expect(other.stdout).not.toContain('provenance=provenant');
    expect(other.stdout).toMatch(/queried repo/u);
    // a file that carries its OWN repo cannot override the command line
    const lying = run('someone/else', { ...full, repo: R });
    expect(lying.stdout).not.toContain('provenance=provenant');
  }, 90_000);
});
