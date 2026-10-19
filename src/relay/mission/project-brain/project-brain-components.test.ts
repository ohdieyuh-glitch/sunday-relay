import { describe, expect, it } from 'vitest';

import {
  PROJECT_BRAIN_CARD_DEFAULT_REF,
  PROJECT_BRAIN_COMPONENT_OPERATIONS,
  PROJECT_BRAIN_DEFAULT_CARD,
  authorizeProjectBrainComponentMutation,
  parseProjectBrainCardContent,
  parseProjectBrainComponentMutation,
  projectBrainCardRevision,
  projectBrainComponentEventType,
  projectBrainEvalQualifies,
  projectBrainHandoffMove,
  projectBrainLooksLikeRandomToken,
  type ProjectBrainComponentCommand,
} from './project-brain-components';
import type { ProjectBrainCapability, ProjectBrainProvenance } from './project-brain';

/**
 * THE C.A.R.D., HANDOFF AND EVAL RULES, PURE. Every refusal below is a case a store or a route would otherwise have
 * to catch after the fact; each one names its code, so a mutant that loosens a rule turns exactly one case red.
 */

// Synthetic credentials assembled at run time: the repository boundary scan forbids credential-shaped literals.
const FAKE = {
  sk: ['sk', 'FAKETESTNOTREAL', 'a1b2c3d4e5f6'].join('-'),
  ghp: `ghp_${'FAKETESTNOTREAL'}${'0'.repeat(12)}`,
  random: ['Zx9', 'Qw7', 'Lp3', 'Mn5', 'Rt2', 'Yu8', 'Kj4'].join(''),
  hex: 'deadbeefcafef00d1234567890abcdef',
  password: ['pass', 'word: FAKETESTNOTREAL99'].join(''),
};
const CARD = {
  name: 'Night shift',
  missionHandoff: 'angelic_twin_swords',
  skin: 'relay_og',
  outfit: '',
  primary: { key: 'WHITE', chosen: true },
  companions: [
    { slot: 1, kind: 'AGENT', providerId: 'claude-code', label: 'Jhinn' },
    { slot: 0, kind: 'LLM', providerId: 'openai', label: 'LLM Companion' },
  ],
  capabilities: [
    { kind: 'SKILL', id: 'pdf', label: 'PDF' },
    { kind: 'MCP', id: 'github-mcp-server', label: 'GitHub' },
  ],
};
const KEY = 'idem-key-0001';
const UUID = '0b9f2c1e-4d7a-4c3b-9e21-5f6a7b8c9d0e';

const player: ProjectBrainProvenance = { author: { kind: 'WONDERLAND_PLAYER', id: 'p1' }, deliverer: { kind: 'WONDERLAND_CLIENT', id: 'wonderland-session:s1' } };
const operator: ProjectBrainProvenance = { author: { kind: 'FOUNDER', id: 't1' }, deliverer: { kind: 'OPERATOR_API', id: 'relay-bridge:operator' } };
const runtime: ProjectBrainProvenance = { author: { kind: 'JULIUS', id: 'julius' }, deliverer: { kind: 'JULIUS_RUNTIME', id: 'relay-bridge:julius' } };
const companion: ProjectBrainProvenance = { author: { kind: 'COMPANION', id: 'c1' }, deliverer: { kind: 'COMPANION_CHANNEL', id: 'relay-bridge:companion-channel' } };
const OWNER: ProjectBrainCapability[] = ['brain:read', 'brain:write', 'brain:adopt'];
const EDITOR: ProjectBrainCapability[] = ['brain:read', 'brain:write'];
const VIEWER: ProjectBrainCapability[] = ['brain:read'];

const parsed = (input: unknown): ProjectBrainComponentCommand => {
  const result = parseProjectBrainComponentMutation(input);
  if (!result.ok) throw new Error(`expected a command, got ${result.code}`);
  return result.command;
};
const codeOf = (input: unknown): string => {
  const result = parseProjectBrainComponentMutation(input);
  return result.ok ? 'ok' : result.code;
};
const cardCode = (card: unknown): string => {
  const result = parseProjectBrainCardContent(card);
  return result.ok ? 'ok' : result.code;
};

