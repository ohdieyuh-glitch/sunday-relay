/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { RelayConfigureAgent, DEFAULT_BETA_CONFIG } from './RelayConfigureAgent';
import { loadConfiguredPsp, clearConfiguredPsp } from './configured-psp';

/**
 * CONFIGURE BEFORE START BUILDING. This step configures the Compound PSP Agent
 * with no session and no bridge, and its Start Building control PERSISTS the
 * edited configuration to sessionStorage BEFORE it hands off — so the Agent
 * survives the OAuth/install redirect that follows. The persist happens first
 * (AC-3); the hand-off happens second.
 */

afterEach(() => { cleanup(); vi.restoreAllMocks(); clearConfiguredPsp(); });

describe('RelayConfigureAgent', () => {
  it('names the Compound PSP Agent it configures — architect, coding, reviewer, Relay', () => {
    render(<RelayConfigureAgent onStartBuilding={() => {}} />);
    const text = screen.getByText(/Configure your Compound PSP Agent/i).parentElement?.textContent ?? '';
    expect(text).toMatch(/Prompt Architect/i);
    expect(text).toMatch(/Coding Agent/i);
    expect(text).toMatch(/independent Reviewer/i);
    expect(text).toMatch(/Relay/i);
    // A pure editor — no session, no GitHub wall appears here.
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
  });

  it('AC-3: editing then Start Building persists the EXACT edited config BEFORE onStartBuilding fires', () => {
    let configAtHandoff: unknown = 'not-yet-persisted';
    const onStartBuilding = vi.fn(() => {
      // Read the persisted value at the MOMENT of hand-off: it must already be
      // there, proving the save happened before this callback.
      configAtHandoff = loadConfiguredPsp();
    });
    render(<RelayConfigureAgent onStartBuilding={onStartBuilding} />);

    // The default seeds guided; the participant diverges it to autonomous.
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'autonomous' } });
    fireEvent.change(screen.getByLabelText('Spend ceiling (USD)'), { target: { value: '3' } });

    // Nothing is persisted until Start Building is pressed.
    expect(loadConfiguredPsp()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Start Building/i }));

    // onStartBuilding ran, and the persisted config it observed carries the edits.
    expect(onStartBuilding).toHaveBeenCalledTimes(1);
    const persisted = configAtHandoff as { mode?: string; limits?: { spendUsd?: number | null } };
    expect(persisted.mode).toBe('autonomous');
    expect(persisted.limits?.spendUsd).toBe(3);
    // And it is durably in sessionStorage after the hand-off too.
    expect((loadConfiguredPsp() as { mode?: string }).mode).toBe('autonomous');
  });

  it('with no edits, persists the default Agent so the runner still receives a real config', () => {
    const onStartBuilding = vi.fn();
    render(<RelayConfigureAgent onStartBuilding={onStartBuilding} />);
    fireEvent.click(screen.getByRole('button', { name: /Start Building/i }));
    expect(onStartBuilding).toHaveBeenCalledTimes(1);
    expect((loadConfiguredPsp() as { mode?: string }).mode).toBe(DEFAULT_BETA_CONFIG.mode);
  });

  it('rehydrates a configuration already saved this session rather than re-seeding the default', () => {
    // A prior visit configured autonomous + a $2 ceiling; coming back must show it.
    render(<RelayConfigureAgent defaultConfig={{ mode: 'guided', limits: { spendUsd: 9 } }} onStartBuilding={() => {}} />);
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'autonomous' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Building/i }));
    cleanup();

    // Fresh mount, sessionStorage retained: the editor seeds from the saved config.
    render(<RelayConfigureAgent defaultConfig={{ mode: 'guided', limits: { spendUsd: 9 } }} onStartBuilding={() => {}} />);
    expect((screen.getByLabelText('Execution mode') as HTMLSelectElement).value).toBe('autonomous');
  });
});
