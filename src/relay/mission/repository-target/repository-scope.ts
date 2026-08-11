/**
 * SCOPE AND PROTECTION — which paths this Mission may read, may write, and may
 * never touch.
 *
 * TWO MATCHING LANGUAGES, ON PURPOSE, AND THE REASON IS A DEFECT CLASS.
 *
 *   - SCOPE is glob-matched (`src/**`, `packages/*​/src/**`). It has to be,
 *     because a useful write scope in a real repository is a shape, not a list.
 *   - PROTECTION is literal segment-prefix matched (`.github` covers
 *     `.github/workflows/ci.yml` and never `.github-notes.md`), because that is
 *     exactly what `src/relay/workspace/protected-paths.ts` already enforces
 *     when Relay inspects the worktree after the agent exits.
 *
 * If protection accepted globs here, a founder could write `**​/*.yml` in a
 * protected list, this layer would agree it was protected, and the ENFORCING
 * layer — which does not understand globs — would classify the same file as
 * unprotected. The rule would be true in the record and false in the
 * repository: a claim the code does not support, which is the failure mode
 * that has produced more Relay defects than any other. So a glob character in a
 * protected path is refused at registration, by name, rather than accepted into
 * a list that cannot honour it.
 */

import { normalizeRepoPath } from '../../coordination/claims';
import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  ALWAYS_PROTECTED_PATHS,
  DEFAULT_PROTECTED_PATHS,
  type ProtectedPathConfig,
  type RepositoryScope,
} from './repository-contracts';

const GLOB_CHARS = /[*?[\]{}]/;

/** Segment-prefix match, identical in behaviour to the workspace enforcer. */
export const protectedPathMatches = (rule: string, candidate: string): boolean =>
  candidate === rule || candidate.startsWith(`${rule}/`);

/**
 * Glob match over an already-normalized repository-relative path.
 *
 * Supported, and nothing else: `**` (any number of segments, including none),
 * `*` (any characters within ONE segment), and literal segments. `?`, character
 * classes and brace expansion are deliberately absent — every one of them is a
 * way to write a pattern whose meaning a reader has to compute, and this
 * pattern decides what an agent may overwrite.
 *
 * A pattern with no glob character behaves as a segment prefix, so `src`
 * matches `src/a/b.ts`. That makes the common case ("this directory") readable
 * and makes scope agree with protection on literal paths.
 */
export function scopeMatches(pattern: string, candidate: string): boolean {
  if (pattern === '**') return true;
  if (!GLOB_CHARS.test(pattern)) return protectedPathMatches(pattern, candidate);

  const patternSegments = pattern.split('/');
  const candidateSegments = candidate.split('/');

  const walk = (p: number, c: number): boolean => {
    if (p === patternSegments.length) return c === candidateSegments.length;
    const segment = patternSegments[p] as string;
    if (segment === '**') {
      // `**` is the last segment: it absorbs the rest, including nothing.
      if (p === patternSegments.length - 1) return true;
      for (let skip = c; skip <= candidateSegments.length; skip += 1) {
        if (walk(p + 1, skip)) return true;
      }
      return false;
    }
    if (c >= candidateSegments.length) return false;
    if (!singleSegmentMatches(segment, candidateSegments[c] as string)) return false;
    return walk(p + 1, c + 1);
  };
  return walk(0, 0);
}

/** `*` inside one segment. Written as a scan rather than a constructed RegExp
 *  so a pattern can never inject regex syntax into the matcher. */
function singleSegmentMatches(pattern: string, segment: string): boolean {
  if (!pattern.includes('*')) return pattern === segment;
  const parts = pattern.split('*');
  const first = parts[0] as string;
  const last = parts[parts.length - 1] as string;
  if (!segment.startsWith(first)) return false;
  if (segment.length < first.length + last.length) return false;
  if (!segment.endsWith(last)) return false;
  let cursor = first.length;
  for (let i = 1; i < parts.length - 1; i += 1) {
    const middle = parts[i] as string;
    if (middle === '') continue;
    const found = segment.indexOf(middle, cursor);
    if (found === -1 || found + middle.length > segment.length - last.length) return false;
    cursor = found + middle.length;
  }
  return true;
}

export const pathInScope = (patterns: readonly string[], candidate: string): boolean =>
  patterns.some((pattern) => scopeMatches(pattern, candidate));

/* ------------------------------------------------------------ validation */

/** Normalize and validate one scope side. `**` is allowed through unchanged —
 *  `normalizeRepoPath` would reject nothing about it, but it is also not a path
 *  and running it through a path normalizer to get the same string back is the
 *  kind of incidental behaviour that changes when the normalizer does. */
