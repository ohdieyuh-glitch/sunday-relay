/**
 * SUNDAY RELAY — LOOP SURFACE (barrel).
 *
 * The graphical half of the ONE Loop grammar. Every component here consumes
 * the shared domain projection the CLI already renders; none of them
 * interprets a command, resolves a role, or decides availability.
 */

export { RelayLoopComposer } from './RelayLoopComposer';
export {
  RelayLoopSurfaceHost,
  type RelayLoopSurface,
  type RelayLoopSurfaceState,
} from './RelayLoopSurface';
export { RelayLoopOverview, RELAY_LOOP_OVERVIEW_SECTIONS, type RelayLoopOverviewSection } from './RelayLoopOverview';
export {
  RelayLoopRunPanel,
  RelayLoopRunSurface,
  type RelayLoopRunFetch,
  type RelayLoopRunPanelProps,
  type RelayLoopRunPort,
  type RelayLoopRunStore,
  type RelayLoopRunSurfaceProps,
  type RelayLoopRunSync,
} from './RelayLoopRunPanel';
export {
  RELAY_LOOP_ACTIVITY,
  activityFor,
  controlsFor,
  isUsableRestorePoint,
  projectLoopRunView,
  restorePointFor,
  type RelayLoopActivity,
  type RelayLoopRestorePoint,
  type RelayLoopRunControlView,
  type RelayLoopRunView,
  type RelayLoopUsageLine,
} from './loop-run-view';
export {
  RelayLoopTargetPicker,
  targetChoiceCommand,
  targetChoiceExpression,
  type RelayLoopTargetChoice,
} from './RelayLoopTargetPicker';

export {
  EXECUTION_IMPLYING_STATUSES,
  RELAY_LOOP_PRESENTATION_STATUSES,
  RELAY_LOOP_STATUS_DESCRIPTION,
  RELAY_LOOP_STATUS_LABEL,
  RELAY_LOOP_STATUS_TONE,
  deriveLoopPresentationStatus,
  statusImpliesExecution,
  type LoopPresentationInput,
  type RelayLoopPresentationStatus,
} from './loop-status';

export {
  RELAY_LOOP_CONTROLS,
  openLoopSurface,
  projectLoopComposerView,
  projectSwarmGateView,
  type RelayLoopComposerInput,
  type RelayLoopComposerView,
  type RelayLoopControl,
  type RelayLoopControlView,
  type OpenLoopSurfaceDeps,
  type RelayLoopFieldView,
  type RelayLoopTargetView,
  type RelaySwarmGateView,
} from './loop-view';
