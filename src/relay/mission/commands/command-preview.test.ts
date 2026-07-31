import { describe, expect, it } from 'vitest';

import { DeterministicCommandInterpreter } from './deterministic-command-interpreter';
import { createAuthMissionContext, naturalRequest } from './command-fixtures';
import { validateMissionCommand } from './command-validator';

const interpreter = new DeterministicCommandInterpreter();

function validateText(text: string, context = createAuthMissionContext()) {
  const interpretation = interpreter.interpret(naturalRequest(`req-preview`, text), context);
  if (interpretation.kind !== 'interpreted') throw new Error(`unexpected ${interpretation.kind}`);
  return validateMissionCommand({
    commandId: 'cmd-preview',
    draft: interpretation.commandDraft,
    context,
  });
}

describe('command preview — pure projection of typed command data', () => {
  it('the flagship stop-and-repair preview explains Will / Will Not / Affected / Risk / Approval', () => {
    const result = validateText('Stop Codex and have Claude repair the authentication problem.');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preview = result.preview;

    expect(preview.requestedCommand).toBe(
      'Stop Codex and have Claude repair the authentication problem.',
    );
    expect(preview.interpretation).toContain('reassign');
    expect(preview.interpretation).toContain('cancel');

    const will = preview.relayWill.join(' | ');
    expect(will).toMatch(/checkpoint task-auth-review/u);
    expect(will).toContain('finding-auth-1');
    expect(will).toMatch(/run-codex-review: running → cancelled/u);
    expect(will).toMatch(/task-auth-repair: owner:none → owner:agent-claude/u);
    expect(will).toMatch(/independent re-review/u);

    const willNot = preview.relayWillNot.join(' | ');
    expect(willNot).toContain('allow agent-claude to approve its own repair');
    expect(willNot).toContain('mark verification complete');
    expect(willNot).toContain('mark release eligible');
    expect(willNot).toContain('merge changes');
    expect(willNot).toContain('deploy');

    for (const entity of [
      'task-auth-review', 'task-auth-repair', 'review-auth-r1', 'finding-auth-1',
      'agent-codex', 'agent-claude', 'workspace-auth',
    ]) {
      expect(preview.affectedEntities).toContain(entity);
    }

    expect(preview.risk).toBe('high');
    expect(preview.approval).toBe('required');
    expect(preview.status).toBe('ready_for_confirmation');
    expect(preview.independenceRisk).toBe(true);
  });

  it('a low-risk resume previews as ready to execute without approval', () => {
    const context = createAuthMissionContext();
    const api = context.tasks.find((t) => t.taskId === 'task-api');
    const backend = context.tasks.find((t) => t.taskId === 'task-backend');
    if (backend) backend.status = { ...backend.status, executionStatus: 'completed' };
    context.agentRuns = context.agentRuns.filter((r) => r.taskId !== 'task-backend');
    if (api) api.status = { ...api.status, executionStatus: 'waiting' };
    const result = validateText('Resume the api task.', context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.risk).toBe('low');
    expect(result.preview.approval).toBe('not_required');
    expect(result.preview.status).toBe('ready_to_execute');
    expect(result.preview.relayWill.join(' ')).toMatch(/task-api: waiting → running/u);
  });

  it('a rejected command previews as rejected with its errors and no Will actions', () => {
    const context = createAuthMissionContext();
    const interpretation = interpreter.interpret(
      naturalRequest('req-preview-reject', 'Move the review task to Claude.'),
      context,
    );
    if (interpretation.kind !== 'interpreted') throw new Error('expected interpreted');
    const result = validateMissionCommand({
      commandId: 'cmd-preview-reject',
      draft: interpretation.commandDraft,
      context,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.preview?.status).toBe('rejected');
    expect(result.preview?.relayWill).toEqual([]);
    expect(result.preview?.errors.length).toBeGreaterThan(0);
  });
});
