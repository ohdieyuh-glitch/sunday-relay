/**
 * THE RUNTIME'S OWN SPEND CEILINGS.
 *
 * `scripts/julius-live-contract-check.mjs` refuses a contract above the
 * namespace grant, and the live entry used to trust whatever figure survived
 * that script — including the entry's own `$5` / one-cycle default when the
 * contract said nothing. This module is the same table, applied by the runtime
 * before a provider is contacted. A parity test holds the two copies equal.
 * This file does not import the script: the script runs its check on import.
 *
 * THE QUALIFYING PAIR's combined cap is the GitHub tag
 * `refs/tags/julius-run-spent-<24 lowercase hex>`. A successful listing is
 * the durable record (`durableRecord: 'PRESENT'`). An empty listing is zero
 * prior spend. A failed listing is not zero. A tag that does not carry a
 * positive reserved ceiling for this namespace is an unverified prior run,
 * also not zero. The ref is created before the provider call and is not
 * updated afterwards, so the figure on it is the reserved ceiling, not a
 * provider invoice. This module never claims a provider balance was verified.
 * Only a ledger whose `durableRecord` is `PRESENT` may be compared with
 * `JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS` ($60).
 *
 * The pair check applies only to `JULIUS_QUALIFYING_PAIR_NAMESPACES`. It does
 * not apply to `julius-continuous-1` (whose $60 figure is an allocator input),
 * the diagnostic namespaces (whose grant is $100), or the learning-pair
 * namespaces (whose founder bound is $30 per arm and $120 across four arms).
 * Those higher grants are unchanged and still need a founder ruling.
 *
 * A prior run whose settlements are missing, estimated, unsettled, or a
 * subscription/`NOT_APPLICABLE` coder charge is not a verified bill. This
 * module never claims a provider balance was verified.
 */

import { juliusCostComponent } from './julius-cost-accounting';
import {
  interpretJuliusSpentTags,
  type JuliusSpentTag,
  type JuliusSpentTagLedger,
  type JuliusSpentTagPriorRun,
} from './julius-spent-tag-record';

export interface JuliusNamespaceCeiling {
  readonly spendUsd: number;
  readonly repairCycles: number;
}

export const JULIUS_DEFAULT_NAMESPACE_CEILING: JuliusNamespaceCeiling = Object.freeze({
  spendUsd: 5,
  repairCycles: 1,
});

/** The per-namespace grant. Keys and numbers match `MISSION_LIMITS` in the contract-check script. */
export const JULIUS_NAMESPACE_CEILINGS: Readonly<Record<string, JuliusNamespaceCeiling>> = Object.freeze({
  'julius-live-mission-2': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  'julius-live-mission-3': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  'julius-live-mission-4': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  'julius-live-mission-5': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-continuous-1': Object.freeze({ spendUsd: 60, repairCycles: 3 }),
  'julius-unreal-mission-1': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-learning-pair-1': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-learning-pair-2': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-diag-output-safety-1': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
  'julius-diag-output-safety-2': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
  'julius-diag-audit-fixes-1': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
  'julius-diag-digest-evidence-1': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
  // J1, the in-world data mission: $30 and 3 repair cycles per run. The same
  // grant as `julius-inworld-data-1` in the contract-check script (#441).
  'julius-inworld-data-1': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
});

/**
 * Namespaces allowed one initial run and one repeat, together not above $60
 * of known provider spend. J1 is listed here so its $60 is the combined cap
 * across the initial run and the repeat, never a per-run figure.
 */
export const JULIUS_QUALIFYING_PAIR_NAMESPACES: readonly string[] = Object.freeze([
  'julius-live-mission-5',
  'julius-unreal-mission-1',
  'julius-inworld-data-1',
]);

/** $60, in USD micros. Equality is inside the cap; one micro over is not. */
export const JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS = 60_000_000;

export function juliusNamespaceCeiling(namespace: string | null): JuliusNamespaceCeiling {
  if (namespace !== null && Object.hasOwn(JULIUS_NAMESPACE_CEILINGS, namespace)) {
    return JULIUS_NAMESPACE_CEILINGS[namespace] as JuliusNamespaceCeiling;
  }
  return JULIUS_DEFAULT_NAMESPACE_CEILING;
}

export interface JuliusSettlementFact {
  readonly taskId: string;
  readonly role: string | null;
  readonly basis: unknown;
  readonly usdMicros: unknown;
  readonly estimatedUsdMicros: unknown;
  readonly billingPath: unknown;
}

