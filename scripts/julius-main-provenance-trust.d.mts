/**
 * Type declarations for the reviewed-main trust root.
 * The implementation is scripts/julius-main-provenance-trust.mjs.
 */

export declare const TRUSTED_CHECKPOINT_SHA: string;
export declare const TRUSTED_CHECKPOINT_TREE: string;
export declare const TRUSTED_CHECKPOINT_HEAD: string;
export declare const TRUSTED_CHECKPOINT_BASE: string;
export declare const TRUSTED_CHECKPOINT_PR: number;
export declare const TRUSTED_CHECKPOINT_ACCEPT_RUN: string;
export declare const PINNED_REVIEWER_SPKI_SHA256: string;
export declare const PINNED_REVIEWER_RAW_KEY: string;
export declare const REVIEWER_KEY_INTRODUCED_IN: string;
export declare const LANDING_REPO: string;
export declare const CHECKPOINT_HEADER: string;
export declare const EXTERNAL_ANCHOR_VARIABLE: string;
export declare const TRUSTED_COMPUTING_BASE: readonly string[];

export declare function exactFingerprintMatch(actual: unknown, expected: unknown): boolean;

export interface ReviewerKeyMaterial {
  readonly key: unknown;
  readonly spkiSha256: string;
  readonly rawHex: string;
  readonly problem?: undefined;
}

export declare function reviewerKeyMaterial(pem: unknown):
  | ReviewerKeyMaterial
  | { readonly problem: string; readonly key?: undefined; readonly spkiSha256?: undefined; readonly rawHex?: undefined };

export declare function reviewerKeyPinRefusal(pem: unknown, externalAnchor: unknown):
  | null
  | { readonly verdict: 'unprovenanced' | 'indeterminate'; readonly reason: string };

export interface RecordedCommit {
  readonly sha: string;
  readonly tree: string;
  readonly pr: number;
  readonly classification: string;
  readonly touchesVerifier: boolean;
  readonly basis: string;
}

export declare const RECORDED_RANGE: readonly RecordedCommit[];

export declare function canonicalCheckpointAttestation(fields?: {
  readonly prior?: string;
  readonly commits?: readonly { readonly sha: string; readonly tree: string; readonly basis: string }[];
  readonly checkpoint?: string;
  readonly repo?: string;
  readonly keySpkiSha256?: string;
  readonly nonce?: string;
  readonly issued?: string;
  readonly expires?: string;
  readonly by?: string;
}): string;

export interface ParsedCheckpoint {
  readonly problems: string[];
  readonly fields: {
    readonly repo?: string;
    readonly prior?: string;
    readonly checkpoint?: string;
    readonly keySpkiSha256?: string;
    readonly nonce?: string;
    readonly issued?: string;
    readonly expires?: string;
    readonly by?: string;
    readonly count?: number;
    readonly commits: readonly { readonly sha?: string; readonly tree?: string; readonly basis?: string }[];
  };
}

export declare function parseCheckpointAttestation(text: unknown): ParsedCheckpoint;
export declare function commitsMatch(actual: unknown, listed: unknown): boolean;
export declare function attestationCoversCommits(parsed: ParsedCheckpoint, commits: readonly { readonly sha?: string; readonly tree?: string }[], prior: string): boolean;

export interface ChainClassification {
  readonly sha?: string;
  readonly tree?: string;
  readonly classification: string;
  readonly provenant: boolean;
  readonly touchesVerifier: boolean;
  readonly basis?: string;
  readonly reason: string;
}

export declare function classifyCommit(commit: { readonly sha?: string; readonly tree?: string; readonly signedLanding?: boolean; readonly signedG6?: boolean; readonly touchesVerifier?: boolean }): ChainClassification;
export declare function classifyRecordedRange(): ChainClassification[];

export interface TrustChainResult {
  readonly accepted: boolean;
  readonly tipProvenant: boolean;
  readonly reason: string;
  readonly classifications: readonly ChainClassification[];
}

export declare function evaluateTrustChain(input: {
  readonly tipSha?: unknown;
  readonly tipTree?: unknown;
  readonly commits?: unknown;
  readonly attestationText?: unknown;
  readonly signatureB64?: unknown;
  readonly reviewerKeyPem?: unknown;
  readonly externalAnchor?: unknown;
}): TrustChainResult;

export declare function applyTrustChain<T extends { readonly verdict?: string; readonly reason?: string }>(single: T, chain: TrustChainResult): T;
export declare function requireTrustedVerifier(env?: NodeJS.ProcessEnv): { readonly ok: boolean; readonly reason: string };
