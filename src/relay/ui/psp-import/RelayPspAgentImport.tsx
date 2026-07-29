import { useCallback, useMemo, useRef, useState } from 'react';

import './relay-psp-import.css';

import {
  clearPspImportFlow,
  confirmPspAgentImport,
  initialPspImportState,
  submitPspAgentId,
  type PSPAgentImportPreview,
  type PSPAgentImportRecord,
  type PSPEntitlementServicePort,
  type PSPImportFlowState,
  type PSPWorkspaceContext,
} from '../../psp';

/**
 * RELAY WORKSPACE -> AGENTS -> IMPORT PSP AGENT.
 *
 * FUNCTIONAL PARITY with `relay agent import`: the same shared PSP domain
 * decides everything — format, entitlement, compatibility, confirmation and
 * every error meaning. This component owns presentation only.
 *
 * CREDENTIAL HANDLING:
 *   - the input is `type="password"` with autocomplete/spellcheck off, so the
 *     ID is masked as it is typed and never offered to a password manager or
 *     a spell checker;
 *   - the typed value lives in a REF, not in React state, so it is never part
 *     of a render tree, a devtools snapshot, or a serialized state dump;
 *   - it is written to the ref, read once for validation, and cleared as soon
 *     as the flow ends — success or failure;
 *   - it is never placed in the URL, a route parameter, localStorage,
 *     sessionStorage, a cookie, the console, or an analytics call;
 *   - the flow state itself carries only a MASKED id and a fingerprint.
 *
 * There is no production entitlement backend yet: the caller injects the
 * service port, and the default production adapter refuses every credential
 * rather than fabricating an entitlement.
 */

export interface RelayPspAgentImportProps {
  workspace: PSPWorkspaceContext;
  service: PSPEntitlementServicePort;
  /** Injected clock — the component never reads a clock itself. */
  now: () => string;
  /** Injected id factory — deterministic in tests. */
  importId: () => string;
  /** Agents already in the workspace, rendered above the import form. */
  importedAgents?: PSPAgentImportRecord[];
  onImported?: (record: PSPAgentImportRecord) => void;
}

const PHASE_LABEL: Record<string, string> = {
  empty: 'ENTER YOUR PSP AGENT ID',
  validating: 'VALIDATING',
  valid: 'REVIEW AND CONFIRM',
  confirmation_required: 'CONFIRMATION REQUIRED',
  imported: 'IMPORTED',
  invalid: 'INVALID',
  expired: 'EXPIRED',
  revoked: 'REVOKED',
  already_redeemed: 'ALREADY REDEEMED',
  transferred: 'TRANSFERRED',
  disputed: 'DISPUTED',
  incompatible: 'INCOMPATIBLE',
  service_unavailable: 'SERVICE UNAVAILABLE',
};

const FAILURE_PHASES = new Set([
  'invalid', 'expired', 'revoked', 'already_redeemed', 'transferred',
  'disputed', 'incompatible', 'service_unavailable',
]);

