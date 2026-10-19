/**
 * CODING AGENT TERMINAL CAPTURE (bridge side).
 *
 * Builds the truthful terminal read-model for the ONE real Claude Code
 * invocation that performs the mission. It never launches anything: it is
 * given what already happened — the connector's normalized lifecycle events,
 * Relay's independent inspection, the Relay-run verification result, the
 * agent's report — and turns those into ordered, sanitized terminal lines.
 *
 * Rules this module exists to enforce:
 *   - a line is only ever created from an observed fact; there is no code
 *     path here that invents a command, a file, a tool call, or progress
 *   - hidden reasoning never arrives (the stream parser already drops it) and
 *     is never reconstructed — only the omitted COUNT is reportable
 *   - every string leaves through the shared terminal sanitizer
 *   - claims (the agent's report) and evidence (Relay's own findings) carry
 *     different truth classes and can never be collapsed together
 */

import type { EventDraft } from '../src/relay/protocol/envelopes';
import {
  redactExternalId,
  sanitizeTerminalBlock,
  sanitizeTerminalLabels,
  sanitizeTerminalLine,
} from '../src/relay/ui/app/terminal-sanitize';
import type {
  CodingTerminalAttestation,
  CodingTerminalLine,
  CodingTerminalLineKind,
  CodingTerminalPermissions,
  CodingTerminalState,
  CodingTerminalStatus,
  CodingTerminalTest,
  MissionClaim,
} from '../src/relay/mission/wire-contracts';

/** Bounded so a pathological run can never produce unbounded terminal state. */
export const MAX_TERMINAL_LINES = 300;
const MAX_TEST_OUTPUT_LINES = 80;
const MAX_DIFF_LINES = 240;

/** Map a connector EventDraft kind to a terminal line kind. Unknown kinds
    become a neutral notice rather than being dropped or dressed up. */
function lineKindFor(kind: string): CodingTerminalLineKind {
  if (kind === 'agent.session_started' || kind === 'agent.session_resumed' || kind === 'agent.initialized') {
    return 'session';
  }
  if (kind === 'agent.activity_observed') return 'tool';
  if (kind === 'agent.report_created') return 'claim';
  if (kind.startsWith('agent.process_')) return 'process';
  return 'notice';
}

/** Relay-core / system observations are notices; the coding agent's own
    activity is a claim until Relay verifies it. */
function truthFor(source: EventDraft['source'], kind: CodingTerminalLineKind): CodingTerminalLine['truth'] {
  if (source === 'coding-agent') return kind === 'tool' || kind === 'claim' ? 'agent_claim' : 'system_notice';
  return 'system_notice';
}

/** The real named target of a tool event, when the connector recorded one.
    Derived only by stripping the tool name the connector itself emitted. */
function targetFrom(summary: string, payload: Record<string, unknown>): string | undefined {
  const tool = typeof payload.tool === 'string' ? payload.tool : null;
  if (!tool || !summary.startsWith(tool)) return undefined;
  const rest = summary.slice(tool.length).trim();
  return rest.length > 0 ? sanitizeTerminalLine(rest, 160) : undefined;
}

export interface TerminalCaptureOptions {
  executionId: string;
  projectLabel: string;
  runtime: string;
  permissions: CodingTerminalPermissions;
  now: () => string;
  /** Called whenever the terminal state changes, with an immutable snapshot. */
  publish: (state: CodingTerminalState) => void;
}

export interface TerminalCapture {
  /** Append one line from an observed fact. */
  note(input: {
    kind: CodingTerminalLineKind;
    truth: CodingTerminalLine['truth'];
    text: string;
    target?: string;
  }): void;
  /** Append the connector's normalized lifecycle events, in order. */
  ingestConnectorEvents(events: readonly EventDraft[]): void;
  setStatus(status: CodingTerminalStatus): void;
  markStarted(at?: string): void;
  markEnded(at?: string): void;
  setExternalSession(sessionId: string | null): void;
  /** REAL changed files — from Relay inspection, never from the claim. */
  setChangedFiles(files: readonly string[]): void;
  setDiff(diff: string | null): void;
  setTest(test: CodingTerminalTest | null): void;
  setClaim(claim: MissionClaim | null): void;
  setAttestation(attestation: CodingTerminalAttestation | null): void;
  snapshot(): CodingTerminalState;
}

