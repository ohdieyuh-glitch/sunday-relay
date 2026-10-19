import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  cloneAuthorizedRepository,
  pushAuthorizedBranch,
  type GitRunner,
} from './repository-remote-transport';
import { buildEphemeralGitAuth } from './repository-credential';
import { ok } from '../src/relay/protocol/errors';

/**
 * THE REMOTE TRANSPORT — its guards, proven against real local git and by the
 * argv it constructs. Every credential/force/ref guard here is written so that
 * reverting it fails a specifically-named test.
 *
 * The token strings are fixtures, not secrets.
 */

const TOKEN = 'fixture-not-a-real-secret-abcdef';
const temps: string[] = [];
afterEach(() => { for (const p of temps.splice(0)) { try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } } });
function temp(prefix: string): string { const p = mkdtempSync(join(tmpdir(), prefix)); temps.push(p); return p; }

const ENV = (home: string) => ({
  PATH: process.env.PATH ?? '', HOME: home,
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x',
  GIT_TERMINAL_PROMPT: '0',
});
const git = (args: string[], cwd: string, home: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV(home) }).trim();

/** A work repo whose `origin` is a local bare repo, with `main` committed. */
function repoWithBareOrigin(): { work: string; bare: string; home: string } {
  const home = temp('relay-tr-home-');
  const bare = temp('relay-tr-bare-'); rmSync(bare, { recursive: true, force: true });
  git(['init', '--bare', '-b', 'main', bare], temp('relay-tr-x-'), home);
  const work = temp('relay-tr-work-');
  git(['init', '-b', 'main', work], work, home);
  writeFileSync(join(work, 'a.txt'), 'one\n');
  git(['add', '-A'], work, home); git(['commit', '-m', 'baseline'], work, home);
  git(['remote', 'add', 'origin', bare], work, home);
  git(['push', 'origin', 'main'], work, home);
  return { work, bare, home };
}

const nullAuth = () => buildEphemeralGitAuth(null);

describe('pushAuthorizedBranch — pushes only the branch, no force, verifies the remote ref', () => {
  it('pushes the feature branch and confirms the remote tip is the exact commit', () => {
    const { work, home } = repoWithBareOrigin();
    git(['checkout', '-b', 'relay/feat'], work, home);
    writeFileSync(join(work, 'a.txt'), 'two\n');
    git(['add', '-A'], work, home); git(['commit', '-m', 'change'], work, home);
    const sha = git(['rev-parse', 'HEAD'], work, home);

    const auth = nullAuth();
    const r = pushAuthorizedBranch({ worktreePath: work, branch: 'relay/feat', expectedSha: sha, auth });
    auth.dispose();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.observedRemoteSha).toBe(sha);
      expect(r.value.matchesExpected).toBe(true);
    }
  });

  it('REFUSES a non-fast-forward push rather than forcing it', () => {
    const { work, home } = repoWithBareOrigin();
    git(['checkout', '-b', 'relay/feat'], work, home);
    writeFileSync(join(work, 'a.txt'), 'two\n'); git(['add', '-A'], work, home); git(['commit', '-m', 'c1'], work, home);
    const auth1 = nullAuth();
    expect(pushAuthorizedBranch({ worktreePath: work, branch: 'relay/feat', expectedSha: git(['rev-parse', 'HEAD'], work, home), auth: auth1 }).ok).toBe(true);
    auth1.dispose();
    // Rewrite the branch to a commit that is NOT a descendant — a force would be needed to land it.
    git(['reset', '--hard', 'HEAD~1'], work, home);
    writeFileSync(join(work, 'a.txt'), 'divergent\n'); git(['add', '-A'], work, home); git(['commit', '-m', 'c2'], work, home);
    const auth2 = nullAuth();
    const r = pushAuthorizedBranch({ worktreePath: work, branch: 'relay/feat', expectedSha: git(['rev-parse', 'HEAD'], work, home), auth: auth2 });
    auth2.dispose();
    expect(r.ok).toBe(false); // rejected (non-fast-forward); no force is ever passed
  });

  it('reports matchesExpected=false when the remote tip is not the expected commit (race/mismatch)', () => {
    const { work, home } = repoWithBareOrigin();
    git(['checkout', '-b', 'relay/feat'], work, home);
    writeFileSync(join(work, 'a.txt'), 'two\n'); git(['add', '-A'], work, home); git(['commit', '-m', 'c'], work, home);
    const auth = nullAuth();
    // Push the branch, but claim to expect a DIFFERENT (valid) sha.
    const other = git(['rev-parse', 'main'], work, home);
    const r = pushAuthorizedBranch({ worktreePath: work, branch: 'relay/feat', expectedSha: other, auth });
    auth.dispose();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.matchesExpected).toBe(false);
  });

  it('refuses a branch name of a rejected shape before any git runs', () => {
    const auth = nullAuth();
    for (const bad of ['--force', 'a:b', 'a b', '-x', 'a..b']) {
      const r = pushAuthorizedBranch({ worktreePath: temp('relay-tr-nop-'), branch: bad, expectedSha: 'a'.repeat(40), auth });
      expect(r.ok, bad).toBe(false);
    }
    auth.dispose();
  });

  it('never writes the token into .git/config after an authenticated push', () => {
    const { work, home } = repoWithBareOrigin();
    git(['checkout', '-b', 'relay/feat'], work, home);
    writeFileSync(join(work, 'a.txt'), 'two\n'); git(['add', '-A'], work, home); git(['commit', '-m', 'c'], work, home);
    const auth = buildEphemeralGitAuth({ token: TOKEN, source: 'env_var', envVarName: 'GITHUB_TOKEN' });
    pushAuthorizedBranch({ worktreePath: work, branch: 'relay/feat', expectedSha: git(['rev-parse', 'HEAD'], work, home), auth });
    auth.dispose();
    const cfg = readFileSync(join(work, '.git', 'config'), 'utf8');
    expect(cfg).not.toContain(TOKEN);
  });
});

