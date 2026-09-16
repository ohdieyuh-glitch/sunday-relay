import type { JuliusBrainPhase } from './julius-brain-failure-model';
import type { JuliusBrainRetryClass } from './julius-brain-retry';

/**
 * THE FAULT MATRIX: EVERY WAY THIS CAN GO WRONG, AND WHAT MUST BE TRUE AFTERWARDS.
 *
 * One row per injected failure, across the ten areas a Brain call passes
 * through. Each row fixes, in advance:
 *
 *   retry        how the failure may be retried (`julius-brain-retry.ts`)
 *   mutation     what the Brain holds afterwards: nothing, exactly one effect,
 *                or something only a read can settle
 *   preservation what the attempt may claim
 *   audit        the decision the service must have recorded
 *   recovery     what makes the history whole later, if anything
 *
 * The rows marked `automated` are executed by
 * `julius-brain-fault-matrix.test.ts` against local fakes. The rest are proven
 * by the named suites, several of them against a real PostgreSQL. A future
 * production deployment is expected to pass this same matrix — that is why the
 * table is data rather than prose.
 */

export const JULIUS_BRAIN_FAULT_AREAS = ['AUTH', 'SERVICE', 'NETWORK', 'DATABASE', 'TRANSACTION', 'ARTIFACT', 'CHECKPOINT', 'SEAL', 'RECOVERY', 'AUDIT'] as const;
export type JuliusBrainFaultArea = typeof JULIUS_BRAIN_FAULT_AREAS[number];

export type JuliusBrainFaultPhase = JuliusBrainPhase | 'REGISTER' | 'CALL' | 'RECOVER';
export type JuliusBrainExpectedMutation = 'NONE' | 'ONCE' | 'UNKNOWN_UNTIL_RECONCILED';
export type JuliusBrainExpectedPreservation = 'UNAFFECTED' | 'AT_RISK' | 'NOT_PRESERVED' | 'PARTIALLY_PRESERVED';

export interface JuliusBrainFaultCase {
  readonly id: string;
  readonly area: JuliusBrainFaultArea;
  readonly phase: JuliusBrainFaultPhase;
  readonly fault: string;
  readonly retryClass: JuliusBrainRetryClass;
  readonly expectedMutation: JuliusBrainExpectedMutation;
  readonly expectedPreservation: JuliusBrainExpectedPreservation;
  /** The audited decision, as `ACTION:reasonCode` — or `none` when the failure happens before any decision. */
  readonly expectedAudit: string;
  readonly expectedRecovery: string;
  /** Executed by `julius-brain-fault-matrix.test.ts` itself; the rest are executed by the suites named below. */
  readonly automated: boolean;
  readonly provenBy: readonly string[];
}

