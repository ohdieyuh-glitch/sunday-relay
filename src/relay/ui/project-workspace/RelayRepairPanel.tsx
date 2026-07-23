import type { RepairTask } from './contracts';

/** Bounded repairs — ID, finding link, assignee, authorized files, status. */
export function RelayRepairPanel({
  repairs,
  onOpenRepair,
}: {
  repairs: RepairTask[];
  onOpenRepair: (repairId: string) => void;
}) {
  return (
    <ul className="rpw-repairs" aria-label="Repairs">
      {repairs.map((r) => (
        <li key={r.repairId} className={`rpw-repair rpw-repair--${r.status}`}>
          <div className="rpw-repair-head">
            <span className="rpw-repair-id">
              REPAIR / {r.repairId} → {r.findingId}
            </span>
            <span className="rpw-repair-status">{r.status.replace(/_/g, ' ').toUpperCase()}</span>
            <span className={`rpw-repair-verify rpw-repair-verify--${r.verification}`}>
              VERIFICATION {r.verification.toUpperCase()}
            </span>
          </div>
          <p className="rpw-repair-meta">
            Assigned to {r.assignedTo} · authorized files: {r.authorizedFiles.join(', ')}
          </p>
          <button type="button" className="rpw-btn rpw-btn--ghost" onClick={() => onOpenRepair(r.repairId)}>
            OPEN REPAIR
          </button>
        </li>
      ))}
    </ul>
  );
}
