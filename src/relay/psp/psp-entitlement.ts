/**
 * PSP AGENT ID — entitlement model (PURE, browser-safe, shared verbatim).
 *
 * An entitlement is the RECORD OF AUTHORITY: who may import which PSP agent
 * version, how they got it, and whether that authority is still live. It is
 * deliberately separate from the credential itself.
 *
 *   PSPAgentEntitlement        business facts. Holds a FINGERPRINT only.
 *   PSPAgentCredentialRecord   the secret verifier (salt + digest). Separate
 *                              store, separate lifetime, never rendered.
 *
 * This mirrors the repository's existing credential architecture, where
 * `src/relay/mission/credential-handle.ts` never contains a credential value:
 * scope, expiration and revocation live in the domain, secret material does
 * not. Nothing here is weaker than that boundary — it is the same rule applied
 * to a bearer credential, with the verifier isolated in its own record.
 *
 * REDEMPTION POLICY: ONE-TIME REDEMPTION BOUND TO AN ACCOUNT AND WORKSPACE.
 * A PSP Agent ID may be redeemed once. Redemption binds the entitlement to the
 * redeeming user and workspace; the credential is then spent and a replay is
 * rejected with PSP_AGENT_ID_ALREADY_REDEEMED. This is the safer of the two
 * policies in the specification and is chosen deliberately: it makes an
 * intercepted ID useless after first use and makes unlimited anonymous sharing
 * impossible.
 *
 * TRANSFER ROTATES THE CREDENTIAL. The old secret is destroyed and superseded;
 * the new holder receives a NEW credential. The same active bearer secret is
 * never handed between users.
 *
 * Time is always an INJECTED ISO string — this module has no clock.
 */

import {
  maskFromPublicIdentity,
  parsePspAgentId,
  pspAgentIdFingerprint,
  pspAgentIdMatchesVerifier,
  pspAgentIdVerifier,
  PSP_AGENT_ID_PRODUCTION_VERSIONS,
} from './psp-agent-id';
import { pspFail, pspOk, type PSPResult } from './psp-errors';

/* ------------------------------- model --------------------------------- */

export type PSPAcquisitionType =
  | 'purchase'
  | 'trade'
  | 'transfer'
  | 'creator_grant'
  | 'admin_grant'
  | 'development_fixture';

export type PSPEntitlementStatus =
  | 'issued'
  | 'active'
  | 'redeemed'
  | 'transferred'
  | 'revoked'
  | 'expired'
  | 'disputed';

export interface PSPAgentEntitlement {
  entitlementId: string;
  /** PUBLIC product identity. Safe to display, log and trace. */
  pspAgentId: string;
  pspId: string;
  pspVersionId: string;

  acquisitionType: PSPAcquisitionType;
  status: PSPEntitlementStatus;

  issuedToUserId?: string;
  currentHolderUserId?: string;

  issuedAt: string;
  redeemedAt?: string;
  transferredAt?: string;
  revokedAt?: string;
  expiresAt?: string;

  credentialVersion: string;
  /** NON-REVERSIBLE fingerprint. NEVER the credential, never the verifier. */
  credentialFingerprint: string;

  marketplaceTransactionId?: string;
  tradeTransactionId?: string;

  /** Set at redemption — one-time redemption binds to an account+workspace. */
  redeemedByUserId?: string;
  redeemedIntoWorkspaceId?: string;
  /** Set when a transfer rotated this credential away. */
  supersededByEntitlementId?: string;
}

/**
 * The secret verifier, kept apart from the entitlement record so a leak of
 * business data can never leak import authority. Even this record does not
 * contain the credential: only a per-entitlement salt and a salted digest.
 */
export interface PSPAgentCredentialRecord {
  entitlementId: string;
  credentialVersion: string;
  /** Per-entitlement salt — makes every verifier unique to its entitlement. */
  salt: string;
  /** Salted, domain-separated digest of the normalized credential. */
  verifier: string;
  createdAt: string;
  /** Set when the secret is spent (redeemed) or rotated away (transferred). */
  retiredAt?: string;
}

/* ------------------------------ issuance ------------------------------- */

export interface IssueEntitlementInput {
  entitlementId: string;
  pspId: string;
  pspVersionId: string;
  acquisitionType: PSPAcquisitionType;
  /** The full credential. Consumed here and NEVER stored. */
  credential: string;
  issuedToUserId?: string;
  issuedAt: string;
  expiresAt?: string;
  marketplaceTransactionId?: string;
  tradeTransactionId?: string;
  /** Caller-supplied salt (deterministic in tests, random in production). */
  salt: string;
}

export interface IssuedEntitlement {
  entitlement: PSPAgentEntitlement;
  credentialRecord: PSPAgentCredentialRecord;
}

/**
 * Issue an entitlement for a credential. The raw credential enters this
 * function and does not leave it: only the public identity, a fingerprint and
 * a salted verifier survive.
 */
