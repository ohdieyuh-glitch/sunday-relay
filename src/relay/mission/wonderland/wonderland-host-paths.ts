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
 *
 * THE WINDOWS SHAPES A UNIX-STYLE SHELL WRITES (independent review JU-348-04):
 * Git Bash and MSYS2 name a drive as a ONE-LETTER ROOT -- `/c/Users/<name>/…`,
 * `/d/dev/…` -- and Cygwin as `/cygdrive/c/…`. A one-letter root followed by `/`
 * is a host path, under the same look-behind, so `cmd /c x`, `a/c/b`, `1/c/2`,
 * `./c/main.c` and `example.com/c/x` stay prose; the price is that a route whose
 * FIRST segment is one letter (`/v/1/users`) is cut too. WSL's `/mnt/c/…` was
 * already a root. The Win32 extended-length and device prefixes (`\\?\C:\…`,
 * `\\.\C:\…`) were already cut by the UNC pattern, but the drive pattern cut the
 * `C:\…` inside them first, so ONE path counted as TWO cuts; the drive pattern now
 * leaves a drive that follows such a prefix to the UNC pattern.
 */

/** Global patterns, for a caller that REPLACES every match (`String#replace`). */
export const WONDERLAND_HOST_PATH_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bfile:\/\/[^\s"'`<>]+/gi,
  /(?<!\\\\[?.]\\)\b[A-Za-z]:[\\/][^\s"'`<>|]*/g,
  /\\\\[^\s\\"'`<>|]+\\[^\s"'`<>|]*/g,
  /(?<![\w.~:/\\-])\/(?:home|Users|root|tmp|var|opt|srv|mnt|private|etc|usr|workspace|workspaces|data|run|Volumes|app|github|__w|nix|builds|Library|System|Applications|cygdrive)\/[^\s"'`<>]*/g,
  /(?<![\w.~:/\\-])\/[A-Za-z]\/[^\s"'`<>]*/g,
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
