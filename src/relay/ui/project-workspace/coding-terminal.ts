import {
  sanitizeTerminalBlock,
  sanitizeTerminalLabels,
  sanitizeTerminalLine,
} from '../app/terminal-sanitize';
import type {
  CodingTerminalAttestation,
  CodingTerminalLine,
  CodingTerminalPermissions,
  CodingTerminalState,
  CodingTerminalStatus,
  CodingTerminalTest,
  MissionClaim,
} from '../app/contracts';
import type { ProjectPhase } from './contracts';

/**
 * CODING AGENT TERMINAL — pure display projection.
 *
 * The renderer receives only what this function returns, and this function
 * returns only what the bridge actually captured. There is no branch here
 * that can produce a command, a filename, a tool call, a patch, or a progress
 * message that Relay did not observe: absent facts become `null`, empty
 * lists, or the single truthful waiting line.
 *
 * Everything is re-sanitized on the way out. The bridge already sanitized at
 * capture; this is the second, independent pass that guarantees no ANSI,
 * control character, credential, environment value, absolute path, or
 * complete session identifier can reach the DOM even if persisted state was
 * tampered with in localStorage.
 */

/**
 * THE SENTENCES THE TERMINAL SHOWS, NAMING THE RUNTIME THAT IS ACTUALLY THERE.
 *
 * These were literals mentioning Claude Code. The header was corrected to read
 * `view.runtime` and these were not, so on a hosted Agent-SDK run — which
 * emits no lifecycle events, and therefore shows the waiting line for its whole
 * duration — the live-progress sentence named a different agent than the one
 * running, underneath a header naming the right one. Fixing the header alone
 * was fixing a fourth instance of one defect and calling it the class.
 */
export const codingTerminalWaitingMessage = (runtime: string): string =>
  `${runtime} is running. Awaiting the next verified execution event.`;

export const codingTerminalEmptyMessage = (runtime: string): string =>
  `No ${runtime} execution has run for this project yet.`;

/** The neutral runtime name, for a view built before any run exists. A
 *  deployment that has never run one must not be told which agent it uses. */
export const CODING_TERMINAL_UNRUN_RUNTIME = 'Coding Agent';

const STATUS_LABEL: Record<CodingTerminalStatus, string> = {
  waiting: 'WAITING',
  live: 'LIVE',
  complete: 'COMPLETE',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
};

const PHASE_LABEL: Record<ProjectPhase, string> = {
  plan: 'PLAN',
  research: 'RESEARCH',
  build: 'BUILD',
  verify: 'VERIFY',
  review: 'REVIEW',
  repair: 'REPAIR',
  complete: 'COMPLETE',
};

const TEST_STATUS_LABEL: Record<CodingTerminalTest['status'], string> = {
  passed: 'PASSED',
  failed: 'FAILED',
  not_run: 'NOT RUN',
};

export interface CodingTerminalView {
  /** False → the clean pre-mission empty state (no execution has happened). */
  present: boolean;
  status: CodingTerminalStatus;
  statusLabel: string;
  /** Relay's own shortened execution id — never an external session id. */
  executionId: string;
  externalSessionRedacted: string | null;
  runtime: string;
  /** Who paid, derived from the attestation — never a fixed label. */
  billingLabel: string;
  projectLabel: string;
  phaseLabel: string;
  permissions: CodingTerminalPermissions;
  permissionSummary: string;
  startedAt: string | null;
  endedAt: string | null;
  lines: CodingTerminalLine[];
  /** Present only while the process is genuinely running. */
  waitingMessage: string | null;
  activeFile: string | null;
  changedFiles: string[];
  changedFileCount: number;
  /** Exit status of the last command Relay itself ran. */
  lastExitCode: number | null;
  test: CodingTerminalTest | null;
  testStatusLabel: string;
  diff: string | null;
  claim: MissionClaim | null;
  attestation: CodingTerminalAttestation | null;
  attestationLabel: string;
  attested: boolean;
  eventCount: number;
}

/** An empty, honest view — used before any Claude execution exists. */
export function emptyCodingTerminalView(phase: ProjectPhase = 'plan'): CodingTerminalView {
  return {
    present: false,
    status: 'waiting',
    statusLabel: STATUS_LABEL.waiting,
    executionId: '—',
    externalSessionRedacted: null,
    runtime: CODING_TERMINAL_UNRUN_RUNTIME,
    billingLabel: billingLabelFor(null, 'unknown'),
    projectLabel: '—',
    phaseLabel: PHASE_LABEL[phase],
    permissions: { allowedTools: [], allowedFiles: [], protectedPaths: [], deniedCapabilities: [] },
    permissionSummary: 'No permission envelope has been compiled yet.',
    startedAt: null,
    endedAt: null,
    lines: [],
    waitingMessage: null,
    activeFile: null,
    changedFiles: [],
    changedFileCount: 0,
    lastExitCode: null,
    test: null,
    testStatusLabel: TEST_STATUS_LABEL.not_run,
    diff: null,
    claim: null,
    attestation: null,
    attestationLabel: 'NOT ATTESTED',
    attested: false,
    eventCount: 0,
  };
}

