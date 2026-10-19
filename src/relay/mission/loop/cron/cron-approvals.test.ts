import { describe, expect, it } from 'vitest';

import {
  CRON_APPROVAL_SCOPES, RECURRING_SCOPES, SCOPE_STOP_ACTIONS,
  authorizeScheduledOperation,
  type ApprovalGrant, type CronApprovalScope, type DeploymentAuthority,
} from './cron-approvals';
import { AUTONOMOUS_STOP_ACTIONS } from '../../modes';

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
  argumentScope: ['repo:relay'],
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
        request: { scope, arguments: ['x'], at: T0 },
        grants: [grant({ scope, expiresAt: null, argumentScope: ['x'] })],
        deployment: { hasDeploymentAuthority: true, hasRollbackPolicy: true, hasApproval: true },
      });
      expect(reasonOf(decision), scope).toBe('recurring_grant_without_expiry');
    }
  });

  it('an expired grant refuses, and expiry is exclusive at the instant', () => {
    expect(reasonOf(authorize('recurring_external_writes', ['x'], [
      grant({ expiresAt: '2026-08-06T11:59:59.999Z', argumentScope: ['x'] }),
    ]))).toBe('grant_expired');
    // Exactly at the expiry it is already expired: a grant that expires "at"
    // an instant does not still authorize during it.
    expect(reasonOf(authorize('recurring_external_writes', ['x'], [
      grant({ expiresAt: T0, argumentScope: ['x'] }),
    ]))).toBe('grant_expired');
    expect(authorize('recurring_external_writes', ['x'], [
      grant({ expiresAt: '2026-08-06T12:00:00.001Z', argumentScope: ['x'] }),
    ]).ok).toBe(true);
  });

  it('an unreadable expiry cannot be shown unexpired', () => {
    expect(reasonOf(authorize('recurring_external_writes', ['x'], [
      grant({ expiresAt: '2026-08-06T12:00:00', argumentScope: ['x'] }),
    ]))).toBe('unreadable_expiry');
  });

  it('an unreadable clock refuses before anything else is considered', () => {
    const decision = authorizeScheduledOperation({
      request: { scope: 'recurring_external_writes', arguments: ['x'], at: 'whenever' },
      grants: [grant({ argumentScope: ['x'] })],
    });
    expect(reasonOf(decision)).toBe('unreadable_clock');
  });

  it('a single-act grant needs no expiry, and a consumed one refuses', () => {
    const fresh = [grant({ scope: 'one_external_write', expiresAt: null, argumentScope: ['a'] })];
    expect(authorize('one_external_write', ['a'], fresh).ok).toBe(true);
    const used = [grant({
      scope: 'one_external_write', expiresAt: null, argumentScope: ['a'], consumed: true,
    })];
    expect(reasonOf(authorize('one_external_write', ['a'], used)))
      .toBe('single_act_grant_already_consumed');
  });
});

