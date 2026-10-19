/**
 * PSP AGENT ID — structured import errors (PURE, shared verbatim).
 *
 * ONE set of error meanings for both surfaces: the website shows them as
 * states, the CLI prints them as lines, and neither invents its own wording
 * for a condition the other names differently.
 *
 * Every error is SAFE BY CONSTRUCTION: the factory accepts only a public PSP
 * agent identifier, never a credential, and every message is a fixed string
 * from this module rather than interpolated input.
 */

export type PSPAgentImportErrorCode =
  | 'PSP_AGENT_ID_REQUIRED'
  | 'PSP_AGENT_ID_INVALID_FORMAT'
  | 'PSP_AGENT_ID_INVALID'
  | 'PSP_AGENT_ID_EXPIRED'
  | 'PSP_AGENT_ID_REVOKED'
  | 'PSP_AGENT_ID_ALREADY_REDEEMED'
  | 'PSP_AGENT_ID_TRANSFERRED'
  | 'PSP_AGENT_ID_DISPUTED'
  | 'PSP_AGENT_ENTITLEMENT_NOT_FOUND'
  | 'PSP_AGENT_ENTITLEMENT_NOT_OWNED'
  | 'PSP_AGENT_VERSION_NOT_FOUND'
  | 'PSP_AGENT_VERSION_INCOMPATIBLE'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_IMPORT_NOT_ALLOWED'
  | 'PSP_AGENT_ALREADY_IMPORTED'
  | 'PSP_AGENT_IMPORT_CONFIRMATION_REQUIRED'
  | 'PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE'
  | 'PSP_AGENT_IMPORT_RATE_LIMITED'
  | 'PSP_AGENT_SECRET_STORAGE_FAILED'
  | 'PSP_AGENT_IMPORT_FAILED';

export const PSP_AGENT_IMPORT_ERROR_CODES: readonly PSPAgentImportErrorCode[] = [
  'PSP_AGENT_ID_REQUIRED',
  'PSP_AGENT_ID_INVALID_FORMAT',
  'PSP_AGENT_ID_INVALID',
  'PSP_AGENT_ID_EXPIRED',
  'PSP_AGENT_ID_REVOKED',
  'PSP_AGENT_ID_ALREADY_REDEEMED',
  'PSP_AGENT_ID_TRANSFERRED',
  'PSP_AGENT_ID_DISPUTED',
  'PSP_AGENT_ENTITLEMENT_NOT_FOUND',
  'PSP_AGENT_ENTITLEMENT_NOT_OWNED',
  'PSP_AGENT_VERSION_NOT_FOUND',
  'PSP_AGENT_VERSION_INCOMPATIBLE',
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_IMPORT_NOT_ALLOWED',
  'PSP_AGENT_ALREADY_IMPORTED',
  'PSP_AGENT_IMPORT_CONFIRMATION_REQUIRED',
  'PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE',
  'PSP_AGENT_IMPORT_RATE_LIMITED',
  'PSP_AGENT_SECRET_STORAGE_FAILED',
  'PSP_AGENT_IMPORT_FAILED',
];

export interface PSPAgentImportError {
  readonly code: PSPAgentImportErrorCode;
  /** Safe, user-facing sentence. Never contains a credential. */
  readonly message: string;
  /** The PUBLIC PSP agent identifier, when the failure is attributable. */
  readonly pspAgentId?: string;
  /** What the user can safely do next. */
  readonly nextAction: string;
  /** True when only a person can resolve this (support, seller, admin). */
  readonly humanActionRequired: boolean;
  /** True when retrying the same input could plausibly succeed later. */
  readonly retryable: boolean;
}

interface ErrorShape {
  message: string;
  nextAction: string;
  humanActionRequired: boolean;
  retryable: boolean;
}

