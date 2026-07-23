import { REVIEWER_STATE_LABEL } from './projections';
import { RelayFindingPanel } from './RelayFindingPanel';
import { RelayRepairPanel } from './RelayRepairPanel';
import type { RepairTask, ReviewFinding, ReviewerStateKind } from './contracts';

/**
 * Independent Reviewer status. Bounded findings and evidence only — never
 * hidden Reviewer reasoning. When changes are required, the validated
 * findings and their bounded repairs are shown together.
 */
export function RelayReviewerStatus({
  reviewerName,
  state,
  findings,
  repairs,
  onOpenFinding,
  onOpenRepair,
}: {
  reviewerName: string;
  state: ReviewerStateKind;
  findings: ReviewFinding[];
  repairs: RepairTask[];
  onOpenFinding: (findingId: string) => void;
  onOpenRepair: (repairId: string) => void;
}) {
  return (
    <section className="rpw-reviewer" aria-labelledby="rpw-reviewer-heading">
      <div className="rpw-panel-head">
        <h2 id="rpw-reviewer-heading" className="rpw-section-title">
          INDEPENDENT REVIEW
        </h2>
        <span className={`rpw-reviewer-state rpw-reviewer-state--${state}`}>
          {REVIEWER_STATE_LABEL[state]}
        </span>
      </div>
      <p className="rpw-reviewer-name">
        {reviewerName}
        {state === 'reviewing' && ' — read-only access to the held output.'}
        {state === 'approved' && ' — approved the held output.'}
      </p>

      {findings.length > 0 && (
        <RelayFindingPanel findings={findings} onOpenFinding={onOpenFinding} />
      )}
      {repairs.length > 0 && <RelayRepairPanel repairs={repairs} onOpenRepair={onOpenRepair} />}
      <p className="rpw-reviewer-note">
        Findings show bounded evidence only. Reviewer reasoning is never exposed.
      </p>
    </section>
  );
}
