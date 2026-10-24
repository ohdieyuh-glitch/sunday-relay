/**
 * THE SPENT-TAG RECORD THE $60 CAP COUNTS.
 *
 * One derivation, the same one `scripts/julius-admission-run-id.mjs` uses for
 * the paid workflow. This file mirrors it and does not import that script:
 * the script loads `node:url` for its CLI, and this directory may not. The
 * contract test fails when the two disagree on an id, a suffix, or a tag.
 *
 * `refs/tags/julius-run-spent-<suffix>` is an annotated tag. The suffix is the
 * canonical spend key: 24 lowercase hex rebuilt as `run:<hex>`, or 32
 * lowercase hex rebuilt as `wlj_` plus the UUID with dashes. A ref that is
 * neither rejects the listing. Its message, and the blob
 * `julius-run-spent-audit.txt` on the tag's target commit, are the same text.
 * The first four lines are the reservation, written before any provider call.
 * The next three lines bind the workflow run that wrote it. A message that is
 * only the four lines is the same reservation. The earlier body, which named
 * `server_run_id` and carried no reservation, is not a record.
 *
 *   julius-run-spent.v1
 *   run=run:<24 lowercase hex> | wlj_<lowercase UUIDv4>
 *   namespace=<namespace>
 *   reservedUsdMicros=<positive integer>
 *   workflow_run_id=<digits>
 *   workflow_run_attempt=<digits>
 *   head_sha=<40 lowercase hex>
 */

const WLJ_RUN_ID = /^wlj_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LEGACY_RUN_ID = /^run:[0-9a-f]{24}$/u;
const AUDIT_RUN_ID = /^workflow_run_id=[0-9]{1,20}$/u;
const AUDIT_ATTEMPT = /^workflow_run_attempt=[0-9]{1,10}$/u;
const AUDIT_SHA = /^head_sha=[0-9a-f]{40}$/u;

interface JuliusAdmissionSpendKey {
  readonly form: 'wlj' | 'legacy';
  readonly runId: string;
  readonly suffix: string;
  readonly tag: string;
}

/**
 * The spend key for one admission id. Identical to `deriveJuliusSpentTag` in
 * `scripts/julius-admission-run-id.mjs`: no trim, no mint, same suffix.
 */
function deriveJuliusAdmissionSpendKey(value: string): JuliusAdmissionSpendKey | null {
  const form = WLJ_RUN_ID.test(value) ? 'wlj' : LEGACY_RUN_ID.test(value) ? 'legacy' : null;
  if (form === null) return null;
  const suffix = form === 'wlj'
    ? value.slice('wlj_'.length).replaceAll('-', '')
    : value.slice('run:'.length);
  return {
    form,
    runId: value,
    suffix,
    tag: `refs/tags/julius-run-spent-${suffix}`,
  };
}

/**
 * Inverse of the suffix above. A 32-hex suffix that is not a lowercase
 * UUIDv4 does not rebuild, so a tag the workflow would not write is not a run.
 */
function runIdFromSpentSuffix(suffix: string): JuliusAdmissionSpendKey | null {
  const runId = /^[0-9a-f]{24}$/u.test(suffix)
    ? `run:${suffix}`
    : /^[0-9a-f]{32}$/u.test(suffix)
      ? `wlj_${suffix.slice(0, 8)}-${suffix.slice(8, 12)}-${suffix.slice(12, 16)}-${suffix.slice(16, 20)}-${suffix.slice(20)}`
      : null;
  if (runId === null) return null;
  const derived = deriveJuliusAdmissionSpendKey(runId);
  if (derived === null || derived.suffix !== suffix) return null;
  return derived;
}

/**
 * The four lines the cap counts. Null when a reader would refuse them.
 * No trailing newline: callers that add the audit lines append it themselves.
 * Accepts a `wlj_` UUIDv4 and a legacy `run:` id. Anything else, including
 * surrounding space, is null.
 */
