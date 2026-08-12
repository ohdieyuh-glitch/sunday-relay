/**
 * MISSION WIRE CONTRACTS — the domain records a live mission is described by.
 *
 * These types are the shared vocabulary of a three-role mission: its state and
 * phase, the architect handoff, the coding agent's claim, the reviewer's
 * verdict, the execution attestations, the coding terminal read-model, and the
 * persisted event. They are consumed by the Relay bridge (Node), the mission
 * status adapters, and the browser application alike.
 *
 * WHY THEY LIVE HERE. They were previously declared under
 * `src/relay/ui/app/contracts.ts`, which made the bridge and the mission layer
 * depend INWARD on the website tree — a module could not describe a mission
 * without importing the UI. Domain contracts belong on the domain side of that
 * line, so the dependency runs UI → mission and never mission → UI.
 *
 * NOT `src/relay/shared/`: that seam declares itself "deliberately NOT a second
 * Mission Operations domain" and carries browser-safe PROJECTIONS, not the
 * mission records themselves.
 *
 * This module imports NOTHING and declares only types. That is load-bearing:
 * it is what lets every surface — including the browser bundle — take these
 * contracts without pulling a single byte of runtime code or reaching a Node
 * built-in. Keep it type-only.
 *
 * Truthfulness invariants carried by these shapes, unchanged by the move:
 *   - a coding agent's report is a CLAIM (`MissionClaim`) and is never
 *     presented as Relay's own evidence (`EventTruthClass`);
 *   - who was REQUESTED and who ACTUALLY ran are separate facts
 *     (`MissionAttestationSummary.requestedActor` / `actualActor`);
 *   - a missing amount stays missing — token counts are `number | null`, never
 *     silently zero;
 *   - no field here holds a credential, a full provider session id, or raw
 *     provider output.
 */

/* -------------------------------------------------------- event vocabulary */

/** Which part of the system an event came from. */
export type TerminalEventCategory =
  | 'relay'
  | 'prompt_architect'
  | 'research'
  | 'coding_agent'
  | 'workspace_inspection'
  | 'verification'
  | 'reviewer'
  | 'repair'
  | 'manual_task'
  | 'completion_engine'
  | 'security'
  | 'system';

/**
 * Truthfulness class — the terminal must never present an agent's statement
 * with the same visual weight as Relay's own evidence.
 */
export type EventTruthClass =
  | 'agent_claim'
  | 'relay_evidence'
  | 'review_verdict'
  | 'user_action_required'
  | 'system_notice';

/* ------------------------------------------------------------- mission */

export type RelayMissionState =
  | 'configured'
  | 'ready'
  | 'architect_working'
  | 'handoff_ready'
  | 'coding'
  | 'claim_submitted'
  | 'relay_verifying'
  | 'reviewer_reviewing'
  | 'repair_required'
  | 'repair_in_progress'
  | 're_verifying'
  | 'approved'
  | 'verified_complete'
  // Live-mission terminal states — an honest failure or a safe cancellation.
  // The demo path never enters these (its script ends at verified_complete).
  | 'failed'
  | 'cancelled';

/**
 * The backend's fine-grained orchestration phase for a live three-role
 * mission. `RelayMissionState` above stays the coarse state the workspace
 * renders; the phase travels alongside it so the console can report exactly
 * where the mission is and, on a terminal failure, exactly which supported
 * failure occurred. The browser never derives it — the backend is the
 * authority and only reports a phase that was persisted before the next role
 * was allowed to begin.
 */
export type MissionPhase =
  | 'ready'
  | 'preflight_checking'
  | 'prompt_architect_queued'
  | 'prompt_architect_working'
  | 'handoff_ready'
  | 'coding_agent_assigned'
  | 'coding_agent_starting'
  | 'coding'
  | 'claim_submitted'
  | 'relay_verifying'
  | 'reviewer_assigned'
  | 'reviewer_starting'
  | 'reviewer_working'
  | 'review_received'
  | 'completion_deciding'
  | 'verified_complete'
  // supported terminal failures
  | 'preflight_blocked'
  | 'prompt_architect_failed'
  | 'prompt_architect_output_invalid'
  | 'dispatch_status_uncertain'
  | 'coding_agent_failed'
  | 'verification_failed'
  | 'reviewer_launch_failed'
  | 'review_incomplete'
  | 'review_blocked'
  | 'cancelled'
  | 'timed_out';

export type MissionRole = 'relay' | 'prompt_architect' | 'coding_agent' | 'reviewer';

/* ------------------------------------------------ live mission wire types */

/** The structured architect handoff a live mission produces. `objective`,
    `instructions`, and `acceptanceCriteria` come from the real Prompt
    Architect (Sunday Alcatraz); the browser only displays them. */
