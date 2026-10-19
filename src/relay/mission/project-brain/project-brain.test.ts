import { describe, expect, it } from 'vitest';

import {
  PROJECT_BRAIN_DOMAIN_RULES,
  PROJECT_BRAIN_RECORD_DOMAINS,
  advanceProjectBrainCursor,
  authorizeProjectBrainMutation,
  decodeProjectBrainCursor,
  encodeProjectBrainCursor,
  parseProjectBrainMutation,
  parseProjectBrainRef,
  projectBrainCapabilitiesFor,
  projectBrainEventTypeForJulius,
  projectBrainForbiddenMaterial,
  projectBrainRequestIdentity,
  type ProjectBrainMutationCommand,
  type ProjectBrainProvenance,
  type ProjectBrainRecordState,
} from './project-brain';

const PLAYER: ProjectBrainProvenance = {
  author: { kind: 'WONDERLAND_PLAYER', id: 'player-1' },
  deliverer: { kind: 'WONDERLAND_CLIENT', id: 'wonderland-session:abc' },
};
const COMPANION: ProjectBrainProvenance = {
  author: { kind: 'COMPANION', id: 'llm-companion' },
  deliverer: { kind: 'COMPANION_CHANNEL', id: 'relay-bridge:companion-channel' },
};
const RECORD = 'pbr:0f8fad5b-d9cb-469f-a165-70867728950e';

const command = (input: unknown): ProjectBrainMutationCommand => {
  const parsed = parseProjectBrainMutation(input);
  if (!parsed.ok) throw new Error(`${parsed.code}: ${parsed.message}`);
  return parsed.command;
};
const create = (over: Record<string, unknown> = {}) => command({
  operation: 'CREATE', idempotencyKey: 'key-00000001', domain: 'REQUIREMENT', title: 'Labels sit below their bars.', ...over,
});
const stored = (over: Partial<ProjectBrainRecordState> = {}): ProjectBrainRecordState => ({
  recordId: RECORD, projectId: 'prj-1', domain: 'REQUIREMENT', status: 'PROPOSED', version: 3, author: PLAYER.author, ...over,
});

