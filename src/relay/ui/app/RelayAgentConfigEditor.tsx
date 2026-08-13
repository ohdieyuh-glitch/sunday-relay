import { useState } from 'react';

import { RELAY_EXECUTION_MODES, RELAY_REVIEW_REQUIREMENTS } from '../../mission/mission-config';
import { REPOSITORY_PERMISSIONS, type RepositoryPermission } from '../../mission/repository-target';

/**
 * CONFIGURE THE COMPOUND PSP AGENT — the PURE, session-free editor for what a
 * Mission will REQUEST: the repository permissions, the spend/compute ceilings,
 * and the execution/review policy.
 *
 * It is a CONTROLLED component: it renders from the {@link config} it is handed
 * and proposes every change back through {@link onChange} — it holds no config of
 * its own, opens no socket, reaches no bridge and touches no storage. That purity
 * is what lets it live BEFORE sign-in (the pre-Start-Building Configure step) and
 * ALSO compose inside a signed-in surface, from the same source.
 *
 * Every truthfulness rule the run request depends on is enforced here: a cleared
 * ceiling becomes `null` = "not set" (never coerced to `0` or "unlimited"), a
 * negative or non-finite ceiling is ignored (the server refuses it regardless),
 * and {@link patchConfig} preserves every unrelated field so a later tweak
 * composes with a loaded profile rather than clobbering it. These are the REQUEST
 * side only: what a Mission actually runs UNDER — permissions held, the served
 * model — comes from the bridge's authoritative view, never from here.
 */

/**
 * The repository permissions a config REQUESTS. The browser never invents
 * authority: it forwards only what the config names, and the bridge narrows even
 * that against the registration's grants. Empty means the config named none, so
 * the server applies its own safe floor (read + write_worktree) rather than a
 * ship ladder the task never asked for.
 */
export function configPermissions(config: unknown): readonly string[] {
  const perms = (config as { permissions?: unknown } | null)?.permissions;
  return Array.isArray(perms) && perms.every((p) => typeof p === 'string') ? perms as string[] : [];
}

/**
 * The spend/compute ceilings a config carries, as a plain record. An absent or
 * malformed `limits` reads as an empty record, so every ceiling then discloses
 * "not set" rather than a fabricated `0` or an implied "unlimited": the domain's
 * `null` semantics, preserved verbatim.
 */
export function configLimits(config: unknown): Record<string, number | null> {
  const limits = (config as { limits?: unknown } | null)?.limits;
  return (limits !== null && typeof limits === 'object') ? { ...(limits as Record<string, number | null>) } : {};
}

/**
 * One enum-valued policy field of a config, falling back to the domain's own
 * conservative default when the config does not name it — the SAME fallback
 * `validateMissionConfig` applies, so the select shows what will actually be
 * requested rather than an empty control.
 */
export function configEnum<T extends string>(config: unknown, key: string, allowed: readonly T[], fallback: T): T {
  const value = (config as Record<string, unknown> | null)?.[key];
  return (typeof value === 'string' && (allowed as readonly string[]).includes(value)) ? value as T : fallback;
}

/**
 * Produce the next config by patching the current one. Every unrelated field is
 * preserved (a loaded PSP's `pspId`, `roles`, `completionRule`…), so the
 * field-level editor and a PSP picker COMPOSE — pick a profile, then tweak —
 * rather than one clobbering the other.
 */
export function patchConfig(config: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = (config !== null && typeof config === 'object') ? config as Record<string, unknown> : {};
  return { ...base, ...patch };
}

/** The spend/compute ceilings the editor exposes, in the domain's own order. Each
 *  is a number the config REQUESTS, or `null` = "not set" (disclosed as such). */
export const EDITOR_LIMITS = [
  { field: 'spendUsd', label: 'Spend ceiling (USD)', step: '0.01' },
  { field: 'agentCalls', label: 'Agent-call ceiling', step: '1' },
  { field: 'runtimeMinutes', label: 'Runtime ceiling (minutes)', step: '1' },
  { field: 'reviewCycles', label: 'Review cycles', step: '1' },
  { field: 'repairCycles', label: 'Repair cycles', step: '1' },
] as const;

