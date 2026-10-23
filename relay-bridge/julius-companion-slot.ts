import { createHash } from 'node:crypto';

/**
 * JULIUS COMPANION SLOT.
 *
 * The architect plan may carry at most one `companion_task`: a bounded subtask
 * with acceptance criteria. Julius stamps it with the run's serverRunId and
 * hands it to an injected CompanionPort. This module never calls a provider.
 * BRIDGE's relay is the port that wakes the companion.
 *
 * Julius does not block on the wake. The deadline comes from config. A timeout,
 * a failure, or a missing result lets the mission continue. There is no retry.
 *
 * A posted artifact is untrusted. It enters only through the injected coder
 * integration, then Julius's validation, then the injected review of that
 * change. This module does not write a file and it does not import a reviewer
 * client. Nothing here is charged to a spend ledger, and the request carries
 * no provider key.
 *
 * Evidence keeps the wake id, the body digest, the artifact hashes, and whether
 * the artifact was integrated or rejected and why. A credential-shaped value is
 * withheld. The task body itself is never stored.
 */

const SERVER_RUN_ID = /^run:[0-9a-f]{24}$/u;
const SUBTASK_MAX = 400;
const CRITERION_MAX = 200;
const CRITERIA_MAX = 6;
const ARTIFACT_MAX_BYTES = 262_144;

export interface CompanionTaskBody {
  readonly subtask: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface CompanionWakeRequest {
  readonly serverRunId: string;
  readonly subtask: string;
  readonly acceptanceCriteria: readonly string[];
  readonly bodyDigest: string;
  readonly deadlineMs: number;
}

export interface CompanionArtifact {
  readonly bytes: Uint8Array;
}

export interface CompanionWakeResult {
  readonly wakeId: string;
  readonly outcome: 'posted' | 'failed' | 'missing';
  readonly artifact: CompanionArtifact | null;
}

/** The bridge relay. Julius calls `wake` once and never a provider. */
export interface CompanionPort {
  wake(request: CompanionWakeRequest): Promise<CompanionWakeResult>;
}

export interface CoderIntegrationPort {
  submit(input: { readonly serverRunId: string; readonly sha256: string; readonly bytes: Uint8Array }): Promise<{ readonly accepted: boolean; readonly reason: string | null }>;
}

export interface JuliusValidationPort {
  validate(input: { readonly serverRunId: string; readonly sha256: string; readonly bytes: Uint8Array }): { readonly ok: boolean; readonly reason: string | null };
}

/** Reviews the integrated change. Not a provider client and not a direct write. */
export interface ChangeReviewPort {
  review(input: { readonly serverRunId: string; readonly sha256: string }): Promise<{ readonly verdict: 'approve' | 'reject' }>;
}

export interface CompanionClock {
  after(ms: number): Promise<void>;
}

export type CompanionDisposition = 'absent' | 'refused' | 'timed_out' | 'failed' | 'missing' | 'integrated' | 'rejected';

export interface CompanionEvidence {
  readonly serverRunId: string;
  readonly wakeId: string | null;
  readonly bodyDigest: string | null;
  readonly artifactHashes: readonly string[];
  readonly disposition: CompanionDisposition;
  readonly reason: string | null;
}

export interface CompanionSlotResult {
  readonly evidence: CompanionEvidence;
  readonly missionContinues: true;
  readonly spendUsdMicros: 0;
  readonly reviewed: boolean;
}

export interface JuliusCompanionBinding {
  readonly deadlineMs: number;
  readonly port: CompanionPort;
  readonly clock: CompanionClock;
  readonly integrate: CoderIntegrationPort;
  readonly validate: JuliusValidationPort;
  readonly review: ChangeReviewPort;
}

type Read =
  | { readonly kind: 'absent' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'accepted'; readonly body: CompanionTaskBody; readonly bodyDigest: string };

const sha256Text = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const bodyDigestOf = (body: CompanionTaskBody): string => sha256Text(`${body.subtask}\n${body.acceptanceCriteria.join('\n')}`);

/** A value that would record a credential. The evidence stores a hash or nothing. */
const credentialShaped = (value: string): boolean =>
  /sk-[A-Za-z0-9]/u.test(value)
  || /bearer\s+[A-Za-z0-9]/iu.test(value)
  || /(?:api[_-]?key|password|secret)\s*[:=]/iu.test(value);

const safeReason = (reason: string | null): string | null => {
  if (reason === null) return null;
  if (credentialShaped(reason)) return 'reason_withheld';
  return reason;
};

const safeWakeId = (wakeId: string): string | null => (credentialShaped(wakeId) ? null : wakeId);

const evidence = (
  serverRunId: string,
  disposition: CompanionDisposition,
  reason: string | null,
  extra: { readonly wakeId?: string | null; readonly bodyDigest?: string | null; readonly artifactHashes?: readonly string[] } = {},
): CompanionEvidence => ({
  serverRunId,
  wakeId: extra.wakeId ?? null,
  bodyDigest: extra.bodyDigest ?? null,
  artifactHashes: extra.artifactHashes ?? [],
  disposition,
  reason: safeReason(reason),
});

const done = (row: CompanionEvidence, reviewed: boolean): CompanionSlotResult => ({
  evidence: row,
  missionContinues: true,
  spendUsdMicros: 0,
  reviewed,
});

const planObject = (plan: unknown): Record<string, unknown> | null => {
  if (typeof plan === 'string') {
    try {
      const parsed = JSON.parse(plan) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* a prose plan has no companion task */ }
    return null;
  }
  if (plan !== null && typeof plan === 'object' && !Array.isArray(plan)) return plan as Record<string, unknown>;
  return null;
};

const boundedBody = (raw: unknown): CompanionTaskBody | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.subtask !== 'string') return null;
  const subtask = v.subtask.trim();
  if (subtask.length === 0 || subtask.length > SUBTASK_MAX) return null;
  if (!Array.isArray(v.acceptanceCriteria) || v.acceptanceCriteria.length === 0 || v.acceptanceCriteria.length > CRITERIA_MAX) return null;
  const acceptanceCriteria: string[] = [];
  for (const item of v.acceptanceCriteria) {
    if (typeof item !== 'string') return null;
    const criterion = item.trim();
    if (criterion.length === 0 || criterion.length > CRITERION_MAX) return null;
    acceptanceCriteria.push(criterion);
  }
  if (typeof v.serverRunId === 'string' && !SERVER_RUN_ID.test(v.serverRunId)) return null;
  return { subtask, acceptanceCriteria };
};

