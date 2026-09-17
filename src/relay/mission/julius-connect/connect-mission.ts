import { transitionMission, type JuliusMissionState, type JuliusTransition } from '../julius/julius-runtime';
import {
  EXTERNAL_CAPABILITY_REQUIRED,
  type CapabilityDecision,
  type CapabilityDenial,
  type JuliusConnectState,
} from './connect-contracts';
import { authorizeCapabilityUse, recordCapabilityUse, requestCapabilities, type ConnectClock } from './connect-lifecycle';
import { findConnector } from './connect-registry';

/**
 * JULIUS CONNECT — A MISSION THAT NEEDS AN EXTERNAL CAPABILITY.
 *
 * The connection model is only real if Julius's behaviour follows it. So a task that uses external capabilities asks the
 * gate before every step. Allowed: the step runs, the use is audited. Refused: the Julius run moves to BLOCKED with the
 * reason code EXTERNAL_CAPABILITY_REQUIRED (the real run state machine, mission/julius/julius-runtime.ts), Julius opens a
 * capability request for what the rest of the task needs, and the task waits. When the gate allows again -- the user
 * approved, the connection came back -- the run moves BLOCKED -> READY -> EXECUTING and the task resumes. Revoke the
 * connection mid-task and the very next step is refused, and the run blocks again.
 *
 * This is the development runner: one task, deterministic steps, no provider. The production path puts the same gate
 * check inside the Julius tool dispatch.
 */

export interface ConnectTaskStep {
  readonly label: string;
  readonly connectorId: string;
  readonly capability: string;
}

export interface ConnectTaskTemplate {
  readonly templateId: string;
  readonly title: string;
  readonly purpose: string;
  readonly steps: readonly ConnectTaskStep[];
}

export interface ConnectTask {
  readonly taskId: string;
  readonly missionId: string;
  readonly projectId: string;
  readonly userId: string;
  readonly templateId: string;
  readonly title: string;
  readonly purpose: string;
  readonly steps: readonly ConnectTaskStep[];
  /** The next step to run. */
  readonly cursor: number;
  readonly runState: JuliusMissionState;
  readonly transitions: readonly JuliusTransition[];
  readonly blocked: { readonly connectorId: string; readonly capabilities: readonly string[]; readonly denial: CapabilityDenial; readonly requestId: string | null } | null;
  readonly completedAt: string | null;
}

/**
 * THE RUNTIME DOES THE STEP. Called only after the gate allowed it, with the decision (and so the credential reference the
 * runtime resolves at this moment, inside the connector runtime). Returns what happened -- never the material.
 */
export type ConnectStepExecutor = (input: { step: ConnectTaskStep; task: ConnectTask; decision: Extract<CapabilityDecision, { allowed: true }> }) =>
  { readonly outcome: 'success' | 'failed'; readonly detail: string };

/** The founder's sample: a design task that needs a DEVELOPMENT design-tool connector it does not have yet. */
export const DESIGN_SYNC_TEMPLATE: ConnectTaskTemplate = Object.freeze({
  templateId: 'design-sync',
  title: 'Sync the design tokens into Pixel Canvas',
  purpose: 'Reading the design tokens and writing the updated palette back for Pixel Canvas',
  steps: [
    { label: 'Read the design token file', connectorId: 'dev-figma', capability: 'files.read' },
    { label: 'Read the colour styles', connectorId: 'dev-figma', capability: 'files.read' },
    { label: 'Map the styles onto the Pixel Canvas palette', connectorId: 'dev-figma', capability: 'files.read' },
    { label: 'Write the palette back as a shared style', connectorId: 'dev-figma', capability: 'design.write' },
    { label: 'Tag the frames that use it', connectorId: 'dev-figma', capability: 'design.write' },
    { label: 'Re-read the file to verify the write', connectorId: 'dev-figma', capability: 'files.read' },
  ],
});

/**
 * THE FOUNDER'S SECOND SAMPLE (2026-09-17): Julius works a real-world-shaped site through the governed browser -- open the
 * profile, read what is already there, write the caption, publish it, then check it landed. The page in Wonder Web moves
 * only as these steps are allowed: nothing is published until the browser connection is authorized.
 */
export const SOCIAL_POST_TEMPLATE: ConnectTaskTemplate = Object.freeze({
  templateId: 'social-post',
  title: 'Post the Pixel Canvas picture to the studio account',
  purpose: 'Opening the studio profile and publishing one post with the picture from Pixel Canvas',
  steps: [
    { label: 'Open the studio profile', connectorId: 'dev-social', capability: 'profile.read' },
    { label: 'Read the posts already there', connectorId: 'dev-social', capability: 'posts.read' },
    { label: 'Write the caption', connectorId: 'dev-social', capability: 'posts.create' },
    { label: 'Publish the post', connectorId: 'dev-social', capability: 'posts.create' },
    { label: 'Re-read the profile to verify it landed', connectorId: 'dev-social', capability: 'posts.read' },
  ],
});

export const CONNECT_TASK_TEMPLATES: readonly ConnectTaskTemplate[] = Object.freeze([DESIGN_SYNC_TEMPLATE, SOCIAL_POST_TEMPLATE]);

function move(task: ConnectTask, to: JuliusMissionState, reasonCode: string, safeSummary: string, at: string): ConnectTask {
  const transition = transitionMission({
    transitionId: `${task.taskId}-t${task.transitions.length + 1}`, missionId: task.missionId, current: task.runState, to,
    reasonCode, safeSummary, evidenceIds: [], occurredAt: at,
  });
  return { ...task, runState: to, transitions: [...task.transitions, transition] };
}