export function juliusSpentTagMessage(input: {
  readonly runId: string;
  readonly namespace: string;
  readonly reservedUsdMicros: number;
}): string | null {
  if (deriveJuliusAdmissionSpendKey(input.runId) === null) return null;
  if (!/^[a-z0-9-]{1,64}$/u.test(input.namespace)) return null;
  if (!Number.isSafeInteger(input.reservedUsdMicros) || input.reservedUsdMicros <= 0) return null;
  return [
    'julius-run-spent.v1',
    `run=${input.runId}`,
    `namespace=${input.namespace}`,
    `reservedUsdMicros=${String(input.reservedUsdMicros)}`,
  ].join('\n');
}

/**
 * The bytes the spent-tag job writes: the four-line record, the three audit
 * lines, and a trailing newline. Null when any field is not the form the
 * reader accepts. `reservedUsdMicros` is the run's full reservation.
 */
export function juliusSpentTagRecord(input: {
  readonly runId: string;
  readonly namespace: string;
  readonly reservedUsdMicros: number;
  readonly workflowRunId: string;
  readonly workflowRunAttempt: string;
  readonly headSha: string;
}): string | null {
  const record = juliusSpentTagMessage(input);
  if (record === null) return null;
  const audit = [
    `workflow_run_id=${input.workflowRunId}`,
    `workflow_run_attempt=${input.workflowRunAttempt}`,
    `head_sha=${input.headSha}`,
  ];
  if (!AUDIT_RUN_ID.test(audit[0] ?? '') || !AUDIT_ATTEMPT.test(audit[1] ?? '') || !AUDIT_SHA.test(audit[2] ?? '')) {
    return null;
  }
  return `${record}\n${audit.join('\n')}\n`;
}

export interface JuliusSpentTag {
  readonly ref: string;
  readonly message: string | null;
}

export interface JuliusSpentTagPriorRun {
  readonly runId: string;
  readonly knownUsdMicros: number;
  readonly unknownCostComponents: number;
  readonly unverifiableApiSpend: boolean;
  readonly spendVerified: boolean;
}

export type JuliusSpentTagLedger =
  | { readonly readable: false }
  | {
    readonly readable: true;
    readonly priorRuns: readonly JuliusSpentTagPriorRun[];
    readonly durableRecord: 'PRESENT';
  };

export type JuliusSpentTagParse =
  | { readonly kind: 'verified'; readonly reservedUsdMicros: number }
  | { readonly kind: 'other' }
  | { readonly kind: 'unverified' };

const SPENT_TAG_REF = /^refs\/tags\/julius-run-spent-([0-9a-f]{24}|[0-9a-f]{32})$/u;

/**
 * Accept the four-line record, or that record followed by the three audit
 * lines. Anything else, including the old `server_run_id` body, is unverified.
 * A verified body whose namespace is a different mission is that other mission.
 */
export function parseJuliusSpentTagRecord(
  message: string | null,
  runId: string,
  expectedNamespace: string,
): JuliusSpentTagParse {
  if (message === null) return { kind: 'unverified' };
  const lines = message.trim().split('\n');
  if ((lines.length !== 4 && lines.length !== 7) || lines[0] !== 'julius-run-spent.v1' || lines[1] !== `run=${runId}`) {
    return { kind: 'unverified' };
  }
  if (lines.length === 7) {
    if (!AUDIT_RUN_ID.test(lines[4] ?? '') || !AUDIT_ATTEMPT.test(lines[5] ?? '') || !AUDIT_SHA.test(lines[6] ?? '')) {
      return { kind: 'unverified' };
    }
  }
  const namespace = /^namespace=([a-z0-9-]{1,64})$/u.exec(lines[2] ?? '')?.[1];
  const rawMicros = /^reservedUsdMicros=([0-9]{1,15})$/u.exec(lines[3] ?? '')?.[1];
  if (namespace === undefined || rawMicros === undefined) return { kind: 'unverified' };
  const reservedUsdMicros = Number(rawMicros);
  if (!Number.isSafeInteger(reservedUsdMicros) || reservedUsdMicros <= 0) return { kind: 'unverified' };
  const canonical = juliusSpentTagMessage({ runId, namespace, reservedUsdMicros });
  if (canonical === null || lines.slice(0, 4).join('\n') !== canonical) return { kind: 'unverified' };
  if (namespace !== expectedNamespace) return { kind: 'other' };
  return { kind: 'verified', reservedUsdMicros };
}

