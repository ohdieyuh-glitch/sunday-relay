import { describe, expect, it } from 'vitest';

import { projectTerminalEvent } from '../../mission/terminal';
import { COMPOUND_AGENT_SLOTS } from '../compound-agent';
import {
  INTERNAL_FAILURE_LINE,
  JULIUS_EVENT_ACTORS,
  PRIVATE_REASONING_LINE,
  PROJECTED_EVENT_KINDS,
  TERMINAL_LINE_MAX,
  TERMINAL_ROLE_LABELS,
  UNRECOGNISED_LINE,
  containsPrivateReasoning,
  factKeyIsSecretShaped,
  humanizeCapability,
  humanizeTaskReference,
  projectJuliusEvent,
  projectJuliusEvents,
  redactBoundaryText,
  type JuliusEventActor,
  type JuliusOperationalEvent,
} from './index';

/**
 * THE LIVE TERMINAL, ADVERSARIALLY.
 *
 * A terminal is the one surface where a leak is visible, screenshot-able and
 * permanent. So this file spends most of its length trying to get something
 * out of the projection that should never appear in it.
 */

const event = (over: Partial<JuliusOperationalEvent> = {}): JuliusOperationalEvent => ({
  eventId: 'evt-1', sequence: 1, occurredAt: '2026-08-27T03:00:00.000Z',
  runId: 'run-1', kind: 'run.created', actor: 'JULIUS',
  safeSummary: '', taskId: null, severity: null, facts: {}, ...over,
});

/* ------------------------------------------------------------ the labels */

describe('the permanent role labels', () => {
  it('labels every declared actor', () => {
    for (const actor of JULIUS_EVENT_ACTORS) {
      expect(TERMINAL_ROLE_LABELS[actor], actor).toBeTruthy();
    }
    expect(Object.keys(TERMINAL_ROLE_LABELS).sort()).toEqual([...JULIUS_EVENT_ACTORS].sort());
  });

  it('renders exactly the founder-specified labels', () => {
    expect(Object.values(TERMINAL_ROLE_LABELS).sort()).toEqual([
      'C.A.R.D.', 'Coding Agent', 'Gauntlet', 'Independent Reviewer', 'Julius',
      'Project Brain', 'Prompt Architect', 'Relay System', 'Relay Verification', 'Sub-Agent',
    ]);
  });

  it('derives the three worker actors from the worker slots, so neither can drift', () => {
    for (const slot of COMPOUND_AGENT_SLOTS) {
      expect(JULIUS_EVENT_ACTORS, slot).toContain(slot);
      expect(TERMINAL_ROLE_LABELS[slot], slot).toBeTruthy();
    }
  });

  it('never labels a line with a provider or model name', () => {
    const labels = Object.values(TERMINAL_ROLE_LABELS).join(' ').toLowerCase();
    for (const vendor of ['gpt', 'openai', 'claude', 'anthropic', 'hermes', 'grok', 'xai', 'gemini']) {
      expect(labels, vendor).not.toContain(vendor);
    }
  });

  it('puts the label in brackets at the head of every line', () => {
    for (const actor of JULIUS_EVENT_ACTORS) {
      const entry = projectJuliusEvent(event({ actor, kind: 'run.created' }));
      expect(entry.line).toBe(`[${TERMINAL_ROLE_LABELS[actor]}] Run created`);
      expect(entry.label).toBe(TERMINAL_ROLE_LABELS[actor]);
    }
  });
});

/* -------------------------------------------------- the founder's examples */

