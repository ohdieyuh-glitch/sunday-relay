/**
 * WHICH FILE THE PREFLIGHT WRITES TO WHEN IT PROVES THE HAND-OFF.
 *
 * The preflight's decisive check is that a change written on the HOST appears
 * in the diff a SANDBOX captures — because that is exactly how a paid mission
 * works, and a break in it yields an independent review of nothing after an
 * architect and a coding agent have already been paid.
 *
 * That check needs a file to write to, and the file has to be one `git diff`
 * will actually report:
 *
 *   - TRACKED, because `git diff` never reports an untracked file. This is the
 *     preflight's own stated failure mode, so the probe must not fall into it.
 *   - TEXT, because git renders a changed binary file as `Binary files differ`
 *     and the probe marker would never appear no matter how well the hand-off
 *     worked.
 *
 * IT USED TO BE THE STRING `README.md`. Every mission seeded from a throwaway
 * tree happened to ship one, so the assumption held for three paid missions and
 * was never a stated requirement of a mission workspace. Mission 4 is the first
 * SLICE mission — its workspace is `git archive` of three real Relay files plus
 * one overlaid spec — and it has no README. The preflight died on ENOENT two
 * seconds into run 34433098911, before any provider was contacted. The gate
 * worked; the assumption inside it did not.
 *
 * SO THE FILE IS DISCOVERED, NOT ASSUMED. The caller lists what git tracks and
 * hands that list here; this module picks the first candidate that can actually
 * carry the proof, and, when none can, reports every path it rejected AND why —
 * a mission workspace with no tracked text file cannot produce a reviewable
 * diff at all, which is worth failing loudly for rather than skipping.
 *
 * IT READS NOTHING ITSELF. The reader is injected, so the choice is a pure
 * function of the tracked list and the bytes on disk, and is unit-tested
 * against every rejection reason without a sandbox, a database or a runner.
 */

/** Read a workspace-relative path. Returns the bytes, or throws as `fs` does. */
export type ProbeReader = (relativePath: string) => Buffer;

/** The most candidates read from disk before the search gives up. A tracked
 *  list can be thousands of paths; the proof only needs one, and every read is
 *  a real file read on the runner. */
export const PROBE_CANDIDATE_LIMIT = 64;

/** Bigger than this and the probe is moving more bytes than the proof is
 *  worth — the whole workspace ceiling is 4 MiB. */
export const PROBE_MAX_BYTES = 1_048_576;

/** Tried first when tracked, so the three throwaway-tree missions keep probing
 *  exactly the file they always probed and their preflight output is unchanged. */
export const PROBE_PREFERRED = 'README.md';

export type ProbeRejection = { readonly path: string; readonly reason: string };

export type ProbeSelection =
  | { readonly ok: true; readonly path: string; readonly content: Buffer; readonly examined: number }
  | { readonly ok: false; readonly examined: number; readonly tracked: number; readonly rejected: readonly ProbeRejection[] };

/** A path any of whose segments begins with a dot: `.julius/loader.mjs`,
 *  `.github/...`. Tooling a workspace carries, never the mission's subject. */
const isToolingPath = (path: string): boolean => path.split('/').some((segment) => segment.startsWith('.'));

/** Deterministic, in three tiers: the preferred name when git tracks it, then
 *  ordinary paths, then tooling paths — each tier in git's own order, which is
 *  sorted. The same workspace always probes the same file, so a preflight
 *  failure is reproducible rather than a coin flip.
 *
 *  TOOLING LAST is not cosmetic. A slice mission's first tracked path is
 *  `.julius/loader.mjs`, the import harness; probing the file the CODING AGENT
 *  will actually edit exercises the same kind of path the mission does, and
 *  leaves the harness untouched even for the microsecond the marker is on disk. */
export function orderProbeCandidates(tracked: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const tiers = [
    tracked.filter((path) => path === PROBE_PREFERRED),
    tracked.filter((path) => path !== PROBE_PREFERRED && !isToolingPath(path)),
    tracked.filter((path) => path !== PROBE_PREFERRED && isToolingPath(path)),
  ];
  for (const path of tiers.flat()) {
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    ordered.push(path);
  }
  return ordered;
}

