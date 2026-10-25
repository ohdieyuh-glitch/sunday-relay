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
 * A claim runs only when the checked-out workflow declares
 * `workflow_dispatch.inputs.run_id` (PR #459's input) and every other input
 * the argv passes. The value passed as `run_id` is the client's `wlj_` id.
 * The spent lock is `julius-run-spent-` plus 32 hex. A legacy `run:` row
 * keeps the 24-hex lock and is not claimed. This module does not edit the
 * workflow.
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
 * What the refusal prints when the checked-out workflow lacks `run_id`. The
 * input is PR #459's; this tool does not write the workflow. The git tag and
 * the concurrency group use the UUID with the dashes removed: 32 hex,
 * `julius-run-spent-<32hex>` and `julius-paid-<32hex>`. A legacy `run:` row
 * keeps `julius-run-spent-<24hex>` and is not claimed from here. A
 * re-dispatch halts with `RUN_ID_ALREADY_SPENT`. A spent tag the workflow
 * cannot verify halts with `SPENT_TAG_UNVERIFIED`.
 */
export const WORKFLOW_RUN_ID_INPUT_YAML = [
  '# workflow_dispatch.inputs of julius-first-live-mission.yml must declare (PR #459):',
  '      run_id:',
  `        description: 'Canonical Julius run id matching ${WLJ_RUN_ID_PATTERN}. A paid dispatch creates julius-run-spent-<32hex> and concurrency group julius-paid-<32hex>. A legacy run keeps julius-run-spent-<24hex> and is not claimed. A re-dispatch halts with RUN_ID_ALREADY_SPENT. A spent tag that cannot be verified halts with SPENT_TAG_UNVERIFIED.'`,
  '        required: false',
  "        default: ''",
].join('\n');

export const OPERATOR_DISPATCH_CONFIRMATION = 'RUN LIVE MISSION';

export const OPERATOR_LANES = ['qualification', 'qualification-repair', 'lab', 'regression'] as const;
export type OperatorLane = (typeof OPERATOR_LANES)[number];

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
  readonly workflowSource: string;
  readonly dispatch: boolean;
  readonly confirmation: string | null;
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
  };

export type StatusResult =
  | { readonly ok: true; readonly record: OperatorView; readonly phase: OperatorStatusPhase | null }
  | { readonly ok: false; readonly kind: string; readonly message: string };

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
}

export function createOperatorClaimTool(
  file: AdmissionFile,
  spawn: GhSpawner,
  clock: OperatorClaimClock = { nowIso: () => new Date().toISOString() },
): OperatorClaimTool {
  // Claims from one tool run one after another, so a second claim in this
  // process sees the first one's reservation before it reads the spent tag.
  let claims: Promise<unknown> = Promise.resolve();
  return {
    claim(input) {
      const next = (): Promise<ClaimResult> => claimPhased(file, input, spawn, clock);
      const run = claims.then(next, next);
      claims = run.then(() => undefined, () => undefined);
      return run;
    },
    status(wonderlandRunId, serverRunId) {
      return file.exclusive((io) => Promise.resolve(statusInside(io, file.path, wonderlandRunId, serverRunId, clock)));
    },
  };
}

export function openOperatorClaimTool(
  storePath: string,
  spawn: GhSpawner,
  clock?: OperatorClaimClock,
): OperatorClaimTool {
  const file = openAdmissionFile(storePath);
  return clock === undefined ? createOperatorClaimTool(file, spawn) : createOperatorClaimTool(file, spawn, clock);
}

/**
 * Each write lock is held for one read-check-write only, never across a `gh`
 * child: (1) check, (2) read the spent tag without the lock, (3) re-check and
 * write `dispatching` or `already_spent`, (4) spawn the workflow without the
 * lock, (5) write the outcome. A stop between (3) and (5) leaves
 * `dispatching`: whether the workflow started is unknown, and it is never
 * reported as `dispatched` or retried.
 */