/** One optional task, or a refusal. A plan with no companion task is absent, which is valid. */
export function readCompanionTask(plan: unknown, serverRunId: string): Read {
  const obj = planObject(plan);
  if (obj === null) return { kind: 'absent' };
  const plural = obj.companion_tasks;
  const single = obj.companion_task;
  if (plural !== undefined && single !== undefined) return { kind: 'refused', reason: 'second_companion_task_refused' };
  if (Array.isArray(plural) && plural.length > 1) return { kind: 'refused', reason: 'second_companion_task_refused' };
  if (plural !== undefined && !Array.isArray(single)) return { kind: 'refused', reason: 'second_companion_task_refused' };
  if (single === undefined || single === null) return { kind: 'absent' };
  if (Array.isArray(single)) {
    if (single.length > 1) return { kind: 'refused', reason: 'second_companion_task_refused' };
    if (single.length === 0) return { kind: 'refused', reason: 'companion_task_invalid' };
    return acceptOne(single[0], serverRunId);
  }
  return acceptOne(single, serverRunId);
}

function acceptOne(raw: unknown, serverRunId: string): Read {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const stamped = (raw as Record<string, unknown>).serverRunId;
    if (typeof stamped === 'string' && stamped !== serverRunId) return { kind: 'refused', reason: 'companion_task_run_mismatch' };
  }
  const body = boundedBody(raw);
  if (body === null) return { kind: 'refused', reason: 'companion_task_invalid' };
  return { kind: 'accepted', body, bodyDigest: bodyDigestOf(body) };
}

