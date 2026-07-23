/**
 * Supervised live workflow (Prompt 8.4) — public surface. Composes the two
 * approved live adapters (Claude Code implementer + Codex independent
 * reviewer) with the Prompt-7 isolated workspace, the Relay-owned reviewer
 * gate, and the completion policy into the full supervised loop:
 * implementation → inspection → verification → independent review →
 * conditional bounded repair → re-verification → exact-session re-review →
 * verified-complete. No provider call occurs in any test, build, or
 * contract-verify path; the live run is founder-initiated only.
 */

export * from './contracts';
export {
  checkSupervisedPrerequisites, runSupervisedProof,
  type SupervisedPrerequisiteResult,
} from './live-runner';
export {
  runSupervisedContractVerification, SIMULATED_BLOCKING_FINDING, type ContractCheck,
} from './verify-harness';
