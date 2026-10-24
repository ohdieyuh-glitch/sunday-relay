import { createHash } from 'node:crypto';

import { parseJuliusAdmissionRunId } from '../scripts/julius-admission-run-id.mjs';

/**
 * JULIUS COMPANION SLOT.
 *
 * The architect plan may carry at most one `companion_task`: a bounded subtask
 * with acceptance criteria. Julius stamps it with the canonical `wlj_` id.
 * A legacy `run:` id may sit beside it and is read-only. Both forms are
 * recognized only by `scripts/julius-admission-run-id.mjs`. This module never
 * mints an id and never calls a provider. A legacy id cannot start, resume,
 * or claim spend. It hands the task to an injected CompanionPort.
 * BRIDGE's relay is the port that wakes the companion.
 *
 * BYOAI. The companion is the caller's own model. Julius does not call a
 * provider for it, does not host it, and does not relabel it as a Julius role.
 * Companion spend stays out of the run ledger and out of reconciliation.
 * Companion evidence stays off the spend ledger.
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

const SUBTASK_MAX = 400;
const CRITERION_MAX = 200;
const CRITERIA_MAX = 6;
const ARTIFACT_MAX_BYTES = 262_144;

export interface CompanionTaskBody {
  readonly subtask: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface CompanionWakeRequest {
  /** Canonical `wlj_` id. This is the only id the wake is keyed on. */
  readonly runId: string;
  /** Admitted `run:` id, when the pair has one. Read-only. Never starts the wake. */
  readonly legacyRunId: string | null;
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
  submit(input: { readonly runId: string; readonly sha256: string; readonly bytes: Uint8Array }): Promise<{ readonly accepted: boolean; readonly reason: string | null }>;
}

export interface JuliusValidationPort {
  validate(input: { readonly runId: string; readonly sha256: string; readonly bytes: Uint8Array }): { readonly ok: boolean; readonly reason: string | null };
}

/** Reviews the integrated change. Not a provider client and not a direct write. */
export interface ChangeReviewPort {
  review(input: { readonly runId: string; readonly sha256: string }): Promise<{ readonly verdict: 'approve' | 'reject' }>;
}

export interface CompanionClock {
  after(ms: number): Promise<void>;
}

export type CompanionDisposition = 'absent' | 'refused' | 'timed_out' | 'failed' | 'missing' | 'integrated' | 'rejected';

export interface CompanionEvidence {
  /** Canonical `wlj_` id. Empty when the caller did not present one. */
  readonly runId: string;
  /** Legacy `run:` id, recorded and not used to start, resume, or claim spend. */
  readonly legacyRunId: string | null;
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
  runId: string,
  legacyRunId: string | null,
  disposition: CompanionDisposition,
  reason: string | null,
  extra: { readonly wakeId?: string | null; readonly bodyDigest?: string | null; readonly artifactHashes?: readonly string[] } = {},
): CompanionEvidence => ({
  runId,
  legacyRunId,
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
  return { subtask, acceptanceCriteria };
};

interface CompanionIds {
  readonly runId: string;
  readonly legacyRunId: string | null;
}

/** The canonical id is required. A legacy id is accepted only as `legacyRunId`. */
function resolveCompanionIds(runId: unknown, legacyRunId: unknown):
  | { readonly ok: true; readonly ids: CompanionIds }
  | { readonly ok: false; readonly reason: 'companion_run_id_invalid' | 'companion_legacy_read_only'; readonly legacyRunId: string | null } {
  const canonical = parseJuliusAdmissionRunId(runId);
  if (!canonical.ok) return { ok: false, reason: 'companion_run_id_invalid', legacyRunId: null };
  if (canonical.form === 'legacy') return { ok: false, reason: 'companion_legacy_read_only', legacyRunId: canonical.runId };
  if (legacyRunId === undefined || legacyRunId === null || legacyRunId === '') {
    return { ok: true, ids: { runId: canonical.runId, legacyRunId: null } };
  }
  const legacy = parseJuliusAdmissionRunId(legacyRunId);
  if (!legacy.ok || legacy.form !== 'legacy') return { ok: false, reason: 'companion_run_id_invalid', legacyRunId: null };
  return { ok: true, ids: { runId: canonical.runId, legacyRunId: legacy.runId } };
}

function stampedRunId(raw: unknown): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: true, value: null };
  const v = raw as Record<string, unknown>;
  const found = [v.runId, v.serverRunId, v.legacyRunId].filter((item): item is string => typeof item === 'string');
  if (found.length === 0) return { ok: true, value: null };
  if (new Set(found).size !== 1) return { ok: false };
  return { ok: true, value: found[0] ?? null };
}

/** One optional task, or a refusal. A plan with no companion task is absent, which is valid. */
export function readCompanionTask(plan: unknown, runId: string, legacyRunId: string | null = null): Read {
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
    return acceptOne(single[0], runId, legacyRunId);
  }
  return acceptOne(single, runId, legacyRunId);
}

