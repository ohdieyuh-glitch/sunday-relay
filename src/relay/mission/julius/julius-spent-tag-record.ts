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
 * THREE THINGS A PRIOR RUN CAN BE, KEPT APART.
 *
 *   WORKFLOW DISPATCHED  a spent tag exists, so its $30 was reserved.
 *   PROVIDER EXECUTION   Julius handed work to a provider.
 *   CONFIRMED CHARGES    settled spend the run's own evidence records.
 *
 * Every prior run of a qualifying-pair namespace gets exactly one
 * classification:
 *
 *   NOT_EXECUTED            dispatched, and its own evidence READABLY proves
 *                           no provider execution. It does not count toward
 *                           initial + one repeat or the $60 cap. This is not
 *                           a confirmed $0 charge: no charge was read at all.
 *   EXECUTED_CHARGES_KNOWN  executed, and every cost component settled. It
 *                           counts as a run, at its reservation or its known
 *                           charges, whichever is higher.
 *   UNKNOWN                 anything else. It counts as a run at the full
 *                           reservation, and its charges stay unknown.
 *
 * NOT_EXECUTED has exactly two proofs, both read from the workflow run the
 * tag itself names (`workflow_run_id`, `workflow_run_attempt`, `head_sha`):
 *
 *   (a) the jobs API, for that run and that attempt, shows the step
 *       `LIVE: run the first real Julius mission` never ran: the job
 *       `Preflight, then the live mission` was skipped, or was cancelled
 *       before the step was listed, or lists the step as skipped.
 *   (b) its one `julius-live-evidence` artifact, whose manifest names that
 *       run, attempt and head, holds zero data rows in worker-diagnostics.tsv,
 *       budget.tsv, cost-accounting.tsv, tasks.tsv and sessions.tsv, AND its
 *       one `julius-inworld-verdict` artifact says `verdict=NOT_RUN`.
 *
 * A missing artifact alone never proves anything, and a read that fails, a
 * shape that drifts, or a binding that differs is UNKNOWN. Nothing in this
 * file can turn an unreadable or partial record into zero.
 *
 * This changes only what COUNTS. The per-run spent tag, the attempt-1-only
 * gate and the outcome-unknown rules still refuse a second dispatch of the
 * same run id (see {@link claimJuliusAdmissionSpend}).
 */

export const JULIUS_PAID_WORKFLOW_PATH = '.github/workflows/julius-first-live-mission.yml';
export const JULIUS_MISSION_JOB_NAME = 'Preflight, then the live mission';
export const JULIUS_LIVE_STEP_NAME = 'LIVE: run the first real Julius mission';
export const JULIUS_LIVE_EVIDENCE_ARTIFACT = 'julius-live-evidence';
export const JULIUS_INWORLD_VERDICT_ARTIFACT = 'julius-inworld-verdict';
export const JULIUS_INWORLD_VERDICT_FILE = 'checker-verdict.txt';
export const JULIUS_EVIDENCE_MANIFEST_FILE = 'bundle-manifest.txt';
/** The dump's own file names (.github/julius-live-evidence-dump.sh). */
export const JULIUS_ZERO_ROW_EVIDENCE_FILES: readonly string[] = Object.freeze([
  'worker-diagnostics.tsv',
  'budget.tsv',
  'cost-accounting.tsv',
  'tasks.tsv',
  'sessions.tsv',
]);

export type JuliusPriorRunClassification = 'NOT_EXECUTED' | 'EXECUTED_CHARGES_KNOWN' | 'UNKNOWN';

export interface JuliusWorkflowRunBinding {
  readonly workflowRunId: string;
  readonly workflowRunAttempt: string;
  readonly headSha: string;
}

/**
 * What the GitHub reader saw for one workflow run. Every field is the raw
 * response body, or null when that read failed. The two file maps are the
 * extracted files of the one bound artifact of that name, or null.
 */
