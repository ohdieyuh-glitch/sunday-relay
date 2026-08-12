/**
 * REPOSITORY IDENTITY — the canonical key, and what makes one valid.
 *
 * One repository must have exactly one name in Relay, or two registrations
 * describe the same thing with different permissions and the narrower one is
 * decorative. Everything here is pure string logic over an already-supplied
 * identity: no network lookup, no URL fetching, no guessing an owner from a
 * clone URL. Deriving identity from a URL is exactly the inference this whole
 * module exists to prevent — the registrar states the identity, and a clone URL
 * is checked AGAINST it rather than parsed INTO it.
 */

import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  IMPLEMENTED_REPOSITORY_PROVIDERS,
  REPOSITORY_PROVIDERS,
  type RepositoryIdentity,
  type RepositoryLocation,
  type RepositoryProviderId,
} from './repository-contracts';

/** Owner/name segments. Deliberately narrower than every host allows: this is
 *  a key that ends up in a path segment, a branch name and a log line, and the
 *  characters excluded here are the ones that would make any of those
 *  ambiguous. A legitimate repository that cannot be expressed is a
 *  registration that gets refused by name, which is recoverable; a key that can
 *  contain a slash or a space is a containment bug, which is not. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Host: dotted labels, no scheme, no port, no path, no credentials. */
const HOST = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Branch names reuse the workspace's shape rules; this is the pure subset
 *  that does not need a git process. Kept local rather than imported so this
 *  module stays free of the Node-side workspace tree. */
export function validRepositoryBranchName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return false;
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return false;
  if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  return !name
    .split('/')
    .some((seg) => seg === '' || seg === '.' || seg === '..' || seg.startsWith('-') || seg.endsWith('.lock'));
}

export const isRepositoryProviderId = (value: string): value is RepositoryProviderId =>
  (REPOSITORY_PROVIDERS as readonly string[]).includes(value);

/** Whether Relay has an implementation that can actually drive this provider.
 *  Registered and drivable are two different facts; see the contracts. */
export const repositoryProviderSupported = (provider: RepositoryProviderId): boolean =>
  IMPLEMENTED_REPOSITORY_PROVIDERS.includes(provider);

/**
 * THE CANONICAL KEY. `local:<name>` or `<provider>:<host>/<owner>/<name>`.
 *
 * Case is normalized for the host only. Owner and repository name are NOT
 * lowercased: GitHub treats them case-insensitively but preserves case, and
 * other hosts (and every local filesystem Relay runs on) do not. Lowercasing
 * them here would merge two genuinely different targets on a case-sensitive
 * host, which is a wrong answer in the direction of MORE access.
 */
export function repositoryKey(identity: RepositoryIdentity): string {
  if (identity.provider === 'local') return `local:${identity.name}`;
  return `${identity.provider}:${(identity.host ?? '').toLowerCase()}/${identity.owner}/${identity.name}`;
}

/**
 * Validate an identity, returning the canonical key.
 *
 * `local` is the only provider without a host and owner, and it must not have
 * them — a local identity carrying `github.com` would produce a key that looks
 * remote and a target that is not, which is precisely the confusion the
 * requested-vs-actual attestation exists to surface. Refusing it at
 * registration means it never gets that far.
 */
export function validateRepositoryIdentity(identity: RepositoryIdentity): RelayResult<string> {
  if (!identity || typeof identity !== 'object') {
    return fail(relayError('validation-failed', 'Repository identity is missing.'));
  }
  if (!isRepositoryProviderId(identity.provider)) {
    return fail(relayError('validation-failed', `Unknown repository provider "${String(identity.provider)}".`));
  }
  if (!SEGMENT.test(identity.name ?? '')) {
    return fail(relayError('validation-failed', 'Repository name has a rejected shape.'));
  }
  if (!validRepositoryBranchName(identity.defaultBranch ?? '')) {
    return fail(relayError('validation-failed', 'Repository default branch has a rejected shape.'));
  }
  if (identity.provider === 'local') {
    if (identity.host !== null) {
      return fail(relayError('validation-failed', 'A local repository identity may not carry a host.'));
    }
    if (identity.owner !== null) {
      return fail(relayError('validation-failed', 'A local repository identity may not carry an owner.'));
    }
    return ok(repositoryKey(identity));
  }
  if (typeof identity.host !== 'string' || !HOST.test(identity.host)) {
    return fail(relayError('validation-failed', 'Repository host has a rejected shape.'));
  }
  if (!SEGMENT.test(identity.owner ?? '')) {
    return fail(relayError('validation-failed', 'Repository owner has a rejected shape.'));
  }
  return ok(repositoryKey(identity));
}

