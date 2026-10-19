/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { RelayMissionRunControls } from './RelayMissionRunControls';
import {
  DeterministicCommandInterpreter,
  InMemoryMissionCommandRepository,
  InMemoryMissionContextStore,
  type CommandAgentRunContext,
  type RelayMissionCommandContext,
} from '../../mission/commands';
import { createAuthMissionContext } from '../../mission/commands/command-fixtures';
import type { MissionRunCommandDeps } from './mission-pause-resume';
import { projectMissionRunControls } from './mission-run-controls';
import { projectWorkspaceDogBehavior } from '../relay-dog-motion';
import { officialRelayDogViewForState } from '../official-relay-dog';

/**
 * WEBSITE MISSION RUN CONTROLS — visibility, accessibility, layout and dog
 * integration.
 *
 * Every click drives the REAL Milestone 2 command path. Nothing is stubbed to
 * succeed. Deterministic clock and ids; no provider, no adapter, no network.
 */

const NOW = '2026-07-28T12:00:00.000Z';

afterEach(cleanup);

function makeDeps(context: RelayMissionCommandContext, requestId = 'cmd-ui-1'): MissionRunCommandDeps {
  const contextStore = new InMemoryMissionContextStore();
  contextStore.save(context);
  let n = 0;
  return {
    interpreter: new DeterministicCommandInterpreter(),
    repository: new InMemoryMissionCommandRepository(),
    contextStore,
    now: () => NOW,
    requestId: () => `${requestId}-${++n}`,
    actorUserId: 'user-founder',
    projectId: 'project-sunday',
    missionId: 'mission-auth',
  };
}

function singleTaskContext(input: {
  execution: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  run?: Partial<CommandAgentRunContext> | null;
  missionExecution?: 'running' | 'completed' | 'failed' | 'cancelled';
}): RelayMissionCommandContext {
  const base = createAuthMissionContext();
  const run: CommandAgentRunContext | null = input.run === null ? null : {
    runId: 'run-ui',
    taskId: 'task-backend',
    requestedAgentId: 'agent-hermes',
    actualAgentId: 'agent-hermes',
    state: input.execution === 'running' ? 'running' : 'waiting',
    partialWork: {
      changedFiles: [], commandsRun: 0, testsRun: 0, knownErrors: [],
      findingIds: [], unresolvedQuestions: [], costConsumedUsd: 0,
    },
    childProcessRefs: [],
    checkpointStatus: 'none',
    ...(input.run ?? {}),
  };
  return {
    ...base,
    mission: {
      ...base.mission,
      status: {
        ...base.mission.status,
        executionStatus: input.missionExecution ?? base.mission.status.executionStatus,
      },
    },
    tasks: base.tasks
      .filter((t) => t.taskId === 'task-backend')
      .map((t) => ({
        ...t,
        workspaceId: null,
        status: { ...t.status, executionStatus: input.execution },
      })),
    agentRuns: run ? [run] : [],
  };
}

function mount(context: RelayMissionCommandContext, props: Record<string, unknown> = {}) {
  const deps = makeDeps(context);
  const utils = render(<RelayMissionRunControls deps={deps} {...props} />);
  return { ...utils, deps };
}

const pauseButton = () => screen.queryByRole('button', { name: /^PAUS/ });
const resumeButton = () => screen.queryByRole('button', { name: /^RESUM/ });

/* ---------------------------- control visibility ------------------------ */

