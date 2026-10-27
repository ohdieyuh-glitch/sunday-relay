/**
 * THE PRIOR-ATTEMPT READ FOR A WONDERLAND START, through the founder's own `gh`.
 *
 * Two counts, because the paid workflow gates on two: its step-9 gate counts
 * unexpired `<namespace>-completed` artifacts (plus a recorded constant read
 * from main's workflow text by the claim core), and its pre-marker gate
 * counts attempted markers as below.
 *
 * The paid workflow's pre-marker gate counts `<namespace>-attempted` markers
 * with `julius-live-mission.cjs attempt-markers`, which is
 * {@link readJuliusAttemptMarkers}: every marker whose own run is not proven
 * NOT_EXECUTED counts. The bridge runs that SAME reader, with a `fetch` that
 * answers each `https://api.github.com/<path>` request by `gh api -X GET
 * <path>` and nothing else, so the bridge and the workflow reach the same
 * count before anything is claimed or dispatched.
 *
 * - Read-only: every child is `gh api -X GET`. Nothing here can dispatch.
 * - Bytes: an artifact zip comes back as the raw bytes `gh` printed (`gh`
 *   follows GitHub's redirect to the signed URL itself), so the zero-row
 *   proof reads exactly as it does in the workflow.
 * - Fail-closed: a `gh` failure is a non-ok response, which the reader turns
 *   into an unreadable proof or an unreadable listing: UNKNOWN, never zero.
 * - No credential: `gh` uses the founder's own login. The reader's token
 *   parameter gets a fixed non-secret placeholder, and the `fetch` here never
 *   forwards any header to `gh`.
 * - No pagination: the reader asks for one page of 100 and does not follow
 *   `Link`, exactly as it does in the workflow.
 *
 * The only environment read is {@link wonderlandStatusPriorAttemptsFrom}'s:
 * the Start switch and the repository, the same two the Start route reads.
 * Nothing here reads or names the rerun phrase.
 */

import { execFile } from 'node:child_process';

import { PAID_WORKFLOW_FILE } from '../src/relay/integration/wonderland-admission/admission-contract';
import {
  contractMarkerNamespace,
  mainContentsArgs,
  missionContractPath,
  priorCompletedCount,
  priorCount,
  recordedPaidAttempts,
  type PriorAttemptRead,
  type PriorAttemptReader,
  type PriorCount,
} from '../src/relay/integration/wonderland-admission/operator-claim';
import { readJuliusAttemptMarkers } from './julius/julius-prior-spend';

/** A `gh` child's result, as bytes. */
export interface GhBytesResult {
  readonly code: number;
  readonly stdout: Uint8Array;
}

/** The one process this module starts: `gh` with the argv given. Tests pass a fake. */
export type GhBytesRunner = (args: readonly string[]) => Promise<GhBytesResult>;

/** The reader insists on a usable token string; `gh` carries the real login, so this is a fixed placeholder. */
const GH_CLI_LOGIN = 'gh-cli-login';
const API_ORIGIN = 'https://api.github.com/';
export const GH_PRIOR_ATTEMPT_TIMEOUT_MS = 120_000;
const GH_MAX_BUFFER = 80 * 1024 * 1024;

/** `gh api -X GET <path>`, no shell, a timeout, raw bytes. */
export const ghBytesRunner: GhBytesRunner = (args) => new Promise((resolve) => {
  try {
    execFile('gh', [...args], {
      encoding: 'buffer',
      timeout: GH_PRIOR_ATTEMPT_TIMEOUT_MS,
      maxBuffer: GH_MAX_BUFFER,
      windowsHide: true,
    }, (error, stdout) => {
      const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1;
      resolve({ code, stdout: Buffer.isBuffer(stdout) ? new Uint8Array(stdout) : new Uint8Array() });
    });
  } catch {
    resolve({ code: 127, stdout: new Uint8Array() });
  }
});

/** The argv for one read: `gh api -X GET <path>`. A path that is not a plain API path is null. */
export function ghApiGetArgs(url: string): readonly string[] | null {
  if (!url.startsWith(API_ORIGIN)) return null;
  const path = url.slice(API_ORIGIN.length);
  if (path === '' || path.startsWith('/') || /[\s\\]|\.\.|^-/u.test(path)) return null;
  return ['api', '-X', 'GET', path];
}

/**
 * A `fetch` over `gh api -X GET`. Only GET of `https://api.github.com/...`;
 * anything else, and any `gh` failure, is a non-ok response. The body is the
 * child's raw bytes, so `json()`, `text()` and `arrayBuffer()` all work.
 */
export function ghApiFetch(run: GhBytesRunner): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const args = method === 'GET' ? ghApiGetArgs(url) : null;
    if (args === null) return new Response(null, { status: 400 });
    const result = await run(args);
    if (result.code !== 0) return new Response(null, { status: 502 });
    return new Response(new Uint8Array(result.stdout), { status: 200 });
  }) as typeof fetch;
}

/**
 * The step-9 completed-marker count, exactly as the workflow's jq counts it:
 * `[.artifacts[] | select(.expired == false)] | length`. Where that jq would
 * fail (no object, `.artifacts` not an array, an entry jq cannot index) the
 * answer is null, which is UNKNOWN. An entry counts only when its `expired`
 * is literally `false`; a `null` entry or a missing `expired` does not count,
 * as in jq.
 */
export function countUnexpiredArtifacts(body: unknown): number | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const artifacts = (body as Record<string, unknown>).artifacts;
  if (!Array.isArray(artifacts)) return null;
  let counted = 0;
  for (const entry of artifacts) {
    if (entry === null) continue;
    if (typeof entry !== 'object' || Array.isArray(entry)) return null;
    if ((entry as Record<string, unknown>).expired === false) counted += 1;
  }
  return counted;
}

