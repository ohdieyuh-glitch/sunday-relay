/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { RelayPreviewApp } from './RelayPreviewApp';
import { getRelayAppStore } from '../app';
import { RelayAgentOperatingInspector } from '../project-workspace/RelayAgentOperatingInspector';
import {
  ARCHITECT_BRIDGE_REQUIRED_LABEL, projectAgentOperatingProfiles, projectPromptArchitect,
} from '../../mission';
import { operatingProfileFixture } from '../../mission/agent-operating/operating-profile-fixtures';

/** The Prompt Architect on the WEBSITE: honest without a bridge, and never
    shipping the OpenAI SDK or a credential to the browser. */

beforeEach(() => {
  window.localStorage.clear();
  getRelayAppStore().resetAll();
  window.location.hash = '#/relay/project/rly-001';
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const architectProfile = () =>
  projectAgentOperatingProfiles([operatingProfileFixture('prompt_architect')])[0];

describe('the Prompt Architect runtime line', () => {
  it('says Relay Bridge required and claims no model', () => {
    render(createElement(RelayAgentOperatingInspector, {
      projection: architectProfile(),
      architect: projectPromptArchitect(null, { bridgeAvailable: false }),
    }));
    expect(screen.getByText('GPT (OpenAI) · Relay Bridge required')).toBeTruthy();
    expect(document.body.textContent).toContain(ARCHITECT_BRIDGE_REQUIRED_LABEL);
    expect(document.body.textContent).toContain('Requested Unknown');
    expect(document.body.textContent).toContain('Actual Unknown');
    // Cost is Unknown by contract, never a dollar figure.
    expect(document.body.textContent).toContain('Cost Unknown');
    expect(document.body.textContent).not.toContain('$');
  });

  it('omits the line when the surface knows nothing, and keeps four rows', () => {
    const { container } = render(createElement(RelayAgentOperatingInspector, {
      projection: architectProfile(),
    }));
    expect(container.querySelectorAll('.rpw-operating-runtime')).toHaveLength(0);
    expect(container.querySelectorAll('.rpw-operating-row')).toHaveLength(4);
  });
});

describe('offline production stays honest', () => {
  it('never calls OpenAI, never claims a connection, and ships no key', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('OPENAI_API_KEY');
    expect(page).not.toContain('sk-');
    expect(page).not.toContain('GPT (OpenAI) · Planning');
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30_000);

  it('existing features remain intact', async () => {
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByRole('button', { name: /^Usage — / })[0].textContent)
      .toBe('USAGE · UNAVAILABLE');
    const dogLine = screen.getAllByRole('status').find((n) => n.textContent?.includes('Relay Dog'));
    expect(dogLine?.textContent).toContain('Relay Dog');
  }, 30_000);
});