/**
 * Validate the location AGAINST the identity it claims to be.
 *
 * A remote identity with a local path, or a clone URL whose host is not the
 * identity's host, is a registration that would fetch one repository while
 * every permission check reasoned about another. The check is a comparison,
 * never an extraction: nothing here reads the owner out of the URL and adopts
 * it.
 *
 * Only `https` is accepted. `ssh://` and `git@host:owner/name` forms are
 * refused because they authenticate from an ambient key on the host — a
 * credential Relay neither issued, scoped, nor can revoke, which defeats the
 * entire credential boundary. `git://` and `file://` are refused for the same
 * class of reason: no authentication at all, and no server identity to verify.
 */
export function validateRepositoryLocation(
  identity: RepositoryIdentity,
  location: RepositoryLocation,
): RelayResult<RepositoryLocation> {
  if (!location || typeof location !== 'object') {
    return fail(relayError('validation-failed', 'Repository location is missing.'));
  }
  if (identity.provider === 'local') {
    if (location.kind !== 'local_path') {
      return fail(relayError('validation-failed', 'A local repository must carry a local path location.'));
    }
    if (typeof location.path !== 'string' || location.path.trim() === '') {
      return fail(relayError('validation-failed', 'Local repository path is empty.'));
    }
    if (location.path.includes('\0')) {
      return fail(relayError('validation-failed', 'Local repository path contains a null byte.'));
    }
    // Containment against an approved root is a filesystem question and lives
    // in the Node provider, which can canonicalize. This layer only refuses
    // shapes that are wrong regardless of where they point.
    return ok(location);
  }
  if (location.kind !== 'remote_clone') {
    return fail(relayError('validation-failed', 'A remote repository must carry a clone URL.'));
  }
  let parsed: URL;
  try {
    parsed = new URL(location.cloneUrl);
  } catch {
    return fail(relayError('validation-failed', 'Repository clone URL could not be parsed.'));
  }
  if (parsed.protocol !== 'https:') {
    return fail(relayError('validation-failed', 'Repository clone URL must use https.'));
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return fail(relayError('validation-failed', 'Repository clone URL may not embed credentials.'));
  }
  if (parsed.hostname.toLowerCase() !== (identity.host ?? '').toLowerCase()) {
    return fail(relayError('validation-failed', 'Repository clone URL host does not match the registered host.'));
  }
  const path = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/, '');
  if (path !== `${identity.owner}/${identity.name}`) {
    return fail(relayError('validation-failed', 'Repository clone URL path does not match the registered owner/name.'));
  }
  return ok(location);
}

/**
 * Build the attestation from what was requested and what was observed.
 *
 * `matches` is COMPUTED here from the two halves rather than passed in, so no
 * caller can report agreement it did not establish. A missing observation is
 * never agreement: every `actual*` field must be present and equal.
 */
export function buildRepositoryTargetAttestation(input: {
  readonly requestedKey: string;
  readonly requestedBaseBranch: string;
  readonly requestedBaselineSha: string | null;
  readonly requestedWorkingBranch: string;
  readonly observed: {
    readonly key: string | null;
    readonly baseBranch: string | null;
    readonly baselineSha: string | null;
    readonly workingBranch: string | null;
    readonly observedAt: string | null;
  } | null;
}): import('./repository-contracts').RepositoryTargetAttestation {
  const observed = input.observed;
  const actualKey = observed?.key ?? null;
  const actualBaseBranch = observed?.baseBranch ?? null;
  const actualBaselineSha = observed?.baselineSha ?? null;
  const actualWorkingBranch = observed?.workingBranch ?? null;
  const matches =
    actualKey !== null &&
    actualBaseBranch !== null &&
    actualBaselineSha !== null &&
    actualWorkingBranch !== null &&
    actualKey === input.requestedKey &&
    actualBaseBranch === input.requestedBaseBranch &&
    actualWorkingBranch === input.requestedWorkingBranch &&
    // A requested baseline that nobody pinned cannot be contradicted, so its
    // absence does not by itself make the observation a mismatch. A PRESENT
    // requested baseline that differs from the observed one always does.
    (input.requestedBaselineSha === null || input.requestedBaselineSha === actualBaselineSha);
  return {
    requestedKey: input.requestedKey,
    requestedBaseBranch: input.requestedBaseBranch,
    requestedBaselineSha: input.requestedBaselineSha,
    actualKey,
    actualBaseBranch,
    actualBaselineSha,
    actualWorkingBranch,
    matches,
    observedAt: observed?.observedAt ?? null,
  };
}
