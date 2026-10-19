import { useState } from 'react';
import {
  BRAIN_UPDATE_CHOICES,
  DEPLOYMENT_TARGET_CHOICES,
  DEVICE_PRIORITY_CHOICES,
  MEMORY_SOURCE_CHOICES,
  PLATFORM_CHOICES,
  PROJECT_TYPE_CHOICES,
  RESEARCH_MODE_CHOICES,
  RESEARCH_TOPIC_CHOICES,
  SOURCE_CHOICES,
  SOURCE_POLICY_CHOICES,
  STAGE_CHOICES,
  STALE_CHECK_CHOICES,
  TECH_CATEGORIES,
} from './options';
import { suggestProjectNames } from './defaults';
import { Chips, RadioPlates, SettingsField, Segmented } from './SettingsControls';
import type { ProjectBriefDraft } from '../entry-home/contracts';
import type { ProjectSettingsDraft, RelayModeChoice } from './contracts';

/**
 * Sections 01–04 and 06–08 of the click-first Project Settings. Normal
 * configuration never requires typing: the ONLY freeform inputs live behind
 * the explicit CUSTOM NAME action (typing policy case 1) and CONNECT
 * REPOSITORY defers to the focused repository callback (case 3).
 */

type Patch = (patch: Partial<ProjectSettingsDraft>) => void;

/* ------------------------------------------------------- 01 PROJECT */