/**
 * A successful listing of `julius-run-spent-*`. The run id passed as
 * `excludeRunId` is this dispatch's own lock. It is matched by spend suffix,
 * so a `wlj_` id excludes the 32-hex tag the workflow wrote for it. A ref
 * that is not 24 lowercase hex or 32 lowercase hex of a UUIDv4 rejects the
 * whole listing: a malformed tag is not skipped and is not zero. A body that
 * names another namespace is that other mission. A body that is missing or
 * is not this namespace's record is an unverified prior run, because the
 * listing cannot prove it is not.
 */
export function interpretJuliusSpentTags(input: {
  readonly namespace: string;
  readonly excludeRunId?: string;
  readonly tags: readonly JuliusSpentTag[];
}): JuliusSpentTagLedger {
  const excludeSuffix = input.excludeRunId === undefined
    ? null
    : deriveJuliusAdmissionSpendKey(input.excludeRunId)?.suffix ?? null;
  const priorRuns: JuliusSpentTagPriorRun[] = [];
  const seen = new Set<string>();
  for (const tag of input.tags) {
    const suffix = SPENT_TAG_REF.exec(tag.ref)?.[1] ?? null;
    const derived = suffix === null ? null : runIdFromSpentSuffix(suffix);
    if (derived === null || derived.tag !== tag.ref) return { readable: false };
    if (seen.has(derived.suffix)) continue;
    seen.add(derived.suffix);
    if (derived.suffix === excludeSuffix) continue;
    const runId = derived.runId;
    const parsed = parseJuliusSpentTagRecord(tag.message, runId, input.namespace);
    if (parsed.kind === 'other') continue;
    if (parsed.kind === 'verified') {
      priorRuns.push({
        runId,
        knownUsdMicros: parsed.reservedUsdMicros,
        unknownCostComponents: 0,
        unverifiableApiSpend: false,
        spendVerified: true,
      });
      continue;
    }
    priorRuns.push({
      runId,
      knownUsdMicros: 0,
      unknownCostComponents: 1,
      unverifiableApiSpend: false,
      spendVerified: false,
    });
  }
  priorRuns.sort((left, right) => (left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0));
  return { readable: true, priorRuns, durableRecord: 'PRESENT' };
}

/**
 * ONE SPEND PER ADMISSION RUN ID.
 *
 * The set is keyed by the canonical spend suffix, the same hex the workflow
 * writes into `refs/tags/julius-run-spent-<suffix>`. A `wlj_` id and the
 * 32-hex tag of that id are one key, so a tag the workflow already wrote
 * refuses the claim. A replay of the same id refuses. A malformed id spends
 * nothing, and the set is left as it was. Space around an id is malformed,
 * matching the workflow script, which does not trim.
 */
export type JuliusAdmissionSpend =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly reasonCode: 'admission_run_already_spent' | 'admission_run_id_malformed' };

export function claimJuliusAdmissionSpend(
  spent: ReadonlySet<string>,
  runId: string,
): { readonly decision: JuliusAdmissionSpend; readonly spent: ReadonlySet<string> } {
  const derived = deriveJuliusAdmissionSpendKey(runId);
  if (derived === null) {
    return { decision: { ok: false, reasonCode: 'admission_run_id_malformed' }, spent };
  }
  if (spent.has(derived.suffix)) {
    return { decision: { ok: false, reasonCode: 'admission_run_already_spent' }, spent };
  }
  const next = new Set(spent);
  next.add(derived.suffix);
  return { decision: { ok: true, runId: derived.runId }, spent: next };
}
