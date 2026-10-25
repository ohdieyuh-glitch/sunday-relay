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

export interface FrozenCheckerRun { readonly exitCode: number | null; readonly stdout: string; readonly stderr?: string }

/** The only environment variable names a checker child may see. No provider key, token or HOME. */
export const CHECKER_ENV_ALLOW_LIST: readonly string[] = Object.freeze(['PATH', 'SystemRoot', 'TEMP']);

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
  /** Copies the named bytes into a FRESH private directory (restrictive permissions where supported); returns the staged paths in order. */
  readonly stage: (files: readonly { readonly name: string; readonly bytes: Uint8Array }[]) => Promise<{ readonly paths: readonly string[]; readonly cleanup: () => Promise<void> }>;
  /** Reads a staged file back (to re-hash after the run). */
  readonly readStagedBytes: (path: string) => Promise<Uint8Array>;
  /** Absolute, symlink-resolved path (the checker only runs its main block when argv[1] matches import.meta.url). */
  readonly realpath: (path: string) => Promise<string>;
  /** The environment to filter; only CHECKER_ENV_ALLOW_LIST names are passed to the child. */
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  /** Writes the artifact text (UTF-8) to a fresh temp file and returns its path and a cleanup. */
  readonly writeArtifact: (text: string) => Promise<{ readonly path: string; readonly cleanup: () => Promise<void> }>;
  readonly run: (command: string, args: readonly string[], env: Readonly<Record<string, string>>) => Promise<FrozenCheckerRun>;
  /**
   * Extra files staged into the SAME directory as the checker, pin-checked and re-hashed, and NOT placed on argv.
   * The checker may import them by their `name` (for example `oracle.mjs` beside `checker.mjs`).
   */
  readonly companions?: readonly { readonly name: string; readonly path: string; readonly sha256: string }[];
  /** Receives the exit code and the full stdout of every run, for the run bundle. */
  readonly record?: (entry: { readonly runId: string; readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }) => void;
}

const sha256Hex = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;
const COMPANION_NAME = /^[A-Za-z0-9._-]+$/;
const RESERVED_STAGE_NAMES = new Set(['checker.mjs', 'ledger.csv', 'posts.json']);

export function createFrozenReviewerChecker(input: FrozenReviewerCheckerInput): HiddenChecker {
  for (const [name, value] of [['checkerSha256', input.checkerSha256], ['ledgerSha256', input.ledgerSha256], ['postsSha256', input.postsSha256]] as const) {
    if (!HEX64.test(value)) throw new Error(`frozen_checker_${name}_invalid`);
  }
  const companions = input.companions ?? [];
  const seenNames = new Set<string>();
  for (const companion of companions) {
    if (!COMPANION_NAME.test(companion.name) || companion.name === '.' || companion.name === '..' || RESERVED_STAGE_NAMES.has(companion.name) || seenNames.has(companion.name)) {
      throw new Error('frozen_checker_companion_name_invalid');
    }
    seenNames.add(companion.name);
    if (!HEX64.test(companion.sha256)) throw new Error('frozen_checker_companion_sha256_invalid');
  }
  return {
    async check({ runId, artifactText }) {
      const pins: readonly [string, string, string][] = [
        ['checker', input.checkerPath, input.checkerSha256],
        ['ledger', input.ledgerPath, input.ledgerSha256],
        ['posts', input.postsPath, input.postsSha256],
        ...companions.map((companion) => ['companion', companion.path, companion.sha256] as [string, string, string]),
      ];
      for (const [what, path, want] of pins) {
        let bytes: Uint8Array;
        try { bytes = await input.readFileBytes(path); } catch { return { pass: false, output: `frozen_checker_${what}_unreadable` }; }
        if (sha256Hex(bytes) !== want) return { pass: false, output: `frozen_checker_${what}_pin_mismatch` };
      }
      const judged = sha256Hex(artifactText.trim());
      const bytesOf: Uint8Array[] = [];
      for (const [, path] of pins) bytesOf.push(await input.readFileBytes(path));
      const stageNames = ['checker.mjs', 'ledger.csv', 'posts.json', ...companions.map((companion) => companion.name)];
      let stage: Awaited<ReturnType<FrozenReviewerCheckerInput['stage']>>;
      try {
        stage = await input.stage(stageNames.map((name, index) => ({ name, bytes: bytesOf[index]! })));
      } catch { return { pass: false, output: 'frozen_checker_stage_failed' }; }
      const env: Record<string, string> = {};
      for (const name of CHECKER_ENV_ALLOW_LIST) { const v = input.baseEnv[name]; if (typeof v === 'string') env[name] = v; }
      const file = await input.writeArtifact(artifactText);
      let result: FrozenCheckerRun;
      try {
        let staged: string[];
        try { staged = await Promise.all(stage.paths.map((p) => input.realpath(p))); } catch { return { pass: false, output: 'frozen_checker_realpath_failed' }; }
        if (staged.length !== pins.length) return { pass: false, output: 'frozen_checker_stage_failed' };
        try {
          result = await input.run(input.nodePath, [staged[0]!, file.path, staged[1]!, staged[2]!, '--expect-self-sha256', input.checkerSha256], env);
        } catch {
          return { pass: false, output: 'frozen_checker_run_failed' };
        }
        for (let i = 0; i < pins.length; i += 1) {
          let after: Uint8Array;
          try { after = await input.readStagedBytes(staged[i]!); } catch { return { pass: false, output: 'frozen_checker_staged_file_changed' }; }
          if (sha256Hex(after) !== pins[i]![2]) return { pass: false, output: 'frozen_checker_staged_file_changed' };
        }
      } finally {
        await file.cleanup().catch(() => undefined);
        await stage.cleanup().catch(() => undefined);
      }
      const stderr = result.stderr ?? '';
      input.record?.({ runId, exitCode: result.exitCode, stdout: result.stdout, stderr });
      const lines = result.stdout.split(/\r?\n/).filter((l) => l !== '');
      const field = (key: string): string | null => {
        const line = lines.find((l) => l.startsWith(`${key}=`));
        return line === undefined ? null : line.slice(key.length + 1);
      };
      const pass = result.exitCode === 0
        && lines[lines.length - 1] === 'PASS'
        && field('checker_sha256') === input.checkerSha256
        && field('judged_trimmed_sha256') === judged;
      return { pass, output: `exit=${String(result.exitCode)}\n${result.stdout}${stderr === '' ? '' : `\nSTDERR:\n${stderr}`}` };
    },
  };
}
