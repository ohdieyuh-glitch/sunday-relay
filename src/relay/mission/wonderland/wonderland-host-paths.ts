/**
 * A PATH ON THE HOST THAT RAN THE MISSION -- the ONE definition every world body
 * screens with (row 12, R4: no host path in ANY body; internal review M3).
 *
 * `/result` cuts such a path back to its file name (`trimHostPaths`,
 * wonderland-julius-result.ts); an `/events` envelope DROPS a metadata value that
 * holds one (`sanitizeWonderlandMetadata`, wonderland-envelope.ts). Two rules of
 * what to do, one rule of what a host path is: the patterns live here so the two
 * routes cannot disagree about it.
 *
 * `file://` URLs first, so one is cut as a whole; then drive paths, UNC paths, and
 * POSIX paths under a system or home root (macOS's `/Users`, `/Volumes` and
 * `/private` among them). A RELATIVE path -- `src/app.ts` -- is the project's own
 * and is not a host path.
 *
 * THE ROOTS A DEPLOYMENT REALLY USES (internal verify m2): `/app` (the container
 * working directory Railway's Nixpacks builds into), `/github` and `/__w` (GitHub's
 * container jobs), `/nix` and `/builds` (the Nix store, GitLab's runners), and
 * macOS's `/Library`, `/System` and `/Applications`. And a HOME-RELATIVE path,
 * `~/…` or `~\…`, which names the home directory of whoever ran the mission. A root
 * must be followed by `/`, and none may follow a word character, a dot or another
 * path character, so `deployed to /app`, `src/app/main.ts`, `example.com/app/x`
 * and `~5/10` are prose, not paths.
 */

/** Global patterns, for a caller that REPLACES every match (`String#replace`). */
export const WONDERLAND_HOST_PATH_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bfile:\/\/[^\s"'`<>]+/gi,
  /\b[A-Za-z]:[\\/][^\s"'`<>|]*/g,
  /\\\\[^\s\\"'`<>|]+\\[^\s"'`<>|]*/g,
  /(?<![\w.~:/\\-])\/(?:home|Users|root|tmp|var|opt|srv|mnt|private|etc|usr|workspace|workspaces|data|run|Volumes|app|github|__w|nix|builds|Library|System|Applications)\/[^\s"'`<>]*/g,
  /(?<![\w.~:/\\-])~[\\/][^\s"'`<>]+/g,
]);

/**
 * The same patterns WITHOUT the global flag, for a yes/no question: a global
 * RegExp's `test` moves its `lastIndex`, so asking it twice about two strings can
 * answer no for a string that holds a path.
 */
const PROBES: readonly RegExp[] = Object.freeze(
  WONDERLAND_HOST_PATH_PATTERNS.map((pattern) => new RegExp(pattern.source, pattern.flags.replace('g', ''))),
);

/** Whether a text holds a path on the host, by the patterns above. */
export function containsWonderlandHostPath(text: string): boolean {
  return PROBES.some((probe) => probe.test(text));
}
