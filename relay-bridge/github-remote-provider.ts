import { safeText } from './redact';
import type {
  PushObservation,
  PushRequest,
  RemoteProviderDescriptor,
  RemoteRepositoryProvider,
} from '../src/relay/mission/repository-target';

/**
 * GITHUB, AS THE FIRST REMOTE PROVIDER — and only the first.
 *
 * Nothing in the Mission engine branches on `=== 'github'`; this implements the
 * port and is wired by a composition root, so the next provider is an addition
 * rather than a rewrite. That was the architecture requirement from the day
 * repository targets were designed.
 *
 * THE CREDENTIAL IS READ HERE AND LEAVES NOWHERE ELSE. It comes from the env var
 * the target's `CredentialBoundary` NAMES, it goes into an `Authorization`
 * header, and it appears in no return value, no error, no log line and no
 * record. Every failure path returns a fixed sentence plus the HTTP status —
 * never the provider's body, which can quote the request, which can quote the
 * credential.
 *
 * THE CAPABILITIES THIS DELIBERATELY LACKS:
 *
 *   - no force push: the port has no `force` field and this sends no such
 *     parameter. `git push --force` is not expressible.
 *   - no branch deletion, no ref deletion, no tag operations.
 *   - no repository creation. The founder's rule is that Relay must never
 *     silently create a public repository, and the strongest form of that rule
 *     is code that cannot create one at all.
 *   - no arbitrary request. Three operations, three fixed URL shapes built from
 *     validated segments.
 *
 * PROVEN OFFLINE. `fetchImpl` is injected, exactly as `remote-transport.ts` does
 * for the Hermes service, so every behaviour here is tested against a fake fetch
 * and nothing reaches the network in a test run.
 */

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export const GITHUB_API_ROOT = 'https://api.github.com';

/** Owner/repo/branch segments, narrow on purpose: these are interpolated into a
 *  URL, and a segment containing a slash or a `..` is a different request. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export interface GitHubProviderConfig {
  /** The env var the credential is read from. The NAME travels; the value does not. */
  readonly credentialEnvVarName: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => string;
  readonly apiRoot?: string;
}

const descriptorFor = (config: GitHubProviderConfig): RemoteProviderDescriptor => ({
  providerId: 'github',
  displayName: 'GitHub',
  credentialEnvVarName: config.credentialEnvVarName,
  // `merge_pr` is supported because the founder asked for it. It is still never
  // implied — the permission ladder decides whether a Mission may ask.
  supports: ['push_feature_branch', 'create_pr', 'merge_pr'],
});