describe('the specified projections', () => {
  it('[Coding Agent] Task 17 started', () => {
    const entry = projectJuliusEvent(event({
      kind: 'worker.dispatched', actor: 'CODING_AGENT', facts: { task: 'task_17' },
    }));
    expect(entry.line).toBe('[Coding Agent] Task 17 started');
    expect(entry.recognized).toBe(true);
  });

  it('[Relay Verification] Verification failed · 2 blocking findings', () => {
    const entry = projectJuliusEvent(event({
      kind: 'verification.failed', actor: 'RELAY_VERIFICATION',
      facts: { blockingFindings: 2 }, severity: 'blocking',
    }));
    expect(entry.line).toBe('[Relay Verification] Verification failed · 2 blocking findings');
    expect(entry.severity).toBe('blocking');
  });

  it('[Julius] Repair round 2 scheduled', () => {
    const entry = projectJuliusEvent(event({
      kind: 'repair.scheduled', actor: 'JULIUS', facts: { round: 2 },
    }));
    expect(entry.line).toBe('[Julius] Repair round 2 scheduled');
  });

  it('[Sub-Agent] Security review started', () => {
    const entry = projectJuliusEvent(event({
      kind: 'subagent.authorized', actor: 'SUB_AGENT', facts: { capability: 'security-review' },
    }));
    expect(entry.line).toBe('[Sub-Agent] Security review started');
  });

  it('[Gauntlet] GAUNTLET CLEARED', () => {
    const entry = projectJuliusEvent(event({ kind: 'gauntlet.completed', actor: 'GAUNTLET' }));
    expect(entry.line).toBe('[Gauntlet] GAUNTLET CLEARED');
  });
});

/* --------------------------------------------------------- fact-composed */

describe('headlines are composed from facts, never parsed out of prose', () => {
  it('pluralizes a count instead of printing "finding(s)"', () => {
    const one = projectJuliusEvent(event({
      kind: 'verification.failed', actor: 'RELAY_VERIFICATION', facts: { blockingFindings: 1 },
    }));
    expect(one.headline).toBe('Verification failed · 1 blocking finding');
    const none = projectJuliusEvent(event({
      kind: 'verification.failed', actor: 'RELAY_VERIFICATION', facts: { blockingFindings: 0 },
    }));
    expect(none.headline).toBe('Verification failed · 0 blocking findings');
  });

  it('falls back to the event summary rather than rendering an undefined value', () => {
    const entry = projectJuliusEvent(event({
      kind: 'worker.dispatched', actor: 'CODING_AGENT', facts: {},
      safeSummary: 'A worker was dispatched.',
    }));
    expect(entry.headline).toBe('A worker was dispatched.');
    expect(entry.headline).not.toContain('undefined');
    expect(entry.headline).not.toContain('null');
  });

  it('ignores a count that is not a real count', () => {
    for (const bad of [-1, 1.5, Number.NaN, '2', null, true]) {
      const entry = projectJuliusEvent(event({
        kind: 'verification.failed', actor: 'RELAY_VERIFICATION',
        facts: { blockingFindings: bad as never },
      }));
      expect(entry.headline, String(bad)).toBe('Verification failed');
    }
  });

  it('leaves an identifier alone when it is not the one shape Julius emits', () => {
    for (const id of ['tsk_abc', 'task-x', '17', 'TASK_17_RETRY']) {
      expect(humanizeTaskReference(id), id).toBe(id);
    }
    expect(humanizeTaskReference('task_17')).toBe('Task 17');
    expect(humanizeTaskReference('task-3')).toBe('Task 3');
  });

  it('leaves a capability alone when it is not a plain token', () => {
    for (const capability of ['Security Review', 'sec::review', 'RE-VIEW', '9lives']) {
      expect(humanizeCapability(capability), capability).toBe(capability);
    }
    expect(humanizeCapability('security-review')).toBe('Security review');
    expect(humanizeCapability('static_analysis')).toBe('Static analysis');
  });
});

/* ---------------------------------------------------------- unknown kinds */