export interface JuliusPriorRunObservation {
  readonly binding: JuliusWorkflowRunBinding;
  readonly run: unknown;
  readonly jobs: unknown;
  readonly artifacts: unknown;
  readonly liveEvidence: ReadonlyMap<string, string> | null;
  readonly verdict: ReadonlyMap<string, string> | null;
}

export interface JuliusPriorRunProof {
  readonly binding: JuliusWorkflowRunBinding;
  readonly classification: JuliusPriorRunClassification;
  readonly basis: string;
  /** Settled charges, only for EXECUTED_CHARGES_KNOWN. Null is unknown, never zero. */
  readonly knownChargesUsdMicros: number | null;
}

const RUN_DIGITS = /^[1-9][0-9]{0,19}$/u;
const HEAD_SHA = /^[0-9a-f]{40}$/u;
const PSQL_FOOTER = /^\((0|[1-9][0-9]{0,9}) rows?\)$/u;
const MICROS_FIELD = /^(?:0|[1-9][0-9]{0,15})$/u;
const COUNT_FIELD = /^(?:0|[1-9][0-9]{0,9})$/u;

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function bindingIsWellFormed(binding: JuliusWorkflowRunBinding): boolean {
  return RUN_DIGITS.test(binding.workflowRunId)
    && RUN_DIGITS.test(binding.workflowRunAttempt)
    && HEAD_SHA.test(binding.headSha);
}

function sameRun(value: unknown, binding: JuliusWorkflowRunBinding): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && String(value) === binding.workflowRunId;
}

function sameAttempt(value: unknown, binding: JuliusWorkflowRunBinding): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && String(value) === binding.workflowRunAttempt;
}

function proof(
  binding: JuliusWorkflowRunBinding,
  classification: JuliusPriorRunClassification,
  basis: string,
  knownChargesUsdMicros: number | null = null,
): JuliusPriorRunProof {
  return { binding, classification, basis, knownChargesUsdMicros };
}

/**
 * Proof (a). `never_ran` only when the jobs API for exactly this run and attempt
 * shows the LIVE step never ran; `unreadable` when the jobs body cannot say.
 */
function liveNeverRan(jobsBody: unknown, binding: JuliusWorkflowRunBinding): 'never_ran' | 'ran' | 'unreadable' | 'mismatch' {
  const body = objectOf(jobsBody);
  if (body === null || !Array.isArray(body.jobs) || body.total_count !== body.jobs.length) return 'unreadable';
  const jobs = body.jobs.map(objectOf);
  if (jobs.some((job) => job === null)) return 'unreadable';
  for (const job of jobs as Record<string, unknown>[]) {
    if (!sameRun(job.run_id, binding) || !sameAttempt(job.run_attempt, binding) || job.head_sha !== binding.headSha) {
      return 'mismatch';
    }
  }
  const missionJobs = (jobs as Record<string, unknown>[]).filter((job) => job.name === JULIUS_MISSION_JOB_NAME);
  if (missionJobs.length !== 1) return 'unreadable';
  const job = missionJobs[0] as Record<string, unknown>;
  if (job.status !== 'completed' || !Array.isArray(job.steps)) return 'unreadable';
  const steps = job.steps.map(objectOf);
  if (steps.some((step) => step === null)) return 'unreadable';
  const live = (steps as Record<string, unknown>[]).filter((step) => step.name === JULIUS_LIVE_STEP_NAME);
  if (live.length > 1) return 'unreadable';
  if (live.length === 0) {
    // The step is absent only when the job never reached its step list.
    return job.conclusion === 'skipped' || job.conclusion === 'cancelled' ? 'never_ran' : 'unreadable';
  }
  const step = live[0] as Record<string, unknown>;
  return step.status === 'completed' && step.conclusion === 'skipped' ? 'never_ran' : 'ran';
}

/**
 * The one non-expired artifact of `name` on this run and head. Its numeric
 * id, or null when there is none, more than one, or one bound elsewhere.
 */
