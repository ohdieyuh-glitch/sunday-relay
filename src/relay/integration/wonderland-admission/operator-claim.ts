/**
 * LOCAL OPERATOR CLAIM — founder-run, loopback-only, no credentials.
 *
 * Claims one admitted Wonderland pair. A new row is keyed on the client's
 * `wlj_` id for both sides. A legacy `run:` row is read only: it cannot be
 * claimed, dispatched, or spend-locked. admitted -> dispatching is a single
 * write under the store's write lock; dispatching -> dispatched is written
 * only after the `gh workflow run` child this tool spawned exited 0 with no
 * halt. The lock is released while `gh` runs, so the bridge keeps serving.
 * A second claim returns that record and does not dispatch again.
 * A held row whose awaiting-operator window has already elapsed is refused
 * before any claim is written and before `gh` is spawned. The server clock
 * makes that decision. A test may inject the clock through the tool. A
 * request body, query, header, or CLI flag cannot. Once expiry is observed
 * it is stored on the operator journal and stays final.
 *
 * The default is a dry-run: it prints the exact `gh workflow run` command,
 * spawns nothing, and writes no claim record, so `/status` stays
 * `awaiting_operator` and a later real dispatch still dispatches. The
 * printed command carries `confirm_live` only when the operator passed
 * `--confirm 'RUN LIVE MISSION'`. `--dispatch` plus the exact confirmation
 * `RUN LIVE MISSION` is the only path that spawns `gh`. That path first asks
 * `gh api` whether the spent tag exists. Present -> already_spent, and the
 * workflow is not started. A failed workflow spawn moves the record to
 * dispatch_failed. A visible workflow halt `RUN_ID_ALREADY_SPENT` is
 * already_spent, and `SPENT_TAG_UNVERIFIED` is dispatch_failed. Neither
 * state is ever written back to admitted, and nothing here retries.
 *
 * A dry run checks the checked-out workflow. A dispatch reads what
 * `gh workflow run --ref main` will run, at `main` through `gh api`: the
 * workflow must declare `workflow_dispatch.inputs.run_id` (PR #459's input)
 * and every other input the argv passes, and the lane must be one the
 * mission's contract on `main` is granted (`MISSION_LANES` in
 * `scripts/julius-live-contract-check.mjs`). The workflow writes the spent
 * tag before its own lane check, so a lane refused there would burn the id;
 * here it is refused before anything is written or dispatched. The value
 * passed as `run_id` is the client's `wlj_` id. The spent lock is
 * `julius-run-spent-` plus 32 hex. A legacy `run:` row keeps the 24-hex lock
 * and is not claimed. This module does not edit the workflow.
 *
 * The spent-tag read right before the reservation also records GitHub's
 * clock: its `Date:` header, stored on the claim as `githubDate`. The bridge
 * orders the matched run's `created_at` against that, never this machine's
 * clock. A read without a readable `Date:` claims nothing.
 *
 * `reconcile` is the only exit from a stuck `dispatching` record (a stop
 * after the reservation and before the outcome write). It writes an outcome
 * only from GitHub evidence: the paid run whose run name carries
 * `key=<dispatch key>`, and the spent tag's `workflow_run_id`. It never
 * deletes or rewrites a record; anything less than agreeing evidence leaves
 * `dispatching` as it is.
 */

import {
  applyWonderlandStatusTransition,
  MISSION_SLUG,
  PAID_SLOT_DISPATCH_KEY,
  PAID_WORKFLOW_FILE,
  projectUnclaimedHeldPhase,
  type WonderlandStatusProjection,
} from './admission-contract';
import { deriveJuliusSpentTag, identifyAdmissionRun, parseJuliusAdmissionRunId, WLJ_RUN_ID_PATTERN } from './admission-run-id';
import type {
  AdmissionFile,
  AdmissionFileIo,
  ClaimEvent,
  DispatchError,
  OperatorDocument,
  StoredAdmission,
  StoredProgress,
  WorkflowHalt,
} from './admission-file';
import {
  awaitingOperatorExpiryNote,
  isStoredWorkflowRunId,
  openAdmissionFile,
  readAdmissionDocument,
} from './admission-file';

/**
 * The run id input of the paid workflow, as PR #459 declares it in
 * `.github/workflows/julius-first-live-mission.yml`. The claim tool passes
 * the client's `wlj_` id under this name.
 */
export const WORKFLOW_RUN_ID_INPUT = 'run_id';

/** Every `workflow_dispatch` input `workflowDispatchArgs` can pass. */
export const DISPATCH_INPUTS = ['mission', 'lane', 'dispatch_key', 'confirm_live', WORKFLOW_RUN_ID_INPUT] as const;

/**
 * What the refusal prints when the workflow lacks `run_id`. The input is PR
 * #459's; this tool does not write the workflow. The git tag uses the UUID
 * with the dashes removed: `julius-run-spent-<32hex>`. The workflow's own
 * concurrency group is `julius-first-live-mission-${github.run_id}`, one per
 * Actions run; `julius-paid-<32hex>` is only the derived name the workflow
 * checks beside the tag, not a concurrency group. A legacy `run:` row keeps
 * `julius-run-spent-<24hex>` and is not claimed from here. A re-dispatch
 * halts with `RUN_ID_ALREADY_SPENT`. A spent tag the workflow cannot verify
 * halts with `SPENT_TAG_UNVERIFIED`.
 */
export const WORKFLOW_RUN_ID_INPUT_YAML = [
  '# workflow_dispatch.inputs of julius-first-live-mission.yml must declare (PR #459):',
  '      run_id:',
  `        description: 'Canonical Julius run id matching ${WLJ_RUN_ID_PATTERN}. A paid dispatch creates julius-run-spent-<32hex>. A legacy run keeps julius-run-spent-<24hex> and is not claimed. A re-dispatch halts with RUN_ID_ALREADY_SPENT. A spent tag that cannot be verified halts with SPENT_TAG_UNVERIFIED.'`,
  '        required: false',
  "        default: ''",
].join('\n');

export const OPERATOR_DISPATCH_CONFIRMATION = 'RUN LIVE MISSION';

/**
 * THE SECOND PHRASE, for a paid admission over a PROVEN prior paid attempt.
 * This is the one string it is compared with. It is never a default: a claim
 * carries it only as `ClaimInput.rerunConfirmation`, which only the Wonderland
 * Start route sets, and only from the founder's paired session's own body
 * field `acknowledgeRerun`. No environment variable, flag, config or replay
 * supplies it.
 */
export const RERUN_PAID_MISSION_CONFIRMATION = 'RERUN PAID MISSION';

/** The paid workflow's input the second phrase is passed under. */
export const WORKFLOW_RERUN_INPUT = 'acknowledge_rerun';

/**
 * One of the paid workflow's prior-run counts for the admission's contract
 * namespace. Unreadable is UNKNOWN, never zero.
 * - `read`: the attempted-marker count, as `julius-live-mission.cjs
 *   attempt-markers` reads it (the proofs that are not NOT_EXECUTED).
 * - `readCompleted`: the `<namespace>-completed` marker count, as the
 *   workflow's step-9 gate counts it (`gh api .../actions/artifacts?name=
 *   <ns>-completed&per_page=100 --jq '[.artifacts[] | select(.expired ==
 *   false)] | length'`).
 */
export type PriorAttemptRead =
  | { readonly readable: false }
  | { readonly readable: true; readonly counted: number };

/** Injected by the composition root (the bridge). Read-only. */
export interface PriorAttemptReader {
  read(input: { readonly repo: string; readonly namespace: string }): Promise<PriorAttemptRead>;
  readCompleted(input: { readonly repo: string; readonly namespace: string }): Promise<PriorAttemptRead>;
}

/** No reader wired: the prior-attempt state is UNKNOWN, so no paid dispatch. */
export const UNWIRED_PRIOR_ATTEMPTS: PriorAttemptReader = {
  read: () => Promise.resolve({ readable: false }),
  readCompleted: () => Promise.resolve({ readable: false }),
};

/** A prior-run count as shown and decided on: a whole number, or UNKNOWN. */
export type PriorCount = number | 'UNKNOWN';

export function priorCount(read: PriorAttemptRead): PriorCount {
  return read.readable && Number.isSafeInteger(read.counted) && read.counted >= 0 ? read.counted : 'UNKNOWN';
}

/** `markerNamespace` of a contract read at main, as the paid workflow's gate reads it, or null. */
export function contractMarkerNamespace(contractSource: string): string | null {
  let contract: unknown;
  try {
    contract = JSON.parse(contractSource);
  } catch {
    return null;
  }
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) return null;
  const namespace = (contract as Record<string, unknown>).markerNamespace;
  return typeof namespace === 'string' && /^[a-z][a-z0-9-]{2,48}$/u.test(namespace) ? namespace : null;
}

