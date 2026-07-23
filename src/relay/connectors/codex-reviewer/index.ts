/**
 * Codex Reviewer adapter (Prompt 8.3) — public surface. The REAL local Codex
 * independent-reviewer adapter behind Relay's provider-neutral Reviewer port.
 * READ-ONLY, isolated-workspace, no-fallback, attested by Relay. No provider
 * call occurs in any test, build, doctor, or contract verification.
 */

export * from './contracts';
export { CODEX_REVIEWER_ADAPTER_ID, codexReviewerDescriptor, createCodexReviewerAdapter } from './adapter';
export {
  probeCodexCapabilities, classifyCodexAuth, resolveCodexExecutable, selectRuntimeStrategy,
  probeCodexLoginStatus, classifyCodexLoginOutput, type CodexLoginProbe,
} from './capability-probe';
export { assessCodexConfiguration } from './configuration';
export { buildCodexEnvironment, apiKeyEnvironmentDetected } from './environment';
export { compileReviewerPrompt, reviewReportJsonSchema } from './reviewer-prompt-compiler';
export { compileReviewerPermissions, FORBIDDEN_FLAGS } from './permission-compiler';
export { parseReviewReport } from './report-parser';
export { buildReviewerAttestation, REVIEWER_ROLE } from './attestation';
export { codexDoctorReport } from './doctor';
export { runCodexReviewerContractVerification, type ContractCheck } from './verify-harness';
export {
  runCodexReviewProof, checkReviewPrerequisites,
  type CodexReviewProofResult, type CodexReviewProofOptions,
} from './live-runner';
export { buildReviewDefectFixture, CLAIMED_FILE, TEST_FILE } from './fixture';
