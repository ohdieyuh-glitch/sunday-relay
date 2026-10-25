export const WLJ_RUN_ID_PATTERN: string;
export const LEGACY_RUN_ID_PATTERN: string;

export function parseJuliusAdmissionRunId(value: unknown):
  | { ok: true; form: 'wlj' | 'legacy'; runId: string }
  | { ok: false; reason: 'admission_run_id_required' | 'admission_run_id_malformed' };

export function deriveJuliusSpentTag(value: unknown):
  | {
    ok: true;
    form: 'wlj' | 'legacy';
    runId: string;
    suffix: string;
    tag: string;
    concurrencyGroup: string;
  }
  | { ok: false; reason: 'admission_run_id_required' | 'admission_run_id_malformed' };
