/**
 * FAKE PORTS. Not a VM, not a browser, not a provider.
 * Not an R1 pass. Not an R6 pass.
 * Scripted answers only. This file does not mint a CSPRNG agent id and does
 * not assign a window number; a test that wants a title supplies the string
 * the real session service would have returned.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { JuliusMissionState, JuliusTaskState } from '../../mission/julius/julius-runtime';
import { JuliusWonderWebVmOrchestrator, type JuliusVmOrchestratorDeps } from './julius-wonder-web-vm-orchestrator';
import type {
  JuliusIssuedTaskSource,
  JuliusVmRegistryPort,
  JuliusVmSessionPort,
  JuliusVmSpendAuthorization,
  JuliusVmSpendCapPort,
} from './julius-wonder-web-vm-port';
import { JULIUS_TERMINAL_ACCENT_TOKEN, JULIUS_VM_END_CAUSES } from './julius-wonder-web-vm-types';

const SECRET = 'sk-test-credential-should-not-leak';
const NOW = '2026-10-23T17:00:00.000Z';
const HARD = '2026-10-23T18:00:00.000Z';
const IDLE = '2026-10-23T17:30:00.000Z';
const AUTHORIZED: JuliusVmSpendAuthorization = {
  authorized: true, reasonCode: null, spendCeilingUsdMicros: 1_000_000,
};

type TaskRow = {
  taskId: string; missionId: string; state: JuliusTaskState; taskType: string; role: string;
};

class Issued implements JuliusIssuedTaskSource {
  run: JuliusMissionState | null = 'EXECUTING';
  readonly tasks: TaskRow[] = [];
  async tasksForRun(runId: string): Promise<readonly TaskRow[]> {
    return this.tasks.filter((task) => task.taskId.startsWith(`${runId}:`));
  }
  async runState(): Promise<JuliusMissionState | null> { return this.run; }
}

class FakePorts implements JuliusVmRegistryPort, JuliusVmSessionPort, JuliusVmSpendCapPort {
  readonly vaultSecret = SECRET;
  readonly calls: { op: string; body: unknown }[] = [];
  readonly agentIds = new Map<string, string>();
  denyReserve = false;
  failOpen = false;
  failCommit = false;
  failNavigate = false;
  failAct = false;
  failScreenshot = false;
  failTerminate = false;
  readonly failTerminateSessionIds = new Set<string>();
  /** What the session service reports back. Julius still sends owner_terminated. */
  reportedEndCause = 'owner_terminated';
  hardTtlAt = HARD;
  holdOpen: (() => Promise<void>) | null = null;
  private sessions = 0;

  async registerWorkingCard(input: Parameters<JuliusVmRegistryPort['registerWorkingCard']>[0]) {
    this.calls.push({ op: 'register', body: input });
    const agentId = this.agentIds.get(input.taskId) ?? `fake-agent-${this.agentIds.size + 1}`;
    this.agentIds.set(input.taskId, agentId);
    return { agentId };
  }

  async reserve(input: Parameters<JuliusVmSpendCapPort['reserve']>[0]) {
    this.calls.push({ op: 'reserve', body: input });
    if (this.denyReserve || input.authorization.authorized !== true) {
      return { state: 'DENIED' as const, denialReason: input.authorization.reasonCode ?? 'namespace_spend_ceiling_exceeded' };
    }
    return { state: 'RESERVED' as const, denialReason: null };
  }

  async commit(input: Parameters<JuliusVmSpendCapPort['commit']>[0]) {
    this.calls.push({ op: 'commit', body: input });
    if (this.failCommit) throw new Error('fake_commit_failed');
  }

  async release(input: Parameters<JuliusVmSpendCapPort['release']>[0]) {
    this.calls.push({ op: 'release', body: input });
  }

  async openSession(input: Parameters<JuliusVmSessionPort['openSession']>[0]) {
    this.calls.push({ op: 'open', body: input });
    if (this.holdOpen) await this.holdOpen();
    if (this.failOpen) throw new Error('fake_open_failed');
    this.sessions += 1;
    return {
      vmSessionId: `fake-session-${this.sessions}`,
      hardTtlAt: this.hardTtlAt,
      idleTtlAt: IDLE,
      providerResponseId: `fake-response-open-${this.sessions}`,
    };
  }

  async navigate(input: Parameters<JuliusVmSessionPort['navigate']>[0]) {
    this.calls.push({ op: 'navigate', body: input });
    if (this.failNavigate) throw new Error('fake_navigate_failed');
    return { providerResponseId: 'fake-response-navigate' };
  }

  async act(input: Parameters<JuliusVmSessionPort['act']>[0]) {
    this.calls.push({ op: 'act', body: input });
    if (this.failAct) throw new Error('fake_act_failed');
    return { providerResponseId: 'fake-response-act' };
  }

  async screenshot(input: Parameters<JuliusVmSessionPort['screenshot']>[0]) {
    this.calls.push({ op: 'screenshot', body: input });
    if (this.failScreenshot) throw new Error('fake_screenshot_failed');
    return { providerResponseId: 'fake-response-screenshot', streamRef: 'fake-stream-ref' };
  }

  async closeWindow(input: Parameters<JuliusVmSessionPort['closeWindow']>[0]) {
    this.calls.push({ op: 'close-window', body: input });
    return { providerResponseId: 'fake-response-close-window' };
  }

  async terminate(input: Parameters<JuliusVmSessionPort['terminate']>[0]) {
    this.calls.push({ op: 'terminate', body: input });
    if (this.failTerminate || this.failTerminateSessionIds.has(input.vmSessionId)) throw new Error('fake_terminate_failed');
    return { providerResponseId: 'fake-response-terminate', endCause: this.reportedEndCause };
  }

  ops(op: string): unknown[] {
    return this.calls.filter((call) => call.op === op).map((call) => call.body);
  }
}