export function createTerminalCapture(options: TerminalCaptureOptions): TerminalCapture {
  const state: CodingTerminalState = {
    executionId: sanitizeTerminalLine(options.executionId, 40),
    externalSessionRedacted: null,
    runtime: sanitizeTerminalLine(options.runtime, 80),
    billing: 'unknown',
    status: 'waiting',
    projectLabel: sanitizeTerminalLine(options.projectLabel, 120),
    startedAt: null,
    endedAt: null,
    permissions: {
      allowedTools: sanitizeTerminalLabels(options.permissions.allowedTools, 40),
      allowedFiles: sanitizeTerminalLabels(options.permissions.allowedFiles, 120),
      protectedPaths: sanitizeTerminalLabels(options.permissions.protectedPaths, 120),
      deniedCapabilities: sanitizeTerminalLabels(options.permissions.deniedCapabilities, 40),
    },
    lines: [],
    activeFile: null,
    changedFiles: [],
    diff: null,
    test: null,
    claim: null,
    attestation: null,
  };

  let sequence = 0;
  let truncationNoted = false;

  const snapshot = (): CodingTerminalState => ({
    ...state,
    permissions: {
      allowedTools: [...state.permissions.allowedTools],
      allowedFiles: [...state.permissions.allowedFiles],
      protectedPaths: [...state.permissions.protectedPaths],
      deniedCapabilities: [...state.permissions.deniedCapabilities],
    },
    lines: state.lines.map((l) => ({ ...l })),
    changedFiles: [...state.changedFiles],
    test: state.test ? { ...state.test } : null,
    claim: state.claim ? { ...state.claim, filesChanged: [...state.claim.filesChanged], checksRun: [...state.claim.checksRun] } : null,
    attestation: state.attestation ? { ...state.attestation } : null,
  });

  const publish = () => options.publish(snapshot());

  const push = (input: {
    kind: CodingTerminalLineKind;
    truth: CodingTerminalLine['truth'];
    text: string;
    target?: string;
    at?: string;
  }): void => {
    const text = sanitizeTerminalLine(input.text);
    if (!text) return;
    if (state.lines.length >= MAX_TERMINAL_LINES) {
      if (truncationNoted) return;
      truncationNoted = true;
      state.lines.push({
        sequence: sequence++,
        at: options.now(),
        kind: 'notice',
        truth: 'system_notice',
        text: 'Relay stopped recording further terminal lines for this run (output limit reached).',
      });
      return;
    }
    const target = input.target ? sanitizeTerminalLine(input.target, 160) : undefined;
    state.lines.push({
      sequence: sequence++,
      at: input.at ?? options.now(),
      kind: input.kind,
      truth: input.truth,
      text,
      ...(target ? { target } : {}),
    });
    if (input.kind === 'tool' && target) state.activeFile = target;
  };

  return {
    note(input) {
      push(input);
      publish();
    },

    ingestConnectorEvents(events) {
      for (const event of events) {
        const kind = lineKindFor(event.kind);
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        push({
          kind,
          truth: truthFor(event.source, kind),
          text: event.safeSummary,
          target: kind === 'tool' ? targetFrom(event.safeSummary, payload) : undefined,
          at: event.at,
        });
      }
      publish();
    },

    setStatus(status) {
      state.status = status;
      publish();
    },

    markStarted(at) {
      if (state.startedAt === null) state.startedAt = at ?? options.now();
      publish();
    },

    markEnded(at) {
      state.endedAt = at ?? options.now();
      publish();
    },

    setExternalSession(sessionId) {
      state.externalSessionRedacted = redactExternalId(sessionId);
      publish();
    },

    setChangedFiles(files) {
      state.changedFiles = sanitizeTerminalLabels(files, 160);
      publish();
    },

    setDiff(diff) {
      const text = diff === null ? '' : sanitizeTerminalBlock(diff, { maxLines: MAX_DIFF_LINES });
      state.diff = text || null;
      publish();
    },

    setTest(test) {
      state.test = test
        ? {
            command: sanitizeTerminalLine(test.command, 200),
            status: test.status,
            exitCode: test.exitCode,
            output: sanitizeTerminalBlock(test.output, { maxLines: MAX_TEST_OUTPUT_LINES }),
          }
        : null;
      publish();
    },

    setClaim(claim) {
      state.claim = claim
        ? {
            summary: sanitizeTerminalLine(claim.summary),
            filesChanged: sanitizeTerminalLabels(claim.filesChanged, 160),
            checksRun: sanitizeTerminalLabels(claim.checksRun, 160),
          }
        : null;
      publish();
    },

    setAttestation(attestation) {
      state.attestation = attestation ? { ...attestation } : null;
      /**
       * ONE VALUE, NOT TWO THAT AGREE. `billing` and the attestation's
       * `billingPath` were independent fields that happened to say the same
       * thing while one surface could ever run. It starts `unknown` — nothing
       * has been paid for before a run — and becomes what the attestation
       * observed.
       */
      state.billing = attestation?.billingPath ?? 'unknown';
      publish();
    },

    snapshot,
  };
}
