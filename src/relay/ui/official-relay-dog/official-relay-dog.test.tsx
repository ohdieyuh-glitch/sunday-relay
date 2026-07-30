/** @vitest-environment jsdom */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { RelayPixelDog } from '../pixel-dog';
import { DOG_PRESENTATION } from '../project-workspace/projections';
import type { WorkspaceDogState } from '../project-workspace/contracts';
import type { HomeDogState } from '../entry-home/contracts';
import { projectHomeDogBehavior, projectWorkspaceDogBehavior } from '../relay-dog-motion';
import {
  OFFICIAL_RELAY_DOG_HEIGHT,
  OFFICIAL_RELAY_DOG_PALETTE,
  OFFICIAL_RELAY_DOG_POSES,
  OFFICIAL_RELAY_DOG_POSE_NAMES,
  OFFICIAL_RELAY_DOG_WIDTH,
} from '../../shared/official-relay-dog-sprite';
import {
  OFFICIAL_HOME_DOG_STATES,
  OFFICIAL_HOME_STATE_ACTIVITY,
  OFFICIAL_RELAY_DOG_STATE_PRESENTATION,
  OFFICIAL_WORKSPACE_DOG_STATES,
  officialRelayDogBehavior,
  officialRelayDogViewForState,
  projectOfficialRelayDogActivity,
} from '../../shared/official-relay-dog-states';
import { RETIRED_SIDE_PROFILE_DOG_MARKERS } from '../../shared/official-relay-dog-parity';
import {
  OFFICIAL_RELAY_DOG_POSES as BARREL_POSES,
  RETIRED_SIDE_PROFILE_DOG_MARKERS as BARREL_MARKERS,
} from '.';

/**
 * OFFICIAL RELAY DOG — website parity suite.
 *
 * The website's RelayPixelDog is the canonical RENDERER and Milestone 4.5 is
 * the canonical MOTION SYSTEM. This suite proves the shared modules the CLI
 * also imports still describe exactly what the website draws and means. If
 * either side moves without the other, this fails.
 */

const barrelDir = join(process.cwd(), 'src', 'relay', 'ui', 'official-relay-dog');

afterEach(cleanup);

/** Read back the pixels the component actually drew, as a sprite grid. */
function renderedGrid(pose: (typeof OFFICIAL_RELAY_DOG_POSE_NAMES)[number]): string[] {
  const { container } = render(<RelayPixelDog pose={pose} label="TEST" unit={1} />);
  const svg = container.querySelector('svg.rpd-art');
  expect(svg, 'the pixel dog rendered no art').not.toBeNull();

  const byHex = new Map<string, string>();
  for (const [ch, hex] of Object.entries(OFFICIAL_RELAY_DOG_PALETTE)) byHex.set(hex, ch);

  const grid: string[][] = Array.from({ length: OFFICIAL_RELAY_DOG_HEIGHT }, () =>
    Array.from({ length: OFFICIAL_RELAY_DOG_WIDTH }, () => '.'),
  );
  for (const rect of Array.from(svg!.querySelectorAll('rect'))) {
    const x = Number(rect.getAttribute('x'));
    const y = Number(rect.getAttribute('y'));
    const fill = (rect.getAttribute('fill') ?? '').toLowerCase();
    const ch = byHex.get(fill);
    expect(ch, `unknown fill ${fill} — the dog painted a color outside its palette`).toBeDefined();
    grid[y][x] = ch!;
  }
  return grid.map((row) => row.join(''));
}

/* --------------------------- shared asset ----------------------------- */

describe('official Relay Dog — shared asset integrity', () => {
  /**
   * Identity used to be proved by hashing two hand-copied duplicates. It is
   * now proved by CONSTRUCTION: there is ONE copy of the sprite, the states
   * and the manifest, in src/relay/shared, and this barrel only re-exports it.
   * These assertions are what make a future re-fork into per-surface copies
   * fail immediately instead of silently reintroducing the drift risk.
   */
  it('the website barrel re-exports the SHARED modules, with no local copy', () => {
    const barrel = readFileSync(join(barrelDir, 'index.ts'), 'utf8');
    for (const module of ['sprite', 'states', 'parity']) {
      expect(barrel, `the barrel must take official-relay-dog-${module} from src/relay/shared`)
        .toContain(`from '../../shared/official-relay-dog-${module}'`);
      expect(barrel, `the barrel re-forked a local official-relay-dog-${module}`)
        .not.toContain(`from './official-relay-dog-${module}'`);
      expect(
        existsSync(join(barrelDir, `official-relay-dog-${module}.ts`)),
        `a website-local copy of official-relay-dog-${module}.ts came back`,
      ).toBe(false);
    }
  });

  it('the barrel exports the very same objects the shared module defines', () => {
    // Reference identity, not deep equality: two copies could be equal, but
    // only one module can be the same object.
    expect(BARREL_POSES).toBe(OFFICIAL_RELAY_DOG_POSES);
    expect(BARREL_MARKERS).toBe(RETIRED_SIDE_PROFILE_DOG_MARKERS);
  });
});

