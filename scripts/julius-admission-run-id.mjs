/**
 * THE ADMISSION RUN ID THE PAID WORKFLOW MAY LOCK.
 *
 * The canonical id is minted by the Wonderland client: `wlj_` plus a lowercase
 * UUIDv4. A legacy `run:` plus 24 lowercase hex is accepted for an already
 * recorded run. This module never mints either form. A missing value and any
 * other shape are refusals, before a tag name exists.
 *
 * The spent-tag ref is `refs/tags/julius-run-spent-` plus the id's hex only:
 * 32 hex characters from a `wlj_` UUID with the dashes removed, or the 24 hex
 * characters after `run:`. The same id always derives the same ref.
 */

import { pathToFileURL } from 'node:url';

export const WLJ_RUN_ID_PATTERN = '^wlj_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export const LEGACY_RUN_ID_PATTERN = '^run:[0-9a-f]{24}$';

const WLJ_RUN_ID = new RegExp(WLJ_RUN_ID_PATTERN, 'u');
const LEGACY_RUN_ID = new RegExp(LEGACY_RUN_ID_PATTERN, 'u');

/**
 * @param {unknown} value
 * @returns {{ ok: true, form: 'wlj' | 'legacy', runId: string } | { ok: false, reason: 'admission_run_id_required' | 'admission_run_id_malformed' }}
 */
export function parseJuliusAdmissionRunId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: 'admission_run_id_required' };
  }
  if (WLJ_RUN_ID.test(value)) return { ok: true, form: 'wlj', runId: value };
  if (LEGACY_RUN_ID.test(value)) return { ok: true, form: 'legacy', runId: value };
  return { ok: false, reason: 'admission_run_id_malformed' };
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, form: 'wlj' | 'legacy', runId: string, suffix: string, tag: string, concurrencyGroup: string } | { ok: false, reason: 'admission_run_id_required' | 'admission_run_id_malformed' }}
 */
export function deriveJuliusSpentTag(value) {
  const parsed = parseJuliusAdmissionRunId(value);
  if (!parsed.ok) return parsed;
  const suffix = parsed.form === 'wlj'
    ? parsed.runId.slice('wlj_'.length).replaceAll('-', '')
    : parsed.runId.slice('run:'.length);
  return {
    ok: true,
    form: parsed.form,
    runId: parsed.runId,
    suffix,
    tag: `refs/tags/julius-run-spent-${suffix}`,
    concurrencyGroup: `julius-paid-${suffix}`,
  };
}

function deriveFromEnv() {
  const derived = deriveJuliusSpentTag(process.env.JULIUS_RUN_ID ?? '');
  if (!derived.ok) {
    process.stderr.write(`${derived.reason}\n`);
    process.exit(1);
  }
  process.stdout.write([
    `form=${derived.form}`,
    `run_id=${derived.runId}`,
    `tag_suffix=${derived.suffix}`,
    `tag_ref=${derived.tag}`,
    `concurrency_group=${derived.concurrencyGroup}`,
  ].join('\n') + '\n');
}

const invoked = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  if (process.argv[2] !== 'derive') {
    process.stderr.write('admission_run_id_malformed\n');
    process.exit(1);
  }
  deriveFromEnv();
}