export function RelayPspAgentImport({
  workspace,
  service,
  now,
  importId,
  importedAgents = [],
  onImported,
}: RelayPspAgentImportProps) {
  const [state, setState] = useState<PSPImportFlowState>(() =>
    initialPspImportState(workspace.userId));
  const [validating, setValidating] = useState(false);
  const [entryLength, setEntryLength] = useState(0);

  /* The credential lives HERE and nowhere else — never in React state. */
  const credentialRef = useRef('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const clearCredential = useCallback(() => {
    credentialRef.current = '';
    setEntryLength(0);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const onSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const credential = credentialRef.current;
    setValidating(true);
    // The validating state is observable before the result replaces it.
    const next = submitPspAgentId(state, {
      credential, workspace, service, now: now(),
    });
    setValidating(false);
    setState(next);
    // A failed submission releases the credential immediately; a successful
    // one keeps it only until the user confirms or cancels.
    if (next.phase !== 'valid') clearCredential();
  }, [state, workspace, service, now, clearCredential]);

  const onConfirm = useCallback(() => {
    const credential = credentialRef.current;
    const next = confirmPspAgentImport(state, {
      credential, workspace, service, now: now(), importId: importId(), confirmed: true,
    });
    setState(next);
    clearCredential();
    if (next.phase === 'imported' && next.record && onImported) onImported(next.record);
  }, [state, workspace, service, now, importId, clearCredential, onImported]);

  const onCancel = useCallback(() => {
    clearCredential();
    setState((current) => clearPspImportFlow(current));
  }, [clearCredential]);

  const phase = validating ? 'validating' : state.phase;
  const heading = PHASE_LABEL[phase] ?? 'IMPORT PSP AGENT';
  const failed = FAILURE_PHASES.has(phase);

  const agents = useMemo(
    () => [...importedAgents, ...(state.record ? [state.record] : [])],
    [importedAgents, state.record],
  );

  return (
    <section className="rpsp" aria-label="Agents">
      <header className="rpsp-head">
        <h2 className="rpsp-title">AGENTS</h2>
        <p className="rpsp-sub">PSP compound agents available in this workspace.</p>
      </header>

      <ul className="rpsp-agents" aria-label="Workspace agents">
        {agents.length === 0 && (
          <li className="rpsp-agent rpsp-agent--empty">No PSP agents imported yet.</li>
        )}
        {agents.map((agent) => (
          <li className="rpsp-agent" key={agent.importId}>
            <span className="rpsp-agent-name">{agent.displayName}</span>
            <span className="rpsp-agent-id">{agent.pspAgentId}</span>
            <span className="rpsp-agent-roles">{agent.agentRoleSummary.join(' · ')}</span>
            <span className="rpsp-agent-source">
              {agent.source.replace(/_/g, ' ').toUpperCase()}
            </span>
          </li>
        ))}
      </ul>

      <div className="rpsp-import" data-phase={phase}>
        <h3 className="rpsp-import-title">Import PSP Agent</h3>
        <p className="rpsp-import-state" role="status" aria-live="polite">{heading}</p>

        {(phase === 'empty' || failed || phase === 'validating') && (
          <form className="rpsp-form" onSubmit={onSubmit}>
            <label className="rpsp-label" htmlFor="psp-agent-id">PSP Agent ID</label>
            <input
              id="psp-agent-id"
              ref={inputRef}
              className="rpsp-input"
              /* Masked as typed. Never a text field, never autofilled, never
                 spell-checked, and never part of the React render tree. */
              type="password"
              name="psp-agent-id"
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              placeholder="PSP-AGENT-…"
              aria-describedby="psp-agent-id-help"
              onChange={(event) => {
                credentialRef.current = event.target.value;
                setEntryLength(event.target.value.length);
              }}
            />
            <p className="rpsp-help" id="psp-agent-id-help">
              Your PSP Agent ID is a credential. It is never displayed, stored, or logged.
            </p>
            <button className="rpsp-btn rpsp-btn--primary" type="submit" disabled={entryLength === 0}>
              Validate
            </button>
          </form>
        )}

        {phase === 'validating' && <p className="rpsp-validating">Checking your PSP Agent ID…</p>}

        {failed && state.message && (
          <div className="rpsp-error" role="alert">
            <p className="rpsp-error-message">{state.message}</p>
            <p className="rpsp-error-next">{state.nextAction}</p>
            {state.maskedAgentId && (
              <p className="rpsp-error-id">
                <span className="rpsp-dim">AGENT ID</span> {state.maskedAgentId}
              </p>
            )}
          </div>
        )}

        {(phase === 'valid' || phase === 'confirmation_required') && state.preview && (
          <PspPreview
            preview={state.preview}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}

        {phase === 'imported' && state.record && (
          <div className="rpsp-done">
            <p className="rpsp-done-title">
              {state.record.displayName} was added to this workspace.
            </p>
            <dl className="rpsp-done-facts">
              <div><dt>PSP Agent ID</dt><dd>{state.record.pspAgentId}</dd></div>
              <div><dt>PSP</dt><dd>{state.record.pspId} · {state.record.pspVersionId}</dd></div>
              <div><dt>Workspace</dt><dd>{state.record.workspaceId}</dd></div>
              <div><dt>Roles</dt><dd>{state.record.agentRoleSummary.join(' · ')}</dd></div>
              <div>
                <dt>Source</dt>
                <dd>{state.record.source.replace(/_/g, ' ').toUpperCase()}</dd>
              </div>
            </dl>
            <p className="rpsp-help">
              Your PSP Agent ID was redeemed and is no longer displayable.
            </p>
            <button className="rpsp-btn" type="button" onClick={onCancel}>Import another</button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The SAFE preview — publishable product facts and a masked id, nothing else. */
function PspPreview({
  preview,
  onConfirm,
  onCancel,
}: {
  preview: PSPAgentImportPreview;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rpsp-preview" aria-label="PSP agent preview">
      <h4 className="rpsp-preview-name">{preview.name}</h4>
      <p className="rpsp-preview-creator">by {preview.creator}</p>
      <dl className="rpsp-preview-facts">
        <div><dt>PSP Agent ID</dt><dd className="rpsp-masked">{preview.maskedAgentId}</dd></div>
        <div><dt>Fingerprint</dt><dd>{preview.credentialFingerprint}</dd></div>
        <div><dt>Version</dt><dd>{preview.version} ({preview.pspVersionId})</dd></div>
        <div><dt>Agent roles</dt><dd>{preview.agentRoles.join(' · ')}</dd></div>
        <div><dt>Supported models</dt><dd>{preview.supportedModels.join(' · ')}</dd></div>
        <div><dt>Required permissions</dt><dd>{preview.requiredPermissions.join(' · ')}</dd></div>
        <div><dt>Required tools</dt><dd>{preview.requiredTools.join(' · ')}</dd></div>
        <div><dt>Review policy</dt><dd>{preview.reviewPolicy}</dd></div>
        <div><dt>Budget policy</dt><dd>{preview.defaultBudgetPolicy}</dd></div>
        <div>
          <dt>Relay Dog</dt>
          <dd>{preview.relayDogColorway} — the official Relay Dog identity</dd>
        </div>
        <div><dt>Provenance</dt><dd>{provenance(preview)}</dd></div>
        <div>
          <dt>Compatibility</dt>
          <dd>{preview.compatible ? 'Compatible with this workspace' : 'Not compatible'}</dd>
        </div>
      </dl>

      {preview.warnings.length > 0 && (
        <ul className="rpsp-warnings">
          {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      <p className="rpsp-redemption">
        {preview.redemptionEffect === 'redeem_one_time'
          ? 'Confirming redeems this PSP Agent ID once and binds it to this workspace.'
          : 'Confirming binds this PSP Agent ID to this workspace.'}
      </p>

      <div className="rpsp-actions">
        <button className="rpsp-btn rpsp-btn--primary" type="button" onClick={onConfirm}>
          Confirm import
        </button>
        <button className="rpsp-btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function provenance(preview: PSPAgentImportPreview): string {
  const source = preview.acquisitionType.replace(/_/g, ' ').toUpperCase();
  if (preview.marketplaceTransactionId) return `${source} · ${preview.marketplaceTransactionId}`;
  if (preview.tradeTransactionId) return `${source} · ${preview.tradeTransactionId}`;
  return source;
}