const SHAPES: Record<PSPAgentImportErrorCode, ErrorShape> = {
  PSP_AGENT_ID_REQUIRED: {
    message: 'A PSP Agent ID is required.',
    nextAction: 'Enter the PSP Agent ID you received when you purchased or were sent this agent.',
    humanActionRequired: false,
    retryable: true,
  },
  PSP_AGENT_ID_INVALID_FORMAT: {
    message: 'That does not look like a PSP Agent ID.',
    nextAction: 'Check for a missing or extra character and enter the full ID again.',
    humanActionRequired: false,
    retryable: true,
  },
  PSP_AGENT_ID_INVALID: {
    message: 'This PSP Agent ID was not recognized.',
    nextAction: 'Confirm you copied the whole ID. If it keeps failing, contact the seller.',
    humanActionRequired: false,
    retryable: true,
  },
  PSP_AGENT_ID_EXPIRED: {
    message: 'This PSP Agent ID has expired.',
    nextAction: 'Ask the seller or creator to reissue the entitlement.',
    humanActionRequired: true,
    retryable: false,
  },
  PSP_AGENT_ID_REVOKED: {
    message: 'This PSP Agent ID has been revoked.',
    nextAction: 'Contact the seller or creator — a revoked ID cannot be restored.',
    humanActionRequired: true,
    retryable: false,
  },
  PSP_AGENT_ID_ALREADY_REDEEMED: {
    message: 'This PSP Agent ID has already been redeemed.',
    nextAction: 'Open the agent from the workspace it was imported into, or request a transfer.',
    humanActionRequired: true,
    retryable: false,
  },
  PSP_AGENT_ID_TRANSFERRED: {
    message: 'This PSP Agent ID was transferred to another holder and is no longer usable.',
    nextAction: 'Use the new PSP Agent ID issued at transfer.',
    humanActionRequired: true,
    retryable: false,
  },
  PSP_AGENT_ID_DISPUTED: {
    message: 'This entitlement is under dispute and cannot be imported right now.',
    nextAction: 'Wait for the dispute to be resolved, then try again.',
    humanActionRequired: true,
    retryable: false,
  },
  PSP_AGENT_ENTITLEMENT_NOT_FOUND: {
    message: 'No entitlement exists for this PSP Agent ID.',
    nextAction: 'Confirm the purchase or transfer completed before importing.',
    humanActionRequired: true,
    retryable: false,
  },
  PSP_AGENT_ENTITLEMENT_NOT_OWNED: {
    message: 'This entitlement belongs to a different account.',
    nextAction: 'Sign in as the holder, or ask them to transfer the agent to you.',
    humanActionRequired: true,
    retryable: false,
  },
  PSP_AGENT_VERSION_NOT_FOUND: {
    message: 'The PSP version this entitlement refers to could not be found.',
    nextAction: 'Contact the creator — the published version may have been withdrawn.',
    humanActionRequired: true,
    retryable: false,
  },
  PSP_AGENT_VERSION_INCOMPATIBLE: {
    message: 'This PSP version is not compatible with the selected workspace.',
    nextAction: 'Update Relay or choose a workspace that meets the agent’s requirements.',
    humanActionRequired: true,
    retryable: false,
  },
  WORKSPACE_NOT_FOUND: {
    message: 'The selected Relay Workspace could not be found.',
    nextAction: 'Choose an existing workspace and try the import again.',
    humanActionRequired: false,
    retryable: true,
  },
  WORKSPACE_IMPORT_NOT_ALLOWED: {
    message: 'You do not have permission to import agents into this workspace.',
    nextAction: 'Ask a workspace owner to grant import permission, or pick another workspace.',
    humanActionRequired: true,
    retryable: false,
  },
  PSP_AGENT_ALREADY_IMPORTED: {
    message: 'This PSP agent is already in the selected workspace.',
    nextAction: 'Open it from the workspace agent list — no second import is needed.',
    humanActionRequired: false,
    retryable: false,
  },
  PSP_AGENT_IMPORT_CONFIRMATION_REQUIRED: {
    message: 'Review the agent and confirm before it is added to your workspace.',
    nextAction: 'Read the preview, then confirm the import.',
    humanActionRequired: true,
    retryable: true,
  },
  PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE: {
    message: 'The entitlement service is unavailable, so the ID could not be checked.',
    nextAction: 'Try again shortly. Nothing was imported and nothing was redeemed.',
    humanActionRequired: false,
    retryable: true,
  },
  PSP_AGENT_IMPORT_RATE_LIMITED: {
    message: 'Too many import attempts. Further attempts are paused.',
    nextAction: 'Wait for the cooldown to pass, then try once with the correct ID.',
    humanActionRequired: false,
    retryable: true,
  },
  PSP_AGENT_SECRET_STORAGE_FAILED: {
    message: 'The credential could not be stored securely, so the import was stopped.',
    nextAction: 'Try again. If it keeps failing, contact support — nothing was imported.',
    humanActionRequired: false,
    retryable: true,
  },
  PSP_AGENT_IMPORT_FAILED: {
    message: 'The import did not complete.',
    nextAction: 'Try again. Nothing was added to your workspace.',
    humanActionRequired: false,
    retryable: true,
  },
};

/**
 * The ONLY way to build a PSP import error. `pspAgentId` is the PUBLIC product
 * identifier; passing anything credential-shaped is a programming error and is
 * dropped rather than echoed.
 */
export function pspImportError(
  code: PSPAgentImportErrorCode,
  pspAgentId?: string,
): PSPAgentImportError {
  const shape = SHAPES[code];
  // Defence in depth: a public identifier is short and has no dashes. Anything
  // longer or credential-shaped is discarded rather than attached.
  const safeId = typeof pspAgentId === 'string' && /^[0-9A-Z]{1,16}$/.test(pspAgentId)
    ? pspAgentId
    : undefined;
  return {
    code,
    message: shape.message,
    ...(safeId ? { pspAgentId: safeId } : {}),
    nextAction: shape.nextAction,
    humanActionRequired: shape.humanActionRequired,
    retryable: shape.retryable,
  };
}

/** Discriminated result used across the whole PSP domain. */
export type PSPResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PSPAgentImportError };

export const pspOk = <T>(value: T): PSPResult<T> => ({ ok: true, value });
export const pspFail = <T>(
  code: PSPAgentImportErrorCode,
  pspAgentId?: string,
): PSPResult<T> => ({ ok: false, error: pspImportError(code, pspAgentId) });
