import { createHash } from 'node:crypto';

import type { HiddenChecker } from './julius-dispatch';

/**
 * J1 HIDDEN CHECKER = THE REVIEWER'S FROZEN CHECKER (checker_v4.mjs), run as a child process. The developer never reads its source
 * (founder ruling 2026-10-22: no developer access to hidden expectations); this adapter knows only its CLI contract:
 *   node checker_v4.mjs <artifact.txt> <legacy_ledger.csv> <posts.json> --expect-self-sha256 <sha256 of the checker>
 *   stdout: `checker_sha256=<hex>`, `judged_trimmed_sha256=<hex>`, then `PASS`, or `FORMAT_FAIL: <class>` / `FAILED_SECTIONS: ...` then `FAIL`.
 *   exit: 0 pass, 1 fail, 2 usage, 3 self-hash refusal; anything else (or an exception) is NOT a pass.
 * A pass is counted only when ALL hold: exit 0, last stdout line exactly `PASS`, `checker_sha256` equals the pin, and
 * `judged_trimmed_sha256` equals the sha256 this adapter computes over the same trimmed UTF-8 bytes the ledger and the game use.
 * The checker alone is not authoritative; its full stdout and exit code are returned as `output` (and handed to `record`) so the run bundle keeps them.
 * The pristine seed files are passed by path and hash-pinned here: never the copies in the coder's workspace.
 * Nothing here opens a socket; the process runner, the file reader and the temp writer are injected.
 */

export interface FrozenCheckerRun { readonly exitCode: number | null; readonly stdout: string }

export interface FrozenReviewerCheckerInput {
  /** Path of node (or the command that runs ES modules). */
  readonly nodePath: string;
  readonly checkerPath: string;
  /** sha256 of the checker file: BOTH the pin this adapter verifies before running and the value passed as --expect-self-sha256. */
  readonly checkerSha256: string;
  readonly ledgerPath: string;
  readonly ledgerSha256: string;
  readonly postsPath: string;
  readonly postsSha256: string;
  readonly readFileBytes: (path: string) => Promise<Uint8Array>;
  /** Writes the artifact text (UTF-8) to a fresh temp file and returns its path and a cleanup. */
  readonly writeArtifact: (text: string) => Promise<{ readonly path: string; readonly cleanup: () => Promise<void> }>;
  readonly run: (command: string, args: readonly string[]) => Promise<FrozenCheckerRun>;
  /** Receives the exit code and the full stdout of every run, for the run bundle. */
  readonly record?: (entry: { readonly runId: string; readonly exitCode: number | null; readonly stdout: string }) => void;
}

const sha256Hex = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;

export function createFrozenReviewerChecker(input: FrozenReviewerCheckerInput): HiddenChecker {
  for (const [name, value] of [['checkerSha256', input.checkerSha256], ['ledgerSha256', input.ledgerSha256], ['postsSha256', input.postsSha256]] as const) {
    if (!HEX64.test(value)) throw new Error(`frozen_checker_${name}_invalid`);
  }
  return {
    async check({ runId, artifactText }) {
      const pins: readonly [string, string, string][] = [['checker', input.checkerPath, input.checkerSha256], ['ledger', input.ledgerPath, input.ledgerSha256], ['posts', input.postsPath, input.postsSha256]];
      for (const [what, path, want] of pins) {
        let bytes: Uint8Array;
        try { bytes = await input.readFileBytes(path); } catch { return { pass: false, output: `frozen_checker_${what}_unreadable` }; }
        if (sha256Hex(bytes) !== want) return { pass: false, output: `frozen_checker_${what}_pin_mismatch` };
      }
      const judged = sha256Hex(artifactText.trim());
      const file = await input.writeArtifact(artifactText);
      let result: FrozenCheckerRun;
      try {
        result = await input.run(input.nodePath, [input.checkerPath, file.path, input.ledgerPath, input.postsPath, '--expect-self-sha256', input.checkerSha256]);
      } catch {
        return { pass: false, output: 'frozen_checker_run_failed' };
      } finally {
        await file.cleanup().catch(() => undefined);
      }
      input.record?.({ runId, exitCode: result.exitCode, stdout: result.stdout });
      const lines = result.stdout.split(/\r?\n/).filter((l) => l !== '');
      const field = (key: string): string | null => {
        const line = lines.find((l) => l.startsWith(`${key}=`));
        return line === undefined ? null : line.slice(key.length + 1);
      };
      const pass = result.exitCode === 0
        && lines[lines.length - 1] === 'PASS'
        && field('checker_sha256') === input.checkerSha256
        && field('judged_trimmed_sha256') === judged;
      return { pass, output: `exit=${String(result.exitCode)}\n${result.stdout}` };
    },
  };
}