describe('the argv is constructed safely — token never in it, redirects off, no force', () => {
  const capture = (): { calls: string[][]; run: GitRunner } => {
    const calls: string[][] = [];
    const run: GitRunner = (args) => { calls.push([...args]); return ok(''); };
    return { calls, run };
  };

  it('clone: refuses redirects, no tags, token never in argv', () => {
    const { calls, run } = capture();
    const auth = buildEphemeralGitAuth({ token: TOKEN, source: 'env_var', envVarName: 'GITHUB_TOKEN' });
    cloneAuthorizedRepository({
      cloneUrl: 'https://github.com/o/r.git', destPath: '/tmp/x/checkout', runFrom: '/tmp/x',
      baseBranch: 'main', identity: { host: 'github.com', owner: 'o', name: 'r' }, auth,
    }, run);
    auth.dispose();
    const argv = calls[0] ?? [];
    expect(argv).toContain('clone');
    expect(argv).toContain('--no-tags');
    expect(argv.join(' ')).toContain('http.followRedirects=false');
    expect(argv.join(' ')).not.toContain(TOKEN); // the token is ONLY in extraEnv, never argv
  });

  it('push: exact same-branch refspec, no --force anywhere, token never in argv', () => {
    const { calls, run } = capture();
    const auth = buildEphemeralGitAuth({ token: TOKEN, source: 'env_var', envVarName: 'GITHUB_TOKEN' });
    pushAuthorizedBranch({ worktreePath: '/tmp/x', branch: 'relay/feat', expectedSha: 'a'.repeat(40), auth }, run);
    auth.dispose();
    const pushArgv = calls[0] ?? [];
    expect(pushArgv).toEqual([...auth.configArgs, 'push', 'origin', 'relay/feat:relay/feat']);
    expect(pushArgv.join(' ')).not.toContain('--force');
    expect(pushArgv.join(' ')).not.toContain(TOKEN);
  });
});

describe('cloneAuthorizedRepository — identity and failure guards', () => {
  it('refuses a checkout whose origin is not the registered repository', () => {
    const { bare, home } = repoWithBareOrigin();
    void home;
    const dest = join(temp('relay-tr-dest-'), 'checkout');
    const auth = nullAuth();
    const r = cloneAuthorizedRepository({
      cloneUrl: bare, destPath: dest, runFrom: temp('relay-tr-from-'),
      baseBranch: 'main', identity: { host: 'github.com', owner: 'o', name: 'r' }, auth,
    });
    auth.dispose();
    // The clone succeeds locally, but its origin is the bare path, not
    // github.com/o/r — the identity check refuses it.
    expect(r.ok).toBe(false);
  });

  it('fails cleanly when the clone URL does not resolve', () => {
    const auth = nullAuth();
    const parent = temp('relay-tr-from2-');
    const r = cloneAuthorizedRepository({
      cloneUrl: join(parent, 'does-not-exist.git'), destPath: join(parent, 'checkout'), runFrom: parent,
      baseBranch: 'main', identity: { host: 'github.com', owner: 'o', name: 'r' }, auth,
    });
    auth.dispose();
    expect(r.ok).toBe(false);
  });
});
