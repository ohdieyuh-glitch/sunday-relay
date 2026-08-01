import { useId, useState } from 'react';

import type { RelayAgentOperatingProjection } from '../../mission';
import type { MissionWorktreeView } from '../../mission/worktree';
import type { CodingAgentView } from '../../mission/coding-agent';
import type { PromptArchitectView } from '../../mission/prompt-architect';

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
 *
 * THE WORKTREE LINE is a property of the Environment, not a fifth row: it is
 * rendered beneath the four rows from the SAME projection the CLI prints,
 * and it says `Not available in offline demo` in the static deployment
 * rather than naming a local path that does not exist there.
 */
export function RelayAgentOperatingInspector({
  projection,
  worktree,
  runtime,
  architect,
  defaultOpen = false,
}: {
  projection: RelayAgentOperatingProjection;
  /** Optional isolated-worktree state. Absent = the surface knows nothing. */
  worktree?: MissionWorktreeView;
  /** Optional Coding Agent runtime state (Claude Code). Absent = unknown. */
  runtime?: CodingAgentView;
  /** Optional Prompt Architect runtime state (GPT). Absent = unknown. */
  architect?: PromptArchitectView;
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

      {worktree !== undefined && (
        <p
          className={`rpw-operating-worktree${worktree.blocking ? ' rpw-operating-worktree--blocked' : ''}`}
          data-worktree-state={worktree.state ?? 'none'}
        >
          <span className="rpw-operating-key">Isolated worktree</span>
          <span className="rpw-operating-value">{worktree.summary}</span>
          {worktree.present && (
            <span className="rpw-operating-worktree-detail">
              {worktree.missionBranch} · {worktree.cleanLabel} · {worktree.pathLabel}
            </span>
          )}
          {worktree.disclosure !== null && (
            <span className="rpw-operating-disclosure">{worktree.disclosure}</span>
          )}
        </p>
      )}

      {runtime !== undefined && (
        <p
          className={`rpw-operating-runtime${runtime.blocking ? ' rpw-operating-runtime--blocked' : ''}`}
          data-connection-state={runtime.connectionState}
        >
          <span className="rpw-operating-key">Coding Agent runtime</span>
          <span className="rpw-operating-value">{runtime.summary}</span>
          <span className="rpw-operating-runtime-detail">
            {`Version ${runtime.versionLabel} · Model ${runtime.modelLabel} · Usage ${runtime.usageLabel}`}
          </span>
          <span className="rpw-operating-runtime-detail">{runtime.outcomeLabel}</span>
          {runtime.disclosure !== null && (
            <span className="rpw-operating-disclosure">{runtime.disclosure}</span>
          )}
        </p>
      )}

      {architect !== undefined && (
        <p
          className={`rpw-operating-runtime${architect.blocking ? ' rpw-operating-runtime--blocked' : ''}`}
          data-architect-state={architect.connectionState}
        >
          <span className="rpw-operating-key">Prompt Architect runtime</span>
          <span className="rpw-operating-value">{architect.summary}</span>
          <span className="rpw-operating-runtime-detail">
            {`Requested ${architect.requestedModelLabel} · Actual ${architect.actualModelLabel} · Usage ${architect.usageLabel} · Cost ${architect.costLabel}`}
          </span>
          <span className="rpw-operating-runtime-detail">{architect.outcomeLabel}</span>
          {architect.disclosure !== null && (
            <span className="rpw-operating-disclosure">{architect.disclosure}</span>
          )}
        </p>
      )}

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