function summarizePermissions(p: CodingTerminalPermissions): string {
  if (p.allowedTools.length === 0 && p.allowedFiles.length === 0) {
    return 'No permission envelope has been compiled yet.';
  }
  const parts: string[] = [];
  if (p.allowedTools.length) parts.push(`tools ${p.allowedTools.join(', ')}`);
  if (p.allowedFiles.length) parts.push(`write ${p.allowedFiles.join(', ')}`);
  if (p.protectedPaths.length) parts.push(`${p.protectedPaths.length} protected path(s)`);
  if (p.deniedCapabilities.length) parts.push(`no ${p.deniedCapabilities.join('/')}`);
  return parts.join(' · ');
}

function attestationLabelFor(a: CodingTerminalAttestation | null): { label: string; attested: boolean } {
  if (!a) return { label: 'NOT ATTESTED', attested: false };
  if (a.fallbackOccurred) return { label: 'NOT ATTESTED — fallback occurred', attested: false };
  if (!a.launchVerified) return { label: 'NOT ATTESTED — process never launched', attested: false };
  if (!a.completionVerified) return { label: 'LAUNCH ONLY — no valid completion', attested: false };
  return { label: 'EXECUTION ATTESTED', attested: true };
}

/**
 * Build the terminal view from the persisted/polled terminal state.
 *
 * `terminal` is the bridge's captured read-model. When it is absent, no real
 * Claude execution exists for this mission and the empty state is returned —
 * the UI never fabricates a placeholder run.
 */
export function buildCodingTerminalView(input: {
  terminal?: CodingTerminalState;
  phase: ProjectPhase;
}): CodingTerminalView {
  const t = input.terminal;
  if (!t) return emptyCodingTerminalView(input.phase);

  const permissions: CodingTerminalPermissions = {
    allowedTools: sanitizeTerminalLabels(t.permissions?.allowedTools ?? [], 40),
    allowedFiles: sanitizeTerminalLabels(t.permissions?.allowedFiles ?? [], 120),
    protectedPaths: sanitizeTerminalLabels(t.permissions?.protectedPaths ?? [], 120),
    deniedCapabilities: sanitizeTerminalLabels(t.permissions?.deniedCapabilities ?? [], 40),
  };

  // Re-sanitize and re-order defensively: display order is the captured
  // sequence, which is what survives persistence and refresh.
  const lines: CodingTerminalLine[] = (t.lines ?? [])
    .map((l) => {
      const target = l.target ? sanitizeTerminalLine(l.target, 160) : undefined;
      return {
        sequence: l.sequence,
        at: l.at,
        kind: l.kind,
        truth: l.truth,
        text: sanitizeTerminalLine(l.text),
        ...(target ? { target } : {}),
      };
    })
    .filter((l) => l.text.length > 0)
    .sort((a, b) => a.sequence - b.sequence);

  const test: CodingTerminalTest | null = t.test
    ? {
        command: sanitizeTerminalLine(t.test.command, 200),
        status: t.test.status,
        exitCode: t.test.exitCode,
        output: sanitizeTerminalBlock(t.test.output, { maxLines: 80 }),
      }
    : null;

  const claim: MissionClaim | null = t.claim
    ? {
        summary: sanitizeTerminalLine(t.claim.summary),
        filesChanged: sanitizeTerminalLabels(t.claim.filesChanged ?? [], 160),
        checksRun: sanitizeTerminalLabels(t.claim.checksRun ?? [], 160),
      }
    : null;

  const attestation = t.attestation ?? null;
  const { label: attestationLabel, attested } = attestationLabelFor(attestation);
  const changedFiles = sanitizeTerminalLabels(t.changedFiles ?? [], 160);

  return {
    present: true,
    status: t.status,
    statusLabel: STATUS_LABEL[t.status] ?? STATUS_LABEL.waiting,
    executionId: sanitizeTerminalLine(t.executionId, 40) || '—',
    externalSessionRedacted: t.externalSessionRedacted
      ? sanitizeTerminalLine(t.externalSessionRedacted, 20)
      : null,
    // The FIFTH instance of the same class, sitting one line above its own
    // fix: a blank runtime fell back to a Claude Code literal, so all four
    // derived strings derived from it. `Unknown is not zero, never a default`.
    runtime: sanitizeTerminalLine(t.runtime, 80) || CODING_TERMINAL_UNRUN_RUNTIME,
    // GATED ON EXECUTION, not on the occupant's cost model. `billingPath` says
    // how this occupant is paid for; only `launchVerified` says whether
    // anything was. Ungated, a run that never started rendered "API PAID" —
    // the exact mirror of the money defect this field was widened to fix.
    billingLabel: billingLabelFor(t.attestation, t.billing),
    projectLabel: sanitizeTerminalLine(t.projectLabel, 120) || '—',
    phaseLabel: PHASE_LABEL[input.phase],
    permissions,
    permissionSummary: summarizePermissions(permissions),
    startedAt: t.startedAt ?? null,
    endedAt: t.endedAt ?? null,
    lines,
    // Truthful only while the process is genuinely running.
    waitingMessage: t.status === 'live'
      ? codingTerminalWaitingMessage(sanitizeTerminalLine(t.runtime, 80) || 'The Coding Agent')
      : null,
    activeFile: t.activeFile ? sanitizeTerminalLine(t.activeFile, 160) : null,
    changedFiles,
    changedFileCount: changedFiles.length,
    lastExitCode: test ? test.exitCode : null,
    test,
    testStatusLabel: TEST_STATUS_LABEL[test?.status ?? 'not_run'],
    diff: t.diff ? sanitizeTerminalBlock(t.diff, { maxLines: 240 }) || null : null,
    claim,
    attestation,
    attestationLabel,
    attested,
    eventCount: lines.length,
  };
}

