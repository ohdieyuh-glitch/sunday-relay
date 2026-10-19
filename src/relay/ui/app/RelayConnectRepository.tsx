import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  beginRepositoryInstall, registerRepository, readInstallationFromReturn, loadBridgeSession,
} from './bridge-session';
import { discoverInstallationRepositories, type DiscoveredRepository } from './repository-client';

/**
 * CONNECT A GITHUB REPOSITORY — criterion 2, without founder CLI intervention.
 *
 * A signed-in participant installs the Relay GitHub App on the repository they
 * want (the bridge records that they control that installation) and returns here
 * with the installation id. Relay then DISCOVERS the repositories that
 * installation authorizes and offers them to SELECT — no owner/name typed by
 * hand — and binds the registration to their identity from the session, minting
 * short-lived, repo-scoped credentials from the installation. Never a founder
 * token, never a token in this tree.
 *
 * It announces facts, not intentions: the picker offers only what the bridge
 * says the installation reaches, an installation that authorizes nothing yet is
 * stated as exactly that (never an empty error), a discovery refusal is shown in
 * the bridge's own words, and the connected key appears only after the bridge
 * confirms the registration. Manual entry remains as a deliberate secondary
 * fallback. The network calls are injected so the real component runs against a
 * fake.
 */
export function RelayConnectRepository({
  bridgeUrl,
  installBeginImpl = beginRepositoryInstall,
  registerImpl = registerRepository,
  readInstallationImpl = readInstallationFromReturn,
  discoverImpl = discoverInstallationRepositories,
  onConnected,
}: {
  readonly bridgeUrl?: string | null;
  readonly installBeginImpl?: typeof beginRepositoryInstall;
  readonly registerImpl?: typeof registerRepository;
  readonly readInstallationImpl?: typeof readInstallationFromReturn;
  readonly discoverImpl?: typeof discoverInstallationRepositories;
  /** Called with the canonical key once the bridge confirms the registration. */
  readonly onConnected?: (repositoryKey: string) => void;
}) {
  const [installationId] = useState<string | null>(() => readInstallationImpl({}));
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [connectedKey, setConnectedKey] = useState<string | null>(null);
  // Discovery of the repositories this installation authorizes. `loading` is a
  // truthful pending state; a refusal or failure carries its reason and never
  // reads as "no repositories".
  const [discovery, setDiscovery] = useState<{
    readonly status: 'loading' | 'ready';
    readonly repositories: readonly DiscoveredRepository[];
    readonly truncated: boolean;
    readonly message: string | null;
  }>({ status: 'loading', repositories: [], truncated: false, message: null });
  // The deliberate secondary fallback: name a repository by hand. Reached from
  // the picker on demand; the empty/failed state offers the same form inline.
  const [manual, setManual] = useState(false);

  const onInstall = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const result = await installBeginImpl({ bridgeUrl });
    // On success the browser navigates to GitHub; nothing to restore here.
    if (!result.ok) {
      setBusy(false);
      setMessage(result.message);
    }
  }, [installBeginImpl, bridgeUrl]);

  // Once the app is installed (installation id in hand), ask the bridge which
  // repositories it authorizes so the participant selects one.
  useEffect(() => {
    if (installationId === null) return undefined;
    let cancelled = false;
    setDiscovery({ status: 'loading', repositories: [], truncated: false, message: null });
    void (async () => {
      const result = await discoverImpl({ installationId, bridgeUrl });
      if (cancelled) return;
      setDiscovery({
        status: 'ready',
        repositories: result.ok ? result.repositories : [],
        truncated: result.ok ? result.truncated : false,
        message: result.ok ? null : result.message,
      });
    })();
    return () => { cancelled = true; };
  }, [installationId, discoverImpl, bridgeUrl]);

  // Register a chosen repository — the SAME draft whether it came from the
  // picker (default branch from the selection) or from manual entry.
  const connect = useCallback(async (selection: { owner: string; name: string; defaultBranch: string }) => {
    if (installationId === null) return;
    const o = selection.owner.trim();
    const n = selection.name.trim();
    if (o === '' || n === '') return;
    setBusy(true);
    setMessage(null);
    const who = loadBridgeSession()?.participantId ?? 'participant';
    const at = new Date().toISOString();
    const draft = {
      identity: { provider: 'github', host: 'github.com', owner: o, name: n, defaultBranch: selection.defaultBranch },
      location: { kind: 'remote_clone', cloneUrl: `https://github.com/${o}/${n}.git` },
      scope: { read: ['**'], write: ['src/**'] },
      grants: ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr'].map((permission) => ({
        permission, authorizedBy: who, authorizedAt: at, expiresAt: null, note: null,
      })),
      ceilings: { maxFilesChanged: 50, maxLinesRemoved: 2000, allowDeletions: false },
      registeredBy: who, // the bridge overrides this to the verified participant
      credential: { installationId },
    };
    const result = await registerImpl({ draft, bridgeUrl });
    setBusy(false);
    if (result.ok) {
      setConnectedKey(result.key);
      if (result.key !== null) onConnected?.(result.key);
    } else {
      setMessage(result.message);
    }
  }, [installationId, registerImpl, bridgeUrl, onConnected]);

  const onRegisterManually = useCallback((event: FormEvent) => {
    event.preventDefault();
    void connect({ owner, name, defaultBranch: 'main' });
  }, [connect, owner, name]);

  // The manual-entry form, shared by the on-demand fallback and the empty state.
  const manualForm = (
    <form className="relay-connect-repo__manual" onSubmit={onRegisterManually}>
      <input aria-label="Repository owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" />
      <input aria-label="Repository name" value={name} onChange={(e) => setName(e.target.value)} placeholder="repository" />
      <button type="submit" className="relay-connect-repo__connect" disabled={busy || owner.trim() === '' || name.trim() === ''}>
        {busy ? 'Connecting…' : 'Connect this repository'}
      </button>
      {message !== null && <p className="relay-connect-repo__error" role="alert">{message}</p>}
    </form>
  );

  if (connectedKey !== null) {
    return (
      <div className="relay-connect-repo" data-state="connected">
        <p>Connected <code className="relay-connect-repo__key">{connectedKey}</code>. You can start a Mission on it.</p>
      </div>
    );
  }

  if (installationId === null) {
    return (
      <div className="relay-connect-repo" data-state="install">
        <p>Connect a GitHub repository by installing the Relay app on it.</p>
        <button type="button" className="relay-connect-repo__install" onClick={() => void onInstall()} disabled={busy}>
          {busy ? 'Redirecting to GitHub…' : 'Install the Relay app on GitHub'}
        </button>
        {message !== null && <p className="relay-connect-repo__error" role="alert">{message}</p>}
      </div>
    );
  }

  // The deliberate secondary fallback, reached from the picker.
  if (manual) {
    return (
      <div className="relay-connect-repo" data-state="manual">
        <p>Name the repository to connect.</p>
        {manualForm}
        <button type="button" className="relay-connect-repo__back" onClick={() => setManual(false)}>
          Back to the discovered repositories
        </button>
      </div>
    );
  }

  if (discovery.status === 'loading') {
    return (
      <div className="relay-connect-repo" data-state="discovering">
        <p>The app is installed. Finding the repositories it authorizes…</p>
      </div>
    );
  }

  // No repositories to offer — either the installation authorizes none yet, or
  // discovery refused. Both are stated honestly, with the manual form inline as
  // the way forward. An empty installation is NEVER an error.
  if (discovery.repositories.length === 0) {
    return (
      <div className="relay-connect-repo" data-state="no-repositories">
        {discovery.message !== null ? (
          <p className="relay-connect-repo__error" role="alert">{discovery.message}</p>
        ) : (
          <p>
            The Relay app is installed but authorizes no repositories yet. Name a repository to
            connect, or adjust the app’s repository access on GitHub.
          </p>
        )}
        {manualForm}
      </div>
    );
  }

  // The primary post-install path: SELECT from the authorized repositories.
  return (
    <div className="relay-connect-repo" data-state="select-repo">
      <p>The app is installed. Choose a repository to connect.</p>
      <ul className="relay-connect-repo__repos" aria-label="Authorized repositories">
        {discovery.repositories.map((repo) => (
          <li key={repo.fullName} className="relay-connect-repo__repo">
            <button
              type="button"
              className="relay-connect-repo__repo-select"
              disabled={busy}
              onClick={() => void connect({ owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch })}
            >
              {repo.owner}/{repo.name}
            </button>
            <span className="relay-connect-repo__repo-branch">
              {' '}default branch <code>{repo.defaultBranch}</code>
            </span>
            <span className="relay-connect-repo__repo-posture">
              {' '}· {repo.private ? 'Private' : 'Public'}
            </span>
          </li>
        ))}
      </ul>
      {discovery.truncated && (
        <p className="relay-connect-repo__truncated" role="status">
          Showing the repositories Relay could read. Some may be hidden — adjust the app’s access on GitHub to see more.
        </p>
      )}
      <button type="button" className="relay-connect-repo__manual-toggle" onClick={() => setManual(true)}>
        Enter a repository manually
      </button>
      {message !== null && <p className="relay-connect-repo__error" role="alert">{message}</p>}
    </div>
  );
}
