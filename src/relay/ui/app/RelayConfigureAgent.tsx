import { useState } from 'react';

import { RelayAgentConfigEditor } from './RelayAgentConfigEditor';
import { loadConfiguredPsp, saveConfiguredPsp } from './configured-psp';

/**
 * A conservative default config a beta Mission runs under until the participant
 * configures the Compound PSP Agent themselves: guided, independent review,
 * bounded spend/compute. Defined HERE — the one place the Configure step and the
 * entry gate both read it — so there is a single source for what "the default
 * Agent" is.
 */
export const DEFAULT_BETA_CONFIG = {
  mode: 'guided', review: 'independent', completionRule: 'strict',
  limits: { agentCalls: 8, runtimeMinutes: 30, spendUsd: 5, reviewCycles: 1, repairCycles: 1 },
} as const;

/**
 * CONFIGURE THE COMPOUND PSP AGENT — the step that comes BEFORE Start Building,
 * before any GitHub. Relay's canonical flow configures the Agent (Prompt
 * Architect / Coding Agent / independent Reviewer / Relay) FIRST; the repository
 * is then connected TO an already-configured Agent, not the other way round.
 *
 * It needs no session and no bridge: the editor is pure, and the working config
 * lives in local state. Its one consequential act is the primary Start Building
 * control, which PERSISTS the configured Agent to `sessionStorage` BEFORE handing
 * off — so it survives the full-document OAuth/install redirect that follows and
 * reaches the Mission unchanged. The persisted value is a REQUEST, never a claim;
 * the bridge remains the authority for what the Mission actually runs under.
 */
export function RelayConfigureAgent({
  defaultConfig = DEFAULT_BETA_CONFIG,
  onStartBuilding,
  primaryLabel = 'Start Building',
  saveImpl = saveConfiguredPsp,
}: {
  /** The seed used when nothing has been configured yet this session. */
  readonly defaultConfig?: unknown;
  /** The participant is done configuring. The SAME completion concept serves two
   *  callers: the FRESH flow (label "Start Building" → advance to GitHub sign-in)
   *  and the RECONFIGURE flow (label "Save Agent" → return to the runner). Both
   *  PERSIST first; only the label and where control returns differ. */
  readonly onStartBuilding: () => void;
  /** The primary control's text. Defaults to the fresh flow's "Start Building". */
  readonly primaryLabel?: string;
  readonly saveImpl?: typeof saveConfiguredPsp;
}) {
  // Rehydrate a configuration already saved this session (e.g. the participant
  // came back to tweak it), otherwise seed from the default Agent.
  const [seed] = useState<unknown>(() => loadConfiguredPsp());
  const [config, setConfig] = useState<unknown>(seed ?? defaultConfig);
  // Truthful seed: a rehydrated (already-configured) Agent must not read as the
  // default. Editing then relabels to "Custom (from …)" via the editor's onChange.
  const [label, setLabel] = useState(seed !== null ? 'Your configured Agent' : 'Default beta configuration');

  const startBuilding = () => {
    // PERSIST FIRST, then hand off: the redirect that sign-in triggers is a full
    // document navigation, so the configured Agent must already be in
    // sessionStorage before we leave — React state will not survive the return.
    saveImpl(config);
    onStartBuilding();
  };

  return (
    <div className="relay-configure-agent" data-state="configure">
      <h1>Configure your Compound PSP Agent</h1>
      <p>
        This is the Agent the repository you connect next will run under: a{' '}
        <strong>Prompt Architect</strong>, a <strong>Coding Agent</strong>, an{' '}
        <strong>independent Reviewer</strong>, and <strong>Relay</strong> orchestrating them. Set
        what the Mission may request and the ceilings it runs under before you connect any GitHub
        repository — this configuration is carried into the Mission unchanged.
      </p>
      <RelayAgentConfigEditor config={config} onChange={(next, nextLabel) => { setConfig(next); setLabel(nextLabel); }} />
      <p className="relay-configure-agent__config">Configured as <strong>{label}</strong>.</p>
      <button type="button" className="relay-configure-agent__start" onClick={startBuilding}>
        {primaryLabel}
      </button>
    </div>
  );
}