describe('control visibility', () => {
  it('a running mission shows PAUSE and not RESUME', () => {
    mount(singleTaskContext({ execution: 'running' }));
    expect(pauseButton()).not.toBeNull();
    expect(resumeButton()).toBeNull();
  });

  it('a waiting/paused mission shows RESUME and not PAUSE', () => {
    mount(singleTaskContext({ execution: 'waiting' }));
    expect(resumeButton()).not.toBeNull();
    expect(pauseButton()).toBeNull();
  });

  it('a terminal mission shows neither control', () => {
    for (const state of ['completed', 'failed', 'cancelled'] as const) {
      mount(singleTaskContext({ execution: 'running', missionExecution: state }));
      expect(pauseButton(), state).toBeNull();
      expect(resumeButton(), state).toBeNull();
      cleanup();
    }
  });

  it('a waiting task on a terminal run shows no RESUME and says why', () => {
    for (const runState of ['completed', 'failed', 'cancelled'] as const) {
      const context = singleTaskContext({ execution: 'waiting', run: { state: runState } });
      const controls = projectMissionRunControls({ context });
      expect(controls.resume.visible, runState).toBe(false);
      expect(controls.resume.disabledReason, runState).toContain(runState);
      expect(controls.resume.disabledReason, runState).toMatch(/retry or reassign/);
    }
  });

  it('timed-out and orphaned capsules also hide RESUME', () => {
    for (const capsule of ['timed_out', 'orphaned']) {
      const context = singleTaskContext({ execution: 'waiting' });
      const controls = projectMissionRunControls({
        context, capsuleStatuses: { 'run-ui': capsule },
      });
      expect(controls.resume.visible, capsule).toBe(false);
      expect(controls.resume.disabledReason, capsule).toContain(capsule);
    }
  });

  it('hides the control rather than rendering a clickable dead button', () => {
    const context = singleTaskContext({ execution: 'waiting', run: { state: 'completed' } });
    mount(context);
    expect(resumeButton()).toBeNull();
    expect(pauseButton()).toBeNull();
  });

  it('a missing command permission disables the control with an exact reason', () => {
    mount(singleTaskContext({ execution: 'running' }), { canIssueCommands: false });
    const button = pauseButton();
    expect(button).not.toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/do not have permission to issue mission commands/i)).toBeTruthy();
  });
});

/* --------------------------- duplicate protection ----------------------- */

describe('duplicate submission protection', () => {
  it('a second PAUSE click while one is in flight does nothing new', () => {
    const { deps } = mount(singleTaskContext({ execution: 'running' }));
    fireEvent.click(pauseButton()!);
    // The preview is up and the control now reports PAUSING and is disabled.
    const busy = pauseButton()!;
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.textContent).toBe('PAUSING');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(busy);
    fireEvent.click(busy);
    // Exactly one command exists — no duplicates were submitted.
    expect(deps.repository.getCommand('cmd-ui-1-1')).not.toBeNull();
    expect(deps.repository.getCommand('cmd-ui-1-2')).toBeNull();
  });

  it('a second RESUME click while one is in flight does nothing new', () => {
    const { deps } = mount(singleTaskContext({ execution: 'waiting' }));
    fireEvent.click(resumeButton()!);
    const busy = resumeButton()!;
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.textContent).toBe('RESUMING');
    fireEvent.click(busy);
    expect(deps.repository.getCommand('cmd-ui-1-2')).toBeNull();
  });
});

/* ------------------------------- the flow ------------------------------- */

