import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { startBetaMission, pollBetaMission, shipBetaMission } from './beta-mission';
import { RelayPspPicker } from './RelayPspPicker';
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

export function RelayMissionRunner({
  repositoryKey,
  workingBranch = 'relay/beta',
  config,
  bridgeUrl,
  startImpl = startBetaMission,
  pollImpl = pollBetaMission,
  shipImpl = shipBetaMission,
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

  const onStart = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await startImpl({
      objective: objective.trim(),
      repositoryKey,
      workingBranch,
      permissions: ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr'],
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

  const onShip = useCallback(async () => {
    if (missionId === null) return;
    setBusy(true);
    setMessage(null);
    const result = await shipImpl({ missionId, bridgeUrl });
    setBusy(false);
    if (result.ok) setShip({ stage: result.stage, shipped: result.shipped });
    else setMessage(result.message);
  }, [missionId, bridgeUrl, shipImpl]);

  if (missionId === null) {
    return (
      <form className="relay-mission-runner" data-state="idle" onSubmit={(e) => void onStart(e)}>
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
        <label>
          Ask Relay an objective
          <input aria-label="Objective" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Implement…" />
        </label>
        <button type="submit" disabled={busy || objective.trim() === ''}>{busy ? 'Starting…' : 'Start Mission'}</button>
        {message !== null && <p className="relay-mission-runner__error" role="alert">{message}</p>}
      </form>
    );
  }

  return (
    <section className="relay-mission-runner" data-state={state ?? 'starting'} aria-label="Mission">
      <h2>Mission on <code>{repositoryKey}</code></h2>
      <p>State: <strong className="relay-mission-runner__state">{state ?? 'starting'}</strong>
        {view?.phase !== undefined && <span className="relay-mission-runner__phase"> · {view.phase}</span>}</p>

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

      {view?.error !== undefined && (
        <p className="relay-mission-runner__failure" role="status">Stopped: {view.error.safeMessage}</p>
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