export function issueEntitlement(input: IssueEntitlementInput): PSPResult<IssuedEntitlement> {
  const parsed = parsePspAgentId(input.credential);
  if (!parsed.ok) return pspFail('PSP_AGENT_ID_INVALID_FORMAT');
  const { pspAgentId, credentialVersion } = parsed.value;

  const entitlement: PSPAgentEntitlement = {
    entitlementId: input.entitlementId,
    pspAgentId,
    pspId: input.pspId,
    pspVersionId: input.pspVersionId,
    acquisitionType: input.acquisitionType,
    status: 'active',
    ...(input.issuedToUserId ? { issuedToUserId: input.issuedToUserId } : {}),
    ...(input.issuedToUserId ? { currentHolderUserId: input.issuedToUserId } : {}),
    issuedAt: input.issuedAt,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    credentialVersion,
    credentialFingerprint: pspAgentIdFingerprint(input.credential),
    ...(input.marketplaceTransactionId
      ? { marketplaceTransactionId: input.marketplaceTransactionId } : {}),
    ...(input.tradeTransactionId ? { tradeTransactionId: input.tradeTransactionId } : {}),
  };

  const credentialRecord: PSPAgentCredentialRecord = {
    entitlementId: input.entitlementId,
    credentialVersion,
    salt: input.salt,
    verifier: pspAgentIdVerifier(input.credential, input.salt),
    createdAt: input.issuedAt,
  };

  return pspOk({ entitlement, credentialRecord });
}

/* ------------------------------ evaluation ----------------------------- */

/**
 * Is this entitlement usable RIGHT NOW, by this actor? Order matters: the most
 * specific, most actionable failure wins, and expiry is evaluated before
 * ownership so an expired credential never reports as someone else's.
 */
export function evaluateEntitlement(input: {
  entitlement: PSPAgentEntitlement;
  actorUserId: string;
  now: string;
  /** Production services refuse development-fixture credential versions. */
  productionMode: boolean;
}): PSPResult<PSPAgentEntitlement> {
  const e = input.entitlement;
  const id = e.pspAgentId;

  if (input.productionMode && !PSP_AGENT_ID_PRODUCTION_VERSIONS.includes(e.credentialVersion)) {
    // A development fixture reached a production validator: refuse outright.
    return pspFail('PSP_AGENT_ID_INVALID', id);
  }

  switch (e.status) {
    case 'revoked': return pspFail('PSP_AGENT_ID_REVOKED', id);
    case 'expired': return pspFail('PSP_AGENT_ID_EXPIRED', id);
    case 'disputed': return pspFail('PSP_AGENT_ID_DISPUTED', id);
    case 'transferred': return pspFail('PSP_AGENT_ID_TRANSFERRED', id);
    case 'redeemed': return pspFail('PSP_AGENT_ID_ALREADY_REDEEMED', id);
    default: break;
  }

  if (e.expiresAt !== undefined && e.expiresAt <= input.now) {
    return pspFail('PSP_AGENT_ID_EXPIRED', id);
  }
  if (e.currentHolderUserId !== undefined && e.currentHolderUserId !== input.actorUserId) {
    return pspFail('PSP_AGENT_ENTITLEMENT_NOT_OWNED', id);
  }

  return pspOk(e);
}

/**
 * Verify a presented credential against the stored verifier, in constant time.
 * The credential is never persisted, echoed or returned.
 *
 * This answers AUTHENTICITY only ("is this the secret this entitlement was
 * issued for?"), deliberately ignoring retirement. Whether the entitlement may
 * still be USED is `evaluateEntitlement`'s question — keeping the two separate
 * is what lets a replayed credential be reported as ALREADY REDEEMED rather
 * than as an unrecognized ID, which would be both untrue and unhelpful.
 */
export function credentialMatchesEntitlement(
  credential: string,
  record: PSPAgentCredentialRecord,
): boolean {
  return pspAgentIdMatchesVerifier(credential, record.salt, record.verifier);
}

/** True once the secret has been spent (redeemed) or rotated away
 *  (transferred/revoked). A retired secret must never authorize an import. */
export function credentialRecordIsRetired(record: PSPAgentCredentialRecord): boolean {
  return record.retiredAt !== undefined;
}

/* ----------------------------- transitions ----------------------------- */

/** One-time redemption: binds the entitlement to an account + workspace and
 *  spends the credential. */
export function redeemEntitlement(input: {
  entitlement: PSPAgentEntitlement;
  credentialRecord: PSPAgentCredentialRecord;
  userId: string;
  workspaceId: string;
  now: string;
}): IssuedEntitlement {
  return {
    entitlement: {
      ...input.entitlement,
      status: 'redeemed',
      redeemedAt: input.now,
      redeemedByUserId: input.userId,
      redeemedIntoWorkspaceId: input.workspaceId,
      currentHolderUserId: input.userId,
    },
    credentialRecord: { ...input.credentialRecord, retiredAt: input.now },
  };
}

