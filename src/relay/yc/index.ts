/**
 * YC demo acceptance module (Prompt 8.7) — public surface for `main.ts`.
 * A leaf module: it imports NOTHING from the rest of Relay; the CLI wires
 * the offline plain demo in as an injected dependency. Read-only by
 * construction — the preflight can never start a provider, deploy, push,
 * write, or inspect the separate browser-frontend worktree.
 */

export {
  runYcPreflight, ycDemoNotice,
  YC_EXPECTED_BRANCH, YC_MINIMUM_COMMIT, YC_REQUIRED_SCRIPTS, YC_REQUIRED_DOCS,
  YC_PROOF_DOCS, YC_DEMO_LABELS,
  type YcCheck, type YcCheckStatus, type YcGitResult, type YcPreflightDeps, type YcPreflightReport,
} from './preflight';
export { createNodePreflightDeps } from './node-deps';