function task(taskId: string, state: JuliusTaskState = 'ACTIVE'): TaskRow {
  return { taskId, missionId: 'mission', state, taskType: 'plan', role: 'PROMPT_ARCHITECT' };
}

function harness(
  tasks: TaskRow[] = [task('run:one:plan')],
  options: { readonly maxLifetimeMs?: number; readonly omitMaxLifetime?: boolean } = {},
) {
  const issued = new Issued();
  issued.tasks.push(...tasks);
  const fake = new FakePorts();
  let n = 0;
  const clock = { now: () => NOW };
  const ids = { next: (kind: string) => `${kind}-${++n}` };
  const maxLifetimeMs = options.omitMaxLifetime ? undefined : (options.maxLifetimeMs ?? 3_600_000);
  const deps = {
    tasks: issued, registry: fake, sessions: fake, spend: fake, clock, ids,
    ...(maxLifetimeMs === undefined ? {} : { maxLifetimeMs }),
  };
  const orch = new JuliusWonderWebVmOrchestrator(deps as JuliusVmOrchestratorDeps);
  return { issued, fake, orch, clock };
}

const openInput = {
  runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', cardLabel: 'Planner',
  allowlistHosts: ['allowed.example'], usdMicros: 10_000, authorization: AUTHORIZED,
};