export function revokeEntitlement(input: {
  entitlement: PSPAgentEntitlement;
  credentialRecord: PSPAgentCredentialRecord;
  now: string;
}): IssuedEntitlement {
  return {
    entitlement: { ...input.entitlement, status: 'revoked', revokedAt: input.now },
    credentialRecord: { ...input.credentialRecord, retiredAt: input.now },
  };
}

export function disputeEntitlement(
  entitlement: PSPAgentEntitlement,
): PSPAgentEntitlement {
  return { ...entitlement, status: 'disputed' };
}

export function expireEntitlement(
  entitlement: PSPAgentEntitlement,
  now: string,
): PSPAgentEntitlement {
  return { ...entitlement, status: 'expired', expiresAt: entitlement.expiresAt ?? now };
}

export interface TransferEntitlementInput {
  entitlement: PSPAgentEntitlement;
  credentialRecord: PSPAgentCredentialRecord;
  toUserId: string;
  now: string;
  /** Identity of the replacement entitlement. */
  newEntitlementId: string;
  /** The NEW credential minted for the new holder. Consumed, never stored. */
  newCredential: string;
  newSalt: string;
  tradeTransactionId?: string;
  /** 'trade' when money/goods changed hands, otherwise 'transfer'. */
  acquisitionType?: Extract<PSPAcquisitionType, 'trade' | 'transfer'>;
}

export interface TransferredEntitlement {
  /** The OLD entitlement, now inert: status transferred, credential retired. */
  previous: IssuedEntitlement;
  /** The NEW entitlement and its freshly rotated credential verifier. */
  next: IssuedEntitlement;
}

/**
 * Transfer a PSP agent to a new holder. The old credential is RETIRED and its
 * entitlement marked `transferred`; a NEW entitlement with a NEW credential is
 * issued to the new holder. The previous secret is never reused and never
 * remains usable — the old holder loses import authority the moment this
 * returns. Ownership history stays auditable through
 * `supersededByEntitlementId`.
 */
export function transferEntitlement(
  input: TransferEntitlementInput,
): PSPResult<TransferredEntitlement> {
  const issued = issueEntitlement({
    entitlementId: input.newEntitlementId,
    pspId: input.entitlement.pspId,
    pspVersionId: input.entitlement.pspVersionId,
    acquisitionType: input.acquisitionType ?? 'transfer',
    credential: input.newCredential,
    issuedToUserId: input.toUserId,
    issuedAt: input.now,
    ...(input.entitlement.expiresAt ? { expiresAt: input.entitlement.expiresAt } : {}),
    ...(input.tradeTransactionId ? { tradeTransactionId: input.tradeTransactionId } : {}),
    salt: input.newSalt,
  });
  if (!issued.ok) return pspFail(issued.error.code, input.entitlement.pspAgentId);

  // The PUBLIC product identity is stable across a transfer: it names the
  // product, not the holder. Only the secret authority rotates.
  const next: IssuedEntitlement = {
    entitlement: { ...issued.value.entitlement, pspAgentId: input.entitlement.pspAgentId },
    credentialRecord: issued.value.credentialRecord,
  };

  const previous: IssuedEntitlement = {
    entitlement: {
      ...input.entitlement,
      status: 'transferred',
      transferredAt: input.now,
      currentHolderUserId: input.toUserId,
      supersededByEntitlementId: input.newEntitlementId,
    },
    credentialRecord: { ...input.credentialRecord, retiredAt: input.now },
  };

  return pspOk({ previous, next });
}

/* ------------------------------ safe views ----------------------------- */

/** The masked, display-safe view of an entitlement. This is the ONLY shape
 *  that may reach a UI, a terminal, a log or a support conversation. */
export interface SafePSPEntitlementView {
  entitlementId: string;
  pspAgentId: string;
  pspId: string;
  pspVersionId: string;
  acquisitionType: PSPAcquisitionType;
  status: PSPEntitlementStatus;
  /** e.g. PSP-AGENT-1-RLY8K2-•••••••••••••••• */
  maskedAgentId: string;
  credentialFingerprint: string;
  issuedAt: string;
  expiresAt?: string;
}

export function safeEntitlementView(e: PSPAgentEntitlement): SafePSPEntitlementView {
  return {
    entitlementId: e.entitlementId,
    pspAgentId: e.pspAgentId,
    pspId: e.pspId,
    pspVersionId: e.pspVersionId,
    acquisitionType: e.acquisitionType,
    status: e.status,
    maskedAgentId: maskFromPublicIdentity(e.credentialVersion, e.pspAgentId),
    credentialFingerprint: e.credentialFingerprint,
    issuedAt: e.issuedAt,
    ...(e.expiresAt ? { expiresAt: e.expiresAt } : {}),
  };
}
