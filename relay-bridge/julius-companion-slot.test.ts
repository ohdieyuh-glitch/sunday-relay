import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateArchitectPlan } from '../src/relay/mission/prompt-architect/prompt-architect-plan';
import {
  readCompanionTask, runJuliusCompanionSlot,
  type ChangeReviewPort, type CoderIntegrationPort, type CompanionPort, type CompanionWakeResult, type JuliusValidationPort,
} from './julius-companion-slot';

const SERVER = `run:${'ab'.repeat(12)}`;
const OTHER = `run:${'cd'.repeat(12)}`;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const task = (over: Record<string, unknown> = {}) => ({
  subtask: 'Add the companion note to the fixture.',
  acceptanceCriteria: ['The fixture names the companion note.'],
  ...over,
});

const plan = (companion: unknown) => ({ objectiveSummary: 'Plan the fixture.', companion_task: companion });

/** A deadline that does not win the race. Unref'd so a finished test can exit. */
const later = (): Promise<void> => new Promise((resolve) => { const timer = setTimeout(resolve, 30_000); timer.unref(); });

const ports = (over: {
  readonly wake?: CompanionPort['wake'];
  readonly submit?: CoderIntegrationPort['submit'];
  readonly validate?: JuliusValidationPort['validate'];
  readonly review?: ChangeReviewPort['review'];
  readonly after?: () => Promise<void>;
} = {}) => {
  const calls = { wake: 0, submit: 0, validate: 0, review: 0 };
  const integrate: CoderIntegrationPort = {
    submit: async (input) => { calls.submit += 1; return over.submit === undefined ? { accepted: true, reason: null } : over.submit(input); },
  };
  const validate: JuliusValidationPort = {
    validate: (input) => { calls.validate += 1; return over.validate === undefined ? { ok: true, reason: null } : over.validate(input); },
  };
  const review: ChangeReviewPort = {
    review: async (input) => { calls.review += 1; return over.review === undefined ? { verdict: 'approve' } : over.review(input); },
  };
  const port: CompanionPort = {
    wake: (request) => { calls.wake += 1; return over.wake === undefined ? Promise.resolve({ wakeId: 'wake_01ABCDEF', outcome: 'posted', artifact: { bytes: new TextEncoder().encode('fixture') } }) : over.wake(request); },
  };
  return { calls, integrate, validate, review, port, clock: { after: over.after ?? later } };
};

const run = (companion: unknown, built = ports(), deadlineMs = 1_000) => runJuliusCompanionSlot({
  plan: plan(companion), serverRunId: SERVER, deadlineMs, port: built.port, clock: built.clock,
  integrate: built.integrate, validate: built.validate, review: built.review,
});

const architectPlan = (companion?: unknown) => ({
  objectiveSummary: 'Implement the mission fixture change.',
  assumptions: [{ id: 'A1', statement: 'The fixture exists.', confidence: 'medium' }],
  unresolvedQuestions: [],
  requirements: [{ id: 'R1', statement: 'It must pass.', rationale: 'The contract says so.' }],
  architectureDecisions: [{ id: 'D1', decision: 'Edit in place.', rationale: 'Smallest change.', alternativesConsidered: [], accepted: false }],
  implementationSteps: [{ order: 1, description: 'Edit the fixture.', filesTouched: ['fixtures/a.ts'] }],
  acceptanceCriteria: ['AC-1'], testPlan: ['npm test'],
  risks: [{ id: 'RISK1', risk: 'None material.', mitigation: 'Review.', severity: 'low' }],
  prohibitedActions: [], proposedContractAmendments: [], contextRefs: [],
  handoff: {
    objective: 'Implement the fixture change.',
    boundedTask: 'Edit exactly the fixture files and make the test pass.',
    acceptanceCriteria: ['AC-1'], requiredTests: ['npm test'],
    allowedFileScope: ['fixtures/'], prohibitedActions: [], grantedTools: [],
    missionContractRef: 'contract-1', environmentRef: null, expectedEvidence: ['TEST'],
  },
  ...(companion === undefined ? {} : { companion_task: companion }),
});

describe('companion task on an architect plan', () => {
  it('a plan with no companion task is valid and wakes nothing', async () => {
    expect(validateArchitectPlan(architectPlan()).ok).toBe(true);
    expect(readCompanionTask(architectPlan(), SERVER)).toEqual({ kind: 'absent' });
    const built = ports();
    const result = await runJuliusCompanionSlot({
      plan: architectPlan(), serverRunId: SERVER, deadlineMs: 1_000, port: built.port, clock: built.clock,
      integrate: built.integrate, validate: built.validate, review: built.review,
    });
    expect(result.missionContinues).toBe(true);
    expect(result.spendUsdMicros).toBe(0);
    expect(result.evidence).toMatchObject({ disposition: 'absent', wakeId: null, bodyDigest: null, artifactHashes: [] });
    expect(built.calls.wake).toBe(0);
  });

  it('refuses a second companion task and does not wake', async () => {
    const two = [task(), task({ subtask: 'A second subtask that must not run.' })];
    expect(validateArchitectPlan(architectPlan(two)).ok).toBe(true);
    expect(readCompanionTask(plan(two), SERVER)).toMatchObject({ kind: 'refused', reason: 'second_companion_task_refused' });
    const bothKeys = { objectiveSummary: 'Plan the fixture.', companion_task: task(), companion_tasks: [task()] };
    expect(readCompanionTask(bothKeys, SERVER)).toMatchObject({ kind: 'refused', reason: 'second_companion_task_refused' });
    const built = ports();
    const result = await run(two, built);
    expect(result.missionContinues).toBe(true);
    expect(result.evidence.disposition).toBe('refused');
    expect(result.evidence.reason).toBe('second_companion_task_refused');
    expect(built.calls.wake).toBe(0);
  });

  it('refuses a task stamped for a different run', async () => {
    const built = ports();
    const result = await run(task({ serverRunId: OTHER }), built);
    expect(result.evidence).toMatchObject({ disposition: 'refused', reason: 'companion_task_run_mismatch' });
    expect(built.calls.wake).toBe(0);
  });
});

