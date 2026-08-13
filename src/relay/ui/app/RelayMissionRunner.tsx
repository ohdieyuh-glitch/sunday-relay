import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { startBetaMission, pollBetaMission, shipBetaMission, retryBetaMission, cancelBetaMission, listBetaMissions } from './beta-mission';
import { RelayPspPicker } from './RelayPspPicker';
import { RelayMissionHistory } from './RelayMissionHistory';
import { rememberActiveMission, recallActiveMission, forgetActiveMission } from './active-mission';
import type { listPsps, loadPsp, savePsp } from './psp-client';
import type { LiveMissionUpdate } from './contracts';

/**
 * RUN A MISSION — the surface a signed-in beta user starts, watches, and ships a
 * Mission from, on the repository they connected.
 *
 * It renders the ONE authoritative view the bridge returns, unchanged: the live
 * state, the config the Mission runs under, and per-role actor/model evidence
 * (requested vs actual, side by side — criterion 10). It never claims progress
 * the bridge did not report, offers Ship only once the Mission is
 * `verified_complete`, and states a refusal in the bridge's own words. All calls
 * carry the participant's session; the browser is never the mission authority.
 */

const TERMINAL = new Set(['verified_complete', 'failed', 'cancelled']);

/**
 * The repository permissions the active configuration (PSP) REQUESTS. The
 * browser never invents authority: it forwards only what the chosen profile
 * names, and the bridge narrows even that against the registration's grants.
 * Empty means the profile named none, and the runner then omits permissions so
 * the server applies its own safe floor (read + write_worktree) rather than
 * requesting a ship ladder the task never asked for.
 */
function configPermissions(config: unknown): readonly string[] {
  const perms = (config as { permissions?: unknown } | null)?.permissions;
  return Array.isArray(perms) && perms.every((p) => typeof p === 'string') ? perms as string[] : [];
}

