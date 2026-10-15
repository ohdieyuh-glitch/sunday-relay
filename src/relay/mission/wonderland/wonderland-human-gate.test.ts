import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_GATED_OPERATIONS,
  WONDERLAND_HUMAN_GATE_FIELDS,
  WONDERLAND_HUMAN_GATE_SCHEMA_V1,
  noWonderlandHumanGates,
  scopeWonderlandHumanGate,
  scopeWonderlandHumanGates,
  wonderlandHumanGateBelongs,
} from './wonderland-human-gate';

/**
 * THE ONE MOMENT IN A RUN WHERE A PERSON IS REQUIRED.
 *
 * The kernel already owns the protocol — policy answers REQUIRE_APPROVAL, the
 * gate and the run's block are written in one transaction, the decision records
 * who made it, the run resumes. What is tested here is the PROJECTION: what a
 * world is allowed to be told about a gate, and what it must never be told.
 */

const gate = (over: Record<string, unknown> = {}) => ({
  projectId: 'project-alpha',
  runId: 'run-1',
  gateId: 'gate-1',
  taskId: 'task-1',
  operation: 'SPAWN_SUBAGENT',
  reasonCode: 'CARD_APPROVAL_REQUIRED',
  requestedAtIso: '2026-09-10T00:00:00.000Z',
  ...over,
});

describe('what a world may know about an open gate', () => {
  it('carries the operation, the handles and the instant — and nothing else', () => {
    const scoped = scopeWonderlandHumanGate(gate())!;
    expect(Object.keys(scoped).sort()).toEqual([...WONDERLAND_HUMAN_GATE_FIELDS].sort());
    expect(scoped.schemaVersion).toBe(WONDERLAND_HUMAN_GATE_SCHEMA_V1);
    expect(scoped.operation).toBe('SPAWN_SUBAGENT');
    expect(scoped.gateId).toBe('gate-1');
  });

  it('has no field a sentence or a person could occupy', () => {
    // `JuliusApprovalRecord` carries `safeRationale`, `decisionReason` and
    // `decidedBy`. None of them has a home here, and the constructor's input
    // type cannot be handed them — which is what stops a future edit from
    // copying one across for the best of reasons.
    const scoped = scopeWonderlandHumanGate(gate())!;
    for (const forbidden of ['safeRationale', 'decisionReason', 'decidedBy', 'policyRevision']) {
      expect(Object.keys(scoped)).not.toContain(forbidden);
    }
  });

  it('drops a reason that is not a machine name, rather than drawing it', () => {
    // The kernel's `reason_code` column is free text. A code is a stable token
    // a program compares; a sentence is the shape prose would arrive in if it
    // ever did, and an absence is the honest thing to show instead.
    const prose = scopeWonderlandHumanGate(
      gate({ reasonCode: 'The founder must confirm this write. Ask them in person.' }))!;
    expect(prose.reasonCode).toBe('');

    for (const code of ['CARD_APPROVAL_REQUIRED', 'CARD_SUBAGENT_DEPTH_LIMIT', 'GATE.V2', 'X']) {
      expect(scopeWonderlandHumanGate(gate({ reasonCode: code }))!.reasonCode).toBe(code);
    }
    for (const notACode of ['lowercase', 'has space', 'Mixed_Case', '', '_LEADING']) {
      expect(scopeWonderlandHumanGate(gate({ reasonCode: notACode }))!.reasonCode).toBe('');
    }
  });

  it('drops a reason that is SHAPED like a credential, though capitals and digits pass the code shape (row 12, R4)', () => {
    // An access-key id is all capitals and digits: the shape above admits it, the
    // boundary redactor does not. Assembled at run time: no key-shaped literal here.
    const accessKeyId = ['AK', 'IA'].join('') + 'Q7W8E9R0T1Y2U3I4';
    expect(scopeWonderlandHumanGate(gate({ reasonCode: accessKeyId }))!.reasonCode).toBe('');
    // CONTROL: the same shape that is not a credential still crosses.
    expect(scopeWonderlandHumanGate(gate({ reasonCode: 'CARD_APPROVAL_REQUIRED_2' }))!.reasonCode).toBe('CARD_APPROVAL_REQUIRED_2');
  });

  it('separates a run-level gate from a task gate, and a blank from neither', () => {
    // C.A.R.D. gates run-level operations too, so `taskId` is nullable by
    // design. A BLANK id is not a task and is reported as none — a world
    // grouping by it would otherwise draw a task whose id is the empty string.
    expect(scopeWonderlandHumanGate(gate({ taskId: null }))!.taskId).toBeNull();
    expect(scopeWonderlandHumanGate(gate({ taskId: '   ' }))!.taskId).toBeNull();
    expect(scopeWonderlandHumanGate(gate({ taskId: 'task-9' }))!.taskId).toBe('task-9');
  });

  it('refuses an operation outside the vocabulary instead of inventing one', () => {
    // Landing on the zero member would draw a gate with no boundary on it.
    expect(scopeWonderlandHumanGate(gate({ operation: 'SUMMON_THE_FOUNDER' }))).toBeNull();
    expect(scopeWonderlandHumanGate(gate({ operation: 'spawn_subagent' }))).toBeNull();
  });

  it('accepts every operation C.A.R.D. can gate', () => {
    for (const operation of WONDERLAND_GATED_OPERATIONS) {
      expect(scopeWonderlandHumanGate(gate({ operation })), operation).not.toBeNull();
    }
  });
});

