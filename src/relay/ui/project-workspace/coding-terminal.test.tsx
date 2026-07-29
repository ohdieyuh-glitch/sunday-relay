/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { RelayCodingAgentTerminal } from './RelayCodingAgentTerminal';
import { RelayProjectWorkspace } from './RelayProjectWorkspace';
import { WORKSPACE_FIXTURES } from './fixtures';
import { RelayRoleBilling } from './RelayRoleBilling';
import {
  buildCodingTerminalView,
  buildRoleBilling,
  CODING_TERMINAL_EMPTY_MESSAGE,
  CODING_TERMINAL_WAITING_MESSAGE,
} from './coding-terminal';
import { createRelayAppStore, defaultSettingsForProject } from '../app/store';
import { createRelayAppStorage } from '../app/persistence';
import { createDemoRelayApplicationAdapter } from '../app/demo-adapter';
import { deriveMissionProjection } from '../app/projection';
import { createDefaultSettingsDraft } from '../project-settings/defaults';
import type {
  CodingTerminalLine,
  CodingTerminalState,
  LiveMissionUpdate,
  RelayApplicationAdapter,
  RelayMission,
  RelayProject,
  StoredProjectSettings,
} from '../app/contracts';
import type { RelayProjectWorkspaceProps } from './contracts';

/**
 * CLAUDE CODE — CODING AGENT TERMINAL: truthfulness lock.
 *
 * No test here calls a model provider, starts a process, or touches the
 * network. Every assertion is about what the terminal may and may not show
 * given captured state: real events only, no fabrication, sanitized output,
 * one process per stream, ordered refresh recovery without redispatch,
 * working auto-scroll controls, a truthful waiting state, a real diff, real
 * verification status, no hidden reasoning, and honest role billing.
 */

afterEach(cleanup);

const ESC = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);

const line = (over: Partial<CodingTerminalLine> & { sequence: number }): CodingTerminalLine => ({
  at: '2026-07-23T10:00:00.000Z',
  kind: 'tool',
  truth: 'agent_claim',
  text: 'Edit src/normalize.js',
  ...over,
});

function terminalState(over: Partial<CodingTerminalState> = {}): CodingTerminalState {
  return {
    executionId: 'a1b2c3d4',
    externalSessionRedacted: '…556666',
    runtime: 'Claude Code (local CLI)',
    billing: 'subscription',
    status: 'complete',
    projectLabel: 'Relay controlled fixture (throwaway repository)',
    startedAt: '2026-07-23T10:00:00.000Z',
    endedAt: '2026-07-23T10:00:42.000Z',
    permissions: {
      allowedTools: ['Read', 'Edit', 'Grep'],
      allowedFiles: ['src/normalize.js'],
      protectedPaths: ['package.json', 'README.md', 'test', '.git'],
      deniedCapabilities: ['Bash', 'network egress'],
    },
    lines: [
      line({ sequence: 0, kind: 'session', truth: 'system_notice', text: 'Live Claude session started (session captured).' }),
      line({ sequence: 1, kind: 'tool', text: 'Read src/normalize.js', target: 'src/normalize.js' }),
      line({ sequence: 2, kind: 'tool', text: 'Edit src/normalize.js', target: 'src/normalize.js' }),
      line({ sequence: 3, kind: 'process', truth: 'system_notice', text: 'Claude process completed (3 turn(s), 41210ms).' }),
      line({ sequence: 4, kind: 'claim', truth: 'agent_claim', text: 'Claim submitted — implemented normalizeProjectName.' }),
      line({ sequence: 5, kind: 'inspection', truth: 'relay_evidence', text: 'Relay inspection: claimed files match changed files (1); no protected file touched.' }),
      line({ sequence: 6, kind: 'verification', truth: 'relay_evidence', text: 'Required tests passed under Relay verification.' }),
    ],
    activeFile: 'src/normalize.js',
    changedFiles: ['src/normalize.js'],
    diff: '--- a/src/normalize.js\n+++ b/src/normalize.js\n-  return name;\n+  return String(name).trim().toLowerCase();',
    test: {
      command: 'node --test test/normalize.test.js',
      status: 'passed',
      exitCode: 0,
      output: '# pass 3\n# fail 0',
    },
    claim: {
      summary: 'Implemented normalizeProjectName in the claimed file.',
      filesChanged: ['src/normalize.js'],
      checksRun: ['Reported 3 test check(s)'],
    },
    attestation: {
      attestationId: 'att_coding_agent_abc123',
      launchVerified: true,
      completionVerified: true,
      fallbackOccurred: false,
      billingPath: 'subscription',
    },
    ...over,
  };
}

