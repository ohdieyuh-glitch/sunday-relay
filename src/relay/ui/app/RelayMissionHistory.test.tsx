/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RelayMissionHistory } from './RelayMissionHistory';
import type { listBetaMissions } from './beta-mission';

/**
 * YOUR MISSIONS lists the participant's own Missions, opens one on click, says so
 * when there are none (distinct from an error), and discloses that it reflects
 * only what this server currently holds.
 */

const BRIDGE = 'https://bridge.example';
afterEach(() => cleanup());

describe('RelayMissionHistory', () => {
  it('lists the missions and opens one on click', async () => {
    const opened: string[] = [];
    const list = (async () => ({
      ok: true as const,
      missions: [
        { missionId: 'm-2', objective: 'Second', state: 'verified_complete', createdAt: '2026-08-13T02:00:00Z', completedAt: '2026-08-13T02:05:00Z' },
        { missionId: 'm-1', objective: 'First', state: 'failed', createdAt: '2026-08-13T01:00:00Z', completedAt: null },
      ],
      message: null,
    })) as unknown as typeof listBetaMissions;
    render(<RelayMissionHistory bridgeUrl={BRIDGE} onOpen={(id) => opened.push(id)} listImpl={list} />);
    await waitFor(() => expect(screen.getByText('Second')).toBeTruthy());
    expect(screen.getByText('First')).toBeTruthy();
    // Discloses its in-memory scope — never implies a durable archive.
    expect(screen.getByText(/restart clears them/i)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Open/i })[0]);
    expect(opened[0]).toBe('m-2');
  });

  it('says so when there are no missions — distinct from an error', async () => {
    const empty = (async () => ({ ok: true as const, missions: [], message: null })) as unknown as typeof listBetaMissions;
    render(<RelayMissionHistory bridgeUrl={BRIDGE} onOpen={() => {}} listImpl={empty} />);
    await waitFor(() => expect(screen.getByText(/No Missions yet/i)).toBeTruthy());
  });

  it('shows a load failure in the bridge’s words, not an empty list', async () => {
    const failed = (async () => ({ ok: false as const, missions: [], message: 'Your Missions could not be read.' })) as unknown as typeof listBetaMissions;
    render(<RelayMissionHistory bridgeUrl={BRIDGE} onOpen={() => {}} listImpl={failed} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/could not be read/i));
    expect(screen.queryByText(/No Missions yet/i)).toBeNull();
  });
});
