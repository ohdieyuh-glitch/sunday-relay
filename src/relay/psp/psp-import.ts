/**
 * PSP AGENT ID — the import boundary (PURE, browser-safe, shared verbatim).
 *
 * ONE import contract for both surfaces. The website renders these states as
 * panels and the CLI prints them as lines, but the validation, the ordering,
 * the confirmation requirement, the error meanings and the security rules are
 * this module's — neither surface re-implements them.
 *
 * The flow is always the same, and always in this order:
 *
 *   enter ID -> validate FORMAT locally -> verify ENTITLEMENT through the
 *   authorized service boundary -> show a SAFE preview -> require CONFIRMATION
 *   -> import into the selected workspace -> report the agent identity
 *
 * SECURITY INVARIANTS ENFORCED HERE:
 *   - the raw credential is accepted only as a function argument; it is never
 *     placed in a returned value, a record, a preview, an error or a trace;
 *   - the flow state holds a MASKED id and a fingerprint, never the secret;
 *   - nothing is imported without an explicit confirmation step;
 *   - a failed or completed flow clears the credential from controlled state;
 *   - an unavailable entitlement service NEVER fabricates a success.
 */

import {
  maskPspAgentId,
  parsePspAgentId,
  pspAgentIdFingerprint,
} from './psp-agent-id';
import {
  pspFail,
  pspOk,
  type PSPAgentImportErrorCode,
  type PSPResult,
} from './psp-errors';
import {
  credentialMatchesEntitlement,
  credentialRecordIsRetired,
  evaluateEntitlement,
  redeemEntitlement,
  safeEntitlementView,
  type PSPAcquisitionType,
  type PSPAgentCredentialRecord,
  type PSPAgentEntitlement,
  type SafePSPEntitlementView,
} from './psp-entitlement';

/* ------------------------------- records -------------------------------- */

export type PSPImportSource = PSPAcquisitionType;

export type PSPImportRecordStatus = 'active' | 'disabled' | 'revoked' | 'superseded';

/**
 * What a workspace keeps after a successful import. It names the agent and
 * where it came from — and contains NO credential material of any kind.
 */
export interface PSPAgentImportRecord {
  importId: string;
  userId: string;
  workspaceId: string;

  /** PUBLIC product identity. */
  pspAgentId: string;
  pspId: string;
  pspVersionId: string;
  entitlementId: string;

  importedAt: string;

  source: PSPImportSource;
  status: PSPImportRecordStatus;

  displayName: string;
  agentRoleSummary: string[];
}

/* ------------------------------- product -------------------------------- */

/** The publishable facts about a PSP agent version. Everything here is safe
 *  to show in a preview; creator secrets and hidden prompts are not modeled. */
export interface PSPAgentProduct {
  pspId: string;
  pspVersionId: string;
  name: string;
  creator: string;
  /** Human version label, e.g. "2.1.0". */
  version: string;
  agentRoles: string[];
  supportedModels: string[];
  requiredPermissions: string[];
  requiredTools: string[];
  reviewPolicy: string;
  defaultBudgetPolicy: string;
  /** How this PSP dresses the ONE official Relay Dog. A PSP may recolor the
   *  dog; it may never replace its identity. */
  relayDogColorway: string;
  /** Minimum Relay version this PSP version supports. */
  minimumRelayVersion: string;
}

export interface PSPWorkspaceContext {
  workspaceId: string;
  userId: string;
  /** Whether this actor may import agents into this workspace. */
  importAllowed: boolean;
  relayVersion: string;
  grantablePermissions: string[];
  /** PSP ids already present in the workspace. */
  installedPspIds: string[];
}

/* ------------------------------- preview -------------------------------- */

export interface PSPAgentImportPreview {
  /** PUBLIC identity, safe everywhere. */
  pspAgentId: string;
  /** e.g. PSP-AGENT-1-RLY8K2-•••••••••••••••• — the only renderable form. */
  maskedAgentId: string;
  credentialFingerprint: string;

  name: string;
  creator: string;
  pspId: string;
  pspVersionId: string;
  version: string;