export const JULIUS_BRAIN_FAULT_MATRIX: readonly JuliusBrainFaultCase[] = [
  // AUTH
  {
    id: 'auth.token-replayed', area: 'AUTH', phase: 'REGISTER', fault: 'the same identity token is exchanged twice, including after a service restart',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'SESSION_REFUSED:token_replayed',
    expectedRecovery: 'the runner requests a new identity token', automated: true,
    provenBy: ['julius-brain-access-security.test.ts', 'scripts/julius-brain-access-postgres.test.ts'],
  },
  {
    id: 'auth.key-rotated-away', area: 'AUTH', phase: 'REGISTER', fault: 'the issuer withdraws the key the token was signed with',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'SESSION_REFUSED:token_key_unknown',
    expectedRecovery: 'a token signed by a published key', automated: false, provenBy: ['julius-brain-oidc-keys.test.ts'],
  },
  {
    id: 'auth.issuer-unreachable', area: 'AUTH', phase: 'REGISTER', fault: 'the issuer key set cannot be fetched and the cache is past its stale limit',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'NONE', expectedPreservation: 'NOT_PRESERVED', expectedAudit: 'SESSION_REFUSED:issuer_keys_unavailable',
    expectedRecovery: 'the run proceeds unpreserved (FRESH) or refuses (other modes); the archive recovers it', automated: false, provenBy: ['julius-brain-oidc-keys.test.ts'],
  },
  {
    id: 'auth.mode-escalation', area: 'AUTH', phase: 'REGISTER', fault: 'a registered attempt asks for a wider state mode, with or without a late grant',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'SESSION_REFUSED:run_registration_mismatch',
    expectedRecovery: 'none: the attempt keeps the mode it registered', automated: true, provenBy: ['julius-brain-access-security.test.ts'],
  },
  {
    id: 'auth.session-expired', area: 'AUTH', phase: 'CALL', fault: 'a call arrives after the session expired',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'CALL_REFUSED:session_expired',
    expectedRecovery: 'one renewal with a fresh identity token, same attempt and mode', automated: true,
    provenBy: ['julius-brain-failure-model.test.ts', 'julius-brain-service-router.test.ts'],
  },
  // SERVICE
  {
    id: 'service.unavailable', area: 'SERVICE', phase: 'OPEN', fault: 'the Brain service does not answer at all',
    retryClass: 'RECONCILE_BEFORE_RETRY', expectedMutation: 'UNKNOWN_UNTIL_RECONCILED', expectedPreservation: 'NOT_PRESERVED', expectedAudit: 'none',
    expectedRecovery: 'FRESH proceeds unpreserved; other modes refuse; the archive recovers the attempt', automated: false,
    provenBy: ['julius-brain-failure-model.test.ts', 'julius-brain-retry.test.ts'],
  },
  {
    id: 'service.circuit-open', area: 'SERVICE', phase: 'SEAL', fault: 'repeated infrastructure failure opens the breaker',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'NONE', expectedPreservation: 'NOT_PRESERVED', expectedAudit: 'none',
    expectedRecovery: 'the probe closes the breaker; preservation is read from the Brain, never assumed', automated: false,
    provenBy: ['julius-brain-retry.test.ts', 'relay-bridge/julius/project-brain-failure-integration.test.ts'],
  },
  {
    id: 'service.rate-limited', area: 'SERVICE', phase: 'CALL', fault: 'a run exceeds its own operation allowance',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'CALL_REFUSED:rate_limited',
    expectedRecovery: 'the same call once the window turns', automated: true, provenBy: ['julius-brain-rate-limit.test.ts', 'julius-brain-service-router.test.ts'],
  },
  {
    id: 'service.request-replayed', area: 'SERVICE', phase: 'CALL', fault: 'a client loses a response and repeats the request id',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'ONCE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'CALL_ALLOWED:',
    expectedRecovery: 'the first answer is returned, marked replayed', automated: true,
    provenBy: ['julius-brain-service-router.test.ts', 'scripts/julius-brain-service-postgres.test.ts'],
  },
  // NETWORK
  {
    id: 'network.lost-mid-commit', area: 'NETWORK', phase: 'MIRROR', fault: 'the connection is lost while a commit is in flight',
    retryClass: 'RECONCILE_BEFORE_RETRY', expectedMutation: 'UNKNOWN_UNTIL_RECONCILED', expectedPreservation: 'AT_RISK', expectedAudit: 'none',
    expectedRecovery: 'read the Brain, then retry under the same idempotency key', automated: false,
    provenBy: ['scripts/julius-brain-failure-postgres.test.ts', 'scripts/julius-brain-archive-recovery-postgres.test.ts'],
  },
  {
    id: 'network.lost-after-commit', area: 'NETWORK', phase: 'SEAL', fault: 'the commit lands and the response never arrives',
    retryClass: 'RECONCILE_BEFORE_RETRY', expectedMutation: 'ONCE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'none',
    expectedRecovery: 'the read settles it; the retry is a no-op', automated: true,
    provenBy: ['scripts/julius-brain-failure-postgres.test.ts', 'relay-bridge/julius/project-brain-failure-integration.test.ts'],
  },
  // DATABASE
  {
    id: 'database.unavailable', area: 'DATABASE', phase: 'OPEN', fault: 'the database refuses connections',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'NONE', expectedPreservation: 'NOT_PRESERVED', expectedAudit: 'none',
    expectedRecovery: 'FRESH proceeds unpreserved; other modes refuse; the archive recovers it', automated: false,
    provenBy: ['scripts/julius-brain-failure-postgres.test.ts', 'relay-bridge/julius/project-brain-failure-integration.test.ts'],
  },
  {
    id: 'database.read-only', area: 'DATABASE', phase: 'MIRROR', fault: 'the database is read-only (a failover, or maintenance)',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'NONE', expectedPreservation: 'AT_RISK', expectedAudit: 'none',
    expectedRecovery: 'retry when writes return; the seal reports what is missing; the archive recovers the rest', automated: false,
    provenBy: ['scripts/julius-brain-failure-postgres.test.ts'],
  },
  {
    id: 'database.tls-untrusted', area: 'DATABASE', phase: 'OPEN', fault: 'the database presents a certificate the service does not trust',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'NONE', expectedPreservation: 'NOT_PRESERVED', expectedAudit: 'none',
    expectedRecovery: 'an operator fixes the configuration; nothing retries without verification', automated: false,
    provenBy: ['scripts/julius-brain-failure-postgres.test.ts'],
  },
  {
    id: 'database.schema-mismatch', area: 'DATABASE', phase: 'OPEN', fault: 'the database is migrated beyond, or behind, this code',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'NONE', expectedPreservation: 'NOT_PRESERVED', expectedAudit: 'none',
    expectedRecovery: 'the migration step runs, or the code is rolled forward', automated: true,
    provenBy: ['julius-brain-retry.test.ts', 'scripts/julius-brain-database-postgres.test.ts'],
  },
  // TRANSACTION
  {
    id: 'transaction.timeout', area: 'TRANSACTION', phase: 'MIRROR', fault: 'a lock or statement timeout cancels the commit',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'NONE', expectedPreservation: 'AT_RISK', expectedAudit: 'none',
    expectedRecovery: 'the retry commits once', automated: false, provenBy: ['scripts/julius-brain-failure-postgres.test.ts'],
  },
  {
    id: 'transaction.killed-mid-commit', area: 'TRANSACTION', phase: 'RECOVER', fault: 'the committing backend is terminated part-way through an import',
    retryClass: 'RECONCILE_BEFORE_RETRY', expectedMutation: 'NONE', expectedPreservation: 'AT_RISK', expectedAudit: 'none',
    expectedRecovery: 'a cold retry imports exactly once, identical to a clean import', automated: false,
    provenBy: ['scripts/julius-brain-archive-recovery-postgres.test.ts'],
  },
  // ARTIFACT
  {
    id: 'artifact.foreign-read', area: 'ARTIFACT', phase: 'CALL', fault: 'a session asks for an artifact its state mode does not admit',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'CALL_REFUSED:artifact_not_admitted',
    expectedRecovery: 'none: the artifact is not this run\'s to read', automated: true,
    provenBy: ['julius-brain-access-security.test.ts', 'julius-brain-service-router.test.ts'],
  },
  {
    id: 'artifact.digest-mismatch', area: 'ARTIFACT', phase: 'RECOVER', fault: 'supplied artifact bytes do not hash to the digest the export declares',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'none',
    expectedRecovery: 'the exporter is fixed; nothing is stored beside a claim it does not match', automated: false,
    provenBy: ['julius-brain-archive-import.test.ts', 'julius-brain-archive-conformance.test.ts'],
  },
  // CHECKPOINT / SEAL
  {
    id: 'checkpoint.refused', area: 'CHECKPOINT', phase: 'SEAL', fault: 'the seal lands and the checkpoint does not',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'NONE', expectedPreservation: 'PARTIALLY_PRESERVED', expectedAudit: 'none',
    expectedRecovery: 'the attempt is PARTIALLY_PRESERVED; the archive recovers the rest', automated: true,
    provenBy: ['relay-bridge/julius/project-brain-failure-integration.test.ts'],
  },
  {
    id: 'seal.missing-entries', area: 'SEAL', phase: 'SEAL', fault: 'mirror failures leave v1 entries the Brain never held',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'ONCE', expectedPreservation: 'PARTIALLY_PRESERVED', expectedAudit: 'none',
    expectedRecovery: 'the seal names the missing entries; the archive recovery reconciles them later', automated: false,
    provenBy: ['relay-bridge/julius/project-brain-binding.test.ts', 'relay-bridge/julius/project-brain-failure-integration.test.ts'],
  },
  // RECOVERY
  {
    id: 'recovery.already-preserved', area: 'RECOVERY', phase: 'SEAL', fault: 'an archive of an attempt the live run preserved is offered',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'none',
    expectedRecovery: 'none is needed: the attempt is already whole', automated: false,
    provenBy: ['julius-brain-archive-reconciliation.test.ts'],
  },
  {
    id: 'recovery.conflicting-history', area: 'RECOVERY', phase: 'SEAL', fault: 'the archive disagrees with what the live run recorded',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'none',
    expectedRecovery: 'a human investigates; nothing is merged', automated: false,
    provenBy: ['julius-brain-archive-adversarial.test.ts'],
  },
  {
    id: 'recovery.concurrent', area: 'RECOVERY', phase: 'SEAL', fault: 'two recoveries of one attempt run at once',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'ONCE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'none',
    expectedRecovery: 'one history, one RECOVERY trace; the other finds it imported', automated: false,
    provenBy: ['scripts/julius-brain-archive-recovery-postgres.test.ts'],
  },
  // AUDIT
  {
    id: 'audit.unwritable', area: 'AUDIT', phase: 'CALL', fault: 'the audit cannot be appended',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'none',
    expectedRecovery: 'the call is refused: an unaudited decision is not made', automated: true, provenBy: ['julius-brain-access-security.test.ts'],
  },
  {
    id: 'audit.rewritten', area: 'AUDIT', phase: 'CALL', fault: 'the database owner rewrites the audit and rebuilds its chain',
    retryClass: 'DO_NOT_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'none',
    expectedRecovery: 'the external anchors expose it; the Brain ledger is unaffected', automated: false,
    provenBy: ['julius-brain-audit-anchor.test.ts', 'scripts/julius-brain-audit-anchor-postgres.test.ts'],
  },
  {
    id: 'audit.anchor-sink-down', area: 'AUDIT', phase: 'CALL', fault: 'the external anchor sink is unavailable',
    retryClass: 'SAFE_TO_RETRY', expectedMutation: 'NONE', expectedPreservation: 'UNAFFECTED', expectedAudit: 'none',
    expectedRecovery: 'the service keeps serving; only the verifiable window stops advancing, and that is alerted', automated: true,
    provenBy: ['julius-brain-audit-anchor.test.ts'],
  },
];

/** The matrix as a table, for the document that ships beside it. */
export function renderJuliusBrainFaultMatrix(cases: readonly JuliusBrainFaultCase[] = JULIUS_BRAIN_FAULT_MATRIX): string {
  const rows = cases.map((item) => `| \`${item.id}\` | ${item.area} | ${item.phase} | ${item.fault} | ${item.retryClass} | ${item.expectedMutation} | ${item.expectedPreservation} | ${item.expectedAudit} | ${item.expectedRecovery} | ${item.automated ? 'automated' : 'suite'} |`);
  return [
    '| Case | Area | Phase | Injected failure | Retry | Mutation | Preservation | Audit | Recovery | Proof |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}