function acceptOne(raw: unknown, runId: string, legacyRunId: string | null): Read {
  const stamp = stampedRunId(raw);
  if (!stamp.ok) return { kind: 'refused', reason: 'companion_run_id_invalid' };
  if (stamp.value !== null) {
    const parsed = parseJuliusAdmissionRunId(stamp.value);
    if (!parsed.ok) return { kind: 'refused', reason: 'companion_run_id_invalid' };
    const matchesCanonical = parsed.form === 'wlj' && parsed.runId === runId;
    const matchesLegacy = legacyRunId !== null && parsed.form === 'legacy' && parsed.runId === legacyRunId;
    if (!matchesCanonical && !matchesLegacy) return { kind: 'refused', reason: 'companion_task_run_mismatch' };
  }
  const body = boundedBody(raw);
  if (body === null) return { kind: 'refused', reason: 'companion_task_invalid' };
  return { kind: 'accepted', body, bodyDigest: bodyDigestOf(body) };
}

export async function runJuliusCompanionSlot(input: {
  readonly plan: unknown;
  readonly runId: string;
  /** Read-only. A legacy id here does not start, resume, or claim spend. */
  readonly legacyRunId?: string | null;
  readonly deadlineMs: number;
  readonly port: CompanionPort;
  readonly clock: CompanionClock;
  readonly integrate: CoderIntegrationPort;
  readonly validate: JuliusValidationPort;
  readonly review: ChangeReviewPort;
}): Promise<CompanionSlotResult> {
  const resolved = resolveCompanionIds(input.runId, input.legacyRunId);
  if (!resolved.ok) return done(evidence('', resolved.legacyRunId, 'refused', resolved.reason), false);
  const ids = resolved.ids;
  const note = (
    disposition: CompanionDisposition,
    reason: string | null,
    extra: { readonly wakeId?: string | null; readonly bodyDigest?: string | null; readonly artifactHashes?: readonly string[] } = {},
  ): CompanionSlotResult => done(evidence(ids.runId, ids.legacyRunId, disposition, reason, extra), disposition === 'rejected' && reason === 'review_rejected');
  if (!Number.isSafeInteger(input.deadlineMs) || input.deadlineMs <= 0) return note('refused', 'companion_deadline_invalid');
  const read = readCompanionTask(input.plan, ids.runId, ids.legacyRunId);
  if (read.kind === 'absent') return note('absent', null);
  if (read.kind === 'refused') return note('refused', read.reason);

  const request: CompanionWakeRequest = {
    runId: ids.runId,
    legacyRunId: ids.legacyRunId,
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
    return done(evidence(ids.runId, ids.legacyRunId, 'timed_out', 'timed_out', { bodyDigest: read.bodyDigest }), false);
  }
  if (winner.kind === 'failed') return done(evidence(ids.runId, ids.legacyRunId, 'failed', 'wake_failed', { bodyDigest: read.bodyDigest }), false);
  open = false;
  const posted = winner.result;
  const wakeId = safeWakeId(posted.wakeId);
  const wakeReason = wakeId === null && posted.wakeId !== '' ? 'wake_id_withheld' : null;
  if (posted.outcome === 'failed') return done(evidence(ids.runId, ids.legacyRunId, 'failed', wakeReason ?? 'wake_failed', { wakeId, bodyDigest: read.bodyDigest }), false);
  if (posted.outcome === 'missing' || posted.artifact === null) {
    return done(evidence(ids.runId, ids.legacyRunId, 'missing', wakeReason ?? 'wake_missing', { wakeId, bodyDigest: read.bodyDigest }), false);
  }
  const bytes = posted.artifact.bytes;
  if (bytes.byteLength === 0 || bytes.byteLength > ARTIFACT_MAX_BYTES) {
    return done(evidence(ids.runId, ids.legacyRunId, 'rejected', 'artifact_rejected', { wakeId, bodyDigest: read.bodyDigest }), false);
  }
  const hash = sha256Bytes(bytes);
  let submitted: { readonly accepted: boolean; readonly reason: string | null };
  try {
    submitted = await input.integrate.submit({ runId: ids.runId, sha256: hash, bytes });
  } catch {
    return done(evidence(ids.runId, ids.legacyRunId, 'rejected', 'integration_rejected', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), false);
  }
  if (!submitted.accepted) {
    return done(evidence(ids.runId, ids.legacyRunId, 'rejected', safeReason(submitted.reason) ?? 'integration_rejected', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), false);
  }
  let validated: { readonly ok: boolean; readonly reason: string | null };
  try {
    validated = input.validate.validate({ runId: ids.runId, sha256: hash, bytes });
  } catch {
    return done(evidence(ids.runId, ids.legacyRunId, 'rejected', 'validation_rejected', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), false);
  }
  if (!validated.ok) {
    return done(evidence(ids.runId, ids.legacyRunId, 'rejected', safeReason(validated.reason) ?? 'validation_rejected', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), false);
  }
  let verdict: { readonly verdict: 'approve' | 'reject' };
  try {
    verdict = await input.review.review({ runId: ids.runId, sha256: hash });
  } catch {
    return done(evidence(ids.runId, ids.legacyRunId, 'rejected', 'review_failed', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), false);
  }
  if (verdict.verdict !== 'approve') {
    return done(evidence(ids.runId, ids.legacyRunId, 'rejected', 'review_rejected', { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), true);
  }
  return done(evidence(ids.runId, ids.legacyRunId, 'integrated', wakeReason, { wakeId, bodyDigest: read.bodyDigest, artifactHashes: [hash] }), true);
}