describe('a Project Brain mutation is parsed against a closed shape', () => {
  it('accepts a well-formed statement and defaults its scope from the run', () => {
    expect(create()).toMatchObject({ operation: 'CREATE', scope: 'PROJECT', runId: null, body: '', links: [] });
    expect(create({ runId: 'run:abc' })).toMatchObject({ scope: 'MISSION', runId: 'run:abc' });
  });

  it('refuses any field it does not define — author, provenance and reasoning among them', () => {
    for (const field of ['author', 'provenance', 'reasoning', 'chainOfThought', 'deliverer']) {
      const parsed = parseProjectBrainMutation({ operation: 'CREATE', idempotencyKey: 'key-00000001', domain: 'USER_FACT', title: 't', [field]: 'x' });
      expect(parsed, field).toMatchObject({ ok: false, code: 'unknown_field' });
    }
  });

  it('refuses credentials and hidden reasoning instead of quietly redacting them', () => {
    const secrets = [
      'my key is sk-ant-api03-FAKETESTNOTREAL',
      'token ghp_FAKETESTNOTREALFAKETESTNOTREAL',
      'password: hunter2hunter2',
      'postgres://u:FAKETESTNOTREAL@h/julius',
      '-----BEGIN FAKETESTNOTREAL PRIVATE KEY-----',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk',
    ];
    for (const secret of secrets) {
      expect(projectBrainForbiddenMaterial(secret), secret).toBe('credential');
      expect(parseProjectBrainMutation({ operation: 'CREATE', idempotencyKey: 'key-00000001', domain: 'USER_FACT', title: 'note', body: secret }))
        .toMatchObject({ ok: false, code: 'credential_in_content', status: 422 });
    }
    expect(parseProjectBrainMutation({ operation: 'CREATE', idempotencyKey: 'key-00000001', domain: 'USER_FACT', title: 'my chain of thought was' }))
      .toMatchObject({ ok: false, code: 'hidden_reasoning_in_content' });
    expect(projectBrainForbiddenMaterial('Labels sit below their bars.')).toBeNull();
  });

  it("does not take Julius's own file names for keys: a key shape starts at a word boundary", () => {
    // Before the boundary, `sk-` matched inside "task-contract", so a person naming Julius's files was refused.
    for (const innocent of ['src/relay/mission/julius/julius-task-contract.ts', 'julius-task-pipeline.ts', 'a desk-organiser-v2 note', 'mykeysk-ant-api03-FAKETESTNOTREAL']) {
      expect(projectBrainForbiddenMaterial(innocent), innocent).toBeNull();
    }
    expect(parseProjectBrainMutation({ operation: 'CREATE', idempotencyKey: 'key-00000001', domain: 'USER_FACT', title: 'Touch julius-task-contract.ts only.' }))
      .toMatchObject({ ok: true });
    for (const secret of ['see sk-FAKETESTNOTREAL', '(sk-ant-api03-FAKETESTNOTREAL)', 'AKIAFAKETESTNOTREAL', 'xoxb-FAKETESTNOTREAL']) {
      expect(projectBrainForbiddenMaterial(secret), secret).toBe('credential');
    }
  });

  it('refuses control characters, oversize text and an empty title', () => {
    expect(parseProjectBrainMutation({ operation: 'CREATE', idempotencyKey: 'key-00000001', domain: 'USER_FACT', title: 'a\u0000b' })).toMatchObject({ code: 'field_invalid' });
    expect(parseProjectBrainMutation({ operation: 'CREATE', idempotencyKey: 'key-00000001', domain: 'USER_FACT', title: 'x'.repeat(201) })).toMatchObject({ code: 'field_too_long' });
    expect(parseProjectBrainMutation({ operation: 'CREATE', idempotencyKey: 'key-00000001', domain: 'USER_FACT', title: '   ' })).toMatchObject({ code: 'field_required' });
  });

  it('demands an idempotency key and, for a change, the version it changes', () => {
    expect(parseProjectBrainMutation({ operation: 'CREATE', domain: 'USER_FACT', title: 't' })).toMatchObject({ code: 'idempotency_key_required' });
    expect(parseProjectBrainMutation({ operation: 'SET_STATUS', idempotencyKey: 'key-00000001', recordId: RECORD, status: 'ADOPTED' }))
      .toMatchObject({ code: 'expected_version_required' });
    expect(parseProjectBrainMutation({ operation: 'REVISE', idempotencyKey: 'key-00000001', recordId: RECORD, expectedVersion: 1 }))
      .toMatchObject({ code: 'revision_empty' });
  });

  it('names what a statement is about with a typed reference, and refuses one that is not', () => {
    expect(parseProjectBrainRef('finding:finding:abc')).toEqual({ type: 'finding', id: 'finding:abc' });
    expect(parseProjectBrainRef('mission:run:abc')).toEqual({ type: 'mission', id: 'run:abc' });
    expect(parseProjectBrainRef(RECORD)).toEqual({ type: 'pbr', id: RECORD.slice(4) });
    for (const bad of ['', 'nope:x', 'finding:', 'finding:a b', 'pbr:not-a-uuid', 42]) expect(parseProjectBrainRef(bad), String(bad)).toBeNull();
    expect(parseProjectBrainMutation({ operation: 'CREATE', idempotencyKey: 'key-00000001', domain: 'FINDING_RESPONSE', title: 'fixed' }))
      .toMatchObject({ code: 'subject_required' });
    expect(parseProjectBrainMutation({ operation: 'CREATE', idempotencyKey: 'key-00000001', domain: 'MEMORY_REVIEW', title: 'r', subjectRef: 'entry:e1' }))
      .toMatchObject({ code: 'verdict_required' });
  });
});

