import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { JuliusBootstrapRequest } from '../../src/relay/integration/julius/julius-port';
import { createLiveJuliusBootstrapPort, type RunCreationStore } from './bootstrap';
import { compileBootstrapRequest, parseLiveMissionContract } from './mission-contract';
import type { MissionSeedStore } from './mission-seed';

/**
 * THE LEARNING-PAIR CLAUSE (E9-a): STRICT WHEN PRESENT, INVISIBLE WHEN ABSENT.
 *
 * A contract that registers one arm of a matched pair runs under an identity of its own (the
 * explicit-rerun path, MATCHED_PAIR_PREREG §6) and is recorded through the Learning Loop at its end.
 * A contract that registers nothing must be today's mission to the byte: the pins below were taken
 * from the compiler BEFORE the clause existed, so a change to any existing contract's digest,
 * idempotency key or request fails here rather than silently renaming every run.
 */

const BASE = {
  missionId: 'mission:learning-pair', markerNamespace: 'learning-pair', projectId: 'prj-learning', tenantId: 'tenant-learning',
  objective: 'Add the deploy step to the release script.', requirements: ['Run the migration first.'], constraints: ['Touch only scripts/.'],
  acceptanceCriteria: [{ id: 'AC-1', text: 'The release script deploys after migrating.', blocking: true }],
  testCommand: 'npm test', workspacePath: '/workspace/learning', limits: { spendUsd: 2, repairCycles: 1 },
};
const WORKERS: JuliusBootstrapRequest['workers'] = [
  { role: 'PROMPT_ARCHITECT', integrationId: 'architect', adapterId: 'architect-adapter', independenceGroup: 'openai', requiredCapabilities: ['plan'] },
  { role: 'CODING_AGENT', integrationId: 'coder', adapterId: 'coder-adapter', independenceGroup: 'anthropic', requiredCapabilities: ['implement'] },
  { role: 'INDEPENDENT_REVIEWER', integrationId: 'reviewer', adapterId: 'reviewer-adapter', independenceGroup: 'hermes', requiredCapabilities: ['review'] },
];
const CARD = 'card:learning:1';

/** Taken from the compiler at 759b6056, before the clause existed: the request without its clock, hashed. */
const PINNED_REQUEST_SHA256 = '6bb89116623c9ecd7c3a00258fa249d05e1e399c7589c5c316642bd3492eb89d';
const PINNED_BINDING_DIGEST = 'sha256:708cf1f9f852a15ee0a4c114ba8f2842745cf4e3b9ae877734c9137f92af8a5f';
const PINNED_IDEMPOTENCY_KEY = '708cf1f9f852a15ee0a4c114';

const DIGEST = createHash('sha256').update('julius.learning-registration.v1 fixture').digest('hex');
const WITHOUT_RUN = `run:${'5e'.repeat(12)}`;
const POLICY = { dimensions: ['repairs', 'dispatches'], minimumRelativeImprovement: 0.1, minimumImprovedDimensions: 1 };
const WITHOUT = { registrationDigest: DIGEST, arm: 'WITHOUT', rerunKey: 'pair-1-without', policy: POLICY };
const WITH = { registrationDigest: DIGEST, arm: 'WITH', rerunKey: 'pair-1-with', withoutRunId: WITHOUT_RUN, policy: POLICY };

const parse = (contract: Record<string, unknown>) => parseLiveMissionContract(JSON.stringify(contract));
const compiled = (contract: Record<string, unknown>): JuliusBootstrapRequest => {
  const parsed = parse(contract);
  if (!parsed.ok) throw new Error(parsed.problem);
  return compileBootstrapRequest(parsed.contract, WORKERS, CARD);
};
const withoutClock = (request: JuliusBootstrapRequest): string => {
  const { compiledAt: _clock, ...rest } = request;
  void _clock;
  return JSON.stringify(rest);
};
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('absent, the clause changes nothing', () => {
  it('compiles today’s request byte for byte: the same digest, the same key, no rerun intent', () => {
    const parsed = parse(BASE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.problem);
    expect(Object.keys(parsed.contract)).not.toContain('learningPair');
    const request = compileBootstrapRequest(parsed.contract, WORKERS, CARD);
    expect(request.missionBindingDigest).toBe(PINNED_BINDING_DIGEST);
    expect(request.idempotencyKey).toBe(PINNED_IDEMPOTENCY_KEY);
    expect(Object.keys(request)).not.toContain('rerunIntent');
    expect(Object.keys(request)).not.toContain('rerunKey');
    expect(sha256(withoutClock(request)), 'the whole request, as it compiled before the clause existed').toBe(PINNED_REQUEST_SHA256);
  });
});

