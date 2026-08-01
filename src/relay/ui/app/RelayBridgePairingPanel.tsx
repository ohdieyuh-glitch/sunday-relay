import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  BRIDGE_STATE_LABEL, claimsConnection, configuredBridgeUrl, disconnectBrowser,
  loadBridgeSession, pairBrowser, type BridgeConnectionState,
} from './bridge-session';

/**
 * SUNDAY RELAY — THE BRIDGE PAIRING PANEL.
 *
 * Where the founder redeems a one-time pairing grant for a read-only browser
 * session. It is the browser's only route to a Bridge credential, and it is
 * deliberately small.
 *
 * WHAT IT NEVER DOES. It never holds the operator token — that credential does
 * not exist in this bundle. It never stores the grant secret: the secret is
 * sent once, both fields are cleared the moment the request goes out, and
 * nothing writes either value anywhere. It never puts a credential in a URL,
 * and it logs nothing.
 *
 * WHY IT LIVES HERE. It sits beside `bridge-session.ts` in the application
 * layer, not among the workspace panels. A workspace panel must never collect
 * a credential — `project-workspace.test.tsx` enforces exactly that — and this
 * is not a workspace panel: it is the application's connection dialog. Its
 * ENTRY CONTROL appears on the Reviewer panel; the form itself belongs here.
 *
 * WHAT IT REFUSES TO CLAIM. Only a session the Bridge has just accepted may
 * read as connected. A reachable Bridge is not a connection, a 200 from the
 * public health probe is not a connection, and a rejected grant is stated as a
 * rejection rather than left ambiguous.
 */
export function RelayBridgePairingPanel({
  open,
  onClose,
  returnFocusTo,
  /** Injected in tests so the real component is exercised against a fake. */
  pairImpl = pairBrowser,
  disconnectImpl = disconnectBrowser,
  bridgeUrl,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  pairImpl?: typeof pairBrowser;
  disconnectImpl?: typeof disconnectBrowser;
  bridgeUrl?: string | null;
}) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const grantIdId = useId();
  const grantSecretId = useId();

  const [grantId, setGrantId] = useState('');
  const [grantSecret, setGrantSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const resolvedBridge = bridgeUrl !== undefined ? bridgeUrl : configuredBridgeUrl();
  const [state, setState] = useState<BridgeConnectionState>(() => {
    if (resolvedBridge === null) return 'offline';
    return loadBridgeSession() !== null ? 'connected' : 'reachable_not_paired';
  });

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus?.();
    };
  }, [open, returnFocusTo]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  }, [onClose]);

  const submit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const id = grantId.trim();
    const secret = grantSecret.trim();
    if (id === '' || secret === '') {
      setMessage('Both the grant id and the grant secret are required.');
      return;
    }
    setBusy(true);
    setState('pairing');
    setMessage(null);
    // CLEARED IMMEDIATELY. The values are already captured in locals for this
    // one request; nothing keeps them, and a re-render cannot expose them.
    setGrantId('');
    setGrantSecret('');
    const result = await pairImpl({ grantId: id, grantSecret: secret, bridgeUrl: resolvedBridge });
    setState(result.state);
    setMessage(result.message);
    setBusy(false);
  }, [busy, grantId, grantSecret, pairImpl, resolvedBridge]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    const result = await disconnectImpl({ bridgeUrl: resolvedBridge });
    setState(resolvedBridge === null ? 'offline' : result.state);
    // Never says "revoked" when only the local copy was cleared.
    setMessage(result.message);
    setBusy(false);
  }, [disconnectImpl, resolvedBridge]);

  if (!open) return null;

  const connected = claimsConnection(state);

  return (
    <div className="rbp-overlay" data-relay-bridge-pairing="true">
      <section
        className="rbp-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className="rbp-head">
          <h2 className="rbp-title" id={titleId}>Relay Bridge</h2>
          <button
            type="button"
            ref={closeRef}
            className="rbp-close"
            onClick={onClose}
            aria-label="Close Relay Bridge pairing"
          >
            CLOSE
          </button>
        </header>

        {/* The truthful state, from the one canonical label map. */}
        <p className="rbp-state" data-bridge-state={state}>{BRIDGE_STATE_LABEL[state]}</p>
        {message !== null && <p className="rbp-message" role="status">{message}</p>}

        {connected ? (
          <div className="rbp-connected">
            <p className="rbp-note">
              This browser holds a read-only session. Starting, retrying or stopping a review
              stays an operator action.
            </p>
            <button type="button" className="rbp-btn" onClick={() => { void disconnect(); }} disabled={busy}>
              Disconnect
            </button>
          </div>
        ) : (
          <form className="rbp-form" onSubmit={(e) => { void submit(e); }}>
            <p className="rbp-note">
              Mint a grant with <code>relay reviewer pair-browser</code>. A grant expires after
              two minutes and can be used once.
            </p>

            <label className="rbp-label" htmlFor={grantIdId}>Grant ID</label>
            <input
              id={grantIdId}
              className="rbp-input"
              type="text"
              value={grantId}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setGrantId(e.target.value)}
            />

            <label className="rbp-label" htmlFor={grantSecretId}>Grant Secret</label>
            <input
              id={grantSecretId}
              className="rbp-input"
              /* A credential, so it is never rendered as readable text. */
              type="password"
              value={grantSecret}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setGrantSecret(e.target.value)}
            />

            <button type="submit" className="rbp-btn rbp-btn--primary" disabled={busy}>
              {busy ? 'Pairing…' : 'Pair Browser'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
