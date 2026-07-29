import { describe, it, expect } from 'vitest';
import { createTerminalCapture, MAX_TERMINAL_LINES } from './coding-terminal';
import type { CodingTerminalState } from './types';
import type { EventDraft } from '../src/relay/protocol/envelopes';

/**
 * Coding Agent terminal CAPTURE invariants (bridge side).
 *
 * No provider, process, or network is touched here: the capture is fed the
 * same shapes the real connector produces and is checked for the properties
 * the demo depends on — real events only, captured order, sanitization at the
 * boundary, hidden reasoning never reconstructed, and hard output bounds.
 */

const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);

const draft = (over: Partial<EventDraft> & { kind: EventDraft['kind'] }): EventDraft =>
  ({
    protocolVersion: 'relay/1',
    at: '2026-07-23T10:00:00.000Z',
    projectId: 'prj_1',
    runId: 'run_1',
    taskId: 'tsk_1',
    source: 'coding-agent',
    provenance: 'live',
    classification: 'unverified-claim',
    safeSummary: '',
    payload: {},
    refs: { workspaceId: 'wsp_1' },
    ...over,
  }) as unknown as EventDraft;

function capture(onPublish: (s: CodingTerminalState) => void = () => undefined) {
  let clock = 0;
  return createTerminalCapture({
    executionId: 'run_abc1',
    projectLabel: 'Relay controlled fixture (throwaway repository)',
    runtime: 'Claude Code (local CLI)',
    permissions: {
      allowedTools: ['Read', 'Edit'],
      allowedFiles: ['src/normalize.js'],
      protectedPaths: ['package.json', '.git'],
      deniedCapabilities: ['Bash'],
    },
    now: () => `2026-07-23T10:00:${String(clock++).padStart(2, '0')}.000Z`,
    publish: onPublish,
  });
}

