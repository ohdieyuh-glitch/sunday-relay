import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  DOG_STAGE_MANIFEST_PATH,
  buildDogStageManifest,
  renderDogStageManifest,
} from '../../../../scripts/export-dog-stage-manifest.mjs';
import * as stageModule from './wonderland-dog-stage';

/**
 * THE MANIFEST IS THE AGREEMENT BETWEEN TWO RUNTIMES.
 *
 * The Unreal world cannot import the TypeScript stage table — it is a separate
 * runtime with no path to this module — so the world derives the same contract
 * from its own beat fold. Two independent derivations of one specification is
 * fine until they drift, and then the Relay UI and the world disagree about
 * what the Dog is doing with neither side obviously wrong.
 *
 * `wonderland/Wonderland.DogStages.json` is the serialized form both sides can
 * check themselves against. This test fails when it is stale, which is the same
 * device `scripts/export-julius-harness.test.ts` uses to stop a generated
 * manifest from quietly falling behind the thing it describes.
 */
describe('the Dog stage manifest is the shared, serialized contract', () => {
  it('is committed', () => {
    expect(
      existsSync(DOG_STAGE_MANIFEST_PATH),
      'run `node scripts/export-dog-stage-manifest.mjs`',
    ).toBe(true);
  });

  it('is not stale', () => {
    const expected = renderDogStageManifest(buildDogStageManifest(stageModule));
    const actual = readFileSync(DOG_STAGE_MANIFEST_PATH, 'utf8');
    expect(
      actual,
      'the stage table changed without regenerating the manifest — run `node scripts/export-dog-stage-manifest.mjs`',
    ).toBe(expected);
  });

  it('carries every stage, and marks handoff as inheriting', () => {
    const manifest = buildDogStageManifest(stageModule);
    expect(manifest.stages).toHaveLength(stageModule.WONDERLAND_MISSION_STAGES.length);
    const handoff = manifest.stages.find((row) => row.stage === 'handoff');
    expect(handoff?.presentation).toBe('inherit');
  });

  it('carries the four locked stages with their props and emission', () => {
    const manifest = buildDogStageManifest(stageModule);
    const by = (stage: string) => manifest.stages.find((row) => row.stage === stage);

    expect(by('mission_start')).toMatchObject({ locomotion: 'floating', prop: 'none' });
    expect(by('planning')).toMatchObject({ prop: 'book', locomotion: 'orbit_contract' });
    expect(by('implementing')).toMatchObject({ prop: 'paintbrush' });
    expect(by('verifying')).toMatchObject({
      emission: 'verification_beam',
      locomotion: 'planted_facing_contract',
    });
  });
});
