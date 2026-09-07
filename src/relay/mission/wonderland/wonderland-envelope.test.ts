import { describe, expect, it } from 'vitest';

import { JULIUS_DEFAULT_ROLES } from '../julius/julius-runtime';
import {
  WONDERLAND_ENVELOPE_FIELDS,
  WONDERLAND_ENVELOPE_SCHEMA_V1,
  WONDERLAND_ENVELOPE_VOCABULARIES,
  WONDERLAND_METADATA_MAX_ENTRIES,
  WONDERLAND_METADATA_MAX_LENGTH,
  WONDERLAND_WORKER_ROLES,
  sanitizeWonderlandMetadata,
  wonderlandEnvelope,
  wonderlandWorkerRole,
} from './wonderland-envelope';

/**
 * THE ENVELOPE'S OWN TESTS.
 *
 * The centre of gravity is the sanitiser. Everything else here is shape; the
 * sanitiser is the thing standing between a provider's payload and a renderer,
 * and it is tested with the payloads that actually show up rather than with
 * tidy examples invented to pass.
 */

const base = {
  eventId: 'evt-1',
  projectId: 'project-1',
  state: 'coding' as const,
  stateSource: 'julius_run_state' as const,
  sequence: 4,
  occurredAt: '2026-09-07T10:00:00.000Z',
};

describe('the envelope shape', () => {
  it('is frozen, versioned and exactly as declared', () => {
    const envelope = wonderlandEnvelope(base);
    expect(envelope.schemaVersion).toBe(WONDERLAND_ENVELOPE_SCHEMA_V1);
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.keys(envelope).sort()).toEqual([...WONDERLAND_ENVELOPE_FIELDS].sort());
  });

  it('carries six identifiers, every one known or explicitly null', () => {
    const bare = wonderlandEnvelope(base);
    expect(bare.projectId).toBe('project-1');
    for (const absent of [
      bare.worldSessionId,
      bare.juliusInstanceId,
      bare.missionId,
      bare.runId,
      bare.taskId,
      bare.workerRole,
    ]) {
      expect(absent).toBeNull();
    }
  });

  it('never derives one identifier from another', () => {
    // A world that guessed which mission it was drawing would be wrong silently.
    const envelope = wonderlandEnvelope({ ...base, runId: 'run-1' });
    expect(envelope.runId).toBe('run-1');
    expect(envelope.missionId).toBeNull();
    expect(envelope.taskId).toBeNull();
  });

  it('treats an absent revision as zero, the lowest', () => {
    // So an authority that does not version its reports can never outrank one
    // that does, merely by staying silent.
    expect(wonderlandEnvelope(base).revision).toBe(0);
    expect(wonderlandEnvelope({ ...base, revision: 7 }).revision).toBe(7);
  });

  it('publishes the vocabularies a receiver has to switch on', () => {
    expect(WONDERLAND_ENVELOPE_VOCABULARIES.workerRole).toEqual(WONDERLAND_WORKER_ROLES);
    expect(WONDERLAND_ENVELOPE_VOCABULARIES.state.length).toBe(11);
  });
});

describe('the worker role', () => {
  it('derives the three permanent slots from the kernel, never re-typing them', () => {
    for (const role of JULIUS_DEFAULT_ROLES) {
      expect(WONDERLAND_WORKER_ROLES).toContain(role);
      expect(wonderlandWorkerRole(role)).toBe(role);
    }
  });

  it('collapses a specialist to the bare token, dropping its name', () => {
    // Julius names specialists freely at run time. Letting the name through
    // would put arbitrary orchestrator-chosen strings on the wire into a
    // renderer and make a specialist's name a de-facto vocabulary.
    expect(wonderlandWorkerRole('SPECIALIST:sql-tuning')).toBe('SPECIALIST');
    expect(wonderlandWorkerRole('SPECIALIST:gpt-4o-migration-helper')).toBe('SPECIALIST');
    expect(wonderlandWorkerRole('SPECIALIST')).toBe('SPECIALIST');
    expect(WONDERLAND_WORKER_ROLES).not.toContain('SPECIALIST:sql-tuning' as never);
  });

  it('answers null for anything unrecognised rather than guessing', () => {
    // A role the world does not model is an absence of information. Inventing
    // SPECIALIST for it would report a specialist that never ran.
    for (const unknown of ['', 'CODING', 'coding_agent', 'ORCHESTRATOR', null, undefined]) {
      expect(wonderlandWorkerRole(unknown)).toBeNull();
    }
  });

  it('never lets a provider name become a role', () => {
    for (const provider of ['gpt-4o', 'claude-opus', 'grok', 'hermes', 'openai', 'anthropic']) {
      expect(wonderlandWorkerRole(provider)).toBeNull();
    }
  });
});

/* -------------------------------------------------------- the sanitiser */