/** What one earlier run of this mission cost, as far as its settlements can prove. */
export interface JuliusPriorRunSpend {
  readonly runId: string;
  readonly knownUsdMicros: number;
  readonly unknownCostComponents: number;
  /**
   * True when the Coding Agent settled as a subscription or as
   * `NOT_APPLICABLE`. That is not an API bill, and it is not zero.
   */
  readonly unverifiableApiSpend: boolean;
  /** True only when every settlement is a known provider or measured-usage bill. */
  readonly spendVerified: boolean;
}

/**
 * `PRESENT` is the durable cross-job record only. Anything else, including a
 * field left off, is absent. A per-job database is never `PRESENT`.
 */
export type JuliusDurablePriorSpend = 'ABSENT' | 'PRESENT';

export type JuliusSpendLedgerRead =
  | { readonly readable: false }
  | {
    readonly readable: true;
    readonly priorRuns: readonly JuliusPriorRunSpend[];
    readonly durableRecord?: JuliusDurablePriorSpend;
  };

export type JuliusSpendAuthorization =
  | {
    readonly authorized: true;
    readonly spendCeilingUsdMicros: number;
    readonly maxRepairRounds: number;
  }
  | { readonly authorized: false; readonly reasonCode: string; readonly safeMessage: string };

const USD_MICROS = 1_000_000;

function usdMicrosOf(spendUsd: number): number | null {
  if (!Number.isFinite(spendUsd) || spendUsd <= 0) return null;
  const micros = Math.round(spendUsd * USD_MICROS);
  if (!Number.isSafeInteger(micros) || micros <= 0) return null;
  return micros;
}

/**
 * Fold `budget.settled` facts into one prior run. Estimated, unknown, and
 * unsettled components are counted and are not added as dollars. A coder
 * settlement that says the work was not API-billed is flagged, not zeroed.
 */
export function summarizeJuliusPriorRunSpend(
  runId: string,
  settlements: readonly JuliusSettlementFact[],
): JuliusPriorRunSpend {
  let knownUsdMicros = 0;
  let unknownCostComponents = 0;
  let spendBasisCount = 0;
  let unverifiableApiSpend = false;
  for (const settlement of settlements) {
    const component = juliusCostComponent({
      taskId: settlement.taskId,
      role: settlement.role,
      basis: settlement.basis,
      usdMicros: settlement.usdMicros,
      estimatedUsdMicros: settlement.estimatedUsdMicros,
    });
    if (component.knownUsdMicros !== null) {
      knownUsdMicros += component.knownUsdMicros;
      spendBasisCount += 1;
    } else {
      unknownCostComponents += 1;
    }
    if (
      component.role === 'CODING_AGENT'
      && (component.basis === 'NOT_APPLICABLE' || settlement.billingPath === 'SUBSCRIPTION')
    ) {
      unverifiableApiSpend = true;
    }
  }
  const spendVerified = settlements.length > 0
    && unknownCostComponents === 0
    && !unverifiableApiSpend
    && spendBasisCount === settlements.length
    && Number.isSafeInteger(knownUsdMicros);
  return {
    runId,
    knownUsdMicros: Number.isSafeInteger(knownUsdMicros) ? knownUsdMicros : 0,
    unknownCostComponents,
    unverifiableApiSpend,
    spendVerified,
  };
}

/**
 * Refuse a live contract the namespace does not grant. A qualifying-pair
 * namespace is also refused when prior-spend facts are absent, unverified, or
 * unreadable. Authorized output is the contract's own ceiling, never a raised
 * default, and only when those facts are a durable record.
 */