/* ------------------------- renderer is the truth ----------------------- */

describe('official Relay Dog — the shared sprite IS what the website draws', () => {
  it('every pose matches the canonical renderer pixel for pixel', () => {
    for (const pose of OFFICIAL_RELAY_DOG_POSE_NAMES) {
      expect(renderedGrid(pose), `pose ${pose} drifted from the shared sprite`)
        .toEqual([...OFFICIAL_RELAY_DOG_POSES[pose]]);
      cleanup();
    }
  });

  it('the renderer keeps crisp edges and a uniform square pixel unit', () => {
    const { container } = render(<RelayPixelDog pose="standing" label="TEST" unit={6} />);
    const svg = container.querySelector('svg.rpd-art')!;
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    // ONE unit drives both axes — the body can never stretch.
    expect(svg.getAttribute('width')).toBe(String(OFFICIAL_RELAY_DOG_WIDTH * 6));
    expect(svg.getAttribute('height')).toBe(String(OFFICIAL_RELAY_DOG_HEIGHT * 6));
    const rect = svg.querySelector('rect')!;
    expect(rect.getAttribute('width')).toBe(rect.getAttribute('height'));
  });

  it('is the front-facing voxel dog: upright ears, visor band, amber eyes inside it', () => {
    const grid = renderedGrid('standing');
    expect(grid[0]).toContain('ww..ww');        // two upright ears
    expect(grid[3]).toContain('dddddd');        // dark charcoal visor band
    expect(grid[4]).toMatch(/d[y]{2}d[y]{2}/);  // amber eyes INSIDE the visor
    // Not the retired dog: no flat stretched side profile, no long tail block.
    expect(OFFICIAL_RELAY_DOG_WIDTH).toBe(18);
    expect(OFFICIAL_RELAY_DOG_HEIGHT).toBe(14);
  });
});

/* --------------------------- state semantics --------------------------- */

describe('official Relay Dog — semantics mirror Milestone 4.5 exactly', () => {
  it('the shared state presentation equals the website DOG_PRESENTATION', () => {
    const websiteStates = Object.keys(DOG_PRESENTATION) as WorkspaceDogState[];
    expect(new Set(websiteStates)).toEqual(new Set(OFFICIAL_WORKSPACE_DOG_STATES));
    for (const state of websiteStates) {
      const website = DOG_PRESENTATION[state];
      const shared = OFFICIAL_RELAY_DOG_STATE_PRESENTATION[state];
      expect(shared, `${state} missing from the shared identity`).toBeDefined();
      expect(shared.pose, `${state} pose`).toBe(website.pose);
      expect(shared.marker, `${state} marker`).toBe(website.marker);
      expect(shared.moving, `${state} moving`).toBe(website.moving);
      expect(shared.label, `${state} label`).toBe(website.label);
    }
  });

  it('the shared behavior equals the authoritative workspace behavior', () => {
    for (const state of OFFICIAL_WORKSPACE_DOG_STATES) {
      const authoritative = projectWorkspaceDogBehavior(state as WorkspaceDogState);
      const shared = officialRelayDogBehavior(projectOfficialRelayDogActivity(state));
      expect(shared, `${state} behavior diverged`).toEqual(authoritative);
    }
  });

  it('the shared behavior equals the authoritative home behavior', () => {
    for (const state of OFFICIAL_HOME_DOG_STATES) {
      const authoritative = projectHomeDogBehavior(state as HomeDogState);
      const shared = officialRelayDogBehavior(OFFICIAL_HOME_STATE_ACTIVITY[state]);
      expect(shared, `${state} behavior diverged`).toEqual(authoritative);
    }
  });

  it('IMPLEMENTING is the reaching pose on the website too', () => {
    const view = officialRelayDogViewForState('implementing');
    expect(view.activity).toBe('implementing');
    expect(view.pose).toBe('reaching');
    expect(view.motion).toBe('code_progression');
    expect(DOG_PRESENTATION.implementing.pose).toBe('reaching');
    // The reaching pose stands the dog up on its hind toes with both front
    // paws lifted, so it is a distinct silhouette from standing and from the
    // retained keyboard pose.
    expect(renderedGrid('reaching')).not.toEqual(renderedGrid('standing'));
    expect(renderedGrid('reaching')).not.toEqual(renderedGrid('coding'));
    // `coding` is retained as art, just not selected for this state.
    expect(renderedGrid('coding')).not.toEqual(renderedGrid('standing'));
  });

  it('idle alone patrols; waiting asks for a human; error stops', () => {
    expect(officialRelayDogViewForState('wandering').patrolEnabled).toBe(true);
    expect(officialRelayDogViewForState('wandering').motion).toBe('patrol');
    expect(officialRelayDogViewForState('trotting').patrolEnabled).toBe(false);
    expect(officialRelayDogViewForState('waiting_for_user').attentionRequired).toBe(true);
    expect(officialRelayDogViewForState('waiting_for_user').motion).toBe('attention_jump');
    expect(officialRelayDogBehavior('error').attentionRequired).toBe(true);
  });
});