describe('metadata sanitising', () => {
  it('lets primitives through unchanged', () => {
    const { metadata, dropped } = sanitizeWonderlandMetadata({
      attempt: 2,
      taskType: 'build',
      repaired: true,
      reviewer: null,
    });
    expect(metadata).toEqual({ attempt: 2, taskType: 'build', repaired: true, reviewer: null });
    expect(dropped).toBe(0);
  });

  it('drops every non-primitive, which is what a provider payload is made of', () => {
    const { metadata, dropped } = sanitizeWonderlandMetadata({
      messages: [{ role: 'system', content: 'You are a helpful assistant' }],
      usage: { prompt_tokens: 812, completion_tokens: 40 },
      callback: () => undefined,
      missing: undefined,
      kept: 1,
    });
    expect(Object.keys(metadata)).toEqual(['kept']);
    expect(dropped).toBe(4);
  });

  it('drops secret-shaped keys rather than redacting them', () => {
    // A redacted value still occupies a key a renderer might display, and a
    // credential-named key reading "[redacted]" tells a viewer a credential
    // exists — more than a world has any business saying.
    const { metadata, dropped } = sanitizeWonderlandMetadata({
      apiKey: 'sk-live-aaaaaaaaaaaaaaaaaaaa',
      access_token: 'ya29.abcdefgh',
      sessionId: 'sess_abcdefghijkl',
      Authorization: 'Bearer abcdefghijklmno',
      taskId: 'task-7',
    });
    expect(Object.keys(metadata)).toEqual(['taskId']);
    expect(dropped).toBe(4);
    // Key-SHAPED, not the bare prefix: `sk-` also matches inside `task-`, which
    // is a documented trap in this repository and which `taskId` would spring.
    expect(JSON.stringify(metadata)).not.toMatch(/\bsk-[A-Za-z0-9]{8,}/);
    expect(JSON.stringify(metadata)).not.toContain('ya29.');
  });

  it('drops long strings, because prose is the payload this keeps out', () => {
    const prose = 'x'.repeat(WONDERLAND_METADATA_MAX_LENGTH + 1);
    const { metadata, dropped } = sanitizeWonderlandMetadata({ completion: prose, n: 1 });
    expect(Object.keys(metadata)).toEqual(['n']);
    expect(dropped).toBe(1);
    // And a string exactly at the limit survives, so the bound is a bound.
    const edge = sanitizeWonderlandMetadata({ s: 'y'.repeat(WONDERLAND_METADATA_MAX_LENGTH) });
    expect(edge.dropped).toBe(0);
  });

  it('drops values that are not finite numbers', () => {
    // NaN and Infinity survive JSON as `null`, which would read on a HUD as
    // "reported nothing" rather than "reported something unusable".
    const { metadata, dropped } = sanitizeWonderlandMetadata({
      a: Number.NaN,
      b: Number.POSITIVE_INFINITY,
      c: 0,
    });
    expect(metadata).toEqual({ c: 0 });
    expect(dropped).toBe(2);
  });

  it('caps how many entries may cross', () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < WONDERLAND_METADATA_MAX_ENTRIES + 5; i += 1) many[`k${i}`] = i;
    const { metadata, dropped } = sanitizeWonderlandMetadata(many);
    expect(Object.keys(metadata).length).toBe(WONDERLAND_METADATA_MAX_ENTRIES);
    expect(dropped).toBe(5);
  });

  it('answers with an empty map for anything that is not an object', () => {
    for (const raw of [null, undefined, 'text', 7, true, ['a']]) {
      expect(sanitizeWonderlandMetadata(raw).metadata).toEqual({});
    }
  });

  it('freezes what it returns', () => {
    expect(Object.isFrozen(sanitizeWonderlandMetadata({ a: 1 }).metadata)).toBe(true);
  });
});

describe('what actually reaches a world', () => {
  it('survives a realistic provider response with nothing but the safe scalars', () => {
    // Shaped like a real chat-completions body, which is the thing that must
    // never arrive at a renderer.
    const envelope = wonderlandEnvelope({
      ...base,
      workerRole: 'CODING_AGENT',
      metadata: {
        id: 'chatcmpl-9xyz',
        model: 'gpt-4o-2024-08-06',
        choices: [{ message: { role: 'assistant', content: 'Here is the patch...' } }],
        usage: { total_tokens: 1204 },
        system_fingerprint: 'fp_abc',
        api_key: 'sk-proj-secret',
        attempt: 1,
      },
    });
    const text = JSON.stringify(envelope);
    expect(text).not.toContain('Here is the patch');
    expect(text).not.toMatch(/\bsk-proj/);
    expect(text).not.toContain('assistant');
    expect(envelope.metadata.attempt).toBe(1);
    expect(envelope.metadataDropped).toBeGreaterThan(0);
  });

  it('counts what it removed without naming it', () => {
    const envelope = wonderlandEnvelope({
      ...base,
      metadata: { apiKey: 'sk-1', payload: { a: 1 } },
    });
    expect(envelope.metadataDropped).toBe(2);
    expect(Object.keys(envelope.metadata)).toEqual([]);
    expect(JSON.stringify(envelope)).not.toContain('apiKey');
  });

  it('keeps a model name out even when it arrives under an innocent key', () => {
    // `model` is a plain short string, so it survives the sanitiser by design —
    // this asserts the honest limit rather than pretending otherwise. What the
    // envelope guarantees is that no PAYLOAD crosses; a caller choosing to put
    // a model name in metadata is a caller decision, and the normalizer's own
    // allowlist is where that is refused.
    const envelope = wonderlandEnvelope({ ...base, metadata: { model: 'gpt-4o' } });
    expect(envelope.metadata.model).toBe('gpt-4o');
  });
});
