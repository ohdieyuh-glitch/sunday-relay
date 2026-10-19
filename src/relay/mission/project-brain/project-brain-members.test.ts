import { describe, expect, it } from 'vitest';

import { projectBrainCapabilitiesFor, type ProjectBrainProvenance } from './project-brain';
import {
  authorizeProjectBrainMemberChange,
  parseProjectBrainMemberChange,
  projectBrainMemberEventType,
  type ProjectBrainMemberCommand,
} from './project-brain-members';

/**
 * WHO MAY USE A PROJECT'S BRAIN: the parse and the decision, without a database. The store applies these under the
 * project's lock; what it guarantees there is proven against PostgreSQL in project-brain-members.real-postgres.test.ts.
 */

const PLAYER = (id: string): ProjectBrainProvenance => ({ author: { kind: 'WONDERLAND_PLAYER', id }, deliverer: { kind: 'WONDERLAND_CLIENT', id: 'wonderland-session:s1' } });
const COMPANION: ProjectBrainProvenance = { author: { kind: 'COMPANION', id: 'c1' }, deliverer: { kind: 'COMPANION_CHANNEL', id: 'relay-bridge:companion-channel' } };
const set = (over: Record<string, unknown> = {}) => ({ operation: 'MEMBER_SET', idempotencyKey: 'member-key-1', playerId: 'p2', role: 'MEMBER', expectedRole: null, ...over });
const remove = (over: Record<string, unknown> = {}) => ({ operation: 'MEMBER_REMOVE', idempotencyKey: 'member-key-2', playerId: 'p2', expectedRole: 'MEMBER', ...over });
const command = (input: Record<string, unknown>): ProjectBrainMemberCommand => {
  const parsed = parseProjectBrainMemberChange(input);
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed.command;
};
const code = (input: unknown) => {
  const parsed = parseProjectBrainMemberChange(input);
  return parsed.ok ? 'ok' : parsed.code;
};
const decide = (actorRole: string | null, change: Record<string, unknown>, currentRole: string | null, actorId = 'p1', provenance = PLAYER(actorId)) => {
  const verdict = authorizeProjectBrainMemberChange({
    provenance, capabilities: projectBrainCapabilitiesFor(actorRole), actorRole, actorId, command: command(change), currentRole,
  });
  return verdict.ok ? 'ok' : verdict.code;
};

describe('a membership change is a closed, explicit command', () => {
  it('parses exactly its own keys, and refuses anything else by name', () => {
    expect(code(set())).toBe('ok');
    expect(code(remove())).toBe('ok');
    expect(code(set({ projectId: 'prj-x' })), 'the project is the door\'s, never a field').toBe('field_unknown');
    expect(code(set({ capabilities: ['brain:members'] }))).toBe('field_unknown');
    expect(code(remove({ role: 'MEMBER' }))).toBe('field_unknown');
    expect(code({ ...set(), operation: 'MEMBER_PROMOTE' })).toBe('operation_invalid');
    expect(code([])).toBe('body_invalid');
  });

  it('grants only ADMIN or MEMBER: OWNER, EDITOR, VIEWER and anything else are refused', () => {
    for (const role of ['OWNER', 'EDITOR', 'VIEWER', 'admin', '', null, 3]) expect(code(set({ role })), String(role)).toBe('role_invalid');
    expect(code(set({ role: 'ADMIN' }))).toBe('ok');
  });

  it('never applies blind: a set names the role it saw (or null), a removal always does', () => {
    expect(code(set({ expectedRole: 'MEMBER' }))).toBe('ok');
    expect(code(set({ expectedRole: undefined }))).toBe('expected_role_required');
    expect(code(set({ expectedRole: 'member' }))).toBe('expected_role_required');
    expect(code(remove({ expectedRole: null }))).toBe('expected_role_required');
    expect(code(remove({ expectedRole: undefined }))).toBe('expected_role_required');
  });

  it('names a player by the doors\' grammar and an idempotency key by the log\'s', () => {
    for (const playerId of ['', ' p2', 'p 2', 'p2/../x', 'x'.repeat(129), 3]) expect(code(set({ playerId })), String(playerId)).toBe('player_invalid');
    for (const idempotencyKey of ['short', 'has space key', undefined]) expect(code(set({ idempotencyKey })), String(idempotencyKey)).toBe('idempotency_key_required');
  });
});

describe('who may change membership', () => {
  it('an OWNER adds, promotes, demotes and removes; an ADMIN manages MEMBERs only', () => {
    expect(decide('OWNER', set(), null)).toBe('ok');
    expect(decide('OWNER', set({ role: 'ADMIN' }), null)).toBe('ok');
    expect(decide('OWNER', set({ role: 'MEMBER', expectedRole: 'ADMIN' }), 'ADMIN')).toBe('ok');
    expect(decide('OWNER', remove({ expectedRole: 'ADMIN' }), 'ADMIN')).toBe('ok');
    expect(decide('ADMIN', set(), null)).toBe('ok');
    expect(decide('ADMIN', remove(), 'MEMBER')).toBe('ok');
    expect(decide('ADMIN', set({ role: 'ADMIN' }), null), 'an admin never makes an admin').toBe('owner_required');
    expect(decide('ADMIN', set({ role: 'ADMIN', expectedRole: 'MEMBER' }), 'MEMBER')).toBe('owner_required');
    expect(decide('ADMIN', remove({ expectedRole: 'ADMIN' }), 'ADMIN'), 'an admin never removes an admin').toBe('owner_required');
    expect(decide('ADMIN', set({ expectedRole: 'EDITOR' }), 'EDITOR'), 'a role the product does not grant is the owner\'s to change').toBe('owner_required');
  });

  it('a MEMBER, an EDITOR, a VIEWER and a stranger change nothing', () => {
    for (const role of ['MEMBER', 'EDITOR', 'VIEWER', null]) expect(decide(role, set(), null), String(role)).toBe('members_not_permitted');
  });

  it('the OWNER is permanent, and nobody changes their own row', () => {
    expect(decide('OWNER', remove({ expectedRole: 'OWNER' }), 'OWNER')).toBe('owner_is_permanent');
    expect(decide('OWNER', set({ expectedRole: 'OWNER' }), 'OWNER')).toBe('owner_is_permanent');
    expect(decide('ADMIN', remove({ playerId: 'p1', expectedRole: 'ADMIN' }), 'ADMIN', 'p1')).toBe('own_membership');
    expect(decide('OWNER', set({ playerId: 'p1', expectedRole: 'OWNER' }), 'OWNER', 'p1')).toBe('own_membership');
  });

  it('a stale view is refused, not applied: the role it saw must be the role now', () => {
    expect(decide('OWNER', set(), 'MEMBER'), 'someone added them meanwhile').toBe('member_conflict');
    expect(decide('OWNER', remove(), null), 'someone removed them meanwhile').toBe('member_conflict');
    expect(decide('OWNER', remove({ expectedRole: 'MEMBER' }), 'ADMIN'), 'someone promoted them meanwhile').toBe('member_conflict');
    expect(decide('OWNER', set({ expectedRole: 'MEMBER' }), 'MEMBER'), 'granting what they hold changes nothing').toBe('member_unchanged');
  });

  it('a companion manages nothing, whatever membership it rides on', () => {
    expect(decide('OWNER', set(), null, 'p1', COMPANION)).toBe('companion_cannot_manage_members');
  });

  it('each change is announced under its own name', () => {
    expect(projectBrainMemberEventType('MEMBER_SET')).toBe('project_brain.member.set');
    expect(projectBrainMemberEventType('MEMBER_REMOVE')).toBe('project_brain.member.removed');
  });
});
