/**
 * THE PRIOR-ATTEMPT READ FOR A WONDERLAND START, through the founder's own `gh`.
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

import {
  contractMarkerNamespace,
  mainContentsArgs,
  missionContractPath,
  type PriorAttemptRead,
  type PriorAttemptReader,
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

/** The attempted-marker count the paid workflow would compute, read through `gh`. */
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
  };
}

/** The mission contract's `markerNamespace` at `main`, as the dispatch will run it, or null. */
export async function readMainMarkerNamespace(run: GhBytesRunner, repo: string, mission: string): Promise<string | null> {
  const contents = mainContentsArgs(repo, missionContractPath(mission));
  // `mainContentsArgs` is `api -H <accept> <path>`: the same read, made explicitly a GET.
  const result = await run(['api', '-X', 'GET', ...contents.slice(1)]);
  if (result.code !== 0) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
  } catch {
    return null;
  }
  return contractMarkerNamespace(text);
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

/**
 * The production `/status` reader, or undefined (then `/status` says UNKNOWN)
 * unless Start is on (`JULIUS_WONDERLAND_START=1`) and
 * `JULIUS_WONDERLAND_GITHUB_REPO` is an owner/name.
 */
export function wonderlandStatusPriorAttemptsFrom(
  env: Readonly<Record<string, string | undefined>>,
): ((missionId: string) => Promise<StatusPriorAttempted>) | undefined {
  const repo = (env.JULIUS_WONDERLAND_GITHUB_REPO ?? '').trim();
  if (env.JULIUS_WONDERLAND_START !== '1' || !REPO.test(repo)) return undefined;
  return createStatusPriorAttempts({ repo });
}

/** What `/status` shows before Start: the counted prior paid attempts, or UNKNOWN. */
export type StatusPriorAttempted = number | 'UNKNOWN';

/**
 * The `/status` reader. The client polls, so one answer per repository and
 * mission is kept for `ttlMs`; the Start itself never uses this cache, it
 * reads fresh inside the claim core. UNKNOWN is not cached.
 */
export function createStatusPriorAttempts(input: {
  readonly repo: string;
  readonly run?: GhBytesRunner;
  readonly reader?: PriorAttemptReader;
  readonly nowMs?: () => number;
  readonly ttlMs?: number;
}): (missionId: string) => Promise<StatusPriorAttempted> {
  const run = input.run ?? ghBytesRunner;
  const reader = input.reader ?? createGhPriorAttemptReader(run);
  const nowMs = input.nowMs ?? (() => Date.now());
  const ttlMs = input.ttlMs ?? 30_000;
  const cache = new Map<string, { readonly at: number; readonly value: number }>();
  return async (missionId) => {
    const key = `${input.repo}\0${missionId}`;
    const hit = cache.get(key);
    if (hit !== undefined && nowMs() - hit.at < ttlMs) return hit.value;
    const namespace = await readMainMarkerNamespace(run, input.repo, missionId);
    if (namespace === null) return 'UNKNOWN';
    const read = await reader.read({ repo: input.repo, namespace });
    if (!read.readable || !Number.isSafeInteger(read.counted) || read.counted < 0) return 'UNKNOWN';
    cache.set(key, { at: nowMs(), value: read.counted });
    return read.counted;
  };
}