function normalizeScopeSide(patterns: readonly string[], label: string): RelayResult<string[]> {
  const out: string[] = [];
  for (const raw of patterns) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      return fail(relayError('validation-failed', `${label} scope contains an empty pattern.`));
    }
    if (raw === '**') {
      out.push('**');
      continue;
    }
    // Normalize the glob-free skeleton so traversal, absolute paths and null
    // bytes are refused with the same rules claims use, then keep the original
    // pattern — the normalizer would strip nothing here but is not a glob
    // parser and must not be trusted to preserve one.
    const skeleton = raw.replace(/\*+/g, 'x').replace(/[?[\]{}]/g, 'x');
    const normalized = normalizeRepoPath(skeleton);
    if (!normalized.ok) {
      return fail(relayError('validation-failed', `${label} scope pattern "${raw}": ${normalized.error.message}`));
    }
    // Collapse duplicate and trailing separators in the real pattern too, so
    // `src//**` and `src/**/` cannot describe the same rule two ways.
    const cleaned = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    if (cleaned === '') {
      return fail(relayError('validation-failed', `${label} scope pattern "${raw}" resolves to nothing.`));
    }
    out.push(cleaned);
  }
  return ok([...new Set(out)]);
}

/**
 * Validate a repository scope.
 *
 * An empty WRITE scope is legal and means read-only, which is a supported and
 * useful mode. An empty READ scope is refused: it means nothing may be read,
 * which no Mission can use, and the tempting fallback — "empty means
 * everything" — is a default that silently grants. `['**']` says everything,
 * in a human's own writing.
 */
export function validateRepositoryScope(scope: RepositoryScope): RelayResult<RepositoryScope> {
  if (!scope || !Array.isArray(scope.read) || !Array.isArray(scope.write)) {
    return fail(relayError('validation-failed', 'Repository scope must declare read and write arrays.'));
  }
  if (scope.read.length === 0) {
    return fail(relayError('validation-failed', 'Repository read scope is empty — write ["**"] to allow everything.'));
  }
  const read = normalizeScopeSide(scope.read, 'read');
  if (!read.ok) return read;
  const write = normalizeScopeSide(scope.write, 'write');
  if (!write.ok) return write;
  // A writable path that is not readable is incoherent: the agent would be
  // authorized to overwrite a file it may not open. Refused rather than
  // silently widening the read side, which would grant something nobody wrote.
  const unreadable = write.value.filter((pattern) => !patternCoveredBy(pattern, read.value));
  if (unreadable.length > 0) {
    return fail(
      relayError(
        'validation-failed',
        `Write scope is not covered by read scope: ${unreadable.join(', ')}. Widen read explicitly.`,
      ),
    );
  }
  return ok({ read: read.value, write: write.value });
}

/**
 * The directory a cover is GUARANTEED to contain, or null when it guarantees
 * none.
 *
 * `src` guarantees `src`. `src/relay/**` guarantees `src/relay` — everything it
 * matches lives under that directory. `src/*.ts` and `packages/*​/src/**`
 * guarantee nothing usable, because the glob is not at the tail, and null is the
 * conservative answer: it produces a refusal a human can fix, where a guess
 * would produce a grant nobody wrote.
 */
function guaranteedDirectory(cover: string): string | null {
  if (!GLOB_CHARS.test(cover)) return cover;
  if (!cover.endsWith('/**')) return null;
  const prefix = cover.slice(0, -3);
  return prefix !== '' && !GLOB_CHARS.test(prefix) ? prefix : null;
}

/**
 * Is every path this pattern could match also matched by one of `covers`?
 *
 * Decided structurally rather than by sampling. Every path a pattern matches
 * begins with the pattern's own glob-free prefix, so the pattern is covered
 * when some cover is guaranteed to contain that prefix.
 *
 * `src/**` is covered by `src`, by `src/**` and by `**`; it is NOT covered by
 * `src/*.ts`, and not by `src/relay/**` — which is narrower, not wider.
 *
 * WHY THE TAIL-GLOB CASE IS HANDLED RATHER THAN REFUSED. The first version of
 * this function only accepted glob-FREE covers, which meant a read scope of
 * `src/**` did not cover a write scope of `src/relay/**` — a completely ordinary
 * and deliberately narrow configuration, refused. The direction of that error
 * was "safe" in the local sense and unsafe in the real one: the way to get past
 * the refusal was to widen read to `['**']`, so the check pushed founders
 * toward the LESS restrictive configuration. A guard that makes the secure
 * option the awkward one is a guard that gets configured around.
 *
 * The conservative direction is still "not covered" everywhere the shape is not
 * one of the two this function can reason about exactly.
 */
function patternCoveredBy(pattern: string, covers: readonly string[]): boolean {
  if (covers.includes('**') || covers.includes(pattern)) return true;
  const segments = pattern.split('/');
  const globAt = segments.findIndex((s) => GLOB_CHARS.test(s));
  const literalPrefix = (globAt === -1 ? segments : segments.slice(0, globAt)).join('/');
  if (literalPrefix === '') return false;
  return covers.some((cover) => {
    const directory = guaranteedDirectory(cover);
    return directory !== null && protectedPathMatches(directory, literalPrefix);
  });
}