export interface MissionHandoff {
  objective: string;
  instructions: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  /** Honest origin label, e.g. "Sunday Alcatraz (live)" or "Sunday Alcatraz
      engine · offline models". Never claims a live model when one did not run. */
  architectLabel: string;
  architectProvenance: 'live' | 'simulated';
}

/** The coding agent's report — a CLAIM until Relay verifies it independently. */
export interface MissionClaim {
  summary: string;
  filesChanged: string[];
  checksRun: string[];
}

/** A safe, user-facing error — never a raw exception, path, or stack trace. */
export interface MissionError {
  code: string;
  safeMessage: string;
  retryable: boolean;
}

/* ------------------------------------------- three-role execution record */

/**
 * WHO ACTUALLY RAN. Mirrors the backend's execution attestation for one role.
 * A role is credited only when its process/request verifiably launched AND
 * completed with no fallback standing in for it. Never contains a credential,
 * a full external id, or provider output.
 */
export interface MissionAttestationSummary {
  role: 'prompt_architect' | 'coding_agent' | 'reviewer';
  attestationId: string;
  missionRevision?: string;
  requestedActor: string;
  actualActor: string;
  actualRuntime: string;
  provider?: string;
  /** The model Relay asked for. Configuration, stated as configuration. */
  requestedModel?: string;
  /**
   * The model the provider/runtime itself reported answered. Evidence, never
   * inferred from configuration and never defaulted from `requestedModel`;
   * absent when the runtime reported none.
   */
  actualModel?: string;
  billingPath: 'api_billed' | 'subscription' | 'portal' | 'local' | 'simulated' | 'unknown';
  launchVerified: boolean;
  completionVerified: boolean;
  fallbackOccurred: boolean;
  startedAt: string;
  completedAt?: string;
  terminalReason?: string;
}

/** Safe receipt for the Prompt Architect provider request. `networkPath`
    states the route that actually occurred — no view may claim a hop that did
    not happen. */
export interface MissionArchitectReceipt {
  provider: 'openai';
  /** The model Relay asked the architect provider for. Configuration. */
  requestedModel: string;
  /**
   * The model the provider itself said answered. Null when it named none;
   * never defaulted from `requestedModel`. This receipt used to carry one
   * `model` field holding the REQUESTED value, which the Live Terminal then
   * displayed as the architect that ran — the same conflation as defect 3.
   */
  servedModel: string | null;
  /** e.g. "Coordinated by Sunday Alcatraz · direct OpenAI request…" */
  coordinationLabel: string;
  networkPath: string;
  billingPath: 'api_billed';
  requestIdRedacted: string | null;
  startedAt: string;
  completedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  inputDigest: string;
  outputDigest: string;
}

export interface MissionReviewFinding {
  findingId: string;
  severity: 'blocking' | 'major' | 'minor' | 'informational';
  requirement: string;
  explanation: string;
  evidence: string;
  file?: string;
  line?: number;
  recommendedAction?: string;
}

/**
 * The independent reviewer's validated verdict, bound to the exact artifact
 * digest Relay verified. Hermes is an agent RUNTIME, not a model, and runs
 * read-only — never a blocker.
 *
 * IT IS NOT FREE, AND THIS TYPE USED TO SAY IT WAS. The sentence here read
 * "runs read-only on a subscription — never an API bill", which was true while
 * the only Hermes was a local process under the founder's own login. It
 * stopped being true when the dedicated Reviewer service was configured
 * against an xAI API key; the registry was updated to `billingPath: 'api'` and
 * this sentence was not, so the field below stayed typed as the single literal
 * `'subscription'` — which made the true value unrepresentable and the false
 * one automatic, in the direction that hides cost.
 *
 * `billing` now carries whatever the occupant that actually ran is registered
 * as, translated once by `occupantBillingPath`.
 */
export interface MissionReview {
  reviewer: 'Hermes';
  runtime: string;
  provider: string | null;
  /** The model the deployment asked its reviewer to use. Configuration. */
  requestedModel: string | null;
  /**
   * The model the provider itself reported answered — the SERVED model.
   * Null when the provider reported none; never defaulted from
   * `requestedModel`.
   *
   * It routinely DIFFERS from `requestedModel` and that is normal: `gpt-4o`
   * answered by `gpt-4o-2024-08-06` is the same model named exactly. What is
   * refused upstream is a SUBSTITUTION — a served model that is not a version
   * resolution of the requested one — as decided by
   * `relay-bridge/model-identity.ts`. An earlier version of this comment said a
   * review served by "a model other than the requested one" never reaches this
   * record, which described the rule that had already been removed for failing
   * every mission on the ordinary provider response.
   */
  servedModel: string | null;
  billing: 'subscription' | 'api_billed' | 'portal' | 'local' | 'simulated' | 'unknown';
  verdict: 'approved' | 'changes_required' | 'unable_to_review';
  summary: string;
  findings: MissionReviewFinding[];
  requirementsChecked: Array<{ requirement: string; status: 'passed' | 'failed' | 'uncertain'; evidence: string }>;
  reviewedArtifactDigest: string;
  startedAt: string;
  completedAt: string;
}

