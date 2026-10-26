/**
 * THE WONDERLAND BRIDGE'S GITHUB READS, WIRED.
 *
 * Off unless `JULIUS_WONDERLAND_GITHUB_REPO` names `owner/name`. When it is
 * set, the bridge reads that repository through the founder's own `gh` (the
 * same login the operator claim uses); the bridge holds no GitHub token.
 *
 * - The evidence reader (YUJI's) gets a `JuliusMissionGitHub`, so /result and
 *   /progress can reach completed. Its reading is cached per run: a completed
 *   reading is final and kept; anything else is read again at most every 30 s,
 *   so a client polling /result does not download a run's artifacts each time.
 * - The live events route gets the same port's run, jobs and statuses reads.
 */

import { execFile } from 'node:child_process';

import { createJuliusMissionEvidenceReader } from './julius-mission-evidence-reader';
import type { JuliusMissionEvidenceReader } from './julius-mission-evidence';
import { createGhMissionGitHub, type GhReadRunner, type JuliusRunJobsReader } from './julius-mission-github-gh';

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
/** A `gh` read that takes longer than this is unreadable, not waited on. */
export const GH_READ_TIMEOUT_MS = 60_000;
const GH_READ_MAX_BYTES = 16 * 1024 * 1024;
export const EVIDENCE_RECHECK_MS = 30_000;

export interface WonderlandLiveReads {
  readonly evidenceReader: JuliusMissionEvidenceReader;
  readonly runReader: JuliusRunJobsReader;
}

/** `gh`, with its argv as given and nothing else: no shell, a timeout, and a bounded output. */
export const ghReadRunner: GhReadRunner = {
  run(args) {
    return new Promise((resolve) => {
      execFile('gh', [...args], { timeout: GH_READ_TIMEOUT_MS, maxBuffer: GH_READ_MAX_BYTES, windowsHide: true }, (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      });
    });
  },
};

export function wonderlandLiveReadsFrom(
  env: Readonly<Record<string, string | undefined>>,
  runner: GhReadRunner = ghReadRunner,
  now: () => number = Date.now,
): WonderlandLiveReads | null {
  const repo = (env.JULIUS_WONDERLAND_GITHUB_REPO ?? '').trim();
  if (!REPO.test(repo)) return null;
  const github = createGhMissionGitHub({ repo, runner });
  // The same port twice: the evidence reader binds X′'s result record to the run's own jobs and statuses.
  return { evidenceReader: cachedEvidenceReader(createJuliusMissionEvidenceReader(github, github), now), runReader: github };
}

/** A completed reading is kept; anything else is read again after EVIDENCE_RECHECK_MS. One read at a time per run. */
export function cachedEvidenceReader(reader: JuliusMissionEvidenceReader, now: () => number = Date.now): JuliusMissionEvidenceReader {
  const cached = (source: (wljRunId: string) => Promise<unknown>) => {
    const cache = new Map<string, { readonly value: unknown; readonly at: number; readonly final: boolean }>();
    const inflight = new Map<string, Promise<unknown>>();
    return (wljRunId: string): Promise<unknown> => {
      const hit = cache.get(wljRunId);
      if (hit !== undefined && (hit.final || now() - hit.at < EVIDENCE_RECHECK_MS)) return Promise.resolve(hit.value);
      const running = inflight.get(wljRunId);
      if (running !== undefined) return running;
      const read = source(wljRunId).then((value) => {
        cache.set(wljRunId, { value, at: now(), final: value !== null && value !== undefined });
        return value;
      }, () => {
        // Unreadable: nothing read. The next read after the recheck window tries again.
        cache.set(wljRunId, { value: null, at: now(), final: false });
        return null;
      }).finally(() => inflight.delete(wljRunId));
      inflight.set(wljRunId, read);
      return read;
    };
  };
  const outcome = reader.readOutcomeUnknown;
  return {
    read: cached((wljRunId) => reader.read(wljRunId)),
    ...(outcome === undefined ? {} : { readOutcomeUnknown: cached((wljRunId) => outcome.call(reader, wljRunId)) }),
  };
}
