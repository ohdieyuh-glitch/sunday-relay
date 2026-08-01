/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { RelayPreviewApp } from './RelayPreviewApp';
import { getRelayAppStore } from '../app';
import { RelayAgentOperatingInspector } from '../project-workspace/RelayAgentOperatingInspector';
import {
  idleCodingAgentRecord,
  projectAgentOperatingProfiles,
  projectCodingAgentRuntime,
  sealCodingAgentRecord,
} from '../../mission';
import { operatingProfileFixture } from '../../mission/agent-operating/operating-profile-fixtures';

/**
 * The Coding Agent runtime on the WEBSITE: honest without a Relay Bridge,
 * never claiming Claude Code is connected, and leaving every existing
 * feature intact.
 */

beforeEach(() => {
  window.localStorage.clear();
  getRelayAppStore().resetAll();
  window.location.hash = '#/relay/project/rly-001';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const NOW = '2026-08-01T12:00:00.000Z';
const codingProfile = () => projectAgentOperatingProfiles([operatingProfileFixture('coding_agent')])[0];

describe('the Coding Agent runtime line', () => {
  it('says Relay Bridge required when nothing can launch', () => {
    render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
      runtime: projectCodingAgentRuntime(null, { bridgeAvailable: false }),
    }));
    expect(screen.getByText('Claude Code · Relay Bridge required')).toBeTruthy();
    expect(document.body.textContent).toContain('Not available in offline demo');
    // No connection, no version, no model may be claimed.
    expect(document.body.textContent).toContain('Version Unknown');
    expect(document.body.textContent).toContain('Model Unknown');
    expect(document.body.textContent).not.toContain('Connected');
  });

  it('renders a verified connection only when one exists', () => {
    const record = sealCodingAgentRecord({
      ...idleCodingAgentRecord({ missionId: 'm1', projectId: 'p1', now: NOW }),
      identity: {
        ...idleCodingAgentRecord({ missionId: 'm1', projectId: 'p1', now: NOW }).identity,
        actualRuntime: 'Claude Code',
        runtimeVersion: '2.1.220',
        launchVerified: true,
        executionMode: 'live',
      },
      connectionState: 'connected',
      processState: 'running',
      provenance: 'live',
    });
    render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
      runtime: projectCodingAgentRuntime(record, { bridgeAvailable: true }),
    }));
    expect(screen.getByText('Claude Code · Connected')).toBeTruthy();
    expect(document.body.textContent).toContain('Version 2.1.220');
    // Usage the runtime never reported stays Unknown.
    expect(document.body.textContent).toContain('Usage Unknown');
  });

  it('a disconnection is never rendered as a completion', () => {
    const base = idleCodingAgentRecord({ missionId: 'm1', projectId: 'p1', now: NOW });
    const record = sealCodingAgentRecord({
      ...base,
      identity: { ...base.identity, actualRuntime: 'Claude Code', launchVerified: true },
      connectionState: 'disconnected',
      processState: 'unknown',
      disconnectionReason: 'Relay restarted and cannot confirm the process.',
    });
    render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
      runtime: projectCodingAgentRuntime(record, { bridgeAvailable: true }),
    }));
    expect(screen.getByText('Claude Code · Disconnected')).toBeTruthy();
    expect(document.body.textContent).toContain('cannot confirm');
    expect(document.body.textContent).not.toContain('recorded the evidence');
  });

  it('omits the line entirely when the surface knows nothing', () => {
    const { container } = render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
    }));
    expect(container.querySelectorAll('.rpw-operating-runtime')).toHaveLength(0);
  });

  it('still renders exactly four operating rows', () => {
    const { container } = render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
      runtime: projectCodingAgentRuntime(null, { bridgeAvailable: false }),
    }));
    expect(container.querySelectorAll('.rpw-operating-row')).toHaveLength(4);
  });
});

describe('offline production stays honest', () => {
  it('never claims Claude Code is connected and makes no request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('Claude Code · Connected');
    expect(page).not.toContain('2.1.220');
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30_000);

  it('existing features still work', async () => {
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByRole('button', { name: /^Usage — / })[0].textContent)
      .toBe('USAGE · UNAVAILABLE');
    // The workspace carries NO per-panel fullscreen control any more —
    // expanding a box is a Live Terminal affordance (founder direction).
    expect(screen.queryAllByRole('button', { name: /^Expand .+ panel$/ })).toHaveLength(0);
    expect(
      screen.queryAllByRole('dialog').filter(
        (d) => d.getAttribute('aria-label')?.includes('focused panel'),
      ),
    ).toHaveLength(0);
    const dogLine = screen.getAllByRole('status').find((n) => n.textContent?.includes('Relay Dog'));
    expect(dogLine?.textContent).toContain('Relay Dog');
  }, 30_000);
});