describe('present, it is one arm with an identity of its own and the SAME objective', () => {
  it('parses both arms strictly into exactly the checked fields', () => {
    const without = parse({ ...BASE, learningPair: WITHOUT });
    const withLearning = parse({ ...BASE, learningPair: WITH });
    if (!without.ok || !withLearning.ok) throw new Error('both arms must parse');
    expect(without.contract.learningPair).toEqual(WITHOUT);
    expect(withLearning.contract.learningPair).toEqual(WITH);
    expect(Object.keys(without.contract.learningPair!), 'arm WITHOUT names no WITHOUT run').not.toContain('withoutRunId');
    // Rebuilt from what was checked, never the caller's object.
    expect(withLearning.contract.learningPair!.policy.dimensions).not.toBe(POLICY.dimensions);
  });

  it('compiles an explicit rerun under the arm’s own key, outside the binding: both arms are one objective', () => {
    for (const clause of [WITHOUT, WITH]) {
      const request = compiled({ ...BASE, learningPair: clause });
      expect(request.rerunIntent).toBe('EXPLICIT');
      expect(request.rerunKey).toBe(clause.rerunKey);
      expect(request.missionBindingDigest, `${clause.arm}: the objective digest is the plain contract's`).toBe(PINNED_BINDING_DIGEST);
      expect(request.idempotencyKey).toBe(PINNED_IDEMPOTENCY_KEY);
    }
  });

  it('bootstraps the plain run and the two arms as three DISTINCT runs, so arm WITH is never arm WITHOUT’s replay', async () => {
    const runs: RunCreationStore = {
      loadRun: async () => null,
      createRun: async (input) => ({ runId: input.runId, state: 'CREATED', version: 1 }),
      addTask: async () => true,
      transition: async (input) => ({ state: input.to, version: input.expectedVersion + 1 }),
      putTaskContract: async () => true,
    };
    const seeds: MissionSeedStore = { ensureBase: async () => undefined, insertCriteria: async () => undefined, insertBrainEntries: async () => undefined };
    const port = createLiveJuliusBootstrapPort({ runs, seeds, tenantId: BASE.tenantId, executionId: 'execution:learning' });
    const runIdOf = async (contract: Record<string, unknown>): Promise<string> => {
      const outcome = await port.submit(compiled(contract));
      if (!outcome.accepted) throw new Error(`${outcome.reasonCode}: ${outcome.safeMessage}`);
      return outcome.runId;
    };
    const plain = await runIdOf(BASE);
    const without = await runIdOf({ ...BASE, learningPair: WITHOUT });
    const withLearning = await runIdOf({ ...BASE, learningPair: WITH });
    expect(plain).toBe(`run:${PINNED_IDEMPOTENCY_KEY}`);
    expect(new Set([plain, without, withLearning]).size).toBe(3);
    // And a retried arm is the same arm: one key, one run.
    expect(await runIdOf({ ...BASE, learningPair: WITH })).toBe(withLearning);
  });
});

