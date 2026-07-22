import { relayError, type RelayError } from './errors';

/**
 * Branded identifiers (PROTOCOL.md §0). Ids are opaque strings with stable
 * prefixes; the brand makes them non-interchangeable at the type level.
 * Client-generated `commandId`/`queryId` are exempt from the prefix
 * convention (any non-empty string ≤ 200 chars). Never derive ids from
 * credentials or sensitive material.
 */

declare const brand: unique symbol;
export type Branded<B extends string> = string & { readonly [brand]: B };

export type ProjectId = Branded<'prj'>;
export type RunId = Branded<'run'>;
export type TaskId = Branded<'tsk'>;
export type PackageId = Branded<'pkg'>;
export type EventId = Branded<'evt'>;
export type EvidenceId = Branded<'evd'>;
export type BundleId = Branded<'bnd'>;
export type ReportId = Branded<'rpt'>;
export type BlueprintId = Branded<'blu'>;
export type VerificationId = Branded<'vrf'>;
export type FailureId = Branded<'flr'>;
export type DecisionId = Branded<'dcn'>;
export type ApprovalId = Branded<'apr'>;
export type QuestionId = Branded<'oqn'>;
export type UsageId = Branded<'use'>;
export type AuditId = Branded<'aud'>;
export type ClaimId = Branded<'clm'>;
export type AssignmentId = Branded<'asn'>;
export type DisagreementId = Branded<'dsg'>;
export type PolicyId = Branded<'pol'>;
export type CompilationRecordId = Branded<'hcr'>;
export type CheckpointId = Branded<'ckp'>;
export type ArtifactId = Branded<'art'>;
export type SessionRefId = Branded<'ses'>;
export type WorkspaceRefId = Branded<'wsp'>;
export type ManualTaskId = Branded<'mtk'>;
export type ManualRequestId = Branded<'mrq'>;
export type CommandId = Branded<'cmd-free'>;
export type QueryId = Branded<'qry-free'>;
export type CorrelationId = Branded<'cor-free'>;
export type IdempotencyKey = Branded<'idk-free'>;

/** Monotonic per-project ledger version (== highest appended sequence). */
export type LedgerVersion = number & { readonly [brand]: 'ledger-version' };
/** Ledger version at which consumed context was selected (PROTOCOL §0). */
export type ContextVersion = number & { readonly [brand]: 'context-version' };

export const PREFIXES = {
  prj: 'prj_', run: 'run_', tsk: 'tsk_', pkg: 'pkg_', evt: 'evt_', evd: 'evd_',
  bnd: 'bnd_', rpt: 'rpt_', blu: 'blu_', vrf: 'vrf_', flr: 'flr_', dcn: 'dcn_',
  apr: 'apr_', oqn: 'oqn_', use: 'use_', aud: 'aud_', clm: 'clm_', asn: 'asn_',
  dsg: 'dsg_', pol: 'pol_', hcr: 'hcr_', ckp: 'ckp_', art: 'art_', ses: 'ses_',
  wsp: 'wsp_', mtk: 'mtk_', mrq: 'mrq_',
} as const;

export type IdPrefix = keyof typeof PREFIXES;

const ID_BODY = /^[A-Za-z0-9_-]{1,190}$/;

/** Validate a prefixed id. Returns null when valid. */
export function checkId(value: unknown, prefix: IdPrefix, field: string): RelayError | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return relayError('validation-failed', `\`${field}\` must be a non-empty string id.`);
  }
  const p = PREFIXES[prefix];
  if (!value.startsWith(p) || !ID_BODY.test(value.slice(p.length))) {
    return relayError('validation-failed', `\`${field}\` must match ${p}<token>.`);
  }
  return null;
}

/** Free-form ids (commandId, queryId, correlationId, idempotencyKey). */
export function checkFreeId(value: unknown, field: string): RelayError | null {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) {
    return relayError('validation-failed', `\`${field}\` must be a non-empty string (≤ 200 chars).`);
  }
  return null;
}

export function checkVersionNumber(value: unknown, field: string): RelayError | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return relayError('validation-failed', `\`${field}\` must be a non-negative integer.`);
  }
  return null;
}

export interface IdFactory {
  next<P extends IdPrefix>(prefix: P): Branded<P>;
}

/** Production id generation (crypto-random). Tests inject a deterministic
 * factory instead (src/relay/testing/factories.ts) — the two are separable
 * by construction: pure logic never calls this directly. */
export function createRandomIdFactory(): IdFactory {
  return {
    next(prefix) {
      const token =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      return `${PREFIXES[prefix]}${token}` as Branded<typeof prefix>;
    },
  };
}
