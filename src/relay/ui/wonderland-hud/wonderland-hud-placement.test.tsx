/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RelayWorld } from '../relay-world';

/**
 * THE USAGE HUD BELONGS TO WONDERLAND, NOT TO THE WEBSITE.
 *
 * Both meters — the green Compound Agent bar and the blue single-agent bar —
 * report what a Compound Agent is spending WHILE IT WORKS, inside the Unreal
 * world. The landing is an arrival and the Relay stage is where a founder names
 * an agent that has not done anything yet; a meter on either is furniture,
 * reporting on work that has not started, on a surface the world does not own.
 *
 * It was mounted on the Relay stage for a while, which is what this file exists
 * to prevent recurring. The contract, the frozen geometry, the usage authority
 * and the C++ mirror are all still real and are what the Unreal HUD is built
 * from — the React component survives as the reference rendering that pins the
 * geometry by digest and drives the preview harness.
 *
 * The distinction being enforced: a REFERENCE implementation may exist in the
 * repository; a PRODUCTION surface may not mount it.
 */

afterEach(() => {
  cleanup();
});

const bodyText = (): string => document.body.textContent ?? '';

describe('no web surface draws the usage HUD', () => {
  it('does not draw it on the Relay stage, where an agent is being named', () => {
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    expect(document.querySelector('.wh')).toBeNull();
    expect(bodyText()).not.toContain('NO USAGE AUTHORITY REPORTING');
    expect(bodyText()).not.toContain('COMPOUND AGENT');
  });

  it('does not draw it on the landing, which is an arrival', () => {
    render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    expect(document.querySelector('.wh')).toBeNull();
    expect(bodyText()).not.toContain('NO USAGE AUTHORITY REPORTING');
  });

  it('still renders the stage it was removed from', () => {
    // Removing an overlay must not take the screen with it.
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    expect(bodyText()).toContain('Compound Agent');
  });
});

describe('the HUD is not shipped to the browser at all', () => {
  const read = (path: string) => readFileSync(join(__dirname, '..', '..', path), 'utf8');

  it('is not imported by the browser entry point, stylesheet included', () => {
    // A stylesheet for a component nothing mounts is dead weight in the bundle
    // and an invitation to mount it again.
    const main = read('main.tsx');
    expect(main).not.toContain('wonderland-hud');
  });

  it('is not imported by any production surface', () => {
    const world = read(join('ui', 'relay-world', 'RelayWorld.tsx'));
    expect(world).not.toMatch(/^import .*wonderland-hud/m);
    expect(world).not.toContain('WonderlandUsageHudView');
    expect(world).not.toContain('useWonderlandUsage');
  });
});

describe('the reference rendering survives, because Unreal is built from it', () => {
  const read = (path: string) => readFileSync(join(__dirname, '..', '..', path), 'utf8');

  it('keeps the component and its stylesheet in the repository', () => {
    // Deleting them would take the digest freeze and the preview harness with
    // them, and the World stream would have nothing to build against.
    expect(() => read(join('ui', 'wonderland-hud', 'WonderlandUsageHudView.tsx'))).not.toThrow();
    expect(() => read(join('ui', 'wonderland-hud', 'wonderland-hud.css'))).not.toThrow();
  });

  it('keeps the preview harness pointed at it', () => {
    const preview = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'scripts', 'wonderland-hud-preview.tsx'),
      'utf8',
    );
    expect(preview).toContain('WonderlandUsageHudView');
  });
});
