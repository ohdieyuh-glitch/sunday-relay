/**
 * V6 G-1: THE MISSION CONTRACT DECLARES ITS APPROVAL GATE, AND THE CARD IT RUNS UNDER CARRIES IT.
 *
 * Before this, `assembleLiveJuliusRuntime` could hold a dispatch for a person
 * (`approvals`, and since G-2 `approvalScopes`), but the live entrypoint had
 * nothing to pass it: the contract had no clause, so every paid mission ran
 * ungated. The clause is parsed and SEALED here, like `research`, so a malformed
 * gate refuses the mission before anything is submitted; it reaches the card
 * as `approvalScopes`, and the card's revision carries its digest, so an answer
 * given under one gate never authorises a dispatch under another.
 *
 * ABSENT MEANS UNGATED, BYTE FOR BYTE. Every committed contract parses to the
 * same object and the same `missionBindingDigest` as before the clause existed
 * (the literals below were printed by the pre-change code, by command).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  approvalScopesOf,
  compileBootstrapRequest,
  gatedCardRevision,
  parseLiveMissionContract,
  type LiveMissionApprovalGate,
} from './mission-contract';
import { liveApprovalGatesLine } from './live-report-lines';

const ROOT = join(__dirname, '..', '..');
const BASE = {
  missionId: 'mission:gate-1', markerNamespace: 'gate-one', projectId: 'prj-gate', tenantId: 'tenant',
  objective: 'Make the decision name its decider first.', requirements: ['Do it.'], constraints: ['Only there.'],
  acceptanceCriteria: [{ id: 'AC-1', text: 'Refusals are tested.', blocking: true }],
  testCommand: 'node --test', workspacePath: '/tmp/julius-workspace/tenant/ws', limits: { spendUsd: 20, repairCycles: 2 },
};
const GATE: LiveMissionApprovalGate = {
  id: 'gate-approval-authority-build', operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'],
  reason: 'A change to who may decide an approval needs the governance owner\'s sign-off on the reviewed plan.',
};
const parse = (value: unknown) => parseLiveMissionContract(JSON.stringify(value));
const refusal = (gates: unknown): string => {
  const parsed = parse({ ...BASE, approvalGates: gates });
  expect(parsed.ok, `refused: ${JSON.stringify(gates)}`).toBe(false);
  return parsed.ok ? '' : parsed.problem;
};

describe('V6 G-1: the approvalGates clause is parsed and sealed, or the contract is refused', () => {
  it('RED before G-1: a valid clause survives the parse, exactly as written', () => {
    const parsed = parse({ ...BASE, approvalGates: [GATE] });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.contract.approvalGates).toEqual([GATE]);
  });

  it('two gates are allowed; a third is refused, and an empty clause is refused', () => {
    const second = { ...GATE, id: 'gate-review', roles: ['INDEPENDENT_REVIEWER'], taskTypes: ['review'] };
    expect(parse({ ...BASE, approvalGates: [GATE, second] }).ok).toBe(true);
    expect(refusal([GATE, second, { ...second, id: 'gate-three', taskTypes: ['plan'] }])).toMatch(/1 or 2 gates/u);
    expect(refusal([])).toMatch(/1 or 2 gates/u);
    expect(refusal({ ...GATE })).toMatch(/must be an array/u);
    expect(refusal(null)).toMatch(/must be an array/u);
  });

  it('each refusal names its problem', () => {
    expect(refusal([{ ...GATE, extra: true }])).toMatch(/unknown key "extra"/u);
    expect(refusal([{ ...GATE, operation: 'USE_CAPABILITY' }])).toMatch(/operation must be DISPATCH_WORKER/u);
    expect(refusal([{ ...GATE, roles: ['ROBOT'] }])).toMatch(/role "ROBOT" is not a role Julius can resolve/u);
    expect(refusal([{ ...GATE, roles: ['SPECIALIST:'] }])).toMatch(/is not a role Julius can resolve/u);
    expect(refusal([{ ...GATE, roles: [] }])).toMatch(/roles must be a non-empty array/u);
    expect(refusal([{ ...GATE, taskTypes: [] }])).toMatch(/taskTypes must be a non-empty array/u);
    expect(refusal([{ ...GATE, taskTypes: ['*'] }])).toMatch(/wildcard or empty task type/u);
    expect(refusal([{ ...GATE, taskTypes: ['build*'] }])).toMatch(/wildcard or empty task type/u);
    expect(refusal([{ ...GATE, taskTypes: [''] }])).toMatch(/wildcard or empty task type/u);
    expect(refusal([{ ...GATE, taskTypes: [7] }])).toMatch(/wildcard or empty task type/u);
    expect(refusal([{ ...GATE, id: 'Gate One' }])).toMatch(/id must be/u);
    expect(refusal([{ ...GATE, reason: '' }])).toMatch(/reason must be 1-280 characters/u);
    expect(refusal([{ ...GATE, reason: 'x'.repeat(281) }])).toMatch(/reason must be 1-280 characters/u);
    expect(refusal([GATE, { ...GATE, taskTypes: ['plan'] }])).toMatch(/duplicate gate id "gate-approval-authority-build"/u);
    expect(refusal([GATE, { ...GATE, id: 'gate-other' }])).toMatch(/duplicate role and task type CODING_AGENT\/build/u);
    expect(refusal([{ ...GATE, taskTypes: ['build', 'build'] }])).toMatch(/duplicate role and task type CODING_AGENT\/build/u);
    expect(refusal(['gate'])).toMatch(/must be an object/u);
  });

  it('CONTROL, byte identity: every committed contract parses with no approvalGates key, to the pre-change digest', () => {
    // Printed by the pre-change mission-contract.ts (scratchpad v6build/digests.mjs at 1bff1110), never retyped.
    const BEFORE: Readonly<Record<string, string>> = {
      'julius-continuous-1': 'sha256:e6814f7ce2167785052595c60f89aec2ea6bb84bf6f411105e86f317fe02d80a',
      'julius-first-live': 'sha256:f7f8c2fe683cba5819ecc9e71085228ce8bf82f3e1b7f9c2b6862f2e28346a56',
      'julius-live-mission-2': 'sha256:4bf13d0e833a042c74f57555aa7fc520aab8941b5bc621dcef35c975b87b714b',
      'julius-live-mission-3': 'sha256:132b1d96d9eebad0ecf386d541169559057ecc2c93aa7cce7853ed9f2eb5a723',
      'julius-live-mission-4': 'sha256:90967fc2b4726240de490d7bfd97a73a9398352fdf71e777a682abbfd3005ecc',
      'julius-live-mission-5': 'sha256:cecba99c779c967f128dd58c58de5d362e5da37afef2a7974f9fface4b44cc80',
      'julius-live-mission-6': 'sha256:efb6e20f0d11885bc5085a6835d5d27ef0441dfebf14480d0972fdee07ecf71b',
    };
    const dir = join(ROOT, '.github', 'julius-missions');
    const seen: string[] = [];
    for (const name of readdirSync(dir).sort()) {
      let raw: string;
      try { raw = readFileSync(join(dir, name, 'contract.json'), 'utf8'); } catch { continue; }
      const parsed = parseLiveMissionContract(raw);
      expect(parsed.ok, `${name} parses`).toBe(true);
      if (!parsed.ok) throw new Error(parsed.problem);
      expect('approvalGates' in parsed.contract, `${name}: an ungated contract carries no approvalGates key`).toBe(false);
      expect(compileBootstrapRequest(parsed.contract, [], 'card:julius-live:1').missionBindingDigest, `${name}: the same digest as before G-1`).toBe(BEFORE[name]);
      seen.push(name);
    }
    expect(seen, 'every committed contract is covered, and no literal is stale').toEqual(Object.keys(BEFORE).sort());
  });

  it('the clause is BOUND: a gated contract digests differently from the same contract ungated', () => {
    const gated = parse({ ...BASE, approvalGates: [GATE] });
    const plain = parse(BASE);
    if (!gated.ok || !plain.ok) throw new Error('fixture refused');
    expect(compileBootstrapRequest(gated.contract, [], 'c').missionBindingDigest)
      .not.toBe(compileBootstrapRequest(plain.contract, [], 'c').missionBindingDigest);
  });

  it('the card revision carries the clause digest: stable under key order, absent when ungated, in the approval-id alphabet', () => {
    const base = 'card:julius-live:1';
    expect(gatedCardRevision(base, undefined), 'ungated: the revision is untouched').toBe(base);
    const gated = gatedCardRevision(base, [GATE]);
    expect(gated).toMatch(/^card:julius-live:1:gate-[0-9a-f]{16}$/u);
    expect(gated).toMatch(/^[\w:.-]+$/u);
    const reordered = JSON.parse(JSON.stringify({ reason: GATE.reason, taskTypes: GATE.taskTypes, roles: GATE.roles, operation: GATE.operation, id: GATE.id })) as LiveMissionApprovalGate;
    expect(gatedCardRevision(base, [reordered]), 'key order does not change the revision').toBe(gated);
    expect(gatedCardRevision(base, [{ ...GATE, taskTypes: ['plan'] }]), 'a different gate is a different revision').not.toBe(gated);
  });

  it('the clause becomes the card\'s approvalScopes: operation, roles and task types, nothing else', () => {
    expect(approvalScopesOf([GATE])).toEqual([{ operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'] }]);
  });

  it('the preflight line says what is gated, and the evidence allowlist keeps exactly that shape', () => {
    expect(liveApprovalGatesLine(undefined), 'ungated: no line at all').toBeNull();
    const one = liveApprovalGatesLine([GATE])!;
    expect(one).toBe('  approval gates: 1 (DISPATCH_WORKER role=CODING_AGENT task=build)');
    const two = liveApprovalGatesLine([GATE, { ...GATE, id: 'gate-b', roles: ['INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT'], taskTypes: ['review', 'plan'] }])!;
    expect(two).toBe('  approval gates: 2 (DISPATCH_WORKER role=CODING_AGENT task=build; DISPATCH_WORKER role=INDEPENDENT_REVIEWER,PROMPT_ARCHITECT task=review,plan)');
    const kept = execFileSync(process.execPath, ['scripts/julius-live-evidence.mjs', '-'], {
      cwd: ROOT, input: [one, two, `${one} and more`].join('\n'), encoding: 'utf8',
    });
    expect(kept.split('\n')).toEqual(expect.arrayContaining([one, two]));
    expect(kept, 'a free suffix is dropped').not.toContain(`${one} and more`);
  });
});

describe('V6 G-1: the live entrypoint passes the clause to the runtime, and only when present', () => {
  const ENTRY = readFileSync(join(ROOT, 'relay-bridge', 'julius-live-mission.ts'), 'utf8');

  it('RED before G-1: the card revision is the gated revision, computed from the clause', () => {
    expect(ENTRY).toMatch(/const cardRevision = gatedCardRevision\(env\.RELAY_JULIUS_CARD_REVISION\?\.trim\(\) \|\| 'card:julius-live:1', contract\.approvalGates\);/u);
  });

  it('RED before G-1: assembleLiveJuliusRuntime receives approvalScopes behind the clause guard, and never the unscoped list', () => {
    const at = ENTRY.indexOf('const runtime = assembleLiveJuliusRuntime({');
    expect(at, 'the assembly must be found, or this pin is vacuous').toBeGreaterThan(0);
    const call = ENTRY.slice(at, ENTRY.indexOf('});', at));
    expect(call).toContain('...(contract.approvalGates === undefined ? {} : { approvalScopes: approvalScopesOf(contract.approvalGates) })');
    expect(call, 'an unscoped gate would hold every dispatch').not.toMatch(/\bapprovals:/u);
  });

  it('the preflight prints the gate line only when the clause is present', () => {
    expect(ENTRY).toContain('const gatesLine = liveApprovalGatesLine(contract.approvalGates);');
    expect(ENTRY).toContain('if (gatesLine !== null) out(gatesLine);');
  });
});
