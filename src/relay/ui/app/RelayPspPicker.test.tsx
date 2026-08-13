/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RelayPspPicker } from './RelayPspPicker';
import type { listPsps, loadPsp, savePsp } from './psp-client';

/**
 * CHOOSE OR CREATE A PSP, through the UI. The user picks a saved profile and the
 * loaded config flows out; picking "default" restores the default; saving under
 * a name persists the active config and re-lists. A refusal is shown in the
 * bridge's words and never invents a config.
 */

const BRIDGE = 'https://bridge.example';
const DEFAULT = { mode: 'guided', from: 'default' };

const listTwo = (() => async () => ({
  ok: true as const,
  psps: [
    { pspId: 'fast', name: 'Fast lane', updatedAt: 'x', mode: 'autonomous' },
    { pspId: 'careful', name: 'Careful', updatedAt: 'y', mode: 'guided' },
  ],
  message: null,
})) as unknown as () => typeof listPsps;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('RelayPspPicker', () => {
  it('lists saved profiles and hands the loaded config out on selection', async () => {
    const selected: Array<{ config: unknown; label: string }> = [];
    const load = vi.fn<typeof loadPsp>(async ({ pspId }) => ({
      ok: true, pspId, name: 'Careful', config: { mode: 'guided', from: pspId }, message: null,
    }));
    render(
      <RelayPspPicker
        bridgeUrl={BRIDGE}
        defaultConfig={DEFAULT}
        activeConfig={DEFAULT}
        onSelect={(config, label) => selected.push({ config, label })}
        listImpl={listTwo()}
        loadImpl={load}
      />,
    );
    // The saved profiles appear as options.
    await waitFor(() => expect(screen.getByRole('option', { name: /Careful/i })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Configuration \(PSP\)/i), { target: { value: 'careful' } });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // The loaded config — not an invented one — flows to the caller.
    expect(selected.at(-1)?.label).toBe('Careful');
    expect((selected.at(-1)?.config as { from?: string }).from).toBe('careful');
    expect(screen.getByRole('status').textContent).toMatch(/Loaded/i);
  });

  it('restores the default configuration when "default" is chosen again', async () => {
    const selected: Array<{ config: unknown; label: string }> = [];
    render(
      <RelayPspPicker
        bridgeUrl={BRIDGE}
        defaultConfig={DEFAULT}
        defaultLabel="Default beta configuration"
        activeConfig={DEFAULT}
        onSelect={(config, label) => selected.push({ config, label })}
        listImpl={listTwo()}
        loadImpl={vi.fn<typeof loadPsp>(async ({ pspId }) => ({ ok: true, pspId, name: 'Fast lane', config: { from: pspId }, message: null }))}
      />,
    );
    const select = await screen.findByLabelText(/Configuration \(PSP\)/i);
    fireEvent.change(select, { target: { value: 'fast' } });
    await waitFor(() => expect(selected.at(-1)?.label).toBe('Fast lane'));
    fireEvent.change(select, { target: { value: '' } });
    expect(selected.at(-1)?.label).toBe('Default beta configuration');
    expect((selected.at(-1)?.config as { from?: string }).from).toBe('default');
  });

  it('saves the active configuration under a slugified id, then re-lists and confirms', async () => {
    const save = vi.fn<typeof savePsp>(async ({ pspId }) => ({ ok: true, pspId, message: null }));
    const list = vi.fn<typeof listPsps>(async () => ({ ok: true, psps: [], message: null }));
    render(
      <RelayPspPicker
        bridgeUrl={BRIDGE}
        defaultConfig={DEFAULT}
        activeConfig={{ mode: 'guided', tag: 'active' }}
        onSelect={() => {}}
        listImpl={list}
        saveImpl={save}
      />,
    );
    fireEvent.change(await screen.findByLabelText(/New profile name/i), { target: { value: 'Careful & Slow!' } });
    fireEvent.click(screen.getByRole('button', { name: /Save as PSP/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // The active config is what's persisted, under a route-legal id.
    expect(save.mock.calls[0][0].pspId).toBe('careful-slow');
    expect((save.mock.calls[0][0].config as { tag?: string }).tag).toBe('active');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved/i));
    // Re-listed after the save (mount + post-save).
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('states a load refusal in the bridge’s words and does not invent a config', async () => {
    const selected: unknown[] = [];
    const load = vi.fn<typeof loadPsp>(async () => ({ ok: false, pspId: null, name: null, config: null, message: 'No such PSP.' }));
    render(
      <RelayPspPicker
        bridgeUrl={BRIDGE}
        defaultConfig={DEFAULT}
        activeConfig={DEFAULT}
        onSelect={(config) => selected.push(config)}
        listImpl={listTwo()}
        loadImpl={load}
      />,
    );
    fireEvent.change(await screen.findByLabelText(/Configuration \(PSP\)/i), { target: { value: 'fast' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('No such PSP.'));
    // No config was handed out for a load that failed.
    expect(selected).toEqual([]);
  });

  it('refuses a name with nothing usable, without calling save', async () => {
    const save = vi.fn<typeof savePsp>();
    render(
      <RelayPspPicker
        bridgeUrl={BRIDGE}
        defaultConfig={DEFAULT}
        activeConfig={DEFAULT}
        onSelect={() => {}}
        listImpl={(async () => ({ ok: true, psps: [], message: null })) as unknown as typeof listPsps}
        saveImpl={save}
      />,
    );
    fireEvent.change(await screen.findByLabelText(/New profile name/i), { target: { value: '!!!' } });
    fireEvent.click(screen.getByRole('button', { name: /Save as PSP/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/letters or numbers/i));
    expect(save).not.toHaveBeenCalled();
  });
});