/**
 * Resolve the protected set: always-protected ∪ (defaults − unprotect) ∪
 * additional.
 *
 * `unprotect` may never reach `ALWAYS_PROTECTED_PATHS`. That refusal is by name
 * (`protected_path_unprotect_refused`), not a silent filter, because a founder
 * who wrote `.git` in an unprotect list believes something that is not true and
 * should be told rather than quietly overridden.
 */
export function resolveProtectedPaths(config: ProtectedPathConfig): RelayResult<string[]> {
  const additional = config?.additional ?? [];
  const unprotect = config?.unprotect ?? [];
  for (const raw of [...additional, ...unprotect]) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      return fail(relayError('validation-failed', 'Protected-path configuration contains an empty entry.'));
    }
    if (GLOB_CHARS.test(raw)) {
      return fail(
        relayError(
          'validation-failed',
          `Protected path "${raw}" contains a glob. Protection is literal segment-prefix matching — ` +
            'a glob here would be honoured by the policy record and ignored by the enforcer.',
        ),
      );
    }
    const normalized = normalizeRepoPath(raw);
    if (!normalized.ok) {
      return fail(relayError('validation-failed', `Protected path "${raw}": ${normalized.error.message}`));
    }
  }
  const normalize = (raw: string): string => {
    const n = normalizeRepoPath(raw);
    return n.ok ? n.value : raw;
  };
  const unprotectSet = new Set(unprotect.map(normalize));
  for (const always of ALWAYS_PROTECTED_PATHS) {
    if (unprotectSet.has(always)) {
      return fail(relayError('permission-denied', `"${always}" is protected unconditionally and cannot be unprotected.`));
    }
  }
  const resolved = new Set<string>(ALWAYS_PROTECTED_PATHS);
  for (const path of DEFAULT_PROTECTED_PATHS) {
    if (!unprotectSet.has(path)) resolved.add(path);
  }
  for (const path of additional) resolved.add(normalize(path));
  return ok([...resolved].sort());
}

/* ------------------------------------------------- observed-diff checking */

export interface ScopeVerdict {
  /** Paths inside the write scope and not protected. */
  readonly allowed: readonly string[];
  /** Paths that matched a protected rule. Any one of these fails the Mission. */
  readonly protectedHits: readonly string[];
  /** Paths outside the write scope. Any one of these fails the Mission. */
  readonly outOfScope: readonly string[];
  /** Paths that could not be normalized at all. Treated as out of scope. */
  readonly invalid: readonly string[];
}

/**
 * Classify a set of OBSERVED changed paths.
 *
 * The input must come from Relay reading the worktree, never from the agent's
 * report. This function has no way to tell the difference, which is exactly why
 * the caller's responsibility is stated here: the agent's account of what it
 * touched is never the authority, and passing it here would launder a claim
 * into a verdict.
 *
 * PROTECTION WINS OVER SCOPE. A path inside the write scope that also matches a
 * protected rule is protected. A scope never grants a protected write and
 * scopes are never expanded automatically — the same precedence
 * `classifyChangedPath` already enforces one layer down.
 */
export function classifyObservedChanges(input: {
  readonly changedPaths: readonly string[];
  readonly writeScope: readonly string[];
  readonly protectedPaths: readonly string[];
}): ScopeVerdict {
  const allowed: string[] = [];
  const protectedHits: string[] = [];
  const outOfScope: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.changedPaths) {
    const normalized = normalizeRepoPath(raw);
    if (!normalized.ok) {
      invalid.push(raw);
      continue;
    }
    const path = normalized.value;
    if (input.protectedPaths.some((rule) => protectedPathMatches(rule, path))) {
      protectedHits.push(path);
      continue;
    }
    if (!pathInScope(input.writeScope, path)) {
      outOfScope.push(path);
      continue;
    }
    allowed.push(path);
  }
  return { allowed, protectedHits, outOfScope, invalid };
}

/**
 * Narrow a Mission's requested scope against the registration's.
 *
 * A Mission may ask for less than the repository allows; it may never ask for
 * more. Asking for more is REFUSED rather than clamped: a clamp turns a
 * founder's mistaken request into a silently different Mission, and the
 * Reviewer would then be reading a diff produced under a scope nobody wrote
 * down.
 */
export function narrowScope(
  registered: RepositoryScope,
  requested: RepositoryScope | null,
): RelayResult<RepositoryScope> {
  if (requested === null) return ok(registered);
  const validated = validateRepositoryScope(requested);
  if (!validated.ok) return validated;
  const exceededRead = validated.value.read.filter((p) => !patternCoveredBy(p, registered.read));
  const exceededWrite = validated.value.write.filter((p) => !patternCoveredBy(p, registered.write));
  if (exceededRead.length > 0 || exceededWrite.length > 0) {
    const parts: string[] = [];
    if (exceededRead.length > 0) parts.push(`read: ${exceededRead.join(', ')}`);
    if (exceededWrite.length > 0) parts.push(`write: ${exceededWrite.join(', ')}`);
    return fail(
      relayError(
        'permission-denied',
        `Mission scope exceeds the repository registration (${parts.join(' · ')}).`,
      ),
    );
  }
  return ok(validated.value);
}
