import {
  CALL_PRESETS,
  COMMAND_CHOICES,
  COMPLETION_RULE_CHOICES,
  DEPENDENCY_CHOICES,
  DEPLOY_CHOICES,
  DESTRUCTIVE_CHOICES,
  FILE_ACCESS_CHOICES,
  INSPECTION_CHOICES,
  NETWORK_CHOICES,
  NOTIFY_CHANNEL_CHOICES,
  NOTIFY_EVENT_CHOICES,
  NO_PROGRESS_CHOICES,
  PROTECTED_AREA_CHOICES,
  REPAIR_CYCLE_PRESETS,
  REVIEW_CYCLE_PRESETS,
  REVIEW_REQUIREMENT_CHOICES,
  RUNTIME_PRESETS,
  SCOPE_PRESET_CHOICES,
  SPEND_PRESETS,
  TEST_CHOICES,
} from './options';
import { Chips, PresetStepper, RadioPlates, SettingsField, Segmented, ToggleRow } from './SettingsControls';
import type { ProjectSettingsDraft } from './contracts';

/**
 * Sections 09–13 — scope, permissions, verification, limits, notifications.
 * Everything is option-based: presets, chips, segmented rows, toggles, and
 * bounded steppers. Never a password/API-key/token field; never
 * ACCESS EVERYTHING.
 */

type Patch = (patch: Partial<ProjectSettingsDraft>) => void;

/* -------------------------------------------------------- 09 SCOPE */