export function createGitHubRemoteProvider(config: GitHubProviderConfig): RemoteRepositoryProvider {
  const descriptor = descriptorFor(config);
  const env = config.env ?? process.env;
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const now = config.now ?? (() => new Date().toISOString());
  const root = config.apiRoot ?? GITHUB_API_ROOT;

  /** Never returns the credential, and never says how long it is. */
  const credential = (): string | null => {
    const value = env[config.credentialEnvVarName];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };

  const badSegments = (owner: string, repo: string): string | null => {
    if (!SEGMENT.test(owner)) return 'owner';
    if (!SEGMENT.test(repo)) return 'repository';
    return null;
  };

  /**
   * One request. Returns a decoded body or a SAFE failure — the provider's body
   * is never surfaced, because it echoes the request, which carries the token.
   */
  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; status: number; detail: string }> => {
    const token = credential();
    if (token === null) {
      return {
        ok: false,
        status: 0,
        detail: `No credential is configured in ${config.credentialEnvVarName}.`,
      };
    }
    try {
      const response = await doFetch(`${root}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'sunday-relay',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      if (!response.ok) {
        // The STATUS, never the body.
        return { ok: false, status: response.status, detail: `GitHub answered HTTP ${String(response.status)}.` };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, status: response.status, detail: 'GitHub returned a body Relay could not read.' };
      }
      if (parsed === null || typeof parsed !== 'object') {
        return { ok: false, status: response.status, detail: 'GitHub returned a body Relay could not read.' };
      }
      return { ok: true, json: parsed as Record<string, unknown> };
    } catch {
      // A thrown fetch can carry the request in its message.
      return { ok: false, status: 0, detail: 'GitHub could not be reached.' };
    }
  };

  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? safeText(value) : null;

  return {
    descriptor,

    /**
     * PUSH IS A REF READ-BACK, NOT A GIT PUSH.
     *
     * This module holds no git process and opens no transport — it asks GitHub
     * what the branch's tip IS, after the bridge's own git surface has done the
     * pushing. Splitting it this way is what keeps `--force` unreachable: the
     * thing that talks to GitHub cannot push, and the thing that can push has no
     * credential.
     *
     * The caller compares the answer with `pushLanded`. A provider reporting
     * success is not evidence that the right commit is there.
     */
    async push(request: PushRequest): Promise<PushObservation> {
      const bad = badSegments(request.owner, request.repo);
      if (bad !== null || !BRANCH.test(request.branch)) {
        return {
          ok: false, providerId: 'github', branch: null, observedHeadSha: null,
          observedAt: now(), detail: `The ${bad ?? 'branch'} name has a rejected shape.`,
        };
      }
      const result = await call(
        'GET',
        `/repos/${request.owner}/${request.repo}/git/ref/heads/${request.branch}`,
      );
      if (!result.ok) {
        return {
          ok: false, providerId: 'github', branch: request.branch, observedHeadSha: null,
          observedAt: now(), detail: result.detail,
        };
      }
      const object = result.json.object;
      const sha = object !== null && typeof object === 'object'
        ? str((object as Record<string, unknown>).sha)
        : null;
      return {
        ok: true, providerId: 'github', branch: request.branch,
        // Absent stays absent. Never defaulted from what was expected.
        observedHeadSha: sha,
        observedAt: now(), detail: null,
      };
    },

    async openPullRequest(request) {
      const bad = badSegments(request.owner, request.repo);
      if (bad !== null || !BRANCH.test(request.head) || !BRANCH.test(request.base)) {
        return {
          ok: false, providerId: 'github', reference: null, url: null, state: null,
          observedAt: now(), detail: `The ${bad ?? 'branch'} name has a rejected shape.`,
        };
      }
      if (request.head === request.base) {
        // GitHub would refuse this too, but refusing here names the reason.
        return {
          ok: false, providerId: 'github', reference: null, url: null, state: null,
          observedAt: now(), detail: 'A pull request cannot have the same head and base.',
        };
      }
      const result = await call('POST', `/repos/${request.owner}/${request.repo}/pulls`, {
        title: request.title,
        head: request.head,
        base: request.base,
        body: request.body,
        /**
         * NEVER A DRAFT, and never `maintainer_can_modify: true`. The first
         * would open a pull request nobody is asked to review; the second grants
         * write access to the Mission's branch to anyone with repository write,
         * which is a permission Relay was not given to give away.
         */
        draft: false,
      });
      if (!result.ok) {
        return {
          ok: false, providerId: 'github', reference: null, url: null, state: null,
          observedAt: now(), detail: result.detail,
        };
      }
      const number = typeof result.json.number === 'number' ? String(result.json.number) : null;
      return {
        ok: true, providerId: 'github', reference: number,
        url: str(result.json.html_url), state: 'open', observedAt: now(), detail: null,
      };
    },

    async mergePullRequest(request) {
      const bad = badSegments(request.owner, request.repo);
      if (bad !== null || !/^[0-9]{1,10}$/.test(request.reference)) {
        return {
          ok: false, providerId: 'github', reference: null, url: null, state: null,
          observedAt: now(), detail: `The ${bad ?? 'pull request reference'} has a rejected shape.`,
        };
      }
      /**
       * THE MERGE IS CONFIRMED BY READING IT BACK, not by the merge call's own
       * answer. GitHub's merge endpoint returns `merged: true`, and that is the
       * provider reporting on itself — the same reason `decideShipped` wants a
       * live probe. A pull request that reports `merged` and a base branch that
       * did not move is a state worth being able to detect.
       */
      const merge = await call('PUT', `/repos/${request.owner}/${request.repo}/pulls/${request.reference}/merge`, {
        merge_method: 'squash',
      });
      if (!merge.ok) {
        return {
          ok: false, providerId: 'github', reference: request.reference, url: null, state: null,
          observedAt: now(), detail: merge.detail,
        };
      }
      const readBack = await call('GET', `/repos/${request.owner}/${request.repo}/pulls/${request.reference}`);
      const state = readBack.ok && readBack.json.merged === true ? 'merged' : null;
      return {
        ok: state === 'merged',
        providerId: 'github',
        reference: request.reference,
        url: readBack.ok ? str(readBack.json.html_url) : null,
        state,
        observedAt: now(),
        detail: state === 'merged'
          ? null
          : 'GitHub accepted the merge and the pull request does not read as merged.',
      };
    },
  };
}
