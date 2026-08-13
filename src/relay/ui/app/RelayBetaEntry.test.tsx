/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RelayBetaEntry } from './RelayBetaEntry';
import {
  saveBridgeSession, clearBridgeSession,
  type completeGitHubSignIn, type registerRepository, type readInstallationFromReturn,
} from './bridge-session';

/**
 * THE BETA ENTRY GATE, clicked through. A fresh participant sees a sign-in
 * screen, then a connect-repository screen, and only reaches the app once the
 * bridge confirms a connected repository. And the property that keeps every
 * other screen safe: with no bridge configured the gate is transparent — the app
 * renders exactly as before.
 */

const BRIDGE = 'https://bridge.example';
const APP = <div data-testid="app">THE APP</div>;

const noComplete = (async () => ({ signedIn: false, message: null })) as typeof completeGitHubSignIn;
const withInstall = (id: string) => (() => id) as typeof readInstallationFromReturn;
const registerOk = (async () => ({ ok: true as const, key: 'github:github.com/beta-alice/their-app', message: null })) as typeof registerRepository;

afterEach(() => { cleanup(); clearBridgeSession(); });

function signedIn() {
  saveBridgeSession({ token: 't', origin: '', expiresAt: '', scope: 'browser_control', participantId: 'ghu-4242' });
}

describe('RelayBetaEntry', () => {
  it('is TRANSPARENT with no bridge configured — the app renders unchanged', () => {
    render(<RelayBetaEntry bridgeUrl={null}>{APP}</RelayBetaEntry>);
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('gates a fresh user at sign-in — the app is not shown', async () => {
    render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
    expect(await screen.findByRole('button', { name: /Sign in with GitHub/i })).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('after sign-in, asks the user to connect a repository — still not the app', async () => {
    signedIn();
    render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete} readInstallationImpl={withInstall('55550001')}>{APP}</RelayBetaEntry>);
    expect(await screen.findByRole('button', { name: /Connect this repository/i })).toBeTruthy();
    expect(screen.getByText(/Signed in as/i).textContent).toContain('ghu-4242');
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('clicks all the way through: signed in → connect a repo → the app appears', async () => {
    signedIn();
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        readInstallationImpl={withInstall('55550001')}
        registerImpl={registerOk}
      >
        {APP}
      </RelayBetaEntry>,
    );
    // The connect-repository screen.
    fireEvent.change(await screen.findByLabelText(/Repository owner/i), { target: { value: 'beta-alice' } });
    fireEvent.change(screen.getByLabelText(/Repository name/i), { target: { value: 'their-app' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect this repository/i }));
    // The bridge confirms → the gate advances to the app.
    await waitFor(() => expect(screen.getByTestId('app')).toBeTruthy());
  });
});
