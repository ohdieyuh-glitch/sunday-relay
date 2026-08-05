/**
 * SUNDAY RELAY — LOOP COMPOSER VIEW MODEL.
 *
 * The pure layer between the domain and the pixels. It consumes the SHARED
 * projection the CLI already renders (`projectLoopCommandPreview`) and adds
 * only what a graphical surface needs on top: which controls exist, which are
 * disabled, and how the four identity facts are grouped for reading.
 *
 * WHY A VIEW MODEL RATHER THAN LOGIC IN THE COMPONENT. A React component
 * cannot be asserted on without rendering it, and the things worth asserting
 * here are decisions — is Start disabled, is confirmation offered, does this
 * say a role is working. Keeping them in a pure function means the test that
 * proves "no control claims a running Loop" reads the decision directly.
 *
 * IT ADDS NO MEANING. Labels may be presentation-specific; target, objective,
 * action and validation MEANING comes from the domain and is never recomputed
 * here. The "CLI ↔ UI parity" suite in `loop-ui.test.tsx` proves the view and
 * the CLI agree, command by command.
 */

import {
  DEFAULT_LOOP_LIMITS,
  RELAY_LOOP_CANONICAL_ALIAS,
  commandRequestsExecution,
  evaluateLoopAvailability,
  parseSlashCommand,
  projectLoopCommandPreview,
  resolveLoopTarget,
  type RelayAgentRegistrySnapshot,
  type RelayAgentRole,
  type RelayLoopAvailability,
  type RelayLoopBlocker,
  type RelayLoopCommandPreview,
  type RelayLoopFeatureFlags,
  type RelayLoopLimits,
  type RelayLoopTarget,
  type RelayParsedSlashCommand,
} from '../../mission';
import {
  deriveLoopPresentationStatus,
  type RelayLoopPresentationStatus,
} from './loop-status';

/* ------------------------------------------------------------- controls */

/**
 * Every control the Composer may offer at this stage.
 *
 * `start_loop` is declared but is ALWAYS disabled: Stage 2's runtime does not
 * exist, and a Start button that works would be the single most dishonest
 * thing this surface could contain. Declaring it disabled, with a reason, is
 * more useful than hiding it — the user learns that starting is a real future
 * step rather than wondering whether they missed it.
 */
export const RELAY_LOOP_CONTROLS = [
  'save_draft',
  'cancel',
  'continue_to_preflight',
  'start_loop',
] as const;
export type RelayLoopControl = (typeof RELAY_LOOP_CONTROLS)[number];

export interface RelayLoopControlView {
  readonly control: RelayLoopControl;
  readonly label: string;
  readonly enabled: boolean;
  /** Why it is disabled. `null` when enabled. Rendered, not just a tooltip —
   *  a disabled control with no stated reason is a dead end. */
  readonly disabledReason: string | null;
}

/* -------------------------------------------------------------- sections */

export interface RelayLoopFieldView {
  readonly label: string;
  readonly value: string;
  /** True when the value is genuinely unknown rather than empty. Surfaces
   *  render these differently so `Unknown` never reads as a real answer. */
  readonly unknown: boolean;
}

/**
 * The four identity facts, kept visibly separate because collapsing them is
 * the specific mistake this product exists to avoid.
 */
export interface RelayLoopTargetView {
  /** What the user typed, or a plain statement that they typed nothing. */
  readonly requested: string;
  /** Roles the registry can staff right now. */
  readonly resolved: readonly string[];
  /** Roles it cannot, with the reason in plain words. */
  readonly unavailable: readonly { readonly role: string; readonly reason: string }[];
  /**
   * Actual assigned agents. ALWAYS empty before execution — there is no
   * runtime, so no agent has been assigned to anything. The field exists so
   * the surface can say that explicitly instead of leaving a silent gap.
   */
  readonly assigned: readonly string[];
  /** The sentence the surface shows under the target block. */
  readonly assignmentNote: string;
}

export interface RelayLoopComposerView {
  readonly status: RelayLoopPresentationStatus;
  readonly headline: string;
  /** Exactly what Relay believes was typed. */
  readonly raw: string;
  readonly family: 'loop' | 'sloop';
  readonly isSchedule: boolean;
  readonly target: RelayLoopTargetView | null;
  readonly fields: readonly RelayLoopFieldView[];
  readonly blockers: readonly RelayLoopBlocker[];
  readonly validationProblems: readonly string[];
  readonly notices: readonly string[];
  readonly controls: readonly RelayLoopControlView[];
  /** The confirmation-boundary banner. Always present on a contract preview. */
  readonly boundary: {
    readonly title: string;
    readonly lines: readonly string[];
  } | null;
  /** The underlying shared projection, so a test can compare it to the CLI. */
  readonly preview: RelayLoopCommandPreview;
}

/* --------------------------------------------------------------- helpers */

