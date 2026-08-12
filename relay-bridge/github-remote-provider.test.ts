import { describe, expect, it, vi } from 'vitest';

import { createGitHubRemoteProvider, type FetchLike } from './github-remote-provider';
import { pushLanded, refusePushTarget } from '../src/relay/mission/repository-target';

/**
 * GITHUB AS THE FIRST REMOTE PROVIDER — proven entirely offline.
 *
 * `REPOSITORY_TARGETS.md` has listed this as the first thing not built since the
 * feature existed: push, PR and merge were AUTHORIZED by the permission ladder
 * and PERFORMED by nothing.
 *
 * Every test here drives an injected fetch, exactly as `remote-transport.test.ts`
 * does for the Hermes service. Nothing opens a socket, resolves a host or reads a
 * real credential. What is held is that the provider is a NARROW surface: the
 * dangerous operations are not merely refused, they are unreachable.
 */

const TOKEN = 'ghp_FAKE_NEVER_SENT_ANYWHERE';
const NOW = '2026-08-11T12:00:00.000Z';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const reply = (status: number, body: unknown): ReturnType<FetchLike> =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

const provider = (fetchImpl: FetchLike, env: Record<string, string> = { RELAY_GITHUB_TOKEN: TOKEN }) =>
  createGitHubRemoteProvider({
    credentialEnvVarName: 'RELAY_GITHUB_TOKEN',
    env: env as NodeJS.ProcessEnv,
    fetchImpl,
    now: () => NOW,
  });

const captured = (status: number, body: unknown) => {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fn: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    return reply(status, body);
  };
  return { fn, calls };
};