export function RelayMissionRunner({
  repositoryKey,
  workingBranch = 'relay/beta',
  config,
  bridgeUrl,
  startImpl = startBetaMission,
  pollImpl = pollBetaMission,
  shipImpl = shipBetaMission,
  retryImpl = retryBetaMission,
  cancelImpl = cancelBetaMission,
  historyImpl,
  pspListImpl,
  pspLoadImpl,
  pspSaveImpl,
  pollIntervalMs = 60,
}: {
  readonly repositoryKey: string;
  readonly workingBranch?: string;
  readonly config?: unknown;
  readonly bridgeUrl?: string | null;
  readonly startImpl?: typeof startBetaMission;
  readonly pollImpl?: typeof pollBetaMission;
  readonly shipImpl?: typeof shipBetaMission;
  readonly retryImpl?: typeof retryBetaMission;
  readonly cancelImpl?: typeof cancelBetaMission;
  readonly historyImpl?: typeof listBetaMissions;
  readonly pspListImpl?: typeof listPsps;
  readonly pspLoadImpl?: typeof loadPsp;
  readonly pspSaveImpl?: typeof savePsp;
  readonly pollIntervalMs?: number;
}) {
  const [objective, setObjective] = useState('');
  // The config the next Mission carries: the passed default until the user picks
  // a saved PSP. The label is display only — the config is what the engine acts on.
  const [activeConfig, setActiveConfig] = useState<unknown>(config);
  const [activeLabel, setActiveLabel] = useState('Default beta configuration');
  // Whether the high-consequence Mission Contract is being shown for confirmation.
  const [contractShown, setContractShown] = useState(false);
  // Reconnect: a refresh restores the mission last started on this repository,
  // then the poll below re-reads its authoritative state from the bridge.
  const [missionId, setMissionId] = useState<string | null>(() => recallActiveMission(repositoryKey));
  const [view, setView] = useState<LiveMissionUpdate | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ship, setShip] = useState<{ stage: string | null; shipped: boolean } | null>(null);

  const state = view?.state ?? null;
  const terminal = state !== null && TERMINAL.has(state);

  // Watch the mission: poll until the bridge reports a terminal state.
  useEffect(() => {
    if (missionId === null || terminal) return undefined;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const result = await pollImpl({ missionId, bridgeUrl });
      if (cancelled) return;
      if (result.ok && result.view !== null) setView(result.view);
      if (!cancelled) handle = setTimeout(() => void tick(), pollIntervalMs);
    };
    handle = setTimeout(() => void tick(), pollIntervalMs);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [missionId, terminal, pollImpl, bridgeUrl, pollIntervalMs]);

  const dispatchStart = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    // Least privilege: request exactly what the chosen profile named, or omit so
    // the server applies its safe floor. Never a hardcoded ship ladder — that
    // would 422 a read/write-only registration and over-hold authority besides.
    const requested = configPermissions(activeConfig);
    const result = await startImpl({
      objective: objective.trim(),
      repositoryKey,
      workingBranch,
      ...(requested.length > 0 ? { permissions: requested } : {}),
      config: activeConfig,
      bridgeUrl,
    });
    setBusy(false);
    if (result.ok && result.missionId !== null) {
      // Remember it BEFORE showing it, so a refresh mid-first-render still finds it.
      rememberActiveMission(repositoryKey, result.missionId);
      setMissionId(result.missionId);
      setView(result.view);
    } else {
      setMessage(result.message);
    }
  }, [objective, repositoryKey, workingBranch, activeConfig, bridgeUrl, startImpl]);

  // Policy gate (criterion 7): a Mission that requests a HIGH-CONSEQUENCE
  // permission — a merge or a production deploy, the two a branch delete cannot
  // undo — must present its Contract for explicit, fresh confirmation before it
  // runs. A standing registration grant is not enough; the user confirms THIS
  // Mission. Anything less consequential starts without interruption.
  const onStartSubmit = useCallback((event: FormEvent) => {
    event.preventDefault();
    const highConsequence = configPermissions(activeConfig).filter((p) => p === 'merge_pr' || p === 'deploy_production');
    if (highConsequence.length > 0 && !contractShown) { setContractShown(true); return; }
    void dispatchStart();
  }, [activeConfig, contractShown, dispatchStart]);

  // Leave a finished Mission behind and return to Start — drops the pointer so a
  // later refresh does not reconnect to a Mission the user is done with.
  const onStartAnother = useCallback(() => {
    forgetActiveMission(repositoryKey);
    setMissionId(null);
    setView(null);
    setShip(null);
    setMessage(null);
    setObjective('');
  }, [repositoryKey]);

  // Open a past Mission from the history — reconnect to its authoritative state
  // exactly as a refresh does, and remember it so a refresh keeps it open.
  const onOpenMission = useCallback((id: string) => {
    rememberActiveMission(repositoryKey, id);
    setMissionId(id);
    setView(null);
    setShip(null);
    setMessage(null);
  }, [repositoryKey]);

  const onShip = useCallback(async () => {
    if (missionId === null) return;
    setBusy(true);
    setMessage(null);
    const result = await shipImpl({ missionId, bridgeUrl });
    setBusy(false);
    if (result.ok) setShip({ stage: result.stage, shipped: result.shipped });
    else setMessage(result.message);
  }, [missionId, bridgeUrl, shipImpl]);

  // Re-drive a failed Mission. On success the view returns to a running state,
  // which flips `terminal` false and the poll effect above resumes watching.
  const onRetry = useCallback(async () => {
    if (missionId === null) return;
    setBusy(true);
    setMessage(null);
    const result = await retryImpl({ missionId, bridgeUrl });
    setBusy(false);
    if (result.ok) setView(result.view);
    else setMessage(result.message);
  }, [missionId, bridgeUrl, retryImpl]);

  // Stop an in-flight Mission — the user's lever on spend they authorized.
  const onCancel = useCallback(async () => {
    if (missionId === null) return;
    setBusy(true);
    setMessage(null);
    const result = await cancelImpl({ missionId, bridgeUrl });
    setBusy(false);
    if (result.ok) setView(result.view);
    else setMessage(result.message);
  }, [missionId, bridgeUrl, cancelImpl]);

  if (missionId === null) {
    const highConsequencePerms = configPermissions(activeConfig).filter((p) => p === 'merge_pr' || p === 'deploy_production');
    const limits = (activeConfig as { limits?: Record<string, number | null> } | null)?.limits ?? {};
    const startLabel = busy
      ? 'Starting…'
      : contractShown ? 'Confirm authorization & start'
      : highConsequencePerms.length > 0 ? 'Review Mission Contract'
      : 'Start Mission';
    return (
      <>
      <form className="relay-mission-runner" data-state="idle" onSubmit={onStartSubmit}>
        <h2>Start a Mission on <code>{repositoryKey}</code></h2>
        <RelayPspPicker
          bridgeUrl={bridgeUrl}
          defaultConfig={config}
          activeConfig={activeConfig}
          onSelect={(c, label) => { setActiveConfig(c); setActiveLabel(label); }}
          {...(pspListImpl !== undefined ? { listImpl: pspListImpl } : {})}
          {...(pspLoadImpl !== undefined ? { loadImpl: pspLoadImpl } : {})}
          {...(pspSaveImpl !== undefined ? { saveImpl: pspSaveImpl } : {})}
        />
        <p className="relay-mission-runner__config">Running under <strong>{activeLabel}</strong>.</p>
        <p className="relay-mission-runner__permissions">
          Permissions requested:{' '}
          <strong>{(() => {
            const p = configPermissions(activeConfig);
            return p.length > 0 ? p.join(', ') : 'read + write_worktree (safe floor)';
          })()}</strong>
          {' '}— the bridge narrows these against what you granted.
        </p>
        <label>
          Ask Relay an objective
          <input aria-label="Objective" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Implement…" />
        </label>
        {contractShown && (
          <div className="relay-mission-runner__contract" aria-label="Mission Contract">
            <h3>Mission Contract — confirm before it runs</h3>
            <p>Objective: {objective.trim() || '(none)'}</p>
            <p>High-consequence authority requested:{' '}
              <strong>{highConsequencePerms.join(', ')}</strong>. A standing grant is not enough — confirm this Mission.</p>
            <p>Spend ceiling: {typeof limits.spendUsd === 'number' ? `$${limits.spendUsd}` : 'not set'}
              {' '}· Agent-call ceiling: {typeof limits.agentCalls === 'number' ? limits.agentCalls : 'not set'}</p>
            <button type="button" onClick={() => setContractShown(false)}>Back</button>
          </div>
        )}
        <button type="submit" disabled={busy || objective.trim() === ''}>{startLabel}</button>
        {message !== null && <p className="relay-mission-runner__error" role="alert">{message}</p>}
      </form>
      <RelayMissionHistory
        bridgeUrl={bridgeUrl}
        onOpen={onOpenMission}
        {...(historyImpl !== undefined ? { listImpl: historyImpl } : {})}
      />
      </>
    );
  }

  return (
    <section className="relay-mission-runner" data-state={state ?? 'starting'} aria-label="Mission">
      <h2>Mission on <code>{repositoryKey}</code></h2>
      <p>State: <strong className="relay-mission-runner__state">{state ?? 'starting'}</strong>
        {view?.phase !== undefined && <span className="relay-mission-runner__phase"> · {view.phase}</span>}</p>

      {/* Repo / branch / contract revision / actual permissions held — the
          authoritative view is the source, so "permissions held" is what the
          bridge narrowed to, not what the browser asked for (criteria 10, 15). */}
      <ul className="relay-mission-runner__facts" aria-label="Mission evidence">
        <li>Repository: <code>{repositoryKey}</code></li>
        <li>Working branch: <code>{workingBranch}</code></li>
        {view?.missionRevision !== undefined && (
          <li>Contract revision: <code>{view.missionRevision}</code></li>
        )}
        {view?.config !== undefined && (
          <li>Permissions held: <strong>{view.config.permissions.length > 0
            ? view.config.permissions.join(', ')
            : 'read + write_worktree (floor)'}</strong></li>
        )}
        {view?.config !== undefined && (
          <li>Authorized ceiling: {view.config.limits.spendUsd !== null ? `$${view.config.limits.spendUsd}` : 'no spend cap set'}
            {' · '}{view.config.limits.agentCalls !== null ? `${view.config.limits.agentCalls} agent calls` : 'no call cap set'}
            {' — a Mission that reaches it halts with no further spend.'}</li>
        )}
      </ul>

      {/* The Mission brief — the architect's plan the roles executed against
          (criterion 7). Provenance is honest: it never claims a live architect
          when one did not run. */}
      {view?.handoff !== undefined && (
        <details className="relay-mission-runner__brief" open>
          <summary>Mission brief — {view.handoff.architectLabel} ({view.handoff.architectProvenance})</summary>
          <p className="relay-mission-runner__brief-objective">{view.handoff.objective}</p>
          {view.handoff.acceptanceCriteria.length > 0 && (
            <ul aria-label="Acceptance criteria">
              {view.handoff.acceptanceCriteria.map((criterion, i) => <li key={i}>{criterion}</li>)}
            </ul>
          )}
        </details>
      )}

      {view?.attestations !== undefined && view.attestations.length > 0 && (
        <ul className="relay-mission-runner__evidence" aria-label="Role evidence">
          {view.attestations.map((a) => (
            <li key={a.attestationId}>
              <span className="relay-mission-runner__role">{a.role}</span>: requested <code>{a.requestedActor}</code>, actual <code>{a.actualActor}</code>
              {a.provider !== undefined && <> · {a.provider}</>}
            </li>
          ))}
        </ul>
      )}

      {/* The independent reviewer's verdict, in its own words, with the model
          the provider reported ANSWERED (served) — never defaulted from what was
          requested (criteria 9, 10, 13). */}
      {view?.review !== undefined && (
        <div className="relay-mission-runner__review" aria-label="Reviewer verdict">
          <p>Independent review: <strong>{view.review.verdict}</strong> — {view.review.reviewer}
            {view.review.servedModel !== null && <> · served <code>{view.review.servedModel}</code></>}</p>
          <p className="relay-mission-runner__review-summary">{view.review.summary}</p>
        </div>
      )}

      {view?.error !== undefined && (
        <p className="relay-mission-runner__failure" role="status">Stopped: {view.error.safeMessage}</p>
      )}

      {!terminal && (
        <button type="button" className="relay-mission-runner__cancel" onClick={() => void onCancel()} disabled={busy}>
          {busy ? 'Cancelling…' : 'Cancel Mission'}
        </button>
      )}

      {state === 'failed' && view?.error?.retryable === true && (
        <button type="button" className="relay-mission-runner__retry" onClick={() => void onRetry()} disabled={busy}>
          {busy ? 'Retrying…' : 'Retry Mission'}
        </button>
      )}

      {state === 'verified_complete' && ship === null && (
        <button type="button" className="relay-mission-runner__ship" onClick={() => void onShip()} disabled={busy}>
          {busy ? 'Shipping…' : 'Ship this Mission'}
        </button>
      )}
      {ship !== null && (
        <p className="relay-mission-runner__shipped" data-state="shipped">
          Ship reached <strong>{ship.stage ?? 'an unknown stage'}</strong>{ship.shipped ? ' — shipped.' : '.'}
        </p>
      )}
      {terminal && (
        <button type="button" className="relay-mission-runner__another" onClick={onStartAnother}>
          Start another Mission
        </button>
      )}
      {message !== null && <p className="relay-mission-runner__error" role="alert">{message}</p>}
    </section>
  );
}