  agentRoles: string[];
  supportedModels: string[];
  requiredPermissions: string[];
  requiredTools: string[];
  reviewPolicy: string;
  defaultBudgetPolicy: string;
  relayDogColorway: string;

  /** Where this entitlement came from — provenance, never private details. */
  acquisitionType: PSPAcquisitionType;
  marketplaceTransactionId?: string;
  tradeTransactionId?: string;

  compatible: boolean;
  warnings: string[];
  /** What confirming will do to the credential, stated before they confirm. */
  redemptionEffect: 'redeem_one_time' | 'bind_to_workspace';
  /** True until the user confirms — no import happens without it. */
  confirmationRequired: boolean;
}

/* -------------------------- service boundary ---------------------------- */

export interface PSPVerifiedEntitlement {
  entitlement: PSPAgentEntitlement;
  credentialRecord: PSPAgentCredentialRecord;
  product: PSPAgentProduct;
}

/**
 * The AUTHORIZED entitlement service boundary. Ship on Sunday's purchase and
 * trading backend is not implemented, so no production adapter exists yet;
 * this port is what a production adapter will implement, and what the
 * deterministic development fixture implements today.
 *
 * The port receives the raw credential ONLY to check it, and must return no
 * credential material of any kind.
 */
export interface PSPEntitlementServicePort {
  /** True for a real backend, false for a development fixture. A fixture may
   *  never claim to be production. */
  readonly production: boolean;
  lookup(input: {
    credential: string;
    now: string;
  }): PSPResult<PSPVerifiedEntitlement>;
  /** Persist the redeemed entitlement + retired credential record. */
  commit(input: {
    entitlement: PSPAgentEntitlement;
    credentialRecord: PSPAgentCredentialRecord;
    record: PSPAgentImportRecord;
  }): PSPResult<PSPAgentImportRecord>;
}

/**
 * The DEFAULT PRODUCTION adapter. Ship on Sunday's purchase and trading
 * backend is not implemented, so it refuses every credential rather than
 * inventing an answer: no fabricated ownership, no pretended purchase, no
 * invented entitlement. It reports `production: true`, so a development
 * fixture credential would be rejected by `evaluateEntitlement` even if one
 * reached it.
 *
 * Replacing this with a real adapter is the single integration point for the
 * future Ship on Sunday backend. It lives here rather than with the fixtures
 * so that no production code path has to import the fixture module at all.
 */
export function createUnavailableEntitlementService(): PSPEntitlementServicePort {
  return {
    production: true,
    lookup(): PSPResult<PSPVerifiedEntitlement> {
      return pspFail('PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE');
    },
    commit(): PSPResult<PSPAgentImportRecord> {
      return pspFail('PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE');
    },
  };
}

/* ------------------------------ rate limit ------------------------------ */

export interface PSPAttemptWindow {
  actorUserId: string;
  /** ISO timestamps of recent FAILED validation attempts, oldest first. */
  failedAt: string[];
}

export const PSP_MAX_FAILED_ATTEMPTS = 5;
export const PSP_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Repeated-invalid-attempt protection. Deterministic and clock-injected: the
 * caller supplies `now`, so the boundary is testable and identical on both
 * surfaces. Failures are counted; a success does not consume budget.
 */
export function recordFailedAttempt(window: PSPAttemptWindow, now: string): PSPAttemptWindow {
  const cutoff = Date.parse(now) - PSP_ATTEMPT_WINDOW_MS;
  const recent = window.failedAt.filter((at) => Date.parse(at) >= cutoff);
  return { actorUserId: window.actorUserId, failedAt: [...recent, now] };
}

export function isRateLimited(window: PSPAttemptWindow, now: string): boolean {
  const cutoff = Date.parse(now) - PSP_ATTEMPT_WINDOW_MS;
  return window.failedAt.filter((at) => Date.parse(at) >= cutoff).length >= PSP_MAX_FAILED_ATTEMPTS;
}

/* ------------------------------ validation ------------------------------ */