async function claimPhased(
  file: AdmissionFile,
  input: ClaimInput,
  spawn: GhSpawner,
  clock: OperatorClaimClock,
): Promise<ClaimResult> {
  const checked = await file.exclusive((io) => Promise.resolve(checkClaim(io, file.path, input, clock)));
  if (checked.kind === 'done') return checked.result;
  const tag = interpretSpentTagResponse(spawn.run(spentTagApiArgs(input.repo, checked.admission.serverRunId)));
  if (tag === 'unreadable') {
    return fail(
      'spent_tag_unreadable',
      'The spent tag could not be read. The record was not claimed and nothing was dispatched.',
      toView(checked.admission, null),
    );
  }
  const reserved = await file.exclusive((io) => Promise.resolve(reserveClaim(io, file.path, input, clock, tag)));
  if (reserved.kind === 'done') return reserved.result;
  const ran = spawn.run(reserved.liveArgs);
  return file.exclusive((io) => Promise.resolve(recordDispatchOutcome(io, input, reserved, ran)));
}

type Checked =
  | { readonly kind: 'done'; readonly result: ClaimResult }
  | { readonly kind: 'plan'; readonly admission: StoredAdmission; readonly nowIso: string; readonly command: string };

interface Reservation {
  readonly kind: 'reserved';
  readonly admission: StoredAdmission;
  readonly at: string;
  readonly liveArgs: readonly string[];
  readonly command: string;
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
  if (!workflowDeclaresRunIdInput(input.workflowSource)) {
    return done(fail(
      'workflow_run_id_input_missing',
      'The paid workflow does not declare workflow_dispatch input run_id. Nothing was claimed or dispatched.',
      toView(admission, null),
      WORKFLOW_RUN_ID_INPUT_YAML,
    ));
  }
  const undeclared = undeclaredDispatchInputs(input.workflowSource);
  if (undeclared.length > 0) {
    return done(fail(
      'workflow_dispatch_input_missing',
      `The paid workflow does not declare workflow_dispatch input ${undeclared.join(', ')}. Nothing was claimed or dispatched.`,
      toView(admission, null),
    ));
  }
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
): Reserved {
  // The record may have moved while the spent tag was read: check again.
  const checked = checkClaim(io, storePath, input, clock);
  if (checked.kind === 'done') return checked;
  const { admission, nowIso, command } = checked;
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
    progress: io.read().progress,
    storePath,
  });
  if (liveArgs === null) return { kind: 'done', result: expiredRefusal(admission) };
  return { kind: 'reserved', admission, at: nowIso, liveArgs, command };
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
  const { admission, at, command } = reserved;
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
    && event.dispatchAttempted === reserved.dispatchAttempted);
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
function legalTransition(prior: ClaimEvent | null, event: ClaimEvent): boolean {
  if (event.state === 'already_spent') {
    if (event.halt !== 'RUN_ID_ALREADY_SPENT' || event.dispatchError !== null || event.spentTagState !== 'present') {
      return false;
    }
  } else if (event.halt === 'RUN_ID_ALREADY_SPENT') {
    return false;
  }
  if ((event.state === 'dispatched' || event.state === 'dispatching') && (event.halt !== null || event.dispatchError !== null)) return false;
  if (event.halt === 'SPENT_TAG_UNVERIFIED' && event.state !== 'dispatch_failed') return false;
  if (prior === null) {
    if (event.state === 'dispatching') return !event.dispatchAttempted && event.spentTagState === 'absent';
    if (event.state === 'already_spent') return !event.dispatchAttempted;
    return false;
  }
  if (prior.state !== 'dispatching') return false;
  if (!event.dispatchAttempted) return false;
  if (event.state === 'already_spent') return true;
  if (event.state === 'dispatch_failed') {
    if (event.halt === 'SPENT_TAG_UNVERIFIED') return event.dispatchError === 'SPENT_TAG_UNVERIFIED';
    return event.halt === null && event.dispatchError === 'gh_workflow_run_failed';
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