/* ------------------------------------------- coding-agent terminal state */

/**
 * CODING AGENT TERMINAL — the truthful execution read-model for the ONE real
 * Claude Code invocation that performs the mission.
 *
 * Every field is captured by the bridge from something that actually
 * happened: the connector's normalized lifecycle events, Relay's independent
 * workspace inspection, the Relay-run verification command, and the agent's
 * own report (labeled a CLAIM). The browser only displays it. There is no
 * field here that the UI is allowed to synthesize — when the bridge has not
 * observed something yet, the value is null/empty and the terminal says so.
 */
export type CodingTerminalStatus = 'waiting' | 'live' | 'complete' | 'failed' | 'cancelled';

/** Where a line genuinely came from. */
export type CodingTerminalLineKind =
  | 'session' // connector session lifecycle (started / initialized / resumed)
  | 'tool' // real observed tool activity (Read/Edit/Grep … + named target)
  | 'process' // process completed / failed / timed out / cancelled
  | 'claim' // the agent's own report — a claim, never evidence
  | 'inspection' // Relay's independent workspace inspection
  | 'command' // a command Relay itself ran
  | 'verification' // the result of Relay-run verification
  | 'notice'; // a Relay system notice about the run

export interface CodingTerminalLine {
  /** Monotonic, assigned at capture — the persisted display order. */
  sequence: number;
  at: string;
  kind: CodingTerminalLineKind;
  /** Claims and evidence must never be presented with equal weight. */
  truth: 'agent_claim' | 'relay_evidence' | 'system_notice';
  text: string;
  /** A real file/pattern the underlying event named. Never invented. */
  target?: string;
}

/** The deterministic verification Relay ran itself (never the agent). */
export interface CodingTerminalTest {
  command: string;
  status: 'passed' | 'failed' | 'not_run';
  exitCode: number | null;
  /** Bounded, sanitized tail of the real captured output. */
  output: string;
}

/** The permission envelope actually compiled for this invocation. */
export interface CodingTerminalPermissions {
  allowedTools: string[];
  allowedFiles: string[];
  protectedPaths: string[];
  deniedCapabilities: string[];
}

/** Who actually ran — mirrors the bridge's execution attestation. */
export interface CodingTerminalAttestation {
  attestationId: string;
  /**
   * WHAT ACTUALLY RAN, observed by the surface that ran it.
   *
   * Carried so the website presents the agent that did the work rather than a
   * literal. The role row hard-coded "Claude Code" on an "Authenticated local
   * runtime", which was true while one surface could ever run and became a
   * misreport the moment a hosted, API-billed one could.
   */
  actualActor: string;
  actualRuntime: string;
  launchVerified: boolean;
  completionVerified: boolean;
  fallbackOccurred: boolean;
  /**
   * `portal` joined this union when the reviewer's billing stopped being a
   * literal: `.env.example` has always offered `portal` as a declarable mode,
   * and a value an operator can set must be a value a row can render.
   */
  billingPath: 'subscription' | 'api_billed' | 'portal' | 'local' | 'simulated' | 'unknown';
}

export interface CodingTerminalState {
  /** Relay's OWN short execution id. Never an external session identifier. */
  executionId: string;
  /** Redacted tail of the provider session id, when one was captured. */
  externalSessionRedacted: string | null;
  /** Honest runtime label, e.g. "Claude Code (local CLI)". */
  runtime: string;
  /**
   * WHO PAID FOR THIS RUN — the same vocabulary the attestation uses.
   *
   * It was the literal `'subscription'`, which was true while the only
   * dispatchable Coding Agents were a subscription CLI and a fake. A hosted,
   * API-billed surface makes it a misreport, and money spent shown as money not
   * spent is the worst direction for this field to be wrong in.
   */
  billing: CodingTerminalAttestation['billingPath'];
  status: CodingTerminalStatus;
  /** The controlled project the agent was allowed to touch. */
  projectLabel: string;
  startedAt: string | null;
  endedAt: string | null;
  permissions: CodingTerminalPermissions;
  lines: CodingTerminalLine[];
  /** Last file a real tool event named. */
  activeFile: string | null;
  /** REAL changed files from Relay inspection — not the agent's claim. */
  changedFiles: string[];
  /** Real unified diff captured by Relay after the agent exited. */
  diff: string | null;
  test: CodingTerminalTest | null;
  claim: MissionClaim | null;
  attestation: CodingTerminalAttestation | null;
}

