/**
 * THE SPENT-TAG RECORD THE $60 CAP COUNTS.
 *
 * `refs/tags/julius-run-spent-<24 lowercase hex>` is an annotated tag. Its
 * message, and the blob `julius-run-spent-audit.txt` on the tag's target
 * commit, are the same text. The first four lines are the reservation,
 * written before any provider call. The next three lines bind the workflow
 * run that wrote it. A message that is only the four lines is the same
 * reservation. The earlier body, which named `server_run_id` and carried no
 * reservation, is not a record.
 *
 *   julius-run-spent.v1
 *   run=run:<24 lowercase hex>
 *   namespace=<namespace>
 *   reservedUsdMicros=<positive integer>
 *   workflow_run_id=<digits>
 *   workflow_run_attempt=<digits>
 *   head_sha=<40 lowercase hex>
 */

const SPENT_RUN_ID = /^run:[0-9a-f]{24}$/u;
const AUDIT_RUN_ID = /^workflow_run_id=[0-9]{1,20}$/u;
const AUDIT_ATTEMPT = /^workflow_run_attempt=[0-9]{1,10}$/u;
const AUDIT_SHA = /^head_sha=[0-9a-f]{40}$/u;

/**
 * The four lines the cap counts. Null when a reader would refuse them.
 * No trailing newline: callers that add the audit lines append it themselves.
 */
export function juliusSpentTagMessage(input: {
  readonly runId: string;
  readonly namespace: string;
  readonly reservedUsdMicros: number;
}): string | null {
  if (!SPENT_RUN_ID.test(input.runId)) return null;
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

const SPENT_TAG_REF = /^refs\/tags\/julius-run-spent-([0-9a-f]{24})$/u;

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
 * `excludeRunId` is this dispatch's own lock and is not prior spend. A body
 * that names another namespace is that other mission. A body that is missing
 * or is not this namespace's record is an unverified prior run, because the
 * listing cannot prove it is not.
 */
export function interpretJuliusSpentTags(input: {
  readonly namespace: string;
  readonly excludeRunId?: string;
  readonly tags: readonly JuliusSpentTag[];
}): JuliusSpentTagLedger {
  const exclude = input.excludeRunId !== undefined && SPENT_RUN_ID.test(input.excludeRunId)
    ? input.excludeRunId
    : null;
  const priorRuns: JuliusSpentTagPriorRun[] = [];
  const seen = new Set<string>();
  for (const tag of input.tags) {
    const hex = SPENT_TAG_REF.exec(tag.ref)?.[1] ?? null;
    if (hex === null) return { readable: false };
    if (seen.has(hex)) continue;
    seen.add(hex);
    const runId = `run:${hex}`;
    if (runId === exclude) continue;
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
 * The id is the client-minted `wlj_` UUIDv4 (founder ruling (c)) or the
 * admission server id `run:` plus 24 lowercase hex. The first claim spends.
 * A replay of that same id does not. A malformed id spends nothing, and the
 * set of spent ids is left as it was.
 */
const ADMISSION_SPEND_ID = /^(?:run:[0-9a-f]{24}|wlj_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

export type JuliusAdmissionSpend =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly reasonCode: 'admission_run_already_spent' | 'admission_run_id_malformed' };

export function claimJuliusAdmissionSpend(
  spent: ReadonlySet<string>,
  runId: string,
): { readonly decision: JuliusAdmissionSpend; readonly spent: ReadonlySet<string> } {
  const id = runId.trim();
  if (!ADMISSION_SPEND_ID.test(id)) {
    return { decision: { ok: false, reasonCode: 'admission_run_id_malformed' }, spent };
  }
  if (spent.has(id)) {
    return { decision: { ok: false, reasonCode: 'admission_run_already_spent' }, spent };
  }
  const next = new Set(spent);
  next.add(id);
  return { decision: { ok: true, runId: id }, spent: next };
}
