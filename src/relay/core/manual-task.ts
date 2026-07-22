import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { validate } from '../protocol/validate';
import {
  checkManualActionRequest,
  type ManualActionRequest, type ManualTask, type RelayRun, type RelayTask,
} from '../protocol/contracts';
import type { IdFactory } from '../protocol/ids';
import type { ManualTaskCategory, ManualTaskStatus } from '../protocol/enums';
import { ACTIVE_MANUAL_TASK_STATUSES } from '../protocol/enums';

/**
 * Manual Task compiler (Prompt 6.1) — Relay Core ONLY. Turns an untrusted
 * ManualActionRequest into the one canonical, user-facing ManualTask, or
 * rejects it. Every rule here is deterministic and explainable (no reading-
 * level model): association, safety policy, secret/trace shapes, and the
 * extreme-simplicity constraints. A rejected request is never shown to the
 * user — only its safe rejection reasons are recorded.
 */

/* -------------------- deterministic policy tables ------------------ */

/** Verification methods Relay actually knows how to run in this profile. */
export const KNOWN_MANUAL_VERIFICATIONS = ['simulated-setting-check'] as const;

/** Categories whose steps involve credentials — a security notice is
 * mandatory and compiled by Relay, never by the requester. */
const CREDENTIAL_CATEGORIES: ManualTaskCategory[] = ['sign_in', 'provide_credential'];

/** Categories allowed to carry requestedPermissions entries. */
const PERMISSION_CATEGORIES: ManualTaskCategory[] = ['approve_permission', 'operating_system_permission'];

const SECURITY_NOTICE =
  'Never type secret values into Relay. Use only the secure field named in the steps.';

/** Unexplained jargon banned from user-facing text (spec list). */
const PROHIBITED_JARGON = [
  'prerequisite', 'orchestration', 'infrastructure', 'credential propagation',
  'environment mutation', 'authorization boundary', 'remediation', 'configuration artifact',
];

/** Requests that ask the user to weaken required protection are unsafe. */
const SAFETY_BYPASS_PATTERNS: RegExp[] = [
  /\bdisabl\w*\b[^.]*\b(security|protection|safety|verification|validation|checks?)\b/i,
  /\bturn off\b[^.]*\b(security|protection|safety|verification|validation|checks?)\b/i,
  /\bbypass\w*\b/i,
  /\bskip\b[^.]*\bverification\b/i,
];

/** Destructive shell/data actions the user must never be walked through. */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\bdrop\s+table\b/i,
  /\bforce[- ]push\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bdelete\s+the\s+repository\b/i,
];

/** Instructions to put a credential into Relay itself are always unsafe. */
const CREDENTIAL_INTO_RELAY = /\b(key|secret|password|credential|token)\b[^.]*\b(into|in)\b[^.]*\brelay\b/i;

/** Secret-shaped strings (superset of the YC verifier's patterns). */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{8,}/,
  /AKIA[0-9A-Z]{12,}/,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/,
  /\b(?:api[-_]?key|secret|password|token)\s*[:=]\s*\S{8,}/i,
];

/** Raw stack traces never reach the user. */
const STACK_TRACE_PATTERNS: RegExp[] = [
  /\bat\s+\S+\s+\(.+:\d+:\d+\)/,
  /^\s*at\s+.+:\d+:\d+\s*$/m,
  /Traceback \(most recent call last\)/,
];

/** Internal correlation ids (protocol prefixes) stay out of user text. */
const INTERNAL_ID_PATTERN =
  /(?:^|[^A-Za-z0-9])(prj|run|tsk|pkg|evt|evd|bnd|rpt|blu|vrf|ckp|mtk|mrq|clm|asn|ses|aud|pol)_[A-Za-z0-9_-]{4,}/;

/* ------------------- simplicity constraints (spec) ------------------ */

const TITLE_MAX_WORDS = 7;
const TITLE_MAX_CHARS = 60;
const WHY_MAX_SENTENCES = 2;
const WHY_MAX_CHARS = 240;
const STEPS_MIN = 3;
const STEPS_MAX = 6;
const STEP_MAX_CHARS = 90;
const EXPECTED_RESULT_MAX_CHARS = 160;

const countSentences = (text: string): number =>
  text.split(/[.!?]+/).filter((part) => /[A-Za-z0-9]/.test(part)).length;

export const looksLikeSecret = (text: string): boolean =>
  SECRET_PATTERNS.some((pattern) => pattern.test(text));