const AVAILABILITY_WORDS: Readonly<Record<string, string>> = Object.freeze({
  not_configured: 'not configured for this project',
  not_connected: 'configured but not connected',
  entitlement_locked: 'not included in the current plan',
  unknown: 'availability unknown, which never counts as available',
  available: 'available',
});

function roleWord(role: RelayAgentRole): string {
  return RELAY_LOOP_CANONICAL_ALIAS[role];
}

function targetView(target: RelayLoopTarget | null, requestedExpression: string | null): RelayLoopTargetView {
  const requested =
    requestedExpression === null
      ? 'Your active compound agent (no target was named)'
      : requestedExpression;

  if (target === null) {
    return {
      requested,
      resolved: [],
      unavailable: [],
      assigned: [],
      assignmentNote:
        'Relay has not been able to read the agent registry, so which roles can work is Unknown.',
    };
  }

  return {
    requested,
    resolved: target.resolvedRoles.map(roleWord),
    unavailable: target.unavailableRoles.map((entry) => ({
      role: roleWord(entry.role),
      reason: AVAILABILITY_WORDS[entry.availability] ?? entry.availability,
    })),
    // Nothing has run, so nothing is assigned. Said out loud rather than left
    // as an empty list a reader might mistake for "none needed".
    assigned: target.assignments.map((a) => a.actualAgentId ?? 'Unknown'),
    assignmentNote:
      target.assignments.length === 0
        ? 'No agent has been assigned. Agents are assigned when a Loop runs, and no Loop has run.'
        : 'Assigned agents are the identities actually observed working.',
  };
}

const UNKNOWN = 'Unknown';
const NOT_CONFIGURED = 'Not configured';

function field(label: string, value: string): RelayLoopFieldView {
  return { label, value, unknown: value === UNKNOWN };
}

function limitFields(limits: RelayLoopLimits): RelayLoopFieldView[] {
  const bound = (v: number | null, unit: string) => (v === null ? NOT_CONFIGURED : `${v} ${unit}`);
  return [
    field(
      'Maximum iterations',
      limits.maxIterations === null ? 'Unbounded (requires recorded consent)' : String(limits.maxIterations),
    ),
    field('Maximum duration', bound(limits.maxTotalDurationMinutes, 'minutes')),
    field('Spending cap', limits.maxTotalSpendUsd === null ? NOT_CONFIGURED : `$${limits.maxTotalSpendUsd.toFixed(2)}`),
    field('Token cap', bound(limits.maxTotalTokens, 'tokens')),
    field('Provider-call cap', bound(limits.maxTotalProviderCalls, 'calls')),
    field('Parallel slots', String(limits.maxConcurrentSlots)),
  ];
}

/* -------------------------------------------------------------- controls */

function controlsFor(input: {
  readonly requestsExecution: boolean;
  readonly available: boolean;
  readonly validationProblems: readonly string[];
}): RelayLoopControlView[] {
  const blocked = !input.available || input.validationProblems.length > 0;
  return [
    {
      control: 'save_draft',
      label: 'Save draft',
      enabled: input.requestsExecution,
      disabledReason: input.requestsExecution ? null : 'There is no contract to save.',
    },
    { control: 'cancel', label: 'Cancel', enabled: true, disabledReason: null },
    {
      control: 'continue_to_preflight',
      label: 'Continue to preflight',
      enabled: input.requestsExecution && !blocked,
      disabledReason: !input.requestsExecution
        ? 'There is no contract to check.'
        : blocked
          ? 'Resolve the blockers and problems listed above first.'
          : null,
    },
    {
      // Declared and permanently disabled until a runtime exists. See the
      // comment on RELAY_LOOP_CONTROLS for why it is shown rather than hidden.
      control: 'start_loop',
      label: 'Start Loop',
      enabled: false,
      disabledReason: 'Loop execution is not implemented in this build. No Loop can start yet.',
    },
  ];
}

/* --------------------------------------------------------------- project */

export interface RelayLoopComposerInput {
  readonly parsed: RelayParsedSlashCommand;
  readonly availability: RelayLoopAvailability;
  readonly target: RelayLoopTarget | null;
  readonly limits: RelayLoopLimits;
  readonly independentReviewRequired: boolean;
  readonly loopType: string;
  readonly projectId: string | null;
  readonly workspaceId: string | null;
  readonly acceptanceCriteria: readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[];
  readonly stopConditions: readonly string[];
  /** Problems from `validateLoopContractDraft`, when a draft was compiled. */
  readonly validationProblems: readonly string[];
}