describe('a companion that does not deliver', () => {
  it('times out and the mission still passes, with no retry and no late artifact', async () => {
    let late: (result: CompanionWakeResult) => void = () => {};
    const hung = new Promise<CompanionWakeResult>((resolve) => { late = resolve; });
    const built = ports({ wake: () => hung, after: async () => {} });
    const result = await run(task(), built);
    expect(result.evidence.disposition).toBe('timed_out');
    expect(result.missionContinues).toBe(true);
    expect(result.spendUsdMicros).toBe(0);
    expect(built.calls.wake).toBe(1);
    late({ wakeId: 'wake_late', outcome: 'posted', artifact: { bytes: new TextEncoder().encode('too late') } });
    await Promise.resolve();
    expect(built.calls.submit).toBe(0);
    expect(built.calls.review).toBe(0);
    expect(result.missionContinues && 'passed').toBe('passed');
  });

  it('a failed wake lets the mission pass, once', async () => {
    const built = ports({ wake: async () => { throw new Error('relay down'); } });
    const result = await run(task(), built);
    expect(result.evidence).toMatchObject({ disposition: 'failed', reason: 'wake_failed', artifactHashes: [] });
    expect(result.missionContinues).toBe(true);
    expect(built.calls.wake).toBe(1);
    expect(built.calls.submit).toBe(0);
  });

  it('a missing result lets the mission pass', async () => {
    const built = ports({ wake: async () => ({ wakeId: 'wake_01ABCDEF', outcome: 'missing', artifact: null }) });
    const result = await run(task(), built);
    expect(result.evidence.disposition).toBe('missing');
    expect(result.missionContinues).toBe(true);
    expect(built.calls.wake).toBe(1);
  });
});

describe('an untrusted companion artifact', () => {
  it('is rejected by validation and never reviewed', async () => {
    const built = ports({ validate: () => ({ ok: false, reason: 'schema_mismatch' }) });
    const result = await run(task(), built);
    expect(result.evidence.disposition).toBe('rejected');
    expect(result.evidence.reason).toBe('schema_mismatch');
    expect(result.evidence.artifactHashes).toHaveLength(1);
    expect(built.calls.submit).toBe(1);
    expect(built.calls.validate).toBe(1);
    expect(built.calls.review).toBe(0);
    expect(result.reviewed).toBe(false);
    expect(result.missionContinues).toBe(true);
  });

  it('is integrated and then reviewed, and the evidence holds hashes rather than the body', async () => {
    const secret = `sk-${'LIVEKEYVALUE123456'}`;
    const bytes = new TextEncoder().encode(`note ${secret}`);
    const built = ports({
      wake: async (request) => {
        expect(request.serverRunId).toBe(SERVER);
        expect(request).not.toHaveProperty('apiKey');
        return { wakeId: 'wake_01ABCDEF', outcome: 'posted', artifact: { bytes } };
      },
    });
    const seen: string[] = [];
    built.review.review = async (input) => { seen.push(input.sha256); return { verdict: 'approve' }; };
    const result = await run(task(), built);
    expect(result.evidence.disposition).toBe('integrated');
    expect(result.reviewed).toBe(true);
    expect(seen).toEqual([sha256(bytes)]);
    expect(result.evidence.artifactHashes).toEqual([sha256(bytes)]);
    expect(result.evidence.wakeId).toBe('wake_01ABCDEF');
    expect(result.evidence.bodyDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.spendUsdMicros).toBe(0);
    const recorded = JSON.stringify(result.evidence);
    expect(recorded).not.toContain(secret);
    expect(recorded).not.toContain('Add the companion note');
    expect(result.missionContinues).toBe(true);
  });

  it('withholds a credential-shaped wake id', async () => {
    const secret = `sk-${'LIVEKEYVALUE123456'}`;
    const built = ports({ wake: async () => ({ wakeId: `wake-${secret}`, outcome: 'posted', artifact: { bytes: new TextEncoder().encode('fixture') } }) });
    const result = await run(task(), built);
    expect(result.evidence.disposition).toBe('integrated');
    expect(result.evidence.wakeId).toBeNull();
    expect(result.evidence.reason).toBe('wake_id_withheld');
    expect(JSON.stringify(result.evidence)).not.toContain(secret);
  });
});

describe('the companion path imports no provider client', () => {
  const source = readFileSync(join(__dirname, 'julius-companion-slot.ts'), 'utf8');

  it('imports only node:crypto and names no provider client, key, or spend table', () => {
    const imports = [...source.matchAll(/^\s*import\s+[^;]+;/gmu)].map((match) => match[0]);
    expect(imports).toEqual(["import { createHash } from 'node:crypto';"]);
    expect(source).not.toMatch(/openai|@anthropic|anthropic|xai|hermes-reviewer|julius-xai-direct-reviewer|gpt-runner|openai-architect|live-workers|MISSION_LIMITS|spendLedger|authorizeJuliusLiveSpend|julius-dispatch-spend|process\.env|node:fs|writeFile/iu);
  });
});
