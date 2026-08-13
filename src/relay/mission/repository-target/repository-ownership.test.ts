import { describe, expect, it } from 'vitest';

import { registrationOwnerAdmits } from './repository-authorization';
import { createRepositoryRegistration } from './repository-registry';
import type { RepositoryRegistrationDraft } from './repository-registry';
import { DEFAULT_CHANGE_CEILINGS } from './repository-contracts';

/**
 * REPOSITORY OWNERSHIP — the rule that lets a beta user connect and ship THEIR
 * OWN repository without the operator, and guarantees they can never reach one
 * someone else registered. If `registrationOwnerAdmits` stopped checking the
 * participant, the "a different user is refused" test would admit them; if the
 * builder stopped validating the owner shape, an unreachable owner would store.
 */

const NOW = '2026-08-12T12:00:00.000Z';

function draft(over: Partial<RepositoryRegistrationDraft> = {}): RepositoryRegistrationDraft {
  return {
    identity: { provider: 'github', host: 'github.com', owner: 'beta-user', name: 'their-repo', defaultBranch: 'main' },
    location: { kind: 'remote_clone', cloneUrl: 'https://github.com/beta-user/their-repo.git' },
    scope: { read: ['**'], write: ['src/**'] },
    grants: [{ permission: 'read', authorizedBy: 'beta-user', authorizedAt: NOW, expiresAt: null, note: null }],
    ceilings: DEFAULT_CHANGE_CEILINGS,
    registeredBy: 'beta-user',
    ...over,
  } as RepositoryRegistrationDraft;
}

describe('registrationOwnerAdmits', () => {
  const operator = { kind: 'operator' as const };
  const user = (participantId: string | null) => ({ kind: 'participant' as const, participantId });

  it('the operator may act on anything, owned or not', () => {
    expect(registrationOwnerAdmits({ ownerParticipant: null, caller: operator })).toBe(true);
    expect(registrationOwnerAdmits({ ownerParticipant: 'ghu-42', caller: operator })).toBe(true);
  });

  it('an operator-owned (null) registration admits no user', () => {
    expect(registrationOwnerAdmits({ ownerParticipant: null, caller: user('ghu-42') })).toBe(false);
  });

  it('a user-owned registration admits exactly its owner', () => {
    expect(registrationOwnerAdmits({ ownerParticipant: 'ghu-42', caller: user('ghu-42') })).toBe(true);
  });

  it('a user-owned registration refuses a DIFFERENT user', () => {
    expect(registrationOwnerAdmits({ ownerParticipant: 'ghu-42', caller: user('ghu-99') })).toBe(false);
  });

  it('a null caller participant never equals a set owner', () => {
    expect(registrationOwnerAdmits({ ownerParticipant: 'ghu-42', caller: user(null) })).toBe(false);
  });
});

describe('createRepositoryRegistration binds ownership', () => {
  it('records a valid ownerParticipant', () => {
    const r = createRepositoryRegistration({ draft: draft({ ownerParticipant: 'ghu-42' }), now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ownerParticipant).toBe('ghu-42');
  });

  it('defaults to operator-owned (null) when no owner is supplied', () => {
    const r = createRepositoryRegistration({ draft: draft(), now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ownerParticipant).toBeNull();
  });

  it('refuses an owner that could never be matched (bad shape)', () => {
    for (const bad of ['gh:42', 'has space', '-leading', 'x'.repeat(65)]) {
      const r = createRepositoryRegistration({ draft: draft({ ownerParticipant: bad }), now: NOW });
      expect(r.ok, `owner ${JSON.stringify(bad)} must be refused`).toBe(false);
    }
  });
});