/** The base label an untouched config carries until the user diverges it. */
const BASE_LABEL = 'Default beta configuration';

export function RelayAgentConfigEditor({
  config,
  onChange,
}: {
  readonly config: unknown;
  readonly onChange: (nextConfig: unknown, label: string) => void;
}) {
  // Editing here diverges the config from any named profile, so the label must
  // stop claiming that profile's name — the config is now customised. This is
  // display-only truthfulness; the config is what the engine acts on.
  const [label, setLabel] = useState(BASE_LABEL);
  const nextLabel = () => (label.startsWith('Custom') ? label : `Custom (from ${label})`);
  const emit = (nextConfig: Record<string, unknown>) => {
    const relabelled = nextLabel();
    setLabel(relabelled);
    onChange(nextConfig, relabelled);
  };

  const requestedPermissions = new Set(configPermissions(config));
  const editorLimits = configLimits(config);

  const togglePermission = (perm: RepositoryPermission, on: boolean) => {
    const next = new Set<string>(requestedPermissions);
    if (on) next.add(perm); else next.delete(perm);
    // Rebuild in the ladder's canonical order — the request stays inspectable.
    const ordered = REPOSITORY_PERMISSIONS.filter((p) => next.has(p));
    emit(patchConfig(config, { permissions: ordered }));
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
    emit(patchConfig(config, { limits: { ...editorLimits, [field]: value } }));
  };
  const setPolicy = (key: 'mode' | 'review', value: string) => {
    emit(patchConfig(config, { [key]: value }));
  };

  return (
    <fieldset className="relay-agent-config-editor">
      <legend>Configure the Compound PSP Agent</legend>

      <div className="relay-agent-config-editor__perms" role="group" aria-label="Permissions to request">
        <p className="relay-agent-config-editor__heading">Permissions to request</p>
        {REPOSITORY_PERMISSIONS.map((perm) => (
          <label key={perm} className="relay-agent-config-editor__perm">
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

      <div className="relay-agent-config-editor__limits" role="group" aria-label="Spend and compute ceilings">
        <p className="relay-agent-config-editor__heading">Spend &amp; compute ceilings</p>
        {EDITOR_LIMITS.map(({ field, label: limitLabel, step }) => {
          const raw = editorLimits[field];
          const value = typeof raw === 'number' ? raw : null;
          return (
            <label key={field} className="relay-agent-config-editor__limit">
              <span className="relay-agent-config-editor__limit-label">{limitLabel}</span>
              <input
                type="number"
                min={0}
                step={step}
                aria-label={limitLabel}
                value={value === null ? '' : String(value)}
                onChange={(e) => setLimit(field, e.target.value)}
              />
              <span className="relay-agent-config-editor__unset">{value === null ? 'not set' : ''}</span>
            </label>
          );
        })}
      </div>

      <div className="relay-agent-config-editor__policy" role="group" aria-label="Execution and review policy">
        <label>
          Execution mode
          <select
            aria-label="Execution mode"
            value={configEnum(config, 'mode', RELAY_EXECUTION_MODES, 'guided')}
            onChange={(e) => setPolicy('mode', e.target.value)}
          >
            {RELAY_EXECUTION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          Review requirement
          <select
            aria-label="Review requirement"
            value={configEnum(config, 'review', RELAY_REVIEW_REQUIREMENTS, 'independent')}
            onChange={(e) => setPolicy('review', e.target.value)}
          >
            {RELAY_REVIEW_REQUIREMENTS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      {/* Role OCCUPANTS (who fills architect/coding/reviewer) are deliberately
          NOT edited here: no browser occupant catalog exists, roles are staffed
          by the deployment, and criterion 10 shows the ACTUAL per-role
          actor/model live once the Mission runs. */}
      <p className="relay-agent-config-editor__note">
        Role occupants (architect, coding, reviewer) are staffed by the deployment and shown live per role once the Mission runs.
      </p>
    </fieldset>
  );
}