export const looksLikeStackTrace = (text: string): boolean =>
  STACK_TRACE_PATTERNS.some((pattern) => pattern.test(text));

/** Deterministic user-facing-text validation. Narrow on purpose: length,
 * sentence, and denylist rules only — never punctuation nitpicks. */
export function validateManualTaskText(input: {
  title: string;
  whyRelayStopped: string;
  steps: string[];
  expectedResult: string;
}): string[] {
  const errors: string[] = [];
  const { title, whyRelayStopped, steps, expectedResult } = input;

  if (title.length > TITLE_MAX_CHARS) errors.push(`title must be ≤ ${TITLE_MAX_CHARS} chars.`);
  if (title.trim().split(/\s+/).length > TITLE_MAX_WORDS) {
    errors.push(`title must be ${TITLE_MAX_WORDS} words or fewer.`);
  }
  if (whyRelayStopped.length > WHY_MAX_CHARS) errors.push(`why must be ≤ ${WHY_MAX_CHARS} chars.`);
  if (countSentences(whyRelayStopped) > WHY_MAX_SENTENCES) {
    errors.push(`why must be one or two short sentences.`);
  }
  if (steps.length < STEPS_MIN || steps.length > STEPS_MAX) {
    errors.push(`steps must contain ${STEPS_MIN} to ${STEPS_MAX} entries.`);
  }
  steps.forEach((step, i) => {
    if (step.trim() === '') errors.push(`step ${i + 1} must not be empty.`);
    if (step.length > STEP_MAX_CHARS) errors.push(`step ${i + 1} must be ≤ ${STEP_MAX_CHARS} chars.`);
    if (countSentences(step) > 1) errors.push(`step ${i + 1} must be one short action sentence.`);
  });
  if (expectedResult.length > EXPECTED_RESULT_MAX_CHARS) {
    errors.push(`expected result must be ≤ ${EXPECTED_RESULT_MAX_CHARS} chars.`);
  }

  const userFacing = [title, whyRelayStopped, ...steps, expectedResult];
  for (const text of userFacing) {
    for (const term of PROHIBITED_JARGON) {
      if (text.toLowerCase().includes(term)) errors.push(`"${term}" is unexplained jargon.`);
    }
    if (looksLikeSecret(text)) errors.push('text contains a secret-shaped value.');
    if (looksLikeStackTrace(text)) errors.push('text contains a raw stack trace.');
    if (INTERNAL_ID_PATTERN.test(text)) errors.push('text contains an internal id.');
  }
  return errors;
}

/* ------------------------- help templates -------------------------- */

const HELP_BY_CATEGORY: Partial<Record<ManualTaskCategory, string[]>> = {
  protected_resource: [
    'A protected setting is one Relay is not allowed to change on its own.',
    'Open the application named above and follow each step in order.',
    'If a step does not match what you see, stop at that step.',
    'If you are stuck, choose "I cannot do this" — the work stays safely stopped.',
  ],
  sign_in: [
    'Relay cannot sign in for you, so it stopped and is waiting.',
    'Open the application named above and sign in the way you normally do.',
    'If you are stuck, choose "I cannot do this" — the work stays safely stopped.',
  ],
};

const HELP_DEFAULT = [
  'Relay stopped because this action needs a person.',
  'Follow the steps above one at a time, in order.',
  'If you are stuck, choose "I cannot do this" — the work stays safely stopped.',
];

/* --------------------------- compilation ---------------------------- */

export interface CompileManualTaskInput {
  request: unknown;
  run: RelayRun;
  task: RelayTask;
  /** The adapter currently assigned to the task — the only allowed requester. */
  expectedRequestedBy: string;
  ids: IdFactory;
  now: string;
}

const isActive = (status: ManualTaskStatus): boolean =>
  (ACTIVE_MANUAL_TASK_STATUSES as readonly string[]).includes(status);

const rejected = (reasons: string[]): RelayResult<never> =>
  fail(
    relayError('validation-failed', 'Manual action request rejected.', {
      details: reasons,
    }),
  );

/**
 * Validate an untrusted ManualActionRequest and compile the canonical
 * ManualTask (without its checkpointId — the run machine mints and binds
 * that atomically when it raises the checkpoint). An equivalent request
 * while the same task is still active is returned idempotently; a different
 * one is rejected (one active Manual Task per run — deterministic policy).
 */
