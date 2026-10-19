import { useCallback, useEffect, useState } from 'react';

import {
  beginGitHubSignIn, completeGitHubSignIn, configuredBridgeUrl, loadBridgeSession,
} from './bridge-session';

/**
 * SIGN IN WITH GITHUB — the entry a fresh beta user sees.
 *
 * This is the browser counterpart to the bridge's user-OAuth routes: no operator
 * token, no grant carried by hand. Clicking sends the browser to GitHub; the
 * bridge sends it back with a one-time claim, which {@link completeGitHubSignIn}
 * redeems for the session on load. The token never touches this component — it
 * lives in `bridge-session`, out of the render tree and out of every URL.
 *
 * It states the truth it has: offline when no bridge is configured, who the
 * browser now acts as once a session exists, and any sign-in error plainly. The
 * network calls are injected so the real component is exercised against a fake.
 */
export function RelayGitHubSignIn({
  bridgeUrl,
  beginImpl = beginGitHubSignIn,
  completeImpl = completeGitHubSignIn,
}: {
  readonly bridgeUrl?: string | null;
  readonly beginImpl?: typeof beginGitHubSignIn;
  readonly completeImpl?: typeof completeGitHubSignIn;
}) {
  const resolvedBridge = bridgeUrl !== undefined ? bridgeUrl : configuredBridgeUrl();
  const [participant, setParticipant] = useState<string | null>(() => loadBridgeSession()?.participantId ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Finish a sign-in that redirected back here carrying a claim. A load with no
  // claim is an ordinary load and does nothing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await completeImpl({ bridgeUrl: resolvedBridge });
      if (cancelled) return;
      if (result.signedIn) setParticipant(loadBridgeSession()?.participantId ?? null);
      if (result.message !== null) setMessage(result.message);
    })();
    return () => { cancelled = true; };
  }, [completeImpl, resolvedBridge]);

  const onSignIn = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const result = await beginImpl({ bridgeUrl: resolvedBridge });
    // On success the browser navigates to GitHub — there is no state to restore.
    if (!result.ok) {
      setBusy(false);
      setMessage(result.message);
    }
  }, [beginImpl, resolvedBridge]);

  if (resolvedBridge === null) {
    return (
      <div className="relay-github-signin" data-state="offline">
        <p>Sign-in is unavailable — this build has no Relay Bridge configured.</p>
      </div>
    );
  }

  if (participant !== null) {
    return (
      <div className="relay-github-signin" data-state="signed-in">
        <p>Signed in as <span className="relay-github-signin__who">{participant}</span>.</p>
      </div>
    );
  }

  return (
    <div className="relay-github-signin" data-state="signed-out">
      <button type="button" className="relay-github-signin__button" onClick={() => void onSignIn()} disabled={busy}>
        {busy ? 'Redirecting to GitHub…' : 'Sign in with GitHub'}
      </button>
      {message !== null && <p className="relay-github-signin__error" role="alert">{message}</p>}
    </div>
  );
}
