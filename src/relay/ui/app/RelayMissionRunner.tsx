import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { startBetaMission, pollBetaMission, shipBetaMission, retryBetaMission, cancelBetaMission, listBetaMissions } from './beta-mission';
import { RelayPspPicker } from './RelayPspPicker';
import { RelayMissionHistory } from './RelayMissionHistory';
import { rememberActiveMission, recallActiveMission, forgetActiveMission } from './active-mission';
import type { listPsps, loadPsp, savePsp } from './psp-client';
import type { LiveMissionUpdate } from './contracts';
import { RELAY_EXECUTION_MODES, RELAY_REVIEW_REQUIREMENTS } from '../../mission/mission-config';
import { REPOSITORY_PERMISSIONS, type RepositoryPermission } from '../../mission/repository-target';

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

/**
 * The spend/compute ceilings the active configuration carries, as a plain record.
 * An absent or malformed `limits` reads as an empty record, so every ceiling then
 * discloses "not set" rather than a fabricated `0` or an implied "unlimited": the
 * domain's `null` semantics, preserved verbatim into the editor.
 */
function configLimits(config: unknown): Record<string, number | null> {
  const limits = (config as { limits?: unknown } | null)?.limits;
  return (limits !== null && typeof limits === 'object') ? { ...(limits as Record<string, number | null>) } : {};
}

/**
 * One enum-valued policy field of the active config, falling back to the domain's
 * own conservative default when the config does not name it — the SAME fallback
 * `validateMissionConfig` applies, so the select shows what will actually be
 * requested rather than an empty control.
 */
function configEnum<T extends string>(config: unknown, key: string, allowed: readonly T[], fallback: T): T {
  const value = (config as Record<string, unknown> | null)?.[key];
  return (typeof value === 'string' && (allowed as readonly string[]).includes(value)) ? value as T : fallback;
}

/**
 * Produce the next active config by patching the current one. Every unrelated
 * field is preserved (a loaded PSP's `pspId`, `roles`, `completionRule`…), so the
 * field-level editor and the PSP picker COMPOSE — pick a profile, then tweak —
 * rather than one clobbering the other.
 */
function patchConfig(config: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = (config !== null && typeof config === 'object') ? config as Record<string, unknown> : {};
  return { ...base, ...patch };
}

/** The spend/compute ceilings the editor exposes, in the domain's own order. Each
 *  is a number the config REQUESTS, or `null` = "not set" (disclosed as such). */