export function compileManualTask(
  input: CompileManualTaskInput,
): RelayResult<{ manualTask: Omit<ManualTask, 'checkpointId'>; idempotent: boolean }> {
  const { run, task, expectedRequestedBy, ids, now } = input;

  const parsed = validate<ManualActionRequest>(
    input.request, checkManualActionRequest, 'manual-action-request',
  );
  if (!parsed.ok) return parsed;
  const request = parsed.value;

  /* association + run state */
  const reasons: string[] = [];
  if (request.projectId !== run.projectId) reasons.push('request project does not match the run.');
  if (request.runId !== run.runId) reasons.push('request run does not match the current run.');
  if (request.relayTaskId !== task.taskId) reasons.push('request task does not match the current task.');
  if (request.requestedBy !== expectedRequestedBy) {
    reasons.push('requester is not the adapter assigned to this task.');
  }
  if (run.status !== 'active') reasons.push('run is not in a state that accepts manual requests.');
  if (reasons.length > 0) return rejected(reasons);

  /* one active manual task per run; equivalent requests merge */
  const existing = run.checkpoint?.manualTask;
  if (existing && isActive(existing.status)) {
    const equivalent =
      existing.category === request.category &&
      existing.title === request.requestedAction &&
      existing.applicationOrLocation === request.applicationOrLocation;
    if (equivalent) {
      const { checkpointId: _bound, ...rest } = existing;
      return ok({ manualTask: rest, idempotent: true });
    }
    return rejected(['an equivalent manual task is not pending and only one active manual task is allowed per run.']);
  }

  /* safety policy — every rule explicit and deterministic */
  const requestText = [
    request.reason, request.requestedAction, request.applicationOrLocation,
    ...request.proposedSteps, request.expectedResult, ...request.requestedPermissions,
  ];
  for (const text of requestText) {
    if (SAFETY_BYPASS_PATTERNS.some((p) => p.test(text))) {
      reasons.push('request asks the user to weaken required protection.');
      break;
    }
  }
  for (const text of requestText) {
    if (DESTRUCTIVE_PATTERNS.some((p) => p.test(text))) {
      reasons.push('request walks the user through an unsupported destructive action.');
      break;
    }
  }
  for (const text of requestText) {
    if (CREDENTIAL_INTO_RELAY.test(text)) {
      reasons.push('request asks for a credential inside Relay instead of a secure field.');
      break;
    }
  }
  if (request.requestedPermissions.length > 0 && !PERMISSION_CATEGORIES.includes(request.category)) {
    reasons.push('requested permissions are not truthful for this category.');
  }
  if (request.verificationMethod !== undefined &&
      !(KNOWN_MANUAL_VERIFICATIONS as readonly string[]).includes(request.verificationMethod)) {
    reasons.push('verification method is not one Relay knows how to run.');
  }
  if (reasons.length > 0) return rejected(reasons);

  /* extreme-simplicity validation of the would-be user-facing text */
  const textErrors = validateManualTaskText({
    title: request.requestedAction,
    whyRelayStopped: request.reason,
    steps: request.proposedSteps,
    expectedResult: request.expectedResult,
  });
  if (textErrors.length > 0) return rejected(textErrors);

  const verificationAvailable = request.verificationMethod !== undefined;
  const manualTask: Omit<ManualTask, 'checkpointId'> = {
    manualTaskId: ids.next('mtk'),
    projectId: run.projectId,
    runId: run.runId,
    relayTaskId: task.taskId,
    title: request.requestedAction,
    whyRelayStopped: request.reason,
    category: request.category,
    applicationOrLocation: request.applicationOrLocation,
    steps: [...request.proposedSteps],
    expectedResult: request.expectedResult,
    proofRequired: false,
    securityNotice: CREDENTIAL_CATEGORIES.includes(request.category) ? SECURITY_NOTICE : undefined,
    whatRelayWillDoNext: verificationAvailable
      ? 'When you choose Done, Relay will check the result and continue when it is safe.'
      : 'Relay cannot check this automatically. It will ask you to confirm what changed before continuing.',
    helpText: [...(HELP_BY_CATEGORY[request.category] ?? HELP_DEFAULT)],
    status: 'pending',
    requestedBy: request.requestedBy,
    validatedByRelay: true,
    verificationAvailable,
    canResumeAfterCompletion: true,
    createdAt: now,
    updatedAt: now,
  };
  return ok({ manualTask, idempotent: false });
}