describe('who may change the Project Brain is decided by the membership row, not the request', () => {
  const write = projectBrainCapabilitiesFor('EDITOR');
  const owner = projectBrainCapabilitiesFor('OWNER');
  const viewer = projectBrainCapabilitiesFor('VIEWER');

  it('FOUNDER 10-04, MEMBER limits: a writer resolves or supersedes only its OWN live statement; an owner/admin any; governance acks are theirs alone', () => {
    const member = projectBrainCapabilitiesFor('MEMBER');
    const admin = projectBrainCapabilitiesFor('ADMIN');
    const theirs = { recordId: 'pbr:00000000-0000-4000-8000-000000000001', projectId: 'p', domain: 'FINDING_RESPONSE' as const, status: 'ACTIVE' as const, version: 1,
      author: { kind: 'WONDERLAND_PLAYER' as const, id: 'someone-else' } };
    const mine = { ...theirs, author: PLAYER.author };
    const move = (status: 'RESOLVED' | 'SUPERSEDED') => ({ operation: 'SET_STATUS' as const, idempotencyKey: 'k-12345678', recordId: theirs.recordId, expectedVersion: 1, status });
    for (const status of ['RESOLVED', 'SUPERSEDED'] as const) {
      const other = authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: member, command: move(status), record: theirs });
      expect(other.ok ? 'ok' : other.code, `a member ${status} another's statement`).toBe('not_the_author');
      expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: member, command: move(status), record: mine }).ok, `its own, ${status}`).toBe(true);
      expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: admin, command: move(status), record: theirs }).ok, `an admin, ${status}`).toBe(true);
    }
    const ack = create({ domain: 'GOVERNANCE_ACK', subjectRef: 'mission:run-1' });
    const refused = authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: member, command: ack, record: null });
    expect(refused.ok ? 'ok' : refused.code).toBe('governance_not_permitted');
    expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: admin, command: ack, record: null }).ok).toBe(true);
  });

  it('maps roles to capabilities, and an unknown role to nothing', () => {
    expect(owner).toEqual(['brain:read', 'brain:write', 'brain:adopt', 'brain:members']);
    // Founder decisions 4/5: ADMIN holds what OWNER holds; a MEMBER writes like an editor and never adopts or manages.
    expect(projectBrainCapabilitiesFor('ADMIN')).toEqual(owner);
    expect(projectBrainCapabilitiesFor('MEMBER')).toEqual(['brain:read', 'brain:write']);
    expect(write).toEqual(['brain:read', 'brain:write']);
    expect(viewer).toEqual(['brain:read']);
    expect(projectBrainCapabilitiesFor('MYSTERY')).toEqual([]);
    expect(projectBrainCapabilitiesFor(null)).toEqual([]);
  });

  it('a requirement is born a PROPOSAL; a note is born ACTIVE; a review carries its verdict', () => {
    expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: write, command: create(), record: null })).toEqual({ ok: true, nextStatus: 'PROPOSED' });
    expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: write, command: create({ domain: 'USER_FACT' }), record: null }))
      .toEqual({ ok: true, nextStatus: 'ACTIVE' });
    expect(authorizeProjectBrainMutation({
      provenance: PLAYER, capabilities: write, record: null,
      command: create({ domain: 'MEMORY_REVIEW', subjectRef: 'entry:e1', verdict: 'DECLINED' }),
    })).toEqual({ ok: true, nextStatus: 'DECLINED' });
  });

  it('a viewer reads and writes nothing', () => {
    expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: viewer, command: create(), record: null }))
      .toMatchObject({ ok: false, status: 403, code: 'write_not_permitted' });
  });

  it('only an owner adopts or declines a proposal; its author may withdraw it', () => {
    const adopt = command({ operation: 'SET_STATUS', idempotencyKey: 'key-00000002', recordId: RECORD, expectedVersion: 3, status: 'ADOPTED' });
    expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: write, command: adopt, record: stored() }))
      .toMatchObject({ ok: false, code: 'capability_missing' });
    expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: owner, command: adopt, record: stored() })).toEqual({ ok: true, nextStatus: 'ADOPTED' });
    const withdraw = command({ operation: 'SET_STATUS', idempotencyKey: 'key-00000003', recordId: RECORD, expectedVersion: 3, status: 'WITHDRAWN' });
    expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: write, command: withdraw, record: stored() })).toEqual({ ok: true, nextStatus: 'WITHDRAWN' });
    const stranger: ProjectBrainProvenance = { ...PLAYER, author: { kind: 'WONDERLAND_PLAYER', id: 'player-2' } };
    expect(authorizeProjectBrainMutation({ provenance: stranger, capabilities: write, command: withdraw, record: stored() }))
      .toMatchObject({ ok: false, code: 'not_the_author' });
  });

  it('refuses a status move the lifecycle does not have', () => {
    const back = command({ operation: 'SET_STATUS', idempotencyKey: 'key-00000004', recordId: RECORD, expectedVersion: 3, status: 'PROPOSED' });
    expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: owner, command: back, record: stored({ status: 'ADOPTED' }) }))
      .toMatchObject({ ok: false, status: 409, code: 'status_move_invalid' });
  });

  it('an adopted term is not revised in place', () => {
    const revise = command({ operation: 'REVISE', idempotencyKey: 'key-00000005', recordId: RECORD, expectedVersion: 3, title: 'new' });
    expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: owner, command: revise, record: stored({ status: 'ADOPTED' }) }))
      .toMatchObject({ ok: false, code: 'record_not_revisable' });
  });

  it('a companion returns results for Julius and can never state a term, decide or adopt', () => {
    const result = create({ domain: 'COMPANION_RESULT', runId: 'run:abc', title: 'Found the cause.' });
    expect(authorizeProjectBrainMutation({ provenance: COMPANION, capabilities: owner, command: result, record: null })).toEqual({ ok: true, nextStatus: 'PROPOSED' });
    for (const domain of ['REQUIREMENT', 'DECISION', 'GOVERNANCE_ACK', 'CONSTRAINT']) {
      const attempt = create({ domain, subjectRef: domain === 'GOVERNANCE_ACK' ? 'approval:a1' : undefined });
      expect(authorizeProjectBrainMutation({ provenance: COMPANION, capabilities: owner, command: attempt, record: null }), domain)
        .toMatchObject({ ok: false, code: 'companion_cannot_redefine_mission' });
    }
    expect(authorizeProjectBrainMutation({
      provenance: { ...COMPANION, deliverer: { kind: 'WONDERLAND_CLIENT', id: 'w' } }, capabilities: owner, command: result, record: null,
    })).toMatchObject({ ok: false, code: 'companion_channel_required' });
    // And nobody but a companion states a companion result.
    expect(authorizeProjectBrainMutation({ provenance: PLAYER, capabilities: owner, command: result, record: null }))
      .toMatchObject({ ok: false, code: 'domain_not_authorable' });
  });

  it('keeps the author and the deliverer apart', () => {
    const collapsed: ProjectBrainProvenance = { author: { kind: 'FOUNDER', id: 'x' }, deliverer: { kind: 'OPERATOR_API', id: 'x' } };
    expect(authorizeProjectBrainMutation({ provenance: collapsed, capabilities: owner, command: create(), record: null })).toMatchObject({ ok: true });
    const sameHat = { author: { kind: 'FOUNDER', id: 'x' }, deliverer: { kind: 'FOUNDER', id: 'x' } } as unknown as ProjectBrainProvenance;
    expect(authorizeProjectBrainMutation({ provenance: sameHat, capabilities: owner, command: create(), record: null }))
      .toMatchObject({ ok: false, code: 'provenance_collapsed' });
  });

  it('every domain names who may author it, and only people and companions are authors here', () => {
    for (const domain of PROJECT_BRAIN_RECORD_DOMAINS) {
      const authors = PROJECT_BRAIN_DOMAIN_RULES[domain].authors;
      expect(authors.length, domain).toBeGreaterThan(0);
      for (const author of authors) expect(['FOUNDER', 'WONDERLAND_PLAYER', 'COMPANION'], `${domain} ${author}`).toContain(author);
    }
  });
});