describe('the credential goes into a header and nowhere else', () => {
  it('sends it as a bearer token', async () => {
    const { fn, calls } = captured(200, { object: { sha: SHA } });
    await provider(fn).push({
      repositoryKey: 'github:github.com/o/r', owner: 'o', repo: 'r', branch: 'relay/x', expectedHeadSha: SHA,
    });
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('never returns the credential, or anything derived from it', async () => {
    // A length or a prefix is not a secret, and it lets two deployments be
    // compared for equality — more than any caller needs.
    const observation = await provider(() => reply(401, { message: `bad token ${TOKEN}` })).push({
      repositoryKey: 'k', owner: 'o', repo: 'r', branch: 'relay/x', expectedHeadSha: SHA,
    });
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('ghp_');
    expect(serialized).not.toMatch(/length|tokenLength|sha256/i);
  });

  it('never surfaces the provider body, which echoes the request', async () => {
    /**
     * GitHub's error bodies quote the request, and the request carries the
     * token. Only the STATUS leaves this module.
     */
    const observation = await provider(() => reply(422, { message: `Validation failed for ${TOKEN}` })).push({
      repositoryKey: 'k', owner: 'o', repo: 'r', branch: 'relay/x', expectedHeadSha: SHA,
    });
    expect(observation.detail).toBe('GitHub answered HTTP 422.');
    expect(JSON.stringify(observation)).not.toContain('Validation failed');
  });

  it('says a missing credential is missing, naming the variable and not looking for it elsewhere', async () => {
    const fetchImpl = vi.fn();
    const observation = await provider(fetchImpl as unknown as FetchLike, {}).push({
      repositoryKey: 'k', owner: 'o', repo: 'r', branch: 'relay/x', expectedHeadSha: SHA,
    });
    expect(observation.ok).toBe(false);
    expect(observation.detail).toContain('RELAY_GITHUB_TOKEN');
    // And no request was attempted.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('the dangerous operations are unreachable, not merely refused', () => {
  it('exposes exactly three operations', () => {
    const p = provider(() => reply(200, {}));
    // No delete, no create-repository, no force, no arbitrary request.
    const methods = Object.keys(p).filter((key) => typeof (p as unknown as Record<string, unknown>)[key] === 'function');
    expect(methods.sort()).toEqual(['mergePullRequest', 'openPullRequest', 'push']);
  });

  it('has no way to express a force push', () => {
    // The port has no `force` field, so this is a type-level guarantee. Asserted
    // against the source so a future field cannot be added quietly.
    const p = provider(() => reply(200, {}));
    expect(JSON.stringify(p.descriptor)).not.toContain('force');
    expect(p.descriptor.supports).toEqual(['push_feature_branch', 'create_pr', 'merge_pr']);
  });

  it('carries the credential env var NAME in its descriptor, never a value', () => {
    const p = provider(() => reply(200, {}));
    expect(p.descriptor.credentialEnvVarName).toBe('RELAY_GITHUB_TOKEN');
    expect(JSON.stringify(p.descriptor)).not.toContain(TOKEN);
  });

  it('never opens a DRAFT pull request or grants maintainer write to the branch', async () => {
    const { fn, calls } = captured(201, { number: 7, html_url: 'https://github.com/o/r/pull/7' });
    await provider(fn).openPullRequest({
      owner: 'o', repo: 'r', head: 'relay/x', base: 'main', title: 't', body: 'b',
    });
    const sent = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    // A draft opens a pull request nobody is asked to review.
    expect(sent.draft).toBe(false);
    // `maintainer_can_modify` grants write on the Mission's branch to anyone
    // with repository write — a permission Relay was not given to give away.
    expect(sent).not.toHaveProperty('maintainer_can_modify');
  });
});

describe('segments are validated before they reach a URL', () => {
  it('refuses an owner, repo or branch that could change the request', async () => {
    const fetchImpl = vi.fn();
    const p = provider(fetchImpl as unknown as FetchLike);
    for (const [owner, repo, branch] of [
      ['../evil', 'r', 'relay/x'],
      ['o', 'r/../../admin', 'relay/x'],
      ['o', 'r', '../../../refs/heads/main'],
      ['o', 'r', 'relay/x?force=true'],
    ] as const) {
      const observation = await p.push({ repositoryKey: 'k', owner, repo, branch, expectedHeadSha: SHA });
      expect(observation.ok, `${owner}/${repo}#${branch}`).toBe(false);
    }
    // Not one of them reached a request.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a pull-request reference that is not a number', async () => {
    const fetchImpl = vi.fn();
    const observation = await provider(fetchImpl as unknown as FetchLike)
      .mergePullRequest({ owner: 'o', repo: 'r', reference: '7/../../merge' });
    expect(observation.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a pull request whose head and base are the same', async () => {
    const fetchImpl = vi.fn();
    const observation = await provider(fetchImpl as unknown as FetchLike)
      .openPullRequest({ owner: 'o', repo: 'r', head: 'main', base: 'main', title: 't', body: 'b' });
    expect(observation.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('what the remote reported, never what Relay asked for', () => {
  it('reads the branch tip back and does not default it from the expectation', async () => {
    const observation = await provider(() => reply(200, { object: {} })).push({
      repositoryKey: 'k', owner: 'o', repo: 'r', branch: 'relay/x', expectedHeadSha: SHA,
    });
    // The provider answered without a sha. Unknown is not the expected value.
    expect(observation.observedHeadSha).toBeNull();
    const verdict = pushLanded({ expectedHeadSha: SHA, observation });
    expect(verdict.landed).toBe(false);
    /**
     * AND THE REASON DISTINGUISHES THE TWO FAILURES.
     *
     * `landed: false` alone is not enough: with the unreported-tip branch
     * removed, `null !== SHA` still refuses — so a `.landed` assertion passes
     * either way. What changes is whether an operator is told "the provider did
     * not report the tip" (go look at the provider) or "the tip is X, not Y" (go
     * look at the branch). One of those trips is wasted.
     */
    expect(verdict.reason).toContain('did not report the branch tip');
    expect(verdict.reason).not.toContain('not the');
  });

  it('reports a push as landed only when the tip IS the committed commit', async () => {
    const good = await provider(() => reply(200, { object: { sha: SHA } })).push({
      repositoryKey: 'k', owner: 'o', repo: 'r', branch: 'relay/x', expectedHeadSha: SHA,
    });
    expect(pushLanded({ expectedHeadSha: SHA, observation: good }).landed).toBe(true);

    const other = await provider(() => reply(200, { object: { sha: 'f'.repeat(40) } })).push({
      repositoryKey: 'k', owner: 'o', repo: 'r', branch: 'relay/x', expectedHeadSha: SHA,
    });
    const verdict = pushLanded({ expectedHeadSha: SHA, observation: other });
    expect(verdict.landed).toBe(false);
    expect(verdict.reason).toContain('not the');
  });

  it('confirms a merge by READING IT BACK, not by the merge call\'s own answer', async () => {
    /**
     * GitHub's merge endpoint returns `merged: true`, and that is the provider
     * reporting on itself — the same reason `decideShipped` wants a live probe.
     */
    let call = 0;
    const observation = await provider(() => {
      call += 1;
      // The merge says yes; the read-back says the PR is not merged.
      return call === 1 ? reply(200, { merged: true }) : reply(200, { merged: false, html_url: 'u' });
    }).mergePullRequest({ owner: 'o', repo: 'r', reference: '7' });
    expect(call).toBe(2);
    expect(observation.ok).toBe(false);
    expect(observation.state).toBeNull();
    expect(observation.detail).toContain('does not read as merged');
  });

  it('reports a merge that really merged', async () => {
    let call = 0;
    const observation = await provider(() => {
      call += 1;
      return call === 1 ? reply(200, { merged: true }) : reply(200, { merged: true, html_url: 'https://github.com/o/r/pull/7' });
    }).mergePullRequest({ owner: 'o', repo: 'r', reference: '7' });
    expect(observation.ok).toBe(true);
    expect(observation.state).toBe('merged');
  });

  it('treats an unreachable provider as unreachable, not as a failure to merge', async () => {
    const observation = await provider(() => Promise.reject(new Error(`ECONNREFUSED ${TOKEN}`))).push({
      repositoryKey: 'k', owner: 'o', repo: 'r', branch: 'relay/x', expectedHeadSha: SHA,
    });
    expect(observation.ok).toBe(false);
    // A thrown fetch can carry the request in its message.
    expect(JSON.stringify(observation)).not.toContain(TOKEN);
    expect(observation.detail).toBe('GitHub could not be reached.');
  });
});

describe('where a push may go is a separate question from whether it may happen', () => {
  it('refuses the base branch and every protected branch, by name', () => {
    const base = refusePushTarget({ branch: 'main', baseBranch: 'main', protectedBranches: ['main'] });
    expect(base?.refusal).toBe('protected_branch_target');
    expect(base?.message).toContain('base branch');

    const guarded = refusePushTarget({ branch: 'release', baseBranch: 'main', protectedBranches: ['main', 'release'] });
    expect(guarded?.refusal).toBe('protected_branch_target');
  });

  it('permits a working branch', () => {
    // A Mission can hold `push_feature_branch` legitimately and still have no
    // business pushing `main`; these are different questions.
    expect(refusePushTarget({
      branch: 'relay/mission-1', baseBranch: 'main', protectedBranches: ['main'],
    })).toBeNull();
  });
});