export function projectLoopComposerView(input: RelayLoopComposerInput): RelayLoopComposerView {
  const preview = projectLoopCommandPreview({
    parsed: input.parsed,
    availability: input.availability,
    target: input.target,
    limits: input.limits,
    independentReviewRequired: input.independentReviewRequired,
  });

  const command = input.parsed.command;
  const requestsExecution = commandRequestsExecution(command);
  const available = input.availability.state === 'available';
  const blockedOnlyByFeatureFlags =
    input.availability.blockers.length > 0 &&
    input.availability.blockers.every((b) => b.reason === 'feature_disabled');

  const isSchedule =
    command.kind === 'loop_schedule_create' ||
    command.kind === 'loop_cron_create' ||
    command.kind === 'loop_schedule_composer' ||
    command.kind === 'loop_schedule_list';

  const requestedExpression =
    command.kind === 'loop_create' ||
    command.kind === 'sloop_create' ||
    command.kind === 'loop_schedule_create' ||
    command.kind === 'loop_cron_create'
      ? command.target.requestedExpression
      : null;

  const fields: RelayLoopFieldView[] = [];

  if (command.kind === 'loop_create' || command.kind === 'sloop_create') {
    fields.push(field('Objective', command.objective));
  } else if (command.kind === 'loop_schedule_create') {
    fields.push(field('Schedule request', command.scheduleRequest));
    fields.push(field('Parsed schedule', UNKNOWN));
    fields.push(field('Timezone', 'Required before a schedule can be armed — none has been set.'));
    fields.push(field('Schedule support', 'Grammar understood. The scheduler is not enabled.'));
    fields.push(field('Overlap policy', 'queue_one (default; not yet applied)'));
    fields.push(field('Missed-run policy', 'run_latest (default; not yet applied)'));
    fields.push(field('Runtime status', 'Not scheduled'));
  } else if (command.kind === 'loop_cron_create') {
    fields.push(field('Objective', command.objective));
    fields.push(field('Cron expression', command.cronExpression));
    fields.push(field('Parsed schedule', UNKNOWN));
    fields.push(field('Timezone', 'Required before a schedule can be armed — none has been set.'));
    fields.push(field('Schedule support', 'Grammar understood. The scheduler is not enabled.'));
    fields.push(field('Overlap policy', 'queue_one (default; not yet applied)'));
    fields.push(field('Missed-run policy', 'run_latest (default; not yet applied)'));
    fields.push(field('Runtime status', 'Not scheduled'));
  }

  if (requestsExecution) {
    fields.push(field('Loop type', input.loopType));
    fields.push(field('Project', input.projectId ?? UNKNOWN));
    fields.push(field('Workspace', input.workspaceId ?? UNKNOWN));
    fields.push(
      field(
        'Acceptance criteria',
        input.acceptanceCriteria.length === 0
          ? 'None set — add at least one before this Loop can prove it finished.'
          : input.acceptanceCriteria
              .map((c) => `${c.text}${c.blocking ? ' (blocking)' : ''}`)
              .join('; '),
      ),
    );
    fields.push(
      field(
        'Reviewer requirement',
        input.independentReviewRequired
          ? 'An independent review must approve the work before it can complete.'
          : 'No independent review is required by this completion rule.',
      ),
    );
    fields.push(...limitFields(input.limits));
    fields.push(
      field(
        'Stop conditions',
        input.stopConditions.length === 0 ? UNKNOWN : input.stopConditions.join(', '),
      ),
    );
  }

  fields.push(
    field(
      'Feature availability',
      available ? 'Every capability this command needs is enabled.' : 'Blocked — see below.',
    ),
  );

  return {
    status: deriveLoopPresentationStatus({
      state: requestsExecution ? 'draft' : null,
      available,
      blockedOnlyByFeatureFlags,
      validationProblems: input.validationProblems,
      confirmed: false,
    }),
    headline: preview.headline,
    raw: preview.raw,
    family: input.parsed.family,
    isSchedule,
    target: requestsExecution ? targetView(input.target, requestedExpression) : null,
    fields,
    blockers: input.availability.blockers,
    validationProblems: input.validationProblems,
    notices: preview.notices,
    controls: controlsFor({ requestsExecution, available, validationProblems: input.validationProblems }),
    boundary: requestsExecution
      ? {
          title: 'LOOP CONTRACT PREVIEW',
          lines: [
            'No work has started.',
            'No provider call has been made.',
            'Review the limits and agents before activation.',
          ],
        }
      : null,
    preview,
  };
}

/* -------------------------------------------------- opening from a command */

export interface OpenLoopSurfaceDeps {
  /** Feature flags the host observed. Absent means every feature is off. */
  readonly flags: RelayLoopFeatureFlags | null | undefined;
  /** Registry observation. `null` renders as Unknown, never as "no agents". */
  readonly registry: RelayAgentRegistrySnapshot | null;
  readonly observedAt: string;
  readonly projectId: string | null;
  readonly workspaceId: string | null;
  readonly loopType?: string;
  readonly acceptanceCriteria?: readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[];
  readonly stopConditions?: readonly string[];
}

