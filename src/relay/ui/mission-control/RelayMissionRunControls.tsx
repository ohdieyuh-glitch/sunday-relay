import { useCallback, useMemo, useState } from 'react';

import './relay-mission-run-controls.css';

import type { RelayMissionCommandContext } from '../../mission/commands';
import {
  PAUSE_ASSIGNMENT_ONLY_NOTE,
  RESUME_ASSIGNMENT_ONLY_NOTE,
  confirmMissionRunCommand,
  describeRunCommandErrors,
  requestMissionRunCommand,
  resolveMissionRunPrerequisite,
  type MissionRunCommandDeps,
  type MissionRunCommandResult,
} from './mission-pause-resume';
import {
  projectMissionRunControls,
  type MissionRunControl,
  type MissionRunIntent,
} from './mission-run-controls';

/**
 * MISSION RUN CONTROLS — website PAUSE / RESUME.
 *
 * Sits beside the existing STOP and RETRY controls. It does not redesign
 * Mission Operations and it does not own any mission state: every click goes
 * through the validated Mission Command Protocol, and the resulting status
 * comes back from the atomic executor.
 *
 * This component NEVER:
 *   - mutates mission state directly,
 *   - fabricates a pause or a resume,
 *   - skips a checkpoint, a revision check, or a permission check,
 *   - renders a clickable control the domain would refuse.
 *
 * A control the user cannot use is hidden, or disabled with the exact reason
 * attached to it accessibly.
 */

export interface RelayMissionRunControlsProps {
  deps: MissionRunCommandDeps;
  /** False when this actor may not issue mission commands here. */
  canIssueCommands?: boolean;
  /** Milestone 3 capsule status by runId, when the surface has it. */
  capsuleStatuses?: Readonly<Record<string, string>>;
  /** Show the Milestone 2 command preview before executing. Default true. */
  confirmBeforeExecute?: boolean;
  /** Called after every applied command so the host can refresh its view. */
  onContextChanged?: (context: RelayMissionCommandContext) => void;
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'result'; result: MissionRunCommandResult };