const EDITOR_LIMITS = [
  { field: 'spendUsd', label: 'Spend ceiling (USD)', step: '0.01' },
  { field: 'agentCalls', label: 'Agent-call ceiling', step: '1' },
  { field: 'runtimeMinutes', label: 'Runtime ceiling (minutes)', step: '1' },
  { field: 'reviewCycles', label: 'Review cycles', step: '1' },
  { field: 'repairCycles', label: 'Repair cycles', step: '1' },
] as const;

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

    // The editor's live view of what the next Mission will REQUEST, derived
    // straight from activeConfig so a loaded PSP pre-fills every control and a
    // later tweak composes with it. Each handler proposes a new config through
    // the SAME setActiveConfig the PSP picker uses; the bridge stays the
    // authority and narrows or refuses whatever the editor asks for.
    const requestedPermissions = new Set(configPermissions(activeConfig));
    const editorLimits = configLimits(activeConfig);
    // Editing here diverges the config from any loaded PSP, so the "Running
    // under <name>" label must stop claiming that saved profile's name — the
    // config is now customised. Announce the fact, not the intention.
    const markEdited = () =>
      setActiveLabel((prev) => (prev.startsWith('Custom') ? prev : `Custom (from ${prev})`));
    const togglePermission = (perm: RepositoryPermission, on: boolean) => {
      const next = new Set<string>(requestedPermissions);
      if (on) next.add(perm); else next.delete(perm);
      // Rebuild in the ladder's canonical order — the request stays inspectable.
      const ordered = REPOSITORY_PERMISSIONS.filter((p) => next.has(p));
      setActiveConfig(patchConfig(activeConfig, { permissions: ordered }));
      markEdited();
    };
    const setLimit = (field: string, raw: string) => {
      const trimmed = raw.trim();
      let value: number | null;
      if (trimmed === '') {
        value = null; // cleared = "not set" — never coerced to 0 or unlimited.
      } else {
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed < 0) return; // no negatives in the UI; the server refuses them regardless.
        value = parsed;
      }
      setActiveConfig(patchConfig(activeConfig, { limits: { ...editorLimits, [field]: value } }));
      markEdited();
    };
    const setPolicy = (key: 'mode' | 'review', value: string) => {
      setActiveConfig(patchConfig(activeConfig, { [key]: value }));
      markEdited();
    };

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

        {/* PRE-START CONFIGURATION EDITOR — set exactly what this Mission
            REQUESTS before it runs (criteria 3 & 5). Every control is seeded
            from activeConfig and writes back through setActiveConfig, so it
            composes with the PSP picker above and stays consistent with the
            "Permissions requested" summary below. These are the request side:
            what the Mission runs UNDER (permissions held, authorized ceiling)
            comes from the bridge's authoritative view once it starts, never
            from here. */}
        <fieldset className="relay-mission-runner__editor">
          <legend>Configure this Mission before it starts</legend>

          <div className="relay-mission-runner__editor-perms" role="group" aria-label="Permissions to request">
            <p className="relay-mission-runner__editor-heading">Permissions to request</p>
            {REPOSITORY_PERMISSIONS.map((perm) => (
              <label key={perm} className="relay-mission-runner__editor-perm">
                <input
                  type="checkbox"
                  aria-label={perm}
                  checked={requestedPermissions.has(perm)}
                  onChange={(e) => togglePermission(perm, e.target.checked)}
                />
                {' '}{perm}
              </label>
            ))}
          </div>

          <div className="relay-mission-runner__editor-limits" role="group" aria-label="Spend and compute ceilings">
            <p className="relay-mission-runner__editor-heading">Spend &amp; compute ceilings</p>
            {EDITOR_LIMITS.map(({ field, label, step }) => {
              const raw = editorLimits[field];
              const value = typeof raw === 'number' ? raw : null;
              return (
                <label key={field} className="relay-mission-runner__editor-limit">
                  <span className="relay-mission-runner__editor-limit-label">{label}</span>
                  <input
                    type="number"
                    min={0}
                    step={step}
                    aria-label={label}
                    value={value === null ? '' : String(value)}
                    onChange={(e) => setLimit(field, e.target.value)}
                  />
                  <span className="relay-mission-runner__editor-unset">{value === null ? 'not set' : ''}</span>
                </label>
              );
            })}
          </div>

          <div className="relay-mission-runner__editor-policy" role="group" aria-label="Execution and review policy">
            <label>
              Execution mode
              <select
                aria-label="Execution mode"
                value={configEnum(activeConfig, 'mode', RELAY_EXECUTION_MODES, 'guided')}
                onChange={(e) => setPolicy('mode', e.target.value)}
              >
                {RELAY_EXECUTION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label>
              Review requirement
              <select
                aria-label="Review requirement"
                value={configEnum(activeConfig, 'review', RELAY_REVIEW_REQUIREMENTS, 'independent')}
                onChange={(e) => setPolicy('review', e.target.value)}
              >
                {RELAY_REVIEW_REQUIREMENTS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>

          {/* Role OCCUPANTS (who fills architect/coding/reviewer) are deliberately
              NOT edited here: no browser occupant catalog exists, roles are
              staffed by the deployment, and criterion 10 shows the ACTUAL per-role
              actor/model live once the Mission runs. */}
          <p className="relay-mission-runner__editor-note">
            Role occupants (architect, coding, reviewer) are staffed by the deployment and shown live per role once the Mission runs.
          </p>
        </fieldset>

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