export async function runJuliusCompanionSlot(input: {
  readonly plan: unknown;
  readonly serverRunId: string;
  readonly deadlineMs: number;
  readonly port: CompanionPort;
  readonly clock: CompanionClock;
  readonly integrate: CoderIntegrationPort;
  readonly validate: JuliusValidationPort;
  readonly review: ChangeReviewPort;
}): Promise<CompanionSlotResult> {
  const { serverRunId } = input;
  if (!SERVER_RUN_ID.test(serverRunId)) return done(evidence(serverRunId, 'refused', 'companion_task_run_mismatch'), false);
  if (!Number.isSafeInteger(input.deadlineMs) || input.deadlineMs <= 0) return done(evidence(serverRunId, 'refused', 'companion_deadline_invalid'), false);
  const read = readCompanionTask(input.plan, serverRunId);
  if (read.kind === 'absent') return done(evidence(serverRunId, 'absent', null), false);
  if (read.kind === 'refused') return done(evidence(serverRunId, 'refused', read.reason), false);

  const request: CompanionWakeRequest = {
    serverRunId,
    subtask: read.body.subtask,
    acceptanceCriteria: read.body.acceptanceCriteria,
    bodyDigest: read.bodyDigest,
    deadlineMs: input.deadlineMs,
  };
  let open = true;
  const wake = input.port.wake(request).then(
    (result) => (open ? { kind: 'wake' as const, result } : { kind: 'ignored' as const }),
    () => (open ? { kind: 'failed' as const } : { kind: 'ignored' as const }),
  );
  const winner = await Promise.race([
    wake,
    input.clock.after(input.deadlineMs).then(() => ({ kind: 'timed_out' as const })),
  ]);
  if (winner.kind === 'timed_out' || winner.kind === 'ignored') {
    open = false;
    return done(evidence(serverRunId, 'timed_out', 'timed_out', { bodyDigest: read.bodyDigest }), false);
  }
  if (winner.kind === 'failed') return done(evidence(serverRunId, 'failed', 'wake_failed', { bodyDigest: read.bodyDigest }), false);
  open = false;
  const posted = winner.result;
  const wakeId = safeWakeId(posted.wakeId);
  const wakeReason = wakeId === null && posted.wakeId !== '' ? 'wake_id_withheld' : null;
  if (posted.outcome === 'failed') return done(evidence(serverRunId, 'failed', wakeReason ?? 'wake_failed', { wakeId, bodyDigest: read.bodyDigest }), false);
  if (posted.outcome === 'missing' || posted.artifact === null) {
    return done(evidence(serverRunId, 'missing', wakeReason ?? 'wake_missing', { wakeId, bodyDigest: read.bodyDigest }), false);
  }
  const bytes = posted.artifact.bytes;
  if (bytes.byteLength === 0 || bytes.byteLength > ARTIFACT_MAX_BYTES) {
    return done(evidence(serverRunId, 'rejected', 'artifact_rejected', { wakeId, bodyDigest: read.bodyDigest }), false);
  }
  const hash = sha256Bytes(bytes);
  let submitted: { readonly accepted: boolean; readonly reason: string | null };
  try {
    submitted = await input.integrate.submit({ serverRunId, sha256: hash, bytes });
  } catch {
    return done(evidence(serverRunId, 'rejected', 'integration_rejected', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), false);
  }
  if (!submitted.accepted) {
    return done(evidence(serverRunId, 'rejected', safeReason(submitted.reason) ?? 'integration_rejected', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), false);
  }
  let validated: { readonly ok: boolean; readonly reason: string | null };
  try {
    validated = input.validate.validate({ serverRunId, sha256: hash, bytes });
  } catch {
    return done(evidence(serverRunId, 'rejected', 'validation_rejected', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), false);
  }
  if (!validated.ok) {
    return done(evidence(serverRunId, 'rejected', safeReason(validated.reason) ?? 'validation_rejected', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), false);
  }
  let verdict: { readonly verdict: 'approve' | 'reject' };
  try {
    verdict = await input.review.review({ serverRunId, sha256: hash });
  } catch {
    return done(evidence(serverRunId, 'rejected', 'review_failed', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), false);
  }
  if (verdict.verdict !== 'approve') {
    return done(evidence(serverRunId, 'rejected', 'review_rejected', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), true);
  }
  return done(evidence(serverRunId, 'integrated', wakeReason, { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), true);
}
