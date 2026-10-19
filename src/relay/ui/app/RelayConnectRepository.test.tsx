/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RelayConnectRepository } from './RelayConnectRepository';
import {
  saveBridgeSession, clearBridgeSession,
  type registerRepository, type readInstallationFromReturn,
} from './bridge-session';
import type { discoverInstallationRepositories, DiscoveredRepository } from './repository-client';

/**
 * CONNECT A REPOSITORY, the component. Two states matter: before the app is
 * installed it offers the install; after the return (installation id in hand) it
 * DISCOVERS the repositories the installation authorizes and offers them to
 * SELECT — no owner/name typed on the primary path — announcing the connected
 * key only after the bridge confirms, and a refusal in the bridge's own words.
 * Manual entry survives as a deliberate secondary fallback.
 */

const BRIDGE = 'https://bridge.example';
const noInstall = (() => null) as typeof readInstallationFromReturn;
const withInstall = (id: string) => (() => id) as typeof readInstallationFromReturn;

const aliceRepo: DiscoveredRepository = {
  owner: 'beta-alice', name: 'their-app', fullName: 'beta-alice/their-app', defaultBranch: 'trunk', private: true,
};
const discoverOf = (...repositories: DiscoveredRepository[]) =>
  (async () => ({ ok: true as const, repositories, truncated: false, message: null })) as unknown as typeof discoverInstallationRepositories;
const discoverEmpty = (async () => ({ ok: true as const, repositories: [], truncated: false, message: null })) as unknown as typeof discoverInstallationRepositories;
const discoverFailing = (message: string) =>
  (async () => ({ ok: false as const, repositories: [], truncated: false, message })) as unknown as typeof discoverInstallationRepositories;

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

  it('after the install return, the PRIMARY path SELECTS a discovered repo — no owner/name typed', async () => {
    signedIn();
    const register = vi.fn<typeof registerRepository>(async (input) => {
      // The draft binds the installation and takes identity + default branch
      // straight from the SELECTION, not from anything typed.
      const draft = input.draft as {
        credential: { installationId: string };
        identity: { owner: string; name: string; defaultBranch: string };
        location: { cloneUrl: string };
      };
      expect(draft.credential.installationId).toBe('55550001');
      expect(draft.identity.owner).toBe('beta-alice');
      expect(draft.identity.name).toBe('their-app');
      expect(draft.identity.defaultBranch).toBe('trunk');
      expect(draft.location.cloneUrl).toBe('https://github.com/beta-alice/their-app.git');
      return { ok: true as const, key: 'github:github.com/beta-alice/their-app', message: null };
    });
    render(
      <RelayConnectRepository
        bridgeUrl={BRIDGE}
        readInstallationImpl={withInstall('55550001')}
        discoverImpl={discoverOf(aliceRepo)}
        registerImpl={register}
      />,
    );
    // The primary path lists the authorized repo with its posture — and asks for
    // no owner/name text entry at all.
    const select = await screen.findByRole('button', { name: /beta-alice\/their-app/i });
    expect(screen.queryByLabelText(/Repository owner/i)).toBeNull();
    expect(screen.queryByLabelText(/Repository name/i)).toBeNull();
    expect(screen.getByText(/default branch/i).textContent).toContain('trunk');
    expect(screen.getByText(/Private/i)).toBeTruthy();

    fireEvent.click(select);
    await waitFor(() => expect(screen.getByText(/Connected/i).textContent).toContain('github:github.com/beta-alice/their-app'));
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('states the bridge’s refusal in its own words when a selected repo fails to register', async () => {
    signedIn();
    const register = vi.fn<typeof registerRepository>(async () => ({
      ok: false as const, key: null, message: 'You have not authorized that GitHub App installation.',
    }));
    render(
      <RelayConnectRepository
        bridgeUrl={BRIDGE}
        readInstallationImpl={withInstall('55550001')}
        discoverImpl={discoverOf(aliceRepo)}
        registerImpl={register}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /beta-alice\/their-app/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/not authorized that GitHub App installation/i);
  });

  it('an installation that authorizes NO repositories is stated honestly, never an error, and offers a way forward', async () => {
    signedIn();
    const register = vi.fn<typeof registerRepository>(async () => ({
      ok: true as const, key: 'github:github.com/beta-alice/their-app', message: null,
    }));
    render(
      <RelayConnectRepository
        bridgeUrl={BRIDGE}
        readInstallationImpl={withInstall('55550001')}
        discoverImpl={discoverEmpty}
        registerImpl={register}
      />,
    );
    expect(await screen.findByText(/authorizes no repositories yet/i)).toBeTruthy();
    // No fabricated list, no error role — and the manual form is the way forward.
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Repository owner/i), { target: { value: 'beta-alice' } });
    fireEvent.change(screen.getByLabelText(/Repository name/i), { target: { value: 'their-app' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect this repository/i }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });

  it('a discovery FAILURE degrades honestly — the refusal is shown and manual entry still works', async () => {
    signedIn();
    const register = vi.fn<typeof registerRepository>(async () => ({
      ok: true as const, key: 'github:github.com/beta-alice/their-app', message: null,
    }));
    render(
      <RelayConnectRepository
        bridgeUrl={BRIDGE}
        readInstallationImpl={withInstall('55550001')}
        discoverImpl={discoverFailing('GitHub returned 502 for that installation.')}
        registerImpl={register}
      />,
    );
    // The refusal is surfaced in the bridge's own words — never a fabricated list.
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/GitHub returned 502/i);
    expect(screen.queryByRole('button', { name: /beta-alice\/their-app/i })).toBeNull();
    // And the secondary path — manual entry — is available inline.
    fireEvent.change(screen.getByLabelText(/Repository owner/i), { target: { value: 'beta-alice' } });
    fireEvent.change(screen.getByLabelText(/Repository name/i), { target: { value: 'their-app' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect this repository/i }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });

  it('offers manual entry on demand from the picker as a secondary fallback', async () => {
    signedIn();
    render(
      <RelayConnectRepository
        bridgeUrl={BRIDGE}
        readInstallationImpl={withInstall('55550001')}
        discoverImpl={discoverOf(aliceRepo)}
      />,
    );
    await screen.findByRole('button', { name: /beta-alice\/their-app/i });
    // Not shown until the participant asks for it.
    expect(screen.queryByLabelText(/Repository owner/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Enter a repository manually/i }));
    expect(await screen.findByLabelText(/Repository owner/i)).toBeTruthy();
  });
});