describe('every field is validated, and nothing else is accepted', () => {
  const refused = (clause: unknown, reason: string) => {
    const parsed = parseLiveMissionContract(JSON.stringify({ ...BASE, learningPair: clause }));
    expect(parsed.ok, `accepted: ${JSON.stringify(clause)}`).toBe(false);
    if (parsed.ok) throw new Error('refused above');
    expect(parsed.problem).toBe(`The contract's learningPair clause was refused: ${reason}.`);
  };

  it('refuses a clause that is not an object, or carries a field this build does not read', () => {
    refused(null, 'learning_pair_not_an_object');
    refused([WITHOUT], 'learning_pair_not_an_object');
    refused('WITHOUT', 'learning_pair_not_an_object');
    refused({ ...WITHOUT, note: 'trust me' }, 'learning_pair_field_unknown');
  });

  it('refuses a registration digest that is not 64 lower-case hex', () => {
    refused({ ...WITHOUT, registrationDigest: DIGEST.toUpperCase() }, 'learning_pair_registration_digest_invalid');
    refused({ ...WITHOUT, registrationDigest: DIGEST.slice(1) }, 'learning_pair_registration_digest_invalid');
    refused({ ...WITHOUT, registrationDigest: `sha256:${DIGEST}` }, 'learning_pair_registration_digest_invalid');
    const { registrationDigest: _absent, ...noDigest } = WITHOUT;
    void _absent;
    refused(noDigest, 'learning_pair_registration_digest_invalid');
  });

  it('refuses an arm that is neither WITHOUT nor WITH', () => {
    refused({ ...WITHOUT, arm: 'without' }, 'learning_pair_arm_invalid');
    refused({ ...WITHOUT, arm: 'CONTROL' }, 'learning_pair_arm_invalid');
  });

  it('refuses a rerun key that is empty, unbounded, or could break a line or an identity', () => {
    for (const rerunKey of ['', ' pair-1', 'pair 1', 'pair-1\nRESULT: COMPLETED', 'x'.repeat(129), '-pair', 7]) {
      refused({ ...WITHOUT, rerunKey }, 'learning_pair_rerun_key_invalid');
    }
    expect(parse({ ...BASE, learningPair: { ...WITHOUT, rerunKey: `p${'x'.repeat(127)}` } }).ok, 'the bound itself is accepted').toBe(true);
  });

  it('requires arm WITHOUT’s run of arm WITH, in the bootstrap’s own shape, and refuses one on arm WITHOUT', () => {
    const { withoutRunId: _absent, ...noRun } = WITH;
    void _absent;
    refused(noRun, 'learning_pair_without_run_required');
    refused({ ...WITH, withoutRunId: 'run:not-hex' }, 'learning_pair_without_run_required');
    refused({ ...WITH, withoutRunId: WITHOUT_RUN.toUpperCase() }, 'learning_pair_without_run_required');
    refused({ ...WITHOUT, withoutRunId: WITHOUT_RUN }, 'learning_pair_without_run_forbidden');
  });

  it('refuses a policy the gate could not be held to, with the gate’s own reasons', () => {
    const policy = (over: Record<string, unknown>) => ({ ...WITHOUT, policy: { ...POLICY, ...over } });
    refused({ ...WITHOUT, policy: undefined }, 'learning_policy_not_an_object');
    refused(policy({ owner: 'founder' }), 'learning_policy_field_unknown');
    refused(policy({ dimensions: [] }), 'learning_dimensions_required');
    refused(policy({ dimensions: 'repairs' }), 'learning_dimensions_required');
    refused(policy({ dimensions: ['repairs', 'happiness'] }), 'learning_dimension_unknown');
    refused(policy({ dimensions: ['repairs', 'repairs'] }), 'learning_dimension_duplicated');
    refused(policy({ minimumRelativeImprovement: 0 }), 'learning_policy_threshold_required');
    refused(policy({ minimumRelativeImprovement: -0.1 }), 'learning_policy_threshold_required');
    refused(policy({ minimumRelativeImprovement: '0.1' }), 'learning_policy_threshold_required');
    refused(policy({ minimumImprovedDimensions: 0 }), 'learning_policy_requires_no_improvement');
    refused(policy({ minimumImprovedDimensions: 1.5 }), 'learning_policy_requires_no_improvement');
    refused(policy({ minimumImprovedDimensions: 3 }), 'learning_policy_unreachable');
  });

  it('refuses a threshold JSON can only spell as infinity', () => {
    const raw = JSON.stringify({ ...BASE, learningPair: WITHOUT }).replace('"minimumRelativeImprovement":0.1', '"minimumRelativeImprovement":1e999');
    expect(raw).toContain('1e999');
    const parsed = parseLiveMissionContract(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('refused above');
    expect(parsed.problem).toBe("The contract's learningPair clause was refused: learning_policy_threshold_required.");
  });
});