export function authorizeJuliusLiveSpend(input: {
  readonly namespace: string | null;
  readonly spendUsd: number | null;
  readonly repairCycles: number | null;
  readonly ledger: JuliusSpendLedgerRead;
}): JuliusSpendAuthorization {
  const ceiling = juliusNamespaceCeiling(input.namespace);
  const namespaceLabel = input.namespace ?? 'a mission with no declared namespace';
  if (input.spendUsd === null) {
    return {
      authorized: false,
      reasonCode: 'mission_spend_ceiling_unknown',
      safeMessage: 'limits.spendUsd is absent. The runtime does not substitute a default, and no provider balance was verified.',
    };
  }
  if (input.repairCycles === null) {
    return {
      authorized: false,
      reasonCode: 'mission_repair_rounds_unknown',
      safeMessage: 'limits.repairCycles is absent. The runtime does not substitute a default, and no provider balance was verified.',
    };
  }
  const spendCeilingUsdMicros = usdMicrosOf(input.spendUsd);
  if (spendCeilingUsdMicros === null) {
    return {
      authorized: false,
      reasonCode: 'mission_spend_ceiling_invalid',
      safeMessage: 'limits.spendUsd must be a positive finite number. No provider was contacted, and no provider balance was verified.',
    };
  }
  if (input.spendUsd > ceiling.spendUsd) {
    return {
      authorized: false,
      reasonCode: 'namespace_spend_ceiling_exceeded',
      safeMessage: `limits.spendUsd is ${String(input.spendUsd)}, above the ${String(ceiling.spendUsd)} ceiling for ${namespaceLabel}. No provider was contacted, and no provider balance was verified.`,
    };
  }
  if (!Number.isInteger(input.repairCycles) || input.repairCycles < 0) {
    return {
      authorized: false,
      reasonCode: 'mission_repair_rounds_invalid',
      safeMessage: 'limits.repairCycles must be a non-negative integer. No provider was contacted, and no provider balance was verified.',
    };
  }
  if (input.repairCycles > ceiling.repairCycles) {
    return {
      authorized: false,
      reasonCode: 'namespace_repair_ceiling_exceeded',
      safeMessage: `limits.repairCycles is ${String(input.repairCycles)}, above the ${String(ceiling.repairCycles)} allowed for ${namespaceLabel}. No provider was contacted, and no provider balance was verified.`,
    };
  }
  if (!JULIUS_QUALIFYING_PAIR_NAMESPACES.includes(input.namespace ?? '')) {
    return { authorized: true, spendCeilingUsdMicros, maxRepairRounds: input.repairCycles };
  }
  if (!input.ledger.readable) {
    return {
      authorized: false,
      reasonCode: 'spend_ledger_unreadable',
      safeMessage: 'Prior-spend facts could not be read. They are not treated as zero, and no provider balance was verified.',
    };
  }
  // PRESENT is a successful julius-run-spent-* listing. This job's Postgres
  // is not that record, so an empty local history stays absent, not a verified $0.
  if (input.ledger.durableRecord !== 'PRESENT') {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_spend_absent',
      safeMessage: 'Prior-spend facts for this qualifying mission are absent. This job\'s database is not a durable record of earlier runs, so no combined cap is applied and the missing history is not treated as zero. The durable record is the julius-run-spent-<id> tag and ledger. No provider was contacted, and no provider balance was verified.',
    };
  }
  const priorRuns = input.ledger.priorRuns;
  if (priorRuns.length >= 2) {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_third_run_refused',
      safeMessage: `This qualifying mission already has ${String(priorRuns.length)} runs. The founder cap allows the initial run and one repeat. No provider was contacted, and no provider balance was verified.`,
    };
  }
  const unverified = priorRuns.find((run) => !run.spendVerified || run.unknownCostComponents > 0 || run.unverifiableApiSpend);
  if (unverified !== undefined) {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_spend_unverified',
      safeMessage: `Prior run ${unverified.runId} has no complete API bill (unknown components ${String(unverified.unknownCostComponents)}, coder API spend unverifiable ${String(unverified.unverifiableApiSpend)}). Unknown is not zero, and no provider balance was verified.`,
    };
  }
  let priorKnown = 0;
  for (const run of priorRuns) {
    priorKnown += run.knownUsdMicros;
  }
  if (!Number.isSafeInteger(priorKnown) || priorKnown + spendCeilingUsdMicros > JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS) {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_spend_exceeded',
      safeMessage: `Known prior spend ${String(priorKnown)} micros plus this contract's ceiling ${String(spendCeilingUsdMicros)} micros exceeds the ${String(JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS)} micro combined cap. No provider was contacted, and no provider balance was verified.`,
    };
  }
  return { authorized: true, spendCeilingUsdMicros, maxRepairRounds: input.repairCycles };
}

/**
 * ONE SPENT TAG. The bytes and the parser live in `julius-spent-tag-record.ts`,
 * which the spent-tag job's contract test pins as well. The message the cap
 * counts is the four-line reservation, optionally followed by the workflow
 * audit lines. `reservedUsdMicros` is the ceiling reserved before the
 * provider call. It is not a provider invoice.
 */
