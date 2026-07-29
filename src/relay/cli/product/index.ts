/**
 * Relay CLI product shell (Prompt 8.6) — public surface for `main.ts`.
 * The terminal-native Relay product: home, projects, drafts, the active
 * mission console (stream + panels views, toggled by the corner [>_]
 * badge), Manual Tasks, findings, evidence, recovery, the offline demo,
 * and the CLI contract verifier. Everything renders through the single
 * safe projection boundary; no provider is ever invoked from this module.
 */

export * from './contracts';
export { detectCaps, paint, symbolText, GLYPHS } from './theme';
export { safeText, safePath, safeSummary, looksLikeProviderStream } from './safety';
export { breakpoint, visibleLength, spread, truncateVisible, divider } from './layout';
export { headerLogo, footerDog } from './dog';
export {
  homeVM, missionConsoleVM, projectHomeVM, recoveryVM, sanitizeEvent, dogStateFrom, PHASES,
} from './projections';
export {
  renderHeader, renderHome, renderMissionConsole, renderProjectHome, renderManualTask,
  renderFinding, renderRepair, renderEvidence, renderRecovery, renderStream, renderPanel,
} from './renderer';
export {
  initialState, reduceKey, reduceTick, renderScreen, finalizeDraft, DRAFT_FIELDS,
  type AppData, type AppState, type KeyEvent, type Screen,
} from './app';
export { parseKeys, runProductShell } from './shell';
export { runCliDemo, plainWalkthrough, demoData } from './demo';
export {
  findProjectRecord, loadAppData, productHome, productProjects, productProjectStatus,
  productProjectView, productRecover, productRunConfirmation,
  type ProductCommandResult, type ProjectView,
} from './commands';
export { runCliContractVerification, type CliContractCheck } from './verify-harness';