export function SectionProject({
  draft,
  brief,
  patch,
  onConnectRepository,
}: {
  draft: ProjectSettingsDraft;
  brief: ProjectBriefDraft | null;
  patch: Patch;
  onConnectRepository: () => void;
}) {
  const [showAllNames, setShowAllNames] = useState(false);
  const [customName, setCustomName] = useState(false);
  const suggestions = suggestProjectNames(brief);
  const shown = showAllNames ? suggestions : suggestions.slice(0, 3);

  return (
    <div className="rps-section-body">
      {brief && (
        <div className="rps-brief-summary" aria-label="Project brief">
          <span className="rps-key">PROJECT BRIEF</span>
          <p className="rps-brief-line">{brief.problem || brief.workingTitle}</p>
          <p className="rps-brief-meta">
            {brief.projectType || 'General build'} · {brief.existingProject ? 'EXISTING PROJECT' : 'NEW PROJECT'}
          </p>
        </div>
      )}

      <SettingsField legend="PROJECT NAME" hint="Pick a generated name — or press CUSTOM NAME to type one.">
        <div className="rps-plates rps-plates--compact" role="presentation">
          {shown.map((name) => (
            <label key={name} className={`rps-plate${draft.projectName === name && !customName ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="rps-project-name"
                value={name}
                checked={draft.projectName === name && !customName}
                onChange={() => {
                  setCustomName(false);
                  patch({ projectName: name });
                }}
              />
              <span className="rps-plate-label">{name}</span>
            </label>
          ))}
        </div>
        <div className="rps-inline-actions">
          {!showAllNames && suggestions.length > 3 && (
            <button type="button" className="rps-mini-btn" onClick={() => setShowAllNames(true)}>
              GENERATE MORE
            </button>
          )}
          <button
            type="button"
            className="rps-mini-btn"
            aria-expanded={customName}
            onClick={() => setCustomName((v) => !v)}
          >
            CUSTOM NAME
          </button>
        </div>
        {customName && (
          <div className="rps-custom-input">
            <label className="rps-key" htmlFor="rps-custom-name">
              CUSTOM PROJECT NAME
            </label>
            <input
              id="rps-custom-name"
              type="text"
              value={draft.projectName ?? ''}
              onChange={(e) => patch({ projectName: e.target.value })}
            />
          </div>
        )}
      </SettingsField>

      <SettingsField legend="PROJECT STAGE">
        <Segmented
          name="rps-stage"
          choices={STAGE_CHOICES}
          value={draft.stage}
          onChange={(stage) => patch({ stage })}
        />
      </SettingsField>

      <SettingsField legend="PROJECT SOURCE">
        <RadioPlates
          name="rps-source"
          choices={SOURCE_CHOICES}
          value={draft.source}
          onChange={(source) => {
            patch({ source });
            if (source === 'connect_repository') onConnectRepository();
          }}
          compact
        />
        {draft.source === 'connect_repository' && (
          <div className="rps-inline-actions">
            <button type="button" className="rps-mini-btn" onClick={onConnectRepository}>
              OPEN REPOSITORY CONNECTION
            </button>
          </div>
        )}
      </SettingsField>
    </div>
  );
}

/* -------------------------------------------------- 02 PROJECT TYPE */

export function SectionProjectType({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  return (
    <div className="rps-section-body">
      <SettingsField
        legend="PROJECT TYPE"
        hint="Select every type that applies — Relay tunes the workforce and evidence to the combination."
      >
        <Chips
          choices={PROJECT_TYPE_CHOICES}
          values={draft.projectTypes}
          onToggle={(v) =>
            patch({
              projectTypes: draft.projectTypes.includes(v as never)
                ? draft.projectTypes.filter((t) => t !== v)
                : [...draft.projectTypes, v as (typeof draft.projectTypes)[number]],
            })
          }
        />
      </SettingsField>
      <p className="rps-recommend-note">
        RELAY RECOMMENDS — {draft.projectTypes.includes('security_system')
          ? 'a Guided mode and independent review for security work.'
          : 'starting from the type your Project Brief implies; you can widen it later.'}
      </p>
    </div>
  );
}

/* ------------------------------------------------------ 03 PLATFORM */

export function SectionPlatform({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  return (
    <div className="rps-section-body">
      <SettingsField legend="TARGET PLATFORM">
        <Chips
          choices={PLATFORM_CHOICES}
          values={draft.platforms}
          onToggle={(v) =>
            patch({
              platforms: draft.platforms.includes(v as never)
                ? draft.platforms.filter((p) => p !== v)
                : [...draft.platforms, v as (typeof draft.platforms)[number]],
            })
          }
        />
      </SettingsField>
      <SettingsField legend="DEVICE PRIORITY">
        <Segmented
          name="rps-device"
          choices={DEVICE_PRIORITY_CHOICES}
          value={draft.devicePriority}
          onChange={(devicePriority) => patch({ devicePriority })}
        />
      </SettingsField>
      <SettingsField legend="DEPLOYMENT TARGET">
        <RadioPlates
          name="rps-deploy-target"
          choices={DEPLOYMENT_TARGET_CHOICES}
          value={draft.deploymentTarget}
          onChange={(deploymentTarget) => patch({ deploymentTarget })}
          compact
        />
      </SettingsField>
    </div>
  );
}

/* ---------------------------------------------------- 04 TECHNOLOGY */

export function SectionTechnology({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  return (
    <div className="rps-section-body">
      {TECH_CATEGORIES.map((cat) => (
        <SettingsField key={cat.key} legend={cat.label}>
          <RadioPlates
            name={`rps-tech-${cat.key}`}
            choices={cat.choices}
            value={draft.technology[cat.key]}
            onChange={(v) => patch({ technology: { ...draft.technology, [cat.key]: v } })}
            compact
          />
        </SettingsField>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- 06 MODE */

const MODE_CHOICES: Array<{ value: RelayModeChoice; label: string }> = [
  { value: 'guided', label: 'GUIDED' },
  { value: 'semi', label: 'SEMI' },
  { value: 'autonomous', label: 'AUTONOMOUS' },
];

const MODE_DESCRIPTION: Record<RelayModeChoice, string> = {
  guided: 'Relay performs routine work and asks before meaningful decisions.',
  semi: 'Relay performs more routine work independently but stops before high-impact actions.',
  autonomous:
    'Relay continues inside explicitly approved tools, access, spending, time, and safety limits.',
};

export function SectionMode({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  return (
    <div className="rps-section-body">
      <SettingsField legend="RELAY MODE">
        <Segmented
          name="rps-mode"
          choices={MODE_CHOICES}
          value={draft.mode}
          onChange={(mode) => patch({ mode })}
        />
        <p className="rps-mode-desc">{MODE_DESCRIPTION[draft.mode]}</p>
      </SettingsField>
      <div className="rps-inline-actions" aria-label="Permission presets">
        <button
          type="button"
          className="rps-mini-btn"
          onClick={() =>
            patch({
              permissions: {
                dependencies: 'ask_first',
                commands: 'tests_only',
                network: 'blocked',
                deployment: 'blocked',
                destructive: 'blocked',
              },
            })
          }
        >
          PRESET: CAREFUL
        </button>
        <button
          type="button"
          className="rps-mini-btn"
          onClick={() =>
            patch({
              permissions: {
                dependencies: 'ask_first',
                commands: 'safe_dev',
                network: 'blocked',
                deployment: 'blocked',
                destructive: 'blocked',
              },
            })
          }
        >
          PRESET: STANDARD
        </button>
        <button
          type="button"
          className="rps-mini-btn"
          onClick={() =>
            patch({
              permissions: {
                dependencies: 'approved_scope',
                commands: 'safe_dev',
                network: 'research_only',
                deployment: 'preview_only',
                destructive: 'blocked',
              },
            })
          }
        >
          PRESET: BUILDER
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- 07 RESEARCH */

export function SectionResearch({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  const r = draft.research;
  return (
    <div className="rps-section-body">
      <SettingsField legend="PROJECT RESEARCH">
        <Segmented
          name="rps-research-mode"
          choices={RESEARCH_MODE_CHOICES}
          value={r.mode}
          onChange={(mode) => patch({ research: { ...r, mode } })}
        />
      </SettingsField>
      {r.mode !== 'off' && (
        <>
          <SettingsField legend="RESEARCH TOPICS">
            <Chips
              choices={RESEARCH_TOPIC_CHOICES}
              values={r.topics}
              onToggle={(v) =>
                patch({
                  research: {
                    ...r,
                    topics: r.topics.includes(v) ? r.topics.filter((t) => t !== v) : [...r.topics, v],
                  },
                })
              }
            />
          </SettingsField>
          <SettingsField legend="SOURCE POLICY">
            <RadioPlates
              name="rps-source-policy"
              choices={SOURCE_POLICY_CHOICES}
              value={r.sourcePolicy}
              onChange={(sourcePolicy) => patch({ research: { ...r, sourcePolicy } })}
              compact
            />
          </SettingsField>
          <SettingsField legend="PROJECT BRAIN UPDATE">
            <RadioPlates
              name="rps-brain-update"
              choices={BRAIN_UPDATE_CHOICES}
              value={r.brainUpdate}
              onChange={(brainUpdate) => patch({ research: { ...r, brainUpdate } })}
              compact
            />
          </SettingsField>
          <SettingsField legend="STALE INFORMATION">
            <RadioPlates
              name="rps-stale"
              choices={STALE_CHECK_CHOICES}
              value={r.staleCheck}
              onChange={(staleCheck) => patch({ research: { ...r, staleCheck } })}
              compact
            />
          </SettingsField>
        </>
      )}
      <p className="rps-hint">No research runs from this screen — configuration only.</p>
    </div>
  );
}

/* ------------------------------------------------ 08 PROJECT MEMORY */

export function SectionMemory({ draft, patch }: { draft: ProjectSettingsDraft; patch: Patch }) {
  return (
    <div className="rps-section-body">
      <SettingsField legend="PROJECT MEMORY" hint="Sources Relay may draw project knowledge from.">
        <Chips
          choices={MEMORY_SOURCE_CHOICES}
          values={draft.memorySources}
          onToggle={(v) =>
            patch({
              memorySources: draft.memorySources.includes(v as never)
                ? draft.memorySources.filter((m) => m !== v)
                : [...draft.memorySources, v as (typeof draft.memorySources)[number]],
            })
          }
          statuses={Object.fromEntries(MEMORY_SOURCE_CHOICES.map((c) => [c.value, c.status]))}
        />
      </SettingsField>
    </div>
  );
}