/** Start a task: the Julius run is created, planned, readied and set executing, each step a recorded transition. */
export function startConnectTask(
  template: ConnectTaskTemplate,
  ids: { taskId: string; missionId: string; projectId: string; userId: string },
  at: string,
): ConnectTask {
  let task: ConnectTask = {
    ...ids, templateId: template.templateId, title: template.title, purpose: template.purpose, steps: template.steps, cursor: 0,
    runState: 'CREATED', transitions: [], blocked: null, completedAt: null,
  };
  task = move(task, 'PLANNING', 'TASK_ACCEPTED', `Julius accepted: ${template.title}.`, at);
  task = move(task, 'READY', 'PLAN_READY', 'The steps and the capabilities they need are known.', at);
  task = move(task, 'EXECUTING', 'EXECUTION_STARTED', 'Julius is working.', at);
  return task;
}

/**
 * ONE STEP OF JULIUS'S WORK, decided by the gate. Returns the connection state (with audit and any new request) and the
 * task as it now stands.
 */
export function advanceConnectTask(
  state: JuliusConnectState,
  task: ConnectTask,
  clock: ConnectClock,
  execute?: ConnectStepExecutor,
): { state: JuliusConnectState; task: ConnectTask } {
  if (task.runState === 'COMPLETED' || task.runState === 'FAILED' || task.runState === 'CANCELLED') {
    return { state, task };
  }
  const step = task.steps[task.cursor];
  if (!step) {
    let done = task.runState === 'EXECUTING' ? move(task, 'VERIFYING', 'STEPS_COMPLETE', 'Every step ran.', clock.at) : task;
    done = move(done, 'COMPLETED', 'TASK_VERIFIED', 'The task is done and verified.', clock.at);
    return { state, task: { ...done, completedAt: clock.at } };
  }

  const decision = authorizeCapabilityUse(state, { userId: task.userId, projectId: task.projectId, connectorId: step.connectorId, capability: step.capability }, clock);

  if (task.runState === 'BLOCKED') {
    if (!decision.allowed) {
      return { state, task };
    }
    // THE DEPENDENCY RESOLVED: the capability is available again, and Julius resumes where it stopped.
    // Nothing is used here: the step itself runs -- through the gate again -- on the next advance.
    let resumed = move(task, 'READY', 'EXTERNAL_CAPABILITY_AVAILABLE', `${step.capability} is available again.`, clock.at);
    resumed = move(resumed, 'EXECUTING', 'EXECUTION_RESUMED', 'Julius resumed the task.', clock.at);
    return { state: auditMission(state, task, 'mission.resumed', step, clock), task: { ...resumed, blocked: null } };
  }

  if (decision.allowed) {
    const result = execute ? execute({ step, task, decision }) : { outcome: 'success' as const, detail: `Julius: ${step.label}.` };
    const next = recordCapabilityUse(state, {
      userId: task.userId, projectId: task.projectId, missionId: task.missionId, connectorId: step.connectorId, capability: step.capability,
      decision, outcome: result.outcome, detail: result.detail,
    }, clock);
    // A step that failed at the service is not skipped: the cursor stays and the next advance tries it again.
    return { state: next, task: result.outcome === 'success' ? { ...task, cursor: task.cursor + 1 } : task };
  }

  // REFUSED. Record it, ask for what the rest of the task needs from this connector, and block the run.
  let next = recordCapabilityUse(state, {
    userId: task.userId, projectId: task.projectId, missionId: task.missionId, connectorId: step.connectorId, capability: step.capability,
    decision, outcome: 'failed', detail: `Julius needed ${step.capability} to: ${step.label}`,
  }, clock);
  const needed = [...new Set(task.steps.slice(task.cursor).filter((s) => s.connectorId === step.connectorId).map((s) => s.capability))];
  let requestId: string | null = null;
  // THE USER'S NO STANDS. A connection the user revoked, or a request they declined for this task, is not asked for again
  // behind their back: the task waits until they connect it themselves.
  const declinedHere = next.requests.some((r) => r.taskId === task.taskId && r.connectorId === step.connectorId && r.state === 'DECLINED');
  if (decision.denial !== 'REVOKED' && !declinedHere) {
    const asked = requestCapabilities(next, {
      userId: task.userId, projectId: task.projectId, missionId: task.missionId, taskId: task.taskId, connectorId: step.connectorId,
      capabilities: needed, purpose: task.purpose,
    }, clock);
    if (asked.ok) {
      next = asked.value.state;
      if (asked.value.kind === 'awaiting_user') requestId = asked.value.request.requestId;
    }
  }
  const connector = findConnector(step.connectorId, clock.registry);
  const blocked = move(task, 'BLOCKED', EXTERNAL_CAPABILITY_REQUIRED,
    `Waiting for ${connector?.displayName ?? step.connectorId}: ${needed.join(', ')} (${decision.denial}).`, clock.at);
  next = auditMission(next, task, 'mission.blocked', step, clock, `${EXTERNAL_CAPABILITY_REQUIRED}: ${needed.join(', ')} (${decision.denial})`);
  return { state: next, task: { ...blocked, blocked: { connectorId: step.connectorId, capabilities: needed, denial: decision.denial, requestId } } };
}

function auditMission(state: JuliusConnectState, task: ConnectTask, action: 'mission.blocked' | 'mission.resumed', step: ConnectTaskStep, clock: ConnectClock, detail?: string): JuliusConnectState {
  const sequence = state.sequence + 1;
  return {
    ...state,
    sequence,
    audit: [...state.audit, {
      eventId: `caud_${String(sequence).padStart(4, '0')}`, at: clock.at, actor: 'julius', action, projectId: task.projectId, missionId: task.missionId,
      connectionId: null, connectorId: step.connectorId, capability: step.capability, outcome: action === 'mission.blocked' ? 'pending' : 'success',
      detail: detail ?? `Julius resumed ${task.title}.`,
    }],
  };
}
