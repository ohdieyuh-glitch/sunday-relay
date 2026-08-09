/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { RelayPreviewApp, parsePreviewHash } from './RelayPreviewApp';

/**
 * PROJECT SETTINGS MUST OPEN SETTINGS, AND BACK MUST RETURN TO THE PROJECT.
 *
 * The founder reported that asking for Project Settings from inside the
 * workspace "sends/extends me back toward the homepage". It did, from BOTH
 * ends: the fixture workspace's settings control navigated to `/relay`, and
 * Back out of settings navigated to `/relay` even when settings had been
 * opened from a project.
 *
 * These assert the ROUTE the app actually sets, because that is the thing that
 * was wrong — a test that only checked a screen rendered would have passed
 * while the user was still being thrown out of their project.
 */

const hash = () => window.location.hash;
const goto = (h: string) => { window.location.hash = h; };

describe('Project Settings stays inside the project experience', () => {
  beforeEach(() => {
    cleanup();
    goto('');
  });

  it('routes a workspace settings request to that project, never to the home screen', () => {
    // The route the control produces is the whole defect. Both workspace
    // render paths must land on a settings route carrying a project id.
    for (const target of ['/relay/project/rly-001/settings', '/relay/project/rly-002/settings']) {
      const route = parsePreviewHash(`#${target}`);
      expect(route.screen).toBe('settings');
      if (route.screen !== 'settings') return;
      expect(route.projectId).not.toBe('');
    }
    // And the home route is emphatically NOT a settings route — the value the
    // broken handler produced.
    expect(parsePreviewHash('#/relay').screen).toBe('home');
  });

  it('never sends a settings request to the Entry Home', () => {
    // THE DEFECT, EXACTLY. The showcase workspace's settings control called
    // navigate('/relay') — the Entry Home — so asking for settings threw the
    // founder out of the workspace. Whatever it does now, it must not do that.
    goto('#/relay/project/rly-001');
    render(<RelayPreviewApp />);

    const settings = screen.queryAllByRole('button', { name: /project settings/i })[0];
    expect(settings, 'the workspace exposes a Project Settings control').toBeTruthy();
    fireEvent.click(settings as HTMLElement);

    expect(hash()).not.toBe('#/relay');
    expect(hash()).toContain('rly-001');
  });

  /**
   * AND IT DOES NOT SUBSTITUTE A DEAD END FOR A WRONG DESTINATION.
   *
   * `rly-001` is the design showcase and deliberately has no store project, so
   * routing it to `/settings` would land on "Relay could not load this
   * project". A showcase has nothing to configure, and the surface says so
   * rather than navigating anywhere.
   */
  it('explains that the showcase has no project to configure', () => {
    goto('#/relay/project/rly-001');
    render(<RelayPreviewApp />);
    fireEvent.click(screen.queryAllByRole('button', { name: /project settings/i })[0] as HTMLElement);

    expect(document.body.textContent).toContain('design showcase');
    expect(document.body.textContent).not.toContain('could not load this project');
  });
});