describe('Julius Wonder Web VM orchestration', () => {
  it('registers the card label as agentDisplayName and stores no title', async () => {
    const { orch, fake } = harness();
    const opened = await orch.open({ ...openInput, cardLabel: '  Planner  ' });
    expect(opened.ok).toBe(true);
    expect(opened.vmSessionId).toBe('fake-session-1');
    expect(opened.agentId).toBe('fake-agent-1');
    expect(opened.endCause).toBeNull();
    expect(opened.trace.providerResponseId).toBe('fake-response-open-1');
    expect(opened.trace.spend.mechanism).toBe('pr-404-julius-spend-ceiling');
    expect(opened.trace.spend.measuredUsdMicros).toBeNull();
    expect(opened.trace.spend.agentId).toBe('fake-agent-1');
    const registration = fake.ops('register')[0] as { agentDisplayName: string; accentColourToken: string; taskId: string };
    expect(registration.agentDisplayName).toBe('Planner');
    expect(registration.accentColourToken).toBe(JULIUS_TERMINAL_ACCENT_TOKEN);
    expect(registration.taskId).toBe('run:one:plan');
    expect(opened.trace.note).toBeNull();
    expect(recordKeys(opened)).not.toContain('windowTitle');
    expect(recordKeys(opened)).not.toContain('title');
    expect(recordKeys(registration)).not.toContain('windowTitle');
    expect(recordKeys(registration)).not.toContain('title');
    expect(JSON.stringify(opened)).not.toContain(SECRET);
  });

  it.each([
    ['whitespace only', ' \t\n ', 'label_omitted:blank'],
    ['65 characters', 'a'.repeat(65), 'label_omitted:too_long'],
    ['a control character', 'Plan\u0001ner', 'label_omitted:control_character'],
    ['a missing label', undefined, 'label_omitted:missing'],
  ] as const)('omits %s, records the trace note, and still opens the VM', async (_label, cardLabel, note) => {
    const { orch, fake } = harness();
    const opened = await orch.open({ ...openInput, cardLabel });
    expect(opened.ok).toBe(true);
    expect(opened.vmSessionId).toBe('fake-session-1');
    expect(opened.trace.note).toBe(note);
    expect(opened.trace.spend.state).toBe('COMMITTED');
    const registration = fake.ops('register')[0] as object;
    expect(registration).not.toHaveProperty('agentDisplayName');
    expect(JSON.stringify(registration)).not.toContain('a'.repeat(64));
    expect(JSON.stringify(registration)).not.toContain('Plan');
    expect(fake.ops('open')).toHaveLength(1);
  });

  it('sends a trimmed label of 64 code points, including emoji', async () => {
    const label = '😀'.repeat(64);
    expect(label.length).toBe(128);
    const { orch, fake } = harness();
    const opened = await orch.open({ ...openInput, cardLabel: `  ${label}  ` });
    expect(opened.ok).toBe(true);
    expect(opened.trace.note).toBeNull();
    const registration = fake.ops('register')[0] as { agentDisplayName?: string };
    expect(registration.agentDisplayName).toBe(label);
    expect(fake.ops('open')).toHaveLength(1);
  });

  it('omits 65 code points, including emoji, and does not truncate', async () => {
    const label = '😀'.repeat(65);
    expect(Array.from(label)).toHaveLength(65);
    const { orch, fake } = harness();
    const opened = await orch.open({ ...openInput, cardLabel: label });
    expect(opened.ok).toBe(true);
    expect(opened.vmSessionId).toBe('fake-session-1');
    expect(opened.trace.note).toBe('label_omitted:too_long');
    const registration = fake.ops('register')[0] as object;
    expect(registration).not.toHaveProperty('agentDisplayName');
    expect(JSON.stringify(registration)).not.toContain('😀'.repeat(64));
    expect(fake.ops('open')).toHaveLength(1);
  });

  it.each([
    ['U+0085', 'Plan\u0085ner'],
    ['U+2028', 'Plan\u2028ner'],
    ['U+2029', 'Plan\u2029ner'],
    ['a lone surrogate', 'Plan\uD800ner'],
  ] as const)('omits %s, records the trace note, and still opens the VM', async (_label, cardLabel) => {
    const { orch, fake } = harness();
    const opened = await orch.open({ ...openInput, cardLabel });
    expect(opened.ok).toBe(true);
    expect(opened.vmSessionId).toBe('fake-session-1');
    expect(opened.trace.note).toBe('label_omitted:control_character');
    const registration = fake.ops('register')[0] as object;
    expect(registration).not.toHaveProperty('agentDisplayName');
    expect(JSON.stringify(registration)).not.toContain('Plan');
    expect(fake.ops('open')).toHaveLength(1);
  });

  it('refuses a task the runtime did not issue, and a loadout id', async () => {
    const { orch, fake } = harness();
    const forged = await orch.open({ ...openInput, taskId: 'run:one:forged' });
    expect(forged.ok).toBe(false);
    expect(forged.reasonCode).toBe('task_not_issued');
    const loadout = await orch.open({ ...openInput, taskId: 'pbcard:00000000-0000-4000-8000-000000000001' });
    expect(loadout.reasonCode).toBe('loadout_is_not_a_working_card');
    expect(fake.ops('register')).toHaveLength(0);
    expect(fake.ops('open')).toHaveLength(0);
  });

  it('refuses a caller-supplied agent id and a caller-supplied user id', async () => {
    const { orch, fake } = harness();
    const opened = await orch.open(openInput);
    const withAgent = { ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://allowed.example/', agentId: opened.agentId };
    const forgedAgent = await orch.navigate(withAgent as typeof openInput & { vmSessionId: string; url: string });
    expect(forgedAgent.reasonCode).toBe('forged_agent_id');
    const withUser = { ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://allowed.example/', requesterUserId: 'user-1' };
    const forgedUser = await orch.navigate(withUser as typeof openInput & { vmSessionId: string; url: string });
    expect(forgedUser.reasonCode).toBe('caller_supplied_user_id');
    expect(fake.ops('navigate')).toHaveLength(0);
  });

  it('refuses a host that is not on the allowlist, including a wildcard entry', async () => {
    const { orch, fake } = harness();
    const opened = await orch.open({ ...openInput, allowlistHosts: ['allowed.example', '*'] });
    const denied = await orch.navigate({
      ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://other.example/path', usdMicros: 1, authorization: AUTHORIZED,
    });
    expect(denied.reasonCode).toBe('navigation_allowlist_denied');
    expect(denied.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('navigate')).toHaveLength(0);
    const starred = await orch.navigate({
      ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://star.example/', usdMicros: 1, authorization: AUTHORIZED,
    });
    expect(starred.reasonCode).toBe('navigation_allowlist_denied');
  });

  it('does not expose a credential to the agent or the port', async () => {
    const { orch, fake } = harness();
    const opened = await orch.open(openInput);
    const url = `https://${['user', SECRET].join(':')}@${'allowed.example'}/secret`;
    const denied = await orch.navigate({
      ...openInput, vmSessionId: opened.vmSessionId!, url, usdMicros: 1, authorization: AUTHORIZED,
    });
    expect(denied.reasonCode).toBe('navigation_credential_denied');
    const dumped = JSON.stringify({ opened, denied, calls: fake.calls });
    expect(dumped).not.toContain(SECRET);
    expect(dumped).not.toContain(fake.vaultSecret);
  });

  it('refuses when the spend cap authorization is denied, before a session exists', async () => {
    const { orch, fake } = harness();
    const denied = await orch.open({
      ...openInput,
      authorization: { authorized: false, reasonCode: 'namespace_spend_ceiling_exceeded', spendCeilingUsdMicros: 1_000_000 },
    });
    expect(denied.ok).toBe(false);
    expect(denied.reasonCode).toBe('namespace_spend_ceiling_exceeded');
    expect(denied.trace.spend.state).toBe('DENIED');
    expect(fake.ops('reserve')).toHaveLength(0);
    expect(fake.ops('open')).toHaveLength(0);
  });

  it('refuses when the spend port denies the reservation', async () => {
    const { orch, fake } = harness();
    fake.denyReserve = true;
    const denied = await orch.open(openInput);
    expect(denied.reasonCode).toBe('namespace_spend_ceiling_exceeded');
    expect(denied.trace.spend.agentId).toBe('fake-agent-1');
    expect(fake.ops('open')).toHaveLength(0);
  });

  it('does not let one card steer, close, or terminate another card that shares its label and accent', async () => {
    const { orch, fake } = harness([task('run:one:plan'), task('run:one:build')]);
    fake.agentIds.set('run:one:plan', 'agent-plan');
    fake.agentIds.set('run:one:build', 'agent-build');
    const plan = await orch.open(openInput);
    const build = await orch.open({ ...openInput, taskId: 'run:one:build', cardLabel: 'Planner' });
    expect(plan.vmSessionId).not.toBe(build.vmSessionId);
    expect(plan.agentId).not.toBe(build.agentId);
    expect(fake.ops('register').map((body) => (body as { accentColourToken: string }).accentColourToken))
      .toEqual([JULIUS_TERMINAL_ACCENT_TOKEN, JULIUS_TERMINAL_ACCENT_TOKEN]);
    const steer = await orch.navigate({
      ...openInput, taskId: 'run:one:build', vmSessionId: plan.vmSessionId!, url: 'https://allowed.example/',
      usdMicros: 1, authorization: AUTHORIZED,
    });
    const act = await orch.act({
      ...openInput, taskId: 'run:one:build', vmSessionId: plan.vmSessionId!, actionName: 'click',
      usdMicros: 1, authorization: AUTHORIZED,
    });
    const closed = await orch.closeWindow({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:build', vmSessionId: plan.vmSessionId!,
    });
    const terminated = await orch.requestTerminate({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:build', vmSessionId: plan.vmSessionId!,
    });
    for (const result of [steer, act, closed, terminated]) expect(result.reasonCode).toBe('session_not_owned');
    expect(fake.ops('navigate')).toHaveLength(0);
    expect(fake.ops('act')).toHaveLength(0);
    expect(fake.ops('close-window')).toHaveLength(0);
    expect(fake.ops('terminate')).toHaveLength(0);
    expect(steer.trace.spend.agentId).toBe('agent-build');
  });

  it('closing a window does not terminate the session', async () => {
    // wonder-web-vm-session.v1: closing a window is not an end cause.
    // A paid action stays allowed while the session is live, owned by the
    // same authenticated agent, and authorized by the spend-cap port.
    const { orch, fake } = harness([task('run:one:plan'), task('run:one:build')]);
    fake.agentIds.set('run:one:plan', 'agent-plan');
    fake.agentIds.set('run:one:build', 'agent-build');
    const opened = await orch.open(openInput);
    const build = await orch.open({ ...openInput, taskId: 'run:one:build', cardLabel: 'Builder' });
    const closed = await orch.closeWindow({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', vmSessionId: opened.vmSessionId!,
    });
    expect(closed.reasonCode).toBe('window_closed');
    expect(closed.endCause).toBeNull();
    expect(fake.ops('terminate')).toHaveLength(0);
    expect(fake.ops('close-window')).toHaveLength(1);
    const before = fake.calls.length;
    const steered = await orch.navigate({
      ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://allowed.example/',
    });
    expect(steered.ok).toBe(true);
    expect(steered.reasonCode).toBe('acted');
    expect(steered.endCause).toBeNull();
    expect(fake.calls.slice(before).map((call) => call.op)).toEqual(['reserve', 'navigate', 'commit']);
    expect(fake.ops('terminate')).toHaveLength(0);
    const other = await orch.navigate({
      ...openInput, taskId: 'run:one:build', vmSessionId: opened.vmSessionId!, url: 'https://allowed.example/',
    });
    expect(other.reasonCode).toBe('session_not_owned');
    expect(build.agentId).toBe('agent-build');
    expect(fake.ops('navigate')).toHaveLength(1);
  });

  it.each(JULIUS_VM_END_CAUSES)('refuses a paid action once the session has end cause %s', async (endCause) => {
    const { orch, fake } = harness();
    const opened = await orch.open(openInput);
    await orch.closeWindow({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', vmSessionId: opened.vmSessionId!,
    });
    expect(fake.ops('terminate')).toHaveLength(0);
    const noted = await orch.notePortEnd({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', vmSessionId: opened.vmSessionId!, endCause,
    });
    expect(noted.endCause).toBe(endCause);
    const reserves = fake.ops('reserve').length;
    const denied = await orch.navigate({
      ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://allowed.example/',
    });
    expect(denied.ok).toBe(false);
    expect(denied.reasonCode).toBe('session_not_open');
    expect(denied.endCause).toBe(endCause);
    expect(denied.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('navigate')).toHaveLength(0);
    expect(fake.ops('reserve')).toHaveLength(reserves);
    expect(fake.ops('terminate')).toHaveLength(0);
  });

  it.each(['SUCCEEDED', 'FAILED', 'CANCELLED'] as const)('terminates when the card ends %s', async (state) => {
    const { orch, fake, issued } = harness();
    const opened = await orch.open(openInput);
    issued.tasks[0]!.state = state;
    const ended = await orch.onTaskEnded({ runId: 'run:one', projectId: 'project', taskId: 'run:one:plan' });
    expect(ended.reasonCode).toBe('session_terminated');
    expect(ended.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('terminate')).toEqual([{ vmSessionId: opened.vmSessionId, agentId: opened.agentId, endCause: 'owner_terminated' }]);
  });

  it.each(['FAILED', 'COMPLETED', 'CANCELLED'] as const)('terminates every session when the run ends %s', async (state) => {
    const { orch, fake, issued } = harness([task('run:one:plan'), task('run:one:build')]);
    const plan = await orch.open(openInput);
    const build = await orch.open({ ...openInput, taskId: 'run:one:build', cardLabel: 'Builder' });
    issued.run = state;
    const ended = await orch.onRunEnded({ runId: 'run:one', projectId: 'project' });
    expect(ended.ok).toBe(true);
    expect(ended.reasonCode).toBe('session_terminated');
    const terminated = fake.ops('terminate') as { vmSessionId: string; agentId: string }[];
    expect(terminated).toEqual([
      { vmSessionId: plan.vmSessionId, agentId: plan.agentId, endCause: 'owner_terminated' },
      { vmSessionId: build.vmSessionId, agentId: build.agentId, endCause: 'owner_terminated' },
    ]);
    expect(fake.ops('reserve')).toHaveLength(2);
  });

  it('leaves a failed terminate to the server TTL and does not reserve again', async () => {
    const { orch, fake, issued } = harness();
    await orch.open(openInput);
    const reserves = fake.ops('reserve').length;
    fake.failTerminate = true;
    issued.tasks[0]!.state = 'FAILED';
    const first = await orch.onTaskEnded({ runId: 'run:one', projectId: 'project', taskId: 'run:one:plan' });
    const second = await orch.onTaskEnded({ runId: 'run:one', projectId: 'project', taskId: 'run:one:plan' });
    expect(first.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(second.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(fake.ops('terminate')).toHaveLength(1);
    expect(fake.ops('reserve')).toHaveLength(reserves);
    const again = await orch.open(openInput);
    expect(again.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(again.ok).toBe(false);
    expect(fake.ops('open')).toHaveLength(1);
    expect(fake.ops('reserve')).toHaveLength(reserves);
  });

  it('refuses an action after the idle TTL and does not terminate or reserve again', async () => {
    const { orch, fake, clock } = harness();
    const opened = await orch.open(openInput);
    clock.now = () => IDLE;
    const denied = await orch.navigate({
      ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://allowed.example/', usdMicros: 1, authorization: AUTHORIZED,
    });
    expect(denied.reasonCode).toBe('session_idle_elapsed');
    expect(denied.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('navigate')).toHaveLength(0);
    expect(fake.ops('terminate')).toHaveLength(0);
    expect(fake.ops('reserve')).toHaveLength(1);
  });

  it('does not act after the hard TTL and has no extend operation', async () => {
    const { orch, fake, clock } = harness();
    const opened = await orch.open(openInput);
    clock.now = () => '2026-10-23T18:00:00.000Z';
    const denied = await orch.navigate({
      ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://allowed.example/', usdMicros: 1, authorization: AUTHORIZED,
    });
    expect(denied.reasonCode).toBe('session_hard_ttl_elapsed');
    expect(fake.ops('navigate')).toHaveLength(0);
    expect(fake.ops('reserve')).toHaveLength(1);
    expect(fake.calls.some((call) => call.op === 'extend')).toBe(false);
    const extend: 'extend' extends keyof JuliusVmSessionPort ? true : false = false;
    expect(extend).toBe(false);
  });

  it('opens two cards concurrently without waiting on the other', async () => {
    const { orch, fake } = harness([task('run:one:plan'), task('run:one:build')]);
    let entered = 0;
    let release: () => void = () => {};
    const bothEntered = new Promise<void>((resolve) => { release = resolve; });
    fake.holdOpen = async () => {
      entered += 1;
      if (entered === 2) release();
      await bothEntered;
    };
    const [plan, build] = await Promise.all([
      orch.open(openInput),
      orch.open({ ...openInput, taskId: 'run:one:build', cardLabel: 'Builder' }),
    ]);
    expect(entered).toBe(2);
    expect(plan.vmSessionId).not.toBe(build.vmSessionId);
    expect(fake.ops('open')).toHaveLength(2);
  });

  it('does not send a provider label, and still opens the VM', async () => {
    const { orch, fake } = harness();
    const opened = await orch.open({ ...openInput, cardLabel: '  Browserbase  ' });
    expect(opened.ok).toBe(true);
    expect(opened.vmSessionId).toBe('fake-session-1');
    expect(opened.trace.note).toBe('label_omitted:provider_label');
    const registration = fake.ops('register')[0] as object;
    expect(registration).not.toHaveProperty('agentDisplayName');
    expect(JSON.stringify(registration).toLowerCase()).not.toContain('browserbase');
  });

  it('dedupes an open for the same task while the session is open or the window is closed', async () => {
    const { orch, fake } = harness();
    const first = await orch.open(openInput);
    const second = await orch.open(openInput);
    expect(second.vmSessionId).toBe(first.vmSessionId);
    expect(second.reasonCode).toBe('session_open');
    await orch.closeWindow({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', vmSessionId: first.vmSessionId!,
    });
    const third = await orch.open(openInput);
    expect(third.vmSessionId).toBe(first.vmSessionId);
    expect(third.reasonCode).toBe('session_open');
    expect(fake.ops('open')).toHaveLength(1);
    expect(fake.ops('reserve')).toHaveLength(1);
    expect(fake.ops('terminate')).toHaveLength(0);
  });

  it('kills a mutant that accepts a caller-supplied agent id', async () => {
    const { orch, fake } = harness();
    const denied = await orch.open({ ...openInput, agentId: 'run:one:plan' } as typeof openInput);
    expect(denied.ok).toBe(false);
    expect(denied.reasonCode).toBe('forged_agent_id');
    expect(denied.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('register')).toHaveLength(0);
    expect(fake.ops('reserve')).toHaveLength(0);
    expect(fake.ops('open')).toHaveLength(0);
    const opened = await orch.open(openInput);
    const steered = await orch.navigate({
      ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://allowed.example/',
      usdMicros: 1, authorization: AUTHORIZED, agentId: opened.agentId,
    } as typeof openInput & { vmSessionId: string; url: string });
    expect(steered.reasonCode).toBe('forged_agent_id');
    expect(steered.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('navigate')).toHaveLength(0);
    expect(fake.ops('reserve')).toHaveLength(1);
  });

  it('kills a mutant that terminates again after the card has already ended', async () => {
    const { orch, fake, issued } = harness();
    const opened = await orch.open(openInput);
    const reserves = fake.ops('reserve').length;
    issued.tasks[0]!.state = 'SUCCEEDED';
    const ended = { runId: 'run:one', projectId: 'project', taskId: 'run:one:plan' };
    const first = await orch.onTaskEnded(ended);
    const second = await orch.onTaskEnded(ended);
    expect(first.reasonCode).toBe('session_terminated');
    expect(second.reasonCode).toBe('session_terminated');
    expect(second.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('terminate')).toEqual([{ vmSessionId: opened.vmSessionId, agentId: opened.agentId, endCause: 'owner_terminated' }]);
    expect(fake.ops('reserve')).toHaveLength(reserves);
  });

  it('kills a mutant that reserves again after terminate fails', async () => {
    const { orch, fake } = harness();
    const opened = await orch.open(openInput);
    const reserves = fake.ops('reserve').length;
    fake.failTerminate = true;
    const end = { runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', vmSessionId: opened.vmSessionId! };
    const first = await orch.requestTerminate(end);
    const second = await orch.requestTerminate(end);
    const again = await orch.open(openInput);
    expect(fake.ops('terminate')).toHaveLength(1);
    expect(fake.ops('reserve')).toHaveLength(reserves);
    expect(fake.ops('open')).toHaveLength(1);
    expect(first.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(second.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(again.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(again.ok).toBe(false);
    expect(again.trace.spend.state).toBe('NOT_SPENT');
  });

  it('does not assign a window number in the production modules', () => {
    for (const file of [
      'julius-wonder-web-vm-types.ts',
      'julius-wonder-web-vm-port.ts',
      'julius-wonder-web-vm-authorization.ts',
      'julius-wonder-web-vm-orchestrator.ts',
    ]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/\bvmNumber\s*[:=]/);
      expect(source, file).not.toContain('windowTitle');
      expect(source, file).not.toMatch(/maxLifetimeMs\s*(?:=|\?\?)\s*\d/);
    }
  });

  it('treats another or unknown port cause as terminal without retry or reserve', async () => {
    const { orch, fake, issued } = harness();
    const opened = await orch.open(openInput);
    const reserves = fake.ops('reserve').length;
    fake.reportedEndCause = 'not-a-published-cause';
    issued.tasks[0]!.state = 'FAILED';
    const ended = await orch.onTaskEnded({ runId: 'run:one', projectId: 'project', taskId: 'run:one:plan' });
    expect(ended.reasonCode).toBe('session_ended');
    expect(ended.endCause).toBe('not-a-published-cause');
    expect(ended.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('terminate')).toEqual([{
      vmSessionId: opened.vmSessionId, agentId: opened.agentId, endCause: 'owner_terminated',
    }]);
    const second = await orch.onTaskEnded({ runId: 'run:one', projectId: 'project', taskId: 'run:one:plan' });
    expect(second.reasonCode).toBe('session_ended');
    expect(fake.ops('terminate')).toHaveLength(1);
    expect(fake.ops('reserve')).toHaveLength(reserves);
    const again = await orch.open(openInput);
    expect(again.reasonCode).toBe('session_not_open');
    expect(fake.ops('reserve')).toHaveLength(reserves);
    expect(fake.ops('open')).toHaveLength(1);
  });

  it('records a port-reported cause without calling terminate or reserving', async () => {
    const { orch, fake } = harness();
    const opened = await orch.open(openInput);
    const reserves = fake.ops('reserve').length;
    const noted = await orch.notePortEnd({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan',
      vmSessionId: opened.vmSessionId!, endCause: 'idle_timeout',
    });
    expect(noted.ok).toBe(true);
    expect(noted.reasonCode).toBe('session_ended');
    expect(noted.endCause).toBe('idle_timeout');
    expect(noted.trace.spend.state).toBe('NOT_SPENT');
    const unknown = await orch.notePortEnd({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan',
      vmSessionId: opened.vmSessionId!, endCause: 'not-a-published-cause',
    });
    expect(unknown.reasonCode).toBe('session_ended');
    expect(unknown.endCause).toBe('idle_timeout');
    expect(fake.ops('terminate')).toHaveLength(0);
    expect(fake.ops('reserve')).toHaveLength(reserves);
  });

  it.each(['navigate', 'act', 'screenshot'] as const)(
    'kills a mutant that skips spend.reserve before %s',
    async (operation) => {
      const { orch, fake } = harness();
      const opened = await orch.open(openInput);
      const before = fake.calls.length;
      const result = await runPaid(orch, operation, opened.vmSessionId!);
      expect(result.ok).toBe(true);
      expect(result.reasonCode).toBe('acted');
      expect(result.trace.spend.state).toBe('COMMITTED');
      expect(fake.calls.slice(before).map((call) => call.op)).toEqual(['reserve', operation, 'commit']);
      const reserved = fake.ops('reserve').at(-1) as { reservationId: string };
      const port = fake.ops(operation).at(-1) as { reservationId: string };
      expect(port.reservationId).toBe(reserved.reservationId);
    },
  );

  it.each(['navigate', 'act', 'screenshot'] as const)(
    'kills a mutant that drops the authorized check before %s',
    async (operation) => {
      const { orch, fake } = harness();
      const opened = await orch.open(openInput);
      const reserves = fake.ops('reserve').length;
      const denied = await runPaid(orch, operation, opened.vmSessionId!, {
        authorization: { authorized: false, reasonCode: 'namespace_spend_ceiling_exceeded', spendCeilingUsdMicros: 1_000_000 },
      });
      expect(denied.ok).toBe(false);
      expect(denied.reasonCode).toBe('namespace_spend_ceiling_exceeded');
      expect(denied.trace.spend.state).toBe('DENIED');
      expect(denied.trace.spend.reservationId).toBeNull();
      expect(fake.ops('reserve')).toHaveLength(reserves);
      expect(fake.ops(operation)).toHaveLength(0);
    },
  );

  it.each([
    ['navigate', 'failNavigate'],
    ['act', 'failAct'],
    ['screenshot', 'failScreenshot'],
  ] as const)('kills a mutant that does not release after a failed %s', async (operation, flag) => {
    const { orch, fake } = harness();
    const opened = await orch.open(openInput);
    fake[flag] = true;
    const failed = await runPaid(orch, operation, opened.vmSessionId!);
    expect(failed.reasonCode).toBe('action_failed');
    expect(failed.trace.spend.state).toBe('RELEASED');
    expect(fake.ops('release')).toEqual([expect.objectContaining({ reason: 'action_failed' })]);
    fake[flag] = false;
    const again = await runPaid(orch, operation, opened.vmSessionId!);
    expect(again.reasonCode).toBe('acted');
    expect(again.trace.spend.state).toBe('COMMITTED');
  });

  it('kills a mutant that acts on a session whose terminate failed', async () => {
    const { orch, fake } = harness();
    const opened = await orch.open(openInput);
    const reserves = fake.ops('reserve').length;
    fake.failTerminate = true;
    const ended = await orch.requestTerminate({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', vmSessionId: opened.vmSessionId!,
    });
    expect(ended.reasonCode).toBe('terminate_left_to_server_ttl');
    for (const operation of ['navigate', 'act', 'screenshot'] as const) {
      const denied = await runPaid(orch, operation, opened.vmSessionId!);
      expect(denied.reasonCode).toBe('terminate_left_to_server_ttl');
      expect(denied.trace.spend.state).toBe('NOT_SPENT');
      expect(fake.ops(operation)).toHaveLength(0);
    }
    const closed = await orch.closeWindow({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', vmSessionId: opened.vmSessionId!,
    });
    const noted = await orch.notePortEnd({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', vmSessionId: opened.vmSessionId!, endCause: 'idle_timeout',
    });
    const again = await orch.open(openInput);
    expect(closed.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(noted.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(noted.endCause).toBeNull();
    expect(again.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(fake.ops('close-window')).toHaveLength(0);
    expect(fake.ops('terminate')).toHaveLength(1);
    expect(fake.ops('reserve')).toHaveLength(reserves);
    expect(fake.ops('open')).toHaveLength(1);
    expect(fake.calls.some((call) => call.op === 'extend')).toBe(false);
  });

  it('terminates when commit throws after the VM opened, and releases only if that terminate is confirmed', async () => {
    const { orch, fake } = harness();
    fake.failCommit = true;
    const failed = await orch.open(openInput);
    expect(failed.ok).toBe(false);
    expect(failed.reasonCode).toBe('session_commit_failed_terminated');
    expect(failed.trace.spend.state).toBe('RELEASED');
    expect(fake.ops('terminate')).toEqual([{
      vmSessionId: 'fake-session-1', agentId: 'fake-agent-1', endCause: 'owner_terminated',
    }]);
    expect(fake.ops('commit')).toHaveLength(1);
    expect(fake.ops('release')).toHaveLength(1);
    const again = await orch.open(openInput);
    const steered = await orch.navigate({
      ...openInput, vmSessionId: 'fake-session-1', url: 'https://allowed.example/',
    });
    expect(again.reasonCode).toBe('session_not_open');
    expect(steered.reasonCode).toBe('session_not_open');
    expect(fake.ops('open')).toHaveLength(1);
    expect(fake.ops('reserve')).toHaveLength(1);
    expect(fake.ops('terminate')).toHaveLength(1);
  });

  it('holds the reservation when terminate fails after a commit failure on open', async () => {
    const { orch, fake } = harness();
    fake.failCommit = true;
    fake.failTerminate = true;
    const failed = await orch.open(openInput);
    expect(failed.reasonCode).toBe('session_commit_failed_terminate_failed');
    expect(failed.trace.spend.state).toBe('UNRECONCILED');
    expect(fake.ops('release')).toHaveLength(0);
    expect(fake.ops('terminate')).toHaveLength(1);
    const again = await orch.open(openInput);
    const steered = await orch.navigate({
      ...openInput, vmSessionId: failed.vmSessionId!, url: 'https://allowed.example/',
    });
    expect(again.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(steered.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(steered.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('open')).toHaveLength(1);
    expect(fake.ops('reserve')).toHaveLength(1);
    expect(fake.ops('navigate')).toHaveLength(0);
    expect(fake.ops('terminate')).toHaveLength(1);
    expect(fake.ops('release')).toHaveLength(0);
  });

  it.each(['navigate', 'act', 'screenshot'] as const)(
    'holds an unreconciled reservation when commit throws after %s',
    async (operation) => {
      const { orch, fake } = harness();
      const opened = await orch.open(openInput);
      fake.failCommit = true;
      const failed = await runPaid(orch, operation, opened.vmSessionId!);
      expect(failed.ok).toBe(false);
      expect(failed.reasonCode).toBe('action_commit_failed');
      expect(failed.trace.spend.state).toBe('UNRECONCILED');
      expect(failed.providerResponseId).toBe(`fake-response-${operation}`);
      expect(fake.ops('release')).toHaveLength(0);
      expect(fake.ops(operation)).toHaveLength(1);
      const reserves = fake.ops('reserve').length;
      const again = await runPaid(orch, 'navigate', opened.vmSessionId!);
      expect(again.reasonCode).toBe('spend_unreconciled');
      expect(again.trace.spend.state).toBe('NOT_SPENT');
      expect(fake.ops('reserve')).toHaveLength(reserves);
      expect(fake.ops('navigate')).toHaveLength(operation === 'navigate' ? 1 : 0);
    },
  );

  it.each([0, -1] as const)('refuses usdMicros %s before reserve', async (usdMicros) => {
    const { orch, fake } = harness();
    const denied = await orch.open({ ...openInput, usdMicros });
    expect(denied.reasonCode).toBe('spend_amount_invalid');
    expect(denied.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('reserve')).toHaveLength(0);
    expect(fake.ops('open')).toHaveLength(0);
    const opened = await orch.open(openInput);
    const steered = await orch.navigate({
      ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://allowed.example/', usdMicros,
    });
    expect(steered.reasonCode).toBe('spend_amount_invalid');
    expect(steered.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('navigate')).toHaveLength(0);
    expect(fake.ops('reserve')).toHaveLength(1);
  });

  it.each([
    ['missing', { omitMaxLifetime: true }],
    ['zero', { maxLifetimeMs: 0 }],
    ['negative', { maxLifetimeMs: -1 }],
    ['NaN', { maxLifetimeMs: Number.NaN }],
    ['Infinity', { maxLifetimeMs: Number.POSITIVE_INFINITY }],
  ] as const)('refuses the open when maxLifetimeMs is %s', async (_label, options) => {
    const { orch, fake } = harness(undefined, options);
    const denied = await orch.open(openInput);
    expect(denied.ok).toBe(false);
    expect(denied.reasonCode).toBe('max_lifetime_unconfigured');
    expect(denied.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('register')).toHaveLength(0);
    expect(fake.ops('reserve')).toHaveLength(0);
    expect(fake.ops('open')).toHaveLength(0);
  });

  it('rejects hardTtlAt past now plus the injected maxLifetimeMs', async () => {
    const { orch, fake } = harness();
    fake.hardTtlAt = '2026-10-23T18:00:00.001Z';
    const denied = await orch.open(openInput);
    expect(denied.ok).toBe(false);
    expect(denied.reasonCode).toBe('hard_ttl_beyond_maximum');
    expect(denied.trace.spend.state).toBe('RELEASED');
    expect(fake.ops('commit')).toHaveLength(0);
    expect(fake.ops('terminate')).toEqual([{
      vmSessionId: 'fake-session-1', agentId: 'fake-agent-1', endCause: 'owner_terminated',
    }]);
    expect(fake.ops('release')).toHaveLength(1);
    fake.hardTtlAt = HARD;
    const opened = await orch.open(openInput);
    expect(opened.reasonCode).toBe('session_open');
    expect(opened.vmSessionId).toBe('fake-session-2');
  });

  it('accepts a hardTtlAt equal to now plus maxLifetimeMs', async () => {
    const { orch } = harness(undefined, { maxLifetimeMs: 3_600_000 });
    const opened = await orch.open(openInput);
    expect(opened.reasonCode).toBe('session_open');
    expect(opened.vmSessionId).toBe('fake-session-1');
  });

  it('marks the session terminated locally after owner terminate', async () => {
    const { orch, fake } = harness();
    const opened = await orch.open(openInput);
    const ended = await orch.requestTerminate({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', vmSessionId: opened.vmSessionId!,
    });
    expect(ended.reasonCode).toBe('session_terminated');
    expect(ended.endCause).toBe('owner_terminated');
    const steered = await orch.navigate({
      ...openInput, vmSessionId: opened.vmSessionId!, url: 'https://allowed.example/',
    });
    expect(steered.reasonCode).toBe('session_not_open');
    expect(steered.endCause).toBe('owner_terminated');
    expect(steered.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('terminate')).toHaveLength(1);
    expect(fake.ops('navigate')).toHaveLength(0);
    expect(fake.ops('reserve')).toHaveLength(1);
  });

  it('checks the card and the run state before open and before end', async () => {
    const { orch, fake, issued } = harness();
    issued.tasks[0]!.state = 'SKIPPED';
    const skipped = await orch.open(openInput);
    expect(skipped.reasonCode).toBe('card_not_working');
    issued.tasks[0]!.state = 'ACTIVE';
    const working = await orch.onTaskEnded({ runId: 'run:one', projectId: 'project', taskId: 'run:one:plan' });
    expect(working.reasonCode).toBe('card_still_working');
    issued.run = 'COMPLETED';
    const endedRun = await orch.open(openInput);
    expect(endedRun.reasonCode).toBe('run_already_ended');
    issued.run = 'EXECUTING';
    const stillOpen = await orch.onRunEnded({ runId: 'run:one', projectId: 'project' });
    expect(stillOpen.reasonCode).toBe('run_still_open');
    issued.run = null;
    const missing = await orch.open(openInput);
    expect(missing.reasonCode).toBe('run_not_issued');
    expect(fake.ops('register')).toHaveLength(0);
    expect(fake.ops('terminate')).toHaveLength(0);
    expect(fake.ops('reserve')).toHaveLength(0);
  });

  it('releases the reservation when open fails and does not keep a session', async () => {
    const { orch, fake } = harness();
    fake.failOpen = true;
    const failed = await orch.open(openInput);
    expect(failed.reasonCode).toBe('session_open_failed');
    expect(failed.trace.spend.state).toBe('RELEASED');
    expect(fake.ops('open')).toHaveLength(1);
    expect(fake.ops('commit')).toHaveLength(0);
    expect(fake.ops('terminate')).toHaveLength(0);
    expect(fake.ops('release')).toEqual([expect.objectContaining({ reason: 'session_open_failed' })]);
    fake.failOpen = false;
    const opened = await orch.open(openInput);
    expect(opened.reasonCode).toBe('session_open');
    expect(opened.vmSessionId).toBe('fake-session-1');
    expect(fake.ops('open')).toHaveLength(2);
  });

  it('surfaces an earlier terminate failure when the run ends', async () => {
    const { orch, fake, issued } = harness([task('run:one:plan'), task('run:one:build')]);
    const plan = await orch.open(openInput);
    const build = await orch.open({ ...openInput, taskId: 'run:one:build', cardLabel: 'Builder' });
    fake.failTerminateSessionIds.add(plan.vmSessionId!);
    issued.run = 'FAILED';
    const ended = await orch.onRunEnded({ runId: 'run:one', projectId: 'project' });
    expect(ended.ok).toBe(false);
    expect(ended.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(ended.vmSessionId).toBe(plan.vmSessionId);
    expect(fake.ops('terminate')).toEqual([
      { vmSessionId: plan.vmSessionId, agentId: plan.agentId, endCause: 'owner_terminated' },
      { vmSessionId: build.vmSessionId, agentId: build.agentId, endCause: 'owner_terminated' },
    ]);
    const second = await orch.onRunEnded({ runId: 'run:one', projectId: 'project' });
    expect(second.reasonCode).toBe('terminate_left_to_server_ttl');
    expect(fake.ops('terminate')).toHaveLength(2);
    expect(fake.ops('reserve')).toHaveLength(2);
  });
});

async function runPaid(
  orch: JuliusWonderWebVmOrchestrator,
  operation: 'navigate' | 'act' | 'screenshot',
  vmSessionId: string,
  extra: { readonly authorization?: JuliusVmSpendAuthorization; readonly usdMicros?: number } = {},
) {
  const input = { ...openInput, vmSessionId, ...extra };
  if (operation === 'navigate') return orch.navigate({ ...input, url: 'https://allowed.example/' });
  if (operation === 'act') return orch.act({ ...input, actionName: 'click' });
  return orch.screenshot(input);
}

function recordKeys(value: unknown, found: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) recordKeys(item, found);
    return found;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    found.push(key);
    recordKeys(child, found);
  }
  return found;
}
