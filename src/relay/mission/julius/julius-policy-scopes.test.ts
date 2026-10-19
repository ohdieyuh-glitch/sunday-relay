/**
 * V6 G-2: A C.A.R.D. GATE SCOPED TO ONE ROLE AND ONE TASK TYPE.
 *
 * Before this, `policy.approvals` was the only gate, and it named an operation
 * and nothing else: a `DISPATCH_WORKER` gate held EVERY dispatch of the run, the
 * plan, the build, every review and every repair. A mission that wants a person
 * to sign off one step (the build, after the plan was reviewed) could not say so.
 *
 * `approvalScopes` says it: an operation, the roles and the task types it holds.
 * v1 honours `DISPATCH_WORKER` only. A request that cannot be evaluated against a
 * scope (no role, no task type) is held, never waved through.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateJuliusPolicy, workerAllowedByCard, type JuliusCardPolicy, type JuliusWorker } from '.';

const BASE: JuliusCardPolicy = {
  revision: 'card:scoped:1', autonomy: 'AUTONOMOUS', allowedProviders: ['openai', 'anthropic', 'xai'],
  capabilities: ['plan', 'implement', 'review'], network: true, filesystemMutation: true, fallback: false,
  automaticRetry: true, subagents: { allowed: false, maxDepth: 1, maxActive: 0, maxTotal: 0 },
  iterativeReview: { allowed: true, maxRounds: 2 }, concurrency: 1, approvals: [],
};
const BUILD_SCOPE = { operation: 'DISPATCH_WORKER' as const, roles: ['CODING_AGENT'], taskTypes: ['build'] };
const SCOPED: JuliusCardPolicy = { ...BASE, approvalScopes: [BUILD_SCOPE] };

const dispatch = (policy: JuliusCardPolicy, role?: string, taskType?: string) => evaluateJuliusPolicy(policy, {
  operation: 'DISPATCH_WORKER', ...(role === undefined ? {} : { role }), ...(taskType === undefined ? {} : { taskType }),
});

describe('V6 G-2: approvalScopes hold exactly the scoped dispatch', () => {
  it('RED before G-2: the CODING_AGENT build is held for a person, with its own reason code', () => {
    const verdict = dispatch(SCOPED, 'CODING_AGENT', 'build');
    expect(verdict).toMatchObject({ effect: 'REQUIRE_APPROVAL', reasonCode: 'CARD_SCOPED_APPROVAL_REQUIRED', policyRevision: 'card:scoped:1' });
  });

  it('every other dispatch of the mission is ungated: the plan, the review and a repair of the build', () => {
    for (const [role, taskType] of [
      ['PROMPT_ARCHITECT', 'plan'], ['INDEPENDENT_REVIEWER', 'review'], ['CODING_AGENT', 'repair:build'],
      ['INDEPENDENT_REVIEWER', 'build'], ['CODING_AGENT', 'plan'],
    ] as const) {
      const verdict = dispatch(SCOPED, role, taskType);
      expect(verdict, `${role}/${taskType} answers exactly as an ungated card does`).toEqual(dispatch(BASE, role, taskType));
      expect(verdict.effect).toBe('LIMITED');
    }
  });

  it('the role and the task type must BOTH match: either alone is not the scope', () => {
    const roleOnly: JuliusCardPolicy = { ...BASE, approvalScopes: [{ ...BUILD_SCOPE, taskTypes: ['plan'] }] };
    expect(dispatch(roleOnly, 'CODING_AGENT', 'build').effect, 'the role matches, the task type does not').toBe('LIMITED');
    const typeOnly: JuliusCardPolicy = { ...BASE, approvalScopes: [{ ...BUILD_SCOPE, roles: ['PROMPT_ARCHITECT'] }] };
    expect(dispatch(typeOnly, 'CODING_AGENT', 'build').effect, 'the task type matches, the role does not').toBe('LIMITED');
  });

  it('FAIL CLOSED: a request the scope cannot evaluate (no role, or no task type) is held', () => {
    expect(dispatch(SCOPED).effect).toBe('REQUIRE_APPROVAL');
    expect(dispatch(SCOPED, 'CODING_AGENT').effect).toBe('REQUIRE_APPROVAL');
    expect(dispatch(SCOPED, undefined, 'build').effect).toBe('REQUIRE_APPROVAL');
    expect(dispatch(SCOPED).reasonCode).toBe('CARD_SCOPED_APPROVAL_REQUIRED');
  });

  it('UNCHAINED waives a scoped gate exactly as it waives an unscoped one (parity with approvals)', () => {
    const unchained: JuliusCardPolicy = { ...SCOPED, autonomy: 'UNCHAINED' };
    expect(dispatch(unchained, 'CODING_AGENT', 'build')).toEqual(dispatch({ ...BASE, autonomy: 'UNCHAINED' }, 'CODING_AGENT', 'build'));
    expect(dispatch(unchained, 'CODING_AGENT', 'build').effect).toBe('LIMITED');
    const unscoped: JuliusCardPolicy = { ...BASE, autonomy: 'UNCHAINED', approvals: ['DISPATCH_WORKER'] };
    expect(dispatch(unscoped, 'CODING_AGENT', 'build').effect, 'the existing rule this mirrors').toBe('LIMITED');
  });

  it('the unscoped approvals list keeps its meaning: it holds every dispatch, with its own reason code', () => {
    const unscoped: JuliusCardPolicy = { ...BASE, approvals: ['DISPATCH_WORKER'] };
    for (const [role, taskType] of [['PROMPT_ARCHITECT', 'plan'], ['CODING_AGENT', 'build'], ['INDEPENDENT_REVIEWER', 'review']] as const) {
      expect(dispatch(unscoped, role, taskType)).toMatchObject({ effect: 'REQUIRE_APPROVAL', reasonCode: 'CARD_APPROVAL_REQUIRED' });
    }
    // Both present: the unscoped gate answers first, unchanged.
    expect(dispatch({ ...unscoped, approvalScopes: [BUILD_SCOPE] }, 'CODING_AGENT', 'build').reasonCode).toBe('CARD_APPROVAL_REQUIRED');
  });

  it('v1 honours a DISPATCH_WORKER scope only: a scope naming another operation gates nothing', () => {
    // The type forbids it; a record from elsewhere (a cast, a JSON column) could still carry one.
    const smuggled = { ...BASE, approvalScopes: [{ operation: 'USE_CAPABILITY', roles: ['CODING_AGENT'], taskTypes: ['build'] }] } as unknown as JuliusCardPolicy;
    const capability = evaluateJuliusPolicy(smuggled, { operation: 'USE_CAPABILITY', capability: 'implement', role: 'CODING_AGENT', taskType: 'build' });
    expect(capability).toEqual(evaluateJuliusPolicy(BASE, { operation: 'USE_CAPABILITY', capability: 'implement', role: 'CODING_AGENT', taskType: 'build' }));
    expect(capability.effect).toBe('ALLOW');
    const toolUse = evaluateJuliusPolicy(smuggled, { operation: 'USE_TOOL', capability: 'implement' });
    expect(toolUse.effect, 'a tool call is never held by a smuggled scope').toBe('ALLOW');
    expect(dispatch(smuggled, 'CODING_AGENT', 'build').effect).toBe('LIMITED');
  });

  it('a card with no scopes, or an empty scope list, answers exactly as before', () => {
    expect(dispatch({ ...BASE, approvalScopes: [] }, 'CODING_AGENT', 'build')).toEqual(dispatch(BASE, 'CODING_AGENT', 'build'));
    expect(dispatch(BASE)).toMatchObject({ effect: 'LIMITED', reasonCode: 'CARD_CONCURRENCY_LIMIT' });
  });

  it('the router reading (workerAllowedByCard) asks with no role: it fails closed to REQUIRE_APPROVAL, which it does not act on', () => {
    const worker: JuliusWorker = {
      workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder', capabilities: ['implement'],
      taskTypes: ['build'], concurrencyLimit: 1, timeoutMs: 1000, maxRetries: 1, status: 'AVAILABLE',
    };
    const verdict = workerAllowedByCard(SCOPED, worker, 'implement');
    expect(verdict.effect, 'not a DENY, so the router keeps the worker').not.toBe('DENY');
    expect(verdict.effect).toBe('REQUIRE_APPROVAL');
  });

  it('PIN: julius-tools never asks DISPATCH_WORKER, so the v1 restriction cannot start refusing tool calls', () => {
    const source = readFileSync(join(__dirname, 'julius-tools.ts'), 'utf8');
    const start = source.indexOf('const operationFor=');
    expect(start, 'operationFor must be found, or this pin is vacuous').toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf('\n', start));
    expect(body).toContain("'USE_TOOL'");
    expect(body).not.toContain('DISPATCH_WORKER');
  });
});
