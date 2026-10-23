/**
 * LOCAL OPERATOR CLAIM — founder-run, loopback-only, no credentials.
 *
 * Claims one admitted Wonderland pair (wlj_ run id + server run: id) in the
 * local admission file. admitted -> dispatched is a single exclusive write.
 * A second claim returns that record and does not dispatch again.
 *
 * The default is a dry-run: after the claim it prints the exact `gh workflow
 * run` command and spawns nothing. `--dispatch` plus the exact confirmation
 * `RUN LIVE MISSION` is the only path that spawns `gh`. That path first asks
 * `gh api` whether the spent tag exists. Present -> already_spent, and the
 * workflow is not started. A failed workflow spawn moves the record to
 * dispatch_failed. A visible workflow halt `RUN_ID_ALREADY_SPENT` is
 * already_spent, and `SPENT_TAG_UNVERIFIED` is dispatch_failed. Neither
 * state is ever written back to admitted, and nothing here retries.
 *
 * `--dispatch` runs only when the checked-out workflow declares
 * `workflow_dispatch.inputs.server_run_id`. The value passed is the full
 * `run:` id. YUJI adds that input through the governed installer. This
 * module does not edit the workflow.
 */

import {
  JULIUS_BOOTSTRAP_RUN_ID,
  MISSION_SLUG,
  PAID_SLOT_DISPATCH_KEY,
  PAID_WORKFLOW_FILE,
  WONDERLAND_RUN_ID,
} from './admission-contract';
import type {
  AdmissionFile,
  AdmissionFileIo,
  ClaimEvent,
  DispatchError,
  OperatorDocument,
  StoredAdmission,
  WorkflowHalt,
} from './admission-file';
import { openAdmissionFile } from './admission-file';

/** The workflow input the paid run must gain before this tool will dispatch. */
export const SERVER_RUN_ID_INPUT = 'server_run_id';

/**
 * Paste under `workflow_dispatch.inputs` in julius-first-live-mission.yml.
 * The value this tool passes is the full server run id, matching
 * `^run:[0-9a-f]{24}$`. The git tag and the concurrency group cannot contain
 * `:`, so both use the 24 hex only: `julius-run-spent-<24hex>` and
 * `julius-paid-<24hex>`. YUJI owns the workflow. A re-dispatch halts with
 * `RUN_ID_ALREADY_SPENT`. A spent tag the workflow cannot verify halts with
 * `SPENT_TAG_UNVERIFIED`.
 */
export const SERVER_RUN_ID_INPUT_YAML = [
  '      server_run_id:',
  '        description: \'Full Julius bootstrap run id matching ^run:[0-9a-f]{24}$. Before any paid call, create git tag julius-run-spent-<24hex> and concurrency group julius-paid-<24hex>. A re-dispatch halts with RUN_ID_ALREADY_SPENT. A spent tag that cannot be verified halts with SPENT_TAG_UNVERIFIED.\'',
  '        required: false',
  '        default: \'\'',
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
}