const renderTerminal = (state?: CodingTerminalState, phase: 'build' | 'verify' | 'complete' = 'verify') =>
  render(
    createElement(RelayCodingAgentTerminal, {
      view: buildCodingTerminalView({ terminal: state, phase }),
    }),
  );

/* ------------------------------------------------------------------ 1 */

describe('1. the terminal renders real normalized events', () => {
  it('renders every captured line, in captured order, with its truth class', () => {
    renderTerminal(terminalState());
    const feed = screen.getByRole('log');
    const items = within(feed).getAllByRole('listitem');
    expect(items).toHaveLength(7);
    expect(items[0].textContent).toContain('Live Claude session started');
    expect(items[2].textContent).toContain('Edit src/normalize.js');
    expect(items[6].textContent).toContain('Required tests passed under Relay verification.');
    // Claims and evidence are never presented identically.
    expect(items[4].className).toContain('rcat-line--claim');
    expect(items[5].className).toContain('rcat-line--evidence');
    expect(items[4].textContent).toContain('CLAIM');
    expect(items[5].textContent).toContain('RELAY EVIDENCE');
  });

  it('shows the real header facts: execution id, phase, project, runtime and SUBSCRIPTION', () => {
    renderTerminal(terminalState(), 'verify');
    expect(screen.getByText('CLAUDE CODE')).toBeTruthy();
    expect(screen.getByText('CODING AGENT')).toBeTruthy();
    expect(screen.getByText('a1b2c3d4')).toBeTruthy();
    expect(screen.getByText('VERIFY')).toBeTruthy();
    expect(screen.getByText('Relay controlled fixture (throwaway repository)')).toBeTruthy();
    expect(screen.getByText('Claude Code (local CLI)')).toBeTruthy();
    expect(screen.getByText('SUBSCRIPTION')).toBeTruthy();
    // Permission summary comes from the compiled envelope.
    const permissions = document.querySelector('.rcat-permissions');
    expect(permissions?.textContent).toContain('Read, Edit, Grep');
    expect(permissions?.textContent).toContain('src/normalize.js');
    expect(permissions?.textContent).toContain('4 protected path(s)');
  });

  it('shows a real elapsed runtime derived from the captured timestamps', () => {
    renderTerminal(terminalState());
    // 10:00:00 → 10:00:42
    expect(screen.getByText('00:42')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ 2 */

describe('2. it does not invent commands, files, or tool activity', () => {
  it('a capture with only a session line renders nothing else', () => {
    const state = terminalState({
      status: 'live',
      lines: [line({ sequence: 0, kind: 'session', truth: 'system_notice', text: 'Live Claude session started.' })],
      activeFile: null,
      changedFiles: [],
      diff: null,
      test: null,
      claim: null,
    });
    renderTerminal(state);
    const items = within(screen.getByRole('log')).getAllByRole('listitem');
    expect(items).toHaveLength(1);

    const text = document.body.textContent ?? '';
    // No command, file, patch or tool that was never captured.
    for (const invented of ['npm ', 'git commit', 'bash', '$ node', 'src/index.ts', 'package.json']) {
      expect(text).not.toContain(invented);
    }
    // No diff or verification block exists without captured evidence.
    expect(document.querySelector('.rcat-diff')).toBeNull();
    expect(document.querySelector('.rcat-block--test')).toBeNull();
    expect(document.querySelector('.rcat-block--claim')).toBeNull();
    expect(screen.getByText(/ACTIVE FILE/).parentElement?.textContent).toContain('—');
  });

  it('with no capture at all it renders the clean pre-mission empty state', () => {
    renderTerminal(undefined);
    expect(screen.getByText(CODING_TERMINAL_EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('log')).toBeNull();
    expect(document.body.textContent).not.toContain(CODING_TERMINAL_WAITING_MESSAGE);
  });

  it('the view never reports more files or events than were captured', () => {
    const view = buildCodingTerminalView({ terminal: terminalState(), phase: 'verify' });
    expect(view.changedFileCount).toBe(1);
    expect(view.eventCount).toBe(7);
    expect(view.changedFiles).toEqual(['src/normalize.js']);
  });
});

/* ------------------------------------------------------------------ 3 */

describe('3. secrets, control characters and ANSI output are sanitized', () => {
  const dirty = terminalState({
    lines: [
      line({ sequence: 0, text: `${ESC}[1;32mEdit${ESC}[0m src/normalize.js${BELL}` }),
      line({ sequence: 1, text: 'using sk-abcdefghijklmnopqrstuvwx to authenticate' }),
      line({ sequence: 2, text: `OPENAI_API_KEY=sk-livekey123456789012 ${NUL}set` }), // relay-boundary:allow-fixture — synthetic terminal text, asserts redaction
      line({ sequence: 3, text: 'wrote /home/founder/secret-project/src/normalize.js' }),
      line({ sequence: 4, text: 'session 3f8a1b2c-1111-2222-3333-444455556666 resumed' }),
    ],
    diff: `${ESC}[31m-  const token = "sk-abcdefghijklmnopqrst";${ESC}[0m`,
    test: {
      command: 'node --test test/normalize.test.js',
      status: 'passed',
      exitCode: 0,
      output: `${ESC}[32mok${ESC}[0m Bearer abcdefghijklmnop`,
    },
  });

  it('strips ANSI, control characters, keys, env values, paths and full session ids', () => {
    renderTerminal(dirty);
    fireEvent.click(screen.getByRole('button', { name: /RESULTING DIFF/ }));
    const text = document.body.textContent ?? '';

    expect(text).not.toContain(ESC);
    expect(text).not.toContain(BELL);
    expect(text).not.toContain(NUL);
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(text).not.toContain('sk-livekey123456789012');
    expect(text).not.toContain('sk-abcdefghijklmnopqrst');
    expect(text).not.toContain('Bearer abcdefghijklmnop');
    expect(text).not.toContain('/home/founder');
    expect(text).not.toContain('3f8a1b2c-1111-2222-3333-444455556666');

    // The safe remainder is still shown — sanitizing is not blanking.
    expect(text).toContain('Edit src/normalize.js');
    expect(text).toContain('[redacted]');
    expect(text).toContain('OPENAI_API_KEY=[redacted]');
    expect(text).toContain('…556666');
  });

  it('sanitizes even when persisted state was tampered with after capture', () => {
    // The bridge sanitizes at capture; the projection sanitizes again, so a
    // hand-edited localStorage payload still cannot reach the DOM unscrubbed.
    const view = buildCodingTerminalView({
      terminal: terminalState({ lines: [line({ sequence: 0, text: `${ESC}[5m sk-zzzzzzzzzzzzzzzzzzzz` })] }),
      phase: 'build',
    });
    expect(view.lines[0].text).not.toContain(ESC);
    expect(view.lines[0].text).toContain('[redacted]');
  });

  it('bounds unbounded output instead of rendering it', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `diff line ${i}`).join('\n');
    const view = buildCodingTerminalView({ terminal: terminalState({ diff: huge }), phase: 'verify' });
    expect((view.diff ?? '').split('\n').length).toBeLessThanOrEqual(241);
    expect(view.diff).toContain('[truncated: Relay output limit reached]');
  });
});

/* ------------------------------------------------------------------ 4 */

describe('4. one Claude process powers one terminal stream', () => {
  it('renders exactly one terminal surface with one execution id and one session', () => {
    renderTerminal(terminalState());
    expect(screen.getAllByLabelText('Claude Code — Coding Agent terminal')).toHaveLength(1);
    expect(screen.getAllByText('a1b2c3d4')).toHaveLength(1);
    const sessionLines = (buildCodingTerminalView({ terminal: terminalState(), phase: 'verify' }).lines || []).filter(
      (l) => l.kind === 'session',
    );
    expect(sessionLines).toHaveLength(1);
  });

  it('the terminal has no control that could start a process', () => {
    renderTerminal(terminalState());
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    for (const label of buttons) {
      expect(label).not.toMatch(/run|start|execute|dispatch|retry/i);
    }
    // It is an observation surface: no text input exists inside it.
    expect(document.querySelector('.rcat input')).toBeNull();
  });
});

/* ------------------------------------------------------------- 5 + 6 */

describe('5 + 6. event order survives refresh, and refresh never redispatches', () => {
  function liveAdapter(update: LiveMissionUpdate, spies: { start: () => void; poll: () => void }): RelayApplicationAdapter {
    const demo = createDemoRelayApplicationAdapter();
    return {
      kind: 'live',
      createProjectBrief: demo.createProjectBrief.bind(demo),
      prepareProjectBrain: demo.prepareProjectBrain.bind(demo),
      advanceMission: () => null,
      startMission: async () => {
        spies.start();
        return update;
      },
      pollMission: async () => {
        spies.poll();
        return update;
      },
    };
  }

  const update: LiveMissionUpdate = {
    state: 'verified_complete',
    currentRole: 'relay',
    completedAt: '2026-07-23T10:00:42.000Z',
    events: [
      {
        sequence: 0,
        at: '2026-07-23T10:00:00.000Z',
        role: 'coding_agent',
        category: 'coding_agent',
        truth: 'system_notice',
        headline: 'Claude Code session started.',
      },
    ],
    terminal: terminalState(),
  };

  function seededStore(spies: { start: () => void; poll: () => void }) {
    window.localStorage.clear();
    const storage = createRelayAppStorage(window.localStorage);
    const store = createRelayAppStore(storage, liveAdapter(update, spies));
    store.init();
    const created = store.createDraftFromRequest('Normalize project names safely.');
    expect(created.ok).toBe(true);
    const projectId = created.ok ? created.value.project.id : '';
    return { store, storage, projectId, draft: defaultSettingsForProject(store, projectId) };
  }

  it('restores the exact ordered terminal after a reload, without redispatching', async () => {
    const spies = { startCount: 0, pollCount: 0 };
    const handlers = {
      start: () => {
        spies.startCount += 1;
      },
      poll: () => {
        spies.pollCount += 1;
      },
    };
    const first = seededStore(handlers);
    const started = first.store.startProject(first.projectId, first.draft);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const missionId = started.value.mission.id;
    await first.store.beginLiveMission(missionId);
    expect(spies.startCount).toBe(1);

    const before = first.store.getMission(missionId)?.terminal;
    expect(before?.lines.map((l) => l.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // --- simulate a browser refresh: brand new store over the same storage.
    const reloaded = createRelayAppStore(
      createRelayAppStorage(window.localStorage),
      liveAdapter(update, handlers),
    );
    reloaded.init();
    const restored = reloaded.getMission(missionId);
    expect(restored?.terminal?.lines.map((l) => l.text)).toEqual(
      before?.lines.map((l) => l.text),
    );
    expect(restored?.terminal?.lines.map((l) => l.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // A refresh must never dispatch a second Claude Code run.
    const again = await reloaded.beginLiveMission(missionId);
    expect(again.ok).toBe(true);
    expect(spies.startCount).toBe(1);
  });

  it('the restored terminal renders in the same order it was captured', () => {
    const view = buildCodingTerminalView({ terminal: terminalState(), phase: 'complete' });
    render(createElement(RelayCodingAgentTerminal, { view }));
    const items = within(screen.getByRole('log')).getAllByRole('listitem');
    expect(items.map((i) => i.querySelector('.rcat-line-text')?.textContent)).toEqual(
      terminalState().lines.map((l) => l.text),
    );
  });
});

/* ------------------------------------------------------------------ 7 */

describe('7. auto-scroll can be paused and resumed', () => {
  it('toggles the auto-scroll state and reports it in the footer', () => {
    renderTerminal(terminalState({ status: 'live' }));
    const toggle = screen.getByRole('button', { name: /AUTO-SCROLL/ });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toContain('ON');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toContain('PAUSED');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toContain('ON');
  });

  it('a manual scroll away from the bottom pauses auto-scroll instead of snapping back', () => {
    renderTerminal(terminalState({ status: 'live' }));
    const feed = screen.getByRole('log');
    Object.defineProperty(feed, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: 200, configurable: true });
    feed.scrollTop = 100; // scrolled far from the bottom
    fireEvent.scroll(feed);

    const toggle = screen.getByRole('button', { name: /AUTO-SCROLL/ });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    // The view was not forced back to the bottom.
    expect(feed.scrollTop).toBe(100);
  });
});

/* ------------------------------------------------------------------ 8 */

describe('8. the waiting state is truthful', () => {
  it('shows the exact waiting sentence only while the process is running', () => {
    renderTerminal(terminalState({ status: 'live' }));
    expect(screen.getByText(new RegExp(CODING_TERMINAL_WAITING_MESSAGE))).toBeTruthy();
    expect(screen.getByText('LIVE')).toBeTruthy();
  });

  it('never shows it for a finished, failed, cancelled or unstarted run', () => {
    for (const status of ['complete', 'failed', 'cancelled', 'waiting'] as const) {
      cleanup();
      renderTerminal(terminalState({ status }));
      expect(document.body.textContent).not.toContain(CODING_TERMINAL_WAITING_MESSAGE);
    }
  });

  it('waiting is a message about the process, never a claim of progress', () => {
    const view = buildCodingTerminalView({ terminal: terminalState({ status: 'live' }), phase: 'build' });
    expect(view.waitingMessage).toBe(CODING_TERMINAL_WAITING_MESSAGE);
    expect(view.waitingMessage).not.toMatch(/writing|editing|thinking|analyz/i);
  });
});

/* ------------------------------------------------------------------ 9 */

describe('9. the captured diff is displayed', () => {
  it('is collapsed by default and expands to the real captured diff', () => {
    renderTerminal(terminalState());
    expect(document.querySelector('.rcat-diff')).toBeNull();

    const toggle = screen.getByRole('button', { name: /RESULTING DIFF/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('1 file');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const diff = document.querySelector('.rcat-diff');
    expect(diff?.textContent).toContain('+  return String(name).trim().toLowerCase();');
  });

  it('no diff section exists when Relay captured no diff', () => {
    renderTerminal(terminalState({ diff: null }));
    expect(screen.queryByRole('button', { name: /RESULTING DIFF/ })).toBeNull();
  });
});

/* ----------------------------------------------------------------- 10 */

describe('10. the actual verification status is displayed', () => {
  it('shows the real command, exit status and output that Relay ran', () => {
    renderTerminal(terminalState());
    const block = document.querySelector('.rcat-block--test');
    expect(block?.textContent).toContain('node --test test/normalize.test.js');
    expect(block?.textContent).toContain('PASSED');
    expect(block?.textContent).toContain('Exit status: 0');
    expect(block?.querySelector('.rcat-output')?.textContent).toContain('# pass 3');
    expect(screen.getByText(/LAST EXIT/).parentElement?.textContent).toContain('0');
  });

  it('reports a failing verification as failed — never as passed', () => {
    renderTerminal(
      terminalState({
        status: 'failed',
        test: { command: 'node --test test/normalize.test.js', status: 'failed', exitCode: 1, output: '# fail 1' },
      }),
    );
    const block = document.querySelector('.rcat-block--test');
    expect(block?.textContent).toContain('FAILED');
    expect(block?.textContent).toContain('Exit status: 1');
    expect(block?.textContent).not.toContain('PASSED');
  });

  it('shows NOT RUN when Relay has not verified anything yet', () => {
    const view = buildCodingTerminalView({ terminal: terminalState({ test: null }), phase: 'build' });
    expect(view.testStatusLabel).toBe('NOT RUN');
    expect(view.lastExitCode).toBeNull();
  });
});

/* ----------------------------------------------------------------- 11 */

describe('11. hidden reasoning is never rendered', () => {
  it('the terminal view has no field that can carry reasoning content', () => {
    const view = buildCodingTerminalView({ terminal: terminalState(), phase: 'verify' });
    const serialized = JSON.stringify(view).toLowerCase();
    expect(serialized).not.toContain('thinking');
    expect(serialized).not.toContain('reasoning');
    expect(serialized).not.toContain('chain_of_thought');
  });

  it('an omitted-reasoning notice reports only the count, never the content', () => {
    const state = terminalState({
      lines: [
        line({
          sequence: 0,
          kind: 'notice',
          truth: 'system_notice',
          text: '4 internal reasoning block(s) omitted from Relay output.',
        }),
      ],
    });
    renderTerminal(state);
    const text = document.body.textContent ?? '';
    expect(text).toContain('4 internal reasoning block(s) omitted from Relay output.');
    // The count is all that exists — no reasoning text can follow it.
    expect(text).not.toMatch(/because I|let me think|my reasoning|first, I/i);
  });

  it('drops unknown extra fields rather than passing them through to the DOM', () => {
    const tampered = {
      ...terminalState(),
      lines: [{ ...line({ sequence: 0 }), thinking: 'secret internal monologue' }],
    } as unknown as CodingTerminalState;
    const view = buildCodingTerminalView({ terminal: tampered, phase: 'build' });
    expect(JSON.stringify(view)).not.toContain('secret internal monologue');
    render(createElement(RelayCodingAgentTerminal, { view }));
    expect(document.body.textContent).not.toContain('secret internal monologue');
  });
});

/* ------------------------------------------------------------ 12 + 13 */

describe('12 + 13. Hermes billing is truthful and never a blocker', () => {
  const rows = () =>
    buildRoleBilling({
      architectLabel: 'Sunday Alcatraz (live)',
      architectProvenance: 'live',
      architectApiBilled: false,
      codingAttestation: terminalState().attestation,
      reviewerModel: 'claude-opus-4-8',
      reviewerRan: true,
      reviewerApproved: true,
    });

  it('shows Hermes as a runtime on a subscription, read-only — never API PAID, never a model', () => {
    const reviewer = rows().find((r) => r.roleKey === 'reviewer');
    expect(reviewer?.actor).toBe('Hermes');
    expect(reviewer?.role).toBe('Reviewer');
    expect(reviewer?.runtime).toContain('Hermes Agent runtime');
    expect(reviewer?.runtime).toContain('Anthropic provider');
    expect(reviewer?.billingLabel).toBe('SUBSCRIPTION');
    expect(reviewer?.billingLabel).not.toBe('API PAID');
    expect(reviewer?.accessLabel).toBe('READ ONLY');
    // Hermes is a runtime, not a model: the row never calls it one.
    expect(`${reviewer?.actor} ${reviewer?.role}`).not.toMatch(/model/i);
  });

  it('a subscription-billed Hermes still reports its approval verdict', () => {
    render(createElement(RelayRoleBilling, { rows: rows() }));
    const text = document.body.textContent ?? '';
    expect(text).toContain('SUBSCRIPTION');
    expect(text).toContain('READ ONLY');
    expect(text).toContain('APPROVED');
    // Subscription billing is not an error, a warning, or a blocker.
    expect(text).not.toMatch(/blocked|unavailable|cannot complete/i);
  });

  it('ChatGPT is only ever labeled API PAID after a proven billed request', () => {
    const unproven = buildRoleBilling({ architectProvenance: 'live' }).find(
      (r) => r.roleKey === 'prompt_architect',
    );
    expect(unproven?.billingLabel).toBe('NOT BILLED');
    // The route wording states what actually happens: Sunday Alcatraz
    // coordinates the request, which leaves the bridge directly for OpenAI.
    expect(unproven?.runtime).toContain('Coordinated by Sunday Alcatraz');
    expect(unproven?.runtime).not.toContain('Routed through');

    const proven = buildRoleBilling({ architectApiBilled: true }).find((r) => r.roleKey === 'prompt_architect');
    expect(proven?.billingLabel).toBe('API PAID');
    expect(proven?.statusLabel).toBe('REQUEST COMPLETED');
  });

  it('Claude Code is always SUBSCRIPTION, and unattested execution is never credited', () => {
    const coding = rows().find((r) => r.roleKey === 'coding_agent');
    expect(coding?.billingLabel).toBe('SUBSCRIPTION');
    expect(coding?.statusLabel).toBe('EXECUTION ATTESTED');

    const notLaunched = buildRoleBilling({
      codingAttestation: {
        attestationId: 'att_x',
        launchVerified: false,
        completionVerified: false,
        fallbackOccurred: false,
        billingPath: 'subscription',
      },
    }).find((r) => r.roleKey === 'coding_agent');
    expect(notLaunched?.statusLabel).toBe('NOT ATTESTED');
  });
});

/* ---------------------------------------------------- attestation display */

describe('execution attestation is reported honestly in the footer', () => {
  it('reports EXECUTION ATTESTED only for a launched, completed, non-fallback run', () => {
    renderTerminal(terminalState());
    expect(screen.getByText('EXECUTION ATTESTED')).toBeTruthy();
  });

  it('never claims attestation for a process that did not launch or fell back', () => {
    const base = terminalState().attestation!;
    for (const [over, label] of [
      [{ launchVerified: false }, 'NOT ATTESTED — process never launched'],
      [{ completionVerified: false }, 'LAUNCH ONLY — no valid completion'],
      [{ fallbackOccurred: true }, 'NOT ATTESTED — fallback occurred'],
    ] as const) {
      cleanup();
      renderTerminal(terminalState({ attestation: { ...base, ...over } }));
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.queryByText('EXECUTION ATTESTED')).toBeNull();
    }
  });

  it('a mission with no capture reports NOT ATTESTED, not silence', () => {
    const view = buildCodingTerminalView({ terminal: undefined, phase: 'plan' });
    expect(view.attested).toBe(false);
    expect(view.attestationLabel).toBe('NOT ATTESTED');
  });
});

/* ------------------------------------------- projection wiring (no demo) */

describe('the terminal is wired only to real missions', () => {
  const project = (demo: boolean): RelayProject => ({
    id: 'rly-002',
    reference: 'RLY / 002',
    name: 'Normalizer',
    summary: 'Normalize project names',
    originalRequest: 'Normalize project names',
    status: 'active',
    demo,
    createdAt: '2026-07-23T09:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
    activeMissionId: 'rly-002-msn-1',
  });

  const mission = (demo: boolean, terminal?: CodingTerminalState): RelayMission => ({
    id: 'rly-002-msn-1',
    projectId: 'rly-002',
    title: 'First mission',
    objective: 'Normalize project names',
    state: 'verified_complete',
    currentRole: 'relay',
    currentStep: 7,
    demo,
    createdAt: '2026-07-23T09:00:00.000Z',
    updatedAt: '2026-07-23T10:00:42.000Z',
    completedAt: '2026-07-23T10:00:42.000Z',
    terminal,
  });

  const settings = (): StoredProjectSettings => ({
    projectId: 'rly-002',
    draft: createDefaultSettingsDraft(null),
    confirmed: true,
    updatedAt: '2026-07-23T10:00:00.000Z',
  });

  it('a real mission projects the captured terminal and the role rows', () => {
    const projection = deriveMissionProjection({
      project: project(false),
      settings: settings(),
      brain: null,
      mission: mission(false, terminalState()),
      events: [],
    });
    expect(projection.codingTerminal?.present).toBe(true);
    expect(projection.codingTerminal?.executionId).toBe('a1b2c3d4');
    expect(projection.codingTerminal?.eventCount).toBe(7);
    expect(projection.roleBilling?.map((r) => r.billingLabel)).toEqual([
      'NOT BILLED',
      'SUBSCRIPTION',
      'SUBSCRIPTION',
    ]);
  });

  it('a real mission with no capture projects the honest empty terminal', () => {
    const projection = deriveMissionProjection({
      project: project(false),
      settings: settings(),
      brain: null,
      mission: mission(false, undefined),
      events: [],
    });
    expect(projection.codingTerminal?.present).toBe(false);
    expect(projection.codingTerminal?.attested).toBe(false);
  });

  it('a demo mission never gets a Coding Agent terminal or role billing', () => {
    const projection = deriveMissionProjection({
      project: project(true),
      settings: settings(),
      brain: null,
      mission: mission(true, terminalState()),
      events: [],
    });
    expect(projection.codingTerminal).toBeUndefined();
    expect(projection.roleBilling).toBeUndefined();
  });
});

/* ------------------------------------------ workspace integration render */

describe('the terminal is mounted in the real workspace surfaces', () => {
  const noop = () => undefined;

  const workspaceProps = (
    over: Partial<RelayProjectWorkspaceProps> = {},
  ): RelayProjectWorkspaceProps => ({
    ...WORKSPACE_FIXTURES.implementing,
    onSendProjectMessage: noop,
    onApproveDecision: noop,
    onRejectDecision: noop,
    onOpenTerminal: noop,
    onCloseTerminal: noop,
    onOpenProjectSettings: noop,
    onOpenManualTask: noop,
    onApproveManualTask: noop,
    onRejectManualTask: noop,
    onRequestResearch: noop,
    onOpenFinding: noop,
    onOpenRepair: noop,
    onReturnHome: noop,
    terminalOpen: false,
    ...over,
  });

  const view = () => buildCodingTerminalView({ terminal: terminalState({ status: 'live' }), phase: 'build' });

  it('renders in the workspace primary column when a real execution exists', () => {
    render(createElement(RelayProjectWorkspace, workspaceProps({ codingTerminal: view() })));
    const terminal = screen.getByLabelText('Claude Code — Coding Agent terminal');
    expect(terminal).toBeTruthy();
    expect(terminal.closest('.rpw-col-primary')).not.toBeNull();
    expect(within(terminal).getByText('CLAUDE CODE')).toBeTruthy();
    expect(within(terminal).getByText(new RegExp(CODING_TERMINAL_WAITING_MESSAGE))).toBeTruthy();
  });

  it('is absent for a workspace with no captured execution', () => {
    render(createElement(RelayProjectWorkspace, workspaceProps()));
    expect(screen.queryByLabelText('Claude Code — Coding Agent terminal')).toBeNull();
  });

  it('replaces the summary CODING AGENT panel inside full Terminal Mode', () => {
    render(
      createElement(
        RelayProjectWorkspace,
        workspaceProps({ codingTerminal: view(), terminalOpen: true, terminalFullScreen: true }),
      ),
    );
    const dialog = screen.getByRole('dialog');
    // Exactly one coding surface exists in Terminal Mode: the real terminal.
    expect(within(dialog).getAllByLabelText('Claude Code — Coding Agent terminal')).toHaveLength(1);
    expect(within(dialog).queryByLabelText('CODING AGENT activity')).toBeNull();
    // The architect and system role panels are untouched.
    expect(within(dialog).getByLabelText('PROMPT ARCHITECT activity')).toBeTruthy();
    expect(within(dialog).getByLabelText('RELAY SYSTEM activity')).toBeTruthy();
  });

  it('renders truthful role rows beside the terminal', () => {
    render(
      createElement(
        RelayProjectWorkspace,
        workspaceProps({
          codingTerminal: view(),
          roleBilling: buildRoleBilling({
            architectProvenance: 'live',
            codingAttestation: terminalState().attestation,
            reviewerRan: false,
          }),
        }),
      ),
    );
    const roles = screen.getByLabelText('Mission roles, runtimes and billing');
    expect(within(roles).getByText('ChatGPT')).toBeTruthy();
    expect(within(roles).getByText('Claude Code')).toBeTruthy();
    expect(within(roles).getByText('Hermes')).toBeTruthy();
    expect(within(roles).getByText('READ ONLY')).toBeTruthy();
    expect(roles.textContent).not.toContain('API PAID');
  });
});
