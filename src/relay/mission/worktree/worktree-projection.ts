import {
  BLOCKING_WORKTREE_STATES,
  USABLE_WORKTREE_STATES,
  type MissionWorktreeRecord,
  type MissionWorktreeState,
} from './worktree-contracts';

/**
 * THE ONE WORKTREE PROJECTION — rendered identically by the website's Coding
 * Agent Environment inspector and by `relay mission worktree status`. Every
 * string an operator reads is worded here exactly once, so the two surfaces
 * cannot drift and neither can invent a phrase.
 *
 * Three truths this enforces:
 *   - a path is ABBREVIATED before display; the founder's home directory
 *     never reaches a surface;
 *   - "no worktree" and "worktree unavailable" are different sentences, and
 *     neither is ever rendered as an invented path;
 *   - a simulated worktree says so.
 */

export const WORKTREE_STATE_LABEL: Readonly<Record<MissionWorktreeState, string>> = Object.freeze({
  proposed: 'Proposed',
  creating: 'Creating',
  ready: 'Ready',
  active: 'Active',
  paused: 'Paused',
  requires_inspection: 'Requires inspection',
  conflicted: 'Conflicted',
  missing: 'Missing',
  archived: 'Archived',
  cleanup_ready: 'Cleanup ready',
  cleanup_blocked: 'Cleanup blocked',
  removed: 'Removed',
});

/** Shown when Relay genuinely has no worktree for this mission. */
export const NO_WORKTREE_LABEL = 'No isolated worktree';
/** Shown when Relay cannot reach the Node side to answer at all. */
export const WORKTREE_UNAVAILABLE_LABEL = 'Worktree unavailable';
/** Shown by the static browser deployment, which has no Node bridge. */
export const WORKTREE_OFFLINE_LABEL = 'Not available in offline demo';
export const WORKTREE_SIMULATED_LABEL =
  'SIMULATED WORKTREE — DEMO SIMULATION — NO LOCAL WORKTREE WAS CREATED';

export interface MissionWorktreeView {
  /** Present only when a validated record exists. */
  readonly present: boolean;
  /** One compact line for the Environment row, e.g.
      `Isolated worktree · Ready` or `Not available in offline demo`. */
  readonly summary: string;
  readonly state: MissionWorktreeState | null;
  readonly stateLabel: string;
  readonly repository: string | null;
  readonly missionBranch: string | null;
  readonly baseCommit: string | null;
  readonly head: string | null;
  /** Abbreviated — never the full home-directory path. */
  readonly pathLabel: string | null;
  /** The complete path, for the explicit detail view only. */
  readonly fullPath: string | null;
  readonly cleanLabel: string;
  readonly validatedLabel: string;
  readonly cleanupLabel: string;
  readonly cleanupBlockers: readonly string[];
  readonly blocking: boolean;
  readonly usable: boolean;
  readonly simulated: boolean;
  /** Non-droppable disclosure; `null` only for a genuine live worktree. */
  readonly disclosure: string | null;
}

export interface WorktreeProjectionOptions {
  /** True in the static browser deployment: no Node bridge is connected, so
      Relay cannot know anything about a local worktree. */
  readonly offline?: boolean;
  /** True when the figures come from Demo Simulation. */
  readonly simulated?: boolean;
}

/** Abbreviate an absolute path for display: keep the last three segments and
    never reveal the home directory above them. */
export function abbreviateWorktreePath(path: string): string {
  const parts = path.split('/').filter((p) => p.length > 0);
  if (parts.length <= 3) return `…/${parts.join('/')}`;
  return `…/${parts.slice(-3).join('/')}`;
}

const shortSha = (sha: string): string => sha.slice(0, 12);

const empty = (summary: string, options: WorktreeProjectionOptions): MissionWorktreeView => ({
  present: false,
  summary,
  state: null,
  stateLabel: summary,
  repository: null,
  missionBranch: null,
  baseCommit: null,
  head: null,
  pathLabel: null,
  fullPath: null,
  cleanLabel: 'Unknown',
  validatedLabel: 'Never validated',
  cleanupLabel: 'Not applicable',
  cleanupBlockers: [],
  blocking: false,
  usable: false,
  simulated: options.simulated === true,
  disclosure: options.simulated === true ? WORKTREE_SIMULATED_LABEL : null,
});

/**
 * Project a stored record (or its absence) into the one view both surfaces
 * render. `record === null` with `offline` produces the offline sentence,
 * never a fabricated worktree.
 */
export function projectMissionWorktree(
  record: MissionWorktreeRecord | null,
  options: WorktreeProjectionOptions = {},
): MissionWorktreeView {
  if (record === null) {
    if (options.offline === true) return empty(WORKTREE_OFFLINE_LABEL, options);
    return empty(NO_WORKTREE_LABEL, options);
  }

  const simulated = options.simulated === true || record.provenance === 'simulated';
  const blocking = BLOCKING_WORKTREE_STATES.includes(record.state);
  const usable = USABLE_WORKTREE_STATES.includes(record.state) && !blocking;
  const stateLabel = WORKTREE_STATE_LABEL[record.state];

  return {
    present: true,
    summary: `Isolated worktree · ${stateLabel}`,
    state: record.state,
    stateLabel,
    repository: record.repositoryName,
    missionBranch: record.missionBranch,
    baseCommit: shortSha(record.baseCommit),
    head: record.actualHead === null ? null : shortSha(record.actualHead),
    pathLabel: abbreviateWorktreePath(record.worktreePath),
    fullPath: record.worktreePath,
    // `null` means Relay has not looked — which is not the same as clean.
    cleanLabel: record.dirty === null ? 'Unknown' : record.dirty ? 'Dirty' : 'Clean',
    validatedLabel: record.lastValidatedAt ?? 'Never validated',
    cleanupLabel: record.cleanupEligible
      ? 'Eligible'
      : record.cleanupBlockers.length > 0
        ? 'Blocked'
        : 'Not eligible',
    cleanupBlockers: record.cleanupBlockers,
    blocking,
    usable,
    simulated,
    disclosure: simulated ? WORKTREE_SIMULATED_LABEL : null,
  };
}

/** The lines `relay mission worktree status` prints. Derived from the SAME
    view the website renders, so the surfaces provably agree. */
export function renderWorktreeStatusLines(
  missionId: string,
  view: MissionWorktreeView,
): string[] {
  const lines: string[] = [`MISSION WORKTREE — ${missionId}`];
  if (view.disclosure !== null) lines.push(view.disclosure);
  if (!view.present) {
    lines.push(`  State:        ${view.summary}`);
    return lines;
  }
  lines.push(`  Repository:   ${view.repository ?? 'Unknown'}`);
  lines.push(`  Branch:       ${view.missionBranch ?? 'Unknown'}`);
  lines.push(`  Path:         ${view.pathLabel ?? 'Unknown'}`);
  lines.push(`  State:        ${view.stateLabel}`);
  lines.push(`  Base commit:  ${view.baseCommit ?? 'Unknown'}`);
  lines.push(`  HEAD:         ${view.head ?? 'Unknown'}`);
  lines.push(`  Working tree: ${view.cleanLabel}`);
  lines.push(`  Validated:    ${view.validatedLabel}`);
  lines.push(`  Cleanup:      ${view.cleanupLabel}`);
  for (const blocker of view.cleanupBlockers) lines.push(`    blocked by: ${blocker}`);
  return lines;
}