export function juliusBoundArtifactId(
  artifactsBody: unknown,
  name: string,
  binding: JuliusWorkflowRunBinding,
): number | null {
  const body = objectOf(artifactsBody);
  if (body === null || !Array.isArray(body.artifacts) || body.total_count !== body.artifacts.length) return null;
  const named = body.artifacts.map(objectOf).filter((entry) => entry !== null && entry.name === name) as Record<string, unknown>[];
  if (named.length !== 1) return null;
  const artifact = named[0] as Record<string, unknown>;
  const run = objectOf(artifact.workflow_run);
  if (artifact.expired !== false || run === null || !sameRun(run.id, binding) || run.head_sha !== binding.headSha) return null;
  return typeof artifact.id === 'number' && Number.isSafeInteger(artifact.id) && artifact.id > 0 ? artifact.id : null;
}

function keyValues(text: string): Map<string, string> | null {
  const fields = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/u, '');
    if (line === '') continue;
    const at = line.indexOf('=');
    if (at <= 0) return null;
    const key = line.slice(0, at);
    if (fields.has(key)) return null;
    fields.set(key, line.slice(at + 1));
  }
  return fields;
}

/**
 * A `psql -A -F '\t'` dump: a header, the rows, and the `(N rows)` footer
 * whose N is the row count. `unavailable`, a missing footer, or a footer that
 * disagrees with the rows is null.
 */
export function juliusPsqlTsvRows(text: string | undefined): { readonly header: readonly string[]; readonly rows: readonly string[][] } | null {
  if (text === undefined) return null;
  const lines = text.split('\n').map((line) => line.replace(/\r$/u, ''));
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length < 2) return null;
  const header = lines[0] as string;
  if (header === '' || header.trim() === 'unavailable' || PSQL_FOOTER.test(header)) return null;
  const footer = PSQL_FOOTER.exec(lines[lines.length - 1] as string);
  if (footer === null) return null;
  const body = lines.slice(1, -1);
  if (Number(footer[1]) !== body.length || body.some((line) => PSQL_FOOTER.test(line))) return null;
  return { header: header.split('\t'), rows: body.map((line) => line.split('\t')) };
}

/**
 * Settled charges from cost-accounting.tsv, only when every row is this
 * Julius run and every component is known. Null is unknown, never zero.
 */
