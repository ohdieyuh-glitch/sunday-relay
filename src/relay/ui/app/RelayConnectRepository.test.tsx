/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RelayConnectRepository } from './RelayConnectRepository';
import {
  saveBridgeSession, clearBridgeSession,
  type registerRepository, type readInstallationFromReturn,
} from './bridge-session';

/**
 * CONNECT A REPOSITORY, the component. Two states matter: before the app is
 * installed it offers the install; after the return (installation id in hand) it
 * takes a repo name and registers it, announcing the connected key only after
 * the bridge confirms, and a refusal in the bridge's own words.
 */

const BRIDGE = 'https://bridge.example';
const noInstall = (() => null) as typeof readInstallationFromReturn;
const withInstall = (id: string) => (() => id) as typeof readInstallationFromReturn;

afterEach(() => { cleanup(); clearBridgeSession(); vi.restoreAllMocks(); });

function signedIn() {
  saveBridgeSession({ token: 't', origin: '', expiresAt: '', scope: 'browser_control', participantId: 'ghu-4242' });
}

describe('RelayConnectRepository', () => {
  it('offers the install when no installation has been authorized yet', () => {
    signedIn();
    render(<RelayConnectRepository bridgeUrl={BRIDGE} readInstallationImpl={noInstall} />);
    expect(screen.getByRole('button', { name: /Install the Relay app on GitHub/i })).toBeTruthy();
  });

  it('begins the install when the button is clicked', async () => {
    signedIn();
    const begin = vi.fn(async () => ({ ok: true as const, message: null }));
    render(<RelayConnectRepository bridgeUrl={BRIDGE} readInstallationImpl={noInstall} installBeginImpl={begin} />);
    fireEvent.click(screen.getByRole('button', { name: /Install the Relay app/i }));
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
  });

  it('after the install return, registers the named repository and shows its key', async () => {
    signedIn();
    const register = vi.fn<typeof registerRepository>(async (input) => {
      // The draft binds the installation and names the repo the user typed.
      const draft = input.draft as { credential: { installationId: string }; identity: { owner: string; name: string } };
      expect(draft.credential.installationId).toBe('55550001');
      expect(draft.identity.owner).toBe('beta-alice');
      expect(draft.identity.name).toBe('their-app');
      return { ok: true as const, key: 'github:github.com/beta-alice/their-app', message: null };
    });
    render(<RelayConnectRepository bridgeUrl={BRIDGE} readInstallationImpl={withInstall('55550001')} registerImpl={register} />);
    fireEvent.change(screen.getByLabelText(/Repository owner/i), { target: { value: 'beta-alice' } });
    fireEvent.change(screen.getByLabelText(/Repository name/i), { target: { value: 'their-app' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect this repository/i }));
    await waitFor(() => expect(screen.getByText(/Connected/i).textContent).toContain('github:github.com/beta-alice/their-app'));
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('states the bridge’s refusal in its own words', async () => {
    signedIn();
    const register = vi.fn<typeof registerRepository>(async () => ({
      ok: false as const, key: null, message: 'You have not authorized that GitHub App installation.',
    }));
    render(<RelayConnectRepository bridgeUrl={BRIDGE} readInstallationImpl={withInstall('55550001')} registerImpl={register} />);
    fireEvent.change(screen.getByLabelText(/Repository owner/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/Repository name/i), { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect this repository/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/not authorized that GitHub App installation/i);
  });
});