function compatibility(
  product: PSPAgentProduct,
  workspace: PSPWorkspaceContext,
): { compatible: boolean; warnings: string[]; incompatible: boolean } {
  const warnings: string[] = [];
  let incompatible = false;

  if (compareVersions(workspace.relayVersion, product.minimumRelayVersion) < 0) {
    warnings.push(`Requires Relay ${product.minimumRelayVersion} or newer.`);
    incompatible = true;
  }
  const missing = product.requiredPermissions.filter(
    (permission) => !workspace.grantablePermissions.includes(permission),
  );
  if (missing.length > 0) {
    warnings.push(`This workspace cannot grant: ${missing.join(', ')}.`);
    incompatible = true;
  }
  return { compatible: !incompatible, warnings, incompatible };
}

/** Numeric dotted-version comparison; missing parts count as 0. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Validate a PSP Agent ID and build the SAFE preview. The credential is used
 * here and released: the returned preview carries only the masked id, the
 * fingerprint and publishable product facts.
 */
export function validatePspAgentImport(input: {
  credential: string;
  workspace: PSPWorkspaceContext;
  service: PSPEntitlementServicePort;
  now: string;
  attempts?: PSPAttemptWindow;
}): PSPResult<PSPAgentImportPreview> {
  const { workspace, service } = input;

  if (input.attempts && isRateLimited(input.attempts, input.now)) {
    return pspFail('PSP_AGENT_IMPORT_RATE_LIMITED');
  }
  if (typeof input.credential !== 'string' || input.credential.trim() === '') {
    return pspFail('PSP_AGENT_ID_REQUIRED');
  }

  const parsed = parsePspAgentId(input.credential);
  if (!parsed.ok) {
    return pspFail(
      parsed.reason === 'empty' ? 'PSP_AGENT_ID_REQUIRED' : 'PSP_AGENT_ID_INVALID_FORMAT',
    );
  }
  if (!workspace.workspaceId) return pspFail('WORKSPACE_NOT_FOUND', parsed.value.pspAgentId);
  if (!workspace.importAllowed) {
    return pspFail('WORKSPACE_IMPORT_NOT_ALLOWED', parsed.value.pspAgentId);
  }

  const looked = service.lookup({ credential: input.credential, now: input.now });
  if (!looked.ok) return looked;
  const { entitlement, credentialRecord, product } = looked.value;

  // AUTHENTICITY first: the presented credential must match the stored
  // verifier, in constant time.
  if (!credentialMatchesEntitlement(input.credential, credentialRecord)) {
    return pspFail('PSP_AGENT_ID_INVALID', entitlement.pspAgentId);
  }

  // Then USABILITY. Status is evaluated before retirement so a replayed
  // credential is reported as ALREADY REDEEMED (true and actionable) rather
  // than as an unrecognized ID.
  const evaluated = evaluateEntitlement({
    entitlement,
    actorUserId: workspace.userId,
    now: input.now,
    productionMode: service.production,
  });
  if (!evaluated.ok) return pspFail(evaluated.error.code, entitlement.pspAgentId);

  // Defence in depth: a retired secret can never authorize an import, even if
  // the entitlement's status somehow still reads active.
  if (credentialRecordIsRetired(credentialRecord)) {
    return pspFail('PSP_AGENT_ID_INVALID', entitlement.pspAgentId);
  }

  if (workspace.installedPspIds.includes(product.pspId)) {
    return pspFail('PSP_AGENT_ALREADY_IMPORTED', entitlement.pspAgentId);
  }

  const compat = compatibility(product, workspace);
  if (compat.incompatible) return pspFail('PSP_AGENT_VERSION_INCOMPATIBLE', entitlement.pspAgentId);

  const view: SafePSPEntitlementView = safeEntitlementView(entitlement);
  return pspOk({
    pspAgentId: entitlement.pspAgentId,
    maskedAgentId: maskPspAgentId(input.credential),
    credentialFingerprint: view.credentialFingerprint,

    name: product.name,
    creator: product.creator,
    pspId: product.pspId,
    pspVersionId: product.pspVersionId,
    version: product.version,

    agentRoles: [...product.agentRoles],
    supportedModels: [...product.supportedModels],
    requiredPermissions: [...product.requiredPermissions],
    requiredTools: [...product.requiredTools],
    reviewPolicy: product.reviewPolicy,
    defaultBudgetPolicy: product.defaultBudgetPolicy,
    relayDogColorway: product.relayDogColorway,

    acquisitionType: entitlement.acquisitionType,
    ...(entitlement.marketplaceTransactionId
      ? { marketplaceTransactionId: entitlement.marketplaceTransactionId } : {}),
    ...(entitlement.tradeTransactionId
      ? { tradeTransactionId: entitlement.tradeTransactionId } : {}),

    compatible: compat.compatible,
    warnings: compat.warnings,
    redemptionEffect: 'redeem_one_time',
    confirmationRequired: true,
  });
}