describe('C.A.R.D. content', () => {
  it('keeps the typed loadout and puts it in canonical order (companions by slot, capabilities by kind then id)', () => {
    const result = parseProjectBrainCardContent(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return expect.unreachable();
    expect(result.card.companions.map((c) => c.slot)).toEqual([0, 1]);
    expect(result.card.capabilities.map((c) => `${c.kind}:${c.id}`)).toEqual(['MCP:github-mcp-server', 'SKILL:pdf']);
    expect(result.card.primary).toEqual({ key: 'WHITE', chosen: true });
  });

  it('defaults to the canonical form, skin and primary, exactly as the built-in card', () => {
    const result = parseProjectBrainCardContent({ name: 'Bare' });
    expect(result.ok && result.card).toEqual({ ...PROJECT_BRAIN_DEFAULT_CARD, name: 'Bare' });
  });

  it('REFUSES any credential, wherever it is put: name, label, provider id, capability id, primary key', () => {
    for (const secret of [FAKE.sk, FAKE.ghp, FAKE.random, FAKE.hex]) {
      expect(cardCode({ ...CARD, name: `mine ${secret}` }), `name ${secret.slice(0, 6)}`).toBe('credential_in_content');
      expect(cardCode({ ...CARD, companions: [{ slot: 0, kind: 'LLM', providerId: 'openai', label: secret }] })).toBe('credential_in_content');
      expect(cardCode({ ...CARD, capabilities: [{ kind: 'API', id: secret.replace(/[^A-Za-z0-9._-]/gu, ''), label: 'x' }] })).toBe('credential_in_content');
    }
    expect(cardCode({ ...CARD, companions: [{ slot: 0, kind: 'LLM', providerId: FAKE.random, label: '' }] })).toBe('credential_in_content');
    expect(cardCode({ ...CARD, primary: { key: FAKE.hex, chosen: true } })).toBe('credential_in_content');
    expect(cardCode({ ...CARD, name: FAKE.password })).toBe('credential_in_content');
  });

  it('a key hidden behind invisible characters is still a key', () => {
    const hidden = [...FAKE.random].join('​');
    expect(cardCode({ ...CARD, name: hidden.slice(0, 60) })).toBe('credential_in_content');
  });

  it('ordinary ids and labels pass the random-token screen', () => {
    for (const ok of ['claude-code', 'github-mcp-server', 'mcp-filesystem-v2', 'angelic_twin_swords', 'dev-single-agent', 'Night shift companion', 'openai-gpt-4o-mini', 'relay_og']) {
      expect(projectBrainLooksLikeRandomToken(ok), ok).toBe(false);
    }
    for (const bad of [FAKE.random, FAKE.hex, 'a1b2c3d4e5f6g7h8i9j0k1', 'AbCdEfGhIjKlMn0123OpQrSt']) {
      expect(projectBrainLooksLikeRandomToken(bad), bad).toBe(true);
    }
  });

  it('refuses unknown fields at every level (a closed shape: nothing untyped is stored)', () => {
    expect(cardCode({ ...CARD, apiKey: 'x' })).toBe('unknown_field');
    expect(cardCode({ ...CARD, primary: { key: 'WHITE', chosen: true, rgb: '#fff' } })).toBe('unknown_field');
    expect(cardCode({ ...CARD, companions: [{ slot: 0, kind: 'LLM', providerId: 'openai', label: '', token: 'x' }] })).toBe('unknown_field');
    expect(cardCode({ ...CARD, capabilities: [{ kind: 'MCP', id: 'a', label: '', url: 'x' }] })).toBe('unknown_field');
  });

  it('holds the canonical slots and the limits: two companions, one per side; 32 capabilities, no duplicates', () => {
    expect(cardCode({ ...CARD, companions: [{ slot: 0, kind: 'LLM', providerId: 'a', label: '' }, { slot: 0, kind: 'AGENT', providerId: 'b', label: '' }] })).toBe('card_invalid');
    expect(cardCode({ ...CARD, companions: [{ slot: 2, kind: 'LLM', providerId: 'a', label: '' }] })).toBe('card_invalid');
    expect(cardCode({ ...CARD, companions: [0, 1, 0].map((slot, i) => ({ slot, kind: 'LLM', providerId: `p${String(i)}`, label: '' })) })).toBe('card_invalid');
    expect(cardCode({ ...CARD, capabilities: Array.from({ length: 33 }, (_, i) => ({ kind: 'SKILL', id: `s${String(i)}`, label: '' })) })).toBe('card_invalid');
    expect(cardCode({ ...CARD, capabilities: [{ kind: 'SKILL', id: 'pdf', label: '' }, { kind: 'SKILL', id: 'pdf', label: '' }] })).toBe('card_invalid');
    expect(cardCode({ ...CARD, companions: [{ slot: 0, kind: 'WIZARD', providerId: 'a', label: '' }] })).toBe('card_invalid');
    expect(cardCode({ ...CARD, name: 'x'.repeat(65) })).toBe('field_too_long');
    expect(cardCode({ ...CARD, name: ' ' })).toBe('field_required');
    expect(cardCode({ ...CARD, skin: 'relay og' })).toBe('id_invalid');
  });
});

describe('component commands', () => {
  it('every operation parses with exactly its own keys and refuses any other', () => {
    expect(PROJECT_BRAIN_COMPONENT_OPERATIONS).toHaveLength(9);
    expect(codeOf({ operation: 'CARD_CREATE', idempotencyKey: KEY, card: CARD, author: 'me' })).toBe('unknown_field');
    expect(codeOf({ operation: 'HANDOFF_ENTER', idempotencyKey: KEY, runId: 'run:1', expectedVersion: 0, missionId: 'new' })).toBe('unknown_field');
    expect(codeOf({ operation: 'MISSION_PIN_CARD', idempotencyKey: KEY, runId: 'run:1', cardRef: PROJECT_BRAIN_CARD_DEFAULT_REF })).toBe('unknown_field');
    expect(codeOf({ operation: 'CREATE' })).toBe('operation_invalid');
    expect(codeOf({ operation: 'CARD_CREATE', card: CARD })).toBe('idempotency_key_required');
  });

  it('a change never applies blind: update, delete, handoff and invalidate name the version they change', () => {
    expect(codeOf({ operation: 'CARD_UPDATE', idempotencyKey: KEY, cardId: `pbcard:${UUID}`, card: CARD })).toBe('expected_version_required');
    expect(codeOf({ operation: 'CARD_DELETE', idempotencyKey: KEY, cardId: `pbcard:${UUID}`, expectedVersion: 0 })).toBe('expected_version_required');
    expect(codeOf({ operation: 'HANDOFF_EXIT', idempotencyKey: KEY, runId: 'run:1' })).toBe('expected_version_required');
    expect(codeOf({ operation: 'CARD_SELECT', idempotencyKey: KEY, cardRef: PROJECT_BRAIN_CARD_DEFAULT_REF })).toBe('expected_version_required');
    expect(codeOf({ operation: 'EVAL_INVALIDATE', idempotencyKey: KEY, evalId: `pbeval:${UUID}`, expectedVersion: 1.5 })).toBe('expected_version_required');
    expect(parsed({ operation: 'HANDOFF_ENTER', idempotencyKey: KEY, runId: 'run:1', expectedVersion: 0 })).toMatchObject({ expectedVersion: 0 });
  });

  it('the built-in default can be selected but never edited or deleted', () => {
    expect(parsed({ operation: 'CARD_SELECT', idempotencyKey: KEY, cardRef: PROJECT_BRAIN_CARD_DEFAULT_REF, expectedSelectionVersion: 0 })).toMatchObject({ cardRef: 'pbcard:default' });
    expect(codeOf({ operation: 'CARD_UPDATE', idempotencyKey: KEY, cardId: PROJECT_BRAIN_CARD_DEFAULT_REF, expectedVersion: 1, card: CARD })).toBe('card_invalid');
    expect(codeOf({ operation: 'CARD_DELETE', idempotencyKey: KEY, cardId: PROJECT_BRAIN_CARD_DEFAULT_REF, expectedVersion: 1 })).toBe('card_invalid');
    expect(projectBrainCardRevision(PROJECT_BRAIN_CARD_DEFAULT_REF, 1)).toBe('pbcard:default@v1');
  });

  it('an eval names an exact revision, one criterion and, for a PASS, its evidence', () => {
    const base = { operation: 'EVAL_RECORD', idempotencyKey: KEY, runId: 'run:1', subjectRef: 'artifact:a1', criterion: 'tests pass', result: 'PASS', evidenceRefs: ['evidence:e1'] };
    expect(parsed({ ...base, subjectRevision: 'sha256:' + 'a'.repeat(64) })).toMatchObject({ subjectRevision: `sha256:${'a'.repeat(64)}` });
    expect(parsed({ ...base, subjectRevision: '5a59f79f7ea92495e751149babcc2dec69558c6c' })).toMatchObject({ result: 'PASS' });
    expect(codeOf({ ...base, subjectRevision: undefined })).toBe('subject_revision_required');
    expect(codeOf({ ...base, subjectRevision: FAKE.random })).toBe('credential_in_content');
    expect(codeOf({ ...base, subjectRevision: 'c1', evidenceRefs: [] })).toBe('evidence_required');
    expect(codeOf({ ...base, subjectRevision: 'c1', result: 'FAIL', evidenceRefs: [] })).toBe('ok');
    expect(codeOf({ ...base, subjectRevision: 'c1', evidenceRefs: ['blob:x'] })).toBe('evidence_invalid');
    expect(codeOf({ ...base, subjectRevision: 'c1', criterion: `uses ${FAKE.sk}` })).toBe('credential_in_content');
    expect(codeOf({ ...base, subjectRevision: 'c1', result: 'MOSTLY' })).toBe('result_invalid');
  });
});

describe('who may do it', () => {
  const create = parsed({ operation: 'CARD_CREATE', idempotencyKey: KEY, card: CARD });
  const update = parsed({ operation: 'CARD_UPDATE', idempotencyKey: KEY, cardId: `pbcard:${UUID}`, expectedVersion: 1, card: CARD });
  const pin = parsed({ operation: 'MISSION_PIN_CARD', idempotencyKey: KEY, runId: 'run:1' });
  const evalRecord = parsed({ operation: 'EVAL_RECORD', idempotencyKey: KEY, runId: null, subjectRef: 'artifact:a1', subjectRevision: 'c1', criterion: 'x', result: 'FAIL', evidenceRefs: [] });
  const invalidate = parsed({ operation: 'EVAL_INVALIDATE', idempotencyKey: KEY, evalId: `pbeval:${UUID}`, expectedVersion: 1 });
  const handoff = parsed({ operation: 'HANDOFF_ENTER', idempotencyKey: KEY, runId: 'run:1', expectedVersion: 0 });
  const verdict = (provenance: ProjectBrainProvenance, capabilities: ProjectBrainCapability[], command: ProjectBrainComponentCommand, cardAuthor?: { kind: string; id: string } | null) => {
    const result = authorizeProjectBrainComponentMutation({ provenance, capabilities, command, cardAuthor });
    return result.ok ? 'ok' : result.code;
  };

  it('a viewer changes nothing; an editor creates and hands off', () => {
    expect(verdict(player, VIEWER, create)).toBe('write_not_permitted');
    expect(verdict(player, EDITOR, create)).toBe('ok');
    expect(verdict(player, EDITOR, handoff)).toBe('ok');
  });

  it('only the author or an owner changes a card', () => {
    expect(verdict(player, EDITOR, update, { kind: 'WONDERLAND_PLAYER', id: 'p1' })).toBe('ok');
    expect(verdict(player, EDITOR, update, { kind: 'WONDERLAND_PLAYER', id: 'p2' })).toBe('not_the_author');
    expect(verdict(player, OWNER, update, { kind: 'WONDERLAND_PLAYER', id: 'p2' })).toBe('ok');
    expect(verdict(player, OWNER, update, null)).toBe('card_not_found');
  });

  it('a client never pins a mission to a card; the runtime and the operator do', () => {
    expect(verdict(player, OWNER, pin)).toBe('pin_not_permitted');
    expect(verdict(runtime, EDITOR, pin)).toBe('ok');
    expect(verdict(operator, EDITOR, pin)).toBe('ok');
  });

  it('a player cannot record an eval; an owner invalidates one', () => {
    expect(verdict(player, OWNER, evalRecord)).toBe('evaluator_required');
    expect(verdict(runtime, EDITOR, evalRecord)).toBe('ok');
    expect(verdict(operator, EDITOR, invalidate)).toBe('capability_missing');
    expect(verdict(operator, OWNER, invalidate)).toBe('ok');
  });

  it('a companion configures, hands off and judges nothing, whatever its membership', () => {
    for (const command of [create, handoff, evalRecord, pin]) expect(verdict(companion, OWNER, command)).toBe('companion_cannot_redefine_mission');
  });

  it('author and deliverer are different facts', () => {
    expect(verdict({ author: { kind: 'FOUNDER', id: 'x' }, deliverer: { kind: 'FOUNDER' as never, id: 'x' } }, OWNER, create)).toBe('provenance_collapsed');
  });
});

describe('the handoff move', () => {
  it('enters from nothing or a return, exits only from a handoff', () => {
    expect(projectBrainHandoffMove({ operation: 'HANDOFF_ENTER', current: null, runState: 'EXECUTING' })).toEqual({ ok: true, next: 'HANDED_OFF' });
    expect(projectBrainHandoffMove({ operation: 'HANDOFF_ENTER', current: 'RETURNED', runState: 'REVIEWING' })).toEqual({ ok: true, next: 'HANDED_OFF' });
    expect(projectBrainHandoffMove({ operation: 'HANDOFF_EXIT', current: 'HANDED_OFF', runState: 'EXECUTING' })).toEqual({ ok: true, next: 'RETURNED' });
  });

  it('a repeated /handoff is not a second handoff, and a return without one is not a return', () => {
    expect(projectBrainHandoffMove({ operation: 'HANDOFF_ENTER', current: 'HANDED_OFF', runState: 'EXECUTING' })).toMatchObject({ code: 'already_handed_off' });
    expect(projectBrainHandoffMove({ operation: 'HANDOFF_EXIT', current: null, runState: 'EXECUTING' })).toMatchObject({ code: 'not_handed_off' });
    expect(projectBrainHandoffMove({ operation: 'HANDOFF_EXIT', current: 'RETURNED', runState: 'EXECUTING' })).toMatchObject({ code: 'not_handed_off' });
  });

  it('a finished mission cannot be handed off, but a handed-off one can always return', () => {
    for (const state of ['COMPLETED', 'FAILED', 'CANCELLED']) {
      expect(projectBrainHandoffMove({ operation: 'HANDOFF_ENTER', current: null, runState: state })).toMatchObject({ code: 'mission_finished' });
      expect(projectBrainHandoffMove({ operation: 'HANDOFF_EXIT', current: 'HANDED_OFF', runState: state })).toEqual({ ok: true, next: 'RETURNED' });
    }
    for (const state of ['CREATED', 'BLOCKED', 'PAUSED', 'REPAIRING']) {
      expect(projectBrainHandoffMove({ operation: 'HANDOFF_ENTER', current: null, runState: state })).toEqual({ ok: true, next: 'HANDED_OFF' });
    }
  });
});

describe('an eval qualifies only what it judged', () => {
  const current = { evalId: `pbeval:${UUID}`, subjectRef: 'artifact:a1', subjectRevision: 'c2', criterion: 'tests pass', result: 'PASS', status: 'CURRENT' } as const;
  it('a CURRENT PASS of exactly this revision qualifies it', () => {
    expect(projectBrainEvalQualifies(current, 'artifact:a1', 'c2')).toBe(true);
  });
  it('an old revision, another subject, a superseded or invalidated eval, or a non-PASS qualifies nothing', () => {
    expect(projectBrainEvalQualifies(current, 'artifact:a1', 'c3')).toBe(false);
    expect(projectBrainEvalQualifies(current, 'artifact:a2', 'c2')).toBe(false);
    expect(projectBrainEvalQualifies({ ...current, status: 'SUPERSEDED' }, 'artifact:a1', 'c2')).toBe(false);
    expect(projectBrainEvalQualifies({ ...current, status: 'INVALIDATED' }, 'artifact:a1', 'c2')).toBe(false);
    expect(projectBrainEvalQualifies({ ...current, result: 'INCONCLUSIVE' }, 'artifact:a1', 'c2')).toBe(false);
  });
});

describe('events', () => {
  it('every operation is announced under one name in the project_brain vocabulary', () => {
    const names = PROJECT_BRAIN_COMPONENT_OPERATIONS.map(projectBrainComponentEventType);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith('project_brain.'))).toBe(true);
  });
});