describe('an authority decision refuses what it cannot settle', () => {
  it('refuses an operation that names NO arguments', () => {
    // Mutation check: with no arguments the scope filter is vacuously
    // satisfied, so "no arguments" and "arguments not extracted" become
    // indistinguishable — and review probed that permitting a wire transfer.
    for (const scope of CRON_APPROVAL_SCOPES) {
      if (scope === 'schedule_creation') continue;
      const decision = authorizeScheduledOperation({
        request: { scope, arguments: [], at: T0 },
        grants: [grant({ scope, argumentScope: ['repo:relay'] })],
        deployment: { hasDeploymentAuthority: true, hasRollbackPolicy: true, hasApproval: true },
      });
      expect(reasonOf(decision), scope).toBe('operation_names_no_arguments');
    }
  });

  it('refuses an unrecognized scope instead of taking the loosest branch', () => {
    // An unknown scope used to fall through to the single-act path, which
    // requires no expiry — the most permissive branch, reached by the least
    // trustworthy input.
    const decision = authorizeScheduledOperation({
      request: { scope: 'delete_everything' as CronApprovalScope, arguments: ['x'], at: T0 },
      grants: [grant({ scope: 'delete_everything' as CronApprovalScope, expiresAt: null })],
    });
    expect(reasonOf(decision)).toBe('unknown_scope');
  });

  it('refuses when TWO grants exist for one scope, whatever their order', () => {
    // Order used to decide: [expired, valid] refused and [valid, expired]
    // permitted. Mutation check: `find` (first) or last-match both fail this.
    const expired = grant({ expiresAt: '2020-01-01T00:00:00.000Z' });
    const valid = grant();
    for (const grants of [[expired, valid], [valid, expired]]) {
      expect(reasonOf(authorize('recurring_external_writes', ['repo:relay'], grants)))
        .toBe('ambiguous_grants_for_scope');
    }
  });

  it('matches arguments LITERALLY — a star is a character, not a wildcard', () => {
    const grants = [grant({ argumentScope: ['issue:*'] })];
    expect(reasonOf(authorize('recurring_external_writes', ['issue:5'], grants)))
      .toBe('arguments_outside_grant');
    expect(authorize('recurring_external_writes', ['issue:*'], grants).ok).toBe(true);
  });
});

describe('no grant reaches past a boundary stop action', () => {
  it.each([
    ['financial_operations', 'new_financial_commitment'],
    ['credential_access', 'secret_export'],
  ] as const)('%s is stopped even with a perfect grant', (scope, action) => {
    // UNCHAIN.md: unattended agents run under the same seventeen stop actions
    // that stop Autonomous itself. Mode policy is a ceiling an approval does
    // not raise. Mutation check: dropping SCOPE_STOP_ACTIONS permits a wire
    // transfer and a secret export outright.
    const decision = authorizeScheduledOperation({
      request: { scope, arguments: ['wire:vendor-x'], at: T0 },
      grants: [grant({ scope, argumentScope: ['wire:vendor-x'] })],
    });
    expect(reasonOf(decision)).toBe('stopped_by_boundary_action');
    if (!decision.ok) {
      expect(decision.problem).toContain(action);
      expect(decision.problem).toContain('does not lift a boundary stop');
    }
  });

  it('every stop-mapped scope names a REAL boundary action', () => {
    for (const action of Object.values(SCOPE_STOP_ACTIONS)) {
      expect(AUTONOMOUS_STOP_ACTIONS).toContain(action);
    }
  });

  it('a scope with no stop mapping is unaffected', () => {
    expect(authorize('recurring_external_writes', ['repo:relay'], [grant()]).ok).toBe(true);
  });
});

describe('consumption is an obligation returned, not an act performed', () => {
  it('a single-act permit tells the caller to record it as consumed', () => {
    // Mutation check: review found the code and its comments claiming a grant
    // was "spent by use" while nothing anywhere spent it — the same grant
    // object permitted twice.
    const decision = authorize('one_external_write', ['a'], [
      grant({ scope: 'one_external_write', expiresAt: null, argumentScope: ['a'] }),
    ]);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.consumesGrant).toBe(true);
  });

  it('a recurring permit carries no consumption obligation', () => {
    const decision = authorize('recurring_external_writes', ['repo:relay'], [grant()]);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.consumesGrant).toBe(false);
  });

  it('a single-act grant HONOURS an expiry it carries', () => {
    // Review: the whole single-act branch skipped the expiry check, so an
    // expiry from 2020 authorized in 2026.
    expect(reasonOf(authorize('one_external_write', ['a'], [
      grant({ scope: 'one_external_write', expiresAt: '2020-01-01T00:00:00.000Z', argumentScope: ['a'] }),
    ]))).toBe('grant_expired');
    expect(reasonOf(authorize('one_external_write', ['a'], [
      grant({ scope: 'one_external_write', expiresAt: 'not-a-date', argumentScope: ['a'] }),
    ]))).toBe('unreadable_expiry');
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
