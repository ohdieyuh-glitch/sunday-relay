/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';

import { RelayProjectWorkspace } from './RelayProjectWorkspace';
import { WORKSPACE_FIXTURES } from './fixtures';
import type { RelayProjectWorkspaceProps } from './contracts';

/**
 * THE STAGE AS THE WEBSITE ACTUALLY SHIPS IT.
 *
 * `stage-layout.test.ts` proves the projection. This proves the WORKSPACE, and
 * it exists because three of the stage's headline claims were true of the
 * projection and false of the website at the same time:
 *
 *   - "two selectable backdrops" — nothing rendered the picker, so the shipped
 *     value was always `resolveBackdrop(undefined)` → `none`, and no user could
 *     reach either scene;
 *   - "a narrow viewport gets a taller stage" — the workspace passed a
 *     hardcoded 1440, so the projection was never told a phone existed;
 *   - "room for a jump" — the dog's own boundary still carried the clip.
 *
 * A capability that is exported but unmounted is not shipped. The parity
 * reachability walk counts an import edge, not a render, so it cannot tell the
 * difference — these tests can.
 */

afterEach(cleanup);

const workspace = (over: Partial<RelayProjectWorkspaceProps> = {}) =>
  render(createElement(RelayProjectWorkspace, {
    ...WORKSPACE_FIXTURES.implementing,
    terminalOpen: false,
    onSendProjectMessage: vi.fn(),
    onApproveDecision: vi.fn(),
    onRejectDecision: vi.fn(),
    onOpenTerminal: vi.fn(),
    onCloseTerminal: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onOpenManualTask: vi.fn(),
    onApproveManualTask: vi.fn(),
    onRejectManualTask: vi.fn(),
    onRequestResearch: vi.fn(),
    onOpenFinding: vi.fn(),
    onOpenRepair: vi.fn(),
    onReturnHome: vi.fn(),
    ...over,
  }));

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
};

describe('the backdrop picker is MOUNTED, so the scenes are selectable', () => {
  it('renders a real radio for every scene in the catalog', () => {
    workspace();
    const radios = [...document.querySelectorAll('input[type="radio"]')]
      .map((input) => (input as HTMLInputElement).value);
    for (const id of ['none', 'jungle', 'space_station']) {
      expect(radios, `${id} must be reachable`).toContain(id);
    }
  });

  it('selecting a scene changes the scene that is drawn', () => {
    workspace();
    // Nothing selected ships as no scene — a choice, not a fallback.
    expect(document.querySelector('[data-backdrop]')).toBeNull();

    const jungle = document.querySelector('input[value="jungle"]') as HTMLInputElement;
    act(() => { jungle.click(); });
    expect(document.querySelector('[data-backdrop="jungle"]')).not.toBeNull();

    const space = document.querySelector('input[value="space_station"]') as HTMLInputElement;
    act(() => { space.click(); });
    expect(document.querySelector('[data-backdrop="space_station"]')).not.toBeNull();
    // The window onto open space is the point of that scene.
    expect(document.querySelector('.rsb-void')).not.toBeNull();
    expect(document.querySelector('.rsb-planet')).not.toBeNull();
  });

  it('tells a host that wants to store the choice, without needing one', () => {
    const onSelectStageBackdrop = vi.fn();
    workspace({ onSelectStageBackdrop });
    const jungle = document.querySelector('input[value="jungle"]') as HTMLInputElement;
    act(() => { jungle.click(); });
    expect(onSelectStageBackdrop).toHaveBeenCalledWith('jungle');
    // And the scene changed regardless of whether anyone stored it.
    expect(document.querySelector('[data-backdrop="jungle"]')).not.toBeNull();
  });

  it('a stored preference naming a scene this build lacks draws nothing', () => {
    workspace({ stageBackdrop: 'savannah' });
    expect(document.querySelector('[data-backdrop]')).toBeNull();
  });
});

describe('the workspace MEASURES the viewport rather than assuming one', () => {
  it('a phone-width window gets the taller stage', () => {
    setViewportWidth(390);
    workspace();
    const stage = document.querySelector('.rst') as HTMLElement;
    const aspect = Number.parseFloat(stage.style.aspectRatio);
    // 4:3 is the narrow shape; 16:5 (3.2) is the wide one.
    expect(aspect).toBeLessThan(2);
  });

  it('a desktop window gets the wide stage', () => {
    setViewportWidth(1440);
    workspace();
    const stage = document.querySelector('.rst') as HTMLElement;
    expect(Number.parseFloat(stage.style.aspectRatio)).toBeGreaterThan(3);
  });

  it('an explicit width still overrides the measurement', () => {
    // A non-browser host, or a test, states the width it means.
    setViewportWidth(1440);
    workspace({ viewportWidthPx: 390 });
    const stage = document.querySelector('.rst') as HTMLElement;
    expect(Number.parseFloat(stage.style.aspectRatio)).toBeLessThan(2);
  });

  it('follows a resize instead of holding the width it first saw', () => {
    setViewportWidth(1440);
    workspace();
    expect(Number.parseFloat((document.querySelector('.rst') as HTMLElement).style.aspectRatio))
      .toBeGreaterThan(3);
    act(() => {
      setViewportWidth(390);
      window.dispatchEvent(new Event('resize'));
    });
    expect(Number.parseFloat((document.querySelector('.rst') as HTMLElement).style.aspectRatio))
      .toBeLessThan(2);
  });
});

describe('the dog is on the stage, in a box it can patrol', () => {
  it('the shipped dog renders inside the actors layer', () => {
    workspace();
    const actorsLayer = document.querySelector('[data-stage-layer="actors"]');
    expect(actorsLayer?.querySelector('.rdm'), 'the dog’s motion boundary').not.toBeNull();
  });

  it('its box is the stage, not its sprite', () => {
    workspace();
    const box = document.querySelector('[data-stage-actor="relay-dog"]') as HTMLElement;
    expect(Number.parseFloat(box.style.width)).toBeGreaterThan(50);
  });

  it('the page still cannot be scrolled sideways by patrol', () => {
    // The containment moved from the actor to the page when the clip was
    // removed. It has to still exist somewhere, or patrol pushes the layout.
    workspace();
    expect(document.querySelector('.rpw-stage-bounds')).not.toBeNull();
  });
});
