/**
 * Admission run ids are parsed only by `scripts/julius-admission-run-id.mjs`,
 * the copy of PR #434. This file classifies a pair. It does not mint an id
 * and it does not keep a second pattern.
 */

import {
  deriveJuliusSpentTag,
  parseJuliusAdmissionRunId,
  WLJ_RUN_ID_PATTERN,
} from '../../../../scripts/julius-admission-run-id.mjs';

export { deriveJuliusSpentTag, parseJuliusAdmissionRunId, WLJ_RUN_ID_PATTERN };

export type AdmissionRunIdentity =
  | {
    readonly ok: true;
    readonly form: 'wlj';
    readonly serverRunId: string;
    readonly legacyRunId: null;
    readonly wljRunId: string;
  }
  | {
    readonly ok: true;
    readonly form: 'legacy';
    readonly serverRunId: string;
    readonly legacyRunId: string;
    readonly wljRunId: string;
  }
  | {
    readonly ok: false;
    readonly reason: 'admission_run_id_required' | 'admission_run_id_malformed' | 'admission_run_id_ambiguous';
  };

/**
 * A new row is one `wlj_` id in both fields. A legacy row is a `wlj_` client
 * id plus a `run:` server id. Two different ids of one form, a `run:` where
 * the client id belongs, or any value the shared module cannot parse, fail
 * closed.
 */
export function identifyAdmissionRun(runId: unknown, serverRunId: unknown): AdmissionRunIdentity {
  const run = parseJuliusAdmissionRunId(runId);
  const server = parseJuliusAdmissionRunId(serverRunId);
  if (!run.ok) return { ok: false, reason: run.reason };
  if (!server.ok) return { ok: false, reason: server.reason };
  if (run.form === 'wlj' && server.form === 'wlj') {
    if (run.runId !== server.runId) return { ok: false, reason: 'admission_run_id_ambiguous' };
    return { ok: true, form: 'wlj', serverRunId: run.runId, legacyRunId: null, wljRunId: run.runId };
  }
  if (run.form === 'wlj' && server.form === 'legacy') {
    return {
      ok: true,
      form: 'legacy',
      serverRunId: server.runId,
      legacyRunId: server.runId,
      wljRunId: run.runId,
    };
  }
  return { ok: false, reason: 'admission_run_id_ambiguous' };
}

/** `julius-run-spent-` plus 32 hex for `wlj_`, or 24 hex for a legacy `run:` id. */
export function spentLockName(value: unknown): string {
  const derived = deriveJuliusSpentTag(value);
  if (!derived.ok) throw new Error('run_id_invalid');
  return `julius-run-spent-${derived.suffix}`;
}