/** Text as GIT means it: no NUL byte, and decodable as UTF-8 without loss.
 *  The round-trip is the test — invalid bytes decode to U+FFFD and re-encode to
 *  something else, so an equal re-encoding is proof the bytes were valid. */
function textRejection(content: Buffer): string | null {
  if (content.includes(0)) return 'binary:contains_nul_byte';
  if (!Buffer.from(content.toString('utf8'), 'utf8').equals(content)) return 'binary:not_valid_utf8';
  return null;
}

export function chooseProbeFile(tracked: readonly string[], read: ProbeReader): ProbeSelection {
  const candidates = orderProbeCandidates(tracked);
  const rejected: ProbeRejection[] = [];
  let examined = 0;
  for (const path of candidates) {
    if (examined >= PROBE_CANDIDATE_LIMIT) break;
    examined += 1;
    let content: Buffer;
    try {
      content = read(path);
    } catch (error) {
      // The path is never quoted back with its content, only its name and the
      // errno — a workspace path is safe to print, its bytes are not this
      // module's business.
      const code = (error as NodeJS.ErrnoException | null)?.code;
      rejected.push({ path, reason: `unreadable:${typeof code === 'string' ? code : 'unknown'}` });
      continue;
    }
    if (content.length > PROBE_MAX_BYTES) {
      rejected.push({ path, reason: `too_large:${content.length}` });
      continue;
    }
    const notText = textRejection(content);
    if (notText !== null) {
      rejected.push({ path, reason: notText });
      continue;
    }
    return { ok: true, path, content, examined };
  }
  return { ok: false, examined, tracked: candidates.length, rejected };
}

/** The paths `git ls-files` printed, one per line. Quoting is disabled by the
 *  caller (`-c core.quotePath=false`), so a path arrives as its own bytes; a
 *  path containing a newline would split and simply fail to read, which the
 *  chooser reports as a rejection rather than mistaking for a real file. */
export function parseTrackedPaths(stdout: string): readonly string[] {
  return stdout.split('\n').map((line) => line.replace(/\r$/, '').trim()).filter((line) => line.length > 0);
}

/* ------------------------------------------------------------------ the seam
 *
 * The chooser above is pure and the preflight below is a script with a
 * database, an executor client and four credentials, so the code JOINING them
 * is the one part neither a unit test nor a build reaches. That join is what
 * broke: the old preflight's entire probe-file logic was `join(workspace,
 * 'README.md')`, fifteen untested characters between two well-tested things.
 *
 * So the join is a function too, with the sandbox injected. The preflight
 * passes its real `runInSandbox`; a test passes one that shells to real git in
 * a real provisioned mission workspace. Neither needs the other's world. */

/** Just enough of the executor's `ToolInvocationResult` to read an answer. */
export type SandboxRun = (command: string) => Promise<{
  readonly status: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}>;

/** Asked of the SANDBOX's git, not the host's: it is the view that will capture
 *  the mission's diff, so it is the view that must agree the file is tracked. */
export const PROBE_LIST_COMMAND = 'git -c core.quotePath=false ls-files';

export type ProbeResolution =
  | { readonly ok: true; readonly path: string; readonly content: Buffer; readonly tracked: number; readonly examined: number }
  | { readonly ok: false; readonly failure: 'list_failed'; readonly stderr: string }
  | { readonly ok: false; readonly failure: 'no_candidate'; readonly tracked: number; readonly examined: number; readonly rejected: readonly ProbeRejection[] };

export async function resolveProbeFile(run: SandboxRun, read: ProbeReader): Promise<ProbeResolution> {
  const listed = await run(PROBE_LIST_COMMAND);
  if (listed.status !== 'SUCCEEDED' || listed.exitCode !== 0) {
    return { ok: false, failure: 'list_failed', stderr: listed.stderr };
  }
  const tracked = parseTrackedPaths(listed.stdout);
  const chosen = chooseProbeFile(tracked, read);
  return chosen.ok
    ? { ok: true, path: chosen.path, content: chosen.content, tracked: tracked.length, examined: chosen.examined }
    : { ok: false, failure: 'no_candidate', tracked: chosen.tracked, examined: chosen.examined, rejected: chosen.rejected };
}
