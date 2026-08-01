import { useRef, useState } from 'react';

import { REVIEWER_STATE_LABEL } from './projections';
import { RelayFindingPanel } from './RelayFindingPanel';
import { RelayRepairPanel } from './RelayRepairPanel';
import { RelayReviewerHarnessCatalog } from './RelayReviewerHarnessCatalog';
import type { RepairTask, ReviewFinding, ReviewerStateKind } from './contracts';
import type { ReviewerHarnessCatalogView } from '../../mission/reviewer-harness';

/**
 * Independent Reviewer status. Bounded findings and evidence only — never
 * hidden Reviewer reasoning. When changes are required, the validated
 * findings and their bounded repairs are shown together.
 *
 * THE REVIEWER HARNESS CONTROL lives here rather than in a settings page: the
 * harness is a property of this Reviewer, and this panel is the one surface
 * that is already reachable both in the workspace and in Reviewer fullscreen.
 * It is a single compact line and one real button, so it stays discoverable
 * without competing with the findings it sits beside.
 */
export function RelayReviewerStatus({
  reviewerName,
  state,
  findings,
  repairs,
  harnessCatalog,
  onHarnessUnavailable,
  onOpenFinding,
  onOpenRepair,
}: {
  reviewerName: string;
  state: ReviewerStateKind;
  findings: ReviewFinding[];
  repairs: RepairTask[];
  /** The canonical catalog projection. Absent = the surface knows nothing. */
  harnessCatalog?: ReviewerHarnessCatalogView;
  onHarnessUnavailable?: (harnessName: string) => void;
  onOpenFinding: (findingId: string) => void;
  onOpenRepair: (repairId: string) => void;
}) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

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

      {harnessCatalog !== undefined && (
        <div className="rpw-reviewer-harness">
          {/* The connection fact, before the control that explains it. */}
          <p className="rpw-reviewer-harness-state">{harnessCatalog.statusLabel}</p>
          <button
            type="button"
            ref={triggerRef}
            className="rpw-reviewer-harness-btn"
            aria-haspopup="dialog"
            aria-expanded={catalogOpen}
            onClick={() => setCatalogOpen(true)}
          >
            Reviewer Harness
          </button>
        </div>
      )}

      {findings.length > 0 && (
        <RelayFindingPanel findings={findings} onOpenFinding={onOpenFinding} />
      )}
      {repairs.length > 0 && <RelayRepairPanel repairs={repairs} onOpenRepair={onOpenRepair} />}
      <p className="rpw-reviewer-note">
        Findings show bounded evidence only. Reviewer reasoning is never exposed.
      </p>

      {harnessCatalog !== undefined && (
        <RelayReviewerHarnessCatalog
          open={catalogOpen}
          view={harnessCatalog}
          onClose={() => setCatalogOpen(false)}
          returnFocusTo={triggerRef.current}
          onInspectUnavailable={onHarnessUnavailable}
        />
      )}
    </section>
  );
}