/** `repos/<repo>/actions/artifacts?name=<ns>-completed&per_page=100`, the one page the workflow reads. */
export function completedMarkersUrl(repo: string, namespace: string): string {
  return `https://api.github.com/repos/${repo}/actions/artifacts?name=${namespace}-completed&per_page=100`;
}

/** The two counts the paid workflow gates on, read through `gh`. */
export function createGhPriorAttemptReader(run: GhBytesRunner = ghBytesRunner): PriorAttemptReader {
  const fetchImpl = ghApiFetch(run);
  return {
    async read({ repo, namespace }): Promise<PriorAttemptRead> {
      try {
        const markers = await readJuliusAttemptMarkers({ repository: repo, token: GH_CLI_LOGIN, namespace, fetchImpl });
        if (!markers.readable) return { readable: false };
        return { readable: true, counted: markers.proofs.filter((proof) => proof.classification !== 'NOT_EXECUTED').length };
      } catch {
        return { readable: false };
      }
    },
    async readCompleted({ repo, namespace }): Promise<PriorAttemptRead> {
      if (!REPO.test(repo) || !NAMESPACE.test(namespace)) return { readable: false };
      try {
        const response = await fetchImpl(completedMarkersUrl(repo, namespace));
        if (!response.ok) return { readable: false };
        const counted = countUnexpiredArtifacts(await response.json() as unknown);
        return counted === null ? { readable: false } : { readable: true, counted };
      } catch {
        return { readable: false };
      }
    },
  };
}

/** One file at `main`, as text, through `gh api -X GET`, or null. */
async function readMainText(run: GhBytesRunner, repo: string, path: string): Promise<string | null> {
  const contents = mainContentsArgs(repo, path);
  // `mainContentsArgs` is `api -H <accept> <path>`: the same read, made explicitly a GET.
  const result = await run(['api', '-X', 'GET', ...contents.slice(1)]);
  if (result.code !== 0) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
  } catch {
    return null;
  }
}

/** The mission contract's `markerNamespace` at `main`, as the dispatch will run it, or null. */
export async function readMainMarkerNamespace(run: GhBytesRunner, repo: string, mission: string): Promise<string | null> {
  const text = await readMainText(run, repo, missionContractPath(mission));
  return text === null ? null : contractMarkerNamespace(text);
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const NAMESPACE = /^[a-z][a-z0-9-]{2,48}$/u;

/**
 * The production `/status` reader, or undefined (then `/status` says UNKNOWN)
 * unless Start is on (`JULIUS_WONDERLAND_START=1`) and
 * `JULIUS_WONDERLAND_GITHUB_REPO` is an owner/name.
 */
export function wonderlandStatusPriorAttemptsFrom(
  env: Readonly<Record<string, string | undefined>>,
): ((missionId: string) => Promise<StatusPriorCounts>) | undefined {
  const repo = (env.JULIUS_WONDERLAND_GITHUB_REPO ?? '').trim();
  if (env.JULIUS_WONDERLAND_START !== '1' || !REPO.test(repo)) return undefined;
  return createStatusPriorAttempts({ repo });
}

/** What `/status` shows before Start: each count, or UNKNOWN. */
export interface StatusPriorCounts {
  readonly attempted: PriorCount;
  readonly completed: PriorCount;
}

/**
 * The `/status` reader: main's contract (the namespace) and workflow (the
 * recorded constant), then both counts, the same as the claim core. The
 * client polls, so an answer with both counts known is kept per repository
 * and mission for `ttlMs`; anything UNKNOWN is not cached. The Start itself
 * never uses this cache: it reads fresh inside the claim core.
 */
export function createStatusPriorAttempts(input: {
  readonly repo: string;
  readonly run?: GhBytesRunner;
  readonly reader?: PriorAttemptReader;
  readonly nowMs?: () => number;
  readonly ttlMs?: number;
}): (missionId: string) => Promise<StatusPriorCounts> {
  const run = input.run ?? ghBytesRunner;
  const reader = input.reader ?? createGhPriorAttemptReader(run);
  const nowMs = input.nowMs ?? (() => Date.now());
  const ttlMs = input.ttlMs ?? 30_000;
  const unknown: StatusPriorCounts = { attempted: 'UNKNOWN', completed: 'UNKNOWN' };
  const cache = new Map<string, { readonly at: number; readonly value: StatusPriorCounts }>();
  const safely = async (read: () => Promise<PriorAttemptRead>): Promise<PriorAttemptRead> => {
    try {
      const counted = priorCount(await read());
      return counted === 'UNKNOWN' ? { readable: false } : { readable: true, counted };
    } catch {
      return { readable: false };
    }
  };
  return async (missionId) => {
    const key = `${input.repo}\0${missionId}`;
    const hit = cache.get(key);
    if (hit !== undefined && nowMs() - hit.at < ttlMs) return hit.value;
    const namespace = await readMainMarkerNamespace(run, input.repo, missionId);
    if (namespace === null) return unknown;
    const workflow = await readMainText(run, input.repo, `.github/workflows/${PAID_WORKFLOW_FILE}`);
    const value: StatusPriorCounts = {
      attempted: priorCount(await safely(() => reader.read({ repo: input.repo, namespace }))),
      completed: priorCompletedCount(
        await safely(() => reader.readCompleted({ repo: input.repo, namespace })),
        workflow === null ? null : recordedPaidAttempts(workflow, namespace),
      ),
    };
    if (value.attempted !== 'UNKNOWN' && value.completed !== 'UNKNOWN') cache.set(key, { at: nowMs(), value });
    return value;
  };
}
