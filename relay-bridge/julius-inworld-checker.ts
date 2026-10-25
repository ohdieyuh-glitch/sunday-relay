import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { HiddenChecker } from './julius-dispatch';
import { createFrozenReviewerChecker, type FrozenReviewerCheckerInput } from './julius-frozen-checker';

/**
 * Frozen bytes for `julius-inworld-data-1`. The pin is the hash of these files in this order, each named and then
 * hashed, and it INCLUDES `contract.json`. Acceptance re-reads the bytes on every check. This module never imports
 * the checker: the grader runs as the frozen reviewer checker's child, from the bytes just read.
 */
export const INWORLD_MISSION_ID = 'julius-inworld-data-1';
export const INWORLD_PIN_FILES = ['contract.json', 'checker/check.mjs', 'checker/oracle.mjs', 'seed/data/legacy_ledger.csv', 'seed/data/posts.json'] as const;

/** sha256 of `contract.json` alone. Re-read by the checker; this literal is what the re-read must equal. */
export const J1_PINNED_CONTRACT_SHA256 = 'bfa90f50f70916ff52180a94537f243300da8dcc51ee06d3952b0f18876226aa';
/** Combined pin of {@link INWORLD_PIN_FILES}, including `contract.json`. */
export const J1_PINNED_CHECKER_SHA256 = '0ca020dbfd2f971a8c112444961aa57ea0d113b0c1d86336f420fcae126eafd3';
/** sha256 of `checker/check.mjs` alone. The frozen reviewer child checks this, not the combined pin. */
export const J1_PINNED_CHECKER_FILE_SHA256 = '1a98f1a4d739ebe2da254715d81f56cd5fa08d534a1fbf10ef6214e8b262207e';
/** sha256 of `checker/oracle.mjs` alone. Staged beside the checker and pin-checked. */
export const J1_PINNED_ORACLE_SHA256 = '50328c58bd828ce2595c977cb1b1ff973481215425b8192e9d341c3e70357323';

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export function pinInworldFiles(entries: readonly (readonly [string, Uint8Array])[]): string {
  const h = createHash('sha256');
  for (const [name, bytes] of entries) h.update(`${name}\n${sha256Hex(bytes)}\n`);
  return h.digest('hex');
}

/** Re-reads every pinned file. Callers hash on read; nothing here imports the checker module. */
export function readInworldCheckerPin(missionDir: string): string {
  return pinInworldFiles(INWORLD_PIN_FILES.map((name) => [name, readFileSync(join(missionDir, name))] as const));
}

export interface InworldFrozenCheckerIo {
  readonly nodePath: string;
  readonly readFileBytes: (path: string) => Promise<Uint8Array>;
  readonly stage: FrozenReviewerCheckerInput['stage'];
  readonly readStagedBytes: (path: string) => Promise<Uint8Array>;
  readonly realpath: (path: string) => Promise<string>;
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly writeArtifact: FrozenReviewerCheckerInput['writeArtifact'];
  readonly run: FrozenReviewerCheckerInput['run'];
  readonly record?: FrozenReviewerCheckerInput['record'];
}

/**
 * The one grader for the in-world mission: `createFrozenReviewerChecker` running `checker/check.mjs`.
 * `oracle.mjs` is staged beside it and pin-checked. The combined pin, which includes `contract.json`, is recomputed
 * from a fresh read on every check and compared to `frozen`. A mismatch does not run the child.
 */
export function createInworldFrozenChecker(
  missionDir: string,
  frozen: { readonly checkerSha256: string; readonly contractSha256: string },
  io: InworldFrozenCheckerIo,
): HiddenChecker {
  const contractPath = join(missionDir, 'contract.json');
  const checkerPath = join(missionDir, 'checker/check.mjs');
  const oraclePath = join(missionDir, 'checker/oracle.mjs');
  const ledgerPath = join(missionDir, 'seed/data/legacy_ledger.csv');
  const postsPath = join(missionDir, 'seed/data/posts.json');
  return {
    async check(req) {
      const read = async (path: string): Promise<Uint8Array | null> => {
        try { return await io.readFileBytes(path); } catch { return null; }
      };
      const contract = await read(contractPath);
      const checker = await read(checkerPath);
      const oracle = await read(oraclePath);
      const ledger = await read(ledgerPath);
      const posts = await read(postsPath);
      if (contract === null || checker === null || oracle === null || ledger === null || posts === null) {
        return { pass: false, output: 'checker_pin_mismatch' };
      }
      if (sha256Hex(contract) !== frozen.contractSha256) return { pass: false, output: 'contract_pin_mismatch' };
      const combined = pinInworldFiles([
        ['contract.json', contract],
        ['checker/check.mjs', checker],
        ['checker/oracle.mjs', oracle],
        ['seed/data/legacy_ledger.csv', ledger],
        ['seed/data/posts.json', posts],
      ]);
      if (combined !== frozen.checkerSha256) return { pass: false, output: 'checker_pin_mismatch' };
      return createFrozenReviewerChecker({
        nodePath: io.nodePath,
        checkerPath,
        checkerSha256: sha256Hex(checker),
        ledgerPath,
        ledgerSha256: sha256Hex(ledger),
        postsPath,
        postsSha256: sha256Hex(posts),
        companions: [{ name: 'oracle.mjs', path: oraclePath, sha256: sha256Hex(oracle) }],
        readFileBytes: io.readFileBytes,
        stage: io.stage,
        readStagedBytes: io.readStagedBytes,
        realpath: io.realpath,
        baseEnv: io.baseEnv,
        writeArtifact: io.writeArtifact,
        run: io.run,
        ...(io.record === undefined ? {} : { record: io.record }),
      }).check(req);
    },
  };
}
