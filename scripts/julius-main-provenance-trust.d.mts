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
export declare const CHECKPOINT_ATTESTATION_DIR: string;
export declare const INSTALLER_RECOVERY: string;
export declare const ATTESTATION_ISSUED: string;
export declare const ATTESTATION_EXPIRES: string;
export declare const HISTORICAL_TCB: readonly { readonly path: string; readonly sha256: string }[];

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
  readonly tcb?: readonly { readonly path: string; readonly sha256: string }[];
}): string;

export declare function attestationNonce(commits: readonly { readonly sha?: string; readonly tree?: string }[], tcb?: readonly { readonly path?: string; readonly sha256?: string }[]): string;
export declare function attestationNonceProblems(fields: { readonly nonce?: string; readonly commits?: readonly { readonly sha?: string; readonly tree?: string }[]; readonly tcb?: readonly { readonly path?: string; readonly sha256?: string }[] } | undefined): string | null;
export declare function judgeAttestationWindow(fields: { readonly issued?: string; readonly expires?: string } | undefined, now: number): string | null;
export declare const CHECKPOINT_INSTALLER_EXACT_PATHS: readonly string[];
export declare function isCheckpointInstallerDiff(paths: unknown): boolean;
export declare function judgeClearanceWindow(fields: { readonly issued?: string; readonly expires?: string } | undefined, now: number): string | null;

export interface LandingJudgement {
  readonly ok: boolean;
  readonly absent: boolean;
  readonly reason: string;
  readonly nonce?: string;
  readonly pr?: string;
  readonly head?: string;
}

export declare function judgeCommitLanding(commit: {
  readonly message?: unknown;
  readonly tree?: unknown;
  readonly parent?: unknown;
  readonly parentCount?: unknown;
  readonly headTree?: unknown;
  readonly headParent?: unknown;
  readonly headParentCount?: unknown;
  readonly paths?: unknown;
}, options?: {
  readonly pem?: unknown;
  readonly anchor?: unknown;
  readonly now?: unknown;
  readonly seenNonces?: Set<string>;
}): Promise<LandingJudgement>;

export declare function annotateChainLandings<T>(commits: readonly T[], options?: {
  readonly pem?: unknown;
  readonly anchor?: unknown;
  readonly now?: unknown;
  readonly seenNonces?: Set<string>;
}): Promise<T[]>;

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
    readonly tcb: readonly { readonly path?: string; readonly sha256?: string }[];
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

export declare function classifyCommit(commit: { readonly sha?: string; readonly tree?: string; readonly signedLanding?: boolean; readonly signedG6?: boolean; readonly touchesVerifier?: boolean; readonly paths?: readonly string[] }): ChainClassification;
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
  readonly now?: unknown;
}): TrustChainResult;

export declare function applyTrustChain<T extends { readonly verdict?: string; readonly reason?: string }>(single: T, chain: TrustChainResult): T;
export declare function readCheckpointAttestation(root?: string): { readonly text: string; readonly signatureB64: string | null; readonly fileName: string; readonly path: string } | null;
export declare function attestedCheckpointFloor(root?: string, env?: NodeJS.ProcessEnv, now?: number): string | null;
export declare function attestationWorktreeMatchesHead(root?: string): Promise<{ readonly ok: boolean; readonly reason: string }>;
export declare function requireTrustedVerifier(env?: NodeJS.ProcessEnv, options?: { readonly root?: string; readonly now?: number }): Promise<{ readonly ok: boolean; readonly reason: string }>;
