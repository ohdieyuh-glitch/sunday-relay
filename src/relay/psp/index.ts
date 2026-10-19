/**
 * PSP AGENT ID — shared domain surface.
 *
 * ONE entitlement model, ONE import model, ONE validation contract, ONE set of
 * error meanings and ONE security policy, carried byte-identically by the
 * Sunday Relay website/application and the Sunday Relay CLI/terminal. Neither
 * surface re-implements any of it.
 *
 * Ship on Sunday's purchase and trading backend is NOT implemented: no live
 * purchase, no live trade, no payment provider. The production service
 * boundary refuses every credential until a real backend exists; the
 * deterministic fixtures are the development path and can never be production.
 *
 * See docs/relay/PSP_AGENT_ID_AND_ENTITLEMENT.md.
 */

export {
  pspSha256Hex,
  pspConstantTimeEqual,
  pspDomainDigest,
} from './psp-crypto';

export {
  PSP_AGENT_ID_ALPHABET,
  PSP_AGENT_ID_PREFIX,
  PSP_AGENT_ID_PUBLIC_PREFIX_LENGTH,
  PSP_AGENT_ID_SECRET_LENGTH,
  PSP_AGENT_ID_CHECKSUM_LENGTH,
  PSP_AGENT_ID_PRODUCTION_VERSIONS,
  PSP_AGENT_ID_FIXTURE_VERSION,
  PSP_AGENT_ID_CURRENT_VERSION,
  PSP_AGENT_ID_MASK_CHARACTER,
  PSP_AGENT_ID_FINGERPRINT_PREFIX,
  normalizePspAgentId,
  pspAgentIdChecksum,
  parsePspAgentId,
  isValidPspAgentIdFormat,
  composePspAgentId,
  maskPspAgentId,
  maskFromPublicIdentity,
  pspAgentIdFingerprint,
  pspAgentIdVerifier,
  pspAgentIdMatchesVerifier,
  redactPspAgentIds,
  containsPspAgentId,
  type ParsedPspAgentId,
  type PspAgentIdFormatFailure,
  type PspAgentIdParseResult,
} from './psp-agent-id';

export {
  PSP_AGENT_IMPORT_ERROR_CODES,
  pspImportError,
  pspOk,
  pspFail,
  type PSPAgentImportError,
  type PSPAgentImportErrorCode,
  type PSPResult,
} from './psp-errors';

export {
  issueEntitlement,
  evaluateEntitlement,
  credentialMatchesEntitlement,
  redeemEntitlement,
  revokeEntitlement,
  disputeEntitlement,
  expireEntitlement,
  transferEntitlement,
  safeEntitlementView,
  type PSPAcquisitionType,
  type PSPEntitlementStatus,
  type PSPAgentEntitlement,
  type PSPAgentCredentialRecord,
  type IssueEntitlementInput,
  type IssuedEntitlement,
  type TransferEntitlementInput,
  type TransferredEntitlement,
  type SafePSPEntitlementView,
} from './psp-entitlement';

export {
  PSP_IMPORT_PHASES,
  PSP_MAX_FAILED_ATTEMPTS,
  PSP_ATTEMPT_WINDOW_MS,
  validatePspAgentImport,
  completePspAgentImport,
  createUnavailableEntitlementService,
  phaseForError,
  initialPspImportState,
  submitPspAgentId,
  confirmPspAgentImport,
  clearPspImportFlow,
  recordFailedAttempt,
  isRateLimited,
  type PSPAgentImportRecord,
  type PSPAgentImportPreview,
  type PSPAgentProduct,
  type PSPEntitlementServicePort,
  type PSPVerifiedEntitlement,
  type PSPWorkspaceContext,
  type PSPImportPhase,
  type PSPImportFlowState,
  type PSPImportSource,
  type PSPImportRecordStatus,
  type PSPAttemptWindow,
} from './psp-import';

export {
  PSP_TRACE_EVENT_KINDS,
  PSP_TRACE_ALLOWED_KEYS,
  buildPspTraceEvent,
  pspImportRequestedEvent,
  pspImportRejectedEvent,
  pspImportCompletedEvent,
  type PSPTraceEvent,
  type PSPTraceEventKind,
  type PSPTraceMetadata,
  type PSPTraceMetadataKey,
} from './psp-trace';

export {
  PSP_DOMAIN_MANIFEST_VERSION,
  PSP_DOMAIN_CHECKSUMS,
  PSP_DOMAIN_MODULE_NAMES,
  PSP_DOMAIN_LOCATIONS,
  type PSPDomainModuleName,
} from './psp-parity';
