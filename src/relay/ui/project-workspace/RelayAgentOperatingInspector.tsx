import { useId, useState } from 'react';

import type { RelayAgentOperatingProjection } from '../../mission';

/**
 * SUNDAY RELAY — THE AGENT OPERATING INSPECTOR.
 *
 * Four compact rows on a Relay Dog's panel — Runtime, Mission Contract,
 * Environment, Tools — so an operator can see, without asking, what is
 * performing the work, under which contract, in which workspace, with which
 * tools.
 *
 * IT FORMATS NOTHING. Every string comes from `projection.rows`, the same
 * array the CLI prints, so the two surfaces cannot word the same fact
 * differently. This component chooses layout; the projection chooses truth.
 *
 * DELIBERATELY SMALL. Four rows and an optional detail drawer — not a card
 * grid and not a new navigation system. The fullscreen redesign is a separate
 * piece of work and this is not a down payment on it.
 *
 * NEVER SHOWS A SECRET. There is no secret in the projection to show: the
 * environment reference has no field that can carry a key, a token or the
 * contents of a private variable. The drawer shows the Mission Contract's
 * IDENTITY and mode — never its raw system-level instruction text.
 */
export function RelayAgentOperatingInspector({
  projection,
  defaultOpen = false,
}: {
  projection: RelayAgentOperatingProjection;
  /** Detail starts collapsed; a surface may open it for a focused view. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const detailId = useId();

  return (
    <div
      className="rpw-operating"
      data-role={projection.role}
      data-simulated={projection.simulated ? 'true' : 'false'}
    >
      {/* The disclosure is rendered from the projection's own label, so
          simulated activity can never be presented as live by a surface that
          forgot a flag. */}
      {projection.dataSourceLabel !== null && (
        <p className="rpw-operating-disclosure">{projection.dataSourceLabel}</p>
      )}

      <dl className="rpw-operating-rows">
        {projection.rows.map((row) => (
          <div className="rpw-operating-row" key={row.component}>
            <dt className="rpw-operating-key">{row.label}</dt>
            <dd className="rpw-operating-value">{row.value}</dd>
          </div>
        ))}
      </dl>

      <button
        type="button"
        className="rpw-operating-toggle"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {open ? 'Hide detail' : 'Detail'}
      </button>

      {open && (
        <div className="rpw-operating-detail" id={detailId} role="group" aria-label={`${projection.roleLabel} operating detail`}>
          <p className="rpw-operating-detail-line">
            <span className="rpw-operating-key">Role</span>
            <span className="rpw-operating-value">{projection.roleLabel}</span>
          </p>
          <p className="rpw-operating-detail-line">
            <span className="rpw-operating-key">Execution mode</span>
            <span className="rpw-operating-value">{projection.executionModeLabel}</span>
          </p>
          <p className="rpw-operating-detail-line">
            <span className="rpw-operating-key">Granted tools</span>
            <span className="rpw-operating-value">{projection.toolLabels.length}</span>
          </p>
          <ul className="rpw-operating-tools">
            {projection.toolLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
