import type { RecoveryAssessment } from '../../mission/durable';
import './relay-recovery.css';

/**
 * THE MISSION RECOVERY SURFACE — compact, truthful, and offered only when an
 * incomplete mission was actually discovered.
 *
 * It states what Relay KNOWS at the last safe checkpoint and nothing more:
 * the checkpoint time, the confirmed stage, the reported files, the test
 * status, the known usage (Unknown stays Unknown), the interruption reason
 * and the recovery classification. Three controls: Resume, Inspect, Stop.
 *
 * RESUME NEVER STARTS PAID EXECUTION HERE. In a build with no runtime
 * attached it restores saved state and says so; the label and the note change
 * together, so the button can never promise a reconnection that is not real.
 */

const CLASSIFICATION_LABEL: Record<string, string> = {
  ready_to_resume: 'READY TO RESUME',
  awaiting_approval: 'AWAITING APPROVAL',
  paused: 'PAUSED',
  execution_connection_lost: 'CONNECTION LOST',
  environment_requires_inspection: 'ENVIRONMENT NEEDS INSPECTION',
  budget_blocked: 'BUDGET BLOCKED',
  record_corrupt: 'RECORD CORRUPT',
  unsupported_record_version: 'UNSUPPORTED RECORD VERSION',
  cannot_resume_safely: 'CANNOT RESUME SAFELY',
  completed: 'COMPLETED',
};

const TEST_STATUS_LABEL: Record<string, string> = {
  passed: 'Passed',
  failed: 'Failed',
  not_run: 'Not run',
  unknown: 'Unknown',
};

export function RelayMissionRecoveryPanel({
  assessment,
  missionName,
  runtimeAvailable,
  inspecting = false,
  onResume,
  onInspect,
  onStop,
}: {
  assessment: RecoveryAssessment;
  missionName: string;
  /** False in the offline build — the panel must not imply a live agent. */
  runtimeAvailable: boolean;
  inspecting?: boolean;
  onResume: () => void;
  onInspect: () => void;
  onStop: () => void;
}) {
  const record = assessment.record;
  const classification = assessment.classification;
  const usageKnown = record?.usage.knownCostMicros ?? null;

  return (
    <section
      className={`rrc${assessment.blocking ? ' rrc--blocked' : ''}`}
      aria-label="Unfinished mission recovery"
      data-relay-recovery-panel="true"
    >
      <header className="rrc-head">
        <h2 className="rrc-title">UNFINISHED MISSION</h2>
        <span className={`rrc-class rrc-class--${classification}`}>
          {CLASSIFICATION_LABEL[classification] ?? classification.toUpperCase()}
        </span>
      </header>

      <p className="rrc-summary">{assessment.summary}</p>

      <dl className="rrc-rows">
        <div className="rrc-row">
          <dt>Mission</dt>
          <dd>{missionName}</dd>
        </div>
        <div className="rrc-row">
          <dt>Last safe checkpoint</dt>
          <dd>{record !== null ? record.checkpointAt : 'Unknown'}</dd>
        </div>
        <div className="rrc-row">
          <dt>Last confirmed stage</dt>
          <dd>{record !== null ? record.stage : 'Unknown'}</dd>
        </div>
        <div className="rrc-row">
          <dt>Files changed</dt>
          <dd>
            {record === null
              ? 'Unknown'
              : record.evidence.filesReportedChanged.length === 0
                ? 'None recorded'
                : `${record.evidence.filesReportedChanged.length} reported`}
          </dd>
        </div>
        <div className="rrc-row">
          <dt>Tests</dt>
          <dd>{record !== null ? TEST_STATUS_LABEL[record.evidence.testStatus] : 'Unknown'}</dd>
        </div>
        <div className="rrc-row">
          <dt>Known usage</dt>
          {/* A cost Relay does not know stays Unknown. It never becomes 0. */}
          <dd>{usageKnown === null ? 'Unknown' : usageKnown}</dd>
        </div>
        <div className="rrc-row">
          <dt>Interruption</dt>
          <dd>{record?.interruptionReason ?? 'Not recorded'}</dd>
        </div>
      </dl>

      {record !== null && record.provenance === 'simulated' && (
        <p className="rrc-provenance" role="note">
          SIMULATED MISSION — DEMO SIMULATION — NOT A LIVE MISSION
        </p>
      )}

      {!runtimeAvailable && (
        <p className="rrc-runtime-note" role="note">
          No runtime is attached. Relay can restore this mission&rsquo;s saved state; it has not
          reconnected an agent, and execution stays unavailable.
        </p>
      )}

      {inspecting && (
        <ul className="rrc-diagnostics" aria-label="Recovery checks">
          {assessment.diagnostics.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <div className="rrc-actions">
        <button
          type="button"
          className="rrc-btn rrc-btn--primary"
          onClick={onResume}
          disabled={!assessment.canResume}
        >
          {runtimeAvailable ? 'RESUME MISSION' : 'RESTORE SAVED STATE'}
        </button>
        <button type="button" className="rrc-btn" onClick={onInspect} aria-expanded={inspecting}>
          INSPECT MISSION
        </button>
        <button type="button" className="rrc-btn rrc-btn--stop" onClick={onStop}>
          STOP MISSION
        </button>
      </div>
    </section>
  );
}