describe('a run\'s open gates, as a set', () => {
  it('COUNTS what it could not describe rather than subtracting it', () => {
    // A world showing one gate fewer is drawing a run that is not waiting on
    // anybody, and that reads as a run which is merely slower. The gap is the
    // report, exactly as it is for a Project Brain kind with no bucket.
    const scoped = scopeWonderlandHumanGates([
      gate(),
      gate({ gateId: 'gate-2', operation: 'SUMMON_THE_FOUNDER' }),
      gate({ gateId: 'gate-3', operation: 'ACCESS_NETWORK' }),
    ]);
    expect(scoped.gates.map((g) => g.gateId)).toEqual(['gate-1', 'gate-3']);
    expect(scoped.undescribed).toBe(1);
  });

  it('says NOTHING IS GATED without saying nobody looked', () => {
    // The absence lives on the count beside the list — `pendingApprovals` is
    // the nullable carrier — so an empty list here is a fact.
    expect(noWonderlandHumanGates().gates).toEqual([]);
    expect(noWonderlandHumanGates().undescribed).toBe(0);
    expect(scopeWonderlandHumanGates([]).gates).toEqual([]);
  });

  it('is frozen, so an adopted set cannot be edited underneath a world', () => {
    const scoped = scopeWonderlandHumanGates([gate()]);
    expect(Object.isFrozen(scoped)).toBe(true);
    expect(Object.isFrozen(scoped.gates)).toBe(true);
    expect(Object.isFrozen(scoped.gates[0])).toBe(true);
  });
});

describe('a gate belongs to exactly one run', () => {
  it('refuses one from another project, another run, or another schema', () => {
    const scoped = scopeWonderlandHumanGate(gate())!;
    expect(wonderlandHumanGateBelongs(scoped, 'project-alpha', 'run-1')).toBe(true);
    expect(wonderlandHumanGateBelongs(scoped, 'project-beta', 'run-1')).toBe(false);
    expect(wonderlandHumanGateBelongs(scoped, 'project-alpha', 'run-9')).toBe(false);
    expect(wonderlandHumanGateBelongs(
      { ...scoped, schemaVersion: 'relay-wonderland-human-gate.v2' } as never,
      'project-alpha', 'run-1',
    )).toBe(false);
  });
});

describe('the vocabulary is provider-free, like every other one on this seam', () => {
  it('names no model, provider or product', () => {
    const serialised = JSON.stringify(WONDERLAND_GATED_OPERATIONS).toLowerCase();
    for (const name of ['gpt', 'claude', 'hermes', 'openai', 'anthropic', 'xai', 'gemini', 'codex']) {
      expect(serialised, `the gate vocabulary mentions ${name}`).not.toContain(name);
    }
  });

  it('names kinds of ACTION, not instructions to a person', () => {
    // A worker never commands the user. The vocabulary is what C.A.R.D. GATES,
    // so every member reads as a capability boundary rather than as an
    // imperative addressed to somebody.
    for (const operation of WONDERLAND_GATED_OPERATIONS) {
      expect(operation).toMatch(/^[A-Z][A-Z_]*$/);
      expect(operation).not.toContain('PLEASE');
      expect(operation).not.toContain('YOU');
    }
  });
});