/**
 * Turn typed text into whatever should open.
 *
 * This is the `/loop` → composer path, end to end, and it is a PURE function
 * so the test that proves "typing /loop opens the composer and starts nothing"
 * can assert on the result rather than on a rendered side effect.
 *
 * The Unchain session is hardcoded `null` and always will be here: a browser
 * cannot mint one, and passing anything else would make this surface the place
 * where eligibility gets forged.
 */
export function openLoopSurface(
  input: string,
  deps: OpenLoopSurfaceDeps,
):
  | { readonly kind: 'composer'; readonly view: RelayLoopComposerView; readonly swarmGate?: RelaySwarmGateView }
  | { readonly kind: 'overview' }
  | { readonly kind: 'run'; readonly runId: string }
  | { readonly kind: 'error'; readonly message: string; readonly details: readonly string[] } {
  const parsed = parseSlashCommand(input);
  if (!parsed.ok) {
    return { kind: 'error', message: parsed.error.message, details: parsed.error.details ?? [] };
  }

  const command = parsed.value.command;
  if (command.kind === 'loop_catalog') return { kind: 'overview' };

  /*
   * `/loop status <run-id>` OPENS THE RUN, IT DOES NOT DESCRIBE THE COMMAND.
   *
   * Routed here rather than into the composer because they answer different
   * questions: the composer says what a command WOULD do, and a user typing
   * `status` with an id is asking what a run IS doing. Only `status` — the
   * read — reaches this surface. `pause`, `resume` and `stop` change a run and
   * cost money to undo, and this host has no operator credential and no way to
   * get one, so it must not offer them at all.
   *
   * An action with no id stays with the composer, which explains that "the
   * caller's current Loop" is not something a browser can resolve.
   */
  if (command.kind === 'loop_action' && command.action === 'status' && command.loopId !== null) {
    return { kind: 'run', runId: command.loopId };
  }

  const availability = evaluateLoopAvailability({
    command,
    flags: deps.flags,
    unchain: null,
    assignableRoles: deps.registry?.eligibleRoles ?? [],
    observedAt: deps.observedAt,
  });

  const targets =
    command.kind === 'loop_create' ||
    command.kind === 'sloop_create' ||
    command.kind === 'loop_schedule_create' ||
    command.kind === 'loop_cron_create';

  const target =
    targets && deps.registry !== null ? resolveLoopTarget(command.target, deps.registry) : null;

  const view = projectLoopComposerView({
    parsed: parsed.value,
    availability,
    target,
    limits: DEFAULT_LOOP_LIMITS,
    independentReviewRequired: true,
    loopType: deps.loopType ?? 'execution',
    projectId: deps.projectId,
    workspaceId: deps.workspaceId,
    acceptanceCriteria: deps.acceptanceCriteria ?? [],
    stopConditions: deps.stopConditions ?? [...DEFAULT_STOP_CONDITION_LABELS],
    validationProblems: [],
  });

  return parsed.value.family === 'sloop'
    ? { kind: 'composer', view, swarmGate: projectSwarmGateView(availability) }
    : { kind: 'composer', view };
}

/** The stop conditions a freshly drafted Loop carries, as words. */
const DEFAULT_STOP_CONDITION_LABELS: readonly string[] = [
  'completion_policy_satisfied',
  'max_iterations_reached',
  'max_duration_reached',
  'budget_exhausted',
  'consecutive_failures',
  'operator_stopped',
];

/* ------------------------------------------------------------- S-Loop gate */

export interface RelaySwarmGateView {
  readonly title: string;
  readonly lines: readonly string[];
  /** Always false in this build. */
  readonly unchainActive: boolean;
  readonly temporarySlotsGranted: number;
}

/**
 * The truthful S-Loop state.
 *
 * It reports what Unchain WOULD grant, never that anything was granted, and
 * `temporarySlotsGranted` comes from the server-evaluated availability rather
 * than a constant — so a UI cannot become the thing that says yes.
 */
export function projectSwarmGateView(availability: RelayLoopAvailability): RelaySwarmGateView {
  const active = availability.state === 'available' && availability.grantedTemporarySlots > 0;
  return {
    title: 'S-LOOPS REQUIRE UNCHAIN',
    lines: active
      ? [
          'An Unchain session is active.',
          `It grants ${availability.grantedTemporarySlots} temporary agent slots.`,
          'Unchain expands agent capacity. It grants no permission and bypasses no approval, budget or policy.',
        ]
      : [
          'Unchain expands agent capacity and unlocks Swarm Loops.',
          'Unchain runtime is not yet enabled in this build.',
          'No session exists, no temporary slots have been created, and no capacity has been granted.',
        ],
    unchainActive: active,
    temporarySlotsGranted: active ? availability.grantedTemporarySlots : 0,
  };
}