/* ------------------------------------------------------- wire + events */

/** A normalized mission update from a live backend. The backend is the
    authority for a live mission, so it returns the FULL ordered event list;
    the store mirrors it (id-keyed by sequence). */
/**
 * One retrieved observation, as the wire carries it.
 *
 * Deliberately not the artifact: no content, no query, no sanitization state.
 * A surface showing WHAT was read opens a page of untrusted text in a browser;
 * a surface showing THAT it was read, when, and from where is the useful half
 * and carries none of that risk.
 */
export interface MissionEvidenceReference {
  evidenceId: string;
  source: string;
  reference: string;
  /** What the source said. Null when it said nothing — never substituted. */
  publishedAt: string | null;
  retrievedAt: string;
  /** Change-detection fingerprint, so a later re-fetch can be compared. */
  contentFingerprint: string;
  /** The backend that ACTUALLY served it, and whether it fell back. */
  actualBackendId: string | null;
  fallbackOccurred: boolean;
}

export interface LiveMissionUpdate {
  state: RelayMissionState;
  /** Fine-grained backend orchestration phase (three-role missions). */
  phase?: MissionPhase;
  /** The contract revision every role executed against. */
  missionRevision?: string;
  currentRole: MissionRole;
  currentStep?: number;
  completedAt?: string | null;
  events: Array<Omit<RelayEvent, 'id' | 'missionId' | 'demo'>>;
  handoff?: MissionHandoff;
  claim?: MissionClaim;
  error?: MissionError;
  /** Coding Agent terminal state for the single real Claude invocation.
      Absent until the coding leg is reached. */
  terminal?: CodingTerminalState;
  /** Digest of the handoff Relay persisted and delivered. */
  handoffDigest?: string;
  /** Digest of the exact artifact Relay verified and the reviewer reviewed. */
  artifactDigest?: string;
  architectReceipt?: MissionArchitectReceipt;
  /**
   * What this Mission RETRIEVED, as durable references.
   *
   * References, never content — enough to find the observation again and to
   * detect that the source changed underneath it. The Project Brain records
   * that something was observed and never absorbs what it claimed, so what
   * crosses the wire is the same thing the Brain would hold.
   *
   * Absent means the Mission was authorised to read nothing, which is the
   * default. An empty array means it was authorised and retrieved none — a
   * different fact, and worth keeping distinct.
   */
  evidence?: MissionEvidenceReference[];
  review?: MissionReview;
  /** One entry per role that has actually executed. */
  attestations?: MissionAttestationSummary[];
  /**
   * The configuration this Mission runs under — the PSP / Project Settings
   * projection it was started with: role selections, execution mode, review
   * policy, requested permissions and spend/compute limits. Present so the user
   * can SEE what they configured drove this Mission (criteria 3, 5, 7, 10), and
   * so requested-vs-actual is answerable. Absent only on a legacy view.
   *
   * Declared with primitives (not imported from mission-config) because this
   * module imports NOTHING by design; the validated `RelayMissionConfig` is
   * structurally assignable to this wire shape.
   */
  config?: {
    readonly pspId: string | null;
    readonly roles: {
      readonly architect: string | null;
      readonly coding: string | null;
      readonly reviewer: string | null;
    };
    readonly mode: string;
    readonly review: string;
    readonly completionRule: string;
    readonly permissions: readonly string[];
    readonly limits: {
      readonly runtimeMinutes: number | null;
      readonly agentCalls: number | null;
      readonly spendUsd: number | null;
      readonly reviewCycles: number | null;
      readonly repairCycles: number | null;
    };
  };
}

/** Persisted mission event — the domain record the Relay Console projects
    from. Claims and evidence are distinct truth classes; display text is
    plain strings only (never HTML, never raw provider output). */
export interface RelayEvent {
  id: string;
  missionId: string;
  sequence: number;
  at: string;
  role: MissionRole;
  category: TerminalEventCategory;
  truth: EventTruthClass;
  headline: string;
  detail?: string;
  /** Safe operation summary, e.g. "MODIFY src/lib/relay-store.ts". */
  meta?: string;
  done?: boolean;
  findingId?: string;
  repairId?: string;
  /** The mission revision this event belongs to. */
  missionRevision?: string;
  /** Shortened/redacted reference to the execution the event describes —
      never a full provider session or request id. */
  executionRef?: string;
  /** The execution attestation this event refers to, when there is one. */
  attestationRef?: string;
  /** The artifact digest this event refers to, when applicable. */
  artifactRef?: string;
  demo: boolean;
}