export function RelayMissionRunControls({
  deps,
  canIssueCommands = true,
  capsuleStatuses,
  confirmBeforeExecute = true,
  onContextChanged,
}: RelayMissionRunControlsProps) {
  const [pending, setPending] = useState<MissionRunIntent | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  /** Bumped after every applied command so the projection re-reads context. */
  const [revision, setRevision] = useState(0);

  const context = useMemo(
    () => deps.contextStore.get(deps.missionId),
    // `revision` is the refresh signal — the store is mutable by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps, deps.missionId, revision],
  );

  const controls = useMemo(
    () =>
      context
        ? projectMissionRunControls({
          context,
          pending,
          canIssueCommands,
          ...(capsuleStatuses ? { capsuleStatuses } : {}),
        })
        : null,
    [context, pending, canIssueCommands, capsuleStatuses],
  );

  const settle = useCallback((result: MissionRunCommandResult) => {
    setOutcome({ kind: 'result', result });
    if (result.kind === 'executed') {
      setPending(null);
      setRevision((r) => r + 1);
      const next = deps.contextStore.get(deps.missionId);
      if (next && onContextChanged) onContextChanged(next);
      return;
    }
    // Anything still in flight keeps its pending lock; everything else clears.
    if (result.kind !== 'checkpoint_required' && result.kind !== 'confirmation_required') {
      setPending(null);
    }
  }, [deps, onContextChanged]);

  const start = useCallback((intent: MissionRunIntent) => {
    if (pending !== null) return;             // duplicate submission guard
    setPending(intent);
    settle(requestMissionRunCommand(intent, deps, {
      stopForConfirmation: confirmBeforeExecute,
    }));
  }, [pending, deps, confirmBeforeExecute, settle]);

  const confirm = useCallback((intent: MissionRunIntent, commandId: string) => {
    const current = outcome.kind === 'result' ? outcome.result : null;
    if (!current || !('preview' in current) || !current.preview) return;
    settle(confirmMissionRunCommand({ intent, commandId, preview: current.preview }, deps));
  }, [outcome, deps, settle]);

  const satisfyCheckpoint = useCallback((prerequisiteId: string) => {
    const current = outcome.kind === 'result' ? outcome.result : null;
    if (!current || current.kind !== 'checkpoint_required') return;
    settle(resolveMissionRunPrerequisite({
      intent: current.intent,
      commandId: current.command.commandId,
      prerequisiteId,
      outcome: 'satisfied',
      preview: current.preview,
    }, deps));
  }, [outcome, deps, settle]);

  const cancelFlow = useCallback(() => {
    setPending(null);
    setOutcome({ kind: 'idle' });
  }, []);

  if (!controls) return null;

  const result = outcome.kind === 'result' ? outcome.result : null;

  return (
    <div className="rmrc" aria-label="Mission run controls">
      <div className="rmrc-buttons">
        <RunButton control={controls.pause} onActivate={() => start('pause')} />
        <RunButton control={controls.resume} onActivate={() => start('resume')} />
      </div>

      {result?.kind === 'confirmation_required' && (
        <CommandPreviewPanel
          intent={result.intent}
          preview={result.preview}
          onConfirm={() => confirm(result.intent, result.command.commandId)}
          onCancel={cancelFlow}
        />
      )}

      {result?.kind === 'checkpoint_required' && (
        <div className="rmrc-panel rmrc-panel--checkpoint" role="status">
          <p className="rmrc-panel-title">CHECKPOINT REQUIRED</p>
          <p className="rmrc-panel-note">
            Recoverable work exists. Relay will not change the mission until it is captured.
          </p>
          <ul className="rmrc-checkpoints">
            {result.prerequisites.map((prerequisite) => (
              <li key={prerequisite.prerequisiteId}>
                <span className="rmrc-checkpoint-target">
                  {'taskId' in prerequisite && prerequisite.taskId
                    ? `${prerequisite.taskId}`
                    : prerequisite.prerequisiteId}
                </span>
                <button
                  type="button"
                  className="rmrc-btn rmrc-btn--primary"
                  onClick={() => satisfyCheckpoint(prerequisite.prerequisiteId)}
                >
                  Capture checkpoint
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="rmrc-btn" onClick={cancelFlow}>Cancel</button>
        </div>
      )}

      {result?.kind === 'executed' && (
        <p className="rmrc-note rmrc-note--done" role="status">
          {result.intent === 'pause' ? PAUSE_ASSIGNMENT_ONLY_NOTE : RESUME_ASSIGNMENT_ONLY_NOTE}
        </p>
      )}

      {result?.kind === 'rejected' && (
        <p className="rmrc-note rmrc-note--error" role="alert">
          {describeRunCommandErrors(result.errors)}
        </p>
      )}

      {result?.kind === 'unavailable' && (
        <p className="rmrc-note rmrc-note--error" role="alert">{result.reason}</p>
      )}

      {result?.kind === 'clarification_required' && (
        <p className="rmrc-note rmrc-note--error" role="alert">
          {result.reason}
          {result.missingInformation.length > 0
            ? ` — needs: ${result.missingInformation.join(', ')}`
            : ''}
        </p>
      )}
    </div>
  );
}

/** One control. Hidden when it does not apply; disabled with an exact,
 *  accessible reason when it applies but cannot be used right now. */
function RunButton({
  control,
  onActivate,
}: {
  control: MissionRunControl;
  onActivate: () => void;
}) {
  if (!control.visible) return null;
  const label = control.pending ? control.pendingLabel : control.label;
  const reasonId = control.disabledReason ? `rmrc-reason-${control.intent}` : undefined;
  return (
    <span className="rmrc-control">
      <button
        type="button"
        className={`rmrc-btn rmrc-btn--${control.intent}`}
        onClick={onActivate}
        disabled={!control.enabled}
        aria-disabled={!control.enabled}
        aria-busy={control.pending}
        {...(reasonId ? { 'aria-describedby': reasonId } : {})}
      >
        {label}
      </button>
      {control.disabledReason && (
        <span className="rmrc-reason" id={reasonId}>{control.disabledReason}</span>
      )}
    </span>
  );
}

/**
 * The Milestone 2 Command Preview, rendered from the projection's own typed
 * data. No independently authored "Relay will…" text lives here — the domain
 * owns those sentences.
 */
function CommandPreviewPanel({
  intent,
  preview,
  onConfirm,
  onCancel,
}: {
  intent: MissionRunIntent;
  preview: { relayWill: string[]; relayWillNot: string[]; risk: string; interpretation: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rmrc-panel" aria-label={`${intent} command preview`}>
      <p className="rmrc-panel-title">CONFIRM {intent.toUpperCase()}</p>
      <p className="rmrc-panel-note">{preview.interpretation}</p>
      <div className="rmrc-will">
        <section>
          <h4>RELAY WILL</h4>
          <ul>{preview.relayWill.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
        <section>
          <h4>RELAY WILL NOT</h4>
          <ul>{preview.relayWillNot.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
      </div>
      <p className="rmrc-panel-note">Risk: {preview.risk}</p>
      <div className="rmrc-actions">
        <button type="button" className="rmrc-btn rmrc-btn--primary" onClick={onConfirm}>
          Confirm {intent}
        </button>
        <button type="button" className="rmrc-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