describe('an unrecognised event is rendered safely, never dropped or invented', () => {
  it('renders the event\'s own summary and marks it unrecognised', () => {
    const entry = projectJuliusEvent(event({
      kind: 'julius.something.brand.new', actor: 'JULIUS',
      safeSummary: 'A new kind of thing happened.',
    }));
    expect(entry.recognized).toBe(false);
    expect(entry.line).toBe('[Julius] A new kind of thing happened.');
    expect(entry.eventKind).toBe('julius.something.brand.new');
  });

  it('says so plainly when there is no summary either', () => {
    const entry = projectJuliusEvent(event({ kind: 'julius.mystery', safeSummary: '   ' }));
    expect(entry.recognized).toBe(false);
    expect(entry.headline).toContain(UNRECOGNISED_LINE);
    expect(entry.headline).toContain('julius.mystery');
  });

  it('does not crash on a malformed event', () => {
    const malformed = [
      { kind: '' }, { safeSummary: null as never }, { facts: null as never },
      { actor: 'NOT_AN_ACTOR' as never }, { severity: 'catastrophic' as never },
      { taskId: undefined as never },
    ];
    for (const over of malformed) {
      const entry = projectJuliusEvent(event(over));
      expect(typeof entry.line, JSON.stringify(over)).toBe('string');
      expect(entry.line.length).toBeGreaterThan(0);
    }
  });

  it('falls back to Relay System for an actor it does not know', () => {
    const entry = projectJuliusEvent(event({ actor: 'FORGED_ACTOR' as never }));
    expect(entry.label).toBe('Relay System');
  });

  it('has a projection for every kind it claims to project, and no empty ones', () => {
    expect(PROJECTED_EVENT_KINDS.length).toBeGreaterThan(0);
    for (const kind of PROJECTED_EVENT_KINDS) {
      const entry = projectJuliusEvent(event({ kind }));
      expect(entry.recognized, kind).toBe(true);
      expect(entry.headline.trim(), kind).not.toBe('');
    }
  });
});

/* ------------------------------------------------------------- redaction */

