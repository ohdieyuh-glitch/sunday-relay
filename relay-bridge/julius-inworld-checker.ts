import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { FrozenMission, HiddenChecker } from './julius-dispatch';

/**
 * Production `HiddenChecker` for the frozen in-world mission `julius-inworld-data-1`: a thin wrapper over the mission's own
 * `checker/check.mjs` (pure, deterministic, no network). The checker is loaded by path at call time and is NOT part of the coder's
 * workspace. `checkerPinSha256` is the sha256 of check.mjs + oracle.mjs + the two seed data files (see `inworldCheckerPin`); the
 * wrapper refuses to run when the bytes on disk do not match the pin recorded in the frozen mission, so a checker edited after the
 * freeze cannot silently grade a run.
 */
export const INWORLD_MISSION_ID = 'julius-inworld-data-1';
const FILES = ['checker/check.mjs', 'checker/oracle.mjs', 'seed/data/legacy_ledger.csv', 'seed/data/posts.json'] as const;

export function inworldCheckerPin(missionDir: string): string {
  const h = createHash('sha256');
  for (const f of FILES) {
    const bytes = readFileSync(join(missionDir, f));
    h.update(`${f}\n${createHash('sha256').update(bytes).digest('hex')}\n`);
  }
  return h.digest('hex');
}

interface CheckModule { checkArtifact(text: string): { pass: boolean; output: string } }

export function createInworldHiddenChecker(missionDir: string, frozen: Pick<FrozenMission, 'checkerSha256'>): HiddenChecker {
  return {
    async check({ artifactText }) {
      if (inworldCheckerPin(missionDir) !== frozen.checkerSha256) return { pass: false, output: 'checker_pin_mismatch' };
      const mod = (await import(pathToFileURL(join(missionDir, 'checker/check.mjs')).href)) as CheckModule;
      const result = mod.checkArtifact(artifactText);
      return { pass: result.pass === true, output: result.output };
    },
  };
}
