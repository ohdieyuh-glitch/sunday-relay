/**
 * Claude Code adapter composition root (Prompt 8) — the approved surface the
 * CLI imports. Exposes the doctor, contract verification, and the explicit
 * live proof; the real Claude executable is spawned ONLY by the process
 * runner behind these. No provider call happens on import or in the doctor /
 * contract paths.
 */

export * from './contracts';
export { CLAUDE_ADAPTER_ID, claudeCodeDescriptor, createClaudeCodeAdapter } from './adapter';
export { probeClaudeCapabilities, classifyClaudeAuth, resolveClaudeExecutable } from './capability-probe';
export { assessProjectSettings } from './config';
export { buildClaudeEnvironment, apiKeyEnvironmentDetected } from './environment';
export { claudeDoctorReport } from './doctor';
export { runClaudeContractVerification, type ContractCheck } from './contract-verify';
export {
  runClaudeProof, checkLivePrerequisites, redactSessionRef,
  type ClaudeProofResult, type ClaudeProofOptions, type ObservedRuntimeIdentity,
} from './live-runner';
export { auditToolScope, classifyTarget, type ScopeAuditResult } from './scope-auditor';
export { buildSafeEditFixture } from './fixture';