export function SectionScope({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  const s = draft.scope;
  return (
    <div className="rps-section-body">
      <SettingsField legend="PROJECT SCOPE">
        <Segmented
          name="rps-scope-preset"
          choices={SCOPE_PRESET_CHOICES}
          value={s.preset}
          onChange={(preset) => patch({ scope: { ...s, preset } })}
        />
        {s.preset === 'custom' && (
          <p className="rps-hint">
            Custom scope opens the focused path selector when the repository is connected — no
            freeform path typing here.
          </p>
        )}
      </SettingsField>
      <SettingsField legend="PROTECTED AREAS" hint="Relay never edits these, in any mode.">
        <Chips
          choices={PROTECTED_AREA_CHOICES}
          values={s.protectedAreas}
          onToggle={(v) =>
            patch({
              scope: {
                ...s,
                protectedAreas: s.protectedAreas.includes(v)
                  ? s.protectedAreas.filter((p) => p !== v)
                  : [...s.protectedAreas, v],
              },
            })
          }
        />
      </SettingsField>
      <SettingsField legend="FILE ACCESS">
        <RadioPlates
          name="rps-file-access"
          choices={FILE_ACCESS_CHOICES}
          value={s.fileAccess}
          onChange={(fileAccess) => patch({ scope: { ...s, fileAccess } })}
          compact
        />
      </SettingsField>
    </div>
  );
}

/* -------------------------------------------------- 10 PERMISSIONS */

export function SectionPermissions({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  const p = draft.permissions;
  return (
    <div className="rps-section-body">
      <SettingsField legend="DEPENDENCY INSTALLATION">
        <Segmented
          name="rps-perm-deps"
          choices={DEPENDENCY_CHOICES}
          value={p.dependencies}
          onChange={(dependencies) => patch({ permissions: { ...p, dependencies } })}
        />
      </SettingsField>
      <SettingsField legend="COMMAND EXECUTION">
        <Segmented
          name="rps-perm-cmd"
          choices={COMMAND_CHOICES}
          value={p.commands}
          onChange={(commands) => patch({ permissions: { ...p, commands } })}
        />
      </SettingsField>
      <SettingsField legend="NETWORK ACCESS">
        <Segmented
          name="rps-perm-net"
          choices={NETWORK_CHOICES}
          value={p.network}
          onChange={(network) => patch({ permissions: { ...p, network } })}
        />
      </SettingsField>
      <SettingsField legend="DEPLOYMENT">
        <Segmented
          name="rps-perm-deploy"
          choices={DEPLOY_CHOICES}
          value={p.deployment}
          onChange={(deployment) => patch({ permissions: { ...p, deployment } })}
        />
      </SettingsField>
      <SettingsField legend="DESTRUCTIVE ACTIONS">
        <Segmented
          name="rps-perm-destructive"
          choices={DESTRUCTIVE_CHOICES}
          value={p.destructive}
          onChange={(destructive) => patch({ permissions: { ...p, destructive } })}
        />
      </SettingsField>
      <SettingsField
        legend="AUTHENTICATED SESSIONS"
        hint="Approved session handles only — Relay never requests or displays passwords, API keys, tokens, cookies, or recovery codes. Session approval happens through each agent's own sign-in, not here."
      >
        <div className="rps-session-row">
          <span className="rps-session-name">Session handles appear after agent sign-in.</span>
          <span className="rps-chip-status">NONE APPROVED YET</span>
        </div>
      </SettingsField>
    </div>
  );
}

/* ------------------------------------------------- 11 VERIFICATION */

export function SectionVerification({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  const v = draft.verification;
  return (
    <div className="rps-section-body">
      <SettingsField legend="REQUIRED TESTS">
        <Chips
          choices={TEST_CHOICES}
          values={v.tests}
          onToggle={(t) =>
            patch({
              verification: {
                ...v,
                tests: v.tests.includes(t) ? v.tests.filter((x) => x !== t) : [...v.tests, t],
              },
            })
          }
        />
      </SettingsField>
      <SettingsField legend="REQUIRED INSPECTION">
        <Chips
          choices={INSPECTION_CHOICES}
          values={v.inspections}
          onToggle={(t) =>
            patch({
              verification: {
                ...v,
                inspections: v.inspections.includes(t)
                  ? v.inspections.filter((x) => x !== t)
                  : [...v.inspections, t],
              },
            })
          }
        />
      </SettingsField>
      <SettingsField legend="REQUIRED REVIEW">
        <RadioPlates
          name="rps-review-req"
          choices={REVIEW_REQUIREMENT_CHOICES}
          value={v.review}
          onChange={(review) => patch({ verification: { ...v, review } })}
          compact
        />
      </SettingsField>
      <SettingsField legend="COMPLETION RULE">
        <RadioPlates
          name="rps-completion"
          choices={COMPLETION_RULE_CHOICES}
          value={v.completionRule}
          onChange={(completionRule) => patch({ verification: { ...v, completionRule } })}
        />
      </SettingsField>
    </div>
  );
}

/* ------------------------------------------------------- 12 LIMITS */

export function SectionLimits({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  const l = draft.limits;
  return (
    <div className="rps-section-body">
      <PresetStepper
        label="RUNTIME"
        presets={RUNTIME_PRESETS}
        value={l.runtimeMinutes}
        onChange={(runtimeMinutes) => patch({ limits: { ...l, runtimeMinutes } })}
        format={(m) =>
          m >= 60 && m % 60 === 0 ? `${m / 60} HOUR${m > 60 ? 'S' : ''}` : `${m} MIN`
        }
        step={15}
        min={15}
        max={480}
      />
      <PresetStepper
        label="AGENT CALLS"
        presets={CALL_PRESETS}
        value={l.agentCalls}
        onChange={(agentCalls) => patch({ limits: { ...l, agentCalls } })}
        step={1}
        min={1}
        max={50}
      />
      <PresetStepper
        label="SPENDING LIMIT"
        presets={SPEND_PRESETS}
        value={l.spendUsd}
        onChange={(spendUsd) => patch({ limits: { ...l, spendUsd } })}
        format={(v) => `$${v}`}
        step={1}
        min={0}
        max={200}
      />
      <PresetStepper
        label="REVIEW CYCLES"
        presets={REVIEW_CYCLE_PRESETS}
        value={l.reviewCycles}
        onChange={(reviewCycles) => patch({ limits: { ...l, reviewCycles } })}
        step={1}
        min={0}
        max={5}
      />
      <PresetStepper
        label="REPAIR CYCLES"
        presets={REPAIR_CYCLE_PRESETS}
        value={l.repairCycles}
        onChange={(repairCycles) => patch({ limits: { ...l, repairCycles } })}
        step={1}
        min={0}
        max={5}
      />
      <SettingsField legend="NO-PROGRESS LIMIT">
        <Segmented
          name="rps-no-progress"
          choices={NO_PROGRESS_CHOICES}
          value={l.noProgress}
          onChange={(noProgress) => patch({ limits: { ...l, noProgress } })}
        />
      </SettingsField>
    </div>
  );
}

/* ------------------------------------------------ 13 NOTIFICATIONS */

export function SectionNotifications({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  const n = draft.notifications;
  const toggleEvent = (value: string, on: boolean) =>
    patch({
      notifications: {
        ...n,
        events: on ? [...new Set([...n.events, value])] : n.events.filter((e) => e !== value),
      },
    });
  const toggleChannel = (value: string, on: boolean) =>
    patch({
      notifications: {
        ...n,
        channels: on ? [...new Set([...n.channels, value])] : n.channels.filter((c) => c !== value),
      },
    });

  return (
    <div className="rps-section-body">
      <SettingsField legend="NOTIFY WHEN">
        {NOTIFY_EVENT_CHOICES.map((c) => (
          <ToggleRow
            key={c.value}
            label={c.label}
            checked={n.events.includes(c.value)}
            onChange={(on) => toggleEvent(c.value, on)}
          />
        ))}
      </SettingsField>
      <SettingsField legend="CHANNELS" hint="No notification is actually delivered from this frontend phase.">
        {NOTIFY_CHANNEL_CHOICES.map((c) => (
          <ToggleRow
            key={c.value}
            label={c.label}
            checked={n.channels.includes(c.value)}
            onChange={(on) => toggleChannel(c.value, on)}
            status={c.status}
            disabled={c.unavailable}
          />
        ))}
      </SettingsField>
    </div>
  );
}