describe('secrets never reach the terminal', () => {
  const SECRETS: ReadonlyArray<[string, string]> = [
    ['an OpenAI key', 'sk-abcdefghijklmnopqrstuvwx'],
    ['a GitHub token', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'],
    ['an AWS access key', 'AKIAIOSFODNN7EXAMPLE'],
    ['a Slack token', 'xoxb-1234567890-abcdefghij'],
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig'],
    ['an Authorization header', 'Authorization: Bearer abcdefghijklmnopqrstuv'],
    ['a bare bearer credential', 'Bearer abcdefghijklmnopqrstuvwxyz'],
    ['a basic credential', 'Basic YWxhZGRpbjpvcGVuc2VzYW1l'],
    ['a provider session id', 'sess_01HQXYZABCDEFGH12345'],
    ['a connection string', 'postgres://relay:hunter2@db.internal:5432/relay'],
    ['a private key header', '-----BEGIN RSA PRIVATE KEY-----'],
    ['an api_key assignment', 'api_key: 9f8e7d6c5b4a39281706'],
    ['an env-style secret', 'ANTHROPIC_API_KEY=sk-ant-abcdefghijklmno'],
    ['an aws secret assignment', 'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG'],
  ];

  for (const [label, secret] of SECRETS) {
    it(`redacts ${label} from a summary`, () => {
      const entry = projectJuliusEvent(event({
        kind: 'julius.unknown', safeSummary: `Dispatch failed: ${secret} was rejected.`,
      }));
      expect(entry.line, label).not.toContain(secret);
      expect(entry.redactionsApplied, label).toBeGreaterThan(0);
    });

    it(`redacts ${label} from a fact used in a headline`, () => {
      const entry = projectJuliusEvent(event({
        kind: 'run.paused', actor: 'JULIUS', facts: { reason: `blocked by ${secret}` },
      }));
      expect(entry.line, label).not.toContain(secret);
    });
  }

  it('drops a fact whose key could only hold a secret, rather than showing it redacted', () => {
    for (const key of ['apiKey', 'api_key', 'token', 'accessToken', 'secret', 'password',
      'credential', 'sessionId', 'authorization', 'cookie', 'signature']) {
      expect(factKeyIsSecretShaped(key), key).toBe(true);
      const entry = projectJuliusEvent(event({
        kind: 'run.paused', actor: 'JULIUS', facts: { [key]: 'super-secret-value', reason: null },
      }));
      expect(entry.line, key).not.toContain('super-secret-value');
      expect(entry.line, key).toBe('[Julius] Run paused');
    }
  });

  it('does not mistake an ordinary word for a secret key', () => {
    for (const key of ['keyboard', 'monkey', 'tokenizer', 'passwordless', 'reason', 'round', 'task']) {
      expect(factKeyIsSecretShaped(key), key).toBe(false);
    }
  });

  it('redacts inside a fact used verbatim, not only inside prose', () => {
    const entry = projectJuliusEvent(event({
      kind: 'card.denied', actor: 'CARD',
      facts: { operation: 'USE_PROVIDER with Bearer abcdefghijklmnopqrst' },
    }));
    expect(entry.line).not.toContain('abcdefghijklmnopqrst');
  });

  it('counts every redaction it applies', () => {
    const result = redactBoundaryText('sk-aaaaaaaaaaaaaaaaaaaa and ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(result.redactions).toBeGreaterThanOrEqual(2);
    expect(result.text).not.toContain('sk-aaaaaaaaaaaaaaaaaaaa');
  });
});

/* ------------------------------------------------------ private reasoning */

describe('private reasoning never reaches the terminal', () => {
  const REASONING = [
    'chain of thought: first I considered the schema',
    'chain-of-thought follows',
    'My internal monologue said to retry.',
    'scratchpad: try the other adapter',
    'hidden reasoning omitted upstream',
    'system prompt: you are a coding agent',
    'developer message contents',
    '<thinking>the user probably wants</thinking>',
    'reasoning trace attached',
    'thought process: enumerate the cases',
  ];

  for (const text of REASONING) {
    it(`replaces the whole line for: ${text.slice(0, 32)}`, () => {
      const entry = projectJuliusEvent(event({ kind: 'julius.unknown', safeSummary: text }));
      expect(entry.omittedPrivateReasoning).toBe(true);
      expect(entry.headline).toBe(PRIVATE_REASONING_LINE);
      // Replaced WHOLE — no fragment of the original survives.
      expect(entry.line).not.toContain('considered');
      expect(entry.line).not.toContain('retry');
      expect(entry.line).not.toContain('you are a coding agent');
    });
  }

  it('detects reasoning even when a secret would have been redacted out of it', () => {
    // Order matters: redaction first would have removed the key and kept the
    // reasoning. Detection runs on the RAW text.
    const entry = projectJuliusEvent(event({
      kind: 'julius.unknown',
      safeSummary: 'chain of thought: the key sk-abcdefghijklmnopqrst is stale',
    }));
    expect(entry.omittedPrivateReasoning).toBe(true);
    expect(entry.headline).toBe(PRIVATE_REASONING_LINE);
    expect(entry.line).not.toContain('sk-abcdefghijklmnopqrst');
  });

  it('is a superset of the mission terminal\'s own rule', () => {
    // The boundary is defence in depth and must never be the weaker of the
    // two. Held mechanically against the existing projector rather than
    // asserted in prose.
    const CORPUS = [
      ...REASONING,
      'ordinary progress text', 'Verification failed', 'thinking about it',
      'the system prompt was updated', 'no reasoning here at all',
    ];
    for (const text of CORPUS) {
      const mission = projectTerminalEvent({
        sequence: 1, at: '2026-08-27T03:00:00.000Z', source: 'relay-core',
        kind: 'run.completed', safeSummary: text, provenance: 'live',
      });
      if (mission.omittedPrivateReasoning) {
        expect(containsPrivateReasoning(text), `mission omits "${text}" and the boundary must too`).toBe(true);
      }
    }
  });

  it('stores nothing of the omitted text anywhere in the entry', () => {
    const entry = projectJuliusEvent(event({
      kind: 'julius.unknown', safeSummary: 'scratchpad: the secret plan is to refactor everything',
    }));
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('refactor everything');
    expect(serialized).not.toContain('secret plan');
  });
});

/* ------------------------------------------------------- internal failures */

describe('a raw exception dump never reaches the terminal', () => {
  const DUMPS = [
    'TypeError: cannot read x\n    at dispatch (/srv/relay/worker.js:41:9)',
    'Error: ECONNREFUSED\n    at TCPConnectWrap.afterConnect (node:net:1595:16)',
    'at handler (/app/dist/server.cjs:8812:21)',
  ];
  for (const dump of DUMPS) {
    it(`withholds: ${dump.slice(0, 28)}`, () => {
      const entry = projectJuliusEvent(event({ kind: 'worker.failed', safeSummary: dump }));
      expect(entry.omittedInternalFailure).toBe(true);
      expect(entry.headline).toBe(INTERNAL_FAILURE_LINE);
      expect(entry.line).not.toContain('/srv/relay');
      expect(entry.line).not.toContain('node:net');
      expect(entry.severity).toBe('warning');
    });
  }

  it('does not mistake ordinary prose for a stack trace', () => {
    for (const text of ['The reviewer looked at the code', 'at least two findings remain', 'Error: none']) {
      const entry = projectJuliusEvent(event({ kind: 'julius.unknown', safeSummary: text }));
      expect(entry.omittedInternalFailure, text).toBe(false);
    }
  });
});

/* ---------------------------------------------------------------- bounds */

describe('a terminal line is bounded', () => {
  it('clamps an oversized summary', () => {
    const entry = projectJuliusEvent(event({ kind: 'julius.unknown', safeSummary: 'x'.repeat(5_000) }));
    expect(entry.headline.length).toBeLessThanOrEqual(TERMINAL_LINE_MAX);
    expect(entry.line.length).toBeLessThanOrEqual(TERMINAL_LINE_MAX);
    expect(entry.headline.endsWith('…')).toBe(true);
  });

  it('clamps a line whose label pushes it over', () => {
    const entry = projectJuliusEvent(event({
      kind: 'julius.unknown', actor: 'INDEPENDENT_REVIEWER', safeSummary: 'y'.repeat(TERMINAL_LINE_MAX),
    }));
    expect(entry.line.length).toBeLessThanOrEqual(TERMINAL_LINE_MAX);
  });
});

/* --------------------------------------------------------------- streams */

describe('projecting a batch', () => {
  const batch = (sequences: readonly number[], runId = 'run-1') =>
    sequences.map((sequence) => event({ sequence, runId, eventId: `evt-${runId}-${sequence}` }));

  it('orders by sequence and reports the last one', () => {
    const projection = projectJuliusEvents('run-1', batch([3, 1, 2]), 0);
    expect(projection.entries.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(projection.lastSequence).toBe(3);
    expect(projection.gapDetected).toBe(false);
  });

  it('resumes from a confirmed sequence rather than replaying', () => {
    const projection = projectJuliusEvents('run-1', batch([1, 2, 3, 4]), 2);
    expect(projection.entries.map((e) => e.sequence)).toEqual([3, 4]);
  });

  it('drops a duplicate and reports a gap — opposite treatments, on purpose', () => {
    const duplicated = projectJuliusEvents('run-1', [...batch([1, 2]), ...batch([2])], 0);
    expect(duplicated.entries.map((e) => e.sequence)).toEqual([1, 2]);
    expect(duplicated.gapDetected).toBe(false);

    const gapped = projectJuliusEvents('run-1', batch([1, 4]), 0);
    expect(gapped.gapDetected).toBe(true);
    // The gap is SURFACED and never filled with an invented entry.
    expect(gapped.entries.map((e) => e.sequence)).toEqual([1, 4]);
  });

  it('never leaks another run\'s events into this run\'s terminal', () => {
    const mixed = [...batch([1, 2], 'run-1'), ...batch([1, 2], 'run-2')];
    const projection = projectJuliusEvents('run-1', mixed, 0);
    expect(projection.entries.every((e) => e.runId === 'run-1')).toBe(true);
    expect(projection.entries).toHaveLength(2);
  });

  it('accumulates redaction counts across the batch', () => {
    const leaky = [
      event({ sequence: 1, kind: 'julius.unknown', safeSummary: 'key sk-aaaaaaaaaaaaaaaaaaaa' }),
      event({ sequence: 2, kind: 'julius.unknown', safeSummary: 'token ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }),
    ];
    const projection = projectJuliusEvents('run-1', leaky, 0);
    expect(projection.redactionsApplied).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(projection)).not.toContain('sk-aaaaaaaaaaaaaaaaaaaa');
  });

  it('returns the caller\'s sequence when there is nothing new', () => {
    const projection = projectJuliusEvents('run-1', batch([1, 2]), 5);
    expect(projection.entries).toEqual([]);
    expect(projection.lastSequence).toBe(5);
  });
});
