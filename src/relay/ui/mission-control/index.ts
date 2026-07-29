/**
 * SUNDAY RELAY — WEBSITE MISSION RUN CONTROLS (PAUSE / RESUME).
 *
 * Functional parity with the CLI's `/pause` and `/resume`. Both surfaces reach
 * the same capability; the website goes through the validated Mission Command
 * Protocol (Milestone 2) exactly as every other website mission command does.
 */

export {
  RelayMissionRunControls,
  type RelayMissionRunControlsProps,
} from './RelayMissionRunControls';

export {
  projectMissionRunControls,
  pausableTasks,
  resumableTasks,
  latestRunForTask,
  isTerminalRunState,
  missionIsTerminal,
  type MissionRunControl,
  type MissionRunControls,
  type MissionRunIntent,
  type MissionRunPending,
} from './mission-run-controls';

export {
  requestMissionRunCommand,
  confirmMissionRunCommand,
  resolveMissionRunPrerequisite,
  missionRunCommandText,
  describeRunCommandErrors,
  PAUSE_ASSIGNMENT_ONLY_NOTE,
  RESUME_ASSIGNMENT_ONLY_NOTE,
  type MissionRunCommandDeps,
  type MissionRunCommandResult,
} from './mission-pause-resume';