const RECORDED_CASE_OPEN = /^[ ]*case "\$MARKER_NAMESPACE" in[ ]*$/u;
const RECORDED_CASE_ARM = /^[ ]*([a-z][a-z0-9-]{2,48}|\*)\)[ ]+RECORDED_PAID_ATTEMPTS=([0-9]{1,6})[ ]*;;[ ]*(?:#.*)?$/u;
const RECORDED_CASE_CLOSE = /^[ ]*esac[ ]*$/u;

/**
 * The step-9 gate's hand-maintained `RECORDED_PAID_ATTEMPTS` table, read from
 * main's workflow text (what `gh workflow run --ref main` runs), never run.
 * Strict: exactly one `case "$MARKER_NAMESPACE" in` block, exactly one
 * `RECORDED_PAID_ATTEMPTS=` assignment per arm and none outside it, each arm
 * one line, distinct namespaces, and exactly one `*)` default as the last arm.
 * Anything else is null, which the rerun gate reads as UNKNOWN.
 */
export function parseRecordedPaidAttempts(workflowSource: string): { readonly byNamespace: ReadonlyMap<string, number>; readonly fallback: number } | null {
  const lines = workflowSource.replaceAll('\r\n', '\n').split('\n');
  const opens = lines.flatMap((line, index) => (RECORDED_CASE_OPEN.test(line) ? [index] : []));
  if (opens.length !== 1) return null;
  const assignments = lines.filter((line) => line.includes('RECORDED_PAID_ATTEMPTS=')).length;
  const byNamespace = new Map<string, number>();
  let fallback: number | null = null;
  let arms = 0;
  for (let index = (opens[0] ?? 0) + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (RECORDED_CASE_CLOSE.test(line)) {
      return fallback === null || arms !== assignments ? null : { byNamespace, fallback };
    }
    const arm = RECORDED_CASE_ARM.exec(line);
    if (arm === null || fallback !== null) return null;
    arms += 1;
    const value = Number(arm[2]);
    if (arm[1] === '*') fallback = value;
    else if (byNamespace.has(arm[1] ?? '')) return null;
    else byNamespace.set(arm[1] ?? '', value);
  }
  return null;
}

/** The recorded prior paid attempts main's workflow holds for one namespace, or null when unreadable. */
export function recordedPaidAttempts(workflowSource: string, namespace: string): number | null {
  const table = parseRecordedPaidAttempts(workflowSource);
  if (table === null) return null;
  return table.byNamespace.get(namespace) ?? table.fallback;
}

/** The step-9 count: `<ns>-completed` markers plus the recorded constant. Either unknown is UNKNOWN. */
export function priorCompletedCount(completed: PriorAttemptRead, recorded: number | null): PriorCount {
  const markers = priorCount(completed);
  if (markers === 'UNKNOWN' || recorded === null || !Number.isSafeInteger(recorded) || recorded < 0) return 'UNKNOWN';
  return markers + recorded;
}

/**
 * Whether a paid dispatch may go on, from the two prior-run counts the paid
 * workflow gates on and the phrase the founder typed for THIS claim. Pure.
 * - Either count UNKNOWN refuses, whatever was typed: the phrase unlocks a
 *   proven count only.
 * - Both 0 goes on with no `acknowledge_rerun`; a typed phrase is ignored.
 * - Either above 0 goes on with `acknowledge_rerun` only when the exact phrase
 *   was typed.
 */
export type RerunDecision =
  | { readonly ok: true; readonly acknowledgedRerun: boolean; readonly priorAttempted: number; readonly priorCompleted: number }
  | {
    readonly ok: false;
    readonly kind: 'julius_prior_attempts_unknown' | 'julius_rerun_consent_required';
    readonly priorAttempted: PriorCount;
    readonly priorCompleted: PriorCount;
  };

export function decideRerun(
  prior: { readonly attempted: PriorCount; readonly completed: PriorCount },
  rerunConfirmation: string | null | undefined,
): RerunDecision {
  const valid = (count: PriorCount): count is number => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  const priorAttempted = valid(prior.attempted) ? prior.attempted : 'UNKNOWN';
  const priorCompleted = valid(prior.completed) ? prior.completed : 'UNKNOWN';
  if (priorAttempted === 'UNKNOWN' || priorCompleted === 'UNKNOWN') {
    return { ok: false, kind: 'julius_prior_attempts_unknown', priorAttempted, priorCompleted };
  }
  if (priorAttempted === 0 && priorCompleted === 0) return { ok: true, acknowledgedRerun: false, priorAttempted, priorCompleted };
  if (rerunConfirmation === RERUN_PAID_MISSION_CONFIRMATION) {
    return { ok: true, acknowledgedRerun: true, priorAttempted, priorCompleted };
  }
  return { ok: false, kind: 'julius_rerun_consent_required', priorAttempted, priorCompleted };
}

export const OPERATOR_LANES = ['qualification', 'qualification-repair', 'lab', 'regression'] as const;
export type OperatorLane = (typeof OPERATOR_LANES)[number];

/** Where the lane grant lives on `main`, beside the ceilings. */
export const LANE_GRANT_SOURCE = 'scripts/julius-live-contract-check.mjs';

/** The mission contract the workflow checks, on `main`. */
export function missionContractPath(mission: string): string {
  return `.github/julius-missions/${mission}/contract.json`;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface GhResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The only process this tool is allowed to start. Tests pass a fake. */
export interface GhSpawner {
  run(args: readonly string[]): GhResult;
}

export type OperatorViewState =
  | 'admitted'
  | 'dispatching'
  | 'dispatched'
  | 'dispatch_failed'
  | 'already_spent'
  | 'RESERVED'
  | 'LEDGER_UNWRITTEN'
  | 'INTERRUPTED'
  | 'FAILED';

export interface OperatorView {
  readonly wonderlandRunId: string;
  readonly serverRunId: string;
  readonly state: OperatorViewState;
  readonly missionId: string | null;
  readonly dispatchKey: string;
  readonly spentTag: string;
  readonly spentTagState: 'unknown' | 'present' | 'absent';
  readonly dispatchAttempted: boolean;
  readonly dispatchError: DispatchError | null;
  readonly halt: WorkflowHalt | null;
  /**
   * The derived `julius-paid-<hex>` name the workflow checks beside the
   * spent tag. Not the workflow's concurrency group, which is
   * `julius-first-live-mission-${github.run_id}`.
   */
  readonly concurrencyGroup: string;
  readonly claimedAt: string | null;
  /** GitHub Actions workflow run id, once dispatch has learned it. Null until then. */
  readonly workflowRunId: string | null;
}

export interface ClaimInput {
  readonly wonderlandRunId: string;
  readonly serverRunId: string;
  readonly repo: string;
  readonly lane: string;
  /** The checked-out workflow. Read by a dry run only: a dispatch reads `main`. */
  readonly workflowSource: string;
  readonly dispatch: boolean;
  readonly confirmation: string | null;
  /**
   * The founder's second phrase, typed for THIS admission in the paired
   * Wonderland session. Only the Start route sets it. It counts only when the
   * bridge proves a prior paid attempt; it never unlocks UNKNOWN.
   */
  readonly rerunConfirmation?: string | null;
}

/** Server clock. Tests inject this. Callers cannot pass it on a claim. */
export interface OperatorClaimClock {
  readonly nowIso: () => string;
}

export interface OperatorStatusPhase {
  readonly projection: WonderlandStatusProjection;
  readonly updatedAt: string;
}

export type ClaimResult =
  | {
    readonly ok: true;
    readonly claimed: boolean;
    readonly replayed: boolean;
    readonly record: OperatorView;
    readonly command: string | null;
    readonly dispatchedWorkflow: boolean;
    readonly requiredInput: null;
  }
  | {
    readonly ok: false;
    readonly kind: string;
    readonly message: string;
    readonly record: OperatorView | null;
    readonly command: null;
    readonly requiredInput: string | null;
    /** On a rerun refusal: the counted prior paid attempts, or UNKNOWN. */
    readonly priorAttempted?: number | 'UNKNOWN';
    /** On a rerun refusal: completed markers plus the recorded constant, or UNKNOWN. */
    readonly priorCompleted?: number | 'UNKNOWN';
  };

export type StatusResult =
  | { readonly ok: true; readonly record: OperatorView; readonly phase: OperatorStatusPhase | null }
  | { readonly ok: false; readonly kind: string; readonly message: string };

export interface ReconcileInput {
  readonly wonderlandRunId: string;
  readonly serverRunId: string;
  readonly repo: string;
}

/** What GitHub showed. Printed so the operator sees why the record moved or stayed. */
export interface ReconcileEvidence {
  readonly spentTag: 'present' | 'absent';
  readonly tagWorkflowRunId: string | null;
  readonly matchedRuns: readonly {
    readonly workflowRunId: string;
    /** GitHub's run attempt. A Re-run keeps the id and raises this; only attempt 1 is this dispatch. */
    readonly attempt: number;
    readonly status: string;
    readonly conclusion: string | null;
  }[];
}

export type ReconcileResult =
  | {
    readonly ok: true;
    /** False when the record was not `dispatching`: nothing was read or written. */
    readonly reconciled: boolean;
    readonly record: OperatorView;
    readonly evidence: ReconcileEvidence | null;
  }
  | {
    readonly ok: false;
    readonly kind: string;
    readonly message: string;
    readonly record: OperatorView | null;
    readonly evidence: ReconcileEvidence | null;
  };

/** Hex suffix of a parsed admission id. 32 for `wlj_`, 24 for a legacy `run:` id. */
export function serverRunHex(serverRunId: string): string {
  return derivedRun(serverRunId).suffix;
}

/**
 * The spent lock PR #434 derives. A `wlj_` id checks
 * `julius-run-spent-<32hex>`. A legacy `run:` id checks `<24hex>`.
 * The name is the module's tag with `refs/tags/` removed, so the `gh api`
 * path does not double that prefix.
 */
export function spentTagName(serverRunId: string): string {
  const derived = deriveJuliusSpentTag(serverRunId);
  if (!derived.ok || !derived.tag.startsWith('refs/tags/')) throw new Error('run_id_invalid');
  return derived.tag.slice('refs/tags/'.length);
}

export function concurrencyGroupName(serverRunId: string): string {
  return derivedRun(serverRunId).concurrencyGroup;
}

function derivedRun(serverRunId: string): { readonly suffix: string; readonly form: 'wlj' | 'legacy'; readonly concurrencyGroup: string } {
  const derived = deriveJuliusSpentTag(serverRunId);
  if (!derived.ok) throw new Error('run_id_invalid');
  return derived;
}

export function spentTagApiArgs(repo: string, serverRunId: string): readonly string[] {
  const tag = spentTagName(serverRunId);
  return ['api', '--include', `repos/${repo}/git/ref/tags/${tag}`];
}

export function workflowDispatchArgs(input: {
  readonly repo: string;
  readonly mission: string;
  readonly lane: string;
  readonly dispatchKey: string;
  readonly serverRunId: string;
  /**
   * True only when the operator passed `--confirm 'RUN LIVE MISSION'`. Only
   * then does the argv carry `confirm_live`.
   */
  readonly confirmLive?: boolean;
  /**
   * True only for a reservation whose rerun decision was "proven prior
   * attempt, founder typed the phrase". Only then does the argv carry
   * `acknowledge_rerun`.
   */
  readonly acknowledgeRerun?: boolean;
  /**
   * Journal progress already loaded for this store. Checked before the
   * on-disk re-read so a note the caller has already seen cannot be skipped.
   */
  readonly progress?: readonly StoredProgress[];
  /** When set, the on-disk journal is read before any dispatch argument is built. */
  readonly storePath?: string;
}): readonly string[] {
  const onDisk = input.storePath === undefined ? [] : readAdmissionDocument(input.storePath).progress;
  if (awaitingOperatorExpiryNote(onDisk, input.serverRunId) !== null
    || awaitingOperatorExpiryNote(input.progress ?? [], input.serverRunId) !== null) {
    throw new Error('AWAITING_OPERATOR_EXPIRED');
  }
  if (derivedRun(input.serverRunId).form !== 'wlj') throw new Error('run_id_invalid');
  return [
    'workflow', 'run', PAID_WORKFLOW_FILE,
    '--repo', input.repo,
    '--ref', 'main',
    '-f', `mission=${input.mission}`,
    '-f', `lane=${input.lane}`,
    '-f', `dispatch_key=${input.dispatchKey}`,
    ...(input.confirmLive === true ? ['-f', `confirm_live=${OPERATOR_DISPATCH_CONFIRMATION}`] : []),
    ...(input.confirmLive === true && input.acknowledgeRerun === true
      ? ['-f', `${WORKFLOW_RERUN_INPUT}=${RERUN_PAID_MISSION_CONFIRMATION}`]
      : []),
    '-f', `${WORKFLOW_RUN_ID_INPUT}=${input.serverRunId}`,
  ];
}

export function formatGhCommand(args: readonly string[]): string {
  return ['gh', ...args.map(quoteArg)].join(' ');
}

export function workflowDispatchInputNames(source: string): readonly string[] {
  const names: string[] = [];
  let inOn = false;
  let onIndent = 0;
  let inDispatch = false;
  let dispatchIndent = 0;
  let inInputs = false;
  let inputsIndent = 0;
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const spaces = leadingSpaces(line);
    if (spaces === null) continue;
    const trimmed = line.slice(spaces).trim();
    if (!inOn) {
      if (trimmed === 'on:') {
        inOn = true;
        onIndent = spaces;
      }
      continue;
    }
    if (spaces <= onIndent) return names;
    if (!inDispatch) {
      if (trimmed === 'workflow_dispatch:') {
        inDispatch = true;
        dispatchIndent = spaces;
      }
      continue;
    }
    if (spaces <= dispatchIndent) return names;
    if (!inInputs) {
      if (trimmed === 'inputs:') {
        inInputs = true;
        inputsIndent = spaces;
      }
      continue;
    }
    if (spaces <= inputsIndent) return names;
    if (spaces !== inputsIndent + 2) continue;
    const key = /^([a-z0-9_-]+):\s*(?:#.*)?$/i.exec(trimmed);
    if (key !== null) names.push(key[1]);
  }
  return names;
}

export function workflowDeclaresRunIdInput(source: string): boolean {
  return workflowDispatchInputNames(source).includes(WORKFLOW_RUN_ID_INPUT);
}

/** Inputs the dispatch argv would pass that the workflow does not declare. */
export function undeclaredDispatchInputs(source: string): readonly string[] {
  const declared = new Set(workflowDispatchInputNames(source));
  return DISPATCH_INPUTS.filter((name) => !declared.has(name));
}

const HALT_ALREADY_SPENT = /\bRUN_ID_ALREADY_SPENT\b/;
const HALT_UNVERIFIED = /\bSPENT_TAG_UNVERIFIED\b/;

/**
 * A workflow halt, wherever it is visible in `gh` output. `RUN_ID_ALREADY_SPENT`
 * wins when both are present, so a spent id is never recorded as a retryable
 * failure. Exit code is not required: a zero exit that prints a halt still counts.
 */
export function interpretWorkflowHalt(result: GhResult): WorkflowHalt | null {
  const blob = `${result.stdout}\n${result.stderr}`;
  if (HALT_ALREADY_SPENT.test(blob)) return 'RUN_ID_ALREADY_SPENT';
  if (HALT_UNVERIFIED.test(blob)) return 'SPENT_TAG_UNVERIFIED';
  return null;
}

/** Read `gh api --include` output. Anything that is not a clear 200 ref or a clear 404 is unreadable. */
/**
 * The run id `gh workflow run` printed, when it printed one URL for this repo.
 * Two different ids, a URL for another repo, or no URL means dispatch did not
 * learn an id. The claim stays null rather than guessing.
 */
export function learnWorkflowRunId(result: GhResult, repo: string): string | null {
  if (!isRepo(repo)) return null;
  const blob = `${result.stdout}\n${result.stderr}`;
  const pattern = new RegExp(
    `https://github\\.com/${escapeRegExp(repo)}/actions/runs/([0-9]+)\\b`,
    'g',
  );
  const ids = new Set<string>();
  for (const match of blob.matchAll(pattern)) {
    const id = match[1];
    if (id !== undefined && isStoredWorkflowRunId(id)) ids.add(id);
  }
  if (ids.size !== 1) return null;
  return [...ids][0] ?? null;
}

/** `gh api` for one file at `main`, raw. The dispatch runs `--ref main`, so this is what it runs. */
export function mainContentsArgs(repo: string, path: string): readonly string[] {
  return ['api', '-H', 'Accept: application/vnd.github.raw+json', `repos/${repo}/contents/${path}?ref=main`];
}

export interface LaneGrants {
  readonly defaults: readonly OperatorLane[];
  readonly byNamespace: ReadonlyMap<string, readonly OperatorLane[]>;
}

/**
 * `DEFAULT_LANES` and `MISSION_LANES` as `julius-live-contract-check.mjs`
 * writes them, read as text and never run. A table this cannot read line by
 * line is null, and a null grant dispatches nothing.
 */
export function parseLaneGrants(checkerSource: string): LaneGrants | null {
  const source = checkerSource.replaceAll('\r\n', '\n');
  const defaults = [...source.matchAll(/^const DEFAULT_LANES = Object\.freeze\(\[([^\]\n]*)\]\);$/gmu)];
  const tables = [...source.matchAll(/^const MISSION_LANES = Object\.freeze\(\{\n([\s\S]*?)\n\}\);$/gmu)];
  if (defaults.length !== 1 || tables.length !== 1) return null;
  const defaultLanes = laneList(defaults[0]?.[1] ?? '');
  if (defaultLanes === null) return null;
  const byNamespace = new Map<string, readonly OperatorLane[]>();
  for (const raw of (tables[0]?.[1] ?? '').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) continue;
    const entry = /^'([a-z0-9-]+)': Object\.freeze\(\[([^\]]*)\]\),?(?:\s*\/\/.*)?$/u.exec(line);
    if (entry === null) return null;
    const namespace = entry[1] ?? '';
    const granted = laneList(entry[2] ?? '');
    if (granted === null || byNamespace.has(namespace)) return null;
    byNamespace.set(namespace, granted);
  }
  return { defaults: defaultLanes, byNamespace };
}