/* ------------------------------------------------------- role billing */

/**
 * The truthful default description of the Prompt Architect route.
 *
 * Sunday Alcatraz SELECTS and RECORDS the architect route (mode, provider,
 * model, limits); the request itself leaves the Relay bridge directly for the
 * OpenAI API. Saying "routed through" would claim a network hop that did not
 * occur, so the coordination wording is used instead — and the backend's own
 * receipt label overrides this whenever a request has actually happened.
 */
export const ARCHITECT_ROUTE_LABEL = 'Coordinated by Sunday Alcatraz';

/**
 * ONE LABEL PER BILLING PATH, and no default that asserts.
 *
 * `unknown` renders as UNKNOWN rather than falling back to SUBSCRIPTION —
 * unknown is not zero, and it is certainly not "somebody else already paid".
 */
export const BILLING_LABEL: Readonly<Record<CodingTerminalAttestation['billingPath'], string>> =
  Object.freeze({
    subscription: 'SUBSCRIPTION',
    api_billed: 'API PAID',
    portal: 'PORTAL',
    local: 'NOT BILLED',
    simulated: 'SIMULATED — NO SPEND',
    unknown: 'UNKNOWN',
  });

/**
 * The payer, or the honest absence of one.
 *
 * `billingPath` is the OCCUPANT's cost model and exists before anything runs.
 * `launchVerified` is the only field that says a run happened. A label built
 * from the first alone announces an intention; this repository's rule is to
 * announce facts.
 */
export function billingLabelFor(
  attestation: CodingTerminalAttestation | null,
  fallback: CodingTerminalAttestation['billingPath'],
): string {
  if (attestation === null) return BILLING_LABEL[fallback];
  if (!attestation.launchVerified) return 'NOT BILLED';
  return BILLING_LABEL[attestation.billingPath];
}

export interface RoleBillingRow {
  roleKey: 'prompt_architect' | 'coding_agent' | 'reviewer';
  /** Actor name, e.g. "ChatGPT". Never a claim about a model that did not run. */
  actor: string;
  role: string;
  /** Runtime/provider facts, e.g. "Coordinated by Sunday Alcatraz". */
  runtime: string;
  /** Honest billing label — API PAID only after a proven successful request. */
  billingLabel: string;
  /** Execution status label — never "complete" without an attestation. */
  statusLabel: string;
  accessLabel?: string;
}

/**
 * Truthful role presentation. A role is only ever labeled API PAID when a
 * real, attested, api-billed request happened. Hermes runs on an Anthropic
 * subscription and is READ ONLY — it is never described as a model and never
 * shown as API PAID, and its subscription billing is not a blocker.
 */
