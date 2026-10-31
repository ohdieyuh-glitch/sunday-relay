/* Round 10 (Skywalker 5a6e3400 F9-4, Low): the secret-name heuristic gains the names her probe recorded into the tree,
   plus common credential files. Still a documented HEURISTIC (names, not contents); the refusal lists paths only. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as S from './e2-safe-git';
import { git } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-secret-r15-')));
const priv = join(root, 'tmp'); mkdirSync(priv); process.env.TMPDIR = priv;
afterAll(() => rmSync(root, { recursive: true, force: true }));
const SECRET = 'TOPSECRET-r15-value';
const NEW = ['.ssh/id_ed25519', 'id_ecdsa', 'k/id_dsa', '.git-credentials', 'cert.p12', 'c.PFX', '.pgpass', '.kube/config', 'token.json',
  '.pypirc', '.aws/credentials', 'service-account.json', 'service-account-prod.json', 'a.keystore', 'b.jks', '.dockercfg', '.docker/config.json',
  'k.gpg', 'tokens.txt', 'token', 'prod.tfvars', 'private.asc', 'secring.asc'];
describe('F9-4: extended secret names', () => {
  for (const p of NEW) it(`isSecretPath(${p})`, () => { expect(S.isSecretPath(p)).toBe(true); });
  for (const p of ['config.json', 'src/config.ts', 'README.asc', 'pubkey.asc', 'a.json', 'mytoken.md', 'kube/config', 'docker/config.json', 'account.json'])
    it(`not secret: ${p}`, () => { expect(S.isSecretPath(p)).toBe(false); });
  it('Skywalker probe set: refused by snapshotCommitSafely with paths only, never content', () => {
    const dir = join(root, 'ws'); mkdirSync(dir);
    git(dir, 'init', '-q'); writeFileSync(join(dir, 'a.txt'), '1\n'); git(dir, 'add', '-A'); git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'b');
    const head = git(dir, 'rev-parse', 'HEAD');
    const probe = ['.ssh/id_ed25519', 'id_ecdsa', '.git-credentials', 'cert.p12', '.pgpass', '.kube/config', 'token.json'];
    for (const p of probe) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), SECRET); }
    const out = S.snapshotCommitSafely({ workspace: dir, parent: head, message: 'm', author: { name: 'n', email: 'e@x' } });
    expect(out).toEqual({ refused: 'safe_git_secret_path', paths: [...probe].sort() });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });
});
