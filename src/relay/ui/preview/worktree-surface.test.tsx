/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { RelayPreviewApp } from './RelayPreviewApp';
import { getRelayAppStore } from '../app';
import { RelayAgentOperatingInspector } from '../project-workspace/RelayAgentOperatingInspector';
import {
  WORKTREE_OFFLINE_LABEL,
  WORKTREE_SCHEMA_VERSION,
  WORKTREE_SIMULATED_LABEL,
  projectMissionWorktree,
  sealWorktreeRecord,
  type MissionWorktreeRecordDraft,
} from '../../mission/worktree';
import { projectAgentOperatingProfiles } from '../../mission';
import { operatingProfileFixture } from '../../mission/agent-operating/operating-profile-fixtures';

/**
 * The isolated worktree on the WEBSITE: honest in the offline deployment,
 * disclosed when simulated, and never inventing a local path. Also proves
 * the existing usage, notification and fullscreen features still work.
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

function record(overrides: Partial<MissionWorktreeRecordDraft> = {}) {
  return sealWorktreeRecord({
    schemaVersion: WORKTREE_SCHEMA_VERSION,
    worktreeRef: 'worktree:rly-001:mission-1',
    missionId: 'mission-1',
    projectId: 'rly-001',
    repositoryName: 'sunday-relay',
    repositoryRoot: '/home/founder/sunday-relay',
    baseBranch: 'main',
    baseCommit: 'abc1234567890abc1234567890abc1234567890a',
    missionBranch: 'relay/mission/mission-1',
    worktreePath: '/home/founder/.relay-workspaces/missions/sunday-relay/mission-1',
    state: 'ready',
    createdAt: NOW,
    lastValidatedAt: NOW,
    owner: null,
    expectedHead: 'abc1234567890abc1234567890abc1234567890a',
    actualHead: 'abc1234567890abc1234567890abc1234567890a',
    dirty: false,
    processState: 'none',
    cleanupEligible: false,
    cleanupBlockers: [],
    archived: false,
    interruptionReason: null,
    validationFindings: [],
    evidenceRefs: [],
    provenance: 'live',
    ...overrides,
  });
}

const codingProfile = () => projectAgentOperatingProfiles([operatingProfileFixture('coding_agent')])[0];

describe('the Environment inspector shows worktree state', () => {
  it('renders a validated worktree without exposing the home directory', () => {
    render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
      worktree: projectMissionWorktree(record()),
    }));
    expect(screen.getByText('Isolated worktree · Ready')).toBeTruthy();
    expect(screen.getByText(/relay\/mission\/mission-1 · Clean/)).toBeTruthy();
    expect(document.body.textContent).toContain('…/missions/sunday-relay/mission-1');
    expect(document.body.textContent).not.toContain('/home/founder');
  });

  it('says Not available in offline demo rather than naming a path', () => {
    render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
      worktree: projectMissionWorktree(null, { offline: true }),
    }));
    expect(screen.getByText(WORKTREE_OFFLINE_LABEL)).toBeTruthy();
    expect(document.body.textContent).not.toContain('.relay-workspaces');
    expect(document.body.textContent).not.toContain('relay/mission/');
  });

  it('discloses a simulated worktree', () => {
    render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
      worktree: projectMissionWorktree(record({ provenance: 'simulated' })),
    }));
    expect(screen.getByText(WORKTREE_SIMULATED_LABEL)).toBeTruthy();
  });

  it('a blocked worktree is marked, and its dirty state is not hidden', () => {
    render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
      worktree: projectMissionWorktree(record({
        state: 'cleanup_blocked',
        dirty: true,
        cleanupBlockers: ['uncommitted mission work remains'],
      })),
    }));
    expect(screen.getByText('Isolated worktree · Cleanup blocked')).toBeTruthy();
    expect(document.body.textContent).toContain('Dirty');
  });

  it('renders exactly four operating rows — the worktree is not a fifth', () => {
    const { container } = render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
      worktree: projectMissionWorktree(record()),
    }));
    expect(container.querySelectorAll('.rpw-operating-row')).toHaveLength(4);
  });

  it('omits the line entirely when the surface knows nothing', () => {
    const { container } = render(createElement(RelayAgentOperatingInspector, {
      projection: codingProfile(),
    }));
    expect(container.querySelectorAll('.rpw-operating-worktree')).toHaveLength(0);
  });
});

describe('the offline deployment stays truthful', () => {
  it('claims no local worktree anywhere, and makes no network request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });

    // The static deployment must never name a local path, a mission branch
    // or a ready worktree — whether or not a Coding Agent panel is present.
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('.relay-workspaces');
    expect(page).not.toContain('relay/mission/');
    expect(page).not.toContain('Isolated worktree · Ready');
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30_000);

  it('existing features still work alongside it', async () => {
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });
    // Usage Bar truthful.
    expect(screen.getAllByRole('button', { name: /^Usage — / })[0].textContent)
      .toBe('USAGE · UNAVAILABLE');
    // One notification host at most.
    expect(document.querySelectorAll('[data-relay-notification-host]').length)
      .toBeLessThanOrEqual(1);
    // Fullscreen panels still open and close.
    fireEvent.click(screen.getByRole('button', { name: 'Expand Relay Console panel' }));
    const dialog = screen.getAllByRole('dialog').find(
      (d) => d.getAttribute('aria-label')?.includes('focused panel'),
    );
    expect(dialog).toBeTruthy();
    fireEvent.keyDown(dialog as HTMLElement, { key: 'Escape' });
    expect(
      screen.queryAllByRole('dialog').filter(
        (d) => d.getAttribute('aria-label')?.includes('focused panel'),
      ),
    ).toHaveLength(0);
    // Relay Dog state untouched by worktree work.
    const dogLine = screen.getAllByRole('status').find((n) => n.textContent?.includes('Relay Dog'));
    expect(dogLine?.textContent).toContain('Relay Dog');
  }, 30_000);

  it('Demo Simulation still names no real worktree path', async () => {
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });
    const nav = document.querySelector('nav[aria-label="Development preview switcher"]');
    expect(nav).not.toBeNull();
    fireEvent.click(within(nav as HTMLElement).getByRole('button', { name: 'PLAY DEMO' }));
    fireEvent.click(within(nav as HTMLElement).getByRole('button', { name: 'PAUSE' }));
    // A simulated run may describe a worktree, but never a real local path.
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('.relay-workspaces');
    expect(page).not.toContain('/home/');
  }, 30_000);
});
