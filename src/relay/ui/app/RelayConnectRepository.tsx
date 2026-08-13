import { useCallback, useState, type FormEvent } from 'react';

import {
  beginRepositoryInstall, registerRepository, readInstallationFromReturn, loadBridgeSession,
} from './bridge-session';

/**
 * CONNECT A GITHUB REPOSITORY — criterion 2, without founder CLI intervention.
 *
 * A signed-in participant installs the Relay GitHub App on the repository they
 * want (the bridge records that they control that installation), returns here
 * with the installation id, and names the repo. Relay binds the registration to
 * their identity from the session and mints short-lived, repo-scoped credentials
 * from the installation — never a founder token, never a token in this tree.
 *
 * It announces facts, not intentions: it shows the connected repository's key
 * only after the bridge confirms the registration, and states a refusal in the
 * domain's own words. The network calls are injected so the real component runs
 * against a fake.
 */
export function RelayConnectRepository({
  bridgeUrl,
  installBeginImpl = beginRepositoryInstall,
  registerImpl = registerRepository,
  readInstallationImpl = readInstallationFromReturn,
  onConnected,
}: {
  readonly bridgeUrl?: string | null;
  readonly installBeginImpl?: typeof beginRepositoryInstall;
  readonly registerImpl?: typeof registerRepository;
  readonly readInstallationImpl?: typeof readInstallationFromReturn;
  /** Called with the canonical key once the bridge confirms the registration. */
  readonly onConnected?: (repositoryKey: string) => void;
}) {
  const [installationId] = useState<string | null>(() => readInstallationImpl({}));
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [connectedKey, setConnectedKey] = useState<string | null>(null);

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

  const onRegister = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (installationId === null) return;
    setBusy(true);
    setMessage(null);
    const who = loadBridgeSession()?.participantId ?? 'participant';
    const at = new Date().toISOString();
    const draft = {
      identity: { provider: 'github', host: 'github.com', owner: owner.trim(), name: name.trim(), defaultBranch: 'main' },
      location: { kind: 'remote_clone', cloneUrl: `https://github.com/${owner.trim()}/${name.trim()}.git` },
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
  }, [installationId, owner, name, registerImpl, bridgeUrl, onConnected]);

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

  return (
    <form className="relay-connect-repo" data-state="register" onSubmit={(e) => void onRegister(e)}>
      <p>The app is installed. Name the repository to connect.</p>
      <input aria-label="Repository owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" />
      <input aria-label="Repository name" value={name} onChange={(e) => setName(e.target.value)} placeholder="repository" />
      <button type="submit" className="relay-connect-repo__connect" disabled={busy || owner.trim() === '' || name.trim() === ''}>
        {busy ? 'Connecting…' : 'Connect this repository'}
      </button>
      {message !== null && <p className="relay-connect-repo__error" role="alert">{message}</p>}
    </form>
  );
}
