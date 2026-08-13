import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { startBetaMission, pollBetaMission, shipBetaMission, retryBetaMission, cancelBetaMission, listBetaMissions } from './beta-mission';
import { RelayPspPicker } from './RelayPspPicker';
import { RelayMissionHistory } from './RelayMissionHistory';
import { rememberActiveMission, recallActiveMission, forgetActiveMission } from './active-mission';
import { configPermissions, configLimits, configEnum, patchConfig, EDITOR_LIMITS } from './RelayAgentConfigEditor';
import type { listPsps, loadPsp, savePsp } from './psp-client';
import type { LiveMissionUpdate } from './contracts';
import { RELAY_EXECUTION_MODES, RELAY_REVIEW_REQUIREMENTS } from '../../mission/mission-config';

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
 * The configured occupant of a role, for the READ-ONLY requested view. A `null`
 * selector means the deployment staffs that role with its own default — disclosed
 * as such, never guessed at, and never presented as an actual actor (the actual
 * per-role actor/model is shown live from the bridge once the Mission runs).
 */
function roleOccupantLabel(selector: unknown): string {
  return typeof selector === 'string' && selector.trim() !== '' ? selector : 'deployment default';
}

export function RelayMissionRunner({
  repositoryKey,
  workingBranch = 'relay/beta',
  config,
  configLabel,
  onReconfigure,
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
  /** A truthful display name for `config` — "Your configured Agent" when the
   *  participant configured it before Start Building, or the default's name.
   *  Display only; the engine acts on `config`, never this. */
  readonly configLabel?: string;
  /** Open the dedicated Configure surface (founder rules B/C). Reached from BOTH
   *  the fail-closed state ("Configure Agent", when no valid Agent exists) and the
   *  returning-user idle form ("Reconfigure Agent"). The runner never authors the
   *  Agent inline — it hands off to the Configure surface and consumes the result. */
  readonly onReconfigure?: () => void;
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
  // FAIL-CLOSED (founder rule A): a Mission may start ONLY when a valid Compound
  // PSP Agent is present. A valid Agent is a non-empty plain object — never null,
  // never a silent default, never a bare `{}` conjured from an empty selection.
  // Until one exists (configured before sign-in, or a saved PSP loaded here) the
  // runner withholds Start Mission entirely. Derived from `activeConfig`, not the
  // static `config` prop, so loading a saved PSP resolves the fail-closed state
  // live.
  const hasValidAgent = activeConfig !== null && typeof activeConfig === 'object'
    && !Array.isArray(activeConfig) && Object.keys(activeConfig as object).length > 0;
  // Seeded truthfully from the caller: a rehydrated custom Agent must NOT read as
  // "Default beta configuration". The PSP picker's onSelect overrides it on load.
  const [activeLabel, setActiveLabel] = useState(configLabel ?? 'Default beta configuration');
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
    // Fail-closed guard, defence in depth: even if a control were reached, a
    // Mission never dispatches without a valid Agent (founder rule A).
    if (!hasValidAgent) return;
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
  }, [objective, repositoryKey, workingBranch, activeConfig, bridgeUrl, startImpl, hasValidAgent]);

  // Policy gate (criterion 7): a Mission that requests a HIGH-CONSEQUENCE
  // permission — a merge or a production deploy, the two a branch delete cannot
  // undo — must present its Contract for explicit, fresh confirmation before it
  // runs. A standing registration grant is not enough; the user confirms THIS
  // Mission. Anything less consequential starts without interruption.
  const onStartSubmit = useCallback((event: FormEvent) => {
    event.preventDefault();
    if (!hasValidAgent) return; // fail-closed — no Agent, no Mission.
    const highConsequence = configPermissions(activeConfig).filter((p) => p === 'merge_pr' || p === 'deploy_production');
    if (highConsequence.length > 0 && !contractShown) { setContractShown(true); return; }
    void dispatchStart();
  }, [activeConfig, contractShown, dispatchStart, hasValidAgent]);

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
    // FAIL-CLOSED (founder rule A): a signed-in participant whose session was
    // restored but who has NO valid Agent may NOT start a Mission. We do not
    // default one. Instead we withhold Start Mission entirely and offer the two
    // ways to obtain a real Agent: configure one (the dedicated Configure surface,
    // via onReconfigure) or load a saved PSP (which patchConfig turns into the
    // Agent, lifting this gate). Start Mission is unreachable until then.
    if (!hasValidAgent) {
      return (
        <>
        <div className="relay-mission-runner" data-state="no-agent">
          <h2>Start a Mission on <code>{repositoryKey}</code></h2>
          <p className="relay-mission-runner__no-agent" role="alert">
            No Compound PSP Agent is configured. Configure your Agent or load a saved PSP to start a Mission.
          </p>
          {onReconfigure !== undefined && (
            <button type="button" className="relay-mission-runner__configure" onClick={onReconfigure}>
              Configure Agent
            </button>
          )}
          {/* Load Saved PSP: selecting a REAL saved profile patches it onto the
              (null) base and yields a valid Agent, lifting the fail-closed gate.
              The empty/default option never fires on mount and patches to a bare
              {}, which is NOT a valid Agent — so no Agent is silently conjured. */}
          <RelayPspPicker
            bridgeUrl={bridgeUrl}
            defaultConfig={config}
            defaultLabel="No Agent configured"
            activeConfig={activeConfig}
            // Load-only in the fail-closed state: there is no configured Agent to
            // save, so the picker offers only LOAD (which supplies the Agent).
            canSave={false}
            onSelect={(c, label) => { setActiveConfig(patchConfig(config, c as Record<string, unknown>)); setActiveLabel(label); }}
            {...(pspListImpl !== undefined ? { listImpl: pspListImpl } : {})}
            {...(pspLoadImpl !== undefined ? { loadImpl: pspLoadImpl } : {})}
            {...(pspSaveImpl !== undefined ? { saveImpl: pspSaveImpl } : {})}
          />
        </div>
        <RelayMissionHistory
          bridgeUrl={bridgeUrl}
          onOpen={onOpenMission}
          {...(historyImpl !== undefined ? { listImpl: historyImpl } : {})}
        />
        </>
      );
    }

    const highConsequencePerms = configPermissions(activeConfig).filter((p) => p === 'merge_pr' || p === 'deploy_production');
    const limits = (activeConfig as { limits?: Record<string, number | null> } | null)?.limits ?? {};

    // The read-only view of what the pre-configured Agent will REQUEST, derived
    // straight from activeConfig: the roles, the policy and the ceilings the
    // participant set BEFORE this repository was connected, plus any profile
    // later merged onto it. Nothing is editable here — the runner is a CONSUMER
    // of that config (the editor lives in the Configure step). What the Mission
    // actually runs UNDER (permissions held, served model) comes from the
    // bridge's authoritative view once it starts, never from this request side.
    const agentRoles = (activeConfig as { roles?: Record<string, unknown> } | null)?.roles ?? {};
    const shownLimits = configLimits(activeConfig);

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
          // MERGE the loaded profile onto the pre-configured Agent, never REPLACE
          // it: loading a saved PSP overrides only the fields it names, so the
          // Agent configured before this repository was connected (its roles,
          // its ceilings, any pre-set field the profile is silent on) survives.
          onSelect={(c, label) => { setActiveConfig(patchConfig(config, c as Record<string, unknown>)); setActiveLabel(label); }}
          {...(pspListImpl !== undefined ? { listImpl: pspListImpl } : {})}
          {...(pspLoadImpl !== undefined ? { loadImpl: pspLoadImpl } : {})}
          {...(pspSaveImpl !== undefined ? { saveImpl: pspSaveImpl } : {})}
        />

        {/* RETURNING USER (founder rule B/C): reconfigure the Agent without being
            forced back through sign-in. It hands off to the dedicated Configure
            surface — the runner never authors the Agent inline — and returns here
            with the updated Agent rehydrated. Sits alongside the Load-Saved-PSP
            picker as the second way to change the active Agent. */}
        {onReconfigure !== undefined && (
          <button type="button" className="relay-mission-runner__reconfigure" onClick={onReconfigure}>
            Reconfigure Agent
          </button>
        )}

        {/* THE CONFIGURED COMPOUND PSP AGENT (REQUESTED) — read only. This is the
            Agent the participant configured BEFORE connecting this repository,
            carried here unchanged (invariant 7): its roles, its policy, its
            ceilings. It is a REQUEST, kept deliberately DISTINCT from the
            authoritative "permissions held" / served-model view the running
            Mission shows from the bridge (criteria 10, 15) — the two are
            different truth classes and must never read as equal. Editing lives in
            the earlier Configure step; the runner only consumes. */}
        <section className="relay-mission-runner__agent" aria-label="Configured Compound PSP Agent">
          <h3>Configured Compound PSP Agent (requested)</h3>
          <p className="relay-mission-runner__agent-note">
            What you configured before connecting this repository — a request, not a claim. The
            authority actually HELD and the model actually SERVED are shown from the bridge once
            the Mission runs.
          </p>
          <ul className="relay-mission-runner__agent-roles" aria-label="Configured roles">
            <li>Prompt Architect: <strong>{roleOccupantLabel(agentRoles.architect)}</strong></li>
            <li>Coding Agent: <strong>{roleOccupantLabel(agentRoles.coding)}</strong></li>
            <li>Independent Reviewer: <strong>{roleOccupantLabel(agentRoles.reviewer)}</strong></li>
            <li>Relay: <strong>orchestrates the Mission</strong></li>
          </ul>
          {/* PSP identity/version (founder rule D) — shown only when the config
              actually carries a non-empty pspId. Never fabricated: a config with no
              PSP identity omits this line rather than inventing "none" as a fact. */}
          {(() => {
            const pspId = (activeConfig as { pspId?: unknown } | null)?.pspId;
            return typeof pspId === 'string' && pspId.trim() !== ''
              ? <p className="relay-mission-runner__agent-psp">PSP: <strong>{pspId}</strong></p>
              : null;
          })()}
          <p className="relay-mission-runner__agent-policy">
            Execution mode: <strong>{configEnum(activeConfig, 'mode', RELAY_EXECUTION_MODES, 'guided')}</strong>
            {' · '}Review requirement: <strong>{configEnum(activeConfig, 'review', RELAY_REVIEW_REQUIREMENTS, 'independent')}</strong>
          </p>
          <ul className="relay-mission-runner__agent-limits" aria-label="Configured ceilings">
            {EDITOR_LIMITS.map(({ field, label }) => {
              const raw = shownLimits[field];
              const value = typeof raw === 'number' ? raw : null;
              const shown = value === null ? 'not set' : field === 'spendUsd' ? `$${value}` : String(value);
              return <li key={field}>{label}: <strong>{shown}</strong></li>;
            })}
          </ul>
        </section>

        <p className="relay-mission-runner__config">Running under <strong>{activeLabel}</strong>.</p>
        <p className="relay-mission-runner__permissions">
          Permissions requested:{' '}
          <strong>{(() => {
            const p = configPermissions(activeConfig);
            return p.length > 0 ? p.join(', ') : 'read + write_worktree (safe floor)';
          })()}</strong>
          {' '}— the bridge refuses anything you did not grant.
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