export {
  interpretJuliusSpentTags,
  juliusSpentTagMessage,
  type JuliusSpentTag,
} from './julius-spent-tag-record';

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
  /**
   * True only when the reader proved, from the run's own GitHub-held job record, that the LIVE step refused
   * at its spend gate before any run row or provider could exist. The reader sets it only where the
   * evidence bundle is absent (an upload blocked under the billing lock). Absent or false proves nothing.
   */
  readonly refusedBeforeProvider?: boolean;
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
    // Proof (c), only where the bundle is ABSENT: the run's own job log shows the entrypoint refused at its
    // spend gate, before any run row or provider could exist. A bundle that exists is always judged on its
    // rows; this never overrides evidence, it only stands in for evidence that could not be uploaded.
    if (observation.refusedBeforeProvider === true) {
      return proof(binding, 'NOT_EXECUTED', 'no_provider_execution_refused_before_provider');
    }
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
 * THE SPENT-TAG LISTING, CLASSIFIED.
 *
 * {@link interpretJuliusSpentTags} (the spent-tag record, pinned byte-for-byte
 * with the tag writer) decides which tags are this namespace's prior runs and
 * what each reserved. This adds one classification per prior run and drops
 * only the NOT_EXECUTED ones from `priorRuns`.
 *
 * `proofs` are the reader's classifications, keyed by run id. A proof is used
 * only when its binding is exactly the tag's own audit lines. A verified tag
 * with no proof, or no audit lines, is UNKNOWN and counts its full
 * reservation, which is what every tag counted before proofs existed. An
 * unverified tag stays as the record reads it (unknown spend) and is UNKNOWN.
 */
export function classifyJuliusSpentTags(input: {
  readonly namespace: string;
  readonly excludeRunId?: string;
  readonly tags: readonly JuliusSpentTag[];
  readonly proofs?: ReadonlyMap<string, JuliusPriorRunProof>;
}): { readonly ledger: JuliusSpentTagLedger; readonly audit: readonly JuliusPriorRunAudit[] } {
  const base = interpretJuliusSpentTags({ namespace: input.namespace, excludeRunId: input.excludeRunId, tags: input.tags });
  if (!base.readable) return { ledger: base, audit: [] };
  const priorRuns: JuliusSpentTagPriorRun[] = [];
  const audit: JuliusPriorRunAudit[] = [];
  for (const run of base.priorRuns) {
    if (!run.spendVerified) {
      priorRuns.push(run);
      audit.push({
        runId: run.runId, workflowRunId: null, workflowRunAttempt: null, classification: 'UNKNOWN',
        basis: 'tag_unverified', counted: true, reservedUsdMicros: null, knownChargesUsdMicros: null,
      });
      continue;
    }
    // The first listed tag of this run's ref is the one the record read.
    const suffix = run.runId.startsWith('wlj_') ? run.runId.slice('wlj_'.length).replaceAll('-', '') : run.runId.slice('run:'.length);
    const tag = input.tags.find((candidate) => candidate.ref === `refs/tags/julius-run-spent-${suffix}`);
    const binding = juliusSpentTagBinding(tag?.message ?? null);
    const found = input.proofs?.get(run.runId);
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
      runId: run.runId,
      workflowRunId: binding?.workflowRunId ?? null,
      workflowRunAttempt: binding?.workflowRunAttempt ?? null,
      classification,
      basis,
      counted,
      reservedUsdMicros: run.knownUsdMicros,
      knownChargesUsdMicros: knownCharges,
    });
    if (!counted) continue;
    // The reservation is the floor. Known charges above it count as they are.
    priorRuns.push(knownCharges !== null && knownCharges > run.knownUsdMicros ? { ...run, knownUsdMicros: knownCharges } : run);
  }
  return { ledger: { readable: true, priorRuns, durableRecord: 'PRESENT' }, audit };
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

/**
 * THE ATTEMPTED RECORD AS A TAG (X′ §2). The paid job writes the annotated tag
 * `refs/tags/julius-run-record-<suffix>-attempted` with its job token BEFORE the
 * LIVE step can run, beside the best-effort `<namespace>-attempted` artifact.
 * The prefix is deliberately NOT `julius-run-spent-`: the spent-tag listing
 * rejects every ref under its own prefix that is not exactly a spend suffix, so
 * a record tag there would make the $60 ledger unreadable.
 *
 *   julius-run-attempted.v1
 *   run=<wlj_ id | run: id>
 *   namespace=<marker namespace>
 *   workflow_run_id=<digits>
 *   workflow_run_attempt=<digits>
 *   head_sha=<40 lowercase hex>
 *   attempted_at=<UTC, second precision, Z>
 *   contract_sha256=<64 lowercase hex>
 */