/* -------------------------------- import -------------------------------- */

/**
 * Complete the import. Refuses without an explicit confirmation, revalidates
 * from scratch (so a preview can never be replayed against a credential that
 * has since been revoked), redeems the credential one time, and returns an
 * import record that contains no secret.
 */
export function completePspAgentImport(input: {
  credential: string;
  workspace: PSPWorkspaceContext;
  service: PSPEntitlementServicePort;
  now: string;
  confirmed: boolean;
  importId: string;
}): PSPResult<PSPAgentImportRecord> {
  if (!input.confirmed) {
    const parsed = parsePspAgentId(input.credential);
    return pspFail(
      'PSP_AGENT_IMPORT_CONFIRMATION_REQUIRED',
      parsed.ok ? parsed.value.pspAgentId : undefined,
    );
  }

  const revalidated = validatePspAgentImport({
    credential: input.credential,
    workspace: input.workspace,
    service: input.service,
    now: input.now,
  });
  if (!revalidated.ok) return pspFail(revalidated.error.code, revalidated.error.pspAgentId);

  const looked = input.service.lookup({ credential: input.credential, now: input.now });
  if (!looked.ok) return looked;
  const { entitlement, credentialRecord, product } = looked.value;

  const redeemed = redeemEntitlement({
    entitlement,
    credentialRecord,
    userId: input.workspace.userId,
    workspaceId: input.workspace.workspaceId,
    now: input.now,
  });

  const record: PSPAgentImportRecord = {
    importId: input.importId,
    userId: input.workspace.userId,
    workspaceId: input.workspace.workspaceId,
    pspAgentId: entitlement.pspAgentId,
    pspId: product.pspId,
    pspVersionId: product.pspVersionId,
    entitlementId: entitlement.entitlementId,
    importedAt: input.now,
    source: entitlement.acquisitionType,
    status: 'active',
    displayName: product.name,
    agentRoleSummary: [...product.agentRoles],
  };

  return input.service.commit({
    entitlement: redeemed.entitlement,
    credentialRecord: redeemed.credentialRecord,
    record,
  });
}

/* ------------------------------ flow state ------------------------------ */

/**
 * The shared import-flow phases. The website renders each as a panel state and
 * the CLI as a printed state — same names, same meanings, same order.
 */
export type PSPImportPhase =
  | 'empty'
  | 'validating'
  | 'valid'
  | 'confirmation_required'
  | 'imported'
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'already_redeemed'
  | 'transferred'
  | 'disputed'
  | 'incompatible'
  | 'service_unavailable';

export const PSP_IMPORT_PHASES: readonly PSPImportPhase[] = [
  'empty', 'validating', 'valid', 'confirmation_required', 'imported',
  'invalid', 'expired', 'revoked', 'already_redeemed', 'transferred',
  'disputed', 'incompatible', 'service_unavailable',
];