describe('idempotency identity, event names and the feed cursor', () => {
  it('the same command from the same author has one identity; anything different does not', () => {
    const a = projectBrainRequestIdentity('prj-1', PLAYER, create());
    expect(projectBrainRequestIdentity('prj-1', PLAYER, create())).toBe(a);
    expect(projectBrainRequestIdentity('prj-2', PLAYER, create())).not.toBe(a);
    expect(projectBrainRequestIdentity('prj-1', PLAYER, create({ title: 'Different.' }))).not.toBe(a);
    expect(projectBrainRequestIdentity('prj-1', { ...PLAYER, author: { kind: 'WONDERLAND_PLAYER', id: 'player-2' } }, create())).not.toBe(a);
  });

  it("names Julius's own ledger events in the Project Brain's words, and never drops one", () => {
    expect(projectBrainEventTypeForJulius('julius.finding.recorded')).toBe('project_brain.finding.created');
    expect(projectBrainEventTypeForJulius('julius.run.created')).toBe('project_brain.mission.created');
    expect(projectBrainEventTypeForJulius('julius.run.paused')).toBe('project_brain.mission.state_changed');
    expect(projectBrainEventTypeForJulius('julius.evidence.recorded')).toBe('project_brain.evidence.recorded');
    expect(projectBrainEventTypeForJulius('julius.verification.decided')).toBe('project_brain.decision.recorded');
    expect(projectBrainEventTypeForJulius('julius.repair.scheduled')).toBe('project_brain.repair.started');
    expect(projectBrainEventTypeForJulius('julius.contract.locked')).toBe('project_brain.governance.updated');
    expect(projectBrainEventTypeForJulius('julius.claim.promoted')).toBe('project_brain.provenance.updated');
    expect(projectBrainEventTypeForJulius('julius.something.new')).toBe('project_brain.activity.recorded');
  });

  it('round-trips a cursor, refuses a forged one, and only ever moves it forward', () => {
    const cursor = { 'run:a': 4, 'project-brain:prj-1': 2 };
    expect(decodeProjectBrainCursor(encodeProjectBrainCursor(cursor))).toEqual(cursor);
    expect(decodeProjectBrainCursor(undefined)).toEqual({});
    for (const forged of ['x', 'pbc1.!!!', `pbc1.${Buffer.from('[1]').toString('base64url')}`, `pbc1.${Buffer.from('{"a":-1}').toString('base64url')}`, `pbc1.${Buffer.from('{"a":1.5}').toString('base64url')}`]) {
      expect(decodeProjectBrainCursor(forged), forged).toBeNull();
    }
    expect(advanceProjectBrainCursor(cursor, 'run:a', 3)).toBe(cursor);
    expect(advanceProjectBrainCursor(cursor, 'run:a', 5)).toEqual({ ...cursor, 'run:a': 5 });
    expect(advanceProjectBrainCursor(cursor, 'run:b', 1)).toEqual({ ...cursor, 'run:b': 1 });
  });
});