function laneList(text: string): OperatorLane[] | null {
  const lanes: OperatorLane[] = [];
  for (const item of text.split(',').map((part) => part.trim()).filter((part) => part !== '')) {
    const quoted = /^'([a-z-]+)'$/u.exec(item);
    const lane = quoted?.[1] ?? '';
    if (!OPERATOR_LANES.includes(lane as OperatorLane) || lanes.includes(lane as OperatorLane)) return null;
    lanes.push(lane as OperatorLane);
  }
  return lanes.length === 0 ? null : lanes;
}

/**
 * The lanes the contract may claim, by its own `markerNamespace`, as the
 * checker's `lanesFor` decides: a namespace absent from the table gets the
 * defaults. A contract that is not a JSON object is null.
 */
export function grantedLanes(contractSource: string, grants: LaneGrants): readonly OperatorLane[] | null {
  let contract: unknown;
  try {
    contract = JSON.parse(contractSource);
  } catch {
    return null;
  }
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) return null;
  const namespace = (contract as Record<string, unknown>).markerNamespace;
  if (typeof namespace === 'string' && grants.byNamespace.has(namespace)) return grants.byNamespace.get(namespace) ?? null;
  return grants.defaults;
}

const HTTP_DATE_LINE = /^date:[ \t]*([A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT)[ \t]*\r?$/gimu;

/**
 * GitHub's clock from a `gh api --include` response: exactly one `Date:`
 * header in IMF-fixdate form that names a real instant, as ISO UTC at
 * seconds. Anything else is null.
 */
export function githubDateFromResponse(result: GhResult): string | null {
  const found = [...`${result.stdout}\n${result.stderr}`.matchAll(HTTP_DATE_LINE)];
  if (found.length !== 1) return null;
  const header = found[0]?.[1] ?? '';
  const ms = Date.parse(header);
  if (!Number.isFinite(ms) || new Date(ms).toUTCString() !== header) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

/** The annotated tag object a spent ref points at, or null for anything else. */
export function spentTagObjectSha(result: GhResult): string | null {
  const body = jsonBody(result.stdout);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const object = (body as Record<string, unknown>).object;
  if (object === null || typeof object !== 'object' || Array.isArray(object)) return null;
  const { type, sha } = object as Record<string, unknown>;
  return type === 'tag' && typeof sha === 'string' && /^[0-9a-f]{40}$/u.test(sha) ? sha : null;
}

/**
 * `workflow_run_id` from a `julius-run-spent.v1` tag message for this run.
 * A message for another run, another schema, or a repeated key is null.
 */
export function spentTagWorkflowRunId(result: GhResult, serverRunId: string): string | null {
  if (result.code !== 0) return null;
  const body = jsonBody(result.stdout);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const message = (body as Record<string, unknown>).message;
  if (typeof message !== 'string') return null;
  const lines = message.split('\n').filter((line) => line !== '');
  if (lines[0] !== 'julius-run-spent.v1') return null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const eq = line.indexOf('=');
    if (eq <= 0) return null;
    const key = line.slice(0, eq);
    if (fields.has(key)) return null;
    fields.set(key, line.slice(eq + 1));
  }
  if (fields.get('run') !== serverRunId) return null;
  const id = fields.get('workflow_run_id') ?? '';
  return isStoredWorkflowRunId(id) ? id : null;
}

/** Paid runs of the workflow on main, newest first, as `gh run list` reports them. */
export function paidRunListArgs(repo: string): readonly string[] {
  return [
    'run', 'list', '--repo', repo, '--workflow', PAID_WORKFLOW_FILE,
    '--event', 'workflow_dispatch', '--branch', 'main', '--limit', '200',
    '--json', 'databaseId,displayTitle,status,conclusion,event,headBranch,attempt',
  ];
}

/**
 * The runs whose run name is this claim's paid dispatch: the workflow's
 * `run-name` ends `mode=paid key=<dispatch key>`. Null when the list is not
 * readable JSON.
 */
export function runsForDispatchKey(result: GhResult, dispatchKey: string): ReconcileEvidence['matchedRuns'] | null {
  if (result.code !== 0) return null;
  const body = jsonBody(result.stdout);
  if (!Array.isArray(body)) return null;
  const suffix = ` mode=paid key=${dispatchKey}`;
  const matched: { workflowRunId: string; attempt: number; status: string; conclusion: string | null }[] = [];
  for (const row of body) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    const { databaseId, displayTitle, status, conclusion, event, headBranch, attempt } = row as Record<string, unknown>;
    if (typeof displayTitle !== 'string' || !displayTitle.endsWith(suffix) || event !== 'workflow_dispatch') continue;
    // The claim dispatches `--ref main`. A run for the key on any other branch is not this dispatch.
    if (headBranch !== 'main') continue;
    const id = typeof databaseId === 'number' && Number.isSafeInteger(databaseId) ? String(databaseId) : '';
    if (!isStoredWorkflowRunId(id) || typeof status !== 'string') return null;
    if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 1) return null;
    matched.push({ workflowRunId: id, attempt, status, conclusion: typeof conclusion === 'string' && conclusion !== '' ? conclusion : null });
  }
  return matched;
}

