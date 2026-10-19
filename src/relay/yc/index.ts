/**
 * YC demo acceptance module (Prompt 8.7) — public surface for `main.ts`.
 * A leaf module: it imports NOTHING from the rest of Relay; the CLI wires
 * the offline plain demo in as an injected dependency. Read-only by
 * construction — the preflight can never start a provider, deploy, push or
 * write, and it never inspects the browser surface: that surface is in this
 * repository, but nothing here renders or serves it, so it stays MANUAL
 * VERIFICATION REQUIRED rather than being reported as checked.
 */

export {
  runYcPreflight, ycDemoNotice, repositorySlug,
  YC_EXPECTED_REPOSITORY, YC_FORBIDDEN_REPOSITORIES,
  YC_BASELINE_PATH, YC_BASELINE_SCHEMA_VERSION,
  YC_REQUIRED_SCRIPTS, YC_REQUIRED_DOCS,
  YC_PROOF_DOCS, YC_DEMO_LABELS,
  type YcBaseline,
  type YcCheck, type YcCheckStatus, type YcGitResult, type YcPreflightDeps, type YcPreflightReport,
} from './preflight';
export { createNodePreflightDeps } from './node-deps';