describe('the capture only ever records observed facts', () => {
  it('an untouched capture reports nothing — no run, no files, no diff, no test', () => {
    const snapshot = capture().snapshot();
    expect(snapshot.lines).toEqual([]);
    expect(snapshot.status).toBe('waiting');
    expect(snapshot.startedAt).toBeNull();
    expect(snapshot.changedFiles).toEqual([]);
    expect(snapshot.diff).toBeNull();
    expect(snapshot.test).toBeNull();
    expect(snapshot.claim).toBeNull();
    expect(snapshot.attestation).toBeNull();
    expect(snapshot.activeFile).toBeNull();
  });

  it('records the connector lifecycle in order, with real targets and truth classes', () => {
    const c = capture();
    c.ingestConnectorEvents([
      draft({ kind: 'agent.session_started', safeSummary: 'Live Claude session started (session captured).' }),
      draft({ kind: 'agent.initialized', source: 'system', safeSummary: 'Claude initialized (model claude-opus-4-8).' }),
      draft({ kind: 'agent.activity_observed', safeSummary: 'Read src/normalize.js', payload: { tool: 'Read' } }),
      draft({ kind: 'agent.activity_observed', safeSummary: 'Edit src/normalize.js', payload: { tool: 'Edit' } }),
      draft({ kind: 'agent.report_created', safeSummary: 'Claude execution report received (claims only — not evidence).' }),
      draft({ kind: 'agent.process_completed', source: 'relay-core', safeSummary: 'Claude process completed (3 turn(s), 41210ms).' }),
    ]);
    const s = c.snapshot();

    expect(s.lines.map((l) => l.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(s.lines.map((l) => l.kind)).toEqual(['session', 'session', 'tool', 'tool', 'claim', 'process']);
    // The agent's own activity and report are claims; Relay-core is a notice.
    expect(s.lines[2].truth).toBe('agent_claim');
    expect(s.lines[4].truth).toBe('agent_claim');
    expect(s.lines[5].truth).toBe('system_notice');
    // Targets come from the connector, not from parsing prose.
    expect(s.lines[2].target).toBe('src/normalize.js');
    expect(s.activeFile).toBe('src/normalize.js');
  });

  it('a tool event with no recorded target gets no invented one', () => {
    const c = capture();
    c.ingestConnectorEvents([
      draft({ kind: 'agent.activity_observed', safeSummary: 'Grep', payload: { tool: 'Grep' } }),
    ]);
    const s = c.snapshot();
    expect(s.lines[0].target).toBeUndefined();
    expect(s.activeFile).toBeNull();
  });

  it('hidden reasoning is never reconstructed — only the omitted count survives', () => {
    const c = capture();
    c.ingestConnectorEvents([
      draft({
        kind: 'agent.activity_observed',
        source: 'system',
        safeSummary: '4 internal reasoning block(s) omitted from Relay output.',
        payload: { omittedReasoningBlocks: 4 },
      }),
    ]);
    const serialized = JSON.stringify(c.snapshot());
    expect(serialized).toContain('4 internal reasoning block(s) omitted');
    expect(serialized.toLowerCase()).not.toContain('thinking');
    expect(serialized.toLowerCase()).not.toContain('chain_of_thought');
  });
});

describe('the capture sanitizes at the boundary', () => {
  it('scrubs ANSI, control characters, keys, env values, paths and session ids', () => {
    const c = capture();
    c.note({ kind: 'tool', truth: 'agent_claim', text: `${ESC}[1;32mEdit${ESC}[0m src/normalize.js${NUL}` });
    c.note({ kind: 'notice', truth: 'system_notice', text: 'OPENAI_API_KEY=sk-abcdefghijklmnopqrst used' });
    c.note({ kind: 'notice', truth: 'system_notice', text: 'wrote /home/founder/private/src/normalize.js' });
    c.setExternalSession('3f8a1b2c-1111-2222-3333-444455556666');
    c.setDiff(`${ESC}[31m-  const token = "sk-zzzzzzzzzzzzzzzzzzzz";${ESC}[0m`);
    c.setTest({ command: 'node --test test/normalize.test.js', status: 'passed', exitCode: 0, output: `${ESC}[32mok${ESC}[0m` });

    const serialized = JSON.stringify(c.snapshot());
    expect(serialized).not.toContain(ESC);
    expect(serialized).not.toContain(NUL);
    expect(serialized).not.toContain('sk-abcdefghijklmnopqrst');
    expect(serialized).not.toContain('sk-zzzzzzzzzzzzzzzzzzzz');
    expect(serialized).not.toContain('/home/founder');
    expect(serialized).not.toContain('3f8a1b2c-1111-2222-3333-444455556666');
    expect(c.snapshot().externalSessionRedacted).toBe('…556666');
  });

  it('never stores a full external session identifier, even a short one', () => {
    const c = capture();
    c.setExternalSession('sess-1234567890');
    expect(c.snapshot().externalSessionRedacted).toBe('…567890');
  });

  it('bounds the diff and the test output instead of storing them whole', () => {
    const c = capture();
    c.setDiff(Array.from({ length: 4000 }, (_, i) => `+ line ${i}`).join('\n'));
    c.setTest({
      command: 'node --test test/normalize.test.js',
      status: 'failed',
      exitCode: 1,
      output: Array.from({ length: 4000 }, (_, i) => `out ${i}`).join('\n'),
    });
    const s = c.snapshot();
    expect((s.diff ?? '').split('\n').length).toBeLessThanOrEqual(241);
    expect(s.diff).toContain('[truncated: Relay output limit reached]');
    expect((s.test?.output ?? '').split('\n').length).toBeLessThanOrEqual(81);
  });

  it('caps the number of terminal lines and says so once', () => {
    const c = capture();
    for (let i = 0; i < MAX_TERMINAL_LINES + 25; i++) {
      c.note({ kind: 'tool', truth: 'agent_claim', text: `Read file-${i}.js` });
    }
    const s = c.snapshot();
    expect(s.lines).toHaveLength(MAX_TERMINAL_LINES + 1);
    const notices = s.lines.filter((l) => l.text.includes('stopped recording further terminal lines'));
    expect(notices).toHaveLength(1);
  });

  it('drops an empty line rather than recording a blank event', () => {
    const c = capture();
    c.note({ kind: 'notice', truth: 'system_notice', text: `   ${ESC}[0m  ` });
    expect(c.snapshot().lines).toEqual([]);
  });
});

describe('one capture describes exactly one process', () => {
  it('publishes an immutable snapshot that later mutations cannot reach', () => {
    const published: CodingTerminalState[] = [];
    const c = capture((s) => published.push(s));
    c.note({ kind: 'session', truth: 'system_notice', text: 'Live Claude session started.' });
    const first = published[published.length - 1];
    c.note({ kind: 'tool', truth: 'agent_claim', text: 'Edit src/normalize.js' });

    expect(first.lines).toHaveLength(1);
    expect(c.snapshot().lines).toHaveLength(2);
    // Mutating a published snapshot cannot corrupt the capture.
    first.lines.push({ sequence: 99, at: 'x', kind: 'notice', truth: 'system_notice', text: 'injected' });
    expect(c.snapshot().lines).toHaveLength(2);
  });

  it('keeps one start time and one billing path for the run', () => {
    const c = capture();
    c.markStarted('2026-07-23T10:00:00.000Z');
    c.markStarted('2026-07-23T10:05:00.000Z');
    const s = c.snapshot();
    expect(s.startedAt).toBe('2026-07-23T10:00:00.000Z');
    expect(s.billing).toBe('subscription');
  });

  it('records changed files from Relay inspection, separately from the claim', () => {
    const c = capture();
    c.setChangedFiles(['src/normalize.js']);
    c.setClaim({ summary: 'done', filesChanged: ['src/normalize.js', 'src/extra.js'], checksRun: ['tests'] });
    const s = c.snapshot();
    // Relay's inspection is the evidence; the claim is stored as a claim.
    expect(s.changedFiles).toEqual(['src/normalize.js']);
    expect(s.claim?.filesChanged).toEqual(['src/normalize.js', 'src/extra.js']);
  });
});