function settledCharges(text: string | undefined, juliusRunId: string): number | null {
  const table = juliusPsqlTsvRows(text);
  if (table === null || table.rows.length === 0) return null;
  const at = (name: string): number => table.header.indexOf(name);
  const columns = ['run_id', 'known_usd_micros', 'unknown_components', 'estimated_components', 'unsettled_components'].map(at);
  if (columns.some((index) => index < 0)) return null;
  const [runAt, knownAt, unknownAt, estimatedAt, unsettledAt] = columns as [number, number, number, number, number];
  let total = 0;
  for (const row of table.rows) {
    if (row.length !== table.header.length || row[runAt] !== juliusRunId) return null;
    for (const index of [unknownAt, estimatedAt, unsettledAt]) {
      if (!COUNT_FIELD.test(row[index] ?? '') || row[index] !== '0') return null;
    }
    if (!MICROS_FIELD.test(row[knownAt] ?? '')) return null;
    total += Number(row[knownAt]);
  }
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * ONE CLASSIFICATION FOR ONE PRIOR WORKFLOW RUN. Pure: the reader passes what
 * GitHub returned, and this decides. `juliusRunId` is the admission run id the
 * spent tag names, matched against cost-accounting rows.
 */
export function classifyJuliusPriorRun(
  observation: JuliusPriorRunObservation,
  juliusRunId: string,
): JuliusPriorRunProof {
  const binding = observation.binding;
  if (!bindingIsWellFormed(binding)) return proof(binding, 'UNKNOWN', 'binding_malformed');
  const run = objectOf(observation.run);
  if (run === null) return proof(binding, 'UNKNOWN', 'run_unreadable');
  if (!sameRun(run.id, binding) || run.head_sha !== binding.headSha || run.path !== JULIUS_PAID_WORKFLOW_PATH) {
    return proof(binding, 'UNKNOWN', 'run_mismatch');
  }
  // A later attempt of the same run could have entered LIVE. Only the attempt the tag names is read.
  if (!sameAttempt(run.run_attempt, binding)) return proof(binding, 'UNKNOWN', 'run_attempt_mismatch');
  if (run.status !== 'completed') return proof(binding, 'UNKNOWN', 'run_not_completed');

  const live = liveNeverRan(observation.jobs, binding);
  if (live === 'never_ran') return proof(binding, 'NOT_EXECUTED', 'no_provider_execution_live_never_ran');
  if (live === 'mismatch') return proof(binding, 'UNKNOWN', 'jobs_mismatch');
  if (live === 'unreadable') return proof(binding, 'UNKNOWN', 'jobs_unreadable');

  // Proof (b): the run's own evidence bundle and its grade.
  if (juliusBoundArtifactId(observation.artifacts, JULIUS_LIVE_EVIDENCE_ARTIFACT, binding) === null) {
    return proof(binding, 'UNKNOWN', 'evidence_unreadable');
  }
  const evidence = observation.liveEvidence;
  if (evidence === null) return proof(binding, 'UNKNOWN', 'evidence_unreadable');
  const manifestText = evidence.get(JULIUS_EVIDENCE_MANIFEST_FILE);
  const manifest = manifestText === undefined ? null : keyValues(manifestText);
  if (manifest === null) return proof(binding, 'UNKNOWN', 'evidence_unreadable');
  if (
    manifest.get('workflow_run_id') !== binding.workflowRunId
    || manifest.get('workflow_run_attempt') !== binding.workflowRunAttempt
    || manifest.get('github_sha') !== binding.headSha
  ) {
    return proof(binding, 'UNKNOWN', 'evidence_mismatch');
  }
  const tables = JULIUS_ZERO_ROW_EVIDENCE_FILES.map((name) => juliusPsqlTsvRows(evidence.get(name)));
  if (tables.some((table) => table === null)) return proof(binding, 'UNKNOWN', 'evidence_malformed');
  const anyRows = tables.some((table) => (table as { rows: readonly unknown[] }).rows.length > 0);
  if (anyRows) {
    const charges = settledCharges(evidence.get('cost-accounting.tsv'), juliusRunId);
    return charges === null
      ? proof(binding, 'UNKNOWN', 'executed_charges_unreadable')
      : proof(binding, 'EXECUTED_CHARGES_KNOWN', 'executed_charges_settled', charges);
  }
  if (juliusBoundArtifactId(observation.artifacts, JULIUS_INWORLD_VERDICT_ARTIFACT, binding) === null) {
    return proof(binding, 'UNKNOWN', 'verdict_unreadable');
  }
  const verdictText = observation.verdict?.get(JULIUS_INWORLD_VERDICT_FILE);
  const verdict = verdictText === undefined ? null : keyValues(verdictText);
  if (verdict === null || verdict.get('schema') !== 'julius-inworld-verdict.v1') return proof(binding, 'UNKNOWN', 'verdict_unreadable');
  if (verdict.get('verdict') !== 'NOT_RUN') return proof(binding, 'UNKNOWN', 'verdict_not_not_run');
  return proof(binding, 'NOT_EXECUTED', 'no_provider_execution_zero_rows_not_run');
}

/** The binding the three audit lines of a seven-line tag carry, or null. */
export function juliusSpentTagBinding(message: string | null): JuliusWorkflowRunBinding | null {
  if (message === null) return null;
  const lines = message.trim().split('\n');
  if (lines.length !== 7) return null;
  const workflowRunId = /^workflow_run_id=([0-9]{1,20})$/u.exec(lines[4] ?? '')?.[1];
  const workflowRunAttempt = /^workflow_run_attempt=([0-9]{1,10})$/u.exec(lines[5] ?? '')?.[1];
  const headSha = /^head_sha=([0-9a-f]{40})$/u.exec(lines[6] ?? '')?.[1];
  if (workflowRunId === undefined || workflowRunAttempt === undefined || headSha === undefined) return null;
  return { workflowRunId, workflowRunAttempt, headSha };
}

export interface JuliusPriorRunAudit {
  readonly runId: string;
  readonly workflowRunId: string | null;
  readonly workflowRunAttempt: string | null;
  readonly classification: JuliusPriorRunClassification;
  readonly basis: string;
  readonly counted: boolean;
  /** The reservation the tag records, or null when the tag carries none readably. */
  readonly reservedUsdMicros: number | null;
  /** Settled charges, or null: unknown, never zero. */
  readonly knownChargesUsdMicros: number | null;
}

/**
 * One allowlisted machine line per prior run. Tokens only: no log body, no
 * secret. Null is printed `UNKNOWN`, never `0`.
 */
export function juliusPriorRunLine(audit: JuliusPriorRunAudit): string {
  const number = (value: number | string | null): string => (value === null ? 'UNKNOWN' : String(value));
  return [
    'prior_run',
    `run=${audit.runId}`,
    `workflow_run_id=${number(audit.workflowRunId)}`,
    `attempt=${number(audit.workflowRunAttempt)}`,
    `classification=${audit.classification}`,
    `basis=${audit.basis}`,
    `counted=${String(audit.counted)}`,
    `reserved_usd_micros=${number(audit.reservedUsdMicros)}`,
    `known_charges_usd_micros=${number(audit.knownChargesUsdMicros)}`,
  ].join(' ');
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
 *
 * `proofs` are the classifications the reader made, keyed by run id. A proof
 * is used only when its binding is exactly the tag's own audit lines. A
 * verified tag with no proof, or no audit lines, is UNKNOWN and counts its
 * full reservation, which is what every tag counted before proofs existed.
 */
export function classifyJuliusSpentTags(input: {
  readonly namespace: string;
  readonly excludeRunId?: string;
  readonly tags: readonly JuliusSpentTag[];
  readonly proofs?: ReadonlyMap<string, JuliusPriorRunProof>;
}): { readonly ledger: JuliusSpentTagLedger; readonly audit: readonly JuliusPriorRunAudit[] } {
  const excludeSuffix = input.excludeRunId === undefined
    ? null
    : deriveJuliusAdmissionSpendKey(input.excludeRunId)?.suffix ?? null;
  const priorRuns: JuliusSpentTagPriorRun[] = [];
  const audit: JuliusPriorRunAudit[] = [];
  const seen = new Set<string>();
  for (const tag of input.tags) {
    const suffix = SPENT_TAG_REF.exec(tag.ref)?.[1] ?? null;
    const derived = suffix === null ? null : runIdFromSpentSuffix(suffix);
    if (derived === null || derived.tag !== tag.ref) return { ledger: { readable: false }, audit: [] };
    if (seen.has(derived.suffix)) continue;
    seen.add(derived.suffix);
    if (derived.suffix === excludeSuffix) continue;
    const runId = derived.runId;
    const parsed = parseJuliusSpentTagRecord(tag.message, runId, input.namespace);
    if (parsed.kind === 'other') continue;
    if (parsed.kind === 'unverified') {
      priorRuns.push({
        runId,
        knownUsdMicros: 0,
        unknownCostComponents: 1,
        unverifiableApiSpend: false,
        spendVerified: false,
      });
      audit.push({
        runId, workflowRunId: null, workflowRunAttempt: null, classification: 'UNKNOWN',
        basis: 'tag_unverified', counted: true, reservedUsdMicros: null, knownChargesUsdMicros: null,
      });
      continue;
    }
    const binding = juliusSpentTagBinding(tag.message);
    const found = input.proofs?.get(runId);
    const bound = binding !== null && found !== undefined
      && found.binding.workflowRunId === binding.workflowRunId
      && found.binding.workflowRunAttempt === binding.workflowRunAttempt
      && found.binding.headSha === binding.headSha;
    const classification: JuliusPriorRunClassification = bound ? found.classification : 'UNKNOWN';
    const basis = binding === null
      ? 'tag_unbound'
      : found === undefined ? 'proof_absent' : bound ? found.basis : 'proof_binding_mismatch';
    const knownCharges = bound && classification === 'EXECUTED_CHARGES_KNOWN' ? found.knownChargesUsdMicros : null;
    const counted = classification !== 'NOT_EXECUTED';
    audit.push({
      runId,
      workflowRunId: binding?.workflowRunId ?? null,
      workflowRunAttempt: binding?.workflowRunAttempt ?? null,
      classification,
      basis,
      counted,
      reservedUsdMicros: parsed.reservedUsdMicros,
      knownChargesUsdMicros: knownCharges,
    });
    if (!counted) continue;
    priorRuns.push({
      runId,
      // The reservation is the floor. Known charges above it count as they are.
      knownUsdMicros: knownCharges !== null && knownCharges > parsed.reservedUsdMicros ? knownCharges : parsed.reservedUsdMicros,
      unknownCostComponents: 0,
      unverifiableApiSpend: false,
      spendVerified: true,
    });
  }
  const byRun = (left: { runId: string }, right: { runId: string }): number => (left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0);
  priorRuns.sort(byRun);
  audit.sort(byRun);
  return { ledger: { readable: true, priorRuns, durableRecord: 'PRESENT' }, audit };
}

/** The ledger alone, with no proofs: every verified tag counts its reservation. */
export function interpretJuliusSpentTags(input: {
  readonly namespace: string;
  readonly excludeRunId?: string;
  readonly tags: readonly JuliusSpentTag[];
  readonly proofs?: ReadonlyMap<string, JuliusPriorRunProof>;
}): JuliusSpentTagLedger {
  return classifyJuliusSpentTags(input).ledger;
}

/**
 * THE ATTEMPTED-MARKER GATE, on the same proofs. A `<namespace>-attempted`
 * marker counts as a prior attempt unless the run that uploaded it is
 * NOT_EXECUTED. A marker carries no attempt number; a paid run is attempt 1
 * only, so its binding is attempt 1 and a run that moved to a later attempt
 * is UNKNOWN. `<namespace>-completed` markers are not read here: they always count.
 * Null when the listing cannot be read.
 */
export function juliusAttemptMarkerBindings(listing: unknown, markerName: string): readonly JuliusWorkflowRunBinding[] | null {
  const body = objectOf(listing);
  if (body === null || !Array.isArray(body.artifacts) || body.total_count !== body.artifacts.length) return null;
  const bindings: JuliusWorkflowRunBinding[] = [];
  for (const raw of body.artifacts) {
    const artifact = objectOf(raw);
    if (artifact === null || artifact.name !== markerName) return null;
    if (artifact.expired === true) continue;
    if (artifact.expired !== false) return null;
    const run = objectOf(artifact.workflow_run);
    if (run === null || typeof run.id !== 'number' || !Number.isSafeInteger(run.id) || typeof run.head_sha !== 'string') return null;
    bindings.push({ workflowRunId: String(run.id), workflowRunAttempt: '1', headSha: run.head_sha });
  }
  return bindings;
}

export function juliusAttemptMarkerLine(proofOfRun: JuliusPriorRunProof): string {
  return [
    'attempt_marker',
    `workflow_run_id=${proofOfRun.binding.workflowRunId}`,
    `attempt=${proofOfRun.binding.workflowRunAttempt}`,
    `classification=${proofOfRun.classification}`,
    `basis=${proofOfRun.basis}`,
    `counted=${String(proofOfRun.classification !== 'NOT_EXECUTED')}`,
  ].join(' ');
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
