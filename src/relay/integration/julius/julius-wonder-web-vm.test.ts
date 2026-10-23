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
import { JuliusWonderWebVmOrchestrator } from './julius-wonder-web-vm-orchestrator';
import type {
  JuliusIssuedTaskSource,
  JuliusVmRegistryPort,
  JuliusVmSessionPort,
  JuliusVmSpendAuthorization,
  JuliusVmSpendCapPort,
} from './julius-wonder-web-vm-port';
import { JULIUS_TERMINAL_ACCENT_TOKEN } from './julius-wonder-web-vm-types';

const SECRET = 'sk-test-credential-should-not-leak';
const TITLE = 'Planner \u2014 Wonder Web VM 1';
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
  readonly titles = new Map<string, string>();
  readonly agentIds = new Map<string, string>();
  denyReserve = false;
  failOpen = false;
  failTerminate = false;
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
  }

  async release(input: Parameters<JuliusVmSpendCapPort['release']>[0]) {
    this.calls.push({ op: 'release', body: input });
  }

  async openSession(input: Parameters<JuliusVmSessionPort['openSession']>[0]) {
    this.calls.push({ op: 'open', body: input });
    if (this.holdOpen) await this.holdOpen();
    if (this.failOpen) throw new Error('fake_open_failed');
    this.sessions += 1;
    const taskId = [...this.agentIds.entries()].find(([, agentId]) => agentId === input.agentId)?.[0] ?? '';
    return {
      vmSessionId: `fake-session-${this.sessions}`,
      windowTitle: this.titles.get(taskId) ?? 'scripted-window-title',
      hardTtlAt: HARD,
      idleTtlAt: IDLE,
      providerResponseId: `fake-response-open-${this.sessions}`,
    };
  }

  async navigate(input: Parameters<JuliusVmSessionPort['navigate']>[0]) {
    this.calls.push({ op: 'navigate', body: input });
    return { providerResponseId: 'fake-response-navigate' };
  }

  async act(input: Parameters<JuliusVmSessionPort['act']>[0]) {
    this.calls.push({ op: 'act', body: input });
    return { providerResponseId: 'fake-response-act' };
  }

  async screenshot(input: Parameters<JuliusVmSessionPort['screenshot']>[0]) {
    this.calls.push({ op: 'screenshot', body: input });
    return { providerResponseId: 'fake-response-screenshot', streamRef: 'fake-stream-ref' };
  }

  async closeWindow(input: Parameters<JuliusVmSessionPort['closeWindow']>[0]) {
    this.calls.push({ op: 'close-window', body: input });
    return { providerResponseId: 'fake-response-close-window' };
  }

  async terminate(input: Parameters<JuliusVmSessionPort['terminate']>[0]) {
    this.calls.push({ op: 'terminate', body: input });
    if (this.failTerminate) throw new Error('fake_terminate_failed');
    return { providerResponseId: 'fake-response-terminate' };
  }

  ops(op: string): unknown[] {
    return this.calls.filter((call) => call.op === op).map((call) => call.body);
  }
}

function task(taskId: string, state: JuliusTaskState = 'ACTIVE'): TaskRow {
  return { taskId, missionId: 'mission', state, taskType: 'plan', role: 'PROMPT_ARCHITECT' };
}

function harness(tasks: TaskRow[] = [task('run:one:plan')]) {
  const issued = new Issued();
  issued.tasks.push(...tasks);
  const fake = new FakePorts();
  let n = 0;
  const clock = { now: () => NOW };
  const ids = { next: (kind: string) => `${kind}-${++n}` };
  const orch = new JuliusWonderWebVmOrchestrator({
    tasks: issued, registry: fake, sessions: fake, spend: fake, clock, ids,
  });
  return { issued, fake, orch, clock };
}

const openInput = {
  runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', cardLabel: 'Planner',
  allowlistHosts: ['allowed.example'], usdMicros: 10_000, authorization: AUTHORIZED,
};

describe('Julius Wonder Web VM orchestration', () => {
  it('opens one issued task as one session and keeps the title the port returned', async () => {
    const { orch, fake } = harness();
    fake.titles.set('run:one:plan', TITLE);
    const opened = await orch.open(openInput);
    expect(opened.ok).toBe(true);
    expect(opened.vmSessionId).toBe('fake-session-1');
    expect(opened.windowTitle).toBe(TITLE);
    expect(opened.agentId).toBe('fake-agent-1');
    expect(opened.trace.providerResponseId).toBe('fake-response-open-1');
    expect(opened.trace.spend.mechanism).toBe('pr-404-julius-spend-ceiling');
    expect(opened.trace.spend.measuredUsdMicros).toBeNull();
    expect(opened.trace.spend.agentId).toBe('fake-agent-1');
    const registration = fake.ops('register')[0] as { cardLabel: string; accentColourToken: string; taskId: string };
    expect(registration.cardLabel).toBe('Planner');
    expect(registration.accentColourToken).toBe(JULIUS_TERMINAL_ACCENT_TOKEN);
    expect(registration.taskId).toBe('run:one:plan');
    expect(JSON.stringify(opened)).not.toContain(SECRET);
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
    fake.titles.set('run:one:plan', TITLE);
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
    fake.titles.set('run:one:plan', TITLE);
    fake.titles.set('run:one:build', TITLE);
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
    const { orch, fake } = harness();
    const opened = await orch.open(openInput);
    const closed = await orch.closeWindow({
      runId: 'run:one', projectId: 'project', taskId: 'run:one:plan', vmSessionId: opened.vmSessionId!,
    });
    expect(closed.reasonCode).toBe('window_closed');
    expect(fake.ops('terminate')).toHaveLength(0);
    expect(fake.ops('close-window')).toHaveLength(1);
  });

  it.each(['SUCCEEDED', 'FAILED', 'CANCELLED'] as const)('terminates when the card ends %s', async (state) => {
    const { orch, fake, issued } = harness();
    const opened = await orch.open(openInput);
    issued.tasks[0]!.state = state;
    const ended = await orch.onTaskEnded({ runId: 'run:one', projectId: 'project', taskId: 'run:one:plan' });
    expect(ended.reasonCode).toBe('session_terminated');
    expect(ended.trace.spend.state).toBe('NOT_SPENT');
    expect(fake.ops('terminate')).toEqual([{ vmSessionId: opened.vmSessionId, agentId: opened.agentId }]);
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
      { vmSessionId: plan.vmSessionId, agentId: plan.agentId },
      { vmSessionId: build.vmSessionId, agentId: build.agentId },
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

  it('refuses a provider product name in place of the card label', async () => {
    const { orch, fake } = harness();
    const denied = await orch.open({ ...openInput, cardLabel: 'Browserbase' });
    expect(denied.reasonCode).toBe('provider_label_is_not_a_card');
    expect(fake.ops('register')).toHaveLength(0);
  });

  it('does not reserve a second time for the same open session', async () => {
    const { orch, fake } = harness();
    const first = await orch.open(openInput);
    const second = await orch.open(openInput);
    expect(second.vmSessionId).toBe(first.vmSessionId);
    expect(fake.ops('open')).toHaveLength(1);
    expect(fake.ops('reserve')).toHaveLength(1);
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
    expect(fake.ops('terminate')).toEqual([{ vmSessionId: opened.vmSessionId, agentId: opened.agentId }]);
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
    }
  });
});
