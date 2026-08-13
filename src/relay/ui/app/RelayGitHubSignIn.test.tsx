/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RelayGitHubSignIn } from './RelayGitHubSignIn';
import { saveBridgeSession, clearBridgeSession, type beginGitHubSignIn } from './bridge-session';

/**
 * SIGN IN WITH GITHUB, the component. It states the truth it has — offline with
 * no bridge, who the browser acts as once signed in, a sign-in error plainly —
 * and it hands the actual OAuth navigation to the injected seam. The token never
 * appears here.
 */

const BRIDGE = 'https://bridge.example';
const noop = async () => ({ signedIn: false as const, message: null });

afterEach(() => { cleanup(); clearBridgeSession(); vi.restoreAllMocks(); });

describe('RelayGitHubSignIn', () => {
  it('says sign-in is unavailable when no bridge is configured', () => {
    render(<RelayGitHubSignIn bridgeUrl={null} completeImpl={noop} />);
    expect(screen.getByText(/no Relay Bridge configured/i)).toBeTruthy();
  });

  it('offers a Sign in with GitHub button, and clicking begins the flow', async () => {
    const begin = vi.fn<typeof beginGitHubSignIn>(async () => ({ ok: true as const, message: null }));
    render(<RelayGitHubSignIn bridgeUrl={BRIDGE} beginImpl={begin} completeImpl={noop} />);
    const button = screen.getByRole('button', { name: /Sign in with GitHub/i });
    fireEvent.click(button);
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
    // begin was asked to use the configured bridge.
    expect(begin.mock.calls[0]?.[0]).toMatchObject({ bridgeUrl: BRIDGE });
  });

  it('shows who the browser acts as once a session exists', () => {
    saveBridgeSession({ token: 't', origin: '', expiresAt: '', scope: 'browser_control', participantId: 'ghu-4242' });
    render(<RelayGitHubSignIn bridgeUrl={BRIDGE} completeImpl={noop} />);
    expect(screen.getByText(/Signed in as/i).textContent).toContain('ghu-4242');
  });

  it('surfaces a used/expired sign-in link on return, without a session', async () => {
    const complete = vi.fn(async () => ({ signedIn: false as const, message: 'That sign-in link is expired or was already used. Please sign in again.' }));
    render(<RelayGitHubSignIn bridgeUrl={BRIDGE} beginImpl={vi.fn()} completeImpl={complete} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/expired or was already used/i);
    // Still signed-out: the button remains.
    expect(screen.getByRole('button', { name: /Sign in with GitHub/i })).toBeTruthy();
  });

  it('completes a sign-in that redirected back, showing the participant', async () => {
    const complete = vi.fn(async () => {
      // The real completeGitHubSignIn saves the session; the component re-reads it.
      saveBridgeSession({ token: 't', origin: '', expiresAt: '', scope: 'browser_control', participantId: 'ghu-777' });
      return { signedIn: true as const, message: null };
    });
    render(<RelayGitHubSignIn bridgeUrl={BRIDGE} completeImpl={complete} />);
    await waitFor(() => expect(screen.getByText(/Signed in as/i).textContent).toContain('ghu-777'));
  });
});