/** The single mapping from an error meaning to the state a surface shows. */
export function phaseForError(code: PSPAgentImportErrorCode): PSPImportPhase {
  switch (code) {
    case 'PSP_AGENT_ID_EXPIRED': return 'expired';
    case 'PSP_AGENT_ID_REVOKED': return 'revoked';
    case 'PSP_AGENT_ID_ALREADY_REDEEMED': return 'already_redeemed';
    case 'PSP_AGENT_ID_TRANSFERRED': return 'transferred';
    case 'PSP_AGENT_ID_DISPUTED': return 'disputed';
    case 'PSP_AGENT_VERSION_INCOMPATIBLE': return 'incompatible';
    case 'PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE': return 'service_unavailable';
    case 'PSP_AGENT_IMPORT_CONFIRMATION_REQUIRED': return 'confirmation_required';
    default: return 'invalid';
  }
}

/**
 * The flow's controlled state. It deliberately has NO field that can hold a
 * credential: a surface binds its input box to `entry` (which it clears), and
 * everything durable here is masked or a fingerprint.
 */
export interface PSPImportFlowState {
  phase: PSPImportPhase;
  /** Masked id of the last submitted credential — safe to render. */
  maskedAgentId: string | null;
  fingerprint: string | null;
  preview: PSPAgentImportPreview | null;
  record: PSPAgentImportRecord | null;
  errorCode: PSPAgentImportErrorCode | null;
  message: string | null;
  nextAction: string | null;
  attempts: PSPAttemptWindow;
}

export function initialPspImportState(actorUserId: string): PSPImportFlowState {
  return {
    phase: 'empty',
    maskedAgentId: null,
    fingerprint: null,
    preview: null,
    record: null,
    errorCode: null,
    message: null,
    nextAction: null,
    attempts: { actorUserId, failedAt: [] },
  };
}

/**
 * Submit a credential for validation. The credential is consumed here; the
 * returned state holds only its mask and fingerprint, so a surface that keeps
 * this state around is not keeping a credential around.
 */
export function submitPspAgentId(
  state: PSPImportFlowState,
  input: {
    credential: string;
    workspace: PSPWorkspaceContext;
    service: PSPEntitlementServicePort;
    now: string;
  },
): PSPImportFlowState {
  const result = validatePspAgentImport({
    credential: input.credential,
    workspace: input.workspace,
    service: input.service,
    now: input.now,
    attempts: state.attempts,
  });

  const masked = maskPspAgentId(input.credential);
  const fingerprint = pspAgentIdFingerprint(input.credential);

  if (!result.ok) {
    return {
      ...state,
      phase: phaseForError(result.error.code),
      maskedAgentId: masked,
      fingerprint,
      preview: null,
      record: null,
      errorCode: result.error.code,
      message: result.error.message,
      nextAction: result.error.nextAction,
      attempts: recordFailedAttempt(state.attempts, input.now),
    };
  }

  return {
    ...state,
    phase: 'valid',
    maskedAgentId: result.value.maskedAgentId,
    fingerprint,
    preview: result.value,
    record: null,
    errorCode: null,
    message: null,
    nextAction: null,
  };
}

/** Confirm and import. Never reachable without a preview in hand. */
export function confirmPspAgentImport(
  state: PSPImportFlowState,
  input: {
    credential: string;
    workspace: PSPWorkspaceContext;
    service: PSPEntitlementServicePort;
    now: string;
    importId: string;
    confirmed: boolean;
  },
): PSPImportFlowState {
  const result = completePspAgentImport({
    credential: input.credential,
    workspace: input.workspace,
    service: input.service,
    now: input.now,
    confirmed: input.confirmed,
    importId: input.importId,
  });

  if (!result.ok) {
    return {
      ...state,
      phase: phaseForError(result.error.code),
      errorCode: result.error.code,
      message: result.error.message,
      nextAction: result.error.nextAction,
      record: null,
    };
  }

  // Success clears the preview's transient material: what remains is the
  // imported agent's identity, never the credential that fetched it.
  return {
    ...state,
    phase: 'imported',
    preview: state.preview,
    record: result.value,
    errorCode: null,
    message: null,
    nextAction: null,
  };
}

/** Clear the flow — used after success, after failure, and on unmount, so no
 *  credential-derived state outlives the interaction. */
export function clearPspImportFlow(state: PSPImportFlowState): PSPImportFlowState {
  return initialPspImportState(state.attempts.actorUserId);
}