export const JULIUS_RUN_RECORD_TAG_PREFIX = 'refs/tags/julius-run-record-';
export const JULIUS_RUN_ATTEMPTED_SCHEMA = 'julius-run-attempted.v1';
const ATTEMPTED_KEYS = ['run', 'namespace', 'workflow_run_id', 'workflow_run_attempt', 'head_sha', 'attempted_at', 'contract_sha256'] as const;
const RECORD_NAMESPACE = /^[a-z][a-z0-9-]{2,48}$/u;
const RECORD_WLJ = /^wlj_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECORD_LEGACY = /^run:[0-9a-f]{24}$/u;
const RECORD_STAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u;
const RECORD_SHA256 = /^[0-9a-f]{64}$/u;

/** The spend suffix of an admission id: the same 32 or 24 hex the spent tag carries. */
export function juliusRunRecordSuffix(runId: string): string | null {
  if (RECORD_WLJ.test(runId)) return runId.slice('wlj_'.length).replaceAll('-', '');
  if (RECORD_LEGACY.test(runId)) return runId.slice('run:'.length);
  return null;
}

export type JuliusAttemptRecordTagParse =
  /** This namespace's record, bound to the workflow run that wrote it. */
  | { readonly kind: 'bound'; readonly binding: JuliusWorkflowRunBinding }
  /** This namespace's, by its readable namespace line, but not otherwise a record: counted, UNKNOWN. */
  | { readonly kind: 'counted_unbound'; readonly basis: string }
  /** A well-formed record of another namespace. */
  | { readonly kind: 'other_namespace' }
  /** A `julius-run-record-*` ref that is not an attempted record (the result record): not read here. */
  | { readonly kind: 'not_attempted' }
  /** Nothing this reader can attribute: the whole listing is unreadable. */
  | { readonly kind: 'unreadable' };

/**
 * ONE REF OF THE `matching-refs/tags/julius-run-record-` LISTING, PURE.
 * `message` is the annotated tag's body, or null for a lightweight tag (which is
 * unreadable: only an annotated tag carries a body to bind). Fail-closed: a body
 * that does not parse is counted UNKNOWN for its own namespace when that line can
 * be read, and otherwise makes the listing unreadable. Never zero.
 */
export function parseJuliusAttemptRecordTag(ref: string, message: string | null, namespace: string): JuliusAttemptRecordTagParse {
  if (!ref.startsWith(JULIUS_RUN_RECORD_TAG_PREFIX)) return { kind: 'unreadable' };
  if (!ref.endsWith('-attempted')) return { kind: 'not_attempted' };
  if (message === null) return { kind: 'unreadable' };
  const lines = message.split('\n').map((line) => line.replace(/\r$/u, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const namespaceLines = lines.filter((line) => line.startsWith('namespace='));
  const statedNamespace = namespaceLines.length === 1 ? (namespaceLines[0] as string).slice('namespace='.length) : null;
  if (statedNamespace === null || !RECORD_NAMESPACE.test(statedNamespace)) return { kind: 'unreadable' };
  const ours = statedNamespace === namespace;
  const unbound = (basis: string): JuliusAttemptRecordTagParse => (ours ? { kind: 'counted_unbound', basis } : { kind: 'other_namespace' });
  if (lines.length !== ATTEMPTED_KEYS.length + 1 || lines[0] !== JULIUS_RUN_ATTEMPTED_SCHEMA) return unbound('record_tag_unparseable');
  const fields = new Map<string, string>();
  for (const [index, key] of ATTEMPTED_KEYS.entries()) {
    const line = lines[index + 1] as string;
    if (!line.startsWith(`${key}=`)) return unbound('record_tag_unparseable');
    fields.set(key, line.slice(key.length + 1));
  }
  const runId = fields.get('run') ?? '';
  const suffix = juliusRunRecordSuffix(runId);
  const workflowRunId = fields.get('workflow_run_id') ?? '';
  const workflowRunAttempt = fields.get('workflow_run_attempt') ?? '';
  const headSha = fields.get('head_sha') ?? '';
  if (suffix === null || ref !== `${JULIUS_RUN_RECORD_TAG_PREFIX}${suffix}-attempted`) return unbound('record_tag_ref_mismatch');
  if (!RUN_DIGITS.test(workflowRunId) || !RUN_DIGITS.test(workflowRunAttempt) || !HEAD_SHA.test(headSha)
    || !RECORD_STAMP.test(fields.get('attempted_at') ?? '') || !RECORD_SHA256.test(fields.get('contract_sha256') ?? '')) {
    return unbound('record_tag_unparseable');
  }
  if (!ours) return { kind: 'other_namespace' };
  return { kind: 'bound', binding: { workflowRunId, workflowRunAttempt, headSha } };
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