export function buildRoleBilling(input: {
  architectLabel?: string;
  architectProvenance?: 'live' | 'simulated';
  /** Set only when a real OpenAI request succeeded and was api-billed. */
  architectApiBilled?: boolean;
  /** The backend receipt's own route wording, when a request actually ran. */
  architectCoordinationLabel?: string;
  codingAttestation?: CodingTerminalAttestation | null;
  reviewerProvider?: string | null;
  reviewerModel?: string | null;
  /**
   * What the review cost, from the occupant that ran. Absent means the mission
   * has not said, which renders UNKNOWN — this row used to assert SUBSCRIPTION
   * whatever happened.
   */
  reviewerBilling?: CodingTerminalAttestation['billingPath'] | null;
  reviewerRan?: boolean;
  reviewerApproved?: boolean;
}): RoleBillingRow[] {
  const coding = input.codingAttestation ?? null;
  const codingAttested = Boolean(coding && coding.launchVerified && coding.completionVerified && !coding.fallbackOccurred);
  const route = input.architectCoordinationLabel
    ? sanitizeTerminalLine(input.architectCoordinationLabel, 120)
    : ARCHITECT_ROUTE_LABEL;

  return [
    {
      roleKey: 'prompt_architect',
      actor: 'ChatGPT',
      role: 'Prompt Architect',
      runtime: input.architectLabel ? `${route} · ${sanitizeTerminalLine(input.architectLabel, 80)}` : route,
      billingLabel: input.architectApiBilled === true ? 'API PAID' : 'NOT BILLED',
      statusLabel:
        input.architectApiBilled === true
          ? 'REQUEST COMPLETED'
          : input.architectProvenance === 'simulated'
            ? 'NOT LIVE'
            : 'NOT RUN',
    },
    {
      roleKey: 'coding_agent',
      /**
       * FROM THE ATTESTATION, WHICH IS THE ONLY THING THAT KNOWS.
       *
       * These three were the literals `'Claude Code'`, `'Authenticated local
       * runtime'` and `'SUBSCRIPTION'`. They were true while one surface could
       * ever run; a hosted, API-billed run rendered as a local subscription
       * one, on the same screen whose header correctly named the hosted
       * runtime. Before a run exists there is nothing to attest, so the row
       * says so rather than naming an agent that has not started.
       */
      actor: coding ? sanitizeTerminalLine(coding.actualActor, 60) : 'Not yet run',
      role: 'Coding Agent',
      runtime: coding ? sanitizeTerminalLine(coding.actualRuntime, 60) : '—',
      // A role that has not run demonstrably was NOT billed; `unknown` would
      // retreat from a known fact beside a `NOT RUN` status.
      billingLabel: coding === null ? 'NOT BILLED' : billingLabelFor(coding, 'unknown'),
      statusLabel: codingAttested ? 'EXECUTION ATTESTED' : coding ? 'NOT ATTESTED' : 'NOT RUN',
    },
    {
      roleKey: 'reviewer',
      actor: 'Hermes',
      role: 'Reviewer',
      // Provider/model are the values the real Hermes configuration resolved
      // to — never a guess, and Hermes itself is never called a model.
      runtime: [
        'Hermes Agent runtime',
        /**
         * NO DEFAULT PROVIDER. This read `?? 'Anthropic'`, so a review whose
         * provider Relay did not know was shown to the founder as Anthropic —
         * while the configured Reviewer runs on xAI. A guess in the position
         * where the answer belongs is worse than the absence it replaces.
         */
        `${sanitizeTerminalLine(input.reviewerProvider ?? 'Unknown', 40)} provider`,
        /**
         * UNKNOWN RENDERS, IT DOES NOT VANISH.
         *
         * This was `input.reviewerModel ? … : null`, and the `.filter` below
         * then dropped the segment entirely — so the row a founder reads to
         * learn which model reviewed went SILENT in exactly the case the
         * served-model work exists to make legible, while a comment in
         * `projection.ts` claimed it rendered as not reported. The provider one
         * line up already spells its absence `'Unknown'`; the model now agrees
         * with its own neighbour, and with the repository rule that a missing
         * value renders Unknown rather than disappearing.
         */
        /**
         * AND "UNKNOWN" ONLY WHEN THE REVIEWER ACTUALLY RAN.
         *
         * `served model Unknown` beside a reviewer that never launched reads as
         * "it ran and the provider said nothing", which is a different and
         * larger claim than "it has not run". The coding row two above already
         * makes that distinction; this one did not, and rendered Unknown
         * unconditionally.
         */
        input.reviewerModel
          ? `served model ${sanitizeTerminalLine(input.reviewerModel, 60)}`
          : input.reviewerRan === true ? 'served model Unknown' : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' · '),
      /**
       * FROM THE OCCUPANT THAT RAN, like every other row here.
       *
       * This was the literal `'SUBSCRIPTION'`, three lines below the note
       * explaining that the coding row's literals "were true while one surface
       * could ever run". The same thing had already happened here: the bound
       * Reviewer is registered `billingPath: 'api'` and reviews on an xAI API
       * key, so the founder's own billing row told them a paid review was
       * covered by a subscription.
       */
      billingLabel: BILLING_LABEL[input.reviewerBilling ?? 'unknown'],
      statusLabel: input.reviewerRan ? (input.reviewerApproved ? 'APPROVED' : 'FINDINGS RETURNED') : 'NOT RUN',
      accessLabel: 'READ ONLY',
    },
  ];
}