function jsonBody(stdout: string): unknown {
  // `--include` puts the status line and headers first; the body starts at the first `{` or `[` line.
  const lines = stdout.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.startsWith('{') || line.startsWith('['));
  if (start === -1) return null;
  try {
    return JSON.parse(lines.slice(start).join('\n'));
  } catch {
    return null;
  }
}

export function interpretSpentTagResponse(result: GhResult): 'present' | 'absent' | 'unreadable' {
  if (result.code === 0 && /"ref"\s*:/.test(result.stdout)) return 'present';
  const blob = `${result.stdout}\n${result.stderr}`;
  const status = /HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(blob);
  if (status?.[1] === '404') return 'absent';
  if (result.code !== 0 && /Not Found/.test(blob)) return 'absent';
  return 'unreadable';
}

export interface OperatorClaimTool {
  claim(input: ClaimInput): Promise<ClaimResult>;
  status(wonderlandRunId: string, serverRunId: string): Promise<StatusResult>;
  reconcile(input: ReconcileInput): Promise<ReconcileResult>;
}

export function createOperatorClaimTool(
  file: AdmissionFile,
  spawn: GhSpawner,
  clock: OperatorClaimClock = { nowIso: () => new Date().toISOString() },
  priorAttempts: PriorAttemptReader = UNWIRED_PRIOR_ATTEMPTS,
): OperatorClaimTool {
  // Claims from one tool run one after another, so a second claim in this
  // process sees the first one's reservation before it reads the spent tag.
  let claims: Promise<unknown> = Promise.resolve();
  return {
    claim(input) {
      const next = (): Promise<ClaimResult> => claimPhased(file, input, spawn, clock, priorAttempts);
      const run = claims.then(next, next);
      claims = run.then(() => undefined, () => undefined);
      return run;
    },
    status(wonderlandRunId, serverRunId) {
      return file.exclusive((io) => Promise.resolve(statusInside(io, file.path, wonderlandRunId, serverRunId, clock)));
    },
    reconcile(input) {
      const next = (): Promise<ReconcileResult> => reconcilePhased(file, input, spawn);
      const run = claims.then(next, next);
      claims = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

export function openOperatorClaimTool(
  storePath: string,
  spawn: GhSpawner,
  clock?: OperatorClaimClock,
  priorAttempts: PriorAttemptReader = UNWIRED_PRIOR_ATTEMPTS,
): OperatorClaimTool {
  const file = openAdmissionFile(storePath);
  return clock === undefined
    ? createOperatorClaimTool(file, spawn, undefined, priorAttempts)
    : createOperatorClaimTool(file, spawn, clock, priorAttempts);
}

/**
 * Each write lock is held for one read-check-write only, never across a `gh`
 * child: (1) check, (2) read the workflow, the mission contract and the lane
 * grant at `main` and refuse an undeclared input or an ungranted lane, (3)
 * read the spent tag and GitHub's clock without the lock, (4) re-check and
 * write `dispatching` or `already_spent`, (5) spawn the workflow without the
 * lock, (6) write the outcome. A stop between (4) and (6) leaves
 * `dispatching`: whether the workflow started is unknown, it is never
 * reported as `dispatched` or retried, and only `reconcile` moves it, from
 * GitHub evidence.
 */
async function claimPhased(
  file: AdmissionFile,
  input: ClaimInput,
  spawn: GhSpawner,
  clock: OperatorClaimClock,
  priorAttempts: PriorAttemptReader,
): Promise<ClaimResult> {
  const checked = await file.exclusive((io) => Promise.resolve(checkClaim(io, file.path, input, clock)));
  if (checked.kind === 'done') return checked.result;
  const onMain = mainRefusal(spawn, input, checked.admission);
  if (!onMain.ok) return onMain.result;
  // THE RERUN GATE, before any claim is written or anything dispatched: the
  // two counts the paid workflow gates on for this contract's namespace, the
  // step-9 completed markers plus main's recorded constant, and the
  // attempted markers. A refusal here writes nothing, so the admission stays
  // held and claimable.
  const readOne = async (which: 'read' | 'readCompleted'): Promise<PriorAttemptRead> => {
    if (onMain.namespace === '') return { readable: false };
    try {
      return await priorAttempts[which]({ repo: input.repo, namespace: onMain.namespace });
    } catch {
      return { readable: false };
    }
  };
  const prior = {
    attempted: priorCount(await readOne('read')),
    completed: priorCompletedCount(await readOne('readCompleted'), recordedPaidAttempts(onMain.workflow, onMain.namespace)),
  };
  const rerun = decideRerun(prior, input.rerunConfirmation);
  if (!rerun.ok) return rerunRefusal(rerun, toView(checked.admission, null));
  if (rerun.acknowledgedRerun && !workflowDispatchInputNames(onMain.workflow).includes(WORKFLOW_RERUN_INPUT)) {
    return fail(
      'workflow_dispatch_input_missing',
      `The paid workflow does not declare workflow_dispatch input ${WORKFLOW_RERUN_INPUT}. Nothing was claimed or dispatched.`,
      toView(checked.admission, null),
    );
  }
  const consent: RerunConsent = {
    wonderlandRunId: checked.admission.runId,
    serverRunId: checked.admission.serverRunId,
    prior,
    acknowledgedRerun: rerun.acknowledgedRerun,
    priorAttempted: rerun.priorAttempted,
    priorCompleted: rerun.priorCompleted,
  };
  const tagRead = spawn.run(spentTagApiArgs(input.repo, checked.admission.serverRunId));
  const tag = interpretSpentTagResponse(tagRead);
  if (tag === 'unreadable') {
    return fail(
      'spent_tag_unreadable',
      'The spent tag could not be read. The record was not claimed and nothing was dispatched.',
      toView(checked.admission, null),
    );
  }
  const githubDate = githubDateFromResponse(tagRead);
  if (tag === 'absent' && githubDate === null) {
    return fail(
      'github_clock_unreadable',
      'GitHub\'s Date header could not be read from the spent-tag response. The record was not claimed and nothing was dispatched.',
      toView(checked.admission, null),
    );
  }
  const reserved = await file.exclusive((io) => Promise.resolve(reserveClaim(io, file.path, input, clock, tag, githubDate, consent)));
  if (reserved.kind === 'done') return reserved.result;
  const ran = spawn.run(reserved.liveArgs);
  return file.exclusive((io) => Promise.resolve(recordDispatchOutcome(io, input, reserved, ran)));
}

/**
 * The dispatch runs `--ref main`, so what is checked is `main`: the workflow
 * declares every input the argv passes, and the mission's contract there is
 * granted the lane. When both hold: the workflow and the contract's marker
 * namespace (null when the contract names none it can be read for, which the
 * rerun gate then reads as UNKNOWN).
 */
function mainRefusal(
  spawn: GhSpawner,
  input: ClaimInput,
  admission: StoredAdmission,
): { readonly ok: false; readonly result: ClaimResult } | { readonly ok: true; readonly workflow: string; readonly namespace: string } {
  const refused = (result: ClaimResult) => ({ ok: false as const, result });
  const record = toView(admission, null);
  const read = (path: string): string | null => {
    const result = spawn.run(mainContentsArgs(input.repo, path));
    return result.code === 0 && result.stdout.trim() !== '' ? result.stdout : null;
  };
  const workflow = read(`.github/workflows/${PAID_WORKFLOW_FILE}`);
  if (workflow === null) {
    return refused(fail('main_workflow_unreadable', 'The paid workflow could not be read at main. Nothing was claimed or dispatched.', record));
  }
  const inputs = workflowInputsRefusal(workflow, admission);
  if (inputs !== null) return refused(inputs);
  const contract = read(missionContractPath(admission.missionId ?? ''));
  const checker = contract === null ? null : read(LANE_GRANT_SOURCE);
  const grants = checker === null ? null : parseLaneGrants(checker);
  const granted = contract === null || grants === null ? null : grantedLanes(contract, grants);
  if (contract === null || granted === null) {
    return refused(fail(
      'lane_grant_unreadable',
      'The mission contract or the lane grant could not be read at main. Nothing was claimed or dispatched.',
      record,
    ));
  }
  if (!granted.includes(input.lane as OperatorLane)) {
    return refused(fail(
      'lane_not_granted',
      `The lane ${input.lane} is not granted to ${admission.missionId ?? 'this mission'} on main; it may claim ${granted.join(', ')}. Nothing was claimed or dispatched.`,
      record,
    ));
  }
  return { ok: true, workflow, namespace: contractMarkerNamespace(contract) ?? '' };
}

function workflowInputsRefusal(workflowSource: string, admission: StoredAdmission): ClaimResult | null {
  if (!workflowDeclaresRunIdInput(workflowSource)) {
    return fail(
      'workflow_run_id_input_missing',
      'The paid workflow does not declare workflow_dispatch input run_id. Nothing was claimed or dispatched.',
      toView(admission, null),
      WORKFLOW_RUN_ID_INPUT_YAML,
    );
  }
  const undeclared = undeclaredDispatchInputs(workflowSource);
  if (undeclared.length > 0) {
    return fail(
      'workflow_dispatch_input_missing',
      `The paid workflow does not declare workflow_dispatch input ${undeclared.join(', ')}. Nothing was claimed or dispatched.`,
      toView(admission, null),
    );
  }
  return null;
}

type Checked =
  | { readonly kind: 'done'; readonly result: ClaimResult }
  | { readonly kind: 'plan'; readonly admission: StoredAdmission; readonly nowIso: string; readonly command: string };

/**
 * The rerun decision made before the reservation, bound to the one admission
 * it was made for. `reserveClaim` re-derives it under the lock and refuses if
 * it no longer holds.
 */
interface RerunConsent {
  readonly wonderlandRunId: string;
  readonly serverRunId: string;
  readonly prior: { readonly attempted: PriorCount; readonly completed: PriorCount };
  readonly acknowledgedRerun: boolean;
  readonly priorAttempted: number;
  readonly priorCompleted: number;
}

/** What every event of one claim carries: present only for an acknowledged rerun. */
type RerunFields = { readonly acknowledgedRerun?: true; readonly priorAttempted?: number; readonly priorCompleted?: number };

function rerunFields(acknowledged: boolean, priorAttempted: number | undefined, priorCompleted: number | undefined): RerunFields {
  return acknowledged && typeof priorAttempted === 'number' && typeof priorCompleted === 'number'
    ? { acknowledgedRerun: true, priorAttempted, priorCompleted }
    : {};
}

function rerunRefusal(decision: Extract<RerunDecision, { ok: false }>, record: OperatorView): ClaimResult {
  const message = decision.kind === 'julius_prior_attempts_unknown'
    ? 'The paid workflow\'s prior-attempt markers could not be read, so whether this mission was already paid for is UNKNOWN. The rerun phrase cannot unlock an unknown state. Nothing was claimed or dispatched; the admission is still held.'
    : `This mission already has ${String(decision.priorAttempted)} counted paid attempt(s) and ${String(decision.priorCompleted)} completed or recorded prior paid run(s). Starting it again needs the founder's second confirmation, RERUN PAID MISSION. Nothing was claimed or dispatched; the admission is still held.`;
  return {
    ok: false, kind: decision.kind, message, record, command: null, requiredInput: null,
    priorAttempted: decision.priorAttempted, priorCompleted: decision.priorCompleted,
  };
}

interface Reservation {
  readonly kind: 'reserved';
  readonly admission: StoredAdmission;
  readonly at: string;
  readonly githubDate: string | null;
  readonly liveArgs: readonly string[];
  readonly command: string;
  readonly rerun: RerunFields;
}

type Reserved = { readonly kind: 'done'; readonly result: ClaimResult } | Reservation;

function checkClaim(
  io: AdmissionFileIo,
  storePath: string,
  input: ClaimInput,
  clock: OperatorClaimClock,
): Checked {
  const done = (result: ClaimResult): Checked => ({ kind: 'done', result });
  const shape = validateShape(input);
  if (shape !== null) return done(shape);
  const nowIso = clock.nowIso();
  if (!ISO.test(nowIso)) return done(fail('clock_invalid', 'The operator clock is not an ISO timestamp.', null));
  const document = io.read();
  const located = locate(document, input.wonderlandRunId, input.serverRunId);
  if (located.kind === 'not_found') return done(fail('admission_not_found', 'No admitted record matches that pair.', null));
  if (located.kind === 'server_run_mismatch') {
    return done(fail('server_run_mismatch', 'The server run id does not match the admitted record.', null));
  }
  if (located.kind === 'wonderland_run_mismatch') {
    return done(fail('wonderland_run_mismatch', 'The wlj_ run id does not match the admitted record.', null));
  }
  if (located.admission === null) {
    if (located.claim === null) return done(fail('admission_not_found', 'No admitted record matches that pair.', null));
    const claimIdentity = identifyAdmissionRun(located.claim.wonderlandRunId, located.claim.serverRunId);
    if (claimIdentity.ok && claimIdentity.form === 'legacy') {
      return done(fail('legacy_readonly', 'A legacy run: admission cannot be claimed, dispatched, or spend-locked.', null));
    }
    return done(replay(viewFromClaim(located.claim)));
  }
  const admission = located.admission;
  if (isLegacyAdmission(admission)) {
    return done(fail(
      'legacy_readonly',
      'A legacy run: admission cannot be claimed, dispatched, or spend-locked.',
      toView(admission, located.claim),
    ));
  }
  if (sealedExpiry(storePath, document, admission.serverRunId) !== null) return done(expiredRefusal(admission));
  if (located.claim !== null) return done(replay(toView(admission, located.claim)));
  if (admission.admissionState !== 'ADMISSION_HELD') {
    return done(fail('not_admitted', `The record is ${admission.admissionState} and is not admitted.`, toView(admission, null)));
  }
  const heldPhase = projectUnclaimedHeldPhase(admission.receivedAt, Date.parse(nowIso));
  if (heldPhase.kind === 'operator_expired') {
    io.noteExpiry(admission.serverRunId, heldPhase.updatedAt);
    return done(expiredRefusal(admission));
  }
  if (heldPhase.kind !== 'awaiting_operator') {
    return done(fail(
      'admission_clock_unreadable',
      'The held-phase clock could not be read. The record was not claimed and nothing was dispatched.',
      toView(admission, null),
    ));
  }
  if (admission.missionId === null || !MISSION_SLUG.test(admission.missionId)) {
    return done(fail('mission_unset', 'The admitted record has no mission slug.', toView(admission, null)));
  }
  if (!PAID_SLOT_DISPATCH_KEY.test(admission.keyHash)) {
    return done(fail('dispatch_key_invalid', 'The admitted dispatch key cannot be passed to the paid workflow.', toView(admission, null)));
  }
  // A dry run checks the checked-out workflow. A dispatch checks main, before the spent tag is read.
  const local = input.dispatch ? null : workflowInputsRefusal(input.workflowSource, admission);
  if (local !== null) return done(local);
  const confirmLive = input.confirmation === OPERATOR_DISPATCH_CONFIRMATION;
  const dispatchArgs = guardedDispatchArgs({
    repo: input.repo,
    mission: admission.missionId,
    lane: input.lane,
    dispatchKey: admission.keyHash,
    serverRunId: admission.serverRunId,
    confirmLive,
    progress: document.progress,
    storePath,
  });
  if (dispatchArgs === null) return done(expiredRefusal(admission));
  const command = formatGhCommand(dispatchArgs);
  if (!input.dispatch) {
    // A dry run writes nothing. The pair stays admitted and claimable.
    return done({
      ok: true,
      claimed: false,
      replayed: false,
      record: toView(admission, null),
      command,
      dispatchedWorkflow: false,
      requiredInput: null,
    });
  }
  if (!confirmLive) {
    return done(fail(
      'dispatch_confirmation_required',
      'Dispatch requires the exact confirmation RUN LIVE MISSION. The record was not claimed.',
      toView(admission, null),
    ));
  }
  return { kind: 'plan', admission, nowIso, command };
}

function reserveClaim(
  io: AdmissionFileIo,
  storePath: string,
  input: ClaimInput,
  clock: OperatorClaimClock,
  tag: 'present' | 'absent',
  githubDate: string | null,
  consent: RerunConsent,
): Reserved {
  // The record may have moved while the spent tag was read: check again.
  const checked = checkClaim(io, storePath, input, clock);
  if (checked.kind === 'done') return checked;
  const { admission, nowIso, command } = checked;
  // The consent is this admission's, and the decision still holds.
  const again = decideRerun(consent.prior, input.rerunConfirmation);
  if (consent.wonderlandRunId !== admission.runId || consent.serverRunId !== admission.serverRunId
    || !again.ok || again.acknowledgedRerun !== consent.acknowledgedRerun || again.priorAttempted !== consent.priorAttempted
    || again.priorCompleted !== consent.priorCompleted) {
    return {
      kind: 'done',
      result: fail('julius_rerun_consent_moved', 'The rerun decision does not match this admission. Nothing was claimed or dispatched.', toView(admission, null)),
    };
  }
  const rerun = rerunFields(consent.acknowledgedRerun, consent.priorAttempted, consent.priorCompleted);
  const document = io.read();
  if (sealedExpiry(storePath, document, admission.serverRunId) !== null) {
    return { kind: 'done', result: expiredRefusal(admission) };
  }
  if (tag === 'present') {
    const event = baseEvent(admission, nowIso, {
      state: 'already_spent',
      spentTagState: 'present',
      dispatchAttempted: false,
      dispatchError: null,
      halt: 'RUN_ID_ALREADY_SPENT',
      githubDate,
      rerun,
    });
    io.write(appendClaim(document, event));
    if (!claimWasRecorded(storePath, event)) return { kind: 'done', result: expiredRefusal(admission) };
    return {
      kind: 'done',
      result: fail(
        'RUN_ID_ALREADY_SPENT',
        'The spent tag already exists. The record is already_spent. Nothing was dispatched.',
        toView(admission, event),
      ),
    };
  }
  const reservation = baseEvent(admission, nowIso, {
    state: 'dispatching',
    spentTagState: 'absent',
    dispatchAttempted: false,
    dispatchError: null,
    halt: null,
    githubDate,
    rerun,
  });
  io.write(appendClaim(document, reservation));
  if (!claimWasRecorded(storePath, reservation)) return { kind: 'done', result: expiredRefusal(admission) };
  const liveArgs = guardedDispatchArgs({
    repo: input.repo,
    mission: admission.missionId ?? '',
    lane: input.lane,
    dispatchKey: admission.keyHash,
    serverRunId: admission.serverRunId,
    confirmLive: true,
    acknowledgeRerun: reservation.acknowledgedRerun === true,
    progress: io.read().progress,
    storePath,
  });
  if (liveArgs === null) return { kind: 'done', result: expiredRefusal(admission) };
  return { kind: 'reserved', admission, at: nowIso, githubDate, liveArgs, command, rerun };
}

/**
 * The outcome of the one `gh workflow run` child. `dispatched` only for a
 * zero exit with no halt. Every event keeps the reservation's timestamp, which
 * was read before the child was spawned.
 */
function recordDispatchOutcome(
  io: AdmissionFileIo,
  input: ClaimInput,
  reserved: Reservation,
  ran: GhResult,
): ClaimResult {
  const { admission, at, githubDate, command, rerun } = reserved;
  const document = io.read();
  const halt = interpretWorkflowHalt(ran);
  const workflowRunId = learnWorkflowRunId(ran, input.repo);
  if (halt === 'RUN_ID_ALREADY_SPENT') {
    const spent = baseEvent(admission, at, {
      state: 'already_spent',
      spentTagState: 'present',
      dispatchAttempted: true,
      dispatchError: null,
      halt,
      workflowRunId,
      githubDate,
      rerun,
    });
    io.write(appendClaim(document, spent));
    return fail(
      'RUN_ID_ALREADY_SPENT',
      'The workflow halted with RUN_ID_ALREADY_SPENT. The record is already_spent and will not be retried.',
      toView(admission, spent),
    );
  }
  if (halt === 'SPENT_TAG_UNVERIFIED' || ran.code !== 0) {
    const unverified = halt === 'SPENT_TAG_UNVERIFIED';
    const failed = baseEvent(admission, at, {
      state: 'dispatch_failed',
      spentTagState: unverified ? 'unknown' : 'absent',
      dispatchAttempted: true,
      dispatchError: unverified ? 'SPENT_TAG_UNVERIFIED' : 'gh_workflow_run_failed',
      halt: unverified ? 'SPENT_TAG_UNVERIFIED' : null,
      workflowRunId,
      githubDate,
      rerun,
    });
    io.write(appendClaim(document, failed));
    return fail(
      unverified ? 'SPENT_TAG_UNVERIFIED' : 'dispatch_failed',
      unverified
        ? 'The workflow halted with SPENT_TAG_UNVERIFIED. The record is dispatch_failed and will not be retried.'
        : 'The workflow dispatch failed. The record is dispatch_failed and will not be retried.',
      toView(admission, failed),
    );
  }
  const dispatched = baseEvent(admission, at, {
    state: 'dispatched',
    spentTagState: 'absent',
    dispatchAttempted: true,
    dispatchError: null,
    halt: null,
    workflowRunId,
    githubDate,
    rerun,
  });
  io.write(appendClaim(document, dispatched));
  return {
    ok: true,
    claimed: true,
    replayed: false,
    record: toView(admission, dispatched),
    command,
    dispatchedWorkflow: true,
    requiredInput: null,
  };
}

type ReconcileChecked =
  | { readonly kind: 'done'; readonly result: ReconcileResult }
  | { readonly kind: 'stuck'; readonly admission: StoredAdmission; readonly reservation: ClaimEvent };

/**
 * `dispatching` -> `dispatched` or `dispatch_failed`, from GitHub alone:
 * - `dispatched` when the spent tag exists, its message names this run and a
 *   `workflow_run_id`, and that id is the one paid run on main named
 *   `key=<dispatch key>`, at attempt 1;
 * - `dispatch_failed` (`workflow_run_unspent`) when that one run, at attempt 1,
 *   had completed without success when the runs were listed, and the spent
 *   tag was absent when read AFTER that listing: a run that already ended
 *   cannot tag later, so the workflow ended before it spent the id.
 * The runs are listed before the tag is read. Read the other way round, a
 * run that tagged between the two reads would look unspent. A Re-run keeps
 * the run id and raises its attempt; any attempt above 1 leaves the record
 * `dispatching`, since #459 refuses a paid attempt above 1 and such a run is
 * not this dispatch's.
 * Anything else (no run, two runs, a run still going, a tag naming another
 * run) leaves `dispatching` and says what GitHub showed. The outcome keeps the
 * reservation's timestamp and GitHub clock. Nothing is deleted or rewritten.
 */
async function reconcilePhased(file: AdmissionFile, input: ReconcileInput, spawn: GhSpawner): Promise<ReconcileResult> {
  const checked = await file.exclusive((io) => Promise.resolve(checkReconcile(io, input)));
  if (checked.kind === 'done') return checked.result;
  const { admission, reservation } = checked;
  const record = toView(admission, reservation);
  const refused = (kind: string, message: string, evidence: ReconcileEvidence | null): ReconcileResult =>
    ({ ok: false, kind, message, record, evidence });
  const matchedRuns = runsForDispatchKey(spawn.run(paidRunListArgs(input.repo)), admission.keyHash);
  if (matchedRuns === null) {
    return refused('workflow_runs_unreadable', 'The paid workflow runs could not be listed. The record stays dispatching.', null);
  }
  const tagRead = spawn.run(spentTagApiArgs(input.repo, admission.serverRunId));
  const tag = interpretSpentTagResponse(tagRead);
  if (tag === 'unreadable') return refused('spent_tag_unreadable', 'The spent tag could not be read. The record stays dispatching.', null);
  let tagWorkflowRunId: string | null = null;
  if (tag === 'present') {
    const objectSha = spentTagObjectSha(tagRead);
    tagWorkflowRunId = objectSha === null
      ? null
      : spentTagWorkflowRunId(spawn.run(['api', `repos/${input.repo}/git/tags/${objectSha}`]), admission.serverRunId);
    if (tagWorkflowRunId === null) {
      return refused(
        'spent_tag_unverified',
        'The spent tag exists but its message does not name this run and a workflow run. The record stays dispatching.',
        { spentTag: 'present', tagWorkflowRunId: null, matchedRuns },
      );
    }
  }
  const evidence: ReconcileEvidence = { spentTag: tag, tagWorkflowRunId, matchedRuns };
  const only = matchedRuns.length === 1 ? matchedRuns[0] ?? null : null;
  const firstAttempt = only !== null && only.attempt === 1 ? only : null;
  let outcome: ClaimEvent | null = null;
  if (tag === 'present' && firstAttempt !== null && firstAttempt.workflowRunId === tagWorkflowRunId) {
    outcome = baseEvent(admission, reservation.at, {
      state: 'dispatched',
      spentTagState: 'present',
      dispatchAttempted: true,
      dispatchError: null,
      halt: null,
      workflowRunId: firstAttempt.workflowRunId,
      githubDate: reservation.githubDate,
      rerun: rerunFields(reservation.acknowledgedRerun === true, reservation.priorAttempted, reservation.priorCompleted),
    });
  } else if (tag === 'absent' && firstAttempt !== null && firstAttempt.status === 'completed' && firstAttempt.conclusion !== 'success') {
    outcome = baseEvent(admission, reservation.at, {
      state: 'dispatch_failed',
      spentTagState: 'absent',
      dispatchAttempted: true,
      dispatchError: 'workflow_run_unspent',
      halt: null,
      workflowRunId: firstAttempt.workflowRunId,
      githubDate: reservation.githubDate,
      rerun: rerunFields(reservation.acknowledgedRerun === true, reservation.priorAttempted, reservation.priorCompleted),
    });
  }
  if (outcome === null) {
    return refused(
      'reconcile_indeterminate',
      'GitHub does not show one first-attempt paid run on main for this dispatch key that agrees with the spent tag. The record stays dispatching.',
      evidence,
    );
  }
  const written = outcome;
  return file.exclusive((io) => {
    const document = io.read();
    const latest = latestClaim(document, admission.runId, admission.serverRunId);
    if (latest === null || claimKey(latest) !== claimKey(reservation)) {
      return Promise.resolve<ReconcileResult>({
        ok: false,
        kind: 'record_moved',
        message: 'The record changed while GitHub was read. Nothing was written.',
        record: latest === null ? record : toView(admission, latest),
        evidence,
      });
    }
    io.write(appendClaim(document, written));
    return Promise.resolve<ReconcileResult>({ ok: true, reconciled: true, record: toView(admission, written), evidence });
  });
}

function checkReconcile(io: AdmissionFileIo, input: ReconcileInput): ReconcileChecked {
  const done = (result: ReconcileResult): ReconcileChecked => ({ kind: 'done', result });
  const shape = pairShape(input.wonderlandRunId, input.serverRunId);
  if (shape !== null) return done({ ok: false, kind: shape.kind, message: shape.message, record: null, evidence: null });
  if (!isRepo(input.repo)) return done({ ok: false, kind: 'repo_invalid', message: 'The GitHub repo must be owner/name.', record: null, evidence: null });
  const located = locate(io.read(), input.wonderlandRunId, input.serverRunId);
  if (located.kind !== 'match' || located.admission === null) {
    return done({ ok: false, kind: 'admission_not_found', message: 'No admitted record matches that pair.', record: null, evidence: null });
  }
  const admission = located.admission;
  if (isLegacyAdmission(admission)) {
    return done({
      ok: false,
      kind: 'legacy_readonly',
      message: 'A legacy run: admission cannot be claimed, dispatched, or spend-locked.',
      record: toView(admission, located.claim),
      evidence: null,
    });
  }
  if (located.claim === null) {
    return done({ ok: false, kind: 'not_claimed', message: 'The record was never claimed. Nothing to reconcile.', record: toView(admission, null), evidence: null });
  }
  if (located.claim.state !== 'dispatching') {
    return done({ ok: true, reconciled: false, record: toView(admission, located.claim), evidence: null });
  }
  return { kind: 'stuck', admission, reservation: located.claim };
}

function claimKey(event: ClaimEvent): string {
  return JSON.stringify([event.state, event.at, event.dispatchAttempted, event.githubDate, event.workflowRunId, event.acknowledgedRerun === true, event.priorAttempted ?? null, event.priorCompleted ?? null]);
}

function statusInside(
  io: AdmissionFileIo,
  storePath: string,
  wonderlandRunId: string,
  serverRunId: string,
  clock: OperatorClaimClock,
): StatusResult {
  const shape = pairShape(wonderlandRunId, serverRunId);
  if (shape !== null) return { ok: false, kind: shape.kind, message: shape.message };
  const document = io.read();
  const located = locate(document, wonderlandRunId, serverRunId);
  if (located.kind === 'not_found') return { ok: false, kind: 'admission_not_found', message: 'No admitted record matches that pair.' };
  if (located.kind === 'server_run_mismatch') {
    return { ok: false, kind: 'server_run_mismatch', message: 'The server run id does not match the admitted record.' };
  }
  if (located.kind === 'wonderland_run_mismatch') {
    return { ok: false, kind: 'wonderland_run_mismatch', message: 'The wlj_ run id does not match the admitted record.' };
  }
  const expired = sealedExpiry(storePath, document, serverRunId);
  if (expired !== null) {
    const record = located.admission !== null
      ? toView(located.admission, null)
      : located.claim === null ? null : viewFromClaim(located.claim);
    if (record !== null) {
      return {
        ok: true,
        record,
        phase: {
          projection: { state: 'failed', cause: 'AWAITING_OPERATOR_EXPIRED' },
          updatedAt: expired.updatedAt,
        },
      };
    }
  }
  if (located.admission === null) {
    if (located.claim === null) return { ok: false, kind: 'admission_not_found', message: 'No admitted record matches that pair.' };
    return { ok: true, record: viewFromClaim(located.claim), phase: null };
  }
  const admission = located.admission;
  const dispatched = document.claims.some((event) =>
    event.serverRunId === serverRunId
    && event.wonderlandRunId === admission.runId
    && (event.state === 'dispatched' || event.dispatchAttempted));
  const progress = [...document.progress].reverse().find((note) => note.serverRunId === serverRunId) ?? null;
  if (progress !== null) {
    const decision = applyWonderlandStatusTransition({
      dispatched,
      proposedState: progress.state,
      proposedCause: progress.cause,
    });
    if (decision.ok) {
      if (isExpiryProjection(decision.projection)) {
        return {
          ok: true,
          record: toView(admission, null),
          phase: { projection: decision.projection, updatedAt: progress.updatedAt },
        };
      }
      return { ok: true, record: toView(admission, located.claim), phase: null };
    }
  }
  if (located.claim !== null) return { ok: true, record: toView(admission, located.claim), phase: null };
  if (admission.admissionState !== 'ADMISSION_HELD') {
    return { ok: true, record: toView(admission, null), phase: null };
  }
  const nowIso = clock.nowIso();
  if (!ISO.test(nowIso)) return { ok: false, kind: 'clock_invalid', message: 'The operator clock is not an ISO timestamp.' };
  const heldPhase = projectUnclaimedHeldPhase(admission.receivedAt, Date.parse(nowIso));
  if (heldPhase.kind === 'operator_expired') {
    io.noteExpiry(serverRunId, heldPhase.updatedAt);
    return {
      ok: true,
      record: toView(admission, null),
      phase: { projection: heldPhase.projection, updatedAt: heldPhase.updatedAt },
    };
  }
  if (heldPhase.kind === 'awaiting_operator') {
    return {
      ok: true,
      record: toView(admission, null),
      phase: { projection: heldPhase.projection, updatedAt: heldPhase.updatedAt },
    };
  }
  return { ok: true, record: toView(admission, null), phase: null };
}

function expiredRefusal(admission: StoredAdmission): ClaimResult {
  return fail(
    'AWAITING_OPERATOR_EXPIRED',
    'The held phase expired before the operator claim. The record was not claimed and nothing was dispatched.',
    toView(admission, null),
  );
}

function isExpiryProjection(projection: WonderlandStatusProjection): boolean {
  return projection.state === 'failed' && projection.cause === 'AWAITING_OPERATOR_EXPIRED';
}

function sealedExpiry(storePath: string, memory: OperatorDocument, serverRunId: string): StoredProgress | null {
  return awaitingOperatorExpiryNote(memory.progress, serverRunId)
    ?? awaitingOperatorExpiryNote(readAdmissionDocument(storePath).progress, serverRunId);
}

/** Journal note first. A throw here means the child must not be spawned. */
function guardedDispatchArgs(input: {
  readonly repo: string;
  readonly mission: string;
  readonly lane: string;
  readonly dispatchKey: string;
  readonly serverRunId: string;
  readonly confirmLive: boolean;
  readonly acknowledgeRerun?: boolean;
  readonly progress: readonly StoredProgress[];
  readonly storePath: string;
}): readonly string[] | null {
  try {
    return workflowDispatchArgs(input);
  } catch (error) {
    if (error instanceof Error && error.message === 'AWAITING_OPERATOR_EXPIRED') return null;
    throw error;
  }
}

function claimWasRecorded(storePath: string, reserved: ClaimEvent): boolean {
  return readAdmissionDocument(storePath).claims.some((event) =>
    event.wonderlandRunId === reserved.wonderlandRunId
    && event.serverRunId === reserved.serverRunId
    && event.state === reserved.state
    && event.at === reserved.at
    && event.dispatchAttempted === reserved.dispatchAttempted
    && (event.acknowledgedRerun === true) === (reserved.acknowledgedRerun === true)
    && event.priorAttempted === reserved.priorAttempted
    && event.priorCompleted === reserved.priorCompleted);
}

function replay(record: OperatorView): ClaimResult {
  return {
    ok: true,
    claimed: false,
    replayed: true,
    record,
    command: null,
    dispatchedWorkflow: false,
    requiredInput: null,
  };
}

function isLegacyAdmission(admission: { readonly runId: string; readonly serverRunId: string }): boolean {
  const identity = identifyAdmissionRun(admission.runId, admission.serverRunId);
  return identity.ok && identity.form === 'legacy';
}

function pairShape(wonderlandRunId: string, serverRunId: string): { kind: string; message: string } | null {
  const wonderland = parseJuliusAdmissionRunId(wonderlandRunId);
  const server = parseJuliusAdmissionRunId(serverRunId);
  if (!wonderland.ok || !server.ok) {
    return { kind: 'run_id_invalid', message: 'The run id pair is not well formed.' };
  }
  if (wonderland.form !== 'wlj') {
    return { kind: 'admission_run_id_ambiguous', message: 'The run id pair is ambiguous.' };
  }
  if (server.form === 'wlj' && server.runId !== wonderland.runId) {
    return null;
  }
  if (server.form === 'legacy' || server.runId === wonderland.runId) return null;
  return { kind: 'admission_run_id_ambiguous', message: 'The run id pair is ambiguous.' };
}

function validateShape(input: ClaimInput): ClaimResult | null {
  const shape = pairShape(input.wonderlandRunId, input.serverRunId);
  if (shape !== null) return fail(shape.kind, shape.message, null);
  if (!isRepo(input.repo)) return fail('repo_invalid', 'The GitHub repo must be owner/name.', null);
  if (!OPERATOR_LANES.includes(input.lane as OperatorLane)) {
    return fail('lane_invalid', 'The lane must be qualification, qualification-repair, lab, or regression.', null);
  }
  return null;
}

type Location =
  | { kind: 'match'; admission: StoredAdmission | null; claim: ClaimEvent | null }
  | { kind: 'server_run_mismatch' }
  | { kind: 'wonderland_run_mismatch' }
  | { kind: 'not_found' };

function locate(document: OperatorDocument, wonderlandRunId: string, serverRunId: string): Location {
  const admission = document.admissions.find((row) => row.runId === wonderlandRunId && row.serverRunId === serverRunId) ?? null;
  const claim = latestClaim(document, wonderlandRunId, serverRunId);
  if (admission !== null || claim !== null) return { kind: 'match', admission, claim };
  if (document.admissions.some((row) => row.runId === wonderlandRunId)) return { kind: 'server_run_mismatch' };
  if (document.admissions.some((row) => row.serverRunId === serverRunId)) return { kind: 'wonderland_run_mismatch' };
  return { kind: 'not_found' };
}

function latestClaim(document: OperatorDocument, wonderlandRunId: string, serverRunId: string): ClaimEvent | null {
  let found: ClaimEvent | null = null;
  for (const event of document.claims) {
    if (event.wonderlandRunId === wonderlandRunId && event.serverRunId === serverRunId) found = event;
  }
  return found;
}

function appendClaim(document: OperatorDocument, event: ClaimEvent): OperatorDocument {
  const prior = latestClaim(document, event.wonderlandRunId, event.serverRunId);
  if (!legalTransition(prior, event)) throw new Error('operator_claim_not_reversible');
  return {
    version: 1,
    revision: document.revision + 1,
    admissions: document.admissions,
    claims: [...document.claims, event],
    progress: document.progress ?? [],
  };
}

/**
 * admitted -> dispatching (tag read absent) -> dispatched | dispatch_failed | already_spent,
 * or admitted -> already_spent (tag read present). `dispatched` always carries
 * dispatchAttempted: it is written only after the spawned child returned.
 */
/**
 * The rerun fields travel together: none at all, or `acknowledgedRerun: true`
 * with both counts whole and at least one above 0 (consent is only ever
 * recorded over a proven prior run).
 */
function validRerunFields(event: ClaimEvent): boolean {
  const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (event.acknowledgedRerun !== true) return event.priorAttempted === undefined && event.priorCompleted === undefined;
  return whole(event.priorAttempted) && whole(event.priorCompleted) && event.priorAttempted + event.priorCompleted >= 1;
}

export function legalTransition(prior: ClaimEvent | null, event: ClaimEvent): boolean {
  if (event.state === 'already_spent') {
    if (event.halt !== 'RUN_ID_ALREADY_SPENT' || event.dispatchError !== null || event.spentTagState !== 'present') {
      return false;
    }
  } else if (event.halt === 'RUN_ID_ALREADY_SPENT') {
    return false;
  }
  if ((event.state === 'dispatched' || event.state === 'dispatching') && (event.halt !== null || event.dispatchError !== null)) return false;
  if (event.halt === 'SPENT_TAG_UNVERIFIED' && event.state !== 'dispatch_failed') return false;
  if (!validRerunFields(event)) return false;
  if (prior === null) {
    if (event.state === 'dispatching') return !event.dispatchAttempted && event.spentTagState === 'absent';
    if (event.state === 'already_spent') return !event.dispatchAttempted;
    return false;
  }
  if (prior.state !== 'dispatching') return false;
  if (!event.dispatchAttempted) return false;
  // The rerun consent is the reservation's: an outcome can neither add it, drop it, nor change its count.
  if ((event.acknowledgedRerun === true) !== (prior.acknowledgedRerun === true)
    || event.priorAttempted !== prior.priorAttempted || event.priorCompleted !== prior.priorCompleted) return false;
  // The outcome keeps the reservation's GitHub clock: it is the dispatch's, not the outcome write's.
  if (event.githubDate !== prior.githubDate) return false;
  if (event.state === 'already_spent') return true;
  if (event.state === 'dispatch_failed') {
    if (event.halt === 'SPENT_TAG_UNVERIFIED') return event.dispatchError === 'SPENT_TAG_UNVERIFIED';
    return event.halt === null
      && (event.dispatchError === 'gh_workflow_run_failed' || event.dispatchError === 'workflow_run_unspent');
  }
  return event.state === 'dispatched';
}

function baseEvent(admission: StoredAdmission, at: string, fields: {
  readonly state: ClaimEvent['state'];
  readonly spentTagState: ClaimEvent['spentTagState'];
  readonly dispatchAttempted: boolean;
  readonly dispatchError: ClaimEvent['dispatchError'];
  readonly halt: ClaimEvent['halt'];
  readonly workflowRunId?: string | null;
  readonly githubDate: string | null;
  readonly rerun?: RerunFields;
}): ClaimEvent {
  return {
    wonderlandRunId: admission.runId,
    serverRunId: admission.serverRunId,
    spentTag: spentTagName(admission.serverRunId),
    at,
    state: fields.state,
    spentTagState: fields.spentTagState,
    dispatchAttempted: fields.dispatchAttempted,
    dispatchError: fields.dispatchError,
    halt: fields.halt,
    workflowRunId: fields.workflowRunId ?? null,
    githubDate: fields.githubDate,
    ...rerunFields(fields.rerun?.acknowledgedRerun === true, fields.rerun?.priorAttempted, fields.rerun?.priorCompleted),
  };
}

function viewFromClaim(claim: ClaimEvent): OperatorView {
  return {
    wonderlandRunId: claim.wonderlandRunId,
    serverRunId: claim.serverRunId,
    state: claim.state,
    missionId: null,
    dispatchKey: '',
    spentTag: claim.spentTag,
    spentTagState: claim.spentTagState,
    dispatchAttempted: claim.dispatchAttempted,
    dispatchError: claim.dispatchError,
    halt: claim.halt,
    concurrencyGroup: concurrencyGroupName(claim.serverRunId),
    claimedAt: claim.at,
    workflowRunId: claim.workflowRunId,
  };
}

function toView(admission: StoredAdmission, claim: ClaimEvent | null): OperatorView {
  const state: OperatorViewState = claim !== null
    ? claim.state
    : admission.admissionState === 'ADMISSION_HELD'
      ? 'admitted'
      : admission.admissionState;
  return {
    wonderlandRunId: admission.runId,
    serverRunId: admission.serverRunId,
    state,
    missionId: admission.missionId,
    dispatchKey: admission.keyHash,
    spentTag: claim?.spentTag ?? spentTagName(admission.serverRunId),
    spentTagState: claim?.spentTagState ?? 'unknown',
    dispatchAttempted: claim?.dispatchAttempted ?? false,
    dispatchError: claim?.dispatchError ?? null,
    halt: claim?.halt ?? null,
    concurrencyGroup: concurrencyGroupName(admission.serverRunId),
    claimedAt: claim?.at ?? null,
    workflowRunId: claim?.workflowRunId ?? null,
  };
}

function fail(kind: string, message: string, record: OperatorView | null, requiredInput: string | null = null): ClaimResult {
  return { ok: false, kind, message, record, command: null, requiredInput };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quoteArg(arg: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(arg)) return arg;
  return `'${arg.replaceAll('\'', '\'\\\'\'')}'`;
}

function leadingSpaces(line: string): number | null {
  if (line.includes('\t')) return null;
  const match = /^ */.exec(line);
  return match === null ? 0 : match[0].length;
}

function isRepo(repo: string): boolean {
  const match = REPO.exec(repo);
  if (match === null) return false;
  const [owner, name] = repo.split('/');
  return owner !== '.' && owner !== '..' && name !== '.' && name !== '..';
}
