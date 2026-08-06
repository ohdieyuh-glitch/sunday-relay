import { describe, expect, it } from 'vitest';

import {
  CRON_APPROVAL_SCOPES, RECURRING_SCOPES, authorizeScheduledOperation,
  type ApprovalGrant, type CronApprovalScope, type DeploymentAuthority,
} from './cron-approvals';

/**
 * RECURRING APPROVALS. The sentence under test is CRON_LOOPS.md's first one:
 * creating a schedule does NOT grant permanent approval to every future
 * operation. Everything here is a way that sentence gets quietly broken — a
 * grant widening to a neighbouring scope, an expiry defaulting to forever, an
 * argument nobody named, a deployment missing one of its three prerequisites.
 */

const T0 = '2026-08-06T12:00:00.000Z';

const grant = (over: Partial<ApprovalGrant> = {}): ApprovalGrant => ({
  scope: 'recurring_external_writes',
  expiresAt: '2026-09-01T00:00:00.000Z',
  argumentScope: ['repo:relay', 'issue:*'],
  ...over,
});

const authorize = (
  scope: CronApprovalScope,
  args: readonly string[],
  grants: readonly ApprovalGrant[],
  deployment?: DeploymentAuthority,
) => authorizeScheduledOperation({
  request: { scope, arguments: args, at: T0 },
  grants,
  ...(deployment === undefined ? {} : { deployment }),
});

const reasonOf = (d: ReturnType<typeof authorizeScheduledOperation>) =>
  d.ok ? null : d.reason;

describe('the seven scopes are pinned, literally', () => {
  it('is exactly CRON_LOOPS.md’s seven, in its order', () => {
    expect([...CRON_APPROVAL_SCOPES]).toEqual([
      'schedule_creation',
      'read_only_recurring_work',
      'one_external_write',
      'recurring_external_writes',
      'deployment',
      'financial_operations',
      'credential_access',
    ]);
  });

  it('one_external_write is NOT a recurring scope — it authorizes a single act', () => {
    expect([...RECURRING_SCOPES].sort()).toEqual([
      'credential_access',
      'deployment',
      'financial_operations',
      'read_only_recurring_work',
      'recurring_external_writes',
    ]);
  });
});

describe('creating a schedule authorizes nothing it later does', () => {
  it('refuses a schedule_creation grant used as an operation approval', () => {
    // Mutation check: treating schedule_creation as a normal grant makes the
    // spec's first sentence false — the act of creating would consent to
    // everything the schedule ever does.
    const decision = authorize('schedule_creation', [], [grant({ scope: 'schedule_creation' })]);
    expect(reasonOf(decision)).toBe('schedule_creation_grants_no_operation');
  });
});

describe('a grant covers ONE scope and never widens', () => {
  it('a read-only grant does not authorize an external write', () => {
    const grants = [grant({ scope: 'read_only_recurring_work', argumentScope: ['repo:relay'] })];
    expect(reasonOf(authorize('recurring_external_writes', ['repo:relay'], grants)))
      .toBe('no_grant_for_scope');
  });

  it('a ONE-write grant does not authorize RECURRING writes', () => {
    // The spec separates these precisely because the second is the dangerous
    // one. Mutation check: collapsing them into one scope fails this.
    const grants = [grant({ scope: 'one_external_write', argumentScope: ['repo:relay'] })];
    expect(reasonOf(authorize('recurring_external_writes', ['repo:relay'], grants)))
      .toBe('no_grant_for_scope');
  });

  it('a deployment grant does not authorize credential access', () => {
    const grants = [grant({ scope: 'deployment', argumentScope: ['env:prod'] })];
    expect(reasonOf(authorize('credential_access', ['env:prod'], grants)))
      .toBe('no_grant_for_scope');
  });

  it('authorizes when the scope matches and everything else holds', () => {
    const decision = authorize('recurring_external_writes', ['repo:relay'], [grant()]);
    expect(decision.ok).toBe(true);
  });
});

