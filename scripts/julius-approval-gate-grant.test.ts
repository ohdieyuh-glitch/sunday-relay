/**
 * V6 G-1: A CONTRACT MAY DECLARE AN APPROVAL GATE. IT MAY NOT REGISTER ITS OWN.
 *
 * The research grant's pattern (`julius-live-contract-check.mjs` MISSION_RESEARCH): the gate a mission runs under
 * is pre-registered in a reviewed file, against the mission's own accounting namespace, and the contract's clause
 * must EQUAL it. So the run cannot pick its own gate (or drop one it was registered for) by editing its contract.
 *
 *   no grant, a clause      -> refused: a contract cannot grant itself a gate it was not registered for
 *   a grant, no clause      -> refused: the registered gate is missing from the contract
 *   a grant, unequal clause -> refused
 *   a grant, equal clause   -> accepted (key order does not matter)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MISSION_APPROVAL_GATES, approvalGateProblems } from './julius-approval-gates.mjs';

const problemsOf = approvalGateProblems;

const GATE = {
  id: 'gate-approval-authority-build', operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'],
  reason: 'A change to who may decide an approval needs the governance owner\'s sign-off on the reviewed plan.',
};
const GRANTS = Object.freeze({ 'julius-governance-1': Object.freeze([GATE]) });

describe('V6 G-1: the approval-gate grant, both directions', () => {
  it('no grant and no clause: nothing to say', () => {
    expect(problemsOf('julius-first-live', undefined, GRANTS)).toEqual([]);
  });

  it('a clause with no grant is refused: a contract cannot grant itself a gate', () => {
    const problems = problemsOf('julius-first-live', [GATE], GRANTS);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/a contract cannot grant itself a gate it was not registered for/u);
    expect(problemsOf(null, [GATE], GRANTS)[0], 'no namespace is no grant').toMatch(/not registered for/u);
  });

  it('a grant whose contract lacks the clause is refused: the registered gate cannot be dropped', () => {
    const problems = problemsOf('julius-governance-1', undefined, GRANTS);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/registered approval gate.*missing from the contract/u);
  });

  it('an unequal clause is refused, whatever differs', () => {
    for (const changed of [
      [{ ...GATE, taskTypes: ['build', 'repair:build'] }],
      [{ ...GATE, roles: ['CODING_AGENT', 'INDEPENDENT_REVIEWER'] }],
      [{ ...GATE, reason: 'Something else.' }],
      [{ ...GATE, id: 'gate-other' }],
      [GATE, { ...GATE, id: 'gate-two', taskTypes: ['plan'] }],
      [],
    ]) {
      const problems = problemsOf('julius-governance-1', changed, GRANTS);
      expect(problems, JSON.stringify(changed)).toHaveLength(1);
      expect(problems[0]).toMatch(/does not equal the gate registered for julius-governance-1/u);
    }
  });

  it('an equal clause is accepted, in any key order', () => {
    expect(problemsOf('julius-governance-1', [GATE], GRANTS)).toEqual([]);
    const reordered = [{ reason: GATE.reason, taskTypes: [...GATE.taskTypes], roles: [...GATE.roles], operation: GATE.operation, id: GATE.id }];
    expect(problemsOf('julius-governance-1', reordered, GRANTS)).toEqual([]);
  });

  it('TRIPWIRE: no mission is registered for an approval gate yet; registering one is a deliberate, reviewed edit', () => {
    expect(Object.keys(MISSION_APPROVAL_GATES)).toEqual([]);
    expect(Object.isFrozen(MISSION_APPROVAL_GATES), 'the table cannot be widened at run time').toBe(true);
  });

  it('every committed contract with a clause is registered, and every registration has a contract that declares it', () => {
    const root = join(process.cwd(), '.github', 'julius-missions');
    const declaring: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      let raw: string;
      try { raw = readFileSync(join(root, entry.name, 'contract.json'), 'utf8'); } catch { continue; }
      const contract = JSON.parse(raw) as Record<string, unknown>;
      if (contract.approvalGates !== undefined) declaring.push(entry.name);
      expect(problemsOf(entry.name, contract.approvalGates), `${entry.name} against the committed table`).toEqual([]);
    }
    expect(declaring.sort()).toEqual(Object.keys(MISSION_APPROVAL_GATES).sort());
  });
});

describe('V6 G-1: the contract checker applies the grant', () => {
  const CHECK = 'scripts/julius-live-contract-check.mjs';
  const BASE = {
    missionId: 'mission:gate-1', markerNamespace: 'gate-one', projectId: 'prj-gate', tenantId: 'tenant',
    objective: 'Make the decision name its decider first.', requirements: ['Do it.'], constraints: ['Only there.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'Refusals are tested.', blocking: true }],
    testCommand: 'node --test', workspacePath: join(tmpdir(), 'julius-gate-workspace'), limits: { spendUsd: 5, repairCycles: 1 },
  };
  const runCheck = (contract: unknown): { code: number; output: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-gate-'));
    const path = join(dir, 'contract.json');
    writeFileSync(path, JSON.stringify(contract));
    try {
      return { code: 0, output: execFileSync(process.execPath, [CHECK, path], { cwd: process.cwd(), encoding: 'utf8' }) };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  };

  it('a contract with no clause passes exactly as before, and says it is ungated', () => {
    const result = runCheck(BASE);
    expect(result.output).toContain('CONTRACT OK');
    expect(result.code).toBe(0);
    expect(result.output).toContain('  approval gates: NONE');
  });

  it('RED before G-1: a contract that declares a gate with no registration is refused by the checker', () => {
    const result = runCheck({ ...BASE, approvalGates: [GATE] });
    expect(result.code).toBe(1);
    expect(result.output).toContain('a contract cannot grant itself a gate it was not registered for');
  });
});