describe('pause flow', () => {
  it('previews before applying, then applies only on confirm', () => {
    const { deps } = mount(singleTaskContext({ execution: 'running' }));
    fireEvent.click(pauseButton()!);

    // Preview from the Milestone 2 projection — nothing applied yet.
    expect(screen.getByText('CONFIRM PAUSE')).toBeTruthy();
    expect(screen.getByText('RELAY WILL')).toBeTruthy();
    expect(screen.getByText('RELAY WILL NOT')).toBeTruthy();
    expect(deps.contextStore.get('mission-auth')!.tasks[0].status.executionStatus)
      .toBe('running');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm pause' }));
    expect(deps.contextStore.get('mission-auth')!.tasks[0].status.executionStatus)
      .toBe('waiting');
    // And it states the exact limitation rather than claiming more.
    expect(screen.getByText(/is not suspended by Relay/)).toBeTruthy();
  });

  it('cancelling the preview applies nothing and restores the control', () => {
    const { deps } = mount(singleTaskContext({ execution: 'running' }));
    fireEvent.click(pauseButton()!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deps.contextStore.get('mission-auth')!.tasks[0].status.executionStatus)
      .toBe('running');
    expect((pauseButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('surfaces a checkpoint requirement and applies nothing until captured', () => {
    // The stock fixture's runs carry partial work + child processes.
    const { deps } = mount(createAuthMissionContext());
    fireEvent.click(pauseButton()!);
    expect(screen.getByText('CHECKPOINT REQUIRED')).toBeTruthy();
    const before = deps.contextStore.get('mission-auth')!;
    expect(before.tasks.find((t) => t.taskId === 'task-backend')!.status.executionStatus)
      .toBe('running');

    for (const button of screen.getAllByRole('button', { name: 'Capture checkpoint' })) {
      fireEvent.click(button);
    }
    const after = deps.contextStore.get('mission-auth')!;
    expect(after.tasks.find((t) => t.taskId === 'task-backend')!.status.executionStatus)
      .toBe('waiting');
  });

  it('after a successful pause the control flips to RESUME', () => {
    mount(singleTaskContext({ execution: 'running' }));
    fireEvent.click(pauseButton()!);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm pause' }));
    expect(resumeButton()).not.toBeNull();
    expect(pauseButton()).toBeNull();
  });
});

describe('resume flow', () => {
  it('returns execution to running and flips back to PAUSE', () => {
    const { deps } = mount(singleTaskContext({ execution: 'waiting' }));
    fireEvent.click(resumeButton()!);
    expect(screen.getByText('CONFIRM RESUME')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resume' }));
    expect(deps.contextStore.get('mission-auth')!.tasks[0].status.executionStatus)
      .toBe('running');
    expect(pauseButton()).not.toBeNull();
    expect(resumeButton()).toBeNull();
  });

  it('notifies the host that the mission context changed', () => {
    const onContextChanged = vi.fn();
    mount(singleTaskContext({ execution: 'waiting' }), { onContextChanged });
    fireEvent.click(resumeButton()!);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resume' }));
    expect(onContextChanged).toHaveBeenCalledTimes(1);
    expect(onContextChanged.mock.calls[0][0].tasks[0].status.executionStatus).toBe('running');
  });
});

/* ----------------------------- accessibility ---------------------------- */

describe('accessibility and safety of displayed text', () => {
  it('both controls have accessible names and expose pending state', () => {
    mount(singleTaskContext({ execution: 'running' }));
    const pause = pauseButton()!;
    expect(pause.textContent).toBe('PAUSE');
    expect(pause.getAttribute('aria-busy')).toBe('false');
    fireEvent.click(pause);
    expect(pauseButton()!.getAttribute('aria-busy')).toBe('true');
    expect(pauseButton()!.textContent).toBe('PAUSING');
  });

  it('a disabled control links its reason with aria-describedby', () => {
    mount(singleTaskContext({ execution: 'running' }), { canIssueCommands: false });
    const pause = pauseButton()!;
    expect(pause.getAttribute('aria-disabled')).toBe('true');
    const describedBy = pause.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)!.textContent)
      .toMatch(/do not have permission/i);
  });

  it('the run controls region is labelled', () => {
    mount(singleTaskContext({ execution: 'running' }));
    expect(screen.getByLabelText('Mission run controls')).toBeTruthy();
  });

  it('a structured failure is announced and shows the domain reason', () => {
    const context = singleTaskContext({ execution: 'running' });
    const deps = makeDeps(context, 'cmd-dup');
    // Force a duplicate: the id factory returns the same id twice.
    const fixedDeps = { ...deps, requestId: () => 'cmd-fixed' };
    render(<RelayMissionRunControls deps={fixedDeps} confirmBeforeExecute={false} />);
    fireEvent.click(pauseButton()!);
    // Now waiting; nothing to pause. Trigger the same id again via RESUME.
    fireEvent.click(resumeButton()!);
    const alert = screen.queryByRole('alert');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toBeTruthy();
    expect(alert!.textContent).not.toMatch(/something went wrong/i);
    expect(alert!.textContent).not.toMatch(/\bat .*\(.*:\d+:\d+\)/);
  });

  it('never renders a stack trace or a secret-shaped value', () => {
    const { container } = mount(createAuthMissionContext());
    fireEvent.click(pauseButton()!);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\bat .*\(.*:\d+:\d+\)/);
    // Boundary-anchored: a task id like `task-backend` legitimately contains
    // "sk-" once textContent concatenates it with the next label.
    expect(text).not.toMatch(/(?<![A-Za-z0-9])sk-[A-Za-z0-9]{16,}/);
    expect(text).not.toMatch(/(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{20,}/);
    expect(text).not.toMatch(/Error:\s/);
  });
});

/* -------------------------------- layout -------------------------------- */

describe('layout', () => {
  it('never introduces horizontal overflow (no fixed widths, wrapping rows)', () => {
    const css = readFileSync(
      join(process.cwd(), 'src', 'relay', 'ui', 'mission-control', 'relay-mission-run-controls.css'),
      'utf8',
    );
    expect(css).toContain('flex-wrap: wrap');
    expect(css).toContain('max-width: 100%');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('@media (max-width: 720px)');
    // A fixed pixel width would break the mobile column.
    expect(css).not.toMatch(/(?<![a-z-])width:\s*\d{3,}px/);
  });

  it('renders inside its host without wrapping the whole console', () => {
    const { container } = mount(singleTaskContext({ execution: 'running' }));
    const root = container.querySelector('.rmrc')!;
    expect(root).not.toBeNull();
    // The controls are a self-contained region, not a new full-width panel.
    expect(root.className).toBe('rmrc');
    expect(container.querySelectorAll('.rmrc').length).toBe(1);
  });
});

/* ---------------------------- dog integration --------------------------- */

describe('Relay Dog integration', () => {
  it('the paused state maps to the approved waiting behavior with patrol OFF', () => {
    const behavior = projectWorkspaceDogBehavior('waiting_for_user');
    expect(behavior.patrolEnabled).toBe(false);
    expect(behavior.attentionRequired).toBe(true);
    const view = officialRelayDogViewForState('waiting_for_user');
    expect(view.motion).toBe('attention_jump');
    expect(view.pose).toBe('sitting');
  });

  it('a running mission does not sit in idle patrol', () => {
    expect(projectWorkspaceDogBehavior('implementing').patrolEnabled).toBe(false);
    expect(projectWorkspaceDogBehavior('trotting').patrolEnabled).toBe(false);
    // Only idle patrols, and idle is not a pause/resume state.
    expect(projectWorkspaceDogBehavior('wandering').patrolEnabled).toBe(true);
  });

  it('the controls never issue the command from the dog, and append no trace events', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'relay', 'ui', 'mission-control', 'RelayMissionRunControls.tsx'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // No dog module drives a command, and no component appends an event.
    expect(code).not.toMatch(/relay-dog-motion|useRelayDogPatrol|RelayPixelDog/);
    expect(code).not.toMatch(/appendEvent|createCommandEvent|traceLedger/i);
    // Mission state is never mutated here — only the domain applies changes.
    expect(code).not.toMatch(/executionStatus\s*=/);
    expect(code).not.toMatch(/contextStore\.commit/);
  });
});

/* --------------------------- source-level safety ------------------------ */

describe('source-level safety boundary', () => {
  it('the command layer never applies state itself and never calls out', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'relay', 'ui', 'mission-control', 'mission-pause-resume.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/fetch\(|XMLHttpRequest|axios/);
    expect(code).not.toMatch(/Date\.now\(\)|new Date\(\)|Math\.random/);
    expect(code).not.toMatch(/from\s+['"]node:/);
    expect(code).not.toMatch(/contextStore\.commit/);   // only the executor commits
    // It goes through the validated protocol, not around it.
    expect(code).toContain('submitMissionCommand');
    expect(code).toContain('executeMissionCommand');
    expect(code).toContain('resolveCommandPrerequisite');
  });
});