export interface ClaimInput {
  readonly wonderlandRunId: string;
  readonly serverRunId: string;
  readonly repo: string;
  readonly lane: string;
  readonly workflowSource: string;
  readonly dispatch: boolean;
  readonly confirmation: string | null;
  readonly nowIso: string;
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
  | { readonly ok: true; readonly record: OperatorView }
  | { readonly ok: false; readonly kind: string; readonly message: string };

/** 24 lowercase hex from a full `run:` id. Checked before any command is built. */
export function serverRunHex(serverRunId: string): string {
  if (!JULIUS_BOOTSTRAP_RUN_ID.test(serverRunId)) throw new Error('run_id_invalid');
  return serverRunId.slice(4);
}

export function spentTagName(serverRunId: string): string {
  return `julius-run-spent-${serverRunHex(serverRunId)}`;
}

export function concurrencyGroupName(serverRunId: string): string {
  return `julius-paid-${serverRunHex(serverRunId)}`;
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
}): readonly string[] {
  if (!JULIUS_BOOTSTRAP_RUN_ID.test(input.serverRunId)) throw new Error('run_id_invalid');
  return [
    'workflow', 'run', PAID_WORKFLOW_FILE,
    '--repo', input.repo,
    '--ref', 'main',
    '-f', `mission=${input.mission}`,
    '-f', `lane=${input.lane}`,
    '-f', `dispatch_key=${input.dispatchKey}`,
    '-f', `confirm_live=${OPERATOR_DISPATCH_CONFIRMATION}`,
    '-f', `${SERVER_RUN_ID_INPUT}=${input.serverRunId}`,
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

export function workflowDeclaresServerRunId(source: string): boolean {
  return workflowDispatchInputNames(source).includes(SERVER_RUN_ID_INPUT);
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

export function createOperatorClaimTool(file: AdmissionFile, spawn: GhSpawner): OperatorClaimTool {
  return {
    claim(input) {
      return file.exclusive((io) => Promise.resolve(claimInside(io, input, spawn)));
    },
    status(wonderlandRunId, serverRunId) {
      return file.exclusive((io) => Promise.resolve(statusInside(io, wonderlandRunId, serverRunId)));
    },
  };
}

export function openOperatorClaimTool(storePath: string, spawn: GhSpawner): OperatorClaimTool {
  return createOperatorClaimTool(openAdmissionFile(storePath), spawn);
}

function claimInside(io: AdmissionFileIo, input: ClaimInput, spawn: GhSpawner): ClaimResult {
  const shape = validateShape(input);
  if (shape !== null) return shape;
  const document = io.read();
  const located = locate(document, input.wonderlandRunId, input.serverRunId);
  if (located.kind === 'not_found') return fail('admission_not_found', 'No admitted record matches that pair.', null);
  if (located.kind === 'server_run_mismatch') {
    return fail('server_run_mismatch', 'The server run id does not match the admitted record.', null);
  }
  if (located.kind === 'wonderland_run_mismatch') {
    return fail('wonderland_run_mismatch', 'The wlj_ run id does not match the admitted record.', null);
  }
  if (located.admission === null) {
    if (located.claim === null) return fail('admission_not_found', 'No admitted record matches that pair.', null);
    return replay(viewFromClaim(located.claim));
  }
  const admission = located.admission;
  if (located.claim !== null) return replay(toView(admission, located.claim));
  if (admission.admissionState !== 'ADMISSION_HELD') {
    return fail('not_admitted', `The record is ${admission.admissionState} and is not admitted.`, toView(admission, null));
  }
  if (admission.missionId === null || !MISSION_SLUG.test(admission.missionId)) {
    return fail('mission_unset', 'The admitted record has no mission slug.', toView(admission, null));
  }
  if (!PAID_SLOT_DISPATCH_KEY.test(admission.keyHash)) {
    return fail('dispatch_key_invalid', 'The admitted dispatch key cannot be passed to the paid workflow.', toView(admission, null));
  }
  if (!workflowDeclaresServerRunId(input.workflowSource)) {
    return fail(
      'workflow_server_run_id_undeclared',
      'The paid workflow does not declare input server_run_id. The record was not claimed.',
      toView(admission, null),
      SERVER_RUN_ID_INPUT_YAML,
    );
  }
  const command = formatGhCommand(workflowDispatchArgs({
    repo: input.repo,
    mission: admission.missionId,
    lane: input.lane,
    dispatchKey: admission.keyHash,
    serverRunId: admission.serverRunId,
  }));
  if (!input.dispatch) {
    const event = baseEvent(admission, input.nowIso, {
      state: 'dispatched',
      spentTagState: 'unknown',
      dispatchAttempted: false,
      dispatchError: null,
      halt: null,
    });
    io.write(appendClaim(document, event));
    return {
      ok: true,
      claimed: true,
      replayed: false,
      record: toView(admission, event),
      command,
      dispatchedWorkflow: false,
      requiredInput: null,
    };
  }
  if (input.confirmation !== OPERATOR_DISPATCH_CONFIRMATION) {
    return fail(
      'dispatch_confirmation_required',
      'Dispatch requires the exact confirmation RUN LIVE MISSION. The record was not claimed.',
      toView(admission, null),
    );
  }
  const tag = interpretSpentTagResponse(spawn.run(spentTagApiArgs(input.repo, admission.serverRunId)));
  if (tag === 'unreadable') {
    return fail(
      'spent_tag_unreadable',
      'The spent tag could not be read. The record was not claimed and nothing was dispatched.',
      toView(admission, null),
    );
  }
  if (tag === 'present') {
    const event = baseEvent(admission, input.nowIso, {
      state: 'already_spent',
      spentTagState: 'present',
      dispatchAttempted: false,
      dispatchError: null,
      halt: 'RUN_ID_ALREADY_SPENT',
    });
    io.write(appendClaim(document, event));
    return fail(
      'RUN_ID_ALREADY_SPENT',
      'The spent tag already exists. The record is already_spent. Nothing was dispatched.',
      toView(admission, event),
    );
  }
  const reserved = baseEvent(admission, input.nowIso, {
    state: 'dispatched',
    spentTagState: 'absent',
    dispatchAttempted: false,
    dispatchError: null,
    halt: null,
  });
  const claimedDoc = appendClaim(document, reserved);
  io.write(claimedDoc);
  const ran = spawn.run(workflowDispatchArgs({
    repo: input.repo,
    mission: admission.missionId,
    lane: input.lane,
    dispatchKey: admission.keyHash,
    serverRunId: admission.serverRunId,
  }));
  const halt = interpretWorkflowHalt(ran);
  if (halt === 'RUN_ID_ALREADY_SPENT') {
    const spent = baseEvent(admission, input.nowIso, {
      state: 'already_spent',
      spentTagState: 'present',
      dispatchAttempted: true,
      dispatchError: null,
      halt,
    });
    io.write(appendClaim(claimedDoc, spent));
    return fail(
      'RUN_ID_ALREADY_SPENT',
      'The workflow halted with RUN_ID_ALREADY_SPENT. The record is already_spent and will not be retried.',
      toView(admission, spent),
    );
  }
  if (halt === 'SPENT_TAG_UNVERIFIED' || ran.code !== 0) {
    const unverified = halt === 'SPENT_TAG_UNVERIFIED';
    const failed = baseEvent(admission, input.nowIso, {
      state: 'dispatch_failed',
      spentTagState: unverified ? 'unknown' : 'absent',
      dispatchAttempted: true,
      dispatchError: unverified ? 'SPENT_TAG_UNVERIFIED' : 'gh_workflow_run_failed',
      halt: unverified ? 'SPENT_TAG_UNVERIFIED' : null,
    });
    io.write(appendClaim(claimedDoc, failed));
    return fail(
      unverified ? 'SPENT_TAG_UNVERIFIED' : 'dispatch_failed',
      unverified
        ? 'The workflow halted with SPENT_TAG_UNVERIFIED. The record is dispatch_failed and will not be retried.'
        : 'The workflow dispatch failed. The record is dispatch_failed and will not be retried.',
      toView(admission, failed),
    );
  }
  const attempted = baseEvent(admission, input.nowIso, {
    state: 'dispatched',
    spentTagState: 'absent',
    dispatchAttempted: true,
    dispatchError: null,
    halt: null,
  });
  io.write(appendClaim(claimedDoc, attempted));
  return {
    ok: true,
    claimed: true,
    replayed: false,
    record: toView(admission, attempted),
    command,
    dispatchedWorkflow: true,
    requiredInput: null,
  };
}

function statusInside(io: AdmissionFileIo, wonderlandRunId: string, serverRunId: string): StatusResult {
  if (!WONDERLAND_RUN_ID.test(wonderlandRunId) || !JULIUS_BOOTSTRAP_RUN_ID.test(serverRunId)) {
    return { ok: false, kind: 'run_id_invalid', message: 'The run id pair is not well formed.' };
  }
  const located = locate(io.read(), wonderlandRunId, serverRunId);
  if (located.kind === 'not_found') return { ok: false, kind: 'admission_not_found', message: 'No admitted record matches that pair.' };
  if (located.kind === 'server_run_mismatch') {
    return { ok: false, kind: 'server_run_mismatch', message: 'The server run id does not match the admitted record.' };
  }
  if (located.kind === 'wonderland_run_mismatch') {
    return { ok: false, kind: 'wonderland_run_mismatch', message: 'The wlj_ run id does not match the admitted record.' };
  }
  if (located.admission === null) {
    if (located.claim === null) return { ok: false, kind: 'admission_not_found', message: 'No admitted record matches that pair.' };
    return { ok: true, record: viewFromClaim(located.claim) };
  }
  return { ok: true, record: toView(located.admission, located.claim) };
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

function validateShape(input: ClaimInput): ClaimResult | null {
  if (!WONDERLAND_RUN_ID.test(input.wonderlandRunId) || !JULIUS_BOOTSTRAP_RUN_ID.test(input.serverRunId)) {
    return fail('run_id_invalid', 'The run id pair is not well formed.', null);
  }
  if (!isRepo(input.repo)) return fail('repo_invalid', 'The GitHub repo must be owner/name.', null);
  if (!OPERATOR_LANES.includes(input.lane as OperatorLane)) {
    return fail('lane_invalid', 'The lane must be qualification, qualification-repair, lab, or regression.', null);
  }
  if (!ISO.test(input.nowIso)) return fail('clock_invalid', 'The operator clock is not an ISO timestamp.', null);
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
  };
}

function legalTransition(prior: ClaimEvent | null, event: ClaimEvent): boolean {
  if (event.state !== 'dispatched' && event.state !== 'dispatch_failed' && event.state !== 'already_spent') return false;
  if (event.state === 'already_spent') {
    if (event.halt !== 'RUN_ID_ALREADY_SPENT' || event.dispatchError !== null || event.spentTagState !== 'present') {
      return false;
    }
  } else if (event.halt === 'RUN_ID_ALREADY_SPENT') {
    return false;
  }
  if (event.state === 'dispatched' && (event.halt !== null || event.dispatchError !== null)) return false;
  if (event.halt === 'SPENT_TAG_UNVERIFIED' && event.state !== 'dispatch_failed') return false;
  if (prior === null) {
    if (event.state === 'dispatch_failed') return false;
    if (event.state === 'dispatched' && event.dispatchAttempted) return false;
    if (event.state === 'already_spent') return !event.dispatchAttempted;
    return event.state === 'dispatched';
  }
  if (prior.state !== 'dispatched' || prior.dispatchAttempted) return false;
  if (event.state === 'already_spent') return event.dispatchAttempted;
  if (event.state === 'dispatch_failed') {
    if (!event.dispatchAttempted) return false;
    if (event.halt === 'SPENT_TAG_UNVERIFIED') return event.dispatchError === 'SPENT_TAG_UNVERIFIED';
    return event.halt === null && event.dispatchError === 'gh_workflow_run_failed';
  }
  return event.state === 'dispatched' && event.dispatchAttempted;
}

function baseEvent(admission: StoredAdmission, at: string, fields: {
  readonly state: ClaimEvent['state'];
  readonly spentTagState: ClaimEvent['spentTagState'];
  readonly dispatchAttempted: boolean;
  readonly dispatchError: ClaimEvent['dispatchError'];
  readonly halt: ClaimEvent['halt'];
}): ClaimEvent {
  return {
    wonderlandRunId: admission.runId,
    serverRunId: admission.serverRunId,
    spentTag: spentTagName(admission.serverRunId),
    at,
    ...fields,
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
  };
}

function fail(kind: string, message: string, record: OperatorView | null, requiredInput: string | null = null): ClaimResult {
  return { ok: false, kind, message, record, command: null, requiredInput };
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
