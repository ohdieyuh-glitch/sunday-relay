/**
 * Repeated-failure + no-progress detection (Prompt 3, Sections 18–19).
 * Purely deterministic over structured, safe inputs — no AI model, no raw
 * environment output, no secrets in fingerprints. The fingerprint is a
 * deterministic test/dedup key, NOT a cryptographic integrity signature.
 */

export interface FailureFingerprintInput {
  category: string;
  errorCode?: string;
  commandIdentity?: string;
  failedTestIds?: string[];
  exitCode?: number;
  repoRevision: string;
  taskId: string;
  diffFingerprint?: string;
}

/** djb2 over a canonical JSON of SAFE structured fields only. */
export function failureFingerprint(input: FailureFingerprintInput): string {
  const canonical = JSON.stringify({
    category: input.category,
    errorCode: input.errorCode ?? null,
    commandIdentity: input.commandIdentity ?? null,
    failedTestIds: [...(input.failedTestIds ?? [])].sort(),
    exitCode: input.exitCode ?? null,
    taskId: input.taskId,
  });
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) hash = ((hash << 5) + hash + canonical.charCodeAt(i)) >>> 0;
  return `ff_${hash.toString(16)}`;
}

export type RepeatedFailureOutcome = 'first_occurrence' | 'repeated' | 'repeated_after_repair' | 'materially_changed' | 'unavailable';

export interface RepeatedFailureDecision {
  outcome: RepeatedFailureOutcome;
  matchingFingerprints: string[];
  sameRevision: boolean;
  safeSummary: string;
}

export interface FailureHistoryEntry {
  fingerprint: string;
  repoRevision: string;
  afterRepair: boolean;
}

export function detectRepeatedFailure(
  history: readonly FailureHistoryEntry[],
  current: { fingerprint: string; repoRevision: string; afterRepair: boolean } | null,
): RepeatedFailureDecision {
  if (!current) {
    return { outcome: 'unavailable', matchingFingerprints: [], sameRevision: false, safeSummary: 'No structured failure data to compare.' };
  }
  const matches = history.filter((h) => h.fingerprint === current.fingerprint);
  if (matches.length === 0) {
    const changed = history.length > 0;
    return {
      outcome: changed ? 'materially_changed' : 'first_occurrence',
      matchingFingerprints: [],
      sameRevision: false,
      safeSummary: changed ? 'Failure signature materially changed from prior attempts.' : 'First occurrence of this failure.',
    };
  }
  const sameRevision = matches.some((m) => m.repoRevision === current.repoRevision);
  const afterRepair = current.afterRepair || matches.some((m) => m.afterRepair);
  return {
    outcome: afterRepair ? 'repeated_after_repair' : 'repeated',
    matchingFingerprints: matches.map((m) => m.fingerprint),
    sameRevision,
    safeSummary: afterRepair
      ? 'Identical failure repeated after the single automatic repair — automatic work must stop.'
      : sameRevision
        ? 'Identical failure repeated on the identical revision.'
        : 'Identical failure repeated on a new revision.',
  };
}

/* --------------------------- no progress -------------------------- */

export type NoProgressOutcome = 'progress' | 'no_progress' | 'insufficient_data';

export interface AttemptSummary {
  diffFingerprint?: string;
  repoRevision?: string;
  evidenceIds: string[];
  blockingFindingIds: string[];
  failureFingerprint?: string;
  reportPayloadFingerprint?: string;
  /** True when the report contains ONLY unsupported completion claims. */
  onlyUnsupportedClaims?: boolean;
}

export interface NoProgressDecision {
  outcome: NoProgressOutcome;
  signals: string[];
  safeSummary: string;
}

export function detectNoProgress(previous: AttemptSummary | null, current: AttemptSummary | null): NoProgressDecision {
  if (!previous || !current) {
    return { outcome: 'insufficient_data', signals: [], safeSummary: 'No prior attempt to compare — conservatively NOT labeled no-progress.' };
  }
  const progress: string[] = [];
  if (current.diffFingerprint && current.diffFingerprint !== previous.diffFingerprint) progress.push('new-diff');
  if (current.repoRevision && current.repoRevision !== previous.repoRevision) progress.push('new-revision');
  if (current.evidenceIds.some((e) => !previous.evidenceIds.includes(e))) progress.push('new-evidence');
  if (current.blockingFindingIds.length < previous.blockingFindingIds.length) progress.push('fewer-blocking-findings');
  if (current.failureFingerprint && previous.failureFingerprint && current.failureFingerprint !== previous.failureFingerprint) progress.push('failure-changed');

  if (progress.length > 0) {
    // An unsupported completion claim alone never counts as progress; every
    // signal above is structural, so any hit is genuine.
    return { outcome: 'progress', signals: progress, safeSummary: `Progress: ${progress.join(', ')}.` };
  }

  const comparable = Boolean(
    (previous.diffFingerprint && current.diffFingerprint) ||
      (previous.failureFingerprint && current.failureFingerprint) ||
      (previous.reportPayloadFingerprint && current.reportPayloadFingerprint),
  );
  if (!comparable) {
    return { outcome: 'insufficient_data', signals: [], safeSummary: 'Not enough structured comparison data — conservatively NOT labeled no-progress.' };
  }
  const signals: string[] = [];
  if (current.diffFingerprint === previous.diffFingerprint) signals.push('identical-diff');
  if (current.failureFingerprint === previous.failureFingerprint) signals.push('identical-failure');
  if (current.reportPayloadFingerprint === previous.reportPayloadFingerprint) signals.push('identical-report');
  if (current.onlyUnsupportedClaims) signals.push('only-unsupported-claims');
  return { outcome: 'no_progress', signals, safeSummary: `No material change: ${signals.join(', ')}.` };
}