describe('a recurring grant is time-limited', () => {
  it('NO expiry is a refusal, not forever', () => {
    // Mutation check: reading a null expiry as unbounded is exactly the
    // permanent approval the spec denies.
    for (const scope of RECURRING_SCOPES) {
      const decision = authorizeScheduledOperation({
        request: { scope, arguments: [], at: T0 },
        grants: [grant({ scope, expiresAt: null, argumentScope: [] })],
        deployment: { hasDeploymentAuthority: true, hasRollbackPolicy: true, hasApproval: true },
      });
      expect(reasonOf(decision), scope).toBe('recurring_grant_without_expiry');
    }
  });

  it('an expired grant refuses, and expiry is exclusive at the instant', () => {
    expect(reasonOf(authorize('recurring_external_writes', [], [
      grant({ expiresAt: '2026-08-06T11:59:59.999Z', argumentScope: [] }),
    ]))).toBe('grant_expired');
    // Exactly at the expiry it is already expired: a grant that expires "at"
    // an instant does not still authorize during it.
    expect(reasonOf(authorize('recurring_external_writes', [], [
      grant({ expiresAt: T0, argumentScope: [] }),
    ]))).toBe('grant_expired');
    expect(authorize('recurring_external_writes', [], [
      grant({ expiresAt: '2026-08-06T12:00:00.001Z', argumentScope: [] }),
    ]).ok).toBe(true);
  });

  it('an unreadable expiry cannot be shown unexpired', () => {
    expect(reasonOf(authorize('recurring_external_writes', [], [
      grant({ expiresAt: '2026-08-06T12:00:00', argumentScope: [] }),
    ]))).toBe('unreadable_expiry');
  });

  it('an unreadable clock refuses before anything else is considered', () => {
    const decision = authorizeScheduledOperation({
      request: { scope: 'recurring_external_writes', arguments: [], at: 'whenever' },
      grants: [grant({ argumentScope: [] })],
    });
    expect(reasonOf(decision)).toBe('unreadable_clock');
  });

  it('a single-act grant needs no expiry but is spent by use', () => {
    const fresh = [grant({ scope: 'one_external_write', expiresAt: null, argumentScope: ['a'] })];
    expect(authorize('one_external_write', ['a'], fresh).ok).toBe(true);
    const used = [grant({
      scope: 'one_external_write', expiresAt: null, argumentScope: ['a'], consumed: true,
    })];
    expect(reasonOf(authorize('one_external_write', ['a'], used)))
      .toBe('single_act_grant_already_consumed');
  });
});

describe('a recurring grant is argument-scoped', () => {
  it('refuses an argument the grant never named', () => {
    // Mutation check: dropping the argument check lets a grant for one
    // repository act on another.
    const grants = [grant({ argumentScope: ['repo:relay'] })];
    const decision = authorize('recurring_external_writes', ['repo:relay', 'repo:other'], grants);
    expect(reasonOf(decision)).toBe('arguments_outside_grant');
    if (!decision.ok) expect(decision.problem).toContain('repo:other');
  });

  it('every named argument must be covered, not merely one of them', () => {
    const grants = [grant({ argumentScope: ['repo:relay'] })];
    expect(reasonOf(authorize('recurring_external_writes', ['repo:other'], grants)))
      .toBe('arguments_outside_grant');
  });

  it('an empty argument scope covers nothing rather than everything', () => {
    // Mutation check: treating an empty scope as a wildcard turns the
    // narrowest grant into the widest.
    const grants = [grant({ argumentScope: [] })];
    expect(reasonOf(authorize('recurring_external_writes', ['repo:relay'], grants)))
      .toBe('arguments_outside_grant');
  });
});

describe('deploying needs all three prerequisites', () => {
  const deployGrant = [grant({ scope: 'deployment', argumentScope: ['env:prod'] })];
  const all: DeploymentAuthority = {
    hasDeploymentAuthority: true, hasRollbackPolicy: true, hasApproval: true,
  };

  it('authorizes only when authority, rollback policy AND approval are present', () => {
    expect(authorize('deployment', ['env:prod'], deployGrant, all).ok).toBe(true);
  });

  it.each([
    ['hasDeploymentAuthority', 'deployment authority'],
    ['hasRollbackPolicy', 'rollback policy'],
    ['hasApproval', 'approval'],
  ] as const)('refuses when %s is missing', (field, label) => {
    // Mutation check: requiring any two of the three lets a deployment
    // proceed without the third, and the spec lists them together.
    const decision = authorize('deployment', ['env:prod'], deployGrant, { ...all, [field]: false });
    expect(reasonOf(decision)).toBe('deployment_prerequisites_missing');
    if (!decision.ok) expect(decision.problem).toContain(label);
  });

  it('refuses when the prerequisites are not supplied at all', () => {
    const decision = authorize('deployment', ['env:prod'], deployGrant);
    expect(reasonOf(decision)).toBe('deployment_prerequisites_missing');
    if (!decision.ok) {
      expect(decision.problem).toContain('deployment authority');
      expect(decision.problem).toContain('rollback policy');
      expect(decision.problem).toContain('approval');
      expect(decision.problem).toContain('may PREPARE');
    }
  });

  it('prerequisites do not rescue a deployment whose grant expired', () => {
    const expired = [grant({
      scope: 'deployment', expiresAt: '2026-01-01T00:00:00.000Z', argumentScope: ['env:prod'],
    })];
    expect(reasonOf(authorize('deployment', ['env:prod'], expired, all))).toBe('grant_expired');
  });
});
